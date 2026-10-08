<template>
  <div class="assessment-results">
    <section class="full-identity" :aria-labelledby="`${id}-identity`">
      <div class="structure-preview">
        <SmilesImage :smiles="result.structure.smiles" :width="280" :height="180" :show-error-image="false" allow-copy />
      </div>
      <div class="identity-facts">
        <h2 :id="`${id}-identity`">完整化合物 · {{ result.structure.formula }}</h2>
        <code>{{ result.structure.smiles }}</code>
        <dl class="identity-metrics">
          <div v-for="row in identityRows" :key="row.key" :data-field="row.key">
            <dt>{{ row.label }}</dt><dd>{{ metricValue(row.value) }}</dd>
          </div>
          <div data-field="unassigned_stereocenters" :class="{ 'stereo-warning': result.descriptors.unassigned_stereocenters > 0 }">
            <dt>未指定四面体立体中心数</dt><dd>{{ metricValue(result.descriptors.unassigned_stereocenters) }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <aside class="assessment-notices" role="note" :aria-labelledby="`${id}-notices`">
      <h2 :id="`${id}-notices`"><v-icon icon="mdi-information-outline" size="17" aria-hidden="true" />科学解读边界</h2>
      <ul><li v-for="(notice, index) in result.notices" :key="index">{{ notice }}</li></ul>
      <ul v-if="componentNotices.length" class="component-notices">
        <li v-for="notice in componentNotices" :key="notice.key">
          <strong>组分 {{ notice.index }} · {{ notice.formula }}：</strong>{{ notice.text }}
        </li>
      </ul>
    </aside>

    <WorkbenchTabs :key="readingScope" v-model="section" :items="tabs" label="结构评估阅读分区" v-slot="{ tabId, panelId }">
      <section v-for="tab in tabs" v-show="section === tab.value" :id="panelId(tab.value)" :key="tab.value"
        class="assessment-panel" role="tabpanel" :aria-labelledby="tabId(tab.value)" :aria-hidden="section !== tab.value"
        :inert="section !== tab.value ? '' : undefined" :tabindex="section === tab.value ? 0 : -1" :data-section="tab.value">
        <template v-if="section === tab.value && tab.value === 'overview'">
          <section v-if="singleComponent" class="complexity-overview">
            <h2>单组分复杂度</h2>
            <dl class="core-metrics">
              <div v-for="row in complexityRows" :key="row.key" :data-metric="row.key">
                <dt>{{ row.label }}</dt><dd :class="{ 'metric-undefined': row.value == null }">{{ metricValue(row.value) }}</dd>
                <small>{{ row.note }}</small>
              </div>
            </dl>
          </section>
          <p v-else class="component-boundary">复杂度仅按各结构组分报告；不提供整条记录的综合评分。</p>
          <section>
            <h2>关键分子描述符 · 完整记录</h2>
            <dl class="descriptor-grid">
              <div v-for="row in coreRows" :key="row.key" :data-metric="row.key">
                <dt>{{ row.label }}</dt><dd>{{ metricValue(row.value) }}</dd>
              </div>
            </dl>
          </section>
        </template>
        <AssessmentComponents v-else-if="section === tab.value && tab.value === 'components'" :components="result.components" />
        <template v-else-if="section === tab.value && tab.value === 'descriptors'">
          <h2>完整结构描述符 · 全部组分</h2>
          <dl class="descriptor-grid">
            <div v-for="row in descriptorRows" :key="row.key" :data-metric="row.key">
              <dt>{{ row.label }}</dt><dd>{{ metricValue(row.value) }}</dd>
            </div>
          </dl>
        </template>
        <template v-else-if="section === tab.value && tab.value === 'methods'">
          <h2>计算方法与许可</h2>
          <dl class="method-context">
            <div><dt>RDKit 版本</dt><dd>{{ result.rdkit_version }}</dd></div>
            <div><dt>评估范围</dt><dd><code>{{ result.scope }}</code></dd></div>
            <div v-if="typeof result.record_id === 'string'"><dt>记录标识</dt><dd><code>{{ result.record_id }}</code></dd></div>
          </dl>
          <section v-for="(method, index) in result.methods" :key="index" class="method-row">
            <h3>{{ method.name }}</h3>
            <dl>
              <div><dt>实现</dt><dd><code>{{ method.implementation }}</code></dd></div>
              <div><dt>许可</dt><dd>{{ method.license }}</dd></div>
            </dl>
            <div class="method-links">
              <a v-if="safeExternalUrl(method.reference_url)" :href="safeExternalUrl(method.reference_url)" target="_blank" rel="noopener noreferrer">方法来源</a>
              <span v-else>方法来源未提供</span>
              <a v-if="safeExternalUrl(method.source_url)" :href="safeExternalUrl(method.source_url)" target="_blank" rel="noopener noreferrer">实现与许可</a>
              <span v-else>实现链接未提供</span>
            </div>
          </section>
        </template>
      </section>
    </WorkbenchTabs>
  </div>
</template>

<script setup>
import { computed, ref, useId, watch } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import WorkbenchTabs from "@/components/WorkbenchTabs.vue";
import { safeExternalUrl } from "@/common/external-url";
import AssessmentComponents from "./AssessmentComponents.vue";
import { ASSESSMENT_READING_TABS, assessmentComplexityRows, assessmentComponentNotices,
  assessmentCoreRows, assessmentDescriptorRows, assessmentIdentityRows, assessmentSingleComponent, metricValue } from "./result-model";

const props = defineProps({ result: { type: Object, required: true } });
const id = `${useId()}-assessment`, tabs = ASSESSMENT_READING_TABS;
const section = ref("overview"), readingScope = ref(0);
const identityRows = computed(() => assessmentIdentityRows(props.result.structure));
const descriptorRows = computed(() => assessmentDescriptorRows(props.result));
const coreRows = computed(() => assessmentCoreRows(props.result));
const singleComponent = computed(() => assessmentSingleComponent(props.result));
const complexityRows = computed(() => singleComponent.value ? assessmentComplexityRows(singleComponent.value) : []);
const componentNotices = computed(() => assessmentComponentNotices(props.result));
// Replacing the immutable result also disposes tab focus queued for its predecessor.
watch(() => props.result, () => { section.value = "overview"; readingScope.value++; }, { flush: "sync" });
</script>

<style scoped>
.assessment-results { min-width: 0; container-type: inline-size; color: var(--ws-text); }
h2 { font-size: 14px; font-weight: 600; margin: 0 0 14px; }
h3 { font-size: 13px; font-weight: 600; margin: 0 0 12px; }
.full-identity { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr); gap: 24px; align-items: center; padding: 6px 0 20px; }
.structure-preview { width: 280px; max-width: 100%; height: 180px; }
.structure-preview :deep(.v-img) { max-width: 100% !important; }
.identity-facts { min-width: 0; }
.identity-facts h2 { font-size: 16px; margin-bottom: 8px; overflow-wrap: anywhere; }
code { font-family: var(--ws-font-code); font-size: 11px; overflow-wrap: anywhere; }
.identity-facts > code { display: block; margin-bottom: 16px; }
.identity-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; font-size: 12px; margin: 0; }
.identity-metrics > div, .descriptor-grid > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 12px; min-width: 0; }
dt, small { color: var(--ws-muted); }
dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.stereo-warning dt, .stereo-warning dd { color: var(--ws-warning); }
.assessment-notices { border-block: 1px solid var(--ws-border); padding: 14px 0; margin-bottom: 20px; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.assessment-notices h2 { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 8px; }
.assessment-notices ul { padding-left: 20px; margin: 0; }
.component-notices { color: var(--ws-warning); margin-top: 8px !important; }
.component-notices strong { font-weight: 600; }
.assessment-panel { min-width: 0; padding: 0 0 12px; }
.assessment-panel:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 4px; }
.complexity-overview { margin-bottom: 24px; }
.core-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 0; }
.core-metrics > div { min-width: 0; border-left: 2px solid var(--ws-border); padding-left: 12px; }
.core-metrics dt { font-size: 12px; }
.core-metrics dd { font-size: 20px; font-weight: 600; margin: 4px 0; }
.core-metrics small { display: block; font-size: 11px; }
.metric-undefined { font-size: 14px !important; color: var(--ws-muted); }
.descriptor-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; margin: 0; font-size: 13px; }
.descriptor-grid > div { padding: 12px 0; border-bottom: 1px solid var(--ws-border); }
.component-boundary { color: var(--ws-warning); font-size: 12px; margin: 0 0 20px; }
.method-context, .method-row dl { display: grid; gap: 10px; font-size: 12px; margin: 0; }
.method-context > div, .method-row dl > div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 16px; }
.method-row { padding: 20px 0; border-bottom: 1px solid var(--ws-border); overflow-wrap: anywhere; }
.method-links { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 12px; font-size: 12px; }
.method-links a { text-decoration: underline; }
.method-links span { color: var(--ws-muted); }
@container (max-width: 760px) {
  .full-identity { grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 16px; }
  .identity-metrics, .descriptor-grid { grid-template-columns: minmax(0, 1fr); }
}
@container (max-width: 520px) {
  .full-identity { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .core-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
