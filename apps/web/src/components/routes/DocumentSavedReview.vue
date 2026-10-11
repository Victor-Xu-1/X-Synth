<template>
  <details v-if="receipt" class="document-saved-review" data-source-saved-review>
    <summary>{{ $tr('副本保存时的审查记录') }}</summary>
    <div class="document-saved-review-body">
      <DeliveryReviewBadge :receipt="receipt" />
      <span>{{ $tr('历史票据，不代表当前来源核验。') }}</span>
    </div>
  </details>
</template>
<script setup>
import DeliveryReviewBadge from "./DeliveryReviewBadge.vue";
defineProps({ receipt: Object });
</script>
<style scoped>
.document-saved-review { min-width: 0; font-size: 12px; color: var(--ws-muted); }
summary { cursor: pointer; overflow-wrap: anywhere; }
.document-saved-review-body { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 6px; }
summary:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
</style>
