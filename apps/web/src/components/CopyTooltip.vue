<template>
  <div ref="tooltipDiv" :class="{ 'text-primary': highlight }" role="button"
    :tabindex="data ? 0 : -1" :aria-label="$tr(title)" :aria-disabled="copying || !data"
    :aria-busy="copying" @click="copy" @keydown="keydown"
    @mouseenter="handleHover(true)" @mouseleave="handleHover(false)">
    <v-tooltip activator="parent" location="top">{{ $tr(tooltipTitle) }}</v-tooltip>
    <slot></slot>
    <span class="copy-feedback" role="status" aria-live="polite">{{ $tr(feedback) }}</span>
  </div>
</template>

<script>
import { ref, computed, onBeforeUnmount, watch } from "vue";
import { copyToClipboard } from "@/common/utils";

export default {
  name: "CopyTooltip",
  props: {
    data: {
      type: String,
      default: "",
    },
    title: {
      type: String,
      default: "点击复制",
    },
    clickTitle: {
      type: String,
      default: "已复制",
    },
    noHighlight: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const isCopied = ref(false);
    const isHovered = ref(false);
    const tooltipDiv = ref(null);
    const copying = ref(false), error = ref("");
    let generation = 0, timer, disposed = false;

    const tooltipTitle = computed(() => {
      return error.value || (isCopied.value ? props.clickTitle : props.title);
    });
    const feedback = computed(() => error.value || (isCopied.value ? props.clickTitle : ""));

    const highlight = computed(() => {
      return !props.noHighlight && isHovered.value;
    });

    function ownedActivation(event) {
      const control = event?.target?.closest?.("button,a,input,select,textarea,[role=button]");
      return !control || control === tooltipDiv.value;
    }
    const copy = async (event) => {
      if (disposed || copying.value || !props.data || !ownedActivation(event)) return;
      const current = ++generation;
      clearTimeout(timer);
      copying.value = true; isCopied.value = false; error.value = "";
      try {
        const copied = await copyToClipboard(props.data, tooltipDiv.value);
        if (disposed || generation !== current) return;
        if (!copied) { error.value = "复制未完成"; return; }
        isCopied.value = true;
        timer = setTimeout(() => { isCopied.value = false; }, 2000);
      } catch {
        if (!disposed && generation === current) error.value = "复制未完成";
      } finally {
        if (!disposed) copying.value = false;
      }
    };
    function keydown(event) {
      if (event.repeat || !["Enter", " "].includes(event.key) || !ownedActivation(event)) return;
      event.preventDefault();
      copy(event);
    }

    const handleHover = (hovered) => {
      isHovered.value = hovered;
    };

    watch(() => props.data, () => {
      generation++; clearTimeout(timer); isCopied.value = false; error.value = "";
    }, { flush: "sync" });
    onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer); });

    return {
      tooltipDiv,
      tooltipTitle,
      highlight,
      copy,
      handleHover,
      keydown,
      copying,
      feedback,
    };
  },
};
</script>

<style scoped>
.copy-feedback { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
