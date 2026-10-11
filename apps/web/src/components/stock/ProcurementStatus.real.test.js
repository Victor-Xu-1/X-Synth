import { request } from "node:http";
import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { catalogRecordsForInputs, supplierPriceView } from "@/common/route-price";
import { stockProcurementPresentation } from "@/common/stock-procurement";
import { readSelectedRoutes } from "@/common/route-details";
import { topologyFromCandidate } from "@/common/route-graph";
import { initializeLocale, setLocale, uiText } from "@/i18n";
import StockRecordList from "./StockRecordList.vue";
import StockEvidence from "./StockEvidence.vue";
import MoleculeStockDialog from "@/components/routes/MoleculeStockDialog.vue";
import RouteMaterials from "@/components/routes/RouteMaterials.vue";

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/SmilesImage.vue", () => ({ template: "<span />" }));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({ template: "<span />" }));

// Explicit live API opt-in; no private response fixtures or model submissions.
const base = process.env.X_SYNTH_TEST_STOCK_API;
const jobId = process.env.X_SYNTH_TEST_PROCUREMENT_JOB_ID;
const realTest = base && jobId ? test : test.skip;
const stubs = {
  VDefaultsProvider: { template: "<slot />" },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
  VCard: { template: "<div><slot /></div>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VIcon: true,
};
const wrappers = [];
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

function readApi(path, body) {
  return new Promise((resolve, reject) => {
    const wire = request(new URL(path, base), {
      method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, timeout: 10000,
    }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("error", reject);
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) return reject(new Error(`Live API HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(text)); } catch (cause) { reject(cause); }
      });
    });
    wire.on("error", reject);
    wire.on("timeout", () => wire.destroy(new Error("Live API timeout")));
    wire.end(body ? JSON.stringify(body) : undefined);
  });
}
function render(component, props, extraStubs = {}) {
  const wrapper = mount(component, { props, global: { stubs: { ...stubs, ...extraStubs } } });
  wrappers.push(wrapper); return wrapper;
}
function checkRecord(element, record, context) {
  const presentation = stockProcurementPresentation(record, context);
  expect(presentation.status).toBe(record.procurement.status);
  const status = element.get("[data-procurement-status]");
  expect(status.attributes("data-procurement-status")).toBe(presentation.status);
  expect(status.text()).toContain(uiText(presentation.label));
  expect(status.text()).not.toMatch(/\b(?:leaf|node|closure)\b/i);
  expect(status.find(".procurement-material-limit").exists()).toBe(presentation.status === "unresolved");
  if (presentation.reasonLabel) expect(status.text()).toContain(uiText(presentation.reasonLabel));
  expect(element.text()).toContain(record.source);
  expect(element.text()).toContain(record.catalog_id);
  if (record.cas) expect(element.text()).toContain(record.cas);
  if (record.url) expect(element.findAll("a").some(link => link.attributes("href") === record.url)).toBe(true);
  expect(element.get(".supplier-price-value").text()).toBe(uiText(supplierPriceView(record, context).text));
}

realTest.each(["en", "zh-CN"])("actual stock and one completed task bind the %s UI without starting models", async locale => {
  const job = await readApi(`/api/v1/unified-route/jobs/${encodeURIComponent(jobId)}`);
  expect(job.status).toBe("completed");
  const saved = await readApi(`/api/results/retrieve?result_id=${encodeURIComponent(jobId)}`);
  const originalTask = JSON.stringify(saved), candidate = readSelectedRoutes(saved)[0];
  expect(candidate).toBeTruthy();
  initializeLocale(null); setLocale(locale, { persist: false });
  const inputs = ["O=C([O-])[O-]", "CCO"];
  const payload = await readApi("/api/v1/stock/lookup", { smiles: inputs });
  const originalStock = JSON.stringify(payload), parsed = catalogRecordsForInputs(payload, inputs);
  API.post.mockReset().mockImplementation((path, body) => {
    if (path !== "/api/v1/stock/lookup") throw new Error("Only inventory lookup is permitted by this acceptance test");
    return readApi(path, body);
  });
  for (const input of inputs) {
    const records = parsed.records[input], smiles = parsed.canonicalSmiles[input];
    expect(records.length).toBeGreaterThan(0);
    const result = { query: input, smiles, snapshot: parsed.snapshot, records };
    const list = render(StockRecordList, { result });
    records.forEach((record, index) => checkRecord(list.findAll(".stock-record")[index], record, result));
    const dialog = render(MoleculeStockDialog, { modelValue: true, smiles: input });
    await API.post.mock.results.at(-1).value; await flushPromises();
    expect(dialog.findAll(".stock-node-record")).toHaveLength(records.length);
    records.forEach((record, index) => {
      checkRecord(dialog.findAll(".stock-node-record")[index], record, result);
      const evidence = render(StockEvidence, { result, record });
      checkRecord(evidence.get(".stock-supplier-evidence"), record, result);
    });
  }
  const materials = render(RouteMaterials, { graph: topologyFromCandidate(candidate), deliveryReview: candidate.metadata?.delivery_review }, { MoleculeStockDialog: true });
  await materials.get("button").trigger("click");
  const call = API.post.mock.calls.at(-1);
  const actual = await API.post.mock.results.at(-1).value; await flushPromises();
  const bound = catalogRecordsForInputs(actual, call[1].smiles);
  const expected = call[1].smiles.flatMap(input => bound.records[input].map(record => ({ record, smiles: bound.canonicalSmiles[input] })));
  expect(expected.length).toBeGreaterThan(0);
  expect(materials.findAll(".catalog-record")).toHaveLength(expected.length);
  expected.forEach(({ record, smiles }, index) => checkRecord(materials.findAll(".catalog-record")[index], record, { smiles, snapshot: bound.snapshot }));
  expect(JSON.stringify(saved)).toBe(originalTask);
  expect(JSON.stringify(payload)).toBe(originalStock);
}, 30000);
