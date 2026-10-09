import retrieval from "./catalog-retrieval";
import { DEFAULT_LOCALE, setLocale, uiText } from "./index";
import { buildCatalog } from "./catalog";

test("retrieval additions retain complete English/Chinese catalog pairs and English default", () => {
  expect(DEFAULT_LOCALE).toBe("en");
  expect(() => buildCatalog([retrieval])).not.toThrow();
  const titles = ["逆合成模板", "正向反应模板", "模板详情分区", "技术详情", "读取模板索引状态", "刷新模板索引状态",
    "模板索引状态返回格式无效，检索未启用。", "模板记录返回格式无效，未展示结果。",
    "初始反应排布不能保持完整角色或结构身份。", "重试结构同步"];
  titles.push("统一模板索引未配置。", "统一模板索引不可用。", "该来源中没有对应模板。",
    "模板标识必须包含匹配的来源命名空间。", "模板索引快照已变更，请明确开始新的查询。",
    "模板分页游标无效或与筛选条件不匹配。", "参考反应不能完整载入，未改变画板。",
    "RXN 文件无法解析，未改变画板。", "服务请求超时，请刷新或重试。");
  setLocale("en", { persist: false });
  for (const title of titles) {
    expect(uiText(title)).not.toBe(title);
    expect(uiText(title)).not.toMatch(/\p{Script=Han}/u);
  }
  setLocale("zh-CN", { persist: false });
  for (const title of titles) expect(uiText(title)).toBe(title);
});
