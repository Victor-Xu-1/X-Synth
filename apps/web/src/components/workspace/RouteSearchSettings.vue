<template>
  <div class="search-setting-fields">
    <label
      ><span class="field-label">任务名称</span
      ><input
        v-model="name"
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
          class="workspace-input"
          type="number"
          min="3"
          max="10"
          :disabled="disabled"
      /></label>
      <label
        ><span class="field-label">搜索预算（分钟）</span
        ><input
          v-model.number="settings.minutes"
          class="workspace-input"
          type="number"
          min="1"
          max="120"
          step="1"
          :disabled="disabled"
      /></label>
    </div>
    <details class="search-advanced">
      <summary>高级参数</summary>
      <div class="search-advanced-fields">
        <label v-for="item in searchSettings" :key="item.key"
          ><span class="field-label">{{ item.label }}</span
          ><input
            v-model.number="settings.tuning[item.key]"
            class="workspace-input"
            type="number"
            :min="item.min"
            :max="item.max"
            :step="item.step || 1"
            :disabled="disabled"
        /></label>
      </div>
    </details>
    <dl class="search-engine-facts">
      <div>
        <dt>搜索策略</dt>
        <dd>多策略搜索</dd>
      </div>
      <div>
        <dt>终点判定</dt>
        <dd>商业库存快照</dd>
      </div>
    </dl>
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
  grid-template-columns: 1fr 1fr;
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
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding-top: 16px;
}
.search-engine-facts {
  display: grid;
  gap: 12px;
  font-size: 11px;
}
.search-engine-facts div {
  display: flex;
  gap: 12px;
  justify-content: space-between;
}
.search-engine-facts dt {
  color: var(--ws-muted);
  flex-shrink: 0;
}
.search-engine-facts dd {
  text-align: right;
  overflow-wrap: anywhere;
}
</style>
