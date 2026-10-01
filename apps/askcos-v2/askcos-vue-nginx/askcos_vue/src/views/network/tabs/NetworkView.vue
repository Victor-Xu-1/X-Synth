<template>
  <v-sheet>
    <v-toolbar density="compact" class="network-command-toolbar">
      <v-progress-linear :active="pendingTasks !== 0" :indeterminate="pendingTasks !== 0" absolute location="bottom"
        color="primary"></v-progress-linear>
      <v-container fluid>
        <v-row class="justify-center align-center">
          <v-col cols="12" md="10" sm="12">
            <v-text-field v-model="resultsStore.target" density="compact" variant="outlined" label="目标结构"
              placeholder="SMILES" type="text" clearable hide-details prepend-inner-icon="mdi mdi-flask"
              min-width="100px" rounded="pill" data-cy="ipp-searchbar" class="network-target-field">
              <template v-slot:prepend>
                <v-tooltip max-width="200px" location="bottom">
                  <template v-slot:activator="{ props }" v-if="enableResolver">
                    <v-btn v-bind="props" icon="mdi mdi-server" :class="allowResolve ? 'text-primary' : 'text-grey'"
                      data-cy="IPP-NIH-resolver" @click="toggleResolver">
                    </v-btn>
                  </template>
                  <p v-if="!!allowResolve">NIH 名称解析已开启，结构可能发送到外部服务。可在设置中关闭，也可点击此图标切换。</p>
                  <span v-else>NIH 名称解析已关闭，结构不会发送到外部服务。目标查询必须是 SMILES，可在设置中开启或点击此图标切换。</span>
                </v-tooltip>
              </template>
              <template v-slot:append-inner>
                <v-btn variant="tonal" size="small" prepend-icon="mdi-pencil" @click="showKetcherModal()"
                  rounded="pill">绘制</v-btn>
              </template>
            </v-text-field>
            <div class="network-actions">
              <v-btn variant="flat" color="primary" prepend-icon="mdi mdi-play"
                data-cy="ipp-one-step" :disabled="!resultsStore.target" @click="changeTarget">一步逆合成</v-btn>
              <v-btn-group density="compact" color="primary" divided>
                <v-btn prepend-icon="mdi mdi-family-tree" id="tb-submit" @click="sendTreeBuilderJob"
                  data-cy="ipp-build-tree" :disabled="!resultsStore.target">构建路线树</v-btn>
                <v-menu location="bottom" id="tb-submit-settings" :close-on-content-click="false">
                  <template v-slot:activator="{ props }">
                    <v-btn v-bind="props" data-cy="build-tree-drop-down" icon="mdi mdi-menu-down" />
                  </template>
                  <v-card width="auto" min-width="250px">
                    <v-text-field v-model="tb.taskName" label="任务名称/描述" data-cy="job-name-description"
                      variant="outlined" hide-details class="pa-3" density="compact"></v-text-field>
                    <v-divider class="ma-2" :thickness="2"></v-divider>
                    <p class="text-subtitle-2 pl-3">质量策略</p>
                    <v-list density="compact">
                      <v-list-item v-for="(value, name) in tb.modes" :key="name" @click="applyTbPreset(name)">
                        <v-row align="center">
                          <v-col cols="auto">
                            <v-list-item-title>
                              {{ value.label }}
                              <v-icon class="ml-1 mb-2" icon="mdi-check"
                                v-show="selectedMode === value.label"></v-icon>
                            </v-list-item-title>
                          </v-col>
                        </v-row>
                      </v-list-item>
                    </v-list>
                    <v-divider class="ma-2" :thickness="2"></v-divider>
                    <v-btn variant="plain" @click="settingsVisible = true">高级设置...</v-btn>
                  </v-card>
                </v-menu>
              </v-btn-group>
              <v-btn variant="flat" color="yellow-darken-4" prepend-icon="mdi mdi-application-import"
                data-cy="ipp-import-network" @click="showImportNetwork = true">导入网络</v-btn>
            </div>
          </v-col>
        </v-row>
        <v-row class="justify-center align-center"><span class="text-overline">当前模型：</span>
          <div v-if="strategies.length !== 0" class="pa-0 slider" data-cy="ipp-models-bar">
            <v-slide-group show-arrows>
              <v-slide-group-item v-for="(strategy, idx) in strategies" :key="idx">
                <v-chip class="text-body-1 mr-1">
                  {{ replaceString(strategy.retro_backend) }} {{ "(" + replaceString(strategy.retro_model_name) + ")" }}
                </v-chip>
              </v-slide-group-item>
            </v-slide-group>
          </div>
          <div v-else>
            <v-chip class="text-body-1 mr-1" color="error" data-cy="ipp-models-bar">
              未添加策略
            </v-chip>
          </div>
          <v-btn variant="tonal" color="primary" prepend-icon="mdi mdi-cog" @click="settingsVisible = true"
            data-cy="ipp-strategy-settings">策略设置</v-btn>
        </v-row>
      </v-container>
    </v-toolbar>
    <div v-if="!isCanvasEmpty">
      <div id="network" class="open-toolbar" ref="network"></div>
      <div v-if="treeViewEnabled" id="tree-view-overlay">
        <v-btn-group variant="outlined" density="comfortable" divided :border="true">
          <v-btn icon="mdi mdi-chevron-double-left" @click="changeTreeIndex('first')"
            data-cy="ipp-enumerate-pathways-double-left" :disabled="!treeViewEnabled"></v-btn>
          <v-btn icon="mdi mdi-chevron-left" @click="changeTreeIndex('prev')" :disabled="!treeViewEnabled"
            data-cy="ipp-enumerate-pathways-left"></v-btn>
          <v-btn variant="tonal" data-cy="ipp-tree-count">路线树 {{ treeViewEnabled ?
            `${currentTreeIndex
            + 1} / ${trees.length}` : "不适用" }}</v-btn>
          <v-btn icon="mdi mdi-chevron-right" @click="changeTreeIndex('next')" :disabled="!treeViewEnabled"
            data-cy="ipp-enumerate-pathways-right"></v-btn>
          <v-btn icon="mdi mdi-chevron-double-right" @click="changeTreeIndex('last')"
            data-cy="ipp-enumerate-pathways-double-right" :disabled="!treeViewEnabled"></v-btn>
        </v-btn-group>
        <div>
          <v-btn variant="outlined" block size="small" class="my-2" :disabled="currentTreeVisible"
            data-cy="ipp-add-tree-to-network" @click="resultsStore.addTreeToDispGraph(currentTree)">加入完整路线树</v-btn>
          <v-btn variant="outlined" block size="small" class="my-2" :disabled="!currentTreeVisible"
            data-cy="download-tree-to-device" @click="downloadEnumeratedTree()">下载高亮路线树</v-btn>
        </div>
        <div v-if="currentTreeData">
          <table class="text-left">
            <tr v-for="(value, key) in currentTreeData" :key="key">
              <th class="px-1">{{ key }}</th>
              <td class="px-1">{{ Number.isInteger(value) ? value : num2str(value) }}</td>
            </tr>
          </table>
        </div>
      </div>
      <div v-if="highlightViewEnabled" id="tree-view-overlay">
        <p>按条件高亮节点</p>
        <v-select class="mt-2" clearable chips label="条件" :items="[{ title: '可采购', value: 'Buyables' }]" variant="outlined"
          density="compact" hide-details v-model="selectedCondition"></v-select>
        <v-select v-if="selectedCondition" class="mt-2" clearable chips multiple label="可采购来源"
          :items="buyablesSources" variant="outlined" density="compact" hide-details v-model="selectedBuyables"
          @update:modelValue="highlightNodes"></v-select>
      </div>
      <div class="canvas-btn d-flex flex-column flex-gap-2 align-items-center">
        <v-tooltip location="end">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" :disabled="isCanvasEmpty" @click="saveImage" density="compact" icon="mdi-camera"
              data-cy="ipp-screenshot" variant="tonal" elevation="2"
              :color="isDark ? 'grey-lighten-2' : 'grey-darken-2'">
            </v-btn>
          </template>
          <span>截图</span>
        </v-tooltip>
        <v-tooltip location="end">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" :disabled="isCanvasEmpty" id="hierarchical-button" @click="toggleHierarchical"
              data-cy="ipp-hier-button" density="compact" icon="mdi-plus" variant="tonal" elevation="2"
              :color="isDark ? 'grey-lighten-2' : 'grey-darken-2'">
              {{ settingsStore.visjsOptions.layout.hierarchical.enabled ? "H" : "G" }}
            </v-btn>
          </template>
          <span>树/图视图</span>
        </v-tooltip>
        <v-tooltip location="end">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" :disabled="isCanvasEmpty" id="center-graph-button" @click="centerGraph"
              data-cy="ipp-center-canvas" density="compact" icon="mdi-fit-to-screen-outline" variant="tonal"
              elevation="2" :color="isDark ? 'grey-lighten-2' : 'grey-darken-2'">
            </v-btn>
          </template>
          <span>居中画布</span>
        </v-tooltip>
      </div>
      <div class="result-btn d-flex justify-content-center align-items-center flex-gap-2">
        <v-btn id="clear-reactions-btn" @click="clear()" title="清空全部结果" size="small" color="red-darken-2"
          data-cy="ipp-clear-result" prepend-icon="mdi mdi-close-circle">
          清空结果 </v-btn>
        <v-menu location="top">
          <template v-slot:activator="{ props }">
            <v-btn color="primary" size="small" v-bind="props" prepend-icon="mdi mdi-content-save"
              data-cy="ipp-save-results">
              保存结果
            </v-btn>
          </template>
          <v-list data-cy="ipp-save-location">
            <v-list-item @click="showDownloadNetwork = true">本机</v-list-item>
            <v-list-item @click="resultDialogVisible = true">我的账号</v-list-item>
          </v-list>
        </v-menu>
      </div>
      <div class="highlight-btn d-flex flex-column align-items-center justify-items-center flex-gap-2">
        <v-tooltip location="end">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" :disabled="isCanvasEmpty" title="枚举到起始原料的路线"
              data-cy="ipp-enumerate-pathways" density="compact" icon="mdi mdi-map-marker-path" variant="tonal"
              elevation="2" :color="isDark ? 'grey-lighten-2' : 'grey-darken-2'" @click="showEnumeratePaths = true">
            </v-btn>
          </template>
          <span>枚举到起始原料的路线</span>
        </v-tooltip>
        <v-tooltip location="end">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" :disabled="isCanvasEmpty" title="开启/关闭路线枚举"
              data-cy="ipp-highlight-pathways" density="compact" icon="mdi mdi-marker" variant="tonal"
              :color="treeViewEnabled ? 'primary' : (isDark ? 'grey-lighten-2' : 'grey-darken-2')" elevation="2"
              @click="treeViewEnabled = !treeViewEnabled">
            </v-btn>
          </template>
          <span>路线枚举开关</span>
        </v-tooltip>
        <v-tooltip location="end">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" :disabled="isCanvasEmpty" title="按指定条件高亮节点"
              data-cy="ipp-highlight-nodes" density="compact" icon="mdi mdi-select" variant="tonal"
              :color="highlightViewEnabled ? 'primary' : (isDark ? 'grey-lighten-2' : 'grey-darken-2')" elevation="2"
              @click="highlightViewEnabled = !highlightViewEnabled">
            </v-btn>
          </template>
          <span>高亮指定节点</span>
        </v-tooltip>
      </div>
      <network-legend></network-legend>
    </div>
    <div v-else class="d-flex justify-center pa-16">
      <div v-if="!!resultsStore.target && !allowResolve">
        <smiles-image :smiles="resultsStore.target"></smiles-image>
        <p class="text-body-1">
          可对该目标执行“一步逆合成”或“构建路线树”。
        </p>
      </div>
      <div v-else class="text-center">
        <v-img :width="400" cover :src="emptyCanvas" class="mb-3"></v-img>
        <h2>画布为空</h2>
        <p class="text-body-1">请输入目标结构并运行预测。</p>
      </div>
    </div>
  </v-sheet>

  <v-dialog v-model="showEnumeratePaths" width="auto">
    <v-card>
      <v-card-title>枚举路线</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <p class="mb-2">系统会基于当前路线树设置枚举到终端前体的路线，最多输出 10 条闭合路线。</p>
        <p>将使用以下设置：</p>
        <v-list class="mb-2">
          <v-list-item prepend-icon="mdi mdi-circle-small" min-height="0px">后台最大深度保护</v-list-item>
          <v-list-item prepend-icon="mdi mdi-circle-small" min-height="0px">最多输出闭合路线数：10</v-list-item>
          <v-list-item prepend-icon="mdi mdi-circle-small" min-height="0px">可采购来源</v-list-item>
          <v-list-item prepend-icon="mdi mdi-circle-small" min-height="0px">可采购逻辑</v-list-item>
          <v-list-item prepend-icon="mdi mdi-circle-small" min-height="0px">化合物价格逻辑和最高价格</v-list-item>
          <v-list-item prepend-icon="mdi mdi-circle-small" min-height="0px">化合物 SCScore 逻辑和最高 SCScore</v-list-item>
          <v-list-item prepend-icon="mdi mdi-circle-small" min-height="0px">化合物流行度逻辑和最低出现次数</v-list-item>
        </v-list>
        <v-checkbox v-model="useDispNodesOnly"
          label="仅在当前网络视图显示的结果中搜索"></v-checkbox>
        <v-alert text="暂不支持化学属性条件。" type="info" class="mb-2"></v-alert>
        <v-alert v-if="trees.length" text="继续枚举会清空已有路线树。"
          type="warning"></v-alert>
      </v-card-text>
      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="showEnumeratePaths = false">取消</v-btn>
        <v-btn color="primary" @click="() => { showEnumeratePaths = false; enumerateTrees() }">确定</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="resultDialogVisible" max-width="600px" persistent>
    <v-card>
      <v-card-title class="headline">保存交互式路线网络</v-card-title>
      <v-card-text>
        <v-text-field v-model="savedResultDescription" label="描述" outlined id="description"></v-text-field>
        <v-combobox v-model="savedResultTags" label="标签" outlined chips multiple small-chips :deletable-chips="true"
          :clearable="true" hint="输入后按 Enter 添加标签" persistent-hint id="tags"></v-combobox>
        <template v-if="!!resultsStore.savedResultInfo.id">
          <template v-if="resultsStore.savedResultInfo.type === 'ipp'">
            <v-checkbox v-model="savedResultOverwrite" label="覆盖已有结果" class="my-3"></v-checkbox>
            <v-alert v-if="savedResultOverwrite" dense type="info">此前保存的结果版本会被覆盖。</v-alert>
            <v-alert v-else dense type="info">将创建新的保存结果。</v-alert>
          </template>
          <template v-else>
            <v-alert dense type="info">将基于当前路线树结果创建新的交互式路线规划结果。</v-alert>
          </template>
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="red darken-1" text @click="resultDialogVisible = false" id="cancel">取消</v-btn>
        <v-btn color="primary" text @click="saveResult" id="save">保存</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="showImportNetwork" width="auto" min-width="500px">
    <v-card>
      <v-card-title>加载网络 JSON</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-file-input label="文件" variant="outlined" v-model="uploadFile"
          data-cy="ipp-file-input"></v-file-input>
      </v-card-text>
      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="showImportNetwork = false" data-cy="ipp-cancel-file-input">取消</v-btn>
        <v-btn color="primary" :disabled="!uploadFile" @click="() => { showImportNetwork = false; load() }"
          data-cy="ipp-load-file-input">加载</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="showDownloadNetwork" width="auto" min-width="500px">
    <v-card>
      <v-card-title>保存网络 JSON</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-text-field label="文件名" variant="outlined" hide-details density="compact"
          v-model="downloadName"></v-text-field>
      </v-card-text>
      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="showDownloadNetwork = false" data-cy="ipp-download-network-cancel">取消</v-btn>
        <v-btn color="primary" @click="() => { showDownloadNetwork = false; download() }"
          data-cy="ipp-download-network-save">保存</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <NodeDetail :visible="tabActive && nodeDetailVisible" :enable-resolver="enableResolver" :selected="selected"
    :template-sets="templateSetsList" @close="closeNodeDetail" @expandNode="expandNode"
    @updatePendingTasks="pendingTasksHandler" @selectAllOccur="selectAllOccur" @deleteChoice="deleteChoice"
    @collapseNode="collapseNode" ref="node-detail" />

  <SettingsModal :visible="settingsVisible" @update:settingsVisible="settingsVisible = $event"
    :template-attributes="templateAttributes" :template-sets="templateSets" @changeNetopt="updateNetworkOptions" />
  <ketcher-modal ref="ketcherRef" v-model="showKetcher" :smiles="resultsStore.target" @input="showKetcher = false"
    @update:smiles="(ketcherSmiles) => resultsStore.target = ketcherSmiles" />

  <v-snackbar v-model="snackbar" vertical>
    <p>路线树任务已完成，可前往结果页查看闭合路线数量和详情。</p>
    <v-btn :href="`/network?tab=TE&id=${this.treeID}`" variant="outlined" class="text-white">
      查看结果
    </v-btn>
    <template v-slot:actions>
      <v-btn color="white" variant="text" @click="snackbar = false" class="text-white">
        关闭
      </v-btn>
    </template>
  </v-snackbar>

  <v-snackbar v-model="snackbarIPP" vertical>
    <p>交互式路线规划任务已完成。</p>
    <v-btn :to="`/network?tab=IPP`" @click="snackbarIPP = false" variant="outlined" class="text-white">
      查看路线规划
    </v-btn>
    <template v-slot:actions>
      <v-btn color="white" variant="text" @click="snackbarIPP = false" class="text-white">
        关闭
      </v-btn>
    </template>
  </v-snackbar>
</template>

<script>
import { v4 as uuidv4, NIL as NIL_UUID } from "uuid";
import { makeChemicalDisplayNode } from "@/views/network/visualization";
import emptyCanvas from "@/assets/emptyCanvas.svg";
import { API } from "@/common/api";
import { getMolImageUrl } from "@/common/drawing";
import { TB_PRESETS } from "@/common/tb-presets";
import {
  UNIFIED_ROUTE_ENDPOINT,
  buildUnifiedRouteRequestBody,
  unifiedRouteStatusEndpoint,
} from "@/common/unified-route";
import {
  FINAL_ROUTE_OUTPUT_MAX,
  applyHighQualityRoutePolicy,
} from "@/common/tree-quality-policy";
import { num2str, getFromStorage, storageAvailable } from "@/common/utils";
import SmilesImage from "@/components/SmilesImage";
import { mapStores } from "pinia";
import { useResultsStore } from "@/store/results";
import { useSettingsStore } from "@/store/settings";
import dayjs from "dayjs";
import { Network } from "vis-network";
import { getPaths } from "@/common/graph";
import { useConfirm, useSnackbar } from 'vuetify-use-dialog';
import NodeDetail from "@/components/network/NodeDetail";
import SettingsModal from "@/components/network/SettingsModal";
import { interpolateHexColor } from "@/common/color";
import { saveAs } from "file-saver";
import KetcherModal from "@/components/KetcherModal";
import NetworkLegend from "@/components/network/NetworkLegend";
import { resolveChemName } from "@/common/resolver";
import { useConfigStore } from "@/store/config";
import { useTheme } from "@/composables/useTheme";

const BG_OPACITY = 0.2; // Background opacity
const edgeScaling = (min, max, total, value) =>
  value >= 0.25 ? 1.0 : 16 * value * value;
export default {
  name: "NetworkView",
  components: {
    SmilesImage,
    NodeDetail,
    SettingsModal,
    KetcherModal,
    NetworkLegend,
  },
  props: {
    tabActive: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const createConfirm = useConfirm()
    const createSnackbar = useSnackbar()
    const configStore = useConfigStore()
    const { isDark } = useTheme()
    return {
      createConfirm,
      createSnackbar,
      configStore,
      isDark
    }
  },
  data() {
    return {
      newTag: '', // For inputting new tags
      selectedMode: null,
      treeID: null,
      snackbar: false,
      snackbarIPP: false,
      visible: true,
      treeBuilderModalShow: false,
      networkInitialized: false,
      treeViewEnabled: false,
      highlightViewEnabled: false,
      buyablesSources: [],
      selectedCondition: null,
      selectedBuyables: [],
      useDispNodesOnly: false,
      currentTreeIndex: 0,
      templateSets: {},
      templateAttributes: {},
      templateSetsList: [],
      invertAtomFilter: false,
      showSettingsModal: false,
      showLoadModal: false,
      showDownloadModal: false,
      showClusterPopoutModal: false,
      showClusterEditModal: false,
      showAddNewPrecursorModal: false,
      showSaveModal: false,
      showEnumeratePaths: false,
      showImportNetwork: false,
      showDownloadNetwork: false,
      showKetcher: false,
      downloadName: "network.json",
      tb: {
        modes: TB_PRESETS,
        taskId: "",
        taskName: "",
      },
      selected: null,
      nodeDetailVisible: false,
      settingsVisible: false,
      pendingTasks: 0, // Counter for displaying loading spinner
      infoPanelOptions: {
        id: "infoPanel",
        headerTitle: "路线树信息",
        headerControls: {
          size: "sm",
          close: "remove",
          maximize: "remove",
          normalize: "remove",
          minimize: "remove",
        },
        position: { my: "left-top", at: "left-top", of: "#network" },
        panelSize: { width: 250, height: 280 },
      },
      uploadFile: null,
      isCanvasEmpty: true,
      validSmiles: true,
      emptyCanvas: emptyCanvas.replace(/fill="white"/g, 'fill="#E0E0E0"'),
      resultDialogVisible: false,
    };
  },
  created() {
    this.$router.beforeEach(() => {
      this.nodeDetailVisible = false;
      this.selected = null;
    })
    // Prompt user before going back to previous page
    window.addEventListener("beforeunload", (e) => {
      if (this.resultsStore.dataGraph.nodes.length) {
        e.stopImmediatePropagation();
        // Cancel the event
        // e.preventDefault(); // If you prevent default behavior in Mozilla Firefox prompt will always be shown
        // Chrome requires returnValue to be set
        // e.returnValue = "";
      }
    });

    API.get("/api/template/sets/", null, false).then((json) => {
      this.templateAttributes = json.attributes;
      this.templateSetsList = json["template_sets"];
      for (let templateSet of this.templateSetsList) {
        this.templateSets[templateSet] = [1];
      }
    });

    API.get('/api/buyables/sources', null, false)
      .then(json => {
        this.buyablesSources = json.sources
      });


    this.loadTarget();
    this.loadAllSettings();
    let urlParams = new URLSearchParams(window.location.search);
    let resultID = urlParams.get("id");
    if (resultID) {
      this.isCanvasEmpty = false;
      return;
    }
    let urlTarget = urlParams.get("target");
    if (urlTarget) {
      this.resultsStore.target = urlTarget;
    }
    let run = urlParams.get("run");
    if (run && JSON.parse(run)) {
      this.changeTarget();
    }

  },
  computed: {
    enableResolver() {
      return this.configStore.envs.VITE_ENABLE_SMILES_RESOLVER === 'True';
    },
    showLoader() {
      return this.pendingTasks > 0;
    },
    currentTree() {
      return this.trees[this.currentTreeIndex];
    },
    currentTreeData() {
      if (this.currentTree) {
        const props = this.currentTree["graph"];
        const data = {
          "深度": props["depth"],
          "反应数": props["num_reactions"],
          "平均可行性": props["avg_plausibility"],
          "最低可行性": props["min_plausibility"],
          "平均模板得分": props["avg_score"],
          "最低模板得分": props["min_score"],
        };
        if (props["precursor_cost"] !== undefined) {
          data["前体总成本"] = props["precursor_cost"];
        }
        if (props["atom_economy"] !== undefined) {
          data["整体原子经济性"] = props["atom_economy"];
        }

        if (props["pmi"] !== undefined) {
          data["Avg. PMI"] = props["pmi"];
        }

        return data;
      } else {
        return null;
      }
    },
    currentTreeVisible() {
      // Whether the current tree is fully visible in the display graph
      if (!this.trees.length) {
        return false;
      }
      const nodes = this.currentTree["nodes"];
      return nodes.every((node) => {
        return this.resultsStore.dispGraph.nodes.get(node["id"]) !== null;
      });
    },
    allowCluster: {
      get() {
        return this.settingsStore.allowCluster;
      },
      set(value) {
        this.settingsStore.allowCluster = value;
      },
    },
    allowResolve: {
      get() {
        return this.settingsStore.allowResolve;
      },
      set(value) {
        this.settingsStore.allowResolve = value;
      },
    },
    trees: {
      get() {
        return this.resultsStore.trees;
      },
      set(value) {
        this.resultsStore.setTrees(value);
      },
    },
    savedResultDescription: {
      get() {
        return this.resultsStore.savedResultInfo.description;
      },
      set(value) {
        this.resultsStore.updateSavedResultInfo({ description: value });
      },
    },
    savedResultTags: {
      get() {
        return this.resultsStore.savedResultInfo.tags;
      },
      set(value) {
        this.resultsStore.updateSavedResultInfo({ tags: value });
      },
    },
    savedResultOverwrite: {
      get() {
        return this.resultsStore.savedResultInfo.overwrite;
      },
      set(value) {
        this.resultsStore.updateSavedResultInfo({ overwrite: value });
      },
    },
    strategies: {
      get() {
        return this.settingsStore.interactive_path_planner_settings.retro_backend_options;
      },
      set(value) {
        this.settingsStore.interactive_path_planner_settings.retro_backend_options = value;
      },
    },
    edgeColor() {
      return this.isDark ? '#CCCCCC' : '#000000'
    },
    ...mapStores(useResultsStore, useSettingsStore),
  },
  methods: {
    highlightNodes() {
      let selectNodes = [];
      if (this.selectedCondition === 'Buyables') {
        this.resultsStore.dispGraph.getChemicalNodes().forEach((cur_node) => {
          let nodeData = this.resultsStore.dataGraph.nodes.get(cur_node.smiles);
          if (this.selectedBuyables.includes(nodeData.source)) {
            selectNodes.push(cur_node.id)
          }
        });
      }
      this.network.selectNodes(selectNodes);
    },
    downloadEnumeratedTree() {
      let blob = new Blob([JSON.stringify(this.currentTree)], { type: "data:text/json;charset=utf-8", });
      saveAs(blob, "treeResults.json");
    },
    replaceString(string) {
      return string.toLowerCase().replace(/_/g, ' ')
    },
    addTag() {
      if (this.newTag.trim()) {
        this.savedResultTags.push(this.newTag.trim());
        this.newTag = '';
      }
    },
    removeTag(index) {
      this.savedResultTags.splice(index, 1);
    },
    createNetwork({ options, callback }) {
      const network = new Network(this.$refs.network, this.resultsStore.dispGraph, options);
      callback(network);
    },
    initializeNetwork() {
      this.pendingTasks += 1;
      // Use a callback so that Network creation is performed as a mutation in the results store
      // Otherwise, the dataset would be mutated outside of the result store
      // Also, note that this.network cannot be initialized in data as a reactive property
      // Otherwise, vue reactivity interferes with vis-network physics and event handlers
      this.createNetwork({
        options: JSON.parse(JSON.stringify(this.settingsStore.visjsOptions)),
        callback: (network) => {
          this.network = network;
        },
      });
      // this.network.on("dragStart", this.clearSelection);
      this.network.on("zoom", this.clearSelection);
      this.network.on("selectNode", this.showNodeDetail);
      this.network.on('doubleClick', this.expandNode)
      this.network.on("deselectNode", this.clearSelection);
      this.network.once("afterDrawing", () => {
        this.networkInitialized = true;
        this.pendingTasks -= 1;
      });
      Object.assign(window, {
        visNetwork: this.network,
      });
    },
    checkCanvasEmpty() {
      // Getting the current canvas element
      const canvas = document.getElementsByTagName("canvas")[0];
      if (canvas === undefined) {
        return true;
      }
      // Creating new canvas element to get white background
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      if (canvas.toDataURL() === tempCanvas.toDataURL()) {
        return true;
      }
      return false;
    },
    saveImage() {
      // Getting the current canvas element
      const canvas = document.getElementsByTagName("canvas")[0];
      if (canvas === undefined) {
        this.createConfirm({ title: '提示', content: '当前还没有可导出为 PNG 的路线树。', dialogProps: { width: "auto" } })
        return;
      }
      // Creating new canvas element to get white background
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      if (canvas.toDataURL() === tempCanvas.toDataURL()) {
        this.createConfirm({ title: '提示', content: '交互式路线规划画布为空。', dialogProps: { width: "auto" } })
        return;
      }
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.fillStyle = "#ffffff";
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      // Copy the original canvas
      tempCtx.drawImage(canvas, 0, 0);
      // Get the downloadable link
      const tempDataURL = tempCanvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = "network.png";
      link.href = tempDataURL;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    centerGraph() {
      if (this.network) {
        this.network.fit({
          animation: {
            duration: 1000,
            easingFunction: "easeInOutQuad",
          }
        }
        );
      }
    },
    saveTarget() {
      if (!storageAvailable("localStorage")) return;
      localStorage.setItem("target", this.resultsStore.target);
    },
    loadTarget() {
      if (!storageAvailable("localStorage")) return;
      const target = localStorage.getItem("target");
      if (!target) return;
      this.resultsStore.target = target;
    },
    getAllSettings() {
      return {
        network: this.settingsStore.visjsUserOptions,
        interactive_path_planner: this.settingsStore.interactive_path_planner_settings,
        tree_builder: this.settingsStore.tree_builder_settings,
        tb: this.settingsStore.tbSettings,
        ipp: this.settingsStore.ippSettings,
      };
    },
    saveAllSettings() {
      if (!storageAvailable("localStorage")) return;
      const settings = this.getAllSettings();
      localStorage.setItem(
        "visjsOptions",
        encodeURIComponent(JSON.stringify(settings.network))
      );
      localStorage.setItem(
        "interactive_path_planner_settings",
        encodeURIComponent(JSON.stringify(settings.interactive_path_planner))
      );
      localStorage.setItem(
        "tree_builder_settings",
        encodeURIComponent(JSON.stringify(settings.tree_builder))
      );
      localStorage.setItem(
        "tbSettings",
        encodeURIComponent(JSON.stringify(settings.tb))
      );
      localStorage.setItem(
        "ippSettings",
        encodeURIComponent(JSON.stringify(settings.ipp))
      );
    },
    setAllSettings(obj) {
      this.settingsStore.setVisjsOptions(obj["network"]);
      this.settingsStore.setTbSettings(obj["tb"]);
      this.settingsStore.setIppSettings(obj["ipp"]);
      this.settingsStore.setTreeBuilderSettings(obj["tree_builder"]);
      this.settingsStore.setInteractivePathPlannerSettings(obj["interactive_path_planner"]);
    },
    loadAllSettings() {
      if (!storageAvailable("localStorage")) return;
      const settings = {
        network: getFromStorage("visjsOptions"),
        tb: getFromStorage("tbSettings"),
        ipp: getFromStorage("ippSettings"),
        tree_builder: getFromStorage('tree_builder_settings'),
        interactive_path_planner: getFromStorage('interactive_path_planner_settings')
      };
      this.setAllSettings(settings);
    },
    handleResize() {
      this.window.width = window.innerWidth;
      this.window.height = window.innerHeight;
    },
    applyTbPreset(mode) {
      if (Object.keys(this.tb.modes).includes(mode)) {
        this.settingsStore.tree_builder_settings.build_tree_options.expansion_time = this.tb.modes[mode].settings.expansionTime
        this.settingsStore.tree_builder_settings.build_tree_options.max_branching = this.tb.modes[mode].settings.maxBranching
        this.settingsStore.tree_builder_settings.expand_one_options.template_max_cum_prob = this.tb.modes[mode].settings.maxCumProb
        this.settingsStore.tree_builder_settings.expand_one_options.template_max_count = this.tb.modes[mode].settings.numTemplates
        this.settingsStore.tree_builder_settings.build_tree_options.max_depth = this.tb.modes[mode].settings.maxDepth
        this.settingsStore.interactive_path_planner_settings.fast_filter_threshold = this.tb.modes[mode].settings.minPlausibility
        this.settingsStore.tree_builder_settings.build_tree_options.return_first = this.tb.modes[mode].settings.returnFirst
        this.settingsStore.tree_builder_settings.build_tree_options.max_trees = this.tb.modes[mode].settings.maxTrees
        this.settingsStore.tree_builder_settings.enumerate_paths_options.max_paths = this.tb.modes[mode].settings.finalRouteOutputMax || FINAL_ROUTE_OUTPUT_MAX
        this.settingsStore.tree_builder_settings.enumerate_paths_options.sorting_metric = this.tb.modes[mode].settings.sortingMetric || "score"
        this.settingsStore.tree_builder_settings.enumerate_paths_options.score_trees = this.tb.modes[mode].settings.scoreTrees !== false
        this.settingsStore.tree_builder_settings.enumerate_paths_options.cluster_trees = this.tb.modes[mode].settings.clusterTrees !== false
        this.selectedMode = (this.tb.modes[mode].label)
      }
    },
    isTbQuickSettingsMode(mode) {
      // Check if current settings matches the specified preset
      // Note: does not properly compare values which are arrays (currently not applicable)
      for (const [key, val] of Object.entries(this.tb.modes[mode].settings)) {
        if (this.settingsStore.tbSettings[key] !== val) {
          return false;
        }
      }
      return true;
    },
    sendTreeBuilderJob() {
      if (this.settingsStore.interactive_path_planner_settings.retro_backend_options.length === 0) {
        this.createConfirm({ title: "操作未完成", content: "请至少添加一个逆合成策略。", dialogProps: { width: "auto" } })
        return;
      }
      if (this.tb.taskName === "") {
        this.tb.taskName = this.resultsStore.target;
      }
      this.validatesmiles(this.resultsStore.target, !this.allowResolve)
        .then((isvalidsmiles) => {
          if (isvalidsmiles) {
            return this.resultsStore.target;
          } else {
            return this.resolveChemName(this.resultsStore.target);
          }
        })
        .then((smiles) => {
          this.resultsStore.target = smiles;
          this.mctsTreeBuilderAPICall();
          this.tb.taskName = ""
        })
        .catch((error) => {
          let error_msg = error.message || error || "未知错误";
          this.createConfirm({ title: '任务提交失败', content: "按当前设置提交路线树任务时出错：" + error_msg, dialogProps: { width: "auto" } })
        });
    },
    sleep(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    },
    async pollSynonUnifiedRouteJob(jobId) {
      for (let attempt = 0; attempt < 720; attempt += 1) {
        const status = await API.get(unifiedRouteStatusEndpoint(jobId), null, false);
        if (status.status === "completed") {
          return status;
        }
        if (status.status === "failed") {
          throw new Error(JSON.stringify({
            detail: status.message || "统一路线池任务失败，请检查 ASKCOS、AiZynthFinder 和可采购数据源。",
          }));
        }
        await this.sleep(10000);
      }
      throw new Error(JSON.stringify({
        detail: "统一路线池仍在运行，请稍后到结果页面刷新查看。",
      }));
    },
    mctsTreeBuilderAPICall() {
      this.saveAllSettings();
      this.saveTarget();
      const body = {
        smiles: this.resultsStore.target,
        description: this.tb.taskName || this.resultsStore.target
      };
      Object.assign(body, this.settingsStore.tree_builder_settings);
      Object.assign(body.expand_one_options, this.settingsStore.interactive_path_planner_settings)
      applyHighQualityRoutePolicy(body);
      delete body.expand_one_options.group_by_strategy;
      delete body.expand_one_options.fast_filter_threshold;
      // checkTemplatePrioritizers(body["template_prioritizers"]);
      API.post(UNIFIED_ROUTE_ENDPOINT, buildUnifiedRouteRequestBody(body))
        .then(async (json) => {
          const jobId = json?.job_id || json?.task_id || json;
          this.tb.taskId = jobId;
          this.createConfirm({ title: '提交成功', content: '统一路线池任务已提交，ASKCOS 与 AiZynthFinder 会并行搜索并写回结果列表。', dialogProps: { width: "auto" } })
          const output = await this.pollSynonUnifiedRouteJob(jobId);
          this.treeID = output.askcos_task_id || output.summary?.askcos_task_id || null
          return output
        })
        .then(() => {
          this.snackbar = true;
        })
        .catch((error) => {
          console.error(error);
          const errorObj = API.toErrorObject(error, '网络请求失败，请检查输入、模型服务和后端任务状态。')
          this.createConfirm({ title: '任务提交失败', content: "按当前设置提交路线树任务时出错：" + (errorObj.detail || errorObj.string_error), dialogProps: { width: "auto" } })
          this.createSnackbar({ text: "任务失败。请检查输入和服务状态后重新提交。", snackbarProps: { timeout: -1, vertical: true } })
        });
    },
    resolveChemName(name) {
      if (this.enableResolver && this.allowResolve) {
        return resolveChemName(name);
      } else {
        throw Error(
          "当前不允许使用外部服务解析化学名称。"
        );
      }
    },
    async validatesmiles(smiles, iswarning) {
      const json = await API.post("/api/rdkit/validate/", {
        smiles: smiles,
      });
      if (!json["correct_syntax"]) {
        if (iswarning) {
          await this.createConfirm({ title: '操作未完成', content: '输入的 SMILES 无效：语法错误', dialogProps: { width: "auto" } });
        }
        return false;
      } else if (!json["valid_chem_name"]) {
        if (iswarning) {
          await this.createConfirm({ title: '操作未完成', content: '输入的 SMILES 无效：化学名称不可识别', dialogProps: { width: "auto" } });
        }
        return false;
      } else {
        return true;
      }
    },
    async changeTarget() {
      if (this.resultsStore.dataGraph.nodes.length) {
        const isConfirmed = await this.createConfirm({ title: '请确认', content: '这会清空已有结果，是否继续？', dialogProps: { width: "auto" } })
        if (!isConfirmed)
          return
      }
      this.selectedCondition = null;
      this.highlightViewEnabled = false;
      this.treeViewEnabled = false;
      this.isCanvasEmpty = false;
      this.nodeDetailVisible = false;
      this.visible = false;
      this.pendingTasks += 1;
      this.saveAllSettings();
      this.validatesmiles(this.resultsStore.target, !this.allowResolve)
        .then(async (isvalidsmiles) => {
          let targetSmiles;
          if (isvalidsmiles) {
            targetSmiles = this.resultsStore.target;
          } else {
            targetSmiles = await this.resolveChemName(this.resultsStore.target);
          }
          this.resultsStore.target = targetSmiles;
          return this.resultsStore.target
        })
        .then((smiles) => this.canonicalize(smiles, "target"))
        .then(() => {
          this.saveTarget(this.resultsStore.target);
          if (this.resultsStore.target !== undefined) {
            if (this.resultsStore.target.indexOf('.') !== -1) {
              this.createSnackbar({ text: "警告：一步逆合成模型不适合同时处理多个目标分子。", snackbarProps: { timeout: 5000, color: 'orange-darken-1' } })
            }
            this.resultsStore.clearDataGraph();
            this.resultsStore.clearDispGraph();
            this.resultsStore.clearRemovedReactions();
            let savedTarget = this.resultsStore.target;
            this.resultsStore.$reset();
            this.resultsStore.target = savedTarget;
            return this.initTargetDataNode()
              .then(this.initTargetDispNode)
              .then(this.resultsStore.expand);
          } else {
            throw new Error("无法解析目标 SMILES。");
          }
        })
        .then(() => {
          this.initializeNetwork();
        })
        .catch(async (error) => {
          let error_msg = error.message || error || "未知错误";
          await this.createConfirm({ title: '操作未完成', content: error_msg, dialogProps: { width: "auto" } })
          this.clear(true)
        })
        .finally(() => {
          this.pendingTasks -= 1;
          if (this.$route.path !== '/network' && this.$route.query.tab !== "IPP") {
            this.snackbarIPP = true;
          }
        });
    },
    initTargetDataNode(update = true) {
      this.resultsStore.addDataNodes({
        id: this.resultsStore.target,
        type: "chemical",
      });
      if (update) {
        return this.resultsStore.updateChemicalMetadata([
          this.resultsStore.target,
        ]);
      }
    },
    initTargetDispNode() {
      const dataNode = this.resultsStore.dataGraph.nodes.get(
        this.resultsStore.target
      );
      this.resultsStore.addDispNodes(
        makeChemicalDisplayNode({
          id: NIL_UUID,
          data: dataNode,
          target: this.resultsStore.target,
        })
      );
      return NIL_UUID;
    },
    updateNetworkOptions() {
      if (typeof this.network != "undefined") {
        this.network.setOptions(
          JSON.parse(JSON.stringify(this.settingsStore.visjsOptions))
        );
      }
    },
    toggleHierarchical() {
      // this.settingsStore.setVisHierachicalEnabled(
      //   !this.settingsStore.visjsOptions.layout.hierarchical.enabled
      // );
      this.settingsStore.visjsOptions.layout.hierarchical.enabled = !this.settingsStore.visjsOptions.layout.hierarchical.enabled
      this.updateNetworkOptions();
    },
    changeAllEdgeColors(newColor) {
      // Get all edge IDs
      const edgeIds = this.resultsStore.dispGraph.edges.getIds();

      // Update all edges with the new color
      const updatedEdges = edgeIds.map(id => ({
        id: id,
        color: {
          color: newColor,
          inherit: false
        }
      }));

      // Update all edges in the dispGraph
      this.resultsStore.updateDispEdges(updatedEdges);

    },
    expandNode() {
      if (this.isModalOpen() || typeof this.network == "undefined") {
        return;
      }
      let selected = this.network.getSelectedNodes();
      if (selected.length !== 1) {
        if (selected.length === 0) {
          this.createConfirm({ title: '提示', content: '请选择一个终端化学节点再展开。', dialogProps: { width: "auto" } })
        } else {
          this.createConfirm({ title: '提示', content: '每次只能选择一个节点展开。', dialogProps: { width: "auto" } })
        }
        return;
      }

      let nodeId = selected[0];
      this.pendingTasks += 1;
      this.nodeDetailVisible = false;

      this.resultsStore
        .expand(nodeId)
        .then(() => {
          let centerNodes = [nodeId];
          this.resultsStore.dispGraph.getSuccessors(nodeId).forEach((rxn) => {
            this.resultsStore.dispGraph.getSuccessors(rxn).forEach((chem) => {
              centerNodes.push(chem)
            });
          });
          this.network.fit({
            nodes: centerNodes,
            animation: {
              duration: 1000,
              easingFunction: "easeInOutQuad",
            }
          });
        })
        .catch((error) => {
          let error_msg = error.message || error || "未知错误";
          this.createConfirm({ title: '操作未完成', content: error_msg, dialogProps: { width: "auto" } })
        })
        .finally(() => {
          this.pendingTasks -= 1;
          if (this.$route.path !== '/network' && this.$route.query.tab !== "IPP") {
            this.snackbarIPP = true;
          }
          this.network.unselectAll();
        });
    },
    selectAllOccur() {
      let selected = this.network.getSelectedNodes();
      if (selected.length === 0) {
        this.createConfirm({ title: '提示', content: "请先选择一个节点。", dialogProps: { width: "auto" } })
        return;
      }
      let selectNodes = [];

      for (let nodeId of selected) {
        let node = this.resultsStore.dispGraph.nodes.get(nodeId);
        if (node === null) {
          // the node does not exist, it may have already been deleted
          continue;
        }
        let sm_node = node.smiles;
        this.resultsStore.dispGraph.nodes.forEach(function (cur_node, id) {
          if (cur_node.smiles === sm_node) {
            selectNodes.push(id);
          }
        });
      }
      this.network.selectNodes(selectNodes);
    },
    async deleteChoice() {
      // for all selected nodes, delete reaction nodes and delete children of chemical nodes
      const isConfirmed = await this.createConfirm({ title: '请确认', content: '这会永久删除选中的反应节点，以及选中化学节点的所有子节点。是否继续？', dialogProps: { width: "auto" } })
      if (!isConfirmed)
        return
      let selected = this.network.getSelectedNodes();
      for (let nodeId of selected) {
        let node = this.resultsStore.dispGraph.nodes.get(nodeId);
        if (node === null) {
          // the node does not exist, it may have already been deleted
          continue;
        }
        this.resultsStore.deleteDispNode(node);
      }
      this.clearSelection();
      this.network.unselectAll();
    },
    toggleResolver() {
      this.allowResolve = !this.allowResolve;
    },
    download() {
      this.changeAllEdgeColors('black');
      let data = {
        dataGraph: this.resultsStore.dataGraph,
        dispGraph: this.resultsStore.dispGraph,
        version: 1.0,
      };
      let blob = new Blob([JSON.stringify(data)], {
        type: "data:text/json;charset=utf-8",
      });
      saveAs(blob, this.downloadName);
    },
    hasUndefinedClusterId() {
      for (let rxn of this.resultsStore.dataGraph.nodes.get({
        filter: (node) => node.type === "reaction",
      })) {
        if (rxn.clusterId === undefined) {
          return true;
        }
      }
      return false;
    },
    fixUndefinedClusterName() {
      for (let rxn of this.resultsStore.dataGraph.nodes.get({
        filter: (node) => node.type === "reaction",
      })) {
        if (rxn.clusterId !== undefined && rxn.clusterName === undefined) {
          rxn.clusterName = `Reaction Cluster #${rxn.clusterId + 1}`;
        }
      }
      return false;
    },
    async load() {
      const isConfirmed = await this.createConfirm({ title: '请确认', content: '这会清空当前所有结果，是否继续？', dialogProps: { width: "auto" } })
      if (!isConfirmed)
        return
      this.resultsStore.target = "";
      this.selected = null;
      this.resultsStore.clearDataGraph();
      this.resultsStore.clearDispGraph();
      this.resultsStore.clearRemovedReactions();
      this.trees = [];
      this.pendingTasks += 1;
      this.isCanvasEmpty = false;
      this.visible = false;
      let reader = new FileReader();
      reader.readAsText(this.uploadFile);
      reader.onload = (e) => {
        try {
          let data = JSON.parse(e.target.result);
          if (data.version === 1.0) {
            this.importDataV1(data);
          } else {
            this.importDataV0(data);
          }
        }
        catch {
          alert("无法解析导入文件。")
        }
        finally {
          this.pendingTasks -= 1;
        }
      };
    },
    importDataV0(data) {
      // Parse old data download format, before version numbers were introduced
      // Top level properties should be nodes, edges, and results
      // This converts the data to the current format for subsequent downloads
      this.resultsStore.target = data.nodes[0].smiles;
      let relabel = data.nodes[0].id !== NIL_UUID; // If target node ID is not NIL_UUID, then relabel using UUIDs
      let nodeIdMap = { [data.nodes[0].id]: NIL_UUID };
      this.initTargetDataNode(false);
      for (let [chem, precursors] of Object.entries(data.results)) {
        this.addRetroResultToDataGraph({
          data: precursors,
          parentSmiles: chem,
          update: false,
        });
      }
      this.addDispNodes(
        data.nodes.map((node) => {
          let nodeId;
          if (relabel) {
            nodeId = nodeIdMap[node["id"]];
            if (nodeId === undefined) {
              nodeId = uuidv4();
              nodeIdMap[node["id"]] = nodeId;
            }
          } else {
            nodeId = node["id"];
          }
          if (node.type === "chemical") {
            let dataObj = this.resultsStore.dataGraph.nodes.get(node["smiles"]);
            // Transfer properties which were not in the results object
            dataObj.ppg = node["ppg"];
            dataObj.source = node["source"];
            return {
              id: nodeId,
              smiles: node["smiles"],
              borderWidth: node["borderWidth"],
              color: node["color"],
              shape: "image",
              image: this.getMolDrawEndPoint(node["smiles"]),
              type: "chemical",
            };
          } else {
            let dataObj = this.resultsStore.dataGraph.nodes.get(
              node["reactionSmiles"]
            );
            // Transfer properties which were not in the results object
            dataObj.selectivity = node["selectivity"];
            let newNode = {
              id: nodeId,
              smiles: node["reactionSmiles"],
              label: node["label"],
              type: "reaction",
            };
            for (let key of ["borderWidth", "color", "title"]) {
              if (key in node) {
                newNode[key] = node[key];
              }
            }
            return newNode;
          }
        })
      );
      this.addDispEdges(
        data.edges.map((edge) => {
          let edgeId = relabel ? uuidv4() : edge["id"];
          let fromId = relabel ? nodeIdMap[edge["from"]] : edge["from"];
          let toId = relabel ? nodeIdMap[edge["to"]] : edge["to"];
          let from = this.resultsStore.dispGraph.nodes.get(fromId);
          let to = this.resultsStore.dispGraph.nodes.get(toId);
          const reactionObj = from["type"] === "reaction"
            ? this.resultsStore.dataGraph.nodes.get(from["smiles"])
            : this.resultsStore.dataGraph.nodes.get(to["smiles"]);
          if (from["type"] !== "reaction") {
            reactionObj.inVis[fromId] = toId;
          }
          return {
            id: edgeId,
            from: fromId,
            to: toId,
            scaling: {
              min: 1,
              max: 5,
              customScalingFunction: edgeScaling,
            },
            color: edge["color"],
            value: edge["value"],
          };
        })
      );
      if (this.hasUndefinedClusterId()) {
        if (
          confirm(
            '上传的 JSON 文件中部分前体缺少反应聚类信息。选择“确定”将重新聚类，选择“取消”将关闭聚类。'
          )
        ) {
          this.updateAllClusters();
        } else {
          this.allowCluster = false;
        }
      } else {
        this.fixUndefinedClusterName();
      }
      this.initializeNetwork();
    },
    importDataV1(data) {
      // Parse data format version 1.0
      // Top level properties should be dataGraph, dispGraph, and version
      this.resultsStore.importDataJSON(data.dataGraph);
      this.resultsStore.importDispJSON(data.dispGraph);
      this.resultsStore.target =
        this.resultsStore.dispGraph.nodes.get(NIL_UUID).smiles;
      if (this.hasUndefinedClusterId()) {
        if (
          confirm(
            '上传的 JSON 文件中部分前体缺少反应聚类信息。选择“确定”将重新聚类，选择“取消”将关闭聚类。'
          )
        ) {
          this.updateAllClusters();
        } else {
          this.allowCluster = false;
        }
      } else {
        this.fixUndefinedClusterName();
      }
      this.initializeNetwork();
    },
    updateAllClusters() {
      // Recompute cluster IDs for all results
      for (let target of this.resultsStore.dataGraph.nodes.getIds({
        filter: (node) => node.type === "chemical",
      })) {
        if (this.resultsStore.dataGraph.getSuccessors(target).length > 0) {
          this.requestClusterId(target);
        }
      }
    },
    async clear(skipConfirm = false) {
      // Returns true or false depending on whether results were cleared
      if (!skipConfirm) {
        const isConfirmed = await this.createConfirm({ title: '请确认', content: '这会清空当前所有结果，是否继续？', dialogProps: { width: "auto" } })
        if (!isConfirmed)
          return
      }
      // this.resultsStore.target = ""; // as requested in #41
      this.resultsStore.clearDataGraph();
      this.resultsStore.clearDispGraph();
      this.resultsStore.clearRemovedReactions();
      let savedTarget = this.resultsStore.target;
      this.selected = null;
      this.resultsStore.$reset()
      this.resultsStore.target = savedTarget;
      this.trees = [];
      this.isCanvasEmpty = true;
      this.visible = true;
      this.treeViewEnabled = false;
      this.$emit("update:treeViewVisible", false)
    },
    clearSelection() {
      if (!this.selectedCondition) {
        this.selected = null;
      }
      this.nodeDetailVisible = false;
    },
    closeNodeDetail() {
      this.nodeDetailVisible = false;
    },
    closeSettings() {
      this.settingsVisible = false;
    },
    collapseNode() {
      let selected = this.network.getSelectedNodes();
      selected.forEach((node) => {
        if (this.network.clustering.isCluster(node)) {
          this.network.openCluster(node);
        } else {
          let forCluster = this.resultsStore.dispGraph.getAllSuccessors(node);
          let options = {
            joinCondition: (nodeOptions) => {
              return (
                forCluster.includes(nodeOptions.id) || nodeOptions.id === node
              );
            },
          };
          this.network.clustering.cluster(options);
        }
      });
      this.network.unselectAll();
    },
    showKetcherModal() {
      this.showKetcher = true;
      this.$refs["ketcherRef"].smilesToKetcher();
    },
    async showNodeDetail(obj) {
      let nodeId = obj.nodes[obj.nodes.length - 1];
      if (typeof nodeId == "string" && nodeId.startsWith("cluster")) {
        const isConfirmed = await this.createConfirm({ title: '请确认', content: '是否展开该聚类节点？', dialogProps: { width: "auto" } })
        if (isConfirmed) {
          this.collapseNode();
        }
        return;
      }
      let dispObj = this.resultsStore.dispGraph.nodes.get(nodeId);
      if (!dispObj) return;
      let dataObj = this.resultsStore.dataGraph.nodes.get(dispObj.smiles);
      if (!dataObj) return;
      this.selected = {
        id: dispObj.id,
        smiles: dispObj.smiles,
        type: dispObj.type,
        data: dataObj,
        disp: dispObj,
      };
      if (dispObj.type === "chemical" && dataObj.ppg === undefined) {
        this.resultsStore.updatePrice([dataObj.id]).then(() => {
          let newData = this.resultsStore.dataGraph.nodes.get(dispObj.smiles);
          let newDisp = this.resultsStore.dispGraph.nodes.get(dispObj.id);
          this.selected.data = newData;
          this.selected.disp = newDisp;
        });
      }
      this.nodeDetailVisible = true;
      this.$nextTick(() => {
        if (dispObj.type === "chemical") {
          if (
            this.resultsStore.dataGraph.getSuccessors(dispObj.smiles).length > 0
          ) {
            const cmap = this.getReactingAtomColormap(dispObj.smiles);
            this.$refs["node-detail"].$refs["ketcher-min"].setSmiles(
              dataObj.id,
              undefined,
              (k) => {
                k.editor.applyColormap(cmap);
              }
            );
          } else {
            this.$refs["node-detail"].$refs["ketcher-min"].setSmiles(
              dataObj.id
            );
          }
        }
      });
    },
    getReactingAtomColormap(smiles) {
      // Apply a colormap to the ketcher drawing corresponding to reacting atom stats
      // Color corresponds to number of clusters represented
      // Size corresponds to number of reactions represented
      const stats = this.collectReactingAtomStats(smiles);
      const cmap = new Map();

      function scaleValue(val, limits) {
        return limits.max - limits.min > 0
          ? (val - limits.min) / (limits.max - limits.min)
          : 1;
      }

      if (stats.reactions.size > 0) {
        const rLimits = {
          min: Math.min(...stats.reactions.values()),
          max: Math.max(...stats.reactions.values()),
        };
        const cLimits = {
          min: Math.min(...stats.clusters.values()),
          max: Math.max(...stats.clusters.values()),
        };
        this.selected["stats"] = {
          reactions: rLimits,
          clusters: cLimits,
        };
        const palette = ["#c0f0c0", "#005020"];

        for (let [atom, countR] of stats.reactions) {
          let countC = stats.clusters.get(atom);
          cmap.set(atom - 1, {
            scale: scaleValue(countR, rLimits),
            color: interpolateHexColor(palette, scaleValue(countC, cLimits)),
          });
        }
      }
      return cmap;
    },
    collectReactingAtomStats(smiles) {
      // For the specified molecule, count appearance of each atom as reacting in precursor results
      // Returns a map from atom index to number of occurrences
      const rxns = this.resultsStore.dataGraph.nodes.get(
        this.resultsStore.dataGraph.getSuccessors(smiles)
      );
      const counts = new Map();
      const clusters = new Map();
      rxns.forEach((rxn) => {
        if (rxn.reactingAtoms) {
          rxn.reactingAtoms.forEach((i) => {
            if (i !== -1) {
              counts.set(i, (counts.get(i) || 0) + 1);
              clusters.set(
                i,
                (clusters.get(i) || new Set()).add(rxn.clusterId)
              );
            }
          });
        }
      });
      clusters.forEach((val, key, map) => {
        map.set(key, val.size);
      });
      return { reactions: counts, clusters: clusters };
    },
    getMolDrawEndPoint(precursor, align = false) {
      //  precursor can be
      //      1) a smiles string,
      //      2) a object with properties "reactingAtoms" and "mappedSmiles"
      //      3) a object with property "smiles"
      //      4) an object with property "precursorSmiles"
      const highlight = this.isHighlightAtom;
      const transparent = false;
      let reference;
      if (
        align &&
        this.selected &&
        this.settingsStore.ippSettings.alignPrecursorsToProduct
      ) {
        reference = this.selected.smiles;
      }
      return getMolImageUrl(precursor, highlight, transparent, reference);
    },
    isModalOpen() {
      var res = false;
      res = res || this.showSettingsModal;
      res = res || this.showDownloadModal;
      res = res || this.showLoadModal;
      res = res || this.showClusterPopoutModal;
      res = res || this.showClusterEditModal;
      res = res || this.showAddNewPrecursorModal;
      return res;
    },
    requestClusterId(smiles) {
      this.pendingTasks += 1;
      return this.resultsStore.recluster(smiles).finally(() => {
        this.pendingTasks -= 1;
      });
    },
    saveResult() {
      this.pendingTasks += 1;
      this.changeAllEdgeColors("black");
      const body = {
        result: {
          dataGraph: this.resultsStore.dataGraph.toJSON(),
          dispGraph: this.resultsStore.dispGraph.toJSON(),
        },
        settings: this.getAllSettings(),
        description: this.resultsStore.savedResultInfo.description,
        tags: this.resultsStore.savedResultInfo.tags,
        type: "ipp",
        target_smiles: this.resultsStore.target,
      };
      if (!this.resultsStore.savedResultInfo) {
        console.error('savedResultInfo is not initialized.');
        return;
      }
      let url = `/api/results/create`;
      let method = "post";
      if (
        !!this.resultsStore.savedResultInfo.id &&
        this.resultsStore.savedResultInfo.type === "ipp" &&
        this.resultsStore.savedResultOverwrite
      ) {
        url += this.resultsStore.savedResultInfo.id + "/";
        body["check_date"] = this.resultsStore.savedResultInfo.modified;
        method = "put";
      }
      API[method](url, body)
        .then((json) => {
          if (json.success) {
            this.resultsStore.updateSavedResultInfo({
              result_id: json['result_id'],
              user: localStorage.getItem('username'),
              modified: json["modified"],
              modifiedDisp: dayjs(json["modified"]).format(
                "MMMM D, YYYY h:mm A"
              ),
            });
            alert("结果已保存。", {
              title: "保存成功",
              size: "sm",
              okVariant: "primary",
              okTitle: "确定",
              hideHeaderClose: true,
              centered: true,
              footerClass: "p-2",
            });
          } else {
            alert("无法保存结果。", {
              title: "提示",
              size: "sm",
              okVariant: "danger",
              okTitle: "确定",
              hideHeaderClose: true,
              centered: true,
              footerClass: "p-2",
            });
          }
          this.resultDialogVisible = false
        })
        .catch((error) => {
          alert(
            "保存结果时出错：" + error.message,
            {
              title: "提示",
              size: "sm",
              okVariant: "danger",
              okTitle: "确定",
              hideHeaderClose: true,
              centered: true,
              footerClass: "p-2",
            }
          );
          this.resultDialogVisible = false
        })
        .finally(() => {
          this.pendingTasks -= 1;
        });
    },
    init() {
      const hasDispNodes = this.resultsStore.dispGraph.nodes.length > 0;
      const initNetwork = () => {
        if (!this.network && hasDispNodes) {
          this.initializeNetwork();
          this.centerGraph();
        }
      };

      if (this.isCanvasEmpty && hasDispNodes) {
        this.isCanvasEmpty = false;
      }

      this.$nextTick(initNetwork);
    },
    async canonicalize(smiles, input) {
      const json = await API.post("/api/rdkit/canonicalize/", {
        smiles: smiles,
      });
      if (json.smiles) {
        if (typeof input === "string") {
          this[input] = json.smiles;
        } else if (input instanceof Function) {
          input(json.smiles);
        }
      }
    },
    updateTerminalNodes() {
      let chemicals = this.resultsStore.dataGraph.getChemicalNodes();
      let updates = chemicals.map((node) => ({
        id: node["id"],
        terminal: this.isNodeTerminal(node),
      }));
      this.resultsStore.updateDataNodes(updates);
    },
    enumerateTrees() {
      this.currentTreeIndex = 0;
      this.updateTerminalNodes();
      let trees = getPaths({
        dataGraph: this.resultsStore.dataGraph,
        dispGraph: this.resultsStore.dispGraph,
        root: this.resultsStore.target,
        rootId: NIL_UUID,
        maxDepth: this.settingsStore.tree_builder_settings.build_tree_options.max_depth,
        maxTrees: this.settingsStore.tree_builder_settings.build_tree_options.max_trees,
        dispOnly: this.useDispNodesOnly,
      });
      trees.forEach((tree) => this.calculateTreeMetadata(tree));
      this.trees = trees;
      this.treeViewEnabled = true;
      this.resultsStore.updateTreeConnectivity();
    },
    calculateTreeMetadata(tree) {
      // Updates tree in place
      let rxns = tree.nodes.filter((node) => node.type === "reaction");
      let firstRxn = rxns.filter(
        (node) =>
          this.resultsStore.dataGraph.getPredecessors(node.smiles)[0] ===
          this.resultsStore.target
      )[0];
      let firstRxnData = this.resultsStore.dataGraph.nodes.get(firstRxn.smiles);
      let data = rxns.map((node) =>
        this.resultsStore.dataGraph.nodes.get(node.smiles)
      );
      let ffscores = data.map((node) => node.ffScore);
      let tscores = data.map((node) => node.templateScore);
      Object.assign(tree.graph, {
        num_reactions: rxns.length,
        first_step_score: firstRxnData.templateScore,
        first_step_plausibility: firstRxnData.ffScore,
        avg_score: tscores.reduce((a, b) => a + b, 0) / tscores.length,
        avg_plausibility: ffscores.reduce((a, b) => a + b, 0) / ffscores.length,
        min_score: Math.min(...tscores),
        min_plausibility: Math.min(...ffscores),
      });
    },
    isNodeTerminal(dataNode) {
      // Based on MCTS.is_terminal in askcos-core
      // Note: chemicalPropertyLogic and chemicalPopularityLogic not yet supported
      // Expects node to be a data node object
      let checks = {
        buyable_logic: (n) => {
          return !!n.ppg && n.ppg !== "not buyable";
        },
        max_ppg_logic: (n) => {
          return (
            !!this.settingsStore.tree_builder_settings.build_tree_options.max_ppg &&
            !!n.ppg &&
            0 < n.ppg &&
            n.ppg <= this.settingsStore.tree_builder_settings.build_tree_options.max_ppg
          );
        },
        max_scscore_logic: (n) => {
          return (
            !!this.settingsStore.tree_builder_settings.build_tree_options.max_scscore &&
            !!n.scscore &&
            n.scscore <= this.settingsStore.tree_builder_settings.build_tree_options.max_scscore
          );
        },
        chemical_property_logic: (n) => {
          const reacCheck =
            !!n.asReactant &&
            n.asReactant >= 5;
          const prodCheck =
            !!n.asProduct &&
            n.asProduct >= 5;
          return reacCheck || prodCheck;
        },
      };
      let orCriteria = [];
      let andCriteria = [];
      let allCriteria = [
        "buyable_logic",
        "max_ppg_logic",
        "max_scscore_logic",
        "chemical_property_logic",
      ];
      allCriteria.forEach((crit) => {
        if (this.settingsStore.tree_builder_settings.build_tree_options[crit] === "or") {
          orCriteria.push(checks[crit](dataNode));
        } else if (this.settingsStore.tree_builder_settings.build_tree_options[crit] === "and") {
          andCriteria.push(checks[crit](dataNode));
        }
      });
      return (
        (orCriteria.length && orCriteria.some((x) => x)) ||
        (andCriteria.length && andCriteria.every((x) => x))
      );
    },
    enableTreeView() {
      this.treeViewEnabled = true;
      if (!this.trees.length) {
        this.enumerateTrees();
      }
      this.updateTreeOpacity();
      this.$emit("update:treeViewVisible", true);
    },
    disableTreeView() {
      this.treeViewEnabled = false;
      this.resetOpacity();
      this.$emit("update:treeViewVisible", false);
    },
    updateTreeOpacity() {
      this.resetOpacity();
      let tree = this.currentTree;
      let treeNodes = tree.nodes.map((node) => node.id);
      let treeEdges = tree.edges.map((edge) => edge.id);
      let nodes = this.resultsStore.dispGraph.nodes.getIds().map((node) => ({
        id: node,
        opacity: treeNodes.includes(node) ? undefined : BG_OPACITY,
      }));
      let edges = this.resultsStore.dispGraph.edges.getIds().map((edge) => ({
        id: edge,
        color: {
          color: "#000000",
          inherit: false,
          opacity: treeEdges.includes(edge) ? undefined : BG_OPACITY,
        },
      }));
      this.resultsStore.updateDispNodes(nodes);
      this.resultsStore.updateDispEdges(edges);
    },
    resetOpacity() {
      let nodes = this.resultsStore.dispGraph.nodes.getIds().map((node) => ({
        id: node,
        opacity: undefined,
      }));
      let edges = this.resultsStore.dispGraph.edges.getIds().map((edge) => ({
        id: edge,
        color: {
          color: "#000000",
          inherit: false,
          opacity: undefined,
        },
      }));
      this.resultsStore.updateDispNodes(nodes);
      this.resultsStore.updateDispEdges(edges);
    },
    changeTreeIndex(op) {
      let max = this.trees.length - 1;
      switch (op) {
        case "next":
          if (this.currentTreeIndex < max) {
            this.currentTreeIndex += 1;
          }
          break;
        case "prev":
          if (this.currentTreeIndex > 0) {
            this.currentTreeIndex -= 1;
          }
          break;
        case "first":
          this.currentTreeIndex = 0;
          break;
        case "last":
          this.currentTreeIndex = max;
          break;
        default:
          console.error(`Unexpected operation '${op}' for changeTreeIndex.`);
      }
      this.updateTreeOpacity();
    },
    pendingTasksHandler(type) {
      if (type === "add") {
        this.pendingTasks += 1;
      } else if (type === "sub") {
        this.pendingTasks -= 1;
      }
    },
    dayjs,
    num2str,
  },
  watch: {
    tabActive: {
      handler(newVal) {
        if (newVal) {
          this.init();
        }
      },
      immediate: true,
    },
    treeViewEnabled(newVal) {
      if (newVal) {
        this.enableTreeView();
      } else {
        this.disableTreeView();
      }
    },
    edgeColor: {
      handler(newColor) {
        this.changeAllEdgeColors(newColor);
      },
      immediate: true
    }
  },
  'resultsStore.savedResultInfo': {
    deep: true,
    handler(newValue, oldValue) {
      console.log('savedResultInfo changed:', oldValue, '->', newValue);
    }
  },
  beforeRouteUpdate() {
    this.nodeDetailVisible = false;
  }
};
</script>

<style>
/* Do not remove this - vis-tooltip */
.vis-tooltip {
  position: absolute;
}

.slider {
  max-width: 800px;
  white-space: nowrap;
  overflow-x: auto;
  /* Enable horizontal scrollbar for overflow */
}

.network-command-toolbar {
  min-height: 200px;
  height: auto !important;
  padding-block: 12px;
}

.network-command-toolbar .v-toolbar__content {
  min-height: 176px;
  height: auto !important;
}

.network-target-field .v-input__append {
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.network-target-field .v-input__append .v-btn,
.network-target-field .v-input__append .v-btn-group {
  margin: 0 !important;
}

.network-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  margin-top: 12px;
}

.network-actions .v-btn,
.network-actions .v-btn-group {
  margin: 0 !important;
}

.open-toolbar {
  width: 100%;
  height: calc(100vh - 16.5rem);
}

#tree-view-overlay {
  position: absolute;
  top: 120px;
  left: 1px;
  padding: 5px;
  background-color: rgba(255, 255, 255, 0.8);
}

#hierarchical-button {
  font-weight: bold;
}

.flex-gap-2 {
  gap: 0.5rem;
}

.result-btn {
  position: absolute;
  padding: 5px;
  bottom: 1px;
  right: 1px;
}

.canvas-btn {
  position: absolute;
  padding: 5px;
  bottom: 40px;
  right: 1px;
}

.highlight-btn {
  position: absolute;
  padding: 5px;
  top: 120px;
  right: 1px;
}

@media (max-width: 700px) {
  .network-command-toolbar {
    padding: 12px 0 16px;
  }

  .network-command-toolbar .v-toolbar__content {
    align-items: stretch;
  }

  .network-target-field .v-input__control {
    flex: 1 1 100%;
  }

  .network-target-field .v-input__append {
    width: 100%;
    margin-inline-start: 0;
    margin-top: 10px;
    justify-content: flex-start;
  }

  .network-target-field .v-input__append > .v-btn,
  .network-target-field .v-input__append > .v-btn-group {
    flex: 1 1 150px;
  }

  .network-target-field .v-input__append .v-btn {
    min-width: 0;
  }

  .network-actions .v-btn,
  .network-actions .v-btn-group {
    flex: 1 1 150px;
  }
}
</style>
