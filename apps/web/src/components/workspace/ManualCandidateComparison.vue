<template>
  <section class="manual-comparison" :aria-label="$tr('候选比较')">
    <header class="manual-comparison-heading">
      <h2>{{ $tr('候选比较') }}</h2>
      <span>{{ $tr('单步前体候选 · 未核验采购闭合') }}</span>
    </header>
    <dl class="manual-comparison-context">
      <div>
        <dt>{{ $tr('模型来源') }}</dt><dd>{{ result.model }}</dd>
      </div>
      <div>
        <dt>{{ $tr('模板数上限') }}</dt><dd>{{ context.count }}</dd>
      </div>
      <div>
        <dt>{{ $tr('FF 下限') }}</dt><dd>{{ context.threshold }}</dd>
      </div>
    </dl>
    <ManualOutcomes
      :result="result"
      :busy="busy"
      :inert="busy || undefined"
      :aria-busy="busy"
      @preview="$emit('preview', $event)"
      @edit="$emit('edit', $event)"
    />
  </section>
</template>
<script setup>
import ManualOutcomes from "./ManualOutcomes.vue";
defineProps({
  result: { type: Object, required: true },
  context: { type: Object, required: true },
  busy: Boolean,
});
defineEmits(["preview", "edit"]);
</script>
<style scoped>
.manual-comparison {
  min-width: 0;
}
.manual-comparison-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.manual-comparison-heading h2 {
  font-size: 18px;
  font-weight: 600;
}
.manual-comparison-heading span,
.manual-comparison-context dt {
  color: var(--ws-muted);
  font-size: 12px;
}
.manual-comparison-context {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 28px;
  margin: 18px 0;
  font-size: 12px;
}
.manual-comparison-context div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  min-width: 0;
}
.manual-comparison-context dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.manual-comparison :deep(.manual-outcomes) {
  margin-top: 0;
}
</style>
