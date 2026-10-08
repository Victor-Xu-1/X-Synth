import { readFileSync } from "node:fs";

export default {
  globals: {
    __X_SYNTH_VERSION__: readFileSync(
      new URL("../../VERSION", import.meta.url),
      "utf8",
    ).trim(),
  },
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testEnvironmentOptions: { customExportConditions: ["node", "node-addons"] },
  setupFilesAfterEnv: ["<rootDir>/src/i18n/test-setup.js"],
  moduleFileExtensions: ["js", "mjs", "json", "vue"],
  transform: {
    "^.+\\.js$": "babel-jest",
    "^.+\\.mjs$": ["babel-jest", { presets: ["@babel/preset-env"] }],
    "^.+\\.vue$": "@vue/vue3-jest",
  },
  transformIgnorePatterns: ["node_modules/(?!.*\\.mjs$)"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@vue/test-utils$":
      "<rootDir>/node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js",
  },
  collectCoverageFrom: ["src/common/*.js", "!**/node_modules/**"],
  coverageReporters: ["html", "text", "text-summary", "cobertura"],
  testMatch: ["**/*.test.js"],
};
