// 城镇 NPC 自卫攻击的友方弹(NPC.cs AI_007 攻击态发射,Projectile.npcProj 语义):
// 物理 = 箭族近似(重力 0.3/tick,Projectile.cs aiStyle 1/2 同值),只伤敌怪不伤玩家
// (friendly 弹对玩家免疫;原版对城镇 NPC 免疫由 npcProj 标记,本仓为唯一玩家恒免疫)。
// 贴图 = Projectile_{id}.png 懒加载(Arrow.projSprite 共享缓存)。
//
// 绘制尺寸 = 贴图原生帧 × SetDefaults scale(与判定盒 w/h 解耦,G11 对账):
// 589/590 是【横向多列条】(Main.cs:33235/:33241 Frame(cols,1)),585/880 是竖排
// 多帧行——projFrameImg 只切竖排,横向条在本地切。旋转模式逐款见 TOWN_DRAW_SPEC。
import { Entity } from './Entity';
import { TILE } from '../core/constants';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projSprite, projFrameCount } from './Arrow';
// ★BJ704-G2（2026-10-21,债① 585 员）：残影环接线——585 TrailingMode=0/CacheLen 10
//  （ProjectileID.cs:385/:387）,通用表 P(1,7,1,0.2)（Main.cs:31062-31067）,色=缺省
//  白 aMul=1（GetAlpha :80880-80885 Lerp(光,White,0.5) 保 A——白化抬升=光照域项,
//  本仓 compositeLight 全屏乘承载,projGhostTrail 头注登记②同账）。
import { ProjGhostRing, drawProjGhosts, projTrailingMode } from './projGhostTrail';
import { projOverlap } from './projTargets';
import { projectileData } from '../data/vanillaProjectiles';
import { BuffType } from '../stats/Buffs';
import { projectileWetSection, projWaterDragFactor, PROJ_DESTROYED_BY_WATER } from './projWetSection';
import { HitCdImpl } from './proj1457';                       // SW-BJ33 2026-09-08（无环:proj1457 不反向依赖本文件）
import { princessWeaponFx } from '../fx/orchestraFx';         // SW-BJ33 2026-09-08（Spawn_PrincessWeapon 1:1 站）

const GRAV = 0.3; // 箭族重力(aiStyle 1/2 同值)

/** 旋转模式(原版 rotation 赋值散在各 AI,逐款对账 Terarria1456) */
export type TownRotMode =
  | 'up'             // atan2(vy,vx)+π/2——AI_001 尾默认(:54868)
  | 'up20'           // aiStyle 2:前 20t +π/2 姿态锁(:21970-21975),之后翻滚(:21517)
  | 'tumble'         // aiStyle 2:自出生翻滚累积 rotation += (|vx|+|vy|)*0.03*dir(:21517)
  | 'roll'           // rotation += vx*0.1(aiStyle 16 尾 :44909-44915;高尔夫 AI_149 近似)
  | 'spin'           // 恒速自旋(582 :32893 π/10;669 aiStyle 68 :29047 0.25)
  | 'mirror-right'   // AI_001 MIRROR 分支(:54715 585):ToRotation + 向左水平镜像
  | 'up-mirror'      // AI_016 镜像支(:44844-44849 930):+π/2 角 + 向左水平镜像
  | 'upright'        // AI 从不赋 rotation → 恒 0(15/590/950/24 等)
  | 'upright-mirror' // 恒 0 + 向左镜像(AI_183 :40418-40429 880)
  | 'grow';          // 586 AI_111_DryadsWard(:38728-38733):scale=age/100 钳 1 + 慢旋 π/300

export interface TownDrawSpec {
  rot: TownRotMode;
  /** 横向多列条列数(589=5/:33235、590=6/:33241);0 = 竖排 projFrames 或单帧 */
  cols: number;
  /** spin 模式角速度/tick */
  spinRate: number;
}

/** 逐款绘制规格(行号 = Terarria1456 源码锚)。
 *  帧源:585 恒帧 0(AI_001 不推帧)/880 每 tick +1 钳末帧(AI_183 :40427-40430)/
 *  589 列 = ai[1](出生 rand5,NPC.cs:54953)/590 列 = ai[2] 基组 + age/4 三帧循环
 *  (AI_112 :33025-33038)/其余单帧。 */
const TOWN_DRAW_SPEC: Record<number, TownDrawSpec> = {
  1:   { rot: 'up', cols: 0, spinRate: 0 },             // 木箭(aiStyle 1)
  2:   { rot: 'up', cols: 0, spinRate: 0 },             // 火焰箭
  14:  { rot: 'up', cols: 0, spinRate: 0 },             // 子弹(2×20 曳光 ×1.2)
  606: { rot: 'up', cols: 0, spinRate: 0 },             // Scutlix 眼激光(坐骑)
  587: { rot: 'up', cols: 0, spinRate: 0 },
  242: { rot: 'up', cols: 0, spinRate: 0 },
  267: { rot: 'up', cols: 0, spinRate: 0 },
  357: { rot: 'up', cols: 0, spinRate: 0 },             // 1×1 贴图(曳光近隐形)
  48:  { rot: 'up20', cols: 0, spinRate: 0 },           // aiStyle 2 姿态锁族
  520: { rot: 'up20', cols: 0, spinRate: 0 },
  21:  { rot: 'tumble', cols: 0, spinRate: 0 },         // aiStyle 2 翻滚族
  162: { rot: 'tumble', cols: 0, spinRate: 0 },
  583: { rot: 'tumble', cols: 0, spinRate: 0 },
  589: { rot: 'tumble', cols: 5, spinRate: 0 },         // 100×28 五列条(NPC.cs:54953 rand5)
  30:  { rot: 'roll', cols: 0, spinRate: 0 },           // aiStyle 16 尾 :44913 滚动
  588: { rot: 'roll', cols: 0, spinRate: 0 },
  133: { rot: 'roll', cols: 0, spinRate: 0 },           // :44905 排除表外 → 同滚动尾
  135: { rot: 'roll', cols: 0, spinRate: 0 },
  930: { rot: 'up-mirror', cols: 0, spinRate: 0 },      // Santank 炮击(坐骑):AI_016 镜像支 :44844-44849
  721: { rot: 'roll', cols: 0, spinRate: 0 },           // AI_149 高尔夫(GolfHelper 步进近似)
  134: { rot: 'up', cols: 0, spinRate: 0 },             // :44851 velocity≠0 → +π/2
  24:  { rot: 'upright', cols: 0, spinRate: 0 },        // aiStyle 14 不赋 rotation
  15:  { rot: 'upright', cols: 0, spinRate: 0 },        // aiStyle 8 不赋 rotation
  585: { rot: 'mirror-right', cols: 0, spinRate: 0 },   // :58579-58589 270 族(28×112 四帧行,★BJ704-G2 帧乒乓 townFrameIndex 585 支)
  582: { rot: 'spin', cols: 0, spinRate: Math.PI / 10 },// aiStyle 109 尾 :32893
  669: { rot: 'spin', cols: 0, spinRate: 0.25 },        // aiStyle 68 :29047
  880: { rot: 'upright-mirror', cols: 0, spinRate: 0 }, // AI_183 :40418-40430(34×256 八帧行)
  590: { rot: 'upright', cols: 6, spinRate: 0 },        // 96×20 六列条(AI_112 不赋 rotation)
  950: { rot: 'upright', cols: 0, spinRate: 0 },        // AI_186(rotation 0;★SW-BJ33 2026-09-08 起公主 663 面=PrincessAuraShot 专类（四层脉冲叠画已接）,本条=通用 TownShot 兜底形)
  586: { rot: 'grow', cols: 0, spinRate: 0 },           // 24×80 竖条 + 生长（★BJ256 起树妖面=DryadWardRingShot 专类（十叶双环轨道画）;本条=通用 TownShot 兜底形）
};

/** 纯函数:弹型 → 绘制规格(未列入走 AI_001 默认 +π/2) */
export function townDrawSpec(projId: number): TownDrawSpec {
  return TOWN_DRAW_SPEC[projId] ?? { rot: 'up', cols: 0, spinRate: 0 };
}

/** 纯函数:帧号(竖排行 idx / 横向列 idx 通用)。age 由 life 差值推导(MountShot 不走
 *  super.fixedUpdate,故不依赖自维护计数)。 */
export function townFrameIndex(projId: number, age: number, ai1: number, ai2: number): number {
  switch (projId) {
    case 880: return Math.min(projFrameCount(880) - 1, Math.max(0, Math.floor(age)));  // AI_183 :40427 +1/t 钳末帧
    case 589: return Math.max(0, Math.min(4, Math.floor(ai1)));                        // ai[1]=rand5(NPC.cs:54953)
    case 590: {                                                                        // AI_112 :33025-33038
      const base = ai2 === 1 ? 3 : 0;
      return base + (Math.floor(age / 4) % 3);
    }
    // ★BJ704-G2（2026-10-21,债① 585 员勘误）：AI_001 585 专属块【推帧】——
    //  :57095-57104 frameCounter++（12 循环）→ frame=fc/2、>3 → 6−fc/2（乒乓
    //  0,1,1,2,2,3,3,2,2,1,1,0 周期 12,age=tick 数,fc=age%12 对位:age1→fc1）。
    //  旧注「585 恒帧 0（AI_001 不推帧）」系误读——ghost 帧锚/本体动画双面随修。
    case 585: {
      const fc = age % 12;
      const f = Math.floor(fc / 2);
      return f > 3 ? 6 - f : f;
    }
    default: return 0;                                                                 // 456 族 AI 不推帧
  }
}

/** 纯函数:当前旋转角(不含 mirror 的翻转位——翻转由 draw 侧按 vx 判) */
export function townRotation(mode: TownRotMode, vx: number, vy: number, rotAcc: number,
  age: number, spinRate: number): number {
  switch (mode) {
    case 'up': return Math.atan2(vy, vx) + Math.PI / 2;
    case 'up20': return age <= 20 ? Math.atan2(vy, vx) + Math.PI / 2 : rotAcc;
    case 'tumble': return rotAcc;
    case 'roll': return vx * 0.1;
    case 'spin': return rotAcc;
    case 'mirror-right': return Math.atan2(vy, vx) + (vx < 0 ? Math.PI : 0);
    case 'up-mirror': return Math.atan2(vy, vx) + Math.PI / 2;   // 930 :44846-44849 atan2(−vy,−vx)−π/2 ≡ 同角
    case 'upright':
    case 'upright-mirror': return 0;
    case 'grow': return age * (Math.PI / 300);
    default: return 0;
  }
}

export class TownShot extends Entity {
  w = 10; h = 10;
  vx: number; vy: number;
  damage: number;
  knockback: number;
  projId: number;
  /** life 缺省 = Projectile.SetDefaults 预置档 timeLeft=3600（Projectile.cs:789），
   *  构造器内按 vanilla-projectiles.json timeLeft 字段逐款覆写——★对抗修复批⑤
   *  A5（2026-09-01）：旧硬编码 600 与原版缺省相悖 */
  life = 3600;
  dead = false;
  /** 弹附加 ai 参数(124/142/227 等特化弹;本仓多数弹不消费,仅存档语义) */
  ai1 = 0; ai2 = 0;
  /** 发射级覆写(如 588·107 弹体 timeLeft=480,cs:55070-55077 两连支)——
   *  ★必须后于 json 默认赋值,与原版「SetDefaults 预置→类型支覆写→调用点
   *  .timeLeft=480」三层序同形 */
  private lifeOverride?: number;
  /** 绘制 scale(SetDefaults;绘制尺寸 = 贴图原生 × scale,与判定盒解耦) */
  drawScale = 1;
  /** ★SW-BJ33 2026-09-08：Projectile.npcProj 语义位——AI_007 域全部城镇自卫弹出膛
   *  均 `npcProj = true; noDropItem = true`（NPC.cs:54903/:55175/:55325/:55490 族
   *  逐发射支字面）。原版消费点①CutTiles 调用门 `!npcProj`（Projectile.cs:12516,
   *  城镇弹不割草——旧中央通道缺此半边门=全域城镇弹过度砍草,本批补齐,见
   *  EntityManager.update 剪枝位）;②掉落归属面本仓 resolveDrops 承载（noDropItem
   *  不适用,登记）。玩家弹（Arrow 等）无此位=undefined → 原中央门行为不变 */
  npcProj = true;
  /** 出世 life(MountShot 不调 super.fixedUpdate,age 用 life 差值推导) */
  private age0 = 600;
  /** 翻滚/自旋累积角(tumble/up20 后段/spin 模式) */
  rotAcc = 0;

  // ---- ★通用湿段(Projectile.cs:16895-17113 全体弹共用段;2026-09-06 杂项弹簇批)----
  //  域 id 全集 = TOWN_DRAW_SPEC 30 型(NPC.cs AI_007 自卫攻击 npcProj 语义)逐 id
  //  豁免核对(SetDefaults P.cs 逐块;projectileData 数据面同向)：
  //  · 豁免(ignoreWater=true,段门恒闭零行为)={606:6542, 242:3253, 590:6397,
  //    950:8966, 880:8447}——湿段调用照走,整段门分流(:16895;预置 :10886-10893
  //    无条件跑=共享体 2026-09-06 逐字面化批口径);
  //  · 受段=其余 25 型(15/24/585/589/582/669/930/1/2/14/48/21/162/583/30/588/
  //    133/135/721/134/587/267/357/520/586)——溅花+旗维护;
  //  · ★584 NurseSyringeShot（TownNPC.ts 子类,SetDefaults :6342-6350 无 ignoreWater
  //    → 同受段）不在 TOWN_DRAW_SPEC 域内但其 override fixedUpdate 全量自写【不调
  //    super】——基类本位湿段对其不生效,已在 override tick 头自接共享体+阻尼
  //    （2026-09-08 红队接入面 F2,锚注见彼字段块）,本基类位零改动;
  //  · 15 ∈ ProjectileID.Sets.IsDestroyedByWater({85,15,188,34,1097,1106},
  //    ProjectileID.cs:287)→ 湿段消亡面接 hooks.kill(:16923-16925 `wet && !lavaWet`
  //    → Kill;本仓=dead 置位,型专属 Kill 尘面本类既有口径不变——669 kill669 爆炸
  //    仍在自身杀位)。
  //  阻尼：tileCollide 缺省 true 的受段型 → HandleMovement :17721 湿支生效,乘进
  //  位移行(速度场不减);tileCollide=false 型(721 高尔夫/豁免 590/606/950/880)
  //  → 档位不消费(:17721 只在 tileCollide 支,与 Misc 簇 golf/钩爪同谳)。
  //  插位=tick 头：AI(重力/翻滚累积,只写 velocity/rotAcc) → 湿段 → 位移=原版
  //  Update 同序,采样位=上拍位移后 ≡ 原版湿段采样。杀拍口径(Arrow.ts ⑥配方逐位
  //  核)：杀位=寿命头杀(fixedUpdate 首行,669 同拍带 kill669 爆炸)/撞块杀/命中杀
  //  ——寿命杀在湿段【前】(vanilla timeLeft 杀在 Update 尾 :17307=湿段后),tick 头
  //  单调用点使杀拍湿段照跑;撞块/命中杀在位移【后】=湿段已跑。双调用点/防双跑机
  //  不适用(单调用点天然覆盖全部杀拍)。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗(Projectile.wetCount :16984 置 10 / :17109-17112 逐拍 −1) */
  wetCount = 0;
  /** 出生预置已做(一次;NewProjectile :10886-10893 等价;共享体首调自做) */
  presetDone = false;

  // ---- ★BJ704-G2（2026-10-21,债① 585 员）：oldPos 残影环（TrailingMode 表驱动,
  //      UpdateTrails :17197-17204 mode0 逐拍位移后记录;域内唯一成员 585,余型
  //      mode=-1 → null 短路零开销）。MinionProj 755 接线式同构。 ----
  private ghostRing?: ProjGhostRing | null;
  private recordGhostTrail(): void {
    if (this.ghostRing === undefined) {
      this.ghostRing = projTrailingMode(this.projId) >= 0 ? new ProjGhostRing(this.projId) : null;
    }
    // mode0 不记 rot/dir（UpdateTrails 只写 oldPos）;绘制面 ghost 角=本体当前角
    this.ghostRing?.record(this.x, this.y, 0, 1, true);
  }

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number, projId: number,
    opts?: { ai1?: number; ai2?: number; life?: number; noGravity?: boolean }) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.projId = projId;
    if (opts) {
      if (opts.ai1 !== undefined) this.ai1 = opts.ai1;
      if (opts.ai2 !== undefined) this.ai2 = opts.ai2;
      if (opts.life !== undefined) this.lifeOverride = opts.life;
      if (opts.noGravity) this.noGrav = true;
    }
    const def = projectileData(projId);
    if (def) { this.w = def.width || 10; this.h = def.height || 10; }
    this.drawScale = def?.scale ?? 1;
    // ★对抗修复批⑤ A5：life 管线三层序——①SetDefaults 预置 3600（字段缺省,
    //   Projectile.cs:789）→②逐款 SetDefaults 覆写(json timeLeft:24→4800/
    //   590→900/950→180/1·2→1200/14·242·357→600,与反编译 Projectile.cs 各
    //   type 支双向核对一致;未设支走 3600 缺省)→③发射级覆写(588·107→480,
    //   cs:55070-55077,【后于默认】同形 SetDefaults 后 .timeLeft=480)
    // 核对记录(2026-09-01):json↔decompiled 双向抽查全数命中。
    this.life = def?.timeLeft ?? 3600;
    if (this.lifeOverride !== undefined) this.life = this.lifeOverride;
    this.age0 = this.life;
    // ★对抗修复批③ B-F10b：589 五列变体由发射端显式传 ai1（NPC.cs:55067 三元末支
    // 第 11 参 Next(5)；原 .ai1 未传时本地 Math.random() 补掷已删——构造器级直呼
    // 脱离实例注入面/确定性口径，且战斗路径全批禁 Math.random 直呼约定）。
    // 缺省 0（首列），显式传入语义收敛到唯一随机源 shootAt。
  }

  private noGrav = false;

  /** Projectile.Kill() case 669（Projectile.cs:68701-68737,酒馆老板 550 麦酒
   *  投掷弹的死亡爆炸）1:1：
   *  - 爆音 PlaySound(13)=Item_13（:68702）
   *  - 尘近似两档：白 12（α110 vel×1.5,:68706-68712）+ 金 noGravity 160
   *    （80 次循环每次两粒:scale1.2 vel×1.0-7.0 + scale0.8 vel×1.0-4.0,
   *    :68713-68723）
   *  - Resize(144,144) 中心不变（:68724）→ 判定框交叠玩家/城镇 NPC →
   *    AddBuff(25, 3659) Tipsy（:68726-68734;玩家走 BuffState.apply 秒制
   *    max 合并,城镇 NPC 走 applyTipsy 单槽——num2 进度链 ×1.1 的唯一入口）
   *  - Damage()（:68736）:144×144 内敌怪吃弹伤（伤害已在发射端过 num2×难度
   *    曲线;pierce 0 免疫帧拦同敌双吃 ≈ 原版 localNPCImmunity） */
  private kill669(game: GameHooks): void {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    game.playSfxFiles(['Item_13'], 1, cx, cy);
    game.spawnParticles(cx, cy, 'rgba(255,255,255,0.43)', 12, 1.5, { grav: 0.003 });
    game.spawnParticles(cx, cy, 'rgba(245,200,30,0.61)', 80, 4, { grav: 0.0005 });
    game.spawnParticles(cx, cy, 'rgba(245,200,30,0.61)', 80, 2, { grav: 0.0005 });
    const ex = cx - 72, ey = cy - 72, ER = 144;                  // Resize(144,144)
    const p = game.player as unknown as {
      x: number; y: number; w: number; h: number; dead: boolean;
      buffs?: { apply(t: BuffType, sec: number): void };
    } | null;
    if (p && !p.dead && projOverlap(ex, ey, ER, ER, p)) {
      p.buffs?.apply(BuffType.Tipsy, 3659 / 60);                 // :68727-68730
    }
    // duck-type applyTipsy（不 import TownNPC——环导 + HMR fork instanceof 坑）
    for (const n of game.npcs?.() ?? []) {
      const tn = n as unknown as {
        x: number; y: number; w: number; h: number; dead: boolean;
        applyTipsy?: (t: number) => void;
      } | null;
      if (!tn || tn.dead || typeof tn.applyTipsy !== 'function') continue;
      if (projOverlap(ex, ey, ER, ER, tn)) tn.applyTipsy(3659);  // :68731-68734
    }
    for (const ent of game.enemies()) {                          // Damage() :68736
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean; def?: { hitSound?: string[]; friendly?: boolean } };
      // friendly 弹 × friendly 目标 → Damage_PVE_Inner :11898 return（城镇自卫弹
      // 穿越睡渔夫 376 等友好 NPC 不误伤；城镇弹 type 恒非 318，无臭鸡蛋例外）
      if (e.dead || e.def?.friendly || !projOverlap(ex, ey, ER, ER, e)) continue;
      e.hurt(this.damage, Math.sign(this.vx) * this.knockback, 0, game, 0, false, 0, false);   // 音/飘值=单点
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(this.projId);
    const spec = townDrawSpec(this.projId);
    const age = this.age0 - this.life;
    const fIdx = townFrameIndex(this.projId, age, this.ai1, this.ai2);
    const ang = townRotation(spec.rot, this.vx, this.vy, this.rotAcc, age, spec.spinRate);
    // ---- ★BJ704-G2（债① 585 员）：通用残影（Main.cs:30609+:31062-31067 P(1,7,1,0.2),
    //      先于本体=原版层序）。bodyRot=本体当前角（mirror-right 含左飞 +π）;
    //      mirror=本体当前翻转（mode0 ghost 恒吃 dir,Main.cs:31334）;
    //      bodyW/H=SetDefaults 盒（26×26=Size/2 锚）,帧锚=当前帧行（缺省档）。 ----
    if (this.ghostRing && img && img.width > 0) {
      drawProjGhosts(ctx, {
        ring: this.ghostRing,
        id: this.projId,
        tex: img,
        frames: projFrameCount(this.projId),
        frame: fIdx,
        bodyW: this.w, bodyH: this.h,
        bodyRot: ang,
        bodyScale: 1,
        bodyAlpha: 1,          // GetAlpha lerpkeep：A 面 255 恒（白化=光照域,登记②）
        ai0: 0, ai1: 0,
        timeLeft: this.life,
        opacity: 1,
        vxLen: Math.hypot(this.vx, this.vy),
        spriteDirection: this.vx < 0 ? -1 : 1,
        mirror: this.vx < 0,   // 585 mirror-right 族：spriteDirection=direction
      });
    }
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.rotate(ang);
    // 水平镜像族:mirror-right(585 :54715)/up-mirror(930 :44844)/upright-mirror(880 AI_183)
    if ((spec.rot === 'mirror-right' || spec.rot === 'up-mirror' || spec.rot === 'upright-mirror')
      && this.vx < 0) ctx.scale(-1, 1);
    if (img && (img.width > 0) && img.width > 0) {
      // 源切片直取(9 参 drawImage,不走 projFrameImg 的 document 依赖):
      // 横向条(589/590)切列 / 竖排行(585/880)切行 / 单帧整图(cols=0 勿除零)
      const cols = spec.cols;
      const rows = cols > 0 ? 1 : projFrameCount(this.projId);
      const cw = cols > 0 ? img.width / cols : img.width;
      const ch = cols > 0 ? img.height : img.height / rows;
      const sx = cols > 0 ? fIdx * cw : 0;
      const sy = cols > 0 ? 0 : fIdx * ch;
      // 原生帧尺寸 × SetDefaults scale(589 曾整条 100×28 压进 10×10、590 压成 14×2.9)
      const s = this.drawScale;
      // 586 净化脉冲:scale = age/100 钳 1(AI_111 :38729-38733)
      const gs = spec.rot === 'grow' ? Math.min(1, Math.max(0.02, age / 100)) : 1;
      const dw = cw * s * gs, dh = ch * s * gs;
      ctx.drawImage(img, sx, sy, cw, ch, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.fillStyle = '#D8C8A0';
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.restore();
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ---- ★通用湿段（:16895-17113,共享体;溅花尘/音=wetSplashStepShared 弹面 10 粒）----
    //  tick 头插位（杀拍覆盖/采样位论证见字段块头注）;15 水death 经 hooks.kill。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater,
      PROJ_DESTROYED_BY_WATER.has(this.projId) ? { kill: () => { this.dead = true; } } : undefined);
    if (this.dead) return;   // 段内水death（15）——vanilla `!active` 门(:17132)截 Damage/位移同相
    if (--this.life <= 0) { if (this.projId === 669) this.kill669(game); this.dead = true; return; }
    if (!this.noGrav) this.vy += GRAV;
    // 翻滚/自旋累积(aiStyle 2 :21517 / 自旋款)——up20 前 20t 由姿态锁覆盖
    const spec = townDrawSpec(this.projId);
    const age = this.age0 - this.life;
    if (spec.rot === 'tumble' || (spec.rot === 'up20' && age > 20)) {
      this.rotAcc += (Math.abs(this.vx) + Math.abs(this.vy)) * 0.03 * (this.vx >= 0 ? 1 : -1);
    } else if (spec.rot === 'spin') {
      this.rotAcc += spec.spinRate;
    }
    // 水中位移阻尼（HandleMovement :17721-17764 湿支只在 tileCollide 时进——
    // tileCollide=false 型（721/豁免 590·606·950·880）档位不消费,位移全速;
    // 受段型乘进位移行,速度场 vx/vy 不减）
    const df = projectileData(this.projId)?.tileCollide !== false ? projWaterDragFactor(this) : 1;
    this.x += this.vx * df;
    this.y += this.vy * df;
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (game.world.store.isSolid(tx, ty)) {
      if (this.projId === 669) this.kill669(game);
      this.dead = true; return;
    }
    // ★BJ704-G2：UpdateTrails 位序（:17198 位移后;585 无 extraUpdates → 每拍一记）
    this.recordGhostTrail();
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean; def?: { hitSound?: string[]; friendly?: boolean } };
      // friendly 弹 × friendly 目标 → Damage_PVE_Inner :11898 return（同 kill669 段）
      if (e.dead || e.def?.friendly || !projOverlap(this.x, this.y, this.w, this.h, e)) continue;
      e.hurt(this.damage, Math.sign(this.vx) * this.knockback, 0, game, 0, false, 0, false);   // 音/飘值=单点
      // ★对抗修复批⑤ A5 注释拨正（原注「均为 penetrate 1 或 -1」与反编译不符）：
      //   实际 per SetDefaults——585=584=3(Projectile.cs:6349/:6356)、48=2(:1318)、
      //   其余发射型多为 -1(133/134/135/590:2225-2254 族)或 1。本仓管线仍近似
      //   单杀即亡;多穿缺口【登记台账】不动码(penetrate 计数/localNPCImmunity
      //   未建——批⑤范围外,后续批次清偿)
      this.dead = true;
      if (this.projId === 669) this.kill669(game);  // Kill() 爆炸(同敌免疫帧拦双吃)
      return;
    }
  }
}

// ==================== SW-BJ33 2026-09-08：公主 663 魔法阵 950（AI_186 域内专类） ====================
// 用户实报「公主魔法攻击怪物身上没有特效,只有凭空受伤害」。根因=发射端把 950 交给
// 通用 TownShot 承载:通用命中环「命中即亡」（上段 dead=true 杀位）,而 950 是【在敌
// 体内出生】的 104×104 定点阵（NPC.cs:55367 position+Size×rand(0..1)）→ tick1 命中
// =tick1 亡,全程零帧可见。原版面（本类逐项对齐）：
//   · SetDefaults P.cs:8958-8971：104×104/aiStyle186/friendly/magic/alpha255/
//     ignoreWater/timeLeft180/tileCollide=false/penetrate=-1;
//   · AI_186_PrincessWeapon P.cs:43453-43573：ai[0]>=60 自 Kill（timeLeft180 用不满,
//     实寿命 60t）;Opacity=Remap(t,0,60,1,0);scale=(0.4+0.6×easeOut²)×(1−Remap(t,45,60)²);
//     localAI[0]=(0.4+0.6×easeOut²(Remap(t,20,60)))×同尾;双环 d267 尘（环缘半径
//     52×scale,法向 ±45° 偏 6px,环1 vel=法向×−2×scale+v×0.5+position−vel×5,
//     环2 vel 被 :43517 覆写为 v×0.5〔v=0 → 静止〕）×3×½掷 + 白 CloneDust
//     （scale/2、fadeIn×0.85,:43499-43503/:43520-35）+ PrincessWeapon 编排粒子
//     ¼掷（:43538-43552,for(0..0.8) 单迭代;本仓 1:1 站 = orchestraFx.princessWeaponFx）
//     + t==50 四正交收束爆发 ×2 档速度 ×4 向（:43554-43572,PositionInWorld=Center）;
//   · 绘制 Main.cs:28735-28755：128 贴图四层叠画（白脸 inner=localAI[0]/粉 inner×0.95/
//     白脸 outer=scale/粉 outer×0.95）,A=0 纯加法惯用法 → canvas 'lighter';色=
//     hslToRgb(0.92,1,0.5)=(255,0,122)（Main.cs:48689-48724 hue2rgb 折算）;
//     ★SW-RB8c 2026-09-08 勘误：微光分支 color6=Color(255,0,30,180)（Main.cs:28740-45）
//     是【染色面】非白——常态白脸=(255,255,255,A0)、微光白脸 rgb=(255,0,30)（加法
//     分量 (153op,0,18op);曾误画白 (108op×3) 绿虚/红欠）;其 A=180 的 erase 分量
//     （dest×(1−0.42op)）canvas 'lighter' 单 pass 不可承载=A=0 家族既有口径登记
//     （VanillaDust.ts 同账）,加法分量按 1:1 修;
//   · 命中面 Damage_PVE_Inner P.cs:12615：penetrate=-1 → :14189 `penetrate>0` 减命
//     支不可达 = 命中【不亡】;:14182-14186 `penetrate!=1` → NPC.immune[owner]=10 =
//     同弹对同敌 10t 再命中窗（HitCdImpl 承接,每敌独立）;:13575-13577 case 950
//     damage×0.98【字段】逐击衰减——当前击用衰减前值,击后 (int) 截断（15→14→13…）;
//     击退向 num40=direction=Entity.cs:20 缺省 1（零速出膛全链无人改向,:13232 方向
//     覆写支 `!npcProj` 不适用）→ kb 恒 +3 右推（原版本相,勿按直觉"修"成朝向）;
//   · npcProj=true（NPC.cs:55514-55515）→ CutTiles 门 `!npcProj`（P.cs:12516）不割草;
//     tileCollide=false → 通用撞块杀不适用。
// 发射端（TownNPC.shootAt 663 支）= AttackTime 60 → 15/25/35/45/55 五阵/次。
// TOWN_DRAW_SPEC[950] 通用条目随本类退役保留（防御:他处若仍以通用 TownShot 生成
// 950,绘制面仍有 upright 形,不再登记）。

/** 950 环贴图离屏染色缓存（'source-in';key=色串。XNA 顶点色染面 canvas 等价） */
const ringTintCache = new Map<string, HTMLCanvasElement | null>();

function tintedRing(img: ImageBitmap | HTMLImageElement, color: string): HTMLCanvasElement | null {
  const hit = ringTintCache.get(color);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') { ringTintCache.set(color, null); return null; }
  try {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const c = cv.getContext('2d');
    if (!c) { ringTintCache.set(color, null); return null; }
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color;
    c.fillRect(0, 0, cv.width, cv.height);
    ringTintCache.set(color, cv);
    return cv;
  } catch {
    ringTintCache.set(color, null);
    return null;
  }
}

export class PrincessAuraShot extends TownShot {
  /** AI_186 ai[0]（:43455 逐 t++,≥60 Kill） */
  private t = 0;
  private readonly lifeT = 60;
  /** 绘制包络（fixedUpdate 逐拍成值,draw 消费） */
  opacity = 1;
  scl = 0.4;       // proj.scale（:43469）
  sclInner = 0.4;  // localAI[0]（:43474）
  /** 当前击伤害（=发射端 GetAttackDamage_ForTownNPC 终值;逐击 ×0.98 字段衰减 :13575） */
  private hitDmg: number;
  private readonly hitCd = new HitCdImpl();
  /** 微光变体 ai2==1 → 红阵（Main.cs:28742-28746） */
  private readonly red: boolean;

  /** (cx,cy)=阵心世界像素（=原版 NewProjectile X,Y 中心坐标语义）;ai2=townNpcVariationIndex */
  constructor(cx: number, cy: number, damage: number, knockback: number, ai2 = 0) {
    const def = projectileData(950);
    const hw = (def?.width ?? 104) / 2;
    const hh = (def?.height ?? 104) / 2;
    super(cx - hw, cy - hh, 0, 0, damage, knockback, 950, { noGravity: true, ai2 });
    this.hitDmg = damage;
    this.red = this.ai2 === 1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // 湿段共享体调用面保留（域纪律,NurseSyringeShot 先例）——950 ignoreWater=true
    //（P.cs:8966）→ 整段门恒闭零行为
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, true);
    if (this.dead) return;
    this.t++;
    if (this.t >= this.lifeT) { this.dead = true; return; }        // :43457-43461
    const u = this.t / this.lifeT;
    this.opacity = 1 - u;                                          // :43462
    const e1 = 1 - (1 - u) * (1 - u);                              // num3 :43464
    const e2 = 1 - (1 - e1) * (1 - e1);                            // num4 :43465
    const tail = Math.max(0, Math.min(1, (this.t - 45) / 15));     // num5 :43466 Remap(t,45,60)
    const tailInv = 1 - tail * tail;                               // num6-7 :43467-68
    this.scl = (0.4 + 0.6 * e2) * tailInv;                         // scale :43469
    const g8 = Math.max(0, Math.min(1, (this.t - 20) / 40));       // num8 :43471 Remap(t,20,60)
    const g9 = 1 - (1 - g8) * (1 - g8);                            // num9 :43472
    const g10 = 1 - (1 - g9) * (1 - g9);                           // num10 :43473
    this.sclInner = (0.4 + 0.6 * g10) * tailInv;                   // localAI[0] :43474
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const ringR = (this.w / 2) * this.scl;                         // num11×scale（:43478/:43511）
    // newColor = hslToRgb(0.92,1,0.5)×Opacity（:43477——(255,0,122),A=255×Opacity）
    const col = { r: 255, g: 0, b: 122, a: Math.round(255 * this.opacity) };
    const rx = (nx: number, ny: number): number => nx * Math.SQRT1_2 - ny * Math.SQRT1_2;   // RotatedBy(π/4)
    const ry = (nx: number, ny: number): number => nx * Math.SQRT1_2 + ny * Math.SQRT1_2;
    if (u < 0.9) {                                                 // :43478/:43506 双环门
      for (const ring of [0, 1] as const) {                        // :43480 环1 / :43507 环2
        for (let i = 0; i < 3; i++) {                              // ×3（:43481/:43508）
          if (Math.random() >= 0.5) continue;                      // Next(2)==0（:43482/:43509）
          const a = Math.random() * Math.PI * 2;                   // UnitX.RotatedBy(rand×τ)
          const nx = Math.cos(a), ny = Math.sin(a);
          const px = cx + nx * ringR + rx(nx, ny) * (ring === 0 ? 6 : -6);   // :43486 +6 / :43513 −6
          const py = cy + ny * ringR + ry(nx, ny) * (ring === 0 ? 6 : -6);
          // 环1 vel=法向×−2×scale（+v×0.5=0）;环2 vel 被 :43517 覆写为 v×0.5=0（视觉死写照抄）
          const vx = ring === 0 ? rx(nx, ny) * -2 * this.scl : 0;
          const vy = ring === 0 ? ry(nx, ny) * -2 * this.scl : 0;
          const d = game.spawnDust?.(px, py, 0, 0, 267, vx, vy, 0, col, 0.3, true);
          if (d) {
            d.fadeIn = Math.random() * 1.2 * this.scl;             // :43494/:43510
            d.scale = 0.3 * this.scl;                              // :43496/:43512 ×= scale（proj scale）
            d.x -= d.vx * 5; d.y -= d.vy * 5;                      // :43498 position += velocity×−5（环2 vel=0 → 无偏移）
          }
          // CloneDust 白影（:43499-43503/:43520-35）scale/2、fadeIn×0.85、白、零掷
          const w = game.spawnDust?.(d ? d.x : px, d ? d.y : py, 0, 0, 267, vx, vy, 0,
            { r: 255, g: 255, b: 255, a: 255 }, 0.15, true);
          if (w) {
            w.scale = 0.15 * this.scl;
            w.fadeIn = (d ? (d.fadeIn ?? 0) : 0) * 0.85;
          }
        }
      }
    }
    // PrincessWeapon 编排粒子 ¼掷（:43538-43552;MovementVector=velocity=0）
    if (u < 0.95 && Math.random() < 0.25) {
      const a = Math.random() * Math.PI * 2 + Math.PI / 2;         // UnitX.RotatedBy(rand×τ+π/2)
      princessWeaponFx(game, cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR, this.vx, this.vy);
    }
    // t==50 收束爆发（:43554-43572）：四正交 ×{1,2} 档速度,PositionInWorld=Center
    if (this.t === this.lifeT - 10) {
      for (let q = 0; q < 4; q++) {
        const a = (Math.PI * 2 * q) / 4;
        princessWeaponFx(game, cx, cy, Math.cos(a), Math.sin(a));
        princessWeaponFx(game, cx, cy, Math.cos(a) * 2, Math.sin(a) * 2);
      }
    }
    // ---- 命中面（penetrate=-1 命中不亡;同敌 10t 窗;×0.98 逐击衰减）----
    this.hitCd.tick();
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean; id?: number; uid?: number;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
        def?: { friendly?: boolean } };
      if (e.dead || e.def?.friendly) continue;
      if (!projOverlap(this.x, this.y, this.w, this.h, e)) continue;
      const eid = e.id ?? e.uid ?? 0;                              // NPC 索引位（immune[owner] 槽）
      if (!this.hitCd.ready(eid, 10)) continue;                    // :14182-86 NPC.immune[owner]=10
      e.hurt(this.hitDmg, this.knockback, 0, game, 0, false, 0, false);   // num40=direction=1（Entity.cs:20）
      this.hitDmg = Math.max(1, Math.trunc(this.hitDmg * 0.98));   // :13575-77 字段衰减（下钳 1=域口径防 0 伤死循环）
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(950);
    if (!img || img.width <= 0) return;    // 环贴图缺失 → 静默（尘/编排粒子仍可见;不用通用兜底盒——104 判定盒≠128 贴图）
    const pink = tintedRing(img, this.red ? 'rgb(255,0,61)' : 'rgb(255,0,122)');   // hue 0.92 / 0.96
    // Main.cs:28752-28755 四层叠画,A=0 纯加法 → 'lighter';×0.6 亮度 ×Opacity 进 globalAlpha。
    // color6 脸面：常态=白 A0;微光分支=Color(255,0,30,180)（:28740-45）→ ★SW-RB8c
    // 2026-09-08 勘误：加法分量按 rgb(255,0,30) 染色画(153op,0,18op)（曾画白=绿虚红欠）;
    // A=180 的 erase 分量（dest×(1−0.42op) 贴图 α 域）'lighter' 单 pass 不可承载
    // =A=0 家族登记债（VanillaDust.ts 同账）
    const face = this.red ? tintedRing(img, 'rgb(255,0,30)') : img;
    const op = Math.max(0, this.opacity);
    const whiteA = op * 0.6;
    const pinkA = op * 0.6;
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;      // XNA spriteBatch 线性采样面（软辉环,非像素锁面）
    const layer = (tex: CanvasImageSource | null, s: number, alpha: number): void => {
      if (!tex || alpha <= 0) return;
      ctx.globalAlpha = alpha;
      const d = img.width * s;             // 128 贴图 × scale（origin=Size/2 中心 :28740）
      ctx.drawImage(tex, -d / 2, -d / 2, d, d);
    };
    layer(face, this.sclInner, whiteA);    // :28752 color6 脸 inner（常态白/微光 255,0,30）
    layer(pink, this.sclInner * 0.95, pinkA);   // :28753 粉 inner
    layer(face, this.scl, whiteA);         // :28754 color6 脸 outer
    layer(pink, this.scl * 0.95, pinkA);   // :28755 粉 outer
    ctx.restore();
  }
}

// ==================== ★BJ256 2026-09-21：树妖净化脉冲 586（AI_111 域内专类） ====================
// 用户实报「树妖好像不会释放树妖祝福」。定谳=机制面（buff 165 玩家/186 敌怪/自 ward/
// 600t 施法循环）2026-08-31 台账批已 1:1 且实机探针全绿；真缺口=视觉面：发射端曾把
// 586 交给通用 TownShot——有靶时坠入 160/663 落点弹支（弹体出生在目标身上）、通用
// 命中环「命中即亡」（0 伤也 dead）+无 noGrav 坠地撞块杀+寿命 3600——五轴全偏，施法
// 全程零帧可见（与 SW-BJ33 公主 950 同病灶）。原版面（P.cs:41871-41977 +
// Main.cs:32404-32440）本类逐项对齐：
//   · SetDefaults P.cs:6360-6368：26×26/aiStyle111/alpha255/friendly/penetrate=-1；
//   · 出膛（NPC.cs:55531-55536）：Center+(spriteDirection×16,−2) 原地固定，
//     velocity = DirectionTo(目标)×num63（20 型 num63=0f 未赋值 → 速度恒 0，
//     :55394 声明 + :55486 乘），ai1=ownerNPC whoAmI/ai2=townNpcVariationIndex；
//   · AI_111：owner 消亡/离 ai[0]=14 态 → Kill（:41873-77）；age≥570 Kill（:41973）；
//     rotation += π/300（age≥500 再加一次：:41879/:41899）；scale=age/100 钳 1
//     （:41880-41884）；alpha=(int)(255×(1−scale))，≥500 → Lerp(0,255,(age−500)/100)
//     渐隐（:41885/:41895-41900）；
//   · 半径（:41886-41900，Main.cs:32407-32419 同式）：出生 300 → 100t 起 Lerp 至
//     600 → 500t 起 Lerp 至 1200（视觉环/尘/施加域同径）；
//   · 绘制 Main.cs:32404-32440：内环 10 叶（半径/3，angle=rot+π/5×i）+外环 20 叶
//     （全半径，angle=(−rot+π/10×j)×2 逆向双速），帧=(age/6+i)%5（24×80 五帧叶，
//     Frame(1,5)），origin=帧中心（rectangle9.Size()/2），逐叶 Lighting.GetColor
//     采样 → GetAlpha(×(255−alpha)/255) → A/=2；canvas 等价 = 离屏三步（叶帧 →
//     multiply 乘色 → destination-in 还 α）+ globalAlpha=f/2（★f 折进乘色 rgb=
//     f×light/255——XNA 预乘贡献 = tex×light×f×texA×f/2，canvas 通道乘不上 α，
//     拆「乘色入 rgb + globalAlpha 入 α」两处写入=合成贡献精确等价；tintIconRect
//     Renderer.ts:1586 同族三步法；像素锁面 imageSmoothing=false）；
//   · 命中面：penetrate=−1（:14189 `penetrate>0` 减命支不可达=命中不亡）+
//     damage≡0（num62=0 → GetAttackDamage_ForTownNPC(0×num2)=0，:55471）→ 零战斗
//     效果；buff/bane 施加面在 TownNPC.updateDryadWardAura（AI_111 :41947-41972
//     直驱，台账批 2026-08-31）不在弹体——本类 fixedUpdate 不含命中环（通用
//     TownShot「命中即亡」对 586 是伪影）；
//   · 尘面（AI_111 :41901-41946）由 updateDryadWardAura 同批 1:1（环缘向心尘 +
//     30px 尘两支；微光变体 ai2==1 正弦混金尘 70）。
/** 叶帧离屏乘色 scratch（BJ256;24×16 恒尺寸,tintIconRect Renderer 同族） */
const dryadLeafScratch = typeof document !== 'undefined' ? document.createElement('canvas') : null;

export class DryadWardRingShot extends TownShot {
  /** AI_111 ai[0]（弹龄,:41878 逐 t++,≥570 Kill） */
  private t = 0;
  /** proj.rotation（:41879 += π/300;age≥500 双加 :41899） */
  private rot = 0;
  /** owner 存活门（:41873 `!Main.npc[ai[1]].active || type != 20 || ai[0] != 14f`；
   *  TownNPC.wardCasting getter 承接 ai[0]==14 面） */
  private readonly owner: { dead: boolean; wardCasting: boolean };

  /** (cx,cy)=出膛中心（原版 NewProjectile X,Y 语义 = Center+(dir×16,−2)）;
   *  ai2 = townNpcVariationIndex（微光变体金尘混入比 surface,本类不消费尘面仅存档） */
  constructor(cx: number, cy: number, ai2: number, owner: { dead: boolean; wardCasting: boolean }) {
    const def = projectileData(586);
    const hw = (def?.width ?? 26) / 2;
    const hh = (def?.height ?? 26) / 2;
    super(cx - hw, cy - hh, 0, 0, 0, 3, 586, { noGravity: true, ai2 });
    this.owner = owner;
  }

  override fixedUpdate(_dt: number, game: GameHooks): void {
    // 湿段共享体调用面保留（域纪律,PrincessAuraShot 先例）——586 无 ignoreWater
    //（vanilla-projectiles.json 面）→ 段门照走;无位移 → 拖曳项零消费
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    if (this.dead) return;
    // Kill 门 :41873-41877（owner 消亡/离施法态）+ :41973-41976（age≥570）
    if (this.owner.dead || !this.owner.wardCasting || ++this.t >= 570) {
      this.dead = true;
      return;
    }
    this.rot += Math.PI / 300;              // :41879
    if (this.t >= 500) this.rot += Math.PI / 300;   // :41895-41900 内第二加
    // 位移/重力/命中全无——AI_111 不动弹（velocity 恒 0）+ 落点弹注 :55525-55537
    // 无 num70 守卫 = 出膛块无条件,弹体 AI 无 tileCollide 消费面
  }

  /** 视觉半径（Main.cs:32407-32419 = AI_111 :41886-41900 同式;300→600→1200） */
  private static auraRadius(age: number): number {
    let r = 300;
    if (age >= 500) r = 600 + (1200 - 600) * Math.min(1, (age - 500) / 100);
    else if (age >= 100) r = 300 + (600 - 300) * Math.min(1, (age - 100) / 200);
    return r;
  }

  override draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(586);
    if (!img || img.width <= 0 || img.height <= 0) return;   // 叶帧缺失 → 静默（尘仍可见）
    const age = this.t;
    const radius = DryadWardRingShot.auraRadius(age);
    const scale = Math.min(1, age / 100);                    // proj.scale（:41880-84）
    // alpha（:41885/:41895-41900）——0=全显,255=全隐;100-500t 恒 0（全显段）
    let alpha: number;
    if (age >= 500) alpha = ((age - 500) / 100) * 255;
    else alpha = 255 * (1 - scale);
    const f = Math.max(0, Math.min(1, (255 - alpha) / 255)); // GetAlpha 因子（:4319 族）
    if (f <= 0) return;                                      // 全隐帧免画（age0 拍）
    const fw = img.width;                                    // 帧 24
    const fh = img.height / 5;                               // 五帧行 Frame(1,5) → 16
    const frameIdx = Math.floor(age / 6);                    // num264（:32416）
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const scratch = dryadLeafScratch;
    const scratchCtx = scratch?.getContext('2d') ?? null;
    if (scratch) {
      if (scratch.width !== fw || scratch.height !== fh) { scratch.width = fw; scratch.height = fh; }
      scratchCtx!.imageSmoothingEnabled = false;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // 单叶绘制（闭包内 lightAt 采样 → 离屏三步 → 旋转直画）
    const leaf = (angle: number, frameRow: number, dist: number): void => {
      const lx = cx + Math.sin(angle) * dist;                // (0,−num263).RotatedBy(angle)
      const ly = cy - Math.cos(angle) * dist;                //   = (sin·d, −cos·d)+C
      const lt = r.lighting?.lightAt(Math.floor(lx / 16), Math.floor(ly / 16)) ?? [255, 255, 255];
      const sx = 0;
      const sy = frameRow * fh;
      if (scratch && scratchCtx) {
        scratchCtx.clearRect(0, 0, fw, fh);
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.drawImage(img, sx, sy, fw, fh, 0, 0, fw, fh);
        scratchCtx.globalCompositeOperation = 'multiply';
        scratchCtx.fillStyle = `rgb(${Math.round(lt[0] * f)},${Math.round(lt[1] * f)},${Math.round(lt[2] * f)})`;
        scratchCtx.fillRect(0, 0, fw, fh);
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.drawImage(img, sx, sy, fw, fh, 0, 0, fw, fh);
        scratchCtx.globalCompositeOperation = 'source-over';
      }
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(angle);
      ctx.globalAlpha = f / 2;                               // alpha8.A /= 2（:32427/:32438）
      // ★BJ260-F2（S6）：叶精灵乘 proj.scale——原版 EntitySpriteDraw 尾参 scale
      //  （:32428/:32439,1458 :32430/:32440 同值）,生长窗 age<100 时 scale=age/100
      //  （AI_111 :41880-41884）→ 叶从小长满;旧写恒全尺寸=出膛 100t 内叶偏大。
      //  origin=帧中心（rectangle.Size()/2）→ 缩放围绕中心,canvas 尺寸 ×scale 等价。
      const lw = fw * scale, lh = fh * scale;
      if (scratch) ctx.drawImage(scratch, -lw / 2, -lh / 2, lw, lh);
      else ctx.drawImage(img, sx, sy, fw, fh, -lw / 2, -lh / 2, lw, lh);   // 无 scratch 环境（node 测试）=未乘色直画
      ctx.restore();
    };
    // 内环 10 叶（:32421-32430）：半径/3、angle=rot+π/5×i、帧 (base+i)%5
    // （(0,−num263).RotatedBy(θ) = (r·sinθ, −r·cosθ)——dist 传正半径,负号已含在 ly 式）
    for (let i = 0; i < 10; i++) {
      leaf(this.rot + (Math.PI / 5) * i, (frameIdx + i) % 5, radius / 3);
    }
    // 外环 20 叶（:32431-32440）：全半径、angle=(−rot+π/10×j)×2（逆向双速）、帧 (base+j)%5
    for (let j = 0; j < 20; j++) {
      const ang = (-this.rot + (Math.PI / 10) * j) * 2;
      leaf(ang, (frameIdx + j) % 5, radius);
    }
    ctx.restore();
  }
}
