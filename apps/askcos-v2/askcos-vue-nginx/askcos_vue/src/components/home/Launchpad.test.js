const fs = require("fs");
const path = require("path");

const launchpadPath = path.resolve(__dirname, "Launchpad.vue");

function readLaunchpad() {
  return fs.readFileSync(launchpadPath, "utf8");
}

test("module workbench runs the selected submodule from its settings panel", () => {
  const text = readLaunchpad();

  expect(text).toContain('const selectedModuleKey = ref("route-design");');
  expect(text).toContain('const selectedModuleItemKey = ref("tree-builder");');
  expect(text).toContain('const modulePickerExpanded = ref(true);');
  expect(text).toContain('data-cy="home-module-picker-toggle"');
  expect(text).toContain('data-cy="home-selected-module-settings"');
  expect(text).toContain("action-settings-panel");
  expect(text).toContain('class="route-settings-grid"');
  expect(text).toContain(".settings-panel .route-settings-grid");
  expect(text).toContain('路线数量上限');
  expect(text).toContain('搜索时间（秒）');
  expect(text).toContain('Fast filter 阈值');
  expect(text).toContain('任务名称');
  expect(text).toContain('class="run-selected-module-button"');
  expect(text).toContain('@click="runSelectedModule"');
  expect(text).toContain('const runSelectedModule = async () => {');
  expect(text).toContain('await buildTreeFromCurrentStructure();');
  expect(text).toContain('await evaluateScscore();');
  expect(text).toContain('await evaluateFastFilter();');
  expect(text).toContain('await generateAtomMap();');
  expect(text).toContain('await classifyReaction();');
  expect(text).toContain('await runInteractivePlanner();');
  expect(text).toContain('await runRetroPrediction();');
  expect(text).toContain('await runRouteResultsRefresh();');
  expect(text).toContain('await runDrawingSync();');
  expect(text).toContain('await runBuyablesSearch();');
  expect(text).toContain('await runSolubilityPrediction();');
  expect(text).toContain('await runSolventScreen();');
  expect(text).toContain('await runResultsRefresh();');
  expect(text).toContain('await runStatusRefresh();');
  expect(text).toContain('await runTemplateRefresh();');
  expect(text).toContain('await runBanlistRefresh();');
  expect(text).not.toContain('window.location.href');
  expect(text).not.toContain('item.href');
  expect(text).not.toContain("打开配置");
  expect(text).not.toContain("进入原生功能页");
  expect(text).not.toContain("原页面参数");
  expect(text).not.toContain('class="selected-action-panel"');
});

test("tree builder submission uses unified route endpoint and high quality policy", () => {
  const text = readLaunchpad();

  expect(text).toContain('import { applyHighQualityRoutePolicy } from "@/common/tree-quality-policy";');
  expect(text).toContain("UNIFIED_ROUTE_ENDPOINT");
  expect(text).toContain("buildUnifiedRouteRequestBody");
  expect(text).toContain('const settingsStore = useSettingsStore();');
  expect(text).toContain('const buildTreeRequestBody = (targetSmiles) => {');
  expect(text).toContain('settingsStore.tree_builder_settings');
  expect(text).toContain('body.build_tree_options.expansion_time');
  expect(text).toContain('body.enumerate_paths_options.max_paths');
  expect(text).toContain('body.expand_one_options.filter_threshold');
  expect(text).toContain('applyHighQualityRoutePolicy(body);');
  expect(text).toContain("UNIFIED_ROUTE_ENDPOINT,");
  expect(text).toContain("buildUnifiedRouteRequestBody(buildTreeRequestBody(targetSmiles))");
  expect(text).toContain('pollTreeResultInBackground(treeTaskId.value);');
  expect(text).not.toContain('"/api/tree-search/controller/call-async"');
  expect(text).not.toContain('"/api/tree-search/mcts/call-async"');
});

test("layout uses a filled flat module rail with a glass collapse control", () => {
  const text = readLaunchpad();

  expect(text).toContain("grid-template-columns:");
  expect(text).toContain("clamp(184px, 10vw, 224px)");
  expect(text).toContain("minmax(720px, 1fr)");
  expect(text).toContain("clamp(350px, 20vw, 420px)");
  expect(text).toContain("align-items: start;");
  expect(text).toContain("height: 100%;");
  expect(text).toContain("min-height: 0;");
  expect(text).toContain("overflow: visible;");
  expect(text).toContain("max-height: 100%;");
  expect(text).toContain("overflow-y: auto;");
  expect(text).toContain("overscroll-behavior: contain;");
  expect(text).toContain("scrollbar-gutter: stable;");
  expect(text).toContain(`:style="{ '--module-count': moduleGroups.length }"`);
  expect(text).toContain("grid-template-rows: repeat(var(--module-count), minmax(clamp(76px, 12dvh, 138px), 1fr));");
  expect(text).toContain("align-content: stretch;");
  expect(text).toContain("justify-items: stretch;");
  expect(text).toContain("grid-template-columns: 40px minmax(0, 1fr);");
  expect(text).toContain("align-items: center;");
  expect(text).toContain("inset: 12px auto 12px 0;");
  expect(text).toContain("transform: translateX(-4px);");
  expect(text).toContain("transform: translateX(0);");
  expect(text).toContain("width: 40px;");
  expect(text).toContain("width: 30px;");
  expect(text).toContain("backdrop-filter: blur(16px);");
  expect(text).toContain(".module-picker-block.expanded .module-picker-chevron");
  expect(text).toContain("transform: rotate(180deg);");
  expect(text).toContain("@media (max-width: 1120px)");
  expect(text).toContain("clamp(140px, 12vw, 166px)");
  expect(text).toContain("grid-template-rows: repeat(var(--module-count), minmax(clamp(68px, 11dvh, 118px), 1fr));");
  expect(text).toContain("grid-template-columns: 30px minmax(0, 1fr);");
  expect(text).toContain("min-width: 128px;");
  expect(text).toContain("@media (max-width: 960px)");
  expect(text).toContain("@media (max-width: 820px)");
  expect(text).toContain("grid-auto-rows: minmax(76px, auto);");
  expect(text).not.toContain("mdi-chevron-right");
  expect(text).not.toContain("selectedModuleKey === module.key ? 'mdi-check-circle'");
});

test("structure area keeps one flat input module and current Ketcher editor actions", () => {
  const text = readLaunchpad();

  expect(text).toContain('class="structure-input-module"');
  expect(text).toContain('class="canvas-search-bar"');
  expect(text).toContain('@structure-convert="handleStructureConvert"');
  expect(text).toContain('const convertedStructureSmiles = ref("");');
  expect(text).toContain("SMILES 已转换并载入下方编辑窗口。");
  expect(text).toContain(':show-actions="false"');
  expect(text).toContain("fill-height");
  expect(text).toContain("grid-template-rows: minmax(0, 1fr);");
  expect(text).toContain(".canvas-search-bar :deep(.v-field)");
  expect(text).toContain('class="drawing-board-actions compact-drawing-actions"');
  expect(text).toContain("清除面板");
  expect(text).not.toContain('class="panel-toolbar"');
  expect(text).not.toContain("输入 SMILES 并转换结构");
  expect(text).not.toContain("当前输入");
  expect(text).not.toContain("当前模块");
  expect(text).not.toContain("module-sidebar-accordion");
});

test("direct workbench submodules call existing ASKCOS APIs instead of fake navigation", () => {
  const text = readLaunchpad();

  expect(text).toContain('action: "context"');
  expect(text).toContain('action: "forward"');
  expect(text).toContain('action: "impurity"');
  expect(text).toContain('action: "selectivity"');
  expect(text).toContain('action: "sites"');
  expect(text).toContain('action: "qm"');
  expect(text).toContain('action: "interactive-planner"');
  expect(text).toContain('action: "retro-prediction"');
  expect(text).toContain('action: "route-results"');
  expect(text).toContain('action: "drawing"');
  expect(text).toContain('action: "buyables"');
  expect(text).toContain('action: "solpred"');
  expect(text).toContain('action: "solscreen"');
  expect(text).toContain('action: "results"');
  expect(text).toContain('action: "status"');
  expect(text).toContain('action: "template"');
  expect(text).toContain('action: "banlist"');
  expect(text).toContain('"/api/context-recommender/v1/condition-uncleaned/call-async"');
  expect(text).toContain('"/api/context/quarc/single-query/call-async"');
  expect(text).toContain('"/api/forward/controller/call-async"');
  expect(text).toContain('"/api/impurity-predictor/call-async"');
  expect(text).toContain('"/api/general-selectivity/controller/call-async"');
  expect(text).toContain('"/api/site-selectivity/call-async"');
  expect(text).toContain('"/api/qm-descriptors/call-async"');
  expect(text).toContain("UNIFIED_ROUTE_ENDPOINT");
  expect(text).toContain('"/api/tree-search/expand-one/call-async"');
  expect(text).toContain('import { getBuyables } from "@/common/buyables";');
  expect(text).toContain('"/api/solubility/fusion-cycle/call-async"');
  expect(text).toContain('"/api/fastsolv/call-async"');
  expect(text).toContain('"/api/solubility/batch/call-async"');
  expect(text).toContain('"/api/results/list"');
  expect(text).toContain('"/api/admin/get-backend-status"');
  expect(text).toContain('"/api/template/sets/"');
  expect(text).toContain('"/api/banlist/chemicals/get"');
  expect(text).toContain('"/api/banlist/reactions/get"');
  expect(text).toContain("selectedModuleFormFields");
  expect(text).toContain("directRunResultRows");
  expect(text).not.toContain('route-publication');
  expect(text).not.toContain('nmr-dossier');
  expect(text).not.toContain("路线实验包");
  expect(text).not.toContain("NMR 和文稿草稿");
});
