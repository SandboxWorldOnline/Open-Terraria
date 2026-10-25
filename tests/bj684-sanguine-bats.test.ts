// ★BJ684（2026-10-15）：血红法杖 4269 → 弹 755 SanguineBat（BatOfLight）三实报 +
// 魔眼法杖 388 痉挛眼冲刺零伤（第五面追加）判别锁。
//  病灶定谳（反编译 Terarria1457 亲读锚）：
//   ①「叠成一团」：batOfLightBody 调 tGroup(game) 缺省 pid=946 → 755 恒空组 →
//     fallback {0,1} → 全部蝙蝠 θ=0 同点。原版 = AI_GetMyGroupIndexAndFillBlackList
//     （Projectile.cs:52809-52825 按型计数）+ AI_156_GetIdlePosition 755 支
//     （:52830-52837 θ=4.3982296/total×(idx−mid),r=40 头顶弧列）。
//   ②「吃不到鞭 tag 伤害」：bHitTick/tHitTick 直 hurt 漏 resolveWhipTagHit——原版
//     tag 伤在 Damage_PVE_Inner :12947-12961 集中施加,对一切随从弹生效。SUMMON_TAG_MUL
//     755/946 均无表项=1（原版 CreateFloatSet(1f, 864f, 0.669f) 唯一特例 864,ProjectileID.cs:37）。
//   ③「贴图不对」主凶 = MINION_FRAMES[755] 旧 [6,5,0] 显示原版永不显示的帧 4
//     （贴图实测 76px 8×12 小团残片;原版 `++frame >= projFrames-1`（:52431-52438,
//     projFrames[755]=5 Main.cs:8644）→ 循环 0-3）;副凶 = facing 恒 1 零写位
//     （原版每拍 spriteDirection = velocity.X≠0 ? sign : player.direction,:52446-52451）。
//   ④ 攻击时长常数：755 分支只重赋 num=66（num2 保持 59!）——旧「num2=65/num3=126」
//     系把 946 的分支内重算模式误植（:52494-52506）。起手 ai[0]=66、减速门 59、
//     lerp GetLerpValue(59,0,ai[0])。
//   ⑤ 388 冲刺零伤：twinsStep 冲刺支循环尾 return 早退+零 contact——原版伤害走
//     Damage() 每子步（extraUpdates=1 :30156,40 子步持续接触;idStatic 12 表既有）。
//   ⑥（连坐）755 盒注册缺（SetDefaults 10×10 :7781-7782,旧落 16×16 缺省）。
//  ★变异自证锚：各断言注「旧值恰红」——M1 tGroup pid 摘除/M2 resolveWhipTagHit
//  摘除/M3 帧表回 [6,5,0] 或 facing 摘除/M4 num2 回 65/M5 冲刺 contact 摘除。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MinionProj } from '../src/entities/MinionProj';
import type { GameHooks } from '../src/entities/types';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457', 'Terraria');

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp?: number; boss?: boolean;
  vx?: number; vy?: number;
  calls: { d: number; kb: number; crit: boolean }[];
  hurt: (d: number, kb?: number, kDir?: number, g?: GameHooks, pen?: number, crit?: boolean) => boolean;
}
/** 真敌盒夹具（BJ634 判例防「夹具喂幻影」:maxHp=100000 过 canBeChasedBy lifeMax>5 门） */
const mkEnemy = (id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy,
    hp: 100000, maxHp: 100000, calls: [],
    hurt: (d, kb = 0, _kd?, _g?, _pen?, crit = false) => {
      e.hp -= d; e.calls.push({ d, kb, crit }); return true;
    },
  };
  return e;
};

function makeHooks(enemies: MockEnemy[] = []) {
  const w = new World(200, 120, 7, 'bj684');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
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
  return { hooks, store: w.store, player };
}

let seq = 0;
const bat = (player: Player, hooks: GameHooks, cx: number, cy: number,
  projId = 755, damage = 6): MinionProj => {
  const m = new MinionProj(cx, cy, projId, damage, 0, false, 0, false, () => player);
  m.id = ++seq;                        // Entities.nextId++ 模拟（tGroup 序依赖）
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
  (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
  return m;
};
const P = (m: MinionProj) => m as unknown as {
  bA0: number; bA1: number; bSX: number; bSY: number; tA0: number; tA1: number; twA0: number; twA1: number;
};

afterEach(() => { vi.restoreAllMocks(); });

// ============================================================
// §1 编队弧列（病灶①:pid=755——旧缺省 946 恒空组=三只同点恰红）
// ============================================================
describe('§1 755 编队头顶弧列（AI_156_GetIdlePosition :52830-52837）', () => {
  it('三蝙蝠 idle x 互异（θ 展开 ±39.8/0;旧 tGroup(game) 缺省 946 → 三只同点恰红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 压 1/20 起手 roll（floor(19.8)≠0）
    const { hooks, player } = makeHooks();
    const bats = [bat(player, hooks, player.cx, player.cy),
      bat(player, hooks, player.cx, player.cy),
      bat(player, hooks, player.cx, player.cy)];
    for (let t = 0; t < 200; t++) for (const b of bats) b.fixedUpdate(1, hooks);
    const xs = bats.map((b) => b.cx).sort((a, b) => a - b);
    // θ=±4.398/3×1=±1.466 → x=player.cx±sin(1.466)×40≈±39.8;旧实现三只全叠 θ=0 点
    expect(xs[2] - xs[0]).toBeGreaterThan(70);        // ★主判别:弧总宽（旧 ≈0 恰红）
    expect(Math.abs(xs[1] - xs[0])).toBeGreaterThan(25);
    expect(Math.abs(xs[2] - xs[1])).toBeGreaterThan(25);
    // 中位蝙蝠 θ=0 → 正上方（|Δx|<5,侧向仅 sinθ 摆出）
    expect(Math.abs(xs[1] - player.cx)).toBeLessThan(5);
  });

  it('源码锚:tGroup 调用带 pid=755（M1 变异位:摘 755 参数恰红）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    const i = src.indexOf('private batOfLightBody(');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('private bHitTick('));
    expect(block).toContain('this.tGroup(game, 755)');
    // 反编译锚:755 待机支按型计数 + 弧列常数
    const van = readFileSync(join(VAN, 'Projectile.cs'), 'utf8');
    const j = van.indexOf('private void AI_156_GetIdlePosition');
    const vblock = van.slice(j, van.indexOf('private void AI_155_MysticSnakeCoil()'));
    expect(vblock).toContain('4.3982296f');            // θ 基角
    expect(vblock).toContain('* 40f');                 // 弧半径 40
    // 按型计数调用在 AI_156_Think 待机支（:52538）
    const think = van.slice(van.indexOf('private void AI_156_Think('), j);
    expect(think).toContain('AI_GetMyGroupIndexAndFillBlackList');
  });
});

// ============================================================
// §2 鞭 tag 伤害（病灶②:ai156Strike 接 resolveWhipTagHit——旧直 hurt 恰红）
// ============================================================
describe('§2 AI_156 族体触鞭 tag（Damage_PVE_Inner :12947-12961）', () => {
  it('755 蝙蝠命中带 tag 敌:伤害含 tagDamage（5688=+3;旧直 hurt =6 恰红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（ai156Strike/contact 面首掷 ×1.0）;
    const en = mkEnemy(1, 60 * 16, 90 * 16 - 30);
    const { hooks, player } = makeHooks([en]);
    const b = bat(player, hooks, en.cx, en.cy);       // 盒叠敌
    player.tagEffectStack.tryApplyTagToNPC(5688, en.id, 0, 0);   // 皮革鞭 tag +3,零 proc 零 crit
    // ★BJ698 夹具勘误：755 待机拍（ai[0]==0）被 projPet 门拒伤（Projectile.cs:12495
    //  `(type != 755 || ai[0] == 0f)`——唯 ai[0]≠0 攻击段放行）,旧 idle 拍直结=锁了
    //  错窗。改经类型手术直入攻击段（bA0=66 减速段拍,速度 0 位不移=盒仍叠敌）。
    P(b).bA0 = 66; P(b).bA1 = en.id;
    b.fixedUpdate(1, hooks);                          // 攻击减速段拍 bHitTick 即结算
    expect(en.calls.map((c) => c.d)).toEqual([9]);    // 6+3（M2:摘 resolveWhipTagHit → [6] 恰红）
    expect(en.calls[0].crit).toBe(false);
  });

  it('755 无 tag 基线 =6（差分对照,tag 面不虚增）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（ai156Strike/contact 面首掷 ×1.0）;
    const en = mkEnemy(1, 60 * 16, 90 * 16 - 30);
    const { hooks, player } = makeHooks([en]);
    const b = bat(player, hooks, en.cx, en.cy);
    P(b).bA0 = 66; P(b).bA1 = en.id;                  // ★BJ698 攻击段拍（同上,窗=ai0≠0）
    b.fixedUpdate(1, hooks);
    expect(en.calls.map((c) => c.d)).toEqual([6]);
  });

  it('946 棱镜同锁:tHitTick 亦吃 tag（旧直 hurt =6 恰红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档;
    // ★BJ698 夹具勘误：946 待机拍（ai[0]==0）同被 projPet 门拒（:12495 `(type != 946
    //  || ai[0] == 0f)`）——改直入攻击段（tA0=80 跃空首拍,起点=出生位=玩家心,
    //  lerp2=0 位不移）。用大盒敌罩住出生位（盒大小不影响 dmg0）。
    const en = mkEnemy(1, 60 * 16, 90 * 16, 90, 90);
    const { hooks, player } = makeHooks([en]);
    const t = bat(player, hooks, player.cx, player.cy, 946);  // terraprismaAI 首拍 tInit 设盒 7×7
    player.tagEffectStack.tryApplyTagToNPC(5688, en.id, 0, 0);
    P(t).tA0 = 80; P(t).tA1 = en.id;
    t.fixedUpdate(1, hooks);                          // 攻击跃空首拍 tHitTick
    expect(en.calls.map((c) => c.d)).toEqual([9]);    // （M2 连坐:946 同摘 → [6] 恰红）
  });

  it('源码锚:bHitTick/tHitTick 结算体走 ai156Strike（M2 变异位）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    const b = src.indexOf('private bHitTick(');
    expect(src.slice(b, b + 1200)).toContain('ai156Strike(game, en, dmg0)');
    const t = src.indexOf('private tHitTick(');
    expect(src.slice(t, t + 1400)).toContain('ai156Strike(game, en, dmg0)');
    // ai156Strike 内主链:tag 解析 + 乘子缺省 1（755/946 无表项,原版唯一特例 864=0.669）
    const s = src.indexOf('private ai156Strike(');
    const sblock = src.slice(s, src.indexOf('private abigailBody('));
    expect(sblock).toContain('resolveWhipTagHit');
    expect(sblock).toContain('SUMMON_TAG_MUL[this.projId] ?? 1');
    expect(sblock).toContain('applyBannerDamageDealt');
    expect(sblock).toContain('rollGolemSentryCrit');
    const wt = readFileSync(join(GAME, 'src', 'entities', 'WhipTag.ts'), 'utf8');
    expect(wt).toContain('SUMMON_TAG_MUL: Record<number, number> = { 864: 0.669 }');
  });
});

// ============================================================
// §3 贴图面（病灶③:facing 写位 + 帧表 4 帧循环——旧恒朝右/显示小团帧恰红）
// ============================================================
describe('§3 755 贴图面（spriteDirection :52446-52451 / 帧机 :52431-52438）', () => {
  it('待机 vx=0 → facing=player.facing（:52450 else 支;旧零写位恒 1 恰红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { hooks, player } = makeHooks();
    player.facing = -1;
    const b = bat(player, hooks, player.cx, player.cy - 40);
    b.fixedUpdate(1, hooks);
    expect(b.facing).toBe(-1);                        // ★主判别（旧恒 1 恰红）
  });

  it('velocity.X≠0 → facing=sign(vx)（:52448-52449 支）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const en = mkEnemy(1, 60 * 16 - 200, 90 * 16);
    const { hooks, player } = makeHooks([en]);
    const b = bat(player, hooks, player.cx, player.cy);
    b.vx = -8;                                        // 左飞
    b.fixedUpdate(1, hooks);
    expect(b.facing).toBe(-1);                        // 旧恒 1 恰红
  });

  it('帧表源锚:MINION_FRAMES[755]=[6,4,0] + 反编译 4 帧循环 + NO_FLIP 无 755（M3 变异位）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    expect(src).toContain('755: [6, 4, 0]');          // 旧 [6, 5, 0] = 显示帧 4 小团残片恰红
    // 反编译锚:projFrames[755]=5 + 帧机 `++frame >= projFrames-1` → 循环域 0-3
    const van = readFileSync(join(VAN, 'Projectile.cs'), 'utf8');
    const i = van.indexOf('private void AI_156_BatOfLight()');
    const block = van.slice(i, van.indexOf('private void AI_156_Think('));
    expect(block).toContain('if (++frame >= Main.projFrames[type] - 1)');
    expect(block).toContain('spriteDirection = num2');                    // 每拍朝向写位
    const main = readFileSync(join(VAN, 'Main.cs'), 'utf8');
    expect(main).toContain('projFrames[755] = 5;');
    // 翻转面:755 不在 MINION_NO_FLIP（draw 侧按 facing 翻转在位）
    const nf = src.indexOf('const MINION_NO_FLIP');
    expect(src.slice(nf, src.indexOf(';', src.indexOf('1096', nf)) + 1)).not.toContain('755');
    // 本仓朝向写位源锚（batOfLightBody 块内）
    const b = src.indexOf('private batOfLightBody(');
    expect(src.slice(b, src.indexOf('private bHitTick('))).toContain(
      'this.facing = this.vx !== 0 ? (this.vx > 0 ? 1 : -1) : p.facing');
  });
});

// ============================================================
// §4 攻击时长常数（病灶④:755 分支只重赋 num=66,num2 保持 59——旧 65 恰红）
// ============================================================
describe('§4 755 攻击状态机常数（:52494-52506/:52577-52647）', () => {
  it('起手 bA0=66（非 126——num3=120 系 946 域死值,755 零消费）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);      // 1/20 roll 恒中
    const en = mkEnemy(1, 60 * 16 + 100, 90 * 16);
    const { hooks, player } = makeHooks([en]);
    const b = bat(player, hooks, player.cx, player.cy);
    b.fixedUpdate(1, hooks);                          // idle 拍 roll→StartAttack
    expect(P(b).bA0).toBe(66);                        // ★任务书「126」勘误:反编译 =66
    expect(P(b).bA1).toBe(en.id);
  });

  it('减速段门=59:起手后 bA0∈[60,65] 均处减速段（位置不动;旧门 65 → bA0=64 已弧段位移恰红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const en = mkEnemy(1, 60 * 16 + 100, 90 * 16);
    const { hooks, player } = makeHooks([en]);
    const b = bat(player, hooks, player.cx, player.cy);
    b.fixedUpdate(1, hooks);                          // bA0=66
    const startX = b.cx;
    for (let t = 0; t < 5; t++) b.fixedUpdate(1, hooks);   // bA0: 65→61（旧实现 65 门→64 起弧段）
    expect(P(b).bA0).toBe(61);
    // 减速段 velocity×0.8（vx=0 → 位移 0）:x 仍在起点;旧实现 bA0=64/63/62/61 已弧段
    // 逐拍重写 Center（敌-起点中点方向 ≈50px 位移）恰红
    expect(Math.abs(b.cx - startX)).toBeLessThan(2);
  });

  it('源码锚:num=66/num2=59 + lerp 分母 59（M4 变异位:回 65 恰红）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    const i = src.indexOf('private batOfLightBody(');
    const block = src.slice(i, src.indexOf('private bHitTick('));
    expect(block).toContain('const num = 66, num2 = 59;');
    expect(block).toContain('(num2 - this.bA0) / num2');   // GetLerpValue(59,0,ai0)
    // 反编译锚:755 分支只重赋 num 一行（946 才整组重算）
    const van = readFileSync(join(VAN, 'Projectile.cs'), 'utf8');
    const j = van.indexOf('private void AI_156_Think(');
    const vblock = van.slice(j, j + 900);
    expect(vblock).toContain('if (flag)\n\t\t{\n\t\t\tnum = 66;\n\t\t}');
    expect(vblock).toContain('int num2 = num - 1;');       // 59（先于 755 覆盖算好）
  });
});

// ============================================================
// §5 388 痉挛眼冲刺伤害（第五面:旧冲刺支零 contact 恰红）
// ============================================================
describe('§5 388 冲刺态接触伤害（AI_066 :30154-30178 + Damage 每子步）', () => {
  it('冲刺拍命中重叠敌:伤害 >0（旧冲刺支 return 早退零 contact =0 恰红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（ai156Strike/contact 面首掷 ×1.0）;
    const en = mkEnemy(1, 60 * 16 + 60, 90 * 16);
    const { hooks, player } = makeHooks([en]);
    const m = bat(player, hooks, en.cx, en.cy, 388);  // 40×20 盒叠敌
    P(m).twA0 = 2; P(m).twA1 = 1;                     // 注入冲刺态（触发拍后）
    m.vx = 8;                                         // 截击速度（velocity 恒=触发拍值）
    m.fixedUpdate(1, hooks);                          // 冲刺拍:2 子步
    expect(en.calls.length).toBeGreaterThan(0);       // ★主判别（旧 =0 恰红）
    expect(en.calls[0].d).toBe(6);                    // dmg0 无 tag 基线
  });

  it('源码锚:冲刺子步循环内 moveAndCollide 后 contact（M5 变异位:摘除恰红）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    const i = src.indexOf('private twinsStep(');
    const block = src.slice(i, src.indexOf('private ai066TryInterceptingTarget('));
    const dash = block.slice(block.indexOf('twA0 === 2'), block.indexOf('this.twFrame = -1'));
    expect(dash).toContain('moveAndCollide');
    expect(dash.indexOf('this.contact(game, dmg0)')).toBeGreaterThan(
      dash.indexOf('moveAndCollide'));                // 位次:子步位移后结算
    // 反编译锚:extraUpdates=1（每子步伤害面节奏）
    const van = readFileSync(join(VAN, 'Projectile.cs'), 'utf8');
    const j = van.indexOf('this.ai[0] == 2f && type == 388');
    const vblock = van.slice(j, j + 400);
    expect(vblock).toContain('extraUpdates = 1');
    expect(vblock).toContain('this.ai[1] > 40f');
  });
});

// ============================================================
// §6 连坐:755 真盒 10×10（SetDefaults :7781-7782,旧 16×16 缺省恰红）
// ============================================================
describe('§6 755 命中盒注册（构造器真盒表）', () => {
  it('盒 10×10（判定盒/湿段采样盒;旧 16×16 缺省恰红）', () => {
    const { hooks, player } = makeHooks();
    const b = bat(player, hooks, 100, 100);
    expect(b.w).toBe(10);
    expect(b.h).toBe(10);
    const van = readFileSync(join(VAN, 'Projectile.cs'), 'utf8');
    const i = van.indexOf('else if (type == 755)');
    expect(van.slice(i, i + 200)).toContain('width = 10');
    expect(van.slice(i, i + 200)).toContain('height = 10');
  });
});
