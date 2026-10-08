<template>
  <section class="environment-monitoring" :aria-label="$tr('运行监测')">
    <dl class="monitor-metrics">
      <div>
        <dt>{{ $tr('库存结构') }}</dt>
        <dd>{{ count(snapshot.stock?.snapshot?.unique_structures) }}</dd>
      </div>
      <div>
        <dt>{{ $tr('供应商记录') }}</dt>
        <dd>{{ count(snapshot.stock?.snapshot?.accepted_records) }}</dd>
      </div>
      <div>
        <dt>{{ $tr('模板记录') }}</dt>
        <dd>{{ count(snapshot.templates?.template_count) }}</dd>
      </div>
      <div>
        <dt>{{ $tr('原生进程内存') }}</dt>
        <dd>
          {{
            memoryText(
              snapshot.runtime?.resources?.status === "unavailable"
                ? null
                : snapshot.runtime?.resources?.rss_bytes,
            )
          }}
        </dd>
      </div>
    </dl>
    <dl class="monitor-metrics" :aria-label="$tr('产品进程组内存')">
      <div><dt>{{ $tr('进程组当前内存') }}</dt><dd>{{ memoryText(snapshot.runtime?.resources?.cgroup?.memory_current_bytes) }}</dd></div>
      <div><dt>{{ $tr('进程组峰值内存') }}</dt><dd>{{ memoryText(snapshot.runtime?.resources?.cgroup?.memory_peak_bytes) }}</dd></div>
      <div><dt>{{ $tr('进程组内存上限') }}</dt><dd>{{ memoryText(snapshot.runtime?.resources?.cgroup?.memory_max_bytes) }}</dd></div>
      <div><dt>{{ $tr('内存耗尽次数') }}</dt><dd>{{ count(snapshot.runtime?.resources?.cgroup?.events?.oom_kill) }}</dd></div>
    </dl>
    <div
      v-if="snapshot.runtime?.memory_warning"
      class="tool-error"
      role="status"
    > {{ $tr('产品进程组内存接近上限或原生进程内存超过运行预警预算。') }} </div>
    <h2>{{ $tr('引擎服务') }}</h2>
    <div class="environment-services">
      <table>
        <thead>
          <tr>
            <th scope="col">{{ $tr('服务') }}</th>
            <th scope="col">{{ $tr('依赖探针') }}</th>
            <th scope="col">{{ $tr('进程') }}</th>
            <th scope="col">{{ $tr('内存') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <th scope="row">{{ $tr(row.title) }}</th>
            <td>{{ row.ready ? $tr('已就绪') : $tr('未就绪') }}</td>
            <td>
              {{
                row.process === "running"
                  ? $tr('运行中')
                  : row.process === "stopped"
                    ? $tr('已停止')
                    : $tr('不可用')
              }}
            </td>
            <td>{{ memoryText(row.rss) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <h2>{{ $tr('资源预算') }}</h2>
    <dl class="monitor-metrics">
      <div v-for="item in budgets" :key="item.key">
        <dt>{{ $tr(item.title) }}</dt>
        <dd>{{ count(snapshot.runtime?.budget?.[item.key]) }}</dd>
      </div>
    </dl>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { memoryText, runtimeRows } from "@/common/runtime-status";
import { uiText, useUiLanguage } from "@/i18n";
const { locale } = useUiLanguage();
const props = defineProps({ snapshot: { type: Object, required: true } });
const rows = computed(() =>
  runtimeRows(props.snapshot.health, props.snapshot.runtime),
);
const count = (value) =>
  Number.isFinite(value) ? value.toLocaleString(locale.value) : uiText("未读取");
const budgets = [
  { key: "active_jobs", title: "活动任务上限" },
  { key: "queued_jobs", title: "排队容量" },
  { key: "search_parallelism", title: "并行搜索" },
  { key: "model_threads", title: "模型计算线程" },
];
</script>
<style scoped>
.monitor-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  margin: 24px 0;
}
dt {
  font-size: 12px;
  color: var(--ws-muted);
}
dd {
  margin-top: 6px;
  font-size: 19px;
  overflow-wrap: anywhere;
}
h2 {
  font-size: 15px;
  margin: 24px 0 12px;
  font-weight: 550;
}
.environment-services {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  text-align: left;
  padding: 12px 8px;
  border-bottom: 1px solid var(--ws-border);
  white-space: nowrap;
}
tbody th {
  font-weight: normal;
}
@media (max-width: 700px) {
  .monitor-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
