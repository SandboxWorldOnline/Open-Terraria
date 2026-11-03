// 灯笼夜系统 1:1（LanternNight.cs 全文；1.4.5.6 反编译 = Terarria1456）。
// 机制：入侵/事件首胜（OnGameEventClearedForTheFirstTime，NPC.cs:79569-79601）→
//   NextNightIsLanternNight = true → 次夜入夜 NaturalAttempt 兑现 GenuineLanterns；
//   另有月总已杀后的自然 roll（LanternNightsOnCooldown==0 且 1/14）。
// 当夜状态 LanternsUp = GenuineLanterns || ManualLanterns（Manual 仅服务端指令/联机，
//   本仓无该入口，字段位保留）。
// 消费点索引（全部已接，见 Game.ts / SkyRenderer.ts / Weather.ts）：
//   - 1457 Main.cs:66205 入夜 CheckNight（NaturalAttempt；1456 :64709）
//   - 1457 Main.cs:66354 黎明 CheckMorning（双旗清零；1456 :64854）
//   - 1457 Main.cs:65940 每帧 UpdateTime（Genuine 不满足 LanternsCanPersist 即提前收场；1456 :64429）
//   - Main.cs:64717 入夜 LanternsUp → stopEvents（压掉血月等夜事件 roll）
//   - Main.cs:64684 ShouldNormalEventsBeAbleToStart（无月灾/398/倒计时 → LanternsUp）
//   - Main.cs:64288 云层：cloudBGActive=0、numClouds 钳 30
//   - Main.cs:64331 下雨中 → StopRain；:64353 无雨时不新 roll（LanternsUp 或 NextNight）
//   - Main.cs:58249 LanternsUp 时风场步进直接 return（灯笼夜无风）
//   - Player.cs:28680 RecalculateLuck：luck += 0.3（已接——Game 每 tick 写
//     player.luckState.lanternsUp，src/stats/Luck.ts 聚合）
//   - Chest.cs:2282 派对女孩商店：LanternsUp 时上架 4702 放飞灯笼
//   - NPC.cs:95480 向导对话：Lantern1(!downedMoonlord)/Lantern2(downedMoonlord)
//   - SkyManager "Lantern" → LanternSky（夜空灯笼，Extra_134 三变体，SkyRenderer 落位）
// 状态为运行时态不进存档（原版 WorldClear 于读图 Main.cs:51656/WorldGen.cs:6957）。
export interface LanternCtx {
  /** Main.dayTime（白天 LanternsCanPersist 恒 false → Genuine 提前收场，:52） */
  dayTime: boolean;
  bloodMoon: boolean;
  pumpkinMoon: boolean;
  snowMoon: boolean;
  invasionType: number;
  /** NPC.MoonLordCountdown（0 = 无月总倒计时） */
  moonLordCountdown: number;
  /** WorldGen.spawnMeteor（Game.lanternCtx 传 meteorPending；陨石落地链已 1:1：
   *  Game.HandleMeteorFall dropMeteor + EoW/BoC 击杀置位双路） */
  spawnMeteor: boolean;
  downedMoonlord: boolean;
  /** 场上是否存在 Boss（LanternNight.BossIsActive：boss 或 13-15 充能球） */
  bossActive: () => boolean;
}

class LanternNightState {
  /** 手动灯笼（服务端 ToggleManualLanterns；本仓无入口，位保留） */
  manualLanterns = false;
  /** 自然/胜利兑现的真灯笼夜 */
  genuineLanterns = false;
  /** 次夜灯笼夜预约（OnGameEventCleared 翻转） */
  nextNightIsLanternNight = false;
  /** 冷却夜数（兑现后掷 5-10；>0 时自然 roll 不参与，每夜 -1） */
  lanternNightsOnCooldown = 0;
  private wasLanternNight = false;

  /** LanternsUp（LanternNight.cs:18-28）：真灯笼或手动灯笼任一 */
  get lanternsUp(): boolean {
    return this.genuineLanterns || this.manualLanterns;
  }
  /** 上帧态（UpdateTime 的 _wasLanternNight；供渲染/调试读边沿） */
  get changedThisTick(): boolean { return this.wasLanternNight !== this.lanternsUp; }

  /** CheckMorning（:30-43）：黎明双旗清零 */
  checkMorning(): void {
    this.genuineLanterns = false;
    this.manualLanterns = false;
  }

  /** CheckNight（:45-48）→ NaturalAttempt（:81-105） */
  checkNight(ctx: LanternCtx): void {
    if (!this.lanternsCanStart(ctx)) return;
    let flag = false;
    if (this.lanternNightsOnCooldown > 0) this.lanternNightsOnCooldown--;
    // 自然 roll：冷却尽 + 月总已杀 + 1/14（Main.rand.Next(14)==0）
    if (this.lanternNightsOnCooldown === 0 && ctx.downedMoonlord && Math.random() < 1 / 14) {
      flag = true;
    }
    // 胜利预约兑现（NextNightIsLanternNight 消费后清零）
    if (!flag && this.nextNightIsLanternNight) {
      this.nextNightIsLanternNight = false;
      flag = true;
    }
    if (flag) {
      this.genuineLanterns = true;
      this.lanternNightsOnCooldown = 5 + Math.floor(Math.random() * 6); // Next(5,11)
    }
  }

  /** LanternsCanPersist（:50-57）：!dayTime && LanternsCanStart()——白天恒 false
   *  （真灯笼天亮即散，等价 CheckMorning 的清零路径；bloodMoon 已在 CanStart 内） */
  lanternsCanPersist(ctx: LanternCtx): boolean {
    return !ctx.dayTime && this.lanternsCanStart(ctx);
  }
  /** LanternsCanStart（:59-66）：无陨石/血月/南瓜月/霜月/入侵/月总倒计时，且场上无 Boss */
  lanternsCanStart(ctx: LanternCtx): boolean {
    return !ctx.spawnMeteor && !ctx.bloodMoon && !ctx.pumpkinMoon && !ctx.snowMoon
      && ctx.invasionType === 0 && ctx.moonLordCountdown === 0 && !ctx.bossActive();
  }

  /** UpdateTime（:128-153，每 tick）：真灯笼不再可续即提前收场；
   *  天空激活/关闭由渲染层按 LanternsUp 派生（LanternSky._opacity ±0.01/帧），
   *  原 _wasLanternNight 边沿只服务 SkyManager 调度，此处仅保留态位 */
  updateTime(ctx: LanternCtx): void {
    if (this.genuineLanterns && !this.lanternsCanPersist(ctx)) {
      this.genuineLanterns = false;
    }
    this.wasLanternNight = this.lanternsUp;
  }

  /** WorldClear（:120-126）：读图重置（运行时态不进存档）。★不清
   *  NextNightIsLanternNight——原版 WorldClear 只清 Manual/Genuine/Cooldown/
   *  _wasLanternNight 四项，首胜预约跨读图保留（旧实现误清，读图后预约丢失） */
  worldClear(): void {
    this.manualLanterns = false;
    this.genuineLanterns = false;
    this.lanternNightsOnCooldown = 0;
    this.wasLanternNight = false;
  }

  /** OnGameEventClearedForTheFirstTime（NPC.cs:79569-79601 switch 1:1）：
   *  default / 10（月总）/ 16-17-18（三王）→ 预约次夜灯笼夜；
   *  4（哀木）/ 21（圣诞树）/ 22（圣诞坦克）→ 不预约。
   *  id 10 的 CreditsRoll 与 16-18 的砸祭坛后世花球茎重生成
   *  （WorldGen.GeneratePlanteraBulbOnAllMechsDefeated）为各自子系统，未随本表触发。 */
  onGameEventCleared(gameEventId: number): void {
    switch (gameEventId) {
      case 4:
      case 21:
      case 22:
        return;
      default:
        this.nextNightIsLanternNight = true;
        break;
    }
  }
}

/** 单例（对应原版静态类） */
export const LanternNight = new LanternNightState();

/** 首胜事件 id 表（NPC.cs:80014-80291 / Main.cs:63785-63800 SetEventFlagCleared 实参）：
 *  入侵族 goblin=0 / frost=1 / pirates=2 / martians=3；Boss 族按 NPCLoot 分支；
 *  13=EoC 14=世吞|克脑 15=骷髅王 19=肉山(进困难) 5=哀木王 20=冰女王。
 *  仅用于 onGameEventCleared 的排除集核对——除 4/21/22 外全部预约灯笼夜 */
export const GAME_EVENT_EXCLUDES = new Set([4, 21, 22]);
