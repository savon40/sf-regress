import tsconfigs from 'eslint-config-salesforce-typescript';
import plugin from 'eslint-plugin-sf-plugin';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    extends: [...tsconfigs, ...plugin.configs.recommended],
    rules: {
      'header/header': 'off',
    },
  },
]);
