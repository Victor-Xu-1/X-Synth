import { EventEmitter } from "node:events";
import { effectScope, nextTick, ref } from "vue";
import { useKetcherMolecule } from "./useKetcherMolecule";

// Native doubles exercise the real write/read queues, not chemical parsing.
function nativeEditor() {
  const eventBus = new EventEmitter(), changes = new Set();
  let canvas = "";
  const changed = () => changes.forEach(callback => callback());
  return {
    eventBus,
    setMolecule: jest.fn(value => queueMicrotask(() => {
      if (value === "C1CC") eventBus.emit("FAILURE");
      else { canvas = value; changed(); eventBus.emit("SUCCESS"); }
    })),
    getSmiles: jest.fn(async () => canvas),
    draw: value => { canvas = value; changed(); },
    editor: {
      clear: jest.fn(() => { canvas = ""; changed(); }),
      subscribe: jest.fn((event, callback) => { changes.add(callback); return callback; }),
      unsubscribe: jest.fn((event, callback) => changes.delete(callback)),
    },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

let lifetime, scope;
beforeEach(() => {
  jest.useFakeTimers();
  lifetime = new AbortController();
  scope = effectScope();
});
afterEach(() => {
  lifetime.abort();
  scope.stop();
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function setup(options = {}) {
  const smiles = ref("CCO"), disabled = ref(false), native = nativeEditor();
  const fresh = nativeEditor(), commit = jest.fn();
  let owner = native;
  const getEditor = jest.fn(async () => owner);
  const reloadEditor = jest.fn(async () => { owner = fresh; return owner; });
  const control = scope.run(() => useKetcherMolecule({
    smiles, getEditor, reloadEditor, signal: lifetime.signal,
    getWindow: () => window, autoSync: () => true, disabled: () => disabled.value,
    fitDrawing: jest.fn(async () => {}), captureFocus: jest.fn(), commit, ...options,
  }));
  const initialized = control.initialize();
  await jest.advanceTimersByTimeAsync(0);
  await initialized;
  return { control, smiles, disabled, native, fresh, commit, getEditor, reloadEditor };
}

async function failImport(state) {
  state.smiles.value = "C1CC";
  await jest.advanceTimersByTimeAsync(0);
  expect(state.control.ready.value).toBe(true);
  expect(state.control.busy.value).toBe(false);
  expect(state.control.error.value).not.toBe("");
  expect(state.control.pending.value).toBe(true);
}

test("a genuine drawing change recovers both rejected import barriers without restoring invalid text", async () => {
  const state = await setup();
  await failImport(state);
  state.native.draw("CCN");
  await jest.advanceTimersByTimeAsync(250);
  expect(state.smiles.value).toBe("CCN");
  expect(state.control.error.value).toBe("");
  expect(state.control.pending.value).toBe(false);
  expect(state.commit).toHaveBeenCalledWith("CCN");
  expect(state.native.setMolecule.mock.calls).toEqual([["CCO"], ["C1CC"]]);

  state.native.draw("[13CH3][C@H]([NH3+])CO.[Cl-]");
  await jest.advanceTimersByTimeAsync(250);
  expect(state.smiles.value).toBe("[13CH3][C@H]([NH3+])CO.[Cl-]");
  expect(state.control.pending.value).toBe(false);
  const reading = state.control.readSmilesFromEditor();
  await jest.advanceTimersByTimeAsync(0);
  expect(await reading).toBe(state.smiles.value);
  expect(state.native.setMolecule).toHaveBeenCalledTimes(2);
});

test("manual recovery keeps an explicit error until the fresh read succeeds and retries that canvas", async () => {
  const state = await setup();
  await failImport(state);
  state.native.getSmiles.mockRejectedValueOnce(new Error("native export failed"));
  state.native.draw("CCN");
  expect(state.control.error.value).not.toBe("");
  await jest.advanceTimersByTimeAsync(250);
  expect(state.control.error.value).toBe("结构读取失败，请检查画板内容。");
  expect(state.control.pending.value).toBe(true);
  expect(state.smiles.value).toBe("C1CC");
  expect(state.commit).not.toHaveBeenCalled();
  const retry = state.control.retryFailedOperation();
  await jest.advanceTimersByTimeAsync(0);
  await retry;
  expect(state.smiles.value).toBe("CCN");
  expect(state.control.error.value).toBe("");
  expect(state.control.pending.value).toBe(false);
  expect(state.native.setMolecule).toHaveBeenCalledTimes(2);
});

test("a settled failed verification is retired only by a fresh drawing and its current reader", async () => {
  const afterImport = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("verification failed"));
  const published = jest.fn();
  const state = await setup({ afterImport, onPublished: published });
  const writing = state.control.setSmilesToEditor("CCC");
  const failure = expect(writing).rejects.toThrow("verification failed");
  await jest.advanceTimersByTimeAsync(0);
  await failure;
  expect(state.control.error.value).not.toBe("");
  state.native.draw("CCN");
  await jest.advanceTimersByTimeAsync(250);
  expect(state.smiles.value).toBe("CCN");
  expect(published).toHaveBeenCalledWith({ text: "CCN" });
  expect(state.control.pending.value).toBe(false);
  expect(afterImport).toHaveBeenCalledTimes(2);
  expect(state.native.setMolecule).toHaveBeenCalledTimes(2);
});

test("reads without a genuine drawing change keep the failed import visible and cannot confirm the old canvas", async () => {
  const state = await setup();
  await failImport(state);
  const error = state.control.error.value;
  const reading = state.control.readSmilesFromEditor();
  await jest.advanceTimersByTimeAsync(0);
  expect(await reading).toBeNull();
  expect(state.control.error.value).toBe(error);
  expect(state.control.pending.value).toBe(true);
  expect(state.commit).not.toHaveBeenCalled();
  expect(state.native.getSmiles).not.toHaveBeenCalled();
});

test("explicit clear recovers a failed import only after its owned native write succeeds", async () => {
  const state = await setup();
  await failImport(state);
  const clearing = state.control.clearEditor();
  await jest.advanceTimersByTimeAsync(0);
  await clearing;
  expect(state.native.editor.clear).toHaveBeenCalledTimes(1);
  expect(state.smiles.value).toBe("");
  expect(state.commit.mock.calls).toEqual([[""]]);
  expect(state.control.error.value).toBe("");
  expect(state.control.pending.value).toBe(false);
});

test("a failed native clear cannot publish an empty fallback after an import error", async () => {
  const state = await setup();
  await failImport(state);
  state.native.editor.clear.mockImplementationOnce(() => { throw new Error("native clear failed"); });
  const clearing = state.control.clearEditor();
  await jest.advanceTimersByTimeAsync(0);
  await clearing;
  expect(state.smiles.value).toBe("C1CC");
  expect(state.commit).not.toHaveBeenCalled();
  expect(state.control.error.value).not.toBe("");
  expect(state.control.pending.value).toBe(true);
});

test("a replacement text write supersedes manual recovery and preserves only the new confirmed input", async () => {
  const state = await setup();
  await failImport(state);
  state.native.draw("CCN");
  state.smiles.value = "CCCl";
  await jest.advanceTimersByTimeAsync(300);
  expect(state.smiles.value).toBe("CCCl");
  expect(state.native.setMolecule).toHaveBeenLastCalledWith("CCCl");
  expect(state.native.getSmiles).not.toHaveBeenCalled();
  expect(state.commit).not.toHaveBeenCalled();
  expect(state.control.pending.value).toBe(false);
});

test("an obsolete recovery export cannot publish over a newer drawing", async () => {
  const state = await setup(), old = deferred();
  await failImport(state);
  state.native.getSmiles.mockReturnValueOnce(old.promise);
  state.native.draw("CCN");
  await jest.advanceTimersByTimeAsync(250);
  expect(state.native.getSmiles).toHaveBeenCalledTimes(1);
  state.native.draw("CCCl");
  await jest.advanceTimersByTimeAsync(250);
  expect(state.commit).not.toHaveBeenCalled();
  expect(state.native.getSmiles).toHaveBeenCalledTimes(1);
  old.resolve("CCN");
  await jest.advanceTimersByTimeAsync(0);
  expect(state.commit.mock.calls).toEqual([["CCCl"]]);
  expect(state.smiles.value).toBe("CCCl");
  expect(state.control.pending.value).toBe(false);
});

test("interrupted imports cannot recover through native changes and require a fresh editor", async () => {
  const state = await setup();
  state.native.setMolecule.mockImplementation(() => Promise.resolve());
  state.smiles.value = "CCN";
  await jest.advanceTimersByTimeAsync(18000);
  expect(state.control.reloadRequired.value).toBe(true);
  expect(state.control.ready.value).toBe(false);
  const error = state.control.error.value;
  state.native.draw("CCC");
  await jest.advanceTimersByTimeAsync(300);
  expect(state.control.error.value).toBe(error);
  expect(state.control.pending.value).toBe(true);
  expect(state.native.getSmiles).not.toHaveBeenCalled();
  expect(state.commit).not.toHaveBeenCalled();
  const retry = state.control.retryFailedOperation();
  await jest.advanceTimersByTimeAsync(0);
  await retry;
  expect(state.reloadEditor).toHaveBeenCalledTimes(1);
  expect(state.fresh.setMolecule).toHaveBeenCalledWith("CCN");
  expect(state.control.pending.value).toBe(false);
});

test("a recovery read cannot publish through a changed editor owner", async () => {
  const state = await setup();
  await failImport(state);
  state.getEditor.mockResolvedValueOnce(state.fresh);
  state.native.draw("CCN");
  await jest.advanceTimersByTimeAsync(250);
  expect(state.control.reloadRequired.value).toBe(true);
  expect(state.control.ready.value).toBe(false);
  expect(state.control.pending.value).toBe(true);
  expect(state.commit).not.toHaveBeenCalled();
  expect(state.fresh.getSmiles).not.toHaveBeenCalled();
});

test("disposing manual recovery retires its scheduled read without publishing", async () => {
  const state = await setup();
  await failImport(state);
  state.native.draw("CCN");
  lifetime.abort();
  await jest.advanceTimersByTimeAsync(300);
  await nextTick();
  expect(state.commit).not.toHaveBeenCalled();
  expect(state.native.getSmiles).not.toHaveBeenCalled();
});
