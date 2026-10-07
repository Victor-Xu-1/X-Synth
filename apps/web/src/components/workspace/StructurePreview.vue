<template>
  <div class="structure-preview">
    <div class="preview-heading">
      <span>{{ label }}</span>
      <v-tooltip :text="`放大${label}`">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-magnify-plus-outline" size="x-small" variant="text"
            :aria-label="`放大${label}`" :disabled="!smiles.trim()" @click="showPreview" />
        </template>
      </v-tooltip>
    </div>
    <SmilesImage :smiles="smiles" :input-type="inputType" :width="width" :height="height" :show-error-image="false" />
    <v-dialog v-model="open" max-width="1100" :aria-labelledby="titleId">
      <section class="structure-viewer">
        <header>
          <h2 :id="titleId">{{ label }}</h2>
          <div class="preview-zoom" role="group" aria-label="结构缩放">
            <v-tooltip text="缩小"><template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-minus" variant="text" size="small" aria-label="缩小结构" :disabled="zoom <= 0.5" @click="changeZoom(1 / 1.25)" />
            </template></v-tooltip>
            <output aria-live="polite">{{ Math.round(zoom * 100) }}%</output>
            <v-tooltip text="放大"><template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-plus" variant="text" size="small" aria-label="放大结构" :disabled="zoom >= 6" @click="changeZoom(1.25)" />
            </template></v-tooltip>
            <v-tooltip text="适应窗口"><template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-fit-to-screen-outline" variant="text" size="small" aria-label="结构适应窗口" @click="zoom = 1" />
            </template></v-tooltip>
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" aria-label="关闭结构预览" @click="open = false" />
        </header>
        <div ref="viewport" class="structure-viewer-viewport" tabindex="0" aria-label="只读结构图">
          <div class="structure-viewer-sheet" :style="{ width: `${imageWidth}px`, height: `${imageHeight}px` }">
            <SmilesImage v-if="open" ref="largeImage" :smiles="smiles" :input-type="inputType"
              :width="imageWidth" :height="imageHeight" :eager="true" :show-error-image="false" @load="measureImage" />
          </div>
        </div>
      </section>
    </v-dialog>
  </div>
</template>
<script setup>
import { computed, nextTick, reactive, ref, useId, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";
import SmilesImage from "@/components/SmilesImage.vue";
const props = defineProps({
  smiles: { type: String, default: "" },
  label: { type: String, default: "结构预览" },
  inputType: { type: String, default: "" },
  width: { type: Number, default: 260 },
  height: { type: Number, default: 160 },
});
const titleId = useId();
const open = ref(false), zoom = ref(1), viewport = ref(null), largeImage = ref(null);
const available = reactive({ width: 800, height: 480 });
const natural = reactive({ width: 800, height: 480 });
let returnFocus;
function showPreview(event) {
  returnFocus = event.currentTarget;
  open.value = true;
}
useResizeObserver(viewport, ([entry]) => {
  if (entry?.contentRect.width > 0 && entry.contentRect.height > 0) {
    available.width = entry.contentRect.width;
    available.height = entry.contentRect.height;
  }
});
const fitScale = computed(() => Math.min(available.width / natural.width, available.height / natural.height));
const imageWidth = computed(() => Math.max(1, Math.floor(natural.width * fitScale.value * zoom.value)));
const imageHeight = computed(() => Math.max(1, Math.floor(natural.height * fitScale.value * zoom.value)));
function changeZoom(factor) {
  zoom.value = Math.min(6, Math.max(0.5, zoom.value * factor));
}
async function measureImage() {
  await nextTick();
  const image = largeImage.value?.$el?.querySelector("img");
  if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    natural.width = image.naturalWidth;
    natural.height = image.naturalHeight;
  }
}
watch(open, async (value, previous) => {
  zoom.value = 1;
  if (!value && previous) {
    await nextTick();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
});
watch(() => [props.smiles, props.inputType], () => {
  returnFocus = null;
  open.value = false;
  natural.width = 800;
  natural.height = 480;
});
</script>
<style scoped>
.structure-preview { min-width: 0; }
.preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; margin-bottom: 6px; font-size: 14px; font-weight: 500; }
.structure-viewer { min-width: 0; overflow: hidden; background: var(--ws-surface); color: var(--ws-text); border: 1px solid var(--ws-border); border-radius: 8px; }
.structure-viewer header { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 20px; border-bottom: 1px solid var(--ws-border); }
.structure-viewer h2 { min-width: 0; margin: 0; font-size: 16px; font-weight: 600; flex: 1; overflow-wrap: anywhere; }
.preview-zoom { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.preview-zoom output { width: 48px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; }
.structure-viewer-viewport { height: min(65dvh, 640px); min-height: min(300px, calc(100dvh - 140px)); overflow: auto; background: var(--ws-muted-surface); }
.structure-viewer-viewport:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: -3px; }
.structure-viewer-sheet { min-width: 100%; min-height: 100%; display: grid; place-items: center; }
.structure-viewer-sheet :deep(.smiles-image-container) { flex-shrink: 0; max-width: none; }
@media (max-width: 599px) {
  .structure-viewer header { gap: 4px; padding: 8px; flex-wrap: wrap; }
  .structure-viewer h2 { flex-basis: calc(100% - 48px); }
  .preview-zoom { order: 3; justify-content: center; width: 100%; }
}
</style>
