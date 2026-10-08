<template>
  <div
    :class="[
      'inline-ketcher-editor',
      { 'fill-height-mode': fillHeight, 'compact-mode': compact },
    ]"
  >
    <div
      ref="ketcherFrame"
      class="inline-ketcher-frame"
      :style="ketcherFrameStyle"
      :aria-busy="pending && !editorError"
    >
      <v-progress-linear
        v-if="pending && !editorError"
        class="editor-progress"
        indeterminate
        height="2"
        :aria-label="$tr('正在同步结构')"
      />
      <iframe
        ref="ketcherIframe"
        data-cy="home-inline-ketcher"
        :src="KETCHER_URL"
        :title="$tr(title)"
        allowfullscreen
        :inert="disabled || !ready || busy || undefined"
        @load="patchKetcherDocument"
      ></iframe>
    </div>
    <p v-if="editorError" class="editor-error" role="alert">
      {{ $tr(editorError) }}
    </p>
    <div v-if="showActions" class="inline-ketcher-actions">
      <span class="editor-status">{{ $tr(editorStatus) }}</span>
      <div class="editor-buttons">
        <v-btn
          variant="outlined"
          color="primary"
          rounded="pill"
          prepend-icon="mdi-eraser"
          :disabled="busy || disabled || !ready"
          @click="clearEditor"
        >
          {{ $tr('清除面板') }}
        </v-btn>
        <v-btn
          variant="flat"
          color="primary"
          rounded="pill"
          prepend-icon="mdi-check"
          :loading="busy"
          :disabled="disabled || !ready || !!editorError"
          @click="readSmilesFromEditor"
        >
          {{ $tr('应用结构') }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { KETCHER_URL, waitForKetcher as waitForEditor } from "@/common/ketcher";
import { useKetcherMolecule } from "@/composables/useKetcherMolecule";
import { createKetcherFocusGuard } from "@/common/ketcher-focus";
import {
  ReactionCanvasError,
  readReactionCanvas,
} from "@/common/ketcher-reaction";
import { errorMessage } from "@/common/workspace-errors";
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
  compact: Boolean,
  autoSync: Boolean,
  disabled: Boolean,
  title: { type: String, default: "结构绘制器" },
  reaction: Boolean,
  emptyContent: { type: String, default: "" },
  canvasHeight: { type: Number, default: 0 },
  prepareContent: { type: Function, default: null },
  readContent: { type: Function, default: null },
  contentApplied: { type: Function, default: null },
  contentPublished: { type: Function, default: null },
});

const ketcherIframe = ref(null);
const ketcherFrame = ref(null);
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
  if (
    editorLifetime.signal.aborted ||
    current !== fitRevision ||
    !ketcherFrame.value?.clientWidth
  )
    return;
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
  if (!frame || !frame.getClientRects().length) return;
  // Ketcher 2.13 registers its resize handler before its native editor exists.
  // Keep the iframe viewport stable until that initialization has completed.
  if (!ketcherIframe.value?.contentWindow?.ketcher?.editor) return;

  const availableWidth = Math.max(
    props.fillHeight || props.compact || props.reaction
      ? 1
      : KETCHER_MIN_VIEWPORT_WIDTH,
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
  const visualHeightLimit = props.canvasHeight
    ? clampNumber(props.canvasHeight, 360, KETCHER_MAX_VISUAL_HEIGHT)
    : props.compact
      ? 380
      : Math.max(
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
  focusGuard.observe();
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
const focusGuard = createKetcherFocusGuard(
  () => ketcherIframe.value,
  () => !ready.value || busy.value,
);
const {
  busy,
  ready,
  pending,
  error: editorError,
  status: editorStatus,
  initialize,
  readSmilesFromEditor,
  clearEditor,
  setSmilesToEditor,
  readSnapshot,
} = useKetcherMolecule({
  smiles,
  getEditor: waitForKetcher,
  signal: editorLifetime.signal,
  autoSync: () => props.autoSync,
  disabled: () => props.disabled,
  fitDrawing,
  captureFocus: focusGuard.capture,
  commit: (value) => emit("commit", value),
  readStructure: (editor) =>
    props.readContent
      ? props.readContent(editor)
      : props.reaction
        ? readReactionCanvas(editor)
        : editor.getSmiles(),
  editorContent: (value) =>
    value && props.prepareContent
      ? props.prepareContent(value)
      : value || props.emptyContent,
  onApplied: (value) => props.contentApplied?.(value),
  onPublished: (snapshot) => props.contentPublished?.(snapshot),
  formatError: (failure, fallback) =>
    props.reaction
      ? failure instanceof ReactionCanvasError
        ? failure.message
        : errorMessage(failure, fallback)
      : fallback,
});

onMounted(() => {
  focusGuard.observe();
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

  initialize();
});

onBeforeUnmount(() => {
  focusGuard.dispose();
  editorLifetime.abort();
  resizeObserver?.disconnect();
  window.removeEventListener("resize", syncKetcherLayout);
});

defineExpose({
  ready,
  pending,
  readSmilesFromEditor,
  captureDraft: () =>
    ketcherIframe.value?.contentWindow?.ketcher?.editor
      ? readSmilesFromEditor()
      : null,
  clearEditor,
  setSmilesToEditor,
  exportRxn: () => readSnapshot((editor) => editor.getRxn("v3000")),
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

.inline-ketcher-editor.compact-mode .inline-ketcher-frame {
  height: 380px;
  min-height: 380px;
}
.editor-progress {
  position: absolute;
  top: 0;
  z-index: 1;
}
.editor-error {
  color: var(--ws-danger, #b42318);
  font-size: 12px;
  overflow-wrap: anywhere;
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
