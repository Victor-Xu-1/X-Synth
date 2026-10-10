<template>
  <div class="reference-source-metadata" :aria-busy="pending" data-cy="reference-source-status">
    <p class="reference-source-state" :class="{ 'tool-error': failed }"
      :role="failed ? 'alert' : 'status'">{{ $tr(message) }}</p>
    <template v-if="verified">
      <dl class="reference-source">
        <dt>{{ $tr('来源') }}</dt>
        <dd>{{ evidenceSourceLabel(status) }}</dd>
        <dt>{{ $tr('匹配方式') }}</dt>
        <dd>{{ $tr('产物结构精确匹配') }}</dd>
        <dt>{{ $tr('参考记录') }}</dt>
        <dd>{{ status.record_count ?? $tr('数量未提供') }}</dd>
      </dl>
      <details v-if="status.sources?.length" class="reference-source">
        <summary>{{ $tr('来源与数据覆盖') }}</summary>
        <dl v-for="source in status.sources" :key="source.source">
          <dt>{{ source.source }}</dt>
          <dd>{{ $tr(source.ready ? '已就绪' : referenceReason(source)) }}</dd>
          <dt>{{ $tr('参考记录') }}</dt>
          <dd>{{ source.record_count ?? $tr('数量未提供') }}</dd>
          <template v-if="source.license || source.yields_count != null || source.conditions_count != null">
            <dt>{{ $tr('含收率记录') }}</dt>
            <dd>{{ source.yields_count ?? $tr('数量未提供') }}</dd>
            <dt>{{ $tr('含条件/投料记录') }}</dt>
            <dd>{{ source.conditions_count ?? $tr('数量未提供') }}</dd>
            <dt>{{ $tr('数据许可') }}</dt>
            <dd>{{ source.license || $tr('未记录') }}</dd>
          </template>
        </dl>
      </details>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { evidenceSourceLabel } from "@/common/reference-evidence";
import { referenceReason } from "@/common/reaction-references";

const props = defineProps({
  status: { type: Object, default: null },
  pending: { type: Boolean, default: false },
  error: { type: String, default: "" },
});
// Only the composable's validated snapshot can supply source or count claims.
const failed = computed(() => !props.pending && !!props.error);
const verified = computed(() => !props.pending && !props.error && !!props.status);
const message = computed(() => props.pending
  ? "正在核对参考来源。"
  : props.error || (props.status
    ? props.status.ready ? "参考来源状态已核对。" : referenceReason(props.status)
    : "参考来源尚未核对。"));
</script>

<style scoped>
.reference-source {
  font-size: 12px;
  margin: 14px 0 24px;
}
dl.reference-source,
.reference-source > dl {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr);
  gap: 10px;
}
details.reference-source summary {
  cursor: pointer;
  margin-bottom: 12px;
  font-size: 14px;
}
.reference-source dt,
.reference-source-state {
  color: var(--ws-muted);
}
.reference-source dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.reference-source-state {
  font-size: 12px;
  overflow-wrap: anywhere;
  margin: 12px 0;
}
.reference-source-state.tool-error {
  color: var(--ws-danger);
}
</style>
