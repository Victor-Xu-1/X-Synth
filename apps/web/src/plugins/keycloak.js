import Keycloak from "keycloak-js";
import { API } from "@/common/api";
import router from "../router";

const keycloakPlugin = {
  install: async (app, options = {}) => {
    const keycloakConfig = {
      // Use /auth/ path through NGINX proxy for universal routing (no hardcoded ports)
      url: options.url || `${window.location.origin}/auth`,
      realm: options.realm || "askcos",
      clientId: options.clientId || "askcos-vue",
      redirectUri:
        options.redirectUri || `${window.location.origin}/sso-callback`,
    };

    const keycloak = new Keycloak(keycloakConfig);

    // Session storage cleanup (unless on callback)
    try {
      if (!window.location.pathname.includes("/sso-callback")) {
        Object.keys(sessionStorage)
          .filter(
            (k) =>
              k.startsWith("kc-") ||
              k.startsWith("keycloak-") ||
              k.includes("kc-callback")
          )
          .forEach((k) => sessionStorage.removeItem(k));
      }
    } catch (e) {
      console.debug("Keycloak session storage cleanup skipped", e);
    }

    // Expose keycloak for global usage
    app.config.globalProperties.$keycloak = keycloak;
    app.provide("$keycloak", keycloak);

    // Handle SSO popup login/logout
    try {
      window.addEventListener("message", async (event) => {
        try {
          if (!event || event.origin !== window.location.origin) return;
          const data = event.data || {};
          if (data.type === "kc-auth-success") {
            // Store tokens
            try {
              localStorage.setItem("accessToken", data.token || "");
              localStorage.setItem("username", data.profile?.username || "");
              localStorage.setItem("authProvider", "keycloak");
              sessionStorage.removeItem("kc-login-initiated");
            } catch (e) {
              console.debug("Failed to persist SSO tokens from popup", e);
            }

            // Attach tokens to Keycloak for refresh
            try {
              keycloak.token = data.token || keycloak.token;
              keycloak.refreshToken =
                data.refreshToken || keycloak.refreshToken;
              keycloak.idToken = data.idToken || keycloak.idToken;
              keycloak.authenticated = true;
              keycloak.onTokenExpired = async () => {
                try {
                  const refreshed = await keycloak.updateToken(60);
                  if (refreshed) {
                    localStorage.setItem("accessToken", keycloak.token || "");
                  }
                } catch (e) {
                  console.debug(
                    "Popup flow token refresh failed; logging out",
                    e
                  );
                  try {
                    await keycloak.logout({
                      redirectUri: `${window.location.origin}/login`,
                    });
                  } catch {
                    console.debug(
                      "Failed to logout on token refresh failure (ignored)",
                      e
                    );
                  }
                }
              };
            } catch (e) {
              console.debug("Failed to attach tokens to Keycloak instance", e);
            }

            // Profile sync
            try {
              const me = await API.get(
                "/api/user/get-current-user",
                null,
                false
              );
              const fullName =
                [data.profile?.firstName, data.profile?.lastName]
                  .filter(Boolean)
                  .join(" ") || null;
              await API.post(
                "/api/user/update",
                {
                  username: me.username,
                  email: data.profile?.email || null,
                  full_name: fullName,
                  disabled: false,
                },
                true
              );
              await API.post(
                "/api/user/update-last-login",
                {
                  username: me.username,
                  last_login: new Date().toISOString(),
                },
                true
              );
            } catch (e) {
              console.debug("Popup flow profile sync failed (ignored)", e);
            }

            // Post-login navigation
            try {
              const params = new URLSearchParams(window.location.search);
              const redirectParam = params.get("redirect");
              const stored = sessionStorage.getItem("kc-redirect");
              const lastRoute = localStorage.getItem("lastRoute") || "/";
              let target = redirectParam
                ? decodeURIComponent(redirectParam)
                : stored
                  ? stored
                  : lastRoute;
              if (!target || target.startsWith("/login")) target = "/";
              sessionStorage.removeItem("kc-redirect");
              router.push(target);
            } catch (e) {
              console.debug("Popup flow routing failed (ignored)", e);
            }
            return;
          }
          if (data.type === "kc-logout-success") {
            try {
              localStorage.removeItem("accessToken");
              localStorage.removeItem("username");
              localStorage.removeItem("authProvider");
            } catch (e) {
              console.debug("Failed to clear storage on logout (ignored)", e);
            }
            try {
              sessionStorage.removeItem("kc-login-initiated");
            } catch (e) {
              console.debug("Failed to clear login flag (ignored)", e);
            }
            try {
              router.push("/login");
            } catch (e) {
              console.debug("Failed to redirect to login (ignored)", e);
            }
            return;
          }
        } catch (e) {
          console.debug("Popup message handling failed (ignored)", e);
        }
      });

      // Fallback: handle SSO if postMessage fails
      window.addEventListener("focus", async () => {
        try {
          const raw = localStorage.getItem("kc-auth-success");
          if (!raw) return;
          const data = JSON.parse(raw);
          localStorage.removeItem("kc-auth-success");
          window.postMessage(
            { type: "kc-auth-success", ...data },
            window.location.origin
          );
        } catch (e) {
          console.debug("kc-auth-success storage fallback failed (ignored)", e);
        }
      });
    } catch (e) {
      console.debug("Failed to setup popup message listener (ignored)", e);
    }

    // Initialize Keycloak
    await keycloak
      .init({
        checkLoginIframe: false,
        enableLogging: true,
        pkceMethod: "S256",
        flow: "standard",
      })
      .then(async (authenticated) => {
        const loginInitiated =
          sessionStorage.getItem("kc-login-initiated") === "1";
        const isCallback = window.location.pathname.includes("/sso-callback");
        const params = new URLSearchParams(window.location.search);
        const isPopupCallback = isCallback && params.get("popup") === "1";

        if (authenticated && (loginInitiated || isCallback)) {
          // Skip storage/navigation for popup-callback
          if (isPopupCallback) return;
          // Clear previous session data
          try {
            localStorage.removeItem("accessToken");
            localStorage.removeItem("username");
            localStorage.removeItem("authProvider");
          } catch (e) {
            console.warn("Failed clearing prior session storage", e);
          }
          // Save user info from Keycloak
          const userProfile = await keycloak.loadUserProfile();
          localStorage.setItem("username", userProfile.username || "");
          localStorage.setItem("accessToken", keycloak.token || "");
          localStorage.setItem("authProvider", "keycloak");

          // Enable background token refresh
          keycloak.onTokenExpired = async () => {
            try {
              const refreshed = await keycloak.updateToken(60);
              if (refreshed) {
                localStorage.setItem("accessToken", keycloak.token || "");
              } else {
                await keycloak.logout({
                  redirectUri: `${window.location.origin}/login`,
                });
              }
            } catch (e) {
              console.warn("Token refresh failed; logging out", e);
              try {
                await keycloak.logout({
                  redirectUri: `${window.location.origin}/login`,
                });
              } catch (e) {
                console.debug(
                  "Failed to logout on token refresh failure (ignored)",
                  e
                );
              }
            }
          };

          // Sync updated profile info to backend
          try {
            const me = await API.get("/api/user/get-current-user", null, false);
            const fullName =
              [userProfile.firstName, userProfile.lastName]
                .filter(Boolean)
                .join(" ") || null;
            const now = new Date().toISOString();
            await API.post(
              "/api/user/update",
              {
                username: me.username,
                email: userProfile.email || null,
                full_name: fullName,
                disabled: false,
              },
              true
            );
            await API.post(
              "/api/user/update-last-login",
              {
                username: me.username,
                last_login: now,
              },
              true
            );
          } catch (e) {
            console.warn("Post-SSO profile sync failed", e);
          }

          // Route after login
          const redirect = params.get("redirect");
          if (redirect) {
            router.push(decodeURIComponent(redirect));
          } else {
            router.push("/");
          }
          try {
            sessionStorage.removeItem("kc-login-initiated");
          } catch (e) {
            console.debug("Failed to clear kc-login-initiated (ignored)", e);
          }
        }
      })
      .catch((error) => {
        console.error("Keycloak initialization failed", error);
      });
  },
};

export default keycloakPlugin;
