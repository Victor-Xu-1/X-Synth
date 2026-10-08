<template>
  <section class="backend-inventory" :aria-label="$tr('后端能力清单')">
    <header>
      <h2>{{ $tr('原生能力') }}</h2>
      <span
        >{{ $tr('{count} 项源码模块 · {configured} 项已配置', { count: modules.length, configured: modules.filter((item) => item.configured).length }) }}</span
      >
    </header>
    <div class="inventory-table">
      <table>
        <thead>
          <tr>
            <th scope="col">{{ $tr('模块') }}</th>
            <th scope="col">{{ $tr('运行状态') }}</th>
            <th scope="col">{{ $tr('服务绑定') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in modules.filter((value) => value.configured)"
            :key="item.id"
          >
            <th scope="row">{{ moduleLabel(item) }}</th>
            <td>{{ $tr(inventoryStatus(item.status)) }}</td>
            <td>
              <code>{{ item.service_id }}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <details v-if="modules.some((item) => !item.configured)">
      <summary>{{ $tr('未启用源码模块（{count}）', { count: modules.filter((item) => !item.configured).length }) }}
      </summary>
      <div class="inventory-table">
        <table>
          <thead>
            <tr>
              <th scope="col">{{ $tr('模块') }}</th>
              <th scope="col">{{ $tr('配置状态') }}</th>
              <th scope="col">{{ $tr('源码') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in modules.filter((value) => !value.configured)"
              :key="item.id"
            >
              <th scope="row">{{ moduleLabel(item) }}</th>
              <td>{{ $tr(inventoryStatus(item.status)) }}</td>
              <td>{{ item.source_present ? $tr('已保留') : $tr('未找到') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
    <h2>{{ $tr('其他软件接入状态') }}</h2>
    <div class="inventory-table">
      <table>
        <thead>
          <tr>
            <th scope="col">{{ $tr('软件') }}</th>
            <th scope="col">{{ $tr('接入状态') }}</th>
            <th scope="col">{{ $tr('运行验证') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in integrations" :key="item.id">
            <th scope="row">{{ integrationLabel(item.id) }}</th>
            <td>{{ $tr(inventoryStatus(item.status)) }}</td>
            <td>{{ item.runtime_verified ? $tr('已验证') : $tr('未验证') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <h2>{{ $tr('数据与依赖') }}</h2>
    <dl>
      <div v-for="(item, id) in dependencies" :key="id">
        <dt>{{ dependencyLabel(id) }}</dt>
        <dd>
          {{ $tr(inventoryStatus(item.status))
          }}<span v-if="id === 'commercial_stock'">
            ·
            {{
              item.inventory_consistent ? $tr('搜索与审查一致') : $tr('一致性未通过')
            }}</span
          ><span
            v-if="
              id === 'template_library' && Number.isFinite(item.template_count)
            "
          >
            · {{ $tr('{count} 条', { count: item.template_count.toLocaleString(locale) }) }}</span
          >
        </dd>
      </div>
    </dl>
    <h2>{{ $tr('执行入口') }}</h2>
    <dl>
      <div>
        <dt>{{ $tr('路线任务') }}</dt>
        <dd>
          {{
            operations.unified_route?.managed ? $tr('产品统一任务队列') : $tr('未读取')
          }}
        </dd>
      </div>
      <div>
        <dt>{{ $tr('原生异步模型队列') }}</dt>
        <dd>
          {{
            operations.call_async?.supported
              ? $tr('已配置')
              : $tr('未配置，不允许直接提交')
          }}
        </dd>
      </div>
    </dl>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { uiText, useUiLanguage } from "@/i18n";
import {
  dependencyName,
  integrationName,
  inventoryStatus,
  moduleName,
} from "@/common/environment-inventory";
const props = defineProps({ inventory: { type: Object, required: true } });
const { locale } = useUiLanguage();
const moduleLabel = (item) => {
  const known = moduleName({ id: item.id });
  return known === item.id ? moduleName(item) : uiText(known);
};
const integrationLabel = (id) => {
  const label = integrationName(id);
  return label === id ? id : uiText(label);
};
const dependencyLabel = (id) => {
  const label = dependencyName(id);
  return label === id ? id : uiText(label);
};
const modules = computed(() => props.inventory.native?.modules || []);
const integrations = computed(() => props.inventory.integrations || []);
const dependencies = computed(() => props.inventory.dependencies || {});
const operations = computed(() => props.inventory.operations || {});
</script>
<style scoped>
.backend-inventory {
  min-width: 0;
  font-size: 12px;
}
header {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}
h2 {
  font-size: 15px;
  font-weight: 550;
  margin: 20px 0 14px;
}
header span,
dt {
  color: var(--ws-muted);
  font-size: 11px;
}
.inventory-table {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  padding: 12px 8px;
  text-align: left;
  border-bottom: 1px solid var(--ws-border);
  white-space: nowrap;
}
tbody th {
  font-weight: normal;
}
code {
  font-size: 11px;
}
details {
  margin-top: 14px;
}
summary {
  cursor: pointer;
}
dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
dd {
  margin-top: 5px;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  dl {
    grid-template-columns: 1fr;
  }
}
</style>
