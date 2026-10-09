<template>
  <slot name="activator" :show-preview="showPreview" />
  <WorkbenchDialog v-if="session" :key="session.ticket" v-model="open" max-width="1100"
    :aria-labelledby="titleId" v-on="session.events">
    <section class="structure-viewer">
      <header>
        <h2 :id="titleId">{{ $tr(label) }}</h2>
        <div class="preview-zoom" role="group" :aria-label="$tr('结构缩放')">
          <v-tooltip :text="$tr('缩小')"><template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-minus" variant="text" size="small"
              :aria-label="$tr('缩小结构')" :disabled="zoom <= 0.5" @click="changeZoom(1 / 1.25)" />
          </template></v-tooltip>
          <output aria-live="polite">{{ Math.round(zoom * 100) }}%</output>
          <v-tooltip :text="$tr('放大')"><template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-plus" variant="text" size="small"
              :aria-label="$tr('放大结构')" :disabled="zoom >= 6" @click="changeZoom(1.25)" />
          </template></v-tooltip>
          <v-tooltip :text="$tr('适应窗口')"><template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-fit-to-screen-outline" variant="text" size="small"
              :aria-label="$tr('结构适应窗口')" @click="zoom = 1" />
          </template></v-tooltip>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" :aria-label="$tr('关闭结构预览')" @click="open = false" />
      </header>
      <div ref="viewport" class="structure-viewer-viewport" tabindex="0" :aria-label="$tr('只读结构图')">
        <div class="structure-viewer-sheet" :style="{ width: `${imageWidth}px`, height: `${imageHeight}px` }">
          <SmilesImage v-if="open" ref="largeImage" :smiles="smiles" :input-type="inputType"
            :width="imageWidth" :height="imageHeight" :eager="true" :show-error-image="false" @load="measureImage" />
        </div>
      </div>
    </section>
  </WorkbenchDialog>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, useId, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { useDialogReturnFocus } from "@/composables/useDialogReturnFocus";
import { useWorkbenchActivity } from "./workbench-activity";
import WorkbenchDialog from "./WorkbenchDialog.vue";
import SmilesImage from "@/components/SmilesImage.vue";

const props = defineProps({
  smiles: { type: String, default: "" },
  label: { type: String, default: "结构预览" },
  inputType: { type: String, default: "" },
  contextKey: { type: String, default: "" },
});
const titleId = useId(), activity = useWorkbenchActivity();
const open = ref(false), zoom = ref(1), viewport = ref(null), largeImage = ref(null);
const session = shallowRef(null);
const context = computed(() => JSON.stringify([props.smiles, props.inputType, props.contextKey]));
const focus = useDialogReturnFocus(open, context);
const available = reactive({ width: 800, height: 480 });
const natural = reactive({ width: 800, height: 480 });
let disposed = false;

function showPreview(event) {
  if (disposed || !activity.value || open.value || !props.smiles.trim()) return;
  const ticket = focus.begin(null, event?.currentTarget);
  // Each keyed presentation keeps its own immutable leave callback.
  session.value = { ticket, events: { afterLeave: () => {
    focus.restore(ticket);
    if (session.value?.ticket === ticket && !open.value) session.value = null;
  } } };
  open.value = true;
}
useResizeObserver(viewport, ([entry]) => {
  const size = entry?.contentRect;
  if (!disposed && size?.width > 0 && size.height > 0) {
    available.width = size.width;
    available.height = size.height;
  }
});
const fitScale = computed(() => Math.min(available.width / natural.width, available.height / natural.height));
const imageWidth = computed(() => Math.max(1, Math.floor(natural.width * fitScale.value * zoom.value)));
const imageHeight = computed(() => Math.max(1, Math.floor(natural.height * fitScale.value * zoom.value)));
function changeZoom(factor) {
  zoom.value = Math.min(6, Math.max(0.5, zoom.value * factor));
}
async function measureImage() {
  const ticket = session.value?.ticket;
  await nextTick();
  if (disposed || !open.value || ticket !== session.value?.ticket) return;
  const image = largeImage.value?.$el?.querySelector("img");
  if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    natural.width = image.naturalWidth;
    natural.height = image.naturalHeight;
  }
}
watch(open, () => { zoom.value = 1; }, { flush: "sync" });
watch(context, () => {
  focus.cancel();
  open.value = false;
  session.value = null;
  natural.width = 800;
  natural.height = 480;
}, { flush: "sync" });
onBeforeUnmount(() => { disposed = true; });
</script>
<style scoped>
.structure-viewer { display: flex; flex-direction: column; max-height: calc(100dvh - 48px); min-width: 0; overflow: hidden; background: var(--ws-surface); color: var(--ws-text); border: 1px solid var(--ws-border); border-radius: 8px; }
.structure-viewer header { display: flex; flex-shrink: 0; align-items: center; gap: 12px; padding: 10px 12px 10px 20px; border-bottom: 1px solid var(--ws-border); }
.structure-viewer h2 { min-width: 0; margin: 0; font-size: 16px; font-weight: 600; flex: 1; overflow-wrap: anywhere; }
.preview-zoom { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.preview-zoom output { width: 48px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; }
.structure-viewer header :deep(.v-btn) { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
.structure-viewer-viewport { flex: 1 1 auto; height: min(65dvh, 640px); min-height: 0; overflow: auto; background: var(--ws-muted-surface); }
.structure-viewer-viewport:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: -3px; }
.structure-viewer-sheet { min-width: 100%; min-height: 100%; display: grid; place-items: center; }
.structure-viewer-sheet :deep(.smiles-image-container) { flex-shrink: 0; max-width: none; }
@media (max-width: 599px) {
  .structure-viewer header { gap: 4px; padding: 8px; flex-wrap: wrap; }
  .structure-viewer h2 { flex-basis: calc(100% - 48px); }
  .preview-zoom { order: 3; justify-content: center; width: 100%; }
}
</style>
