import { initializeLocale, setLocale } from "@/i18n";
import { elapsedLabel } from "@/common/task-progress";
import { progressElapsedText, searchErrorText } from "./workspace-ui-text";

test("only the known complete backend-constraint phrase interpolates a literal parameter key", () => {
  initializeLocale(null);
  expect(searchErrorText("搜索参数 max_depth 不符合后端约束。"))
    .toBe("Search parameter max_depth does not meet backend constraints.");
  expect(searchErrorText("搜索参数 用户的原文 不符合后端约束。"))
    .toBe("搜索参数 用户的原文 不符合后端约束。");
  expect(searchErrorText("搜索参数 unknown_field 不符合后端约束。"))
    .toBe("搜索参数 unknown_field 不符合后端约束。");
  setLocale("zh-CN", { persist: false });
  expect(searchErrorText("搜索参数 max_depth 不符合后端约束。"))
    .toBe("搜索参数 max_depth 不符合后端约束。");
});

test.each([0, 0.75, 59.9, 60, 127.3, 7200, -1, null])("elapsed display keeps the original rounding contract for %s seconds", (seconds) => {
  const source = elapsedLabel(seconds);
  initializeLocale(null);
  const english = progressElapsedText(seconds);
  expect(english).not.toMatch(/[\u4e00-\u9fff]/);
  setLocale("zh-CN", { persist: false });
  expect(progressElapsedText(seconds)).toBe(source);
});
