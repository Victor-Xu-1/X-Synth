import { templateSelectionFromQuery } from "./template-detail";

export const MAX_TEMPLATE_PAGE_HISTORY = 32;
const MAX_CURSOR_LENGTH = 2048;

function invalidPage() {
  throw new Error(JSON.stringify({ detail: "模板分页响应无效，请重试或重新检索。" }));
}

function validCursor(cursor) {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || /\s/.test(cursor)) return false;
  return !Array.from(cursor).some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
}

export function templateCursorFromQuery(query) {
  if (!Object.hasOwn(query, "cursor")) return null;
  if (!validCursor(query.cursor))
    throw new Error(JSON.stringify({ detail: "模板分页游标无效，请重新检索。" }));
  return query.cursor;
}

// SQLite BINARY order compares Unicode code points, not locale collation.
function compareText(a, b) {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (difference) return difference;
  }
  return left.length - right.length;
}

function comparePosition(a, b) {
  return b.count - a.count || compareText(a.source, b.source) || compareText(a.template_id, b.template_id);
}

function position(row) {
  return row ? { count: row.count, source: row.source, template_id: row.template_id } : null;
}

export function validateTemplatePage(response, body, cursor) {
  if (
    !response || typeof response !== "object" || Array.isArray(response) ||
    !Array.isArray(response.templates) ||
    !Number.isSafeInteger(response.count) || response.count < 0 ||
    response.count !== response.templates.length || response.count > body.limit ||
    !Number.isSafeInteger(response.matched_count) || response.matched_count < response.count ||
    typeof response.has_more !== "boolean" ||
    (response.has_more ? !validCursor(response.next_cursor) : response.next_cursor !== null) ||
    (response.has_more && (
      response.count !== body.limit || response.matched_count <= response.count || response.next_cursor === cursor
    )) ||
    (cursor !== null && (!validCursor(cursor) || response.count === 0 || response.matched_count <= response.count)) ||
    (cursor === null && !response.has_more && response.matched_count !== response.count)
  ) invalidPage();

  const identities = new Set();
  for (const [index, row] of response.templates.entries()) {
    const identity = templateSelectionFromQuery({ source: row?.source, id: row?.template_id });
    if (
      !identity || identities.has(identity.template_id) ||
      typeof row.reaction_smarts !== "string" || !row.reaction_smarts.trim() ||
      !Number.isSafeInteger(row.count) || row.count < 1 || row.count < body.min_count ||
      row.direction !== body.direction ||
      (body.sources.length && !body.sources.includes(row.source)) ||
      (index && comparePosition(response.templates[index - 1], row) >= 0)
    ) invalidPage();
    identities.add(identity.template_id);
  }
  return {
    rows: response.templates,
    count: response.count,
    matchedCount: response.matched_count,
    nextCursor: response.next_cursor,
    hasMore: response.has_more,
    first: position(response.templates[0]),
    last: position(response.templates.at(-1)),
  };
}

// Only page boundaries/cursors are retained; the composable owns one actual page.
export function createTemplatePageSession() {
  const entries = new Map();
  let matchedCount = null;
  const predecessor = (cursor) => cursor === null ? undefined
    : [...entries.values()].find((entry) => entry.nextCursor === cursor);
  return {
    get size() { return entries.size; },
    reset() { entries.clear(); matchedCount = null; },
    previous(cursor) { return predecessor(cursor)?.cursor; },
    record(cursor, page) {
      const previous = predecessor(cursor);
      const known = entries.get(cursor), following = page.nextCursor === null ? undefined : entries.get(page.nextCursor);
      const number = cursor === null ? 1 : previous?.number != null ? previous.number + 1 : known?.number ?? null;
      const offset = cursor === null ? 0 : previous?.offset != null ? previous.offset + previous.count : known?.offset ?? null;
      const entry = {
        cursor, nextCursor: page.nextCursor, matchedCount: page.matchedCount,
        count: page.count, first: page.first, last: page.last, number, offset,
      };
      if (
        (matchedCount !== null && matchedCount !== page.matchedCount) ||
        (previous?.last && page.first && comparePosition(previous.last, page.first) >= 0) ||
        (following?.first && page.last && comparePosition(page.last, following.first) >= 0) ||
        (offset !== null && (
          !Number.isSafeInteger(offset + page.count) ||
          (page.hasMore ? offset + page.count >= page.matchedCount : offset + page.count !== page.matchedCount)
        )) ||
        (known && ["count", "matchedCount", "nextCursor", "first", "last"].some(
          (field) => JSON.stringify(known[field]) !== JSON.stringify(entry[field]),
        ))
      ) invalidPage();
      const visited = new Set([cursor]);
      let next = page.nextCursor;
      while (next !== null) {
        if (visited.has(next)) invalidPage();
        visited.add(next);
        if (!entries.has(next)) break;
        next = entries.get(next).nextCursor;
      }
      matchedCount = page.matchedCount;
      entries.delete(cursor);
      entries.set(cursor, entry);
      if (entries.size > MAX_TEMPLATE_PAGE_HISTORY) entries.delete(entries.keys().next().value);
      return { number: entry.number, offset: entry.offset };
    },
  };
}
