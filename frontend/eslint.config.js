import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', document: 'readonly', window: 'readonly', getComputedStyle: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly' } } },
);
