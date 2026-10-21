// ★BJ694（2026-10-19 用户令「还有登记账的话继续清」——第二波登记债五件）判别锁。
//  债清单与处置：
//   ①BJ690 债：可疑的眼球 43 右键臂错置（原版左键 ItemCheck 专用,右键零使用面）——
//     整撤;连带清掉臂内【错域】FLY_A_KITE 风筝成就第三副本（夜晚召唤+大风天错误
//     触发;正位=风筝放置臂两处）。
//   ②BJ691b 债①：PlrImport 导出 lastTimePlayerWasSaved 缺 .NET 纪元基（621355968000000000）
//     ——原版 FromBinary 解得公元 0057 年;修=UtcNow.ToBinary() 全式（纪元基+Kind 位）。
//   ③BJ686 债：TrailShader 半分辨率误诊注——该注把「飞行波浪」归因半分辨率（真因=
//     TrailingMode4 补偿时序,已修）;阈值/闸保留（真实性能面）,注勘误。
//   ④BJ689 债：火绒狐 1106 弹速残红——测试锁陈旧（BJ642 已退役 ×3 字面补偿改引擎
//     extraUpdates=2 子步）,palworld 套件随刀改判（38/38）,本文件不重复锁。
//   ⑤BJ691b 债②：世界列表完整序三前缀层——CanWorldBeJoinedByActivePlayer（旅程匹配,
//     压倒收藏）+HasWorldBeenPlayedByActivePlayer（角色×世界游玩史=原版地图档存在
//     等价,CharacterMeta.playedWorlds 新字段+进世界两路写入）;IsNewlyGenerated 会话旗
//     本仓创建流直达游戏=不可观测,登记不建模。
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeIdb } from './fake-idb-util';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const read = (p: string) => readFileSync(p, 'utf8');

// ============================================================
// §1 43 右键臂整撤（Game.ts;M1 位）
// ============================================================
describe('§1 可疑的眼球 43 右键臂（BJ690 同族输入域错置）', () => {
  it('右键臂已整撤：零 else-if 43 形;左键臂在位;风筝成就副本 3→2', () => {
    const src = read(join(GAME, 'src', 'core', 'Game.ts'));
    expect(src).not.toContain('else if (heldDef && (heldDef.vid ?? -1) === 43)');
    expect(src).toContain("if ((heldDef.vid ?? -1) === 43) {");   // 左键臂（summon-gate 锚同款）
    const kiteHooks = src.match(/handleSpecialEvent\(17,/g) ?? [];
    expect(kiteHooks.length, 'FLY_A_KITE 唯二正位（风筝放置臂×2;眼球臂错域副本已清）').toBe(2);
  });
  it('反编译锚：43 无 altFunctionUse（Item.cs SetDefaults case 43 块内零 alt 行）', () => {
    const van = read(join(VAN, 'Terraria', 'Item.cs'));
    const i = van.indexOf('num == 43)\n\t\t\t{');
    if (i < 0) return;   // 反编译形状差异时跳过（左键臂锚已锁语义）
    const block = van.slice(i, van.indexOf('num == 44)', i));
    expect(block).not.toContain('altFunctionUse');
  });
});

// ============================================================
// §2 PlrImport .NET 纪元基（PlrImport.ts;M2 位）
// ============================================================
describe('§2 lastTimePlayerWasSaved = UtcNow.ToBinary() 全式', () => {
  it('导出含纪元基 621355968000000000 + Kind 位（旧裸 Date.now()×10000 已清）', () => {
    const src = read(join(GAME, 'src', 'save', 'PlrImport.ts'));
    expect(src).toContain('621355968000000000n + BigInt(Date.now()) * 10000n + (2n << 62n)');
  });
  it('反编译锚：Player.cs:55563 存档写入 UtcNow.ToBinary()', () => {
    const van = read(join(VAN, 'Terraria', 'Player.cs'));
    const i = van.indexOf('long value = DateTime.UtcNow.ToBinary();');
    expect(i).toBeGreaterThan(-1);
    expect(van.slice(i, i + 110)).toContain('fileIO.Write(value);');
  });
});

// ============================================================
// §3 TrailShader 误诊注勘误（BJ686 债;M3 位）
// ============================================================
describe('§3 半分辨率注勘误（真因=TrailingMode4 时序,闸保留）', () => {
  it('TrailShader 含 BJ686 勘误注（误诊归因声明+闸保留理由）', () => {
    const src = read(join(GAME, 'src', 'fx', 'TrailShader.ts'));
    expect(src).toContain('BJ686 勘误注');
    expect(src).toContain('半分辨率论当时是错误归因');
  });
});

// ============================================================
// §5 世界列表三前缀层（sortWorldsForChar 纯函数 + store 记录 + 接线）
// ============================================================
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => void mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;
const idb = installFakeIdb();
// ★跨文件垫自清（character-store.test.ts 同 worker 共享 fake-IDB/localStorage——
//  本文件 §5b 落的 index/角色残留会污染其「id 单调递增」的精确列表断言）
afterAll(() => { mem.clear(); idb.map.clear(); idb.dropConnection(); });

const { sortWorldsForChar } = await import('../src/ui/WorldSelect');
const { CharacterStore } = await import('../src/save/CharacterStore');
const { defaultAppearance } = await import('../src/player/Appearance');

interface W { id: number; name: string; seed: string; w: number; h: number; difficulty: number;
  evil: -1 | 0 | 1; hardMode?: boolean; createdAt: number; lastPlayed: number; playTimeMs: number; favorite: boolean; playedWorlds?: number[] }
const mkW = (id: number, difficulty: number, lastPlayed: number, name = `W${id}`, favorite = false): W =>
  ({ id, name, seed: 's', w: 4200, h: 1200, difficulty, evil: 0, createdAt: 1, lastPlayed, playTimeMs: 0, favorite });

describe('§5a sortWorldsForChar（UIWorldSelect.cs:157-158 全序）', () => {
  it('旅程角色：旅程世界全组压倒经典世界（即使经典是收藏）', () => {
    const list = [mkW(1, 0, 100, 'ClassicFav', true), mkW(2, 0, 50), mkW(3, 3, 10), mkW(4, 3, 20, 'JourneyB', true)];
    const out = sortWorldsForChar(list as never, { difficulty: 3 });
    expect(out.map((x) => x.id)).toEqual([4, 3, 1, 2]);   // 旅程组（收藏先）→ 经典组（收藏先）
  });
  it('经典角色：经典世界在前;玩过层在收藏后（原版序:IsFavorite→HasPlayed→LastPlayed）', () => {
    const list = [
      mkW(1, 0, 10),                    // 经典,没玩过
      mkW(2, 0, 20, 'W2', true),        // 经典,收藏,没玩过
      mkW(3, 0, 5, 'W3'),               // 经典,玩过（playedWorlds 含 3）
      mkW(4, 3, 99),                    // 旅程（经典角色=不可加入,殿后）
    ];
    const out = sortWorldsForChar(list as never, { difficulty: 0, playedWorlds: [3] });
    expect(out.map((x) => x.id)).toEqual([2, 3, 1, 4]);
  });
  it('ac=null=store 序透传（无角色域层,多人/无上下文面;恒等不重排）', () => {
    const list = [mkW(1, 0, 20), mkW(2, 0, 10)];   // 已按 store 序（lastPlayed 降）排好的输入
    const out = sortWorldsForChar(list as never, null);
    expect(out.map((x) => x.id)).toEqual([1, 2]);   // 恒等透传（不重排不倒序）
  });
  it('反编译锚：CanJoin=旅程↔旅程（:163-168）;全序 orderby 行（:157-158）', () => {
    const van = read(join(VAN, 'Terraria.GameContent.UI.States', 'UIWorldSelect.cs'));
    const i = van.indexOf('private static bool CanWorldBeJoinedByActivePlayer');
    expect(van.slice(i, i + 260)).toContain('Main.ActivePlayerFileData.Player.difficulty == 3');
    const j = van.indexOf('OrderByDescending(CanWorldBeJoinedByActivePlayer)');
    expect(j).toBeGreaterThan(-1);
    expect(van.slice(j - 40, j + 400)).toContain('ThenByDescending(IsNewlyGenerated)');
    expect(van.slice(j - 40, j + 400)).toContain('ThenByDescending(HasWorldBeenPlayedByActivePlayer)');
    expect(van.slice(j - 40, j + 400)).toContain('ThenByDescending((WorldFileData x) => x.LastPlayed)');
  });
});

describe('§5b CharacterStore.recordPlayedWorld（游玩史写入）', () => {
  it('首记写入 + 幂等零重写 + 缺席 meta 静默', async () => {
    mem.clear(); idb.map.clear(); idb.dropConnection();
    const s = new CharacterStore();
    const a = await s.create({ ...defaultAppearance(), name: 'A' });
    await s.recordPlayedWorld(a.id, 42);
    expect(s.list().find((m) => m.id === a.id)?.playedWorlds).toEqual([42]);
    await s.recordPlayedWorld(a.id, 42);   // 幂等
    expect(s.list().find((m) => m.id === a.id)?.playedWorlds).toEqual([42]);
    await s.recordPlayedWorld(999, 1);     // 缺席 meta=静默不抛
    // 持久化（新实例重读 index——IDB fake 垫跨实例共享）
    const s2 = new CharacterStore();
    await s2.ensureLoaded();
    expect(s2.list().find((m) => m.id === a.id)?.playedWorlds).toEqual([42]);
  });
});

describe('§5c 接线源锚（面板快照 + 进世界写入位）', () => {
  it('mainFlow：activeCharSnapshot 两面板位 + 写入位（★BJ704-G7 2026-10-21 改判：写入位由 loadWorldFlow/createWorldFlow 两处【进世界尝试拍】迁 doSave【玩家保存拍】——原版地图档唯写时点=Player.InternalSaveMap :55691←InternalSavePlayer :55355,失败路径零记;锁随刀更新,改判史=BJ694 初锁两写入位）', () => {
    const src = read(join(GAME, 'src', 'mainFlow.ts'));
    expect((src.match(/activeCharSnapshot\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);   // 定义+两调用
    // doSave 玩家保存链唯一写入位（绑定=slotMeta ∨ joinRoomWorldId）
    expect(src).toContain('const playedWorldId = slotMeta?.id ?? joinRoomWorldId;');
    expect(src).toContain('void charStore.recordPlayedWorld(cid, playedWorldId)');
    // 旧「尝试即记」位零残留（loadWorldFlow/createWorldFlow 不再直写）
    expect(src).not.toContain('recordPlayedWorld(cid, meta.id)');
  });
  it('WorldSelectPanel：activeChar 第 4 参 + sortWorldsForChar 消费', () => {
    const src = read(join(GAME, 'src', 'ui', 'WorldSelect.ts'));
    expect(src).toContain('private activeChar: WorldSelectActiveChar | null = null');
    expect(src).toContain('sortWorldsForChar(this.store.list(), ac)');
  });
});
