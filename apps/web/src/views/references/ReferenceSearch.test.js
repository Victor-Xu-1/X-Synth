import { nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { REFERENCE_SEARCH_PATH, REFERENCE_STATUS_PATH } from "@/common/reaction-references";
import { deferred, reactionDraft, reactionInput, setReactionDraft, uiStubs } from "../workspace/reaction-canvas.test-support";
import ReferenceSearch from "./ReferenceSearch.vue";

jest.mock("vue-router", () => ({ useRoute: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({
  props: ["title"], template: "<section><h1>{{ title }}</h1><slot /></section>",
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles", "inputType"],
  template: '<span class="rendered-smiles">{{ smiles }}</span>',
}));
jest.mock("@/components/workspace/ReactionInput.vue", () => ({ name: "ReactionInput", template: "<div />" }));

const ready = {
  ready: true, source: "USPTO_FULL", record_count: 12,
  product_index_available: true, reason: null,
};
const wrappers = [];
async function setup(query = {}) {
  const route = reactive({ path: "/references", query });
  useRoute.mockReturnValue(route);
  const wrapper = mount(ReferenceSearch, { global: { stubs: uiStubs } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, route };
}
function packet(product = "CC=O", reactants = ["CCO"], scopes = ["reaction_identity"]) {
  return {
    requested: { product, reactants: [...reactants] }, query: { product, reactants: [...reactants] },
    source: "USPTO_FULL", count: scopes.length, has_more: false,
    match_basis: "exact_product_structure", retrieved_at: "2026-10-05T01:00:00Z",
    results: scopes.map((scope, index) => ({
      id: `reference-${index}`, reaction_smiles: `CCO>>${product}`,
      reactants: scope === "reaction_identity" ? [...reactants] : ["CCN"], products: [product], agents: [],
      match_scope: scope, conditions: null, reported_yields: [],
      provenance: {
        source: "USPTO_FULL", record_id: `reference-${index}`,
        evidence_type: "patent_reaction_extraction", yield_extraction_fields: [], patent_url_basis: null,
      },
    })),
  };
}
beforeEach(() => {
  API.get.mockReset().mockResolvedValue(ready);
  API.post.mockReset();
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("one optional-reactants canvas reads status but never searches on mount", async () => {
  const { wrapper } = await setup();
  expect(wrapper.findAllComponents(reactionInput)).toHaveLength(1);
  expect(wrapper.getComponent(reactionInput).props("requireReactants")).toBe(false);
  expect(wrapper.findAll("textarea")).toHaveLength(1);
  expect(API.get.mock.calls).toEqual([[REFERENCE_STATUS_PATH, null, false]]);
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("产物结构精确匹配");
  expect(wrapper.text()).not.toMatch(/亚结构|反应中心|反应物检索/);
});

test.each(["reaction_smiles", "rxnsmiles"])("%s preserves raw link preview and needs application before a separate search", async (key) => {
  const raw = "[13CH3][C@@H](Cl)C.[Cl-]>O>[13CH3][C@H](O)C.[Na+] |f:0.1|";
  const { wrapper } = await setup({ [key]: raw });
  expect(wrapper.get(".reference-prefill .rendered-smiles").text()).toBe(raw);
  expect(wrapper.get(".reaction-text").element.value).toBe("");
  expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(true);
  await wrapper.get("form").trigger("submit");
  await wrapper.get('[data-cy="reference-apply-prefill"]').trigger("click");
  expect(wrapper.get(".reaction-text").element.value).toBe(raw);
  expect(wrapper.find(".reference-prefill").exists()).toBe(false);
  expect(API.post).not.toHaveBeenCalled();
  const reactants = ["[13CH3][C@@H](Cl)C.[Cl-]"], product = "[13CH3][C@H](O)C.[Na+]";
  await setReactionDraft(wrapper, { reactants, product, agents: [{ smiles: "O" }] });
  API.post.mockResolvedValue(packet(product, reactants));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post.mock.calls).toEqual([[REFERENCE_SEARCH_PATH, { product, reactants, limit: 20 }]]);
});

test("complete compound records come from the canvas, not raw text or agent roles", async () => {
  const { wrapper } = await setup();
  await wrapper.get(".reaction-text").setValue("raw-input-authority");
  const reactants = ["[Na+].[O-]C", "[13CH3][C@@H](Cl)C"], product = "[13CH3][C@H](O)C";
  await setReactionDraft(wrapper, { reactants, product, agents: [{ smiles: "Cl" }] });
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
  expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(true);
});

test("product matching keeps full-reaction and product-only scopes distinct", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  API.post.mockResolvedValue(packet("CC=O", ["CCO"], ["reaction_identity", "product_identity"]));
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
  expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(true);
  await wrapper.vm.search();
  expect(API.post).toHaveBeenCalledTimes(1);
});

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
  expect(wrapper.find('[data-cy="reference-actual-input"]').exists()).toBe(false);
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
  expect(wrapper.find('[data-cy="reference-apply-prefill"]').exists()).toBe(true);
  expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(true);
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
])("conflicting or typed link fields require dismissal before search: %p", async (query) => {
  const { wrapper } = await setup(query);
  await setReactionDraft(wrapper, { product: "CC=O", reactants: ["CCO"] });
  expect(wrapper.get(".reference-prefill [role='alert']").text()).toContain("未应用输入");
  await wrapper.vm.search();
  expect(API.post).not.toHaveBeenCalled();
  await wrapper.findAll(".reference-prefill button").at(-1).trigger("click");
  expect(wrapper.get('[data-cy="reference-search-submit"]').element.disabled).toBe(false);
});

test("chemical validation stays with the canvas, and unready sources still gate search", async () => {
  API.get.mockResolvedValue({ ...ready, ready: false, product_index_available: false, reason: "reference_product_index_unavailable" });
  const { wrapper } = await setup({ rxnsmiles: "CCO>CC=O" });
  await wrapper.get('[data-cy="reference-apply-prefill"]').trigger("click");
  expect(wrapper.get(".reaction-text").element.value).toBe("CCO>CC=O");
  await setReactionDraft(wrapper, { pending: true });
  await wrapper.vm.search();
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("索引未就绪");
});
