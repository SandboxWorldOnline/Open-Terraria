// 世界门面：TileStore + 元数据 + 实体容器 + 昼夜时钟
import { TileStore } from './TileStore';
import { WeatherState, applyWeatherSave, weatherToSave, type WeatherSave } from './weather/Weather';
import { T, TILE_DEFS } from '../data/tiles';
import { VI } from '../data/itemKeys';
import { newMoonEventState } from './MoonEvent';
import { newOldOnesArmyState } from './OldOnesArmy';
import { newLunarEventState } from './LunarEvent';
import type { FurnitureItemRecord } from './FurnitureItems';
import { BestiaryTracker, type BestiarySave } from '../data/Bestiary';
import { createJourneyPowers, type JourneyPowersState } from './JourneyPowers';
import { mainDifficulty, GDL } from '../stats/ScaleStats';

/** 世界箱/银行统一槽位（Chest.cs:58 DefaultMaxItems=40、:185-188 构造器全 40——
 *  1.4 起原版无 10 槽箱；曾用 10 = 容量 1/4 + wld 导入静默丢第 11-40 格,R21-3） */
export const CHEST_MAX_ITEMS = 40;

/** ★SW-AU2 2026-09-06 items 元素并入 favorited/placeStyle 可选位：银行/虚空袋条目
 *  原版随 .plr 存收藏标记（Player.cs:55515 bank4 favorited 序列化），箱格进出清/
 *  保标记面（ItemSlot.cs:362-366 MouseItemSwap）需该数据位在容器面可达 */
/** ★SW-BJ17 2026-09-07 开/关盖动画位：frame/frameCounter ≡ Main.chest[i].frame /
 *  frameCounter（Chest.cs:78-80 字段,UpdateChestFrames :3599-3657 驱动）。可选字段
 *  =存量存档/联机 ChestData 合成对象零迁移（缺省 0=关）；banks(x<0) 无 tile 姿态
 *  不消费（vanilla _chestInUse 收 chest>=0 门 :3604-3606） */
export interface ChestData { x: number; y: number; items: Array<{ id: number; stack: number; prefix?: number; favorited?: boolean; placeStyle?: number } | null>; locked?: boolean; frame?: number; frameCounter?: number; /** ★SW-FX11（2026-09-10）：箱名（原版 WF:1660 随箱段持久;重命名 UI 未实装=UI.ts:7358 债,导入/导出环先通） */ name?: string; }

/** 世界尺寸档（原版 WorldGen.GetWorldSize cs:6518）：≤4200→0 小 / ≤6400→1 中 / 其余→2 大。
 *  UIWorldCreation 三档 = 4200×1200 / 6400×1800 / 8400×2400（WorldGen.cs:11163）。 */
export type WorldSize = 0 | 1 | 2;
export function worldSizeFor(maxTilesX: number): WorldSize {
  return maxTilesX <= 4200 ? 0 : maxTilesX <= 6400 ? 1 : 2;
}

/** 死亡掉钱保留比例（返回值 = 留在身上的份额；Player.DropCoins :53351-53390）：
 *  经典/旅程世界掉一半 / 专家掉 3/4 / 大师全掉——按**世界难度** Main.GameMode
 *  （0 经典 1 专家 2 大师 3 旅程按经典，Main.cs:2775-2780）。角色难度只决定
 *  是否走 DropCoins（见 Appearance.dropsCoinsOnDeath），不决定档位 */
export function deathCoinKeepFraction(worldDifficulty: number): number {
  // 原版 Player.DropCoins :53351-53380：num2 = stack/2(经典)/stack/4(专家)/0(大师) 是
  // **留在身上的份额**（num3 = stack - num2 才落地）——曾把 num2 误当掉出份额写反。
  if (worldDifficulty === 2) return 0;      // masterMode：num2=0 全掉（:53359）
  if (worldDifficulty === 1) return 0.25;   // expertMode：num2=stack/4 → 掉 3/4（:53356）
  return 0.5;                              // 经典/旅程：num2=stack/2 → 掉 1/2（:53353）
}

export class Clock {
  /** 昼夜边界（1:1 Main.time：昼 4:30AM-7:30PM=54000t、夜 32400t；0=午夜线性 24h） */
  static readonly DAWN = 4.5 / 24;   // 0.1875
  static readonly DUSK = 19.5 / 24;  // 0.8125
  timeOfDay: number = 8.25 / 24;   // 0-1，0=午夜 0.5=正午（起始 8:15AM = Main.time 13500）
  dayCount: number = 1;
  /** 月相 0-7（0=满月 4=新月；每黎明 +1 mod 8，Main.cs:64877）。对话月相池/血月门用 */
  moonPhase: number = 0;
  /** 血月旗标（dusk roll / dawn 清除，Main.cs:64817-64831） */
  bloodMoon: boolean = false;
  /** 日食旗标（Main.eclipse，随存档持久化——WorldFile.cs:1277-1278 写 / 2070-2072
   *  读，serialize meta.eclipse 同语义）：黎明 roll（Main.cs:64899-64920，
   *  hardMode && downedMechBossAny && 1/20）/ 日耀碑牌召唤（Player.cs:43308，白天），
   *  夜幕清除（Main.cs:64721-64725）——全天持续，只影响白天刷怪段。
   *  触发/清除实现在 world/Eclipse.ts */
  eclipse: boolean = false;
  /** 圣诞季（现实日期 12/15-31 ∪ 强制位，checkXMas ★1457 Main.cs:13290-13310——
   *  由 Game.checkSeasonal 每黎明/读档重算,直读现实 DateTime.Now 的 1:1 镜像） */
  xMas: boolean = false;
  /** 万圣季（现实日期 10/10-10/31 ∪ 11/1 ∪ 强制位——isHalloweenDateNow
   *  ★1457 Main.cs:13315-13327:day≥10∧month==10,或 day≤1∧month==11;checkHalloween
   *  :13329-13344。旧注「10/20-11/10」系笔误,窗界以反编译为准,SW-BJ55 校正） */
  halloween: boolean = false;
  readonly dayLengthMs: number;
  constructor(dayLengthMs: number) { this.dayLengthMs = dayLengthMs; }
  tick(dtMs: number) {
    // 原版 Main.time 恒速 tick（1t/帧）：dayLengthMs=全周期 24min 时，0.625/0.375 的
    // 昼夜窗口自然得出 15min/9min——★勿再按段调速（曾除反导致昼夜缩水，探针抓回）
    this.timeOfDay += dtMs / this.dayLengthMs;
    while (this.timeOfDay >= 1) { this.timeOfDay -= 1; this.dayCount++; }
  }
  get isDay(): boolean { return this.timeOfDay > Clock.DAWN && this.timeOfDay < Clock.DUSK; }
  /** timeOfDay（0=午夜线性 24h）→ 原版**分段** Main.time（昼 4:30AM 起归零 0..54000、
   *  夜 7:30PM 起归零 0..32400）。消费方（吃数值）：手表行 Main.cs:47601-47610
   *  （1456 :46182-46236）/ 药草 style5 收获门 WorldGen.cs:66689（1456 :66214）
   *  `Main.time > 40500` 等。
   *  ★勿把 timeOfDay×86400（绝对钟面刻度）直接当 Main.time 喂给按分段式写的
   *  换算器——两口径恒差 4.5h（昼）/19.5h（夜），曾把手表时间行快拨 4.5h，
   *  上午 9 点天还黑着（2026-08-31 用户实报，Game.infoAccCtx 装配处修正） */
  static vanillaMainTime(timeOfDay: number): number {
    if (timeOfDay >= Clock.DAWN && timeOfDay < Clock.DUSK) return (timeOfDay - Clock.DAWN) * 86400;
    return ((((timeOfDay - Clock.DUSK) % 1) + 1) % 1) * 86400;
  }
  get dayFactor(): number {
    // 昼夜平滑系数：白天 1，夜晚 0.32（月光下地表仍可见，火把不再像贴在黑幕上），晨昏过渡
    const t = this.timeOfDay;
    if (t > Clock.DAWN + 0.04 && t < Clock.DUSK - 0.04) return 1;
    if (t >= Clock.DUSK - 0.04 && t < Clock.DUSK + 0.04) return 1 - (t - (Clock.DUSK - 0.04)) / 0.08 * 0.68;
    if (t >= Clock.DUSK + 0.04 || t < Clock.DAWN - 0.04) return 0.32;
    return 0.32 + (t - (Clock.DAWN - 0.04)) / 0.08 * 0.68;
  }
  get hourFloat(): number { return this.timeOfDay * 24; }
}

// ---- ★SW-BJ55 现实日期节日窗（DateTime.Now 唯一权威镜像,单源）----
// 原版两窗都直读 DateTime.Now（Main.checkXMas/checkHalloween 每黎明 OnWorldLoad 调,
// Main.cs:66369-66370/WorldGen.cs:3273-3274 挂钩）。1458 同位逐行号零漂移
// （1458 Main.cs:13290/13313/13329）。

/** Main.isHalloweenDateNow（★1457 Main.cs:13315-13327）1:1：万圣窗 =
 *  10 月 10-31 日（day≥10∧month==10）∪ 11 月 1 日（day≤1∧month==11）。
 *  ★任务书假想窗「10/20-11/10」与反编译不符——以反编译为准（10/10 起窗）。 */
export function isHalloweenDateNow(now: Date): boolean {
  const day = now.getDate();
  const month = now.getMonth() + 1;             // DateTime.Month 1-12（JS getMonth 0-11 +1）
  if (day < 10 || month !== 10) {
    if (day <= 1) return month === 11;
    return false;
  }
  return true;
}

/** checkXMas 现实日期臂（★1457 Main.cs:13292-13299）1:1：圣诞窗 = 12 月 15-31 日
 *  （day≥15∧month==12；12 月内 day 15 起全开,跨年 1/1 关窗）。 */
export function isXMasDateNow(now: Date): boolean {
  const day = now.getDate();
  const month = now.getMonth() + 1;
  return month === 12 && day >= 15;
}

/** checkXMas/checkHalloween 全式（★1457 Main.cs:13290-13310 ∪ 13329-13344）：
 *  现实日期窗 ∪ forceXMas/HalloweenForToday（月事件胜利当日位）∪ forceForever
 *  （种子/存档持久位）——三分支或,顺序无关（原版三 if 独立置真）。 */
export function seasonalHolidayFlags(
  now: Date,
  force: { forceHalloweenForToday?: boolean; forceXMasForToday?: boolean },
  forever: { forceHalloweenForever?: boolean; forceXMasForever?: boolean },
): { halloween: boolean; xMas: boolean } {
  return {
    halloween: isHalloweenDateNow(now) || !!force.forceHalloweenForToday || !!forever.forceHalloweenForever,
    xMas: isXMasDateNow(now) || !!force.forceXMasForToday || !!forever.forceXMasForever,
  };
}

export class World {
  store!: TileStore;   // definite assignment(读档 skipStore 路径由 fromPacket 注入)
  /** 本帧 SceneMetrics 快照（Game 每帧写；Enemy 判 zoneGraveyard 等只读用） */
  scene: import('./SceneMetrics').SceneFlags | null = null;
  /** 历史索引帧修复已跑过（worker 读档管线在沉降前调 repairIndexFramesInStore 后置位、
   *  随包回传（protocol WorldPacket.repairedIndexFrames）；生成路径=生成端写像素帧
   *  终态天然免修，同样置位）。运行时标志不落盘——afterWorldLoad 据此跳过主线程
   *  二次全图扫描（#perf2026-08-28 批）。主线程 fallback 读档无此包标志 → 原地同步跑 */
  indexFramesRepaired?: boolean;
  /** 世界难度 = 原版 Main.GameMode（Main.cs:2677，ActiveWorldFileData.GameMode）：
   *  0 经典 / 1 专家 / 2 大师 / 3 旅程。与角色难度（Appearance.difficulty 0软/1中/2硬/3旅）
   *  是**两条独立轴**——世界难度管掉落倍率/吸血预算/掉钱档/旅行商店等 gameplay 门；
   *  角色难度只管死亡惩罚（软核掉钱/中核掉物品/硬核角色消亡）。创建 UI 写入、
   *  存档 header 持久化、wld 导入按 WldParser.gameMode 回填（旧档/worker 包缺省=0 经典） */
  difficulty = 0;
  /** 流星雨剩余计数(WorldGen.meteorShowerCount,WorldFile.cs:1069/:177 持久化)。
   *  消耗:UpdateWorld :71771-71810 每 tick 1/4 掷一颗 1078 伤害碎块,计数-1;
   *  晷快进直接清零(:71774-71777) */
  meteorShowerCount = 0;
  // ---- 夜间小动物概率五件套（NPC.setFireFlyChance，NPC.cs:94557-94610）----
  // 每夜 StartNight 重掷（Main.cs:64706）；原版为 NPC 静态位不落盘，本仓按运行时
  // 审计台账要求随存档（旧档缺省=代表值 30/5/15/10/绝迹）。消费端：
  //  fireFlyChance → VanillaSpawner 夜萤火虫门（NPC.cs:4413 Next(fireFlyChance)）；
  //  fireFlyFriendly/fireFlyMultiple → spawnFriendly 夜萤火虫群（NPC.cs:2321/:2329）；
  //  butterflyChance/stinkBugChance → 白昼蝴蝶/椿象（NPC.cs:2394/:2381）。
  // 999999 = 当夜该族绝迹（原版哨兵值）
  fireFlyChance = 30;
  fireFlyFriendly = 5;
  fireFlyMultiple = 15;
  butterflyChance = 10;
  stinkBugChance = 999999;
  /** CultistRitual.delay（CultistRitual.cs:32，WorldFile.cs:1340 写/:2192 读 随存档）：
   *  地牢拜月教石碑 437 自然重生延迟。石碑召出 439 时置 43200（TabletDestroyed，
   *  NPC.cs:38881），按 dayRate 递减；双零掷 TrySpawning(dungeonX/Y)（Main.cs:64427
   *  每帧 UpdateTime）。缺省 86400 = delayStart（新世界 ResetTempsToDayTime WF:1018 /
   *  v108 前旧档 WF:2188 同值）。recheck 为运行时静态位不落盘（RuntimeEvents.ts） */
  cultistDelay = 86400;
  /** 旗帜击杀计数（BannerSystem.killCount：bannerId[1-292]→数；BannerSystem.cs:34
   *  静态 int[293] 表）。随存档持久化——原版 WorldFile.cs:1347 BannerSystem.Save /
   *  :2210 BannerSystem.Load（v≥109 段；v≥289 再跟 claimableBanners u16[293]，本仓
   *  不建模领取面只存击杀数）；本仓落盘面 = 自有 JSON 存档 SaveData.bannerKills
   *  （save/serialize.ts:481/:113）+.wld 导入（WldParser banner 段:300-309）。
   *  旧档缺省 = 空表（loadSaveData 缺段守卫） */
  bannerKills: Record<number, number> = {};
  /** 旅程模式时间倍率（CreativePowers.ModifyTimeRate.TargetTimeRate，CreativePowers.cs:866-884：
   *  整数 1-24×，IPersistentPerWorldContent 随世界存档；非旅程世界恒 1） */
  journeyTimeRate = 1;
  /** 旅程模式时间冻结（CreativePowers.FreezeTime，CreativePowers.cs:1448——开启时 dayRate=0） */
  journeyFreezeTime = false;
  /** 旅程力量状态（CreativePowers 族，JourneyPowers.ts）——世界侧与单人玩家侧
   *  合并存储；落盘时按原版归属拆：世界侧进 header（freezeRain/freezeWind/
   *  stopBiomeSpread/difficultySlider）、玩家侧进 player 段（godmode/
   *  farPlacementRange/spawnRateSlider，IPersistentPerPlayerContent）。
   *  FreezeTime/ModifyTimeRate 不在此（复用上面两字段，T 键同源勿建第二套） */
  journeyPowers = createJourneyPowers();
  /** 附魔日晷/月晷快进（Main.fastForwardTimeToDawn/Dusk + sundialCooldown/moondialCooldown，
   *  Main.cs:6240-6268 Sundialing/Moondialing：使用置旗 + 冷却 8 天；快进中 dayRate=60。
   *  清旗点 = UpdateTime_StartDay :64844-64847（dawn）/ StartNight :64691-64694（dusk），
   *  冷却递减 = StartDay :64885-64887（sundial）/ StartNight :64695-64697（moondial），
   *  血月清零 = StartNight :64892-64893。随世界存档持久化（WorldFile.cs:1311/1342/1416-1417） */
  fastForwardTimeToDawn = false;
  fastForwardTimeToDusk = false;
  sundialCooldown = 0;
  moondialCooldown = 0;
  /** 全员熟睡旗（CurrentFrameFlags.SleepingPlayersCount==ActivePlayersCount && >0，
   *  Main.cs:6280-6285——Game 每 tick 下发；单人 = 本地玩家 sleeping && timeSleeping>=120） */
  allSleeping = false;
  /** IsFastForwardingTime（Main.cs:6230-6238）——事件 roll 压制门共用 */
  isFastForwardingTime(): boolean { return this.fastForwardTimeToDawn || this.fastForwardTimeToDusk; }
  /** 专家档（Main.expertMode Main.cs:2762 = Difficulty >= Expert）——Difficulty 轴
   *  含旅程强度滑杆（Main.cs:2771-2773 override 优先于 GameMode 档）：旅程世界
   *  滑杆 ≥2× 即专家语义（掉落条件/宝箱 ×2/血月门全链，原版同源） */
  get isExpert(): boolean { return mainDifficulty(this) >= GDL.EXPERT; }
  /** 大师档（Main.masterMode Main.cs:2760 = Difficulty >= Master）——同上随滑杆 */
  get isMaster(): boolean { return mainDifficulty(this) >= GDL.MASTER; }
  /** 旅程世界（Main.cs:2696 IsJourneyMode：GameMode==3） */
  get isJourney(): boolean { return this.difficulty === 3; }
  /** 当前 dayRate（Main.cs:6270-6294 UpdateTimeRate 1:1）：快进恒 60；
   *  否则冻结 0 / TargetTimeRate × 全员睡 5。时钟/天气/税计时/旅行商概率全链消费 */
  dayRate(): number {
    if (this.isFastForwardingTime()) return 60;
    if (this.journeyFreezeTime) return 0;
    return this.journeyTimeRate * (this.allSleeping ? 5 : 1);
  }
  /** 时间推进倍率（Main.cs:6278-6290 UpdateTimeRate：冻结 0 / 否则 TargetTimeRate；gameMenu 恒 1）
   *  ——不含快进/睡觉两档的旧入口，保留给不参与 dayRate 链的调用方 */
  journeyTimeScale(): number { return this.journeyFreezeTime ? 0 : this.journeyTimeRate; }
  /** 彩蛋种子旗标（SeedEasterEggs.parseSeed；血月 1/6 十周年 / drunkWorld 黎明翻转用。
   *  生成期灌入 + 存档 header.seedFlags 持久化；wld 导入自 S0-3 起按头九位回填
   *  （WldImport→SaveData.header.seedFlags→SaveFile.ts:281），普通档={}） */
  seedFlags: import('./gen/SeedEasterEggs').SeedFlags = {};
  /** ★IIIII20b：StarterNPC 换人一次性迁移标记（SaveData.header.starterSwapMigrated；
   *  旧档缺省=undefined 未迁移——换人族世界首载修复客户端时把历史伪影向导顶替并打标） */
  starterSwapMigrated?: boolean;
  /** ★mod 清单随档（2026-10-04 P3）：存档头 mods 的 id/version 投影（loadSaveData
   *  从 data.mods 落）——mainFlow enterGame 对账启用集弹缺失 toast（占位物语义
   *  的用户可见面）。自建世界/旧档=undefined */
  saveMods?: Array<{ id: string; version: string }>;
  /** FTW 克脑重力倒置锚（原版 NPC.brainOfGravity 静态槽）：克脑 266 二阶段每 tick
   *  写实体 id（NPC.cs:32650-32653，bossAI.brainOfCthulhuAI）；消费端 Player.fixedUpdate
   *  距脑 <4000px → gravDir=-1（Player.cs:26489-26496 forcedGravity）；锚失效/非 266
   *  由消费端清除（Main.cs:18127）。瞬态运行时位,不入档;-1 = 无 */
  brainOfGravity = -1;
  name: string;
  seed: number;
  spawnX = 0; spawnY = 0;
  /** 原始世界出生点（床 RemoveSpawn 回退锚——Player.RemoveSpawn :53686 清覆盖位语义;
   *  生成/wld 导入/存档回填时快照;header.spawn0 缺省回退当前 spawn（旧档兼容） */
  spawnX0 = 0; spawnY0 = 0;
  /** ★IIIII22b：royale-with-cheese 队伍出生点表（ExtraSpawnPointManager.extraSpawnPoints，
   *  cs:91-113 生成的 Point[6]；队 0=世界出生点）。瞬态运行时缓存**不落盘不进协议包**
   *  ——各端按世界种子确定性重算（src/world/spawn/ExtraSpawnsRoyale.ts R1 同种子重放
   *  范式），ensureExtraSpawnPoints 幂等填本字段；非 teamBasedSpawns 世界恒 undefined */
  extraSpawnPoints?: Array<{ x: number; y: number }>;
  /** ★IIIII22b：点表来源标记（与 extraSpawnPoints 同序）：'found'=TryFind 搜索命中，
   *  'fallback'=500 外层×250 内层预算耗尽后的百分位 fallback（vanilla cs:199 同态——
   *  fallback 不受 ≥250 分离门约束，合法可与他点相邻近；测试据此放宽哨兵） */
  extraSpawnMeta?: Array<'found' | 'fallback'>;
  groundLevel = 0; rockLevel = 0;   // tile 坐标
  /** GenVars.lavaLine（世界生成期的熔岩线 ≈ waterLine+50..79 ≈ h-340±）——**不是**原版
   *  地狱分层线。★issue#46 N12 勘误：旧注「地狱顶（UnderworldLayer = maxTilesY-200）」
   *  系把生成器局部变量当 Main 静态量（生成器侧 CaveWalls/BuriedChests 消费 lavaLine
   *  本身正确，勿动）；地狱分层消费一律走下方 underworldLine。 */
  lavaLine = 0;
  /** Main.UnderworldLayer（1457 Main.cs:2886 `public static int UnderworldLayer =>
   *  maxTilesY - 200`）——只读派生，随世界高度唯一确定。
   *  ★issue#46 N12：活火块掉落（Conditions.cs:939 `npc.position.Y / 16f >
   *  Main.UnderworldLayer`，**严格 >**）与蜘蛛池（NPC.cs:5848-5858 `Y >= h-200`）等
   *  "地狱分层"判定源；lavaLine 与之可能相差上百格，不可替代。 */
  get underworldLine(): number { return this.h - 200; }
  /** NPC.Spawner.fairyLog（MysticLogFairiesEvent.cs:181-183 扫倒木置位）——运行时位
   *  不落盘（StartWorld/StartNight 每次重扫回填）；地下仙女链（NPC.cs:5730）消费门 */
  fairyLog = false;
  clock: Clock;
  /** ★IIIII224：Main.IsItDay()（Main.cs:63790）——remix（don't dig up）世界**恒 false**。
   *  与渲染昼夜（clock.isDay=Main.dayTime）是两个口径：消费面 = 日夜型 AI 分支、
   *  白天召唤物判日（克脑骨餐 43/天磨 544/Mechdusa 556/557）、 fighter 驱散表等。
   *  remix 世界地表白天仍按"夜晚表"刷怪/判行为（原版同款倒挂）。 */
  get isItDay(): boolean { return !this.seedFlags?.remix && this.clock.isDay; }
  /** 天气系统（WeatherState 状态机；存档/wld 导入经 applyWeatherSave 回填） */
  weather = new WeatherState();
  applyWeather(s: Partial<WeatherSave>) { applyWeatherSave(this.weather, s); }
  chests: ChestData[] = [];
  /** 墓碑碑文（原版 Sign 系统的最小子集）：锚点 = 墓碑 tile 左上格 */
  signs: Array<{ x: number; y: number; text: string }> = [];
  /** 挂物族存放物（物品框 395/武器架 471/模特 470/帽架 475/食物盘 520/展示罐 698；
   *  原版 TileEntity 体系的最小等价，锚点 = 物件左上格。见 world/FurnitureItems.ts */
  furnitureItems: FurnitureItemRecord[] = [];
  /** 读档/wld 导入携带的城镇 NPC（afterWorldLoad 原位生成后清空；原版 WorldFile town NPC 段） */
  pendingTownNpcs?: Array<{ key: string; x: number; y: number; home: [number, number] | null; bound?: boolean; givenName?: string; shimmered?: boolean;
    /** ★SW-BO1 2026-09-07：流浪清场标（NPC.homelessDespawn,WorldFile.cs:1741/:2932） */
    homelessDespawn?: boolean;
    /** ★BJ259：踢出标（repo 侧标,① 轮再安置臂豁免面跨档;原版无对应字段） */
    kickedOut?: boolean }>;
  /** ★SW-FX11（2026-09-10）：NPC 段尾 SavesAndLoads 四塔位（WF:1744-1755/:2937-2955；
   *  NPCID.cs:4807 CreateBoolSet(422,507,517,493)）——afterWorldLoad 原位生成后清空。
   *  缺省=无（towerActive 旗在场走兜底重生成） */
  pendingPillarNpcs?: Array<{ id: number; x: number; y: number }>;
  /** ★SW-FX11（2026-09-10）：存档点按压中的压力板位（WF:3374-3386/:3388-3398）——
   *  afterWorldLoad 逐位 PokeLocation 一次性 hitSwitch 重触发后清空 */
  pendingPlatePokes?: Array<{ x: number; y: number }>;
  /** ★IIIIIII6：SpawnStarterNPCs pass（cs:19848-20068）播种的初始镇民——仅新世界首进
   *  消费一次后清空（不进存档：实例化后的镇民走 townNpcsForSave 的 town NPC 段，
   *  与原版一致）。celebrationmk10 五人组/组合分支记录，含 homeless 锚与朝向 */
  starterTownNpcs?: Array<{ key: string; givenName: string; x: number; y: number; anchor: [number, number]; dir: -1 | 1; variationIndex?: number }>;
  // Boss 进度旗标
  flags: Record<string, boolean> = { downedEyeOfCthulhu: false, downedSkeletron: false, shadowOrbSmashed: false, hardMode: false };
  /** 已砸碎恶魔祭坛数（WorldGen.altarCount，WorldFile.cs:1303/2100 随存档持久化）：
   *  SmashAltar 矿物三档轮换的波次源（%3 选档 /3+1 衰减），海盗入侵自然 roll 的
   *  altarCount>0 门（Main.cs:64938） */
  altarCount = 0;
  // ---- ★IIIII61 WorldGen.Skyblock 运行时普查旗（SkyblockRuntime.ts 维护；
  //      原版为 class Skyblock 静态域 :3045-3199。数据不落盘——每次进图暖扫重建）----
  /** 空岛低格档（Calculate :3181-3184：活跃格占比<0.1 && skyblockWorld）。
   *  消费面：刷怪率 ÷2 / 史莱姆体内物 / 夜始事件 roll 分母 / 掉落条件族 */
  skyblockLowTiles = false;
  /** 全图无恶魔祭坛（Calculate :3150-3177 hasTile[26]——EoC 自然 spawn 豁免臂
   *  与掉落条件 EyeOfCthulhuDefeatedAndNoAltarsInWorld 数据源；进图暖扫真首态，
   *  此后随巡检动态） */
  skyblockNoAltars = false;
  /** 全图无地牢砖/墙 / 无神庙砖或墙 / 无狱石 / 无化石 / 无生命水晶（Calculate 同段；
   *  skyblock 世界史莱姆战利品替代表消费：地狱石 174/沙漠化石 3347/生命水晶 29） */
  skyblockNoDungeon = false;
  skyblockNoTemple = false;
  skyblockNoHellstone = false;
  skyblockNoFossils = false;
  skyblockNoLifeCrystals = false;
  /** 全图无地狱熔炉（Calculate :3160-3177 hasTile[77]/[133]）。
   *  ★issue#46 N16：此前 SK 八旗中唯一未投影到 World 的一项——骷髅王(35) 缺熔炉
   *  补偿掉落（NPC.cs:79699/:80430-80434 NPCLoot_DropHellforge：221 + 清旗）消费端
   *  需要与 noAltars/noDungeon/noTemple 同源的投影值。 */
  skyblockNoHellforge = false;
  /** 困难矿世界锁定选种（WorldGen.SavedOreTiers，WF:1305-1307 随存档持久化）：
   *  每档矿种全世界二选一固定——钴 107/钯 221、秘银 108/山铜 222、精金 111/钛 223。
   *  -1 = 尚未砸过该档（SmashAltar 首砸 roll 一次并锁定）；存 sheet id */
  savedOreTiers = { cobalt: -1, mythril: -1, adamantite: -1 };
  /** 肉前矿四档锁定（WorldGen.SavedOreTiers.Copper/Iron/Silver/Gold，WF:11294-11320）：
   *  值=原版 tile id（7 铜/6 铁/9 银/8 金；166 锡/167 铅/168 钨/169 铂）。
   *  军火商银弹/钨弹分支（CH57:1487-1494 Silver==168）与世界生成矿种一致性消费 */
  oreTiersPH = { copper: 7, iron: 6, silver: 9, gold: 8 };
  /** 已砸暗影珠/猩红之心计数（WorldGen.shadowOrbCount，WF:1302/2099 随存档持久化）：
   *  满 3 召 EoW/BoC 后归零（CheckOrb :54321-54352）；哥布林军队自然 roll 的
   *  shadowOrbSmashed 门独立于此计数 */
  shadowOrbCount = 0;
  /** 图鉴统计（BestiaryUnlocksTracker——原版 IPersistentPerWorldContent，随世界存档：
   *  WorldFile.cs:3399 Save/:3405 Load。杀数/遇数/聊天三桶，数据层见 data/Bestiary.ts） */
  bestiary = new BestiaryTracker();
  // ---- 渔夫任务链（Main.anglerQuest / anglerWhoFinishedToday / anglerQuestFinished）----
  /** 当日任务鱼索引（Main.anglerQuest，Main.cs:1843；随世界存档 WorldFile.cs:1335/2161。
   *  每日黎明 AnglerQuestSwap 重掷（Main.cs:64852）；表 = Main.anglerQuestItemNetIDs
   *  41 条（Main.cs:1845-1852，本仓 data/vanillaFishing.ts ANGLER_QUEST_ITEMS） */
  anglerQuest = 0;
  /** 今日已交付玩家名单（Main.anglerWhoFinishedToday，Main.cs:1839；存档 WF:1329-1333/
   *  2147-2150——同日读档不重置，与原版一致）。多人=每名玩家各限一次 */
  anglerWhoFinishedToday: string[] = [];
  /** 今日任务是否已交（Main.anglerQuestFinished，Main.cs:1841）。运行时态**不存档**
   *  ——原版读档 WorldFile.ResetTemps 先重置 false（WorldFile.cs:628-629），读档装配
   *  完成后由 playWorldCallBack 重构（WorldGen.cs:6781-6784，见下方
   *  reconstructAnglerFinished）；黎明重掷时清零（AnglerQuestSwap :3806） */
  anglerQuestFinished = false;

  /** ★SW-BJ45 2026-09-09：单人读档渔夫任务完成旗重构（WorldGen.cs:6781-6784
   *  playWorldCallBack 装配尾：`if (Main.netMode == 0 &&
   *  Main.anglerWhoFinishedToday.Contains(Main.player[Main.myPlayer].name))
   *  Main.anglerQuestFinished = true;`）。ResetTemps（WorldFile.cs:628-629）先清 false，
   *  名单随世界档回填（WF:2147-2161）后于此重构——曾整缺 → 同日读档后旗=false 而
   *  交付名单 gate（Main.cs:39660 双门之名单门）仍拦 → 感叹号/鱼角标/任务台词俱在、
   *  点「任务」静默无效（用户实报「有任务鱼也提交不了」）。联机不重构（原版
   *  netMode!=0 由 msg74 按玩家名下发 finished，MessageBuffer.cs:3145-3152；本仓
   *  联机 quest sync 债登记 BJ45）。调用点 = Game.afterWorldLoad 装配尾 */
  reconstructAnglerFinished(playerName: string, isMultiplayer: boolean): void {
    if (!isMultiplayer && this.anglerWhoFinishedToday.includes(playerName)) {
      this.anglerQuestFinished = true;
    }
  }

  weatherToSave(): import('./weather/Weather').WeatherSave | undefined {
    return weatherToSave(this.weather);
  }
  /** 读档/worker 包回填（loadSaveData 与 WorldPacket.fromPacket 两条路径共用） */
  applyBestiary(data: BestiarySave | undefined): void {
    this.bestiary = BestiaryTracker.fromSave(data);
  }
  // 树登记：砍树干时找到整棵树（roots → 范围）
  trees: Array<{ x: number; y: number; h: number }> = [];
  /** 战争迷雾：1 = 已探索。按 tile 粒度。（读档 skipStore 路径由 fromPacket 注入） */
  explored!: Uint8Array;
  /** 原版树样式数据（header treeX/treeStyle）：横向 4 区森林树冠样式 */
  treeX: number[] = [];
  treeStyle: number[] = [0, 0, 0, 0];
  /** ★SW-FX43（2026-09-12）：caveBackX[3]（WF:1266-1268;原版 RandomizeCaveBackgrounds
   *  WorldGen.cs:8141-8210 独立掷,与 treeX 无派生关系）。自建=worldgen 掷值
   *  （WorldGen finalize 回填）、导入=原值;undefined（旧档）→ 导出按 treeX 派生回退 */
  caveBackX?: number[];
  /** ★SW-FX43：原版 worldId（WF:1244 写/:1977 读;LoadFooter :3003-3015 与 footer
   *  同值硬校验）。自建=genRand.Next(int.MaxValue) 掷值（WorldGen.cs:11364）、
   *  导入=原值;undefined（旧档）→ created-XOR 派生回退 */
  worldId?: number;
  /** ★SW-FX43：原版 .wld header 差量快照（全仓生产点=WldImport wldSnap 组装;
   *  随存档链携行至 exportWld writeHeader 快照优先回写——键集/差量裁断注记见彼处） */
  wldSnap?: Record<string, number | boolean | string>;
  /** ★SW-FX43：TE 三类透传快照（0 假人/2 传感器/7 晶塔;loadSaveData 载入后按
   *  CheckValidTile WF:3349-3359 淘汰）——FX35 SaveData 层→World 随档携行 */
  teSnap?: import('../save/serialize').SaveData['teSnap'];
  /** ★SW-FX43：城镇房间预留表（TownRoomManager.Save/Load,TownRoomManager.cs:94-124）
   *  ——FX35 SaveData 层→World 随档携行 */
  townRooms?: import('../save/serialize').SaveData['townRooms'];
  /** 尺寸档 0 小/1 中/2 大（构造时按宽派生，GetWorldSize 语义——多尺寸生成/消费分支用） */
  size: WorldSize = 0;
  /** 生成期水线（GenVars.waterLine，TerrainPass 写入）。生成期沉降的落水越线转
   *  岩浆（Liquid.cs:177-190；SettleLiquids 49/97 消费）。读档期原版把 waterLine
   *  置 maxTilesY 天然豁免（WorldFile.cs:739）——settle.ts 只在 gen 模式设值即同义 */
  genWaterLine = 0;
  /** ★IIIII58 REMIX 落水分型带（Liquid.cs:182-185 remixWorldGen 首臂——恒改写型）。
   *  仅 remix 世界置值：lavaLine=GenVars.lavaLine、rockLayer=(int)Main.rockLayer、
   *  oceanLevel=(worldSurface+rockLayer)/2+40（WorldGen.oceanLevel cs:4364）。 */
  genRemixWater: { lavaLine: number; rockLevel: number; oceanLevel: number } | null = null;
  /** 地牢豁免盒（DungeonUtils.CreatePotentialDungeonBounds 的 outerPotential
   *  DungeonBounds=半图矩形）。落水点在盒内且水源格墙 ∈ wallDungeon{7,8,9,94-99}
   *  → 回水不转岩浆（Liquid.cs:186-188）。
   *  ★IIIII210（ddual #99 定罪）：原版墙支=DungeonUtils.IsConsideredDungeonWall
   *  (tile.wall, allDungeons:true)＝Main.wallDungeon 基线 ∪ **各座 genvars 的
   *  isDungeonWall**（per-seat 风格墙族,DC.cs:147-185 注册;双地牢丛林座 205 等
   *  biome 墙在册）——旧硬编码基线集漏 dual 座 biome 墙 ⇒ 丛林座域落水恒转岩浆
   *  而原版回水（x86 S/L 事件流 L|751|831 b=0 vs JS b=1 实证）。界域支同理:
   *  原版 InAnyPotentialDungeonBounds=**各座** outer bounds 并集（dual=2 盒）,
   *  旧单盒=gs.dungeonSide 一座。dual 世界由 liquidSettlePass 附 boxes+walls
   *  （walls=dualDungeonState.wallProtection 并集表,vanilla wall id 索引）；
   *  两字段缺省 undefined=非 dual 旧语义（单盒+基线墙集,16 链绿带面不变）。 */
  genDungeonExempt: {
    x0: number; y0: number; x1: number; y1: number;
    boxes?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
    walls?: boolean[];
  } | null = null;
  /** 以太生物群系中心（GenVars.shimmerPosition；无微光世界为 0）。ShimmerPass 写入，
   *  生成期沉降 ShimmerRemoveWater（WorldGen.cs:34859）按此清腔内非微光液体 */
  shimmerX = 0;
  /** 月亮贴图样式（原版 header moonType 0-8,WF:1252;SkyRenderer 消费） */
  moonType = 0;
  /** 地狱多层背景风格（WorldGen.underworldBG,WF:1376;0/1/2 → Underworld 贴图集;
   *  本仓由种子确定性派生(seedPick),同 [[RandomizeBackgrounds]] 其余背景风格同策略） */
  underworldBG = 0;
  /** ★R16-5：背景样式落盘值（setBG 0-12；undefined=无落盘值 → seed 派生） */
  bgStyles?: import('../save/serialize').BgStylesSave;
  shimmerY = 0;
  /** 世界级生物群系常量(原版 header,生成期 Reset pass 掷出) */
  crimson = false;          // true=猩红 false=腐化
  dungeonX = 0;            // 地牢位置
  /** 地牢入口地表 Y（原版 Main.dungeonY：CheckToSpawnDungeonEnemies 要求玩家在其 +40 格以下才刷地牢怪）。
   *  缺省 0=未知，使用处以 groundLevel 回退 */
  dungeonY = 0;
  jungleX = 0;             // 丛林位置
  // ---- 南瓜月/霜月事件（原版 Main.pumpkinMoon/snowMoon + NPC.waveNumber 三字段）----
  // 运行时状态，**不进存档**：原版这些字段均不写 WorldFile（主菜单即重置 Main.cs:48332），
  // serialize/fromPacket 不碰本字段；读档后 kind=0 即无事件（对齐原版）
  moonEvent = newMoonEventState();
  // ---- 旧日军团（原版 DD2Event 全静态位；召唤入口 = 永恒水晶座 466 右键）----
  // 运行时状态不存档（对齐原版：仅 DownedInvasionT1-3 随 WorldFile 存 → flags）。
  // 纯逻辑在 world/OldOnesArmy.ts（DD2Event.cs 1:1）；Game 接线 + AI 依赖注入
  // DD2_EVENT_HOOKS（bossAI_dd2.ts 占位）
  oldOnesArmy = newOldOnesArmyState();
  // ---- 星璇塔 / 天界入侵（原版 NPC.LunarApocalypseIsUp + TowerActive/Shield 六字段）----
  // 运行时状态：downedTower*/towerActive*/lunarApocalypseUp 三类 bool 走 flags 进存档
  // （WorldFile.cs:1352-1360）；盾值与月总倒计时**不存档**（读档 TowerActive=true 重置满盾，
  // WorldFile.cs:2240-2255），读档回填见 LunarEvent.applyLunarSave
  lunarEvent = newLunarEventState();
  // ---- 入侵系统持久化状态（原版 WorldFile.cs:1306-1339 存档五元组）----
  /** 当前入侵类型（InvasionID：0=无 1=哥布林 2=雪人军团 3=海盗；4=火星后续） */
  invasionType = 0;
  /** 剩余入侵点数（击杀扣减，≤0 即胜利） */
  invasionSize = 0;
  /** 入侵开始总点数（进度条分母） */
  invasionSizeStart = 0;
  /** 入侵前线图块 X（向 spawnX 推进；启动时 = 世界左右边缘） */
  invasionX = 0;
  /** 入侵冷却天数（黎明 -1；1.4.5.6 事实闲置，仅存档位） */
  invasionDelay = 0;
  /** TreeTops 13 区域变体（v≥211 wld 权威；索引 0-3 森林/5 丛林/6 雪/7 神圣） */
  treeTops: number[] = [];

  exploredVersion = 0;
  /** 最近一次 markExplored 新点亮格的包围盒（tile 坐标；null = 无新探索）。
   *  渲染端雾画布按此做脏矩形增量更新——旧版无条件 bump 版本导致每 15 tick
   *  整幅重建 4200×1200 雾画布（20MB 分配 + 500 万格循环 ≈ 672ms 长任务），
   *  首次导入大世界开地图时主线程持续阻塞 → 白屏闪烁 + 标签页 OOM 崩溃 */
  exploredDirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  markExplored(cx: number, cy: number, radius: number) {
    const st = this.store;
    const x0 = Math.max(0, cx - radius), x1 = Math.min(st.w - 1, cx + radius);
    const y0 = Math.max(0, cy - radius), y1 = Math.min(st.h - 1, cy + radius);
    let changed = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * st.w + x;
        if (!this.explored[i] && (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
          this.explored[i] = 1;
          changed = true;
          // 脏包围盒与新点亮格取并（渲染帧间多次 mark 不丢更新）
          const d = this.exploredDirty;
          if (d) { if (x < d.x0) d.x0 = x; if (x > d.x1) d.x1 = x; if (y < d.y0) d.y0 = y; if (y > d.y1) d.y1 = y; }
          else this.exploredDirty = { x0: x, y0: y, x1: x, y1: y };
        }
      }
    }
    if (changed) this.exploredVersion++;
  }

  /** SW-BJ15 2026-09-07：全图迷雾消除（Shift+F4）的恢复快照。null=当前处于正常探索态。
   *  深拷贝 explored 位图（小世界 ~5MB / 大世界 ~20MB，仅在"全开"态驻留，
   *  恢复即释放）；会话态，不入存档/联机包（读档后为 null=无快照可恢复）。
   *  语义注：全开期间 markExplored 被全 1 短路（changed 恒 false），玩家此刻
   *  走过的区域不进快照——恢复后回到雾中，仅玩家当前邻域随后续移动重新点亮。 */
  exploredRevealSnapshot: Uint8Array | null = null;

  /** 全图迷雾消除/恢复（切换式，Shift+F4 再按恢复）：消除→快照+全图置 1；
   *  恢复→写回快照+释放。@returns true=本次执行了消除（新建快照），false=执行了恢复 */
  toggleFullReveal(): boolean {
    if (!this.explored) return false;
    if (!this.exploredRevealSnapshot) {
      this.exploredRevealSnapshot = this.explored.slice();
      this.explored.fill(1);
    } else {
      this.explored.set(this.exploredRevealSnapshot);
      this.exploredRevealSnapshot = null;
    }
    // 消除/恢复都是全图变化，无局部脏盒可言 → 置空让渲染端整幅重建
    // （ensureFogData：dirty=null + 版本跳跃 → 分带整幅重扫，与旧 F4 消除路径同款）
    this.exploredDirty = null;
    this.exploredVersion++;
    return this.exploredRevealSnapshot !== null;
  }

  constructor(w: number, h: number, seed: number, name = '新世界', skipStore = false) {
    // skipStore(读档 fromPacket 专用):调用方立即以转移 buffer 版 TileStore+explored
    // 注入——跳过默认分配免 15B/tile 丢弃式浪费(75-173MB);其余字段照常初始化
    if (!skipStore) {
      this.store = new TileStore(w, h);
      this.explored = new Uint8Array(w * h);
    }
    this.seed = seed;
    this.name = name;
    this.size = worldSizeFor(w);
    // 1 游戏日 = 30 现实分钟（24→40 后折中）
    this.clock = new Clock(24 * 60 * 1000); // 1:1 全周期 24min（昼 15/夜 9）
  }

  /** 从 worker 数据包重建（buffer 已 transfer 移交，零拷贝包装）。
   *  explored 未包含在包内（旧包）时按全零分配；读档路径包内即存档的 explored */
  static fromPacket(p: import('../workers/protocol').WorldPacket): World {
    // ★免丢弃分配(2026-08-13 读档优化):构造器先建完整默认 TileStore(15B/tile,
    // 75-173MB)随即被转移 buffer 版替换丢弃。skipStore 跳过默认分配,其余字段照常初始化
    const w = new World(p.w, p.h, p.seed, p.name, true);
    w.store = new TileStore(p.w, p.h, p.buf);
    w.explored = p.buf.explored ? new Uint8Array(p.buf.explored) : new Uint8Array(p.w * p.h);
    w.spawnX = p.spawnX; w.spawnY = p.spawnY;
    w.spawnX0 = (p as { spawnX0?: number }).spawnX0 ?? w.spawnX;
    w.spawnY0 = (p as { spawnY0?: number }).spawnY0 ?? w.spawnY;
    w.groundLevel = p.groundLevel; w.rockLevel = p.rockLevel; w.lavaLine = p.lavaLine;
    w.crimson = p.crimson; w.dungeonX = p.dungeonX; w.dungeonY = p.dungeonY; w.jungleX = p.jungleX;
    w.exploredVersion = p.exploredVersion;
    if (p.difficulty !== undefined) w.difficulty = p.difficulty;   // Main.GameMode（旧包缺省 0）
    // 历史索引帧修复完成标志（worker 读档/生成路径置位；旧包缺省=未修，主线程原地跑）
    w.indexFramesRepaired = !!p.repairedIndexFrames;
    w.clock.timeOfDay = p.clock.timeOfDay;
    w.clock.dayCount = p.clock.dayCount;
    if (p.clock.bloodMoon !== undefined) w.clock.bloodMoon = p.clock.bloodMoon;
    if (p.clock.eclipse !== undefined) w.clock.eclipse = p.clock.eclipse;
    if (p.clock.moonPhase !== undefined) w.clock.moonPhase = p.clock.moonPhase;
    if (p.seedFlags) w.seedFlags = { ...p.seedFlags };
    // ★IIIII20b 换人一次性迁移标随包回填（★BJ90 2026-09-15,BJ71 登记①——缺省=不置,
    //  与 loadSaveData SaveFile.ts:358「只落真值」同口径;旧包零迁移）
    if (p.starterSwapMigrated) w.starterSwapMigrated = true;
    if (p.saveMods) w.saveMods = p.saveMods;   // ★P4 红蓝修正 C1:mod 清单随包还原
    if (p.moonType !== undefined) w.moonType = p.moonType;
    if (p.invasion) { w.invasionType = p.invasion.type; w.invasionSize = p.invasion.size;
      w.invasionSizeStart = p.invasion.sizeStart; w.invasionX = p.invasion.x; w.invasionDelay = p.invasion.delay; }
    if (p.altarCount !== undefined) w.altarCount = p.altarCount;
    // 渔夫任务链（WF:2147-2161；旧包缺省=索引 0/空名单）
    if (p.angler) {
      w.anglerQuest = p.angler.quest ?? 0;
      w.anglerWhoFinishedToday = [...(p.angler.whoFinishedToday ?? [])];
    }
    // 困难矿锁定选种（WorldGen.SavedOreTiers；旧档缺省 -1/-1/-1 = 未砸过，首砸重 roll）
    if (p.savedOreTiers !== undefined) w.savedOreTiers = { ...p.savedOreTiers };
    // 肉前矿档四件（WF:11294-11320）+ 流星雨剩余计数（WF:1069/:177）——★BJ71:包缝曾缺
    if (p.oreTiersPH !== undefined) w.oreTiersPH = { ...p.oreTiersPH };
    if (p.meteorShowerCount !== undefined) w.meteorShowerCount = p.meteorShowerCount;
    if (p.shadowOrbCount !== undefined) w.shadowOrbCount = p.shadowOrbCount;
    // 日晷/月晷四件套（WorldFile.cs:1311/1342/1416-1417；旧包缺省=无快进无冷却）
    if (p.sundial !== undefined) {
      w.sundialCooldown = p.sundial;
      w.moondialCooldown = p.moondial ?? 0;
      w.fastForwardTimeToDawn = p.fastForwardTimeToDawn ?? false;
      w.fastForwardTimeToDusk = p.fastForwardTimeToDusk ?? false;
    }
    // 夜间小动物概率五件套（setFireFlyChance；旧包缺省=代表值，当晚 StartNight 重掷）
    if (p.critterChances !== undefined) {
      w.fireFlyChance = p.critterChances.fireFly;
      w.fireFlyFriendly = p.critterChances.fireFlyFriendly;
      w.fireFlyMultiple = p.critterChances.fireFlyMultiple;
      w.butterflyChance = p.critterChances.butterfly;
      w.stinkBugChance = p.critterChances.stinkBug;
    }
    // CultistRitual.delay（WF:114/163；旧包缺省 0 = 首次直接可掷 TrySpawning）
    if (p.cultistDelay !== undefined) w.cultistDelay = p.cultistDelay;
    if (p.weather) w.applyWeather(p.weather);
    if (p.bestiary) w.applyBestiary(p.bestiary);
    // ★BJ71（2026-09-14）：旗击杀计数随包回填（BannerSystem.killCount,WF:1347/:2210;
    //  旧包缺省=保持空表,与 loadSaveData 缺段守卫同口径）
    if (p.bannerKills) w.bannerKills = p.bannerKills;
    w.pendingTownNpcs = p.pendingTownNpcs;
    // ★SW-FX11（2026-09-10）：四塔位/压力板位随包（联机 worker→主线程同缝）
    w.pendingPillarNpcs = p.pendingPillarNpcs;
    w.pendingPlatePokes = p.pendingPlatePokes;
    w.starterTownNpcs = p.starterTownNpcs;
    w.chests = p.chests;
    w.signs = p.signs;
    w.furnitureItems = p.furnitureItems ?? [];
    w.trees = p.trees;
    w.flags = p.flags;
    w.treeX = p.treeX; w.treeStyle = p.treeStyle; w.treeTops = p.treeTops;
    // ★SW-FX43：caveBackX/worldId + wld 快照三通道随包回填（旧包缺省=undefined→
    //  导出侧台账缺省映射回退;bgStyles 同缝）
    if (p.caveBackX?.length === 3) w.caveBackX = [...p.caveBackX];
    if (p.worldId !== undefined) w.worldId = p.worldId;
    w.wldSnap = p.wldSnap; w.teSnap = p.teSnap; w.townRooms = p.townRooms;
    if (p.bgStyles) w.bgStyles = { ...p.bgStyles, cave: [...p.bgStyles.cave] };
    w.shimmerX = p.shimmerX ?? 0; w.shimmerY = p.shimmerY ?? 0;
    return w;
  }

  get w() { return this.store.w; }
  get h() { return this.store.h; }
  get tiles() { return this.store; }

  /** 破坏一个 tile（含 framed 物体的锚点处理由调用方负责），返回掉落 item key */
  breakTileAt(x: number, y: number): string | null {
    const t = this.store.get(x, y);
    if (t === 0) return null;
    const d = TILE_DEFS[t];
    this.store.setTile(x, y, 0);
    // v_ 图块无显式 drop → 回退同名放置物品(阶段5 自动注册)。
    // drop:null = 显式无掉落(原版装饰类)——?? 会把 null 也走兜底,必须显式判 undefined。
    // 数字 drop = 原版 item id(本地物品退役后统一),经 VI() 落到 vi_ 键
    if (typeof d.drop === 'number') return VI(d.drop);
    return d.drop === undefined ? (d.key.startsWith('v_') ? 'place_' + d.key : null) : d.drop;
  }

  isSolidPx(px: number, py: number): boolean {
    return this.store.isSolid(Math.floor(px / 16), Math.floor(py / 16));
  }

  /** 液体量（0-255）按像素坐标 */
  liquidAt(px: number, py: number): number {
    return this.store.liquid[this.store.idx(Math.floor(px / 16), Math.floor(py / 16))];
  }

  registerTree(x: number, y: number, h: number) {
    this.trees.push({ x, y, h });
  }
}

export { T };
