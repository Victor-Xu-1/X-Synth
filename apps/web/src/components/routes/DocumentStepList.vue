<template>
  <div class="document-step-list" :aria-label="$tr('路线步骤')">
    <article v-for="step in steps" :key="step.node.id" class="document-step"
      :class="{ active: selectedNode === step.node.id }" :data-step-id="step.node.id">
      <header>
        <button type="button" class="document-step-select" :aria-pressed="selectedNode === step.node.id"
          :aria-label="$tr('查看合成步骤 {value}详情', { value: step.number })"
          @click="$emit('select', step.node.id, $event)">
          <strong>{{ $tr('合成步骤 {value}', { value: step.number }) }}</strong>
        </button>
        <v-tooltip :text="$tr('在路线图中定位')"><template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-crosshairs-gps" variant="text" width="44" height="44"
            :aria-label="$tr('定位步骤 {value}', { value: step.number })"
            @click="$emit('locate', step.node.id, $event)" />
        </template></v-tooltip>
      </header>
      <p v-if="step.node.label" class="document-step-name">{{ step.node.label }}</p>
      <v-lazy :min-height="200" :options="{ rootMargin: '250px' }" transition="fade-transition">
        <div class="document-step-scheme">
          <div class="document-step-inputs">
            <figure v-for="(input, index) in step.inputs" :key="input.edge.id" :data-edge-id="input.edge.id">
              <StructurePreview :label="$tr('反应物 {index}', { index: index + 1 })" :smiles="input.node.smiles" :height="140" />
              <figcaption v-if="input.count > 1">{{ $tr('输入结构记录 ×{count}', { count: input.count }) }}</figcaption>
            </figure>
            <p v-if="!step.inputs.length" class="workspace-muted">{{ $tr('反应物未连接') }}</p>
          </div>
          <v-icon icon="mdi-arrow-right" class="document-step-arrow" :aria-label="$tr('生成')" />
          <StructurePreview v-if="step.product" label="产物" :smiles="step.product.smiles" :height="140" />
          <p v-else class="workspace-muted">{{ $tr('产物未连接') }}</p>
        </div>
      </v-lazy>
      <p v-if="step.node.note" class="document-step-note">{{ step.node.note }}</p>
    </article>
    <p v-if="!steps.length" class="workspace-muted">{{ $tr('未记录反应步骤') }}</p>
  </div>
</template>
<script setup>
import StructurePreview from "@/components/workspace/StructurePreview.vue";
defineProps({ steps: { type: Array, default: () => [] }, selectedNode: String });
defineEmits(["select", "locate"]);
</script>
<style scoped>
.document-step-list { padding: 16px 20px; min-width: 0; }
.document-step { padding: 0 0 20px; margin-bottom: 20px; border-bottom: 1px solid var(--ws-border); min-width: 0; }
.document-step:last-child { margin-bottom: 0; }
.document-step header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.document-step-select { min-height: 44px; padding: 8px 10px; border-radius: 6px; text-align: left; color: var(--ws-text); font-size: 14px; }
.document-step-select:hover, .active .document-step-select { background: var(--ws-accent-soft); color: var(--ws-accent); }
.document-step-select:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.document-step-name, .document-step-note { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.document-step-name { color: var(--ws-muted); margin: 4px 10px 12px; }
.document-step-note { margin-top: 12px; }
.document-step-scheme { display: grid; grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr); align-items: center; gap: 14px; }
.document-step-scheme > * { min-width: 0; }
.document-step-inputs { display: grid; gap: 12px; }
figure { margin: 0; min-width: 0; }
figcaption { margin-top: 4px; font-size: 12px; color: var(--ws-muted); }
@media (max-width: 600px) {
  .document-step-list { padding: 12px; }
  .document-step-scheme { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .document-step-arrow { justify-self: center; transform: rotate(90deg); }
}
</style>
