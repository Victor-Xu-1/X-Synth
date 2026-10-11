<template>
  <section
    v-if="reasons.length"
    class="route-step-review"
    :aria-label="$tr('反应操作待核验')"
    data-review="step-operations"
  >
    <p class="step-review-heading">
      <v-icon icon="mdi-alert-circle-outline" size="16" aria-hidden="true" />{{ $tr('反应操作待核验') }}
    </p>
    <ul>
      <li v-for="reason in reasons" :key="reason">{{ $tr(reason) }}</li>
    </ul>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { readRouteDeliveryReview, unresolvedOperationSteps, operationReasonLabel } from "@/common/delivery-review";

const props = defineProps({ stepId: String, deliveryReview: Object });
const reasons = computed(() => {
  const receipt = readRouteDeliveryReview(props.deliveryReview);
  const issue = unresolvedOperationSteps(receipt).find(step => step.step_id === props.stepId);
  return [...new Set((issue?.reasons || []).map(operationReasonLabel))];
});
</script>
<style scoped>
.route-step-review {
  min-width: 0;
  margin: 12px 0;
  color: var(--ws-warning);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.step-review-heading {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 4px;
  font-weight: 550;
}
ul { margin: 0; padding-left: 20px; }
</style>
