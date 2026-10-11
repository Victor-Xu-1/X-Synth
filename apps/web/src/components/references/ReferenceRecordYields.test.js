import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { referenceResponse } from "@/common/reaction-references";
import { setLocale, uiText } from "@/i18n";
import ReferenceRecordYields from "./ReferenceRecordYields.vue";

const textLabel = "\u539f\u6587\u8bb0\u5f55\uff0c\u672a\u4f5c\u6570\u503c\u89e3\u6790";
const deposited = JSON.parse(readFileSync(resolve(
  __dirname, "../../../../../tests/fixtures/reactions/ord-astra-zeneca.json",
), "utf8"));
const wrappers = [];

function recordedMeasurements(text) {
  const record = JSON.parse(JSON.stringify(deposited));
  record.reported_yields = [
    { ...record.reported_yields[0], value: null, unit: null, text },
    { ...record.reported_yields[0], value: 0, unit: "%" },
    { ...record.reported_yields[0], value: 87, unit: null },
  ];
  const query = { product: record.products.join("."), reactants: [] };
  const response = referenceResponse({
    source: "ORD", requested: query, query,
    sources: [{ source: "ORD", ready: true, product_index_available: true, record_count: 1 }],
    match_basis: "exact_product_structure", retrieved_at: "2026-10-08T01:00:00Z",
    results: [record], count: 1, has_more: false,
  }, query);
  return response.results[0].reported_yields;
}

function setup(measurements, compact) {
  const wrapper = mount(ReferenceRecordYields, {
    props: { measurements, products: deposited.products, compact },
  });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test.each([true, false])("text-only source is verbatim and neutrally labelled in compact=%s", compact => {
  const text = '  {"type":"YIELD","string_value":"70-80%"}\r\n  source prose\t';
  const measurements = recordedMeasurements(text);
  const before = JSON.stringify(measurements);
  const wrapper = setup(measurements, compact);
  const rows = wrapper.findAll(".reference-yield");
  expect(rows).toHaveLength(compact ? 2 : 3);
  expect(rows[0].get("strong").element.textContent).toBe(text);
  expect(rows[0].findAll("small").map((item) => item.text())).toContain(uiText(textLabel));
  expect(rows[1].get("strong").text()).toBe("0 %");
  expect(rows[1].findAll("small").map((item) => item.text())).not.toContain(uiText(textLabel));
  if (compact) {
    expect(wrapper.find("details").exists()).toBe(false);
  } else {
    expect(rows[2].get("strong").text()).toBe(`87 ${uiText("\u5355\u4f4d\u672a\u8bb0\u5f55")}`);
    expect(rows[0].get("details dd code").element.textContent).toBe(text);
  }
  expect(JSON.stringify(measurements)).toBe(before);
});

test.each([
  "\u672a\u8bb0\u5f55",
  " 70-80%\r\n",
  "\u672a\u8bb0\u5f55 <b>85%</b>",
])("text-only source is not translated or interpreted as markup across locale changes: %s", async text => {
  const measurements = recordedMeasurements(text);
  const before = JSON.stringify(measurements);
  const wrapper = setup(measurements, true);
  const source = wrapper.get(".reference-yield strong");
  expect(source.element.textContent).toBe(text);
  expect(source.find("b").exists()).toBe(false);
  setLocale("en", { persist: false });
  await wrapper.vm.$nextTick();
  expect(source.element.textContent).toBe(text);
  expect(JSON.stringify(measurements)).toBe(before);
});
