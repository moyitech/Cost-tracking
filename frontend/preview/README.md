# AI 识别动效对比

在 `frontend` 运行 `npm run preview:ai`，打开 http://127.0.0.1:10089/ 。
`npm run build:ai-preview` 输出静态网站到项目的 `output/ai-design-preview`，通过 HTTP 服务查看。

预览直接复用 `RecognitionMotion` 和 `DuplicateNotice`，仅将 Taro 的 View/Text/Button 映射到 HTML 元素；没有账户、上传、存储或业务接口请求。上传场景使用可暂停的模拟计时，不会自动跳到识别场景，便于观察满进度状态。

- 三种方案：`scan` 扫描成卡、`orbit` 流光核心、`objects` 灵动小物。
- 共用接口：`variant`、`paused`、`complete`。隐藏预览页时暂停；系统减少动态效果时静态展示。
- 正式导入页已选用 `scan` 扫描成卡方案。页面隐藏或进度查询出错时暂停，真实识别完成时展示完成状态；其余方案保留在对比页。
- 重复提示已接入正式导入页。选择新增只修改本地决定，保存仍经过现有服务端重复校验。
- 对比页支持暂停、重播、场景切换、单独放大，以及重复提示的选择、跳过、禁用与大字号预览。

本轮验证截图、浏览器检查脚本与录屏位于 `output/ai-design`。浏览器验证覆盖 320 / 390 / 1280px、动画播放和暂停、减少动态效果、后台暂停、对话框焦点恢复及重复提示操作。微信小程序已通过编译；真机动画表现仍需在微信设备上复核。

小程序样式修改后运行 `npm run build:weapp && npm run check:wxss`。后者调用微信开发者工具自带的原生样式编译器（非默认安装位置可设置 `WXSS_COMPILER`），检查 Taro 打包不会发现的 WXSS 语法错误。共享样式使用显式类名：无前缀的伪类可能被 WXSS 拒绝，通配选择器可能被 Taro 丢弃。
