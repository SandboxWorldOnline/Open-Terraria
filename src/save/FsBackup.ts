// ★BJ614（2026-10-10 用户拍板「File System Access 是个不错的方向，可以做为增强选项，
// 先在设置中可启用」+ 追加「角色存档也要备份」「读档自愈恢复链」）：File System Access
// 本地目录自动备份——浏览器存储（IDB）被驱逐/清空之外的**站外**副本面。
//
// 与既有两道防线的关系（三层并存,互不改动）：
//  - BJ611 persist() = 防 IDB 被整批驱逐（origin 内）；
//  - BJ605 写失败自动导出下载 = 存储写失败的即时兜底（文件在用户下载目录）；
//  - 本模块（BJ614）= 每次存档成功后的【自动、无感】目录快照（用户选定目录,常驻
//    最新 3 份历史）+ 读档键缺失时的【自动恢复链】（备份写回 IDB 续正常读档）。
//
// 轮转策略定谳（候选 A 覆盖单文件 vs 候选 B 每键最近 3 份时间戳快照）：**选 B**。
// 依据=File System Access 目录枚举 API 亲读（MDN FileSystemDirectoryHandle.keys(),
// 2026-10-10）：keys() 返回【异步迭代器】逐出目录内全部条目名（文件+子目录），单次
// 枚举为 O(目录内条目数) 的元数据操作、无内容读取；轮转=每键一次枚举 + 至多 (n-3)
// 次 removeEntry（Chromium 逐文件删除,无递归需求）。备份目录专用且小（每世界/角色
// ≤3 份 + 2 个 index 覆盖档），每存档一轮枚举+零星删除成本可忽略——历史快照的恢复
// 价值（最近一次存档也可能是损坏态）压倒这点成本,故取 B。候选 A 仅在目录枚举不可用
// 时才有优势,与本特性支持的浏览器面重合,不成立。
//
// 浏览器面与权限模型（MDN 亲读定谳 2026-10-10）：
//  - showDirectoryPicker({id,mode:'readwrite'})：需 transient user activation（设置页
//    开关点击=手势 ✓）;resolve 时 readwrite 已授予（否则 AbortError）;AbortError=用户
//    取消;SecurityError=无手势/跨域 iframe。Firefox/Safari 未实现（兼容门=开关禁用+
//    「仅 Chrome/Edge 系浏览器」标注）。
//  - 句柄可结构化克隆 → 原生可入 IDB（KvStore kvPutValue 通道,键域隔离零 schema 变更）。
//  - 【跨会话权限】IDB 读回的句柄 queryPermission() 很可能 'prompt'（MDN 原文：a handle
//    retrieved from IndexedDB is also likely to resolve with 'prompt'）→ 自动链静默跳过
//    +设置页「待重新授权」+按钮 requestPermission（手势）。**不强弹**。
//  - ★登记债（文档面）：Chromium 对【已安装 PWA】的句柄授权持久化更宽（安装态跨重启
//    保留 granted,普通标签页新会话回落 prompt）——MDN 未文档化该差异,属浏览器实现行为,
//    本模块不依赖之（统一走 query→request 防 prompt 路径,PWA 宽松面=自然收益）。
//  - createWritable()=临时文件写入、close() 原子提交（半写崩溃不留残档）。
//
// 备份文件命名（同名解析按 (kind,id) 与时间戳,世界名仅人读;改名不破坏轮转分组）：
//   世界数据   {世界名}_{世界id}_{YYYYMMDD}_{HHmmss}.json   ← sandboxworld.world.<id>
//   角色外观   {角色名}_char_{角色id}_{ts}.json              ← sandboxworld.player.<id>
//   角色随身态 {角色名}_state_{角色id}_{ts}.json             ← sandboxworld.playerstate.<id>
//   世界索引   worlds.index.json（覆盖式单档）               ← sandboxworld.worlds.index
//   角色索引   players.index.json（覆盖式单档）              ← sandboxworld.players.index
//   快速存档   quicksave.json（覆盖式单档）                  ← sandboxworld.quicksave
//                                                              ★BJ618 件3（probe F6 三面补齐）
// 轮转分组键=(kind,id)——时间戳段 \d{8}_\d{6} 使三类快照正则互斥（名含 _char_/_state_
// 的世界不会被误分类,见 tests）。index 不轮转（覆盖式,小文件,永远是最新索引）。
//
// 失败面（增强链纪律：绝不干扰主保存/读档链）：快照链 fire-and-forget 全 try-catch;
// 写失败 console.warn+状态 'broken'（设置页显示）;连续 3 败→一次性 toast（同一连败
// 段不重复,成功后重新计数）。恢复链只读备份目录+写回 IDB,任何异常返回原错误文案路径。
import { kvGetUnknown, kvGetIdb, kvPutValue, kvDelete, kvSet } from './KvStore';

// ---- lib.dom（TS 5.9.3）未收录的 File System Access 面最小结构声明 ----
// （showDirectoryPicker/句柄权限方法/目录异步枚举均不在 lib.dom;以本模块自用形状
//  声明,不污染全局——mock 测试按同形状喂夹具）
/** MDN Window.showDirectoryPicker options（id=浏览器记住的同 id 上次目录;mode 缺省
 *  read,readwrite=选目录即授予读写）;resolve 时所选目录在该 mode 下已 granted。 */
interface FsDirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: unknown;
}
type FsPermissionState = 'granted' | 'denied' | 'prompt';
/** 目录句柄最小形状（本模块只消费这些成员;真实句柄是 FileSystemDirectoryHandle） */
interface FsDirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  queryPermission?(descriptor?: { mode: 'read' | 'readwrite' }): Promise<FsPermissionState>;
  requestPermission?(descriptor?: { mode: 'read' | 'readwrite' }): Promise<FsPermissionState>;
  /** 目录条目名异步迭代（文件+子目录;MDN keys()） */
  keys(): AsyncIterableIterator<string>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandleLike>;
  /** 删除目录内条目（文件无需 recursive;NotFoundError=条目已不在） */
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}
/** 文件句柄最小形状（createWritable=临时文件+close 原子提交;getFile()→File=全文读取）。
 *  ★Issue#25 改判史（2026-10-27）：旧声明 `text(): Promise<string>` 系对标准
 *  FileSystemFileHandle 的错读——句柄上没有 text()（MDN：getFile()/createWritable()/
 *  createSyncAccessHandle() 三成员）,text() 在 getFile() 返回的 File（Blob）上。错声明
 *  让 TS 检查失效+测试夹具照抄幻想接口=测试恒绿而真机 restore 必抛
 *  TypeError: fh.text is not a function → catch 转 broken,备份永不可恢复。 */
interface FsFileHandleLike {
  createWritable?(options?: { keepExistingData?: boolean }): Promise<{
    write(data: BlobPart): Promise<void>;
    close(): Promise<void>;
    abort?(reason?: unknown): Promise<void>;
  }>;
  /** 标准 API：句柄→File 对象（File 继承 Blob,text() 可用） */
  getFile(): Promise<{ text(): Promise<string> }>;
}
type FsPicker = (options?: FsDirectoryPickerOptions) => Promise<FsDirectoryHandleLike>;

/** 兼容门：showDirectoryPicker 存在（Chrome/Edge 系;Firefox/Safari 缺失） */
export function fsBackupSupported(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: FsPicker }).showDirectoryPicker === 'function';
}

// ---- 备份文件名（纯函数,node 可单测） ----

/** 世界名/角色名消毒（与 WorldStore.buildSaveBackupFilename 同规则：文件名非法字符
 *  与空白→'_'）+空名回退（char/state 用 'char' 区分空名世界 'world'）。 */
export function sanitizeFsBackupName(rawName: string, fallback: string): string {
  const cleaned = (rawName || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  return cleaned && cleaned !== '_' ? cleaned : fallback;
}

const p2 = (n: number) => String(n).padStart(2, '0');
const stampOf = (d: Date): string =>
  `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

export type FsBackupKind = 'world' | 'player' | 'playerstate' | 'quicksave';

/** 快照文件名：世界 {名}_{id}_ts.json / 角色外观 {名}_char_{id}_ts.json /
 *  角色随身态 {名}_state_{id}_ts.json（时间戳=轮转必需的互异名,同秒内二次快照覆盖
 *  同名文件=同秒折叠,无害）。★BJ618 件3：quicksave=覆盖式固定名 quicksave.json
 *  （单槽草稿无 id/名维度;解析面不识别=轮转分组天然 no-op,恢复链走专用支）。 */
export function buildFsBackupFilename(kind: FsBackupKind, rawName: string, id: number, d: Date): string {
  if (kind === 'quicksave') return 'quicksave.json';
  const name = sanitizeFsBackupName(rawName, kind === 'world' ? 'world' : 'char');
  const infix = kind === 'world' ? '' : kind === 'player' ? '_char' : '_state';
  return `${name}${infix}_${id}_${stampOf(d)}.json`;
}

/** 快照文件名解析（顺序=先专用中缀后通用：_state_ → _char_ → 世界裸 _id_;时间戳段
 *  \d{8}_\d{6} 保证互斥,见 tests/bj614-fs-backup.test.ts 消歧矩阵）。index 覆盖档
 *  不匹配（无时间戳段）。 */
export function parseFsBackupFilename(name: string): { kind: FsBackupKind; id: number; stamp: string } | null {
  const table: ReadonlyArray<{ kind: FsBackupKind; re: RegExp }> = [
    { kind: 'playerstate', re: /^(.+)_state_(\d+)_(\d{8})_(\d{6})\.json$/ },
    { kind: 'player', re: /^(.+)_char_(\d+)_(\d{8})_(\d{6})\.json$/ },
    { kind: 'world', re: /^(.+)_(\d+)_(\d{8})_(\d{6})\.json$/ },
  ];
  for (const t of table) {
    const m = t.re.exec(name);
    if (m) return { kind: t.kind, id: Number(m[2]), stamp: `${m[3]}_${m[4]}` };
  }
  return null;
}

/** 轮转纯核：同一 (kind,id) 分组内保留最近 keep 份（时间戳段定长零填充,字典序即
 *  时序;不可解析者视为最旧优先清除——防御未来异形残留）。返回应删除的名字列表。 */
export function pickRotatingOut(names: readonly string[], keep = 3): string[] {
  const sorted = [...names].sort((a, b) => {
    const sa = parseFsBackupFilename(a)?.stamp ?? '';
    const sb = parseFsBackupFilename(b)?.stamp ?? '';
    return sb.localeCompare(sa);   // 新→旧
  });
  return sorted.slice(keep);
}

/** IDB 数据键 → 备份目标映射（恢复链/幽灵扫描共用;未知键=null=无备份可查）。
 *  ★BJ618 件3：quicksave 映射 {kind:'quicksave',id:0}（单槽草稿,恢复面=覆盖式
 *  quicksave.json 专用支——probe F6「恢复面对 quicksave=unknown-key」已收口）。 */
export function backupTargetOfKey(idbKey: string):
  | { kind: 'index'; which: 'worlds' | 'players' }
  | { kind: FsBackupKind; id: number }
  | null {
  if (idbKey === 'sandboxworld.worlds.index') return { kind: 'index', which: 'worlds' };
  if (idbKey === 'sandboxworld.players.index') return { kind: 'index', which: 'players' };
  if (idbKey === 'sandboxworld.quicksave') return { kind: 'quicksave', id: 0 };
  let m = /^sandboxworld\.world\.(\d+)$/.exec(idbKey);
  if (m) return { kind: 'world', id: Number(m[1]) };
  m = /^sandboxworld\.playerstate\.(\d+)$/.exec(idbKey);
  if (m) return { kind: 'playerstate', id: Number(m[1]) };
  m = /^sandboxworld\.player\.(\d+)$/.exec(idbKey);
  if (m) return { kind: 'player', id: Number(m[1]) };
  return null;
}

// ---- 模块状态（句柄=唯一真源,IDB 持久化;无 Options 字段——「关」=无句柄） ----

export const FS_BACKUP_HANDLE_KEY = 'sandboxworld.fsBackup.dir';
/** 轮转保留份数（每 (kind,id) 分组最近 3 份） */
export const FS_BACKUP_KEEP = 3;
/** 连续写失败达此数 → 一次性 toast（同一连败段只报一次,成功后重计） */
export const FS_BACKUP_FAIL_TOAST_STREAK = 3;

export type FsBackupStatus =
  | 'unsupported'       // 无 showDirectoryPicker（Firefox/Safari）——开关禁用
  | 'off'               // 未启用（无句柄）=缺省
  | 'ready'             // 句柄在+readwrite granted——自动备份链活跃
  | 'needs-permission'  // 句柄在但 prompt（跨会话常态）——静默跳过+待重新授权
  | 'broken';           // 写失败（目录被删/移动/权限被吊销）——重新选择目录

let dirHandle: FsDirectoryHandleLike | null = null;
let loaded = false;
let status: FsBackupStatus = 'unsupported';
let loadPromise: Promise<void> | null = null;
let failStreak = 0;
let failToastFired = false;   // 同一连败段一次性（成功复位）

/** 状态订約（设置页订阅刷新;返回退订函数——面板 close 必退订,防监听器自捕环） */
const statusListeners = new Set<() => void>();
export function onFsBackupStatusChange(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}
function setStatus(s: FsBackupStatus): void {
  if (status === s) return;
  status = s;
  for (const cb of [...statusListeners]) {
    try { cb(); } catch { /* 订阅方异常不扩散 */ }
  }
}

/** 当前状态（设置页同步读;未 load 完成为 off/unsupported 初值,订阅面会刷新） */
export function fsBackupStatus(): FsBackupStatus {
  if (!fsBackupSupported()) return 'unsupported';
  return status;
}

/** 句柄加载（懒;幂等）——IDB 读回句柄+queryPermission 定态 */
function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let h: FsDirectoryHandleLike | null = null;
    try {
      const raw = await kvGetUnknown(FS_BACKUP_HANDLE_KEY);
      if (raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'directory'
        && typeof (raw as { keys?: unknown }).keys === 'function') {
        h = raw as FsDirectoryHandleLike;
      }
    } catch (e) {
      console.warn('[fsBackup] 句柄读取失败（IDB 不可用?）', e);
    }
    // ★竞态守卫：读档期间用户已经 pick/disable 先行落态（模块预取是启动即发的
    //  fire-and-forget,迟到结果不得覆盖新手势态）
    if (loaded) return;
    dirHandle = h;
    loaded = true;
    if (h) await reevaluatePermission();
    else setStatus('off');
  })();
  return loadPromise;
}

/** 句柄在时按 queryPermission 刷新状态（queryPermission 缺席/抛错=乐观按 ready,
 *  实际写失败会由失败面纠正——避免老实现把功能整体判死） */
async function reevaluatePermission(): Promise<void> {
  if (!dirHandle) { setStatus('off'); return; }
  let state: FsPermissionState | null = null;
  try {
    state = dirHandle.queryPermission ? await dirHandle.queryPermission({ mode: 'readwrite' }) : null;
  } catch { state = null; }
  if (state === 'granted' || state === null) setStatus('ready');
  else if (state === 'prompt') setStatus('needs-permission');
  else setStatus('broken');   // denied=权限被吊销,重新选择目录
}

/** 自动链活跃门（快照/恢复共用）：句柄在+granted。需要先 ensureLoaded。 */
async function backupGate(): Promise<'granted' | 'prompt' | 'inactive'> {
  await ensureLoaded();
  if (!dirHandle) return 'inactive';
  let state: FsPermissionState | null = null;
  try {
    state = dirHandle.queryPermission ? await dirHandle.queryPermission({ mode: 'readwrite' }) : null;
  } catch { state = null; }
  if (state === 'prompt') { setStatus('needs-permission'); return 'prompt'; }
  if (state === 'denied') { setStatus('broken'); return 'inactive'; }
  return 'granted';   // granted 或 queryPermission 缺席（写失败面兜底）
}

// ---- 开关流（设置页;全部经用户手势调用） ----

/** 启用：showDirectoryPicker（调用帧须处于用户手势内——Settings checkbox change 直连,
 *  本函数首个 await 即 picker 调用,不前置任何 IDB 读,保 transient activation）。
 *  成功=句柄入 IDB+状态 ready（picker mode:readwrite → resolve 即授予）。
 *  返回 false=用户取消/选目录失败（开关维持关）。 */
export async function fsBackupPickDirectory(): Promise<boolean> {
  const picker = (globalThis as { showDirectoryPicker?: FsPicker }).showDirectoryPicker;
  if (typeof picker !== 'function') return false;
  let handle: FsDirectoryHandleLike;
  try {
    // id 固定:同 id 复选时浏览器打开上次目录;mode readwrite=resolve 即授予
    handle = await picker({ id: 'sandboxworld-backup', mode: 'readwrite' });
  } catch (e) {
    // AbortError=用户取消（常规路径,静默）;其余（SecurityError 等）留物证
    if ((e as DOMException)?.name !== 'AbortError') console.warn('[fsBackup] 目录选择失败', e);
    return false;
  }
  if (!handle || handle.kind !== 'directory') return false;
  const ok = await kvPutValue(FS_BACKUP_HANDLE_KEY, handle);
  if (!ok) {
    console.warn('[fsBackup] 句柄持久化失败（IDB 不可用?）——备份未启用');
    return false;
  }
  dirHandle = handle;
  loaded = true;
  failStreak = 0;
  failToastFired = false;
  await reevaluatePermission();
  return true;
}

/** 停用：清句柄（IDB 键删除;「关」=无句柄） */
export async function fsBackupDisable(): Promise<void> {
  dirHandle = null;
  loaded = true;
  failStreak = 0;
  failToastFired = false;
  setStatus('off');
  try { await kvDelete(FS_BACKUP_HANDLE_KEY); } catch { /* IDB 不可用忽略 */ }
}

/** 重新授权（设置页按钮/★BJ655 读档点击手势链,用户手势）：requestPermission
 *  granted → ready;dismiss（prompt）/denied 维持 needs-permission/broken,不重复弹。
 *  ★BJ655：SecurityError（无手势——程序化入口;或 worker/跨域 iframe）≠目录损坏,
 *  catch 静默返 false 且**不降级 'broken'**（设置页误导「重新选择目录」;维持现态
 *  「待重新授权」,真目录损坏由写失败面 noteWriteFailure 纠正状态）。 */
export async function fsBackupRequestPermission(): Promise<boolean> {
  await ensureLoaded();
  if (!dirHandle?.requestPermission) return false;
  let state: FsPermissionState;
  try {
    state = await dirHandle.requestPermission({ mode: 'readwrite' });
  } catch (e) {
    console.warn('[fsBackup] requestPermission 失败', e);
    return false;   // ★BJ655：无手势等异常=保持现态（needs-permission）,不误降级
  }
  if (state === 'granted') {
    failStreak = 0;
    failToastFired = false;
    setStatus('ready');
    return true;
  }
  if (state === 'prompt') setStatus('needs-permission');
  else setStatus('broken');
  return false;
}

/** 当前备份目录名（设置页状态行显示;无句柄=null） */
export async function fsBackupDirName(): Promise<string | null> {
  await ensureLoaded();
  return dirHandle?.name ?? null;
}

// ---- 自动备份链（存档成功链尾;fire-and-forget,绝不抛） ----

/** 目录条目名全列（keys() 异步迭代;失败=null=调用方按目录不可达处理） */
async function listEntryNames(dir: FsDirectoryHandleLike): Promise<string[] | null> {
  try {
    const names: string[] = [];
    for await (const n of dir.keys()) names.push(n);
    return names;
  } catch (e) {
    console.warn('[fsBackup] 目录枚举失败', e);
    return null;
  }
}

async function writeTextFile(dir: FsDirectoryHandleLike, filename: string, json: string): Promise<void> {
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable!({ keepExistingData: false });   // 临时文件,close 原子提交
  try {
    await w.write(new Blob([json]));
    await w.close();
  } catch (e) {
    try { await w.abort?.(); } catch { /* 关闭面随主异常上报 */ }
    throw e;
  }
}

/** 写入失败/权限缺失统一记账（warn+状态+连败一次性 toast） */
function noteWriteFailure(why: string, e?: unknown): void {
  console.warn(`[fsBackup] ${why}`, e ?? '');
  failStreak++;
  setStatus('broken');
  if (failStreak >= FS_BACKUP_FAIL_TOAST_STREAK && !failToastFired) {
    failToastFired = true;   // 同一连败段一次性;成功后重置
    try { onFailToast?.(); } catch { /* 回调异常不扩散 */ }
  }
}
function noteWriteSuccess(): void {
  if (failStreak > 0) { failStreak = 0; failToastFired = false; }
  setStatus('ready');
}

/** ★BJ614 连败一次性 toast 注入口（mainFlow 接 ui.toast——save 域模块不 import UI,同
 *  WorldStore.onWriteFail 回调习语） */
export let onFailToast: (() => void) | null = null;
export function setFailToastHandler(fn: (() => void) | null): void { onFailToast = fn; }

/** 快照一份世界/角色数据（时间戳档+该 (kind,id) 分组轮转保留最近 FS_BACKUP_KEEP 份）。
 *  特性未启用/prompt 态=静默 no-op（绝不抛——增强链纪律）。now=可注入时钟（单测
 *  定谳文件名;生产缺省当前时刻）。 */
export async function fsBackupSnapshot(kind: FsBackupKind, id: number, rawName: string, json: string, now: Date = new Date()): Promise<void> {
  try {
    if (!fsBackupSupported()) return;
    const gate = await backupGate();
    if (gate !== 'granted') return;   // off/needs-permission=静默跳过（broken 已在 gate 记态）
    const dir = dirHandle!;
    const filename = buildFsBackupFilename(kind, rawName, id, now);
    try {
      await writeTextFile(dir, filename, json);
    } catch (e) {
      noteWriteFailure(`快照写入失败（${filename}）`, e);
      return;
    }
    noteWriteSuccess();
    // 轮转：枚举本目录 → 该 (kind,id) 分组超出保留数的旧档删除（只清本组,他组
    // 由各自的存档驱动;枚举失败=跳过本轮轮转,下次再清——不影响已写入的新档）
    const names = await listEntryNames(dir);
    if (!names) return;
    const group = names.filter((n) => {
      const p = parseFsBackupFilename(n);
      return p !== null && p.kind === kind && p.id === id;
    });
    for (const stale of pickRotatingOut(group, FS_BACKUP_KEEP)) {
      try { await dir.removeEntry(stale); }
      catch (e) {
        // NotFound=并发清理竞态（无害）;其余（权限等）warn 不中断
        if ((e as DOMException)?.name !== 'NotFoundError') console.warn('[fsBackup] 轮转删除失败', stale, e);
      }
    }
  } catch (e) {
    console.warn('[fsBackup] 快照链异常（已吞,不影响主链）', e);
  }
}

/** index 覆盖式备份（worlds.index.json / players.index.json;小文件恒最新,不轮转——
 *  恢复场景=索引被驱逐时的重建来源）。 */
export async function fsBackupIndex(which: 'worlds' | 'players', indexJson: string): Promise<void> {
  try {
    if (!fsBackupSupported()) return;
    const gate = await backupGate();
    if (gate !== 'granted') return;
    try {
      await writeTextFile(dirHandle!, `${which}.index.json`, indexJson);
      noteWriteSuccess();
    } catch (e) {
      noteWriteFailure(`index 备份失败（${which}.index.json）`, e);
    }
  } catch (e) {
    console.warn('[fsBackup] index 备份链异常（已吞）', e);
  }
}

// ---- 读档自愈恢复链（★BJ614 用户明令「加载角色或世界时当 IndexedDB 中找不到要从
//      备份取」；★BJ617 件2 扩为读档文本择源 resolveLoadText——IDB miss 时 FS 备份
//      优先于 LS 双写时代陈旧副本，修复读序倒挂）：键缺失 → 备份目录最新同键快照 →
//      写回 IDB → 调用方以返回文本续正常读档链（零旁路）。prompt 态=不尝试,调用方
//      给「去设置授权」提示。 ----

export type FsBackupRestoreResult =
  | { ok: true; text: string; file: string }
  | { ok: false; reason: 'off' | 'prompt' | 'no-backup' | 'broken' | 'unknown-key' };

/** 从备份恢复一个 IDB 数据键：granted 且备份目录存在同名最新文件 → 读出并写回 IDB
 *  （kvSet=存档链同款 IDB 单写通道,★BJ615;只判 'fail'）→ 返回文本;
 *  否则按 reason 报告（调用方走原错误文案）。 */
export async function restoreFromBackup(idbKey: string): Promise<FsBackupRestoreResult> {
  try {
    if (!fsBackupSupported()) return { ok: false, reason: 'off' };
    const target = backupTargetOfKey(idbKey);
    if (!target) return { ok: false, reason: 'unknown-key' };
    const gate = await backupGate();
    if (gate === 'prompt') return { ok: false, reason: 'prompt' };
    if (gate !== 'granted') return { ok: false, reason: 'off' };
    const dir = dirHandle!;
    const names = await listEntryNames(dir);
    if (!names) return { ok: false, reason: 'broken' };
    let filename: string | null = null;
    if (target.kind === 'index') {
      const fixed = `${target.which}.index.json`;
      if (names.includes(fixed)) filename = fixed;
    } else if (target.kind === 'quicksave') {
      // ★BJ618 件3：quicksave 覆盖式单档（无时间戳轮转——最新草稿即全部）
      const fixed = 'quicksave.json';
      if (names.includes(fixed)) filename = fixed;
    } else {
      const cands = names
        .map((n) => ({ n, p: parseFsBackupFilename(n) }))
        .filter((x): x is { n: string; p: { kind: FsBackupKind; id: number; stamp: string } } =>
          x.p !== null && x.p.kind === target.kind && x.p.id === target.id)
        .sort((a, b) => b.p.stamp.localeCompare(a.p.stamp));   // 新→旧
      if (cands.length > 0) filename = cands[0].n;
    }
    if (!filename) return { ok: false, reason: 'no-backup' };
    const fh = await dir.getFileHandle(filename, { create: false });
    // ★Issue#25：句柄无 text()——先 getFile() 取 File（Blob）再读全文
    const text = await (await fh.getFile()).text();
    if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: 'no-backup' };
    const where = await kvSet(idbKey, text);   // 写回 IDB=自愈迁移,下次读直命中原键（存档链同款写入通道,只判 'fail'）
    if (where === 'fail') return { ok: false, reason: 'broken' };
    return { ok: true, text, file: filename };
  } catch (e) {
    console.warn('[fsBackup] 恢复链异常', idbKey, e);
    return { ok: false, reason: 'broken' };
  }
}

/** 幽灵扫描联动（BJ611 scanEvictedSaves 消费点）：对被驱逐条目逐键尝试自动恢复。
 *  ★BJ618 件3：kind 扩 'quicksave'（扫描补探测项——恢复面=quicksave.json 专用支）。
 *  ★R13-F4：kind 扩 'playerstate'（扫描面补 playerstate 探测——恢复面=同 (kind,id)
 *  轮转组最新快照,backupTargetOfKey 本就映射 sandboxworld.playerstate.<id>）。
 *  attempted=false=特性未启用/未授权（无尝试,不弹恢复相关提示）。 */
export async function fsBackupRestoreEvicted(
  entries: ReadonlyArray<{ kind: 'world' | 'player' | 'playerstate' | 'quicksave'; id: number }>,
): Promise<{ attempted: boolean; restored: number }> {
  if (entries.length === 0) return { attempted: false, restored: 0 };
  const gate = await backupGate();
  if (gate !== 'granted') return { attempted: false, restored: 0 };
  let restored = 0;
  for (const en of entries) {
    const key = en.kind === 'world' ? `sandboxworld.world.${en.id}`
      : en.kind === 'quicksave' ? 'sandboxworld.quicksave'
      : en.kind === 'playerstate' ? `sandboxworld.playerstate.${en.id}`
      : `sandboxworld.player.${en.id}`;
    const r = await restoreFromBackup(key);
    if (r.ok) restored++;
  }
  return { attempted: true, restored };
}

/** ★BJ618 件4（BJ616 probe F5/F6）：删除源档后的备份组清理——枚举备份目录,删除同
 *  (kind,id) 的全部时间戳快照（防已删世界/角色经恢复链复活+隐私面;双 index 墓碑由
 *  Store.delete 内 saveIndex→onIndexWrite 重写生效,不在此面）。quicksave.json 不匹配
 *  时间戳解析=天然免疫（单槽草稿非删除面）。fire-and-forget 语义同快照链：全
 *  try-catch 绝不抛;off/prompt=静默跳过（增强链纪律——不为清理打断删除流）。
 *  已知边界：清理失败（目录不可达/权限缺失）时残留快照仍可被恢复链命中——恢复出
 *  已删档=源码级边界,登记债（用户重授权后可再清,或手动清理备份目录）。 */
export async function fsBackupPurgeSnapshots(kind: FsBackupKind, id: number): Promise<void> {
  try {
    if (!fsBackupSupported()) return;
    const gate = await backupGate();
    if (gate !== 'granted') return;
    const dir = dirHandle!;
    const names = await listEntryNames(dir);
    if (!names) return;
    for (const n of names) {
      const p = parseFsBackupFilename(n);
      if (p === null || p.kind !== kind || p.id !== id) continue;
      try { await dir.removeEntry(n); }
      catch (e) {
        // NotFound=并发清理竞态（无害）;其余（权限等）warn 不中断本组清理
        if ((e as DOMException)?.name !== 'NotFoundError') console.warn('[fsBackup] 删除快照清理失败', n, e);
      }
    }
  } catch (e) {
    console.warn('[fsBackup] 快照清理链异常（已吞,不影响主链）', e);
  }
}

// ---- ★BJ617 件2（BJ616 F2 读序倒挂修复）：读档文本择源 ----

/** 恢复链失败原因（union 索引访问须先 Extract 失败支——成功支无 reason 键） */
type FsBackupRestoreFailReason = Extract<FsBackupRestoreResult, { ok: false }>['reason'];

export type LoadTextResolution =
  | { source: 'idb'; text: string }
  | { source: 'fs-backup'; text: string; file: string }
  | { source: 'ls-fallback'; text: string }
  | { source: 'missing'; restoreReason: FsBackupRestoreFailReason };

/** 读档文本三段择源：IDB 现值 → FS 备份 → LS 兜底副本。
 *  ★病（BJ616 F2，mainFlow.loadFromKey 旧实现）：kvGet(key)（IDB miss → LS 兜底）
 *  非空即短路 FS 恢复链——IDB 被驱逐形态下双写时代 LS 陈旧副本抢先 FS 备份，用户
 *  静默载入旧档（可能远旧于 FS 备份），再存档=进度回滚坐实。
 *  择新定谳：① IDB 命中恒权威直返——健康档绝不咨询 FS（备份回写不得倒灌现值，
 *  否则快照在途/失败时反而载入更旧备份=自造回滚）；② 仅 IDB miss 才择新，且 FS
 *  备份优先于 LS 副本——LS 副本冻结于 BJ615 单写升级时点≈很久以前，FS 备份=BJ614
 *  后每次保存刷新=几乎恒新；两版皆无内嵌保存时间戳可比（SaveData header.created=
 *  世界创建时间非保存时间），「备份存在即择新」是最小可靠形；③ FS 恢复链失败
 *  （未启用/prompt/无备份/写回失败）→ LS 兜底副本（可能陈旧，调用方诚实标注——
 *  是否有备份面由 backupTargetOfKey 判，★BJ618 件3 起 quicksave 亦有面
 *  （quicksave.json），其恢复链失败时的 LS 副本同样作陈旧宣称）；
 *  ④ 双空=missing（restoreReason 供 prompt 授权提示分流）。
 *  lsRead 注入（mainFlow 传 localStorage.getItem 直读;本模块不内嵌 DOM 依赖）。
 *  fs-backup 支内含自愈：restoreFromBackup 已把备份写回 IDB，下次读直命中原键。 */
export async function resolveLoadText(idbKey: string, lsRead: () => string | null): Promise<LoadTextResolution> {
  const idbText = await kvGetIdb(idbKey);
  if (idbText !== null) return { source: 'idb', text: idbText };
  const rec = await restoreFromBackup(idbKey);
  if (rec.ok) return { source: 'fs-backup', text: rec.text, file: rec.file };
  const ls = lsRead();
  if (typeof ls === 'string' && ls.length > 0) return { source: 'ls-fallback', text: ls };
  return { source: 'missing', restoreReason: rec.reason };
}

// 模块加载即预取句柄（fire-and-forget;设置页/自动链/恢复链首用即态就绪）
void ensureLoaded();
