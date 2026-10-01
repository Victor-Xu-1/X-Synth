<template>
  <module-workbench
    title="服务状态工作台"
    eyebrow="系统监控"
    icon="mdi-list-status"
    accent="blue"
    description="集中查看任务队列、数据库集合和模型服务状态，判断当前环境是否可以稳定执行预测任务。"
    :summary-items="summaryItems"
  >
    <v-row class="my-0">
      <v-col cols="12">
        <CeleryStatus />
      </v-col>
      <v-col cols="12">
        <DatabaseStatus />
      </v-col>
      <v-col cols="12">
        <ModelStatus />
      </v-col>
    </v-row>
  </module-workbench>
</template>

<script setup>
import CeleryStatus from "@/views/status/components/CeleryStatus.vue";
import ModelStatus from "@/views/status/components/ModelStatus.vue";
import DatabaseStatus from "@/views/status/components/DatabaseStatus.vue";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue"

const summaryItems = [
  { label: "任务队列", value: "Celery worker 与排队状态", icon: "mdi-queue-first-in-last-out" },
  { label: "数据库", value: "商业原料、模板和结果集合", icon: "mdi-database-outline" },
  { label: "模型服务", value: "逆合成、正向预测等后端模型", icon: "mdi-server-network" },
]
</script>
