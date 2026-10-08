import { computed, inject, provide, toValue } from "vue";

const workbenchActivity = Symbol("workbench activity");

export function useWorkbenchScope() {
  return inject(workbenchActivity, null);
}

export function useWorkbenchActivity() {
  return useWorkbenchScope() ?? computed(() => true);
}

export function provideWorkbenchActivity(active) {
  const parent = useWorkbenchActivity();
  const activity = computed(() => !!toValue(parent) && !!toValue(active));
  provide(workbenchActivity, activity);
  return activity;
}
