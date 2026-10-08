<template>
  <v-snackbar :model-value="open && activity" :color="message?.color" :timeout="3000"
    @update:model-value="activity && (open = $event)">
    {{ $tr(message?.source || '', message?.values || {}) }}
    <template #actions><v-btn variant="text" @click="open = false">{{ $tr('关闭') }}</v-btn></template>
  </v-snackbar>
</template>

<script setup>
import { useWorkbenchActivity } from "@/components/workspace/workbench-activity";
const open = defineModel({ type: Boolean, default: false });
defineProps({ message: { type: Object, default: null } });
const activity = useWorkbenchActivity();
</script>
