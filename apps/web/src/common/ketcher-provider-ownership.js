// This self-contained function is injected at the reviewed native provider factory.
export function ownKetcherProvider(service, commands) {
  const bus = service.EE;
  const worker = service.worker;
  if (["listeners", "once", "removeListener"].some(name => typeof bus?.[name] !== "function") ||
      ["addEventListener", "removeEventListener", "terminate"].some(name => typeof worker?.[name] !== "function") ||
      Object.keys(commands).some(name => typeof service[name] !== "function")) {
    throw new Error("Unreviewed Ketcher worker interface");
  }
  const queue = [];
  let active = null;
  let retired = null;
  let suspended = false;
  // Normalize once-listener identities without reaching into emitter internals.
  const listeners = event => bus.listeners(event).map(callback => callback.listener || callback);

  function cleanup(job) {
    for (const callback of job.callbacks) bus.removeListener(job.event, callback);
    if (job.guard) bus.removeListener(job.event, job.guard);
  }

  function retire(error) {
    if (retired) return;
    retired = error;
    worker.removeEventListener("error", failed);
    worker.removeEventListener("messageerror", failed);
    globalThis.removeEventListener?.("pagehide", departed);
    globalThis.removeEventListener?.("pageshow", returned);
    worker.terminate();
    if (active) {
      cleanup(active);
      active.reject(error);
      active = null;
    }
    for (const job of queue.splice(0)) job.reject(error);
  }

  function failed() { retire(new Error("Ketcher worker failed; reload the editor")); }
  function departed(event) {
    if (event.persisted) { suspended = true; return; }
    retire(new Error("Ketcher frame was unloaded"));
  }
  function returned(event) {
    if (!event.persisted || retired) return;
    suspended = false;
    pump();
  }

  function finish(job, succeeded, value) {
    if (active !== job) return;
    cleanup(job);
    active = null;
    if (succeeded) job.resolve(value);
    else job.reject(value);
    queueMicrotask(pump);
  }

  function pump() {
    if (active || retired || suspended || !queue.length) return;
    const job = active = queue.shift();
    const before = new Set(listeners(job.event));
    let result;
    try { result = job.method.apply(service, job.args); }
    catch (error) {
      job.callbacks = listeners(job.event).filter(callback => !before.has(callback));
      finish(job, false, error);
      return;
    }
    job.callbacks = listeners(job.event).filter(callback => !before.has(callback));
    // The pinned provider registers one synchronous callback per worker command.
    if (job.callbacks.length !== 1) {
      Promise.resolve(result).catch(() => {});
      retire(new Error("Unreviewed Ketcher worker response ownership"));
      return;
    }
    const callback = job.callbacks[0];
    bus.removeListener(job.event, callback);
    job.guard = response => {
      if (active !== job) return;
      try { callback.call(bus, response); }
      catch (error) { finish(job, false, error); }
    };
    bus.once(job.event, job.guard);
    Promise.resolve(result).then(
      value => finish(job, true, value),
      error => finish(job, false, error),
    );
  }

  for (const [name, event] of Object.entries(commands)) {
    const method = service[name];
    service[name] = function (...args) {
      return new Promise((resolve, reject) => {
        if (retired) return reject(retired);
        queue.push({ method, event, args, resolve, reject, callbacks: [], guard: null });
        pump();
      });
    };
  }
  worker.addEventListener("error", failed);
  worker.addEventListener("messageerror", failed);
  globalThis.addEventListener?.("pagehide", departed);
  globalThis.addEventListener?.("pageshow", returned);
  return service;
}
