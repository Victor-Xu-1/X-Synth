<template>
  <ModuleWorkbench title="参考反应检索">
    <section
      v-if="prefill || prefillError"
      class="reference-prefill"
      aria-label="待确认的链接反应"
    >
      <h2 class="tool-section-title">待确认的链接反应</h2>
      <SmilesImage
        v-if="prefill"
        :smiles="prefill.reaction_smiles"
        input-type="reaction"
        width="100%"
        :height="140"
        :show-error-image="false"
      />
      <p v-if="prefillError" class="tool-error" role="alert">
        {{ prefillError }}
      </p>
      <div class="reference-prefill-actions">
        <v-btn
          v-if="prefill"
          variant="tonal"
          prepend-icon="mdi-check"
          :disabled="inputPending || loading"
          data-cy="reference-apply-prefill"
          @click="applyPrefill"
          >确认并应用反应</v-btn
        >
        <v-btn variant="text" :disabled="loading" @click="discardPrefill"
          >忽略链接输入</v-btn
        >
      </div>
    </section>
    <form
      class="reference-input-layout"
      aria-label="参考反应检索输入"
      @submit.prevent="search"
    >
      <section
        class="reference-inputs"
        aria-labelledby="reference-structures-heading"
      >
        <h2 id="reference-structures-heading" class="tool-section-title">
          反应结构
        </h2>
        <div class="reference-structures">
          <StructureInput
            ref="reactantsInput"
            v-model="reactants"
            id="reference-reactants"
            label="反应物（可选）"
            :disabled="loading"
          />
          <v-icon
            icon="mdi-arrow-right"
            class="reference-arrow"
            aria-hidden="true"
          />
          <StructureInput
            ref="productInput"
            v-model="product"
            id="reference-product"
            label="产物"
            :disabled="loading"
          />
        </div>
      </section>
      <aside
        class="reference-parameters"
        aria-labelledby="reference-parameters-heading"
      >
        <h2 id="reference-parameters-heading" class="tool-section-title">
          检索参数
        </h2>
        <dl class="reference-source">
          <dt>来源</dt>
          <dd>{{ evidenceSourceLabel(sourceStatus) }}</dd>
          <dt>匹配方式</dt>
          <dd>产物结构精确匹配</dd>
          <dt>参考记录</dt>
          <dd>{{ recordedValue(sourceStatus?.record_count) }}</dd>
        </dl>
        <details v-if="sourceStatus?.sources?.length" class="reference-source">
          <summary>来源与数据覆盖</summary>
          <dl v-for="source in sourceStatus.sources" :key="source.source">
            <dt>{{ source.source }}</dt>
            <dd>{{ source.ready ? "已就绪" : referenceReason(source) }}</dd>
            <dt>参考记录</dt>
            <dd>{{ recordedValue(source.record_count) }}</dd>
            <template v-if="source.source === 'ORD'">
              <dt>含收率记录</dt>
              <dd>{{ recordedValue(source.yields_count) }}</dd>
              <dt>含条件/投料记录</dt>
              <dd>{{ recordedValue(source.conditions_count) }}</dd>
              <dt>数据许可</dt>
              <dd>{{ source.license || "未记录" }}</dd>
            </template>
          </dl>
        </details>
        <v-text-field
          v-model="limit"
          label="结果数量"
          type="number"
          min="1"
          max="30"
          step="1"
          inputmode="numeric"
          variant="outlined"
          density="compact"
          :disabled="loading"
          :error-messages="countError"
          data-cy="reference-limit"
        />
        <p v-if="!ready" class="reference-source-state" role="status">
          {{ unavailableReason }}
        </p>
        <div class="reference-submit-actions">
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            prepend-icon="mdi-magnify"
            :disabled="!canSearch"
            :loading="loading"
            data-cy="reference-search-submit"
            >查询参考反应</v-btn
          >
          <v-tooltip text="刷新参考来源状态" location="top">
            <template #activator="{ props: activator }">
              <v-btn
                v-bind="activator"
                icon="mdi-refresh"
                variant="text"
                aria-label="刷新参考来源状态"
                :disabled="statusLoading"
                @click="loadStatus"
              />
            </template>
          </v-tooltip>
        </div>
      </aside>
    </form>
    <ReferenceResults
      class="reference-search-results"
      :response="result"
      :actual-input="actualInput"
      :pending="loading"
      :error="error"
      :searched="searched"
    />
  </ModuleWorkbench>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { evidenceSourceLabel } from "@/common/reference-evidence";
import {
  recordedValue,
  referenceFailure,
  referencePrefill,
  referenceReason,
} from "@/common/reaction-references";
import { useReactionReferences } from "@/composables/useReactionReferences";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage.vue";
import ReferenceResults from "@/components/references/ReferenceResults.vue";

const route = useRoute();
const product = ref(""),
  reactants = ref(""),
  limit = ref(20);
const productInput = ref(null),
  reactantsInput = ref(null);
const prefill = ref(null),
  prefillError = ref("");
const inputPending = computed(
  () => !!(productInput.value?.pending || reactantsInput.value?.pending),
);
const blocked = computed(
  () => inputPending.value || !!prefill.value || !!prefillError.value,
);
const substrates = computed(() =>
  reactants.value.trim() ? [reactants.value.trim()] : [],
);
const {
  sourceStatus,
  ready,
  statusLoading,
  unavailableReason,
  countError,
  loading,
  canSearch,
  result,
  actualInput,
  error,
  searched,
  search,
  loadStatus,
  invalidate,
} = useReactionReferences({
  product,
  reactants: substrates,
  limit,
  blocked,
});
watch(
  () => route.query,
  () => {
    invalidate();
    prefill.value = null;
    prefillError.value = "";
    try {
      prefill.value = referencePrefill(route.query);
    } catch (failure) {
      prefillError.value = referenceFailure(failure);
    }
  },
  { immediate: true, deep: true, flush: "sync" },
);
function applyPrefill() {
  if (!prefill.value || inputPending.value || loading.value) return;
  reactants.value = prefill.value.reactants.join(".");
  product.value = prefill.value.product;
  discardPrefill();
}
function discardPrefill() {
  if (loading.value) return;
  prefill.value = null;
  prefillError.value = "";
}
</script>

<style scoped>
.reference-input-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 272px;
  border-top: 1px solid var(--ws-border);
  border-bottom: 1px solid var(--ws-border);
}
.reference-inputs,
.reference-parameters {
  min-width: 0;
}
.reference-inputs {
  padding: 20px 24px 24px 0;
}
.reference-structures {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 280px;
}
.reference-structures :deep(.structure-field) {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-self: stretch;
}
.reference-structures :deep(.smiles-image-container) {
  min-height: 190px;
  flex: 1;
  display: grid;
  align-items: center;
}
.reference-structures :deep(.v-img) {
  width: 100% !important;
  height: 190px !important;
}
.reference-structures :deep(.structure-code) {
  margin-top: auto;
}
.reference-parameters {
  border-left: 1px solid var(--ws-border);
  padding: 20px 0 24px 20px;
}
.reference-source {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr);
  gap: 10px;
  font-size: 12px;
  margin: 14px 0 24px;
}
.reference-source dt,
.reference-source-state {
  color: var(--ws-muted);
}
.reference-source dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.reference-source-state,
.tool-error {
  font-size: 12px;
  overflow-wrap: anywhere;
  margin: 12px 0;
}
.reference-submit-actions,
.reference-prefill-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.reference-submit-actions :deep(.v-btn),
.reference-prefill-actions :deep(.v-btn) {
  max-width: 100%;
}
.reference-submit-actions :deep(.v-btn__content),
.reference-prefill-actions :deep(.v-btn__content) {
  white-space: normal;
}
.reference-search-results {
  padding-top: 24px;
}
.reference-prefill {
  min-width: 0;
  border-top: 1px solid var(--ws-border);
  padding: 16px 0;
}
.reference-prefill :deep(.smiles-image-container) {
  min-height: 140px;
}
@media (max-width: 1000px) {
  .reference-input-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .reference-inputs {
    padding-right: 0;
  }
  .reference-parameters {
    border-left: 0;
    border-top: 1px solid var(--ws-border);
    padding-left: 0;
  }
}
@media (max-width: 600px) {
  .reference-structures {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .reference-arrow {
    justify-self: center;
    transform: rotate(90deg);
  }
}
</style>
