import { API } from "@/common/api";
import {
  accountType,
  loadAccounts,
  mutateAccount,
  saveAccount,
} from "./account-api";
jest.mock("@/common/api", () => ({
  API: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
beforeEach(() => jest.resetAllMocks());
test("loads server identity and permission before retrieving admin users", async () => {
  API.get
    .mockResolvedValueOnce({ username: "researcher" })
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce([
      { username: "researcher", is_superuser: true, full_name: "Researcher" },
    ]);
  const result = await loadAccounts();
  expect(result.admin).toBe(true);
  expect(result.users[0]).toMatchObject({
    username: "researcher",
    accountType: "Admin",
    full_name: "Researcher",
  });
  expect(API.get.mock.calls.map((call) => call[0])).toEqual([
    "/api/user/get-current-user",
    "/api/user/am-i-superuser",
    "/api/user/get-all-users",
  ]);
});
test("does not request admin data for an ordinary identity", async () => {
  API.get
    .mockResolvedValueOnce({ username: "researcher" })
    .mockResolvedValueOnce(false);
  expect((await loadAccounts()).users).toEqual([]);
  expect(API.get).toHaveBeenCalledTimes(2);
});
test("rejects malformed permissions instead of assuming admin access", async () => {
  API.get
    .mockResolvedValueOnce({ username: "researcher" })
    .mockResolvedValueOnce({ admin: true });
  await expect(loadAccounts()).rejects.toThrow("Invalid permission");
  expect(API.get).toHaveBeenCalledTimes(2);
});
test("preserves profile data when locking an account", async () => {
  API.post.mockResolvedValue("OK");
  await mutateAccount("researcher", "disable", {
    email: "test@example.com",
    full_name: "Researcher",
  });
  expect(API.post).toHaveBeenCalledWith(
    "/api/user/update",
    {
      username: "researcher",
      disabled: true,
      email: "test@example.com",
      full_name: "Researcher",
    },
    true,
  );
});
test.each([
  ["admin", "/api/user/promote"],
  ["normal", "/api/user/demote"],
])("keeps %s on the real endpoint", async (action, path) => {
  API.get.mockResolvedValue("OK");
  await mutateAccount("researcher", action);
  expect(API.get).toHaveBeenCalledWith(path, { username: "researcher" }, true);
});
test("does not turn an unconfirmed mutation into success", async () => {
  API.delete.mockResolvedValue({ error: "not completed" });
  await expect(mutateAccount("researcher", "delete")).rejects.toThrow(
    "not confirmed",
  );
});
test("rejects unsupported actions without a request", async () => {
  await expect(mutateAccount("researcher", "fake")).rejects.toThrow(
    "Unsupported",
  );
  expect(API.get).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
});
test("preserves registration and reset-password query contracts", async () => {
  API.post.mockResolvedValue("OK");
  await saveAccount("new", { username: "researcher", password: "test-only" });
  await saveAccount("password", {
    username: "researcher",
    password: "test-only",
  });
  expect(API.post).toHaveBeenNthCalledWith(
    1,
    "/api/user/register",
    { username: "researcher", password: "test-only" },
    true,
  );
  expect(API.post).toHaveBeenNthCalledWith(
    2,
    "/api/user/reset-password",
    { username: "researcher", password: "test-only" },
    true,
  );
});
test("classifies server account types", () => {
  expect(accountType({ username: "guest_unit" })).toBe("Guest");
  expect(accountType({ username: "researcher" })).toBe("Normal");
});

test("does not serialize missing profile fields as literal null query values", async () => {
  API.post.mockResolvedValue("OK");
  await mutateAccount("researcher", "enable", { email: null, full_name: null });
  expect(API.post).toHaveBeenCalledWith(
    "/api/user/update",
    { username: "researcher", disabled: false },
    true,
  );
});
