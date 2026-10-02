<template>
  <section class="results-workspace">
    <header class="result-mode-tabs" aria-label="任务结果分类">
      <button
        v-for="mode in resultModes"
        :key="mode.value"
        :class="['result-mode-tab', { active: activeMode === mode.value, disabled: mode.disabled }]"
        :disabled="mode.disabled"
        type="button"
        @click="activeMode = mode.value"
      >
        <v-icon :icon="mode.icon" size="30"></v-icon>
        <span>{{ mode.label }}</span>
      </button>
    </header>

    <main class="results-layout">
      <aside class="result-groups" aria-label="任务分组">
        <div class="group-panel-head">
          <div>
            <span class="panel-kicker">分组</span>
            <h2>任务分组</h2>
          </div>
          <v-icon icon="mdi-folder-table-outline" size="24"></v-icon>
        </div>

        <button class="new-group-button" type="button" disabled>
          <v-icon icon="mdi-plus" size="24"></v-icon>
          新建分组
        </button>

        <div class="group-list">
          <button
            v-for="group in groupOptions"
            :key="group.value"
            :class="['group-item', { active: activeGroup === group.value }]"
            type="button"
            @click="activeGroup = group.value"
          >
            <v-icon :icon="group.icon" size="22"></v-icon>
            <span>{{ group.label }}</span>
            <strong>{{ group.count }}</strong>
          </button>
        </div>

        <div class="group-empty-hint">
          分组来自任务标签；可在结果详情中维护标签。
        </div>
      </aside>

      <section class="result-main-panel">
        <div class="result-toolbar">
          <v-btn class="search-task-button" variant="outlined" color="success">
            搜索任务
          </v-btn>

          <v-text-field
            id="results-text"
            data-cy="results-search-desc"
            v-model="searchQuery"
            class="result-search-input"
            prepend-inner-icon="mdi-magnify"
            density="compact"
            variant="outlined"
            placeholder="请输入名称、SMILES"
            hide-details
            clearable
            rounded="lg"
            @keyup.enter="update"
          ></v-text-field>

          <v-select
            v-model="sortDescending"
            class="result-sort-select"
            :items="sortOptions"
            item-title="label"
            item-value="value"
            density="compact"
            variant="plain"
            hide-details
            aria-label="排序方式"
          ></v-select>
        </div>

        <div class="batch-toolbar">
          <label class="select-all-control">
            <input v-model="allVisibleSelected" type="checkbox" />
            <span>全选（{{ selection.length }}）</span>
          </label>
          <v-btn class="batch-button" variant="outlined" disabled>
            添加至分组
            <v-icon icon="mdi-chevron-right" end></v-icon>
          </v-btn>
          <v-btn
            id="results-delete"
            data-cy="results-multiple-delete"
            class="batch-delete"
            variant="outlined"
            color="error"
            :disabled="selection.length === 0"
            @click="deleteSelection"
          >
            删除
          </v-btn>
          <v-spacer></v-spacer>
          <div v-if="refreshInterval" class="running-indicator">
            <v-progress-circular indeterminate color="success" size="18" width="2"></v-progress-circular>
            有任务仍在运行。
          </div>
          <div v-else class="toolbar-note">
            <v-icon icon="mdi-information" size="20"></v-icon>
            搜索中的任务也支持查看结果。
          </div>
          <v-btn
            id="results-search"
            data-cy="results-search"
            color="success"
            variant="flat"
            @click="update"
          >
            搜索
          </v-btn>
          <v-btn
            id="results-update"
            data-cy="results-table-update"
            icon="mdi-refresh"
            variant="tonal"
            color="primary"
            :loading="pendingTasks > 0"
            @click="update"
          ></v-btn>
        </div>

        <v-alert
          v-if="resultsLoadError"
          class="result-load-alert"
          type="warning"
          variant="tonal"
          density="comfortable"
        >
          <strong>历史任务暂不可用</strong>
          <p>{{ resultsLoadError }}</p>
        </v-alert>

        <section id="results-table" class="result-card-grid" data-cy="results-table" aria-live="polite">
          <article
            v-for="item in pagedResults"
            :key="item.result_id"
            :class="['result-card', { selected: selection.includes(item.result_id), recent: isRecentlyUpdated(item.modified) }]"
          >
            <div class="card-select">
              <input
                :checked="selection.includes(item.result_id)"
                :aria-label="`选择 ${resultTitle(item)}`"
                type="checkbox"
                @change="toggleSelection(item.result_id)"
              />
            </div>

            <a
              class="structure-preview structure-preview-link"
              :href="primaryTaskHref(item)"
              :aria-label="primaryTaskLabel(item)"
              @click="handlePrimaryTaskClick($event, item)"
            >
              <smiles-image
                v-if="structureSmiles(item)"
                class="result-structure-image"
                :smiles="structureSmiles(item)"
                transparent
                width="100%"
                height="100%"
                :allow-copy="!!structureSmiles(item)"
                :input-type="structureInputType(item)"
                :show-error-image="false"
              ></smiles-image>
              <div v-else class="structure-missing-state">
                <v-progress-circular
                  v-if="isHydratingStructure(item)"
                  indeterminate
                  color="primary"
                  size="34"
                  width="3"
                ></v-progress-circular>
                <v-icon v-else icon="mdi-molecule-off" size="42"></v-icon>
                <strong>{{ isHydratingStructure(item) ? "正在补全结构" : "结构待补全" }}</strong>
                <span>{{ item.result_id }}</span>
              </div>
            </a>

            <div class="card-body">
              <div class="card-title-line">
                <a
                  class="card-title-link"
                  :href="primaryTaskHref(item)"
                  :aria-label="primaryTaskLabel(item)"
                  @click="handlePrimaryTaskClick($event, item)"
                >
                  <h3>{{ resultTitle(item) }}</h3>
                </a>
                <strong>{{ resultCount(item) }}</strong>
              </div>
              <p class="card-date">{{ item.modified }}</p>
              <p class="card-description">{{ resultSummary(item) }}</p>

              <v-btn
                v-if="item.result_state === 'failed'"
                class="retry-run-button"
                size="small"
                color="primary"
                variant="flat"
                prepend-icon="mdi-pencil-outline"
                :href="retryHref(item)"
              >
                编辑后重跑
              </v-btn>

              <div class="card-meta-row">
                <v-chip v-if="item.result_type === 'unified_route_job'" variant="tonal" size="small">
                  {{ jobStateLabel(item.result_state) }}
                </v-chip>
                <v-chip
                  v-if="hasUnifiedRoutes(item) && item.result_state !== 'completed'"
                  data-cy="results-state-partial-ready"
                  color="cyan-darken-2"
                  variant="tonal"
                  size="small"
                >
                  <v-icon icon="mdi-check-decagram" start></v-icon>
                  已有可用路线
                </v-chip>
                <v-chip
                  v-if="item.result_state === 'completed'"
                  data-cy="results-state-completed"
                  :color="item.result_type === 'tree_builder' && !item.num_trees ? 'orange-darken-1' : 'success'"
                  variant="tonal"
                  size="small"
                >
                  <v-icon :icon="item.result_type === 'tree_builder' && !item.num_trees ? 'mdi-file-search-outline' : 'mdi-check-circle'" start></v-icon>
                  {{ item.result_type === 'tree_builder' && !item.num_trees ? "搜索完成" : "已完成" }}
                </v-chip>
                <v-chip
                  v-if="item.result_state === 'started' && !hasUnifiedRoutes(item)"
                  data-cy="results-state-started"
                  color="orange-darken-1"
                  variant="tonal"
                  size="small"
                >
                  <v-icon icon="mdi-timer" start></v-icon>
                  运行中
                </v-chip>
                <v-chip
                  v-if="item.result_state === 'pending'"
                  data-cy="results-state-pending"
                  color="blue-darken-1"
                  variant="tonal"
                  size="small"
                >
                  <v-icon icon="mdi-progress-clock" start></v-icon>
                  排队中
                </v-chip>
                <v-chip
                  v-if="item.result_state === 'failed'"
                  data-cy="results-state-failed"
                  color="red-darken-1"
                  variant="tonal"
                  size="small"
                >
                  <v-icon icon="mdi-alert-circle" start></v-icon>
                  失败
                </v-chip>
                <v-chip variant="tonal" size="small">{{ typeLabel(item) }}</v-chip>
                <v-chip
                  v-if="unifiedSummary(item)"
                  color="indigo-darken-1"
                  variant="tonal"
                  size="small"
                >
                  统一路线
                </v-chip>
                <v-chip v-if="item.public === true" color="primary" variant="tonal" size="small">
                  已共享
                </v-chip>
              </div>
            </div>

            <footer class="card-actions">
              <v-btn v-if="item.result_state === 'waiting_for_engine'" icon="mdi-play-circle-outline"
                variant="text" aria-label="恢复任务" title="恢复任务" @click="controlTask(item, 'resume')"></v-btn>
              <v-btn v-if="isJobActive(item.result_state) || item.result_state === 'waiting_for_engine'"
                icon="mdi-stop-circle-outline" variant="text" aria-label="取消任务" title="取消任务"
                @click="controlTask(item, 'cancel')"></v-btn>
              <v-btn icon="mdi-information-outline" variant="text" aria-label="查看设置"
                data-cy="results-view-settings"
                :disabled="!['tree_builder', 'unified_route_job'].includes(item.result_type)"
                @click="openSetting(item.result_id)">
              </v-btn>
              <v-btn
                v-if="item.result_type === 'tree_builder'"
                data-cy="results-view-trees"
                icon="mdi-magnify"
                variant="text"
                aria-label="查看路线树"
                :disabled="!canOpenResultRoute(item)"
                :href="`network?tab=TE&id=${item.result_id}`"
              ></v-btn>
              <v-btn
                v-else
                id="view-in-ipp"
                icon="mdi-magnify"
                variant="text"
                aria-label="在路线规划中查看"
                :disabled="!canOpenResultRoute(item)"
                :href="resultRouteHref(item)"
              ></v-btn>
              <v-btn
                v-if="item.result_type === 'tree_builder'"
                data-cy="results-view-ipp"
                icon="mdi-file-tree-outline"
                variant="text"
                aria-label="在路线规划中查看"
                :disabled="!canOpenResultRoute(item)"
                :href="`network?tab=IPP&id=${item.result_id}&view=25`"
              ></v-btn>
              <v-btn
                v-if="item.result_state === 'failed'"
                icon="mdi-replay"
                variant="text"
                aria-label="编辑后重跑"
                :href="retryHref(item)"
              ></v-btn>
              <v-btn icon="mdi-pencil-outline" variant="text" aria-label="修改描述" :disabled="isJobActive(item.result_state) || item.result_state === 'waiting_for_engine'" @click="openChangeDescription(item)">
              </v-btn>
              <v-btn data-cy="results-delete-single" icon="mdi-delete-outline" variant="text" aria-label="删除"
                :disabled="isJobActive(item.result_state) || item.result_state === 'waiting_for_engine'"
                @click="deleteResult(item.result_id)">
              </v-btn>
            </footer>
          </article>

          <div v-if="!pagedResults.length && pendingTasks === 0" class="empty-results">
            <v-img :width="280" cover :src="results"></v-img>
            <h3>暂无任务结果</h3>
            <p>从工作台提交逆合成或路线树任务后，结果会显示在这里。</p>
          </div>
        </section>

        <footer v-if="filteredResults.length" class="result-pagination">
          <span>共 {{ filteredResults.length }} 条</span>
          <v-btn icon="mdi-chevron-left" variant="text" :disabled="currentPage === 1" @click="currentPage -= 1"></v-btn>
          <strong>{{ currentPage }}</strong>
          <v-btn icon="mdi-chevron-right" variant="text" :disabled="currentPage >= totalPages" @click="currentPage += 1"></v-btn>
        </footer>
      </section>
    </main>
  </section>

  <v-dialog v-model="treeDialog" max-width="700px" scrollable>
    <v-card>
      <v-card-title class="text-justify">
        <v-col cols="12">路线树任务设置</v-col>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text class="pt-0">
        <tb-settings-table data-cy="tree-builder-settings-table" v-if="viewSettings" :settings="viewSettings"
          :targetSmiles="targetSmiles" :tbVersion="tbVersion"></tb-settings-table>
        <v-alert v-else type="warning" class="mb-0" dense text>设置不可用。</v-alert>
      </v-card-text>
      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn data-cy="results-tree-builder-settings-close" color="primary" text
          @click="treeDialog = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>


  <v-dialog v-model="showChangeDescriptionModal" max-width="600px">
    <v-card>
      <v-card-title class="text-justify mt-2">
        <v-col cols="12">修改描述</v-col></v-card-title>
      <v-card-text>
        <v-text-field v-model="newDescription" label="新描述" outlined id="new-description"></v-text-field>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="red darken-1" text @click="showChangeDescriptionModal = false" id="cancel">取消</v-btn>
        <v-btn color="primary" text id="save" @click="saveChangeDescription">保存</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

</template>

<script setup>
import { ref, onMounted, watch, computed, nextTick, onUnmounted } from 'vue';
import TbSettingsTable from '@/components/TbSettingsTable.vue';
import SmilesImage from "@/components/SmilesImage.vue";
import results from "@/assets/emptyResults.svg";
import { API } from "@/common/api";
import { isJobActive, jobStateLabel } from "@/common/job-state";
import { loadResultHistory } from "@/common/result-history";

const allResults = ref([]);
const totalItems = ref(1);
const pendingTasks = ref(0);
const selection = ref([]);
const searchQuery = ref("");
const showChangeDescriptionModal = ref(false);
const newDescription = ref("");
const selectedResultId = ref(null);
const sortDescending = ref(true);
const treeDialog = ref(false);
const viewSettings = ref(null);
const targetSmiles = ref("")
const refreshInterval = ref(null);
const tbVersion = ref(null);
const activeMode = ref("retro");
const activeGroup = ref("all");
const currentPage = ref(1);
const itemsPerPage = 12;
const isReqInProgress = ref(false);
const hydratingResultIds = ref([]);
const hydratedResultIds = ref([]);
const resultsLoadError = ref("");

const conditionResultTypes = [
  "condition",
  "context",
  "forward",
  "impurity",
  "selectivity",
  "solubility",
  "site",
];

const sortOptions = [
  { label: "最新优先", value: true },
  { label: "最早优先", value: false },
];

const isConditionResult = (item) => {
  const resultType = String(item?.result_type || "").toLowerCase();
  return conditionResultTypes.some((type) => resultType.includes(type));
};

const resultModes = computed(() => {
  const retroCount = allResults.value.filter((item) => !isConditionResult(item)).length;
  const conditionCount = allResults.value.filter(isConditionResult).length;
  return [
    { value: "retro", label: `逆合成`, icon: "mdi-molecule", count: retroCount, disabled: false },
    { value: "condition", label: `条件搜索`, icon: "mdi-tune-variant", count: conditionCount, disabled: conditionCount === 0 },
  ];
});

const checkAndRefreshResults = () => {
  const hasNonCompletedResults = allResults.value.some(result =>
    isJobActive(result.result_state)
  );

  if (hasNonCompletedResults) {
    if (!refreshInterval.value) {
      refreshInterval.value = setInterval(() => {
        if (!isReqInProgress.value) { // Check if no request is in progress
          isReqInProgress.value = true; // Set the flag to true
          update(true).finally(() => {
            isReqInProgress.value = false; // Reset the flag when the request completes
          });
        }
      }, 3000);
    }
  } else {
    if (refreshInterval.value) {
      clearInterval(refreshInterval.value);
      refreshInterval.value = null;
    }
  }
};

const sortedAllResults = computed(() => {
  return [...modeResults.value].sort((a, b) => {
    const dateA = new Date(a.modified);
    const dateB = new Date(b.modified);

    if (dateA < dateB) return sortDescending.value ? 1 : -1;
    if (dateA > dateB) return sortDescending.value ? -1 : 1;
    return 0;
  });
})

const isRecentlyUpdated = (updatedAt) => {
  const highlightThreshold = 30000; // e.g., 60 seconds
  let ans = Date.now() - new Date(updatedAt).getTime() < highlightThreshold;
  return ans
};

const normalizeTags = (item) => {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  const normalizedTags = tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
  if (unifiedSummary(item) && !normalizedTags.includes("统一路线")) {
    normalizedTags.push("统一路线");
  }
  return normalizedTags;
};

const modeResults = computed(() => {
  return allResults.value.filter((item) =>
    activeMode.value === "condition" ? isConditionResult(item) : !isConditionResult(item)
  );
});

const groupOptions = computed(() => {
  const groups = new Map();
  let ungroupedCount = 0;

  modeResults.value.forEach((item) => {
    const tags = normalizeTags(item);
    if (!tags.length) {
      ungroupedCount += 1;
      return;
    }
    tags.forEach((tag) => groups.set(tag, (groups.get(tag) || 0) + 1));
  });

  const dynamicGroups = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN"))
    .map(([tag, count]) => ({
      value: tag,
      label: tag,
      count,
      icon: "mdi-folder-outline",
    }));

  return [
    { value: "all", label: "全部", count: modeResults.value.length, icon: "mdi-folder-multiple-outline" },
    { value: "ungrouped", label: "未分组", count: ungroupedCount, icon: "mdi-folder-outline" },
    ...dynamicGroups,
  ];
});

const groupFilteredResults = computed(() => {
  if (activeGroup.value === "all") return sortedAllResults.value;
  if (activeGroup.value === "ungrouped") {
    return sortedAllResults.value.filter((item) => normalizeTags(item).length === 0);
  }
  return sortedAllResults.value.filter((item) => normalizeTags(item).includes(activeGroup.value));
});

const filteredResults = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return groupFilteredResults.value;

  return groupFilteredResults.value.filter(item => {
    const searchableText = [
      item.description,
      structureSmiles(item),
      item.result_state,
      item.result_type,
    ].filter(Boolean).join(" ").toLowerCase();
    return searchableText.includes(query);
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredResults.value.length / itemsPerPage)));

const pagedResults = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  return filteredResults.value.slice(start, start + itemsPerPage);
});

const visibleResultIds = computed(() => filteredResults.value.map((item) => item.result_id));

const allVisibleSelected = computed({
  get() {
    return visibleResultIds.value.length > 0 && visibleResultIds.value.every((id) => selection.value.includes(id));
  },
  set(checked) {
    const visibleIds = new Set(visibleResultIds.value);
    if (checked) {
      selection.value = [...new Set([...selection.value, ...visibleIds])];
    } else {
      selection.value = selection.value.filter((id) => !visibleIds.has(id));
    }
  },
});

watch([filteredResults, activeMode, activeGroup], () => {
  currentPage.value = 1;
  const visible = new Set(filteredResults.value.map((item) => item.result_id));
  selection.value = selection.value.filter((id) => visible.has(id));
});

watch(pagedResults, () => {
  hydrateVisibleStructures();
});

const toggleSelection = (id) => {
  if (selection.value.includes(id)) {
    selection.value = selection.value.filter((selectedId) => selectedId !== id);
  } else {
    selection.value = [...selection.value, id];
  }
};

const resultTitle = (item) => item.description || "未命名";

const normalizeStructureValue = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed)) return "";
  if (/^[0-9a-f-]{24,}$/i.test(trimmed)) return "";
  return trimmed;
};

const findStructureInObject = (source, depth = 0, visited = new WeakSet()) => {
  if (!source || typeof source !== "object" || depth > 4 || visited.has(source)) return "";
  visited.add(source);

  const preferredKeys = [
    "target_smiles",
    "targetSmiles",
    "smiles",
    "rxn_smiles",
    "rxnSmiles",
    "input_smiles",
    "inputSmiles",
    "target",
  ];

  for (const key of preferredKeys) {
    const value = normalizeStructureValue(source[key]);
    if (value) return value;
  }

  for (const [key, value] of Object.entries(source)) {
    const normalizedKey = key.toLowerCase();
    if (
      typeof value === "string"
      && (normalizedKey.includes("smiles") || normalizedKey === "target")
    ) {
      const normalizedValue = normalizeStructureValue(value);
      if (normalizedValue) return normalizedValue;
    }
  }

  for (const value of Object.values(source)) {
    if (value && typeof value === "object") {
      const nested = findStructureInObject(value, depth + 1, visited);
      if (nested) return nested;
    }
  }

  return "";
};

const structureSmiles = (item) => findStructureInObject(item);

const structureInputType = (item) => (structureSmiles(item).includes(">") ? "reaction" : "chemical");

const isHydratingStructure = (item) => hydratingResultIds.value.includes(item.result_id);

const canOpenResultRoute = (item) => {
  if (item?.result_type === "unified_route_job") return hasUnifiedRoutes(item);
  if (!item?.result_id || item.result_state === "failed") return false;
  return ["tree_builder", "ipp", "graph_optimization"].includes(item.result_type) || !isConditionResult(item);
};

const resultRouteHref = (item) => {
  if (!canOpenResultRoute(item)) return "";
  if (["tree_builder", "unified_route_job"].includes(item.result_type)) return `/network?tab=TE&id=${encodeURIComponent(item.result_id)}`;
  return `/network?tab=IPP&id=${encodeURIComponent(item.result_id)}&view=25`;
};

const retryHref = (item) => {
  const params = new URLSearchParams();
  const smiles = structureSmiles(item);
  if (smiles) params.set("smiles", smiles);
  if (item.description) params.set("task_name", item.description);
  if (item.result_id) params.set("retry_result_id", item.result_id);
  params.set("source", "results_retry");
  return `/?${params.toString()}`;
};

const primaryTaskHref = (item) => {
  if (item.result_state === "failed") return retryHref(item);
  return resultRouteHref(item) || "#";
};

const primaryTaskLabel = (item) => (
  item.result_state === "failed" ? `编辑后重跑 ${resultTitle(item)}` : `打开任务路线 ${resultTitle(item)}`
);

const handlePrimaryTaskClick = (event, item) => {
  if (selection.value.includes(item.result_id)) return;
  if (primaryTaskHref(item) === "#") {
    event.preventDefault();
  }
};

const applyResultDetails = (item, detail) => {
  const detailSmiles = structureSmiles(detail);
  if (detailSmiles && !structureSmiles(item)) {
    item.target_smiles = detailSmiles;
  }
  if (detail?.settings && !item.settings) {
    item.settings = detail.settings;
  }
  if (detail?.result && !item.result) {
    item.result = detail.result;
  }
};

const hydrateVisibleStructures = async () => {
  const candidates = pagedResults.value.filter((item) =>
    item?.result_id
    && !structureSmiles(item)
    && !hydratingResultIds.value.includes(item.result_id)
    && !hydratedResultIds.value.includes(item.result_id)
  );

  for (const item of candidates) {
    hydratingResultIds.value = [...hydratingResultIds.value, item.result_id];
    try {
      const detail = await API.get("/api/results/retrieve", { result_id: item.result_id });
      applyResultDetails(item, detail);
    } catch (error) {
      console.error("Could not hydrate result structure:", item.result_id, error);
    } finally {
      hydratingResultIds.value = hydratingResultIds.value.filter((id) => id !== item.result_id);
      hydratedResultIds.value = [...new Set([...hydratedResultIds.value, item.result_id])];
    }
  }
};

const resultCount = (item) => {
  const summary = unifiedSummary(item);
  if (Number.isFinite(Number(summary?.selected_route_count))) return Number(summary.selected_route_count);
  if (Number.isFinite(Number(item.num_trees))) return Number(item.num_trees);
  if (item.result_type === "ipp") return 1;
  return "—";
};

const resultSummary = (item) => {
  const summary = unifiedSummary(item);
  if (item.result_type === "unified_route_job") {
    if (item.result_state.startsWith("legacy_")) return `${jobStateLabel(item.result_state)}，保留原始结果。`;
    if (item.result_state === "completed") {
      return `${jobStateLabel(item.result_state)}：${summary?.selected_route_count || 0} 条路线，来源：${engineSummary(summary)}`;
    }
    if (["failed_unclosed", "waiting_for_engine", "cancelled"].includes(item.result_state)) {
      return jobStateLabel(item.result_state);
    }
    if (item.result_state === "completed_not_enough_routes") {
      return `统一路线任务已完成，但未找到 ${summary?.min_routes || 3} 条闭合到可购买原料的路线。`;
    }
    if (item.result_state === "failed") return "统一路线任务失败，可回到工作台编辑后重跑。";
    if (item.result_state === "partial_ready") {
      return `统一路线任务已有 ${summary?.selected_route_count || 0} 条可用路线，后台仍在补全。`;
    }
    return jobStateLabel(item.result_state);
  }
  if (hasUnifiedRoutes(item)) {
    const prefix = item.result_state === "completed" ? "统一路线池输出" : "统一路线池已提前输出";
    const suffix = item.result_state === "completed" ? "" : "，后台继续补全。";
    return `${prefix} ${summary.selected_route_count} 条闭合路线，来源：${engineSummary(summary)}${suffix}`;
  }
  if (summary && Number(summary.selected_route_count) === 0) {
    return "统一路线搜索完成，但没有闭合到可购买原料的路线。";
  }
  if (item.result_state === "pending") return "任务已入队，等待路线搜索 worker 执行。";
  if (item.result_state === "started") return "正在搜索闭合到可购买原料的路线。";
  if (item.result_state === "failed") return "任务失败，可查看设置或重新提交。";
  if (item.num_trees) return `找到 ${item.num_trees} 条闭合路线。`;
  if (item.result_type === "tree_builder") return "搜索完成，但未找到闭合到可购买原料的路线。";
  return structureSmiles(item) || "暂无结果摘要。";
};

const unifiedSummary = (item) => item?.unified_route_pool_summary || item?.result?.unified_route_pool || null;

const hasUnifiedRoutes = (item) => Number(unifiedSummary(item)?.selected_route_count) > 0;

const engineSummary = (summary) => {
  const counts = summary?.engine_counts || {};
  const entries = Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .map(([engine, count]) => `${engine} ${count}`);
  return entries.length ? entries.join("，") : "统一路线选择器";
};

const typeLabel = (item) => {
  const type = item.result_type;
  if (type === "tree_builder") return "路线树";
  if (type === "unified_route_job") return "统一路线任务";
  if (type === "ipp") return "交互式规划";
  if (type === "graph_optimization") return "路线优化";
  return type || "结果";
};

onMounted(() => update());


const openSetting = async (id) => {
    pendingTasks.value += 1;
  try {
    const json = await API.get("/api/results/retrieve", { result_id: id });
    if (json) {
      treeDialog.value = true
      targetSmiles.value = json.target_smiles
      viewSettings.value = json.settings
      tbVersion.value = json.result.version
    }
  } finally {
    pendingTasks.value -= 1;
  }
}


watch(allResults, () => {
  checkAndRefreshResults();
});

const update = async (supressLoading = false) => {
  if (!supressLoading) {
    pendingTasks.value += 1;
  }
  try {
    resultsLoadError.value = "";
    let askcosResults = [];

    try {
      const response = await loadResultHistory(API);
      if (Array.isArray(response)) {
        askcosResults = response;
      } else {
        resultsLoadError.value = "返回格式不是结果数组。";
      }
    } catch (error) {
      resultsLoadError.value = API.toErrorObject(
        error,
        "无法读取 ASKCOS 历史结果，请检查登录状态。"
      ).string_error;
    }

    const mergedResults = askcosResults;
    mergedResults.forEach(doc => {
      doc.created = formatDisplayTime(doc.created);
      doc.modified = formatDisplayTime(doc.modified);
    });
    allResults.value = mergedResults;
    totalItems.value = mergedResults.length;
    await nextTick();
    hydrateVisibleStructures();
  } catch (error) {
    resultsLoadError.value = API.toErrorObject(error, "无法读取历史任务。").string_error;
  } finally {
    if (!supressLoading) {
      pendingTasks.value -= 1;
      checkAndRefreshResults();
    }
  }
}

const formatDisplayTime = (value) => {
  if (!value) return "";
  const raw = String(value);
  const parsed = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString();
};

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
  }
});

const openChangeDescription = (item) => {
  selectedResultId.value = item.result_id;
  newDescription.value = item.description || "";
  showChangeDescriptionModal.value = true;
};

const controlTask = async (item, action) => {
  if (action === 'cancel' && !window.confirm('确认取消任务？已完成的搜索和断点将保留。')) return;
  pendingTasks.value += 1;
  try {
    await API.post(`/api/v1/unified-route/jobs/${encodeURIComponent(item.result_id)}/${action}`, {});
    await update(true);
  } catch (error) {
    resultsLoadError.value = API.toErrorObject(error, '任务操作失败，请检查服务状态。').string_error;
  } finally {
    pendingTasks.value -= 1;
  }
};

const saveChangeDescription = async () => {
  if (!selectedResultId.value) return;
  pendingTasks.value += 1;
  try {
    const current = allResults.value.find((r) => r.result_id === selectedResultId.value);
    if (!current) {
      alert("在最新结果列表中找不到选中的结果。");
      return;
    }
    const updated = {
      description: newDescription.value,
      revision: Number(current.revision),
    };
    await API.put(`/api/results/update?result_id=${encodeURIComponent(selectedResultId.value)}`, updated);
    showChangeDescriptionModal.value = false;
    await update();
  } catch (error) {
    alert("无法更新描述：" + error);
  } finally {
    pendingTasks.value -= 1;
  }
};

const destroyResult = async (id) => {
  try {
    const json = await API.delete(`/api/results/destroy?result_id=${encodeURIComponent(id)}`);
    if (json.success) {
      allResults.value = allResults.value.filter(result => result.result_id !== id)
    }
  } catch (error) {
    alert(API.toErrorObject(error, "无法移除任务。运行中的任务需先取消。").string_error);
  }
};

const deleteSelection = async () => {
  if (window.confirm(`将从历史列表移除 ${selection.value.length} 个结果，保留原始数据，是否继续？`)) {
    pendingTasks.value += 1;
    try {
      for (const id of [...selection.value]) {
        await destroyResult(id);
      }
      selection.value = [];
      await update(true);
    } finally {
      pendingTasks.value -= 1;
    }
  }
}

const deleteResult = async (id, skipConfirm = false) => {
  if (skipConfirm || window.confirm("确认从历史移除这个结果？原始数据将保留。")) {
    pendingTasks.value += 1;
    try {
      await destroyResult(id);
    } finally {
      pendingTasks.value -= 1;
      update()
    }
  }
}
</script>

<style scoped>
.results-workspace {
  min-height: calc(100vh - 124px);
  padding: 0 clamp(18px, 3vw, 56px) 64px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0, rgba(255, 255, 255, 0.92) 76px, rgba(246, 251, 249, 0.96) 77px),
    radial-gradient(circle at 14% 8%, rgba(31, 184, 130, 0.10), transparent 30%);
}

.result-mode-tabs {
  position: relative;
  z-index: 4;
  display: flex;
  justify-content: center;
  gap: 34px;
  min-height: 76px;
  margin: 0 calc(clamp(18px, 3vw, 56px) * -1) 24px;
  padding: 0 clamp(18px, 3vw, 56px);
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(18px);
}

.result-mode-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 154px;
  height: 76px;
  border: 0;
  color: rgba(15, 23, 42, 0.65);
  background: transparent;
  font-size: 1.06rem;
  font-weight: 760;
  letter-spacing: 0;
  cursor: pointer;
  transition: color 160ms ease, transform 160ms ease;
}

.result-mode-tab:hover {
  color: rgb(16, 150, 107);
  transform: translateY(-1px);
}

.result-mode-tab.active {
  color: rgb(22, 163, 116);
}

.result-mode-tab.active::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  border-radius: 999px 999px 0 0;
  background: rgb(34, 197, 142);
  content: "";
}

.result-mode-tab.disabled {
  cursor: not-allowed;
  opacity: 0.45;
  transform: none;
}

.results-layout {
  display: grid;
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  gap: 24px;
  width: 100%;
  max-width: 1960px;
  margin: 0 auto;
}

.result-groups,
.result-main-panel {
  border: 1px solid rgba(15, 23, 42, 0.10);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.90);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(14px);
}

.result-groups {
  align-self: start;
  min-height: 500px;
  overflow: hidden;
}

.group-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(248, 250, 252, 0.82);
}

.panel-kicker {
  color: rgb(16, 150, 107);
  font-size: 12px;
  font-weight: 820;
}

.group-panel-head h2 {
  margin: 2px 0 0;
  color: #111827;
  font-size: 19px;
  font-weight: 820;
  letter-spacing: 0;
}

.new-group-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 32px);
  height: 44px;
  margin: 12px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  color: rgb(22, 163, 116);
  background: rgba(34, 197, 142, 0.08);
  font-size: 15px;
  font-weight: 740;
  opacity: 0.65;
}

.group-list {
  display: grid;
  gap: 8px;
  padding: 0 12px 18px;
}

.group-item {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  color: #1f2937;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 160ms ease, color 160ms ease;
}

.group-item:hover,
.group-item.active {
  color: #0f766e;
  background: rgba(219, 234, 254, 0.78);
}

.group-item span {
  overflow: hidden;
  font-size: 13px;
  font-weight: 690;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-item strong {
  color: rgba(15, 23, 42, 0.42);
  font-size: 13px;
}

.group-empty-hint {
  margin: 56px 18px 0;
  color: rgba(15, 23, 42, 0.42);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

.result-main-panel {
  min-width: 0;
  padding: 18px 18px 28px;
}

.result-toolbar {
  display: grid;
  grid-template-columns: auto minmax(320px, 1fr) 132px;
  align-items: center;
  gap: 14px;
  padding: 0;
  background: transparent;
  margin-bottom: 14px;
}

.search-task-button {
  height: 42px !important;
  border-width: 2px !important;
  font-weight: 760 !important;
}

.result-search-input {
  min-width: 0;
}

.result-search-input :deep(.v-field) {
  border-radius: 8px !important;
  background: #ffffff;
}

.result-sort-select {
  justify-self: end;
  max-width: 112px;
}

.batch-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-height: 56px;
  margin: 0 0 18px;
  padding: 10px 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.92);
}

.result-load-alert {
  margin-bottom: 18px;
}

.result-load-alert p {
  margin: 4px 0 0;
}

.select-all-control {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-width: 110px;
  color: #111827;
  font-size: 15px;
  font-weight: 650;
}

.select-all-control input,
.card-select input {
  width: 18px;
  height: 18px;
  accent-color: rgb(34, 197, 142);
}

.batch-button,
.batch-delete {
  height: 38px !important;
  border-radius: 8px !important;
  font-weight: 680 !important;
}

.toolbar-note,
.running-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #475569;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}

.toolbar-note .v-icon {
  color: rgb(59, 130, 246);
}

.result-card-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: start;
  gap: 12px;
  min-height: 360px;
}

.result-card {
  position: relative;
  display: grid;
  grid-template-rows: 184px minmax(126px, auto) 38px;
  min-width: 0;
  min-height: 348px;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.result-card:hover {
  transform: translateY(-2px);
  border-color: rgba(34, 197, 142, 0.34);
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.10);
}

.result-card.selected {
  border-color: rgba(34, 197, 142, 0.58);
  box-shadow: 0 0 0 3px rgba(34, 197, 142, 0.16), 0 18px 42px rgba(15, 23, 42, 0.08);
}

.result-card.recent::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: rgb(34, 197, 142);
  content: "";
}

.card-select {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
}

.structure-preview {
  display: grid;
  place-items: center;
  min-width: 0;
  padding: 12px 14px;
  background: #f7f8fa;
}

.structure-preview-link {
  color: inherit;
  text-decoration: none;
}

.structure-preview-link:hover {
  background: #f2fbf7;
}

.result-structure-image,
.structure-preview :deep(.v-img) {
  width: 100%;
  height: 100%;
  max-width: 100%;
}

.structure-preview :deep(.v-responsive) {
  width: 100%;
  height: 100%;
}

.structure-preview :deep(.v-img__img) {
  object-fit: contain;
  padding: 4px;
}

.structure-preview :deep(.structure-error-state) {
  min-height: 112px;
  padding: 6px;
  background: transparent;
}

.structure-missing-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  max-width: 170px;
  color: #64748b;
  text-align: center;
}

.structure-missing-state strong {
  color: #334155;
  font-size: 13px;
}

.structure-missing-state span {
  max-width: 100%;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-body {
  min-width: 0;
  padding: 10px 11px 6px;
}

.card-title-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 8px;
}

.card-title-line h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #111827;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-title-link {
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.card-title-link:hover h3 {
  color: rgb(16, 150, 107);
}

.card-title-line strong {
  color: rgba(15, 23, 42, 0.54);
  font-size: 12px;
  font-weight: 760;
}

.card-date {
  margin: 5px 0 0;
  color: rgba(15, 23, 42, 0.46);
  font-size: 11px;
  font-weight: 620;
}

.card-description {
  min-height: 34px;
  margin: 5px 0 0;
  overflow: hidden;
  color: #64748b;
  display: -webkit-box;
  font-size: 11px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.card-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 7px;
}

.card-meta-row :deep(.v-chip) {
  height: 19px !important;
  padding: 0 6px !important;
  font-size: 10px !important;
}

.retry-run-button {
  width: 100%;
  min-height: 24px !important;
  margin-top: 6px;
  border-radius: 8px !important;
  font-size: 10px !important;
  font-weight: 760 !important;
}

.card-actions {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  align-items: center;
  gap: 2px;
  padding: 4px 7px 7px;
}

.card-actions :deep(.v-btn) {
  color: #667085;
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
}

.card-actions :deep(.v-icon) {
  font-size: 15px !important;
}

.card-actions :deep(.v-btn:hover) {
  color: rgb(16, 150, 107);
}

.empty-results {
  grid-column: 1 / -1;
  display: flex;
  min-height: 420px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #64748b;
  text-align: center;
}

.empty-results h3 {
  margin: 18px 0 6px;
  color: #111827;
  font-size: 24px;
}

.result-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 26px;
  color: #334155;
  font-weight: 700;
}

.result-pagination strong {
  display: inline-grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  color: white;
  background: rgb(34, 197, 142);
}

@media (max-width: 1180px) {
  .results-layout {
    grid-template-columns: 1fr;
  }

  .result-groups {
    min-height: 0;
  }

  .group-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .group-empty-hint {
    margin: 16px 20px 20px;
  }

  .result-toolbar {
    transform: none;
    margin-bottom: 14px;
  }
}

@media (max-width: 1360px) {
  .results-layout {
    grid-template-columns: 260px minmax(0, 1fr);
    gap: 16px;
  }

  .result-card-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 1180px) {
  .results-layout {
    grid-template-columns: 1fr;
  }

  .result-card-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .result-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .results-workspace {
    padding: 0 14px 36px;
  }

  .result-card-grid {
    grid-template-columns: 1fr;
  }

  .result-card {
    grid-template-rows: 190px auto 42px;
  }
}

@media (max-width: 720px) {
  .results-workspace {
    min-height: calc(100vh - 118px);
    padding: 0 14px 34px;
  }

  .result-mode-tabs {
    gap: 12px;
    min-height: 64px;
    margin: 0 -14px 16px;
  }

  .result-mode-tab {
    min-width: 132px;
    height: 64px;
    font-size: 0.98rem;
  }

  .result-toolbar,
  .batch-toolbar {
    display: grid;
    grid-template-columns: 1fr;
  }

  .result-sort-select {
    justify-self: stretch;
    max-width: none;
  }

  .toolbar-note,
  .running-indicator {
    white-space: normal;
  }

  .result-card-grid {
    grid-template-columns: 1fr;
  }

  .result-card {
    grid-template-rows: 220px auto 56px;
  }
}
</style>
