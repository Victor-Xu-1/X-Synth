<template>
  <section class="task-search-summary" :class="{ compact }" :aria-label="$tr('目标与搜索进度')">
    <figure v-if="!compact && job.target_smiles" class="search-target">
      <SmilesImage :smiles="job.target_smiles" width="100%" height="100%" :show-error-image="false" />
      <figcaption>{{ $tr('目标化合物') }}</figcaption>
    </figure>
    <div class="search-status">
      <header>
        <h2>{{ taskStateLabel(job.status) }}</h2>
        <span v-if="job.progress?.pass_number">{{ $tr('第 {value} 轮搜索', { value: job.progress.pass_number }) }}</span>
      </header>
      <v-progress-linear v-if="computing" indeterminate height="2" />
      <p v-if="job.status === 'waiting_for_engine'" class="search-wait">{{ $tr('搜索断点已保留') }}</p>
      <p v-else-if="job.status === 'failed_unclosed'" class="search-wait">{{ $tr('未获得符合原料闭合与反应核验要求的完整路线') }}</p>
      <details v-if="rows.length" class="search-counters">
        <summary>{{ $tr('搜索进度') }}</summary>
        <dl>
          <div v-for="row in rows" :key="row.key">
            <dt>{{ ['mcts', 'retro_star'].includes(row.key) ? $tr(row.label) : row.label }}</dt>
            <dd>{{ $tr('{value} 次扩展', { value: row.iterations ?? '—' }) }}</dd>
            <dd>{{ $tr('{value} 个化合物', { value: row.chemicals ?? '—' }) }}</dd>
            <dd>{{ progressElapsedText(job.progress.native_progress[row.key].elapsed_seconds) }}</dd>
          </div>
        </dl>
      </details>
    </div>
  </section>
</template>
<script setup>
import { computed } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { taskStateLabel } from "@/common/task-state";
import { searchProgressRows } from "@/common/task-progress";
import { progressElapsedText } from "./workspace-ui-text";
const props = defineProps({ job: { type: Object, required: true }, compact: Boolean });
const rows = computed(() => searchProgressRows(props.job.progress));
const computing = computed(() => ["preparing", "searching", "evaluating"].includes(props.job.status));
</script>
<style scoped>
.task-search-summary {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  align-items: center;
  gap: 28px;
  padding: 24px 20px;
  border-bottom: 1px solid var(--ws-border);
}
.task-search-summary.compact { grid-template-columns: minmax(0, 1fr); }
.search-target {
  width: 200px;
  height: 228px;
  margin: 0;
  display: grid;
  grid-template-rows: 200px min-content;
  gap: 8px;
}
figcaption { text-align: center; color: var(--ws-muted); font-size: 12px; }
.search-status { min-width: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
h2 { font-size: 16px; font-weight: 550; }
header span, .search-wait { font-size: 13px; color: var(--ws-muted); }
.search-wait { margin: 12px 0; }
summary { cursor: pointer; font-size: 13px; padding: 12px 0; }
dl { margin: 0; }
dl > div { display: flex; flex-wrap: wrap; gap: 8px 20px; padding: 8px 0; font-size: 12px; }
dt { font-weight: 550; }
dd { margin: 0; color: var(--ws-muted); }
@media (max-width: 600px) {
  .task-search-summary { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .search-target { justify-self: center; }
}
</style>
