// 运行时世界事件三件套 1:1（Terarria1456 反编译源为唯一标杆）——运行时审计台账
// 六缺口的三个系统落点（调用方 = core/Game.ts）：
//   ① setFireFlyChance（NPC.cs:94557-94610）：每夜 StartNight 重掷萤火虫/蝴蝶/椿象
//      生成概率（Main.cs:64706 调用）。原版写 NPC 静态位；本仓落 World 字段
//      （fireFlyChance/fireFlyFriendly/fireFlyMultiple/butterflyChance/stinkBugChance）
//      并按台账要求随存档。
//      ★任务台账曾写 jewelBeetleChance——1.4.5.6 原文无该字段（1405 亦无），实际
//      五件套为 fireFly×3 + butterfly + stinkBug，以原文为准。
//   ② CultistRitual（CultistRitual.cs 全文）：地牢拜月教石碑 437 自然重生计时。
//      Main.cs:64427 每帧 UpdateTime；delay 随存档（WorldFile.cs:1340 写 / :2192 读，
//      缺省 86400 = delayStart——新世界 ResetTempsToDayTime WF:1018 / v108 前旧档
//      WF:2188 同值），recheck 为运行时静态位不落盘。
//   ③ MysticLogFairiesEvent（MysticLogFairiesEvent.cs 全文）：倒木（tile 488）桩
//      附近夜放仙女。Main.cs:64710 StartNight / :64433 每帧 UpdateTime /
//      WorldGen.cs:3303 OnWorldLoad StartWorld / :49866 KillTile FallenLogDestroyed。
// 近似项（原版依赖系统缺失，逐一注明）：
//   - PlayerLOS（CultistRitual.TrySpawning / MysticLogFairies 的落点隐藏性）→
//     玩家 50 格内视为可见（WorldEvolution.playerLOS 同款近似；原版 WorldGen.cs:
//     69500-69515 实为"点矩形 ∩ 屏幕×1.2 矩形"，非视线判定）
//   - RNG 流勘误（2026-08-13 复核）：1.4.5.6 里 WorldGen.genRand 与 Main.rand
//     是**同一条流**（WorldGen.cs:4391 赋值一次），并非两条流——本文件单
//     Math.random 流按原版掷序消费统计等价，仅损失种子可复现性
//   - remixWorld（地牢 Y 基准翻转 / 仙女时间窗豁免 / 倒木扫描带翻转）本仓无该
//     种子体系 → 恒 false
import type { World } from '../World';
import type { TileStore } from '../TileStore';
import { TILE_BY_KEY } from '../../data/tiles';

/** 倒木 tile（TileID 488 FallenLog；SurfaceDecorPasses place3x2 同一来源） */
const FALLEN_LOG = TILE_BY_KEY['v_488_fallen_log'] ?? 0;

// ============================================================
// ① setFireFlyChance（NPC.cs:94557-94610）
// ============================================================
/** C# UnifiedRandom.Next(n)（0..n-1） */
const next = (n: number): number => Math.floor(Math.random() * n);
/** C# UnifiedRandom.Next(lo, hi)（lo..hi-1，上界开区间） */
const nextRange = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo));

/**
 * NPC.setFireFlyChance（NPC.cs:94557-94610 1:1）。每夜 StartNight 调用（Main.cs:64706）。
 * 三档分布：
 *   1/9 的夜（genRand）：fireFlyChance=5..9（萤火虫高发夜）；
 *   否则 1/3（genRand）：三值全 999999（当夜萤火虫绝迹）；
 *   其余：fireFlyChance=10..59。
 * fireFlyFriendly（友好轮夜萤火虫门 :2321）= 高发夜 1..3 / 绝迹夜 999999 / 其余 2..14；
 * fireFlyMultiple（附加只概率门 :2329+）同三档。
 * 蝴蝶/椿象互斥掷（:94594-94606）：1/3 的夜蝴蝶绝迹 + 椿象 1..13（其中 1/5 椿象也
 * 绝迹）；否则椿象绝迹 + 蝴蝶 1..20（其中 1/5 蝴蝶绝迹）。
 * 十周年种子两概率减半（下限 1，:94607-94610）。
 */
export function setFireFlyChance(world: World): void {
  // :94566-94585 三档（genRand 两次掷，顺序保持）
  if (next(9) === 0) {
    world.fireFlyChance = nextRange(5, 10);
    world.fireFlyFriendly = nextRange(1, 4);
    world.fireFlyMultiple = nextRange(3, 8);
  } else if (next(3) === 0) {
    world.fireFlyChance = 999999;
    world.fireFlyFriendly = 999999;
    world.fireFlyMultiple = 999999;
  } else {
    world.fireFlyChance = nextRange(10, 60);
    world.fireFlyFriendly = nextRange(2, 15);
    world.fireFlyMultiple = nextRange(6, 30);
  }
  // :94586-94606 蝴蝶/椿象互斥
  if (next(3) === 0) {
    world.butterflyChance = 999999;
    world.stinkBugChance = nextRange(1, 14);
    if (next(5) === 0) world.stinkBugChance = 999999;
  } else {
    world.stinkBugChance = 999999;
    world.butterflyChance = nextRange(1, 21);
    if (next(5) === 0) world.butterflyChance = 999999;
  }
  // :94607-94610 十周年减半
  if (world.seedFlags?.tenthAnniversary) {
    world.fireFlyChance = Math.max(1, Math.floor(world.fireFlyChance * 0.5));
    world.butterflyChance = Math.max(1, Math.floor(world.butterflyChance * 0.5));
  }
}

// ============================================================
// ② CultistRitual（CultistRitual.cs 全文）
// ============================================================
/** CultistRitual.delayStart / respawnDelay / timePerCultist / recheckStart（:7-17） */
export const CULTIST_DELAY_START = 86400;
export const CULTIST_RESPAWN_DELAY = 43200;
export const CULTIST_TIME_PER_CULTIST = 3600;
const CULTIST_RECHECK_START = 600;

/** CultistRitual 依赖的宿主上下文（Game 侧每帧组装） */
export interface CultistHost {
  world: World;
  /** Main.dungeonX / Main.dungeonY（TrySpawning 锚点） */
  dungeonX: number;
  dungeonY: number;
  /** Main.hardMode */
  hardMode: boolean;
  /** NPC.downedGolemBoss（石巨人 245） */
  downedGolem: boolean;
  /** NPC.downedBoss3（骷髅王） */
  downedBoss3: boolean;
  /** NPC.AnyNPCs(437)：场上已有石碑则不再生成 */
  anyTablet: () => boolean;
  /** NPC.AnyDanger()（NPC.cs:81040+：月总倒计时/入侵/月事件/旧军/活跃 Boss） */
  anyDanger: () => boolean;
  /** WorldGen.PlayerLOS 近似（50 格内有玩家视为可见） */
  playerLOS: (x: number, y: number) => boolean;
  /** 命中落点时的出生回调（NPC.NewNPC(new EntitySource_WorldEvent(), …, 437)）。
   *  返回 false = 出生失败（AnyNPCs(437) 竞态等），原版无返回值，本仓用于日志 */
  spawnTablet: (x: number, y: number) => boolean;
}

/** 运行时静态位（CultistRitual.recheck，:33——不落盘，读档重置 0） */
const cultistRecheck = { v: 0 };

/** CultistRitual.CultistSlain（:49-53）：delay -= 3600。1.4.5.6 全库无调用点（死码），
 *  保留 1:1 语义供台账核对 */
export function cultistSlain(world: World): void {
  world.cultistDelay -= CULTIST_TIME_PER_CULTIST;
}

/** CultistRitual.TabletDestroyed（:55-58）：石碑召出 439 的同一帧调用
 *  （NPC.cs:38881）→ delay = 43200。不设此账则石碑被消耗后 recheck 周期一到
 *  立刻重生（600t ≈ 10s），行为严重偏离原版 */
export function cultistTabletDestroyed(world: World): void {
  world.cultistDelay = CULTIST_RESPAWN_DELAY;
}

/** 读图/切世界复位运行时 recheck（原版 recheck 为静态位无显式重置；此处随
 *  MysticLogFairiesEvent.WorldClear 同位调用，保持事件态与世界生命周期一致） */
export function cultistWorldClear(): void {
  cultistRecheck.v = 0;
}

/** CultistRitual.UpdateTime（:20-47 1:1，Main.cs:64427 每帧）。
 *  delay/recheck 均按 dayRate 递减（钳 0）；双零时 recheck=600（AnyDanger 则 ×6）
 *  并掷 TrySpawning(dungeonX, dungeonY)。 */
export function cultistRitualUpdateTime(world: World, dayRate: number, host: CultistHost): boolean {
  world.cultistDelay = Math.max(0, world.cultistDelay - dayRate);
  cultistRecheck.v = Math.max(0, cultistRecheck.v - dayRate);
  if (world.cultistDelay === 0 && cultistRecheck.v === 0) {
    cultistRecheck.v = CULTIST_RECHECK_START;
    if (host.anyDanger()) cultistRecheck.v *= 6;
    else return cultistTrySpawning(world, host.dungeonX, host.dungeonY, host, false);
  }
  return false;
}

/** CultistRitual.TrySpawning（:60-77 1:1）。返回 true = 已出生 437 */
export function cultistTrySpawning(world: World, x: number, y: number, host: CultistHost, force: boolean): boolean {
  const st = world.store;
  if (x < 0 || y < 0 || x >= st.w || y >= st.h) return false;
  // !force && 玩家看得见锚点两侧 → 拒（WorldGen.PlayerLOS 近似）
  if (!force && (host.playerLOS(x - 6, y) || host.playerLOS(x + 6, y))) return false;
  if (!cultistCheckRitual(world, st, x, y, host, force)) return false;
  // NPC.NewNPC(..., x*16+8, (y-4)*16-8, 437)
  return host.spawnTablet(x * 16 + 8, (y - 4) * 16 - 8);
}

/** CultistRitual.CheckRitual（:79-104 1:1） */
function cultistCheckRitual(world: World, st: TileStore, x: number, y: number,
  host: CultistHost, force: boolean): boolean {
  if (!force && (world.cultistDelay !== 0 || !host.hardMode || !host.downedGolem || !host.downedBoss3)) {
    return false;
  }
  // 锚点上方 7 格须在界内且非实心（石碑悬浮于地牢入口上空）——WorldGen.SolidTile
  // (Tile) :70487-70502 全谓词（排除半砖/坡/致动/非活跃）★BJ715-A-③:旧 isSolid 宽
  //  谓词把半砖/坡面格当实心 → 上方 7 格恰为半砖时误拒仪式
  if (y < 7 || st.isSolidStrict(x, y - 7)) return false;
  if (!force && host.anyTablet()) return false;   // NPC.AnyNPCs(437)
  // CheckFloor：锚点中心向下扫四根柱，须凑齐 4 个"实心/平台且上方净空"落点
  const cx = x * 16 + 8;
  const cy = y * 16 - 64 - 8 - 27;
  return cultistCheckFloorPts(st, cx, cy) !== null;
}

/** CultistRitual.CheckFloor（:102-131 1:1,★BJ715-A-③ 单源收编）:i 步进 2 取
 *  {-5,-3,3,5}（跳过 ±1,★BJ711-A 勘误:旧注「{-5,-3,1,3,5}」把跳过值 1 写进了
 *  取值集——代码自始正确,四点=四教徒槽位的唯一权威面,由 tests/bj711a-cultist-
 *  spawn-trigger 判别锁守卫）→ 柱 x = tileX+i*2，y 自 tileY-5 向下扫至 +11,首个
 *  「实心/平台 且 (上方 3 行三列净空 或 本柱净空+两邻柱上 2 行净空)」的点计入;
 *  凑不齐 4 点 → null。
 *  ★BJ715-A-③（2026-10-25,R18 P2 定谳）谓词域勘正——同文件两副本同病（本函数
 *  与 bossAI_lunar_misc.ritualCheckFloor 复制面,后者改为委托本单源）:
 *  · 柱第一臂 WorldGen.SolidTile(int,int)（:70642-70664:active∧tileSolid∧
 *    !tileSolidTop∧!halfBrick∧slope==0∧!inActive）= isSolidStrict——旧 isSolid 宽
 *    谓词把半砖/坡面格当地板（R18:家具顶/半砖柱可翻转 spawn 门）;
 *  · 柱第二臂 TileID.Sets.Platforms[type]（:117 纯 type 谓词,不看 active/致动/
 *    frameY——GetTileSafely 只读 tile.type）= isPlatformsType——旧 isPlatform 可站顶
 *    宽谓词漏致动平台+多算家具 frameY==0 顶;
 *  · 净空臂 Collision.SolidTiles（:3468-3499 active∧!inActive∧tileSolid∧
 *    !tileSolidTop,无半砖/坡排除）= solidRect/isSolid 原式不动。 */
export function cultistCheckFloorPts(st: TileStore, centerX: number, centerY: number):
  Array<{ x: number; y: number }> | null {
  const tx = Math.floor(centerX / 16);
  const ty = Math.floor(centerY / 16);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = -5; i <= 5; i += 2) {
    if (i === -1 || i === 1) continue;
    for (let j = -5; j < 12; j++) {
      const x = tx + i * 2;
      const y = ty + j;
      if ((st.isSolidStrict(x, y) || st.isPlatformsType(x, y))
        && (!solidRect(st, x - 1, x + 1, y - 3, y - 1)
          || (!solidRect(st, x, x, y - 3, y - 1)
            && !solidRect(st, x + 1, x + 1, y - 3, y - 2)
            && !solidRect(st, x - 1, x - 1, y - 3, y - 2)))) {
        pts.push({ x, y });
        break;
      }
    }
  }
  return pts.length === 4 ? pts : null;
}

// ============================================================
// ③ MysticLogFairiesEvent（MysticLogFairiesEvent.cs 全文）
// ============================================================
/** 仙女事件宿主上下文（Game 侧组装） */
export interface FairyHost {
  world: World;
  /** Main.maxRaining（>0 = 雨天，压制仙女） */
  maxRaining: number;
  /** Main.bloodMoon */
  bloodMoon: boolean;
  /** NPC.MoonLordCountdown（>0 压制） */
  moonLordCountdown: number;
  /** Main.snowMoon / Main.pumpkinMoon */
  snowMoon: boolean;
  pumpkinMoon: boolean;
  /** Main.invasionType（>0 压制） */
  invasionType: number;
  /** WorldGen.PlayerLOS 近似 */
  playerLOS: (x: number, y: number) => boolean;
  /** NPC.NewNPC(new EntitySource_WorldEvent(), …, id)——出生回调 */
  spawnFairy: (id: number, x: number, y: number) => void;
}

/** 倒木桩锚点（tile 坐标，已折算 frameX/frameY 到整件左上角） */
interface StumpCoord { x: number; y: number; }

/** DELAY_BETWEEN_ATTEMPTS（:22） */
const FAIRY_DELAY_BETWEEN_ATTEMPTS = 60;

/** MysticLogFairiesEvent 事件态（原版为 WorldGen.mysticLogsEvent 实例） */
export interface MysticLogState {
  _canSpawnFairies: boolean;
  _delayUntilNextAttempt: number;
  _stumpCoords: StumpCoord[];
  /** WorldClear（:24-32） */
  worldClear(): void;
  /** StartWorld（:34-39，WorldGen.cs:3303 OnWorldLoad）：读图/新世界扫一次倒木 */
  startWorld(host: FairyHost): void;
  /** StartNight（:41-48，Main.cs:64710）：开闸 + 重扫倒木 */
  startNight(host: FairyHost): void;
  /** FallenLogDestroyed（:152-159，WorldGen.cs:49866 KillTile type 488）：重扫 */
  fallenLogDestroyed(host: FairyHost): void;
  /** UpdateTime（:50-62，Main.cs:64433 每帧） */
  updateTime(world: World, dayRate: number, host: FairyHost): void;
  /** TrySpawningFairies（:64-119 1:1） */
  trySpawningFairies(world: World, dayRate: number, host: FairyHost): void;
  /** ScanWholeOverworldForLogs（:161-189 1:1，非 remix） */
  scanWholeOverworldForLogs(st: TileStore, worldSurface: number): void;
}

/** 单例事件态（运行时态不落盘，WorldClear 于读图重置——WorldGen.cs:6958） */
export const mysticLogs: MysticLogState = {
  _canSpawnFairies: false,
  _delayUntilNextAttempt: 0,
  _stumpCoords: [],

  worldClear(): void {
    this._canSpawnFairies = false;
    this._delayUntilNextAttempt = 0;
    this._stumpCoords.length = 0;
  },

  startWorld(host: FairyHost): void {
    this.scanWholeOverworldForLogs(host.world.store, host.world.groundLevel);
    // Spawner.fairyLog（MysticLogFairiesEvent.cs:181-183）：扫到任一倒木即置位，
    // 地下仙女链（NPC.cs:5730 CheckToSpawnUndergroundFairy）的消费门——运行时位不落盘
    host.world.fairyLog = this._stumpCoords.length > 0;
  },

  startNight(host: FairyHost): void {
    this._canSpawnFairies = true;
    this._delayUntilNextAttempt = 0;
    this.scanWholeOverworldForLogs(host.world.store, host.world.groundLevel);
    host.world.fairyLog = this._stumpCoords.length > 0;
  },

  fallenLogDestroyed(host: FairyHost): void {
    this.scanWholeOverworldForLogs(host.world.store, host.world.groundLevel);
  },

  /** 夜窗内按 dayRate 递减尝试倒计时，到 0 掷一次 TrySpawningFairies 并重置 60 */
  updateTime(world: World, dayRate: number, host: FairyHost): void {
    if (!this._canSpawnFairies || !isAGoodTime(world)) return;
    this._delayUntilNextAttempt = Math.max(0, this._delayUntilNextAttempt - dayRate);
    if (this._delayUntilNextAttempt === 0) {
      this._delayUntilNextAttempt = FAIRY_DELAY_BETWEEN_ATTEMPTS;
      this.trySpawningFairies(world, dayRate, host);
    }
  },

  trySpawningFairies(world: World, dayRate: number, host: FairyHost): void {
    // :66-69 压制门：雨/血月/月总倒计时/霜月/南瓜月/入侵/无倒木
    if (host.maxRaining > 0 || host.bloodMoon || host.moonLordCountdown > 0
      || host.snowMoon || host.pumpkinMoon || host.invasionType > 0
      || this._stumpCoords.length === 0) {
      return;
    }
    // :71-80 概率门：dayRate 次掷 1/oneOverSpawnChance（满月/新月夜 60，其余 180）
    const oneOverSpawnChance = getOneOverSpawnChance(world);
    let hit = false;
    for (let i = 0; i < dayRate; i++) {
      if (next(oneOverSpawnChance) === 0) { hit = true; break; }
    }
    if (!hit) return;
    // :82-90 随机取一桩；出生点 = 桩左上角世界坐标 (x*16+24, y*16+24) 上移 50px；
    // 玩家看得见 → 放弃
    const p = this._stumpCoords[next(this._stumpCoords.length)];
    const vx = p.x * 16 + 24;
    const vy = p.y * 16 + 24 - 50;
    if (host.playerLOS(p.x, p.y)) return;
    // :92-94 数量：1..3 只，1/7 再 +1
    let count = nextRange(1, 4);
    if (next(7) === 0) count++;
    // :96-110 每只独立掷 585/584/583（十周年 3/4 概率强制 583）
    for (let j = 0; j < count; j++) {
      let id = [585, 584, 583][next(3)];
      if (world.seedFlags?.tenthAnniversary && next(4) !== 0) id = 583;
      host.spawnFairy(id, Math.floor(vx), Math.floor(vy));
    }
    // :112 一夜只放一批
    this._canSpawnFairies = false;
  },

  /** x∈[100, maxTilesX-100) 步 3、y 自 worldSurface-10 降到 100 步 2，
   *  活跃 tile 488 且无液体 → 计入（帧偏移折算整件左上角） */
  scanWholeOverworldForLogs(st: TileStore, worldSurface: number): void {
    this._stumpCoords.length = 0;
    if (!FALLEN_LOG) return;   // tile 表缺登记（理论不可达，防御）
    const yTop = Math.floor(worldSurface) - 10;
    const yBot = 100;
    const xEnd = st.w - 100;
    for (let x = 100; x < xEnd; x += 3) {
      for (let y = yTop; y >= yBot; y -= 2) {
        if (y < 0 || y >= st.h) continue;
        const i = st.idx(x, y);
        if (!st.flags[i] || st.type[i] !== FALLEN_LOG || st.liquid[i] !== 0) continue;
        // GetStumpTopLeft（:191-199）：格坐标减 frameX/18、frameY/18 → 整件左上角
        this._stumpCoords.push({
          x: x - Math.floor(st.frameX[i] / 18),
          y: y - Math.floor(st.frameY[i] / 18),
        });
      }
    }
  },
};

/** IsAGoodTime（:121-136 1:1，非 remix）：夜间且 Main.time∈[6480, 25920]
 *  （≈9:18PM-2:42AM）。Main.time 夜段 = 夜内进度 × 32400 */
function isAGoodTime(world: World): boolean {
  if (world.clock.isDay) return false;
  const nightFrac = (((world.clock.timeOfDay - 0.8125) % 1) + 1) % 1 / 0.375;
  const time = nightFrac * 32400;
  return time >= 6480.0000965595245 && time <= 25920.000386238098;
}

/** GetOneOverSpawnChance（:201-208 1:1）：满月/新月 3600，其余 10800；/60 */
function getOneOverSpawnChance(world: World): number {
  const full = world.clock.moonPhase === 0;
  const empty = world.clock.moonPhase === 4;
  return (full || empty ? 3600 : 10800) / 60;
}

// ---- 共享 tile 判定（TileStore.isSolid 同语义：界内 + 未致动 + 实心） ----

/** 矩形内存在实心格（Collision.SolidTiles 消费面） */
function solidRect(st: TileStore, x0: number, x1: number, y0: number, y1: number): boolean {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (st.isSolid(x, y)) return true;
    }
  }
  return false;
}
