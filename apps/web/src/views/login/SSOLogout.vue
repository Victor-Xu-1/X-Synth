<template>
  <main class="auth-page">
    <section class="auth-form">
      <AuthHeader />
      <h1>{{ $tr('退出登录') }}</h1>
      <p class="workspace-muted mb-5" role="status">{{ $tr(message) }}</p>
      <v-btn to="/login" color="primary" variant="flat" prepend-icon="mdi-login"
        >{{ $tr('返回登录') }}</v-btn
      >
      <v-btn to="/" variant="text" class="ml-2">{{ $tr('返回工作区') }}</v-btn>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import AuthHeader from "./AuthHeader.vue";

const router = useRouter();
const message = ref("正在返回登录页。");

onMounted(async () => {
  try {
    if (window.opener) {
      window.opener.postMessage(
        { type: "kc-logout-success" },
        window.location.origin,
      );
      message.value = "退出回调已发送，可关闭此窗口。";
      return;
    }
    await router.replace("/login");
  } catch {
    message.value = "无法自动返回，请使用下方登录入口。";
  }
});
</script>

<style scoped>
.auth-form :deep(.v-btn) {
  border-radius: 7px;
}
</style>
