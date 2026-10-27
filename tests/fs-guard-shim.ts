// ★BJ725-F src 读守卫 shim（2026-10-26,vitest.config.ts alias 装载通道）
// 病根：withMutation 的「写变异→spawn 子 vitest→还原」窗口内,并行 worker 里其他测试
// 文件的 SRC()/readFileSync 结构锁直读盘面 → 读到变异态 → 假红（BJ725-A 独立复核实锤:
// bj723c-4g 计数锁在 bj725a-whip-magic D1-M1 窗内见 3 报红,单跑全绿）。先例 bj378
// canary 的 lockTargetFile 读写双端自愿持锁是打地鼠——每新增变异目标都要给全部读方
// 挂锁。本 shim 经 alias 单点装载:tests/ 域内一切 `import ... from 'node:fs'/'fs'`
// 的 readFileSync 自动走守卫,读方（现存+未来）零改动。
//
// 装载形态（vite-node 快照语义探针实证,2026-10-26）:
//   · 具名/namespace 导入经 vite-node 模块快照,setupFile 补丁 fs 单例拦不到;
//   · alias 是唯一在 resolve 阶段生效的通道（customResolver 分流,取消回落真 fs）;
//   · 本文件自身的 'node:fs' 导入经 EXEMPT 豁免 → 真 fs（防自环）;
//   · mutation-guard 同豁免（其模块级求值依赖真 fs 绑定,环内 TDZ 必炸）。
//
// 守卫语义（readFileSyncGuarded,详见 mutation-guard.ts BJ725-F 节首注）:锁空闲→直读;
// 他人变异窗→读纯净备份;只读持锁者/变异子进程(env 旗)→直读。非 src 路径零开销透传。
import * as realFs from 'node:fs';   // EXEMPT 豁免 → 真 fs
import { readFileSyncGuarded, isGuardedSrcPath } from './mutation-guard';

export * from 'node:fs';             // EXEMPT 豁免 → 真 fs;具名全量再导出

/** 守卫标记（探针/测试用;局部具名导出按 ESM 规则遮蔽上方星再导出） */
export const __swFsShim = true as const;

/** BJ725-F 守卫读：src 树 .ts 走守卫（并行变异窗内永得纯净态）,其余逐参透传真 fs */
export function readFileSync(file: unknown, ...args: unknown[]): unknown {
  return typeof file === 'string' && isGuardedSrcPath(file)
    ? readFileSyncGuarded(file, ...args)
    : (realFs.readFileSync as (...a: unknown[]) => unknown)(file as string, ...args);
}

/** default 导入面（import fs from 'node:fs'）:真 fs 拷贝 + 守卫 readFileSync 覆写 */
export default { ...realFs, readFileSync };
