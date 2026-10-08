<template>
  <div class="process-basis">
    <section>
      <h3>{{ $tr('投料边界') }}</h3>
      <dl class="basis-facts">
        <dt>{{ $tr('录入声明') }}</dt><dd>{{ result.input_boundary_complete ? $tr('已声明投料边界完整') : $tr('未确认投料边界完整') }}</dd>
        <dt>{{ $tr('完整边界总投料 / g') }}</dt><dd>{{ $tr(value(result.metrics.total_input_mass_g)) }}</dd>
      </dl>
    </section>
    <section>
      <h3>{{ $tr('收率依据') }}</h3>
      <dl v-if="basis" class="basis-facts">
        <dt>{{ $tr('限量原料（用户指定）') }}</dt><dd>{{ basis.material?.name || basis.material?.structure?.formula || $tr('未提供化学身份') }}<code v-if="basis.material?.structure">{{ basis.material.structure.smiles }}</code></dd>
        <dt>{{ $tr('限量原料质量纯度 / %') }}</dt><dd>{{ $tr(value(basis.limiting_purity_mass_percent)) }}</dd>
        <dt>{{ $tr('原料 : 产物计量系数') }}</dt><dd>{{ $tr(value(basis.reactant_coefficient)) }} : {{ $tr(value(basis.product_coefficient)) }}</dd>
      </dl>
      <p v-else class="workspace-muted">{{ $tr('未指定限量原料与计量系数，摩尔收率未定义。') }}</p>
    </section>
    <section>
      <h3>{{ $tr('PMI 与质量口径') }}</h3>
      <dl class="basis-facts">
        <dt>PMI</dt><dd>{{ $tr('完整边界总投料 / 分离产物总质量') }}</dd>
        <dt>{{ $tr('PMI 下限') }}</dt><dd>{{ $tr('已录入投料 / 分离产物总质量；投料范围不完整') }}</dd>
        <dt>{{ $tr('纯度校正 PMI') }}</dt><dd>{{ $tr('完整边界总投料 / 纯产物质量') }}</dd>
        <dt>{{ $tr('纯产物质量') }}</dt><dd>{{ $tr('分离产物总质量 × 质量纯度（%）/ 100') }}</dd>
        <dt>{{ $tr('计算摩尔收率') }}</dt><dd>{{ $tr('纯产物质量 / 指定计量依据的理论产物质量 × 100%') }}</dd>
      </dl>
    </section>
    <section v-if="result.notices.length">
      <h3>{{ $tr('核算说明') }}</h3>
      <ul class="process-notices"><li v-for="(notice, index) in result.notices" :key="index">{{ processNotice(notice) }}</li></ul>
    </section>
    <footer class="process-reference">
      <span>RDKit {{ result.rdkit_version }}</span>
      <a v-if="referenceUrl" :href="referenceUrl" target="_blank" rel="noopener noreferrer">{{ $tr('ACS PMI 定义') }}<v-icon icon="mdi-open-in-new" size="13" aria-hidden="true" /></a>
      <span v-else class="workspace-muted">{{ $tr('ACS PMI 来源链接未提供') }}</span>
    </footer>
  </div>
</template>
<script setup>
import { computed } from "vue";
import { processNotice } from "./ui-copy";
import { safeExternalUrl } from "@/common/external-url";
import { processMetricValue as value, processYieldBasis } from "./process-result-model";
const props = defineProps({ result: { type: Object, required: true } });
const basis = computed(() => processYieldBasis(props.result));
const referenceUrl = computed(() => safeExternalUrl(props.result.pmi_reference_url));
</script>
<style scoped>
.process-basis { font-size: 12px; }
section + section { padding-top: 18px; margin-top: 18px; border-top: 1px solid var(--ws-border); }
h3 { font-size: 13px; margin: 0 0 12px; }
p, dl { margin: 0; }
.basis-facts { display: grid; grid-template-columns: minmax(90px, 0.7fr) minmax(0, 1fr); gap: 10px 16px; }
dt { color: var(--ws-muted); overflow-wrap: anywhere; }
dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
code { display: block; margin-top: 4px; font-family: var(--ws-font-code); font-size: 11px; color: var(--ws-muted); overflow-wrap: anywhere; }
.process-notices { margin: 0; padding-left: 20px; color: var(--ws-muted); line-height: 1.8; }
.process-notices li + li { margin-top: 6px; }
.process-reference { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--ws-border); color: var(--ws-muted); font-size: 11px; }
a { display: inline-flex; align-items: center; gap: 5px; text-decoration: underline; }
</style>
