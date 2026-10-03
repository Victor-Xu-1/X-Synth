<template>
  <div :class="['inline-ketcher-editor', { 'fill-height-mode': fillHeight }]">
    <div
      ref="ketcherFrame"
      class="inline-ketcher-frame"
      :style="ketcherFrameStyle"
    >
      <iframe
        ref="ketcherIframe"
        data-cy="home-inline-ketcher"
        :src="KETCHER_URL"
        title="结构绘制器"
        @load="patchKetcherDocument"
      ></iframe>
    </div>
    <div v-if="showActions" class="inline-ketcher-actions">
      <span class="editor-status">{{ editorStatus }}</span>
      <div class="editor-buttons">
        <v-btn
          variant="outlined"
          color="primary"
          rounded="pill"
          prepend-icon="mdi-eraser"
          :disabled="busy"
          @click="clearEditor"
        >
          清除面板
        </v-btn>
        <v-btn
          variant="flat"
          color="primary"
          rounded="pill"
          prepend-icon="mdi-check"
          :loading="busy"
          @click="readSmilesFromEditor"
        >
          应用结构
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  KETCHER_URL,
  createKetcherWriter,
  waitForKetcher as waitForEditor,
} from "@/common/ketcher";
import {
  fitKetcherCanvas,
  prepareKetcherDocument,
} from "@/common/ketcher-layout";

const smiles = defineModel("smiles", { required: true, default: "" });
const emit = defineEmits(["commit"]);
const props = defineProps({
  showActions: {
    type: Boolean,
    default: true,
  },
  fillHeight: {
    type: Boolean,
    default: false,
  },
});

const ketcherIframe = ref(null);
const ketcherFrame = ref(null);
const busy = ref(false);
const editorStatus = ref("画板就绪");
const writingFromEditor = ref(false);
const KETCHER_BASE_WIDTH = 808;
const KETCHER_BASE_HEIGHT = 432;
const KETCHER_MIN_VIEWPORT_WIDTH = 320;
const KETCHER_MIN_SCALE = 0.2;
const KETCHER_MAX_SCALE = 2.6;
const KETCHER_MIN_VISUAL_HEIGHT = 420;
const KETCHER_MAX_VISUAL_HEIGHT = 860;
const KETCHER_VIEWPORT_HEIGHT_RESERVE = 220;
const KETCHER_MEDIUM_VIEWPORT_HEIGHT_RESERVE = 250;
const KETCHER_COMPACT_VIEWPORT_HEIGHT_RESERVE = 300;
const ketcherScale = ref(1);
const ketcherVisualHeight = ref(560);
const ketcherViewportWidth = ref(KETCHER_BASE_WIDTH);
const ketcherViewportHeight = ref(KETCHER_BASE_HEIGHT);
let resizeObserver = null;
let fitRevision = 0;
const editorLifetime = new AbortController();
const fitDrawing = async () => {
  const current = ++fitRevision;
  await nextTick();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  if (editorLifetime.signal.aborted || current !== fitRevision) return;
  fitKetcherCanvas(ketcherIframe.value?.contentWindow?.ketcher?.editor);
};

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

const ketcherFrameStyle = computed(() => {
  const scale = Number(ketcherScale.value.toFixed(4));
  const visualHeight = Math.round(ketcherVisualHeight.value);

  return {
    "--ketcher-scale": String(scale),
    "--ketcher-viewport-width": `${Math.round(ketcherViewportWidth.value)}px`,
    "--ketcher-visual-height": `${visualHeight}px`,
    "--ketcher-viewport-height": `${Math.round(ketcherViewportHeight.value)}px`,
  };
});

const syncKetcherLayout = () => {
  const frame = ketcherFrame.value;
  if (!frame) return;

  const availableWidth = Math.max(
    KETCHER_MIN_VIEWPORT_WIDTH,
    frame.clientWidth,
    frame.getBoundingClientRect().width,
    frame.parentElement?.clientWidth || 0,
  );
  const viewportHeight =
    window.visualViewport?.height || window.innerHeight || 900;
  const viewportWidth =
    window.visualViewport?.width || window.innerWidth || KETCHER_BASE_WIDTH;
  const viewportHeightReserve =
    viewportWidth <= 1120
      ? KETCHER_COMPACT_VIEWPORT_HEIGHT_RESERVE
      : viewportWidth <= 1320
        ? KETCHER_MEDIUM_VIEWPORT_HEIGHT_RESERVE
        : KETCHER_VIEWPORT_HEIGHT_RESERVE;
  const availableParentHeight = Math.max(
    0,
    frame.parentElement?.clientHeight || 0,
  );
  const parentVisualLimit =
    availableParentHeight >= KETCHER_MIN_VISUAL_HEIGHT
      ? availableParentHeight
      : KETCHER_MAX_VISUAL_HEIGHT;
  const visualHeightLimit = Math.max(
    KETCHER_MIN_VISUAL_HEIGHT,
    Math.min(
      KETCHER_MAX_VISUAL_HEIGHT,
      parentVisualLimit,
      viewportHeight - viewportHeightReserve,
    ),
  );

  if (props.fillHeight) {
    const resized =
      availableWidth !== ketcherViewportWidth.value ||
      visualHeightLimit !== ketcherViewportHeight.value;
    ketcherScale.value = 1;
    ketcherViewportWidth.value = availableWidth;
    ketcherViewportHeight.value = visualHeightLimit;
    ketcherVisualHeight.value = visualHeightLimit;
    if (resized)
      fitDrawing().catch(() => {
        editorStatus.value = "结构视图调整失败，请重新打开画板。";
      });
    return;
  }

  const widthScale = availableWidth / KETCHER_BASE_WIDTH;
  const heightScale = visualHeightLimit / KETCHER_BASE_HEIGHT;
  const nextScale = clampNumber(
    Math.min(widthScale, heightScale),
    KETCHER_MIN_SCALE,
    KETCHER_MAX_SCALE,
  );
  const nextVisualHeight = KETCHER_BASE_HEIGHT * nextScale;

  ketcherScale.value = nextScale;
  ketcherViewportWidth.value = KETCHER_BASE_WIDTH;
  ketcherViewportHeight.value = KETCHER_BASE_HEIGHT;
  ketcherVisualHeight.value = nextVisualHeight;
};

const patchKetcherDocument = () => {
  const doc = ketcherIframe.value?.contentDocument;
  prepareKetcherDocument(doc);
  scheduleKetcherLayoutSync();
};

const scheduleKetcherLayoutSync = () => {
  syncKetcherLayout();
  window.requestAnimationFrame?.(() => syncKetcherLayout());
  window.setTimeout(syncKetcherLayout, 120);
  window.setTimeout(syncKetcherLayout, 360);
  window.setTimeout(syncKetcherLayout, 900);
};

const waitForKetcher = async () => {
  const ketcher = await waitForEditor(() => ketcherIframe.value, {
    signal: editorLifetime.signal,
  });
  patchKetcherDocument();
  return ketcher;
};
const writeMolecule = createKetcherWriter(waitForKetcher, {
  signal: editorLifetime.signal,
});

const setSmilesToEditor = async (value = smiles.value, options = {}) => {
  const applied = await writeMolecule(value);
  if (applied) await fitDrawing();
  if (applied && options.statusMessage) {
    editorStatus.value = options.statusMessage;
  }
};

const readSmilesFromEditor = async () => {
  busy.value = true;
  try {
    await nextTick();
    await writeMolecule.flush();
    const ketcher = await waitForKetcher();
    const rawSmiles = String(await ketcher.getSmiles()).trim();
    if (!rawSmiles) {
      writingFromEditor.value = true;
      smiles.value = "";
      emit("commit", "");
      await nextTick();
      writingFromEditor.value = false;
      editorStatus.value = "当前画板为空。";
      return null;
    }

    // Backend route submission still performs RDKit normalization and validation.
    const nextSmiles = rawSmiles;
    writingFromEditor.value = true;
    smiles.value = nextSmiles;
    emit("commit", nextSmiles);
    editorStatus.value = "结构已读取。";
    await nextTick();
    writingFromEditor.value = false;
    return nextSmiles;
  } catch (error) {
    writingFromEditor.value = false;
    editorStatus.value = "结构读取失败，请检查画板内容。";
    console.error("Could not read SMILES from inline Ketcher:", error);
    return null;
  } finally {
    busy.value = false;
  }
};

const clearEditor = async () => {
  busy.value = true;
  try {
    await writeMolecule("");
    writingFromEditor.value = true;
    smiles.value = "";
    emit("commit", "");
    editorStatus.value = "画板已清空。";
    await nextTick();
    writingFromEditor.value = false;
  } catch (error) {
    writingFromEditor.value = false;
    console.error("Could not clear inline Ketcher:", error);
  } finally {
    busy.value = false;
  }
};

watch(smiles, (nextValue, previousValue) => {
  if (writingFromEditor.value || nextValue === previousValue) return;
  setSmilesToEditor(nextValue).catch((error) => {
    editorStatus.value = "结构同步失败，请检查输入。";
    console.error("Could not sync SMILES into inline Ketcher:", error);
  });
});

onMounted(() => {
  scheduleKetcherLayoutSync();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(syncKetcherLayout);
    if (ketcherFrame.value) {
      resizeObserver.observe(ketcherFrame.value);
      if (ketcherFrame.value.parentElement) {
        resizeObserver.observe(ketcherFrame.value.parentElement);
      }
    }
  }
  window.addEventListener("resize", syncKetcherLayout, { passive: true });

  const initialLoad = smiles.value ? setSmilesToEditor() : waitForKetcher();
  initialLoad.catch((error) => {
    editorStatus.value = "结构绘制器加载失败。";
    console.error("Could not initialize inline Ketcher:", error);
  });
});

onBeforeUnmount(() => {
  editorLifetime.abort();
  resizeObserver?.disconnect();
  window.removeEventListener("resize", syncKetcherLayout);
});

defineExpose({
  readSmilesFromEditor,
  captureDraft: () =>
    ketcherIframe.value?.contentWindow?.ketcher?.editor
      ? readSmilesFromEditor()
      : null,
  clearEditor,
  setSmilesToEditor,
});
</script>

<style scoped>
.inline-ketcher-editor {
  display: grid;
  grid-template-rows: minmax(0, auto) auto;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  height: auto;
}

.inline-ketcher-editor.fill-height-mode {
  height: 100%;
  grid-template-rows: minmax(0, 1fr);
}

.inline-ketcher-frame {
  position: relative;
  height: var(--ketcher-visual-height, clamp(420px, 52dvh, 820px));
  min-height: min(360px, var(--ketcher-visual-height, 420px));
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 7px;
  background: #ffffff;
}

.inline-ketcher-editor.fill-height-mode .inline-ketcher-frame {
  height: var(--ketcher-visual-height, 100%);
  min-height: clamp(420px, var(--ketcher-visual-height, 560px), 860px);
}

.inline-ketcher-frame iframe {
  position: absolute;
  inset: 0 auto auto 0;
  display: block;
  width: var(--ketcher-viewport-width, 808px);
  height: var(--ketcher-viewport-height, 560px);
  border: 0;
  background: #ffffff;
  transform: scale(var(--ketcher-scale, 1));
  transform-origin: top left;
  transition: transform 160ms ease;
}

.inline-ketcher-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-width: 0;
}

.editor-status {
  min-width: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.35;
}

.editor-buttons {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

@media (max-width: 1120px) {
  .inline-ketcher-editor.fill-height-mode .inline-ketcher-frame {
    min-height: clamp(360px, var(--ketcher-visual-height, 408px), 760px);
  }
}

@media (max-width: 720px) {
  .inline-ketcher-frame {
    min-height: min(400px, var(--ketcher-visual-height, 430px));
  }

  .inline-ketcher-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .editor-buttons {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
