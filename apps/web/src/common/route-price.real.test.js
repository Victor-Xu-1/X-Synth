import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { lookupStock } from "./stock-lookup";
import { formatSupplierPrice, supplierPriceView, catalogRecordsForInputs } from "./route-price";
import SupplierPrice from "@/components/routes/SupplierPrice.vue";

const realTest = process.env.X_SYNTH_TEST_STOCK_INDEX && process.env.X_SYNTH_TEST_PYTHON ? test : test.skip;

realTest("real SQLite -> FastAPI -> existing serializer -> component retains exact catalog prices and identities", async () => {
  const payload = JSON.parse(execFileSync(process.env.X_SYNTH_TEST_PYTHON,
    ["-c", "import runpy; runpy.run_path('tests/unit/test_catalog_pricing.py', run_name='__main__')"], {
      cwd: resolve(__dirname, "../../../.."), encoding: "utf8", timeout: 30000,
      env: { ...process.env, X_SYNTH_AUTH_MODE: "local" },
    }));
  const sources = new Set();
  const receipt = catalogRecordsForInputs(payload, payload.requested.map((item) => item.smiles));
  expect(receipt.snapshot).toBe(payload.snapshot);
  for (const [smiles, originals] of Object.entries(payload.results)) {
    // Only transport is isolated; all response values above came from the real API/DB.
    const parsed = await lookupStock({ post: async () => payload }, smiles);
    expect(parsed.records).toEqual(originals);
    expect(receipt.records[smiles]).toEqual(originals);
    expect(parsed.snapshot).toBe(payload.snapshot);
    for (const record of parsed.records) {
      sources.add(record.source);
      const context = { smiles, snapshot: parsed.snapshot };
      expect(supplierPriceView(record, context).amount).toBe(record.ppg);
      expect(formatSupplierPrice(record, context)).toBe(`${record.ppg} $/g`);
      const wrapper = mount(SupplierPrice, { props: { record, ...context } });
      expect(wrapper.text()).toContain(`${record.ppg} $/g`);
      expect(wrapper.text()).toContain("币种未标注");
      expect(wrapper.text()).toContain("报价日期未记录");
      expect(wrapper.text()).toContain(payload.price_basis.catalog_sha256);
      expect(wrapper.text()).not.toMatch(/USD|CNY|人民币|成本/);
      wrapper.unmount();
    }
  }
  expect(sources).toEqual(new Set(["chembridge", "chemspace", "mcule"]));
}, 30000);
