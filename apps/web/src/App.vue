<template>
  <v-locale-provider :locale="widgetLocale">
    <v-app v-if="entryFailure"><main class="workspace-entry-error"><WorkspaceNavigationNotice standalone /></main></v-app>
    <router-view v-else />
  </v-locale-provider>
</template>

<script setup>
import { computed, onBeforeMount, onMounted } from "vue";
import { useConfigStore } from "@/store/config";
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

onBeforeMount(async () => {
  await configStore.init();
});

onMounted(() => {
  initTheme();
});
</script>
