<template>
  <section class="reaction-references" aria-label="反应参考检索">
    <div class="reaction-reference-controls">
      <span>{{ ready ? "USPTO_FULL · 来源已就绪" : unavailableReason }}</span>
      <div class="reaction-reference-actions">
        <v-tooltip text="刷新参考来源状态" location="top">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              icon="mdi-refresh"
              variant="text"
              size="small"
              aria-label="刷新参考来源状态"
              :disabled="statusLoading"
              @click="loadStatus"
            />
          </template>
        </v-tooltip>
        <v-btn
          prepend-icon="mdi-magnify"
          variant="tonal"
          size="small"
          :loading="loading"
          :disabled="!canSearch"
          data-cy="reaction-reference-search"
          @click="search"
          >查询参考反应</v-btn
        >
      </div>
    </div>
    <ReferenceResults
      :response="result"
      :actual-input="actualInput"
      :pending="loading"
      :error="error"
      :searched="searched"
    />
  </section>
</template>

<script setup>
import { toRef } from "vue";
import { useReactionReferences } from "@/composables/useReactionReferences";
import ReferenceResults from "./ReferenceResults.vue";
// Parent keys this component by node identity, including nodes with identical chemistry.
const props = defineProps({
  product: { type: String, default: "" },
  reactants: { type: Array, default: () => [] },
});
const {
  ready,
  unavailableReason,
  statusLoading,
  loading,
  canSearch,
  result,
  actualInput,
  error,
  searched,
  loadStatus,
  search,
  invalidate,
  sourceStatus,
  searchState,
} = useReactionReferences({
  product: toRef(props, "product"),
  reactants: toRef(props, "reactants"),
});
defineExpose({
  search,
  invalidate,
  sourceStatus,
  result,
  actualInput,
  searchState,
});
</script>

<style scoped>
.reaction-references {
  min-width: 0;
  border-top: 1px solid var(--ws-border);
  padding-top: 12px;
}
.reaction-reference-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.reaction-reference-controls > span {
  font-size: 11px;
  color: var(--ws-muted);
  min-width: 0;
  overflow-wrap: anywhere;
}
.reaction-reference-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.reaction-reference-actions :deep(.v-btn__content) {
  white-space: normal;
}
.reaction-reference-actions :deep(.v-btn) {
  max-width: 100%;
}
</style>
