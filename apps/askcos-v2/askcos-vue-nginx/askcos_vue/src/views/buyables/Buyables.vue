<template>
  <v-progress-linear :active="fetchLoad" :indeterminate="fetchLoad" color="primary" absolute
    bottom></v-progress-linear>
  <module-workbench
    title="商业原料检索工作台"
    eyebrow="结构与采购"
    icon="mdi-database-search-outline"
    accent="primary"
    description="在商业原料库中按 SMILES、SMARTS、来源和相似度检索可采购结构，并支持管理员维护本地原料数据。"
    :summary-items="summaryItems"
  >
    <v-row class="justify-center">
      <v-col cols="12" md="12" xl="10">
        <v-sheet elevation="2" rounded="lg" class="pa-5">
          <v-row class="justify-center" density="compact">
            <v-col cols="12" md="12">
              <v-text-field v-model="searchSmilesQuery" data-cy="buyables-smiles-input" placeholder="SMILES/SMARTS"
                prepend-inner-icon="mdi mdi-flask" density="compact" variant="outlined"
                label="检索结构" hide-details clearable rounded="pill">
                <template v-slot:append-inner>
                  <draw-button v-model:smiles="searchSmilesQuery" size="small" />
                </template>
              </v-text-field>
              <div class="buyables-actions">
                <v-checkbox-btn v-model="searchRegex" label="SMARTS 模式" hide-details class="buyables-smart-toggle" />
                <v-menu location="bottom" :close-on-content-click="false">
                  <template v-slot:activator="{ props }">
                    <v-btn color="primary" variant="flat" v-bind="props" :disabled="fetchLoad" :loading="fetchLoad"
                      rounded="pill" data-cy="buyables-select-sources">
                      选择来源
                    </v-btn>
                  </template>
                  <v-list>
                    <v-list-item v-for="source in buyablesSources" :key="source" @click="selectSource(source)">
                      <v-row align="center">
                        <v-col cols="auto">
                          <v-list-item-title>
                            {{ source }}
                            <v-icon class="ml-1 mb-2" v-show="selectedSources.includes(source)" icon="mdi-check">
                            </v-icon>
                          </v-list-item-title>
                        </v-col>
                      </v-row>
                    </v-list-item>
                  </v-list>
                </v-menu>
                <v-btn color="primary" @click="search" variant="flat" :loading="showLoader"
                  rounded="pill" data-cy="buyables-search-button">
                  检索
                </v-btn>
                <v-btn data-cy="buyables-clear-results-button" variant="tonal" @click="clear()"
                  :disabled="!buyables.length" rounded="pill">
                  清空结果
                </v-btn>
                <v-menu location="bottom" id="tb-submit-settings" :close-on-content-click="false">
                  <template v-slot:activator="{ props }">
                    <v-btn v-show="isAdmin" color="orange-accent-4" v-bind="props" icon="mdi-plus" variant="flat"
                      size="small" data-cy="add-buyables-button">
                    </v-btn>
                  </template>
                  <v-list>
                    <v-list-item data-cy="buyables-add-one" @click="showAddModal = !showAddModal">新增单个原料</v-list-item>
                    <v-list-item data-cy="buyables-add-json" @click="showUploadModal = !showUploadModal">批量导入原料</v-list-item>
                  </v-list>
                </v-menu>
              </div>
              <div v-if="!!searchSmilesQuery" class="my-3">
                <smiles-image :smiles="searchSmilesQuery" height="100px"></smiles-image>
              </div>
            </v-col>
          </v-row>
          <v-row class="mb-2 px-5 pt-5">
            <v-col cols="12" md="4">
              <v-slider :rules="[rulesSim.min, rulesSim.max]" v-model="simThresh" label="相似度阈值" min="0"
                max="1" step="0.0001" color="primary">
                <template v-slot:append>
                  <v-text-field hide-details data-cy="similarity-input-element" v-model="simThresh" type="number"
                    style="width: 80px" density="compact" variant="outlined" min="0" max="1"></v-text-field>
                </template>
              </v-slider>
            </v-col>
            <v-col cols="12" md="4">
              <v-slider :rules="[rulesRetLim.min, rulesRetLim.max]" v-model="searchLimit" label="结果上限" min="1"
                max="100" step="1" color="primary">
                <template v-slot:append>
                  <v-text-field v-model="searchLimit" data-cy="result-input-element" type="number" style="width: 80px"
                    density="compact" hide-details variant="outlined" min="1" max="100"></v-text-field>
                </template>
              </v-slider>
            </v-col>
            <v-col cols="12" md="4" class="d-flex justify-space-evenly align-center">
            </v-col>
          </v-row>
        </v-sheet>
      </v-col>
    </v-row>

    <v-row v-if="requestError" class="justify-center">
      <v-col cols="12" md="12" xl="10">
        <v-alert
          type="error"
          variant="tonal"
          closable
          data-cy="buyables-request-error"
          @click:close="requestError = ''"
        >
          {{ requestError }}
        </v-alert>
      </v-col>
    </v-row>

    <v-row class="justify-center">
      <v-col cols="12" md="12" xl="10">
        <v-sheet elevation="2" class="d-flex justify-center align-center pa-5" rounded="lg" data-cy="buyables-table">
          <v-data-table v-if="buyables.length" :headers="headers" :items="buyables" :loading="showLoader">
            <template v-slot:item.smiles="{ item }">
              <copy-tooltip :data="item.smiles">
                <smiles-image :smiles="item.smiles" height="80px"></smiles-image>
              </copy-tooltip>
            </template>
            <template v-slot:item.availability="{ item }">
              {{ (item.properties && item.properties[1] && (item.properties[1].value !== "" ||
              item.properties[1].availability)) ? (item.properties[1].value || item.properties[1].availability) :
              "未知" }}
            </template>
            <template v-slot:item.lead_time="{ item }">
              {{ item.lead_time ? item.lead_time : "未知" }}
            </template>
            <template v-slot:item.similarity="{ item }">
              {{ item.similarity ? item.similarity : "1" }}
            </template>
            <template v-slot:item.link="{ item }">
              <v-btn :href="(item.properties && item.properties[0]) ? item.properties[0].value : ''" target="_blank"
                append-icon="mdi-open-in-new"
                :disabled="!item.properties || !item.properties[0] || !item.properties[0].value">查看采购链接
              </v-btn>
            </template>
            <template v-slot:item.delete="{ item }">
              <v-icon @click="deleteBuyable(item._id)" data-cy="buyable-delete-item"
                class="text-center">mdi-delete</v-icon>
            </template>
          </v-data-table>
          <div v-else class="text-center">
            <v-img :width="400" cover :src="emptyCart" class="mb-3"></v-img>
            <h2>暂无结果</h2>
            <p class="text-body-1">输入 SMILES/SMARTS 后检索商业原料库。</p>
          </div>
        </v-sheet>
      </v-col>
    </v-row>
  </module-workbench>

  <v-dialog v-model="showAddModal" max-width="600px">
    <v-card>
      <v-card-title class="mt-2">
        <v-col cols="12">新增商业原料</v-col>
      </v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <v-text-field data-cy="buyable-smiles-input" :rules="[v => !!v || '必须填写 SMILES']" label="SMILES"
              v-model="addBuyableSmiles" density="comfortable" variant="outlined" clearable></v-text-field>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12">
            <v-text-field data-cy="buyable-ppg-input" id="pricePerGram" :rules="[v => !!v || '必须填写价格']"
              label="每克价格" v-model="addBuyablePrice" density="comfortable" variant="outlined"
              clearable></v-text-field>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12">
            <v-text-field data-cy="buyable-source-input" id="source" label="来源" v-model="addBuyableSource"
              :rules="[v => !!v || '必须填写来源']" density="comfortable" variant="outlined"
              clearable></v-text-field>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12">
            <v-text-field data-cy="buyable-leadtime-input" id="leadtime" label="交付周期" v-model="addBuyableLeadTime"
              density="comfortable" variant="outlined" clearable></v-text-field>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12">
            <v-textarea data-cy="buyable-properties-input" label="属性" v-model="addBuyableProps"
              variant="outlined"></v-textarea>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12">
            <v-checkbox label="允许覆盖已有记录" v-model="allowOverwrite"></v-checkbox>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn data-cy="add-buyable-close-button" color="blue darken-1" text @click="showAddModal = false">关闭</v-btn>
        <v-btn data-cy="add-buyable-entry-button" color="primary" text @click="addBuyable">新增记录</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="showUploadModal" max-width="600px" scrollable>
    <v-card>
      <v-card-title>
        上传商业原料文件
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <p class="text-body-1 mb-4">
              上传文件需为 JSON 格式。可选的 properties 字段用于补充供应商、目录号、价格、库存等元数据。
            </p>
            <v-expansion-panels multiple flat>
              <v-expansion-panel title="JSON 示例格式" class="text-primary">
                <template v-slot:text>
                  <pre style="white-space: pre-wrap">
                    {{ exJSON }}
                  </pre>
                </template>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12">
            <v-file-input data-cy="buyables-json-upload" label="文件" v-model="uploadFile"
              :rules="[v => !!v || '必须选择文件']" density="comfortable" variant="outlined"
              clearable></v-file-input>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12">
            <v-checkbox data-cy="buyable-overwrite-checkbox" label="允许覆盖已有结果"
              v-model="allowOverwrite" hide-details></v-checkbox>
          </v-col>
        </v-row>
      </v-card-text>
      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="error" variant="tonal" @click="showUploadModal = false">关闭</v-btn>
        <v-btn data-cy="buyable-upload-submit" color="primary" variant="tonal"
          @click="handleUploadSubmit">上传</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { API } from "@/common/api";
import { getBuyables } from "@/common/buyables";
import { ref, computed, onMounted, watch } from 'vue';
import SmilesImage from "@/components/SmilesImage.vue";
import CopyTooltip from "@/components/CopyTooltip";
import emptyCart from "@/assets/emptyCart.svg";
import { useConfirm, useSnackbar } from 'vuetify-use-dialog';
import DrawButton from "@/components/DrawButton"
import ModuleWorkbench from "@/components/ModuleWorkbench.vue"

const buyables = ref([]);
const uploadFile = ref(null);
const searchSmilesQuery = ref('');
const searchSourceQuery = ref([]);
const searchRegex = ref(false);
const searchLimit = ref(100);
const simThresh = ref(1.0);
const allowOverwrite = ref(true);
const showAddModal = ref(false);
const showUploadModal = ref(false);
const addBuyableSmiles = ref('');
const addBuyablePrice = ref(1);
const addBuyableSource = ref('');
const addBuyableLeadTime = ref('');
const addBuyableProps = ref('[{"name": "link","value": ""},{"name": "availability","value": ""}]');
const uploadFileFormat = ref('JSON');
const pendingTasks = ref(0);
const buyablesSources = ref([]);
const selectedSources = ref([]);
const isAdmin = ref(false);
const createConfirm = useConfirm();
const createSnackbar = useSnackbar()
const fetchLoad = ref(false)
const requestError = ref('')
const summaryItems = [
  { label: "检索", value: "SMILES / SMARTS 与相似度", icon: "mdi-magnify-scan" },
  { label: "来源", value: "本地 buyables 数据源筛选", icon: "mdi-database-outline" },
  { label: "维护", value: "管理员可新增或批量导入", icon: "mdi-database-plus-outline" },
]
const exJSON = [
  {
    "smiles": "CCC",
    "ppg": 1,
    "source": "test source 1",
    "lead_time": "1day",
    "properties": {
      "link": "https://test.com/query=CCC",
      "availability": "In-stock"
    }
  },
  {
    "smiles": "CCC",
    "ppg": 1.5,
    "source": "test source 2",
    "lead_time": "1day",
    "properties": {
      "link": "https://test1.com/query=CCC",
      "availability": "In-stock"
    }
  },
]

const rulesSim = {
  min: v => v >= 0 || `最小值为 0`,
  max: v => v <= 1 || `最大值为 1`
}

const rulesRetLim = {
  min: v => v >= 1 || `最小值为 1`,
  max: v => v <= 100 || `最大值为 100`
}

const headers = computed(() => {
  let headers = [
    { key: 'smiles', title: 'SMILES', align: 'center', width: '500px' },
    { key: "availability", title: '库存状态', align: 'center' },
    { key: 'ppg', title: '价格 ($/g)', align: 'center' },
    { key: 'lead_time', title: '交付周期', align: 'center' },
    { key: 'source', title: '来源', align: 'center' },
    { key: 'similarity', title: '相似度', align: 'center' },
    { key: 'link', title: '采购链接', align: 'center' }
  ]
  if (buyables.value.length > 0 && isAdmin.value) {
    headers.push({
      key: 'delete', title: '', align: 'center'
    })
  }
  return headers
});

const clear = async (skipConfirm = false) => {
  if (!skipConfirm) {
    const isConfirmed = await createConfirm({
      title: '请确认',
      content: '这会清空当前检索结果，是否继续？',
      dialogProps: { width: "auto" }
    });
    if (!isConfirmed) return;
  }

  searchSmilesQuery.value = "";
  searchSourceQuery.value = [];
  selectedSources.value = []
  buyables.value = [];
  searchLimit.value = 100;
  simThresh.value = 1
};

const showLoader = computed(() => {
  return pendingTasks.value > 0
});

const fetchAdminStatus = async () => {
  if (!localStorage.getItem('accessToken')) {
    isAdmin.value = false;
    return;
  }
  try {
    const res = await API.get("/api/user/am-i-superuser", null, false);
    isAdmin.value = res;
  } catch (error) {
    isAdmin.value = false;
  }
};
const fetchSources = async () => {
  fetchLoad.value = true;
  requestError.value = '';
  try {
    const json = await API.get('/api/buyables/sources', null, false);
    buyablesSources.value = json.sources || [];
  } catch (error) {
    buyablesSources.value = [];
    requestError.value = '商业原料来源加载失败，请检查 buyables 服务是否可用。';
  } finally {
    fetchLoad.value = false;
  }
}

onMounted(async () => {
  await fetchAdminStatus()
  await fetchSources()
  selectedSources.value = [...buyablesSources.value]
  let urlParams = new URLSearchParams(window.location.search);
  let query = urlParams.get('q');
  if (query) {
    searchSmilesQuery.value = query;
    search();
  }
});

const search = () => {
  pendingTasks.value++;
  requestError.value = '';
  getBuyables(
    searchSmilesQuery.value,
    searchSourceQuery.value,
    searchRegex.value,
    searchLimit.value,
    simThresh.value,
  )
    .then(json => {
      buyables.value = json['result'];
    })
    .catch(() => {
      buyables.value = [];
      requestError.value = '商业原料检索失败，请检查输入结构、数据源和后端服务状态。';
    })
    .finally(() => {
      pendingTasks.value--
    })
};


const handleUploadSubmit = () => {
  if (!uploadFile.value) {
    createConfirm({ title: '提示', content: '请先选择要上传的文件。', dialogProps: { width: "auto" } });
    return;
  }
  pendingTasks.value++;
  requestError.value = '';

  let formData = new FormData();
  formData.append('file', uploadFile.value);
  formData.append('format', uploadFileFormat.value === "JSON" ? 'json' : "csv");
  formData.append('allowOverwrite', allowOverwrite.value);
  formData.append('returnLimit', 200);

  API.post('/api/buyables/upload', formData)
    .then(json => {
      if (json.error) {
        alert(json.error)
        return
      }
      createSnackbar({ text: '共 ' + json.total_count + ' 条记录，新增 ' + json.inserted_count + ' 条，更新 ' + json.updated_count + ' 条，跳过重复 ' + json.duplicate_count + ' 条。下方最多显示 ' + 2 * searchLimit.value + ' 条结果。', snackbarProps: { timeout: -1, vertical: true } })
      if (json.inserted.length > 0) {
        buyables.value.unshift(...json.inserted)
      }
      if (json.updated.length > 0) {
        for (const updated of json.updated) {
          let inList = false
          for (const buyable of buyables.value) {
            if (buyable._id === updated._id) {
              inList = true
              buyable.ppg = updated.ppg
              buyable.source = updated.source
              break
            }
          }
          if (!inList) {
            buyables.value.unshift(updated)
          }
        }
      }
    })
    .catch((err) => {
      requestError.value = `商业原料文件上传失败：${err?.message || err || '未知错误'}`;
    })
    .finally(() => {
      showUploadModal.value = false;
      uploadFile.value = null;
      pendingTasks.value--;
      fetchSources()
    });
};


const addBuyable = () => {
  pendingTasks.value++;
  requestError.value = '';
  let body = {
    smiles: addBuyableSmiles.value,
    ppg: addBuyablePrice.value,
    source: addBuyableSource.value,
    lead_time: addBuyableLeadTime.value,
    properties: JSON.parse(addBuyableProps.value),
    allowOverwrite: allowOverwrite.value,
  };
  API.post('/api/buyables/create', body)
    .then(json => {
      if (json.error || !json.success) {
        createSnackbar({ text: "新增商业原料失败。", snackbarProps: { timeout: -1, vertical: true } })
      } else {
        if (json.inserted) {
          buyables.value.unshift(json.result)
        }
        if (json.updated) {
          for (const buyable of buyables.value) {
            if (buyable._id === json.result._id) {
              buyable.ppg = json.result.ppg
              buyable.source = json.result.source
            }
          }
        }
        if (json.duplicate == true) {
          createSnackbar({ text: "数据库中已存在该化合物。如需覆盖，请勾选允许覆盖。", snackbarProps: { timeout: -1, vertical: true } })
        }
        if (json.success) {
          createSnackbar({ text: "已完成。", snackbarProps: { timeout: -1, vertical: true } })
          showAddModal.value = !showAddModal.value;
        }
      }
    })
    .finally(() => {
      pendingTasks.value--;
      fetchSources()
    });
};


const deleteBuyable = (_id) => {
  const confirmDelete = async () => {
    const isConfirmed = await createConfirm({
      title: '请确认',
      content: '确认删除这条商业原料记录？',
      dialogProps: { width: "auto" }
    });

    if (!isConfirmed) return;

    // User confirmed, now call the API
    pendingTasks.value++;

    const params = new URLSearchParams();
    params.append('pk', encodeURIComponent(_id));

    return API.delete(`/api/buyables/destroy?${params.toString()}`)
  }

  confirmDelete()
    .then(json => {
      if (!json) return;
      if (json['success'] === true) {
        const indexToDelete = buyables.value.findIndex(b => b._id === _id);
        if (indexToDelete !== -1) {
          buyables.value.splice(indexToDelete, 1);
          createSnackbar({ text: "已完成。", snackbarProps: { timeout: -1, vertical: true } })
        }
      }
      if (json.error !== null) {
        requestError.value = json.error || '删除商业原料记录失败。';
      }
    })
    .finally(() => {
      pendingTasks.value--;
      fetchSources()
    });
};

const selectSource = (source) => {
  const index = selectedSources.value.indexOf(source);
  if (index === -1) {
    selectedSources.value.push(source);
  } else {
    selectedSources.value.splice(index, 1);
  }
  searchSourceQuery.value = [...selectedSources.value];
};

watch(uploadFile, (file) => {
  if (file) {
    if (file.name.endsWith('.json')) {
      uploadFileFormat.value = 'JSON'
    } else if (file.name.endsWith('.csv')) {
      uploadFileFormat.value = 'CSV'
    }
  }
});


</script>

<style scoped>
.left-justify {
  text-align: justify;
  text-justify: inter-word;
}

.buyables-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.buyables-actions .v-selection-control {
  flex: 0 1 152px;
  min-height: 36px;
  min-width: 152px;
}

.buyables-actions :deep(.v-label) {
  white-space: nowrap;
}

@media (max-width: 600px) {
  .buyables-actions {
    align-items: stretch;
  }

  .buyables-actions .v-btn {
    flex: 1 1 128px;
  }
}
</style>
