<template>
  <main class="auth-page">
    <section class="auth-form">
      <router-link class="auth-brand d-block" to="/">X-Synth</router-link>
      <h1>单点登录</h1>
      <div v-if="loading" role="status" class="d-flex align-center ga-3">
        <v-progress-circular
          indeterminate
          color="primary"
          size="24"
          width="2"
        />
        <span class="workspace-muted">正在验证登录状态</span>
      </div>
      <template v-else>
        <v-alert
          type="error"
          variant="tonal"
          density="compact"
          role="alert"
          class="mb-5"
          >{{ errorMessage }}</v-alert
        >
        <v-btn
          to="/sso-login"
          color="primary"
          variant="flat"
          prepend-icon="mdi-login"
          >返回登录</v-btn
        >
        <v-btn to="/" variant="text" class="ml-2">返回工作区</v-btn>
      </template>
    </section>
  </main>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { safeAccountRedirect } from "./auth-navigation";

const route = useRoute();
const router = useRouter();
const keycloak = inject("$keycloak", null);
const loading = ref(true);
const errorMessage = ref("");
let timer;
let active = true;
let attempts = 0;

const fail = (message) => {
  errorMessage.value = message;
  loading.value = false;
};

const checkSession = async () => {
  if (!active) return;
  if (keycloak?.authenticated) {
    try {
      const user = await API.get("/api/user/get-current-user", null, false);
      if (!user?.username) throw new Error("Missing verified identity");
      if (active)
        await router.replace(safeAccountRedirect(route.query.redirect));
    } catch {
      if (active) fail("服务端未能验证当前账号，请重新登录。");
    }
    return;
  }
  if (!keycloak || ++attempts >= 50) {
    fail("单点登录未完成或已超时，请重新登录。");
    return;
  }
  timer = window.setTimeout(checkSession, 200);
};

onMounted(checkSession);
onBeforeUnmount(() => {
  active = false;
  window.clearTimeout(timer);
});
</script>

<style scoped>
.auth-form :deep(.v-btn) {
  border-radius: 7px;
}
</style>
