// Dead Cells 联动·火石枪族（物品 5462 → 弹 1040/1043/1041）。
// 原版锚（Terarria1458/Terraria/Projectile.cs；Item.cs:43080-43097）：
//   物品 5462 火石枪：useStyle1/useAnim15/useTime15/autoReuse/channel/noMelee/melee/
//     shoot=1040/shootSpeed4/kb5/damage70/UseSound=Item_1（vanilla-itemusesound 表）
//   弹 1040 SetDefaults :9836-9848：2×2 aiStyle198 tileCollide=false penetrate=-1
//     alpha=255（GetAlpha 全透=纯控制器实体）manualDirectionChange
//   AI_198_Flint :53155-53233：
//     · 蓄力相 ai[0]==0 :53198-53232——velocity 恒零、direction 随鼠标侧换向
//       （:53201-53206）、heldProj 钉持械、dummy item time = useAnim+min(ai1,3)
//       （:53208-53226）；ai[1]==30 拍播 deadcells_flint_charge @玩家中心
//       （:53221-53224，SoundID.cs:1114 vol .5）；1/10 掷尘 228（:53228-53230）
//     · 松手 :53163-53177——flag=ai[1]>=30（满蓄）；恒发 1043 斩击波于 MountedCenter、
//       velocity=(direction,0)、伤=(int)(damage×1.78)、ai0=dir×gravDir/ai1=6/ai2=1
//       （:53171-53172）；满蓄另走 AI_198_Flint_EmitSpikes（:53235-53277）沿地表刺出
//       ≤13 根 1041 尖刺（列距 2 格、ai[0]=-i×2 出土延迟、ai[1]=1+i×0.04+rand×0.2）
//       并 RequestParticleSpawn DeadCellsFlint（PositionInWorld=start+(16,16)×
//       Player.Directions(:3833)=(direction,gravDir)，MovementVector=(32,gravDir)）
//   弹 1043 SetDefaults :9854-9876：16×16 aiStyle190 friendly melee penetrate=2
//     localNPCHitCooldown=-1 ownerHitCheckDistance300 stopsDealingDamageAfterPenetrateHits
//   AI_190_NightsEdge 1043 支 :42735-42956——localAI[0]++/num=lai0/ai1(=6)；rotation=
//     π×ai0×num+velocity.ToRotation()+ai0×π（:42745-42747）；Center=玩家中心−velocity
//     （:42760）；scale=(1+num×0.2)×ai2（:42761/:42953）；num>=1 Kill（:42954-42956）
//   Colliding 锥形 :15592-15600——半径 94×scale 半角 π/4，心=rotation+(2π/25)×ai0，
//     早段后扫 num16=num14−π/4×ai0×Remap(lai0,ai1×0.3,ai1×0.5,1,0)
//   CutTiles :15336-15343——rotation±π/4 两端连线宽 60×scale
//   击退向 :13664-13666（aiStyle 188-191 族=远离玩家中心）
//   弹 1041 SetDefaults :9836 区段（else if type==1041）：32×32 aiStyle157 friendly
//     melee alpha255 tileCollide=false penetrate=4 localNPCHitCooldown=25
//   AI_157_SharpTears 1041 支 :52299-52320（尘 228/出土延迟 ai[0]<0→alpha255+
//     scale=0.1×ai[1]/帧进 num11=2（frame==0 时 6）/激活拍 localAI[0]==0 门播
//     deadcells_flint_wave vol .1（:52364-52367，SoundID.cs:1118）/渐显 Opacity+=0.1
//     前 4 拍 scale=Opacity×ai[1]（Opacity≡1−alpha/255 :542-548，SetDefaults alpha=255
//     →0 起）/≥14 渐隐 −0.2/拍/:≥19 Kill）;UpdatePosition 1041 免湿改向 :20552；
//   Colliding 线判 :15933-15946——Center 沿速度向 200×scale 线宽 22×scale，ai[0]<0 不判;
//   CanCutTiles :15410 ai[0]<0 不剪;DrawAlpha :80762-80768 alpha==255→全透。
// 结构同源参照 MonkStaffFury.ts（owner 回调/HitCd/hurtEnemy 同式；本文件独立实现勿互相 import 实现）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projSprite } from './Arrow';
import { hitTownNpcs, playerCanHitEnemy, applyBannerDamageDealt } from './projTargets';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { applyMeleeImbue, applyFrostBurn, applyMagmaStoneProj } from './projStatus';
// Spawn_DeadCellsFlint 编排本体（收编池;L5 批 2026-08-31——本地直生 + broadcast 上行同用）
import { deadCellsFlintFx } from '../fx/orchestraFx';
import { ParticleOrchestraType } from '../net/syncModules';
import { rollVanillaHitCrit } from './proj1457';   // ★BJ489 def-3 掷率单源（函数声明环=运行时调用安全）

/** 玩家侧挂点（MonkOwner 同口径；cx/cy/facing 实时引用） */
export interface FlintOwner {
  cx: number; cy: number; facing: number; dead: boolean;
  vx: number; vy: number;
}

const TAU = Math.PI * 2;

/** 敌怪桶最小形状（Enemy.hurt 单点结算） */
type EnemyLike = {
  x: number; y: number; w: number; h: number; id: number; dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
};

/** 近战弹命中结算（音/飘值=StrikeNPC 单点;fromPlayer=DPS 计）
 *  ★F3 接线（蓝队四轮）：火石枪族弹（1043 斩击波/1041 尖刺，数据面 melee）→
 *  焰爆石/拍击石双支（Projectile.cs:13439-13446）在本共享出口单点接线 */
function hurtEnemy(game: GameHooks, e: EnemyLike, dmg: number, crit: boolean,
  kb: number, kdir: number, pen: number,
  host?: { projId: number; x: number; y: number; w: number; h: number }): void {
  const snapBonusFlint = projectileSnapStrikeBonus(game,
    { projId: host?.projId }, e.x + e.w / 2, e.y + e.h / 2, e.id,
    { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
      targeterBox: host ? { x: host.x, y: host.y, w: host.w, h: host.h } : undefined });
  e.hurt(applyBannerDamageDealt(game, e, dmg)
    + (snapBonusFlint ? snapBonusFlint : 0),
    kdir * kb, 0, game, pen, crit, 0, true);
}

/** 浸剂三链（melee=true 弹命中侧；MonkStaffFury.applyImbue 同式） */
function applyImbue(game: GameHooks, e: EnemyLike): void {
  const pl = game.player as unknown as { buffs?: { has: (b: never) => boolean }; equipStats?: { frostBurn: boolean; magmaStone: boolean } } | null;
  if (pl?.buffs) {
    applyMeleeImbue(pl.buffs, e as unknown as Record<string, number>,
      () => game.spawnParticles(e.x + e.w / 2, e.y + e.h / 2,
        ['#FF6090', '#60FF90', '#6090FF', '#FFD040'][Math.floor(Math.random() * 4)], 6, 2.4, { life: 40, damp: 0.96 }));
  }
  if (pl?.equipStats) {
    applyFrostBurn(pl.equipStats.frostBurn, e as unknown as Record<string, number>);
    applyMagmaStoneProj(pl.equipStats.magmaStone, e as unknown as Record<string, number>);
  }
}

/** 命中域外接盒（hitTownNpcs 盒接口适配——锥/线判定域的保守包围） */
function bboxOf(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** 点到线段距离平方（1041 线判/1043 锥形距离门共用） */
function distPtSegSq(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let k = ((px - x0) * dx + (py - y0) * dy) / len2;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const qx = x0 + dx * k - px, qy = y0 + dy * k - py;
  return qx * qx + qy * qy;
}

/** 角差归一 [-π,π]（锥形半角判定用） */
function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

// ==== EmitSpikes（AI_198_Flint_EmitSpikes :53235-53277）+ Spawn_DeadCellsFlint 编排 ====

/**
 * 满蓄松手的地表尖刺列 + DeadCellsFlint 编排粒子（音收尾在此）。
 * @param spawner 弹体入列注入口（Game 注入 entities.add；缺省 no-op=纯测试态）
 * 原版流程：startPosition+=(30×dir,0) → RequestParticleSpawn DeadCellsFlint
 * （PositionInWorld=start+(16,16)×Player.Directions(:3833)=(direction,gravDir)、
 * MovementVector=(32,gravDir)，clientOnly:false :53240-53245）→ 沿地表每 2 格刺出
 * 一根 1041（FindBlockSurface 找站立面 :53279-53305；ActiveAndWalkableTile 门
 * WorldGen.cs:70839；velocity=(dir,-10).RotBy(±9° 掷)、ai[0]=−i×2 出土延迟、
 * ai[1]=1+i×0.04+rand×0.2，上限 13 根 num=12 :53247/:53270/:53272）。
 * Spawn_DeadCellsFlint（ParticleOrchestrator.cs:1786-1901）：扫到顶面裸露的实心格
 * （flag :1822/:1882）→ deadcells_flint_release（vol .5,SoundID.cs:1116,:1884）+
 * 尘 228 ×30（:1885-1890）+ 叠播 dd2_monk_staff_ground_impact 一声
 * （PlayTrackedSound :1888,SoundID.cs:1008 三变体组）；无合格格静默返回（:1879-1882）。
 * L5 批：本段视觉/音已收编 fx/orchestraFx.deadCellsFlintFx（本地直生 + module8 上行）。
 */
export function emitFlintSpikes(
  game: GameHooks, startX: number, startY: number, dir: number, damage: number,
  knockback: number, critChance: number, armorPen: number,
  spawner: (e: unknown) => void = () => {},
): void {
  const px = startX + dir * 30;                       // startPosition += (direction*30,0)（:53238）
  const py = startY;
  const tx0 = Math.floor(px / 16);
  let ty = Math.floor(py / 16);
  // ---- DeadCellsFlint 编排粒子（先于尖刺掷,RequestParticleSpawn :53240-53245）----
  // L5 批收编：视觉/音/资格门全部迁 fx/orchestraFx.deadCellsFlintFx（本地与联机
  // netApply 两面共用本体）;此处本地直生 + module8 上行（原版 clientOnly:false 即
  // 全网广播——PositionInWorld=start+(16,16)×Directions、MovementVector=(32,gravDir)
  // 载荷按枚举注同口径发送）
  deadCellsFlintFx(game, px + 16 * dir, py + 16, 1);
  game.broadcastParticleOrchestra?.(ParticleOrchestraType.DeadCellsFlint,
    px + 16 * dir, py + 16, 32, 1);
  const st = game.world.store;
  // ---- 尖刺列（:53246-53276）——列游标每根右移 2 格,y 引用贯穿复用（ref p.Y）----
  let colX = tx0;
  let colY = ty;
  for (let i = 0; i <= 12; i++) {
    // FindBlockSurface（:53279-53305）：先沿实心上行 ≤10,再沿非站立面下行 ≤10
    for (let k = 0; k < 10; k++) {
      if (colY < 10 || !st.isSolid(colX, colY)) break;
      colY--;
    }
    for (let k = 0; k < 10; k++) {
      if (colY > st.h - 10 || st.isSolid(colX, colY)) break;
      colY++;
    }
    if (!st.isSolid(colX, colY)) break;               // ActiveAndWalkableTile 门（:53260）
    const sxp = colX * 16 + 8;                        // p.ToWorldCoordinates(8f,0f)（:53262）
    const syp = colY * 16;
    const jit = (Math.random() * 2 - 1) * Math.PI * 2 * 0.025;   // ±9° 掷（:53270）
    const jc = Math.cos(jit), js = Math.sin(jit);
    const bvx = dir * jc - (-10) * js;
    const bvy = dir * js + (-10) * jc;                // spinningpoint.RotatedBy(jit)
    const spike = new FlintSpikeProj(sxp - 16, syp - 16, bvx, bvy, damage, knockback,
      -(i * 2),                                       // ai[0] = −(num3×2) 出土延迟（:53270）
      1 + i * 0.04 + Math.random() * 0.2);            // ai[1]（:53264）
    spike.critChance = critChance;
    spike.armorPen = armorPen;
    spawner(spike);
    colX += dir * 2;                                  // p.X += direction*2（:53272）
  }
}

// ================= 1040：蓄力控制器（AI_198_Flint :53155-53233） =================

export class FlintChargeProj extends Entity {
  readonly projId = 1040;
  w = 2; h = 2;                                       // SetDefaults :9837-9838
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  // ★注释勘误（F2 批）：1040 是 1457 SetDefaults 的【无类旗反例】（Projectile.cs
  //  9836-9848 区段：2×2 aiStyle198 tileCollide=false penetrate=-1 alpha=255
  //  manualDirectionChange——无 melee/ranged,同族 1043/1041 明确带 melee）。
  //  下旗为 resolveProjClass 兜底槽的历史类字段（projTargets「新代码勿再散写」），
  //  本类不进任何按类结算环（命中面在 1043/1041 弹体侧）= 纯惰性声明,非浸剂门依据。
  meleeProj = true;
  dead = false;
  lightRGB: [number, number, number] | null = null;

  /** ai[0]：0 蓄力 / 1 收势（:53163/:53179） */
  private ai0 = 0;
  /** ai[1]：蓄力拍计数（满蓄门 ≥30 :53165/:53221）/ 收势拍计数 */
  private ai1 = 0;
  /** direction（鼠标侧逐拍重评 :53201-53206） */
  private dir = 1;
  private owner: FlintOwner;
  /** controlUseItem 电平（channel）——false 即松手发波 */
  private heldCb: () => boolean;
  private aimCb: () => { x: number; y: number };
  /** player.HeldItem.useAnimation（收势时长 :53182/:53208） */
  private readonly useAnim: number;
  /** 1043 波注入口（Game 注入 entities.add；缺省 no-op=纯实体测试态） */
  spawnWave: (x: number, y: number, vx: number, vy: number, dmg: number, dir: number) => void = () => {};
  /** 满蓄尖刺列注入口（EmitSpikes 整段由 Game 侧落地形扫描+粒子编排） */
  emitSpikes: (x: number, y: number, dir: number, dmg: number) => void = () => {};
  /** SetDummyItemTime 注入口（Game 侧钉 useTime/swing；缺省 no-op=纯实体测试态） */
  pinUse: (t: number) => void = () => {};

  constructor(owner: FlintOwner, vx: number, vy: number, damage: number, knockback: number,
    heldCb: () => boolean, aimCb: () => { x: number; y: number }, useAnim: number) {
    super();
    this.owner = owner;
    this.x = owner.cx - this.w / 2;
    this.y = owner.cy - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.heldCb = heldCb;
    this.aimCb = aimCb;
    this.useAnim = Math.max(1, useAnim);
    // 初值 direction=player.direction（NewProjectile 缺省继承）
    this.dir = owner.facing || 1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (this.owner.dead) { this.dead = true; return; }        // !player.active → Kill（:53158-53162）
    this.vx = 0; this.vy = 0;                                 // velocity=Vector2.Zero（:53188/:53200）
    if (this.ai0 === 1) {
      // ---- 收势相（:53179-53197）----
      this.ai1++;
      if (this.ai1 >= this.useAnim) { this.dead = true; return; }   // :53183-53186
      this.owner.facing = this.dir;                             // player.ChangeDir(direction)（:53189）
      // SetDummyItemTime(Remap(ai1,0,5,useAnim,0) 钳 2)（:53191-53196）
      const t = this.ai1 >= 5 ? 2 : Math.max(2, Math.round(this.useAnim * (1 - this.ai1 / 5)));
      this.pinUse(t);
      return;
    }
    // ---- 蓄力相（ai[0]==0）----
    if (!this.heldCb()) {
      // 松手（:53163-53177）：flag=ai[1]>=30 满蓄；恒发 1043（伤×1.78）；
      // 满蓄另发地表尖刺列+DeadCellsFlint 编排粒子（release 音在其内）
      const full = this.ai1 >= 30;
      this.ai0 = 1;
      this.ai1 = 0;
      this.spawnWave(this.owner.cx, this.owner.cy, this.dir, 0,
        Math.round(this.damage * 1.78), this.dir);              // :53171-53172
      if (full) this.emitSpikes(this.owner.cx + this.dir * 30, this.owner.cy, this.dir, this.damage);
      return;
    }
    // direction 随鼠标侧（:53201-53206）→ ChangeDir
    const m = this.aimCb();
    const nd = m.x >= this.owner.cx ? 1 : -1;
    this.dir = nd;
    this.owner.facing = nd;
    this.ai1++;
    // dummy item time = useAnim+min(ai1,3) 钳 2（:53208-53220/:53226）
    this.pinUse(Math.max(2, this.useAnim + Math.min(this.ai1, 3)));
    if (this.ai1 === 30) {
      // deadcells_flint_charge @玩家中心（:53221-53224；SoundID.cs:1114 vol .5 单变体组）
      game.playSfxFiles(['deadcells_flint_charge'], 0.5, this.owner.cx, this.owner.cy);
    }
    // 1/10 尘 228 @itemLocation+(41dir,−41) 绕 itemRotation（:53228-53230）——
    // 本仓手持旋转角未建模,取未旋转位近似（视觉从简,音/节拍不受影响）
    if (Math.random() < 0.1) {
      game.spawnParticles(this.owner.cx + 41 * this.dir, this.owner.cy - 41,
        '#FFB400', 1, 1.3 + Math.random(), { life: 24, vy: -(2 + Math.random() * 8), grav: 0 });
    }
  }

  /** alpha=255（SetDefaults :9847）→ GetAlpha 全透,本体从不渲染 */
  draw(_r: Renderer, _cam: Camera): void { /* 控制器实体不绘制 */ }
}

// ================= 1043：斩击波（AI_190_NightsEdge 1043 支 :42735-42956） =================

export class FlintWaveProj extends Entity {
  readonly projId = 1043;
  w = 16; h = 16;                                     // SetDefaults :9855-9856
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  lightRGB: [number, number, number] | null = null;

  /** localAI[0]：寿命计（Kill @num>=1,num=lai0/ai1 :42954） */
  private lai0 = 0;
  /** ai[0]=±1（出手向 dir×gravDir :53172）、ai[1]=6 寿命分母、ai[2]=1 scale 乘区 */
  private readonly ai0: number;
  private readonly ai1 = 6;
  private readonly ai2 = 1;
  /** rotation（AI 直写 :42747） */
  private rot = 0;
  private scaleV = 1;
  private owner: FlintOwner;
  /** localNPCHitCooldown=-1（:9869-9870）＝每敌至多一次;penetrate=2 两击上限 */
  private hitDone = new Set<number>();
  private hits = 0;

  constructor(owner: FlintOwner, vx: number, vy: number, damage: number, knockback: number, dir: number) {
    super();
    this.owner = owner;
    this.x = owner.cx - this.w / 2;
    this.y = owner.cy - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.ai0 = dir;                                   // gravDir 恒 1（本仓无反向重力）
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.lai0++;
    const num = this.lai0 / this.ai1;                           // 进度（:42744）
    const velRot = Math.atan2(this.vy, this.vx);                // num3（:42746）
    this.rot = Math.PI * this.ai0 * num + velRot + this.ai0 * Math.PI;   // num4（:42747）
    // Center = RotatedRelativePoint(MountedCenter) − velocity ≈ 玩家中心 − (dir,0)（:42760）
    this.x = this.owner.cx - this.vx - this.w / 2;
    this.y = this.owner.cy - this.vy - this.h / 2;
    this.scaleV = (1 + num * 0.2) * this.ai2;                   // :42761/:42953
    if (num >= 1) { this.dead = true; return; }                 // :42954-42956
    // ---- 命中（Colliding :15592-15600 锥形）：半径 94×scale 半角 π/4 ----
    const coneC = this.rot + (TAU / 25) * this.ai0;             // num14（:15596）
    const sweep = Math.min(1, Math.max(0, (this.lai0 - this.ai1 * 0.3) / (this.ai1 * 0.2)));   // Remap(lai0,ai1*0.3,ai1*0.5,1,0)（:15597）
    const backA = coneC - (Math.PI / 4) * this.ai0 * sweep;     // num16（:15598）
    const lo = Math.min(coneC, backA) - Math.PI / 4;
    const hi = Math.max(coneC, backA) + Math.PI / 4;
    const radius = 94 * this.scaleV;
    // 域外接盒近似（锥心=rotation+(2π/25)ai0,半径 radius——hitTownNpcs 盒接口适配）
    {
      const cc = this.rot + (TAU / 25) * this.ai0;
      hitTownNpcs(bboxOf(this.cx + Math.cos(cc) * radius, this.cy + Math.sin(cc) * radius,
        this.cx - Math.cos(cc) * radius, this.cy - Math.sin(cc) * radius),
        game, this.damage, 0, 'playerProj', 0);
    }
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      // ★2026-08-26 审计修：penetrate=2 上限门提到循环顶——原写在尾 break 只拦
      //   本 tick 后续目标，次 tick 首个新敌仍先结算一击再 break（超发一次伤害）；
    //   原版 StopsDealingDamageAfterPenetrateHits(:9871) 打满即停手。
      if (this.hits >= 2) break;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      if (e.dead || this.hitDone.has(e.id)) continue;
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      const dx = ecx - this.cx, dy = ecy - this.cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      // 角跨度判定：目标方向落在 [lo,hi] 圆弧窗内（跨 ±π 归一）
      const a = Math.atan2(dy, dx);
      const inLo = angDiff(a, lo) >= 0;
      const inHi = angDiff(a, hi) <= 0;
      const inArc = lo <= hi ? (inLo && inHi) : (inLo || inHi);
      if (!inArc) continue;
      this.hitDone.add(e.id);
      this.hits++;
      // ★BJ489 def-3：1043 斩击波掷率=rollVanillaHitCrit（melee 旗,命中拍 owner 装配+
      //  :25712 持械折入动态,critTotal 出生拍冻结载体退役）;critChance≤0 关断钉保留
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // 击退=远离玩家中心（:13664-13666 aiStyle 188-191 特列）
      const kdir = this.owner.cx < ecx ? 1 : -1;
      hurtEnemy(game, e, dmg, crit, this.knockback, kdir, this.armorPen, this);
      applyImbue(game, e);
      if (this.hits >= 2) break;                                // penetrate=2 上限
    }
    // ---- CutTiles（:15336-15343）：rotation±π/4 端点连线宽 60×scale ----
    const ex0 = this.cx + Math.cos(this.rot - Math.PI / 4) * 60 * this.scaleV;
    const ey0 = this.cy + Math.sin(this.rot - Math.PI / 4) * 60 * this.scaleV;
    const ex1 = this.cx + Math.cos(this.rot + Math.PI / 4) * 60 * this.scaleV;
    const ey1 = this.cy + Math.sin(this.rot + Math.PI / 4) * 60 * this.scaleV;
    const steps = Math.ceil(Math.hypot(ex1 - ex0, ey1 - ey0) / 12);
    for (let s = 0; s <= steps; s++) {
      const k = steps === 0 ? 0 : s / steps;
      const tx = Math.floor((ex0 + (ex1 - ex0) * k) / 16), ty = Math.floor((ey0 + (ey1 - ey0) * k) / 16);
      if (game.world.store.inBounds(tx, ty)) game.cutTile(tx, ty);
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(1043);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || !ctx) return;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width * this.scaleV, img.height * this.scaleV);
    ctx.restore();
  }
}

// ================= 1041：地表尖刺（AI_157_SharpTears 1041 支 :52299-52320） =================

export class FlintSpikeProj extends Entity {
  readonly projId = 1041;
  w = 32; h = 32;                                     // SetDefaults（else if type==1041）
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  lightRGB: [number, number, number] | null = null;

  /** ai[0]：出土延迟计数（出生 = −i×2 :53270；逐 tick ++，<0 隐形不判定 :52325-52329/
   *  :15410/:15938-15941）；≥19 Kill（num10=19 :52311/:52396-52399） */
  private ai0: number;
  /** ai[1]：scale 系数（=1+i×0.04+rand×0.2 :53264） */
  private readonly ai1: number;
  /** localAI[0]：激活单次门（尘+wave 音 :52335-52372） */
  private lai0 = 0;
  /** alpha 镜像（Opacity≡1−alpha/255 :542-548;SetDefaults 255 → 渐显 +=0.1/拍前 4 拍
   *  :52373-52376,渐隐 −0.2/拍自 14 :52385-52387）;scale 仅前 4 拍随 Opacity 写
   *  （:52375 scale=Opacity×ai[1]） */
  private alphaI = 255;
  private scaleV = 0.1;
  private rot = 0;
  private frame = 0;
  private frameCtr = 0;
  /** localNPCHitCooldown=25（SetDefaults）;penetrate=4 四击上限 */
  private hitCd = new Map<number, number>();
  private hits = 0;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number,
    ai0Delay: number, ai1Scale: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.ai0 = ai0Delay;
    this.ai1 = ai1Scale;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // 帧门先于自增取值（flag2/3/4 由本 tick 初值计算 :52321-52323,随后 ai[0]++ :52324）
    const fadeIn = this.ai0 >= 0 && this.ai0 < 4;
    const fadeOut = this.ai0 >= 14;
    const killNow = this.ai0 >= 19;
    this.ai0++;
    if (this.ai0 < 0) {                               // 出土延迟段（:52325-52329）
      this.alphaI = 255;
      this.scaleV = 0.1 * this.ai1;
    } else if (!fadeIn && !fadeOut) {
      // 中段保持激活拍终值（alpha≈153/scale≈0.4×ai1——原版无中段写）
      if (this.alphaI < 153) this.alphaI = 153;
      this.scaleV = Math.max(this.scaleV, 0.4 * this.ai1);
    }
    if (!fadeIn && this.ai0 >= 0 && ++this.frameCtr >= (this.frame === 0 ? 6 : 2)) {
      this.frameCtr = 0;                              // 帧进 num11=6(首帧)/2（:52330-52334）
      this.frame++;
    }
    if (this.lai0 === 0 && this.ai0 >= 0) {           // 激活拍（:52335-52372）
      this.lai0 = 1;
      this.rot = Math.atan2(this.vy, this.vx);        // rotation=velocity.ToRotation()（:52338）
      // 尘 228 双组 ×3/×2（num4=3/num5=2 :52303-52304）——视觉从简近似
      for (let i = 0; i < 5; i++) {
        game.spawnParticles(this.cx + (Math.random() * 2 - 1) * 24, this.cy + (Math.random() * 2 - 1) * 24,
          '#FFB400', 1, 0.8 + Math.random() * 0.5,
          { life: 20, vx: this.vx * 0.25 * Math.random(), vy: this.vy * 0.25 * Math.random(), grav: 0 });
      }
      // deadcells_flint_wave @尖刺中心（:52364-52367;SoundID.cs:1118 vol .1 单变体组）
      game.playSfxFiles(['deadcells_flint_wave'], 0.1, this.cx, this.cy);
    }
    if (fadeIn) {                                     // 渐显（:52373-52384）
      this.alphaI = Math.max(0, this.alphaI - 26);    // Opacity+=0.1 ≙ α−25.5 取整
      this.scaleV = (1 - this.alphaI / 255) * this.ai1;
    }
    if (fadeOut) {                                    // 渐隐（:52385-52395）
      this.alphaI = Math.min(255, this.alphaI + 51);  // Opacity−=0.2 ≙ α+51
    }
    if (killNow) { this.dead = true; return; }        // :52396-52399
    // 位移：position += velocity 恒式（UpdatePosition 1041 免湿改向特列 :20552）
    this.x += this.vx;
    this.y += this.vy;
    if (this.ai0 < 0) return;                         // 出土延迟段不判定（:15938-15941/:15410）
    // ---- 命中（Colliding :15933-15946）：Center 沿速度向 200×scale 线宽 22×scale ----
    const vl = Math.hypot(this.vx, this.vy) || 1;
    const ux = this.vx / vl, uy = this.vy / vl;
    const ex = this.cx + ux * 200 * this.scaleV, ey = this.cy + uy * 200 * this.scaleV;
    const halfW = 11 * this.scaleV;
    hitTownNpcs(bboxOf(this.cx, this.cy, ex, ey), game, this.damage, 0, 'playerProj', 0);
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      // ★2026-08-26 审计修：penetrate=4 上限门提到循环顶（同 FlintWaveProj——
      //   尾 break 拦不住次 tick 的首个新敌,会超发一击）
      if (this.hits >= 4) break;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      if (e.dead || this.hitCd.has(e.id)) continue;
      const d2 = distPtSegSq(e.x + e.w / 2, e.y + e.h / 2, this.cx, this.cy, ex, ey);
      if (d2 > halfW * halfW) continue;
      this.hitCd.set(e.id, 25);
      this.hits++;
      // ★BJ489 def-3：1041 尖刺掷率=rollVanillaHitCrit（melee 旗,命中拍动态;
      //  emitFlintSpikes 入参载体退为关断钉传播面,值不作掷率消费）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // 击退=远离玩家中心（1041 属 AI_190 特列? 否——1041 走默认弹体向;
      // 但 EmitSpikes 弹速自带出手向,原版 num40 缺省=弹体速度向投影。取速度 x 向）
      const kdir = Math.sign(this.vx) || 1;
      hurtEnemy(game, e, dmg, crit, this.knockback, kdir, this.armorPen, this);
      applyImbue(game, e);
      if (this.hits >= 4) break;                      // penetrate=4 上限
    }
    // ---- CutTiles（CanCutTiles :15410 门已过）——沿判定线采样 ----
    const steps = Math.ceil(Math.hypot(ex - this.cx, ey - this.cy) / 12);
    for (let s = 0; s <= steps; s++) {
      const k = steps === 0 ? 0 : s / steps;
      const tx = Math.floor((this.cx + (ex - this.cx) * k) / 16), ty = Math.floor((this.cy + (ey - this.cy) * k) / 16);
      if (game.world.store.inBounds(tx, ty)) game.cutTile(tx, ty);
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(1041);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || !ctx) return;
    const a = 1 - this.alphaI / 255;                  // GetAlpha :80762-80768（α==255 全透）
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, (-img.width * this.scaleV) / 2, (-img.height * this.scaleV) / 2,
      img.width * this.scaleV, img.height * this.scaleV);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
