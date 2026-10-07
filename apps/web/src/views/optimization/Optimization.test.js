import { TextDecoder, TextEncoder } from "node:util";
import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import Optimization from "./Optimization.vue";
import ParameterRail from "./ParameterRail.vue";

jest.mock("@/common/api", () => ({
  API: {
    get: jest.fn(),
    post: jest.fn(),
    toErrorObject: (error) => ({ string_error: error.message }),
  },
}));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("./optimization.css", () => ({}));
global.TextDecoder = TextDecoder;

// Protocol-only view fixtures; scientific acceptance uses the separate published-data test.
const CSV = "temperature,solvent,response\n10,a,1\n20,a,2\n10,b,3\n20,b,4\n";
const columns = [
  { name: "temperature", numeric: true, values: ["10", "20"], unique_count: 2 },
  { name: "solvent", numeric: false, values: ["a", "b"], unique_count: 2 },
  {
    name: "response",
    numeric: true,
    values: ["1", "2", "3", "4"],
    unique_count: 4,
  },
];
const rows = [
  ["10", "a", "1"],
  ["20", "a", "2"],
  ["10", "b", "3"],
  ["20", "b", "4"],
].map((row, i) => ({
  index: i + 1,
  values: Object.fromEntries(columns.map((column, j) => [column.name, row[j]])),
}));

test("view renders persisted current result, automatically reveals its panel and clears it when conditions change", async () => {
  API.get.mockResolvedValue({ ready: true, versions: { baybe: "0.15.0" } });
  API.post.mockImplementation((path, body) =>
    Promise.resolve(
      path.endsWith("/inspect")
        ? {
            columns,
            rows,
            row_count: 4,
            table_sha256: "a".repeat(64),
          }
        : {
            engine: "BayBE",
            versions: { baybe: "0.15.0" },
            empirically_confirmed: false,
            table_sha256: body.table_sha256,
            selected_rows: body.selected_rows,
            measurement_count: 3,
            target: body.target,
            recommendations: [
              {
                conditions: { temperature: 20, solvent: "b" },
                posterior_mean: 0,
                posterior_std: 1,
              },
            ],
            csv_content: "protocol fixture",
            record_id: "a".repeat(32),
            best_observed: 3,
            unique_measured_conditions: 3,
            warnings: ["Protocol fixture; not a scientific result."],
            seed: 42,
            categorical_encoding: "OHE",
          },
    ),
  );
  const scroll = jest.fn();
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView",
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const wrapper = mount(Optimization, {
    attachTo: document.body,
    global: {
      stubs: {
        ModuleWorkbench: {
          template: '<section><slot name="actions" /><slot /></section>',
        },
        VBtn: {
          props: ["disabled", "loading"],
          template: '<button :disabled="disabled"><slot /></button>',
        },
        VIcon: true,
        VProgressCircular: true,
        RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
      },
    },
  });
  try {
    await flushPromises();
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [
        {
          name: "protocol.csv",
          size: CSV.length,
          arrayBuffer: async () => new TextEncoder().encode(CSV).buffer,
        },
      ],
    });
    await input.trigger("change");
    await flushPromises();
    expect(wrapper.find("main").exists()).toBe(false);
    const tabs = wrapper.findAll('[role="tab"]');
    const panels = wrapper.findAll('[role="tabpanel"]');
    expect(panels).toHaveLength(2);
    for (const tab of tabs) {
      const panel = panels.find((panel) => panel.attributes("id") === tab.attributes("aria-controls"));
      expect(panel).toBeDefined();
      expect(panel.attributes("aria-labelledby")).toBe(tab.attributes("id"));
    }
    await tabs[0].trigger("keydown", { key: "ArrowRight" });
    expect(tabs[0].attributes("aria-selected")).toBe("true");
    expect(wrapper.get('[aria-label="选择本页实测记录"]').element.checked).toBe(
      false,
    );
    await wrapper.get('[aria-label="实测响应列"]').setValue("response");
    await wrapper.get('[aria-label="因子 temperature"]').setValue(true);
    await wrapper.get('[aria-label="因子 solvent"]').setValue(true);
    for (const index of [1, 2, 3])
      await wrapper.get(`[aria-label="选择实测记录 ${index}"]`).setValue(true);
    await wrapper.get('[aria-label="下一批实验数"]').setValue(1);
    for (const checkbox of wrapper.findAll(".opt-confirmation input"))
      await checkbox.setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.findAll(".opt-recommendations tbody tr")).toHaveLength(1);
    expect(wrapper.get(".opt-record-link").attributes("href")).toBe(
      `/analyses/${"a".repeat(32)}`,
    );
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(
      scroll.mock.instances.some((element) =>
        element.classList.contains("opt-results"),
      ),
    ).toBe(true);
    expect(tabs[1].attributes("tabindex")).toBe("0");
    expect(tabs[0].attributes("tabindex")).toBe("-1");
    await tabs[1].trigger("keydown", { key: "ArrowLeft" });
    expect(tabs[0].attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[0].element);
    await tabs[0].trigger("keydown", { key: "End" });
    expect(tabs[1].attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1].element);
    await wrapper
      .get('[aria-label="temperature 候选水平"]')
      .setValue("10\n20\n30");
    expect(wrapper.find(".opt-recommendations").exists()).toBe(false);
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe(
      "实测记录",
    );
  } finally {
    wrapper.unmount();
    if (original)
      Object.defineProperty(Element.prototype, "scrollIntoView", original);
    else delete Element.prototype.scrollIntoView;
  }
});

test("derived posterior CSV columns cannot become a measured response or experimental factor", () => {
  const wrapper = mount(ParameterRail, {
    props: {
      columns: [
        ...columns,
        {
          name: "posterior_mean",
          numeric: true,
          unique_count: 3,
          selectable: false,
        },
      ],
      factors: [],
      target: {
        name: "",
        kind: "yield_percent",
        direction: "maximize",
        unit: "%",
      },
      batchSize: 1,
      selectedCount: 0,
      count: 0,
    },
    global: { stubs: { VBtn: true } },
  });
  expect(wrapper.find('option[value="posterior_mean"]').exists()).toBe(false);
  expect(wrapper.find('[aria-label="因子 posterior_mean"]').exists()).toBe(
    false,
  );
  expect(wrapper.find('option[value="response"]').exists()).toBe(true);
  wrapper.unmount();
});
