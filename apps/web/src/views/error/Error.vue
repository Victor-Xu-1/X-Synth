<template>
  <section class="standard-page">
    <header class="page-heading"><h1>服务不可用</h1></header>
    <div class="workspace-empty">
      <v-icon icon="mdi-server-off" size="32" />
      <h2>暂时无法连接服务</h2>
      <p class="workspace-muted">请检查服务状态后重试。</p>
      <div class="page-actions">
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-refresh"
          @click="reload"
          >重新加载</v-btn
        >
        <v-btn to="/status" variant="text" prepend-icon="mdi-server-outline"
          >服务状态</v-btn
        >
      </div>
    </div>
  </section>
</template>

<script setup>
const reload = () => window.location.reload();
</script>
