<template>
  <v-row class="ma-0 search-bar-row">
    <v-col cols="12" class="pa-0 search-bar-column" data-cy="home-smiles-input-field">
      <v-autocomplete v-model="smilesInput" :search="searchText" variant="outlined"
        label="SMILES 输入" prepend-inner-icon="mdi mdi-flask" placeholder="输入 SMILES 后点击结构转换" hide-details
        clearable rounded="pill" data-cy="home-searchbar" @update:search="onSearchUpdate"
        @focus="showRecentSearches = true" @input="showRecentSearches = false"
        :items="showRecentSearches ? recentSearches : []" menu-icon="" hide-no-data filled item-props>
        <template v-slot:append-inner>
          <v-btn v-if="allowResolve" variant="flat" prepend-icon="mdi mdi-magnify" @click="() => {
            resolveSmiles();
          }
          " rounded="pill" color="primary" data-cy="home-resolve-btn" class="text-none">解析</v-btn>
        </template>
        <template v-slot:append>
          <v-btn variant="flat" color="primary" prepend-icon="mdi mdi-swap-horizontal-bold" size="large"
            :disabled="!smilesInput" @click="convertStructure()" data-cy="home-structure-convert" rounded="pill"
            class="text-none">结构转换</v-btn>
        </template>
      </v-autocomplete>
    </v-col>
  </v-row>
</template>
<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { API } from "@/common/api";
import { useDebounceFn } from "@vueuse/core";
import { resolveChemName } from "@/common/resolver";
import { useConfirm } from "vuetify-use-dialog";
import { useSettingsStore } from "@/store/settings";

const MAX_SEARCH_HISTORY = 5;

const settingsStore = useSettingsStore();

const smilesInput = defineModel("smilesInput", {
  required: true,
  default: null,
});
const emit = defineEmits(["structure-convert"]);

const showRecentSearches = ref(false);
const recentSearches = ref([]);
const searchText = ref("");

const allowResolve = computed({
  get() {
    return settingsStore.allowResolve;
  },
  set(value) {
    settingsStore.allowResolve = value;
  },
});

const createConfirm = useConfirm();

const loadUserSearchHistory = () => {
  const username = localStorage.getItem("username");
  if (!username) return;

  const allSearchHistories =
    JSON.parse(localStorage.getItem("searchHistories")) || {};
  recentSearches.value = (allSearchHistories[username] || []).map((item) => ({
    title: item,
    prependIcon: "mdi-clock-outline",
  }));
};

const resolveSmiles = async () => {
  try {
    smilesInput.value = await resolveChemName(smilesInput.value);
    searchText.value = smilesInput.value;
    showRecentSearches.value = false;
  } catch (error) {
    createConfirm({
      title: "操作失败",
      content: error.message,
      dialogProps: { width: "auto" },
    });
  }
};

const convertStructure = async () => {
  if (!smilesInput.value) return;
  try {
    const json = await API.post("/api/rdkit/canonicalize/", {
      smiles: smilesInput.value,
    });
    const nextSmiles = json.smiles || smilesInput.value;
    smilesInput.value = nextSmiles;
    searchText.value = nextSmiles;
    showRecentSearches.value = false;
    emit("structure-convert", nextSmiles);
  } catch (error) {
    createConfirm({
      title: "操作失败",
      content: "SMILES 结构转换失败：" + error.message,
      dialogProps: { width: "auto" },
    });
  }
};

const updateRecentSearches = useDebounceFn((searchValue) => {
  if (!searchValue) return;

  smilesInput.value = searchValue;

  const username = localStorage.getItem("username");
  if (!username) return;

  const allSearchHistories =
    JSON.parse(localStorage.getItem("searchHistories")) || {};
  const userSearches = [
    ...new Set([searchValue, ...(allSearchHistories[username] || [])]),
  ].slice(0, MAX_SEARCH_HISTORY); // Keep only last 5 searches
  allSearchHistories[username] = userSearches;

  localStorage.setItem("searchHistories", JSON.stringify(allSearchHistories));

  recentSearches.value = userSearches.map((item) => ({
    title: item,
    prependIcon: "mdi-history",
  }));
}, 1000);

const onSearchUpdate = (value) => {
  searchText.value = value;
  updateRecentSearches(value);
};

onMounted(() => {
  loadUserSearchHistory();
});

watch(smilesInput, (val) => {
  searchText.value = val || "";
});
</script>

<style scoped>
.search-bar-row,
.search-bar-column {
  width: 100%;
  min-width: 0;
}

.search-bar-row :deep(.v-input) {
  width: 100%;
}

.search-bar-row :deep(.v-input__control) {
  min-width: 0;
}

.search-bar-row :deep(.v-input__append .v-btn) {
  min-width: 132px;
}

@media (max-width: 640px) {
  .search-bar-row :deep(.v-input) {
    display: grid;
    gap: 8px;
  }

  .search-bar-row :deep(.v-input__control) {
    min-width: 0;
  }

  .search-bar-row :deep(.v-input__append) {
    width: 100%;
    margin-inline-start: 0;
  }

  .search-bar-row :deep(.v-input__append .v-btn) {
    width: 100%;
    min-height: 42px;
  }

  .search-bar-row :deep(.v-field__append-inner .v-btn) {
    min-width: 78px;
  }

  .search-bar-row :deep(.v-field-label--floating) {
    display: none;
  }
}
</style>
