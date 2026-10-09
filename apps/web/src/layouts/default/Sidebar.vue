<template>
  <aside class="workspace-sidebar" :class="{ compact }" :aria-label="$tr('工作区导航')">
    <div class="workspace-drawer-heading">
      <router-link
        to="/"
        class="workspace-brand"
        :aria-label="`X-Synth v${version}`"
        title="X-Synth"
        @click="$emit('navigate')"
      >
        <BrandMark :size="24" />
        <span v-if="!compact" class="workspace-brand-copy"
          ><span>X-Synth</span><small>v{{ version }}</small></span
        >
      </router-link>
      <v-btn
        icon="mdi-close"
        variant="text"
        size="small"
        width="44"
        height="44"
        :aria-label="$tr('关闭导航')"
        :title="$tr('关闭导航')"
        @click="$emit('navigate')"
      />
    </div>
    <nav class="workspace-nav" :aria-label="$tr('研究模块')">
      <section v-for="group in mainGroups" :key="group.label" class="nav-group">
        <p v-if="!compact">{{ $tr(group.label) }}</p>
        <router-link
          v-for="item in group.items"
          :key="item.title"
          :to="navigationLocation(item, route, workspace.features)"
          class="nav-item"
          :class="{ active: activeNavigation(item, route) }"
          :aria-current="activeNavigation(item, route) ? 'page' : undefined"
          :aria-label="$tr(item.title)"
          :title="compact ? $tr(item.title) : undefined"
          @click="$emit('navigate')"
        >
          <v-icon :icon="item.icon" size="20" /><span>{{ $tr(item.title) }}</span>
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
        :aria-label="$tr(item.title)"
        :title="compact ? $tr(item.title) : undefined"
        @click="$emit('navigate')"
      >
        <v-icon :icon="item.icon" size="20" /><span>{{ $tr(item.title) }}</span>
      </router-link>
      <button
        type="button"
        class="nav-item"
        :aria-label="$tr('切换主题')"
        :title="compact ? $tr('切换主题') : undefined"
        @click="toggleTheme"
      >
        <v-icon
          :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          size="20"
        /><span>{{ isDark ? $tr('浅色模式') : $tr('深色模式') }}</span>
      </button>
      <router-link
        v-if="workspace.session?.mode === 'askcos'"
        class="nav-item"
        :aria-label="$tr('账户')"
        :title="compact ? $tr('账户') : undefined"
        to="/login"
        @click="$emit('navigate')"
        ><v-icon icon="mdi-account-outline" size="20" /><span
          >{{ $tr('账户') }}</span
        ></router-link
      >
    </div>
  </aside>
</template>
<script setup>
import BrandMark from "@/components/workspace/BrandMark.vue";
import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  visibleNavigation,
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
const groups = computed(() => visibleNavigation(workspace.features));
const mainGroups = computed(() =>
  groups.value.filter((group) => group.placement !== "footer"),
);
const footerItems = computed(() =>
  groups.value
    .filter((group) => group.placement === "footer")
    .flatMap((group) => group.items),
);
const { isDark, toggleTheme } = useTheme();
</script>
