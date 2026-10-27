// ★变异测试统一守卫（残留普查波 2026-10-12,根治 BJ606 习语四起事故链:
//   ①BJ630 `if (false &&` 残留 ②BJ643 `if (true)` 残留 ③bj642/bj643 联跑互染
//   ④bj644 误判「并行重写」）——全族 writeFileSync 写盘变异+还原统一收敛到本模块。
//
// 三层守卫（方案 B:进程级文件互斥+panic-safe 还原+残留自检;改造面小,不碰模块装载）：
//   L1 跨套件/跨进程【按目标文件】互斥锁（/tmp/sw-mutation-guard/lock-<md5>.lock,
//      O_EXCL+陈锁收编 900s+忙等 100ms）——bj642/bj643 同变异 Arrow.ts 的联跑互染根除
//      （BJ643 债①）;与既有域锁（npcdust-mutation-mutex/spider-sentry-mutation-mutex,
//      D 面 beforeAll 持域级锁）为上下游关系:先域锁后文件锁,序一致无死锁。
//   L2 panic-safe 还原：进程内 registry + process.on('exit'/SIGINT/SIGTERM) 强还原
//      ——expect 崩/超时/信号中断任何 JS 可达路径都还原;SIGKILL/worker.terminate 等
//      不可达路径由 L3 下轮自愈兜底（vitest 默认 forks 池=子进程,exit 钩子可靠）。
//   L3 残留自检：持锁后盘上出现「缺 trigger 且含 replacement」=上轮泄漏态——
//      有本轮纯净备份（含 trigger 且不含 replacement）→ 自动还原+显式 fail（泄漏必须
//      红字现形,禁静默吞）;无备份 → loud fail 拒绝在毒盘上变异（防把毒盘当 PRISTINE
//      回写=BJ-C9-SP 实锤的「变异泄漏固化」病根）。纯 trigger 缺失（源漂移）同样
//      loud fail——bj643 M1 注入串漂移若早有此闸即当场红,不会拖到残留事故。
//
// 用法（替代旧 mutate() 内联体）：
//   withMutation(FILE, TRIGGER, REPL, () => {
//     const r = spawnVitest(filter);
//     expect(r.status, `变异须证红: ${REPL}`).not.toBe(0);
//     expect(r.stdout).toContain(filter);
//   }, { label: 'BJxxx M1', onPristine: (p) => assertPristineDisk(p) });
import { readFileSync, writeFileSync, statSync, unlinkSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const ROOT = join(realpathSync(tmpdir()), 'sw-mutation-guard');
// ★BJ662（2026-10-12）锁键 realpath 归一：withMutation 调用方与 canary 持锁方的
//  同文件路径拼写可能不同（process.cwd() vs join(__dirname,'..')）——键取真实路径
//  保证同一文件恒同锁（防御 symlink/cwd 漂移;文件不存在时回退原串=行为不变）。
const keyOf = (f: string): string => {
  let rf = f;
  try { rf = realpathSync(f); } catch { /* 首锁时目标文件必已存在;防御性回退原串 */ }
  return createHash('md5').update(rf).digest('hex').slice(0, 16);
};
const lockPathOf = (f: string): string => join(ROOT, `lock-${keyOf(f)}.lock`);
const backupPathOf = (f: string): string => join(ROOT, `pristine-${keyOf(f)}.bak`);

// 陈锁阈值 > 内层 vitest spawn 上限（家族 300-600s timeout）+collect 开销——
// 合法持锁绝不误拆;真崩溃残留 ≤15min 内被后续等待者收编。
const STALE_MS = 900_000;
const WAIT_DEADLINE_MS = 1_200_000;

export type MutationGuardOpts = {
  /** 诊断标签（进锁文件,便于人查「谁在持锁」） */
  label?: string;
  /** PRISTINE 捕获后、写变异前的毒盘哨兵钩（bj612/bj-c9 assertPristineDisk 沿用） */
  onPristine?: (pristine: string) => void;
  /** 自定义变异算子（JSON round-trip 等非纯替换面）;缺省=pristine.replace(trigger,replacement) */
  mutate?: (pristine: string) => string;
  /** 自定义纯净性校验（round-trip 等价/键值闸,不通过=throw）;缺省=pristine 含 trigger */
  verifyPristine?: (pristine: string) => void;
  /** 自定义盘面变异态判别（残留自检面）;缺省=缺 trigger 且含 replacement */
  isMutated?: (cur: string) => boolean;
};

// ---------------- L2: panic-safe 还原 ----------------

const registry = new Map<string, string>();   // absFile -> pristine
let hooksInstalled = false;

function installPanicHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const restoreAll = (): void => {
    for (const [f, pristine] of registry) {
      try { writeFileSync(f, pristine); } catch { /* exit 钩子里尽力而为 */ }
    }
    registry.clear();
  };
  process.on('exit', restoreAll);   // forks 池子进程正常退出/未捕获异常 vitest 收编后退出均触发
  process.on('SIGINT', () => { restoreAll(); process.exit(130); });
  process.on('SIGTERM', () => { restoreAll(); process.exit(143); });
}

// ---------------- L1: 按目标文件互斥锁 ----------------

function acquireLock(file: string, label: string, kind: 'mutate' | 'read' = 'mutate'): void {
  mkdirSync(ROOT, { recursive: true });
  const lp = lockPathOf(file);
  const t0 = Date.now();
  for (;;) {
    try {
      // ★BJ725-F（同日 race 根治刀）：锁体增 kind 域——'mutate'=withMutation 变异窗
      //  （盘面可能是变异态，读方须走纯净备份）；'read'=lockTargetFile 只读自证窗
      //  （盘面恒纯净，读方可直读）。旧锁体缺 kind 按保守档 'mutate' 处理。
      writeFileSync(lp, JSON.stringify({ pid: process.pid, label, at: Date.now(), kind }), { flag: 'wx' });
      // 变异窗持锁者把自己的 pid 经 env 下发——spawnSync({...process.env}) 的子 vitest
      // 由此识别「我是变异子进程」：读变异盘=设计意图（结构锁恰红/行为测试均依赖），
      // 不等待不走备份（子进程等父=必然超时，走备份=恰红假绿）。
      if (kind === 'mutate') process.env.SW_MUT_GUARD_HOLDER = String(process.pid);
      return;
    } catch {
      try { if (Date.now() - statSync(lp).mtimeMs > STALE_MS) unlinkSync(lp); } catch { /* 收编竞态,继续转 */ }
      if (Date.now() - t0 > WAIT_DEADLINE_MS) {
        let holder = '?';
        try { holder = readFileSync(lp, 'utf8'); } catch { /* 已释放 */ }
        throw new Error(`mutation-guard 锁等待超时(${WAIT_DEADLINE_MS / 1000}s): ${lp} 持有者=${holder}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function releaseLock(file: string): void {
  // ★只清「自己以 mutate 档写入」的 env：同进程 withMutation 变异窗进行中,守卫读/
  // lockTargetFile 释放 read 档锁时不得误删（误删=后续 spawn 的子 vitest 失去
  // 变异子进程身份,恰红结构锁面退化走备份假绿）。
  let kind: 'mutate' | 'read' | undefined;
  try { kind = (JSON.parse(readFileSync(lockPathOf(file), 'utf8')) as LockBody).kind; } catch { /* 已释放 */ }
  try { unlinkSync(lockPathOf(file)); } catch { /* 已释放/被收编 */ }
  if (kind === 'mutate' && process.env.SW_MUT_GUARD_HOLDER === String(process.pid)) {
    delete process.env.SW_MUT_GUARD_HOLDER;
  }
}

// ---------------- L1 补充：长持锁通道（读盘自证窗专用,★BJ662/BJ652 建议③） ----------------

/** 非变异方的【跨测试整段】持锁：静态对账闸（bj378 canary）等「snapshot→assert 读盘
 *  自证窗」与 in-flight withMutation 的 mutate→spawn→restore 窗按同文件互斥——并行
 *  池内交错 = canary 假红（bj378×bj642/bj643 Arrow.ts 实锤）。持锁方零写盘,不触
 *  L2 registry/还原面;陈锁收编/忙等等语义与 withMutation 完全同键同参。
 *  纪律：lock/unlock 必须 beforeAll/afterAll 同域配对（afterAll 侧放 finally）,
 *  持锁跨度内禁止再经 withMutation 触同一文件（自锁死）。 */
export function lockTargetFile(file: string, label: string): void {
  mkdirSync(ROOT, { recursive: true });
  acquireLock(file, label, 'read');   // ★BJ725-F：只读持锁者——盘面恒纯净,守卫读可直读
}
export function unlockTargetFile(file: string): void {
  releaseLock(file);
}

// ---------------- L3: 残留自检 ----------------

/** 持锁后取纯净基准:泄漏态→自动还原+显式 fail;毒盘无备份→loud fail;源漂移→loud fail */
function preflight(file: string, trigger: string, replacement: string, opts: MutationGuardOpts): string {
  const cur = readFileSync(file, 'utf8');
  if (opts.verifyPristine) {
    try { opts.verifyPristine(cur); return cur; } catch { /* 非纯净——走泄漏判别 */ }
  } else if (cur.includes(trigger)) {
    return cur;                                             // 干净（含 trigger 即信）
  }
  const mutated = opts.isMutated
    ? opts.isMutated(cur)
    : (!cur.includes(trigger) && cur.includes(replacement));
  const bp = backupPathOf(file);
  const backupValid = (bak: string): boolean => {
    try {
      if (opts.verifyPristine) { opts.verifyPristine(bak); return !opts.isMutated?.(bak); }
      return bak.includes(trigger) && !bak.includes(replacement);
    } catch { return false; }
  };
  if (mutated && existsSync(bp)) {
    const bak = readFileSync(bp, 'utf8');
    if (backupValid(bak)) {
      writeFileSync(file, bak);                             // 上轮崩溃泄漏自愈（字节级纯净备份）
      throw new Error(
        `mutation-guard: ${file} 检出上轮变异泄漏（盘上呈变异态）——`
        + `已自动还原纯净备份;本测显式 fail 暴露泄漏事件（禁静默）`);
    }
  }
  throw new Error(
    `mutation-guard: ${file} 盘面非纯净（缺 trigger/未过 verifyPristine）`
    + (mutated ? ' 且呈变异态但无可用纯净备份——人工核对盘上现态后手工还原（禁 git checkout）'
               : ` ——源已漂移（并行刀改写?）:先按现盘重锚注入串 ${JSON.stringify(trigger.slice(0, 80))} 再跑（禁 git checkout）`));
}

// ---------------- 主入口 ----------------

/** 变异自证单发：锁→残留自检→纯净备份→写变异→body（恰红断言）→finally 强还原+逐字节对拍→释放 */
export function withMutation(
  file: string, trigger: string, replacement: string,
  body: () => void, opts: MutationGuardOpts = {},
): void {
  installPanicHooks();
  acquireLock(file, opts.label ?? trigger.slice(0, 40));
  let pristine = '';
  try {
    pristine = preflight(file, trigger, replacement, opts);
    opts.onPristine?.(pristine);
    const mutated = opts.mutate ? opts.mutate(pristine) : pristine.replace(trigger, replacement);
    if (!opts.mutate && mutated === pristine) {
      throw new Error(`mutation-guard: 注入零差异（trigger 未被替换命中）: ${file}`);
    }
    if (mutated === pristine) {
      throw new Error(`mutation-guard: 自定义变异算子产出零差异: ${file}`);
    }
    try { writeFileSync(backupPathOf(file), pristine); } catch { /* 备份失败不阻断,自愈退化 */ }
    registry.set(file, pristine);
    writeFileSync(file, mutated);
    try {
      body();
    } finally {
      writeFileSync(file, pristine);
      registry.delete(file);
      if (readFileSync(file, 'utf8') !== pristine) {
        writeFileSync(file, pristine);                       // 强写第二次
        if (readFileSync(file, 'utf8') !== pristine) {
          throw new Error(`mutation-guard: ${file} 还原后逐字节对拍仍不一致——人工介入（禁 git checkout）`);
        }
        throw new Error(`mutation-guard: ${file} 首次还原对拍不一致（已强写复原）——查并行覆写面`);
      }
    }
  } finally {
    releaseLock(file);
  }
}

// ================= ★BJ725-F 守卫读（race 根治刀,2026-10-26） =================
// 病根：withMutation 的「写变异→spawn 子 vitest→还原」窗口内，并行 worker 里其他
// 测试文件的 SRC()/readFileSync 结构锁直读盘面 → 读到变异态 → 假红（BJ725-A 独立
// 复核实锤：bj723c-4g 计数锁在 bj725a-whip-magic D1-M1 窗内见 3 报红,单跑全绿）。
// 先例 bj378 canary（lockTargetFile 读写双端自愿持锁）是打地鼠——每新增变异目标
// 都要记得给全部读方挂锁。本刀单点根治：setupFile 全局给 fs.readFileSync 挂守卫,
// 全部读方（现存+未来）自动免疫,读方零改动。
//
// 守卫读语义（按锁持者分档）：
//   ①锁空闲 → 取锁→直读→释放（防取读间隙 TOCTOU;窗口微秒级）
//   ②持锁者 kind='read'（lockTargetFile 只读自证窗）→ 直读——盘面恒纯净
//     （withMutation 拿不到锁=无变异在飞;读-读互不相扰）
//   ③持锁者是我自己的 pid（同进程 withMutation 内部读/lockTargetFile 窗内读）→
//     直读——env SW_MUT_GUARD_HOLDER==自身（env-bypass 同源判据）
//   ④持锁者是变异窗且我是其子进程（env SW_MUT_GUARD_HOLDER==持锁 pid,
//     spawnSync({...process.env}) 继承）→ 直读变异盘——结构锁恰红/行为红都依赖
//     读到变异态,子进程等父=必然超时
//   ⑤持锁者是他人变异窗 → 读纯净备份 pristine-<key>.bak（withMutation 在写变异
//     【前】必写备份;备份 mtime ≥ 持锁 at-50ms 判新鲜——同拍链备份内容≡当轮纯净,
//     跨轮陈旧备份因 mtime 门槛被拒）。备份未写=变异未落盘=盘面仍纯净→直读。
//     复核后持锁者未变才采信（变则重试）。崩溃残锁(>900s)就地收编重试。
//
// 零行为差保证：所有路径最终都是 origRead（同参数同编码同返回类型）——守卫只改
// 「读哪个时刻的哪份字节」，不改读语义。ESM 具名导入活绑定已实证（patch 后
// import { readFileSync } 的既有闭包全部被拦）。

/** 守卫读捕获的原生 readFileSync。★禁直用本模块 ESM 具名绑定——经 alias 语义本模块
 *  豁免走真 fs,绑定虽是原始函数,但 createRequire 捕获显式钉死「补丁不可达面」,
 *  防未来装载通道演化(快照/别名/守卫嵌套)时静默自递归。 */
const ORIG_READ: (...a: unknown[]) => unknown =
  createRequire(import.meta.url)('node:fs').readFileSync;

interface LockBody { pid: number; label: string; at: number; kind?: 'mutate' | 'read' }

function readLockBody(lp: string): LockBody | null {
  try { return JSON.parse(readFileSync(lp, 'utf8')) as LockBody; } catch { return null; }
}

/** 单次取锁尝试（不等待——与 acquireLock 的忙等语义分域） */
function tryAcquireOnce(file: string, label: string): boolean {
  try {
    mkdirSync(ROOT, { recursive: true });
    writeFileSync(lockPathOf(file), JSON.stringify({ pid: process.pid, label, at: Date.now(), kind: 'read' }), { flag: 'wx' });
    return true;
  } catch { return false; }
}

/** BJ725-F 守卫读：并行变异窗内读 src 文件永得纯净态（详见节首注） */
export function readFileSyncGuarded(file: string, ...args: unknown[]): unknown {
  const lp = lockPathOf(file);
  for (let spin = 0; spin < 64; spin++) {
    if (tryAcquireOnce(file, 'BJ725-F guarded read')) {
      try { return (ORIG_READ as (...a: unknown[]) => unknown)(file, ...args); }
      finally { releaseLock(file); }
    }
    const holder = readLockBody(lp);
    if (!holder) continue;                                   // 释放竞态——重试
    // 崩溃残锁就地收编（与 acquireLock 同阈值,防毒盘长悬）
    try { if (Date.now() - statSync(lp).mtimeMs > STALE_MS) { unlinkSync(lp); continue; } } catch { /* 已释放 */ }
    const kind = holder.kind ?? 'mutate';                    // 旧锁体保守档
    if (kind === 'read') return (ORIG_READ as (...a: unknown[]) => unknown)(file, ...args);
    if (holder.pid === process.pid
      || process.env.SW_MUT_GUARD_HOLDER === String(holder.pid)) {
      return (ORIG_READ as (...a: unknown[]) => unknown)(file, ...args);
    }
    // 他人变异窗：优先纯净备份（mtime ≥ 持锁 at-50ms 判新鲜——同拍链内容等价,
    // 跨轮陈旧备份 mtime 远小于 at 被拒）
    const bp = backupPathOf(file);
    try {
      if (statSync(bp).mtimeMs >= holder.at - 50) {
        const bak = (ORIG_READ as (...a: unknown[]) => unknown)(bp, ...args);
        const holder2 = readLockBody(lp);
        if (holder2 && holder2.pid === holder.pid) return bak;   // 复核持锁未变才采信
      } else {
        // 备份未写=变异未落盘=盘面仍纯净——直读（同参数直返）
        const holder2 = readLockBody(lp);
        if (holder2 && holder2.pid === holder.pid) {
          return (ORIG_READ as (...a: unknown[]) => unknown)(file, ...args);
        }
      }
    } catch { /* 备份缺失/读取失败——落到持锁复核重试 */ }
  }
  // 持锁者高速轮转兜底：直读并显式告警（禁静默——此角面读方须知情）
  console.warn(`[mutation-guard] 守卫读重试上限(64)耗尽,直读: ${file}`);
  return (ORIG_READ as (...a: unknown[]) => unknown)(file, ...args);
}

/** BJ725-F：全局安装 src 读守卫（setupFile 一次调用）。只拦 repo 内 src 树下的
 *  .ts 字符串路径读;其余(Buffer/URL/fd/非 src 路径/node_modules)原样透传。
 *  Node 内置模块 default 导出=CJS 单例对象（可写属性）,具名导入是活绑定——patch
 *  单例即拦到全部 import 形态（import { readFileSync } / import fs / require,
 *  活绑定已实证）。 */
/** BJ725-F:src 树 .ts 路径判定（tests/fs-guard-shim.ts 路由消费的唯一单源） */
const REPO_ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));   // 外层仓根——覆盖 game/src 与 server/src
export function isGuardedSrcPath(p: string): boolean {
  const abs = resolve(p);
  const rel = abs.startsWith(REPO_ROOT) ? abs.slice(REPO_ROOT.length + 1) : '';
  return rel.length > 0 && !rel.startsWith('node_modules')
    && /(^|[\\/])src([\\/]|$)/.test(rel) && rel.endsWith('.ts');
}

/** BJ725-F 测试缝（tests/mut-read-guard.test.ts 六相锁专用;非测试面禁用） */
export const _bj725fTestPaths = { lockPathOf, backupPathOf, ROOT };
