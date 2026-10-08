<template>
  <article class="engine-environment">
    <header>
      <v-icon icon="mdi-server-network" size="24" />
      <div>
        <h2>{{ engine.name }}</h2>
        <span>{{ $tr('逆合成计算引擎') }}</span>
      </div>
      <span v-if="engine.active" class="engine-current">{{ $tr('当前后端') }}</span
      ><span
        class="state-badge"
        :class="{ success: engine.status === 'ready' }"
        >{{ $tr(environmentStatus(engine.status)) }}</span
      >
    </header>
    <dl>
      <div>
        <dt>{{ $tr('运行监测') }}</dt>
        <dd>
          {{
            engine.runtime_mode === "supervised_native"
              ? $tr('本地监督记录')
              : $tr('外部服务连接')
          }}
        </dd>
      </div>
      <div>
        <dt>{{ $tr('可用搜索策略') }}</dt>
        <dd>{{ strategies }}</dd>
      </div>
      <div>
        <dt>{{ $tr('已配置模板模型') }}</dt>
        <dd>{{ engine.configured_models?.join(" / ") || $tr('未识别') }}</dd>
      </div>
      <div>
        <dt>{{ $tr('模型探针') }}</dt>
        <dd>{{ engine.models_verified ? $tr('已通过') : $tr('未通过') }}</dd>
      </div>
    </dl>
    <span v-if="engine.unrecognized_model_count" class="tool-error"
      >{{ $tr('{count} 项模型配置未识别', { count: engine.unrecognized_model_count }) }}</span
    >
    <footer>
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-cog-outline"
        @click="$emit('configure')"
        >{{ $tr('部署配置') }}</v-btn
      ><v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-pulse"
        @click="$emit('monitor')"
        >{{ $tr('运行监测') }}</v-btn
      >
    </footer>
  </article>
</template>
<script setup>
import { environmentStatus, strategyText } from "@/common/runtime-status";
import { computed } from "vue";
import { uiText } from "@/i18n";
const props = defineProps({ engine: { type: Object, required: true } });
const strategies = computed(() => props.engine.available_strategies?.map((value) => {
  const label = strategyText([value]);
  return label === value ? value : uiText(label);
}).join(" / ") || uiText("暂无可用策略"));
defineEmits(["configure", "monitor"]);
</script>
<style scoped>
.engine-environment {
  border: 1px solid var(--ws-border);
  border-radius: 6px;
  padding: 20px;
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
header > div {
  flex: 1;
  min-width: 140px;
}
h2 {
  font-size: 16px;
  font-weight: 550;
}
header span,
dt {
  font-size: 11px;
  color: var(--ws-muted);
}
.engine-current {
  color: var(--ws-text);
}
dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin: 24px 0;
}
dd {
  font-size: 13px;
  margin-top: 6px;
  overflow-wrap: anywhere;
}
footer {
  border-top: 1px solid var(--ws-border);
  padding-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
@media (max-width: 600px) {
  dl {
    grid-template-columns: 1fr;
  }
}
</style>
