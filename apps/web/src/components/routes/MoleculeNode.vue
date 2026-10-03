<template>
  <div class="molecule-graph-node" :class="{ selected, target: data.isTarget }">
    <Handle type="target" :position="Position.Left" />
    <div class="graph-node-heading">
      <span>{{
        data.isTarget ? "目标分子" : data.isStarting ? "起始原料" : "中间体"
      }}</span
      ><strong v-if="data.label">{{ data.label }}</strong>
    </div>
    <SmilesImage
      :smiles="data.smiles"
      :width="168"
      :height="95"
      :show-error-image="false"
    />
    <div class="graph-node-smiles" :title="data.smiles">{{ data.smiles }}</div>
    <Handle v-if="!data.isTarget" type="source" :position="Position.Right" />
  </div>
</template>
<script setup>
import { Handle, Position } from "@vue-flow/core";
import SmilesImage from "@/components/SmilesImage.vue";
defineProps({ data: { type: Object, required: true }, selected: Boolean });
</script>
