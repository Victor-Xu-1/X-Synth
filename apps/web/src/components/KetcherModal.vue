<template>
  <WorkbenchDialog
    v-model="propShow"
    :id="id"
    max-width="900"
    class="structure-editor-dialog"
  >
    <v-card>
      <v-card-text>
        <v-progress-linear v-if="loading" indeterminate height="2" />
        <v-alert v-if="editorError" type="error" variant="tonal" class="mb-3">{{
          $tr(editorError)
        }}</v-alert>
        <iframe
          :key="frameKey"
          ref="ketcherIframe"
          data-cy="ketcher-iframe"
          :src="KETCHER_URL"
          :title="$tr('结构绘制器')"
          class="structure-editor-frame"
          :inert="loading || busy || undefined"
        ></iframe>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          data-cy="ketcher-Cancel-button"
          color="primary"
          @click="
            () => {
              propShow = false;
            }
          "
          >{{ $tr('取消') }}</v-btn
        >
        <v-btn
          data-cy="ketcher-Done-button"
          color="primary"
          :loading="busy"
          :disabled="loading"
          @click="commitStructure"
          >{{ $tr('完成') }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </WorkbenchDialog>
</template>

<script>
import { ref, watch, computed, nextTick, onBeforeUnmount } from "vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import {
  KETCHER_URL,
  createKetcherWriter,
  waitForKetcher,
} from "@/common/ketcher";
import {
  prepareKetcherDocument,
  fitKetcherCanvas,
} from "@/common/ketcher-layout";

export default {
  name: "KetcherModal",
  components: { WorkbenchDialog },
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    id: {
      type: String,
      default: "ketcher-modal",
    },
    smiles: {
      type: String,
      default: "",
    },
  },
  setup(props, context) {
    const ketcherIframe = ref(null);
    const editorError = ref("");
    const busy = ref(false);
    const loading = ref(false);
    const frameKey = ref(0);
    const editorLifetime = new AbortController();
    let generation = 0;
    onBeforeUnmount(() => {
      generation++;
      editorLifetime.abort();
    });

    const propShow = computed({
      get() {
        return props.value;
      },
      set(newValue) {
        context.emit("input", newValue);
      },
    });

    const getEditor = async () => {
      const editor = await waitForKetcher(() => ketcherIframe.value, {
        signal: editorLifetime.signal,
      });
      prepareKetcherDocument(ketcherIframe.value?.contentDocument);
      return editor;
    };
    const writeMolecule = createKetcherWriter(getEditor, {
      signal: editorLifetime.signal,
    });
    watch(
      () => [propShow.value, props.smiles],
      async ([show, smiles]) => {
        const current = ++generation;
        loading.value = false;
        busy.value = false;
        if (!show) return;
        frameKey.value++;
        editorError.value = "";
        loading.value = true;
        try {
          await nextTick();
          if (current !== generation || editorLifetime.signal.aborted) return;
          await writeMolecule(smiles);
          await nextTick();
          await new Promise((resolve) => window.requestAnimationFrame(resolve));
          if (current === generation && !editorLifetime.signal.aborted)
            fitKetcherCanvas(
              ketcherIframe.value?.contentWindow?.ketcher?.editor,
            );
        } catch {
          if (current === generation && !editorLifetime.signal.aborted)
            editorError.value = "结构绘制器加载失败，请重新打开。";
        } finally {
          if (current === generation) loading.value = false;
        }
      },
      { immediate: true },
    );

    const commitStructure = async () => {
      if (busy.value || loading.value || !propShow.value) return;
      const current = generation;
      busy.value = true;
      editorError.value = "";
      try {
        await writeMolecule.flush();
        const ketcher = await getEditor();
        const value = String(await ketcher.getSmiles()).trim();
        if (
          current !== generation ||
          editorLifetime.signal.aborted ||
          !propShow.value
        )
          return;
        context.emit("update:smiles", value);
        propShow.value = false;
      } catch {
        if (current === generation && !editorLifetime.signal.aborted)
          editorError.value = "结构读取失败，请检查画板内容。";
      } finally {
        if (current === generation) busy.value = false;
      }
    };

    return {
      KETCHER_URL,
      busy,
      loading,
      frameKey,
      editorError,
      commitStructure,
      propShow,
      ketcherIframe,
    };
  },
};
</script>

<style>
.structure-editor-frame {
  width: 100%;
  height: min(65dvh, 520px);
  min-height: 360px;
  border: 0;
}
.structure-editor-dialog .v-card-text {
  padding: 12px;
}
</style>
