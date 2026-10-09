import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useWindowSize } from "@vueuse/core";
import { layoutGraph } from "@/common/route-graph";
import { documentStepDetails } from "@/common/document-step-details";
import { uiText } from "@/i18n";

export function useDocumentReading(open, record) {
  const { width } = useWindowSize();
  const selected = ref(null), detailsOpen = ref(false), view = ref("graph");
  const graphActive = ref(false), graphReady = ref(false), graphView = ref(null);
  const readingMain = ref(null), inspectorView = ref(null);
  const views = [{ value: "graph", label: "路线图", icon: "mdi-graph-outline" }, { value: "steps", label: "步骤", icon: "mdi-format-list-numbered" }];
  let disposed = false, selectionEpoch = 0, selectionOrigin = null, pendingLocation = null;
  const projection = computed(() => {
    try { return { steps: documentStepDetails(record.value?.graph || { nodes: [], edges: [] }), error: "" }; }
    catch (error) { return { steps: [], error: error.message }; }
  });
  const steps = computed(() => projection.value.steps), stepError = computed(() => projection.value.error);
  const stepNumbers = computed(() => Object.fromEntries(steps.value.map(step => [step.node.id, step.number])));
  const stepChoices = computed(() => steps.value.map(step => ({ value: step.node.id, title: uiText("合成步骤 {value}", { value: step.number }) })));
  const graph = computed(() => !record.value ? { nodes: [], edges: [], target_id: "" }
    : record.value.graph.nodes.every(node => node.position.x === 0 && node.position.y === 0)
      ? layoutGraph(record.value.graph) : record.value.graph);
  const node = computed(() => graph.value.nodes.find(value => value.id === selected.value));
  const reactionSelection = computed(() => node.value?.type === "reaction" ? selected.value : null);
  const mobileDetails = computed(() => width.value <= 700 && detailsOpen.value && !!node.value);

  watch(() => [open.value, record.value?.id, record.value?.graph], ([visible]) => {
    selectionEpoch++; selectionOrigin = null; pendingLocation = null;
    selected.value = null; detailsOpen.value = false; graphReady.value = false;
    view.value = visible && width.value <= 700 && steps.value.length ? "steps" : "graph";
    graphActive.value = visible && view.value === "graph";
  }, { immediate: true, flush: "sync" });
  function current(epoch, id) {
    return !disposed && open.value && epoch === selectionEpoch && id === selected.value;
  }
  function changeView(value) {
    if (!views.some(tool => tool.value === value)) return;
    selectionEpoch++; pendingLocation = null; selectionOrigin = null; detailsOpen.value = false;
    view.value = value;
    if (value === "graph") graphActive.value = true;
  }
  async function selectNode(id, event, force = false) {
    const epoch = ++selectionEpoch;
    pendingLocation = null;
    selected.value = graph.value.nodes.some(value => value.id === id) ? id : null;
    detailsOpen.value = !!selected.value;
    selectionOrigin = event?.target?.closest?.('button, a[href], input, [tabindex]')
      || event?.currentTarget || readingMain.value?.querySelector(".document-step-picker input") || null;
    if (!selected.value || !(force || width.value <= 700 || event?.detail === 0)) return;
    await nextTick();
    if (!current(epoch, id) || !detailsOpen.value) return;
    inspectorView.value?.$el?.scrollIntoView?.({ block: "nearest" });
    inspectorView.value?.$el?.focus({ preventScroll: true });
  }
  async function closeDetails() {
    const epoch = ++selectionEpoch, id = selected.value, origin = selectionOrigin;
    selectionOrigin = null; detailsOpen.value = false;
    await nextTick();
    if (!current(epoch, id) || !origin?.isConnected || !origin.getClientRects().length || origin.closest('[hidden], [inert]')) return;
    origin.scrollIntoView?.({ block: "nearest", inline: "nearest" }); origin.focus({ preventScroll: true });
  }
  function graphInitialized() { graphReady.value = true; applyLocation(); }
  async function applyLocation() {
    const request = pendingLocation;
    if (!request || !graphReady.value || view.value !== "graph" || !current(request.epoch, request.id)) return;
    pendingLocation = null;
    await graphView.value?.focus([request.id], { padding: 0.45, maxZoom: 1, duration: 150 });
    if (!current(request.epoch, request.id) || !request.keyboard) return;
    const element = [...(graphView.value?.$el?.querySelectorAll('.vue-flow__node[data-id]') || [])].find(value => value.dataset.id === request.id);
    (element?.querySelector("button") || element)?.focus({ preventScroll: true });
  }
  async function locateStep(id, event) {
    if (!steps.value.some(step => step.node.id === id)) return;
    const epoch = ++selectionEpoch;
    selected.value = id; detailsOpen.value = false; selectionOrigin = null;
    pendingLocation = { id, epoch, keyboard: event?.detail === 0 };
    view.value = "graph"; graphActive.value = true;
    await nextTick();
    if (current(epoch, id)) await applyLocation();
  }
  onBeforeUnmount(() => { disposed = true; selectionEpoch++; pendingLocation = null; });
  return { selected, detailsOpen, view, views, graphActive, graphView, readingMain, inspectorView,
    graph, node, steps, stepNumbers, stepError, stepChoices, reactionSelection, mobileDetails,
    changeView, selectNode, closeDetails, locateStep, graphInitialized };
}
