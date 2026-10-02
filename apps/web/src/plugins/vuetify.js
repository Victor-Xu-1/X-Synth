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
          primary: "#007AFF",
          secondary: "#5AC8FA",
        },
      },
    },
  },
});
