import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { priceContractResponse } from "@/common/route-price-test-data";
import RouteMaterials from "./RouteMaterials.vue";

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/SmilesImage.vue", () => ({ template: "<span />" }));
const snapshot = "a".repeat(64);
const graph = { target_id: "target", nodes: [
  { id: "material", type: "molecule", smiles: "CCO", label: "原料" },
  { id: "reaction", type: "reaction", label: "步骤 1" },
  { id: "target", type: "molecule", smiles: "CC=O" },
], edges: [{ source: "material", target: "reaction" }, { source: "reaction", target: "target" }] };
const stubs = { MoleculeStockDialog: true, VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' } };
const wrappers = [];
function setup() {
  const wrapper = mount(RouteMaterials, { props: { graph, expectedSnapshot: snapshot }, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => API.post.mockReset());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const response = () => priceContractResponse();

test("materials lookup stays explicit and shows per-supplier raw catalog prices without cost totals", async () => {
  const wrapper = setup();
  expect(API.post).not.toHaveBeenCalled();
  API.post.mockResolvedValueOnce(response());
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/stock/lookup", { smiles: ["CCO"] });
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.text()).toContain("币种未标注");
  expect(wrapper.text()).not.toMatch(/总价|成本|人民币|USD|CNY/);
});
test("wrong record structure is rejected before presenting a price", async () => {
  const value = response();
  value.results.CCO[0].smiles = "O";
  API.post.mockResolvedValueOnce(value);
  const wrapper = setup();
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("采购目录核对失败");
  expect(wrapper.text()).not.toContain("2.08");
});
test("failed refresh removes previous prices and does not silently reuse old evidence", async () => {
  API.post.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error("目录读取失败"));
  const wrapper = setup();
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("2.08 $/g");
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.text()).not.toContain("2.08 $/g");
  expect(wrapper.get('[role="alert"]').text()).toContain("采购目录核对失败");
});
test("task snapshot changes block a late price response and require a new explicit lookup", async () => {
  let resolveOld;
  API.post.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const wrapper = setup();
  await wrapper.get("button").trigger("click");
  await wrapper.setProps({ expectedSnapshot: "b".repeat(64) });
  resolveOld(response());
  await flushPromises();
  expect(wrapper.text()).not.toContain("2.08 $/g");
  expect(wrapper.text()).toContain("未查询");
  expect(API.post).toHaveBeenCalledTimes(1);
});
test("noncanonical materials use one batch lookup and the server receipt", async () => {
  API.post.mockResolvedValueOnce({ ...response(), requested: [{ smiles: "OCC", canonical_smiles: "CCO" }] });
  const wrapper = setup();
  await wrapper.setProps({ graph: { ...graph, nodes: graph.nodes.map((node) =>
    node.id === "material" ? { ...node, smiles: "OCC" } : node) } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post).toHaveBeenCalledWith("/api/v1/stock/lookup", { smiles: ["OCC"] });
  expect(wrapper.text()).toContain("2.08 $/g");
});
