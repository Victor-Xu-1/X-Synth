<template>
    <WorkbenchDialog v-model="showBanItemDialog" max-width="600px">
        <v-card>
            <v-card-title class="mt-2">
                <v-col cols="12">{{ $tr('新增禁用列表记录') }}</v-col></v-card-title>

            <v-card-text class="text-justify">
                <v-row>
                    <v-col cols="12">
                        <v-select v-model="newType" data-cy="banlist-new-entry-select"
                            :items="entryTypeOptions" item-title="title" item-value="value" :label="$tr('记录类型')" density="comfortable"
                            variant="outlined" hide-details :disabled="pendingTasks > 0 || inputPending"></v-select>
                    </v-col>
                    <v-col cols="12">
                        <StructureInput ref="structureInput" :key="newType" v-model="newSmiles"
                            :label="newType === 'reactions' ? $tr('禁用反应') : $tr('禁用化合物')"
                            :allow-files="allowMoleculeFiles" :disabled="pendingTasks > 0"
                            data-cy="banlist-new-smiles-input" />
                    </v-col>
                    <v-col cols="12">
                        <v-text-field v-model="newDesc" data-cy="banlist-new-description" :label="$tr('说明')" maxlength="150" autocomplete="off"
                            density="comfortable" variant="outlined" hide-details clearable :disabled="pendingTasks > 0"></v-text-field>
                    </v-col>
                </v-row>
            </v-card-text>
            <v-card-actions class="mb-2">
                <v-spacer></v-spacer>
                <v-btn color="primary" data-cy="banlist-new-submit" :disabled="pendingTasks > 0 || inputPending" @click="addEntry">{{ $tr('提交') }}</v-btn>
                <v-btn data-cy="banlist-new-cancel" text :disabled="pendingTasks > 0" @click="showBanItemDialog = false">{{ $tr('取消') }}</v-btn>
            </v-card-actions>
        </v-card>
    </WorkbenchDialog>
    <BanNotice v-model="noticeOpen" :message="notice" />
</template>

<script setup>
import { computed, ref, nextTick } from 'vue';
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import { API } from "@/common/api";
import BanNotice from "./BanNotice.vue";
import { uiText } from "@/i18n";

const showBanItemDialog = defineModel("showBanItemDialog", { required: true, default: false })
const pendingTasks = defineModel("pendingTasks", { required: true })
const activeTab = defineModel("activeTab", { required: true })
const emit = defineEmits(['loadCollection'])
const structureInput = ref(null);
const inputPending = computed(() => structureInput.value?.pending === true);
const newDesc = ref('');
const newActive = ref(true)
const newType = ref("chemicals");
const entryTypeOptions = computed(() => [
    { title: uiText("化合物"), value: "chemicals" },
    { title: uiText("反应"), value: "reactions" },
]);
const newSmiles = ref('');
const allowMoleculeFiles = computed(() =>
    newType.value === "chemicals" && !newSmiles.value.includes(">"),
);
const notice = ref(null), noticeOpen = ref(false);
const notify = (source, color) => { notice.value = { source, color }; noticeOpen.value = true; };

const addEntry = () => {
    if (pendingTasks.value > 0 || inputPending.value) return;
    if (!newSmiles.value) {
        notify("SMILES 为必填项。", "error");
        return;
    }

    pendingTasks.value++;

    const body = new URLSearchParams({
        description: newDesc.value || '无说明',
        smiles: newSmiles.value,
        active: newActive.value
    }).toString().replace(/\+/g, '%20');

    API.post(`/api/banlist/${newType.value}/post?${body}`)
        .then(() => {
            notify(newType.value === 'chemicals' ? "已成功添加化合物记录。" : "已成功添加反应记录。", "primary");
            emit("loadCollection", newType.value === 'chemicals' ? 'chemicals' : 'reactions');
            nextTick(() => {
                if (newType.value === 'chemicals') {
                    activeTab.value = 0;
                } else {
                    activeTab.value = 1;
                }
            });
            newSmiles.value = '';
            newDesc.value = '';
            showBanItemDialog.value = false;
        })
        .catch(() => {
            notify("添加记录失败，请重试。", "error");
        })
        .finally(() => {
            pendingTasks.value--;
        });
}

</script>
