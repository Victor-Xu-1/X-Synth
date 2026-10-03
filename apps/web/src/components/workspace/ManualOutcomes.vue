<template>
  <section class="manual-outcomes" aria-label="一步候选结果">
    <header class="manual-result-heading">
      <h2>
        候选断键 <span>{{ result.outcomes.length }}</span>
      </h2>
      <span
        >{{ result.model }} ·
        {{ Math.min(visibleCount, result.outcomes.length) }} /
        {{ result.outcomes.length }}</span
      >
    </header>
    <div class="manual-target">
      <SmilesImage
        :smiles="result.canonical"
        :height="100"
        :width="220"
        :show-error-image="false"
      /><code>{{ result.canonical }}</code>
    </div>
    <div v-if="!result.outcomes.length" class="workspace-empty">
      当前模型没有返回候选
    </div>
    <div class="manual-outcome-list">
      <article
        v-for="(item, index) in result.outcomes.slice(0, visibleCount)"
        :key="`${index}:${item.outcome}`"
        class="manual-outcome"
      >
        <header>
          <strong>候选 {{ index + 1 }}</strong
          ><span v-if="typeof item.plausibility === 'number'"
            >FF {{ item.plausibility.toFixed(3) }}</span
          >
          <div class="page-actions">
            <v-tooltip text="预览候选"
              ><template #activator="{ props }"
                ><v-btn
                  v-bind="props"
                  icon="mdi-eye-outline"
                  variant="text"
                  size="small"
                  aria-label="预览候选"
                  @click="$emit('preview', index)" /></template></v-tooltip
            ><v-btn
              variant="text"
              size="small"
              prepend-icon="mdi-pencil-outline"
              :disabled="busy"
              @click="$emit('edit', index)"
              >编辑副本</v-btn
            >
          </div>
        </header>
        <SmilesImage
          :smiles="item.outcome"
          :height="150"
          :width="480"
          :show-error-image="false"
        /><code>{{ item.outcome }}</code>
      </article>
    </div>
    <v-btn
      v-if="visibleCount < result.outcomes.length"
      variant="text"
      prepend-icon="mdi-chevron-down"
      @click="visibleCount += 12"
      >更多候选</v-btn
    >
  </section>
</template>
<script setup>
import { ref, watch } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
const props = defineProps({
  result: { type: Object, required: true },
  busy: Boolean,
});
defineEmits(["preview", "edit"]);
const visibleCount = ref(12);
watch(
  () => props.result,
  () => (visibleCount.value = 12),
);
</script>
<style scoped>
.manual-outcomes {
  border-top: 1px solid var(--ws-border);
  padding-top: 24px;
  margin-top: 28px;
}
.manual-result-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.manual-result-heading h2 {
  font-size: 16px;
  font-weight: 550;
}
.manual-result-heading span {
  font-size: 11px;
  color: var(--ws-muted);
}
.manual-target {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 0;
}
.manual-outcome-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 28px;
}
.manual-outcome {
  min-width: 0;
  border-top: 1px solid var(--ws-border);
  padding: 14px 0;
}
.manual-outcome header {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  flex-wrap: wrap;
}
.manual-outcome header > span {
  color: var(--ws-muted);
  font-size: 11px;
}
.manual-outcome .page-actions {
  margin-left: auto;
}
code {
  overflow-wrap: anywhere;
  font-size: 11px;
  color: var(--ws-muted);
}
.manual-outcome code {
  display: block;
}
@media (max-width: 700px) {
  .manual-outcome-list {
    grid-template-columns: 1fr;
  }
  .manual-target {
    flex-direction: column;
    align-items: start;
    gap: 8px;
  }
}
</style>
