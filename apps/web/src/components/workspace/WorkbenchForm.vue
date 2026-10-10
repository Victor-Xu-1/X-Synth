<template>
  <form
    class="inspector-workbench"
    :class="{
      'inspector-hidden': !inspectorVisible,
      'full-height': fullHeight,
    }"
    @submit.prevent="$emit('submit', $event)"
  >
    <div class="workbench-input-area">
      <header v-if="$slots.heading" class="workbench-page-heading">
        <slot name="heading" />
      </header>
      <div v-if="$slots.modes" class="workbench-page-modes">
        <slot name="modes" />
      </div>
      <slot />
    </div>
    <aside
      v-show="inspectorVisible"
      class="workbench-inspector"
      :aria-label="$tr(parameterLabel)"
    >
      <slot name="parameters" />
    </aside>
    <WorkbenchActions v-if="$slots.actions" v-show="inspectorVisible" class="workbench-form-actions"
      :label="parameterLabel">
      <template v-if="$slots['action-context']" #context><slot name="action-context" /></template>
      <slot name="actions" />
    </WorkbenchActions>
  </form>
</template>

<script setup>
import WorkbenchActions from "./WorkbenchActions.vue";
defineProps({
  parameterLabel: { type: String, default: "参数" },
  inspectorVisible: { type: Boolean, default: true },
  fullHeight: Boolean,
});
defineEmits(["submit"]);
</script>

<style scoped>
.inspector-workbench {
  display: grid;
  grid-template-columns: var(--ws-inspector-width) minmax(0, 1fr);
  align-items: stretch;
  min-width: 0;
  border-top: 1px solid var(--ws-border);
  border-bottom: 1px solid var(--ws-border);
}
.inspector-workbench.full-height {
  min-height: calc(100dvh - var(--ws-header-height));
  border-top: 0;
  border-bottom: 0;
}
.workbench-inspector {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  padding: 28px 24px;
  border-right: 1px solid var(--ws-border);
  background: var(--ws-inspector);
}
.workbench-input-area {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  padding: 28px 32px;
}
.workbench-page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}
.workbench-page-modes {
  margin-bottom: 24px;
}
.workbench-form-actions { grid-column: 1 / -1; grid-row: 2; }
.inspector-hidden {
  grid-template-columns: minmax(0, 1fr);
}
.inspector-hidden .workbench-input-area {
  grid-column: 1;
}
@media (max-width: 1199px) {
  .inspector-workbench {
    grid-template-columns: 292px minmax(0, 1fr);
  }
  .inspector-hidden {
    grid-template-columns: minmax(0, 1fr);
  }
  .workbench-inspector,
  .workbench-input-area {
    padding: 24px 20px;
  }
}
@media (max-width: 999px) {
  .inspector-workbench {
    grid-template-columns: minmax(0, 1fr);
  }
  .workbench-input-area {
    grid-column: 1;
    grid-row: 1;
    padding: 22px 16px;
  }
  .workbench-inspector {
    grid-column: 1;
    grid-row: 2;
    border-right: 0;
    border-top: 1px solid var(--ws-border);
    padding: 22px 16px;
  }
  .workbench-form-actions { grid-row: 3; }
  .workbench-page-heading {
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .workbench-page-modes {
    margin-bottom: 20px;
  }
}
</style>
