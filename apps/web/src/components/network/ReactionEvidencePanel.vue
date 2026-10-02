<template>
  <section v-if="evidence.hasEvidence" class="reaction-evidence-panel">
    <div v-if="evidence.links.length" class="evidence-block">
      <div class="evidence-heading">证据来源</div>
      <div class="evidence-link-grid">
        <a
          v-for="link in evidence.links"
          :key="link.key"
          class="evidence-link"
          :href="link.href"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{{ link.label }}</span>
          <span class="evidence-link-value">{{ link.value }}</span>
        </a>
      </div>
    </div>

    <div v-if="evidence.fields.length" class="evidence-block">
      <div class="evidence-heading">反应出处</div>
      <dl class="evidence-list">
        <template v-for="field in evidence.fields" :key="`${field.label}-${field.value}`">
          <dt>{{ field.label }}</dt>
          <dd :class="{ 'mono-value': field.kind === 'reaction' }">{{ field.value }}</dd>
        </template>
      </dl>
    </div>

    <div v-if="evidence.conditions.length" class="evidence-block">
      <div class="evidence-heading">反应条件</div>
      <dl class="evidence-list">
        <template
          v-for="condition in evidence.conditions"
          :key="`${condition.label}-${condition.value}`"
        >
          <dt>{{ condition.label }}</dt>
          <dd>{{ condition.value }}</dd>
        </template>
      </dl>
    </div>
  </section>
</template>

<script>
import { buildReactionEvidence } from "@/common/reaction-evidence";

export default {
  name: "ReactionEvidencePanel",
  props: {
    evidenceInput: {
      type: Object,
      default: () => ({}),
    },
  },
  computed: {
    evidence() {
      return buildReactionEvidence(this.evidenceInput);
    },
  },
};
</script>

<style scoped>
.reaction-evidence-panel {
  border: 1px solid rgba(60, 60, 67, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
  padding: 14px;
  margin: 10px 8px;
  text-align: left;
}

.evidence-block + .evidence-block {
  border-top: 1px solid rgba(60, 60, 67, 0.12);
  margin-top: 12px;
  padding-top: 12px;
}

.evidence-heading {
  color: #111827;
  font-size: 0.86rem;
  font-weight: 700;
  margin-bottom: 8px;
}

.evidence-link-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
}

.evidence-link {
  align-items: center;
  background: rgba(0, 122, 255, 0.08);
  border: 1px solid rgba(0, 122, 255, 0.16);
  border-radius: 10px;
  color: #0f62fe;
  display: flex;
  flex-direction: column;
  font-size: 0.82rem;
  font-weight: 650;
  gap: 3px;
  justify-content: center;
  min-height: 48px;
  padding: 8px 10px;
  text-align: center;
  text-decoration: none;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.evidence-link:hover {
  background: rgba(0, 122, 255, 0.13);
  border-color: rgba(0, 122, 255, 0.32);
  transform: translateY(-1px);
}

.evidence-link-value {
  color: #4b5563;
  font-size: 0.72rem;
  font-weight: 500;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.evidence-list {
  display: grid;
  grid-template-columns: minmax(72px, 0.28fr) minmax(0, 1fr);
  margin: 0;
  row-gap: 7px;
}

.evidence-list dt {
  color: #6b7280;
  font-size: 0.78rem;
  font-weight: 650;
  padding-right: 10px;
}

.evidence-list dd {
  color: #1f2937;
  font-size: 0.82rem;
  line-height: 1.45;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mono-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.76rem;
}
</style>
