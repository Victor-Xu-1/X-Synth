/**
 * plugins/vuetify.js
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";

// Composables
import { createVuetify } from "vuetify";
import { zhHans } from "vuetify/locale";

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  locale: {
    locale: "zhHans",
    fallback: "en",
    messages: { zhHans },
  },
  theme: {
    themes: {
      light: {
        colors: {
          primary: "#137E67",
          "on-primary": "#FFFFFF",
          secondary: "#647570",
          background: "#F3F5F6",
          surface: "#FFFFFF",
          "on-surface": "#263431",
          success: "#137E67",
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
          secondary: "#ABBBB4",
          background: "#171D1B",
          surface: "#222D29",
          "on-surface": "#E5EFEA",
          success: "#5AC6AA",
          error: "#F0787E",
          warning: "#D7AE62",
          info: "#81A8D1",
        },
      },
    },
  },
});
