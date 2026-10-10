import { readWorkspaceAccess } from "./workspace-session";

function recoveryTarget(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    && !value.includes("\\") && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    ? value : null;
}

export function createWorkspaceNavigationAccess({ getWorkspace, probe = readWorkspaceAccess }) {
  let generation = 0, pending = null;
  function begin(to, from) {
    generation++;
    pending?.abort(); pending = null;
    const workspace = getWorkspace(), failure = workspace.navigationFailure;
    if (failure && (failure.from !== from.fullPath || failure.target !== to.fullPath))
      workspace.navigationFailure = null;
    return generation;
  }
  async function check(to, from, current) {
    if (current !== generation) return false;
    const controller = new AbortController(); pending = controller;
    let status = "unavailable";
    try { status = await probe({ signal: controller.signal }); }
    catch { /* An unverified access read cannot authorize or redirect as a denial. */ }
    finally { if (pending === controller) pending = null; }
    if (current !== generation || controller.signal.aborted) return false;
    if (status === "allowed") return;
    const workspace = getWorkspace();
    if (status === "denied") {
      workspace.navigationFailure = null;
      return { name: "登录", query: { redirect: to.fullPath } };
    }
    workspace.navigationFailure = { from: from.fullPath, target: recoveryTarget(to.fullPath) };
    return false;
  }
  function committed(_to, _from, failure) {
    if (!failure) getWorkspace().navigationFailure = null;
  }
  return { begin, check, committed };
}
