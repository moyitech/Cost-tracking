# 后端 API 需求与前后端联调约定

版本：1.1

日期：2026-10-22

面向：后端工程师、前端工程师、测试工程师  
实施基线：[产品 PRD v1.2](PRD.md)、当前 `frontend/` Mock 实现  
状态：阶段 A 用户已确认验收；阶段 B 已实现并接入前端，新增 AI 真机交互待验收；阶段 C 已实现并通过隔离数据库测试与 H5 联调，微信分享与跨账号真机验收待完成；待确认事项见第 12 节

交接说明：本文件可作为后端开发需求，接口路径均省略 `/api/v1`。先实现第 2 节阶段 A，并提供 OpenAPI、开发环境地址和测试登录方案。第 12 节未决产品政策在相关功能上线前确认；前端阶段 A 已接入真实资源接口，阶段 A 基础流程已验收，阶段 B 的新增交互按第 10 节继续验收。

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
| B：截图导入 | 异步整批识别、内存预填、重复提示、整批重试、逐件提交 | 用户确认后建档，重试不重复保存，不覆盖人工修改 |
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
| `POST /spaces` | `{name, nickname}` + 幂等 key | 新建家庭空间，创建者为管理者；不能用此接口额外创建个人空间 |
| `GET /spaces/{space_id}/members` | `cursor, limit` | 分页成员，含 `id, user_id, display_name, role, revision`；display_name 为家庭内昵称；在分页前按管理者、编辑者、查看者排序，同角色本人优先，其余按加入时间及 ID 倒序。旧排序游标需从首屏重新加载 |
| `PATCH /spaces/{space_id}/members/{member_id}` | `{role}` + 成员版本 | `200 {id, user_id, display_name, role, revision}`；当前阶段仅支持将其他非管理者成员在 `editor/viewer` 间调整 |
| `DELETE /spaces/{space_id}/members/{member_id}` | 成员版本 | 管理者移除其他非管理者成员，返回 `204` |

`GET /spaces/{space_id}/members/me` 返回本人最新成员信息，不受成员列表分页影响。`PATCH /spaces/{space_id}/members/me` 接受 `{nickname}` 和 `If-Match`，只修改本人家庭昵称。昵称必填、去除首尾空格后 1–100 字符；各家庭独立。两类成员更新接口均提供 POST `.../update` 小程序别名。创建、加入成功后返回真实空间 ID，前端不得把幂等键作为空间 ID。

`Space`：`id, name, kind(personal/family), role(admin/editor/viewer)`。`role` 为当前用户在此空间的服务端计算结果。个人空间只有所有者可访问，拥有管理权限。

### 4.3 邀请

| 方法与路径 | 请求或查询 | 响应与规则 |
| --- | --- | --- |
| `GET /assets/invitation-cover.png` | 无需登录 | 公开固定 1000×800 PNG 封面，不含邀请码或用户信息，可缓存一天 |
| `POST /spaces/{space_id}/invitations` | `{role: editor或viewer}` + 幂等 key | `{id, token, role, status, created_at, expires_at, accepted_count}`，可据 token 生成小程序分享入口 |
| `GET /spaces/{space_id}/invitations` | `cursor, limit` | 管理者查看邀请状态，有效邀请重复返回 token；过期、撤销或不可用时返回 null |
| `POST /spaces/{space_id}/invitations/{invitation_id}/mini-code` | 无 | 管理者生成有效邀请的小程序码，返回 `image_base64, content_type: image/png, expires_at`，响应禁止缓存 |
| `DELETE /spaces/{space_id}/invitations/{invitation_id}` | 无 | `204`，撤销邀请，重复撤销保持撤销状态 |
| `GET /invitations/{token}` | 登录后查询 | 仅返回加入前必要信息：家庭名称、邀请者显示名、角色、有效状态；不授予空间访问权 |
| `POST /invitations/{token}/accept` | `{nickname}` + 幂等 key | 用户明确确认后加入，返回 Space；重复接受不重复创建成员、不更改已有成员角色 |

新邀请 token 使用 24 字节安全随机数（32 字符 URL-safe token），既用于分享 token 参数，也用于微信小程序码 scene；旧 43 字符 token 的预览与接受保持兼容。旧 token 请求生成码返回 409 `NEW_INVITATION_REQUIRED`，不得截断。生成码接口固定落地页 `pages/invitation/index`，版本由服务端 `WECHAT_CODE_ENV_VERSION` 配置，微信失败返回 503 `WECHAT_CODE_UNAVAILABLE`，当前目标版本没有邀请页时返回 `WECHAT_CODE_PAGE_UNAVAILABLE`；不向客户端暴露微信凭证。前端不再提供邀请码、列表或撤销入口，已有列表与撤销接口保留。

邀请 token 不可枚举；接受时重新验证有效期、撤销状态及邀请者的当前授权。邀请有效期为 7 天，可供多人使用；默认编辑者，可选择查看者。多人接受后邀请仍为 active，直到过期或撤销。成员被移除后，只能使用移除后生成的新邀请重新加入；旧请求的幂等重放同样受此限制。加入家庭不公开、复制或迁移个人物品。

邀请管理响应 status 为 `active/expired/revoked/unavailable`，accepted_count 是唯一接受人数。登录后的预览返回 `family_name, inviter_name, role, status, expires_at, already_member`，不授予访问权限；被移除且使用旧邀请时返回 `new_invitation_required`。接受接口重新检查状态，不可用时返回 409 `INVITATION_*`；有效邀请下已有成员重复确认不改变角色和昵称。

家庭创建、加入、移除、角色、昵称及邀请变更写入空间事件。家庭内新事件使用当时的家庭昵称作为操作者快照；改名或移除成员不重写历史。

## 5. 物品、支出、处置与恢复

### 5.1 物品字段

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id, space_id` | string | 服务端分配身份，归属空间由路径或迁移操作确定 |
| `name` | string | 必填，去除首尾空白后不能为空 |
| `note` | string或null | 可选备注 |
| `purchase_amount_cents` | integer或null | 购入实付金额，零与未知分开 |
| `purchase_date` | date或null | 购买日期，不能晚于统计当天 |
| `image_file_id` | string或null | 用户上传的物品主图，与凭证分别管理；与预设互斥 |
| `image_preset_id` | string或null | 公共物品图片预设 ID，与 `image_file_id` 互斥 |
| `attachment_file_ids` | string[] | 凭证集合，必须验证文件使用权 |
| `status` | enum | `active/sold/retired`，只读；通过处置接口改变 |
| `disposal_date, recovery_amount_cents` | date/integer或null | 只读；通过处置接口改变 |
| `revision` | integer | 服务端维护 |
| `deleted_at` | datetime或null | 软删除标记 |
| `metrics` | object | 服务端计算，只读，见第 6 节 |

历史数据库列仅作为兼容存档保留，不再读写为商品属性或对外返回；旧导入任务读取时过滤这些字段。

新建/编辑只接收可写业务字段；不接收计算结果、操作者、版本新值或任意 `status`。主图和凭证访问可通过文件接口获得 URL。列表可返回精简字段和缩略图，详情返回完整字段与 `expenses`；历史单独分页。

`Expense` 返回字段：`id, category, amount_cents, occurred_on, note, attachment_file_ids`。物品创建/更新响应返回完整物品资料，并附带 `id, space_id, status, disposal_date, recovery_amount_cents, deleted_at, revision, expenses, metrics`，不只返回成功布尔值。只有 `name` 是建档必填资料；未提供的金额、日期、主图及可空文本保存为 null，附件默认为空数组。物品不再提供品牌、品类、型号、位置、渠道、序列号、保修等独立字段；只用商品名描述商品。支出的维修/保养等费用类别仍保留。

### 5.2 接口

| 方法与路径 | 输入 | 返回 |
| --- | --- | --- |
| `GET /spaces/{space_id}/items` | `q, status, cursor, limit`；`status` 可为 `active/sold/retired/history`，不传为全部有效档案；history 表示两类已处置 | 分页物品，默认不含软删除 |
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

小程序兼容：微信 `wx.request` 不支持 PATCH；另提供 `POST /items/{item_id}/update` 和 `POST /items/{item_id}/expenses/{expense_id}/update`，请求体、版本校验和响应与对应 PATCH 相同。

搜索仅匹配商品名，所有查询均限制在指定可访问空间。建议物品列表按 `created_at DESC, id DESC` 稳定排序，具体排序需在 OpenAPI 固定。

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
  "purchase_amount_cents": 800000,
  "purchase_date": "2025-06-07",
  "image_file_id": null,
  "image_preset_id": null,
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
| `GET /spaces/{space_id}/analytics` | 统计日期、数量与状态分布、已确认购入、追加支出、已处置净成本和缺失数量 |
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

analytics 不再返回商品类别分布；状态项使用统一枚举。已处置汇总仅合计可计算的净成本，并单列缺失件数，不伪装成完整合计。

analytics 建议字段：

| 字段 | 类型与含义 |
| --- | --- |
| `as_of_date` | date，统计日期 |
| `item_count` | integer，空间内未删除的物品总数 |
| `status_counts` | `{active, sold, retired}`，各状态数量 |
| `known_purchase_cents` | integer，已知购入实付合计 |
| `extra_cents` | integer，追加支出合计 |
| `purchase_amount_missing_count` | integer，购入金额缺失件数 |
| `disposed` | `{item_count, known_net_cost_cents, incomplete_count}`，已处置物品数量、可计算净成本之和和不可计算件数；无已处置物品时金额为 0，全部缺失时金额为 null，部分缺失时金额为已知部分 |

summary 和 analytics 均统计整个授权空间，不随当前列表分页范围变化。

Event 至少包含 `id, item_id(可空), type, title, occurred_on(可空), recorded_at, actor, changes`。`changes` 为字段级前后值；附件只记录关联变化，不暴露未授权内容。历史读取按当前权限过滤，成员离开后仍保留其历史操作者标识。物品事件按发生日期倒序，空日期排后，以操作时间和 ID 打破同序；空间记录默认按操作时间倒序。

Event 示例：

```json
{
  "id": "event_001",
  "item_id": "item_001",
  "type": "item_updated",
  "title": "编辑物品资料",
  "occurred_on": "2026-10-22",
  "recorded_at": "2026-10-22T12:00:00Z",
  "actor": { "id": "user_001", "display_name": "我" },
  "changes": [{ "field": "note", "before": null, "after": "日常使用" }]
}
```

## 7. 文件上传与访问

按已确认的部署方案，小程序直接上传和下载腾讯云 COS 文件；后端只处理授权、签名和元数据，不代理图片内容。阶段 A 文件协议如下，替代原 `POST /files` multipart 方案：

| 方法与路径 | 输入 | 返回与行为 |
| --- | --- | --- |
| `POST /files/uploads` | JSON：`space_id, purpose(item_image/receipt/import_source), name, mime_type, size_bytes` | `201 {id, url, method: PUT, headers, expires_at}`；创建 pending 文件，签发仅针对随机临时对象键的短期上传地址 |
| 客户端直接 PUT COS URL | 原始图片二进制、返回的 headers | 图片内容从小程序直接到 COS，不经过后端；不能用 multipart 包装原始图片 |
| `POST /files/{file_id}/complete` | 无 | `200 {id, name, mime_type, size_bytes}`；后端检查上传者及当前空间写权限，校验大小和图片真实格式后标记 ready；重复确认返回同一文件 |
| `GET /files/{file_id}/access` | 无 | `{url, expires_at}`；客户端直连 COS 下载，过期后重新获取 |

- 未完成确认的 pending 文件不能访问或关联正式物品。
- 实际大小使用 COS HEAD 校验；真实图片格式使用 COS 数据万象 `imageInfo` 元数据校验，Bucket 必须支持该能力。后端不下载完整图片，校验不可用时拒绝完成确认。
- 上传地址指向临时对象；完成确认时通过 COS 内部条件复制得到独立正式对象，再校验该对象。之后即使原上传 URL 尚未到期，也不能修改正式附件。
- 使用 file_id 建立关联，不能持久化微信临时路径、本机路径或过期签名 URL。
- 未关联文件仅上传者可使用，且仍需具备对应空间权限；关联后按物品当前归属和权限访问。
- 签发上传地址、完成确认和关联附件均检查当前权限。仅凭 file_id 不授予读取权限。
- 迁移物品后根据当前归属签发下载地址，旧空间不再获得新地址。已签发的 URL 在有效期内仍可能可用，默认开发有效期为 300 秒；立即撤权需求需另行确认。
- 小程序需将 COS 域名加入相应 request/download 合法域名；H5 直传需在 COS Bucket 设置受限的 CORS 来源、PUT/GET/HEAD 方法及 Content-Type 请求头。
- 开发默认允许 JPEG、PNG、WebP，单文件 10 MiB；生产上限、图片数量及保留期上线前确认。
- 暂不自动清理临时、未关联或已取消任务的对象；移除关联不删除仍可能被其他档案引用的文件。COS 内部复制会暂时保留两份对象，后续按确认的清理策略处理。

### 公共物品图片预设

Emoji 预设采用「COS 素材 + 公共预设目录 + 物品引用预设 ID」，真实新建、编辑、截图导入与 Mock 共用选择器。首批卡通／实物各 10 款；256px 缩略图用于表单、列表和详情，点击放大读取原图。

- 独立预设目录保存稳定 ID、名称、COS 对象键、风格（cartoon／realistic）、版本、排序和启用状态。现有 `files` 表要求上传者与空间，继续用于私有照片／凭证，不放宽其授权条件来共享预设。
- 物品增加可空 `image_preset_id`，与 `image_file_id` 在请求校验、写入校验及数据库约束中互斥。选择预设只提交预设 ID，不触发上传、不为每个用户复制素材；老档案默认为 null。PATCH 指定非空图片来源时自动清除另一来源；两者显式非空返回 422。
- `GET /image-presets`：需要登录，返回 `{items: [{id, name, style, version, url, preview_url, expires_at}]}`，仅包含启用的预设，按目录排序。`url` 为原图，`preview_url` 为缩略图，均为当前 Bucket 的短期签名地址。
- `GET /image-presets/{id}/access?size=preview|original`：需要登录，返回 `{url, expires_at}`；默认为缩略图，也允许读取停用预设，以保留已有档案图片。数据库只保存对象键，不持久化签名 URL；客户端内存缓存即将过期时刷新，图片加载失败可重新签名一次。
- 新建及导入提交必须引用当前启用的目录项；未知或停用 ID 返回 `PRESET_UNAVAILABLE`。已有物品保留停用 ID 时仍可编辑其他字段、删除和恢复。停用项不会出现在新选择列表。
- 上传和维护预设由 `python -m app.publish_presets --publish` 负责，使用独立 `image-presets/` 路径与内容哈希对象键。脚本先检查所有稳定版本，再上传并核验 HEAD 元数据，最后在同一数据库事务登记目录。重复执行复用已有对象，保留停用状态；修改素材须使用新版本与新 ID。仍被引用的素材不删除。
- 私人相册照片、订单截图与凭证继续通过原有空间授权和直传协议访问。

## 8. AI 截图导入

### 8.1 接口与流程

```text
选择多张截图 → 全部直传 COS → 创建整批识别任务 → 查询批次进度
→ 一次 AI 请求联合识别、重叠去重 → 预填可滑动表单 → 逐件保存
```

| 方法与路径 | 输入 | 返回与行为 |
| --- | --- | --- |
| `GET /spaces/{space_id}/imports` | 无 | 当前创建者最近 20 个未取消 ImportTask；兼容查询保留，前端不调用、不恢复历史 |
| `POST /spaces/{space_id}/imports` | `{source_file_ids}` + 幂等 key | `202 ImportTask`；创建固定图片集合的整批任务，不创建物品或占位条目 |
| `GET /imports/{import_id}` | 无 | ImportTask：批次状态、sources、entries、已保存结果、可重试错误；返回建议轮询间隔 |
| `POST /imports/{import_id}/sources` | `{source_file_ids}` + 幂等 key | `409 IMPORT_STATE_CONFLICT`；已废弃，需创建新批次 |
| `DELETE /imports/{import_id}/sources/{source_id}` | 来源图片 ID | `409 IMPORT_STATE_CONFLICT`；已废弃，需创建新批次 |
| `POST /imports/{import_id}/retry` | `{}` + 幂等 key | `202 ImportTask`；仅允许整批失败任务整体重试；旧 sources 参数返回 409 |
| `PATCH /imports/{import_id}/entries/{entry_id}` | `{values: {可写物品字段}, input_mode?, included?, confirmed?, duplicate_decision?, existing_item_id?}` + 条目版本 | 更新条目；已有 saved_item_id 的条目不可再次编辑为新物品 |
| `POST /imports/{import_id}/commit` | `{entries: [{entry_id, revision}]}` + 幂等 key | 逐项返回 saved/already_saved/skipped/failed、item_id、错误 |
| `DELETE /imports/{import_id}` | 无 | `204`，放弃未提交内容、取消后续处理；已建档物品不受影响 |

普通表单可仅保留本地草稿；识别任务及校对条目由后端保存，以支持任务查询、幂等和重试。首版建议仅创建者访问未提交的任务与截图，不自动向家庭其他成员公开草稿；提交时重新检查目标空间权限。

小程序兼容：提供 `POST /imports/{import_id}/entries/{entry_id}/update`，与 PATCH 共用版本校验。批次仅创建者可访问；导入原图不自动关联正式档案。Worker 默认随 API 一起启动，使用 PostgreSQL 持久队列与租约恢复；独立部署时通过 AI_WORKER_ENABLED=false 关闭 API 内置消费者。

### 8.2 任务与结果模型

- ImportTask 顶层字段：`id, space_id, status, sources, entries, results, poll_after_ms`。`results` 使用下方提交响应的逐项结构；未提交时为空数组。`poll_after_ms` 为建议轮询间隔，当前无排队或处理中图片时可为 null。
- 批次状态：`queued / processing / ready / failed / canceled`（旧 partial_failed 仅兼容读取）；保存进度独立返回，避免混淆识别完成与已建档。
- 每张 source：`id, file_id, name, status, attempts, error, retryable`。每个条目可关联多张来源图，一张图也可产生多个条目。
- 每个 entry：`id, revision, source_ids, values, field_sources, warnings, duplicate_candidates, duplicate_decision, existing_item_id, input_mode, included, confirmed, saved_item_id`。`input_mode` 为 `recognized/manual`，初始为 recognized。
- `values` 使用与物品一致的可写字段；未知为 null。商品描述只用 `name`，把截图明确出现的品牌、型号和关键规格自然合入名称，不再分别输出这些字段。`field_sources` 对应字段给出来源图片、原文、可用时的置信度及需核对标记。
- 订单总额、优惠、行数量、单件价格与购买日期候选需要明确区分；不确定分摊不能直接写入确认金额。
- 有商品价格就预填：同一商品有明确单件实付时优先取实付，否则取标价/当前展示价，通过 warnings 提示核对。明确单价在数量未知或多件时仍保留，不要求用户填写或确认数量；行合计仅在数量为 1 时作为单价。完整订单明确只有一件商品时，整单实付作为本件价格优先预填；多商品或订单被裁切、金额归属不明时不使用整单实付覆盖本件标价，条件促销/划线原价/缩略图广告价不能代替当前售价；金额 0 需有明确金额或赠品原文依据。
- 已取消、整单退款完成的订单及其赠品直接过滤，不生成待添加条目；仅商品行全额退款时只过滤该行。订单关联使用批次内唯一 order_ref，跨图同订单沿用编号，不能影响同名已完成订单。部分退款、退款申请中和“退款/售后”操作按钮不能当作退款完成。没有有效候选时仍是 ready，返回空 entries，不生成占位条目。
- 前端与手动添加共用字段界面，AI 只提供预填值；多件通过左右滑动卡片切换。点击“保存物品”即确认当前件并调用 commit，无需先确认再批量提交；同样保留版本校验、重复判断及幂等。
- 日期优先取明确购入/下单日期；没有时允许用同一商品已取货/已签收日期补填，evidence 保留日期原文，warnings 标明补填依据。预计送达、可取货、发货及评价/售后日期不可用于补填，年份不全不推测。
- 未知字段的原文可缺省；模型返回的 `evidence.text=null` 归一化为空字符串，不导致整批失败。字段业务类型校验仍保留，未知名称和购入日期不得猜测。
- 每个可提交 entry 对应一件实物；明确多件的订单行由系统拆成多张卡片，不向用户提供数量字段或数量确认。单价可以预填，整行合计不能重复写到每件物品；无法确定单价时金额留空，仍可仅填商品名保存。旧任务的数量确认标记不再拦截提交；兼容接收旧客户端的 `quantity_resolved`，但忽略该字段。
- `duplicate_candidates` 仅包含当前用户可访问的候选档案和原因。候选变化或权限变化时重新过滤。
- 重复决定建议为 `unresolved / skip_existing / create_independent`；skip_existing 只跳过并指向已有档案，不自动覆盖资料或追加费用；普通非重复条目可为空。
- 修改业务字段后取消原确认；用户应确认最终字段。若请求同时修改并确认，确认绑定该请求最终字段版本。

### 8.3 重试与提交约束

- 全部图片上传完成后才创建任务；默认最多 9 张。Worker 对整个批次领取锁、设置租约和 generation，一次请求包含全部图片，整批原子成功或失败，不拆图请求。
- Prompt 联合阅读滚动截图，重叠的同订单同商品行只提取一次；同款不同订单分别保留，无法确定重复时保留。模型返回 source_indexes（从 1 开始），校验后映射为 source_ids；整单取消/全额退款及对应赠品跨图过滤。
- 创建后图片集合不可变。失败可使用同一批图片整批重试，或在前端重新选择并创建新任务；不允许逐图替换、追加或移除。已有人工修改或保存结果的任务不可重新识别。
- 处理中和失败时 entries 为空；需要手动添加时进入普通表单。后台迟到响应、租约重领的旧响应及权限撤销后的结果不可发布。
- 前端选图、上传缓存、表单及幂等键仅保存在本页面内存，不恢复历史任务；切后台保留当前内存，暂停轮询和进度动画。返回时只查询未完成任务，离开页面则清空并尽力取消；已保存物品不受影响。
- 进度分为上传 0–30%、排队 30–40%、识别 40–95%、有效结果 100%；阶段内估算，不显示虚构剩余时间。完成后只显示物品表单，无原图或识别说明入口。
- 只有 included=true、confirmed=true、重复决定已完成的条目可以新建；名称或日期等校验不通过返回对应条目错误。
- 「转手输」沿用原 entry_id：通过 PATCH 保存手动字段和 `input_mode=manual`，核对确认后走同一 commit 接口。manual 条目可不等待来源识别成功，但仍校验金额日期、权限和重复决定。正式物品创建与 saved_item_id 回写在同一事务完成；不要绕过导入关联直接调用普通建档接口。
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

`GET /ledger`、`POST /ledger/commands` 是原先预留的演示契约，不再使用。阶段 A 已接入下述资源接口、分页和独立统计；阶段 B 已接入真实任务，阶段 C 仍待实现：

1. 登录态、token 刷新与错误处理接入 services。
2. snake_case、整数分、日均十进制字符串和 file_id 与现有类型做显式转换。
3. 全量 Ledger 模式改为按空间分页列表、详情和独立 summary/analytics 查询；仅替换 services 不足以完成分页改造，store 和页面加载流程也需调整。
4. 写入成功刷新受影响的物品、汇总和历史；迁移同时刷新来源和目标空间。
5. 替换固定 AI 示例、本机 LOCAL 邀请及 DEMO-FAMILY 逻辑，使用真实任务状态及邀请预览/接受流程；整批识别、退出清空和逐件保存按第 8 节执行。
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
| API13 | 多图整批识别失败并重试 | 一次请求全部图片，整批重试，不生成占位物品 |
| API14 | 导入部分保存成功后重试 | 已保存条目返回原 item_id，其余可继续保存 |
| API15 | 重复/过期/撤销的邀请 | 不重复成员；过期撤销不可加入，打开邀请不自动加入 |
| API16 | 旧 idle 数据迁移 | 变 active，计时、金额、历史、软删除标记保持，不重复迁移 |
| API17 | 分页列表与汇总 | 列表只返回当前页，汇总覆盖完整授权空间 |
| API18 | 图片 URL 过期、物品迁移、成员移除 | 可重新获取有权附件；无权用户不能获得新访问地址 |
| API19 | 整批任务并发领取、取消、租约恢复 | 同批只领取一次，旧结果不能覆盖新结果，取消不删除已保存物品 |
| API20 | 识别失败转手输，再重复批量提交 | 手动资料可保存，原条目指向同一 item_id，始终只创建一件物品 |

## 12. 待确认事项与暂缓范围

以下不应由工程实现默认为已批准产品规则：

- 回收站恢复期、永久删除权限、到期处理。确认前保留软删除，不自动清除。
- 文件数量/大小/格式限制、对象存储保留期、孤立文件清理、签名 URL 有效期。
- AI 供应商、识别超时与限流、图片是否用于训练及隐私说明；不能在未确定前承诺服务行为。
- 家庭退出、管理者转交、解散、家庭物品迁出。
- 普通表单草稿跨设备同步，以及识别任务/校对草稿保留期限。
- 登录会话有效期、生产 H5 登录方式（若后续对外提供 H5）。

金额、日期、默认持续在用、取消闲置、首页日均汇总等已确认规则不属于待确认项。后端工程师可先实施阶段 A，同时将以上决策项列入联调准备清单。
