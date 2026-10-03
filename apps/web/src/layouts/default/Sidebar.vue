<template>
  <aside class="workspace-sidebar" :class="{ compact }" aria-label="工作区导航">
    <router-link to="/" class="workspace-brand"
      ><span>X-Synth</span
      ><small v-if="!compact">v{{ version }}</small></router-link
    >
    <nav class="workspace-nav">
      <section v-for="group in navigation" :key="group.label" class="nav-group">
        <p v-if="!compact">{{ group.label }}</p>
        <router-link
          v-for="item in group.items"
          :key="item.title"
          :to="item.to"
          class="nav-item"
          :class="{ active: activeNavigation(item, route) }"
          :title="compact ? item.title : undefined"
          @click="$emit('navigate')"
        >
          <v-icon :icon="item.icon" size="20" /><span v-if="!compact">{{
            item.title
          }}</span>
        </router-link>
      </section>
      <details
        v-if="
          !compact && optionalTools.some((item) => workspace.can(item.feature))
        "
        class="optional-tool-list"
      >
        <summary>
          <v-icon icon="mdi-dots-horizontal" size="20" />更多工具
        </summary>
        <router-link
          v-for="item in optionalTools.filter((item) =>
            workspace.can(item.feature),
          )"
          :key="item.title"
          :to="item.to"
          class="nav-item"
          :class="{ active: activeNavigation(item, route) }"
          @click="$emit('navigate')"
          ><v-icon :icon="item.icon" size="20" />{{ item.title }}</router-link
        >
        <span
          v-if="!optionalTools.some((item) => workspace.can(item.feature))"
          class="nav-muted"
          >未启用其他计算服务</span
        >
      </details>
    </nav>
    <div class="workspace-sidebar-footer">
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
        class="nav-item"
        :to="workspace.local ? '/status' : '/login'"
        @click="$emit('navigate')"
        ><v-icon
          :icon="workspace.local ? 'mdi-laptop' : 'mdi-account-outline'"
          size="20"
        /><span v-if="!compact">{{
          workspace.local ? "本地工作区" : "账户"
        }}</span></router-link
      >
    </div>
  </aside>
</template>
<script setup>
import { useRoute } from "vue-router";
import {
  navigation,
  optionalTools,
  activeNavigation,
} from "@/common/workspace-navigation";
import { useWorkspaceStore } from "@/store/workspace";
import { useTheme } from "@/composables/useTheme";
defineProps({ compact: Boolean });
defineEmits(["navigate"]);
const version = __X_SYNTH_VERSION__;
const route = useRoute();
const workspace = useWorkspaceStore();
const { isDark, toggleTheme } = useTheme();
</script>
