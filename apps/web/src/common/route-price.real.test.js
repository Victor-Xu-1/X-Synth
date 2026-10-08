import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { lookupStock } from "./stock-lookup";
import { formatSupplierPrice, supplierPriceView, catalogRecordsForInputs } from "./route-price";
import SupplierPrice from "@/components/routes/SupplierPrice.vue";
import { nextTick } from "vue";
import { setLocale } from "@/i18n";

const realTest = process.env.X_SYNTH_TEST_STOCK_INDEX && process.env.X_SYNTH_TEST_PYTHON ? test : test.skip;

realTest("real SQLite -> FastAPI -> existing serializer -> component retains exact catalog prices and identities", async () => {
  const { response: payload, expected_sources: expectedSources } = JSON.parse(execFileSync(process.env.X_SYNTH_TEST_PYTHON,
    ["-c", [
      "import json, os, runpy",
      "from pathlib import Path",
      "module = runpy.run_path('tests/unit/test_catalog_pricing.py')",
      "index = module['StockIndex'](Path(os.environ['X_SYNTH_TEST_STOCK_INDEX']))",
      "response = module['real_lookup'](index)",
      "print(json.dumps({'response': response, 'expected_sources': sorted(index.summary['source_counts'])}, allow_nan=False))",
    ].join("\n")], {
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
      const view = supplierPriceView(record, context);
      expect(view.amount).toBe(record.ppg);
      expect(view.status).toBe(record.ppg === null ? "missing" : "recorded");
      expect(formatSupplierPrice(record, context)).toBe(record.ppg === null ? "价格未记录" : `${record.ppg} $/g`);
      const original = JSON.stringify(record);
      const wrapper = mount(SupplierPrice, { props: { record, ...context } });
      expect(wrapper.text()).toContain(view.text);
      expect(wrapper.text()).toContain("币种未标注");
      expect(wrapper.text()).toContain("报价日期未记录");
      expect(wrapper.text()).toContain(payload.price_basis.catalog_sha256);
      expect(wrapper.text()).not.toMatch(/USD|CNY|人民币|成本/);
      setLocale("en", { persist: false }); await nextTick();
      expect(wrapper.text()).toContain(record.ppg === null ? "Price not recorded" : view.text);
      expect(wrapper.text()).toContain("Currency not specified");
      expect(wrapper.text()).not.toContain("null $/g");
      expect(JSON.stringify(record)).toBe(original);
      wrapper.unmount();
      setLocale("zh-CN", { persist: false });
    }
  }
  expect(sources).toEqual(new Set(expectedSources));
}, 30000);
