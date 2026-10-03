function validIdentity(source, id) {
  return (
    typeof source === "string" &&
    source.length > 0 &&
    source.length <= 128 &&
    !/[\s:]/.test(source) &&
    typeof id === "string" &&
    id.length <= 256 &&
    id.startsWith(`${source}:`) &&
    id.length > source.length + 1
  );
}

export function templateDetailLocation(template) {
  const source =
    template?.source || template?.template_set || template?.raw?.template_set;
  const nativeId = template?._id ?? template?.raw?._id;
  const id =
    template?.template_id ??
    (nativeId !== undefined && nativeId !== null && String(nativeId) !== ""
      ? `${source}:${nativeId}`
      : null);
  return validIdentity(source, id)
    ? { path: "/template", query: { source, id } }
    : null;
}

export function templateSelectionFromQuery(query) {
  return validIdentity(query.source, query.id)
    ? { source: query.source, template_id: query.id }
    : null;
}

export function templateSearchFilters(query) {
  const scalar = (value) => (typeof value === "string" ? value : undefined);
  return {
    source:
      scalar(query.filter_source) ??
      (query.id === undefined ? scalar(query.source) : "") ??
      "",
    direction: scalar(query.direction) ?? "retro",
    minCount: Number(scalar(query.min_count) ?? 0),
    limit: Number(scalar(query.limit) ?? 50),
  };
}

export function templateSearchBody(filters) {
  if (
    typeof filters.source !== "string" ||
    filters.source.length > 128 ||
    !["retro", "forward"].includes(filters.direction) ||
    !Number.isInteger(filters.minCount) ||
    filters.minCount < 0 ||
    filters.minCount > 2147483647 ||
    !Number.isInteger(filters.limit) ||
    filters.limit < 1 ||
    filters.limit > 500
  )
    throw new Error("模板查询条件无效。");
  return {
    sources: filters.source ? [filters.source] : [],
    direction: filters.direction,
    min_count: filters.minCount,
    limit: filters.limit,
  };
}

export function templateSearchQuery(filters) {
  return {
    filter_source: filters.source,
    direction: filters.direction,
    min_count: String(filters.minCount),
    limit: String(filters.limit),
  };
}
