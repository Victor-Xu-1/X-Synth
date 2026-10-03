import {
  integrationName,
  inventoryStatus,
  moduleName,
} from "./environment-inventory";
test("retained source, unwired adapters and active models remain different statuses", () => {
  expect(inventoryStatus("ready")).toBe("已就绪");
  expect(inventoryStatus("preserved_disabled")).toBe("源码保留，未启用");
  expect(inventoryStatus("adapter_unwired")).toBe("适配器未接入主链");
  expect(inventoryStatus("not_integrated")).toBe("未集成");
  expect(inventoryStatus("unexpected")).toBe("未读取");
  expect(moduleName({ id: "retro_exact_match" })).toBe("精确反应匹配");
  expect(integrationName("aizynthfinder")).toBe("AiZynthFinder");
});
