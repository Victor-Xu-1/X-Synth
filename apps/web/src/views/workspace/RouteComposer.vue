<template>
  <section class="route-workbench">
    <WorkbenchForm
      :full-height="mode !== 'import'"
      :inspector-visible="mode !== 'import' && !comparisonVisible"
      :parameter-label="mode === 'manual' ? '候选生成' : '搜索配置'"
      @submit="submit"
    >
      <template #heading>
        <h1>{{ $tr('路线设计') }}</h1>
        <v-btn variant="text" prepend-icon="mdi-history" to="/results"
          >{{ $tr('任务记录') }}</v-btn
        >
      </template>
      <template #modes>
        <div class="workbench-mode-bar">
          <v-btn-toggle
            :model-value="mode"
            mandatory
            divided
            variant="text"
            :aria-label="$tr('路线设计模式')"
            @update:model-value="changeMode"
            ><v-btn
              v-for="item in workbenchModes"
              :key="item.value"
              :value="item.value"
              type="button"
              :prepend-icon="item.icon"
              :disabled="busy || readingStructure"
              ><span class="mode-label">{{ $tr(item.title) }}</span></v-btn
            ></v-btn-toggle
          >
        </div>
        <div
          v-if="mode === 'manual'"
          class="manual-view-controls"
          role="group"
          :aria-label="$tr('单步分析视图')"
        >
          <v-btn
            variant="text"
            type="button"
            prepend-icon="mdi-draw"
            data-cy="manual-input-tab"
            :aria-pressed="!comparisonVisible"
            :disabled="busy || readingStructure"
            @click="showManualInput"
            >{{ $tr('目标输入') }}</v-btn
          >
          <v-btn
            variant="text"
            type="button"
            prepend-icon="mdi-compare"
            data-cy="manual-comparison-tab"
            :aria-pressed="comparisonVisible"
            :disabled="!canCompareManual"
            @click="showManualComparison"
            >{{ $tr('候选比较') }}<span
              v-if="draft.manualResult"
              class="manual-candidate-count"
              >{{ draft.manualResult.outcomes.length }}</span
            ></v-btn
          >
        </div>
      </template>
      <StructureWorkspace
        v-show="mode !== 'import' && !comparisonVisible"
        ref="structure"
        v-model="structureSmiles"
        :disabled="busy || readingStructure"
      />
      <template v-if="comparisonVisible">
        <div v-if="error" class="tool-error" role="alert">{{ searchErrorText(error) }}</div>
        <ManualCandidateComparison
          :result="draft.manualResult"
          :context="draft.manualContext"
          :busy="busy"
          @preview="preview"
          @edit="editCandidate"
        />
      </template>
      <template #parameters>
        <div class="workbench-settings">
          <h2>{{ mode === "manual" ? $tr('候选生成') : $tr('搜索配置') }}</h2>
          <RouteSearchSettings
            v-if="mode === 'auto'"
            v-model:name="draft.name"
            v-model:settings="draft.settings"
            :disabled="busy || readingStructure"
          />
          <OneStepSettings
            v-else
            v-model="draft.manual"
            :disabled="busy || readingStructure"
          />
          <div v-if="error" class="tool-error" role="alert">{{ searchErrorText(error) }}</div>
          <div v-if="!ready" class="workbench-readiness" role="status">
            <span>{{
              workspace.loading ? $tr('连接计算服务') : $tr('计算服务未就绪')
            }}</span
            ><v-btn
              variant="text"
              type="button"
              size="small"
              icon="mdi-refresh"
              :aria-label="$tr('重新检查服务')"
              @click="workspace.refresh(true)"
            />
          </div>
        </div>
      </template>
      <template #actions>
            <v-btn
              variant="text"
              type="button"
              prepend-icon="mdi-eraser"
              :disabled="busy || readingStructure"
              @click="clearStructure"
              >{{ $tr('清空') }}</v-btn
            ><v-btn
              color="primary"
              variant="flat"
              type="submit"
              prepend-icon="mdi-arrow-up"
              :loading="busy"
              :disabled="!canSubmit"
              data-cy="home-build-tree"
              >{{ mode === "manual" ? $tr('生成候选') : $tr('生成路线') }}</v-btn
            >
      </template>
    </WorkbenchForm>
    <RouteImportPanel v-if="mode === 'import'" />
    <RoutePreview
      v-model="previewOpen"
      :candidates="previewCandidates"
      :title="$tr('一步逆合成候选')"
    />
  </section>
</template>
<script setup>
import { computed } from "vue";
import { workbenchModes } from "@/common/workbench-model";
import { useRouteWorkbench } from "@/composables/useRouteWorkbench";
import { searchErrorText } from "@/components/workspace/workspace-ui-text";
import StructureWorkspace from "@/components/workspace/StructureWorkspace.vue";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import RouteSearchSettings from "@/components/workspace/RouteSearchSettings.vue";
import OneStepSettings from "@/components/workspace/OneStepSettings.vue";
import RouteImportPanel from "@/components/workspace/RouteImportPanel.vue";
import ManualCandidateComparison from "@/components/workspace/ManualCandidateComparison.vue";
import RoutePreview from "@/components/routes/RoutePreview.vue";
const {
  draft,
  workspace,
  structure,
  structureSmiles,
  readingStructure,
  busy,
  error,
  mode,
  ready,
  canSubmit,
  canCompareManual,
  previewOpen,
  previewCandidates,
  changeMode,
  showManualInput,
  showManualComparison,
  clearStructure,
  submit,
  preview,
  editCandidate,
} = useRouteWorkbench();
const comparisonVisible = computed(() =>
  mode.value === "manual" &&
  draft.manualView === "comparison" &&
  Boolean(draft.manualResult),
);
</script>
<style scoped>
.route-workbench {
  width: 100%;
  min-width: 0;
}
.route-workbench h1 {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.25;
}
.workbench-mode-bar :deep(.v-btn-toggle) {
  height: 42px;
  max-width: 100%;
  border-radius: 6px;
  gap: 6px;
  overflow-x: auto;
}
.workbench-mode-bar :deep(.v-btn) {
  font-size: 14px;
  padding: 0 14px;
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
@media (max-width: 600px) {
  .workbench-mode-bar :deep(.v-btn-toggle) {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .workbench-mode-bar :deep(.v-btn) {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 88px;
    min-width: 0;
    padding: 8px 4px;
    font-size: 12px;
  }
  .workbench-mode-bar :deep(.v-btn__prepend) { margin: 0; }
  .workbench-mode-bar :deep(.v-btn__prepend .v-icon) { font-size: 18px; }
  .workbench-mode-bar :deep(.v-btn__content) { width: 100%; white-space: normal; }
  .mode-label { min-width: 0; line-height: 1.3; overflow-wrap: anywhere; }
}
.workbench-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}
.manual-view-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
  border-bottom: 1px solid var(--ws-border);
}
.manual-view-controls .v-btn {
  min-height: 40px;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  font-size: 13px;
}
.manual-view-controls .v-btn[aria-pressed="true"] {
  color: var(--ws-accent);
  border-bottom-color: var(--ws-accent);
}
.manual-candidate-count {
  margin-left: 8px;
  font-family: var(--ws-font-code);
}
.workbench-settings h2 {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
}
.workbench-readiness {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  color: var(--ws-muted);
}
</style>
