<template>
  <section class="synon-header">
    <div class="header-copy">
      <v-chip class="header-chip" color="teal" variant="tonal" size="small">
        <v-icon icon="mdi-flask-round-bottom-outline" start></v-icon>
        synon 合成设计工作台
      </v-chip>
      <h1>合成设计工作台</h1>
      <p>
        从目标结构出发，统一进入逆合成、条件搜索、正向预测、商购检索和结果管理。
        暂未由 ASKCOS 原生提供的模块会保留为空状态，后续可接入新服务。
      </p>
    </div>
    <div class="header-status">
      <div class="status-card active">
        <v-icon icon="mdi-source-branch"></v-icon>
        <div>
          <strong>逆合成主入口</strong>
          <span>一步预测 / 路线树</span>
        </div>
      </div>
      <div class="status-card">
        <v-icon icon="mdi-database-search-outline"></v-icon>
        <div>
          <strong>商业原料检索</strong>
          <span>商购结构匹配</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.synon-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
  gap: 24px;
  align-items: end;
  padding: 28px 28px 10px;
}

.header-copy {
  max-width: 820px;
}

.header-chip {
  margin-bottom: 14px;
  font-weight: 700;
}

.header-copy h1 {
  margin: 0;
  color: #0f172a;
  font-size: clamp(34px, 4vw, 56px);
  line-height: 1.02;
  letter-spacing: 0;
}

.header-copy p {
  max-width: 760px;
  margin: 16px 0 0;
  color: #526173;
  font-size: 16px;
  line-height: 1.75;
}

.header-status {
  display: grid;
  gap: 12px;
}

.status-card {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.78);
}

.status-card.active {
  border-color: rgba(20, 184, 166, 0.26);
  background: linear-gradient(135deg, rgba(20, 184, 166, 0.12), rgba(255, 255, 255, 0.9));
}

.status-card strong,
.status-card span {
  display: block;
}

.status-card strong {
  color: #0f172a;
  font-size: 14px;
}

.status-card span {
  margin-top: 3px;
  color: #64748b;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .synon-header {
    grid-template-columns: 1fr;
  }

  .header-status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
