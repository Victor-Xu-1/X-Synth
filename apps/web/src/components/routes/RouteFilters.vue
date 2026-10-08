<template>
  <div class="route-filter-bar" :aria-label="$tr('路线筛选')">
    <v-text-field
      v-model="filters.query"
      :label="$tr('路线 / 原料结构')"
      prepend-inner-icon="mdi-magnify"
      density="compact"
      variant="outlined"
      hide-details
      clearable
    />
    <v-select
      v-model="filters.engine"
      :items="engines"
      :item-title="item => item.value ? engineUiLabel(item.value) : $tr(item.title)"
      :label="$tr('搜索来源')"
      density="compact"
      variant="outlined"
      hide-details
    />
    <v-select
      v-model="filters.closure"
      :items="closures"
      :item-title="item => $tr(item.title)"
      :label="$tr('原料闭合')"
      density="compact"
      variant="outlined"
      hide-details
    />
    <v-select
      v-model="filters.sort"
      :items="sorts"
      :item-title="item => $tr(item.title)"
      :label="$tr('排序')"
      density="compact"
      variant="outlined"
      hide-details
    />
    <v-btn
      icon="mdi-filter-remove-outline"
      variant="text"
      :title="$tr('清除路线筛选')"
      :aria-label="$tr('清除路线筛选')"
      @click="
        Object.assign(filters, {
          query: '',
          engine: '',
          closure: '',
          sort: 'rank',
        })
      "
    />
  </div>
</template>
<script setup>
import { computed } from "vue";
import { engineLabel } from "@/common/route-details";
import { engineUiLabel } from "./route-ui-text";
const filters = defineModel({ type: Object, required: true });
const props = defineProps({ candidates: { type: Array, default: () => [] } });
const engines = computed(() => [
  { title: "全部来源", value: "" },
  ...[...new Set(props.candidates.map((route) => route.engine))]
    .filter(Boolean)
    .map((value) => ({ title: engineLabel(value), value })),
]);
const closures = [
  { title: "全部记录", value: "" },
  { title: "库存闭合", value: "closed" },
  { title: "未闭合", value: "open" },
];
const sorts = [
  { title: "综合排序", value: "rank" },
  { title: "步数优先", value: "steps" },
  { title: "评分优先", value: "score" },
];
</script>
<style scoped>
.route-filter-bar {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) repeat(3, minmax(130px, 180px)) 40px;
  gap: 10px;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid var(--ws-border);
}
.route-filter-bar :deep(input),
.route-filter-bar :deep(.v-select__selection-text) {
  font-size: 12px;
}
@media (max-width: 900px) {
  .route-filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr)) 40px;
  }
  .route-filter-bar > :first-child {
    grid-column: 1 / 3;
  }
  .route-filter-bar > :last-child {
    grid-column: 3;
    grid-row: 1;
  }
  .route-filter-bar > :nth-child(4) {
    grid-column: 1 / 3;
  }
}
@media (max-width: 600px) {
  .route-filter-bar {
    padding: 10px 12px;
    gap: 8px;
  }
}
</style>
