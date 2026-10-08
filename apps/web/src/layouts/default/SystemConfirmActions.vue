<template>
  <v-spacer />
  <v-btn variant="text" @click="cancel">{{ $tr('取消') }}</v-btn>
  <v-btn color="primary" :disabled="confirmationButtonDisabled" @click="confirm">{{ $tr('确定') }}</v-btn>
</template>

<script setup>
defineProps({ confirmationButtonDisabled: Boolean, cancel: { type: Function, required: true }, confirm: { type: Function, required: true } });
</script>
