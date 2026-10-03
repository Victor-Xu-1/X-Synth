<template>
  <div class="reaction-graph-node" :class="{ selected }">
    <Handle type="target" :position="Position.Left" />
    <v-icon icon="mdi-arrow-right" size="18" />
    <strong>{{ data.label || "反应" }}</strong>
    <small v-if="typeof data.score === 'number'"
      >分数 {{ data.score.toFixed(2) }}</small
    >
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
<script setup>
import { Handle, Position } from "@vue-flow/core";
defineProps({ data: { type: Object, required: true }, selected: Boolean });
</script>
