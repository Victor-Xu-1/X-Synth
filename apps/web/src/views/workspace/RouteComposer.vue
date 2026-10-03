<template>
  <section class="route-workbench">
    <header class="workbench-heading">
      <h1>路线设计</h1>
      <v-btn variant="text" prepend-icon="mdi-history" to="/results"
        >任务历史</v-btn
      >
    </header>
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
          :prepend-icon="item.icon"
          :disabled="busy"
          >{{ item.title }}</v-btn
        ></v-btn-toggle
      >
    </div>
    <form
      v-show="mode !== 'import'"
      class="structure-workbench-layout"
      @submit.prevent="submit"
    >
      <StructureWorkspace
        ref="structure"
        v-model="draft.smiles"
        :disabled="busy"
      />
      <aside class="workbench-settings" aria-label="搜索配置">
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
            size="small"
            icon="mdi-refresh"
            aria-label="重新检查服务"
            @click="workspace.refresh(true)"
          />
        </div>
        <div class="workbench-submit">
          <v-btn
            variant="text"
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
      </aside>
    </form>
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
  padding: 24px 28px 32px;
  max-width: 1800px;
  margin: 0 auto;
  width: 100%;
  min-width: 0;
}
.workbench-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.workbench-heading h1 {
  font-size: 21px;
  font-weight: 550;
}
.workbench-mode-bar {
  margin: 14px 0 22px;
  border-bottom: 1px solid var(--ws-border);
  padding-bottom: 12px;
}
.workbench-mode-bar :deep(.v-btn-toggle) {
  height: 38px;
  max-width: 100%;
  border-radius: 6px;
}
.workbench-mode-bar :deep(.v-btn) {
  font-size: 12px;
  padding: 0 17px;
}
.structure-workbench-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 26px;
  align-items: start;
}
.workbench-settings {
  display: flex;
  flex-direction: column;
  gap: 22px;
  border-left: 1px solid var(--ws-border);
  padding-left: 24px;
  min-width: 0;
}
.workbench-settings h2 {
  font-size: 14px;
  font-weight: 550;
}
.workbench-submit {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--ws-border);
}
.workbench-readiness {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ws-muted);
}
@media (max-width: 1050px) {
  .structure-workbench-layout {
    grid-template-columns: minmax(0, 1fr) 265px;
    gap: 18px;
  }
  .workbench-settings {
    padding-left: 18px;
  }
  .route-workbench {
    padding: 20px;
  }
}
@media (max-width: 760px) {
  .route-workbench {
    padding: 18px 14px 24px;
  }
  .structure-workbench-layout {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .workbench-settings {
    padding: 20px 0 0;
    border-left: 0;
    border-top: 1px solid var(--ws-border);
  }
  .workbench-mode-bar :deep(.v-btn) {
    padding: 0 10px;
    font-size: 11px;
  }
  .workbench-mode-bar {
    margin-bottom: 16px;
  }
}
</style>
