<template>
  <router-view />
</template>

<script setup>
import { onBeforeMount, onMounted, ref } from "vue";
import { useConfigStore } from "@/store/config";
import { configure, addGtag } from "vue-gtag";
import { useTheme } from "@/composables/useTheme";

const { init: initTheme } = useTheme();
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
