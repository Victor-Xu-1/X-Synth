<template>
  <module-workbench
    title="正向合成与条件"
    :modules="forwardModules"
    :active-module="tab"
    @select-module="replaceRoute"
  >
    <div class="tool-layout">
      <section class="tool-input-panel">
        <h2 class="tool-section-title">反应输入</h2>
        <v-form :disabled="pendingTasks > 0" @submit.prevent="predict">
          <v-text-field
            v-model="reactants"
            label="反应物"
            placeholder="SMILES"
            variant="outlined"
            density="comfortable"
            clearable
            data-cy="reactants"
          >
            <template #append-inner
              ><draw-button v-model:smiles="reactants"
            /></template>
          </v-text-field>
          <v-text-field
            v-if="mode !== 'forward' && mode !== 'sites'"
            v-model="product"
            label="产物"
            placeholder="SMILES"
            variant="outlined"
            density="comfortable"
            clearable
            data-cy="product"
          >
            <template #append-inner
              ><draw-button v-model:smiles="product"
            /></template>
          </v-text-field>
          <v-text-field
            v-if="
              mode !== 'sites' &&
              (mode !== 'context' || contextModel === 'neuralnetworkv2')
            "
            v-model="reagents"
            label="试剂 / 助剂"
            placeholder="SMILES"
            variant="outlined"
            density="comfortable"
            clearable
            data-cy="reagents"
          >
            <template #append-inner
              ><draw-button v-model:smiles="reagents"
            /></template>
          </v-text-field>
          <v-text-field
            v-if="mode !== 'context' && mode !== 'sites'"
            v-model="solvent"
            label="溶剂"
            placeholder="SMILES"
            variant="outlined"
            density="comfortable"
            clearable
            data-cy="solvent"
          >
            <template #append-inner
              ><draw-button v-model:smiles="solvent"
            /></template>
          </v-text-field>
          <v-select
            v-if="mode === 'context'"
            v-model="contextModel"
            label="条件推荐模型"
            variant="outlined"
            density="comfortable"
            :items="contextModels"
            data-cy="model"
            @update:model-value="clearContext"
          />
          <div v-if="reactants" class="forward-structure">
            <smiles-image :smiles="reactants" :show-error-image="false" />
          </div>
          <div
            v-if="product && mode !== 'forward' && mode !== 'sites'"
            class="forward-structure"
          >
            <smiles-image :smiles="product" :show-error-image="false" />
          </div>
          <p
            v-if="requestError"
            class="tool-error"
            role="alert"
            data-cy="forward-request-error"
          >
            {{ requestError }}
          </p>
          <div class="page-actions">
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              prepend-icon="mdi-play-outline"
              :loading="pendingTasks > 0"
              :disabled="!canPredict || !reactants?.trim()"
              data-cy="submit-button"
              >生成结果</v-btn
            >
            <v-tooltip v-if="mode !== 'sites'" text="计算设置" location="top">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-cog-outline"
                  variant="text"
                  aria-label="计算设置"
                  data-cy="settings"
                  :disabled="pendingTasks > 0"
                  @click="dialog = true"
                />
              </template>
            </v-tooltip>
            <v-tooltip text="清空当前结果" location="top">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-delete-sweep-outline"
                  variant="text"
                  aria-label="清空当前结果"
                  data-cy="clear-button"
                  :disabled="pendingTasks > 0"
                  @click="clear"
                />
              </template>
            </v-tooltip>
          </div>
        </v-form>
      </section>
      <section class="tool-result-panel">
        <h2 class="tool-section-title">计算结果</h2>
        <div v-if="!hasResults && pendingTasks === 0" class="workspace-empty">
          <v-icon icon="mdi-flask-outline" size="28" />
          <h2>暂无结果</h2>
        </div>
        <v-window v-else :model-value="tab" :touch="false">
          <v-window-item value="context">
            <ConditionRecommendation
              :results="contextResults"
              :models="contextModel"
              :pending="pendingTasks"
              :pendingRank="pendingRank"
              :evaluating="evaluating"
              :score="reactionScore"
              @go-to-forward="goToForward"
              @evaluate="evaluate"
            />
          </v-window-item>
          <v-window-item value="forward">
            <SynthesisPrediction
              :results="forwardResults"
              :models="forwardModel"
              :pending="pendingTasks"
              v-model:filename="forwardFileName"
              @download-forward="downloadForwardResults"
              @go-to-impurities="goToImpurity"
              @go-to-selectivity="goToSelectivity"
            />
          </v-window-item>
          <v-window-item value="impurity">
            <ImpurityPrediction
              :results="impurityResults"
              :pending="pendingTasks"
              :progress="impurityProgress"
              v-model:filename="impurityFileName"
              @download-impurity="downloadImpurityResults"
            />
          </v-window-item>
          <v-window-item value="selectivity">
            <Regioselectivity
              :results="selectivityResults"
              :pending="pendingTasks"
              v-model:filename="selectivityFileName"
              @download-selectivity="downloadSelectivityResults"
            />
          </v-window-item>
          <v-window-item value="sites">
            <SiteSelectivity
              ref="ssref"
              :results="filteredResults"
              :pending="pendingTasks"
              :siteResults="siteResults"
              @get-sites-refs="getSitesRefs"
              @update-selected-atoms="siteSelectedAtoms = $event"
              @update-result-query="siteResultsQuery = $event"
              @download-sites-refs="downloadSitesRefs"
            />
          </v-window-item>
        </v-window>
      </section>
    </div>
    <v-dialog
      v-model="dialog"
      max-width="600px"
      class="justify-center align-center"
    >
      <v-card class="pa-3 m-5">
        <template v-if="openSettingsPanel === 'condition-settings'">
          <v-card-title class="headline"> 条件推荐设置 </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12">
                <v-select
                  label="条件推荐模型"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                  data-cy="settings-cond-rec-model"
                  clearable
                  v-model="contextModel"
                  :items="[
                    { key: 'neuralnetwork', title: 'Neural Network' },
                    {
                      key: 'neuralnetworkv2',
                      title: 'QUARC (Quantity Prediction)',
                    },
                  ]"
                  item-title="title"
                  item-value="key"
                >
                </v-select>
              </v-col>

              <v-col cols="12">
                <v-text-field
                  label="结果数量"
                  prepend-inner-icon="mdi mdi-flask"
                  density="comfortable"
                  data-cy="settings-num-results"
                  variant="outlined"
                  placeholder="返回多少条条件推荐结果"
                  hide-details
                  clearable
                  type="number"
                  v-model="numContextResults"
                ></v-text-field>
              </v-col>
            </v-row>
          </v-card-text>
        </template>
        <template v-if="openSettingsPanel === 'forward-settings'">
          <v-card-title class="headline"> 正向预测设置 </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12">
                <v-select
                  label="正向预测模型"
                  v-model="forwardModel"
                  density="comfortable"
                  hide-details
                  data-cy="settings-forward-prediction-model"
                  clearable
                  variant="outlined"
                  :items="forwardModels"
                ></v-select>
              </v-col>

              <v-col cols="12">
                <v-select
                  label="模型训练集"
                  v-model="forwardModelTrainingSet"
                  density="comfortable"
                  data-cy="settings-forward-model-training-set"
                  hide-details
                  clearable
                  variant="outlined"
                  :items="forwardModelTrainingSets"
                ></v-select>
              </v-col>

              <v-col cols="12">
                <v-text-field
                  label="结果数量"
                  placeholder="返回多少条正向预测结果"
                  data-cy="settings-forward-model-num-results"
                  prepend-inner-icon="mdi mdi-flask"
                  hide-details
                  clearable
                  density="comfortable"
                  variant="outlined"
                  type="number"
                  v-model="numForwardResults"
                ></v-text-field>
              </v-col>
            </v-row>
          </v-card-text>
        </template>
        <template v-if="openSettingsPanel === 'impurity-settings'">
          <v-card-title class="headline"> 杂质预测设置 </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12">
                <v-select
                  label="正向预测模型"
                  v-model="forwardModel"
                  density="comfortable"
                  hide-details
                  data-cy="settings-impurities-model"
                  clearable
                  variant="outlined"
                  :items="forwardModels"
                ></v-select>
              </v-col>

              <v-col cols="12">
                <v-select
                  label="模型训练集"
                  v-model="forwardModelTrainingSet"
                  density="comfortable"
                  data-cy="settings-impurities-training-set"
                  hide-details
                  clearable
                  variant="outlined"
                  :items="forwardModelTrainingSets"
                ></v-select>
              </v-col>

              <v-col cols="12">
                <v-text-field
                  label="正向预测 Top-k"
                  density="comfortable"
                  variant="outlined"
                  data-cy="settings-impurities-top-k"
                  hide-details
                  clearable
                  placeholder="纳入杂质预测的正向预测候选数量"
                  type="number"
                  v-model="impurityTopk"
                ></v-text-field>
              </v-col>

              <v-col cols="12">
                <v-text-field
                  label="审查阈值"
                  placeholder="用于过滤低质量反应模式的阈值"
                  data-cy="settings-impurities-threshold"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                  clearable
                  type="number"
                  v-model="inspectionThreshold"
                ></v-text-field>
              </v-col>

              <v-col cols="12">
                <v-select
                  label="审查评分器"
                  placeholder="选择用于审查的评分器"
                  data-cy="settings-impurities-inspector-selection"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                  clearable
                  v-model="inspectionModel"
                  :items="[
                    { title: '正向审查器', value: 'Forward inspector' },
                    { title: 'Reaxys 审查器', value: 'Reaxys inspector' },
                  ]"
                ></v-select>
              </v-col>
              <v-col cols="12">
                <v-switch
                  label="使用原子映射"
                  placeholder="是否使用原子映射检查反应模式"
                  id="settings-impurities-atom-mapping"
                  data-cy="settings-impurities-atom-mapping"
                  v-model="impurityCheckMapping"
                  color="primary"
                ></v-switch>
              </v-col>
            </v-row>
          </v-card-text>
        </template>
        <template v-if="openSettingsPanel === 'selectivity-settings'">
          <v-card-title class="headline"> 区域选择性设置 </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12">
                <v-switch
                  :label="`不映射试剂：${absoluteReagents ? '是' : '否'}`"
                  hint="试剂不向产物提供原子时可启用。"
                  v-model="absoluteReagents"
                  color="primary"
                >
                </v-switch>
              </v-col>
            </v-row>
          </v-card-text>
        </template>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            text="确定"
            @click="dialog = false"
            variant="tonal"
            data-cy="ok-btn"
          ></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </module-workbench>
</template>

<script setup>
import {
  ref,
  onMounted,
  onBeforeUnmount,
  computed,
  watch,
  reactive,
  nextTick,
} from "vue";
import { useRouter, useRoute } from "vue-router";
import { API } from "@/common/api";
import SmilesImage from "@/components/SmilesImage";
import ConditionRecommendation from "@/views/forward/tab/ConditionRecommendation.vue";
import SynthesisPrediction from "@/views/forward/tab/SynthesisPrediction.vue";
import ImpurityPrediction from "@/views/forward/tab/ImpurityPrediction.vue";
import Regioselectivity from "@/views/forward/tab/Regioselectivity.vue";
import SiteSelectivity from "@/views/forward/tab/SiteSelectivity.vue";
import { saveAs } from "file-saver";
import { useConfirm } from "vuetify-use-dialog";
import { createReaxysQuery } from "@/common/reaxys";
import DrawButton from "@/components/DrawButton";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import { useWorkspaceStore } from "@/store/workspace";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspaceStore();
const forwardFeatures = {
  context: "conditions",
  forward: "forward",
  impurity: "impurity",
  selectivity: "selectivity",
  sites: "sites",
};
const forwardModules = computed(() =>
  [
    {
      value: "context",
      title: "反应条件",
      disabled: !workspace.can("conditions"),
    },
    {
      value: "forward",
      title: "产物预测",
      disabled: !workspace.can("forward"),
    },
    {
      value: "impurity",
      title: "杂质预测",
      disabled: !workspace.can("impurity"),
    },
    {
      value: "selectivity",
      title: "区域选择性",
      disabled: !workspace.can("selectivity"),
    },
    {
      value: "sites",
      title: "芳香 C-H 位点",
      disabled: !workspace.can("sites"),
    },
  ].filter((module) => !module.disabled),
);
const tab = computed(() =>
  typeof route.query.tab === "string" &&
  Object.hasOwn(forwardFeatures, route.query.tab)
    ? route.query.tab
    : "context",
);
const mode = computed(() => tab.value);
const canPredict = computed(() => workspace.can(forwardFeatures[mode.value]));
const contextModels = [
  { value: "neuralnetwork", title: "Neural Network" },
  { value: "neuralnetworkv2", title: "QUARC" },
];
const dialog = ref(false);
const contextModel = ref("neuralnetwork");
const modelStatus = ref([]);
const reactants = ref("");
const product = ref("");
const reagents = ref("");
const solvent = ref("");
const contextResults = ref([]);
const forwardModel = ref("wldn5");
const forwardModelTrainingSet = ref("pistachio");
const numContextResults = ref(10);
const numForwardResults = ref(100);
const impurityTopk = ref(3);
const inspectionThreshold = ref(0.1);
const inspectionModel = ref("Reaxys inspector");
const impurityCheckMapping = ref(true);
const absoluteReagents = ref(false);
const atomMappingModel = ref("wln");
const forwardResults = ref([]);
const selectivityResults = ref([]);
const selectivityModel = ref("gnn");
const pendingTasks = ref(0);
const reactionScore = ref(null);
const evaluating = ref(false);
const impurityResults = ref([]);
const impurityProgress = ref({
  percent: 0,
  message: "",
});
const openSettingsPanel = ref(null);
const createConfirm = useConfirm();
const siteResults = ref([]);
const siteResultsQuery = ref("");
const siteSelectedAtoms = ref([]);
const pendingRank = ref(0);
const forwardFileName = ref("forward.csv");
const impurityFileName = ref("impurity.csv");
const selectivityFileName = ref("selectivity.csv");
const ssref = ref(null);
const requestError = ref("");
const requestWatchdog = ref(null);

const formatRequestError = (prefix, error) => {
  const message = error?.message || String(error || "未知错误");
  if (message === "Failed to fetch") {
    return `${prefix}：无法连接后端服务，请检查后端和模型服务是否运行。`;
  }
  if (/Internal Server Error|status.?500|500/.test(message)) {
    return `${prefix}：后端模型服务返回内部错误，请检查对应 worker 或稍后重试。`;
  }
  if (/Celery task failed/i.test(message)) {
    return `${prefix}：异步任务执行失败，请检查 Celery worker 和模型服务状态。`;
  }
  try {
    const parsed = JSON.parse(message);
    if (parsed?.detail) {
      return `${prefix}：${parsed.detail}`;
    }
  } catch {
    // Keep the normalized message below.
  }
  return `${prefix}：${message}`;
};

const setRequestError = (prefix, error) => {
  requestError.value = formatRequestError(prefix, error);
};

const clearRequestWatchdog = () => {
  if (requestWatchdog.value) {
    window.clearTimeout(requestWatchdog.value);
    requestWatchdog.value = null;
  }
};

const startRequestWatchdog = (label) => {
  clearRequestWatchdog();
  requestWatchdog.value = window.setTimeout(() => {
    if (pendingTasks.value > 0 && !requestError.value) {
      requestError.value = `${label}仍在等待后端响应；如果持续无结果，请检查后端、Celery 和模型服务状态。`;
    }
  }, 5000);
};

const filteredResults = computed(() => {
  return sortSiteResults(
    siteResults.value.filter((result) => {
      return (
        result.task.includes(siteResultsQuery.value) && checkFilter(result)
      );
    }),
  );
});

const checkFilter = (result) => {
  if (!siteSelectedAtoms.value.length) {
    return true;
  }
  let reactingAtoms = result["atom_scores"].reduce((accum, score, index) => {
    if (Math.round(score * 100) > 5) {
      accum.push(index);
    }
    return accum;
  }, []);

  return reactingAtoms.some((element) =>
    siteSelectedAtoms.value.includes(element),
  );
};

const sortSiteResults = (results) => {
  if (!siteSelectedAtoms.value.length) {
    return results;
  }
  return results.sort((a, b) => {
    return (
      b["atom_scores"][siteSelectedAtoms.value[0]] -
      a["atom_scores"][siteSelectedAtoms.value[0]]
    );
  });
};

const downloadSitesRefs = (result) => {
  let blob = new Blob([createReaxysQuery(result.references)], {
    type: "data:text/json;charset=utf-8",
  });
  saveAs(blob, "reaxys_query.json");
};

const getSitesRefs = async (index) => {
  try {
    const response = await API.get(
      `/api/selectivity/refs/${index}`,
      null,
      false,
    );
    siteResults.value[index].references = response.references;
  } catch (error) {
    console.error(error);
  }
};

const hasResults = computed(
  () =>
    ({
      context: contextResults.value.length,
      forward: forwardResults.value.length,
      impurity: impurityResults.value.length,
      selectivity: selectivityResults.value.length,
      sites: siteResults.value.length,
    })[tab.value] > 0,
);

watch(
  tab,
  () => {
    switch (tab.value) {
      case "context":
        openSettingsPanel.value = "condition-settings";
        break;
      case "forward":
        openSettingsPanel.value = "forward-settings";
        break;
      case "impurity":
        openSettingsPanel.value = "impurity-settings";
        break;
      case "selectivity":
        openSettingsPanel.value = "selectivity-settings";
        break;
      default:
        openSettingsPanel.value = null;
    }
    dialog.value = false;
  },
  { immediate: true },
);

const constructFastFilterPostData = () => {
  return {
    smiles: [reactants.value, product.value],
  };
};

const evaluate = async () => {
  if (
    evaluating.value ||
    !workspace.can("fast_filter") ||
    !workspace.can("forward")
  ) {
    return;
  }
  clearEvaluation();
  pendingRank.value++;
  evaluating.value = true;
  const postData = constructFastFilterPostData();

  contextResults.value.forEach((index) => {
    evaluateIndex(index);
  });

  try {
    const output = await API.runCeleryTask(
      "/api/fast-filter/call-async",
      postData,
    );
    reactionScore.value = output.result.score;
  } catch (error) {
    console.error("An error occurred during evaluation:", error);
  } finally {
    evaluating.value = false;
    pendingRank.value--;
  }
};

const clearEvaluation = () => {
  reactionScore.value = null;
  for (let res of contextResults.value) {
    res.evaluation = undefined;
  }
};

const evaluateIndex = async (index) => {
  pendingRank.value++;

  contextResults[index].evaluating = true;

  let reagents = contextResults[index]["reagent"];
  if (contextResults.value[index].catalyst) {
    if (reagents) {
      reagents += ".";
    }
    reagents += contextResults.value[index].catalyst;
  }

  let solvent = contextResults.value[index].solvent;
  const postData = constructForwardPostData(reagents, solvent);
  try {
    const output = await API.runCeleryTask(
      "/api/forward/controller/call-async",
      postData,
    );
    for (let i = 0; i < output.length; i++) {
      const outcome = output[i];
      if (outcome.smiles === product.value) {
        contextResults.value[index].evaluation = i + 1;
        break;
      }
    }
    if (!contextResults.value[index].evaluation) {
      contextResults.value[index].evaluation = 0;
    }
    contextResults.value[index].evaluating = false;
  } catch (error) {
    console.error("An error occurred while evaluating the index:", error);
  } finally {
    pendingRank.value--;
  }
};

const forwardModels = computed(() => {
  const models = new Set();
  const types = [
    "forward_augmented_transformer",
    "forward_graph2smiles",
    "forward_wldn5",
  ];

  modelStatus.value
    .filter((item) => types.includes(item["name"]) && item["ready"])
    .forEach((item) => {
      let modelName = item["name"].replace("forward_", "");
      models.add(modelName);
    });

  return Array.from(models).sort();
});

const goToForward = (index) => {
  if (pendingTasks.value > 0 || !workspace.can("forward")) {
    requestError.value = "目标服务未启用，请查看服务状态。";
    return;
  }
  canonicalizeAll().then(() => {
    const context = contextResults.value[index];
    let reagentsValue = "";
    if (context["reagent"]) {
      reagentsValue += context["reagent"];
    }
    if (context["catalyst"]) {
      reagentsValue += "." + context["catalyst"];
    }
    reagents.value = reagentsValue;
    if (context["solvent"]) {
      solvent.value = context["solvent"];
    }
    router.push({
      path: "/forward",
      query: {
        tab: "forward",
      },
    });
    forwardPredict();
  });
};

const goToImpurity = (index) => {
  if (pendingTasks.value > 0 || !workspace.can("impurity")) {
    requestError.value = "目标服务未启用，请查看服务状态。";
    return;
  }
  canonicalizeAll().then(() => {
    product.value = index;
    router.push({
      path: "/forward",
      query: {
        tab: "impurity",
      },
    });
    impurityPredict();
  });
};

const goToSelectivity = (index) => {
  if (pendingTasks.value > 0 || !workspace.can("selectivity")) {
    requestError.value = "目标服务未启用，请查看服务状态。";
    return;
  }
  canonicalizeAll().then(() => {
    product.value = index;
    router.push({
      path: "/forward",
      query: {
        tab: "selectivity",
      },
    });
    selectivityPredict();
  });
};

const forwardModelTrainingSets = computed(() => {
  const sets = new Set();
  let modelNameWithPrefix = forwardModel.value.replace("", "forward_");
  modelStatus.value
    .filter((item) => item.name.startsWith(modelNameWithPrefix) && item.ready)
    .forEach((item) => {
      if (Array.isArray(item.available_model_names)) {
        item.available_model_names.forEach((modelName) => {
          sets.add(modelName);
        });
      }
    });

  return Array.from(sets).sort();
});

watch(forwardModel, () => {
  if (forwardModelTrainingSets.value.length > 0) {
    forwardModelTrainingSet.value = forwardModelTrainingSets.value[0];
  } else {
    forwardModelTrainingSet.value = null;
  }
});

const replaceRoute = (value) => {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(forwardFeatures, value) ||
    !workspace.can(forwardFeatures[value]) ||
    pendingTasks.value > 0
  )
    return;
  router.replace({ path: "/forward", query: { ...route.query, tab: value } });
};

const predict = async () => {
  if (pendingTasks.value > 0 || !canPredict.value) return;
  if (!reactants.value?.trim()) {
    requestError.value = "请输入反应物 SMILES。";
    return;
  }
  requestError.value = "";
  startRequestWatchdog("任务");
  pendingTasks.value++;
  try {
    await canonicalizeAll();
    switch (mode.value) {
      case "context":
        clearContext();
        contextPredict();
        break;
      case "forward":
        clearForward();
        forwardPredict();
        break;
      case "impurity":
        clearImpurity();
        impurityPredict();
        break;
      case "selectivity":
        clearSelectivity();
        selectivityPredict();
        break;
      case "sites":
        clearSites();
        sitesPredict();
        break;
      default:
        createConfirm({
          title: "提示",
          content: "不支持的功能模式。",
          dialogProps: { width: "60%" },
        });
    }
  } catch (error) {
    setRequestError("结构标准化失败", error);
  } finally {
    pendingTasks.value--;
  }
};

const clearInputs = () => {
  reactants.value = "";
  product.value = "";
  reagents.value = "";
  solvent.value = "";
};

const clear = async () => {
  requestError.value = "";
  clearRequestWatchdog();

  const isConfirmed = await createConfirm({
    title: "请确认",
    content: "这会清空当前结果，是否继续？",
    dialogProps: { width: "auto" },
  });
  if (!isConfirmed) {
    return;
  }

  switch (tab.value) {
    case "forward":
      clearForward();
      clearInputs();
      break;
    case "context":
      clearContext();
      clearInputs();
      break;
    case "impurity":
      clearImpurity();
      clearInputs();
      break;
    case "selectivity":
      clearSelectivity();
      clearInputs();
      break;
    case "sites":
      clearSites();
      clearInputs();
      break;
    default:
      createConfirm({
        title: "提示",
        content: "不支持的功能模式。",
        dialogProps: { width: "60%" },
      });
    // alert('unsupported mode')
  }
};

watch(
  () => route.query,
  () => {
    updateFromURL();
  },
  { deep: true },
);

const clearForward = () => {
  forwardResults.value = [];
};

const clearSelectivity = () => {
  selectivityResults.value = [];
};

const constructSelectivityPostData = () => {
  return {
    smiles: `${reactants.value}>>${product.value}`,
    backend: selectivityModel.value,
    atom_map_backend: atomMappingModel.value,
    no_map_reagents: absoluteReagents.value,
    mapped: false,
    all_outcomes: false,
  };
};

const selectivityPredict = () => {
  if (!workspace.can("selectivity")) return;
  pendingTasks.value++;
  const postData = constructSelectivityPostData();

  return API.runCeleryTask(
    "/api/general-selectivity/controller/call-async",
    postData,
  )
    .then((output) => {
      selectivityResults.value = output?.result ?? output;
    })
    .catch((error) => {
      let errorData;
      try {
        errorData = JSON.parse(error.message);
      } catch {
        errorData = null;
      }
      if (errorData?.output) {
        requestError.value = "区域选择性预测不适用于当前反应。";
        createConfirm({
          title: "错误",
          content: "区域选择性预测不适用于当前反应。",
          dialogProps: { width: "60%" },
        });
      } else {
        setRequestError("区域选择性预测失败", error);
        createConfirm({
          title: "错误",
          content: requestError.value,
          dialogProps: { width: "60%" },
        });
      }
    })
    .finally(() => {
      pendingTasks.value--;
    });
};

const clearImpurity = () => {
  impurityResults.value = [];
  impurityProgress.value = {
    percent: 0,
    message: "",
  };
};

const impurityPredict = () => {
  if (!workspace.can("impurity")) return;
  pendingTasks.value++;
  impurityResults.value = [];

  let postData = constructImpurityPostData();

  let complete = (output) => {
    impurityProgress.value.percent = 1.0;
    impurityProgress.value.message = "预测完成。";
    impurityResults.value = output["result"]["predict_expand"];
  };

  let progress = (json) => {
    impurityProgress.value.percent = json["percent"];
    impurityProgress.value.message = json["message"];
  };

  let failed = (error) => {
    console.error("Error encountered during impurity prediction:", error);
    impurityProgress.value.percent = 0.0;
    impurityProgress.value.message = "杂质预测失败。";
    setRequestError("杂质预测失败", error);
  };

  API.runCeleryTask("/api/impurity-predictor/call-async", postData, progress)
    .then((output) => {
      complete(output);
    })
    .catch((error) => {
      failed(error);
    })
    .finally(() => {
      pendingTasks.value--;
    });
};

const constructImpurityPostData = () => {
  let data = {
    rct_smi: reactants.value,
    predictor_model_name: forwardModelTrainingSet.value,
    predictor_backend: forwardModel.value,
    topn_outcome: impurityTopk.value,
    check_mapping: impurityCheckMapping.value,
    insp_threshold: inspectionThreshold.value,
    inspector: inspectionModel.value,
    atom_map_backend: "indigo",
  };

  if (product.value) {
    data.prd_smi = product.value;
  }

  if (reagents.value) {
    data.rea_smi = reagents.value;
  }

  if (solvent.value) {
    data.sol_smi = solvent.value;
  }

  return data;
};

const updateFromURL = () => {
  const requested = route.query.tab;
  if (
    requested !== undefined &&
    (typeof requested !== "string" ||
      !Object.hasOwn(forwardFeatures, requested))
  ) {
    router.replace({
      path: "/forward",
      query: { ...route.query, tab: "context" },
    });
  }
  const urlParams = new URLSearchParams(
    Object.entries(route.query).filter(
      ([, value]) => typeof value === "string",
    ),
  );
  let rxnsmiles = urlParams.get("rxnsmiles");
  if (rxnsmiles) {
    const split = rxnsmiles.split(">>");
    reactants.value = split[0];
    product.value = split[split.length - 1];
  }
  if (urlParams.get("reactants")) {
    reactants.value = urlParams.get("reactants");
  }
  if (urlParams.get("product")) {
    product.value = urlParams.get("product");
  }
  if (urlParams.get("reagents")) {
    reagents.value = urlParams.get("reagents");
  }
  if (urlParams.get("solvent")) {
    solvent.value = urlParams.get("solvent");
  }
};

onMounted(async () => {
  updateFromURL();
  await workspace.refresh();
  if (!canPredict.value) return;
  try {
    const response = await API.get(
      "/api/admin/get-backend-status",
      null,
      false,
    );
    modelStatus.value = Array.isArray(response?.modules)
      ? response.modules
      : [];
    if (reactants.value) predict();
  } catch (error) {
    setRequestError("模型状态读取失败", error);
  }
});
onBeforeUnmount(clearRequestWatchdog);

const forwardPredict = async () => {
  if (!workspace.can("forward")) return;
  pendingTasks.value++;
  forwardResults.value = [];

  if (reactants.value.length < 4) {
    createConfirm({
      title: "错误",
      content: "请输入至少包含 4 个原子的反应物。",
      dialogProps: { width: "60%" },
    });
    pendingTasks.value--;
    return;
  }
  const postData = constructForwardPostData(reagents.value, solvent.value);
  try {
    const output = await API.runCeleryTask(
      "/api/forward/controller/call-async",
      postData,
    );
    forwardResults.value = output.result[0];
  } catch (error) {
    setRequestError("正向产物预测失败", error);
    console.error("Error in forward prediction:", error);
  } finally {
    pendingTasks.value--;
  }
};

const constructForwardPostData = (reagents, solvent) => {
  let data = reactive({
    smiles: [reactants.value],
    backend: forwardModel.value,
    model_name: forwardModelTrainingSet.value,
  });

  if (reagents) {
    data.reagents = reagents;
  }
  if (solvent) {
    data.solvent = solvent;
  }

  return data;
};

const canonicalize = async (smiles, input) => {
  return API.post("/api/rdkit/canonicalize", { smiles: smiles }).then(
    (json) => {
      if (input === "reactants") {
        reactants.value = json.smiles;
      } else if (input === "product") {
        product.value = json.smiles;
      } else if (input === "reagents") {
        reagents.value = json.smiles;
      } else if (input === "solvent") {
        solvent.value = json.smiles;
      }
    },
  );
};
const canonicalizeAll = () => {
  let promises = [];

  const properties = {
    reactants: reactants.value,
    product: product.value,
    reagents: reagents.value,
    solvent: solvent.value,
  };

  for (let smi in properties) {
    if (properties[smi]) {
      promises.push(canonicalize(properties[smi], smi));
    }
  }
  return Promise.all(promises);
};
const clearContext = () => {
  contextResults.value = [];
  reactionScore.value = null;
};

const contextPredict = () => {
  if (!workspace.can("conditions")) return;
  switch (contextModel.value) {
    case "neuralnetwork":
      contextV1Predict();
      break;
    case "neuralnetworkv2":
      contextV2Predict();
      break;
    default:
      // alert('unsupported context model')
      createConfirm({
        title: "提示",
        content: "不支持的条件推荐模型。",
        dialogProps: { width: "60%" },
      });
  }
};

const contextV1Predict = async () => {
  pendingTasks.value++;
  contextResults.value = [];
  evaluating.value = false;
  let postData = constructContextV1PostData();
  if (reactants.value.length < 4) {
    createConfirm({
      title: "错误",
      content: "请输入至少包含 4 个原子的反应物。",
      dialogProps: { width: "60%" },
    });
    pendingTasks.value--;
    return;
  }
  API.runCeleryTask(
    "/api/context-recommender/v1/condition-uncleaned/call-async",
    postData,
  )
    .then((output) => {
      contextResults.value = parseWrapperResponse(output);
    })
    .catch((error) => {
      setRequestError("反应条件推荐失败", error);
    })
    .finally(() => {
      pendingTasks.value--;
    });
};
const separateNames = (smilesStr) => {
  if (!smilesStr) return { smiles: "", nameOnly: "" };
  const parts = smilesStr.split(".");
  const smilesParts = [];
  const nameParts = [];
  for (const part of parts) {
    if (part.includes("Reaxys")) {
      nameParts.push(part);
    } else {
      smilesParts.push(part);
    }
  }
  return { smiles: smilesParts.join("."), nameOnly: nameParts.join(".") };
};

const parseWrapperResponse = (output) => {
  const conditions = output.result?.conditions ?? [];
  const scores = output.result?.scores ?? [];

  return conditions.map((cond, i) => {
    const [temperature, solvent, reagent, catalyst, solvent_score, best] = cond;
    const solventSep = separateNames(solvent);
    const reagentSep = separateNames(reagent);
    const catalystSep = separateNames(catalyst);

    return {
      temperature,
      solvent: solventSep.smiles,
      reagent: reagentSep.smiles,
      catalyst: catalystSep.smiles,
      solvent_score,
      best,
      solvent_name_only: solventSep.nameOnly,
      reagent_name_only: reagentSep.nameOnly,
      catalyst_name_only: catalystSep.nameOnly,
      score: scores[i] ?? null,
    };
  });
};

const constructContextV1PostData = () => {
  return {
    smiles: `${reactants.value}>>${product.value}`,
    n_conditions: numContextResults.value,
    with_smiles: false,
    return_scores: true,
  };
};

const parseRangeMin = (rangeString) => {
  if (!rangeString || typeof rangeString !== "string") return null;
  const numbers = rangeString.match(/[-+]?\d*\.?\d+/g);
  if (!numbers || numbers.length === 0) return null;
  const lower = parseFloat(numbers[0]);
  return isFinite(lower) ? lower : null;
};

const postprocessContextV2 = (output) => {
  const predictions = output && output.result ? output.result.predictions : [];

  if (!Array.isArray(predictions) || predictions.length === 0) {
    createConfirm({
      title: "提示",
      content: "当前反应未生成条件推荐，请尝试切换模型。",
      dialogProps: { width: "60%" },
    });
    contextResults.value = [];
    return;
  }

  const processedResults = predictions.map((prediction) => {
    const reactantsMap = {};
    (prediction.reactant_amounts || []).forEach((entry) => {
      reactantsMap[entry.reactant] = parseRangeMin(entry.amount_range);
    });

    const reagentsMap = {};
    (prediction.agent_amounts || []).forEach((entry) => {
      reagentsMap[entry.agent] = parseRangeMin(entry.amount_range);
    });

    return {
      temperature: parseRangeMin(prediction.temperature),
      reactants: reactantsMap,
      reagents: reagentsMap,
      reagent: (prediction.agents || []).join("."),
      score: prediction.score,
    };
  });

  contextResults.value = processedResults;
};

const contextV2Predict = () => {
  pendingTasks.value++;
  contextResults.value = [];
  evaluating.value = false;
  const postData = constructContextV2PostData();
  API.runCeleryTask("/api/context/quarc/single-query/call-async", postData)
    .then((output) => {
      postprocessContextV2(output);
    })
    .catch((error) => {
      setRequestError("反应条件推荐失败", error);
    })
    .finally(() => {
      pendingTasks.value--;
    });
};

const constructContextV2PostData = () => {
  const payload = {
    reactants: reactants.value,
    products: product.value,
    num_results: numContextResults.value,
    model: "graph",
  };

  payload.reagents = reagents.value ? [reagents.value] : [];
  return payload;
};

const downloadImpurityResults = () => {
  if (!impurityResults.value.length) {
    createConfirm({
      title: "提示",
      content: "没有可下载的杂质预测结果。",
      dialogProps: { width: "60%" },
    });
    // alert('There are no impurity predictor results to download!');
    return;
  }
  let downloadData =
    "No.,reactantData,productData,reagentData,solventData,SMILES,Mechanism,InspectorScore,SimilarityScore,MolWt\n";

  let reactantData = reactants.value;
  let productData = product.value;
  let reagentData = reagents.value;
  let solventData = solvent.value;

  impurityResults.value.forEach((res) => {
    let modesName = `"${res.modes_name}"`;
    downloadData += `${res.no},${reactantData},${productData},${reagentData},${solventData},${res.prd_smiles},${modesName},${res.avg_insp_score},${res.similarity_to_major},${res.prd_mw}\n`;
  });
  const blob = new Blob([downloadData], {
    type: "data:text/csv;charset=utf-8",
  });
  saveAs(blob, impurityFileName.value);
};

const downloadSelectivityResults = () => {
  if (!selectivityResults.value) {
    createConfirm({
      title: "提示",
      content: "没有可下载的区域选择性结果。",
      dialogProps: { width: "60%" },
    });
    // alert('There are no regio-selectivity results to download!')
  }
  let downloadData = "Rank,SMILES,Probability\n";
  selectivityResults.value.forEach((res) => {
    downloadData += `${res.rank},${res.smiles},${res.prob}\n`;
  });
  let blob = new Blob([downloadData], { type: "data:text/csv;charset=utf-8" });
  saveAs(blob, selectivityFileName.value);
};

const downloadForwardResults = () => {
  if (!forwardResults.value.length) {
    // alert('There are no forward predictor results to download!');
    createConfirm({
      title: "提示",
      content: "没有可下载的正向预测结果。",
      dialogProps: { width: "60%" },
    });
    return;
  }
  let downloadData = "Rank,SMILES,Probability,Score,MolWt\n";
  forwardResults.value.forEach((res) => {
    downloadData += `${res.rank},${res.outcome},${res.prob},${res.score},${res.mol_wt}\n`;
  });
  const blob = new Blob([downloadData], {
    type: "data:text/csv;charset=utf-8",
  });
  saveAs(blob, forwardFileName.value);
};

const clearSites = () => {
  siteResults.value = [];
  siteSelectedAtoms.value = [];
};

const sitesPredict = () => {
  if (!workspace.can("sites")) return;
  pendingTasks.value++;
  const postData = constructSiteSelectivityPostData();
  API.runCeleryTask("/api/site-selectivity/call-async", postData)
    .then((output) => {
      siteResults.value = output.result.flat();
    })
    .catch((error) => {
      setRequestError("芳香 C-H 位点预测失败", error);
    })
    .finally(async () => {
      pendingTasks.value--;
      await nextTick();
      ssref.value?.ketcherMinRef?.setSmiles(reactants.value);
    });
};

const constructSiteSelectivityPostData = () => {
  return {
    smiles: [reactants.value],
  };
};
</script>

<style scoped>
.forward-structure {
  height: 140px;
  margin-bottom: 16px;
}
.tool-result-panel :deep(.v-sheet) {
  padding: 0 !important;
  background: transparent;
  box-shadow: none;
}
</style>
