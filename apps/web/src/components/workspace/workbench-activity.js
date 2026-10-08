import { computed, inject, provide, toValue } from "vue";

const workbenchActivity = Symbol("workbench activity");

export function useWorkbenchActivity() {
  return inject(workbenchActivity, computed(() => true));
}

export function provideWorkbenchActivity(active) {
  const parent = useWorkbenchActivity();
  const activity = computed(() => !!toValue(parent) && !!toValue(active));
  provide(workbenchActivity, activity);
  return activity;
}
