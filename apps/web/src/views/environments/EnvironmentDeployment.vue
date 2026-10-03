<template>
  <section class="standard-page environment-deployment">
    <header class="page-heading">
      <div>
        <h1>环境部署</h1>
        <span class="environment-platform"
          >X-Synth v{{ platform.version || productVersion }} ·
          {{ platform.system || "未读取" }}</span
        >
      </div>
      <v-btn
        variant="text"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="refresh"
        >刷新环境</v-btn
      >
    </header>
    <div v-if="error" class="tool-error" role="alert">{{ error }}</div>
    <v-tabs :model-value="tab" density="compact" @update:model-value="setTab"
      ><v-tab value="engines">引擎环境</v-tab
      ><v-tab value="configuration">部署配置</v-tab
      ><v-tab value="monitor">运行监测</v-tab></v-tabs
    >
    <div v-if="loading && !snapshot.environments" class="workspace-loading">
      正在读取环境
    </div>
    <div v-else-if="!snapshot.environments" class="workspace-empty">
      <v-icon icon="mdi-server-off" size="30" />
      <h2>环境信息暂不可用</h2>
    </div>
    <div v-else-if="tab === 'engines'" class="engine-list">
      <EngineEnvironment
        v-for="engine in snapshot.environments.engines"
        :key="engine.id"
        :engine="engine"
        @configure="setTab('configuration')"
        @monitor="setTab('monitor')"
      />
      <div v-if="!snapshot.environments.engines.length" class="workspace-empty">
        暂无已接入引擎
      </div>
      <BackendInventory :inventory="snapshot.environments" />
    </div>
    <section
      v-else-if="tab === 'configuration'"
      class="environment-configuration"
      aria-label="部署配置"
    >
      <h2>产品环境</h2>
      <dl>
        <div>
          <dt>操作系统</dt>
          <dd>{{ platform.system }}</dd>
        </div>
        <div>
          <dt>产品版本</dt>
          <dd>{{ platform.version }}</dd>
        </div>
        <div>
          <dt>产品 Python</dt>
          <dd>{{ platform.python_version }}</dd>
        </div>
        <div>
          <dt>访问模式</dt>
          <dd>
            {{ platform.access_mode === "local" ? "本地单用户" : "账号认证" }}
          </dd>
        </div>
        <div>
          <dt>统一部署入口</dt>
          <dd>
            <code>{{ platform.entrypoint }}</code>
          </dd>
        </div>
        <div>
          <dt>代码提交</dt>
          <dd>
            <code>{{ platform.build?.revision || "未记录" }}</code>
          </dd>
        </div>
        <div>
          <dt>源码状态</dt>
          <dd>
            {{
              platform.build?.dirty === true
                ? "存在本地改动"
                : platform.build?.dirty === false
                  ? "与提交一致"
                  : "未记录"
            }}
          </dd>
        </div>
        <div>
          <dt>监测缓存（秒）</dt>
          <dd>
            {{ snapshot.runtime?.budget?.health_cache_seconds ?? "未读取" }}
          </dd>
        </div>
      </dl>
      <h2>后端绑定</h2>
      <dl>
        <div v-for="engine in snapshot.environments.engines" :key="engine.id">
          <dt>{{ engine.name }}</dt>
          <dd>
            {{ engine.active ? "当前后端引擎" : "已接入" }} ·
            <code>{{ engine.backend }}</code>
          </dd>
        </div>
        <div>
          <dt>商业库存一致性</dt>
          <dd>
            {{
              snapshot.health?.service_checks?.inventory_consistent === true
                ? "已通过"
                : "未通过"
            }}
          </dd>
        </div>
        <div>
          <dt>目录快照</dt>
          <dd>
            <code>{{
              snapshot.health?.stock_snapshot?.catalog_sha256 || "未读取"
            }}</code>
          </dd>
        </div>
      </dl>
    </section>
    <EnvironmentMonitoring v-else :snapshot="snapshot" />
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { loadRuntimeStatus } from "@/common/runtime-status";
import { errorMessage } from "@/common/workspace-errors";
import EngineEnvironment from "@/components/environments/EngineEnvironment.vue";
import EnvironmentMonitoring from "@/components/environments/EnvironmentMonitoring.vue";
import BackendInventory from "@/components/environments/BackendInventory.vue";
const route = useRoute(),
  router = useRouter();
const productVersion = __X_SYNTH_VERSION__;
const snapshot = ref({}),
  loading = ref(false),
  error = ref("");
const platform = computed(() => snapshot.value.environments?.platform || {});
const tab = computed(() =>
  ["engines", "configuration", "monitor"].includes(route.query.tab)
    ? route.query.tab
    : "engines",
);
let alive = true;
function setTab(value) {
  router.replace({ path: "/environments", query: { tab: value } });
}
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    const value = await loadRuntimeStatus(API);
    if (!alive) return;
    snapshot.value = value;
    error.value = value.unavailable.length ? "部分环境信息暂不可用。" : "";
  } catch (e) {
    if (alive) error.value = errorMessage(e, "无法读取部署环境。");
  } finally {
    if (alive) loading.value = false;
  }
}
onMounted(refresh);
onBeforeUnmount(() => (alive = false));
</script>
<style scoped>
.environment-deployment {
  max-width: 1200px;
}
.environment-platform {
  font-size: 11px;
  color: var(--ws-muted);
}
.engine-list {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}
.environment-configuration h2 {
  font-size: 15px;
  font-weight: 550;
  margin: 24px 0 16px;
}
.environment-configuration dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.environment-configuration dt {
  font-size: 12px;
  color: var(--ws-muted);
}
.environment-configuration dd {
  margin-top: 6px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.environment-configuration code {
  font-size: 11px;
}
@media (max-width: 600px) {
  .environment-configuration dl {
    grid-template-columns: 1fr;
  }
}
</style>
