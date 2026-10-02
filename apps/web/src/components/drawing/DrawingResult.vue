<template>
  <v-row class="justify-center">
    <v-col cols="12" md="12" xl="10">
      <v-sheet class="elevation-2 pa-5" rounded="lg">
        <div v-if="smiles.length">
          <smiles-image :smiles="smiles" allow-copy></smiles-image>
          <p class="text-body-1 text-center">SMILES: {{ smiles }}</p>
        </div>
        <div v-else class="text-center">
          <v-img class="justify-center mx-auto mb-3" :width="400" src="@/assets/emptyDraw.svg"></v-img>
          <h2>画板为空</h2>
          <p class="text-body-1">输入分子 SMILES、反应 SMILES 或模板 SMARTS 后，这里会生成结构预览。
          </p>
        </div>
      </v-sheet>
    </v-col>
  </v-row>
</template>

<script setup>
import SmilesImage from "@/components/SmilesImage"
const smiles = defineModel("smiles", { required: true, default: '' })
</script>
