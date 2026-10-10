# X-Synth 运行与部署

## 支持边界

产品当前版本见 `VERSION`，支持 Linux / WSL、Python 3.12、Node.js 24。唯一产品入口是
`scripts.operations.serve_platform`，同时提供工作台、API 和 ASKCOS 进程监督。
引擎原有 Compose/deploy 工具是上游源码，不是产品启动入口。当前路线主链无需
GPT Web、Codex token、AiZynthFinder、RabbitMQ 或 Redis。其他原生功能依赖其各自服务，
未安装时不可用。源码发布不携带模型、商业数据、私人历史或个人配置。

## 版本管理

`VERSION` 是当前产品版本的唯一来源。版本采用项目指定的 PR 计数规则，而不是按变更
类型手动决定 SemVer 增幅：每个合并到 `main` 的 PR 加 1；补丁号为 0-99，次版本号为
0-9，超过范围时进位。`v0.1.99 -> v0.2.0`，`v0.9.99 -> v1.0.0`。API 协议、数据库
迁移、模型与模板版本独立管理，不能从产品版本推导兼容性或迁移顺序。

规则从启用前的 `0.1.0` / `17233bcf2d6c427fb4568552a0ba7ac1ebdce257` 主线基线开始，
不回算旧 PR。`.github/version-state.json` 只记录基线和已计数的 PR 号 / 合并提交，不是
第二个当前版本来源。未合并的关闭 PR、普通直接提交、自动版本提交不计数。

`Merged PR Version` 工作流在主线推送、PR 合并或手动重跑时执行。它只运行可信 `main`
上的代码，使用临时 Git 索引构造一个原子提交，同步 `VERSION`、前端 package/lock 根
版本和计数记录，不改动检出的文件或真实索引。Python 包从 `VERSION` 读取版本；API
运行时和前端构建同样消费该文件。合并源代码不代表旧构建资产已更新，部署必须从新的
版本提交重新构建，并核对 API 与工作台版本一致。

浏览器中长期打开的标签页仍运行加载时的资产，即使服务已升级也不会自动切换。
当前壳使用既有健康接口的版本显示新版入口；打开同站点的新标签页会读取新的构建，
旧页中的未提交输入不被自动刷新或迁移。早于该提示实现的旧标签页不具备提示能力，
应保留需用的未提交输入，并另开正式入口核对版本；不要把旧标签的外观当作新部署结果。

工作流串行执行，并扫描基线后所有主线可达的已合并 PR，避免待运行事件被替换时漏计。
重复运行不再次加号；并发合并导致推送冲突时，重新读取主线、对账后重试，最多 4 次。
权限或保护规则拒绝推送时明确失败，不强推、不绕过保护；恢复权限后在 Actions 中手动
重跑 `Merged PR Version` 即可补计，不要手改 `VERSION` 或删除计数记录。版本元数据
漂移、计数身份冲突、基线不再可达均拒绝发布，需要审查历史修复。

GitHub 的默认并发队列可能替换待运行事件，因此版本对账不依赖每个事件都执行；
内置 `GITHUB_TOKEN` 的版本提交不会递归触发普通推送工作流。
参考 [GitHub 并发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
和 [工作流触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。

## 目录与安装

| 内容                             | 建议位置                         | 规则                            |
| -------------------------------- | -------------------------------- | ------------------------------- |
| 稳定源码                         | /srv/wsl/projects/x-synth        | 不在目录名中编码版本            |
| 环境、模型、模板、库存           | $HOME/.local/share/x-synth       | 与 Git 分离；资产不可变         |
| 私人任务、路线文档、搜索图、日志 | $HOME/.local/state/x-synth       | 不公开；升级不删除              |
| 凭据                             | $HOME/.config/x-synth/native.env | 普通文件；权限 0600；不输出内容 |
| 下载、截图、审计证据             | 外部缓存/证据目录                | 不进入发布源码                  |

产品和原生路线推理是独立 Python 进程边界，各自使用一个锁文件：

```bash
python3.12 -m venv "$HOME/.local/share/x-synth/product-env"
"$HOME/.local/share/x-synth/product-env/bin/python" -m pip install --upgrade pip==26.2.0
"$HOME/.local/share/x-synth/product-env/bin/python" -m pip install \
  --require-hashes -r requirements/orchestrator-linux-py312.lock
"$HOME/.local/share/x-synth/product-env/bin/python" -m pip install --no-deps .
python3.12 -m venv "$HOME/.local/share/x-synth/native-env"
"$HOME/.local/share/x-synth/native-env/bin/python" -m pip install --upgrade pip==26.2.0
"$HOME/.local/share/x-synth/native-env/bin/python" -m pip install \
  --require-hashes -r requirements/askcos-runtime-linux-py312.lock
"$HOME/.local/share/x-synth/native-env/bin/python" -m pip check
```

条件预测的旧 Keras 序列化与路线 TensorFlow 隔离；实验优化也不改变 ASKCOS 的依赖。
每个已启用边界只使用自己的 `.in` 与生成的锁文件。可选环境未安装时隐藏相应入口，
不阻碍路线搜索，也不使用演示结果代替。

```bash
python3.12 -m venv "$HOME/.local/share/x-synth/context-env"
"$HOME/.local/share/x-synth/context-env/bin/python" -m pip install \
  --require-hashes -r requirements/context-runtime-linux-py312.lock
python3.12 -m venv "$HOME/.local/share/x-synth/optimization-env"
"$HOME/.local/share/x-synth/optimization-env/bin/python" -m pip install \
  --require-hashes -r requirements/optimization-runtime-linux-py312.lock
python3.12 -m venv "$HOME/.local/share/x-synth/impurity-env"
"$HOME/.local/share/x-synth/impurity-env/bin/python" -m pip install \
  --require-hashes -r requirements/impurity-runtime-linux-py312.lock
"$HOME/.local/share/x-synth/context-env/bin/python" -m pip check
"$HOME/.local/share/x-synth/optimization-env/bin/python" -m pip check
"$HOME/.local/share/x-synth/impurity-env/bin/python" -m pip check
```

监督器在条件服务内设置 `TF_USE_LEGACY_KERAS=1`，不对其他服务启用。
BayBE 使用一个受限 CPU 子进程执行一次计算；环境探针单独缓存，不在每次全局健康读取时导入 Torch。
条件、正向和杂质模型进程只继承明确的路径与资源配置，不继承 Mongo、API 或 Hugging Face 凭据。
它们使用各自的私有 HOME/cache，禁止用户 site-packages；这不是同 UID 文件系统或操作系统网络沙箱。
托管原生调用的默认预算为：排队等待 120 秒、每次模型 RPC 180 秒、一次一步扩展
600 秒。对应 `X_SYNTH_NATIVE_QUEUE_WAIT_SECONDS`、`X_SYNTH_MODEL_TIMEOUT_SECONDS`、
`X_SYNTH_EXPANSION_TIMEOUT_SECONDS`；只允许正的有限值，并要求模型预算大于
排队预算、扩展预算覆盖两次模型调用和后处理。它们是故障/资源边界，不减少
模板数量、过滤阈值或科学审查。健康探针仍采用独立短预算，不等待推理完成。
杂质分析使用一个驻留 CPU 映射进程，执行原 ASKCOS 五模式；FF、正向序列评分、
原子映射置信值与结构相似度分别保留，已知主产物是用户参照，不是实验确认结果。

### 原子映射安全边界

RXNMapper 0.4.3 的官方依赖声明要求 Transformers <5，不能强装 v5 后忽略 `pip check`。
该隔离锁文件的包级审计仍包含 7 个独立 advisory，不能宣称零漏洞或上游问题已经修复。
当前支持边界是可信本机源码/模型目录、回环服务和受限化学输入；不接受外部 checkpoint、
模型路径、Hub 仓库、训练、生成或保存指令。模型目录不得由不可信主体写入。

| 上游 advisory | 本产品执行边界 |
|---|---|
| CVE-2026-4372 | 共享加载代码会执行；固定官方配置/权重、ALBERT 与 eager，禁止远程代码/在线加载，不能仅凭 weights-only 声称修复 |
| CVE-2026-1839 | 不调用 Trainer RNG 恢复；Torch 2.14.1 不满足公告的 <2.6 前提 |
| CVE-2026-5241 | 不加载 LightGlue 或嵌套 AutoConfig |
| CVE-2026-80047 | 不调用 custom generation；五模式不是 Hugging Face generate 接口 |
| CVE-2026-9856 | 不调用 save_pretrained 或聊天模板保存 |
| CVE-2025-14929 | 不执行 X-CLIP checkpoint 转换 |
| CVE-2025-69872 | 实际映射调用链不使用 DiskCache 的磁盘 pickle 缓存；保留传递依赖审计记录 |

官方兼容性进展见 [RXNMapper v5 支持讨论](https://github.com/rxn4chemistry/rxnmapper/pull/81)。
引入任意模型、在线代码、缓存导入或不可信文件写入前必须重新审查；公网/多租户部署还需要
独立 UID、文件系统和出站隔离，不能将本机环境白名单当作完整沙箱。审计证据保存在外部证据目录。

## 数据与模型

操作员应取得合法资产并核对许可、SHA256，不得用空文件或模拟内容冒充。路径相对 assets 根：
| 路径 | 内容 |
|---|---|
| models/template-relevance/pistachio | 权重、匹配的 templates.jsonl、asset.json |
| models/template-relevance/pistachio_ringbreaker | 环断裂模型及匹配模板 |
| models/fast_filter/1 | 原生 TensorFlow SavedModel |
| models/pathway_ranker/treeLSTM512-fp2048.pt | 原生路线排序权重 |
| models/value_network/epoch_99.pt | RetroStar 价值网络 |
| models/scscore/model_1024bool.npz | 安全转换后的数组，运行时不执行 pickle |
| models/context/v1 | model.json、weights.h5、五份原始标签字典、EHS 表、asset.json |
| models/forward/USPTO_STEREO | Graph2SMILES model.pt、vocab.txt、asset.json |
| stock/catalog.sqlite | 精确结构和供应商目录证据的不可变索引 |

安装工具：

```bash
python -m scripts.data_import.install_askcos_model --help
python -m scripts.data_import.convert_scscore_model --help
python -m scripts.data_import.compile_stock_index --help
python -m scripts.data_import.compile_template_library --help
```

NNv1 的发布源是 ASKCOS `context_recommender/scripts/download_trained_models.sh` 中的 v1 压缩包。
用安装器的 `--archive-format tar --member-prefix v1 --members ...` 明确选择八个文件，
核对压缩包 SHA256 `409d8be4a95bac701021e799d3c4af1b65fcf7e993b09d00402b114fd59426ce`。
Graph2SMILES 的发布源是其下载脚本内的 USPTO_STEREO.mar；按 ZIP 安装仅选择 model.pt 与
vocab.txt，SHA256 为 `e5bde90a4cb2485408358cc39f1b7405780f20f2336a3580fbb60d4100a1fdd1`。
模型代码随源码提供，运行时不解压或执行模型包里的 Python，也不加载未受限的 pickle 对象。
模型资产仍不随 Apache-2.0 源码公开。

训练类别顺序与模型模板不可分离。统一知识索引可管理 ORD/USPTO 等合法语料，但不会
自动让不兼容模板成为训练模型的输出。商业证据不能只凭 CID、CAS 或供应商名字。

已配置的 `X_SYNTH_REACTION_LIBRARY_DB` 同时用于原生一步扩展和审查。
一步扩展按精确产物召回 ORD 原始反应物，不把条件变体当作不同路线，也不把
检索排序权重显示成模型置信度。原始试剂/溶剂保留独立角色；原生搜索无法保留的
断连化合物分组不会被拆成新的可采购前体。精确来源一致性不代替 Graph2SMILES
独立正向预测、FF、商业闭合和图结构审查。默认要求模型第一名；非第一名只有在
目标确实出现在正向候选、FF 达标，且完整身份对应具备正收率和条件的真实 ORD 记录时
才可获得文献支持。检索截断、来源不可用、仅产物匹配、未知/零收率不能走此分支。
审查记录分别显示模型首选与文献支持，不把旧实验当作当前实验已验证。
没有原子映射/模板依据的记录首步采用
保守家族合并，不能据此凑够三条不同断键路线。
搜索身份包含实际 ORD 文件字节摘要，健康检查核对搜索端与审查端的快照一致性。
配置源丢失、被替换或不一致时不开始任务；未配置 ORD 时两端均不启用此候选源。
现有 USPTO 仍用于来源受限的参考检索，不启用旧的无界 exact-match 服务。

Mongo 使用受支持版本、回环端口和独立数据卷；本机集成端口 27018。旧库恢复必须先
逻辑备份、恢复新卷、验证集合数量/索引/完整性/查询，原恢复卷不改写。容器 running
不代表端口可连接，须核对命名网络和实际连接。模型启动不得清空数据库。

## 配置与启动

首次生成配置不会覆盖已有凭据；Mongo 初始化和原生应用使用同一私有文件中的配置：

```bash
python -m scripts.operations.bootstrap_runtime_config \
  --output "$HOME/.config/x-synth/native.env"
cd apps/web
npm ci
npm run build
cd ../..
python -m scripts.operations.serve_platform \
  --credentials "$HOME/.config/x-synth/native.env" \
  --native-python "$HOME/.local/share/x-synth/native-env/bin/python" \
  --assets "$HOME/.local/share/x-synth" \
  --state "$HOME/.local/state/x-synth" \
  --stock-index "$HOME/.local/share/x-synth/stock/catalog.sqlite" \
  --template-library "$HOME/.local/share/x-synth/knowledge/template_library.sqlite" \
  --port 8769
```

启动前选空闲端口。监督器只管理自己创建的进程，故障服务最多重启三次，不使用全局
pkill。每模型一个 worker、统一 CPU 线程预算。WSL 长任务应留在持久终端或管理服务中。

选择框语义适配由 `apps/web/tooling/vuetify-control-plugin.js` 注册，
`vuetify-control-semantics.js` 保存已审查的版本和原始源码校验值。升级 Vuetify 时必须先
检查其原生输入、标签、错误反馈和菜单行为，再更新对应回归；不得只改校验值让构建通过。
上游完整修复后应删除对应适配与不再需要的构建依赖，保留真实组件和浏览器回归。
开发服务和缓存重建同样应用该检查，不使用安装后补丁或运行时 DOM 修改。

升级涉及前端依赖时，先按已核验提交的 `apps/web/package-lock.json` 在独立 Node 环境
执行 `npm ci` 并构建，不在正式服务或其他任务共用的 `node_modules` 上直接安装。
核对新环境的锁文件与目标提交一致后，等待任务队列空闲、备份私有库，保留旧依赖目录
及旧构建资产，再切换正式依赖和源码。部署后的 API、前端版本与 main 提交必须一致；
回滚使用保留的依赖和匹配资产，不覆盖任务、文档和研究记录。界面语言及其保存规则见
[工作台工作流](workspace-workflows.md#界面语言)。

原生地址由 `packages/platform/native_endpoints.py` 统一定义；覆盖端口时使用对应的
`X_SYNTH_*_URL`，启动、网关模块配置和就绪探针同步采用该地址。受监督部署只接受
不同端口的 IPv4 回环 HTTP 地址，不允许地址携带凭据或路径。
产品启动器自动生成只在本次运行中使用的内部搜索密钥；它不是用户登录凭据，
不写入配置、日志或 API 响应。不要通过浏览器直接调用原生搜索子任务接口。
工作台和历史分别在 http://127.0.0.1:8769/ 和 http://127.0.0.1:8769/results。

```bash
curl --fail http://127.0.0.1:8769/api/v1/health
curl --fail http://127.0.0.1:8769/api/v1/runtime
curl --fail http://127.0.0.1:8769/api/v1/environments
curl --fail http://127.0.0.1:8769/api/v1/stock-sources/summary
```

只有真实探针通过才显示 route_search_ready；端口或文档页存在不算就绪。默认本机
单用户模式拒绝跨站访问。共享部署必须用经过服务端验证的身份，不能公开本机模式。

应用启动先执行真实就绪探针，再由同一应用生命周期每半个缓存周期刷新。
默认十秒有效期不变；有效且运行身份一致的缓存可在后台刷新期间直接读取，
过期或身份变化时必须重新检查。失败不会返回过期的就绪结果。
HTTP 探针的默认两秒是连接、响应头和响应正文的总预算，不是可被持续慢速数据
延长的空闲超时。停止应用时取消自己的探针、阻止取消后的缓存发布并回收刷新线程；
意外的刷新线程异常会明确阻止就绪判断，不静默转为成功。

在已有真实任务搜索期间采样产品读取性能，不为测量重复提交任务：

```bash
python -m scripts.diagnostics.benchmark_platform --job-id ACTUAL_SEARCH_JOB_UUID \
  --samples 30 --interval-seconds 2
```

该命令只读取健康、历史和指定任务，间隔采样跨过多个就绪缓存刷新周期。
保留采样前后的实际任务阶段、成功和失败数；HTTP、协议、JSON 或任务状态形状
异常不会被重试或算作低延迟成功。失败报告只包含端点、HTTP 状态和安全错误分类，
不包含服务器正文、凭据或原始异常消息。任一预热、采样或最终任务读取失败都返回
非零退出码；部分结果仍可用于诊断，不能据此宣称整体性能已通过。
一次瞬时采样通过不能替代长窗口验收，性能通过也不是化学可行性证明。

环境部署界面在 `/environments`：引擎环境读取实际接入的 ASKCOS V2，
部署配置显示产品版本、提交、访问模式及库存绑定，运行监测复用就绪探针、进程内存
和统一资源预算。旧 `/status` 重定向到监测页。环境 API 在共享部署中同样需要身份，
不返回凭据文件、连接口令或完整环境变量。该模块只读；安装、启动和重启仍使用
本节的统一运维入口，不提供网页系统命令接口。
研究计算环境分别列出 BayBE / BoTorch、RDKit 评估与批次核算。安装路径与登录凭据不返回浏览器。
条件与正向服务端口为 9901、9911；浏览器只调用 `/api/v1/conditions/predict` 和
`/api/v1/reactions/predict`，不直接连接模型端口。
杂质模型端口为 9941；浏览器只调用 `/api/v1/impurities/predict`。旧条件、正向与杂质
通用模型转发返回 410 及对应产品入口，不继续转发到旧端口或绕过研究记录。

## 持续运行

WSL 关闭后所有进程都会退出，持久终端不能替代服务管理。启用 WSL systemd 后，
使用 `scripts/operations/systemd/x-synth@.service` 管理同一产品入口，不另开第二条链路。
在 `$HOME/.config/x-synth/service.env` 设置下列绝对路径，权限保持 0600：

```dotenv
X_SYNTH_CREDENTIALS=/home/USER/.config/x-synth/native.env
X_SYNTH_NATIVE_PYTHON=/home/USER/.local/share/x-synth/native-env/bin/python
X_SYNTH_ASSETS=/home/USER/.local/share/x-synth
X_SYNTH_STATE_DIR=/home/USER/.local/state/x-synth
X_SYNTH_STOCK_INDEX=/home/USER/.local/share/x-synth/stock/catalog.sqlite
X_SYNTH_TEMPLATE_LIBRARY_DB=/home/USER/.local/share/x-synth/knowledge/template_library.sqlite
```

将 USER 换为运行用户，资产路径必须指向实际验证的索引，不得复制空示例充当数据。
服务模板的源码位置默认 `/srv/wsl/projects/x-synth`，其他位置需显式修改 WorkingDirectory。

```bash
sudo install -m 0644 scripts/operations/systemd/x-synth@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now "x-synth@$USER.service"
systemctl status "x-synth@$USER.service"
```

独立 Mongo 容器应配置 `--restart unless-stopped --network x-synth-native`，
创建并验证该命名网络。不要依赖可能被禁用的默认 bridge，也不要只在启动后附加网络。
核验回环连接与命名网络；
该产品服务不创建或改动其他数据库容器。人工停止任务仍由产品取消操作处理。
产品日志写到外部状态目录 `logs/product.log`，每文件最多 5 MiB，保留三个轮转文件，
不依赖终端持续读取。原生服务日志在 `logs/native`，同样采用有界轮转。
运行代际、启动身份和继承锁共同确定进程归属；未知旧记录不能用作杀进程依据。
数据库健康探针超时返回 503，
不把失联库视为就绪。systemd 不能使已关闭的 WSL 自行启动；先启动 WSL，再检查服务。

产品进程组默认 `MemoryHigh=7G`、`MemoryMax=8G`，适用于至少 12 GiB 的 WSL。
小内存机器应减少模型并行度或扩容；大内存机器可由运维用 systemd override 调整，
不要移除保护。`OOMPolicy=continue` 使单个搜索子进程被杀时不连带停止 API，
监督器最多重启该服务三次；任务进入可恢复状态，不被标成完成。
`/api/v1/runtime` 的 `resources.cgroup` 显示真实进程组当前/峰值/上限内存及 OOM 事件，
与原生进程 RSS 区分。未知值为 null，不以 0 表示成功。

## 任务、恢复、历史

UI 和诊断 CLI 都通过 /api/v1/unified-route/call-async。事务创建记录后，两种原生
策略独立执行，子任务 ID 提交前持久化。原始输出保留，搜索图在完整扩展边界定期保存
为数据 JSON，不使用 pickle。只有 3-10 条合格、不同家族的路线才标为 completed；
数量不足、未闭合、取消、依赖恢复分别有状态。只执行一次扩大搜索，不无限修复。

服务中断保留 checkpoint。恢复后接续同一子任务，不能重复提交已完成阶段：

```bash
curl --fail -X POST http://127.0.0.1:8769/api/v1/unified-route/jobs/JOB_ID/resume
curl --fail http://127.0.0.1:8769/api/v1/unified-route/jobs/JOB_ID
```

新任务的结果保存在 `artifacts/JOB_ID/results/SHA256/` 不可变代际目录，
任务 checkpoint 中的 `published_result` 是唯一发布依据。文件先封存，摘要与指针
再由一个数据库事务提交；未提交、取消或不完整的文件不能作为结果读取。
读取时核验文件哈希、目标身份和已提交摘要，错误返回明确状态，不回退到旧文件
冒充新结果。既有历史使用显式兼容读取，不在升级时重写或删除。
接受过的幂等请求在模型临时失联时仍可取回原任务；新任务仍须通过实际就绪检查。

升级前备份 `jobs.sqlite`、`analyses.sqlite`、`workspace.sqlite` 及当前源码 revision，
保留资产路径和哈希。停止本产品 unit 后确认其记录的 PID/启动身份均已退出，再将
没有 boot/generation 身份的旧 `native/runtime.json` 归档到私有升级目录。
新启动器拒绝自动清理这种旧记录；不能以删除锁、全局 pkill 或重启 WSL 代替归属核验。
当前模型/代码/库存语义不匹配的旧搜索图继续拒绝恢复，不编辑指纹绕过检查。

路线整理在两种策略间共享有限 AND/OR 可达性检查：反应必须全部前体可达商业终点，
无商业出口的循环不进入组合枚举；实际路线逐条生成，原始搜索图和候选仍保留。
RetroStar 未解出目标时直接输出空路线，不能花费额外资源枚举不可能闭合的组合。

RetroStar 代价回传区分局部子树代价 `rn` 和全路线优先级 `Vt`：化合物取候选反应
最小代价，反应需要所有前体代价之和。已搜索前体代价增加时也重新比较备选反应；
成功状态不依赖代价是否变化。兄弟分支只更新优先级，不改写其子树代价。
此修复改变搜索语义，旧搜索 checkpoint 必须拒绝迁移；完成已有任务后用新任务验证。
算法依据 [RetroStar 官方回传实现](https://github.com/binghong-ml/retro_star/blob/master/retro_star/alg/mol_node.py)
与 [反应优先级传播](https://github.com/binghong-ml/retro_star/blob/master/retro_star/alg/reaction_node.py)，
并保留 ASKCOS 的模型、反应代价定义、筛选与商购门槛，不引入其他搜索后端。

升级后原生 checkpoint 的代码/模型/库存指纹必须相符。仅修复路线整理逻辑时，
可显式使用 `scripts.operations.recover_native_projection`：逐文件比较搜索代码 AST，
校验真实模型和库存哈希、原请求和未完成子任务，默认只读 dry-run。
先保存一致性数据库备份并停止该产品服务，再带 `--apply` 执行；工具要求原生 worker
锁可独占，备份原 checkpoint，并以搜索数据哈希证明图、时间、迭代均未改写。
旧、新源码均须来自可信本地 checkout。任何断键/终止/搜索规则变化都拒绝迁移，
不能直接编辑指纹绕过检查。

```bash
python -m scripts.operations.recover_native_projection \
  --old-source /path/to/previous-checkout --new-source /srv/wsl/projects/x-synth \
  --assets "$X_SYNTH_ASSETS" --stock "$X_SYNTH_STOCK_INDEX" \
  --state "$X_SYNTH_STATE_DIR" --receipt-dir "$X_SYNTH_STATE_DIR/recovery" \
  --job-id JOB_ID --strategy retro_star --pass-number 1
```

成功 dry-run 后使用同一命令追加 `--apply`，启动服务并通过上述 resume API 恢复。
恢复不会清零已用搜索时间，也不会重新提交已完成策略；备份和恢复凭据留在外部私有状态目录。

轮次在提交该轮子任务前保存。第二轮只清空即时进度计数，不丢弃第一轮原始输出；
同轮恢复保留已观测进度，也不重新显示已完成的前一轮。任务详情在搜索、等待和空路线
状态仍展示实际目标结构；“等待恢复”不显示正在计算的进度条。环境监测同时展示 RSS
和产品进程组当前/峰值/上限内存，便于区分常驻模型与内存失控。

新任务保存 `search_policy_version=2`。首次搜索保持请求中的累计概率；仅在路线数量
不足时，第二轮使用 `max_cum_prob=1.0` 和扩大后的模板上限，避免单一高概率模板
提前截断备选断键。反应可行性筛选、精确库存、正向模板重建和家族去重均不放宽。
没有策略版本的旧任务按版本 1 恢复，保留其原始子请求哈希；重新搜索才采用新策略。
策略版本与产品 `VERSION` 独立。运行中的任务不能静默切换策略。

原生结果的 `build_time` 与 checkpoint 使用同一累计搜索时间，恢复后不会只报告最后
一段进程运行时间；任务总时长还包含排队、服务恢复、审查和路径投影，不能混为一谈。

处理器明确把概率 1 解释为关闭累计阈值截断、仅保留模板数量上限和模型排序，
不再让浮点累加提前达到 1 时截掉备选模板。此处理器修复属于原生语义变更，
旧原生图不能通过投影迁移工具改写指纹冒充兼容。

完整图整理在目标的首步反应分支之间逐条交替取样，防止一个分支的保护基等组合
先取满 `max_paths` 而遮蔽其它已闭合分支。内部原料分支仍保留原生顺序；数量、
步数、循环检查、商购闭合和后续质量评分不放宽。最终路线家族仍由统一路线池去重，
交替取样本身不代表这些分支全部可实验实施。

每轮审查后立即保存摘要和已合格候选，再进入第二轮；原生路径存在不等于已通过审查。
普通研究工作区增加最小明确物料范围检查：依据
[OPCW 官方清单](https://www.opcw.org/chemical-weapons-convention/annexes/annex-chemicals/schedule-1)
明确列名的三种氮芥
排除超出当前范围的目标、起始物料和中间体；目录命中不等于普通实验室可采购或可使用。
原生单步候选生成在模型调用前检查目标，在结果合并、价格查询和排序前检查原料组合；
范围外分支被直接排除，不把这些结构作为未闭合节点继续合成。最后审查仍再次检查，
不会以“原生闭合”代替普通研究范围和真实库存的交付条件。此策略文件纳入原生资产
指纹；变更不得通过纯整理迁移绕过。
盐型、同位素用于范围识别时只处理临时副本，不改写反应和库存的实际分子身份。
这不是完整 CWC 分类器或法律合规保证，也不替代研究单位的资质、采购、安全审查。
旧结果触发此检查时不再作为合格路线预览，原始输出仍留在私有状态目录供审计。
独立路线文档的创建、导入、保存也使用相同范围检查。旧文档的原图和来源证据保留，
但范围外文档不能作为来源副本正常读取或导出；使用有效修订替换原图时，原始证据
只用于私有审计，预测分数与商购闭合标签失效。

旧历史由 scripts.data_import.import_askcos_history 显式导入指定 owner，幂等且不改写
原库。legacy_completed/legacy_incomplete 不自动重跑，不代表新的商业闭合审查。
私人结果默认不能分享。

路线文档独立保存在同一状态根的 `workspace.sqlite`，不混入任务库。升级时同时备份
`jobs.sqlite`、`workspace.sqlite`、`analyses.sqlite` 及各自 WAL 状态，使用 SQLite 一致性备份接口；
不要直接复制仍在写入的单个数据库文件。文档 API 不需要模型启动才能预览或编辑，
但一步继续逆合成仍需要真实模型就绪。未保存修改有页面离开保护；版本冲突保留画布，
不能静默覆盖。计算结果编辑必须通过创建副本，不回写任务结果。

研究记录的 schema 1 与路线文档 schema 分开。服务端保存实际提交、模型/方法版本、
完成或失败结果；原始结果不可修改。正在执行的记录绑定 PID 与进程启动身份，服务中断
后保留输入并标为 interrupted。它们不冒充可断点接续的长路线搜索；重算须由用户显式提交。
CSV、模型、暂存数据与截图都不进入 Git。优化建议的实验响应留空，不将预测填写为实测收率。

路线任务库 schema 2 在同一 SQLite 内增加历史显示标题、分组、元数据修订、可恢复归档和轻量进度。
升级前停止产品写入，并通过 SQLite `Connection.backup` 在独立恢复目录保存一致性备份，
包含已提交 WAL 内容。schema 1 到 2 为原子迁移，保留原请求、事件、checkpoint 与 artifacts；
旧归档记录由最后一个非归档终态事件恢复真实状态，证据不足则拒绝整个升级。
先前版本已经改写的请求标题不能凭空恢复，原始字节按现有记录保留。
旧 schema-1 程序会拒绝 schema 2，不能修改版本号绕过。若回滚旧代码，使用升级前备份的独立状态目录，
保留升级库与后续任务，不覆盖私有数据。读库工具按 `jobs.archived` 过滤回收箱，不按执行 status 过滤。

### 公开反应证据

`/api/v1/references/status` 与 `/search` 合并原生 `USPTO_FULL` 和本地 ORD 索引。
原生来源仍需 Mongo product_smiles/记录 ID 索引，状态缓存最多 60 秒；没有 source-leading
索引时总数为 null，不扫描全库制造统计。3 秒数据库期限、300 条召回保持不变。
ORD 是单独的原始实验记录索引，不替换模板模型的训练序号；精确查询为只读 SQLite，4 秒期限。
任何单源不可用或损坏都保留明确来源状态；只有所有已配置来源均不可用才返回整体 503。
数据许可独立于源码。USPTO 原始来源见
[Daniel Lowe 数据发布](https://figshare.com/articles/dataset/Chemical_reactions_from_US_patents_1976-Sep2016_/5104873)，
ORD 数据见 [官方数据仓库](https://github.com/open-reaction-database/ord-data) 与其
[官方 Hugging Face 镜像](https://huggingface.co/datasets/open-reaction-database/ord-data)。
ORD 数据为 CC-BY-SA-4.0，不得随 Apache-2.0 源码当作同一许可发布。

ORD 当前发布格式是 Parquet。使用独立环境，避免将 protobuf/Arrow 依赖安装进模型或产品环境：

```bash
python3.12 -m venv "$HOME/.local/share/x-synth/reaction-data-env"
"$HOME/.local/share/x-synth/reaction-data-env/bin/python" -m pip install \
  --require-hashes -r requirements/reaction-data-linux-py312.lock
"$HOME/.local/share/x-synth/reaction-data-env/bin/python" -m pip check
"$HOME/.local/share/x-synth/reaction-data-env/bin/python" \
  -m scripts.data_import.compile_reaction_library \
  --manifest /absolute/ord-data/source-manifest.json \
  --source-dir /absolute/ord-data \
  --output /absolute/assets/knowledge/reaction-evidence/reactions.sqlite \
  --report /absolute/evidence/ord-import.json \
  --workers 4 --allow-rejected
```

manifest 包含官方 repository/mirror、固定 revision、CC-BY-SA-4.0，以及每个源文件的
`path/size/sha256/url`。所有文件先验证 SHA256，逐条流式解析；不能读回的文件、冲突 ID、
源文件变化或写库失败都会终止发布。`--allow-rejected` 仅允许计数并保留不可表示的结构/记录缺口，
不把它们转换成假结构。未使用此选项时任何记录拒绝都不发布。完整提取统计是运行验收数据，
保存在外部证据目录，不进入源码；全量文件、拒绝原因与未读取行数必须核验。
并行进程只提取记录，只有一个数据库编译与原子发布入口；既有索引绝不覆盖。

结构字段仍以明确的原始 SMILES/MOL 为准。InChI 重建时可能选择另一个互变异构式，
不得仅因其 canonical SMILES 不同就丢弃记录。只有原始完整 Standard InChI 与明确结构生成值
完全一致，且各组分的分子式、形式电荷与原子电荷计数一致，才允许这种表示差异。
总电荷相同并不足够：例如带电盐与中性酸/胺混合物可能共享 Standard InChI。
真正的立体、同位素、盐型、
连接性或多个明确结构冲突仍拒绝。该规则不更改库存、路线或文献查询的精确结构键。

修正提取规则后可添加 `--base-library /absolute/previous/reactions.sqlite`，输出到新路径。
原库必须只读、无 SQLite sidecar，schema、快照、许可及全部源文件 path/SHA256 必须与
重新验证的完整 manifest 一致。旧记录逐条类型和来源核验，再进入同一个编译器；只有已核验
单 outcome 记录可跳过重复提取，多 outcome 仍解析并核对原 ID 的完整 payload。
差异冲突或原库/源文件变化会中止发布，不能覆盖旧库。完整报告分别记录复用数、
已验证跳过行数、新索引记录数和未读取行数，不能将复用记录冒充本轮新增提取。

新导入源元数据保存结构标识校验策略。旧索引没有当前策略标记时，先筛出 Standard InChI
会改变组分电荷状态的记录，整条原始反应从复用集合扣除，再按固定源文件重验。
重新验收通过的已有记录仍写入同一个编译器；未通过的记录不进入新索引，旧索引保持完整。
审计分别记录原库核验、实际复用、重验保留与重验移除，不把移除伪装成新增或漏读。

运行时可设置 `X_SYNTH_REACTION_LIBRARY_DB` 或传 `serve_platform --reaction-library PATH`。
未设置时仅当 assets 下 `knowledge/reaction-evidence/reactions.sqlite` 实际存在才自动启用。
可见收率、条件覆盖来自实际索引计数；条件计数包含原始输入/投料字段，并不表示温度、时间、
催化剂等全部记录齐全，也不代表每个新目标都有文献。更新使用新不可变路径，
验证后切换配置并重启产品服务；回滚到旧路径即可，任务/文档数据库无需迁移。

### 目录价格

已有统一库存的 `ppg` 按原生公开单位 `$/g` 投影为目录参考，不改库存证据身份或叶子终止集合。
API 返回价格来源、目录键、源快照与目录文件 SHA256；没有 ISO 币种/报价日期时不能填 USD、CNY
或用索引生成时间充当报价时间。全路线成本需要独立的包装、用量、真实收率与同币种报价，当前不推算。
供应商当前页面仍由目录链接打开；没有授权接口时不得读取账号 token、批量绕过限制或冒称实时价格。
公开免费的 [Chemspace API](https://chem-space.com/purchasing-saas/chemspace-api?alias=chemspace-api)
和 [Molport 数据服务](https://www.molport.com/blog/tutorials/knime-workflows-for-downloading-of-molport-data-for-offline-usage/)
仍要求合法账户凭据，不因免费而自动启用。供应商 SDF 含结构不等于含当前报价。

## 验收与性能

```bash
python -m pytest tests/unit/test_product_api_security.py tests/unit/test_performance_budget.py -q
python -m scripts.diagnostics.benchmark_stock_index --index /absolute/catalog.sqlite
python -m scripts.diagnostics.benchmark_platform --job-id JOB_ID
cd apps/web
npm test -- --runInBand src/common/runtime-status.test.js src/common/job-state.test.js
npm run build
npm audit --omit=dev --audit-level=high
```

平台 benchmark 必须在真实搜索中执行。记录样本数、P95、资产身份和进程资源。性能
验证按改动及直接调用模块选择，完整回归需要明确授权。
标准唯一来源是 current-architecture.md 及 PerformanceBudget/PerformanceTargets，
脚本不另定门槛。真实 Chrome 验证桌面/移动端、结构输入、提交、历史刷新和路线查看。
单测不能替代真实推理，模板重构也不等同于实验成功或独立正向产物模型。

新任务在模板与精确库存审查后，自动使用已部署的 Graph2SMILES / USPTO_STEREO
和可行性模型逐步复核候选：预期产物须排第一且达到该任务的可行性阈值，才写入
已核验输出。模型计算通过统一研究记录保存真实 record_id；不把核验目标作为模型输入。
原生候选的整理过程不提前发布，只有独立核验完成后才原子写入正式路线文件。
同反应、同产物及未检索到的公开资料分别保存；同产物记录不能给该预测步骤提供实测收率。

每轮先排除不符合精确化学拓扑的候选和完整重复路线，再按首步家族轮转访问有限候选池。
首个代表路线失败不会隐藏该家族后面的候选；已有合格路线的家族不重复消耗模型调用。
达到输出条数或候选池耗尽才结束审查，不按输出数的固定倍数截断候选；未核验的候选
保留为待核验，不算模型失败。合格条数不足时进入原请求唯一的一轮修复。正向不吻合的反应进入
下一轮的禁止反应集合，该集合在子任务提交前封存；恢复已提交子任务不能改变其输入哈希。
同一模型进程批次和代码版本下，断点复用已完成且属于该用户的研究记录；模型重启后
重核验便宜的正向阶段，不重跑已经完成的原生树搜索。无托管模型进程身份时不跨运行复用。
旧版核验契约仅允许升级下游审查，精确库存、模型和原生搜索的身份校验仍不放宽。

界面改动验收包括真实任务提交与历史刷新、各路线完整分支、节点移动与保存重开、
备注与结构编辑的来源变化、JSON 导入导出、完整图像导出和移动端结构绘制器。
核心路径须用真实 ASKCOS/SQLite/RDKit，不用 mock 模型或预填路线作验收。

PR 和 main push 的发布 CI 通过 `scripts/diagnostics/ci_scope.py` 根据真实 Git diff
选择改动及直接消费者测试。当前 workspace profile 不认识的源码、依赖或工具变更会
停止并要求增加审查过的映射，不回退到全量测试，也不静默跳过。新增领域需扩展该
profile。本地预览可用 `--base BASE_SHA --worktree --suite python` 或 `frontend`，
加 `--run` 才执行选中的精确测试文件。构建、生产依赖审计和 pip check 仍为独立门禁。

翻译资源只有在 AST 确认是纯字符串配对数组、既有消息完整不变、且对应目录校验测试
存在时，新增消息才不扩展到无关页面消费者；总目录与所属模块目录的完整性测试仍强制执行。
修改或移除既有消息、增加可执行代码、缺少字面量证据或目录校验时，继续按完整反向依赖选择。
语言状态、注册入口和依赖更新不属于这项优化，不能用它跳过全局语言行为的关联检查。

开发工具链的审计与运行时审计分开记录。Jest 29 的传递依赖 `braces<=3.0.3`
存在 GHSA-vfj7-8cjw-p6xm，当前无官方修复版本；只处理受信源码路径，不接受用户
上传的 glob 作为测试参数。开发依赖不进入静态产品部署，保留审计结果而非强制跨
主版本升级测试框架。运行时审计仍要求无 high/critical 漏洞。

## 故障与回滚

- 模型未就绪：查 service_checks 和外部 logs/native，核对文件、模板数量及版本。
- 库存不一致：搜索与审查必须用同一密封快照，不得退回弱证据旧 Mongo 终点。
- 零路线：检查真实候选及第二次搜索状态，保存成功不等于化学成功。
- 历史为空：核对产品 owner 与导入 owner。本机工作区不要求旧访客 token。
- WSL/API 失联：核对持续运行和端口，不重启其他项目。
- 内存预警：先检查模型实例数和搜索图，不关闭化学审查来满足速度指标。

交付必须完成本任务所有 PR 的主线合并，并部署合并后的精确 main revision。
PR 已提交、CI 通过或仅运行审查分支都不算完成。部署后核验版本、提交号、干净源码、
API/浏览器连通、服务就绪和历史持久性；相关验收通过后才能结束交付。

升级保留已验证 revision、匹配资产和私有库备份。回滚只切源码及不可变资产，不覆盖
私人任务或数据库卷。资产或审查契约改变时，不把旧 checkpoint 冒充新版完整结果。
