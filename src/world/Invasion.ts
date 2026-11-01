// 原版入侵系统核心（Main.cs:63775-63962 + NPC.cs:79021-79180，1.4.5.6 1:1）。
// 状态五元组持久化在 World（invasionType/Size/SizeStart/X/Delay，WorldFile.cs:1306-1339）；
// invasionWarn 是运行时字段（Game 持有，不存档——读档后立即广播一次，同原版）。
import type { World } from './World';

/** 入侵类型（InvasionID.cs） */
export const INVASION_NONE = 0;
export const INVASION_GOBLIN = 1;
export const INVASION_SNOW_LEGION = 2;
export const INVASION_PIRATE = 3;
export const INVASION_MARTIAN = 4;

/** NPC → 入侵组号表（NPC.GetNPCInvasionGroup, NPC.cs:79095-79180）。
 *  组 1=哥布林 2=雪人 3=海盗（含召唤物/部件：472 幻影/492 飞船炮/662 海盗幽灵）
 *  组 4=火星（NPC.cs:79123-79136；384 盾/392-394 飞碟部件不在组内,不扣分）。
 *  ★G39-A（bj742a D-③,2026-11-01）：补负组三段（原版 :79155-79228,原表只取正组
 *  供进度条扣分用）——-1 南瓜月 338-352 / -2 霜月 305-315+325-327+329-330（328
 *  原文缺位）/ -3 旧日军团 547-578（550 原文缺位）。既有三消费面
 *  （Game.ts respawn/invasionBar/击杀扣分）全带 `group===invasionType` 正值守卫
 *  ⇒ 负组加入零扰动;新消费=微光 AllowShimmerDodge 三查门读 `!=0`（Player.cs
 *  :39065,负组同拒闪避——南瓜月/霜月/OOA 怪的接触伤不被微光吞）。 */
export const INVASION_GROUP: Record<number, number> = (() => {
  const g: Record<number, number> = {};
  for (const id of [26, 27, 28, 29, 111, 471, 472]) g[id] = 1;
  for (const id of [143, 144, 145]) g[id] = 2;
  for (const id of [212, 213, 214, 215, 216, 252, 491, 492, 662]) g[id] = 3;
  for (const id of [381, 382, 383, 385, 386, 387, 388, 389, 390, 391, 394, 395, 520]) g[id] = 4;
  for (let id = 338; id <= 352; id++) g[id] = -1;              // ★G39-A：南瓜月
  for (const id of [305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315,
    325, 326, 327, 329, 330]) g[id] = -2;                       // ★G39-A：霜月
  for (const id of [547, 548, 549, 551, 552, 553, 554, 555, 556, 557, 558, 559,
    560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573, 574,
    575, 576, 577, 578]) g[id] = -3;                            // ★G39-A：旧日军团
  return g;
})();

/**
 * 事件进度条文案键（Main.DrawInvasionProgress :48536-48551 的 icon→Lang.inter 表反解）。
 * 常规入侵 icon = invasionType + 3（CheckInvasionProgressDisplay :47040-47044 的
 * `(num2<0)?(-num2):(num2+3)` / SyncAnInvasion :48481 同式）⇒ 1 哥布林→icon4→inter[88]
 * （LegacyInterface.88 哥布林军队）/ 2 雪人军团→icon5→inter[87] / 3 海盗→icon6→inter[86] /
 * 4 火星→icon7→inter[85]（火星暴乱）。
 * ★BJ301 定谳（用户实报）：旧实现三元 else 兜底把火星(4)一并吞进 88——火星暴乱事件
 * 进度条显「哥布林军队」。
 */
export function invasionBarNameKey(invasionType: number): number {
  switch (invasionType) {
    case INVASION_MARTIAN: return 85;
    case INVASION_PIRATE: return 86;
    case INVASION_SNOW_LEGION: return 87;
    default: return 88;   // 哥布林（INVASION_GOBLIN；原版 icon 表外无第五型）
  }
}

/** 击杀扣分权重（NPC.cs:79026-79050；默认 1，船长 216=5；飞碟 395=10，
 *  召唤师 471=10、飞船 491=10、幻影 472=0、特斯拉炮塔 387=0） */
export const KILL_WEIGHT: Record<number, number> = {
  216: 5, 471: 10, 491: 10, 472: 0, 395: 10, 387: 0,
};

/** 入侵/事件曲 type→MusicID 表（Main.cs UpdateAudio_DecideOnNewMusic switch(type)
 *  :12196-12260 的非 Boss 族 + :12474-12535 槽位→MusicID）。
 *  与 INVASION_GROUP（计分表）分离：音乐触发是纯 type 邻近（±5000px），无
 *  invasionType 门，且成员表不同——492 飞船炮/394 飞碟尾锥只计分不切曲，
 *  384 火星军官护盾/392 飞碟炮座只切曲不计分；雪人三兄弟 143-145 与克脑 266
 *  共用 num3=3 槽 → Boss3(13)。 */
export const INVASION_MUSIC: Record<number, number> = (() => {
  const m: Record<number, number> = {};
  for (const id of [26, 27, 28, 29, 111, 471, 472]) m[id] = 39;            // 哥布林 GoblinArmy
  for (const id of [212, 213, 214, 215, 216, 252, 491, 662]) m[id] = 35;   // 海盗 PirateInvasion
  for (const id of [381, 382, 383, 384, 385, 386, 387, 388, 389, 390, 391, 392, 395, 520]) {
    m[id] = 37;                                                            // 火星 MartianMadness
  }
  for (const id of [143, 144, 145]) m[id] = 13;                            // 雪人 Boss3
  return m;
})();

/** 入侵进行中（SpawnHomelessNPC/SpawnTravelNPC 压制门，WorldGen.cs:4987） */
export function invasionActive(w: World): boolean {
  return w.invasionType > 0 && w.invasionDelay === 0 && w.invasionSize > 0;
}

/** CanStartInvasion（1456 Main.cs:63863-63881 / 1457 Main.cs:65387-65406）：无进行中 + 冷却为 0（ignoreDelay 可跳）+ 生命上限≥200。
 *  单人 n=1；规模公式在 StartInvasion 体内（1456 Main.cs:63904-63913 / 1457 Main.cs:
 *  65428-65437,★行号重钉 2026-09-08——旧注"StartInvasion :63904-63913"缺 Main.cs
 *  前缀,按 1456 WorldGen.cs:63904 查=蛛网掷、1457 WorldGen.cs:63904=树摇,两头落空;
 *  StartInvasion 本体在 Main.cs 非 WorldGen.cs）按合格玩家人数,单人固定档 */
export function canStartInvasion(w: World, playerMaxHp: number, ignoreDelay = false): boolean {
  if (w.invasionType !== 0) return false;
  if (w.invasionDelay !== 0 && !ignoreDelay) return false;
  return playerMaxHp >= 200;
}

/** StartInvasion（1456 Main.cs:63884-63933 / 1457 Main.cs:65408-65459）。返回公告用的 misc 编号（approaching west/east）
 *  供调用方 newText——文案本身无参数，方向由 invasionX 决定 */
export function startInvasion(w: World, type: number): number | null {
  if (w.invasionType !== 0 && w.invasionSize === 0) w.invasionType = INVASION_NONE; // 允许胜利后立刻开
  if (w.invasionType !== 0) return null;
  const n = 1; // 单人
  w.invasionSize = 80 + 40 * n;                                  // 1457 Main.cs:65429
  if (type === INVASION_PIRATE) w.invasionSize += 40 + 20 * n;   // 海盗 120+60n（1457 :65430-65433）
  if (type === INVASION_MARTIAN) w.invasionSize = 160 + 40 * n;  // 火星 160+40n（1456 Main.cs:63910-63913 / 1457 :65434-65437,旧注 :63898-63900 系漂引）
  w.invasionSizeStart = w.invasionSize;
  // invasionX（1456 Main.cs:63920-63932 / 1457 :65444-65456）：非火星 50/50 世界左右边缘；与 spawnX 的相对方向决定公告文案
  w.invasionX = Math.random() < 0.5 ? 0 : w.store.w;
  // 火星前线直接压在出生点旁一格（1457 Main.cs:65446 invasionX=spawnTileX-1+:65447 warn=2;
  // 1456 :63922-63923）——下一帧
  // tickInvasion 推进即"抵达"并广播 misc 41;原版同时置 invasionWarn=2（Game 侧私有
  // 计数,首帧 warn=0 时 arrived 公告同帧生效,语义等价）
  if (type === INVASION_MARTIAN) w.invasionX = w.spawnX - 1;
  w.invasionType = type;
  return invasionWarningMisc(w);
}

/**
 * InvasionWarning 文案选择（Main.cs:63853-63862）：按剩余量与前线方向返回 LegacyMisc 编号。
 *  misc 0/1/2/3 = 哥布林 defeated/西来/东来/抵达；4-7 雪人；24-27 海盗；
 *  41/42 = 火星 抵达/defeated——原版火星"西来/东来"取 LocalizedText.Empty
 *  （前线自 spawn-1 启动,恒当帧抵达,接近文案无意义）→ -1（调用方静默）
 */
export function invasionWarningMisc(w: World): number {
  const fromWest = w.invasionX < w.spawnX;
  const arrived = w.invasionX === w.spawnX;
  const defeated = w.invasionSize <= 0;
  switch (w.invasionType) {
    case INVASION_GOBLIN:
      return defeated ? 0 : arrived ? 3 : fromWest ? 1 : 2;
    case INVASION_SNOW_LEGION:
      return defeated ? 4 : arrived ? 7 : fromWest ? 5 : 6;
    case INVASION_PIRATE:
      return defeated ? 24 : arrived ? 27 : fromWest ? 25 : 26;
    case INVASION_MARTIAN:
      return defeated ? 42 : arrived ? 41 : -1;
    default:
      return -1;
  }
}

/** UpdateInvasion 的状态推进（Main.cs:63775-63851，每帧调）。
 *  返回 announce = 本帧应广播的 misc 编号（null=不播）；won = 胜利帧的入侵类型
 *  （0=未胜利；类型已在本函数内清零，故用返回值传达）。公告渲染/胜利旗标副作用由调用方完成。
 *  warn 计数由调用方持有（原版 invasionWarn 字段，3600 帧周期重播） */
export function tickInvasion(w: World, warn: number): { warn: number; announce: number | null; won: number } {
  if (w.invasionType <= 0) return { warn, announce: null, won: 0 };
  let announce: number | null = null;
  // 胜利判定（:63782-63810）
  if (w.invasionSize <= 0) {
    const wonType = w.invasionType;
    announce = invasionWarningMisc(w);            // defeated 文案
    w.invasionType = INVASION_NONE;
    w.invasionDelay = 0;
    return { warn: 0, announce, won: wonType };
  }
  // 前线推进（:63813-63845）：1 tile/帧 向 spawnTileX；首次抵达即公告 arrived，
  // 且 warn 只在推进中递减（抵达后冻结——原版 warn-- 在推进分支内，抵达不再周期重播）
  if (w.invasionX !== w.spawnX) {
    if (w.invasionX < w.spawnX) w.invasionX = Math.min(w.spawnX, w.invasionX + 1);
    else w.invasionX = Math.max(w.spawnX, w.invasionX - 1);
    if (w.invasionX === w.spawnX) announce = invasionWarningMisc(w);   // arrived
    else warn--;
  }
  // 周期公告（:63846-63850）：warn<=0 → 重置 3600 并播报
  if (warn <= 0) {
    announce = announce ?? invasionWarningMisc(w);
    return { warn: 3600, announce, won: 0 };
  }
  return { warn, announce, won: 0 };
}

/** ShouldSpawnInvasionEnemies（NPC.cs:352-374）：玩家侧 invaders 判定。
 *  玩家在地面（地表+屏高内）且距前线 ±3000px；
 *  次级条件（:366-375）：前线已达地图中线 ±5 格时，玩家 ±3000px 内有城镇 NPC
 *  → 2/3 概率也判 invaders（前线过半后城镇同样被袭击） */
export function shouldSpawnInvasionEnemies(
  w: World, px: number, py: number, screenHPx: number,
  townNpcXs: number[] = [],
): boolean {
  if (!invasionActive(w)) return false;
  if (py > w.groundLevel * 16 + screenHPx && w.spawnY <= w.groundLevel) return false; // 地下
  if (Math.abs(px - w.invasionX * 16) <= 3000) return true;
  const mid = w.store.w / 2;
  if (Math.abs(w.invasionX - mid) <= 5 && townNpcXs.some((tx) => Math.abs(px - tx) < 3000)) {
    return Math.random() >= 1 / 3;   // rand.Next(3)==0 → break（false）
  }
  return false;
}
