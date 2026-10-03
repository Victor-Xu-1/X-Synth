import {
  templateDetailLocation,
  templateSearchBody,
  templateSearchFilters,
  templateSearchQuery,
  templateSelectionFromQuery,
} from "./template-detail";

const nativeId = "7bc41b373203fc50b7bada7b31865f35";
const location = {
  path: "/template",
  query: { source: "pistachio", id: `pistachio:${nativeId}` },
};

test("normalized and explicit native identities use the same drill-down location", () => {
  expect(
    templateDetailLocation({
      source: "pistachio",
      template_id: `pistachio:${nativeId}`,
    }),
  ).toEqual(location);
  expect(
    templateDetailLocation({ template_set: "pistachio", _id: nativeId }),
  ).toEqual(location);
  expect(
    templateDetailLocation({
      source: "pistachio",
      raw: { _id: nativeId, index: 3325, template_set: "pistachio" },
    }),
  ).toEqual(location);
  expect(templateSelectionFromQuery(location.query)).toEqual({
    source: "pistachio",
    template_id: `pistachio:${nativeId}`,
  });
});

test.each([
  { source: "pistachio", template_id: "3325" },
  { source: "pistachio", template_id: "pistachio_ringbreaker:any" },
  { source: "pistachio", template_id: "pistachio:" },
  { source: "pistachio", index: 3325, references: [555338] },
  { source: "pistachio", id: 555338 },
  { source: "pistachio", template_id: "pistachio:" + "x".repeat(256) },
  {},
  null,
])(
  "ambiguous or invalid template metadata is never guessed into a link: %j",
  (template) => {
    expect(templateDetailLocation(template)).toBeNull();
  },
);

test.each([
  { id: `pistachio:${nativeId}` },
  { source: "pistachio", id: nativeId },
  { source: ["pistachio", "ord"], id: `pistachio:${nativeId}` },
  { source: "pistachio", id: [`pistachio:${nativeId}`] },
])("malformed deep-link query cannot issue a detail request: %j", (query) => {
  expect(templateSelectionFromQuery(query)).toBeNull();
});

test("detail source is independent of preserved list filters on reload", () => {
  const filters = { source: "", direction: "forward", minCount: 2, limit: 10 };
  const query = { ...location.query, ...templateSearchQuery(filters) };
  expect(templateSearchFilters(query)).toEqual(filters);
  expect(templateSearchFilters(location.query)).toEqual({
    source: "",
    direction: "retro",
    minCount: 0,
    limit: 50,
  });
  expect(templateSearchFilters({ source: "pistachio" }).source).toBe(
    "pistachio",
  );
  expect(templateSearchBody(filters)).toEqual({
    sources: [],
    direction: "forward",
    min_count: 2,
    limit: 10,
  });
});

test.each([
  { limit: 501 },
  { limit: 0 },
  { minCount: -1 },
  { minCount: NaN },
  { direction: "anything" },
])("out-of-bounds search is rejected before posting: %j", (invalid) => {
  expect(() =>
    templateSearchBody({
      source: "",
      direction: "retro",
      minCount: 0,
      limit: 50,
      ...invalid,
    }),
  ).toThrow();
});
