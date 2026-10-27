// 旋转三件套台账"仍遗留"四件清偿批（docs/rotation-parity-ledger.md 遗留表）：
//   ① 546 怒滚草——台账"DrawNPC :62640-62741 态机"经对读实为 AI_110_Betsy 段误归属；
//     真身 = AI_026_Unicorns 尾部一行累积式（NPC.cs:63365-63369）：
//     rotation += velocity.X×0.05（持续滚转）+ spriteDirection = −direction（镜像取反）。
//   ② 76/75 火星飞碟族 392-395——核心 395 ai0==1 相位摆动→整周自旋（cs:36644-36662）
//     AI 已写 visAngle（bossAI_martian），缺派发门；部件 392/393/394 rotation=主体
//     rotation + 锚偏移 RotatedBy（cs:35813-35817/:35871-35872/:35883-35884）全缺。
//     原版 case 392-395 base+GlowMask 同 rotation 同 origin 二次 Draw（Main.cs:24202-24231）
//     ——本仓 drawNpcGlow 在本体同一变换内叠画 → rotate 一次双层跟随，glow 管线零改动。
//   ③ 487 蛆——FindFrame case 485-487（cs:73511-73561）四态：贴地 0 / 腾空 +=dir×0.1 /
//     坡面钉 ±0.785。wormCritterAI spin 通道已并入（前批"补齐"）+ stR66 门 +
//     wormMirror 豁免（485-487 spriteDirection=direction 保镜像）——本批以对拍锁死。
//   ④ 664 火把神——FindFrame（:75656）rotation = vx×0.1 + spriteDirection=sign(vx)
//     （:75648-75655 死区档）。原版/本仓均无 664 生成路径（事件本体=弹幕 949，
//     664 仅图鉴记账 Player.cs:37109-37116）→ 写点走 findFrameRotation 层（纯 vx 函数，
//     ★BJ588 起并入 FF_VXSDIR_GROUP 15 型族支），派发门按 id 预置，
//     镜像走 ffSdir 门（曾走通用 facing 门=收编前近似,BJ588 勘误）。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { Renderer } from '../src/render/Renderer';
import { martianSaucerAI, martianSaucerPartAI } from '../src/entities/bossAI_martian';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import type { World as WorldT } from '../src/world/World';

const W = 200, H = 80, FLOOR = 60;

function makeWorld(): World {
  const w = new World(W, H, 11, 'rot-remainder');
  const st = w.store;
  for (let x = 0; x < W; x++) st.setTile(x, FLOOR, 1);
  w.clock.timeOfDay = 0.9;
  return w;
}

function makeHooks(w: World, playerAt?: { x: number; y: number } | null) {
  const rec = { enemies: [] as Enemy[], projectiles: [] as unknown[] };
  let nextId = 1;
  const em = {
    nextId,
    add: (e: unknown, bucket: string) => {
      (e as { id: number }).id = nextId++;
      if (bucket === 'enemies') rec.enemies.push(e as Enemy);
      else rec.projectiles.push(e);
    },
  };
  const player = new Player((playerAt?.x ?? 80) * TILE, (playerAt?.y ?? FLOOR - 4) * TILE, new Inventory());
  const hooks = {
    world: w, player: playerAt === null ? null : player,
    enemies: () => rec.enemies, critters: () => [], npcs: () => [],
    damagePlayer: (): number => 0, spawnDrop: () => null, addDamageNumber: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    spawnBurst: () => {}, addLightAt: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, cutTile: () => {},
    scene: { zoneGraveyard: false },
    entities: em,
  } as unknown as GameHooks;
  return { hooks, rec, player, em };
}

function spawn(h: { rec: { enemies: Enemy[] }; em: { nextId: number } }, id: number, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(id, tx * TILE, ty * TILE)!;
  e.id = h.em.nextId++;
  h.rec.enemies.push(e);
  return e;
}

const drive = (e: Enemy, fn: string) =>
  (e as unknown as Record<string, (...a: unknown[]) => void>)[fn];

/** 记录型 ctx 的 drawEnemy 直调（antlion-tilt 同款假体 + 可配帧矩形，供枢轴断言） */
function drawWithFake(e: Enemy, w: WorldT, rect = { sw: 8, sh: 8 }): Array<{ m: string; a: unknown[] }> {
  const calls: Array<{ m: string; a: unknown[] }> = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (k === 'canvas' ? undefined : (...a: unknown[]) => { calls.push({ m: String(k), a }); }),
  });
  const rectStub = { img: { width: rect.sw, height: rect.sh }, sx: 0, sy: 0, sw: rect.sw, sh: rect.sh };
  const fake = {
    ctx,
    assets: { enemySprites: new Map() },
    atlas: { vnpc: () => rectStub, ensureVImage: () => null, vmisc: () => null },
    drawNpcGlow: () => {},
    npcWhiteLiftQueue: [] as unknown[],   // ★BJ504：395 入队面（本测只断言 rotate/scale,队列丢弃）
    // ★BJ731 补桩（2026-10-27）：drawEnemy 白提亮分支（刀2-C1 mod fullbright 族）
    //   读 this.isBehindTilesEnemy(e)——假体缺方法=TypeError（moonlord-ellipse
    //   同款桩,false=非钻地层走白提亮评估面）。
    isBehindTilesEnemy: () => false,
  };
  (Renderer.prototype as unknown as { drawEnemy: (this: unknown, e: Enemy, w: WorldT) => void })
    .drawEnemy.call(fake, e, w);
  return calls;
}
const rotOf = (calls: Array<{ m: string; a: unknown[] }>) => calls.find((c) => c.m === 'rotate');
const flips = (calls: Array<{ m: string; a: unknown[] }>) =>
  calls.filter((c) => c.m === 'scale' && (c.a as number[])[0] === -1 && (c.a as number[])[1] === 1);

// ---------------------------------------------------------------------------
// ① 546 怒滚草（AI_026 cs:63365-63369）
// ---------------------------------------------------------------------------
describe('546 怒滚草：滚转累积 + 派发 + 反翻镜像', () => {
  it('态机对拍：chargerAI 每帧 visAngle += vx×0.05 持续累积（无态机,台账 Betsy 段误归属勘误）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 120, y: FLOOR - 6 });
    const e = spawn(h, 546, 40, FLOOR - 1);
    e.facing = 1; e.vx = 4;                     // 满速滚（num11=4 无风沙尘暴档,不衰减不加速）
    drive(e, 'chargerAI').call(e, h.hooks, h.player);
    expect(e.visAngle).toBeCloseTo(0.2, 5);     // 4×0.05
    drive(e, 'chargerAI').call(e, h.hooks, h.player);
    expect(e.visAngle).toBeCloseTo(0.4, 5);     // 累积（rotation 从不复位——滚转语义）
  });

  it('派发门：rotate(visAngle) 直转生效（中心锚后枢轴天然=帧中心,无往返平移）', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 546, 40, FLOOR - 1);
    e.visAngle = 1.25;
    const calls = drawWithFake(e, w, { sw: 30, sh: 30 });
    const rot = rotOf(calls);
    expect(rot, '应有 rotate(visAngle)——aiStyle 26 曾无门').toBeTruthy();
    expect((rot!.a as number[])[0]).toBeCloseTo(1.25, 5);
    // 2026-08-24 中心锚勘误：原点=盒中心=帧中心,XNA origin=halfSize 枢轴天然对齐,
    // 曾按底锚写的往返平移（−sh/2+4/scale 对）已删——断言无 0-x translate 残留
    const trs = calls.filter((c) => c.m === 'translate' && (c.a as number[])[0] === 0)
      .map((c) => (c.a as number[])[1]);
    expect(trs, '枢轴往返平移应已删（中心锚后直转）').toEqual([]);
  });

  it('镜像门归属：spriteDirection=−direction（cs:63368）→ facing<0 才翻（反翻档,不进 rotationDriven）', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 546, 40, FLOOR - 1);
    e.visAngle = 0.3; e.facing = 1;
    expect(flips(drawWithFake(e, w)).length, 'facing=1(direction=1)→spriteDirection=-1 不翻').toBe(0);
    e.facing = -1;
    expect(flips(drawWithFake(e, w)).length, 'facing=-1→spriteDirection=1 翻（与通用档相反）').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 301 渡鸦（墓地乌鸦，FindFrame :74257-74271）——2026-08-26 用户实报"倒飞"清偿：
//   贴图原生朝右（5 帧喙均在右），FindFrame 专属支 spriteDirection 为【有态写点】
//   （落地=-direction / 飞行 vx>0.5→-1、vx<-0.5→1 / |vx|≤0.5 死区保前值）——
//   态机在 Enemy.findFrameRotation（原版 FindFrame 每 tick AI 后跑,离屏也更新），
//   渲染层仅按 Main.cs:22984 `spriteDirection==1` 镜像。
//   曾落通用镜像档（facing>0 翻）=恒倒飞；rotation=vx×0.1（:74287）此前已接。
// ---------------------------------------------------------------------------
describe('301 渡鸦：vx 倾斜 + spriteDirection 有态滞回（贴图原生朝右的反翻族）', () => {
  it('FindFrame 对拍：visAngle = vx×0.1（:74287 rotation=velocity.X×0.1）', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 301, 40, 20);
    e.vx = 2.5;
    drive(e, 'findFrameRotation').call(e);
    expect(e.visAngle).toBeCloseTo(0.25, 5);
    e.vx = -1;
    drive(e, 'findFrameRotation').call(e);
    expect(e.visAngle).toBeCloseTo(-0.1, 5);
  });

  it('spriteDirection 态机对拍（:74257-74271）：飞行速度向滞回（死区保前值）、落地=-direction', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 301, 40, 20);
    // 飞行右行 → sdir=-1；减速入死区（|vx|≤0.5）保前值 -1
    e.vy = 1; e.vx = 2; e.facing = 1;
    drive(e, 'findFrameRotation').call(e);
    expect(e.ravenSdir, '飞行右行→-1').toBe(-1);
    e.vx = 0.3;
    drive(e, 'findFrameRotation').call(e);
    expect(e.ravenSdir, '死区保前值 -1').toBe(-1);
    // 反向穿越死区仍保前值，直到 vx<-0.5 才翻 1
    e.vx = -0.3;
    drive(e, 'findFrameRotation').call(e);
    expect(e.ravenSdir, '死区负侧仍保 -1').toBe(-1);
    e.vx = -2;
    drive(e, 'findFrameRotation').call(e);
    expect(e.ravenSdir, 'vx<-0.5 → 1').toBe(1);
    // 落地：sdir = -direction
    e.vy = 0; e.vx = 0; e.facing = 1;
    drive(e, 'findFrameRotation').call(e);
    expect(e.ravenSdir, '落地 direction=1 → -1（背向玩家）').toBe(-1);
    e.facing = -1;
    drive(e, 'findFrameRotation').call(e);
    expect(e.ravenSdir, '落地 direction=-1 → 1').toBe(1);
  });

  it('镜像门：渲染仅消费 ravenSdir==1（Main.cs:22984），不叠 facing 门', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 301, 40, 20);
    // sdir=1（向左飞/落地背向）→ 翻，即使 facing=1（受击退瞬态速度与 direction 异号）
    e.ravenSdir = 1; e.facing = 1; e.visAngle = 0.25;
    expect(flips(drawWithFake(e, w)).length, 'sdir=1→翻（不叠 facing<0 门）').toBe(1);
    e.facing = -1;
    expect(flips(drawWithFake(e, w)).length, 'sdir=1→翻').toBe(1);
    // sdir=-1 → 不翻（向右飞/死区保前值）
    e.ravenSdir = -1;
    expect(flips(drawWithFake(e, w)).length, 'sdir=-1→不翻（倒飞回归锁）').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ② 76/75 火星飞碟族 392-395
// ---------------------------------------------------------------------------
describe('火星飞碟族：核心相位摆动 + 部件继承/公转 + 派发镜像归属', () => {
  it('核心 395 态机对拍（martianSaucerAI ai0==1,cs:36644-36662）：三档摆动幅/整周段/完成归 0', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 395, 80, 20);
    e.bInit = true;                              // 跳过首帧部件生成块（其内 ai0/ai1 清零会覆写预设）
    e.ai0 = 1;
    e.ai1 = 9;
    martianSaucerAI(e, h.hooks, null);                          // ai1→10 → 首档 cos(10/40·2π)×0.2
    // ★UnitY.RotatedBy(θ).Y=cosθ（Utils.cs:1752-1761;V5 复核纠正——曾锁 sin 值 0.2,
    //  实为 cos(π/2)×0.2=0;补中相断言防 sin/cos 再翻转）
    expect(e.visAngle).toBeCloseTo(Math.cos((10 / 40) * Math.PI * 2) * 0.2, 5);
    expect(e.visAngle).toBeCloseTo(0, 5);                       // ai1=10 → θ=π/2 → cos=0（sin 会给 0.2）
    e.ai1 = 49;
    martianSaucerAI(e, h.hooks, null);                          // ai1→50 → 二档 θ=50/20·2π=5π → cos=−1→−0.3（sin=0 可鉴别）
    expect(e.visAngle).toBeCloseTo(-0.3, 5);
    e.ai1 = 134;                                                // →135 ≥120 整周段 (135-120)/30·2π
    martianSaucerAI(e, h.hooks, null);
    expect(e.visAngle).toBeCloseTo((15 / 30) * Math.PI * 2, 5);
    e.ai1 = 149;                                                // →150 完成态：归 0 + ai0=2
    martianSaucerAI(e, h.hooks, null);
    expect(e.ai0).toBe(2);
    expect(e.visAngle).toBe(0);
    martianSaucerAI(e, h.hooks, null);                          // ai0==2 恒 0（cs:36748）
    expect(e.visAngle).toBe(0);
  });

  it('部件继承对拍（martianSaucerPartAI）：rotation=主体 rotation、锚偏移 RotatedBy 公转', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const core = spawn(h, 395, 80, 20);
    core.ai0 = 5; core.ai3 = 0;                 // 非 0/2 态：避开部件全灭自毁/空巢导弹随机路径
    core.visAngle = 1.2;
    const c = Math.cos(1.2), s = Math.sin(1.2);
    const hull = spawn(h, 392, 80, 20);         // 锚 (0,2)
    hull.master = core;
    martianSaucerPartAI(hull, h.hooks, null);
    expect(hull.visAngle, '部件 rotation=主体 rotation（cs:35816-35817）').toBe(1.2);
    expect(hull.x).toBeCloseTo(core.cx - hull.w / 2 + (-2 * s), 5);
    expect(hull.y).toBeCloseTo(core.cy - hull.h / 2 + (2 * c), 5);
    expect(hull.facing, '392 随主体 spriteDirection=默认 -1 不翻（core.facing 默认 1 不可直取）').toBe(-1);

    const cannon = spawn(h, 394, 80, 20);       // ai1=1 → 锚 (49,-13)、spriteDirection=+1
    cannon.master = core; cannon.ai1 = 1;
    martianSaucerPartAI(cannon, h.hooks, null);
    expect(cannon.visAngle).toBe(1.2);
    expect(cannon.x).toBeCloseTo(core.cx - cannon.w / 2 + (49 * c + 13 * s), 5);
    expect(cannon.y).toBeCloseTo(core.cy - cannon.h / 2 + (49 * s - 13 * c), 5);
    expect(cannon.facing).toBe(1);
  });

  it('派发门+镜像归属：核心 rotationDriven（facing=1 也不翻）;部件 392/393/394 接 rotate、394 保留翻面', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const core = spawn(h, 395, 80, 20);
    core.visAngle = 0.5; core.facing = 1;
    const cc = drawWithFake(core, w);
    expect((rotOf(cc)!.a as number[])[0], '核心 stR===76 门（AI 已写 visAngle 曾无消费）').toBeCloseTo(0.5, 5);
    expect(flips(cc).length, '核心 spriteDirection 恒默认从不写 → rotationDriven 禁镜像').toBe(0);

    const hull = spawn(h, 392, 80, 20);
    hull.visAngle = 0.5; hull.facing = -1;
    const hc = drawWithFake(hull, w);
    expect((rotOf(hc)!.a as number[])[0], '部件 stR===75 逐 id 门（390/416/492 不接）').toBeCloseTo(0.5, 5);

    const cannon = spawn(h, 394, 80, 20);
    cannon.visAngle = 0; cannon.facing = 1;
    expect(flips(drawWithFake(cannon, w)).length, '394 spriteDirection=±1 按 ai[1]（:35886）→ 仍翻面').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ③ 487 蛆（FindFrame case 485-487,cs:73511-73561 四态;wormCritterAI spin 通道）
// ---------------------------------------------------------------------------
describe('487 蛆：四态 spin 对拍 + 派发 + 镜像豁免', () => {
  it('四态对拍：贴地 0 / 腾空 +=facing×0.1 累积 / 坡面钉 ±0.785（覆写自旋）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 120, y: FLOOR - 6 });
    const g = spawn(h, 487, 40, FLOOR - 1);      // 贴地（盒 10×4 精确落在 FLOOR 顶）
    g.y = FLOOR * TILE - g.h; g.vy = 0;
    g.ai0 = 1; g.facing = 1;
    drive(g, 'wormCritterAI').call(g, h.hooks);
    expect(g.spin, '贴地 rotation=0（cs:73521 vy==0 分支）').toBe(0);

    const a = spawn(h, 487, 60, FLOOR - 12);     // 腾空
    a.vy = 2; a.facing = 1;
    drive(a, 'wormCritterAI').call(a, h.hooks);
    expect(a.spin).toBeCloseTo(0.1, 5);
    drive(a, 'wormCritterAI').call(a, h.hooks);
    expect(a.spin, '腾空累积（cs:73536 rotation += direction×0.1）').toBeCloseTo(0.2, 5);

    const st = w.store;
    const s1 = spawn(h, 487, 80, FLOOR - 1);     // 坡面 +0.785（检头顶格）
    s1.y = FLOOR * TILE - s1.h; s1.vy = 0;
    s1.ai0 = 1; s1.facing = 1;
    st.slope[st.idx(Math.floor(s1.cx / TILE), Math.floor(s1.y / TILE))] = 1;
    drive(s1, 'wormCritterAI').call(s1, h.hooks);
    expect(s1.spin, 'slope1 钉 +0.785（cs:73553-73556,覆写自旋）').toBeCloseTo(0.785, 3);
    const s2 = spawn(h, 487, 100, FLOOR - 1);
    s2.y = FLOOR * TILE - s2.h; s2.vy = 0;
    s2.ai0 = 1; s2.facing = 1;
    st.slope[st.idx(Math.floor(s2.cx / TILE), Math.floor(s2.y / TILE))] = 2;
    drive(s2, 'wormCritterAI').call(s2, h.hooks);
    expect(s2.spin, 'slope2 钉 −0.785（cs:73557-73560）').toBeCloseTo(-0.785, 3);
  });

  it('派发门+镜像门：stR66 rotate(spin) 生效;蛆虫族 485-487 spriteDirection=direction → 保留通用镜像', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 487, 40, FLOOR - 12);
    e.spin = 0.5; e.facing = 1;
    const calls = drawWithFake(e, w);
    expect((rotOf(calls)!.a as number[])[0], 'AI_066 门 rotate(spin)（wormCritterAI 维护）').toBeCloseTo(0.5, 5);
    expect(flips(calls).length, 'wormMirror 豁免 485-487（cs:73515 设 direction）→ facing=1 翻').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ④ 664 火把神（FindFrame cs:75558;无生成路径的图鉴实体,三件套预置）
// ---------------------------------------------------------------------------
describe('664 火把神：vx 档旋转 + 派发 + 镜像归属', () => {
  it('态机对拍：findFrameRotation rotation = vx×0.1（纯 vx 函数,FindFrame :75558）', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const ff = (id: number, vx: number) => {
      const e = spawn(h, id, 40, FLOOR - 3);
      e.vx = vx;
      (e as unknown as { findFrameRotation: () => void }).findFrameRotation();
      return e.visAngle;
    };
    expect(ff(664, 2)).toBeCloseTo(0.2, 5);
    expect(ff(664, -3)).toBeCloseTo(-0.3, 5);
    expect(ff(664, 0)).toBe(0);
  });

  it('派发门+镜像门：rotate(visAngle) 生效;sdir=sign(vx) 死区档（:75648-75655）→ ★BJ588 起 ffSdir 门（不再走通用 facing 门）', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 664, 40, FLOOR - 3);
    e.visAngle = 0.3; e.facing = 1;
    const calls = drawWithFake(e, w);
    expect((rotOf(calls)!.a as number[])[0], '664 按 id 门（aiStyle 0 无族门可挂）').toBeCloseTo(0.3, 5);
    // ★BJ588 勘误：旧断言「facing=1 → 通用门翻」钉的是收编前近似——原版 sdir 是
    // FindFrame 死区档写（vx==0 不写=保前值,字段缺省 -1;direction 与 sdir 两字段）,
    // facing=1 且 vx=0 时原版 sdir=-1 → 不翻。本仓现以 ffSdir 承载（缺省 -1 同相）。
    expect(flips(calls).length, 'vx=0 死区档：ffSdir 缺省 -1 = 原生朝向不翻').toBe(0);
    // vx>0 拍：findFrameRotation 写 ffSdir=1 → 翻（≙ 原版 sdir==1）
    e.vx = 0.5;
    (e as unknown as { findFrameRotation: () => void }).findFrameRotation();
    const calls2 = drawWithFake(e, w);
    expect(flips(calls2).length, 'vx>0 → ffSdir=1 → 翻（sdir==1 门）').toBe(1);
  });
});
