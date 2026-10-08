<template>
  <header class="auth-header">
    <router-link class="auth-brand" to="/">X-Synth</router-link>
    <LanguageMenu />
  </header>
</template>

<script setup>
import LanguageMenu from "@/components/workspace/LanguageMenu.vue";
</script>

<style scoped>
.auth-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 40px; }
.auth-header .auth-brand { margin: 0; }
</style>
