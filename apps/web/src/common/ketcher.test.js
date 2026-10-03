import { EventEmitter } from "node:events";
import {
  KETCHER_URL,
  createKetcherWriter,
  replaceKetcherMolecule,
  waitForKetcher,
} from "./ketcher";

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
