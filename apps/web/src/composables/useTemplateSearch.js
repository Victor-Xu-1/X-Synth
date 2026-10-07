import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  templateDetailLocation, templateSearchBody, templateSearchFilters,
  templateSearchQuery, templateSelectionFromQuery,
} from "@/common/template-detail";
import {
  createTemplatePageSession, templateCursorFromQuery, validateTemplatePage,
} from "@/common/template-pagination";

const requested = (query) => query.searched === "1" || Object.hasOwn(query, "cursor");

export function useTemplateSearch({ route = useRoute(), router = useRouter(), api = API } = {}) {
  const filters = reactive(templateSearchFilters(route.query));
  const result = ref(null), loading = ref(false), error = ref(""), submitting = ref(false);
  const detail = ref(null), detailLoading = ref(false), detailError = ref("");
  const health = ref(null), indexError = ref(""), healthLoading = ref(true);
  const cursor = ref(null), cursorError = ref(""), showPagination = ref(requested(route.query));
  const session = createTemplatePageSession();
  const isDetail = computed(() => Object.hasOwn(route.query, "id"));
  const filterKey = computed(() => JSON.stringify(filters));
  const pageKey = computed(() => JSON.stringify([filters, cursor.value, cursorError.value]));
  const searched = computed(() => result.value?.key === pageKey.value);
  const rows = computed(() => searched.value ? result.value.rows : []);
  const matchedCount = computed(() => searched.value ? result.value.matchedCount : null);
  const pageNumber = computed(() => searched.value ? result.value.number : null);
  const busy = computed(() => submitting.value || loading.value);
  const directionCount = (direction) => {
    if (!["retro", "forward"].includes(direction)) return null;
    const counts = health.value?.directions;
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
    const count = counts[direction] ?? 0;
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  };
  const directionItems = computed(() => [
    { title: "逆合成", value: "retro" }, { title: "正向", value: "forward" },
  ].map((item) => ({ ...item, props: { disabled: directionCount(item.value) === 0 } })));
  const coverageReason = computed(() => directionCount(filters.direction) === 0
    ? `当前索引未包含${filters.direction === "forward" ? "正向" : "逆合成"}模板。` : "");
  const canSearch = computed(() => !isDetail.value && !busy.value && !healthLoading.value
    && !coverageReason.value && !indexError.value);
  const canNext = computed(() => canSearch.value && searched.value && result.value.hasMore);
  const canPrevious = computed(() => canSearch.value && searched.value && session.previous(cursor.value) !== undefined);
  const canFirst = computed(() => canSearch.value && cursor.value !== null);
  let active = true, applyingRoute = false, searchGeneration = 0, detailGeneration = 0;
  let searchController, navigationTarget = null;

  function readCursor() {
    try {
      cursor.value = templateCursorFromQuery(route.query);
      cursorError.value = "";
    } catch (failure) {
      cursor.value = null;
      cursorError.value = errorMessage(failure);
    }
  }
  readCursor();
  function invalidateSearch(clear = true) {
    searchGeneration++;
    searchController?.abort();
    loading.value = false;
    if (clear) { result.value = null; error.value = ""; }
  }
  watch(filterKey, () => {
    session.reset();
    if (!applyingRoute) { cursor.value = null; cursorError.value = ""; }
  }, { flush: "sync" });
  watch(pageKey, () => invalidateSearch(), { flush: "sync" });

  async function loadDetail() {
    const generation = ++detailGeneration;
    detail.value = null;
    detailLoading.value = false;
    detailError.value = "";
    if (!isDetail.value) return;
    invalidateSearch(false);
    const selection = templateSelectionFromQuery(route.query);
    if (!selection) {
      detailError.value = "模板链接必须包含匹配的来源和模板标识。";
      return;
    }
    detailLoading.value = true;
    try {
      const response = await api.get("/api/v1/template-library/template", selection);
      if (!active || generation !== detailGeneration) return;
      if (
        response?.template?.source !== selection.source ||
        response.template?.template_id !== selection.template_id ||
        typeof response.template?.reaction_smarts !== "string" || !response.template.reaction_smarts.trim()
      ) throw new Error("模板详情与请求的来源或标识不一致。");
      detail.value = response.template;
    } catch (failure) {
      if (active && generation === detailGeneration)
        detailError.value = errorMessage(failure, "模板详情读取失败。");
    } finally {
      if (active && generation === detailGeneration) detailLoading.value = false;
    }
  }
  watch(() => JSON.stringify([isDetail.value, route.query.source, route.query.id]), loadDetail,
    { immediate: true, flush: "sync" });
  watch(() => JSON.stringify([isDetail.value, templateSearchFilters(route.query), route.query.cursor, route.query.searched]), () => {
    applyingRoute = true;
    Object.assign(filters, templateSearchFilters(route.query));
    readCursor();
    applyingRoute = false;
    if (!isDetail.value && !requested(route.query)) {
      invalidateSearch();
      session.reset();
      showPagination.value = false;
      return;
    }
    showPagination.value ||= requested(route.query);
    if (!isDetail.value && requested(route.query) && !searched.value &&
      (!submitting.value || pageKey.value !== navigationTarget)) runSearch();
  });

  async function runSearch() {
    if (!active || isDetail.value || loading.value || healthLoading.value || coverageReason.value || indexError.value) return;
    showPagination.value = true;
    let body;
    try {
      if (cursorError.value) throw new Error(JSON.stringify({ detail: cursorError.value }));
      body = templateSearchBody(filters);
      if (cursor.value !== null) body.cursor = cursor.value;
    } catch (failure) {
      error.value = errorMessage(failure, "模板查询条件无效，请重新检索。");
      return;
    }
    const generation = ++searchGeneration, key = pageKey.value, requestedCursor = cursor.value;
    searchController?.abort();
    searchController = new AbortController();
    loading.value = true;
    error.value = "";
    result.value = null;
    try {
      const response = await api.post("/api/v1/template-library/query", body, false,
        { signal: searchController.signal, timeoutMs: 15000 });
      if (!active || generation !== searchGeneration || key !== pageKey.value) return;
      const page = validateTemplatePage(response, body, requestedCursor);
      const location = session.record(requestedCursor, page);
      result.value = { key, ...page, ...location };
    } catch (failure) {
      if (active && generation === searchGeneration) {
        result.value = null;
        error.value = errorMessage(failure, "模板查询失败。");
      }
    } finally {
      if (active && generation === searchGeneration) loading.value = false;
    }
  }

  async function navigatePage(nextCursor, reset = false) {
    if (!active || !canSearch.value) return;
    try { templateSearchBody(filters); }
    catch (failure) { error.value = errorMessage(failure, "模板查询条件无效。"); return; }
    const query = { ...templateSearchQuery(filters), searched: "1" };
    if (nextCursor !== null) query.cursor = nextCursor;
    const target = JSON.stringify([templateSearchFilters(query), nextCursor, ""]);
    navigationTarget = target;
    submitting.value = true;
    try {
      await router.push({ path: "/template", query });
      if (!active || isDetail.value || pageKey.value !== target) return;
      if (reset) session.reset();
    } catch (failure) {
      if (active) error.value = errorMessage(failure, "模板页面切换失败，请重试。");
      return;
    } finally {
      submitting.value = false;
      navigationTarget = null;
    }
    if (active) await runSearch();
  }
  const search = () => navigatePage(null, true);
  const firstPage = () => canFirst.value ? navigatePage(null, true) : undefined;
  const nextPage = () => canNext.value ? navigatePage(result.value.nextCursor) : undefined;
  const previousPage = () => canPrevious.value ? navigatePage(session.previous(cursor.value)) : undefined;
  const retrySearch = () => canSearch.value ? runSearch() : undefined;

  function listQuery() {
    const query = templateSearchQuery(filters);
    if (requested(route.query) || showPagination.value) query.searched = "1";
    if (Object.hasOwn(route.query, "cursor")) query.cursor = route.query.cursor;
    return query;
  }
  function openTemplate(template) {
    if (!active || busy.value) return;
    const location = templateDetailLocation(template);
    if (!location) return;
    return router.push({ ...location, query: { ...listQuery(), ...location.query } });
  }
  async function backToList() {
    if (!active) return;
    try {
      await router.push({ path: "/template", query: listQuery() });
      if (active && !searched.value && requested(route.query)) await runSearch();
    } catch (failure) {
      if (active) detailError.value = errorMessage(failure, "返回模板列表失败，请重试。");
    }
  }
  onMounted(async () => {
    try {
      const response = await api.get("/api/v1/template-library/health", null, false);
      if (active) health.value = response;
    } catch (failure) {
      if (active) indexError.value = errorMessage(failure, "模板索引不可用。");
    } finally { if (active) healthLoading.value = false; }
    if (active && !isDetail.value && requested(route.query) && !searched.value) runSearch();
  });
  onUnmounted(() => {
    active = false;
    invalidateSearch();
    detailGeneration++;
    session.reset();
  });
  return {
    filters, rows, searched, loading, busy, canSearch, canNext, canPrevious, canFirst,
    pageKey, pageNumber, matchedCount, showPagination, coverageReason, directionItems,
    error, health, indexError, isDetail, detail, detailLoading, detailError,
    search, nextPage, previousPage, firstPage, retrySearch, openTemplate, backToList, loadDetail,
  };
}
