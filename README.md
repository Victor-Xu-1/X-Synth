# X-Synth v0.1.0

X-Synth 是基于 ASKCOS V2 的中文合成研究工作台。X-Synth 负责前后端、
任务生命周期、私有历史、统一商业库存和路线审查；ASKCOS 负责实际化学模型与搜索。
当前只有 ASKCOS 是已集成的路线生成引擎，LLM 和其他引擎不参与主链。

## 模块与文件

- `VERSION` 是唯一产品版本来源，当前为 `0.1.0`。
- `apps/web` 是原 ASKCOS Vue 工作台的延续，不是第二套 UI。
- `apps/api` 是唯一产品 API，公开契约为 `/api/v1`。
- `packages/orchestrator` 管理 SQLite 事务队列、恢复和路线工作流。
- `packages/adapters/askcos` 隔离原生服务、HTTP、子任务和搜索图断点。
- `packages/adapters/stock` 管理结构级采购证据和不可变 SQLite 索引。
- `packages/route_schema`、`route_pool`、`validation` 管理统一结构和审查。
- `packages/knowledge_base` 管理模板来源、索引与查询，不替换训练模型的输出排序。
- `packages/workspace` 管理独立路线文档、图结构校验、版本冲突和计算结果来源。
- `apps/askcos-v2` 保留完整原生源码，原生功能的可用性取决于实际安装的模型。
- `scripts/operations`、`data_import`、`diagnostics` 分别承担运行、导入和验证。

模型、供应商数据、数据库卷、任务、日志、截图与缓存都保存在源码目录之外。
详细链路、边界和性能契约见 [架构](docs/current-architecture.md)。

## 安装

支持 Linux / WSL、Python 3.12、Node.js 24。源码发布不包含模型或商业数据。

```bash
git clone https://github.com/Victor-Xu-1/X-Synth.git
cd X-Synth
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements/orchestrator-linux-py312.lock
.venv/bin/python -m pip install --upgrade pip==26.2.0
.venv/bin/python -m pip install --no-deps .
.venv/bin/python -m pip check
cd apps/web
npm ci
npm test -- --runInBand src/common/unified-route.test.js src/common/job-state.test.js
npm run build
cd ../..
```

原生 ASKCOS 使用独立 Python 环境，避免把大型推理依赖装入产品 API。
配置与模型安装流程见 [运行说明](docs/operations.md)。没有模型、真实数据库或有效库存时，
API 不开始路线任务，不以模拟数据、空文件或人工路线代替。

## 启动

完成模型、数据库、库存配置和前端构建后，在 WSL 使用统一入口：

```bash
.venv/bin/python -m scripts.operations.serve_platform \
  --credentials "$HOME/.config/x-synth/native.env" \
  --native-python "$HOME/.local/share/x-synth/native-env/bin/python" \
  --assets "$HOME/.local/share/x-synth" \
  --state "$HOME/.local/state/x-synth" \
  --stock-index "$HOME/.local/share/x-synth/stock/catalog.sqlite" \
  --port 8769
```

工作台与产品 API 共用 [本机入口](http://127.0.0.1:8769/)。
开发时可以分别启动 `apps.api.app:app` 和 `apps/web` 的 Vite 服务，
但前端所有业务请求仍只进入产品 API。原生模型端口不作为浏览器业务入口。

## 工作区流程

侧栏是唯一导航入口。新建任务 `/` 是结构优先工作台，绘图板与搜索配置并列，
路线搜索、一步分析和导入路线在同一页面切换。旧 `/retro` 重定向到一步分析，
不保留第二套输入和执行逻辑。搜索预算以分钟填写，原 API 仍接收秒。
导入仅支持 X-Synth JSON，不提供未经实现的 CDX 导入。

任务历史 `/results` 支持结构卡片和紧凑列表、真实状态筛选、参数详情、预览与
重新搜索预填。重新搜索不会自动提交。任务详情
`/results/:id` 显示真实状态与候选。结果页的“编辑副本”创建独立路线文档，
不会改写模型生成的原始结果。文档在 `/documents` 预览，在 `/editor/:id`
打开、编辑、保存和导出。旧 `/network` 链接仅重定向，不保留第二套图编辑器。
结果支持图形、步骤和多路线概览；筛选排序不会改变编辑副本的原始路线索引。

路线预览与编辑统一使用 Vue Flow，Dagre 负责自动布局，RDKit 负责结构绘图和
结构校验，Ketcher 负责分子绘制。编辑支持拖动、连线、添加或删除节点、撤销重做、
备注、继续一步逆合成，以及 JSON 和完整路线 PNG 导出。循环或非法连接被拒绝。
布局和备注不改变计算来源；化学结构或连接改动后，原分数与商业闭合声明失效，
文档保存为草稿。文档支持所有权隔离和乐观版本锁，不以最后一次写入覆盖其他修改。

一步逆合成、反应可行性、结构复杂度、商业原料、模板检索和结构绘制使用原生能力。
其他 ASKCOS 工具只有实际依赖已部署时才启用；未安装服务不会显示为可用工具。

环境部署 `/environments` 集中展示引擎环境、部署配置和运行监测。业务主页面使用
X-Synth 品牌和搜索策略名称；ASKCOS V2 作为当前后端引擎在环境模块展示，
实际模型和引擎来源仍保留在技术详情与结果数据。旧 `/status` 转到运行监测，
不保留独立状态页。环境接口只读且需要工作区身份，不提供网页执行任意命令或
未经实现的安装、重启、切换引擎按钮。

## 质量与性能

MCTS 与 RetroStar 在任务内独立并行；最终使用同一库存快照审查外部原料。
每条路线检查采购证据、循环、重复步骤、模板重构一致性和首步键变化家族。
首轮不足时只进行一次扩大搜索。只有 3-10 条合格家族时任务才标为完成。
未闭合、服务中断和取消有独立状态，原始候选与进度保留在私有任务目录。

模板重构是结构一致性检查，不等同于独立正向模型验证或实验可行性证明。
目录快照也不是实时库存、成交价格或供货承诺。实验执行和采购前仍需专业核验。
不能保证任意复杂目标都会产生三个可行路线。

性能由 `PerformanceBudget` 统一控制：一个活动任务、两种搜索并行、
每个模型服务一次执行、四个 CPU 线程、索引批量查询和缓存就绪探针。
具体 SLO 和真实测量要求见架构文档。不会以减少化学审查来满足速度指标。

## 验证

```bash
.venv/bin/python -m pytest tests/unit/test_product_api_security.py tests/unit/test_route_request.py -q
.venv/bin/python -m scripts.diagnostics.benchmark_stock_index --index /absolute/catalog.sqlite
cd apps/web
npm test -- --runInBand src/common/unified-route.test.js src/common/job-state.test.js
npm run build
npm audit --omit=dev --audit-level=high
```

验证只覆盖当前改动及其调用链；完整回归需明确授权，不作为每次改动的默认动作。
真实模型、数据库、API、Chrome、任务恢复和性能验收按受影响路径在配置好的环境执行。
单元测试或页面可打开不能证明化学路线已经闭合。测试记录与截图不提交到源码仓库。

## 安全与许可

默认是只监听回环地址的单用户工作台，跨站请求被拒绝。共享部署必须配置
`X_SYNTH_AUTH_MODE=askcos` 并验证身份，不能直接把本地模式暴露到公网。
没有读取或复用 Codex 登录凭据。密钥与模型、供应数据的配置独立于源码。

自研代码使用 Apache-2.0，第三方代码保留原协议，见 `LICENSE`、`NOTICE`。
模型、训练数据、反应资料与供应商数据的许可独立确认，不能随源码一并公开。
回滚时使用已验证的源码 revision 和不可变资产快照，不能覆盖私人任务或数据库卷。
