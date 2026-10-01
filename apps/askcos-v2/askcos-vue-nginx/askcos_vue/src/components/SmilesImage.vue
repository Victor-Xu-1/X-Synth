<template>
  <component :is="allowCopy ? 'copy-tooltip' : 'div'" v-bind="copyProps">
    <v-skeleton-loader v-if="isLoading" class="mx-auto border" elevation="2" type="image"
      max-width="260px"></v-skeleton-loader>
    <div v-if="renderFailed" class="structure-error-state">
      <v-img v-if="showErrorImage" class="mx-auto" height="160" max-width="260" src="@/assets/wrongSmiles.png"></v-img>
      <v-icon v-else icon="mdi-molecule-off" size="44"></v-icon>
      <strong>结构未解析</strong>
      <span>{{ smiles || "空结构输入" }}</span>
    </div>
    <component :is="lazy ? 'v-img-lazy' : 'v-img'" v-bind="imageProps"
      v-else :class="'hide-invalid' + (isDark ? ' invert' : '')" @load="onImageLoad(true)" @error="onImageLoad(false)">
      <template v-slot:error>
        <div class="structure-error-state">
          <v-img v-if="showErrorImage" class="mx-auto" height="160" max-width="260" src="@/assets/wrongSmiles.png"></v-img>
          <v-icon v-else icon="mdi-molecule-off" size="44"></v-icon>
          <strong>结构未解析</strong>
          <span>{{ smiles || "空结构输入" }}</span>
        </div>
      </template>
      <template v-if="isLoading">
        <v-skeleton-loader class="mx-auto border" elevation="2" type="image" max-width="260px"></v-skeleton-loader>
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
    onImageLoad(isValid) {
      this.clearLoadTimer();
      this.isLoading = false;
      this.renderFailed = !isValid;
      this.$emit(isValid ? "load" : "error");
    },
    startLoadTimer() {
      this.clearLoadTimer();
      if (!this.smiles) return;
      this.isLoading = true;
      this.renderFailed = false;
      this.loadTimer = window.setTimeout(() => {
        if (this.isLoading) {
          this.isLoading = false;
        }
      }, 8000);
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
          title: "复制 SMILES",
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
    };
  },
  mounted() {
    this.startLoadTimer();
  },
  beforeUnmount() {
    this.clearLoadTimer();
  },
  watch: {
    url() {
      this.startLoadTimer();
    },
  },
  setup() {
    const { isDark } = useTheme();
    return { isDark };
  },
});
</script>

<style>
.hide-invalid>.v-responsive__sizer {
  padding-bottom: 150px !important;
}

.invert {
  filter: invert(1) brightness(2);
}

.structure-error-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px;
  color: #64748b;
  text-align: center;
}

.structure-error-state strong {
  color: #b42318;
  font-size: 18px;
}

.structure-error-state span {
  max-width: 420px;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}
</style>
