<template>
  <section class="standard-page">
    <header class="page-heading"><h1>页面未找到</h1></header>
    <div class="workspace-empty">
      <span class="state-badge">404</span>
      <h2>此页面不存在</h2>
      <div class="page-actions">
        <v-btn
          to="/"
          color="primary"
          variant="flat"
          prepend-icon="mdi-arrow-left"
          >返回工作区</v-btn
        >
        <v-btn to="/results" variant="text" prepend-icon="mdi-history"
          >任务历史</v-btn
        >
      </div>
    </div>
  </section>
</template>
