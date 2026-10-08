<template>
  <section class="recorded-conditions" aria-label="文献记录的反应条件">
    <dl class="recorded-condition-parameters">
      <div v-for="field in parameters" :key="field.key">
        <dt>{{ field.label }}</dt>
        <dd v-if="conditions?.[field.key]?.length">
          <span
            v-for="(item, index) in conditions[field.key]"
            :key="index"
            :title="item.details || item.source_field"
          >
            {{ field.key === "time" ? `${recordedTimeLabel(item)} ` : ""
            }}{{ recordedParameter(item) }}
          </span>
        </dd>
        <dd v-else>未记录</dd>
      </div>
    </dl>
    <details v-if="parameters.some((field) => conditions?.[field.key]?.length)" class="recorded-parameter-source">
      <summary>条件与加料原始字段</summary>
      <dl>
        <template v-for="field in parameters" :key="field.key">
          <div v-for="(item, index) in conditions?.[field.key] || []" :key="`${field.key}-${index}`">
            <dt>{{ field.key === 'time' ? recordedTimeLabel(item) : field.label }} · {{ recordedParameter(item) }}</dt>
            <dd><code>{{ item.source_field }}</code><code v-if="item.details">{{ item.details }}</code></dd>
          </div>
        </template>
      </dl>
    </details>
    <div v-if="conditions?.inputs?.length" class="recorded-inputs">
      <div
        v-for="(input, index) in conditions.inputs"
        :key="index"
        class="recorded-input"
      >
        <span class="recorded-input-role">{{
          roles[input.role] || input.role
        }}</span>
        <div>
          <strong v-if="input.name">{{ input.name }}</strong>
          <v-lazy v-if="input.smiles" :min-height="124">
            <StructurePreview
              :smiles="input.smiles"
              :label="`${roles[input.role] || input.role}结构`"
              :width="150"
              :height="90"
            />
          </v-lazy>
          <details v-if="input.smiles">
            <summary>SMILES</summary>
            <code>{{ input.smiles }}</code>
          </details>
        </div>
        <span class="recorded-input-amount">{{
          input.amounts.map(recordedParameter).join(" / ") || "用量未记录"
        }}</span>
        <details class="recorded-input-source">
          <summary>投料原始字段</summary>
          <code>{{ input.source_field }}</code>
          <div v-for="(amount, amountIndex) in input.amounts" :key="amountIndex">
            <span>{{ recordedParameter(amount) }}</span>
            <code>{{ amount.source_field }}</code>
            <code v-if="amount.details">{{ amount.details }}</code>
          </div>
        </details>
      </div>
    </div>
    <p v-else class="recorded-inputs-empty">试剂、催化剂与溶剂：未记录</p>
  </section>
</template>
<script setup>
import {
  recordedParameter,
  recordedTimeLabel,
} from "@/common/reference-evidence";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import { recordedParameters } from "./reference-record";
defineProps({ conditions: { type: Object, default: null } });
const parameters = recordedParameters;
const roles = {
  REACTANT: "反应物",
  REAGENT: "试剂",
  SOLVENT: "溶剂",
  CATALYST: "催化剂",
  INTERNAL_STANDARD: "内标",
  AUTHENTIC_STANDARD: "对照品",
  WORKUP: "后处理",
};
</script>
<style scoped>
.recorded-conditions {
  min-width: 0;
  padding: 12px 0;
  border-top: 1px solid var(--ws-border);
}
.recorded-condition-parameters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  font-size: 12px;
}
dt,
.recorded-input-role,
.recorded-inputs-empty {
  color: var(--ws-muted);
  font-weight: 400;
}
dd {
  margin: 4px 0 0;
  display: flex;
  gap: 6px 12px;
  flex-wrap: wrap;
}
.recorded-inputs {
  margin-top: 12px;
}
.recorded-input {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) minmax(80px, 170px);
  gap: 8px;
  padding: 7px 0;
  align-items: start;
  font-size: 12px;
}
.recorded-input strong {
  font-weight: 500;
}
.recorded-input :deep(.smiles-image-container) {
  max-width: 100%;
}
.recorded-input summary {
  color: var(--ws-muted);
  cursor: pointer;
  font-size: 10px;
}
.recorded-input-source {
  grid-column: 2 / -1;
}
.recorded-input-source > div {
  padding: 6px 0;
}
.recorded-parameter-source {
  font-size: 11px;
  overflow-wrap: anywhere;
  margin-top: 8px;
}
.recorded-parameter-source summary {
  color: var(--ws-muted);
  cursor: pointer;
  padding: 6px 0;
}
.recorded-parameter-source dl {
  display: grid;
  gap: 8px;
  margin: 8px 0;
}
.recorded-parameter-source code {
  display: block;
  white-space: pre-wrap;
}
.recorded-input code {
  display: block;
  margin-top: 3px;
  color: var(--ws-muted);
  font-size: 11px;
}
.recorded-input > *,
dd {
  min-width: 0;
  overflow-wrap: anywhere;
}
.recorded-input-amount {
  text-align: right;
}
.recorded-inputs-empty {
  margin: 12px 0 0;
  font-size: 12px;
}
@media (max-width: 600px) {
  .recorded-input {
    grid-template-columns: 56px minmax(0, 1fr);
  }
  .recorded-input-amount {
    grid-column: 2;
    text-align: left;
  }
}
</style>
