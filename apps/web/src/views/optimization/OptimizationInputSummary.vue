<template>
  <section class="optimization-input-summary" :aria-label="$tr('实验优化输入摘要')">
    <header><h2>{{ $tr('实测输入与候选空间') }}</h2>
      <v-btn v-if="hasCsv" icon="mdi-file-delimited-outline" variant="text" :aria-label="$tr('下载本次原始实测 CSV')"
        :title="$tr('下载本次原始实测 CSV')" @click="download" />
    </header>
    <dl class="optimization-input-facts">
      <div><dt>{{ $tr('已选实测记录') }}</dt><dd>{{ rows?.length ?? $tr('未记录') }}</dd></div>
      <div><dt>{{ $tr('实测响应') }}</dt><dd>{{ text(inputs.target?.name) }} · {{ text(inputs.target?.unit, $tr('单位未记录')) }}</dd></div>
      <div><dt>{{ $tr('优化方向') }}</dt><dd>{{ inputs.target?.direction === 'minimize' ? $tr('最小化') : inputs.target?.direction === 'maximize' ? $tr('最大化') : $tr('未记录') }}</dd></div>
      <div><dt>{{ $tr('随机种子') }}</dt><dd>{{ seed }}</dd></div>
    </dl>
    <details><summary>{{ $tr('本次因子与离散水平') }}</summary>
      <p v-if="!factors.length">{{ $tr('未记录') }}</p>
      <dl v-else class="optimization-factor-facts"><div v-for="(factor, index) in factors" :key="index">
        <dt>{{ text(factor?.name) }}<small>{{ factor?.kind === 'numerical' ? $tr('数值') : factor?.kind === 'categorical' ? $tr('分类') : $tr('类型未记录') }}</small></dt>
        <dd>{{ levels(factor?.values) }}</dd>
      </div></dl>
    </details>
    <details><summary>{{ $tr('实测行与数据标识') }}</summary><p>{{ rows?.join(', ') || $tr('未记录') }}</p><code>{{ text(inputs.table_sha256, $tr('SHA256 未记录')) }}</code></details>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { uiText } from "@/i18n";
import { saveAs } from "file-saver";
const props = defineProps({ inputs: { type: Object, required: true }, recordId: { type: String, required: true } });
const hasCsv = computed(() => typeof props.inputs.content === "string" && !!props.inputs.content.trim());
const factors = computed(() => Array.isArray(props.inputs.factors) ? props.inputs.factors : []);
const rows = computed(() => {
  const value = props.inputs.selected_rows;
  return Array.isArray(value) && value.every((row) => Number.isInteger(row) && row > 0)
    && new Set(value).size === value.length ? value : null;
});
const seed = computed(() => Number.isInteger(props.inputs.seed) && props.inputs.seed >= 0 && props.inputs.seed <= 2 ** 32 - 1
  ? props.inputs.seed : uiText("未记录"));
function text(value, missing = "未记录") { return typeof value === "string" && value.trim() ? value : uiText(missing); }
function levels(value) {
  return Array.isArray(value) && value.length && value.every((level) => typeof level === "string" || Number.isFinite(level))
    ? value.join(" / ") : uiText("未记录");
}
function download() {
  if (hasCsv.value) saveAs(new Blob([props.inputs.content], { type: "text/csv;charset=utf-8" }), `X-Synth-measurements-${props.recordId}.csv`);
}
</script>
<style scoped>
.optimization-input-summary { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--ws-border); font-size: 13px; min-width: 0; }
header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
h2 { font-size: 15px; font-weight: 600; }
.optimization-input-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; margin: 16px 0 24px; }
dt, small { color: var(--ws-muted); font-size: 12px; }
dd { margin: 6px 0 0; overflow-wrap: anywhere; }
details { margin-top: 16px; }
summary { cursor: pointer; }
.optimization-factor-facts { display: grid; gap: 14px; margin-top: 16px; }
.optimization-factor-facts > div { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 18px; }
small { display: block; margin-top: 4px; }
code, p { display: block; margin-top: 12px; overflow-wrap: anywhere; }
@media (max-width: 900px) { .optimization-input-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .optimization-factor-facts > div { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
</style>
