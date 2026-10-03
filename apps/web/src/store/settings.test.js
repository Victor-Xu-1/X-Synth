import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "@/store/settings";

beforeEach(() => {
  setActivePinia(createPinia());
});

test("tree builder defaults to RetroStar", () => {
  const store = useSettingsStore();

  expect(store.tree_builder_settings.backend).toBe("retro_star");
});

test("legacy persisted MCTS tree builder settings migrate to RetroStar", () => {
  const store = useSettingsStore();

  store.setTreeBuilderSettings({
    backend: "mcts",
    build_tree_options: {
      expansion_time: 1800,
    },
  });

  expect(store.tree_builder_settings.backend).toBe("retro_star");
  expect(store.tree_builder_settings.build_tree_options.expansion_time).toBe(1800);
  expect(store.tree_builder_settings.enumerate_paths_options.sorting_metric).toBe("score");
});
