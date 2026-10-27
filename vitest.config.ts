// ★BJ725-F（2026-10-26）vitest 独立配置载体——vitest 对 vitest.config.ts 的优先级
// 高于 vite.config.ts,故测试面全部走这里,而 vite.config.ts 一字不动（不触发并行会话
// 运行中 dev server 的 watcher 重启,见 CLAUDE.md 并行会话约定）。
// 内容 = vite.config.ts 原样展开 + node:fs 别名到 tests/fs-guard-shim.ts（BJ725-F
// src 读守卫的装载通道——并行变异窗内结构锁读盘竞态根治,机制注见
// tests/mutation-guard.ts BJ725-F 节首注）。
// 分流语义（customResolver 首参=替换后 id,vite dist 源码亲读定谳）:
//   · importer ∈ tests/（测试文件与测试 helper）→ shim（readFileSync 走守卫）
//   · shim / mutation-guard 自身 → 取消回落真 node:fs（防自环:shim↔guard 循环 +
//     mutation-guard 模块级求值依赖真 fs 绑定,环内 star 导出 TDZ 必炸）
//   · 其余（vitest 内部模块/src/tools/node_modules）→ 取消回落真 node:fs（零扰动）
// 纪律：本文件只承载测试面增量;vite 侧任何字段改动仍回 vite.config.ts 改,此处
// 展开+透传,不复制语义（防双配置漂移）。
import { defineConfig, configDefaults } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import base from './vite.config';

const SHIM = fileURLToPath(new URL('./tests/fs-guard-shim.ts', import.meta.url));
const EXEMPT = /fs-guard-shim|mutation-guard/;

// ★BJ728-A 判例 4 优化（2026-10-27 用户令）：变异子 vitest（spawnVitest 带
// SW_BJXXX_MUT / BJ725_MUT_SKIP 家族旗）免跑三个 vite 钩子审计（vanillaAtlas 素材
// 陈旧扫描 / atlas-lint 754 表 / l10n-audit 776 键+自动重建）——子进程只为恰红自证
// 服务的模块 transform,三审计与其无关;父进程与 dev/build 门禁语义零变化（l10n
// buildStart 的 vitest 阻断门保留）。73 个子进程 × 每个省 1-3s,全量批预计省 2-5 分钟。
// 判据 = 进程 env 存在 *_MUT / *_MUT_SKIP 形家族旗（父 vitest 启动时不存在——家族旗
// 只在测试 worker 的 spawnSync 时刻注入子进程;SW_MUT_GUARD_HOLDER 不匹配 _MUT$ 尾锚）。
const MUT_CHILD = () =>
  Object.keys(process.env).some((k) => /_MUT$|_MUT_SKIP$/.test(k));
const SKIP_AUDIT_PLUGINS = new Set(['vanilla-atlas-auto', 'atlas-lint-auto', 'l10n-audit-auto']);
function skipAuditsForMutChildren(plugins: unknown): unknown {
  if (!Array.isArray(plugins)) return plugins;
  return plugins.map((p) => {
    const pl = p as { name?: string; buildStart?: unknown; configureServer?: unknown };
    if (!pl || typeof pl !== 'object' || !pl.name || !SKIP_AUDIT_PLUGINS.has(pl.name)) return p;
    const wrap = (hook: unknown): unknown => (typeof hook === 'function'
      ? function (this: unknown, ...a: unknown[]) {
          if (MUT_CHILD()) return;            // 变异子进程:审计全免(其产出=恰红 stdout,审计无关)
          return (hook as (...x: unknown[]) => unknown).apply(this, a);
        }
      : hook);
    return { ...pl, buildStart: wrap(pl.buildStart), configureServer: wrap(pl.configureServer) };
  });
}

export default defineConfig({
  ...base,
  plugins: skipAuditsForMutChildren(base.plugins),
  test: {
    // ★全量红账棘轮（2026-10-27）：`_` 前缀=一次性会话诊断（CLAUDE.md 约定域,依赖
    // 已消失的 /tmp 会话态——全量跑 55 文件 ENOENT 假红）,从套件排除出账。需要单独
    // 重跑时:npx vitest run --config 不能覆盖 exclude,用 --include 或临时 config。
    exclude: [...configDefaults.exclude, 'tests/**/_*.test.ts', 'tools/**/_*.test.ts',
      'mods/**/_*/**'],
  },
  resolve: {
    ...base.resolve,
    alias: [
      ...(Array.isArray(base.resolve?.alias) ? base.resolve.alias : []),
      {
        find: /^(node:)?fs$/,
        replacement: SHIM,
        customResolver(this: {
          resolve: (id: string, im?: string, o?: object) => Promise<string | null>;
        }, _updatedId: string, importer: string | undefined, options: object) {
          if (importer && /\/tests\//.test(importer) && !EXEMPT.test(importer)) return SHIM;
          // 取消：解析原 builtin（skipSelf 防再入本 alias）→ vite 对 builtin 返 null
          // → resolveId 落空回落原生外置化 = 真 fs
          return this.resolve('node:fs', importer, { ...options, skipSelf: true });
        },
      } as never,
    ],
  },
} as Parameters<typeof defineConfig>[0]);
