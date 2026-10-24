const refreshes = new WeakMap();
const core = [["health", "/api/v1/health"], ["session", "/api/v1/session"]];
const optional = { templates: "/api/v1/template-library/health",
  optimization: "/api/v1/optimization/health", references: "/api/v1/references/status" };
function identity() {
  try { return localStorage.getItem("accessToken") || ""; }
  catch { return null; }
}
export const optionalFeatures = Object.keys(optional);

export function emptyProbeState() {
  return Object.fromEntries([...core.map(([field]) => field), ...optionalFeatures].map(field => [field, false]));
}

function current(store, owner) {
  return refreshes.get(store) === owner && workspaceIdentityCurrent(store);
}

function retireIdentity(store, unavailable) {
  stopWorkspaceProbes(store);
  store.$patch({ core: { health: null, session: null }, templates: null,
    optimization: null, optimizationExpires: 0, references: null, refreshed: 0,
    error: unavailable ? "无法确认工作区会话" : "" });
}

export function workspaceIdentityCurrent(store) {
  const owner = refreshes.get(store), value = identity();
  if (value === null || owner && owner.identity !== value) {
    if (owner) retireIdentity(store, value === null);
    return false;
  }
  return true;
}

export function captureWorkspaceIdentity(store) {
  const owner = ownerFor(store);
  return () => !!owner && current(store, owner);
}

export function stopWorkspaceProbes(store) {
  const owner = refreshes.get(store);
  if (owner) {
    refreshes.delete(store);
    owner.core?.controller.abort();
    owner.probes.forEach(entry => entry.controller.abort());
    clearTimeout(owner.expiry);
  }
  store.loading = false;
  store.probing = emptyProbeState();
}

function ownerFor(store) {
  let owner = refreshes.get(store);
  const value = identity();
  if (value === null || owner && owner.identity !== value) {
    retireIdentity(store, value === null);
    if (value === null) return null;
    owner = null;
  }
  if (!owner) {
    owner = { identity: value, core: null, all: null, probes: new Map(),
      checked: {}, optimizationRevision: 0, expiry: null };
    refreshes.set(store, owner);
  }
  return owner;
}

function loading(store, owner) {
  if (current(store, owner)) store.loading = !!(owner.core || owner.all);
}

function checkedCore(field, value) {
  const object = value !== null && typeof value === "object" && !Array.isArray(value);
  if (field === "health" && (!object || typeof value.route_search_ready !== "boolean")
      || field === "session" && (!object || !["local", "askcos"].includes(value.mode)))
    throw new Error("服务响应格式无效");
  return value;
}

function checkedOptimization(value) {
  if (!value || typeof value.ready !== "boolean" || typeof value.reason !== "string"
      || value.ready && value.versions?.baybe !== "0.15.0"
      || ["busy", "checking", "configured"].some(key => value[key] !== undefined && typeof value[key] !== "boolean")
      || value.engine !== undefined && value.engine !== "BayBE"
      || value.expected_version !== undefined && value.expected_version !== "0.15.0"
      || value.fresh_for_seconds !== undefined && (!Number.isFinite(value.fresh_for_seconds)
        || value.fresh_for_seconds < 0 || value.fresh_for_seconds > 60))
    throw new Error("服务响应格式无效");
  return value;
}

async function read(path, owner, controller, timeout = 7000) {
  const { signal } = controller;
  let stop;
  const aborted = new Promise((_, reject) => {
    stop = () => reject(signal.reason || new Error("服务探针超时"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await Promise.race([aborted, (async () => {
      if (signal.aborted) throw signal.reason;
      const headers = owner.identity ? { Authorization: `Bearer ${owner.identity}` } : {};
      const response = await fetch(path, { headers, credentials: "same-origin", signal });
      if (!response.ok) throw new Error("服务请求失败");
      return response.json();
    })()]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

function publishOptimization(store, owner, value, started) {
  clearTimeout(owner.expiry);
  store.optimization = value;
  // Subtract the whole request duration: transport cannot extend verified lifetime.
  const remaining = Math.max(0, (value?.fresh_for_seconds || 0) * 1000 - (performance.now() - started));
  store.optimizationExpires = remaining ? performance.now() + remaining : 0;
  if (remaining) owner.expiry = setTimeout(() => {
    if (current(store, owner)) store.optimizationExpires = 0;
  }, remaining);
}

function refreshCore(store, owner, force) {
  if (owner.core) return owner.core.promise;
  if (!force && store.refreshed && Date.now() - store.refreshed < 10000) return Promise.resolve();
  const entry = { controller: new AbortController() }, started = performance.now();
  const revision = owner.optimizationRevision;
  store.probing.health = true; store.probing.session = true;
  const reads = core.map(([field, path]) => read(path, owner, entry.controller)
    .then(value => checkedCore(field, value)).catch(cause => {
      if (current(store, owner)) {
        store.core = { health: null, session: null };
        store.error = field === "health" ? "无法连接工作区服务" : "无法确认工作区会话";
      }
      throw cause;
    }));
  entry.promise = Promise.allSettled(reads).then(values => {
    if (!current(store, owner)) return;
    store.core = { health: values[0].status === "fulfilled" ? values[0].value : null,
      session: values[1].status === "fulfilled" ? values[1].value : null };
    store.error = !store.health ? "无法连接工作区服务" : !store.session ? "无法确认工作区会话" : "";
    store.refreshed = Date.now();
    if (revision === owner.optimizationRevision && !owner.probes.has("optimization")) {
      let snapshot = null;
      try {
        const value = store.health?.scientific_engines?.optimization;
        if (value) snapshot = checkedOptimization(value);
      } catch { /* Invalid optional evidence cannot qualify a feature. */ }
      publishOptimization(store, owner, snapshot, started);
    }
  }).finally(() => {
    if (current(store, owner) && owner.core === entry) {
      owner.core = null;
      store.probing.health = false; store.probing.session = false;
      loading(store, owner);
    }
  });
  owner.core = entry;
  loading(store, owner);
  return entry.promise;
}

function subscribe(entry, signal) {
  if (!signal) { entry.retained = true; return entry.promise; }
  if (signal.aborted) return Promise.resolve();
  const subscriber = {};
  entry.subscribers.add(subscriber);
  const release = () => {
    entry.subscribers.delete(subscriber);
    if (!entry.retained && !entry.subscribers.size) entry.controller.abort();
  };
  let stop;
  const aborted = new Promise(resolve => {
    stop = () => { release(); resolve(); };
    signal.addEventListener("abort", stop, { once: true });
  });
  return Promise.race([entry.promise, aborted]).finally(() => {
    signal.removeEventListener("abort", stop);
    release();
  });
}

export function refreshFeature(store, feature, force = false, { signal } = {}) {
  if (!optionalFeatures.includes(feature) || signal?.aborted) return Promise.resolve();
  const owner = ownerFor(store);
  if (!owner) return Promise.resolve();
  const previous = owner.probes.get(feature);
  if (previous && !previous.controller.signal.aborted) return subscribe(previous, signal);
  if (previous) owner.probes.delete(feature);
  const fresh = feature === "optimization" ? store.optimizationExpires > performance.now()
    : owner.checked[feature] && Date.now() - owner.checked[feature] < 10000;
  if (!force && fresh) return Promise.resolve();
  const entry = { controller: new AbortController(), subscribers: new Set(), retained: false };
  const started = performance.now();
  if (feature === "optimization") owner.optimizationRevision++;
  store.probing[feature] = true;
  entry.promise = read(optional[feature], owner, entry.controller, feature === "optimization" ? 25000 : 7000)
    .then(value => {
      if (!current(store, owner) || owner.probes.get(feature) !== entry) return;
      if (feature === "optimization") {
        const checked = checkedOptimization(value);
        owner.optimizationRevision++;
        publishOptimization(store, owner, checked, started);
      }
      else store[feature] = value;
      owner.checked[feature] = Date.now();
    }).catch(() => {
      if (!current(store, owner) || owner.probes.get(feature) !== entry
          || entry.controller.signal.aborted && !entry.subscribers.size && !entry.retained) return;
      if (feature === "optimization") {
        owner.optimizationRevision++;
        publishOptimization(store, owner, { ready: false, reason: "服务未就绪",
          configured: store.optimization?.configured === true, fresh_for_seconds: 0 }, started);
      }
      else store[feature] = null;
    }).finally(() => {
      if (current(store, owner) && owner.probes.get(feature) === entry) {
        owner.probes.delete(feature);
        store.probing[feature] = false;
      }
    });
  owner.probes.set(feature, entry);
  return subscribe(entry, signal);
}

export function refreshWorkspace(store, force = false, coreOnly = false) {
  const owner = ownerFor(store);
  if (!owner) return Promise.resolve();
  const ready = refreshCore(store, owner, force);
  if (coreOnly) return ready;
  if (owner.all) return owner.all;
  const pending = Promise.all([ready, refreshFeature(store, "templates", force),
    refreshFeature(store, "references", force)]).finally(() => {
    if (current(store, owner) && owner.all === pending) {
      owner.all = null;
      loading(store, owner);
    }
  });
  owner.all = pending;
  loading(store, owner);
  return pending;
}

export function reconnectWorkspace(store) {
  let owner = ownerFor(store);
  if (!owner) return Promise.resolve();
  if (owner.reconnect) return owner.reconnect;
  stopWorkspaceProbes(store);
  owner = ownerFor(store);
  if (!owner) return Promise.resolve();
  const pending = refreshWorkspace(store, true).finally(() => {
    if (current(store, owner)) owner.reconnect = null;
  });
  owner.reconnect = pending;
  return pending;
}
