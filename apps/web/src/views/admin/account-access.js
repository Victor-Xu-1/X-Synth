export function nativeAccountAuthority(workspace) {
  const session = workspace.session;
  if (workspace.error || !workspace.can("native_account") || session?.mode !== "askcos"
      || session.workspace_access !== true || typeof session.administrator !== "boolean"
      || typeof session.owner !== "string" || !session.owner.trim()
      || session.owner !== session.owner.trim() || session.owner.startsWith("guest_")) return null;
  return { owner: session.owner, administrator: session.administrator,
    key: JSON.stringify([session.owner, session.administrator]) };
}

export function canEditAccount(authority, admin, mode, username) {
  if (!authority) return false;
  if (mode === "new") return admin && authority.administrator;
  return ["email", "password"].includes(mode) && typeof username === "string"
    && !username.startsWith("guest_") && (username === authority.owner || admin && authority.administrator);
}

export function canMutateAccounts(authority, admin, names, action) {
  if (!authority || !Array.isArray(names) || !names.length || new Set(names).size !== names.length
      || names.some((name) => typeof name !== "string" || !name.trim())) return false;
  if (!["admin", "normal", "enable", "disable", "delete"].includes(action)) return false;
  return admin && authority.administrator || action === "delete" && names.length === 1 && names[0] === authority.owner;
}
