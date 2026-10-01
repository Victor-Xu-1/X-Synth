<template>
  <module-workbench
    title="结构绘制工作台"
    eyebrow="结构工具"
    icon="mdi-pencil-ruler"
    accent="primary"
    description="输入或绘制分子、反应 SMILES 和模板 SMARTS，快速生成结构预览并进行标准化。"
    :summary-items="summaryItems"
  >
    <drawing-toolbar v-model:smiles="smiles" />
    <drawing-result v-model:smiles="smiles" />
  </module-workbench>
</template>

<script setup>
import { ref } from 'vue';
import DrawingToolbar from "@/components/drawing/DrawingToolbar"
import DrawingResult from "@/components/drawing/DrawingResult"
import ModuleWorkbench from "@/components/ModuleWorkbench.vue"

const smiles = ref('')
const summaryItems = [
  { label: "支持输入", value: "分子 SMILES、反应 SMILES、模板 SMARTS", icon: "mdi-code-braces" },
  { label: "结构预览", value: "使用结构绘图接口渲染", icon: "mdi-image-filter-center-focus" },
  { label: "标准化", value: "调用 RDKit canonicalize", icon: "mdi-auto-fix" },
]
</script>
