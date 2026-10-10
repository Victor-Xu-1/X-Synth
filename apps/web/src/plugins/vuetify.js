/**
 * plugins/vuetify.js
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import "vuetify/styles";

// Composables
import { createVuetify } from "vuetify";
import { zhHans } from "vuetify/locale";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n";
import { workspaceIcons } from "./icons.js";

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  icons: workspaceIcons,
  locale: {
    locale: LOCALES.find((item) => item.value === DEFAULT_LOCALE).widgetLocale,
    fallback: "en",
    messages: { zhHans },
  },
  theme: {
    themes: {
      light: {
        colors: {
          primary: "#087868",
          "on-primary": "#FFFFFF",
          secondary: "#64717B",
          background: "#F5F7F8",
          surface: "#FFFFFF",
          "on-surface": "#232C33",
          success: "#087868",
          error: "#C63F43",
          warning: "#AF7923",
          info: "#427AB2",
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: "#5AC6AA",
          "on-primary": "#142A22",
          secondary: "#AAB7C0",
          background: "#191D20",
          surface: "#242B30",
          "on-surface": "#E8EDF0",
          success: "#5AC6AA",
          error: "#F0787E",
          warning: "#D7AE62",
          info: "#81A8D1",
        },
      },
    },
  },
});
