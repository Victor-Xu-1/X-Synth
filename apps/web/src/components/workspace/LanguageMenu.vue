<template>
  <v-menu ref="menu" v-model="open" location="bottom end" :close-on-content-click="false">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon="mdi-translate" variant="text" size="small"
        :aria-label="$tr('语言')" :title="$tr('语言')" data-cy="ui-language-menu" />
    </template>
    <v-list density="compact" role="menu" :aria-label="$tr('语言')">
      <v-list-item v-for="choice in locales" :key="choice.value" :value="choice.value"
        role="menuitemradio" :aria-checked="locale === choice.value" :active="locale === choice.value"
        :title="choice.label" :lang="choice.value" :data-locale="choice.value" @click="choose(choice.value)" />
      <p v-if="preferenceError" class="language-preference-error" role="status" aria-live="polite">{{ preferenceError }}</p>
    </v-list>
  </v-menu>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useUiLanguage } from "@/i18n";
const { locale, locales, setLocale, preferenceError } = useUiLanguage();
const open = ref(false), menu = ref(null);
let disposed = false;
async function choose(value) {
  setLocale(value);
  if (preferenceError.value) return;
  open.value = false;
  await nextTick();
  const element = menu.value?.activatorEl;
  if (!disposed && element?.isConnected && !element.closest("[inert], [hidden]")) element.focus({ preventScroll: true });
}
onBeforeUnmount(() => { disposed = true; });
</script>

<style scoped>
.language-preference-error { max-width: 280px; margin: 8px 16px; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
</style>
