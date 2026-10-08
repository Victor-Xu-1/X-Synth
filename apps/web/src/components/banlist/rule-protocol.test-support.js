// These identities and file responses are isolated protocol fixtures, never live accounts.
export const session = (owner = "protocol-A") => ({
  mode: "askcos", owner, administrator: false, workspace_access: true,
});
export function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
export const jsonFile = (content, updates = {}) => ({
  name: "rules.json", size: new Blob([content]).size,
  text: jest.fn().mockResolvedValue(content), ...updates,
});
