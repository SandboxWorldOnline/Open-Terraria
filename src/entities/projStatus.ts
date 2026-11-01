// 投射物命中 → 敌怪 debuff(Projectile.StatusNPC 1:1,Projectile.cs:10555-11065;
// 由 StrikeNPC:12757 每次命中敌怪后调用)。表由 tools/extract-projstatus.mjs 从
// Terarria1456 源码提取:{"<projType>": [{buff, chance, durMin, durMax, src, gate?}]}(tick)。
// 复杂形状已入表并带 gate 标记(2026-08-13 G7):
//   · 'ai1==i' 定向 tag(598/636/971/975/614)——StrikeNPC :12421 先写 ai[1]=victimIndex
//     再调 StatusNPC → 首击恒真;repo 附着弹无追踪态,单次命中等价恒真,直接施加
//   · 'setHuntressT2' 套装门(694-696)——运行时校验 ctx.setHuntressT2(Player.equipStats)
//   · 'remixWorld→N'(15/954/979)/'ai0==1→N'(85)——秘密种子/附着态未跟踪,
//     取基档(else 档)生效,另一档登记偏差
// 提取器仍 SKIP 的三块为"无 type==N"运行时配件门:meleeEnchant(:10558)→applyMeleeImbue、
// frostBurn(:10862)→applyFrostBurn、magmaStone(:10866)→applyMagmaStoneProj。
import { npcImmuneTo } from '../data/vanillaNpcImmunity';
import tableJson from '../data/vanilla-projstatus.json';
import { BuffType } from '../stats/Buffs';

/** mut=互斥组 id(StatusNPC if/else 双分支:单掷骰二选一必中其一,
 *  组内按累积 chance 扫描——两条独立掷骰会让双落空/双中,2026-08-13 修正)
 *  src=StatusNPC 源码行号(提取器锚);gate=原版条件门档记(见文件头) */
interface StatusEntry { buff: number; chance: number; durMin: number; durMax: number; mut?: number; src?: number; gate?: string }
export const TABLE = tableJson as unknown as Record<string, StatusEntry[]>;

/** Enemy 侧已实装的 buff 字段(秒)。效果对照(全部回源 NPC.cs UpdateNPC_BuffApplyDOTs
 *  :92577 起,lifeRegen 单位=2×HP/s;受击穿甲在 checkArmorPenetration :81912) */
const SUPPORTED: Record<number, string> = {
  24: 'onFireT',     // On Fire!(onFire,:92616-92630;-8 = 4 HP/s)
  20: 'poisonT',     // Poisoned(:92584-92591;-12 → 6 HP/s)
  70: 'venomT',      // Venom(:92703-92710;-60 → 30 HP/s)
  39: 'cursedT',     // Cursed Inferno(onFire2,:92684-92695;-48 → 24 HP/s)
  31: 'confusedT',   // Confused(TargetClosest direction 反转,:78569)
  69: 'ichorT',      // Ichor(NPC 侧=checkArmorPenetration :81916 armorPenetration+15 进
  //   共享池,非独立直伤也非防直减;玩家侧 Ichor 才是 statDefense-15,Player.cs:9756-9758)
  //   Enemy.hurt 已接 npcCheckArmorPenetration 原版序(2026-08-15):池/2 加伤→
  //   再减 def/2,Projectile.cs:12796-12808 + Main.cs:65626
  72: 'midasT',      // Midas(掉钱 ×1.10-1.51,Enemy.ts rollCoins)
  44: 'frostburnT',    // Frostburn(onFrostBurn,:92648-92661;-16 → 8 HP/s)
  324: 'frostburn2T',  // Frostburn2(:92668-92680;-50 → 25 HP/s)
  323: 'onFire3T',     // OnFire3(:92632-92644;-30 → 15 HP/s)
  153: 'shadowFlameT', // ShadowFlame(:92712-92724;-30 → 15 HP/s)
  204: 'oiledT',       // Oiled:六火系在身时再叠 -50 = +25 HP/s(:92728-92737)
  36: 'brokenArmorT',  // BrokenArmor:受击无视 20 防(:81919-81921)
  203: 'betsysCurseT', // BetsysCurse:受击无视 40 防(:81922-81924)
  189: 'daybreakT',    // Daybreak:层数模型已接(:92807-92830 层数×100HP/s,零层兜底 1;
  //   层数 = WeaponProj.daybreakStacks 场上附着 636 计数,Enemy 侧消费)
  30: 'bleedT',        // Bleeding(:92592-92601;-24 = 12 HP/s)
  137: 'slimedT',      // Slimed(drippingSlime):六火系 DoT 翻倍(:92623 等 6 处)
  103: 'wetT',         // Wet(潮湿,NPC.cs :11319-11352 AddBuff 同族):非 DoT——NPC.wet
  //   位驱动滴水视觉/湿尘 + 与岩浆接触的交互门;施加源新批 = 水枪 2272→弹 358
  //   (AI_060 :29454 AddBuff(103,1500t)=25s)。纯倒计时承载(wetT),视觉在实体侧
  353: 'shimmeredT',   // Shimmered(NPC 微光化,AddBuff(353,100t)):微光枪 5495→弹 1042
  //   (AI_060 :29456-29458)专属——原版【单一系统】(X-F4 修正,旧"两套"注释系误读):
  //   buff 在身即 shimmering=true(NPC.cs:93255-93265),液体接触只是施加端之一
  //   (:94211-94218 Collision.shimmer→TryAddingRepeatedBuff),变形由透明度累计消费
  //   (:92634-92644 >0.9 → GetShimmered :92668),不要求浸池。本键=【消费态】:
  //   Enemy.fixedUpdate 把 shimmeredT>0 并入 shimmerT 累计驱动,阈同 91 拍
  375: 'hemorrhageT',  // Hemorrhage(:92604-92611;-200 = 100 HP/s)
  169: 'javelinT',     // BoneJavelin:层数模型已接(3 HP/s/层×附着 598 计数,
  //   :92740-92758;层池=Enemy.addStickerStack,cap 6)
  337: 'spikeT',       // TentacleSpike:层数模型已接(3 HP/s/层,:92761-92779;无上限)
  344: 'butcherT',     // BloodButcherer:层数模型已接(4 HP/s/层,:92786-92804;无上限)
  151: 'soulDrainT',   // SoulDrain:25 HP/s(:92927-92935,-50;魂镰 3006 联动登记 GAP)
  183: 'stardustT',    // StardustBleed:层数模型已接(20 HP/s/层,:92846-92863;
  //   层池 cap 10;MinionProj 613 星尘细胞→614 已在仓,弹命中即经本表入层)
  // ---- 1457 新敌怪 debuff 家族（BuffID.cs:961-971；DoT/视觉在 Enemy.fixedUpdate
  //      DOTTally 等价段,1457 NPC.cs:92746-92800）----
  395: 'potentAcidT',        // PotentAcid:90 HP/s(AddPoison(180,60),:92751;可被 398 加速)
  397: 'chlorophyteSporeT',  // ChlorophyteSpore:90 HP/s(:92755;+孢子云/叶尘 VFX)
  398: 'acceleratePoisonsT', // AcceleratePoisons:可加速族 DoT ×2(:92840-92847)
  399: 'blueLightningT',     // BlueLightning:纯视觉(BlueLightningSmall 1/10,:92274)
  400: 'redLightningT',      // RedLightning:纯视觉(RedLightningSmall 1/10,:92281)
  362: 'eelWhipT',           // EelWhipNPCDebuff(markedByEelWhip):50 HP/s 平铺 DoT
  //   （1457 :92781 Add(100,50)——链式缩放/标记玩家数/链电粒子全删,ApplyEelWhipDoT
  //   成死代码;施加源 = 鞭 1033 ApplyWhipDebuffs）
  120: 'stinkyT',      // Stinky(苍蝇美食 5129 挥砍命中,Player.cs:6203-6206):敌怪侧
  //   效果 = 其余敌怪以 stinky 者为目标(NPC.cs:53888/53899 TargetClosest 门)——
  //   本仓敌怪索敌 AI 未建模该转向,登记 GAP;字段仅承载 buff 存量/倒计时。
  //   B1 批新增授予源:恶臭药水弹 371 消亡 80px 圈(P.cs:78947-78956 → ThrowKillFx)
  186: 'dryadBaneT',   // DryadBane(树妖煞,树妖光环弹 586 else-if 臂 P.cs:41967-41970;
                       //   2026-08-31 台账批接——施加端 TownNPC.updateDryadWardAura,
                       //   重授窗/LOS 豁免在施加端判,DOTTally 消费见 Enemy.fixedUpdate)
  // ---- B1 孤儿武器投掷物光环 buff（2026-08-30;Projectile.Kill 圈支 P.cs:78940-78962,
  //      弹型→buff 映射 370→119/371→120/936→320;ThrowKillFx.applyAura 施加）----
  //   ★工单"4986 NPC 不吃"与反编译相左——1456(:75203)/1458(:78955) 均为三件共享 NPC
  //   循环,以源码为准。对 NPC 全为【展示级】无机制消费,纯计时承载（同 stinkyT 先例）:
  119: 'lovestruckT',  // Lovestruck(爱情药水弹 370,NPC.buffType 挂账无 UpdateNPC case)
  320: 'gelBalloonT',  // GelBalloonBuff(微光气球弹 936;玩家侧= drippingSparkleSlime
                       //   :11843-11846 滴落展示,NPC 侧无任何消费)
};

type StatusEnemy = { [field: string]: number | undefined };
/** 导出别名（F1 狱火光环 Game 侧调用 applyBuffTicks 的形参面）——结构同 StatusEnemy */
export type StatusEnemyLike = StatusEnemy;

/** 运行时门上下文(对应表内 gate 标记;缺省 = 门条件按"可施加"处理) */
export interface ProjStatusCtx {
  /** setHuntressT2(女猎手 T2/T3 套装,Player.cs:16119/16149)——爆炸机关弹 694-696
   *  的 Oiled 门(StatusNPC :10786)。由调用方从 Player.equipStats.huntressT2 传入 */
  setHuntressT2?: boolean;
  /** 催化指环 6185（Player.catalystBand :1961）——任意弹命中 398 AcceleratePoisons
   *  300t（Projectile.StatusNPC :11189-11193 + Player 侧 :6534-6537）。提取器 SKIP
   *  档（运行时饰品门无 type==N），代码层并表 */
  catalystBand?: boolean;
  /** 毒刺 6165/6184/6185（accPoisonBarb :1223）——箭体命中 100% 中毒 90t
   *  （StatusNPC :11183-11188,`arrow && !noEnchantments` 门）。箭侧调用方
   *  （Arrow.ts,批 C 域）未接,登记 */
  accPoisonBarb?: boolean;
  /** 614 星尘细胞弹 ai[1]（蓝队 R7-19）：表内 gate 'ai1==i' 条目（buff 183×900t,
   *  StatusNPC :11381-11383 `type==614 && ai[1]==i`）只施加到绑定目标——传入
   *  stickerTgt（本仓敌 id）与被命中敌 id 比对;缺省（旧调用面）= 门放行 */
  ai1TargetId?: number;
  /** 1104 火鞭（蓝队 R7-41）：跳过表中 OnFire(24) 条目——该 buff 由 WhipProj 侧
   *  窗口判定（中段 ±1 + 鞭身 !wet + 鞭尖 50×50 盒）后直投 applyBuffTicks */
  suppressBuff?: number;
  /** ★BJ642（2026-10-11）：85 火焰弹 ai[0]（StatusNPC :11660-11663 门
   *  `ai[0]==1 → 324 Frostburn2 else 323 OnFire3`,1200t）——生成侧经 ArrowOpts.ai0
   *  注入（精灵熔炉 1910=1,Game 发射位）后传此,门开走 324；缺省（旧调用面）=
   *  基档 323（文件头登记偏差随之收窄：85 的『另一档』自此可达） */
  ai0?: number;
}

/** 命中结算侧调用:按投射物型号掷骰并施加 debuff(AddBuff max 合并语义)。
 *  duration 掷骰 Next(durMin, durMax+1) tick → 秒(/60)。
 *  同 mut 组 = 互斥分支(单掷骰按累积概率选一,必中其一或全落空) */
/** 1457 提取器 SKIP 档手补（Terarria1457 Projectile.cs:11453-11457）:
 *  549 永恒水晶弹新增 Venom(70) 120t——`int time3 = 120; AddBuff(70, time3)`
 *  局部变量时长表达式提取器不识别（SKIP 名单在案），按源码钉值代码层并表 */
const PROJ_STATUS_1457_HANDPATCH: Record<number, StatusEntry[]> = {
  549: [{ buff: 70, chance: 1, durMin: 120, durMax: 120, src: 11456 }],
  // 309 冰九头蛇冰弹:Frostburn2 300t 固定(AddBuff(324,300),StatusNPC :11307-11309
  // ——提取器 SKIP(友好召唤弹无 ExtractBuff 链);frostburn2T 消费=25 HP/s :92668-92680)
  309: [{ buff: 324, chance: 1, durMin: 300, durMax: 300, src: 11307 }],
};

export function applyProjStatus(projId: number | undefined, enemy: StatusEnemy, ctx?: ProjStatusCtx): void {
  if (projId === undefined || projId < 0) return;
  // ★dontTakeDamage 目标零状态（原版状态只在 Damage_PVE_Inner 内可达,而其目标选择门
  // Projectile.cs:12600 / 近战 Player.cs:44618 都先排 dontTakeDamage——刺球 70/火轮 72 等
  // 机关体不吃任何玩家侧状态/DoT。曾缺=DoT 通道 hp 沉负僵尸态,评审 C 定谳 2026-09-02 补）
  if ((enemy as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) return;
  // 催化指环 6185（StatusNPC :11189-11193）：任意命中 398 AcceleratePoisons 300t=5s
  //（无弹型门;398 ∈ SUPPORTED acceleratePoisonsT——可加速族 DoT ×2 消费在 Enemy DOTTally）
  if (ctx?.catalystBand) {
    if (5 > (enemy.acceleratePoisonsT ?? 0)) enemy.acceleratePoisonsT = 5;
  }
  const entries = TABLE[String(projId)] ?? PROJ_STATUS_1457_HANDPATCH[projId];
  if (!entries) return;
  let pendingMut: { id: number; roll: number } | null = null;
  for (const en of entries) {
    // 运行时门:setHuntressT2 未穿套装 → 该条不施加(其余 gate 档已按基档并入,
    //  见文件头注释,不拦)
    if (en.gate === 'setHuntressT2' && !ctx?.setHuntressT2) continue;
    // gate 'ai1==i'（614 星尘细胞弹 183,StatusNPC :11381-11383）：只上 ai[1] 绑定
    //  目标——ctx.ai1TargetId 缺席（旧调用面）= 放行（基档语义不变）;蓝队 R7-19
    if (en.gate === 'ai1==i' && ctx?.ai1TargetId !== undefined
      && ctx.ai1TargetId !== (enemy as { id?: number }).id) continue;
    // 调用方点名跳过某 buff（1104 火鞭 OnFire 窗口化,蓝队 R7-41—— WhipProj 侧
    //  窗口判定后经 applyBuffTicks 直投）
    if (ctx?.suppressBuff !== undefined && en.buff === ctx.suppressBuff) continue;
    // ★BJ642：gate 'ai0==1→324'（85 火焰弹,StatusNPC :11660-11663）——ctx.ai0===1
    //  时改投 324 Frostburn2（同 1200t）；基档 323 不变
    if (en.gate === 'ai0==1→324' && ctx?.ai0 === 1) {
      if (debuffWriteAllowed(enemy, 324)) {
        applyBuffTicks(enemy, 324, en.durMin);
      }
      continue;
    }
    let hit: boolean;
    if (en.mut !== undefined) {
      // 互斥组:同组共用一次掷骰,按累积 chance 区间判定本条是否被选中
      if (!pendingMut || pendingMut.id !== en.mut) pendingMut = { id: en.mut, roll: Math.random() };
      let lo = 0;
      hit = false;
      for (const g of entries) {
        if (g.mut !== en.mut) continue;
        const hi = lo + g.chance;
        if (g === en) { hit = pendingMut.roll >= lo && pendingMut.roll < hi; break; }
        lo = hi;
      }
    } else {
      hit = Math.random() < en.chance;
    }
    if (!hit) continue;
    const ticks = en.durMin + Math.floor(Math.random() * (en.durMax - en.durMin + 1));
    applyBuffTicks(enemy, en.buff, ticks);
  }
}

/** 单条 buff 直投（AddBuff max 合并 + NPC buffImmune 门 + 贴附层登记）——
 *  applyProjStatus 循环尾与 WhipProj 1104 窗口直投共用（蓝队 R7-41 提取） */
export function applyBuffTicks(enemy: StatusEnemy, buff: number, ticks: number): void {
  // NPC buffImmune 门（NPC.cs:90968 AddBuff 免疫即 return + NPCID.Sets
  // .DebuffImmunitySets 派生——2026-08-13 D5）。1457 AI_001 熔岩史莱姆段
  // （:61312-61316）对 70/397/395/20 运行时置 buffImmune=false——实例级覆写位
  // （Enemy.debuffImmuneOverride）优先于静态表
  const vId = (enemy as { vanillaId?: number }).vanillaId;
  const override = (enemy as { debuffImmuneOverride?: Map<number, boolean> }).debuffImmuneOverride;
  if (override?.get(buff) === false) {
    // 运行时豁免（原版运行时复位语义）：跳过静态免疫表
  } else if (vId !== undefined && vId > 0 && npcImmuneTo(vId, buff)) return;
  const field = SUPPORTED[buff];
  if (!field) return; // 未实装 buff,登记见上
  const sec = ticks / 60;
  const cur = enemy[field] ?? 0;
  if (sec > cur) enemy[field] = sec;
  // 贴附族层数登记（NPC.cs:92740-92863 层数=场上附着弹计数）：169/183/337/344
  // 每次施加=一枚贴附弹入池——层寿命=本处 buff 时长（与贴附弹 60×num11 AI 次
  // 寿命等长），Enemy.fixedUpdate 按层×单层 HP/s 结算；上限（KillOldestJavelin
  // :13019-13030：598=6/614=10）在 Enemy.addStickerStack 内执行。
  // 189 Daybreak 走 WeaponProj.daybreakStacks 活计数（有实体），不入此链
  if (buff === 169 || buff === 183 || buff === 337 || buff === 344) {
    (enemy as { addStickerStack?: (b: 169 | 183 | 337 | 344, d: number) => void })
      .addStickerStack?.(buff, sec);
  }
}

/** ★ImmuneToAll 直写闸（2026-09-03 清偿）：原版玩家→敌怪 debuff 的唯一闸口 =
 *  NPC.AddBuff（NPC.cs:90968 buffImmune 即 return + NPCID.Sets.DebuffImmunitySets
 *  ——37 键 ImmuneToAll 名单（68 守卫/72 火轮/82/134-136 机械蠕虫/139/253/288 地牢
 *  之魂/330/384/392-395/422/439-440/454-459/491-493/507/517/549/583-585/662/686-687/
 *  690,见 vanillaNpcImmunity.ts 头注）对非鞭 debuff 全免疫）。applyBuffTicks 已接
 *  该闸,但部分【状态字段直写】点绕闸照写——直写点改经本谓词门：
 *  `!dontTakeDamage && 每个 buffId 都 !npcImmuneTo(vanillaId,buffId)`。
 *  buffId ↔ 字段映射以 SUPPORTED 实表为准：24=onFireT / 20=poisonT / 39=cursedT /
 *  44=frostburnT / 323=onFire3T / 324=frostburn2T / 203=betsysCurseT / 362=eelWhipT。
 *  debuffImmuneOverride 运行时豁免位与 applyBuffTicks 同序同语义（1457 AI_001 熔岩
 *  史莱姆 :61312-61316 对 70/397/395/20 置 false——override===false 优先于静态表）。
 *  ★零随机消耗：原版闸口在 AddBuff 内 = 掷骰【后】,本仓沿用同拍——直写点的掷骰
 *  照常消耗,闸只拦写字段 ⇒ 掷流计数不变（勿移到掷前）。per-buff 判定：同敌可免
 *  24 而不免 323,多 buff 直写群须逐 buff 传参,勿一次传全集取交集 */
export function debuffWriteAllowed(enemy: unknown, ...buffIds: number[]): boolean {
  if ((enemy as { dontTakeDamage?: boolean }).dontTakeDamage === true) return false;
  const vId = (enemy as { vanillaId?: number }).vanillaId;
  if (vId === undefined || vId <= 0) return true;   // 非原版敌怪无免疫表（npcImmuneTo 恒假）
  const override = (enemy as { debuffImmuneOverride?: Map<number, boolean> }).debuffImmuneOverride;
  for (const b of buffIds) {
    if (override?.get(b) === false) continue;       // 运行时豁免：跳过静态免疫表
    if (npcImmuneTo(vId, b)) return false;
  }
  return true;
}

/** 武器浸剂对【投射物近战族】的命中施加（StatusNPC:10559-10583 开头段:
 *  (melee||whip) && meleeEnchant>0 → 按药剂施加。近战挥砍侧同表在
 *  Game.ts 挥击结算内,此函数供 WeaponProj 四族(链球/悠悠球/长矛/回旋镖)共用)。
 *  时长 = Player.cs:6141-6171 Next(a,b) 秒,max 合并 */
/** 冰霜盔甲引擎(StatusNPC :93712-93716):(melee||ranged) 命中且套装在身 →
 *  AddBuff(324 Frostburn2, 60×Next(5,15) tick=5-14s,max 合并)。
 *  魔法/召唤弹不吃。三挂点:挥砍(Game)/WeaponProj 近战四族/远程箭 */
export function applyFrostBurn(frostBurn: boolean, enemy: StatusEnemy): void {
  // ★dontTakeDamage 目标零状态（原版状态只在 Damage_PVE_Inner 内可达,而其目标选择门
  // Projectile.cs:12600 / 近战 Player.cs:44618 都先排 dontTakeDamage——刺球 70/火轮 72 等
  // 机关体不吃任何玩家侧状态/DoT。曾缺=DoT 通道 hp 沉负僵尸态,评审 C 定谳 2026-09-02 补）
  if ((enemy as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) return;
  if (!frostBurn) return;
  const sec = 5 + Math.floor(Math.random() * 10); // 60×Next(5,15)t——XNA Next(min,max) 含头不含尾=[5,14]秒
  // ★ImmuneToAll 直写闸（2026-09-03）：AddBuff(324,…) 门（NPC.cs:90968,Arrow 主环
  //  applyFrostBurn :93712 挂点即本函数调用位）——37 键名单对 324 全免疫曾照写。
  //  闸在掷后（零掷耗）;三挂点（挥砍/近战四族/远程箭）共用本函数,门接在此单源
  if (!debuffWriteAllowed(enemy, 324)) return;
  if (sec > (enemy.frostburn2T ?? 0)) enemy.frostburn2T = sec;
}

/** 岩浆石/火焰护手——近战【弹幕】命中（StatusNPC :11529-11541：melee 门，
 *  **必中三支**：Next(7)==0 → OnFire3(323) 360t=6s；else Next(3)==0 → 120t=2s；
 *  else → 60t=1s。★曾只移植第一支+落空即 return=6/7 命中无 buff。
 *  挥砍侧是另一公式（applyMagmaStoneSwing,Player.cs:6551-6562:1/4→6s、否则1/2→4s、否则2s） */
export function applyMagmaStoneProj(magmaStone: boolean, enemy: StatusEnemy): void {
  // ★dontTakeDamage 目标零状态（原版状态只在 Damage_PVE_Inner 内可达,而其目标选择门
  // Projectile.cs:12600 / 近战 Player.cs:44618 都先排 dontTakeDamage——刺球 70/火轮 72 等
  // 机关体不吃任何玩家侧状态/DoT。曾缺=DoT 通道 hp 沉负僵尸态,评审 C 定谳 2026-09-02 补）
  if ((enemy as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) return;
  if (!magmaStone) return;
  // ★OnFire3(323) 免疫闸（:90968 AddBuff 同款——掷链保持原序消耗,仅拒写,最终清零补）
  const ok = debuffWriteAllowed(enemy, 323);
  if (Math.random() < 1 / 7) {
    if (ok && 6 > (enemy.onFire3T ?? 0)) enemy.onFire3T = 6;
  } else if (Math.random() < 1 / 3) {
    if (ok && 2 > (enemy.onFire3T ?? 0)) enemy.onFire3T = 2;
  } else {
    if (ok && 1 > (enemy.onFire3T ?? 0)) enemy.onFire3T = 1;
  }
}

/** 岩浆石/火焰护手——近战【挥砍】命中（Player.cs:6184-6198 三段掷）：
 *  1/4 → 360t=6s；否则 1/2 → 240t=4s；否则 60t=1s */
export function applyMagmaStoneSwing(magmaStone: boolean, enemy: StatusEnemy): void {
  // ★dontTakeDamage 目标零状态（原版状态只在 Damage_PVE_Inner 内可达,而其目标选择门
  // Projectile.cs:12600 / 近战 Player.cs:44618 都先排 dontTakeDamage——刺球 70/火轮 72 等
  // 机关体不吃任何玩家侧状态/DoT。曾缺=DoT 通道 hp 沉负僵尸态,评审 C 定谳 2026-09-02 补）
  if ((enemy as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) return;
  if (!magmaStone) return;
  const r = Math.random();
  const sec = r < 0.25 ? 6 : r < 0.625 ? 4 : 2;   // ★R3 F2:否则档 120t=2s(Player.cs:6551-6562),曾误 1s
  // ★OnFire3(323) 免疫闸（掷后拒,最终清零补）
  if (debuffWriteAllowed(enemy, 323) && sec > (enemy.onFire3T ?? 0)) enemy.onFire3T = sec;
}

/** 近战挥砍命中 → 持械武器专属 debuff（Player.StatusToNPC :6139-6249 的 type 分支；
 *  调用点 Player.cs:43739 `StatusToNPC(sItem.type, npcIndex)`，type = 持械物品 id）。
 *  同函数的 meleeEnchant 浸剂块（:6141-6171）= applyMeleeImbue、frostBurn（:6180-6183）
 *  = applyFrostBurn、magmaStone（:6184-6198）= applyMagmaStoneSwing——均已单独实装，
 *  此处补齐逐武器档（概率 = Next(N)==0 ⟺ 1/N；时长 tick/60 = 秒；AddBuff max 合并）：
 *   · 2330 紫挥棒鱼 1/2 → Confused(31) 1-3s（:6172-6175）
 *   · 3352 血腥砍刀 100% → Bleeding(30) 4-6s（:6176-6179）
 *   · 3211 1/1 → Ichor(69) 5-10s（:6199-6202）
 *   · 5129 苍蝇美食 100% → Stinky(120) 5s（:6203-6206；AI 侧 GAP 见 SUPPORTED 注）
 *   · switch（:6207-6248）：121 火山 1/2 OnFire(24) 3s / 3823 圣骑锤 1/4 OnFire3(323) 5s /
 *     5382 1/3 OnFire3 5s / 122 1/10 OnFire 3s / 190 草剑 1/4 Poisoned(20) 7s /
 *     217 1/5 OnFire 3s / 1123 拍手 100% Confused(31) 2s
 *  免疫门与 applyProjStatus 同源（NPC.AddBuff buffImmune + DebuffImmunitySets，:90968） */
export function applyWeaponStatusSwing(weaponVid: number, enemy: StatusEnemy): void {
  // ★dontTakeDamage 目标零状态（原版状态只在 Damage_PVE_Inner 内可达,而其目标选择门
  // Projectile.cs:12600 / 近战 Player.cs:44618 都先排 dontTakeDamage——刺球 70/火轮 72 等
  // 机关体不吃任何玩家侧状态/DoT。曾缺=DoT 通道 hp 沉负僵尸态,评审 C 定谳 2026-09-02 补）
  if ((enemy as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) return;
  if (weaponVid < 0) return;
  const roll = (denom: number): boolean => denom <= 1 || Math.floor(Math.random() * denom) === 0;
  const add = (buff: number, ticks: number): void => {
    const vId = (enemy as { vanillaId?: number }).vanillaId;
    const override = (enemy as { debuffImmuneOverride?: Map<number, boolean> }).debuffImmuneOverride;
    if (override?.get(buff) === false) {
      // 运行时豁免（原版运行时复位语义）：跳过静态免疫表
    } else if (vId !== undefined && vId > 0 && npcImmuneTo(vId, buff)) return;
    const field = SUPPORTED[buff];
    if (!field) return;   // 未实装 buff（登记见 SUPPORTED 注）
    const sec = ticks / 60;
    if (sec > (enemy[field] ?? 0)) enemy[field] = sec;
  };
  switch (weaponVid) {
    case 2330: if (roll(2)) add(31, 60 * (1 + Math.floor(Math.random() * 3))); break;  // Next(1,4)
    case 3352: add(30, 60 * (4 + Math.floor(Math.random() * 3))); break;               // Next(4,7)
    case 3211: add(69, 60 * (5 + Math.floor(Math.random() * 5))); break;               // Next(5,10)
    case 5129: add(120, 300); break;
    case 121: if (roll(2)) add(24, 180); break;
    case 3823: if (roll(4)) add(323, 300); break;
    case 5382: if (roll(3)) add(323, 300); break;
    case 122: if (roll(10)) add(24, 180); break;
    case 190: if (roll(4)) add(20, 420); break;
    case 217: if (roll(5)) add(24, 180); break;
    case 1123: add(31, 120); break;
  }
}

export function applyMeleeImbue(
  buffs: { has: (b: never) => boolean },
  enemy: StatusEnemy,
  partyFx?: () => void,
): void {
  // ★dontTakeDamage 目标零状态（同 applyProjStatus 头注——原版浸剂在 StatusNPC 内,:12600 门后）
  if ((enemy as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) return;
  const has = (bt: BuffType): boolean => buffs.has(bt as unknown as never);
  const max = (field: string, v: number): void => {
    if (v > (enemy[field] ?? 0)) enemy[field] = v;
  };
  // ★逐分支免疫闸（原版每支=独立 AddBuff→:90968 buffImmune 逐一判——Venom70/PotentAcid395/
  //  CursedInferno39/OnFire24/Midas72/Ichor69/Confused31/Poisoned20,BuffID.cs 实表核实;
  //  曾只闸 dontTakeDamage,ImmuneToAll 37 键名 NPC 经浸剂照吃 debuff,最终清零补。
  //  时长掷保持在闸前=原版"掷后 AddBuff 拒"同拍,RNG 消耗不变）
  if (has(BuffType.ImbueVenom)) {
    // ★BJ739 B17（2026-10-31）：整数秒化——Projectile.cs:11202-11224
    //  `nPC.AddBuff(N, 60 * Main.rand.Next(a,b))` 右端不含 → {5..9}/{3..6}/
    //  {10..19}/{1..3} 离散整数秒（旧连续秒均值长 0.5s,issue#29 B17）
    const v = 5 + Math.floor(Math.random() * 5);
    if (debuffWriteAllowed(enemy, 70)) max('venomT', v);
    // 1457 StatusNPC :11201-11204：毒液浸剂命中伴发 AddBuff(395 PotentAcid, 60t=1s)
    if (debuffWriteAllowed(enemy, 395)) max('potentAcidT', 1);
  }
  if (has(BuffType.ImbueCursed)) { const v = 3 + Math.floor(Math.random() * 4); if (debuffWriteAllowed(enemy, 39)) max('cursedT', v); }
  if (has(BuffType.ImbueFire)) { const v = 3 + Math.floor(Math.random() * 4); if (debuffWriteAllowed(enemy, 24)) max('onFireT', v); }
  if (has(BuffType.ImbueGold) && debuffWriteAllowed(enemy, 72)) max('midasT', 2);
  if (has(BuffType.ImbueIchor)) { const v = 10 + Math.floor(Math.random() * 10); if (debuffWriteAllowed(enemy, 69)) max('ichorT', v); }
  if (has(BuffType.ImbueNano)) { const v = 1 + Math.floor(Math.random() * 3); if (debuffWriteAllowed(enemy, 31)) max('confusedT', v); }
  if (has(BuffType.ImbuePoison)) { const v = 5 + Math.floor(Math.random() * 5); if (debuffWriteAllowed(enemy, 20)) max('poisonT', v); }
  if (has(BuffType.ImbueParty)) partyFx?.();
}

/** NPC.checkArmorPenetration 1:1 纯函数（NPC.cs:81913-81938）。
 *  原版语义：返回值是【加到伤害上的加成】（StrikeNPC :12808 num12 += 本值，
 *  之后 CalculateDamageNPCsTake 才减 def/2——Main.cs:65626-65635），等价于
 *  有效防 = def − min(pool, def)。pool 单池累加（无"每层独立"档）：
 *    armorPenetration（StrikeNPC :12068 = 玩家 GetArmorPenetration(melee) +
 *    弹幕自带 armorPenetration——数据层 vanillaProjectiles.armorPenetration）
 *    + ichor 15（:81916）+ brokenArmor 20（:81919）+ betsysCurse 40（:81922）
 *    + (int)(defense × armorPenetrationPercent)（:81927，闪电光环 688/690 传 1）。
 *  早退：pool ≤ 0 或 defense ≤ 0 → 0（负防/零防不吃穿甲加成）；
 *  超防钳制：pool > defense → defense/2（加成永不把伤害推过全额）。
 *  已接线（2026-08-15）：Enemy.hurt = max(1, round(dmg + 本值 − def×0.5))
 *  原版序（Projectile.cs:12796-12808 → Main.cs:65626 CalculateDamageNPCsTake） */
export function npcCheckArmorPenetration(
  defense: number,
  armorPenetration: number,
  armorPenetrationPercent = 0,
  flags: { ichor?: boolean; brokenArmor?: boolean; betsysCurse?: boolean } = {},
): number {
  let pen = armorPenetration | 0;
  if (flags.ichor) pen += 15;             // NPC.cs:81916
  if (flags.brokenArmor) pen += 20;       // :81919
  if (flags.betsysCurse) pen += 40;       // :81922
  pen += Math.trunc(defense * armorPenetrationPercent); // :81927 (int) 截断
  if (pen <= 0 || defense <= 0) return 0; // :81929
  if (pen > defense) return (defense / 2) | 0; // :81933 整除
  return (pen / 2) | 0;                   // :81935 整除
}
