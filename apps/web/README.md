# X-Synth 工作台

当前版本由仓库根 VERSION 定义，为 0.1.0。这里延续 ASKCOS Vue UI，不创建第二个前端。
上游 MIT 协议和版权保留在 LICENSE，Ketcher/JSME 等资源保留各自的协议。

唯一依赖管理器为 npm，锁文件为 package-lock.json，需要 Node.js 24。
```bash
npm ci
npm test -- --runInBand
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
