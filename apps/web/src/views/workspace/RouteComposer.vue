<template>
  <section class="route-workbench">
    <WorkbenchForm
      :full-height="mode !== 'import'"
      :inspector-visible="mode !== 'import'"
      :parameter-label="mode === 'manual' ? '候选生成' : '搜索配置'"
      @submit="submit"
    >
      <template #heading>
        <h1>路线设计</h1>
        <v-btn variant="text" prepend-icon="mdi-history" to="/results"
          >任务记录</v-btn
        >
      </template>
      <template #modes>
        <div class="workbench-mode-bar">
          <v-btn-toggle
            :model-value="mode"
            mandatory
            divided
            variant="text"
            aria-label="路线设计模式"
            @update:model-value="changeMode"
            ><v-btn
              v-for="item in workbenchModes"
              :key="item.value"
              :value="item.value"
              type="button"
              :prepend-icon="item.icon"
              :disabled="busy"
              >{{ item.title }}</v-btn
            ></v-btn-toggle
          >
        </div>
      </template>
      <StructureWorkspace
        v-show="mode !== 'import'"
        ref="structure"
        v-model="draft.smiles"
        :disabled="busy"
      />
      <template #parameters>
        <div class="workbench-settings">
          <h2>{{ mode === "manual" ? "候选生成" : "搜索配置" }}</h2>
          <RouteSearchSettings
            v-if="mode === 'auto'"
            v-model:name="draft.name"
            v-model:settings="draft.settings"
            :disabled="busy"
          />
          <OneStepSettings v-else v-model="draft.manual" :disabled="busy" />
          <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
          <div v-if="!ready" class="workbench-readiness" role="status">
            <span>{{
              workspace.loading ? "连接计算服务" : "计算服务未就绪"
            }}</span
            ><v-btn
              variant="text"
              type="button"
              size="small"
              icon="mdi-refresh"
              aria-label="重新检查服务"
              @click="workspace.refresh(true)"
            />
          </div>
          <div class="workbench-submit">
            <v-btn
              variant="text"
              type="button"
              prepend-icon="mdi-eraser"
              :disabled="busy"
              @click="clearStructure"
              >清空</v-btn
            ><v-btn
              color="primary"
              variant="flat"
              type="submit"
              prepend-icon="mdi-arrow-up"
              :loading="busy"
              :disabled="!ready"
              data-cy="home-build-tree"
              >{{ mode === "manual" ? "生成候选" : "生成路线" }}</v-btn
            >
          </div>
        </div>
      </template>
    </WorkbenchForm>
    <RouteImportPanel v-if="mode === 'import'" />
    <ManualOutcomes
      v-if="mode === 'manual' && draft.manualResult"
      :result="draft.manualResult"
      :busy="busy"
      @preview="preview"
      @edit="editCandidate"
    />
    <RoutePreview
      v-model="previewOpen"
      :candidates="previewCandidates"
      title="一步逆合成候选"
    />
  </section>
</template>
<script setup>
import { workbenchModes } from "@/common/workbench-model";
import { useRouteWorkbench } from "@/composables/useRouteWorkbench";
import StructureWorkspace from "@/components/workspace/StructureWorkspace.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import RouteSearchSettings from "@/components/workspace/RouteSearchSettings.vue";
import OneStepSettings from "@/components/workspace/OneStepSettings.vue";
import RouteImportPanel from "@/components/workspace/RouteImportPanel.vue";
import ManualOutcomes from "@/components/workspace/ManualOutcomes.vue";
import RoutePreview from "@/components/routes/RoutePreview.vue";
const {
  draft,
  workspace,
  structure,
  busy,
  error,
  mode,
  ready,
  previewOpen,
  previewCandidates,
  changeMode,
  clearStructure,
  submit,
  preview,
  editCandidate,
} = useRouteWorkbench();
</script>
<style scoped>
.route-workbench {
  width: 100%;
  min-width: 0;
}
.route-workbench h1 {
  font-size: 30px;
  font-weight: 600;
  line-height: 1.25;
}
.workbench-mode-bar :deep(.v-btn-toggle) {
  height: 54px;
  max-width: 100%;
  border-radius: 6px;
  gap: 6px;
  overflow-x: auto;
}
.workbench-mode-bar :deep(.v-btn) {
  font-size: 16px;
  padding: 0 18px;
  border: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.workbench-mode-bar :deep(.v-btn--active) {
  color: var(--ws-accent);
  background: var(--ws-accent-soft);
  border-color: transparent;
}
.workbench-mode-bar :deep(.v-btn--active .v-btn__overlay),
.workbench-mode-bar :deep(.v-btn--active .v-btn__underlay) {
  opacity: 0;
}
.workbench-settings {
  display: flex;
  flex-direction: column;
  gap: 28px;
  min-width: 0;
}
.workbench-settings h2 {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.35;
}
.workbench-submit {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 24px;
  border-top: 1px solid var(--ws-border);
}
.workbench-submit .v-btn {
  height: 56px;
  font-size: 16px;
}
.workbench-submit .v-btn[type="submit"] {
  width: 152px;
  max-width: 60%;
}
.workbench-submit .v-btn[type="button"] {
  padding: 0 10px;
}
.workbench-readiness {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  color: var(--ws-muted);
}
@media (max-width: 599px) {
  .route-workbench h1 {
    font-size: 24px;
  }
  .workbench-mode-bar :deep(.v-btn-toggle) {
    height: 46px;
  }
  .workbench-mode-bar :deep(.v-btn) {
    padding: 0 10px;
    font-size: 13px;
  }
}
</style>
