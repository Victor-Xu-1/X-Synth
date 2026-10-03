<template>
  <div class="one-step-settings">
    <v-select
      v-model="settings.model"
      label="模板模型"
      :items="models"
      variant="outlined"
      density="compact"
      hide-details
      :disabled="disabled"
    />
    <v-text-field
      v-model.number="settings.count"
      label="候选模板数量"
      type="number"
      min="10"
      max="5000"
      variant="outlined"
      density="compact"
      hide-details
      :disabled="disabled"
    />
    <v-text-field
      v-model.number="settings.threshold"
      label="FF 筛选阈值"
      type="number"
      min="0"
      max="1"
      step="0.01"
      variant="outlined"
      density="compact"
      hide-details
      :disabled="disabled"
    />
    <div class="one-step-engine">结构复杂度排序</div>
  </div>
</template>
<script setup>
const settings = defineModel({ type: Object, required: true });
defineProps({ disabled: Boolean });
const models = [
  { title: "Pistachio", value: "pistachio" },
  { title: "Pistachio Ringbreaker", value: "pistachio_ringbreaker" },
];
</script>
<style scoped>
.one-step-settings {
  display: grid;
  gap: 22px;
}
.one-step-engine {
  font-size: 11px;
  color: var(--ws-muted);
}
</style>
