// ★BJ707-G31 登记债清偿·坐骑染料/尘发射面五件（G29 新登记四债 + lavaTime 邻行债）
// ——逐件定谳判语（1457 亲读,先定谳再动刀;发射几何逐行锚）:
//
// 件1 [G29 登记债1] recall 'spawn' 支 lavaTime 复位 →【修·一行】
//   定谳:Player.Spawn 无条件复位段 :37874 `lavaTime = lavaMax`（紧邻 :37875
//   lavaOpacity——G29 已修 opacity,lavaTime 独立语义=岩浆宽限（护身符族 420t）
//   随 recall 直回满）;recall 族（魔镜/回忆药水/回归药水,:37789/:43324/:43459
//   三路汇流 RecallFromItem）也是 Spawn face=同段生效;Teleport 面（ocean/hell/
//   random/worldSpawn）vanilla 无此复位=不写（与 lavaOpacity 同门同相）。
//   修:Game.ts fireRecallTeleport spawn 支 lavaImmuneTicks=equipStats.lavaMax
//   （respawn face :53248 同式;equipStats=活装备直读=vanilla lavaMax 同拍值）。
//
// 件2 [G29 登记债2] cMount 未实现发射方尘面 →【修·四族 1:1 + 染料接线】
//   定谳（仓内存量普查）:海盗船 44（环爆发 :3961-3987 + steady :3988-4007）/
//   惊魂木 45（环爆发 :4022-4054 + steady :4055-4071）/扫帚 23（spark :4877-4889
//   + swirl :4890-4915,UpdateEffects）/蜥蜴 14（面 1 :4129-4149 尘 31×2 +
//   cMount==0 移位 FloorVisuals(Falling);面 2 :4150-4169 蓄能尘 6 环）四族
//   仓内【整缺】;case-14 旧近似=借 dashDust 发 6 型 14 粒环（spread=0——
//   尘型/计数/几何三面全偏 vs 原版 2×31+蓄能环）。
//   修:updateFrame case 44/45 新臂（44 含 :3950 state=1 强制跑动组——纯组覆写
//   case 7/48 同形,旧缺=静止船帆动画冻结;沿闩 _mountSpecificData rising edge
//   → dashBurst）+ updateMountEffects 四族发射面（ctx.vanillaDust 直入 +
//   ctx.mountDyeVid()（miscDyes[3] 单源,G29 通道）→ d.dyeVid）;14 族移出
//   dashDust 家族（10/47 不受扰）。落地拍 TryLanding 双调双掷=10/47 族既有
//   单掷口径（登记）。
//
// 件3 [G29 登记债3] 迅猛龙 54 眼睑 →【修·渲染小面】
//   定谳:PlayerDrawLayers.cs:2655-2658——骑 54 时（mountHandlesHeadDraw=
//   mountDrawsEyelid 恒 54,PlayerDrawSet.cs:1811-1818）眼睑【无 HidesHead 门】
//   恒画,color=GetImmuneAlpha(GetColorClamped(MountedCenter 格,(158,92,67)),
//   shadow)（基色非 skinColor——色面无染也可见）,shader=cMount（★眼睑唯一吃
//   坐骑染料的绘制面;普通面 skinDyePacked vanilla 恒 0=死字段（Player.cs:9678
//   唯一写位清零,全树零他写）=零染维持仓内现状）。head==288 支（:2660-2663）
//   色覆写 Black+帧强钉 2（染料保留）。仓内等价:eyelidFrameRaptor 基色 (158,
//   92,67) 烘 tint（head288 → 黑底）+ dyeBakeArmorSprite 染料烘焙（甲件族序）
//   + 实体窗 compositeLight 采光乘 + immune 闪烁随调用位 globalAlpha(bodyAlpha)。
//   veloHead 调用位旧传 HIDES_HEAD 门=288 族误吞,补 headId 传参。
//
// 件4 [G29 登记债4] cMinecart 尘染料通道 →【范围定谳·登记任务书（矿车域整刀）】
//   定谳:仓内零发射方——vanilla 全量 census 七面（DoGemMinecartEffect :4742
//   尘 86-91/262、DoSteamMinecartEffect :4759 case 36 尘 303、
//   DoExhaustMinecartEffect :4778 case 32 尘 31、DoConfettiMinecartEffect :4814
//   case 34 纸屑 139+N(4)、case 11 Mech 轨迹尘 182 :5072-5135、case 22 Hell
//   尘 65 :5136-5178）均未实现=接线无从落;SparksMeow 的固定 shader
//   （DelegateMethods.cs:401 GetShaderFromItemId(2870)——非 cMinecart）另案。
//   落地任务书=Minecart.ts census 注（本测 §D 锁）:补七发射面 + minecartDyeVid()
//   （miscDyes[2] 同径单源）。
//
// 件5 [本刀新观察,登记不落刀] veloHead 头盔缺 CanDrawOnVelociraptorMount 门
//   （vanilla PlayerDrawLayers.cs:2107-2110:type==54 ∧ head≥0 ∧ !
//   CanDrawOnVelociraptorMount[head] → 整头层跳过;仓 veloHead 无判=任意头盔
//   在迅猛龙上照画——注释 :21353-21355 声称有门而码无,甲渲染域另派）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MountInstance, FRAME_STANDING, FRAME_RUNNING, type MountedPlayerView, type MountEffectsCtx } from '../src/entities/Mounts';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { VDust } from '../src/fx/VanillaDust';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = {
  game: readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8'),
  player: readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8'),
  mounts: readFileSync(join(ROOT, 'src/entities/Mounts.ts'), 'utf8'),
  renderer: readFileSync(join(ROOT, 'src/render/Renderer.ts'), 'utf8'),
  doll: readFileSync(join(ROOT, 'src/player/PaperDoll.ts'), 'utf8'),
  cart: readFileSync(join(ROOT, 'src/entities/Minecart.ts'), 'utf8'),
};

const mkDust = (type: number, over: Partial<VDust> = {}): VDust => ({
  active: true, x: 0, y: 0, vx: 0, vy: 0, type, scale: 1, alpha: 0, fadeIn: 0,
  noGravity: false, noLight: false, noLightEmittance: false, color: null, rotation: 0,
  fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1, followEnt: null, attractTo: null,
  ...over,
}) as VDust;

/** 收集型尘池（记录 spawn 全实参;后置字段写进返回尘） */
function collectPool(): {
  recs: Array<Record<string, unknown>>;
  dusts: VDust[];
  pool: import('../src/fx/VanillaDust').VanillaDust;
} {
  const recs: Array<Record<string, unknown>> = [];
  const dusts: VDust[] = [];
  return {
    recs, dusts,
    pool: {
      spawn(x: number, y: number, w: number, h: number, type: number,
        speedX = 0, speedY = 0, alpha = 0, color: unknown = null, scale = 1,
        opts?: { perfect?: boolean }) {
        recs.push({ x, y, w, h, type, speedX, speedY, alpha, color, scale, opts: opts ?? null });
        const d = mkDust(type, { x, y, vx: speedX, vy: speedY, alpha, scale, color: color as VDust['color'] });
        dusts.push(d);
        return d;
      },
    } as unknown as import('../src/fx/VanillaDust').VanillaDust,
  };
}

function makeView(over: Partial<MountedPlayerView> = {}): MountedPlayerView {
  return {
    x: 400, y: 400, w: 20, h: 42, vx: 0, vy: 0, onGround: true, inWater: false,
    facing: 1, inputX: 1, inputJump: false, inputUp: false, inputDown: false,
    prevInputJump: false, gravDir: 1, store: null,
    ...over,
  };
}

const FISHRON = {
  hp: 100, maxHp: 100, inWater: false, inLava: false, inHoney: false,
  dripping: false, raining: false, windExposed: false,
};

/** updateMountEffects 合成 ctx（dyeVid=-1 缺省;over 覆写） */
function mkCtx(over: Partial<MountEffectsCtx> = {}, pool?: import('../src/fx/VanillaDust').VanillaDust): MountEffectsCtx {
  return {
    scutlixTargets: [], los: () => false,
    fishron: FISHRON,
    vanillaDust: pool,
    mountDyeVid: () => -1,
    miscCounter: 0,
    ...over,
  } as MountEffectsCtx;
}

const RED_DYE_VID = 1007;

function fakeHooks(w?: World, p?: Player): GameHooks {
  return {
    world: w ?? { weather: {} }, player: p, enemies: () => [], critters: () => [], npcs: () => [],
    damagePlayer: (): number => 0, spawnDrop: () => null, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {}, playSfxFile: () => {},
    showPickupLabel: () => {}, recLog: () => {},
    spawnDust: () => mkDust(0),
  } as unknown as GameHooks;
}

afterEach(() => { vi.restoreAllMocks(); });

// ===================== §A 件1:lavaTime recall 复位 =====================
describe('BJ707-G31 §A 件1 recall spawn 支 lavaTime=lavaMax（:37874 邻行债清偿）', () => {
  it('A1 spawn 支双键同段:lavaOpacity（G29 锁保持）+ lavaImmuneTicks=lavaMax（G31;★BJ713-A 扩聚合含 cartLavaMaxBonus）,门序=fallStartY 之后', () => {
    expect(SRC.game).toContain("if (c.kind === 'spawn') p.lavaOpacity = 1;");
    expect(SRC.game).toContain("if (c.kind === 'spawn') p.lavaImmuneTicks = p.equipStats.lavaMax + p.cartLavaMaxBonus;");
    // 门序（G29 C2 同式）:复位键在 Teleport 公共段（fallStartY）之后同域
    //（★BJ713-A:窗 600→1000——同域判据不收窄,扩聚合判语注加长所致）
    const iFall = SRC.game.indexOf('p.fallStartY = null;      // fallStart 重置');
    const iLavaT = SRC.game.indexOf("if (c.kind === 'spawn') p.lavaImmuneTicks = p.equipStats.lavaMax + p.cartLavaMaxBonus;");
    expect(iFall).toBeGreaterThan(0);
    expect(iLavaT).toBeGreaterThan(iFall);
    expect(iLavaT - iFall).toBeLessThan(1000);
    // lavaTime 键紧随 lavaOpacity 键（同段邻行序;窗 400→600 同因）
    const iLavaO = SRC.game.indexOf("if (c.kind === 'spawn') p.lavaOpacity = 1;");
    expect(iLavaT).toBeGreaterThan(iLavaO);
    expect(iLavaT - iLavaO).toBeLessThan(600);
  });

  it('A2 全 Game.ts lavaImmuneTicks 直写恰两处（respawn :53248 + recall spawn 支）——Teleport 面零写', () => {
    const writes = SRC.game.match(/p\.lavaImmuneTicks = [^;]+;/g) ?? [];
    expect(writes.length).toBe(2);
    expect(writes.every((w) => w.includes('equipStats.lavaMax'))).toBe(true);
  });

  it('A3 判语注在案:Player 湿段 lavaVision 注含 G31 清偿标记（防再按 lavaTime 债登记;★BJ713-A 聚合扩注在案）', () => {
    expect(SRC.player).toContain('★BJ707-G31 清偿:邻行 :37874 lavaTime=lavaMax');
    expect(SRC.player).toContain('同两支落 lavaImmuneTicks=equipStats.lavaMax——同段同相,债清;★BJ713-A:recall');
  });
});

// ===================== §B 件2:cMount 尘发射面四族（行为锁） =====================
describe('BJ707-G31 §B 件2 cMount 尘发射面四族 1:1（44/45/23/14）', () => {
  it('B1 海盗船 44:rising edge 20×尘 228 环（染料 vid 全带）+ steady 每拍 1 粒;闩沿单调;state=1 强制跑动组', () => {
    const m = new MountInstance();
    const v = makeView({ vx: 6 });
    m.setMount(44, v as never);
    // 上升沿:updateFrame（vanilla 阈 DashSpeed−RunSpeed/4=6−0.75=5.25,vx=6 过门）
    m.updateFrame(v, FRAME_STANDING, 6, 0);
    expect(m.dashBurst).toBe(true);
    expect(m.dashBurstLatched).toBe(true);
    expect(m.frameState).toBe(FRAME_STANDING);            // 纯组覆写（vanilla _frameState=分派态）
    // 发射:环 20 + steady 1（vx=6 → num8=(int)3−(int)6=−3 钳 1=恒掷）
    const a = collectPool();
    const floorDust: number[] = [];
    m.updateMountEffects(v, mkCtx({
      vanillaDust: a.pool, mountDyeVid: () => RED_DYE_VID,
      basiliskFloorDust: (sx) => { floorDust.push(sx); },
    }, a.pool));
    expect(a.dusts.length).toBe(21);
    const ring = a.dusts.filter((d) => d.fadeIn === 0);
    const steady = a.dusts.filter((d) => d.fadeIn >= 0.5);
    expect(ring.length).toBe(20);                          // :3966-3986
    for (const d of ring) {
      expect(d.type).toBe(228);
      expect(d.noGravity).toBe(true);
      expect(d.scale).toBeGreaterThanOrEqual(1.5);
      expect(d.scale).toBeLessThanOrEqual(2.3);
      expect(d.dyeVid).toBe(RED_DYE_VID);                  // :3985 shader=cMount
      const ax = v.x + v.w / 2 + v.w, ay = v.y + v.h / 2;  // Center+(width·dir,0)
      expect(Math.abs((d.x - ax) / 40)).toBeLessThanOrEqual(0.8 + 1e-9);   // 环半径 (40,30)×0.8
      expect(Math.abs((d.y - ay) / 30)).toBeLessThanOrEqual(0.8 + 1e-9);
    }
    expect(steady.length).toBe(1);                         // :3988-4007
    const s = steady[0]!;
    expect(s.type).toBe(228);
    expect(s.noLight).toBe(true);
    expect(s.vx).toBe(0); expect(s.vy).toBe(0);
    expect(s.dyeVid).toBe(RED_DYE_VID);                    // :4006
    const sRec = a.recs.find((r) => r.type === 228 && r.h === 22)!;
    const num10 = Math.trunc(v.w / 2) + 10;                // :3994
    expect(sRec.x).toBeCloseTo(v.x + v.w / 2 - num10, 5);  // Bottom−(num10,16)
    expect(sRec.y).toBeCloseTo(v.y + v.h - 16, 5);
    expect(sRec.w).toBe(num10 * 2);
    expect(floorDust.length).toBe(0);                      // 44 族无地板尘回调
    // state=1 强制跑动组:静立分派 10 拍后帧仍推进（无覆写则 standing 组 count=1 恒 0）
    for (let i = 0; i < 10; i++) m.updateFrame(v, FRAME_STANDING, 6, 0);
    expect(m.frame).toBeGreaterThan(0);
    // 次拍（闩已锁）:无环,steady 恒 1
    m.updateFrame(v, FRAME_STANDING, 6, 0);
    expect(m.dashBurst).toBe(false);
    const b = collectPool();
    m.updateMountEffects(v, mkCtx({ vanillaDust: b.pool, mountDyeVid: () => RED_DYE_VID }, b.pool));
    expect(b.dusts.length).toBe(1);
    expect(b.dusts[0]!.fadeIn).toBeGreaterThanOrEqual(0.5);
    // 下降沿清闩
    m.updateFrame(makeView({ vx: 0 }), FRAME_STANDING, 0, 0);
    expect(m.dashBurstLatched).toBe(false);
  });

  it('B2 惊魂木 45:rising edge 20×尘 6 环 + steady flag4 每拍 1 粒（31 支三分一）', () => {
    const m = new MountInstance();
    const v = makeView({ vx: 15 });
    m.setMount(45, v as never);
    m.updateFrame(v, FRAME_RUNNING, 15, 0);                 // 阈 16×0.9=14.4
    expect(m.dashBurst).toBe(true);
    expect(m.dashing).toBe(true);                           // flag4=steady 门
    const a = collectPool();
    m.updateMountEffects(v, mkCtx({ vanillaDust: a.pool, mountDyeVid: () => RED_DYE_VID }, a.pool));
    expect(a.dusts.length).toBe(21);
    // 环/steady 判别:环 vx=−(ux+runSpeed−1) ≤ −10.2（vx>0 翻 X;runSpeed=12）;
    // steady vx=vx×0.1=1.5（steady 的 fadeIn 掷缺省 0 不可作判别量）
    const ring = a.dusts.filter((d) => d.vx < -5);
    expect(ring.length).toBe(20);
    for (const d of ring) {
      expect(d.type).toBe(6);                               // :4023（与 44 环同构,型 6）
      expect(d.noGravity).toBe(true);
      expect(d.fadeIn).toBe(0);
      expect(d.dyeVid).toBe(RED_DYE_VID);                   // :4046
    }
    const steady45 = a.dusts.filter((d) => d.vx > -5);
    expect(steady45.length).toBe(1);
    expect(steady45[0]!.vx).toBeCloseTo(1.5, 5);            // :4059 v×0.1
    expect([6, 31]).toContain(steady45[0]!.type);
    // steady 31 支（次拍闩锁后单发;spy 序:t31 掷 0.1 → 31;noGravity 0.9;scale 0.5;fadeIn 0.9）
    m.updateFrame(v, FRAME_RUNNING, 15, 0);                // 闩已锁:无新环
    expect(m.dashBurst).toBe(false);
    const b = collectPool();
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9).mockReturnValueOnce(0.5).mockReturnValueOnce(0.9);
    m.updateMountEffects(v, mkCtx({ vanillaDust: b.pool, mountDyeVid: () => -1 }, b.pool));
    expect(b.dusts.length).toBe(1);
    const d31 = b.dusts[0]!;
    expect(d31.type).toBe(31);                              // SelectRandom(6,6,31) 1/3 支
    expect(d31.noGravity).toBe(true);                       // 31 支覆写
    expect(d31.scale).toBeCloseTo((0.7 + 0.5 * 0.8) * 1.5, 5);  // ×1.5 覆写
    expect(d31.fadeIn).toBe(0.2);                           // 31 支覆写
    expect(d31.dyeVid).toBe(-1);                            // 空槽 -1 穿透（零漂移）
    expect(b.recs[0]!.x).toBeCloseTo(v.x + v.w / 2 - 6, 5); // Center−(6,−6) 盒 12×12
    expect(b.recs[0]!.y).toBeCloseTo(v.y + v.h / 2 + 6, 5);
    // 下降沿
    m.updateFrame(makeView({ vx: 0 }), FRAME_RUNNING, 0, 0);
    expect(m.dashBurstLatched).toBe(false);
    expect(m.dashing).toBe(false);
  });

  it('B3 扫帚 23:spark（1/45,NextVector2Circular(4,4) 偏移+followPlayer+perfect α254 黄 0.3）+ swirl（num13 门→8 点各 1/15,椭圆(0.5,1)×4 旋 fullRotation）', () => {
    const m = new MountInstance();
    const v = makeView({ vx: 0, vy: 0 });                   // 摆角=0（风 0/露天假/静立）
    m.setMount(23, v as never);
    // spark:spy 序=门 0.0 / 圆角 0.25 / 半径 0.5 → v12=(0,2),速度=(0,0.2)
    const a = collectPool();
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0.0).mockReturnValueOnce(0.25).mockReturnValueOnce(0.5)
      .mockReturnValueOnce(1).mockReturnValueOnce(1);      // 尾:pos4 掷+swirl 门（>num13=0.1 不进）
    m.updateMountEffects(v, mkCtx({ vanillaDust: a.pool, mountDyeVid: () => RED_DYE_VID, miscCounter: 0 }, a.pool));
    expect(a.dusts.length).toBe(1);
    const sp = a.dusts[0]!;
    expect(sp.type).toBe(43);
    expect(sp.followPlayer).toBe(true);                     // :4886 customData=mountedPlayer
    expect(sp.noLightEmittance).toBe(true);                 // :4885
    expect(sp.fadeIn).toBe(0.3);                            // :4884
    expect(sp.dyeVid).toBe(RED_DYE_VID);                    // :4888
    expect(sp.vx).toBeCloseTo(0, 6); expect(sp.vy).toBeCloseTo(0.2, 6);  // DirectionTo×0.2
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    expect(a.recs[0]!.x).toBeCloseTo(cx + 29 * 1 + Math.cos(Math.PI / 2) * 11 + 0, 5);  // 挂件位+偏移
    expect(a.recs[0]!.y).toBeCloseTo(cy - 4 + Math.sin(Math.PI / 2) * 11 + 2, 5);
    expect(a.recs[0]!.alpha).toBe(254);
    expect((a.recs[0]!.color as { r: number }).r).toBe(255);
    expect(a.recs[0]!.scale).toBe(0.3);
    expect(a.recs[0]!.opts).toEqual({ perfect: true });     // NewDustPerfect 通道
    // swirl:spy 序=spark 门 0.9（跳过）/ pos4 掷 0.9 / 门 0.0 / num14 0.0 /
    // 8×点掷（前 3 中 1/15 门,后 5 空）——共 12 掷
    const b = collectPool();
    const spy2 = vi.spyOn(Math, 'random');
    spy2.mockReturnValueOnce(0.9).mockReturnValueOnce(0.9).mockReturnValueOnce(0.0).mockReturnValueOnce(0.0);
    for (let i = 0; i < 3; i++) spy2.mockReturnValueOnce(0.0);
    for (let i = 0; i < 5; i++) spy2.mockReturnValueOnce(0.5);
    m.updateMountEffects(v, mkCtx({ vanillaDust: b.pool, mountDyeVid: () => -1, miscCounter: 0 }, b.pool));
    expect(b.dusts.length).toBe(3);
    const p4x = cx + 18 - 20 * 0.9;                          // :4892
    const p5x = cx + 52, p5y = cy - 6;                       // :4893
    // 点 0:num15=0 → a=0 → (2·cos0, 4·sin0)=(2,0)
    const d0 = b.dusts[0]!;
    expect(d0.x).toBeCloseTo(p4x + 2, 5);
    expect(d0.y).toBeCloseTo(cy + 12 + 0, 5);
    expect(d0.noLightEmittance).toBe(true);
    expect(d0.fadeIn).toBe(0.3);
    expect(d0.dyeVid).toBe(-1);
    expect(d0.followPlayer).toBeFalsy();                     // swirl 无 customData
    const dl = Math.hypot(p4x + 2 - p5x, cy + 12 - p5y);
    expect(d0.vx).toBeCloseTo(2 * 0.025 + (p4x + 2 - p5x) / dl * 0.5, 5);
    expect(d0.vy).toBeCloseTo(0 * 0.025 + (cy + 12 - p5y) / dl * 0.5, 5);
    // 点 2:num15=0.25 → a=π/2 → (0,4)
    const d2 = b.dusts[2]!;
    expect(d2.x).toBeCloseTo(p4x + 0, 5);
    expect(d2.y).toBeCloseTo(cy + 12 + 4, 5);
  });

  it('B4 蜥蜴 14:面 1=2×尘 31 底盒（染料全带;cMount==0 → ±24 移位地板尘,有染不调）;面 2=floor(3×charge)×尘 6 环;vy≠0/背向门', () => {
    const m = new MountInstance();
    const v = makeView({ vx: 8, vy: 0 });                   // runSpeed 8 → num=8>4
    m.setMount(14, v as never);
    m.updateFrame(v, FRAME_RUNNING, 8, 0);
    expect(m.dashing).toBe(true);
    expect(m.dashBurst).toBe(false);                        // 旧近似旗已退役
    m.basiliskCharge = 1;                                   // 面 2 计数=3
    // 有染:2×31 + 3×6,地板尘不调
    const a = collectPool();
    const floorDust: number[] = [];
    m.updateMountEffects(v, mkCtx({
      vanillaDust: a.pool, mountDyeVid: () => RED_DYE_VID,
      basiliskFloorDust: (sx) => { floorDust.push(sx); },
    }, a.pool));
    expect(a.dusts.filter((d) => d.type === 31).length).toBe(2);   // :4131
    for (const d of a.dusts.filter((d) => d.type === 31)) {
      expect(d.noLight).toBe(true);
      expect(d.vx).toBeCloseTo(8 * 0.15, 5);                // :4133 vx×0.15
      expect(d.vy).toBeLessThanOrEqual(0);                  // :4134 r×−2
      expect(d.dyeVid).toBe(RED_DYE_VID);                   // :4138
    }
    const r31 = a.recs.find((r) => r.type === 31)!;
    expect(r31.x).toBe(v.x); expect(r31.y).toBe(v.y + v.h); // BottomLeft 盒 (w,6)
    expect(r31.w).toBe(v.w); expect(r31.h).toBe(6);
    expect(a.dusts.filter((d) => d.type === 6).length).toBe(3);    // :4151 floor(3×1)=3
    for (const d of a.dusts.filter((d) => d.type === 6)) {
      expect(d.noGravity).toBe(true);
      expect(d.noLight).toBe(true);
      expect(d.dyeVid).toBe(RED_DYE_VID);                   // :4168
    }
    expect(floorDust.length).toBe(0);                       // cMount!=0 → 不调（:4140 门）
    // 面 2 速度式（spy 序:面 1 两尘各 3 掷=6×0.9 → 面 2 单尘 dy 掷 0.5/spd 掷 0;
    // dv=(−2,0)/2×3.5=−3.5,+v×0.55=+4.4 → ×|v|/RunSpeed(1)×charge(1/3)）
    const b = collectPool();
    const spy = vi.spyOn(Math, 'random');
    for (let i = 0; i < 6; i++) spy.mockReturnValueOnce(0.9);
    spy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);
    m.basiliskCharge = 1 / 3;                               // 单粒:floor(3×1/3)=1
    m.updateMountEffects(v, mkCtx({ vanillaDust: b.pool, mountDyeVid: () => -1,
      basiliskFloorDust: (sx) => { floorDust.push(sx); } }, b.pool));
    const ring6 = b.dusts.filter((d) => d.type === 6);
    expect(ring6.length).toBe(1);
    expect(ring6[0]!.vx).toBeCloseTo((-3.5 + 8 * 0.55) * (1 / 3), 5);   // :4155-4160 ×charge
    expect(ring6[0]!.vy).toBeCloseTo(0, 5);
    expect(floorDust).toEqual([24]);                        // cMount==0 → +24 移位地板尘
    // vy≠0:面 1 关
    m.basiliskCharge = 0;
    const c = collectPool();
    m.updateMountEffects(makeView({ vx: 8, vy: -1 }), mkCtx({
      vanillaDust: c.pool, mountDyeVid: () => -1,
      basiliskFloorDust: (sx) => { floorDust.push(sx); },
    }, c.pool));
    expect(c.dusts.filter((d) => d.type === 31).length).toBe(0);
    expect(floorDust).toEqual([24]);                        // 无新增
    // 背向:面 2 关（面 1 照发,移位 −24）
    const d4 = collectPool();
    m.updateMountEffects(makeView({ vx: -8, vy: 0, facing: 1 }), mkCtx({
      vanillaDust: d4.pool, mountDyeVid: () => -1,
      basiliskFloorDust: (sx) => { floorDust.push(sx); },
    }, d4.pool));
    expect(d4.dusts.filter((x) => x.type === 6).length).toBe(0);   // charge=0 → 0 粒（背向亦关）
    expect(d4.dusts.filter((x) => x.type === 31).length).toBe(2);  // 面 1 不看朝向
    expect(floorDust).toEqual([24, -24]);                   // sign(−8)=−1 → −24
  });

  it('B5 旧近似退役+10/47 族回归锁:14 不再借 dashDust;10/47 照走 ctx.dashDust（G29 通道不受扰）', () => {
    // 结构锁:旧近似调用句已退役
    expect(SRC.mounts).not.toContain('ctx.dashDust(p.x, p.y + p.h - 6, 2, 0, 6)');
    expect(SRC.mounts).toMatch(/\(this\.type === 10 \|\| this\.type === 47\) && \(this\.dashing \|\| this\.dashBurst\)/);
    // 行为锁:独角兽 10（dashSpeed12/runSpeed4 → 阈 10,vx=13）
    const m10 = new MountInstance();
    const v10 = makeView({ vx: 13 });
    m10.setMount(10, v10 as never);
    m10.updateFrame(v10, FRAME_RUNNING, 13, 0);
    expect(m10.dashBurst).toBe(true);
    const calls10: number[][] = [];
    const bodies10: number[] = [];
    m10.updateMountEffects(v10, mkCtx({
      dashDust: (...a2: number[]) => { calls10.push(a2); },
      dashDustBody: (t: number) => { bodies10.push(t); },
    }));
    expect(calls10.length).toBe(1);
    expect(calls10[0]![2]).toBe(14);                        // 14 粒环（:3906）
    expect(calls10[0]![3]).toBe(1);                         // frameExtra 首拍
    expect([176, 177, 179]).toContain(calls10[0]![4]);
    expect(bodies10.length).toBe(1);                        // 独角兽追尾尘
    // 山羊 47:同径,型 6,无追尾
    const m47 = new MountInstance();
    const v47 = makeView({ vx: 13 });
    m47.setMount(47, v47 as never);
    m47.updateFrame(v47, FRAME_RUNNING, 13, 0);
    const calls47: number[][] = [];
    const bodies47: number[] = [];
    m47.updateMountEffects(v47, mkCtx({
      dashDust: (...a2: number[]) => { calls47.push(a2); },
      dashDustBody: (t: number) => { bodies47.push(t); },
    }));
    expect(calls47.length).toBe(1);
    expect(calls47[0]![4]).toBe(6);
    expect(bodies47.length).toBe(0);
  });
});

// ===================== §C 件3:迅猛龙 54 眼睑（结构锁） =====================
describe('BJ707-G31 §C 件3 迅猛龙 54 眼睑 (158,92,67)×光+cMount 染料', () => {
  it('C1 drawEyelid raptor 覆写面:恒画（无 HidesHead 门）+ eyelidFrameRaptor 基色/cMount 染料 + head==288 黑底全闭帧', () => {
    expect(SRC.renderer).toContain('const raptor = p.ridingMount && p.mount.type === 54;');
    expect(SRC.renderer).toContain('if (!raptor && (p.eyeFrame === 0 || hideFace)) return;');
    expect(SRC.renderer).toContain('const black288 = raptor && headId === 288;');
    expect(SRC.renderer).toContain('const frame = black288 ? 2 : p.eyeFrame;');
    expect(SRC.renderer).toMatch(/eyelidFrameRaptor\(p\.appearance, p\.mountDyeVid\(\), black288\)/);
  });

  it('C2 PaperDoll.eyelidFrameRaptor:基色 (158,92,67)/head288 黑底 + dyeBakeArmorSprite 染料烘焙（甲件族序）+ 普通面 skinDyePacked 死字段判语', () => {
    expect(SRC.doll).toContain('export function eyelidFrameRaptor(a: Appearance, dyeVid: number, black = false)');
    expect(SRC.doll).toContain('const base = black ? { r: 0, g: 0, b: 0 } : { r: 158, g: 92, b: 67 };');
    expect(SRC.doll).toContain('dyed = dyeBakeArmorSprite(raw, dyeVid);');
    expect(SRC.doll).toContain('skinDyePacked 在 vanilla 恒 0');
  });

  it('C3 veloHead 调用位传 headId（288 支判据源）;主路径/死亡路径缺省不可达（mntHidden）', () => {
    expect(SRC.renderer).toContain('this.drawEyelid(ctx, p, vr.body, 4, HIDES_HEAD.has(vh.head ?? 0), vh.head ?? 0);');
  });
});

// ===================== §D 件4:cMinecart 定谳锁（登记任务书） =====================
describe('BJ707-G31 §D 件4 cMinecart 尘染料通道（范围定谳·登记任务书）', () => {
  // ★BJ709-G32③（2026-10-24）:任务书已执行（Minecart.updateEffectsDust 七尘面+
  //  Player.minecartDyeVid()）——本组锁随刀从「census 定谳锁」更新为「实现锚锁」
  //  （G30 sw-fx6 同判例:陈桩更新分开记账,判别力随实现面迁移;行为锁全集见
  //  tests/bj709g32-final-residuals.test.ts §C）。
  it('D1 census 七面任务书在案 → G32 已清偿（census 注转实现锚,发射面/单源在位）', () => {
    expect(SRC.cart).toContain('★BJ709-G32③（2026-10-24,G31 登记债④任务书落地——census 定谳注转实现锚）');
    expect(SRC.cart).toContain('doGemMinecartEffect（Mount.cs:4742-4756');
    expect(SRC.cart).toContain('mechTrailDust（case 11 MinecartMech 轨迹尘 182 :5072-5135 尘面');
    expect(SRC.cart).toContain('hellMinecartDust（case 22 Hell 尘 65 :5136-5178 尘面');
    expect(SRC.cart).toContain('Player.minecartDyeVid() 同 mountDyeVid 径单源');
    expect(SRC.player).toContain('cMinecart = miscDyes[2].dye');   // :9688 判语锚
  });

  it('D2 SparksMeow 固定 shader（GetShaderFromItemId(2870)）另案债注在案——非 cMinecart 勿混', () => {
    expect(SRC.cart).toContain('GetShaderFromItemId(2870)');
    expect(SRC.cart).toContain('另案勿混');
  });
});

// ===================== §E 装配链:Player ctx 接线（含 basiliskFloorDust 移位闭包） =====================
describe('BJ707-G31 §E Player.mountEffectsCtx 装配链（vanillaDust/mountDyeVid/wind/basiliskFloorDust）', () => {
  const ctxOf = (p: Player, game: GameHooks): Record<string, (...a: unknown[]) => unknown> =>
    (p as unknown as { mountEffectsCtx: (g: GameHooks) => Record<string, (...a: unknown[]) => unknown> }).mountEffectsCtx(game);

  it('E1 结构锁:四新键装配在位（单源通道勿重建）', () => {
    expect(SRC.player).toContain('vanillaDust: game.vanillaDust,');
    expect(SRC.player).toContain('mountDyeVid: () => this.mountDyeVid(),');
    expect(SRC.player).toContain('wind: game.world?.weather?.windSpeedCurrent ?? 0,');
    expect(SRC.player).toContain('windExposed: this.mountWindExposed === true,');
    expect(SRC.player).toMatch(/basiliskFloorDust: \(shiftX\) => \{\s*\n\s*const ox = this\.x;/);
  });

  it('E2 行为锁:basiliskFloorDust 移位地板尘（±24 移位 20 连发落尘,x 还原）+mountDyeVid 单源不回归', () => {
    const W = 80, H = 80, GROUND_ROW = 40;
    const w = new World(W, H, 11, 'g31-floor');
    for (let x = 4; x < 78; x++) w.store.setTile(x, GROUND_ROW, 1);   // 泥地板
    // 底贴地板行（readFloorTile 探脚底行=GROUND_ROW:bottom=GROUND_ROW×16）
    const p = new Player(40 * TILE, GROUND_ROW * TILE - 42, new Inventory());
    p.vx = 0;
    expect(p.mountDyeVid()).toBe(-1);                       // G29 A0 面:空槽 -1
    const a = collectPool();
    const game = { ...fakeHooks(w, p), vanillaDust: a.pool } as unknown as GameHooks;
    const ctx = ctxOf(p, game);
    expect(typeof ctx.basiliskFloorDust).toBe('function');
    const x0 = p.x;
    // spy 全 0:尘型 0（泥）keep 全保 → 20 连发（Falling 档 :24018）
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    (ctx.basiliskFloorDust as (sx: number) => void)(24);
    spy.mockRestore();
    expect(a.dusts.length).toBe(20);                        // 落地 20 连发（移位位）
    expect(a.dusts.every((d) => d.type === 0)).toBe(true);  // 泥地 → 尘 0
    for (const rec of a.recs) {
      expect(rec.x).toBe(x0 + 24);                          // spawn 盒锚=移位后 x（±24 内联）
    }
    expect(p.x).toBe(x0);                                   // 还原（vanilla position −= 同拍回放）
  });
});
