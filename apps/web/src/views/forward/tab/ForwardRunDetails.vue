<template>
  <details class="forward-provenance">
    <summary>{{ $tr('运行详情') }}</summary>
    <dl>
      <dt>{{ $tr('模型') }}</dt><dd>{{ prediction.model }}</dd>
      <dt>{{ $tr('模型资产') }}</dt><dd class="workspace-code">{{ prediction.asset_identity }}</dd>
      <dt>{{ $tr('反应物') }}</dt><dd class="workspace-code">{{ prediction.reactants }}</dd>
      <template v-if="provenance">
        <dt>{{ $tr('排名基准') }}</dt><dd class="workspace-code">{{ provenance.rank_basis }}</dd>
        <dt>{{ $tr('排序策略') }}</dt><dd class="workspace-code">{{ provenance.ranking_policy }}</dd>
        <dt>{{ $tr('FF 模型') }}</dt><dd>{{ provenance.fast_filter_model }}</dd>
        <dt>{{ $tr('FF 资产') }}</dt><dd class="workspace-code">{{ provenance.fast_filter_asset_identity ?? $tr('未记录') }}</dd>
        <dt>{{ $tr('解码参数') }}</dt>
        <dd><dl class="decoder-parameters"><template v-for="(value, key) in provenance.decoder.parameters" :key="key">
          <dt class="workspace-code">{{ key }}</dt><dd>{{ value }}</dd>
        </template></dl></dd>
      </template>
    </dl>
    <template v-if="provenance">
      <h3>{{ $tr('完整解码记录（{count} 条）', { count: ledger.length }) }}</h3>
      <div class="ledger-scroll" tabindex="0" role="region" :aria-label="$tr('完整解码记录')">
        <table class="data-table forward-ledger-table">
          <thead><tr>
            <th scope="col">{{ $tr('模型排名') }}</th><th scope="col">{{ $tr('原生候选排名') }}</th>
            <th scope="col">{{ $tr('联合排名') }}</th><th scope="col">{{ $tr('解码产物') }}</th>
            <th scope="col">{{ $tr('预测产物') }}</th><th scope="col">{{ $tr('解码状态') }}</th>
            <th scope="col">{{ $tr('EOS 终止') }}</th><th scope="col">{{ $tr('解码 token 数（含 EOS）') }}</th>
            <th scope="col">{{ $tr('筛选状态') }}</th><th scope="col">{{ $tr('重复来源') }}</th>
          </tr></thead>
          <tbody><tr v-for="row in ledger" :key="row.decoder_rank">
            <th scope="row">{{ row.decoder_rank }}</th><td>{{ row.native_rank ?? $tr('未提供') }}</td>
            <td>{{ row.joint_rank ?? $tr('未提供') }}</td><td class="ledger-structure">{{ row.decoded_product }}</td>
            <td class="ledger-structure">{{ row.product ?? $tr('未提供') }}</td>
            <td>{{ $tr(dispositions[row.decoder_disposition]) }}</td>
            <td>{{ $tr(row.terminated_by_eos ? '已终止' : '未终止') }}</td>
            <td>{{ row.decoded_token_count }}</td>
            <td>{{ row.filter_disposition ? $tr(dispositions[row.filter_disposition]) : $tr('未提供') }}</td>
            <td>{{ row.duplicate_of ?? $tr('未提供') }}</td>
          </tr></tbody>
        </table>
      </div>
    </template>
  </details>
</template>
<script setup>
import { computed } from "vue";
import { forwardLedger } from "@/common/forward-results";
const props = defineProps({ prediction: { type: Object, required: true }, provenance: { type: Object, default: null } });
const ledger = computed(() => props.provenance ? forwardLedger(props.provenance) : []);
const dispositions = {
  returned: "返回候选", duplicate: "重复候选", invalid_decoding: "解码无效",
  unsupported_structure: "结构不支持", incomplete_decoding: "解码未完成",
  ranked: "已排序", no_op: "无结构变化", unsupplied_atoms: "原子来源不足",
};
</script>
<style scoped>
.forward-provenance { margin-top: 20px; font-size: 12px; color: var(--ws-muted); }
.forward-provenance summary { cursor: pointer; padding: 8px 0; }
.forward-provenance > dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px; padding-top: 12px; }
.forward-provenance dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.decoder-parameters { display: grid; grid-template-columns: minmax(0, 180px) minmax(0, 1fr); gap: 4px 12px; }
.decoder-parameters dt { overflow-wrap: anywhere; }
.forward-provenance h3 { margin: 16px 0 8px; font-size: 13px; }
.ledger-scroll { overflow-x: auto; }
.ledger-scroll:focus-visible { outline: 2px solid var(--ws-text); outline-offset: 2px; }
.forward-ledger-table { min-width: 1040px; width: 100%; }
.forward-ledger-table th, .forward-ledger-table td { vertical-align: top; }
.ledger-structure { min-width: 140px; max-width: 280px; overflow-wrap: anywhere; }
@media (max-width: 480px) { .forward-provenance > dl { grid-template-columns: 90px minmax(0, 1fr); } }
</style>
