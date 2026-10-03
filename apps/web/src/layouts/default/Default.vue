<template>
  <v-app class="overflow-auto">
    <v-layout class="app-layout-shell">
      <default-bar />

      <div v-if="!isOnline" class="banner offline-banner">
        当前网络离线
      </div>

      <div v-if="isOnline && wasOffline" class="banner online-banner">
        网络已恢复
      </div>

      <default-view />

      <the-chat-bot v-if="isLoggedIn && chatbotEnabled" />

      <v-dialog v-model="newAccountDialog" max-width="600px" class="welcome">
        <v-card>
          <v-card-title>
            <v-icon icon="mdi-hand-wave" size="small"></v-icon>
            欢迎使用
          </v-card-title>
          <v-divider></v-divider>
          <v-card-text class="pa-5 ">
            <div class="d-flex justify-center flex-column align-center">
              <v-img :width="400" cover :src="welcome" class="mb-3"></v-img>
            </div>

            <h4 class="text-h5">
              你好，{{ myusername }}！
            </h4>
            <p class="text-body-1">
              感谢注册 synon <v-chip size="small">核心服务</v-chip>。这里提供已接入的合成计算工具，用于辅助合成路线规划和有机化学相关预测。
            </p>
            <p class="text-body-1 mt-1">
              管理账号 <v-btn variant="tonal" color="primary" prepend-icon="mdi-account"
                to="/admin">账号设置</v-btn>
            </p>
          </v-card-text>
          <v-divider></v-divider>
          <template v-slot:actions>
            <v-btn class="ms-auto" text="确定" @click="newAccountDialog = false" color="primary" variant="flat"></v-btn>
          </template>
        </v-card>
      </v-dialog>

      <v-dialog v-model="guestAccountDialog" max-width="600px" class="welcome">
        <v-card>
          <v-card-title>
            <v-icon icon="mdi-alert" size="small"></v-icon>
            访客账号提示
          </v-card-title>
          <v-divider></v-divider>
          <v-card-text class="pa-5 ">
            <div class="d-flex justify-center flex-column align-center">
              <v-img :width="400" cover :src="hidden" class="mb-3"></v-img>
            </div>

            <h4 class="text-h5">
              你好，访客！
            </h4>
            <p class="text-body-1">
              你当前正在使用 synon <v-chip size="small">访客模式</v-chip> 临时账号。该账号会在一段时间后被删除，删除后数据将无法恢复。
            </p>
            <p class="text-body-1 mt-1">
              如需长期保存结果，请通过登录页面注册正式账号。
            </p>
          </v-card-text>
          <v-divider></v-divider>
          <template v-slot:actions>
            <v-btn class="ms-auto" text="确定" @click="guestAccountDialog = false" color="primary" variant="flat"></v-btn>
          </template>
        </v-card>
      </v-dialog>
    </v-layout>
  </v-app>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, computed } from "vue";
import DefaultBar from "./AppBar.vue";
import DefaultView from "./View.vue";
import TheChatBot from "@/components/TheChatBot.vue";
import { useConfigStore } from "@/store/config";
import Confetti from "vue-confetti/src/confetti.js";
import welcome from "@/assets/welcome.svg"
import hidden from "@/assets/hidden.svg"
const configStore = useConfigStore();
const confetti = new Confetti();
const newAccountDialog = ref(false);
const guestAccountDialog = ref(false);
const isOnline = ref(navigator.onLine);
const wasOffline = ref(false);
const isLoggedIn = computed(() => !!localStorage.getItem("accessToken"));
const chatbotEnabled = computed(() => configStore.envs.VITE_ENABLE_CHATBOT === "True");

const updateOnlineStatus = () => {
  isOnline.value = navigator.onLine;

  if (isOnline.value) {
    wasOffline.value = true
    setTimeout(() => {
      wasOffline.value = false; // Hide the banner after 30 seconds
    }, 10000); // 30000 milliseconds = 30 seconds
  }
};

onMounted(() => {
  const isAccountCreatedNow = localStorage.getItem("newAccount")
  const isguest = localStorage.getItem("guestAccount")
  if (isAccountCreatedNow === "true") {
    confetti.start({
      particles: [
        {
          type: 'rect',
        },
        {
          type: 'circle',
        }
      ],
      colors: ["#FF6F61", "#004C83", "#55C6A9", "#FFC82B"],
      particlesPerFrame: 2,
    });
    setTimeout(() => { confetti.stop() }, 5000);
    localStorage.removeItem("newAccount")
    newAccountDialog.value = true
  } else if (isguest === "true") {
    localStorage.removeItem("guestAccount")
    guestAccountDialog.value = true
  }
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
})

onBeforeUnmount(() => {
  window.removeEventListener("online", updateOnlineStatus);
  window.removeEventListener("offline", updateOnlineStatus);
});

const myusername = computed(() => {
  const fixedLength = 20;
  const username = localStorage.getItem('username') || '';
  if (username.length <= fixedLength) {
    return username;
  }
  return username.substr(0, fixedLength) + '\u2026'
})

</script>

<style>
#confetti-canvas {
  z-index: 998
}

.welcome {
  z-index: 999
}

.app-layout-shell {
  min-width: 0;
}

.banner {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 80%;
  max-width: 400px;
  text-align: center;
  z-index: 1000;
  border-radius: 5px;
}

.online-banner {
  background-color: #4caf50;
}

.offline-banner {
  background-color: #f44336;
}
</style>
