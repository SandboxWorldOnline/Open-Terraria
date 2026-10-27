// 玩家语音中心口（原版 Player.PlayHurtSound / PlayDeathSound 全分派段,
// Player.cs:38867-39011 / :39013-39041，1.4.5.8 终态）。
// 分派三层：
//   ① voiceOverride（PlayerVoiceOverrideID 1-20,Player.cs:1689）最高优先——逐 case
//      直播（:38879-38996）。写入方 = 语音饰品族 Item.voiceSlot
//      （DefaultToVoiceOverrideAccessory Item.cs:47786-47797；家族公式 7+type−5499
//      :43355-43363 等）经 ApplyEquipFunctional/ApplyEquipVanity 装备置位
//      （Player.cs:14489 带 !hideVisibleAccessory 门 / :14339 社交槽无门）。
//   ② 霜甲/骨甲受击音（:38984-38991）=★BJ598 件2 已落刀——frostArmor→SoundID.Item27
//      （'Item_27'）/ boneArmor→legacy(3,style2)=NPCHit2（'NPC_Hit_2',逐 style 槽
//      停旧播新=Sfx.SINGLE_SLOT_STOP NPC_Hit_1..56 族），甲支在 hurtVoicePlan
//      （override 命中即先返;位次与原版序 override→甲支→dontStarve→variant 同序,
//      甲旗由调用方传 frostArmor/boneArmor——Game.damagePlayer 与尘爆站同谓词
//      eq.frostBurn/p.boneArmor）。★BJ652 件4（2026-10-12）mount 52/54-56/61、
//      狼人（:38946-38982）已补（原 BJ598 期 B3 待办销案）——位次=override→
//      mount→狼人→甲支→DST→variant（原版序逐环;legacy(3,N)=NPC_Hit_N/
//      (4,N)=NPC_Killed_N,vol 缺省 1 同甲支;DST 门跳过面=凡 plan.source 有档,
//      原版各支均在 DST 门【前】return）。forceWerewolf/hideWolf 本仓未建模
//      （狼人饰品 vanity 隐藏位）=condition 只认 wereWolf,登记偏差。
//   ③ voiceVariant（ID/PlayerVoiceID.cs：1 男/2 女/3 其他,VariantOrder={1,2,3}）+
//      voicePitchOffset（梳妆台滑杆 -1..1,Main.cs:45429-45451）尾段分派
//      （:38996-39009）：pitch=Remap(offset,-1,1,-0.7,0.7) 显式直传（三 case 同式,
//      LSP 不再掷 style 抖动）;case3 = player_hit_default（SoundID.cs:1138 vol0.9 pv0.2）。
// 死亡侧 PlayDeathSound 只认 voiceOverride（无 variant 分派!）：5→BellHurt(:39027)/
//   9→player_death_retro(:39030)/15→BalloonDeath(:39033),默认恒 PlaySound(5)（:39037）
//   ——★voiceVariant==3 的死亡音与 1/2 同库（原版无"Other"死亡专属轨,定谳备案）;
//   dontStarveWorld/tenthAnniversaryWorld 默认支已接（2026-08-25 音频对账批）：
//   受击门=:38993 dontStarve&&!remix、死亡门=:39036 dontStarve||tenthAnniversary,
//   均在 override switch 之后（Male ? DSTMaleHurt : DSTFemaleHurt,WithVolume 0.1
//   SoundID.cs:1056/:1058）;旗标读 game.world.seedFlags 运行时直取。
// 音量/音高：override 支 vol=SoundID WithVolume 原值（Item_35 的 ×0.75 走
//   FILE_CASE_VOL 自动档,vanillaNpcAmbience PET_SLIME_HIT_VOICES 同源互证）;
//   player_hit_* 族 ±40 抖动已登记 PITCH_CASE,player_hit_default ±20/
//   player_death_retro ±40 随本批补档。variant 段显式 pitch 直传跳过表查
//   （Sfx.pitchRateFor explicitPitch 分支）——与原版 Pitch=直传同语义。
// 空间化：本地玩家 vector=(-1,-1) 无衰减（Player.cs:38870-38874）,故不带坐标。
import type { GameHooks } from '../entities/types';
import { FEMALE_VARIANTS } from './Appearance';

const FEMALE_HURT_FILES = ['Female_Hit_0', 'Female_Hit_1', 'Female_Hit_2'];
const MALE_HURT_FILES = ['Player_Hit_0', 'Player_Hit_1', 'Player_Hit_2'];

/** PlayerVoiceID（ID/PlayerVoiceID.cs:14/:17-22）：None=0/Male=1/Female=2/Other=3 */
export const VOICE_VARIANT_ORDER = [1, 2, 3] as const;

/** 梳妆台循环切换（Main.CycleVoiceStyle Main.cs:53180-53192,唯一调用点更衣窗
 *  :45397 offset=+1）：VariantOrder 内 +1 环绕 男→女→其他→男;非法值归位 Male */
export function cycleVoiceVariant(cur: number | null | undefined): 1 | 2 | 3 {
  const order = VOICE_VARIANT_ORDER as readonly number[];
  let i = order.indexOf(cur ?? 1);
  if (i < 0) i = 0;
  return order[(i + 1) % order.length] as 1 | 2 | 3;
}

/** ★BJ732-A:体型切换的语音自动跟随（原版 UpdateSelectedGender
 *  UICharacterCreation.cs:1312-1330——性别翻转时 1↔2 互转;switch 无 case3 分支
 *  =「其他」声存活（玩家显式选择不被性别切换覆写）;同性别切换 no-op。
 *  voiceVariant 缺省(undefined,新号/旧档)同样 no-op——消费侧按性别推导兜底。 */
export function autoSwitchVoiceOnGenderFlip(
  voiceVariant: 1 | 2 | 3 | null | undefined,
  prevMale: boolean,
  nowMale: boolean,
): 1 | 2 | 3 | null | undefined {
  if (prevMale === nowMale) return voiceVariant;            // :1313-1317 同性别:不动
  if (voiceVariant === 1 && prevMale) return 2;             // :1319-1323 男声随男→女翻女声
  if (voiceVariant === 2 && !prevMale) return 1;            // :1324-1329 女声随女→男翻男声
  return voiceVariant;                                       // case3/缺省:存活
}

/** voicePitchOffset → XNA Pitch（PlayHurtSound :38998 Remap(-1..1 → ∓0.7),
 *  Utils.Remap 默认 clamped——越界先钳 -1..1 再线性映射） */
export function remapVoicePitch(offset: number | null | undefined): number {
  const t = Math.max(-1, Math.min(1, Number.isFinite(offset as number) ? (offset as number) : 0));
  return -0.7 + (t + 1) * 0.7;
}

/** 语音饰品 vid → Item.voiceSlot（DefaultToVoiceOverrideAccessory 家族,无表项=0）：
 *  215 谁皮垫 19（Item.cs:4049-4050）/ 牛铃 5484→5（:43217-43218）/ 鸡符咒
 *  5485→6（:43221-43222）/ 5499-5509 公式 7+type−5499（:43355-43363,5501 旧伴锁
 *  →9 Retro）/ 仙灵项圈 5534→18（:43619）。运行时直算,不落数据表 */
export function voiceSlotOfItem(vid: number): number {
  if (!Number.isFinite(vid)) return 0;
  if (vid === 215) return 19;
  if (vid === 5484) return 5;
  if (vid === 5485) return 6;
  if (vid >= 5499 && vid <= 5509) return 7 + vid - 5499;
  if (vid === 5534) return 18;
  return 0;
}

/** 受击/死亡语音入参聚合面（appearance 三字段 + equipStats 饰品 override;
 *  兼容旧签名裸 skinVariant 数字）。字段全可选=测试桩/旧存档缺省安全 */
export interface VoiceState {
  skinVariant?: number | null;
  voiceVariant?: number | null;      // PlayerVoiceID 1/2/3（Appearance 持久化 byte）
  voicePitchOffset?: number | null;  // -1..1（Appearance 持久化 float）
  voiceOverride?: number | null;     // PlayerVoiceOverrideID（equipStats 聚合）
  /** ★BJ598 件2:甲支受击音旗（PlayHurtSound :38984-38991）——frost=frostArmor
   *  （本仓由 equipStats.frostBurn 三元组承载）/ bone=boneArmor。命中即直播甲音
   *  （override 之后、DST 世界门之前）;两旗同时为真按原版序 frost 先于 bone */
  frostArmor?: boolean;
  boneArmor?: boolean;
  /** ★BJ652 件4:坐骑/狼人支（PlayHurtSound :38946-38982——override 后、甲支前,
   *  各支命中即 return）——mountType=mount.Type（mount.Active 才传,缺省/0=无坐骑）；
   *  wereWolf=wereWolf‖forceWerewolf‖!hideWolf 合成面（forceWerewolf/hideWolf
   *  本仓未建模=只认 wereWolf,头注登记）。52 狼骑(3,6)/54 迅猛龙(3,47)/
   *  55 鼠(4,4)/56 蝙蝠(4,4)/61 仙灵(3,5);狼人(3,6) */
  mountType?: number | null;
  wereWolf?: boolean;
  hideWolf?: boolean;
}

/** 受击分派计划（纯函数零 RNG;鸡稀有变体独立掷交播放侧执行） */
export interface HurtVoicePlan {
  files: string[];
  vol: number;
  /** 显式变调（XNA Pitch -1..1）——variant 段恒带,跳过 PITCH_CASE 抖动 */
  pitch?: number;
  /** case6 鸡 1/5 稀有变体（PlayHurtSound case6 本体 :38899-38906,Next(5)==0） */
  rare?: { denom: number; files: string[]; vol: number };
  /** ★BJ598:分派来源档——'override'=voiceOverride 直播;'mount'/'werewolf'=坐骑/
   *  狼人支（:38946-38982,BJ652 件4）;'armor'=甲支（frost/bone,:38984-38991,
   *  原版各支先于 dontStarve 世界门 return,DST 门据此排除）;缺省='variant' 尾段 */
  source?: 'override' | 'mount' | 'werewolf' | 'armor' | 'variant';
}

// —— voiceOverride 直播表（PlayHurtSound switch :38879-38996;vol=SoundID WithVolume;
//    键=PlayerVoiceOverrideID。case3/4 DST 双声不接——见头注白名单备案）——
const OVERRIDE_HURT: Record<number, { files: string[]; vol: number }> = {
  1: { files: MALE_HURT_FILES, vol: 1 },      // PlaySound(1)(:38881)
  2: { files: FEMALE_HURT_FILES, vol: 1 },    // PlaySound(20) 无 pitch(:38884)
  5: { files: ['Item_35'], vol: 1 },          // BellHurt=(2,35) ×0.75 FILE_CASE_VOL 自动(:38896)
  6: { files: ['player_hit_chicken'], vol: 0.8 },   // ChickenHurt(:38899);稀有掷见 rare
  7: { files: ['player_hit_frog'], vol: 0.5 },      // FrogHurt(:38909)
  8: { files: ['player_hit_goat'], vol: 0.5 },      // GoatHurt(:38912)
  9: { files: ['player_hit_retro'], vol: 0.5 },     // RetroHurt(:38915)
  10: { files: ['player_hit_cat'], vol: 0.5 },      // CatHurt(:38918)
  11: { files: ['player_hit_dog'], vol: 0.5 },      // DogHurt(:38921)
  12: { files: ['player_hit_turkey'], vol: 0.5 },   // TurkeyHurt(:38924)
  13: { files: ['player_hit_goblin'], vol: 0.5 },   // GoblinHurt(:38927)
  14: { files: ['player_hit_crow'], vol: 0.5 },     // CrowHurt(:38930)
  15: { files: ['player_hit_balloon'], vol: 0.5 },  // BalloonHurt(:38933)
  16: { files: ['player_hit_undead'], vol: 0.5 },   // UndeadHurt(:38936)
  17: { files: ['player_hit_vampire'], vol: 0.5 },  // VampireHurt(:38939)
  18: { files: ['player_hit_fairy'], vol: 0.5 },    // FairyHurt(:38942)
  19: { files: ['Item_16'], vol: 1 },               // WhoopieCushion→SoundID.Item16=(2,16)(:38945)
  20: { files: ['player_hit_default'], vol: 0.9 },  // Other→DefaultPlayerHurt(:38893,±0.2 PITCH_CASE)
};

/** 死亡分派（PlayDeathSound :39020-39040 switch;override 1/2 与缺省同为
 *  PlaySound(5)=Player_Killed 库;case3/4 DST 不接同上备案） */
export function deathVoicePlan(state: VoiceState | null | undefined): { file: string; vol: number } {
  const ov = state?.voiceOverride ?? 0;
  if (ov === 5) return { file: 'Item_35', vol: 1 };                  // BellHurt(:39027)
  if (ov === 9) return { file: 'player_death_retro', vol: 0.5 };     // RetroDeath(:39030)
  if (ov === 15) return { file: 'player_hit_balloon', vol: 0.8 };    // BalloonDeath(:39033)
  return { file: 'Player_Killed', vol: 1 };                          // case1/2/默认 PlaySound(5)(:39022/:39037)
}

/** 受击全分派（PlayHurtSound :38867-39011 纯决策面;stoned 支 :38873 由调用方
 *  石化路径自播 dig,不经此口——与旧约定一致） */
export function hurtVoicePlan(state: VoiceState | number | null | undefined): HurtVoicePlan {
  const st: VoiceState = typeof state === 'number' ? { skinVariant: state } : (state ?? {});
  const ov = st.voiceOverride ?? 0;
  const hit = OVERRIDE_HURT[ov];
  if (hit) {
    return ov === 6
      ? { ...hit, rare: { denom: 5, files: ['player_hit_chicken_rare'], vol: 0.5 }, source: 'override' as const }
      : { ...hit, source: 'override' as const };
  }
  // ★BJ652 件4:坐骑/狼人支（PlayHurtSound :38946-38982——override switch 之后、
  //  甲支之前,原版各支命中即 return）。坐骑音=mount.Type 五档（52 狼骑(3,6)/
  //  54 迅猛龙(3,47)/55 鼠(4,4)/56 蝙蝠(4,4)/61 仙灵(3,5)）;狼人=(wereWolf‖
  //  forceWerewolf)&&!hideWolf → (3,6)——本仓 forceWerewolf/hideWolf 未建模
  //  （登记偏差,头注②）。legacy(3,N)=NPC_Hit_N/(4,N)=NPC_Killed_N（NPCHit25
  //  同法 Game.ts:14136 消费互证）,vol 缺省 1（legacy PlaySound 无音量实参）。
  if (st.mountType != null && st.mountType > 0) {
    const mt = st.mountType;
    if (mt === 52) return { files: ['NPC_Hit_6'], vol: 1, source: 'mount' };      // :38950
    if (mt === 54) return { files: ['NPC_Hit_47'], vol: 1, source: 'mount' };     // :38954
    if (mt === 55) return { files: ['NPC_Killed_4'], vol: 1, source: 'mount' };   // :38958
    if (mt === 56) return { files: ['NPC_Killed_4'], vol: 1, source: 'mount' };   // :38962
    if (mt === 61) return { files: ['NPC_Hit_5'], vol: 1, source: 'mount' };      // :38966
  }
  if ((st.wereWolf || (st as { forceWerewolf?: boolean }).forceWerewolf) && !st.hideWolf) {
    return { files: ['NPC_Hit_6'], vol: 1, source: 'werewolf' };                  // :38969-38972
  }
  // ★BJ598 件2:甲支（PlayHurtSound :38984-38991——override/mount/狼人支之后、
  //  dontStarve 世界门之前）:frostArmor→SoundID.Item27、
  //  boneArmor→legacy(3,style2)=NPCHit2,vol 均缺省 1（legacy PlaySound 无音量实参）。
  //  两旗同帧按原版序 frost 先于 bone（原版两支互斥 return;frost 套与骨甲三件不同
  //  槽实际不可同穿,序仅锁语义）。
  if (st.frostArmor) return { files: ['Item_27'], vol: 1, source: 'armor' };
  if (st.boneArmor) return { files: ['NPC_Hit_2'], vol: 1, source: 'armor' };
  // 尾段 variant 分派（:38996-39009）：voiceVariant 缺省按外观性别推导
  // （建号初始化 Male?1:2,Player.cs:56393;旧存档/测试桩无字段的等价回退）
  const variant = st.voiceVariant
    ?? (FEMALE_VARIANTS.includes(st.skinVariant ?? 0) ? 2 : 1);
  const plan: HurtVoicePlan =
    variant === 2 ? { files: FEMALE_HURT_FILES, vol: 1 }    // PlaySound(20,…,pitchOffset)(:39004)
      : variant === 3 ? { files: ['player_hit_default'], vol: 0.9 }   // DefaultPlayerHurt(:39007)
        : { files: MALE_HURT_FILES, vol: 1 };               // case1 PlaySound(1,…,pitchOffset)(:39001)
  plan.pitch = remapVoicePitch(st.voicePitchOffset);        // 三 case 同式直传(:38998/:39003)
  return plan;
}

/** 受击语音文件池（按外观性别分流;导出供既有测试断言。WAV_MAP.hurt 保持不动——
 *  本 helper 直用文件名数组,不经逻辑名（其他 'hurt' 消费方兼容不受扰）。 */
export function playerHurtFiles(skinVariant: number | null | undefined): string[] {
  return FEMALE_VARIANTS.includes(skinVariant ?? 0) ? FEMALE_HURT_FILES : MALE_HURT_FILES;
}

/** 播一次玩家受击语音（=原版 PlayHurtSound 尾段/override 支的取一播放）。
 *  入参兼容旧裸 skinVariant 数字与新 VoiceState 聚合对象 */
export function playHurtVoice(game: GameHooks, state: VoiceState | number | null | undefined): void {
  const st0 = typeof state === 'number' ? { skinVariant: state } : (state ?? {});
  // ★BJ598:计划先行——甲支（plan.source==='armor'）原版位次在 dontStarve 门之前
  const plan = hurtVoicePlan(state);
  // DST 世界门(:38993-38995,dontStarve&&!remix——override switch 后、variant 段前;
  // override/mount/狼人/甲支命中（plan.source 有档）均跳过本门——原版各支在
  // DST 门【前】return,只有落空到 variant 尾段才可达此门):
  // Male ? DSTMaleHurt : DSTFemaleHurt,三变体随机,vol 0.1(SoundID.cs:1056/:1058)
  const sfH = (game as unknown as { world?: { seedFlags?: Record<string, boolean | undefined> } }).world?.seedFlags ?? {};
  if (!plan.source && sfH.theConstant && !sfH.remix) {
    const maleH = !FEMALE_VARIANTS.includes(st0.skinVariant ?? 0);
    game.playSfxWav?.(`${maleH ? 'dst_male_hit' : 'dst_female_hit'}_${Math.floor(Math.random() * 3)}`, 0.1);
    return;
  }
  let files = plan.files;
  let vol = plan.vol;
  if (plan.rare && Math.floor(Math.random() * plan.rare.denom) === 0) {
    files = plan.rare.files;                               // case6 Next(5)==0 稀有变体(:38919)
    vol = plan.rare.vol;
  }
  game.playSfxWav?.(files[Math.floor(Math.random() * files.length)], vol,
    undefined, undefined, plan.pitch);
}

/** 播一次玩家死亡语音（PlayDeathSound :39013-39041;KillPlayer :39166 唯一调用点。
 *  本仓三处死亡发声点统一走此口——Game.damagePlayer 接触致死两分支 + Player.update
 *  死亡等待重生兜底（溺水/岩浆/摔落等不经 damagePlayer 的死法）） */
export function playDeathVoice(game: GameHooks, state: VoiceState | null | undefined): void {
  // DST/十周年世界缺省支(:39036-39040:dontStarve||tenthAnniversary → DST 双声,
  // 无 remix 排除——与受击门不同,照抄);override 命中已在 deathVoicePlan 内先行返回
  const sfD = (game as unknown as { world?: { seedFlags?: Record<string, boolean | undefined> } }).world?.seedFlags ?? {};
  const ovD = state?.voiceOverride ?? 0;
  // 原版死亡 switch 只对 {1,2,3,4,5,9,15} 提前 return(Player.cs:39020-39041);
  // 其余 override(6,7,8,10-14,16-20)落到 DST 支——2026-08-26 审计收窄修正
  const DEATH_SWITCH_RETURNS = new Set([1, 2, 3, 4, 5, 9, 15]);
  if (!DEATH_SWITCH_RETURNS.has(ovD) && (sfD.theConstant || sfD.tenthAnniversary)) {
    const maleD = !FEMALE_VARIANTS.includes(state?.skinVariant ?? 0);
    game.playSfxWav?.(`${maleD ? 'dst_male_hit' : 'dst_female_hit'}_${Math.floor(Math.random() * 3)}`, 0.1);
    return;
  }
  const plan = deathVoicePlan(state);
  game.playSfxWav?.(plan.file, plan.vol);
}
