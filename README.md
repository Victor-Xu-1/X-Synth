# X-Synth

X-Synth 是基于 ASKCOS V2 的多语言合成研究工作台，默认英语，支持切换简体中文。X-Synth 负责前后端、
任务生命周期、私有历史、统一商业库存和路线审查；ASKCOS 负责实际化学模型与搜索。
当前只有 ASKCOS 是已集成的路线生成引擎，LLM 和其他引擎不参与主链。

## 模块与文件

- `VERSION` 是唯一产品版本来源；每合并一个主线 PR 自动加一个补丁号，补丁满 100、次版本满 10 时进位。详见[版本管理](docs/operations.md#版本管理)。
- `apps/web` 是原 ASKCOS Vue 工作台的延续，不是第二套 UI。
- `apps/api` 是唯一产品 API，公开契约为 `/api/v1`。
- `packages/orchestrator` 管理 SQLite 事务队列、恢复和路线工作流。
- `packages/adapters/askcos` 隔离原生服务、HTTP、子任务和搜索图断点。
- `packages/adapters/optimization` 隔离 BayBE 实测实验优化及其独立运行环境。
- `packages/chemistry` 承担确定性的结构描述符、物料核算和重原子来源检查。
- `packages/adapters/stock` 管理结构级采购证据和不可变 SQLite 索引。
- `packages/route_schema`、`route_pool`、`validation` 管理统一结构和审查。
- `packages/knowledge_base` 管理模板来源、索引与查询，不替换训练模型的输出排序。
- `packages/workspace` 管理路线文档、研究记录、图结构校验、版本冲突和计算结果来源。
- `apps/askcos-v2` 保留完整原生源码，原生功能的可用性取决于实际安装的模型。
- `scripts/operations`、`data_import`、`diagnostics` 分别承担运行、导入和验证。

模型、供应商数据、数据库卷、任务、日志、截图与缓存都保存在源码目录之外。
详细链路、边界和性能契约见 [架构](docs/current-architecture.md)。
软件接入状态与逐层操作链路见 [工作区交互](docs/workspace-workflows.md)。

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
开发时可以使用 `uvicorn apps.api.app:create_app --factory` 和 `apps/web` 的 Vite 服务，
但前端所有业务请求仍只进入产品 API。原生模型端口不作为浏览器业务入口。

## 工作区流程

侧栏提供路线设计、任务与路线、原料检索、反应与条件、结构工具、工艺核算和实验优化；
环境部署位于左下角。按化学对象合并小功能，未就绪能力不占菜单。
反应与条件采用结构输入和右侧参数区，真实 NNv1 推荐条件，Graph2SMILES 生成产物候选，
经过重原子来源检查与独立 FF 评分排序。两种评分分开显示，不作为实验成功率。
杂质候选使用原 ASKCOS 五种反应组合模式，并执行 RXNMapper 原子映射检查；
已知主产物、预测结构、模型评分和映射置信度分别保留，不将候选当作实测杂质或含量。
结构工具包含 SA Score、SPS/nSPS、Bertz CT、分子描述符、SCScore 和绘图；不是完整路线认证。
工艺核算计算实际录入批次的质量、收率依据与 PMI，不预测工业放大。
实验优化以 BayBE / BoTorch 根据显式选择的实测 CSV 记录推荐下一批离散条件，
区分后验预测与实测响应，不用模拟实验或未测标签训练。
计算记录在 `/analyses` 按类型查询，完整输入、模型版本和结果受同一产品身份保护。
服务中断的短计算记录保留输入并标为已中断，不能伪装成完成；恢复路线仍沿用原队列和 checkpoint。
路线设计 `/` 是结构优先工作台，绘图板与搜索配置并列，
路线搜索、一步分析和导入路线在同一页面切换。旧 `/retro` 重定向到一步分析，
不保留第二套输入和执行逻辑。搜索预算以分钟填写，原 API 仍接收秒。
分子结构支持绘图、SMILES 和 MOL/SDF/SMILES 文件；多记录文件先预览并选择化合物。
路线文档导入仍仅支持 X-Synth JSON，不把单个化合物文件误当成完整路线，未提供 CDX 导入。

任务历史 `/results` 支持持久分组、全库名称/结构/状态筛选、结构卡片与紧凑列表、
批量移组、可恢复回收箱、参数详情、预览与重新搜索预填。历史显示元数据与原搜索输入、
运行状态和 worker revision 分开；页与计数同一事务，返回与刷新保留筛选。重新搜索不会自动提交。任务详情
`/results/:id` 显示真实状态与候选。结果页的“编辑副本”创建独立路线文档，
不会改写模型生成的原始结果。文档在 `/documents` 预览，在 `/editor/:id`
打开、编辑、保存和导出。旧 `/network` 链接仅重定向，不保留第二套图编辑器。
预览与详情共用完整路线列表、多选路线标签、图形、步骤、条件参考与物料清单；
筛选排序不会改变编辑副本的原始路线索引。原料按需批量核对真实目录快照。
路线图 PNG、起始原料 CSV 与可重新导入的 X-Synth JSON 使用同一导出契约。

专利参考反应 `/references` 使用真实 `USPTO_FULL` 结构索引与原始反应记录，
保留专利、段落、年份和实际抽取收率。原始输入回显与 canonical 结构分别绑定，
同位素、电荷、立体化学和盐组分不混淆；只有完整反应物身份相同时标为全反应一致。
缺失实验条件保持为空，不能以 NN 预测充当文献条件；没有索引或资料时不启用检索。
支持完整参考反应的预览确认、载入同一 Ketcher 画板与 RXN 导出；保留全部产物及试剂，
不自动执行模型，不把编辑后的反应标为已实验验证。

路线预览与编辑统一使用 Vue Flow，Dagre 负责自动布局，RDKit 负责结构绘图和
结构校验，Ketcher 负责分子绘制。编辑支持拖动、连线、添加或删除节点、撤销重做、
备注、继续一步逆合成，以及 JSON 和完整路线 PNG 导出。手动补充步骤按产物和反应物
录入整条反应，不再创建孤立反应节点。分子可另行导出 MOL/SDF/SMILES；反应可行性页
可读取单反应 RXN，分别预览反应物、产物与试剂/溶剂记录。循环或非法连接被拒绝。
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
候选来自实际安装的模板模型，以及已配置 ORD 快照中的精确产物反应记录；
两者共用一步扩展、过滤与搜索。ORD 检索权重不是神经模型置信度，原始记录一致性
也不等于当前实验条件已验证。无映射的记录首步采用保守家族合并，不用条件或
离去基团变体凑路线条数。USPTO 继续提供参考记录，不冒充已安装的逆合成模型。
每条路线检查采购证据、循环、重复步骤、模板重构一致性和首步键变化家族。
候选还要经过独立 Graph2SMILES 正向校验与反应可行性评分；默认使用模型第一名。
低于第一名的目标只在候选真实存在、FF 达标、完整身份与具备条件及正收率的 ORD 记录
一致、来源就绪且检索未截断时获得支持，并与模型第一名分别统计。
参考记录明确区分
全反应匹配、仅产物匹配与无匹配，不以模型预测冒充文献实验条件。
审查采用有限候选池上的家族轮转：一个代表失败后继续检查该家族的其他方案，
原生 cluster 仅决定候选访问顺序，不在独立审查前按家族配额丢弃备选；
预算内的全部已枚举路径继续交给统一审查。搜索统计分别保留枚举数、交付候选数
与候选预算。路径评分服务异常时明确记录基于反应可行性分数的非神经排序，
仍按高分优先，不跳过独立正向与采购闭合核验。
原生路线枚举在目标首步之间轮转；每个首步内部交错原有顺序遍历与全层 OR 轮转，
按完整源路径结构去重后占用同一个候选预算。只扩大深层覆盖会挤出原有前体组合，
因此两种访问顺序共享同一套展开和路径构建逻辑，而不是增加独立路线引擎。
每层仍受原 `max_trees` 和 `max_depth` 限制，排除祖先循环；全部前体仍按原 AND
Cartesian 顺序组合，不缓存子图或失败结果。精确终端与库存证据标准不变，未知价格
仍未知。该调整只改变有限预算内的覆盖与顺序，不保证所有旧路径保留或增加合格
化学路线，也不放宽 FF、独立正向、采购或参考记录门禁。
不再以输出条数乘固定倍数截断审查。重复的完整化学路线不重复调用模型；
未审查、结构不合格和真实预测失败分别统计，最终仍只交付合格路线。
最终检查原生源图、反应字符串、步骤依赖与实际外部原料一致性，保留同位素、
立体化学、电荷和盐组分。总步骤数不作为默认失败条件；循环和冗余合成仍被拒绝。
首轮不足时只进行一次扩大搜索。只有 3-10 条合格家族时任务才标为完成。
未闭合、服务中断和取消有独立状态，原始候选与进度保留在私有任务目录。
路线结果先封存为不可变快照，再由任务事务提交唯一发布指针；前端按快照身份
更新结果，读取失败不会伪装成空列表，也不能继续编辑过期副本。

模板重构是结构一致性检查，不等同于独立正向模型验证或实验可行性证明。
目录快照也不是实时库存、成交价格或供货承诺。实验执行和采购前仍需专业核验。
不能保证任意复杂目标都会产生三个可行路线。

性能由 `PerformanceBudget` 统一控制：一个活动任务、两种搜索并行、
每个模型服务一次执行、四个 CPU 线程、索引批量查询和缓存就绪探针。
应用生命周期负责启动前的真实就绪探针与定期刷新，刷新不延长默认十秒缓存有效期。
有效缓存读取不排队等待后台刷新；过期、身份变更或已完成的失败刷新不能保留旧的就绪结果。
健康 HTTP 探针按总时长预算执行并支持取消；应用停止与就绪缓存发布使用同一取消边界。
排队等待、模型调用与一步扩展的超时同样由该预算统一管理；网关不再沿用
短于排队时间的上游默认超时。可恢复失败保留原断点和具体依赖分类。
具体 SLO 和真实测量要求见架构文档。不会以减少化学审查来满足速度指标。

## 验证

```bash
.venv/bin/python -m pytest tests/unit/test_product_api_security.py tests/unit/test_route_request.py -q
.venv/bin/python -m scripts.diagnostics.benchmark_stock_index --index /absolute/catalog.sqlite
.venv/bin/python -m scripts.diagnostics.benchmark_platform --job-id ACTUAL_SEARCH_JOB_UUID --samples 30 --interval-seconds 2
cd apps/web
npm test -- --runInBand src/common/unified-route.test.js src/common/job-state.test.js
npm run build
npm audit --omit=dev --audit-level=high
```

验证只覆盖当前改动及其调用链；完整回归需明确授权，不作为每次改动的默认动作。
真实模型、数据库、API、Chrome、任务恢复和性能验收按受影响路径在配置好的环境执行。
单元测试或页面可打开不能证明化学路线已经闭合。测试记录与截图不提交到源码仓库。
性能采样使用正在搜索的真实任务；间隔采样覆盖多个就绪缓存刷新周期。
读取失败保留端点、HTTP 状态和安全错误分类，仍输出其他采样结果并返回非零退出码；
不重试失败读数，不把快速失败算作通过，也不保留每次读取的完整任务正文。

## 安全与许可

默认是只监听回环地址的单用户工作台，跨站请求被拒绝。共享部署必须配置
`X_SYNTH_AUTH_MODE=askcos` 并验证身份，不能直接把本地模式暴露到公网。
没有读取或复用 Codex 登录凭据。密钥与模型、供应数据的配置独立于源码。

自研代码使用 Apache-2.0，第三方代码保留原协议，见 `LICENSE`、`NOTICE`。
模型、训练数据、反应资料与供应商数据的许可独立确认，不能随源码一并公开。
回滚时使用已验证的源码 revision 和不可变资产快照，不能覆盖私人任务或数据库卷。
