<template>
    <v-dialog v-model="openDialog" max-width="600px">
        <v-card prepend-icon="mdi-account" title="新增用户">
            <v-divider />
            <v-card-text>
                <v-text-field v-model="newUsername" variant="outlined" label="用户名" data-cy="admin-newUser-username" hide-details clearable
                    class="my-2"></v-text-field>
                <v-text-field v-model="newEmail" variant="outlined" label="邮箱" data-cy="admin-newUser-email" hide-details clearable
                    class="my-2"></v-text-field>
                <v-text-field v-model="newPassword" variant="outlined" label="密码" type="password" data-cy="admin-newUser-password" hide-details
                    clearable class="my-2"></v-text-field>
                <v-checkbox label="设为管理员" v-model="newSuperuser" data-cy="admin-newUser-makeAdmin-checkbox" class="my-2"></v-checkbox>
            </v-card-text>
            <v-divider />
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn variant="tonal" @click="openDialog = false">关闭</v-btn>
                <v-btn variant="tonal" data-cy="admin-newUser-submit" color="primary" @click="addUser()">提交</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup>
import { useSnackbar } from 'vuetify-use-dialog';
import { API } from "@/common/api";
import { ref } from 'vue'

const openDialog = defineModel("openDialog", { default: false, required: true })
const emit = defineEmits(["refresh-users"])
const newUsername = ref('')
const newPassword = ref('')
const newEmail = ref('')
const newSuperuser = ref(false)

const createSnackbar = useSnackbar()
const addUser = () => {
    if (!newUsername.value || !newPassword.value || !newEmail.value) {
        createSnackbar({ text: "请填写全部字段。", snackbarProps: { timeout: 3000 } });
        return;
    }

    let body = {
        username: newUsername.value,
        password: newPassword.value,
        email: newEmail.value,
        is_superuser: newSuperuser.value,
    };

    API.post('/api/user/register', body, true)
        .then(async response => {
            console.log(response.Error)
            if (response === "OK") {
                emit("refresh-users")
                createSnackbar({ text: "用户已添加。", snackbarProps: { timeout: 3000 } });
                clearUserFields();
            }
        })
        .catch((err) => {
            const match = err.toString().match(/"detail":"([^"]+)"/);
            const detail = match ? match[1] : "未知错误";
            createSnackbar({ text: `添加用户失败：${detail}`, snackbarProps: { timeout: 3000 } });
            clearUserFields();
        })
        .finally(() => {
            openDialog.value = false;
        });
};

const clearUserFields = () => {
    newUsername.value = '';
    newPassword.value = '';
    newEmail.value = '';
    newSuperuser.value = false;
};
</script>
