<template>
  <module-workbench
    title="禁用列表工作台"
    eyebrow="路线约束"
    icon="mdi-block-helper"
    accent="red"
    description="维护不希望出现在交互式路线规划和路线树搜索中的化学品或反应条目，支持手动新增、批量新增、启用、停用和删除。"
    :modules="banModules"
    :active-module="activeModule"
    :summary-items="summaryItems"
    @select-module="setActiveModule"
  >
    <v-row class="justify-center">
      <v-col cols="12" md="12" xl="10" class="py-0">
        <v-sheet elevation="2" rounded="lg">
          <v-row class="mb-2 px-5 pt-2">
            <v-col cols="12">
              <p class="text-body-3">
                这里列出你标记为有问题的化学品和反应。处于启用状态的条目会在交互式路线规划和路线树搜索中被排除。
                你可以随时删除或停用这些条目。
              </p>
            </v-col>
            <v-col cols="12" class="d-flex justify-center">
              <v-btn variant="tonal" data-cy="banlist-add-single-entry" color="primary" @click="showBanItemDialog = true" class="mr-2">
                新增条目
              </v-btn>
              <v-btn color="orange" data-cy="banlist-add-multiple-entries" variant="tonal" @click="showMultiEntryDialog = true" class="mr-2">
                批量新增
              </v-btn>
              <v-btn variant="tonal" color="red" @click="deleteAll()" data-cy="banlist-reset">重置</v-btn>
            </v-col>
          </v-row>
        </v-sheet>
      </v-col>
    </v-row>

    <v-row class="justify-center">
      <v-col cols="12" md="12" xl="10">
        <v-sheet width="100%" class="pa-6" rounded="lg" elevation="2" data-cy="banlist-table">
          <v-select v-if="tabItems.length || filterActive !== 'all'" v-model="filterActive" :items="filterOptions"
            item-text="title" item-value="key" label="按状态筛选" density="comfortable" variant="outlined"
            hide-details clearable></v-select>
          <v-row v-if="tabItems.length || pendingTasks > 0">
            <v-col cols="12">
              <v-data-table :headers="headers" :items="tabItems" :items-per-page="10" :loading="pendingTasks > 0">
                <template v-slot:item.active="{ item }">
                  <v-btn @click="toggleActivation(item, activeTab === 0 ? 'chemicals' : 'reactions')" small>
                    <v-icon v-if="item.active">mdi-check-circle</v-icon>
                    <v-icon v-else>mdi-cancel</v-icon>
                    {{ item.active ? '已启用' : '已停用' }}
                  </v-btn>
                </template>
                <template #item.smiles="{ item }">
                  <copy-tooltip :data="item.smiles">
                    <smiles-image :smiles="item.smiles"></smiles-image>
                  </copy-tooltip>
                </template>
                <template v-slot:item.delete="{ item }">
                  <v-icon
                    @click="activeTab === 0 ? deleteEntry(item.id, 'chemicals') : deleteEntry(item.id, 'reactions')"
                    class="text-center" data-cy="banlist-single-delete" >mdi-delete</v-icon>
                </template>
              </v-data-table>
            </v-col>
          </v-row>
          <v-row v-else class="pa-5">
            <v-col cols="12" class="d-flex justify-center align-center">
              <div v-if="filterActive == 'all'" class="d-flex text-center justify-center align-center flex-column">
                <v-img :width="300" cover :src="banlist"></v-img>
                <h6 class="mt-2 text-h6">暂无禁用条目</h6>
                <p class="text-body-1">可从路线规划/路线树查看器添加，也可以在上方手动新增。</p>
              </div>
              <div v-else class="d-flex text-center justify-center align-center flex-column">
                <v-img :width="300" cover :src="banlist"></v-img>
                <h6 class="mt-2 text-h6">暂无禁用条目</h6>
                <p class="text-body-1">请尝试切换筛选条件。</p>
              </div>
            </v-col>
          </v-row>
        </v-sheet>
      </v-col>
    </v-row>

    <ban-item-dialog v-model:showBanItemDialog="showBanItemDialog" v-model:pendingTasks="pendingTasks"
      v-model:activeTab="activeTab" @loadCollection="loadCollection" />

    <multi-entry-dialog v-model:showMultiEntryDialog="showMultiEntryDialog" v-model:pendingTasks="pendingTasks"
      @loadCollection="loadCollection" />
  </module-workbench>
</template>

<script setup>
import banlist from "@/assets/banlist.svg";
import { ref, computed, onMounted } from 'vue';
import SmilesImage from "@/components/SmilesImage";
import CopyTooltip from "@/components/CopyTooltip";
import { API } from "@/common/api";
import dayjs from 'dayjs';
import BanItemDialog from "@/components/banlist/BanItemDialog"
import MultiEntryDialog from "@/components/banlist/MultiEntryDialog"
import ModuleWorkbench from "@/components/ModuleWorkbench.vue"

const activeTab = ref(0);
const chemicals = ref([]);
const reactions = ref([]);
const showBanItemDialog = ref(false);
const showMultiEntryDialog = ref(false);
const banModules = [
  { value: "chemicals", title: "化学品", subtitle: "排除指定分子结构", icon: "mdi-flask-remove-outline" },
  { value: "reactions", title: "反应", subtitle: "排除指定反应模式", icon: "mdi-vector-polyline-minus" },
];
const summaryItems = [
  { label: "作用范围", value: "IPP 与路线树搜索", icon: "mdi-source-branch" },
  { label: "状态", value: "启用条目才会参与排除", icon: "mdi-toggle-switch-outline" },
  { label: "维护", value: "支持单条和批量新增", icon: "mdi-database-plus-outline" },
];

const filterActive = ref('all');
const pendingTasks = ref(0);
const filterOptions = ref([
  { key: 'all', title: '全部' },
  { key: 'active', title: '已启用' },
  { key: 'inactive', title: '已停用' },
]);

const activeModule = computed(() => activeTab.value === 0 ? 'chemicals' : 'reactions');

const setActiveModule = (module) => {
  activeTab.value = module === 'reactions' ? 1 : 0;
};

const headers = computed(() => {
  const baseHeaders = [
    { key: 'active', title: '状态' },
    { key: 'created', title: '创建时间' },
    { key: 'smiles', title: '化学品' },
    { key: 'description', title: '描述' },
    { key: 'delete', title: '删除' },
  ];

  if (activeTab.value === 1) {
    baseHeaders[2].title = '反应';
  }

  return baseHeaders;
});

const loadCollection = (category) => {
  pendingTasks.value++;
  API.get(`/api/banlist/${category}/get`, null, false)
    .then(json => {
      json.forEach(function (doc) {
        doc.created = dayjs(doc.created).format('MMMM D, YYYY h:mm A');
      });
      if (category === 'chemicals') {
        chemicals.value = json
      } else {
        reactions.value = json
      }
    })
    .finally(() => {
      pendingTasks.value--;
    })
}

onMounted(() => {
  loadCollection('chemicals');
  loadCollection('reactions');
});


const tabItems = computed(() => {
  let items = activeTab.value === 0 ? chemicals.value : reactions.value;
  switch (filterActive.value) {
    case 'active':
      return items.filter(item => item.active === true);
    case 'inactive':
      return items.filter(item => item.active === false);
    default:
      return items;
  }
});

const deleteEntry = (id, category) => {
  pendingTasks.value++;
  API.delete(`/api/banlist/${category}/delete?_id=${id}`)
    .then(() => {
      loadCollection(category);
    })
    .finally(() => {
      pendingTasks.value--;
    });
}

const deleteAll = () => {
  pendingTasks.value++;
  const chemicalsToDelete = chemicals.value;
  chemicalsToDelete.forEach(item => {
    API.delete(`/api/banlist/chemicals/delete?_id=${item.id}`)
  })
  loadCollection("chemicals")

  const reactionsToDelete = reactions.value;
  reactionsToDelete.forEach(item => {
    API.delete(`/api/banlist/reactions/delete?_id=${item.id}`)
  })
  loadCollection("reactions")
  pendingTasks.value--;
}

const toggleActivation = async (item, category) => {
  pendingTasks.value++;
  const action = item.active ? 'deactivate' : 'activate';
  await API.get(`/api/banlist/${category}/${action}`, {
    _id: item.id
  }).then(() => {
    loadCollection(category);
  }).catch((error) => {
    console.error("Error toggling activation:", error);
  }).finally(() => {
    pendingTasks.value--;
  });
};
</script>
