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

test("post-write verification failure quarantines the canvas until its context is confirmed after reload", async () => {
  const afterImport = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("verification failed"));
  const published = jest.fn(), applied = jest.fn(), reader = jest.fn(async editor => ({ text: await editor.getSmiles(), kind: "reaction" }));
  const state = await setup({ afterImport, onPublished: published, onApplied: applied, readStructure: reader });
  const writing = state.control.setSmilesToEditor("CCC");
  const failure = expect(writing).rejects.toThrow("verification failed");
  await jest.advanceTimersByTimeAsync(0);
  await failure;
  expect(state.control.error.value).not.toBe("");
  const error = state.control.error.value;
  expect(state.control.reloadRequired.value).toBe(true);
  expect(state.control.ready.value).toBe(false);
  state.native.draw("CCN");
  await jest.advanceTimersByTimeAsync(250);
  expect(state.smiles.value).toBe("CCO");
  expect(state.control.error.value).toBe(error);
  expect(reader).not.toHaveBeenCalled();
  expect(published).not.toHaveBeenCalled();
  expect(applied.mock.calls).toEqual([["CCO"]]);
  expect(state.control.pending.value).toBe(true);
  expect(afterImport).toHaveBeenCalledTimes(2);
  expect(state.native.setMolecule).toHaveBeenCalledTimes(2);
  const retry = state.control.retryFailedOperation();
  await jest.advanceTimersByTimeAsync(0);
  await retry;
  expect(state.reloadEditor).toHaveBeenCalledTimes(1);
  expect(applied.mock.calls).toEqual([["CCO"], ["CCO"]]);
  expect(state.control.pending.value).toBe(false);
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

test("disabling a deferred recovery read prevents publication until a current read after re-enabling", async () => {
  const state = await setup(), old = deferred();
  await failImport(state);
  state.native.getSmiles.mockReturnValueOnce(old.promise);
  state.native.draw("CCN");
  await jest.advanceTimersByTimeAsync(250);
  state.disabled.value = true;
  old.resolve("CCN");
  await jest.advanceTimersByTimeAsync(0);
  expect(state.commit).not.toHaveBeenCalled();
  expect(state.control.pending.value).toBe(true);
  state.disabled.value = false;
  await jest.advanceTimersByTimeAsync(0);
  expect(state.commit.mock.calls).toEqual([["CCN"]]);
  expect(state.control.pending.value).toBe(false);
});

test("text replaced while a fresh editor is loading is the only confirmed input after reload", async () => {
  const replacement = deferred();
  const afterImport = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("unverified context")).mockResolvedValue(undefined);
  const state = await setup({ afterImport });
  state.smiles.value = "CCN";
  const writing = state.control.setSmilesToEditor();
  const failed = expect(writing).rejects.toThrow("unverified context");
  await jest.advanceTimersByTimeAsync(10);
  await failed;
  expect(state.control.reloadRequired.value).toBe(true);
  state.reloadEditor.mockReturnValueOnce(replacement.promise);
  // During a real frame reload both acquisition paths wait for that new owner.
  state.getEditor.mockImplementation(() => replacement.promise);
  const retry = state.control.retryFailedOperation();
  state.smiles.value = "CCCl";
  await jest.advanceTimersByTimeAsync(0);
  replacement.resolve(state.fresh);
  state.getEditor.mockResolvedValue(state.fresh);
  await jest.advanceTimersByTimeAsync(32);
  await retry;
  expect(state.fresh.setMolecule).toHaveBeenLastCalledWith("CCCl");
  expect(state.fresh.setMolecule).toHaveBeenCalledTimes(1);
  expect(state.smiles.value).toBe("CCCl");
  expect(state.control.pending.value).toBe(false);
  expect(state.commit).not.toHaveBeenCalled();
});

test("a superseded native write remains unverified if replacement preparation fails", async () => {
  const verification = deferred(), applied = jest.fn();
  const afterImport = jest.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(() => verification.promise);
  const state = await setup({ afterImport, onApplied: applied,
    editorContent: value => { if (value === "bad-preparation") throw new Error("preparation failed"); return value; } });
  const writing = state.control.setSmilesToEditor("CCC");
  await jest.advanceTimersByTimeAsync(32);
  expect(afterImport).toHaveBeenCalledTimes(2);
  state.smiles.value = "bad-preparation";
  verification.resolve();
  await jest.advanceTimersByTimeAsync(32);
  expect(await writing).toBe(false);
  expect(state.control.reloadRequired.value).toBe(true);
  expect(state.control.ready.value).toBe(false);
  state.native.draw("CCN");
  await jest.advanceTimersByTimeAsync(300);
  expect(state.native.getSmiles).not.toHaveBeenCalled();
  expect(state.commit).not.toHaveBeenCalled();
  expect(applied.mock.calls).toEqual([["CCO"]]);
  expect(state.smiles.value).toBe("bad-preparation");
});

test("text revisions during cold acquisition do not hide acquisition failure or its retry", async () => {
  const acquisition = deferred(), smiles = ref("CCO"), native = nativeEditor();
  const getEditor = jest.fn(() => acquisition.promise);
  const control = scope.run(() => useKetcherMolecule({ smiles, getEditor, signal: lifetime.signal,
    autoSync: () => true, disabled: () => false, getWindow: () => window,
    fitDrawing: jest.fn(async () => {}), captureFocus: jest.fn(), commit: jest.fn() }));
  const initial = control.initialize();
  smiles.value = "CCN";
  acquisition.reject(new Error("editor unavailable"));
  await initial;
  expect(control.error.value).not.toBe("");
  expect(control.ready.value).toBe(false);
  expect(control.busy.value).toBe(false);
  getEditor.mockResolvedValue(native);
  const retry = control.retryFailedOperation();
  await jest.advanceTimersByTimeAsync(32);
  await retry;
  expect(native.setMolecule).toHaveBeenCalledWith("CCN");
  expect(control.pending.value).toBe(false);
});

test("text revisions during reload acquisition keep failure visible and retry the latest input", async () => {
  const state = await setup(), acquisition = deferred();
  state.native.setMolecule.mockImplementation(() => Promise.resolve());
  state.smiles.value = "CCN";
  await jest.advanceTimersByTimeAsync(18000);
  state.reloadEditor.mockReturnValueOnce(acquisition.promise);
  const loading = state.control.retryFailedOperation();
  state.smiles.value = "CCCl";
  acquisition.reject(new Error("fresh editor unavailable"));
  await loading;
  expect(state.control.error.value).not.toBe("");
  expect(state.control.ready.value).toBe(false);
  expect(state.control.busy.value).toBe(false);
  const retry = state.control.retryFailedOperation();
  await jest.advanceTimersByTimeAsync(32);
  await retry;
  expect(state.fresh.setMolecule).toHaveBeenCalledWith("CCCl");
  expect(state.control.pending.value).toBe(false);
});
