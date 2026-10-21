// 飞镖投射物(原版 Projectile 10 Dart 语义:直线飞行、撞块消失、命中伤害)。
// 陷阱(137)发射;简化布线:同排/同列直线可见(≤60 格无实心阻挡)的拉杆/开关/压力板驱动。
import { Entity } from './Entity';
import { hitPlayer, playerCanHitEnemy, projOverlap, tryReflectProjectile, tryReflectShimmerSlimeHit, applyBannerDamageDealt, statusPlayer } from './projTargets';
import { InfernoHostileBlast } from './InfernoHostileBlast';
import { shadowbeamLineFx } from '../fx/orchestraFx';
import { ParticleOrchestraType } from '../net/syncModules';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { moveAndCollide } from '../physics/TileCollision';
import { blockBelowMakesSandFall } from './FallingBlock';   // ★④ BBMSF 单源（掉落/沙族批 2026-09-04）
import { TILE } from '../core/constants';
import { TILE_BY_KEY, VANILLA_TILE_ID } from '../data/tiles';
import { prefetchProjectiles, BULLET_KILL_SFX, projFrameCount, idStaticCheck } from './Arrow';
// ★BJ219 弹幕域 oldPos 残影族（Main.cs:30609-31360）——Dart 载体弹接入（573/811/814）
import { ProjGhostRing, drawProjGhosts, projTrailingMode } from './projGhostTrail';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import type { Enemy } from './Enemy'; // type-only（Enemy 运行时反向依赖本文件，避免环）
import { projFrameImg, projSprite, projFrameSrcRect } from './Arrow';
import { segHitsRect } from './bossAI_duke_moonlord';   // 线段命中（bossAI_duke_moonlord 导出共用）
import { hostileProjectileDamage, mainDifficulty, mainExpertMode } from '../stats/ScaleStats';
import { applyProjStatus } from './projStatus';
import { ghostHurtOnHit, playerHasGhostHurt } from './SpectreSoulProj';
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424 星云套装 on-hit 单源
import { noteVanillaProjImmune } from './projTargets';
import { projectileData } from '../data/vanillaProjectiles';
import { GorePiece } from './GorePiece';
import { beeWallPushDir } from './WeaponProj';   // SW-AF1 2026-09-04（F-3）：99 巨石踢墙门单源化（与 655/1047 同摄取器）
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { cutTilesBox } from './ProjCutTiles';   // ★BJ290 件1 死亡段割面（BJ260/285 同款前置习语）

/** 电路陷阱投射物(Wiring.cs:1495-1743)。贴图 = 原版 projectile id;
 *  帧尺寸按实际解包 PNG 整图(素材为完整单帧:98 竖镖 10×28 / 184 竖火舌 10×18 /
 *  185 尖刺球 16×16 / 99 巨石 32×32)——勿按 SetDefaults 碰撞盒裁剪,否则只画残片 */
// tile 137 kind ↔ projectile 对应(Wiring.cs:1764-1890 + Item.cs placeStyle 核实):
//   0 飞镖机关(539)→98 | 1 超级飞镖机关(1146)→184(毒镖样式,有图) |
//   2 烈焰机关(1147)→187(FlamethrowerTrap,官方空桩贴图,视觉=火焰尘埃) |
//   3 尖球机关(1148)→185 | 4 长矛机关(1149)→186(有图)
//   5 剧毒飞镖机关(5135,1.4.5 新)→980 VenomDartTrap(★R20-H2;10×28 贴图,毒 300t)
// 187/654 的 PNG 是官方占位空桩(xnb 像素全零,经字节级同 stub 证实),isBlankTex 检出后
// 走色块回退 + 粒子拖尾——与原版"隐形弹体+尘埃视觉"一致(Projectile.cs:24222 188 同族 dust 驱动)
/** 弹种样式表(★R20-F5 起 export:kb 分档回归测试消费) */
export const TRAP_SHOT_STYLE: Record<string, {
  w: number; h: number; color: string; grav: number;
  proj?: string; fw?: number; fh?: number;
  /** 烟花族：同 kind 多色变体贴图（form 0-3 → 167-170 / 415-418 / 419-422） */
  projs?: string[];
  /** 隐形弹（733 alpha=255 SetDefaults）：纯尘/gore 发射器，不画本体 */
  invisible?: boolean;
  /** ★BJ704-G14 件1：A=0 纯加算白闪族（XNA 预乘语义,GetAlpha A=255−α=0 →
   *  source.rgb 全额加 dest 不衰减=ctx 'lighter';178 彩带弹 2t 白闪） */
  additive?: boolean;
  spin?: boolean | 'roll' | 'bunny'; rotOff?: number;
  /** spin=true 时的滚转系数。现役唯一消费 = 巨石 99(AI_025 :26681 rotation +=
   *  velocity.X*0.06,累加在 kind==='boulder' 支内于踢门【之后】——表值供绘制门
   *  + 回退速率;尖刺球 185 已直写 kind 支 0.1 不走此字段,旧注 0.14 系陈位) */
  spinK?: number;
  trail?: { colors: string[]; count: number; life: number; grav: number };
  /** 炮弹族：前 N tick 直线无重力（Projectile.cs:21546/26844 ai[0]>=18 才加重力） */
  gravDelay?: number;
  /** 水平阻尼（Projectile.cs:21549 velocity.X *= 0.99） */
  xDamp?: number;
  /** 垂直速度上限（Projectile.cs:26850-26853 兔兔炮 15.9） */
  vCap?: number;
  /** 友方弹幕（friendly=true，SetDefaults）：只伤敌怪，不伤玩家/城镇 NPC */
  friendly?: boolean;
  /** 落点爆炸半宽 px（Projectile.Kill 伤害盒：162=144×144→72 / 281=128×128→64） */
  blast?: number;
  /** 撞块破碎尘（Projectile.Kill 166：尘 76 十粒 + Item51） */
  shatterDust?: boolean;
  /** 发射音（Projectile.AI 首帧 SoundID.Item14：162=Projectile.cs:21542 / 281=26830） */
  launchSfx?: string;
  /** extraUpdates 位移倍步（1049=Projectile.cs:9949 extraUpdates=1 → 每拍 2 步）。
   *  仅作用于积分位移；块碰撞仍为拍末中心点单查（陷阱弹既有简化模型） */
  steps?: number;
  /** 绘制缩放（SetDefaults scale：1049=0.8，Projectile.cs:9946——贴图 36px → 28.8px） */
  drawScale?: number;
  /** 淡入速率（alpha 每更新递减量：1049 alpha=254 起 AI 支 :24138 `alpha -= 10`，
   *  extraUpdates=1 → 每拍 20）；globalAlpha = clamp(age×fadeIn/255, 0..1) */
  fadeIn?: number;
  life?: number;
  /** 击退（★R20-F5:Wiring 各 NewProjectile 实参逐型分档——曾统一 sign(vx)*2:
   *  镖族 2(Wiring.cs:1983)/炮弹 162·爆炸兔兔 281 8(:1317/:1326)/巨石 99 10(:2010·
   *  WorldGen.cs:49180)/雪球 166 3.5(:1399)/喷泉 654 2(:3128)/烟花火箭 167 7
   *  (WorldGen.cs:62672)/其余 0） */
  kb?: number;
}> = {
  dart: { w: 8, h: 4, color: '#C8B89A', grav: 0, proj: 'vanilla/Projectile_98.png', fw: 10, fh: 28, rotOff: Math.PI / 2, kb: 2 },
  superdart: { w: 6, h: 6, color: '#8FBF6A', grav: 0, proj: 'vanilla/Projectile_184.png', fw: 10, fh: 18, rotOff: Math.PI / 2, kb: 2 },
  // ★R20-H2:980 VenomDartTrap（SetDefaults :9332-9340:10×10 aiStyle1 penetrate-1 trap;
  //  贴图 10×28 同 98;命中 NPC/玩家均 Venom 300t——projstatus 表 980 已接）
  venomdart: { w: 8, h: 4, color: '#9AC860', grav: 0, proj: 'vanilla/Projectile_980.png', fw: 10, fh: 28, rotOff: Math.PI / 2, kb: 2 },
  flame: { w: 10, h: 10, color: '#FF8030', grav: 0, proj: 'vanilla/Projectile_187.png', fw: 16, fh: 16, kb: 2,
    trail: { colors: ['#FF8030', '#FFC040', '#FF5010'], count: 2, life: 16, grav: -0.03 } },
  spear: { w: 6, h: 14, color: '#B8B8C0', grav: 0, proj: 'vanilla/Projectile_186.png', fw: 10, fh: 16, rotOff: Math.PI / 2, kb: 2 },
  // 185 尖刺球(1458 SetDefaults Projectile.cs:2719-2728):14×14 aiStyle14 friendly+
  //  hostile penetrate-1 timeLeft 900 trap。物理 = AI_014 具名缺省尾(:25441-25453):
  //  ai[0]>5 起 vy==0 且 vx≠0 → vx*=0.97 + |vx|≤0.01 截停归零(静止不 Kill——
  //  静止 Kill 属 261/277 专属支),重力 0.2 同门;终端 16(:25624-25627);
  //  rotation += vx*0.1 每拍(:25452)。反弹响应(Update :19818-19826)= 分轴被挡
  //  → -lastV×0.9(Y 需 lastVy>1,否则落定 0)——见 spiky 运动段注释
  spiky: { w: 14, h: 14, color: '#8A8F96', grav: 0, proj: 'vanilla/Projectile_185.png', fw: 16, fh: 16, kb: 2 },
  // 99 巨石(SetDefaults :1561-1568):31×31 aiStyle25 penetrate-1 trap;物理全在
  // boulderStep(AI_025 :24662-24723 + 撞块 :17530-17551)——grav/vCap 值仅表占位
  boulder: { w: 31, h: 31, color: '#9A8C72', grav: 0, proj: 'vanilla/Projectile_99.png', fw: 32, fh: 32, spin: true, spinK: 0.06, kb: 10 },
  geyser: { w: 10, h: 14, color: '#B8E8F0', grav: 0.02, proj: 'vanilla/Projectile_654.png', fw: 16, fh: 16, kb: 2,
    trail: { colors: ['#E8F4F8', '#C8E4EE'], count: 1, life: 26, grav: -0.015 } },
  // ---- 炮弹族（Wiring.cs case 209/212 → WorldGen.ShootFromCannon / 直接 NewProjectile）----
  // 162 炮弹（SetDefaults Projectile.cs:2239-2246）：16×16 aiStyle2 friendly penetrate4；
  // AI（:23418-23938）：18 tick 直线后 vy+=0.28/vx*=0.99（:23499-23501）；终端 vy 32
  // （aiStyle2 通用钳 :23929-23931，2026-08-14 补;★G22 勘正旧混代锚 :21540-21592/
  // :21978-21981）；Kill（:77391-77453）：64×64→144×144
  // 两段 Damage() 纯伤害（不在 ExplodeTiles 表 = 不破坏地形）
  cannonball: { w: 16, h: 16, color: '#33333C', grav: 0.28, gravDelay: 18, xDamp: 0.99, vCap: 32,
    proj: 'vanilla/Projectile_162.png', fw: 18, fh: 18, spin: 'roll', friendly: true, blast: 72, kb: 8,
    launchSfx: 'explosion', life: 3600 },
  // 281 爆炸兔兔（SetDefaults Projectile.cs:3408-3418）：28×28 aiStyle49 friendly timeLeft600；
  // AI（:28647-28736）同炮弹弧线（18 tick 后 vy+=0.28/vx*=0.99 :28680，vy 上限 15.9
  // :28683-28685;★G22 勘正旧混代锚 :26822-26913）；
  // Kill（:77327-77389）：128×128 Damage() 纯伤害
  bunny: { w: 28, h: 28, color: '#E8E2D8', grav: 0.28, gravDelay: 18, xDamp: 0.99, vCap: 15.9,
    proj: 'vanilla/Projectile_281.png', fw: 28, fh: 28, spin: 'bunny', friendly: true, blast: 64, kb: 8,
    launchSfx: 'explosion', life: 600 },
  // ★BJ704-G14 件1 [g11-cannon-torch-fire]：178 彩带弹（SetDefaults :2643-2651）——
  //  10×10 aiStyle1 无重力直线 / α255 / penetrate−1 / timeLeft 2（2 拍白闪即 Kill）。
  //  friendly/hostile 双 false ⇒ 敌我两命中面整段不进（Damage_PVE :12576 / Damage_EVP
  //  :14847 双 damage 头门,下方 damage-0 早退闸承载）;无发射音（ConfettiGun 音在
  //  物品使用面,弹内零 PlaySound——炮族首帧 Item14 面 162/281 专属）
  confetti: { w: 10, h: 10, color: '#F0F0F0', grav: 0, proj: 'vanilla/Projectile_178.png',
    fw: 10, fh: 10, friendly: false, life: 2, kb: 0, additive: true },
  // 166 雪球（SetDefaults Projectile.cs:2282-2289）：14×14 aiStyle2 friendly ranged coldDamage；
  // AI（:21862-21892）：玩家射出（ai1==1）时命中城镇 NPC 即消散清伤；20 tick 直线后
  // vy+=0.3/vx*=0.98（专属分支，勿改默认档 0.4/0.97——166 不落 else）；终端 32
  // （:21978 通用钳，2026-08-14 补）；Kill（:71758-71767）：碎裂尘无 AoE
  snowball: { w: 14, h: 14, color: '#F2F8FF', grav: 0.3, gravDelay: 20, xDamp: 0.98, vCap: 32,
    proj: 'vanilla/Projectile_166.png', fw: 14, fh: 14, spin: 'roll', friendly: true, kb: 3.5,
    shatterDust: true, life: 3600 },
  // 601 传送门弹（SetDefaults Projectile.cs:3408 族：10×10 friendly，无重力直线；
  // AI :51174-51242：门色拖尾尘 + alpha 递减；撞块 :16672-16686 → PortalHelper.TryPlacingPortal
  // + Kill）。贴图 20×38 竖条 = 2 帧 20×19（frameCounter 4tick 步进）
  portalbolt: { w: 10, h: 10, color: '#B069FF', grav: 0, kb: 0,
    proj: 'vanilla/Projectile_601.png', fw: 20, fh: 19, friendly: true, life: 3600 },
  // ---- 烟花三件套 + 马桶水花（Wiring.cs:1492-1553；WorldGen.LaunchRocket/LaunchRocketSmall）----
  // 167-170 烟花火箭（SetDefaults Projectile.cs:2560-2571）：14×14 aiStyle34 friendly ranged
  // timeLeft45，damage 150 / kb 7（WorldGen.cs:62661-62665）；AI_034（:27519-27579）无重力直线 + 尾烟；
  // Kill（:78125-78557）：Item14 + 按色爆尘 + 192×192 Damage()。贴图 14×28 = 2 帧 14×14（取帧 0）
  fireworkRocket: { w: 14, h: 14, color: '#FF8066', grav: 0, friendly: true, blast: 96, life: 45, kb: 7,
    projs: ['vanilla/Projectile_167.png', 'vanilla/Projectile_168.png',
      'vanilla/Projectile_169.png', 'vanilla/Projectile_170.png'],
    fw: 14, fh: 14, rotOff: Math.PI / 2 },
  // 415-418 烟花盒火箭（SetDefaults Projectile.cs:4944-4951）：14×14 aiStyle34 friendly timeLeft45
  // damage 0（WorldGen.cs:62675-62689）——纯视觉弹，Kill 同样 192×192 Damage() 但伤害为 0
  fireworksBoxRocket: { w: 14, h: 14, color: '#66FF99', grav: 0, friendly: true, blast: 96, life: 45, kb: 0,
    projs: ['vanilla/Projectile_415.png', 'vanilla/Projectile_416.png',
      'vanilla/Projectile_417.png', 'vanilla/Projectile_418.png'],
    fw: 14, fh: 14, rotOff: Math.PI / 2 },
  // 419-422 烟花喷泉：4×4 aiStyle73 friendly——★SetDefaults【无】timeLeft 行（默认 3600），
  // 终值 = NewProjectile 内联 per-Type 表钳 600（Projectile.cs:11035-11050；发射点
  // Player.cs:32619 传 whoAmI=本地玩家 → Owner==Main.myPlayer 表生效）——喷 10 秒
  // 非 60 秒（发射点覆写审计批 2026-09-03；SetDefaults≠终值，见 Arrow.ts 寿命处注）。
  // 锚点 tile 338 消失即 Kill（AI_073 :30982-30986）
  fireworkFountain: { w: 4, h: 4, color: '#FFE85A', grav: 0, friendly: true, life: 600, kb: 0,
    projs: ['vanilla/Projectile_419.png', 'vanilla/Projectile_420.png',
      'vanilla/Projectile_421.png', 'vanilla/Projectile_422.png'],
    fw: 8, fh: 8 },
  // 733 马桶水花（SetDefaults Projectile.cs:7718-7727）：2×2 aiStyle153 tileCollide=false alpha=255
  // ——全隐形纯发射器；AI_153_ToiletPop（:53114-53152）ai[0]==0 → 6 尘 + 1 gore，
  // ai[0] 1..10 → 2 尘 + 1/5 gore，ai[0]>10 → Kill
  toiletPop: { w: 2, h: 2, color: '#8AC7F0', grav: 0, life: 3600, invisible: true, kb: 0 },
  // 1049 霰石/冰雹（dontStarve×FTW 风暴臂 WorldGen.cs:72292 发射；SetDefaults
  //  Projectile.cs:9940-9952）：24×24 aiStyle5 friendly+hostile trap penetrate-1
  //  timeLeft1200 scale0.8 alpha254 extraUpdates1 tileCollide=false。AI_005（:24081 起）：
  //  ai[1]!=0（出生 ai[1]=-1=尾参 num10 :72286/:72292）→ tileCollide=true、无重力直线；
  //  1037/1049 支 alpha 每更新 -10 淡入（:24137-24149）、rotation=velocity.ToRotation()
  //  −π/2（:24197-24199，贴图朝下→rotOff=-π/2）；extraUpdates=1 → 每拍位移 2 步（steps）、
  //  timeLeft 每拍也减 2（Projectile.cs:16780-81/:17307 子步环）→ 实寿命 1200/2=600 拍。
  //  Kill（:75282-75301）= hailKill 专用支（共用 blastKill 是炮弹族 Item14 音/视觉面）：
  //  SoundID.Item89 + Resize(112,112)（blast=56 半宽）+ Damage() 纯伤害盒
  hail: { w: 24, h: 24, color: '#E8A050', grav: 0, proj: 'vanilla/Projectile_1049.png', fw: 36, fh: 36, kb: 10,
    life: 1200, blast: 56, rotOff: -Math.PI / 2, steps: 2, fadeIn: 20, drawScale: 0.8 },
};

/** 电路机关弹幕全族预热(2026-08-13,用户问"电路触发有没有风险"):机关弹幕全部
 *  固定枚举(TRAP_SHOT_STYLE 表驱动,22 张),进图预热后机关首次触发零兜底窗口
 *  ( TrapShot.draw 走 ensureVImage,未预热时首次触发有 ~百ms 色块兜底) */
export function prefetchTrapProjectiles(): void {
  const ids: number[] = [];
  for (const s of Object.values(TRAP_SHOT_STYLE)) {
    for (const f of [s.proj, ...(s.projs ?? [])]) {
      if (!f) continue;
      const m = /Projectile_(\d+)\.png$/.exec(f);
      if (m) ids.push(parseInt(m[1], 10));
    }
  }
  prefetchProjectiles(ids);
}

/** TrapShot 弹种（DeviceCtx.shootProjectile kind 共用） */
export type TrapShotKind = 'dart' | 'superdart' | 'flame' | 'venomdart' | 'spear' | 'spiky' | 'boulder' | 'geyser' | 'cannonball' | 'bunny' | 'snowball' | 'portalbolt' | 'hail'
  | 'fireworkRocket' | 'fireworksBoxRocket' | 'fireworkFountain' | 'toiletPop'
  /** ★BJ704-G14 件1：178 彩带弹（confetti cannon 手动/导线发射,WorldGen.cs:51043
   *  ammo3 → type 178）——10×10 aiStyle1 无重力直线,timeLeft 2,α255(GetAlpha A=255−
   *  α=0 → XNA 预乘纯加算白闪) 纯视觉弹,friendly/hostile 双 false（Damage_PVE/
   *  Damage_EVP 均不进）,Kill=85×d139-142 彩带尘（Game.onProjectileDeath 178 支既有） */
  | 'confetti';

/** TrapShot kind → 原版 projectile id（反射门禁用：Projectile.CanBeReflected 按
 *  type/aiStyle 查表——162 炮弹 aiStyle2 / 166 雪球 aiStyle2 可反射，烟花族
 *  aiStyle 34/73/153 与 281 aiStyle49 不在白名单故不列） */
const TRAP_PROJ_ID: Partial<Record<TrapShotKind, number>> = {
  dart: 98, superdart: 184, flame: 187, venomdart: 980, spear: 186, spiky: 185, boulder: 99,
  geyser: 654, cannonball: 162, bunny: 281, snowball: 166, portalbolt: 601, hail: 1049,
};

/** ---- 烟花尘色表（Projectile.cs Kill/AI 引用的 Dust id → 近似色）----
 *  130-134 爆花尘：发光色照抄 Dust.cs:2204-2226 Lighting.AddLight 的 RGB（134 未入光照表，
 *  金色弹 170 与 133 交替使用，取亮金近似）；219-223 喷泉火花条（DustID.cs:167 仅 219 命名
 *  Fireworks；419 用 222 黄 / 420 用 219 红 / 421 用 221 蓝 / 422 用 219+rand(5)，据此定色）；
 *  216 马桶水花（AI_153 :49299）取浅水蓝 */
export const FW_DUST: Record<string, string> = {
  d130_red: '#FF8066', d131_green: '#66FF99', d132_blue: '#4D80FF',
  d133_yellow: '#E6E64D', d134_gold: '#FFF2A8',
  d219_red: '#FF5A4A', d220_green: '#5AFF8A', d221_blue: '#5A8AFF',
  d222_yellow: '#FFE85A', d223_pink: '#FF66C8',
  d216_water: '#8AC7F0',
};
/** 喷泉彩虹弹 422 的尘池（Projectile.cs:29499：219 + rand(5)） */
export const FW_RAINBOW = [FW_DUST.d219_red, FW_DUST.d220_green, FW_DUST.d221_blue,
  FW_DUST.d222_yellow, FW_DUST.d223_pink];

/** 尖刺球整盒实心探针(B 档清偿 2026-08-31:原版 Projectile.Update 走
 *  Collision.TileCollision 全盒分轴检测,曾只测弹体中心格——擦角穿墙/半嵌天花板
 *  两向漏检;位置修正维持"取消整步+反射响应"形态) */
function shotBoxSolid(game: GameHooks, x: number, y: number, w: number, h: number): boolean {
  const st = game.world.store;
  const x0 = Math.floor(x / TILE), y0 = Math.floor(y / TILE);
  const x1 = Math.floor((x + w - 0.01) / TILE), y1 = Math.floor((y + h - 0.01) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (st.isSolid(tx, ty)) return true;
    }
  }
  return false;
}

/** 弹型 → SetDefaults penetrate 数据档(1458 实测:镖 98/184/980、尖刺球 185、
 *  矛 186、喷泉 654、巨石 99 均 -1;炮弹 162=4;166 雪球/187 烈焰球未赋值=缺省 1。
 *  无表项 kinds 回退单发档) */
function trapPen(kind: TrapShotKind): number {
  const id = TRAP_PROJ_ID[kind];
  const p = id !== undefined ? projectileData(id)?.penetrate : undefined;
  return p ?? 1;
}

/** 弹型(+色变体 form) → 原版弹 id 全映射（★通用湿段批补全——TRAP_PROJ_ID 只列
 *  反射白名单族,烟花三件套/马桶按 form 展开全 id;湿段/豁免面须逐 id 核） */
function trapWetProjId(kind: TrapShotKind, form: number): number {
  switch (kind) {
    case 'fireworkRocket': return 167 + form;        // 167-170（SetDefaults :2560-2571 共块）
    case 'fireworksBoxRocket': return 415 + form;    // 415-418（:4944-4951 共块）
    case 'fireworkFountain': return 419 + form;      // 419-422（:4952-4960 共块）
    case 'toiletPop': return 733;                    // :7718-7727
    default: return TRAP_PROJ_ID[kind] ?? -1;
  }
}

export class TrapShot extends Entity {
  w = 8; h = 8;
  vx: number;
  vy: number;
  /** ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径 true——陷阱镖
   *  同 HandleMovement 面,原版可穿 Hoik 单向墙） */
  hoik = true;
  damage: number;
  kind: TrapShotKind;
  /** 原版弹 id（kind(+form) → trapWetProjId 全映射,构造器填）。
   *  ★债刀-4 清偿（2026-09-17）TrapShot vid 穿线:此前无 projId 槽 → 中央 CutTiles
   *  收口（Entity.ts `vanillaId ?? projId ?? 0`）恒传 0 → Game.cutTile vid=0 视同
   *  非陷阱 → book（5309/5323）佩戴时 natureGuard 误罩陷阱弹。原版 trap=true 是
   *  SetDefaults 型录旗（1457 Projectile.cs 20 站 27 id;全仓无其它写点——fire 时刻
   *  不置位,1458 逐站同表）→ 弹型身份即 trap 语义:本仓 trap 族 kind（98/184/185/
   *  186/187/99/654/980/1049）落在 TRAP_PROJ_VIDS 表内=免保护,非陷阱 kind
   *  （162/166/281/601/167-170/415-418/419-422/733）恒在表外=与原版 trap=false 同相。
   *  消费面:①中央收口→cutTile natureGuard 门 ②开关板 objType 路由（Game.ts
   *  switchTiles `pe.projId ?? …`——boulder≡99 反查 fallback 因此转 legacy）。 */
  projId: number;
  /** 巨石 ai[0] 落地旗(:24666 置 1 后恒 1;转角踢门 :24578 的 ai[0]≠0 条件) */
  boulderLanded = false;
  /** ★BJ704-G11：281 爆炸兔落定旗（碰撞响应 :18951-18960 ReleaseNPC(614)+ai0=-3
   *  ——次拍 AI 头静默 Kill;存续一拍=原版落定拍接触结算照跑） */
  bunnyLanded = false;
  /** 传送门弹 601 的 ai[0]（WorldGen.cs:50622-50631：0 橙门 / 1 蓝门）；
   *  烟花族 = 色变体（167-170 / 415-418 / 419-422 减基址） */
  form = 0;
  /** 喷泉弹锚点 tile（Projectile.ai[0]/ai[1]，Wiring.cs:1548；锚点 338 消失即 Kill） */
  ax = -1;
  ay = -1;
  /** 滚转角(尖刺球/巨石/炮弹族) */
  private rot = 0;
  /** 已飞行 tick（炮弹族重力延迟用，对应原版 ai[0]） */
  private age = 0;
  life = 600;
  dead = false;
  /** 敌对弹（原版 Projectile.hostile，= !style.friendly：机关/陷阱类弹伤玩家，
   *  烟花等 friendly 类不伤）。联机 v5：随 msg27 bit7 下发，访客傀儡据此本地结算 */
  hostile: boolean;
  /** 已反射（原版 Projectile.reflected）：被反射源（419 旋刃冲刺等）打回后置位，
   *  弹体转 hostile 伤玩家、不再入敌怪判定（原版 Damage NPC 需 friendly 门禁） */
  reflected = false;
  /** 剩余可结算命中数（Penetrate 计数面：pen≥2 每次成功命中递减、归零 Kill；
   *  pen=-1 = Infinity 永存续）。单发档恒 1 —— 命中即灭与旧行为一致 */
  pierceLeft: number;
  /** Damage 尾梯免工件窗启用门（Projectile.Damage :12635 flag3 反面 = penetrate≠1
   *  且非 local-immunity：每次成功命中写 targetNPC.immune[owner]=10(:14178-14185)，
   *  同目标 10t 内再入 Damage 头门直接早退） */
  readonly windowGate: boolean;
  /** 逐目标剩余窗口 tick（本仓承载 targetNPC.immune[owner] 语义的弹级镜像表；
   *  键=目标对象引用，随 fixedUpdate 每 tick 递减到 0 删档） */
  private hitCdT = new Map<object, number>();

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段,2026-09-04 溅花缺口批
  //  → projWetSection 共享体接入;逐 id 豁免核对（SetDefaults ignoreWater 行）：
  //  【豁免=不接湿段面(共享体整段门早退)】187 烈焰 :2743-2753 true@:2750 /
  //  186 矛 :2730-2742 true@:2737 / 654 热泉 :7026-7039 true@:7033 /
  //  733 马桶 :7718-7727 true@:7724；
  //  【受段(无行=缺省 false)】98 :1825-1834 / 184 :2709-2718 / 980 :9332-9341 /
  //  185 :2719-2729 / 99 :1835-1852 / 162 :2508-2516 / 166 :2551-2559 /
  //  281 :3678-3689 / 601 :6504-6512 / 1049 :9940-9954 / 167-170 :2560-2571 /
  //  415-418 :4944-4951 / 419-422 :4952-4960。
  //  位序口径：原版 AI(:16880) → 湿段(:16903) → HandleMovement(:17120)/
  //  UpdatePosition(:19973)。本域各 aiStyle（1/2/5/14/25/34/49/73）AI 段湿旗消费者
  //  普查（AI() 全域 :23404-37400 wet 读点 ：24351 aiStyle5(1037/1049 尘 6 !wet 门)
  //  /:25563/:25590 aiStyle14(326-328,400-402,1107-1109 专属)/:26320 aiStyle24(1114)/
  //  :26754 aiStyle25 尾 AnyWet Kill(1053/655/727/1054)/:27387/:27399 aiStyle32/
  //  :27685 aiStyle36(307)/:30078 aiStyle65/:30725 aiStyle68/:33599 aiStyle95——本类
  //  现役受理面唯 1049 命中）→ 1049 尘链读相已按原版时序修（2026-09-08 上子步段值
  //  快照 wetSub0,逐轮同源,见 fixedUpdate 湿段块注）;其余 kind 消费面为零,语义不变。
  //  湿阻尼 :17721-17764 读【本子步刷新后】旗（原文同相,勿改读快照）。----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐子步 −1；
   *  1049 extraUpdates=1 → 每拍 2 子步各 −1（R2 P2-4 子步湿段收编）→ 10 计窗=5 拍） */
  wetCount = 0;
  /** 出生预置已做（NewProjectile :10886-10892 等价;共享体首调用执行） */
  presetDone = false;

  /** 全透明贴图缓存(xnb 解包异常的 187/654 等):检出一次后走色块回退,避免隐形弹幕。
   *  ★未加载(懒加载 pending)不得判 blank——否则 null 会被永久缓存,贴图晚到也不恢复
   *  (VANILLA_MISC 瘦身转懒后这是必踩坑,2026-08-13) */
  private static blankTex = new Set<string>();
  private static okTex = new Set<string>();
  private static isBlank(r: Renderer, path: string): boolean {
    if (TrapShot.blankTex.has(path)) return true;
    if (TrapShot.okTex.has(path)) return false;
    const img = r.atlas?.vimages.get(path);
    if (!img) return false; // 贴图未就绪:不判也不缓存,由 draw 的 ensureVImage 触发加载
    let blank = true;
    {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) { if (d[i] > 30) { blank = false; break; } }
    }
    (blank ? TrapShot.blankTex : TrapShot.okTex).add(path);
    return blank;
  }

  constructor(x: number, y: number, vx: number, vy: number, damage: number, kind: TrapShotKind,
    form = 0, anchor?: [number, number]) {
    super();
    const s = TRAP_SHOT_STYLE[kind];
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.kind = kind;
    this.form = form;
    this.projId = trapWetProjId(kind, form);   // ★债刀-4：vid 穿线（fireworks/toilet 按 form 展开,详字段注）
    if (anchor) { this.ax = anchor[0]; this.ay = anchor[1]; }
    this.w = s.w; this.h = s.h;
    if (kind === 'spiky') this.life = 900; // 原版 185 timeLeft 900(1405/1456 SetDefaults 同)
    if (s.life !== undefined) this.life = s.life; // 炮弹族 timeLeft（SetDefaults 默认 3600 / 281=600）
    this.hostile = !s.friendly;
    {
      // 穿透数据面（SetDefaults penetrate；见 trapPen 注）：-1=∞，≥2=计数穿透，1/缺省=单发
      const pen = trapPen(kind);
      this.windowGate = pen !== 1;
      this.pierceLeft = pen > 0 ? pen : Infinity;
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    // 世界坐标绘制(Renderer 实体循环运行在世界变换内,勿再自算屏幕坐标)
    const ctx = r.ctx;
    if (!ctx) return;
    const st = TRAP_SHOT_STYLE[this.kind];
    if (st.invisible) return; // 733 alpha=255：隐形纯发射器（SetDefaults :7440）
    // ★BJ704-G11（件2①）：281 出膛隐身窗（AI_049 :28688-28690——SetDefaults α=255
    //  （:3685）,ai0>2 才 alpha=0 ⇒ 出生拍+拍 1/2 全隐,拍 3 起可见+poof（update 侧））
    if (this.kind === 'bunny' && this.age < 3) return;
    // 烟花族按 form 选色变体贴图；单贴图 kind 走 proj。
    // ★ensureVImage 触发懒加载(VANILLA_MISC 瘦身后弹幕表不再预载,直取会永久色块)
    const tex = st.projs?.[this.form] ?? st.proj;
    const img = tex && r.atlas ? r.atlas.ensureVImage(tex) : null;
    if (img && st.fw && st.fh && !TrapShot.isBlank(r, tex!)) {
      // 原版弹幕贴图(整帧):飞行类贴图默认朝上(镖尖/火苗向上),对齐速度方向需 +90°;
      // 尖刺球/巨石不随速度旋转,按位移滚转
      ctx.save();
      ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
      if (st.spin) ctx.rotate(this.rot);
      else if (Math.abs(this.vx) + Math.abs(this.vy) > 0.01) ctx.rotate(Math.atan2(this.vy, this.vx) + (st.rotOff ?? 0));
      // 淡入弹（1049 alpha=254 → AI 支每更新 -10 :24138,extraUpdates=1 → 每拍 -20）
      if (st.fadeIn) ctx.globalAlpha = Math.min(1, Math.max(0.04, this.age * st.fadeIn / 255));
      // SetDefaults scale 缩绘（1049 scale=0.8,Projectile.cs:9946——36px 贴图 → 28.8px）
      const ds = st.drawScale ?? 1;
      // ★BJ704-G14 件1：A=0 加算族（178）切 'lighter'（XNA 预乘 source.rgb 全额
      //  加 dest=alpha 通道 0 只衰减 dest,rgb 贡献不衰减——'lighter' 逐项相等）
      if (st.additive) ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(img, 0, 0, st.fw, st.fh, -st.fw * ds / 2, -st.fh * ds / 2, st.fw * ds, st.fh * ds);
      ctx.restore();
      return;
    }
    ctx.fillStyle = st.color;
    ctx.fillRect(this.x, this.y, this.w, this.h);
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    // 联机傀儡（远端弹幕快照驱动）：对敌判定归拥有者客户端；对玩家（hostile）由访客本地结算 Damage_EVP（netPuppetProjContact）
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // ★BJ704-G11（件2①）：281 落定静默灭——ai0=-3 次拍 AI 头 Kill（AI_049 :28656-
    //  59;Kill case 281 ai0==-3 门=零 FX 零伤害）。落定拍照常走接触结算（原版
    //  Damage() 在 active 弹逐拍跑）,次拍头即灭=原版同拍序。
    if (this.bunnyLanded) { this.dead = true; return; }
    // 烟花三件套 + 马桶水花：独立 AI 族（aiStyle 34/73/153），不走陷阱弹通用位移/命中链
    if (this.kind === 'fireworkRocket' || this.kind === 'fireworksBoxRocket'
      || this.kind === 'fireworkFountain' || this.kind === 'toiletPop') {
      this.fireworkUpdate(game);
      return;
    }
    // ---- ★通用湿段（:16903-17113,tick 头口径见字段块注;溅花尘/音=wetSplashStepShared
    //      弹面 10 粒;豁免 id 由共享体 :16903 整段门早退=零触发）----
    //  置于 timeLeft 递减/Kill 前：原版湿段 :16903 与 timeLeft--(:17307)/Kill(:17308)
    //  同在子步环内且在前 → 寿终拍湿段照跑（烟花支 fireworkUpdate 头同口径）
    //  ★AI 湿旗读相=上子步段值快照 wetSub0（2026-09-08 定谳批）:vanilla 子步环
    //  (:16781 while(numUpdates>=0)) 内序=AI(:16880)→湿段(:16903)→位移 → 子步 k 的
    //  AI 读子步 k-1 段值（本域唯一湿旗消费者=aiStyle5 :24351 !wet 尘门）;本链 2 轮
    //  连排（AI 逐子步拆分=尘点位次域,既有登记不动）→ 轮1 读 wetSub0（=上拍子步2
    //  段值=vanilla 子步1 AI 读值,逐位同源）、轮2 读当拍拍头段值（=vanilla 子步2 AI
    //  读值）。首拍预置先行单跑=首拍子步1段（首拍未移动,采样位=出生盒=
    //  NewProjectile :10886-10893 同位）→ 快照=预置值（vanilla 首子步 AI 读预置值同相）。
    const wetId = trapWetProjId(this.kind, this.form);
    const presetFirst = !this.presetDone;
    if (presetFirst) {
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        wetId, !!projectileData(wetId)?.ignoreWater);
    }
    const wetSub0 = this.wet;
    if (!presetFirst) {
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        wetId, !!projectileData(wetId)?.ignoreWater);
    }

    // ---- 1049 天界塔霰石 AI_5 尘链（1457 :24342-24364 aiStyle5 `type != 1037 &&
    //      type != 1049 return` 后的 1037/1049 专属支;2026-09-06 残差清偿——本链此前
    //      整条缺位）:!wet 完美支（:24359）读相已按原版时序修（2026-09-08 上子步段值
    //      快照批,逐轮读值见湿段块注——轮1=上拍子步2段值/轮2=本拍子步1段值,与原版
    //      子步1/子步2 AI 读值逐位同源）。★extraUpdates=1（:9949）→ 原版 AI 在子步环
    //      内（:16781 while(numUpdates>=0)）每拍跑 2 次 → 本链每拍 2 轮（steps 同源）。
    //      逐值：vector9=Center+Normalize(v)×10（:24343）;两支各 1/2 掷（:24344/:24358）
    //      尘型 Next(4)==0?6:31（:24345）——velocity=（v.RotatedBy(±π/2)×0.25+v/3)×0.9
    //      （:24347 绝对赋值,消解 NewDust 抖与 6 号烟族型内初速——原版同款覆写）、
    //      position=vector9+v.RotatedBy(±π/2)（:24346/:24348）、scale×=0.3+0.9×NextFloat
    //      （:24350,链式——烟族 ×0.7 预处理【保留】）、velocity×=NextFloat（:24351）、
    //      noGravity（:24352）;!wet 支（:24359-24365）1 粒 NewDustPerfect(
    //      Center+NextVector2Circular(25,25), 6)——perfect 位置精确覆写（Dust.cs:52-63,
    //      Velocity 缺省 null → 烟族型内预处理初速【保留】,仅 ×0.5/:24362）、scale×=1.3
    //      （:24363）、fadeIn=1（:24364）、noGravity（:24365）----
    if (this.kind === 'hail') {
      const hailSteps = TRAP_SHOT_STYLE.hail.steps ?? 1;
      const hsp = Math.hypot(this.vx, this.vy);
      const hnx = hsp > 1e-6 ? this.vx / hsp : 0;
      const hny = hsp > 1e-6 ? this.vy / hsp : 0;
      for (let hs = 0; hs < hailSteps; hs++) {
        // ★读相（2026-09-08 快照批）：轮 k 读子步 k-1 段值（vanilla AI 先于湿段跑）
        const wetRead = hs === 0 ? wetSub0 : this.wet;
        const v9x = this.cx + hnx * 10, v9y = this.cy + hny * 10;        // vector9 :24343
        for (const side of [-1, 1] as const) {                            // +π/2 支先掷（:24344）
          if (Math.random() >= 0.5) continue;                             // Main.rand.Next(2)==0
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h,
            Math.floor(Math.random() * 4) === 0 ? 6 : 31);                // :24345 型掷在 NewDust 实参位
          if (d) {
            const rx = side < 0 ? -this.vy : this.vy;                     // v.RotatedBy(±π/2)（XNA 旋转 ±90°）
            const ry = side < 0 ? this.vx : -this.vx;
            d.x = v9x; d.y = v9y;                                         // dust6.position = vector9 :24346
            d.vx = (rx * 0.25 + this.vx / 3) * 0.9;                       // :24347
            d.vy = (ry * 0.25 + this.vy / 3) * 0.9;
            d.x += rx; d.y += ry;                                         // position += v.RotatedBy :24348-24349
            d.scale *= 0.3 + 0.9 * Math.random();                         // :24350
            d.vx *= Math.random();                                        // :24351
            d.vy *= Math.random();
            d.noGravity = true;                                           // :24352
          }
        }
        if (!wetRead) {                                                   // :24359（!wet 门,读相见上注）
          const ha = Math.random() * Math.PI * 2;                         // NextVector2Unit :Utils.cs:1295
          const hr = Math.random() * 25;                                  // ×NextFloat()×(25,25) :Utils.cs:1301
          const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 6);          // NewDustPerfect(Position,0,0,6)
          if (d) {
            d.x = this.cx + Math.cos(ha) * hr;                            // perfect 位置覆写（Dust.cs:55-56）
            d.y = this.cy + Math.sin(ha) * hr;
            d.vx *= 0.5; d.vy *= 0.5;                                     // :24362 velocity×0.5（双分量）
            d.scale *= 1.3;                                               // :24363
            d.fadeIn = 1;                                                 // :24364
            d.noGravity = true;                                           // :24365
          }
        }
      }
    }
    // timeLeft-- 原版在 extraUpdates 子步环内逐次执行（Projectile.cs:16780-16781
    // `numUpdates = extraUpdates; while (numUpdates >= 0)` → :17307 `timeLeft--;`
    // :17308-17311 timeLeft<=0 → Kill）——即每拍递减 (extraUpdates+1) 次。1049
    // extraUpdates=1（:9949）→ 每拍减 2,SetDefaults timeLeft=1200（:9948）实寿命
    // 600 拍（曾按每拍 1 次=寿命翻倍）。本仓 steps = 位移步数 = extraUpdates+1,
    // 递减次数与之同源;仅 hail 表项 steps=2,其余缺省 1 行为不变。
    this.life -= TRAP_SHOT_STYLE[this.kind].steps ?? 1;
    if (this.life <= 0) {
      // 炮弹族 timeLeft 耗尽同样走 Kill 爆炸（Projectile.Kill 由 timeLeft 归零触发）
      if (this.kind === 'hail') this.hailKill(game);   // 1049 同型（600 拍到点亦爆,:75282）
      else if (this.kind === 'confetti') {
        // ★BJ704-G14 件1：178 彩带 Kill（:76062-76085）=85×d139-142 彩带尘（初速
        //  三重扰动）——Dart 载体不路由 onProjectileDeath（Game.ts:554 注）,本口
        //  显式走 Game 178 分支（Arrow 载体同组面同款单点直调）
        this.dead = true;
        (game as unknown as { onProjectileDeath?: (id: number, x: number, y: number,
          w?: number, h?: number, ovx?: number, ovy?: number, dmg?: number) => void })
          .onProjectileDeath?.(178, this.x, this.y, this.w, this.h, this.vx, this.vy, this.damage);
        return;
      }
      else if (TRAP_SHOT_STYLE[this.kind].blast) this.blastKill(game);
      else this.dead = true;
      return;
    }
    const st = TRAP_SHOT_STYLE[this.kind];
    this.age++;
    // 逐目标免工件窗递减（NPC.immune[owner] 原版在 NPC.Update 全实体每拍扣 1）
    for (const [k, v] of this.hitCdT) {
      if (v <= 1) this.hitCdT.delete(k); else this.hitCdT.set(k, v - 1);
    }
    // 首帧发射音（Projectile.AI：162=Projectile.cs:21542-21546 / 281=26830-26833 SoundID.Item14）
    if (this.age === 1 && st.launchSfx) game.playSfx(st.launchSfx, 1, this.x + this.w / 2, this.y + this.h / 2);
    // 滚转：巨石 99 走 kind==='boulder' 支内单次累加(见下——本块若再计即双倍,
    // 终清波勘误),其余表项 spinK 回退 0.03 | 炮弹族 'roll'/'bunny' 按原版
    if (st.spin === true && this.kind !== 'boulder') this.rot += this.vx * (st.spinK ?? 0.03);
    else if (st.spin === 'roll') {
      // aiStyle2（Projectile.cs:21528）：rotation += (|vx|+|vy|)*0.03*direction
      this.rot += (Math.abs(this.vx) + Math.abs(this.vy)) * 0.03 * (this.vx < 0 ? -1 : 1);
    } else if (st.spin === 'bunny') {
      // aiStyle49（Projectile.cs:26841）：rotation += vx*0.05 + direction*0.05
      this.rot += this.vx * 0.05 + (this.vx < 0 ? -1 : 1) * 0.05;
    }
    // SW-AQ1 2026-09-05：oldPosition 上报（Update :17118 AI 后/位移前置位——
    //  机关巨石 kind==='boulder' 走 objType 3（:17195 白名单）、余 kind 走 objType 4
    //  （:19978）,两路 SwitchTiles 内部新旧位判定（Collision.cs:3346-3353/:3356）消费）
    this.oldX = this.x; this.oldY = this.y;
    if (this.kind === 'boulder') {
      // ---- 巨石 aiStyle 25(AI_025 1458 :26359 起;踢块 :26596-26677 + 撞块族
      //      :17530-17551)----
      // 滞滞启动踢(:26596-26677):落地态(ai[0]≠0,本仓 landed)且 vy≤0 且 vx==0 →
      // 探 ±40px(8+32)侧壁:左实 → 向右踢 0.5 / 右实 → 向左 / 两侧空 → 按
      // Center.X 奇偶定向。没有这一踢,vx=0 命不中滚地加速两分支 → 落地即死停。
      if (this.boulderLanded && this.vy <= 0 && this.vx === 0) {
        // SW-AF1 2026-09-04（F-3 收敛）：踢墙摄取器单源化 → WeaponProj.beeWallPushDir
        //  （655 蜂巢支同一摄取器,三级递宽 ±8/24/40px 扫窗 + 左实优先 + Center.X 奇偶
        //  兜底全同构）。原第二实现用 st.isSolid()=缺 halfBrick/slope/platform 排除
        //  （原版 SolidTile W.cs:70642-70655 = active && !inActive && tileSolid &&
        //  !tileSolidTop && !halfBrick && slope==0）→ 斜坡/半砖/平台格被误判实心墙
        //  而起踢;Math.floor 负商分叉也随 trunc(C# (int) 朝零) 修正。★行为变更=1:1
        //  目标:斜坡/半砖/平台格原版不踢,本仓亦不踢。
        //  ★OOB 语义（SW-AL1 2026-09-05 定谳,纠正旧备案"越界=null→true"）：
        //  vanilla Main.tile 是裸 Tile[,]（Main.cs:1690）,OOB 下标抛异常被 SolidTile
        //  catch 吞掉【返 false】（W.cs:70642-70655）——beeWallPushDir OOB=false
        //  ≡ 原版,非差项（详证见 WeaponProj.ts beeWallPushDir 注）。
        this.vx = beeWallPushDir(game.world.store, this.x, this.y, this.w, this.cx);
      }
      // 重力 0.3/终端 16(1458 :26741/:26685-26687);滚地加速:vy≤6 且 |vx|<7 →
      // ±0.05(:26717-26723)——落地后不会停,持续加速滚动直到撞墙;旋转 = vx×0.06
      // 单次(:26682 `type!=1055` 支)。★终清波勘误:此处与通用 spin 块原本各计一次
      // = 双倍;已把 boulder 从通用块剔除——本行位于踢门【之后】,与 vanilla 拍内
      // 时序一致(踢(:26596-26677)→rot(:26682)→ai[0]=1(:26684)→滚地加速→重力)。
      // 撞块(AABB 分轴 + lastVelocity):Y 阻挡且 lastVy>5 → 反弹 −lastVy×0.2(:17551,
      // 软落直接落定不微弹);X 阻挡 → HitTiles(敲石音+尘)+ 碎裂消亡(:17561-17574)。
      this.boulderLanded = true;               // ai[0]=1(:26684,次 tick 起转角门生效)
      this.rot += this.vx * 0.06;
      this.vy += 0.3;
      if (this.vy > 16) this.vy = 16;
      if (this.vy <= 6) {
        if (this.vx > 0 && this.vx < 7) this.vx += 0.05;
        else if (this.vx < 0 && this.vx > -7) this.vx -= 0.05;
      }
      const lvx = this.vx, lvy = this.vy;
      // ★碰撞 = 引擎通用 moveAndCollide(玩家/敌怪同款,带贴边钳制/推出)。
      // 陷阱几何:巨石右列常坐在未致动石上,出生即嵌地形 ~15px——自建边缘
      // 采样两轮翻车(出生叠壁误碎→预叠容忍→贴地恒沉→严格阻挡又嵌住),
      // 全部退役。响应旗标:hitWall=撞墙碎裂;onGround=落地(硬落反弹 ×0.2)。
      // ★水中位移阻尼(HandleMovement :17721-17764,湿段批)——速度【场】不减只削
      // 位移:乘进 dx/dy 入参,采纳处(lastVX/lastVY 档+反弹式)原样回读勿除回
      // (原版碰撞响应读的也是未阻尼 velocity 场)。
      const dfB = projWaterDragFactor(this);
      moveAndCollide(this, game.world, this.vx * dfB, this.vy * dfB);
      if (this.hitWall) {
        game.playSfx('tink', 1, this.cx, this.cy);      // HitTiles 敲击音
        game.spawnParticles(this.cx + this.w / 2 * Math.sign(lvx || 1), this.cy, '#9A8C72', 8, 2.4, { life: 40 });
        this.shatter(game);                              // 撞墙碎裂(:17574 Kill)
        this.dead = true;
        return;
      }
      if (this.onGround) this.vy = lvy > 5 ? -lvy * 0.2 : 0;
      // 落下不 return:继续走下方对玩家/敌怪命中段(穿透语义在 hostile/pierce 链)
    }
    if (this.kind === 'spiky') {
      // ---- aiStyle14 缺省尾（1458 P.cs:25441-25453 + 块尾终端 :25624-25627）----
      // 滚转恒跑：rotation += velocity.X*0.1(:25452，曾误 spinK 0.14)；
      // ai[0]>5 门内：贴地摩擦 vx*=0.97(仅 vy==0 且 vx≠0)+|vx|≤0.01 截停归零
      // (:25449-25452 置 0 非 Kill——静止 Kill 属 261/277 具名支)+重力 0.2；
      // 终端速度 16(:25624,曾误 15.9)。首 5 更新无重力/摩擦(ai[0] 计数门)
      this.rot += this.vx * 0.1;
      if (this.age > 5) {
        if (this.vy === 0 && this.vx !== 0) {
          this.vx *= 0.97;
          if (this.vx > -0.01 && this.vx < 0.01) this.vx = 0;
        }
        this.vy += 0.2;
      }
      if (this.vy > 16) this.vy = 16;
      // 分轴积分 + type185 反弹响应（1458 P.cs:19818-19826）：
      // X 阻挡 → vx=-lastVx*0.9；Y 阻挡且 lastVy>1 → vy=-lastVy*0.9，否则落定 0。
      // ★探针升级整盒（B-M：曾只测中心格——擦角穿墙/半嵌天花板两向漏检）
      // ★水中位移阻尼（HandleMovement :17721-17764,湿段批）——速度场不减只削位移
      const dfS = projWaterDragFactor(this);
      const lvx = this.vx, lvy = this.vy;
      this.x += this.vx * dfS;
      if (shotBoxSolid(game, this.x, this.y, this.w, this.h)) { this.x -= this.vx * dfS; this.vx = -lvx * 0.9; }
      this.y += this.vy * dfS;
      if (shotBoxSolid(game, this.x, this.y, this.w, this.h)) { this.y -= this.vy * dfS; this.vy = lvy > 1 ? -lvy * 0.9 : 0; }
    } else if (st.gravDelay !== undefined) {
      // 炮弹族弧线：前 gravDelay tick 直线，之后 vy+=grav / vx*=xDamp
      // （162/281=Projectile.cs:21546-21550/26844-26849 的 ai[0]>=18；166=:21879-21884 的 >=20）
      if (this.age >= st.gravDelay) {
        this.vy += st.grav;
        this.vx *= st.xDamp ?? 1;
        if (st.vCap !== undefined && this.vy > st.vCap) this.vy = st.vCap; // 281 :26850-26853
      }
    } else {
      this.vy += st.grav;
    }
    // ---- ★BJ704-G11（件2①）：281 出膛 poof + 前 2 拍隐身（AI_049 :28688-28740）——
    //      ai0>2 才 alpha=0（SetDefaults α=255 :3685 → 拍 1/2+出生拍全隐）,ai0==3
    //      出膛尘+gore：10×d31（α100 s1.5,vel×0.5+v×0.1）+5×(d6 s2 noGravity vel×3+
    //      v×0.2; d6 s1 vel×2+v×0.3)+1×gore 61-63（位−(10,10)+v×1.25,scale1.5,
    //      vel=(newGore 扰动+v×0.5)×0.02）。隐身面=draw 侧 age<3 跳画。----
    if (this.kind === 'bunny' && this.age === 3) {
      for (let i = 0; i < 10; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
        if (d) { d.vx = d.vx * 0.5 + this.vx * 0.1; d.vy = d.vy * 0.5 + this.vy * 0.1; }
      }
      for (let i = 0; i < 5; i++) {
        const dA = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100, null, 2, true);
        if (dA) { dA.vx = dA.vx * 3 + this.vx * 0.2; dA.vy = dA.vy * 3 + this.vy * 0.2; }
        const dB = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100);
        if (dB) { dB.vx = dB.vx * 2 + this.vx * 0.3; dB.vy = dB.vy * 2 + this.vy * 0.3; }
      }
      const gP = GorePiece.newGore(61 + Math.floor(Math.random() * 3),
        this.x - 10, this.y - 10, 0, 0);
      if (gP) {
        gP.x += this.vx * 1.25; gP.y += this.vy * 1.25;      // :28736 position += v×1.25
        gP.scale = 1.5;                                       // :28737
        gP.vx = (gP.vx + this.vx * 0.5) * 0.02;               // :28738-40 (扰动+v×0.5)×0.02
        gP.vy = (gP.vy + this.vy * 0.5) * 0.02;
      }
    }
    // ---- ★BJ704-G11（件2①,[刀5 边界「弹药面」登记债清偿]）281 爆炸兔 撞块响应
    //      （Projectile.cs:18942-18970 type 281 专属块——AI_049 活兔态 ai0≥0）：
    //      碰撞（TileCollision 清轴）后 flag14=|vx|+|vy|<2（读【碰后】速度,被挡轴
    //      已 0;ai0==-1 尸态支无原版写位=不可达）→ 落定放兔：ReleaseNPC(Center.X,
    //      Bottom.Y−4,614,Style 3|4,owner)（:18951-18960——Style=(vx>0?1:2)+2 含 0→4,
    //  →  ReleaseNPC case 614 NPC.cs:80957-80977 方向强制±1+SpawnedFromStatue=true
    //  =死亡爆弹 0 伤）+ai0=-3 → 次拍 AI 头静默 Kill（无爆无 FX）;else 被挡轴
    //  反弹 = −lastV×0.5。旧仓=撞块即爆（blastKill）——活兔在原版从不撞块爆炸,
    //  弹跳衰减至缓速落定化兔,爆只在 timeLeft 600 耗尽（Kill case 281,blastKill
    //  保留）或释放兔 614 死亡（Enemy 死亡支 ai0=-2 已落）。
    //      ★BJ704-G14（2026-10-21）G11 登记债①②已清偿：①idStatic 免疫窗已换轨
    //  全场共享桶（idStaticCheck(281,…,10) 单源,直击环+blastDamage 两消费位——
    //  见下方命中环/寿命爆注）;②CanReleaseNPCs 释放限流门已建模（Game.canReleaseNpcs
    //  双门=TryStartUse/ReleaseNPC 内门;本支 spawnNpcByVanilla released=true 走内门）。----
    //      ★G11 件2③残项（281 timeLeft 尽爆 Kill FX 精确面）亦随 G14 blastKill 分支
    //  清偿（Sound4+gore76/77+尘恰数+128 盒 idStatic 窗）。----
    if (this.kind === 'bunny') {
      const dfB2 = projWaterDragFactor(this);
      const lvx2 = this.vx, lvy2 = this.vy;                  // lastVelocity（:17696）
      this.x += this.vx * dfB2;
      let hitX2 = shotBoxSolid(game, this.x, this.y, this.w, this.h);
      if (hitX2) { this.x -= this.vx * dfB2; this.vx = 0; }  // TileCollision 清被挡轴
      this.y += this.vy * dfB2;
      let hitY2 = shotBoxSolid(game, this.x, this.y, this.w, this.h);
      if (hitY2) { this.y -= this.vy * dfB2; this.vy = 0; }
      // ★BJ704-G14（G11 件2① 附带回归修复,域回归 cannon-projectiles 定谳）：原版
      //  本块在 `if (flag)`（:18015——TileCollision/SlopeCollision 实际发生位/速度
      //  变更才置位）门内=【碰撞拍专属】;旧无碰撞门=空中缓速兔（竖直上抛过顶点
      //  vy≈0 / 静止出生）误落定放兔。落定门=碰撞拍 ∧ 碰后 |v|<2（:18947 flag14）。
      if ((hitX2 || hitY2) && Math.abs(this.vx) + Math.abs(this.vy) < 2) {   // flag14（:18945 碰后速度）
        const style614 = (this.vx > 0 ? 1 : 2) + 2;          // :18954-18955 → 3|4
        // ★BJ704-G14（件2②）：released=true → ReleaseNPC 内门 CanReleaseNPCs
        //  （NPC.cs:80930）在 spawnNpcByVanilla 释放域生效（超限返 null=原版
        //  ReleaseNPC -1 同相;ai0=-3 置位在外=落定灭弹照走,原版同拍序）
        const spawned614 = game.spawnNpcByVanilla?.(614,
          Math.trunc(this.cx), Math.trunc(this.y + this.h) - 4, undefined, true);
        if (spawned614) {
          spawned614.releasedFromItem = true;                // releaseOwner=owner（myPlayer 不变式）
          spawned614.spawnedFromStatue = true;               // Style>2 档（:80966-68,死亡爆弹 0 伤）
          spawned614.facing = style614 === 3 ? 1 : -1;       // 方向强制（:80971-76）
        }
        this.bunnyLanded = true;                             // ai0=-3（:18959）→ 次拍静默灭
      } else {
        if (hitX2) this.vx = -lvx2 * 0.5;                    // :18963-18966 反弹 ×−0.5
        if (hitY2) this.vy = -lvy2 * 0.5;                    // :18967-18970
      }
    } else if (this.kind !== 'spiky' && this.kind !== 'boulder') {
      // extraUpdates 位移倍步（1049 extraUpdates=1 :9949 → 2 步/拍；其余表项单步）。
      // 步间不重查块——陷阱弹碰撞模型维持拍末中心点单查（类头注既有简化）
      // ★水中位移阻尼（HandleMovement :17721-17764,湿段批）——逐子步位移同削
      //（原版 UpdatePosition :19973 每子步 position += wetVelocity）
      // ★R2 P2-4（2026-09-07）湿段逐【子步】：原版湿段在 numUpdates 子步环内
      //  (:16781-17345,湿段 :16903)——extraUpdates=1 → 每拍 2 次,采样位=本子步头
      //  （上一子步位移末位）;wetCount :17109-17112 逐子步 −1 → 10 计窗=5 拍
      //  （旧每拍 1 次=10 拍,子步节奏残差清偿）。首子步湿段=拍头既有调用（测试位=
      //  上拍位移后同位）;步 k≥2 在本环内补跑（采样位=上一子步位移末位=原版子步
      //  头同位）,阻尼档随子步旗刷新（HandleMovement :17721 读本子步湿段后旗）。
      //  1049 AI 侧尘链仍拍级 2 轮连排读拍头旗——AI 逐子步拆分属视觉尘域,登记不动。
      let df = projWaterDragFactor(this);
      const steps = st.steps ?? 1;
      for (let s2 = 0; s2 < steps; s2++) {
        if (s2 > 0) {
          projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
            wetId, !!projectileData(wetId)?.ignoreWater);
          df = projWaterDragFactor(this);
        }
        this.x += this.vx * df;
        this.y += this.vy * df;
      }
    }
    // 粒子拖尾(原版火焰陷阱/热喷泉的视觉主体是沿途粒子;每 2 tick 一次防刷屏)
    if (st.trail && (this.life & 1) === 0) {
      game.spawnParticles(
        this.x + this.w / 2, this.y + this.h / 2,
        st.trail.colors[(this.life >> 1) % st.trail.colors.length],
        st.trail.count, 0.4, { life: st.trail.life, damp: 0.96, grav: st.trail.grav },
      );
    }
    // 传送门弹拖尾（Projectile.cs:51180-51192：尘 264 = 门色，无重力）
    if (this.kind === 'portalbolt' && (this.life & 1) === 0) {
      game.spawnParticles(
        this.x + this.w / 2, this.y + this.h / 2,
        this.form === 0 ? '#FFAA28' : '#3CE0FF', 1, 0.6, { life: 14, damp: 0.94, grav: 0 },
      );
    }
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    // ★BJ704-G11（件2①）：281 活兔碰撞已全权在上方分轴支承载（反弹/落定）——
    //  中心格整爆检查对 bunny 整支跳过（原版撞块从不爆炸,blastKill 仅 timeLeft 尽）
    if (this.kind !== 'bunny' && game.world.store.isSolid(tx, ty)) {
      // 传送门弹撞块（Projectile.cs:16672-16686）：落门后消亡（音效 Item115/114 按 form）
      if (this.kind === 'portalbolt') {
        game.placePortal?.(this.x, this.y, this.vx, this.vy, this.form);
        game.playSfx(this.form === 0 ? 'portalOrange' : 'portalBlue', 1, this.x, this.y);
        this.dead = true;
        return;
      }
      // 巨石撞块已在上方针石专属分支(AI 25 AABB 分轴)处理;此处仅余非巨石族
      // 冰雹 1049 撞块 → 专用落地爆（Kill :75282-75301：Item89 + 112×112 Damage()）
      if (this.kind === 'hail') {
        this.hailKill(game);
        return;
      }
      if (st.blast) {
        // 炮弹/兔兔炮撞块 → Kill 落点爆炸（Projectile.cs:77391-77453 / 77327-77389;★G22 勘正旧混代锚）
        this.blastKill(game);
        return;
      } else {
        // 雪球撞块碎裂（Projectile.cs:71758-71767）
        if (st.shatterDust) this.shatter(game);
        this.dead = true;
        return;
      }
    }
    // 友方弹幕（炮弹族 friendly=true）：不伤玩家，直接进敌怪判定。
    // 敌对陷阱：伤害走 damagePlayer(防御减算/受击音/iframes 去重);除巨石外命中即碎。
    // 读实例 hostile 而非 style.friendly——反射后弹体转 hostile 需改为伤玩家
    if (this.hostile) {
      // ★BJ704-G14 件1：Damage_EVP 头门 damage<=0 整退（Projectile.cs:14847）——
      //  178 彩带/733 马桶族 0 伤纯视觉弹不再进玩家判定（旧 hurt(0) 空击=非 1:1）
      if (this.damage > 0
        && projOverlap(this.x, this.y, this.w, this.h, game.player) && !game.player.dead) {
        hitPlayer(this, game, this.damage, !this.reflected); // trap 标（反射弹非陷阱）
        // 巨石 99 / 冰雹 1049 penetrate=-1（SetDefaults）——命中玩家不碎,继续飞行
        // （原版由 immune 窗/撞块/timeLeft 收口）;其余机关弹单发档命中即碎
        if (this.kind !== 'boulder' && this.kind !== 'hail') this.dead = true;
        if (this.dead) return;
      }
    }

    // ---- 命中怪物/小动物/城镇 NPC（原版陷阱弹幕对全实体敌对，Projectile.Damage 语义） ----
    // ★穿透规则数据面清偿（2026-08-31 台账 A1）：存续与免工件窗一律按 SetDefaults
    // penetrate 取值（trapPen()）——1458 实测:镖 98(:1825)/超级镖 184(:2709)/尖刺球
    // 185(:2719)/矛 186(:2730)/喷泉 654(:7026)/毒镖 980(:9332)/巨石 99 均 -1=无限穿透,
    // 每敌 10t 免工件窗(Damage 尾梯 :14178-14185 写 immune[owner]=10,头门 :12635-12638
    // immune>0 整体早退→同怪 10t 一跳、不同怪同拍各结算);炮弹 162=4(计数穿透);
    // 166 雪球未赋值=缺省 1 单发。曾用 kind 白名单近似("boulder/spiky/flame/
    // cannonball/bunny 其余首杀")——镖族四型+喷泉命中首怪即灭、187 烈焰球反向恒穿,
    // 两向缺口就此闭合。
    const overlaps = (e: { x: number; y: number; w: number; h: number }) =>
      this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y;
    /** 可结算？（immune[owner]>0 时 Damage 头门早退,不消耗任何效果） */
    const windowOpen = (k: object): boolean => !this.windowGate || ((this.hitCdT.get(k) ?? 0) <= 0);
    // ★BJ704-G14 件2①：281 usesIDStaticNPCImmunity=10 共享桶（SetDefaults :3686-3687;
    //  Projectile.cs:12595 头门 IsNPCIndexImmuneToProjectileType + :14031-14037 命中尾
    //  perIDStaticNPCImmunity[281]=GameUpdateCount+10 写行）——全场所有 281（TrapShot
    //  活兔直击/寿命爆 + Arrow 爆弹态）共用一张表（idStaticCheck 单源）,多兔同敌
    //  10t 一跳;私表 hitCdT 对 bunny 停用。iframes 前置读门=dealContacts :444 同位
    //  （拒收不落桶账,原版写行在 StrikeNPC 后 :14031）。
    const bunnyIdStatic = this.kind === 'bunny';
    /** 成功命中尾：写 10t 免工件窗 + Penetrate 计数递减;返回 false = 应 Kill
     *  （★G14 件2①：bunny 的窗已由 idStaticCheck 共享桶在门位写,私表停笔） */
    const afterHit = (k: object): boolean => {
      if (this.windowGate && !bunnyIdStatic) this.hitCdT.set(k, 10);
      return --this.pierceLeft > 0;
    };
    // 怪物桶（Enemy.hurt 自带 8tick 无敌帧，穿透弹不会同帧连击）。
    // 反射后的弹体 friendly 已翻——不再入敌怪判定（原版 Damage NPC 门禁）
    if (!this.reflected) {
      const trapProjId = TRAP_PROJ_ID[this.kind];
      const kb = st.kb ?? 2;   // ★R20-F5:逐型击退（Wiring 各 NewProjectile 实参）
      // ★BJ290 件1（死亡段割面族 BJ260/285 同款前置习语,2026-09-23）：CutTiles
      //  （P.cs:12517）在 Damage() 内先于 Damage_PVE（:12523）——命中即亡弹死亡拍
      //  【照割】（:781 afterHit 计数归零 killNow:166 雪球 pen1 首中亡/162 炮弹 pen4
      //  末击亡,均 vanilla friendly;中央割 !e.dead 门=死亡拍整缺 → 环前前置弹盒上报,
      //  hurt 前序=原版序,幂等双报同惯例）。门 !this.hostile=本仓"伤玩家"档（与
      //  vanilla friendly/hostile 数据面不同域,见 :745 注）——现役可达死亡位仅
      //  162/166 两 friendly 型;陷阱镖族虽 vanilla friendly+hostile 双旗,但
      //  penetrate=-1（pierceLeft=Infinity）恒不经死亡位,零扰面。
      if (!this.hostile) cutTilesBox(game, this.x, this.y, this.w, this.h);
      // ★BJ704-G14 件1：Damage_PVE 头门 damage<=0 整退（Projectile.cs:12576-12579）——
      //  0 伤弹（178 彩带/733 马桶/415-418 烟花盒/601 传送门弹）敌怪/小动物/城镇判定
      //  整段不进（原版连 StatusNPC/穿透计数都不触;旧 hurt(0) 空击+免工件窗空写=
      //  非 1:1）。CutTiles 在 Damage_CanDealDamage 门内先于 PVE（:12516-12523）——
      //  本 return 置割草【后】= friendly 0 伤弹（烟花盒/传送门弹）割面保持。
      // ★BJ704-G14 件1：Damage_PVE 头门 damage<=0 整退（Projectile.cs:12576-12579）——
      //  0 伤弹（178 彩带/733 马桶/415-418 烟花盒/601 传送门弹）敌怪/小动物/城镇判定
      //  整段不进（原版连 StatusNPC/穿透计数都不触;旧 hurt(0) 空击+免工件窗空写=
      //  非 1:1）。CutTiles 在 Damage_CanDealDamage 门内先于 PVE（:12516-12523）——
      //  本 return 置割草【后】= friendly 0 伤弹（烟花盒/传送门弹）割面保持。
      if (this.damage <= 0) return;
      for (const ent of game.enemies()) {
        // ★dontTakeDamage 目标排除（:12600 同款——拒收命中不得耗穿透/免工件窗/snapStrike，最终清零补）
        if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
        if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
        const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean; def?: { hitSound?: string[] }; reflectsProjectiles?: boolean };
        if (e.dead || !overlaps(e)) continue;
        // 反射源命中（Projectile.cs:12050-12060）：友方炮弹/雪球可反射（aiStyle2）
        // （独立于 immune 窗——原版反射扫描不经 Damage()，照常受理）
        if (trapProjId !== undefined && tryReflectProjectile(this, trapProjId, e, game)) return;
        // 免工件窗门（Damage 头 :12635-12638 同构：窗口未到期=整体早退,
        // StatusNPC/焰爆石/幽灵头/伤害/击退全部不触发）
        // ★BJ704-G14 件2①：281 换轨全场共享桶（peek 即写=绝对到期,Arrow 同源）
        const targetKey = e as unknown as object;
        if (bunnyIdStatic) {
          if (((e as unknown as { iframes?: number }).iframes ?? 0) > 0) continue;   // dealContacts :444 同位（拒收不落桶账）
          if (!idStaticCheck(281, (e as unknown as { id?: number }).id ?? -1, 10)) continue;
        } else if (!windowOpen(targetKey)) continue;
        // StatusNPC 命中 debuff（Projectile.cs:10555 表驱动——毒飞镖 98 掷中必染
        // Poison 600t / 超级镖 184 900t :11041/:11045;矛/尖球/巨石/喷泉等表内无条目
        // 天然空掷）。曾整类漏接 = 飞镖陷阱永不上毒（2026-08-19 补）
        // 陷阱弹原版由 Wiring 发射时显式带 owner=Main.myPlayer（Wiring.cs case 137
        // :1764/:1786 镖 98/184/:1965-1983 NewProjectile 尾参 Main.myPlayer）→
        // StatusNPC :11192-11196 的 catalystBand 门对陷阱镖同样生效
        if (trapProjId !== undefined) applyProjStatus(trapProjId, e as unknown as Record<string, number>,
          { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true });
        // ★焰爆石 6178 kind1 弹幕位（Projectile.cs:13439-42）：陷阱弹由 Wiring 发射时
        // 尾参 owner=Main.myPlayer（Wiring.cs case 137 :1764/:1786/:1965-1983 取证）
        // ⇒ ownedBySomeone 面成立；仅数据面带类旗的型号能过门——现役 TRAP_PROJ_ID
        // 表内镖族 98/184/185/186/187/980 均【无类旗】原版本就不触发，唯一可达 =
        // 巨石族（若 id 带类旗则自动生效）。此处故意不复写实例 hostile 投影（本仓
        // hostile 承载"伤玩家"档，与原版 Projectile.hostile/friendly 数据面不同域）；
        // 反射弹已由外层 !this.reflected 拦截。
        if (trapProjId !== undefined) {
          // ★F3/F1 收编升级（2026-08-31 蓝队四轮）：双支单源（kind1 门+kind0 门同序,
          // 数据面无类旗弹恒双拒）+ 返回 num14 加伤并入实伤参
          const snapBonusTrap = projectileSnapStrikeBonus(game, { projId: trapProjId },
            e.x + e.w / 2, e.y + e.h / 2, (e as unknown as { id?: number }).id ?? -1,
            { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 } });
          // 击退方向 = 弹 direction（Projectile.cs:13652 num40=direction,水平 ±1）
          e.hurt(applyBannerDamageDealt(game, e, this.damage)
            + (snapBonusTrap ? Math.trunc(snapBonusTrap * 1) : 0),
            Math.sign(this.vx) * kb, 0, game, 0, false, 0, true);   // 音/飘值=单点
        } else {
          e.hurt(applyBannerDamageDealt(game, e, this.damage), Math.sign(this.vx) * kb, 0, game, 0, false, 0, true);   // 音/飘值=单点
        }
        // ★SW-BJ62 微光史莱姆 676 命中后反射（Damage_PVE_Inner :13721-13725——
        // StrikeNPC 后弹回玩家+penetrate++；676 不置 reflectsProjectiles 故 :711
        // 事前支对 676 恒不触发。陷阱弹 penetrate=-1 无递减面,补偿空置=原版同拍
        // （-1+1=0 经 ReflectProjectile penetrate=1 归一后弹回存续））
        if ((e as { vanillaId?: number | null }).vanillaId === 676) {
          tryReflectShimmerSlimeHit(this as unknown as Parameters<typeof tryReflectShimmerSlimeHit>[0],
            trapProjId ?? 0, e as unknown as { vanillaId?: number | null; immortal?: boolean }, game, this.life);
        }
        // ★GC1 写方桥（Projectile.Damage :14031-14183 命中尾梯,StrikeNPC 后原位）：
        // 陷阱弹 id 的全局档按纯表取（现役表内无显型定档/三旗——penetrate 走数据面：
        // 98/184/185/186/980 均 penetrate=-1 ⇒ 末档每次命中写 immune[owner]=10
        // （:14180-14183,1457 SetDefaults 实测值,非 flag3!）;★蓝队二轮重审计修正旧注
        // "单发族无写"的错误叙事——trap 弹不做穿透计数,immune[owner]=10 全局面语义,
        // 消费面=近战三重门 immune 分量）。
        if (trapProjId !== undefined) {
          noteVanillaProjImmune(game, trapProjId,
            (e as unknown as { id?: number }).id ?? -1);
        }
        // 命中尾梯（P.cs:14178-14185）：写目标 10t 免工件窗 + Penetrate 计数递减
        // ——计数归零(炮弹 4 发族)即 Kill;无限档(-1)永存续
        if (!afterHit(targetKey)) {
          if (st.shatterDust) this.shatter(game);
          this.dead = true;
          return;
        }
        // ★GB1（GC 契约，2026-08-31）：幽灵伤害头 ghostHurt（Projectile.cs:13881 →
        //  :12021）——按弹 id 的 magic 归属面数据门挂接（与 Arrow/MagicProj/MissileProj
        //  同构;StrikeNPC(:13712) 后调用位）。本族现役弹 id 表（TRAP_PROJ_ID：
        //  98/184/185/186/187/980 等 vanilla-projectiles.json）全部无 magic 位 →
        //  恒空掷零行为变化;接缝保持弹型忠实——若未来新增 magic 陷阱弹即自动生效。
        if (trapProjId !== undefined && projectileData(trapProjId)?.magic === true
          && playerHasGhostHurt(game.player)) {
          const v156 = e as unknown as { lastStrikeDealt?: number };
          ghostHurtOnHit(game,
            { magic: true, projDamage: this.damage,
              projX: this.x, projY: this.y, projW: this.w, projH: this.h,
              ownerCx: game.player.cx, ownerCy: game.player.cy },
            { x: e.x, y: e.y, w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2,
              vanillaId: (e as unknown as { vanillaId?: number | null }).vanillaId,
              dealt: v156.lastStrikeDealt ?? 0 });   // 本拍结算面（蓝队 F2② 修订）
        }
        // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持
        // magic 门（现役陷阱弹全 non-magic 恒空掷,未来 magic 弹自动生效）
        if (trapProjId !== undefined) {
          nebulaBoosterOnHit(game,
            { projId: trapProjId, projDirX: this.vx },
            { x: e.x, y: e.y, w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2,
              vanillaId: (e as unknown as { vanillaId?: number | null }).vanillaId,
              dealt: (e as unknown as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
        }
      }
    }
    // 友方弹幕（炮弹族 friendly=true）到此为止：不误伤小动物/城镇 NPC
    // （原版 friendly 弹对城镇 NPC 免疫；小动物不在敌怪判定内）。
    // 反射后转 hostile 同样走此出口（原版敌弹对 NPC 无伤害）
    if (!this.hostile || this.reflected) return;
    // 小动物桶（Enemy 单参 shim / Critter.hurt(game) 皆可，被击即死）
    // ★SW-BI1 2026-09-06：hurt 改可选形+调用前守卫——npcs 桶有非 TownNPC 成员
    //  （PetFollower 宠物走 Game.ts:36787 入 npcs 桶、无 hurt 方法），机关弹碰上
    //  即 `k.hurt is not a function` 帧循环停机（SW-BI1 报告同族二道防线；原版
    //  单数组 Main.npc 全员有 StrikeNPC，本仓分桶后必须逐员验 hurt）。
    // ★BJ290 件1 备案锁（2026-09-23,死亡段割面族普查）：下方两死亡位（小动物
    //  `!afterHit→dead`/城镇 NPC 同式）【不加割】——原版 CutTiles 调用点
    //  （P.cs:12516）在 `friendly&&…` 门内,hostile 弹全程无割面;本位仅 hostile
    //  非反射弹可达（上方 `!this.hostile||reflected` 早退）,且现役 hostile 路径
    //  全型 penetrate=-1（pierceLeft=Infinity,:370）恒不经 afterHit 死亡位
    //  =死码位。未来若加 vanilla-hostile 有限穿透弹,原版本就不割=勿补;若加
    //  vanilla-friendly 有限穿透陷阱型,死亡拍割随中央收口语义另议（登记）。
    const buckets = (game as unknown as { entities?: { critters: Array<{ x: number; y: number; w: number; h: number; dead: boolean; hurt?: (g: GameHooks) => boolean }>; npcs: Array<{ x: number; y: number; w: number; h: number; dead: boolean; hurt?: (d: number, kx: number, ky: number, g: GameHooks) => boolean }> } }).entities;
    if (buckets) {
      for (const c of buckets.critters) {
        if (c.dead || !c.hurt || !overlaps(c)) continue;
        const ck = c as unknown as object;
        if (!windowOpen(ck)) continue;
        c.hurt(game);
        if (!afterHit(ck)) { this.dead = true; return; }
      }
      // 城镇 NPC（TownNPC.hurt：防御减伤+无敌帧+死亡移除）；无 hurt 成员（宠物）跳过
      for (const n of buckets.npcs) {
        if (n.dead || !n.hurt || !overlaps(n)) continue;
        const nk = n as unknown as object;
        if (!windowOpen(nk)) continue;
        n.hurt(this.damage, Math.sign(this.vx) * (st.kb ?? 2), 0, game);
        if (!afterHit(nk)) { this.dead = true; return; }
      }
    }
  }

  /** 雪球碎裂（Projectile.Kill type166，Projectile.cs:71758-71767：尘 76 十粒 + Item51） */
  private shatter(game: GameHooks): void {
    game.spawnParticles(this.x + this.w / 2, this.y + this.h / 2, '#F2F8FF', 10, 1, { life: 20, damp: 0.94, grav: -0.01 });
    game.playSfx('shatter', 1, this.x, this.y);
  }

  /** 冰雹 1049 落地爆（Projectile.Kill type 1037/1049 支 :75282-75301）：SoundID.Item89
   *  + Resize(112,112)（:75295）+ Damage() 纯伤害盒——PVE 全 NPC 表（Damage_PVE :12520；
   *  城镇 NPC 经 hostile&flag2 门 :12607 可命中）+ EVP 玩家（hostile，:14846）。
   *  原版尘 31×6 / gore 61-63×3 / 尘 6×24+18（!wet :75302-75320）→ 引擎粒子两段近似 */
  private hailKill(game: GameHooks): void {
    this.dead = true;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    game.playSfx('hailImpact', 1, cx, cy);   // SoundID.Item89（:75285）
    game.spawnParticles(cx, cy, '#B8B0A8', 6, 1.8, { life: 22, damp: 0.95 });               // 尘 31 烟族×6
    game.spawnParticles(cx, cy, '#EAF6FF', 24, 3, { life: 26, damp: 0.94, grav: -0.02 });   // 尘 6 水花×24
    const r = 56;                            // Resize(112,112) 半宽（:75295）
    this.blastDamage(game, cx, cy, r);       // PVE（playerCanHitEnemy 门=Damage_PVE_Inner 同构）
    // EVP（Damage_EVP :14846——hostile 弹伤玩家；trap=true 陷阱源语义；盒=112×112。
    //  projId 附随实参（hitPlayer 内 SkipDamage_EVP 查表读）——字面量超型收窄绕过
    //  形参无 projId 槽的形检,运行时字段仍在）
    hitPlayer({ x: cx - r, y: cy - r, w: r * 2, h: r * 2, projId: 1049 } as { x: number; y: number; w: number; h: number },
      game, this.damage, true);
    // 城镇 NPC（Damage_PVE hostile&flag2 门 :12607——1049 hostile=true 故可命中）
    // ★SW-BI1 2026-09-06：hurt 改可选形+守卫——npcs 桶含 PetFollower（无 hurt），
    //  同 SW-BI1 二道防线（见上方 buckets 循环注）。
    for (const n of game.npcs?.() ?? []) {
      const t = n as unknown as { x: number; y: number; w: number; h: number; dead?: boolean;
        hurt?: (d: number, kx: number, ky: number, g: GameHooks) => void };
      if (t.dead || !t.hurt) continue;
      if (!(cx - r < t.x + t.w && cx + r > t.x && cy - r < t.y + t.h && cy + r > t.y)) continue;
      t.hurt(this.damage, Math.sign(this.vx) * (TRAP_SHOT_STYLE.hail.kb ?? 2), 0, game);
    }
  }

  /** 落点爆炸（Projectile.Kill 专属支逐型分派）：
   *  · 281 爆炸兔（:77327-77389 ★BJ704-G14 件2③ 精确面清偿——ai0≠-3 门由
   *    bunnyLanded 早灭支前置承载）：PlaySound(4)+gore76/77（初速 rand(−20..20)×0.2
   *    −v×0.5）+Item14+尘31×20（s1.5 vel×1.4）+尘6×10 双档（s2.5 noG vel×5 /
   *    s1.5 vel×3）+gore61-63×4（vel×0.4+象限 ±1）+damage>0 门 128×128 Damage()
   *    （idStatic 共享桶窗）。
   *  · 162 炮弹（:77391-77453 同刀精确面）：Item14+64×64 Damage()+尘31×20（vel×2.5）
   *    +尘6×50（s2.5 noG vel×Next(50,151)×0.1）+尘6×10（s1.5 vel×3 vy−1）+
   *    gore61-63×4（vel×0.4+象限 ±1.5）+144×144 再 Damage()（两段间 immune[owner]=10
   *    窗=私表 hitCdT 承载,内盒敌不二结算——净命中集与单段 144 等价,窗为两段间语义）。
   *  · 162/281 均不在 ExplodeTiles 判定表（Projectile.cs:75260）→ 不破坏地形;
   *    friendly 弹不伤玩家（281 hostile 形态在 Arrow 爆弹支,勿混）。
   *  · 烟花火箭 167-170/415-418 不入本口（fireworkUpdate 早退路由 :436-441,死
   *    亡位=timeLeft/撞块/接触杀 → explodeFirework 专支）。 */
  private blastKill(game: GameHooks): void {
    this.dead = true;
    const st = TRAP_SHOT_STYLE[this.kind];
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    if (this.kind === 'bunny') {
      game.playSfx('killed', 1, cx, cy);   // PlaySound(4)（:77330——legacy 4=Killed,Arrow 281 爆弹同款）
      const gvelB = () => (Math.floor(Math.random() * 41) - 20) * 0.2;   // Next(-20,21)×0.2
      const gB76 = GorePiece.newGore(76, this.x, this.y, gvelB(), gvelB());
      if (gB76) { gB76.vx -= this.vx * 0.5; gB76.vy -= this.vy * 0.5; }  // :77332-77336 −v×0.5
      const gB77 = GorePiece.newGore(77, this.x, this.y, gvelB(), gvelB());
      if (gB77) { gB77.vx -= this.vx * 0.5; gB77.vy -= this.vy * 0.5; }
      game.playSfx('explosion', 1, cx, cy);   // Item14（:77341）
      for (let i = 0; i < 20; i++) {          // :77342-77347 尘 31×20（α100 s1.5 vel×1.4）
        const dB31 = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
        if (dB31) { dB31.vx *= 1.4; dB31.vy *= 1.4; }
      }
      for (let i = 0; i < 10; i++) {          // :77348-77358 尘 6 双档×10（s2.5 noG vel×5 / s1.5 vel×3）
        const dA6 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100, null, 2.5, true);
        if (dA6) { dA6.vx *= 5; dA6.vy *= 5; }
        const dB6 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100, null, 1.5);
        if (dB6) { dB6.vx *= 3; dB6.vy *= 3; }
      }
      for (const [kxB, kyB] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {   // :77359-77373 gore 61-63 四象限
        const gQ = GorePiece.newGore(61 + Math.floor(Math.random() * 3), this.x, this.y, 0, 0);
        if (gQ) { gQ.vx = gQ.vx * 0.4 + kxB; gQ.vy = gQ.vy * 0.4 + kyB; }
      }
      if (this.damage > 0) this.blastDamage(game, cx, cy, 64, 281);   // :77374-77384（128×128,Damage_EVP friendly 早退;damage>0 门原版字面 :77375）
      return;
    }
    if (this.kind === 'cannonball') {
      game.playSfx('explosion', 1, cx, cy);   // Item14（:77392）
      this.blastDamage(game, cx, cy, 32);     // :77393-77400 第一段 64×64（心保持扩盒）
      // :77401 起尘/gore 采样盒 = 扩后 64×64（position 已 recenter,尘域=心±32,
      //  gore 出生点=盒左上角 (cx−32, cy−32)——NewGore position 单点语义）
      const bx162 = cx - 32, by162 = cy - 32;
      for (let i = 0; i < 20; i++) {          // :77407-77412 尘 31×20（s1.5 vel×2.5）
        const dC31 = game.spawnDust?.(bx162, by162, 64, 64, 31, 0, 0, 100, null, 1.5);
        if (dC31) { dC31.vx *= 2.5; dC31.vy *= 2.5; }
      }
      for (let i = 0; i < 50; i++) {          // :77413-77419 尘 6×50（s2.5 noG vel×Next(50,151)×0.1）
        const dC6 = game.spawnDust?.(bx162, by162, 64, 64, 6, 0, 0, 100, null, 2.5, true);
        if (dC6) { const fC = (50 + Math.floor(Math.random() * 101)) * 0.1; dC6.vx *= fC; dC6.vy *= fC; }
      }
      for (let i = 0; i < 10; i++) {          // :77420-77426 尘 6×10（s1.5 vel×3 vy−1）
        const dC6b = game.spawnDust?.(bx162, by162, 64, 64, 6, 0, 0, 100, null, 1.5);
        if (dC6b) { dC6b.vx *= 3; dC6b.vy = dC6b.vy * 3 - 1; }
      }
      for (const [kxC, kyC] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {   // :77427-77444 gore 61-63 四象限（±1.5）
        const gQ = GorePiece.newGore(61 + Math.floor(Math.random() * 3), bx162, by162, 0, 0);
        if (gQ) { gQ.vx = gQ.vx * 0.4 + 1.5 * kxC; gQ.vy = gQ.vy * 0.4 + 1.5 * kyC; }
      }
      this.blastDamage(game, cx, cy, 72);     // :77445-77452 第二段 144×144（心再扩）
      return;
    }
    game.playSfx('explosion', 1, cx, cy); // SoundID.Item14（Projectile.cs:72769/72706）
    game.spawnParticles(cx, cy, '#FFA050', 14, 3.5, { life: 18, damp: 0.93, grav: -0.02 });
    game.spawnParticles(cx, cy, '#FFF0C0', 8, 4.5, { life: 10, damp: 0.9, grav: -0.05 });
    this.blastDamage(game, cx, cy, st.blast!);
  }

  /** 伤害盒结算（炮弹族与烟花火箭共用的 Damage() 语义：friendly 只伤敌怪）。
   *  ★BJ704-G14 件2①③：idStaticKey=281（兔爆）走全场共享桶窗（Damage_PVE :12595
   *  头门 + :14031 写行——与直击环/Arrow 爆弹态同一张表）;0=走私表 hitCdT（162 双
   *  盒间窗,immune[owner]=10 末档,pen=4≠1）。damage<=0 整退（Damage_PVE :12576）。
   *  ★BJ704-G21 R8-F2（爆面扩盒 CutTiles 清偿）：Damage() 内建 CutTiles（:12515-
   *  12518 friendly∧myPlayer∧!npcProj∧!minion——CutTilesAt 吃【已扩】盒,割草/
   *  碎罐）旧爆面整缺（同役直击环 :852/Arrow 爆弹 :5553 均有,唯此面漏——红队
   *  按 FX 位清单的漏型判例）。位=damage 头门【前】（Damage() 序 :12516 CutTiles
   *  先于 :12576 damage<=0 PVE 整退——0 伤烟花盒 415-418 原版 192² Damage() 照割）。
   *  ★BJ704-G21 R8-F5（dontTakeDamage 外环门补齐）：:12604 直击环 :866 同款——
   *  ZappingJellyfish{63,64,103,242} 例外在爆族（281/162/1049/烟花全非接触族
   *  aiStyle∈{19,161,75,140}）=净拒收（原版内层 :12687 return 同净效,无电击面）;
   *  置 idStatic 写位【前】=充能水母不白耗 10t 共享桶窗（原版写梯 :14031 在受里
   *  面深位,拒收/电击拍零落账）。
   *  ★BJ704-G22（g21-fw-idstatic-1t 清偿）：idStatic 身份键参数化——烟花火箭
   *  167-170 SetDefaults usesIDStaticNPCImmunity+idStaticNPCHitCooldown=1（:2568-
   *  2570,全场同型共享 1t 窗：同拍同型第二发/接触杀→爆花对同敌不二结算）;窗长
   *  单源=projectileData(idStaticKey)（json 双闸门管控面,281=10/167-170=1）。
   *  烟花盒 415-418 无 idStatic 行（:4944-4951）→ 传 0 走私表/门全关（damage=0
   *  本就无 PVE 面）。immunityIdentity=type（:784 默认）⇒ 键=167+form 逐型分桶
   *  ≙ 原版 perIDStaticNPCImmunity[type] 逐型一张表。 */
  private blastDamage(game: GameHooks, cx: number, cy: number, r: number, idStaticKey = 0): void {
    const box = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
    // ★BJ704-G22：idStatic 窗长数据面单源（json idStaticNPCHitCooldown;281=10/
    //  167-170=1——缺档兜底 10 与旧字面同值）
    const idCd = idStaticKey ? (projectileData(idStaticKey)?.idStaticNPCHitCooldown ?? 10) : 0;
    if (!this.hostile) cutTilesBox(game, box.x, box.y, box.w, box.h);   // R8-F2：先于 damage 门（:12516→:12523 序）
    if (this.damage <= 0) return;
    for (const ent of game.enemies()) {
      if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;   // R8-F5：:12604 外环门
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean; def?: { hitSound?: string[] } };
      if (e.dead) continue;
      if (!(box.x < e.x + e.w && box.x + box.w > e.x && box.y < e.y + e.h && box.y + box.h > e.y)) continue;
      // 免工件窗门（162 两段间 immune 窗 / 281·烟花共享桶——拒收不消耗任何效果）
      if (idStaticKey) {
        if (((e as unknown as { iframes?: number }).iframes ?? 0) > 0) continue;
        if (!idStaticCheck(idStaticKey, (e as unknown as { id?: number }).id ?? -1, idCd)) continue;
      } else if (this.windowGate && (this.hitCdT.get(e as unknown as object) ?? 0) > 0) continue;
      // ★焰爆石/拍击石弹幕双支位（Projectile.cs:13439-13446；F3/F1 收编升级）——
      // TRAP_PROJ_ID 兜底查 id（162/281 无类旗原版恒不触发），站位补齐同命中环注；
      // 返回 num14 加伤并入实伤参（无 crit 面,×1）
      const blProjId = TRAP_PROJ_ID[this.kind];
      let snapBonusBlast = 0;
      if (blProjId !== undefined) {
        snapBonusBlast = projectileSnapStrikeBonus(game, { projId: blProjId },
          e.x + e.w / 2, e.y + e.h / 2, (e as unknown as { id?: number }).id ?? -1,
          { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 } });
      }
      e.hurt(applyBannerDamageDealt(game, e, this.damage)
        + (snapBonusBlast ? Math.trunc(snapBonusBlast * 1) : 0),
        Math.sign(this.vx) * (TRAP_SHOT_STYLE[this.kind].kb ?? 2), 0, game, 0, false, 0, true);   // 音/飘值=单点
      // 命中尾免疫梯（GC1 桥——162 末档写 10 / 281 idStatic 写 0+共享桶已写）
      if (blProjId !== undefined) {
        noteVanillaProjImmune(game, blProjId, (e as unknown as { id?: number }).id ?? -1);
      }
      if (this.windowGate && !idStaticKey) this.hitCdT.set(e as unknown as object, 10);
    }
  }

  // ============ 烟花三件套 + 马桶水花（Projectile 167-170 / 415-422 / 733）============

  /** 烟花族 AI 主循环。
   *  火箭（aiStyle34，Projectile.cs:27519-27579）：无重力直线上升 + 尾烟尘 6，
   *  timeLeft 45 到点或撞块 → Kill 爆花；
   *  喷泉（aiStyle73，:30978-31125）：静态发射器，锚点 338 消失即 Kill，每 tick 2 粒火花；
   *  马桶（aiStyle153，:53114-53152）：11 帧水花后自杀 */
  private fireworkUpdate(game: GameHooks): void {
    const isRocket = this.kind === 'fireworkRocket' || this.kind === 'fireworksBoxRocket';
    // ---- ★通用湿段（:16903-17113,共享体;tick 头口径同 fixedUpdate 字段块注）----
    //  烟花三件套逐 id：167-170/415-418/419-422 受段（SetDefaults :2560/:4944/:4952
    //  均无 ignoreWater 行）,733 马桶豁免（:7718-7727 true@:7724 → 共享体整段门早退）。
    //  ★寿终拍湿段照跑口径：原版 timeLeft 归零 Kill 在子步环 :17307-17311,湿段
    //  :16903 同环在前——故置本函数头（--life 早退之前）。
    const wetIdFw = trapWetProjId(this.kind, this.form);
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      wetIdFw, !!projectileData(wetIdFw)?.ignoreWater);
    // ★BJ704-G22（烟花域扫面清偿）：Damage() 内建 CutTiles（:12515-12518 friendly∧
    //  myPlayer——CanCutTiles :15407-15418 黑名单制,aiStyle 34/73 不在排除表=可割）
    //  逐拍随 Damage() 跑;烟花族 fireworkUpdate 早退路由（:436-441）旧整缺=飞行
    //  火箭/喷泉弹不割草。位=life 检查前（死亡拍小盒照割,vanilla Damage() :17184
    //  在 timeLeft Kill :17307 前）;马桶 733 vanilla 无 friendly 行（=false）→ 本仓
    //  hostile=true 同相不割。
    if (!this.hostile) cutTilesBox(game, this.x, this.y, this.w, this.h);
    if (--this.life <= 0) {
      if (isRocket) this.explodeFirework(game); // timeLeft 45 到点 → Kill()（:17307-17310）→ aiStyle34 爆段（:78125-78557）
      else this.dead = true;                    // 喷泉 3600 自然耗尽（马桶由下方 age 分支自杀）
      return;
    }
    this.age++;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    if (isRocket) {
      // ★水中位移阻尼（HandleMovement :17721-17764,湿段批）——aiStyle 34 不在
      // UpdatePosition 跳过表（:20551）,velocity 场不减只削位移（直积分乘进位移行）
      const dfFw = projWaterDragFactor(this);
      this.x += this.vx * dfFw;
      this.y += this.vy * dfFw;
      // 尾烟（AI_034 :27559-27570）：167-170 每帧 1 粒尘 6；415-418 自 ai[0]>4 起（:27559-27569）
      //（引擎粒子 2 tick 一发节流，视觉近似——1:1 尘数=45/t 对引擎粒子成本翻倍,维持登记近似）
      const trailOk = this.kind === 'fireworkRocket' || this.age > 4;
      if (trailOk && (this.life & 1) === 0) {
        game.spawnParticles(this.x + this.w / 2, this.y + this.h, '#A8A8A0', 1, 0.6,
          { life: 18, damp: 0.95, grav: -0.02 });
      }
      // ★BJ704-G22（烟花域扫面清偿·接触面整缺）：vanilla Damage() 逐拍跑（:17184;
      //  aiStyle34 不在 Damage_CanDealDamage 排除表 :12463）→ 飞行火箭对敌接触
      //  friendly 直击（伤 150/kb7）,penetrate 1 耗尽 → :17312-17315 Kill()=aiStyle34
      //  爆段（爆花+192² 盒）。旧仓烟花走 fireworkUpdate 早退路由=接触面整缺（火箭
      //  穿敌不伤不爆,时间到才原地爆）。直击写 iframes（Enemy.hurt 8t）→ 爆盒对同
      //  敌经 idStatic 臂 iframes 门拒收 ≙ 原版 1t idStatic 窗同净效（接触+爆不双
      //  结算,窗长面另见 blastDamage 注）。烟花盒 415-418 damage=0 → 本门恒闭
      //  （Damage_PVE :12576 同相,穿敌不触不发——vanilla 亦无接触死）。掷面省略
      //  登记同 Dart 直击环（crit/snapStrike 陷阱族专属,烟花非 trap 无 snap 面;
      //  crit 面随 TrapShot blast 族既有近似,不单侧开新面）。
      if (this.damage > 0) {
        for (const ent of game.enemies()) {
          if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
          if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892 同位）
          const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean;
            hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean };
          if (e.dead || !(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
          e.hurt(applyBannerDamageDealt(game, ent, this.damage),
            Math.sign(this.vx) * (TRAP_SHOT_STYLE[this.kind].kb ?? 2), 0, game, 0, false, 0, true);
          this.explodeFirework(game);   // penetrate==0 → Kill()（:17312-17315）
          return;
        }
      }
      // tileCollide=true → 撞实心块同样 Kill 爆花
      const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
      if (game.world.store.isSolid(tx, ty)) this.explodeFirework(game);
      return;
    }
    if (this.kind === 'fireworkFountain') {
      // 锚点 tile 必须仍是 338（AI_073 1457 Projectile.cs:30982-30986
      //   `tile3 == null || !tile3.active() || tile3.type != 338 → Kill`——active()
      //   位本体读 hasTile。红蓝对抗 F6：曾只查 type，幽灵残型 338 锚误判存活不 Kill）
      const T338 = TILE_BY_KEY['v_338_fireworkfountain'] ?? -1;
      const st = game.world.store;
      if (!st.inBounds(this.ax, this.ay)
        || !st.hasTile(this.ax, this.ay) || st.type[st.idx(this.ax, this.ay)] !== T338) {
        this.dead = true;
        return;
      }
      // num625 = 2 * min(1, timeLeft/60)（:29378-29383）——最后 60t 出速衰减
      const sp = 2 * Math.min(1, this.life / 60);
      // ★BJ306（2026-09-23 BJ303 姊妹崩点）：spawnBurst 必须以绑定/方法调用形态发出
      // ——detach 成局部引用后裸调用 this=undefined（ESM 严格模式），Game.spawnBurst
      // 体首句 this.acquireParticle（Game.ts:46446）抛 "Cannot read properties of
      // undefined (reading 'acquireParticle')" → 帧循环熔断。bind 保下方 burst(...)
      // 调用点逐字节不变；?. 与缺省=测试桩静默跳过（types.ts:242 可选钩子）。
      const burst = game.spawnBurst?.bind(game);
      if (!burst) return;
      if (this.form === 0) {
        // 419 黄（:30994-31018）：尘 222，±PI/4 散布，vy×2
        burst(cx, cy, FW_DUST.d222_yellow, 2, sp, -Math.PI / 2, Math.PI / 4, { yMul: 2, life: 30, damp: 0.96 });
      } else if (this.form === 1) {
        // 420 红（:31019-31049）：尘 219（每粒 1/5 → 222，此处逐帧取色近似），vx×0.5 vy×2
        burst(cx, cy, Math.random() < 0.2 ? FW_DUST.d222_yellow : FW_DUST.d219_red, 2, sp,
          -Math.PI / 2, Math.PI / 4, { xMul: 0.5, yMul: 2, life: 30, damp: 0.96 });
      } else if (this.form === 2) {
        // 421 蓝（:31050-31073）：尘 221，±PI/8 窄散布，vy×2.5
        burst(cx, cy, FW_DUST.d221_blue, 2, sp, -Math.PI / 2, Math.PI / 8, { yMul: 2.5, life: 30, damp: 0.96 });
        // timeLeft%10==0 再补 9 粒尘 222 扇面（:31074-31097：x=(i-4)/5 均布）
        if (this.life % 10 === 0) {
          burst(cx, cy, FW_DUST.d222_yellow, 9, sp * (0.85 + Math.random() * 0.2),
            -Math.PI / 2, Math.PI / 5, { yMul: 2, life: 30, damp: 0.96 });
        }
      } else {
        // 422 彩虹（:31099-31125）：尘 219 + rand(5)，±PI/4，vy×2
        burst(cx, cy, FW_RAINBOW[Math.floor(Math.random() * FW_RAINBOW.length)]!, 2, sp,
          -Math.PI / 2, Math.PI / 4, { yMul: 2, life: 30, damp: 0.96 });
      }
      return;
    }
    // ---- 马桶水花 733（AI_153_ToiletPop :53114-53152）----
    // age 1 ↔ 原版 ai[0]==0（首帧 6 尘 216 + 1 gore）；age 2..11 ↔ ai[0] 1..10（2 尘 + 1/5 gore）；
    // age 12 ↔ ai[0]=11 > 10 → Kill。尘向上（speedY -2，velX×0.5，:53139-53146）；
    // gore 580-582（:53147-53151）以 2 粒亮水珠近似
    if (this.age > 11) {
      this.dead = true;
      return;
    }
    // ★BJ306 同上（马桶水花 733 站）：bind 防 detach 裸调用 this=undefined 崩
    const burst = game.spawnBurst?.bind(game);
    if (!burst) return;
    if (this.age === 1) {
      burst(cx, cy, FW_DUST.d216_water, 6, 2, -Math.PI / 2, 0.9, { xMul: 0.5, life: 26, damp: 0.96 });
      burst(cx, cy, '#D8ECFA', 2, 2.5, -Math.PI / 2, 0.7, { life: 32, damp: 0.97 });
    } else {
      burst(cx, cy, FW_DUST.d216_water, 2, 2, -Math.PI / 2, 0.9, { xMul: 0.5, life: 26, damp: 0.96 });
      if (Math.random() < 0.2) {
        burst(cx, cy, '#D8ECFA', 2, 2.5, -Math.PI / 2, 0.7, { life: 32, damp: 0.97 });
      }
    }
  }

  /** 烟花爆花（Projectile.Kill aiStyle==34，Projectile.cs:78125-78557）：
   *  SoundID.Item14（:78131）+ 按弹种彩色尘（数量/速度档 1:1）+ 192×192 伤害盒
   *  Damage()（Kill 尾段 :78549-78556——Resize(192)+penetrate=-1+Damage() 无 damage
   *  门;★G21 登记债 [g21-fw-anchor] 勘正：旧注 ":73435-73921/:73912-73920" 系
   *  混代锚漂移 ~4700 行,R8-N3 族）。
   *  尘速档 = 原版各循环的径向速度（尘自带 0.5 系数初速并入档位）；noGravity 尘按
   *  Dust.cs:2227-2230 velocity*=0.93 / fadeIn 缓胀 → damp 0.93 + 45t 存活近似 */
  private explodeFirework(game: GameHooks): void {
    this.dead = true;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    game.playSfx('explosion', 1, cx, cy); // SoundID.Item14（:78131）
    // ★BJ306 同上（烟花爆花 explodeFirework 站；radial 闭包内消费 burst=闭包传递,
    // 必 bind）——原 detach 形态在 Kill 拍（timeLeft 45 到点/撞块）即抛 TypeError
    const burst = game.spawnBurst?.bind(game)
      ?? ((x: number, y: number, c: string, n: number, s: number) => game.spawnParticles(x, y, c, n, s));
    /** 全向径向爆花（dir=0/spread=PI 覆盖全圆；原版尘方向为随机角，整体旋转不变） */
    const radial = (color: string, count: number, speed: number,
      opts?: { xMul?: number; yMul?: number }) =>
      burst(cx, cy, color, count, speed, 0, Math.PI, { life: 45, damp: 0.93, ...opts });
    const rand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo));
    if (this.kind === 'fireworkRocket') {
      // 167-170（:78132-78350）
      if (this.form === 0) {
        // 红 167（:78132-78168）：400 尘 130，四档速度 4/8/12/16 各 100
        radial(FW_DUST.d130_red, 100, 4); radial(FW_DUST.d130_red, 100, 8);
        radial(FW_DUST.d130_red, 100, 12); radial(FW_DUST.d130_red, 100, 16);
      } else if (this.form === 1) {
        // 绿 168（:78169-78212）：400 尘 131；0-100 档 0→2 渐增（取均值 1）、
        // 101-250 档 10（150 粒）、251-399 档 13 且 x×1.25/y×0.75（149 粒）
        radial(FW_DUST.d131_green, 101, 1); radial(FW_DUST.d131_green, 150, 10);
        radial(FW_DUST.d131_green, 149, 13, { xMul: 1.25, yMul: 0.75 });
      } else if (this.form === 2) {
        // 蓝 169（:78213-78280）：双圈 Lerp 曲线（各 2×num843×20 尘 133）+ 中心 100 尘 132；
        // num843 = rand(5,9) 臂、num844 = rand(12,17) 外速、value10 = rand(3,7) 内速
        const arms = rand(5, 9), outer = rand(12, 17), inner = rand(3, 7);
        radial(FW_DUST.d133_yellow, 80 * arms, outer);
        radial(FW_DUST.d133_yellow, 80 * arms, outer / 2);
        radial(FW_DUST.d132_blue, 100, outer);
      } else {
        // 黄 170（:78281-78350）：400 尘 133/134 交替，四档 16/11/8/5 各 100，轴压 0.7 交替
        radial(FW_DUST.d133_yellow, 100, 16, { yMul: 0.7 }); radial(FW_DUST.d134_gold, 100, 11, { xMul: 0.7 });
        radial(FW_DUST.d133_yellow, 100, 8, { yMul: 0.7 }); radial(FW_DUST.d134_gold, 100, 5, { xMul: 0.7 });
      }
    } else {
      // 415-418 烟花盒（:78351-78548）
      if (this.form === 0) {
        // 红 415（:78351-78400）：30×num868 臂尘 130（速度 num870→num869 渐增，取均值）+
        // 100 尘 130 补充；num868 = rand(5,9)、num869 = rand(10,15)×0.66、num870 = rand(4,7)/2
        const arms = rand(5, 9), sp = rand(10, 15) * 0.66, sp0 = rand(4, 7) / 2;
        radial(FW_DUST.d130_red, 30 * arms, (sp0 + sp) / 2);
        radial(FW_DUST.d130_red, 100, sp);
      } else if (this.form === 1) {
        // 绿 416（:78401-78435）：num883=20 步 × num882 = rand(3,6)×2 臂螺旋尘 131，
        // 速度 1→8 渐增（取均值 4.5），奇偶臂 scale 0.9
        radial(FW_DUST.d131_green, 20 * rand(3, 6) * 2, 4.5);
      } else if (this.form === 2) {
        // 蓝 417（:78436-78491）：150 尘三段（各 50）132/133/132，
        // 外圈 num894 = max(rand(4,7),rand(4,7))（x×0.5 旋转）、中段 num893（y×0.5 旋转）、内圈 num892
        const sp2 = 4 + Math.random() * 3, sp1 = 4 + Math.random() * 3;
        radial(FW_DUST.d132_blue, 50, Math.max(sp1, sp2), { xMul: 0.5 });
        radial(FW_DUST.d133_yellow, 50, Math.min(sp1, sp2), { yMul: 0.5 });
        radial(FW_DUST.d132_blue, 50, Math.min(sp1, sp2));
      } else {
        // 黄 418（:78492-78548）：2×num899×15 臂尘 134（SmoothStep num900→num901）+
        // 120 补充尘（前 80 尘 133 慢速、后 40 尘 131 外速）
        const arms = rand(5, 12), sp = rand(9, 14) * 0.66, sp0 = rand(2, 4) * 0.66;
        radial(FW_DUST.d134_gold, 2 * arms * 15, (sp + sp0) / 2);
        radial(FW_DUST.d133_yellow, 80, sp0);
        radial(FW_DUST.d131_green, 40, sp);
      }
    }
    // 192×192 伤害盒 Damage()（Kill 尾段 :78549-78556 无 damage 门）：
    //  ★BJ704-G22（g21-fw-box-cut 清偿）：烟花盒 415-418 damage 0 亦入盒——
    //  blastDamage 头 damage<=0 早退（Damage_PVE :12576 同相,PVE no-op）但
    //  CutTiles 先行照割（:12516 序）=0 伤盒原版 192² 照割（旧调用位 damage>0
    //  门把割面一并拦死=登记债本体）。火箭 167-170 传 idStatic 键（1t 共享窗,
    //  blastDamage 注）;烟花盒 415-418 无 idStatic 行（:4944-4951）→ 0。
    this.blastDamage(game, cx, cy, 96, this.kind === 'fireworkRocket' ? this.projId : 0);
  }
}

/** ★批六 M6：811/814 Kill 共组尘（Projectile.Kill :74019-74027）——
 *  30×d5 盒内随机位 + scale=1.25+rand + velocity×2。NewDust 缺省参 alpha=0
 *  （Dust.cs:75 缺省参,非半透;曾误传 100）、无 fadeIn/noGravity/noLight 修饰。
 *  调用口：寿终（811/814 共组;814 tileCollide=false 唯一可达死亡路径）+ 撞块（唯 811） */
function killBloodShot(game: GameHooks, x: number, y: number, w: number, h: number): void {
  for (let n = 0; n < 30; n++) {
    const d = game.spawnDust?.(x, y, w, h, 5);
    if (!d) break;
    d.scale = 1.25 + Math.random();
    d.vx *= 2; d.vy *= 2;
  }
}

export class Dart extends Entity {
  w = 8; h = 4;
  vx: number;
  vy: number;
  damage: number;
  life = 600; // tick 上限(原版 timeLeft 600)
  dead = false;
  /** 原版弹型（0 = 无表项回退色块）；所有射击怪按 NPC.cs 发射点对号入座 */
  projId: number;
  /** 敌对弹（原版 Projectile.hostile；Dart 类本地玩家命中为无条件，敌我区分由发射点
   *  显式置位——Enemy.shootDart 咽喉与各直构处=true，玩家武器弹默认 false 不误伤）。
   *  联机 v5：随 msg27 bit7 下发，访客傀儡据此本地结算 */
  hostile: boolean;
  /** 弹-NPC 绑定通道（G3 批 2026-08-19）：原版 NPC 发射弹时把自身 whoAmI 作
   *  NewProjectile 末参传入 ai[1] 槽（NPC.cs :59970-59979 等），弹体 AI 按宿主
   *  id+type 回查。当前消费族：411 观星者→537 激光（Projectile.cs:30308 束原点
   *  位锁）/ 424 预言者→573 蓄能弹（:32087 蓄能期宿主死→立即对最近玩家齐射 +
   *  目标继承）。0 = 无绑定（默认，其余发射点原版就不传） */
  ownerNpcId = 0;
  /** ★BJ219 通用 oldPos 残影环（TrailingMode 表驱动;undefined=未初始化/null=无记录式）。
   *  Dart 载体活动集=573 星云弹/811 血弹/814 血鹦鹉螺弹（TrailingMode 全 0,cap 10）。
   *  ai 依赖档（811 ai0 白染预混）以 0 档承载=染侧裁决（★BJ245 勘误：ai0 写入方已证
   *  P.cs:57019-57021,k 衰减由白化 filter+光地板承载,染侧 0 档不变）。 */
  ghostRing?: ProjGhostRing | null;
  private subIsHead = false;
  /** 记录位=dartStep/oracleOrbStep 尾（位移后;原版 UpdateTrails :17198=Damage 后同序。
   *  命中杀拍 dartStep 内 dead=true 时仍记一段=原版 Damage 杀弹仍记录同相,撞块杀弹
   *  原版不记——本仓两种杀共用 dead 位,1 子步粒度偏差登记。
   *  ★BJ703-B D1 dir=1 恒值（登记①收编）:Dart 载体 mode2/3/4 全员（811/814）原版
   *  AI_001 全程无 spriteDirection 写 → oldSpriteDirection 恒 1;旧 sign(vx) 记录
   *  =左飞幽灵假镜像（811 贴图 54% 非对称）,本刀归位。 */
  recordGhostTrail(): void {
    if (this.ghostRing === undefined) {
      this.ghostRing = projTrailingMode(this.projId) >= 0 ? new ProjGhostRing(this.projId) : null;
    }
    this.ghostRing?.record(this.x, this.y, this.rot, 1, this.subIsHead);
  }
  /** 537 激光束长 Lerp 值（原版 localAI[1]，LaserScan→0.5/t Lerp） */
  private beamLen = 0;
  /** 299 暗影焰 localAI[0] 镜像（子步计数:第 6 子步爆发、>6 起尾尘,P.cs:57611-57637） */
  private ai299Local = 0;
  /** 290 暗影束 localAI 镜像（aiStyle48 :28615-28621）——L0=子步龄（锚定 delay=3,
   *  :54934-54941 case 260/290 → 3）;Ax/Ay=束段锚点（localAI[1]/[2],撞块反弹
   *  :18975-19018 与 Kill :71825-71870 铺撒消费） */
  private sb290L0 = 0;
  private sb290Ax = 0;
  private sb290Ay = 0;
  /** 291 地狱火弹 ai[0]/ai[1] 目标锚点（NewProjectile aiArgs——原版发射点
   *  NPC.cs:21294 传 Main.player[target].Center;越点引爆 :28748-28756 消费）。
   *  本仓发射位 Enemy.fireCasterVolley 直构未传参 → 缺省 0,首子步捕玩家心等价
   *  补偿（同拍 NPC AI 所读玩家位,值域等价）;显式注入位留给未来直构调用方 */
  spawnAi0 = 0;
  spawnAi1 = 0;
  /** 291 单次音门（localAI[0]==0 → Item20 :28740-28744）与锚点补偿一次性门 */
  private if291Sounded = false;
  private if291Anchor = false;
  /** ★292 生成幂等门（2026-09-02 访客缺口清偿）：本地 Kill 口（inferno291Kill）与
   *  访客镜像口（destroy）共用——任一口生成过 292 即置位，另一口/重复调用零生成。
   *  ★2026-09-03 同构族扩面：303/75（ifRocketMirrored，rocketKill 双口共用）与
   *  596（if596Mirrored，curse596Kill 双口共用）同约定 */
  private if291Mirrored = false;
  private ifRocketMirrored = false;
  private if596Mirrored = false;
  /** ★292 镜像口 game 引用：destroy() 钩由 Entity.compact 调用（无参），傀儡每拍
   *  fixedUpdate 必经此处刷新——消亡拍引用恒新鲜 */
  private lastGame: GameHooks | null = null;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, projId = 0) {
    super();
    const st = projId ? DART_STYLE[projId] : undefined;
    // ★二百九十二刀:无 DART_STYLE 项时回退 vanilla-projectiles.json 权威宽高
    //  (1457 SetDefaults 全 1130 弹;旧缺省 8×4=本仓发明。rot/life 等 AI 语义面
    //  仍以 DART_STYLE 为准——json 只有几何数据)
    const vh = projId ? projectileData(projId) : undefined;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.projId = projId;
    if (st) {
      this.w = st.w; this.h = st.h;
      this.life = st.life ?? 600;
      this.alpha = st.alpha0 ?? 0;
      this.scale = st.scale ?? 1;
      // 首拍姿态（出膛即对齐,首 update 前 draw 兜底同式）:a45=同 :26911 字面（F3）/
      // align90=同 :58733 字面 1.57（★G10/R2-F13,旧 π/2）/rightPi=同 :58640-58647
      // （★G10/R2-F6,436——direction=出生符号,首 update 起 dartStep 逐拍重评）
      this.rot = st.rot === 'align90' || st.rot === 'a45'
        ? Math.atan2(vy, vx) + (st.rot === 'a45' ? 0.785 : 1.57)
        : st.rot === 'rightPi'
          ? Math.atan2(vy, vx) + Math.PI + ((Math.sign(vx) || 1) === -1 ? Math.PI : 0)
          : 0;
      this.dir = Math.sign(vx) || 1;
      if (st.frameRand) this.frame = Math.floor(Math.random() * st.frameRand); // 909 岩石随机帧（AI_002 :21534-21540）
    } else if (vh) {
      if (vh.width !== undefined && vh.height !== undefined) { this.w = vh.width; this.h = vh.height; }
      if (vh.timeLeft !== undefined) this.life = vh.timeLeft;   // ★二百九十九:life=SetDefaults timeLeft(旧恒 600=近似)
    }
    this.hostile = false; // 默认非敌对——敌怪发射点（Enemy.shootDart 咽喉 + 直构处）显式置位
  }

  draw(r: Renderer, _cam: Camera): void {
    // 世界坐标绘制(同 TrapShot)
    const ctx = r.ctx;
    if (!ctx) return;
    // 537 观星者激光：三段束体独占绘制（Main.cs:32124-32156）
    if (this.projId === 537) { this.drawStargazerBeam(ctx); return; }
    // ★BJ530（2026-10-06,BJ529 同族普查收编第二刀）：44 恶魔镰刀 hostile 型
    //  （恶魔 62/66 NPC.cs:23533 → Enemy 射手表 proj:44 → spawnHostileProj 本载体）
    //  GetAlpha :81465-81468 `34||35||15||19||44||45 → Color.White`——A=255 恒定
    //  （SetDefaults α=100 :1277 死值不读）,RGB 恒白【不读光照色】（Main.cs:30068
    //  格光被 GetAlpha 整体替换;:31532/:31578 EntitySpriteDraw color48=Color.White
    //  标准本体绘）。本仓通用路径双病：ga=(255−α)/255≈0.61 半透（Dart 侧无
    //  Arrow.drawGlobalAlpha case 44/45 F2 豁免可消费——该案只覆盖 Arrow 载体 45）
    //  + 画进实体层被 compositeLight 全屏乘光压暗（BJ529 探针 _bj529-skull-ab
    //  暗腔实测 k=0.325 同病）→ 承接=Arrow 270/45 先例同构：capture→return,ga=1
    //  硬档（:81465 Color.White A=255 恒定——同 Arrow.drawGlobalAlpha case 44/45
    //  F2 硬档先例;vanillaProjAlpha 表不加项=300 census 锁不动）,projFullbrightQueue
    //  光照合成后主画布 source-over 复绘=原版逐字。层序=玩家/NPC 之上（270/BJ504
    //  同槽惯例）。姿态面零改：rot 已接 DART_STYLE 'spin' 0.8×dir（AI_018 :25780）、
    //  scale=0.9、单帧整图（Main.projFrames 无 44 赋值,frame 恒 0）;44 无残影记录
    //  （PROJ_TRAILING_MODE 缺员=recordGhostTrail 置 null,早退零吞面）。
    if (this.projId === 44) {
      const img44 = projSprite(44);
      if (img44 && img44.width > 0) {
        const ga44 = 1;                                   // GetAlpha :81465 Color.White A=255 恒定（硬档,F2 先例）
        const rot44 = this.rot;                           // DART_STYLE 'spin' 累积自旋
        const cx44 = this.x + this.w / 2, cy44 = this.y + this.h / 2;
        const sc44 = this.scale;
        // 单帧整图 9 参直切原图（Arrow 270/45 同式:闭包只持 img 引用+矩形数）
        const rect44 = projFrameSrcRect(44, 0);
        if (rect44) {
          (r as unknown as {
            queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
          }).queueProjFullbright?.((c) => {
            c.save();
            c.translate(cx44, cy44);
            c.rotate(rot44);
            c.imageSmoothingEnabled = false;
            c.globalAlpha = Math.max(0, Math.min(1, ga44));
            c.drawImage(img44, rect44.sx, rect44.sy, rect44.sw, rect44.sh,
              -rect44.sw * sc44 / 2, -rect44.sh * sc44 / 2,
              rect44.sw * sc44, rect44.sh * sc44);
            c.restore();
          });
        }
      }
      return;
    }
    // ★BJ666 普查刀②（2026-10-12）：257 冰雪射线（冰巨人 243 NPC.cs:59516-59525 →
    //  shootDart 本载体）GetAlpha P.cs:81294-81301 `type==257 → α>200→Transparent /
    //  else Color(255−α,255−α,255−α,0)`——A=0【纯加算白】×(255−α)/255 渐显
    //  （α 生命周期=SetDefaults 无行≡255 起、AI :56880-56887 −10/子步 恒减至 0
    //  = dartStep 已接,dart-proj-styles 判别站）——XNA 预乘 out=tex.rgb×(255−α)/255
    //  全额加算,不读格光=自发光。旧通用路径双病：ga=(255−α)/255 source-over
    //  （合成方式错）+ 实体层被 compositeLight 乘光压暗（BJ529 暗腔 k=0.325 同病）
    //  + α>200 硬隐门未建模（出生 5.5 子步原版全隐）。承接=BJ530 Dart 44 判例同构：
    //  capture→本体不进实体层,projFullbrightQueue 光照合成后主画布 'lighter' 复绘
    //  （ga=max(0,(255−α)/255),α>200→0 硬档;mock 无队列回退直绘=测试链）。
    //  姿态面零改：257 无 DART_STYLE 专档（回旋直飞），rot=方向角。表不加项
    //  =300 census 锁不动（off 注同步更新）。
    if (this.projId === 257) {
      const img257 = projSprite(257);
      if (img257 && img257.width > 0) {
        const a257 = this.alpha;
        const ga257 = a257 > 200 ? 0 : Math.max(0, Math.min(1, (255 - a257) / 255));
        const rot257 = this.rot;
        const cx257 = this.cx, cy257 = this.cy;
        const sc257 = this.scale;
        if (ga257 > 0) {
          const rect257 = projFrameSrcRect(257, 0);
          const drawInto257 = (c: CanvasRenderingContext2D) => {
            c.save();
            c.imageSmoothingEnabled = false;
            c.globalCompositeOperation = 'lighter';
            c.globalAlpha = ga257;
            c.translate(cx257, cy257);
            c.rotate(rot257);
            if (rect257) {
              c.drawImage(img257, rect257.sx, rect257.sy, rect257.sw, rect257.sh,
                -rect257.sw * sc257 / 2, -rect257.sh * sc257 / 2,
                rect257.sw * sc257, rect257.sh * sc257);
            } else {
              c.drawImage(img257, -img257.width * sc257 / 2, -img257.height * sc257 / 2,
                img257.width * sc257, img257.height * sc257);
            }
            c.restore();
          };
          (r as unknown as {
            queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
          }).queueProjFullbright?.(drawInto257);
        }
      }
      return;
    }
    // ★红魔鬼三叉戟 115（2026-10-13,用户实报「贴图反的+越来越大」定谳刀）：GetAlpha
    //  P.cs:81444-81456 专梯（114||115）——localAI[1]<5→Transparent / 5..15→灰梯
    //  (l−5)/10×255 / ≥15→(255,255,255,alpha)。★A=α 场直通（≠本仓通用 (255−α)/255,
    //  出场 α=255=不透明;Arrow 载体 BJ236 判例同式 case 116/132/156/157/173=
    //  ramp<5?0:ramp<15?(ramp−5)/10:α/255）,RGB 恒白不读光照 → 承接 BJ530 Dart 44
    //  判例：capture→实体层零绘,projFullbrightQueue 光照合成后主画布 source-over
    //  复绘（非 257 加算）。通用路径旧双病：① ga=(255−α)/255 使脉冲闪烁相位颠倒
    //  （原版=小而实/大而隐）;② 渐入 fade 已摘（dartStep 段注）——脉冲 α 有界
    //  [0,255],scale 有界 [0.98,1.16]（AI_027 :26870-26889）,负 scale 镜像/
    //  无界增大两案自此根除。傀儡不跑 dartStep（ai115L1 恒 0）→ 按 ≥15 档恒定直绘。
    //  阶梯读 ai115L1（dartStep 115 尘支同源镜像,到 15 晚原版 1 拍=既有尘站时差）。
    if (this.projId === 115) {
      const l1 = this.netPuppet ? 15 : this.ai115L1;
      const ga115 = l1 < 5 ? 0
        : l1 < 15 ? (l1 - 5) / 10
        : Math.max(0, Math.min(1, this.alpha / 255));
      if (ga115 > 0) {
        const img115 = projSprite(115);
        if (img115 && img115.width > 0) {
          const rot115 = this.rot;
          const cx115 = this.cx, cy115 = this.cy;
          const sc115 = this.scale;
          const rect115 = projFrameSrcRect(115, 0);
          (r as unknown as {
            queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
          }).queueProjFullbright?.((c) => {
            c.save();
            c.imageSmoothingEnabled = false;
            c.globalAlpha = ga115;
            c.translate(cx115, cy115);
            c.rotate(rot115);
            if (rect115) {
              c.drawImage(img115, rect115.sx, rect115.sy, rect115.sw, rect115.sh,
                -rect115.sw * sc115 / 2, -rect115.sh * sc115 / 2,
                rect115.sw * sc115, rect115.sh * sc115);
            } else {
              c.drawImage(img115, -img115.width * sc115 / 2, -img115.height * sc115 / 2,
                img115.width * sc115, img115.height * sc115);
            }
            c.restore();
          });
        }
      }
      return;
    }
    const st = this.projId ? DART_STYLE[this.projId] : undefined;
    if (!st) {
      // 无表项回退:旧色块(0 = 通用 Dart,历史遗留调用)
      ctx.fillStyle = '#C8B89A';
      ctx.fillRect(this.x, this.y, this.w, this.h);
      return;
    }
    // 299 暗影焰:贴图 1×1 官方空桩,纯尘埃视觉(AI_001 :53759 尘 181 尾)——不画本体
    if (st.noTex) return;
    // ★BJ219 残影（原版残影块先于本体绘制段）——573/811/814（ghostRing 无记录式=短路）
    //  ★G10/R2-F6：436 ghost 面 mirror 随 direction（mode0 ghost 恒吃本体当前翻转
    //  Main.cs:31334——dartStep 'rightPi' 逐拍重评 this.dir;其余 Dart 员原版零
    //  spriteDirection 写（BJ703-B D1 恒 1）不传维持现状）
    if (this.ghostRing) {
      const gimg = projSprite(this.projId);
      if (gimg && gimg.width > 0) {
        drawProjGhosts(ctx, {
          ring: this.ghostRing, id: this.projId, tex: gimg,
          frames: projFrameCount(this.projId), frame: this.frame,
          bodyW: this.w, bodyH: this.h, bodyRot: this.rot, bodyScale: this.scale,
          bodyAlpha: this.netPuppet ? 1 : Math.max(0, 1 - this.alpha / 255),
          ai0: 0, ai1: 0,
          timeLeft: this.life,
          opacity: Math.max(0, Math.min(1, 1 - this.alpha / 255)),
          vxLen: Math.hypot(this.vx, this.vy),
          spriteDirection: this.dir || 1,
          mirror: st.rot === 'rightPi' && this.dir === -1,
        });
      }
    }
    // DrawProjDirect 轨迹支绘前白化（Main.cs:30068 projectileColor=Lighting.GetColor
    //  格光色 → :30841-30856 Lerp(projectileColor,White,k)）：811 k=whiteK811(age)
    //  动态（★BJ245：Remap(ai0,0,15,1,0.3),ai0 写入方=AI_001 flag3 缺省支
    //  P.cs:57019-57021,见 DART_STYLE 811 注）/ 814 k=0.35 常数。per-type filter
    //  在此处一次算好;filter 是 ctx 级状态——置位须在本行 save/restore 界内,
    //  出界显式复位（与下方 globalAlpha=1 同款双保险）,不影响同帧其它弹与
    //  贴图未就绪短线兜底
    // ★批六 M3-b/c（596 沙漠幽焰 GetAlpha 对齐,P.cs:80903-80910）：
    //  A 通道 = 128−α/2（50% 不透明帽,α=0 → 128）+ 渐显；timeLeft<30 渐隐窗内
    //  α = 255−255·timeLeft/30（GetAlpha 内覆写——AI 侧 α 递减只在 timeLeft>30 跑,
    //  见 dartStep 596 段）；RGB(255−α) 白化按仲裁 M3-c 走 whiteLerp 通道：
    //  k=(255−α)/255 动态。M3-d 光照豁免（GetAlpha 返回值不读格光色=自发光）
    //  仅登记不修——需 post-light 通道,与 whiteLerp 残差同账。
    const is596 = this.projId === 596;
    const effAlpha = is596 && this.life < 30 ? 255 - 255 * (this.life / 30) : this.alpha;
    // ★BJ668b 件2（2026-10-13,BJ667 债④清偿）：811/814 白化改道 BJ668 两遍制算子
    //  （Main.cs:30847/:30855 DrawProjDirect 本体预 Lerp(projectileColor,White,k)
    //  ——非 GetAlpha 表族=别通道;811 k=whiteK811(age) 动态 Remap(ai0,0,15,1,0.3)、
    //  814 k=0.35 静态;A 面=缺省 GetAlpha 路径 num14=(255−α)/255 :81511-81527
    //  （811/814 无 GetAlpha 分支）不变）。旧 lerpWhiteFilter 静态滤镜=白抬升被
    //  compositeLight 乘光（BJ529 病根同族:暗场抬升归零+亮场中灰归一过亮
    //  f=1+0.992k）。两遍制：基底 brightness(1−k)×ga（乘光同相）+
    //  projFullbrightQueue 'lighter' ×k 光照后复绘 → base×light+lift ≡
    //  tex×ga×[(1−k)light+k]（vanillaProjAlpha 头注 BJ668 恒等块）。596 通道保持
    //  旧滤镜（M3-d 光照豁免/自发光=GetAlpha :80903-80910 不读格光,另账登记不动）。
    //  无队列（mock/探针）=仅基底=暗场失真上界,251/465 判例同守卫域（登记）。
    const lerpK811 = this.projId === 811 ? whiteK811(this.age)
      : (!is596 && st.whiteLerp != null) ? st.whiteLerp : null;
    const whiteFilter = lerpK811 != null ? null
      : is596 ? lerpWhiteFilter((255 - effAlpha) / 255) : null;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    // ★G10/R2-F6：436 RIGHT 族变体左飞水平镜像（canvas rotate→scale(-1,1) 合成 =
    // XNA R(θ)∘FlipHorizontally,Arrow 408 同式;θ=ang+2π≡ang 数值同相）
    if (st.rot === 'rightPi' && this.dir === -1) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    const gaDart = this.netPuppet ? 1
      : is596 ? Math.max(0, (128 - effAlpha / 2) / 255)                      // A=128−α/2
      : Math.max(0, 1 - this.alpha / 255); // 傀儡不跑 dartStep,alpha 恒初始 → 恒可见
    ctx.globalAlpha = gaDart;
    if (whiteFilter) ctx.filter = whiteFilter;
    else if (lerpK811 != null) ctx.filter = `brightness(${Math.max(0, 1 - lerpK811).toFixed(3)})`;
    let drawn = false;
    const drawBody = (c: CanvasRenderingContext2D): void => {
      if (st.hFrames) {
        // 836 蒲公英籽:横向 4 列胶片(Frame(4,1,frame),Main.cs:33247)——projFrameImg 竖切不适用
        const full = projSprite(this.projId);
        if (full && (full.width > 0) && full.width > 0) {
          const fw = full.width / st.hFrames;
          const idx = Math.min(st.hFrames - 1, this.frame);
          c.drawImage(full, Math.round(idx * fw), 0, Math.round(fw), full.height,
            -fw * this.scale / 2, -full.height * this.scale / 2, fw * this.scale, full.height * this.scale);
          drawn = true;
        }
      } else {
        const img = projFrameImg(this.projId, this.frame);
        if (img) {
          const dw = img.width * this.scale, dh = img.height * this.scale;
          c.drawImage(img, -dw / 2, -dh / 2, dw, dh);
          drawn = true;
        }
      }
    };
    drawBody(ctx);
    ctx.restore();
    ctx.globalAlpha = 1;
    if (whiteFilter || lerpK811 != null) ctx.filter = 'none';   // 出界显式复位（save/restore 本身已还原,双保险）
    // ★BJ668b 件2：lift 闭包（811/814 白抬升 ×k,几何当帧冻结;光照后 'lighter' 复绘
    //  =两遍制右半边——本体单笔,直绘闭包与录制式逐位等值）
    if (drawn && lerpK811 != null) {
      const cxL = this.cx, cyL = this.cy, rotL = this.rot, gaL = gaDart, kL = lerpK811;
      (r as unknown as {
        queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
      }).queueProjFullbright?.((c) => {
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.filter = 'none';
        c.imageSmoothingEnabled = false;
        c.translate(cxL, cyL);
        c.rotate(rotL);
        c.globalAlpha = Math.max(0, Math.min(1, gaL * kL));
        drawBody(c);
        c.restore();
      });
    }
    if (drawn) return;
    // ★P0-B（2026-09-27）贴图未就绪帧不画（旧「短线兜底(方向与弹速一致)」已摘）:
    //  路径 op 在 acc 态=每弹每帧 rasterizePathOp 隔离栅格化+整幅上传（Arrow.draw
    //  同案同判）;懒加载 1-2 帧到位自愈,原版加载期亦短暂隐形。
  }

  /** 537 束体三段绘制（Main.cs:32124-32156）：炮口行(0,0,w,22) origin=行中心 →
   *  束身行(0,25,w,28) 沿束向 28px 段平铺（尾段截余量）→ 端帽行(0,56,w,22)
   *  origin=(0,0)。宽乘 num293 = Remap(bright,0,1,0.25,1.5)，bright =
   *  Remap(age,20,30,0,1)×Remap(age,60,90,1,0)（20t 起亮/30t 满宽/60t 收/90t 灭，
   *  AI 侧 90t Kill 兜底）；颜色 Color(255,255,255,0)×0.9 = XNA 预乘加性白 →
   *  canvas lighter 近似（MLDeathray 455 同款）。束长预算 = len−33·scale */
  private drawStargazerBeam(ctx: CanvasRenderingContext2D): void {
    const remap = (v: number, a: number, b: number, c: number, d: number) =>
      c + (d - c) * Math.min(1, Math.max(0, (v - a) / (b - a)));
    const bright = remap(this.age, 20, 30, 0, 1) * remap(this.age, 60, 90, 1, 0);
    const wid = remap(bright, 0, 1, 0.25, 1.5);
    if (bright <= 0.001 || this.beamLen <= 1) return;
    const img = projSprite(537);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.9;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    if (!img || img.width === 0) {
      // 贴图未就绪兜底（懒加载首帧）：自绘白束，加载完成后自愈
      ctx.globalAlpha = Math.min(1, bright) * 0.9;
      const thick = Math.max(2, 22 * this.scale);
      ctx.fillStyle = '#C8F4FF';
      ctx.fillRect(-thick / 2, 0, thick, this.beamLen);
      ctx.restore();
      return;
    }
    const tw = img.width;
    // 炮口（:32140 origin = 行中心 (w/2,11)）
    ctx.drawImage(img, 0, 0, tw, 22, (-tw / 2) * wid, -11 * wid, tw * wid, 22 * wid);
    // 束身（:32143-32155）：起点 Center+dir·wid·10.5，预算 len−33·scale，逐段 28·wid
    let budget = this.beamLen - 33 * this.scale;
    let y = 10.5 * wid;
    let adv = 0;
    while (adv + 1 < budget) {
      let hh = 28;
      if (budget - adv < hh) hh = budget - adv;
      ctx.drawImage(img, 0, 25, tw, hh, (-tw / 2) * wid, y, tw * wid, hh * wid);
      adv += hh * wid;
      y += hh * wid;
    }
    // 端帽（:32156 origin=(0,0)）
    ctx.drawImage(img, 0, 56, tw, 22, 0, y, tw * wid, 22 * wid);
    ctx.restore();
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    this.lastGame = game;   // ★292 镜像口：destroy 钩无 game 参,每拍刷新（傀儡必经本函数）
    // 联机傀儡（远端弹幕快照驱动）：对敌判定归拥有者客户端；对玩家（hostile）由访客本地结算 Damage_EVP（netPuppetProjContact）
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // G3 宿主绑定弹：537 观星者激光（aiStyle84）/ 573 预言者蓄能弹（aiStyle102）
    // ——专用步进（AI/寿命/命中面全独立：束线段判定 / 蓄能-齐射态机），不走通用 dartStep
    if (this.projId === 537) { this.stargazerBeamStep(game); return; }
    if (this.projId === 573) { this.oracleOrbStep(game); if (!this.dead) this.recordGhostTrail(); return; }
    const st = this.projId ? DART_STYLE[this.projId] : undefined;
    if (--this.life <= 0) {
      if (st?.rocket) this.rocketKill(game);
      else if (this.projId === 596) this.curse596Kill(game);   // ★批四 T1：Kill 爆（P.cs:73762-73794）
      else if (this.projId === 290) this.killBeam290(game);    // aiStyle48 Kill 铺撒收尾（:71825-71870）
      else if (this.projId === 291) this.inferno291Kill(game); // Kill=原位 spawn 292（:75802-75807）
      else if (this.projId === 811 || this.projId === 814) {
        // ★批六 M6：811/814 Kill 共组尘收口 killBloodShot（Projectile.Kill :74019-74027）
        // ——寿终口；814 tileCollide=false 无撞块口,唯一可达死亡路径自此有尘
        killBloodShot(game, this.x, this.y, this.w, this.h);
        this.dead = true;
      }
      else {
        // ★FX53（2026-09-16）：寿终 Kill 亦走 Kill()（:17307-17311 timeLeft<=0 → Kill）
        // ——射手箭族尘站（killShooterDust,2/82→:77165、1/81/98/980/1073→:75447、
        // 507/508→:75392）自此三死亡口全覆盖（寿终/撞块/命中）
        this.killShooterDust(game);
        this.dead = true;
      }
      return;
    }
    // ★二百九十九:PhantasmalSphere 454 attach(aiStyle83 :31874-31912)——
    //  ai[0]<30 支:position=宿主 Center−velocity(通用积分 +v 后净=宿主中心);
    //  此后 velocity ×0.96/t 衰减。ownerNpcId=NewProjectile 末参(宿主 whoAmI);
    //  无宿主=直飞(旧路径)。
    if (this.projId === 454 && this.ownerNpcId) {
      this.age++;
      if (this.age < 30) {
        const owner = (game.enemies() as Array<{ id?: number; dead?: boolean; cx: number; cy: number }>).find((o) => o.id === this.ownerNpcId && !o.dead);
        if (owner) { this.x = owner.cx - this.w / 2; this.y = owner.cy - this.h / 2; }
      } else { this.vx *= 0.96; this.vy *= 0.96; }
    }
    if (!st) { this.legacyStep(game); return; }
    // 首更新发射音（AI_001 各型 ai[1]==0 分支:81/82→Item5 :52468 / 180→Item11 :52473 /
    // 84/257→Item12 :52408/:52418 / 572→Item17 :53410 / 44→Item8 :23723 / 115→Item8 :24835）;
    // 96 诅咒焰 Item20 :22543 / 288 金雨 Item17 :22820 / 128/177 霜爆 Item28 :24991
    if (this.age === 0 && st.sfx) game.playSfxFiles(st.sfx, st.sfxVol ?? 0.8, this.cx, this.cy);
    // extraUpdates:原版每 tick 跑 1+extraUpdates 次完整 AI+位移(302 狙击 ×8 = 弹速 4→32px/t 的来源)
    const sub = 1 + (st.updates ?? 0);
    for (let i = 0; i < sub && !this.dead; i++) {
      this.subIsHead = i === 0;
      this.dartStep(game, st);
      this.recordGhostTrail();
    }
  }

  /** 单次原版更新（AI 重力/旋转/alpha/拖尾 + 位移 + 命中） */
  private dartStep(game: GameHooks, st: DartStyle): void {
    this.age++;
    this.tick++;
    // oldVelocity 快照（原版 Update :17118 `oldVelocity = velocity` 在 AI 前——115
    // 三叉戟尘站的尘速消费位。★尘站普查批 2026-09-16）
    this.ovx = this.vx; this.ovy = this.vy;
    // AI_016_Bombs 摩擦门读数：原版在同一 AI 拍里「先判 velocity.Y==0(:48387) 再
    // vy+=0.2(:48412)」——门读的是上拍碰撞后的静止态，本仓重力在上游通用段先加,
    // 故在此快照（spiky 支摩擦在其加重力之前,天然同序无需快照）
    const prevVyZero = this.vy === 0;
    // ---- 重力/加速（AI_001 分型重力门 & AI_018/AI_027 加速段）----
    if (st.accel && this.age >= st.accel.from && this.age < st.accel.to) {
      this.vx *= st.accel.mul; this.vy *= st.accel.mul;
    }
    if (st.grav !== undefined && this.age > (st.gravDelay ?? 0)) {
      this.vy = Math.min(this.vy + st.grav, st.vCap ?? 16); // AI_001/AI_002 钳 16；31 沙球钳 10（:55159）
      if (st.xDamp) this.vx *= st.xDamp;
      if (st.xFrict) {            // 31 沙球侧摩（:55087-55100）：±N 向 0 收
        if (this.vx < -st.xFrict) this.vx += st.xFrict;
        else if (this.vx > st.xFrict) this.vx -= st.xFrict;
        else this.vx = 0;
      }
    }
    // ---- AI_027 块尾垂直钳（Projectile.cs:26913-26915,★F2 清偿 2026-10-14）：
    //      velocity.Y>16→16——aiStyle27 全型【每更新无条件】适用,不挂重力/accel 门
    //      （与 :26770-26777 ×1.125 加速段平行独立）。vCap 既有消费面=重力门内
    //      (:1588)/boulderStep(挂 gravDelay 门),均不适配无重力项 → 非 grav 表项
    //      在此补表驱动钳（现役唯一消费者=115 三叉戟:0.2×1.125^29≈6.1 恒不及 16,
    //      钳为对拍面完整性/外源高 vy 出膛一致性而设）----
    if (st.vCap !== undefined && st.grav === undefined && this.vy > st.vCap) {
      this.vy = st.vCap;
    }
    // ---- 旋转（各 aiStyle 权威语义,见 DART_STYLE 头注）----
    switch (st.rot) {
      // 1.57=原版字面 1.57f（AI_001 通用尾 :58733,★G10/R2-F13 字面纪律——非 π/2
      // ≈1.5708,残差 0.0008rad;旧注 :54868 系陈号已重锚）
      case 'align90': this.rot = Math.atan2(this.vy, this.vx) + 1.57; break;
      // 0.785=原版字面 0.785f（:26911,★F3 清偿 2026-10-14——非 π/4≈0.785398,残差
      // 0.0004rad 视觉无感但字面 1:1 纪律;旧注 :24839 系 1456 世代残号已重锚）
      case 'a45': this.rot = Math.atan2(this.vy, this.vx) + 0.785; break;
      case 'roll': this.rot += (Math.abs(this.vx) + Math.abs(this.vy)) * 0.03 * this.dir; break;
      case 'spin': this.rot += st.spinRate! * this.dir; break;
      case 'tilt': this.rot = this.vx * 0.125; break;          // 836 蒲公英籽 :43312
      case 'vxSpin': this.rot += this.vx * 0.1; break;         // aiStyle16 炸弹族 :48444
      // ★G10/R2-F6：436 火星弹 RIGHT 族变体（AI_001 尾分派 :58640-58647 +
      // 专属块 :55107-55119 spriteDirection=direction）——direction 逐拍重评
      // （vx<0?-1:1,AutomaticallyChangesDirection :17122-17130,aiStyle1 在管）,
      // rot=ToRotation()+π+(direction==−1?π:0);draw/ghost 消费 this.dir 镜像。
      // 注:'roll'/'spin'/'nail' 的 this.dir=出生符号不复评语义不变（各型原文如此）。
      case 'rightPi': {
        this.dir = this.vx < 0 ? -1 : 1;
        this.rot = Math.atan2(this.vy, this.vx) + Math.PI + (this.dir === -1 ? Math.PI : 0);
        break;
      }
      case 'nail':
        // 498 铁钉（P.cs:58485-58492）：ai[0]<50 恒对齐速度方向（else 支 atan2+1.57）；
        // ≥50 与摩擦/重力【同一分支】改自旋 rotation += direction*0.5——翻转点复用
        // gravDelay 表值(49)即与重力门同拍；direction=出生速度符号（原版 NewProjectile
        // 语义，本仓 ctor 处 Math.sign(vx) 同式，飞行中不复评）
        if (this.age > (st.gravDelay ?? 0)) this.rot += this.dir * (st.spinRate ?? 0.5);
        else this.rot = Math.atan2(this.vy, this.vx) + 1.57;
        break;
      case 'none': this.rot = 0; break;
    }
    // ---- 44 魔鬼飞镰尾迹（AI_018 尾尘链，Projectile.cs:25793-25797）：每 update
    //      2× NewDust(盒=弹体 position+w×h=48×48 全盒,尘 27,速(0,0),alpha100) +
    //      逐尘 noGravity=true——尘散布在盒内缩 4px 的 [x+4,x+w-1] 区(Dust.cs:169-170
    //      position.X+rand(w-4)+4),即绕弹心 ±20px 铺满弹盒。★对齐根因：本弹贴图
    //      (Projectile_44.png 48×48)弯月内容只占上半 y0-27(质心≈(23.5,10.6)),本体
    //      绕弹心自旋(DrawProjDirect 贴图帧心=proj.Center)——尾迹必须铺满弹盒才能与
    //      扫掠环重叠;旧通用 trail 是 spawnParticles 单点 cx/cy(旋转中心)恒落在
    //      镰口空腔里=2026-09-02 用户报"尾迹恒偏出弹体"。44 无 extraUpdates →
    //      dartStep 每 tick 一次 = 原版每 update 一跑,2 尘/tick 同频次 ----
    if (this.projId === 44) {
      for (let i = 0; i < 2; i++) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 27, 0, 0, 100, null, 1, true);
      }
    }
    // ---- ★FX53 同族清偿（2026-09-16）：NPC 射手弹 AI 尾尘站 1:1——DART_STYLE 表内
    //      55/96/128/177/288/572 六型旧以泛色 spawnParticles((tick&1) 半频、单点、
    //      任意色)近似,与原版「同 id 同 dust 同频」不符;44/31/293/299 先例同式退役
    //      泛色 trail、改真尘站。全部为 AI 段内每 update 一跑（原版 AI 在位移前 →
    //      尘用 pre-move 盒,本块在位移行之前同位）;EU=0 型每 tick 1 跑 ----
    //  · 55 黄蜂毒刺（AI_001 :56456-56460）：1×d18,速(0,0),α0,scale0.9,noGravity
    if (this.projId === 55) {
      game.spawnDust?.(this.x, this.y, this.w, this.h, 18, 0, 0, 0, null, 0.9, true);
    }
    //  · 96 诅咒焰（aiStyle8 :24588-24593）：1×d75,盒=position+v（pre-move+弹速偏移）,
    //    速=弹速,α100,scale=3×弹 scale(SetDefaults 1.3→3.9),noGravity
    if (this.projId === 96) {
      game.spawnDust?.(this.x + this.vx, this.y + this.vy, this.w, this.h, 75,
        this.vx, this.vy, 100, null, 3 * this.scale, true);
    }
    //  · 572 蝾螈吐息（AI_001 :57254-57271）：2×d40,速=弹速,α100;vel=vel×0.5+弹速
    //    再 ×0.5（原文 ×0.5/+=v/×0.5 三连）;scale1.2,noGravity,位=(Center+position)/2
    //    （首拍 Item17 由表 sfx 承载,原文本站 localAI[0]==0 支,发射位等价）
    if (this.projId === 572) {
      for (let i = 0; i < 2; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 40, this.vx, this.vy, 100);
        if (d) {
          d.vx = d.vx * 0.5 + this.vx; d.vy = d.vy * 0.5 + this.vy;
          d.vx *= 0.5; d.vy *= 0.5;
          d.noGravity = true;
          d.scale = 1.2;
          d.x = (this.cx + this.x) / 2; d.y = (this.cy + this.y) / 2;
        }
      }
    }
    //  · 128 霜爆（aiStyle28 :26983-26992）：3×d92,速=弹速,α50,scale1.2,noGravity,vel×0.3
    if (this.projId === 128) {
      for (let i = 0; i < 3; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 92, this.vx, this.vy, 50, null, 1.2, true);
        if (d) { d.vx *= 0.3; d.vy *= 0.3; }
      }
    }
    //  · 177 冰水吐涎（aiStyle28 :26966-26977）：3×d137,速=弹速,α=rand(0,101),
    //    scale=1+rand(-20,40)×0.01,noGravity,vel×0.3
    if (this.projId === 177) {
      for (let i = 0; i < 3; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 137, this.vx, this.vy,
          Math.floor(Math.random() * 101), null,
          1 + (Math.floor(Math.random() * 60) - 20) * 0.01, true);
        if (d) { d.vx *= 0.3; d.vy *= 0.3; }
      }
    }
    //  · 288 金雨（aiStyle12 :24788-24829）：★ai[0]=4 每 update 强制赋值(:24795-24798)
    //    → ai[0]>3 恒真,尘站【每 update】一跑（else 支 ai[0]++ 仅 280 可达=288 死码）;
    //    3×d170,盒=(x+14,y+14,w-28,h-28)(num93=14),速(0,0),α100,noGravity,
    //    vel=vel×0.1+弹速×0.5,位 −= 弹速/3×k(k=0,1,2);另 1/8 掷 +1×d170
    //    (盒 num95=16 → +16/−32,scale0.5,vel×0.25+弹速×0.5,无 noGravity)
    if (this.projId === 288) {
      for (let k = 0; k < 3; k++) {
        const d = game.spawnDust?.(this.x + 14, this.y + 14, this.w - 28, this.h - 28, 170, 0, 0, 100, null, 1, true);
        if (d) {
          d.vx = d.vx * 0.1 + this.vx * 0.5;
          d.vy = d.vy * 0.1 + this.vy * 0.5;
          d.x -= (this.vx / 3) * k;
          d.y -= (this.vy / 3) * k;
        }
      }
      if (Math.random() < 0.125) {
        const d8 = game.spawnDust?.(this.x + 16, this.y + 16, this.w - 32, this.h - 32, 170, 0, 0, 100, null, 0.5);
        if (d8) {
          d8.vx = d8.vx * 0.25 + this.vx * 0.5;
          d8.vy = d8.vy * 0.25 + this.vy * 0.5;
        }
      }
    }
    //  · 577 星旋激光喷口爆发（AI_001 :56334-56348,首 update 一次）：5×d229,
    //    盒 8×8@Center、位=Center、α100、scale=1+rand×0.5、noGravity;k=0 尘速=
    //    norm(弹速)×(12+8×rand),k>0 = norm(弹速)×(12×rand)+圆周(±1)×3
    if (this.projId === 577 && this.age === 1) {
      const sp577 = Math.hypot(this.vx, this.vy) || 1;
      for (let k = 0; k < 5; k++) {
        const d = game.spawnDust?.(this.cx, this.cy, 8, 8, 229, 0, 0, 100, null, 1 + Math.random() * 0.5, true);
        if (!d) break;
        const jit = k !== 0 ? 3 : 0;
        const spd = k === 0 ? 12 + 8 * Math.random() : 12 * Math.random();
        const a577 = Math.random() * Math.PI * 2;        // NextVector2Circular(1,1) 角度式(811 先例)
        d.vx = (this.vx / sp577) * spd + Math.cos(a577) * jit;
        d.vy = (this.vy / sp577) * spd + Math.sin(a577) * jit;
        d.x = this.cx; d.y = this.cy;   // NewDust 后 position=Center 整覆写(:56347;811 同式)
      }
    }
    // ---- ★NPC 弹幕尘站普查批②（2026-09-16,docs/npc-proj-dust-census.md §4 HIGH/MED）：
    //      本组六支全为 AI 段内每 update 一跑（EU=0 型每 tick 1 跑）,原版 AI 在位移前
    //      → 尘盒用 pre-move 位;alpha==0 门型的渐入由通用 fade 块（st.fade=50）承载,
    //      本块在 fade 之前=门读「本拍 fade 前」值,与原文块序（先尘掷后 α−50）同相 ----
    //  · 472 诅咒颅（AI_001 :55078-55097）：每 update 1×d30（noGravity,vel×0.25 后
    //    += 弹速×0.75）+ 首拍（localAI[0]==0）Item17 音 + 20×d30（noGravity,vel×0.25
    //    += 弹速【全额】,vel.X/Y 再 ×(1+rand(−0.5..0.5))）——首拍音由表 sfx 承载
    if (this.projId === 472) {
      const d472 = game.spawnDust?.(this.x, this.y, this.w, this.h, 30);
      if (d472) {
        d472.noGravity = true;
        d472.vx = d472.vx * 0.25 + this.vx * 0.75;
        d472.vy = d472.vy * 0.25 + this.vy * 0.75;
      }
      if (this.age === 1) {
        for (let i = 0; i < 20; i++) {
          const db = game.spawnDust?.(this.x, this.y, this.w, this.h, 30);
          if (!db) break;
          db.noGravity = true;
          db.vx = db.vx * 0.25 + this.vx;
          db.vy = db.vy * 0.25 + this.vy;
          db.vx *= 1 + (Math.floor(Math.random() * 101) - 50) * 0.01;   // Next(-50,51)×0.01
          db.vy *= 1 + (Math.floor(Math.random() * 101) - 50) * 0.01;
        }
      }
    }
    //  · 174 冰刺（AI_001 :55998-56009,α==0 门）：1×d76 盒=oldPos−弹速×3,α50,
    //    noGravity+noLight,vel×0.5——oldPos=pre-move 位（本块在位移行前=同位）
    if (this.projId === 174 && this.alpha === 0) {
      const d174 = game.spawnDust?.(this.x - this.vx * 3, this.y - this.vy * 3, this.w, this.h,
        76, 0, 0, 50);
      if (d174) { d174.noGravity = true; d174.noLight = true; d174.vx *= 0.5; d174.vy *= 0.5; }
    }
    //  · 605 史莱姆刺（AI_001 :56013-56045,α==0 门+1/3 掷）：1×d4（史莱姆胶尘,
    //    色(78,136,255,150),scale1.2,盒=position+弹速（num72=0 不加宽）,α50）,
    //    vel×0.3 后 += 弹速×0.3,noGravity——920/921 明文排除同门(:56025),无此站
    if (this.projId === 605 && this.alpha === 0 && Math.floor(Math.random() * 3) === 0) {
      const d605 = game.spawnDust?.(this.x + this.vx, this.y + this.vy, this.w, this.h,
        4, 0, 0, 50, { r: 78, g: 136, b: 255, a: 150 }, 1.2);
      if (d605) {
        d605.vx = d605.vx * 0.3 + this.vx * 0.3;
        d605.vy = d605.vy * 0.3 + this.vy * 0.3;
        d605.noGravity = true;
      }
    }
    //  · 176 丛林刺（AI_001 :56075-56087,α==0 门）：1×d22 盒=oldPos,α100,scale0.5,
    //    noGravity+noLight,vel×0.15,fadeIn 0.8
    if (this.projId === 176 && this.alpha === 0) {
      const d176 = game.spawnDust?.(this.x, this.y, this.w, this.h, 22, 0, 0, 100, null, 0.5);
      if (d176) {
        d176.noGravity = true; d176.noLight = true;
        d176.vx *= 0.15; d176.vy *= 0.15; d176.fadeIn = 0.8;
      }
    }
    //  · 581 破甲刺（AI_001 :57288-57302,首拍 Item17 由表 sfx 承载）：每 update
    //    2×SelRandom(229,161,161)（1/3 d229 / 2/3 d161）,尘速=v×0.25+弹速×0.5,
    //    noGravity+noLight,scale1.2,位=Center 整覆写
    if (this.projId === 581) {
      for (let i = 0; i < 2; i++) {
        const dt581 = Math.random() < 1 / 3 ? 229 : 161;   // SelectRandom(229,161,161)
        const d581 = game.spawnDust?.(this.x, this.y, this.w, this.h, dt581,
          this.vx, this.vy, 100);
        if (d581) {
          d581.vx = d581.vx / 4 + this.vx / 2;
          d581.vy = d581.vy / 4 + this.vy / 2;
          d581.noGravity = true; d581.noLight = true;
          d581.scale = 1.2;
          d581.x = this.cx; d581.y = this.cy;
        }
      }
    }
    //  · 836 蒲公英籽首拍尘（aiStyle112 :34744-34752,localAI[0]==0 一次）：3×d31
    //    （White,scale1.2,α50,vel×0.3,noGravity）——帧动画已由表 animEvery 承载
    if (this.projId === 836 && this.age === 1) {
      for (let i = 0; i < 3; i++) {
        const d836 = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 50,
          { r: 255, g: 255, b: 255, a: 255 }, 1.2);
        if (d836) { d836.vx *= 0.3; d836.vy *= 0.3; d836.noGravity = true; }
      }
    }
    //  · 115 三叉戟（AI_027 :26814-26860）——oldVelocity=本拍 AI 改速前快照（ovx/ovy,
    //    dartStep 头快照）：首拍（localAI[1]<5 → 置 5）沿弹道反向撒 20×d27
    //    （num217=5..24,位=position−弹速×(30/num217)×80,速=oldVel,α100,scale0.9,
    //    vel×0.25 后 −= 弹速×5）;localAI[1] 计满 15（首拍置 5 → 第 13 update 起）
    //    每 update 1×d27（盒=position+(0,4) 8×8,速=oldVel,α100,scale0.6,vel×−0.25）
    if (this.projId === 115) {
      if (this.ai115L1 < 5) {
        this.ai115L1 = 5;
        for (let k = 5; k < 25; k++) {
          const bx = this.x - this.vx * (30 / k) * 80;
          const by = this.y - this.vy * (30 / k) * 80;
          const d = game.spawnDust?.(bx, by, 8, 8, 27, this.ovx, this.ovy, 100, null, 0.9);
          if (!d) break;
          d.vx = d.vx * 0.25 - this.vx * 5;
          d.vy = d.vy * 0.25 - this.vy * 5;
        }
      } else if (this.ai115L1 < 15) {
        this.ai115L1++;
      } else {
        const d = game.spawnDust?.(this.x, this.y + 4, 8, 8, 27, this.ovx, this.ovy, 100, null, 0.6);
        if (d) { d.vx *= -0.25; d.vy *= -0.25; }
      }
    }
    //  · 129 符文爆弹（aiStyle28 :27009-27019,每 update）——泛色 trail 已退役：
    //    6×d106（速=弹速,α100）→ noGravity、vel×(0.1+Next(4)×0.1)、
    //    scale×(1+Next(5)×0.1)
    if (this.projId === 129) {
      for (let i = 0; i < 6; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 106,
          this.vx, this.vy, 100);
        if (!d) break;
        d.noGravity = true;
        d.vx *= 0.1 + Math.floor(Math.random() * 4) * 0.1;
        d.vy *= 0.1 + Math.floor(Math.random() * 4) * 0.1;
        d.scale *= 1 + Math.floor(Math.random() * 5) * 0.1;
      }
    }
    // ---- 290 暗影束 AI 段（aiStyle48 :28608-28646,每子步;EU=100 → ×101/拍）----
    //  InWorld 内缘 5 格门外 Kill（:28610-28614,WorldGen.InWorld :9642-9649）;
    //  delay=3 锚点（localAI[0]==3 先存 Center 再 ++,:28615-28621+:54934-54941）;
    //  alpha=255 每子步写（:28630-28632 本体恒隐,可视面=束段尘）;首子步 Item8
    //  （localAI[0]++ 后 ==1 即第一跑,:28633-28636）。束铺撒在撞块反弹/Kill 两口
    if (this.projId === 290) {
      const st290 = game.world.store;
      const tx290 = Math.floor(this.cx / TILE), ty290 = Math.floor(this.cy / TILE);
      if (tx290 < 5 || tx290 >= st290.w - 5 || ty290 < 5 || ty290 >= st290.h - 5) {
        this.killBeam290(game);
        return;
      }
      this.sb290L0++;
      if (this.sb290L0 - 1 === 3) { this.sb290Ax = this.cx; this.sb290Ay = this.cy; }
      this.alpha = 255;
      if (this.sb290L0 === 1) game.playSfxFiles?.(['Item_8'], 1, this.cx, this.cy);
    }
    // ---- 291 地狱火弹 AI 段（aiStyle50 291 支 :28738-28767,每拍;无 extraUpdates）----
    //  Item20 单次;目标锚点越点即爆（Dot(target−Center,velocity)<=0 → velocity=Zero
    //  → Kill）;10×d174 尾迹/拍（noGravity,scale1.2,尘速×0.5+弹速×0.1）
    if (this.projId === 291) {
      if (!this.if291Sounded) {
        this.if291Sounded = true;
        game.playSfxFiles?.(['Item_20'], 1, this.cx, this.cy);
      }
      if (!this.if291Anchor) {
        this.if291Anchor = true;
        if (this.spawnAi0 === 0 && this.spawnAi1 === 0) {
          const p291 = game.player;                        // 发射侧未传 ai 参 → 玩家心补偿
          if (p291) { this.spawnAi0 = p291.cx; this.spawnAi1 = p291.cy; }
        }
      }
      if (this.spawnAi0 !== 0 || this.spawnAi1 !== 0) {
        const ddx = this.spawnAi0 - this.cx, ddy = this.spawnAi1 - this.cy;
        if (ddx * this.vx + ddy * this.vy <= 0) {          // Dot<=0 越点（:28748-28756）
          this.vx = 0; this.vy = 0;
          this.inferno291Kill(game);                        // Kill → 292（:75802-75807）
        }
      }
      for (let i = 0; i < 10; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 174, 0, 0, 100, null, 1.2, true);
        if (d) { d.vx *= 0.5; d.vy *= 0.5; d.vx += this.vx * 0.1; d.vy += this.vy * 0.1; }
      }
      if (this.dead) return;                               // 引爆拍尘已结,跳过位移/后续面
    }
    // ---- alpha 渐入（alpha=255 SetDefaults 族;速率:'speed'=|v|*0.9 [:52782 302 族]/恒减）----
    //  596 自管（aiStyle107 :34208-34219 带 timeLeft>30 门+实心盒钳 128,见 596 段）;
    //  290/291 恒隐不衰（alpha=255 原版无渐入——AI 48 每子步写 255/291 支无 alpha 行,
    //  见上两段）;fadeDelay=前 N 拍免衰（577/576 localAI[1]>2 门,P.cs:56603-56613,批六 m1）
    //  115 同此列（★红魔鬼三叉戟实报定谳 2026-10-13）：原版 α 唯一写面=AI_027 呼吸
    //  脉冲（P.cs:26849-26891）,无通用渐入;fade 每拍 −50 会让脉冲 phase0 的 α+30 永远
    //  追不上 250 翻相门 → pulseDir 钉死 0 → scale −0.02/t 无界缩 → 过零负 scale
    //  =drawImage 负宽高镜像+|scale| 无界涨（用户两案根因,见 pulse 段注）
    //  581 同此列（★F4 清偿 2026-10-14）：原版 α 零写面——SetDefaults alpha=255
    //  恒定（P.cs:6308-6316）,通用 fade switch :56590-56615 无 581,缺省 GetAlpha 尾
    //  :81507-81520（A=newColor.A−α）→ α255 恒 A=0=【本体永隐】,可视面唯一=AI 尘站
    //  :57289-57306+Kill 尘 :73991-74004（本仓 dartStep 581 支同式）;旧通用缺省
    //  fade −50/t ≈5 拍渐显=凭空造出原版没有的本体（R4 普查受害面全表仅 581）
    if (this.alpha > 0 && this.projId !== 596 && this.projId !== 290 && this.projId !== 291
      && this.projId !== 115 && this.projId !== 581 && this.age > (st.fadeDelay ?? 0)) {
      this.alpha -= st.fade === 'speed'
        ? Math.hypot(this.vx, this.vy) * 0.9
        : (typeof st.fade === 'number' ? st.fade : 50);
      if (this.alpha < 0) this.alpha = 0;
    }
    // ---- 115 三叉戟呼吸脉冲（AI_027 P.cs:26849-26891）——门=localAI[1]≥15（:26849
    //  if(<15)++ else{脉动},与 115 尘站 else 同源;本仓镜像=ai115L1,早 1 拍 set-5 无 ++,
    //  到 15 晚原版 1 拍=既有尘站时差,不另动）;phase0 scale−0.02/α+30(≥250→钉 255 翻相
    //  :26870-26879)/phase1 scale+0.02/α−30(≤0 钉 0 翻相 :26880-26889)——α 255 出场
    //  （SetDefaults :2047,GetAlpha :81448 A 直通=不透明）→ 首脉冲拍即翻相 1,有界
    //  [0.98,1.16] 往复。★pulse 旗唯一消费型=115,新 pulse 型须自带 localAI 镜像;
    //  α 唯一写面=本段+翻相钉值（通用渐入已摘,见上段注）----
    if (st.pulse && this.ai115L1 >= 15) {
      if (this.pulseDir === 0) {
        this.scale -= 0.02; this.alpha = Math.min(255, this.alpha + 30);
        if (this.alpha >= 250) this.pulseDir = 1;
      } else {
        this.scale += 0.02; this.alpha = Math.max(0, this.alpha - 30);
        if (this.alpha <= 0) this.pulseDir = 0;
      }
    }
    // ---- 288 金雨 scale 递减（AI_012 :22824 scale-=0.002,归零即 Kill）----
    if (st.shrink) {
      this.scale -= st.shrink;
      if (this.scale <= 0) { this.dead = true; return; }
    }
    // ---- 836 蒲公英籽帧动画（:43281 每 6 更新步进 4 帧循环）----
    if (st.animEvery && this.age % st.animEvery === 0) this.frame = (this.frame + 1) % (st.frames ?? st.frameRand ?? 4);
    // ---- 836 蒲公英籽风力转向（:43283-43310:顺风加速漂向玩家,逆风弱漂;离玩家/玩家死 → 缓落）----
    if (st.windSeed) {
      const p = game.player;
      const wind = game.world.weather?.windSpeedCurrent ?? 0;
      const dir = p.cx > this.cx ? 1 : -1;
      const cross = (wind > 0 ? 1 : -1) !== dir;   // flag54 = 风向与玩家方位相反
      const cx = cross ? 1.5 : 2.5, cy = cross ? 1 : 2;
      if (!p.dead && Math.hypot(p.cx - this.cx, p.cy - this.cy) < 800) {
        if (!cross) {
          this.vx += 0.05 * dir * (0.6 + Math.abs(wind));
          if (this.vx > cx) this.vx -= 0.1;
          if (this.vx < -cx) this.vx += 0.1;
        }
        if (p.y <= this.cy || cross) {
          this.vy += 0.05;
          if (this.vy > cx) this.vy -= 0.1;
        } else {
          this.vy -= 0.1;
          if (this.vy < -cy) this.vy += 0.2;
        }
      } else {
        this.vy += 0.2;
        this.vy = Math.max(-cy, Math.min(cy, this.vy));
      }
    }
    // ---- 位移 ----
    // 上一帧中心格（31 沙球落档放置格用,见撞块段注释）
    const prevTx = Math.floor(this.cx / TILE);
    const prevTy = Math.floor(this.cy / TILE);
    // 293 追踪（AI_051 :AI_051 200px 曼哈顿内:target=norm(玩家-心)×3,vel=(vel*100+target)/101）
    //  ★R5(T5,2026-09-02)：消费式 (vel*lerp+target)/(lerp+1) 中 lerp=乘子（除数−1）——
    //  293 表值已改 100（原版除数 101）；596 表值 9（原版除数 10）同口径,勿再存除数本尊。
    //  ★批六 M2：596 的 homing 已挪进 596 AI 段 1/27 受理分支（AI_107 尘环 rand 早退
    //  :34243-34245 连 homing 一并吞）——此处跳过防段外双算
    if (st.home && this.projId !== 596 && !game.player.dead) {
      const p = game.player;
      if (Math.abs(p.cx - this.cx) + Math.abs(p.cy - this.cy) < st.home.range) {
        const ddx = p.cx - this.cx, ddy = p.cy - this.cy;
        const dd = Math.hypot(ddx, ddy) || 1;
        const tvx = (ddx / dd) * st.home.spd, tvy = (ddy / dd) * st.home.spd;
        this.vx = (this.vx * st.home.lerp + tvx) / (st.home.lerp + 1);
        this.vy = (this.vy * st.home.lerp + tvy) / (st.home.lerp + 1);
      }
    }
    // ---- ★批六：811/814 BloodShot AI 段（AI_001 type==811 支 P.cs:57340-57367 /
    //      type==814 支 :57403-57435）。★批六 m2：本段挪到位移【前】——原版 AI 尘
    //      在 position+=velocity 之前取 pre-move Center,旧位相领先一步 ----
    //  首拍（localAI[0]==0）：★批六 C2 门改 age===1（dartStep 头 age++ 先行,0 永假）；
    //  811：Item17 音已由表 sfx 承载 + 8×d5 四向爆发（vel=NextFloatDirection()*π 全向
    //  单位×2 + norm(v)×3、scale1.5、fadeIn1.7、pos=Center :57344-57356）；
    //  814（批六 m3 补）：Item171 + 8×d5 同构,kick ×2、scale0.9、fadeIn1.1（:57405-57422）；
    //  每拍轨迹尘 2×d5（vel=dust/4+proj.v/2——VanillaDust.spawn 已按 NewDust 式掺
    //  rand±2,故【叠加】非覆写、scale1.2、pos=Center+rand×v×2 :57358-57364/:57423-57429）；
    //  α−20/拍由表 fade:20 承载。
    if (this.projId === 811 || this.projId === 814) {
      const is811 = this.projId === 811;
      // oldPos 快照（★G′ T5 勘误：原版 oldPos[0]=position 写入在 Update【尾】post-move
      //  （TrailingMode[814]=2,P.cs:17234-17245）,本仓 unshift 在位移【前】取 pre-move
      //  位——带标签比原版多一槽（含出生位 P0）,差账由 814 消费环上界 age−2 剪除）
      this.trailHist.unshift({ x: this.x, y: this.y });
      if (this.trailHist.length > 10) this.trailHist.length = 10;
      if (this.age === 1) {
        for (let i = 0; i < 8; i++) {
          const d811 = game.spawnDust?.(this.cx, this.cy, 0, 0, 5, this.vx, this.vy, 100);
          if (!d811) break;
          const a811 = Math.random() * Math.PI * 2;      // NextFloatDirection()*π 全向
          const nl811 = Math.hypot(this.vx, this.vy) || 1;
          const kick = is811 ? 3 : 2;                    // 811 ×3(:57353) / 814 ×2(:57416)
          d811.vx = Math.cos(a811) * 2 + (this.vx / nl811) * kick;
          d811.vy = Math.sin(a811) * 2 + (this.vy / nl811) * kick;
          d811.scale = is811 ? 1.5 : 0.9;                // :57355 / :57418
          d811.fadeIn = is811 ? 1.7 : 1.1;               // :57356 / :57419
          d811.x = this.cx; d811.y = this.cy;
        }
      }
      for (let i = 0; i < 2; i++) {
        const d811b = game.spawnDust?.(this.cx, this.cy, 0, 0, 5, this.vx, this.vy, 100);
        if (!d811b) break;
        d811b.vx = d811b.vx / 4 + this.vx / 2;           // obj.velocity = obj.velocity/4 + velocity/2（随机分量保留,批六 m2）
        d811b.vy = d811b.vy / 4 + this.vy / 2;
        d811b.scale = 1.2;
        const j811 = Math.random() * 2;                  // NextFloat()×2
        d811b.x = this.cx + this.vx * j811;              // pos = Center + rand×velocity×2
        d811b.y = this.cy + this.vy * j811;
      }
      // ★R4(T4-①,2026-09-02)：814 长程拖尾尘（P.cs:57427-57435）——oldPos[1..9] 逐位
      //  1/3 掷（Main.rand.Next(3)==0）,命中位出 d5：vel=dust/4+proj.v/2、scale1.2、
      //  pos=oldPos[i]+Size/2+NextFloat()×v×2（单掷 x/y 同因子）。快照带见 trailHist
      //  字段注——814 tileCollide=false 长程穿场,唯此面给"血弹雨"尾迹纵深。
      //  ★G′ T5（2026-09-02）：消费带上界 min(9, age−2)。原版 oldPos 写入在 Update
      //  【尾】（TrailingMode[814]=2,P.cs:17234-17245 post-move oldPos[0]=position,
      //  出生位 P0 从不写入）+ AI 环 :57430 首个 Zero 槽即断——P0 永不入消费带,t=k
      //  拍消费 oldPos[1..min(9,k−2)]。本仓 unshift 在位移【前】取 pre-move 位,
      //  hist[i]=i 拍前位恰比原版带多一槽——上界 age−2 恰剪掉 P0（t=2..10 期间
      //  每拍多出的枪口出生位掷点瞬态）;t≥11 带满上下界归 9,与原版逐位同带。
      if (this.projId === 814) {
        for (let i = 1; i <= Math.min(9, this.age - 2) && i < this.trailHist.length; i++) {
          if (Math.random() >= 1 / 3) continue;          // Main.rand.Next(3) == 0
          const hp = this.trailHist[i];
          const d814t = game.spawnDust?.(hp.x, hp.y, this.w, this.h, 5, this.vx, this.vy, 100);
          if (!d814t) break;
          d814t.vx = d814t.vx / 4 + this.vx / 2;         // obj15.velocity = obj15.velocity/4 + velocity/2
          d814t.vy = d814t.vy / 4 + this.vy / 2;
          d814t.scale = 1.2;
          const j814 = Math.random() * 2;                // NextFloat()×2（x/y 同掷）
          d814t.x = hp.x + this.w / 2 + this.vx * j814;  // pos = oldPos[i] + Size/2 + rand×velocity×2
          d814t.y = hp.y + this.h / 2 + this.vy * j814;
        }
      }
    }
    if (st.bomb) {
      // ---- aiStyle16 炸弹族位移（75 HappyBomb）：轴分离 + 撞块反弹
      //      （Projectile.cs:19866-19872：X 碰 → −lastVX×0.4；Y 碰且 lastVY>0.7
      //      → −lastVY×0.4,否则停）。贴地摩擦走 AI_016_Bombs 尾原式(:48379-48413)：
      //      全段在 ai[0]>5 门内、门=上拍碰撞后的 velocity.Y==0(读加重力前快照) 且
      //      vx≠0 + |vx|≤0.01 静止截停——★B 档清偿:曾用"脚下实心"探针近似且缺截停,
      //      慢速爬行永不休止 ----
      if (this.age > 5 && prevVyZero && this.vx !== 0) {
        this.vx *= 0.97;
        if (this.vx > -0.01 && this.vx < 0.01) this.vx = 0;
      }
      const lvx = this.vx, lvy = this.vy;
      this.x += this.vx;
      if (game.world.store.isSolid(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) {
        this.x -= this.vx; this.vx = -lvx * 0.4;
      }
      this.y += this.vy;
      if (game.world.store.isSolid(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) {
        this.y -= this.vy; this.vy = lvy > 0.7 ? -lvy * 0.4 : 0;
      }
    } else {
      this.x += this.vx;
      this.y += this.vy;
    }
    // ---- 31 沙球沿途击碎（:55106-55136 KillTile 清单，每 tick 扫重叠盒）：
    //      水晶12/雕像105/钟乳石165/裸露宝石178/小石堆185/大石堆186-187/
    //      魔力水晶639/生命水晶巨石665——沙球扫过即碎 ----
    if (st.sandBall) {
      const sst = game.world.store;
      for (let bx = Math.floor(this.x / TILE); bx <= Math.floor((this.x + this.w - 0.01) / TILE); bx++) {
        for (let by = Math.floor(this.y / TILE); by <= Math.floor((this.y + this.h - 0.01) / TILE); by++) {
          if (!sst.inBounds(bx, by)) continue;
          // ★幽灵保域（2026-09-04 F3a）：碎晶首门 = 原版 :59031-59033
          //  `if (tile == null || !tile.active()) continue;`（KillTile :64041 头门
          //  同语义再兜一层）——DirtBallProj:189/Arrow:5034 两载体同款已修,
          //  此处补 Dart 载体漏网：幽灵晶簇（flags=0,type≠0）不碎不掉落
          if (!sst.hasTile(bx, by)) continue;
          if (SHATTER_SET.has(sst.get(bx, by))) game.breakTile?.(bx, by);
        }
      }
      // 31 敌沙球飞行尘（AI_010 尘链与 42 同支 :58852-58857:1/2 掷 d32、尘速 X×0.4
      // ——Arrow 载体 42/65/68/354 四型同链已补,此处补 Dart 载体的 31）
      if (this.projId === 31 && Math.random() < 0.5) {
        const sd = game.spawnDust?.(this.x, this.y, this.w, this.h, 32);
        if (sd) sd.vx *= 0.4;
      }
    }
    // ---- 拖尾尘（原版每更新 NewDust;近似为低频 spawnParticles 防刷屏）----
    if (st.trail && (this.tick & 1) === 0) {
      game.spawnParticles(this.cx, this.cy, st.trail.color, st.trail.count, 0.4,
        { life: st.trail.life ?? 24, damp: 0.93, grav: st.trail.grav ?? 0 });
    }
    // ---- 火箭族尾烟（AI_016_Bombs :48181-48233,134/137/140/143/303/776 族）：
    //      |v|≥8 每拍 2 组——尘 6 烟（scale×(2+r10×0.1)、vel×0.2、noGravity）+
    //      **尘 31 火焰**（scale 0.5、fadeIn 1+r5×0.1、vel×0.05,fadeIn 生长档渐亮渐大
    //      再衰减=尾焰观感），位置 = pos+(3,3)+off−v×0.5、盒 (w−8,h−8),off=v×0.5 交错;
    //      尾随空中加速 |vx|<15 且 |vy|<15 → ×1.1（:48230-48233）。★曾整个缺失——
    //      只有烟没有火(2026-09-01 用户报) ----
    if (ROCKET_TRAIL.has(this.projId)) {
      if (Math.abs(this.vx) >= 8 || Math.abs(this.vy) >= 8) {
        for (let n = 0; n < 2; n++) {
          const ox = n === 1 ? this.vx * 0.5 : 0;
          const oy = n === 1 ? this.vy * 0.5 : 0;
          const bx = this.x + 3 + ox - this.vx * 0.5;
          const by = this.y + 3 + oy - this.vy * 0.5;
          const smoke = game.spawnDust?.(bx, by, st.w - 8, st.h - 8, 6, 0, 0, 100, null, 1);
          if (smoke) {
            smoke.scale *= 2 + Math.floor(Math.random() * 10) * 0.1;
            smoke.vx *= 0.2; smoke.vy *= 0.2;
            smoke.noGravity = true;
          }
          const flame = game.spawnDust?.(bx, by, st.w - 8, st.h - 8, 31, 0, 0, 100, null, 0.5);
          if (flame) {
            flame.fadeIn = 1 + Math.floor(Math.random() * 5) * 0.1;
            flame.vx *= 0.05; flame.vy *= 0.05;
          }
        }
      }
      if (Math.abs(this.vx) < 15 && Math.abs(this.vy) < 15) {
        this.vx *= 1.1; this.vy *= 1.1;
      }
    }
    // ---- 光照：无实体自报光。发光弹型（44/84/96/115/180/257/302 等）全部由 Game 侧
    //      ProjLight() 1:1 标量循环结算（SetDefaults light × 乘区/绝对通道表）——
    //      曾在此处自报 st.light 造成双重注入，且多条数值与原版不符（96 灰 vs 原版绿、
    //      257 手调蓝、596/814 原版根本无光）已全数摘除
    // ---- ★2026-09-01 批四（T1/H1）+ 批六（M2/M3）：596 沙漠幽焰 AI 段（AI_107
    //      type==596 支 Projectile.cs:34202-34272）。★承载勘误：596 走 Dart（DART_STYLE
    //      596 ← Enemy.fireCasterVolley 沙漠精灵 533 :21104-21135 直构）非 Arrow——原版
    //      门结构：尘环 3 连掷 Main.rand.Next(3)!=0 即 return（:34243-34245），单拍受理
    //      率 (1/3)^3=1/27——早退同时吞掉【尘环余迭代+尾爆+homing】。
    //      ★批六 M3-b：AI α 渐显段（timeLeft>30 −25/拍 + 实心盒钳 128 :34208-34219）
    //      落地（通用 fade 对 596 排除;GetAlpha 消费在 draw 侧,timeLeft<30 渐隐窗）。
    //      ★批六 M2：homing 挪进受理分支（原版 rand 早退连 homing 一并吞）——通用
    //      home 块对 596 跳过,表 home {spd:7.5,lerp:9,range:40} = AI_107 共通尾
    //      （:34277-34286,num837=10/num838=7.5 覆写/num839=40 欧氏门）。
    //      life 递减序与原版 timeLeft 差 1 拍（fixedUpdate 先减后步），段界量化 ±1。 ----
    if (this.projId === 596) {
      // AI α 渐显（:34208-34219）：timeLeft>30 门 + 实心盒钳 128（半透下限）+
      // 负钳；timeLeft≤30 后 AI 停减,渐隐窗由 draw 侧 GetAlpha 式按 life 重算
      if (this.life > 30 && this.alpha > 0) this.alpha -= 25;
      if (this.life > 30 && this.alpha < 128
        && shotBoxSolid(game, this.x, this.y, this.w, this.h)) this.alpha = 128;
      if (this.alpha < 0) this.alpha = 0;
      const phase596 = this.tick;                        // ai[1]++（:34240，tick=AI 拍计数）
      const scale596 = this.life < 60 ? 1.6 : this.life < 120 ? 1.1 : 0.5;   // num840 :34231-34238
      let burst596 = true;
      for (let k = 0; k < 3; k++) {
        if (Math.floor(Math.random() * 3) !== 0) { burst596 = false; break; }   // return :34243-34245
        const d596 = game.spawnDust?.(this.cx, this.cy, 0, 0, 27, 0, -2);
        if (d596) {
          const a596 = k * (Math.PI * 2) / 3 + phase596;
          d596.x = this.cx + -Math.sin(a596) * 10;       // UnitY.RotatedBy(a)×10（:34248）
          d596.y = this.cy + Math.cos(a596) * 10;
          d596.noGravity = true;
          // velocity = DirectionFrom(尘位)（Entity.cs:210-213，向心单位向）
          const dx596 = this.cx - d596.x, dy596 = this.cy - d596.y;
          const dl596 = Math.hypot(dx596, dy596) || 1;
          d596.vx = dx596 / dl596; d596.vy = dy596 / dl596;
          d596.scale = scale596;
          d596.fadeIn = 0.5;
          d596.alpha = 200;
        }
      }
      // 尾爆（:34258-34272）：timeLeft<4 → 盒保心扩 60×60 + damage=30/expert 22 +
      //  10×尘 SelectRandom(27,6)（盒内随机位,noGravity,velocity=DirectionTo(尘位)×3）
      if (burst596 && this.life < 4) {
        this.x = this.cx - 30; this.y = this.cy - 30; this.w = 60; this.h = 60;   // :34259-34264
        this.damage = mainExpertMode(game.world) ? 22 : 30;                        // :34259-34262
        for (let n = 0; n < 10; n++) {
          const t596 = Math.random() < 0.5 ? 27 : 6;         // Utils.SelectRandom :34267
          const d596b = game.spawnDust?.(this.x, this.y, this.w, this.h, t596, 0, -2);
          if (d596b) {
            d596b.noGravity = true;
            const dx596 = d596b.x - this.cx, dy596 = d596b.y - this.cy;
            if (dx596 !== 0 || dy596 !== 0) {                // dust.position != Center 门 :34270-34272
              const dl596 = Math.hypot(dx596, dy596) || 1;
              d596b.vx = (dx596 / dl596) * 3;                // DirectionTo(尘位)×3（向外）
              d596b.vy = (dy596 / dl596) * 3;
            }
          }
        }
      }
      // ★批六 M2：homing（AI_107 共通尾 :34277-34292）——只在 1/27 受理拍跑
      // （原版 rand 早退吞 homing）。门 = 欧氏 Distance>num839(40) 才混合；
      // velocity=(velocity×(num837−1)+dir×num838)/num837 → 596 覆写 num838=7.5、
      // num837=10 ⇒ (v×9+dir×7.5)/10 = 表 home {spd:7.5,lerp:9,range:40} 按
      // 「lerp=除数−1」约定消费（同 293 档）。目标失效（死）→ timeLeft 钳 30
      // （:34289-34292 else 支）。
      if (burst596) {
        const p = game.player;
        if (p && !p.dead && st.home) {
          const dxh = p.cx - this.cx, dyh = p.cy - this.cy;
          const dist = Math.hypot(dxh, dyh);
          if (dist > st.home.range) {
            const dlh = dist || 1;
            this.vx = (this.vx * st.home.lerp + (dxh / dlh) * st.home.spd) / (st.home.lerp + 1);
            this.vy = (this.vy * st.home.lerp + (dyh / dlh) * st.home.spd) / (st.home.lerp + 1);
          }
        } else if (p.dead && this.life > 30) {
          this.life = 30;
        }
      }
    }
    // ---- 撞实心块 ----
    // ★SW-FX7（2026-09-10）大盒弹缩盒 tile 判定（GetCollisionParams,Projectile.cs:
    //  19982-20156）——原版 HandleMovement 的 TileCollision 用【缩盒】而非弹体盒:
    //  44 魔镰 aiStyle18 → width−36 = 12×12（:20081-20085）;288 金雨命中缩盒名单
    //  → 10×10（:20072-20080）。缩盒重叠 = TileCollision 截停 = velocity 变 →
    //  默认 Kill 支 position+=velocity;Kill（:19962-19966）。此前中心格判定对
    //  缩盒边缘 6px/5px 漏检（弹沿墙皮掠过时可多穿半格才消亡）。
    //  其余弹型维持中心格近似（GetCollisionParams 其余分支逐型未对拍,登记债）。
    const tileBoxHalf = st.tileBox ? st.tileBox / 2 : 0;
    const tileHit = tileBoxHalf > 0
      ? shotBoxSolid(game, this.cx - tileBoxHalf, this.cy - tileBoxHalf, st.tileBox!, st.tileBox!)
      : game.world.store.isSolid(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
    if (tileHit) {
      // ★①290 暗影束撞块反弹（Update HandleMovement :18975-19018）：全速反号不消亡
      //  （penetrate=-1 无限反弹）+ 束段铺撒（上一锚点→当前心,Spawn_Shadowbeam
      //  敌版 velocityScalar=0.03334,ParticleOrchestrator.cs:1987-1993）后重锚。
      //  原版按 velocity!=lastVelocity 分轴反射;本仓单点碰撞无轴信息 → 主轴反射
      //  （Arrow 294 友版同款登记）。广播走 module8 ShadowbeamHostile=联机中继,
      //  本地视觉=beam290Segment;Kill 收尾段在 killBeam290（fixedUpdate 寿终口）
      if (this.projId === 290) {
        if (Math.abs(this.vx) > Math.abs(this.vy)) this.vx = -this.vx;
        else this.vy = -this.vy;
        if (this.sb290L0 >= 3 && this.sb290Ax > 0 && this.sb290Ay > 0) {
          this.beam290Segment(game);
          game.broadcastParticleOrchestra?.(ParticleOrchestraType.ShadowbeamHostile,
            this.cx, this.cy, this.sb290Ax, this.sb290Ay,
            Math.round(Math.hypot(this.vx, this.vy) * 1000));
        }
        this.sb290Ax = this.cx; this.sb290Ay = this.cy;
        return;
      }
      if (st.rocket) { this.rocketKill(game); return; }  // 303 火箭撞块即爆（Kill 段）
      // ★批六 M6：811 Kill 尘收口 killBloodShot（Projectile.Kill 共组 :74019-74027——
      //  30×d5 scale1.25+rand、vel×2、α=0 缺省。814 tileCollide=false 不撞墙,唯 811 走本口）
      if (this.projId === 811) killBloodShot(game, this.x, this.y, this.w, this.h);
      if (st.noTile) { /* 300 圣锤/299 暗影焰 tileCollide=false:穿墙 */ }
      else {
        // ---- 31 沙球落档（Projectile.Kill aiStyle==10 :79117-79310 等价）：落地放沙 ----
        // ★放置格 = 上一帧中心格:原版 TileCollision 把弹体挡在实心外、Kill 时中心格
        // =实心上方空格;本仓碰撞判定在积分后(中心已入实心格),上一帧中心格即原版
        // 弹回后的中心格。放置格须空(!active),被占→不放(蚁狮敌版 ai[0]==2 num18=0,
        // :79137-79140 连物品都不掉=纯消失)。★旧"向上扫第一个空位"会把沙抬到草苗/
        // 仙人掌上方悬空叠放——FallingBlock 63 系 2026-08-24 已修,31 喷沙路径漏网
        // (用户复报"喷出的沙块出现在草的上面",2026-08-25 补齐)。
        // 下方 314 轨道/421-422 传送带 → 不放(:79256-79260);BlockBelowMakesSandFall
        // (WorldGen.cs:87868:下方空/下方非实心且再下空/钟乳石165)→不放。
        // ★放置 tile = 原版 53 沙 → 本仓 id 经 VANILLA_TILE_ID 换算(曾硬编码 53=
        // 本仓第 53 号注册位=别的方块)。
        if (st.sandBall) {
          const sst = game.world.store;
          let noPlace = false;
          let onConveyor = false;
          // ★A-4（2026-09-04）：flag2 外门 = :79255 `num16 < Main.maxTilesY - 2`——
          //  世界底部 2 行不进 flag2 扫描（轨道/传送带/沙塌三支整体跳过 → 照常
          //  PlaceTile;旧实现逐读 inBounds 无此外门,差一行）
          if (prevTy < sst.h - 2) {
            const below = sst.inBounds(prevTx, prevTy + 1) ? sst.get(prevTx, prevTy + 1) : 0;
            noPlace = below === T_RAIL || below === T_CONV_L || below === T_CONV_R;
            onConveyor = below === T_CONV_L || below === T_CONV_R;   // ★R8 F1:传送带来因单列
            // ★幽灵保域（2026-09-04 F3b）+★④（2026-09-04 掉落/沙族批）：支撑判定
            //  单源化 → FallingBlock.blockBelowMakesSandFall（WorldGen.cs:87868-87893
            //  1:1,nactive=active∧!致动,三支+早退序同原文）。曾内联第 4 份副本
            //  （DirtBall/Game/FallingBlock 三份已单源,★M13 A-2）：arm2 用 !isSolid
            //  （def.solid 域）代 !Main.tileSolid —— tileSolid∧tileSolidTop 九件套
            //  （19/239/380/427/435-439,Main.cs:10118-10136,含种植箱 380）被漏 →
            //  沙球落种植箱/平台上被误判"沙塌不放置"（平台病同源）;arm3 裸 type==165
            //  比对漏 active 门 → 幽灵钟乳石残型误触发。两态按单源闭合。
            if (!noPlace && blockBelowMakesSandFall(sst, prevTx, prevTy)) noPlace = true;
          }
          // ★幽灵保域（2026-09-04 F3b）：放置占位门 = :79246
          //  `!Main.tile[num15,num16].active()`（hasTile=纯 active 位）——
          //  幽灵格（flags=0,type≠0）视为空可落格,沙覆盖残型直铺
          if (T_SAND !== undefined && !noPlace && sst.inBounds(prevTx, prevTy)
            && !sst.hasTile(prevTx, prevTy)) {
            sst.setTile(prevTx, prevTy, T_SAND);
          }
          // ★终审 B④（2026-09-04）：flag2 掉件面 = Projectile.cs:79290-99 全量——
          //  flag2 三支（轨道 314 :79256-79259 / 传送带 421-422 :79260-79266 / 沙塌
          //  BlockBelowMakesSandFall :79267-79270）→ 免 PlaceTile（flag=false）→
          //  :79296-98 `else if (!flag && num18 > 0) RequestNewItem(DropAsItem,
          //  Center+(0,-2), num18)`。itemType 判定照原文 num18 表（:79131-79140）：
          //  type 31 → 169,ai[0]==2f → 0——本仓 31 唯一生成位=蚁狮敌吐（Enemy.ts
          //  shootDart ↔ NPC.cs:24579-24604 两吐位均 `ai[0] = 2f`）→ 轨道/沙塌支
          //  num18=0 不掉件（=原版蚁狮版纯消失,非掉件面缺;判定面按原式接 spawnDrop
          //  通道,将来接入 ai0≠2 的 31 生成位即活）。传送带支 :79263-79265 对 31
          //  无条件重挂 169 → 掉 vi_169_SandBlock ×1（R8 F1 已接,本批补 :79297 锚
          //  Center+(0,-2)——曾用 Center 少 -2px）。被占支 :79300-79304 num18=0
          //  同样不掉（上方放置门注释已录）。
          const num18Flag2 = onConveyor ? 169 : 0;
          if (num18Flag2 > 0) game.spawnDrop?.(this.cx, this.cy - 2, 'vi_169_SandBlock', 1);
        }
        this.killShooterDust(game);   // ★FX53：撞块 Kill 尘站（原版 TileCollision→Kill :71752）
        this.dead = true; return;
      }
    }
    // ---- Update 尾通用尘站（Projectile.Update :17141-17182;★FX53 定谳 2026-09-16）:
    //  原版站与 owner/npcProj 无关——NPC 弹与玩家弹同站同频。Arrow 载体已在
    //  subStep 实现该段,本载体（spawnHostileProj=NPC 射手弹通道）整缺 →
    //  骷髅弓箭手 110（NPC.cs:59612 表内,弹 num171 缺省=82 :59797）射出的燃烧箭
    //  无火焰尾迹（用户报"NPC 燃烧箭无火粒子,玩家的有"）。段在原版 numUpdates
    //  子步循环【内】(while 体延伸至 :17345)→ 每【子步】1 粒;82 EU=0 → 每 tick
    //  恰 1 粒。2/82→d6(α100,speed(0,0)=纯 NewDust 内建 ±2 抖动)——本表域内仅 82
    //  命中该链（2/172/103/278/4/5 不走本载体;81/98/980/1073 原版本链无分支=
    //  木箭族无尾迹,尘面只在 Kill 站）。死亡拍不撒:下方 tileHit 口 return=
    //  原版 HandleMovement 内 Kill → :17132 !active 早退同语义 ----
    if (this.projId === 82) {
      game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100);
    }
    // ---- 命中玩家(敌对):矩形相交即消耗弹体;伤害走 damagePlayer(防御减算/受击音/
    // iframes 去重——无敌帧内命中不扣血但弹体照常销毁,原版语义) ----
    if (projOverlap(this.x, this.y, this.w, this.h, game.player) && !game.player.dead) {
      if (st.rocket) { this.rocketKill(game); return; }
      // ★批五：noPlayerHit 族碰玩家无伤穿透不消亡（596 原版 NewProjectile damage=0
      //  + penetrate=-1,P.cs:21229/:6452-6461——曾折中为接触即死+爆,伤害面错位:
      //  飞行 baseDamage 冒充了本应为 0 的接触伤;稳定伤害面只保留寿终 curse596Kill）
      if (st.noPlayerHit) return;
      const hit290 = hitPlayer(this, game, this.damage);
      // ★①/②（2026-09-02 敌侧弹幕三缺口批）：290 暗影束/291 地狱火弹穿透不消亡——
      //  Damage_EVP 全段无 Kill（P.cs:14846-14971）,penetrate=-1（SetDefaults :3804/:3815）
      //  穿过玩家继续飞（290 继续反弹巡场、291 到锚点才爆）;iframes 门 = 原版
      //  player.immune 去重。命中实扣才接 StatusPlayer（Arrow :6511 同式）：
      //  290 → Slow(32)（:12357-12360）/ 291 → On Fire(24)（:12337-12340,表已载）
      if (this.projId === 290 || this.projId === 291) {
        if (hit290) statusPlayer(game, this.projId);
        return;
      }
      // ★批六 M6：811 有伤穿透——Damage_EVP 全段无 Kill（P.cs:14846-14971）,
      //  penetrate=-1 穿过玩家继续飞、撞后墙才死；hitPlayer 内 iframes 门 =
      //  原版 player.immune 去重,重叠期不连扣（其余弹型保持命中即灭）
      //  ★R4(T4-②,2026-09-02)：814 同族并入——SetDefaults 811/814 共块同置
      //  penetrate=-1（P.cs:7927-7936）,Damage_EVP 同段无 Kill;814 tileCollide=false
      //  撞不了墙,命中即死会让"血弹齐射"弹幕一次接触就整波消失（曾仅修 811）
      //  ★IIIII235（2026-09-10）：300 圣锤并入同族——Damage_EVP（P.cs:14846-14971）
      //  对敌→玩家命中【无 Kill 且不扣 penetrate】（末段 penetrate-- 仅 435/436/
      //  437/682、timeLeft=0 仅 681）,penetrate=-1（SetDefaults :3908-3916）穿过玩家
      //  继续飞;tileCollide=false 也撞不了墙 → 唯一寿命=timeLeft 3600。曾命中即灭=
      //  圣骑士一把锤只摸一次（原版可来回穿人反复施压）
      //  ★尘站普查批（2026-09-16）：581 破甲刺并入同族——SetDefaults penetrate=-1
      //  （P.cs:6312,Dart 载体投影）穿透不消亡继续飞（命中口旧即死=投影面缺）
      if (this.projId !== 811 && this.projId !== 814 && this.projId !== 300
        && this.projId !== 581) {
        this.killShooterDust(game);   // ★FX53：命中消耗 Kill 尘站（原版 penetrate 耗尽→Kill）
        this.dead = true;
      }
    }
    // ---- 75 HappyBomb 近身引信（AI_016 :47809-47820）：距存活玩家中心 <40px
    //      即 Kill(=爆炸;tenthAnniversaryWorld 豁免本仓无此世界) ----
    if (st.proxKill && !game.player.dead
      && Math.hypot(game.player.cx - this.cx, game.player.cy - this.cy) < st.proxKill) {
      this.rocketKill(game);
    }
    // ---- 299 暗影焰尘尾（AI_001 :57611-57637,每子步;EU=2 → ×3/帧）:localAI==6
    //      同拍 = Item8 音 + 40×d181 爆发（尘速×3+v×0.75、scale×1.2、noGravity）;
    //      ++ 后 >6 起每子步 3×d181（spd=v×0.2、尘速×0.6、scale×1.4、noGravity）。
    //      299 本体贴图 1×1 空桩 → 可见面全在此尘（spec.trail 泛色单粒子退役由本段取代）
    if (this.projId === 299) {
      if (this.ai299Local === 6) {
        game.playSfxFiles?.(['Item_8'], 1, this.cx, this.cy);
        for (let i = 0; i < 40; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 181, 0, 0, 100);
          if (d) { d.vx = d.vx * 3 + this.vx * 0.75; d.vy = d.vy * 3 + this.vy * 0.75;
            d.scale *= 1.2; d.noGravity = true; }
        }
      }
      this.ai299Local++;
      if (this.ai299Local > 6) {
        for (let i = 0; i < 3; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 181,
            this.vx * 0.2, this.vy * 0.2, 100);
          if (d) { d.vx *= 0.6; d.vy *= 0.6; d.scale *= 1.4; d.noGravity = true; }
        }
      }
    }
    // ---- 293 迷失魂尘尾（aiStyle51 :28842-28854,每子步;EU=1 → ×2/帧）:
    //      首拍 localAI==0 → Item8（出生音由 spec.sfx 承载,不双播）;
    //      每子步 9×d175（scale1.3、noGravity、尘速×0）
    if (this.projId === 293) {
      for (let i = 0; i < 9; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 175, 0, 0, 100, null, 1.3);
        if (d) { d.vx = 0; d.vy = 0; d.noGravity = true; }
      }
    }
  }

  /** ★FX53（2026-09-16）：射手箭族 Kill 尘站（Projectile.Kill :71752 起分档链）。
   *  Arrow 载体 Kill 链（Arrow.ts killNow 分档,tests/arrow-flight-trail-dust 金标）
   *  已接,本载体（spawnHostileProj=NPC 射手弹）整缺——同 FX53 根因（载体分家）。
   *  三个死亡口（寿终/撞块/命中消耗）同调本站,与原版 Kill() 唯一入口一致：
   *  · 2/82 燃烧箭：legacy PlaySound(0)=dig + 10×d6 α100（:77165-77171）
   *  · 1/81/98/980/1073 木箭族：dig + 10×d7（:75447-75455;98/980 走 TrapShot 载体
   *    不达本站,登记 TrapShot 侧同族债）
   *  · 507/508 标枪（希腊骷髅 481）：dig + 20×d81——出生位沿 -oldVelocity 归一向
   *    从 pos+16 起每粒退 8px（:75392-75410 vector54/vector55），尘位=(尘位+Center)/2、
   *    尘速=(尘速+oldVel×0.4)×0.5、noGravity。oldVelocity 取死亡拍速度（本仓位移
   *    无 lastVelocity 快照,撞块口速度未被清零=同值域） */
  private killShooterDust(game: GameHooks): void {
    // ---- ★尘站普查批④（2026-09-16）：撞击面组（Projectile.Kill :77649-77652
    //      Collision.HitTiles+SoundID.Item10 共享列表——敌弹在域成员 83/84/180/302/
    //      577）。原版该支在 Kill() 单口体内=撞块/寿终/命中三死亡口均达（Game.ts
    //      :38904 消亡原因矩阵同判）;尘面几何门在 hitTilesFx 内=悬空到期自然无尘。
    //      Dart 载体不路由 onProjectileDeath → 本口承载（Arrow 载体同组面在 Game 侧）----
    if (BULLET_KILL_SFX.has(this.projId)) {
      game.hitTilesFx?.(this.x, this.y, this.w, this.h, this.vx, this.vy);
      game.playSfxFiles?.(['Item_10'], 1, this.cx, this.cy);
    }
    switch (this.projId) {
      case 2: case 82:
        game.playSfx('dig', 1, this.cx, this.cy);
        for (let i = 0; i < 10; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100);
        break;
      case 1: case 81: case 98: case 980: case 1073:
        game.playSfx('dig', 1, this.cx, this.cy);
        for (let i = 0; i < 10; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 7);
        break;
      case 507: case 508: {
        game.playSfx('dig', 1, this.cx, this.cy);
        const sp = Math.hypot(this.vx, this.vy) || 1;
        const ux = this.vx / sp, uy = this.vy / sp;        // oldVelocity.SafeNormalize(:75397-75399)
        let dx = this.x + ux * 16, dy = this.y + uy * 16;  // vector54 = position + norm×16(:75400)
        for (let i = 0; i < 20; i++) {
          const d = game.spawnDust?.(dx, dy, this.w, this.h, 81);
          if (d) {
            d.x = (d.x + this.cx) / 2;                     // (dust.position + Center)/2(:75403)
            d.y = (d.y + this.cy) / 2;
            d.vx += this.vx * 0.4; d.vy += this.vy * 0.4;  // += oldVelocity×0.4(:75404)
            d.vx *= 0.5; d.vy *= 0.5;                      // ×0.5(:75405)
            d.noGravity = true;
          }
          dx -= ux * 8; dy -= uy * 8;                      // -= norm×8(:75407)
        }
        break;
      }
      // ---- ★NPC 弹幕尘站普查批③（2026-09-16,docs/npc-proj-dust-census.md §6）：
      //      Kill 站补齐。Dart 载体不路由 onProjectileDeath（Game.ts:554 注）,同 id
      //      玩家武器版（Arrow 载体）的 K 面由 Game 侧独立承载,两侧不重复撒。
      //      行号锚 1457 Projectile.Kill() 分档链 ----
      case 38:                                            // 哈比羽（:77933-77938）
        for (let i = 0; i < 10; i++) {
          game.spawnDust?.(this.x, this.y, this.w, this.h, 42,
            this.vx * 0.1, this.vy * 0.1);
        }
        break;
      case 44:                                            // 魔镰（:77940-77947）
        game.playSfxFiles?.(['Item_10'], 1, this.cx, this.cy);
        for (let i = 0; i < 30; i++) {
          game.spawnDust?.(this.x, this.y, this.w, this.h, 27, this.vx, this.vy, 100, null, 1.7, true);
          game.spawnDust?.(this.x, this.y, this.w, this.h, 27, this.vx, this.vy, 100);
        }
        break;
      case 55:                                            // 毒刺（:77139-77144,55/719 共组）
        for (let i = 0; i < 5; i++) {
          game.spawnDust?.(this.x, this.y, this.w, this.h, 18, 0, 0, 0, null, 1.5, true);
        }
        break;
      case 96:                                            // 诅咒焰（:77792-77802,95/96 共组）
        game.playSfxFiles?.(['Item_10'], 1, this.cx, this.cy);
        for (let i = 0; i < 20; i++) {
          const dA = game.spawnDust?.(this.x, this.y, this.w, this.h, 75,
            -this.vx * 0.2, -this.vy * 0.2, 100, null, 2 * this.scale, true);
          if (dA) { dA.vx *= 2; dA.vy *= 2; }
          const dB = game.spawnDust?.(this.x, this.y, this.w, this.h, 75,
            -this.vx * 0.2, -this.vy * 0.2, 100, null, 1 * this.scale);
          if (dB) { dB.vx *= 2; dB.vy *= 2; }
        }
        break;
      case 128:                                           // 霜爆（:76878-76890,119/118/128/359 共组）
        game.playSfxFiles?.(['Item_27'], 1, this.cx, this.cy);
        for (let i = 0; i < 10; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 92);
          if (!d) break;
          if (Math.floor(Math.random() * 3) !== 0) {
            d.vx *= 2; d.vy *= 2; d.noGravity = true; d.scale *= 1.75;
          } else {
            d.scale *= 0.5;
          }
        }
        break;
      case 177:                                           // 冰涎（:76852-76867）
        for (let i = 0; i < 20; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 137, 0, 0,
            Math.floor(Math.random() * 101), null,
            1 + (Math.floor(Math.random() * 60) - 20) * 0.01);
          if (!d) break;
          d.vx -= this.vx * 0.2; d.vy -= this.vy * 0.2;   // velocity -= oldVelocity×0.2
          if (Math.floor(Math.random() * 3) === 0) {
            d.scale *= 0.8; d.vx *= 0.5; d.vy *= 0.5;
          } else {
            d.noGravity = true;
          }
        }
        break;
      case 471:                                           // 投骨（:77893-77898,21/471/532/1111 共组）
        game.playSfx('dig', 1, this.cx, this.cy);
        for (let i = 0; i < 10; i++) {
          game.spawnDust?.(this.x, this.y, this.w, this.h, 26, 0, 0, 0, null, 0.8);
        }
        break;
      case 572:                                           // 蝾螈吐息（:73976-73985）
        for (let i = 0; i < 15; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 40,
            this.vx * 0.1, this.vy * 0.1, 100);
          if (!d) break;
          d.vx *= 3; d.vy *= 3;
          d.noGravity = true; d.scale = 1.25;
          d.x = (this.cx + this.x) / 2; d.y = (this.cy + this.y) / 2;
        }
        break;
      case 836:                                           // 蒲公英籽（:75137-75144）
        for (let i = 0; i < 3; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 50,
            { r: 255, g: 255, b: 255, a: 255 }, 0.8);
          if (d) { d.vx *= 0.5; d.vy *= 0.5; d.noGravity = true; }
        }
        break;
      case 909:                                           // 岩石（:77226-77230,3/48/54/599/909 共组）
        game.playSfx('dig', 1, this.cx, this.cy);
        for (let i = 0; i < 10; i++) {
          game.spawnDust?.(this.x, this.y, this.w, this.h, 1,
            this.vx * 0.1, this.vy * 0.1, 0, null, 0.75);
        }
        break;
      case 31:                                            // 沙球（:77814-77819,31/42 共组）
        game.playSfx('dig', 1, this.cx, this.cy);
        for (let i = 0; i < 5; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 32);
          if (d) { d.vx *= 0.6; d.vy *= 0.6; }
        }
        break;
      case 472:                                           // 诅咒颅（:74805-74813）
        for (let i = 0; i < 20; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 30);
          if (!d) break;
          d.noGravity = true;
          d.vx = d.vx * 0.45 + this.vx * 0.9;
          d.vy = d.vy * 0.45 + this.vy * 0.9;
        }
        break;
      case 501: {                                         // 蝇瓶体毒爆（:74219-74251）
        game.playSfxWav?.('Shatter', 1, this.cx, this.cy);   // PlaySound(13)=Shatter
        for (let i = 0; i < 20; i++) {
          const d = game.spawnDust?.(this.x - 20, this.y - 20, this.w + 40, this.h + 40,
            188, 0, 0, 100, null, 1.5);
          if (d) { d.vx *= 0.5; d.vy *= 0.5; }
        }
        for (let i = 0; i < 5; i++) {
          const g = GorePiece.newGore(435 + Math.floor(Math.random() * 3),   // Next(435,438)
            this.x - 20 + Math.random() * (this.w + 40),
            this.y - 20 + Math.random() * (this.h + 40), 0, 0);
          if (g) {
            const qx = i === 0 || i === 2 ? 1 : -1;      // case0/2 X++ else X--
            const qy = i === 0 || i === 1 ? 1 : -1;      // case0/1 Y++ else Y--
            g.vx = (g.vx * 0.5 + qx) * 0.5;              // ×0.5（switch 前）→ ±1 → ×0.5（尾）
            g.vy = (g.vy * 0.5 + qy) * 0.5;
          }
        }
        break;
      }
      case 436:                                           // 火星弹（:74894-74902）
        for (let i = 0, n = 5 + Math.floor(Math.random() * 5); i < n; i++) {
          const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 220, 0, 0, 100, null, 0.5);
          if (!d) break;
          d.vx *= 1.6; d.vy = d.vy * 1.6 - 1;
          d.x = (d.x + this.cx) / 2; d.y = (d.y + this.cy) / 2;   // Lerp(position,Center,0.5)
        }
        break;
      case 115: {                                         // 三叉戟（:78774-78792）
        game.playSfxFiles?.(['Item_10'], 1, this.cx, this.cy);
        for (let k = 4; k < 31; k++) {
          const bx = this.x - this.ovx * (30 / k);        // position − oldVel×(30/k)
          const by = this.y - this.ovy * (30 / k);
          const dA = game.spawnDust?.(bx, by, 8, 8, 27, this.ovx, this.ovy, 100, null, 1.4);
          if (dA) { dA.noGravity = true; dA.vx *= 0.5; dA.vy *= 0.5; }
          const dB = game.spawnDust?.(bx, by, 8, 8, 27, this.ovx, this.ovy, 100, null, 0.9);
          if (dB) { dB.vx *= 0.5; dB.vy *= 0.5; }
        }
        break;
      }
      case 581:                                           // 破甲刺（:73993-74003）
        for (let i = 0; i < 30; i++) {
          const dt = Math.random() < 2 / 3 ? 229 : 161;    // SelectRandom(229,229,161)
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, dt);
          if (!d) break;
          d.noGravity = true; d.noLight = true;
          d.scale = 1.25 + Math.random();
          d.fadeIn = 0.25;
          d.vx *= 2; d.vy *= 2;
        }
        break;
      case 920:                                           // 史莱姆箭矢（:72761-72770）
        for (let i = 0; i < 6; i++) {
          const ang = i * Math.PI * 2 + Math.random() * Math.PI;   // UnitY.RotatedBy(i2π+rand·π)
          const spd = 2 + Math.random() * 0.5;
          const px = this.x + this.w * Math.random();      // position + Size×randSquare(0,1)
          const py = this.y + this.h * Math.random();
          const d = game.spawnDust?.(px, py, 4, 4, 4, -Math.sin(ang) * spd, Math.cos(ang) * spd,
            80, { r: 78, g: 136, b: 255, a: 150 }, 1.5);
          if (d) d.noGravity = true;
        }
        break;
    }
  }

  /** 303 骷髅火箭 Kill（Projectile.Kill :79827 组:128×128 伤害盒 + 22 盒烟尘/火/Gore +
   *  SoundID.Item14;不炸地形——不在 ExplodeTiles 表 cs:75262）。
   *  75 HappyBomb 同组(:80070-80123):Kill 内自带 Resize(128,128)+damage=60/kb8+Damage
   *  (:80116-80123)。★R7 清偿（2026-09-03）：AoE 判定面真吃 128 盒——原版伤害链 =
   *  AI_016 hostile∧timeLeft≤3 先 Resize(128,128) Center 对齐（:48017-48025）→ 同拍
   *  Kill（:48030-48037）→ Kill 内 aiStyle16 组 PrepareBombToBlow+Damage()（:71782-
   *  71792;PrepareBombToBlow :47629-47711 的 128 表 :47686-47690 只收 133-138/338/339/
   *  930 不含 303 → 303 盒径来自 AI 预扩）。曾外层 128 门 + 内层 hitPlayer 仍按未扩
   *  14×14 弹盒 projOverlap → 盒缘命中（AoE 面）实不落。修法 = 改写 self 盒再进
   *  hitPlayer（curse596Kill :1594 同款模式）→ immune 门/DamageVar/banner/cold/难度×2
   *  全链在 128 盒上跑；SP Kill 口（寿终/撞块/接触/proxKill）与 MP destroy 镜像口
   *  共用本函数 → 两面同修 */
  private rocketKill(game: GameHooks): void {
    this.dead = true;
    const st = this.projId ? DART_STYLE[this.projId] : undefined;
    const cx = this.cx, cy = this.cy;
    game.playSfxFiles(['Item_14'], 1, cx, cy);
    // ★R8 M3（2026-09-03）火尘两批补齐 + 尘面按组拆分（★任务单"303/75 共用 Kill 组"
    //  与反编译不符——75 不在 :79827 组,另落 :80070 组,逐参按原文修）：
    //  · 303 组（:79827 type∈{133-138,303,338,339,930}）：盒 22×22（:79837-79842 手写
    //    position±width/2）+ 30×d31(α100,scale1.5,×1.4 :79843-79847) + 单环内两批火尘
    //    共 40 粒（:79848-79855,同环交错出生）：20×d6(0,0,α100,scale3.5,noGravity,×7)
    //    + 20×d6(0,0,α100,scale1.5,重力开,×3)
    //  · 75 组（:80070 type∈{28,30,37,75,102,164,397,516,517,519}）：Resize(22,22)
    //    + 20×d31(:80079-80083) + 10×d6(α100,scale2.5,noGravity,×5)+10×d6(α100,
    //    scale1.5,×3) 共 20 火粒(:80084-80091) + 4×gore 单轮 ×0.4(:80092-80107)
    //  ★R9（2026-09-03）烟/gore 切真通道（O 批"泛色近似 30/20 粒 spawnParticles
    //  '#9A9A9A' + gore 8 粒泛色 '#D8D8D0'"清偿）：
    //  · d31 烟 = spawnDust 真尘 NewDust(position,22,22,31,0,0,100,default(Color),1.5)
    //    → 后置覆写仅 velocity×=1.4 一项(:79846/80082;两组同参,粒数 30/20 差)
    //  · gore = GorePiece.newGore(Main.rand.Next(61,64)=61-63 烟团) 初速 default(Vector2)
    //    ——NewGore 内建扰动 vy-=Next(10,31)×0.1/vx+=Next(-20,21)×0.1 走 newGore 非
    //    perfect 缺省路径(Gore.cs:1346-1348)→ velocity×=0.4(303 第二轮 0.8)→ X±1/Y±1
    //    四向对角序 (++)(--,++)(++ ,--)(--,(:79863-79878/80092-80107);出生位 = 22×22
    //    盒左上(:79837-79842 手写式;:80073 Resize 保心 P.cs:22556-22562 同位)
    const is75Group = this.projId === 75;
    for (let n = 0; n < (is75Group ? 20 : 30); n++) {                       // :79843-79847 / :80079-80083
      const s = game.spawnDust?.(cx - 11, cy - 11, 22, 22, 31, 0, 0, 100, null, 1.5);
      if (s) { s.vx *= 1.4; s.vy *= 1.4; }
    }
    for (let n = 0; n < (is75Group ? 10 : 20); n++) {
      // 火 6：NewDust 初速 (0,0)（纯内建抖动）→ 后置 noGravity/×7(×5) 与第二粒 ×3，
      // 池内烟雾族特例(d6 vy 重掷/vx×0.3/scale×0.7)与原版 Dust.cs 同构,先于本乘区
      const f1 = game.spawnDust?.(cx - 11, cy - 11, 22, 22, 6, 0, 0, 100, null, is75Group ? 2.5 : 3.5);
      if (f1) {
        f1.noGravity = true;
        f1.vx *= is75Group ? 5 : 7; f1.vy *= is75Group ? 5 : 7;
      }
      const f2 = game.spawnDust?.(cx - 11, cy - 11, 22, 22, 6, 0, 0, 100, null, 1.5);
      if (f2) { f2.vx *= 3; f2.vy *= 3; }
    }
    // gore 61-63 烟团：303 两轮（×0.4 / ×0.8 各 4 向共 8 片）,75 单轮（×0.4 共 4 片）;
    // 四向对角序 (++)(--,++)(++ ,--)(--,:79863-79878 / :80092-80107)
    const goreDirs: ReadonlyArray<readonly [number, number]> = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const gMult of (is75Group ? [0.4] : [0.4, 0.8])) {
      for (const [sx, sy] of goreDirs) {
        const g = GorePiece.newGore(61 + Math.floor(Math.random() * 3),   // Main.rand.Next(61,64)
          cx - 11, cy - 11, 0, 0);            // default(Vector2) 初速;内建扰动在非 perfect 支
        if (g) {
          g.vx *= gMult; g.vy *= gMult;       // velocity *= 0.4f / 0.8f
          g.vx += sx; g.vy += sy;             // velocity.X++/-- ; velocity.Y++/--
        }
      }
    }
    // 伤害盒 = Resize(128,128) Center 对齐（:48017-48025 position±width/2 手写式）,
    // 消费口 = Kill 内 Damage()（:71792;75 显式段 :80116-80123 同盒径）
    this.x = cx - 64; this.y = cy - 64; this.w = 128; this.h = 128;
    hitPlayer(this, game, st?.rocketDmg ?? this.damage);
  }

  /** ★2026-09-01 批四（T1/H1）：596 沙漠幽焰 Kill 段（Projectile.cs:73762-73794）——
   *  盒保心扩 60×60 + damage=30（Main.expertMode→22 :73766-73771）→ Damage()
   *  （=hitPlayer：60×60 受理盒，projOverlap/hitPlayer 实时读 w/h/damage；难度乘区
   *  hostileDamageScaling×2 在 hitPlayer 下游 P.cs:14912-14917，同原版）+ Item14 +
   *  4×尘31(scale1.5,α100,UnitY.RotatedByRandom(π)×rand×30 定位) +
   *  20×尘27(scale2.5,noGravity,×2) + 10×尘31(UnitX 向 vAng 旋,noGravity,×2)。
   *  原版唯一死亡路径=timeLeft 尽（tileCollide=false/飞行伤 0）——本仓载体接触/
   *  撞块死亡面（飞行伤 baseDamage + DART_STYLE 596 无 noTile 档，批四报告登记）
   *  同样收口到本爆，避免「哑灭」。 */
  private curse596Kill(game: GameHooks): void {
    this.x = this.cx - 30; this.y = this.cy - 30; this.w = 60; this.h = 60;   // :73763-73765
    this.damage = mainExpertMode(game.world) ? 22 : 30;                       // :73766-73771
    hitPlayer(this, game, this.damage);                                       // Damage() :73772
    game.playSfxFiles(['Item_14'], 1, this.cx, this.cy);                      // :73773
    const cx596 = this.cx, cy596 = this.cy;
    for (let n = 0; n < 4; n++) {                                             // :73774-73780
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
      if (d) {
        const a = (Math.random() * 2 - 1) * Math.PI;       // UnitY.RotatedByRandom(π)
        const dist = Math.random() * 30;                   // ×NextDouble×width/2
        d.x = cx596 + -Math.sin(a) * dist;
        d.y = cy596 + Math.cos(a) * dist;
      }
    }
    for (let n = 0; n < 20; n++) {                                            // :73781-73787
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 27, 0, 0, 0, null, 2.5);
      if (d) {
        const a = (Math.random() * 2 - 1) * Math.PI;
        const dist = Math.random() * 30;
        d.x = cx596 + -Math.sin(a) * dist;
        d.y = cy596 + Math.cos(a) * dist;
        d.noGravity = true;
        d.vx *= 2; d.vy *= 2;
      }
    }
    const vAng = Math.atan2(this.vy, this.vx);             // velocity.ToRotation()
    for (let n = 0; n < 10; n++) {                                            // :73788-73794
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 0, null, 1.5);
      if (d) {
        const a = (Math.random() * 2 - 1) * Math.PI + vAng;   // UnitX.RotatedByRandom(π).RotatedBy(vAng)
        const dist = Math.random() * 30;
        d.x = cx596 + Math.cos(a) * dist;                  // UnitX.RotatedBy(a)=(cos a, sin a)
        d.y = cy596 + Math.sin(a) * dist;
        d.noGravity = true;
        d.vx *= 2; d.vy *= 2;
      }
    }
    this.dead = true;
  }

  /** ★① 290 暗影束束段铺撒（Spawn_Shadowbeam 敌版 :1987-2000 + SpawnHelper_SpawnInLine
   *  :2002-2034）：从锚点(sb290Ax/Ay)到当前心按步距 max(4,|v|) 铺点,每步 3×d173
   *  （本位/−dir·0.03334|v|/−dir·0.06668|v|——敌版 velocityScalar=0.03334,友版 294
   *  的 0.25 别值,ParticleOrchestrator.cs:1989-1993）、scale rand(70..110)×0.013、
   *  尘速 ×0.2。视觉本体走 fx/orchestraFx.shadowbeamLineFx（消费端共体,hostile 档） */
  private beam290Segment(game: GameHooks): void {
    shadowbeamLineFx(game, this.sb290Ax, this.sb290Ay, this.cx, this.cy,
      Math.hypot(this.vx, this.vy), true);
  }

  /** ★① 290 Kill（Projectile.cs:71825-71870 aiStyle48 组）：锚点→死亡位再铺一次束
   *  （localAI[0]>=delay(3) 且锚点>0 门,:71835-71859——290 恒 ShadowbeamHostile 型）
   *  + module8 联机中继。死亡面=寿终/InWorld 内缘越界（:28610-28614） */
  private killBeam290(game: GameHooks): void {
    if (this.sb290L0 >= 3 && this.sb290Ax > 0 && this.sb290Ay > 0) {
      this.beam290Segment(game);
      game.broadcastParticleOrchestra?.(ParticleOrchestraType.ShadowbeamHostile,
        this.cx, this.cy, this.sb290Ax, this.sb290Ay,
        Math.round(Math.hypot(this.vx, this.vy) * 1000));
    }
    this.dead = true;
  }

  /** ★② 291 地狱火弹 Kill（Projectile.cs:75802-75807）：owner 门（单机恒真）内
   *  原位 NewProjectile 292（速度 0、同 damage、同 kb）——爆区实体承接持续伤害,
   *  取代旧 rocket:65 通用爆（原版 291 Kill 无爆炸尘/音,纯 spawn 转接）。死亡面 =
   *  越点引爆（:28748-28756）/寿终 timeLeft 300（HardmodeDungeonSkeletonShot,
   *  NewProjectileModifiers.cs:5-8）。★MP：本口=房主/单机权威生成位;访客傀儡 291
   *  不跑本链（netPuppet 早退）,由 destroy 镜像口承接——两口共用 if291Mirrored 幂等 */
  private inferno291Kill(game: GameHooks): void {
    this.dead = true;
    this.if291Mirrored = true;
    const blast = new InfernoHostileBlast(this.cx, this.cy, this.damage);
    (game as unknown as { entities: { add(e: unknown, b: string): void } })
      .entities.add(blast, 'projectiles');
  }

  /** ★292 联机访客镜像口（2026-09-02 缺口清偿；★2026-09-03 同构族扩面 303/75/596）。
   *  架构事实链：敌弹是房主权威弹（NPC AI 房主独算）→ 快照 kind2|0x80（netProjBroadcast
   *  Dart 支）→ 访客傀儡 netPuppet 早退不跑 AI/不跑 Kill 链 → 访客端无消亡衍生面
   *  （292 爆区/火箭爆/596 寿终爆——房主侧衍生弹 292 无 projId 走 kind<0"未知弹幕类
   *  不同步"通道,永不下发）。修法=借房主消亡权威事件镜像重建：msg28 ProjDespawn
   *  （netRemoveProjPuppets）/ 180t 未 seen 超时清扫两路均置 dead=true →
   *  Entity.compact 的 destroy 钩（本函数）→ 本地复放 Kill 面。同构族清单
   *  （Dart 载体全 Kill 面 2026-09-03 系统扫定谳——带【对玩家伤害】的仅此四型）：
   *   · 291 → 原位 spawn 292 爆区（Projectile.Kill :75802-75807）
   *   · 303/75 → rocketKill 爆炸盒 128×128（:79827 组 133-138/303 支 / :80070+75 支,
   *     75 爆炸伤 60 走 rocketDmg 覆写 :80116-80122）
   *   · 596 → curse596Kill 盒 60×60 伤 30/22（:73762-73794,伤害按本地难度重算非快照）
   *  位置=傀儡最后一拍快照跟随位（≈引爆点,快照窗内 ≤4t 位移;128/130 盒覆盖余量）；
   *  伤害=快照 dmg=房主终伤（与本地 Kill 口同源;596 例外见 curse596Kill）。
   *  衍生面各端本地镜像自算（hostile 盒对本地玩家 hitPlayer,victim-settles 同构;
   *  位置差/接触+爆双响由 player.iframes 去重对齐原版 immune 门）。
   *  幂等：本地 Kill 口已置对应镜像旗（房主路径绝不双生成）；!netPuppet 直拒
   *  （房主/单机唯一生成权在 Kill 口）；180t 超时误杀窗=快照断流退化面（位置可能
   *  滞后,登记不修——原版该弹本就 client 消亡近似） */
  destroy(): void {
    if (!this.netPuppet || !this.lastGame) return;
    const g = this.lastGame;
    if (this.projId === 291 && !this.if291Mirrored) {
      this.if291Mirrored = true;
      const blast = new InfernoHostileBlast(this.cx, this.cy, this.damage);
      (g as unknown as { entities: { add(e: unknown, b: string): void } })
        .entities.add(blast, 'projectiles');
      return;
    }
    if ((this.projId === 303 || this.projId === 75) && !this.ifRocketMirrored) {
      this.ifRocketMirrored = true;
      this.rocketKill(g);            // 爆炸盒+尘音（Kill :79827 组/75 :80070 组复放）
      return;
    }
    if (this.projId === 596 && !this.if596Mirrored) {
      this.if596Mirrored = true;
      this.curse596Kill(g);          // 寿终爆盒 60×60（:73762-73794 复放）
    }
  }

  /** 无表项通用弹（projId=0 历史路径）:直线+撞块消亡 */
  private legacyStep(game: GameHooks): void {
    this.x += this.vx;
    this.y += this.vy;
    const tx = Math.floor(this.cx / TILE);
    const ty = Math.floor(this.cy / TILE);
    if (game.world.store.isSolid(tx, ty)) { this.dead = true; return; }
    if (projOverlap(this.x, this.y, this.w, this.h, game.player) && !game.player.dead) {
      hitPlayer(this, game, this.damage);
      this.dead = true;
    }
  }

  // ===========================================================================
  // G3 宿主绑定弹（2026-08-19）：411→537 激光 / 424→573 蓄能弹。
  // 原版 NPC 发射把 whoAmI 传 NewProjectile 末参（落 ai[1]），弹体按 id+type 回查
  // 宿主（Main.npc[i].active && type==N 的双门）——单人真实行为（非 netcode）：
  //  · 537（aiStyle84，1458 P.cs:31969-31975 锁位支/:32044-32052 ≥90t Kill）：
  //    束原点逐 t 锁回活宿主 Center+(direction*6,−4)；★宿主死即灭（台账 A2 清偿,
  //    2026-08-31）——aiStyle84 链的位锁 if/else 链全部落空时进尾支
  //    `if (type != 632 || !TryGetActive(633)) { Kill(); return; }`(:31993-31999),
  //    type==537 不等于 632 → 下拍立即 Kill、不残留束线伤害。旧注"解除锁定原地
  //    照完剩余寿命"系把 455 专属前置支误读成全族语义。UpdatePosition 跳过表含
  //    aiStyle84 → 永不积分位移，velocity 只当束向单位向量。
  //  · 573（aiStyle102 case573，:32040-32280）：蓄能 90t（悬停漂移+隐形 alpha255+
  //    尘 242）；宿主死中途 → ai[0]=90 当 t 齐射（目标 Player.FindClosest 兜底）；
  //    宿主活 → 继承其目标。齐射 = ±50 抖动 ×0.8-1.2 距离档、速 20；此后 alpha0
  //    显形、rotation 随弹向 0.4 lerp。UpdatePosition 不跳过 → 每 t position+=velocity。
  // ===========================================================================

  /** 537 观星者激光单步（aiStyle84）：见上注。命中 = 玩家矩形 vs 束线段宽
   *  22·scale（Colliding :14703 CheckAABBvLineCollision）；伤害走敌弹标准乘区
   *  （难度×2，:13770-13781——hitPlayer 同式，此处在束判定内联） */
  private stargazerBeamStep(game: GameHooks): void {
    this.age++;
    if (this.age >= 90) { this.dead = true; return; }          // localAI[0]>=90 Kill（:32048-32051）
    const vl = Math.hypot(this.vx, this.vy) || 1;
    const dirX = this.vx / vl, dirY = this.vy / vl;
    this.vx = dirX; this.vy = dirY;                            // 归一（束向）
    this.rot = Math.atan2(dirY, dirX) - Math.PI / 2;           // rotation = num731 − π/2
    // ★A2 清偿（2026-08-31）：宿主失联（死亡/消失/换型）= 位锁链尾支 → 本拍先于
    // 一切束效果/伤害直接 Kill（:31993-31999），不再残留束线伤害
    const host = this.hostOf(game, 411);
    if (!host) { this.dead = true; return; }
    this.x = host.cx + host.facing * 6 - this.w / 2;
    this.y = host.cy - 4 - this.h / 2;
    this.scale = Math.min(0.8, Math.sin((this.age * Math.PI) / 90) * 10 * 0.8);  // :32052-32056
    // 束长：Collision.LaserScan 2 采样（num703=0 → 宽 0 同点）取均值，0.5/t Lerp
    // （实参 :32145/:32152-32166,消账 B5——曾以 8px 步进测距,端点恒差半步量化）
    const scanAvg = laserScanTiles(game, this.cx, this.cy, dirX, dirY,
      0 * this.scale, 2400, 2);
    this.beamLen += ((scanAvg[0] + scanAvg[1]) / 2 - this.beamLen) * 0.5;
    // 光照 PlotTileLine (0.4,0.85,0.9)（:30612-30613）：沿束向逐格三线带（中±半宽）
    const half = (22 * this.scale) / 2;
    for (let d = 0; d <= this.beamLen; d += TILE) {
      game.addLightAt?.(this.cx + dirX * d, this.cy + dirY * d, 0.4, 0.85, 0.9);
      game.addLightAt?.(this.cx + dirX * d - dirY * half, this.cy + dirY * d + dirX * half, 0.4, 0.85, 0.9);
      game.addLightAt?.(this.cx + dirX * d + dirY * half, this.cy + dirY * d - dirX * half, 0.4, 0.85, 0.9);
    }
    // 束端尘（AI_084 537 支 :32246-32268,每 update）——★尘站普查批（2026-09-16）
    //  泛色 spawnBurst 退役改真尘站 1:1：
    //  · num721 = Clamp(Lerp(0,1,localAI[0]/30))（age/30 渐强）;束端 vector73 =
    //    Center + 弹速×(localAI[1]−8)（velocity 归一 ×1,beamLen=localAI[1]）;
    //  · 锥形 d226 ×int(2×num721)：束角 ±π/2 随机侧,速率 rand(0..1)×0.8+1,
    //    NewDust(束端,0,0,226,侧向速度) → noGravity+scale=1.2（整写）;
    //  · 束缘 d31 1/(5..10) 掷：maxValue2 = 5+int((1−num721)×5),掷中 →
    //    弹速 RotatedBy(π/2)×(rand−0.5)×width 侧偏,NewDust(束端+侧偏−(4,4),8,8,31,
    //    α100,scale1.5) → vel×0.5、vel.Y = −|vel.Y|（上浮）
    const prog = Math.min(1, Math.max(0, this.age / 30));
    const tipX = this.cx + dirX * (this.beamLen - 8), tipY = this.cy + dirY * (this.beamLen - 8);
    const n226 = Math.floor(2 * prog);                       // (int)(2f×num721)
    for (let k = 0; k < n226; k++) {
      const da = Math.atan2(dirY, dirX) + (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2);
      const mag = Math.random() * 0.8 + 1;                   // NextDouble×0.8+1
      const d = game.spawnDust?.(tipX, tipY, 0, 0, 226, Math.cos(da) * mag, Math.sin(da) * mag);
      if (d) { d.noGravity = true; d.scale = 1.2; }
    }
    const gate31 = 5 + Math.floor((1 - prog) * 5);           // 5..10
    if (Math.floor(Math.random() * gate31) === 0) {
      const rotV = dirX * Math.cos(Math.PI / 2) - dirY * Math.sin(Math.PI / 2);   // RotatedBy(π/2)
      const rotVY = dirX * Math.sin(Math.PI / 2) + dirY * Math.cos(Math.PI / 2);
      const side = (Math.random() - 0.5) * this.w;          // (rand−0.5)×width
      const bx = tipX + rotV * side - 4, by = tipY + rotVY * side - 4;
      const d31 = game.spawnDust?.(bx, by, 8, 8, 31, 0, 0, 100, null, 1.5);
      if (d31) {
        d31.vx *= 0.5; d31.vy *= 0.5;
        d31.vy = -Math.abs(d31.vy);
      }
    }
    // 命中（:14703）：线段 Center→Center+dir·len，宽 22·scale；iframes 由
    // damagePlayer→Player.damage 内建去重（对应原版 player.immune 门）
    const p = game.player;
    if (p && !p.dead && p.iframes <= 0
      && segHitsRect(this.cx, this.cy, dirX * this.beamLen, dirY * this.beamLen,
        22 * this.scale, p)) {
      game.damagePlayer(
        hostileProjectileDamage(this.damage, mainDifficulty(game.world)) * 2,
        this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: this.projId });   // ★R-B-F10(第4=knockback 位,opts 第5)
    }
  }

  /** 573 预言者蓄能弹单步（aiStyle102 case573：num850=424/num851=90/num854=20/
   *  flag47=false/flag48=true/flag49=false，:32064-32068）。蓄能期隐形（alpha255）
   *  纯尘视觉；弹体永不积分旋转（aim lerp 是 574 专属分支，:32160-32173） */
  private oracleOrbStep(game: GameHooks): void {
    if (--this.life <= 0) { this.dead = true; return; }        // timeLeft 600（SetDefaults）
    this.age++;                                                // ai[0] 计数
    const host = this.hostOf(game, 424);
    if (this.age < 90) {
      // 蓄能期（:32086-32128）：宿主活 → 原地微漂（flag48=true 不跟随宿主位移）；
      // 宿主死 → ai[0]=90 当 t 转入齐射分支（:32092-32094 else）
      if (!host) this.age = 90;
      else {
        this.alpha = 255;                                      // :32112 隐形
        // 蓄能尾尘（:33937-33944,1/2 掷）——★尘站普查批（2026-09-16）泛色
        //  spawnParticles 退役改真尘站：NewDust(Center,8,8,242) → position=Center
        //  整覆写、velocity=弹速（蓄能期原地 → 近零）、noGravity、scale=1.5（整写）
        if (Math.random() < 0.5) {
          const d = game.spawnDust?.(this.cx, this.cy, 8, 8, 242, this.vx, this.vy);
          if (d) {
            d.x = this.cx; d.y = this.cy;
            d.noGravity = true;
            d.scale = 1.5;
          }
        }
      }
    }
    if (this.age === 90) {
      // 齐射（:32172-32210）：目标 = 宿主活→宿主目标（单玩家）/ 死→FindClosest
      //（同为玩家实体）；±50 双轴抖动 ×(0.8..1.2) 距离档，归一 ×20
      const p = game.player;
      if (p) {
        let ax = p.cx - this.cx + (Math.floor(Math.random() * 101) - 50);
        let ay = p.cy - this.cy + (Math.floor(Math.random() * 101) - 50);
        ax *= (80 + Math.floor(Math.random() * 41)) * 0.01;
        ay *= (80 + Math.floor(Math.random() * 41)) * 0.01;
        const al = Math.hypot(ax, ay);
        if (al > 0.001) { this.vx = (ax / al) * 20; this.vy = (ay / al) * 20; }
        else { this.vx = 0; this.vy = -20; }                    // NaN 退化（原版 UnitY）
      }
    }
    if (this.age < 90) { this.x += this.vx; this.y += this.vy; return; }
    // 齐射后（:32218-32232）：显形 alpha0、rotation 随弹向 0.4 lerp——★尘站普查批
    //  （2026-09-16）泛色退役改真尘站：释放尾尘 242 ×1/4（:34054-34062,NewDust
    //  (Center,8,8,242) 无位覆写=8×8 盒内随机、vel×0.2、noGravity、scale=1.5 整写）
    this.alpha = 0;
    this.rot += (Math.atan2(this.vy, this.vx) + Math.PI / 2 - this.rot) * 0.4;
    if (Math.random() < 0.25) {
      const d = game.spawnDust?.(this.cx, this.cy, 8, 8, 242);
      if (d) {
        d.vx *= 0.2; d.vy *= 0.2;
        d.noGravity = true;
        d.scale = 1.5;
      }
    }
    this.x += this.vx; this.y += this.vy;
    // 撞实心（tileCollide 默认 true）：TileCollision 语义 = 速度截停（粘墙不灭）
    const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
    if (game.world.store.isSolid(tx, ty)) { this.vx = 0; this.vy = 0; }
    // 命中（penetrate −1 穿透不消耗）：iframes 去重后每 40t 一跳
    const p = game.player;
    if (this.hostile && p && !p.dead && p.iframes <= 0
      && projOverlap(this.x, this.y, this.w, this.h, p)) {
      game.damagePlayer(
        hostileProjectileDamage(this.damage, mainDifficulty(game.world)) * 2,
        this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: this.projId });   // ★R-B-F10
    }
  }

  /** 宿主回查（原版 Main.npc[ai[1]].active && type==N 双门）：id + 未死 + 型号 */
  private hostOf(game: GameHooks, type: number):
    { cx: number; cy: number; facing: number } | undefined {
    if (!this.ownerNpcId) return undefined;
    const list = game.enemies() as Array<{ id: number; dead: boolean; vanillaId?: number | null;
      cx: number; cy: number; facing: number }>;
    const n = list.find((e) => e.id === this.ownerNpcId);
    return n && !n.dead && n.vanillaId === type ? n : undefined;
  }

  // ---- 原版 Projectile 字段映射 ----
  private age = 0;          // ai[0]/localAI 计数
  private tick = 0;         // 拖尾节拍
  /** oldVelocity 快照（Update :17118,dartStep 头刷新;115 尘站尘速消费） */
  private ovx = 0;
  private ovy = 0;
  /** 115 三叉戟 localAI[1] 镜像（AI_027 :26814 首拍置 5/:26852 计满 15 门） */
  private ai115L1 = 0;
  private rot = 0;          // projectile.rotation
  private alpha = 0;        // projectile.alpha(255=全透明,渐入)
  private scale = 1;        // projectile.scale
  private frame = 0;        // 多帧行帧号(909/836)
  private dir = 1;          // projectile.direction(旋转符号)
  private pulseDir = 0;     // 115 呼吸相位
  /** 814 血弹 oldPos 快照带（★R4 T4-①：原版 Projectile.oldPos 10 深；本仓 Dart 无
   *  该带,于 811/814 AI 段每拍 unshift 当前位。★G′ T5 勘误：原版 oldPos[0]=position
   *  写入在 Update【尾】（TrailingMode[814]=2,P.cs:17234-17245 post-move）且出生位
   *  从不写入——本仓 unshift 在位移【前】取 pre-move 位,hist[i]=i 拍前位比原版带
   *  长一槽（含出生位 P0）;差账由消费侧上界 min(9,age−2) 剪除（见 dartStep 814 环）。
   *  hist[0]=本拍起点,hist[i]=i 拍前位） */
  private trailHist: Array<{ x: number; y: number }> = [];
}

// =============================================================================
// Collision.LaserScan / HitLine（537 束长测距,2026-08-31 台账 B5 清偿）
// 原 C#：Collision.cs:4599-4614(LaserScan) + :782-1147(HitLine);曾用 8px 步进
// 测距近似——原版端点量化在整格 Bresenham 且距离按格距×16 返回,步进式结果存在
// 半步级系统差。
// =============================================================================

interface ScanStore {
  inBounds(x: number, y: number): boolean;
  isSolid(x: number, y: number): boolean;
  readonly w: number;
  readonly h: number;
}

/** HitLine(Collision.cs:782-1147) 整格 Bresenham 粗扫逐字移植。
 *  返回 true 的面：①撞到实心(含"行进方向侧邻格",LaserScan 的 ignoreX/Y=0 使
 *  方向门全开)——col=命中格;②自然走到钳后终点——col=终点格。
 *  返回 false 面：越界邻格(null 面)——col=该越界点,LaserScan 照样按起点→col
 *  格距折算 px。ignoreTargets 恒空表不建模 */
function dartHitLine(st: ScanStore, x1: number, y1: number, x2: number, y2: number,
  out: { col: [number, number] }): boolean {
  // Utils.Clamp 到 [1,maxTilesX-1] / [1,maxTilesY-40]
  let value = x1 < 1 ? 1 : x1 > st.w - 1 ? st.w - 1 : x1;
  let value2 = y1 < 1 ? 1 : y1 > st.h - 40 ? st.h - 40 : y1;
  const tx2 = x2 < 1 ? 1 : x2 > st.w - 1 ? st.w - 1 : x2;
  const ty2 = y2 < 1 ? 1 : y2 > st.h - 40 ? st.h - 40 : y2;
  const num = Math.abs(value - tx2);
  const num2 = Math.abs(value2 - ty2);
  if (num === 0 && num2 === 0) {
    out.col = [value, value2];
    return true;
  }
  let num3 = 1;
  let num4 = 1;
  if (num === 0 || num2 === 0) {
    if (num === 0) num3 = 0;
    if (num2 === 0) num4 = 0;
  } else if (num > num2) {
    num3 = num / num2;
  } else {
    num4 = num2 / num;
  }
  let num5 = 0;                                   // case2(X 步)分数累加
  let num6 = 0;                                   // case1(Y 步)分数累加
  let phase = value2 < ty2 ? 2 : 1;
  let num8 = Math.trunc(num);                     // X 剩余步
  let num9 = Math.trunc(num2);                    // Y 剩余步
  const num10 = Math.sign(tx2 - value);
  const num11 = Math.sign(ty2 - value2);
  let flag = false;
  let flag2 = false;
  do {
    if (phase === 2) {
      num5 += num3;
      const num13 = Math.trunc(num5);
      num5 -= num13;
      for (let j = 0; j < num13; j++) {
        // 行邻格(null=越界面直接折返)
        if (!st.inBounds(value, value2 - 1)) { out.col = [value, value2 - 1]; return false; }
        if (!st.inBounds(value, value2 + 1)) { out.col = [value, value2 + 1]; return false; }
        // 方向侧邻格实心(LaserScan ignoreY=0:方向门恒开)
        if (num11 < 0 && st.isSolid(value, value2 - 1)) { out.col = [value, value2 - 1]; return true; }
        if (num11 > 0 && st.isSolid(value, value2 + 1)) { out.col = [value, value2 + 1]; return true; }
        // 本格实心
        if (st.isSolid(value, value2)) { out.col = [value, value2]; return true; }
        if (num8 === 0 && num9 === 0) { flag = true; break; }
        value += num10;
        num8--;
        if (num8 === 0 && num9 === 0 && num13 === 1) flag2 = true;
      }
      if (num9 !== 0) phase = 1;
    } else {
      num6 += num4;
      const num12 = Math.trunc(num6);
      num6 -= num12;
      for (let i = 0; i < num12; i++) {
        if (!st.inBounds(value - 1, value2)) { out.col = [value - 1, value2]; return false; }
        if (!st.inBounds(value + 1, value2)) { out.col = [value + 1, value2]; return false; }
        if (num10 < 0 && st.isSolid(value - 1, value2)) { out.col = [value - 1, value2]; return true; }
        if (num10 > 0 && st.isSolid(value + 1, value2)) { out.col = [value + 1, value2]; return true; }
        if (st.isSolid(value, value2)) { out.col = [value, value2]; return true; }
        if (num8 === 0 && num9 === 0) { flag = true; break; }
        value2 += num11;
        num9--;
        if (num8 === 0 && num9 === 0 && num12 === 1) flag2 = true;
      }
      if (num8 !== 0) phase = 2;
    }
    // 主循环尾：中心格终检(null/实心)
    if (!st.inBounds(value, value2)) { out.col = [value, value2]; return false; }
    if (st.isSolid(value, value2)) { out.col = [value, value2]; return true; }
  } while (!(flag || flag2));
  out.col = [value, value2];
  return true;
}

/** LaserScan(Collision.cs:4599-4614)：samples 个采样点沿 directionUnit±(π/2) 带
 *  samplingWidth 展开,各自从采样点格向 +maxDistance 终点跑 HitLine——
 *  走到终点(col=终点) → maxDistance;否则按「起点格→col 格距」×16 折算 px。
 *  AI_084/537 档:num703=width,samplingWidth=num703*scale、maxDistance=2400、
 *  samples=2 后取均值(:32145/:32152-32166) */
function laserScanTiles(game: GameHooks, cx: number, cy: number, dxu: number, dyu: number,
  samplingWidth: number, maxDistance: number, samples: number): number[] {
  const st = game.world.store as unknown as ScanStore;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const frac = i / (samples - 1);                       // num = i/(Length-1)
    // RotatedBy(π/2)：(x,y)→(-y,x)；偏移=(frac−0.5)*samplingWidth
    const ox = cx + (-dyu) * ((frac - 0.5) * samplingWidth);
    const oy = cy + (dxu) * ((frac - 0.5) * samplingWidth);
    const sx = Math.trunc(ox / TILE), sy = Math.trunc(oy / TILE);   // 起/终点整格化((int)v/16)
    const ex = Math.trunc((ox + dxu * maxDistance) / TILE);
    const ey = Math.trunc((oy + dyu * maxDistance) / TILE);
    const res = { col: [sx, sy] as [number, number] };
    const ok = dartHitLine(st, sx, sy, ex, ey, res);
    const dist = Math.hypot(Math.abs(sx - res.col[0]), Math.abs(sy - res.col[1])) * TILE;
    out.push(ok && res.col[0] === ex && res.col[1] === ey ? maxDistance : dist);
  }
  return out;
}

// =============================================================================
// 敌怪弹幕样式表(见 DART_STYLE)——以下为文件原有表区
// =============================================================================

/** 敌怪弹幕样式表——每条对应原版 Projectile 的 SetDefaults(Projectile.cs) + AI 行为。
 *  射击怪→弹型映射（NPC.cs 发射点行号见 Enemy.ts 各调用点注释）。
 *  旋转语义（画布与 XNA 同为顺时针正,直接套用原版公式）:
 *   align90 = rotation = atan2(vy,vx)+1.57 每更新（AI_001 通用尾 :58733 字面 1.57f,
 *             贴图静止朝上——★G10/R2-F13 字面纪律:旧 π/2 残差 0.0008rad;旧锚
 *             :54868 系陈号,1457 该行落 item 代码域）
 *   a45     = atan2+0.785 字面（115 三叉戟 AI_027 :26910-26911 原版 0.785f,非 π/4
 *             ——★F3 清偿 2026-10-14;旧锚 :24839 系 1456 世代残号）
 *   rightPi = rotation = ToRotation()+π+(direction==-1?π:0)+spriteDirection=direction
 *             每更新（AI_001 尾分派 :58640-58647 + 专属块 :55107-55119——RIGHT 族
 *             变体:基底多 π,贴图朝左本相;direction 逐拍 vx<0?-1:1 重评
 *             （AutomaticallyChangesDirection :17122-17130,aiStyle1 不在豁免表）,
 *             左飞绘制水平镜像。★G10/R2-F6:436 火星弹（曾 align90=恒 90° 偏+永不镜像））
 *   roll    = += (|vx|+|vy|)*0.03*direction（aiStyle2 :21519:471 骨头/909 岩石/300 圣锤）
 *   spin    = += rate*direction（44 魔镰 AI_018 :23814 rate 0.8 / 96 诅咒焰 AI_008 :22669 rate 0.3 /
 *             31 沙球 AI_010 :55158 rate 0.1）
 *   tilt    = rotation = vx*0.125（836 蒲公英籽 :43312）
 *   nail    = ai[0]<50 恒对齐速度向、≥50 改自旋 += direction*rate（498 铁钉
 *             :58485-58492,翻转点与重力/摩擦同支 → 经 gravDelay 复用同拍）
 *   none    = 恒 0（128 霜爆/177 冰水吐涎/288 金雨,AI_028/AI_012 无旋转更新）
 *  alpha=255 族视觉 = 渐入（302 族按 |v|*0.9 :52782,257 恒 -10 :53036,其余家族恒减） */
// ---- 31 沙球用原版 TileID → 本仓 id 换算（★本仓 tile id ≠ 原版 TileID,直比/直写
// = 永不命中或写错方块——曾硬编码 53/314/421/422/165 原版 id,2026-08-25 修正）----
const T_SAND = TILE_BY_KEY['sand'];
const T_RAIL = VANILLA_TILE_ID.get(314);          // MinecartTrack
const T_CONV_L = VANILLA_TILE_ID.get(421);        // ConveyorBeltLeft
const T_CONV_R = VANILLA_TILE_ID.get(422);        // ConveyorBeltRight
// （T_STALAC 已随 ★④ BBMSF 单源化移除——arm3 钟乳石支归 blockBelowMakesSandFall）
// 沿途击碎清单（:55106-55136 KillTile）：水晶12/雕像105/钟乳石165/裸露宝石178/
// 小石堆185/大石堆186-187/魔力水晶639/生命水晶巨石665
const SHATTER_VANILLA = [12, 105, 165, 178, 185, 186, 187, 639, 665]
  .map((v) => VANILLA_TILE_ID.get(v))
  .filter((v): v is number => v !== undefined);
const SHATTER_SET = new Set(SHATTER_VANILLA);

interface DartStyle {
  w: number; h: number;                  // 碰撞盒(SetDefaults width/height)
  scale?: number;                        // 绘制缩放(SetDefaults scale)
  rot: 'align90' | 'a45' | 'roll' | 'spin' | 'tilt' | 'none' | 'vxSpin' | 'nail' | 'rightPi';
  spinRate?: number;
  alpha0?: number;                       // 出生 alpha(255=渐入)
  fade?: 'speed' | number;               // 渐入速率
  /** 前 N 拍免衰（577/576 localAI[1]>2 门,P.cs:56603-56613——批六 m1） */
  fadeDelay?: number;
  grav?: number; gravDelay?: number; xDamp?: number;   // 重力档(ai0 门)
  vCap?: number;                                        // 垂直速度上限（31 沙球 10;非 grav 项=AI_027 块尾无条件钳,dartStep 独立支消费——115=16 :26913-26915）
  /** 侧摩（31 沙球 AI_010 ai[0]==2 :55087-55100）：vx 每 tick ±N 向 0 收 */
  xFrict?: number;
  /** 31 沙球档：沿途 KillTile 清单击碎 + 落地 PlaceTile 沙 53（:75430-75536） */
  sandBall?: boolean;
  accel?: { from: number; to: number; mul: number };   // 加速段(ai0 区间内每更新 ×mul)
  updates?: number;                      // extraUpdates(每 tick 完整更新次数)
  noTile?: boolean;                      // tileCollide=false 穿墙
  /** ★SW-FX7：tile 碰撞缩盒边长（GetCollisionParams Projectile.cs:19982-20156，
   *  中心锚）。原版 HandleMovement 的 Collision.TileCollision 用此盒而非弹体盒;
   *  缺省 = 弹体盒近似为中心格判定（逐型对拍前维持现状）。44=12（aiStyle18
   *  width−36 :20081）/ 288=10（缩盒名单 :20072） */
  tileBox?: number;
  /** ★批五：碰玩家无伤穿透不消亡（NewProjectile damage=0 的原版形态——
   *  596 沙漠幽焰飞行伤=0+penetrate=-1,唯一伤害面=寿终 Kill 爆 :73762） */
  noPlayerHit?: boolean;
  life?: number;
  trail?: { color: string; count: number; life?: number; grav?: number };
  sfx?: string[];                        // 发射音(原版 wav)
  /** ★BJ693 债④：逐条目发射音音量（缺省 0.8=表惯例档;75 HappyBomb=case66 ×0.45
   *  等原版显式系数档走本位,免每条目各建消费支） */
  sfxVol?: number;
  rocket?: number;                       // Kill 爆炸盒半宽(303)
  /** Kill 爆炸伤害覆写（75 HappyBomb:飞行伤 80,爆炸 Resize(128) 后 damage=60
   *  :80116-80122——不覆写则沿用飞行伤） */
  rocketDmg?: number;
  /** aiStyle16 炸弹族位移（75）：轴分离 + 撞块反弹（X:−lastVX×0.4 /
   *  Y:lastVY>0.7 → −lastVY×0.4,Projectile.cs:19868-19876）+ 贴地 vx×0.97 */
  bomb?: boolean;
  /** 距存活玩家中心 <N px 即 Kill 爆炸（75 :47809-47820,40px） */
  proxKill?: number;
  shrink?: number;                       // scale 递减(288)
  frameRand?: number;                    // 出生随机帧(909)
  animEvery?: number;                    // 帧动画步进(836:6 / 596:5)
  frames?: number;                       // 帧总数(596=4,Main.projFrames Main.cs:8630;836 走 hFrames 胶片)
  hFrames?: number;                      // 横向胶片列数(836=4,Frame(4,1,frame) Main.cs:33247)
  windSeed?: boolean;                    // 836 风力转向 AI
  home?: { spd: number; lerp: number; range: number };   // 293 追踪(AI_051)
  noTex?: boolean;                       // 贴图空桩,纯尘埃视觉(299)
  pulse?: boolean;                       // alpha/scale 呼吸(115)
  fallback?: string;                     // ★P0-B 2026-09-27 起退役字段（短线兜底已摘,表值留存无消费;勿再接线）
  /** DrawProjDirect 轨迹支绘前白化（Main.cs:30068 projectileColor=Lighting.GetColor
   *  格光色 → :30841-30856 Lerp(projectileColor,White,k)）——k = 本仓终值。
   *  canvas 侧以 ctx.filter brightness/saturate 近似（lerpWhiteFilter,公式同
   *  Arrow.ts drawTableAlpha lerpFilter :1941）；filter 为 ctx 级状态,消费点在
   *  Dart.draw save/restore 界内且出界显式复位,不外溢同帧其它弹 */
  whiteLerp?: number;
}

/** Lerp(色,White,k) 的 Canvas filter 近似——旧逐字照搬 Arrow.ts drawTableAlpha 内
 *  lerpFilter：k≥0.999 → brightness(2.2) saturate(0) 纯白剪影;
 *  否则 brightness 提亮（中灰 128 → 128(1−k)+255k）+ saturate 随 k 去色。
 *  ★BJ668（2026-10-12）注:Arrow 侧 lerpFilter 已改两遍制基底 brightness(1−k)
 *  （白抬升项 ×k 走 projFullbrightQueue 'lighter' 光照后复绘,saturate 摘除）——
 *  本副本维持静态滤镜近似（811/814 非本表 lerp 族,白化系数动态 Remap/静态各一;
 *  同病=抬升项被乘光,别通道登记待各自载体定谳派刀,vanillaProjAlpha 头注 BJ668 债③） */
function lerpWhiteFilter(k: number): string {
  return k >= 0.999 ? 'brightness(2.2) saturate(0)'
    : `brightness(${(1 - k + (k * 255) / 128).toFixed(2)}) saturate(${Math.max(0, 1 - k * 0.8).toFixed(2)})`;
}

/** ★BJ245（2026-09-21）：811 判镰白化系数 k=Utils.Remap(ai0,0,15,1,0.3)
 *  （Main.cs:30847;Utils.cs:345=Lerp(toMin,toMax,GetLerpValue(0,15,v,clamped))）
 *  = 1 − 0.7·clamp01(ai0/15)——ai0=0 → 1.0、15 起 → 0.3（钳尾）。
 *  ai0 写入方 = AI_001 flag3 缺省支 ai[0]++（Projectile.cs:57019-57021,排除表
 *  :56931-57018 无 811——旧注「ai[0] 全域无写入方→恒 1.0」系矛盾,勘误）；
 *  本仓 ai0 ≡ Dart.age（1 基,首拍 dartStep 头 ++;811 无 extraUpdates=1 子步/拍,
 *  与原版 ai0 逐拍 +1 精确同相）。消费双点:本文件 draw 白化 filter +
 *  Renderer.SELF_LUMINOUS_PROJS[811] 光地板（import 本函数单源防漂移）。 */
export function whiteK811(age: number): number {
  const t = age <= 0 ? 0 : age >= 15 ? 1 : age / 15;
  return 1 - 0.7 * t;
}

/** ★批六 M4 起 export：联机傀儡命中面（Game.netPuppetProjContact）按弹型查
 *  noPlayerHit（原版 Damage_EVP 头门 damage<=0 早退,P.cs:14846-14850 的表投影） */
export const DART_STYLE: Record<number, DartStyle> = {
  // 38 哈比羽毛(NPC.cs:23483 弹型 38):14×14 aiStyle1 直飞,timeLeft 300(NPC 侧覆写)
  38: { w: 14, h: 14, rot: 'align90', life: 300, fallback: '#E8E0D0' },
  // 129 符文爆弹（172 符文法师 :21228-21240）：14×14 穿墙直飞 timeLeft 300，
  //  aiStyle 28（tileCollide false / penetrate -1）——穿墙不消
  //  ★尘站普查批（2026-09-16）：泛色 trail 退役（曾每两拍任意金色 1 粒,与原版
  //  6×d106/update 不同源）——真尘站见 dartStep 129 支（P.cs:27009-27019）
  129: { w: 14, h: 14, rot: 'align90', life: 300, fallback: '#F0D060' },
  // 596 沙漠幽焰（533 沙漠精灵 :21104-21135）：8×8 aiStyle 107、timeLeft 180、
  //  tileCollide=false、penetrate=-1、α=255 渐显（NewProjectile damage=0 → noPlayerHit）。
  //  ★批六 M2：home = AI_107 共通尾（P.cs:34277-34286）——num839=40 距离门（欧氏
  //  Distance>40 才混合）+ num838=7.5（596 覆写 :34204-34205）+ num837=10 除数；
  //  消费约定 lerp=除数−1（velocity=(velocity×9+dir×7.5)/10，同表 293 档同约定）。
  //  ★homing 只在 596 AI 段 1/27 受理分支内跑（AI_107 尘环 Main.rand.Next(3)!=0 即
  //  return 吞 homing :34243-34245）——通用 home 块对 596 跳过防双算（见 dartStep）。
  //  ★批六 M3-a：projFrames[596]=4（Main.cs:8630）+ AI 每 5 拍步进（:34220-34227）。
  //  α 渐显 −25/拍（timeLeft>30 门 + 实心盒钳 128 :34208-34219）在 596 AI 段自管
  //  （通用 fade 无 timeLeft 门,对该 id 排除）；GetAlpha 消费见 draw 侧（M3-b/c）。
  //  M3-d 光照豁免（GetAlpha :80910 不读格光色=自发光）登记不修（需 post-light 通道,
  //  与 whiteLerp 残差同账）。
  596: { w: 8, h: 8, rot: 'align90', life: 180, noTile: true, noPlayerHit: true,
    alpha0: 255, animEvery: 5, frames: 4,
    home: { range: 40, spd: 7.5, lerp: 9 },
    fallback: '#9A6AF0' },   // ★FX53 普查尾修：泛色 trail 退役（尘面=AI_107 d27 环 :34243,真尘段已接）
  // 811 BloodShot（Projectile.cs:7927-7939，NPC.cs:51435 血月骑手 619/620 射弹，
  // 速15/伤35）：10×10 aiStyle1 hostile α=255 penetrate=-1 tileCollide=true；
  // fade:20=AI 每拍 α−20（:57347-57351）→13 拍渐显；
  // ★批六 M5：timeLeft 无行→3600（SetDefaults 头 :789 缺省,811/814 块无覆写;
  //  旧注"无行→600"系杜撰）；★批六 C1：载体由 Arrow(shoot) 归位 Dart——两处发射点
  //  （Enemy.ts 619 :7249 / 620 :7902）改走 spawnHostileProj,批五尘/AI/Kill 面自此可达；
  // 尘面见 dartStep 811/814 AI 段+双 Kill 口（:57340-57367/:74019-74027）；
  // 绘前白化（DrawProjDirect :30841-30848）：projectileColor =
  //   Lerp(projectileColor, White, Remap(ai[0], 0, 15, 1, 0.3))。
  //   ★BJ245 勘误（2026-09-21,反编译亲读）：AI_001 flag3 缺省支对 811 照跑
  //   ai[0]++（Projectile.cs:57019-57021,排除表 :56931-57018 无 811）——旧注
  //   「ai[0] 全域无写入方→Remap 恒取下端 k≡1.0 纯白剪影」作废。ai0=发射后
  //   update 数（本仓 Dart.age,1 基逐拍）→ k=whiteK811(age),15 拍 1.0→0.3
  //   衰减（暗处拖尾渐暗=原版相;恒 1.0=暗处偏亮偏差）。whiteLerp 由此【动态】
  //   接线（draw 消费位 whiteFilter 支）,表值不再钉 1.0（814 恒 0.35 不涉）。
  // fallback 近似血红目测（PNG 主色未取,811 撞墙即消极少见兜底态,登记）
  811: { w: 10, h: 10, rot: 'align90', alpha0: 255, fade: 20, life: 3600,
    sfx: ['Item_17'], fallback: '#8A3038' },
  // 55 黄蜂毒刺(NPC.cs:51185):10×10 直飞 timeLeft 300;尘 18 拖尾 = AI_001 :56456-56460
  //  （★FX53:泛色 trail 退役,真尘站见 dartStep 55 支——每 update 1×d18 scale0.9）
  55: { w: 10, h: 10, rot: 'align90', life: 300, fallback: '#D8C890' },
  // 81/82 木箭/燃烧箭(战士族 num172 :59797/:59821):10×10,重力 0.07@20(:54009);发射音 Item5
  81: { w: 10, h: 10, rot: 'align90', grav: 0.07, gravDelay: 20, sfx: ['Item_5'], fallback: '#D8C8A0' },
  82: { w: 10, h: 10, rot: 'align90', grav: 0.07, gravDelay: 20, sfx: ['Item_5'], fallback: '#FFB060' },
  // 84 粉激光(NPC 122 :24887):4×4,scale1.2,alpha255 渐入(|v|*0.9),extraUpdates2,life600,
  //    光=ProjLight 0.75×(0.8,0,0.5)(:15181,Game 侧标量循环);发射音 Item12
  84: { w: 4, h: 4, rot: 'align90', scale: 1.2, alpha0: 255, fade: 'speed', updates: 2, life: 600,
    sfx: ['Item_12'], fallback: '#FF70E0' },
  // 96 诅咒焰(爬行者 101 :22846):16×16,alpha100(恒),spin 0.3,光=0.8×(0.35,1,0) 绿(ProjLight);
  //    尘 75 拖尾 = aiStyle8 :24588-24593（★FX53:泛色 trail 退役,真尘站见 dartStep 96 支
  //    ——每 update 1×d75 scale=3×弹scale）;scale=SetDefaults :1811-1812 双写终值 1.3（曾缺）
  96: { w: 16, h: 16, rot: 'spin', spinRate: 0.3, alpha0: 100, scale: 1.3,
    sfx: ['Item_20'], fallback: '#8A5AE8' },
  // 115 邪恶三叉戟(红恶魔 156 NPC.cs:23575-23603):16×16,a45,α 唯一写面=AI_027 呼吸脉冲
  //    （P.cs:26849-26891,±30↔scale∓0.02,有界 [0.98,1.16]）——★fade 退役
  //    (2026-10-13 实报定谳):原版无通用渐入,fade −50/t 会钉死脉冲相位使 scale
  //    无界缩过零负=镜像+|scale| 涨;α 出场 255=GetAlpha A 直通「不透明」
  //    (:81448,draw 115 专属支消费)。加速 ×1.125@ai0<30(:26770-26777),光=ProjLight
  //    0.5×(0.5,0.05,1)(:15205);Item8。块尾 vy>16 无条件钳（:26913-26915,★F2
  //    2026-10-14）→ 表 vCap:16 经 dartStep 非 grav 独立支消费
  115: { w: 16, h: 16, rot: 'a45', alpha0: 255, pulse: true, life: 300, vCap: 16,
    accel: { from: 0, to: 30, mul: 1.125 }, sfx: ['Item_8'], fallback: '#B060FF' },
  // 128 霜爆(冰元素 169 :24933):14×14 旋转恒 0,alpha255 渐入;尘 92 ×3 = aiStyle28
  //  :26983-26992（★FX53:泛色 trail 退役,真尘站见 dartStep 128 支）;Item28
  128: { w: 14, h: 14, rot: 'none', alpha0: 255, fade: 50,
    sfx: ['Item_28'], fallback: '#C8ECFF' },
  // 174 冰刺/176 丛林刺/605 尖刺史莱姆刺(尖刺史莱姆 184/204/535):
  //    6×6,重力 174/605:0.15@5(:54017)/176:0.05@15(:54310)
  174: { w: 6, h: 6, rot: 'align90', alpha0: 255, fade: 50, grav: 0.15, gravDelay: 5,
    sfx: ['Item_17'], fallback: '#B8E0F0' },   // 发射音 Item17(:52163-52167)
  176: { w: 6, h: 6, rot: 'align90', alpha0: 255, fade: 50, grav: 0.05, gravDelay: 15,
    sfx: ['Item_17'], fallback: '#7AC868' },   // :52241-52245
  605: { w: 6, h: 6, rot: 'align90', alpha0: 255, fade: 50, grav: 0.15, gravDelay: 5,
    sfx: ['Item_154'], fallback: '#D8D0C0' },  // 605 族 Item154(:52213-52223)
  // ---- ★NPC 弹幕尘站普查批（2026-09-16,docs/npc-proj-dust-census.md §6 Carrier 面）：
  //      472/920/436/438/581/592 六型此前无表项走 legacyStep 色块,本批补 SetDefaults
  //      投影(盒/α/life/EU/首帧音)——尘站见 dartStep 各支与 killShooterDust ----
  // 472 诅咒颅（地牢蜘蛛 163/236-238 吐射,Enemy.ts spawnHostileProj :5335/:6520）：
  //    SetDefaults :5465-5473 8×8 aiStyle1 hostile penetrate-1 tileCollide timeLeft 60;
  //    AI 尾焰 d30×1/update+首拍 d30×20(:55078-55097)、Kill d30×20(:74803-74813)。
  //    首拍音 Item17 在 AI localAI[0]==0 支(:55087-55089),发射点无音 → 表 sfx 承载
  472: { w: 8, h: 8, rot: 'align90', life: 60, sfx: ['Item_17'], fallback: '#7CE8C8' },
  // 920 史莱姆箭矢（地牢蓝史莱姆 658 母体吐射,Enemy.ts :4124 spawnHostileProj）：
  //    SetDefaults :8729-8736 6×6 aiStyle1 hostile α255 penetrate1;重力同 174/605 族
  //    0.15@5(:57877);首拍随机帧 frame=rand(3)(:56020-56024,ctor frameRand 同义);
  //    首拍音 Item154(:56065-56070 else 支,926 才走 Item155)。★原版 AI 块 :56025
  //    明文排除 920/921 的尘掷(`type != 920 && type != 921 && ...`)→ 920 无 A 尘站
  //    (普查报告"56052 变量尘"系扫描器把外层 type∈{605,920,...} 当尘站条件,亲读证伪);
  //    尘面唯一来源 = Kill d4×6 环(:72760-72770,killShooterDust 920 支)
  920: { w: 6, h: 6, rot: 'align90', alpha0: 255, fade: 50, grav: 0.15, gravDelay: 5,
    sfx: ['Item_154'], frameRand: 3, fallback: '#5888FF' },
  // 436 火星弹（脑洗器 381,RANGED_TABLE :6086 proj:436 → spawnHostileProj）：
  //    SetDefaults :5066-5072 10×10 aiStyle1 hostile ignoreWater（α 缺省 0=本体常显
  //    ——AI 块 α−40/t 对 0 值恒钳 0=no-op,渐入面不存在）;
  //    AI :55106-55128 首拍 Item12 + 4 帧动画(每 3 update 步进)+AddLight——EU=0。
  //    ★G10/R2-F6 姿态勘误：rot 'rightPi'——AI_001 专属块 :55107-55119
  //    `spriteDirection=direction` + 尾分派 :58640-58647 `rotation=ToRotation()
  //    +π+(direction==-1?π:0)`（RIGHT 族变体,基底多 π,贴图朝左本相）——旧
  //    'align90'=恒 90° 偏+永不镜像。ghost 面（TrailingMode=0）mirror 随
  //    direction（draw 消费位）。BJ703-B D2 扫族只收 435/682,本刀补 436 活体
  //    （459/709 无 spawner=休眠,台账 F7 维持）。
  436: { w: 10, h: 10, rot: 'rightPi', sfx: ['Item_12'], animEvery: 3, frames: 4,
    fallback: '#B0F0A0' },
  // 438 火星激光（射线枪手 382,RANGED_TABLE :6090 proj:438）：SetDefaults :5083-5090
  //    8×8 aiStyle1 hostile α255 extraUpdates=3 ignoreWater;fade = |v|×0.9 积分式
  //    (:56631,与 302 同式);首拍音 Item12(:56220-56224)。本体无尘站(仅 AddLight)
  438: { w: 8, h: 8, rot: 'align90', alpha0: 255, fade: 'speed', updates: 3,
    sfx: ['Item_12'], fallback: '#F0A0B0' },
  // 581 破甲刺（漩涡蜂后 426,RANGED_TABLE :6113 proj:581）：SetDefaults :6308-6316
  //    10×10 aiStyle1 α255 penetrate-1 hostile——α 恒 255 无 fade（AI 全程无 α 写支,
  //    通用 fade switch :56590-56615 无 581——★F4:fade 门排除列 2026-10-14 收编,
  //    旧缺省 −50/t 渐显=假阳性本体）
  //    =本体恒隐、可视面全在 AI 尾尘 2×SelRandom(229,161,161)/update(:57288-57302);
  //    首拍音 Item17(:57291-57294);penetrate-1 穿透不消亡 → 命中口豁免(见 fixedUpdate)
  581: { w: 10, h: 10, rot: 'align90', alpha0: 255, sfx: ['Item_17'], fallback: '#C8D0F0' },
  // 592 火星弹（火星行者 520,RANGED_TABLE :6122 proj:592）：SetDefaults :6411-6418
  //    8×8 aiStyle1 hostile α255 extraUpdates=3 ignoreWater;fade = |v|×0.9(:56631);
  //    首拍音 Item12(:56230-56234);无尘站(仅 AddLight :55821-55823)
  592: { w: 8, h: 8, rot: 'align90', alpha0: 255, fade: 'speed', updates: 3,
    sfx: ['Item_12'], fallback: '#90A0F0' },
  // 1073 史莱姆凝胶弹（携 539 史莱姆法杖物史莱姆 AI_001 :61099-61103：direction×12
  //   直飞伤 20 kb2；SetDefaults Projectile.cs:9754-9761：10×10 aiStyle1 hostile
  //   penetrate-1 trap——无重力直飞；命中 Poisoned(20) 600t 由 projTargets :11660 接）
  1073: { w: 10, h: 10, rot: 'align90', life: 600, fallback: '#7AB8E8' },
  // 177 冰水吐涎(冰鱼人 206 :59859):10×10 旋转恒 0,alpha255;尘 137 ×3 = aiStyle28
  //  :26966-26977（★FX53:泛色 trail 退役,真尘站见 dartStep 177 支）
  177: { w: 10, h: 10, rot: 'none', alpha0: 255, fade: 50,
    fallback: '#A8D8E8' },
  // 180 死眼弹(海盗 214/216/292 :59895):4×4,scale1.2,alpha255 渐入(|v|*0.9),extraUpdates1,life600,
  //    光=ProjLight 0.5×(1,0.7,0.1)(:14990);Item11
  180: { w: 4, h: 4, rot: 'align90', scale: 1.2, alpha0: 255, fade: 'speed', updates: 1, life: 600,
    sfx: ['Item_11'], fallback: '#FFE8A0' },
  // 257 霜束(冰雪巨人 243 :59339):4×4,scale1.2,alpha255 渐入 -10(:53036),extraUpdates1,life600;
  //    光=ProjLight 0.75×(0.1,0.9,1);Item12
  257: { w: 4, h: 4, rot: 'align90', scale: 1.2, alpha0: 255, fade: 10, updates: 1, life: 600,
    sfx: ['Item_12'], fallback: '#A8E8FF' },
  // 288 金雨(脓水粘怪 268 :25032):32×32,重力 0.075(:22835),scale -0.002/更新(:22824),
  //    extraUpdates2,旋转恒 0;尘 170 ×3 = aiStyle12 :24805-24816（★FX53:泛色 trail
  //    退役,真尘站见 dartStep 288 支——ai[0]=4 每 update 强制赋值 :24795,恒频）;Item17
  288: { w: 32, h: 32, rot: 'none', alpha0: 255, fade: 50, grav: 0.075, updates: 2, shrink: 0.002,
    tileBox: 10,   // ★SW-FX7：GetCollisionParams 缩盒名单（P.cs:20072）
    sfx: ['Item_17'], fallback: '#E0B040' },
  // 299 暗影焰(巨型诅咒颅 289 :21795):6×6,alpha255,tileCollide=false 穿墙,extraUpdates2,
  //    贴图 1×1 空桩→纯尘埃(尘 181);Item8@第6更新(:53761)
  299: { w: 6, h: 6, rot: 'align90', alpha0: 255, fade: 50, updates: 2, noTile: true, noTex: true,
    fallback: '#7A5AFF' },   // 尾尘走 d181 真尘段(dartStep 尾,P.cs:57611-57637)——泛色 trail 已退役
  // 300 圣锤(圣骑士 290 :59887):38×38 roll(通用 else 支 rotation+=(|vx|+|vy|)×0.03×dir
  //    :23469-23472),重力 0.2@60 + **vx×0.99 同门**(:23850-23853,IIIII235 补 xDamp——曾缺
  //    =飞行 60t 后不衰减水平速度),tileCollide=false 穿墙;终端 vy 32(aiStyle2 通用钳
  //    :23914-23916,IIIII235 补);timeLeft=SetupProjectile 缺省 3600(:789,IIIII235 补——
  //    曾落 Dart 缺省 600=10s 寿终,原版 60s);Item1(ai[0]==0 首拍 :23846-23849)
  300: { w: 38, h: 38, rot: 'roll', grav: 0.2, gravDelay: 60, xDamp: 0.99, vCap: 32,
    life: 3600, noTile: true, sfx: ['Item_1'], fallback: '#C8B860' },
  // 302 狙击弹(骷髅神射 291 :59883):4×4,scale1.18,alpha255 渐入(|v|*0.9),extraUpdates7(!) →
  //    弹速 4×8=32px/t,life300;光=ProjLight 0.3×(1,0.7,0.1);Item11
  302: { w: 4, h: 4, rot: 'align90', scale: 1.18, alpha0: 255, fade: 'speed', updates: 7, life: 300,
    sfx: ['Item_11'], fallback: '#FFF0B0' },
  // 303 火箭(骷髅爆破 293 :59893;玩家火箭发射器同族):SetDefaults :3945 w14 h14
  //    aiStyle16、**无重力**(AI_016 火箭族无 gravity 行,直飞)——曾误 grav 0.3/h20。
  //    尾烟 = 每拍尘6烟+尘31火(见 dartStep ROCKET_TRAIL),空中 ×1.1 加速(:48230)
  303: { w: 14, h: 14, rot: 'roll', life: 180, rocket: 64, fallback: '#B8B8C0' },

  // 75 HappyBomb(小丑 109 :60411-60417 投掷,伤 80/timeLeft 300):22×22 aiStyle16
  //    hostile penetrate-1(SetDefaults :1550-1557)。AI_016:age>5 起重力 0.2 +
  //    贴地 vx×0.97(:48390-48396),rot+=vx×0.1(:48444),撞块反弹 ±0.4(:19868-19876),
  //    距玩家中心<40px 即 Kill(:47809-47820);首帧 PlaySound(66)=★legacy type66=
  //    Zombie_121/122/123 随机小丑笑声（LSP case66 Next(121,124),×0.45 音量±0.15
  //    音调——★BJ692 复核普查第二只活体:旧译 'Item_66' 系整数编号域误读同族;
  //    音量面=BJ693 债④ sfxVol 0.45 已接（旧注「固定 vol0.8 无音量面」系 sfxVol
  //    落地前残文,勘误）;±0.15 音调=PITCH_CASE[case66] 表档（Sfx.ts:342,0c186b4c
  //    2026-08-24 起在位）+三重 already-playing 拒重=★G10 GROUP_BUSY 门（Sfx.ts,
  //    BJ291 残留清偿）;
  //    Kill 爆炸=Item14 + 128×128 伤害盒伤 60 kb8(:80116-80122)+尘 31/6+Gore 61-63
  75: { w: 22, h: 22, rot: 'vxSpin', grav: 0.2, gravDelay: 5, life: 300,
    bomb: true, proxKill: 40, rocket: 64, rocketDmg: 60, sfxVol: 0.45,
    sfx: ['Zombie_121', 'Zombie_122', 'Zombie_123'], fallback: '#505048' },
  // 31 沙球(蚁狮 69 :24520 速12/伤10/timeLeft300/ai[0]=2 敌版):10×10。
  // 蚁狮档(AI_010 ai[0]==2 :55081-55100):重力 0.2 + vx 侧摩 ±0.04 向 0 收 + vy 钳 10
  // ——曾误用 ai[0]==1 落地态的 0.41(坠速翻倍,弧线错);spin 0.1 恒速(:55158);尘 32。
  // 沿途击碎水晶/雕像/宝石/石堆族(KillTile :55110-55136);落地放沙 53(:75430-75536,
  // 轨道 314/传送带 421-422 例外)——sandBall 档见撞块段
  31: { w: 10, h: 10, rot: 'spin', spinRate: 0.1, grav: 0.2, xFrict: 0.04, vCap: 10, life: 300,
    sandBall: true, fallback: '#D8C890' },   // 飞行尘走 d32 真尘段(:58852 同 42 支)——泛色 trail 已退役
  // 471 骷髅骨(投骨骷髅 449-452 :59844):16×16,scale1.2,roll,重力 0.4@20+xDamp0.97(aiStyle2 通用尾 :21976)
  471: { w: 16, h: 16, rot: 'roll', scale: 1.2, grav: 0.4, gravDelay: 20, xDamp: 0.97, fallback: '#E0D8C8' },
  // 508 标枪(希腊骷髅 481 :59855):16×16,重力 0.3+xDamp0.98@ai0>60(:54589)
  508: { w: 16, h: 16, rot: 'align90', grav: 0.3, gravDelay: 61, xDamp: 0.98, fallback: '#C0A880' },
  // 572 蝾螈吐息(蝾螈族 498-506 :59849):10×10,alpha255 渐入;尘 40 ×2 = AI_001
  //  :57254-57271（★FX53:泛色 trail 退役,真尘站见 dartStep 572 支）;Item17
  572: { w: 10, h: 10, rot: 'align90', alpha0: 255, fade: 50,
    sfx: ['Item_17'], fallback: '#8AD8A0' },
  // 44 魔鬼飞镰(恶魔 62/66 NPC.cs:23533 弹型 44):48×48,scale0.9,alpha100,spin 0.8×direction
  //    (AI_018 P.cs:25780),加速 ×1.06@ai0[30,100)(:25782-25792),光=ProjLight 0.2×(0.6,0.1,B=1
  //    绝对)(:15054);Item8(:23723)。★尾迹=原版 AI 尾尘链(见 dartStep 44 支)——曾用通用
  //    trail(spawnParticles 单点 cx/cy,1/2 拍)2026-09-02 用户报"尾迹恒偏出弹体"退役
  //    ★SW-FX7 勘误（2026-09-10）：spawn-parity-gaps.md 登记的"44 AI_018 蓄势段
  //    AngleTowards(0.25) 转向(:23761-23774)"系误锚——1457 P.cs:25735-25737 的
  //    AngleTowards 属 aiStyle18 内 type==1092 支（ai[1]<20 蓄势段）;44 走 :25780
  //    起的通用支（spin+加速+尘,零转向/零追踪）。"飞镰加速段直线不追踪"正是
  //    原版本相,不修。tile 碰撞另走 tileBox 12 缩盒（GetCollisionParams :20081）。
  44: { w: 48, h: 48, rot: 'spin', spinRate: 0.8, scale: 0.9, alpha0: 100, life: 300,
    accel: { from: 30, to: 100, mul: 1.06 },
    tileBox: 12,   // ★SW-FX7：GetCollisionParams aiStyle18 width−36（P.cs:20081）
    sfx: ['Item_8'], fallback: '#B08050' },
  // 909 岩石巨人岩(631 :56722):12×12,roll,重力 0.4@38+xDamp0.97(:21527),随机帧 1-6(:21534)
  909: { w: 12, h: 12, rot: 'roll', grav: 0.4, gravDelay: 38, xDamp: 0.97, frameRand: 6, fallback: '#9A8C72' },
  // 83 死光 EyeLaser(Eyezor 251 :59373；EoC 雷眼 :26726 同弹):4×4,aiStyle1 直飞,
  //    scale1.7,alpha255 渐入 −15(:52730/:52742),extraUpdates2,penetrate3,life600;
  //    光=ProjLight 0.75×(0.7,0,1)(:15178——Game 侧 PROJ_LIGHT_MUL 83 已注册,勿在此自报)
  83: { w: 4, h: 4, rot: 'align90', scale: 1.7, alpha0: 255, fade: 15, updates: 2, life: 600,
    fallback: '#70E0FF' },
  // 498 铁钉 Nail(Nailhead 463 散射 NPC.cs:57793):6×6 aiStyle1 hostile penetrate -1
  //    timeLeft180(SetDefaults :5716-5723);出生音 Item17(:58476 localAI[0] 门);
  //    ai0≥50 起摩擦 vx×0.98 + 重力 0.15 + rotation 自旋(direction×0.5/更新)
  //    (:58485-58489 同支——与重力/摩擦同一 ai[0]>=50 分支,'nail' 模式经 gravDelay
  //    49 复用同拍翻转点);<50 恒 align90(:58490-58492 else 支)。终清波接上
  //    （原"±0.5 未接"登记就此退役;direction=出生速度符号,飞行中不复评=原版语义）
  498: { w: 6, h: 6, rot: 'nail', spinRate: 0.5, grav: 0.15, gravDelay: 49, xDamp: 0.98,
    life: 180, sfx: ['Item_17'], fallback: '#D8D8E0' },
  // 501 蝇瓶 DrManFlyFlask(Dr. Man Fly 468 :59863):14×14,aiStyle2 抛物,scale1.1;
  //    ai0≥18 起摩擦 vx×0.995 + 重力 0.2(:21804-21811),之前直飞
  501: { w: 14, h: 14, rot: 'align90', scale: 1.1, grav: 0.2, gravDelay: 18, xDamp: 0.995,
    fallback: '#C8E060' },
  // ---- 史后三法师（NPC.cs:21260-21312,1457 timeLeft 覆写经 NewProjectileModifiers
  //      .HardmodeDungeonSkeletonShot = timeLeft 300,NewProjectileModifiers.cs:5-8）----
  // 290 暗影束(死灵法师 283/284):4×4,aiStyle48 束弹——extraUpdates 100(束速 6×101≈606px/t
  //    全屋瞬达)。★寿命换算(2026-09-02 290 寿命专项定谳,推导 ≠ SetDefaults 字面):
  //    SetDefaults :3795-3805 的 timeLeft=100【非终值】——发射点 NPC.cs:21251-21300
  //    (283/284 弹速 num100=6f、±30px 瞄准抖动)NewProjectile 尾参
  //    NewProjectileModifiers.HardmodeDungeonSkeletonShot → NewProjectileModifiers.cs:5-8
  //    直写 timeLeft=300(293 同支;291 才走 :21294 特化支,同参同改 300)。
  //    子步消耗已括号计数复核:AI() :16880 与 timeLeft-- :17307 同在
  //    while(numUpdates>=0)(:16781,numUpdates=extraUpdates :16780)直接体(depth2)
  //    → 每帧 1+EU=101 子步;位移 = HandleMovement :17120/:17578 每【子步】全速
  //    TileCollision 积分(无 ÷(EU+1) 分摊,302 狙击 ×8 同理);AI_048 支 :28608-28646
  //    无 timeLeft 补偿/重置(唯 :28610 InWorld 内缘门外 Kill);:17308 timeLeft<=0
  //    → Kill(Kill 头 !active 门 :71756 幂等)。终值时间线:300 子步 = 2 全帧
  //    + 第 3 帧 98 子步处 Kill + 1 尾子步(AI+位移后 :17132 !active 整 Update 早退)
  //    → 位移共 301 子步 × 6px = 1806px ≈ 112.9 格,真实存活 ≈ 2.97 帧 ≈ 0.05s。
  //    本仓 life 按 tick 头递减(fixedUpdate 先减后步) → 取 4 = 3 全拍飞行
  //    (303 子步,较原版 +2 子步≈12px;取 life 3 = 202 子步,少 99 子步≈594px
  //    =整拍缺飞,两害取轻登记)。
  //    本体恒隐:alpha=255 由 AI 每子步写(:28630-28632)+贴图官方空桩;可视面=束段尘
  //    ——【撞块反弹】(Update :18975-19018 全速反号+束铺撒+重锚)/【Kill】
  //    (:71825-71870 锚点→死亡位铺撒)两口,见 dartStep 290 支;首子步 Item8(:28633)。
  //    敌版铺撒标量 0.03334(Orchestrator :1989-1993),友版 294 的 0.25 别值勿混
  290: { w: 4, h: 4, rot: 'none', alpha0: 255, life: 4, updates: 100, fallback: '#B090FF' },
  // 291 地狱火弹(魔法师 285/286):12×12,alpha255 本体恒隐(SetDefaults :3812;AI 291 支
  //    :28738-28767 无 alpha 行=不渐显,旧 fade:50 退役),tileCollide=false 穿墙,
  //    penetrate=-1 穿人不消亡(Damage_EVP 无 Kill);发射点 NPC.cs:21294 ai[0]/[1]=
  //    玩家心(发射拍)。AI:Item20 首拍(:28740-28744)+10×d174 尾迹/拍(:28758-28766)
  //    +越点引爆(Dot(target−Center,v)<=0 → v=0 → Kill :28748-28756——本仓锚点缺省
  //    =首子步捕玩家心,spawnAi0/1 可显式覆写);Kill(:75802-75807)=原位 spawn 292
  //    爆区(同伤),旧 rocket:65 通用爆退役。★MP:291 为房主权威弹(NPC AI 房主独算,
  //    快照 kind2|0x80 → 访客傀儡 netPuppet 不跑 AI/不跑 Kill 链)——292 生成权分流:
  //    房主=Kill 口(inferno291Kill),访客=destroy 镜像口(下方 destroy 注,2026-09-02
  //    访客缺口清偿);292 本体不上线,各端本地镜像自算
  291: { w: 12, h: 12, rot: 'none', alpha0: 255, life: 300, noTile: true, fallback: '#FF9040' },
  // 293 迷失之魂(布道者 281/282):12×12,旋转恒 0,alpha255,tileCollide=false,extraUpdates1,
  //    200px 内追踪(:AI_051 target v=norm×3,vel=(vel*100+t)/101);尘 175 ×9/更新;Item8
  //    ★R5(T5,2026-09-02)：lerp 口径=乘子=除数−1——原式 P.cs:28911-28912
  //    (vel*100+target)/101 的 100 才是本表 lerp(除数 101=乘子+1),消费式统一
  //    (vel*lerp+target)/(lerp+1);曾存 lerp:101 被消费式再+1 = (vel*101+t)/102 差一。
  //    同口径先例=596 档 lerp:9(AI_107 :34286 (vel*9+dir*7.5)/10,num837=10 除数)
  //    ——两处原版结构同型 (v×(D−1)+dir·spd)/D,单约定覆盖,无需分型。
  293: { w: 12, h: 12, rot: 'none', alpha0: 255, fade: 50, life: 300, noTile: true, updates: 1,
    home: { spd: 3, lerp: 100, range: 200 },
    sfx: ['Item_8'], fallback: '#D8D0FF' },   // 尾尘走 d175 真尘段(dartStep 尾,:28842-28854)——泛色 trail 已退役
  // 836 蒲公英籽(628):4×4,tilt 旋转,4 帧行 6 更新步进(帧动画由 frame 自增,此处用出生随机帧近似起步)
  836: { w: 4, h: 4, rot: 'tilt', frameRand: 4, animEvery: 6, hFrames: 4, windSeed: true, fallback: '#E8E8D0' },
  // 814 血弹(恐惧鹦鹉螺 AI_117 :47751):10×10 aiStyle1,alpha255 渐入 -20/t(:53573),
  //    tileCollide=false 穿墙,penetrate=-1;★原版 814 无光(:53561 起块内无 AddLight——
  //    曾误挂 819 的红光 :53558);尘 5 尾+首拍 8 尘爆发(批六 m3,AI 段 :57403-57422);
  //    出生音 Item171(:57406);★批六 M5:timeLeft 无行→3600(SetDefaults 头 :789 缺省,
  //    811/814 块无覆写;旧 180 无据);★批六登记不修:oldPos 长程拖尾尘(:57427-57435,
  //    每 oldPos 槽 1/3 掷)——本仓 Dart 无 oldPos 快照带,随载体批再议;
  //    绘前白化 Lerp(projectileColor,White,0.35) 常数(DrawProjDirect :30849-30856)
  814: { w: 10, h: 10, rot: 'align90', alpha0: 255, fade: 20, noTile: true, life: 3600, whiteLerp: 0.35,
    // ★FX53 普查尾修：泛色 trail 退役（尘面=AI 段 d5 轨迹/爆发 :57403-57435,真尘段已接;
    //  曾双发=真 d5 + 泛色每两拍一粒）
    sfx: ['Item_171'], fallback: '#B03040' },
  // 577 星旋激光 VortexLaser(风暴潜水员 425 满蓄四连发,NPC.cs:59202 速 20/kb1 →
  //    fighterFamilies.ts:1019):4×4 aiStyle1 直飞,scale1.2,alpha255 渐入 -15/更新
  //    (AI_001 :56601-56610,576/577 同支——localAI[1]>2 起步=前两拍免衰,批六 m1
  //    以 fadeDelay:2 接线),extraUpdates2,penetrate -1,life600;无重力无 vy 帽
  //    (AI_001 尾 vy±16 帽支 flag7 对 577 显式豁免 :58736-58742);贴图 Projectile_577
  //    2×42 单帧(Main.projFrames 无赋值),align90 通用尾 :58732;出生音 Item36 +
  //    尘 229×5 一次性喷口爆发(:56333-56347,非拖尾故不入 trail);光=(0.1,0.3,0.4)
  //    (:57272-57274,直色 AddLight 非 light×mul——vanilla-projectiles.json 无 light
  //    字段,Game 侧 ProjLight 跳过=辉光未接,数据面遗留);Kill 尘组 :77649 与
  //    84/180 同组(表惯例不建模)
  577: { w: 4, h: 4, rot: 'align90', scale: 1.2, alpha0: 255, fade: 15, fadeDelay: 2, updates: 2, life: 600,
    sfx: ['Item_36'], fallback: '#A1C7C2' },
  // ---- G3 宿主绑定弹（2026-08-19；AI/绘制全走专用分支，表项只供尺寸/贴图装载）----
  // 537 观星者激光(SetDefaults :5842-5851):22×22 aiStyle84,alpha255(绘制独占不读 α),
  //    tileCollide=false,timeLeft240(AI 侧 localAI[0]>=90 先杀);发射点 NPC.cs:59972
  537: { w: 22, h: 22, rot: 'none', alpha0: 255, noTile: true, life: 240 },
  // 573 预言者蓄能弹(SetDefaults :5950-5957):18×30 aiStyle102,timeLeft600,单帧 14×26;
  //    蓄能 90t 隐形(alpha255)→齐射显形;发射点 NPC.cs:59978(四发扇)
  573: { w: 18, h: 30, rot: 'none', life: 600, fallback: '#9FD8FF' },
};

/** AI_016_Bombs 火箭尾烟族（Projectile.cs:48181 清单;本仓现役仅 303,余为全家族 id） */
const ROCKET_TRAIL = new Set([134, 137, 140, 143, 303, 776, 780, 793, 796, 799, 784, 787, 790]);

/**
 * 629 TowerDamageBolt（Projectile.cs AI_122 :33747-33778 + Kill 段 :69784-69819）：
 * 本组教徒怪死亡时朝对应塔发射的红色追踪弹——ai[0]=目标塔 NPC，
 * 每 tick velocity = normalize(塔心-弹心)×5（:33775-33777）+ Dust.QuickDust 红尘尾，
 * 命中塔 Hitbox → Kill：盾 -1（Game 侧 onTowerBoltHit）且盾非 0 时塔 ai[3]=1（闪光 120t）。
 * 目标失联（塔死亡/消失）立即消亡（:33753-33761）。
 * 纯事件弹：无伤害（damage=0）、无碰撞、不参与联机弹幕同步（视觉弹） */
export class TowerBolt extends Entity {
  w = 10; h = 10;
  /** 目标塔解析（每 tick 重查——塔可能在本弹飞行中死亡） */
  private target: () => Enemy | null;
  /** 命中回调（盾结算/闪光/盾破音，Game 注入） */
  private onHit: (tower: Enemy) => void;
  private life = 3600;
  /** ★BJ294 敌射侧拒割位：629 SetDefaults hostile（型录 hostile:true,aiStyle 122）→
   *  原版 CutTiles 调用点 friendly 门（P.cs:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;

  constructor(x: number, y: number, target: () => Enemy | null, onHit: (tower: Enemy) => void) {
    super();
    this.x = x; this.y = y;
    this.target = target;
    this.onHit = onHit;
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    // 世界坐标绘制:原版贴图 Projectile_629(已解包入库);ensureVImage 触发懒加载
    // (2026-08-13 枚举 review:此前直取+无人预载=永久红点兜底)
    const img = r.atlas ? r.atlas.ensureVImage('vanilla/Projectile_629.png') : null;
    if (img) {
      ctx.drawImage(img, this.x + this.w / 2 - img.width / 2, this.y + this.h / 2 - img.height / 2);
      return;
    }
    ctx.fillStyle = '#FF4040';
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.fillStyle = '#FFB0A0';
    ctx.fillRect(this.x + 3, this.y + 3, this.w - 6, this.h - 6);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    const t = this.target();
    if (!t || t.dead) { this.dead = true; return; }   // AI_122 目标失联即 Kill（:33753-33761）
    if (--this.life <= 0) { this.dead = true; return; }
    const dx = t.cx - this.cx, dy = t.cy - this.cy;
    const len = Math.hypot(dx, dy) || 1;
    this.vx = (dx / len) * 5;                          // :33775 normalize(塔心-弹心)×5
    this.vy = (dy / len) * 5;
    this.x += this.vx;
    this.y += this.vy;
    // 红尘尾（:33778 Dust.QuickDust(Center, Red)——无重力短命尘）
    game.spawnParticles(this.cx, this.cy, Math.random() < 0.5 ? '#FF4040' : '#FF9060',
      1, 0.5, { life: 12, damp: 0.95, grav: 0 });
    // 命中塔 Hitbox（:33765-33770）→ Kill → 盾结算回调
    if (this.aabbOverlaps(t)) {
      this.dead = true;
      this.onHit(t);
    }
  }
}
