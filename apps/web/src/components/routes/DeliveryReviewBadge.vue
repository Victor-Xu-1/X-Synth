<template>
  <span class="delivery-review-badge" :data-delivery-grade="review.grade" :data-delivery-status="review.status"
    :title="tooltip || undefined" :aria-label="tooltip ? $tr(review.label) + ': ' + tooltip : undefined"
    :tabindex="tooltip ? 0 : undefined">
    <v-icon :icon="icons[review.status] || icons[review.grade]" size="14" aria-hidden="true" />
    <span>{{ $tr(review.label) }}</span>
  </span>
</template>
<script setup>
import { computed } from "vue";
import { deliveryReviewPresentation } from "@/common/delivery-review";
import { uiText } from "@/i18n";

const props = defineProps({ receipt: { default: null } });
const review = computed(() => deliveryReviewPresentation(props.receipt));
const tooltip = computed(() => review.value.breakdown.length
  ? uiText("已选路线") + ': ' + review.value.breakdown.map(item => `${uiText(item.label)}: ${item.count}`).join('; ')
  : "");
const icons = {
  not_independently_reviewed: "mdi-shield-outline",
  model_checked: "mdi-shield-search",
  operation_evidence_required: "mdi-flask-outline",
  purchase_form_unresolved: "mdi-flask-outline",
  mixed_review: "mdi-shield-outline",
  pending: "mdi-progress-clock",
  unavailable: "mdi-alert-circle-outline",
};
</script>
<style scoped>
.delivery-review-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--ws-muted);
  background: var(--ws-bg);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.delivery-review-badge :deep(.v-icon) { flex-shrink: 0; }
.delivery-review-badge[data-delivery-grade="model_checked"] { color: var(--ws-text); }
.delivery-review-badge[data-delivery-grade="purchase_form_unresolved"],
.delivery-review-badge[data-delivery-grade="operation_evidence_required"],
.delivery-review-badge[data-delivery-grade="mixed_review"] { color: var(--ws-warning); }
</style>
