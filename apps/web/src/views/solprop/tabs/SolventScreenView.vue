<template>
  <v-container fluid style="min-height: calc(100vh-50px)">
    <v-row class="justify-center align-center">
      <v-col cols="12" md="12" class="pa-0">
        <v-sheet elevation="2" class="pa-10" rounded="lg">
          <v-form @submit.prevent>
            <v-row class="justify-center align-center">
              <v-col cols="12" md="4">
                <StructureInput ref="soluteInput" v-model="solute" label="溶质"
                  :disabled="loading" data-cy="solscreen-solute" />
              </v-col>
              <v-col cols="12" md="4">
                <v-row class="mb-2">
                  <v-select data-cy="solscreen-solsets" label="溶剂集合" variant="outlined"
                    :items="solventSetOptions" item-title="title" item-value="value" hide-details v-model="solventSet"
                    :disabled="loading || structurePending" rounded="pill">
                  </v-select>
                </v-row>
                <v-row>
                  <v-textarea label="溶剂列表" hide-details variant="outlined" v-model="solvents"
                    :rows="3" :disabled="loading || selectedSolventInput?.pending" spellcheck="false"
                    data-cy="solscreen-solvent-list" />
                </v-row>
                <v-select v-model="selectedSolventIndex" :items="solventEntries" item-title="title" item-value="value"
                  label="溶剂条目" variant="outlined" density="compact" hide-details class="mt-3"
                  :disabled="loading || selectedSolventInput?.pending" data-cy="solscreen-selected-solvent" />
                <StructureInput ref="selectedSolventInput" :key="selectedSolventIndex" v-model="selectedSolvent"
                  label="所选溶剂" :disabled="loading" class="mt-3" />
              </v-col>
              <v-col cols="12" md="4">
                <v-textarea label="温度列表" hide-details variant="outlined" v-model="temperatures"></v-textarea>
              </v-col>
            </v-row>
            <v-row align="center" justify-start>
              <v-col cols="12">
                <v-btn type="submit" data-cy="solscreen-submit" variant="flat" color="primary" class="mr-5"
                  @click="predict" :loading="loading" :disabled="loading || structurePending">提交</v-btn>
                <v-btn @click="dialog = true" variant="flat" class="mr-5" prepend-icon="mdi-dots-horizontal"
                  color="primary">
                  更多参数
                </v-btn>
                <v-btn variant="tonal" class="mr-5" @click="customDialog = !customDialog"
                  v-if="solventSet === 'custom'" :disabled="loading || structurePending">
                  保存自定义溶剂集合
                </v-btn>
                <v-btn data-cy="solscreen-custom-solv-set-delete" variant="tonal" class="mr-5" color="red"
                  v-if="Object.keys(customSolventSets).includes(solventSet)" @click="deleteSolventSet">
                  删除自定义溶剂集合
                </v-btn>
                <v-btn data-cy="solscreen-clear" variant="tonal" class="mr-5" :disabled="results.length === 0"
                  @click="clear(false)">
                  清空结果
                </v-btn>
                <v-btn variant="tonal" color="info" @click="showInfo = !showInfo">模型输入/输出说明</v-btn>
              </v-col>
            </v-row>
          </v-form>
        </v-sheet>
      </v-col>
    </v-row>

    <v-row>
      <v-col class="pa-0 mt-4">
        <v-sheet elevation="2" class="pa-4" rounded="lg">
          <div v-if="results.length">
            <v-row>
              <v-col cols="12" md="12">
                <div class="d-flex flex-row justify-center align-center">
                  <v-select data-cy="solscreen-calc-method" label="计算方法" variant="outlined"
                    v-model="selectedMethod" :items="methodOptions" hide-details class="mr-4">
                  </v-select>
                  <v-select data-cy="solscreen-units" label="单位" variant="outlined" v-model="selectedUnits"
                    :items="unitOptions" hide-details class="mr-4">
                  </v-select>
                  <v-select data-cy="solscreen-x-axis" label="X 轴" variant="outlined" v-model="selectedX"
                    :items="xOptions" hide-details class="mr-4">
                  </v-select>
                  <v-spacer></v-spacer>
                  <v-menu location="bottom" :close-on-content-click="false">
                    <template v-slot:activator="{ props }">
                      <v-btn v-bind="props" data-cy="solscreen-download" variant="flat" color="primary">下载</v-btn>
                    </template>
                    <v-card width="auto" min-width="250px">
                      <v-list density="compact">
                        <v-list-item data-cy="solscreen-download-csv" @click="downloadCSV">下载 CSV</v-list-item>
                        <v-list-item data-cy="solscreen-download-json" @click="downloadJSON">下载 JSON</v-list-item>
                      </v-list>
                    </v-card>
                  </v-menu>
                </div>
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="12">
                <bar-chart v-if="selectedX === 'solvent'" data-cy="solscreen-chart-solvent" ref="chart"
                  chart-id="solubility-chart" :data="chartData" :options="chartOptions" style="height:40vh"></bar-chart>
                <line-chart v-if="selectedX === 'temperature'" data-cy="solscreen-chart-temp" ref="chart" chart-id="solubility-chart" :data="chartData"
                  :options="chartOptions" style="height:40vh"></line-chart>
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="12">
                <v-data-table data-cy="solscreen-table" :headers="fields" :items="tableData" fixed-header style="height: 100%" class="mt-3"
                  density="compact" :loading="loading">
                  <template v-slot:item.image="{ item }">
                    <smiles-image :smiles="item['solvent']"></smiles-image>
                  </template>
                </v-data-table>
              </v-col>
            </v-row>
          </div>
          <v-skeleton-loader v-else-if="loading" class="mx-auto my-auto" min-height="80px" type="table">
          </v-skeleton-loader>
          <div v-else class="text-center d-flex justify-center align-center flex-column">
            <v-img :width="400" cover :src="emptyChartSrc" class="mb-3"></v-img>
            <h2>暂无结果</h2>
            <p class="text-body-1">请先输入溶质、溶剂集合和温度后运行筛选。</p>
          </div>
        </v-sheet>
      </v-col>
    </v-row>

    <v-dialog v-model="customDialog" persistent max-width="600px">
      <v-card>
        <v-card-title>
          保存溶剂集合
        </v-card-title>

        <v-card-text>
          <v-form>
            <v-text-field data-cy="solscreen-name-solv-set" label="请输入溶剂集合名称" v-model="newSolventSetName"
              :rules="[v => !!v || '必须输入名称']" required></v-text-field>
          </v-form>
          <p>自定义溶剂集合会保存在当前浏览器本地。</p>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn data-cy="solscreen-custom-solv-set-close" color="blue darken-1" text @click="customDialog = false">关闭</v-btn>
          <v-btn data-cy="solscreen-custom-solv-set-save" color="blue darken-1" text @click="() => { this.saveSolventSet(); customDialog = false }"
            :disabled="loading || structurePending || !newSolventSetNameValid">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showUploadModal" max-width="600px">
      <v-card>
        <v-card-title class="mt-2">
          <v-col cols="12">上传文件</v-col>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" class="mb-2">
              <span>
                文件格式请参考“模型输入/输出说明”。
              </span>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12">
              <v-file-input label="文件" v-model="uploadFile" :rules="[v => !!v || '必须上传文件']"
                density="comfortable" variant="outlined" clearable></v-file-input>
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="blue darken-1" text @click="showUploadModal = false">关闭</v-btn>
          <v-btn color="primary" text
            @click="() => { showUploadModal = false; handleUploadSubmit() }">上传</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="dialog" width="auto" class="justify-center align-center">
      <v-card>
        <v-card-title class="headline">
          附加参数
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text class="pa-3">
          <v-expand-transition>
            <v-expansion-panels v-model="panel" multiple>
              <v-expansion-panel title="参考信息（可选）" class="text-primary">
                <v-expansion-panel-text class="text-black">
                  <StructureInput ref="referenceInput" v-model="refSolvent" label="参考溶剂"
                    :disabled="loading" />
                  <v-text-field variant="outlined" label="参考溶解度 (log10(mol/L))"
                    v-model="refSolubility"></v-text-field>
                  <v-text-field variant="outlined" label="参考温度 (K)" v-model="refTemperature"></v-text-field>
                </v-expansion-panel-text>
              </v-expansion-panel>
              <v-expansion-panel title="溶质信息（可选）" class="text-primary">
                <v-expansion-panel-text class="text-black">
                  <v-text-field variant="outlined" label="ΔHsub298 (kcal/mol)" v-model="soluteHsub"></v-text-field>
                  <v-text-field variant="outlined" label="Cpg298 (cal/mol/K)" v-model="soluteCpg"></v-text-field>
                  <v-text-field variant="outlined" label="Cps298 (cal/mol/K)" v-model="soluteCps"></v-text-field>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-expand-transition>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions class="d-flex justify-end pa-3">
          <v-btn class="mr-2" variant="tonal" color="primary" @click="dialog = false">
            保存
          </v-btn>
          <v-btn variant="tonal" color="primary" :disabled="loading || structurePending"
            @click="() => { dialog = false; predict() }">
            运行
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </v-container>
  <solubility-modal :visible="showInfo" width="auto" @close-dialog="$event => showInfo = $event"></solubility-modal>
</template>

<script>
import { onBeforeUnmount, ref } from "vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SmilesImage from "@/components/SmilesImage";
import SolubilityModal from '@/components/solprop/SolubilityModal'
import { API } from "@/common/api";
import { colorMap } from "@/common/color";
import { loadCustomSolventSets, saveCustomSolventSets, solventSets } from "@/views/solprop/solvents";
import { saveAs } from "file-saver";
import * as Papa from "papaparse";
import 'chart.js/auto';
import { Bar, Line } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js'
import emptyChart from '@/assets/emptyChart.svg'
import { useConfirm } from 'vuetify-use-dialog';
import ErrorDialog from '@/components/ErrorDialog'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

export default {
  name: "SolventScreening",
  components: {
    SmilesImage,
    SolubilityModal,
    'bar-chart': Bar,
    'line-chart': Line,
    StructureInput
  },
  data() {
    return {
      dialog: false,
      panel: [0],
      customDialog: false,
      solute: '',
      solvents: '',
      selectedSolventIndex: 0,
      solventSet: '集合 1',
      builtInSolventSets: solventSets,
      customSolventSets: {},
      newSolventSetName: 'mysolventset',
      temperatures: '298\n323',
      refSolvent: '',
      refSolubility: null,
      refTemperature: null,
      soluteHsub: null,
      soluteCpg: null,
      soluteCps: null,
      results: [],
      uploadFile: null,
      selectedMethod: 1,
      methodOptions: [{ value: 1, title: '方法 1' }, { value: 2, title: '方法 2' }],
      selectedX: 'solvent',
      xOptions: [{ value: 'solvent', title: '溶剂' }, { value: 'temperature', title: '温度' }],
      selectedUnits: 'mg/mL',
      unitOptions: ['log10(mol/L)', 'mg/mL'],
      loading: false,
      emptyChartSrc: emptyChart,
      showInfo: false,
      showUploadModal: false,
    }
  },
  setup() {
    const createConfirm = useConfirm();
    const pollingLifetime = new AbortController();
    onBeforeUnmount(() => pollingLifetime.abort());
    return {
      createConfirm,
      pollingSignal: pollingLifetime.signal,
      soluteInput: ref(null),
      selectedSolventInput: ref(null),
      referenceInput: ref(null),
    }
  },
  computed: {
    fields() {
      const _fields = [
        { key: 'image', title: '溶剂结构', tdClass: ['text-center'], width: "10%" },
        { key: 'solvent', title: 'SMILES', sortable: true },
      ]
      Object.keys(this.resultsByTemperature).forEach((temp) => {
        _fields.push({
          key: temp,
          title: `${temp}K 溶解度（方法 ${this.selectedMethod}）[${this.selectedUnits}]`,
          sortable: true
        })
      })
      return _fields
    },
    solventSets() {
      return Object.assign({}, this.builtInSolventSets, this.customSolventSets)
    },
    solventSetOptions() {
      return [
        ...Object.keys(this.solventSets).map((key) => ({ title: key, value: key })),
        { title: '自定义', value: 'custom' },
      ]
    },
    solventList() {
      return this.solvents.split('\n')
    },
    solventEntries() {
      return this.solventList.map((smiles, index) => ({
        title: `${index + 1}. ${smiles}`,
        value: index,
      }))
    },
    selectedSolvent: {
      get() {
        return this.solventList[this.selectedSolventIndex] || ''
      },
      set(value) {
        const entries = this.solventList.slice()
        entries[this.selectedSolventIndex] = value
        this.solvents = entries.join('\n')
      },
    },
    structurePending() {
      return Boolean(this.soluteInput?.pending || this.selectedSolventInput?.pending || this.referenceInput?.pending)
    },
    temperatureList() {
      return this.temperatures.split('\n').map((t) => Number(t))
    },
    resultsBySolvent() {
      let resultsBySolvent = {}
      for (let item of this.results) {
        if (item['Solvent'] in resultsBySolvent) {
          resultsBySolvent[item['Solvent']].push(item)
        } else {
          resultsBySolvent[item['Solvent']] = [item]
        }
      }
      return resultsBySolvent
    },
    resultsByTemperature() {
      let resultsByTemp = {}
      for (let item of this.results) {
        if (item['Temp'] in resultsByTemp) {
          resultsByTemp[item['Temp']].push(item)
        } else {
          resultsByTemp[item['Temp']] = [item]
        }
      }
      return resultsByTemp
    },
    resultKey() {
      let key = ''
      if (this.selectedUnits === 'log10(mol/L)') {
        key = `log_st_${this.selectedMethod}`
      } else if (this.selectedUnits === 'mg/mL') {
        key = `st_${this.selectedMethod}`
      }
      return key
    },
    tableData() {
      // Formats data as records for each solvent
      let allData = []
      Object.entries(this.resultsBySolvent).forEach(([solvent, results]) => {
        let data = { solvent: solvent }
        for (let res of results) {
          data[res['Temp']] = res[this.resultKey]
        }
        allData.push(data)
      })
      return allData
    },
    chartData() {
      // Formats data as datasets for each temperature
      let allData = []
      if (this.selectedX === 'solvent') {
        Object.entries(this.resultsByTemperature).forEach(([temp, results], index) => {
          allData.push({
            label: temp,
            data: results.map((res) => {
              return {
                x: res['Solvent'],
                y: res[this.resultKey],
              }
            }),
            backgroundColor: colorMap[index % colorMap.length] + '80',
          })
        })
      } else if (this.selectedX === 'temperature') {
        Object.entries(this.resultsBySolvent).forEach(([solvent, results], index) => {
          let dashStyles = [[], [10], [10, 5, 5, 5], [5]]
          allData.push({
            label: solvent,
            data: results.map((res) => {
              return {
                x: res['Temp'],
                y: res[this.resultKey],
              }
            }).sort((a, b) => a['x'] - b['x']),
            borderColor: colorMap[index % colorMap.length] + '80',
            borderDash: dashStyles[Math.floor(index / colorMap.length)],
            fill: false,
          })
        })
      }
      return { datasets: allData }
    },
    chartOptions() {
      return {
        maintainAspectRatio: false,
        scales: {
          x: {
            title: {
              display: true,
              text: this.selectedX === 'solvent' ? '溶剂' : '温度 [K]',
            },
            type: this.selectedX === 'solvent' ? 'category' : 'linear',
          },
          y: {
            title: {
              display: true,
              text: `溶解度（方法 ${this.selectedMethod}）[${this.selectedUnits}]`,
            },
          },
        }
      }
    },
    newSolventSetNameInUse() {
      return this.newSolventSetName === 'custom'
        || Object.keys(this.builtInSolventSets).includes(this.newSolventSetName)
        || Object.keys(this.customSolventSets).includes(this.newSolventSetName)
    },
    newSolventSetNameValid() {
      return this.newSolventSetName.length > 0 && !this.newSolventSetNameInUse
    },
    newSolventSetNameHint() {
      if (this.newSolventSetNameInUse) {
        return '名称已被使用'
      } else {
        return '请输入名称'
      }
    }
  },
  created() {
    // Prompt user before going back to previous page
    window.addEventListener('beforeunload', (e) => {
      if (this.results.length) {
        // Cancel the event
        e.preventDefault(); // If you prevent default behavior in Mozilla Firefox prompt will always be shown
        // Chrome requires returnValue to be set
        e.returnValue = '';
      }
    });

    let urlParams = new URLSearchParams(window.location.search);
    let solute = urlParams.get('solute')
    if (solute) {
      this.solute = solute
    }

    // Load custom solvent sets from localStorage
    this.customSolventSets = loadCustomSolventSets()
    this.solvents = this.solventSets[this.solventSet].join('\n')
  },
  methods: {
    async clear(skipConfirm = false) {
      if (!skipConfirm) {
        const isConfirmed = await this.createConfirm({
          title: '请确认',
          content: '这会清空当前所有结果，是否继续？',
          dialogProps: { width: "auto" }
        });
        if (!isConfirmed) {
          return;
        }
      }
      this.results = []
    },
    predict() {
      if (this.loading || this.structurePending || !this.solute.trim()) return
      this.loading = true
      this.results = []
      let promises = []
      for (let temp of this.temperatureList) {
        let tasks = this.solventList.map((solvent) => {
          return {
            solvent: solvent,
            solute: this.solute,
            temp: temp,
            ref_solvent: this.refSolvent || null,
            ref_solubility: this.refSolubility || null,
            ref_temp: this.refTemperature || null,
            hsub298: this.soluteHsub || null,
            cp_gas_298: this.soluteCpg || null,
            cp_solid_298: this.soluteCps || null,
          }
        })
        promises.push(this.predictBatch(tasks))
      }
      return Promise.all(promises)
        .catch(async error => {
          if (this.pollingSignal.aborted) return
          const errorObj = API.toErrorObject(error, '溶剂筛选失败，请检查输入、模型服务和后端任务状态。')
          const isConfirmed = await this.createConfirm({ title: "提示", contentComponent: ErrorDialog, contentComponentProps: { errorObj: errorObj }, dialogProps: { width: "auto" } })
          if (!isConfirmed)
            return
        })
        .finally(() => { if (!this.pollingSignal.aborted) this.loading = false })
    },
    async predictBatch(data) {
      if (this.pollingSignal.aborted) return;
      const url = '/api/solubility/batch/call-async'
      const body = {
        task_list: data,
      }
      const output = await API.runCeleryTask(url, body, undefined, { signal: this.pollingSignal });
      if (this.pollingSignal.aborted) return;
      this.results.push(...output);
    },
    downloadCSV() {
      if (!this.results.length) {
        alert('没有可下载的结果')
        return
      }
      let downloadData = Papa.unparse(this.results)
      let blob = new Blob([downloadData], { type: 'data:text/csv;charset=utf-8' })
      saveAs(blob, 'synon_solubility_export.csv')
    },
    downloadJSON() {
      if (!this.results.length) {
        alert('没有可下载的结果')
        return
      }
      let downloadData = JSON.stringify(this.results)
      let blob = new Blob([downloadData], { type: 'data:text/json;charset=utf-8' })
      saveAs(blob, 'synon_solubility_export.json')
    },
    deleteSolventSet() {
      delete this.customSolventSets[this.solventSet]
      this.solventSet = 'custom'
      saveCustomSolventSets(this.customSolventSets)
    },
    saveSolventSet() {
      if (this.loading || this.structurePending) return
      this.customSolventSets[this.newSolventSetName] = this.solventList
      this.solventSet = this.newSolventSetName
      saveCustomSolventSets(this.customSolventSets)
    },
  },
  watch: {
    solvents(newVal) {
      this.selectedSolventIndex = Math.min(this.selectedSolventIndex, this.solventList.length - 1)
      const selectedSet = this.solventSets[this.solventSet]
      if (selectedSet && newVal !== selectedSet.join('\n')) {
        this.solventSet = 'custom'
      }
    },
    solventSet(newVal) {
      if (newVal in this.solventSets) {
        this.solvents = this.solventSets[newVal].join('\n')
      }
    },
  },
}
</script>

<style scoped>
#solvent-screen-left-pane {
  overflow-y: auto;
  max-height: calc(100vh - 14rem);
}
</style>
