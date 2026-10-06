import fs from "node:fs";
import path from "node:path";
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useTaskHistory } from "@/composables/useTaskHistory";
import { HISTORY_PAGE_SIZE } from "./task-history-view";

const removed = [
  "common/cas-client.js", "common/cas-client.test.js", "common/reaxys.js", "common/resolver.js",
  "common/result-history.js", "common/result-history.test.js",
  "components/BanButton.vue", "components/BreadCrumbs.vue", "components/SciFindernButton.vue",
  "components/TbSettingsTable.vue", "components/TheChatBot.vue",
  "components/admin/AppBar.vue", "components/admin/EditUserDialogBox.vue",
  "components/admin/Loader.vue", "components/admin/NewUserDialogBox.vue",
  "components/notfound/EmptyState.vue", "store/chatbot.js", "store/settings.js",
  "store/settings.test.js", "views/error/Error.vue",
];

test.each(removed)("confirmed retired frontend module stays removed: %s", (file) => {
  expect(fs.existsSync(path.resolve(__dirname, "..", file))).toBe(false);
});

test("the live history replacement preserves owned pagination without a whole-library fetch", async () => {
  let state;
  const total = HISTORY_PAGE_SIZE + 1;
  const api = { get: jest.fn(async (_url, { offset, limit }) => ({
    results: Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({
      result_id: `task-${offset + i}`, description: "Owned task", target_smiles: "CCO",
      result_state: "completed", revision: 1, history_revision: 0, group_id: null, archived: false, num_trees: 1,
    })),
    total, all_total: total, ungrouped_total: total, groups: [],
  })) };
  const wrapper = mount(defineComponent({ setup() {
    state = useTaskHistory({ api });
    return () => null;
  } }));
  try {
    await flushPromises();
    expect(state.rows.value).toHaveLength(HISTORY_PAGE_SIZE);
    expect(api.get).toHaveBeenCalledTimes(1);
    await state.nextPage();
    await flushPromises();
    expect(state.rows.value).toHaveLength(1);
    expect(state.total.value).toBe(total);
    expect(api.get.mock.calls.map(([endpoint, query]) => [endpoint, query.limit, query.offset])).toEqual([
      ["/api/v1/results/page", HISTORY_PAGE_SIZE, 0],
      ["/api/v1/results/page", HISTORY_PAGE_SIZE, HISTORY_PAGE_SIZE],
    ]);
  } finally {
    wrapper.unmount();
  }
});
