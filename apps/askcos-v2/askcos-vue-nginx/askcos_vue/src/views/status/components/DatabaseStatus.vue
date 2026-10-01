<template>
  <v-sheet elevation="2" rounded="lg" width="100%" class="pa-6">
    <v-card-title>
      <v-row align="center" justify="center">
        <v-col cols="auto">
          <h3 class="text-h5">数据库状态</h3>
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
    <div v-if="!loading" class="status-table-wrap">
      <v-data-table v-model:expanded="expanded" :headers="headers" :items="data" show-expand item-value="name"
        :items-per-page="100">
        <template v-slot:item.url="{ item }">
          <router-link v-if="item.url" :to="item.url">
            <v-btn color="primary">
              检索集合
            </v-btn>
          </router-link>
        </template>
        <template v-slot:expanded-row="{ columns, item }">
          <td :colspan="columns.length">
            <v-table density="compact" class="text-left">
              <thead>
                <tr>
                  <th class="text-left">{{ item.field }}</th>
                  <th class="text-left">记录数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(value, key) in item.details" :key="key">
                  <td>{{ key }}</td>
                  <td>{{ value }}</td>
                </tr>
              </tbody>
            </v-table>
          </td>
        </template>
        <template #bottom></template>
      </v-data-table>
    </div>

    <div v-if="loading">
      <v-skeleton-loader class="mx-auto" min-height="60px" type="table">
      </v-skeleton-loader>
    </div>

  </v-sheet>
</template>


<script setup>
import { API } from "@/common/api";
import { ref, onMounted } from "vue";
import { useConfirm } from 'vuetify-use-dialog';

const createConfirm = useConfirm()
const data = ref([]);
const headers = [
  { key: 'name', title: '集合名称' },
  { key: 'description', title: '描述' },
  { key: 'total', title: '记录总数' },
  { key: 'url', title: '' },
  { key: 'show_details', title: '' }];
const loading = ref(false);
const expanded = ref([])
const date = ref(new Date())

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
    const json = await API.get('/api/status/database/get', null, false);
    data.value = json['collections'];
    date.value = new Date();
  } catch (error) {
    createConfirm({ title: "操作失败", content: "数据库状态获取失败：" + error, dialogProps: { width: "auto" } })
  } finally {
    loading.value = false;
  }
};

onMounted(() => getStatus())

</script>

<style scoped>
.status-table-wrap {
  max-width: 100%;
  overflow-x: auto;
}

.status-table-wrap :deep(table) {
  min-width: 560px;
}
</style>
