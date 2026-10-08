<template><slot /></template>
<script setup>
import { toRef } from "vue";
import { provideWorkbenchActivity } from "./workbench-activity";

const props = defineProps({ active: { type: Boolean, default: true } });
provideWorkbenchActivity(toRef(props, "active"));
</script>
