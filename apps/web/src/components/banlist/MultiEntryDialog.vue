<template>
    <WorkbenchDialog v-model="showMultiEntryDialog" max-width="600px">
        <v-card>
            <v-card-title class="mt-2">
                <v-col cols="12">上传禁用列表 JSON</v-col>
            </v-card-title>
            <v-card-text>
                <v-row>
                    <v-col cols="12" class="mb-2">
                        <span>
                            上传包含多条禁用列表记录的 JSON 文件。
                        </span>
                    </v-col>
                </v-row>

                <v-row>
                    <v-col cols="12">
                        <v-file-input label="JSON 文件" v-model="multiUploadFile" accept="application/json,.json"
                            density="comfortable" variant="outlined" clearable></v-file-input>
                    </v-col>
                </v-row>

            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="blue darken-1" text @click="closeDialog">关闭</v-btn>
                <v-btn color="primary" data-cy="banlist-file-upload" text :disabled="!multiUploadFile" :loading="isUploading"
                    @click="uploadMultipleEntries">上传</v-btn>
            </v-card-actions>
        </v-card>
    </WorkbenchDialog>
</template>

<script setup>
import { ref } from 'vue';
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import { API } from "@/common/api";
import { useSnackbar } from 'vuetify-use-dialog';

const showMultiEntryDialog = defineModel("showMultiEntryDialog", { required: true, default: false })
const pendingTasks = defineModel("pendingTasks", { required: true })
const emit = defineEmits(['loadCollection'])

const multiUploadFile = ref(null);
const isUploading = ref(false);
const createSnackbar = useSnackbar();

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
        createSnackbar({ text: "JSON 格式无效，应为记录数组。", snackbarProps: { color: 'error', timeout: 3000 } });
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

    const successParts = [];
    if (chemicalSuccess > 0) successParts.push(`${chemicalSuccess} 条化合物记录`);
    if (reactionSuccess > 0) successParts.push(`${reactionSuccess} 条反应记录`);
    const successMsg = successParts.join(' 和 ');

    if (errorCount === 0) {
        createSnackbar({ text: `已成功添加 ${successMsg}。`, snackbarProps: { color: 'primary', timeout: 3000 } });
        showMultiEntryDialog.value = false;
    } else {
        createSnackbar({ text: `已添加 ${successMsg}，${errorCount} 条记录失败。`, snackbarProps: { color: 'warning', timeout: 3000 } });
    }

    isUploading.value = false;
    multiUploadFile.value = null;
    pendingTasks.value--;
};
</script>
