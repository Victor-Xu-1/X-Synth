<template>
  <v-btn variant="tonal" prepend-icon="mdi mdi-pencil" data-cy="component-draw-btn" @click="openKetcher(smiles)"
    rounded="pill" :size="props.size" class="text-none">绘制</v-btn>
  <ketcher-modal ref="ketcherRef" v-model="showKetcher" :smiles="smiles" @input="showKetcher = false"
    @update:smiles="updateSmiles" />
</template>

<script setup>
import { ref } from 'vue';
import KetcherModal from "@/components/KetcherModal";
const smiles = defineModel("smiles", { required: true, default: '' })
const props = defineProps({ size: { type: String, required: false, default: "default" } })
const showKetcher = ref(false);
const ketcherRef = ref(null);

const openKetcher = (source) => {
  smiles.value = source;
  showKetcher.value = true;
  ketcherRef.value.smilesToKetcher();
};

const updateSmiles = (newSmiles) => {
  smiles.value = newSmiles;
}
</script>
