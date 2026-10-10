<template>
  <div class="reaction-record-preview">
    <section v-for="role in roles" :key="role.key">
      <h3>
        {{ $tr(role.label) }} <span>{{ value[role.key].length }}</span>
      </h3>
      <div
        v-for="record in value[role.key]"
        :key="record.index"
        class="reaction-compound"
      >
        <StructurePreview
          :smiles="record.smiles"
          :label="uiText(role.structureLabel, { index: record.index })"
          :width="200"
          :height="110"
        />
        <span>{{ record.name || record.formula }}</span>
      </div>
    </section>
  </div>
</template>
<script setup>
import StructurePreview from "./StructurePreview.vue";
import { uiText } from "@/i18n";
defineProps({ value: { type: Object, required: true } });
const roles = [
  { key: "reactants", label: "反应物", structureLabel: "反应物结构 {index}" },
  { key: "products", label: "产物", structureLabel: "产物结构 {index}" },
  { key: "agents", label: "试剂 / 溶剂记录", structureLabel: "试剂结构 {index}" },
];
</script>
<style scoped>
.reaction-record-preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
h3 {
  font-size: 12px;
  margin-bottom: 8px;
  font-weight: 500;
}
h3 span,
.reaction-compound span {
  color: var(--ws-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.reaction-compound {
  min-width: 0;
  margin-bottom: 16px;
}
.reaction-compound :deep(.preview-heading) { font-size: 12px; }
@media (max-width: 600px) {
  .reaction-record-preview {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
