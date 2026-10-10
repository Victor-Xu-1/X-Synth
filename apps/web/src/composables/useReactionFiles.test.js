import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, isReadonly, ref } from "vue";
import { API } from "@/common/api";
import { downloadChemicalFile } from "@/common/chemical-files";
import { REACTION_EXPORT_PATH } from "@/common/reaction-records";
import { useReactionFiles } from "./useReactionFiles";
import { TextDecoder, TextEncoder } from "node:util";

globalThis.TextDecoder ||= TextDecoder;

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
const mockActivity = ref(true);
jest.mock("@/components/workspace/workbench-activity", () => ({ useWorkbenchActivity: () => mockActivity }));
jest.mock("@/common/chemical-files", () => ({
  ...jest.requireActual("@/common/chemical-files"),
  downloadChemicalFile: jest.fn(),
}));
const wrappers = [];
function setup({ board = ref(null), draft = { selected: ref("") } } = {}) {
  const text = ref(""), disabled = ref(false);
  let state;
  const wrapper = mount(defineComponent({ setup() {
    state = useReactionFiles({ text, disabled: () => disabled.value, board, draft });
    return () => null;
  } }));
  wrappers.push(wrapper);
  return { state, text, disabled, wrapper };
}
const event = () => {
  const bytes = new TextEncoder().encode("$RXN\ntransport fixture");
  return { target: { value: "file", files: [{ name: "ownership.rxn", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }] } };
};
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  API.post.mockReset();
  downloadChemicalFile.mockReset();
});
beforeEach(() => { mockActivity.value = true; });

// Transport fixtures exercise lifecycle and role identity, not chemical parsing.
const source = "CCO>([Na+].[Cl-])>CC=O", rxn = "$RXN\ntransport fixture";
const reaction = () => ({
  input_kind: "reaction", reaction_smiles: source, canvas_rxn: rxn,
  reactants: [{ index: 1, name: "", smiles: "CCO", components: 1, atoms: 3, formula: "C2H6O", molecular_weight: 46.07 }],
  products: [{ index: 1, name: "", smiles: "CC=O", components: 1, atoms: 3, formula: "C2H4O", molecular_weight: 44.05 }],
  agents: [{ index: 1, name: "", smiles: "[Na+].[Cl-]", components: 2, atoms: 2, formula: "ClNa", molecular_weight: 58.44 }],
});
const response = body => ({ ...reaction(), format: body.format, requested: body });
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setupExport() {
  const exportRxn = jest.fn(async () => rxn),
    draft = { selected: ref("CC=O"), structurePending: ref(false), parsed: ref(reaction()),
      parseCanvas: jest.fn(async () => reaction()) };
  const state = setup({ board: ref({ exportRxn }), draft });
  state.text.value = source;
  return { ...state, exportRxn, draft };
}

test("idle file operation and compatible busy state are readonly", () => {
  const { state } = setup();
  expect(isReadonly(state.fileOperation)).toBe(true);
  expect(state.fileOperation.value).toBeNull();
  expect(isReadonly(state.fileBusy)).toBe(true);
  expect(state.fileBusy.value).toBe(false);
});

test("RXN staging reports import until settling, then keeps its draft idle for explicit apply", async () => {
  const pending = deferred();
  let body;
  API.post.mockImplementation((_, requested) => { body = requested; return pending.promise; });
  const { state, text } = setup(), operation = state.importFile(event());
  expect(state.fileOperation.value).toBe("import");
  expect(state.fileBusy.value).toBe(true);
  await flushPromises();
  pending.resolve(response(body));
  expect(await operation).toBe(true);
  expect(state.fileOperation.value).toBeNull();
  expect(state.fileBusy.value).toBe(false);
  expect(state.fileOrigin.value).toBe("file");
  expect(state.fileDraft.value).toEqual(response(body));
  expect(text.value).toBe("");
  state.applyFile();
  expect(text.value).toBe(source);
  expect(state.fileDraft.value).toBeNull();
  expect(state.fileOperation.value).toBeNull();
});

test("reference staging is import, with its origin and owned controller preserved through both requests", async () => {
  const pending = deferred(), value = reaction(), records = Object.fromEntries(
    ["reactants", "products", "agents"].map(role => [role, value[role].map(record => record.smiles)]),
  );
  API.post.mockImplementation((path, body) => path === REACTION_EXPORT_PATH
    ? pending.promise : Promise.resolve(response(body)));
  const { state, text } = setup(), operation = state.importRecords(records);
  expect(state.fileOperation.value).toBe("import");
  expect(state.fileOrigin.value).toBe("reference");
  expect(state.fileBusy.value).toBe(true);
  const options = API.post.mock.calls[0][3];
  pending.resolve({ format: "rxn", content: rxn });
  expect(await operation).toBe(true);
  expect(API.post.mock.calls[1][3]).toEqual(options);
  expect(options.signal.aborted).toBe(false);
  expect(options.timeoutMs).toBe(15000);
  expect(state.fileOperation.value).toBeNull();
  expect(state.fileOrigin.value).toBe("reference");
  expect(text.value).toBe("");
  state.applyFile();
  expect(text.value).toBe(source);
  expect(state.fileOrigin.value).toBe("file");
});

test("export owns native read and role verification without becoming an import or changing input", async () => {
  const native = deferred(), parsed = deferred(), { state, text, exportRxn, draft } = setupExport();
  exportRxn.mockReturnValue(native.promise);
  draft.parseCanvas.mockReturnValue(parsed.promise);
  const operation = state.exportFile();
  expect(state.fileOperation.value).toBe("export");
  expect(state.fileBusy.value).toBe(true);
  expect(state.fileOrigin.value).toBe("file");
  expect(await state.importFile(event())).toBe(false);
  await state.exportFile();
  expect(exportRxn).toHaveBeenCalledTimes(1);
  expect(API.post).not.toHaveBeenCalled();
  native.resolve(rxn); await flushPromises();
  expect(draft.parseCanvas).toHaveBeenCalledWith(rxn);
  expect(state.fileOperation.value).toBe("export");
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  parsed.resolve(reaction()); await operation;
  expect(downloadChemicalFile.mock.calls).toEqual([[{
    format: "rxn", content: rxn, media_type: "chemical/x-mdl-rxnfile",
  }, "reaction"]]);
  expect(state.fileOperation.value).toBeNull();
  expect(state.fileBusy.value).toBe(false);
  expect(state.fileDraft.value).toBeNull();
  expect(state.fileError.value).toBe("");
  expect(text.value).toBe(source);
  expect(draft.selected.value).toBe("CC=O");
});

test.each(["native", "parser", "identity"])("%s export failure releases only export ownership and preserves input", async kind => {
  const { state, text, exportRxn, draft } = setupExport();
  if (kind === "native") exportRxn.mockRejectedValue(new Error("native export failed"));
  else if (kind === "parser") draft.parseCanvas.mockRejectedValue(new Error("RXN parse failed"));
  else draft.parseCanvas.mockResolvedValue({ ...reaction(), agents: [] });
  await state.exportFile();
  expect(state.fileOperation.value).toBeNull();
  expect(state.fileBusy.value).toBe(false);
  expect(state.fileError.value).not.toBe("");
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  expect(text.value).toBe(source);
  expect(draft.selected.value).toBe("CC=O");
});

test("discarded import settlement cannot release a newer export or publish a draft", async () => {
  const pending = deferred(), native = deferred();
  let body;
  API.post.mockImplementation((_, requested) => { body = requested; return pending.promise; });
  const { state, exportRxn } = setupExport(), importing = state.importFile(event());
  await flushPromises();
  const options = API.post.mock.calls[0][3];
  state.discardFile();
  expect(options.signal.aborted).toBe(true);
  expect(state.fileOperation.value).toBeNull();
  exportRxn.mockReturnValue(native.promise);
  const exporting = state.exportFile();
  pending.resolve(response(body));
  expect(await importing).toBe(false);
  expect(state.fileOperation.value).toBe("export");
  expect(state.fileBusy.value).toBe(true);
  expect(state.fileDraft.value).toBeNull();
  native.resolve(rxn); await exporting;
  expect(state.fileOperation.value).toBeNull();
  expect(downloadChemicalFile).toHaveBeenCalledTimes(1);
});

test("retired export settlement cannot release a newer import or download stale input", async () => {
  const native = deferred(), pending = deferred();
  let body;
  API.post.mockImplementation((_, requested) => { body = requested; return pending.promise; });
  const { state, text, exportRxn } = setupExport();
  exportRxn.mockReturnValue(native.promise);
  const exporting = state.exportFile();
  text.value = "CCN";
  expect(state.fileOperation.value).toBeNull();
  const importing = state.importFile(event()); await flushPromises();
  native.resolve(rxn); await exporting;
  expect(state.fileOperation.value).toBe("import");
  expect(state.fileBusy.value).toBe(true);
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  expect(state.fileError.value).toBe("");
  pending.resolve(response(body));
  expect(await importing).toBe(true);
  expect(state.fileOperation.value).toBeNull();
  expect(text.value).toBe("CCN");
});

test.each(["input", "disabled", "unmount", "inactive"])("%s retires an export and ignores its late native result", async kind => {
  const native = deferred(), { state, text, disabled, wrapper, exportRxn } = setupExport();
  exportRxn.mockReturnValue(native.promise);
  const operation = state.exportFile();
  expect(state.fileOperation.value).toBe("export");
  if (kind === "input") text.value = "CCN";
  else if (kind === "disabled") disabled.value = true;
  else if (kind === "inactive") mockActivity.value = false;
  else wrapper.unmount();
  expect(state.fileOperation.value).toBeNull();
  expect(state.fileBusy.value).toBe(false);
  native.resolve(rxn); await operation;
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  expect(state.fileError.value).toBe("");
  expect(state.fileOperation.value).toBeNull();
});

test("RXN staging forwards a bounded owned request and explicit discard releases it", async () => {
  API.post.mockImplementation((_, body, query, options) => new Promise((resolve, reject) =>
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })));
  const { state } = setup(), operation = state.importFile(event()); await flushPromises();
  const options = API.post.mock.calls[0][3];
  expect(options.timeoutMs).toBe(15000); expect(state.fileBusy.value).toBe(true);
  state.discardFile(); expect(options.signal.aborted).toBe(true);
  expect(await operation).toBe(false); expect(state.fileBusy.value).toBe(false);
  expect(state.fileDraft.value).toBeNull(); expect(state.fileError.value).toBe("");
});

test.each(["input", "disabled", "unmount"])("%s change cancels staging; late malformed data cannot publish", async kind => {
  let resolve;
  API.post.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { state, text, disabled, wrapper } = setup(), operation = state.importFile(event()); await flushPromises();
  const options = API.post.mock.calls[0][3];
  if (kind === "input") text.value = "CCN";
  else if (kind === "disabled") disabled.value = true;
  else wrapper.unmount();
  expect(options.signal.aborted).toBe(true);
  resolve({ malformedTransport: true }); expect(await operation).toBe(false);
  expect(state.fileDraft.value).toBeNull(); expect(state.fileBusy.value).toBe(false);
  expect(state.fileError.value).toBe("");
});

test("a failed parser request releases file controls so the same file can be retried", async () => {
  API.post.mockRejectedValue(new DOMException("service timeout", "TimeoutError"));
  const { state, text } = setup();
  expect(await state.importFile(event())).toBe(false); expect(state.fileBusy.value).toBe(false);
  expect(state.fileDraft.value).toBeNull(); expect(state.fileError.value).toBe("服务请求超时，请刷新或重试。"); expect(text.value).toBe("");
  expect(await state.importFile(event())).toBe(false); expect(API.post).toHaveBeenCalledTimes(2);
});

test("hiding the workbench cancels staging and prevents a late response from publishing after resume", async () => {
  const pending = deferred(); let body;
  API.post.mockImplementation((_, requested) => { body = requested; return pending.promise; });
  const { state, text } = setup(), operation = state.importFile(event()); await flushPromises();
  const options = API.post.mock.calls[0][3];
  mockActivity.value = false;
  expect(options.signal.aborted).toBe(true); expect(state.fileBusy.value).toBe(false);
  mockActivity.value = true;
  pending.resolve(response(body)); expect(await operation).toBe(false);
  expect(state.fileDraft.value).toBeNull(); expect(text.value).toBe("");
});

test.each(["inactive", "unmounted"])("an %s owner cannot start or apply another file import", async reason => {
  API.post.mockImplementation((_, body) => Promise.resolve(response(body)));
  const { state, text, wrapper } = setup();
  expect(await state.importFile(event())).toBe(true);
  if (reason === "inactive") mockActivity.value = false;
  else wrapper.unmount();
  state.applyFile(); expect(text.value).toBe("");
  if (reason === "inactive") expect(state.fileDraft.value).not.toBeNull();
  else expect(state.fileDraft.value).toBeNull();
  API.post.mockClear();
  expect(await state.importFile(event())).toBe(false); expect(API.post).not.toHaveBeenCalled();
});

test("temporary hiding preserves staged roles and product selection until explicit confirmation after resume", async () => {
  API.post.mockImplementation((_, body) => Promise.resolve(response(body)));
  const { state, text } = setup();
  expect(await state.importFile(event())).toBe(true);
  const staged = state.fileDraft.value;
  state.fileProduct.value = staged.products[0].smiles;
  mockActivity.value = false;
  state.applyFile();
  expect(text.value).toBe(""); expect(state.fileDraft.value).toBe(staged);
  mockActivity.value = true;
  expect(state.fileDraft.value).toBe(staged);
  expect(state.fileProduct.value).toBe(staged.products[0].smiles);
  state.applyFile();
  expect(text.value).toBe(staged.reaction_smiles); expect(state.fileDraft.value).toBeNull();
});
