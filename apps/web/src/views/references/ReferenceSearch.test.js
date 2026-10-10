import { nextTick, reactive, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import {
  REFERENCE_SEARCH_PATH,
  REFERENCE_STATUS_PATH,
} from "@/common/reaction-references";
import {
  deferred,
  reactionDraft,
  reactionInput,
  setReactionDraft,
  uiStubs,
} from "../workspace/reaction-canvas.test-support";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import ReferenceSearch from "./ReferenceSearch.vue";
import { setLocale } from "@/i18n";
import "@/components/references/reference-dialog.test-support";
import { randomUUID } from "node:crypto";
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true });

jest.mock("vue-router", () => ({ useRoute: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({
  props: ["title"],
  template: "<section><h1>{{ title }}</h1><slot /></section>",
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage",
  props: ["smiles", "inputType"],
  template: '<span class="rendered-smiles">{{ smiles }}</span>',
}));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({
  name: "StructurePreview", props: ["smiles", "inputType", "label"],
  template: '<span class="rendered-smiles">{{ smiles }}</span>',
}));
jest.mock("@/components/workspace/ReactionInput.vue", () => ({
  name: "ReactionInput",
  template: "<div />",
}));

const ready = {
  ready: true,
  source: "USPTO_FULL",
  record_count: 12,
  product_index_available: true,
  reason: null,
};
const wrappers = [];
test("a new link during input-layer reactivation cannot dispatch an old reference import", async () => {
  const { wrapper, route } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(packet()); await wrapper.vm.search(); await flushPromises();
  const draft = reactionDraft(wrapper); draft.importRecords = jest.fn().mockResolvedValue(true);
  const proposal = wrapper.vm.loadReaction({ reactants: ["CCO"], products: ["CC=O"], agents: [] });
  await nextTick();
  route.query = { reaction_smiles: "CCN>>CC=N" };
  await proposal; await flushPromises();
  expect(draft.importRecords).not.toHaveBeenCalled();
});
test("a submitted query opens a separate reading layer without replacing its chemistry canvas or issuing another search", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  const canvas = wrapper.getComponent(reactionInput).element;
  const held = deferred(); API.post.mockReturnValueOnce(held.promise);
  const search = wrapper.vm.search(); await flushPromises();
  expect(wrapper.get('[data-cy="reference-reading"]').attributes("aria-hidden")).toBeUndefined();
  expect(wrapper.get('[data-cy="reference-query-panel"]').attributes("inert")).toBeDefined();
  expect(wrapper.getComponent(reactionInput).element).toBe(canvas);
  held.resolve(packet()); await search; await flushPromises();
  expect(wrapper.get('[data-cy="reference-query-summary"]').text()).toContain("产物结构精确匹配");
  await wrapper.get('[data-cy="reference-edit-query"]').trigger("click");
  expect(wrapper.get('[data-cy="reference-reading"]').attributes("aria-hidden")).toBe("true");
  expect(wrapper.getComponent(reactionInput).element).toBe(canvas);
  expect(reactionDraft(wrapper).product.value).toBe("CC=O");
  await wrapper.get('[data-cy="reference-open-results"]').trigger("click");
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(wrapper.findAll('[data-cy="reference-row"]')).toHaveLength(1);
});

test("a changed query immediately retires its reading layer and never presents stale records", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(packet()); await wrapper.vm.search(); await flushPromises();
  expect(wrapper.get('[data-cy="reference-reading"]').attributes("aria-hidden")).toBeUndefined();
  await setReactionDraft(wrapper, { product: "CCN" });
  expect(wrapper.get('[data-cy="reference-reading"]').attributes("aria-hidden")).toBe("true");
  expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
});
test("retrieval copy changes language without replacing the selected reaction or issuing a search", async () => {
  API.get.mockResolvedValue(ready);
  const { wrapper } = await setup();
  const input = wrapper.getComponent(reactionInput).element;
  await setReactionDraft(wrapper, { product: "[13CH3][C@H]([NH3+])CO.[Cl-]", reactants: ["CCO"] });
  const draft = reactionDraft(wrapper);
  const before = { product: draft.product.value, reactants: [...draft.reactants.value], pending: draft.pending.value };
  API.post.mockClear();
  setLocale("en", { persist: false }); await nextTick();
  expect(wrapper.text()).toContain("Search parameters");
  expect(wrapper.text()).toContain("Search reference reactions");
  expect(wrapper.getComponent(reactionInput).element).toBe(input);
  expect({ product: draft.product.value, reactants: [...draft.reactants.value], pending: draft.pending.value }).toEqual(before);
  expect(API.post).not.toHaveBeenCalled();
  setLocale("zh-CN", { persist: false }); await nextTick();
  expect(wrapper.text()).toContain("检索参数");
  expect(wrapper.getComponent(reactionInput).element).toBe(input);
});
async function setup(query = {}) {
  const route = reactive({ path: "/references", query });
  useRoute.mockReturnValue(route);
  const wrapper = mount(ReferenceSearch, {
    attachTo: document.body,
    global: { stubs: { ...uiStubs, VLazy: { template: '<div><slot /></div>' } } },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, route };
}
function packet(
  product = "CC=O",
  reactants = ["CCO"],
  scopes = ["reaction_identity"],
) {
  return {
    requested: { product, reactants: [...reactants] },
    query: { product, reactants: [...reactants] },
    source: "USPTO_FULL",
    count: scopes.length,
    has_more: false,
    match_basis: "exact_product_structure",
    retrieved_at: "2026-10-05T01:00:00Z",
    results: scopes.map((scope, index) => ({
      id: `reference-${index}`,
      reaction_smiles: `CCO>>${product}`,
      reactants: scope === "reaction_identity" ? [...reactants] : ["CCN"],
      products: [product],
      agents: [],
      match_scope: scope,
      conditions: null,
      reported_yields: [],
      provenance: {
        source: "USPTO_FULL",
        record_id: `reference-${index}`,
        evidence_type: "patent_reaction_extraction",
        yield_extraction_fields: [],
        patent_url_basis: null,
      },
    })),
  };
}
beforeEach(() => {
  API.get.mockReset().mockResolvedValue(ready);
  API.post.mockReset();
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("reference-source metadata", () => {
  const parameters = (wrapper) => wrapper.get(".reference-parameters");
  const libraryStatus = () => ({
    ...ready,
    source: "OPEN_REACTIONS",
    record_count: null,
    sources: [
      { ...ready, record_count: null },
      { ...ready, source: "ORD", record_count: 7, conditions_count: 6,
        yields_count: 0, license: "CC-BY-SA-4.0", snapshot: "a".repeat(64) },
    ],
  });

  test.each(["en", "zh-CN"])("pending metadata makes no source/count claim in %s", async (locale) => {
    const held = deferred();
    API.get.mockReturnValueOnce(held.promise);
    const { wrapper } = await setup();
    setLocale(locale, { persist: false }); await nextTick();
    const inspector = parameters(wrapper);
    expect(inspector.findAll("dl")).toHaveLength(0);
    expect(inspector.find("details").exists()).toBe(false);
    expect(inspector.get('[role="status"]').text()).toBe(
      locale === "en" ? "Checking reference sources." : "正在核对参考来源。",
    );
    expect(inspector.find('[aria-busy="true"]').exists()).toBe(true);
    expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(true);
    expect(API.get.mock.calls).toEqual([[REFERENCE_STATUS_PATH, null, false]]);
    expect(API.post).not.toHaveBeenCalled();
    held.resolve(ready); await flushPromises();
  });

  test.each([
    ["network", new Error("network unavailable")],
    ["null", null],
    ["invalid", { ...ready, record_count: -1 }],
  ])("%s status failure hides unverified metadata until an explicit retry", async (_kind, failure) => {
    if (failure instanceof Error) API.get.mockRejectedValueOnce(failure);
    else API.get.mockResolvedValueOnce(failure);
    const { wrapper } = await setup();
    const inspector = parameters(wrapper), input = wrapper.getComponent(reactionInput).element;
    await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
    expect(inspector.findAll("dl")).toHaveLength(0);
    expect(inspector.get('[role="alert"]').text()).not.toBe("");
    await wrapper.vm.search();
    expect(API.post).not.toHaveBeenCalled();
    expect(API.get).toHaveBeenCalledTimes(1);
    const retry = wrapper.get('.workbench-actions button[aria-label="刷新参考来源状态"]');
    retry.element.focus();
    await retry.trigger("click"); await flushPromises();
    expect(inspector.find('[role="alert"]').exists()).toBe(false);
    expect(inspector.findAll("dl").length).toBeGreaterThan(0);
    expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(false);
    expect(wrapper.getComponent(reactionInput).element).toBe(input);
    expect(document.activeElement).toBe(retry.element);
    expect(API.get).toHaveBeenCalledTimes(2);
    expect(API.post).not.toHaveBeenCalled();
  });

  test("verified metadata preserves source IDs and counts without inventing a total or translating data", async () => {
    const status = libraryStatus(), before = JSON.stringify(status);
    API.get.mockResolvedValueOnce(status);
    const { wrapper } = await setup();
    const inspector = parameters(wrapper);
    for (const [locale, unknown, verified] of [
      ["en", "Count not provided", "Reference-source status checked."],
      ["zh-CN", "数量未提供", "参考来源状态已核对。"],
    ]) {
      setLocale(locale, { persist: false }); await nextTick();
      expect(inspector.get('[role="status"]').text()).toBe(verified);
      expect(inspector.get("dl.reference-source dd").text()).toBe("USPTO_FULL + ORD");
      expect(inspector.findAll("dl.reference-source dd").at(-1).text()).toBe(unknown);
      expect(inspector.text()).not.toMatch(/Not recorded|未记录/);
      const coverage = inspector.get("details");
      expect(coverage.text()).toContain("USPTO_FULL");
      expect(coverage.text()).toContain("ORD");
      expect(coverage.findAll("dd").map(item => item.text())).toEqual(expect.arrayContaining([
        unknown, "7", "6", "0", "CC-BY-SA-4.0",
      ]));
      expect(JSON.stringify(status)).toBe(before);
    }
    expect(API.get).toHaveBeenCalledTimes(1);
    expect(API.post).not.toHaveBeenCalled();
  });

  test.each([null, undefined])("a verified legacy source with %s count reports missing metadata, not missing records", async (count) => {
    API.get.mockResolvedValueOnce({ ...ready, record_count: count });
    const { wrapper } = await setup();
    setLocale("en", { persist: false }); await nextTick();
    const inspector = parameters(wrapper);
    expect(inspector.text()).toContain("USPTO_FULL");
    expect(inspector.text()).toContain("Count not provided");
    expect(inspector.text()).not.toContain("Not recorded");
    await setReactionDraft(wrapper, { product: "CC=O" });
    expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(false);
  });

  test("a structured 503 remains verified unavailable metadata and retains explicit zero counts", async () => {
    const status = libraryStatus();
    Object.assign(status, { ready: false, record_count: 0, product_index_available: false,
      reason: "reference_product_index_unavailable" });
    status.sources = status.sources.map(source => ({ ...source, ready: false, record_count: 0,
      product_index_available: false, reason: "reference_product_index_unavailable" }));
    const before = JSON.stringify(status);
    API.get.mockRejectedValueOnce(new Error(JSON.stringify(status)));
    const { wrapper } = await setup();
    const inspector = parameters(wrapper);
    expect(inspector.findAll("dl.reference-source dd").at(-1).text()).toBe("0");
    expect(inspector.get('[role="status"]').text()).toContain("索引未就绪");
    expect(inspector.find('[role="alert"]').exists()).toBe(false);
    expect(inspector.get("details").text()).toContain("USPTO_FULL");
    expect(inspector.get("details").text()).toContain("ORD");
    expect(JSON.stringify(status)).toBe(before);
    await wrapper.vm.search();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("refresh hides old metadata, disables search and rejects obsolete replies without replacing input", async () => {
    const { wrapper } = await setup();
    await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
    const input = wrapper.getComponent(reactionInput).element;
    const old = deferred(), current = deferred();
    API.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = wrapper.vm.loadStatus();
    const second = wrapper.vm.loadStatus();
    await nextTick();
    expect(parameters(wrapper).findAll("dl")).toHaveLength(0);
    expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(true);
    old.resolve({ ...ready, record_count: 99 }); await first; await flushPromises();
    expect(parameters(wrapper).findAll("dl")).toHaveLength(0);
    current.resolve(libraryStatus()); await second; await flushPromises();
    expect(parameters(wrapper).text()).not.toContain("99");
    expect(parameters(wrapper).text()).toContain("USPTO_FULL + ORD");
    expect(wrapper.getComponent(reactionInput).element).toBe(input);
    expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(false);
    expect(API.get).toHaveBeenCalledTimes(3);
    expect(API.post).not.toHaveBeenCalled();
  });
});

test("shared form owns the parameter inspector and prevents native navigation once", async () => {
  const { wrapper } = await setup();
  const form = wrapper.getComponent(WorkbenchForm);
  expect(wrapper.findAll("form")).toHaveLength(1);
  expect(
    form.element.children[0].classList.contains("workbench-input-area"),
  ).toBe(true);
  expect(form.element.children[1].tagName).toBe("ASIDE");
  expect(form.findAll("aside")).toHaveLength(1);
  expect(form.get(".workbench-inspector").attributes("aria-label")).toBe(
    "检索参数",
  );
  expect(
    form.get(".workbench-inspector > .reference-parameters").element.tagName,
  ).toBe("DIV");
  expect(form.get(".workbench-input-area .reference-inputs").exists()).toBe(
    true,
  );
  expect(form.find(".reference-search-results").exists()).toBe(false);
  const event = new Event("submit", { bubbles: true, cancelable: true });
  form.element.dispatchEvent(event);
  await flushPromises();
  expect(event.defaultPrevented).toBe(true);
  expect(form.emitted("submit")).toEqual([[event]]);
  expect(API.post).not.toHaveBeenCalled();
});

test("one optional-reactants canvas reads status but never searches on mount", async () => {
  const { wrapper } = await setup();
  expect(wrapper.findAllComponents(reactionInput)).toHaveLength(1);
  expect(wrapper.getComponent(reactionInput).props("requireReactants")).toBe(
    false,
  );
  expect(wrapper.findAll("textarea")).toHaveLength(1);
  expect(API.get.mock.calls).toEqual([[REFERENCE_STATUS_PATH, null, false]]);
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("产物结构精确匹配");
  expect(wrapper.text()).not.toMatch(/亚结构|反应中心|反应物检索/);
});

test.each([
  ["CCO", "chemical"],
  ["CCO>>CC=O", "reaction"],
])("linked preview uses its actual drawing format: %s", async (raw, inputType) => {
  const { wrapper } = await setup({ reaction_smiles: raw });
  expect(wrapper.getComponent({ name: "SmilesImage" }).props("inputType")).toBe(inputType);
  expect(API.post).not.toHaveBeenCalled();
});

test.each(["reaction_smiles", "rxnsmiles"])(
  "%s preserves raw link preview and needs application before a separate search",
  async (key) => {
    const raw = "[13CH3][C@@H](Cl)C.[Cl-]>O>[13CH3][C@H](O)C.[Na+] |f:0.1|";
    const { wrapper } = await setup({ [key]: raw });
    expect(wrapper.get(".reference-prefill .rendered-smiles").text()).toBe(raw);
    expect(wrapper.get(".reaction-text").element.value).toBe("");
    expect(
      wrapper.get('[data-cy="reference-search-submit"]').element.disabled,
    ).toBe(true);
    await wrapper.get("form").trigger("submit");
    await wrapper.get('[data-cy="reference-apply-prefill"]').trigger("click");
    expect(wrapper.get(".reaction-text").element.value).toBe(raw);
    expect(wrapper.find(".reference-prefill").exists()).toBe(false);
    expect(API.post).not.toHaveBeenCalled();
    const reactants = ["[13CH3][C@@H](Cl)C.[Cl-]"],
      product = "[13CH3][C@H](O)C.[Na+]";
    await setReactionDraft(wrapper, {
      reactants,
      product,
      agents: [{ smiles: "O" }],
    });
    API.post.mockResolvedValue(packet(product, reactants));
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(API.post.mock.calls).toEqual([
      [REFERENCE_SEARCH_PATH, { product, reactants, limit: 20 }],
    ]);
  },
);

test("complete compound records come from the canvas, not raw text or agent roles", async () => {
  const { wrapper } = await setup();
  await wrapper.get(".reaction-text").setValue("raw-input-authority");
  const reactants = ["[Na+].[O-]C", "[13CH3][C@@H](Cl)C"],
    product = "[13CH3][C@H](O)C";
  await setReactionDraft(wrapper, {
    reactants,
    product,
    agents: [{ smiles: "Cl" }],
  });
  API.post.mockResolvedValue(packet(product, reactants));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post.mock.calls[0][1]).toEqual({ product, reactants, limit: 20 });
  expect(API.post.mock.calls[0][1]).not.toHaveProperty("agents");
  expect(reactionDraft(wrapper).reactants.value).toEqual(reactants);
});

test("product-only input still searches, while reactant-only input cannot submit", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: [] });
  API.post.mockResolvedValue(packet("CC=O", [], ["product_identity"]));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post.mock.calls[0][1].reactants).toEqual([]);
  expect(wrapper.text()).toContain("仅产物一致");
  await setReactionDraft(wrapper, { product: "", reactants: ["CCO"] });
  await wrapper.vm.search();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(
    wrapper.get('[data-cy="reference-search-submit"]').element.disabled,
  ).toBe(true);
});

test("product matching keeps full-reaction and product-only scopes distinct", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(
    packet("CC=O", ["CCO"], ["reaction_identity", "product_identity"]),
  );
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.findAll('[data-cy="reference-row"]')).toHaveLength(2);
  expect(wrapper.text()).toContain("全反应一致");
  expect(wrapper.text()).toContain("仅产物一致");
});

test("fresh pending draft blocks programmatic search and immediately invalidates results", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(packet());
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  await setReactionDraft(wrapper, { pending: true });
  expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
  expect(
    wrapper.get('[data-cy="reference-search-submit"]').element.disabled,
  ).toBe(true);
  await wrapper.vm.search();
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("unaccepted reference preview and cancellation keep the unchanged query evidence", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(packet());
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  const draft = reactionDraft(wrapper);
  draft.importRecords = jest.fn(async () => { draft.pending.value = true; return true; });
  await wrapper.get('[data-cy="reference-load-reaction"]').trigger("click");
  await flushPromises();
  expect(wrapper.findAll('[data-cy="reference-row"]')).toHaveLength(1);
  expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(true);
  expect(wrapper.get('[data-cy="reference-export"]').element.disabled).toBe(true);
  draft.pending.value = false;
  await nextTick();
  expect(wrapper.findAll('[data-cy="reference-row"]')).toHaveLength(1);
  expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("cancelled reuse returns to the same retained record action and restores its keyboard focus", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  const response = packet(), before = JSON.stringify(response);
  API.post.mockResolvedValue(response);
  await wrapper.vm.search(); await flushPromises();
  const draft = reactionDraft(wrapper), input = wrapper.getComponent(reactionInput).element;
  draft.importRecords = jest.fn(async () => { draft.pending.value = true; return true; });
  const action = wrapper.get('[data-cy="reference-load-reaction"]');
  action.element.focus();
  await action.trigger("click"); await flushPromises();
  expect(wrapper.get('[data-cy="reference-query-panel"]').attributes("aria-hidden")).toBeUndefined();
  draft.pending.value = false;
  await flushPromises();
  expect(wrapper.get('[data-cy="reference-reading"]').attributes("aria-hidden")).toBeUndefined();
  expect(document.activeElement).toBe(action.element);
  expect(wrapper.getComponent(reactionInput).element).toBe(input);
  expect(JSON.stringify(response)).toBe(before);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("returning from unchanged query editing restores the originating result position", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(packet()); await wrapper.vm.search(); await flushPromises();
  const action = wrapper.get('[data-cy="reference-load-reaction"]');
  action.element.focus();
  await wrapper.get('[data-cy="reference-edit-query"]').trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get(".reaction-text").element);
  await wrapper.get('[data-cy="reference-open-results"]').trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(action.element);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("a transfer can be cancelled while awaiting the real canvas contract without losing accepted query results", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(packet()); await wrapper.vm.search(); await flushPromises();
  const draft = reactionDraft(wrapper), held = deferred();
  draft.importRecords = jest.fn(() => { draft.pending.value = true; return held.promise; });
  const revision = draft.importRevision.value;
  draft.cancelImport = () => { draft.importRevision.value++; draft.pending.value = false; };
  await wrapper.get('[data-cy="reference-load-reaction"]').trigger("click");
  await flushPromises();
  await wrapper.get('[data-cy="reference-cancel-transfer"]').trigger("click");
  draft.pending.value = false;
  held.resolve(false); await flushPromises();
  expect(draft.importRevision.value).toBe(revision + 1);
  expect(wrapper.get('[data-cy="reference-reading"]').attributes("aria-hidden")).toBeUndefined();
  expect(wrapper.findAll('[data-cy="reference-row"]')).toHaveLength(1);
  expect(API.post).toHaveBeenCalledTimes(1);
});

async function preparingTransfer() {
  const { wrapper, route } = await setup();
  await wrapper.get(".reaction-text").setValue("CCO>>CC=O");
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  const response = packet(), held = deferred(), draft = reactionDraft(wrapper);
  API.post.mockResolvedValue(response);
  await wrapper.vm.search(); await flushPromises();
  draft.importRecords = jest.fn(() => { draft.pending.value = true; return held.promise; });
  draft.cancelImport = jest.fn(() => { draft.importRevision.value++; draft.pending.value = false; });
  const action = wrapper.get('[data-cy="reference-load-reaction"]');
  action.element.focus();
  await action.trigger("click"); await flushPromises();
  return { wrapper, route, draft, held, response, action };
}

test("current transfer preparation brings its named status into view and keyboard focus", async () => {
  const scroll = jest.fn();
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const { wrapper, held } = await preparingTransfer();
    const status = wrapper.get('.reference-transfer [role="status"]');
    expect(status.attributes("tabindex")).toBe("-1");
    expect(status.text()).toBe("载入参考反应");
    expect(document.activeElement).toBe(status.element);
    expect(scroll.mock.contexts).toContain(status.element);
    await wrapper.get('[data-cy="reference-cancel-transfer"]').trigger("click");
    held.resolve(false); await flushPromises();
  } finally { HTMLElement.prototype.scrollIntoView = previous; }
});

test.each(["rejected", "not-staged"])(
  "%s current transfer focuses its named error without replacing query, canvas or source record",
  async (failure) => {
    const { wrapper, draft, held, response } = await preparingTransfer();
    const input = wrapper.getComponent(reactionInput).element, before = JSON.stringify(response);
    const scroll = jest.fn(), previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      draft.pending.value = false;
      if (failure === "rejected") held.reject(new Error("transport failed"));
      else held.resolve(false);
      await flushPromises();
      const alert = wrapper.get('.reference-transfer [role="alert"]');
      expect(alert.attributes("aria-label")).toBe("载入参考反应");
      expect(alert.attributes("tabindex")).toBe("-1");
      expect(alert.text()).toBe("记录操作失败，请重试。");
      expect(document.activeElement).toBe(alert.element);
      expect(scroll.mock.contexts).toContain(alert.element);
      expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
      expect(wrapper.getComponent(reactionInput).element).toBe(input);
      expect(wrapper.get(".reaction-text").element.value).toBe("CCO>>CC=O");
      expect(draft.product.value).toBe("CC=O");
      expect(draft.reactants.value).toEqual(["CCO"]);
      expect(JSON.stringify(response)).toBe(before);
      expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(false);
      expect(API.post).toHaveBeenCalledTimes(1);
    } finally { HTMLElement.prototype.scrollIntoView = previous; }
  },
);

test("retry focuses the current transfer phase, locale changes do not steal focus, and back restores the same record", async () => {
  const { wrapper, draft, held, action, response } = await preparingTransfer();
  const before = JSON.stringify(response);
  draft.pending.value = false; held.resolve(false); await flushPromises();
  const retry = wrapper.get('[data-cy="reference-transfer-retry"]');
  retry.element.focus();
  setLocale("en", { persist: false }); await nextTick();
  expect(wrapper.get('.reference-transfer [role="alert"]').attributes("aria-label")).toBe("Loading reference reaction");
  expect(wrapper.get('.reference-transfer [role="alert"]').text()).toBe("The record action failed. Retry.");
  expect(document.activeElement).toBe(retry.element);
  const second = deferred();
  draft.importRecords.mockImplementationOnce(() => { draft.pending.value = true; return second.promise; });
  await retry.trigger("click"); await flushPromises();
  expect(document.activeElement).toBe(wrapper.get('.reference-transfer [role="status"]').element);
  draft.pending.value = false; second.resolve(false); await flushPromises();
  expect(document.activeElement).toBe(wrapper.get('.reference-transfer [role="alert"]').element);
  await wrapper.get('[data-cy="reference-transfer-back"]').trigger("click"); await flushPromises();
  expect(document.activeElement).toBe(action.element);
  expect(wrapper.find(".reference-transfer").exists()).toBe(false);
  expect(draft.importRecords).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(response)).toBe(before);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("returning to edit an unchanged query does not refocus an already acknowledged transfer error", async () => {
  const { wrapper, draft, held } = await preparingTransfer();
  draft.pending.value = false; held.resolve(false); await flushPromises();
  await wrapper.get('[data-cy="reference-open-results"]').trigger("click"); await flushPromises();
  await wrapper.get('[data-cy="reference-edit-query"]').trigger("click"); await flushPromises();
  expect(wrapper.find('.reference-transfer [role="alert"]').exists()).toBe(true);
  expect(document.activeElement).toBe(wrapper.get(".reaction-text").element);
});

test.each(["new-link", "edited-input", "new-query", "new-canvas", "other-layer", "unmount", "detached", "inert", "hidden", "aria-hidden", "aria-disabled", "disabled"])(
  "queued error focus never targets an obsolete or unavailable context: %s",
  async (operation) => {
    const { wrapper, route, draft, held } = await preparingTransfer();
    let focus;
    const stop = watch(() => wrapper.vm.reusePhase, phase => {
      if (phase !== "error") return;
      const alert = wrapper.get('.reference-transfer [role="alert"]').element;
      focus = jest.spyOn(alert, "focus");
      if (operation === "new-link") route.query = { reaction_smiles: "CCN>>CC=N" };
      else if (operation === "edited-input") wrapper.vm.reactionSmiles = "CCN>>CC=N";
      else if (operation === "new-query") wrapper.vm.limit = 10;
      else if (operation === "new-canvas") wrapper.vm.canvas = { pending: false, product: "CC=O", reactants: ["CCO"] };
      else if (operation === "other-layer") wrapper.vm.layer = "records";
      else if (operation === "unmount") wrapper.unmount();
      else if (operation === "detached") alert.remove();
      else if (operation === "disabled") alert.disabled = true;
      else if (operation === "aria-disabled") alert.setAttribute("aria-disabled", "true");
      else if (operation === "aria-hidden") wrapper.get('[data-cy="reference-query-panel"]').element.setAttribute("aria-hidden", "true");
      else wrapper.get('[data-cy="reference-query-panel"]').element.setAttribute(operation, "");
    }, { flush: "post" });
    draft.pending.value = false; held.resolve(false); await flushPromises();
    stop();
    expect(focus).toBeDefined();
    expect(focus).not.toHaveBeenCalled();
  },
);

test.each(["new-link", "cancel", "unmount"])(
  "a late transfer rejection cannot reclaim focus after %s",
  async (operation) => {
    const { wrapper, route, draft, held, action } = await preparingTransfer();
    if (operation === "new-link") route.query = { reaction_smiles: "CCN>>CC=N" };
    else if (operation === "cancel") await wrapper.get('[data-cy="reference-cancel-transfer"]').trigger("click");
    else wrapper.unmount();
    await flushPromises();
    const before = document.activeElement;
    draft.pending.value = false; held.reject(new Error("late transport failure")); await flushPromises();
    expect(document.activeElement).toBe(before);
    if (operation !== "unmount") expect(wrapper.find('.reference-transfer [role="alert"]').exists()).toBe(false);
    if (operation === "cancel") expect(document.activeElement).toBe(action.element);
    expect(API.post).toHaveBeenCalledTimes(1);
  },
);

test("a new URL cannot restore evidence after proposal suspension and late import completion", async () => {
  const { wrapper, route } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(packet());
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  const draft = reactionDraft(wrapper), held = deferred();
  draft.importRecords = jest.fn(() => { draft.pending.value = true; return held.promise; });
  await wrapper.get('[data-cy="reference-load-reaction"]').trigger("click");
  await flushPromises();
  route.query = { rxnsmiles: "CCN>>CC=N" };
  await nextTick();
  held.resolve(true);
  draft.pending.value = false;
  await flushPromises();
  expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
  expect(wrapper.find('[data-cy="reference-apply-prefill"]').exists()).toBe(true);
});

test.each(["apply", "edit-and-revert"])(
  "%s is a chemical revision even while a reference proposal is suspended",
  async (operation) => {
    const { wrapper } = await setup();
    await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
    API.post.mockResolvedValue(packet());
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const draft = reactionDraft(wrapper), input = wrapper.getComponent(reactionInput);
    draft.importRecords = jest.fn(async () => { draft.pending.value = true; return true; });
    await wrapper.get('[data-cy="reference-load-reaction"]').trigger("click");
    await flushPromises();
    input.vm.$emit("update:modelValue", "CCO>>CC=O");
    if (operation === "edit-and-revert") input.vm.$emit("update:modelValue", "");
    draft.pending.value = false;
    await flushPromises();
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
    expect(wrapper.find('[data-cy="reference-actual-input"]').exists()).toBe(false);
    expect(API.post).toHaveBeenCalledTimes(1);
  },
);

test("raw edit and immediate revert cannot revive a late result with the same roles", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  const held = deferred();
  API.post.mockReturnValue(held.promise);
  await wrapper.get("form").trigger("submit");
  const canvas = wrapper.getComponent(reactionInput);
  canvas.vm.$emit("update:modelValue", "edited-draft");
  canvas.vm.$emit("update:modelValue", "");
  held.resolve(packet());
  await flushPromises();
  expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
  expect(wrapper.find('[data-cy="reference-actual-input"]').exists()).toBe(
    false,
  );
});

test("a new URL invalidates the active search and restores confirmation", async () => {
  const { wrapper, route } = await setup();
  const revision = reactionDraft(wrapper).importRevision.value;
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  const held = deferred();
  API.post.mockReturnValue(held.promise);
  await wrapper.get("form").trigger("submit");
  route.query = { rxnsmiles: "CCN>O>CC=N" };
  await nextTick();
  expect(reactionDraft(wrapper).importRevision.value).toBe(revision + 1);
  held.resolve(packet());
  await flushPromises();
  expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
  expect(wrapper.find('[data-cy="reference-apply-prefill"]').exists()).toBe(
    true,
  );
  expect(
    wrapper.get('[data-cy="reference-search-submit"]').element.disabled,
  ).toBe(true);
});

test("applying a new link then immediately searching waits for the fresh canvas pending state", async () => {
  const { wrapper, route } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  route.query = { rxnsmiles: "CCN>>CC=N" };
  await nextTick();
  wrapper.vm.applyPrefill();
  await wrapper.vm.search();
  expect(reactionDraft(wrapper).pending.value).toBe(true);
  expect(API.post).not.toHaveBeenCalled();
});

test.each([
  { reaction_smiles: "CCO>>CC=O", rxnsmiles: "CCN>>CC=N" },
  { rxnsmiles: ["CCO>>CC=O"] },
  { reaction_smiles: "" },
])(
  "conflicting or typed link fields require dismissal before search: %p",
  async (query) => {
    const { wrapper } = await setup(query);
    await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
    expect(wrapper.get(".reference-prefill [role='alert']").text()).toContain(
      "未应用输入",
    );
    await wrapper.vm.search();
    expect(API.post).not.toHaveBeenCalled();
    await wrapper.findAll(".reference-prefill button").at(-1).trigger("click");
    expect(
      wrapper.get('[data-cy="reference-search-submit"]').element.disabled,
    ).toBe(false);
  },
);

test("chemical validation stays with the canvas, and unready sources still gate search", async () => {
  API.get.mockResolvedValue({
    ...ready,
    ready: false,
    product_index_available: false,
    reason: "reference_product_index_unavailable",
  });
  const { wrapper } = await setup({ rxnsmiles: "CCO>CC=O" });
  await wrapper.get('[data-cy="reference-apply-prefill"]').trigger("click");
  expect(wrapper.get(".reaction-text").element.value).toBe("CCO>CC=O");
  await setReactionDraft(wrapper, { pending: true });
  await wrapper.vm.search();
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("索引未就绪");
});
