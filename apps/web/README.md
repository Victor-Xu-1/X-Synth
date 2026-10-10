# X-Synth 工作台

当前版本由仓库根 VERSION 唯一定义。这里延续 ASKCOS Vue UI，不创建第二个前端。
上游 MIT 协议和版权保留在 LICENSE，Ketcher/JSME 等资源保留各自的协议。

唯一依赖管理器为 npm，锁文件为 package-lock.json，需要 Node.js 24。
```bash
npm ci
npm test -- --runInBand --runTestsByPath src/plugins/icons.test.js src/plugins/icon-source-policy.test.js
npm run build
```

正式 host 由产品 API 统一提供 dist 和 /api/v1，见根 README 和 docs/operations.md。
开发模式：
```bash
VITE_X_SYNTH_API_TARGET=http://127.0.0.1:8769 npm run dev -- --host 127.0.0.1
```
所有业务请求均进入产品 API，不直接请求 ASKCOS 9100 或其他模型端口。

原生引擎源码位于 apps/askcos-v2。新的页面能力必须有真实后端能力对应；
未安装的模型不能用模拟结果替代。状态模型、历史分页、请求诊断和监测转换位于
src/common，页面只负责交互和呈现。任务取消、恢复及最终状态由服务端决定。

工作台图标由 src/plugins/icons.js 统一配置，使用同版本 @mdi/js 的按需 SVG 路径，
不加载全量图标字体。新增图标须在 icons-catalog.js 显式命名导入并登记；图标覆盖测试
核对 Vue 模板、脚本中的静态与动态选项、原生 Vuetify 别名及真实渲染属性。
页面仅通过 v-icon 或控件的 icon 属性使用登记名称，不能添加 mdi 字体类、全库导入、
手写路径或未知图标的静默替代。Ketcher 等第三方绘图资源保持独立。
