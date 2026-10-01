<template>
  <js-panel :visible="!!selected && visible" :options="detailPanelOptions" @close="clearEmit"
    :class="isDark ? 'bg-grey-darken-3' : 'bg-white'">
    <div id="details" class="overflow-auto">
      <template v-if="selected">
        <template v-if="selected.type === 'chemical'">
          <div data-cy="ipp-node-details-smiles" class="details-top text-center">
            <copy-tooltip :data="selected.smiles">
              <i class="far fa-copy mr-1"></i>
              <b>SMILES: </b>
              {{ selected.smiles }}
            </copy-tooltip>
            <div><b>最低价格 ($/g): </b>{{ selected.data.ppg }}</div>
            <div v-if="selected.data.source"><b>最低价来源: </b>{{ Array.isArray(selected.data.source) ? selected.data.source[0] : selected.data.source }}</div>
            <div v-if="selected.data.smilesMatch">
              <copy-tooltip :data="selected.data.smilesMatch">
                <i class="far fa-copy mr-1"></i>
                <b>匹配的可采购结构: </b>{{ selected.data.smilesMatch }}
              </copy-tooltip>
            </div>
            <v-btn class="my-2" color="primary" variant="tonal" prepend-icon="mdi-cart-variant"
              :href="`/buyables?q=${encodeURIComponent(selected.smiles)}`" target="_blank"
              data-cy="node-details-search-buyables">检索可采购原料</v-btn>
            <ketcher-min id="ketcher-min-chemical" ref="ketcher-min" class="position-relative"
              :apply-abs-labels="true" @change="selectedAtoms = $event"></ketcher-min>
            <div v-if="!!selected.stats">
              <p>
                <small>
                  圆点大小 = 涉及该原子的反应数量（{{ selected.stats.reactions.min }} - {{
                  selected.stats.reactions.max }}）<br />
                  圆点颜色 = 涉及该原子的聚类数量（<span style="color: #c0f0c0">&cir;</span> {{
                  selected.stats.clusters.min }} - {{ selected.stats.clusters.max }}
                  <span style="color: #005020">&cir;</span>)
                </small>
              </p>
            </div>
          </div>
          <div class="d-flex justify-center pa-2 ma-2">
            <v-btn-group divided density="compact" rounded="pill">
              <v-tooltip location="bottom">
                <template v-slot:activator="{ props }">
                  <v-btn v-bind="props" id="expand-btn-side" variant="flat" color="orange-darken-1"
                    data-cy="node-details-select" @click="$emit('selectAllOccur')"
                    prepend-icon="mdi mdi-select-all">选择</v-btn>
                </template>
                <span>选择所有相同节点</span>
              </v-tooltip>
              <v-tooltip location="bottom">
                <template v-slot:activator="{ props }">
                  <v-btn v-bind="props" id="expand-btn-side" variant="flat" color="red-darken-1"
                    data-cy="node-details-delete" @click="$emit('deleteChoice')"
                    prepend-icon="mdi mdi-delete-empty">删除</v-btn>
                </template>
                <span>删除子节点</span>
              </v-tooltip>
              <v-tooltip location="bottom">
                <template v-slot:activator="{ props }">
                  <v-btn v-bind="props" id="expand-btn-side" variant="flat" color="blue-darken-1"
                    data-cy="node-details-collapse" @click="$emit('collapseNode')"
                    prepend-icon="mdi mdi-collapse-all">折叠</v-btn>
                </template>
                <span>折叠子节点</span>
              </v-tooltip>
            </v-btn-group>
          </div>
          <v-divider class="my-2" :thickness="2"></v-divider>
          <div id="chemical-node-toolbar" class="d-flex justify-center flex-gap-2 flex-wrap">
            <v-btn id="expand-btn-side" variant="flat" color="primary" @click="expandNode"
              data-cy="node-details-expand-node">
              展开节点 </v-btn>
            <v-btn id="notes" variant="flat" color="deep-orange" data-cy="node-details-view-notes"
              @click="dispNotes = !dispNotes"> {{ !dispNotes ? "查看" : "隐藏" }}备注 </v-btn>
            <v-btn id="add-precursor-btn" variant="flat" color="light-blue" @click="openAddNewPrecursorModal()"
              data-cy="node-details-add-precursor"> 添加前体
            </v-btn>
            <v-menu location="bottom">
              <template v-slot:activator="{ props }">
                <v-btn dark v-bind="props" data-cy="node-details-view-recommended-templates" variant="flat"
                  color="primary" prepend-icon="mdi-view-list">
                  查看推荐模板
                </v-btn>
              </template>
              <v-list>
                <v-list-item v-for="(templateSet, index) in templateSets" :key="index">
                  <v-btn :data-cy="(templateSet)" variant="tonal" @click="recBtn(templateSet)">{{ templateSet }}</v-btn>
                </v-list-item>
              </v-list>
            </v-menu>
            <ban-button id="ban-chemical-btn" :smiles="selected.smiles" :type="selected.type"
              data-cy="node-details-ban-chemical-button"></ban-button>
          </div>
          <div class="d-flex flex-row align-center">
            <h3>前体</h3>
            <v-spacer></v-spacer>
            <v-switch id="allowCluster" v-model="allowCluster" name="allow-cluster-switch"
              data-cy="node-detail-cluster-toggle" @change="resetSortingCategory" label="按反应聚类"
              density="compact" hide-details color="primary">
            </v-switch>
            <v-spacer></v-spacer>
            <v-switch id="invertAtomFilter" v-model="invertAtomFilter" name="invert-atom-filter-switch"
              label="反选原子过滤" density="compact" hide-details color="primary">
            </v-switch>
          </div>
          <div>
            <v-select :items="sortingCategoryItems" label="排序依据" style="width: 100%" class="px-2" hide-details
              data-cy="node-details-sort-by" variant="outlined" density="compact" v-model="sortingCategory">
              <template v-slot:append>
                <v-btn @click="sortOrderAscending = !sortOrderAscending" variant="tonal"
                  data-cy="node-details-sort-order">
                  <template v-slot:append>
                    <v-icon v-if="sortOrderAscending">mdi-sort-descending</v-icon>
                    <v-icon v-else>mdi-sort-ascending</v-icon>
                  </template>
                  {{ sortOrderAscending ? "升序" : "降序" }}
                </v-btn>
              </template>
            </v-select>
          </div>

          <div id="Notes" v-if="dispNotes" class="my-3 scroll-list pa-0">
            <v-row v-for="(note, idx) in selected.disp.notes" :key="note.date + idx">
              <v-col cols="12">
                <v-card>
                  <v-card-title class="d-flex justify-space-between" :id="'note-title-' + (idx)">
                    <span>{{ note.user }}</span>
                    <small>{{ note.date }}</small>
                  </v-card-title>
                  <v-card-text v-if="editIdx !== idx" :id="'note-comment-' + (idx)">
                    {{ note.comment }}
                  </v-card-text>
                  <v-card-actions v-if="editIdx !== idx">
                    <v-btn outlined color="primary" @click="editIdx = idx; oldNote = note.comment;"
                      :id="'note-edit-button-' + (idx)">编辑备注</v-btn>
                  </v-card-actions>
                  <v-card-text v-if="editIdx === idx">
                    <v-textarea v-model="note.comment" :counter="1000" outlined rows="4"
                      :id="'note-edit-comment-' + (idx)"></v-textarea>
                  </v-card-text>
                  <v-card-actions v-if="editIdx === idx" class="d-flex justify-space-between">
                    <v-btn outlined color="primary" @click="editIdx = -1; note.comment = oldNote; oldNote = '';"
                      :id="'note-edit-cancel-change-' + (idx)">取消修改</v-btn>
                    <div>
                      <v-btn outlined color="primary" @click="editNote(idx, false); editIdx = -1; oldNote = '';"
                        :id="'note-edit-save-change-' + (idx)">保存修改</v-btn>
                      <v-btn outlined color="error" @click="editNote(idx, true); editIdx = -1; oldNote = '';"
                        :id="'note-edit-delete-note-' + (idx)">删除备注</v-btn>
                    </div>
                  </v-card-actions>
                </v-card>
              </v-col>
            </v-row>
            <v-row class="pa-0 ma-0">
              <v-col class="d-flex justify-center">
                <v-btn class="align-center" variant="flat" color="primary" id="addNote"
                  data-cy="node-details-add-note" @click="addNote = !addNote">添加备注</v-btn>
              </v-col>
            </v-row>
          </div>
          <div v-show="addNote" id="addNotes" class="mx-2 px-2 scroll-list">
            <v-row class="pa-0 ma-0">
              <v-col>
                <v-text-field label="姓名" v-model="noteUrsName" placeholder="请输入姓名" density="compact"
                  variant="outlined" hide-details clearable id="note-user-name"
                  data-cy="network-view_input_user-name"></v-text-field>
              </v-col>
            </v-row>
            <v-row class="pa-0 ma-0">
              <v-col>
                <v-textarea label="备注" v-model="noteComment" density="compact" variant="outlined"
                  placeholder="请输入备注，最多 1000 个字符。" :rows="4"
                  hide-details :counter="1000" id="note-comment" data-cy="network-view_input_user-comment"></v-textarea>
              </v-col>
            </v-row>
            <v-row class="pa-0 ma-0">
              <v-col class="d-flex justify-center flex-gap-2 flex-wrap mb-2">
                <v-btn variant="flat" color="primary" class="mr-2" data-cy="network-view_button_save-note"
                  @click="saveNote">保存备注</v-btn>
                <v-btn variant="outlined" data-cy="network-view_button_cancel-note" @click="clearNote">取消</v-btn>
              </v-col>
            </v-row>
          </div>

          <div v-if="!resultsAvailable" class="text-center mt-5" style="height:55vh">
            <p class="lead">点击上方“展开节点”可为该目标预测前体。</p>
            <div class="text-center justify-center mx-10">
              <v-text-field variant="outlined" v-model="reactionLimit" hide-details density="compact" number>
                <template v-slot:prepend>
                  添加前
                </template>
                <template v-slot:append>
                  {{ allowCluster ? "个聚类" : "个前体" }}到图谱视图
                </template>
              </v-text-field>
            </div>
          </div>
          <div v-else class="scroll-list">
            <div v-for="res in currentPrecursors" :key="res.rank" class="my-2 mx-2">
              <v-card no-body class="custom-shadow text-center py-2 px-2" :id="'card-' + (res.rank)">
                <v-row class="justify-center align-center">
                  <v-col>
                    <v-img :src="getMolDrawEndPoint(res, true)" fluid :class="(isDark ? ' invert' : '')"></v-img>
                  </v-col>
                  <v-col>
                    <v-table class="precursor-table table table-sm table-border ma-0" density="compact">
                      <tbody>
                        <tr >
                          <td>排序</td>
                          <td>#{{res.rank }}</td>
                        </tr>
                        <tr>
                          <td>前体评分</td>
                          <td>{{ res.retroScore !== undefined ? num2str(res.retroScore) : "N/A" }}</td>
                        </tr>
                        <tr>
                          <td>平均模型评分</td>
                          <td>{{ res.averageModelScore !== undefined ? num2str(res.averageModelScore) : "N/A" }}</td>
                        </tr>
                        <tr v-if="res.scscore !== undefined">
                          <td>合成复杂度</td>
                          <td>{{ num2str(res.scscore) }}</td>
                        </tr>
                        <tr>
                          <td>示例总数</td>
                          <td>{{ res.totalNumExamples !== undefined ? res.totalNumExamples : "N/A" }}</td>
                        </tr>
                        <!-- <tr v-if="res.rmsMolwt !== undefined">
                          <td>RMS molecular weight</td>
                          <td>{{ num2str(res.rmsMolwt) }}</td>
                        </tr>
                        <tr v-if="res.numRings !== undefined">
                          <td>Number of rings</td>
                          <td>{{ res.numRings }}</td>
                        </tr> -->
                        <!-- <tr>
                          <td>Template rank</td>
                          <td>{{ res.templateRank }}</td>
                        </tr>
                        <tr>
                          <td>Template score</td>
                          <td>{{ num2str(res.templateScore) }}</td>
                        </tr> -->
                        <tr>
                          <td>可行性</td>
                          <td>{{ num2str(res.ffScore) }}</td>
                        </tr>
                        <tr v-if="res.clusterName !== undefined">
                          <td>反应聚类</td>
                          <td>{{ res.clusterName }}</td>
                        </tr>
                      </tbody>
                    </v-table>
                  </v-col>
                </v-row>
                <div class="row no-gutters">
                  <div class="col my-2">
                    <v-tooltip location="bottom">
                      <template v-slot:activator="{ props }">
                        <v-btn v-bind="props" v-show="!(selected.id in res.inVis)" variant="flat" color="primary"
                          class="addRes mr-1" :data-rank="res.rank" @click="addFromResults(selected, res)"
                          icon="mdi-plus" density="compact">
                        </v-btn>
                      </template>
                      <span v-if="isRootInResult(res)">风险：该反应把根目标重新作为前体，可能形成自循环。请确认后再加入。</span>
                      <span v-else>加入画布</span>
                    </v-tooltip>
                    <v-btn v-show="selected.id in res.inVis" variant="flat" color="red" class="remRes mr-1"
                      id="hide-from-canvas" title="移除节点" :data-rank="res.rank"
                      @click="remFromResults(selected, res)" icon="mdi-minus" density="compact">
                    </v-btn>
                    <v-btn variant="flat" :data-rank="res.rank" title="打开聚类面板" id="open-cluster-modal"
                      @click="openClusterPopoutModal(selected, res)" icon="mdi-group" density="compact">
                    </v-btn>
                    <v-btn id="delete-from-canvas" variant="flat" color="red" @click="deleteFromGraph(res)"
                      title="永久删除" class="ml-1" density="compact" icon="mdi-delete">
                    </v-btn>
                  </div>
                </div>
              </v-card>
            </div>
          </div>
        </template>
        <template v-else-if="selected.type === 'reaction'">
          <div class="details-top text-center pb-5" style="height:100vh">
            <copy-tooltip :data="selected.smiles">
              <i class="far fa-copy mr-1"></i>
              <b>SMILES: </b>
              {{ selected.smiles }}
            </copy-tooltip>
            <smiles-image :smiles="selected.smiles" :align="settingsStore.ippSettings.alignPrecursorsToProduct">
            </smiles-image>
            <div class="d-flex justify-center pa-2 ma-2">
              <v-btn-group divided density="compact" rounded="pill">
                <v-tooltip location="bottom">
                  <template v-slot:activator="{ props }">
                    <v-btn v-bind="props" id="expand-btn-side" variant="flat" color="orange-darken-1"
                      data-cy="node-details-reaction-select" @click="$emit('selectAllOccur')"
                      prepend-icon="mdi mdi-select-all">选择</v-btn>
                  </template>
                  <span>选择所有相同节点</span>
                </v-tooltip>
                <v-tooltip location="bottom">
                  <template v-slot:activator="{ props }">
                    <v-btn v-bind="props" id="expand-btn-side" variant="flat" color="red-darken-1"
                      data-cy="node-details-reaction-delete" @click="$emit('deleteChoice')"
                      prepend-icon="mdi mdi-delete-empty">删除</v-btn>
                  </template>
                  <span>删除子节点</span>
                </v-tooltip>
                <v-tooltip location="bottom">
                  <template v-slot:activator="{ props }">
                    <v-btn v-bind="props" id="expand-btn-side" variant="flat" color="blue-darken-1"
                      data-cy="node-details-reaction-collapse" @click="$emit('collapseNode')"
                      prepend-icon="mdi mdi-collapse-all">折叠</v-btn>
                  </template>
                  <span>折叠子节点</span>
                </v-tooltip>
              </v-btn-group>
            </div>
            <v-divider class="my-2" :thickness="2"></v-divider>
            <v-btn class="my-3" variant="outlined"
              :href="conditionRecommendationUrl" target="_blank"
              data-cy="node-details-reaction-evaluate-reaction">推荐反应条件</v-btn>
            <div class="text-left mx-2">
              <v-table :class="'ma-0' + (isDark ? ' bg-grey-darken-3' : 'bg-white')" density="compact">
                <tbody>
                  <tr>
                    <th>前体评分</th>
                    <td>{{ num2str(selected.data.retroScore) }}</td>
                  </tr>
                  <tr>
                    <th>平均模型评分</th>
                    <td>{{ num2str(selected.data.averageModelScore) }}</td>
                  </tr>
                  <tr>
                    <th>可行性</th>
                    <td>{{ num2str(selected.data.ffScore) }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>

            <reaction-evidence-panel :evidence-input="selectedReactionEvidenceInput" />

            <div class="ma-2" v-if="selected.data.selecError">
              <v-alert type="warning">无法检查该反应的区域选择性，可能与产物中的立体化学信息有关。</v-alert>
            </div>
            <template v-if="'outcomes' in selected.data">
              <div class="ma-2">
                <h6 class="ma-0 text-h6">区域选择性产物</h6>
              </div>
              <div class="d-flex justify-center flex-gap-2 flex-wrap ma-2">
                <v-btn id="predict-selectivity" variant="outlined" @click="predictSelectivity">预测选择性
                </v-btn>
              </div>
              <div class="scroll-list">
                <div class="grid-wrapper">
                  <v-card v-for="(res, index) in selected.data.outcomes" class="custom-shadow ma-2 pa-2" :key="index">
                    <div class="container-fluid d-flex flex-column h-100 justify-content-between">
                      <v-row>
                        <v-col>
                          <img :src="getMolDrawEndPoint(res)" class="ma-1"
                            :class="res === selected.smiles.split('>>')[1] ? 'grey-border' : ''"
                            style="max-width: 100%" />
                        </v-col>
                      </v-row>
                      <v-row>
                        <v-col v-if="selected.data.selectivity[index]">
                          得分 {{ num2str(selected.data.selectivity[index]) }}
                          <span v-if="selected.data.selectivity[index] === Math.max(...selected.data.selectivity)">
                            <i class="fas fa-check"></i>
                          </span>
                          <span v-else>
                            <i class="fas fa-times"></i>
                          </span>
                        </v-col>
                      </v-row>
                    </div>
                  </v-card>
                </div>
              </div>
            </template>

            <div>
              <v-card class="ma-2 pa-2" variant="outlined">
                <v-card-title class="text-h6">模型详情</v-card-title>
                <v-card-text>
                  <div v-for="(model, index) in selected.data.modelMetadata" :key="index" class="mb-4">
                    <v-divider v-if="index > 0" class="my-2"></v-divider>
                    <div class="d-flex align-center mb-2">
                      <v-chip color="primary" class="mr-2" size="small">
                        {{ model.backend }}
                      </v-chip>
                      <v-chip color="secondary" size="small">
                        {{ model.model_name }}
                      </v-chip>
                    </div>
                    <v-table density="compact" class="mt-2">
                      <tbody>
                        <tr>
                          <td class="font-weight-bold">得分</td>
                          <td>{{ num2str(model.model_score) }}</td>
                        </tr>
                        <tr>
                          <td class="font-weight-bold">归一化得分</td>
                          <td>{{ num2str(model.normalized_model_score) }}</td>
                        </tr>
                        <tr>
                          <td class="font-weight-bold">排序</td>
                          <td>#{{ model.rank }}</td>
                        </tr>
                      </tbody>
                    </v-table>

                    <!-- Template Details -->
                    <div v-if="model.source && model.source.template" class="mt-2">
                      <v-expansion-panels>
                        <v-expansion-panel>
                          <v-expansion-panel-title data-cy="ipp-template-details">模板详情</v-expansion-panel-title>
                          <v-expansion-panel-text>
                            <v-table density="compact">
                              <tbody>
                                <tr v-if="model.source.template.reaction_smarts">
                                  <td class="font-weight-bold">Reaction SMARTS</td>
                                  <td>{{ model.source.template.reaction_smarts }}</td>
                                </tr>
                                <tr>
                                  <td class="font-weight-bold">示例数</td>
                                  <td>{{ model.source.template.num_examples }}</td>
                                </tr>
                                <tr>
                                  <td class="font-weight-bold">模板得分</td>
                                  <td>{{ num2str(model.source.template.template_score) }}</td>
                                </tr>
                                <tr>
                                  <td class="font-weight-bold">模板排序</td>
                                  <td>#{{ model.source.template.template_rank }}</td>
                                </tr>
                                <tr v-if="model.source.template.necessary_reagent">
                                  <td class="font-weight-bold">必要试剂</td>
                                  <td>{{ model.source.template.necessary_reagent }}</td>
                                </tr>
                                <tr v-if="model.source.template.tforms">
                                  <td class="font-weight-bold">Tforms</td>
                                  <td>
                                    <ul class="pa-0 ma-0" style="list-style-type: none;">
                                      <li v-for="tform in model.source.template.tforms" :key="tform">
                                        <a :id="'template-' + (model.source.template.template_rank)"
                                          :href="'/template?id=' + tform.trim()" target="_blank">{{ tform.trim() }}({{
                                            resultsStore.templateSetSource[ tform.trim()] }}, {{
                                            resultsStore.templateNumExamples[
                                            tform.trim()] }} 个示例)
                                        </a>
                                      </li>
                                    </ul>
                                  </td>
                                </tr>
                              </tbody>
                            </v-table>
                          </v-expansion-panel-text>
                        </v-expansion-panel>
                      </v-expansion-panels>
                    </div>

                    <!-- Reference Reaction Details -->
                    <reaction-evidence-panel
                      v-if="model.source && model.source.reaction_data"
                      :evidence-input="modelReactionEvidenceInput(model)"
                    />

                    <!-- Model Attributes -->
                    <div v-if="model.attributes && Object.keys(model.attributes).length > 0" class="mt-2">
                      <v-expansion-panels>
                        <v-expansion-panel>
                          <v-expansion-panel-title>模型属性</v-expansion-panel-title>
                          <v-expansion-panel-text>
                            <v-table density="compact">
                              <tbody>
                                <tr v-for="(value, key) in model.attributes" :key="key">
                                  <td class="font-weight-bold">{{ key }}</td>
                                  <td>{{ Array.isArray(value) ? (value.length ? value.join(', ') : "N/A") : value }}
                                  </td>
                                </tr>
                              </tbody>
                            </v-table>
                          </v-expansion-panel-text>
                        </v-expansion-panel>
                      </v-expansion-panels>
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </div>
            <div class="btn-toolbar justify-content-end mx-2">
              <ban-button :smiles="selected.smiles" :type="selected.type"
                data-cy="node-details-ban-reaction-button"></ban-button>
            </div>
          </div>
        </template>
      </template>
    </div>
  </js-panel>

  <v-dialog id="cluster-view-modal" v-model="showClusterPopoutModal" min-width="600px">
    <v-card>
      <v-card-title>查看聚类</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <div class="d-flex justify-center mb-3">
          <v-btn-group variant="outlined" density="comfortable" divided :border="true">
            <v-btn icon="mdi mdi-chevron-left" @click="clusterPopoutModalDecGroupID()"
              data-cy="node-details-clustering-left"></v-btn>
            <!--  TODO: Make it a drop down option -->
            <v-btn variant="tonal">{{ selectPopoutClusterName(selectedClusterId) }}</v-btn>
            <v-btn icon="mdi mdi-chevron-right" @click="clusterPopoutModalIncGroupID()"
              data-cy="node-details-clustering-right"></v-btn>
          </v-btn-group>
        </div>
        <div class="scroll-list">
          <div class="grid-wrapper">
            <v-card no-body class="custom-shadow ma-2 pa-2" v-for="res in currentClusterViewPrecursors" :key="res.id">
              <div class="d-flex flex-column justify-space-between" style="height:100%">
                <div>
                  <v-table class="ma-0">
                    <tbody :id="'cluster-card-' + (res.rank)">
                      <tr v-if="res.precursorRank !== undefined && !res.isCustom">
                        <td>排序</td>
                        <td>#{{ res.precursorRank }}</td>
                      </tr>
                      <tr v-if="clusterPopoutModalData.optionsDisplay.showScore">
                        <td>前体评分</td>
                        <td>{{ num2str(res.retroScore) }}</td>
                      </tr>
                      <tr v-if="clusterPopoutModalData.optionsDisplay.showModelScore">
                        <td>平均模型评分</td>
                        <td>{{ num2str(res.averageModelScore) }}</td>
                      </tr>
                      <tr v-if="clusterPopoutModalData.optionsDisplay.showSCScore">
                        <td>合成复杂度</td>
                        <td>{{ num2str(res.scscore) }}</td>
                      </tr>
                      <tr v-if="clusterPopoutModalData.optionsDisplay.showNumExample">
                        <td>示例总数</td>
                        <td>{{ res.totalNumExamples }}</td>
                      </tr>
                      <tr v-if="clusterPopoutModalData.optionsDisplay.showPlausibility">
                        <td>可行性</td>
                        <td>{{ num2str(res.ffScore) }}</td>
                      </tr>
                      <tr v-if="clusterPopoutModalData.optionsDisplay.showClusterId">
                        <td>反应聚类</td>
                        <td>{{ res.clusterName }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </div>
                <div>
                  <img :src="getMolDrawEndPoint(res, true)" style="max-width:100%" />
                </div>
                <div class="text-right">
                  <button v-if="clusterPopoutModalData.selected.id in res.inVis" class="remRes btn btn-sm btn-danger"
                    :data-rank="res.rank" @click="remFromResults(clusterPopoutModalData.selected, res)">
                    <i class="fas fa-minus"></i>
                  </button>
                  <button v-else class="addRes btn btn-sm btn-primary" :data-rank="res.rank"
                    :title="isRootInResult(res) ? '风险：该反应把根目标重新作为前体，可能形成自循环。请确认后再加入。' : '加入画布'"
                    @click="addFromResults(clusterPopoutModalData.selected, res)">
                    <i class="fas fa-plus"></i>
                  </button>
                </div>
              </div>
            </v-card>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <div>
          <v-btn variant="flat" class="mr-1" id="node-details-clustering-add-precursor"
            @click="openAddNewPrecursorModal(clusterPopoutModalData['selectedSmiles'], clusterPopoutModalData['clusterId'], clusterPopoutModalData['clusterName'])"
            title="添加前体" icon="mdi-plus" color="primary">
          </v-btn>
          <v-btn variant="flat" @click="
            showClusterPopoutModal = false;
          openClusterEditModal(clusterPopoutModalData['selected'], clusterPopoutModalData['clusterId'], clusterPopoutModalData['clusterName']);
          " title="编辑聚类" color="orange" icon="mdi-pencil" class="mr-1"
            id="node-details-clustering-edit-cluster">
          </v-btn>
        </div>
        <div class="form-check-inline">
          <input class="form-check-input" id="cpShowScore" type="checkbox"
            v-model="clusterPopoutModalData.optionsDisplay.showScore" />
          <label class="form-check-label mr-2" for="cpShowScore">前体评分</label>
          <input class="form-check-input" id="cpShowModelScore" type="checkbox"
            v-model="clusterPopoutModalData.optionsDisplay.showModelScore" />
          <label class="form-check-label mr-2" for="cpShowModelScore">平均模型评分</label>
          <input class="form-check-input" id="cpShowSCScore" type="checkbox"
            v-model="clusterPopoutModalData.optionsDisplay.showSCScore" />
          <label class="form-check-label mr-2" for="cpShowSCScore">合成复杂度</label>
          <input class="form-check-input" id="cpShowNumEx" type="checkbox"
            v-model="clusterPopoutModalData.optionsDisplay.showNumExample" />
          <label class="form-check-label mr-2" for="cpShowNumEx">示例总数</label>
          <input class="form-check-input" id="cpShowPlaus" type="checkbox"
            v-model="clusterPopoutModalData.optionsDisplay.showPlausibility" />
          <label class="form-check-label mr-2" for="cpShowPlaus">可行性</label>
        </div>
        <v-btn variant="flat" @click="showClusterPopoutModal = false" color="primary"
          id="node-detail-cluster-close">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog id="cluster-edit-modal" v-model="showClusterEditModal" min-width="600px" @close="closeClusterEditModal">
    <v-card>
      <v-card-title>编辑聚类</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <div class="d-flex justify-center mb-3">
          <v-btn-group variant="outlined" density="comfortable" divided :border="true">
            <v-btn icon="mdi mdi-chevron-left" @click="clusterEditModalDecGroupID()"></v-btn>
            <!-- TODO: Make it a drop down option -->
            <v-btn variant="tonal">{{ selectEditClusterName(selectedClusterId) }}</v-btn>
            <v-btn icon="mdi mdi-chevron-right" @click="clusterEditModalIncGroupID()"></v-btn>
          </v-btn-group>
        </div>
        <div class="scroll-list-x">
          <div class="grid-wrapper-onerow">
            <v-card no-body class="custom-shadow ma-2 pa-2" v-for="res in currentClusterEditPrecursors" :key="res.id"
              @dragstart="clusterEditOnDragstart(res, $event)" @dragend="clusterEditOnDragend($event)" draggable="true">
              <div class="d-flex flex-column justify-space-between" style="height:100%">
                <div>
                  <v-table class="ma-0">
                    <tbody :id="'edit-cluster-card-' + (res.rank)">
                      <tr v-if="res.precursorRank !== undefined && !res.isCustom">
                        <td>排序</td>
                        <td>#{{ res.precursorRank }}</td>
                      </tr>
                      <tr v-if="clusterEditModalData.optionsDisplay.showScore">
                        <td>前体评分</td>
                        <td>{{ num2str(res.retroScore) }}</td>
                      </tr>
                      <tr v-if="clusterEditModalData.optionsDisplay.showModelScore">
                        <td>平均模型评分</td>
                        <td>{{ num2str(res.averageModelScore) }}</td>
                      </tr>
                      <tr v-if="clusterEditModalData.optionsDisplay.showSCScore">
                        <td>合成复杂度</td>
                        <td>{{ num2str(res.scscore) }}</td>
                      </tr>
                      <tr v-if="clusterEditModalData.optionsDisplay.showNumExample">
                        <td>示例总数</td>
                        <td>{{ res.totalNumExamples }}</td>
                      </tr>
                      <tr v-if="clusterEditModalData.optionsDisplay.showPlausibility">
                        <td>可行性</td>
                        <td>{{ num2str(res.ffScore) }}</td>
                      </tr>
                      <tr v-if="clusterEditModalData.optionsDisplay.showClusterId">
                        <td>反应聚类</td>
                        <td>{{ res.clusterName }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </div>
                <div>
                  <img :src="getMolDrawEndPoint(res, true)" style="max-width:100%" draggable="false"
                    @dragstart.prevent />
                </div>
              </div>
            </v-card>
          </div>
        </div>
        <div class="scroll-list-x">
          <div class="grid-wrapper-onerow">
            <v-card @drop.prevent="clusterEditOnDrop(res, $event)" @dragover.prevent="clusterEditOnDragover($event)"
              @dragenter.prevent="clusterEditOnDragenter($event)" @dragleave.prevent="clusterEditOnDragleave($event)"
              @click="
                clusterEditModalData['clusterId'] = res.clusterId;
              clusterEditModalData['clusterName'] = res.clusterName;
              selectedClusterId = res.clusterId;
              $forceUpdate();
              " class="custom-shadow m-2 p-2" v-for="res in resultsStore.clusteredResults[selected.smiles]"
              :key="res.clusterId">
              <div class="nopointer text-center">
                <h4 class="nonselectable nopointer">{{ res.clusterName }}</h4>
                <div class="nopointer">
                  <img :src="getMolDrawEndPoint(res, true)" class="mw-100 nopointer" draggable="false"
                    @dragstart.prevent />
                </div>
              </div>
            </v-card>
            <v-card no-body class="custom-shadow m-2 p-2" @drop.prevent="clusterEditOnDropNew($event)"
              @dragover.prevent="clusterEditOnDragover($event)" @dragenter.prevent="clusterEditOnDragenter($event)"
              @dragleave.prevent="clusterEditOnDragleave($event)">
              <div class="nopointer text-center">
                <h4 class="nonselectable nopointer">新建反应聚类</h4>
                <i class="fas fa-plus-circle fa-8x text-dark nopointer"></i>
              </div>
            </v-card>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <div>
          <v-btn variant="flat" class="mr-1"
            @click="openAddNewPrecursorModal(clusterEditModalData['selectedSmiles'], clusterEditModalData['clusterId'], clusterEditModalData['clusterName'])"
            title="添加前体" icon="mdi-plus" color="primary">
          </v-btn>
        </div>
        <div class="form-check-inline">
          <input class="form-check-input" id="ceShowScore" type="checkbox"
            v-model="clusterEditModalData.optionsDisplay.showScore" />
          <label class="form-check-label mr-2" for="cpShowScore">得分</label>
          <input class="form-check-input" id="ceShowSCScore" type="checkbox"
            v-model="clusterEditModalData.optionsDisplay.showSCScore" />
          <label class="form-check-label mr-2" for="cpShowSCScore">合成复杂度</label>
          <input class="form-check-input" id="ceShowNumEx" type="checkbox"
            v-model="clusterEditModalData.optionsDisplay.showNumExample" />
          <label class="form-check-label mr-2" for="cpShowNumEx">示例总数</label>
          <input class="form-check-input" id="ceShowTemp" type="checkbox"
            v-model="clusterEditModalData.optionsDisplay.showModelScore" />
          <label class="form-check-label mr-2" for="cpShowModelScore">模板得分</label>
          <input class="form-check-input" id="ceShowPlaus" type="checkbox"
            v-model="clusterEditModalData.optionsDisplay.showPlausibility" />
          <label class="form-check-label mr-2" for="ceShowPlaus">可行性</label>
        </div>
        <v-btn variant="tonal" class="mr-1" @click="requestClusterId(clusterEditModalData['selectedSmiles'])"
          id="node-details-clustering-edit-cluster-re-cluster">重新聚类</v-btn>
        <v-btn variant="flat" @click="showClusterEditModal = false" color="primary"
          id="node-details-clustering-edit-cluster-close">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="showAddNewPrecursorModal" width="auto" min-width="500px">
    <v-card>
      <v-card-title>添加前体</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <!-- ADD NIH Resolver -->
        <v-text-field label="前体" variant="outlined" hide-details density="compact"
          id="node-details-clustering-add-precursor-smiles" v-model="addNewPrecursorModal['newPrecursorSmiles']"
          class="mb-2">
          <template v-slot:append-inner>
            <v-btn variant="tonal" prepend-icon="mdi mdi-pencil"
              @click="openKetcher(addNewPrecursorModal['newPrecursorSmiles'])">绘制</v-btn>
          </template>
        </v-text-field>
        <smiles-image v-if="!!addNewPrecursorModal['newPrecursorSmiles']"
          :smiles="addNewPrecursorModal['newPrecursorSmiles']" height="100px"></smiles-image>
        <v-select label="聚类编号" :items="clusterItems" v-model="addNewPrecursorModal['clusterId']"
          variant="outlined" hide-details density="compact">
        </v-select>
        <v-text-field v-if="addNewPrecursorModal['clusterId'] === -1" label="聚类名称" variant="outlined"
          hide-details density="compact" v-model="addNewPrecursorModal['newClusterName']" class="mt-2"></v-text-field>
        <v-checkbox v-model="addNewPrecursorModal['noDupCheck']" label="跳过重复检查" hide-details></v-checkbox>
      </v-card-text>
      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="closeAddNewPrecursorModal()"
          id="node-details-clustering-add-precursor-cancel">取消</v-btn>
        <v-btn color="primary" @click="addNewPrecursorModalSubmit()"
          id="node-details-clustering-add-precursor-confirm">添加前体</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <rec-templates-modal :selected="selected" :visible="showRecTemplate" :template-sets="templateSets"
    :selectedTemplate="selectedTemplate" @close-dialog="$event => showRecTemplate = $event"></rec-templates-modal>
  <ketcher-modal ref="ketcherRef" v-model="showKetcher" :smiles="smiles" @input="showKetcher = false"
    @update:smiles="updateSmiles" />
</template>

<script>
import JsPanel from "@/components/JsPanel";
import BanButton from "@/components/BanButton";
import CopyTooltip from "@/components/CopyTooltip";
import KetcherMin from "@/components/KetcherMin";
import SmilesImage from "@/components/SmilesImage";
import { num2str } from "@/common/utils";
import dayjs from "dayjs";
import { API } from "@/common/api";
import { getMolImageUrl } from "@/common/drawing";
import { createConditionRecommendationUrl } from "@/common/reaction-evidence";
import { mapStores } from "pinia";
import { useResultsStore } from "@/store/results";
import { useSettingsStore } from "@/store/settings";
import { useConfirm, useSnackbar } from 'vuetify-use-dialog';
import RecTemplatesModal from "@/components/RecTemplatesModal";
import KetcherModal from "@/components/KetcherModal";
import ReactionEvidencePanel from "@/components/network/ReactionEvidencePanel.vue";
import { useTheme } from "@/composables/useTheme";

export default {
  name: "NodeDetail",
  components: {
    KetcherModal,
    JsPanel,
    BanButton,
    CopyTooltip,
    KetcherMin,
    SmilesImage,
    RecTemplatesModal,
    ReactionEvidencePanel
  },
  emits: ['selectAllOccur', 'deleteChoice', 'collapseNode', 'close', 'expandNode', 'updatePendingTasks'],
  props: {
    selected: {
      type: Object,
      default: null,
    },
    enableResolver: {
      type: Boolean,
      default: false,
    },
    visible: {
      type: Boolean,
      default: false,
    },
    templateSets: {
      type: Object,
      default: () => ({}),
    }
  },
  setup() {
    const createConfirm = useConfirm()
    const createSnackbar = useSnackbar()
    const { isDark } = useTheme()
    return {
      createConfirm,
      createSnackbar,
      isDark
    }
  },
  data() {
    return {
      smiles: '',
      showKetcher: false,
      editIdx: -1,
      oldNote: "",
      noteUrsName: "",
      noteComment: "",
      addNote: false,
      dispNotes: false,
      invertAtomFilter: false,
      selectedAtoms: [],
      selectedTemplate: "reaxys",
      detailPanelOptions: {
        id: "detailPanel",
        headerTitle: "节点详情",
        headerControls: { size: "sm" },
        position: { my: "right-top", at: "right-top", of: "#app" },
        panelSize: { width: 500, height: "100vh" },
        theme: "dark"
      },
      clusterPopoutModalData: {
        optionsDisplay: {
          showScore: false,
          showModelScore: false,
          showSCScore: false,
          showNumExample: true,
          showPlausibility: true,
          showClusterId: false,
        },
      },
      clusterEditModalData: {
        optionsDisplay: {
          showScore: false,
          showModelScore: false,
          showSCScore: false,
          showNumExample: false,
          showPlausibility: false,
          showClusterId: false,
        },
      },
      showClusterPopoutModal: false,
      selectedClusterId: 0,
      showClusterEditModal: false,
      showAddNewPrecursorModal: false,
      showRecTemplate: false,
      addNewPrecursorModal: {},
      sortingCategoryItems: [
        { value: "retroScore", title: "前体评分" },
        { value: "averageModelScore", title: "平均模型评分" },
        { value: "scscore", title: "合成复杂度" },
        { value: "totalNumExamples", title: "示例总数" },
        { value: "ffScore", title: "可行性" },
        { value: "rmsMolwt", title: "均方根分子量" },
        { value: "numRings", title: "环数量" }
      ]
    };
  },
  methods: {
    recBtn(templateSet) {
      this.selectedTemplate = templateSet
      this.showRecTemplate = true
    },
    openKetcher(source) {
      this.smiles = source;
      this.showKetcher = true;
      this.$refs['ketcherRef'].smilesToKetcher()
    },
    updateSmiles(source) {
      this.addNewPrecursorModal['newPrecursorSmiles'] = source;
    },
    modelReactionEvidenceInput(model) {
      return {
        reactionData: model?.source?.reaction_data || {},
        reactionId: model?.source?.reaction_id || "",
        reactionSet: model?.source?.reaction_set || model?.model_name || "",
      };
    },
    predictSelectivity() {
      this.$emit("updatePendingTasks", "add");
      let data = this.selected.data
      let url = '/api/general-selectivity/controller/call-async';
      let body = {
        smiles: `${data.mappedPrecursors}>>${data.mappedOutcomes}`,
        backend: this.settingsStore.ippSettings?.selectivityModel || 'gnn',
        atom_map_backend: this.settingsStore.interactive_path_planner_settings.atom_map_backend,
        mapped: true,
        all_outcomes: true,
        no_map_reagents: true,
      }
      API.runCeleryTask(url, body)
        .then(output => {
          const results = output?.result ?? output;
          if (Array.isArray(results)) {
            this.resultsStore.updateDataNodes({
              id: data.id,
              selectivity: results.map(({ prob }) => prob),
            })
          } else {
            alert('无法预测该反应的选择性。')
          }
        })
        .catch(error => {
          alert('预测该反应选择性时出错：' + error)
        })
        .finally(() => {
          this.$emit("updatePendingTasks", "sub");
        })
    },
    toggleResolver() {
      if (this.allowResolve) {
        this.allowResolve = false;
      } else {
        this.allowResolve = true;
      }
    },
    clearEmit() {
      this.selectedAtoms = [];
      this.$emit("close");
    },
    resetSortingCategory() {
      this.sortingCategory = "retroScore";
      this.selectSortingOrder();
    },
    selectSortingOrder() {
      this.sortOrderAscending =
        ["rmsMolwt", "numRings", "scscore", "templateRank"].includes(this.sortingCategory) || (this.sortingCategory === "retroScore" && this.settingsStore.tbSettings.precursorScoring === "SCScore");
    },
    clearNote() {
      this.noteUrsName = "";
      this.noteComment = "";
      this.addNote = false;
    },
    saveNote() {
      //stop adding notes if there are more then one node selected
      let dispNode = this.selected.disp;
      if (dispNode.notes == undefined) {
        dispNode.notes = [];
      }
      let note = {
        user: this.noteUrsName,
        date: new Date().toLocaleString(),
        comment: this.noteComment,
      };
      this.createConfirm({ title: '请确认', content: `请确认备注内容：\n ${this.noteComment}`, dialogProps: { width: "auto" } })
        .then((value) => {
          if (value) {
            dispNode.notes.push(note);
            this.addNote = false;
            this.noteUrsName = "";
            this.noteComment = "";
            this.saveResult();
          }
        })
        .catch(() => {
          // An error occurred
        });
    },
    async editNote(index, shouldDelete) {
      let note = this.selected.disp.notes[index];
      if (shouldDelete) {
        await this.createConfirm({ title: '请确认', content: `确认删除这条备注吗？\n ${note.comment}`, dialogProps: { width: "auto" } })
          .then((value) => {
            if (value) {
              /* eslint-disable */
              this.selected.disp.notes.splice(index, 1);
              this.$forceUpdate();
              this.saveResult();
            }
          })
          .catch(() => {
            // An error occurred
          });
      } else {
        note.date = new Date().toLocaleString();
        this.saveResult();
      }
    },
    getAllSettings() {
      return {
        network: this.settingsStore.visjsUserOptions,
        tb: this.settingsStore.tbSettings,
        ipp: this.settingsStore.ippSettings,
      };
    },
    saveResult() {
      this.$emit("updatePendingTasks", "add");
      const body = {
        result: {
          dataGraph: this.resultsStore.dataGraph.toJSON(),
          dispGraph: this.resultsStore.dispGraph.toJSON(),
        },
        settings: this.getAllSettings(),
        description: this.resultsStore.savedResultInfo.description,
        tags: this.resultsStore.savedResultInfo.tags.join(","),
        result_type: "ipp",
      };
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
              modified: json["modified"],
              modifiedDisp: dayjs(json["modified"]).format("MMMM D, YYYY h:mm A"),
            });
            this.createSnackbar({ text: '备注已更新。', snackbarProps: { timeout: 2000, vertical: true } })
          } else {
            this.createSnackbar({ text: "路线树任务已完成，可在结果页面查看详情。", snackbarProps: { timeout: -1, vertical: true } })

          }
        })
        .catch((error) => {
          this.createSnackbar({ text: '保存结果时出错：' + error.messages, snackbarProps: { timeout: -1, vertical: true } })
        })
        .finally(() => {
          this.$emit("updatePendingTasks", "sub");
        });
    },
    selectPopoutClusterName(clusterId) {
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterPopoutModalData["selectedSmiles"]];
      let idx = allIds.indexOf(clusterId);
      return this.resultsStore.clusteredResults[this.clusterPopoutModalData["selectedSmiles"]][idx]["clusterName"];
    },
    selectEditClusterName(clusterId) {
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterEditModalData["selectedSmiles"]];
      let idx = allIds.indexOf(clusterId);
      return this.resultsStore.clusteredResults[this.clusterEditModalData["selectedSmiles"]][idx]["clusterName"];
    },
    openAddNewPrecursorModal(selectedSmiles, clusterId = -1, clusterName = "") {
      // clusterId == -1 is to add a new cluster
      this.showAddNewPrecursorModal = true;
      this.addNewPrecursorModal["selectedSmiles"] = selectedSmiles === undefined ? this.selected.smiles : selectedSmiles;
      this.addNewPrecursorModal["clusterId"] = clusterId;
      this.addNewPrecursorModal["clusterName"] = clusterName;
      this.addNewPrecursorModal["newClusterName"] = "";
      this.addNewPrecursorModal["newPrecursorSmiles"] = "";
      this.addNewPrecursorModal["noDupCheck"] = false;
    },
    closeAddNewPrecursorModal() {
      this.showAddNewPrecursorModal = false;
      this.addNewPrecursorModal["selectedSmiles"] = "";
      this.addNewPrecursorModal["clusterId"] = -1;
      this.addNewPrecursorModal["clusterName"] = "";
      this.addNewPrecursorModal["newClusterName"] = "";
      this.addNewPrecursorModal["newPrecursorSmiles"] = "";
      this.addNewPrecursorModal["noDupCheck"] = false;
    },
    checkDuplicatePrecursor(selectedSmiles, p) {
      let existing = this.resultsStore.dataGraph.getSuccessors(selectedSmiles);
      return existing.includes(p) ? this.resultsStore.dataGraph.nodes.get(p) : undefined;
    },
    addNewPrecursorModalSubmit() {
      let gid = this.addNewPrecursorModal["clusterId"];
      let smi = this.addNewPrecursorModal["newPrecursorSmiles"];
      this.validatesmiles(smi, !this.allowResolve)
        .then((isValid) => {
          return isValid ? smi : this.resolveChemName(smi);
        })
        .then((smi) => this.canonicalize(smi, (res) => (this.addNewPrecursorModal["newPrecursorSmiles"] = res)))
        .then(() => {
          let selecSmi = this.addNewPrecursorModal["selectedSmiles"];
          let newSmi = this.addNewPrecursorModal["newPrecursorSmiles"];
          if (newSmi !== undefined) {
            if (!this.addNewPrecursorModal["noDupCheck"]) {
              let s = this.checkDuplicatePrecursor(selecSmi, newSmi);
              if (s !== undefined) {
                this.createConfirm({ title: "操作未完成", content: "可能存在重复前体：排序 " + s.rank + "，聚类 " + s.clusterId + "。如仍需继续，请勾选“跳过重复检查”。", dialogProps: { width: "auto" } })
                return;
              }
            }
            this.clusterEditModalAddPrecursor(selecSmi, newSmi, gid);
            this.closeAddNewPrecursorModal();
          }
        })
        .catch((error) => {
          var error_msg = "未知错误";
          if ("message" in error) {
            error_msg = error.name + ":" + error.message;
          } else if (typeof error == "string") {
            error_msg = error;
          }
          this.createConfirm({ title: "操作未完成", content: "按当前设置获取该目标前体时出错：" + error_msg, dialogProps: { width: "auto" } })
        });
    },
    addNewPrecursorModalName(clusterId) {
      let allIds = this.resultsStore.clusteredResultsIndex[this.addNewPrecursorModal["selectedSmiles"]];
      let idx = allIds.indexOf(parseInt(clusterId));
      if (idx === -1) {
        return ""
      }
      return this.resultsStore.clusteredResults[this.addNewPrecursorModal["selectedSmiles"]][idx]["clusterName"];
    },
    getMolDrawEndPoint(precursor, align = false) {
      //  precursor can be
      //      1) a smiles string,
      //      2) a object with properties "reactingAtoms" and "mappedSmiles"
      //      3) a object with property "smiles"
      //      4) an object with property "precursorSmiles"
      const highlight = this.settingsStore.isHighlightAtom;
      const transparent = true;
      let reference;
      if (align && this.selected && this.settingsStore.ippSettings.alignPrecursorsToProduct) {
        reference = this.selected.smiles;
      }
      return getMolImageUrl(precursor, highlight, transparent, reference);
    },
    checkFilter(result) {
      if (!this.selectedAtoms.length) {
        return true;
      }
      let reactingAtoms = [];
      if (result.reactingAtoms) {
        reactingAtoms = result.reactingAtoms.map((el) => el - 1);
      }
      let filterResult = reactingAtoms.some((index) => this.selectedAtoms.includes(index));
      if (this.invertAtomFilter) {
        filterResult = !filterResult;
      }
      return filterResult;
    },
    remFromResults(selected, reaction) {
      if (!(selected.id in reaction.inVis)) {
        console.warn('Trying to remove reaction that is not in visualization');
        return;
      }
      let node = this.resultsStore.dispGraph.nodes.get(reaction.inVis[selected.id]);
      if (!node) {
        console.warn('Display node not found for reaction', reaction.inVis[selected.id]);
        delete reaction.inVis[selected.id];
        return;
      }
      this.resultsStore.deleteDispNode(node);
    },
    addFromResults(selected, reaction) {
      if (selected.id in reaction.inVis) {
        return;
      }
      this.resultsStore.addRetroResultToDispGraph({ data: [reaction.id], parentId: selected.id, bypassFilter: true })
    },
    deleteFromGraph(reaction) {
      //removes from vuex store deletes from datagraph and removes from tree.
      this.createConfirm({ title: '请确认', content: "该节点将从路线树中永久删除，是否继续？", dialogProps: { width: "auto" } })
        .then((value) => {
          if (!value) return;
          this.resultsStore.deleteDataNode(reaction);
        })
        .catch(() => {
          // An error occurred
        });
    },
    clusterPopoutModalSetGroupID() {
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterPopoutModalData["selectedSmiles"]];
      let idx = allIds.indexOf(this.selectedClusterId);
      this.clusterPopoutModalData["clusterId"] = this.selectedClusterId;
      let allResults = this.resultsStore.clusteredResults[this.clusterPopoutModalData["selectedSmiles"]];
      this.clusterPopoutModalData["clusterName"] = allResults[idx]["clusterName"];
    },
    openClusterPopoutModal(selected, res) {
      if (selected === undefined) {
        this.createConfirm({ title: "操作未完成", content: "尚未选择目标分子。请先在路线树中选择一个分子。", dialogProps: { width: "auto" } })
        return;
      }
      if (res.clusterId === undefined) {
        this.createConfirm({ title: '请确认', content: "此前体尚未聚类，是否重新聚类当前前体列表？", dialogProps: { width: "auto" } })
          .then((value) => {
            if (!value) return;
            this.requestClusterId(selected.smiles).then(() => {
              // Retrieve updated res from dataGraph
              res = this.resulsStore.dataGraph.nodes.get(res.id);
              this.openClusterPopoutModal(selected, res);
            });
          })
          .catch(() => {
            // An error occurred
          });
      } else {
        this.clusterPopoutModalData["selected"] = selected;
        this.clusterPopoutModalData["selectedSmiles"] = selected.smiles;
        this.clusterPopoutModalData["res"] = res;
        this.clusterPopoutModalData["clusterId"] = res.clusterId;
        this.clusterPopoutModalData["clusterName"] = res.clusterName;
        this.selectedClusterId = res.clusterId;
        this.showClusterPopoutModal = true;
      }
    },
    closeClusterPopoutModal() {
      this.showClusterPopoutModal = false;
      this.clusterPopoutModalData["selected"] = undefined;
      this.clusterPopoutModalData["selectedSmiles"] = undefined;
      this.clusterPopoutModalData["res"] = undefined;
      this.clusterPopoutModalData["clusterId"] = undefined;
      this.clusterPopoutModalData["clusterName"] = undefined;
    },
    openClusterEditModal(selected, clusterId, clusterName) {
      if (selected === undefined) {
        this.createConfirm({ title: "操作未完成", content: "尚未选择目标分子。请先在路线树中选择一个分子。", dialogProps: { width: "auto" } })
        return;
      }
      if (clusterId === undefined) {
        clusterId = 0;
      }
      this.clusterEditModalData["selected"] = selected;
      this.clusterEditModalData["selectedSmiles"] = selected.smiles;
      this.clusterEditModalData["clusterId"] = clusterId;
      this.clusterEditModalData["clusterName"] = clusterName;
      this.selectedClusterId = clusterId;
      this.showClusterEditModal = true;
    },
    closeClusterEditModal() {
      this.showClusterEditModal = false;
      this.clusterEditModalData["selected"] = undefined;
      this.clusterEditModalData["selectedSmiles"] = undefined;
      this.clusterEditModalData["clusterId"] = undefined;
      this.clusterEditModalData["clusterName"] = undefined;
    },
    clusterPopoutModalIncGroupID() {
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterPopoutModalData["selectedSmiles"]];
      let allResults = this.resultsStore.clusteredResults[this.clusterPopoutModalData["selectedSmiles"]];
      let idx = allIds.indexOf(this.clusterPopoutModalData["clusterId"]);
      let idxToModify = Math.min(allIds.length - 1, idx + 1);
      this.clusterPopoutModalData["clusterId"] = allIds[idxToModify];
      this.clusterPopoutModalData["clusterName"] = allResults[idxToModify]["clusterName"];
      this.selectedClusterId = allIds[idxToModify];
    },
    clusterPopoutModalDecGroupID() {
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterPopoutModalData["selectedSmiles"]];
      let allResults = this.resultsStore.clusteredResults[this.clusterPopoutModalData["selectedSmiles"]];
      let idx = allIds.indexOf(this.clusterPopoutModalData["clusterId"]);
      let idxToModify = Math.max(0, idx - 1);
      this.clusterPopoutModalData["clusterId"] = allIds[idxToModify];
      this.clusterPopoutModalData["clusterName"] = allResults[idxToModify]["clusterName"];
      this.selectedClusterId = allIds[idxToModify];
    },
    clusterEditOnDragover(event) {
      event.dataTransfer.dropEffect = "move"; // important
    },
    clusterEditOnDragenter(event) {
      event.target.classList.add("dragover");
    },
    clusterEditOnDragleave(event) {
      event.target.classList.remove("dragover");
    },
    clusterEditOnDragstart(precursor, event) {
      event.target.style.opacity = "0.4";
      event.dataTransfer.setData("text/plain", precursor.id);
      let img = new Image();
      img.src = this.getMolDrawEndPoint(precursor.precursorSmiles);
      // set opacity does not work..
      event.dataTransfer.setDragImage(img, 10, 10);
      event.dataTransfer.effectAllowed = "all";
      // disable all buttons on dragging
      let buttons = document.querySelectorAll("button");
      buttons.forEach(function (e) {
        e.style.pointerEvents = "none";
      });
    },
    clusterEditOnDragend(event) {
      event.target.style.opacity = "1";
      // enable all buttons
      let buttons = document.querySelectorAll("button");
      buttons.forEach(function (e) {
        e.style.pointerEvents = "all";
      });
    },
    clusterEditOnDrop(target, event) {
      let smi = event.dataTransfer.getData("text/plain"); // precursor.id
      let obj = this.resultsStore.dataGraph.nodes.get(smi);
      let oldId = obj.clusterId;
      let newId = target.clusterId;
      this.resultsStore.updateDataNodes({
        id: smi,
        clusterId: newId,
        clusterName: target.clusterName,
      });
      this.clusterEditOnDragend(event);
      this.clusterEditOnDragleave(event);
      this.updateClusterReps(this.clusterEditModalData["selectedSmiles"], [oldId, newId]);
    },
    clusterEditOnDropNew(event) {
      let smi = event.dataTransfer.getData("text/plain"); // precursor.id
      let obj = this.resultsStore.dataGraph.nodes.get(smi);
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterEditModalData["selectedSmiles"]];
      let oldId = obj.clusterId;
      let newId = allIds[allIds.length - 1] + 1;
      let defaultName = "Manuel";
      let customName = prompt("Please enter a name for the new cluster", defaultName);
      this.resultsStore.updateDataNodes({
        id: smi,
        clusterId: newId,
        clusterName: customName === "" || customName === null ? defaultName : customName,
      });
      this.clusterEditOnDragend(event);
      this.clusterEditOnDragleave(event);
      this.updateClusterReps(this.clusterEditModalData["selectedSmiles"], [oldId, newId]);
    },
    updateClusterReps(target, clusterIds) {
      // Update the cluster representatives for the specified clusterIds
      for (let clusterId of clusterIds) {
        let options = { filter: (item) => item.clusterId === clusterId };
        let precursorSmiles = this.resultsStore.dataGraph.getSuccessors(target);
        let precursors = this.resultsStore.dataGraph.nodes.get(precursorSmiles, options);
        this.resultsStore.updateDataNodes(
          precursors.map((item, index) => ({
            id: item.id,
            clusterRep: index === 0,
          }))
        ); // Set first item as cluster rep
      }
    },
    clusterEditModalIncGroupID() {
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterEditModalData["selectedSmiles"]];
      let allResults = this.resultsStore.clusteredResults[this.clusterEditModalData["selectedSmiles"]];
      let idx = allIds.indexOf(this.clusterEditModalData["clusterId"]);
      let idxToModify = Math.min(allIds.length - 1, idx + 1);
      this.clusterEditModalData["clusterId"] = allIds[idxToModify];
      this.clusterEditModalData["clusterName"] = allResults[idxToModify]["clusterName"];
      this.selectedClusterId = allIds[idxToModify];
    },
    clusterEditModalDecGroupID() {
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterEditModalData["selectedSmiles"]];
      let allResults = this.resultsStore.clusteredResults[this.clusterEditModalData["selectedSmiles"]];
      let idx = allIds.indexOf(this.clusterEditModalData["clusterId"]);
      let idxToModify = Math.max(0, idx - 1);
      this.clusterEditModalData["clusterId"] = allIds[idxToModify];
      this.clusterEditModalData["clusterName"] = allResults[idxToModify]["clusterName"];
      this.selectedClusterId = allIds[idxToModify];
    },
    clusterEditModalSetGroupID() {
      let allIds = this.resultsStore.clusteredResultsIndex[this.clusterEditModalData["selectedSmiles"]];
      let idx = allIds.indexOf(this.selectedClusterId);
      this.clusterEditModalData["clusterId"] = this.selectedClusterId;
      let allResults = this.resultsStore.clusteredResults[this.clusterEditModalData["selectedSmiles"]];
      this.clusterEditModalData["clusterName"] = allResults[idx]["clusterName"];
    },
    async clusterEditModalAddPrecursor(selectedSmiles, smiles, clusterId) {
      // clusterId == -1 is to add a new cluster
      try {
        let successors = this.resultsStore.dataGraph.getSuccessors(selectedSmiles);
        let allIds = this.resultsStore.clusteredResultsIndex[selectedSmiles] || [];
        let clusterName;
        if (clusterId === -1) {
          if (successors.length === 0 || allIds.length === 0) {
            clusterId = 0;
          } else {
            clusterId = allIds[allIds.length - 1] + 1;
          }
          clusterName = this.addNewPrecursorModal["newClusterName"];
          if (clusterName === "") {
            clusterName = "手动添加";
          }
        } else {
          clusterName = this.addNewPrecursorModalName(clusterId);
        }

        // Build reaction SMILES for plausibility scoring: precursors >> target
        const rxnSmiles = `${selectedSmiles}>>${smiles}`;
        console.log(rxnSmiles)

        // Fetch RDKit descriptors and fast-filter plausibility for the new precursor
        const [numRings, rmsMolwt, scscore, plausibility] = await Promise.all([
          this.getNumRings(smiles),
          this.getRmsMolecularWeight(smiles),
          this.getScScore(smiles),
          this.getFfScore(rxnSmiles),
        ]);

        const res = {
          outcome: smiles,
          smiles_split: smiles.split("."),
          is_custom: true,
          // Use 0 as a sentinel rank for custom precursors; UI will not display it
          precursor_rank: 0,
          precursor_properties: {
            num_rings: numRings,
            rms_molwt: rmsMolwt,
            scscore: scscore,
          },
          reaction_properties: {
            cluster_id: clusterId,
            cluster_name: clusterName,
            plausibility: plausibility,
          },
        };

        await this.resultsStore.addRetroResultToDataGraph({ data: [res], parentSmiles: selectedSmiles });
      } catch (error) {
        let error_msg = "未知错误";
        if (error && typeof error === "object" && "message" in error) {
          error_msg = error.message;
        } else if (typeof error === "string") {
          error_msg = error;
        }
        this.createConfirm({
          title: "操作未完成",
          content:
            "计算该前体的 RDKit 描述符时出错：" +
            error_msg,
          dialogProps: { width: "auto" },
        });
      }
    },
    requestClusterId(smiles) {
      this.$emit("updatePendingTasks", "add");
      return this.resultsStore.recluster(smiles).finally(() => {
        this.$emit("updatePendingTasks", "sub");
      });
    },
    validatesmiles(smiles, iswarning) {
      return API.post("/api/rdkit/validate/", { smiles: smiles }).then((json) => {
        if (!json["correct_syntax"]) {
          if (iswarning) {
            this.createConfirm({ title: "操作未完成", content: "输入的 SMILES 无效：语法错误", dialogProps: { width: "auto" } })
          }
          return false;
        } else if (!json["valid_chem_name"]) {
          if (iswarning) {
            this.createConfirm({ title: "操作未完成", content: "输入的 SMILES 无效：化学名称不可识别", dialogProps: { width: "auto" } })
          }
          return false;
        } else {
          return true;
        }
      });
    },
    canonicalize(smiles, input) {
      return API.post("/api/rdkit/canonicalize/", { smiles: smiles }).then((json) => {
        if (json.smiles) {
          if (typeof input === "string") {
            this[input] = json.smiles;
          } else if (input instanceof Function) {
            input(json.smiles);
          }
        }
      });
    },
    async getNumRings(smiles) {
      const json = await API.post("/api/rdkit/get-num-rings", { smiles: smiles });
      return json?.num_rings;
    },
    async getRmsMolecularWeight(smiles) {
      const json = await API.post("/api/rdkit/get-rms-molecular-weight", { smiles: smiles });
      return json?.rms_molecular_weight;
    },
    async getScScore(smiles) {
      const json = await API.post("/api/scscore/call-sync", { smiles: smiles });
      return json?.result;
    },
    async getFfScore(rxnSmiles) {
      try {
        const json = await API.post("/api/fast-filter/batch/call-sync", {
          rxn_smiles: [rxnSmiles],
        });
        return json?.result?.[0];
      } catch (error) {
        console.error("Failed to fetch fast-filter score:", error);
        return null;
      }
    },
    expandNode() {
      this.$emit("expandNode");
    },
    dayjs,
    num2str,
    isRootInResult(res) {
      const target = this.resultsStore.target;
      if (!res || !target) return false;
      if (Array.isArray(res.precursors) && res.precursors.length) {
        return res.precursors.includes(target);
      }
      if (res.precursorSmiles && typeof res.precursorSmiles === 'string') {
        return res.precursorSmiles.split(".").includes(target);
      }
      // Fallback: parse from reaction smiles if available
      if (res.id && typeof res.id === 'string' && res.id.includes('>>')) {
        const left = res.id.split('>>')[0];
        return left.split('.').includes(target);
      }
      return false;
    },
  },
  computed: {
    selectedReactionEvidenceInput() {
      const data = this.selected?.data || {};
      return {
        reactionData: data.reactionData || {
          reaction_smiles: data.reference_reaction,
          reference_url: data.reference_url,
          patent_number: data.patent_number,
        },
        reactionId: data.reactionId || "",
        reactionSet: data.reactionSet || data.trainingSet || "",
      };
    },
    conditionRecommendationUrl() {
      return createConditionRecommendationUrl(this.selected?.smiles || "");
    },
    clusterItems() {
      let items = [{ title: "Create new cluster", value: -1 }];
      for (let idx in this.resultsStore.clusteredResultsIndex[this.addNewPrecursorModal['selectedSmiles']]) {
        let clusterName = this.addNewPrecursorModalName(idx)
        if (clusterName === "") {
          continue;
        }
        items.push({ title: clusterName, value: idx });
      }
      return items;
    },
    allowResolve: {
      get() {
        return this.settingsStore.allowResolve;
      },
      set(value) {
        this.settingsStore.setOption({ key: "allowResolve", value: value });
      },
    },
    sortingCategory: {
      get() {
        return this.settingsStore.sortingCategory;
      },
      set(value) {
        this.settingsStore.sortingCategory = value;
      },
    },
    sortOrderAscending: {
      get() {
        return this.settingsStore.sortOrderAscending;
      },
      set(value) {
        this.settingsStore.sortOrderAscending = value;
      },
    },
    allowCluster: {
      get() {
        return this.settingsStore.interactive_path_planner_settings.cluster_precursors;
      },
      set(value) {
        this.settingsStore.interactive_path_planner_settings.cluster_precursors = value;
      },
    },
    reactionLimit: {
      get() {
        return this.settingsStore.reactionLimit;
      },
      set(value) {
        this.settingsStore.reactionLimit = value;
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
    resultsAvailable() {
      // Boolean of whether the selected chemical has been expanded
      // Returns false if a reaction node is selected
      if (this.selected.type !== "chemical") {
        return false;
      } else {
        return this.resultsStore.dataGraph.getSuccessors(this.selected.smiles).length !== 0;
      }
    },
    currentPrecursors() {
      // Array of precursors corresponding to the selected chemical
      this.resultsStore.recomputeData;
      if (this.selected.type !== "chemical") {
        return [];
      }

      let precursorSmiles = this.resultsStore.dataGraph.getSuccessors(this.selected.smiles);
      let cmp = this.sortOrderAscending
        ? (a, b) => {
          return a - b;
        }
        : (a, b) => {
          return b - a;
        };
      let options = {
        filter: (item) => {
          if (this.allowCluster && !item.clusterRep) {
            return false;
          }
          return this.checkFilter(item);
        },
        order: (a, b) => {
          // Custom precursors (manually added) always come first
          const aCustom = a.isCustom === true;
          const bCustom = b.isCustom === true;
          if (aCustom && !bCustom) return -1;
          if (!aCustom && bCustom) return 1;

          let a_, b_;
          if (this.sortingCategory === 'numExamples') {
            a_ = this.sumNumExamples(a);
            b_ = this.sumNumExamples(b);
          } else {
            a_ = a[this.sortingCategory] === undefined ? 0 : a[this.sortingCategory];
            b_ = b[this.sortingCategory] === undefined ? 0 : b[this.sortingCategory];
          }
          if (a_ === b_) {
            return a.rank - b.rank;
          }
          return cmp(a_, b_);
        },
      };
      return this.resultsStore.dataGraph.nodes.get(precursorSmiles, options);
    },
    currentClusterViewPrecursors() {
      this.resultsStore.recomputeData;
      let smi = this.clusterPopoutModalData.selectedSmiles;
      let cid = this.clusterPopoutModalData.clusterId;
      let precursorSmiles = this.resultsStore.dataGraph.getSuccessors(smi);
      let options = {
        filter: (item) => item.clusterId === cid,
        order: (a, b) => {
          const aCustom = a.isCustom === true;
          const bCustom = b.isCustom === true;
          if (aCustom && !bCustom) return -1;
          if (!aCustom && bCustom) return 1;
          return a.rank - b.rank;
        },
      };
      return this.resultsStore.dataGraph.nodes.get(precursorSmiles, options);
    },
    currentClusterEditPrecursors() {
      this.resultsStore.recomputeData;
      let smi = this.clusterEditModalData.selectedSmiles;
      let cid = this.clusterEditModalData.clusterId;
      let precursorSmiles = this.resultsStore.dataGraph.getSuccessors(smi);
      let options = {
        filter: (item) => item.clusterId === cid,
        order: (a, b) => {
          const aCustom = a.isCustom === true;
          const bCustom = b.isCustom === true;
          if (aCustom && !bCustom) return -1;
          if (!aCustom && bCustom) return 1;
          return a.rank - b.rank;
        },
      };
      return this.resultsStore.dataGraph.nodes.get(precursorSmiles, options);
    },
    ...mapStores(useResultsStore, useSettingsStore),
  },
};
</script>

<style scoped>
.scroll-list {
  max-height: 48vh;
  overflow-y: scroll;
  scrollbar-width: none;
  /* Firefox */
  -ms-overflow-style: none;
  /* Internet Explorer 10+ */
}

.scroll-list::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
  /* Chrome, Safari, and Opera */
}

.scroll-list-x {
  max-height: 45vh;
  max-width: 90vw;
  overflow-x: scroll;
  scrollbar-width: none;
  /* Firefox */
  -ms-overflow-style: none;
  /* Internet Explorer 10+ */
}

.scroll-list-x::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
  /* Chrome, Safari, and Opera */
}

.custom-shadow {
  box-shadow: 0 4px 8px 0 rgba(0, 0, 0, 0.2);
  transition: 0.3s;
}

.custom-shadow:hover {
  box-shadow: 0 8px 16px 0 rgba(0, 0, 0, 0.2);
}

.grey-border {
  border: #333 3px solid;
}

.grid-wrapper {
  display: grid;
  grid-template-rows: auto;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  grid-auto-flow: row;
  grid-gap: 10px;
}

.grid-wrapper-onerow {
  display: grid;
  grid-template-rows: minmax(25vh, max-content);
  grid-auto-columns: 200px;
  grid-auto-flow: column;
  grid-gap: 10px;
}

[draggable] {
  user-select: none;
}

.nonselectable {
  user-select: none;
}

.nopointer {
  pointer-events: none;
}

.dragover {
  border: 2px dashed #000 !important;
}

.flex-gap-2 {
  gap: 0.5rem;
}

.invert {
  filter: invert(1) brightness(2);
}

.precursor-table td:first-child {
  width: 60%;
}

.precursor-table td:last-child {
  width: 40%;
}
</style>
