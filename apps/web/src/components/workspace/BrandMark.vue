<template>
  <img
    class="x-synth-brand-mark"
    :src="logo"
    :width="size"
    :height="size"
    alt=""
    aria-hidden="true"
    draggable="false"
  />
</template>
<script setup>
import logo from "@/assets/brand/x-synth-logo.png";
defineProps({ size: { type: Number, default: 32 } });
</script>
<style scoped>
.x-synth-brand-mark {
  display: block;
  flex-shrink: 0;
  object-fit: contain;
}
</style>
