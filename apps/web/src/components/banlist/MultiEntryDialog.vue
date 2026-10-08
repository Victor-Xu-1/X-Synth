<template>
    <WorkbenchDialog v-model="showMultiEntryDialog" max-width="600px">
        <v-card>
            <v-card-title class="mt-2">
                <v-col cols="12">{{ $tr('上传禁用列表 JSON') }}</v-col>
            </v-card-title>
            <v-card-text>
                <v-row>
                    <v-col cols="12" class="mb-2">
                        <span> {{ $tr('上传包含多条禁用列表记录的 JSON 文件。') }} </span>
                    </v-col>
                </v-row>

                <v-row>
                    <v-col cols="12">
                        <v-file-input :label="$tr('JSON 文件')" v-model="multiUploadFile" accept="application/json,.json"
                            density="comfortable" variant="outlined" clearable></v-file-input>
                    </v-col>
                </v-row>

            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="blue darken-1" text @click="closeDialog">{{ $tr('关闭') }}</v-btn>
                <v-btn color="primary" data-cy="banlist-file-upload" text :disabled="!multiUploadFile" :loading="isUploading"
                    @click="uploadMultipleEntries">{{ $tr('上传') }}</v-btn>
            </v-card-actions>
        </v-card>
    </WorkbenchDialog>
    <BanNotice v-model="noticeOpen" :message="notice" />
</template>

<script setup>
import { ref } from 'vue';
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import { API } from "@/common/api";
import BanNotice from "./BanNotice.vue";

const showMultiEntryDialog = defineModel("showMultiEntryDialog", { required: true, default: false })
const pendingTasks = defineModel("pendingTasks", { required: true })
const emit = defineEmits(['loadCollection'])

const multiUploadFile = ref(null);
const isUploading = ref(false);
const notice = ref(null), noticeOpen = ref(false);
const notify = (source, values, color) => { notice.value = { source, values, color }; noticeOpen.value = true; };

const isReactionSmiles = (smiles) => {
    return smiles.includes('>>');
};

const closeDialog = () => {
    showMultiEntryDialog.value = false;
    multiUploadFile.value = null;
};

const uploadMultipleEntries = async () => {
    if (!multiUploadFile.value) return;

    isUploading.value = true;

    const file = multiUploadFile.value;
    pendingTasks.value++;

    const text = await file.text();
    let entries = null;

    if (text) {
        entries = JSON.parse(text);
    }
    if (!Array.isArray(entries)) {
        notify("JSON 格式无效，应为记录数组。", {}, "error");
        isUploading.value = false;
        multiUploadFile.value = null;
        pendingTasks.value--;
        return;
    }

    let chemicalSuccess = 0;
    let reactionSuccess = 0;
    let errorCount = 0;

    for (const entry of entries) {
        if (!entry.smiles) {
            errorCount++;
            continue;
        }

        const category = isReactionSmiles(entry.smiles) ? 'reactions' : 'chemicals';
        const body = new URLSearchParams({
            description: entry.description || 'no description',
            smiles: entry.smiles,
            active: entry.active !== undefined ? entry.active : true
        }).toString().replace(/\+/g, '%20');

        await API.post(`/api/banlist/${category}/post?${body}`)
            .then(() => {
                if (category === 'chemicals') chemicalSuccess++;
                else reactionSuccess++;
            })
            .catch(() => {
                errorCount++;
            });
    }

    if (chemicalSuccess > 0) emit("loadCollection", "chemicals");
    if (reactionSuccess > 0) emit("loadCollection", "reactions");

    const values = { chemicals: chemicalSuccess, reactions: reactionSuccess, failed: errorCount };
    if (errorCount === 0) {
        const source = chemicalSuccess > 0 && reactionSuccess > 0
            ? "已成功添加 {chemicals} 条化合物记录 和 {reactions} 条反应记录。"
            : chemicalSuccess > 0 ? "已成功添加 {chemicals} 条化合物记录。"
            : reactionSuccess > 0 ? "已成功添加 {reactions} 条反应记录。" : "已成功添加 。";
        notify(source, values, "primary");
        showMultiEntryDialog.value = false;
    } else {
        const source = chemicalSuccess > 0 && reactionSuccess > 0
            ? "已添加 {chemicals} 条化合物记录 和 {reactions} 条反应记录，{failed} 条记录失败。"
            : chemicalSuccess > 0 ? "已添加 {chemicals} 条化合物记录，{failed} 条记录失败。"
            : reactionSuccess > 0 ? "已添加 {reactions} 条反应记录，{failed} 条记录失败。" : "已添加 ，{failed} 条记录失败。";
        notify(source, values, "warning");
    }

    isUploading.value = false;
    multiUploadFile.value = null;
    pendingTasks.value--;
};
</script>
