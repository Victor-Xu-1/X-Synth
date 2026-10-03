<template>
  <v-dialog
    v-model="propShow"
    :id="id"
    max-width="900"
    class="structure-editor-dialog"
  >
    <v-card>
      <v-card-text>
        <v-alert v-if="editorError" type="error" variant="tonal" class="mb-3">{{
          editorError
        }}</v-alert>
        <iframe
          ref="ketcherIframe"
          data-cy="ketcher-iframe"
          :src="KETCHER_URL"
          title="结构绘制器"
          class="structure-editor-frame"
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
          >取消</v-btn
        >
        <v-btn
          data-cy="ketcher-Done-button"
          color="primary"
          :loading="busy"
          @click="commitStructure"
          >完成</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
import { ref, watch, computed, onBeforeUnmount } from "vue";
import {
  KETCHER_URL,
  replaceKetcherMolecule,
  waitForKetcher,
} from "@/common/ketcher";

export default {
  name: "KetcherModal",
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
    const editorLifetime = new AbortController();
    onBeforeUnmount(() => editorLifetime.abort());
    // const ketcherSpinner = ref(null);

    const propShow = computed({
      get() {
        return props.value;
      },
      set(newValue) {
        context.emit("input", newValue);
      },
    });

    watch(propShow, (show) => {
      if (show) {
        editorError.value = "";
        smilesToKetcher().catch((error) => {
          editorError.value = "结构绘制器加载失败，请重新打开。";
          console.error("结构绘制器加载失败：", error);
        });
      }
    });

    const smilesToKetcher = async () => {
      const ketcher = await waitForKetcher(() => ketcherIframe.value, {
        signal: editorLifetime.signal,
      });
      await replaceKetcherMolecule(ketcher, props.smiles);
    };

    const smilesFromKetcher = async () => {
      const ketcher = await waitForKetcher(() => ketcherIframe.value, {
        signal: editorLifetime.signal,
      });
      context.emit("update:smiles", String(await ketcher.getSmiles()).trim());
    };

    const commitStructure = async () => {
      busy.value = true;
      editorError.value = "";
      try {
        await smilesFromKetcher();
        propShow.value = false;
      } catch (error) {
        editorError.value = "结构读取失败，请检查画板内容。";
        console.error("结构读取失败：", error);
      } finally {
        busy.value = false;
      }
    };

    return {
      KETCHER_URL,
      busy,
      editorError,
      commitStructure,
      propShow,
      ketcherIframe,
      smilesToKetcher,
      smilesFromKetcher,
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
div.modal .modal-dialog.modal-fit {
  width: fit-content !important;
  max-width: 1000px !important;
}

#ketcher-iframe {
  border-width: 0;
}

#ketcher-spinner {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  overflow: auto;
  margin: auto;
  width: 50px;
  height: 50px;
}
</style>
