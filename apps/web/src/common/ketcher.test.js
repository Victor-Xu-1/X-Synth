import { EventEmitter } from "node:events";
import {
  KETCHER_URL,
  KetcherImportInterruptedError,
  createKetcherWriter,
  replaceKetcherMolecule,
  waitForKetcher,
} from "./ketcher";
import { runKetcherOperation } from "./ketcher-native-operations";

function importProtocol() {
  const eventBus = new EventEmitter();
  const calls = [];
  let clears = 0;
  return {
    eventBus,
    calls,
    setMolecule(value) {
      calls.push(value);
      queueMicrotask(() => eventBus.emit("SUCCESS"));
      return Promise.resolve();
    },
    editor: {
      clear() {
        clears++;
      },
    },
    clearCount: () => clears,
  };
}

test("Ketcher URL resolves to the bundled standalone editor", () => {
  const fs = require("fs");
  const path = require("path");
  expect(
    fs.existsSync(
      path.resolve(__dirname, "../../public", KETCHER_URL.slice(1)),
    ),
  ).toBe(true);
});

test("readiness follows the installed editor API rather than a legacy ready flag", async () => {
  const ketcher = { editor: {}, setMolecule: jest.fn(), getSmiles: jest.fn() };
  expect(await waitForKetcher(() => ({ contentWindow: { ketcher } }))).toBe(
    ketcher,
  );
});

test("readiness stops when its owner is unmounted", async () => {
  const controller = new AbortController();
  const result = waitForKetcher(() => null, { signal: controller.signal });
  controller.abort();
  await expect(result).rejects.toThrow("cancelled");
});

test("unavailable editor has a bounded wait", async () => {
  await expect(waitForKetcher(() => null, { timeoutMs: 0 })).rejects.toThrow(
    "did not become ready",
  );
});

test("replacement awaits import and uses the editor clear API for empty structures", async () => {
  const ketcher = importProtocol();
  await replaceKetcherMolecule(ketcher, "CCO");
  expect(ketcher.calls).toEqual(["CCO"]);
  await replaceKetcherMolecule(ketcher, "");
  expect(ketcher.clearCount()).toBe(1);
});

test("queued updates coalesce to the latest structure and recover after invalid input", async () => {
  const ketcher = importProtocol();
  const write = createKetcherWriter(async () => ketcher);
  const first = write("CCO");
  const latest = write("CCC");
  expect(await first).toBe(false);
  expect(await latest).toBe(true);
  expect(await write.flush()).toBe(true);
  expect(ketcher.calls).toEqual(["CCC"]);
  const original = ketcher.setMolecule;
  ketcher.setMolecule = () => Promise.reject(new Error("Invalid molecule"));
  await expect(write("invalid")).rejects.toThrow("Invalid molecule");
  await expect(write.flush()).rejects.toThrow("Invalid molecule");
  ketcher.setMolecule = original;
  expect(await write("CCN")).toBe(true);
});

test("an early-resolving import promise does not release readers before SUCCESS", async () => {
  const eventBus = new EventEmitter();
  const write = createKetcherWriter(async () => ({
    eventBus,
    setMolecule: () => Promise.resolve(),
  }));
  const result = write("CCO");
  let settled = false;
  result.then(() => (settled = true));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(eventBus.listenerCount("SUCCESS")).toBe(1);
  eventBus.emit("SUCCESS");
  expect(await write.flush()).toBe(true);
  expect(eventBus.eventNames()).toEqual([]);
});

test("failed and cancelled imports remove their listeners without claiming success", async () => {
  const ketcher = importProtocol();
  ketcher.setMolecule = () => Promise.resolve();
  const failure = replaceKetcherMolecule(ketcher, "invalid");
  await Promise.resolve();
  expect(ketcher.eventBus.listenerCount("FAILURE")).toBe(1);
  ketcher.eventBus.emit("FAILURE");
  await expect(failure).rejects.toThrow("import failed");
  expect(ketcher.eventBus.eventNames()).toEqual([]);
  const controller = new AbortController();
  const cancelled = replaceKetcherMolecule(ketcher, "CCO", {
    signal: controller.signal,
  });
  controller.abort();
  await expect(cancelled).rejects.toThrow("cancelled");
  expect(ketcher.eventBus.eventNames()).toEqual([]);
  await expect(replaceKetcherMolecule(ketcher, "CCN")).rejects.toThrow(
    "reloaded",
  );
  const timed = importProtocol();
  timed.setMolecule = () => Promise.resolve();
  await expect(
    replaceKetcherMolecule(timed, "CCO", { timeoutMs: 1 }),
  ).rejects.toThrow("timed out");
  expect(timed.eventBus.eventNames()).toEqual([]);
  timed.eventBus.emit("SUCCESS");
  await expect(replaceKetcherMolecule(timed, "CCN")).rejects.toThrow(
    "reloaded",
  );
  await expect(
    replaceKetcherMolecule(importProtocol(), "CCN"),
  ).resolves.toBeUndefined();
});

test("actual owner pagehide interrupts its pending import without awaiting the timeout", async () => {
  const owner = new EventTarget();
  const native = importProtocol();
  native.setMolecule = () => Promise.resolve();
  const result = replaceKetcherMolecule(native, "CCN", { getWindow: () => owner });
  owner.dispatchEvent(new Event("pagehide"));
  await expect(result).rejects.toBeInstanceOf(KetcherImportInterruptedError);
  expect(native.eventBus.eventNames()).toEqual([]);
  await expect(replaceKetcherMolecule(native, "CCO")).rejects.toBeInstanceOf(KetcherImportInterruptedError);
});

test("queued import listens only after the same-owner export ends and awaits real terminal completion", async () => {
  const native = importProtocol();
  native.setMolecule = jest.fn(() => Promise.resolve());
  let finishExport;
  const exporting = runKetcherOperation(native, () => new Promise(resolve => { finishExport = resolve; }));
  await Promise.resolve();
  const imported = replaceKetcherMolecule(native, "RXN input");
  let finished = false; imported.then(() => { finished = true; });
  expect(native.eventBus.listenerCount("SUCCESS")).toBe(0);
  expect(native.setMolecule).not.toHaveBeenCalled();
  finishExport("old export"); await exporting;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(native.setMolecule).toHaveBeenCalledTimes(1);
  expect(finished).toBe(false);
  native.eventBus.emit("SUCCESS"); await imported;
  expect(finished).toBe(true);
});

test("the import deadline covers native queue waiting and a retired queued import never starts", async () => {
  const native = importProtocol();
  let finishExport;
  const exporting = runKetcherOperation(native, () => new Promise(resolve => { finishExport = resolve; }));
  await Promise.resolve();
  await expect(replaceKetcherMolecule(native, "RXN input", { timeoutMs: 1 }))
    .rejects.toBeInstanceOf(KetcherImportInterruptedError);
  finishExport("old export"); await exporting;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(native.calls).toEqual([]);
  expect(native.eventBus.eventNames()).toEqual([]);
});

test("a queued import rechecks whether an earlier import made the native owner unsafe", async () => {
  const native = importProtocol();
  native.setMolecule = value => { native.calls.push(value); return Promise.resolve(); };
  const first = replaceKetcherMolecule(native, "CCO", { timeoutMs: 5 });
  const second = replaceKetcherMolecule(native, "CCN", { timeoutMs: 30 });
  let outcome = "pending";
  second.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
  await expect(first).rejects.toBeInstanceOf(KetcherImportInterruptedError);
  await new Promise(resolve => setTimeout(resolve, 0));
  native.eventBus.emit("SUCCESS");
  await second.catch(() => {});
  expect(native.calls).toEqual(["CCO"]);
  expect(outcome).toBe("rejected");
});
