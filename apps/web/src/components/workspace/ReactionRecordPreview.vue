<template>
  <div class="reaction-record-preview">
    <section v-for="role in roles" :key="role.key">
      <h3>
        {{ role.label }} <span>{{ value[role.key].length }}</span>
      </h3>
      <div
        v-for="record in value[role.key]"
        :key="record.index"
        class="reaction-compound"
      >
        <SmilesImage
          :smiles="record.smiles"
          :width="200"
          :height="110"
          :show-error-image="false"
        />
        <span>{{ record.name || record.formula }}</span>
      </div>
    </section>
  </div>
</template>
<script setup>
import SmilesImage from "@/components/SmilesImage.vue";
defineProps({ value: { type: Object, required: true } });
const roles = [
  { key: "reactants", label: "反应物" },
  { key: "products", label: "产物" },
  { key: "agents", label: "试剂 / 溶剂记录" },
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
}
@media (max-width: 600px) {
  .reaction-record-preview {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
