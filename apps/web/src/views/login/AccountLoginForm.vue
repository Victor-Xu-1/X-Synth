<template>
  <main class="auth-page">
    <section class="auth-form" aria-labelledby="account-heading">
      <router-link class="auth-brand d-block" to="/">X-Synth</router-link>
      <h1 id="account-heading">{{ registering ? "创建账号" : title }}</h1>
      <template v-if="sso">
        <v-btn
          v-if="ssoAvailable"
          block
          color="primary"
          variant="outlined"
          prepend-icon="mdi-account-key-outline"
          :loading="ssoLoading"
          :disabled="busy"
          data-cy="keycloakLogin"
          @click="keycloakLogin"
          >单点登录</v-btn
        >
        <p v-else class="workspace-muted mb-4">当前工作区未启用单点登录。</p>
        <v-divider class="my-5" />
      </template>
      <v-form
        ref="form"
        :disabled="busy || ssoLoading"
        @submit.prevent="submit"
      >
        <v-text-field
          v-model="username"
          label="用户名"
          variant="outlined"
          autocomplete="username"
          :rules="usernameRules"
          data-cy="username"
          autofocus
        />
        <v-text-field
          v-model="password"
          label="密码"
          variant="outlined"
          :type="showPassword ? 'text' : 'password'"
          :autocomplete="registering ? 'new-password' : 'current-password'"
          :rules="passwordRules"
          data-cy="password"
        >
          <template #append-inner>
            <v-btn
              :icon="showPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
              size="small"
              variant="text"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              :disabled="busy || ssoLoading"
              @click="showPassword = !showPassword"
            />
          </template>
        </v-text-field>
        <v-text-field
          v-if="registering"
          v-model="email"
          :label="emailRequired ? '邮箱' : '邮箱（可选）'"
          variant="outlined"
          type="email"
          autocomplete="email"
          :rules="emailRules"
          data-cy="email"
        />
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-4"
          role="alert"
          data-cy="auth-error"
          >{{ errorMessage }}</v-alert
        >
        <p v-if="notice" class="workspace-muted mb-4" role="status">
          {{ notice }}
        </p>
        <v-btn
          block
          color="primary"
          variant="flat"
          type="submit"
          :loading="busy"
          :disabled="ssoLoading"
          :data-cy="registering ? 'signup-submit' : 'login'"
        >
          {{ registering ? "创建账号并登录" : "登录" }}
        </v-btn>
      </v-form>
      <div class="auth-navigation">
        <v-btn
          v-if="!admin"
          variant="text"
          :disabled="busy || ssoLoading"
          data-cy="signup"
          @click="toggleRegistration"
          >{{ registering ? "返回登录" : "创建账号" }}</v-btn
        >
        <v-btn v-if="admin" to="/login" variant="text">普通账号登录</v-btn>
        <v-btn
          to="/"
          variant="text"
          prepend-icon="mdi-arrow-left"
          :disabled="busy || ssoLoading"
        >
          {{ workspace.local ? "进入本机工作区" : "返回工作区" }}
        </v-btn>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { useConfigStore } from "@/store/config";
import { useWorkspaceStore } from "@/store/workspace";
import { safeAccountRedirect } from "./auth-navigation";

const props = defineProps({
  title: { type: String, default: "登录" },
  admin: { type: Boolean, default: false },
  sso: { type: Boolean, default: false },
});
const route = useRoute();
const router = useRouter();
const config = useConfigStore();
const workspace = useWorkspaceStore();
const keycloak = inject("$keycloak", null);
const form = ref(null);
const username = ref("");
const password = ref("");
const email = ref("");
const registering = ref(false);
const showPassword = ref(false);
const busy = ref(false);
const ssoLoading = ref(false);
const errorMessage = ref("");
const notice = ref("");
const emailRequired = computed(
  () => config.envs.VITE_EMAIL_REQUIRED === "True",
);
const ssoAvailable = computed(
  () =>
    workspace.can("native_account") && typeof keycloak?.login === "function",
);
const usernameRules = [
  (value) => Boolean(value?.trim()) || "请输入用户名",
  (value) =>
    !registering.value ||
    (value?.length >= 3 && value?.length <= 25) ||
    "用户名长度需为 3 到 25 个字符",
  (value) =>
    !registering.value ||
    /^[a-z][a-z\d]*_?[a-z\d]+$/i.test(value || "") ||
    "用户名需以字母开头，只能包含字母、数字和一个下划线",
];
const passwordRules = [(value) => Boolean(value) || "请输入密码"];
const emailRules = [
  (value) => !emailRequired.value || Boolean(value?.trim()) || "请输入邮箱",
  (value) =>
    !value ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
    "请输入有效的邮箱地址",
];

const destination = () =>
  props.admin
    ? "/admin"
    : safeAccountRedirect(
        route.query.redirect,
        safeAccountRedirect(localStorage.getItem("lastRoute")),
      );

const toggleRegistration = () => {
  registering.value = !registering.value;
  errorMessage.value = "";
  notice.value = "";
  form.value?.resetValidation();
};

const submit = async () => {
  if (busy.value || ssoLoading.value) return;
  busy.value = true;
  errorMessage.value = "";
  try {
    const validation = await form.value.validate();
    if (!validation.valid) return;
    if (registering.value) {
      const details = {
        username: username.value.trim(),
        password: password.value,
      };
      if (email.value.trim()) details.email = email.value.trim();
      await API.post("/api/user/register", details, true);
      registering.value = false;
      notice.value = "账号已创建，正在登录。";
    }
    const data = new FormData();
    data.append("username", username.value.trim());
    data.append("password", password.value);
    const response = await API.post("/api/admin/token", data);
    if (!response?.access_token)
      throw new Error("Authentication response is incomplete");
    localStorage.setItem("accessToken", response.access_token);
    localStorage.setItem("username", username.value.trim());
    localStorage.setItem("authProvider", "local");
    password.value = "";
    await workspace.refresh(true);
    await router.replace(destination());
  } catch {
    errorMessage.value = registering.value
      ? "注册失败，请检查账号信息与认证服务状态。"
      : "登录失败，请检查用户名、密码与认证服务状态。";
    if (notice.value) notice.value = "账号已创建，请重试登录。";
  } finally {
    busy.value = false;
  }
};

const keycloakLogin = async () => {
  if (!ssoAvailable.value || busy.value || ssoLoading.value) return;
  ssoLoading.value = true;
  errorMessage.value = "";
  try {
    const redirect = destination();
    const query = new URLSearchParams({
      redirect: encodeURIComponent(redirect),
    });
    sessionStorage.setItem("kc-login-initiated", "1");
    sessionStorage.setItem("kc-redirect", redirect);
    await keycloak.login({
      prompt: "login",
      redirectUri: `${window.location.origin}/sso-callback?${query}`,
    });
  } catch {
    sessionStorage.removeItem("kc-login-initiated");
    sessionStorage.removeItem("kc-redirect");
    errorMessage.value = "无法连接单点登录服务，请稍后重试。";
  } finally {
    ssoLoading.value = false;
  }
};

onMounted(() => workspace.refresh());
</script>

<style scoped>
.auth-form :deep(.v-btn),
.auth-form :deep(.v-field) {
  border-radius: 7px;
  letter-spacing: 0;
}
.auth-navigation {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
.auth-form h1 {
  overflow-wrap: anywhere;
}
</style>
