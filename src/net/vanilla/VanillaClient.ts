// 原版服直连客户端（vanilla interop 战役 P0-B，2026-10-24）。
// 弹道全链已在 rig 实弹定谳（rig-vanilla-1458/probe-join.mjs，129 收官）：
//   1 Hello("Terraria326") → 3 slot → 全量上传(4/68/16/42/50/147/5×350) → 6 空帧
//   → 7 WorldData → 8 出生段 → 10 段流(24 段) → 49 → 回 12 → 129 = 加入成功。
// 帧语义/字段序唯一权威 = tests/golden/net-protocol-1458.json。
// 本类按 ClientNet 鸭型实现引擎消费面（Game.ts this.net 调用面普查 2026-10-24）；
// 未接线的 SW 专有面 = no-op 桩 + 一次打点（fail-loud 不炸玩）。
// ★判例：msg5 槽位条数=数组真实长度非枚举分配量（bank 枚举 200/实体 40）。
// ★判例：129 门 = 收 49 InitialSpawn 后必须回 12 PlayerSpawn（MessageBuffer.cs:925-943
//   服务器 msg12 处理器见 State==3 才置 10+129+greet）。
import { World } from '../../world/World';
import { TileStore } from '../../world/TileStore';
import type { ClientNet, RemotePlayerState, NpcSnap, ProjSnap, ItemOpMsg } from '../ClientNet';
import { DEFAULT_ROOM_RULES, TileOpAction } from '../protocol';
import { TILE_DEFS } from '../../data/tiles';
import { ITEM_DEFS, ITEM_BY_KEY } from '../../data/items';
import { Lang } from '../../i18n/Lang';
import { MsgId, VWriter, VReader, VanillaFrameParser, VANILLA_RELEASE, SECTION_W, SECTION_H } from './codec';
import { decodeVanillaSection, applyVanillaTileArea, VANILLA_FRAME_IMPORTANT, type SectionChest } from './sections';
import { NetReader } from '../protocol';
import { readBestiaryModule, readPylonModule, readParticleModule, readAmbienceModule } from '../syncModules';
import { readJourneyWorldState, readJourneyPersonalState, readJourneyTimeSkip, readJourneyUnlockRelay, readJourneyPermission } from '../journeySync';
import { read7Bit } from '../syncModules';

import { LEASHED_SUB_REMOVE, LEASHED_SUB_FULL, LEASHED_SUB_PARTIAL, LEASHED_KIND_CRITTER, LEASHED_KIND_KITE, type LeashedNetMsg } from '../../entities/LeashedCritter';
import { mapVanillaTile } from '../../wld/WldImport';

/** NetworkText 反序列化（NetworkText.cs:65-97 线格式 1:1）：
 *  [u8 mode][7bit str][mode≠0: u8 子数 + 子项递归]。mode 0=Literal 1=Formattable
 *  2=LocalizationKey（键走 Lang.text 本地化解析,{n} 占位替换）。
 *  返回 [文案, 键(仅 key 模式非空)]——键供同名踢等特判追提示。
 *  判例（2026-10-25 用户实报）：同名在席踢裸吐 "LegacyMultiplayer.5" 键名。 */
function parseNetworkText(r: VReader): [string, string] {
  const mode = r.u8();
  const text = r.str();
  if (mode === 0) return [text, ''];
  const n = r.u8();
  const subs: string[] = [];
  for (let i = 0; i < n; i++) subs.push(parseNetworkText(r)[0]);
  if (mode === 1) return [text.replace(/\{(\d+)\}/g, (_, i) => subs[+i] ?? ''), ''];
  return [Lang.text(text, ...subs), text];
}

/** PlayerDeathReason 字节消费（PlayerDeathReason.cs FromReader 1:1）——
 *  [u8 位图] 条件携带:0=源玩家i16/1=源NPCi16/2=源弹本地i16/3=源Otheru8/
 *  4=源弹型i16/5=源物型i16/6=源词缀u8/7=自定义串。P1 只消费不解析（死亡公告走聊天）。 */
function skipDeathReason(r: VReader): void {
  const b = r.u8();
  if (b & 1) r.i16();
  if (b & 2) r.i16();
  if (b & 4) r.i16();
  if (b & 8) r.u8();
  if (b & 0x10) r.i16();
  if (b & 0x20) r.i16();
  if (b & 0x40) r.u8();
  if (b & 0x80) r.str();
}

export interface VanillaHooks {
  onWorldReady: (world: World) => void;
  onSectionArrived?: (rect: { x0: number; y0: number; w: number; h: number }) => void;
  onProgress?: (label: string, p: number) => void;
  onKick?: (reason: string) => void;
  /** NPC 傀儡快照（msg23 → Game.netApplyNpcSnaps,SW 联机同管线） */
  onNpcSnapshot?: (snaps: NpcSnap[]) => void;
  /** 聊天行（msg82 NetTextModule → Game.newText;r/g/b 0-255） */
  onChat?: (text: string, r: number, g: number, b: number) => void;
  /** 服务器权威玩家受伤/致死（msg117/118;damage=服务器终值,本地不再二次减免） */
  onPlayerHurt?: (damage: number, hitDir: number) => void;
  /** 远端/服务器弹幕快照（msg27 → Game.netApplyProjSnaps,SW kind0 直飞傀儡+vid 贴图） */
  onProjectileSync?: (snaps: ProjSnap[]) => void;
  /** 弹幕击杀（msg29 → Game.netRemoveProjPuppets——傀儡即时回收,消 180t GC 兜底） */
  onProjDespawn?: (keys: number[]) => void;
  /** 掉落物操作（msg21 spawn/更新 + msg151 despawn → Game.netApplyItemOp 傀儡管线） */
  onItemOp?: (op: ItemOpMsg) => void;
  /** 箱子内容到达（msg32 缓冲+msg33 触发 → Game.netApplyChest 登记+开面板） */
  onChestSync?: (chestIdx: number, x: number, y: number, items: Array<{ id: number; stack: number } | null>) => void;
  /** 箱名到达（msg33 名段 → Game.netApplyChestName） */
  onChestName?: (chestIdx: number, x: number, y: number, name: string) => void;
  /** P4 模块面（vanilla id 分发,消费端=SW 联机同钩子） */
  onMapPing?: (x: number, y: number) => void;
  onBestiaryEvent?: (events: import('../syncModules').BestiaryNetEvent[]) => void;
  onPylonMessage?: (msg: import('../syncModules').PylonNetMsg) => void;
  onParticleOrchestra?: (type: number, settings: import('../syncModules').ParticleSettings) => void;
  onJourneyWorldState?: (s: import('../journeySync').JourneyWorldState) => void;
  onJourneyPersonalState?: (slot: number, s: import('../journeySync').JourneyPersonalState) => void;
  onJourneyTimeSkip?: (which: 1 | 2 | 3 | 4) => void;
  onJourneyUnlock?: (slot: number, itemId: number, amount: number) => void;
  onJourneyPermission?: (powerId: number, level: number) => void;
  /** CreativeUnlocks(5) 旅程服全量研究进度（vid+amount 批;消费=SW Research 计量合并） */
  onJourneyUnlocksBulk?: (entries: Array<{ vid: number; amount: number }>) => void;
  onAmbienceSpawn?: (slot: number, seed: number, type: number) => void;
  /** 拴绳实体（msg82-13 vanilla 格式适配 → SW LeashedNetMsg → netApplyLeashed） */
  onLeashedSync?: (msg: LeashedNetMsg) => void;
  /** 挂物族 TE（msg86 → world.furnitureItems 记录;单槽族：框/武器架/食物盘/展示罐） */
  onFurnitureTE?: (x: number, y: number, kind: string, item: { vid: number; stack: number; prefix: number } | null) => void;
  /** 多槽挂物族 TE（msg86 帽架 4 槽/模特 19 槽——SW furnitureItems 同构槽位） */
  onFurnitureMultiTE?: (x: number, y: number, kind: string, slots: Array<{ vid: number; stack: number; prefix: number } | null>) => void;
}

/** PlayerItemSlotID 分配序推导（判例:条数按数组实长,见文件头） */
const SLOT = { inv: 0, armor: 59, dye: 79, misc: 89, miscDye: 94, bank1: 99, bank2: 299, trash: 499, bank3: 500, bank4: 700, ld1a: 900, ld1d: 920, ld2a: 930, ld2d: 950, ld3a: 960, ld3d: 980 };
const ITEM_ARRAYS: Array<[number, number]> = [
  [SLOT.armor, 20], [SLOT.dye, 10], [SLOT.misc, 5], [SLOT.miscDye, 5],
  [SLOT.bank1, 40], [SLOT.bank2, 40], [SLOT.trash, 1], [SLOT.bank3, 40], [SLOT.bank4, 40],
  [SLOT.ld1a, 20], [SLOT.ld1d, 10], [SLOT.ld2a, 20], [SLOT.ld2d, 10], [SLOT.ld3a, 20], [SLOT.ld3d, 10],
];

/** 预期出生段数（rig 实测 24;用于进度条,非硬门） */
const EXPECTED_SPAWN_SECTIONS = 24;

/** ISO 诊断开关（tests/scripts 二分用;生产恒 false。2026-10-24 排查渲染层 WS 派发
 *  停摆：裸 WS 实验全通、VanillaClient 卡死,二分 World 构造/段解码两嫌疑） */
export const VAN_ISO_FLAGS = { skipWorld: false, skipDecode: false, bareLoop: false };

export class VanillaClient {
  // ---- ClientNet 鸭型面（引擎 this.net 消费域）----
  active = false;
  mySlot = -1;
  players = new Map<number, RemotePlayerState>();
  policy: InstanceType<typeof ClientNet>['policy'] = {
    roomCode: '', roomName: '原版服务器', isHost: false, protectTiles: false, protectItems: false,
    maxPlayers: 255, pvpAllowed: false, rules: DEFAULT_ROOM_RULES,
  };
  gameWorld: World | null = null;

  private ws: WebSocket | null = null;
  private parser = new VanillaFrameParser();
  private hooks: VanillaHooks;
  private game: { player?: unknown };
  private pendingWorld: World | null = null;
  private worldDelivered = false;
  private sectionsReceived = 0;
  private userClosed = false;
  private readonly uuid = (globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000');
  /** 段流尾段箱子记账（P3 域：内容物走 msg32/33,先记存在性） */
  stashedChests = new Map<string, SectionChest>();
  /** msg32 箱内容缓冲（chestId→40 槽;msg33 携位置触发 onChestSync——vanilla 把
   *  SW 单帧拆成「逐槽 msg32+定位 msg33」两段,靠本桶拼合） */
  private chestItems = new Map<number, Array<{ id: number; stack: number; prefix?: number } | null>>();
  /** 远端物品袋（msg5 中继面:他人盔甲/染料/手持渲染;形状同 SW applyRemoteItems） */
  remoteItems = new Map<number, {
    inv: Array<{ id: number; stack: number; prefix?: number } | null>;
    armor: Array<{ id: number; stack: number; prefix?: number } | null>;
    dye: Array<{ id: number; stack: number; prefix?: number } | null>;
    miscDyes: Array<{ id: number; stack: number; prefix?: number } | null>;
  }>();
  /** vanilla 物品 vid → SW 内部 id 反查（懒建;msg5 中继消费）。
   *  ★vid 0 特判：vanilla 物品 0=泥土块,但 SW id 0=空洞哨兵（items.ts 铁律
   *  「vi_0 不存在」）——泥土走自造私有键 dirt_block（判例:挖格掉落 vid 0 被
   *  falsy 守卫静默吞,2026-10-25 rig 实弹） */
  private vidToItem: Map<number, number> | null = null;
  private itemByVid(vid: number): number {
    if (!this.vidToItem) {
      this.vidToItem = new Map();
      for (let i = 0; i < ITEM_DEFS.length; i++) {
        const def = ITEM_DEFS[i];
        if (def?.vid != null && !this.vidToItem.has(def.vid)) this.vidToItem.set(def.vid, i);
      }
      // 原版常见方块与 SW 自造键的差集面（vid→SW 私有物品）
      const priv: Array<[number, string]> = [[0, 'dirt_block']];
      for (const [v, key] of priv) {
        const id = ITEM_BY_KEY[key];
        if (id !== undefined) this.vidToItem.set(v, id);
      }
    }
    return this.vidToItem.get(vid) ?? 0;
  }
  /** 服务器 NPC 代际账（msg23 generation → msg28 攻击须携同代;代错=服务器静默丢） */
  private npcGenerations = new Map<number, number>();
  /** 位置→服务器箱号索引（netApplyChest 写入消费;SW ClientNet 同款 Map 语义——
   *  曾误做方法桩,netApplyChest .set 调用即炸 PAGE-EXC,2026-10-25 rig 实弹） */
  chestIndexByPos = new Map<string, number>();
  /** 段去重（服务器会因 CheckSection 重发邻段;键=secX,secY） */
  private lastSectionReqKey = '';
  /** framed 放置段请求冷却账（桶键→上次请求时刻;3s 冷却防他人建房风暴） */
  private frameSecReqAt = new Map<string, number>();
  /** msg86 TE 注册表（id→锚点+类别;remove 路径精准清 furnitureItems 用） */
  private teById = new Map<number, { x: number; y: number; kind: string }>();
  /** 诊断账（互操作调试期常驻:停摆/丢帧定位三对照——桥下行账 vs CDP vs 本计数） */
  wsMsgCount = 0;       // WS 消息（TCP chunk）数
  processedCount = 0;   // 已解析并投递 handle 的 vanilla 帧数
  recentIds: number[] = []; // 最近 32 帧 msgId 环（停摆边界定位）

  constructor(game: { player?: unknown }, hooks: VanillaHooks) {
    this.game = game;
    this.hooks = hooks;
  }

  connect(url: string) {
    this.active = true;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.traceOnce('ws open → 发 Hello');
      this.send(new VWriter().str('Terraria' + VANILLA_RELEASE).finish(MsgId.Hello));
    };
    // ★勘误（2026-10-25 三账对照定谳）：此前怀疑「Chrome WS 派发停摆」——实为自家
    //   msg49 枚举绑错号（见 InitialSpawn case 判例）。当日实证：CDP 收到的 WS 消息数
    //   与本处理器执行次数一比一全等（523=523）,Chrome 派发从未丢过一帧。
    //   由此撤销 addEventListener+属性双保险/重注册等一切绕道——单 addEventListener 即正解
    //   （判例:listener 与 onmessage 属性二挂一=双投递协议错乱）。
    const onMsg = (e: MessageEvent) => {
      const chunk = new Uint8Array(e.data as ArrayBuffer);
      this.wsMsgCount++;
      this.traceOnce(`ws message ${chunk.length}B`);
      this.parser.feed(chunk);
      this.parser.drain((id, payload) => {
        this.processedCount++;
        this.recentIds.push(id);
        if (this.recentIds.length > 32) this.recentIds.shift();
        try {
          this.handle(id, payload);
        } catch (err) {
          console.error(`[vanilla-net] handle msg${id} 抛异常:`, err);
          throw err;
        }
      });
      if (this.parser.pending > 0) this.traceOnce(`parser 半帧滞留 ${this.parser.pending}B`);
    };
    // 单监听器正解（勘误判例见上;重注册/属性双挂均已撤销）
    ws.addEventListener('message', onMsg);
    ws.onclose = (ev) => {
      this.traceOnce('ws close code=' + ev.code + ' reason=' + ev.reason);
      this.active = false;
      if (!this.userClosed) this.hooks.onKick?.('与原版服务器断开连接');
    };
    ws.onerror = () => { /* close 跟上 */ };
  }

  disconnect() {
    this.userClosed = true;
    this.active = false;
    this.ws?.close();
    this.ws = null;
  }

  private send(frame: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  /** 诊断打点（每 tag 首见;vanilla 互操作调试期留 info 级） */
  private traceTags = new Set<string>();
  private traceOnce(tag: string) {
    if (!this.traceTags.has(tag)) {
      this.traceTags.add(tag);
      console.info(`[vanilla-net] ${tag}`);
    }
  }

  // ================= 收包分发（对齐 MessageBuffer switch 已消费子集） =================

  private handle(msgId: number, payload: Uint8Array) {
    const r = new VReader(payload);
    // 诊断 trace（每号首见打点;生产留 info 级——vanilla 互操作调试期）
    this.traceOnce(`recv msg${msgId} ${payload.length}B`);
    switch (msgId) {
      case MsgId.Kick: {
        // NetworkText 三模式本地化解析（判例:同名在席踢 LegacyMultiplayer.5 曾裸吐键名）
        let text = '被原版服务器踢出';
        let key = '';
        try { [text, key] = parseNetworkText(r); } catch { /* 裸帧保底 */ }
        if (key === 'LegacyMultiplayer.5') {
          // 原版同名拒绝（mp[5]）——同名会话在席期间再进必被拒;给人话提示
          text += Lang.text('Mods.SandboxWorld.MP.VanillaDupNameHint');
        }
        this.disconnect();
        this.hooks.onKick?.(text);
        return;
      }
      case MsgId.PlayerInfo: { // slot 分配 → 全量上传 + 6
        this.mySlot = r.u8();
        r.u8(); // ServerSpecialFlags[2]
        this.uploadBurst();
        return;
      }
      case MsgId.SyncEquipment: { // 5（服务器中继他人装备——CanRelay 面,纸娃娃渲染源）
        const plr = r.u8();
        const slotId = r.i16();
        const stack = r.i16();
        const prefix = r.u8();
        const vid = r.i16();
        r.u8(); // bits（favorited[0]——渲染无消费）
        // ★SSC 反向覆盖债清偿（2026-10-26）:TShock SSC 服会为玩家推 msg5（服务器
        // 权威物品账）——己槽不再跳过,按槽位写回本地 inventory/armor/dye/misc。
        // 非 SSC 服不发己槽 msg5（CanRelay 中继面只给他人）,此路径天然不触发。
        if (plr === this.mySlot) {
          if (!this.worldDelivered) return;
          const pl = this.game.player as null | {
            inv: {
              slots: Array<{ id: number; stack: number; prefix?: number } | null>;
              armor: Array<{ id: number; stack: number; prefix?: number } | null>;
              dye: Array<{ id: number; stack: number; prefix?: number } | null>;
              miscEquips: Array<{ id: number; stack: number; prefix?: number } | null>;
              miscDyes: Array<{ id: number; stack: number; prefix?: number } | null>;
            };
          };
          if (!pl) return;
          const id5 = vid ? this.itemByVid(vid) : 0;
          const own5 = id5 ? { id: id5, stack: Math.max(1, stack), prefix: prefix || undefined } : null;
          if (slotId >= 0 && slotId <= 57) pl.inv.slots[slotId] = own5;
          else if (slotId >= SLOT.armor && slotId < SLOT.armor + 20) pl.inv.armor[slotId - SLOT.armor] = own5;
          else if (slotId >= SLOT.dye && slotId < SLOT.dye + 10) pl.inv.dye[slotId - SLOT.dye] = own5;
          else if (slotId >= SLOT.misc && slotId < SLOT.misc + 5) pl.inv.miscEquips[slotId - SLOT.misc] = own5;
          else if (slotId >= SLOT.miscDye && slotId < SLOT.miscDye + 5) pl.inv.miscDyes[slotId - SLOT.miscDye] = own5;
          return;
        }
        const id = vid ? this.itemByVid(vid) : 0;
        const entry = id ? { id, stack: Math.max(1, stack), prefix: prefix || undefined } : null;
        let bag = this.remoteItems.get(plr);
        if (!bag) {
          bag = { inv: Array(59).fill(null), armor: Array(20).fill(null), dye: Array(10).fill(null), miscDyes: Array(5).fill(null) };
          this.remoteItems.set(plr, bag);
        }
        if (slotId >= 0 && slotId <= 58) bag.inv[slotId] = entry;
        else if (slotId >= SLOT.armor && slotId < SLOT.armor + 20) bag.armor[slotId - SLOT.armor] = entry;
        else if (slotId >= SLOT.dye && slotId < SLOT.dye + 10) bag.dye[slotId - SLOT.dye] = entry;
        else if (slotId >= SLOT.miscDye && slotId < SLOT.miscDye + 5) bag.miscDyes[slotId - SLOT.miscDye] = entry;
        return; // 储物袋/时装换装槽：本地无消费面（P3 箱子域一并）
      }
      case MsgId.WorldData: {
        const d = this.parseWorldData(r);
        if (r.remaining !== 0) {
          // 编码语义先行：63 字段序若有出入当场爆（帧定界不受影响,但语义已漂移）
          console.error(`[vanilla] msg7 解析残余 ${r.remaining}B（字段序漂移,对照金标核查）`);
        }
        if (!this.pendingWorld) {
          const world = VAN_ISO_FLAGS.skipWorld
            ? ({ name: d.worldName, w: d.maxTilesX, h: d.maxTilesY, spawnX: d.spawnX, spawnY: d.spawnY, spawnX0: d.spawnX, spawnY0: d.spawnY, groundLevel: d.worldSurface, rockLevel: d.rockLayer, lavaLine: 1, dungeonX: d.dungeonX, dungeonY: d.dungeonY, crimson: d.crimson, clock: { timeOfDay: 0.5, moonPhase: 0, dayCount: 1, bloodMoon: false }, store: new TileStore(d.maxTilesX, d.maxTilesY) } as unknown as World)
            : new World(d.maxTilesX, d.maxTilesY, d.worldId, d.worldName);
          world.spawnX = d.spawnX; world.spawnY = d.spawnY;
          world.spawnX0 = d.spawnX; world.spawnY0 = d.spawnY;
          world.groundLevel = d.worldSurface;
          world.rockLevel = d.rockLayer;
          world.lavaLine = d.rockLayer + (d.maxTilesY - d.rockLayer) * 0.45; // ★债：msg7 不携 lavaLine,估值占位
          world.dungeonX = d.dungeonX; world.dungeonY = d.dungeonY;
          world.crimson = d.crimson;
          world.clock.timeOfDay = d.dayTime
            ? 4.5 / 24 + d.time / 86400
            : 19.5 / 24 + d.time / 86400;
          world.clock.moonPhase = d.moonPhase & 7;
          world.clock.dayCount = 1; // ★债：msg7 不携 dayCount
          world.clock.bloodMoon = d.bloodMoon;
          this.pendingWorld = world;
          this.send(new VWriter().i32(d.spawnX).i32(d.spawnY).u8(0).finish(MsgId.SpawnTileData));
        }
        return;
      }
      case MsgId.TileSection: {
        const world = this.pendingWorld ?? this.gameWorld;
        if (!world) return;
        const sec = VAN_ISO_FLAGS.skipDecode ? { rect: { x0: 0, y0: 0, w: 0, h: 0 }, chests: [], signs: [], teCount: 0, consumed: 0 } : decodeVanillaSection(world.store, payload);
        if (!sec) return;
        if (sec.teTruncated) this.traceOnce(`段 TE 止损（未知型/变长体,只损 TE 不伤 tiles;teCount=${sec.teCount}`);
        this.sectionsReceived++;
        for (const c of sec.chests) this.stashedChests.set(`${c.x},${c.y}`, c);
        // 木牌文本（段尾段 sign 列表 → world.signs;曾只 stash 箱子=牌全显"..."判例）
        if (sec.signs.length) {
          const wsigns = world.signs;
          for (const sg of sec.signs) {
            const ex = wsigns.find((t) => t.x === sg.x && t.y === sg.y);
            if (ex) ex.text = sg.text;
            else wsigns.push({ x: sg.x, y: sg.y, text: sg.text });
          }
        }
        if (this.worldDelivered) {
          this.hooks.onSectionArrived?.(sec.rect);
        } else {
          this.hooks.onProgress?.('接收世界数据', Math.min(0.95, this.sectionsReceived / EXPECTED_SPAWN_SECTIONS));
        }
        return;
      }
      case MsgId.PlayerSpawn: { // 12：出生点权威（含进服首拍/远端复活拍）
        const plr = r.u8();
        const sx = r.i16(), sy = r.i16();
        if (plr === this.mySlot && this.pendingWorld) {
          this.pendingWorld.spawnX = sx;
          this.pendingWorld.spawnY = sy;
        } else if (plr !== this.mySlot) {
          // 远端出生/复活：代理权威位预置（后续 msg13 持续校正）
          const rp = this.players.get(plr);
          if (rp) { rp.x = sx * 16; rp.y = sy * 16; rp.dead = false; }
        }
        return;
      }
      case MsgId.AreaTileChange: { // 20：服务器权威 tile 矩形（SendTileSquare 修正面+自带帧）
        const world = this.pendingWorld ?? this.gameWorld;
        if (!world) return;
        const rect = applyVanillaTileArea(world.store, payload);
        // ★卫门：join 期（未 129）chunks/lighting 未建——onSectionArrived 会裸读
        // this.chunks 炸 PAGE-EXC（rig 实弹两发,2026-10-25）;期前 tile 变更由初始段覆盖
        if (rect && this.worldDelivered) this.hooks.onSectionArrived?.(rect);
        return;
      }
      case MsgId.TileManipulation: { // 17：服务器中继的他人 tile 操作——客户端本地重放
        // （MessageBuffer case17 尾：TrySendData(17,-1,whoAmI,action,x,y,data1,data2)
        //   ——原版协议 tile 变更走 msg17 中继而非 msg20;msg20 仅服务器修正面）
        const action = r.u8();
        const x = r.i16(), y = r.i16();
        const data1 = r.i16();
        const data2 = r.u8();
        const world = this.pendingWorld ?? this.gameWorld;
        if (!world || !world.store.inBounds(x, y)) return;
        const st = world.store;
        const i = y * st.w + x;
        switch (action) {
          case 0: case 4: // KillTile（0 掉落版/4 无掉落版;掉落物服务器 msg21 另发）
            st.type[i] = 0; st.flags[i] = 0; st.frameX[i] = 0; st.frameY[i] = 0;
            break;
          case 1: case 21: { // PlaceTile / ReplaceTile
            const mapped = mapVanillaTile(data1);
            if (mapped) {
              st.type[i] = mapped.id;
              st.flags[i] = 1;
              st.frameX[i] = 0; st.frameY[i] = 0; // 简化帧
              // framed 类：重请求该 tile 所在段拿服务器权威帧——★冷却 3s/段
              // （红蓝对抗定谳:无冷却时他人建房=每砖一次整段重下[20s 窗 49 次]→
              //  30k tile 解码+全屏 chunk 重建+光照全量=用户实报联机卡顿主因之一）
              if (VANILLA_FRAME_IMPORTANT[data1] !== 0) {
                const sk = `${x >> 7},${y >> 7}`; // 段坐标（200/150 不对齐 tile>>7 近似;保守取 128 格桶）
                const now = performance.now();
                const last = this.frameSecReqAt.get(sk) ?? 0;
                if (now - last > 3000) {
                  this.frameSecReqAt.set(sk, now);
                  this.requestSection(x * 16, y * 16);
                }
              }
            }
            break;
          }
          case 2: st.wall[i] = 0; break; // KillWall
          case 3: case 22: { // PlaceWall / ReplaceWall
            const w = data1;
            st.wall[i] = w >= 367 ? 0 : w; // mod 墙域钳零（同段流判例）
            break;
          }
          case 5: case 6: case 10: case 11: case 12: case 13: case 16: case 17: { // 电线四色布/拆
            const place = action === 5 || action === 10 || action === 12 || action === 16;
            const mask = action === 5 || action === 6 ? TileStore.WIRE_RED
              : action === 10 || action === 11 ? TileStore.WIRE_BLUE
                : action === 12 || action === 13 ? TileStore.WIRE_GREEN : TileStore.WIRE_YELLOW;
            st.wire[i] = place ? (st.wire[i] | mask) : (st.wire[i] & ~mask);
            break;
          }
          case 14: { // SlopeTile（data1=坡度 0-4;1=半砖）
            st.half[i] = data1 === 1 ? 1 : 0;
            st.slope[i] = data1 > 1 ? data1 - 1 : 0;
            break;
          }
          case 19: // Actuate（致动器切换=ACTUATED 位翻转）
            st.wire[i] ^= TileStore.WIRE_ACTUATED;
            break;
          default:
            return; // 7 夯/15 矿车轨/PokeLogicGate:P3 域
        }
        if (this.worldDelivered) this.hooks.onSectionArrived?.({ x0: x, y0: y, w: 1, h: 1 }); // 标脏重绘+光照（join 期卫门同 msg20）
        return;
      }
      case MsgId.InitialSpawn: { // 49 InitialSpawn → 回 12（129 门判例）
        // ★判例（2026-10-25 三账对照定谳）：此处曾误绑 MsgId.ExtraSpawnSectionLoaded(158)
        //   ——49 与 158 是两个消息（金标：49=InitialSpawn 服务器→客户端；158=1.4.5
        //   ExtraSpawnSectionLoaded 客户端→服务器）。绑错号=msg12 永不发,服务器停
        //   State 3 → 40s 超时踢线;曾误诊为「Chrome WS 派发停摆」——实为自家枚举错。
        if (this.worldDelivered || this.mySlot < 0) return;
        const w = this.pendingWorld;
        this.send(new VWriter().u8(this.mySlot)
          .i16(w?.spawnX ?? 0).i16(w?.spawnY ?? 0)
          .i32(0).i16(0).i16(0).u8(0).u8(1)
          .finish(MsgId.PlayerSpawn));
        return;
      }
      case MsgId.FinishedConnectingToServer: { // 129 = 加入成功
        if (this.worldDelivered || !this.pendingWorld) return;
        this.worldDelivered = true;
        this.gameWorld = this.pendingWorld;
        // ★msg14 PlayerActive（进世界上报）——服务器主循环按 player[k].active 驱动
        // CheckSection（Main.cs:65601）→ 活跃段激活。不发=段永不激活=段门中继
        // （普通怪 msg23/普通弹 msg27）全部跳过我方（rig 实弹定谳 2026-10-25:
        // 城镇 NPC 的 msg23 走 flag4 旁路照流,造成「段已激活」假象）
        this.send(new VWriter().u8(this.mySlot).u8(1).finish(14));
        this.hooks.onProgress?.('完成', 1);
        this.hooks.onWorldReady(this.pendingWorld);
        this.pendingWorld = null;
        return;
      }
      case MsgId.StatusText:
        return; // NetworkText 载荷暂不解析（帧定界自证;进度文案 P4）
      case MsgId.KillProjectile: { // 29（服务器中继的弹幕击杀→傀儡即时回收）
        // 线格式 [i32 ProjectileKey][f32 x][f32 y]（位置仅服务端用,客户端忽略）
        const killKey = r.i32();
        r.f32(); r.f32();
        this.hooks.onProjDespawn?.([killKey]);
        return;
      }
      case MsgId.SyncProjectile: { // 27（远端/服务器弹幕 → kind0 直飞傀儡,vid 贴图）
        const key = r.i32();      // ProjectileKey（i32;傀儡桶键直用——高 8 位与 SW ownerSlot
                                  // 位域语义不同,PvP 归因面 P2 校正）
        const x = r.f32(), y = r.f32();
        const vx = r.f32(), vy = r.f32();
        const type = r.i16();     // vanilla proj vid
        const b1 = r.u8();
        const b2 = (b1 & 4) ? r.u8() : 0;
        if (b1 & 1) r.f32();      // ai[0]
        if (b1 & 2) r.f32();      // ai[1]
        if (b1 & 8) r.u16();      // bannerIdToRespondTo
        let dmg = 0;
        if (b1 & 0x10) dmg = r.i16();
        if (b1 & 0x20) r.f32();   // knockBack
        if (b1 & 0x40) r.i16();   // originalDamage
        if (b2 & 1) r.f32();      // ai[2]
        // 击杀拍（msg29）不透传——傀儡 180tick 无快照 GC 收割（P2 债:即时击杀）
        this.hooks.onProjectileSync?.([{ netId: key, kind: 0, tag: String(type), dmg, aux: 0, x, y, vx, vy }]);
        return;
      }
      case MsgId.SyncItem: { // 21（服务器权威掉落物 → SW 傀儡管线）
        // 金标 readerRaw：[i16 itemId][pos][vel][i16 stack][u8 prefix][u8 bits]
        // [i16 vid][bits[2]:u8 shimmer+ f32 time][bits[3]:u8 enemyGrab]
        const itemId = r.i16();
        const x = r.f32(), y = r.f32();
        const vx = r.f32(), vy = r.f32();
        const stack = r.i16();
        const prefix = r.u8();
        const bits = r.u8();
        const vid = r.i16();
        const shimmered = !!(bits & 4) && r.u8() !== 0;
        const shimmerTime = bits & 4 ? r.f32() : 0;
        if (bits & 8) r.u8(); // enemyGrabDelay（拾取保留语义,本地无消费）
        const id = this.itemByVid(vid); // vid 0=泥土（itemByVid 内特判,非空语义）
        if (!id) return; // 未知/原创物品:原版服不识亦不显（债在册）
        this.hooks.onItemOp?.({
          op: 0, netId: itemId, key: ITEM_DEFS[id]?.key ?? '', stack: Math.max(1, stack),
          x, y, vx, vy, shimmered, shimmerTime, prefix: prefix || undefined,
        });
        return;
      }
      case MsgId.SyncItemDespawn: { // 151（物品消失/被拾——傀儡回收）
        this.hooks.onItemOp?.({ op: 1, netId: r.i16(), key: '', stack: 0, x: 0, y: 0, vx: 0, vy: 0 });
        return;
      }
      case MsgId.SyncChestItem: { // 32（箱内容逐槽;金标:[i16 chestId][u8 slot][i16 stack][u8 prefix][i16 vid]）
        const chestId = r.i16();
        const slot = r.u8();
        const stack = r.i16();
        const prefix = r.u8();
        const vid = r.i16();
        let items = this.chestItems.get(chestId);
        if (!items) { items = new Array(40).fill(null); this.chestItems.set(chestId, items); }
        const id = this.itemByVid(vid);
        items[slot] = id && stack > 0 ? { id, stack, prefix: prefix || undefined } : null;
        return;
      }
      case 33: { // SyncPlayerChest（开箱通知,携 chestId+x/y → 拼合触发 onChestSync）
        const chestId = r.i16();
        const cx = r.i16(), cy = r.i16();
        const nameLen = r.u8();
        let chestName = '';
        if (nameLen > 0 && nameLen <= 20) chestName = r.str(); // 箱名（→netApplyChestName）
        if (chestName) this.hooks.onChestName?.(chestId, cx, cy, chestName);
        const items = this.chestItems.get(chestId) ?? new Array(40).fill(null);
        this.hooks.onChestSync?.(chestId, cx, cy, items);
        return;
      }
      case 30: { // TogglePVP（[u8 slot][u8 hostile]——远端镜像,代理消费 rp.hostile）
        const slot = r.u8();
        const hostile = r.u8() !== 0;
        if (slot === this.mySlot) return;
        const rp = this.players.get(slot);
        if (rp) rp.hostile = hostile;
        return;
      }
      case 45: case 157: { // TeamChange（[u8 slot][u8 team 0-5]）
        const slot = r.u8();
        const team = r.u8();
        if (slot === this.mySlot) return;
        const rp = this.players.get(slot);
        if (rp) rp.team = team;
        return;
      }
      case 86: { // TileEntitySharing（MessageBuffer.cs case86）：[i32 id][u8 exists]
        // exists=true → TileEntity.Read(networkSend=true)：[u8 type][i16 x][i16 y]+extra。
        // TE 注册序（TileEntitiesManager.cs:26-38）：0木桩/1物品框/2逻辑传感/3模特/4武器架
        // /5帽架/6食物盘/7晶塔/8展示罐/9风筝桩/10捕获桩。
        const teId = r.i32();
        const exists = r.u8() !== 0;
        if (!exists) {
          // ★红蓝对抗债清偿（2026-10-26）：remove 按 ID 注册表精准清记录——旧版空 kind
          // 早退=他人清空物品框后我方幽灵残物。注册表在 add 路径持续维护。
          const rec = this.teById.get(teId);
          if (rec) {
            this.teById.delete(teId);
            this.hooks.onFurnitureTE?.(rec.x, rec.y, rec.kind, null);
          }
          return;
        }
        const type86 = r.u8();
        const x86 = r.i16(), y86 = r.i16();
        const kindOf = (t: number): string | null =>
          t === 1 ? 'item_frame' : t === 4 ? 'weapon_rack' : t === 6 ? 'food_platter'
            : t === 8 ? 'display_jar' : null;
        const kind86 = kindOf(type86);
        if (kind86) { // 单槽族：[i16 vid][u8 prefix][i16 stack]
          const vid = r.i16(), prefix = r.u8(), stack = r.i16();
          this.teById.set(teId, { x: x86, y: y86, kind: kind86 });
          this.hooks.onFurnitureTE?.(x86, y86, kind86, vid > 0 ? { vid, stack, prefix } : null);
        } else if (type86 === 5) { // HatRack（TEHatRack.cs ReadExtraData）：
          // [u8 bits（0-1=帽,2-3=染料）]×条件物品[i16 vid][u8 prefix][i16 stack]
          const bits = r.u8();
          const slots: Array<{ vid: number; stack: number; prefix: number } | null> = [null, null, null, null];
          for (let i = 0; i < 2; i++) if (bits & (1 << i)) { const vid = r.i16(), prefix = r.u8(), stack = r.i16(); slots[i] = { vid, stack, prefix }; }
          for (let j = 0; j < 2; j++) if (bits & (1 << (j + 2))) { const vid = r.i16(), prefix = r.u8(), stack = r.i16(); slots[j + 2] = { vid, stack, prefix }; }
          this.teById.set(teId, { x: x86, y: y86, kind: 'hat_rack' });
          this.hooks.onFurnitureMultiTE?.(x86, y86, 'hat_rack', slots);
        } else if (type86 === 3) { // DisplayDoll（TEDisplayDoll.cs ReadExtraData,326 版）：
          // [u8 equipBits][u8 dyeBits][u8 pose][u8 miscBits]×条件物品;equip9+dye9+misc1
          const eb = r.u8(), db = r.u8();
          r.u8(); // pose（渲染姿态,SW 渲染面不消费——字节保位）
          const mb = r.u8();
          const mask = (b: number, hi: number) => b | (hi ? 256 : 0);
          const equipMask = mask(eb, mb & 2 ? 256 : 0);
          const dyeMask = mask(db, mb & 4 ? 256 : 0);
          const slots: Array<{ vid: number; stack: number; prefix: number } | null> = new Array(19).fill(null);
          for (let i = 0; i < 9; i++) if (equipMask & (1 << i)) { const vid = r.i16(), prefix = r.u8(), stack = r.i16(); slots[i] = { vid, stack, prefix }; }
          for (let j = 0; j < 9; j++) if (dyeMask & (1 << j)) { const vid = r.i16(), prefix = r.u8(), stack = r.i16(); slots[10 + j] = { vid, stack, prefix }; }
          if (mb & 1) { const vid = r.i16(), prefix = r.u8(), stack = r.i16(); slots[9] = { vid, stack, prefix }; }
          this.teById.set(teId, { x: x86, y: y86, kind: 'display_doll' });
          this.hooks.onFurnitureMultiTE?.(x86, y86, 'display_doll', slots);
        }
        // 0/2/7/9/10（木桩/逻辑传感/晶塔[module8 已接]/风筝桩/捕获桩）本地无消费面字节跳过
        return;
      }
      case 117: { // PlayerHurtV2（服务器权威受伤广播）
        const slot = r.u8();
        skipDeathReason(r);
        const damage = r.i16();
        const hitDir = r.u8() - 1;
        r.u8();   // bits:crit[0]/pvp[1]
        r.i8();   // cooldownAdd
        if (slot === this.mySlot) {
          this.hooks.onPlayerHurt?.(damage, hitDir);
        } else {
          const rp = this.players.get(slot);
          if (rp) rp.hp = Math.max(0, rp.hp - damage);
        }
        return;
      }
      case 118: { // PlayerDeathV2（服务器权威死亡广播）
        const slot = r.u8();
        skipDeathReason(r);
        r.i16();  // damage
        r.u8();   // hitDirection-1
        r.u8();   // bits:pvp[0]
        if (slot === this.mySlot) {
          this.hooks.onPlayerHurt?.(1e9, 0); // 致死拍=damagePlayer 死亡结算同管道
        } else {
          const rp = this.players.get(slot);
          if (rp) { rp.hp = 0; rp.dead = true; }
        }
        return;
      }
      case MsgId.SyncPlayer: { // 4（远端槽广播:外观/名字）
        const slot = r.u8();
        if (slot === this.mySlot) return;
        const skinVariant = r.u8();
        r.u8();   // voiceVariant
        r.f32();  // voicePitchOffset
        const hair = r.u8();
        const name = r.str();
        const hairDye = r.u8();
        r.u16();  // accessoryVisibility
        r.u8();   // hideMisc
        const col = () => ({ r: r.u8(), g: r.u8(), b: r.u8() });
        // SW 代理面消费 JSON 串（simulateRemotePlayers 解析为 proxy.appearance;
        // 字段名对齐 player/Appearance.ts——hair/hairDye 渲染色链全量）
        const appearance = {
          name, hair, skinVariant, hairDye,
          hairColor: col(), skinColor: col(), eyeColor: col(), shirtColor: col(),
          undershirtColor: col(), pantsColor: col(), shoeColor: col(),
        };
        const rp = this.players.get(slot) ?? this.mkRemote(slot);
        rp.name = name;
        rp.appearance = JSON.stringify(appearance);
        this.players.set(slot, rp);
        return;
      }
      case MsgId.PlayerControls: { // 13（远端;原版 reader 同门跳过己槽）
        const slot = r.u8();
        if (slot === this.mySlot) return;
        const c1 = r.u8(), c2 = r.u8(), c3 = r.u8(), c4 = r.u8();
        const sel = r.u8();
        const x = r.f32(), y = r.f32();
        let vx = 0, vy = 0;
        if (c2 & 4) { vx = r.f32(); vy = r.f32(); }        // b25[2] vel 携带
        if (c2 & 128) r.u16();                              // b25[7] mount 类型
        if (c3 & 0x40) { r.f32(); r.f32(); r.f32(); r.f32(); } // b26[6] 回城药双 Vector2
        const camT = c4 & 0x20 ? { x: r.f32(), y: r.f32() } : null; // b27[5] 观战相机目标
        const rp = this.players.get(slot) ?? this.mkRemote(slot);
        rp.x = x; rp.y = y; rp.vx = vx; rp.vy = vy;
        rp.up = !!(c1 & 1); rp.down = !!(c1 & 2);
        rp.left = !!(c1 & 4); rp.right = !!(c1 & 8);
        rp.jump = !!(c1 & 16); rp.useItem = !!(c1 & 32);
        rp.facing = c1 & 64 ? 1 : -1;
        rp.selectedItem = sel;
        rp.sleeping = !!(c4 & 1);
        rp.camTarget = camT;
        rp.fresh = true;
        rp.lastFresh = performance.now();
        this.players.set(slot, rp);
        return;
      }
      case 65: { // TeleportPlayer：[u8 bits][i16 slot][f32 x][f32 y][u8 style]
        // [bits0:任一=1 extra/2=2][bits2:用现位][bits3:i32 extra]
        const bits65 = r.u8();
        const slot65 = r.i16();
        const tx = r.f32(), ty = r.f32();
        r.u8(); // style
        if (bits65 & 4) { /* 用现位——服务器让各端自取,本地已正确 */ }
        if (bits65 & 8) r.i32(); // extra（PotionOfReturn 等附加）
        if (slot65 === this.mySlot) {
          const p65 = this.game.player as { x: number; y: number; vx?: number; vy?: number; netOffX?: number; netOffY?: number } | null | undefined;
          if (p65) { p65.x = tx; p65.y = ty; p65.vx = 0; p65.vy = 0; }
        } else {
          const rp65 = this.players.get(slot65);
          if (rp65) { rp65.x = tx; rp65.y = ty; }
        }
        return;
      }
      case MsgId.PlayerActive: { // 14（上线/离线广播）
        const slot = r.u8();
        const active = r.u8() === 1;
        if (slot === this.mySlot) return;
        if (active) {
          if (!this.players.has(slot)) this.players.set(slot, this.mkRemote(slot));
        } else {
          const rp = this.players.get(slot);
          if (rp) rp.active = false; // 代理由 simulateRemotePlayers 下帧剔除
        }
        return;
      }
      case MsgId.PlayerLifeMana: { // 16（远端血条;原版 reader 非 SSC 跳过己槽）
        const slot = r.u8();
        const hp = r.i16(), maxHp = r.i16();
        if (slot === this.mySlot) return;
        const rp = this.players.get(slot);
        if (!rp) return;
        rp.hp = hp;
        rp.maxHp = Math.max(20, maxHp);
        rp.dead = hp <= 0;
        return;
      }
      case MsgId.PlayerMana: { // 42（远端蓝条）
        const slot = r.u8();
        const mana = r.i16(), manaMax = r.i16();
        if (slot === this.mySlot) return;
        const rp = this.players.get(slot);
        if (!rp) return;
        rp.mana = mana; rp.manaMax = manaMax;
        return;
      }
      case MsgId.SyncNpc: { // 23（服务器权威 NPC 快照 → 傀儡,金标 readerRaw 1:1）
        // 锚点:NPCID.Sets.SyncAnchor 缺省 (0,0)（唯一例外 type 50=(0.5,1),P1 忽略）
        // → 线位=左上,恰合傀儡快照语义（netApplyNpcSnaps e.x=s.x 同域）。
        const npcSlot = r.u8();
        const generation = r.u8();
        const x = r.f32(), y = r.f32();
        const vx = r.f32(), vy = r.f32();
        r.u16();  // target
        const b30 = r.u8(), b31 = r.u8();
        for (let i = 0; i < 4; i++) if (b30 & (4 << i)) r.f32(); // ai[0..3] 存在位 b30[2..5]
        const netID = r.i16();
        if (b31 & 1) r.u8();    // playerCountForMultiplayerDifficulty
        if (b31 & 4) r.f32();   // strengthMultiplayer
        let life: number;
        if (b30 & 0x80) {
          life = 99999; // 「life 未知→lifeMax」语义——傀儡血条以 def.maxHp 为准,此值仅供存活判定
        } else {
          const code = r.u8();
          life = code === 2 ? r.i16() : code === 4 ? r.i32() : r.i8();
        }
        if (r.remaining >= 1) r.u8(); // 可捕捉 NPC 尾段 releaseOwner（npcCatchable 小集;剩余字节兜底）
        if (life <= 0) {
          this.npcGenerations.delete(npcSlot); // 失活槽位代际账随清
          return; // 不投递,傀儡交 300tick 超时 GC（netSweepPuppets）
        }
        this.npcGenerations.set(npcSlot, generation);
        this.hooks.onNpcSnapshot?.([{
          netId: npcSlot, key: `v_${netID}`,
          x, y, vx, vy, hp: life, maxHp: Math.max(1, life), animT: 0, flags: 0,
          // ★债：maxHp=life 近似（线格式无 maxHp 段,fromVanilla def 值会被快照覆写）——
          //   受伤 NPC 头顶血条比例失真,P2 走 e.def 复核
        }]);
        return;
      }
      case MsgId.NetModules: { // 82（TextModule 聊天/LiquidModule 液体;其余 P4）
        const moduleId = r.u16();
        // ★fail-soft：模块体解析错（格式漂移/越界）只丢本模块帧,不炸 WS 消息链
        try {
        if (moduleId === 0) {
          // NetLiquidModule.Deserialize（NetLiquidModule.cs:74-91）:[u16 n]×[i32 打包
          // 坐标 x<<16|y][u8 liquid 0-255][u8 类型 0水1浆2蜜3shimmer]（本仓 +1）
          const n = r.u16();
          const world = this.pendingWorld ?? this.gameWorld;
          if (!world) return;
          const st = world.store;
          let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let i = 0; i < n; i++) {
            const packed = r.i32();
            const liquid = r.u8();
            const type = r.u8();
            const x = (packed >>> 16) & 0xffff, y = packed & 0xffff;
            if (!st.inBounds(x, y)) continue;
            const idx = y * st.w + x;
            st.liquid[idx] = liquid;
            st.liquidType[idx] = liquid > 0 ? type + 1 : 0;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          if (n > 0 && x1 >= 0 && this.worldDelivered && x1 - x0 < 400 && y1 - y0 < 400) {
            this.hooks.onSectionArrived?.({ x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }); // 标脏重绘
          }
          return;
        }
        // P4（2026-10-25）：复用 SW syncModules 原版格式读取器（线格式同源 1:1;
        // ★SW NetModule enum 与 vanilla 1458 注册序有 4 处错位[JoinLeave3/CreativePowers5/
        // Pylon7/Permissions9],故此处按 vanilla id 显式分发,禁用 SW enum 常量）
        if (moduleId === 13) { // vanilla LeashedEntity（LeashedEntity.cs 全适配,2026-10-25）
          // 线格式（LeashedEntity.cs:23-47+双族 NetReceive）：
          //   [u8 sub 0删/1全/2半][7bit slot][7bit type][半:7bit type][全:i16 锚x/y]
          //   Critter 体(2-21 型):全[7bit npcType][f32 w][f32 h]恒[u32 打包位(PackedVector2
          //     =锚相对左上)][u8 向][u32 rand][i16 wait][u8 state][s8 tdx][s8 tdy]
          //   Kite 体(1 型):全[7bit projType]恒[f32 pos×2][u32 打包速度][u8 rot]
          //     [f32 wind][f32 cloud][f32 time]
          // SW 差集:身份头 u16 定长(原版 7bit)/Critter 尺寸 u16(原版 f32)/位域两 f16
          //   (原版 u32 打包=同 half 语义直拷)/Critter 全量尾三字段(variant/scale/trail
          //   =SW 扩展,适配写缺省)——适配器双向翻译后走 SW 管线
          const lr = new NetReader(payload.subarray(2));
          const sub13 = lr.u8();
          const slot13 = read7Bit(lr);
          if (sub13 === LEASHED_SUB_REMOVE) {
            this.hooks.onLeashedSync?.({ sub: LEASHED_SUB_REMOVE, netId: slot13, ax: 0, ay: 0, kind: 0, vid: 0, r: lr });
            return;
          }
          const type13 = read7Bit(lr);
          const isKite = type13 === 1; // Registry:0=null/1=Kite/2-21=Critter
          let ax13 = 0, ay13 = 0;
          if (sub13 === LEASHED_SUB_FULL) {
            ax13 = lr.i16(); ay13 = lr.i16();
            if (isKite) {
              const projType = read7Bit(lr);
              const px = lr.f32(), py = lr.f32();
              const vpack = lr.u32();
              const rot = lr.u8(), wind = lr.f32(), cloud = lr.f32(), time = lr.f32();
              const w = new VWriter();
              w.u16(projType & 0xffff); w.u16(4); w.u16(4); // SW 身份头（w/h 缺省 4）
              w.f32(px); w.f32(py);
              w.u16(vpack & 0xffff); w.u16((vpack >>> 16) & 0xffff); // 打包速度两 half 直拷
              w.u8(rot); w.f32(wind); w.f32(cloud); w.f32(time);
              this.hooks.onLeashedSync?.({ sub: LEASHED_SUB_FULL, netId: slot13, ax: ax13, ay: ay13, kind: LEASHED_KIND_KITE, vid: 0, r: new NetReader(w.buf) });
            } else {
              const npcType = read7Bit(lr);
              const sw = lr.f32(), sh = lr.f32();
              const ppack = lr.u32();
              const dir = lr.u8(), rand = lr.u32(), wait = lr.i16(), st8 = lr.u8(), tdx = lr.i8(), tdy = lr.i8();
              const w = new VWriter();
              w.u16(npcType & 0xffff); w.u16(Math.max(0, Math.round(sw))); w.u16(Math.max(0, Math.round(sh)));
              w.u16(ppack & 0xffff); w.u16((ppack >>> 16) & 0xffff); // 锚相对位（half 直拷=同语义）
              w.u8(dir); w.u32(rand); w.i16(wait); w.u8(st8); w.i8(tdx); w.i8(tdy);
              w.u8(0); w.u8(100); w.u8(0); // SW 全量尾:variant/scale/trail 缺省
              this.hooks.onLeashedSync?.({ sub: LEASHED_SUB_FULL, netId: slot13, ax: ax13, ay: ay13, kind: LEASHED_KIND_CRITTER, vid: 0, r: new NetReader(w.buf) });
            }
            return;
          }
          if (sub13 === LEASHED_SUB_PARTIAL) {
            if (isKite) {
              const px = lr.f32(), py = lr.f32();
              const vpack = lr.u32();
              const rot = lr.u8(), wind = lr.f32(), cloud = lr.f32(), time = lr.f32();
              const w = new VWriter();
              w.f32(px); w.f32(py);
              w.u16(vpack & 0xffff); w.u16((vpack >>> 16) & 0xffff);
              w.u8(rot); w.f32(wind); w.f32(cloud); w.f32(time);
              this.hooks.onLeashedSync?.({ sub: LEASHED_SUB_PARTIAL, netId: slot13, ax: 0, ay: 0, kind: LEASHED_KIND_KITE, vid: 0, r: new NetReader(w.buf) });
            } else {
              const ppack = lr.u32();
              const dir = lr.u8(), rand = lr.u32(), wait = lr.i16(), st8 = lr.u8(), tdx = lr.i8(), tdy = lr.i8();
              const w = new VWriter();
              w.u16(ppack & 0xffff); w.u16((ppack >>> 16) & 0xffff);
              w.u8(dir); w.u32(rand); w.i16(wait); w.u8(st8); w.i8(tdx); w.i8(tdy);
              this.hooks.onLeashedSync?.({ sub: LEASHED_SUB_PARTIAL, netId: slot13, ax: 0, ay: 0, kind: LEASHED_KIND_CRITTER, vid: 0, r: new NetReader(w.buf) });
            }
            return;
          }
          return;
        }
        if (moduleId === 14) { // vanilla UnbreakableWallScan：[u8 slot][u8 inside]
          // 远端镜像（getfixedboi 双地牢越界旗;代理无刷怪消费面=记账即可）
          const slot14 = r.u8();
          const inside = r.u8() !== 0;
          if (slot14 !== this.mySlot) {
            const rp14 = this.players.get(slot14);
            if (rp14) (rp14 as unknown as { insideUnbreakableWalls?: boolean }).insideUnbreakableWalls = inside;
          } else {
            // 己槽：服务器权威覆写本地扫描旗（getfixedboi 种子）
            const p14 = this.game.player as { insideUnbreakableWalls?: boolean } | null | undefined;
            if (p14) p14.insideUnbreakableWalls = inside;
          }
          return;
        }
        if (moduleId === 12) { // vanilla CraftingRequests（S→C 回执 [u8 approved]）
          // 本地合成+msg5 差分已覆盖（非 SSC=客户端权威）;回执字节消费保位（债）
          return;
        }
        if (moduleId === 11) { // vanilla Banners（BannerSystem.NetBannersModule）
          const br = new NetReader(payload.subarray(2));
          const sub = br.u8();
          if (sub === 1) { // KillCountUpdate: [i16 bannerVid][i32 count] → 图鉴击杀直写
            const vid = br.i16(), count = br.i32();
            this.hooks.onBestiaryEvent?.([{ sub: 0, netId: vid, count }]);
          } else if (sub === 0) { // FullState: [i16 n]×[vid][count]（进服全量）
            const n = br.i16();
            const evts = [];
            for (let i = 0; i < n; i++) {
              const vid = br.i16(), count = br.i32();
              evts.push({ sub: 0, netId: vid, count });
            }
            if (evts.length) this.hooks.onBestiaryEvent?.(evts);
          }
          // sub2 ClaimCount/sub3 ClaimRequest/sub4 ClaimResponse:旗帜领赏域,字节消费保位（P4 债）
          return;
        }
        if (moduleId === 3) { // vanilla Ambience（SW enum 错位为 100）：天空氛围生成
          const m = readAmbienceModule(new NetReader(payload.subarray(2)));
          this.hooks.onAmbienceSpawn?.(m.playerSlot, m.seed, m.type);
          return;
        }
        if (moduleId === 2) { // vanilla Ping（SW id 同位）：{f32 x}{f32 y} → 地图 ping
          const x = r.f32(), y = r.f32();
          if (Number.isFinite(x) && Number.isFinite(y)) this.hooks.onMapPing?.(x, y);
          return;
        }
        if (moduleId === 4) { // vanilla Bestiary（SW id 同位）：三子型批量 → 图鉴事件
          const events = readBestiaryModule(new NetReader(payload.subarray(2)));
          if (events.length) this.hooks.onBestiaryEvent?.(events);
          return;
        }
        if (moduleId === 8) { // vanilla TeleportPylon（SW enum 错位为 7）：晶塔增删/传送
          const msg = readPylonModule(new NetReader(payload.subarray(2)));
          if (msg) this.hooks.onPylonMessage?.(msg);
          return;
        }
        if (moduleId === 9) { // vanilla Particles（SW enum 错位——无此位）：编排粒子
          const m = readParticleModule(new NetReader(payload.subarray(2)));
          if (Number.isFinite(m.settings.posX) && Number.isFinite(m.settings.posY)) {
            this.hooks.onParticleOrchestra?.(m.type, m.settings);
          }
          return;
        }
        if (moduleId === 6) { // vanilla CreativePowers（SW enum 错位为 5）：旅程力量
          const jr = new NetReader(payload.subarray(2));
          const sub = jr.u8();
          if (sub === 0) this.hooks.onJourneyWorldState?.(readJourneyWorldState(jr));
          else if (sub === 1) {
            const { slot, state } = readJourneyPersonalState(jr);
            this.hooks.onJourneyPersonalState?.(slot, state);
          } else if (sub === 2) {
            const which = readJourneyTimeSkip(jr);
            if (which) this.hooks.onJourneyTimeSkip?.(which);
          }
          return;
        }
        if (moduleId === 7) { // vanilla UnlocksPlayerReport（注册序 7=NetCreativeUnlocksPlayerReportModule,
          // ★曾误接 5——1458 注册序 5=CreativeUnlocks[持久化解锁]≠PlayerReport[上报中继],2026-10-25 勘正）
          const m = readJourneyUnlockRelay(new NetReader(payload.subarray(2)));
          this.hooks.onJourneyUnlock?.(m.slot, m.itemId, m.amount);
          return;
        }
        if (moduleId === 5) { // vanilla CreativeUnlocks（旅程服进服全量研究进度）
          // NetCreativeUnlocksModule.Deserialize：[7bit n]×[u16 itemId][7bit amount]
          const cu = new NetReader(payload.subarray(2));
          const n5 = read7Bit(cu);
          const entries: Array<{ vid: number; amount: number }> = [];
          for (let i = 0; i < n5; i++) {
            const vid = cu.u16(), amount = read7Bit(cu);
            if (vid > 0) entries.push({ vid, amount });
          }
          if (entries.length) this.hooks.onJourneyUnlocksBulk?.(entries);
          return;
        }
        if (moduleId === 10) { // vanilla Permissions（SW enum 错位为 9）：力量权限级
          const { powerId, level } = readJourneyPermission(new NetReader(payload.subarray(2)));
          this.hooks.onJourneyPermission?.(powerId, level);
          return;
        }
        if (moduleId === 1) {
          // NetTextModule.DeserializeAsClient（NetTextModule.cs:32-37）:
          // [u8 authorId][NetworkText][RGB 3B];author=255 服务器系统行（含进出服公告）
          const author = r.u8();
          // 原版服务器把聊天中继回发送者——SW 引擎契约=本地回显（ui.chatMessage）
          // 已展示,己槽回声丢弃防双跳（duo 判例:<玩家0> 回显伪影）
          if (author === this.mySlot) return;
          let text = '';
          try { text = parseNetworkText(r)[0]; } catch { return; }
          const cr = r.u8(), cg = r.u8(), cb = r.u8();
          const name = author === 255 ? null : (this.players.get(author)?.name ?? `玩家${author}`);
          this.hooks.onChat?.(name ? `<${name}> ${text}` : text, cr, cg, cb);
        }
        } catch (modErr) { this.traceOnce(`模块 ${moduleId} 解析弃帧: ${String(modErr).slice(0, 80)}`); }
        return;
      }
      default:
        // P2+：21 掉落 / 20 tile 变更 / 32 箱物 / 50 buff / 151 弹幕 …
        // 帧定界由 parser 保证（自证纪律）,未实现面静默记账不炸。
        return;
    }
  }

  /** players 表缺省工厂（RemotePlayerState 全字段——simulateRemotePlayers 逐字段消费） */
  private mkRemote(slot: number): RemotePlayerState {
    return {
      slot, name: `玩家${slot}`, appearance: '',
      x: 0, y: 0, vx: 0, vy: 0,
      up: false, down: false, left: false, right: false, jump: false, useItem: false,
      facing: 1, selectedItem: 0, dead: false,
      fresh: false, active: true, lastFresh: performance.now(),
      hostile: false, team: 0, deathsPve: 0, deathsPvp: 0,
      hp: 100, maxHp: 100, mana: 20, manaMax: 20, luck: 0,
      pvpImmuneT: 0, pvpDefense: null, sleeping: false, camTarget: null,
    };
  }

  // ================= 上传爆发（MessageBuffer.cs:236-282 客户端面逐字镜像） =================

  private uploadBurst() {
    const gp = this.game.player as {
      appearance?: { name?: string };
      statLife?: number; statLifeMax?: number; statMana?: number; statManaMax?: number;
    } | undefined | null;
    const pendingName = (this.game as { pendingJoinName?: string }).pendingJoinName;
    // 加入期外观（mainFlow joinVanillaServer 注入的 charStore Appearance;此时引擎
    // player 尚未建,game.player 恒 undefined——曾读它=恒默认色+默认名判例见 mainFlow）
    const pendingApp = (this.game as {
      pendingJoinAppearance?: {
        name?: string; skinVariant?: number; hair?: number; hairDye?: number;
        hairColor?: [number, number, number]; skinColor?: [number, number, number];
        eyeColor?: [number, number, number]; shirtColor?: [number, number, number];
        underShirtColor?: [number, number, number]; pantsColor?: [number, number, number];
        shoeColor?: [number, number, number];
      };
    }).pendingJoinAppearance;
    // 加入期随身态（charStore getState → playerFromDiskForm;msg5 真物品上传——
    // 服务器据此算我们的防御/伤害,空账=服务器视 0 防御挨真伤判例 2026-10-25）
    type DiskItem = { id: number; stack: number; favorited?: boolean; prefix?: number } | null | undefined;
    const pendingItems = (this.game as {
      pendingJoinItems?: {
        hp?: number; baseMaxHp?: number; mana?: number; baseMaxMana?: number;
        inventory?: DiskItem[]; armor?: DiskItem[]; dye?: DiskItem[];
        miscEquips?: DiskItem[]; miscDyes?: DiskItem[];
        banks?: Array<DiskItem[] | undefined> | null; trash?: DiskItem;
        loadouts?: Array<{ armor?: DiskItem[]; dye?: DiskItem[] } | undefined> | null;
      } | null;
    }).pendingJoinItems;
    const name = gp?.appearance?.name ?? pendingName ?? '玩家';
    const life = pendingItems?.hp ?? pendingItems?.baseMaxHp ?? gp?.statLifeMax ?? 100;
    const lifeMax = pendingItems?.baseMaxHp ?? gp?.statLifeMax ?? 100;
    const mana = pendingItems?.mana ?? pendingItems?.baseMaxMana ?? gp?.statManaMax ?? 20;
    const manaMax = pendingItems?.baseMaxMana ?? gp?.statManaMax ?? 20;
    const slot = this.mySlot;
    const pkts: Uint8Array[] = [];
    // msg4 SyncPlayer（金标 writerRaw 逐字段:slot/skinVariant/voiceVariant/pitch/
    // hair/name/hairDye/accVis/hideMisc/RGB×7/BitsByte×3——外观走真值,缺省 0）
    const rgb = (k: 'hairColor' | 'skinColor' | 'eyeColor' | 'shirtColor' | 'underShirtColor' | 'pantsColor' | 'shoeColor',
      d: [number, number, number]): [number, number, number] => {
      const v = pendingApp?.[k] ?? (gp?.appearance as Record<string, unknown> | undefined)?.[k];
      return Array.isArray(v) ? (v as [number, number, number]) : d;
    };
    pkts.push(new VWriter()
      .u8(slot).u8(pendingApp?.skinVariant ?? 0).u8(0).f32(0).u8(pendingApp?.hair ?? 0)
      .str(name).u8(pendingApp?.hairDye ?? 0).u16(0).u8(0)
      .u8n(...rgb('hairColor', [28, 222, 255])).u8n(...rgb('skinColor', [255, 191, 143]))
      .u8n(...rgb('eyeColor', [113, 60, 37])).u8n(...rgb('shirtColor', [175, 105, 47]))
      .u8n(...rgb('underShirtColor', [160, 110, 80])).u8n(...rgb('pantsColor', [40, 86, 120]))
      .u8n(...rgb('shoeColor', [120, 90, 60]))
      .u8(0).u8(0).u8(0)
      .finish(MsgId.SyncPlayer));
    pkts.push(new VWriter().str(this.uuid).finish(MsgId.ClientUuid));
    pkts.push(new VWriter().u8(slot).i16(life).i16(lifeMax).finish(MsgId.PlayerLifeMana));
    pkts.push(new VWriter().u8(slot).i16(mana).i16(manaMax).finish(MsgId.PlayerMana));
    pkts.push(new VWriter().u8(slot).u16(0).finish(MsgId.PlayerBuffs)); // 无 buff 终止子
    pkts.push(new VWriter().u8(slot).u8(0).u16(0).finish(MsgId.SyncLoadout));
    // msg5 SyncEquipment 真值序（金标 writerRaw）:[u8 槽][i16 slotId][i16 stack]
    // [u8 prefix][i16 vid][u8 bits(favorited[0])]。vid=ITEM_DEFS 反查;无 vid 的
    // 原创物品发空（原版服不识,债在册）
    const item5 = (slotId: number, it: DiskItem) => this.mkItem5(slotId, it);
    const inv = pendingItems?.inventory;
    for (let i = 0; i < 59; i++) pkts.push(item5(SLOT.inv + i, inv?.[i]));
    const banks = pendingItems?.banks ?? [];
    const bags: Array<[number, DiskItem[] | undefined, number]> = [
      [SLOT.armor, pendingItems?.armor, 20], [SLOT.dye, pendingItems?.dye, 10],
      [SLOT.misc, pendingItems?.miscEquips, 5], [SLOT.miscDye, pendingItems?.miscDyes, 5],
      [SLOT.bank1, banks[0], 40], [SLOT.bank2, banks[1], 40],
      [SLOT.trash, pendingItems ? [pendingItems.trash] : undefined, 1],
      [SLOT.bank3, banks[2], 40], [SLOT.bank4, banks[3], 40],
    ];
    for (const [st, arr, n] of bags) for (let i = 0; i < n; i++) pkts.push(item5(st + i, arr?.[i]));
    const lds = pendingItems?.loadouts ?? [];
    for (let li = 0; li < 3; li++) {
      const ld = lds[li];
      for (let i = 0; i < 20; i++) pkts.push(item5(SLOT.ld1a + li * 30 + i, ld?.armor?.[i]));
      for (let i = 0; i < 10; i++) pkts.push(item5(SLOT.ld1d + li * 30 + i, ld?.dye?.[i]));
    }
    pkts.push(new VWriter().finish(MsgId.RequestWorldData)); // 空帧（主开关无 case 6）
    for (const f of pkts) this.send(f);
  }

  /** msg5 单帧构造（[u8 槽][i16 slotId][i16 stack][u8 prefix][i16 vid][u8 bits];
   *  无 vid 原创物品发空——原版服不识,债在册） */
  private mkItem5(slotId: number, it: { id: number; stack: number; favorited?: boolean; prefix?: number } | null | undefined) {
    const vid = it && it.stack > 0 ? (ITEM_DEFS[it.id]?.vid ?? 0) : 0;
    return new VWriter().u8(this.mySlot).i16(slotId)
      .i16(vid ? Math.max(0, it!.stack) : 0)
      .u8(vid ? (it!.prefix ?? 0) : 0)
      .i16(vid)
      .u8(vid && it!.favorited ? 1 : 0)
      .finish(MsgId.SyncEquipment);
  }

  /** 进世界后全量物品/属性再同步（本地权威背包 → 服务器）——覆盖两况:
   *  新角色起始包（loadWorld 授,初始 burst 时无随身态可传）与读档真装备的终拍
   *  对齐;服务器 CanRelay 中继给他人=远端纸娃娃渲染源。★SSC 服务器会反向覆盖
   *  （本端不消费己槽 msg5,SSC 债在册;rig 为非 SSC 原版服）。
   *  首拍全量;后续走差分（lastSentItems 快照比对,只发变化槽——拾取风暴
   *  （钱币串）从每拍 63 帧降到变化槽数,2026-10-25）。 */
  private lastSentItems: Array<{ id: number; stack: number; prefix?: number } | null> | null = null;
  syncFullInventory() {
    if (!this.active || !this.worldDelivered || this.mySlot < 0) return;
    const p = this.game.player as null | {
      hp: number; maxHp: number; mana: number; maxMana: number;
      inv: {
        slots: Array<{ id: number; stack: number; favorited?: boolean; prefix?: number } | null>;
        armor: Array<{ id: number; stack: number; favorited?: boolean; prefix?: number } | null>;
        dye: Array<{ id: number; stack: number; favorited?: boolean; prefix?: number } | null>;
        miscEquips: Array<{ id: number; stack: number; favorited?: boolean; prefix?: number } | null>;
        miscDyes: Array<{ id: number; stack: number; favorited?: boolean; prefix?: number } | null>;
      };
    };
    if (!p) return;
    // 本地快照（inv0-57+mouse58 空+armor59-78+dye79-88+misc89-93+miscDye94-98）
    type It = { id: number; stack: number; prefix?: number } | null;
    const snap: It[] = [];
    for (let i = 0; i < 58; i++) snap.push(p.inv.slots[i]);
    snap.push(null); // 58=mouse（清位）
    for (let i = 0; i < 20; i++) snap.push(p.inv.armor[i]);
    for (let i = 0; i < 10; i++) snap.push(p.inv.dye[i]);
    for (let i = 0; i < 5; i++) snap.push(p.inv.miscEquips[i]);
    for (let i = 0; i < 5; i++) snap.push(p.inv.miscDyes[i]);
    const full = this.lastSentItems === null;
    const pkts: Uint8Array[] = [];
    for (let i = 0; i < snap.length; i++) {
      const it = snap[i];
      const prev = full ? undefined : this.lastSentItems![i];
      if (!full && prev?.id === it?.id && prev?.stack === it?.stack && prev?.prefix === it?.prefix) continue;
      pkts.push(this.mkItem5(i, it));
    }
    this.lastSentItems = snap;
    // 属性终拍（msg16/42:服务器侧防御/生命权威输入——恒发,量小）
    pkts.push(new VWriter().u8(this.mySlot).i16(p.hp).i16(p.maxHp).finish(MsgId.PlayerLifeMana));
    pkts.push(new VWriter().u8(this.mySlot).i16(p.mana).i16(p.maxMana).finish(MsgId.PlayerMana));
    for (const f of pkts) this.send(f);
  }

  /** msg7 WorldData 全解析（63 字段序,金标 raw 镜像;含 ★1458 dungeonX/Y 增量） */
  private parseWorldData(r: VReader): {
    time: number; dayTime: boolean; bloodMoon: boolean; moonPhase: number;
    maxTilesX: number; maxTilesY: number; spawnX: number; spawnY: number;
    worldSurface: number; rockLayer: number; worldId: number; worldName: string;
    gameMode: number; dungeonX: number; dungeonY: number; crimson: boolean; maxRaining: number;
    extraSpawn: Array<[number, number]>;
  } {
    const d = { extraSpawn: [] as Array<[number, number]> } as ReturnType<VanillaClient['parseWorldData']>;
    d.time = r.i32();
    const b6 = r.u8();
    d.dayTime = !!(b6 & 1); d.bloodMoon = !!(b6 & 2);
    d.moonPhase = r.u8();
    d.maxTilesX = r.i16(); d.maxTilesY = r.i16();
    d.spawnX = r.i16(); d.spawnY = r.i16();
    d.worldSurface = r.i16(); d.rockLayer = r.i16();
    d.worldId = r.i32(); d.worldName = r.str();
    d.gameMode = r.u8();
    r.bytes(16); // Guid
    r.u64(); // WorldGeneratorVersion
    r.u8(); // moonType
    r.bytes(13); // setBG 序 0,10,11,12,1..9
    r.u8(); r.u8(); r.u8(); // ice/jungle/hellBackStyle
    r.f32(); // windSpeedTarget
    r.u8(); // numClouds
    r.i32(); r.i32(); r.i32(); // treeX
    r.bytes(4); // treeStyle
    r.i32(); r.i32(); r.i32(); // caveBackX
    r.bytes(4); // caveBackStyle
    r.bytes(13); // TreeTops.SyncReceive（AreaId.Count=13）
    d.maxRaining = r.f32();
    const flags = r.bytes(11); // b7..b17
    r.u8(); r.u8(); // sundial/moondial cooldown
    r.i16(); r.i16(); r.i16(); r.i16(); r.i16(); r.i16(); r.i16(); // oreTiers ×7
    r.i8(); // invasionType
    r.u64(); // LobbyId
    r.f32(); // Sandstorm.IntendedSeverity
    const espN = r.u8();
    for (let i = 0; i < espN; i++) d.extraSpawn.push([r.i16(), r.i16()]);
    d.dungeonX = r.i16(); d.dungeonY = r.i16(); // ★1458 网络面增量（CLAUDE.md 台账①）
    d.crimson = !!(flags[1] & 0x20); // b8[5]
    return d as {
      time: number; dayTime: boolean; bloodMoon: boolean; moonPhase: number;
      maxTilesX: number; maxTilesY: number; spawnX: number; spawnY: number;
      worldSurface: number; rockLayer: number; worldId: number; worldName: string;
      gameMode: number; dungeonX: number; dungeonY: number; crimson: boolean; maxRaining: number;
      extraSpawn: Array<[number, number]>;
    };
  }

  // ================= 引擎驱动面（Game.postUpdate 每逻辑帧） =================

  /** Game.postUpdate → net.tick()：msg13 逐拍上报（原版逐 tick 语义）+ 段维护 */
  tick() {
    if (!this.active || !this.worldDelivered) return;
    this.sendControls13();
    this.maintainSections();
  }

  private sendControls13() {
    const p = this.game.player as null | {
      x: number; y: number; vx: number; vy: number;
      facing: number; inputX: number; inputUp: boolean; inputDown: boolean; inputJump: boolean;
      gravDir: number; dead: boolean; mount?: { active?: boolean; type?: number };
      inv: unknown;
    };
    if (!p || p.dead) return;
    const sel = ((p.inv as { selected?: number })?.selected ?? 0) & 0xff;
    const inp = (this.game as { input?: { mouseDown: boolean; rightDown: boolean } }).input;
    // c1（NetMessage case13）：[0]up [1]down [2]left [3]right [4]jump [5]useItem [6]dir==1 [7]dash
    const c1 = (p.inputUp ? 1 : 0) | (p.inputDown ? 2 : 0)
      | (p.inputX < 0 ? 4 : 0) | (p.inputX > 0 ? 8 : 0)
      | (p.inputJump ? 16 : 0)
      | (inp?.mouseDown && !inp.rightDown ? 32 : 0)
      | (p.facing > 0 ? 64 : 0);
    const velNZ = p.vx !== 0 || p.vy !== 0;
    const mountActive = !!p.mount?.active;
    // c2：[0]pulley [1]pulleyDir2 [2]vel!=0 [3]vortexStealth [4]gravDir==1 [5]shieldRaised [6]ghost [7]mount
    const c2 = (velNZ ? 4 : 0) | (p.gravDir === 1 || p.gravDir === undefined ? 16 : 0)
      | (mountActive ? 128 : 0);
    const w = new VWriter().u8(this.mySlot).u8(c1).u8(c2).u8(0).u8(0).u8(sel)
      .f32(p.x).f32(p.y);
    if (velNZ) w.f32(p.vx).f32(p.vy);
    if (mountActive) w.u16(p.mount?.type ?? 0);
    this.send(w.finish(MsgId.PlayerControls));
  }

  /** 相机/玩家跨段（200×150）时请求 3×3 邻域（原版 ActiveSections.CheckSection 语义）
   *  + PvP/队伍变化轮询上报（msg30 TogglePVP/msg45 TeamChange——引擎 PvP UI 改
   *  player.hostile/team 本地态,变化沿经此上报,服务器广播给他人） */
  private lastHostile = -1;
  private lastTeam = -1;
  private maintainSections() {
    const p = this.game.player as null | { x: number; y: number; hostile?: boolean; team?: number };
    if (!p) return;
    if (this.lastHostile !== (p.hostile ? 1 : 0)) {
      this.lastHostile = p.hostile ? 1 : 0;
      this.send(new VWriter().u8(this.mySlot).u8(this.lastHostile).finish(30));
    }
    if (this.lastTeam !== (p.team ?? 0)) {
      this.lastTeam = p.team ?? 0;
      this.send(new VWriter().u8(this.mySlot).u8(this.lastTeam).finish(45));
    }
    const sx = Math.floor(p.x / 16 / SECTION_W), sy = Math.floor(p.y / 16 / SECTION_H);
    const key = sx + ',' + sy;
    if (key === this.lastSectionReqKey) return;
    this.lastSectionReqKey = key;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.send(new VWriter().i16(sx + dx).i16(sy + dy).finish(MsgId.RequestSection));
      }
    }
  }

  /** 服务器 TileSections 标记保活：段内有本地 tile 修改时 10s 冷却重请求一次 */
  private markedSectionAt = new Map<string, number>();
  private ensureSectionMarked(tx: number, ty: number) {
    const sx = Math.floor(tx / 200), sy = Math.floor(ty / 150);
    const k = sx + ',' + sy;
    const now = performance.now();
    const last = this.markedSectionAt.get(k) ?? 0;
    if (now - last > 10000) {
      this.markedSectionAt.set(k, now);
      this.send(new VWriter().i16(sx).i16(sy).finish(MsgId.RequestSection));
    }
  }

  /** 引擎面（Game.postUpdate 调用,坐标=世界像素）→ 段坐标请求 */
  requestSection(cx: number, cy: number) {
    const sx = Math.floor(cx / 16 / SECTION_W), sy = Math.floor(cy / 16 / SECTION_H);
    this.send(new VWriter().i16(sx).i16(sy).finish(MsgId.RequestSection));
  }

  // ================ ClientNet 鸭型桩面（SW 专有;P1-P4 按域接线） ================
  private todoLogged = new Set<string>();
  private todo(name: string) {
    if (!this.todoLogged.has(name)) { this.todoLogged.add(name); console.info('[vanilla-net] 未接线面:', name); }
  }
  /** 本地 tile 编辑上报（引擎 netReporter → msg17 TileManipulation;净流入重放走
   *  数组直写不经本面=无回声）。§TileOpAction 内部值→原版动作映射:
   *  SetTile→Kill/Place(vid=TILE_DEFS 反查 vanilla.sheet;墙域=同 id 段流直拷判例;
   *  Place style=fy/帧高 通用近似派生——2026-10-26 债清偿,见 Place 分支内注)。 */
  reportTileOp(op: import('../protocol').TileOp) {
    if (!this.active || !this.worldDelivered) return;
    // ★段标记保活（2026-10-26 幽灵破坏定谳）：服务器 msg17 门=TileSections[段]未标记
    // → KillTile(fail) 静默拒（不破坏+不修正+照样中继=全员本地幽灵破坏,重登复原）。
    // 修改前对所在段 10s 冷却刷新一次 msg159（服务器发送即标记）——门恒通。
    this.ensureSectionMarked(op.x, op.y);
    const send17 = (action: number, x: number, y: number, d1: number, d2 = 0) =>
      this.send(new VWriter().u8(action).i16(x).i16(y).i16(d1).u8(d2).finish(MsgId.TileManipulation));
    switch (op.a) {
      case TileOpAction.SetTile:
        if (op.v === 0) {
          send17(0, op.x, op.y, 0); // KillTile（服务器生成掉落物 msg21 广播）
        } else {
          const vid = TILE_DEFS[op.v]?.vanilla?.sheet;
          if (vid == null) return; // 原创内部 tile:原版服无对应面,不上报（服务器侧保持原状）
          // ★Place style 派生（2026-10-26 债清偿）:msg17 data2=样式变体索引（火把颜色/
          // 旗帜/门方向等——恒 0 则服务器侧落默认样式）。原版 TileObject 放置时 style 对应
          // frameY/帧高;此处通用近似 style=⌊fy/18⌋（多数 1x1 家具帧高 18,精确需逐 tile
          // 帧高表 18/22/36 等——P3 债清偿采用通用近似,超界由 u8 截断兜底）。
          const style = Math.floor(op.fy / 18);
          send17(1, op.x, op.y, vid, style);
        }
        return;
      case TileOpAction.SetWall:
        if (op.v === 0) send17(2, op.x, op.y, 0); // KillWall
        else if (op.v < 367) send17(3, op.x, op.y, op.v); // PlaceWall（墙域同 id）
        return;
      case TileOpAction.SetHalfBrick:
      case TileOpAction.SetSlope: {
        const slope = op.a === TileOpAction.SetHalfBrick ? 1 : Math.max(0, Math.min(4, op.v));
        send17(14, op.x, op.y, slope); // SlopeTile（1=半砖,2-4 斜面）
        return;
      }
      case TileOpAction.SetWire: {
        // ★差分债清偿（2026-10-26）：TileStore.setWire 报 {v:新 bits}——动作号由
        // 颜色位→动作表推导（vanilla msg17:5红/10蓝/12绿/16黄 布线;位缺=拆线 6/11/13/17）。
        // ★单色局限:一次 setWire 变多色位时逐位展开为多条 msg17（vanilla 客户端同款
        // 语义——电线工具逐色操作）。
        const RED = 1, BLUE = 2, GREEN = 4, YELLOW = 8; // TileStore.WIRE_* 位值
        const pairs: Array<[number, number, number]> = [
          [RED, 5, 6], [BLUE, 10, 11], [GREEN, 12, 13], [YELLOW, 16, 17],
        ];
        for (const [bit, place, kill] of pairs) {
          // 拆线:本地 setWire 后读不到旧值——但 sendWiringAction 的调用方（Wiring 域）
          // place/kill 单色路径已显式带位;此处兜底:bits 含位→布线动作（拆线路走
          // wiring 域显式通道,不进 setWire 的净差异——单色工具恒定单 bit 变更,含=布）
          if (op.v & bit) send17(place, op.x, op.y, 0);
        }
        return;
      }
      default:
        return; // SetActuated:19 翻转无值面（显式通道覆盖）
    }
  }
  /** 傀儡受击上报（Enemy.hurt 傀儡分支 → entityNet.reportStrike → msg28 DamageNPC:
   *  [u8 槽][u8 代际][i16 伤害][f32 击退模][u8 向+1][u8 暴击]。★代际必携——服务器
   *  校验代际错=静默丢（傀儡槽已换主）。击退组件→模+向。服务器结算后 msg23 回流
   *  权威 hp + msg162 DamageNPCAck（本端无挂起伤害,纯吃 ack 无动作）。 */
  sendStrike(netId: number, rawDmg: number, kbx: number, kby: number) {
    if (!this.active || !this.worldDelivered) return;
    const kb = Math.hypot(kbx, kby);
    const dir = (Math.sign(kbx) || 1) + 1;
    this.send(new VWriter()
      .u8(netId).u8(this.npcGenerations.get(netId) ?? 0)
      .i16(rawDmg).f32(kb).u8(dir).u8(0)
      .finish(28));
  }
  /** PvP 命中上报（msg117 PlayerHurtV2 攻端向——Player.cs:44490 近战/Projectile.cs:14757
   *  弹幕 PvP 命中→SendPlayerHurt→SendData(117,victim,dmg,dir,bits,hitContext)）。
   *  线序=读侧镜像:[u8 受害槽][DeathReason][i16 伤][u8 向+1][u8 bits(crit0/pvp1)][i8 冷却]。
   *  服务器门=双方 hostile（MessageBuffer case117 头）才受理+广播。 */
  sendStrikePlayer(targetSlot: number, rawDmg: number, kbx: number, kby: number, weaponId: number, flags: number) {
    if (!this.active || !this.worldDelivered) return;
    const weaponVid = weaponId ? (ITEM_DEFS[weaponId]?.vid ?? 0) : 0;
    const w = new VWriter()
      .u8(targetSlot)
      // DeathReason:源玩家（己槽）+源武器 vid（bit0|bit5 语义,PlayerDeathReason.Serialize）
      .u8(weaponVid ? 0x21 : 0x01).i16(this.mySlot);
    if (weaponVid) w.i16(weaponVid);
    w.i16(rawDmg).u8((Math.sign(kbx) || 1) + 1)
      .u8((flags & 1) | 2) // crit 位透传 + pvp 位恒置
      .i8(0);
    this.send(w.finish(117));
  }
  sendBestiaryEvent() { this.todo('sendBestiaryEvent'); }
  getProxyPvpImmuneRemaining(): number { return 0; }
  sendSummonIntent() { this.todo('sendSummonIntent'); }
  /** 电线操作直发（msg17 电线动作 5-13/16-17/19:布线四色/拆线/致动/翻转）。
   *  Wiring 域的引擎面上报经此通道（TileOpAction.SetWire 的差分债由此消解:
   *  wiring 域直发动作号,无旧值歧义）。 */
  sendWiringAction(action: number, x: number, y: number) {
    if (!this.active || !this.worldDelivered) return;
    if (action < 5 || (action > 13 && action !== 16 && action !== 17 && action !== 19)) return;
    this.ensureSectionMarked(x, y);
    this.send(new VWriter().u8(action).i16(x).i16(y).i16(0).u8(0).finish(MsgId.TileManipulation));
  }

  /** 晶塔消息（module8 vanilla 子型：sub2 传送请求 [i16 x][i16 y][u8 type]——
   *  原版 NetTeleportPylonModule.Deserialize case PlayerRequestsTeleport 同构;
   *  服务器 HandleTeleportRequest 门禁五连后 Teleport+SendData(65) 广播） */
  sendPylonMessage(msg: { sub: number; x: number; y: number; type: number }) {
    if (!this.active || !this.worldDelivered) return;
    if (msg.sub !== 2) return; // sub0/1=房主权威差集广播——vanilla 客户端不发
    this.send(new VWriter().u16(8).u8(2).i16(msg.x).i16(msg.y).u8(msg.type).finish(MsgId.NetModules));
  }
  sendLeashedRemove() { this.todo('sendLeashedRemove'); }
  sendLeashedPlaceRequest() { this.todo('sendLeashedPlaceRequest'); }
  sendLeashedFull() { this.todo('sendLeashedFull'); }
  sendLeashedRetrieveRequest() { this.todo('sendLeashedRetrieveRequest'); }
  /** 傀儡拾取上报（op1 take/op3 残余）——vanilla 语义=客户端权威背包:
   *  本地拾取后重传背包（msg5 全量,500ms 节流合批）,服务器侧物品由其自身
   *  WorldItem.FindOwner/重叠检测清理（我方 msg13 位置在服侧驱动）——无 SW 协议
   *  的显式 take 报文,收敛靠「背包终拍+服务器自清」。 */
  private itemSyncPending = false;
  sendItemOp(op: number) {
    if (!this.active || !this.worldDelivered) return;
    if (op !== 1 && op !== 3) return;
    if (this.itemSyncPending) return;
    this.itemSyncPending = true;
    setTimeout(() => {
      this.itemSyncPending = false;
      if (this.active) this.syncFullInventory();
    }, 500);
  }
  sendChestOpenState() { this.todo('sendChestOpenState'); }
  sendAnglerQuestAssert() { this.todo('sendAnglerQuestAssert'); }
  reportLiquidChange() { /* P3：液体服务器权威,客户端本地变更即静默 */ }
  sendTEModule() { this.todo('sendTEModule'); }
  /** 请求开箱（msg31 [i16 x][i16 y]——服务器查箱→回 32×40+33;金标 case31） */
  requestChestOpen(x: number, y: number) {
    this.send(new VWriter().i16(x).i16(y).finish(31));
  }

  /** 箱槽编辑上报（vanilla msg32 同型:[chestId][slot][stack][prefix][vid];
   *  编辑者本地已乐观生效,服务器广播纠正面走接收支） */
  sendChestSlot(chestIdx: number, _x: number, _y: number, slot: number, itemId: number, stack: number, prefix = 0) {
    if (!this.active) return;
    const vid = itemId ? (ITEM_DEFS[itemId]?.vid ?? 0) : 0;
    this.send(new VWriter()
      .i16(chestIdx).u8(slot).i16(vid ? Math.max(0, stack) : 0).u8(vid ? prefix : 0).i16(vid)
      .finish(MsgId.SyncChestItem));
  }
  journeyPowerAvailable(): boolean { return false; }
  sendSpectateFocus() { this.todo('sendSpectateFocus'); }
  sendSeasonAssert() { this.todo('sendSeasonAssert'); }
  sendParticleOrchestra() { this.todo('sendParticleOrchestra'); }
  sendMapPing() { this.todo('sendMapPing'); }
  sendEmote() { this.todo('sendEmote'); }
  sendDryadStardewAnim() { this.todo('sendDryadStardewAnim'); }
  sendDoorEvent() { this.todo('sendDoorEvent'); }
  sendCommandLine() { this.todo('sendCommandLine'); }
  /** 聊天上行（NetTextModule.SerializeClientMessage :14-18 + ChatMessage.Serialize
   *  ChatMessage.cs:28-33）：[str 命令名][str 文本];普通发言命令名 "Say"
   *  （SayChatCommand.cs:6 [ChatCommand("Say")]）。本地回显由 Game.sendChat 负责。 */
  sendChat(text: string) {
    this.send(new VWriter().u16(1).str('Say').str(text).finish(MsgId.NetModules));
  }
  sendAnglerFinishedClaim() { this.todo('sendAnglerFinishedClaim'); }
  resendAppearance() { this.todo('resendAppearance'); }
  notifyCameraTarget() { /* 观战目标上报：vanilla 面后续接 */ }
  notifyPlayerHurtSettled() { /* victim-settles 为 SW 协议语义 */ }
  /** 受伤上报（victim-settles：Player.Hurt 客户端面 :38662 SendPlayerHurt——本地
   *  结算的接触/环境伤害向服务器报 msg117（服务器校验后广播）;死亡必发。
   *  线序=攻端 sendStrikePlayer 同型（DeathReason 源玩家=己槽,环境伤无凶器）。 */
  sendPlayerHurt(dmg: number, x: number, y: number, dir: number, flags: number) {
    if (!this.active || !this.worldDelivered) return;
    void x; void y;
    const w = new VWriter()
      .u8(this.mySlot)
      .u8(0x01).i16(this.mySlot) // DeathReason:源玩家=己槽（无凶器位）
      .i16(dmg).u8((dir >= 0 ? 1 : -1) + 1)
      .u8(flags & 0xff)
      .i8(0);
    this.send(w.finish(117));
  }
  /** 自家弹幕上传（引擎快照批 → msg27 SyncProjectile）。
   *  ProjectileKey 打包（ProjectileKey.cs:spawner 8b|index 10b|gen 14b）——
   *  spawner=己槽,index=本端滚动序（0-1000 回绕）,SW netId→key 稳定映射。
   *  最小位集：仅 damage 位（0x10）;ai 段不发（箭族 0 恒等）。kind≠0 族
   *  （回旋镖/魔法/mod 弹）映射面 P3 债,先跳过。 */
  private projKeys = new Map<number, number>();
  private projIndex = 1; // ★从 1 起：key=0（槽0×index0）被服务器当空键重派 spawner=255
                         // → 中继时 "owner must match spawner" invariant 爆炸丢帧（rig 实弹定谳）
  private projKeyOf(swNetId: number): number {
    let k = this.projKeys.get(swNetId);
    if (k === undefined) {
      k = ((this.mySlot & 0xff) | ((this.projIndex & 0x3ff) << 8));
      this.projIndex = (this.projIndex + 1) % 1001 || 1;
      this.projKeys.set(swNetId, k);
    }
    return k;
  }

  sendProjectileBatch(snaps: ProjSnap[]) {
    if (!this.active || !this.worldDelivered) return;
    for (const s of snaps) {
      const k7 = s.kind & 0x3f;
      if (k7 !== 0 && k7 !== 1) continue; // 0=直飞/1=武器族（tag 均为 vid）;4=色串/11=机件 P3 映射债
      const vid = parseInt(s.tag, 10);
      if (!Number.isFinite(vid) || vid <= 0) continue;
      this.send(new VWriter()
        .i32(this.projKeyOf(s.netId))
        .f32(s.x).f32(s.y).f32(s.vx).f32(s.vy)
        .i16(vid).u8(0x10).i16(s.dmg)
        .finish(MsgId.SyncProjectile));
    }
  }

  /** 自家弹幕击杀上报（msg29 KillProjectile [i32 key][Vector2]——服务器按 key 摘除） */
  sendProjDespawn(ids: number[]) {
    if (!this.active || !this.worldDelivered) return;
    for (const id of ids) {
      const k = this.projKeys.get(id);
      if (k === undefined) continue;
      this.projKeys.delete(id);
      this.send(new VWriter().i32(k).f32(0).f32(0).finish(MsgId.KillProjectile));
    }
  }
  sendCreditsRoll() { this.todo('sendCreditsRoll'); }
  sendNpcSnapshot() { /* 服务器权威 NPC——客户端不发快照 */ }
  sendJourneyWorldState() { this.todo('sendJourneyWorldState'); }
  sendJourneyPersonalState() { this.todo('sendJourneyPersonalState'); }
  sendJourneyTimeSkip() { this.todo('sendJourneyTimeSkip'); }
  sendJourneyUnlock() { this.todo('sendJourneyUnlock'); }
  sendJourneyPermission() { this.todo('sendJourneyPermission'); }
  sendMapPingProbe() { this.todo('sendMapPingProbe'); }
  sendSeasonBitsModule() { this.todo('sendSeasonBitsModule'); }
}
