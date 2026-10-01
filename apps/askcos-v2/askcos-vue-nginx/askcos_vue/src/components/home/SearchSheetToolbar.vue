<template>
  <div class="synon-toolbar">
    <div class="brand-lockup">
      <v-avatar rounded="lg" color="teal" variant="tonal" size="38">
        <v-icon icon="mdi-molecule"></v-icon>
      </v-avatar>
      <div>
        <strong>synon</strong>
        <span>基于 ASKCOS 引擎的合成规划</span>
      </div>
    </div>

    <div class="toolbar-actions">
      <v-menu location="bottom end">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            prepend-icon="mdi-star-outline"
            append-icon="mdi-chevron-down"
            color="teal"
            variant="tonal"
            rounded="pill"
            class="text-none"
          >
            常用功能
          </v-btn>
        </template>
        <v-list rounded="lg" min-width="280">
          <template v-for="item in favoritesMenu" :key="item.link">
            <v-list-item v-if="item.selected" :to="item.link" :title="item.title"></v-list-item>
          </template>
          <v-divider></v-divider>
          <v-list-item prepend-icon="mdi-pencil" title="编辑常用功能" @click="showEditFav = true"></v-list-item>
        </v-list>
      </v-menu>

      <v-btn prepend-icon="mdi-history" color="teal" variant="text" to="/results" class="text-none">
        任务历史
      </v-btn>

      <v-chip v-if="username" color="teal" variant="tonal" to="/admin">
        <v-icon start icon="mdi-account-circle"></v-icon>
        <span data-cy="home-username">{{ username }}</span>
      </v-chip>
      <v-btn v-else color="teal" variant="flat" to="/login" class="text-none">
        登录
      </v-btn>
    </div>
  </div>

  <v-dialog v-model="showEditFav" width="auto">
    <v-card min-width="360" rounded="xl">
      <v-card-title>编辑常用功能</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-list density="comfortable">
          <v-list-item
            v-for="item in favoritesMenu"
            :key="item.link"
            @click="item.selected = !item.selected"
          >
            <template #prepend>
              <v-icon :icon="item.selected ? 'mdi-check-circle' : 'mdi-circle-outline'" color="teal"></v-icon>
            </template>
            <v-list-item-title>{{ item.title }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="teal" variant="flat" @click="showEditFav = false; saveFav()">保存</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, onMounted } from "vue";

const showEditFav = ref(false);
const username = ref(localStorage.getItem("username"));
const favLocalStorage = ref(username.value ? localStorage.getItem(`${username.value}_fav`) : null);
const favoritesMenu = ref([
  { title: "逆合成路线树", link: "/network?tab=IPP", selected: true },
  { title: "一步逆合成预测", link: "/network?tab=RP", selected: true },
  { title: "反应条件推荐", link: "/forward?tab=context", selected: true },
  { title: "正向产物预测", link: "/forward?tab=forward", selected: true },
  { title: "杂质预测", link: "/forward?tab=impurity", selected: false },
  { title: "区域选择性预测", link: "/forward?tab=selectivity", selected: false },
  { title: "芳香 C-H 官能团化", link: "/forward?tab=sites", selected: false },
  { title: "溶解度预测", link: "/solprop?tab=solpred", selected: false },
  { title: "溶剂筛选", link: "/solprop?tab=solscreen", selected: false },
  { title: "商业原料检索", link: "/buyables", selected: true },
  { title: "结构绘制", link: "/drawing", selected: false },
  { title: "服务状态", link: "/status", selected: false },
  { title: "日志", link: "/logs", selected: false },
  { title: "我的结果", link: "/results", selected: true },
  { title: "禁用列表", link: "/banlist", selected: false },
]);

onMounted(() => {
  if (favLocalStorage.value) {
    favoritesMenu.value = JSON.parse(favLocalStorage.value);
  }
});

const saveFav = () => {
  if (!username.value) return;
  favLocalStorage.value = JSON.stringify(favoritesMenu.value);
  localStorage.setItem(`${username.value}_fav`, favLocalStorage.value);
};
</script>

<style scoped>
.synon-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 0;
}

.brand-lockup {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
}

.brand-lockup strong,
.brand-lockup span {
  display: block;
}

.brand-lockup strong {
  color: #0f172a;
  font-size: 18px;
  line-height: 1.1;
}

.brand-lockup span {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

@media (max-width: 900px) {
  .synon-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .toolbar-actions {
    justify-content: flex-start;
  }
}
</style>
