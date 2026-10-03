<template>
    <div ref='vantaRef' style="height: 100vh" class="d-flex justify-center align-center">
        <v-container fluid>
            <v-row class="d-flex justify-center align-center px-16">
                <v-col cols="12" sm="6" md="4" lg="3" xl="3">
                    <v-fade-transition>
                        <v-card elevation="10" rounded="lg" min-width="200px">
                            <v-card-title class="text-center">
                                <h4 class="text-h4">管理员登录</h4>
                            </v-card-title>
                            <v-card-text class="pa-5">
                                <v-form ref="form" @submit.prevent>
                                    <v-text-field label="用户名" variant="outlined" v-model="username"
                                        :rules="usernameRules" clearable></v-text-field>
                                    <v-text-field label="密码" variant="outlined" required
                                        :type="showPassword ? 'text' : 'password'" v-model="password"
                                        :rules="passwordRules" clearable
                                        :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                                        @click:append-inner="showPassword = !showPassword"></v-text-field>
                                    <div v-if="loginFailure" class="text-red text-center text-subtitle-1">
                                        <p>用户名或密码不正确。</p>
                                    </div>
                                </v-form>
                            </v-card-text>
                            <v-card-actions>
                                <v-btn color="primary" size="x-large" @click="login" type="submit" variant="flat"
                                    width="100%">
                                    登录
                                </v-btn>
                            </v-card-actions>
                        </v-card>
                    </v-fade-transition>
                </v-col>
            </v-row>
        </v-container>
    </div>
</template>

<script setup>
import * as THREE from "three";
import RINGS from 'vanta/dist/vanta.rings.min'
import { ref, onMounted } from 'vue';
import { API } from "@/common/api";
import { useRouter } from "vue-router";

const vantaRef = ref(null);
const username = ref(null);
const password = ref(null);
const loginFailure = ref(false);
const showPassword = ref(false);
const router = useRouter();

const usernameRules = ref([
    value => {
        if (value) return true
        return '用户名为必填项'
    },
])

const passwordRules = ref([
    value => {
        if (value) return true
        return '密码为必填项'
    },
])

onMounted(() => {
    RINGS({
        el: vantaRef.value,
        THREE: THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        size: 0.50,
        baseColor: 0x1a59,
        backgroundColor: 0xd0d2a
    })
})

const login = () => {
    if (!username.value || !password.value) {
        return
    }
    loginFailure.value = false;
    const formData = new FormData();
    formData.append("username", username.value);
    formData.append("password", password.value);

    API.post('/api/admin/token', formData).then(json => {
        // Store the token in local storage
        localStorage.setItem('accessToken', json.access_token);
        localStorage.setItem('username', username.value);
        // object with path

        router.push('/admin');

    }).catch(() => {
        loginFailure.value = true;
    })
}
</script>
