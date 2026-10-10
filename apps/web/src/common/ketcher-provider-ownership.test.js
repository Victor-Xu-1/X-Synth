import { EventEmitter } from "node:events";
import { ownKetcherProvider } from "./ketcher-provider-ownership";

function provider() {
  const EE = new EventEmitter();
  const worker = Object.assign(new EventTarget(), { terminate: jest.fn() });
  const sent = [];
  const service = { EE, worker, untouched: () => "unsupported" };
  for (const name of ["convert", "layout"]) {
    service[name] = function (...args) {
      return new Promise((resolve, reject) => {
        const callback = response => response.error ? reject(response.error) : resolve(response);
        EE.removeListener(name, callback);
        EE.addListener(name, callback);
        sent.push({ name, args, receiver: this });
      });
    };
  }
  return { service, EE, worker, sent };
}

const commands = { convert: "convert", layout: "layout" };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => globalThis.dispatchEvent(new Event("pagehide")));

test("different simultaneous requests keep exact response, arguments and receiver ownership", async () => {
  const p = provider();
  ownKetcherProvider(p.service, commands);
  const options = { format: "A" };
  const first = p.service.convert("input A", options);
  const second = p.service.convert("input B", { format: "B" });
  expect(p.sent).toHaveLength(1);
  expect(p.sent[0]).toEqual({ name: "convert", args: ["input A", options], receiver: p.service });
  const a = { payload: "response A" };
  p.EE.emit("convert", a);
  expect(await first).toBe(a);
  await tick();
  expect(p.sent[1].args[0]).toBe("input B");
  const b = { payload: "response B" };
  p.EE.emit("convert", b);
  expect(await second).toBe(b);
  expect(p.EE.listenerCount("convert")).toBe(0);
  expect(p.EE.getMaxListeners()).toBe(10);
});

test("all command types share the same worker lane without wrapping unsupported operations", async () => {
  const p = provider(), unchanged = p.service.untouched;
  ownKetcherProvider(p.service, commands);
  const first = p.service.convert("A"), second = p.service.layout("B");
  expect(p.sent).toHaveLength(1);
  p.EE.emit("convert", { payload: "A" }); await first; await tick();
  expect(p.sent[1].name).toBe("layout");
  p.EE.emit("layout", { payload: "B" }); await second;
  expect(p.service.untouched).toBe(unchanged);
});

test("repeated settled callbacks are removed, while another owner's callback survives", async () => {
  const p = provider(), peer = jest.fn();
  p.EE.on("convert", peer);
  ownKetcherProvider(p.service, commands);
  for (let index = 0; index < 25; index++) {
    const result = p.service.convert(index);
    p.EE.emit("convert", { index }); await result;
    expect(p.EE.rawListeners("convert")).toEqual([peer]);
  }
  expect(peer).toHaveBeenCalledTimes(25);
});

test("native rejection cleans up and does not block the next request", async () => {
  const p = provider(); ownKetcherProvider(p.service, commands);
  const error = new Error("native validation");
  const first = p.service.convert("invalid"), second = p.service.convert("valid");
  const failure = expect(first).rejects.toBe(error);
  p.EE.emit("convert", { error }); await failure; await tick();
  p.EE.emit("convert", { payload: "valid" });
  await expect(second).resolves.toEqual({ payload: "valid" });
  expect(p.EE.listenerCount("convert")).toBe(0);
});

test("once-listener identity normalization keeps peer ownership", async () => {
  const p = provider(), peer = jest.fn();
  p.EE.listeners = event => {
    const callbacks = p.EE.rawListeners(event);
    return callbacks.length === 1 ? [callbacks[0].listener || callbacks[0]] : callbacks;
  };
  p.EE.once("convert", peer);
  ownKetcherProvider(p.service, commands);
  const result = p.service.convert("A");
  const response = { payload: "A" };
  p.EE.emit("convert", response);
  expect(await result).toBe(response);
  expect(peer).toHaveBeenCalledTimes(1);
  expect(p.worker.terminate).not.toHaveBeenCalled();
  expect(p.EE.listenerCount("convert")).toBe(0);
});

test("persisted pagehide suspends new dispatch without abandoning active response ownership", async () => {
  const p = provider(); ownKetcherProvider(p.service, commands);
  const first = p.service.convert("A"), second = p.service.convert("B");
  globalThis.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  p.EE.emit("convert", { payload: "A" }); await first; await tick();
  expect(p.sent).toHaveLength(1);
  expect(p.worker.terminate).not.toHaveBeenCalled();
  globalThis.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  expect(p.sent).toHaveLength(2);
  p.EE.emit("convert", { payload: "B" }); await second;
  globalThis.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  expect(p.worker.terminate).toHaveBeenCalledTimes(1);
  await expect(p.service.convert("C")).rejects.toThrow("unloaded");
});

test("a retired provider cannot be revived by persisted pageshow", async () => {
  const p = provider(); ownKetcherProvider(p.service, commands);
  p.worker.dispatchEvent(new Event("messageerror"));
  globalThis.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  await expect(p.service.convert("A")).rejects.toThrow("failed");
  expect(p.sent).toHaveLength(0);
});

test("synchronous dispatch error cleans introduced callbacks and leaves peers intact", async () => {
  const p = provider(), peer = jest.fn(), error = new Error("dispatch rejected");
  p.EE.on("convert", peer);
  p.service.convert = () => { p.EE.on("convert", () => {}); throw error; };
  ownKetcherProvider(p.service, commands);
  await expect(p.service.convert("A")).rejects.toBe(error);
  expect(p.EE.rawListeners("convert")).toEqual([peer]);
});

test.each([undefined, null, "native error"])("native rejection preserves an arbitrary reason: %s", async reason => {
  const p = provider();
  p.service.convert = () => new Promise((resolve, reject) => p.EE.on("convert", () => reject(reason)));
  ownKetcherProvider(p.service, commands);
  const result = p.service.convert("A");
  const check = result.then(() => { throw new Error("Unexpected success"); }, error => expect(error).toBe(reason));
  p.EE.emit("convert", {}); await check;
  expect(p.EE.listenerCount("convert")).toBe(0);
});

test("a malformed native response becomes a rejection rather than a hanging lane", async () => {
  const p = provider(), error = new Error("malformed native payload");
  p.service.convert = () => new Promise(() => p.EE.on("convert", () => { throw error; }));
  ownKetcherProvider(p.service, commands);
  const first = p.service.convert("A"), next = p.service.layout("B");
  const failure = expect(first).rejects.toBe(error);
  expect(() => p.EE.emit("convert", {})).not.toThrow();
  await failure; await tick();
  p.EE.emit("layout", { payload: "B" }); await next;
  expect(p.EE.listenerCount("convert")).toBe(0);
});

test.each(["error", "messageerror", "pagehide"])("%s retires active and queued work and cannot reuse the worker", async type => {
  const p = provider(), peer = jest.fn();
  p.EE.on("convert", peer); ownKetcherProvider(p.service, commands);
  const first = p.service.convert("A"), second = p.service.layout("B");
  const failures = Promise.all([expect(first).rejects.toThrow(), expect(second).rejects.toThrow()]);
  (type === "pagehide" ? globalThis : p.worker).dispatchEvent(new Event(type));
  await failures;
  expect(p.worker.terminate).toHaveBeenCalledTimes(1);
  expect(p.sent).toHaveLength(1);
  expect(p.EE.rawListeners("convert")).toEqual([peer]);
  p.EE.emit("convert", { payload: "late" });
  await expect(p.service.convert("C")).rejects.toThrow();
  expect(p.sent).toHaveLength(1);
});

test("independent provider instances do not serialize each other's work", async () => {
  const a = provider(), b = provider();
  ownKetcherProvider(a.service, commands); ownKetcherProvider(b.service, commands);
  const first = a.service.convert("A"), second = b.service.convert("B");
  expect(a.sent).toHaveLength(1); expect(b.sent).toHaveLength(1);
  b.EE.emit("convert", { payload: "B" }); a.EE.emit("convert", { payload: "A" });
  await Promise.all([first, second]);
});

test("a peer enqueueing during response dispatch cannot start a nested native command", async () => {
  const p = provider(); ownKetcherProvider(p.service, commands);
  let second;
  p.EE.once("convert", () => {
    second = p.service.layout("B");
    expect(p.sent).toHaveLength(1);
  });
  const first = p.service.convert("A");
  p.EE.emit("convert", { payload: "A" }); await first; await tick();
  expect(p.sent).toHaveLength(2);
  p.EE.emit("layout", { payload: "B" }); await second;
});

test("retirement during a response dispatch excludes its already-copied guard", async () => {
  const p = provider(); ownKetcherProvider(p.service, commands);
  p.EE.once("convert", () => p.worker.dispatchEvent(new Event("error")));
  const result = p.service.convert("A"), failure = expect(result).rejects.toThrow("failed");
  p.EE.emit("convert", { payload: "late" }); await failure;
  expect(p.EE.listenerCount("convert")).toBe(0);
  expect(p.worker.terminate).toHaveBeenCalledTimes(1);
});

test("a duplicate response before the next dispatch cannot settle the next owner", async () => {
  const p = provider(); ownKetcherProvider(p.service, commands);
  const first = p.service.convert("A"), second = p.service.convert("B");
  const a = { payload: "A" }, b = { payload: "B" };
  p.EE.emit("convert", a); p.EE.emit("convert", a);
  expect(await first).toBe(a); await tick();
  expect(p.sent).toHaveLength(2);
  p.EE.emit("convert", b); expect(await second).toBe(b);
});

test("unexpected asynchronous registration fails closed instead of reusing uncorrelated responses", async () => {
  const p = provider(); p.service.convert = () => Promise.resolve("unreviewed");
  ownKetcherProvider(p.service, commands);
  await expect(p.service.convert("A")).rejects.toThrow("response ownership");
  expect(p.worker.terminate).toHaveBeenCalledTimes(1);
  await expect(p.service.layout("B")).rejects.toThrow("response ownership");
  expect(p.sent).toHaveLength(0);
});

test("an unreviewed provider shape is rejected before mutation", () => {
  const p = provider(), original = p.service.convert;
  expect(() => ownKetcherProvider(p.service, { missing: "missing" })).toThrow("worker interface");
  expect(p.service.convert).toBe(original);
});
