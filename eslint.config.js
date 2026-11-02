import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'doc'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // レイヤ依存ルール（design.md 2.1）: domain は他レイヤ・React に依存しない
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-dom', 'zustand', 'zustand/*', 'zundo', '@mui/*', '@xyflow/*'], message: 'domain は UI / 状態管理に依存しない' },
          { group: ['**/store/**', '**/features/**', '**/infra/**'], message: 'domain は他レイヤに依存しない' },
        ],
      }],
    },
  },
  {
    files: ['src/store/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/features/**', '**/infra/**', 'react-dom', '@mui/*', '@xyflow/*'], message: 'store は domain のみに依存する' }],
      }],
    },
  },
);
