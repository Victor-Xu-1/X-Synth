import { templateReference, templateValue } from "./template-references";

test.each([
  555338,
  "555338",
  "RXN-555338",
  { reaction_id: 555338 },
  { id: "10.1234/not-explicit" },
  { _id: "US20240123456A1" },
])(
  "native identifiers are text, never inferred literature links: %j",
  (reference) => {
    expect(templateReference(reference).links).toEqual([]);
  },
);

test("only explicit sourced DOI, public patent and HTTP fields become links", () => {
  const result = templateReference({
    title: "Source record",
    doi: "10.1021/acs.joc.0c00000",
    patent_number: "WO2024/59806; A1",
    reference_url: "https://example.org/source",
  });
  expect(result.label).toBe("Source record");
  expect(result.links.map((link) => link.href)).toEqual([
    "https://example.org/source",
    "https://doi.org/10.1021/acs.joc.0c00000",
    "https://patents.google.com/patent/WO2024059806A1",
    "https://worldwide.espacenet.com/patent/search?q=pn%3DWO2024059806A1",
  ]);
  expect(templateReference("doi:10.1234/actual.identifier").links[0].href).toBe(
    "https://doi.org/10.1234/actual.identifier",
  );
  expect(templateReference("US20240123456A1").links).toHaveLength(2);
});

test.each([
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "file:///private",
  "https://user:password@example.org",
  "https://",
  "https://example.org/\nunsafe",
  "<a href='https://example.org'>unsafe</a>",
  { doi: "555338", patent_number: "555338", url: "javascript:alert(1)" },
])("unsafe or malformed evidence stays unlinked: %j", (reference) => {
  expect(templateReference(reference).links).toEqual([]);
});

test("duplicate explicit URLs are deduplicated and missing metadata stays unknown", () => {
  expect(
    templateReference({
      url: "https://example.org/",
      source_url: "https://example.org/",
    }).links,
  ).toHaveLength(1);
  expect(templateValue(0)).toBe("0");
  expect(templateValue(false)).toBe("false");
  expect(templateValue("")).toBe("未记录");
});
