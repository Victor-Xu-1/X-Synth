<template>
  <v-dialog
    :model-value="true"
    max-width="960"
    aria-labelledby="route-condition-title"
    @update:model-value="!$event && $emit('close')"
  >
    <section class="route-condition-dialog">
      <header>
        <div>
          <span class="field-label">{{ $tr('当前合成步骤') }}</span>
          <h2 id="route-condition-title">{{ $tr('反应条件预测') }}</h2>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          :aria-label="$tr('关闭条件预测')"
          @click="$emit('close')"
        />
      </header>
      <div class="condition-input-summary">
        <SmilesImage
          :smiles="reactants + '>>' + product"
          input-type="reaction"
          :width="620"
          :height="180"
          :show-error-image="false"
        />
        <div class="condition-run-controls">
          <label
            ><span class="field-label">{{ $tr('候选数量') }}</span>
            <select
              v-model.number="count"
              class="workspace-input"
              :disabled="pending > 0"
            >
              <option :value="3">3</option>
              <option :value="5">5</option>
              <option :value="10">10</option>
            </select>
          </label>
          <v-btn
            prepend-icon="mdi-beaker-outline"
            color="primary"
            variant="flat"
            :loading="pending > 0"
            :disabled="pending > 0"
            @click="predict"
            >{{ $tr('预测条件') }}</v-btn
          >
        </div>
      </div>
      <p v-if="error" class="tool-error" role="alert">{{ $tr(error) }}</p>
      <ConditionRecommendation
        v-if="submitted || pending || error"
        :results="results"
        :prediction="prediction"
        :submitted="submitted"
        :pending="pending"
        :error="error"
        :allow-evaluation="false"
      />
    </section>
  </v-dialog>
</template>
<script setup>
import { computed, ref } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import ConditionRecommendation from "@/views/forward/tab/ConditionRecommendation.vue";
import { useConditionPrediction } from "@/composables/useConditionPrediction";
import { errorMessage } from "@/common/workspace-errors";
const props = defineProps({ reaction: { type: Object, required: true } });
defineEmits(["close"]);
const reactants = computed(() => props.reaction.precursors.join("."));
const product = computed(() => props.reaction.product);
const count = ref(3),
  results = ref([]),
  pending = ref(0),
  error = ref("");
const { predict, prediction, submitted } = useConditionPrediction({
  reactants,
  product,
  count,
  results,
  pending,
  onInvalidate: () => {
    error.value = "";
  },
  reportError: (message, cause) => {
    error.value = cause ? errorMessage(cause, message) : message;
  },
});
</script>
<style scoped>
.route-condition-dialog {
  background: var(--ws-surface);
  color: var(--ws-text);
  border-radius: 8px;
  padding: 24px;
  max-height: 88dvh;
  overflow-y: auto;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
h2 {
  font-size: 20px;
  font-weight: 600;
  margin-top: 4px;
}
.condition-input-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 20px;
  border-top: 1px solid var(--ws-border);
  border-bottom: 1px solid var(--ws-border);
  padding: 16px 0;
  margin-bottom: 20px;
  align-items: center;
}
.condition-input-summary :deep(.smiles-image-container) {
  max-width: 100%;
}
.condition-run-controls {
  display: grid;
  gap: 16px;
}
label .workspace-input {
  margin-top: 8px;
}
@media (max-width: 700px) {
  .route-condition-dialog {
    padding: 16px;
  }
  .condition-input-summary {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .condition-run-controls {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }
}
</style>
