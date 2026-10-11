import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { priceContractRecord, priceContractResponse } from "@/common/route-price-test-data";
import RouteMaterials from "./RouteMaterials.vue";
import * as routeReading from "@/common/route-reading";
import Papa from "papaparse";
import { initializeLocale, setLocale } from "@/i18n";

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/SmilesImage.vue", () => ({ template: "<span />" }));
const snapshot = "a".repeat(64);
const graph = { target_id: "target", nodes: [
  { id: "material", type: "molecule", smiles: "CCO", label: "原料" },
  { id: "reaction", type: "reaction", label: "步骤 1" },
  { id: "target", type: "molecule", smiles: "CC=O" },
], edges: [{ source: "material", target: "reaction" }, { source: "reaction", target: "target" }] };
const stubs = {
  MoleculeStockDialog: true,
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VIcon: { props: ["icon"], template: '<span :data-icon="icon" />' },
};
const wrappers = [];
function setup(props = {}) {
  const wrapper = mount(RouteMaterials, { props: { graph, expectedSnapshot: snapshot, ...props }, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => API.post.mockReset());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const response = () => priceContractResponse();
// Receipt presentation controls, not scientific or supplier availability evidence.
const formReview = (smiles = "CCO", reason = "undefined_purchase_form") => ({
  version: 1, phase: "automated_review", basis: "route_receipt", grade: "purchase_form_unresolved",
  independent_review: { status: "missing" }, purchase_identity: {
    policy: "defined_purchase_identity_v1", status: "unresolved", unresolved_materials: [{ smiles, reason }],
  },
});

test("material details forward original keyboard and pointer events without a lookup", () => {
  const wrapper = setup();
  const events = [0, 1].map(detail => new MouseEvent("click", { bubbles: true, detail }));
  events.forEach(event => wrapper.get(".material-structure").element.dispatchEvent(event));
  expect(wrapper.emitted("select").map(([id]) => id)).toEqual(["material", "material"]);
  events.forEach((event, index) => expect(wrapper.emitted("select")[index][1]).toBe(event));
  expect(API.post).not.toHaveBeenCalled();
});

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

test("the materials download keeps the owner's unresolved route receipt without a lookup", async () => {
  const download = jest.spyOn(routeReading, "downloadRouteBlob").mockImplementation(() => {});
  const wrapper = setup();
  const smiles = "O=C([O-])[O-]";
  const receipt = { version: 1, phase: "automated_review", basis: "route_receipt", grade: "purchase_form_unresolved",
    independent_review: { status: "missing" }, purchase_identity: { policy: "defined_purchase_identity_v1",
      status: "unresolved", unresolved_materials: [{ smiles, reason: "undefined_purchase_form" }] } };
  try {
    await wrapper.setProps({ deliveryReview: receipt, graph: { ...graph,
      nodes: graph.nodes.map(node => node.id === "material" ? { ...node, smiles } : node) } });
    await wrapper.findAll("button")[1].trigger("click");
    expect(Papa.parse(download.mock.calls[0][0]).data[1]).toEqual(["原料", smiles, "步骤 1", "采购形式未明确", "采购形式未明确", "完整采购形式未记录"]);
    expect(API.post).not.toHaveBeenCalled();
  } finally { download.mockRestore(); }
});

test.each([
  ["undefined_purchase_form", "完整采购形式未记录", "Complete purchase form not recorded"],
  ["indeterminate_purchase_structure", "采购结构无法确定", "Purchase structure indeterminate"],
])("%s adds only a short bound warning beside the structure in both languages", async (reason, chinese, english) => {
  const receipt = formReview("CCO", reason);
  const value = { ...graph, nodes: [...graph.nodes, { id: "other", type: "molecule", smiles: "N", label: "原始名称" }],
    edges: [...graph.edges, { source: "other", target: "reaction" }] };
  const before = JSON.stringify({ value, receipt });
  initializeLocale(null);
  const wrapper = setup({ graph: value, deliveryReview: receipt });
  const warnings = wrapper.findAll('[data-purchase-status="unresolved"]');
  expect(warnings).toHaveLength(1);
  expect(warnings[0].text()).toBe("Purchase form unresolved");
  expect(warnings[0].attributes("title")).toBe(english);
  expect(warnings[0].element.parentElement.querySelector(".material-structure")).not.toBeNull();
  expect(wrapper.text()).toContain("原始名称");
  expect(wrapper.text()).not.toMatch(/Purchase form defined|Purchase form unreviewed|available|in stock|undefined_purchase_form|indeterminate_purchase_structure/i);
  setLocale("zh-CN", { persist: false }); await wrapper.vm.$nextTick();
  expect(warnings[0].text()).toBe("采购形式未明确");
  expect(warnings[0].attributes("title")).toBe(chinese);
  expect(wrapper.text()).not.toMatch(/采购形式明确|商业有货|商品可购/);
  expect(JSON.stringify({ value, receipt })).toBe(before);
  expect(API.post).not.toHaveBeenCalled();
});

test.each(["alias", "orphan", "future", "stored", "grade", "reason", "defined", "unknown"])("%s procurement evidence does not add ordinary-row warnings", variant => {
  const receipt = formReview();
  if (variant === "alias") receipt.purchase_identity.unresolved_materials[0].smiles = "OCC";
  if (variant === "orphan") receipt.purchase_identity.unresolved_materials[0].smiles = "N";
  if (variant === "future") receipt.version = 2;
  if (variant === "stored") receipt.basis = "stored_summary";
  if (variant === "grade") receipt.grade = "model_checked";
  if (variant === "reason") receipt.purchase_identity.unresolved_materials[0].reason = "future_reason";
  if (["defined", "unknown"].includes(variant)) {
    receipt.grade = "not_independently_reviewed";
    receipt.purchase_identity.status = variant;
    receipt.purchase_identity.unresolved_materials = [];
  }
  const wrapper = setup({ deliveryReview: receipt });
  expect(wrapper.find("[data-purchase-status]").exists()).toBe(false);
  expect(wrapper.text()).not.toMatch(/采购形式|商业有货|商品可购/);
  expect(API.post).not.toHaveBeenCalled();
});

test("bound form warnings leave actual catalog records and explicit lookup behavior untouched", async () => {
  const value = response(), receipt = formReview(), before = JSON.stringify({ value, receipt });
  API.post.mockResolvedValueOnce(value);
  const wrapper = setup({ deliveryReview: receipt });
  expect(API.post).not.toHaveBeenCalled();
  await wrapper.get("button").trigger("click"); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.find('[data-purchase-status="unresolved"]').exists()).toBe(true);
  expect(JSON.stringify({ value, receipt })).toBe(before);
  await wrapper.setProps({ deliveryReview: formReview("OCC") });
  expect(wrapper.find("[data-purchase-status]").exists()).toBe(false);
  expect(wrapper.text()).toContain("2.08 $/g");
  await wrapper.setProps({ deliveryReview: receipt, graph: { ...graph, nodes: graph.nodes.map(node =>
    node.id === "material" ? { ...node, smiles: "N" } : node) } });
  expect(wrapper.find("[data-purchase-status]").exists()).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("new per-record lookup statuses remain distinct from the stored route-level purchase warning", async () => {
  initializeLocale(null);
  const decision = { policy: "defined_purchase_identity_v1", status: "defined", reason: null, eligible_for_closure: true };
  const defined = { ...priceContractRecord(), procurement: decision };
  const unresolved = { ...priceContractRecord(), smiles: "N", cas: "7664-41-7", url: "https://example.org/catalogue", procurement: {
    ...decision, status: "unresolved", reason: "undefined_purchase_form", eligible_for_closure: false,
  } };
  unresolved.price.record_key = { ...unresolved.price.record_key, smiles: "N" };
  const value = { ...priceContractResponse(defined), requested: [
    { smiles: "CCO", canonical_smiles: "CCO" }, { smiles: "N", canonical_smiles: "N" },
  ], results: { CCO: [defined], N: [unresolved] } };
  const viewGraph = { ...graph, nodes: [...graph.nodes, { id: "other", type: "molecule", smiles: "N", label: "原始原料名称" }],
    edges: [...graph.edges, { source: "other", target: "reaction" }] };
  const before = JSON.stringify({ value, viewGraph });
  API.post.mockResolvedValueOnce(value);
  const wrapper = setup({ graph: viewGraph });
  expect(wrapper.find("[data-procurement-status]").exists()).toBe(false);
  await wrapper.get("button").trigger("click"); await flushPromises();
  const statuses = wrapper.findAll(".catalog-record [data-procurement-status]");
  expect(statuses.map(status => status.attributes("data-procurement-status"))).toEqual(["defined", "unresolved"]);
  expect(wrapper.find("[data-purchase-status]").exists()).toBe(false);
  expect(statuses[1].text()).toContain("Complete purchase form not recorded");
  expect(statuses[1].text()).toContain("Not a confirmed commercial starting material");
  await wrapper.setProps({ deliveryReview: formReview("CCO") });
  expect(wrapper.findAll('[data-purchase-status="unresolved"]')).toHaveLength(1);
  expect(statuses[0].attributes("data-procurement-status")).toBe("defined");
  expect(statuses[1].attributes("data-procurement-status")).toBe("unresolved");
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(statuses[0].text()).toBe("采购形式明确");
  expect(statuses[1].text()).toContain("不能作为已确认商购原料");
  expect(wrapper.text()).toContain("原始原料名称");
  expect(wrapper.text()).toContain(unresolved.cas);
  expect(wrapper.get(".catalog-record > a").attributes("href")).toBe(unresolved.url);
  expect(JSON.stringify({ value, viewGraph })).toBe(before);
  expect(API.post).toHaveBeenCalledTimes(1);
  await wrapper.setProps({ expectedSnapshot: "b".repeat(64) });
  expect(wrapper.find("[data-procurement-status]").exists()).toBe(false);
  expect(wrapper.find(".procurement-material-limit").exists()).toBe(false);
});

test.each([[undefined, "unknown"], [null, "invalid"]])("per-record %p decisions retain catalog evidence without declaring closure eligibility", async (procurement, status) => {
  API.post.mockResolvedValueOnce(priceContractResponse({ ...priceContractRecord(), procurement }));
  const wrapper = setup();
  await wrapper.get("button").trigger("click"); await flushPromises();
  expect(wrapper.get("[data-procurement-status]").attributes("data-procurement-status")).toBe(status);
  expect(wrapper.find(".procurement-material-limit").exists()).toBe(false);
  expect(wrapper.find("[data-purchase-status]").exists()).toBe(false);
  expect(wrapper.text()).toContain("2.08 $/g");
});
