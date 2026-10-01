<template>
    <div>
    <section class="route-list-workspace" data-cy="tree-route-list-workspace">
        <header class="route-list-header">
            <div class="route-title-group">
                <v-btn class="route-back-btn" icon="mdi-arrow-left" variant="text" href="/results" aria-label="返回任务列表"></v-btn>
                <div>
                    <p class="route-eyebrow">路线设计</p>
                    <h1>路线列表</h1>
                </div>
            </div>
            <div class="route-search-tabs" aria-label="搜索类型">
                <button class="active" type="button">精确分子搜索 <strong>{{ trees.length }}</strong></button>
                <button type="button" disabled>相似分子搜索 <strong>0</strong></button>
            </div>
            <v-btn class="route-map-toggle" color="success" variant="flat" prepend-icon="mdi-sitemap" @click="toggleGraphMode">
                {{ showGraphMode ? "路线列表" : "图谱模式" }}
            </v-btn>
        </header>

        <div class="route-list-layout">
            <aside class="route-target-sidebar" data-cy="tree-view-left-panel">
                <div class="target-preview-card">
                    <smiles-image class="target-preview-image" :smiles="target" :show-error-image="false" :allow-copy="true"></smiles-image>
                    <div class="target-meta">
                        <strong>目标分子</strong>
                        <span>{{ compactSmiles(target) }}</span>
                    </div>
                </div>
                <div class="route-side-actions">
                    <v-btn block color="success" variant="flat" @click="$emit('switch-tab', 'IPP')">手动搜索</v-btn>
                    <v-btn block variant="outlined" disabled>导入路线</v-btn>
                    <v-btn block variant="outlined" href="/">重新搜索</v-btn>
                </div>
                <div class="route-side-section">
                    <div class="side-section-title"><span>路线集合</span><strong>{{ trees.length }}</strong></div>
                    <button type="button" class="side-row active">
                        <v-icon icon="mdi-folder-outline" size="18"></v-icon>
                        全部路线
                        <span>{{ trees.length }}</span>
                    </button>
                    <button type="button" class="side-row">
                        <v-icon icon="mdi-filter-outline" size="18"></v-icon>
                        当前筛选
                        <span>{{ filteredRouteLabel }}</span>
                    </button>
                </div>
                <div class="route-side-section">
                    <div class="side-section-title"><span>筛选</span></div>
                    <div class="side-toggle-row">
                        <v-btn id="filterInvertCheck" size="small" variant="tonal" color="success" data-cy="pathways-do-dont" @click="filterInvert = !filterInvert">
                            {{ filterInvert ? "不包含" : "包含" }}
                        </v-btn>
                        <v-btn id="filterAnyCheck" size="small" variant="tonal" color="success" data-cy="pathways-any-all" @click="filterAny = !filterAny">
                            {{ filterAny ? "任一" : "全部" }}
                        </v-btn>
                    </div>
                    <v-select label="起始原料" :items="startingMaterialOptions" data-cy="filter-sm" v-model="selectedStartingMaterials" multiple variant="outlined" density="compact" hide-details class="mt-3"></v-select>
                    <v-select label="中间体" :items="intermediateOptions" v-model="selectedIntermediates" data-cy="filter-intermediates" multiple variant="outlined" density="compact" hide-details class="mt-3"></v-select>
                    <v-select v-if="reactionClassOptions.length" label="反应类别" :items="reactionClassOptions" v-model="selectedReactionClasses" multiple variant="outlined" density="compact" hide-details class="mt-3"></v-select>
                </div>
                <div class="route-side-section">
                    <div class="side-section-title"><span>加入交互式规划</span></div>
                    <v-text-field label="前 N 条路线" variant="outlined" hide-details v-model="numTreesInput" id="tree-view-first-N-trees" data-cy="tree-view-first-N-trees" density="compact"></v-text-field>
                    <v-btn block class="mt-3" variant="tonal" color="success" data-cy="tree-view-add-by-trees-to-ipp" :disabled="trees.length === 0" @click="addTreesToIpp()">加入网络</v-btn>
                </div>
            </aside>

            <main class="route-results-panel" data-cy="tree-view-right-panel">
                <section class="route-toolbar">
                    <div class="route-filter-bar">
                        <span>筛选：</span>
                        <button type="button">供应商</button>
                        <button type="button">单价</button>
                        <button type="button">反应条件</button>
                        <button type="button">其它({{ selectedReactionClasses.length + selectedIntermediates.length + selectedStartingMaterials.length }})</button>
                        <v-switch id="clusterSwitch" class="route-cluster-switch" v-model="cluster" :disabled="clusterDisabled" hide-details density="compact" label="开启分组"></v-switch>
                    </div>
                    <div class="route-toolbar-actions">
                        <v-btn variant="outlined" size="small" prepend-icon="mdi-eye" @click="resultInfo = true" :disabled="trees.length === 0">查看</v-btn>
                        <v-btn variant="outlined" size="small" prepend-icon="mdi-download" @click="downloadData(false)" :disabled="trees.length === 0">下载</v-btn>
                        <v-select class="route-sort-select" v-model="treeSortInput[0].key" :items="treeSortOptions" label="排序" density="compact" variant="outlined" hide-details></v-select>
                    </div>
                </section>

                <section v-if="showGraphMode && trees.length" class="route-graph-card">
                    <div class="route-graph-toolbar">
                        <v-btn-group variant="outlined" density="comfortable" divided :border="true">
                            <v-btn icon="mdi-chevron-double-left" @click="changeTreeId('first')" data-cy="tree-view-double-left"></v-btn>
                            <v-btn icon="mdi-chevron-left" @click="changeTreeId('prev')" data-cy="tree-view-left"></v-btn>
                            <v-btn variant="tonal">路线树 {{ currentTreeId + 1 }} / {{ trees.length }}</v-btn>
                            <v-btn icon="mdi-chevron-right" @click="changeTreeId('next')" data-cy="tree-view-right"></v-btn>
                            <v-btn icon="mdi-chevron-double-right" @click="changeTreeId('last')" data-cy="tree-view-double-right"></v-btn>
                        </v-btn-group>
                        <v-btn variant="tonal" color="success" @click="addTreeToIpp(currentTree)" data-cy="add-to-ipp">加入 IPP</v-btn>
                    </div>
                    <div class="route-graph-canvas">
                        <div id="graph" ref="graph"></div>
                        <network-legend></network-legend>
                    </div>
                </section>

                <section v-if="trees.length" class="route-list-stack">
                    <article
                        v-for="(row, index) in routeRows"
                        :key="row.key"
                        class="route-result-card"
                        :class="{ 'is-active': index === currentTreeId, 'is-expanded': expandedRouteIndex === index }"
                        data-cy="route-result-card"
                    >
                        <div class="route-card-header">
                            <div class="route-card-title">
                                <v-checkbox-btn :model-value="false" density="compact"></v-checkbox-btn>
                                <strong>{{ row.metrics.id }}</strong>
                                <span class="route-source-chip">{{ row.metrics.sourceLabel }}</span>
                                <v-btn icon="mdi-pencil-outline" size="x-small" variant="text" aria-label="编辑路线名称"></v-btn>
                            </div>
                            <dl class="route-metrics">
                                <div><dt>总步数</dt><dd>{{ row.metrics.totalSteps }}</dd></div>
                                <div><dt>预测步数</dt><dd>{{ row.metrics.predictedSteps }}</dd></div>
                                <div><dt>线性步数</dt><dd>{{ row.metrics.linearSteps }}</dd></div>
                                <div><dt>参考难度</dt><dd>{{ row.metrics.difficulty }}</dd></div>
                                <div><dt>综合成本</dt><dd>{{ row.metrics.cost }}</dd></div>
                            </dl>
                            <div class="route-card-actions">
                                <v-btn
                                    icon="mdi-eye-outline"
                                    size="small"
                                    variant="text"
                                    :color="expandedRouteIndex === index ? 'primary' : undefined"
                                    @click="toggleRouteInlineTree(index)"
                                    aria-label="展开路线树"
                                ></v-btn>
                                <v-btn icon="mdi-sitemap-outline" size="small" variant="text" @click="addTreeToIpp(row.tree)" aria-label="加入 IPP"></v-btn>
                                <v-btn icon="mdi-star-outline" size="small" variant="text" aria-label="收藏路线"></v-btn>
                                <v-btn icon="mdi-download-outline" size="small" variant="text" @click="downloadTree(row.tree)" aria-label="下载路线"></v-btn>
                            </div>
                        </div>
                        <div v-if="row.steps.length" class="route-step-strip" :class="routeStepStripClass(row)" :aria-label="row.metrics.id + ' 合成路线'" data-cy="route-step-strip">
                            <template v-for="(step, stepIndex) in row.steps" :key="`${row.key}-${step.id}-${stepIndex}`">
                                <div
                                    role="button"
                                    tabindex="0"
                                    class="route-step-card"
                                    :class="{ 'is-buyable': step.buyable, 'is-target': step.isTarget }"
                                    @click="openChemicalDetail(step.smiles)"
                                    @keydown.enter.prevent="openChemicalDetail(step.smiles)"
                                    @keydown.space.prevent="openChemicalDetail(step.smiles)"
                                >
                                    <span class="route-step-badge">{{ step.isTarget ? "目标" : step.buyable ? "原料" : "中间体" }}</span>
                                    <smiles-image
                                        class="route-step-image"
                                        :smiles="step.smiles"
                                        :show-error-image="false"
                                        :width="routeMoleculeImageSize.width"
                                        :height="routeMoleculeImageSize.height"
                                    ></smiles-image>
                                    <span class="route-step-smiles">{{ compactSmiles(step.smiles) }}</span>
                                    <span v-if="step.price || step.purchaseLink" class="route-step-footer">
                                        <span v-if="step.price" class="route-step-price">{{ step.price }}</span>
                                        <a
                                            v-if="step.purchaseLink"
                                            class="route-step-buy-link"
                                            :href="step.purchaseLink"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            :title="step.purchaseTitle"
                                            @click.stop
                                        >
                                            <v-icon icon="mdi-open-in-new" size="12"></v-icon>
                                            <span>采购</span>
                                        </a>
                                    </span>
                                </div>
                                <div v-if="stepIndex < row.steps.length - 1" class="route-step-arrow" aria-hidden="true">
                                    <strong>{{ step.connectorLabel || "反应" }}</strong>
                                    <v-icon icon="mdi-arrow-right" size="30"></v-icon>
                                </div>
                            </template>
                        </div>
                        <div v-else class="route-step-empty">
                            <v-icon icon="mdi-alert-circle-outline" size="24"></v-icon>
                            <span>路线结构数据未解析，原始结果仍可下载检查。</span>
                        </div>
                        <div v-if="expandedRouteIndex === index && row.steps.length" class="route-inline-tree-panel" data-cy="route-inline-tree-panel">
                            <div class="route-inline-tree-heading">
                                <strong>{{ row.metrics.id }} 横向路线树</strong>
                                <span>当前路线已在本行展开，左右滑动查看完整节点链路。</span>
                            </div>
                            <div class="route-inline-tree-strip" :aria-label="row.metrics.id + ' 横向展开路线树'">
                                <template v-for="(step, stepIndex) in row.steps" :key="`${row.key}-expanded-${step.id}-${stepIndex}`">
                                    <div
                                        role="button"
                                        tabindex="0"
                                        class="route-inline-step-card"
                                        :class="{ 'is-buyable': step.buyable, 'is-target': step.isTarget }"
                                        @click="openChemicalDetail(step.smiles)"
                                        @keydown.enter.prevent="openChemicalDetail(step.smiles)"
                                        @keydown.space.prevent="openChemicalDetail(step.smiles)"
                                    >
                                        <span class="route-step-badge">{{ step.isTarget ? "目标" : step.buyable ? "原料" : "中间体" }}</span>
                                        <smiles-image
                                            class="route-step-image"
                                            :smiles="step.smiles"
                                            :show-error-image="false"
                                            :width="routeMoleculeImageSize.width"
                                            :height="routeMoleculeImageSize.height"
                                        ></smiles-image>
                                        <span class="route-step-smiles">{{ compactSmiles(step.smiles) }}</span>
                                        <span v-if="step.price || step.purchaseLink" class="route-step-footer">
                                            <span v-if="step.price" class="route-step-price">{{ step.price }}</span>
                                            <a
                                                v-if="step.purchaseLink"
                                                class="route-step-buy-link"
                                                :href="step.purchaseLink"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                :title="step.purchaseTitle"
                                                @click.stop
                                            >
                                                <v-icon icon="mdi-open-in-new" size="12"></v-icon>
                                                <span>采购</span>
                                            </a>
                                        </span>
                                    </div>
                                    <div v-if="stepIndex < row.steps.length - 1" class="route-inline-reaction-arrow" aria-hidden="true">
                                        <strong>{{ step.connectorLabel || "反应" }}</strong>
                                        <v-icon icon="mdi-arrow-right" size="34"></v-icon>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </article>
                </section>

            </main>
        </div>
    </section>
<js-panel :visible="tabActive && !!selected" :options="detailPanelOptions" @close="clearSelection"
        data-cy="tree-view-node-details">
        <div v-if="selected" class="ma-3">
            <div v-if="selected.type === 'chemical'">
                <div class="text-center">
                    <copy-tooltip :data="selected.smiles">
                        <b>SMILES： </b><span class="smiles">{{ selected.smiles }}</span>
                    </copy-tooltip>
                    <div><b>价格（$/g）： </b>{{ selected.data.ppg > 0 ? selected.data.ppg : "不可购买" }}</div>
                    <div v-if="selected.data.smilesMatch">
                        <copy-tooltip :data="selected.data.smilesMatch">
                            <b>匹配商业原料： </b>{{ selected.data.smilesMatch }}
                        </copy-tooltip>
                    </div>
                    <smiles-image class="my-3" :smiles="selected.smiles"></smiles-image>
                </div>
                <div class="text-center my-3">
                    <v-btn variant="tonal" :href="'/network?tab=IPP&target=' + encodeURIComponent(selected.smiles)" data-cy="synthesize-this-in-ipp"
                        target="_blank">在交互式规划中继续合成</v-btn>
                </div>
                <v-table density="compact">
                    <tbody>
                        <tr>
                            <th>作为反应物</th>
                            <td>{{ selected.data["asReactant"] }}</td>
                        </tr>
                        <tr>
                            <th>作为产物</th>
                            <td>{{ selected.data["asProduct"] }}</td>
                        </tr>
                        <tr v-if="selected.data['scscore']">
                            <th>合成复杂度</th>
                            <td>{{ num2str(selected.data["scscore"]) }}</td>
                        </tr>
                        <tr v-if="selected.data['molwt']">
                            <th>分子量</th>
                            <td>{{ selected.data["molwt"].toFixed(2) }}</td>
                        </tr>
                    </tbody>
                </v-table>
            </div>
            <div v-if="selected.type === 'reaction'">
                <div class="text-center">
                    <copy-tooltip :data="selected.smiles">
                        <b>SMILES： </b><span class="smiles">{{ selected.smiles }}</span>
                    </copy-tooltip>
                    <smiles-image class="my-3" :smiles="selected.smiles"
                        :align="settingsStore.ippSettings.alignPrecursorsToProduct"></smiles-image>
                </div>
                <div class="text-center my-3">
                    <v-btn variant="tonal"
                        :href="'/forward?tab=context&rxnsmiles=' + encodeURIComponent(selected.smiles)"
                        data-cy="tree-view-evaluate-reaction" target="_blank">评估反应</v-btn>
                </div>
                <v-table density="compact">
                    <tbody data-cy="tree-view-reaction-properties">
                        <tr>
                            <th>反应可行性</th>
                            <td id="plausibility">{{ num2str(selected.data["ffScore"]) }}</td>
                        </tr>
                        <tr v-if="selected.data['forwardScore']">
                            <th>正向预测得分</th>
                            <td id="forward-score">{{ num2str(selected.data["forwardScore"]) }}</td>
                        </tr>
                        <tr v-if="selected.data.modelMetadata && selected.data.modelMetadata[0].source.template">
                            <th>模板得分</th>
                            <td>{{ num2str(selected.data.modelMetadata[0].source.template.template_score) }}</td>
                        </tr>
                        <tr v-if="selected.data.modelMetadata && selected.data.modelMetadata[0].source.template">
                            <th>模板示例数</th>
                            <td>{{ selected.data.modelMetadata[0].source.template.num_examples }}</td>
                        </tr>
                        <tr v-if="selected.data.modelMetadata && selected.data.modelMetadata[0].source.template">
                            <th>必要试剂</th>
                            <td>{{ selected.data.modelMetadata[0].source.template.necessary_reagent || '无' }}</td>
                        </tr>
                        <tr v-if="selected.data['className']">
                            <th>反应类别</th>
                            <td id="reaction-class">{{ selected.data["className"] }} ({{ selected.data["classNum"] }})</td>
                        </tr>
                        <tr>
                            <th>支持模板</th>
                            <td>
                                <ul v-if="selected.data.modelMetadata && selected.data.modelMetadata.length > 0">
                                    <li v-for="(metadata, index) in selected.data.modelMetadata" :key="index">
                                        <div v-if="metadata.source && metadata.source.template">
                                            <a :href="'/template?id=' + metadata.source.template._id" target="_blank">
                                                {{ metadata.source.template._id }}
                                                <span v-if="metadata.source.template.template_set">({{ metadata.source.template.template_set }})</span>
                                            </a>
                                        </div>
                                    </li>
                                </ul>
                                <div v-else class="text-muted">暂无模板数据</div>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
            </div>
            <div class="btn-toolbar justify-content-end">
                <ban-button :smiles="selected.smiles" :type="selected.type"></ban-button>
            </div>
        </div>
    </js-panel>

    <js-panel :visible="tabActive && showListView === true" :options="listPanelOptions" @close="showListView = false">
        <div class="m-3">
            <v-pagination v-model="treeListCurrentPage" :length="Math.ceil(trees.length / treeListItemsPerPage)"
                class="mb-3"></v-pagination>
            <v-card v-for="(tree, index) in treeListItems" :key="index" class="mb-3 pa-10 ma-10" :model-value="panel"
                multiple>
                <v-card-title>
                    <span class="text-body-1 ml-2"><b>路线树 {{ (treeListCurrentPage - 1) * treeListItemsPerPage + index + 1 }} </b></span>
                </v-card-title>
                <v-card-text>
                    <div>
                        <div :id="`treeList-${index}`" class="list-view-tree"></div>
                        <div class="d-flex justify-space-between">
                        </div>
                    </div>
                </v-card-text>
                <v-card-actions>
                    <v-btn-group class="float-right" divided :border="true">
                        <v-btn variant="flat" color="primary" :data-cy='"add-to-ipp-list-"+(index)'
                            @click="addTreeToIpp(trees[(treeListCurrentPage - 1) * treeListItemsPerPage + index])">
                            加入 IPP</v-btn>
                        <v-btn variant="outlined" :data-cy='"view-in-main-window-"+(index)'
                            @click="showListView = false; currentTreeId = (treeListCurrentPage - 1) * treeListItemsPerPage + index;">
                            在主视图查看
                        </v-btn>
                    </v-btn-group>
                </v-card-actions>
            </v-card>
        </div>
    </js-panel>
    <result-info-modal v-if="trees.length !== 0" :visible="resultInfo"
        @close="$event => resultInfo = $event"></result-info-modal>
    </div>
</template>

<script>
import BanButton from "@/components/BanButton";
import CopyTooltip from "@/components/CopyTooltip";
import JsPanel from "@/components/JsPanel";
import SmilesImage from "@/components/SmilesImage";
import NetworkLegend from "@/components/network/NetworkLegend";
import ResultInfoModal from "@/components/network/ResultInfoModal";
import { API } from "@/common/api";
import { getMolImageUrl } from "@/common/drawing";
import { RetroGraph } from "@/common/graph";
import { num2str } from "@/common/utils";
import { visjsOptionsTreeDefault, visjsOptionsTreeCondensed } from "@/store/init/settings";
import { makeChemicalDisplayNode, makeReactionDisplayNode, makeDisplayEdge } from "@/views/network/visualization";
import { Network } from "vis-network";
import { mapStores } from "pinia";
import { useConfirm, useSnackbar } from 'vuetify-use-dialog';
import { useResultsStore } from "@/store/results";
import { useSettingsStore } from "@/store/settings";
import emptyTrees from '@/assets/emptyTrees.svg'
import { saveAs } from "file-saver";
import { computed } from "vue";
import { useTheme } from "@/composables/useTheme";


function initializeNetwork(data, container, showDetail = true) {
    const options = showDetail ? visjsOptionsTreeDefault : visjsOptionsTreeCondensed;
    return new Network(container, data, options);
}

export default {
    name: "TreeView",
    components: {
        BanButton,
        ResultInfoModal,
        CopyTooltip,
        JsPanel,
        SmilesImage,
        NetworkLegend,
    },
    emits: ['switch-tab'],
    props: {
        tabActive: {
            type: Boolean,
            default: false,
        },
    },
    setup() {
        const createConfirm = useConfirm()
        const createSnackbar = useSnackbar()
        const { isDark } = useTheme();
        const backgroundColor = computed(() => {
            return isDark.value ? 'rgba(48, 48, 48, 0.8)' : 'rgba(255, 255, 255, 0.8)';
        });
        return {
            createConfirm,
            createSnackbar,
            backgroundColor
        }
    },
    data() {
        return {
            startDialog: false,
            intermediateDialog: false,
            panel: [0],
            disabled: false,
            showListView: false,
            showGraphMode: false,
            selected: null,
            currentTreeId: 0,
            expandedRouteIndex: null,
            network: null,
            networkData: {},
            cluster: false,
            currentClusterId: 0,
            treeSortInput: [
                { key: "num_reactions", ascending: true },
                { key: "depth", ascending: true },
            ],
            treeListCurrentPage: 1,
            treeListItemsPerPage: 20,
            filterAny: false,
            filterInvert: false,
            reactionClassesByTree: {},
            reactionClassNames: {},
            reactionClassOptions: [],
            selectedReactionClasses: [],
            intermediatesByTree: {},
            intermediateOptions: [],
            selectedIntermediates: [],
            startingMaterialsByTree: {},
            startingMaterialOptions: [],
            selectedStartingMaterials: [],
            analysisTaskRunning: false,
            numTreesInput: 10,
            maxDepthInput: 2,
            maxNumInput: 5,
            infoPanelOptions: {
                id: "infoPanel",
                headerTitle: "信息",
                headerControls: { size: "sm" },
                position: { my: "left-top", at: "left-top", of: "#graph" },
                panelSize: { width: 500, height: 500 },
            },
            detailPanelOptions: {
                id: "detailPanel",
                headerTitle: "节点详情",
                headerControls: { size: "sm" },
                position: { my: "right-top", at: "right-top", of: "#graph" },
                panelSize: { width: 500, height: 600 },
            },
            listPanelOptions: {
                id: "listPanel",
                headerTitle: "列表视图",
                headerControls: { size: "sm" },
                panelSize: { width: () => (window.innerWidth * 10) / 12, height: "calc(100vh - 22rem)" },
                callback: this.buildTreeList,
            },
            emptyTrees: emptyTrees,
            resultInfo: false,
            currentTasks: [],
        };
    },
    created() {
        this.panelStates = Array(this.treeListItems.length).fill(true)
    },
        beforeUnmount() {
        if (this.network && typeof this.network.destroy === "function") {
            this.network.destroy();
            this.network = null;
        }
    },
    computed: {
        trees() {
            return this.allTrees
                .filter((tree, index) => {
                    let logic = this.filterAny ? "some" : "every";
                    let result = true;
                    if (this.cluster) {
                        result &&= tree["graph"]["cluster_id"] === this.currentClusterId;
                    }
                    let filterResults = [];
                    if (this.selectedReactionClasses.length) {
                        filterResults.push(this.selectedReactionClasses[logic]((item) => this.reactionClassesByTree[index].has(item)));
                    }
                    if (this.selectedIntermediates.length) {
                        filterResults.push(this.selectedIntermediates[logic]((item) => this.intermediatesByTree[index].has(item)));
                    }
                    if (this.selectedStartingMaterials.length) {
                        filterResults.push(this.selectedStartingMaterials[logic]((item) => this.startingMaterialsByTree[index].has(item)));
                    }
                    if (filterResults.length) {
                        let filterResult = filterResults[logic]((item) => item);
                        if (this.filterInvert) {
                            filterResult = !filterResult;
                        }
                        result &&= filterResult;
                    }
                    return result;
                })
                .sort((aObj, bObj) => {
                    for (let { key, ascending } of this.treeSortInput) {
                        const a = aObj["graph"][key];
                        const b = bObj["graph"][key];
                        const c = ascending ? 1 : -1;
                        // Sort null values to end regardless of ascending or descending
                        const res = (a === null) - (b === null) || (a - b) * c;
                        if (res) {
                            // Return if comparison is not equal (i.e. 0)
                            return res;
                        }
                    }
                    // All comparisons were equal (i.e. 0)
                    return 0;
                });
        },
        routeRows() {
            return this.trees.map((tree, index) => ({
                key: `${this.routeId(index)}-${index}`,
                tree,
                metrics: this.getRouteMetrics(tree, index),
                steps: this.getRouteSteps(tree),
            }));
        },
        filteredRouteLabel() {
            const activeFilters = this.selectedReactionClasses.length + this.selectedIntermediates.length + this.selectedStartingMaterials.length;
            return activeFilters ? `${activeFilters} 项` : "无";
        },
        routeMoleculeImageSize() {
            return {
                width: 132,
                height: 92,
            };
        },
        currentTree() {
            // The current tree that is rendered in the main view
            return this.trees[this.currentTreeId];
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
                    "类似物数量": props["num_analogs"],
                };
                if (props["precursor_cost"] !== undefined) {
                    data["前体总成本"] = props["precursor_cost"];
                }
                if (props["atom_economy"] !== undefined) {
                    data["总体原子经济性"] = props["atom_economy"];
                }
                if (props["pmi"] !== undefined) {
                    data["平均 PMI"] = props["pmi"];
                }

                return data;
            } else {
                return null;
            }
        },
        maxClusterId() {
            if (!!this.allTrees.length && "cluster_id" in this.allTrees[0]["graph"]) {
                return Math.max(...this.allTrees.map((tree) => tree["graph"]["cluster_id"]));
            } else {
                return 0;
            }
        },
        minClusterId() {
            if (!!this.allTrees.length && "cluster_id" in this.allTrees[0]["graph"]) {
                return Math.min(...this.allTrees.map((tree) => tree["graph"]["cluster_id"]));
            } else {
                return 0;
            }
        },
        treeListItems() {

            if (this.trees.length > 0) {
                const start = (this.treeListCurrentPage - 1) * this.treeListItemsPerPage;
                const end = start + this.treeListItemsPerPage;
                return this.trees.slice(start, end);
            } else {
                return [];
            }
        },
        treeListMaxPage() {
            if (this.trees.length > 0) {
                return Math.ceil(this.trees.length / this.treeListItemsPerPage);
            } else {
                return 1;
            }
        },
        atomEconomyDisabled() {
            return !!this.allTrees.length && (this.allTrees[0]["graph"]["atom_economy"] === undefined || this.allTrees[0]["graph"]["atom_economy"] === null);
        },
        scoreDisabled() {
            return !!this.allTrees.length && (this.allTrees[0]["graph"]["score"] === undefined || this.allTrees[0]["graph"]["score"] === null);
        },
        depthDisabled() {
            return !!this.allTrees.length && (this.allTrees[0]["graph"]["depth"] === undefined || this.allTrees[0]["graph"]["depth"] === null);
        },
        clusterDisabled() {
            return !!this.allTrees.length && (this.allTrees[0]["graph"]["cluster_id"] === undefined || this.allTrees[0]["graph"]["cluster_id"] === null);
        },
        analogCountDisabled() {
            return !!this.allTrees.length && this.allTrees.some((tree) => tree["graph"]["num_analogs"] === undefined || tree["graph"]["num_analogs"] === null);
        },
        pmiDisabled() {
            return !!this.allTrees.length && this.allTrees.some((tree) => tree["graph"]["pmi"] === undefined || tree["graph"]["pmi"] === null);
        },
        treeSortOptions() {
            const options = [
                { value: "num_reactions", title: "反应总数" },
                { value: "first_step_score", title: "第一步模板得分" },
                { value: "first_step_plausibility", title: "第一步可行性" },
                { value: "avg_score", title: "平均模板得分" },
                { value: "min_score", title: "最低模板得分" },
                { value: "avg_plausibility", title: "平均可行性" },
                { value: "min_plausibility", title: "最低可行性" },
                { value: "precursor_cost", title: "前体总成本" },
            ];
            if (!this.depthDisabled) {
                options.push({ value: "depth", title: "最长线性路线长度" });
            }
            if (!this.analogCountDisabled) {
                options.push({ value: "num_analogs", title: "可生成类似物数量" });
            }
            if (!this.atomEconomyDisabled) {
                options.push({ value: "atom_economy", title: "总体原子经济性" });
            }
            if (!this.scoreDisabled) {
                options.push({ value: "score", title: "路线综合评分" });
            }
            if (!this.pmiDisabled) {
                options.push({ value: "pmi", title: "平均 PMI" });
            }
            return options;
        },
        target: {
            get() {
                return this.resultsStore.target;
            },
            set(value) {
                this.resultsStore.setTarget(value);
            },
        },
        allTrees: {
            get() {
                return this.resultsStore.trees;
            },
            set(value) {
                this.resultsStore.setTrees(value);
            },
        },
        ...mapStores(useResultsStore, useSettingsStore),
    },
    methods: {
        routeId(index) {
            return `R${String(index + 1).padStart(3, "0")}`;
        },
        compactSmiles(smiles) {
            if (!smiles) {
                return "未加载目标结构";
            }
            return smiles.length > 72 ? `${smiles.slice(0, 36)}...${smiles.slice(-24)}` : smiles;
        },
        formatMetric(value, suffix = "") {
            if (value === undefined || value === null || Number.isNaN(value)) {
                return "--";
            }
            return `${typeof value === "number" ? num2str(value) : value}${suffix}`;
        },
        formatNonNegativeMetric(value, suffix = "") {
            if (value === undefined || value === null || Number.isNaN(value) || Number(value) < 0) {
                return "N/A";
            }
            return this.formatMetric(value, suffix);
        },
        getReactionCount(tree) {
            return tree?.nodes?.filter((node) => node.type === "reaction").length || 0;
        },
        getRouteMetrics(tree, index) {
            const props = tree?.graph || {};
            const totalSteps = props.num_reactions ?? this.getReactionCount(tree);
            const linearSteps = props.depth ?? totalSteps;
            const difficulty = props.score ?? props.avg_score ?? props.avg_plausibility;
            const cost = props.precursor_cost;
            return {
                id: this.routeId(index),
                totalSteps: this.formatMetric(totalSteps),
                predictedSteps: this.formatMetric(totalSteps),
                linearSteps: this.formatMetric(linearSteps),
                difficulty: this.formatNonNegativeMetric(difficulty),
                cost: cost === undefined || cost === null ? "--" : `￥${num2str(cost)}/g`,
                sourceLabel: this.getRouteSourceLabel(tree),
            };
        },
        getRouteSourceLabel(tree) {
            const graph = tree?.graph || {};
            const value = String(graph.source_label || graph.route_source_engine || graph.engine || "");
            const normalized = value.toLowerCase();
            if (normalized.includes("aizynth")) return "AiZynthFinder";
            if (normalized.includes("askcos")) return "ASKCOS";
            return value || "ASKCOS";
        },
        routeStepStripClass(row) {
            return {
                "is-distributed-route": row.steps.length <= 6,
                "is-scroll-route": row.steps.length > 6,
            };
        },
        getDataNode(smilesOrNode) {
            const smiles = typeof smilesOrNode === "string" ? smilesOrNode : smilesOrNode?.smiles || smilesOrNode?.id;
            if (!smiles || !this.resultsStore?.dataGraph?.nodes) {
                return {};
            }
            return this.resultsStore.dataGraph.nodes.get(smiles) || {};
        },
        isBuyableDataNode(dataNode) {
            if (!dataNode) {
                return false;
            }
            if (dataNode.terminal === true) {
                return true;
            }
            if (typeof dataNode.ppg === "number") {
                return dataNode.ppg > 0;
            }
            return typeof dataNode.ppg === "string" && dataNode.ppg !== "" && dataNode.ppg !== "not buyable";
        },
        formatPrice(dataNode) {
            if (!dataNode || dataNode.ppg === undefined || dataNode.ppg === null || dataNode.ppg === "not buyable") {
                return "";
            }
            return typeof dataNode.ppg === "number" ? `单价 ${num2str(dataNode.ppg)}/g` : String(dataNode.ppg);
        },
        normalizePricingProperties(properties) {
            if (!properties) {
                return [];
            }
            return Array.isArray(properties) ? properties : [properties];
        },
        getPricingProperty(dataNode, keys) {
            const entries = [dataNode, ...this.normalizePricingProperties(dataNode?.properties)];
            for (const entry of entries) {
                if (!entry || typeof entry !== "object") {
                    continue;
                }
                for (const key of keys) {
                    const value = entry[key];
                    if (value !== undefined && value !== null && value !== "") {
                        return value;
                    }
                }
            }
            return "";
        },
        getPurchaseLink(dataNode) {
            const value = this.getPricingProperty(dataNode, ["link", "url", "product_url", "catalog_url", "supplier_url", "purchase_url"]);
            if (typeof value !== "string") {
                return "";
            }
            const link = value.trim();
            return /^https?:\/\//i.test(link) ? link : "";
        },
        getPurchaseTitle(dataNode) {
            const source = this.getPricingProperty(dataNode, ["source", "supplier"]);
            return source ? `${source} 采购链接` : "采购链接";
        },
        hasReactionChild(chemicalNode, successors, nodeMap) {
            return (successors.get(chemicalNode.id) || [])
                .map((id) => nodeMap.get(id))
                .some((node) => node?.type === "reaction");
        },
        pickNextReaction(chemicalNode, successors, nodeMap, visitedReactions) {
            return (successors.get(chemicalNode.id) || [])
                .map((id) => nodeMap.get(id))
                .filter((node) => node?.type === "reaction" && !visitedReactions.has(node.id))
                .sort((a, b) => {
                    const aData = this.getDataNode(a);
                    const bData = this.getDataNode(b);
                    return (aData.rank ?? Infinity) - (bData.rank ?? Infinity);
                })[0] || null;
        },
        pickNextChemical(reactionNode, successors, nodeMap, visitedChemicals) {
            const children = (successors.get(reactionNode.id) || [])
                .map((id) => nodeMap.get(id))
                .filter((node) => node?.type === "chemical" && !visitedChemicals.has(node.id));
            return children.find((node) => this.hasReactionChild(node, successors, nodeMap)) || children[0] || null;
        },
        formatReactionScore(reactionNode) {
            if (!reactionNode) {
                return "";
            }
            const dataNode = this.getDataNode(reactionNode);
            const score = dataNode.ffScore ?? dataNode.forwardScore ?? dataNode.averageModelScore ?? dataNode.retroScore;
            if (typeof score !== "number" || Number.isNaN(score)) {
                return "反应";
            }
            return score <= 1 ? `${Math.round(score * 100)}%` : `${num2str(score)}%`;
        },
        makeRouteStep(node, connectorReaction) {
            const smiles = node?.smiles || node?.id || "";
            const dataNode = this.getDataNode(smiles);
            return {
                id: node?.id || smiles,
                smiles,
                buyable: this.isBuyableDataNode(dataNode),
                isTarget: smiles === this.target,
                price: this.formatPrice(dataNode),
                purchaseLink: this.getPurchaseLink(dataNode),
                purchaseTitle: this.getPurchaseTitle(dataNode),
                connectorLabel: this.formatReactionScore(connectorReaction),
            };
        },
        getRouteSteps(tree) {
            const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
            const edges = Array.isArray(tree?.edges) ? tree.edges : [];
            const chemicals = nodes.filter((node) => node.type === "chemical");
            if (!chemicals.length) {
                return [];
            }
            const nodeMap = new Map(nodes.map((node) => [node.id, node]));
            const successors = new Map();
            const incoming = new Map();
            edges.forEach((edge) => {
                if (!successors.has(edge.from)) {
                    successors.set(edge.from, []);
                }
                successors.get(edge.from).push(edge.to);
                incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
            });
            const root = chemicals.find((node) => node.smiles === this.target || node.id === this.target)
                || chemicals.find((node) => !incoming.get(node.id))
                || chemicals[0];
            const targetToStarting = [];
            const visitedChemicals = new Set();
            const visitedReactions = new Set();
            let current = root;
            for (let guard = 0; current && guard < 8; guard += 1) {
                const reaction = this.pickNextReaction(current, successors, nodeMap, visitedReactions);
                targetToStarting.push({ node: current, reaction });
                visitedChemicals.add(current.id);
                if (!reaction) {
                    break;
                }
                visitedReactions.add(reaction.id);
                current = this.pickNextChemical(reaction, successors, nodeMap, visitedChemicals);
            }
            const sourceChain = targetToStarting.length > 1
                ? targetToStarting
                : chemicals.slice(0, 8).map((node) => ({ node, reaction: null }));
            return [...sourceChain].reverse().map((entry, index) => {
                const originalIndex = sourceChain.length - 1 - index;
                const connectorReaction = originalIndex > 0 ? sourceChain[originalIndex - 1].reaction : null;
                return this.makeRouteStep(entry.node, connectorReaction);
            });
        },
        toggleGraphMode() {
            this.showGraphMode = !this.showGraphMode;
            if (this.showGraphMode) {
                this.expandedRouteIndex = null;
                this.$nextTick(this.buildTree);
            }
        },
        toggleRouteInlineTree(index) {
            this.currentTreeId = index;
            this.showGraphMode = false;
            this.expandedRouteIndex = this.expandedRouteIndex === index ? null : index;
        },
        downloadTree(tree) {
            const blob = new Blob([JSON.stringify(tree)], { type: "data:text/json;charset=utf-8" });
            saveAs(blob, `${this.routeId(this.trees.indexOf(tree))}.json`);
        },
        openChemicalDetail(smiles) {
            const dataNode = this.getDataNode(smiles);
            this.selected = {
                id: smiles,
                smiles,
                type: "chemical",
                data: dataNode,
                disp: {},
            };
            if (dataNode.ppg === undefined) {
                this.resultsStore.updatePrice([smiles]).then(() => {
                    this.selected.data = this.getDataNode(smiles);
                });
            }
        },
        init() {
            this.$nextTick(() => {
                if (this.showGraphMode) {
                    this.buildTree();
                }
            });
        },
        downloadData(currentTree = false) {
            let blob;
            if (currentTree) {
                blob = new Blob([JSON.stringify(this.currentTree)], {
                    type: "data:text/json;charset=utf-8",
                });
            }
            else {
                blob = new Blob([JSON.stringify(this.trees)], {
                    type: "data:text/json;charset=utf-8",
                });
            }
            saveAs(blob, "treeResults.json");
        },
        async addResultsToIpp() {
            await this.resultsStore.addResultsToDispGraph({
                maxDepth: parseInt(this.maxDepthInput, 10),
                maxNum: parseInt(this.maxNumInput, 10),
            });
            this.$emit("switch-tab", "IPP");
        },
        addTreeToIpp(tree) {
            this.resultsStore.addTreeToDispGraph(tree);
            this.$emit("switch-tab", "IPP");
        },
        addTreesToIpp() {
            let selected = this.numTreesInput ? this.trees.slice(0, this.numTreesInput) : this.trees;
            selected.forEach(this.resultsStore.addTreeToDispGraph);
            this.$emit("switch-tab", "IPP");
        },
        loadNodeLinkGraph(data, showDetail = true) {
            /* Load tree in node link format into visjs and add visualization related attributes. */
            const graph = new RetroGraph(data.nodes, data.edges);

            if (showDetail) {
                /* For detail view, add extra visual attributes */
                graph.nodes.update(
                    data.nodes.map((node) => {
                        let dataNode = this.resultsStore.dataGraph.nodes.get(node["smiles"]);
                        if (node["type"] === "chemical") {
                            return makeChemicalDisplayNode({
                                id: node["id"],
                                data: dataNode,
                                target: this.target,
                                align: this.settingsStore.ippSettings.alignNodeImagesToTarget,
                                scale: false,
                            });
                        } else {
                            return makeReactionDisplayNode({
                                id: node["id"],
                                data: dataNode,
                                detail: true,
                            });
                        }
                    })
                );
                graph.edges.update(
                    data.edges.map((edge) => {
                        let from = graph.nodes.get(edge["from"]);
                        let to = graph.nodes.get(edge["to"]);
                        let reaction = from["type"] === "reaction" ? from["smiles"] : to["smiles"];
                        let reactionObj = this.resultsStore.dataGraph.nodes.get(reaction);
                        return makeDisplayEdge({
                            id: edge["id"],
                            from: edge["from"],
                            to: edge["to"],
                            value: reactionObj?.averageModelScore,
                        });
                    })
                );
            } else {
                graph.nodes.update(
                    data.nodes.map((node) => {
                        if (node.type === "chemical") {
                            return {
                                id: node.id,
                                image: getMolImageUrl(node.smiles),
                                shape: "image",
                            };
                        } else {
                            return {
                                id: node.id,
                                shape: "circle",
                            };
                        }
                    })
                );
            }

            return graph;
    },
    buildTree() {
        if (!this.currentTree || !this.$refs.graph) {
            return;
        }
        this.clearSelection();
            const elem = this.$refs.graph;
            if (this.network && typeof this.network.destroy === "function") {
                this.network.destroy();
            }
            this.networkData = this.loadNodeLinkGraph(this.currentTree, true);
            this.network = initializeNetwork(this.networkData, elem, true);
            this.network.on("selectNode", this.showNode);
            this.network.on("deselectNode", this.clearSelection);
        },
        addSortField() {
            this.treeSortInput.push({
                key: "num_reactions",
                ascending: true,
            });
        },
        deleteSortField(index) {
            this.treeSortInput.splice(index, 1);
        },
        setDefaultSortOrder(sortInput) {
            sortInput.ascending = ["num_reactions", "depth", "precursor_cost"].includes(sortInput.key);
        },
        changeTreeId(op) {
            let max = this.trees.length - 1;
            switch (op) {
                case "next":
                    if (this.currentTreeId < max) {
                        this.currentTreeId += 1;
                    }
                    break;
                case "prev":
                    if (this.currentTreeId > 0) {
                        this.currentTreeId -= 1;
                    }
                    break;
                case "first":
                    this.currentTreeId = 0;
                    break;
                case "last":
                    this.currentTreeId = max;
                    break;
                default:
                    console.error(`Unexpected operation '${op}' for changeTreeId.`);
            }
        },
        changeClusterId(op) {
            switch (op) {
                case "next":
                    if (this.currentClusterId < this.maxClusterId) {
                        this.currentClusterId += 1;
                    }
                    break;
                case "prev":
                    if (this.currentClusterId > this.minClusterId) {
                        this.currentClusterId -= 1;
                    }
                    break;
                case "first":
                    this.currentClusterId = this.minClusterId;
                    break;
                case "last":
                    this.currentClusterId = this.maxClusterId;
                    break;
                default:
                    console.error(`Unexpected operation '${op}' for changeClusterId.`);
            }
        },
        initializeFilterData() {
            if (!this.allTrees.length) {
                return;
            }
            this.initializeReactionClassFilter();
            this.initializeIntermediateFilter();
            this.initializeStartingMaterialFilter();
        },
        initializeReactionClassFilter() {
            const reactionClassesAvailable = this.resultsStore.dataGraph.nodes.get().some((node) => !!node["classNum"]);
            if (!reactionClassesAvailable) {
                return;
            }
            let allClasses = this.allTrees.map((tree) => {
                return Object.fromEntries(
                    tree.nodes
                        .filter((node) => node.type === "reaction")
                        .map((node) => {
                            let dataNode = this.resultsStore.dataGraph.nodes.get(node["smiles"]);
                            return [dataNode["classNum"], dataNode["className"]];
                        })
                );
            });
            this.reactionClassesByTree = Object.fromEntries(
                allClasses.map((classes, index) => {
                    return [index, new Set(Object.keys(classes))];
                })
            );
            this.reactionClassNames = allClasses.reduce((a, b) => Object.assign(a, b), {});
            this.reactionClassOptions = Object.entries(this.reactionClassNames)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([num, name]) => ({ text: `${num}: ${name}`, value: num }));
        },
        initializeIntermediateFilter() {
            this.intermediatesByTree = Object.fromEntries(
                this.allTrees.map((tree, index) => {
                    let intermediates = tree.nodes
                        .filter((node) => {
                            let result = node.type === "chemical" && !this.resultsStore.dataGraph.nodes.get(node["smiles"]).terminal;
                            if (this.resultsStore.savedResultInfo.type === "tree_builder") {
                                result &&= node.smiles !== this.resultsStore.savedResultInfo.smiles;
                            } else if (this.resultsStore.savedResultInfo.type === "graph_optimization") {
                                result &&= this.resultsStore.savedResultInfo.targets.includes(node.smiles);
                            }
                            return result;
                        })
                        .map((node) => node["smiles"]);
                    return [index, new Set(intermediates)];
                })
            );
            this.intermediateOptions = [
                ...Object.values(this.intermediatesByTree).reduce((a, b) => {
                    b.forEach((item) => a.add(item));
                    return a;
                }, new Set()),
            ].sort();
        },
        initializeStartingMaterialFilter() {
            this.startingMaterialsByTree = Object.fromEntries(
                this.allTrees.map((tree, index) => {
                    let startingMaterials = tree.nodes.filter((node) => node.type === "chemical" && this.resultsStore.dataGraph.nodes.get(node["smiles"]).terminal).map((node) => node["smiles"]);
                    return [index, new Set(startingMaterials)];
                })
            );
            this.startingMaterialOptions = [
                ...Object.values(this.startingMaterialsByTree).reduce((a, b) => {
                    b.forEach((item) => a.add(item));
                    return a;
                }, new Set()),
            ].sort();
        },
        showNode(selection, sourceNetworkData = this.networkData) {
            const nodeId = selection.nodes[0];
            const dispNode = sourceNetworkData.nodes.get(nodeId);
            const dataNode = this.resultsStore.dataGraph.nodes.get(dispNode.smiles);
            this.selected = {
                id: dispNode.id,
                smiles: dispNode.smiles,
                type: dispNode.type,
                data: dataNode,
                disp: dispNode,
            };
            if (dataNode.type === "chemical" && dataNode.ppg === undefined) {
                this.resultsStore.updatePrice([dataNode.id]).then(() => {
                    let newData = this.resultsStore.dataGraph.nodes.get(dispNode.smiles);
                    let newDisp = sourceNetworkData.nodes.get(dispNode.id);
                    this.selected["data"] = newData;
                    this.selected["disp"] = newDisp;
                });
            }
        },
        clearSelection() {
            this.selected = null;
        },
        buildTreeList() {
            /* Callback used by list view panel for drawing trees after panel creation */
            this.treeListItems.forEach((tree, index) => {
                let elem = document.getElementById(`treeList-${index}`);
                let networkData = this.loadNodeLinkGraph(tree, false);
                initializeNetwork(networkData, elem, false);
            });
        },
        async runPathwayRanking() {
            if (this.analysisTaskRunning) {
                alert("已有分析任务正在运行，请等待当前任务结束后再提交。");
                return;
            }
            try {
                const confirmed = await this.createConfirm({
                    title: "开始路线评分",
                    content: "将为当前结果启动路线评分任务。任务完成后页面会显示通知。是否继续？",
                    dialogProps: { width: "60%" }
                });

                if (!confirmed) {
                    return;
                }

                this.currentTasks.push("路线评分");
                const url = `/api/tree-analysis/controller/call-async`;
                const body = {
                    result_id: this.resultsStore.savedResultInfo.id,
                    task: "pathway_ranking",
                };

                const json = await API.post(url, body);
                this.createSnackbar({ text: "路线评分任务已提交。", snackbarProps: { timeout: 2000, vertical: true, color: "grey-darken-1" } });

                const output = await API.pollCeleryResult(json);
                if (output.success) {
                    this.createSnackbar({ text: "路线评分任务已完成，请刷新页面查看更新结果。", snackbarProps: { timeout: -1, vertical: true, color: "primary" } });
                } else {
                    this.createSnackbar({ text: `路线评分任务失败：${output.error}`, snackbarProps: { timeout: -1, vertical: true, color: "red-darken-1" } });
                }
            } catch {
                this.createSnackbar({ text: "路线评分任务失败，请重试或重新提交路线树任务。", snackbarProps: { timeout: -1, vertical: true, color: "red-darken-1" } });
            } finally {
                this.currentTasks = this.currentTasks.filter(task => task !== "路线评分");
                this.analysisTaskRunning = false;
            }
        },
        async runAnalogCounting(selectedTree = false) {
            if (this.analysisTaskRunning) {
                alert("已有分析任务正在运行，请等待当前任务结束后再提交。");
                return;
            }

            try {
                const confirmed = await this.createConfirm({
                    title: "开始类似物统计",
                    content: "将估算当前结果可生成的类似物数量。任务完成后页面会显示通知。是否继续？",
                    dialogProps: { width: "60%" },
                });

                if (!confirmed) {
                    return;
                }

                this.currentTasks.push("类似物统计");
                let selectTreeIdx = -1;
                if (selectedTree) {
                    selectTreeIdx = this.allTrees.indexOf(this.currentTree);
                }

                const url = `/api/tree-analysis/controller/call-async`;
                const body = {
                    result_id: this.resultsStore.savedResultInfo.id,
                    task: "count_analogs",
                    index: selectTreeIdx,
                    min_plausibility: this.resultsStore.savedResultInfo.tbSettings["filter_threshold"],
                };

                const json = await API.post(url, body);
                this.createSnackbar({ text: "类似物统计任务已提交。", snackbarProps: { timeout: 2000, vertical: true, color: "grey-darken-1" } });

                const output = await API.pollCeleryResult(json);
                if (output.success) {
                    this.createSnackbar({ text: "类似物统计任务已完成，请刷新页面查看更新结果。", snackbarProps: { timeout: -1, vertical: true, color: "primary" } });
                } else if (output.error) {
                    this.createSnackbar({ text: `类似物统计任务失败：${output.error}`, snackbarProps: { timeout: -1, vertical: true, color: "red-darken-1" } });
                }
            } catch {
                this.createSnackbar({ text: "类似物统计任务失败，请重试或重新提交路线树任务。", snackbarProps: { timeout: -1, vertical: true, color: "red-darken-1" } });
            } finally {
                this.currentTasks = this.currentTasks.filter(task => task !== "类似物统计");
                this.analysisTaskRunning = false;
            }
        },
        async runReactionClassification() {
            if (this.analysisTaskRunning) {
                alert("已有分析任务正在运行，请等待当前任务结束后再提交。");
            }
            try {
                const confirmed = await this.createConfirm({
                    title: "开始反应分类",
                    content: "将为当前结果启动反应分类任务。任务完成后页面会显示通知。是否继续？",
                    dialogProps: { width: "60%" }
                });
                if (!confirmed) {
                    return;
                }
                this.currentTasks.push("反应分类");
                const url = `/api/tree-analysis/controller/call-async`;
                const body = {
                    result_id: this.resultsStore.savedResultInfo.id,
                    task: "reaction_classification",
                };
                const json = await API.post(url, body);
                this.createSnackbar({ text: "反应分类任务已提交。", snackbarProps: { timeout: 2000, vertical: true, color: "grey-darken-1" } });
                const output = await API.pollCeleryResult(json);
                if (output.success) {
                    this.currentTasks = this.currentTasks.filter(task => task !== "反应分类");
                    this.createSnackbar({ text: "反应分类任务已完成，请刷新页面查看更新结果。", snackbarProps: { timeout: -1, vertical: true, color: "primary" } });
                } else {
                    this.currentTasks = this.currentTasks.filter(task => task !== "反应分类");
                    this.createSnackbar({ text: `反应分类任务失败：${output.error}`, snackbarProps: { timeout: -1, vertical: true, color: "red-darken-1" } });
                }
            } catch {
                this.currentTasks = this.currentTasks.filter(task => task !== "反应分类");
                this.createSnackbar({ text: "反应分类任务失败，请重试或重新提交路线树任务。", snackbarProps: { timeout: -1, vertical: true, color: "red-darken-1" } });
            }
        },
        async runPmiCalculation(selectedTree = false) {
            if (this.analysisTaskRunning) {
                alert("已有分析任务正在运行，请等待当前任务结束后再提交。");
                return;
            }

            try {
                const confirmed = await this.createConfirm({
                    title: "开始 PMI 计算",
                    content: "将为当前结果启动 PMI 计算。该分析可能耗时较长，取决于路线树和反应数量。任务完成后页面会显示通知。是否继续？",
                    dialogProps: { width: "60%" }
                });
                if (!confirmed) {
                    return;
                }
                this.currentTasks.push("PMI 计算");
                let selectTreeIdx = -1;
                if (selectedTree) {
                    selectTreeIdx = this.allTrees.indexOf(this.currentTree);
                }

                const url = `/api/tree-analysis/controller/call-async`;
                const body = {
                    result_id: this.resultsStore.savedResultInfo.id,
                    task: "pmi_calculation",
                    index: selectTreeIdx,
                };

                const json = await API.post(url, body);
                this.createSnackbar({ text: "PMI 计算任务已提交。", snackbarProps: { timeout: 2000, vertical: true, color: "grey-darken-1" } });

                await API.pollCeleryResult(json);
                this.createSnackbar({ text: "PMI 计算任务已完成，请刷新页面查看更新结果。", snackbarProps: { timeout: -1, vertical: true, color: "primary" } });
            } catch {
                this.createSnackbar({ text: "PMI 计算任务失败，请重试或重新提交路线树任务。", snackbarProps: { timeout: -1, vertical: true, color: "red-darken-1" } });
            } finally {
                this.currentTasks = this.currentTasks.filter(task => task !== "PMI 计算");
                this.analysisTaskRunning = false;
            }
        },
        num2str,
    },
    watch: {
        allTrees(newVal) {
            if (newVal.length) {
                this.initializeFilterData();
            }
        },
        cluster() {
            this.currentClusterId = this.minClusterId;
            this.currentTreeId = 0;
        },
        currentTree(newVal) {
            if (newVal && this.showGraphMode) {
                this.buildTree();
            } else {
                // this.network.destroy();
            }
        },
        tabActive(newVal) {
            if (newVal) {
                this.init();
            }
        },
        trees() {
            this.currentTreeId = 0;
            this.expandedRouteIndex = null;
        },
        treeListItems() {

            if (this.showListView) {
                // Build vis-networks on next tick to allow v-for divs to be created first
                this.$nextTick(this.buildTreeList);
            }
        },
    },
};
</script>

<style>
.route-list-workspace {
    width: min(100%, 100vw);
    min-height: calc(100vh - 48px);
    overflow-x: hidden;
    --route-card-width: 148px;
    --route-image-height: 88px;
    background: linear-gradient(180deg, #f6fffb 0%, #f8fbff 48%, #ffffff 100%);
    color: #102033;
}

.route-list-header {
    position: sticky;
    top: 0;
    z-index: 6;
    display: grid;
    grid-template-columns: minmax(240px, 1fr) auto auto;
    align-items: center;
    gap: 18px;
    padding: 12px 28px 10px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(18px) saturate(160%);
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.07);
}

.route-title-group,
.route-filter-bar,
.route-toolbar-actions,
.route-card-header,
.route-card-title,
.route-card-actions,
.route-graph-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
}

.route-title-group {
    min-width: 0;
    gap: 14px;
}

.route-back-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.1);
}

.route-eyebrow {
    margin: 0 0 2px;
    color: #13b889;
    font-size: 13px;
    font-weight: 700;
}

.route-title-group h1 {
    margin: 0;
    font-size: 28px;
    line-height: 1.1;
    font-weight: 800;
    letter-spacing: 0;
}

.route-search-tabs {
    display: flex;
    gap: 12px;
}

.route-search-tabs button {
    min-width: 168px;
    height: 40px;
    padding: 0 16px;
    border: 1px solid #d6dee8;
    border-radius: 12px;
    background: #ffffff;
    color: #172033;
    font-size: 14px;
    font-weight: 650;
}

.route-search-tabs button.active {
    border-color: #24c19a;
    background: #f0fffa;
    box-shadow: inset 0 0 0 1px rgba(36, 193, 154, 0.18);
}

.route-search-tabs button:disabled {
    color: #6b7280;
    cursor: not-allowed;
}

.route-search-tabs strong {
    float: right;
    margin-left: 12px;
    font-size: 17px;
}

.route-map-toggle {
    height: 38px;
    border-radius: 12px;
}

.route-list-layout {
    display: grid;
    grid-template-columns: minmax(190px, 226px) minmax(0, 1fr);
    gap: 18px;
    padding: 18px 28px 40px;
    max-width: 100%;
}

.route-target-sidebar {
    position: sticky;
    top: 72px;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: calc(100vh - 92px);
    overflow-y: auto;
    overscroll-behavior: contain;
}

.target-preview-card,
.route-side-section,
.route-results-panel,
.route-result-card,
.route-graph-card {
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 12px 34px rgba(20, 32, 54, 0.07);
}

.target-preview-card {
    overflow: hidden;
}

.target-preview-image {
    min-height: 148px;
    padding: 8px;
    background: #f8fafc;
}

.target-meta {
    display: grid;
    gap: 4px;
    padding: 10px;
    border-top: 1px solid rgba(15, 23, 42, 0.08);
}

.target-meta strong {
    font-size: 15px;
}

.target-meta span {
    color: #687386;
    font-size: 12px;
    line-height: 1.5;
    word-break: break-all;
}

.route-side-actions,
.side-toggle-row {
    display: grid;
    gap: 8px;
}

.route-side-section {
    padding: 10px;
}

.side-section-title,
.side-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.side-section-title {
    margin-bottom: 10px;
    color: #233044;
    font-weight: 750;
}

.side-row {
    width: 100%;
    min-height: 36px;
    padding: 0 9px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: #334155;
    text-align: left;
}

.side-row.active {
    background: #edf7ff;
}

.route-results-panel {
    min-width: 0;
    max-width: 100%;
    padding: 0;
    overflow: hidden;
}

.route-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.route-filter-bar {
    flex-wrap: wrap;
    color: #3b4658;
    font-weight: 650;
}

.route-filter-bar button {
    border: 0;
    background: transparent;
    color: #1f2937;
    font-weight: 650;
}

.route-sort-select {
    width: 160px;
}

.route-list-stack {
    display: grid;
    gap: 12px;
    padding: 12px;
}

.route-result-card {
    min-width: 0;
    padding: 12px 14px 14px;
    transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}

.route-result-card:hover,
.route-result-card.is-active {
    transform: translateY(-1px);
    border-color: rgba(36, 193, 154, 0.34);
    box-shadow: 0 16px 44px rgba(20, 32, 54, 0.1);
}

.route-card-header {
    display: grid;
    grid-template-columns: minmax(110px, auto) minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-width: 0;
    margin-bottom: 8px;
}

.route-card-title strong {
    font-size: 16px;
}

.route-source-chip {
    display: inline-flex;
    align-items: center;
    max-width: 132px;
    height: 22px;
    padding: 0 8px;
    overflow: hidden;
    border: 1px solid rgba(36, 193, 154, 0.22);
    border-radius: 999px;
    color: #047857;
    background: #ecfdf5;
    font-size: 11px;
    font-weight: 760;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.route-metrics {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px 12px;
    min-width: 0;
    margin: 0;
}

.route-metrics div {
    display: flex;
    align-items: baseline;
    gap: 6px;
}

.route-metrics dt {
    color: #7b8494;
    font-size: 12px;
    white-space: nowrap;
}

.route-metrics dd {
    margin: 0;
    color: #334155;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
}

.route-step-strip {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: 132px;
    display: flex;
    align-items: center;
    gap: 10px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 10px 12px 12px;
    border: 1px solid rgba(36, 193, 154, 0.2);
    border-radius: 14px;
    background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(246, 251, 255, 0.88) 100%),
        #f8fbff;
    scrollbar-gutter: stable;
    scrollbar-color: #b9c8d9 transparent;
    overscroll-behavior-inline: contain;
    overscroll-behavior-x: contain;
}

.route-step-strip.is-distributed-route {
    justify-content: space-between;
}

.route-step-strip.is-scroll-route {
    justify-content: flex-start;
    min-width: min-content;
}

.route-step-strip::-webkit-scrollbar {
    height: 8px;
}

.route-step-strip::-webkit-scrollbar-track {
    border-radius: 999px;
    background: #edf4fb;
}

.route-step-strip::-webkit-scrollbar-thumb {
    border: 2px solid #edf4fb;
    border-radius: 999px;
    background: #a9b8ca;
}

.route-step-card {
    position: relative;
    flex: 0 0 var(--route-card-width);
    min-height: 116px;
    display: grid;
    grid-template-rows: auto minmax(var(--route-image-height), 1fr) auto auto;
    gap: 4px;
    border: 1.5px solid rgba(138, 92, 246, 0.72);
    border-radius: 12px;
    background: #ffffff;
    color: #172033;
    text-align: left;
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.07);
    transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.route-step-card:hover,
.route-step-card:focus-visible {
    transform: translateY(-1px);
    border-color: rgba(59, 130, 246, 0.82);
    box-shadow: 0 14px 36px rgba(15, 23, 42, 0.12);
    outline: none;
}

.route-step-card.is-buyable {
    border-color: rgba(36, 193, 154, 0.85);
}

.route-step-card.is-target {
    border-color: rgba(59, 130, 246, 0.85);
}

.route-step-badge {
    justify-self: start;
    margin: 8px 8px 0;
    padding: 2px 7px;
    border-radius: 999px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 11px;
    font-weight: 750;
    line-height: 1.2;
}

.route-step-card.is-buyable .route-step-badge {
    background: #ecfdf5;
    color: #047857;
}

.route-step-card.is-target .route-step-badge {
    background: #eff6ff;
    color: #1d4ed8;
}

.route-step-image {
    width: 100%;
    min-height: var(--route-image-height);
    padding: 0 8px;
}

.route-step-smiles,
.route-step-price,
.route-step-footer {
    display: block;
    padding: 0 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.route-step-smiles {
    color: #48556a;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 10px;
}

.route-step-price {
    min-width: 0;
    padding: 0;
    color: #69758a;
    font-size: 11px;
    font-weight: 650;
}

.route-step-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-bottom: 8px;
}

.route-step-buy-link {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-height: 20px;
    padding: 2px 6px;
    border: 1px solid rgba(36, 193, 154, 0.28);
    border-radius: 999px;
    background: rgba(236, 253, 245, 0.88);
    color: #047857;
    font-size: 11px;
    font-weight: 750;
    line-height: 1;
    text-decoration: none;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}

.route-step-buy-link:hover,
.route-step-buy-link:focus-visible {
    border-color: rgba(36, 193, 154, 0.58);
    background: #dcfce7;
    color: #065f46;
    outline: none;
}

.route-step-arrow {
    flex: 0 0 42px;
    display: grid;
    justify-items: center;
    gap: 4px;
    color: #20b98b;
}

.route-step-arrow strong {
    min-height: 16px;
    font-size: 11px;
    font-weight: 800;
}

.route-step-empty {
    min-height: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px dashed rgba(148, 163, 184, 0.55);
    border-radius: 16px;
    background: #f8fafc;
    color: #64748b;
    font-weight: 650;
}

.route-inline-tree-panel {
    margin-top: 10px;
    padding: 12px;
    border: 1px solid rgba(59, 130, 246, 0.18);
    border-radius: 14px;
    background:
        linear-gradient(180deg, rgba(239, 246, 255, 0.78) 0%, rgba(255, 255, 255, 0.96) 100%),
        #ffffff;
    animation: routeInlineReveal 180ms ease-out;
}

.route-inline-tree-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
}

.route-inline-tree-heading strong {
    color: #172033;
    font-size: 14px;
    font-weight: 800;
}

.route-inline-tree-heading span {
    color: #64748b;
    font-size: 12px;
}

.route-inline-tree-strip {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px 4px 12px;
    scrollbar-color: #b9c8d9 transparent;
    overscroll-behavior-inline: contain;
}

.route-inline-tree-strip::-webkit-scrollbar {
    height: 6px;
}

.route-inline-tree-strip::-webkit-scrollbar-track {
    border-radius: 999px;
    background: rgba(226, 232, 240, 0.72);
}

.route-inline-tree-strip::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.78);
}

.route-inline-step-card {
    position: relative;
    flex: 0 0 178px;
    min-height: 138px;
    display: grid;
    grid-template-rows: auto minmax(92px, 1fr) auto auto;
    gap: 4px;
    border: 1.5px solid rgba(138, 92, 246, 0.72);
    border-radius: 14px;
    background: #ffffff;
    color: #172033;
    text-align: left;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
    transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.route-inline-step-card:hover,
.route-inline-step-card:focus-visible {
    transform: translateY(-1px);
    border-color: rgba(59, 130, 246, 0.82);
    box-shadow: 0 16px 34px rgba(15, 23, 42, 0.12);
    outline: none;
}

.route-inline-step-card.is-buyable {
    border-color: rgba(36, 193, 154, 0.85);
}

.route-inline-step-card.is-target {
    border-color: rgba(59, 130, 246, 0.85);
}

.route-inline-reaction-arrow {
    flex: 0 0 54px;
    display: grid;
    justify-items: center;
    gap: 4px;
    color: #20b98b;
}

.route-inline-reaction-arrow strong {
    min-height: 16px;
    color: #12a27b;
    font-size: 11px;
    font-weight: 800;
}

@keyframes routeInlineReveal {
    from {
        opacity: 0;
        transform: translateY(-4px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.route-graph-card {
    margin: 24px 24px 0;
    padding: 18px;
}

.route-graph-toolbar {
    justify-content: space-between;
    margin-bottom: 12px;
}

.route-graph-canvas {
    position: relative;
    min-height: 560px;
    border-radius: 12px;
    background: #f8fbff;
    overflow: hidden;
}

#graph {
    width: 100%;
    height: 560px;
}

.list-view-tree {
    height: 300px;
    border: 1px solid lightgray;
}

.vis-tooltip {
    padding: 0.5rem !important;
    background-color: #24a77d !important;
    font-family: unset !important;
    text-align: center !important;
}

@media (max-width: 1260px) {
    .route-list-header,
    .route-list-layout {
        padding-left: 22px;
        padding-right: 22px;
    }

    .route-list-header {
        grid-template-columns: 1fr;
    }

    .route-search-tabs button {
        flex: 1;
        min-width: 0;
    }

    .route-list-layout {
        grid-template-columns: 1fr;
    }

    .route-target-sidebar {
        position: static;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .route-list-workspace {
        --route-card-width: 144px;
        --route-image-height: 84px;
    }

    .route-step-card {
        flex-basis: var(--route-card-width);
    }
}

@media (max-width: 760px) {
    .route-target-sidebar,
    .route-toolbar,
    .route-card-header {
        display: grid;
        grid-template-columns: 1fr;
    }

    .route-list-workspace {
        --route-card-width: 136px;
        --route-image-height: 80px;
    }

    .route-step-strip {
        padding: 10px;
    }

    .route-step-card {
        flex-basis: var(--route-card-width);
    }
}
</style>
