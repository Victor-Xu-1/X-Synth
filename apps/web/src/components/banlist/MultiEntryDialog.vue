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
                            density="comfortable" variant="outlined" :disabled="disabled" clearable></v-file-input>
                    </v-col>
                </v-row>

            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="blue darken-1" text @click="closeDialog">{{ $tr('关闭') }}</v-btn>
                <v-btn color="primary" data-cy="banlist-file-upload" text :disabled="disabled || !multiUploadFile" :loading="isUploading"
                    @click="uploadMultipleEntries">{{ $tr('上传') }}</v-btn>
            </v-card-actions>
        </v-card>
    </WorkbenchDialog>
    <BanNotice v-model="noticeOpen" :message="notice" />
</template>

<script setup>
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import BanNotice from "./BanNotice.vue";
import { useRuleOwnerScope } from "./rule-owner-scope";
import { useRuleUpload } from "./useRuleUpload";

const showMultiEntryDialog = defineModel("showMultiEntryDialog", { required: true, default: false })
const emit = defineEmits(['loadCollection'])
const { multiUploadFile, isUploading, notice, noticeOpen, disabled, closeDialog, uploadMultipleEntries } =
    useRuleUpload({ scope: useRuleOwnerScope(), show: showMultiEntryDialog,
        publish: (category, ticket) => emit("loadCollection", category, ticket) });
</script>
