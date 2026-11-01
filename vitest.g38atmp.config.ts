// G38-A 临时 config(G38-D1 债复核通道,常驻):绕过 vitest.config.ts 对 tools/**/_*.test.ts
// 的棘轮排除——config 注释既定通道「--config 不能覆盖 exclude,用 --include 或临时
// config」。零语义改动,只收窄 exclude。
import { defineConfig, configDefaults } from 'vitest/config';
import base from './vite.config';

export default defineConfig({
  ...base,
  test: {
    exclude: [...configDefaults.exclude],
  },
} as Parameters<typeof defineConfig>[0]);
