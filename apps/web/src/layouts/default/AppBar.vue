<template>
  <v-app-bar class="synon-topbar" height="52" flat>
    <div class="topbar-stack">
      <div class="global-tabbar" role="navigation" aria-label="全局导航">
        <button class="global-brand" type="button" aria-label="返回首页" @click="goHome">
          <img class="global-brand-mark" src="/android-chrome-192x192.png" alt="" />
          <span class="global-brand-name">X-Synth</span>
          <span class="global-brand-version">v{{ productVersion }}</span>
        </button>

        <nav class="global-nav" aria-label="主导航">
          <v-btn class="global-nav-button" prepend-icon="mdi-home" variant="text" to="/">
            首页
          </v-btn>
          <v-btn class="global-nav-button" prepend-icon="mdi-view-grid" variant="text" to="/results">
            任务列表
          </v-btn>
        </nav>

        <form class="global-search" role="search" @submit.prevent="submitGlobalSearch">
          <v-icon class="global-search-icon" icon="mdi-magnify" size="22"></v-icon>
          <input
            v-model.trim="globalSearch"
            aria-label="输入 SMILES 或化学名"
            placeholder="请输入SMILES或化学名"
            type="search"
          />
          <button
            class="global-search-camera"
            type="button"
            aria-label="打开结构绘制"
            @click="openDrawing"
          >
            <v-icon icon="mdi-camera-plus-outline" size="22"></v-icon>
          </button>
        </form>

        <div class="global-utility">
          <v-menu v-if="isLoggedIn" location="bottom end" transition="scale-transition">
            <template #activator="{ props }">
              <button class="global-user" type="button" v-bind="props">
                <v-icon icon="mdi-account-circle" size="28"></v-icon>
                <span>{{ compactUsername }}</span>
              </button>
            </template>
            <v-list class="user-menu" density="comfortable">
              <v-list-item
                prepend-icon="mdi-account-cog-outline"
                title="账号设置"
                to="/admin"
                :disabled="myusername.startsWith('guest_')"
              ></v-list-item>
              <v-list-item prepend-icon="mdi-logout" title="退出" @click="logout"></v-list-item>
            </v-list>
          </v-menu>

          <v-btn v-else class="global-login" prepend-icon="mdi-login" variant="text" to="/login">
            登录
          </v-btn>
        </div>
      </div>
    </div>
  </v-app-bar>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { useRouter } from "vue-router";
import { API } from "@/common/api";

const keycloak = inject("$keycloak");
const router = useRouter();
const productVersion = __X_SYNTH_VERSION__;
const globalSearch = ref("");

const myusername = computed(() => {
  const fixedLength = 20;
  const username = localStorage.getItem("username") || "";
  if (username.length <= fixedLength) return username;
  return username.substr(0, fixedLength) + "\u2026";
});

const isLoggedIn = computed(() => !!localStorage.getItem("accessToken"));
const compactUsername = computed(() => {
  const username = myusername.value || "访客";
  return username.length > 10 ? `${username.slice(0, 8)}...` : username;
});

function goHome() {
  router.push({ path: "/" });
}

function submitGlobalSearch() {
  const query = globalSearch.value.trim();
  if (!query) return;
  localStorage.setItem("synon:lastGlobalSearch", query);
  router.push({ path: "/", query: { q: query } });
}

function openDrawing() {
  router.push({ path: "/drawing" });
}

async function logout() {
  try {
    const response = await API.post("/api/admin/logout");
    if (response.status !== "Successfully logged out!") throw new Error("Logout failed");

    localStorage.removeItem("accessToken");
    localStorage.removeItem("username");
    localStorage.removeItem("authProvider");

    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("kc-") || k.startsWith("keycloak-") || k.includes("kc-callback"))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch (e) {
      console.debug("Session storage cleanup failed (ignored)", e);
    }

    if (keycloak && keycloak.authenticated) {
      try {
        const logoutUrl = keycloak.createLogoutUrl({
          redirectUri: `${window.location.origin}/sso-logout`,
          idTokenHint: keycloak.idToken,
        });
        const popup = window.open(logoutUrl, "kc_logout_popup", "left=120,top=120,width=900,height=700");
        if (!popup) {
          await keycloak.logout({
            redirectUri: `${window.location.origin}/sso-logout`,
            idTokenHint: keycloak.idToken,
          });
          return;
        }

        const handleLogoutMessage = (event) => {
          if (event.origin !== window.location.origin) return;
          if (event.data?.type === "kc-logout-success") {
            window.removeEventListener("message", handleLogoutMessage);
            if (!popup.closed) popup.close();
            router.push({ path: "/login" });
          }
        };
        window.addEventListener("message", handleLogoutMessage);

        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener("message", handleLogoutMessage);
            router.push({ path: "/login" });
          }
        }, 1000);
        return;
      } catch (e) {
        console.debug("Keycloak logout popup failed (ignored)", e);
      }
    }
    router.push({ path: "/login" });
  } catch (error) {
    console.error("Logout failed:", error);
  }
}
</script>

<style scoped>
.synon-topbar {
  --topbar-height: 52px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18) !important;
  background:
    linear-gradient(180deg, rgba(249, 252, 255, 0.88), rgba(246, 249, 253, 0.72)) !important;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.72) inset;
  backdrop-filter: blur(18px) saturate(165%);
  -webkit-backdrop-filter: blur(18px) saturate(165%);
}

.synon-topbar :deep(.v-toolbar__content) {
  display: block;
  width: 100%;
  height: var(--topbar-height) !important;
  padding: 0 !important;
}

.topbar-stack {
  display: flex;
  align-items: center;
  width: 100%;
  height: var(--topbar-height);
  min-width: 0;
  padding: 0 clamp(14px, 1vw, 24px);
}

.global-tabbar {
  display: grid;
  grid-template-columns: minmax(104px, 148px) auto minmax(320px, 720px) minmax(86px, auto);
  align-items: center;
  gap: clamp(14px, 1.25vw, 28px);
  width: 100%;
  height: var(--topbar-height);
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: #0f172a;
  background: transparent;
  box-shadow: none;
}

.global-brand,
.global-nav,
.global-utility,
.global-user,
.global-icon-button {
  display: inline-flex;
  align-items: center;
}

.global-brand {
  gap: 7px;
  min-width: 0;
  height: 40px;
  padding: 0;
  border-radius: 8px;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.global-brand-mark {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  box-shadow: none;
}

.global-brand-name {
  font-size: 1rem;
  font-weight: 760;
  letter-spacing: 0;
  white-space: nowrap;
}

.global-brand-version {
  font-size: 11px;
  color: #61676d;
  white-space: nowrap;
}

.global-nav {
  align-self: center;
  gap: clamp(12px, 0.9vw, 20px);
  height: var(--topbar-height);
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.global-nav-button {
  position: relative;
  height: var(--topbar-height) !important;
  padding-inline: 0 !important;
  border-radius: 0 !important;
  color: rgba(15, 23, 42, 0.76) !important;
  font-weight: 680 !important;
  letter-spacing: 0 !important;
  transition: color 160ms ease, transform 160ms ease;
}

.global-nav-button :deep(.v-btn__overlay) {
  background: transparent !important;
}

.global-nav-button::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  border-radius: 999px;
  background: transparent;
  transform: scaleX(0.2);
  opacity: 0;
  transition: opacity 160ms ease, transform 160ms ease, background 160ms ease;
}

.global-nav-button:hover {
  color: rgb(0, 122, 255) !important;
  background: transparent !important;
}

.global-nav-button:hover::after,
.global-nav-button.v-btn--active::after,
.global-nav-button.router-link-active::after {
  background: rgb(0, 122, 255);
  opacity: 1;
  transform: scaleX(1);
}

.global-nav-button.v-btn--active,
.global-nav-button.router-link-active {
  color: rgb(0, 122, 255) !important;
  background: transparent !important;
  box-shadow: none;
}

.global-search {
  justify-self: center;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 36px;
  align-items: center;
  width: min(700px, 45vw);
  height: 32px;
  min-width: 320px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  color: rgb(15, 23, 42);
  background: rgba(255, 255, 255, 0.46);
  box-shadow: none;
  backdrop-filter: blur(12px) saturate(150%);
  -webkit-backdrop-filter: blur(12px) saturate(150%);
  transition: background 160ms ease, border-color 160ms ease;
}

.global-search:focus-within {
  border-color: rgba(0, 122, 255, 0.36);
  background: rgba(255, 255, 255, 0.8);
  box-shadow: none;
  transform: none;
}

.global-search-icon {
  margin-left: 10px;
  color: rgba(15, 23, 42, 0.42);
}

.global-search input {
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  color: rgb(15, 23, 42);
  background: transparent;
  font-size: clamp(0.86rem, 0.55vw, 0.94rem);
  font-weight: 600;
  letter-spacing: 0;
}

.global-search input::placeholder {
  color: rgba(15, 23, 42, 0.38);
}

.global-search-camera {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 28px;
  margin-right: 4px;
  border: 0;
  border-radius: 7px;
  color: rgba(15, 23, 42, 0.58);
  background: transparent;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.global-search-camera:hover {
  color: rgb(0, 122, 255);
  background: rgba(0, 122, 255, 0.1);
}

.global-utility {
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
  padding-left: clamp(8px, 0.65vw, 14px);
  border-left: 1px solid rgba(148, 163, 184, 0.2);
}

.global-icon-button,
.global-user {
  border: 0;
  color: rgba(15, 23, 42, 0.74);
  background: transparent;
  cursor: pointer;
  transition: background 160ms ease, transform 160ms ease;
}

.global-icon-button {
  position: relative;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 7px;
}

.global-icon-button:hover,
.global-user:hover,
.global-brand:hover {
  color: rgb(0, 122, 255);
  background: rgba(0, 122, 255, 0.08);
}

.global-icon-button:active,
.global-user:active,
.global-brand:active {
  transform: translateY(1px);
}

.global-user {
  gap: 7px;
  max-width: 156px;
  height: 32px;
  padding: 0 4px;
  border-radius: 7px;
  font-weight: 650;
}

.global-user span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.global-login {
  height: 32px !important;
  border-radius: 7px !important;
  color: rgba(15, 23, 42, 0.78) !important;
  font-weight: 680 !important;
}

.user-menu {
  min-width: 190px;
}

@media (max-width: 720px) {
  .synon-topbar {
    --topbar-height: 52px;
    height: 56px !important;
  }

  .synon-topbar :deep(.v-toolbar__content),
  .topbar-stack {
    height: 50px !important;
  }

  .global-tabbar {
    grid-template-columns: auto minmax(150px, 1fr) auto;
    gap: 10px;
    height: var(--topbar-height);
    padding-inline: 0;
    border-radius: 0;
  }

  .global-brand-name,
  .global-nav {
    display: none;
  }

  .global-brand {
    height: 38px;
  }

  .global-brand-mark {
    width: 30px;
    height: 30px;
  }

  .global-search {
    width: 100%;
    min-width: 0;
    height: 34px;
    grid-template-columns: 30px minmax(0, 1fr) 36px;
  }

  .global-search input {
    font-size: 0.86rem;
  }

  .global-user {
    max-width: 42px;
    padding-inline: 7px;
  }

  .global-user span,
  .global-login :deep(.v-btn__content span) {
    display: none;
  }

}
</style>
