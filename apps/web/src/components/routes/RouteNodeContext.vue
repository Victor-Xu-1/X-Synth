<template>
  <section class="route-node-context" :aria-label="$tr('节点分析')">
    <div v-if="node.type === 'molecule'" class="node-actions">
      <MoleculeFileControls :smiles="node.smiles" :allow-import="false" />
      <v-btn
        v-if="workspace.can('stock')"
        size="small"
        variant="text"
        prepend-icon="mdi-flask-outline"
        @click="stockOpen = true"
        >{{ $tr('采购记录') }}</v-btn
      >
      <v-btn
        v-if="workspace.can('retro')"
        size="small"
        variant="text"
        prepend-icon="mdi-source-branch"
        :to="locations.retro"
        @click="$emit('navigate')"
        >{{ $tr('一步分析') }}</v-btn
      >
      <v-btn
        v-if="workspace.can('scscore')"
        size="small"
        variant="text"
        prepend-icon="mdi-chart-scatter-plot"
        :to="locations.complexity"
        @click="$emit('navigate')"
        >{{ $tr('结构复杂度') }}</v-btn
      >
    </div>
    <template v-else-if="reaction">
      <StructurePreview
        label="反应结构"
        :smiles="reaction.smiles"
        input-type="reaction"
        :width="260"
        :height="160"
      />
      <details>
        <summary>{{ $tr('反应 SMILES') }}</summary>
        <code>{{ reaction.smiles }}</code>
      </details>
      <div class="node-actions">
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-file-export-outline"
          :loading="exporting"
          @click="exportRxn"
          >{{ $tr('导出 RXN') }}</v-btn
        >
        <v-btn
          v-if="workspace.can('fast_filter')"
          size="small"
          variant="text"
          prepend-icon="mdi-check-decagram-outline"
          :to="feasibilityLocation(reaction)"
          @click="$emit('navigate')"
          >{{ $tr('反应可行性') }}</v-btn
        >
        <v-btn
          v-if="workspace.can('conditions')"
          size="small"
          variant="text"
          prepend-icon="mdi-beaker-outline"
          @click="conditionOpen = true"
          >{{ $tr('条件预测') }}</v-btn
        >
      </div>
      <dl v-if="evidence.conditions.length" class="node-evidence">
        <div v-for="item in evidence.conditions" :key="item.label">
          <dt>{{ $tr(item.label) }}</dt>
          <dd>{{ item.value }}</dd>
        </div>
      </dl>
      <div v-if="templates.length" class="template-links">
        <strong>{{ $tr('模板来源') }}</strong
        ><router-link
          v-for="item in templates"
          :key="item.identity"
          :to="item.location"
          @click="$emit('navigate')"
          >{{ item.label }}<v-icon icon="mdi-arrow-top-right" size="14"
        /></router-link>
      </div>
      <div v-if="evidence.fields.length" class="node-evidence">
        <dl>
          <div v-for="field in evidence.fields" :key="field.label">
            <dt>{{ $tr(field.label) }}</dt>
            <dd>{{ field.value }}</dd>
          </div>
        </dl>
      </div>
      <a
        v-for="link in links"
        :key="link.key"
        :href="safeExternalUrl(link.href)"
        target="_blank"
        rel="noopener noreferrer"
        >{{ $tr(link.label) }} · {{ link.value }}</a
      >
      <ReactionReferences
        :key="node.id"
        :product="reaction.product"
        :reactants="reaction.precursors"
      />
    </template>
    <p v-if="exportError" class="tool-error" role="alert">{{ $tr(exportError) }}</p>
    <MoleculeStockDialog
      v-model="stockOpen"
      :smiles="node.smiles"
      :expected-snapshot="snapshot"
      @navigate="$emit('navigate')"
    />
    <RouteConditionDialog
      v-if="conditionOpen && reaction"
      :key="reaction.smiles"
      :reaction="reaction"
      @close="conditionOpen = false"
    />
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import { downloadChemicalFile } from "@/common/chemical-files";
import { errorMessage } from "@/common/workspace-errors";
import { useWorkspaceStore } from "@/store/workspace";
import {
  reactionForNode,
  moleculeLocations,
  feasibilityLocation,
  templateTargets,
} from "@/common/route-node-context";
import {
  buildReactionEvidence,
  createReactionEvidenceInput,
} from "@/common/reaction-evidence";
import { safeExternalUrl } from "@/common/external-url";
import MoleculeStockDialog from "./MoleculeStockDialog.vue";
import RouteConditionDialog from "./RouteConditionDialog.vue";
import MoleculeFileControls from "@/components/workspace/MoleculeFileControls.vue";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import ReactionReferences from "@/components/references/ReactionReferences.vue";
const props = defineProps({
  node: { type: Object, required: true },
  graph: Object,
  step: Object,
  snapshot: String,
});
defineEmits(["navigate"]);
const workspace = useWorkspaceStore(),
  stockOpen = ref(false),
  conditionOpen = ref(false);
const exporting = ref(false),
  exportError = ref("");
let exportGeneration = 0,
  disposed = false;
const locations = computed(() =>
  moleculeLocations(props.node.smiles, props.snapshot),
);
const reaction = computed(() => reactionForNode(props.graph, props.node));
const templates = computed(() => templateTargets(props.step));
const evidence = computed(() =>
  buildReactionEvidence(
    createReactionEvidenceInput({
      ...(props.step?.metadata || {}),
      ...(props.step || {}),
    }),
  ),
);
const links = computed(() =>
  evidence.value.links.filter((link) => safeExternalUrl(link.href)),
);
watch(
  () => [props.node.id, props.node.smiles, reaction.value?.smiles],
  () => {
    stockOpen.value = false;
    conditionOpen.value = false;
    exportGeneration++;
    exporting.value = false;
    exportError.value = "";
  },
);
async function exportRxn() {
  if (exporting.value || !reaction.value) return;
  const current = ++exportGeneration,
    value = reaction.value;
  exporting.value = true;
  exportError.value = "";
  try {
    const output = await API.post("/api/v1/structure/reaction-export", {
      reactants: value.precursors,
      product: value.product,
    });
    if (!disposed && current === exportGeneration)
      downloadChemicalFile(output, "reaction");
  } catch (error) {
    if (!disposed && current === exportGeneration)
      exportError.value = errorMessage(error, "RXN 导出失败。");
  } finally {
    if (!disposed && current === exportGeneration) exporting.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  exportGeneration++;
});
</script>
<style scoped>
.route-node-context {
  border-top: 1px solid var(--ws-border);
  padding-top: 14px;
  font-size: 11px;
}
.node-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
code {
  display: block;
  overflow-wrap: anywhere;
  font-size: 10px;
  margin: 8px 0;
}
.template-links {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}
.template-links a {
  display: flex;
  gap: 4px;
  align-items: center;
  overflow-wrap: anywhere;
}
.node-evidence {
  margin: 14px 0;
}
dt {
  color: var(--ws-muted);
  margin-top: 10px;
}
dd {
  overflow-wrap: anywhere;
  margin-top: 4px;
}
a {
  overflow-wrap: anywhere;
}
</style>
