// ★BJ650（2026-10-12）：召唤/弹幕演出域四件（BJ634/635/639·R15-F6 登记债清偿判别锁）
//
// 件1 [864 刃杖辉光叠层]（BJ634/632 伴生登记债）：Main.cs:31395-31403 帧白模四份旋转
//   （A/4）+ GetFloatingDaggerMinionGlowColor（Projectile.cs:80377-80381,hue=
//   0.66+0.33×(whoAmI%6)/6 六档蓝→品红循环,s=0.7/l=0.6,×0.7f）——pushGlowOps 逃逸
//   队列（BJ625件3 基建/BJ630件1 AURA 通道同槽）+ 残影 12 份（:30883 num166=12 档,
//   projGhostTrail 864 表既有）whoAmI 色相精化（登记③ retired）+ smolstarAI 三出口
//   recordGhostTrail 补接线（旧环恒空=残影死支）。
//   ★件1 返工（2026-10-13 用户实报「本体右上品红半透影子=不同颜色」）：色相源
//   whoAmI 误用 this.id（EntityManager 全实体递增计数器 Entity.ts:150——敌/掉落/
//   NPC/弹共享 nextId）→ id%6 档位随会话总生成数漂移,长会话恒落高档 4/5=品红。
//   原版 whoAmI=出生拍 Main.projectile 首空闲槽（活期稳定/复用循环）→ 对映=注册表
//   插入位懒快照（首拍一次,未入列回退 0 档）;辉光十字与残影环两消费位同源。
//   嫌疑「辉光位偏二次旋转」定谳否证：位偏在 translate 里先于 rotate 烘入=世界系
//   （捕获矩阵 rot 项只旋精灵=EntitySpriteDraw rotation 参数同构）;原版 AI_169
//   空闲档 targetAngle=UnitY.ToRotation()+π/2=π（:46612-46614）与仓内 rot=π 同值。
// 件2 [533 致命球 localAI[2]≥40 伤害 ×0.5]（BJ635 登记）:Projectile.cs:14618-14621
//   Damage_GetProjectileSpecificDamageMultiplier `num *= 0.5f`——消费位 num7=
//   (int)(damage×mul)（:12873/:14718 截断,先于 ModifyHit tag 栈）。★登记文案「击退
//   ×0.5」系误记:击退面 num5=knockBack 不经此函数,机制=【伤害】×0.5（蓄力档减伤
//   联动=撞墙计数 :18314 +30/次、:30120 逐拍 −1 钳 [0,60]）。
// 件3 [533 冲刺 HitTiles 砖屑尘]（BJ635 登记）:Projectile.cs:18304-18306 反弹支内
//   `if (ai[0] >= 6f && ai[0] < 9f) Collision.HitTiles(position, lastVelocity, ...)`
//   ——仅冲刺档（dA0∈[6,8]）反弹拍撒尘,velocity=撞前速（hitTilesFx 形参同源）。
// 件4 [694-696 爆炸机关弹视觉面]（R15-F6 登记）:AI_139_ExplosiveTrapExplosion
//   （:70466-70490——alpha −25/拍渐显、3t/帧爆花帧机满帧 Kill、:70488-70489
//   PlotTileLine Top→Bottom 宽 2 光带 CastLightOpen (1.3,0.9,0.2)）+ Main.cs:
//   32522-32546 Bottom 锚双笔本体绘（GetAlpha 694-696 特支 :81026-81029 字面色
//   (255,255,255,127)×(1−α/255) 不取光照;第二笔 ×0.3 × scale 1.1;origin Y−8、
//   694/695 X+3）。伤害面 BJ630 直伤臂保持（弹体零伤害勿双伤）。
//
// ★变异证红（withMutation 三层守卫,逐字节还原+sha256 对拍）：
//   M1 件1 recordGhostTrail 摘除 → 残影环恒空红 / M2 件1 色相 whoAmI 钉 0 档红 /
//   M3 件2 ×0.5 摘除红 / M4 件3 冲刺门摘除红 / M5 件4 弹体生成摘除红 /
//   M6 件4 帧机 3t→999t 红 / M7 件1 返工 whoAmI 槽位源回潮 id 红。各 ≥1 发,恰红断言。
//
// ★清偿 C（随从域 R5+R2 五债,2026-10-14）判别锁并入：
//   C1/R5-F1 六档×3通道 XNA 截断数值锁（②首测,xnaColorMulByte 单源）/ C2/R5-F2
//   setProjSpriteOverride(864) 缓存失效重烘锁（②末测）/ C6/R2-F2 216 重生弹词缀
//   实例伤害面锁（⑦）/ C7/R2-F3 963 伤害源=最高计数器聚合锁（⑧,先定谳=多计数器
//   共存可达——AI_164 AbigailUpgrade 音效同款可达面+自由槽位不驱逐）。
//   C3/C5 落叶域锁在 tests/nature-particles.test.ts。
//
// 运行：cd game && npx vitest run tests/bj650-summon-vfx.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MinionProj } from '../src/entities/MinionProj';
import { ExplosiveTrapBlastProj } from '../src/entities/ExplosiveTrapBlast';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import { GHOST_TINT, xnaColorMulByte } from '../src/entities/projGhostTrail';
import { hslToRgb255 as hslToRgb255SelfTest } from '../src/render/AuroraSky';
import { maintainMinionBuffs } from '../src/core/Game';
import { BuffType } from '../src/stats/Buffs';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const GAME = join(__dirname, '..');

// ============================ 夹具（BJ634/635 判例同式） ============================

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp?: number; vanillaId?: number;
  boss?: boolean;
  hurt: (d: number, kx?: number, ky?: number, g?: GameHooks) => boolean;
  hits: number[];
}
const mkEnemy = (id: number, cx: number, cy: number, w = 40, h = 40, boss = true): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy,
    hp: 100000, maxHp: 100000, boss, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

function makeHooks(enemies: MockEnemy[] = []) {
  const w = new World(200, 120, 7, 'bj650');
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
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown, b: string) => void } }).entities = {
    projectiles: added,
    add: (e: unknown) => { added.push(e); },
  };
  return { hooks, store: w.store, player, added };
}

let minionSeq = 0;
const minion = (player: Player, hooks: GameHooks, pid: number, cx: number, cy: number): MinionProj => {
  const m = new MinionProj(cx, cy, pid, 6, 0, false, 0, false, () => player);
  m.id = ++minionSeq;
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
  (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
  return m;
};
const fld = <T, K extends string>(o: T, k: K): unknown =>
  (o as unknown as Record<K, unknown>)[k];

beforeAll(() => {
  // projFrameImg 帧切片画布垫片（BJ630/BJ635 同式,吸掉 2d 调用）
  (globalThis as Record<string, unknown>).document = {
    createElement: () => {
      const cv: Record<string, unknown> = { width: 0, height: 0 };
      cv.getContext = () => new Proxy({}, { get: () => () => { /* noop */ }, set: () => true });
      return cv;
    },
    querySelector: () => null,
  };
});

// ===================== ① 源码锚（vanilla 亲读 + repo 落刀位） =====================

describe('① 源码锚（四件双侧亲读锚）', () => {
  const V = join(GAME, '..', 'Terarria1457', 'Terraria');

  it('件2 原版 :14618 localAI[2]≥40 ×0.5（Damage 乘区面亲读）', () => {
    const src = readFileSync(join(V, 'Projectile.cs'), 'utf8');
    expect(src).toContain('if (type == 533 && localAI[2] >= 40f)\n\t\t{\n\t\t\tnum *= 0.5f;\n\t\t}');
    // 乘区函数=伤害面（击退面不经此函数——登记文案误记的定谳锚）
    const i = src.indexOf('private float Damage_GetProjectileSpecificDamageMultiplier()');
    const tail = src.slice(i, i + 2000);
    expect(tail).toContain('type == 533 && localAI[2] >= 40f');
    expect(tail).toContain('num *= 0.5f');
  });

  it('件3 原版 :18304-18306 冲刺反弹 HitTiles（仅 ai0∈[6,9) 档）', () => {
    const src = readFileSync(join(V, 'Projectile.cs'), 'utf8');
    // 反弹支唯一锚（velocity.Y ×(−1)×0.5 反折式——AI 段 533 块先行命中规避）
    const i = src.indexOf('velocity.Y = lastVelocity.Y * (0f - num19) * 0.5f');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i - 400, i + 900);
    expect(block).toContain('Collision.HitTiles(position, lastVelocity, width, height)');
    expect(block).toContain('ai[0] >= 6f && ai[0] < 9f');
    expect(block).toContain('localAI[2] += 30f');
  });

  it('件4 原版 AI_139 帧机/光带 + GetAlpha 字面色 + Bottom 锚双笔', () => {
    const src = readFileSync(join(V, 'Projectile.cs'), 'utf8');
    const i = src.indexOf('private void AI_139_ExplosiveTrapExplosion()');
    const block = src.slice(i, src.indexOf('private void AI_140_MonkStaffT1()'));
    expect(block).toContain('alpha -= 25');
    expect(block).toContain('++frameCounter >= num2');
    expect(block).toContain('DelegateMethods.v3_1 = new Vector3(1.3f, 0.9f, 0.2f)');
    expect(block).toContain('Utils.PlotTileLine(base.Top, base.Bottom, 2f, DelegateMethods.CastLightOpen)');
    expect(src).toContain('if (type == 694 || type == 695 || type == 696)\n\t\t\t{\n\t\t\t\treturn new Color(255, 255, 255, 127) * (1f - (float)alpha / 255f);');
    const m = readFileSync(join(V, 'Main.cs'), 'utf8');
    const j = m.indexOf('if (proj.type == 694 || proj.type == 695 || proj.type == 696)\n\t\t\t{');
    const draw = m.slice(j, j + 1400);
    expect(draw).toContain('proj.Bottom + Vector2.UnitY * proj.gfxOffY');
    expect(draw).toContain('value63.Frame(1, projFrames[proj.type], 0, proj.frame)');
    expect(draw).toContain('origin21.Y -= 8f');
    expect(draw).toContain('origin21.X += 3f');
    expect(draw).toContain('color75 * 0.3f');
    expect(draw).toContain('proj.scale * 1.1f');
  });

  it('件1 原版 :31395-31403 四份白模 + :80377-80381 色式 + :30883 残影 12 份', () => {
    const m = readFileSync(join(V, 'Main.cs'), 'utf8');
    const j = m.indexOf('if (proj.type == 864)\n\t\t\t{\n\t\t\t\tMicrosoft.Xna.Framework.Color floatingDaggerMinionGlowColor');
    const glow = m.slice(j, j + 700);
    expect(glow).toContain('GetFloatingDaggerMinionGlowColor()');
    expect(glow).toContain('floatingDaggerMinionGlowColor.A /= 4');
    expect(glow).toContain('value18.Y += value18.Height');
    expect(glow).toContain('RotatedBy(MathF.PI / 2f * (float)num183) * 2f');
    const p = readFileSync(join(V, 'Projectile.cs'), 'utf8');
    const k = p.indexOf('public Color GetFloatingDaggerMinionGlowColor()');
    const col = p.slice(k, k + 220);
    expect(col).toContain('(float)(whoAmI % 6) / 6f');
    expect(col).toContain('Main.hslToRgb(0.66f + 0.33f * num, 0.7f, 0.6f) * 0.7f');
    // 残影 12 份档（:30883 num166=12/num165=−1/num167=1.4 + value16.Y+=Height 白模）
    const t = m.indexOf('proj.type == 864)\n\t\t\t{\n\t\t\t\tnum166 = 12;');
    expect(t).toBeGreaterThan(-1);
    expect(m.slice(t, t + 160)).toContain('value16.Y += value16.Height');
  });

  it('repo 落刀位：×0.5 消费/冲刺尘门/864 辉光支/残影接线/爆炸弹生成', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    expect(src).toContain('this.contact(game, this.dLai2 >= 40 ? Math.trunc(dmg0 * 0.5) : dmg0);');   // ★BJ696 重锚：×0.5 乘区移入 contact533 唯一伤害出口
    expect(src).toContain('game.hitTilesFx?.(this.x, this.y, this.w, this.h, lvx, lvy)');
    expect(src).toContain('if (this.projId === 864) {\n      const sheet864 = projSprite(864);');
    expect(src).toContain('.entities.add(new ExplosiveTrapBlastProj(ecx, ecy, boomProj as 694 | 695 | 696), \'projectiles\')');
    // smolstarAI 三出口残影接线（件1 残影环补线——旧环恒空死支）
    const smol = src.slice(src.indexOf('private smolstarAI('), src.indexOf('private babyBirdStep('));
    expect(smol.match(/this\.recordGhostTrail\(\)/g)?.length).toBe(3);
    const g = readFileSync(join(GAME, 'src', 'entities', 'projGhostTrail.ts'), 'utf8');
    expect(g).toContain('whoAmI?: number');
    expect(g).toContain('Math.trunc(Math.trunc(255 * 0.7) / 4) / 255');
  });
});

// ===================== ② 件1：864 辉光叠层（M1/M2 红位） =====================

describe('② 件1：864 辉光色式 + 白模 4 份 + 残影接线', () => {
  it('★清偿 C1/R5-F1：GHOST_TINT[864] 六档×3通道 XNA 截断数值锁（R5 node 实算基准表）', () => {
    const tint = GHOST_TINT[864]!;
    // 基准 = hslToRgb255(0.66+0.33k/6, 0.7, 0.6) 后 ×0.7 逐字节 (byte) 截断——
    // hue0=(57,60,156)（旧 JS Math.round=(57,61,157)）;hue1 b−1;hue2/3 r−1,b−1;
    // hue4/5 r−1,b−1（R5 实算,hue 表见 projGhostTrail.xnaColorMulByte 注）
    const XNA = [
      [57, 60, 156], [86, 57, 156], [118, 57, 156], [151, 57, 156], [156, 57, 128], [156, 57, 95],
    ];
    const ctxFor = (w: number) => ({ id: 864, i: 1, start: 12, end: 0, fade: 0.5, ai0: 0, ai1: 0,
      timeLeft: 3600, opacity: 1, bodyScale: 1, vxLen: 1, rng: () => 0, whoAmI: w });
    for (let w = 0; w < 6; w++) {
      const c = tint(ctxFor(w))!;
      expect(c.rgb).toEqual(XNA[w]);                  // 数值锁主面（round 档全 +1 → 红）
      const [r, g, b] = hslToRgb255SelfTest(0.66 + 0.33 * (w / 6), 0.7, 0.6);
      expect(c.rgb).toEqual(xnaColorMulByte([r, g, b], 0.7));   // 与派生式同源（hsl 漂移守卫）
    }
    const c0 = tint(ctxFor(0))!;
    const c1 = tint(ctxFor(1))!;
    const c6 = tint(ctxFor(6))!;
    expect(c1.rgb).not.toEqual(c0.rgb);               // 弹序异色（旧 0 档近似恒同 → 红）
    expect(c6.rgb).toEqual(c0.rgb);                   // %6 回卷
    expect(c0.aMul).toBeCloseTo(44 / 255, 6);         // A 面 (byte)178/4=44（旧 0.25 → 红）
  });

  it('draw 侧：帧 1 白模 4 份 π/2 旋转 + A=44 直绘双笔（★BJ669 层序翻正重锚：逃逸队列→本体前直绘）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, 864, 50 * 16, 90 * 16);
    m.rot = 0.7;
    // ★BJ650件1 返工：色相源=whoAmI 槽位快照（出生拍注册表插入位,原版首空闲槽
    //  对映）非 this.id（全实体递增计数器→档位随会话漂移=用户实报品红影子）。
    //  本测直驱 draw 不走 fixedUpdate → 显式 stamp 槽位并从 stamp 推导期望色。
    //  ★BJ669：染色对=glow864TexPair 惰性烘焙（stub sprite 不可绘→null→支跳过）
    //  ——本测用可绘 stub canvas 烘（stubDocument 已铺 document）。
    const slot = 3;
    (m as unknown as { whoAmI: number }).whoAmI = slot;
    const stubSheet = document.createElement('canvas');
    stubSheet.width = 18; stubSheet.height = 64;
    const sg = stubSheet.getContext('2d');
    if (sg) { sg.fillStyle = '#fff'; sg.fillRect(0, 0, 18, 64); }
    setProjSpriteOverride(864, stubSheet as never);
    const drawOps: Array<{ m: string; a: unknown[] }> = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(_t, k) {
        if (k === 'canvas') return undefined;
        if (k === 'getTransform') return () => ({ __m: 1 });
        return (...a: unknown[]) => { drawOps.push({ m: String(k), a }); };
      },
      set(_t, k, v) { drawOps.push({ m: `set:${String(k)}`, a: [v] }); return true; },
    });
    const glowOps: Array<Record<string, unknown>> = [];
    const fakeR = {
      ctx,
      atlas: { ensureVImage: (f: string) => ({ width: 18, height: 64, __f: f }) },
      lighting: { lightAt: () => [255, 255, 255] },
      pushGlowOps: (o: Array<Record<string, unknown>>) => { glowOps.push(...o); },
    };
    (m as unknown as { draw(r: unknown): void }).draw(fakeR);
    // ★BJ669：不再走逃逸队列（合成后冲刷=叠本体顶,层序反）——改世界层直绘
    expect(glowOps.length).toBe(0);
    // 4 份×2 笔（cut 黑染 A 衰减 ga=44/255 + add rgb 染 'lighter' ga=1）——
    // 代理 ctx 下 drawImage 调用=本体 1 + 残影 0（环空）+ 辉光 8 = 9;
    // lighter 段 ≥4、A=44/255 段 ≥4（XNA 预乘分解 One/InvSrcAlpha）
    const draws = drawOps.filter((o) => o.m === 'drawImage');
    expect(draws.length).toBe(9);
    const lighterSets = drawOps.filter((o) => o.m === 'set:globalCompositeOperation' && o.a[0] === 'lighter');
    expect(lighterSets.length).toBeGreaterThanOrEqual(4);
    const alphaSets = drawOps.filter((o) => o.m === 'set:globalAlpha')
      .map((o) => o.a[0] as number);
    expect(alphaSets.filter((v) => Math.abs(v - 44 / 255) < 1e-6).length).toBeGreaterThanOrEqual(4);
    // 世界系四向位：rot 单位向 RotatedBy(π/2·k)×2（rot=0.7 → 4 个互异偏移）
    const tx = drawOps.filter((o) => o.m === 'translate').map((o) => o.a as number[]);
    const offs = tx.slice(0, 4).map(([x, y]) => [x - (50 * 16), y - (90 * 16)]);
    expect(offs.map(([x, y]) => +Math.hypot(x, y).toFixed(6))).toEqual([2, 2, 2, 2]);
    expect(new Set(offs.map(([x, y]) => `${+x.toFixed(6)},${+y.toFixed(6)}`)).size).toBe(4);
  });

  it('smolstarAI 每拍 recordGhostTrail → 残影环填充（旧环恒空死支 → M1 红）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, 864, player.cx + 100, player.cy);
    for (let t = 0; t < 3; t++) m.fixedUpdate(1 / 60, hooks);
    const ring = fld(m, 'ghostRing') as { filled: number } | null | undefined;
    expect(ring).toBeTruthy();
    expect(ring!.filled).toBeGreaterThanOrEqual(2);   // 旧 0 → 红
  });

  it('★返工：whoAmI 槽位快照=出生拍注册表插入位（this.id 全实体计数器档位漂移 → M6 红）', () => {
    // 定谳（2026-10-13 实报）：原版 whoAmI=出生拍 Main.projectile 首空闲槽
    //  （NewProjectile :10873 扫槽,活期稳定/复用循环）;this.id=EntityManager
    //  全实体递增（Entity.ts:150,敌/掉落/NPC/弹共享 nextId）→ id%6 随会话总
    //  生成数漂移=用户实报「品红影子不同色」真凶。对映=注册表插入位（紧凑
    //  数组槽语义;原版洞复用底档偏置由紧凑低计数承载,活期漂移差=登记近似）。
    const { hooks, player } = makeHooks([]);
    const a = minion(player, hooks, 864, player.cx + 100, player.cy);   // 插入位 0
    const b = minion(player, hooks, 864, player.cx + 140, player.cy);   // 插入位 1
    a.fixedUpdate(1 / 60, hooks);
    b.fixedUpdate(1 / 60, hooks);
    expect(fld(a, 'whoAmI')).toBe(0);                 // 首槽（原版蓝端 0.66）
    expect(fld(b, 'whoAmI')).toBe(1);                 // 多刃异档（原版多刃异色同相）
    // 槽位活期稳定（原版 whoAmI 出生钉死,不逐拍重掷）
    a.fixedUpdate(1 / 60, hooks);
    expect(fld(a, 'whoAmI')).toBe(0);
    // 第 7 刃：插入位=6——id 源回潮（id%6∈[0,5]）恒 ≠6 → M6 恰红判别位
    let last: MinionProj | null = null;
    for (let i = 0; i < 5; i++) {
      last = minion(player, hooks, 864, player.cx + 180 + i * 40, player.cy);
    }
    last!.fixedUpdate(1 / 60, hooks);
    expect(fld(last, 'whoAmI')).toBe(6);
  });

  it('★清偿 C2/R5-F2：setProjSpriteOverride(864) → GLOW864_CACHE 失效重烘（换图后辉光吃新剪影）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, 864, 50 * 16, 90 * 16);
    (m as unknown as { whoAmI: number }).whoAmI = 0;
    const mkSheet = (w: number, h: number): HTMLCanvasElement => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      return cv as unknown as HTMLCanvasElement;
    };
    const ops: Array<{ m: string; a: unknown[] }> = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(_t, k) {
        if (k === 'canvas') return undefined;
        if (k === 'getTransform') return () => ({ __m: 1 });
        return (...a: unknown[]) => { ops.push({ m: String(k), a }); };
      },
      set(_t, k, v) { ops.push({ m: `set:${String(k)}`, a: [v] }); return true; },
    });
    const fakeR = (aw: number, ah: number) => ({
      ctx,
      atlas: { ensureVImage: () => ({ width: aw, height: ah }) },
      lighting: { lightAt: () => [255, 255, 255] },
      pushGlowOps: () => {},
    });
    const glowTexWidths = (os: Array<{ m: string; a: unknown[] }>): number[] =>
      os.filter((o) => o.m === 'drawImage')
        .map((o) => (o.a[0] as { width: number }).width)
        .slice(1);                                   // 跳过本体 1 笔 → 辉光 8 笔（4 份×cut/add）
    // 首烘：18×64 剪影（帧高 32）——染色对宽 18
    setProjSpriteOverride(864, mkSheet(18, 64) as never);
    (m as unknown as { draw(r: unknown): void }).draw(fakeR(18, 64));
    expect(glowTexWidths(ops)).toEqual(Array(8).fill(18));
    // 换图（RemasterRuntime 就地生效无 reload 场景）：override 派发失效通知 →
    // 下次烘焙吃新剪影 26×96（帧高 48）——缓存不清则恒 18 → 红
    setProjSpriteOverride(864, mkSheet(26, 96) as never);
    ops.length = 0;
    (m as unknown as { draw(r: unknown): void }).draw(fakeR(26, 96));
    expect(glowTexWidths(ops)).toEqual(Array(8).fill(26));
  });
});

// ===================== ③ 件2：533 ×0.5 消费（M3 红位） =====================

describe('③ 件2：533 localAI[2]≥40 伤害 ×0.5', () => {
  it('dLai2≥40 → 受击伤害减半截断（dmg0=6 → 3）', () => {
    const e = mkEnemy(30, 0, 0);
    const { hooks, player } = makeHooks([e]);
    const m = minion(player, hooks, 533, player.cx + 100, player.cy);
    e.cx = m.cx; e.x = e.cx - e.w / 2; e.cy = m.cy; e.y = e.cy - e.h / 2;   // 盒重叠
    (m as unknown as { dLai2: number }).dLai2 = 50;                          // 衰减 1 → 49 ≥ 40
    m.fixedUpdate(1 / 60, hooks);
    expect(e.hits.length).toBeGreaterThan(0);
    expect(e.hits[0]).toBe(3);                       // trunc(6×0.5)=3（旧 6 → M3 红）
  });

  it('dLai2<40 → 全额（6）——阈值下沿不触发', () => {
    const e = mkEnemy(31, 0, 0);
    const { hooks, player } = makeHooks([e]);
    const m = minion(player, hooks, 533, player.cx + 100, player.cy);
    e.cx = m.cx; e.x = e.cx - e.w / 2; e.cy = m.cy; e.y = e.cy - e.h / 2;
    (m as unknown as { dLai2: number }).dLai2 = 10;
    m.fixedUpdate(1 / 60, hooks);
    expect(e.hits.length).toBeGreaterThan(0);
    expect(e.hits[0]).toBe(6);
  });

  it('奇数伤害截断档（dmg0=7 → 3,非 3.5/4）——num7 (int) 语义', () => {
    const e = mkEnemy(32, 0, 0);
    const { hooks, player } = makeHooks([e]);
    const m = new MinionProj(player.cx + 100, player.cy, 533, 7, 0, false, 0, false, () => player);
    m.id = ++minionSeq;
    m.x = m.cx - m.w / 2; m.y = m.cy - m.h / 2;
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
    e.cx = m.cx; e.x = e.cx - e.w / 2; e.cy = m.cy; e.y = e.cy - e.h / 2;
    (m as unknown as { dLai2: number }).dLai2 = 60;
    m.fixedUpdate(1 / 60, hooks);
    expect(e.hits[0]).toBe(3);
  });
});

// ===================== ④ 件3：533 冲刺撞块尘（M4 红位） =====================

describe('④ 件3：533 冲刺档反弹 HitTiles 砖屑', () => {
  const fxSpy = (hooks: GameHooks): number[][] => {
    const calls: number[][] = [];
    (hooks as unknown as { hitTilesFx?: unknown }).hitTilesFx =
      (x: number, y: number, w: number, h: number, vx: number, vy: number) =>
        calls.push([x, y, w, h, vx, vy]);
    return calls;
  };

  it('冲刺档（dA0=6）落地反弹 → hitTilesFx(position, lastVelocity) 一次', () => {
    const { hooks, player } = makeHooks([]);
    const calls = fxSpy(hooks);
    // 盒底贴地面——★BJ697 债②起冲刺物理盒 26×26（dA0≥6 中心锚两侧+3）:碰撞底=
    // cy+10+3 → cy=1586 时底=1599（地面行 100 顶 1600）;旧 20 盒校准位 1589 在
    // 26 盒下预嵌 2px=碰撞解析路径漂移。冲刺支先于 hover 阻尼（分支早退）→
    // 撞前速=预置 vy=5
    const m = minion(player, hooks, 533, 60 * 16, 100 * 16 - 14);
    (m as unknown as { dA0: number }).dA0 = 6;
    m.vx = 0; m.vy = 5;
    m.fixedUpdate(1 / 60, hooks);
    expect(calls.length).toBe(1);                    // 旧 0 → M4 红
    expect(calls[0][4]).toBe(0);                     // velocity.X=撞前值
    expect(calls[0][5]).toBe(5);                     // velocity.Y=撞前速（lastVelocity）
    expect(calls[0][2]).toBe(m.w); expect(calls[0][3]).toBe(m.h);
    // position=撞位——★BJ697 债②起 26 物理盒贴地（碰撞底 1600）→ 裸 20 盒底=
    // 1600−3=1597（原版 TileCollision 以 Center 锚 26 盒解析,raw position 同相）
    expect(calls[0][1] + calls[0][3]).toBe(100 * 16 - 3);
    expect(fld(m, 'dLai2')).toBe(30);                // 反弹 +30（:18314）
    expect(m.vy).toBeLessThan(0);                    // 出膛上行（÷num20=−1.25）
  });

  it('待机档（dA0=0）反弹不撒尘（原版 ai0<6 门）', () => {
    const { hooks, player } = makeHooks([]);
    const calls = fxSpy(hooks);
    const m = minion(player, hooks, 533, 60 * 16, 100 * 16 - 11);
    (m as unknown as { dA0: number }).dA0 = 0;
    m.vx = 0; m.vy = 5;
    m.fixedUpdate(1 / 60, hooks);
    expect(calls.length).toBe(0);                    // 门误开 → 红
    expect(fld(m, 'dLai2')).toBe(30);                // 反弹计数面照跑（计数/尘两门独立）
  });
});

// ===================== ⑤ 件4：694-696 爆炸机关弹视觉面（M5/M6 红位） =====================

describe('⑤ 件4：爆炸机关弹视觉面', () => {
  it('塔 691 触发拍生成爆炸弹实体（盒心=塔心+(0,−48),144×144,projId 映射）', () => {
    const e = mkEnemy(40, 0, 0);
    const { hooks, player, added } = makeHooks([e]);
    const tower = new MinionProj(50 * 16, 98 * 16 - 8, 691, 30, 0, true, 0, false, () => player);
    tower.id = ++minionSeq;
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(tower);
    e.cx = tower.cx; e.cy = tower.cy - 48; e.x = e.cx - e.w / 2; e.y = e.cy - e.h / 2;
    tower.fixedUpdate(1 / 60, hooks);
    const blasts = added.filter((a) => a instanceof ExplosiveTrapBlastProj) as ExplosiveTrapBlastProj[];
    expect(blasts.length).toBe(1);                   // 旧 0 → M5 红
    expect(blasts[0].projId).toBe(694);              // 691 → 694 映射
    expect(blasts[0].w).toBe(144); expect(blasts[0].h).toBe(144);
    expect(blasts[0].cx).toBe(tower.cx);
    expect(blasts[0].cy).toBe(tower.cy - 48);        // base.Center+(0,−num2)（:70440）
    // 二档映射 692→695/693→696
    const b2 = new ExplosiveTrapBlastProj(0, 0, 695);
    const b3 = new ExplosiveTrapBlastProj(0, 0, 696);
    expect(b2.projId).toBe(695); expect(b3.projId).toBe(696);
  });

  it('AI_139 帧机：alpha −25/拍、3t/帧、满帧 Kill（694=12 拍/696=15 拍）→ M6 红', () => {
    const lights: number[][] = [];
    const { hooks } = makeHooks([]);
    (hooks as unknown as { addLightAt?: unknown }).addLightAt =
      (x: number, y: number, r: number, g: number, b: number) => lights.push([x, y, r, g, b]);
    const b = new ExplosiveTrapBlastProj(100, 100, 694);
    b.fixedUpdate(1 / 60, hooks);                    // t1: α 230, fc1
    expect((b as unknown as { alpha: number }).alpha).toBe(230);
    expect((b as unknown as { fr: number }).fr).toBe(0);
    b.fixedUpdate(1 / 60, hooks); b.fixedUpdate(1 / 60, hooks);   // t3: 帧 1
    expect((b as unknown as { fr: number }).fr).toBe(1);
    for (let t = 0; t < 9; t++) b.fixedUpdate(1 / 60, hooks);     // t12: 帧 4 ≥ 4 → Kill
    expect(b.dead).toBe(true);
    // 光带：每拍 Top→Bottom 开放格加光 (1.3,0.9,0.2)——空世界盒心列 10 行
    const col = Math.floor(100 / 16);
    const band = lights.filter((l) => l[2] === 1.3 && l[3] === 0.9 && l[4] === 0.2);
    expect(band.length).toBeGreaterThan(0);
    expect(band[0][0]).toBe(col * 16 + 8);           // 盒心列
    expect(band.every((l) => Math.floor(l[0] / 16) === col)).toBe(true);
    // Kill 拍不再发（Kill 先于 PlotTileLine return）
    const n = lights.length;
    b.fixedUpdate(1 / 60, hooks);
    expect(lights.length).toBe(n);
    // 696 五帧 15 拍
    const b3 = new ExplosiveTrapBlastProj(100, 100, 696);
    for (let t = 0; t < 14; t++) b3.fixedUpdate(1 / 60, hooks);
    expect(b3.dead).toBe(false);
    b3.fixedUpdate(1 / 60, hooks);
    expect(b3.dead).toBe(true);
  });

  it('光带 CastLightOpen 门：实心格不加光/开放格加光（:729-748 谓词）', () => {
    const lights: number[][] = [];
    const { hooks, store } = makeHooks([]);
    (hooks as unknown as { addLightAt?: unknown }).addLightAt =
      (x: number, y: number, r: number, g: number, b: number) => lights.push([x, y, r, g, b]);
    // 盒心列全程实心墙（tile 1,覆盖光带行域 1..10 全带±1）→ 光带零发射
    const col = Math.floor(100 / 16);
    for (let j = 0; j <= 12; j++) store.setTile(col, j, 1);
    const b = new ExplosiveTrapBlastProj(100, 100, 694);
    b.fixedUpdate(1 / 60, hooks);
    expect(lights.length).toBe(0);
  });

  it('绘制：Bottom 锚 origin(Y−8,X+3 694/695) 双笔字面色（×0.3 ×1.1）', () => {
    const { hooks } = makeHooks([]);
    (hooks as unknown as { addLightAt?: unknown }).addLightAt = () => {};
    const b = new ExplosiveTrapBlastProj(100, 100, 694);
    for (let t = 0; t < 10; t++) b.fixedUpdate(1 / 60, hooks);    // α=5, 帧 3
    const drawOps: Array<{ m: string; a: unknown[] }> = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(_t, k) {
        if (k === 'canvas') return undefined;
        if (k === 'getTransform') return () => ({ __m: 1 });
        return (...a: unknown[]) => { drawOps.push({ m: String(k), a }); };
      },
      set(_t, k, v) { drawOps.push({ m: `set:${String(k)}`, a: [v] }); return true; },
    });
    const glowOps: Array<Record<string, unknown>> = [];
    const fakeR = {
      ctx,
      atlas: { ensureVImage: (f: string) => ({ width: 80, height: 320, __f: f }) },
      pushGlowOps: (o: Array<Record<string, unknown>>) => { glowOps.push(...o); },
    };
    (b as unknown as { draw(r: unknown, c: unknown): void }).draw(fakeR, {});
    // α=5 → k=250/255:c1=250/a1=124、c2=75/a2=37（XNA 逐字节截断）
    expect(glowOps.length).toBe(2);
    const [op1, op2] = glowOps;
    expect(op1.tex).toBe('vanilla/Projectile_694.png');
    expect(op1.sy).toBe(3 * 80);                     // 帧 3 行
    expect(op1.blend).toBe('over');
    expect(op1.tint).toEqual([250 / 255, 250 / 255, 250 / 255]);
    expect(op1.alpha).toBeCloseTo(124 / 255, 6);
    expect(op1.dx).toBe(-(80 / 2 + 3));              // origin.X +3（694 档）
    expect(op1.dy).toBe(-(80 - 8));                  // origin.Y −8
    expect(op2.tint).toEqual([75 / 255, 75 / 255, 75 / 255]);
    expect(op2.alpha).toBeCloseTo(37 / 255, 6);
    expect(op2.dw).toBeCloseTo(88, 6);               // scale×1.1（第二笔）
    expect(op2.dh).toBeCloseTo(88, 6);
    // 锚 = proj.Bottom（y+h=172）
    const tx = drawOps.find((o) => o.m === 'translate');
    expect(tx?.a[0]).toBe(100); expect(tx?.a[1]).toBe(172);
  });
});

// ===================== ⑦ 清偿 C6/R2-F2：216 重生弹词缀实例伤害面 =====================

describe('⑦ 清偿 C6/R2-F2：216 雀宝宝重生弹取背包实例词缀面（Player.cs:10796-10801）', () => {
  const birdOf = (prefix?: number): MinionProj => {
    const { player } = makeHooks([]);
    player.inv.slots.fill(null);
    player.inv.slots[0] = prefix ? { id: 4281, stack: 1, prefix } : { id: 4281, stack: 1 };
    player.buffs.set(BuffType.BabyBird, 300);        // maxMinions 缺省基座 1（getter 只读）
    const out: MinionProj[] = [];
    maintainMinionBuffs(player, [], (m) => out.push(m));
    expect(out.length).toBe(1);
    return out[0];
  };

  it('无词缀实例 → 基础 7/4（FindItem 实例 damage/knockBack=基础值同面）', () => {
    const b = birdOf();
    expect(b.damage).toBe(7);
    expect(b.knockback).toBe(4);
  });

  it('★判别主面：无情 57（dmg1.18/kb0.9）→ damage 8 非 7（旧 itemCombat 基础值 → 红）', () => {
    const b = birdOf(57);
    expect(b.damage).toBe(8);                        // roundCSf32Mul(7,1.18)=8
    expect(b.knockback).toBeCloseTo(3.6, 6);         // 4×0.9
  });
});

// ===================== ⑧ 清偿 C7/R2-F3：963 伤害源=最高计数器聚合 =====================

describe('⑧ 清偿 C7/R2-F3：963 伤害源=highestAbigailCounterOriginalDamage（P.cs:12296-12300/:66083）', () => {
  const counter = (player: Player, hooks: GameHooks, dmg: number): MinionProj => {
    const m = new MinionProj(player.cx + 100, player.cy, 970, dmg, 0, false, 0, false, () => player);
    m.id = ++minionSeq;
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
    return m;
  };

  it('双计数器共存（自由槽位重复使用 5114 可达面）：963 出生伤害=max(6,20)=20（旧生成者快照 6 → 红）', () => {
    const { hooks, player, added } = makeHooks([]);
    const a = counter(player, hooks, 6);
    counter(player, hooks, 20);
    a.fixedUpdate(1 / 60, hooks);                    // 低伤计数器先拍 → 派生本体
    const found = added.find((m) => m instanceof MinionProj && (m as MinionProj).projId === 963);
    const body = found as MinionProj | undefined;
    expect(body).toBeTruthy();
    expect(body!.damage).toBe(20);
  });

  it('后入高伤计数器 → 存活 963 每拍伤害面随 max 刷新（:66083 每拍回填;旧快照 6 → 红）', () => {
    const e = mkEnemy(60, 0, 0);
    const { hooks, player, added } = makeHooks([e]);
    const a = counter(player, hooks, 6);
    a.fixedUpdate(1 / 60, hooks);
    const found = added.find((m) => m instanceof MinionProj && (m as MinionProj).projId === 963);
    const body = found as MinionProj | undefined;
    expect(body).toBeTruthy();
    expect(body!.damage).toBe(6);                    // 首拍=唯一计数器值
    counter(player, hooks, 20);                      // 高伤计数器后入
    e.cx = body!.cx; e.x = e.cx - e.w / 2; e.cy = body!.cy; e.y = e.cy - e.h / 2;
    body!.fixedUpdate(1 / 60, hooks);
    expect(e.hits.length).toBeGreaterThan(0);
    // scale=1+0.55×(2−1)=1.55（hardMode 门=0.55 档）——max 面 20×1.55≈31;旧快照 6×1.55≈9.3 → 红
    expect(e.hits[0]).toBeCloseTo(20 * 1.55, 4);
  });
});

// ===================== ⑥ 变异自证（withMutation 三层守卫+sha256 对拍） =====================

describe.skipIf(process.env.SW_BJ650_MUT)('⑥ 变异自证（六发恰红+逐字节还原 sha256）', () => {
  const MP = join(GAME, 'src', 'entities', 'MinionProj.ts');
  const PG = join(GAME, 'src', 'entities', 'projGhostTrail.ts');
  const EB = join(GAME, 'src', 'entities', 'ExplosiveTrapBlast.ts');

  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj650-summon-vfx.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ650_MUT: '1' },   // ★子进程豁免变异面
    });

  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `BJ650 ${filter}`,
      // ★BJ662（2026-10-12）还原对拍重锚：基准改锁内捕获（onPristine=持锁后 pristine
      // 内容）——旧 preHash 在 withMutation 锁外求值（实参先于锁等待求值）,并行池内
      // 另一 MinionProj.ts 变异窗（bj612/bj-c9/c16a…）在盘=基准读到变异盘 → 还原后
      // 对拍必假红（bj650 M3×bj612 联跑实锤 2026-10-12）。
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    // 逐字节还原对拍（sha256）——withMutation 内部已强写+对拍,此处独立复核;
    // ★BJ662：重入同文件锁后再读盘（对拍窗全程持锁,消除「释放→重读」间隙竞态;
    // 锁内等待者=在途变异窗,等毕读到的必是还原后 pristine）
    lockTargetFile(file, `BJ650 还原对拍 ${filter}`);
    try {
      const post = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(post, `还原对拍 ${file}`).toBe(pristineSha);
    } finally {
      unlockTargetFile(file);
    }
  };
  const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex');

  it('M1 件1 残影接线摘除 → 残影环恒空红', () => {
    mutate(MP,
      'this.recordGhostTrail();   // ★BJ650件1：UpdateTrails（:17198,mode2=12 份白模残影',
      '/* ★BJ650 M1 变异:残影接线摘除 */',
      'smolstarAI 每拍 recordGhostTrail');
  });

  it('M2 件1 色相 whoAmI 钉 0 档 → 六档循环红', () => {
    mutate(PG,
      'const hue = 0.66 + 0.33 * (((c.whoAmI ?? 0) % 6) / 6);',
      'const hue = 0.66; // ★BJ650 M2 变异:whoAmI 0 档近似回潮',
      'XNA 截断数值锁');   // ★清偿 C1 重锚：判别面=六档×3通道基准表锁（旧「hue 随 whoAmI 六档循环」已改名）
  });

  it('M3 件2 ×0.5 摘除 → 减半断言红', () => {
    mutate(MP,
      // ★BJ696 重锚：×0.5 乘区现居 contact533（projPet 门内唯一伤害出口）,消费表达式同源
      'this.contact(game, this.dLai2 >= 40 ? Math.trunc(dmg0 * 0.5) : dmg0);',
      'this.contact(game, dmg0); // ★BJ650 M3 变异:14618 乘区摘除',
      'dLai2≥40 → 受击伤害减半截断');
  });

  it('M4 件3 冲刺尘门摘除 → hitTilesFx 断言红', () => {
    mutate(MP,
      'if (this.dA0 >= 6 && this.dA0 <= 8) {\n        game.hitTilesFx?.(this.x, this.y, this.w, this.h, lvx, lvy);\n      }',
      '/* ★BJ650 M4 变异:18304 冲刺尘门摘除 */',
      '冲刺档（dA0=6）落地反弹');
  });

  it('M5 件4 爆炸弹生成摘除 → 塔触发断言红', () => {
    mutate(MP,
      ".entities.add(new ExplosiveTrapBlastProj(ecx, ecy, boomProj as 694 | 695 | 696), 'projectiles');",
      "; // ★BJ650 M5 变异:R15-F6 视觉面摘除",
      '塔 691 触发拍生成爆炸弹实体');
  });

  it('M6 件4 帧机 3t→999t → Kill 节拍红', () => {
    mutate(EB,
      'if (++this.fc >= 3) {',
      'if (++this.fc >= 999) { // ★BJ650 M6 变异:帧机节拍漂移',
      'AI_139 帧机：alpha −25/拍');
  });

  it('M7 件1 返工 whoAmI 槽位源回潮 this.id → 档位漂移红', () => {
    // 判别力：快照=注册表插入位（第 7 刃=6）；回潮 this.id%6∈[0,5] 恒 ≠6 → 恰红
    mutate(MP,
      '      this.whoAmI = Math.max(0,\n        (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.indexOf(this));',
      '      this.whoAmI = this.id % 6; // ★BJ650 M7 变异:id 源回潮（全实体计数器档位漂移）',
      'whoAmI 槽位快照');
  });
});

// ★BJ683（2026-10-14）：864 返航首拍挖掘音走 WAV_MAP（dig→Dig_0/1/2）——
// 旧 soundTrackFiles('dig') 落声轨表兜底=裸名 ['dig'] fetch 双 404（用户实报
// SW sounds/dig.mp3 404 根因）。锚=MinionProj.ts smolstarAI 返航态 playSfx('dig')。
describe('BJ683 864 返航首拍挖掘音文件域（dig→Dig_0/1/2,非裸名）', () => {
  it('源锚：返航态走 playSfx（WAV_MAP 键域），零 soundTrackFiles(\'dig\') 残留', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'entities', 'MinionProj.ts'), 'utf8');
    expect(src).toContain("game.playSfx?.('dig', 1, this.cx, this.cy);");
    // 排除注释域（BJ683 注释自身引用旧串）——只锁代码面零残留
    const codeOnly = src.replace(/^\s*\/\/.*$/gm, '');
    expect(codeOnly).not.toContain("soundTrackFiles('dig')");
  });
  it('表域：vanilla-soundtracks.json 无 dig 键（兜底裸名=failure mode,证明旧码必 404）', async () => {
    const tracks = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'vanilla-soundtracks.json'), 'utf8'));
    expect(tracks).not.toHaveProperty('dig');
    const sfx = await import('../src/core/Sfx');
    expect(sfx.WAV_MAP.dig).toEqual(['Dig_0', 'Dig_1', 'Dig_2']);
  });
});
