# X-Synth 运行与部署

## 支持边界

产品 v0.1.0 支持 Linux / WSL、Python 3.12、Node.js 24。唯一产品入口是
`scripts.operations.serve_platform`，同时提供工作台、API 和 ASKCOS 进程监督。
引擎原有 Compose/deploy 工具是上游源码，不是产品启动入口。当前路线主链无需
GPT Web、Codex token、AiZynthFinder、RabbitMQ 或 Redis。其他原生功能依赖其各自服务，
未安装时不可用。源码发布不携带模型、商业数据、私人历史或个人配置。

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
工作台和历史分别在 http://127.0.0.1:8769/ 和 http://127.0.0.1:8769/results。

```bash
curl --fail http://127.0.0.1:8769/api/v1/health
curl --fail http://127.0.0.1:8769/api/v1/runtime
curl --fail http://127.0.0.1:8769/api/v1/environments
curl --fail http://127.0.0.1:8769/api/v1/stock-sources/summary
```

只有真实探针通过才显示 route_search_ready；端口或文档页存在不算就绪。默认本机
单用户模式拒绝跨站访问。共享部署必须用经过服务端验证的身份，不能公开本机模式。

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
不依赖终端持续读取。原生服务日志在 `logs/native`。数据库健康探针超时返回 503，
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

路线整理在两种策略间共享有限 AND/OR 可达性检查：反应必须全部前体可达商业终点，
无商业出口的循环不进入组合枚举；实际路线逐条生成，原始搜索图和候选仍保留。
RetroStar 未解出目标时直接输出空路线，不能花费额外资源枚举不可能闭合的组合。

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

界面改动验收包括真实任务提交与历史刷新、各路线完整分支、节点移动与保存重开、
备注与结构编辑的来源变化、JSON 导入导出、完整图像导出和移动端结构绘制器。
核心路径须用真实 ASKCOS/SQLite/RDKit，不用 mock 模型或预填路线作验收。

PR 和 main push 的发布 CI 通过 `scripts/diagnostics/ci_scope.py` 根据真实 Git diff
选择改动及直接消费者测试。当前 workspace profile 不认识的源码、依赖或工具变更会
停止并要求增加审查过的映射，不回退到全量测试，也不静默跳过。新增领域需扩展该
profile。本地预览可用 `--base BASE_SHA --worktree --suite python` 或 `frontend`，
加 `--run` 才执行选中的精确测试文件。构建、生产依赖审计和 pip check 仍为独立门禁。

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
