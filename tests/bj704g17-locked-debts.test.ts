// ★BJ704-G17 — 域外锁定债清偿三件（G13 登记债2/债6 + G8 登记死支;2026-10-21）。
// 逐件判语（先定谳再动刀,亲读 1457 反编译）：
//  · 件1（修,Game.ts）：QuickMount FailedCCed 分道——vanilla Player.cs:6043
//    `TryDismountWithResult != FailedNoSpace → return`（Mount.cs:6191-6203 结果枚举,
//    :6682-6695 DontDismountWhenCCed{55,56,61} 首闸）=FailedCCed 全静默（不入 3 连
//    强制链/不停抚摸/无尘无 toast）;仓旧 tryDismountMount 按 boolean 合流 → CCed
//    拒下坐误入强制链+petting 头位预停（vanilla 停抚摸/清 buff 皆在 Dismount 体内
//    :6228-6231/:6214,拒下坐拍不发生）。刀=canDismountWithResult（G13 已备分道
//    变体,Mounts.ts:2515）三道消费。
//  · 件2（销案,Renderer.ts）：G13 债6「legFrame 覆写 23/45/48」定谳=【已实现非债】
//    ——Renderer.playerFrameRows 骑乘腿钉 `(23||45||48)?0:6`（:17749-17751）与
//    vanilla Player.cs:36430-36443 逐面等价（基线行6+三态归零+计数复位）;且 Oct 20
//    dist-release 构建快照含同逻辑=面先于 G13 登记（10-21）在盘——登记系 Renderer
//    禁触批未核仓内态的误登记。本刀零改码,补判别锁防静默回退+翻正记忆。
//  · 件3（修,public/sw.js）：G8 登记两死支删除——①`res ?? fetchAsset(req)`
//    （serveAsset :218-252 全返回路径恒 Response,直读核验=双保险残形）;②旧 isDoc
//    支（≡ :321 isDocPath 同式判定,2026-09-29 doc 无条件提前后结构性不可达）。
//    字节面最小删除+bj703e/bj704g8 结构锁随迁（fetchShell 3→2/put≥6→≥5）。
//    sw.js 字节变更随下次发版生效（SW 自更新,updateViaCache:'none'）。
//
// 变异恰红映射（/tmp/bj704g17-mutations.mjs）：
//   M1 撤 cced 静默早退（回 boolean 合流形）        → A1/A2 红（toast/尘/强制链误入）
//   M2 petting 预停回函数头（失败拍也停）            → A1/A3 红（拒下坐拍停抚摸）
//   M3 撤 ok 支 buff 清偿                            → A5 红（RatMount 残留）
//   M4 撤 ok 支 petting 终止                          → A5 红（petting.mount 残留）
//   M5 撤 ok 支计数清零                               → A5 红（count 残留 2）
//   M6 撤 3 连拍 playerNoSpaceTeleport                → A4 红（tp=0）
//   M7 腿钉三元摘除（23/45/48 也行 6）               → B1 红（三态 6≠0）
//   M8 骑乘腿钉支整摘（普通坐骑落站立链）            → B1 红（type 3 → 0≠6）
//   M9 撤 DoesNotOverrideLegFrames 门（57 也钉 6）   → B1 红（57 → 6≠0）
//   M10 sw.js 复活 `?? fetchAsset` 死支               → C1 红
//   M11 sw.js 复活 isDoc 不可达支                     → C1 红（fetchShell 计数 3）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { Renderer } from '../src/render/Renderer';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MountInstance } from '../src/entities/Mounts';
import { BuffType } from '../src/stats/Buffs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAN = path.join(ROOT, '..', 'Terarria1457');
const gameSrc = readFileSync(path.join(ROOT, 'src/core/Game.ts'), 'utf8');
const rendererSrc = readFileSync(path.join(ROOT, 'src/render/Renderer.ts'), 'utf8');
const swSrc = readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
const vanPlayer = readFileSync(path.join(VAN, 'Terraria/Player.cs'), 'utf8');
const vanMount = readFileSync(path.join(VAN, 'Terraria/Mount.cs'), 'utf8');
const vanMountId = readFileSync(path.join(VAN, 'Terraria.ID/MountID.cs'), 'utf8');

/** tryDismountMount 函数体切片（结构锁作用域——Game.ts 另有四处 TryEarlyDismount
 *  族 boolean 消费面（:6018/:15477/:30588/:40192 ≙ vanilla TryEarlyDismount
 *  :6697-6703 CanDismount boolean）不在本刀面,锁须限域）。 */
function tryDismountMountBody(): string {
  const i = gameSrc.indexOf('private tryDismountMount(): void {');
  expect(i).toBeGreaterThan(-1);
  return gameSrc.slice(i, gameSrc.indexOf('private playerNoSpaceTeleport', i));
}

type P = Player;

/** 干地世界：ground 行实心（cols 14-30）;ceil=true 时 rows 101-102 实心（头顶
 *  42px 净空不足 → 20×42 回盒探针失败=FailedNoSpace 判别力带,G13 判例
 *  「夹具初值巧合杀不死变异」对偶——空间面必须真探针可达/可败两面）。 */
function makeWorld(ceil: boolean, seed = 'bj704g17'): World {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 30; x++) {
    w.store.setTileSilent(x, 104, 1, 0, 0);
    w.store.setTileSilent(x, 105, 1, 0, 0);
    if (ceil) {
      w.store.setTileSilent(x, 101, 1, 0, 0);
      w.store.setTileSilent(x, 102, 1, 0, 0);
    }
  }
  return w;
}

/** 骑 55 大鼠（buff 374→RatMount,缩盒 14×14）+ 可选 Frozen（cced）+ 可选抚摸态 */
async function makeRider(ceil: boolean, opts: { cced?: boolean; petting?: boolean } = {}): Promise<P> {
  const p = new Player(21 * 16, 1664 - 42, new Inventory());
  (p as unknown as { lastStore: unknown }).lastStore = makeWorld(ceil).store;
  // setMount(55) 真实缩盒+data（buff=374,spawnDust=31）——:2478 MOUNT_PLAYER_SIZE
  p.mount.setMount(55, p as unknown as Parameters<MountInstance['setMount']>[1]);
  if (opts.cced) p.buffs.apply(BuffType.Frozen, 600);
  if (opts.petting) expect(p.petMount()).toBe(true);   // PetMount :13174——置 petting.mount 态
  return p;
}

/** 直调 Game.tryDismountMount（私有,运行时原型;fake-this 只供本函数读写的六面） */
async function pressR(p: P, count = 0) {
  const { Game } = await import('../src/core/Game');
  const proto = Game.prototype as unknown as Record<string, (this: unknown) => void>;
  const calls = { toast: 0, dust: 0, sfx: 0, tp: 0 };
  const fake = {
    player: p,
    mountNoSpaceCount: count,
    sfx: { play: () => { calls.sfx++; } },
    spawnParticles: () => { calls.dust++; },
    cb: { onToast: () => { calls.toast++; } },
    playerNoSpaceTeleport: () => { calls.tp++; },
  };
  proto.tryDismountMount.call(fake);
  return { calls, count: (fake as { mountNoSpaceCount: number }).mountNoSpaceCount };
}

// ---------------------------------------------------------------------------
// A. 件1 QuickMount FailedCCed 分道（Game.ts;vanilla Player.cs:6036-6066）
// ---------------------------------------------------------------------------
describe('BJ704-G17 A QuickMount FailedCCed 分道（:6043 只对 FailedNoSpace 计数）', () => {
  it('A1 FailedCCed（55 大鼠+Frozen）全静默:无尘/无 toast/无 sfx/不计数/不下坐/不停抚摸/不清 buff', async () => {
    const p = await makeRider(false, { cced: true, petting: true });
    p.buffs.apply(BuffType.RatMount, 60);
    const { calls, count } = await pressR(p, 0);
    expect(calls).toEqual({ toast: 0, dust: 0, sfx: 0, tp: 0 });   // M1 回合流形:toast/dust 误入=红
    expect(count).toBe(0);                                          // 不入 3 连计数
    expect(p.ridingMount).toBe(true);                               // 仍骑乘（未强制下坐）
    expect(p.buffs.has(BuffType.RatMount)).toBe(true);              // 伴生 buff 不清（Dismount 未跑）
    expect(p.petting.isPetting && p.petting.mount).toBe(true);      // M2 头位预停回潮=红（拒下坐拍停抚摸=幽灵失骑态）
  });

  it('A2 FailedCCed 连按 3 次仍静默:无强制下坐/无传送（旧 boolean 合流=第 3 拍强制+teleport）', async () => {
    const p = await makeRider(false, { cced: true });
    let last = { calls: { toast: 0, dust: 0, sfx: 0, tp: 0 }, count: 0 };
    for (let k = 0; k < 3; k++) last = await pressR(p, last.count);
    expect(last.calls.tp).toBe(0);                                  // M1:旧形第 3 拍 playerNoSpaceTeleport=红
    expect(last.count).toBe(0);
    expect(p.ridingMount).toBe(true);
    expect(p.w).toBe(14);                                           // 缩盒未回 20×42
  });

  it('A3 FailedNoSpace（头顶实心）失败拍:尘+toast+sfx+计数,但不(预)停抚摸（vanilla 停抚摸只在 Dismount 体内）', async () => {
    const p = await makeRider(true, { petting: true });             // ceil=true → 20×42 探针败
    const { calls, count } = await pressR(p, 0);
    expect(calls.dust).toBe(1);                                     // 失败 1/2 次=尘+Sound+toast（QuickMount :6050-6053）
    expect(calls.toast).toBe(1);
    expect(calls.sfx).toBe(1);
    expect(count).toBe(1);
    expect(p.ridingMount).toBe(true);                               // 仍在骑
    expect(p.petting.isPetting && p.petting.mount).toBe(true);      // M2:失败拍停抚摸=红
  });

  it('A4 FailedNoSpace 第 3 拍:强制下坐+传送+清 buff+停抚摸+计数清零（Dismount ignoreEffect 面）', async () => {
    const p = await makeRider(true, { petting: true });
    p.buffs.apply(BuffType.RatMount, 60);
    let st = await pressR(p, 0);
    st = await pressR(p, st.count);
    expect(st.count).toBe(2);
    const fin = await pressR(p, st.count);
    expect(fin.calls.tp).toBe(1);                                   // M6 撤 teleport=红
    expect(fin.count).toBe(0);
    expect(p.ridingMount).toBe(false);                              // 强制下坐
    expect(p.w).toBe(20);                                           // 回盒 20×42
    expect(p.buffs.has(BuffType.RatMount)).toBe(false);             // ClearBuff :6214
    expect(p.petting.isPetting).toBe(false);                        // StopPettingAnimal :6228-6231
  });

  it('A5 Succeeded:下坐+清 buff+停抚摸+计数清零,出生尘恰一次/无 toast/teleport（体内效果随闸收拢）', async () => {
    const p = await makeRider(false, { petting: true });
    p.buffs.apply(BuffType.RatMount, 60);
    const { calls, count } = await pressR(p, 2);                    // 预置 2=此前两次失败（计数清零判别）
    // ★BJ704-G18（G17 债3）锁随刀迁移：成功拍 = Dismount(ignoreEffect:false) →
    //  DoSpawnDust(isDismounting)——fake 无 spawnDust 走回退档恰一次 spawnParticles
    //  （旧断言 dust:0 锁的是债前零尘态,随 G18 转正翻为 1;typed 尘面在 G18 套件 B/C）
    expect(calls).toEqual({ toast: 0, dust: 1, sfx: 0, tp: 0 });
    expect(count).toBe(0);                                          // M5 撤清零=红（≙ UpdateFailedDismount :6033 !mount.Active 清零）
    expect(p.ridingMount).toBe(false);
    expect(p.w).toBe(20);
    expect(p.buffs.has(BuffType.RatMount)).toBe(false);             // M3 撤 buff 清偿=红
    expect(p.petting.isPetting).toBe(false);                        // M4 撤 petting 终止=红
  });

  it('A6 反编译锚:QuickMount :6043 !=FailedNoSpace→return;CanDismountWithResult CCed 首闸', () => {
    const i = vanPlayer.indexOf('mount.TryDismountWithResult(this) != Mount.DismountCheckResult.FailedNoSpace');
    expect(i).toBeGreaterThan(-1);
    expect(vanPlayer.slice(i, i + 120)).toContain('return;');
    const j = vanMount.indexOf('MountID.Sets.DontDismountWhenCCed[Type] && mountingPlayer.CCed');
    expect(j).toBeGreaterThan(-1);
    expect(vanMount.slice(j, j + 120)).toContain('FailedCCed');
    // 首闸序在空间探针前（CCed 判据先于 TryChangingSizeFromBottomCenter）
    expect(j).toBeLessThan(vanMount.indexOf('TryChangingSizeFromBottomCenter(mountingPlayer.Hitbox, 20, 42'));
  });

  it('A7 结构锁:tryDismountMount 三道消费（限域——Game.ts 另四处 TryEarlyDismount 族 boolean 面不受辖）', () => {
    const body = tryDismountMountBody();
    expect(body).toContain('const res = p.mount.canDismountWithResult(p);');
    expect(body).toContain("if (res === 'cced') return;");
    expect(body).toContain("if (res === 'ok') {");
    expect(body).not.toContain('p.mount.tryDismount(p))');          // 旧 boolean 合流形禁回潮（限域内）
    // petting 终止位随闸收拢:首个 stopPettingAnimal 在 buff 捕获【后】（旧头位预停形=前）
    expect(body.indexOf('stopPettingAnimal')).toBeGreaterThan(body.indexOf('prevBuffVanilla'));
  });
});

// ---------------------------------------------------------------------------
// B. 件2 legFrame 23/45/48（Renderer.ts;销案=已实现,判别锁防静默回退）
// ---------------------------------------------------------------------------
/** 直调 playerFrameRows（swing=null → useRow=-1;mnt 传真身 MountInstance） */
function frameRows(p: P, legArmorId = 0): { body: number; legs: number } {
  const proto = Renderer.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  return proto.playerFrameRows.call({} as Renderer, p, null, 0, p.mount, null, legArmorId) as {
    body: number; legs: number;
  };
}

describe('BJ704-G17 B 骑乘腿帧行覆写（Player.cs:36430-36443;销案+判别锁）', () => {
  it('B1 行值:23/45/48 → 0;普通坐骑（3 史莱姆/0 兔）→ 6;滚轴鞋 57 不覆写（落站立链 0）', async () => {
    const { Inventory: Inv } = await import('../src/items/Inventory');
    const mk = (type: number): P => {
      const p = new Player(336, 1622, new Inv());
      p.mount.active = true;
      p.mount.type = type;
      return p;
    };
    expect(frameRows(mk(23)).legs).toBe(0);      // 巫婆扫帚（M7 摘三元 → 6=红）
    expect(frameRows(mk(45)).legs).toBe(0);      // 惊悚木
    expect(frameRows(mk(48)).legs).toBe(0);      // 暗黑魔法书
    expect(frameRows(mk(3)).legs).toBe(6);       // 普通坐骑行 6（M8 摘骑乘支 → 0=红）
    expect(frameRows(mk(0)).legs).toBe(6);
    expect(frameRows(mk(57)).legs).toBe(0);      // DoesNotOverrideLegFrames{57-60} 落常规链（M9 撤门 → 6=红）
    expect(frameRows(mk(58)).legs).toBe(0);
    expect(frameRows(mk(60)).legs).toBe(0);
  });

  it('B2 骑矿车（ridingCart 支）同走行 6 基线（vanilla mount.Active 含 Cart;23/45/48 三态仍 0）', async () => {
    const { Inventory: Inv } = await import('../src/items/Inventory');
    const p = new Player(336, 1622, new Inv());
    p.ridingCart = true;
    p.mount.active = true;
    p.mount.type = 15;                                   // 矿车 mount id（Cart 集）
    expect(frameRows(p).legs).toBe(6);
    p.mount.type = 48;                                   // 暗黑魔法书骑乘（非 cart 态复用同支）
    p.ridingCart = false;
    expect(frameRows(p).legs).toBe(0);
  });

  it('B3 反编译锚:legFrame.Y=Height*6 基线 + type∈{23,45,48}→Y=0 + DoesNotOverrideLegFrames 门', () => {
    const i = vanPlayer.indexOf('legFrame.Y = legFrame.Height * 6');
    expect(i).toBeGreaterThan(-1);
    const block = vanPlayer.slice(i, i + 400);
    expect(block).toContain('mount.Type == 23 || mount.Type == 45 || mount.Type == 48');
    expect(block).toContain('reference.Y = 0');
    const g = vanPlayer.indexOf('if (!MountID.Sets.DoesNotOverrideLegFrames[mount.Type])');
    expect(g).toBeGreaterThan(-1);
    expect(vanPlayer.slice(g, i)).toContain('legFrameCounter = 0.0');   // 计数复位在盒内（仓储 swimPhase.delete 同承载）
    expect(vanMountId).toContain('DoesNotOverrideLegFrames = Factory.CreateBoolSet(57, 58, 59, 60)');
  });

  it('B4 结构锁:Renderer 三元 + 计数复位承载 + 销案判语注（防静默回退+防按旧登记重复落刀）', () => {
    expect(rendererSrc).toContain('legs = (mtype === 23 || mtype === 45 || mtype === 48) ? 0 : 6;');
    expect(rendererSrc).toContain('const noLegOverride = !!MOUNT_SETS.DoesNotOverrideLegFrames?.[mtype];');
    // G13 债6 → G17 销案判语注在位（BJ685 判例:分歧/翻案锁须带改判史防翻案）
    expect(rendererSrc).toContain('★BJ704-G17 销案');
  });
});

// ---------------------------------------------------------------------------
// C. 件3 sw.js 死支删除（G8 登记;字节面最小删除+锁随迁）
// ---------------------------------------------------------------------------
describe('BJ704-G17 C sw.js 死支删除（?? 双保险残形 + isDoc 不可达支）', () => {
  it('C1 删除锁:无 ?? fetchAsset/无 isDoc 残支;fetchShell 恰 2（shell+doc 活支）;裸 fetch 恒 4', () => {
    expect(swSrc).not.toContain('res ?? fetchAsset(req)');        // M10 复活死支=红
    expect(swSrc).not.toMatch(/const isDoc =/);                   // M11 复活不可达支=红
    expect((swSrc.match(/await fetchShell\(req\)/g) ?? []).length).toBe(2);
    expect((swSrc.match(/await fetchAsset\(/g) ?? []).length).toBe(6);
    expect((swSrc.match(/return fetchAsset\(req\)/g) ?? []).length).toBe(2);
    expect((swSrc.match(/\bfetch\(/g) ?? []).length).toBe(4);     // 两守卫体内（fetchShell×2+fetchAsset×2）
  });

  it('C2 活支等价锁:文档唯一承载=isDocPath 支（fetchShell+离线缓存回退在位）', () => {
    const i = swSrc.indexOf('if (isDocPath(req, path))');
    expect(i).toBeGreaterThan(-1);
    const branch = swSrc.slice(i, i + 700);
    expect(branch).toContain('await fetchShell(req)');
    expect(branch).toContain('cache.match(req, { ignoreVary: true })');
    expect(swSrc.indexOf('const isDocPath =')).toBeGreaterThan(-1);
    expect(swSrc).toContain("req.destination === 'document' || path === '/' || path.endsWith('.html')");
  });
});
