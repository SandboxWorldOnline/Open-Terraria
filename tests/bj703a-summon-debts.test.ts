// ★BJ703-A（2026-10-21）召唤族行为域登记债全面清算·五件——判别锁 + 反编译源锚：
//  D1 758 扑后 1-tick 过渡拍（BJ698 登记债①）：原版 AI_067 :50849-50860
//     `ai[0]==2 ∧ ai[1]<0 → friendly=false`（覆写 :50480 顶置真）+ :50942-50952
//     `ai[1] 归零 → -num9(-60)` 不复位 ai0（num9=60 唯 758>0,:50478-50483）⇒
//     每扑击周期 20 伤拍 + 1 零伤过渡拍;旧仓扑尽直回地面=多 1 拍伤。
//  D2 虎 833-835 ai0==1 归位飞行（BJ698 登记债②）：原版 :51171-51199 无目标
//     >500 ∨ |dy|>300 入态 + :50636-50712 tileCollide=false 直积分 + :50686-50688
//     <60px 特攻冷却即刷;friendly=true 恒开（:50485-50488）⇒ 飞行全拍接触伤
//     （BJ698 判语=非 ai0==4 全态可伤）。旧仓走回家近似=穿墙/高速归位面悬空。
//  D3 614 stuck 态（BJ698 登记债③）：原版命中转刺入 Damage_PVE_Inner :13244-13251
//     `aiStyle==113 ∧ ai[0]<2 → ai0=1/ai1=victim/vel=(敌心-心)×0.75`（先于 StatusNPC
//     :13634 ⇒ 183 gate ai1==i 读实际 victim）+ 首行 :12463 `type==614∧ai0==1` 拒
//     （stuck 贴附零接触伤）+ :41480 localAI[0]≥900 Kill + KillOldestJavelin
//     :14043-14054/_javelinsMax10（同玩家同靶 stuck≥10 → Kill 最老）。旧仓无此态
//     =穿透 -1 逐 10t 再咬（窗恒真）。
//  D4 946 城镇臂 tag 面（BJ684 登记债）：voodoo 放行后 :12947 tag ModifyHit 城镇
//     同跑——tHitTick 城镇 settle 收编 contactTown 同式全链。
//  D5 755 GetCollisionParams +6（BJ684 登记债）：:20107-20111 `type==755∧ai[0]>=0 →
//     col+6` 三调用面（HandleMovement :17697 tileCollide 门/UpdatePosition :20581
//     tileCollide 门/SwitchTiles :19974 (tileCollide|flag5) 门）对 755（SetDefaults
//     :7786 tileCollide=false + AI_156 零 tileCollide 写位 + ForcePlateDetection 无
//     755）恒不可达=死值,销案不移植（锚证）。
// 夹具纪律（BJ514/BJ634/BJ635/BJ696 判例）：真 World/真 Player/真盒重叠/直驱
// fixedUpdate;不可追敌（maxHp=3）=纯接触窗探针;类型手术直入态（bj698 §1e/§1f 先例）。
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MinionProj } from '../src/entities/MinionProj';
import { Arrow } from '../src/entities/Arrow';
import type { GameHooks } from '../src/entities/types';

const EXT_MISSING = !existsSync(new URL('../../Terarria1457', import.meta.url));
const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457', 'Terraria');

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp?: number; vanillaId?: number;
  iframes?: number; dontTakeDamage?: boolean;
  hurt: (d: number, ...rest: unknown[]) => boolean;
  hits: number[];
  stardustT?: number;
}
const mkEnemy = (id: number, cx: number, cy: number, w = 60, h = 60): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy,
    hp: 100000, maxHp: 100000, vanillaId: 48, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};
/** 不可追敌（maxHp=3 ≤ 5 → canBeChasedBy false）：索敌面全灭,唯接触窗可观测 */
const mkUnchaseable = (id: number, cx: number, cy: number, w = 60, h = 60): MockEnemy => {
  const e = mkEnemy(id, cx, cy, w, h);
  e.maxHp = 3;
  return e;
};

function makeHooks(enemies: MockEnemy[] = [], npcs: unknown[] = []) {
  const w = new World(200, 120, 7, 'bj703a');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => npcs,
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown) => void } }).entities = {
    projectiles: added,
    add: (e: unknown) => { added.push(e); },
  };
  return { hooks, player, added, world: w };
}

let seq = 0;
const minion = (player: Player, hooks: GameHooks, cx: number, cy: number,
  projId: number, damage = 20): MinionProj => {
  const m = new MinionProj(cx, cy, projId, damage, 2, false, 0, false, () => player);
  m.id = ++seq;
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
  (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
  return m;
};
const overlap = (m: { x: number; y: number; w: number; h: number }, e: MockEnemy): void => {
  m.x = e.cx - m.w / 2; m.y = e.cy - m.h / 2;
};
const S = (m: unknown) => m as unknown as Record<string, number | boolean>;

// ============================================================
// §0 反编译源锚（读错/漂移即红——D1/D2/D3/D5 定谳链）
// ============================================================
describe.skipIf(EXT_MISSING)('§0 原版锚：过渡拍/归位门/转刺入/死值面', () => {
  const van = readFileSync(join(VAN, 'Projectile.cs'), 'utf8');
  const pid = readFileSync(join(VAN, '..', 'Terraria.ID', 'ProjectileID.cs'), 'utf8');

  it('D1：过渡拍块逐句（:50849-50860 friendly=false + :50951 ai[1]=-num9）', () => {
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    expect(fn).toContain('if (ai[0] == 2f && ai[1] < 0f)');
    expect(fn).toContain('friendly = false;\n\t\t\tai[1]++;');
    expect(fn).toContain('ai[1] = -num9;');
    // num9=60 唯 flag2(758) 置位 → 过渡拍=758 专属（393-395/951/1022 族 num9=0 直复 0）
    expect(van.match(/num9 = 60;/g)).toHaveLength(1);
    expect(fn).toContain('num10 = 20;\n\t\t\tnum9 = 60;');
  });

  it('D2：归位门/冷却即刷（:51193 ai[0]=1 + :50686-50688 num22=60 localAI[0]=0）', () => {
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    expect(fn).toContain('vector8.Length() > num3 || Math.Abs(vector8.Y) > num4');
    expect(fn).toContain('if (flag18)\n\t\t\t{\n\t\t\t\tai[0] = 1f;');
    expect(fn).toContain('int num22 = 60;');
    expect(fn).toContain('localAI[0] = 0f;');
  });

  it('D3：转刺入/首行拒/900 窗（:13244-13251/:12463/:41480）', () => {
    expect(van).toContain('if (aiStyle == 113 && ai[0] < 2f)');
    expect(van).toContain('velocity = (targetNPC.Center - base.Center) * 0.75f;');
    expect(van).toContain('(type == 598 || type == 636 || type == 614 || type == 971 || type == 975 || type == 1024) && ai[0] == 1f');
    expect(van).toContain('else if (localAI[0] >= (float)(60 * num11))');
    expect(van).toContain('KillOldestJavelin(whoAmI, type, victimIndex, bufferForScan);');
  });

  it('D5：+6 死值三调用面锚（755 tileCollide=false + ForcePlateDetection 无 755）', () => {
    expect(van).toContain('else if (type == 755 && ai[0] >= 0f)');
    expect(van).toContain('colWidth = width + 6;');
    const sd = van.slice(van.indexOf('else if (type == 755)'), van.indexOf('else if (type == 756)'));
    expect(sd).toContain('tileCollide = false;');            // SetDefaults :7786
    // HandleMovement/UpdatePosition 两调用面均 tileCollide 门内;SwitchTiles 门 =
    // (tileCollide | flag5)——flag5=ForcePlateDetection[type].Value,755 不在集合
    expect(van).toContain('(tileCollide | flag5) && position != oldPosition)');
    expect(van).toContain('GetCollisionParams(out var resizeAnchor2, out var colWidth2, out var colHeight2);');
    const fp = pid.slice(pid.indexOf('ForcePlateDetection'), pid.indexOf('TrailingMode'));
    expect(fp).not.toContain('(short)755,');
  });
});

// ============================================================
// §1 D1 758 扑后 1-tick 过渡拍（行为锁：-60 翻转/零伤/位移照跑）
// ============================================================
describe('§1 758 过渡拍（:50849-50860）', () => {
  it('扑尽拍 ai[1]→-60 不复位 ai0（:50942-50952;旧直复 0/0 恰红）', () => {
    const en = mkUnchaseable(1, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 758);
    overlap(m, en);
    S(m).frA0 = 2; S(m).frA1 = 1;                    // 扑击末拍直入
    m.fixedUpdate(1, hooks);
    expect(en.hits).toHaveLength(1);                  // 末拍照常伤（friendly=true）
    expect(S(m).frA1).toBe(-60);                      // num9=60（旧 frA1=0 恰红）
    expect(S(m).frA0).toBe(2);                        // ai0 保持（旧 =0 恰红）
  });

  it('过渡拍零接触伤 + 状态复位 + 位移照跑（:50851 friendly=false;旧路径直落地面拍必红）', () => {
    const en = mkUnchaseable(2, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 758);
    overlap(m, en);
    S(m).frA0 = 2; S(m).frA1 = -60;                  // 过渡拍直入（:50849 支）
    m.vx = 3;
    const x0 = m.x;
    m.fixedUpdate(1, hooks);
    expect(en.hits).toHaveLength(0);                  // ★主判别：过渡拍零伤（旧路径 contact → 1 恰红）
    expect(S(m).frA0).toBe(0);                        // :50855-50858 复位
    expect(S(m).frA1).toBe(0);
    expect(m.x - x0).toBeCloseTo(3, 5);               // UpdatePosition velocity 原样积分
  });

  it('地面拍对照可伤（防矫枉过正——过渡拍门不外溢）', () => {
    const en = mkUnchaseable(3, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 758);
    overlap(m, en);
    m.fixedUpdate(1, hooks);
    expect(en.hits).toHaveLength(1);
  });
});

// ============================================================
// §2 D2 虎 833-835 ai0==1 归位飞行（行为锁：门/穿墙/冷却即刷/接触）
// ============================================================
describe('§2 虎归位飞行（:51171-51199/:50636-50712）', () => {
  it('归位门：无目标 ∧ >500px → ai0=1（:51193;旧走回家近似永不入态恰红）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, player.cx + 600, player.cy, 833);
    S(m).pounceCd = 1000;                            // 摘 818 特攻门
    m.fixedUpdate(1, hooks);
    expect(S(m).tigerA0).toBe(1);                    // ★主判别（旧恒 0 恰红）
  });

  it('归位飞行接触窗 + tileCollide=false（friendly=true 全态,BJ698 判语面）', () => {
    const en = mkUnchaseable(4, 60 * 16 + 300, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 833);
    overlap(m, en);
    S(m).pounceCd = 1000;
    S(m).tigerA0 = 1;                                // 归位态直入（dl=300>200 不落地）
    m.fixedUpdate(1, hooks);
    expect(en.hits).toHaveLength(1);                 // 飞行拍接触伤
    expect(m.tileCollide).toBe(false);               // :50648
  });

  it('飞行穿墙归位（tileCollide=false 直积分;旧走回家被墙挡恰红）', () => {
    const { hooks, player, world } = makeHooks([]);
    for (let y = 80; y < 100; y++) world.store.setTile(80, y, 1);   // 天落地墙（20 格高）
    const m = minion(player, hooks, player.cx + 600, player.cy, 833);
    S(m).pounceCd = 1000;
    S(m).tigerA0 = 1;
    for (let t = 0; t < 80; t++) m.fixedUpdate(1, hooks);
    expect(m.cx).toBeLessThan(80 * 16);              // 已穿墙到玩家侧（旧 walk 恒 >墙 恰红）
    expect(m.cx).toBeGreaterThan(player.cx - 300);
  });

  it('<60px 特攻冷却即刷 + 落地回 0（:50686-50688 num22=60/:50666-50674）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, player.cx + 50, player.cy, 833);
    S(m).pounceCd = 100;
    S(m).tigerA0 = 1;
    m.fixedUpdate(1, hooks);
    expect(S(m).pounceCd).toBe(0);                   // localAI[0]=0（旧无此面恒 99 恰红）
    expect(S(m).tigerA0).toBe(0);                    // 落地复位
  });
});

// ============================================================
// §3 D3 614 stuck 态（Arrow 域——转刺入/零接触/贴附/靶亡/10 帽）
// ============================================================
describe('§3 614 stuck 态（:13244-13251/:12463/:41393-41518）', () => {
  const mk614 = (hooks: GameHooks, x: number, y: number, tgtId: number, vx = 0, vy = 0): Arrow => {
    const a = new Arrow(x, y, vx, vy, 30, 0, 614, { grav: 0, life: 300 });
    a.stickerTgt = tgtId;
    a.alpha = 255;
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(a);
    return a;
  };

  it('首受理命中转刺入：ai0=1/ai1=victim/vel=(敌心-心)×0.75 + 183 上实弹靶（:13244-13251 先于 :13634）', () => {
    const en = mkEnemy(1, 60 * 16, 90 * 16, 40, 40);
    const { hooks } = makeHooks([en]);
    const a = mk614(hooks, en.cx - 8 - 8, en.cy - 8, en.id);   // 盒叠敌（16×16 弹）
    a.fixedUpdate(1 / 60, hooks);
    expect(en.hits).toHaveLength(1);                 // 首拍伤
    expect(S(a).stickerA0).toBe(1);                  // 转刺入（旧恒 0 恰红）
    expect(a.stickerTgt).toBe(en.id);
    expect(en.stardustT).toBe(15);                   // 183×900t=15s 上实弹 victim（R7-19 勘误面）
    expect(a.dead).toBe(false);                      // penetrate=-1 存续
    // vel=(敌心-弹心)×0.75（:13248）——环位（位移积分后）直算,贴附偏移向量入位
    expect(a.vx).toBeCloseTo((en.cx - a.cx) * 0.75, 5);
  });

  it('stuck 态零接触伤：30 拍盒叠不再咬（:12463 首行拒;旧逐拍再咬恰红）', () => {
    const en = mkEnemy(2, 60 * 16, 90 * 16, 40, 40);
    const { hooks } = makeHooks([en]);
    const a = mk614(hooks, en.cx - 16, en.cy - 8, en.id);
    a.fixedUpdate(1 / 60, hooks);                    // 首拍：伤+转刺入
    expect(en.hits).toHaveLength(1);
    for (let t = 0; t < 30; t++) a.fixedUpdate(1 / 60, hooks);
    expect(en.hits).toHaveLength(1);                 // ★主判别：stuck 期恒 1（旧路径无 iframes mock 逐拍咬 → 31 恰红）
    expect(S(a).stickerA0).toBe(1);
  });

  it('stuck 贴附净位=敌心−velocity（:41490 Center=敌心−vel×2 + UpdatePosition +vel）', () => {
    const en = mkEnemy(3, 60 * 16, 90 * 16, 40, 40);
    const { hooks } = makeHooks([en]);
    const a = mk614(hooks, en.cx, en.cy, en.id);
    S(a).stickerA0 = 1;
    a.vx = 4; a.vy = 0;                              // 贴附偏移向量
    a.fixedUpdate(1 / 60, hooks);
    expect(a.cx).toBeCloseTo(en.cx - 4, 5);          // 净位（仅写 vel×2 无位移积分=偏 4px 恰红）
    expect(a.cy).toBeCloseTo(en.cy, 5);
  });

  it('stuck 靶亡即杀（:41497-41517）', () => {
    const en = mkEnemy(4, 60 * 16, 90 * 16, 40, 40);
    const { hooks } = makeHooks([en]);
    const a = mk614(hooks, en.cx, en.cy, en.id);
    S(a).stickerA0 = 1;
    en.dead = true;
    a.fixedUpdate(1 / 60, hooks);
    expect(a.dead).toBe(true);
  });

  it('KillOldestJavelin 10 帽：同靶 stuck≥10 → Kill 剩余 life 最小者（:14043-14054/_javelinsMax10）', () => {
    const en = mkEnemy(5, 60 * 16, 90 * 16, 40, 40);
    const { hooks } = makeHooks([en]);
    const olds: Arrow[] = [];
    for (let i = 0; i < 10; i++) {
      const o = mk614(hooks, en.cx + 30 + i, en.cy, en.id);
      S(o).stickerA0 = 1;                            // 既有 stuck 弹
      o.life = 100 + i;                              // life=100 最老（timeLeft 最低）
      olds.push(o);
    }
    const fresh = mk614(hooks, en.cx - 16, en.cy - 8, en.id);
    fresh.fixedUpdate(1 / 60, hooks);                // 第 11 枚命中 → 帽触发
    expect(en.hits).toHaveLength(1);
    expect(olds[0].dead).toBe(true);                 // life=100 最老被杀（旧无帽全存活恰红）
    for (let i = 1; i < 10; i++) expect(olds[i].dead).toBe(false);
    expect(fresh.dead).toBe(false);                  // 受保护弹（i != protected）
  });
});

// ============================================================
// §4 D4 946 城镇臂 tag 面（voodoo 放行拍——tag 乘区/darkHarvest/受理梯）
// ============================================================
describe('§4 946 城镇臂 tag 面（:12947 城镇同链）', () => {
  interface TownCall { d: number; crit: boolean; fromPlayer: boolean }
  const mkTown = (id: number, cx: number, cy: number): {
    n: { id: number; x: number; y: number; w: number; h: number; dead: boolean;
      vanillaId: number; bound?: boolean; iframes?: number; cx: number; cy: number;
      hurt: (...a: unknown[]) => boolean };
    calls: TownCall[];
  } => {
    const calls: TownCall[] = [];
    const n = {
      id, x: cx - 12, y: cy - 24, w: 24, h: 48, dead: false, vanillaId: 22, cx, cy,   // 向导 22
      hurt: (...a: unknown[]) => { calls.push({ d: a[0] as number, crit: a[6] as boolean, fromPlayer: a[8] as boolean }); return true; },
    };
    return { n, calls };
  };

  it('voodoo 放行拍：tag +3 透传城镇臂（6+3=9;旧无 tag 链 =6 恰红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    // 攻击目标=真敌（AI_156 索敌域=敌怪;城镇臂=Damage_PVE 顺路受害面,原版同构）
    const en = mkEnemy(1, 60 * 16, 90 * 16, 90, 90);
    const { n, calls } = mkTown(2, 60 * 16, 90 * 16);
    const { hooks, player } = makeHooks([en], [n]);
    // 向导巫毒娃娃位：equipStats 为 getter 聚合体——原型链 stub + defineProperty
    // 覆写该槽（其余面经 ownerRef 仍走真 Player）
    const dollPlayer = Object.create(player) as Player;
    Object.defineProperty(dollPlayer, 'equipStats', {
      value: Object.assign({}, player.equipStats, { killGuide: true }),
    });
    (hooks as unknown as { player: Player }).player = dollPlayer;
    const t = minion(player, hooks, player.cx, player.cy, 946, 6);
    player.tagEffectStack.tryApplyTagToNPC(5688, n.id, 0, 0);   // 皮革鞭 tag +3 零 proc 零 crit
    S(t).tA0 = 80; S(t).tA1 = en.id;                // 攻击段直入（bj684 §2 夹具勘误同式）
    t.fixedUpdate(1, hooks);
    expect(calls.map((c) => c.d)).toEqual([9]);     // ★主判别：tag 乘区透传（旧 [6] 恰红）
    expect(calls[0].fromPlayer).toBe(true);
    expect(calls[0].crit).toBe(false);
  });

  it('窄门对照：无 doll 城镇靶零受理（voodoo :11970-11976 既有面防矫枉过正）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const en = mkEnemy(1, 60 * 16, 90 * 16, 90, 90);
    const { n, calls } = mkTown(2, 60 * 16, 90 * 16);
    const { hooks, player } = makeHooks([en], [n]);   // 无 killGuide
    const t = minion(player, hooks, player.cx, player.cy, 946, 6);
    player.tagEffectStack.tryApplyTagToNPC(5688, n.id, 0, 0);
    S(t).tA0 = 80; S(t).tA1 = en.id;
    t.fixedUpdate(1, hooks);
    expect(calls).toHaveLength(0);                  // 巫毒窄门拒
  });

  it('结构锁：tHitTick 城镇 settle 全链在位（resolveWhipTagHit/townAcceptLadder/darkHarvestChain）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    const i = src.indexOf('private tHitTick(');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('private tIdleSpot('));
    expect(block).toContain('resolveWhipTagHit');                       // M1 变异位：摘 tag 链恰红
    expect(block).toContain('SUMMON_TAG_MUL[this.projId] ?? 1');
    expect(block).toContain('this.townAcceptLadder(game, n, true)');   // StatusNPC+命中视效+清窗
    expect(block).toContain('darkHarvestChain');                        // 916 链电（OnHit :13711 位）
    expect(block).toContain('this.attackFlash = 24');
    expect(block).toContain('kbDir * (this.knockback + mkb)');          // 裸kb+minionKB（:52477）
  });
});

// ============================================================
// §5 结构锁（D1/D2 源锚——防静默回退）
// ============================================================
describe('§5 源码结构锁', () => {
  it('D1：frogStep 过渡拍支在位（frA1<0 门 + -60 翻转 + 零 contact return）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    const i = src.indexOf('private frogStep(');
    const block = src.slice(i, src.indexOf('private frogFrameTick('));
    expect(block).toContain('if (this.frA1 < 0) {');
    expect(block).toContain('this.frA1 = -60;');
    const trans = block.slice(block.indexOf('BJ703-D1'), block.indexOf('this.frA1--;'));
    expect(trans).toContain('return;');              // 过渡拍零帧推/零 contact
  });

  it('D2：tigerBody 归位支在位（ai0==1 门 + tileCollide=false + pounceCd 即刷）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    const i = src.indexOf('private tigerBody(');
    const block = src.slice(i, src.indexOf('private tigerSpecialAttack('));
    expect(block).toContain('if (this.tigerA0 === 1) {');
    expect(block).toContain('this.tigerA0 = 1;');
    expect(block).toContain('this.pounceCd = 0;');
    expect(block).toContain('this.contact(game, dmg0 * scale, 10);');
  });

  it('D3：Arrow 614 转刺入 + stuck 支在位', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'Arrow.ts'), 'utf8');
    expect(src).toContain('if (this.projId === 614 && this.stickerA0 < 2) {');
    expect(src).toContain('this.stickerA0 = 1;');
    expect(src).toContain('this.killOldestJavelin614(game, e.id);');
    expect(src).toContain('if (this.stickerA0 === 1) {');
    expect(src).toContain('this.stuckT614 >= 900');
  });
});
