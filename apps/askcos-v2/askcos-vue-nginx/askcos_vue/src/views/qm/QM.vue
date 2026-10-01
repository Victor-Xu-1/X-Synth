<template>
    <module-workbench
        title="QM 描述符工作台"
        eyebrow="量子化学"
        icon="mdi-atom"
        accent="indigo"
        description="计算分子或反应相关的 QM 描述符，并支持 3D 原子级可视化，用于反应性、位点和电子效应分析。"
        :summary-items="summaryItems"
    >
        <v-row class="justify-center">
            <v-col cols="12" md="12" xl="10">
                <v-sheet elevation="2" rounded="lg" class="pa-5">
                    <v-row class="justify-center" density="compact">
                        <v-col cols="12" md="10" my="10">
                            <v-text-field v-model="smiles" data-cy="qm-smiles-input" class="centered-input"
                                variant="outlined" label="输入分子或反应 SMILES"
                                prepend-inner-icon="mdi mdi-flask" placeholder="SMILES" hide-details clearable
                                @click:clear="smiles = ''" rounded="pill">
                                <template v-slot:append-inner>
                                    <draw-button v-model:smiles="smiles" />
                                </template>
                                <template v-slot:append>
                                    <v-btn data-cy="qm-submit-button" type="submit" variant="flat" color="primary"
                                        class="mr-5" @click="predict" :loading="!batch && loading"
                                        rounded="pill">提交</v-btn>
                                    <v-btn data-cy="qm-clear-button" variant="tonal" class="mr-5"
                                        :disabled="results.length === 0" @click="clear()" rounded="pill">
                                        清空结果
                                    </v-btn>
                                </template>
                            </v-text-field>
                            <div v-if="!!smiles" class="my-3">
                                <smiles-image :smiles="smiles" height="100px"></smiles-image>
                            </div>
                        </v-col>
                    </v-row>
                </v-sheet>
            </v-col>
        </v-row>
        <v-row class="justify-center">
            <v-col v-show="pendingTasks > 0 || results.length" cols="12" md="12" xl="10">
                <v-sheet elevation="2" class="pa-4" rounded="lg" data-cy="qm-table">
                    <v-row v-if="pendingTasks === 0" class="mx-auto my-auto pa-2">
                        <v-col md="5">
                            <v-menu location="bottom">
                                <template v-slot:activator="{ props }">
                                    <v-btn v-show="!!results.length" color="primary" v-bind="props"
                                        prepend-icon="mdi mdi-download" variant="flat" data-cy="qm-download">
                                        下载
                                    </v-btn>
                                </template>
                                <v-list>
                                    <v-list-item data-cy="qm-download-csv" @click="downloadCSV()">下载
                                        CSV</v-list-item>
                                    <v-list-item data-cy="qm-download-json" @click="downloadJSON()">下载
                                        JSON</v-list-item>
                                </v-list>
                            </v-menu>
                        </v-col>
                        <v-spacer md="2"></v-spacer>
                        <v-col md="5">
                            <v-select :model-value="selectedColumnCategories" :items="allfields" label="选择字段"
                                density="comfortable" variant="outlined" hide-details clearable
                                @update:modelValue="onSelectedCategory" multiple data-cy="qm-select-columns">
                                <template v-slot:prepend-item>
                                    <v-list-item ripple @click="toggleAllCategories" data-cy="qm-select-all">
                                        <v-list-item-title>全选</v-list-item-title>
                                    </v-list-item>
                                    <v-divider></v-divider>
                                </template>
                                <template v-slot:selection="{ item }">
                                    <v-chip>
                                        <span>{{ item.title }}</span>
                                        <v-icon small @click.prevent="deselectColumn(item)">
                                            mdi-close-circle
                                        </v-icon>
                                    </v-chip>
                                </template>
                            </v-select>
                        </v-col>
                        <v-row class="mt-3" style="overflow-x:scroll">
                            <v-col cols="12">
                                <v-data-table :page="lastPage" :items-per-page="itemsPerPage"
                                    @update:itemsPerPage="$event => itemsPerPage = $event" :headers="fields"
                                    :items="results" :row-props="colorRowItem">
                                    <template v-slot:item.actions="{ item }">
                                        <v-btn @click="openVisualization(item)" icon="mdi-rotate-3d"></v-btn>
                                    </template>
                                </v-data-table></v-col>
                        </v-row>
                    </v-row>
                    <v-row v-else justify="space-between" class="mx-auto my-auto pa-2">
                        <v-skeleton-loader class="mx-auto my-auto" min-height="80px" type="table"
                            width="100%"></v-skeleton-loader>
                    </v-row>
                </v-sheet>
            </v-col>
            <v-col v-show="!results.length && pendingTasks === 0" cols="12" md="12" xl="10">
                <v-sheet elevation="2" rounded="lg" class="pa-4">
                    <div class="d-flex flex-column align-center justify-center text-center">
                        <img src="@/assets/qm.svg" :width="400" class="mb-3" cover />
                        <h2>暂无结果</h2>
                        <p class="text-body-1">输入分子或反应 SMILES 后开始计算 QM 描述符。</p>
                    </div>
                </v-sheet>
            </v-col>
        </v-row>
    </module-workbench>
    <v-dialog v-model="dialog" fullscreen>
        <v-card prepend-icon="mdi-rotate-3d" title="3D 可视化" :class="backgroundColor">
            <v-divider></v-divider>
            <v-card-text class="d-flex justify-center align-center pa-0 ma-0" style="overflow: hidden;">
                <v-row class="justify-center align-center" style="height: 100%;">
                    <v-col cols="12" lg="4" md="12" class="d-flex justify-center align-center"
                        :style="selectedAtom ? 'height: 100%;' : ''">
                        <v-sheet elevation="2" class="d-flex flex-column justify-start align-center pa-5 rounded-lg"
                            style="height: 100%; max-width:85%; overflow-y: auto;">
                            <div v-if="selectedAtom" style="width: 100%;">
                                <h2 class="d-flex justify-center align-center">原子详情</h2>
                                <div class="text-left ma-2">
                                    <v-table :class="'ma-0' + (isDark ? ' bg-grey-darken-3' : 'bg-white')"
                                        density="compact">
                                        <tbody>
                                            <tr v-for="(value, key) in selectedAtom.display" :key="key">
                                                <th>{{ apiKeyToField[key] }}</th>
                                                <td>{{ value }}</td>
                                            </tr>
                                        </tbody>
                                    </v-table>
                                </div>
                                <h2 class="d-flex justify-center align-center mt-4">键详情</h2>
                                <v-expansion-panels v-model="bondInfoExpanded" class="mt-2"
                                    :color="isDark ? 'grey-darken-3' : 'grey-lighten-3'">
                                    <v-expansion-panel v-for="(bond, index) in selectedAtom.bonds" :key="index"
                                        :class="isDark ? 'bg-grey-darken-3' : 'bg-grey-lighten-3'">
                                        <v-expansion-panel-title>
                                            {{ `${selectedAtom.display.elem}:${selectedAtom.display.index} -
                                            ${bond.atom}:${bond.index}` }} 键
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-table density="compact"
                                                :class="isDark ? 'bg-grey-darken-3' : 'bg-grey-lighten-3'">
                                                <tbody>
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
                                                </tbody>
                                            </v-table>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                </v-expansion-panels>
                            </div>
                            <div v-if="!selectedAtom">
                                <p>请在右侧选择一个原子。</p>
                            </div>
                        </v-sheet>
                    </v-col>
                    <v-col cols="12" lg="8" class="d-flex justify-center align-center" style="height: 100%;">
                        <v-sheet style="height: 100%; width: 100%;">
                            <div id="molecule" ref="viewerdiv" style="width: 100%; height: 100%; position: relative;"
                                class="pa-0 ma-0">
                            </div>
                            <div style="position: absolute; bottom: 60px; right: 10px;">
                                <v-btn @click="toggleLabels" color="primary" class="mr-2">
                                    {{ showLabels ? '隐藏标签' : '显示标签' }}
                                </v-btn>
                                <v-btn v-if="selectedAtom" class="bg-red" @click="clearSelected()">清除选择</v-btn>
                            </div>
                        </v-sheet>
                    </v-col>
                </v-row>
            </v-card-text>
            <v-divider></v-divider>

            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn text="关闭" @click="dialog = false; clearSelected()"></v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup>
import { API } from "@/common/api";
import { ref, computed, nextTick, onMounted } from 'vue';
import SmilesImage from "@/components/SmilesImage.vue";
import ErrorDialog from "@/components/ErrorDialog";
import { useConfirm } from 'vuetify-use-dialog';
import * as Papa from "papaparse";
import { useRoute } from 'vue-router';
import DrawButton from "@/components/DrawButton"
import ModuleWorkbench from "@/components/ModuleWorkbench.vue"
import { saveAs } from "file-saver";
import * as $3Dmol from '3dmol';
import { useTheme } from '@/composables/useTheme';

const { isDark } = useTheme();

const summaryItems = [
    { label: "输入", value: "分子或反应 SMILES", icon: "mdi-flask-outline" },
    { label: "输出", value: "NPA、电荷、轨道、键参数", icon: "mdi-table-large" },
    { label: "可视化", value: "3D 结构与原子/键详情", icon: "mdi-rotate-3d" },
];

const backgroundColor = computed(() => {
    return isDark.value ? 'bg-black' : 'bg-grey-lighten-4';
});

const bondInfoExpanded = ref(null);

const showLabels = ref(true);
const viewer = ref(null);
const selectedAtom = ref(null);

const smiles = ref('');
const loading = ref(false);
const batch = ref(false);
const results = ref([]);
const pendingTasks = ref(0);
const itemsPerPage = ref(10);
const viewerdiv = ref(null);
const route = useRoute();
const selectedColumnCategories = ref([
    'NPA',
]);
const dialog = ref(false);
const currentMoleculeData = ref(null);

const columnCategories = ref({
    "NPA": ["npa_e", "npa_e_pos", "npa_e_neg", "npa_parr_func_e_pos", "npa_parr_func_e_neg"],
    "Sheilding Constant (ppm)": ["sheilding_constant_ppm"],
    "Valence": ["valence_1s", "valence_2s", "valence_2p", "valence_3s", "valence_3p", "valence_4s", "valence_4p"],
    "Bond Props": ["bond_index", "bond_length", "bond_charge"],
    "Natural Ionicity (unitless)": ["natural_ion"],
    "Dipole Moment (debye)": ["dipole_moment"],
    "Traceless Quadrupole Moment (debye⋅Å)": ["traceless"],
    "HOMO/LUMO (hartree)": ["HOMO_3_LUMO", "HOMO_3_LUMO_1", "HOMO_3_LUMO_2", "HOMO_3_LUMO_3", "HOMO_2_LUMO", "HOMO_2_LUMO_1", "HOMO_2_LUMO_2", "HOMO_2_LUMO_3", "HOMO_1_LUMO", "HOMO_1_LUMO_2", "HOMO_1_LUMO_3", "HOMO_LUMO", "HOMO_LUMO_1", "HOMO_LUMO_2", "HOMO_LUMO_3"],
    "IP (hartree)": ["IP"],
    "EA (hartree)": ["EA"]
});

const fields = ref([]);

const colorRowItem = computed(() => {
    return (item) => {
        return {
            class: {
                'highlight-row': item.item.new === results.value.length
            }
        };
    };
});

const apiKeyToField = ref({
    'index': 'index',
    'elem': 'elem',
    'smiles': 'smiles',
    "npa_e": "npa charge (e)",
    "npa_e_pos": "npa charge + (e)",
    "npa_e_neg": "npa charge - (e)",
    "npa_parr_func_e_pos": "npa parr function + (e)",
    "npa_parr_func_e_neg": "npa parr function - (e)",
    "sheilding_constant_ppm": "shielding constant (ppm)",
    "valence_1s": "1s valence orbital occupancy (e)",
    "valence_2s": "2s valence orbital occupancy (e)",
    "valence_2p": "2p valence orbital occupancy (e)",
    "valence_3s": "3s valence orbital occupancy (e)",
    "valence_3p": "3p valence orbital occupancy (e)",
    "valence_4s": "4s valence orbital occupancy (e)",
    "valence_4p": "4p valence orbital occupancy (e)",
    "bond_index": "bond index (unitless)",
    "bond_length": "bond length (Å)",
    "bond_charge": "bond charge (e)",
    "natural_ion": "natural ionicity (unitless)",
    "dipole_moment": "dipole moment (debye)",
    "traceless": "traceless quadrupole moment (debye⋅Å)",
    "HOMO_3_LUMO": "HOMO-3/LUMO (hartree)",
    "HOMO_3_LUMO_1": "HOMO-3/LUMO+1 (hartree)",
    "HOMO_3_LUMO_2": "HOMO-3/LUMO+2 (hartree)",
    "HOMO_3_LUMO_3": "HOMO-3/LUMO+3 (hartree)",
    "HOMO_2_LUMO": "HOMO-2/LUMO (hartree)",
    "HOMO_2_LUMO_1": "HOMO-2/LUMO+1 (hartree)",
    "HOMO_2_LUMO_2": "HOMO-2/LUMO+2 (hartree)",
    "HOMO_2_LUMO_3": "HOMO-2/LUMO+3 (hartree)",
    "HOMO_1_LUMO": "HOMO-1/LUMO (hartree)",
    "HOMO_1_LUMO_1": "HOMO-1/LUMO+1 (hartree)",
    "HOMO_1_LUMO_2": "HOMO-1/LUMO+2 (hartree)",
    "HOMO_1_LUMO_3": "HOMO-1/LUMO+3 (hartree)",
    "HOMO_LUMO": "HOMO/LUMO (hartree)",
    "HOMO_LUMO_1": "HOMO/LUMO+1 (hartree)",
    "HOMO_LUMO_2": "HOMO/LUMO+2 (hartree)",
    "HOMO_LUMO_3": "HOMO/LUMO+3 (hartree)",
    "IP": "IP (hartree)",
    "EA": "EA (hartree)",
});

const createConfirm = useConfirm();

const predict = () => {
    pendingTasks.value += 1
    loading.value = true
    batch.value = false
    const url = '/api/qm-descriptors/call-async'
    const body = {
        "smiles": [smiles.value
        ]
    }
    API.runCeleryTask(url, body)
        .then(output => {
            results.value.unshift(...output.result)
            results.value[0].new = results.value.length
        })
        .catch(async error => {
            const errorObj = API.toErrorObject(error, 'QM 描述符计算失败，请检查输入、模型服务和后端任务状态。')
            const isConfirmed = await createConfirm({ title: "请求失败", contentComponent: ErrorDialog, contentComponentProps: { errorObj: errorObj }, dialogProps: { width: "auto" } })
            if (!isConfirmed)
                return
        })
        .finally(() => {
            loading.value = false;
            pendingTasks.value -= 1;
        })
}

const deselectColumn = async (item) => {
    const index = selectedColumnCategories.value.indexOf(item.title);
    if (index !== -1) {
        selectedColumnCategories.value.splice(index, 1);
    }
    await nextTick()
    onSelectedCategory();

};
const toggleAllCategories = async () => {
    if (selectedColumnCategories.value.length < allfields.value.length) {
        selectedColumnCategories.value = allfields.value.map(category => category.key);
    } else {
        selectedColumnCategories.value = [];
    }
    await nextTick()
    onSelectedCategory();
};
const clear = () => {
    results.value = []
};
const onSelectedCategory = (value) => {
    if (value) {
        selectedColumnCategories.value = value
    }
    const baseFields = [
        { key: 'smiles', title: apiKeyToField.value['smiles'], sortable: true, removable: false },
        { title: '3D 可视化', key: 'actions', sortable: false, align: 'center' }
    ];
    selectedColumnCategories.value.forEach((category) => {
        columnCategories.value[category].forEach((key) => {
            baseFields.push({ key: key, title: apiKeyToField.value[key], sortable: false, removable: true });
        });
    });
    fields.value = baseFields;
};

const allfields = computed(() => {
    return Object.keys(columnCategories.value).map((key) => ({ key: key, title: key }))
})

const lastPage = computed(() => {
    return Math.ceil(results.value.length / itemsPerPage.value);
})

const downloadCSV = () => {
    if (!results.value.length) {
        alert('没有可下载的结果。')
        return
    }
    let downloadData = Papa.unparse(results.value)
    let blob = new Blob([downloadData], { type: 'data:text/csv;charset=utf-8' })
    saveAs(blob, "qm.csv")
};
const downloadJSON = () => {
    if (!results.value.length) {
        alert('没有可下载的结果。')
        return
    }
    let downloadData = JSON.stringify(results.value)
    let blob = new Blob([downloadData], { type: 'data:text/json;charset=utf-8' })
    saveAs(blob, 'qm.json')
};

const openVisualization = (rowData) => {
    currentMoleculeData.value = rowData;
    dialog.value = true;
    // Fetch SDF data and visualize
    fetchSDFfromSMILES(rowData.smiles).then(sdfData => {
        visualizeMolecule(sdfData);
    });
};

const fetchSDFfromSMILES = async (smiles) => {
    const sdf = await API.post("/api/rdkit/to-sdfile", { smiles: smiles }, true).then(async response => {
        if (!response) {
            throw new Error("Network response was not ok");
        }
        return response;  // Get the response as a Blob to handle file download
    })

    return sdf["sdf"];
}

const viewerBG = computed(() => {
    return isDark.value ? 'black' : '#f5f5f5'
})

const visualizeMolecule = (sdfData) => {
    viewer.value = $3Dmol.createViewer(viewerdiv.value, {
        backgroundColor: viewerBG.value
    });

    viewer.value.addModel(sdfData, 'sdf');
    // Set Ball-and-Stick Style
    viewer.value.setStyle({}, {
        stick: {
            radius: 0.15,  // Increased radius for better visibility
            colorscheme: 'Jmol',
            multipleBondSpacing: 0.2,  // Adjust spacing between multiple bonds
            singleBondWidth: 0.5,  // Width of single bonds
            doubleBondWidth: 0.7,  // Width of double bonds
            tripleBondWidth: 0.9,  // Width of triple bonds
        },
        sphere: { radius: 0.4, colorscheme: 'Jmol' }     // Set atom sphere radius
    });

    if (showLabels.value) {
        addLabels(viewer);
    }

    viewer.value.setClickable({}, true, function (clickedObject) {
        if (Object.prototype.hasOwnProperty.call(clickedObject, 'atom')) {
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
    if (selectedAtom.value) {
        viewer.value.setStyle({ serial: selectedAtom.value.metaData.serial }, {
            stick: {
                radius: 0.15,
                colorscheme: 'Jmol',
                multipleBondSpacing: 0.2,
                singleBondWidth: 0.5,
                doubleBondWidth: 0.7,
                tripleBondWidth: 0.9,
            }, sphere: { radius: 0.4, colorscheme: 'Jmol' }
        });

        viewer.value.render();
    }

    selectedAtom.value = null
}

const handleAtomClick = (atom) => {
    // Reset previous selection
    clearSelected()

    // Highlight new selection
    viewer.value.setStyle({ serial: atom.serial }, {
        stick: {
            radius: 0.15,
            colorscheme: 'Jmol',
            multipleBondSpacing: 0.2,
            singleBondWidth: 0.5,
            doubleBondWidth: 0.7,
            tripleBondWidth: 0.9,
        }, sphere: { radius: 0.4, color: 'yellow' }
    });

    const model = viewer.value.getModel()

    // Update selected atom data
    selectedAtom.value = {
        display: {
            index: atom.index,
            elem: atom.elem,
            npa_e: currentMoleculeData.value.npa_e[atom.index],
            npa_e_pos: currentMoleculeData.value.npa_e_pos[atom.index],
            npa_e_neg: currentMoleculeData.value.npa_e_neg[atom.index],
            npa_parr_func_e_pos: currentMoleculeData.value.npa_parr_func_e_pos[atom.index],
            npa_parr_func_e_neg: currentMoleculeData.value.npa_parr_func_e_neg[atom.index],
            sheilding_constant_ppm: currentMoleculeData.value.sheilding_constant_ppm[atom.index],
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

        bonds: atom.bonds.map(bond => ({
            atom: model.atoms[bond].elem,
            index: bond,
            bondCharge: currentMoleculeData.value.bond_charge[bond],
            bondIndex: currentMoleculeData.value.bond_index[bond],
            bondLength: currentMoleculeData.value.bond_length[bond],
        }))
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
    viewer.value.getModel().atoms.forEach(atom => {
        viewer.value.addLabel(`${atom.elem}:${atom.index}`, {
            position: { x: atom.x, y: atom.y, z: atom.z },
            backgroundColor: 'black',
            fontColor: 'white',
            fontSize: 12,
            borderThickness: 1,
            borderColor: 'darkgray',
            backgroundOpacity: 0.8,
        });
    });
};

onMounted(() => {
    onSelectedCategory();
    if (route.query.smiles) {
        smiles.value = route.query.smiles
        predict();
    }
});
</script>

<style scoped>
:deep(.highlight-row) {
    background-color: #e0f7fa !important;
    padding: 10px !important;
    transition: background-color 0.3s ease !important;
}

:deep(.highlight-row td:first-child) {
    border-left: 4px solid #00796b;
}

.v-theme--dark {
    :deep(.highlight-row td:first-child) {
        border-left: 4px solid #80cbc4;
    }

    :deep(.highlight-row) {
        background-color: #004d40 !important;
        padding: 10px !important;
        transition: background-color 0.3s ease !important;
    }
}
</style>
