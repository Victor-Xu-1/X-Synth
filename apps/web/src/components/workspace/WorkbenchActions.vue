<template>
  <footer ref="surface" class="workbench-actions" role="group" :aria-label="$tr(label)">
    <div v-if="$slots.context" class="workbench-action-context"><slot name="context" /></div>
    <div class="workbench-action-controls"><slot /></div>
  </footer>
</template>

<script setup>
import { ref, watch } from "vue";
import { bindFormActionFocus } from "@/common/form-action-focus";
defineProps({ label: { type: String, default: "操作" } });
const surface = ref(null);
watch(surface, (element, _, onCleanup) => onCleanup(bindFormActionFocus(element)), { flush: "post" });
</script>

<style scoped>
.workbench-actions {
  position: sticky;
  bottom: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 24px;
  min-width: 0;
  padding: 16px 24px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.workbench-action-context {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  min-width: 0;
  color: var(--ws-muted);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.workbench-action-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  margin-inline-start: auto;
}
.workbench-action-controls :deep(.v-btn) { min-height: 44px; max-width: 100%; }
.workbench-action-controls :deep(.v-btn:not(.v-btn--icon)) { height: auto; padding-block: 10px; }
.workbench-action-controls :deep(.v-btn__content) { white-space: normal; line-height: 1.4; }
@media (max-width: 999px) {
  .workbench-actions {
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
    gap: 8px 16px;
  }
}
@media (max-width: 600px) {
  .workbench-action-controls { flex: 1 1 100%; }
  .workbench-action-controls :deep(.v-btn:not(.v-btn--icon)) { flex: 1 1 0; min-width: 0; }
}
@media print { .workbench-actions { position: static; } }
</style>
