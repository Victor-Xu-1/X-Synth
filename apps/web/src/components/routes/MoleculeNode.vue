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
      :width="ROUTE_NODE_SIZE.molecule.width - 24"
      :height="144"
      :show-error-image="false"
    />
    <div class="graph-node-footer">
      <div class="graph-node-smiles" :title="data.smiles">
        {{ data.smiles }}
      </div>
      <v-tooltip v-if="!data.overview" text="查看化合物详情">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            class="graph-node-action nodrag"
            icon="mdi-dots-horizontal"
            size="x-small"
            variant="text"
            aria-label="查看化合物详情"
          />
        </template>
      </v-tooltip>
    </div>
    <Handle v-if="!data.isTarget" type="source" :position="Position.Right" />
  </div>
</template>
<script setup>
import { Handle, Position } from "@vue-flow/core";
import SmilesImage from "@/components/SmilesImage.vue";
import { ROUTE_NODE_SIZE } from "@/common/route-graph";
defineProps({ data: { type: Object, required: true }, selected: Boolean });
</script>
