<template>
    <v-dialog v-model="showBanItemDialog" max-width="600px">
        <v-card>
            <v-card-title class="mt-2">
                <v-col cols="12">新增禁用列表记录</v-col></v-card-title>

            <v-card-text class="text-justify">
                <v-row>
                    <v-col cols="12">
                        <v-select v-model="newType" data-cy="banlist-new-entry-select"
                            :items="entryTypeOptions" item-title="title" item-value="value" label="记录类型" density="comfortable"
                            variant="outlined" hide-details clearable></v-select>
                    </v-col>
                    <v-col cols="12">
                        <v-text-field v-model="newSmiles" label="SMILES" data-cy="banlist-new-smiles-input" maxlength="150" autocomplete="off"
                            density="comfortable" variant="outlined" hide-details clearable>
                            <template v-slot:append-inner>
                                <v-btn variant="tonal" data-cy="banlist-new-draw" prepend-icon="mdi mdi-pencil"
                                    @click="openKetcher(newSmiles)">绘制</v-btn>
                            </template>
                        </v-text-field>
                    </v-col>
                    <v-col cols="12" v-if="!!newSmiles">
                        <smiles-image :smiles="newSmiles" height="100px"></smiles-image>
                    </v-col>
                    <v-col cols="12">
                        <v-text-field v-model="newDesc" data-cy="banlist-new-description" label="说明" maxlength="150" autocomplete="off"
                            density="comfortable" variant="outlined" hide-details clearable></v-text-field>
                    </v-col>
                </v-row>
            </v-card-text>
            <v-card-actions class="mb-2">
                <v-spacer></v-spacer>
                <v-btn color="primary" data-cy="banlist-new-submit" @click="addEntry">提交</v-btn>
                <v-btn data-cy="banlist-new-cancel" text @click="showBanItemDialog = false">取消</v-btn>
            </v-card-actions>
        </v-card>
        <ketcher-modal ref="ketcherRef" v-model="showKetcher" :smiles="newSmiles" @input="showKetcher = false"
            @update:smiles="updateSmiles" />
    </v-dialog>
</template>

<script setup>
import { ref, nextTick } from 'vue';
import KetcherModal from "@/components/KetcherModal";
import { API } from "@/common/api";
import SmilesImage from "@/components/SmilesImage";
import { useSnackbar } from 'vuetify-use-dialog';

const showBanItemDialog = defineModel("showBanItemDialog", { required: true, default: false })
const pendingTasks = defineModel("pendingTasks", { required: true })
const activeTab = defineModel("activeTab", { required: true })
const emit = defineEmits(['loadCollection'])
const ketcherRef = ref(null);
const showKetcher = ref(false);
const newDesc = ref('');
const newActive = ref(true)
const newType = ref("chemicals");
const entryTypeOptions = [
    { title: "化合物", value: "chemicals" },
    { title: "反应", value: "reactions" },
];
const newSmiles = ref('');
const createSnackbar = useSnackbar();

const addEntry = () => {
    if (!newSmiles.value) {
        createSnackbar({ text: "SMILES 为必填项。", snackbarProps: { color: 'error', timeout: 3000 } });
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
            createSnackbar({ text: `已成功添加${newType.value === 'chemicals' ? '化合物' : '反应'}记录。`, snackbarProps: { color: 'primary', timeout: 3000 } });
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
            createSnackbar({ text: "添加记录失败，请重试。", snackbarProps: { color: 'error', timeout: 3000 } });
        })
        .finally(() => {
            pendingTasks.value--;
        });
}

const openKetcher = (source) => {
    newSmiles.value = source;
    showKetcher.value = true;
    ketcherRef.value.smilesToKetcher();
};

const updateSmiles = (source) => {
    newSmiles.value = source;
}
</script>
