<template>
  <section class="standard-page environment-deployment">
    <header class="page-heading">
      <div>
        <h1>{{ $tr('环境部署') }}</h1>
        <span class="environment-platform"
        >X-Synth v{{ platform.version || productVersion }} ·
          {{ platform.system || $tr('未读取') }}</span
        >
      </div>
      <v-btn
        variant="text"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="refresh"
      >{{ $tr('刷新环境') }}</v-btn
      >
    </header>
    <div v-if="error" class="tool-error" role="alert">{{ $tr(error) }}</div>
    <v-tabs :model-value="tab" density="compact" :aria-label="$tr('部署环境视图')" @update:model-value="setTab">
      <v-tab v-for="view in views" :key="view.value" :value="view.value"
             :id="`${viewId}-${view.value}-tab`" :aria-controls="`${viewId}-${view.value}-panel`"
      >{{ $tr(view.label) }}</v-tab>
    </v-tabs>
    <div v-for="view in views" :key="view.value" class="environment-panel" role="tabpanel"
         :id="`${viewId}-${view.value}-panel`" :aria-labelledby="`${viewId}-${view.value}-tab`"
         :hidden="tab !== view.value" :aria-busy="loading && tab === view.value" tabindex="0">
      <template v-if="tab === view.value">
        <div v-if="loading && !snapshot.environments" class="workspace-loading" role="status"> {{ $tr('正在读取环境') }} </div>
        <div v-else-if="!snapshot.environments" class="workspace-empty">
          <v-icon icon="mdi-server-off" size="30" />
          <h2>{{ $tr('环境信息暂不可用') }}</h2>
        </div>
        <div v-else-if="tab === 'engines'" class="engine-list">
          <EngineEnvironment
            v-for="engine in snapshot.environments.engines"
            :key="engine.id"
            :engine="engine"
            @configure="setTab('configuration')"
            @monitor="setTab('monitor')"
          />
          <div v-if="!snapshot.environments.engines.length" class="workspace-empty"> {{ $tr('暂无已接入引擎') }} </div>
          <section class="scientific-engine-list" :aria-label="$tr('研究计算环境')">
            <h2>{{ $tr('研究计算环境') }}</h2>
            <div class="scientific-engine-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>{{ $tr('执行软件') }}</th>
                    <th>{{ $tr('用途') }}</th>
                    <th>{{ $tr('就绪状态') }}</th>
                    <th>{{ $tr('软件版本') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="engine in snapshot.environments.scientific_engines || []"
                    :key="engine.id"
                  >
                    <td>{{ engine.id === 'process' && engine.name === 'RDKit / 物料核算' ? $tr('RDKit / 物料核算') : engine.name }}</td>
                    <td>{{ $tr(engine.purpose) }}</td>
                    <td>{{ engine.ready ? $tr('已就绪') : $tr('未就绪') }}</td>
                    <td>
                      {{
                        Object.entries(engine.versions || {})
                          .map(([name, value]) => `${name} ${value}`)
                          .join(" · ") || $tr('随产品运行环境')
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <BackendInventory :inventory="snapshot.environments" />
        </div>
        <section
          v-else-if="tab === 'configuration'"
          class="environment-configuration"
          :aria-label="$tr('部署配置')"
        >
          <h2>{{ $tr('产品环境') }}</h2>
          <dl>
            <div>
              <dt>{{ $tr('操作系统') }}</dt>
              <dd>{{ platform.system }}</dd>
            </div>
            <div>
              <dt>{{ $tr('产品版本') }}</dt>
              <dd>{{ platform.version }}</dd>
            </div>
            <div>
              <dt>{{ $tr('产品 Python') }}</dt>
              <dd>{{ platform.python_version }}</dd>
            </div>
            <div>
              <dt>{{ $tr('访问模式') }}</dt>
              <dd>
                {{ platform.access_mode === "local" ? $tr('本地单用户') : $tr('账号认证') }}
              </dd>
            </div>
            <div>
              <dt>{{ $tr('统一部署入口') }}</dt>
              <dd>
                <code>{{ platform.entrypoint }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ $tr('代码提交') }}</dt>
              <dd>
                <code>{{ platform.build?.revision || $tr('未记录') }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ $tr('源码状态') }}</dt>
              <dd>
                {{
                  platform.build?.dirty === true
                    ? $tr('存在本地改动')
                    : platform.build?.dirty === false
                      ? $tr('与提交一致')
                      : $tr('未记录')
                }}
              </dd>
            </div>
            <div>
              <dt>{{ $tr('监测缓存（秒）') }}</dt>
              <dd>
                {{ snapshot.runtime?.budget?.health_cache_seconds ?? $tr('未读取') }}
              </dd>
            </div>
          </dl>
          <h2>{{ $tr('后端绑定') }}</h2>
          <dl>
            <div v-for="engine in snapshot.environments.engines" :key="engine.id">
              <dt>{{ engine.name }}</dt>
              <dd>
                {{ engine.active ? $tr('当前后端引擎') : $tr('已接入') }} ·
                <code>{{ engine.backend }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ $tr('商业库存一致性') }}</dt>
              <dd>
                {{
                  snapshot.health?.service_checks?.inventory_consistent === true
                    ? $tr('已通过')
                    : snapshot.health?.service_checks?.inventory_consistent === false
                      ? $tr('未通过')
                      : $tr('未读取')
                }}
              </dd>
            </div>
            <div>
              <dt>{{ $tr('目录快照') }}</dt>
              <dd>
                <code>{{
                  snapshot.health?.stock_snapshot?.catalog_sha256 || $tr('未读取')
                }}</code>
              </dd>
            </div>
          </dl>
        </section>
        <EnvironmentMonitoring v-else :snapshot="snapshot" />
      </template>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useOnline } from "@vueuse/core";
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
const online = useOnline();
const snapshot = ref({}),
  loading = ref(false),
  error = ref("");
const platform = computed(() => snapshot.value.environments?.platform || {});
const viewId = useId();
const views = [
  { value: "engines", label: "引擎环境" },
  { value: "configuration", label: "部署配置" },
  { value: "monitor", label: "运行监测" },
];
const tab = computed(() =>
  views.some(view => view.value === route.query.tab)
    ? route.query.tab
    : "engines",
);
let alive = true, reconnectPending = false;
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
    if (alive) {
      loading.value = false;
      if (reconnectPending && online.value) {
        reconnectPending = false;
        void refresh();
      }
    }
  }
}
watch(online, (connected, previous) => {
  if (!connected) { reconnectPending = false; return; }
  if (!alive || previous) return;
  // Coalesce reconnects while a read is finishing; never overlap snapshots.
  if (loading.value) reconnectPending = true;
  else void refresh();
});
onMounted(refresh);
onBeforeUnmount(() => { alive = false; reconnectPending = false; });
</script>
<style scoped>
.environment-panel { min-width: 0; }
.environment-panel[hidden] { display: none; }
.scientific-engine-list {
  margin-top: 24px;
}
.scientific-engine-list h2 {
  font-size: 16px;
  margin-bottom: 12px;
}
.scientific-engine-scroll {
  min-width: 0;
  overflow-x: auto;
}
.scientific-engine-scroll table {
  min-width: 620px;
}
.scientific-engine-scroll td:last-child {
  max-width: 360px;
  overflow-wrap: anywhere;
}
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
.engine-list > * {
  min-width: 0;
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
