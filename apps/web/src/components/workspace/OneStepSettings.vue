<template>
  <div class="one-step-settings">
    <label>
      <span class="field-label">断键模型</span>
      <select
        v-model="settings.model"
        name="model"
        class="workspace-input"
        :title="modelName"
        :disabled="disabled"
      >
        <option v-for="model in models" :key="model.value" :value="model.value">
          {{ model.title }}
        </option>
      </select>
    </label>
    <details class="one-step-advanced">
      <summary>高级参数</summary>
      <div class="one-step-advanced-fields">
        <label>
          <span class="field-label" :title="templateField.description">{{
            templateField.label
          }}</span>
          <input
            v-model.number="settings.count"
            name="template_count"
            class="workspace-input"
            :title="templateField.description"
            type="number"
            min="10"
            max="5000"
            :disabled="disabled"
          />
        </label>
        <label>
          <span class="field-label" :title="filterField.description">{{
            filterField.label
          }}</span>
          <input
            v-model.number="settings.threshold"
            name="minimum_plausibility"
            class="workspace-input"
            :title="filterField.description"
            type="number"
            min="0"
            max="1"
            step="0.01"
            :disabled="disabled"
          />
        </label>
      </div>
      <dl class="one-step-engine">
        <div>
          <dt>当前模型</dt>
          <dd>{{ modelName }}</dd>
        </div>
        <div>
          <dt>排序依据</dt>
          <dd>结构复杂度（SCScore）</dd>
        </div>
      </dl>
    </details>
  </div>
</template>
<script setup>
import { computed } from "vue";
import { searchSettings } from "@/common/workbench-model";
const settings = defineModel({ type: Object, required: true });
defineProps({ disabled: Boolean });
const models = [
  { title: "通用断键", value: "pistachio", name: "Pistachio" },
  {
    title: "环系拆分",
    value: "pistachio_ringbreaker",
    name: "Pistachio Ringbreaker",
  },
];
const modelName = computed(
  () =>
    models.find((model) => model.value === settings.value.model)?.name ||
    settings.value.model,
);
const templateField = {
  ...searchSettings.find((field) => field.key === "template_count"),
  description:
    "单步预测参与匹配的反应模板数上限（max_num_templates），不等于返回前体组合数。",
};
const filterField = {
  ...searchSettings.find((field) => field.key === "minimum_plausibility"),
  description:
    "Fast Filter 模型的反应评分阈值（fast_filter_threshold），不是实测收率或实验成功率。",
};
</script>
<style scoped>
.one-step-settings {
  display: grid;
  gap: 22px;
}
.one-step-settings label {
  min-width: 0;
}
.one-step-advanced {
  border-top: 1px solid var(--ws-border);
  padding-top: 17px;
  font-size: 12px;
}
.one-step-advanced summary {
  cursor: pointer;
  color: var(--ws-muted);
}
.one-step-advanced-fields {
  display: grid;
  gap: 16px;
  padding-top: 16px;
}
.one-step-engine {
  display: grid;
  gap: 12px;
  margin: 16px 0 0;
  font-size: 11px;
}
.one-step-engine div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
}
.one-step-engine dt {
  color: var(--ws-muted);
}
.one-step-engine dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
</style>
