<template>
  <v-locale-provider :locale="widgetLocale">
    <v-app v-if="entryFailure"><main class="workspace-entry-error"><WorkspaceNavigationNotice standalone /></main></v-app>
    <router-view v-else />
  </v-locale-provider>
</template>

<script setup>
import { computed, onBeforeMount, onMounted, ref } from "vue";
import { useConfigStore } from "@/store/config";
import { configure, addGtag } from "vue-gtag";
import { useTheme } from "@/composables/useTheme";
import { useRoute } from "vue-router";
import { useUiLanguage, useUiPageTitle } from "@/i18n";
import { useWorkspaceStore } from "@/store/workspace";
import WorkspaceNavigationNotice from "@/components/workspace/WorkspaceNavigationNotice.vue";

const { init: initTheme } = useTheme();
const { widgetLocale } = useUiLanguage();
const route = useRoute(), workspace = useWorkspaceStore();
useUiPageTitle(route);
const entryFailure = computed(() => route.matched?.length === 0 && !!workspace.navigationFailure);
const configStore = useConfigStore();
const gtagId = ref(null);

const initGtag = async (id) => {
  if (!id) {
    console.warn(
      "No Google Analytics ID provided. GA will not be initialized.",
    );
    return;
  }

  configure({ tagId: id });
  await addGtag();
  console.info("Google Analytics initialized");
};

onBeforeMount(async () => {
  await configStore.init();
  gtagId.value = configStore.envs.VITE_GTAG || import.meta.env.VITE_GTAG;
  await initGtag(gtagId.value);
});

onMounted(() => {
  initTheme();
});
</script>
