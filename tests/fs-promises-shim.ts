// ★BJ743-A（2026-10-31,R24 SEV-2）node:fs/promises 读守卫 shim——BJ725-F fs shim
// （tests/fs-guard-shim.ts）的姊妹面,vitest.config.ts alias 装载通道。
// 病根：BJ725-F 的 alias find=/^(node:)?fs$/ 不匹配 'node:fs/promises'——tests/ 域内
//   `await import('node:fs/promises')` 的 readFile（sw-bj10/29/30/31/31b/32/49 等
//   结构锁读 src 面共 ~17 站）直读真盘,并行变异窗内读到变异态=假红。与 BJ725-F
//   同病根的异步旁路面,R24 SEV-2 / R23-LOW-4 互证定谳。
// 装载形态（与 fs shim 同判例群）：alias 是唯一 resolve 阶段通道（具名/namespace
//   导入按 vite-node 模块图快照,setupFile 补丁拦不到）;本文件自身 EXEMPT 豁免
//   → 真 node:fs/promises（防自环）;mutation-guard 同豁免。
// 守卫语义：readFileSyncGuarded 五档语义的异步同构（readFileGuarded,备份写时序
//   定谳=同步探锁定靶、异步读靶,无须 defer——详见 mutation-guard.ts BJ743-A 节注）。
//   恰红子进程语义逐字保留（env 旗同步判定→直读变异盘）。
import * as realFsp from 'node:fs/promises';   // EXEMPT 豁免 → 真 fs/promises
import { readFileGuarded, guardedTargetOf } from './mutation-guard';

export * from 'node:fs/promises';             // EXEMPT 豁免 → 真模块;具名全量再导出

/** 守卫标记（探针/测试用;局部具名导出按 ESM 规则遮蔽上方星再导出） */
export const __swFsPromisesShim = true as const;

/** BJ743-A 守卫读：src 树 .ts（string/file://URL 归一）走守卫,其余逐参透传真模块 */
export function readFile(file: unknown, ...args: unknown[]): Promise<unknown> {
  const p = guardedTargetOf(file);
  return p !== null
    ? readFileGuarded(p, ...args)
    : (realFsp.readFile as (...a: unknown[]) => Promise<unknown>)(file as string, ...args);
}

/** default 导入面（import fsp from 'node:fs/promises'）:真模块拷贝 + 守卫 readFile 覆写 */
export default { ...realFsp, readFile };
