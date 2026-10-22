# 后端 API 需求与前后端联调约定

版本：1.0  
日期：2026-10-20  
面向：后端工程师、前端工程师、测试工程师  
实施基线：[产品 PRD v1.2](PRD.md)、当前 `frontend/` Mock 实现  
状态：接口实施建议，尚未实现；待确认事项见第 12 节

## 1. 目标与范围

后端采用 Python / FastAPI，为微信小程序提供真实用户身份、持久化数据、成本计算、图片存储、截图识别和家庭协作。前端采用 Taro + React + TypeScript，H5 用于开发预览。

已确认的产品规则：

- 个人空间独立可用；首次登录自动创建且仅创建一个个人空间。
- 新建物品默认在用，从购买日起连续按日历天数计算，购买当天计 1 天。
- **取消闲置状态、闲置筛选、闲置统计和暂停计时。** 状态仅为 `active`（在用）、`sold`（已出售）、`retired`（已淘汰）。
- 首页保留当前空间的「当前日均投入」，为所有有效在用物品各自日均投入之和。
- 允许先只填名称建档；金额和购买日期未知时保存为 `null`，不补成 0 或当天。
- 出售、淘汰保留档案，软删除进入回收站，两者不同。
- AI 识别结果先进入校对草稿，明确确认后才建立正式档案。

本文件中的路径、字段命名和响应结构为建议联调契约。后端如调整，应先同步前端与 OpenAPI；不得改变已确认的业务口径。

## 2. 实施顺序

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| A：个人物品闭环 | 登录、个人空间、档案、费用、处置、汇总分析、历史、回收站、基础图片上传与访问 | 能手动建档、跨会话读取、补记费用、处置、删除恢复，金额正确 |
| B：截图导入 | 异步识别、逐图状态、校对、重复提示、重试、部分提交 | 用户确认后建档，重试不重复保存，不覆盖人工修改 |
| C：家庭协作 | 家庭空间、成员、邀请、权限、个人物品迁入家庭 | 各角色权限有效，个人数据隔离，协作冲突可识别 |

A 阶段也必须具备空间归属、服务端权限校验、版本控制和幂等能力，避免家庭阶段重新设计数据结构。普通录入表单草稿暂留在前端本机；跨设备表单草稿同步不在本轮接口范围内。

## 3. 通用协议

### 3.1 请求与响应

- 基础路径：`/api/v1`，生产环境 HTTPS。
- JSON 字段统一 `snake_case`；前端在适配层转换现有 `camelCase` 字段。
- 登录后携带 `Authorization: Bearer <access_token>`。不接受前端传入的用户 ID、角色或操作者姓名作为授权依据。
- 创建资源通常返回 `201`，查询和更新返回 `200`，异步任务返回 `202`，无响应体删除返回 `204`。
- 成功响应直接返回资源；分页响应固定为 `{ "items": [], "next_cursor": null }`。统计由单独接口返回，不依赖分页列表条数。
- 列表使用稳定排序和不透明游标 `cursor`；建议 `limit` 默认 20、最大 100。服务端校验限制，具体上限可在联调前调整。
- PATCH 未传字段表示保持原值；显式传 `null` 表示清空可空字段。必填字段不能清空。
- ID 为服务端生成的不透明字符串；不要求前端了解 UUID 或数据库主键实现。

### 3.2 金额与日期

- 购入金额、支出和回收金额以整数分传输，字段以 `_cents` 结尾，例如 `800000` 表示 8,000 元。
- 未知金额为 `null`；明确零元为 `0`；所有实际支出与回收金额非负。负数仅允许出现在计算出的实际持有成本中。
- 日均指标使用 Decimal 计算；先用未舍入值汇总，再四舍五入到两位小数。响应采用以元为单位的十进制字符串，例如 `"20.11"`，字段以 `_yuan` 结尾。
- 业务日期使用 `YYYY-MM-DD`，统计日期统一 UTC+8；操作时间为服务端生成的 UTC ISO 8601 时间。
- 响应中的成本与汇总同时返回 `as_of_date`，同一次响应按同一统计日期计算。
- 不存储每日递增的持有天数或每日递减的日均金额；查询时计算即可。如使用缓存，必须随统计日期及相关数据变更失效。

### 3.3 并发与幂等

- 物品有整数 `revision`，新增为 1。修改资料、支出、处置、删除恢复或迁移成功后，物品版本递增。
- 物品写操作携带 `If-Match: "<revision>"`；版本不匹配返回 `409 REVISION_CONFLICT`，不自动覆盖。缺少必需版本返回 `428 PRECONDITION_REQUIRED`。
- 成员角色和导入条目同样具有 `revision`，各自修改时校验对应资源版本。
- 创建物品、追加支出、创建家庭、创建识别任务、提交导入、生成邀请、接受邀请、迁移和恢复支持 `Idempotency-Key`。
- 幂等作用域至少包含用户、操作与目标资源。同一 key、相同请求返回原结果；同一 key、不同请求返回 `409 IDEMPOTENCY_CONFLICT`。
- 已提交导入条目另有持久化唯一约束（导入批次 ID + 条目 ID），不能仅依赖会过期的幂等缓存。
- 先验证当前访问权限；对已经成功的相同请求，在判断过期版本前识别幂等重放，避免成功后网络断开导致错误重试。权限已撤销时不得返回原响应中的敏感资源。
- 数据修改、版本递增、审计记录、幂等结果应在一致的事务边界内提交。服务端并发执行相同 key 也只能产生一次业务结果。

### 3.4 错误结构

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "档案已更新，请刷新后核对再保存",
    "field_errors": [],
    "details": { "current_revision": 3 },
    "request_id": "req_example"
  }
}
```

| HTTP 状态 | 典型错误码 | 前端处理 |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` / `TOKEN_EXPIRED` | 刷新凭证或重新登录 |
| 403 | `PERMISSION_DENIED` | 停止写入，提示权限变化 |
| 404 | `NOT_FOUND` | 资源不存在或不可访问，不泄露其他用户资源是否存在 |
| 409 | `REVISION_CONFLICT` / `IDEMPOTENCY_CONFLICT` / `INVITATION_REVOKED` | 展示可操作提示，不静默覆盖 |
| 410 | `INVITATION_EXPIRED` | 邀请失效 |
| 413 | `FILE_TOO_LARGE` | 提示图片限制 |
| 422 | `VALIDATION_ERROR` | `field_errors` 返回字段路径、错误码和提示，保留其他输入 |
| 428 | `PRECONDITION_REQUIRED` | 补充资源版本后再操作 |
| 429 | `RATE_LIMITED` | 携带 `Retry-After`，避免无限重试 |
| 503 | `SERVICE_UNAVAILABLE` | 保留输入，允许稍后重试 |

FastAPI 默认校验错误需转换为统一结构。错误不得包含微信密钥、内部堆栈、其他用户的资料或识别供应商凭证。

## 4. 登录、用户与空间

### 4.1 登录

| 方法与路径 | 请求 | 响应与行为 |
| --- | --- | --- |
| `POST /auth/wechat/login` | `{code}`，code 来自 `wx.login` | `{access_token, refresh_token, token_type, expires_in, user}`；后端与微信换取身份，首次登录初始化个人空间 |
| `POST /auth/refresh` | `{refresh_token}` | 新凭证；建议刷新令牌轮换并防止旧令牌重复使用 |
| `POST /auth/logout` | 当前会话凭证 | `204`，撤销当前会话及其刷新能力 |
| `GET /me` | 无 | `{id, display_name, avatar_file_id}` |

微信 `session_key` 和应用密钥只在服务端使用，不下发前端。access token 有效期、退出后的即时失效机制应在 OpenAPI/部署文档中明确。H5 可使用仅开发环境启用的测试身份入口，生产环境不得暴露绕过登录的接口。

### 4.2 空间与成员

| 方法与路径 | 请求或查询 | 响应与规则 |
| --- | --- | --- |
| `GET /spaces` | 无 | `{items: [Space]}`，仅当前用户可访问空间 |
| `POST /spaces` | `{name}` + 幂等 key | 新建家庭空间，创建者为管理者；不能用此接口额外创建个人空间 |
| `GET /spaces/{space_id}/members` | `cursor, limit` | 分页成员，含 `id, display_name, role, revision` |
| `PATCH /spaces/{space_id}/members/{member_id}` | `{role}` + 成员版本 | 当前阶段仅支持将其他非管理者成员在 `editor/viewer` 间调整 |
| `DELETE /spaces/{space_id}/members/{member_id}` | 成员版本 | 管理者移除其他非管理者成员，返回 `204` |

`Space`：`id, name, kind(personal/family), role(admin/editor/viewer)`。`role` 为当前用户在此空间的服务端计算结果。个人空间只有所有者可访问，拥有管理权限。

### 4.3 邀请

| 方法与路径 | 请求或查询 | 响应与规则 |
| --- | --- | --- |
| `POST /spaces/{space_id}/invitations` | `{role: editor或viewer}` + 幂等 key | `{id, token, role, status, expires_at}`，可据 token 生成小程序分享入口 |
| `GET /spaces/{space_id}/invitations` | `cursor, limit` | 管理者查看邀请状态，是否重复返回 token 由权限和实现方案明确 |
| `DELETE /spaces/{space_id}/invitations/{invitation_id}` | 无 | 撤销邀请，重复撤销保持撤销状态 |
| `GET /invitations/{token}` | 登录后查询 | 仅返回加入前必要信息：家庭名称、邀请者显示名、角色、有效状态；不授予空间访问权 |
| `POST /invitations/{token}/accept` | 幂等 key | 用户明确确认后加入，返回 Space；重复接受不重复创建成员、不更改已有成员角色 |

邀请 token 不可枚举；接受时重新验证有效期、撤销状态及邀请者的当前授权。邀请有效期、单次/多次使用策略见待确认事项。加入家庭不公开、复制或迁移个人物品。

## 5. 物品、支出、处置与恢复

### 5.1 物品字段

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id, space_id` | string | 服务端分配身份，归属空间由路径或迁移操作确定 |
| `name` | string | 必填，去除首尾空白后不能为空 |
| `category` | string | 空时归为「未分类」；首版沿用前端类别字典 |
| `brand, model, location, channel, serial, warranty, note` | string或null | 可选资料，不推测未知信息 |
| `purchase_amount_cents` | integer或null | 购入实付金额，零与未知分开 |
| `purchase_date` | date或null | 购买日期，不能晚于统计当天 |
| `image_file_id` | string或null | 物品主图，与凭证分别管理 |
| `attachment_file_ids` | string[] | 凭证集合，必须验证文件使用权 |
| `status` | enum | `active/sold/retired`，只读；通过处置接口改变 |
| `disposal_date, recovery_amount_cents` | date/integer或null | 只读；通过处置接口改变 |
| `revision` | integer | 服务端维护 |
| `deleted_at` | datetime或null | 软删除标记 |
| `metrics` | object | 服务端计算，只读，见第 6 节 |

新建/编辑只接收可写业务字段；不接收计算结果、操作者、版本新值或任意 `status`。主图和凭证访问可通过文件接口获得 URL。列表可返回精简字段和缩略图，详情返回完整字段与 `expenses`；历史单独分页。

### 5.2 接口

| 方法与路径 | 输入 | 返回 |
| --- | --- | --- |
| `GET /spaces/{space_id}/items` | `q, category, status, cursor, limit`；`status` 可为 `active/sold/retired/history`，不传为全部有效档案；history 表示两类已处置 | 分页物品，默认不含软删除 |
| `POST /spaces/{space_id}/items` | 可写物品字段 + 幂等 key | `201 Item`，默认 active |
| `GET /items/{item_id}` | 无 | 完整 Item、expenses、metrics；普通入口不返回软删除档案 |
| `PATCH /items/{item_id}` | 待修改字段 + 物品版本 | 更新后的 Item |
| `POST /items/{item_id}/expenses` | `{category, amount_cents, occurred_on, note, attachment_file_ids?}` + 物品版本、幂等 key | 更新后的完整 Item，含新增费用 ID 和新 revision |
| `PATCH /items/{item_id}/expenses/{expense_id}` | 待修改支出字段 + 物品版本 | 更新后的 Item；原费用更正，不新增第二笔 |
| `PUT /items/{item_id}/disposal` | `{status, disposal_date, recovery_amount_cents, confirmed_zero}` + 物品版本 | 更新后的 Item；首次登记或更正处置信息 |
| `DELETE /items/{item_id}` | 物品版本 | `204`；软删除并记录事件，已删除不重复写入事件 |
| `GET /spaces/{space_id}/trash` | `cursor, limit` | 已删除档案列表，含 revision、deleted_at、基本资料 |
| `POST /items/{item_id}/restore` | 物品版本、幂等 key | 恢复后的 Item；保留原 ID、费用、生命周期状态和历史 |
| `POST /items/{item_id}/transfer` | `{target_space_id}` + 物品版本、幂等 key | 迁移后的 Item；首版仅个人 → 可编辑家庭 |
| `GET /items/{item_id}/events` | `cursor, limit` | 分页事件，含发生日期、操作时间、操作者、变更前后值 |

搜索匹配名称、品牌、型号，所有查询均限制在指定可访问空间。建议物品列表按 `created_at DESC, id DESC` 稳定排序，具体排序需在 OpenAPI 固定。

### 5.3 校验与事务规则

- 支出必须填写类别、金额、发生日期；允许明确的 0 元，不允许空金额。发生日期不能晚于今天，已知购买日期时不能早于购买日期，已处置时不能晚于处置日期。
- 更正购买日期后，必须重新校验已有支出与处置时间。不能只验证新字段而留下无效历史顺序。
- 处置只接受 `sold/retired`。日期不能早于购买日期或已有支出日期，不能晚于今天。
- 完成处置必须有实际回收金额；回收为 0 时要求 `confirmed_zero=true`，未知金额不能代替为 0。其他购入资料缺失仍可登记处置，相关计算结果为 null。
- 已处置档案允许补录处置前支出、更正费用或处置资料；不允许通过普通 PATCH 恢复 active。
- 删除后不计入统计；恢复必须重新校验当前空间权限。暂不自动过期或永久删除。
- 迁移在同一事务内改变唯一归属、更新版本、写入事件；保留原 ID、购买日期、费用、凭证和历史。历史不改写，但读取权限随当前归属变化；来源空间停止统计，目标空间开始统计。
- 已软删除的物品只能走恢复流程，不能继续编辑、追加支出或迁移。
- 如果导入历史数据含 `idle`，迁移为 `active`，包括软删除数据；保留原日期、金额和历史。新 API 不接受 idle。

创建请求示例：

```http
POST /api/v1/spaces/space_personal/items
Authorization: Bearer <access_token>
Idempotency-Key: <client_generated_key>
Content-Type: application/json
```

```json
{
  "name": "电脑",
  "category": "数码",
  "purchase_amount_cents": 800000,
  "purchase_date": "2025-06-07",
  "image_file_id": null,
  "attachment_file_ids": []
}
```

## 6. 计算、汇总、分析与记录

### 6.1 计算口径

```text
已知投入 = (已知购入金额，否则 0) + 有效追加支出
累计投入 = 购入金额已知时的已知投入，否则 null
当前持有天数 = 统计日期 - 购买日期 + 1
当前日均投入 = 累计投入 / 当前持有天数

实际持有天数 = 处置日期 - 购买日期 + 1
实际持有成本 = 累计投入 - 实际回收金额
实际日均成本 = 实际持有成本 / 实际持有天数

空间当前日均投入 = Σ 每件有效在用物品的未舍入日均投入
```

- 缺少必要日期或金额时对应指标为 null，不能用最少 1 天掩盖日期错误。
- 实际回收大于累计投入时允许负成本，向前端标明收益情况，不截断为 0。
- 日均是成本分摊，不是每天新增支出，也不是实际使用频率。
- 空间总投入包括有效的在用及已处置档案；空间当前日均仅包括有效在用档案。草稿和软删除均不计入。

### 6.2 物品 metrics

```json
{
  "as_of_date": "2026-10-19",
  "extra_cents": 50000,
  "known_investment_cents": 850000,
  "total_investment_cents": 850000,
  "holding_days": 500,
  "net_cost_cents": null,
  "current_daily_yuan": "17.00",
  "actual_daily_yuan": null
}
```

这是在用电脑的示例。`net_cost_cents` 和 `actual_daily_yuan` 仅对已处置物品计算；已处置物品 `current_daily_yuan=null`，`holding_days` 为截至处置日的天数。前端按状态选择展示字段，不将 null 转为 0。

### 6.3 汇总与分析接口

| 方法与路径 | 返回内容 |
| --- | --- |
| `GET /spaces/{space_id}/summary` | 统计日期、有效档案数、各状态数量、已知累计投入、购入金额缺失数量、当前/已知日均投入及待补充数量 |
| `GET /spaces/{space_id}/analytics` | 统计日期、数量与状态分布、已确认购入、追加支出、类别投入与件数、已处置净成本和缺失数量 |
| `GET /spaces/{space_id}/events` | 分页空间事件；支持 `cursor, limit`，业务发生日期和实际操作时间分别返回 |

summary 建议结构（两件在用物品：电脑 8,000 元/500 天，耳机 3,000 元/730 天）：

```json
{
  "as_of_date": "2026-10-19",
  "item_count": 2,
  "status_counts": { "active": 2, "sold": 0, "retired": 0 },
  "known_investment_cents": 1100000,
  "purchase_amount_missing_count": 0,
  "current_daily": {
    "known_amount_yuan": "20.11",
    "holding_count": 2,
    "incomplete_count": 0,
    "complete": true
  }
}
```

`current_daily`：部分缺失时汇总已知部分并标记 incomplete；全部在用物品均缺失时 `known_amount_yuan=null`；在用集合为空时为 `"0.00"`、complete=true。前端据此选择「当前日均投入」「已知日均投入」「待补充」。

analytics 返回的类别项需包含用于列表筛选的 category 值；状态项使用统一枚举。类别比例基于已知投入，分母为 0 时不做除法。已处置汇总仅合计可计算的净成本，并单列缺失件数，不伪装成完整合计。

Event 至少包含 `id, item_id(可空), type, title, occurred_on(可空), recorded_at, actor, changes`。`changes` 为字段级前后值；附件只记录关联变化，不暴露未授权内容。历史读取按当前权限过滤，成员离开后仍保留其历史操作者标识。物品事件按发生日期倒序，空日期排后，以操作时间和 ID 打破同序；空间记录默认按操作时间倒序。

## 7. 文件上传与访问

| 方法与路径 | 输入 | 返回与行为 |
| --- | --- | --- |
| `POST /files` | multipart：`file, purpose(item_image/receipt/import_source), space_id` | `201 {id, name, mime_type, size_bytes}`；建议首版由服务端接收，后端存对象存储 |
| `GET /files/{file_id}/access` | 无 | `{url, expires_at}`，或经鉴权代理访问；前端应能在过期后重新获取 |

- 文件必须校验真实类型、大小、格式和当前上传权限；允许格式、图片数量及大小上限在联调前公布。
- 使用 file_id 建立关联，不能把微信临时路径、本机路径或过期签名 URL 作为持久化数据。
- 未关联文件仅上传者可使用；关联后根据对应物品或导入任务的当前权限读取，不能仅凭 file_id 获得访问权限。
- 关联文件时校验授权；迁移物品时同步处理凭证权限，防止旧空间继续获得新访问地址。
- 签名 URL 在有效期内可能仍可访问，过期窗口和立即撤权需求需在实现前明确；需要即时撤权的内容使用鉴权代理。
- 去掉附件关联、放弃导入不立即删除仍被其他档案引用的文件。未关联文件清理和云端保留期限按确认策略处理，不暗设永久公开或自动销毁。

## 8. AI 截图导入

### 8.1 接口与流程

```text
上传图片 → 创建识别任务 → 查询逐图进度/结果 → 人工校对和确认
→ 提交已确认条目 → 展示每件保存结果 → 仅重试失败条目
```

| 方法与路径 | 输入 | 返回与行为 |
| --- | --- | --- |
| `POST /spaces/{space_id}/imports` | `{source_file_ids}` + 幂等 key | `202 {id, status}`；创建任务，不创建物品 |
| `GET /imports/{import_id}` | 无 | 批次状态、sources、entries、已保存结果、可重试错误；返回建议轮询间隔 |
| `POST /imports/{import_id}/retry` | `{sources: [{source_id, replacement_file_id?}]}` + 幂等 key | `202`；仅重试指定失败图片，保留其他结果和人工校对 |
| `PATCH /imports/{import_id}/entries/{entry_id}` | 可写物品字段、`included, confirmed, duplicate_decision, existing_item_id?` + 条目版本 | 更新条目；已有 saved_item_id 的条目不可再次编辑为新物品 |
| `POST /imports/{import_id}/commit` | `{entries: [{entry_id, revision}]}` + 幂等 key | 逐项返回 saved/already_saved/skipped/failed、item_id、错误 |
| `DELETE /imports/{import_id}` | 无 | 放弃未提交内容、取消后续处理；已建档物品不受影响 |

普通表单可仅保留本地草稿；识别任务及校对条目由后端保存，以支持任务查询、幂等和重试。首版建议仅创建者访问未提交的任务与截图，不自动向家庭其他成员公开草稿；提交时重新检查目标空间权限。

### 8.2 任务与结果模型

- 批次状态：`queued / processing / ready / partial_failed / failed / canceled`；保存进度独立返回，避免混淆识别完成与已建档。
- 每张 source：`id, file_id, status, error, retryable`。每个条目可关联多张来源图，一张图也可产生多个条目。
- 每个 entry：`id, revision, source_ids, values, field_sources, warnings, duplicate_candidates, duplicate_decision, included, confirmed, saved_item_id`。
- `values` 使用与物品一致的可写字段；未知为 null。`field_sources` 对应字段给出来源图片、原文、可用时的置信度及需核对标记。
- 订单总额、优惠、行数量、单件价格与购买日期候选需要明确区分；不确定分摊不能直接写入确认金额。
- 每个可提交 entry 对应一件实物；订单行数量大于 1 时，需拆分并经用户确认每件金额，不能把整行金额重复写到每件物品。数量或金额归属未解决时保持待处理，不允许直接提交。
- `duplicate_candidates` 仅包含当前用户可访问的候选档案和原因。候选变化或权限变化时重新过滤。
- 重复决定建议为 `unresolved / skip_existing / create_independent`；skip_existing 只跳过并指向已有档案，不自动覆盖资料或追加费用；普通非重复条目可为空。
- 修改业务字段后取消原确认；用户应确认最终字段。若请求同时修改并确认，确认绑定该请求最终字段版本。

### 8.3 重试与提交约束

- 后台识别写入与人工校对分层保存；重试不得覆盖人工编辑字段，不重复生成同一候选条目，不复活 canceled 任务。
- 只有 included=true、confirmed=true、重复决定已完成的条目可以新建；名称或日期等校验不通过返回对应条目错误。
- 提交以每个条目为事务边界，允许部分成功。整体权限不足返回 403；条目级失败放入结果数组。
- 原请求幂等重放返回原结果；修正失败条目后的新一轮提交使用新 key。已保存条目始终返回原 item_id。
- 成功条目唯一约束保证在客户端超时、不同请求 key、并发提交时也只创建一件档案。
- 发生取消与提交竞争时，事务保证每个条目要么已成功保存，要么保持未保存；不得先反馈取消再由后台悄悄建档。

提交响应示例：

```json
{
  "results": [
    { "entry_id": "entry_1", "status": "saved", "item_id": "item_1" },
    { "entry_id": "entry_2", "status": "failed", "error": {
      "code": "VALIDATION_ERROR", "message": "购买日期不能晚于今天",
      "field_errors": [{ "field": "purchase_date", "code": "FUTURE_DATE", "message": "购买日期不能晚于今天" }]
    } }
  ]
}
```

## 9. 权限与审计验收要求

| 操作 | 个人所有者 | 家庭 admin | 家庭 editor | 家庭 viewer |
| --- | --- | --- | --- | --- |
| 查询物品、费用、附件、历史、统计 | 是 | 是 | 是 | 是 |
| 建档、编辑、追加或更正支出、处置 | 是 | 是 | 是 | 否 |
| 软删除及恢复 | 是 | 是 | 是 | 否 |
| 邀请、移除非管理者成员、调整其角色 | 不适用 | 是 | 否 | 否 |
| 个人物品迁入家庭 | 同时检查本人拥有来源、目标有新增权限 | 按来源和目标分别校验 | 按来源和目标分别校验 | 否 |

- 每次操作查询当前权限；编辑开始时有权限不代表提交时仍有权限。
- 空间隔离必须覆盖列表、详情、搜索、统计、附件、操作历史、AI 任务及重复候选。
- 操作者和 recorded_at 由后端生成；重要修改与事件原子保存，保留前后值。成员离开不删除审计记录。
- 不允许通过字段批量赋值更改空间、角色、状态、revision 或成本结果。
- 管理者转交、自行降权、退出、解散和家庭迁出暂不开放，不采用可能留下无管理者空间的默认实现。

## 10. 与现有前端的衔接

现有代码参考：

| 文件 | 内容 |
| --- | --- |
| [domain.ts](../frontend/src/domain.ts) | 当前类型、金额/日期计算与验证 |
| [commands.ts](../frontend/src/commands.ts) | Mock 写操作、权限、版本和审计流程 |
| [services.ts](../frontend/src/services.ts) | Mock 与 HTTP 仓储边界 |
| [store.tsx](../frontend/src/store.tsx) | 当前全量快照状态管理 |
| [domain.test.ts](../frontend/tests/domain.test.ts) | 现有业务与布局测试（见前端测试目录），可作为后端验收参考 |

当前预留 `GET /ledger`、`POST /ledger/commands` 为全量快照演示契约，不是本文件要求额外实现的两套接口。建议按本文件建设资源接口，再调整前端：

1. 登录态、token 刷新与错误处理接入 services。
2. snake_case、整数分、日均十进制字符串和 file_id 与现有类型做显式转换。
3. 全量 Ledger 模式改为按空间分页列表、详情和独立 summary/analytics 查询；仅替换 services 不足以完成分页改造，store 和页面加载流程也需调整。
4. 写入成功刷新受影响的物品、汇总和历史；迁移同时刷新来源和目标空间。
5. 替换固定 AI 示例与 DEMO-FAMILY 邀请逻辑，使用真实任务状态及邀请预览/接受流程。
6. 普通表单继续保留本地输入；不得将浏览器 Mock 数据未经用户选择直接上传为生产档案。

后端交付 FastAPI 生成的 OpenAPI（`/openapi.json`）、开发环境地址、测试账号/登录方案、种子数据、运行说明及环境变量示例。前后端按同一契约联调，不将 Mock 前端校验当作后端已实现。

## 11. 关键验收用例

以下固定日期用于测试，不代表实际服务器当天日期。

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| API01 | 相同微信身份重复或并发首次登录 | 同一用户且仅一个个人空间 |
| API02 | 仅名称建档 | active，金额/日期为 null，日均为 null |
| API03 | 电脑 8,000 元，2025-06-07 购买，统计 2026-10-19 | 500 天，16.00 元/天；次日 501 天 |
| API04 | 上述电脑追加 500 元维修 | 累计 8,500 元，17.00 元/天；重试不重复追加 |
| API05 | 上述电脑在 2026-10-19 出售，回收 3,000 元 | 实际成本 5,500 元，11.00 元/天；以后不增长天数 |
| API06 | 零元、未知、处置当日购入、负净成本 | 分别正确处理；未知不变 0，当日算 1 天，负净成本保留 |
| API07 | 电脑日均 16 元 + 耳机 3,000 元/730 天 + 已出售物品 | 当前日均 20.11 元，排除已出售；不先逐件四舍五入 |
| API08 | 日均所需数据部分缺失/全部缺失/无在用物品 | 已知部分与缺失数/null/0.00 三种结果区分 |
| API09 | 删除、恢复、迁移 | 不重复计数；原身份、费用、购买时间和历史连续 |
| API10 | viewer 或失去成员权限后提交 | 拒绝；搜索、附件、重复提示无越权泄露 |
| API11 | 两个客户端使用相同旧 revision 修改 | 一个成功，另一个 409；原记录不被覆盖 |
| API12 | 同 key 相同请求、同 key 不同内容、并发重试 | 重放原结果/409/仅一次业务效果 |
| API13 | 多图部分识别失败并重试 | 成功部分和人工编辑保留，不自动建档 |
| API14 | 导入部分保存成功后重试 | 已保存条目返回原 item_id，其余可继续保存 |
| API15 | 重复/过期/撤销的邀请 | 不重复成员；过期撤销不可加入，打开邀请不自动加入 |
| API16 | 旧 idle 数据迁移 | 变 active，计时、金额、历史、软删除标记保持，不重复迁移 |
| API17 | 分页列表与汇总 | 列表只返回当前页，汇总覆盖完整授权空间 |
| API18 | 图片 URL 过期、物品迁移、成员移除 | 可重新获取有权附件；无权用户不能获得新访问地址 |

## 12. 待确认事项与暂缓范围

以下不应由工程实现默认为已批准产品规则：

- 邀请有效期、单次/多次使用限制、默认邀请角色。
- 回收站恢复期、永久删除权限、到期处理。确认前保留软删除，不自动清除。
- 文件数量/大小/格式限制、对象存储保留期、孤立文件清理、签名 URL 有效期。
- AI 供应商、识别超时与限流、图片是否用于训练及隐私说明；不能在未确定前承诺服务行为。
- 家庭退出、管理者转交、解散、家庭物品迁出。
- 普通表单草稿跨设备同步，以及识别任务/校对草稿保留期限。
- 登录会话有效期、生产 H5 登录方式（若后续对外提供 H5）。

金额、日期、默认持续在用、取消闲置、首页日均汇总等已确认规则不属于待确认项。后端工程师可先实施阶段 A，同时将以上决策项列入联调准备清单。
