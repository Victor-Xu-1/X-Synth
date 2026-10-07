<template>
  <div class="reaction-graph-node" :class="{ selected }">
    <Handle type="target" :position="Position.Left" />
    <div v-if="data.reading" class="reaction-disc">
      <v-icon
        class="reaction-direction-icon"
        icon="mdi-arrow-right"
        size="22"
      />
    </div>
    <v-icon
      v-else
      class="reaction-direction-icon"
      icon="mdi-arrow-right"
      size="18"
    />
    <strong :title="data.label || '反应'">{{ data.label || "反应" }}</strong>
    <small v-if="typeof data.score === 'number' && Number.isFinite(data.score)"
      :title="`步骤分数 ${data.score.toFixed(2)}`"
      >步骤分数 {{ data.score.toFixed(2) }}</small
    >
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
<script setup>
import { Handle, Position } from "@vue-flow/core";
defineProps({ data: { type: Object, required: true }, selected: Boolean });
</script>
<style scoped>
.reaction-graph-node {
  line-height: 1.5;
  gap: 4px;
}
.reaction-disc {
  color: var(--ws-text);
}
.selected .reaction-disc {
  color: var(--ws-accent, #0b7163);
}
.reaction-graph-node > strong {
  max-width: calc(var(--route-reaction-width) - 4px);
  font-size: 12px;
  font-weight: 600;
}
.reaction-graph-node > small {
  max-width: 100%;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reaction-direction-icon {
  /* html-to-image discovers fonts on elements, not on ::before. */
  font-family: "Material Design Icons";
}
</style>
