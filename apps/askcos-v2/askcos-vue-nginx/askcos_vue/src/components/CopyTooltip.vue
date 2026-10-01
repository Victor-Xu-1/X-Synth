<template>
  <div ref="tooltipDiv" :class="{ 'text-primary': highlight }" @click="copy" role="button">
    <v-tooltip activator="parent" location="top">{{ tooltipTitle }}</v-tooltip>
    <slot></slot>
  </div>
</template>

<script>
import { ref, computed, onMounted } from "vue";
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

    const tooltipTitle = computed(() => {
      return isCopied.value ? props.clickTitle : props.title;
    });

    const highlight = computed(() => {
      return !props.noHighlight && isHovered.value;
    });

    const copy = () => {
      copyToClipboard(props.data, tooltipDiv.value);
      isCopied.value = true;
      setTimeout(() => {
        isCopied.value = false;
      }, 2000);
    };

    const handleHover = (hovered) => {
      isHovered.value = hovered;
    };

    onMounted(() => {
      tooltipDiv.value.addEventListener("mouseenter", () => {
        isHovered.value = true;
      });
      tooltipDiv.value.addEventListener("mouseleave", () => {
        isHovered.value = false;
      });
    });

    return {
      tooltipDiv,
      tooltipTitle,
      highlight,
      copy,
      handleHover,
    };
  },
};
</script>
