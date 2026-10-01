import { ref, computed } from "vue";
import { useTheme as useVuetifyTheme } from "vuetify";

const isDark = ref(false);

export function useTheme() {
  const vuetifyTheme = useVuetifyTheme();

  const toggleTheme = () => {
    isDark.value = !isDark.value;
    const name = isDark.value ? "dark" : "light";
    vuetifyTheme.change(name);
    localStorage.setItem("theme", name);
  };

  const init = () => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme) {
      isDark.value = savedTheme === "dark";
      vuetifyTheme.change(savedTheme);
    } else {
      isDark.value = false;
      vuetifyTheme.change("light");
      localStorage.setItem("theme", "light");
    }
  };

  const currentTheme = computed(() => vuetifyTheme.global.current.value);

  return {
    isDark,
    toggleTheme,
    init,
    currentTheme,
  };
}
