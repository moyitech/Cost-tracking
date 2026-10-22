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
- 前端采用 Taro + React + TypeScript + SCSS，按需使用 NutUI React Taro；后端计划采用 Python / FastAPI。
- 各目录中的 `.gitkeep` 用于保留空目录；添加实际文件或运行要求空目录的脚手架时可删除。
- 本地环境变量放入 `.env`，可提交不含真实密钥的 `.env.example` 作为配置说明。
- 依赖目录、虚拟环境和构建产物不提交，依赖声明及锁文件应提交。

## 前端预览

在 `frontend` 中执行 `npm ci`、`npm run dev:h5`，打开 http://127.0.0.1:10086/。
微信开发执行 `npm run dev:weapp`，用微信开发者工具导入 `frontend` 文件夹。
目前使用本地持久化 mock 数据，具体功能与后端接入边界见 [前端说明](frontend/README.md)。

## 产品与接口文档

- [产品 PRD](docs/PRD.md)：产品范围、成本口径及验收标准。
- [后端 API 需求与联调约定](docs/API_REQUIREMENTS.md)：接口清单、字段、权限、并发与幂等、实施顺序及待确认事项，可交给后端工程师实施。

- [前端 Mock 功能与验收说明](docs/FRONTEND_MOCK.md)：可操作范围、演示步骤与当前边界。

- [多尺寸显示适配与验收记录](docs/RESPONSIVE.md)：手机、折叠屏、平板的布局策略和验证范围。
