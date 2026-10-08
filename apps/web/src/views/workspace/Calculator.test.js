import { reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import {
  deferred,
  reactionInput,
  setReactionDraft,
  uiStubs,
} from "./reaction-canvas.test-support";
import WorkbenchForm from "@/components/workspace/WorkbenchForm.vue";
import Calculator from "./Calculator.vue";

jest.mock("vue-router", () => ({ useRoute: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({
  props: ["title"],
  template: "<section><h1>{{ title }}</h1><slot /></section>",
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage",
  props: ["smiles"],
  template: '<span class="rendered-smiles">{{ smiles }}</span>',
}));
jest.mock("@/components/workspace/StructureInput.vue", () => ({
  name: "StructureInput",
  template: "<div />",
}));
jest.mock("@/components/workspace/ReactionInput.vue", () => ({
  name: "ReactionInput",
  template: "<div />",
}));

const wrappers = [];
async function setup(
  path = "/feasibility",
  query = { reactants: "CCO", product: "CC=O" },
) {
  const route = reactive({ path, query });
  useRoute.mockReturnValue(route);
  const wrapper = mount(Calculator, { global: { stubs: uiStubs } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, route };
}
function ffResponses(score = 0.45, reactants = "CCO", product = "CC=O") {
  API.post
    .mockResolvedValueOnce({ smiles: reactants })
    .mockResolvedValueOnce({ smiles: product })
    .mockResolvedValueOnce({ result: score });
}
beforeEach(() => {
  API.post.mockReset();
  API.get.mockReset();
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test.each(["/feasibility", "/molcom"])(
  "%s uses the shared form without bypassing calculation guards",
  async (path) => {
    const { wrapper } = await setup(path, {});
    const form = wrapper.getComponent(WorkbenchForm);
    expect(wrapper.findAll("form")).toHaveLength(1);
    expect(
      form.element.children[0].classList.contains("workbench-input-area"),
    ).toBe(true);
    expect(form.element.children[1].tagName).toBe("ASIDE");
    expect(form.findAll("aside")).toHaveLength(1);
    expect(form.get(".workbench-inspector").attributes("aria-label")).toBe(
      "计算参数",
    );
    expect(
      form.get(".workbench-inspector > .calculator-parameters").element.tagName,
    ).toBe("DIV");
    expect(
      form.get(".workbench-input-area .calculator-structure").exists(),
    ).toBe(true);
    expect(form.find(".calculator-results").exists()).toBe(false);
    expect(wrapper.find(".calculator-results").exists()).toBe(false);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.element.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(form.emitted("submit")).toEqual([[event]]);
    expect(API.post).not.toHaveBeenCalled();
  },
);

test("FF has one reaction canvas and only previews serialized link input on mount", async () => {
  const { wrapper } = await setup();
  expect(wrapper.get("h1").text()).toBe("反应可行性");
  expect(wrapper.findAllComponents(reactionInput)).toHaveLength(1);
  expect(wrapper.getComponent(reactionInput).props("requireReactants")).toBe(
    true,
  );
  expect(wrapper.find('[data-cy="calculator-molecule"]').exists()).toBe(false);
  expect(wrapper.get(".reaction-text").element.value).toBe("CCO>>CC=O");
  expect(wrapper.get('[data-cy="calculator-submit"]').element.disabled).toBe(
    true,
  );
  expect(API.post).not.toHaveBeenCalled();
  expect(API.get).not.toHaveBeenCalled();
});

test("FF scores canvas reactants and selected product without imported agents or raw parsing", async () => {
  const { wrapper } = await setup("/feasibility", {
    rxnsmiles: "raw-input-authority",
  });
  const reactants = ["[Na+].[O-]C", "CCO"],
    product = "[13CH3][C@H](O)C";
  await setReactionDraft(wrapper, {
    reactants,
    product,
    agents: [{ smiles: "Cl" }],
  });
  ffResponses(0.45, reactants.join("."), product);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post.mock.calls).toEqual([
    ["/api/v1/structure/validate", { smiles: reactants.join(".") }],
    ["/api/v1/structure/validate", { smiles: product }],
    ["/api/fast-filter/call-sync", { smiles: [reactants.join("."), product] }],
  ]);
  expect(wrapper.get(".calculation-score").text()).toContain(
    "反应模型评分（FF）",
  );
  expect(wrapper.get(".calculation-score strong").text()).toBe("0.450");
  expect(
    wrapper
      .findAll(".calculation-structures .rendered-smiles")
      .map((item) => item.text()),
  ).toEqual([reactants.join("."), product]);
  expect(wrapper.text()).not.toContain("实验成功率");
});

test("a zero score opens a separate reading layer and edit returns to the retained reaction without recalc", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  ffResponses(0);
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(wrapper.get("form").attributes("style")).toContain("display: none");
  expect(wrapper.get(".calculation-score strong").text()).toBe("0.000");
  await wrapper.findAll("button").find((button) => button.text() === "返回修改").trigger("click");
  expect(wrapper.get("form").attributes("style") || "").not.toContain("display: none");
  expect(wrapper.get(".reaction-text").element.value).toBe("CCO>>CC=O");
  expect(wrapper.find(".calculator-results").exists()).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(3);
});

test.each([
  { pending: true, reactants: ["CCO"], product: "CC=O" },
  { pending: false, reactants: [], product: "CC=O" },
  { pending: false, reactants: ["CCO"], product: "" },
])(
  "incomplete or pending canvas prevents even programmatic calculation: %p",
  async (draft) => {
    const { wrapper } = await setup();
    await setReactionDraft(wrapper, draft);
    await wrapper.vm.calculate();
    expect(API.post).not.toHaveBeenCalled();
    expect(wrapper.get('[data-cy="calculator-submit"]').element.disabled).toBe(
      true,
    );
  },
);

test("one active calculation blocks repeat submits and releases loading after stale validation", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  const held = deferred();
  API.post.mockReturnValue(held.promise);
  await wrapper.get("form").trigger("submit");
  await wrapper.get("form").trigger("submit");
  expect(API.post).toHaveBeenCalledTimes(1);
  await wrapper
    .getComponent(reactionInput)
    .vm.$emit("update:modelValue", "edited-input");
  held.resolve({ smiles: "CCO" });
  await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(wrapper.find(".calculation-score").exists()).toBe(false);
  expect(wrapper.vm.loading).toBe(false);
  expect(wrapper.get('[data-cy="calculator-submit"]').element.disabled).toBe(
    true,
  );
  await setReactionDraft(wrapper, { pending: false });
  expect(wrapper.get('[data-cy="calculator-submit"]').element.disabled).toBe(
    false,
  );
});

test("a late raw canvas update clears an existing score even if canvas identities have not changed", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  ffResponses();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.find(".calculation-score").exists()).toBe(true);
  await wrapper.getComponent(reactionInput).vm.$emit("update:modelValue", "OCC>>C(C)=O");
  expect(wrapper.find(".calculation-score").exists()).toBe(false);
});

test("read-only editor recycling preserves the score while changed chemical roles invalidate it", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  ffResponses(); await wrapper.get("form").trigger("submit"); await flushPromises();
  await setReactionDraft(wrapper, { pending: true });
  expect(wrapper.get(".calculation-score strong").text()).toBe("0.450");
  await setReactionDraft(wrapper, { pending: false, product: "CCOC" });
  expect(wrapper.find(".calculation-score").exists()).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(3);
});

test("same-tick URL updates cannot calculate with previous canvas roles", async () => {
  const { wrapper, route } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  route.query = { rxnsmiles: "CCN>>CC=N" };
  await wrapper.vm.calculate();
  expect(API.post).not.toHaveBeenCalled();
});

test("pending edit and revert reject a late FF result and release the request", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  const held = deferred();
  API.post
    .mockResolvedValueOnce({ smiles: "CCO" })
    .mockResolvedValueOnce({ smiles: "CC=O" })
    .mockReturnValueOnce(held.promise);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  await setReactionDraft(wrapper, { pending: true });
  await setReactionDraft(wrapper, { pending: false });
  held.resolve({ result: 0.8 });
  await flushPromises();
  expect(wrapper.find(".calculation-score").exists()).toBe(false);
  expect(wrapper.get('[data-cy="calculator-submit"]').element.disabled).toBe(
    false,
  );
});

test("switching to SCScore rejects late FF replies and keeps the molecule path", async () => {
  const { wrapper, route } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  const held = deferred();
  API.post
    .mockResolvedValueOnce({ smiles: "CCO" })
    .mockResolvedValueOnce({ smiles: "CC=O" })
    .mockReturnValueOnce(held.promise);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  route.path = "/molcom";
  route.query = { smiles: "CCN" };
  await flushPromises();
  held.resolve({ result: 0.8 });
  await flushPromises();
  expect(wrapper.find(".calculation-score").exists()).toBe(false);
  expect(wrapper.findComponent(reactionInput).exists()).toBe(false);
  expect(wrapper.get(".molecule-text").element.value).toBe("CCN");
  API.post
    .mockReset()
    .mockResolvedValueOnce({ smiles: "CCN" })
    .mockResolvedValueOnce({ result: { scscore: 2.4 } });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post.mock.calls).toEqual([
    ["/api/v1/structure/validate", { smiles: "CCN" }],
    ["/api/scscore/call-sync", { smiles: "CCN" }],
  ]);
  expect(wrapper.get(".calculation-score strong").text()).toBe("2.400");
});

test("SCScore retains a single structure input with its pending gate and no automatic calculation", async () => {
  const { wrapper } = await setup("/molcom", {
    smiles: "[13CH3][C@H](O)C.[Na+]",
  });
  expect(wrapper.findComponent(reactionInput).exists()).toBe(false);
  expect(
    wrapper.get('[data-cy="calculator-molecule"]').attributes("canvas-height"),
  ).toBe("480");
  expect(wrapper.get(".molecule-text").element.value).toBe(
    "[13CH3][C@H](O)C.[Na+]",
  );
  await wrapper.get(".draft").trigger("click");
  await wrapper.vm.calculate();
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.get('[data-cy="calculator-submit"]').element.disabled).toBe(
    true,
  );
});

test.each([
  { rxnsmiles: ["CCO>>CC=O"] },
  { reaction_smiles: "CCO>>CC=O", rxnsmiles: "CCN>>CC=N" },
  { reactants: ["CCO"], product: "CC=O" },
])(
  "invalid typed links cannot fall back to stale canvas identities: %p",
  async (query) => {
    const { wrapper } = await setup("/feasibility", query);
    await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
    await wrapper.vm.calculate();
    expect(API.post).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain("未应用输入");
    await wrapper.get(".reaction-text").setValue("CCO>>CC=O");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  },
);

test("raw reaction URL is preserved, and unsupported query agents are not passed to models", async () => {
  const raw = "[Na+].[O-]C>Cl>[13CH3][C@H](O)C |f:0.1|";
  const { wrapper } = await setup("/feasibility", {
    reaction_smiles: raw,
    agents: "O",
  });
  expect(wrapper.get(".reaction-text").element.value).toBe(raw);
  expect(API.post).not.toHaveBeenCalled();
});

test.each([NaN, Infinity, null, "0.5"])(
  "invalid model score %p is an error, never a scientific result",
  async (value) => {
    const { wrapper } = await setup();
    await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
    ffResponses(value);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("模型计算失败");
    expect(wrapper.find(".calculation-score").exists()).toBe(false);
    expect(wrapper.get('[data-cy="calculator-submit"]').element.disabled).toBe(
      false,
    );
  },
);

test("validation errors clear on edits and only an explicit retry can calculate", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  API.post.mockRejectedValueOnce(new Error('{"detail":"无效结构"}'));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("无效结构");
  await wrapper.get(".reaction-text").setValue("OCC>>CC=O");
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(1);
  await setReactionDraft(wrapper, { pending: false });
  ffResponses();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get(".calculation-score strong").text()).toBe("0.450");
});

test("unmount cancels presentation of a late validation response", async () => {
  const { wrapper } = await setup();
  await setReactionDraft(wrapper, { reactants: ["CCO"], product: "CC=O" });
  const held = deferred();
  API.post.mockReturnValue(held.promise);
  await wrapper.get("form").trigger("submit");
  wrapper.unmount();
  held.resolve({ smiles: "CCO" });
  await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
});
