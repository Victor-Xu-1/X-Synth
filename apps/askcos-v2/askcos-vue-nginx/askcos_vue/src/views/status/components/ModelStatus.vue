<template>
  <v-sheet elevation="2" rounded="lg" width="100%" class="pa-6">
    <v-card-title>
      <v-row align="center" justify="space-between">
        <v-col>
          <h3 class="text-h5">模型服务状态</h3>
        </v-col>
        <v-spacer></v-spacer>
        <v-col cols="auto">
          <span class="text-body-2 mr-3">最近更新：{{ elapsedText(date) }}</span>
          <v-btn icon @click="getStatus" :disabled="loading">
            <v-icon>mdi-refresh</v-icon>
          </v-btn>
        </v-col>
      </v-row>
    </v-card-title>
    <div v-if="!loading">
      <v-data-table :headers="headers" :items="data" :items-per-page="100">
        <template v-slot:item.ready="{ item }">
          <v-icon :color="item.ready ? 'primary' : 'error'"
            :icon="item.ready ? 'mdi-check-circle' : 'mdi-alert-circle'" />
        </template>
        <template v-slot:item.available_model_names="{ item }">
          <div v-if="item.available_model_names && item.available_model_names.length > 0">
            <div v-for="modelName in item.available_model_names" :key="modelName" class="my-2">
              {{ modelName.trim() }}
            </div>
          </div>
        </template>
        <template #bottom></template>
      </v-data-table>
    </div>
    <div v-if="loading">
      <v-skeleton-loader class="mx-auto" min-height="150px" type="table">
      </v-skeleton-loader>
    </div>
  </v-sheet>
</template>

<script setup>
import { API } from "@/common/api";
import { onMounted, ref } from "vue"
import { useConfirm } from 'vuetify-use-dialog';

const createConfirm = useConfirm()
const data = ref([]);
const date = ref(new Date());

const headers = [
  { key: 'name', title: '模型名称' },
  { key: 'description', title: '模型描述' },
  { key: 'available_model_names', title: '可用模型名' },
  { key: 'ready', title: '在线' },
];

const loading = ref(false);

const elapsedText = (value) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

const getStatus = async () => {
  loading.value = true;

  try {
    const json = await API.get('/api/admin/get-backend-status', null, false);
    data.value = json['modules'];
    date.value = new Date();
  } catch (error) {
    createConfirm({ title: "操作失败", content: "模型状态获取失败：" + error, dialogProps: { width: "auto" } })
  } finally {
    loading.value = false;
  }
};

onMounted(() => getStatus())
</script>
