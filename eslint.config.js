/* ESLint flat config.
 *
 * Tuned to catch mistakes, not to impose a house style. The codebase has no
 * build step and no module bundler: each app/ file is an IIFE that hangs one
 * object off `window`, and each engine/ file additionally sets module.exports
 * so Node tests can require it. That means globals are the interface, and a
 * config that flagged them would flag the architecture rather than any bug.
 * They are declared below instead, so a genuine typo — a name nothing
 * defines — still fails.
 */
'use strict';

const BROWSER = {
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  location: 'writable', history: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly',
  console: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  fetch: 'readonly', crypto: 'readonly', Blob: 'readonly', File: 'readonly',
  FileReader: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', Image: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', getComputedStyle: 'readonly',
  getSelection: 'readonly', Element: 'readonly', HTMLElement: 'readonly',
  CustomEvent: 'readonly', Event: 'readonly',
};

// The app's own modules, plus the two vendored libraries. Each name is set by
// exactly one file; adding a module means adding it here.
const APP = {
  RULEBOOK: 'readonly',                                    // engine/rulebook.js
  GroupEngine: 'readonly', parseTB: 'readonly', validateTB: 'readonly',
  applyRulebook: 'readonly', parseJournals: 'readonly', buildRows: 'readonly',
  parseStatementReport: 'readonly', toNumber: 'readonly',
  isCreditNatured: 'readonly',                             // engine/group-engine.js
  CashFlowEngine: 'readonly',                              // engine/cashflow-engine.js
  RatioEngine: 'readonly',                                 // engine/ratio-engine.js
  AnomalyEngine: 'readonly',                               // engine/anomaly-engine.js
  Store: 'readonly',                                       // app/store.js
  FS: 'readonly',                                          // app/fs.js
  MonthTB: 'readonly',                                     // app/month-import.js
  ConsoExport: 'readonly',                                 // app/export-xlsx.js
  Auth: 'readonly',                                        // app/auth.js
  AUTH_CONFIG: 'readonly',                                 // app/auth-config.js
  Guide: 'readonly',                                       // app/guide.js
  APP_BUILD: 'readonly',                                   // app/shell.js
  XLSX: 'readonly',                                        // app/vendor/xlsx.full.min.js
  Chart: 'readonly',                                       // app/vendor/chart.umd.js
};

const NODE = {
  require: 'readonly', module: 'writable', exports: 'writable',
  process: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  Buffer: 'readonly', global: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
};

const RULES = {
  // Real errors.
  'no-undef': 'error',
  // `caughtErrors: 'none'` — ESLint 9 flags an unused catch binding by
  // default, and this codebase deliberately swallows some failures
  // (localStorage disabled, a malformed cell) with `catch (e) { /* ignore */ }`.
  // The comment is the intent; renaming the binding would not add anything.
  'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  // `builtinGlobals: false` — the globals declared above are declared BY files
  // in this repo, so with it on every module would be reported for defining
  // its own name. Redeclaring a name twice inside one file still errors.
  'no-redeclare': ['error', { builtinGlobals: false }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-fallthrough': 'error',
  'no-cond-assign': ['error', 'always'],
  'no-self-compare': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-sparse-arrays': 'error',
  'no-prototype-builtins': 'off',

  // Bug-shaped style. `==` is banned because this codebase compares values
  // read out of spreadsheets, where '' == 0 is true and would silently pass.
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  'no-implicit-globals': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }],
};

module.exports = [
  { ignores: ['app/vendor/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },

  // Browser code.
  {
    files: ['app/**/*.js', 'engine/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...BROWSER, ...APP, module: 'writable', globalThis: 'readonly' },
    },
    rules: RULES,
  },

  // Node tooling: no browser anywhere near it.
  {
    files: ['tools/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...NODE, globalThis: 'readonly' },
    },
    rules: RULES,
  },

  /* Tests. Node AND browser: the bodies passed to page.evaluate() are
     serialised and run inside the page, so document/window/Store are real
     there — and the unit suites install XLSX and localStorage onto `global`
     to stand in for the browser. Both sets are legitimate here. */
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...NODE, ...BROWSER, ...APP, globalThis: 'readonly' },
    },
    rules: {
      ...RULES,
      /* A spreadsheet fixture is an array of rows whose empty cells are
         holes — [1110200, 'PETTY CASH', , 500] is a faithful picture of the
         sheet being parsed, and writing `undefined` in each gap would make
         the fixture harder to check against the real file. In app/ and
         engine/ the rule stays on, where a hole is a typo. */
      'no-sparse-arrays': 'off',
    },
  },
];
