import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import pluginCypress from 'eslint-plugin-cypress'
import globals from 'globals'

const cypressGlobals = {
  cy: 'readonly',
  Cypress: 'readonly',
  expect: 'readonly',
  assert: 'readonly',
  chai: 'readonly',
  before: 'readonly',
  after: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  describe: 'readonly',
  context: 'readonly',
  it: 'readonly',
  specify: 'readonly',
}

export default [
  {
    ignores: ['flow-typed/', 'public/', 'dist/', 'dev-dist/', 'coverage/', 'node_modules/'],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.cy.{js,jsx,ts,tsx}', 'cypress/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      cypress: pluginCypress,
    },
    languageOptions: {
      globals: {
        ...cypressGlobals,
      },
    },
    rules: {
      ...pluginCypress.configs.recommended.rules,
      'cypress/no-unnecessary-waiting': 'off',
      'cypress/unsafe-to-chain-command': 'off',
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.browser,
        __X_SYNTH_VERSION__: 'readonly',
      },
    },
    rules: {
      'preserve-caught-error': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/valid-v-slot': ['error', { allowModifiers: true }],
    },
  },
]
