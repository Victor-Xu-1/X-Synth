import { useFastapiStore } from "@/store/fastapi";

const API = {
  pollInterval: 1000,
  pollIntervalLong: 2000,

  getHeaders(data) {
    const headers = {};
    const token = localStorage.getItem("accessToken");
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (data && !(data instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  },

  clearAuthState() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("authProvider");
    if (!localStorage.getItem("guestUsername")) {
      localStorage.removeItem("username");
    }
  },

  redirectToLogin() {
    if (typeof window === "undefined") return;
    const path = `${window.location.pathname || "/"}${window.location.search || ""}`;
    if (path.startsWith("/login") || path.startsWith("/adminLogin")) return;
    window.location.assign(`/login?redirect=${encodeURIComponent(path)}`);
  },

  async recoverGuestSession() {
    const username = localStorage.getItem("guestUsername");
    const password = localStorage.getItem("guestPassword");
    if (!username || !password) return false;

    const formData = new FormData();
    formData.append("username", username);
    formData.append("password", password);

    try {
      const response = await fetch("/api/admin/token", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) return false;
      const json = await response.json();
      if (!json?.access_token) return false;
      localStorage.setItem("accessToken", json.access_token);
      localStorage.setItem("username", username);
      localStorage.setItem("authProvider", "local");
      localStorage.setItem("guestAccount", "true");
      return true;
    } catch {
      return false;
    }
  },

  async fetchHandler(response) {
    if (response.ok) {
      try {
        return await response.json();
      } catch {
        return response.statusText;
      }
    }
    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error(response.statusText || `HTTP ${response.status}`);
    }
    throw new Error(JSON.stringify(json));
  },

  async request(method, endpoint, data, query = false, retryAuth = true) {
    const fastapiStore = useFastapiStore();
    const url = query ? `${endpoint}?${new URLSearchParams(data)}` : endpoint;
    const options = {
      method,
      headers: this.getHeaders(data),
      credentials: "include",
    };

    if (method !== "GET" && method !== "DELETE" && !query) {
      options.body = data instanceof FormData ? data : JSON.stringify(data);
    }

    const response = await fetch(url, options);
    let json;
    try {
      json = await this.fetchHandler(response);
    } catch (error) {
      if (response.status === 401 && retryAuth && endpoint !== "/api/admin/token") {
        const recovered = await this.recoverGuestSession();
        if (recovered) {
          return this.request(method, endpoint, data, query, false);
        }
        this.clearAuthState();
        this.redirectToLogin();
      }
      throw error;
    }

    fastapiStore.requestHistory.unshift({
      endpoint,
      method,
      request: JSON.stringify(data),
      response: json,
    });

    return json;
  },

  get: (endpoint, params, query = true) =>
    API.request("GET", endpoint, params, query),
  post: (endpoint, data, query) => API.request("POST", endpoint, data, query),
  put: (endpoint, data) => API.request("PUT", endpoint, data),
  delete: (endpoint, data, query) =>
    API.request("DELETE", endpoint, data, query),

  async jsonRpc(endpoint, method, params = {}, extraHeaders = {}) {
    const headers = { ...this.getHeaders({}), ...extraHeaders };
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now(),
      }),
    });
    const data = response.ok ? await response.json() : null;
    return { response, data };
  },

  async runCeleryTask(endpoint, data, progress) {
    const json = await this.post(endpoint, data);
    return this.pollCeleryResult(json.task_id || json, progress);
  },

  toErrorObject(error, fallback = "请求失败，请检查输入、后端服务和模型服务状态。") {
    const rawMessage = error?.message || "";
    try {
      const parsed = JSON.parse(rawMessage);
      if (parsed && typeof parsed === "object") {
        if (/^Task failed!?$/i.test(parsed.string_error || "")) {
          parsed.string_error = fallback;
        }
        if (!parsed.string_error) {
          const detail = parsed.detail || parsed.message || parsed.error;
          parsed.string_error =
            typeof detail === "string" && detail.trim()
              ? detail
              : fallback;
        }
        return parsed;
      }
    } catch {
      // Non-JSON errors are normalized below.
    }

    if (/Failed to fetch/i.test(rawMessage)) {
      return { string_error: "无法连接后端服务，请检查服务是否运行。" };
    }
    if (/Internal Server Error|HTTP 500|status.?500/i.test(rawMessage)) {
      return { string_error: "后端服务返回内部错误，请检查对应 worker 或稍后重试。" };
    }
    if (/Celery task failed|^Task failed!?$/i.test(rawMessage)) {
      return { string_error: fallback };
    }
    return { string_error: rawMessage || fallback };
  },

  pollCeleryResult(taskId, progress) {
    return new Promise((resolve, reject) => {
      const check = () => {
        this.get(`/api/legacy/celery/task/${taskId}/`, null, false)
          .then((json) => {
            if (json.complete) return resolve(json.output);
            if (json.failed) {
              return reject(new Error(JSON.stringify(json.output || {
                string_error: json.message || "后端异步任务执行失败。",
              })));
            }
            if (progress) progress(json);
            setTimeout(check, this.pollInterval);
          })
          .catch((error) => {
            if (
              error instanceof TypeError &&
              error.message === "Failed to fetch"
            ) {
              console.error(
                "Unable to fetch celery results due to connection error. Will keep trying."
              );
              setTimeout(check, this.pollIntervalLong);
            } else {
              reject(error);
            }
          });
      };
      check();
    });
  },
};

export { API };
