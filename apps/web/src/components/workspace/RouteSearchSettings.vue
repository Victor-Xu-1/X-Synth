<template>
  <div class="search-setting-fields">
    <label
      ><span class="field-label">任务名称</span
      ><input
        v-model="name"
        name="task_name"
        class="workspace-input"
        maxlength="160"
        placeholder="未命名任务"
        :disabled="disabled"
    /></label>
    <div class="search-primary-settings">
      <label
        ><span class="field-label">路线数量上限</span
        ><input
          v-model.number="settings.maxRoutes"
          name="max_routes"
          class="workspace-input"
          type="number"
          min="3"
          max="10"
          :disabled="disabled"
      /></label>
      <label
        ><span
          class="field-label"
          title="每轮各搜索策略的时长上限；追加搜索与路线审查另计。"
          >每轮搜索时长（分钟）</span
        ><input
          v-model.number="settings.minutes"
          name="expansion_time_minutes"
          class="workspace-input"
          type="number"
          min="1"
          max="120"
          step="any"
          :disabled="disabled"
      /></label>
    </div>
    <details class="search-advanced">
      <summary>高级参数</summary>
      <div class="search-advanced-fields">
        <label v-for="item in searchSettings" :key="item.key"
          ><span class="field-label" :title="item.description">{{
            item.label
          }}</span
          ><input
            v-model.number="settings.tuning[item.key]"
            :name="item.key"
            :title="item.description"
            class="workspace-input"
            type="number"
            :min="item.min"
            :max="item.max"
            :step="item.step || 1"
            :disabled="disabled"
        /></label>
      </div>
    </details>
  </div>
</template>
<script setup>
import { searchSettings } from "@/common/workbench-model";
const name = defineModel("name", { type: String, default: "" });
const settings = defineModel("settings", { type: Object, required: true });
defineProps({ disabled: Boolean });
</script>
<style scoped>
.search-setting-fields {
  display: grid;
  gap: 20px;
}
.search-primary-settings {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.search-advanced {
  border-top: 1px solid var(--ws-border);
  padding-top: 17px;
  font-size: 12px;
}
.search-advanced summary {
  cursor: pointer;
  color: var(--ws-muted);
}
.search-advanced-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  padding-top: 16px;
}
.search-setting-fields label {
  min-width: 0;
}
.search-setting-fields .field-label {
  overflow-wrap: anywhere;
}
</style>
