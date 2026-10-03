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

产品和原生推理是两个独立 Python 进程边界，各自使用一个锁文件：

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
| stock/catalog.sqlite | 精确结构和供应商目录证据的不可变索引 |

安装工具：

```bash
python -m scripts.data_import.install_askcos_model --help
python -m scripts.data_import.convert_scscore_model --help
python -m scripts.data_import.compile_stock_index --help
python -m scripts.data_import.compile_template_library --help
```

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

旧历史由 scripts.data_import.import_askcos_history 显式导入指定 owner，幂等且不改写
原库。legacy_completed/legacy_incomplete 不自动重跑，不代表新的商业闭合审查。
私人结果默认不能分享。

路线文档独立保存在同一状态根的 `workspace.sqlite`，不混入任务库。升级时同时备份
`jobs.sqlite`、`workspace.sqlite` 及各自 WAL 状态，使用 SQLite 一致性备份接口；
不要直接复制仍在写入的单个数据库文件。文档 API 不需要模型启动才能预览或编辑，
但一步继续逆合成仍需要真实模型就绪。未保存修改有页面离开保护；版本冲突保留画布，
不能静默覆盖。计算结果编辑必须通过创建副本，不回写任务结果。

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
