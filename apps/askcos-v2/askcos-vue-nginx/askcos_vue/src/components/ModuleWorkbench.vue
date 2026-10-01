<template>
  <section class="module-workbench">
    <div class="workbench-hero">
      <div class="hero-copy">
        <v-chip class="hero-chip" :color="accent" variant="tonal" size="small">
          <v-icon :icon="icon" start></v-icon>
          {{ eyebrow }}
        </v-chip>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>

      <div class="hero-actions">
        <slot name="actions"></slot>
      </div>
    </div>

    <div v-if="modules.length" class="module-strip" role="tablist">
      <button
        v-for="module in modules"
        :key="module.value || module.title"
        :class="['module-pill', { active: module.value === activeModule, disabled: module.disabled }]"
        :disabled="module.disabled"
        type="button"
        @click="selectModule(module)"
      >
        <v-icon :icon="module.icon || 'mdi-view-dashboard-outline'"></v-icon>
        <span>
          <strong>{{ module.title }}</strong>
          <small>{{ module.subtitle }}</small>
        </span>
      </button>
    </div>

    <div v-if="summaryItems.length" class="workbench-summary" aria-label="页面摘要">
      <div v-for="item in summaryItems" :key="item.label" class="summary-card">
        <v-icon :icon="item.icon || 'mdi-check-circle-outline'"></v-icon>
        <div>
          <strong>{{ item.label }}</strong>
          <span>{{ item.value }}</span>
        </div>
      </div>
    </div>

    <main class="workbench-content">
      <slot></slot>
    </main>
  </section>
</template>

<script setup>
const props = defineProps({
  title: { type: String, required: true },
  eyebrow: { type: String, default: 'synon 工作台' },
  description: { type: String, default: '' },
  icon: { type: String, default: 'mdi-flask-outline' },
  accent: { type: String, default: 'primary' },
  modules: { type: Array, default: () => [] },
  activeModule: { type: String, default: '' },
  summaryItems: { type: Array, default: () => [] },
})

const emit = defineEmits(['select-module'])

const selectModule = (module) => {
  if (module.disabled) return
  emit('select-module', module.value)
}
</script>

<style scoped>
.module-workbench {
  min-height: calc(100vh - 50px);
  padding: 24px;
  background:
    radial-gradient(circle at 10% 0%, rgba(0, 122, 255, 0.08), transparent 32%),
    linear-gradient(180deg, #f8fbff 0%, #f5f8fb 46%, #f7f9fc 100%);
}

.workbench-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: end;
  max-width: 1720px;
  margin: 0 auto 18px;
  padding: 28px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 22px 70px rgba(15, 23, 42, 0.07);
  backdrop-filter: blur(18px);
}

.hero-copy {
  max-width: 920px;
}

.hero-chip {
  margin-bottom: 12px;
  font-weight: 800;
}

.hero-copy h1 {
  margin: 0;
  color: #0f172a;
  font-size: clamp(30px, 3vw, 48px);
  line-height: 1.06;
  letter-spacing: 0;
}

.hero-copy p {
  max-width: 860px;
  margin: 12px 0 0;
  color: #526173;
  font-size: 15px;
  line-height: 1.72;
}

.hero-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.module-strip {
  max-width: 1720px;
  margin: 0 auto 18px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}

.module-pill {
  width: 100%;
  min-height: 76px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.78);
  color: #1f2937;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.05);
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.module-pill:hover {
  transform: translateY(-1px);
  border-color: rgba(0, 122, 255, 0.22);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
}

.module-pill.active {
  border-color: rgba(0, 122, 255, 0.34);
  background:
    linear-gradient(135deg, rgba(0, 122, 255, 0.12), rgba(255, 255, 255, 0.94));
}

.module-pill.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.module-pill strong,
.module-pill small {
  display: block;
}

.module-pill strong {
  color: #0f172a;
  font-size: 14px;
  line-height: 1.25;
}

.module-pill small {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.35;
}

.workbench-summary,
.workbench-content {
  max-width: 1720px;
  margin: 0 auto;
}

.workbench-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.workbench-content {
  min-width: 0;
}

.summary-card {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.80);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.05);
}

.summary-card strong,
.summary-card span {
  display: block;
}

.summary-card strong {
  color: #0f172a;
  font-size: 13px;
}

.summary-card span {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}

.workbench-content :deep(.v-sheet) {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 22px !important;
  background: rgba(255, 255, 255, 0.90) !important;
  box-shadow: 0 16px 46px rgba(15, 23, 42, 0.06) !important;
}

.workbench-content :deep(.v-window) {
  overflow: visible;
}

@media (max-width: 1180px) {
  .workbench-hero {
    grid-template-columns: 1fr;
  }

  .hero-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 720px) {
  .module-workbench {
    padding: 14px;
  }

  .workbench-hero {
    padding: 20px;
    border-radius: 22px;
  }

  .module-strip {
    grid-template-columns: 1fr;
  }
}
</style>
