<template>
  <span class="delivery-review-badge" :data-delivery-grade="grade">
    <v-icon :icon="icons[grade]" size="14" aria-hidden="true" />
    <span>{{ $tr(deliveryReviewLabels[grade]) }}</span>
  </span>
</template>
<script setup>
import { computed } from "vue";
import { deliveryReviewGrade, deliveryReviewLabels } from "@/common/delivery-review";

const props = defineProps({ receipt: { default: null } });
const grade = computed(() => deliveryReviewGrade(props.receipt));
const icons = {
  not_independently_reviewed: "mdi-shield-outline",
  model_checked: "mdi-shield-search",
  purchase_form_unresolved: "mdi-flask-outline",
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
.delivery-review-badge[data-delivery-grade="purchase_form_unresolved"] { color: var(--ws-warning); }
</style>
