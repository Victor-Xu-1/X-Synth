import { UserManager, WebStorageStateStore } from "oidc-client-ts";

const apiServer = "https://scifinder-n.cas.org";
const client_id = "mwlzgyvify";
const { origin } = window.location;

export function validateCasAuthority(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
      !(url.hostname === "cas.org" || url.hostname.endsWith(".cas.org"))) {
    throw new Error("CAS 返回了不可信的登录服务器地址。");
  }
  return url.href;
}

class CasClient {
  constructor(args = {}) {
    const settings = {
      client_id,
      popup_redirect_uri: `${origin}/cas/login/`,
      silent_redirect_uri: `${origin}/cas/silent/`,
      automaticSilentRenew: true,
      popupWindowFeatures: { left: 100, top: 100, width: 900, height: 700 },
      response_type: "code",
      scope: "openid sfn-search",
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      ...args,
      authority: validateCasAuthority(args.authority),
    };

    this.userManager = new UserManager(settings);
    this.apiServer = apiServer;
  }

  async getAccessToken() {
    const user = await this.userManager.getUser();
    if (!user || user.expired || !user.access_token) {
      throw new Error("请先使用已授权的 CAS 账号登录。");
    }
    return user.access_token;
  }

  // Returns Promise with User instance from storage
  getUser = () => this.userManager.getUser();

  // Returns Promise with User instance after popup authentication
  login = () => this.userManager.signinPopup();

  post = (endpoint, data) => {
    if (typeof endpoint !== "string" || !endpoint.startsWith("/api/") || endpoint.includes("..")) {
      return Promise.reject(new Error("CAS 请求路径无效。"));
    }
    return (
    this.getAccessToken()
      .then((token) => {
        const headers = new Headers({
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        });
        return fetch(this.apiServer + endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        });
      })
      .then((response) =>
        response.ok
          ? response.json()
          : response
              .json()
              .catch(() => Promise.reject(new Error(response.statusText)))
              .then((json) => Promise.reject(new Error(json.error)))
      )
    );
  };
}

// Look up CAS SSO server and return AuthService instance
// Returns Promise
const createCasClient = async (args = {}, proxy = null) => {
  if (proxy) {
    throw new Error("未配置受信任的 CAS 登录代理，请使用 CAS 官方登录通道。");
  }
  const response = await fetch(`${apiServer}/api/oauth2/metadata`);
  if (!response.ok) throw new Error(`无法获取 CAS 登录配置（HTTP ${response.status}）。`);
  const authority = response.headers.get("Location");
  if (!authority) throw new Error("CAS 未返回有效登录配置，请检查账号授权和跨域配置。");
  return new CasClient({ ...args, authority });
};

export { createCasClient };
