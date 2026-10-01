<template>
    <v-dialog width="500px" v-model="openDialog">
        <v-card prepend-icon="mdi-pencil" :title="'编辑 ' + props.label">
            <v-divider />
            <v-card-text>
                <v-text-field v-model="value" data-cy="admin-edit-user-value" variant="outlined" :label="props.label" hide-details clearable
                    :type="hide ? 'password' : ''"></v-text-field>
            </v-card-text>
            <v-divider />
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn variant="tonal" data-cy="openDialog-close" @click="openDialog = false">关闭</v-btn>
                <v-btn variant="tonal" color="primary" data-cy="openDialog-submit" @click="$emit('updateValue', value)">提交</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup>
const openDialog = defineModel("openDialog", { default: false, required: true })
const value = defineModel("value", { required: true })
const props = defineProps({ label: { type: String, required: true }, hide: { type: Boolean, default: false } })
</script>
