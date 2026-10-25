// ★SW-FX6 2026-09-10（补债批：BJ16 §4 债台账 ①②③④⑥⑦ 清偿;⑤ 963 cos 摆已由
//  SW-BN6 闭环勿动——见 tests/sw-bj16-draw-branch-guard.test.ts ④ 963 用例）
//  判据源 = Terarria1457/Terraria/Main.cs DrawProjDirect 各专绘支（行号逐条锚定于
//  各用例）+ Projectile.cs SetDefaults/hide 门;审计正本 =
//  docs/audit/summon-draw-branch-registry-2026-09-07.md §4。
//  变异判别力：摘任一专绘支/早退门即对应用例爆红（本批已逐一做摘刀验证）。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
// ★C档可移植:仓库外依赖(game/ 兄弟目录,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['Terarria1457'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinionProj, minionTrueBox } from '../src/entities/MinionProj';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import { BookProj } from '../src/entities/BookProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MINION_TS = readFileSync(join(ROOT, 'src/entities/MinionProj.ts'), 'utf8');
const DECOMPILE_DIR = join(ROOT, '..', 'Terarria1457', 'Terraria');

// =====================================================================
// 夹具（BJ16 同款：记录型 ctx,带 save/restore 状态栈 + alpha/composite 戳记）
// =====================================================================
function fakeTex(w: number, h: number): HTMLImageElement {
  return ({ width: w, height: h }) as unknown as HTMLImageElement;
}
class FakeCanvas {
  width = 0; height = 0;
  getContext() {
    return { drawImage() {}, imageSmoothingEnabled: false };
  }
}
(globalThis as { document?: unknown }).document = {
  createElement: (): FakeCanvas => new FakeCanvas(),
};
interface DrawRec { tex: unknown; args: number[]; alpha: number; composite: string }
function recordingCtx() {
  const draws: DrawRec[] = [];
  const translates: number[][] = [];
  const rots: number[] = [];
  const scales: number[][] = [];
  const stack: Array<{ a: number; c: string }> = [];
  let alpha = 1, composite = 'source-over';
  const ctx = {
    save() { stack.push({ a: alpha, c: composite }); },
    restore() { const s = stack.pop(); if (s) { alpha = s.a; composite = s.c; } },
    translate(x: number, y: number) { translates.push([x, y]); },
    rotate(a: number) { rots.push(a); },
    scale(x: number, y: number) { scales.push([x, y]); },
    set imageSmoothingEnabled(_: boolean) {},
    get globalAlpha() { return alpha; },
    set globalAlpha(v: number) { alpha = v; },
    get globalCompositeOperation() { return composite; },
    set globalCompositeOperation(v: string) { composite = v; },
    set fillStyle(_: string) {}, set strokeStyle(_: string) {},
    fillRect() {}, strokeRect() {},
    drawImage(tex: unknown, ...rest: number[]) {
      draws.push({ tex, args: rest, alpha, composite });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, draws, translates, rots, scales };
}

const GROUND = 100 * 16;
function makeHooks() {
  const store = { setTile: () => {}, isSolid: () => false, inBounds: () => true } as never;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const hooks = {
    world: { store } as never, player: player as never,
    entities: { projectiles: [], npcs: [], players: [] },
    enemies: () => [], critters: () => [], spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
    playSfxFiles: () => {}, showPickupLabel: () => {},
  } as never;
  return { hooks, player };
}
function mkMinion(projId: number, player: Player, sentry = false): MinionProj {
  const bx = minionTrueBox(projId);
  const m = new MinionProj(player.cx, GROUND - bx.h, projId, 10, 2, sentry, 0, false, () => player);
  (m as { alphaFade: number }).alphaFade = 0;
  return m;
}

// =====================================================================
// 债① 641 月门：A 支中心锚（Main.cs:33161-33162/:33165）+ Extra_50 叠环
// （:33444-33467,641 flag40=true）+ color87.A=0 → 主绘 :33571 纯加法。
// 旧通用路 = 帧左上锚盒左上 → 60×60 精灵/32×32 盒偏 (+14,+14)。
// =====================================================================
describe.skipIf(EXT_MISSING)('SW-FX6 债① 641 月门 A 支专绘（Main.cs:33161-33166 + :33444-33467 + :33571）', () => {
  const RING = 80;   // Extra_50 假贴图边
  function draw641(rot = 0) {
    const sprite = fakeTex(60, 60);
    setProjSpriteOverride(641, sprite);
    const { player } = makeHooks();
    const m = mkMinion(641, player);
    m.rot = rot;
    const rec = recordingCtx();
    const atlas = { ensureVImage: (_k: string) => fakeTex(RING, RING) };
    m.draw({ ctx: rec.ctx, atlas } as never);
    return { rec, m };
  }

  it('结构锁：A 支专绘块在 33703 支之后、通用消费点之前,叠环/加算表达式在位', () => {
    const i641 = MINION_TS.indexOf('if (this.projId === 641 && img) {');
    const i33703 = MINION_TS.indexOf('if (CENTER_ANCHOR_33703.has(this.projId) && img) {');
    const iGeneric = MINION_TS.indexOf('const off3 = img');
    expect(i641).toBeGreaterThan(i33703);
    expect(iGeneric).toBeGreaterThan(i641);
    expect(MINION_TS).toContain("ctx.globalCompositeOperation = 'lighter';");
    expect(MINION_TS).toContain('const num360 = 0.95 + Math.sin(this.rot * 0.75) * 0.1;');
    expect(MINION_TS).toContain("ensureVImage('vanilla/Extra_50.png')");
  });

  it('锚=盒心（translate 全 [cx,cy]——旧通用路首 translate 为 [cx+14,cy] 应红）+ 5 遍叠绘序', () => {
    const { rec, m } = draw641();
    expect(rec.draws).toHaveLength(5);
    expect(rec.translates).toEqual(Array.from({ length: 5 }, () => [m.cx, m.cy]));
    // 序：环暗 → 环亮 → 本体幽灵 → 环三 → 本体主绘（:33456/:33457/:33459/:33462/:33571）
    expect(rec.draws[0].tex && (rec.draws[0].tex as HTMLImageElement).width).toBe(RING);
    expect(rec.draws[1].tex && (rec.draws[1].tex as HTMLImageElement).width).toBe(RING);
    expect(rec.draws[2].tex && (rec.draws[2].tex as HTMLImageElement).width).toBe(60);
    expect(rec.draws[3].tex && (rec.draws[3].tex as HTMLImageElement).width).toBe(RING);
    expect(rec.draws[4].tex && (rec.draws[4].tex as HTMLImageElement).width).toBe(60);
  });

  it('rot=0：环 scale11=1.17 / 亮环 1 / 幽灵 60×60 / 环三 0.9 / 主绘整图加算', () => {
    const { rec } = draw641(0);
    // rot=0 → num360=0.95 → scale11=0.6+0.6×0.95=1.17；dest=80×1.17=93.6
    expect(rec.draws[0].args).toEqual([-46.8, -46.8, 93.6, 93.6]);
    expect(rec.draws[0].alpha).toBeCloseTo(0.5 * 0.95, 12);   // color95=RGB 减半×num360（近似折 alpha）
    expect(rec.draws[1].args).toEqual([-40, -40, 80, 80]);
    expect(rec.draws[1].alpha).toBe(1);
    expect(rec.draws[2].args).toEqual([-30, -30, 60, 60]);    // 幽灵遍 origin=整图/2（:33165）
    expect(rec.draws[2].alpha).toBeCloseTo(0.4, 12);          // color94=×0.8·A/2（:33445-33446）
    expect(rec.draws[3].args).toEqual([-36, -36, 72, 72]);    // scale=proj.scale×0.9（:33462）
    expect(rec.draws[3].alpha).toBeCloseTo(0.8, 12);
    expect(rec.draws[4].args).toEqual([-30, -30, 60, 60]);    // 主绘（:33571）
    expect(rec.draws[4].composite).toBe('lighter');           // color87.A=0（:33464）→ 纯加法
    expect(rec.draws[4].alpha).toBe(1);
    // 镜像面：①②③ = dir^FlipH（dir≡None）恒镜像;④⑤ = dir 恒不镜像
    expect(rec.scales).toEqual([[-1, 1], [-1, 1], [-1, 1]]);
    expect(rec.rots[0]).toBeCloseTo(0.35, 12);                // −num340+0.35
    for (let i = 1; i < 5; i++) expect(rec.rots[i]).toBeCloseTo(0, 12);
  });

  it('rot=0.4：num360=0.95+sin(0.3)·0.1 消费 rotation（环 scale/五遍 rot 全随动）', () => {
    const { rec } = draw641(0.4);
    const num360 = 0.95 + Math.sin(0.3) * 0.1;
    const scale11 = 0.6 + 0.6 * num360;
    expect(rec.draws[0].args[2]).toBeCloseTo(RING * scale11, 9);
    expect(rec.draws[0].alpha).toBeCloseTo(0.5 * num360, 12);
    expect(rec.rots).toEqual([
      -0.4 + 0.35,   // :33456 −num340+0.35
      -0.4,          // :33457 −num340
      -0.28,         // :33459 −num340×0.7
      0.2,           // :33462 num340×0.5
      0.4,           // :33571 num340
    ].map((v) => expect.closeTo(v, 9)));
  });
});

// =====================================================================
// 债② 691-693 陷阱塔：B 支 Bottom 锚 + origin=(fw/2, fh−4)（Main.cs:34089-34097,
// 非携行）;携行（ai[2]==1）不重锚 = B 支缺省盒心。AI_138 首行 spriteDirection=1
// （:70379）→ dir≡None 恒不翻转。
// =====================================================================
describe.skipIf(EXT_MISSING)('SW-FX6 债② 691-693 陷阱塔 B 支 Bottom 锚（Main.cs:34089-34097）', () => {
  const DIMS: Record<number, [number, number]> = { 691: [26, 56], 692: [34, 56], 693: [46, 72] };
  it('结构锁：专绘块在位（Bottom 锚/origin fh−4/携行缺省盒心）', () => {
    expect(MINION_TS).toContain('if (this.sentry && TRAP_TOWER.has(this.projId) && img) {');
    expect(MINION_TS).toContain('ctx.translate(this.cx, this.y + this.h);');
    expect(MINION_TS).toContain('-(img.height - 4)');
    expect(MINION_TS).toContain('ctx.drawImage(img as CanvasImageSource, -img.width / 2, -img.height / 2);');
  });

  for (const [idStr, [tw, th]] of Object.entries(DIMS)) {
    const id = Number(idStr);
    it(`proj ${id}：非携行锚=proj.Bottom（translate=[cx,y+h]）、origin=(fw/2,fh−4) ⇒ 精灵底=盒底+4`, () => {
      setProjSpriteOverride(id, fakeTex(tw, th));                    // 4 帧
      const { player } = makeHooks();
      const m = mkMinion(id, player, true);
      const fh = th / 4, fw = tw;
      m.facing = -1;                                                 // dir≡None——翻转必须不发生
      const rec = recordingCtx();
      m.draw({ ctx: rec.ctx } as never);
      // ★G30（2026-10-24）存量红转绿：第二 translate=R15-F2 辉光叠画捕获锚
      //  （Main.cs:34507-34521 同锚同参;2026-09-10 立锁时该笔未在,陈旧期望单笔）
      expect(rec.translates, `proj ${id} anchor=Bottom×2（本体+辉光）`)
        .toEqual([[m.cx, m.y + m.h], [m.cx, m.y + m.h]]);
      expect(rec.draws[0].args, `proj ${id} origin=(fw/2,fh−4)`).toEqual([-fw / 2, -(fh - 4)]);
      expect((m.y + m.h - (fh - 4) + fh) - (m.y + m.h)).toBe(4);     // 精灵底−盒底=+4
      expect(rec.scales, `proj ${id} dir≡None 不镜像（drawScale=1 无 scale）`).toEqual([]);
    });

    it(`proj ${id}：携行态（ai[2]==1）不重锚 = B 支缺省盒心锚、origin=帧心`, () => {
      setProjSpriteOverride(id, fakeTex(tw, th));
      const { player } = makeHooks();
      const m = mkMinion(id, player, true);
      m.carriedByBackpack = true;
      const fh = th / 4, fw = tw;
      const rec = recordingCtx();
      m.draw({ ctx: rec.ctx } as never);
      // ★G30：第二 translate=辉光捕获锚（携行随 B 支缺省盒心,:34507 无 ai[2] 门照画）
      expect(rec.translates, `proj ${id} 携行锚=盒心×2（本体+辉光）`)
        .toEqual([[m.cx, m.cy], [m.cx, m.cy]]);
      expect(rec.draws[0].args, `proj ${id} origin=帧心`).toEqual([-fw / 2, -fh / 2]);
    });
  }
});

// =====================================================================
// 债③ 308/377 哨兵塔：通用路内半宽切片（Main.cs:34950-34957）+ 主绘
// :35047 Rectangle(x15, y25, num481, num482−1)、origin=(num153, 盒高/2+num151)
// （num153=texW/4,num151 仅 377=−6 :30190）、ai[2]==1 取右半列。
// =====================================================================
describe.skipIf(EXT_MISSING)('SW-FX6 债③ 308/377 半宽切片（Main.cs:34950-34957 + :35047）', () => {
  it('结构锁：切片块/num151/携行选列/−1 shave 在位', () => {
    expect(MINION_TS).toContain('if ((this.projId === 308 || this.projId === 377)) {');
    expect(MINION_TS).toContain('const num151 = this.projId === 377 ? -6 : 0;');
    expect(MINION_TS).toContain('const x15 = this.carriedByBackpack ? halfW : 0;');
    expect(MINION_TS).toContain('ctx.translate(this.x + halfW / 2, this.y + this.h / 2);');
    expect(MINION_TS).toContain('ctx.drawImage(sheet as CanvasImageSource, x15, y25, halfW, fh - 1,');
  });

  it('308 冰霜九头蛇：半宽切片（94→47）左列、锚=(盒左+23.5,盒上+37)、shave fh−1=77', () => {
    setProjSpriteOverride(308, fakeTex(94, 780));                    // 10 帧×78
    const { player } = makeHooks();
    const m = mkMinion(308, player);
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.x + 23.5, m.y + 37]]);        // num153=texW/4
    // (x15=0, y25=0, 47, 77, −23.5, −(37+0), 47, 77)
    expect(rec.draws[0].args).toEqual([0, 0, 47, 77, -23.5, -37, 47, 77]);
  });

  it('377 蜘蛛皇后：num151=−6（origin.Y=盒高/2−6=19）、半宽 66→33、shave 49', () => {
    setProjSpriteOverride(377, fakeTex(66, 450));                    // 9 帧×50
    const { player } = makeHooks();
    const m = mkMinion(377, player);
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.x + 16.5, m.y + 25]]);
    expect(rec.draws[0].args).toEqual([0, 0, 33, 49, -16.5, -19, 33, 49]);
  });

  it('携行（ai[2]==1）取右半列（x15=num481）+ facing<0 镜像（AI_053 spriteDirection 可 −1）', () => {
    setProjSpriteOverride(308, fakeTex(94, 780));
    const { player } = makeHooks();
    const m = mkMinion(308, player);
    m.carriedByBackpack = true;
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.draws[0].args).toEqual([47, 0, 47, 77, -23.5, -37, 47, 77]);  // :34954-34956
    m.facing = -1;
    const recL = recordingCtx();
    m.draw({ ctx: recL.ctx } as never);
    expect(recL.scales).toEqual([[-1, 1]]);
  });
});

// =====================================================================
// 债④ 623 星尘守护者：ai0==2 态锚 += rand.NextVector2Circular(2,2)
// （Main.cs:34170-34174;Utils.cs:1301-1303 = 单位向量×(2,2)×NextFloat）
// + CurrentDrawnEntityShader==0（常态）color106.A /= 2（:34175-34177）。
// =====================================================================
describe.skipIf(EXT_MISSING)('SW-FX6 债④ 623 攻击态抖动 + 本体 A/2（Main.cs:34170-34177）', () => {
  function mk623(gA0: number) {
    setProjSpriteOverride(623, fakeTex(108, 1748));                  // 19 帧×92
    const { player } = makeHooks();
    const m = mkMinion(623, player);
    (m as unknown as { gA0: number; gFrame: number }).gA0 = gA0;
    (m as unknown as { gFrame: number }).gFrame = 12;                // 攻击帧段 12-19
    return m;
  }

  it('ai0==2：锚逐 draw 掷流 |Δ|≤2（NextVector2Circular(2,2) 值域）且非恒零', () => {
    const m = mk623(2);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const rec = recordingCtx();
      m.draw({ ctx: rec.ctx } as never);
      const [tx, ty] = rec.translates[0];
      expect(Math.abs(tx - m.cx)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(ty - m.cy)).toBeLessThanOrEqual(2 + 1e-9);
      seen.add(`${tx - m.cx},${ty - m.cy}`);
    }
    expect(seen.size, '逐帧掷流必非恒零（Math.random 全零概率 0）').toBeGreaterThan(1);
  });

  it('ai0!==2：锚零抖恒 [cx,cy]（60 次全等）+ 本体 alpha=0.5（A/=2 :34175-34177）', () => {
    const m = mk623(0);
    for (let i = 0; i < 60; i++) {
      const rec = recordingCtx();
      m.draw({ ctx: rec.ctx } as never);
      expect(rec.translates[0]).toEqual([m.cx, m.cy]);
      expect(rec.draws[0].args).toEqual([-54, -46]);                 // 帧 108×92 帧心
      expect(rec.draws[0].alpha).toBeCloseTo(0.5, 12);
    }
  });

  it('ai0==2 下 alpha 仍 0.5（抖动与 A/2 同支并存）', () => {
    const m = mk623(2);
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.draws[0].alpha).toBeCloseTo(0.5, 12);
  });
});

// =====================================================================
// 债⑥ 831/970 计数器：vanilla hide=true（Projectile.cs:8082/:9197）→ 主循环
// hide 门整支跳过（Main.cs:22404-22406）= 隐形计数器;AI_164 照跑。
// 【裁决】本批按原版落 hide（原「12×12 宝石刻意渲染」语义分叉退役,报告单列）。
// =====================================================================
describe.skipIf(EXT_MISSING)('SW-FX6 债⑥ 831/970 hide=true 隐形计数器（Projectile.cs:8082/:9197 → Main.cs:22404-22406）', () => {
  it('结构锁：hide 早退门在 draw 顶部、先于 33703 支与通用消费点', () => {
    const iHide = MINION_TS.indexOf('if (this.projId === 831 || this.projId === 970) return;');
    const i33703 = MINION_TS.indexOf('if (CENTER_ANCHOR_33703.has(this.projId) && img) {');
    const iGeneric = MINION_TS.indexOf('const off3 = img');
    expect(iHide).toBeGreaterThan(0);
    expect(i33703).toBeGreaterThan(iHide);
    expect(iGeneric).toBeGreaterThan(i33703);
  });

  for (const id of [831, 970]) {
    it(`proj ${id}：贴图就绪仍零绘制（draws/translates/rots/scales 全空）`, () => {
      setProjSpriteOverride(id, fakeTex(12, 72));                    // 6 帧×12 宝石图
      const { player } = makeHooks();
      const m = mkMinion(id, player);
      const rec = recordingCtx();
      m.draw({ ctx: rec.ctx } as never);
      expect(rec.draws, `proj ${id} 零绘制`).toEqual([]);
      expect(rec.translates, `proj ${id} 零平移`).toEqual([]);
      expect(rec.rots).toEqual([]);
      expect(rec.scales).toEqual([]);
    });

    it(`proj ${id}：hide 不伤 AI（fixedUpdate 照跑、不死亡——Main.rand 面只吃绘制）`, () => {
      const { hooks, player } = makeHooks();
      const m = mkMinion(id, player);
      // 预置本体弹（831→833 虎体 / 970→963 阿比盖尔体）防 spawnBody 进实体系统
      const bodyId = id === 831 ? 833 : 963;
      (hooks as { entities: { projectiles: unknown[] } }).entities.projectiles.push(
        new MinionProj(player.cx, player.cy, bodyId, 10, 2, false, 0, false, () => player),
      );
      for (let i = 0; i < 10; i++) m.fixedUpdate(1 / 60, hooks);
      expect(m.dead).toBe(false);
    });
  }
});

// =====================================================================
// 债⑦ 1092 书弹：【定谳=无刀】vanilla draw 调用（Main.cs:34212）确传 dir,但
// 1092 的 spriteDirection 全生命周期恒 1：SetDefaults 复位 1（Projectile.cs:752）
// + AI_018 的 1092 支（:25712-25776）零 spriteDirection 赋值且尾部 return（:25776）
// 先于任何公共写点（:25883 不可达）→ dir≡SpriteEffects.None,无镜像发生。
// BookProj 不建模翻转【正是 1:1】;本组锁死该语义,防按旧债注「补镜像」回潮。
// =====================================================================
describe.skipIf(EXT_MISSING)('SW-FX6 债⑦ 1092 书弹 dir≡None 定谳（无刀,语义锁）', () => {
  // ★C档可移植:缺档降级(describe 体收集期亦执行;EXT_MISSING skip 兜底)
  const PROJ_CS = existsSync(join(DECOMPILE_DIR, 'Projectile.cs')) ? readFileSync(join(DECOMPILE_DIR, 'Projectile.cs'), 'utf8') : '';
  const MAIN_CS = existsSync(join(DECOMPILE_DIR, 'Main.cs')) ? readFileSync(join(DECOMPILE_DIR, 'Main.cs'), 'utf8') : '';

  it('反编译证据：SetDefaults 复位 spriteDirection=1（Projectile.cs:752）', () => {
    expect(PROJ_CS).toContain('\n\t\tspriteDirection = 1;');
  });

  it('反编译证据：AI_018 的 1092 支零 spriteDirection 赋值（:25712-25776 切片）', () => {
    const anchor = PROJ_CS.indexOf('frame = Main.rand.Next(6) * 9 + Main.rand.Next(3)');
    expect(anchor).toBeGreaterThan(0);
    const blockStart = PROJ_CS.lastIndexOf('if (type == 1092)', anchor);
    expect(blockStart).toBeGreaterThan(0);
    const slice = PROJ_CS.slice(blockStart, blockStart + 3200);      // 支体至 :25776 return 之前
    expect(slice).toContain('velocity.Y = -3f');                     // 切片落位哨兵
    expect(slice, '1092 支内不得出现 spriteDirection 写点').not.toContain('spriteDirection');
  });

  it('反编译证据：B 支主绘确传 dir 形参（Main.cs:34212——值恒 None,见上两证）', () => {
    expect(MAIN_CS).toContain(
      'EntitySpriteDraw(texture2D4, vector99, rectangle23, color106, proj.rotation, origin32, proj.scale, dir);',
    );
  });

  it('行为锁：BookProj.draw 无镜像（scales 空）、盒心帧心锚、rot 直传', () => {
    setProjSpriteOverride(1092, fakeTex(240, 360));
    const b = new BookProj(1000, 2000, 13, null);
    const rec = recordingCtx();
    b.draw({ ctx: rec.ctx } as never, null as never);
    expect(rec.translates).toEqual([[b.cx, b.cy]]);
    expect(rec.draws[0].args).toEqual([-20, -20, 40, 40]);           // 6×9 网格 40×40 帧
    expect(rec.scales, 'dir≡None ⇒ 恒无 scale 镜像').toEqual([]);
  });
});

// =====================================================================
// ★SW-RB11e 2026-09-10 红队补刀：641 月门自发光（AI_123 flag 支 Projectile.cs:37744
//  `Lighting.AddLight(Center, (0.3,0.9,0.7)*Opacity)`）——SW-FX6 债①清偿时漏接
//  lightRGB 表（月门在暗处既不发光自身也吃不到自身光=几乎不可见）。643 原版
//  无 AddLight（AI_123 全支唯一 AddLight 在 flag(641) 分支内）→ 恒 null。
// =====================================================================
describe.skipIf(EXT_MISSING)('SW-RB11e 债①补刀：641 lightRGB (0.3,0.9,0.7)/643 无光（Projectile.cs:37744）', () => {
  function lightOf(id: number): [number, number, number] | null {
    const { player } = makeHooks();
    return (mkMinion(id, player, true) as unknown as {
      lightRGB: [number, number, number] | null;
    }).lightRGB;
  }
  it('641 = [0.3, 0.9, 0.7]（AddLight 三通道 1:1,Opacity 增幅=常数档同 613/623 口径）', () => {
    expect(lightOf(641)).toEqual([0.3, 0.9, 0.7]);
  });
  it('643 彩虹水晶 = null（AI_123 全支唯一 AddLight 在 641 flag 支内）', () => {
    expect(lightOf(643)).toBeNull();
  });
  it('变异证红：摘 641 case → 表回退 null（判别力）', () => {
    expect(MINION_TS).toContain('case 641: return [0.3, 0.9, 0.7];');
  });
});
