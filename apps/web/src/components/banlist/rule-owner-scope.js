import { computed, inject, onBeforeUnmount, provide, ref, watch } from "vue";
import { nativeAccountAuthority } from "@/views/admin/account-access";

const ruleOwnerScope = Symbol("rule owner scope");
export const ruleRequestTimeoutMs = 15000;

export function createRuleOwnerScope(workspace) {
  const authority = computed(() => nativeAccountAuthority(workspace));
  const allowed = computed(() => !!authority.value);
  const ownerKey = ref(""), ownerEpoch = ref(0), revision = ref(0), pendingTasks = ref(0);
  const tickets = new Set();
  let generation = 0, disposed = false;

  function finish(ticket) {
    if (tickets.delete(ticket)) pendingTasks.value = tickets.size;
  }
  function cancel(ticket) {
    if (!tickets.has(ticket)) return;
    ticket.controller.abort();
    finish(ticket);
  }
  function invalidate() {
    generation++;
    for (const ticket of tickets) ticket.controller.abort();
    tickets.clear(); pendingTasks.value = 0;
  }
  function begin() {
    if (disposed || !authority.value) return null;
    const controller = new AbortController();
    const ticket = { generation, key: authority.value.key, owner: authority.value.owner,
      controller, signal: controller.signal };
    tickets.add(ticket); pendingTasks.value = tickets.size;
    return ticket;
  }
  function active(ticket) {
    return !disposed && tickets.has(ticket) && !ticket.signal.aborted
      && ticket.generation === generation && ticket.key === authority.value?.key;
  }

  const stop = watch([
    () => authority.value?.key || "", () => workspace.session?.owner,
    () => workspace.session?.mode, () => workspace.session?.workspace_access,
  ], () => {
    invalidate();
    // Retaining the same suspended draft never grants access or revives a ticket.
    const sameOwner = workspace.session?.mode === "askcos"
      && workspace.session?.workspace_access === true && workspace.session?.owner === ownerKey.value;
    const nextOwner = authority.value?.owner || (sameOwner ? ownerKey.value : "");
    if (nextOwner !== ownerKey.value) { ownerKey.value = nextOwner; ownerEpoch.value++; }
    revision.value++;
  }, { immediate: true, flush: "sync" });

  function dispose() {
    disposed = true; stop(); invalidate();
  }
  return { allowed, ownerKey, ownerEpoch, revision, pendingTasks, begin, active, finish, cancel, dispose };
}

export function provideRuleOwnerScope(workspace) {
  const scope = createRuleOwnerScope(workspace);
  provide(ruleOwnerScope, scope);
  onBeforeUnmount(scope.dispose);
  return scope;
}
export const useRuleOwnerScope = () => inject(ruleOwnerScope, null);
export const ruleRequestOptions = (ticket) => ({ signal: ticket.signal, timeoutMs: ruleRequestTimeoutMs });
