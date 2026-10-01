<template>
    <v-container class="parse-shell" fluid>
        <v-row justify="center">
            <v-col cols="12" md="8" lg="6">
                <v-card class="pa-6" rounded="xl" elevation="0">
                    <v-icon icon="mdi-console-line" color="primary" size="42" class="mb-3"></v-icon>
                    <h1 class="text-h5 mb-2">命令解析</h1>
                    <p class="text-body-1 text-medium-emphasis mb-4">
                        该页面用于把外部搜索框传入的命令跳转到对应工作台。
                    </p>
                    <v-alert v-if="statusMessage" :type="statusType" variant="tonal" class="mb-4">
                        {{ statusMessage }}
                    </v-alert>
                    <v-list density="compact" class="rounded-lg border">
                        <v-list-subheader>支持的命令</v-list-subheader>
                        <v-list-item v-for="item in commandList" :key="item.key">
                            <v-list-item-title>{{ item.key }} · {{ item.name }}</v-list-item-title>
                            <v-list-item-subtitle>{{ item.path }}</v-list-item-subtitle>
                        </v-list-item>
                    </v-list>
                    <v-card-actions class="px-0 pt-5">
                        <v-btn color="primary" variant="tonal" to="/">返回工作台</v-btn>
                    </v-card-actions>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { commands } from "@/views/parse/commands";

const route = useRoute();
const router = useRouter();
const statusMessage = ref("");
const statusType = ref("info");

const commandList = computed(() => Object.entries(commands).map(([key, value]) => ({
    key,
    name: value.name,
    path: value.tab ? `${value.path}?tab=${value.tab}` : value.path,
})));

onMounted(() => {
    const rawSearch = typeof route.query.search === "string" ? route.query.search.trim() : "";
    if (!rawSearch) {
        statusMessage.value = "未收到 search 参数，请从工作台或外部命令入口重新进入。";
        statusType.value = "info";
        return;
    }

    const commandParams = rawSearch.split(/\s+/).filter(Boolean);
    const commandKey = (commandParams[0] || "").toLowerCase();
    const commandStruct = commands[commandKey];
    if (!commandStruct) {
        statusMessage.value = `未识别命令：${commandKey}`;
        statusType.value = "warning";
        return;
    }

    const expectedParamCount = Array.isArray(commandStruct.params) ? commandStruct.params.length : 0;
    const actualParamCount = Math.max(commandParams.length - 1, 0);
    if (actualParamCount < expectedParamCount) {
        statusMessage.value = `命令 ${commandKey} 缺少参数。`;
        statusType.value = "warning";
        return;
    }

    const query = { ...(commandStruct.tab && { tab: commandStruct.tab }) };
    if (expectedParamCount > 0 && commandParams[1]) {
        query.target = commandParams[1];
    }
    router.push({ path: commandStruct.path, query });
});
</script>

<style scoped>
.parse-shell {
    min-height: calc(100vh - 50px);
    padding: 48px 20px;
    background: linear-gradient(180deg, rgba(241, 248, 246, 0.95), rgba(248, 250, 252, 0.96));
}
</style>
