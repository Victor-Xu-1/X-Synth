<template>
  <div class="search-setting-fields">
    <label
      ><span class="field-label">{{ $tr('任务名称') }}</span
      ><input
        v-model="name"
        name="task_name"
        class="workspace-input"
        maxlength="160"
        :placeholder="$tr('未命名任务')"
        :disabled="disabled"
    /></label>
    <div class="search-primary-settings">
      <label
        ><span class="field-label">{{ $tr('路线数量上限') }}</span
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
          :title="$tr('每轮各搜索策略的时长上限；追加搜索与路线审查另计。')"
          >{{ $tr('每轮时长（分钟）') }}</span
        ><input
          v-model.number="settings.minutes"
          name="expansion_time_minutes"
          :aria-label="$tr('每轮搜索时长（分钟）')"
          class="workspace-input"
          type="number"
          min="1"
          max="120"
          step="any"
          :disabled="disabled"
      /></label>
    </div>
    <details class="search-advanced">
      <summary>{{ $tr('高级参数') }}</summary>
      <div class="search-advanced-fields">
        <label v-for="item in searchSettings" :key="item.key"
          ><span class="field-label" :title="$tr(item.description)">{{
            $tr(item.label)
          }}</span
          ><input
            v-model.number="settings.tuning[item.key]"
            :name="item.key"
            :title="$tr(item.description)"
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
  gap: 24px;
}
.search-primary-settings {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: end;
}
.search-primary-settings label {
  display: flex;
  flex-direction: column;
}
.search-primary-settings label:last-child .field-label {
  font-size: 14px;
}
.search-advanced {
  border-top: 1px solid var(--ws-border);
  padding-top: 17px;
  font-size: 14px;
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
