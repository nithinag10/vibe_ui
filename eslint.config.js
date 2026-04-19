import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        MutationObserver: 'readonly',
        HTMLElement: 'readonly',
        crypto: 'readonly',
        alert: 'readonly',
        requestAnimationFrame: 'readonly',
        Image: 'readonly',
        URL: 'readonly',
        // Chrome extension globals
        chrome: 'readonly',
      },
    },
    rules: {
      'eqeqeq': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'tests/'],
  },
];
