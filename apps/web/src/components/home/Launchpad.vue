<template>
  <div class="synon-launchpad">
    <aside class="workbench-modules" aria-label="核心模块导航">
      <div class="primary-module-list" :style="{ '--module-count': moduleGroups.length }">
        <button
          v-for="module in moduleGroups"
          :key="module.key"
          type="button"
          class="primary-module-card"
          :class="{ active: selectedModuleKey === module.key }"
          @click="selectModule(module.key)"
        >
          <span class="primary-module-icon">
            <v-icon :icon="module.icon" size="26" />
          </span>
          <span class="primary-module-copy">
            <strong>{{ module.title }}</strong>
            <small>{{ module.items.length }} 个子模块</small>
          </span>
        </button>
      </div>
    </aside>

    <section class="structure-panel">
      <div class="structure-input-module">
        <div
          :class="[
            'molecule-canvas',
            { filled: !!currentInput, 'route-mode': hasRouteTask },
          ]"
        >
          <search-bar
            class="canvas-search-bar"
            v-model:smilesInput="smilesInput"
            @structure-convert="handleStructureConvert"
          />

          <div v-if="hasRouteTask" class="route-display-board">
            <div class="route-display-header">
              <div>
                <p class="eyebrow">合成路线展示</p>
                <h3>{{ routeTaskState.title }}</h3>
                <span>{{ routeTaskState.subtitle }}</span>
              </div>
              <v-chip :color="routeTaskState.color" variant="tonal" size="small">
                {{ routeTaskState.label }}
              </v-chip>
            </div>

            <div class="route-flow-preview">
              <div class="route-node route-target-node">
                <small>目标结构</small>
                <smiles-image
                  v-if="currentInput && !invalidStructureSyntax"
                  class="route-target-image"
                  :smiles="currentInput"
                  width="100%"
                  max-width="220"
                  height="120"
                  allow-copy
                />
                <span v-else>{{ currentInput || "未输入" }}</span>
              </div>
              <div class="route-connector">
                <v-progress-circular
                  v-if="treeStatus === 'submitting'"
                  indeterminate
                  color="primary"
                  size="28"
                  width="3"
                />
                <v-icon v-else :icon="routeTaskState.icon" size="28" />
              </div>
              <div class="route-node route-result-node">
                <small>路线树任务</small>
                <strong>{{ routeTaskState.nodeTitle }}</strong>
                <span>{{ routeTaskState.nodeText }}</span>
              </div>
            </div>

            <div class="route-display-actions">
              <v-btn
                color="primary"
                variant="flat"
                rounded="pill"
                prepend-icon="mdi-table"
                href="/results"
                data-cy="home-view-tree-results"
              >
                查看结果
              </v-btn>
              <v-btn
                color="primary"
                variant="tonal"
                rounded="pill"
                prepend-icon="mdi-source-branch-sync"
                :disabled="!canRunTreeBuilder"
                @click="buildTreeFromCurrentStructure"
              >
                重新生成
              </v-btn>
            </div>
          </div>

          <div v-else-if="currentInput && invalidStructureSyntax" class="structure-error-state">
            <v-icon icon="mdi-alert-circle-outline" size="52" />
            <strong>结构未解析</strong>
            <span>{{ currentInput }}</span>
          </div>

          <div v-else class="structure-drawing-board">
            <inline-ketcher-editor
              ref="inlineKetcherRef"
              v-model:smiles="smilesInput"
              :show-actions="false"
              fill-height
              @commit="handleEditorCommit"
            />
            <div class="drawing-board-actions compact-drawing-actions">
              <v-btn
                color="primary"
                variant="outlined"
                rounded="pill"
                prepend-icon="mdi-eraser"
                :disabled="isRunning"
                @click="clearCurrentStructure"
              >
                清除面板
              </v-btn>
              <v-btn
                color="primary"
                variant="flat"
                rounded="pill"
                prepend-icon="mdi-magnify"
                data-cy="home-run-selected-module-main"
                :disabled="selectedModuleDisabled"
                :loading="isRunning"
                @click="runSelectedModule"
              >
                {{ selectedModuleRunLabel }}
              </v-btn>
            </div>
          </div>
        </div>
      </div>
    </section>

    <aside class="settings-panel" aria-label="当前小模块设置">
      <div
        class="settings-block module-picker-block"
        :class="{ expanded: modulePickerExpanded }"
      >
        <button
          type="button"
          class="settings-block-header module-picker-toggle module-picker-toggle-icon"
          data-cy="home-module-picker-toggle"
          aria-controls="home-module-picker-content"
          :aria-expanded="String(modulePickerExpanded)"
          :aria-label="modulePickerExpanded ? '折叠小模块' : '展开小模块'"
          @click="toggleModulePicker"
        >
          <v-icon
            class="module-picker-chevron"
            icon="mdi-chevron-down"
            size="22"
          />
        </button>

        <transition name="module-picker-slide">
          <div
            v-show="modulePickerExpanded"
            id="home-module-picker-content"
            class="module-picker-collapse"
            data-cy="home-module-picker-content"
          >
            <div class="module-choice-list" data-cy="home-module-choice-list">
              <button
                v-for="item in selectedModuleItems"
                :key="item.key"
                type="button"
                class="module-choice-card"
                :class="{ active: selectedModuleItemKey === item.key }"
                @click="selectModuleItem(item)"
              >
                <v-icon :icon="item.icon" size="22" />
                <span>
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.subtitle }}</small>
                </span>
              </button>
            </div>
          </div>
        </transition>
      </div>

      <div class="settings-block action-settings-panel" data-cy="home-selected-module-settings">
        <div class="module-settings-title">
          <v-icon :icon="selectedModuleItem.icon" size="22" />
          <div>
            <strong>{{ selectedModuleItem.title }}</strong>
            <span>{{ selectedModuleItem.subtitle }}</span>
          </div>
        </div>

        <div v-if="selectedModuleItem.action === 'tree-builder'" class="route-settings-grid">
          <v-text-field
            v-model.number="treeSettings.maxPaths"
            label="路线数量上限"
            type="number"
            min="3"
            max="10"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-text-field
            v-model.number="treeSettings.expansionTime"
            label="搜索时间（秒）"
            type="number"
            min="60"
            max="3600"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-text-field
            v-model.number="treeSettings.maxDepth"
            label="最大深度"
            type="number"
            min="3"
            max="20"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-text-field
            v-model.number="treeSettings.minPlausibility"
            label="Fast filter 阈值"
            type="number"
            min="0"
            max="1"
            step="0.05"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-text-field
            v-model="treeJobName"
            label="任务名称"
            variant="outlined"
            density="compact"
            hide-details
            class="route-settings-wide"
          />
        </div>

        <div v-else-if="selectedModuleFormFields.length" class="route-settings-grid">
          <template v-for="field in selectedModuleFormFields" :key="field.key">
            <v-select
              v-if="field.items"
              v-model="directSettings[field.key]"
              :label="field.label"
              :items="field.items"
              variant="outlined"
              density="compact"
              hide-details
              :class="{ 'route-settings-wide': field.wide }"
            />
            <v-switch
              v-else-if="field.type === 'switch'"
              v-model="directSettings[field.key]"
              :label="field.label"
              color="primary"
              density="compact"
              hide-details
              :class="{ 'route-settings-wide': field.wide }"
            />
            <v-text-field
              v-else
              v-model="directSettings[field.key]"
              :label="field.label"
              :type="field.type || 'text'"
              :min="field.min"
              :max="field.max"
              :step="field.step"
              variant="outlined"
              density="compact"
              hide-details
              :class="{ 'route-settings-wide': field.wide }"
            />
          </template>
        </div>

        <div v-else-if="selectedModuleParameterRows.length" class="param-list">
          <label v-for="row in selectedModuleParameterRows" :key="row.label">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </label>
        </div>

        <div v-else class="module-parameter-empty">
          <v-icon icon="mdi-tune-variant" size="22" />
          <span>该小模块暂无额外参数，点击运行会在当前工作台执行。</span>
        </div>

        <v-btn
          color="primary"
          variant="flat"
          rounded="pill"
          block
          class="run-selected-module-button"
          :prepend-icon="selectedModuleItem.icon"
          :disabled="selectedModuleDisabled"
          :loading="isRunning"
          :data-cy="selectedModuleItem.dataCy || 'home-run-selected-module'"
          @click="runSelectedModule"
        >
          {{ selectedModuleRunLabel }}
        </v-btn>
      </div>

      <div v-if="selectedModuleItem.action === 'tree-builder'" class="settings-block status-block">
        <p class="eyebrow">运行状态</p>
        <template v-if="treeStatus === undefined">
          <strong data-cy="home-route-readiness">{{ routeReadiness.label }}</strong>
          <span v-if="routeReadiness.message">{{ routeReadiness.message }}</span>
          <v-btn icon="mdi-refresh" size="small" variant="text" title="重新检查后端" aria-label="重新检查后端" @click="refreshRouteReadiness" />
        </template>
        <template v-else-if="treeStatus === 'submitting'">
          <v-progress-linear indeterminate color="primary" />
          <strong>任务提交中</strong>
          <span>正在把当前目标和路线树参数提交到统一路线池。</span>
        </template>
        <template v-else-if="treeStatus === 'submitted'">
          <strong>任务已提交</strong>
          <span>{{ treeTaskId ? `任务 ID：${treeTaskId}` : "后台正在生成路线树。" }}</span>
          <v-btn variant="tonal" color="primary" href="/results" data-cy="home-view-tree-results">
            查看结果
          </v-btn>
        </template>
        <template v-else-if="treeStatus === 'finished'">
          <strong>路线树已完成</strong>
          <span>{{ treeResultId ? `结果 ID：${treeResultId}` : "可进入结果列表查看。" }}</span>
          <v-btn variant="tonal" color="primary" href="/results" data-cy="home-view-tree-results">
            查看结果
          </v-btn>
        </template>
        <template v-else>
          <strong class="text-red">任务失败</strong>
          <span>{{ runMessage || "当前服务或输入不能提交路线树任务。" }}</span>
        </template>
      </div>

      <div v-else class="settings-block status-block">
        <p class="eyebrow">运行状态</p>
        <strong>{{ genericRunTitle }}</strong>
        <span>{{ runMessage || genericRunMessage }}</span>
      </div>
    </aside>

    <section v-if="reactionClassRows.length" class="result-strip">
      <v-data-table :headers="reactionClassHeaders" :items="reactionClassRows" :items-per-page="100">
        <template #bottom />
      </v-data-table>
    </section>

    <section v-if="directRunResultRows.length" class="result-strip direct-result-strip">
      <v-data-table
        :headers="directRunResultHeaders"
        :items="directRunResultRows"
        :items-per-page="100"
        density="comfortable"
      >
        <template #bottom />
      </v-data-table>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { API } from "@/common/api";
import { normalizeRouteReadiness } from "@/common/route-readiness";
import { getBuyables } from "@/common/buyables";
import { applyHighQualityRoutePolicy } from "@/common/tree-quality-policy";
import {
  UNIFIED_ROUTE_ENDPOINT,
  buildUnifiedRouteRequestBody,
  unifiedRouteStatusEndpoint,
} from "@/common/unified-route";
import { isJobTerminal, jobStateLabel } from "@/common/job-state";
import InlineKetcherEditor from "@/components/InlineKetcherEditor.vue";
import SearchBar from "@/components/home/SearchBar.vue";
import SmilesImage from "@/components/SmilesImage";
import { useSettingsStore } from "@/store/settings";
import { solventSets } from "@/views/solprop/solvents";

const settingsStore = useSettingsStore();

const inlineKetcherRef = ref(null);
const smilesInput = ref("");
const convertedStructureSmiles = ref("");
const structureIsValid = ref(null);
const treeStatus = ref(undefined);
const routeReadiness = ref({ ready: false, label: "检查后端中", message: "" });
const refreshRouteReadiness = async () => {
  routeReadiness.value = { ready: false, label: "检查后端中", message: "" };
  try {
    routeReadiness.value = normalizeRouteReadiness(await API.get("/api/v1/health"));
  } catch {
    routeReadiness.value = { ready: false, label: "服务未连接", message: "无法连接路线编排服务。" };
  }
  return routeReadiness.value.ready;
};
const treeTaskId = ref("");
const treeResultId = ref("");
const runMessage = ref("");
const scscore = ref(undefined);
const fastFilterScore = ref(undefined);
const mappedSmiles = ref(undefined);
const reactionClassStatus = ref("not started");
const reactionClassRows = ref([]);
const directRunResultRows = ref([]);
const selectedModuleKey = ref("route-design");
const selectedModuleItemKey = ref("tree-builder");
const modulePickerExpanded = ref(true);
const treeJobName = ref("");
const runningAction = ref("");

const treeSettings = ref({
  maxPaths: 10,
  expansionTime: 1200,
  maxDepth: 12,
  maxBranching: 50,
  templateCount: 1000,
  templateCumProb: 0.999,
  minPlausibility: 0.75,
});

const directSettings = ref({
  contextModel: "neuralnetwork",
  contextResultCount: 10,
  forwardBackend: "wldn5",
  forwardModelName: "pistachio",
  forwardReagents: "",
  forwardSolvent: "",
  impurityTopk: 3,
  impurityThreshold: 0.1,
  impurityInspector: "Reaxys inspector",
  impurityCheckMapping: true,
  selectivityBackend: "gnn",
  selectivityAtomMapBackend: "wln",
  selectivityNoMapReagents: false,
  retroModel: "template_relevance",
  retroTrainingSet: "reaxys",
  retroPrecursorScoring: "relevance_heuristic",
  retroTemplateCount: 100,
  retroCumProb: 0.999,
  retroMinPlausibility: 0.1,
  buyablesReturnLimit: 20,
  buyablesSimilarity: 1,
  solpredModel: "solprop",
  solpredSolvent: "O",
  solpredTemperature: 298,
  solpredDensity: "",
  solscreenSet: "集合 1",
  solscreenTemperatures: "298\n323",
  solscreenMaxSolvents: 8,
});

const SAFE_STRUCTURE_PATTERN = /^[A-Za-z0-9@+\-[\]()=#$:/\\.%>*]+$/;

const currentInput = computed(() => String(smilesInput.value || "").trim());
const inputType = computed(() => (currentInput.value.includes(">") ? "rxn" : "mol"));
const invalidStructureSyntax = computed(
  () => !!currentInput.value && !SAFE_STRUCTURE_PATTERN.test(currentInput.value)
);
const hasRouteTask = computed(() => treeStatus.value !== undefined);
const isRunning = computed(() => !!runningAction.value);

const moduleGroups = computed(() => [
  {
    key: "route-design",
    title: "路线设计",
    subtitle: "逆合成、路线树和交互式规划",
    icon: "mdi-source-branch",
    items: [
      {
        key: "tree-builder",
        title: "构建路线树",
        subtitle: "用当前目标提交路线树搜索任务",
        icon: "mdi-source-branch-sync",
        action: "tree-builder",
        dataCy: "home-build-tree",
      },
      {
        key: "ipp",
        title: "交互式路线规划",
        subtitle: "用当前目标提交交互式规划任务",
        icon: "mdi-file-tree",
        action: "interactive-planner",
        dataCy: "home-ipp",
      },
      {
        key: "rp",
        title: "一步逆合成预测",
        subtitle: "生成候选断键和反应模板建议",
        icon: "mdi-arrow-decision",
        action: "retro-prediction",
      },
      {
        key: "te",
        title: "路线树查看",
        subtitle: "查看已提交路线树任务结果",
        icon: "mdi-graph-outline",
        action: "route-results",
      },
    ],
  },
  {
    key: "reaction-prediction",
    title: "反应预测",
    subtitle: "条件、产物、可行性和反应解析",
    icon: "mdi-flask",
    items: [
      {
        key: "context",
        title: "反应条件推荐",
        subtitle: "推荐溶剂、试剂、催化剂和温度",
        icon: "mdi-beaker-question",
        action: "context",
        dataCy: "home-predict-condition",
      },
      {
        key: "forward",
        title: "正向产物预测",
        subtitle: "根据反应物预测主产物",
        icon: "mdi-arrow-right-bold-hexagon-outline",
        action: "forward",
        dataCy: "home-forward-synthesis",
      },
      {
        key: "fast-filter",
        title: "反应可行性",
        subtitle: "计算当前反应式的 fast filter 得分",
        icon: "mdi-chart-bell-curve",
        action: "fast-filter",
        dataCy: "home-fast-filter-score",
      },
      {
        key: "atom-map",
        title: "原子映射",
        subtitle: "为当前反应式生成 atom mapping",
        icon: "mdi-vector-polyline",
        action: "atom-map",
        dataCy: "home-generate-atom-mapping",
      },
      {
        key: "classify",
        title: "反应分类",
        subtitle: "识别反应类别和模板族",
        icon: "mdi-format-list-bulleted-type",
        action: "classify",
        dataCy: "home-classify-reaction",
      },
    ],
  },
  {
    key: "selectivity-risk",
    title: "选择性与风险",
    subtitle: "杂质、区域选择性和位点预测",
    icon: "mdi-alert-decagram-outline",
    items: [
      {
        key: "impurity",
        title: "杂质预测",
        subtitle: "预测潜在副产物和风险结构",
        icon: "mdi-alert-rhombus-outline",
        action: "impurity",
        dataCy: "home-predict-impurities",
      },
      {
        key: "selectivity",
        title: "区域选择性预测",
        subtitle: "预测反应位点和区域选择性",
        icon: "mdi-crosshairs-gps",
        action: "selectivity",
        dataCy: "home-predict-regioselectivity",
      },
      {
        key: "sites",
        title: "芳香 C-H 官能团化",
        subtitle: "预测芳香环可官能团化位点",
        icon: "mdi-target",
        action: "sites",
        dataCy: "home-site-selectivity",
      },
    ],
  },
  {
    key: "structure-sourcing",
    title: "结构性质与采购",
    subtitle: "绘制、商购、溶剂和理化评估",
    icon: "mdi-shape-outline",
    items: [
      {
        key: "drawing",
        title: "结构绘制",
        subtitle: "使用中央结构画板录入或修正分子",
        icon: "mdi-pencil-ruler",
        action: "drawing",
      },
      {
        key: "buyables",
        title: "商业原料检索",
        subtitle: "查询可购买原料和结构匹配结果",
        icon: "mdi-cart-variant",
        action: "buyables",
        dataCy: "home-buyables",
      },
      {
        key: "scscore",
        title: "分子复杂度",
        subtitle: "快速评估目标结构的合成复杂度",
        icon: "mdi-speedometer",
        action: "scscore",
      },
      {
        key: "solpred",
        title: "溶解度预测",
        subtitle: "预测目标分子在常用溶剂中的溶解性",
        icon: "mdi-water-percent",
        action: "solpred",
      },
      {
        key: "solscreen",
        title: "溶剂筛选",
        subtitle: "筛选适合实验条件的候选溶剂",
        icon: "mdi-water-outline",
        action: "solscreen",
        dataCy: "home-solvent-screen",
      },
      {
        key: "qm",
        title: "QM 描述符",
        subtitle: "计算量化描述符和电子结构特征",
        icon: "mdi-atom",
        action: "qm",
        dataCy: "home-qm-descriptors",
      },
    ],
  },
  {
    key: "workflow-data",
    title: "任务与规则",
    subtitle: "结果、服务状态、模板和禁用规则",
    icon: "mdi-view-dashboard-outline",
    items: [
      { key: "results", title: "我的结果", subtitle: "刷新路线树、一步逆合成和历史任务", icon: "mdi-table", action: "results" },
      { key: "status", title: "服务状态", subtitle: "检查模型、数据库和任务队列状态", icon: "mdi-list-status", action: "status" },
      { key: "template", title: "模板信息", subtitle: "查看可用反应模板和模型配置", icon: "mdi-view-list", action: "template" },
      { key: "banlist", title: "禁用列表", subtitle: "统计路线搜索中禁止使用的结构", icon: "mdi-cancel", action: "banlist" },
    ],
  },
]);

const selectedModule = computed(
  () => moduleGroups.value.find((module) => module.key === selectedModuleKey.value) || moduleGroups.value[0]
);
const selectedModuleItems = computed(() => selectedModule.value?.items || []);
const selectedModuleItem = computed(
  () =>
    selectedModuleItems.value.find((item) => item.key === selectedModuleItemKey.value) ||
    selectedModuleItems.value[0] || {
      key: "",
      title: "小模块未选择",
      subtitle: "请选择一个可用小模块",
      icon: "mdi-dots-horizontal",
    }
);

const selectedModuleFormFields = computed(() => {
  const action = selectedModuleItem.value.action;
  if (action === "context") {
    return [
      {
        key: "contextModel",
        label: "条件推荐模型",
        items: [
          { title: "Neural Network", value: "neuralnetwork" },
          { title: "QUARC", value: "neuralnetworkv2" },
        ],
        wide: true,
      },
      { key: "contextResultCount", label: "结果数量", type: "number", min: 1, max: 50, wide: true },
    ];
  }
  if (action === "forward") {
    return [
      {
        key: "forwardBackend",
        label: "正向预测模型",
        items: [
          { title: "WLDN5", value: "wldn5" },
          { title: "Graph2SMILES", value: "graph2smiles" },
          { title: "Augmented Transformer", value: "augmented_transformer" },
        ],
      },
      { key: "forwardModelName", label: "模型训练集", type: "text" },
      { key: "forwardReagents", label: "试剂/助剂", type: "text", wide: true },
      { key: "forwardSolvent", label: "溶剂", type: "text", wide: true },
    ];
  }
  if (action === "impurity") {
    return [
      { key: "impurityTopk", label: "正向预测 Top-k", type: "number", min: 1, max: 20 },
      { key: "impurityThreshold", label: "审查阈值", type: "number", min: 0, max: 1, step: 0.05 },
      {
        key: "impurityInspector",
        label: "审查评分器",
        items: [
          { title: "Forward inspector", value: "Forward inspector" },
          { title: "Reaxys inspector", value: "Reaxys inspector" },
        ],
        wide: true,
      },
      { key: "impurityCheckMapping", label: "使用原子映射", type: "switch", wide: true },
    ];
  }
  if (action === "selectivity") {
    return [
      {
        key: "selectivityBackend",
        label: "选择性模型",
        items: [{ title: "GNN", value: "gnn" }],
      },
      {
        key: "selectivityAtomMapBackend",
        label: "原子映射模型",
        items: [
          { title: "WLN", value: "wln" },
          { title: "Indigo", value: "indigo" },
        ],
      },
      { key: "selectivityNoMapReagents", label: "不映射试剂", type: "switch", wide: true },
    ];
  }
  if (action === "retro-prediction") {
    return [
      {
        key: "retroModel",
        label: "逆合成模型",
        items: [
          { title: "Template relevance", value: "template_relevance" },
          { title: "RetroSim", value: "retrosim" },
          { title: "Template enumeration", value: "template_enumeration" },
        ],
        wide: true,
      },
      { key: "retroTrainingSet", label: "训练集", type: "text" },
      {
        key: "retroPrecursorScoring",
        label: "前体评分",
        items: [
          { title: "Relevance heuristic", value: "relevance_heuristic" },
          { title: "SCScore", value: "scscore" },
        ],
      },
      { key: "retroTemplateCount", label: "模板数量", type: "number", min: 1, max: 1000 },
      { key: "retroCumProb", label: "累计概率", type: "number", min: 0.1, max: 1, step: 0.001 },
      { key: "retroMinPlausibility", label: "Fast filter 阈值", type: "number", min: 0, max: 1, step: 0.05 },
    ];
  }
  if (action === "buyables") {
    return [
      { key: "buyablesReturnLimit", label: "返回数量", type: "number", min: 1, max: 100 },
      { key: "buyablesSimilarity", label: "相似度阈值", type: "number", min: 0, max: 1, step: 0.05 },
    ];
  }
  if (action === "solpred") {
    return [
      {
        key: "solpredModel",
        label: "溶解度模型",
        items: [
          { title: "Fusion Cycle", value: "solprop" },
          { title: "FastSolv", value: "fastsolv" },
          { title: "SolProp legacy", value: "legacy" },
        ],
        wide: true,
      },
      { key: "solpredSolvent", label: "溶剂 SMILES", type: "text" },
      { key: "solpredTemperature", label: "温度 K", type: "number", min: 200, max: 500 },
      { key: "solpredDensity", label: "密度（可选）", type: "text" },
    ];
  }
  if (action === "solscreen") {
    return [
      {
        key: "solscreenSet",
        label: "溶剂集合",
        items: Object.keys(solventSets).map((key) => ({ title: key, value: key })),
        wide: true,
      },
      { key: "solscreenTemperatures", label: "温度 K（逗号分隔）", type: "text", wide: true },
      { key: "solscreenMaxSolvents", label: "最大溶剂数", type: "number", min: 1, max: 30 },
    ];
  }
  return [];
});

const selectedModuleParameterRows = computed(() => {
  const item = selectedModuleItem.value;
  if (item.action === "interactive-planner") {
    return [
      { label: "目标结构", value: currentInput.value ? "使用当前目标" : "等待单分子 SMILES" },
      { label: "执行方式", value: "本页提交交互式规划任务" },
      { label: "结果归档", value: "写入我的结果" },
    ];
  }
  if (item.action === "route-results") {
    return [
      { label: "数据来源", value: "ASKCOS 结果列表" },
      { label: "筛选范围", value: "路线树和 IPP 结果" },
    ];
  }
  if (item.action === "drawing") {
    return [
      { label: "结构来源", value: "中央 Ketcher 画板" },
      { label: "执行方式", value: "读取画板并同步到 SMILES 输入" },
    ];
  }
  if (item.action === "scscore") {
    return [
      { label: "输入类型", value: "单分子 SMILES" },
      { label: "输出", value: scscore.value && scscore.value !== "evaluating" ? scscore.value : "SCScore" },
    ];
  }
  if (item.action === "fast-filter") {
    return [
      { label: "输入类型", value: "反应 SMILES" },
      { label: "输出", value: fastFilterScore.value && fastFilterScore.value !== "evaluating" ? fastFilterScore.value : "可行性得分" },
    ];
  }
  if (item.action === "atom-map") {
    return [
      { label: "输入类型", value: "反应 SMILES" },
      { label: "后端", value: "rxnmapper" },
    ];
  }
  if (item.action === "classify") {
    return [
      { label: "输入类型", value: "反应 SMILES" },
      { label: "返回数量", value: "10 条" },
    ];
  }
  if (item.action === "sites") {
    return [
      { label: "输入类型", value: "单分子 SMILES" },
      { label: "输出", value: "芳香 C-H 位点排序" },
    ];
  }
  if (item.action === "qm") {
    return [
      { label: "输入类型", value: "单分子 SMILES" },
      { label: "输出", value: "QM 描述符" },
    ];
  }
  if (item.action === "results") {
    return [
      { label: "数据来源", value: "我的结果" },
      { label: "执行方式", value: "本页刷新任务统计" },
    ];
  }
  if (item.action === "status") {
    return [
      { label: "数据来源", value: "模型与 worker 状态" },
      { label: "执行方式", value: "本页刷新服务状态" },
    ];
  }
  if (item.action === "template") {
    return [
      { label: "数据来源", value: "模板集与属性" },
      { label: "执行方式", value: "本页刷新模板统计" },
    ];
  }
  if (item.action === "banlist") {
    return [
      { label: "数据来源", value: "禁用化合物和禁用反应" },
      { label: "执行方式", value: "本页刷新规则统计" },
    ];
  }
  return [];
});

const reactionClassHeaders = [
  { key: "rank", title: "排序", align: "center" },
  { key: "reaction_num", title: "反应编号", align: "center" },
  { key: "reaction_superclassname", title: "反应类别（一级）", align: "center" },
  { key: "reaction_classname", title: "反应类别（二级）", align: "center" },
  { key: "reaction_name", title: "反应名称（三级）", align: "center" },
  { key: "prediction_certainty", title: "预测置信度", align: "center" },
];

const directRunResultHeaders = [
  { key: "field", title: "字段", align: "start" },
  { key: "value", title: "结果", align: "start" },
];

const canRunTreeBuilder = computed(
  () => routeReadiness.value.ready && !!currentInput.value && inputType.value === "mol" && !invalidStructureSyntax.value && treeStatus.value !== "submitting"
);

const reactionRequiredActions = ["context", "impurity", "selectivity"];
const moleculeRequiredActions = ["interactive-planner", "retro-prediction", "buyables", "scscore", "solpred", "solscreen", "sites", "qm"];
const workspaceActions = ["drawing", "route-results", "results", "status", "template", "banlist"];

const selectedModuleDisabled = computed(() => {
  const item = selectedModuleItem.value;
  if (isRunning.value) return true;
  if (item.action === "tree-builder") return !canRunTreeBuilder.value;
  if (moleculeRequiredActions.includes(item.action)) return !currentInput.value || inputType.value !== "mol" || invalidStructureSyntax.value;
  if (item.action === "forward") return !currentInput.value || invalidStructureSyntax.value;
  if (reactionRequiredActions.includes(item.action)) return !currentInput.value || inputType.value !== "rxn" || invalidStructureSyntax.value;
  if (["fast-filter", "atom-map", "classify"].includes(item.action)) return !currentInput.value || inputType.value !== "rxn";
  if (workspaceActions.includes(item.action)) return false;
  return true;
});

const selectedModuleRunLabel = computed(() => {
  const item = selectedModuleItem.value;
  if (item.action === "tree-builder") return "构建路线树";
  if (item.action === "interactive-planner") return "提交规划任务";
  if (item.action === "retro-prediction") return "预测前体";
  if (item.action === "route-results") return "刷新路线结果";
  if (item.action === "drawing") return "同步结构";
  if (item.action === "buyables") return "检索原料";
  if (item.action === "scscore") return scscore.value && scscore.value !== "evaluating" ? "重新评估" : "评估";
  if (item.action === "solpred") return "预测溶解度";
  if (item.action === "solscreen") return "筛选溶剂";
  if (item.action === "fast-filter") return fastFilterScore.value && fastFilterScore.value !== "evaluating" ? "重新计算" : "计算";
  if (item.action === "atom-map") return "生成映射";
  if (item.action === "classify") return "运行分类";
  if (item.action === "context") return "推荐条件";
  if (item.action === "forward") return "预测产物";
  if (item.action === "impurity") return "预测杂质";
  if (item.action === "selectivity") return "预测选择性";
  if (item.action === "sites") return "预测位点";
  if (item.action === "qm") return "计算描述符";
  if (item.action === "results") return "刷新结果";
  if (item.action === "status") return "刷新状态";
  if (item.action === "template") return "刷新模板";
  if (item.action === "banlist") return "刷新规则";
  return "运行";
});

const routeTaskState = computed(() => {
  if (treeStatus.value === "submitting") {
    return {
      color: "primary",
      icon: "mdi-progress-clock",
      label: "提交中",
      title: "路线树任务提交中",
      subtitle: "正在把目标结构和小模块参数提交给 ASKCOS。",
      nodeTitle: "正在提交",
      nodeText: "等待后端返回任务 ID。",
    };
  }
  if (treeStatus.value === "error") {
    return {
      color: "red",
      icon: "mdi-alert-circle-outline",
      label: "失败",
      title: "路线任务未提交成功",
      subtitle: runMessage.value || "当前账号或服务状态不能提交路线树任务。",
      nodeTitle: "任务失败",
      nodeText: "没有生成可展示的路线结果。",
    };
  }
  if (treeStatus.value === "finished") {
    return {
      color: "primary",
      icon: "mdi-check-circle-outline",
      label: "已完成",
      title: "路线树已完成",
      subtitle: "可进入结果列表查看完整路线树。",
      nodeTitle: "结果可查看",
      nodeText: treeResultId.value ? `结果 ID：${treeResultId.value}` : "结果已经返回。",
    };
  }
  return {
    color: "primary",
    icon: "mdi-check-circle-outline",
    label: "已提交",
    title: "路线树任务已提交",
    subtitle: "路线结果由 ASKCOS 后台生成，请进入结果列表查看完整路线树。",
    nodeTitle: "后台生成中",
    nodeText: treeTaskId.value ? `任务 ID：${treeTaskId.value}` : "等待队列返回真实路线树结果。",
  };
});

const genericRunTitle = computed(() => {
  if (runningAction.value) return "运行中";
  if (runMessage.value) return "已更新";
  return "准备就绪";
});
const genericRunMessage = computed(() => {
  const item = selectedModuleItem.value;
  if (reactionRequiredActions.includes(item.action)) return "该小模块需要输入反应 SMILES，例如 反应物>>产物。";
  if (moleculeRequiredActions.includes(item.action)) return "该小模块需要输入单分子 SMILES。";
  if (workspaceActions.includes(item.action)) return "该小模块会在当前工作台内刷新真实 ASKCOS 状态或同步当前结构。";
  return "选择小模块并输入有效结构后即可运行。";
});

const selectModule = (key) => {
  selectedModuleKey.value = key;
  const module = moduleGroups.value.find((item) => item.key === key);
  selectedModuleItemKey.value = module?.items?.[0]?.key || "";
  runMessage.value = "";
};

const selectModuleItem = (item) => {
  selectedModuleItemKey.value = item.key;
  runMessage.value = "";
};

const toggleModulePicker = () => {
  modulePickerExpanded.value = !modulePickerExpanded.value;
};

const normalizeNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
};

const buildTreeRequestBody = (targetSmiles) => {
  const body = JSON.parse(JSON.stringify(settingsStore.tree_builder_settings || {}));
  body.smiles = targetSmiles;
  body.description = treeJobName.value || targetSmiles;
  body.expand_one_options = body.expand_one_options || {};
  body.build_tree_options = body.build_tree_options || {};
  body.enumerate_paths_options = body.enumerate_paths_options || {};
  body.build_tree_options.expansion_time = normalizeNumber(treeSettings.value.expansionTime, 1200, 60, 3600);
  body.build_tree_options.max_depth = normalizeNumber(treeSettings.value.maxDepth, 12, 3, 20);
  body.build_tree_options.max_branching = normalizeNumber(treeSettings.value.maxBranching, 50, 1, 200);
  body.build_tree_options.return_first = false;
  body.expand_one_options.template_max_count = normalizeNumber(treeSettings.value.templateCount, 1000, 10, 5000);
  body.expand_one_options.template_max_cum_prob = normalizeNumber(treeSettings.value.templateCumProb, 0.999, 0.1, 1);
  body.expand_one_options.filter_threshold = normalizeNumber(treeSettings.value.minPlausibility, 0.75, 0, 1);
  body.expand_one_options.fast_filter_threshold = body.expand_one_options.filter_threshold;
  body.expand_one_options.use_fast_filter = true;
  body.enumerate_paths_options.max_paths = normalizeNumber(treeSettings.value.maxPaths, 10, 3, 10);
  body.enumerate_paths_options.sorting_metric = "score";
  body.enumerate_paths_options.score_trees = true;
  body.enumerate_paths_options.cluster_trees = true;
  applyHighQualityRoutePolicy(body);
  delete body.expand_one_options.group_by_strategy;
  delete body.expand_one_options.fast_filter_threshold;
  return body;
};

const readCurrentStructure = async () => {
  if (currentInput.value && !invalidStructureSyntax.value) return currentInput.value;
  const nextSmiles = await inlineKetcherRef.value?.readSmilesFromEditor?.();
  if (nextSmiles) {
    smilesInput.value = nextSmiles;
    structureIsValid.value = true;
  }
  return nextSmiles || "";
};

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const pollTreeResultInBackground = async (taskId) => {
  try {
    for (let attempt = 0; attempt < 720; attempt += 1) {
      const status = await API.get(unifiedRouteStatusEndpoint(taskId), null, false);
      if (status.status === "completed") {
        const selectedCount = status.selected_route_count ?? status.summary?.selected_route_count;
        treeResultId.value = taskId;
        treeStatus.value = "finished";
        runMessage.value = selectedCount
          ? `统一路线池已输出 ${selectedCount} 条闭合路线，可进入结果列表查看。`
          : "统一路线池任务已完成，可进入结果列表查看。";
        return;
      }
      if (isJobTerminal(status.status) || status.status === "waiting_for_engine") {
        treeResultId.value = taskId;
        treeStatus.value = status.status;
        runMessage.value = `${jobStateLabel(status.status)}，进度和实际结果已保存到任务列表。`;
        return;
      }
      await wait(10000);
    }
    runMessage.value = "统一路线池仍在运行，可稍后进入结果列表查看。";
  } catch (error) {
    console.error("Could not poll unified route result:", error);
    runMessage.value = API.toErrorObject(error).string_error;
  }
};

const buildTreeFromCurrentStructure = async () => {
  if (!(await refreshRouteReadiness())) return;
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "tree-builder";
  treeStatus.value = "submitting";
  runMessage.value = "";
  treeTaskId.value = "";
  treeResultId.value = "";
  try {
    const json = await API.post(
      UNIFIED_ROUTE_ENDPOINT,
      buildUnifiedRouteRequestBody(buildTreeRequestBody(targetSmiles))
    );
    treeTaskId.value = json?.job_id || json?.task_id || json;
    treeStatus.value = "submitted";
    runMessage.value = "任务已提交，ASKCOS MCTS 与 RetroStar 正在并行搜索。";
    if (treeTaskId.value) {
      pollTreeResultInBackground(treeTaskId.value);
    }
  } catch (error) {
    console.error("Failed to submit tree builder job:", error);
    treeStatus.value = "error";
    runMessage.value = API.toErrorObject(error, "路线树任务提交失败，请检查输入和后端服务状态。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runInteractivePlanner = async () => {
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "interactive-planner";
  treeStatus.value = "submitting";
  runMessage.value = "";
  treeTaskId.value = "";
  treeResultId.value = "";
  try {
    const body = buildTreeRequestBody(targetSmiles);
    Object.assign(body.expand_one_options, settingsStore.interactive_path_planner_settings || {});
    body.description = treeJobName.value || `IPP ${targetSmiles}`;
    applyHighQualityRoutePolicy(body);
    delete body.expand_one_options.group_by_strategy;
    delete body.expand_one_options.fast_filter_threshold;
    const json = await API.post(
      UNIFIED_ROUTE_ENDPOINT,
      buildUnifiedRouteRequestBody(body)
    );
    treeTaskId.value = json?.job_id || json?.task_id || json;
    treeStatus.value = "submitted";
    runMessage.value = "统一路线池任务已提交，可在结果列表继续查看。";
    if (treeTaskId.value) {
      pollTreeResultInBackground(treeTaskId.value);
    }
  } catch (error) {
    console.error("Failed to submit interactive planner job:", error);
    treeStatus.value = "error";
    runMessage.value = API.toErrorObject(error, "交互式路线规划任务提交失败，请检查输入和后端服务状态。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const evaluateScscore = async () => {
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "scscore";
  scscore.value = "evaluating";
  try {
    const json = await API.post("/api/scscore/call-sync", { smiles: targetSmiles });
    scscore.value = Number(json.result).toFixed(3);
    runMessage.value = `SCScore：${scscore.value}`;
  } catch (error) {
    console.error("Could not evaluate SCScore:", error);
    runMessage.value = API.toErrorObject(error, "SCScore 评估失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const evaluateFastFilter = async () => {
  const parts = currentInput.value.split(">");
  if (parts.length < 3) return;
  runningAction.value = "fast-filter";
  fastFilterScore.value = "evaluating";
  try {
    const output = await API.post("/api/fast-filter/call-sync", {
      smiles: [parts[0], parts[parts.length - 1]],
    });
    fastFilterScore.value = Number(output.result.score).toFixed(3);
    runMessage.value = `反应可行性得分：${fastFilterScore.value}`;
  } catch (error) {
    console.error("Could not evaluate fast filter:", error);
    runMessage.value = API.toErrorObject(error, "反应可行性计算失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const generateAtomMap = async () => {
  runningAction.value = "atom-map";
  mappedSmiles.value = "evaluating";
  try {
    const output = await API.runCeleryTask("/api/atom-map/controller/call-async", {
      backend: "rxnmapper",
      smiles: [currentInput.value],
    });
    mappedSmiles.value = output.result?.[0] || "";
    runMessage.value = mappedSmiles.value ? `Mapped SMILES：${mappedSmiles.value}` : "原子映射已完成。";
  } catch (error) {
    console.error("Could not generate atom mapping:", error);
    runMessage.value = API.toErrorObject(error, "原子映射失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const classifyReaction = async () => {
  runningAction.value = "classify";
  reactionClassStatus.value = "evaluating";
  reactionClassRows.value = [];
  try {
    const output = await API.runCeleryTask("/api/reaction-classification/call-async", {
      smiles: [currentInput.value],
      num_results: 10,
    });
    reactionClassRows.value = output.result || [];
    reactionClassStatus.value = output.status === "FAILED" ? "failed" : "ok";
    runMessage.value = reactionClassRows.value.length ? "反应分类已完成。" : "未返回分类结果。";
  } catch (error) {
    console.error("Could not classify reaction:", error);
    reactionClassStatus.value = "failed";
    runMessage.value = API.toErrorObject(error, "反应分类失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const parseReactionInput = () => {
  const parts = currentInput.value.split(">");
  if (parts.length >= 3) {
    return {
      reactants: parts[0],
      reagents: parts.slice(1, -1).join(">"),
      product: parts[parts.length - 1],
    };
  }
  return {
    reactants: currentInput.value,
    reagents: "",
    product: "",
  };
};

const setDirectResultSummary = (rows) => {
  directRunResultRows.value = rows
    .map((row) => ({ field: row.field, value: toDisplayValue(row.value) }))
    .filter((row) => row.value !== undefined && row.value !== null && row.value !== "");
};

const toResultArray = (output) => {
  if (Array.isArray(output)) return output;
  if (Array.isArray(output?.result)) return output.result;
  return [];
};

const toDisplayValue = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value.toString() : undefined;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const firstValue = (source, keys) => {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return undefined;
};

const runRetroPrediction = async () => {
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "retro-prediction";
  directRunResultRows.value = [];
  try {
    const output = await API.post("/api/tree-search/expand-one/call-sync-without-token", {
      smiles: targetSmiles,
      retro_backend_options: [
        {
          retro_backend: directSettings.value.retroModel,
          max_num_templates: normalizeNumber(directSettings.value.retroTemplateCount, 100, 1, 1000),
          max_cum_prob: normalizeNumber(directSettings.value.retroCumProb, 0.999, 0.1, 1),
          retro_model_name: directSettings.value.retroTrainingSet,
        },
      ],
      retro_rerank_backend: directSettings.value.retroPrecursorScoring,
      atom_map_backend: "rxnmapper",
      use_fast_filter: true,
      fast_filter_threshold: normalizeNumber(directSettings.value.retroMinPlausibility, 0.1, 0, 1),
      cluster_precursors: false,
      return_reacting_atoms: false,
      selectivity_check: false,
    });
    const results = toResultArray(output);
    const first = results[0] || {};
    runMessage.value = `一步逆合成预测完成：${results.length} 条候选。`;
    setDirectResultSummary([
      { field: "模型", value: `${directSettings.value.retroModel} / ${directSettings.value.retroTrainingSet}` },
      { field: "候选数量", value: results.length },
      { field: "首条前体", value: firstValue(first, ["outcome", "smiles", "reactants", "mapped_smiles"]) },
      { field: "首条评分", value: firstValue(first, ["score", "prob", "plausibility", "template_score"]) },
    ]);
  } catch (error) {
    console.error("Could not run one-step retrosynthesis:", error);
    runMessage.value = API.toErrorObject(error, "一步逆合成预测失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runDrawingSync = async () => {
  runningAction.value = "drawing";
  directRunResultRows.value = [];
  try {
    const targetSmiles = await readCurrentStructure();
    if (!targetSmiles) {
      runMessage.value = "当前画板没有可读取结构。";
      return;
    }
    smilesInput.value = targetSmiles;
    structureIsValid.value = SAFE_STRUCTURE_PATTERN.test(targetSmiles);
    runMessage.value = "结构已从中央画板同步到 SMILES 输入。";
    setDirectResultSummary([
      { field: "结构类型", value: targetSmiles.includes(">") ? "反应 SMILES" : "单分子 SMILES" },
      { field: "当前 SMILES", value: targetSmiles },
    ]);
  } catch (error) {
    console.error("Could not sync structure from Ketcher:", error);
    runMessage.value = API.toErrorObject(error, "结构同步失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runBuyablesSearch = async () => {
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "buyables";
  directRunResultRows.value = [];
  try {
    const results = await getBuyables(
      targetSmiles,
      null,
      null,
      normalizeNumber(directSettings.value.buyablesReturnLimit, 20, 1, 100),
      normalizeNumber(directSettings.value.buyablesSimilarity, 1, 0, 1)
    );
    const rows = Array.isArray(results) ? results : results?.results || results?.buyables || [];
    const first = rows[0] || {};
    runMessage.value = `商业原料检索完成：${rows.length} 条结果。`;
    setDirectResultSummary([
      { field: "返回数量", value: rows.length },
      { field: "首条来源", value: first.source },
      { field: "首条价格", value: first.ppg },
      { field: "首条库存", value: first.availability || first.properties?.availability },
    ]);
  } catch (error) {
    console.error("Could not search buyables:", error);
    runMessage.value = API.toErrorObject(error, "商业原料检索失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const solubilityEndpoint = () => {
  if (directSettings.value.solpredModel === "solprop") return "/api/solubility/fusion-cycle/call-async";
  if (directSettings.value.solpredModel === "fastsolv") return "/api/fastsolv/call-async";
  return "/api/solubility/batch/call-async";
};

const solubilityBody = (soluteSmiles) => {
  const solvent = directSettings.value.solpredSolvent || "O";
  const temperature = normalizeNumber(directSettings.value.solpredTemperature, 298, 200, 500);
  if (directSettings.value.solpredModel === "legacy") {
    return {
      task_list: [{
        solvent,
        solute: soluteSmiles,
        temp: temperature,
        ref_solvent: null,
        ref_solubility: null,
        ref_temp: null,
        hsub298: null,
        cp_gas_298: null,
        cp_solid_298: null,
      }],
    };
  }
  const body = {
    solvent_smiles: [solvent],
    solute_smiles: [soluteSmiles],
    temperature: [temperature],
  };
  if (directSettings.value.solpredDensity !== "" && directSettings.value.solpredModel === "solprop") {
    body.density = [Number(directSettings.value.solpredDensity)];
  }
  return body;
};

const runSolubilityPrediction = async () => {
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "solpred";
  directRunResultRows.value = [];
  try {
    const output = await API.runCeleryTask(solubilityEndpoint(), solubilityBody(targetSmiles));
    const results = toResultArray(output);
    const first = results[0] || {};
    runMessage.value = `溶解度预测完成：${results.length} 条结果。`;
    setDirectResultSummary([
      { field: "模型", value: directSettings.value.solpredModel },
      { field: "溶剂", value: directSettings.value.solpredSolvent },
      { field: "温度 K", value: directSettings.value.solpredTemperature },
      { field: "首条结果", value: firstValue(first, ["Solubility", "Solubility_mg_ml", "s_298", "st_1", "st_2"]) },
    ]);
  } catch (error) {
    console.error("Could not predict solubility:", error);
    runMessage.value = API.toErrorObject(error, "溶解度预测失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const parseTemperatureList = (value) =>
  String(value || "298")
    .split(/[\s,;，；]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));

const runSolventScreen = async () => {
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "solscreen";
  directRunResultRows.value = [];
  try {
    const selectedSet = solventSets[directSettings.value.solscreenSet] || solventSets["集合 1"] || [];
    const limit = normalizeNumber(directSettings.value.solscreenMaxSolvents, 8, 1, 30);
    const solvents = selectedSet.slice(0, limit);
    const temperatures = parseTemperatureList(directSettings.value.solscreenTemperatures);
    const taskList = temperatures.flatMap((temp) =>
      solvents.map((solvent) => ({
        solvent,
        solute: targetSmiles,
        temp,
        ref_solvent: null,
        ref_solubility: null,
        ref_temp: null,
        hsub298: null,
        cp_gas_298: null,
        cp_solid_298: null,
      }))
    );
    const output = await API.runCeleryTask("/api/solubility/batch/call-async", { task_list: taskList });
    const results = toResultArray(output);
    runMessage.value = `溶剂筛选完成：${results.length} 条结果。`;
    setDirectResultSummary([
      { field: "溶剂集合", value: directSettings.value.solscreenSet },
      { field: "任务数量", value: taskList.length },
      { field: "返回数量", value: results.length },
      { field: "首条溶剂", value: firstValue(results[0], ["Solvent", "solvent", "solvent_smiles"]) },
    ]);
  } catch (error) {
    console.error("Could not screen solvents:", error);
    runMessage.value = API.toErrorObject(error, "溶剂筛选失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runRouteResultsRefresh = async () => {
  runningAction.value = "route-results";
  directRunResultRows.value = [];
  try {
    const results = await API.get("/api/results/list", null, false);
    const rows = Array.isArray(results) ? results : [];
    const routeRows = rows.filter((item) => ["tree_builder", "ipp", "graph_optimization"].includes(item.result_type));
    const latest = routeRows[0] || {};
    runMessage.value = `路线结果已刷新：${routeRows.length} 条路线相关结果。`;
    setDirectResultSummary([
      { field: "路线结果数", value: routeRows.length },
      { field: "最近结果 ID", value: latest.result_id },
      { field: "最近状态", value: latest.result_state },
      { field: "最近类型", value: latest.result_type },
    ]);
  } catch (error) {
    console.error("Could not refresh route results:", error);
    runMessage.value = API.toErrorObject(error, "路线结果刷新失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runResultsRefresh = async () => {
  runningAction.value = "results";
  directRunResultRows.value = [];
  try {
    const results = await API.get("/api/results/list", null, false);
    const rows = Array.isArray(results) ? results : [];
    const latest = rows[0] || {};
    runMessage.value = `任务结果已刷新：${rows.length} 条。`;
    setDirectResultSummary([
      { field: "结果总数", value: rows.length },
      { field: "最近结果 ID", value: latest.result_id },
      { field: "最近任务类型", value: latest.result_type },
      { field: "最近状态", value: latest.result_state },
    ]);
  } catch (error) {
    console.error("Could not refresh results:", error);
    runMessage.value = API.toErrorObject(error, "结果刷新失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runStatusRefresh = async () => {
  runningAction.value = "status";
  directRunResultRows.value = [];
  try {
    const json = await API.get("/api/admin/get-backend-status", null, false);
    const modules = json?.modules || {};
    const moduleRows = Array.isArray(modules) ? modules : Object.values(modules);
    const readyCount = moduleRows.filter((item) => item?.ready || item?.status === "ready").length;
    runMessage.value = `服务状态已刷新：${moduleRows.length} 个模块。`;
    setDirectResultSummary([
      { field: "模块数量", value: moduleRows.length },
      { field: "Ready 数量", value: readyCount },
      { field: "刷新时间", value: new Date().toLocaleString() },
    ]);
  } catch (error) {
    console.error("Could not refresh service status:", error);
    runMessage.value = API.toErrorObject(error, "服务状态刷新失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runTemplateRefresh = async () => {
  runningAction.value = "template";
  directRunResultRows.value = [];
  try {
    const json = await API.get("/api/template/sets/", null, false);
    const templateSets = json?.template_sets || [];
    const attributeKeys = json?.attributes ? Object.keys(json.attributes) : [];
    runMessage.value = `模板信息已刷新：${templateSets.length} 个模板集。`;
    setDirectResultSummary([
      { field: "模板集数量", value: templateSets.length },
      { field: "首个模板集", value: templateSets[0] },
      { field: "属性集数量", value: attributeKeys.length },
    ]);
  } catch (error) {
    console.error("Could not refresh template metadata:", error);
    runMessage.value = API.toErrorObject(error, "模板信息刷新失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runBanlistRefresh = async () => {
  runningAction.value = "banlist";
  directRunResultRows.value = [];
  try {
    const [chemicals, reactions] = await Promise.all([
      API.get("/api/banlist/chemicals/get", null, false),
      API.get("/api/banlist/reactions/get", null, false),
    ]);
    const chemicalRows = Array.isArray(chemicals) ? chemicals : [];
    const reactionRows = Array.isArray(reactions) ? reactions : [];
    runMessage.value = `禁用规则已刷新：化合物 ${chemicalRows.length} 条，反应 ${reactionRows.length} 条。`;
    setDirectResultSummary([
      { field: "禁用化合物", value: chemicalRows.length },
      { field: "禁用反应", value: reactionRows.length },
      { field: "活跃化合物", value: chemicalRows.filter((item) => item.active !== false).length },
      { field: "活跃反应", value: reactionRows.filter((item) => item.active !== false).length },
    ]);
  } catch (error) {
    console.error("Could not refresh banlist:", error);
    runMessage.value = API.toErrorObject(error, "禁用列表刷新失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runContextRecommendation = async () => {
  const { reactants, reagents, product } = parseReactionInput();
  if (!reactants || !product) return;
  runningAction.value = "context";
  directRunResultRows.value = [];
  try {
    const count = normalizeNumber(directSettings.value.contextResultCount, 10, 1, 50);
    let output;
    if (directSettings.value.contextModel === "neuralnetworkv2") {
      output = await API.runCeleryTask("/api/context/quarc/single-query/call-async", {
        reactants,
        products: product,
        reagents: reagents ? [reagents] : [],
        num_results: count,
        model: "graph",
      });
      const predictions = output?.result?.predictions || [];
      runMessage.value = `条件推荐完成：${predictions.length} 条结果。`;
      setDirectResultSummary([
        { field: "模型", value: "QUARC" },
        { field: "返回数量", value: predictions.length },
        { field: "首条温度", value: predictions[0]?.temperature },
        { field: "首条试剂", value: (predictions[0]?.agents || []).join(".") },
      ]);
      return;
    }

    output = await API.runCeleryTask("/api/context-recommender/v1/condition-uncleaned/call-async", {
      smiles: `${reactants}>>${product}`,
      n_conditions: count,
      with_smiles: false,
      return_scores: true,
    });
    const conditions = output?.result?.conditions || [];
    runMessage.value = `条件推荐完成：${conditions.length} 条结果。`;
    setDirectResultSummary([
      { field: "模型", value: "Neural Network" },
      { field: "返回数量", value: conditions.length },
      { field: "首条温度", value: conditions[0]?.[0] },
      { field: "首条溶剂", value: conditions[0]?.[1] },
      { field: "首条试剂", value: conditions[0]?.[2] },
    ]);
  } catch (error) {
    console.error("Could not recommend conditions:", error);
    runMessage.value = API.toErrorObject(error, "反应条件推荐失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runForwardPrediction = async () => {
  const { reactants, reagents } = parseReactionInput();
  if (!reactants) return;
  runningAction.value = "forward";
  directRunResultRows.value = [];
  try {
    const body = {
      smiles: [reactants],
      backend: directSettings.value.forwardBackend,
      model_name: directSettings.value.forwardModelName,
    };
    if (directSettings.value.forwardReagents || reagents) {
      body.reagents = directSettings.value.forwardReagents || reagents;
    }
    if (directSettings.value.forwardSolvent) {
      body.solvent = directSettings.value.forwardSolvent;
    }
    const output = await API.runCeleryTask("/api/forward/controller/call-async", body);
    const results = Array.isArray(output?.result?.[0])
      ? output.result[0]
      : toResultArray(output);
    runMessage.value = `正向产物预测完成：${results.length} 条结果。`;
    setDirectResultSummary([
      { field: "模型", value: `${body.backend} / ${body.model_name}` },
      { field: "返回数量", value: results.length },
      { field: "首条产物", value: results[0]?.outcome || results[0]?.smiles },
      { field: "首条概率", value: results[0]?.prob || results[0]?.score },
    ]);
  } catch (error) {
    console.error("Could not predict products:", error);
    runMessage.value = API.toErrorObject(error, "正向产物预测失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runImpurityPrediction = async () => {
  const { reactants, reagents, product } = parseReactionInput();
  if (!reactants) return;
  runningAction.value = "impurity";
  directRunResultRows.value = [];
  try {
    const body = {
      rct_smi: reactants,
      prd_smi: product,
      rea_smi: reagents,
      predictor_model_name: directSettings.value.forwardModelName,
      predictor_backend: directSettings.value.forwardBackend,
      topn_outcome: normalizeNumber(directSettings.value.impurityTopk, 3, 1, 20),
      check_mapping: !!directSettings.value.impurityCheckMapping,
      insp_threshold: Number(directSettings.value.impurityThreshold) || 0.1,
      inspector: directSettings.value.impurityInspector,
      atom_map_backend: "indigo",
    };
    const output = await API.runCeleryTask("/api/impurity-predictor/call-async", body);
    const results = output?.result?.predict_expand || [];
    runMessage.value = `杂质预测完成：${results.length} 条候选。`;
    setDirectResultSummary([
      { field: "返回数量", value: results.length },
      { field: "首条杂质", value: results[0]?.prd_smiles },
      { field: "首条机制", value: results[0]?.modes_name },
    ]);
  } catch (error) {
    console.error("Could not predict impurities:", error);
    runMessage.value = API.toErrorObject(error, "杂质预测失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runSelectivityPrediction = async () => {
  const { reactants, product } = parseReactionInput();
  if (!reactants || !product) return;
  runningAction.value = "selectivity";
  directRunResultRows.value = [];
  try {
    const output = await API.runCeleryTask("/api/general-selectivity/controller/call-async", {
      smiles: `${reactants}>>${product}`,
      backend: directSettings.value.selectivityBackend,
      atom_map_backend: directSettings.value.selectivityAtomMapBackend,
      no_map_reagents: !!directSettings.value.selectivityNoMapReagents,
      mapped: false,
      all_outcomes: false,
    });
    const results = toResultArray(output);
    runMessage.value = `区域选择性预测完成：${results.length} 条结果。`;
    setDirectResultSummary([
      { field: "返回数量", value: results.length },
      { field: "首条结构", value: results[0]?.smiles },
      { field: "首条概率", value: results[0]?.prob },
    ]);
  } catch (error) {
    console.error("Could not predict selectivity:", error);
    runMessage.value = API.toErrorObject(error, "区域选择性预测失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runSiteSelectivityPrediction = async () => {
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "sites";
  directRunResultRows.value = [];
  try {
    const output = await API.runCeleryTask("/api/site-selectivity/call-async", { smiles: [targetSmiles] });
    const results = Array.isArray(output?.result) ? output.result.flat() : [];
    runMessage.value = `芳香 C-H 位点预测完成：${results.length} 条结果。`;
    setDirectResultSummary([
      { field: "返回数量", value: results.length },
      { field: "首条任务", value: results[0]?.task },
      { field: "参考数量", value: results[0]?.references?.length },
    ]);
  } catch (error) {
    console.error("Could not predict sites:", error);
    runMessage.value = API.toErrorObject(error, "芳香 C-H 位点预测失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runQmDescriptors = async () => {
  const targetSmiles = await readCurrentStructure();
  if (!targetSmiles || targetSmiles.includes(">")) return;
  runningAction.value = "qm";
  directRunResultRows.value = [];
  try {
    const output = await API.runCeleryTask("/api/qm-descriptors/call-async", { smiles: [targetSmiles] });
    const results = toResultArray(output);
    runMessage.value = `QM 描述符计算完成：${results.length} 条结果。`;
    setDirectResultSummary([
      { field: "返回数量", value: results.length },
      { field: "首条 SMILES", value: results[0]?.smiles || targetSmiles },
      { field: "HOMO/LUMO", value: results[0]?.HOMO_LUMO },
    ]);
  } catch (error) {
    console.error("Could not compute QM descriptors:", error);
    runMessage.value = API.toErrorObject(error, "QM 描述符计算失败。").string_error;
  } finally {
    runningAction.value = "";
  }
};

const runSelectedModule = async () => {
  const item = selectedModuleItem.value;
  if (item.action === "tree-builder") {
    await buildTreeFromCurrentStructure();
    return;
  }
  if (item.action === "interactive-planner") {
    await runInteractivePlanner();
    return;
  }
  if (item.action === "retro-prediction") {
    await runRetroPrediction();
    return;
  }
  if (item.action === "route-results") {
    await runRouteResultsRefresh();
    return;
  }
  if (item.action === "drawing") {
    await runDrawingSync();
    return;
  }
  if (item.action === "buyables") {
    await runBuyablesSearch();
    return;
  }
  if (item.action === "scscore") {
    await evaluateScscore();
    return;
  }
  if (item.action === "solpred") {
    await runSolubilityPrediction();
    return;
  }
  if (item.action === "solscreen") {
    await runSolventScreen();
    return;
  }
  if (item.action === "fast-filter") {
    await evaluateFastFilter();
    return;
  }
  if (item.action === "atom-map") {
    await generateAtomMap();
    return;
  }
  if (item.action === "classify") {
    await classifyReaction();
    return;
  }
  if (item.action === "context") {
    await runContextRecommendation();
    return;
  }
  if (item.action === "forward") {
    await runForwardPrediction();
    return;
  }
  if (item.action === "impurity") {
    await runImpurityPrediction();
    return;
  }
  if (item.action === "selectivity") {
    await runSelectivityPrediction();
    return;
  }
  if (item.action === "sites") {
    await runSiteSelectivityPrediction();
    return;
  }
  if (item.action === "qm") {
    await runQmDescriptors();
    return;
  }
  if (item.action === "results") {
    await runResultsRefresh();
    return;
  }
  if (item.action === "status") {
    await runStatusRefresh();
    return;
  }
  if (item.action === "template") {
    await runTemplateRefresh();
    return;
  }
  if (item.action === "banlist") {
    await runBanlistRefresh();
  }
};

const handleEditorCommit = (value) => {
  structureIsValid.value = !!value;
};

const handleStructureConvert = async (value) => {
  if (!value) return;
  convertedStructureSmiles.value = value;
  smilesInput.value = value;
  structureIsValid.value = true;
  try {
    await inlineKetcherRef.value?.setSmilesToEditor?.(value, {
      statusMessage: "SMILES 已转换并载入下方编辑窗口。",
    });
  } catch (error) {
    structureIsValid.value = false;
    console.error("Could not convert SMILES into inline Ketcher:", error);
  }
};

const clearCurrentStructure = async () => {
  await inlineKetcherRef.value?.clearEditor?.();
  smilesInput.value = "";
  convertedStructureSmiles.value = "";
  structureIsValid.value = null;
  runMessage.value = "";
  treeStatus.value = undefined;
};

watch(currentInput, (nextValue, previousValue) => {
  if (nextValue === previousValue) return;
  treeStatus.value = undefined;
  treeTaskId.value = "";
  treeResultId.value = "";
  reactionClassRows.value = [];
  directRunResultRows.value = [];
  runMessage.value = "";
});

onMounted(() => {
  void refreshRouteReadiness();
  const params = new URLSearchParams(window.location.search);
  const smiles = params.get("smiles");
  const taskName = params.get("task_name");
  if (smiles) {
    smilesInput.value = smiles;
    selectedModuleKey.value = "route-design";
    selectedModuleItemKey.value = "tree-builder";
    structureIsValid.value = SAFE_STRUCTURE_PATTERN.test(String(smiles).trim());
  }
  if (taskName) {
    treeJobName.value = taskName;
  }
});
</script>

<style scoped>
.synon-launchpad {
  --apple-blue: #007aff;
  --apple-blue-strong: #0066cc;
  --apple-blue-soft: rgba(0, 122, 255, 0.1);
  --apple-blue-line: rgba(0, 122, 255, 0.22);
  --apple-ink: #0f172a;
  --apple-muted: #64748b;
  --layout-gap: clamp(12px, 0.8vw, 18px);
  width: 100%;
  height: 100%;
  min-height: 0;
  margin-inline: auto;
  display: grid;
  grid-template-columns:
    clamp(184px, 10vw, 224px)
    minmax(720px, 1fr)
    clamp(350px, 20vw, 420px);
  gap: var(--layout-gap);
  align-items: start;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: visible;
}

.result-strip {
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(248, 250, 252, 0.82));
  border-radius: 28px;
  box-shadow: 0 18px 52px rgba(15, 23, 42, 0.055);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
}

.settings-panel,
.workbench-modules {
  border: 0;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.workbench-modules,
.settings-panel {
  height: 100%;
  max-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}

.settings-panel::-webkit-scrollbar,
.workbench-modules::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.settings-panel::-webkit-scrollbar-track,
.workbench-modules::-webkit-scrollbar-track {
  background: transparent;
}

.settings-panel::-webkit-scrollbar-thumb,
.workbench-modules::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.28);
}

.workbench-modules,
.settings-panel {
  padding: 0;
}

.primary-module-list,
.module-choice-list {
  display: grid;
  gap: clamp(8px, 0.55vw, 12px);
}

.primary-module-list {
  height: 100%;
  min-height: 0;
  grid-template-rows: repeat(var(--module-count), minmax(clamp(76px, 12dvh, 138px), 1fr));
  align-content: stretch;
  justify-items: stretch;
}

.primary-module-card,
.module-choice-card {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: var(--apple-ink);
  text-align: left;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.primary-module-card {
  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: clamp(10px, 0.72vw, 14px);
  align-items: center;
  min-height: 0;
  padding: clamp(10px, 0.84vw, 15px);
  border-radius: 16px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(247, 251, 255, 0.72)),
    rgba(255, 255, 255, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 8px 22px rgba(15, 23, 42, 0.035);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);
  backdrop-filter: blur(16px) saturate(1.15);
  overflow: hidden;
}

.primary-module-card::after {
  content: "";
  position: absolute;
  inset: 12px auto 12px 0;
  width: 3px;
  border-radius: 0 999px 999px 0;
  background: linear-gradient(180deg, rgba(0, 122, 255, 0.86), rgba(99, 179, 255, 0.56));
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 160ms ease, transform 160ms ease;
}

.primary-module-card:hover,
.module-choice-card:hover {
  transform: translateY(-1px);
  border-color: var(--apple-blue-line);
  background: rgba(239, 246, 255, 0.88);
}

.primary-module-card.active,
.module-choice-card.active {
  border-color: rgba(0, 122, 255, 0.34);
  background:
    linear-gradient(90deg, rgba(0, 122, 255, 0.16), rgba(255, 255, 255, 0.84) 62%),
    rgba(255, 255, 255, 0.78);
  box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.08);
}

.primary-module-card.active::after {
  opacity: 1;
  transform: translateX(0);
}

.primary-module-card:active,
.module-choice-card:active {
  transform: translateY(0) scale(0.99);
}

.primary-module-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: var(--apple-blue-strong);
  background:
    linear-gradient(145deg, rgba(0, 122, 255, 0.13), rgba(255, 255, 255, 0.52)),
    var(--apple-blue-soft);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.primary-module-copy,
.module-settings-title > div {
  min-width: 0;
}

.primary-module-copy {
  display: grid;
  align-self: center;
  gap: 4px;
}

.primary-module-copy strong,
.module-choice-card strong,
.settings-block strong,
.status-block strong {
  display: block;
  overflow-wrap: normal;
  word-break: keep-all;
  color: var(--apple-ink);
  font-size: clamp(13px, 0.74vw, 15px);
  line-height: 1.2;
}

.primary-module-copy small,
.module-choice-card small,
.settings-block span,
.status-block span {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
  color: var(--apple-muted);
  font-size: clamp(10px, 0.56vw, 12px);
  line-height: 1.25;
}

.structure-panel {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
}

.structure-input-module {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}

.molecule-canvas {
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: clamp(10px, 0.68vw, 13px);
  align-items: stretch;
  border-radius: 18px;
  background: transparent;
  overflow: visible;
}

.canvas-search-bar {
  min-width: 0;
  align-self: start;
  padding-inline: clamp(2px, 0.2vw, 4px);
}

.canvas-search-bar :deep(.v-field) {
  min-height: 42px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 8px 24px rgba(15, 23, 42, 0.035);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.canvas-search-bar :deep(.v-field__input) {
  min-height: 42px;
  padding-block: 8px;
}

.canvas-search-bar :deep(.v-input__append) {
  margin-inline-start: 12px;
}

.canvas-search-bar :deep(.v-input__append .v-btn) {
  min-width: 124px;
  min-height: 40px;
  box-shadow: 0 10px 22px rgba(0, 122, 255, 0.16);
}

.structure-drawing-board,
.route-display-board {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: clamp(10px, 0.72vw, 14px);
}

.structure-drawing-board {
  height: 100%;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
}

.structure-drawing-board :deep(.inline-ketcher-editor) {
  height: 100%;
}

.drawing-board-actions,
.route-display-actions,
.route-display-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.compact-drawing-actions {
  justify-content: flex-end;
  gap: 14px;
  padding-top: 0;
}

.compact-drawing-actions .v-btn {
  min-width: clamp(148px, 9vw, 190px);
  min-height: 40px;
  font-size: 14px;
  font-weight: 700;
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--apple-blue-strong);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.route-display-header h3 {
  margin: 0;
  color: var(--apple-ink);
  font-size: 18px;
  line-height: 1.25;
}

.route-display-header span {
  max-width: 520px;
  color: var(--apple-muted);
  font-size: 12px;
  line-height: 1.45;
}

.route-flow-preview {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 72px minmax(180px, 1fr);
  align-items: stretch;
  gap: 14px;
}

.route-node {
  min-height: 170px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.9);
  text-align: center;
}

.route-node small {
  color: var(--apple-blue-strong);
  font-weight: 700;
}

.route-node strong {
  color: var(--apple-ink);
  font-size: 18px;
}

.route-node span {
  color: var(--apple-muted);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.route-target-image {
  width: min(220px, 100%);
}

.route-connector {
  display: grid;
  place-items: center;
  color: var(--apple-blue-strong);
}

.structure-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 420px;
  padding: 18px;
  color: #64748b;
  text-align: center;
}

.structure-error-state strong {
  color: #b42318;
  font-size: 18px;
}

.settings-panel {
  display: flex;
  flex-direction: column;
  gap: clamp(8px, 0.55vw, 11px);
  min-height: 0;
}

.settings-block {
  padding: 0;
  border-radius: 0;
  background: transparent;
  border: 0;
}

.settings-block-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.module-picker-toggle {
  width: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  margin-bottom: 0;
}

.module-picker-toggle-icon {
  width: 30px;
  min-width: 30px;
  height: 30px;
  min-height: 30px;
  display: grid;
  place-items: center;
  margin-left: auto;
  border-radius: 999px;
  border: 1px solid rgba(0, 122, 255, 0.16);
  color: var(--apple-blue-strong);
  background:
    radial-gradient(circle at 32% 22%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 44%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.82), rgba(238, 246, 255, 0.72));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.86),
    0 8px 18px rgba(0, 122, 255, 0.1);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.module-picker-toggle-icon:hover {
  transform: translateY(-1px);
  border-color: rgba(0, 122, 255, 0.28);
  background:
    radial-gradient(circle at 32% 22%, rgba(255, 255, 255, 0.96), rgba(255, 255, 255, 0) 44%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.86), rgba(222, 238, 255, 0.84));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 10px 22px rgba(0, 122, 255, 0.14);
}

.module-picker-toggle-icon:active {
  transform: translateY(0) scale(0.97);
}

.module-picker-block.expanded .module-picker-toggle {
  margin-bottom: 8px;
}

.module-picker-chevron {
  color: var(--apple-blue-strong);
  transition: transform 160ms ease;
}

.module-picker-block.expanded .module-picker-chevron {
  transform: rotate(180deg);
}

.module-picker-collapse {
  display: grid;
  min-width: 0;
  overflow: visible;
}

.module-picker-slide-enter-active,
.module-picker-slide-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.module-picker-slide-enter-from,
.module-picker-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.module-choice-card {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  padding: 10px 11px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.68);
  box-shadow: none;
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.module-choice-card .v-icon {
  margin-top: 1px;
  color: var(--apple-blue-strong);
}

.action-settings-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: none;
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
}

.module-settings-title {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
}

.module-settings-title .v-icon {
  color: var(--apple-blue-strong);
}

.route-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.settings-panel .route-settings-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.route-settings-wide {
  grid-column: 1 / -1;
}

.param-list {
  display: grid;
  gap: 10px;
}

.param-list label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--apple-muted);
}

.param-list strong {
  color: var(--apple-ink);
}

.module-parameter-empty {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 10px;
  border-radius: 14px;
  color: var(--apple-muted);
  background: rgba(255, 255, 255, 0.88);
}

.run-selected-module-button {
  min-height: 40px;
  font-weight: 700;
}

.status-block {
  display: grid;
  gap: 8px;
  padding: 11px 12px;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(15, 23, 42, 0.06);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.result-strip {
  grid-column: 1 / -1;
  padding: 18px;
}

.direct-result-strip {
  max-height: min(32dvh, 360px);
  overflow: auto;
}

@media (max-width: 1120px) {
  .synon-launchpad {
    grid-template-columns:
      clamp(140px, 12vw, 166px)
      minmax(0, 1fr)
      clamp(300px, 25vw, 340px);
  }

  .workbench-modules,
  .settings-panel {
    padding: 0;
  }

  .primary-module-list,
  .module-choice-list {
    gap: 8px;
  }

  .primary-module-list {
    grid-template-rows: repeat(var(--module-count), minmax(clamp(68px, 11dvh, 118px), 1fr));
  }

  .primary-module-card {
    grid-template-columns: 30px minmax(0, 1fr);
    min-height: 0;
    padding: 10px;
    gap: 9px;
  }

  .primary-module-icon {
    width: 30px;
    height: 30px;
    border-radius: 10px;
  }

  .primary-module-copy strong {
    font-size: 14px;
  }

  .primary-module-copy small {
    font-size: 11px;
  }

  .compact-drawing-actions {
    gap: 10px;
  }

  .compact-drawing-actions .v-btn {
    min-width: 128px;
    min-height: 38px;
    font-size: 14px;
  }
}

@media (max-width: 960px) {
  .synon-launchpad {
    height: auto;
    min-height: calc(100dvh - 52px);
    grid-template-columns: clamp(120px, 16vw, 160px) minmax(0, 1fr);
    gap: 14px;
    padding: 10px;
    overflow: visible;
  }

  .structure-panel,
  .structure-input-module {
    height: auto;
  }

  .settings-panel {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(260px, 0.9fr) minmax(340px, 1.15fr) minmax(240px, 0.75fr);
    max-height: none;
    overflow: visible;
  }

  .workbench-modules {
    max-height: none;
  }
}

@media (max-width: 820px) {
  .synon-launchpad {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-panel,
  .workbench-modules,
  .result-strip {
    grid-column: auto;
  }

  .primary-module-list {
    height: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: none;
    grid-auto-rows: minmax(76px, auto);
    align-content: start;
  }

  .settings-panel,
  .route-flow-preview {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .synon-launchpad {
    padding: 12px;
  }

  .primary-module-list,
  .route-settings-grid,
  .route-display-header,
  .drawing-board-actions,
  .route-display-actions,
  .settings-block-header {
    grid-template-columns: minmax(0, 1fr);
  }

  .primary-module-list {
    display: grid;
  }

  .compact-drawing-actions {
    display: grid;
  }

  .compact-drawing-actions .v-btn {
    width: 100%;
    min-width: 0;
  }
}
</style>
