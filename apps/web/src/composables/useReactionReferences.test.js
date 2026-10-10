import { defineComponent, h, ref } from "vue";
import { randomUUID } from "node:crypto";
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true });
import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { downloadChemicalFile } from "@/common/chemical-files";
import {
  REFERENCE_SEARCH_PATH,
  REFERENCE_STATUS_PATH,
} from "@/common/reaction-references";
import ReferenceResults from "@/components/references/ReferenceResults.vue";
import ReactionReferences from "@/components/references/ReactionReferences.vue";
import { referenceDialogStub } from "@/components/references/reference-dialog.test-support";
import { useReactionReferences } from "./useReactionReferences";

jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/common/chemical-files", () => ({
  downloadChemicalFile: jest.fn(),
}));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({
  name: "StructurePreview", props: ["smiles", "inputType", "label"],
  template: '<span class="rendered-smiles">{{ smiles }}</span>',
}));

// Only isolated UI/transport boundaries are stubbed; NativeMongo/Chrome acceptance belongs to parent.
const ready = {
  ready: true,
  source: "USPTO_FULL",
  record_count: 12,
  product_index_available: true,
  reason: null,
};
const unavailable = {
  ...ready,
  ready: false,
  product_index_available: false,
  reason: "reference_product_index_unavailable",
};
function packet(product = "CC=O", reactants = ["CCO"]) {
  return {
    requested: { product, reactants: [...reactants] },
    query: { product, reactants },
    source: "USPTO_FULL",
    count: 1,
    has_more: false,
    match_basis: "exact_product_structure",
    retrieved_at: "2026-10-04T08:00:00Z",
    results: [
      {
        id: "isolated-reference",
        reaction_smiles: `${reactants.join(".") || "CCO"}>>${product}`,
        reactants: reactants.length ? [...reactants] : ["CCO"],
        products: [product],
        agents: [],
        match_scope: reactants.length
          ? "reaction_identity"
          : "product_identity",
        conditions: null,
        patent_number: null,
        patent_url: null,
        paragraph: null,
        year: null,
        reported_yields: [
          { value: 0, unit: null, method: "text_mined_yield", text: "0" },
        ],
        provenance: {
          source: "USPTO_FULL",
          record_id: "isolated-reference",
          evidence_type: "patent_reaction_extraction",
          yield_extraction_fields: ["text_mined_yield"],
          patent_url_basis: null,
        },
      },
    ],
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const wrappers = [];
const stubs = {
  VDefaultsProvider: { template: "<slot />" },
  VDialog: referenceDialogStub,
  VBtn: {
    props: ["disabled", "loading", "type"],
    template:
      '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>',
  },
  VTextField: {
    props: ["modelValue", "label", "disabled", "errorMessages"],
    emits: ["update:modelValue"],
    template: `<label>{{ label }}<input :value="modelValue" :aria-label="label" :disabled="disabled"
      @input="$emit('update:modelValue', $event.target.value)" /><span>{{ errorMessages }}</span></label>`,
  },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VIcon: true,
  VLazy: { template: '<div><slot /></div>' },
};
function mounted(component, props = {}) {
  const wrapper = mount(component, { props, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}
async function setup(options = {}) {
  const product = ref("CC=O"),
    reactants = ref(["CCO"]),
    limit = ref(20),
    blocked = ref(false);
  let state;
  const wrapper = mounted(
    defineComponent({
      setup() {
        state = useReactionReferences({ product, reactants, limit, blocked, ...options });
        return () => null;
      },
    }),
  );
  await flushPromises();
  return { state, wrapper, product, reactants, limit, blocked };
}
beforeEach(() => {
  API.get.mockReset().mockResolvedValue(ready);
  API.post.mockReset();
  downloadChemicalFile.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue() },
  });
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("query lifecycle", () => {
  test("mount only reads status; an explicit click owns actual input and one bounded POST", async () => {
    const { state } = await setup();
    expect(API.get.mock.calls).toEqual([[REFERENCE_STATUS_PATH, null, false]]);
    expect(API.post).not.toHaveBeenCalled();
    expect(state.actualInput.value).toBeNull();
    const held = deferred();
    API.post.mockReturnValue(held.promise);
    const first = state.search();
    await state.search();
    expect(API.post.mock.calls).toEqual([
      [
        REFERENCE_SEARCH_PATH,
        { product: "CC=O", reactants: ["CCO"], limit: 20 },
      ],
    ]);
    expect(state.actualInput.value).toEqual({
      product: "CC=O",
      reactants: ["CCO"],
    });
    expect(state.searchState.value).toBe("loading");
    held.resolve(packet());
    await first;
    expect(state.searchState.value).toBe("success");
    expect(state.result.value.count).toBe(1);
  });
  test("a same-length wrong requested echo becomes an error without caching metadata", async () => {
    const { state } = await setup(),
      response = packet();
    response.requested.reactants = ["CCN"];
    API.post.mockResolvedValue(response);
    await state.search();
    expect(state.searchState.value).toBe("error");
    expect(state.error.value).toContain("格式无效");
    expect(state.result.value).toBeNull();
    expect(state.actualInput.value).toEqual({
      product: "CC=O",
      reactants: ["CCO"],
    });
    expect(API.get.mock.calls).toEqual([[REFERENCE_STATUS_PATH, null, false]]);
    expect(API.post.mock.calls).toEqual([
      [
        REFERENCE_SEARCH_PATH,
        { product: "CC=O", reactants: ["CCO"], limit: 20 },
      ],
    ]);
  });
  test("noncanonical submissions bind exact requested echo with only one search request", async () => {
    const { state, product, reactants } = await setup(),
      response = packet();
    product.value = " C(C)=O ";
    reactants.value = [" OCC "];
    response.requested = { product: "C(C)=O", reactants: ["OCC"] };
    API.post.mockResolvedValue(response);
    await state.search();
    expect(state.searchState.value).toBe("success");
    expect(state.actualInput.value).toEqual(response.requested);
    expect(state.result.value.query).toEqual({
      product: "CC=O",
      reactants: ["CCO"],
    });
    expect(API.get.mock.calls).toEqual([[REFERENCE_STATUS_PATH, null, false]]);
    expect(API.post.mock.calls).toEqual([
      [
        REFERENCE_SEARCH_PATH,
        { product: "C(C)=O", reactants: ["OCC"], limit: 20 },
      ],
    ]);
  });
  test.each([
    unavailable,
    { ...ready, source: "ORD" },
    { ...ready, product_index_available: false },
    { ...ready, record_count: 0 },
    { ready: true, source: "USPTO_FULL" },
  ])(
    "unavailable or malformed source %p prevents submission",
    async (value) => {
      API.get.mockResolvedValue(value);
      const { state } = await setup();
      await state.search();
      expect(state.canSearch.value).toBe(false);
      expect(API.post).not.toHaveBeenCalled();
    },
  );
  test("503 status snapshots display the real reason and only explicit refresh can recover", async () => {
    API.get.mockRejectedValueOnce(new Error(JSON.stringify(unavailable)));
    const { state } = await setup();
    expect(state.unavailableReason.value).toContain("索引未就绪");
    expect(state.sourceStatus.value).toEqual(unavailable);
    await state.search();
    expect(API.post).not.toHaveBeenCalled();
    await state.loadStatus();
    expect(state.canSearch.value).toBe(true);
  });
  test("late status cannot override a newer refresh or readiness", async () => {
    const first = deferred(),
      second = deferred();
    API.get
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { state } = await setup();
    const refresh = state.loadStatus();
    first.resolve(unavailable);
    await flushPromises();
    expect(state.statusLoading.value).toBe(true);
    second.resolve(ready);
    await refresh;
    expect(state.canSearch.value).toBe(true);
  });
  test("invalid count or pending structure draft blocks calls and clears old results", async () => {
    const { state, limit, blocked } = await setup();
    API.post.mockResolvedValue(packet());
    await state.search();
    blocked.value = true;
    expect(state.result.value).toBeNull();
    await state.search();
    blocked.value = false;
    limit.value = "31";
    await state.search();
    expect(state.countError.value).toContain("1-30");
    expect(API.post).toHaveBeenCalledTimes(1);
  });
  test("a nonchemical interaction suspension blocks new searches without discarding accepted evidence", async () => {
    const invalidationBlocked = ref(false);
    const { state, blocked } = await setup({ invalidationBlocked });
    API.post.mockResolvedValue(packet());
    await state.search();
    const accepted = state.result.value;
    blocked.value = true;
    expect(state.result.value).toBe(accepted);
    expect(state.canSearch.value).toBe(false);
    await state.search();
    blocked.value = false;
    expect(state.result.value).toBe(accepted);
    expect(API.post).toHaveBeenCalledTimes(1);
  });
  test("a chemical pending revision still rejects late replies even if interaction blocking reverts", async () => {
    const invalidationBlocked = ref(false);
    const { state, blocked } = await setup({ invalidationBlocked });
    const held = deferred();
    API.post.mockReturnValue(held.promise);
    const searching = state.search();
    invalidationBlocked.value = true;
    blocked.value = true;
    invalidationBlocked.value = false;
    blocked.value = false;
    held.resolve(packet());
    await searching;
    expect(state.result.value).toBeNull();
    expect(state.actualInput.value).toBeNull();
  });
  test("input change and immediate revert cannot resurrect a late response", async () => {
    const { state, product } = await setup(),
      held = deferred();
    API.post.mockReturnValue(held.promise);
    const search = state.search();
    product.value = "CC=N";
    product.value = "CC=O";
    held.resolve(packet());
    await search;
    expect(state.result.value).toBeNull();
    expect(state.actualInput.value).toBeNull();
    expect(state.searchState.value).toBe("idle");
  });
  test("in-place reactant edits reject old errors and cannot finish a newer query", async () => {
    const { state, reactants, product } = await setup(),
      first = deferred(),
      second = deferred();
    API.post
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const old = state.search();
    reactants.value[0] = "CCN";
    product.value = "CC=N";
    const current = state.search();
    first.reject(new Error("old error"));
    await old;
    expect(state.loading.value).toBe(true);
    expect(state.error.value).toBe("");
    second.resolve(packet("CC=N", ["CCN"]));
    await current;
    expect(state.result.value.query.product).toBe("CC=N");
  });
  test("unmount rejects both pending status and search completions", async () => {
    const { state, wrapper } = await setup(),
      held = deferred();
    API.post.mockReturnValue(held.promise);
    const search = state.search();
    wrapper.unmount();
    held.resolve(packet());
    await search;
    expect(state.result.value).toBeNull();
    const status = deferred();
    API.get.mockReturnValue(status.promise);
    const second = await setup();
    second.wrapper.unmount();
    status.resolve(ready);
    await flushPromises();
    expect(second.state.sourceStatus.value).toBeNull();
  });
  test("failure and malformed responses are errors; empty references are a distinct successful state", async () => {
    const { state, product } = await setup();
    API.post.mockRejectedValueOnce(
      new Error('{"detail":{"code":"reference_query_timeout"}}'),
    );
    await state.search();
    expect(state.error.value).toContain("超时");
    expect(state.searchState.value).toBe("error");
    API.post.mockResolvedValueOnce({
      result: [{ template_id: "unit-template" }],
    });
    await state.search();
    expect(state.error.value).toContain("格式无效");
    expect(state.result.value).toBeNull();
    API.post.mockResolvedValueOnce({ ...packet(), results: [], count: 0 });
    await state.search();
    expect(state.searchState.value).toBe("empty");
    product.value = "CC=N";
    expect(state.searchState.value).toBe("idle");
    expect(state.searched.value).toBe(false);
  });
});

describe("shared reaction references", () => {
  test("no automatic search; prop/node changes clear results and reject late replies", async () => {
    const wrapper = mounted(ReactionReferences, {
      product: "CC=O",
      reactants: ["CCO"],
    });
    await flushPromises();
    expect(API.post).not.toHaveBeenCalled();
    API.post.mockResolvedValueOnce(packet());
    await wrapper.get('[data-cy="reaction-reference-search"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(true);
    const held = deferred();
    API.post.mockReturnValueOnce(held.promise);
    await wrapper.get('[data-cy="reaction-reference-search"]').trigger("click");
    await wrapper.setProps({ product: "CC=N", reactants: ["CCN"] });
    held.resolve(packet());
    await flushPromises();
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
    expect(wrapper.find('[data-cy="reference-actual-input"]').exists()).toBe(
      false,
    );
  });
  test("a replaced reactant array invalidates a pending query even with identical structures", async () => {
    const wrapper = mounted(ReactionReferences, {
      product: "CC=O",
      reactants: ["CCO"],
    });
    await flushPromises();
    const held = deferred();
    API.post.mockReturnValue(held.promise);
    await wrapper.get('[data-cy="reaction-reference-search"]').trigger("click");
    await wrapper.setProps({ reactants: ["CCO"] });
    held.resolve(packet());
    await flushPromises();
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
  });
  test("parent node keys reject a late result even when both nodes have identical chemistry", async () => {
    const node = ref("node-a"),
      reactants = ["CCO"];
    const wrapper = mounted(
      defineComponent({
        setup() {
          return () =>
            h(ReactionReferences, {
              key: node.value,
              product: "CC=O",
              reactants,
            });
        },
      }),
    );
    await flushPromises();
    const held = deferred();
    API.post.mockReturnValue(held.promise);
    await wrapper.get('[data-cy="reaction-reference-search"]').trigger("click");
    node.value = "node-b";
    await flushPromises();
    held.resolve(packet());
    await flushPromises();
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
    expect(wrapper.find('[data-cy="reference-actual-input"]').exists()).toBe(
      false,
    );
    expect(API.get).toHaveBeenCalledTimes(2);
    expect(API.post).toHaveBeenCalledTimes(1);
  });
});

describe("reference records", () => {
  test("reference magnification receives verified role arrays rather than the raw mapped string", async () => {
    const response = packet();
    response.results[0].reaction_smiles = "[CH3:1][CH2:2]O>>[CH3:1][CH:2]=O";
    const wrapper = mounted(ReferenceResults, {
      response, actualInput: response.query, searched: true,
    });
    const preview = wrapper.getComponent({ name: "StructurePreview" });
    expect(preview.props("inputType")).toBe("reaction");
    expect(preview.props("smiles")).toBe("CCO>>CC=O");
    expect(wrapper.find(".reference-raw").exists()).toBe(false);
    await wrapper.get('[data-cy="reference-details"]').trigger("click");
    expect(wrapper.get(".reference-raw").text()).toBe(response.results[0].reaction_smiles);
    expect(API.post).not.toHaveBeenCalled();
  });
  test("a suspended record blocks copy, export and canvas reuse without hiding its evidence", async () => {
    const response = packet();
    const wrapper = mounted(ReferenceResults, {
      response, actualInput: response.query, searched: true, allowCanvasReuse: true, blocked: true,
    });
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(true);
    for (const action of ["reference-copy", "reference-export", "reference-load-reaction"])
      expect(wrapper.get(`[data-cy="${action}"]`).element.disabled).toBe(true);
    await wrapper.vm.operate(response.results[0], "export");
    wrapper.vm.loadReaction(response.results[0]);
    expect(API.post).not.toHaveBeenCalled();
    expect(wrapper.emitted("load-reaction")).toBeUndefined();
  });
  test("records show unrecorded fields and raw yield text without guessing units or unsafe links", () => {
    const response = packet();
    response.results[0].patent_url = "javascript:alert(1)";
    const wrapper = mounted(ReferenceResults, {
      response,
      actualInput: response.query,
      searched: true,
    });
    expect(wrapper.text()).toContain("USPTO_FULL");
    expect(wrapper.text()).toContain("全反应一致");
    expect(wrapper.text()).toContain("未记录");
    expect(wrapper.text()).toContain("原文提取收率");
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/实验成功率|预测条件|实验步骤/);
  });
  test("patent links use safeExternalUrl and retain paragraph/year and raw reaction", async () => {
    const response = packet(),
      row = response.results[0];
    Object.assign(row, {
      patent_number: "unit-patent",
      patent_url: "https://patents.google.com/patent/unit-patent",
      paragraph: "[0012]",
      year: 2016,
    });
    const wrapper = mounted(ReferenceResults, {
      response,
      actualInput: response.query,
      searched: true,
    });
    expect(wrapper.get("a").attributes("rel")).toBe("noopener noreferrer");
    expect(wrapper.text()).toContain("[0012]");
    expect(wrapper.text()).toContain("2016");
    await wrapper.get('[data-cy="reference-details"]').trigger("click");
    expect(wrapper.get(".reference-raw").text()).toBe(row.reaction_smiles);
  });
  test("noncanonical requested input retains canonical metadata rendering without extra API calls", () => {
    const response = packet(),
      actualInput = { product: "C(C)=O", reactants: ["OCC"] };
    response.requested = {
      ...actualInput,
      reactants: [...actualInput.reactants],
    };
    const wrapper = mounted(ReferenceResults, {
      response,
      actualInput,
      searched: true,
    });
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(true);
    expect(wrapper.get('[data-cy="reference-actual-input"]').text()).toContain(
      "CC=O",
    );
    expect(wrapper.get('[data-cy="reference-actual-input"]').text()).toContain(
      "CCO",
    );
    expect(wrapper.text()).toContain("原文提取收率");
    expect(API.get).not.toHaveBeenCalled();
    expect(API.post).not.toHaveBeenCalled();
  });
  test("cached metadata never self-binds to canonical query or a wrong requested echo", async () => {
    const response = packet(),
      wrapper = mounted(ReferenceResults, { response, searched: true });
    expect(wrapper.text()).toContain("格式无效");
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
    await wrapper.setProps({ actualInput: response.requested });
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(true);
    const changed = packet();
    changed.requested.reactants = ["CCN"];
    await wrapper.setProps({ response: changed });
    expect(wrapper.text()).toContain("格式无效");
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
    expect(wrapper.find('[data-cy="reference-copy"]').exists()).toBe(false);
    expect(API.post).not.toHaveBeenCalled();
  });
  test("copy and RXN export only operate on the actual selected record", async () => {
    const response = packet(),
      wrapper = mounted(ReferenceResults, {
        response,
        actualInput: response.query,
        searched: true,
      });
    await wrapper.get('[data-cy="reference-copy"]').trigger("click");
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      response.results[0].reaction_smiles,
    );
    API.post.mockResolvedValue({ format: "rxn", content: "$RXN" });
    await wrapper.get('[data-cy="reference-export"]').trigger("click");
    await flushPromises();
    expect(API.post.mock.calls).toEqual([
      [
        "/api/v1/structure/reaction-export",
        { reactants: ["CCO"], products: ["CC=O"], agents: [] },
        false,
        { signal: expect.any(AbortSignal), timeoutMs: 15000 },
      ],
    ]);
    expect(downloadChemicalFile).toHaveBeenCalledWith(
      { format: "rxn", content: "$RXN" },
      "reference-reaction",
    );
  });
  test.each(["replace", "unmount", "block-and-revert"])(
    "a late RXN response cannot export after %s",
    async (operation) => {
      const response = packet(),
        wrapper = mounted(ReferenceResults, {
          response,
          actualInput: response.query,
          searched: true,
        });
      const held = deferred();
      API.post.mockReturnValue(held.promise);
      await wrapper.get('[data-cy="reference-export"]').trigger("click");
      if (operation === "replace")
        await wrapper.setProps({ response: null, actualInput: null });
      else if (operation === "block-and-revert") {
        await wrapper.setProps({ blocked: true });
        await wrapper.setProps({ blocked: false });
      }
      else wrapper.unmount();
      held.resolve({ format: "rxn", content: "$RXN" });
      await flushPromises();
      expect(downloadChemicalFile).not.toHaveBeenCalled();
    },
  );
  test("prediction-shaped record props and non-RXN export responses are visibly rejected", async () => {
    const response = packet(),
      wrapper = mounted(ReferenceResults, {
        response,
        actualInput: response.query,
        searched: true,
      });
    API.post.mockResolvedValue({ format: "sdf", content: "wrong format" });
    await wrapper.get('[data-cy="reference-export"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("RXN 导出响应格式无效");
    expect(downloadChemicalFile).not.toHaveBeenCalled();
    await wrapper.setProps({
      response: { results: [{ template_id: "not-literature" }] },
    });
    expect(wrapper.text()).toContain("格式无效");
    expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
  });
});
