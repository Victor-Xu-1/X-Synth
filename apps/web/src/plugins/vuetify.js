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
          primary: "#171717",
          "on-primary": "#FFFFFF",
          secondary: "#676767",
          background: "#FFFFFF",
          surface: "#FFFFFF",
          "on-surface": "#171717",
          success: "#16856B",
          error: "#C63F43",
          warning: "#AF7923",
          info: "#427AB2",
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: "#ECECEC",
          "on-primary": "#171717",
          secondary: "#B4B4B4",
          background: "#171717",
          surface: "#212121",
          "on-surface": "#ECECEC",
          success: "#57BC9B",
          error: "#F0787E",
          warning: "#D7AE62",
          info: "#81A8D1",
        },
      },
    },
  },
});
