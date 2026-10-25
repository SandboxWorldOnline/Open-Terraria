// Arrow 观感面缺口批金标（★2026-09-02 AI_001 出膛/尾迹 FX 清偿）——5 断言：
//   ①660 天界碎裂出膛白闪（:56642-56660）：首拍（alpha>0 门,SetDefaults α=255 →
//     首子步恒真一次）16×d180 环（scale1.5,noGravity,位=Center+椭圆偏移、速=偏移
//     单位向×1）+ Item_9 单响 + 当拍 α=0/scale=1.1——EU=1 首帧第 2 子步门已关
//   ②712 书杖弹出膛（:56662-56702）：4×d15 环（scale1.7,noGravity,速=(尘速×2+偏移
//     单位向×0.3+速度单位向×3)×0.7、位+=速×5）+ 帧链 4 拍/帧两带各 4 帧
//   ③265/355 毒系法杖弹（:57690-57724）：α=255 起步 −50/子步渐显序列、α==0 起每
//     子步 1 粒 d163/d205（α100,scale1.2,noGravity,速=弹速×0.3−弹速×0.4）
//   ④495 暗影焰弓箭尾迹（:58461-58465）：每子步 1×d27（α100,scale1.2,noGravity）
//   ⑤710 空中祸害尾迹（:56348-56380）：1/4 子步掷 d31(1/2)+d6 恒（α100、noGravity、
//     尘速×2+=弹速、fadeIn 1.22/裂片 1.5）+ 入水灭（wet → Kill）
// 附：1097 火绒狐火球（:57513-57573）出生尘爆一次性 + scale −0.01/子步 <0.3 自爆
//     （71 子步,EU=1 → ≈36 帧,先于 timeLeft=300）
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import type { GameHooks } from '../src/entities/types';
import { Arrow, setProjSpriteOverride } from '../src/entities/Arrow';
import type { Renderer } from '../src/render/Renderer';

interface DustRec {
  type: number; alpha: number; scale: number; noGravity: boolean; sx: number; sy: number;
  vx: number; vy: number; x: number; y: number; fadeIn?: number;
  noLight?: boolean; noLightEmittance?: boolean;
}

function makeGame(w: World, dusts: DustRec[], sfx: string[] = []) {
  return {
    world: w, player: null as unknown, enemies: () => [], critters: () => [],
    projectiles: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: (files: string[]) => { sfx.push(...files); },
    playSfxFile: (f: string) => { sfx.push(f); },
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    addLightAt: () => {},
    spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
      sx = 0, sy = 0, alpha = 0, _c: unknown = null, scale = 1, ng = false) => {
      const d: DustRec = {
        type, alpha, scale, noGravity: !!ng, sx, sy, vx: 0, vy: 0, x: 0, y: 0 };
      dusts.push(d);
      return d;
    },
    broadcastParticleOrchestra: () => {},
  } as unknown as GameHooks;
}

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

function flyFrames(a: Arrow, game: GameHooks, frames: number): void {
  for (let i = 0; i < frames && !a.dead; i++) a.fixedUpdate(1 / 60, game);
}

/** 录制型 ctx：只在 drawImage 时快照 globalAlpha/globalCompositeOperation（⑧ 加算
 *  合成面断言用——node 环境无 canvas,其余成员给空实现）。 */
function makeDrawCtx() {
  const calls: Array<{ ga: number; gco: string }> = [];
  let ga = 1;
  let gco = 'source-over';
  const ctx = {
    save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {}, scale: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    set globalAlpha(v: number) { ga = v; },
    get globalAlpha() { return ga; },
    set globalCompositeOperation(v: string) { gco = v; },
    get globalCompositeOperation() { return gco; },
    filter: 'none',
    imageSmoothingEnabled: false,
    drawImage: () => { calls.push({ ga, gco }); },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('Arrow 观感面缺口批金标（2026-09-02）', () => {
  it('① 660 天界碎裂：首拍 16×d180 白闪环 + Item_9 单响，随后不再出（α=0 门关）', () => {
    const dusts: DustRec[] = [];
    const sfx: string[] = [];
    const game = makeGame(emptyWorld(), dusts, sfx);
    const a = new Arrow(400, 300, 6, 0, 10, 1, 660, { grav: 0, life: 600 });
    flyFrames(a, game, 3);
    const ring = dusts.filter((d) => d.type === 180);
    expect(ring.length).toBe(16);                       // 恰一次（EU=1 首帧第 2 子步门已关）
    expect(ring.every((d) => d.scale === 1.5 && d.noGravity)).toBe(true);
    // 环几何：位=弹心+椭圆偏移（|偏移|∈[1,4]）、速=偏移单位向×1（|v|=1）
    expect(ring.every((d) => Math.hypot(d.vx, d.vy) - 1 < 1e-9)).toBe(true);
    expect(dusts.filter((d) => d.type === 180).length).toBe(16);
    expect(sfx.filter((s) => s === 'Item_9').length).toBe(1);
    expect(a.alpha).toBe(0);
    expect(a.drawScale).toBeCloseTo(1.1, 9);
  });

  it('② 712 书杖弹：出膛 4×d15 环恰一次 + 帧链 4 拍/帧带内回绕', () => {
    const dusts: DustRec[] = [];
    const sfx: string[] = [];
    const game = makeGame(emptyWorld(), dusts, sfx);
    const a = new Arrow(400, 300, 6, 0, 10, 1, 712, { grav: 0, life: 600 });
    flyFrames(a, game, 1);
    const ring = dusts.filter((d) => d.type === 15);
    expect(ring.length).toBe(4);
    expect(ring.every((d) => d.scale === 1.7 && d.noGravity)).toBe(true);
    expect(sfx.length).toBe(0);                          // 712 出膛无音（音面=武器 UseSound）
    const f0 = (a as unknown as { f712Frame: number; f712FrameT: number }).f712Frame;
    flyFrames(a, game, 5);                               // 累计 6 帧 = 12 子步 → 推帧 3 次
    const st = a as unknown as { f712Frame: number; f712FrameT: number };
    const step = (v: number): number => {
      v += 1;
      if (v === 4) v = 0;
      if (v >= 8) v = 4;
      return v;
    };
    let v = f0;
    for (let i = 0; i < 3; i++) v = step(v);
    expect(st.f712Frame).toBe(v);
    expect(st.f712FrameT).toBe(0);                       // 12 子步 → 计数器恰归零
    expect(dusts.filter((d) => d.type === 15).length).toBe(4);   // 不再出
  });

  it('③ 265 剧毒法杖：α=255 −50/子步渐显序列,α==0 起每子步 1×d163;355 同式 d205', () => {
    for (const [pid, dustId] of [[265, 163], [355, 205]] as const) {
      const dusts: DustRec[] = [];
      const game = makeGame(emptyWorld(), dusts);
      const a = new Arrow(400, 300, 6, 0, 10, 1, pid, { grav: 0 });   // life=SetDefaults
      const seq: number[] = [a.alpha];
      for (let i = 0; i < 7; i++) {
        a.fixedUpdate(1 / 60, game);
        seq.push(a.alpha);
      }
      expect(seq).toEqual([255, 205, 155, 105, 55, 5, 0, 0]);   // 6 子步归零（EU=0）
      const dTrail = dusts.filter((d) => d.type === dustId);
      expect(dTrail.length).toBe(2);                            // α==0 的第 6/7 拍各 1 粒
      expect(dTrail.every((d) => d.alpha === 100 && d.scale === 1.2 && d.noGravity)).toBe(true);
      expect(dusts.filter((d) => d.type !== dustId).length).toBe(0);
    }
  });

  it('④ 495 暗影焰弓箭：每 tick 恰 1×d27 尾迹（α100,scale1.2,noGravity）', () => {
    const dusts: DustRec[] = [];
    const game = makeGame(emptyWorld(), dusts);
    const a = new Arrow(400, 300, 6, 0, 10, 1, 495, { grav: 0, life: 600 });
    flyFrames(a, game, 10);
    const t = dusts.filter((d) => d.type === 27);
    expect(t.length).toBe(10);
    expect(t.every((d) => d.alpha === 100 && d.scale === 1.2 && d.noGravity)).toBe(true);
  });

  it('⑤ 710 空中祸害：1/4 子步掷尘（d31 半率 + d6 恒,fadeIn 1.22/裂片 1.5）+ 入水灭', () => {
    const dusts: DustRec[] = [];
    const game = makeGame(emptyWorld(), dusts);
    const a = new Arrow(400, 300, 6, 0, 10, 1, 710, { grav: 0, life: 600 });
    flyFrames(a, game, 40);                              // EU=1 → 80 子步
    const d6 = dusts.filter((d) => d.type === 6);
    const d31 = dusts.filter((d) => d.type === 31);
    expect(d6.length).toBeGreaterThanOrEqual(7);         // 期望 20（80×1/4）,±3.4σ 带宽防 flake
    expect(d6.length).toBeLessThanOrEqual(33);
    expect(d31.length).toBeLessThanOrEqual(d6.length);   // d31 = d6 的 1/2 率
    expect(d6.every((d) => d.alpha === 100 && d.scale === 1.2 && d.noGravity)).toBe(true);
    expect(d6.every((d) => d.fadeIn === 1.22)).toBe(true);          // 本体 ai[1]=0 档
    expect(a.alpha).toBe(0);                             // −25/子步早已归零
    // 裂片（abShard=ai[1]=-1）档 fadeIn=1.5
    const dusts2: DustRec[] = [];
    const game2 = makeGame(emptyWorld(), dusts2);
    const s = new Arrow(400, 300, 6, 0, 10, 1, 710, { grav: 0, life: 600 });
    s.abShard = true;
    flyFrames(s, game2, 40);
    const d6s = dusts2.filter((d) => d.type === 6);
    expect(d6s.length).toBeGreaterThan(0);
    expect(d6s.every((d) => d.fadeIn === 1.5)).toBe(true);
    // 入水灭：置水环境（湿旗经 wetCacheConsumer 逐子步刷新）→ 1/4/子步概率 Kill
    const w2 = emptyWorld();
    const st2 = w2.store;
    for (let x = 20; x < 36; x++) for (let y = 16; y < 26; y++) {
      const i = st2.idx(x, y);
      st2.liquid[i] = 255; st2.liquidType[i] = 1;
    }
    const dusts3: DustRec[] = [];
    const game3 = makeGame(w2, dusts3);
    const w = new Arrow(656, 320, -6, 0, 10, 1, 710, { grav: 0, life: 600 });
    for (let i = 0; i < 60 && !w.dead; i++) w.fixedUpdate(1 / 60, game3);
    expect(w.dead).toBe(true);                           // (3/4)^120 ≈ 3e-15 漏杀率
  });

  it('⑥ 1097 火绒狐火球：出生尘爆一次性（10×双 d6）+ scale 收缩自爆（71 子步）', () => {
    const dusts: DustRec[] = [];
    const sfx: string[] = [];
    const game = makeGame(emptyWorld(), dusts, sfx);
    const a = new Arrow(400, 300, 6, 0, 10, 1, 1097, { grav: 0, life: 300 });
    expect(a.drawScale).toBeCloseTo(1, 9);
    flyFrames(a, game, 1);
    // 出生尘爆：10×(细尘 scale×0.7 + 大尘 scale×1.25)——与 1/4 掷尾迹尘(scale×1.3)
    // 按 scale 区分（首帧 2 子步尾迹命中 0..2 粒）
    const bornA = dusts.filter((d) => d.type === 6 && Math.abs(d.scale - 0.7) < 1e-9);
    const bornB = dusts.filter((d) => d.type === 6 && Math.abs(d.scale - 1.25) < 1e-9);
    const trail = dusts.filter((d) => d.type === 6 && Math.abs(d.scale - 1.3) < 1e-9);
    expect(bornA.length).toBe(10);
    expect(bornB.length).toBe(10);
    expect(trail.length).toBeLessThanOrEqual(2);
    expect([...bornA, ...bornB].every((d) => d.noLightEmittance)).toBe(true);
    expect(bornA.every((d) => d.alpha === 200)).toBe(true);
    expect(bornB.every((d) => d.alpha === 50)).toBe(true);
    expect(sfx).toContain('Item_20');
    expect(sfx).toContain('dd2_betsy_fireball_shot');
    expect(a.dead).toBe(false);
    flyFrames(a, game, 30);                              // 累计 31 帧 = 62 子步（scale≈0.38）
    expect(a.dead).toBe(false);
    flyFrames(a, game, 10);                              // 71 子步 → scale<0.3 自爆
    expect(a.dead).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★2026-09-02 遗留批金标：⑦ 1097 tileCollide 动态翻转（:58255-58269）/
//   ⑧ 265·355 α==0 期加算白合成面（GetAlpha :81286-81293 → alpha0additive 档）
// ---------------------------------------------------------------------------
describe('Arrow 遗留批金标（2026-09-02 ②）', () => {
  it('⑦ 1097 tileCollide 动态翻转：SetDefaults false 起步 → 下坠期撞块/上升期穿墙 → 40 子步后恒撞块', () => {
    // 起始值：数据表 tileCollide=false（SetDefaults :10236）→ ctor noTileCollide=true
    const down = new Arrow(400, 288, 6, 5, 10, 1, 1097, { life: 300 });
    const up = new Arrow(400, 288, 6, -5, 10, 1, 1097, { life: 300 });
    const gate = (a: Arrow) => (a as unknown as { noTileCollide: boolean }).noTileCollide;
    expect(gate(down)).toBe(true);
    expect(gate(up)).toBe(true);
    const game = makeGame(emptyWorld(), []);
    flyFrames(down, game, 1);                            // vy=5>0 → tileCollide=true
    expect(gate(down)).toBe(false);
    flyFrames(up, game, 1);                              // vy=−5<0 → tileCollide=false（穿墙）
    expect(gate(up)).toBe(true);
    // 40 子步（EU=1 → 20 帧）后恒撞块：强置 vy<0 仍 tileCollide=true（age≥40 支与 vy 无关）
    flyFrames(down, game, 19);
    expect(down.age).toBeGreaterThanOrEqual(40);
    (down as unknown as { vy: number }).vy = -5;
    flyFrames(down, game, 1);
    expect(gate(down)).toBe(false);
    // 上升期分支在 age≥40 后不再生效（age<40 支同参对照=曾会置 true）
    flyFrames(up, game, 19);                             // 40 子步，vy 仍由重力链负向? grav=+0.15@40 → 已趋正
    expect(gate(up)).toBe(false);
  });

  it("⑧ 265/355 α>0 期全隐（ga=0）/ α==0 期 ga=1 + 'lighter' 加算白；charm 分流走常规合成", () => {
    setProjSpriteOverride(265, { width: 12, height: 12 } as unknown as HTMLImageElement);
    setProjSpriteOverride(355, { width: 12, height: 12 } as unknown as HTMLImageElement);
    const game = makeGame(emptyWorld(), []);
    const a = new Arrow(400, 288, 6, 0, 10, 1, 265, { grav: 0 });
    const snap = (arr: Array<{ ga: number; gco: string }>) => arr[0];
    const c1 = makeDrawCtx();
    a.draw({ ctx: c1.ctx } as unknown as Renderer, {} as never);
    expect(a.alpha).toBe(255);
    expect(snap(c1.calls)).toEqual({ ga: 0, gco: 'lighter' });   // α>0→Transparent：入组 lighter 但 ga=0 零贡献
    flyFrames(a, game, 6);                               // −50/子步 ×6 → α==0
    expect(a.alpha).toBe(0);
    const c2 = makeDrawCtx();
    a.draw({ ctx: c2.ctx } as unknown as Renderer, {} as never);
    expect(snap(c2.calls)).toEqual({ ga: 1, gco: 'lighter' });   // (255,255,255,0) A=0 满强加算白
    // 355 同档
    const b = new Arrow(400, 288, 6, 0, 10, 1, 355, { grav: 0 });
    flyFrames(b, game, 6);
    const c3 = makeDrawCtx();
    b.draw({ ctx: c3.ctx } as unknown as Renderer, {} as never);
    expect(snap(c3.calls)).toEqual({ ga: 1, gco: 'lighter' });
    // ★charm 分流（M-2 同案）：aiStyle=1 被 :80605-80611 White*Opacity 截走 → 常规合成
    a.phoenixQuivered = true;
    // whiteSpriteOf 需要 document.createElement（charm 白帧烘焙）——node 环境打桩
    const ctx2d = {
      imageSmoothingEnabled: false, globalCompositeOperation: 'source-over',
      fillStyle: '#fff', drawImage: () => {}, fillRect: () => {},
    };
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
    });
    try {
      const c4 = makeDrawCtx();
      a.draw({ ctx: c4.ctx } as unknown as Renderer, {} as never);
      expect(snap(c4.calls)).toEqual({ ga: 1, gco: 'source-over' });  // α=0 → White×Opacity 满亮
      const c5 = makeDrawCtx();
      (a as unknown as { alpha: number }).alpha = 100;
      a.draw({ ctx: c5.ctx } as unknown as Renderer, {} as never);
      expect(snap(c5.calls).ga).toBeCloseTo((255 - 100) / 255, 9);
      expect(snap(c5.calls).gco).toBe('source-over');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ===========================================================================
// 斗篷星 alpha 渐减金标（2026-09-03）——723-726/1133 starY 通道接 α 面
// ===========================================================================
describe('斗篷星 alpha 渐减金标（2026-09-03）', () => {
  it('⑨ 723 斗篷星：α=50 起 −15/t,线上钳 100 / Center.Y>=ai[1] 越线后钳 0（:7655/:24165-24176）', () => {
    const game = makeGame(emptyWorld(), []);
    const targetY = 120 * 16;
    // 出生于目标线上方（100*16 < 120*16）——线上期 α 先减后上钳 100（num44）
    const a = new Arrow(80 * 16, 100 * 16, 0, 2, 75, 5, 723, { star: { targetY } });
    expect(a.starAlpha).toBe(50);                       // SetDefaults :7655（PROJ_ALPHA0 注入）
    flyFrames(a, game, 1);
    expect(a.starAlpha).toBe(100);                      // 50−15=35 <100 → 上钳 100
    flyFrames(a, game, 10);
    expect(a.starAlpha).toBe(100);                      // 线上恒钳 100
    // 拽到目标线下（Center.Y >= ai[1]）→ 下限 0,−15/t 渐显至全亮
    a.y = targetY + 8;
    flyFrames(a, game, 1);
    expect(a.starAlpha).toBe(85);
    flyFrames(a, game, 6);
    expect(a.starAlpha).toBe(0);                        // 85→70→…→0 下限 0
    flyFrames(a, game, 5);
    expect(a.starAlpha).toBe(0);
    // 回归线：503 星怒星 α 面不变（255 起 −15/子步,线上钳 150——:24151-24158 num43;
    //  EU=1 → 2 子步/拍 → 每游戏拍 −30,与原版 AI()×2 同拍）
    const b = new Arrow(80 * 16, 100 * 16, 0, 2, 95, 5, 503, { star: { targetY } });
    expect(b.starAlpha).toBe(255);
    flyFrames(b, game, 1);
    expect(b.starAlpha).toBe(225);                      // 255−15×2（150 钳未触及）
  });
});

// ===========================================================================
// 出膛音面金标（2026-09-03,AI_001 出膛音链 83/576 清偿）——原版 ai[1]==0 首拍:
// 弹 83 = SoundID.Item33（Projectile.cs:56195-56199）、弹 576 = SoundID.Item12
// （:56443-56447）。本仓两弹走 Arrow 直飞桶无 ai[1] 态,于发射点等价结算（同
// 462/259 先例,bossAI.ts shootBolt462 / bossAI_golem.ts golemEyeLasers）
// ===========================================================================
describe('出膛音面金标（2026-09-03:83→Item_33 / 576→Item_12 发射位）', () => {
  it('①雷眼/机械眼激光 83：bossAI.ts 发射位紧邻 shoot(…83) 播 Item_33', () => {
    const src = readFileSync(new URL('../src/entities/bossAI.ts', import.meta.url), 'utf8');
    // ★BJ164 清偿锚更新（2026-09-18）：发射口已补显式寿命 `, 600`（Projectile.cs:1646
    //  SetDefaults 承载,同 WOF 先例）——旧锚 `), 83);` 自补参日起失配(陈旧金标再生,
    //  断言语义不变:发射位 shoot 后 240 字窗内播 Item_33)
    const m = src.match(
      /getAttackDamageForProjectiles\(20, 19, e\.difficulty\), 83, 600\);[\s\S]{0,240}?playSfxWav\?\.\('Item_33'/);
    expect(m, 'bossAI.ts 弹 83 出膛位缺 Item_33 播放').toBeTruthy();
  });

  it('②星旋脑线发激光 576：bossAI_lunar_misc.ts 发射位紧邻 Arrow(…576) 播 Item_12', () => {
    const src = readFileSync(new URL('../src/entities/bossAI_lunar_misc.ts', import.meta.url), 'utf8');
    // ★R10 锚序纠:音在 Arrow 构造【后】(发射位等价结算=弹先出生后补播,与原版
    // ai[1]==0 首拍同拍)——正则改从 Arrow(…576) 向后窗找 Item_12
    // ★SW-FX9(2026-09-10)：`, null,`（旧 dropKey 占位实参）已随回收链摘除,窗匹配
    // 改按 576 出生实参尾锚
    // ★BJ710-C(2026-10-25)：窗 320→420——576 发射位合法增重（ArrowOpts 增
    //  bannerNpcId 旗透传=574 子弹继承父弹旗,FindBannerToAssociateTo :11110-11113）,
    // 断言语义不变(出膛音仍锚在 576 出生语句块内)
    const m = src.match(
      /576,[\s\S]{0,420}?playSfxWav\?\.\('Item_12'/);
    expect(m, 'bossAI_lunar_misc.ts 弹 576 出膛位缺 Item_12 播放').toBeTruthy();
  });
});

// ===========================================================================
// 出膛音面金标·dormant 族清偿（2026-09-03 任务一）——原版 AI_001 出膛音链
// （Projectile.cs:56196-56340,aiStyle 1 弹 ai[1]==0 首拍）逐型核对后,发射方已实装
// 且音缺的 9 型在发射位补播（弹先出生后补播,同 83/576 先例）：
//   100 DeathLaser→Item_33(:56273-56277)   110 BulletSnowman→Item_11(:56211-56215)
//   438 RayGunnerLaser→Item_12(:56221-56225) 592 MartianWalkerLaser→Item_12(:56232-56235)
//   1073 PoisonDartShotFromSlimes→Item_17(:56284-56287) 195 PygmySpear→Item_17(:56298-56302)
//   389 MiniRetinaLaser→Item_12(:56263-56267) 408 MiniSharkron→Item_19(:56201-56205,
//   legacy PlaySound(4,x,y,19)=Item 系 19 号) 275/276 SeedPlantera→Item_17(:56303-56312)
// dormant 备案（发射方在禁碰域 WeaponProj.ts:4065,不动）：248 FlowerPowPetal→Item_17
//   (:56323-56327,发射方=FlowerPow 花粉锤弹 247 命中链, item 1259→proj 247)
// 259/593 本就已在位（bossAI_golem golemEyeLasers×2 / bossAI_lategame ancientDoomAI）。
// ===========================================================================
describe('出膛音面金标·dormant 族（2026-09-03 任务一:9 型发射位补播）', () => {
  const readSrc = (rel: string): string =>
    readFileSync(new URL(rel, import.meta.url), 'utf8');

  it('①毁灭者段/雷眼三阶激光 100：bossAI.ts 发射位播 Item_33（共 4 口,抽 2 口锚验）', () => {
    const src = readSrc('../src/entities/bossAI.ts');
    // 雷眼三阶悬浮激光口（NPC.cs:26991-27005）
    // ★BJ164 清偿锚更新（2026-09-18）：该口已补显式寿命 `, 2700`（Projectile.cs:1884
    //  SetDefaults 承载,BJ164 双子批）——旧锚 `), 100);` 失配(陈旧金标再生,断言
    //  语义不变:发射位 shoot 后 240 字窗内播 Item_33)
    expect(src.match(
      /getAttackDamageForProjectiles\(25, 23, e\.difficulty\), 100, 2700\);[\s\S]{0,240}?playSfxWav\?\.\('Item_33'/),
      'bossAI.ts 雷眼三阶弹 100 出膛位缺 Item_33').toBeTruthy();
    // 毁灭者段链激光口（NPC.cs:50204-50241）
    expect(src.match(
      /22, 18, e\.difficulty\), 100, 300\);[\s\S]{0,240}?playSfxWav\?\.\('Item_33'/),
      'bossAI.ts 毁灭者段弹 100 出膛位缺 Item_33').toBeTruthy();
  });

  it('②机枪雪球 110：bossAI_moon_events.ts 发射位紧邻 shootE(…110) 播 Item_11', () => {
    const src = readSrc('../src/entities/bossAI_moon_events.ts');
    // ★BJ710-G35 D1（2026-10-25）：发射位合法增重（143 旗透传 opts 尾参）——窗按
    //  BJ710-C「576 出膛音」判例放宽（Item_11 紧邻语义不变）
    const m = src.match(
      /shootE\(game, ox, oy, 12 \* e\.facing, 0, 25, 110,[^;]*\);[\s\S]{0,240}?playSfxWav\?\.\('Item_11'/);
    expect(m, 'bossAI_moon_events.ts 弹 110 出膛位缺 Item_11 播放').toBeTruthy();
  });

  it('③骑手激光 438：bossAI_martian.ts 发射位紧邻 shootM(…438) 播 Item_12', () => {
    const src = readSrc('../src/entities/bossAI_martian.ts');
    const m = src.match(
      /shootM\(game, oxp, oyp, sx, sy, 30, 438,[^;]*\);[\s\S]{0,520}?playSfxWav\?\.\('Item_12'/);
    expect(m, 'bossAI_martian.ts 弹 438 出膛位缺 Item_12 播放').toBeTruthy();
  });

  it('④激光枪手 438/火星行者 592：Enemy.ts RANGED 通用支按 projId 播 Item_12', () => {
    const src = readSrc('../src/entities/Enemy.ts');
    const m = src.match(
      /spawnHostileProj\(game, ox2, oy2, vx, vy, dmgF, proj\);[\s\S]{0,320}?proj === 438 \|\| proj === 592[\s\S]{0,120}?playSfxWav\?\.\('Item_12'/);
    expect(m, 'Enemy.ts RANGED 通用支缺 438/592 → Item_12 播放').toBeTruthy();
  });

  it('⑤携物史莱姆毒镖 1073：Enemy.ts 发射位紧邻 spawnHostileProj(…1073) 播 Item_17', () => {
    const src = readSrc('../src/entities/Enemy.ts');
    const m = src.match(
      /spawnHostileProj\(game, this\.cx, this\.cy, this\.facing \* 12, 0, 20, 1073\);[\s\S]{0,320}?playSfxWav\?\.\('Item_17'/);
    expect(m, 'Enemy.ts 弹 1073 出膛位缺 Item_17 播放').toBeTruthy();
  });

  it('⑥俾格米掷矛 195/双子激光眼 389/迷你鲨鱼龙 408：MinionProj.ts MINION_SHOT_SFX 三项在表', () => {
    const src = readSrc('../src/entities/MinionProj.ts');
    expect(src.match(/195: \{ track: 'Item_17', vol: 0\.7 \}/),
      'MINION_SHOT_SFX 缺 195→Item_17').toBeTruthy();
    expect(src.match(/389: \{ track: 'Item_12', vol: 0\.7 \}/),
      'MINION_SHOT_SFX 缺 389→Item_12').toBeTruthy();
    // ★BJ692 勘误:408 原文 PlaySound(4,x,y,19)=legacy type4 NpcKilled 库 style19
    //（非 Item 库——Item 库=type 2）;旧金标 'Item_19' 系编号域误读,随刀改判。
    expect(src.match(/408: \{ track: 'NPC_Killed_19', vol: 0\.7 \}/),
      'MINION_SHOT_SFX 缺 408→NPC_Killed_19').toBeTruthy();
    // 双消费口都在（ai62Step 口 + AI_026/aiStyle66 通用口）——漏一口=该族静音
    expect((src.match(/MINION_SHOT_SFX\[shooter\.shot\]/g) ?? []).length >= 2,
      'MINION_SHOT_SFX 消费口少于 2').toBeTruthy();
  });

  it('⑦普兰黛拉种子 275/276：bossAI_queenbee_plantera.ts 发射位播 Item_17（277 除外）', () => {
    const src = readSrc('../src/entities/bossAI_queenbee_plantera.ts');
    const m = src.match(
      /num806, num807, life, arrowOpts\);[\s\S]{0,320}?num807 === 275 \|\| num807 === 276[\s\S]{0,120}?playSfxWav\?\.\('Item_17'/);
    expect(m, 'bossAI_queenbee_plantera.ts 弹 275/276 出膛位缺 Item_17 播放').toBeTruthy();
  });
});
