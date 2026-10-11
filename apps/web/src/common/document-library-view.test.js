import { documentSort, readDocumentSummaries, mergeDocumentSummaries, documentLibraryRows,
  documentLibraryQuery, documentLibraryLocation, documentEditorLocation } from "./document-library-view";
const row = (id, title, count = 0) => ({ id, title, target_smiles: "[13CH3][C@H](O)Cl.[Na+]", reaction_count: count, modified: "2026-10-10T00:00:00Z" });

test("sort defaults are presentation-only and invalid URL values cannot create a second mode", () => {
  expect([undefined, null, "other", ["title"]].map(documentSort)).toEqual(["updated", "updated", "updated", "updated"]);
  expect(documentSort("reactions")).toBe("reactions");
});
test("sorting/filtering loaded summaries never changes title, chemical identity or original response order", () => {
  const rows = [row("a", "研究者原始名称2", 2), row("c", "研究者原始名称10", 0), row("b", "Other", 1)];
  const original = JSON.stringify(rows);
  expect(documentLibraryRows(rows, "", "reactions", "en").map(row => row.id)).toEqual(["c", "b", "a"]);
  expect(documentLibraryRows(rows, "名称", "title", "zh-CN").map(row => row.id)).toEqual(["a", "c"]);
  expect(documentLibraryRows(rows, "[13CH3]", "updated", "en").map(row => row.id)).toEqual(["c", "b", "a"]);
  expect(documentLibraryRows(rows, "unmatched", "updated", "en")).toEqual([]);
  expect(JSON.stringify(rows)).toBe(original);
});
test("consumed summary metadata is validated before rendering; zero reactions and empty draft structure remain valid", () => {
  const valid = [row("a", "原始名称")];
  expect(readDocumentSummaries(valid)).toBe(valid);
  expect(readDocumentSummaries([{ ...valid[0], target_smiles: "" }])).toHaveLength(1);
  for (const value of [null, {}, [null], [{ ...valid[0], reaction_count: true }], [{ ...valid[0], reaction_count: -1 }],
    [{ ...valid[0], target_smiles: null }], [{ ...valid[0], modified: "invalid" }],
    [{ ...valid[0], id: "../unsafe" }], [{ ...valid[0], id: "" }], [valid[0], valid[0]]])
    expect(() => readDocumentSummaries(value)).toThrow("路线文档列表响应无效。");
});
test("overlapping pages replace only the matching summary without mutating either original response", () => {
  const existing = [row("a", "Original"), row("b", "Second")], incoming = [row("a", "Updated", 2), row("c", "Third")];
  const original = JSON.stringify([existing, incoming]);
  expect(mergeDocumentSummaries(existing, incoming).map(row => [row.id, row.title])).toEqual([["a", "Updated"], ["b", "Second"], ["c", "Third"]]);
  expect(JSON.stringify([existing, incoming])).toBe(original);
});

test("recent updates preserve API microseconds, numeric fractional precision and equivalent timezone offsets", () => {
  const newer = { ...row("a", "Newer"), modified: "2026-10-10T00:00:00.123900+00:00" };
  const older = { ...row("f", "Older"), modified: "2026-10-10T00:00:00.123100+00:00" };
  expect(documentLibraryRows([newer, older], "", "updated", "en").map(row => row.id)).toEqual(["a", "f"]);
  expect(documentLibraryRows([{ ...older, modified: "2026-10-10T08:00:00.1231+08:00" }, newer], "", "updated", "en").map(row => row.id)).toEqual(["a", "f"]);
  expect(documentLibraryRows([newer, { ...older, modified: "2026-10-10T00:00:00.1239000Z" }], "", "updated", "en").map(row => row.id)).toEqual(["f", "a"]);
});

test("reader-fix library context has one validated query projection and preserves scientific filter text verbatim", () => {
  const query = { query: " [13CH3][C@H](O)Cl.[Na+] / Original title ", sort: "reactions", other: "ignored" };
  const before = JSON.stringify(query);
  const selection = documentLibraryQuery(query);
  expect(selection).toEqual({ query: query.query, sort: "reactions" });
  const editor = documentEditorLocation("document-a", query);
  expect(editor).toEqual({ path: "/editor/document-a", query: { library_query: query.query, library_sort: "reactions" } });
  expect(documentLibraryLocation(editor.query)).toEqual({ path: "/documents", query: selection });
  expect(JSON.stringify(query)).toBe(before);
});

test.each([undefined, null, {}, { query: ["duplicate"], sort: ["title"] }, { query: 42, sort: "unsafe" }])(
  "reader-fix invalid library context and direct entry fall back to documents", query => {
    expect(documentLibraryQuery(query)).toEqual({});
    expect(documentLibraryLocation(query)).toBe("/documents");
    expect(documentEditorLocation("document-a", query)).toBe("/editor/document-a");
  },
);

test("reader-fix library return is a fixed internal location and never accepts a return URL", () => {
  expect(documentLibraryLocation({ returnUrl: "https://evil.example", path: "//evil.example", library_query: "https://evil.example", library_sort: "title" }))
    .toEqual({ path: "/documents", query: { query: "https://evil.example", sort: "title" } });
  expect(documentLibraryLocation({ library_query: ["first", "second"], library_sort: ["title"], returnUrl: "/results" }))
    .toBe("/documents");
  for (const identifier of [null, "../other", "/unsafe", ["document-a"], "id?returnUrl=https://evil.example"])
    expect(documentEditorLocation(identifier, { query: "raw" })).toBeNull();
});
