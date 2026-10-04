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
      :width="data.imageWidth"
      :height="data.imageHeight"
      :show-error-image="false"
    />
    <div class="graph-node-footer">
      <div
        v-if="data.isStarting && data.catalogPrice"
        class="graph-node-catalog-price"
        :title="`${price.note} · ${data.catalogPrice.record.source} · ${data.catalogPrice.record.catalog_id} · ${data.catalogPrice.count} 条目录价格`"
        data-cy="route-node-catalog-price"
      >
        {{ price.text }} <span>目录基准</span>
      </div>
      <div v-else class="graph-node-smiles" :title="data.smiles">
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
import { computed } from "vue";
import { supplierPriceView } from "@/common/route-price";
const props = defineProps({
  data: { type: Object, required: true },
  selected: Boolean,
});
const price = computed(() =>
  supplierPriceView(props.data.catalogPrice?.record, {
    snapshot: props.data.catalogPrice?.snapshot,
    smiles: props.data.catalogPrice?.record.smiles,
  }),
);
</script>
<style scoped>
.graph-node-catalog-price {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.graph-node-catalog-price span {
  color: var(--ws-muted);
  font-size: 9px;
  margin-left: 3px;
}
</style>
