<template>
  <v-container class="home-shell" fluid>
    <div class="home-column">
      <search-sheet />
    </div>
  </v-container>
</template>

<script setup>
import SearchSheet from "@/components/home/SearchSheet";
</script>

<style scoped>
.home-shell {
  box-sizing: border-box;
  height: calc(100dvh - 52px);
  min-height: 0;
  padding: clamp(10px, 0.72vw, 14px) clamp(14px, 1.1vw, 24px);
  overflow: auto;
  background:
    linear-gradient(180deg, rgba(245, 247, 251, 0.98), rgba(250, 251, 253, 0.98)),
    radial-gradient(circle at top right, rgba(0, 122, 255, 0.08), transparent 32%);
}

.home-column {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  height: 100%;
  min-height: 0;
  max-width: none;
  flex-basis: 100%;
}

@media (max-width: 960px) {
  .home-shell {
    height: auto;
    min-height: calc(100dvh - 52px);
    overflow: visible;
    padding: 16px 14px 36px;
  }
}
</style>
