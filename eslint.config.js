import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['js/**/*.js', 'functions/**/*.js', 'tests/**/*.js', 'eslint.config.js', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
        ...globals.node,
        caches: 'readonly'
      }
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
        message: 'Unsafe DOM sink. Use textContent / createElement.'
      }],
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Use textContent / setText() instead of innerHTML.' },
        { property: 'outerHTML', message: 'Unsafe DOM sink. Use textContent / createElement.' },
        { object: 'document', property: 'write', message: 'document.write is an XSS sink.' },
        { object: 'document', property: 'writeln', message: 'document.writeln is an XSS sink.' }
      ]
    }
  },
  {
    ignores: ['node_modules/**', '.wrangler/**', 'dist/**', 'build/**']
  }
];
