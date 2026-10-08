<template>
  <article class="template-details" :aria-label="$tr('模板详情')">
    <header>
      <h2>{{ template.template_id }}</h2>
      <span class="workspace-muted">{{ $tr('{count} 例', { count: template.count }) }}</span>
    </header>
    <div v-if="$slots.preview" class="template-preview"><slot name="preview" /></div>
    <dl class="template-metadata">
      <div>
        <dt>{{ $tr('来源') }}</dt>
        <dd>{{ template.source }}</dd>
      </div>
      <div>
        <dt>{{ $tr('模板集') }}</dt>
        <dd>{{ template.template_set }}</dd>
      </div>
      <div>
        <dt>{{ $tr('原生模板集') }}</dt>
        <dd>{{ displayValue(template.raw?.template_set) }}</dd>
      </div>
      <div>
        <dt>{{ $tr('原生 _id') }}</dt>
        <dd>{{ displayValue(template.raw?._id) }}</dd>
      </div>
      <div>
        <dt>{{ $tr('原生 index') }}</dt>
        <dd>{{ displayValue(template.raw?.index) }}</dd>
      </div>
      <div>
        <dt>{{ $tr('方向') }}</dt>
        <dd>{{ $tr(template.direction === "retro" ? "逆合成" : "正向") }}</dd>
      </div>
      <div>
        <dt>{{ $tr('领域') }}</dt>
        <dd>{{ template.domain }}</dd>
      </div>
    </dl>
    <section>
      <h3>{{ $tr('反应 SMARTS') }}</h3>
      <pre>{{ template.reaction_smarts }}</pre>
    </section>
    <section>
      <h3>{{ $tr('试剂与限制') }}</h3>
      <dl class="template-metadata">
        <div>
          <dt>{{ $tr('必要试剂') }}</dt>
          <dd>{{ displayValue(template.necessary_reagent) }}</dd>
        </div>
        <div>
          <dt>{{ $tr('仅分子内反应') }}</dt>
          <dd>{{ $tr(template.intra_only ? "是" : "否") }}</dd>
        </div>
        <div>
          <dt>{{ $tr('仅二聚反应') }}</dt>
          <dd>{{ $tr(template.dimer_only ? "是" : "否") }}</dd>
        </div>
      </dl>
    </section>
    <section>
      <h3>{{ $tr('属性') }}</h3>
      <dl
        v-if="Object.keys(template.attributes).length"
        class="template-metadata"
      >
        <div v-for="(value, key) in template.attributes" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ displayValue(value) }}</dd>
        </div>
      </dl>
      <p v-else class="workspace-muted">{{ $tr('未记录属性') }}</p>
    </section>
    <section>
      <h3>
        {{ $tr('参考记录') }} <span class="workspace-muted">{{ references.length }}</span>
      </h3>
      <p v-if="!references.length" class="workspace-muted">{{ $tr('未记录参考来源') }}</p>
      <ol v-else :start="(page - 1) * pageSize + 1" class="template-references">
        <li v-for="(reference, index) in visibleReferences" :key="index">
          <span>{{ reference.label }}</span>
          <a
            v-for="link in reference.links"
            :key="link.href"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ $tr(link.label)
            }}<span class="mdi mdi-open-in-new" aria-hidden="true" />
          </a>
        </li>
      </ol>
      <nav
        v-if="pages > 1"
        class="reference-pagination"
        :aria-label="$tr('参考记录分页')"
      >
        <button
          type="button"
          :title="$tr('上一页')"
          :aria-label="$tr('上一页')"
          :disabled="page === 1"
          @click="page--"
        >
          <span class="mdi mdi-chevron-left" aria-hidden="true" />
        </button>
        <span>{{ page }} / {{ pages }}</span>
        <button
          type="button"
          :title="$tr('下一页')"
          :aria-label="$tr('下一页')"
          :disabled="page === pages"
          @click="page++"
        >
          <span class="mdi mdi-chevron-right" aria-hidden="true" />
        </button>
      </nav>
    </section>
  </article>
</template>
<script setup>
import { computed, ref, watch } from "vue";
import { templateReference, templateValue } from "@/common/template-references";
import { uiText } from "@/i18n";
const displayValue = (value) => value === null || value === undefined || value === "" ? uiText("未记录") : templateValue(value);
const props = defineProps({ template: { type: Object, required: true } });
const pageSize = 50,
  page = ref(1);
const references = computed(() => props.template.references || []);
const pages = computed(() => Math.ceil(references.value.length / pageSize));
const visibleReferences = computed(() =>
  references.value
    .slice((page.value - 1) * pageSize, page.value * pageSize)
    .map(templateReference),
);
watch(
  () => props.template.template_id,
  () => {
    page.value = 1;
  },
  { flush: "sync" },
);
</script>
<style scoped>
.template-details {
  min-width: 0;
  color: var(--ws-text);
}
.template-details header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px;
}
.template-details h2 {
  font-size: 16px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.template-preview {
  margin-top: 16px;
}
.template-details h3 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
}
.template-details section {
  border-top: 1px solid var(--ws-border);
  margin-top: 22px;
  padding-top: 16px;
}
.template-metadata {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 14px 24px;
  margin-top: 16px;
}
.template-metadata div {
  min-width: 0;
}
dt {
  color: var(--ws-muted);
  font-size: 11px;
  margin-bottom: 4px;
  overflow-wrap: anywhere;
}
dd {
  margin: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
pre {
  font-size: 12px;
  line-height: 1.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.template-references {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
  column-gap: 24px;
  padding-left: 0;
  list-style-position: inside;
  font-size: 12px;
}
.template-references li {
  padding: 5px 0;
  overflow-wrap: anywhere;
}
.template-references a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  color: rgb(var(--v-theme-primary));
}
.reference-pagination {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
  font-size: 12px;
}
.reference-pagination button {
  width: 32px;
  height: 32px;
  color: var(--ws-text);
  background: var(--ws-surface);
  border: 1px solid var(--ws-border);
  border-radius: 4px;
}
.reference-pagination button:hover:not(:disabled) {
  background: var(--ws-hover);
}
.reference-pagination button:disabled {
  opacity: 0.4;
}
.reference-pagination button:focus-visible {
  outline: 2px solid var(--ws-text);
  outline-offset: 2px;
}
</style>
