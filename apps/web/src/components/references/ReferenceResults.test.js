import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { downloadChemicalFile } from "@/common/chemical-files";
import { referenceReactionDrawing } from "@/common/reaction-references";
import { deferred, uiStubs } from "@/views/workspace/reaction-canvas.test-support";
import { referenceDialogStub } from "./reference-dialog.test-support";
import ReferenceResults from "./ReferenceResults.vue";
import { initializeLocale, setLocale } from "@/i18n";
import { randomUUID } from "node:crypto";
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true });

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/common/chemical-files", () => ({ downloadChemicalFile: jest.fn() }));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({
  name: "StructurePreview",
  props: ["smiles", "inputType", "label"],
  template: '<span class="reference-drawing">{{ smiles }}</span>',
}));

const deposited = JSON.parse(readFileSync(resolve(
  __dirname, "../../../../../tests/fixtures/reactions/ord-astra-zeneca.json",
), "utf8"));
const wrappers = [];
test("detail reading partitions preserve every original field and reset navigation for a different record", async () => {
  const first = clone(deposited), second = clone(deposited);
  second.id += "-other"; second.provenance.record_id = second.id;
  const response = packet([first, second]), before = JSON.stringify(response), wrapper = setup(response);
  let detail = await openDetail(wrapper, 0);
  expect(detail.findAll('[role="tab"]')).toHaveLength(4);
  await detail.get('[role="tab"]:nth-child(3)').trigger("click");
  expect(detail.get('.reference-procedure').attributes("aria-hidden")).toBeUndefined();
  expect(detail.get('.reference-procedure p').element.textContent).toBe(first.procedure);
  const body = detail.get('.reference-detail-body').element;
  await detail.get('[role="tab"]:nth-child(2)').trigger("click");
  expect(detail.get('.reference-detail-body').element).toBe(body);
  expect(detail.findAll('.recorded-input')).toHaveLength(first.conditions.inputs.length);
  await wrapper.get('[data-cy="reference-detail-close"]').trigger("click");
  detail = await openDetail(wrapper, 1);
  expect(detail.get('[role="tab"]:nth-child(1)').attributes("aria-selected")).toBe("true");
  expect(JSON.stringify(response)).toBe(before); expect(API.post).not.toHaveBeenCalled();
});
test.each(["resolve", "reject"])("a late record-A export %s cannot publish a notice or error inside record B", async outcome => {
  const first = clone(deposited), second = clone(deposited);
  second.id += "-other"; second.provenance.record_id = second.id;
  const wrapper = setup(packet([first, second]));
  const held = deferred(); API.post.mockReturnValueOnce(held.promise);
  await openDetail(wrapper, 0);
  await wrapper.get('[data-cy="reference-record-detail"] [data-cy="reference-export"]').trigger("click");
  await wrapper.get('[data-cy="reference-detail-close"]').trigger("click");
  await openDetail(wrapper, 1);
  if (outcome === "resolve") held.resolve({ format: "rxn", content: "isolated transport response" });
  else held.reject(new Error("isolated source-A failure"));
  await flushPromises();
  const detail = wrapper.get('[data-cy="reference-record-detail"]');
  expect(detail.attributes("data-reference-id")).toBe(second.id);
  expect(detail.find('.reference-detail-notice').exists()).toBe(false);
  expect(detail.find('[role="alert"]').exists()).toBe(false);
});
const clone = (value) => JSON.parse(JSON.stringify(value));
function packet(records = [clone(deposited)], options = {}) {
  const query = { product: records[0]?.products.join(".") || deposited.products[0], reactants: [] };
  return {
    source: "ORD",
    sources: [{ source: "ORD", ready: true, product_index_available: true, record_count: 750 }],
    requested: clone(query), query, match_basis: "exact_product_structure",
    count: records.length, results: records, has_more: false,
    retrieved_at: "2026-10-08T01:00:00Z", ...options,
  };
}
function setup(response = packet(), extra = {}) {
  const wrapper = mount(ReferenceResults, {
    props: { response, actualInput: response?.requested || null, searched: true, allowCanvasReuse: true, ...extra },
    attachTo: document.body,
    global: { stubs: {
      VDefaultsProvider: { template: "<slot />" },
      ...uiStubs,
      VLazy: { template: "<div><slot /></div>" },
      VDialog: referenceDialogStub,
    } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
async function openDetail(wrapper, index = 0) {
  await wrapper.findAll('[data-cy="reference-details"]')[index].trigger("click");
  return wrapper.get('[data-cy="reference-record-detail"]');
}
beforeEach(() => {
  API.post.mockReset();
  downloadChemicalFile.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: jest.fn().mockResolvedValue() },
  });
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("English pending and record controls switch without replacing the selected record, raw experiment or focus origin", async () => {
  initializeLocale(null);
  const record = clone(deposited);
  record.procedure = "原始数据";
  record.reported_yields[0].analysis = "分离产品";
  const response = packet([record]), before = JSON.stringify(response);
  const wrapper = setup(response, { pending: true });
  expect(wrapper.get('[role="status"]').text()).toBe("Searching reference reactions.");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe("正在检索参考反应。");
  await wrapper.setProps({ pending: false });
  const origin = wrapper.get('[data-cy="reference-details"]');
  const detail = await openDetail(wrapper);
  setLocale("en", { persist: false });
  await flushPromises();
  expect(wrapper.get('[data-cy="reference-record-detail"]').element).toBe(detail.element);
  expect(detail.get(".reference-procedure p").text()).toBe("原始数据");
  expect(detail.text()).toContain("分离产品");
  expect(detail.text()).toContain(deposited.reaction_smiles);
  expect(detail.text()).toContain(deposited.provenance.source_path);
  expect(detail.text()).toContain("110 ± 10 °C");
  await wrapper.get('[data-cy="reference-detail-close"]').trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(origin.element);
  expect(JSON.stringify(response)).toBe(before);
  expect(API.post).not.toHaveBeenCalled();
});

test("a deposited record is compact by default, with source, scope, drawing, yield and conditions", () => {
  const wrapper = setup();
  const row = wrapper.get('[data-cy="reference-row"]');
  expect(row.text()).toContain("ORD");
  expect(row.text()).toContain("结构化记录");
  expect(row.text()).toContain("750 AstraZeneca ELN dataset");
  expect(row.text()).toContain("仅产物一致");
  expect(row.text()).toContain("65.39 %");
  expect(row.text()).toContain("测量方法未记录");
  expect(row.text()).toContain("110 ± 10 °C");
  expect(row.text()).toContain("时间");
  expect(row.text()).toContain("压力");
  expect(row.findAll(".recorded-input")).toHaveLength(0);
  expect(wrapper.find(".reference-procedure").exists()).toBe(false);
  expect(wrapper.text()).not.toContain(deposited.provenance.source_sha256);
  expect(row.getComponent({ name: "StructurePreview" }).props()).toMatchObject({
    smiles: referenceReactionDrawing(deposited), inputType: "reaction",
  });
});

test("selected-record detail retains all deposited materials, procedure and source identity", async () => {
  const wrapper = setup();
  const detail = await openDetail(wrapper);
  expect(detail.findAll(".recorded-input")).toHaveLength(5);
  expect(detail.text()).toContain("0.00222 mol");
  expect(detail.text()).toContain("催化剂");
  expect(detail.text()).toContain(deposited.procedure.trim());
  expect(detail.text()).toContain(deposited.reaction_smiles);
  expect(detail.text()).toContain(deposited.provenance.source_path);
  expect(detail.text()).toContain(deposited.provenance.source_sha256);
  expect(detail.text()).toContain(deposited.provenance.dataset_id);
  expect(detail.text()).toContain("CC-BY-SA-4.0");
  expect(detail.text()).toContain(deposited.conditions.inputs[0].source_field);
  expect(detail.text()).toContain(deposited.conditions.inputs[0].amounts[0].source_field);
  expect(detail.text()).toContain(deposited.reported_yields[0].source_field);
  expect(detail.text()).toContain(deposited.reported_yields[0].text);
  const links = detail.findAll("a");
  expect(links.map((link) => link.attributes("href"))).toEqual(expect.arrayContaining([
    deposited.source_url, deposited.publication_url,
  ]));
  links.forEach((link) => expect(link.attributes("rel")).toBe("noopener noreferrer"));
});

test("comparison caps repeated measurements without losing zero, unknown, or full detail", async () => {
  const record = clone(deposited);
  record.reported_yields = [0, null, 82, 90].map((value, index) => ({
    ...record.reported_yields[0], value, text: `measurement-${index}`,
    source_field: `outcomes[0].products[0].measurements[${index}]`,
  }));
  record.conditions.time = [
    { value: 0, unit: "MINUTE", source_field: "inputs[0].addition_time" },
    { value: 2, unit: "HOUR", source_field: "outcomes[0].reaction_time" },
    { value: 10, unit: "MINUTE", source_field: "inputs[1].addition_duration" },
  ];
  const wrapper = setup(packet([record]));
  const row = wrapper.get('[data-cy="reference-row"]');
  expect(row.findAll(".reference-yield")).toHaveLength(2);
  expect(row.text()).toContain("0 %");
  expect(row.text()).toContain("未记录");
  expect(row.text()).not.toContain("82 %");
  expect(row.text()).toContain("另 2 项");
  expect(row.text()).toContain("加料时间点 0 min");
  expect(row.text()).toContain("反应时间 2 h");
  const detail = await openDetail(wrapper);
  expect(detail.findAll(".reference-yield")).toHaveLength(4);
  expect(detail.text()).toContain("82 %");
  expect(detail.text()).toContain("加料时长 10 min");
});

test("long source analysis text stays complete in detail without expanding the comparison", async () => {
  const record = clone(deposited);
  record.reported_yields[0].analysis = "source analysis ".repeat(100);
  const wrapper = setup(packet([record]));
  const row = wrapper.get('[data-cy="reference-row"]');
  expect(row.text()).toContain("原始分析记录");
  expect(row.text()).not.toContain(record.reported_yields[0].analysis);
  const detail = await openDetail(wrapper);
  expect(detail.element.textContent).toContain(record.reported_yields[0].analysis);
});

test("closing detail keeps query disclosure, row nodes, reading position and returns keyboard focus", async () => {
  const wrapper = setup();
  const query = wrapper.get('[data-cy="reference-actual-input"]');
  query.element.open = true;
  const row = wrapper.get('[data-cy="reference-row"]').element;
  const button = wrapper.get('[data-cy="reference-details"]');
  button.element.focus();
  const focus = jest.spyOn(button.element, "focus");
  wrapper.element.scrollTop = 240;
  await openDetail(wrapper);
  expect(button.attributes("aria-haspopup")).toBe("dialog");
  const dialog = wrapper.get('[role="dialog"]');
  expect(dialog.attributes("aria-labelledby")).toBeTruthy();
  await wrapper.get('[data-cy="reference-detail-close"]').trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(document.activeElement).toBe(button.element);
  expect(wrapper.get('[data-cy="reference-row"]').element).toBe(row);
  expect(query.element.open).toBe(true);
  expect(wrapper.element.scrollTop).toBe(240);
  expect(API.post).not.toHaveBeenCalled();
});

test.each(["response", "actualInput", "pending", "error"])(
  "%s changes revoke a selected detail without retaining stale records", async (field) => {
    const wrapper = setup();
    await openDetail(wrapper);
    const changes = {
      response: packet([]), actualInput: { product: "CCO", reactants: [] },
      pending: true, error: "来源不可用",
    };
    await wrapper.setProps({ [field]: changes[field] });
    expect(wrapper.find('[data-cy="reference-record-detail"]').exists()).toBe(false);
  },
);

test("preview blocking keeps readable evidence but disables copy, export and canvas reuse", async () => {
  const wrapper = setup();
  await openDetail(wrapper);
  await wrapper.setProps({ blocked: true });
  expect(wrapper.find('[data-cy="reference-record-detail"]').exists()).toBe(true);
  for (const selector of ["reference-copy", "reference-export", "reference-load-reaction"]) {
    for (const button of wrapper.findAll(`[data-cy="${selector}"]`)) {
      expect(button.element.disabled).toBe(true);
      await button.trigger("click");
    }
  }
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.emitted("load-reaction")).toBeUndefined();
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
});

test("reuse and RXN export forward all verified compounds unchanged, never the first product", async () => {
  const record = clone(deposited);
  record.products.push("[Na+].[Cl-]");
  const wrapper = setup(packet([record]));
  const body = { reactants: record.reactants, products: record.products, agents: record.agents };
  await wrapper.get('[data-cy="reference-load-reaction"]').trigger("click");
  expect(wrapper.emitted("load-reaction")).toEqual([[body]]);
  API.post.mockResolvedValue({ format: "rxn", content: "full-rxn" });
  await wrapper.get('[data-cy="reference-export"]').trigger("click");
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/structure/reaction-export", body);
  expect(downloadChemicalFile).toHaveBeenCalledWith({ format: "rxn", content: "full-rxn" }, "reference-reaction");
  await wrapper.get('[data-cy="reference-copy"]').trigger("click");
  await flushPromises();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(record.reaction_smiles);
});

test("over-budget RXN records remain readable and copyable without partial export or reuse", async () => {
  const record = clone(deposited);
  record.agents = Array(99).fill("O");
  const wrapper = setup(packet([record]));
  expect(wrapper.get('[data-cy="reference-export"]').element.disabled).toBe(true);
  expect(wrapper.get('[data-cy="reference-load-reaction"]').element.disabled).toBe(true);
  expect(wrapper.get('[data-cy="reference-copy"]').element.disabled).toBe(false);
  expect((await openDetail(wrapper)).text()).toContain(record.procedure.trim());
  expect(API.post).not.toHaveBeenCalled();
});

test("source outage and truncation remain visible beside available evidence", () => {
  const response = packet(undefined, {
    source: "OPEN_REACTIONS", has_more: true,
    sources: [
      { source: "ORD", ready: true, product_index_available: true, record_count: 750 },
      { source: "USPTO_FULL", ready: false, product_index_available: false, reason: "reference_database_unavailable" },
    ],
  });
  const wrapper = setup(response);
  expect(wrapper.text()).toContain("USPTO_FULL · 参考反应数据库暂不可用。");
  expect(wrapper.text()).toContain("还有匹配记录，当前仅展示 1 条。");
  expect(wrapper.findAll('[data-cy="reference-row"]')).toHaveLength(1);
});

test("loading, empty, error and not-yet-searched states never present a false comparison", async () => {
  const wrapper = setup(null, { actualInput: null, searched: false });
  expect(wrapper.text()).toContain("尚未查询。");
  await wrapper.setProps({ pending: true });
  expect(wrapper.get('[role="status"]').text()).toContain("正在检索参考反应");
  expect(wrapper.attributes("aria-busy")).toBe("true");
  await wrapper.setProps({ pending: false, response: packet([]), actualInput: packet([]).requested });
  expect(wrapper.text()).toContain("未找到该产物结构的参考反应。");
  await wrapper.setProps({ error: "查库服务超时" });
  expect(wrapper.get('[role="alert"]').text()).toBe("查库服务超时");
  expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
});

test("only the selected record opens and the shared export reports success inside its detail", async () => {
  const records = [clone(deposited), clone(deposited)];
  records[1].id = records[1].provenance.record_id = "second-source-record";
  const wrapper = setup(packet(records));
  const detail = await openDetail(wrapper, 1);
  expect(detail.attributes("data-reference-id")).toBe("second-source-record");
  expect(wrapper.findAll('[data-cy="reference-record-detail"]')).toHaveLength(1);
  API.post.mockResolvedValue({ format: "rxn", content: "source-rxn" });
  await detail.get('[data-cy="reference-export"]').trigger("click");
  await flushPromises();
  expect(detail.get('[role="status"]').text()).toBe("RXN 已生成。");
  expect(API.post).toHaveBeenCalledTimes(1);
  await detail.get('[data-cy="reference-load-reaction"]').trigger("click");
  expect(wrapper.find('[data-cy="reference-record-detail"]').exists()).toBe(false);
  expect(wrapper.emitted("load-reaction")[0][0]).toEqual({
    reactants: records[1].reactants, products: records[1].products, agents: records[1].agents,
  });
});

test("extracted patent records keep their citation, separate yield methods and exact scope", async () => {
  const record = {
    id: "patent-record", reaction_smiles: "CCO>>CC=O", reactants: ["CCO"], products: ["CC=O"],
    agents: [], match_scope: "reaction_identity", conditions: null,
    patent_number: "US20200123456A1", patent_url: "https://patents.google.com/patent/US20200123456A1/en",
    paragraph: "0012", year: 2020,
    reported_yields: [
      { value: 0, unit: "%", text: "0%", method: "text_mined_yield" },
      { value: null, unit: null, text: "not reported", method: "calculated_yield" },
    ],
    provenance: { source: "USPTO_FULL", record_id: "patent-record", evidence_type: "patent_reaction_extraction",
      yield_extraction_fields: ["text_mined_yield", "calculated_yield"], patent_url_basis: "record_patent_number" },
  };
  const response = packet([record], { source: "USPTO_FULL", sources: undefined,
    requested: { product: "CC=O", reactants: ["CCO"] }, query: { product: "CC=O", reactants: ["CCO"] } });
  const wrapper = setup(response);
  expect(wrapper.text()).toContain("专利抽取");
  expect(wrapper.text()).toContain("全反应一致");
  expect(wrapper.text()).toContain("原文提取收率");
  expect(wrapper.text()).toContain("计算收率字段");
  expect(wrapper.text()).not.toContain("分离收率");
  const detail = await openDetail(wrapper);
  expect(detail.text()).toContain("0012");
  expect(detail.text()).toContain("2020");
  expect(detail.text()).toContain("not reported");
  expect(detail.get("a").attributes("href")).toBe(record.patent_url);
});

test("unsafe citations and a malformed response never become clickable evidence", async () => {
  const record = clone(deposited);
  record.source_url = "javascript:alert(1)";
  record.publication_url = "data:text/html,unsafe";
  const wrapper = setup(packet([record]));
  const detail = await openDetail(wrapper);
  expect(detail.findAll("a")).toHaveLength(0);
  expect(detail.text()).toContain("链接未记录");
  const invalid = packet([record]);
  invalid.results[0].provenance.record_id = "another-owner-record";
  await wrapper.setProps({ response: invalid });
  expect(wrapper.find('[data-cy="reference-row"]').exists()).toBe(false);
  expect(wrapper.text()).toContain("参考反应返回格式无效");
});

test("late exports and clipboard failures remain bounded by the current evidence generation", async () => {
  const wrapper = setup();
  const held = deferred();
  API.post.mockReturnValue(held.promise);
  await wrapper.get('[data-cy="reference-export"]').trigger("click");
  await wrapper.setProps({ response: packet([]) });
  held.resolve({ format: "rxn", content: "late-result" });
  await flushPromises();
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  await wrapper.setProps({ response: packet() });
  navigator.clipboard.writeText.mockRejectedValue(new Error("denied"));
  await wrapper.get('[data-cy="reference-copy"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("记录操作失败");
  expect(wrapper.text()).not.toContain("已复制原始反应 SMILES。");
});
