<template>
  <div class="d-flex justify-center align-center" style="height: 100vh">
    <v-container>
      <v-row justify="center">
        <v-col cols="12" md="6" lg="4">
          <v-card>
            <v-card-text class="text-center pa-8">
              <v-progress-circular indeterminate color="primary" size="64" class="mb-4"></v-progress-circular>
              <h2 class="text-h5">正在处理 SSO 登录...</h2>
              <p class="mt-2">
                请稍候，系统正在完成身份认证。
              </p>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

onMounted(async () => {

  try {
    // Poll for token for up to 10 seconds (100ms intervals)
    const maxAttempts = 100;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const token = localStorage.getItem("accessToken");
      if (token) {
        const redirect = new URLSearchParams(window.location.search).get("redirect");
        router.push(redirect ? decodeURIComponent(redirect) : "/");
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    // If token not found after timeout
    console.error("SSO 登录超时，未找到 token");
    router.push("/login");
  } catch (error) {
    console.error("SSO 回调错误：", error);
    router.push("/login");
  }
});
</script>
