<template>
  <v-card-title v-if="heading" :id="id" class="localized-dialog-heading">{{ $tr(source, values) }}</v-card-title>
  <span v-else>{{ $tr(source, values) }}</span>
</template>

<script setup>
defineProps({
  source: { type: String, required: true }, values: { type: Object, default: () => ({}) },
  heading: Boolean, id: String,
});
</script>

<style scoped>
.localized-dialog-heading { white-space: normal; overflow-wrap: anywhere; }
</style>
