// 多人联机客户端（netMode==1，docs/multiplayer-design.md §4）。
// 握手 → 世界流式组装 → 玩家互见 + tile 操作上报/应用 + 时间对齐。
// v6 已同步：NPC(msg23 短码)/弹幕(msg27 kind0-8+hostile)/掉落(msg21)/箱子(msg31/32)。
// 客户端本地：液体模拟（原版 v1 既定边界）、傀儡插值（快照驱动）。
import {
  PROTO_MAGIC, PROTO_VER, Msg, NetModule,
  NetWriter, NetReader, FrameParser, TileOp, TileOpAction, readTileBatch, decodeStrip,
  ItemContainer, ItemSyncEntry, INV_SYNC_SIZES, writePlayerItems, readPlayerItems,
  RoomRules, DEFAULT_ROOM_RULES, rulesFromBits,
  writeDoorEvent, readDoorEvent,
  writePlayerHurt, readPlayerHurt,
  PlayerHurtFlags,
  readChestName,   // SW-FX52-R12 msg69 ChestName 镜像
  CHEST_NAME_MAX, CHEST_NAME_CLEAR,   // ★BJ69 msg33 改名尾段（NetMessage.cs:895-905 语义）
} from './protocol';
import {
  writeLeashedFullSync, writeLeashedPartialSync, writeLeashedRemove, writeLeashedPlaceRequest,
  writeLeashedRetrieveRequest,
  readLeashedMessage, type LeashedEntityLike,
} from './leashedSync';
import {
  writeJourneyWorldState, writeJourneyPersonalState, writeJourneyTimeSkip,
  writeJourneyUnlockReport, writeJourneyPermission,
  readJourneyWorldState, readJourneyPersonalState, readJourneyTimeSkip,
  readJourneyUnlockRelay, readJourneyPermission,
  type JourneyWorldState, type JourneyPersonalState,
  PowerPermissionLevel, JOURNEY_POWER_COUNT, isPowerAvailableFor,
} from './journeySync';
import {
  readLiquidModule, writeLiquidModule, LIQUID_CELLS_PER_FRAME, packLiquidCoord,
  readMapPing, writeMapPing,
  readBestiaryModule, writeBestiaryModule, type BestiaryNetEvent,
  readPylonModule, writePylonModule, type PylonNetMsg,
  readParticleModule, writeParticleModule, type ParticleSettings,
  readAmbienceModule,
  readInstancedLootModule, writeInstancedLootModule, INSTANCED_LOOT_PER_FRAME,
  type InstancedLootEntry, type LiquidCell,
  readPingProbe, writePingProbeEcho,
  AnglerQuestSub, readAnglerQuestModule, writeAnglerQuestModule,
  writeSeasonBitsModule, readTEModule, writeTEModule, writeTEModuleBatched, type TENetEntry,
} from './syncModules';
import type { LeashedNetMsg } from '../entities/LeashedCritter';
import type { World } from '../world/World';
import { World as WorldCtor } from '../world/World';
import { Lang } from '../i18n/Lang';
import { chatColorOfDifficulty } from '../chat/ChatCommands';

/** 远端玩家状态（对齐原版 msg13 同步集：控制位+位置+速度；Player 实例由 Game 持有池） */
export interface RemotePlayerState {
  slot: number;
  name: string;
  appearance: string;
  /** 权威位置（碰撞盒左上，原版 player.position 语义）与速度 */
  x: number; y: number; vx: number; vy: number;
  /** 控制位（原版 msg13 ctrlBits：Game 侧据此跑本地物理模拟） */
  up: boolean; down: boolean; left: boolean; right: boolean; jump: boolean; useItem: boolean;
  facing: number; selectedItem: number; dead: boolean;
  /** 新权威包到达标记（Game 消费注入 netOffset 后清零） */
  fresh: boolean;
  active: boolean;
  /** 最近一次 msg13 到达时刻（P1.1 AOI 配套：超时未达 → Game 冻结代理输入防幽灵行走） */
  lastFresh: number;
  /** PvP（v7）：hostile 旗 + 队伍 0-5（msg13 flagBits[7] + 尾部 u8 team） */
  hostile: boolean;
  team: number;
  /** 死亡计数（msg16 尾部 u16×2：PVE/PVP 分道——/death 命令族 AllDeath 汇总用；
   *  HP 变化包捎带,死亡→复活周期恒有 ≥1 包） */
  deathsPve: number;
  deathsPvp: number;
  /** 权威 HP（msg16 镜像——Game 接线到 proxy.hp 供头顶血条/死亡表现） */
  hp: number;
  maxHp: number;
  /** 权威 mana/luck（msg16 尾段镜像,2026-08-20 per-client 批——掉落结算的
   *  closestPlayer luck/心星条件数据源;旧端无尾段缺省 0） */
  mana: number;
  manaMax: number;
  luck: number;
  /** PvP 免疫余量镜像（tick,2026-08-30 批 msg16 再追加尾段）——被击端把
   *  player.immune 的 General 冷却余量（原版 immuneTime,PvP 受击窗 8t/常规 40t/
   *  复活 SpawnImmune 300t）随 hp 变化包上行；本端收到即置位、本地每 tick 衰减。
   *  消费 = 攻端门禁 API getProxyPvpImmuneRemaining（与原版攻击端直接读
   *  Main.player[victim].immune 同构,1457 Player.cs:44429）。旧端无尾段 → 镜像
   *  不重置,仅靠本地衰减归零（缺省 0 = 不拦,改动前行为） */
  pvpImmuneT: number;
  /** statDefense 终值镜像（msg16 尾段 u16,★F14 甲虫 MP 记账批,PROTO 注 g）——
   *  近战 PvP 甲虫蓄能入账式的唯一攻端不可知输入（vanilla :38864-38868 返回段
   *  重算 CalculateDamagePlayersTakeInPVP(Damage×(crit?2:1), statDefense)——
   *  【不是】实扣 HP!Main.cs:67136-43 = Dmg−0.5×Def,min1,无难度乘区/endurance）。
   *  null = 对端缺尾段（旧 server 剥离/旧 client 未发）→ 消费侧保守弃账。
   *  新鲜度语义=原版攻端 Main.player[远端].statDefense 本地代理同层
   *  （都滞后一个状态批次;结算强制位保证命中瞬间必有新鲜 hp 包在途）。 */
  pvpDefense: number | null;
  /** msg13 flagBits[0]（原版 bitsByte26[0]）:躺床态 */
  sleeping: boolean;
  /** ★X4 清偿刀D（2026-09-29）：msg13 flagBits[5]+尾段 f32×2（PROTO 注 k）——
   *  netCameraTarget 镜像（原版 Player.netCameraTarget,Player.cs:1607;接收位
   *  MessageBuffer.cs:1049）。null=无相机目标（原版 Vector2? 空）。远端相机目标
   *  （观战/无人机跟拍/高尔夫跟球三域,同源 GetObjectTrackingCameraPan）。
   *  接收应用面=本存储位（原版同相:客户端对远端 netCameraTarget 无本地消费,
   *  唯一读者在服务器——NPC.StreamUpdatesToNearbyPlayers 的 ReportedCameraPosition,
   *  NPC.cs:91765;本仓等价活消费=room.ts msg23/27 逐接收端 AOI 过滤中心）。
   *  旧 server 剥尾/旧 client 未发 → null（AOI 退回 avatar 位=改动前行为） */
  camTarget: { x: number; y: number } | null;
}

/** 房间策略（S→C RoomPolicy；客户端门禁依据——v3 房间制；v4 尾部 maxPlayers；
 *  v8 尾部 ruleBits——服务器房规则，客户端 UI 门禁（召唤物品灰显等），
 *  世界/NPC 模拟语义不受它影响（访客本地本就不模拟，见 Game.ts:13351 门） */
export interface RoomPolicyState {
  roomCode: string;
  roomName: string;
  isHost: boolean;
  protectTiles: boolean;
  protectItems: boolean;
  /** 单房人数上限（v4；UI 显示 online/max） */
  maxPlayers: number;
  /** PvP 房（v7）：true 才透传玩家来源弹幕 hostile 位（room.ts 剥离墙的开关） */
  pvpAllowed: boolean;
  /** v8 服务器房规则（旧 server 无此尾段 → 全 false = 中继房语义不变） */
  rules: RoomRules;
}

/** NPC 快照（msg23；房主权威） */
export interface NpcSnap {
  netId: number; key: string;
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number; animT: number;
  flags: number; // bit0=boss
  /** 刺球锚点像素坐标（NPC 70 aiStyle 20）——msg23【帧级尾段】条件携带（上行按
   *  u32 netId、下行按 u16 code 关联回填,见 sendNpcSnapshot/接收 case 注）：
   *  旧端无尾段=字段缺省 undefined,消费端按存在性门控 */
  ai1?: number; ai2?: number;
}

/** 弹幕快照（msg27；tag = projId(arrow/weapon) / dart kind / magic color） */
export interface ProjSnap {
  netId: number; kind: number; tag: string;
  dmg: number; aux: number;
  x: number; y: number; vx: number; vy: number;
}

/** 掉落物操作（msg21） */
export interface ItemOpMsg {
  /** op 3=残余上报（taker 把"还剩多少"报回拥有端；本仓 MP 扩展，非原版） */
  op: 0 | 1 | 2 | 3; netId: number;
  key: string; stack: number;
  x: number; y: number; vx: number; vy: number;
  /** 原版 msg21→145 升格段（SyncItemsWithShimmer，NetMessage.cs:88-92/:646-651）：
   *  微光态物品 spawn 附 shimmered+shimmerTime。尾读可选（旧发送端无此段） */
  shimmered?: boolean; shimmerTime?: number;
  /** ★BJ390（2026-09-28）词缀尾段（u8,仅非 0 携带）——原版 msg21 本就同步 prefix
   *  （MessageBuffer.cs:1476 worldItem.Prefix(prefix) 读流内 byte）;曾缺 → 带词缀
   *  掉落跨端（NPC 掉落自然掷/持物丢弃/微光产物）到远端洗白。尾读可选（旧端无此段） */
  prefix?: number;
}

export interface ClientNetHooks {
  /** 世界组装完成（全部初始 strip 到齐 + PlayerSpawn）——Game 进 loadWorld */
  onWorldReady: (world: World) => void;
  /** 运行期晚到 strip 的落地区域（Game 负责整块标脏 chunk + 小地图） */
  onSectionArrived?: (rect: { x0: number; y0: number; w: number; h: number }) => void;
  /** 进度（label, p 0..1） */
  onProgress?: (label: string, p: number) => void;
  /** 聊天 */
  onChat?: (text: string, r: number, g: number, b: number) => void;
  /** 被踢 */
  onKick?: (reason: string) => void;
  /** 箱子内容到达/被纠正（服务器权威；Game 负责登记 world.chests 与开面板） */
  onChestSync?: (chestIdx: number, x: number, y: number, items: Array<{ id: number; stack: number } | null>) => void;
  /** msg69 ChestName（SW-FX52-R12）箱名帧到达（MessageBuffer.cs:3053-3074 读面）：
   *  生产=服务器改名广播（:1969）+ 授予/纠正随发名断言（chestNameFrame）；
   *  chestIdx+x/y 定位（位置不符=原版 break 面由消费端判），name=''=清名 */
  onChestName?: (chestIdx: number, x: number, y: number, name: string) => void;
  /** NPC 快照到达（msg23；Game 维护傀儡池） */
  onNpcSnapshot?: (snaps: NpcSnap[]) => void;
  /** NPC 开关门事件到达（msg19 等价通道；Game 重放动作+音效） */
  onDoorEvent?: (ev: { closing: boolean; gate: boolean; x: number; y: number; dir: number }) => void;
  /** 掉落物操作到达（msg21；Game 维护傀儡/移除本地真掉落） */
  onItemOp?: (op: ItemOpMsg) => void;
  /** 弹幕快照到达（msg27；Game 维护傀儡池） */
  onProjectileSync?: (snaps: ProjSnap[]) => void;
  /** 弹幕消亡到达（v6 msg28；Game 即时移除傀儡） */
  onProjDespawn?: (netIds: number[]) => void;
  /** SSC 角色档到达（v6 msg201，--ssc 启用；Game 应用覆盖本地角色） */
  onSSC?: (recordJson: string) => void;
  /** 打击到达（msg42；房主权威结算）。fromSlot=打击者槽位（服务器回填,Boss 伤害
   *  统计归账;旧 server 无尾段=0 房主） */
  onStrike?: (netId: number, rawDmg: number, kbx: number, kby: number, fromSlot?: number, crit?: boolean) => void;
  /** 其他端玩家表情到达（msg120；Game 在对应远端代理头顶出泡 360t） */
  onEmoteBubble?: (slot: number, emoteId: number) => void;
  /** 树妖星露谷彩蛋广播到达（msg144；各端本地启动编排器——双向免回显） */
  onDryadStardewAnim?: () => void;
  /** PvP 近战命中意向到达（v7 msg44；被打方本地结算——Game 过 InOpposingTeam 门禁后走
   *  damagePlayer(pvp)）。fromSlot=攻击者槽位（服务器回填）；flags bit0=crit
   *  bits1-4=武器浸剂 meleeEnchant（StatusPvP 消费） */
  onStrikePlayer?: (fromSlot: number, targetSlot: number, dmg: number, kbx: number, kby: number, weaponId: number, flags: number) => void;
  /** 远端玩家 HP（msg16 中继） */
  onHp?: (slot: number, hp: number, maxHp: number) => void;
  /** 被击端实扣权威飘字到达（msg117 PlayerHurt；2026-08-30 批）——Game 侧在
   *  目标玩家代理位置 addDamageNumber：crit 位分档 = CombatText.cs:8/:10 真值单源
   *  （Game.playerHurtFloatColor——普伤 (255,80,90)/暴击 (255,100,30) 橙红系，
   *  曾注「金色」系措辞误记，二轮 FR4-F 勘正）；dmg 已是被击端实扣终值（含防御/
   *  endurance），直接显示。
   *  self slot 的帧服务器已排除发送者，理论上不可达；守卫仍在 handle 内兜底。
   *  攻端原 InPVP 公式预览飘字（Main.cs:65636 dmg−def×0.5 近似）由此通道替代后
   *  应删除——本帧到达前攻端「无预显示」即目标行为闭环。 */
  onPlayerHurt?: (slot: number, dmg: number, x: number, y: number, dir: number, flags: number) => void;
  /** 拴绳实体到达（msg82 module13；Game 经 LeashedEntityManager 重建/刷新/移除）。
   *  仅世界就绪后回调（组装期帧进 pendingLeashed，由 Game 在 loadWorld 完成后消费） */
  onLeashedSync?: (msg: LeashedNetMsg) => void;
  /** 房间策略到达（进场时；门禁/提示用） */
  onPolicy?: (policy: RoomPolicyState) => void;
  /** M9 旅程力量世界态到达（msg82 module5 sub0；服务器权威） */
  onJourneyWorldState?: (s: JourneyWorldState) => void;
  /** M9 旅程力量个人态到达（module5 sub1；任一玩家的 godmode/放置范围/刷怪率） */
  onJourneyPersonalState?: (slot: number, s: JourneyPersonalState) => void;
  /** M9 时段跳跃到达（module5 sub2；各端本地 skipToTime） */
  onJourneyTimeSkip?: (which: 1 | 2 | 3 | 4) => void;
  /** M9 研究进度上报中继到达（module6；接收端同队门在 Game 侧） */
  onJourneyUnlock?: (slot: number, itemId: number, amount: number) => void;
  /** M9 力量权限级到达（module9；本地 levels 已同步更新后回调） */
  onJourneyPermission?: (powerId: number, level: PowerPermissionLevel) => void;
  /** module0 液体变化到达（权威端广播；Game 直写 store + 标脏光照） */
  onLiquidSync?: (cells: LiquidCell[]) => void;
  /** module4 图鉴事件到达（Game 侧直写 tracker——SetKillCountDirectly 族） */
  onBestiaryEvent?: (events: BestiaryNetEvent[]) => void;
  /** module7 晶塔消息到达（Added/Removed→Game.pylons 维护；TeleportResult→传送/文案） */
  onPylonMessage?: (msg: PylonNetMsg) => void;
  /** ★TE net sync(2026-10-14,module16):host TE 快照到达(client 桶重建) */
  onTESnapshot?: (entries: TENetEntry[]) => void;
  /** module2 地图 ping 到达（他端标记；Game 入 Pings store→渲染层 15s 动画） */
  onMapPing?: (x: number, y: number) => void;
  /** module8 编排粒子到达（Game 侧按 type 派发本地视觉；未知型忽略） */
  onParticleOrchestra?: (type: number, settings: ParticleSettings) => void;
  /** module100 天空氛围到达（服务器 AmbienceServer 掷点；Game 解析锚玩家位 →
   *  SkyRenderer.spawnAmbientNet 同 seed 重放） */
  onAmbienceSpawn?: (playerSlot: number, seed: number, type: number) => void;
  /** msg203 全房 RTT 表到达（玩家列表面板数据源） */
  onPingTable?: (table: Array<{ slot: number; rttMs: number }>) => void;
  /** module14 per-client 掉落到达（房主/SimHost 经服务器定向转发——原版 msg90
   *  InstancedItem 等价;Boss 袋族各端私有实例。Game 侧 netLocalOnly 落地） */
  onInstancedLoot?: (entries: InstancedLootEntry[]) => void;
  /** module15 sub0 渔夫任务断言到达（SW-FX42,msg74 等价）：收端 world.anglerQuest
   *  直写 + anglerQuestFinished/今日名单复位（Game 侧消费） */
  onAnglerQuest?: (quest: number) => void;
  /** module15 sub1 交付中继到达（msg75 等价）：slot==mySlot 时收端置完成旗
   *  （重连/晚进房补发去重——Game 侧消费） */
  onAnglerFinished?: (slot: number) => void;
  /** module15 sub2 季节强置位到达（msg7 bitsByte9[6]/[7] 等价）：合并结果 +
   *  ForToday 私有位（Game 侧消费） */
  onSeasonBits?: (bits: number) => void;
  /** msg80 在用箱镜像到达（SW-FX42）：slot→chestIdx（-1=关闭）。Game 消费 =
   *  拒绝匹配（本端 pending 开箱请求撞上他人占用 → 清 pending,面板不弹） */
  onChestInUse?: (slot: number, chestIdx: number, x: number, y: number) => void;
}

/** vanilla 近战 PvP 甲虫蓄能入账【精确】式（★F14；Player.cs:38864-38868 返回段重算 +
 * Main.cs:67136-67143 CalculateDamagePlayersTakeInPVP + Player.cs:38533-35 crit 先折乘）：
 * = (int)max(1, rawDmg×(crit?2:1) − statDefense×0.5)。double 域仅 .0/.5 尾数（两输入皆
 * 整数×0.5），IEEE754 精确表示 → JS 算术零舍入差；(int) 截断=trunc，min1 钳在 double 段
 * 内先于截断（vanilla 语义：-0.5 双倍罚底仍收 1）。 */
export function beetlePvpCredit(rawDmg: number, crit: boolean, def: number): number {
  const v = Math.trunc(Math.trunc(rawDmg) * (crit ? 2 : 1) - def * 0.5);
  return v < 1 ? 1 : v;
}

export class ClientNet {
  active = false;
  mySlot = -1;
  players = new Map<number, RemotePlayerState>();
  /** 房间策略（RoomPolicy 到达前 = 自由房默认） */
  policy: RoomPolicyState = { roomCode: '', roomName: '', isHost: false, protectTiles: false, protectItems: false, maxPlayers: 255, pvpAllowed: false, rules: DEFAULT_ROOM_RULES };
  /** M9 力量权限级（module9 下发；默认全 CanBeChangedByEveryone——
   *  CreativePowerManager.Register :40-41 初值）。索引 = powerId 0-14 */
  journeyPermissions: PowerPermissionLevel[] = Array(JOURNEY_POWER_COUNT)
    .fill(PowerPermissionLevel.CanBeChangedByEveryone);

  /** CreativePowersHelper.IsAvailableForPlayer（:182-197）——UI 门禁查询 */
  journeyPowerAvailable(powerId: number): boolean {
    if (powerId < 0 || powerId >= JOURNEY_POWER_COUNT) return false;
    return isPowerAvailableFor(this.journeyPermissions[powerId], this.policy.isHost);
  }

  private ws: WebSocket | null = null;
  private parser = new FrameParser();
  private hooks: ClientNetHooks;
  private game: { player: { appearance?: unknown; hostile: boolean; team: number; inv: { slots: Array<{ id: number; stack: number } | null> } } };
  private hostToken = '';

  /** 组装中的世界（收到 msg7 建骨架，strip 到齐后交给 onWorldReady） */
  private pendingWorld: World | null = null;
  private pendingStrips = 0;
  private pendingStripsTotal = 0;
  private worldDelivered = false;
  /** 本地 tile 变更上报队列（TileStore.netReporter 收集） */
  private tileQueue: TileOp[] = [];
  /** msg23 短码表（v4：codeId → {netId, key}；服务器端分配，全量条目重建） */
  private npcCodes = new Map<number, { netId: number; key: string }>();
  /** v6 msg201 暂存（世界就绪后由 Game 消费，见 SscSync case 注释——竞态防护） */
  pendingSSC: string | null = null;
  /** msg82 module13 暂存（同 pendingSSC 竞态防护：进场组装期到达的 FullSync 若即用，
   *  会被 loadWorld → afterWorldLoad → respawnAll 的 clear() 整体抹掉——实体永久丢失。
   *  Game 在 loadWorld 完成后 drainPendingLeashed 消费并置 leashedReady） */
  pendingLeashed: LeashedNetMsg[] = [];
  /** 拴绳实体直通开关（Game 在 loadWorld 完成后开启；worldDelivered 早于 loadWorld
   *  完成——用它做门会漏进 clear() 竞态窗口，故独立成旗） */
  leashedReady = false;
  /** msg21 上行合帧暂存（P1.3：netDropSweep 每 4 tick 逐条发 → 攒到 tick 冲洗拼一条 WS 消息） */
  private pendingFrames: Uint8Array[] = [];
  private lastStateSent = 0;
  private lastSentPos = { x: 0, y: 0 };

  constructor(
    game: ClientNet['game'],
    hooks: ClientNetHooks,
  ) {
    this.game = game;
    this.hooks = hooks;
  }

  private pingTimer: ReturnType<typeof setInterval> | null = null;

  connect(url: string, hostToken = '') {
    this.url = url;
    this.hostToken = hostToken;
    this.connect0(url);
  }

  /** 底层建连（首连/重连共用） */
  private connect0(url: string) {
    this.active = true;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      // R12 修复：非法 URL 同步抛异常 → 转为 reject 语义（onKick）而非穿透调用栈
      this.active = false;
      this.hooks.onKick?.(`地址无效：${(e as Error).message}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    // R9：独立 30s 心跳——暂停/后台（fixedUpdate 停跑）也不再被服务器 120s 看门狗踢
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => {
        this.send(new NetWriter(Msg.Ping).f64(performance.now()).finish());
      }, 30000);
    }
    ws.onopen = () => {
      // Hello（对齐原版 msg1：版本校验）。连接时 Game.player 可能尚未创建（joinNetGame
      // 先连后 loadWorld）——外观名走可选链兜底;再退 UI 预置的选中角色名（pendingJoinName,
      // mainFlow onJoinRoom 注入——加入公告显示真名而非"玩家"）
      const p = this.game.player as { appearance?: { name?: string } } | undefined | null;
      const pending = (this.game as unknown as { pendingJoinName?: string }).pendingJoinName;
      const name = p?.appearance?.name ?? pending ?? '玩家';
      // 房主令牌：URL 已带 ?token=（路由层 newClient 注入）——消息内再传一份兜底
      // （非房主/旧路径传空串，服务器 try/catch 读不到即跳过）
      const hello = new NetWriter(Msg.Hello).str(PROTO_MAGIC).u16(PROTO_VER).str(name).str(this.hostToken);
      this.send(hello.finish());
    };
    ws.onmessage = (e) => {
      this.parser.append(new Uint8Array(e.data as ArrayBuffer));
      this.parser.drain((id, r) => this.handle(id, r));
    };
    ws.onclose = () => {
      if (!this.active || this.userClosed) return;
      // v3 断线重连（§8.8）：有 session 凭据 → 2s 间隔自动重试 3 次（同 slot 复位）；
      // 耗尽或无凭据 → 按原语义 onKick
      if (this.session && this.reconnects < 3) {
        this.reconnects++;
        this.active = false;
        setTimeout(() => {
          if (this.userClosed) return;
          const sep = this.url.includes('?') ? '&' : '?';
          this.connect0(`${this.url}${sep}session=${encodeURIComponent(this.session)}`);
        }, 2000);
        return;
      }
      this.active = false;
      this.hooks.onKick?.('与服务器断开连接');
    };
    ws.onerror = () => { /* close 跟上 */ };
  }

  private url = '';
  private session = '';
  private reconnects = 0;
  private userClosed = false;

  private send(frame: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  /** 请求玩家位置周围的 strip（R3 移动续传：跨条带边界时由 Game 调用） */
  requestSection(cx: number, cy: number) {
    this.send(new NetWriter(Msg.SpawnTileData).i32(Math.floor(cx)).i32(Math.floor(cy)).finish());
  }

  /** msg150 观战焦点（原版 SetOrRequestSpectating 客户端半边 :17089-17102）：
   *  服务器把本端 AOI 过滤中心切到目标 slot（-1 恢复自身 avatar） */
  sendSpectateFocus(targetSlot: number) {
    this.send(new NetWriter(Msg.SpectateFocus).i16(targetSlot).finish());
  }

  disconnect() {
    this.userClosed = true;
    this.active = false;
    // ★TE net sync(2026-10-14):client 角色复位(回单机 tick/save 语义)
    void import('../mods/tileEntities').then((m) => m.setModTENetClientRole(false));
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.ws?.close();
    this.ws = null;
    // ★F-4：断线清 PvP 记账面——未决挥击 FIFO 与远端 statDefense/免疫镜像随会话
    //  失效。players 表条目保留（PlayerListPanel 等消费方可能还持有引用），但全部
    //  置离线并重置易失镜像字段；同端复连走 PlayerActive 复用支再兜底一次（见
    //  PlayerActive case 注）。不清则回执窗口内复连会把旧债配到新会话头上。
    this.pendingMeleeHits.clear();
    for (const rp of this.players.values()) {
      rp.active = false;
      rp.pvpDefense = null;
      rp.pvpImmuneT = 0;
    }
  }

  // ================= 收包分发（对齐原版 MessageBuffer switch） =================

  private handle(msgId: number, r: NetReader) {
    switch (msgId) {
      case Msg.Kick: {
        this.hooks.onKick?.(r.str());
        this.disconnect();
        return;
      }
      case Msg.PlayerSlot: {
        this.mySlot = r.u8();
        this.invDumpPending = true; // 物品全量 dump 时机：slot 分配后首 tick
        // v3：session 凭据（重连用）；重连场景复位 join 状态以重走世界组装
        const sess = (() => { try { return r.str(); } catch { return ''; } })();
        if (sess) {
          if (this.worldDelivered) {
            // 断线重连：世界将重新组装下发（pendingWorld 复位）
            this.worldDelivered = false;
            this.pendingWorld = null;
            this.pendingStrips = 0;
            this.pendingLeashed.length = 0;   // 旧会话实体帧作废（服务器按条带重发）
            this.leashedReady = false;        // 重组装期间重新走暂存
          }
          this.session = sess;
          this.reconnects = 0;
        }
        // 全量上传自身（对齐原版 msg3 后立刻 SyncPlayer + RequestWorldData）
        // hairDye 并入外观 JSON（原版 msg4 PlayerInfo 携带 hairDye byte 的等价；
        // 服务器盲转字符串 → 零协议改动，2026-08-14）
        // voiceVariant/voicePitchOffset 同走本通道（原版 MessageBuffer.cs:299-302
        // msg4 读 byte+float 并 clamp——整包 spread 等价承载,登记差异：无独立
        // clamp 门,消费侧 Appearance.validate/hurtVoicePlan 自行钳 1..3/±1）
        const p2 = this.game.player as { appearance?: unknown; hairDye?: number } | undefined | null;
        const app = JSON.stringify({ ...(p2?.appearance as Record<string, unknown> ?? {}), hairDye: p2?.hairDye ?? 0 });
        this.send(new NetWriter(Msg.SyncPlayer).u8(this.mySlot).str(app).finish());
        this.send(new NetWriter(Msg.RequestWorldData).finish());
        return;
      }
      case Msg.WorldData: {
        this.pendingWorld = this.readWorldData(r);
        return;
      }
      case Msg.StatusText: {
        this.pendingStrips = r.u16();
        this.pendingStripsTotal = Math.max(1, this.pendingStrips);
        // 仅初始组装期上报进度：进世界后 R3 移动续传也会触发 StatusText（fresh=0），
        // 无条件回调会把已关闭的全屏进度遮罩重新拉起 → "永久卡在接收世界数据"
        if (!this.worldDelivered) this.hooks.onProgress?.('接收世界数据', 0);
        return;
      }
      case Msg.TileSection: {
        // R3 修复：初始组装期写入 pendingWorld；运行期（已进世界）晚到的 strip
        // 直写 gameWorld 并返回区域（调用方负责整块标脏——见 requestSection 回调）
        if (this.pendingWorld) {
          decodeStrip(this.pendingWorld.store, r);
          if (this.pendingStrips > 0) {
            this.pendingStrips--;
            // 进度按剩余比例推进（此前恒 0.5 不动）
            this.hooks.onProgress?.('接收世界数据', this.pendingStripsTotal > 0 ? 1 - this.pendingStrips / this.pendingStripsTotal : 0.5);
          }
        } else if (this.gameWorld) {
          const rect = decodeStrip(this.gameWorld.store, r);
          if (rect && this.hooks.onSectionArrived) this.hooks.onSectionArrived(rect);
        }
        return;
      }
      case Msg.PlayerSpawn: {
        const slot = r.u8();
        const sx = r.i32(), sy = r.i32();
        if (slot === this.mySlot && !this.worldDelivered && this.pendingWorld) {
          this.worldDelivered = true;
          this.pendingWorld.spawnX = sx;
          this.pendingWorld.spawnY = sy;
          this.hooks.onProgress?.('完成', 1);
          this.hooks.onWorldReady(this.pendingWorld);
          this.pendingWorld = null;
          // R2 修复：进世界后重发外观——连接时 player 可能尚未创建/外观未应用，
          // 此刻 Game.player 必然就绪（onWorldReady 已被 loadWorld 消费）。
          // hairDye 同步并入（与 PlayerSlot 时刻同构——否则这发重发会把 8-14 批
          // 发色剂字段冲掉：接收端 Game 只在 parsed.hairDye 为 number 时更新，
          // 缺键=保持旧值,但重发前若玩家带档发色剂则远端要等 applyAppearance 补发）
          const p3 = this.game.player as { appearance?: unknown; hairDye?: number } | undefined;
          if (p3?.appearance) {
            this.send(new NetWriter(Msg.SyncPlayer).u8(this.mySlot)
              .str(JSON.stringify({ ...(p3.appearance as Record<string, unknown>), hairDye: p3.hairDye ?? 0 })).finish());
          }
        }
        return;
      }
      case Msg.PlayerActive: {
        const slot = r.u8();
        const active = r.bool();
        const name = r.str();
        let p = this.players.get(slot);
        if (active) {
          if (!p) {
            p = {
              slot, name, appearance: '{}', x: 0, y: 0, vx: 0, vy: 0,
              up: false, down: false, left: false, right: false, jump: false, useItem: false,
              facing: 1, selectedItem: 0, dead: false, fresh: false, active: true, lastFresh: 0,
              hostile: false, team: 0, hp: 100, maxHp: 100, sleeping: false,
              deathsPve: 0, deathsPvp: 0, mana: 0, manaMax: 0, luck: 0, pvpImmuneT: 0, pvpDefense: null,
              camTarget: null,
            };
            this.players.set(slot, p);
          } else if (!p.active) {
            // ★F-4 slot 复用：上一 occupant 的易失 PvP 记账态不得跨会话残留——
            // 镜像 def/免疫随人走，换人即弃（新 occupant 的 msg16/msg13 立即重建）；
            // 未决挥击 FIFO 同键位一并作废。
            p.pvpDefense = null;
            p.pvpImmuneT = 0;
            this.pendingMeleeHits.delete(slot);
          }
          p.active = true;
          p.name = name || p.name;
        } else if (p) {
          p.active = false;
          // ★F-4 离场清账：此人 slot 的未决挥击与他名下的 statDefense/免疫镜像
          // 即刻失效（服务器不会再为此人回执 msg117；复用前先归零防错配）
          this.pendingMeleeHits.delete(slot);
          p.pvpDefense = null;
          p.pvpImmuneT = 0;
        }
        return;
      }
      case Msg.SyncPlayer: {
        const slot = r.u8();
        const appearance = r.str();
        const p = this.players.get(slot);
        if (p) p.appearance = appearance;
        return;
      }
      case Msg.SyncPlayerItem: {
        // 远端物品/装备（msg5）：Game 侧拷入 proxy.inv 驱动手持/盔甲/挥舞渲染
        const entries = readPlayerItems(r);
        this.applyRemoteItems(entries.filter((e) => e.playerSlot !== this.mySlot));
        return;
      }
      case Msg.PlayerState: {
        // v2 布局（对齐原版 msg13）：slot + ctrlBits + flagBits + selectedItem + pos [+vel]
        const slot = r.u8();
        const ctrl = r.u8();
        const flag = r.u8();
        const sel = r.u8();
        const x = r.f32(), y = r.f32();
        let vx = 0, vy = 0;
        if (flag & 4) { vx = r.f32(); vy = r.f32(); } // flagBits[2] = hasVelocity
        // v7 尾部：u8 team（hostile 在 flagBits[7]）
        const team = r.remaining > 0 ? Math.max(0, Math.min(5, r.u8())) : 0;
        // ★刀D 尾部：flagBits[5]+f32×2（原版接收位 MessageBuffer.cs:1049——
        // bitsByte7[5] ? ReadVector2 : null）。remaining>=8 门：旧 server 中继剥尾
        // 但 flag 位原样过墙 → 位在段不在=拒读（不错位不越界）;NaN 防毒（S6 族）
        let camTarget: { x: number; y: number } | null = null;
        if ((flag & 32) && r.remaining >= 8) {
          const cx0 = r.f32(), cy0 = r.f32();
          if (Number.isFinite(cx0) && Number.isFinite(cy0)) camTarget = { x: cx0, y: cy0 };
        }
        const hostile = !!(flag & 128);
        let p = this.players.get(slot);
        if (!p) {
          p = {
            slot, name: `玩家${slot}`, appearance: '{}',
            x, y, vx: 0, vy: 0,
            up: false, down: false, left: false, right: false, jump: false, useItem: false,
            facing: ctrl & 64 ? 1 : -1, selectedItem: sel, dead: !!(flag & 64),
            fresh: true, active: true, lastFresh: performance.now(),
            hostile, team, hp: 100, maxHp: 100, sleeping: false,
            deathsPve: 0, deathsPvp: 0, mana: 0, manaMax: 0, luck: 0, pvpImmuneT: 0, pvpDefense: null,
            camTarget,
          };
          this.players.set(slot, p);
        }
        p.lastFresh = performance.now();
        p.x = x; p.y = y; p.vx = vx; p.vy = vy;
        p.up = !!(ctrl & 1); p.down = !!(ctrl & 2);
        p.left = !!(ctrl & 4); p.right = !!(ctrl & 8);
        p.jump = !!(ctrl & 16); p.useItem = !!(ctrl & 32);
        p.facing = ctrl & 64 ? 1 : -1;   // ctrlBits[6] = direction（原版）
        p.selectedItem = sel;
        p.sleeping = !!(flag & 1);   // flagBits[0]（原版 bitsByte26[0] sleeping.isSleeping）
        p.dead = !!(flag & 64);           // flagBits[6] = ghost
        p.hostile = hostile; p.team = team;
        p.camTarget = camTarget;          // ★刀D：netCameraTarget 镜像（逐包覆写,原版同相）
        p.fresh = true;                   // Game 侧注入 netOffset 后清零
        return;
      }
      case Msg.TileBatch: {
        // 服务器中继的远端操作：应用 + 回环抑制
        const ops = readTileBatch(r);
        this.applyRemote(ops);
        return;
      }
      case Msg.SetTime: {
        // 时间对齐（服务器权威 clock）
        if (this.gameWorld) {
          const t = r.f64();
          const d = r.u32();
          if (Math.abs(this.gameWorld.clock.timeOfDay - t) > 0.005) {
            this.gameWorld.clock.timeOfDay = t;
          }
          this.gameWorld.clock.dayCount = d;
        }
        return;
      }
      case Msg.NetModules: {
        const moduleId = r.u16();
        if (moduleId === NetModule.Text) {
          const slot = r.u8();
          const text = r.str();
          const cr = r.u8(), cg = r.u8(), cb = r.u8();
          // slot=255 = 服务器系统公告（房主交接等）——直显无名字前缀
          if (slot === 255) this.hooks.onChat?.(text, cr, cg, cb);
          else {
            const name = this.players.get(slot)?.name ?? `玩家${slot}`;
            this.hooks.onChat?.(`<${name}> ${text}`, cr, cg, cb);
          }
        } else if (moduleId === NetModule.JoinLeave) {
          // 加入/离开公告（原版服务器 Lang.mp[19]/[20] 广播，色 (255,240,20)）
          const slot = r.u8();
          const joined = r.bool();
          const name = this.players.get(slot)?.name ?? `玩家${slot}`;
          this.hooks.onChat?.(
            Lang.text(joined ? 'LegacyMultiplayer.19' : 'LegacyMultiplayer.20', name),
            255, 240, 20,
          );
        } else if (moduleId === NetModule.LeashedEntity) {
          // msg82 module13 拴绳实体（= 原版 LeashedEntity.NetModule）。loadWorld 完成
          // 前（leashedReady）暂存——respawnAll 的 clear() 竞态见 pendingLeashed 注
          const msg = readLeashedMessage(r);
          if (msg) {
            if (this.leashedReady) this.hooks.onLeashedSync?.(msg);
            else if (this.pendingLeashed.length < 256) this.pendingLeashed.push(msg);
          }
        } else if (moduleId === NetModule.CreativePowers) {
          // M9 msg82 module5 旅程力量（= 原版 NetCreativePowersModule）
          const sub = r.u8();
          if (sub === 0) this.hooks.onJourneyWorldState?.(readJourneyWorldState(r));
          else if (sub === 1) {
            const { slot, state } = readJourneyPersonalState(r);
            this.hooks.onJourneyPersonalState?.(slot, state);
          } else if (sub === 2) {
            const which = readJourneyTimeSkip(r);
            if (which) this.hooks.onJourneyTimeSkip?.(which);
          }
        } else if (moduleId === NetModule.CreativeUnlocksReport) {
          // M9 msg82 module6 研究上报中继（= 原版 NetCreativeUnlocksPlayerReportModule
          // Deserialize :18-34：同队门由消费端判——Game 侧读 players[slot].team）
          const m = readJourneyUnlockRelay(r);
          this.hooks.onJourneyUnlock?.(m.slot, m.itemId, m.amount);
        } else if (moduleId === NetModule.CreativePowerPermissions) {
          // M9 msg82 module9 权限级（= 原版 NetCreativePowerPermissionsModule——S→C 专向）
          const { powerId, level } = readJourneyPermission(r);
          if (powerId >= 0 && powerId < JOURNEY_POWER_COUNT) {
            this.journeyPermissions[powerId] = level;
            this.hooks.onJourneyPermission?.(powerId, level);
          }
        } else if (moduleId === NetModule.Liquid) {
          // module0 液体（原版 NetLiquidModule.Deserialize :73-90：逐格直写
          // liquid/liquidType——本地不模拟,权威值覆盖）
          const cells = readLiquidModule(r);
          if (cells.length) this.hooks.onLiquidSync?.(cells);
        } else if (moduleId === NetModule.PingModule) {
          // module2 地图 ping（原版 NetPingModule → Main.Pings.Add）
          const pos = readMapPing(r);
          if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) this.hooks.onMapPing?.(pos.x, pos.y);
        } else if (moduleId === NetModule.Bestiary) {
          // module4 图鉴（原版 NetBestiaryModule：三子型直写本地 tracker）
          const events = readBestiaryModule(r);
          if (events.length) this.hooks.onBestiaryEvent?.(events);
        } else if (moduleId === NetModule.ModTE) {
          // ★TE net sync(module16):host 权威快照→client 桶重建(0 条=清空[R-B-4])
          const entries = readTEModule(r);
          this.hooks.onTESnapshot?.(entries);
        } else if (moduleId === NetModule.TeleportPylon) {
          // module7 晶塔（原版 NetTeleportPylonModule：AddForClient/RemoveForClient/
          // HandleTeleportRequest——本仓 sub3 回执 = 传送批准/失败文案）
          const msg = readPylonModule(r);
          if (msg) this.hooks.onPylonMessage?.(msg);
        } else if (moduleId === NetModule.Particles) {
          // module8 编排粒子（原版 NetParticlesModule.Deserialize :17-31：客户端
          // SpawnParticlesDirect——视觉派发在 Game 侧按 type 走,未知型静默忽略）
          const m = readParticleModule(r);
          if (Number.isFinite(m.settings.posX) && Number.isFinite(m.settings.posY)) {
            this.hooks.onParticleOrchestra?.(m.type, m.settings);
          }
        } else if (moduleId === NetModule.Ambience) {
          // module100 天空氛围（原版 NetAmbienceModule.Deserialize :21-39：非 dedServ
          // → AmbientSky.Spawn(player, type, seed)；锚玩家位由 Game 从镜像表解析）
          const m = readAmbienceModule(r);
          this.hooks.onAmbienceSpawn?.(m.playerSlot, m.seed, m.type);
        } else if (moduleId === NetModule.InstancedLoot) {
          // module14 per-client 掉落（原版 msg90 InstancedItem 语义——服务器按
          // targetSlot 定向转发;非本端条目为异常流,Game 侧再验后静默丢弃）
          const entries = readInstancedLootModule(r);
          if (entries.length) this.hooks.onInstancedLoot?.(entries);
        } else if (moduleId === NetModule.AnglerQuest) {
          // module15（SW-FX42）：sub0=msg74 任务号+新的一天复位 / sub1=msg75 交付中继
          // / sub2=季节强置位（msg7 bitsByte9[6]/[7] 等价）。旧端 default 忽略未知
          // moduleId = 无漂移（150/SpectateFocus 先例）
          const m = readAnglerQuestModule(r);
          if (!m) return;
          if (m.sub === AnglerQuestSub.Quest) this.hooks.onAnglerQuest?.(m.quest);
          else if (m.sub === AnglerQuestSub.Finished) this.hooks.onAnglerFinished?.(m.slot);
          else this.hooks.onSeasonBits?.(m.bits);
        }
        return;
      }
      case Msg.ServerPingProbe: {
        // msg203：服务器探针 {f64 serverTs, RTT 表}——原样回显 serverTs（服务器
        // 测算本端 RTT）；表进 playerPings（面板数据源）
        const { serverTs, table } = readPingProbe(r);
        this.playerPings.clear();
        for (const t of table) this.playerPings.set(t.slot, t.rttMs);
        this.hooks.onPingTable?.(table);
        this.send(writePingProbeEcho(serverTs));
        return;
      }
      case Msg.RoomPolicy: {
        this.policy = {
          roomCode: r.str(),
          roomName: r.str(),
          isHost: r.bool(),
          protectTiles: r.bool(),
          protectItems: r.bool(),
          maxPlayers: (() => { try { return r.u16(); } catch { return 255; } })(),
          pvpAllowed: (() => { try { return !!r.u8(); } catch { return false; } })(),
          // v8 尾部 ruleBits（旧 server 无尾段 → 全 false = 中继房语义不变）。
          // pvpAllowed 读失败（更旧 server）时 remaining=0,rules 同样落默认
          rules: (() => { try { return rulesFromBits(r.u8()); } catch { return DEFAULT_ROOM_RULES; } })(),
        };
        this.hooks.onPolicy?.(this.policy);
        return;
      }
      case Msg.SyncChestItem: {
        this.applyRemoteChest(r);
        return;
      }
      case Msg.ChestName: {
        // msg69（SW-FX52-R12 箱改名广播）：{i16 idx, i16 x, i16 y, str name}——
        // 服务器受理 msg33 改名段后广播（MessageBuffer.cs:1969）；本端镜像进
        // ChestData.name（消费=地图标签/悬停名/箱面板题）
        const cn = readChestName(r);
        if (cn) this.hooks.onChestName?.(cn.chestIdx, cn.x, cn.y, cn.name);
        return;
      }
      case Msg.ChestInUse: {
        // msg80（SW-FX42 在用箱镜像）：{u8 slot, i16 chestIdx, i32 x, i32 y}——
        // 原版 MessageBuffer.cs:3220-3231 收包直写 Main.player[slot].chest（值域
        // -3..7999 门）；本仓镜像进 chestOpenByPlayer,拒绝匹配走 hook（Game 清
        // netPendingChest——服务器 msg31 拒发内容时本帧是唯一否定信号）
        const slot = r.u8();
        const chestIdx = r.i16();
        const x = r.i32(), y = r.i32();
        if (chestIdx >= 0) this.chestOpenByPlayer.set(slot, chestIdx);
        else this.chestOpenByPlayer.delete(slot);
        if (slot !== this.mySlot) this.hooks.onChestInUse?.(slot, chestIdx, x, y);
        return;
      }
      case Msg.SyncNPC: {
        // v4 短码格式：每条 1B eflags——bit0=含 key 全量(u32 netId+u16 codeId+str key)，
        // bit1=boss；否则仅 u16 codeId（查本端 codeId→netId/key 表）。
        // 未知短码：**先把本条剩余字段读完再丢弃**——continue 前不消费会让读指针错位，
        // 毒化整条连接（review C1）；自愈靠 ≤2s 全量兜底重发
        const n = r.u16();
        const snaps: NpcSnap[] = [];
        const byCode = new Map<number, NpcSnap>(); // 锚点尾段按 code 回填本帧快照
        for (let i = 0; i < n; i++) {
          const eflags = r.u8();
          let netId = 0, key = '', code = 0;
          if (eflags & 1) {
            netId = r.u32();
            code = r.u16();
            key = r.str();
            this.npcCodes.set(code, { netId, key });
          } else {
            code = r.u16();
            const e = this.npcCodes.get(code);
            netId = e?.netId ?? 0;
            key = e?.key ?? '';
          }
          const x = r.f32(), y = r.f32(), vx = r.f32(), vy = r.f32();
          const hp = r.i16(), maxHp = r.i16(), animT = r.u16();
          if (!netId) continue; // 未知短码：字段已消费，仅丢弃本条快照
          const snap: NpcSnap = { netId, key, x, y, vx, vy, hp, maxHp, animT,
            flags: eflags & 2 ? 1 : 0 };
          snaps.push(snap);
          byCode.set(code, snap);
        }
        // 刺球锚点尾段（帧级，条目循环【后】：{u16 aiCount,[u16 code,f32 ai1,f32 ai2]×aiCount}）。
        // 放帧尾而非条目内是旧访客兼容的关键——旧端读完 n 条即返回，帧尾残余字节永不被
        // 当作下一条 eflags 消费（条目内携带会让旧端在多条目帧上错位+NetReader 越界抛，
        // 且 handle 无 try/catch 会毒化 FrameParser）。旧 server 无尾段 → remaining=0 不读；
        // 含锚点条目时服务器恒附尾段（值按 code 归条），全量/短码两路同构
        if (r.remaining >= 2) {
          const aiCount = r.u16();
          for (let i = 0; i < aiCount && r.remaining >= 10; i++) {
            const code = r.u16();
            const ai1 = r.f32(), ai2 = r.f32();
            const s = byCode.get(code);
            if (s) { s.ai1 = ai1; s.ai2 = ai2; }
          }
        }
        this.hooks.onNpcSnapshot?.(snaps);
        return;
      }
      case Msg.DoorEvent: {
        // msg19 等价：NPC 开关门即时事件——立即重放（netSuppress 防回环）+ 音效。
        // tile 终态随后由 TileBatch 收敛为同值，双写幂等
        const ev = readDoorEvent(r);
        if (ev) this.hooks.onDoorEvent?.(ev);
        return;
      }
      case Msg.SyncItem: {
        // 原版 msg21/145 双态（NetMessage.cs:88-92：微光物品升格 145 附尾段）——
        // 本协议在 op0 尾段条件携带（下方 r.remaining>=5 读）。msg146 ShimmerActions
        // 不需要：微光转化产物（decraft/变体/NPC 化）在本仓是拥有端实体化后经
        // SyncItem spawn 自然广播，无独立动作面。
        const netId = r.u32();
        const op = r.u8() as 0 | 1 | 2 | 3;
        let key = '', stack = 0, x = 0, y = 0, vx = 0, vy = 0;
        if (op === 0 || op === 3) {
          key = r.str(); stack = r.u16();
          x = r.f32(); y = r.f32(); vx = r.f32(); vy = r.f32();
          // 145 尾段（u8 shimmered + f32 shimmerTime）：条件尾读——旧端/非微光
          // 发送无此段（同 StrikeNPC fromSlot 先例）
          let shimmered: boolean | undefined;
          let shimmerTime: number | undefined;
          if (r.remaining >= 5) {
            shimmered = r.u8() !== 0;
            shimmerTime = r.f32();
          }
          // ★BJ390：词缀尾段（u8,仅非 0 携带,MessageBuffer.cs:1476 同域）——
          // 尾读可选（旧发送端 shimmer 段后无残留;新端无词缀也不写）
          let prefix: number | undefined;
          if (r.remaining >= 1) prefix = r.u8();
          this.hooks.onItemOp?.({ op, netId, key, stack, x, y, vx, vy, shimmered, shimmerTime, prefix });
          return;
        }
        this.hooks.onItemOp?.({ op, netId, key, stack, x, y, vx, vy });
        return;
      }
      case Msg.SyncProjectile: {
        const n = r.u16();
        const snaps: ProjSnap[] = [];
        for (let i = 0; i < n; i++) {
          snaps.push({
            netId: r.u32(), kind: r.u8(), tag: r.str(),
            dmg: r.i16(), aux: r.i16(),
            x: r.f32(), y: r.f32(), vx: r.f32(), vy: r.f32(),
          });
        }
        this.hooks.onProjectileSync?.(snaps);
        return;
      }
      case Msg.StrikeNPC: {
        const netId = r.u32();
        const dmg = r.i16();
        const kbx = r.f32(), kby = r.f32();
        // 尾部 u8 fromSlot（服务器回填打击者槽位——旧 server 无尾段 = 0 房主）：
        // 房主 BossDamageTracker 的访客伤害归账用（原版服务器端 owner 同义）
        const fromSlot = r.remaining > 0 ? r.u8() : 0;
        // BJ723-B D5 清偿（BJ725-A）：尾段 crit 位（server 在 slot 后重排——旧端读
        //  remaining>0 只吃 slot,残留 crit 字节被旧端忽略=双向优雅降级）
        const crit = r.remaining > 0 ? r.u8() > 0 : false;
        this.hooks.onStrike?.(netId, dmg, kbx, kby, fromSlot, crit);
        return;
      }
      case Msg.DryadStardew: {
        // msg144 S→C：载荷空——其他端树妖演出（发送端已本地播）
        if (this.hooks.onDryadStardewAnim) this.hooks.onDryadStardewAnim();
        return;
      }
      case Msg.EmoteBubble: {
        // msg120 S→C：{u8 slot, u8 emoteId}——其他端玩家表情,锚到对应代理头顶
        const slot = r.u8();
        const emoteId = r.u8();
        if (emoteId >= 0 && emoteId < 151 && slot !== this.mySlot) {
          this.hooks.onEmoteBubble?.(slot, emoteId);
        }
        return;
      }
      case Msg.StrikePlayer: {
        // v7 PvP 近战命中意向（被击端接收）：尾部 u8 fromSlot = 服务器回填的攻击者槽位
        const targetSlot = r.u8();
        const dmg = r.i16();
        const kbx = r.i16(), kby = r.i16();
        const weaponId = r.u16();
        const flags = r.u8();
        const fromSlot = r.remaining > 0 ? r.u8() : 0;
        this.hooks.onStrikePlayer?.(fromSlot, targetSlot, dmg, kbx, kby, weaponId, flags);
        return;
      }
      case Msg.ProjDespawn: {
        // v6 msg28：消亡批量——未知 netId 为无主傀儡，直接忽略
        const n = Math.min(r.u16(), 64);
        const ids: number[] = [];
        for (let i = 0; i < n; i++) ids.push(r.u32());
        if (ids.length) this.hooks.onProjDespawn?.(ids);
        return;
      }
      case Msg.PlayerLifeMana: {
        const slot = r.u8();
        const hp = r.i16(), maxHp = r.i16();
        // 尾部死亡计数（旧 server 无尾段 → 保持 0;Player.cs numberOfDeaths 分道）
        const deathsPve = r.remaining >= 2 ? r.u16() : undefined;
        const deathsPvp = r.remaining >= 2 ? r.u16() : undefined;
        // 尾部 mana/luck（2026-08-20 per-client 批——掉落结算 closestPlayer 数据源;
        // 旧 server/旧端无尾段 → 缺省 0,心星条件按未满档退化,登记兼容语义）
        let mana: number | undefined, manaMax: number | undefined, luck: number | undefined;
        if (r.remaining >= 8) { mana = r.i16(); manaMax = r.i16(); luck = r.f32(); }
        // 尾部 PvP 免疫余量（2026-08-30 批——攻端门禁镜像,见 RemotePlayerState.pvpImmuneT。
        // 2026-08-31 复核：旧 server 重打包剥此尾 → undefined 分支保持既有镜像,
        // 只靠 decayProxyImmune 本地衰减归零,绝不残存“永续免伤”——缺省 0 = 不拦）
        const pvpImmune = r.remaining >= 2 ? r.i16() : undefined;
        // 尾部 statDefense 镜像（★F14 甲虫 MP 记账批——位置序跟在免疫段后；旧 server
        // 剥离/对端缺发 → null 保持既有值（null 才代表「未知」,消费侧弃账不虚增））。
        // ★F-3② 宽度口径统一：线字段=syncHp 写侧同款 u16（0..65535），读侧曾遗留
        // i16 域的 min(32767) 截帽——两层不同宽,>32767 的防御终值会被单侧扭曲。
        // 统一取【线字段自然宽度】：u16 解码本身保证非负有限，仅需保持原值即等宽；
        // 消费面 beetlePvpCredit 对 def 单调递减且有 min1 地板，无溢出放大路径。
        const pvpDef = r.remaining >= 2 ? r.u16() : undefined;
        // 缓存进状态表（proxy.hp 接线在 Game.simulateRemotePlayers 每帧读取）
        const rp = this.players.get(slot);
        if (rp) {
          rp.hp = hp; rp.maxHp = maxHp;
          if (deathsPve !== undefined) rp.deathsPve = deathsPve;
          if (deathsPvp !== undefined) rp.deathsPvp = deathsPvp;
          if (mana !== undefined) rp.mana = mana;
          if (manaMax !== undefined) rp.manaMax = manaMax;
          if (luck !== undefined && Number.isFinite(luck)) rp.luck = luck;
          if (pvpImmune !== undefined) rp.pvpImmuneT = Math.max(0, Math.min(32767, pvpImmune));
          if (pvpDef !== undefined) rp.pvpDefense = pvpDef;
        }
        if (slot !== this.mySlot) this.hooks.onHp?.(slot, hp, maxHp);
        return;
      }
      case Msg.PlayerHurt: {
        // msg117 被击端实扣权威飘字（原版 MessageBuffer.cs:3882-3897 以 quiet Hurt
        // 重放音效+尘+飘字；本仓重放面只剩飘字 → 直通 hook,呈现接线在 Game 侧）。
        // 服务器已覆写 slot=发送者并排除发送者本人广播；self 帧防御兜底丢弃
        // （被击端本地已显示过自己的数字,不双显）。
        const m = readPlayerHurt(r);
        if (!m || m.slot === this.mySlot) return;
        this.hooks.onPlayerHurt?.(m.slot, m.dmg, m.x, m.y, m.dir, m.flags);
        // ★F14 甲虫蓄能回执关联消费：仅 Pvp 位帧参与（PvE/环境伤 flags=0 不冲账，
        //  避免「目标掉岩浆」清走我的未决挥击）；★F-1 再加 MeleeSource 位门——
        //  vanilla 全部五条 PvP 结算支只有近战支记 beetleCounter（Player.cs:44456-44460;
        //  爆炸 bit7 :13981 / 狱火 bit6 :10348 / 盾转移 bit5 / PvP 弹 Damage_PVP 族
        //  均无此记账面），故 bit7/bit5/bit6/PvP 弹的 msg117【抽队但不充能】会把他人的
        //  命中错配进我的未决挥击——非近战源不抽队不充能。降级矩阵见 PROTO_VER 注 h)
        //  （旧端无位 = 不充能 = 保守欠计）。FIFO 取队头 = 同目标窗口交叠的裁决序；
        //  队空 = 纯观战帧不动作。入账式 beetlePvpCredit 用【意向裸伤+crit】×镜像 def
        //  重算 vanilla 返回段真值——非本包 dmg 实扣值（防近似,见 notePendingMeleeHit 注①）。
        if ((m.flags & PlayerHurtFlags.Pvp) !== 0
          && (m.flags & PlayerHurtFlags.MeleeSource) !== 0) {
          const q = this.pendingMeleeHits.get(m.slot);
          if (q && q.length > 0) {
            const e = q.shift()!;
            // ★F-2 消费点硬闸：prune 仅定期跑（tick 每 fixedUpdate），两次扫描之间
            //  到达的回执须按登记时刻自证新鲜——exp≤now 一律丢弃。注意已过期的条目
            //  也照常 shift 出队（一帧一账配对纪律,注④）：只跳过充能,队列对齐关系不变,
            //  否则过期残项会把后续合法回执整体错位一格。
            if (e.exp > performance.now()) {
              const def = this.players.get(m.slot)?.pvpDefense;
              if (def !== null && def !== undefined) {
                this.onMeleePvpBeetleCredit?.(m.slot, beetlePvpCredit(e.base, e.crit, def), e.off);
              }
            }
          }
        }
        return;
      }
      case Msg.SscSync: {
        // v6 msg201：服务器角色档（--ssc）。**暂存不即用**——本帧与 PlayerSpawn 同批
        // 到达，onWorldReady→loadWorld 内部 await 让出栈后若立刻应用会写到即将被
        // 重建替换的旧 Player 上整体丢失（终审 H1）。由 Game 在 loadWorld 完成后消费
        this.pendingSSC = r.str();
        return;
      }
      case Msg.Ping:
        // 心跳回显：顺手测本端 RTT（面板"自己"行数据；旧语义"忽略"不变）
        this.rttMs = performance.now() - r.f64();
        return;
      default:
        return; // 未知跳过（对齐原版）
    }
  }

  /** Game 侧设置运行期世界引用（时间对齐用） */
  gameWorld: World | null = null;

  private readWorldData(r: NetReader): World {
    const time = r.f64();
    const dayCount = r.u32();
    const w = r.u16(), h = r.u16();
    const spawnX = r.i32(), spawnY = r.i32();
    const groundLevel = r.f32(), rockLevel = r.f32(), lavaLine = r.f32();
    const seed = r.i32();
    const name = r.str();
    const crimson = r.bool();
    const dungeonX = r.i32(), dungeonY = r.i32(), jungleX = r.i32();
    const flagCount = r.u16();
    const flags: Record<string, boolean> = {};
    for (let i = 0; i < flagCount; i++) flags[r.str()] = r.bool();
    const world = new WorldCtor(w, h, seed, name);
    world.clock.timeOfDay = time;
    world.clock.dayCount = dayCount;
    world.spawnX = spawnX; world.spawnY = spawnY;
    // 尾部追加字段(v8):spawnX0/spawnY0 原始出生点(床 RemoveSpawn 回退)——旧服
    // 无此两 i32 时 remaining 不足,回退当前 spawn
    if (r.remaining >= 8) { world.spawnX0 = r.i32(); world.spawnY0 = r.i32(); }
    else { world.spawnX0 = spawnX; world.spawnY0 = spawnY; }
    world.groundLevel = groundLevel; world.rockLevel = rockLevel; world.lavaLine = lavaLine;
    world.crimson = crimson;
    world.dungeonX = dungeonX; world.dungeonY = dungeonY; world.jungleX = jungleX;
    Object.assign(world.flags, flags);
    // ★IIIII228 seedFlags 尾段（v9 增量通道,不升版——同 spawnX0/spawnY0 v8 尾先例）：
    //  原版 msg7 以 bitsByte10[4..7]/bitsByte11[0..4]/bitsByte13[1..7] 携
    //  Main.remixWorld/tenth/dontStarve/notTheBees/getGood/zenith/dualDungeons 等
    //  彩蛋旗（NetMessage.cs:358-381 编码,MessageBuffer.cs:600-619 解码）——
    //  此前本仓 msg7 未发 seedFlags → 访客四旗全 off。降级矩阵：旧服无尾段 →
    //  remaining<2 跳过（缺省 {} = 旧行为）；新服发 → 旧客户端只读已知段,
    //  尾段随帧剩余被丢弃（FrameParser 按长度切帧）= 无害。
    if (r.remaining >= 2) {
      const sfCount = r.u16();
      const sf: Record<string, boolean> = {};
      for (let i = 0; i < sfCount; i++) sf[r.str()] = r.bool();
      world.seedFlags = sf as typeof world.seedFlags;
    }
    // 请求出生点周围 section（对齐原版 msg8）
    this.send(new NetWriter(Msg.SpawnTileData).i32(spawnX).i32(spawnY).finish());
    return world;
  }

  // ================= tile 上报（TileStore.netReporter → 队列 → 每 tick 冲洗） =================

  /** TileStore.netReporter 注入点；netSuppress 期间（应用远端操作）不收集 */
  /** ★TE net sync(2026-10-14,module16):host 快照上行(server 镜像+全房广播)。
   *  ★R-B-1:分批发送(writeTEModuleBatched——单帧 65535B 超限曾熔断 host)。
   *  ★R-B-4:恒发(含 0 条快照——末 TE 摘除的清空语义;空帧 ~7B 每 2s 可忽略) */
  sendTEModule(entries: import('./syncModules').TENetEntry[]): void {
    if (!this.active) return;
    for (const frame of writeTEModuleBatched(entries)) this.send(frame);
  }

  reportTileOp(op: TileOp) {
    if (!this.active) return;
    if (this.tileQueue.length >= 256) {
      // R4：超限不再静默丢（静默分叉不可恢复）——告警后仍丢但留下痕迹
      if (!this._overflowWarned) {
        this._overflowWarned = true;
        console.warn('[net] tile 上报队列溢出（单 tick >256 op），丢弃后续——本地与远端将分叉');
      }
      return;
    }
    this.tileQueue.push(op);
  }
  private _overflowWarned = false;

  /** Game 每 fixedUpdate 调用：冲洗 tile 队列 + 玩家状态上报（变化驱动 + 66ms 节流） */
  tick() {
    if (!this.active) return;
    this.decayProxyImmune();
    this.pruneMeleeReceipts(performance.now());   // ★F14 回执窗 TTL 扫描
    this.syncInventory(performance.now());
    this.syncHp();
    this.flushPending(); // P1.3 msg21 合帧冲洗
    this.flushLiquidChanges(); // module0 液体 60ms 节流
    if (this.tileQueue.length) {
      // 每包最多 64 op（防超帧）
      const batch = this.tileQueue.splice(0, 64);
      const w = new NetWriter(Msg.TileBatch);
      w.u16(batch.length);
      for (const o of batch) {
        w.u8(o.a);
        w.i32(o.x); w.i32(o.y);
        w.u16(o.v & 0xffff);
        if (o.a === TileOpAction.SetTile) { w.u16(o.fx); w.u16(o.fy); }
      }
      this.send(w.finish());
    }
    this.sendPlayerState();
  }

  private sendPlayerState(force = false) {
    // v2 布局（对齐原版 msg13）：控制位 + position(碰撞盒左上) + velocity。
    // 远端据此跑本地物理 → 有移动过程；位置差由接收端 netOffset 平滑（瞬移消失）
    const p = this.game.player as unknown as {
      x: number; y: number; vx: number; vy: number; facing: number; dead: boolean;
      inputX: number; inputJump: boolean; inputDown: boolean; inputUp: boolean;
      inv: { heldItem(): { id: number } | null };
    };
    const inp = (this.game as { input?: { mouseDown: boolean; rightDown: boolean } }).input;
    // ctrlBits: [0]up [1]down [2]left [3]right [4]jump [5]useItem [6]direction（原版 case 13）
    // useItem = 左键按住（原版 controlUseItem；放置/右键交互不计）
    const ctrl = (p.inputUp ? 1 : 0) | (p.inputDown ? 2 : 0)
      | (p.inputX < 0 ? 4 : 0) | (p.inputX > 0 ? 8 : 0)
      | (p.inputJump ? 16 : 0)
      | (inp?.mouseDown && !inp.rightDown ? 32 : 0)
      | (p.facing > 0 ? 64 : 0);
    // selectedItem = 快捷栏槽位索引 0-9（原版 NetMessage.cs:471 语义；v1 误发物品 id）
    const sel = (p.inv as unknown as { selected: number }).selected & 0xff;
    // 控制位变化即时发（原版 TrySyncingInput Player.cs:6484：任一 control/selectedItem
    // 变化立刻 SendData(13)）——原地起跳这类"位置未动"的操作不再等静止心跳
    const ctrlChanged = ctrl !== this.lastSentCtrl || sel !== this.lastSentSel || p.dead !== this.lastSentDead
      || (p as unknown as { sleeping: boolean }).sleeping !== this.lastSentSleep;   // 躺床切换即时发(原版 Start/StopSleeping SendData(13))
    const now = performance.now();
    const moved = Math.abs(p.x - this.lastSentPos.x) > 1 || Math.abs(p.y - this.lastSentPos.y) > 1;
    const pvpChanged = this.lastSentHostile !== this.game.player.hostile || this.lastSentTeam !== this.game.player.team;
    if (!force && !pvpChanged && !ctrlChanged) {
      if (!moved && now - this.lastStateSent < 1000) return; // 静止 1s 心跳（原版 %420 全量兜底的简化版）
      if (now - this.lastStateSent < 66) return;             // 位置驱动节流 ≥66ms（≈15Hz）
    }
    this.lastStateSent = now;
    this.lastSentPos = { x: p.x, y: p.y };
    this.lastSentCtrl = ctrl;
    this.lastSentSel = sel;
    this.lastSentDead = p.dead;
    this.lastSentHostile = this.game.player.hostile;
    this.lastSentTeam = this.game.player.team;
    // flagBits: [0]sleeping(原版 bitsByte26[0]) [2]hasVelocity [5]hasCameraTarget(刀D,注k)
    // [6]ghost [7]hostile(v7)；尾部 u8 team(0-5) + [f32 camX,camY 若 flagBits[5]]
    const gp = this.game.player as unknown as { hostile: boolean; team: number };
    this.lastSentSleep = (p as unknown as { sleeping: boolean }).sleeping;
    const cam = this.pendingCamTarget;
    const flag = 4 | ((p as unknown as { sleeping: boolean }).sleeping ? 1 : 0)
      | (p.dead ? 64 : 0) | (gp.hostile ? 128 : 0)
      | (cam ? 32 : 0);
    // ★刀D 尾段（位置序在 team 段后,PROTO 注 k）：原版 msg13 在 bitsByte24[5] 置位后
    // 条件写 Vector2 netCameraTarget（NetMessage.cs:507-509,世界 px 坐标）。
    // 接收端 remaining>=8 门：旧 server 中继剥尾但 flag 位原样过墙 → 位在段不在=拒读不错位
    const w = new NetWriter(Msg.PlayerState)
      .u8(this.mySlot)
      .u8(ctrl).u8(flag)
      .u8(sel)
      .f32(p.x).f32(p.y)
      .f32(p.vx).f32(p.vy)
      .u8(Math.max(0, Math.min(5, gp.team)));
    if (cam) w.f32(cam.x).f32(cam.y);
    this.send(w.finish());
    // 原版 OnControlsSynced（Player.cs:55090-55092）：每次 msg13 序列化尾
    // lastSyncedNetCameraTarget = netCameraTarget——发送门比较基准随之刷新
    this.lastSyncedCamTarget = cam;
  }

  /** PvP 姿态变化即时上报（msg13 心跳之外快速通道：hostile/team 翻转立刻同步） */
  sendPvpState() { this.sendPlayerState(true); }

  // ================= PvP 免疫余量镜像（msg16 尾段；2026-08-30 批） =================
  // 原版单进程里 ItemCheck_MeleeHitPVP 攻端门禁串直接读 Main.player[victim].immune
  // （1457 Player.cs:44429「|| player.immune ||」——1456 :43407 同式,公开免疫布尔旗,
  // Player.cs :1403 定义）。victim-settles 架构下攻端无该态 → 以 msg16 尾段把被击端
  // 的 General 冷却余量（=immuneTime,PvP 受击窗 8t/常规 40t/复活 SpawnImmune 300t）
  // 回传、本地每 tick 衰减成镜像，GA 在攻端门串以 getProxyPvpImmuneRemaining>0 置入。
  // 降级矩阵（两方向）：旧 server 中继剥尾 → 镜像收不到值 = 恒 0 = 不拦（改动前
  // 行为）；新客户端→旧 server→新客户端同路退化。旧端帧无尾段时不重置既有镜像
  // （防混合环境抖动清零），永续残留不存在——衰减是唯一的 0 化路径。

  /** 镜像衰减（tick() 每 fixedUpdate 调一次；1 call = 1 游戏 tick，与原版
   *  immuneTime-- 节拍对齐）。有向误差只剩包延迟级（<100ms），且只作用于
   *  「免疫刚结束的窗口」——保守侧偏差，与原版攻端先于 victim 结算读态的时序同型 */
  private decayProxyImmune() {
    for (const p of this.players.values()) {
      if (p.pvpImmuneT > 0) p.pvpImmuneT--;
    }
  }

  /** 攻端消费 API：远端玩家 PvP 免疫余量（tick）。
   *  GA 门串置入契约：`net.getProxyPvpImmuneRemaining(slot) > 0` ⇔ 原版
   *  `player.immune == true`（1457 :44429 门禁串的同构支——置 continue 位，
   *  整条命中体跳过：StatusToPlayerPvP/Hurt/OnHit/beetle 蓄能一并不达）。
   *  自身 slot 与未知 slot 一律 0（未知=不可命中对象,由调用方先行过滤）。 */
  getProxyPvpImmuneRemaining(slot: number): number {
    return this.players.get(slot)?.pvpImmuneT ?? 0;
  }

  /** 被击端结算即时补报钩子（GA 在扣血结算回调后调用——含闪避/免伤早退路径）：
   *  强制下一次 syncHp 绕过全部节流窗（200ms 变化窗 + 5s 满血心跳）立即携带新鲜
   *  iframes 上行。原版在同一结算尾无条件连发 msg13/msg16/msg117 三包
   *  （Player.cs:38658-38661 netMode==1 && !quiet 段），本仓拆面后以此钩子保住
   *  「免疫态与伤害同帧可见」的时序——尤其闪避路径 hp 不变、无此钩会被心跳吞；
   *  不调用则退化到 hp 变化驱动的节流上行（实扣路径多数仍即时——必变 hp） */
  private pvpImmuneHintPending = false;
  notifyPlayerHurtSettled() {
    this.pvpImmuneHintPending = true;
    this.lastHpAt = 0;
  }

  // ================= ★F14 甲虫攻套 PvP 蓄能·回执关联制（2026-08-31 清零批四） =================
  // 判例锚：ItemCheck_MeleeHitPVP :44434-44460 —— 攻机同帧 `int num2=(int)player.Hurt(
  // ByPlayer,num,direction,pvp:true,quiet:false,flag)` 后 `if(beetleOffense){ beetleCounter
  // += num2; beetleCountdown = 0; }`。victim-settles 架构下该同步返回不可达（F14 BLOCKER),
  // 收敛方案 = 回执关联制：意向端登记未决挥击 → 被击端实扣广播 msg117(Pvp 位) 到包消费。
  // ★F-1（四轮蓝队）：消费门再加 MeleeSource 位（近战支独置,PROTO 注 h)）——vanilla
  // 五条 PvP 结算支只有近战支记 beetleCounter,Pvp-only 门会让爆炸/狱火/盾转移/PvP 弹
  // 的飘字帧抽队错配充能（新发明近似,已封）。
  // ★F14 定谳要点（防止再发明「近似」）：
  //  ① 入账值【不是】被击者实扣 HP —— Hurt 对 pvp:true 在【返回前】整体重算
  //     num2 = CalculateDamagePlayersTakeInPVP(num×(crit?2:1), statDefense)
  //     （:38862-38868 + Main.cs:67136-67143：Dmg−Def×0.5,min1;无难度乘区/无 endurance/
  //     无闪避早退面——那三者在重算发生前已定型于各自分支）。crit 的 ×2 只经重算段进入
  //     返回值（与 GA-F2 勘误注一致），因此致敌致死（实扣被残血钳小）时 vanilla 反而按
  //     全额公式入账——feed「117 实扣值」=系统性欠账（暴击全漏 ×2、高防/击杀态大偏），
  //     为本实现明确规避的新近似形态。
  //  ② 式中唯一攻端不可知输入 = 受方 statDefense → 由 msg16 第三尾段镜像上行
  //     （RemotePlayerState.pvpDefense；新鲜度语义 = 原版攻端 Main.player[远端].statDefense
  //     本地代理同层——都滞后一个状态批次，且结算强制位保证命中瞬间一帧内有新鲜 hp 包在途）。
  //  ③ 同挥多目标聚合：pending 按 victimSlot 独立成键，各目标回执乱序到达互不干扰。
  //  ④ 同目标二次命中窗口交叠：per-slot FIFO 队列，先受理先出账（每个 117 只消费一条）。
  //  ⑤ 迟到包 = TTL 丢弃窗（MELEE_RECEIPT_WINDOW_MS，tick 每 fixedUpdate 扫队头过期剔除；
  //     队内单调到期 ⇒ 头扫即完备）。原版攻机累计发生在同一世界步内、不存在「迟到」概念；
  //     网络化后的必然相位滞后 <RTT，正常链路远小于窗口。过期丢弃的语义等价性说明：
  //     丢弃只可能损失本端合法账目（保守侧欠计——被击端 flash 免疫/断流导致的意图丢失同因
  //     也不产生任何 117），不会把他人伤害记进自己的壳；窗口上限同时封住「他人对我未决目标
  //     的同期 PvP 命中被错配到自己头上」的面——两全由窗口宽度折衷（2000ms 覆盖最劣抖动,
  //     错配暴露面≈竞技场混战中同人 2 秒双打，量级受击者双方 damage 波动 ±1 档，登记残余）。

  /** 回执等待窗（ms）；见上⑤。私有字段保留可注入性（测试驱动加速时钟用入口为主） */
  private MELEE_RECEIPT_WINDOW_MS = 2000;

  /** 未决近战挥击（victimSlot → FIFO{意向裸伤,crit位,攻端攻套在身钉值,到期时刻}）。
   *  off 攻套钉于【受理瞬间】——与原版 ：44456 的求值位次同源（beetleOffense 门挂
   *  在产生这笔 rawDmg 的同一挥击上,且猛攻套 dmg 乘区本就参与了该裸伤的构成）。 */
  private pendingMeleeHits = new Map<number, Array<{ base: number; crit: boolean; off: boolean; exp: number }>>();

  /** F14 回执闭环 sink：Game 在甲虫蓄能区受理命中时安装（每次重装=重绑当前
   *  player 对象，防重装世界后闭包持陈旧实例；幂等且命中频度受 msg44 频闸约束）。
   *  未安装 = 关联结果静默丢弃（对未接 meter 的消费方零影响）。 */
  onMeleePvpBeetleCredit?: (victimSlot: number, credit: number, offenseSet: boolean) => void;

  /** 近战 PvP 受理命中意向登记（Game 近战 PvP 区调用；异常防御静默吞脏数据）。
   *  ★F-3①：不再设 min(9999) 上帽——vanilla Damage 形参无帽（Hurt/返回段重算
   *  全链 int 直通;唯一 9999 字面量在 :38625 圣骑士盾转移分支,与本域无关），自设
   *  帽=新发明近似。数值天然受 msg44 线格 i16 域约束（±32767,编码层自然上限，
   *  超界值过不了线根本到不了这里）；base≤0 脏数据照旧静默吞。 */
  notePendingMeleeHit(victimSlot: number, rawDmg: number, critFlag: boolean, offenseSet: boolean): void {
    if (victimSlot === this.mySlot || victimSlot < 0) return;
    const base = Math.trunc(rawDmg);
    if (!(base > 0)) return;
    const q = this.pendingMeleeHits.get(victimSlot) ?? [];
    q.push({ base, crit: critFlag === true, off: offenseSet === true,
      exp: performance.now() + this.MELEE_RECEIPT_WINDOW_MS });
    this.pendingMeleeHits.set(victimSlot, q);
  }

  /** 过期队头清扫（tick 每 fixedUpdate；FIFO 单调到期 ⇒ 只扫队头即完备） */
  private pruneMeleeReceipts(nowMs: number): void {
    for (const [slot, q] of this.pendingMeleeHits) {
      let head = 0;
      while (head < q.length && q[head].exp <= nowMs) head++;
      if (head === 0) continue;
      if (head === q.length) this.pendingMeleeHits.delete(slot);
      else q.splice(0, head);
    }
  }

  private lastSentCtrl = -1;
  private lastSentSel = -1;
  private lastSentDead = false;
  private lastSentSleep = false;   // msg13 flagBits[0] 躺床位(变化即时发)
  private lastSentHostile = false;
  private lastSentTeam = 0;

  // ---- ★X4 清偿刀D：netCameraTarget 面（原版 Player.netCameraTarget/lastSyncedNetCameraTarget,
  //      Player.cs:1607-1608;写位 Main.UpdateCameraPan :63633-63650,发送门 :63671-63676）----
  /** 本拍相机目标（Game.fixedUpdate 相机段以 GetObjectTrackingCameraPan 三域结果
   *  调用 notifyCameraTarget 写入;null=无跟踪——原版 UpdateCameraPan 头每帧先置 null 同相） */
  private pendingCamTarget: { x: number; y: number } | null = null;
  /** 最近一次随 msg13 上行的相机目标（原版 OnControlsSynced :55090-55092 在每次 msg13
   *  序列化时 lastSyncedNetCameraTarget=netCameraTarget——本仓在 sendPlayerState 构帧位同相记账） */
  private lastSyncedCamTarget: { x: number; y: number } | null = null;

  /** netCameraTarget 写+发送门（原版 Main.cs:63671-63676 每帧在 UpdateCameraPan 尾执行）：
   *  门 = HasValue 翻转 ∨ 双有值且位移>160px → 立即 SendData(13)（bypass 全部节流,
   *  原版语义;≤160px 的增量随常规 msg13 心跳/控制位即时包携带,位与值每包恒新鲜）。
   *  单机零影响:net 未激活直接返回（原版 netMode==0 下 SendData 内部早退同相）。 */
  notifyCameraTarget(t: { x: number; y: number } | null): void {
    if (!this.active) return;
    this.pendingCamTarget = t;
    const flipped = (t === null) !== (this.lastSyncedCamTarget === null);
    const moved = t !== null && this.lastSyncedCamTarget !== null
      && Math.hypot(t.x - this.lastSyncedCamTarget.x, t.y - this.lastSyncedCamTarget.y) > 160;
    if (flipped || moved) this.sendPlayerState(true);
  }

  // ================= 箱子同步（msg31/32，服务器权威） =================

  /** 请求打开箱子（interactAt 未命中本地 chests 时——访客本地无箱数据） */
  requestChestOpen(x: number, y: number) {
    this.send(new NetWriter(Msg.RequestChestOpen).i32(x).i32(y).finish());
  }

  /** 槽位编辑上报（每槽一条消息；服务器权威+广播，编辑者本地已乐观生效） */
  sendChestSlot(chestIdx: number, x: number, y: number, slot: number, itemId: number, stack: number, prefix = 0) {
    const w = new NetWriter(Msg.SyncChestItem);
    w.u16(chestIdx); w.i32(x); w.i32(y);
    w.u16(1);
    w.u8(slot); w.u16(itemId); w.u16(stack);
    w.u8(prefix);   // ★R16-13：尾段 prefix（原版 msg32 NM57:865-878 stack→prefix→type 同域）
    this.send(w.finish());
  }

  /** 本地登记的箱子 → 同步槽位号（Game 注册；diff 轮询用） */
  chestIndexByPos = new Map<string, number>();

  /** msg80 在用箱镜像（SW-FX42）：slot → chestIdx。原版 Main.player[slot].chest 的
   *  客户端侧等价（进房补发/开关箱广播维护）——消费面登记见 multiplayer-design.md
   *  §SW-FX42（现役=拒绝匹配；Wiring.cs:2571/:2667 在用门为未来消费位） */
  chestOpenByPlayer = new Map<number, number>();

  /** 他端是否正占用世界箱 chestIdx（本地镜像查询；-1/无记录=空闲） */
  isChestInUseByOther(chestIdx: number): boolean {
    for (const [slot, idx] of this.chestOpenByPlayer) {
      if (slot !== this.mySlot && idx === chestIdx) return true;
    }
    return false;
  }

  /** ★BJ69（2026-09-14）改名段闩锁 = 原版 Player.editedChestName 语义（Player.cs:1425
   *  声明;置位=ChestUI.RenameChestSubmit :851-853;消费=:33141-33145/:33355-33359 关箱/
   *  换箱拍 `if (editedChestName) SendData(33, ..., chest, 1f)`——改名段随【下一条
   *  msg33】上行后清位）。UI 提交改名 → 本端 chest.name 已本地写 → latch(name);
   *  尾段写语义 = NetMessage.cs:895-905（num24=nameLen;0/超 20 → 255 清名;1..20 随名串,
   *  本端 20 字符钳在 UI 层 maxLength 承担）。施加对象=发送者在用箱（room 侧
   *  MessageBuffer.cs:1962 域,非本帧 idx——改名者先改名后关箱,两帧序）。 */
  private pendingChestRename: string | null = null;

  chestRenameLatch(name: string): void {
    this.pendingChestRename = name;
  }

  /** 开/关箱公告（msg33,C→S；SW-FX42）：chestIdx=-1=关闭。原版 Player.OpenChest 尾
   *  SendData(33,...)（NetMessage.cs:880-902 写面）——服务器据此维护每玩家在用箱
   *  并广播 msg80。仅世界箱（x>=0）公告;随身储蓄族（x<0）原版不在 Main.chest 域。
   *  ★BJ69：闩锁改名段随帧尾上行（num24 语义 1:1;room 侧 readChestRenameTail 受理,
   *  施加对象=发送者在用箱——idx=-1 关箱帧先改后关,Room 记账序=原版 :1962 前）。 */
  sendChestOpenState(chestIdx: number, x: number, y: number, closing: boolean) {
    const w = new NetWriter(Msg.ChestOpenState)
      .i16(closing ? -1 : Math.max(0, Math.min(0x7fff, chestIdx)))
      .i32(x).i32(y);
    if (this.pendingChestRename !== null) {
      const rename = this.pendingChestRename;
      this.pendingChestRename = null;
      if (rename.length === 0 || rename.length > CHEST_NAME_MAX) w.u8(CHEST_NAME_CLEAR);   // :899-903
      else w.u8(rename.length).str(rename);                                                 // :905 Write(text2)
    }
    this.send(w.finish());
  }

  // ================= 渔夫任务/季节位（module15,SW-FX42；见 net/syncModules.ts） =================

  /** sub0 任务断言（msg74 等价,仅权威端=房主调用）——服务器记态 + 排除发送者广播 */
  sendAnglerQuestAssert(quest: number) {
    this.send(writeAnglerQuestModule(AnglerQuestSub.Quest, quest));
  }

  /** sub1 交付上行（msg75 等价,Main.cs:40948 SendData(75) 同位）——本端已本地置旗 */
  sendAnglerFinishedClaim() {
    this.send(writeAnglerQuestModule(AnglerQuestSub.Finished, this.mySlot));
  }

  /** sub2 季节强置位断言（仅权威端调用；msg7 bitsByte9[6]/[7] 等价承载面） */
  sendSeasonAssert(bits: number) {
    this.send(writeSeasonBitsModule(bits));
  }

  private applyRemoteChest(r: NetReader) {
    const chestIdx = r.u16();
    const x = r.i32(), y = r.i32();
    const n = r.u16();
    // ★R16-13：prefix 尾段兼容门——旧端每条 5 字节（1+2+2）,新端 6 字节
    const withPrefix = r.remaining >= n * 6;
    const items: Array<{ id: number; stack: number; prefix?: number } | null> = [];
    for (let i = 0; i < n; i++) {
      const slot = r.u8(), itemId = r.u16(), stack = r.u16();
      const prefix = withPrefix ? r.u8() : undefined;
      items[slot] = itemId ? { id: itemId, stack, prefix } : null;
    }
    // ★SW-FX52-R12 定谳：箱名不走本帧尾段——`withPrefix` 兼容门按帧尾余量判
    //  5/6 字节条目,追名尾段会引入位面歧义（小 n 时翻转前缀门=条目错位）。
    //  名字统一走 msg69 ChestName 专帧（onChestName 钩）
    this.hooks.onChestSync?.(chestIdx, x, y, items);
  }

  /** 外观变更后重发 SyncPlayer（进游戏后 applyCharacter 调用——初始两发都在外观应用前）；
   *  hairDye 一并携带（染料使用后 Game 侧调用，远端发色/派对彩纸实时生效）。
   *  守卫只看连接态——appearance 缺失（裸加入流程无角色档）也发 {hairDye}，
   *  原版 msg4 PlayerInfo 本就无条件发（探针实测旧守卫会静默吞掉染料重发） */
  resendAppearance() {
    if (!this.active || this.mySlot < 0) return;
    const p = this.game.player as { appearance?: unknown; hairDye?: number } | undefined;
    this.send(new NetWriter(Msg.SyncPlayer).u8(this.mySlot)
      .str(JSON.stringify({ ...((p?.appearance as Record<string, unknown>) ?? {}), hairDye: p?.hairDye ?? 0 })).finish());
  }

  /** 进场组装期暂存的拴绳实体帧冲放（Game 在 loadWorld 完成后调用，同 pendingSSC 时机） */
  drainPendingLeashed(cb: (msg: LeashedNetMsg) => void) {
    while (this.pendingLeashed.length) cb(this.pendingLeashed.shift()!);
  }

  // ================= 远端 tile 应用（回环抑制 + 事件链触发） =================

  private applyRemote(ops: TileOp[]) {
    const st = this.gameWorld?.store;
    if (!st) return;
    st.netSuppress = true;
    try {
      for (const o of ops) {
        if (o.x < 0 || o.y < 0 || o.x >= st.w || o.y >= st.h) continue;
        switch (o.a) {
          case TileOpAction.SetTile: st.setTile(o.x, o.y, o.v, o.fx, o.fy); break;
          case TileOpAction.SetWall: st.setWall(o.x, o.y, o.v); break;
          case TileOpAction.SetHalfBrick: st.setHalfBrick(o.x, o.y, !!o.v); break;
          case TileOpAction.SetSlope: st.setSlope(o.x, o.y, o.v); break;
          case TileOpAction.SetActuated: st.setActuated(o.x, o.y, !!o.v); break;
          case TileOpAction.SetWire: st.setWire(o.x, o.y, o.v); break;
        }
      }
    } finally {
      st.netSuppress = false; // R5：异常安全复位（否则 suppress 永久卡死上报）
    }
  }

  /** NPC 开关门即时事件上行（msg19 等价）：仅 NPC 模拟端 = 房主发送 */
  sendDoorEvent(kind: 'door' | 'gate', x: number, y: number, closing: boolean, dir: number) {
    if (!this.active || !this.policy.isHost) return;
    this.send(writeDoorEvent({ gate: kind === 'gate', closing, x, y, dir }));
  }

  // ================= v3 实体同步（msg16/21/23/27/42，房主权威+服务器中继） =================

  /** NPC 快照（msg23） */
  sendNpcSnapshot(snaps: NpcSnap[]) {
    if (!snaps.length) return;
    const w = new NetWriter(Msg.SyncNPC);
    w.u16(snaps.length);
    for (const s of snaps) {
      w.u32(s.netId); w.str(s.key);
      w.f32(s.x); w.f32(s.y); w.f32(s.vx); w.f32(s.vy);
      w.i16(s.hp); w.i16(s.maxHp);
      w.u16(s.animT & 0xffff);
      w.u8(s.flags);
    }
    // 刺球锚点【帧级】尾段（{u16 anchorCount,[u32 netId,f32 ai1,f32 ai2]×anchorCount}）。
    // ★必须在条目循环【后】：旧 server 按定长条目推进且无长度校验，条目内携带会让
    // 带锚条目后的 8 字节被当下一条 netId 消费=后续条目全部错位（垃圾条目转发或
    // RangeError 丢整批）——旋转游标扫批下带锚条目未必是末条，不能赌（终审定谳）。
    // 帧级残余旧端整帧丢弃=安全。有锚条目才附（无锚帧与 v4 字节全同）
    const anchors = snaps.filter((s) => s.ai1 !== undefined && s.ai2 !== undefined);
    if (anchors.length) {
      w.u16(anchors.length);
      for (const s of anchors) { w.u32(s.netId); w.f32(s.ai1!); w.f32(s.ai2!); }
    }
    this.send(w.finish());
  }

  /** 掉落物操作（msg21；微光态升格原版 msg145 SyncItemsWithShimmer——NetMessage.cs:88-92
   *  `shimmerTime>0||shimmered` → 附 Write(shimmered)+Write(shimmerTime)）：
   *  op 0=spawn / 1=take / 2=despawn。P1.3 上行合帧：入 pending 攒批（netDropSweep
   *  每 4 tick 可能逐条几十发），tick() 冲洗时拼为单条 WS 消息；满 64 帧立即冲防延迟 */
  sendItemOp(op: 0 | 1 | 2 | 3, netId: number, key = '', stack = 0, x = 0, y = 0, vx = 0, vy = 0,
    shimmered = false, shimmerTime = 0, prefix = 0) {
    // op3=残余上报（他端部分拾取我们的掉落后把余量报回，形状与 spawn 同——
    // 拥有端据此更新真身，防重 assert 回灌陈旧全量）
    const w = new NetWriter(Msg.SyncItem);
    w.u32(netId); w.u8(op);
    if (op === 0 || op === 3) {
      w.str(key); w.u16(stack);
      w.f32(x); w.f32(y); w.f32(vx); w.f32(vy);
      if (shimmered || shimmerTime > 0) { w.u8(1); w.f32(shimmerTime); }
      // ★BJ390：词缀尾段（原版 msg21 逐 byte 同步 prefix,MessageBuffer.cs:1476）——
      // 仅非 0 携带,接收端按 r.remaining>=1 兼容门尾读（旧发送端流上无残留）
      if (prefix) w.u8(prefix);
    }
    this.pendingFrames.push(w.finish());
    if (this.pendingFrames.length >= 64) this.flushPending();
  }

  /** 冲洗 pending 合帧：多帧拼接为一条 WS 消息（§1.1 允许一 WS 消息串联多帧） */
  private flushPending() {
    if (!this.pendingFrames.length || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingFrames.length = 0;
      return;
    }
    let total = 0;
    for (const f of this.pendingFrames) total += f.length;
    const joined = new Uint8Array(total);
    let off = 0;
    for (const f of this.pendingFrames) { joined.set(f, off); off += f.length; }
    this.pendingFrames.length = 0;
    this.ws.send(joined);
  }

  /** 弹幕快照（msg27，双向：各自弹幕互播） */
  sendProjectileBatch(snaps: ProjSnap[]) {
    if (!snaps.length) return;
    const w = new NetWriter(Msg.SyncProjectile);
    w.u16(snaps.length);
    for (const s of snaps) {
      w.u32(s.netId); w.u8(s.kind); w.str(s.tag);
      w.i16(s.dmg); w.i16(s.aux);
      w.f32(s.x); w.f32(s.y); w.f32(s.vx); w.f32(s.vy);
    }
    this.send(w.finish());
  }

  /** 弹幕消亡上报（v6 msg28，双向）：自己拥有的弹幕消亡时批量上报，
   *  接收端即时移除傀儡（替代纯 180t 超时清扫——消幽灵弹窗口 + 消亡闪烁）。
   *  终审 L2：服务器 n>64 整包拒——分片成 ≤64 的多帧，防大清场丢尾 */
  sendProjDespawn(netIds: number[]) {
    for (let i = 0; i < netIds.length; i += 64) {
      const chunk = netIds.slice(i, i + 64);
      const w = new NetWriter(Msg.ProjDespawn);
      w.u16(chunk.length);
      for (const id of chunk) w.u32(id);
      this.send(w.finish());
    }
  }

  /** 傀儡受击上报（msg42，访客→房主；Enemy.hurt 内经 entityNet 注入调用） */
  sendStrike(netId: number, rawDmg: number, kbx: number, kby: number, crit?: boolean) {
    this.send(new NetWriter(Msg.StrikeNPC).u32(netId).i16(rawDmg).f32(kbx).f32(kby).u8(crit ? 1 : 0).finish());   // BJ723-B D5 清偿（BJ725-A）：尾部 u8 crit
  }

  /** PvP 近战命中意向上报（v7 msg44，C→S→定向转发被击者；权威=被打方本地结算）。
   *  weaponId 为凶器内部物品 id（死因文案 DeathSource.Player {2} 用）；
   *  flags bit0=crit / bits1-4=武器浸剂 meleeEnchant（被击端 StatusPvP 消费） */
  sendStrikePlayer(targetSlot: number, rawDmg: number, kbx: number, kby: number, weaponId: number, flags: number) {
    this.send(new NetWriter(Msg.StrikePlayer).u8(targetSlot).i16(rawDmg)
      .i16(kbx).i16(kby).u16(weaponId).u8(flags & 0xff).finish());
  }

  /** 被击端实扣权威飘字广播（msg117 PlayerHurt；2026-08-30 批）。
   *  GA 调用契约：仅「扣血成功且非闪避/免伤早退」路径发（damagePlayer 返回实扣
   *  ok>0 的 pvp 命中族）——参数直接来自结算值：
   *    net.sendPlayerHurt(ok, p.cx, p.cy, Math.sign(p.cx - srcX) || 1,
   *      PlayerHurtFlags.Pvp | (crit ? PlayerHurtFlags.Crit : 0));
   *  dmg=实扣终值（hp 减量）;crit/pvp 位决定接收端飘字样式（金 crit/常规红）。
   *  发送前宜 notifyPlayerHurtSettled() 清 msg16 节流窗（原版三连包时序等价）。
   *  旧 server 对未知号整包忽略 = 其他端看不到飘字（降级安全） */
  sendPlayerHurt(dmg: number, x: number, y: number, dir: number, flags: number) {
    if (this.mySlot < 0) return;
    this.send(writePlayerHurt({ slot: this.mySlot, dmg, x, y, dir, flags }));
  }

  /** 聊天发送（msg82 module1）：text + 尾部 u8 channel + channel0 随附 RGB。
   *  channel 0=房间（RGB=Player.ChatColor 难度色——白/中橙(255,153,0)/硬红
   *  (255,38,25);旧 server 忽略尾段回退金色）/ 1=世界频道（跨房全服,v8 批） */
  sendChat(text: string, world = false) {
    const w = new NetWriter(Msg.NetModules);
    w.u16(NetModule.Text);
    w.str(text);
    w.u8(world ? 1 : 0);
    if (!world) {
      const c = this.chatColor();
      w.u8(c[0]); w.u8(c[1]); w.u8(c[2]);
    }
    this.send(w.finish());
  }

  /** 命令系统行广播（channel 2）：服务器以 slot=255 无名前缀 + 随附 RGB 中继
   *  ——聊天命令（/roll 等）的执行结果行,发起端已本地回显故广播排除发送者 */
  sendCommandLine(text: string, r: number, g: number, b: number) {
    const w = new NetWriter(Msg.NetModules);
    w.u16(NetModule.Text);
    w.str(text);
    w.u8(2);
    w.u8(r); w.u8(g); w.u8(b);
    this.send(w.finish());
  }

  /** 队伍频道（channel 3）：服务器按发送者 msg13 team 定向同队广播（队伍色） */
  sendParty(text: string) {
    const w = new NetWriter(Msg.NetModules);
    w.u16(NetModule.Text);
    w.str(text);
    w.u8(3);
    this.send(w.finish());
  }

  /** 玩家表情广播（msg120，M4）：服务器校验范围后中继 {slot, emoteId}，
   *  各端在对应玩家代理头顶出泡（原版 C→S 120 → 服务器 msg91 全体广播） */
  sendEmote(emoteId: number) {
    this.send(new NetWriter(Msg.EmoteBubble).u8(emoteId).finish());
  }

  /** 树妖星露谷彩蛋广播（msg144）：载荷空，服务器中继排除发送者
   *  （原版 DryadText_Do_StardewValleyBit netMode==1 分支 SendData(144)） */
  sendDryadStardewAnim() {
    this.send(new NetWriter(Msg.DryadStardew).finish());
  }

  // ================= MP 同步轻件包（net/syncModules.ts：module0/2/4/7 + msg203） =================

  /** 本端 RTT（Msg.Ping 回显差分，ms；Infinity=尚未测得） */
  rttMs = Infinity;
  /** 全房 RTT 表（msg203 探针携带；slot → ms。旧服务器无探针 → 恒空,面板显示"-"） */
  playerPings = new Map<number, number>();

  /** 液体变化格收集（LiquidSim.netChangeSink / 桶操作 listener → 此处；60ms 节流冲放） */
  private liquidNetSet = new Map<number, { x: number; y: number }>();
  private lastLiquidFlushAt = 0;

  /** 液体变化上报入口（权威端模拟变化 / 任意端桶操作均经此收集） */
  reportLiquidChange(x: number, y: number) {
    this.liquidNetSet.set(packLiquidCoord(x, y), { x, y });
  }

  /** 60ms 节流冲放（tick() 调用；值在发送时刻读权威 store——原版 Serialize 同语义） */
  flushLiquidChanges() {
    if (!this.liquidNetSet.size || !this.gameWorld) return;
    const now = performance.now();
    if (now - this.lastLiquidFlushAt < 60) return;
    this.lastLiquidFlushAt = now;
    const st = this.gameWorld.store;
    const cells: LiquidCell[] = [];
    for (const p of this.liquidNetSet.values()) {
      if (!st.inBounds(p.x, p.y)) continue;
      const i = st.idx(p.x, p.y);
      cells.push({ x: p.x, y: p.y, liquid: st.liquid[i], liquidType: st.liquidType[i] });
    }
    this.liquidNetSet.clear();
    for (let off = 0; off < cells.length; off += LIQUID_CELLS_PER_FRAME) {
      this.send(writeLiquidModule(cells.slice(off, off + LIQUID_CELLS_PER_FRAME)));
    }
  }

  /** 地图 ping 上报（原版 TriggerPing Main.cs:56016-56022：本地 Pings.Add 由
   *  Game 承担，netMode==1 时 SendToServer——本仓 net 活跃即等价） */
  sendMapPing(x: number, y: number) {
    this.send(writeMapPing(x, y));
  }

  /** 图鉴事件上报（杀=权威端携累计值；遇/聊=首次观察端） */
  sendBestiaryEvent(e: BestiaryNetEvent) {
    this.send(writeBestiaryModule([e]));
  }

  /** 晶塔消息（房主差集广播 sub0/1 · 访客传送请求 sub2 · 房主门禁回执 sub3） */
  sendPylonMessage(msg: PylonNetMsg) {
    this.send(writePylonModule(msg));
  }

  /** 编排粒子上行（原版 BroadcastOrRequestParticleSpawn :77-88：本地已直生,净额
   *  只发服务器——服务器 Broadcast 排除发送者；装饰类 prio=1 由服务器侧定） */
  sendParticleOrchestra(type: number, settings: ParticleSettings) {
    this.send(writeParticleModule(type, settings));
  }

  // ================= M9 旅程力量/研究（msg82 module5/6/9；net/journeySync.ts） =================

  /** 世界态变更上报（本端乐观生效；服务器校验权限后广播他人——被拒时回发权威态纠正） */
  sendJourneyWorldState(s: JourneyWorldState) {
    this.send(writeJourneyWorldState(s));
  }

  /** 个人态上报（godmode/放置范围/刷怪率；服务器覆写 slot 广播——发送端已本地生效） */
  sendJourneyPersonalState(s: JourneyPersonalState) {
    this.send(writeJourneyPersonalState(this.mySlot, s));
  }

  /** 时段跳跃（StartDayImmediately 族——ASharedButtonPower.RequestUse 空载荷等价） */
  sendJourneyTimeSkip(which: 1 | 2 | 3 | 4) {
    this.send(writeJourneyTimeSkip(which));
  }

  /** 研究献祭上报（CreativeUI.SacrificeItem :308——本地注册 + 服务器中继） */
  sendJourneyUnlock(itemId: number, amount: number) {
    this.send(writeJourneyUnlockReport(itemId, amount));
  }

  /** 权限级变更（仅房主——原版服务器配置文件承担，本仓房主 UI 直改） */
  sendJourneyPermission(powerId: number, level: PowerPermissionLevel) {
    this.send(writeJourneyPermission(powerId, level));
  }

  /** Player.ChatColor（Player.cs:32230-32238）：难度着色（共享 chatColorOfDifficulty
   *  ——Game.sendChat 本地回显同源,单点校对） */
  private chatColor(): readonly [number, number, number] {
    const diff = (this.game.player as { appearance?: { difficulty?: number } }).appearance?.difficulty;
    return chatColorOfDifficulty(diff);
  }

  /** 召唤类物品使用意图（v8 msg202，仅 serverAuth 房；SimHost 校验规则门后生成 NPC。
   *  Game 在服务器房把召唤物本地 NewNPC 分支改投此消息——对齐设计文档 P4
   *  "netMode==1 短路改发消息"。中继房不调用（仍走房主本地生成）。
   *  ★(x,y) = NewNPC Bottom 锚点（NPC.cs:81594;SummonIntent=202 线契约注）——
   *  调用方传 tile 中心 X 与 Bottom 锚行 Y,SimHost.summon 底边落点。
   *  naturalPath = 自然路径意图（Game.summonBossAtTx onPlayerTy===undefined 档）——
   *  msg202 u8 flags bit0（2026-09-18 增量通道）：毁灭者 134 地下 Y 覆写仅此档
   *  （物品路径=SpawnOnPlayer 寻点原值不覆写,BJ114-c；旧客户端不发此段,
   *  服务器缺段读 0=物品路径语义） */
  sendSummonIntent(itemKey: string, x: number, y: number, vx = 0, vy = 0, naturalPath = false) {
    this.send(new NetWriter(Msg.SummonIntent).str(itemKey).f32(x).f32(y).f32(vx).f32(vy)
      .u8(naturalPath ? 1 : 0).finish());
  }

  // ================= 拴绳实体（msg82 module13，房主上行；见 net/leashedSync.ts） =================

  /** FullSync 广播（放置/重生时；= 原版 AddNewEntity → NetModule.Sync(full:true)） */
  sendLeashedFull(e: LeashedEntityLike) {
    if (e.netId > 0) this.send(writeLeashedFullSync(e));
  }

  /** PartialSync 广播（周期位置校正；= 原版 StreamNetUpdates :461-467） */
  sendLeashedPartial(e: LeashedEntityLike) {
    if (e.netId > 0) this.send(writeLeashedPartialSync(e));
  }

  /** Remove 广播（锚桩破坏；= 原版 NetModule.Remove :43-49） */
  sendLeashedRemove(netId: number) {
    if (netId > 0) this.send(writeLeashedRemove(netId));
  }

  /** 访客放置锚桩请求（sub3，服务器定向转发房主校验——唯一允许访客上行的 sub） */
  sendLeashedPlaceRequest(ax: number, ay: number, itemVid: number) {
    this.send(writeLeashedPlaceRequest(ax, ay, itemVid));
  }

  /** 访客取回锚桩存物请求（sub4，服务器定向转发房主——房主校验 furniture 记录后
   *  权威取回：弹存物 + 消散实体 + 掉物走既有 msg21，访客收包拾取。★BJ426 ④：取回
   *  后锚桩 tile 一并清除（= 原版唯一回收路 tile 破坏同态,线圈随实体亡）——房主侧
   *  setTile 经 netReporter msg17 TileBatch 广播,访客落格） */
  sendLeashedRetrieveRequest(ax: number, ay: number, kind: number) {
    this.send(writeLeashedRetrieveRequest(ax, ay, kind));
  }

  /** HP 上报（msg16，变化驱动 + 200ms 节流；原版客户端权威）。尾部随附死亡计数
   *  （u16×2 PVE/PVP——计数变化时绕过 HP 节流即发,/death 命令族汇总用）+
   *  mana/luck（i16×2+f32,2026-08-20 per-client 批——房主掉落结算 closestPlayer
   *  数据源;luck 随 5s 心跳/HP 变化包捎带,旧 server 无尾段忽略）+
   *  PvP 免疫余量（i16,2026-08-30 批——攻端门禁镜像源,取 game.player.iframes 即
   *  原版 immuneTime General 槽口径;仅免疫窗内非零,平时随包携带 0 无额外包） */
  private lastHpSent = -1;
  private lastHpAt = 0;
  private lastDeathsSent = '';
  syncHp() {
    if (this.mySlot < 0) return;
    const p = this.game.player as unknown as { hp: number; maxHp: number; deathsPve: number; deathsPvp: number; mana: number; maxMana: number; luck: number; iframes?: number; defense?: number };
    const now = performance.now();
    // 结算强制位（notifyPlayerHurtSettled）：仅下一次发送绕过节流，消费即清
    const forced = this.pvpImmuneHintPending;
    this.pvpImmuneHintPending = false;
    const deathsKey = `${p.deathsPve},${p.deathsPvp}`;
    const deathsChanged = deathsKey !== this.lastDeathsSent;
    if (!forced) {
      if (p.hp === this.lastHpSent && !deathsChanged) {
        if (now - this.lastHpAt < 5000) return; // 满血心跳 5s
      } else if (p.hp === this.lastHpSent && now - this.lastHpAt < 200) return;
    }
    this.lastHpSent = p.hp;
    this.lastDeathsSent = deathsKey;
    this.lastHpAt = now;
    this.send(new NetWriter(Msg.PlayerLifeMana).u8(this.mySlot).i16(p.hp).i16(p.maxHp)
      .u16(p.deathsPve & 0xffff).u16(p.deathsPvp & 0xffff)
      .i16(Math.max(-32768, Math.min(32767, p.mana)))
      .i16(Math.max(-32768, Math.min(32767, p.maxMana)))
      .f32(Number.isFinite(p.luck) ? p.luck : 0)
      .i16(Math.max(0, Math.min(32767, p.iframes ?? 0)))
      // ★F14 尾段：statDefense 终值镜像（PROTO 注 g）——甲虫 PvP 蓄能式的攻端不可知输入。
      //  随每次 hp 包捎带；结算强制位保证命中瞬间必有新鲜帧在途。防御独立变化不单独触发
      //  上行（与免疫尾段同款取材面——需要它的消费场景恰好都是受击事件，随包必达）
      .u16(Math.max(0, Math.min(65535, Math.trunc(p.defense ?? 0)))).finish());
  }

  /** per-client 掉落上行（module14；结算端=房主——服务器按 targetSlot 定向转发,
   *  其他端不可见。CommonCode.DropItemLocalPerClientAndSetNPCMoneyTo0 的 msg90 段） */
  sendInstancedLoot(entries: InstancedLootEntry[]) {
    for (let off = 0; off < entries.length; off += INSTANCED_LOOT_PER_FRAME) {
      this.send(writeInstancedLootModule(entries.slice(off, off + INSTANCED_LOOT_PER_FRAME)));
    }
  }

  // ================= 物品/装备同步（msg5，对齐原版 SyncPlayerItem 语义） =================

  /** 远端玩家物品快照（Game 侧拷入 proxy.inv——手持/盔甲纸娃娃/挥舞动画渲染用） */
  // ★R17（红队缺陷④收尾）：bag 条目带 prefix——远端装备词缀经 msg5 到达后不再丢弃
  // ★Q3（2026-09-30）：+miscDyes[5]（弹幕染料 cPet/cLight/cGrapple 源槽,protocol
  //  ItemContainer.MiscDyes=3）——傀儡染料通道自此与本地同源;旧服务器剥 container=3
  //  段时袋内 miscDyes 恒 null=fail-open（降级矩阵）。
  remoteItems = new Map<number, { inv: Array<{ id: number; stack: number; prefix?: number } | null>; armor: Array<{ id: number; stack: number; prefix?: number } | null>; dye: Array<{ id: number; stack: number; prefix?: number } | null>; miscDyes: Array<{ id: number; stack: number; prefix?: number } | null> }>();

  /** 本地已同步快照（差分基准；null = 尚未全量 dump） */
  private sentInv: Array<Array<{ id: number; stack: number; prefix?: number } | null>> | null = null;
  private invDumpPending = true; // 进房首包全量
  private lastInvSync = 0;

  /** 全量 dump（进房后立即 + 外部可请求） */
  // ★Q3（2026-09-30）：容器循环 3→4（+MiscDyes）——miscDyes[0]/[1]/[4] = 弹幕染料
  //  cPet/cLight/cGrapple 源槽（Player.UpdateDyes Player.cs:9667-9692）,不同步则
  //  远端傀儡染料通道恒 0（fail-open,projDye MP 边界债）。
  private sendFullInventory() {
    const p = this.game.player as unknown as { inv: { slots: Array<{ id: number; stack: number; prefix?: number } | null>; armor: Array<{ id: number; stack: number; prefix?: number } | null>; dye: Array<{ id: number; stack: number; prefix?: number } | null>; miscDyes: Array<{ id: number; stack: number; prefix?: number } | null> } };
    const entries: Array<ItemSyncEntry & { playerSlot: number }> = [];
    for (let c = 0; c < INV_SYNC_SIZES.length; c++) {
      const arr = c === 0 ? p.inv.slots : c === 1 ? p.inv.armor : c === 2 ? p.inv.dye : p.inv.miscDyes;
      for (let i = 0; i < arr.length && i < INV_SYNC_SIZES[c]; i++) {
        // ★R17：上行带 prefix（R16-13 只接了线上格式,上行漏带 → 远端永远收不到词缀）
        entries.push({ playerSlot: this.mySlot, container: c as ItemContainer, itemSlot: i, itemId: arr[i]?.id ?? 0, stack: arr[i]?.stack ?? 0, prefix: arr[i]?.prefix ?? 0 });
      }
    }
    this.send(writePlayerItems(entries));
    this.sentInv = [p.inv.slots.map(s => s ? { ...s } : null), p.inv.armor.map(s => s ? { ...s } : null), p.inv.dye.map(s => s ? { ...s } : null), p.inv.miscDyes.map(s => s ? { ...s } : null)];
    this.invDumpPending = false;
  }

  /** 差分上报（tick 内每 250ms 调一次；原版 msg5 变化驱动逐槽发送的批量等价） */
  private syncInventory(now: number) {
    if (this.mySlot < 0) return;
    if (this.invDumpPending || !this.sentInv) { this.sendFullInventory(); return; }
    if (now - this.lastInvSync < 250) return;
    this.lastInvSync = now;
    const p = this.game.player as unknown as { inv: { slots: Array<{ id: number; stack: number; prefix?: number } | null>; armor: Array<{ id: number; stack: number; prefix?: number } | null>; dye: Array<{ id: number; stack: number; prefix?: number } | null>; miscDyes: Array<{ id: number; stack: number; prefix?: number } | null> } };
    const cur = [p.inv.slots, p.inv.armor, p.inv.dye, p.inv.miscDyes];   // ★Q3 +MiscDyes
    const entries: Array<ItemSyncEntry & { playerSlot: number }> = [];
    for (let c = 0; c < INV_SYNC_SIZES.length; c++) {
      const arr = cur[c];
      const sent = this.sentInv[c];
      for (let i = 0; i < arr.length && i < INV_SYNC_SIZES[c]; i++) {
        const a = arr[i], b = sent[i];
        // ★R17：prefix 入差分键（重铸换词缀 id/stack 不变也要重发;原版 msg5 同域）
        if ((a?.id ?? 0) !== (b?.id ?? 0) || (a?.stack ?? 0) !== (b?.stack ?? 0)
          || (a?.prefix ?? 0) !== (b?.prefix ?? 0)) {
          entries.push({ playerSlot: this.mySlot, container: c as ItemContainer, itemSlot: i, itemId: a?.id ?? 0, stack: a?.stack ?? 0, prefix: a?.prefix ?? 0 });
          sent[i] = a ? { ...a } : null;
        }
      }
    }
    if (entries.length) this.send(writePlayerItems(entries));
  }

  // ★Q3：container 门 2→3（miscDyes 段落袋）。旧端降级面=本门旧值 `>2` 整条丢弃
  //  （新端→旧端帧旧端自弃、旧服务器→新端段被服务器剥除两向同 fail-open）。
  private applyRemoteItems(entries: Array<ItemSyncEntry & { playerSlot: number }>) {
    for (const e of entries) {
      if (e.container > 3 || e.itemSlot >= INV_SYNC_SIZES[e.container]) continue;
      let bag = this.remoteItems.get(e.playerSlot);
      if (!bag) {
        bag = {
          inv: Array(58).fill(null), armor: Array(20).fill(null), dye: Array(10).fill(null),
          miscDyes: Array(5).fill(null),
        };
        this.remoteItems.set(e.playerSlot, bag);
      }
      const arr = e.container === 0 ? bag.inv : e.container === 1 ? bag.armor : e.container === 2 ? bag.dye : bag.miscDyes;
      // ★R17：prefix 落袋（原版 msg5 消费端 `if (prefix != item.prefix) Prefix(prefix)`
      //  条件应用——本仓词缀是纯数据字段,直接写入即等价,不重 roll）
      arr[e.itemSlot] = e.itemId ? { id: e.itemId, stack: e.stack, prefix: e.prefix } : null;
    }
  }
}
