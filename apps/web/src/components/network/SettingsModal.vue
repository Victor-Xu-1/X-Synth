<template>
    <v-dialog id="settings-modal" scrollable v-model="showSettings" width="900px" @close="clearEmit"
        @click:outside="clearEmit">
        <v-card>
            <v-card-title>策略设置</v-card-title>
            <v-divider></v-divider>
            <v-card-text>
                <div class="d-flex flex-row">
                    <v-tabs v-model="tab" direction="vertical" color="primary" density="compact" :bg-color="isDark ? 'grey-darken-3' : 'grey-lighten-3'"
                        class="mr-2">
                        <v-tab value="general" data-cy="ipp-settings-general">
                            <v-icon start>
                                mdi-cog
                            </v-icon>
                            通用设置
                        </v-tab>
                        <v-tab  value="mctsTB" data-cy="ipp-settings-tree">
                            <v-icon start>
                                mdi-factory
                            </v-icon>
                            路线树搜索
                        </v-tab>
                        <v-tab value="IPPC" data-cy="ipp-settings-clustering">
                            <v-icon start>
                                mdi-group
                            </v-icon>
                            前体聚类
                        </v-tab>
                        <v-tab value="graphVis" data-cy="ipp-settings-graph-vis">
                            <v-icon start>
                                mdi-graph
                            </v-icon>
                            图谱显示
                        </v-tab>
                    </v-tabs>
                    <v-window v-model="tab" style="width:100%">
                        <v-window-item value="general">
                            <v-container fluid>
                                <setting-input v-if="enableResolver" label="启用 PubChem 名称解析" help-text="开启后，服务端中 RDKit 无法直接解析的输入会发送到 PubChem PUG API，尝试把常用名称解析为 SMILES。">
                                    <v-switch label="" v-model="allowResolve" id="allowResolve" hide-details
                                        color="primary"></v-switch>
                                </setting-input>
                                <setting-input label="前体排序方式" label-for="precursorScoring"
                                    help-text="控制服务端如何对预测前体排序。结果生成后仍可在列表中重新排序。">
                                    <v-select :model-value="precursorScoring" :items="precursorScoringItems"
                                        @update:modelValue="($event) => precursorScoring = $event" variant="outlined"
                                        class="mt-4 mb-2" hide-details density="compact"></v-select>
                                </setting-input>
                                <setting-input label="原子映射工具" label-for="atomMapper"
                                               help-text="选择用于反应原子映射的工具。">
                                  <v-select :model-value="atomMapper" :items="atomMapperItems"
                                            @update:modelValue="($event) => atomMapper = $event" variant="outlined"
                                            class="mt-4 mb-2" hide-details density="compact"></v-select>
                                </setting-input>
                                <setting-input label="最低可行性分数" label-for="minPlausibility"
                                    help-text="Fast Filter 模型给出的最低可行性阈值。低于该阈值的断键建议会被过滤；阈值过高时可能误过滤可行结果。">
                                    <v-text-field variant="outlined" type="number" v-model="minPlausibility" min="0"
                                        max="1" step="0.000001" hide-details density="compact" id="min-plaus"
                                        class="mb-2"></v-text-field>
                                </setting-input>
                                <setting-input label="启用区域选择性检查"
                                    help-text="开启后，系统会自动标记可能存在区域选择性问题的反应。">
                                    <v-switch label="" v-model="allowSelec" id="checkSelec" hide-details
                                        color="primary"></v-switch>
                                </setting-input>
                                <setting-input label="过滤近似循环"
                                    help-text="开启后，路线网络会避免生成与已有节点过近的循环结构。">
                                   <v-switch label="" v-model="filterNearCycles" id="filterNearCycles" hide-details
                                       color="primary"></v-switch>
                               </setting-input>
                                <setting-input label="自动加入图谱的 Top-N 结果" label-for="reactionLimit"
                                    help-text="每次一步逆合成预测后，自动加入图谱的候选结果数量。设为 0 时可完全手动选择右侧候选。">
                                    <v-text-field label="" id="reactionLimit" v-model.number="reactionLimit"
                                        type="number" variant="outlined" density="compact" hide-details></v-text-field>
                                </setting-input>
                                <setting-input label="策略方案" help-text="添加或调整用于一步逆合成预测的模型策略。" 
                                    class="my-5">
                                    <v-btn variant="flat" @click="addStrategy" icon="mdi-plus" data-cy="ipp-add-strategy-plan" color="primary"
                                        density="compact">
                                    </v-btn>
                                </setting-input>
                                <div class="ml-3">
                                    <div v-if="strategies.length !== 0">
                                        <div v-for="(strategy, idx) in strategies" v-bind:key="idx">
                                            <v-card variant="outlined" class="mb-2" :key="idx" :data-cy="'ipp-strategy-plan-'+(idx+1)">
                                                <v-card-title>
                                                    <v-row>
                                                        <v-col cols="10">
                                                            <span class="text-subtitle-1">{{ "策略 " + (idx + 1)
                                                                }}</span>
                                                        </v-col>
                                                        <v-col cols="2">
                                                            <v-btn icon="mdi-close" variant="flat" density="compact" :id="'strat-close-'+(idx+1)"
                                                                color="red" @click="deleteStrategy(idx)"></v-btn>
                                                        </v-col>
                                                    </v-row>
                                                </v-card-title>
                                                <v-divider></v-divider>
                                                <v-card-text class="pa-6">
                                                    <setting-input label="模型" id="model"
                                                        help-text="选择该策略使用的逆合成模型。" class="mb-2">
                                                        <v-select :items="models" item-title="title" item-value="value"
                                                            variant="outlined" data-cy="ipp_strategy_model_selection" density="compact"
                                                            hide-details :model-value="strategy.retro_backend"
                                                            @update:modelValue="($event) => {
        updateStrategy(idx, 'retro_backend', $event);
        updateStrategy(idx, 'retro_model_name', defaultTrainingSet($event));
    }
        "></v-select>
                                                    </setting-input>
                                                    <div v-if="strategy.retro_backend !== 'template_relevance'">
                                                        <setting-input label="训练集"
                                                            help-text="选择模型使用的训练集或模板来源。"
                                                            class="mt-2" :id="'training-set-'+(idx+1)">
                                                            <v-select density="compact" hide-details
                                                                :model-value="strategy.retro_model_name"
                                                                variant="outlined"
                                                                @update:modelValue="($event) => updateStrategy(idx, 'retro_model_name', $event)"
                                                                :items="trainingSets(strategy.retro_backend)"
                                                                item-title="title" item-value="value">
                                                            </v-select>
                                                        </setting-input>
                                                        <setting-input v-if="strategy.retro_backend === 'retrosim'"
                                                            label="阈值" :id="'threshold-'+(idx+1)"
                                                            help-text="设置该模型策略的过滤阈值。"
                                                            class="mt-5">
                                                            <v-text-field :model-value="strategy.threshold"
                                                                @update:modelValue="($event) => updateStrategy(idx, 'threshold', parseFloat($event))"
                                                                type="number" variant="outlined" density="compact"
                                                                max="1" min="0" hide-details></v-text-field>
                                                        </setting-input>
                                                    </div>

                                                    <div v-else>
                                                        <setting-input label="模板集合" help-text="指定一步逆合成使用的模板优先级模型。选择多个模板集合时，系统会合并候选结果，并继续受后续模板参数约束。" class="mt-2" id="template-set">
                                                            <v-select class="mr-2" density="compact" variant="outlined" data-cy="ipp_strategy_template_set_selection"
                                                                :items="trainingSets(strategy.retro_backend)"
                                                                item-title="title" item-value="value"
                                                                :model-value="strategy.retro_model_name"
                                                                @update:modelValue="($event) => updateTemplateSet(idx, $event)"
                                                                hide-details>
                                                            </v-select>
                                                        </setting-input>
                                                        <div
                                                            v-if="templateAttributes && templateAttributes[strategy.retro_model_name] && templateAttributes[strategy.retro_model_name].length">
                                                            <setting-input label="模板属性过滤" help-text="在模板应用到目标结构前，按预计算属性过滤模板。最大模板数和最大累计概率会在过滤后继续生效。" class="my-5">
                                                                <v-btn variant="flat" color="primary" :id="'template_attribute_filter-strat-'+(idx+1)"
                                                                    @click="addAttributeFilter(idx)">
                                                                    添加 <i class="fas fa-plus"></i>
                                                                </v-btn>
                                                            </setting-input>
                                                            <div
                                                                v-if="strategy.attribute_filter && strategy.attribute_filter.length">
                                                                <table class="table table-borderless table-sm m-0"
                                                                    style="table-layout: fixed">
                                                                    <tbody>
                                                                        <tr v-for="(filter, afIdx) in strategy.attribute_filter"
                                                                            :key="`p-${idx}-f-${afIdx}`">
                                                                            <td style="width: 30%">
                                                                                <v-select class="mr-2"
                                                                                    variant="outlined" density="compact"
                                                                                    :items="templateAttributes[strategy['retro_model_name']]"
                                                                                    :model-value="filter.name"
                                                                                    @update:modelValue="updateAttributeFilter(idx, afIdx, 'name', $event)"
                                                                                    hide-details>
                                                                                </v-select>
                                                                            </td>
                                                                            <td style="width: 30%">
                                                                                <v-select class="mr-2"
                                                                                    variant="outlined" density="compact"
                                                                                    :items="['>', '>=', '<', '<=', '==']"
                                                                                    :model-value="filter.logic"
                                                                                    @update:modelValue="updateAttributeFilter(idx, afIdx, 'logic', $event)"
                                                                                    hide-details>
                                                                                </v-select>
                                                                            </td>
                                                                            <td style="width: 30%">
                                                                                <v-text-field class="mr-2"
                                                                                    variant="outlined" density="compact"
                                                                                    type="number"
                                                                                    :model-value="filter.value"
                                                                                    @update:modelValue="updateAttributeFilter(idx, afIdx, 'value', $event)"
                                                                                    hide-details></v-text-field>
                                                                            </td>
                                                                            <td style="width: 10%">
                                                                                <v-btn variant="plain" size="small"
                                                                                    density="compact" icon="mdi-close"
                                                                                    color="red"
                                                                                    @click="deleteAttributeFilter(idx, afIdx)">
                                                                                </v-btn>
                                                                            </td>
                                                                        </tr>
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                        <div class="my-4">
                                                            <p>
                                                                <em>说明：路线树构建暂不支持模板属性过滤。</em>
                                                            </p>
                                                        </div>
                                                        <setting-input label="最大模板数"
                                                            label-for="max_num_templates"
                                                            help-text="尝试应用到目标结构的最大反应规则/模板数量；实际数量还会受最大累计概率阈值影响。"
                                                            class="mb-2">
                                                            <v-text-field :id="'max_num_templates-strat-'+(idx+1)" density="compact"
                                                                variant="outlined" type="number"
                                                                @update:modelValue="($event) => updateStrategy(idx, 'max_num_templates', $event)"
                                                                :model-value="strategy.max_num_templates"
                                                                hide-details></v-text-field>
                                                        </setting-input>
                                                        <setting-input label="最大累计概率" label-for="max_cum_prob"
                                                            help-text="模板分数累计超过该阈值后停止继续应用模板。例如前两个模板分数之和超过阈值时，只返回这两个模板应用结果。为保证计算效率，该值最大为 0.99999；如需应用全部模板，请直接使用异步 API。">
                                                            <v-text-field :id="'max_cum_prob-strat-'+(idx+1)" density="compact"
                                                                variant="outlined" type="number" min="0" max="1"
                                                                step="0.000001"
                                                                @update:modelValue="($event) => updateStrategy(idx, 'max_cum_prob', Math.min(0.99999, $event))"
                                                                :model-value="strategy.max_cum_prob"
                                                                hide-details></v-text-field>
                                                        </setting-input>
                                                    </div>
                                                </v-card-text>
                                            </v-card>
                                        </div>
                                    </div>
                                    <v-alert v-else type="warning" title="提示" variant="tonal"
                                        text="请至少添加一个策略。" density="compact" class="mb-2"></v-alert>
                                    <v-alert type="info" title="说明" variant="tonal">
                                        <template v-slot:text>
                                            <ul>
                                                <li>- 基于模板：template_relevance
                                                    <p v-if="strategies.some(s => s.retro_model_name?.includes('higher_level'))" class="mb-0 ml-4">
                                                        - Higher-level model：使用带抽象官能团的 synthon-like 表示（<a href="https://pubs.acs.org/doi/10.1021/acscentsci.5c02014" target="_blank">ACS Cent. Sci. 2026, 12, 3, 345-357</a>）；可采购匹配需要子结构检索，速度可能较慢。
                                                    </p>
                                                </li>
                                                <li>- 无模板（翻译模型）：augmented_transformer</li>
                                            </ul>
                                        </template>
                                    </v-alert>
                                </div>
                                <setting-input label="高亮变化原子"
                                    help-text="开启后，结构图会高亮参与转化的原子。">
                                    <v-switch label="" v-model="isHighlightAtom" id="checkHighlight" hide-details
                                        color="primary"></v-switch>
                                </setting-input>
                                <setting-input label="节点结构图对齐目标分子"
                                    help-text="开启后，图谱中的化学节点结构图会尽量与目标分子绘制方向对齐。">
                                    <v-switch label="" v-model="alignNodeImagesToTarget" id="alignMols" hide-details
                                        color="primary"></v-switch>
                                </setting-input>
                                <setting-input label="前体结构图对齐产物"
                                    help-text="开启后，前体和反应结构图会尽量与产物绘制方向对齐。">
                                    <v-switch label="" v-model="alignPrecursorsToProduct" id="alignRxns" hide-details
                                        color="primary"></v-switch>
                                </setting-input>
                            </v-container>
                        </v-window-item>
                        <v-window-item value="mctsTB">
                            <v-container fluid>
                                <v-expansion-panels multiple variant="popout" :color="isDark ? 'grey-darken-3' : 'grey-lighten-3'"
                                    v-model="mctsPanels">
                                    <v-expansion-panel title="路线搜索后台保护">
                                        <v-expansion-panel-text>
                                            <setting-input label="路线树算法" label-for="tbVersion"
                                                help-text="选择原生路线树搜索算法。路线生成以 3-10 条高质量闭合路线为目标，下面的时间、深度和分支参数只是防止任务无限占用服务的后台保护。">
                                                <v-select :model-value="tbVersion" variant="outlined" density="compact" data-cy="select-tbVersion"
                                                    hide-details class="my-2" :items="tbAlgo"
                                                    @update:modelValue="($event) => tbVersion = $event">
                                                </v-select>
                                            </setting-input>
                                            <setting-input label="后台保护时间（秒）" label-for="expansionTime"
                                                help-text="这是服务端单轮路线树搜索的后台保护时间，不是路线成功标准。系统会优先按 3-10 条高质量闭合路线输出结果。">
                                                <v-text-field id="expansionTime" density="compact" variant="outlined"
                                                    type="number" min="60" max="7200" step="60" v-model="expansionTime"
                                                    hide-details class="mb-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="最大迭代保护" label-for="maxIterations"
                                                help-text="可选后台保护项。留空表示不额外限制迭代数，由路线条数目标和其他保护参数控制。">
                                                <v-text-field id="maxIterations" density="compact" variant="outlined"
                                                    type="number" min="1" step="1" v-model="maxIterations" hide-details
                                                    class="mb-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="最大化学节点保护" label-for="maxChemicals"
                                                help-text="可选后台保护项。留空表示不额外限制探索的化学节点数量。">
                                                <v-text-field id="maxChemicals" density="compact" variant="outlined"
                                                    type="number" min="1" step="1" v-model="maxChemicals" hide-details
                                                    class="mb-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="最大反应节点保护" label-for="maxReactions"
                                                help-text="可选后台保护项。留空表示不额外限制探索的反应节点数量。">
                                                <v-text-field id="maxReactions" density="compact" variant="outlined"
                                                    type="number" min="1" step="1" v-model="maxReactions" hide-details
                                                    class="mb-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="最大模板应用保护" label-for="maxTemplates"
                                                help-text="可选后台保护项。留空表示不额外限制模板应用次数。">
                                                <v-text-field id="maxTemplates" density="compact" variant="outlined"
                                                    type="number" min="1" step="1" v-model="maxTemplates" hide-details
                                                    class="mb-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="后台最大深度保护" label-for="maxDepth"
                                                help-text="这是单条路线允许展开的后台深度保护，不是用户侧固定步数要求。复杂结构可适当调大。">
                                                <v-text-field id="maxDepth" density="compact" variant="outlined"
                                                    type="number" min="1" step="1" v-model="maxDepth" hide-details
                                                    class="mb-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="后台最大分支保护" label-for="maxBranching"
                                                help-text="这是每个化学节点最多保留的候选断键数量保护。复杂结构建议使用较大的分支保护。">
                                                <v-text-field id="maxBranching" density="compact" variant="outlined"
                                                    type="number" min="1" max="50" step="1" v-model="maxBranching"
                                                    hide-details class="mb-2"></v-text-field>
                                            </setting-input>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                    <v-expansion-panel title="终止原料判定条件">
                                        <v-expansion-panel-text>
                                            <v-alert type="info" title="说明" variant="tonal" density="compact">
                                                <p class="text-body-2">下列条件用于判断一个前体是否可以作为终止原料。AND 条件需要全部满足，OR 条件满足任意一项即可。</p>
                                            </v-alert>
                                            <setting-input class="mt-2" label="可采购来源"
                                                help-text="限制可采购数据库的来源。路线搜索中某个前体命中所选来源时，该节点会作为商业可得原料终止，不再继续往前拆。">
                                                <div class="d-flex flex-wrap ga-2 mb-3">
                                                    <v-btn size="small" variant="tonal" color="primary"
                                                        @click="setBuyableSourceScope('all')">全部来源</v-btn>
                                                    <v-btn size="small" variant="tonal" color="primary"
                                                        :disabled="!domesticBuyablesSources.length"
                                                        @click="setBuyableSourceScope('domestic')">国内专业源</v-btn>
                                                    <v-chip size="small" :color="domesticBuyablesSources.length ? 'primary' : 'orange-darken-1'"
                                                        variant="tonal">
                                                        {{ domesticBuyablesSources.length ? `已识别 ${domesticBuyablesSources.length} 个国内源` : "国内源未导入" }}
                                                    </v-chip>
                                                </div>
                                                <v-alert type="info" variant="tonal" density="compact" class="mb-3">
                                                    当前范围：{{ buyableSourceScope.label }}；命中可采购来源即终止该前体节点。
                                                </v-alert>
                                                <v-menu>
                                                    <template v-slot:activator="{ props }">
                                                        <v-btn color="primary" dark v-bind="props">
                                                            {{ buyablesSourceDisplay }}
                                                        </v-btn>
                                                    </template>
                                                    <v-list>
                                                        <v-list-item>
                                                            <v-checkbox hide-details v-model="buyablesSourceAll"
                                                                @update:modelValue="buyablesSource = []"
                                                                label="全部"></v-checkbox>
                                                        </v-list-item>
                                                        <v-list-item v-for="(source, index) in buyablesSources"
                                                            :key="index">
                                                            <v-checkbox hide-details v-model="buyablesSource"
                                                                :key="source" :value="source"
                                                                :disabled="buyablesSourceAll">
                                                                <template v-slot:label>
                                                                    {{ source === NO_SOURCE ? NO_SOURCE_TEXT : source }}
                                                                </template>
                                                            </v-checkbox>
                                                        </v-list-item>
                                                    </v-list>
                                                </v-menu>
                                            </setting-input>
                                            <setting-input label="可采购判定逻辑" label-for="buyableLogic"
                                                help-text="设置可采购性条件的逻辑类型。该条件只检查是否存在于可采购数据库，不考虑价格。">
                                                <v-select :items="logicOptions" v-model="buyableLogic" hide-details
                                                    variant="outlined" density="compact" class="mt-2"></v-select>
                                            </setting-input>
                                            <setting-input label="价格判定逻辑" label-for="ppgLogic"
                                                help-text="设置最高单价条件的逻辑类型。">
                                                <v-select :items="logicOptions" v-model="maxPPGLogic" hide-details
                                                    variant="outlined" density="compact" class="mt-2"></v-select>
                                            </setting-input>
                                            <setting-input v-if="maxPPGLogic != 'none'" label="最高单价（$/g）"
                                                label-for="maxPPG"
                                                help-text="MCTS 搜索中，前体单价低于该值时可作为终止原料。"
                                                class="ml-3">
                                                <v-text-field label="" id="maxPPG" v-model.number="maxPPG" type="number"
                                                    variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="SCScore 判定逻辑" label-for="scscoreLogic"
                                                help-text="设置最大合成复杂度分数条件的逻辑类型。">
                                                <v-select :items="logicOptions" v-model="maxScscoreLogic" hide-details
                                                    variant="outlined" density="compact" class="mt-2"
                                                    id="scscoreLogic"></v-select>
                                            </setting-input>
                                            <setting-input v-if="maxScscoreLogic !== 'none'"
                                                label="最高 SCScore（1-5）" label-for="maxScscore" help-text="MCTS 搜索中，前体合成复杂度低于该值时可作为终止原料。取值范围 1-5，5 表示最高复杂度。" class="ml-3">
                                                <v-text-field label="" id="maxScscore" v-model.number="maxScscore"
                                                    type="number" min="1" max="5" variant="outlined" density="compact"
                                                    hide-details class="mt-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="元素组成判定逻辑" label-for="chemPropLogic"
                                                help-text="按元素数量设置最大分子规模条件的逻辑类型。">
                                                <v-select id="chemPropLogic" :items="logicOptions"
                                                    v-model="chemicalPropertyLogic" variant="outlined" density="compact"
                                                    class="mt-2" hide-details></v-select>
                                            </setting-input>
                                            <setting-input v-if="chemicalPropertyLogic !== 'none'" label="最大原子数"
                                                help-text="MCTS 搜索中，各元素数量低于对应阈值时，前体可作为终止原料。"
                                                class="ml-3">
                                                <v-text-field label="C &le;" id="chemPropC"
                                                    v-model.number="chemicalPropertyC" type="number" min="1" step="1"
                                                    variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                                <v-text-field label="N &le;" id="chemPropN"
                                                    v-model.number="chemicalPropertyN" type="number" min="1" step="1"
                                                    variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                                <v-text-field label="O &le;" id="chemPropO"
                                                    v-model.number="chemicalPropertyO" type="number" min="1" step="1"
                                                    variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                                <v-text-field label="H &le;" id="chemPropH"
                                                    v-model.number="chemicalPropertyH" type="number" min="1" step="1"
                                                    variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="训练集中出现频次逻辑" label-for="chemPopLogic"
                                                help-text="按化合物在模板相关性模型训练数据中的出现次数设置终止条件逻辑。">
                                                <v-select id="chemPopLogic" :items="logicOptions"
                                                    v-model="chemicalPopularityLogic" variant="outlined"
                                                    density="compact" class="mt-2" hide-details></v-select>
                                            </setting-input>
                                            <setting-input v-if="chemicalPopularityLogic !== 'none'"
                                                label="最低出现次数"
                                                help-text="MCTS 搜索中，前体历史出现次数高于该值时可作为终止原料。">
                                                <v-text-field label="作为反应物 &ge;" id="chemPopR"
                                                    v-model="chemicalPopularityReactants" type="number" min="1" step="1"
                                                    variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                                <v-text-field label="作为产物 &ge;" id="chemPopP"
                                                    v-model="chemicalPopularityProducts" type="number" min="1" step="1"
                                                    variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                            </setting-input>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                    <v-expansion-panel title="路线聚类选项">
                                        <v-expansion-panel-text>
                                            <setting-input label="聚类路线"
                                                help-text="控制是否对路线树搜索找到的路线进行聚类。">
                                                <v-switch hide-details v-model="pathClusterEnabled" label="全部"
                                                    color="primary">
                                                    <template v-slot:label>
                                                        <span class="sr-only">聚类路线</span>
                                                    </template></v-switch>
                                            </setting-input>
                                            <setting-input label="路线聚类算法"
                                                label-for="pathClusterMethod"
                                                help-text="选择路线聚类使用的算法。">
                                                <v-select hide-details id="pathClusterMethod"
                                                    v-model="pathClusterMethod" :items="pathClusterMethodItems"
                                                    variant="outlined" density="compact"></v-select>
                                            </setting-input>
                                            <setting-input v-show="pathClusterMethod === 'hdbscan'"
                                                label="最小聚类规模" label-for="pathClusterMinSize"
                                                help-text="hdbscan 算法的 min_cluster_size 参数。">
                                                <v-text-field label="作为产物 &ge;" id="pathClusterMinSize"
                                                    v-model.number="pathClusterMinSize" type="number" min="1" max="100"
                                                    step="1" variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                            </setting-input>
                                            <setting-input v-show="pathClusterMethod === 'hdbscan'" label="最小样本数"
                                                label-for="pathClusterMinSamples"
                                                help-text="hdbscan 算法的 min_samples 参数。">
                                                <v-text-field label="作为产物 &ge;" id="pathClusterMinSamples"
                                                    v-model.number="pathClusterMinSamples" type="number" min="1"
                                                    max="100" step="1" variant="outlined" density="compact" hide-details
                                                    class="mt-2"></v-text-field>
                                            </setting-input>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                    <v-expansion-panel title="路线输出目标">
                                        <v-expansion-panel-text>
                                            <setting-input label="找到首条即返回"
                                                help-text="最高质量模式默认关闭。关闭时系统会继续搜索候选池，再按路线打分和聚类筛选最终结果。">
                                                <v-switch id="returnFirst" hide-details v-model="returnFirst"
                                                    color="primary">
                                                </v-switch>
                                            </setting-input>
                                            <setting-input label="内部候选路线池" label-for="maxTrees"
                                                help-text="ASKCOS 会先在更大的候选池中搜索、打分和聚类；最终结果仍固定输出 3-10 条闭合路线。">
                                                <v-text-field label="" id="maxTrees" v-model.number="maxTrees"
                                                    type="number" min="10" max="500" step="10" variant="outlined" density="compact"
                                                    hide-details class="mt-2"></v-text-field>
                                            </setting-input>
                                            <setting-input label="跳转到 IPP 图谱结果"
                                                help-text="开启后，路线树结果会跳转到 IPP 交互式图谱视图，而不是逐条路线查看页。">
                                                <v-switch id="redirectToGraph" hide-details v-model="redirectToGraph"
                                                    color="primary">
                                                </v-switch>
                                            </setting-input>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                </v-expansion-panels>
                            </v-container>
                        </v-window-item>
                        <v-window-item value="IPPC">
                            <v-container fluid>

                                <setting-input label="聚类相似前体" data-cy="ipp-strategy-clustering-toggle"
                                    help-text="用于开启或关闭前体聚类。">
                                    <v-switch id="allowClusterSetting" hide-details v-model="precursorClusterEnabled"
                                        color="primary">
                                    </v-switch>
                                </setting-input>
                                <div v-if="precursorClusterEnabled">
                                    <setting-input label="聚类方法" label-for="clusterMethod"  data-cy="ipp-strategy-clustering-method"
                                        help-text="选择 kmeans、hdbscan 或 rxn_class 聚类算法。">
                                        <v-select hide-details id="clusterMethod" v-model="precursorClusterMethod"
                                            :items="precursorClusterMethodItems" variant="outlined"
                                            density="compact"></v-select>
                                    </setting-input>
                                    <v-alert v-if="precursorClusterMethod === 'rxn_class'" title="警告"
                                        type="warning" class="my-4" density="compact">
                                        rxn_class 聚类比其他聚类方法耗时更长。
                                    </v-alert>
                                    <div v-if="precursorClusterMethod === 'rxn_class'">
                                        <setting-input label="特征" label-for="clusterFeature"
                                            help-text="该聚类参数决定输入聚类算法的指纹特征。">
                                            <v-select id="clusterFeature" v-model="precursorClusterFeature"
                                                :items="precursorClusterFeatureItems" variant="outlined"
                                                density="compact" hide-details class="mt-2"></v-select>
                                        </setting-input>
                                        <setting-input label="指纹类型" label-for="clusterFingerprint"
                                            help-text="当前仅支持 Morgan 指纹方法。">
                                            <v-select id="clusterFingerprint" v-model="precursorClusterFingerprint"
                                                :items="precursorClusterFingerprintItems" variant="outlined"
                                                density="compact" hide-details class="mt-2"></v-select>
                                        </setting-input>
                                        <setting-input label="指纹长度" label-for="clusterBits"
                                            help-text="设置 Morgan 指纹构建时使用的固定折叠长度。">
                                            <v-text-field id="clusterBits" v-model.number="precursorClusterFpBits"
                                                type="number" variant="outlined" density="compact" hide-details
                                                class="mt-2"></v-text-field>
                                        </setting-input>
                                        <setting-input label="指纹半径" label-for="clusterRadius"
                                            help-text="设置 Morgan 指纹构建时使用的半径。">
                                            <v-text-field id="clusterRadius" v-model.number="precursorClusterFpRadius"
                                                type="number" variant="outlined" density="compact" hide-details
                                                class="mt-2"></v-text-field>
                                        </setting-input>
                                    </div>
                                </div>
                            </v-container>
                        </v-window-item>
                        <v-window-item value="graphVis">
                            <v-container fluid>
                                <setting-input :label="`边弹簧常数：${graphSpringConstant}`"
                                    label-for="graphSpringConst">
                                    <v-slider label="" id="graphSpringConst" v-model="graphSpringConstant"
                                        @update:modelValue="$emit('changeNetopt')" min="0" max="0.3" step="0.005"
                                        density="compact" hide-details class="mt-2" color="primary"></v-slider>
                                </setting-input>
                                <setting-input :label="`化学节点大小：${graphNodeSize}`"
                                    label-for="graphNodeSize">
                                    <v-slider label="" id="graphNodeSize" v-model="graphNodeSize"
                                        @update:modelValue="$emit('changeNetopt')" min="1" max="60" step="1"
                                        density="compact" hide-details class="mt-2" color="primary"></v-slider>
                                </setting-input>
                                <setting-input :label="`反应节点大小：${graphNodeFontSize}`"
                                    label-for="graphFontSize">
                                    <v-slider label="" id="graphFontSize" v-model="graphNodeFontSize"
                                        @update:modelValue="$emit('changeNetopt')" min="1" max="20" step="1"
                                        density="compact" hide-details class="mt-2" color="primary"></v-slider>
                                </setting-input>
                                <setting-input :label="`节点等效质量：${graphNodeMass}`"
                                    label-for="graphNodeMass">
                                    <v-slider label="" id="graphNodeMass" v-model="graphNodeMass"
                                        @update:modelValue="$emit('changeNetopt')" min="0.1" max="5" step="0.1"
                                        density="compact" hide-details class="mt-2" color="primary"></v-slider>
                                </setting-input>
                                <setting-input label="层级布局">
                                    <v-switch id="checkHier" hide-details v-model="graphHierarchicalEnabled"
                                        @update:modelValue="$emit('change-netopt')" color="primary">
                                    </v-switch>
                                </setting-input>
                                <setting-input v-if="graphHierarchicalEnabled" label="层级方向"
                                    label-for="graphHierDir">
                                    <v-select id="graphHierDir" v-model="graphHierarchicalDirection" :items="HDItems"
                                        @update:modelValue="$emit('change-netopt')" variant="outlined" density="compact"
                                        hide-details></v-select>
                                </setting-input>
                                <setting-input v-if="graphHierarchicalEnabled"
                                    :label="`层级间距：${graphHierarchicalLevelSeparation}`"
                                    label-for="graphLevelSep">
                                    <v-slider label="" id="graphLevelSep" v-model="graphHierarchicalLevelSeparation"
                                        @update:modelValue="$emit('changeNetopt')" min="1" max="500" step="1"
                                        density="compact" hide-details class="mt-2" color="primary"></v-slider>
                                </setting-input>
                            </v-container>
                        </v-window-item>
                    </v-window>
                </div>
            </v-card-text>
            <v-divider></v-divider>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn variant="tonal" @click="clearEmit" data-cy="ipp-setting-save">保存</v-btn>
                <v-btn variant="tonal" color="red" @click="resetSettings" data-cy="ipp-setting-reset">重置</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script>
import {
    NO_SOURCE,
    NO_SOURCE_TEXT,
    getBuyableSourceScope,
    getDomesticBuyableSources,
    sourceArgsToDisplay,
} from "@/common/buyables";
import { storageAvailable } from "@/common/utils";
import { API } from "@/common/api";
import {
    FINAL_ROUTE_OUTPUT_MAX,
    HIGH_QUALITY_CANDIDATE_POOL,
} from "@/common/tree-quality-policy";
import {
    getDefaultRetroTrainingSet,
    getRetroModelItems,
    getRetroTrainingSetItems,
} from "@/common/retro-options";
import SettingInput from "./SettingInput";
import { mapStores } from "pinia";
import { useResultsStore } from "@/store/results";
import { useSettingsStore } from "@/store/settings";
import { useTheme } from "@/composables/useTheme";


export default {
    name: "SettingsModal",
    components: {
        SettingInput,
    },
    props: {
        enableResolver: {
            type: Boolean,
            default: false,
        },
        templateAttributes: {
            type: Object,
            default: () => ({}),
        },
        templateSets: {
            type: Object,
            default: () => ({}),
        },
        visible: {
            type: Boolean,
            default: false,
        },
    },
    setup() {
        const { isDark } = useTheme()
        return { isDark }
    },
    data() {
        return {
            tbAlgo: [
                { value: "mcts", title: "MCTS" },
                { value: "retro_star", title: "Retro Star" },
            ],
            modelStatus: [],
            runtimeCapabilities: null,
            templateSetsList: [],
            buyablesSources: [],
            logicOptions: [
                { value: "none", title: "不使用" },
                { value: "or", title: "满足任一条件" },
                { value: "and", title: "同时满足" },
            ],
            NO_SOURCE: NO_SOURCE,
            NO_SOURCE_TEXT: NO_SOURCE_TEXT,
            tab: 'general',
            precursorScoringItems: [
                { title: "相关性启发式", value: "relevance_heuristic" },
                { title: "SCScore", value: "scscore" }
            ],
            atomMapperItems: [
                { title: "RXNMapper", value: "rxnmapper" },
                { title: "Indigo", value: "indigo" }
            ],
            mctsPanels: [0],
            pathClusterMethodItems: [
                { title: "hdbscan", value: "hdbscan" },
                { title: "kmeans", value: "kmeans" }
            ],
            precursorClusterMethodItems: [
                { title: "kmeans", value: "kmeans" },
                { title: "hdbscan", value: "hdbscan" },
                { title: "rxn_class", value: "rxn_class" }
            ],
            HDItems: [
                { title: "自上而下", value: "UD" },
                { title: "从左到右", value: "LR" },
                { title: "自下而上", value: "DU" },
                { title: "从右到左", value: "RL" },
            ],
            precursorClusterFeatureItems: [
                { title: "原始结构", value: "original" },
                { title: "产物结构", value: "outcomes" },
                { title: "全部特征", value: "all" }
            ],
            precursorClusterFingerprintItems: [
                { title: "Morgan", value: "morgan" }
            ]
        };
    },
    computed: {
        showSettings: {
            get() {
                return this.visible;
            }
        },
        models() {
            return getRetroModelItems(this.modelStatus, this.runtimeCapabilities);
        },
        buyablesSourceDisplay() {
            if (this.buyablesSourceAll) {
                return "全部来源";
            } else if ((this.buyablesSource || []).length) {
                return sourceArgsToDisplay(this.buyablesSource || []);
            } else {
                return "选择来源";
            }
        },
        domesticBuyablesSources() {
            return getDomesticBuyableSources(this.buyablesSources);
        },
        buyableSourceScope() {
            return getBuyableSourceScope(
                this.buyablesSources,
                this.buyablesSourceAll,
                this.buyablesSource || []
            );
        },
        allowResolve: {
            get() {
                return this.settingsStore.allowResolve;
            },
            set(value) {
                this.settingsStore.setOption({
                    key: "allowResolve",
                    value: value,
                });
            },
        },
        isHighlightAtom: {
            get() {
                return this.settingsStore.isHighlightAtom;
            },
            set(value) {
                this.settingsStore.setOption({
                    key: "isHighlightAtom",
                    value: value,
                });
            },
        },
        alignNodeImagesToTarget: {
            get() {
                return this.settingsStore.alignNodeImagesToTarget;
            },
            set(value) {
                this.settingsStore.alignNodeImagesToTarget = value;
                this.resultsStore.updateImageUrls();
            },
        },
        alignPrecursorsToProduct: {
            get() {
                return this.settingsStore.alignPrecursorsToProduct;
            },
            set(value) {
                this.settingsStore.setOption({
                    key: "alignPrecursorsToProduct",
                    value: value,
                });
            },
        },
        reactionLimit: {
            get() {
                return this.settingsStore.reactionLimit;
            },
            set(value) {
                this.settingsStore.setOption({
                    key: "reactionLimit",
                    value: value,
                });
            },
        },
        threshold: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.retro_backend_options.threshold;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.retro_backend_options.threshold = value;
            },
        },
        precursorClusterEnabled: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.cluster_precursors;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.cluster_precursors = value;
            },
        },
        precursorClusterMethod: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.cluster_setting.cluster_method;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.cluster_setting.cluster_method = value
            },
        },
        precursorClusterFeature: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.cluster_setting.feature;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.cluster_setting.feature = value;
            },
        },
        precursorClusterFingerprint: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.cluster_setting.fp_type;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.cluster_setting.fp_type = value;
            },
        },
        precursorClusterFpBits: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.cluster_setting.fp_length;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.cluster_setting.fp_length = value;
            },
        },
        precursorClusterFpRadius: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.cluster_setting.fp_radius;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.cluster_setting.fp_radius = value;
            },
        },
        allowSelec: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.selectivity_check;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.selectivity_check = value;
            },
        },
        filterNearCycles: {
            get() {
                return this.resultsStore.filterNearCycles;
            },
            set(value) {
                this.resultsStore.setfilterNearCycles(value);
            },
        },
        modelRank: {
            get() {
                return this.settingsStore.modelRank;
            },
            set(value) {
                this.settingsStore.modelRank = value;
            },
        },
        buyablesSourceAll: {
            get() {
                return this.settingsStore.tbSettings.buyablesSourceAll;
            },
            set(value) {
                this.settingsStore.setTbSetting({
                    key: "buyablesSourceAll",
                    value: value,
                });
            },
        },
        buyablesSource: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.buyables_source;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.buyables_source = value;
            },
        },
        expansionTime: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.expansion_time;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.expansion_time = value;
            },
        },
        maxBranching: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_branching;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_branching = value;
            },
        },
        maxChemicals: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_chemicals;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_chemicals = value;
            },
        },
        maxDepth: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_depth;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_depth = value;
            },
        },
        maxIterations: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_iterations;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_iterations = value;
            },
        },
        maxReactions: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_reactions;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_reactions = value;
            },
        },
        maxTemplates: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_templates;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_templates = value;
            },
        },
        maxTrees: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_trees;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_trees = Math.max(
                    10,
                    Math.min(500, Number(value) || HIGH_QUALITY_CANDIDATE_POOL)
                );
                this.settingsStore.tree_builder_settings.enumerate_paths_options.max_paths = FINAL_ROUTE_OUTPUT_MAX;
            },
        },
        minPlausibility: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.fast_filter_threshold;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.fast_filter_threshold = value;
            },
        },
        pathClusterEnabled: {
            get() {
                return this.settingsStore.tree_builder_settings.enumerate_paths_options.cluster_trees;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.enumerate_paths_options.cluster_trees = value;
            },
        },
        pathClusterMethod: {
            get() {
                return this.settingsStore.tree_builder_settings.enumerate_paths_options.cluster_method;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.enumerate_paths_options.cluster_method = value;
            },
        },
        pathClusterMinSize: {
            get() {
                return this.settingsStore.tree_builder_settings.enumerate_paths_options.min_cluster_size;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.enumerate_paths_options.min_cluster_size = value;
            },
        },
        pathClusterMinSamples: {
            get() {
                return this.settingsStore.tree_builder_settings.enumerate_paths_options.min_samples;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.enumerate_paths_options.min_samples = value;
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
        precursorScoring: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.retro_rerank_backend;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.retro_rerank_backend = value;
            },
        },
        atomMapper: {
            get() {
                return this.settingsStore.interactive_path_planner_settings.atom_map_backend;
            },
            set(value) {
                this.settingsStore.interactive_path_planner_settings.atom_map_backend = value;
            },
        },
        redirectToGraph: {
            get() {
                return this.settingsStore.tbSettings.redirectToGraph;
            },
            set(value) {
                this.settingsStore.setTbSetting({
                    key: "redirectToGraph",
                    value: value,
                });
            },
        },
        returnFirst: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.return_first;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.return_first = value;
            },
        },
        tbVersion: {
            get() {
                return this.settingsStore.tree_builder_settings.backend;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.backend = value;
            }
        },
        buyableLogic: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.buyable_logic;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.buyable_logic = value;
            },
        },
        maxPPGLogic: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_ppg_logic;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_ppg_logic = value;
            },
        },
        maxPPG: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_ppg;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_ppg = value;
            },
        },
        maxScscoreLogic: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_scscore_logic;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_scscore_logic = value;
            },
        },
        maxScscore: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_scscore;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_scscore = value;
            },
        },
        chemicalPropertyLogic: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.chemical_property_logic;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.chemical_property_logic = value;
            },
        },
        chemicalPropertyC: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_chemprop_c;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_chemprop_c = value;
            },
        },
        chemicalPropertyN: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_chemprop_n;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_chemprop_n = value;
            },
        },
        chemicalPropertyO: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_chemprop_o;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_chemprop_o = value;
            },
        },
        chemicalPropertyH: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.max_chemprop_h;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.max_chemprop_h = value;
            },
        },
        chemicalPopularityLogic: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.chemical_popularity_logic;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.chemical_popularity_logic = value;
            },
        },
        chemicalPopularityReactants: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.min_chempop_reactants;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.min_chempop_reactants = value;
            },
        },
        chemicalPopularityProducts: {
            get() {
                return this.settingsStore.tree_builder_settings.build_tree_options.min_chempop_products;
            },
            set(value) {
                this.settingsStore.tree_builder_settings.build_tree_options.min_chempop_products = value;
            },
        },
        graphSpringConstant: {
            get() {
                return this.settingsStore.visjsOptions.physics.barnesHut.springConstant;
            },
            set(value) {
                this.settingsStore.setVisSpringConstant(value);
            },
        },
        graphNodeSize: {
            get() {
                return this.settingsStore.visjsOptions.nodes.size;
            },
            set(value) {
                this.settingsStore.setVisNodeSize(value);
            },
        },
        graphNodeFontSize: {
            get() {
                return this.settingsStore.visjsOptions.nodes.font.size;
            },
            set(value) {
                this.settingsStore.setVisNodeFontSize(value);
            },
        },
        graphNodeMass: {
            get() {
                return this.settingsStore.visjsOptions.nodes.mass;
            },
            set(value) {
                this.settingsStore.setVisNodeMass(value);
            },
        },
        graphHierarchicalEnabled: {
            get() {
                return this.settingsStore.visjsOptions.layout.hierarchical.enabled;
            },
            set(value) {
                this.settingsStore.setVisHierachicalEnabled(value);
            },
        },
        graphHierarchicalDirection: {
            get() {
                return this.settingsStore.visjsOptions.layout.hierarchical.direction;
            },
            set(value) {
                this.settingsStore.setVisHierarchicalDirection(value);
            },
        },
        graphHierarchicalLevelSeparation: {
            get() {
                return this.settingsStore.visjsOptions.layout.hierarchical.levelSeparation;
            },
            set(value) {
                this.settingsStore.setVisHierarchicalLevelSeparation(value);
            },
        },
        ...mapStores(useResultsStore, useSettingsStore),
    },
    created() {
        API.get("/api/buyables/sources/", null, false).then((json) => {
            this.buyablesSources = json.sources;
        });
        API.get("/api/template/sets", null, false).then((json) => {
            this.templateSetsList = json["template_sets"];
        });
        API.get("/api/admin/get-backend-status", null, false).then((json) => {
            this.modelStatus = json["modules"];
        });
        API.get("/api/runtime/capabilities", null, false)
            .then((json) => {
                this.runtimeCapabilities = json;
            })
            .catch(() => {
                this.runtimeCapabilities = null;
            });
    },
    methods: {
        getAllSettings() {
            return {
                network: this.settingsStore.visjsUserOptions,
                interactive_path_planner: this.settingsStore.interactive_path_planner_settings,
                tree_builder: this.settingsStore.tree_builder_settings,
                tb: this.settingsStore.tbSettings,
                ipp: this.settingsStore.ippSettings,
            };
        },
        clearEmit() {
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
            this.$emit('update:settingsVisible', false);
        },
        setBuyableSourceScope(scope) {
            if (scope === "all") {
                this.buyablesSourceAll = true;
                this.buyablesSource = [];
                return;
            }

            if (scope === "domestic" && this.domesticBuyablesSources.length) {
                this.buyablesSourceAll = false;
                this.buyablesSource = [...this.domesticBuyablesSources];
            }
        },
        trainingSets(model) {
            return getRetroTrainingSetItems(model, this.modelStatus, this.runtimeCapabilities);
        },
        defaultTrainingSet(model) {
            return getDefaultRetroTrainingSet(model, this.modelStatus, this.runtimeCapabilities);
        },
        updateTemplateSet(strategyIndex, value) {
            this.updateStrategy(strategyIndex, 'retro_model_name', value)
            this.updateStrategy(strategyIndex, 'attribute_filter', [])
        },
        addAttributeFilter(strategyIndex) {
            this.settingsStore.addAttributeFilter({
                strategyIndex: strategyIndex,
                item: {
                    name: this.templateAttributes[this.strategies[strategyIndex]["retro_model_name"]][0],
                    logic: ">",
                    value: 0.5,
                },
            });
        },
        deleteAttributeFilter(strategyIndex, attrFilterIndex) {
            this.settingsStore.deleteAttributeFilter({
                strategyIndex: strategyIndex,
                attrFilteriIndex: attrFilterIndex,
            });
        },
        updateAttributeFilter(strategyIndex, attrFilterIndex, key, value) {
            this.settingsStore.updateAttributeFilter({
                strategyIndex: strategyIndex,
                attrFilterIndex: attrFilterIndex,
                key: key,
                value: value,
            });
        },
        addStrategy() {
            this.settingsStore.addStrategy({
                item: {
                    retro_backend: "template_relevance",
                    retro_model_name: "reaxys",
                    attribute_filter: [],
                    max_num_templates: 1000,
                    max_cum_prob: 0.999,
                    threshold: 0.3
                },
            });
        },
        deleteStrategy(strategyIndex) {
            this.settingsStore.deleteStrategy({
                strategyIndex: strategyIndex,
            });
        },
        updateStrategy(strategyIndex, key, value) {
            if (key === "max_num_templates") {
                value = parseInt(value, 10);
            }
            this.settingsStore.updateStrategy({
                strategyIndex: strategyIndex,
                key: key,
                value: value,
            });
        },
        resetSettings() {
            this.settingsStore.resetSettings();
            this.resultsStore.setfilterNearCycles(false);
            this.$emit('changeNetopt')
        },
    },
};
</script>

<style>
.modal-right {
    margin: 1.75rem 1.75rem 1.75rem auto !important;
}
</style>
