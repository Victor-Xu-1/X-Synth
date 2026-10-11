<template>
  <div
    class="procurement-status"
    :class="{ 'procurement-warning': presentation.status === 'unresolved', 'procurement-invalid': presentation.status === 'invalid' }"
    :data-procurement-status="presentation.status"
  >
    <span class="procurement-status-label" :title="$tr(presentation.boundaryLabel)">
      <v-icon v-if="presentation.status === 'unresolved' || presentation.status === 'invalid'"
        icon="mdi-alert-circle-outline" size="14" aria-hidden="true" />
      {{ $tr(presentation.label) }}
    </span>
    <span v-if="presentation.reasonLabel" class="procurement-status-reason">
      {{ $tr(presentation.reasonLabel) }}
      <span v-if="presentation.status === 'unresolved'" class="procurement-material-limit">{{ $tr('不能作为已确认商购原料') }}</span>
    </span>
    <span v-if="!compact" class="procurement-boundary">{{ $tr(presentation.boundaryLabel) }}</span>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { stockProcurementPresentation } from "@/common/stock-procurement";

const props = defineProps({
  record: { type: Object, default: null },
  snapshot: { type: String, default: "" },
  smiles: { type: String, default: "" },
  compact: { type: Boolean, default: false },
});
const presentation = computed(() => stockProcurementPresentation(props.record, {
  snapshot: props.snapshot, smiles: props.smiles,
}));
</script>

<style scoped>
.procurement-status { display: grid; gap: 4px; min-width: 0; font-size: 12px; line-height: 1.5; color: var(--ws-muted); overflow-wrap: anywhere; }
.procurement-status-label { display: flex; align-items: baseline; gap: 4px; color: var(--ws-text); }
.procurement-warning .procurement-status-label, .procurement-warning .procurement-status-reason { color: var(--ws-warning); }
.procurement-invalid .procurement-status-label { color: var(--ws-danger); }
.procurement-material-limit { display: block; font-weight: 600; }
</style>
