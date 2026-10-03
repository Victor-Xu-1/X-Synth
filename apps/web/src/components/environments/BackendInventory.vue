<template>
  <section class="backend-inventory" aria-label="后端能力清单">
    <header>
      <h2>原生能力</h2>
      <span
        >{{ modules.length }} 项源码模块 ·
        {{ modules.filter((item) => item.configured).length }} 项已配置</span
      >
    </header>
    <div class="inventory-table">
      <table>
        <thead>
          <tr>
            <th scope="col">模块</th>
            <th scope="col">运行状态</th>
            <th scope="col">服务绑定</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in modules.filter((value) => value.configured)"
            :key="item.id"
          >
            <th scope="row">{{ moduleName(item) }}</th>
            <td>{{ inventoryStatus(item.status) }}</td>
            <td>
              <code>{{ item.service_id }}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <details v-if="modules.some((item) => !item.configured)">
      <summary>
        未启用源码模块（{{
          modules.filter((item) => !item.configured).length
        }}）
      </summary>
      <div class="inventory-table">
        <table>
          <thead>
            <tr>
              <th scope="col">模块</th>
              <th scope="col">配置状态</th>
              <th scope="col">源码</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in modules.filter((value) => !value.configured)"
              :key="item.id"
            >
              <th scope="row">{{ moduleName(item) }}</th>
              <td>{{ inventoryStatus(item.status) }}</td>
              <td>{{ item.source_present ? "已保留" : "未找到" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
    <h2>其他软件接入状态</h2>
    <div class="inventory-table">
      <table>
        <thead>
          <tr>
            <th scope="col">软件</th>
            <th scope="col">接入状态</th>
            <th scope="col">运行验证</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in integrations" :key="item.id">
            <th scope="row">{{ integrationName(item.id) }}</th>
            <td>{{ inventoryStatus(item.status) }}</td>
            <td>{{ item.runtime_verified ? "已验证" : "未验证" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <h2>数据与依赖</h2>
    <dl>
      <div v-for="(item, id) in dependencies" :key="id">
        <dt>{{ dependencyName(id) }}</dt>
        <dd>
          {{ inventoryStatus(item.status)
          }}<span v-if="id === 'commercial_stock'">
            ·
            {{
              item.inventory_consistent ? "搜索与审查一致" : "一致性未通过"
            }}</span
          ><span
            v-if="
              id === 'template_library' && Number.isFinite(item.template_count)
            "
          >
            · {{ item.template_count.toLocaleString() }} 条</span
          >
        </dd>
      </div>
    </dl>
    <h2>执行入口</h2>
    <dl>
      <div>
        <dt>路线任务</dt>
        <dd>
          {{
            operations.unified_route?.managed ? "产品统一任务队列" : "未读取"
          }}
        </dd>
      </div>
      <div>
        <dt>原生异步模型队列</dt>
        <dd>
          {{
            operations.call_async?.supported
              ? "已配置"
              : "未配置，不允许直接提交"
          }}
        </dd>
      </div>
    </dl>
  </section>
</template>
<script setup>
import { computed } from "vue";
import {
  dependencyName,
  integrationName,
  inventoryStatus,
  moduleName,
} from "@/common/environment-inventory";
const props = defineProps({ inventory: { type: Object, required: true } });
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
