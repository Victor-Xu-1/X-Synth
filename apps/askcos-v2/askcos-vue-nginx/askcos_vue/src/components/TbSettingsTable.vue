<template>
  <v-container id="settings">
    <v-row>
      <v-col cols="12" class="text-center pa-0">
        <div>目标结构：{{ targetSmiles }}</div>
      </v-col>
      <v-col cols="12" align="center" justify="center" class="pa-0">
        <copy-tooltip :data="targetSmiles">
          <smiles-image v-if="targetSmiles" :smiles="targetSmiles" max-width="300px" />
        </copy-tooltip>
      </v-col>
    </v-row>
    <v-row>
      <v-table col="12" class="p-2">
        <template v-slot:default>
          <tbody>
            <tr v-if="settings.template_set">
              <th>模板集：</th>
              <td>名称：{{ settings.template_set }}</td>
              <td>版本：{{ settings.template_prioritizer_version || 'N/A' }}</td>
            </tr>
            <template v-else-if="settings.template_prioritizers">
              <tr v-for="(tp, index) in settings.template_prioritizers" :key="index">
                <th v-if="index === 0">模板优先级模型：</th>
                <th v-else></th>
                <td>模板集：{{ tp.template_set }}</td>
                <td>版本：{{ tp.version || 'N/A' }}</td>
              </tr>
            </template>
            <template v-else>
              <tr v-for="(option, index) in settings.expand_one_options['retro_backend_options']" :key="index">
                <th v-if="index === 0">逆合成选项：</th>
                <th v-else></th>
                <td>后端：{{ option.retro_backend }}</td>
                <td>模型名：{{ option.retro_model_name }}</td>
              </tr>
            </template>
            <tr>
              <th>路线树版本：</th>
              <td>{{ tbVersion === 2 ? "MCTS" : "Retro Star" }}</td>
              <td></td>
            </tr>
            <tr>
              <th>路线输出目标:</th>
              <td>最多闭合路线: {{ settings.build_tree_options.max_trees || 10 }}</td>
              <td>找到首条即返回: {{ settings.build_tree_options.return_first ? "是" : "否" }}</td>
            </tr>
            <tr>
              <th>后台搜索保护:</th>
              <td>最大深度: {{ settings.build_tree_options.max_depth }}</td>
              <td>最大分支: {{ settings.build_tree_options.max_branching }}</td>
            </tr>
            <tr>
              <th></th>
              <td>模板数量: {{ settings.expand_one_options.retro_backend_options[0].max_num_templates }}</td>
              <td>累计概率: {{ settings.expand_one_options.retro_backend_options[0].max_cum_prob }}</td>
            </tr>
            <tr>
              <th></th>
              <td>保护时间（秒）: {{ settings.build_tree_options.expansion_time }}</td>
              <td>最大迭代: {{ settings.build_tree_options.max_iterations || "N/A" }}</td>
            </tr>
            <tr>
              <th></th>
              <td>最大化学节点: {{ settings.build_tree_options.max_chemicals || "N/A" }}</td>
              <td>最大反应节点: {{ settings.build_tree_options.max_reactions || "N/A" }}</td>
            </tr>
            <template v-if="!!settings.build_tree_options.buyable_logic">
              <tr>
                <th>可采购停止条件（{{ settings.build_tree_options.buyable_logic.toUpperCase() }}）</th>
                <td colspan=2>化合物命中可采购数据库</td>
              </tr>
            </template>
            <template v-if="!!settings.build_tree_options.chemical_popularity_logic">
              <tr>
                <th>化合物流行度停止条件
                  ({{ settings.build_tree_options.chemical_popularity_logic.toUpperCase() }})</th>
                <td colspan=2>
                  最低出现次数：<br />
                  <span v-if="!!settings.build_tree_options.min_chempop_reactants">
                    作为反应物出现次数 &geq; {{ settings.build_tree_options.min_chempop_reactants }};
                  </span>
                  <span v-if="!!settings.build_tree_options.min_chempop_products">
                    作为产物出现次数 &geq; {{ settings.build_tree_options.min_chempop_products }};
                  </span>
                </td>
              </tr>
            </template>
            <template v-if="!!settings.build_tree_options.chemical_property_logic">
              <tr>
                <th>化学属性停止条件
                  ({{ settings.build_tree_options.chemical_property_logic.toUpperCase() }})</th>
                <td colspan=2>
                  最大元素数量：<br />
                  <span v-if="!!settings.build_tree_options.max_chemprop_c">C &leq; {{
          settings.build_tree_options.max_chemprop_c }};</span>
                  <span v-if="!!settings.build_tree_options.max_chemprop_n">N &leq; {{
          settings.build_tree_options.max_chemprop_n }};</span>
                  <span v-if="!!settings.build_tree_options.max_chemprop_h">H &leq; {{
          settings.build_tree_options.max_chemprop_h }};</span>
                  <span v-if="!!settings.build_tree_options.max_chemprop_o">O &leq; {{
          settings.build_tree_options.max_chemprop_o }};</span>
                </td>
              </tr>
            </template>
            <template v-if="!!settings.build_tree_options.max_ppg_logic">
              <tr>
                <th>最高价格停止条件（{{ settings.build_tree_options.max_ppg_logic.toUpperCase() }}）</th>
                <td colspan=2>最高化合物价格（$/g）：
                  <span v-if="!!settings.build_tree_options.max_ppg"> {{ settings.build_tree_options.max_ppg }}</span>
                </td>
              </tr>
            </template>
            <template v-if="!!settings.build_tree_options.max_scscore_logic">
              <tr>
                <th>最高 SCScore 停止条件（{{ settings.build_tree_options.max_scscore_logic.toUpperCase() }}）
                </th>
                <td colspan=2>最高 SCScore：
                  <span v-if="!!settings.build_tree_options.max_scscore"> {{ settings.build_tree_options.max_scscore
                    }}</span>
                </td>
              </tr>
            </template>
            <tr>
              <th>评估设置：</th>
              <td>最低可行性：{{ settings.expand_one_options['filter_threshold'] }}</td>
              <td></td>
            </tr>
            <tr>
              <th>可采购来源：</th>
              <td>{{ buyablesSources }}</td>
              <td></td>
            </tr>
            <tr v-if="!!settings.expand_one_options['banned_chemicals']">
              <th>禁用化合物：</th>
              <td>{{ settings.expand_one_options['banned_chemicals'].length }}</td>
              <td></td>
            </tr>
            <tr v-if="!!settings.expand_one_options['banned_reactions']">
              <th>禁用反应：</th>
              <td>{{ settings.expand_one_options['banned_reactions'].length }}</td>
              <td></td>
            </tr>
          </tbody>
        </template>
      </v-table>
    </v-row>
  </v-container>
</template>

<script>
import CopyTooltip from "@/components/CopyTooltip";
import SmilesImage from "@/components/SmilesImage";
import { sourceQueryToArgs, sourceArgsToDisplay } from "@/common/buyables";

export default {
  name: 'TbSettingsTable',
  components: {
    CopyTooltip,
    SmilesImage,
  },
  props: {
    id: {
      type: String,
      default: 'settings-table'
    },
    settings: {
      type: Object,
      default: () => ({}),
    },
    targetSmiles: {
      type: String,
      default: ''
    },
    tbVersion: {
      type: [String, Number],
      default: 2
    }
  },
  computed: {
    buyablesSources() {
      if (this.settings['buyables_source']) {
        return sourceArgsToDisplay(sourceQueryToArgs(this.settings.buyables_source))
      } else {
        return '全部'
      }
    },
  },
}
</script>
