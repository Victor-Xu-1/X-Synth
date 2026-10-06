import { useFastapiStore } from "@/store/fastapi";
import { recordRequest } from "./request-observability";
import { hasWorkspaceAccess } from "./workspace-session";

function requestScope(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(new DOMException("服务请求超时，请刷新或重试。", "TimeoutError")), timeoutMs)
    : null;
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function pollDelay(delay, signal) {
  let timer;
  try {
    await abortable(new Promise((resolve) => { timer = setTimeout(resolve, delay); }), signal);
  } finally {
    clearTimeout(timer);
  }
}

const API = {
  pollInterval: 1000,
  pollIntervalLong: 2000,
  pollTimeoutMs: 30 * 60 * 1000,
  pollRequestTimeoutMs: 15000,
  maxPollConnectionErrors: 3,

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

  async request(method, endpoint, data, query = false, { signal, timeoutMs } = {}) {
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

    const scope = requestScope(signal, timeoutMs);
    options.signal = scope.signal;
    try {
      if (scope.signal.aborted) throw scope.signal.reason;
      const response = await abortable(fetch(url, options), scope.signal);
      let json;
      try {
        json = await abortable(this.fetchHandler(response), scope.signal);
      } catch (error) {
        if (
          response.status === 401 &&
          endpoint !== "/api/admin/token" &&
          !(await hasWorkspaceAccess())
        ) {
          localStorage.removeItem("guestPassword");
          this.clearAuthState();
          this.redirectToLogin();
        }
        throw error;
      }
      recordRequest(fastapiStore, {
        endpoint,
        method,
        request: data,
        response: json,
      });
      return json;
    } finally {
      scope.dispose();
    }
  },

  get: (endpoint, params, query = true, options) =>
    API.request("GET", endpoint, params, query, options),
  post: (endpoint, data, query, options) => API.request("POST", endpoint, data, query, options),
  put: (endpoint, data) => API.request("PUT", endpoint, data),
  delete: (endpoint, data, query) =>
    API.request("DELETE", endpoint, data, query),

  async runCeleryTask(endpoint, data, progress, options = {}) {
    const json = await this.post(endpoint, data, false, {
      signal: options.signal,
      timeoutMs: this.pollRequestTimeoutMs,
    });
    return this.pollCeleryResult(json.task_id || json, progress, options);
  },

  toErrorObject(
    error,
    fallback = "请求失败，请检查输入、后端服务和模型服务状态。",
  ) {
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
            typeof detail === "string" && detail.trim() ? detail : fallback;
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
      return {
        string_error: "后端服务返回内部错误，请检查对应 worker 或稍后重试。",
      };
    }
    if (/Celery task failed|^Task failed!?$/i.test(rawMessage)) {
      return { string_error: fallback };
    }
    return { string_error: rawMessage || fallback };
  },

  async pollCeleryResult(taskId, progress, { signal, timeoutMs = this.pollTimeoutMs } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new RangeError("轮询时限必须为有效正数。");
    const scope = requestScope(signal, timeoutMs);
    let connectionErrors = 0;
    try {
      while (!scope.signal.aborted) {
        let json;
        try {
          json = await abortable(this.get(`/api/legacy/celery/task/${taskId}/`, null, false, {
            signal: scope.signal,
            timeoutMs: this.pollRequestTimeoutMs,
          }), scope.signal);
          connectionErrors = 0;
        } catch (error) {
          if (scope.signal.aborted) throw scope.signal.reason;
          if (!(error instanceof TypeError) || ++connectionErrors >= this.maxPollConnectionErrors)
            throw error;
          await pollDelay(this.pollIntervalLong, scope.signal);
          continue;
        }
        if (scope.signal.aborted) throw scope.signal.reason;
        if (json.failed)
          throw new Error(JSON.stringify(json.output || {
            string_error: json.message || "后端异步任务执行失败。",
          }));
        if (json.complete) return json.output;
        if (progress) progress(json);
        await pollDelay(this.pollInterval, scope.signal);
      }
      throw scope.signal.reason;
    } finally {
      scope.dispose();
    }
  },
};

export { API };
