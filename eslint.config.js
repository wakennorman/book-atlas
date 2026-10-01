// ESLint 9 扁平配置。
// v85：以前只有 .eslintrc.json（ESLint 9 已废弃该格式）⇒ `npx eslint` 直接报
// "couldn't find an eslint.config.(js|mjs|cjs) file" 退出 1，而 CI 那一步结尾是 `|| true`，
// 于是门禁一直是绿的，实际上一个字都没检查过。这里补上扁平配置，并把规则原样搬过来。
import js from '@eslint/js';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'vendor/',
      'miniprogram/data/',
      'node_modules/',
      'research/',
      'docs/',
      'dist/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // vendor/ 里的库用普通 <script> 挂到全局（index.html / editor.html），不是 import
        echarts: 'readonly',
        fflate: 'readonly',
        pdfjsLib: 'readonly',
        // 小程序运行时注入的全局
        wx: 'readonly',
        Page: 'readonly',
        App: 'readonly',
        Component: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-undef': 'error',
      // U+3000（全角空格）在中文界面文案里是有意用作视觉分隔的，不是误输入。
      // 项目里 app.js / editor.js / scripts/*.mjs 共 20+ 处 `　依据：` 这类写法。
      'no-irregular-whitespace': 'off',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
      'no-var': 'warn',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'warn',
      'no-cond-assign': 'error',
      'no-constant-condition': 'warn',
      'no-dupe-else-if': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-extra-semi': 'warn',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-setter-return': 'error',
      'no-sparse-arrays': 'warn',
      'no-template-curly-in-string': 'off',
      'no-unexpected-multiline': 'warn',
      'no-unsafe-negation': 'warn',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];
