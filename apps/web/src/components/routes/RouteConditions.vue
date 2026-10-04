<template>
  <section class="route-conditions" aria-label="反应条件列表">
    <article v-for="step in steps" :key="step.nodeId" class="condition-step">
      <header>
        <button type="button" @click="$emit('select', step.nodeId)">
          <strong>合成步骤 {{ step.number }}</strong>
        </button>
        <span>步骤模型分数 {{ step.confidence }}</span>
        <v-btn
          v-if="workspace.can('conditions')"
          prepend-icon="mdi-beaker-outline"
          size="small"
          variant="text"
          :to="
            createConditionRecommendationUrl(
              step.reactants.join('.') + '>>' + step.product,
            )
          "
          @click="$emit('navigate')"
          >条件预测</v-btn
        >
      </header>
      <SmilesImage
        :smiles="step.reactants.join('.') + '>>' + step.product"
        input-type="reaction"
        :width="620"
        :height="160"
        :show-error-image="false"
      />
      <dl v-if="step.evidence.conditions.length" class="condition-fields">
        <div v-for="field in step.evidence.conditions" :key="field.label">
          <dt>{{ field.label }}</dt>
          <dd>{{ field.value }}</dd>
        </div>
      </dl>
      <p v-else class="workspace-muted">原路线未记录实验条件</p>
      <a
        v-for="link in step.evidence.links.filter((link) =>
          safeExternalUrl(link.href),
        )"
        :key="link.key"
        :href="safeExternalUrl(link.href)"
        target="_blank"
        rel="noopener noreferrer"
        >{{ link.label }} · {{ link.value }}</a
      >
      <ReactionReferences :product="step.product" :reactants="step.reactants" />
    </article>
    <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { conditionRows } from "@/common/route-reading";
import { createConditionRecommendationUrl } from "@/common/reaction-evidence";
import { safeExternalUrl } from "@/common/external-url";
import { useWorkspaceStore } from "@/store/workspace";
import SmilesImage from "@/components/SmilesImage.vue";
import ReactionReferences from "@/components/references/ReactionReferences.vue";
const props = defineProps({ candidate: Object, graph: Object });
defineEmits(["select", "navigate"]);
const workspace = useWorkspaceStore();
const ordered = computed(() => {
  try {
    return { steps: conditionRows(props.candidate, props.graph), error: "" };
  } catch (cause) {
    return { steps: [], error: cause.message };
  }
});
const steps = computed(() => ordered.value.steps),
  error = computed(() => ordered.value.error);
</script>
<style scoped>
.route-conditions {
  padding: 0 20px;
  min-width: 0;
}
.condition-step {
  padding: 18px 0;
  border-bottom: 1px solid var(--ws-border);
  min-width: 0;
}
header {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
  margin-bottom: 12px;
}
header button {
  color: var(--ws-text);
}
header span {
  color: var(--ws-muted);
}
header .v-btn {
  margin-left: auto;
}
.condition-step :deep(.smiles-image-container) {
  max-width: 100%;
}
.condition-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  font-size: 12px;
  padding: 14px 0;
}
dt {
  color: var(--ws-muted);
}
dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
p,
a {
  font-size: 12px;
  margin: 12px 0;
  display: block;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .route-conditions {
    padding: 0 12px;
  }
}
</style>
