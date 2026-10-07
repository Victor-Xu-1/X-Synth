import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  templateDetailLocation,
  templateSearchBody,
  templateSearchFilters,
  templateSearchQuery,
  templateSelectionFromQuery,
} from "@/common/template-detail";

function hasReactionSmarts(record) {
  return typeof record?.reaction_smarts === "string" && !!record.reaction_smarts.trim();
}

export function useTemplateSearch({
  route = useRoute(),
  router = useRouter(),
  api = API,
} = {}) {
  const filters = reactive(templateSearchFilters(route.query));
  const result = ref(null),
    loading = ref(false),
    error = ref(""),
    submitting = ref(false);
  const detail = ref(null),
    detailLoading = ref(false),
    detailError = ref("");
  const health = ref(null),
    indexError = ref("");
  const isDetail = computed(() => Object.hasOwn(route.query, "id"));
  const filterKey = computed(() => JSON.stringify(filters));
  const rows = computed(() =>
    result.value?.key === filterKey.value ? result.value.rows : [],
  );
  const searched = computed(() => result.value?.key === filterKey.value);
  const busy = computed(() => submitting.value || loading.value);
  const atLimit = computed(
    () => searched.value && rows.value.length === Number(filters.limit),
  );
  const directionCount = (direction) => {
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
  const canSearch = computed(() => !isDetail.value && !busy.value && !coverageReason.value && !indexError.value);
  let active = true,
    searchGeneration = 0,
    detailGeneration = 0;

  watch(
    filterKey,
    () => {
      searchGeneration++;
      loading.value = false;
      error.value = "";
    },
    { flush: "sync" },
  );

  async function loadDetail() {
    const generation = ++detailGeneration;
    detail.value = null;
    detailLoading.value = false;
    detailError.value = "";
    if (!isDetail.value) return;
    const selection = templateSelectionFromQuery(route.query);
    if (!selection) {
      detailError.value = "模板链接必须包含匹配的来源和模板标识。";
      return;
    }
    detailLoading.value = true;
    try {
      const response = await api.get(
        "/api/v1/template-library/template",
        selection,
      );
      if (!active || generation !== detailGeneration) return;
      if (
        response.template?.source !== selection.source ||
        response.template?.template_id !== selection.template_id ||
        !hasReactionSmarts(response.template)
      )
        throw new Error("模板详情与请求的来源或标识不一致。");
      detail.value = response.template;
    } catch (failure) {
      if (active && generation === detailGeneration)
        detailError.value = errorMessage(failure, "模板详情读取失败。");
    } finally {
      if (active && generation === detailGeneration)
        detailLoading.value = false;
    }
  }

  watch(
    () => JSON.stringify([isDetail.value, route.query.source, route.query.id]),
    loadDetail,
    { immediate: true, flush: "sync" },
  );
  watch(
    () =>
      JSON.stringify([
        isDetail.value,
        route.query.id,
        templateSearchFilters(route.query),
      ]),
    () => {
      Object.assign(filters, templateSearchFilters(route.query));
      if (
        !submitting.value &&
        !isDetail.value &&
        route.query.searched === "1" &&
        !searched.value &&
        !loading.value
      )
        runSearch();
    },
  );

  async function runSearch() {
    if (coverageReason.value || indexError.value) return;
    let body;
    try {
      body = templateSearchBody(filters);
    } catch (failure) {
      error.value = errorMessage(failure);
      return;
    }
    const generation = ++searchGeneration,
      key = filterKey.value;
    loading.value = true;
    error.value = "";
    try {
      const response = await api.post("/api/v1/template-library/query", body);
      if (!active || generation !== searchGeneration || key !== filterKey.value)
        return;
      if (
        !Array.isArray(response.templates) ||
        response.count !== response.templates.length ||
        response.templates.length > body.limit ||
        response.templates.some((row) => !templateDetailLocation(row) || !hasReactionSmarts(row))
      )
        throw new Error("模板查询返回了无效记录。");
      result.value = { key, rows: response.templates };
    } catch (failure) {
      if (active && generation === searchGeneration) {
        result.value = null;
        error.value = errorMessage(failure, "模板查询失败。");
      }
    } finally {
      if (active && generation === searchGeneration) loading.value = false;
    }
  }

  async function search() {
    if (!active || !canSearch.value) return;
    try {
      templateSearchBody(filters);
    } catch (failure) {
      error.value = errorMessage(failure);
      return;
    }
    const query = {
      ...route.query,
      ...templateSearchQuery(filters),
      searched: "1",
    };
    delete query.id;
    delete query.source;
    submitting.value = true;
    try {
      await router.replace({ path: "/template", query });
    } finally {
      submitting.value = false;
    }
    if (active) await runSearch();
  }

  function openTemplate(template) {
    const location = templateDetailLocation(template);
    if (!location) return;
    return router.push({
      ...location,
      query: {
        ...route.query,
        ...templateSearchQuery(filters),
        ...location.query,
      },
    });
  }

  async function backToList() {
    const query = { ...route.query, ...templateSearchQuery(filters) };
    delete query.id;
    delete query.source;
    await router.push({ path: "/template", query });
    if (active && query.searched === "1" && !searched.value && !loading.value)
      await runSearch();
  }

  onMounted(async () => {
    try {
      const response = await api.get(
        "/api/v1/template-library/health",
        null,
        false,
      );
      if (active) health.value = response;
    } catch (failure) {
      if (active) indexError.value = errorMessage(failure, "模板索引不可用。");
    }
    if (
      active &&
      !isDetail.value &&
      route.query.searched === "1" &&
      !searched.value &&
      !loading.value
    )
      runSearch();
  });
  onUnmounted(() => {
    active = false;
    searchGeneration++;
    detailGeneration++;
  });

  return {
    filters,
    rows,
    searched,
    loading,
    busy,
    atLimit,
    canSearch,
    coverageReason,
    directionItems,
    error,
    health,
    indexError,
    isDetail,
    detail,
    detailLoading,
    detailError,
    search,
    openTemplate,
    backToList,
    loadDetail,
  };
}
