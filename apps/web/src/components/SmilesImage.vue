<template>
  <component
    :is="allowCopy ? 'copy-tooltip' : 'div'"
    v-bind="copyProps"
    class="smiles-image-container"
  >
    <v-skeleton-loader
      v-if="isLoading"
      class="structure-loading"
      type="image"
      aria-hidden="true"
    ></v-skeleton-loader>
    <div v-if="renderFailed" class="structure-error-state">
      <v-img
        v-if="showErrorImage"
        class="mx-auto"
        height="160"
        max-width="260"
        src="@/assets/wrongSmiles.png"
      ></v-img>
      <v-icon v-else icon="mdi-molecule-off" size="44"></v-icon>
      <strong>{{ $tr('结构加载失败') }}</strong>
      <span>{{ smiles || $tr("空结构输入") }}</span>
      <v-btn
        icon="mdi-refresh"
        size="x-small"
        variant="text"
        :aria-label="$tr('重试结构加载')"
        :title="$tr('重试结构加载')"
        @click="retryImage"
      ></v-btn>
    </div>
    <component
      :is="lazy ? 'v-img-lazy' : 'v-img'"
      :key="`${url}:${renderAttempt}`"
      v-bind="imageProps"
      v-else
      :class="'hide-invalid' + (isDark ? ' invert' : '')"
      @loadstart="startLoadTimer"
      @load="onImageLoad(true)"
      @error="onImageLoad(false)"
    >
      <template v-slot:error>
        <div class="structure-error-state">
          <v-img
            v-if="showErrorImage"
            class="mx-auto"
            height="160"
            max-width="260"
            src="@/assets/wrongSmiles.png"
          ></v-img>
          <v-icon v-else icon="mdi-molecule-off" size="44"></v-icon>
          <strong>{{ $tr('结构加载失败') }}</strong>
          <span>{{ smiles || $tr("空结构输入") }}</span>
        </div>
      </template>
    </component>
  </component>
</template>

<script>
import CopyTooltip from "@/components/CopyTooltip";
import VImgLazy from "@/components/LazyImage.vue";
import { getImageUrl } from "@/common/drawing";
import { defineComponent } from "vue";
import { VImg } from "vuetify/components/VImg";
import { useTheme } from "@/composables/useTheme";

export default defineComponent({
  name: "SmilesImage",
  components: {
    CopyTooltip,
    VImgLazy,
    VImg,
  },
  props: {
    id: {
      type: String,
      default: "",
    },
    smiles: {
      type: String,
      default: "",
    },
    highlight: {
      type: Boolean,
      default: false,
    },
    drawMap: {
      type: Boolean,
      default: false,
    },
    reactingAtoms: {
      type: Array,
      default: () => [],
    },
    reference: {
      type: String,
      default: "",
    },
    align: {
      type: Boolean,
      default: false,
    },
    svg: {
      type: Boolean,
      default: true,
    },
    transparent: {
      type: Boolean,
      default: true,
    },
    allowCopy: {
      type: Boolean,
      default: false,
    },
    inputType: {
      type: String,
      default: "",
    },
    lazy: {
      type: Boolean,
      default: false,
    },
    showErrorImage: {
      type: Boolean,
      default: true,
    },
  },
  emits: ["load", "error"],
  methods: {
    retryImage() {
      this.renderAttempt += 1;
      this.resetLoadState();
    },
    onImageLoad(isValid) {
      this.clearLoadTimer();
      this.isLoading = false;
      this.renderFailed = !isValid;
      this.loadedImageKey = isValid ? `${this.url}:${this.renderAttempt}` : null;
      this.$emit(isValid ? "load" : "error");
    },
    startLoadTimer() {
      // A cached image can settle before a queued loadstart event is delivered.
      if (this.loadedImageKey === `${this.url}:${this.renderAttempt}`) return;
      this.resetLoadState();
      if (!this.smiles) return;
      this.loadTimer = window.setTimeout(() => {
        if (this.isLoading) {
          this.isLoading = false;
          this.renderFailed = true;
        }
      }, 8000);
    },
    resetLoadState() {
      this.clearLoadTimer();
      this.loadedImageKey = null;
      this.isLoading = !!this.smiles;
      this.renderFailed = false;
    },
    clearLoadTimer() {
      if (this.loadTimer) {
        window.clearTimeout(this.loadTimer);
        this.loadTimer = null;
      }
    },
  },
  computed: {
    copyProps() {
      if (this.allowCopy) {
        return {
          data: this.smiles,
          title: this.$tr("复制 SMILES"),
          noHighlight: true,
        };
      } else {
        return {};
      }
    },
    imageProps() {
      const props = {
        src: this.url,
        alt: this.smiles,
      };
      if (this.id) {
        props.id = this.id;
      }
      // Include any other bound attributes
      Object.assign(props, this.$attrs);
      return props;
    },
    url() {
      return getImageUrl({
        smiles: this.smiles,
        inputType: this.inputType,
        svg: this.svg,
        transparent: this.transparent,
        highlight: this.highlight,
        drawMap: this.drawMap,
        reactingAtoms: this.reactingAtoms,
        reference: this.reference,
        align: this.align,
      });
    },
  },
  data() {
    return {
      isLoading: true,
      renderFailed: false,
      loadTimer: null,
      renderAttempt: 0,
      loadedImageKey: null,
    };
  },
  beforeUnmount() {
    this.clearLoadTimer();
  },
  watch: {
    url() {
      this.resetLoadState();
    },
  },
  setup() {
    const { isDark } = useTheme();
    return { isDark };
  },
});
</script>

<style>
.smiles-image-container {
  position: relative;
  width: 100%;
  height: auto;
  min-height: 0;
}

.structure-loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
}
.invert {
  filter: invert(1) brightness(2);
}

.structure-error-state {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  color: #64748b;
  text-align: center;
}

.structure-error-state strong {
  color: #b42318;
  font-size: 16px;
}

.structure-error-state span {
  max-width: 420px;
  word-break: break-all;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}
</style>
