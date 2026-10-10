import { computed, defineComponent, h, ref, toRef } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import Forward from "./Forward.vue";
import { useReactionDraft } from "@/composables/useReactionDraft";
import { API } from "@/common/api";
import * as parser from "@/common/ketcher-reaction";

jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => ({ can: () => true }) }));
jest.mock("vuetify-use-dialog", () => ({ useConfirm: () => jest.fn() }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ template: "<div />" }));
jest.mock("@/components/workspace/ReactionInput.vue", () => ({ template: "<div />" }));
let wrapper, confirm, draft;
const Source = defineComponent({ props: ["modelValue", "disabled"], emits: ["update:modelValue"],
  setup(props, { emit, expose }) { expose({ pending: ref(false) });
    return () => h("textarea", { value: props.modelValue, disabled: props.disabled,
      onInput: event => emit("update:modelValue", event.target.value) }); } });
const Reaction = defineComponent({ props: ["modelValue", "disabled"], setup(props, { expose }) {
  draft = useReactionDraft({ text: toRef(props, "modelValue"), boardPending: ref(false), requireReactants: () => true });
  expose({ parsed: draft.parsed, selected: draft.selected, product: draft.product,
    reactants: computed(() => draft.reactants.value), pending: draft.pending });
  return () => h("textarea", { value: props.modelValue, disabled: props.disabled });
} });
async function setup(location) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/forward", component: Forward }, { path: "/analyses", component: { render: () => h("div", "History") } },
  ] });
  await router.push(location);
  wrapper = mount({ render: () => h(RouterView) }, { attachTo: document.body, global: { plugins: [router], stubs: {
    ModuleWorkbench: { template: '<section><slot name="actions" /><slot /></section>' },
    StructureInput: Source, ReactionInput: Reaction,
    VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' }, VIcon: true,
    VTextField: { props: ["modelValue", "disabled"], emits: ["update:modelValue"],
      template: '<input type="number" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', Number($event.target.value))" />' },
    VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  } } });
  await flushPromises(); return router;
}
// Parser transport fixtures prove draft lifecycle only, not chemical accuracy.
function parserResponse(products) {
  API.post.mockImplementation(async (path, requested) => {
    if (path !== "/api/v1/structure/reaction-draft") throw new Error("Unexpected model/write call");
    const data = { CCO: ["C2H6O", 46.07, 3], "CC=O": ["C2H4O", 44.05, 3], CO: ["CH4O", 32.04, 2] };
    const record = (smiles, index = 1) => ({ index, name: "", smiles, formula: data[smiles][0], molecular_weight: data[smiles][1], atoms: data[smiles][2], components: 1 });
    return { format: requested.format, requested, input_kind: "reaction", reaction_smiles: requested.content,
      reactants: [record("CCO")], products: products.map((value, index) => record(value, index + 1)), agents: [] };
  });
}
beforeEach(() => { window.history.replaceState({}, "");
  confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  API.get.mockReset(); API.post.mockReset();
});
afterEach(() => { wrapper?.unmount(); wrapper = null; jest.restoreAllMocks(); });

test("late forward-link parsing cannot mark a newer enabled user input as committed", async () => {
  let finish;
  jest.spyOn(parser, "parseReactionText").mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const router = await setup("/forward?tab=forward&rxnsmiles=CCO%3E%3ECC%3DO"), field = wrapper.get('textarea[data-cy="reactants"]');
  expect(field.element.disabled).toBe(false); await field.setValue("CCN");
  finish({ reactants: [{ smiles: "CCO" }] }); await flushPromises();
  expect(field.element.value).toBe("CCN");
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await router.push("/analyses"); expect(router.currentRoute.value.path).toBe("/forward");
  expect(confirm).toHaveBeenCalledTimes(1); expect(API.get).not.toHaveBeenCalled(); expect(API.post).not.toHaveBeenCalled();
});

test("automatic single-product selection leaves an untouched link clean", async () => {
  parserResponse(["CC=O"]); const router = await setup("/forward?tab=context&reactants=CCO&product=CC%3DO");
  await draft.validate(); await flushPromises(); expect(draft.product.value).toBe("CC=O");
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  await router.push("/analyses"); expect(router.currentRoute.value.path).toBe("/analyses");
  expect(confirm).not.toHaveBeenCalled();
});

test("successful async link initialization never acknowledges a concurrent changed candidate count", async () => {
  let finish;
  jest.spyOn(parser, "parseReactionText").mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const router = await setup("/forward?tab=forward&rxnsmiles=CCO%3E%3ECC%3DO");
  await wrapper.get('input[type="number"]').setValue("7");
  finish({ reactants: [{ smiles: "CCO" }] }); await flushPromises();
  expect(wrapper.get('textarea[data-cy="reactants"]').element.value).toBe("CCO");
  expect(wrapper.get('input[type="number"]').element.value).toBe("7");
  await router.push("/analyses"); expect(router.currentRoute.value.path).toBe("/forward");
  expect(confirm).toHaveBeenCalledTimes(1);
});

test("successful async link initialization without edits is clean", async () => {
  jest.spyOn(parser, "parseReactionText").mockResolvedValueOnce({ reactants: [{ smiles: "CCO" }] });
  const router = await setup("/forward?tab=forward&rxnsmiles=CCO%3E%3ECC%3DO");
  expect(wrapper.get('textarea[data-cy="reactants"]').element.value).toBe("CCO");
  await router.push("/analyses"); expect(router.currentRoute.value.path).toBe("/analyses");
  expect(confirm).not.toHaveBeenCalled();
});

test("saved multi-product replay is clean, but deselecting its confirmed product is protected", async () => {
  const reaction = "CCO>>CC=O.CO";
  API.get.mockResolvedValue({ id: "saved", kind: "conditions", status: "completed", created: "2026-10-08T00:00:00Z", result: {},
    inputs: { count: 3, reactants: "CCO", product: "CO", reaction_context: { reaction_smiles: reaction, selected_product: "CO" } } });
  parserResponse(["CC=O", "CO"]);
  const router = await setup("/forward?tab=context&record=saved");
  await draft.validate(); await flushPromises(); expect(draft.product.value).toBe("CO");
  const clean = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
  draft.selected.value = ""; await flushPromises();
  await router.push("/analyses"); expect(router.currentRoute.value.path).toBe("/forward"); expect(confirm).toHaveBeenCalledTimes(1);
});

test("a saved multi-product change remains protected while native parsing is temporarily pending", async () => {
  API.get.mockResolvedValue({ id: "saved", kind: "conditions", status: "completed", created: "2026-10-08T00:00:00Z", result: {},
    inputs: { count: 3, reactants: "CCO", product: "CO", reaction_context: { reaction_smiles: "CCO>>CC=O.CO", selected_product: "CO" } } });
  parserResponse(["CC=O", "CO"]);
  const router = await setup("/forward?tab=context&record=saved");
  await draft.validate(); await flushPromises();
  draft.selected.value = "CC=O"; draft.invalidate(); await flushPromises();
  expect(draft.parsed.value).toBeNull(); expect(draft.selected.value).toBe("CC=O");
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  await router.push("/analyses"); expect(router.currentRoute.value.path).toBe("/forward"); expect(confirm).toHaveBeenCalledTimes(1);
});

test("explicit multi-product selection is still an unsubmitted user choice", async () => {
  parserResponse(["CC=O", "CO"]); const router = await setup("/forward?tab=context&rxnsmiles=CCO%3E%3ECC%3DO.CO");
  await draft.validate(); await flushPromises(); expect(draft.product.value).toBe("");
  draft.selected.value = "CO"; await flushPromises();
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await router.push("/analyses"); expect(router.currentRoute.value.path).toBe("/forward");
  expect(confirm).toHaveBeenCalledTimes(1);
});
