<template>
    <module-workbench
        title="账号管理工作台"
        eyebrow="管理后台"
        icon="mdi-account-cog-outline"
        accent="blue-grey"
        description="管理 synon 用户账号、权限、登录状态和账号启停。"
        :summary-items="summaryItems"
    >
        <v-row class="justify-center">
            <v-col cols="12" md="12" xl="10">
                <div class="my-5">
                    <h5 class="text-h4 text-blue">你好，{{ username }}！</h5>
                </div>
            </v-col>
        </v-row>
        <v-row dense v-if="isAdmin && !dataLoading">
            <v-alert density="compact" type="warning" title="管理员操作提醒" class="my-2" closable>
                <template v-slot:text>
                    <p class="text-body-1">
                        管理员操作会影响其他用户的数据和账号状态，请确认后再执行。
                    </p>
                    <p class="text-body-1">1. 尊重其他用户的数据。</p>
                    <p class="text-body-1">2. 批量操作前先检查选择范围。</p>
                    <p class="text-body-1">3. 权限变更和删除操作需要谨慎执行。</p>
                </template>
            </v-alert>
            <v-col cols="12">
                <v-sheet rounded="lg" elevation="2" class="pa-5">
                    <v-data-table :headers="headers" :items="tableItems" multi-sort show-select v-model="selection"
                        item-value="username" height="500" :loading=dataLoading data-cy="admin-user-table">
                        <template v-slot:top>
                            <v-toolbar flat>
                                <v-toolbar-title>synon 用户</v-toolbar-title>
                                <v-select label="按账号类型筛选" density="comfortable" variant="outlined"
                                    hide-details clearable :items="filterOptions" item-text="title" item-value="key"
                                    v-model="filterSelected" class="mr-3" data-cy="admin-user-table-filter-by-account-type"></v-select>
                                <v-checkbox v-model="filterCreatedDate" data-cy="admin-user-table-show-older-30days" label="只显示 30 天未登录账号"
                                    hide-details></v-checkbox>
                                <v-menu location="end">
                                    <template v-slot:activator="{ props }">
                                        <v-btn color="primary" dark v-bind="props" append-icon="mdi-chevron-down"
                                            v-if="selection.length" variant="flat">
                                            批量操作
                                        </v-btn>
                                    </template>

                                    <v-list>
                                        <v-list-item v-if="showMakeAdminButton">
                                            <v-btn variant="tonal" data-cy="admin-user-bulk-make-admin" color="warning" @click="mutateAll('admin')">设为管理员</v-btn>
                                        </v-list-item>
                                        <v-list-item v-if="showMakeNormalButton">
                                            <v-btn variant="tonal" data-cy="admin-user-bulk-make-normal" color="primary" @click="mutateAll('normal')">设为普通用户</v-btn>
                                        </v-list-item>
                                        <v-list-item>
                                            <v-btn variant="tonal" data-cy="admin-user-bulk-unlock-selected" color="primary" @click="mutateAll('enable')">解锁选中账号</v-btn>
                                        </v-list-item>
                                        <v-list-item>
                                            <v-btn variant="tonal" data-cy="admin-user-bulk-lock-selected" color="primary" @click="mutateAll('disable')">锁定选中账号</v-btn>
                                        </v-list-item>
                                        <v-list-item>
                                            <v-btn variant="tonal" data-cy="admin-user-bulk-delete-selected" color="error" @click="mutateAll('delete')">删除选中账号</v-btn>
                                        </v-list-item>
                                    </v-list>
                                </v-menu>
                                <v-spacer></v-spacer>
                                <v-btn color="primary" variant="flat" prepend-icon="mdi-plus"
                                    @click="openDialogNewUser = true">新建用户</v-btn>
                            </v-toolbar>
                        </template>
                        <template v-slot:item.is_superuser="{ item }">
                            <span v-if="item.is_superuser === true">管理员</span>
                            <span v-else>非管理员</span>
                        </template>
                        <template v-slot:item.disabled="{ item }">
                            <span v-if="item.disabled === true">是</span>
                            <span v-else>否</span>
                        </template>
                        <template v-slot:item.accountType="{ item }">
                            <v-chip :color="getColor(item.accountType)">
                                {{ formatAccountType(item.accountType) }}
                            </v-chip>
                        </template>
                        <template v-slot:item.last_login="{ item }">
                            <span>{{ formatDateWithoutTimezone(item.last_login) }}</span>
                        </template>
                        <template v-slot:item.actions="{ item }">
                            <v-menu location="end">
                                <template v-slot:activator="{ props }">
                                    <v-btn color="primary" dark v-bind="props" append-icon="mdi-chevron-down"
                                        :disabled="selection.length !== 0">
                                        更多
                                    </v-btn>
                                </template>

                                <v-list>
                                    <v-list-item v-if="!(item.accountType === 'Guest' || item.accountType === 'Admin')">
                                        <v-btn variant="tonal" color="warning" data-cy="admin-user-single-make-admin"
                                            @click="mutate(item.username, 'admin')">设为管理员</v-btn>
                                    </v-list-item>
                                    <v-list-item
                                        v-if="!(item.accountType === 'Guest' || item.accountType === 'Normal')">
                                        <v-btn variant="tonal" color="primary" data-cy="admin-user-single-make-normal"
                                            @click="mutate(item.username, 'normal')">设为普通用户</v-btn>
                                    </v-list-item>
                                    <v-list-item v-if="!(item.disabled === false)">
                                        <v-btn variant="tonal" color="primary" data-cy="admin-user-single-unlock-selected"
                                            @click="mutate(item.username, 'enable')">解锁账号</v-btn>
                                    </v-list-item>
                                    <v-list-item v-if="!(item.disabled === true)">
                                        <v-btn variant="tonal" color="primary" data-cy="admin-user-single-lock-selected"
                                            @click="mutate(item.username, 'disable')">锁定账号</v-btn>
                                    </v-list-item>
                                    <v-list-item v-if="!(item.accountType === 'Guest')">
                                        <v-btn variant="tonal" color="primary" data-cy="admin-user-single-change-password"
                                            @click="mutate(item.username, 'pwd')">修改密码</v-btn>
                                    </v-list-item>
                                    <v-list-item v-if="!(item.accountType === 'Guest')">
                                        <v-btn variant="tonal" color="primary" data-cy="admin-user-single-change-email"
                                            @click="mutate(item.username, 'email')">修改邮箱</v-btn>
                                    </v-list-item>
                                    <v-list-item>
                                        <v-btn variant="tonal" color="error" data-cy="admin-user-single-delete-account"
                                            @click="mutate(item.username, 'delete')">删除账号</v-btn>
                                    </v-list-item>
                                </v-list>
                            </v-menu>
                        </template>
                    </v-data-table>
                </v-sheet>
            </v-col>
        </v-row>
        <v-row class="d-flex flex-row justify-center align-center" v-if="!isAdmin && !dataLoading">
            <v-col cols="12" sm="3">
                <v-sheet class="pa-5 rounded-lg" elevation="2">
                    <h4 class="text-h4">个人资料</h4>
                    <v-divider></v-divider>
                    <div class="d-flex flex-column justify-center align-center mt-1">
                        <v-img :src="wp" width="200" style="border-radius: 50%;"></v-img>
                    </div>
                </v-sheet>
            </v-col>
            <v-col cols="12" sm="4" class="d-flex flex-row justify-center align-center">
                <v-sheet class="pa-5 rounded-lg" elevation="2">
                    <h4 class="text-h4">邮箱</h4>
                    <v-divider></v-divider>
                    <p class="text-body-1" data-cy="admin-get-email-address-normal-user">{{ userEmail }}</p>
                    <v-btn color="warning" data-cy="admin-change-email-normal-user" class="mr-2" @click="mutate(username, 'email')" size="small">更新邮箱</v-btn>
                    <h4 class="mt-4 text-h4">密码</h4>
                    <v-divider></v-divider>
                    <p class="text-body-1">上次登录：
                        <timeago :datetime="userLastLogin" :converter-options="{
                        includeSeconds: true,
                        addSuffix: false,
                        useStrict: false,
                    }" auto-update v-if="userLastLogin" />
                        <span v-else>暂无记录</span>
                    </p>
                    <v-btn color="warning" class="mr-2" data-cy="admin-change-password-normal-user" @click="mutate(username, 'pwd')" size="small">修改密码</v-btn>
                    <v-alert text="如需删除当前账号，可以点击下方按钮。"
                        title="危险操作" type="warning" class="mt-2" density="compact" color="#FF0000"
                        variant="outlined"></v-alert>
                    <v-btn color="error" data-cy="admin-delete-normal-user" @click="mutate(username, 'delete')" size="small" class="mt-2">删除账号</v-btn>
                </v-sheet>
            </v-col>
        </v-row>
        <loader v-if="dataLoading" />
    </module-workbench>
    <new-user-dialog-box v-model:openDialog="openDialogNewUser" />
    <edit-user-dialog-box v-model:openDialog="openDialogEditEmail" v-model:value="newEmail" @updateValue="changeEmail()"
        label="邮箱" />
    <edit-user-dialog-box v-model:openDialog="openDialogEditPassword" v-model:value="newPassword"
        @updateValue="changePassword()" label="密码" :hide="true" />

</template>

<script setup>
import EditUserDialogBox from "@/components/admin/EditUserDialogBox"
import NewUserDialogBox from "@/components/admin/NewUserDialogBox"
import Loader from "@/components/admin/Loader"
import { ref, onMounted, computed } from 'vue'
import { API } from "@/common/api";
import { useSnackbar } from 'vuetify-use-dialog';
import wp from "@/assets/wp.png"
import ModuleWorkbench from "@/components/ModuleWorkbench.vue"

const createSnackbar = useSnackbar()
const summaryItems = [
    { label: "用户", value: "账号、邮箱和权限", icon: "mdi-account-group-outline" },
    { label: "权限", value: "管理员、普通用户、访客", icon: "mdi-shield-account-outline" },
    { label: "操作", value: "新建、锁定、解锁、删除", icon: "mdi-account-edit-outline" },
]
const username = ref(localStorage.getItem('username'))
const userEmail = ref('')
const userLastLogin = ref('')
const newPassword = ref('')
const newEmail = ref('')
const selectedUser = ref('')
const isAdmin = ref(false)
const users = ref([])
const selection = ref([]);
const filterOptions = ref([
    { key: 'Guest', title: '访客' },
    { key: 'Normal', title: '普通用户' },
    { key: 'Admin', title: '管理员' },
]);
const headers = ref([
    { title: '用户名', key: 'username' },
    { title: '邮箱', key: 'email' },
    { title: '账号类型', key: 'accountType' },
    { title: '已禁用', key: 'disabled' },
    { title: '上次登录', key: 'last_login' },
    { title: '操作', key: 'actions', align: 'center' },
])
const openDialogNewUser = ref(false)
const openDialogEditPassword = ref(false)
const openDialogEditEmail = ref(false)
const usersDict = ref({})
const filterSelected = ref(null)
const filterCreatedDate = ref(false)
const dataLoading = ref(true)

const tableItems = computed(() => {
    const daysOld = 30;
    const currentDate = new Date();
    let items = users.value;
    if (filterSelected.value !== null) {
        items = items.filter(item => item.accountType === filterSelected.value);
    }
    if (filterCreatedDate.value === true) {
        items = items.filter(item => {
            const itemDate = new Date(item.last_login);
            const diffTime = Math.abs(currentDate - itemDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays > daysOld;
        });
    }
    return items;
})

const formatDateWithoutTimezone = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const options = {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    };
    return date.toLocaleString('zh-CN', options);
};

const changePassword = async () => {
    openDialogEditPassword.value = false;
    await API.post('/api/user/reset-password', { username: selectedUser.value, password: newPassword.value }, true)
        .then(async response => {
            console.log(response.Error)
            if (response === "OK") {
                await fetchData()
                createSnackbar({ text: "密码已更新。", snackbarProps: { timeout: 3000 } });
            }
        })
        .catch((err) => {
            const match = err.toString().match(/"detail":"([^"]+)"/);
            const detail = match[1];
            createSnackbar({ text: `修改密码失败：${detail}`, snackbarProps: { timeout: 3000 } });
        }).finally(() => {
            selectedUser.value = "";
            newPassword.value = "";
        })
}


const changeEmail = async () => {
    openDialogEditEmail.value = false;
    await API.post('/api/user/update', { username: selectedUser.value, email: newEmail.value }, true)
        .then(async response => {
            console.log(response.Error)
            if (response === "OK") {
                await fetchData()
                createSnackbar({ text: "邮箱已更新。", snackbarProps: { timeout: 3000 } });
            }
        })
        .catch((err) => {
            const match = err.toString().match(/"detail":"([^"]+)"/);
            const detail = match[1];
            createSnackbar({ text: `修改邮箱失败：${detail}`, snackbarProps: { timeout: 3000 } });
        }).finally(() => {
            selectedUser.value = "";
            newEmail.value = "";
        })
}


onMounted(async () => {
    await fetchData()
})

const fetchData = async () => {
    dataLoading.value = true
    try {
        // check if the username is admin
        isAdmin.value = await API.get("/api/user/am-i-superuser", null, false);

        usersDict.value = {};

        if (isAdmin.value) {
            let response = await API.get("/api/user/get-all-users", null, false);
            if (Array.isArray(response)) {
                response.forEach((user) => {
                    usersDict.value[user.username] = user;
                    if (user.username.startsWith('guest_')) {
                        usersDict.value[user.username].accountType = "Guest"
                    } else if (user.is_superuser) {
                        usersDict.value[user.username].accountType = "Admin"
                    } else {
                        usersDict.value[user.username].accountType = "Normal"
                    }
                })
                users.value = Object.values(usersDict.value)
            } else {
                console.error("API did not return an array as expected:", response);
            }
        } else {
            let response = await API.get("/api/user/get-current-user", null, false);
            if (response) {
                userEmail.value = response.email
                userLastLogin.value = response.last_login
            }
        }
    } catch (error) {
        console.error("Error fetching users:", error);
    } finally {
        dataLoading.value = false;
    }
}

const mutate = async (username, method) => {
    try {
        let response;
        switch (method) {
            case 'email':
                openDialogEditEmail.value = true;
                selectedUser.value = username;
                break;
            case 'pwd':
                openDialogEditPassword.value = true;
                selectedUser.value = username;
                break;
            case 'admin':
                response = await API.get('/api/user/promote', { username: username }, true);
                break;
            case 'normal':
                response = await API.get('/api/user/demote', { username: username }, true);
                break;
            case 'disable':
                response = await API.post('/api/user/update', { username: username, disabled: true }, true);
                break;
            case 'enable':
                response = await API.post('/api/user/update', { username: username, disabled: false }, true);
                break;
            case 'delete':
                response = await API.delete('/api/user/delete', { username: username }, true);
                break;
        }

        if (response && response === "OK") {
            await fetchData();
            createSnackbar({ text: `用户操作已完成。`, snackbarProps: { timeout: 3000 } });
        }
    } catch (err) {
        const match = err.toString().match(/"detail":"([^"]+)"/);
        const detail = match ? match[1] : 'Unknown error';
        createSnackbar({ text: `用户操作失败：${detail}`, snackbarProps: { timeout: 3000 } });
    }
};

const mutateAll = async (method) => {
    try {
        const promises = selection.value.map(username => mutate(username, method));
        await Promise.all(promises);
        if (method === 'delete') {
            selection.value = [];
        }
    } catch (error) {
        console.error(`Error in bulk ${method}:`, error);
    }
};

const showMakeAdminButton = computed(() => {
    return selection.value.some(username =>
        usersDict.value[username].accountType === 'Normal'
    ) && !selection.value.some(username =>
        usersDict.value[username].accountType === 'Admin'
    );
});

const showMakeNormalButton = computed(() => {
    return selection.value.some(username =>
        usersDict.value[username].accountType === 'Admin'
    ) && !selection.value.some(username =>
        usersDict.value[username].accountType === 'Normal'
    );
});

const getColor = (type) => {
    if (type === "Admin") return 'primary'
    if (type === "Normal") return 'blue'
    else return 'orange'
}

const formatAccountType = (type) => {
    if (type === "Admin") return "管理员"
    if (type === "Normal") return "普通用户"
    if (type === "Guest") return "访客"
    return type
}
</script>
