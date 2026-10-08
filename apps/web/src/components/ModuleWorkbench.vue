<template>
  <section class="module-workbench">
    <header class="page-heading">
      <h1>{{ title }}</h1>
      <div v-if="initialized" :key="scope" ref="actions" v-show="available" class="page-actions"
        :hidden="!available" :inert="!available || undefined" :aria-hidden="!available || undefined">
        <v-defaults-provider :defaults="overlayDefaults"><slot name="actions" /></v-defaults-provider>
      </div>
    </header>
    <WorkbenchTabs :items="modules" :model-value="activeModule" :label="`${title}模块`"
      :panel="$slots.module ? undefined : contentId" :disabled="!available"
      @update:model-value="$emit('select-module', $event)">
      <template #default="{ tabId, panelId }">
        <div v-if="!available" ref="status" :class="checking ? 'workspace-loading' : 'workspace-empty'"
          role="status" aria-live="polite" tabindex="-1">
          <template v-if="checking"><v-progress-linear indeterminate /><span>连接计算服务</span></template>
          <template v-else>
            <v-icon icon="mdi-server-off" size="32" />
            <h2>{{ workspace.error ? "工作区连接不可用" : "当前服务未启用" }}</h2>
            <p v-if="workspace.error" class="workspace-muted">{{ workspace.error }}</p>
            <router-link to="/environments?tab=monitor">查看运行监测</router-link>
          </template>
        </div>
        <div v-if="initialized || modules.length" :key="scope" ref="content" v-show="available" class="workbench-content"
          :hidden="!available" :inert="!available || undefined" :aria-hidden="!available || undefined"
          :id="!$slots.module && modules.length ? contentId : undefined"
          :role="!$slots.module && modules.length ? 'tabpanel' : undefined"
          :aria-labelledby="!$slots.module && modules.length ? tabId(activeModule) : undefined"
          :tabindex="!$slots.module && modules.length ? 0 : undefined">
          <v-defaults-provider :defaults="overlayDefaults">
            <template v-if="$slots.module">
              <section v-for="module in modules" :id="panelId(module.value)" :key="module.value"
                v-show="module.value === activeModule && !module.disabled" role="tabpanel"
                :aria-labelledby="tabId(module.value)" tabindex="0"
                :hidden="module.value !== activeModule || module.disabled"
                :inert="module.value !== activeModule || module.disabled || undefined"
                :aria-hidden="module.value !== activeModule || module.disabled || undefined">
                <v-defaults-provider :defaults="defaultsFor(available && module.value === activeModule && !module.disabled)">
                  <slot v-if="initialized && visited.includes(module.value)" name="module" :value="module.value" />
                </v-defaults-provider>
              </section>
            </template>
            <slot v-else-if="initialized" />
          </v-defaults-provider>
        </div>
      </template>
    </WorkbenchTabs>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useWorkspaceStore } from "@/store/workspace";
import { pageFeature } from "@/common/workspace-navigation";
import WorkbenchTabs from "./WorkbenchTabs.vue";

const props = defineProps({
  title: { type: String, required: true },
  modules: { type: Array, default: () => [] },
  activeModule: String,
});
defineEmits(["select-module"]);
const route = useRoute(), workspace = useWorkspaceStore();
const feature = computed(() => pageFeature(route));
const scope = computed(() => JSON.stringify([route.path, feature.value]));
const available = computed(() => !feature.value || workspace.can(feature.value));
const checking = computed(() => !!feature.value && !workspace.error && workspace.checking(feature.value));
const initialized = ref(false), visited = ref([]), content = ref(null), actions = ref(null), status = ref(null);
const contentId = `workbench-${crypto.randomUUID()}-panel`;
let previousScope, focusGeneration = 0, disposed = false, blockedFocus = null;

watch([scope, available, () => props.activeModule, () => props.modules], ([current, enabled]) => {
  if (current !== previousScope) {
    previousScope = current;
    initialized.value = false;
    visited.value = [];
    blockedFocus = null;
  }
  if (!enabled) return;
  initialized.value = true;
  if (props.modules.some((module) => module.value === props.activeModule && !module.disabled) &&
      !visited.value.includes(props.activeModule)) visited.value.push(props.activeModule);
}, { immediate: true, flush: "sync", deep: true });

// Keep dialogs under the same hidden/inert gate without discarding their input subtree.
function defaultsFor(enabled) {
  return {
    VDialog: { attach: true, retainFocus: enabled, captureFocus: enabled,
      scrim: enabled, scrollStrategy: enabled ? "block" : "none",
      persistent: !enabled, closeOnBack: enabled, noClickAnimation: !enabled },
    VMenu: { attach: true, disabled: !enabled },
    VTooltip: { attach: true, disabled: !enabled },
  };
}
const overlayDefaults = computed(() => defaultsFor(available.value));
watch(available, async (enabled) => {
  const current = ++focusGeneration, originScope = scope.value, focused = document.activeElement;
  if (enabled) {
    const origin = blockedFocus;
    blockedFocus = null;
    if (!origin || origin.scope !== originScope || (focused !== status.value && focused !== document.body)) return;
    await nextTick();
    const active = document.activeElement;
    if (!disposed && current === focusGeneration && originScope === scope.value && available.value &&
        origin.element.isConnected && !origin.element.disabled && !origin.element.closest("[hidden], [inert]") &&
        (active === focused || active === document.body)) origin.element.focus({ preventScroll: true });
    return;
  }
  if (!(content.value?.contains(focused) || actions.value?.contains(focused))) return;
  blockedFocus = { scope: originScope, element: focused };
  await nextTick();
  if (!disposed && current === focusGeneration && originScope === scope.value && !available.value && status.value?.isConnected)
    status.value.focus({ preventScroll: true });
});
onBeforeUnmount(() => { disposed = true; blockedFocus = null; focusGeneration++; });
</script>
