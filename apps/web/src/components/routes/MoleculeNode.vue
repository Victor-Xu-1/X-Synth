<template>
  <div
    class="molecule-graph-node"
    :class="{ selected, target: data.isTarget, starting: data.isStarting && !data.isTarget }"
  >
    <Handle type="target" :position="Position.Left" />
    <div class="graph-node-heading">
      <span>
        <v-icon
          v-if="data.isTarget || data.isStarting"
          :icon="data.isTarget ? 'mdi-target' : 'mdi-flask-outline'"
          size="14"
          aria-hidden="true"
        />
        {{ data.isTarget ? $tr('目标分子') : data.isStarting ? $tr('起始原料') : $tr('中间体') }}
      </span>
      <strong v-if="data.label" :title="data.label">{{ data.label }}</strong>
    </div>
    <SmilesImage
      :smiles="data.smiles"
      :width="data.imageWidth"
      :height="data.imageHeight"
      :eager="!data.overview"
      :show-error-image="false"
    />
    <div class="graph-node-footer">
      <div
        v-if="data.isStarting && data.catalogPrice"
        class="graph-node-catalog-price"
        :title="$tr('{value} · {value2} · {value3} · {count} 条目录价格', { value: $tr(price.note), value2: data.catalogPrice.record.source, value3: data.catalogPrice.record.catalog_id, count: data.catalogPrice.count })"
        data-cy="route-node-catalog-price"
      >
        {{ price.amount === null ? $tr(price.text) : price.text }} <span>{{ $tr('目录基准') }}</span>
      </div>
      <div v-else class="graph-node-smiles" :title="data.smiles">
        {{ data.smiles }}
      </div>
      <v-tooltip v-if="!data.overview" :text="$tr('查看化合物详情')">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            class="graph-node-action nodrag"
            icon="mdi-dots-horizontal"
            size="x-small"
            variant="text"
            :aria-label="$tr('查看化合物详情')"
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
.molecule-graph-node {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.graph-node-heading {
  flex: 0 0 auto;
}
.graph-node-heading > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  white-space: nowrap;
}
.graph-node-heading > strong {
  min-width: 0;
}
.target .graph-node-heading > span {
  color: var(--ws-accent, #0b7163);
  font-weight: 600;
}
.starting .graph-node-heading > span {
  color: var(--ws-info, #356d91);
}
.molecule-graph-node > :deep(.smiles-image-container) {
  flex: 0 0 auto;
}
.graph-node-footer {
  flex: 0 0 auto;
  margin-top: auto;
}
.graph-node-smiles {
  font-size: 10px;
  line-height: 1.4;
}
.graph-node-action {
  width: 24px;
  height: 24px;
  min-width: 24px;
  color: var(--ws-muted);
}
.graph-node-action:focus-visible {
  outline: 2px solid var(--ws-accent, #0b7163);
  outline-offset: 1px;
}
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
  font-size: 10px;
  margin-left: 3px;
}
</style>
