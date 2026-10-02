<template>
    <div>
        <div ref="vantaRef" style="height: 100vh" class="d-flex justify-center align-center overflow-auto">
            <v-container fluid>
                <v-row class="d-flex justify-space-between align-center px-16">
                    <v-col cols="12" md="6" lg="5" class="d-flex justify-center align-center flex-column">
                        <div>
                            <h1 class="text-h1 font-weight-bold text-white">X-Synth</h1>
                            <h6 class="text-h6 font-weight-bold text-white">
                                合成设计与逆合成分析工作台
                            </h6>
                        </div>
                    </v-col>
                    <v-col cols="12" md="6" lg="4" xl="3" class="d-flex justify-center align-center">
                        <v-sheet elevation="10" rounded="lg">
                            <v-form ref="form" class="pa-5" @submit.prevent>
                                <v-text-field label="用户名" variant="outlined" v-model="username"
                                    :rules="usernameRules" clearable data-cy="username"
                                    v-show="!showNextStep"></v-text-field>
                                <v-text-field :label="emailRequired ? '邮箱（必填）' : '邮箱（可选）'"
                                    variant="outlined" v-model="email" clearable data-cy="email" v-show="showNextStep"
                                    :rules="emailRequired ? emailRules : []"></v-text-field>
                                <v-text-field label="密码" variant="outlined" required
                                    :type="showPassword ? 'text' : 'password'" v-model="password" :rules="passwordRules"
                                    clearable data-cy="password" v-show="!showNextStep"
                                    :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                                    @click:append-inner="showPassword = !showPassword"></v-text-field>
                                <v-text-field label="公司（可选）" variant="outlined" v-model="company" clearable
                                    data-cy="company" v-show="showNextStep"></v-text-field>
                                <div v-if="loginFailure" class="text-red text-center text-subtitle-1"
                                    v-show="!showNextStep">
                                    <p>用户名或密码不正确。</p>
                                </div>
                                <div v-if="guestFailure" class="text-red text-center text-subtitle-1"
                                    v-show="!showNextStep">
                                    <p>访客账号创建失败，请检查后端服务状态后重试。</p>
                                </div>
                                <div class="d-flex flex-column">
                                    <v-container>
                                        <v-row wrap no-gutters v-show="!showNextStep">
                                            <v-col cols="6" class="text-center">
                                                <v-btn color="primary" size="x-large" @click="login" type="submit"
                                                    variant="flat" data-cy="login">
                                                    登录
                                                </v-btn>
                                            </v-col>
                                            <v-col cols="6" class="text-center">
                                                <v-btn color="primary" size="x-large" @click="showNextSignup"
                                                    type="submit" variant="flat" data-cy="signup">
                                                    注册
                                                </v-btn>
                                            </v-col>
                                        </v-row>
                                        <v-row wrap no-gutters v-show="showNextStep">
                                            <v-col cols="6" class="text-center">
                                                <v-btn color="primary" size="x-large" @click="showNextStep = false"
                                                    type="submit" variant="flat" data-cy="signup">
                                                    返回
                                                </v-btn>
                                            </v-col>
                                            <v-col cols="6" class="text-center">
                                                <v-btn color="primary" size="x-large" @click="signup" type="submit"
                                                    variant="flat" data-cy="signup">
                                                    完成
                                                </v-btn>
                                            </v-col>
                                        </v-row>
                                    </v-container>
                                    <v-divider class="my-4"> </v-divider>
                                    <v-btn color="primary" size="x-large" block variant="tonal"
                                        @click="guestAccountSignup" :disabled="waitGuest" :loading="waitGuest"
                                        data-cy="guestSignup">
                                        {{ waitGuest ? "正在创建访客账号" : "以访客身份继续" }}
                                    </v-btn>
                                </div>
                            </v-form>
                        </v-sheet>
                    </v-col>
                </v-row>
            </v-container>
        </div>
        <v-dialog v-model="showSignupDialog" width="auto">
            <v-sheet elevation="2" max-width="600" rounded="lg" width="100%" class="pa-4 text-center mx-auto">
                <div v-if="!createdAccount && !creationFailure">
                    <v-progress-linear indeterminate color="primary"></v-progress-linear>
                    <h2 class="text-h5 my-6">正在创建账户，请稍候...</h2>
                </div>
                <div v-if="createdAccount && !creationFailure">
                    <v-icon class="mb-5" color="primary" icon="mdi-check-circle" size="112"></v-icon>
                    <h2 class="text-h5 mb-6">注册成功。</h2>
                </div>
                <div v-if="creationFailure">
                    <v-icon class="mb-5" color="warning" icon="mdi-alert-circle" size="112"></v-icon>
                    <h2 class="text-h5 mb-6">注册失败。</h2>
                    <v-divider class="mb-4"></v-divider>
                    <div class="text-end">
                        <v-btn class="text-none" color="primary" variant="flat" width="90"
                            :disabled="!createdAccount && !creationFailure" @click="closeSignup">
                            关闭
                        </v-btn>
                    </div>
                </div>
            </v-sheet>
        </v-dialog>
    </div>
</template>

<script setup>
defineOptions({ name: 'LoginView' })
import * as THREE from "three";
import HALO from "vanta/dist/vanta.halo.min";
import { ref, onMounted, computed } from "vue";
import { API } from "@/common/api";
import { useRoute, useRouter } from "vue-router";
import { useConfigStore } from "@/store/config";
import { useConfirm } from "vuetify-use-dialog";

const vantaRef = ref(null);
const username = ref(null);
const password = ref(null);
const email = ref(null);
const company = ref(null);
const showSignupDialog = ref(false);
const createdAccount = ref(false);
const creationFailure = ref(false);
const loginFailure = ref(false);
const guestFailure = ref(false);
const showPassword = ref(false);
const route = useRoute();
const router = useRouter();
const waitGuest = ref(false);
const showNextStep = ref(false);
const configStore = useConfigStore();
const createConfirm = useConfirm();
const emailRequired = computed({
    get: () => configStore.envs.VITE_EMAIL_REQUIRED === "True",
});

const emailRules = ref([
    (value) => {
        if (value) return true;
        return "邮箱为必填项";
    },
]);

const usernameRules = ref([
    (value) => {
        if (value) return true;
        return "用户名为必填项";
    },
    (value) => {
        if (value.length >= 3 && value.length <= 25) return true;
        return "用户名长度需为 3 到 25 个字符";
    },
    (value) => {
        if (/^[a-z][a-z\d]*_?[a-z\d]+$/i.test(value)) return true;
        return "用户名需以字母开头，且只能包含字母、数字和一个下划线";
    },
    // Add SSO login check in the future (No _sso)
]);

const passwordRules = ref([
    (value) => {
        if (value) return true;
        return "密码为必填项";
    },
]);

onMounted(() => {
    HALO({
        el: vantaRef.value,
        THREE: THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        size: 0.5,
        baseColor: 0x1a59,
        backgroundColor: 0x2035b1,
    });
});

const login = () => {
    if (!username.value || !password.value) {
        return Promise.resolve(false);
    }
    loginFailure.value = false;
    guestFailure.value = false;
    const formData = new FormData();
    formData.append("username", username.value);
    formData.append("password", password.value);

    return API.post("/api/admin/token", formData)
        .then((json) => {
            // Store the token in local storage
            localStorage.setItem("accessToken", json.access_token);
            localStorage.setItem("username", username.value);
            localStorage.setItem("authProvider", "local");
            // object with path
            const urlParams = route.query;
            const redirect = urlParams.redirect;

            if (redirect) {
                router.push(decodeURIComponent(redirect));
            } else {
                const lastRoute = localStorage.getItem("lastRoute") || "/";
                router.push(lastRoute);
            }
            return true;
        })
        .catch((error) => {
            if (error.message === "Unauthorized") {
                loginFailure.value = true;
            } else {
                createConfirm({
                    title: "提示",
                    content: "内部服务错误，请稍后重试。",
                    dialogProps: { width: "auto", confirmText: "确定", showCancel: false },
                });
            }
            return false;
        });
};

const rememberGuestCredentials = (guestUsername, guestPassword) => {
    localStorage.setItem("guestAccount", "true");
    localStorage.setItem("guestUsername", guestUsername);
    localStorage.removeItem("guestPassword");
};

const signup = () => {
    if (
        !username.value ||
        !password.value ||
        (emailRequired.value && !email.value)
    ) {
        return;
    }

    // showNextStep dialog for creation of user
    createdAccount.value = false;
    creationFailure.value = false;
    loginFailure.value = false;
    showSignupDialog.value = true;

    const formData = new FormData();
    formData.append("username", username.value);
    formData.append("password", password.value);
    if (emailRequired.value && email.value) {
        formData.append("email", email.value);
    }

    API.post("/api/user/register", formData, true)
        .then(() => {
            createdAccount.value = true;
            localStorage.setItem("newAccount", "true");
            login();
        })
        .catch(() => {
            creationFailure.value = true;
        });
};

const showNextSignup = () => {
    if (!username.value || !password.value) {
        return;
    }
    showNextStep.value = true;
};

const guestAccountSignup = async () => {
    if (waitGuest.value) {
        return;
    }
    waitGuest.value = true;
    guestFailure.value = false;
    loginFailure.value = false;

    const randomIdUserName = crypto.randomUUID().replaceAll("-", "");
    const randomIdPassword = crypto.randomUUID().replaceAll("-", "");
    const guestUsername = "guest_" + randomIdUserName;
    const guestPassword = randomIdPassword;

    try {
        await API.post("/api/user/register", {
            username: guestUsername,
            password: guestPassword,
        }, true);
        username.value = guestUsername;
        password.value = guestPassword;
        rememberGuestCredentials(guestUsername, guestPassword);
        await login();
    } catch {
        guestFailure.value = true;
        creationFailure.value = true;
    } finally {
        waitGuest.value = false;
    }
};

const closeSignup = () => {
    showSignupDialog.value = false;
};
</script>
