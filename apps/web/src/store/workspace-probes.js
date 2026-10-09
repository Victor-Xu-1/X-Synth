const refreshes = new WeakMap();
const core = [["health", "/api/v1/health"], ["session", "/api/v1/session"]];
const optional = [["templates", "/api/v1/template-library/health"],
  ["optimization", "/api/v1/optimization/health"], ["references", "/api/v1/references/status"]];

export function emptyProbeState() {
  return Object.fromEntries([...core, ...optional].map(([field]) => [field, false]));
}

export function reconnectWorkspace(store) {
  const current = refreshes.get(store);
  if (!current) return refreshWorkspace(store, true);
  // Replace only the owned readonly probes; never reuse an offline snapshot.
  if (!current.reconnect) {
    current.controller.abort();
    current.reconnect = current.all.then(() => refreshWorkspace(store, true));
  }
  return current.reconnect;
}

function checkedCore(field, value) {
  const object = value !== null && typeof value === "object" && !Array.isArray(value);
  if (field === "health" && (!object || typeof value.route_search_ready !== "boolean")
      || field === "session" && (!object || !["local", "askcos"].includes(value.mode)))
    throw new Error("服务响应格式无效");
  return value;
}

async function read(store, field, path, headers, signal) {
  let stop;
  const aborted = new Promise((_, reject) => {
    stop = () => reject(signal.reason || new Error("服务探针超时"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  try {
    return checkedCore(field, await Promise.race([aborted, (async () => {
      const response = await fetch(path, { headers, credentials: "same-origin", signal });
      if (!response.ok) throw new Error("服务请求失败");
      return response.json();
    })()]));
  } catch (cause) {
    if (field === "health" || field === "session") store.core = { ...store.core, [field]: null };
    else store[field] = null;
    if (field === "health") store.error = "无法连接工作区服务";
    else if (field === "session") store.error = "无法确认工作区会话";
    throw cause;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

export function refreshWorkspace(store, force = false, coreOnly = false) {
  if (refreshes.has(store)) return refreshes.get(store)[coreOnly ? "core" : "all"];
  if (!force && Date.now() - store.refreshed < 10000) return;
  store.loading = true;
  store.probing = Object.fromEntries([...core, ...optional].map(([field]) => [field, true]));
  const headers = {}, token = localStorage.getItem("accessToken");
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000);
  const coreReads = core.map(([field, path]) => read(store, field, path, headers, controller.signal));
  const optionalReads = optional.map(([field, path]) => read(store, field, path, headers, controller.signal)
    .then(value => ({ field, value }), () => ({ field, value: null })));
  const coreReady = Promise.allSettled(coreReads).then(values => {
    // Core identity and health publish together; optional latency is independent.
    store.core = { health: values[0].status === "fulfilled" ? values[0].value : null,
      session: values[1].status === "fulfilled" ? values[1].value : null };
    store.probing.health = false; store.probing.session = false;
    store.error = !store.health ? "无法连接工作区服务" : !store.session ? "无法确认工作区会话" : "";
    store.refreshed = Date.now();
  });
  const pending = Promise.all([coreReady, ...optionalReads.map(async result => {
    const { field, value } = await result;
    await coreReady;
    store[field] = value; store.probing[field] = false;
  })]).finally(() => {
    clearTimeout(timer);
    store.loading = false;
    refreshes.delete(store);
  });
  refreshes.set(store, { core: coreReady, all: pending, controller });
  return coreOnly ? coreReady : pending;
}
