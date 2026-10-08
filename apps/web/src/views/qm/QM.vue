<template>
  <module-workbench title="QM 描述符">
    <div class="tool-layout">
      <section class="tool-input-panel">
        <h2 class="tool-section-title">分子输入</h2>
        <v-form @submit.prevent="predict">
          <StructureInput
            ref="structureInput"
            v-model="smiles"
            label="分子或反应 SMILES"
            :allow-files="allowMoleculeFiles"
            :disabled="loading"
            data-cy="qm-smiles-input"
          />
          <div class="page-actions">
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              prepend-icon="mdi-play-outline"
              :loading="loading"
              :disabled="loading || inputPending || !smiles?.trim()"
              data-cy="qm-submit-button"
              >计算</v-btn
            >
            <v-tooltip text="清空结果" location="top">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-delete-sweep-outline"
                  variant="text"
                  aria-label="清空结果"
                  :disabled="!results.length || loading"
                  data-cy="qm-clear-button"
                  @click="clear"
                />
              </template>
            </v-tooltip>
          </div>
          <p v-if="requestError" class="tool-error" role="alert">
            {{ requestError }}
          </p>
        </v-form>
      </section>
      <section class="tool-result-panel" data-cy="qm-table">
        <h2 class="tool-section-title">计算结果</h2>
        <v-progress-linear
          v-if="loading"
          indeterminate
          color="primary"
          class="mb-4"
        />
        <template v-if="results.length">
          <div class="qm-result-toolbar">
            <v-select
              :model-value="selectedColumnCategories"
              :items="allfields"
              item-title="title"
              item-value="key"
              label="结果字段"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              multiple
              data-cy="qm-select-columns"
              @update:model-value="onSelectedCategory"
            >
              <template #prepend-item>
                <v-list-item
                  title="全选 / 清空"
                  data-cy="qm-select-all"
                  @click="toggleAllCategories"
                />
                <v-divider />
              </template>
            </v-select>
            <v-menu>
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  variant="outlined"
                  prepend-icon="mdi-download"
                  data-cy="qm-download"
                  >下载</v-btn
                >
              </template>
              <v-list density="compact">
                <v-list-item
                  title="下载 CSV"
                  data-cy="qm-download-csv"
                  @click="downloadCSV"
                />
                <v-list-item
                  title="下载 JSON"
                  data-cy="qm-download-json"
                  @click="downloadJSON"
                />
              </v-list>
            </v-menu>
          </div>
          <v-data-table
            :items-per-page="itemsPerPage"
            :headers="fields"
            :items="results"
            :row-props="colorRowItem"
            density="compact"
            @update:items-per-page="itemsPerPage = $event"
          >
            <template #item.actions="{ item }">
              <v-tooltip text="查看 3D 结构" location="top">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    icon="mdi-rotate-3d"
                    variant="text"
                    size="small"
                    aria-label="查看 3D 结构"
                    :disabled="!workspace.can('drawing')"
                    @click="openVisualization(item)"
                  />
                </template>
              </v-tooltip>
            </template>
          </v-data-table>
        </template>
        <div v-else-if="!loading" class="workspace-empty">
          <v-icon icon="mdi-atom" size="28" />
          <h2>暂无结果</h2>
        </div>
      </section>
    </div>
    <WorkbenchDialog v-model="dialog" fullscreen @after-enter="resizeViewer">
    <v-card class="qm-visualization" :class="backgroundColor">
      <header class="qm-dialog-header">
        <h2>3D 结构</h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="关闭 3D 结构"
          title="关闭 3D 结构"
          @click="dialog = false"
        />
      </header>
      <div class="qm-visualization-layout">
        <aside class="qm-atom-panel">
          <template v-if="selectedAtom">
            <h3 class="tool-section-title">原子详情</h3>
            <v-table density="compact">
              <tbody>
                <tr v-for="(value, key) in selectedAtom.display" :key="key">
                  <th>{{ apiKeyToField[key] }}</th>
                  <td>{{ value }}</td>
                </tr>
              </tbody>
            </v-table>
            <h3 class="tool-section-title mt-5">键详情</h3>
            <v-expansion-panels v-model="bondInfoExpanded">
              <v-expansion-panel
                v-for="(bond, index) in selectedAtom.bonds"
                :key="index"
              >
                <v-expansion-panel-title
                  >{{ selectedAtom.display.elem }}:{{
                    selectedAtom.display.index
                  }}
                  - {{ bond.atom }}:{{ bond.index }}</v-expansion-panel-title
                >
                <v-expansion-panel-text>
                  <v-table density="compact"
                    ><tbody>
                      <tr>
                        <th>键序号</th>
                        <td>{{ bond.bondIndex }}</td>
                      </tr>
                      <tr>
                        <th>键长</th>
                        <td>{{ bond.bondLength }} Å</td>
                      </tr>
                      <tr>
                        <th>键电荷</th>
                        <td>{{ bond.bondCharge }} e</td>
                      </tr>
                    </tbody></v-table
                  >
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </template>
          <p v-else class="workspace-muted">未选择原子</p>
        </aside>
        <section class="qm-scene">
          <div id="molecule" ref="viewerdiv" class="qm-canvas" />
          <div v-if="visualizationLoading" class="qm-scene-state" role="status">
            <v-progress-circular indeterminate size="24" color="primary" /><span
              >正在加载结构</span
            >
          </div>
          <p
            v-if="visualizationError"
            class="qm-scene-state tool-error"
            role="alert"
          >
            {{ visualizationError }}
          </p>
          <div class="qm-scene-actions">
            <v-btn
              :icon="showLabels ? 'mdi-label-off-outline' : 'mdi-label-outline'"
              variant="outlined"
              :aria-label="showLabels ? '隐藏标签' : '显示标签'"
              :title="showLabels ? '隐藏标签' : '显示标签'"
              :disabled="!viewer || visualizationLoading"
              @click="toggleLabels"
            />
            <v-btn
              v-if="selectedAtom"
              icon="mdi-selection-remove"
              variant="outlined"
              aria-label="清除原子选择"
              title="清除原子选择"
              @click="clearSelected"
            />
          </div>
        </section>
      </div>
    </v-card>
    </WorkbenchDialog>
  </module-workbench>
</template>
<script setup>
import { API } from "@/common/api";
import {
  ref,
  computed,
  nextTick,
  onMounted,
  watch,
  onBeforeUnmount,
} from "vue";
import * as Papa from "papaparse";
import { useRoute } from "vue-router";
import StructureInput from "@/components/workspace/StructureInput.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import { useWorkspaceStore } from "@/store/workspace";
import { saveAs } from "file-saver";
import { useTheme } from "@/composables/useTheme";

const { isDark } = useTheme();

const workspace = useWorkspaceStore();
const requestError = ref("");
const visualizationLoading = ref(false);
const visualizationError = ref("");
let visualizationRevision = 0;
let viewerContainer = null;
const pollingLifetime = new AbortController();

const backgroundColor = computed(() => {
  return isDark.value ? "bg-black" : "bg-grey-lighten-4";
});

const bondInfoExpanded = ref(null);

const showLabels = ref(true);
const viewer = ref(null);
const selectedAtom = ref(null);

const smiles = ref("");
const structureInput = ref(null);
const inputPending = computed(() => structureInput.value?.pending === true);
const allowMoleculeFiles = computed(() => !smiles.value.includes(">"));
const loading = ref(false);
const results = ref([]);
const itemsPerPage = ref(10);
const viewerdiv = ref(null);
const route = useRoute();
const selectedColumnCategories = ref(["NPA"]);
const dialog = ref(false);
const currentMoleculeData = ref(null);

const columnCategories = ref({
  NPA: [
    "npa_e",
    "npa_e_pos",
    "npa_e_neg",
    "npa_parr_func_e_pos",
    "npa_parr_func_e_neg",
  ],
  "Sheilding Constant (ppm)": ["sheilding_constant_ppm"],
  Valence: [
    "valence_1s",
    "valence_2s",
    "valence_2p",
    "valence_3s",
    "valence_3p",
    "valence_4s",
    "valence_4p",
  ],
  "Bond Props": ["bond_index", "bond_length", "bond_charge"],
  "Natural Ionicity (unitless)": ["natural_ion"],
  "Dipole Moment (debye)": ["dipole_moment"],
  "Traceless Quadrupole Moment (debye⋅Å)": ["traceless"],
  "HOMO/LUMO (hartree)": [
    "HOMO_3_LUMO",
    "HOMO_3_LUMO_1",
    "HOMO_3_LUMO_2",
    "HOMO_3_LUMO_3",
    "HOMO_2_LUMO",
    "HOMO_2_LUMO_1",
    "HOMO_2_LUMO_2",
    "HOMO_2_LUMO_3",
    "HOMO_1_LUMO",
    "HOMO_1_LUMO_2",
    "HOMO_1_LUMO_3",
    "HOMO_LUMO",
    "HOMO_LUMO_1",
    "HOMO_LUMO_2",
    "HOMO_LUMO_3",
  ],
  "IP (hartree)": ["IP"],
  "EA (hartree)": ["EA"],
});

const fields = ref([]);

const colorRowItem = computed(() => {
  return (item) => {
    return {
      class: {
        "highlight-row": item.item.new === results.value.length,
      },
    };
  };
});

const apiKeyToField = ref({
  index: "index",
  elem: "elem",
  smiles: "smiles",
  npa_e: "npa charge (e)",
  npa_e_pos: "npa charge + (e)",
  npa_e_neg: "npa charge - (e)",
  npa_parr_func_e_pos: "npa parr function + (e)",
  npa_parr_func_e_neg: "npa parr function - (e)",
  sheilding_constant_ppm: "shielding constant (ppm)",
  valence_1s: "1s valence orbital occupancy (e)",
  valence_2s: "2s valence orbital occupancy (e)",
  valence_2p: "2p valence orbital occupancy (e)",
  valence_3s: "3s valence orbital occupancy (e)",
  valence_3p: "3p valence orbital occupancy (e)",
  valence_4s: "4s valence orbital occupancy (e)",
  valence_4p: "4p valence orbital occupancy (e)",
  bond_index: "bond index (unitless)",
  bond_length: "bond length (Å)",
  bond_charge: "bond charge (e)",
  natural_ion: "natural ionicity (unitless)",
  dipole_moment: "dipole moment (debye)",
  traceless: "traceless quadrupole moment (debye⋅Å)",
  HOMO_3_LUMO: "HOMO-3/LUMO (hartree)",
  HOMO_3_LUMO_1: "HOMO-3/LUMO+1 (hartree)",
  HOMO_3_LUMO_2: "HOMO-3/LUMO+2 (hartree)",
  HOMO_3_LUMO_3: "HOMO-3/LUMO+3 (hartree)",
  HOMO_2_LUMO: "HOMO-2/LUMO (hartree)",
  HOMO_2_LUMO_1: "HOMO-2/LUMO+1 (hartree)",
  HOMO_2_LUMO_2: "HOMO-2/LUMO+2 (hartree)",
  HOMO_2_LUMO_3: "HOMO-2/LUMO+3 (hartree)",
  HOMO_1_LUMO: "HOMO-1/LUMO (hartree)",
  HOMO_1_LUMO_1: "HOMO-1/LUMO+1 (hartree)",
  HOMO_1_LUMO_2: "HOMO-1/LUMO+2 (hartree)",
  HOMO_1_LUMO_3: "HOMO-1/LUMO+3 (hartree)",
  HOMO_LUMO: "HOMO/LUMO (hartree)",
  HOMO_LUMO_1: "HOMO/LUMO+1 (hartree)",
  HOMO_LUMO_2: "HOMO/LUMO+2 (hartree)",
  HOMO_LUMO_3: "HOMO/LUMO+3 (hartree)",
  IP: "IP (hartree)",
  EA: "EA (hartree)",
});

const predict = async () => {
  if (loading.value || inputPending.value || pollingLifetime.signal.aborted || !workspace.can("qm") || !smiles.value?.trim()) return;
  loading.value = true;
  requestError.value = "";
  try {
    const output = await API.runCeleryTask("/api/qm-descriptors/call-async", {
      smiles: [smiles.value.trim()],
    }, undefined, { signal: pollingLifetime.signal });
    if (pollingLifetime.signal.aborted) return;
    if (!Array.isArray(output?.result)) throw new Error("QM 结果格式异常");
    results.value.unshift(...output.result);
    if (results.value[0]) results.value[0].new = results.value.length;
    if (!output.result.length)
      requestError.value = "计算已返回，但没有可显示的描述符。";
  } catch (error) {
    if (pollingLifetime.signal.aborted) return;
    requestError.value = API.toErrorObject(
      error,
      "QM 描述符计算失败，请检查输入与模型服务。",
    ).string_error;
  } finally {
    if (!pollingLifetime.signal.aborted) loading.value = false;
  }
};

const toggleAllCategories = async () => {
  if (selectedColumnCategories.value.length < allfields.value.length) {
    selectedColumnCategories.value = allfields.value.map(
      (category) => category.key,
    );
  } else {
    selectedColumnCategories.value = [];
  }
  await nextTick();
  onSelectedCategory();
};
const clear = () => {
  results.value = [];
};
const onSelectedCategory = (value = selectedColumnCategories.value) => {
  selectedColumnCategories.value = (Array.isArray(value) ? value : []).filter(
    (key) => Object.hasOwn(columnCategories.value, key),
  );
  const baseFields = [
    {
      key: "smiles",
      title: apiKeyToField.value["smiles"],
      sortable: true,
      removable: false,
    },
    { title: "3D 可视化", key: "actions", sortable: false, align: "center" },
  ];
  selectedColumnCategories.value.forEach((category) => {
    columnCategories.value[category].forEach((key) => {
      baseFields.push({
        key: key,
        title: apiKeyToField.value[key],
        sortable: false,
        removable: true,
      });
    });
  });
  fields.value = baseFields;
};

const categoryLabels = {
  NPA: "自然布居分析 (NPA)",
  "Sheilding Constant (ppm)": "屏蔽常数 (ppm)",
  Valence: "价轨道占据",
  "Bond Props": "键参数",
  "Natural Ionicity (unitless)": "自然离子性",
  "Dipole Moment (debye)": "偶极矩 (debye)",
  "Traceless Quadrupole Moment (debye⋅Å)": "无迹四极矩 (debye⋅Å)",
  "HOMO/LUMO (hartree)": "HOMO / LUMO (hartree)",
  "IP (hartree)": "电离势 (hartree)",
  "EA (hartree)": "电子亲和能 (hartree)",
};
const allfields = computed(() =>
  Object.keys(columnCategories.value).map((key) => ({
    key,
    title: categoryLabels[key] || key,
  })),
);

const downloadCSV = () => {
  if (!results.value.length) {
    alert("没有可下载的结果。");
    return;
  }
  let downloadData = Papa.unparse(results.value);
  let blob = new Blob([downloadData], { type: "text/csv;charset=utf-8" });
  saveAs(blob, "qm.csv");
};
const downloadJSON = () => {
  if (!results.value.length) {
    alert("没有可下载的结果。");
    return;
  }
  let downloadData = JSON.stringify(results.value);
  let blob = new Blob([downloadData], {
    type: "application/json;charset=utf-8",
  });
  saveAs(blob, "qm.json");
};

const openVisualization = async (rowData) => {
  if (!workspace.can("qm") || !workspace.can("drawing")) return;
  const revision = ++visualizationRevision;
  clearSelected();
  currentMoleculeData.value = rowData;
  visualizationLoading.value = true;
  visualizationError.value = "";
  dialog.value = true;
  try {
    const sdf = await fetchSDFfromSMILES(rowData.smiles);
    await nextTick();
    if (!dialog.value || revision !== visualizationRevision) return;
    if (!sdf || !viewerdiv.value) throw new Error("Missing structure");
    const renderer = await import("3dmol");
    if (!dialog.value || revision !== visualizationRevision) return;
    const createViewer =
      renderer.createViewer || renderer.default?.createViewer;
    if (typeof createViewer !== "function")
      throw new Error("3D renderer unavailable");
    visualizeMolecule(sdf, createViewer);
  } catch {
    if (revision === visualizationRevision)
      visualizationError.value = "3D 结构加载失败，请检查结构服务状态。";
  } finally {
    if (revision === visualizationRevision) visualizationLoading.value = false;
  }
};
const resizeViewer = () => {
  viewer.value?.resize();
  viewer.value?.render();
};
watch(dialog, (value) => {
  if (!value) {
    visualizationRevision++;
    clearSelected();
    viewer.value?.clear();
  }
});
onBeforeUnmount(() => {
  pollingLifetime.abort();
  visualizationRevision++;
  viewer.value?.clear();
});

const fetchSDFfromSMILES = async (smiles) => {
  const sdf = await API.post(
    "/api/rdkit/to-sdfile",
    { smiles: smiles },
    true,
  ).then(async (response) => {
    if (!response) {
      throw new Error("Network response was not ok");
    }
    return response; // Get the response as a Blob to handle file download
  });

  return sdf["sdf"];
};

const viewerBG = computed(() => {
  return isDark.value ? "black" : "#f5f5f5";
});

const visualizeMolecule = (sdfData, createViewer) => {
  if (!viewer.value || viewerContainer !== viewerdiv.value) {
    viewer.value = createViewer(viewerdiv.value, {
      backgroundColor: viewerBG.value,
    });
    viewerContainer = viewerdiv.value;
  } else {
    viewer.value.clear();
  }

  viewer.value.addModel(sdfData, "sdf");
  // Set Ball-and-Stick Style
  viewer.value.setStyle(
    {},
    {
      stick: {
        radius: 0.15, // Increased radius for better visibility
        colorscheme: "Jmol",
        multipleBondSpacing: 0.2, // Adjust spacing between multiple bonds
        singleBondWidth: 0.5, // Width of single bonds
        doubleBondWidth: 0.7, // Width of double bonds
        tripleBondWidth: 0.9, // Width of triple bonds
      },
      sphere: { radius: 0.4, colorscheme: "Jmol" }, // Set atom sphere radius
    },
  );

  if (showLabels.value) {
    addLabels(viewer);
  }

  viewer.value.setClickable({}, true, function (clickedObject) {
    if (Object.prototype.hasOwnProperty.call(clickedObject, "atom")) {
      handleAtomClick(clickedObject);
    }
  });
  // Add some ambient occlusion for better 3D effect
  viewer.value.zoomTo();
  // Enable better rendering of double bonds
  viewer.value.render({
    // bondShade: true,
    bondScale: 0.8,
  });
};

const clearSelected = () => {
  if (selectedAtom.value && viewer.value) {
    viewer.value.setStyle(
      { serial: selectedAtom.value.metaData.serial },
      {
        stick: {
          radius: 0.15,
          colorscheme: "Jmol",
          multipleBondSpacing: 0.2,
          singleBondWidth: 0.5,
          doubleBondWidth: 0.7,
          tripleBondWidth: 0.9,
        },
        sphere: { radius: 0.4, colorscheme: "Jmol" },
      },
    );

    viewer.value.render();
  }

  selectedAtom.value = null;
};

const handleAtomClick = (atom) => {
  // Reset previous selection
  clearSelected();

  // Highlight new selection
  viewer.value.setStyle(
    { serial: atom.serial },
    {
      stick: {
        radius: 0.15,
        colorscheme: "Jmol",
        multipleBondSpacing: 0.2,
        singleBondWidth: 0.5,
        doubleBondWidth: 0.7,
        tripleBondWidth: 0.9,
      },
      sphere: { radius: 0.4, color: "yellow" },
    },
  );

  const model = viewer.value.getModel();

  // Update selected atom data
  selectedAtom.value = {
    display: {
      index: atom.index,
      elem: atom.elem,
      npa_e: currentMoleculeData.value.npa_e[atom.index],
      npa_e_pos: currentMoleculeData.value.npa_e_pos[atom.index],
      npa_e_neg: currentMoleculeData.value.npa_e_neg[atom.index],
      npa_parr_func_e_pos:
        currentMoleculeData.value.npa_parr_func_e_pos[atom.index],
      npa_parr_func_e_neg:
        currentMoleculeData.value.npa_parr_func_e_neg[atom.index],
      sheilding_constant_ppm:
        currentMoleculeData.value.sheilding_constant_ppm[atom.index],
      valence_1s: currentMoleculeData.value.valence_1s[atom.index],
      valence_2s: currentMoleculeData.value.valence_2s[atom.index],
      valence_2p: currentMoleculeData.value.valence_2p[atom.index],
      valence_3s: currentMoleculeData.value.valence_3s[atom.index],
      valence_3p: currentMoleculeData.value.valence_3p[atom.index],
      valence_4s: currentMoleculeData.value.valence_4s[atom.index],
      valence_4p: currentMoleculeData.value.valence_4p[atom.index],
    },

    metaData: {
      serial: atom.serial,
    },

    bonds: atom.bonds.map((bond) => ({
      atom: model.atoms[bond].elem,
      index: bond,
      bondCharge: currentMoleculeData.value.bond_charge[bond],
      bondIndex: currentMoleculeData.value.bond_index[bond],
      bondLength: currentMoleculeData.value.bond_length[bond],
    })),
  };

  viewer.value.render();
};

const toggleLabels = () => {
  showLabels.value = !showLabels.value;
  if (viewer.value) {
    if (showLabels.value) {
      addLabels(viewer);
    } else {
      viewer.value.removeAllLabels();
    }
    viewer.value.render();
  }
};

const addLabels = (viewer) => {
  viewer.value.getModel().atoms.forEach((atom) => {
    viewer.value.addLabel(`${atom.elem}:${atom.index}`, {
      position: { x: atom.x, y: atom.y, z: atom.z },
      backgroundColor: "black",
      fontColor: "white",
      fontSize: 12,
      borderThickness: 1,
      borderColor: "darkgray",
      backgroundOpacity: 0.8,
    });
  });
};

onMounted(async () => {
  onSelectedCategory();
  if (typeof route.query.smiles === "string") smiles.value = route.query.smiles;
  await workspace.refresh();
});
</script>

<style scoped>
.qm-result-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  margin-bottom: 18px;
  align-items: center;
}
:deep(.highlight-row) {
  background: var(--ws-muted-surface);
}
.qm-visualization {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.qm-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--ws-border);
}
.qm-dialog-header h2 {
  font-size: 18px;
  font-weight: 600;
}
.qm-visualization-layout {
  flex: 1;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  min-height: 0;
}
.qm-atom-panel {
  padding: 20px;
  border-right: 1px solid var(--ws-border);
  overflow: auto;
  max-height: calc(100dvh - 72px);
}
.qm-scene {
  position: relative;
  min-height: 480px;
}
.qm-canvas {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
}
.qm-scene-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
}
.qm-scene-actions {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
}
@media (max-width: 700px) {
  .qm-result-toolbar,
  .qm-visualization-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .qm-atom-panel {
    border-right: 0;
    border-bottom: 1px solid var(--ws-border);
    max-height: 220px;
  }
  .qm-scene {
    min-height: 400px;
  }
}
</style>
