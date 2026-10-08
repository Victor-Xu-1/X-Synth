import { API } from "@/common/api";

export function accountType(user) {
  if (user.username?.startsWith("guest_")) return "Guest";
  return user.is_superuser === true ? "Admin" : "Normal";
}

export async function loadAccounts({ authority, active = () => true, signal } = {}) {
  const read = async (path) => {
    if (!active()) throw new Error("Account read superseded");
    const value = signal ? await API.get(path, null, false, { signal }) : await API.get(path, null, false);
    if (!active()) throw new Error("Account read superseded");
    return value;
  };
  const current = await read("/api/user/get-current-user");
  if (typeof current?.username !== "string" || !current.username.trim()) throw new Error("Missing current user");
  if (authority && (current.username !== authority.owner || current.disabled === true || accountType(current) === "Guest"))
    throw new Error("Account identity mismatch");
  const admin = await read("/api/user/am-i-superuser");
  if (typeof admin !== "boolean")
    throw new Error("Invalid permission response");
  if (authority && admin !== authority.administrator) throw new Error("Account role mismatch");
  const users = admin
    ? await read("/api/user/get-all-users")
    : [];
  if (!Array.isArray(users)) throw new Error("Invalid account list");
  return {
    current: {
      username: current.username,
      email: current.email,
      full_name: current.full_name,
      disabled: current.disabled,
      last_login: current.last_login,
    },
    admin,
    users: users.map((user) => ({
      username: user.username,
      email: user.email,
      disabled: user.disabled,
      last_login: user.last_login,
      full_name: user.full_name,
      accountType: accountType(user),
    })),
  };
}

export async function mutateAccount(username, action, profile = {}) {
  let response;
  switch (action) {
    case "admin":
      response = await API.get("/api/user/promote", { username }, true);
      break;
    case "normal":
      response = await API.get("/api/user/demote", { username }, true);
      break;
    case "enable":
      response = await API.post(
        "/api/user/update",
        { username, ...profileFields(profile), disabled: false },
        true,
      );
      break;
    case "disable":
      response = await API.post(
        "/api/user/update",
        { username, ...profileFields(profile), disabled: true },
        true,
      );
      break;
    case "delete":
      response = await API.delete("/api/user/delete", { username }, true);
      break;
    default:
      throw new Error("Unsupported account action");
  }
  requireSuccess(response);
}

export async function saveAccount(mode, values) {
  let response;
  if (mode === "new") {
    response = await API.post("/api/user/register", values, true);
  } else if (mode === "password") {
    response = await API.post("/api/user/reset-password", values, true);
  } else if (mode === "email") {
    response = await API.post("/api/user/update", values, true);
  } else {
    throw new Error("Unsupported account editor");
  }
  requireSuccess(response);
}

function profileFields(profile) {
  const fields = {};
  for (const key of ["email", "full_name"]) {
    if (typeof profile[key] === "string") fields[key] = profile[key];
  }
  return fields;
}

function requireSuccess(response) {
  if (response !== "OK") throw new Error("Account operation was not confirmed");
}
