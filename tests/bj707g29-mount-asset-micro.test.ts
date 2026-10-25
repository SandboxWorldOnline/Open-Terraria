// ★BJ707-G29 新登记债清偿·坐骑/资产微面六件（BJ707-A 三笔 + BJ705-G26 三笔）
// ——逐件定谳判语（1457 亲读,先定谳再动刀;微面可感知度优先）:
//
// 件1 [BJ707-A 债①] 坐骑染料 shader（GetSecondaryShader(cMount)）→【修·独立小刀】
//   范围定谳（vanilla cMount 授予/消费全链亲读）:
//   · 授予:Player.cs:9689 UpdateDyes `cMount = miscDyes[3].dye`（杂项染料槽 3）。
//     仓内授予链全通（Inventory.miscDyes[5]+UI 装备页 miscDye context+MP 同步+
//     存档回读;Renderer 火焰粒子/滚轴鞋两消费面既在）→ 不依赖染料装备系统大面
//     =独立小刀,勿再登记任务书。
//   · 消费（全仓 census,16 面）:Mount.cs UpdateFrame 八处（:3920 独角兽10 环/
//     :3931 独角兽10 尾迹/:3985+:4006 海盗船44 尘228/:4046+:4070 惊魂木45 尘6/31/
//     :4138+:4168 蜥蜴14 尘31/6）+ UpdateEffects 两处（:4886+:4909 扫帚23 星尘43）
//     + Player.cs 五处（:21064 独角兽跳/:21092 山羊跳/:21120 蜥蜴跳/:21539 dash6
//     尾尘/:22126 独角兽上升尾迹）+ PlayerDrawLayers.cs:2658 迅猛龙54 眼睑。
//     Mount.currentShader（:275 静态,:5910 消费）vanilla 恒 0=mod 钩死码零消费。
//   · 仓内已实现发射方五处全部接线（dashDust 环/dashDustBody 尾迹/mountJumpBurstFx
//     三族跳环/独角兽上升尾迹/dash6——染料通道=尘池 d.dyeVid+Renderer 染料 pass
//     既在,与 BJ594 dash3/5 同径）;dash6 调用侧换道 mountDyeVid()（:21539 cMount
//     非 ArmorSetDye——旧传 armorSetDyeVid 的 Next(3) 掷 vanilla 该拍不存在,顺手
//     撤除=掷流更近原版）。缺省相（miscDyes[3] 空 → -1=GetSecondaryShader(0)=null
//     ArmorShaderDataSet.cs:63-70）零漂移;mountDyeVid 零 RNG。
//   · 防再登记注:未实现发射方（海盗船228×2/惊魂木×2/扫帚星尘×2/蜥蜴蓄能尘两支+
//     仓 case-14 dash 尘近似为 6 型环,原版 2×31——尘面缺失近似债,染料随其落地
//     接线）/迅猛龙眼睑(158,92,67)×光+cMount（色面无染也可见=独立小刀面）/
//     cMinecart 通道（miscDyes[2],Mount.cs:4755-4844/:5122-5162,另属矿车域）均
//     非本债残面——本债已清,后续勿按 cMount 域再登记。
//
// 件2 [BJ707-A 债②] 尘306 无色发射方 vanilla 失活语义（Main.cs:39706-39709
//   `newColor == Color.Black → dust.active = false`）→【销案锁死·备案】
//   定谳:DrawDust newColor = GetAlpha(newColor)=this.color×num（Dust.cs:2534-2536
//   不读光照入参）;306 update 链（Dust.cs:1093-1105）无 alpha 衰减 → num 恒
//   (255−α)/255>0 → 失活唯一入口=发射方 color 为 Black（无色发射即拍死）。
//   仓内零活跃无色发射方（唯二发射方恒带色:doSpawnDust 62-65 (100,227,255,127)
//   /dash6 尾尘 Lerp 色）=零感知潜伏;引擎级「光照尘暗处失活」面（newColor 读
//   光照的普通尘族）为另一广域语义,不入本销案。锁=发射侧双锚恒带色（本测 §B）;
//   渲染位非黑行为锁已在 tests/bj707a §1a/§2a-2b 在案,勿重复冻。
//
// 件3 [BJ707-A 债③] mountLights 渲染帧采样口径 →【维持备案·族注】
//   定谳:光值全为坐骑状态派生量（frame/charge/dash 门/液色）→ tick 域与渲染域
//   采样值恒同,仅刷新拍位差 ≤1 帧;LightingEngine perFrame 点光每周期消费后清空
//   （LightingEngine.ts addLight 注）=任意刷新率无累积漂移。与 7/23/9/46 既有
//   口径同族统一维持——迁移 tick 域须动光照引擎累积通道,零可感知收益。族注=
//   Mounts.ts mountLights 头注（§F 结构锁）,新 case 沿本口径免再登记。
//
// 件4 [BJ705-G26 债①] lavaOpacity Spawn 复位面 →【修·一行级×两 Spawn face】
//   定谳:Player.Spawn 无条件复位段 :37875 `lavaOpacity = 1f`（紧邻 :37874
//   lavaTime=lavaMax）;四消费面中仓内两 Spawn face（respawnPlayer ReviveFromDeath/
//   fireRecallTeleport spawn 支 RecallFromItem——魔镜:43324/回忆药水:43459/回归
//   药水:37789 三路汇流）落复位;SpawningIntoWorld=new Player 缺省 1;
//   ocean/hell/random/worldSpawn=Teleport 面无此复位（vanilla 同,不写）。
//   登记债（本刀新观察,不动刀）:recall spawn 支 :37874 lavaTime=lavaMax 复位
//   同缺（岩浆宽限,邻行独立语义,清偿另派）。
//
// 件5 [BJ705-G26 债②] 表情贴图未入 VANILLA_MISC 暖存 →【修·两键】
//   PumpkingFace/TreeFace（BJ705-G26 件2 后绘 extras 表情叠画的懒载面）入
//   VANILLA_MISC ③ boss 部件散件段——经 preloadMiscAndNpcs 回扫集+worldWarmUrls
//   P1 暖存面承载,首见迟数拍收口;漏载窗仍由 10s TTL 自愈兜底（防再登记注:
//   装饰面零可感知性判语不变,本修是「零成本顺手收口」非实报修复）。
//
// 件6 [BJ705-G26 债③] pogo+滑行同拍微面 →【销案锁死】
//   定谳:vanilla :19909-19921 弹跳座（mount 43）命中拍 HorizontalMovement 整段
//   return——仓内 !pogoFired 外层门 1:1（glideElseFriction 两臂均在其内）;
//   滑行阻尼由 dashMovement 承载=族共有形状（挂爪/舌缚/绳支同族外层门）。
//   dash 不可在 43 型坐骑上发起（MountID.Sets.CanDash={56-65} 仅限,Player.cs
//   :21579 门）→ 同拍面仅「滑行中上鞍」极窄缘可达,而该缘已被外层门精确覆盖。
//   锁=§E 行为锁（弹跳拍 HM 零写:vx 恒 0,次拍 HM 恢复运行）+结构锁
//   （glideElseFriction 在 !pogoFired 门内）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player, emitDashSlideDust, type BJ595DustPool } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY, ITEM_DEFS } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { dyeApplyOf } from '../src/data/vanillaDyes';
import { VANILLA_MISC } from '../src/assets/SpriteAtlas';
import { worldWarmUrls } from '../src/net/AssetCache';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { VDust } from '../src/fx/VanillaDust';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = {
  player: readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8'),
  game: readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8'),
  mounts: readFileSync(join(ROOT, 'src/entities/Mounts.ts'), 'utf8'),
};

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];
/** 红染料 vid 1007（vanilla-dyes.json ArmorColored 表首键——dyeApplyOf 可解析） */
const RED_DYE_VID = 1007;

const mkDust = (type: number, over: Partial<VDust> = {}): VDust => ({
  active: true, x: 0, y: 0, vx: 0, vy: 0, type, scale: 1, alpha: 0, fadeIn: 0,
  noGravity: false, noLight: false, noLightEmittance: false, color: null, rotation: 0,
  fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1, followEnt: null, attractTo: null,
  ...over,
}) as VDust;

/** 收集型尘池（spawn 全收,含 dyeVid 面） */
function collectPool(): { dusts: VDust[]; pool: BJ595DustPool } {
  const dusts: VDust[] = [];
  return {
    dusts,
    pool: {
      spawn(x: number, y: number, _w: number, _h: number, type: number, vx = 0, vy = 0, alpha = 0, color: unknown, scale = 1) {
        const d = mkDust(type, { x, y, vx, vy, alpha, scale, color: color as VDust['color'] });
        dusts.push(d);
        return d;
      },
    },
  };
}

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

function mkPlayer(): Player {
  return new Player(400, 400, new Inventory());
}
type Ctx = Record<string, (...a: unknown[]) => void>;
const ctxOf = (p: Player, game: GameHooks): Ctx =>
  (p as unknown as { mountEffectsCtx: (g: GameHooks) => Ctx }).mountEffectsCtx(game);

// ===================== §A 件1:坐骑染料 cMount 接线 =====================
describe('BJ707-G29 §A 件1 cMount 染料接线（miscDyes[3]→d.dyeVid 五发射方）', () => {
  it('A0 mountDyeVid():miscDyes[3] 直读零掷——空槽/无染=-1,红染料=1007（Player.cs:9689）', () => {
    const p = mkPlayer();
    expect(p.mountDyeVid()).toBe(-1);                       // 空槽（=cMount 0→null 同相）
    p.inv.miscDyes[3] = { id: iid(RED_DYE_VID), stack: 1 };
    expect(p.mountDyeVid()).toBe(RED_DYE_VID);
    expect(ITEM_DEFS[p.inv.miscDyes[3]!.id]?.vid).toBe(RED_DYE_VID);
    expect(dyeApplyOf(RED_DYE_VID)).not.toBeNull();        // 染料通道可解析（渲染端消费面）
    p.inv.miscDyes[3] = null;
    expect(p.mountDyeVid()).toBe(-1);
  });

  it('A1 dashDust 环（:3920）:14 尘全带 cMount 染料 vid（miscDyes[3] 红染料）;空槽 -1 穿透', () => {
    const p = mkPlayer();
    p.inv.miscDyes[3] = { id: iid(RED_DYE_VID), stack: 1 };
    const a = collectPool();
    const ctx = ctxOf(p, { ...fakeHooks(), vanillaDust: a.pool } as unknown as GameHooks);
    ctx.dashDust(0, 0, 14, 2, 176);
    expect(a.dusts.length).toBe(14);
    for (const d of a.dusts) expect(d.dyeVid, '环尘染料位').toBe(RED_DYE_VID);
    // 缺省相:空槽 dyeVid=-1（spawn 缺省穿透=零漂移面）
    const b = collectPool();
    const ctx2 = ctxOf(mkPlayer(), { ...fakeHooks(), vanillaDust: b.pool } as unknown as GameHooks);
    ctx2.dashDust(0, 0, 14, 2, 6);
    expect(b.dusts.length).toBe(14);
    for (const d of b.dusts) expect(d.dyeVid).toBe(-1);
  });

  it('A2 dashDustBody 尾迹（:3931）:尘带 cMount 染料 vid', () => {
    const p = mkPlayer();
    p.inv.miscDyes[3] = { id: iid(RED_DYE_VID), stack: 1 };
    const { dusts, pool } = collectPool();
    const ctx = ctxOf(p, { ...fakeHooks(), vanillaDust: pool } as unknown as GameHooks);
    ctx.dashDustBody(176);
    expect(dusts.length).toBe(1);
    expect(dusts[0].dyeVid).toBe(RED_DYE_VID);
  });

  it('A3 mountJumpBurstFx 三族跳环（:21064/:21092/:21120）:70 尘带 cMount;圣诞坦克支无染料（vanilla 无 shader）', () => {
    const p = mkPlayer();
    p.inv.miscDyes[3] = { id: iid(RED_DYE_VID), stack: 1 };
    const a = collectPool();
    const game = { ...fakeHooks(), vanillaDust: a.pool } as unknown as GameHooks;
    (p as unknown as { mountJumpBurstFx: (g: GameHooks, o: string) => void }).mountJumpBurstFx(game, 'Unicorn');
    expect(a.dusts.length).toBe(5 * 14);
    for (const d of a.dusts) expect(d.dyeVid, '跳环染料位').toBe(RED_DYE_VID);
    expect([176, 177, 179]).toContain(a.dusts[0].type);
    // 坦克支:vanilla :21124-21169 无 shader=dyeVid 不写（spawn 缺省 -1 穿透）
    const b = collectPool();
    (p as unknown as { mountJumpBurstFx: (g: GameHooks, o: string) => void })
      .mountJumpBurstFx({ ...fakeHooks(), vanillaDust: b.pool } as unknown as GameHooks, 'Santank');
    expect(b.dusts.length).toBe(15 * 2);                   // 尘4+尘6 各 15
    for (const d of b.dusts) expect(d.dyeVid, '坦克支零染料').toBe(-1);
  });

  it('A4 emitDashSlideDust dash6（:21539）:dyeVid 入参→8×306 全带（cMount 通道非 ArmorSetDye）', () => {
    const a = collectPool();
    const rand = () => 0.5;
    const n = emitDashSlideDust(a.pool,
      { x: 0, y: 0, w: 20, h: 46, vx: 0, vy: 0, facing: 1, mount: { type: 62 } }, 6, RED_DYE_VID, rand);
    expect(n).toBe(8);
    for (const d of a.dusts) { expect(d.type).toBe(306); expect(d.dyeVid).toBe(RED_DYE_VID); }
    // 缺省相:-1 穿透
    const b = collectPool();
    emitDashSlideDust(b.pool, { x: 0, y: 0, w: 20, h: 46, vx: 0, vy: 0, facing: 1, mount: { type: 62 } }, 6, -1, rand);
    for (const d of b.dusts) expect(d.dyeVid).toBe(-1);
  });

  it('A5 结构锁:调用侧换道 mountDyeVid（dash6 染料=cMount 非 ArmorSetDye）+五发射方锚', () => {
    expect(SRC.player).toContain('emitDashSlideDust(game.vanillaDust, this, 6, this.mountDyeVid());');
    expect(SRC.player).toMatch(/mountDyeVid\(\): number \{\s*\n\s*const dye = this\.inv\.miscDyes\[3\];/);
    expect(SRC.player).toMatch(/d\.dyeVid = mDyeVid;\s+\/\/ ★BJ707-G29 :21064\/:21092\/:21120/);
    expect(SRC.player).toMatch(/d\.dyeVid = this\.mountDyeVid\(\);\s+\/\/ :3931 shader=GetSecondaryShader\(cMount\)/);
    expect(SRC.player).toMatch(/d\.fadeIn = 1 \+ Math\.random\(\) \* 2; d\.dyeVid = this\.mountDyeVid\(\); \}/);
    expect(SRC.player).toMatch(/d\.dyeVid = dyeVid;\s+\/\/ :21539 shader=GetSecondaryShader\(cMount\)（★BJ707-G29）/);
  });
});

// ===================== §B 件2:尘306 无色发射方失活语义（销案锁） =====================
describe('BJ707-G29 §B 件2 尘306 无色失活语义销案（零活跃无色发射方判别锁）', () => {
  it('B1 发射侧双锚恒带色:doSpawnDust 62-65 (100,227,255,127) / dash6 尾尘 Lerp 色（Main.cs:39709 Black 失活唯一入口=无色发射）', () => {
    // Mounts.ts doSpawnDust 特型支 62-65——发射即带色（:6473）
    expect(SRC.mounts).toContain('pool(p.x - 20, p.y, p.w + 40, p.h, 306, 0, 0, 60, { r: 100, g: 227, b: 255, a: 127 }, 2)');
    // Player.ts emitDashSlideDust dash6——逐尘 color 恒 Lerp 写（:21541-21546）
    expect(SRC.player).toMatch(/d\.color = ignis\s*\?\s*\{ r: 255, g: Math\.trunc\(178 \+ 77 \* t3\)/);
    expect(SRC.player).toMatch(/: \{ r: Math\.trunc\(229 \+ 26 \* t3\)/);
  });

  it('B2 判语锁:306 GetAlpha 自色×num 失活面判语在案（防按光照失活误建模再登记）', () => {
    expect(SRC.player).toContain('坐骑染料 shader（:21539 GetSecondaryShader(cMount)——非 ArmorSetDye）');
    expect(readFileSync(join(ROOT, 'src/fx/VanillaDust.ts'), 'utf8'))
      .toContain('case 306: {   // :2534-2536 this.color×num（四通道）');
  });
});

// ===================== §C 件4:lavaOpacity Spawn 复位（两 Spawn face） =====================
describe('BJ707-G29 §C 件4 lavaOpacity Spawn 复位（:37875 两 face 落位）', () => {
  it('C1 respawnPlayer（ReviveFromDeath）:与 :37874 lavaTime 同段复位 lavaOpacity=1', () => {
    expect(SRC.game).toMatch(/p\.lavaImmuneTicks = p\.equipStats\.lavaMax;\s*\n\s*\/\/ ★BJ707-G29（G26 债①清偿）:Spawn 无条件复位段 :37875[\s\S]{0,140}p\.lavaOpacity = 1;/);
  });

  it("C2 fireRecallTeleport spawn 支（RecallFromItem 三路汇流）:Spawn face 复位;Teleport 面不写", () => {
    expect(SRC.game).toContain("if (c.kind === 'spawn') p.lavaOpacity = 1;");
    // 门位=Teleport 公共段之后（fallStartY 重置同段域）——防误扩到 ocean/hell/random
    const iFall = SRC.game.indexOf('p.fallStartY = null;      // fallStart 重置');
    const iLava = SRC.game.indexOf("if (c.kind === 'spawn') p.lavaOpacity = 1;");
    expect(iFall).toBeGreaterThan(0);
    expect(iLava).toBeGreaterThan(iFall);
    expect(iLava - iFall).toBeLessThan(400);
  });

  it("C3 登记债在案:recall spawn 支 :37874 lavaTime 复位缺（邻行独立语义,清偿另派）", () => {
    expect(SRC.player).toContain("Game.respawnPlayer 与 fireRecallTeleport 'spawn' 支两");
  });
});

// ===================== §D 件5:表情贴图 VANILLA_MISC 暖存 =====================
describe('BJ707-G29 §D 件5 PumpkingFace/TreeFace 入 VANILLA_MISC 暖存', () => {
  it('D1 两键在表且盘上真实存在（PNG 魔数）', () => {
    expect(VANILLA_MISC).toContain('vanilla/PumpkingFace.png');
    expect(VANILLA_MISC).toContain('vanilla/TreeFace.png');
    for (const f of ['vanilla/PumpkingFace.png', 'vanilla/TreeFace.png']) {
      const p = join(ROOT, 'public', 'sprites', f);
      expect(existsSync(p), p).toBe(true);
      expect(readFileSync(p).readUInt32BE(0)).toBe(0x89504e47 >>> 0);
    }
  });

  it('D2 随 worldWarmUrls P1 暖存面同源（SW 预载通道覆盖）', () => {
    const warm = new Set(worldWarmUrls());
    expect(warm.has('sprites/vanilla/PumpkingFace.png')).toBe(true);
    expect(warm.has('sprites/vanilla/TreeFace.png')).toBe(true);
  });

  it('D3 表内零重复（清单卫生）', () => {
    expect(new Set(VANILLA_MISC).size).toBe(VANILLA_MISC.length);
  });
});

// ===================== §E 件6:pogo 弹跳拍 HM 早退（销案锁） =====================
describe('BJ707-G29 §E 件6 pogo+滑行同拍微面销案（:19921 早退外层门）', () => {
  const W = 80, H = 80, GROUND_ROW = 30;
  function groundWorld(): World {
    const w = new World(W, H, 11, 'g29-pogo');
    for (let x = 4; x < 78; x++) w.store.setTile(x, GROUND_ROW, 1);
    return w;
  }
  const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };

  it('E1 行为锁:弹跳拍 vy<0 且 HM 零写（vx 恒 0）;次拍空中 HM 恢复（pogo 臂不命中）', () => {
    const w = groundWorld();
    const p = new Player(24 * TILE, (GROUND_ROW - 3) * TILE, new Inventory());
    p.hp = 500;
    // 上鞍 43（PogoStick）——setMount 通用支尘（MountDustGame 最小游戏面）
    p.mount.setMount(43, p as never, {
      spawnDust: () => null, cloneDust: () => null, spawnParticles: () => {}, playSfxFiles: () => {},
    } as never);
    expect(p.ridingMount && p.mount.type === 43).toBe(true);
    for (let i = 0; i < 12; i++) tick(p, w);               // 落地沉降
    expect(p.vy).toBe(0);                                  // 接地静止（HM 时点 vy==0）
    p.inputX = 1; p.inputRight = true; p.inputJump = false;
    tick(p, w);
    expect(p.vy).toBeLessThan(0);                          // 弹跳 vy=−(max(js·gd·0.5,2)+0.01)（:19918）
    expect(p.vx).toBe(0);                                  // ★HM 整段 return=零写（含滑行摩擦臂;若未早退 runAcc≈+0.08）
    p.inputX = 0; p.inputRight = false;
    tick(p, w);                                            // 次拍空中（vy≠0）:pogo 臂不命中,HM 恢复
    expect(p.vy).not.toBe(0);
  });

  it('E2 结构锁:glideElseFriction 两臂均在 !pogoFired 门内（pogo+滑行同拍面=外层门承载）', () => {
    const iGate = SRC.player.indexOf('if (!pogoFired) {');
    const iFr = SRC.player.indexOf('const glideElseFriction = (): void => {');
    expect(iGate).toBeGreaterThan(0);
    expect(iFr).toBeGreaterThan(iGate);                    // 摩擦定义在门内（后于门开）
    // ★BJ717-A R13 结构重排随迁(2026-10-25):弹跳门从加速段前移至整合段尾。
    // 门内首块=「水平链 1:1」(两段加速实现体,R13 措辞);旧「原版两段加速模型」
    // 头注随参数链段移至门外上方。锁改锚门内实现体措辞,语义不变=加速链在门内。
    expect(SRC.player.slice(iGate, iGate + 600)).toContain('水平链 1:1');
  });
});

// ===================== §F 件3:mountLights 渲染帧采样口径族注 =====================
describe('BJ707-G29 §F 件3 mountLights 口径族注（维持备案结构锁）', () => {
  it('F1 族注在位:渲染帧采样口径+tick 域等价论证+免再登记注', () => {
    expect(SRC.mounts).toContain('★BJ707-G29（BJ707-A 债③定谳）渲染帧采样口径族注');
    expect(SRC.mounts).toContain('新 case 沿本口径即免再登记');
  });
  it('F2 case 62-65 滑行光晕既有口径注在位（7/23/9/46 同族锚）', () => {
    expect(SRC.mounts).toContain('渲染帧采样与 7/23/9/46 同口径');
  });
});
