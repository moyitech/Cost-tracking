# Cost Tracking

耐用品价值管理项目，支持个人空间和家庭空间，围绕物品的购入、持有、维护和处置记录成本与价值。

## 目录结构

```text
Cost-tracking/
├── frontend/     # 微信小程序前端
├── backend/      # Python 后端
├── docs/         # 产品、设计与接口文档
├── output/       # 本地报告与预览图，不纳入 Git
├── .gitignore
└── README.md
```

## 开发约定

- 前后端共用根目录的 Git 仓库，子目录不再单独初始化 Git。
- 前端采用 Taro + React + TypeScript + SCSS，按需使用 NutUI React Taro；后端采用 Python / FastAPI。
- 各目录中的 `.gitkeep` 用于保留空目录；添加实际文件或运行要求空目录的脚手架时可删除。
- 本地环境变量放入 `.env`，可提交不含真实密钥的 `.env.example` 作为配置说明。
- 依赖目录、虚拟环境和构建产物不提交，依赖声明及锁文件应提交。

## 前端预览

在 `frontend` 中执行 `npm ci`、`npm run dev:h5`，打开 http://127.0.0.1:10086/。
微信开发执行 `npm run dev:weapp`，用微信开发者工具导入 `frontend` 文件夹。
阶段 A 个人档案和阶段 B 截图导入已接入真实后端，可通过环境变量切回本地 Mock。H5 使用开发测试身份，小程序使用微信登录，配置与验收边界见 [前端说明](frontend/README.md)。

## 本地后端基础设施

Docker Compose 仅运行 PostgreSQL 和 Redis；Python 后端在宿主机使用 uv 运行。
在仓库根目录执行：

```bash
docker compose up -d --wait
docker compose ps
```

配置复用本地已有的 `postgres:17`（检查时为 17.5）和 `redis:7.0-alpine`（检查时为 7.0.15）镜像；仅在镜像不存在时拉取。镜像标签不是补丁版本锁定，后续主动拉取可能更新实际补丁版本。

| 服务 | 宿主机地址 | 默认配置 |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:25473` | 数据库及用户名 `cost_tracking`，密码 `cost_tracking_local` |
| Redis | `127.0.0.1:26381` | 本地开发不设密码，启用 AOF 持久化 |

端口仅绑定本机，以上凭证仅用于本地开发。默认配置可直接启动；需要覆盖时，将根目录 `.env.example` 复制为 `.env` 后修改。Compose 读取根目录 `.env`，未来 Python 应用的 `backend/.env` 需单独配置，两者不会自动同步。

宿主机 Python 应用使用的默认连接地址：

```dotenv
DATABASE_URL=postgresql+psycopg://cost_tracking:cost_tracking_local@127.0.0.1:25473/cost_tracking
REDIS_URL=redis://127.0.0.1:26381/0
```

修改端口或凭证后，需要同步修改应用连接地址。PostgreSQL 的初始化环境变量仅在数据卷首次初始化时生效；已有数据库的用户和密码需通过 SQL 修改。

数据保存在 `cost-tracking` 项目专属的命名卷中，不复用其他项目的数据库。日常停止使用 `docker compose stop`；`docker compose down` 移除容器但保留数据卷。不要在需要保留数据时使用 `docker compose down -v`。

## 后端环境变量准备

后端配置模板见 [backend/.env.example](backend/.env.example)。在仓库根目录执行以下命令准备本地配置（已有文件时不会覆盖）：

```bash
cp -n backend/.env.example backend/.env
```

- 数据库和 Redis 地址已对应 Compose 默认端口；生成并填写 `JWT_SECRET`。
- 真实微信登录需要 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`；仅开发环境可启用测试登录。
- 文件存储使用腾讯云 COS，上传前填写 `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_REGION` 和 `COS_BUCKET`，使用私有 Bucket；临时凭证还需填写 `COS_SESSION_TOKEN`。
- 截图导入使用 DeepSeek `deepseek-flash`，开启 `AI_ENABLED=true` 并填写 AI 配置，运行 `uv run python -m app` 时自动启动后台识别，无需独立启动 Worker。默认开启思考，不传 max_tokens。

模板中的会话有效期、上传限制和签名 URL 有效期为开发建议值，不代替接口文档中待确认的生产策略。API 与 AI Worker 共用配置加载与校验。后端启动、迁移、测试和直传联调见 [后端说明](backend/README.md)。真实 `.env` 文件已被 Git 忽略。

## 产品与接口文档

- [产品 PRD](docs/PRD.md)：产品范围、成本口径及验收标准。
- [后端 API 需求与联调约定](docs/API_REQUIREMENTS.md)：接口清单、字段、权限、并发与幂等、实施顺序及待确认事项，可交给后端工程师实施。

- [前端 Mock 功能与验收说明](docs/FRONTEND_MOCK.md)：可操作范围、演示步骤与当前边界。

- [多尺寸显示适配与验收记录](docs/RESPONSIVE.md)：手机、折叠屏、平板的布局策略和验证范围。
