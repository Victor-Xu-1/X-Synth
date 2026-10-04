<template>
  <aside class="workspace-sidebar" :class="{ compact }" aria-label="工作区导航">
    <router-link
      to="/"
      class="workspace-brand"
      :aria-label="`X-Synth v${version}`"
      title="X-Synth"
    >
      <BrandMark />
      <span v-if="!compact" class="workspace-brand-copy"
        ><span>X-Synth</span><small>v{{ version }}</small></span
      >
    </router-link>
    <nav class="workspace-nav">
      <section v-for="group in mainGroups" :key="group.label" class="nav-group">
        <p v-if="!compact">{{ group.label }}</p>
        <router-link
          v-for="item in group.items"
          :key="item.title"
          :to="navigationLocation(item, route, workspace.features)"
          class="nav-item"
          :class="{ active: activeNavigation(item, route) }"
          :aria-current="activeNavigation(item, route) ? 'page' : undefined"
          :aria-label="item.title"
          :title="compact ? item.title : undefined"
          @click="$emit('navigate')"
        >
          <v-icon :icon="item.icon" size="20" /><span v-if="!compact">{{
            item.title
          }}</span>
        </router-link>
      </section>
    </nav>
    <div class="workspace-sidebar-footer">
      <router-link
        v-for="item in footerItems"
        :key="item.title"
        :to="item.to"
        class="nav-item"
        :class="{ active: activeNavigation(item, route) }"
        :aria-current="activeNavigation(item, route) ? 'page' : undefined"
        :aria-label="item.title"
        :title="compact ? item.title : undefined"
        @click="$emit('navigate')"
      >
        <v-icon :icon="item.icon" size="20" /><span v-if="!compact">{{
          item.title
        }}</span>
      </router-link>
      <button
        type="button"
        class="nav-item"
        :title="compact ? '切换主题' : undefined"
        @click="toggleTheme"
      >
        <v-icon
          :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          size="20"
        /><span v-if="!compact">{{ isDark ? "浅色模式" : "深色模式" }}</span>
      </button>
      <router-link
        v-if="workspace.refreshed && !workspace.local"
        class="nav-item"
        aria-label="账户"
        :title="compact ? '账户' : undefined"
        to="/login"
        @click="$emit('navigate')"
        ><v-icon icon="mdi-account-outline" size="20" /><span v-if="!compact"
          >账户</span
        ></router-link
      >
    </div>
  </aside>
</template>
<script setup>
import BrandMark from "@/components/workspace/BrandMark.vue";
import { useRoute } from "vue-router";
import {
  navigation,
  navigationLocation,
  activeNavigation,
} from "@/common/workspace-navigation";
import { useWorkspaceStore } from "@/store/workspace";
import { useTheme } from "@/composables/useTheme";
defineProps({ compact: Boolean });
defineEmits(["navigate"]);
const version = __X_SYNTH_VERSION__;
const route = useRoute();
const workspace = useWorkspaceStore();
const mainGroups = navigation.filter((group) => group.placement !== "footer");
const footerItems = navigation
  .filter((group) => group.placement === "footer")
  .flatMap((group) => group.items);
const { isDark, toggleTheme } = useTheme();
</script>
