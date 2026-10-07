import {
  createTemplatePageSession,
  templateCursorFromQuery,
  validateTemplatePage,
  MAX_TEMPLATE_PAGE_HISTORY,
} from "./template-pagination";

const body = { sources: [], direction: "retro", min_count: 0, limit: 2 };
const row = (id, count = 12, source = "isolated") => ({
  source, template_id: `${source}:${id}`, count, direction: "retro",
  reaction_smarts: "[C:1]=[O:2]>>[C:1]-[O:2]",
});
const page = (templates, matched_count = templates.length, next_cursor = null) => ({
  templates, count: templates.length, matched_count, next_cursor,
  has_more: next_cursor !== null,
});

test("only an absent cursor is a first page; opaque scalar cursors round-trip unchanged", () => {
  expect(templateCursorFromQuery({})).toBeNull();
  expect(templateCursorFromQuery({ cursor: "opaque+/=token" })).toBe("opaque+/=token");
});
test.each([null, undefined, "", ["a"], 12, "x".repeat(2049)])(
  "invalid URL cursor %p never silently becomes a first page", (cursor) => {
    expect(() => templateCursorFromQuery({ cursor })).toThrow();
  },
);
test.each([" ", "\t", "\n", "opaque token", "opaque\x00token", "opaque\x1ftoken", "opaque\x7ftoken", "\u00a0"])(
  "whitespace/control cursor %p is rejected in URLs and API responses before navigation", (cursor) => {
    expect(() => templateCursorFromQuery({ cursor })).toThrow();
    expect(() => validateTemplatePage(page([row("a"), row("b")], 5, cursor), body, null)).toThrow();
  },
);
test("valid page metadata and raw SMARTS are retained without client slicing or sorting", () => {
  const response = page([row("a"), row("b")], 5, "page-b");
  const result = validateTemplatePage(response, body, null);
  expect(result.rows).toBe(response.templates);
  expect(result).toMatchObject({ count: 2, matchedCount: 5, nextCursor: "page-b", hasMore: true });
});
test.each([
  null, { templates: undefined }, { count: "2" }, { count: -1 }, { count: 1 },
  { matched_count: "5" }, { matched_count: -1 }, { matched_count: NaN },
  { matched_count: Number.MAX_SAFE_INTEGER + 1 }, { matched_count: 1 },
  { has_more: "true" }, { next_cursor: undefined }, { next_cursor: "" },
  { next_cursor: "x".repeat(2049) }, { next_cursor: "request-cursor" },
  { has_more: false }, { next_cursor: null },
  { templates: [row("a")] }, { templates: [row("a"), row("a")] },
  { templates: [row("b"), row("a")] }, { templates: [row("a", 10), row("b", 12)] },
  { templates: [row("a", 12, "z"), row("b", 12, "a")] },
  { templates: [row("a", -1), row("b")] },
  { templates: [row("a", 1.5), row("b")] },
  { templates: [{ ...row("a"), source: "other" }, row("b")] },
  { templates: [{ ...row("a"), template_id: "a" }, row("b")] },
  { templates: [{ ...row("a"), reaction_smarts: " " }, row("b")] },
  { templates: [{ ...row("a"), direction: "forward" }, row("b")] },
])("malformed page is rejected: %j", (change) => {
  const response = change === null ? null : { ...page([row("a"), row("b")], 5, "page-b"), ...change };
  expect(() => validateTemplatePage(response, body, "request-cursor")).toThrow();
});
test("source/min-count mismatches and inconsistent terminal totals are rejected", () => {
  expect(() => validateTemplatePage(page([row("a")]), { ...body, sources: ["other"] }, null)).toThrow();
  expect(() => validateTemplatePage(page([row("a")]), { ...body, min_count: 13 }, null)).toThrow();
  expect(() => validateTemplatePage(page([row("a")], 3), body, null)).toThrow();
  expect(() => validateTemplatePage(page([], 3), body, "page-b")).toThrow();
  expect(validateTemplatePage(page([]), body, null).matchedCount).toBe(0);
});
test("known session history gives true previous cursors; a direct link has no guessed predecessor", () => {
  const session = createTemplatePageSession();
  const first = validateTemplatePage(page([row("a"), row("b")], 3, "page-b"), body, null);
  expect(session.record(null, first)).toMatchObject({ number: 1, offset: 0 });
  const last = validateTemplatePage(page([row("c")], 3), body, "page-b");
  expect(session.record("page-b", last)).toMatchObject({ number: 2, offset: 2 });
  expect(session.previous("page-b")).toBeNull();
  expect(session.previous(null)).toBeUndefined();
  session.reset();
  expect(session.record("page-b", last)).toMatchObject({ number: null, offset: null });
  expect(session.previous("page-b")).toBeUndefined();
});
test("cross-page ordering, totals, changed replay and cursor loops fail closed", () => {
  const session = createTemplatePageSession();
  session.record(null, validateTemplatePage(page([row("a"), row("b")], 6, "b"), body, null));
  expect(() => session.record("b", validateTemplatePage(page([row("a"), row("c")], 6, "c"), body, "b"))).toThrow();
  expect(() => session.record("b", validateTemplatePage(page([row("c"), row("d")], 7, "c"), body, "b"))).toThrow();
  session.record("b", validateTemplatePage(page([row("c"), row("d")], 6, "c"), body, "b"));
  expect(() => session.record("c", validateTemplatePage(page([row("e"), row("f")], 6, "b"), body, "c"))).toThrow();
  expect(() => session.record("b", validateTemplatePage(page([row("c"), row("e")], 6, "c"), body, "b"))).toThrow();
  expect(() => session.record("c", validateTemplatePage(page([row("e")], 6), body, "c"))).toThrow();
});
test("session memory is bounded independently of library size", () => {
  const session = createTemplatePageSession();
  for (let i = 0; i < MAX_TEMPLATE_PAGE_HISTORY + 10; i++) {
    const cursor = i ? `p${i}` : null;
    const response = page([row("a", 1000 - i * 2), row("b", 999 - i * 2)], 2000, `p${i + 1}`);
    session.record(cursor, validateTemplatePage(response, body, cursor));
  }
  expect(session.size).toBe(MAX_TEMPLATE_PAGE_HISTORY);
  expect(session.previous("p1")).toBeUndefined();
  expect(session.previous(`p${MAX_TEMPLATE_PAGE_HISTORY + 9}`)).toBe(`p${MAX_TEMPLATE_PAGE_HISTORY + 8}`);
});
