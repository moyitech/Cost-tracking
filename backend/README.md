# Cost Tracking 后端

阶段 A/B/C：FastAPI + SQLAlchemy + PostgreSQL，包含个人档案与真实 AI 截图导入。Python API 和识别 Worker 分别使用 uv 运行，Compose 只运行 PostgreSQL、Redis。已实现家庭创建、邀请、成员管理、家庭昵称和个人物品迁入家庭；权限由后端校验。前端可切换 Mock/真实后端，联调说明见 [前端说明](../frontend/README.md)。

## 启动

在仓库根目录启动基础设施，然后进入 backend：

```bash
docker compose up -d --wait
cd backend
uv sync --locked
cp -n .env.example .env
# 填写 .env 的 JWT_SECRET、数据库连接和腾讯 COS 等配置
uv run alembic upgrade head
uv run python -m app
```

默认监听 `0.0.0.0:18080`，可通过 `--host`、`--port` 覆盖。本机访问 `http://127.0.0.1:18080`，局域网设备通过 `http://<本机局域网 IP>:18080` 访问。Swagger `/docs`，OpenAPI `/openapi.json`，健康检查 `/health`。应用不会启动时自动修改表结构。生产启动设置 `APP_ENV=production`，通过进程管理器运行并配置 HTTPS。

应用自动读取 `backend/.env` 的 `APP_ENV`（同名进程环境变量优先）：`development` 默认开启 FastAPI debug 和代码修改后的自动重载，未处理异常会返回调试 traceback；`test` 和 `production` 关闭 debug，默认关闭自动重载，返回统一错误响应。配置值使用完整名称 `development` / `test` / `production`。可用 `--no-reload` 临时关闭自动重载，或用 `--reload` 显式开启；这些参数不影响 debug。修改环境配置后需重启进程。

`APP_ENV=production` 时必须设置 `DEV_AUTH_ENABLED=false`；配置冲突直接拒绝启动。真实微信登录需要小程序前端提供新的 `wx.login` code。

## 测试登录与种子数据

开发环境且 `DEV_AUTH_ENABLED=true` 时注册 `POST /api/v1/auth/dev/login`：

```json
{"identity": "demo"}
```

返回 access_token、refresh_token 和用户。相同 identity 始终对应同一用户及个人空间；不同 identity 可用于测试隔离。之后携带 `Authorization: Bearer <access_token>` 请求 `GET /api/v1/spaces` 取得空间 ID。

显式创建两条示例档案（可重复执行，不重复创建）：

```bash
uv run python -m app.seed
```

access token 默认 900 秒，refresh session 默认 30 天、固定到期，刷新不会延长该会话总寿命。刷新令牌只保存 SHA256 摘要且每次轮换；重用旧刷新令牌撤销整个会话。退出立即撤销会话，每次鉴权检查数据库会话状态。前端应串行刷新，避免多个请求同时使用同一 refresh token。

## 业务契约

详见 [API_REQUIREMENTS.md](../docs/API_REQUIREMENTS.md)，运行时 OpenAPI 描述请求及响应模型。

- 创建物品、追加支出和恢复必须携带 `Idempotency-Key`；重试使用同一键、同一请求内容及原始 If-Match。
- 微信 `wx.request` 不支持 PATCH；另提供 `POST /items/{id}/update` 和 `POST /items/{id}/expenses/{expense_id}/update`，与对应 PATCH 共用实现和校验。
- 物品更新、费用更正、处置、删除、恢复须携带 `If-Match: "1"`，与当前 revision 匹配。冲突 409，缺失 428。
- 幂等记录、数据变更、版本和事件同事务提交；权限先于重放检查，重放先于版本检查。阶段 A 幂等记录暂不自动过期。
- 金额为整数分，未知为 null，日均为 Decimal 四舍五入后的元字符串。汇总前不逐项舍入。同一请求按同一个 UTC+8 日期计算。
- 列表按 `created_at DESC, id DESC`；物品历史按发生日期降序（空值最后）、操作时间及 ID 降序；空间历史按操作时间及 ID 降序。游标带签名，绑定用户、空间及筛选条件。
- 已删除档案保留原身份、费用及历史，只允许读取回收站/历史及恢复；暂无永久删除或自动清理。
- 普通 PATCH 拒绝状态、归属、版本等只读字段；修改购买日会重新验证已有费用及处置日期。

## COS 直传与直连下载

### 空间与头像

`GET /api/v1/spaces` 返回每个空间的 `avatar_file_id`、`member_count` 与非回收站 `item_count`。个人空间复用本人头像；家庭空间独立保存头像。家庭成员响应也包含成员当前的 `avatar_file_id`。

头像沿用 COS 直传流程：个人上传目的为 `personal_avatar`，只能上传到本人的个人空间；家庭目的为 `family_avatar`，上传、完成与保存均校验当前管理者权限。调用 `POST /api/v1/me/avatar` 或 `POST /api/v1/spaces/{id}/avatar`，请求为 `{ "avatar_file_id": "已完成的文件ID" }`，传 `null` 恢复默认。只接受为当前对象上传的头像，不能复用物品主图、他人或其他家庭的文件，也不能将头像关联为物品附件。

头像下载仍需登录并获取短期签名：个人头像仅本人及当前共同家庭成员可读，家庭头像仅当前家庭成员可读。更换、恢复默认或移除成员后不再向失去权限者签发新地址，已签名地址沿用现有到期机制。迁移 `a6d925c104ab` 为家庭空间增加可空头像字段，保留现有数据。

文件内容不经过后端。后端使用自己的 COS 凭证签发短期地址，不把 CAM 密钥下发给客户端。

1. `POST /api/v1/files/uploads`，传入 `space_id, purpose, name, mime_type, size_bytes`。
2. 对返回 `url` 发起 **PUT 原始文件字节**，使用返回的 headers。小程序可通过文件系统读取 ArrayBuffer，再使用 `wx.request`；不要把二进制包装成 `wx.uploadFile` 的 multipart 格式。
3. COS 返回成功后，调用 `POST /api/v1/files/{id}/complete`。后端通过 HEAD 校验大小，通过 COS 内部条件复制固定正式对象，再用数据万象 `imageInfo` 校验真实格式。后端只读取元数据，不读取图片内容。
4. complete 成功返回的 file_id 可以写入物品主图或附件。pending 文件不可关联。
5. 展示/下载时调用 `GET /api/v1/files/{id}/access`，客户端直连返回的短期 COS 地址。

COS Bucket 必须设为私有并支持 `imageInfo`。当前实现签名、上传、复制和下载均使用 HTTPS。API 默认限制单图 10 MiB、JPEG/PNG/WebP；这些是开发参数，生产限制待确认。PUT 地址不能替代产品上传限额，完成确认会重新验证实际对象。

COS CORS 为 H5 开发来源配置 PUT、GET、HEAD，允许 Content-Type；小程序将 Bucket HTTPS 域名加入 request/download 合法域名。若使用生产 CDN 域名，需要另外配置并确认签名策略。

上传签名只允许写随机临时键；正式对象使用另一个随机键，并由 COS 内部复制，因此原签名尚有效时重传也不会覆盖已关联图片。暂不自动清理临时对象和未关联对象，避免暗设保留策略。会有额外对象存储及 COS 请求成本，但无后端图片转发带宽。成员移除后不能获得新地址，已签名 URL 仍可能有效至过期（默认 300 秒）。

## 公共图片预设发布

`image_presets` 目录与按用户、空间隔离的 `files` 独立。首批卡通／实物各 10 张，物品通过 `image_preset_id` 引用；数据库约束其与 `image_file_id` 互斥。登录后可读取 `GET /api/v1/image-presets` 目录或 `GET /api/v1/image-presets/{id}/access?size=original`，下载使用 COS 签名 URL。停用只隐藏可选项，保留已有物品的显示和编辑能力。

使用当前 `.env` 的数据库与 COS 配置运行：

```bash
uv run alembic upgrade head
uv run python -m app.publish_presets
uv run python -m app.publish_presets --publish --report ../output/image-presets/cos-publication.json
```

第二步仅检查素材；第三步上传原图和 256px 缩略图，共 40 个对象，校验后一次登记 20 个目录项。默认从 `../output/image-presets/manifest.json` 读取原图清单，从前端素材目录读取缩略图，也可用 `--assets`、`--previews` 指定路径。素材不在普通数据库迁移中联网上传。发布使用独立 `image-presets/` 前缀、内容哈希对象键、禁止覆盖及校验元数据；重跑复用文件，保留停用状态。调整图像内容需使用新稳定 ID/版本。

已有 API 进程需要重启以加载新增路由。部署回退时可停用新目录项或回退前端，保留表、外键及 COS 对象，避免破坏已经保存的预设引用。

## 验证

```bash
uv run ruff check app tests migrations
uv run pytest -q
uv run alembic check
```

测试读取 `.env` 中的数据库地址，但每个测试都创建独立 `ct_test_<随机值>` schema，通过真实 Alembic 迁移建表，结束后只清理自己的测试 schema，不删除 public 表。数据库用户需有创建 schema 权限。测试覆盖成本、未知/零值、处置、删除恢复、历史、权限隔离、刷新轮换、并发版本/幂等、文件关联与异常回滚。

默认不访问真实微信、COS 或 AI，COS 使用替身。显式执行真实 COS 测试：

```bash
COST_TRACKING_LIVE_COS=1 uv run pytest tests/test_cos_live.py -q
```

真实测试直传一张小图片，验证元数据确认、下载及原上传地址不能覆盖正式文件，随后删除本次创建的测试对象；测试凭证需额外允许列举该测试前缀及删除测试对象。

## AI 截图导入

配置 `AI_ENABLED=true`、DeepSeek 密钥、`AI_BASE_URL=https://api.deepseek.com`、`AI_MODEL=deepseek-flash`。保留 `AI_THINKING_ENABLED=true`；`AI_MAX_OUTPUT_TOKENS` 留空时不发送 max_tokens。当前环境的思考开关、超时和并发配置按用户 `.env` 使用，不修改实际密钥。

先应用迁移，然后一条命令启动 API 和内置 Worker（`AI_ENABLED=true` 时生效）：

```bash
uv run alembic upgrade head
uv run python -m app
```

默认 `AI_WORKER_ENABLED=true`，无需另开终端。退出或热重载时停止领取新任务，等待当前识别完成后关闭数据库连接。识别在线程中执行，不阻塞 API 事件循环。

如以后需要独立部署，在 API 环境设置 `AI_WORKER_ENABLED=false`，再单独运行：

```bash
uv run python -m app.worker
# 调试：处理一个排队批次后退出
uv run python -m app.worker --once
```

Worker 使用 PostgreSQL 持久队列；任务创建与排队同事务，不存在数据库写入成功但队列消息丢失的问题。行锁防止重复领取，整批图片同步持有超时租约，进程中断后可重新领取，generation 校验忽略迟到结果。识别期间不持有数据库事务；取消不能撤回已发给供应商的请求，但其返回结果不会恢复取消的任务。并发数是每个 API/独立 Worker 进程的 `AI_MAX_CONCURRENCY`。多个 API 进程会各自启动队列消费者，行锁保证任务不被重复领取，但总并发会累加；独立部署时关闭 API 的内置 Worker。

图片由客户端直传 COS，Worker 只把临时签名 URL 交给 DeepSeek，不下载或代理图片。导入原图保持创建者私有，不直接作为正式物品附件；正式档案可另行添加主图和凭证。不存储模型思考内容，不自动清理导入任务或截图。

一个任务的全部图片在一次 DeepSeek 请求中联合识别，按图片输入顺序编号，滚动重叠的同订单商品只输出一次；不同订单的同款商品分别保留。模型返回 `source_indexes`，校验范围后映射为条目 `source_ids`。创建任务后图片集合固定，默认最多 9 张，不自动拆图请求。失败使用 POST `/imports/{id}/retry` + `{}` 整批重试；旧追加、删除来源与单图重试请求返回 409。处理中和失败时不创建占位条目，成功后一次发布所有结果。

前端只在本页面内存保存选图、上传缓存、预填和编辑；临时切后台保留，离开页面清空并尽力取消任务。进度按上传 0–30%、排队 30–40%、联合识别 40–95%、有效结果 100% 推进，完成后不再轮询。原图、证据说明及历史恢复入口已移除；保留字段校验、重复提示和防重复保存。后端任务与提交记录仍持久化；不自动删除 COS 历史对象。

识别 Prompt 和结果归一化位于 `app/ai.py`，使用 DeepSeek JSON Output（`response_format=json_object`）并继续校验字段类型及业务规则：

- 先区分订单卡片，再按批次内唯一 `order_ref` 关联商品与赠品；不按商品名称合并订单。`order_status=canceled/refunded` 的订单及其赠品直接过滤，不生成卡片；`refund_status=refunded` 只过滤对应商品行。同款已完成订单、部分退款及退款申请中不受影响；退款/售后按钮不是退款完成状态。
- 金额优先取本件明确实付，没有实付则取商品标价/当前展示价；未标注“实付”不能作为留空原因。`single_unit` 单价不受数量未知或多件影响，不要求用户确认数量；`line_total` 仅在数量为 1 时预填，不能把合计重复写入每件物品。完整订单明确只有一件商品时，整单实付就是本件价格；多商品或归属不明的整单合计、条件促销、划线原价不作单价；金额 0 需有金额原文或明确赠品依据。展示价通过 warnings 提示核对。
- 日期优先取购入/下单日期；没有时用同一商品已取货/已签收日期补填，并保留原文依据。预计送达、可取货、发货及售后日期不用于补填，年份不全不推测。
- 缺失原文 `evidence.text=null` 归一化为空字符串，未知名称/日期保持 null；金额仍严格要求非负整数分。看不清的赠品名称必须人工补填。
- 仅含取消/退款订单或没有可添加物品时，来源仍为 ready，返回空候选，不生成占位条目。新规则只作用于之后处理的截图，旧识别结果不会自动改写。前端隐藏旧版已跳过条目。
- AI 和手动添加共用 `ItemFields` 表单，多件通过左右滑动切换。点击“保存物品”完成该条目的确认与 commit，随后切到下一件；图片/凭证仍由客户端直传 COS，导入原图不自动绑定正式档案。

校对使用嵌套 `values`、条目 `If-Match`；小程序有 POST `/imports/{id}/entries/{entry_id}/update` 别名。手动模式仍沿用原条目，经同一 commit 接口建档。批量提交逐条独立事务，条目关联、物品和历史原子落库；不同 key 或进程中断后重试也只产生一件物品。首次请求的 key 和内容持久保存，修正失败条目后使用新 key。`GET /spaces/{space_id}/imports` 返回当前用户最近 20 个未取消批次，仅作兼容查询，前端不再恢复历史导入。

真实供应商测试只发送程序生成的虚构订单图片，结束后清理测试对象：

```bash
COST_TRACKING_LIVE_AI=1 uv run pytest tests/test_ai_live.py -q
```

2026-10-23：真实 COS → DeepSeek → 人工确认 → 幂等建档测试通过；首轮供应商请求失败，重试通过，未复现首次失败，客户端当前页面内支持重试。自动化覆盖整批领取、单次多图调用、整批失败重试、来源校验、并发提交、租约恢复、取消后的迟到结果与权限检查。

## 后续阶段

阶段 A 的小程序基础流程由用户确认验收完成；新增 AI 页面仍需真机交互验收。阶段 C 已实现并经过隔离数据库测试与 H5 联调；微信分享和跨微信账号加入仍需真机验收。正式上线前仍需确定会话、上传与保留策略，以及生产部署方案。

整批识别升级切换时，先停止旧逐图 Worker，取消遗留 queued/processing 任务（保留正式物品），再启动新版 API 和 Worker。现有表结构可表达批次租约和多图来源，无需新增迁移；禁止新旧 Worker 混跑。真实多图回归：

```bash
COST_TRACKING_LIVE_AI=1 uv run pytest tests/test_ai_live.py::test_real_overlapping_batch -q
```

## 家庭协作部署与验收

先执行 `uv run alembic upgrade head`（新增成员昵称、邀请、接受记录及移除边界），再重启 API，最后发布前端小程序构建。新接口见 OpenAPI 和 `docs/API_REQUIREMENTS.md`，旧个人空间与档案数据保留。

邀请 7 天内多人可用，默认编辑者；只有管理者能生成、查看和撤销邀请。接受需登录、预览、填写家庭昵称并明确确认。移除前生成的邀请不能让被移除成员重新加入。成员角色及本人昵称更新同时提供 PATCH 与 POST `/update`，要求 If-Match；家庭创建、生成邀请、接受、迁移要求 Idempotency-Key。

个人物品迁入家庭是一次事务内更新，不复制档案；文件授权随 FileLink 关联物品的当前空间判定，不整体修改共享文件的上传归属。已签发下载链接仍受原有短期有效期约束。家庭退出、解散、管理员转交及家庭物品迁出暂不开放。

`uv run pytest tests/test_families.py -q` 覆盖多身份、并发接受/撤销、移除后新旧邀请、角色、昵称、分页、审计、迁移重试、回滚及附件访问；测试只操作自动创建的临时 PostgreSQL schema。


### 邀请小程序码

配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，以及 `WECHAT_CODE_ENV_VERSION=release|trial|develop`（默认 release）。正式版需已发布包含邀请页的版本；体验验收使用 trial，开发验收使用 develop。服务端固定邀请页路径，凭证按有效期缓存、失效时最多刷新重试一次；微信出口需可访问 api.weixin.qq.com。

`POST /spaces/{space_id}/invitations/{invitation_id}/mini-code` 仅管理者可调用，返回 PNG base64、MIME 和邀请到期时间。无凭证或微信失败时返回可重试错误；前端仍可直接分享。每次取码重新检查邀请状态，不创建新邀请。列表／撤销 API 继续兼容，产品界面不显示其入口。

本次无数据库结构变更，新 token 长度为 32，旧 token 分享可继续预览／接受。发布先后端再前端；启动前仍按项目约定检查 Alembic head。真机需要分别验证扫码、分享卡片封面、冷启动登录及两个微信身份的确认加入，H5 不能代替。

分享封面由 `GET /api/v1/assets/invitation-cover.png` 公开提供，文件位于 `app/assets/invitation-cover.png`，部署时必须包含该文件；图片不含用户数据，分享标题动态显示家庭名。微信返回 41030 表示目标版本未发布邀请页，接口映射为 `WECHAT_CODE_PAGE_UNAVAILABLE`。本机开发可设置 `WECHAT_CODE_ENV_VERSION=develop`；开发版扫码者仍需有开发／体验权限，面向普通好友使用正式版。
