// 火之大剑 Volcano(type 121) 星坠爆弹 978（ProjectileID.Volcano，aiStyle 189）本体移植。
// 对齐清零批 ⑤：Volcano_TrySpawningVolcano（Player.cs:44496-44506）首个受理命中
// 消费 _spawnVolcanoExplosion 窗口后于受害者中心 NewProjectile(…,0f,-1f*gravDir,
// 978,(int)damage,knockBack,whoAmI,0f,2f)，damage = ProcessHitAgainstNPC 局部 damage
// （★R2-01/07 起为 rapid/banner/parry/breaker/hambat/keybrand 全乘区后的 chainDmg）
// ×0.75 截断（Player.cs:44853 调用侧 (int)((float)damage*0.75f)）。
//
// 弹体 SetDefaults（Terarria1457/Terraria/Projectile.cs:9255-9271）逐行：
//   width=160 height=160 aiStyle=189 friendly=true alpha=255 ignoreWater=true
//   （:9262——★湿段定谳 2026-09-06：豁免,P.cs:16903 湿段整段门不开,不接
//   projectileWetSection;AI_189 亦无位移改写面）
//   timeLeft=60（同函数 :9270 复写为终值 30） tileCollide=false ownerHitCheck=true
//   penetrate=3 usesLocalNPCImmunity=true localNPCHitCooldown=-1 melee=true
// 命中 debuff：StatusNPC `if (type == 978) nPC.AddBuff(24, 180)`（Projectile.cs:11365）
//   ——applyProjStatus 表 vanilla-projstatus.json['978'] 同源（src=11365），On Fire! 3s。
// 方向锚：`type == 612 || type == 953 || type == 978 → direction =
//   Main.player[owner].direction`（Projectile.cs:13131-13134，击退向兜底用）。
// AI_189_Volcano（Projectile.cs:43034-43141）：
//   · soundDelay==0 → 播 SoundID.DD2_ExplosiveTrapExplode 并置 soundDelay=-1（一次性）
//   · alpha = (int)(255 * Remap(ai0,0,2,0,1) * Remap(ai0,6,10,1,0))——前 2t 渐显、
//     6..10t 渐隐（Remap 边界外钳制）
//   · scale = 1 + ai[0]/15（:43046，978 非 flag 支；flag 支=1125 不适用）
//   · ++frameCounter ≥2 → 清零 + ++frame ≥5 → Kill()（:43050-43060，寿命 ≈10t，
//     先于 timeLeft 终值 30）
//   · ai[0]++ 每 tick（:43121）
//   · 无位移改写面：velocity 只在出生向量（0,-gravDir)，AI 不动 velocity，位置按
//     通用 update 直线推进（tileCollide=false 不撞块、ignoreWater 不水减速）。
// ★R2-08（蓝队二轮）：死亡尘爆面（ai[0]==1 拍 :43065-43094——20 尘 6/259/158 +
//   Next(3,7)×5 尘 31 烟 + Next(3,7) gore 61..63，RotatedBy 轴 = 出生速度 ±π/4×num4）
//   与全程呼吸尘烟面（:43097-43137 两循环逐值移植）落地。
// ★R2-04/R2-05（蓝队二轮）命中闸门补齐：
//   · immune[owner] 全局窗门（Damage_PVE_Inner :12641-46
//     `if (!((owner<0||targetNPC.immune[owner]==0)|flag3)) return;`——978 penetrate=3
//     且 usesLocalNPCImmunity=true ⇒ flag3=false ⇒ 门生效；被近战/弹幕刚命中的敌怪
//     本拍不重复受理。命中落地后写 usesLocalNPCImmunity 族免疫窗清零段（GC1 出口
//     noteNpcPlayerImmune(id,0)：Projectile.cs:14177 新命中面覆盖前窗）；
//   · ownerHitCheck 视线/距离门（:12659 `(!targetNPC.noTileCollide && ownerHitCheck
//     && !CanHitWithMeleeWeapon(targetNPC))` → return）：Distance>1000px 拒收
//     （ownerHitCheckDistance 默认值 Projectile.cs:306）；CanHitWithMeleeWeapon
//     （Projectile.cs:12415-25）的 B/C/D 三条手位锚与 Player.CanHit(Entity)
//     （Player.cs:42857-65）字面同式 ⇒ 整链复用 playerCanHitEntity 承载。
//   · 击退参照系（:13669-72 aiStyle∈188..191）：num40 =
//     Main.player[owner].Center.X < targetNPC.Center.X ? 1 : -1——以【玩家中心】
//     为参照而非弹心/相对符号。
//   · 暴击面 live 化（Damage :12850 crit=false 起、:12898+ `melee &&
//     Main.rand.Next(1,101)<=Main.player[owner].meleeCrit` 于 Strike 时点掷）：
//     注入口 critChanceFn 由调用方接实时闭包，弃用出生期冻结数值。
//     ★BJ-C2/F14（2026-10-06）重定谳：旧注「proc 不吃武器 item.crit 为越权」证伪——
//     Player.cs:25712-25714 每帧 `meleeCrit/magicCrit/rangedCrit +=
//     inventory[selectedItem].crit`（三系无条件,词缀 crt 重铸期已折进 item.crit,
//     Item.cs:585）→ :12898 掷面 meleeCrit【含】持械 item.crit+crt（BJ486③ 同源
//     定谳）。注入口算式 = 0.04+(player.critChance('melee')+heldItemCritBonus)/100。
import { Entity } from './Entity';
import { projSprite } from './Arrow';
import { applyProjStatus } from './projStatus';
import { hitCritters, playerCanHitEnemy, applyBannerDamageDealt } from './projTargets';
import { snapshotVanillaGate, vanillaGateRejected, ghostHealProc } from './SpectreSoulProj';   // ★Q4 刀：门位快照单源（T 刀,856 同款）;★清偿刀 U2（2026-10-01）补 978 ghostHeal 白耗面（S2 台账家族债）
import { damageVarRoll } from '../stats/DamageVar';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { GorePiece } from './GorePiece';
import { cutTilesBox } from './ProjCutTiles';   // ★BJ285 死亡段割面（BJ260 同款前置习语）
import type { GameHooks } from './types';
import { playerCanHitEntity } from '../physics/LineOfSight';
import { runModModifyHitNpcByProj } from '../mods/hooks';   // ★D2:独立结算面补钩

/** Utils.Remap 直移植（单调映射 + 边界外钳制）：Remap(v,inA,inB,outA,outB)。 */
function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return value < inMin ? outMin : outMax;
  const t = Math.min(1, Math.max(0, (value - inMin) / (inMax - inMin)));
  return outMin + (outMax - outMin) * t;
}

/** 向量旋转（Vector2.RotatedBy）。 */
function rot(x: number, y: number, ang: number): [number, number] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [Math.fround(x * c - y * s), Math.fround(x * s + y * c)];
}

/** Utils.SelectRandom<int>(Main.rand, 6, 259, 158) 等价表序抽取。 */
function selectFireDustType(): number {
  return [6, 259, 158][Math.floor(Math.random() * 3)];
}

/** NewDustPerfect 圆域采样底座：Center±NextVector2Circular(8,8)。 */
function circularJitter(): number {
  return Math.random() * 16 - 8;
}

interface FireEnemyLike {
  id: number; x: number; y: number; w: number; h: number; cx?: number; cy?: number;
  dead: boolean;
  hurt: (dmg: number, kx: number, ky: number, g: GameHooks, pen?: number,
    crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
}

export class VolcanoBlastProj extends Entity {
  /** SetDefaults :9257-9258 —— 160×160 判定盒 */
  w = 160; h = 160;
  damage: number;
  knockback: number;
  /** ★R2-04：live 注入口（Strike 时点实时取玩家近战 crit；★BJ-C2/F14 重定谳——
   *  掷面 meleeCrit 含 :25712-14 持械 item.crit+crt 折入（原「不吃武器暴击」定谳
   *  证伪,见文件头注）= () => 0.04 + (player.critChance('melee')
   *  + heldItemCritBonus(held))/100，调用方注入）。 */
  critChanceFn: (() => number) | null = null;
  /** 兼容读面：旧测试/调试读取 .critChance 时折算 live 值。 */
  get critChance(): number {
    return this.critChanceFn ? this.critChanceFn() : 0.04;
  }
  armorPen = 0;
  /** ★清偿刀 U2（2026-10-01）：Projectile.numHits 等位（:14263 每受理命中自增——
   *  ghostHeal 率 0.2−0.05n 衰减计数源;proc 读自增前值） */
  pveNumHits = 0;
  /** :13131 —— direction = Main.player[owner].direction */
  direction = 1;
  /** penetrate :9266 —— 3 次，穿完即消亡 */
  private penLeft = 3;
  /** usesLocalNPCImmunity=true / localNPCHitCooldown=-1（:9267-9268）——
   *  -1 = 该目标对本弹【永久】免疫 ⇒ 每目标至多结算一次 */
  private hitSet = new Set<number>();
  private frame = 0;
  private frameCounter = 0;
  /** soundDelay 一次性门（AI_189 :43035-43039 的 soundDelay==0→-1 面） */
  private soundPlayed = false;
  /** ai[0] 计龄（Remap/scale/死亡爆支消费）；ai[1]=NewProjectile 尾参 2f，
   *  aiStyle189 不读，字段保留对账。 */
  private ai0 = 0;
  readonly ai1 = 2;
  /** timeLeft 终值 30（SetDefaults :9263 被 :9270 复写）——frame 死门的兜底上限 */
  private lifeLeft = 30;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number, direction: number) {
    super();
    // 出生点 = 受害者 center.X/Y（Player.cs:44500-44501 Vector2 center = npc.Center）
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;           // (0, -gravDir)=(0,-1)：AI 不再改写
    this.damage = damage;
    this.knockback = knockback;
    this.direction = direction || 1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (!this.soundPlayed) {              // :43035-43039
      this.soundPlayed = true;
      game.playSfx('dd2Explosive', 1, this.cx, this.cy);
    }
    // —— ★R2-08 死亡尘爆面（ai[0]==1 拍 :43065-43094；num=num2=8 圆域采样）——
    this.ai0++;                           // :43121 先增后判 `ai[0]==1f`
    if (this.ai0 === 1) {
      // ① 20 尘 {6,259,158}：v=RotatedBy(vel, ±π/4×num4(0.6))×(2+5rf)、α200
      for (let i = 0; i < 20; i++) {
        const [dvx, dvy] = rot(this.vx, this.vy, (Math.random() * 2 - 1) * (Math.PI / 4) * 0.6);
        const spd = 2 + 5 * Math.random();
        const d = game.spawnDust?.(
          Math.trunc(this.cx - 8 + circularJitter()), Math.trunc(this.cy - 8 + circularJitter()),
          10, 10, selectFireDustType(), dvx * spd, dvy * spd, 200, null, 1 + Math.random());
        if (d) { d.vx = dvx * spd; d.vy = dvy * spd; }   // NewDustPerfect：速度不带池抖动
      }
      // ② 烟尘 31：n=Next(3,7)=3..6 → ×5 发，noGravity、vel×3、α50（:43083-43094）
      const smokeN = 3 + Math.floor(Math.random() * 4);
      for (let j = 0; j < smokeN * 5; j++) {
        const [svx, svy] = rot(this.vx, this.vy, (Math.random() * 2 - 1) * (Math.PI / 4) * 0.6);
        const spd = 2 + 5 * Math.random();
        const d = game.spawnDust?.(
          Math.trunc(this.cx - 8 + circularJitter()), Math.trunc(this.cy - 8 + circularJitter()),
          10, 10, 31, svx * spd, svy * spd, 50, null, 1 + Math.random());
        if (d) {
          d.noGravity = true;
          d.vx = svx * spd * 3;
          d.vy = svy * spd * 3;
        }
      }
      // ③ gore 61+Next(3)=61..63：v=RotatedBy(…)×NextFloat（NewGorePerfect 形态，
      //    :43095-43102 前 gore 段 0+4rf 速）
      const goreN = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < goreN; k++) {
        const [gvx, gvy] = rot(this.vx, this.vy, (Math.random() * 2 - 1) * (Math.PI / 4) * 0.6);
        const spd = 4 * Math.random();
        GorePiece.newGore(61 + Math.floor(Math.random() * 3),
          this.cx - 16 + circularJitter(), this.cy - 16 + circularJitter(),
          gvx * spd, gvy * spd, 1, true);               // NewGorePerfect（无初速扰动）
      }
    }
    // —— ★R2-08 全程呼吸尘烟（:43097-43137 两循环逐值）——
    // ① l<2 循环：Next(3)<2 通过 → 尘 6（RotatedBy(±π/4)×(1.5+2rf)、α90、scale 2.5、
    //    fadeIn=1），其中 Next(6)<3 分支改重力着地/无光/β0.4/scale×0.3，否则
    //    velocity = DirectionFrom(position)×length×0.25（弹心反向收束四分之一档）
    for (let l = 0; l < 2; l++) {
      if (Math.floor(Math.random() * 3) >= 2) continue;       // Next(3)<2 通过
      const speed = 1.5 + 2 * Math.random();
      let dx = this.vx, dy = this.vy;
      {
        const a = (Math.random() * 2 - 1) * (Math.PI / 4);    // RotatedBy(±π/4)
        const c = Math.cos(a), s = Math.sin(a);
        dx = this.vx * c - this.vy * s;
        dy = this.vx * s + this.vy * c;
      }
      const pxj = this.cx + circularJitter(), pyj = this.cy + circularJitter();
      const d = game.spawnDust?.(
        Math.trunc(pxj) - 5, Math.trunc(pyj) - 5,
        10, 10, 6, dx * speed, dy * speed, 90, null, 2.5);
      if (!d) continue;
      d.fadeIn = 1;
      if (Math.floor(Math.random() * 6) < 3) {
        d.noGravity = false;
        d.noLight = true;
        d.fadeIn = 0.4;
        d.scale *= 0.3;
      } else {
        d.noGravity = true;
        const flen = Math.hypot(dx * speed, dy * speed);
        if (flen > 0) {
          // DirectionFrom(dust.position)：弹→尘方向归一 × length×0.25
          d.vx = Math.fround(((pxj - this.cx)) / Math.hypot(pxj - this.cx, pyj - this.cy || 1) * flen * 0.25);
          d.vy = Math.fround(((pyj - this.cy)) / Math.hypot(pxj - this.cx, pyj - this.cy || 1) * flen * 0.25);
        }
      }
    }
    // ② m<2 循环：!(randf<0.5) 门 → 半数档 {6,259,158}（RotatedBy±π/4×0.5×(1+2rf)
    //    后 ×(0.6,1.5) 双轴缩放）、α200、scale 1+rf
    for (let m = 0; m < 2; m++) {
      if (Math.random() < 0.5) continue;
      const [bvx, bvy] = rot(this.vx, this.vy, (Math.random() * 2 - 1) * (Math.PI / 4) * 0.5);
      const spd = 1 + 2 * Math.random();
      const d = game.spawnDust?.(
        Math.trunc(this.cx - 8 + circularJitter()), Math.trunc(this.cy - 8 + circularJitter()),
        10, 10, selectFireDustType(),
        bvx * spd * 0.6, bvy * spd * 1.5, 200, null, 1 + Math.random());
      if (d) { d.vx = bvx * spd * 0.6; d.vy = bvy * spd * 1.5; }
    }
    // alpha 渐显渐隐曲线（:43038）
    this.alphaTick = remap(this.ai0, 0, 2, 0, 1) * remap(this.ai0, 6, 10, 1, 0);
    if (++this.frameCounter >= 2) {       // :43050-43060
      this.frameCounter = 0;
      if (++this.frame >= 5) { this.dead = true; return; }   // Kill()
    }
    // 通用位移推进（velocity 恒定、tileCollide=false 免碰撞）
    this.x += this.vx;
    this.y += this.vy;
    if (--this.lifeLeft <= 0) { this.dead = true; return; }
    // —— Projectile.Damage 敌怪面：截断盒相交（Rectangle((int)x,(int)y,w,h).Intersects）
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（P.cs:12517）在 Damage() 内
    //  先于 Damage_PVE（:12523）——978 penetrate=3 计数耗尽即亡拍【照割】（SetDefaults
    //  :9255-9271,aiStyle 189/friendly）;中央割 !e.dead 门=死亡拍整缺 → BJ260 前置
    //  习语。978 过两道门（CanCutTiles :15407 两表均无;Damage_CanDealDamage :12461 无）。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    const px = Math.trunc(this.x), py = Math.trunc(this.y);
    const pEnt = game.player as unknown as {
      x: number; y: number; w: number; h: number; cx: number; cy: number; facing?: number;
    };
    for (const rawEnt of game.enemies()) {
      const e = rawEnt as FireEnemyLike;
      if (!e || e.dead || this.hitSet.has(e.id)) continue;
      // ★dontTakeDamage 目标排除（:12600 同款——tryConsumingTimerCrit 在 hurt 前,
      //   被拒命中不得烧蓄能充能,终审补）
      if ((rawEnt as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      if (!playerCanHitEnemy(rawEnt as never, game)) continue;
      // ★R2-04 ①全局免疫窗（Damage_PVE_Inner :12636 `if (!((owner<0||
      //   targetNPC.immune[owner]==0)|flag3)) return;`——978 maxPenetrate=3∧
      //   usesLocalNPCImmunity=true ⇒ flag3(:12635)=false ⇒ 门生效）。
      //   ★Q4 刀 2026-09-30（C5 同族 P1 定谳#2 勘误,与 856 同病）：原门读【弹幕域】
      //   targetNPC.immune[owner] ≙ 本仓 Enemy.iframes 共享窗（清偿刀 T 单源
      //   snapshotVanillaGate 快照判据）——旧档 duck-call Game.meleeNpcImmuneGateOf
      //   读的是近战三重门的仓内独立簿（npcImmuneByAttacker,近战不写+清零桥面
      //   =事实恒空）⇒ 弹幕域有窗（他弹残窗 iframes>0）的敌被误放行/近战簿有窗
      //   被误拒。门拒 = 原文 return：不落 hitSet、penetrate 不减、弹体存活。
      const gate = snapshotVanillaGate(e);
      if (vanillaGateRejected(gate)) continue;
      if (!(px < Math.trunc(e.x) + e.w && Math.trunc(e.x) < px + this.w
        && py < Math.trunc(e.y) + e.h && Math.trunc(e.y) < py + this.h)) continue;
      // ★R2-04 ②ownerHitCheck（:12659）：noTileCollide 豁免 + 距离 1000px +
      //   三射线 LOS。CanHitWithMeleeWeapon（Projectile.cs:12415-25）= 距离门
      //   （ownerHitCheckDistance 默认 1000f :306）+ CanHitWithMeleeWeapon 的
      //   B/C/D 手位锚——与 Player.CanHit(Entity)（Player.cs:42857-65）字面同式，
      //   ⇒ 距离闭包外整链复用 playerCanHitEntity 承载。
      const ecx = Math.fround(e.cx ?? (e.x + e.w / 2));
      const ecy = Math.fround(e.cy ?? (e.y + e.h / 2));
      const dxT = ecx - this.cx, dyT = ecy - this.cy;
      const distOk = (dxT * dxT + dyT * dyT) <= 1000 * 1000;       // Distance(ent.Center)>1000 → false
      if (((e as unknown as { noTileCollide?: boolean }).noTileCollide !== true)) {
        // 距离门 + 整盒 CanHit(A 段)+手位三射线(B/C/D) 全链（Player.CanHit 同构）；
        // world.store 缺位（测试桩/工具面）退化为距离门放行——既有可选钩约定。
        const st = ((game.world as unknown as { store?: never } | undefined)?.store)
          ?? (game as unknown as { store?: never }).store;
        const okLos = distOk
          && (st ? playerCanHitEntity(st,
            game.player as unknown as { x: number; y: number; w: number; h: number },
            e as unknown as { x: number; y: number; w: number; h: number }) : true);
        if (!okLos) continue;
      }
      // ★R2-05 击退参照系（:13669-72 aiStyle∈188..191）：以【玩家中心】对照目标
      const kdir = ((pEnt?.cx ?? this.cx) < (e.cx ?? this.cx)) ? 1 : -1;
      // ★R2-04 ③Main.DamageVar ±15% + 暴击 ×2（crit 在 Strike 时点实时取玩家近战 crit）
      //   ★F9/F1（2026-08-31 蓝队三批）：DamageVar 单源 + Damage_PVE :13388 攻端旗乘区
      let crit = (this.critChanceFn?.() ?? 0.04) > Math.random();
      // ★F11：TryConsumingTimerCrit 强制暴击（Damage_PVE :12928，978 结算接入）
      if (((game.player as unknown as { tryConsumingTimerCrit?: (g: unknown, x: number, y: number, w: number, h: number) => boolean } | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false)) crit = true;
      let dmgVar = damageVarRoll(this.damage,
        ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
      dmgVar = applyBannerDamageDealt(game, e, dmgVar);
      // ★F3 接线（蓝队四轮）：978 火山大剑爆焰数据面 melee（SetDefaults :9255-9271）→
      // 焰爆石/拍击石双支（Projectile.cs:13439-13446）随 Damage() 生效；加伤在 banner
      // 采样外、随暴击并入实伤参（序注见 stats/SnapStrike.ts F1 迁移）
      const snapBonusVolcano = projectileSnapStrikeBonus(game,
        { projId: 978 }, e.x + e.w / 2, e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      // ★D2:独立结算面补钩(dmgVar 值域→新变量承接)
      // ★S02(BJ723-B):crit ×2 摘除——移 Enemy.hurt 防后(NPC.cs:82067)
      const dmgHooked = runModModifyHitNpcByProj(game.player, game, (this as unknown as { projId?: number }).projId ?? -1,
        (e as unknown as { vanillaId?: number }).vanillaId ?? -1, dmgVar, crit);
            e.hurt(dmgHooked
        + (snapBonusVolcano ? snapBonusVolcano : 0),
        // pierce=-3 = usesLocal 族清零档（BJ398 现役梯,Enemy.hurt :14317 iframes=0
        // ≙ 原文 :14175-14178 `immune[owner]=0` 写面）——★Q4 刀写半面对齐：旧档
        // pierce=0 写 10t 弹幕域窗,而 978 usesLocalNPCImmunity 节流归弹内局部表
        // （hitSet）,原文命中后全局窗【清零】非新开 10t 窗
        kdir * Math.abs(this.knockback || 1), 0, game, this.armorPen, crit, -3, true);
      // ★清偿刀 U2（2026-10-01）：ghostHeal 白耗面（Projectile.cs:13877-79 通用 on-hit
      //  段,StrikeNPC :13716 后/写梯 :14031 前=本位;S2 台账家族债兑现,全链锚见
      //  meleeOnHitProjs.ts 文件尾批注）。978 数据面 melee（SetDefaults :9255-9271 无
      //  magic 行）→ isMagic=false 直传：幽灵兜帽在身时白扣治疗预算不出治疗球=原版本相
      //  （:12090 lifeSteal -= num2 先于 :12091-93 !magic return）。ghostHurt 不接=
      //  非 magic 死码（:12022 早退零观察面,S2/R1-B 定谳保形）。pveNumHits++=:14263 位
      //  （proc 读自增前值;usesLocal 每敌一次但多敌可叠跳）。
      ghostHealProc(game, 978, this.pveNumHits,
        e as unknown as Parameters<typeof ghostHealProc>[3]);
      this.pveNumHits++;
      // StatusNPC（Projectile.cs:11365）：AddBuff(24,180)=On Fire! 3s（提取表驱动）
      applyProjStatus(978, e as unknown as Record<string, number | undefined>);
      // usesLocalNPCImmunity 族落地 = 全局窗清零段（GC1：Projectile.cs:14177）
      (game as unknown as { noteNpcPlayerImmune?: (id: number, ticks: number) => void })
        .noteNpcPlayerImmune?.(e.id, 0);
      this.hitSet.add(e.id);              // localNPCHitCooldown=-1 永久免疫档
      if (--this.penLeft <= 0) { this.dead = true; return; }   // penetrate 计数耗尽
    }
    // 小动物面（原版 NPC 桶同在 Projectile.Damage 域——弹幕族统一既有通道）
    // ★BJ488① projId 随盒（978 melee 旗→critter 面三类掷 :12915-27 照达;TimerCrit :12928）
    hitCritters({ x: px, y: py, w: this.w, h: this.h, projId: 978 }, game);
  }

  /** alpha 归一值（0..1）；draw 时换算 255 弹面不透明度 */
  private alphaTick = 0;

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(978);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || !ctx) return;
    // ★F17（2026-08-31 蓝队三批）可见度方向修正：原版 AI_189 :43038 全式
    //   `alpha = (int)(255f * (1f − Remap(ai0,0,2,0,1) × Remap(ai0,6,10,1,0)))`
    //   （XNA α 域：255=全透）。本仓 alphaTick 只存乘积 R=Remap1×Remap2，
    //   可见因子 = 1 − alpha/255 = 1 − (1−R) = R。旧式 `opacity = 1 − R` 恰好
    //   翻转（起手可见、2..6t 窗口恒隐身、尾段回显）。修正为直接取 R：
    //   出生隐→2t 渐显满亮→6..10t 渐隐（与头注曲线一致）。
    const opacity = Math.max(0, Math.min(1, this.alphaTick));
    if (opacity <= 0.02) return;
    const frames = 5;                     // Main.projFrames[978]=5（vanilla-projframes.json）
    const fh = img.height / frames;
    const sc = 1 + this.ai0 / 15;         // :43046 scale = 1f + 1f*(ai[0]/15f)
    const dw = this.w * sc, dh = fh * sc;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(img,
      0, this.frame * fh, img.width, fh,
      this.cx - dw / 2, this.cy - dh / 2, dw, dh);
    ctx.restore();
  }
}
