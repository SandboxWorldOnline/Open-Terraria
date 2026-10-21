// HitWireSingle 器件分发表(Wiring.cs:829-2282 全表移植)。
// Wiring.ts 处理牵扯内部状态的核心 case(144 计时器/419 门灯/235 传送器/142-143 泵/429 彩线灯泡),
// 其余 case 在此按原版逐条移植;NetMessage 跳过(单机)。
// 行为无对应引擎系统的器件(音乐盒/派对/天塔柱等)按"帧翻转 + toast 占位"处理,注释标明。
import type { Wiring } from '../Wiring';
import { PREVENTS_ACTUATION_UNDER } from '../Wiring';
import type { TrapShotKind } from '../../entities/Dart';
import { TILE_BY_KEY } from '../../data/tiles';
import { flipSwitchTrack } from '../MinecartTrack';
import { shiftTallGate, shiftTrapdoor } from '../Door';

/** 器件运行环境(Game 实现;保持窄接口以便单测注入) */
export interface DeviceCtx {
  /** 按原版 item id 掉落物品 */
  dropItem(vanillaItemId: number, px: number, py: number): void;
  /** 按原版 npc id 生成敌人(雕像刷怪;返回是否成功) */
  spawnNpc(vanillaNpcId: number, px: number, py: number): boolean;
  /** NPC.MechSpawn（NPC.cs:7399-7483）：同 type（含等价组）200px≥3 / 600px≥6 / 全图≥10 拒绝 */
  mechSpawnOk(px: number, py: number, type: number): boolean;
  /** Item.MechSpawn（Item.cs:48982-49013）：同 item 300px≥3 / 800px≥6 / 全图≥10 拒绝 */
  itemSpawnOk(px: number, py: number, type: number): boolean;
  /** 投射物(飞镖/火焰/尖刺球/炮弹/雪球/烟花族):vx/vy px/tick。
   *  form = 传送门弹 601 的 ai[0]（WorldGen.cs:50622-50631：ammo4→0 橙 / ammo5→1 蓝）；
   *  烟花族 = 色变体（167-170 / 415-418 / 419-422 减基址）。
   *  anchor = 喷泉弹锚点 tile（Projectile.ai[0]/ai[1]，Wiring.cs:1548） */
  shootProjectile(px: number, py: number, vx: number, vy: number, damage: number, kind: TrapShotKind, form?: number, anchor?: [number, number]): void;
  /** 喷泉去重（Wiring.cs:1529-1545）：同锚点是否已有 aiStyle73 弹在喷 */
  hasFountainAt?(tx: number, ty: number): boolean;
  /** 统计附近某类投射物数量(兔兔炮场内上限用;尖刺球预算扫描 1457 :1819-1826 为
   *  原版死代码——type==num96 比较发生在 num96=185 赋值前 → 无预算上限,不再消费) */
  countProjectiles(kind: 'spiky' | 'bunny', px: number, py: number, radius: number): number;
  /** 已退役(2026-08-23 尖刺球 1457 对齐):原 1456 case -7 死分支预算表,活跃分支
   *  (1456/1457 :1819-1826)的扫描自死,保留成员仅为 Game.ts ctx 兼容 */
  spikyBudgetPenalty?(px: number, py: number): number;
  /** 门开关(原版 HitWireSingle 10/11:随机方向+反向重试) */
  doorOpen(x: number, y: number): boolean;
  doorClose(x: number, y: number): boolean;
  /** 传送器对:搬迁判定框内的玩家/敌人(原版 Teleport :2314-2365) */
  teleportPair(a: [number, number], b: [number, number]): void;
  /** 城镇 NPC 搬迁雕像(style 40/41):group 0/1 白名单,搬到 (px,py) */
  relocateTownNpc(group: 0 | 1, px: number, py: number): boolean;
  /** 爆炸(炸药 108/地雷 164/炮弹):范围伤害+清格+粒子;projId=死亡归因的投射物
   *  (Wiring.cs case141→NewProjectile 108 Explosives / ExplodeMine→164 Landmine);
   *  hurtBox=实体伤害盒半宽 px（SW-R3 2026-09-03 F-5：108=130/164=64,SetDefaults 盒;
   *  缺省回落 R*TILE 旧行为） */
  explode(tx: number, ty: number, damage: number, radius?: number, destroyTiles?: boolean, hurtBox?: number, projId?: number): void;
  toast(msg: string): void;
  sfx(name: string, x?: number, y?: number): void; // 带坐标时按距离衰减/超距静音
  /** 广播盒（425）：锚点 (x,y) 起的 2×2 内告示牌文本广播；无牌由引擎侧静默 */
  announce?(x: number, y: number): void;
  /** 派对纪念碑（455）：BirthdayParty.ToggleManualParty */
  toggleParty?(): void;
  /** 提取机通电转化（Wiring.cs:2572-2592 Extractinator）：锚点邻域箱子里自后向前找
   *  首个可提取物，消耗 1 并返回产物 {itemType, stack}；无箱/箱内无可转化返回 null */
  extractinatorPull(ax: number, ay: number, blockType: number): { itemType: number; stack: number } | null;
  /** 按原版 item id 掉落指定数量（提取机产物带 stack，钱币走 coin 体系） */
  dropItemStack(vanillaItemId: number, stack: number, px: number, py: number): void;
  /** worldSurface(部分器件判定) */
  worldSurface: number;
  /** 派对进行中（★R20-G4 兔子雕像派对变体 Wiring.cs:2306-2317 BirthdayParty.PartyIsUp） */
  partyIsUp?(): boolean;
  /** ★R20-I8:格区无实体(Collision.EmptyTile ignoreTiles 等价——活板门/高门关门
   *  前查目标格,WorldGen.cs:51931-51932/:51955-51956;实体占位拒换) */
  areaEmpty?(x: number, y: number, w: number, h: number): boolean;
  /** ★BJ322（2026-09-24）：ShiftTallGate 尾 TileFrame 面（:52224-52231）注入——
   *  导线切换高门走裸写窗后由 Game 侧扫面收口完整性/邻件复检 */
  afterWrite?(ax: number, ay: number): void;
  /** ★BJ324（2026-09-24）：ShiftTrapdoor 尾 TileFrame 逐格面（WorldGen.cs:51925-51929/
   *  :51950-51954/:52034-52040）注入——导线切换活板门后由 Game 侧逐格扫面
   *  （checkDecorSquareFrame 等价;幂等,件内任一格评估=整件裁决） */
  tileFrame?(x: number, y: number): void;
  /** 魔幻日晷/月晷快进（Wiring.cs:1150/:1168 → Main.Sundialing/Moondialing :6304/:6319：
   *  fastForwardTimeToDawn/Dusk=true + cooldown=8；冷却中/已在快进则静默） */
  timeSkip?(kind: 'dawn' | 'dusk'): void;
}

/** 宝石块 off/on id 对(255-261 off ↔ 262-268 on,±7;Wiring.cs:863-873) */
const GEMSPARK_OFF = ['v_255_amethystgemsparkoff', 'v_256_topazgemsparkoff', 'v_257_sapphiregemsparkoff',
  'v_258_emeraldgemsparkoff', 'v_259_rubygemsparkoff', 'v_260_diamondgemsparkoff', 'v_261_ambergemsparkoff'];
const GEMSPARK_ON = ['v_262_amethystgemspark', 'v_263_topazgemspark', 'v_264_sapphiregemspark',
  'v_265_emeraldgemspark', 'v_266_rubygemspark', 'v_267_diamondgemspark', 'v_268_ambergemspark'];

/** 通电石/宝石块等的成对 tile id 切换 */
function swapTile(w: Wiring, x: number, y: number, fromKey: string, toKey: string): void {
  const st = w.st;
  if (!st.inBounds(x, y)) return;
  const i = st.idx(x, y);
  const cur = st.type[i];
  const from = TILE_BY_KEY[fromKey], to = TILE_BY_KEY[toKey];
  if (cur === from) st.setTile(x, y, to, st.frameX[i], st.frameY[i]);
  else if (cur === to) st.setTile(x, y, from, st.frameX[i], st.frameY[i]);
}

/** case 130 门用 CanKillTile（Wiring.canKillTile 公开转发;R20-I6） */
function canKillTileAt(w: Wiring, x: number, y: number): boolean {
  return w.canKillTile(x, y);
}

/** 多格器件整体翻帧(篝火/壁炉/吊灯等通用模式,Wiring.cs:1003-1052 等):
 *  锚点 = (x - frameX%blockW/18, y - frameY%blockH/18);delta 由锚点帧阈值定;整体 SkipWire */
/** 多格块锚点归一 + 整块帧翻转。
 *  锚点折叠 = frame % (tiles×18) / 18——统一规律覆盖原版全部 Toggle 变体：
 *  状态位（delta）与样式页都是块宽（tiles×18）的整数倍，模后只剩块内偏移
 *  （ToggleHangingLantern 的 fy 折 2 / Toggle2x2Light 的 fx 折 2 / ToggleChandelier
 *  的 fx%108+折 3 / ToggleFirePlace 的 fx%54·fy%36 均与本式等价）。
 *  ★此前 blockW/blockH 由调用点手传，6 处误传「页宽」（72/108）而非「块宽」
 *  （36/54/18）——状态位渗进列偏移：灯笼 fx=18 灭档被当列 1 → 锚点挪到空气列
 *  （开关点灯无反应，2026-08-17 用户报告）；2×2 灯/造雾机/大火山/巴斯特雕像
 *  亮档 fx≥36 锚点整体偏移 → 翻错块。块宽一律由 tilesW/tilesH 推导，参数删除 */
export function flipBlock(
  w: Wiring, x: number, y: number,
  tilesW: number, tilesH: number,
  axis: 'x' | 'y', threshold: number, delta: number,
  /** 越阈值时的反向步长(缺省 = -delta)。★R20-I13:烟囱 406 原版越 108 时 -108
   *  （Wiring.cs:1071-1091:num22=54,anchor.frameY>=108 → -108）= 0→54→108→0 三态;
   *  统一 -delta 会走 108→54 死循环,永回不到关态 */
  deltaNeg?: number,
  /** ★R20-I11:整块同型校验(WorldGen.ValidateTileSquareIsActiveAndOfType——
   *  篝火 ToggleCampFire Wiring.cs:3025 / 巴斯特 :2526 先验后翻,残块/混型不动) */
  requireUniform = false,
): void {
  const st = w.st;
  const i = st.idx(x, y);
  const ox = x - Math.floor(st.frameX[i] % (tilesW * 18) / 18);
  const oy = y - Math.floor(st.frameY[i] % (tilesH * 18) / 18);
  let d = delta;
  const ai = st.idx(ox, oy);
  if (axis === 'y' ? st.frameY[ai] >= threshold : st.frameX[ai] >= threshold) d = deltaNeg ?? -delta;
  if (requireUniform) {
    const sh0 = w.sheetOf(ox, oy);
    for (let ix = ox; ix < ox + tilesW; ix++) {
      for (let iy = oy; iy < oy + tilesH; iy++) {
        const ii = st.inBounds(ix, iy) ? st.idx(ix, iy) : -1;
        if (ii < 0 || st.flags[ii] === 0 || w.sheetOf(ix, iy) !== sh0) return;
      }
    }
  }
  // ★BJ322（2026-09-24）：整块帧翻包 suppressListeners 裸写窗——原版灯族/吊灯翻转
  //  = `Main.tile[k,l].frameX += num` 直赋（Wiring.cs:1381-1387 灯 2×2 族/
  //  ToggleChandelier :1754-1774 34 吊灯 3×3 同式）【无逐格 TileFrame】,尾仅
  //  SendTileSquare。逐格 setTile 即时派发会把带基混写态交给 Check* 完整性
  //  （34 'hangs' 3×3 帧比对:53300-53310 / 95·126 'hang2x2'）→ 中途判坏整件清
  //  +误掉落（探针实测吊灯/灯笼导线开关 0 存活+掉本体,与机关门/宝石锁同族疾病）。
  st.suppressListeners = true;
  try {
    for (let ix = ox; ix < ox + tilesW; ix++) {
      for (let iy = oy; iy < oy + tilesH; iy++) {
        if (!st.inBounds(ix, iy)) continue;
        const ii = st.idx(ix, iy);
        w.skipCell(ix, iy);
        if (axis === 'y') st.setTile(ix, iy, st.type[ii], st.frameX[ii], st.frameY[ii] + d);
        else st.setTile(ix, iy, st.type[ii], st.frameX[ii] + d, st.frameY[ii]);
      }
    }
  } finally {
    st.suppressListeners = false;
  }
  // ★X4 清偿刀C（2026-09-29）BJ361 同族三站补派发②：窗后对【写入域】逐格补派发
  //  （TileStore.notifyChanged,BJ361 原语）——BJ322 立窗时只治了 Door 四站,本站漏接
  //  = 灯族/吊灯等约 15 器件档（deviceTable flipBlock 消费点 :686/:699/:702/:705/
  //  :708/:892/:908/:985/:988/:991/:1022/:1033/:1042）导线开关贴图不变化,且
  //  LightingEngine dirty 不置（LightingEngine.ts:186 onTileChanged 订阅）=灯光不更新。
  //  域=写入 tilesW×tilesH 块（inBounds 守卫与写入循环逐格同构,补派发在窗【后】
  //  ——挪进窗内=半写态派发,BJ361 M2b 判别面教训;Door.shiftTallGate :243 同范式）。
  for (let ix = ox; ix < ox + tilesW; ix++) {
    for (let iy = oy; iy < oy + tilesH; iy++) {
      if (!st.inBounds(ix, iy)) continue;
      st.notifyChanged(ix, iy);
    }
  }
}

/** 单格帧翻转(火把/蜡烛等)。★BJ322：裸写窗同 flipBlock（原版 ToggleCandle/
 *  火把臂 = frameX 直赋无 TileFrame） */
export function flipCell(w: Wiring, x: number, y: number, delta: number): void {
  const st = w.st;
  if (!st.inBounds(x, y)) return;
  const i = st.idx(x, y);
  let d = delta;
  if (st.frameX[i] >= delta) d = -delta;
  st.suppressListeners = true;
  try {
    st.setTile(x, y, st.type[i], st.frameX[i] + d, st.frameY[i]);
  } finally {
    st.suppressListeners = false;
  }
  // ★X4 清偿刀C（2026-09-29）BJ361 同族三站补派发③：窗后写入格补派发（同 flipBlock
  //  注）——火把 66/蜡烛族 δ=18（deviceTable :655/:683/:741/:1045 消费）漏接站,
  //  贴图不变化+LightingEngine dirty 不置。单格域,窗【后】派发。
  st.notifyChanged(x, y);
}

// ============ 器件态机族：八音盒 / 喷泉 / 天塔柱（原版"帧带 = 开关态"系统） ============
// 原版语义：Switch* 只翻帧（WorldGen.cs:50977-51209），激活态由 SceneMetrics 每帧扫描
// 视区 tile 帧读出（SceneMetrics.cs:471-585）→ BGM 覆盖（Main.cs:11002）/ 水色
// （Main.cs:56766-56770）/ 天空滤镜（SceneState.cs:111-115）。下方 *Of 为扫描侧共用读取器。

/** 音乐盒 style → MusicID 全表（Main.cs:11002-11403 ActiveMusicBox if-chain，100 条；
 *  style = tile 139 frameY/36，即放置物品 placeStyle = 曲目号）。
 *  style 100 = 静音（SceneMetrics.cs:474-480 frameY/36==100 → MusicBoxSilence，
 *  Main.cs:11405-11440 flag2 → _musicSilencerCounter 240t 渐弱——Music.ts 返回 0 等价） */
export const MB_STYLE_TO_MUSIC: readonly number[] = [
  1, 2, 3, 6, 4, 5, 7, 8, 10, 9,
  12, 11, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 29, 30, 31,
  32, 33, 38, 37, 35, 36, 34, 39, 40, 41,
  44, 48, 42, 43, 46, 47, 49, 51, 52, 53,
  54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
  64, 65, 66, 67, 68, 69, 70, 71, 72, 73,
  74, 75, 76, 77, 78, 79, 80, 81, 82, 83,
  84, 85, 86, 87, 88, 89, 90, 91, 93, 96,
  95, 94, 97, 98, 92, 99, 101, 100, 104, 103,
];

/** 喷泉 style → 水色 id（SceneMetrics.cs:488-523 frameX/36 → ActiveFountainColor） */
const FOUNTAIN_COLOR = [0, 12, 3, 5, 2, 10, 4, 9, 8, 6];

/** 八音盒态（SceneMetrics.cs:471-486）：frameX≥36 = 开；曲目 = frameY/36；-1 = 关 */
export function musicBoxStyleOf(frameX: number, frameY: number): number {
  if (frameX < 36) return -1;
  return Math.floor(frameY / 36);
}

/** 喷泉态（SceneMetrics.cs:487-523）：frameY≥72 = 开；-1 = 关 */
export function fountainColorOf(frameX: number, frameY: number): number {
  if (frameY < 72) return -1;
  return FOUNTAIN_COLOR[Math.floor(frameX / 36)] ?? -1;
}

// ============ 音乐盒物品表（Item.cs DefaultToMusicBox + WorldGen.GetItemDrop_MusicBoxes） ============

/** 空音乐盒物品（ItemID.MusicBox = 576，Item.cs:8082-8089：accessory 无 createTile）。
 *  录音入口：装备在配饰槽时按当前 BGM 变身（Player.cs:15053） */
export const MUSIC_BOX_EMPTY_VID = 576;

// ★2026-09-03 表体抽出至 data/musicBoxStyles.ts（叶子模块,TDZ 断环——items.ts
//  顶层面读本表而本模块 import 子树回流 items,tiles/Wiring 链序先于本表执行时
//  冷启动炸 boot）。此处导入+re-export 兼容既有消费方。 */
import { MUSIC_BOX_ITEM_BY_STYLE } from '../../data/musicBoxStyles';
export { MUSIC_BOX_ITEM_BY_STYLE };

/** MusicID.Sets.CanBeRecorded（MusicID.cs:9）：全集可录，仅 {0,28,45,102} 除外 */
const MUSIC_NOT_RECORDABLE = new Set([0, 28, 45, 102]);
/** Main.maxMusic（Main.cs:435） */
const MAX_MUSIC = 105;

/** 录音（Player.cs:15053-15366 ApplyEquipFunctional 1:1）：装备空盒 576 时按当前
 *  BGM（Main.curMusic）掷 1/540 → 录得对应唱片物品 vid。
 *  门：curMusic ∈ (0,105] 且 CanBeRecorded；style = MB_STYLE_TO_MUSIC.indexOf(curMusic)
 *  （= 原版 curMusic→num3/if-chain 的逆映射），无映射（如 50 TitleIntro）返回 -1。
 *  注：原版先播 Item166 再判映射——无映射时只响声不变身，由调用方复刻 */
export function musicBoxRecordItem(curMusic: number): number {
  if (curMusic <= 0 || curMusic > MAX_MUSIC) return -1;
  if (MUSIC_NOT_RECORDABLE.has(curMusic)) return -1;
  const style = MB_STYLE_TO_MUSIC.indexOf(curMusic);
  if (style < 0) return -1;
  return MUSIC_BOX_ITEM_BY_STYLE[style] ?? -1;
}

/** 音乐盒掉落（WorldGen.cs:51221-51295 CheckMB）：style = frameY/36（破坏前帧），
 *  掉 GetItemDrop_MusicBoxes(style)；越界 style 兜底空盒 576 */
export function musicBoxDropItemOf(style: number): number {
  return MUSIC_BOX_ITEM_BY_STYLE[style] ?? 576;
}

/** 喷泉 style → 物品 vid（WorldGen.cs:38199-38226 Check2xX case 207：
 *  0→909 纯净 / 1→910 沙漠 / 2-7→938+style 丛林·冰雪·腐化·猩红·神圣·血月 /
 *  8→4922 洞穴 / 9→4417 绿洲；Item.cs createTile=207 placeStyle 互为逆表） */
export const FOUNTAIN_ITEM_BY_STYLE: readonly number[] = [909, 910, 940, 941, 942, 943, 944, 945, 4922, 4417];

/** 喷泉掉落：style = frameX/36（破坏前帧）；越界返回 -1（Check2xX default 不掉） */
export function fountainDropItemOf(style: number): number {
  return FOUNTAIN_ITEM_BY_STYLE[style] ?? -1;
}

/** 广播盒播报（Wiring.cs:1204-1217 1:1）：读锚点告示牌 → 粉色多行聊天公告。
 *  - 无登记 / 空白文本 → null（:1208-1211 静默返回）
 *  - Color.Pink = (255,105,180)；NewTextMultiline WidthLimit=460（RemadeChatMonitor
 *    单条容器内按 460px 折行；色值与宽度原样透传给聊天渲染层）
 *  - AnnouncementBoxDisabled / AnnouncementBoxRange：设置系统未接，恒可用 + 全图
 *    （默认值 false / -1，Main.cs 设置项） */
export function announcementBoxBroadcast(signText: string | null | undefined): { text: string; r: number; g: number; b: number; width: number } | null {
  if (signText == null || signText.trim() === '') return null;
  return { text: signText, r: 255, g: 105, b: 180, width: 460 };
}

/** 广播盒触发全链（Wiring.cs:1185-1217）：Sign.ReadSign(anchor, CreateIfMissing:false)
 *  ——按锚点精确查 Main.sign 登记（Sign.cs:36-44 逐项比对 x/y），无登记/空白文本
 *  静默（:1208-1211 return）；命中 → 粉色多行公告（NewTextMultiline） */
export function announcementBoxMessage(
  signs: ReadonlyArray<{ x: number; y: number; text: string }>,
  x: number, y: number,
): { text: string; r: number; g: number; b: number; width: number } | null {
  const sign = signs.find((s) => s.x === x && s.y === y);
  return announcementBoxBroadcast(sign?.text);
}

/** 天塔柱类型（SceneMetrics.cs:524-541）：410=style(frameX/36, 0星璇/1星云/2星尘/3耀斑)、
 *  509=4 月总；-1 = 关。480 血月柱走 bloodMoonMonolithOf。
 *  【依赖登记】657 回声/658 微光/720 CRT/721 复古/725 黑白/733 收音机柱的屏幕滤镜未接入 */
export function monolithTypeOf(sheet: number, frameX: number, frameY: number): number {
  if (sheet === 410) return frameY >= 56 ? Math.floor(frameX / 36) : -1;
  if (sheet === 509) return frameY >= 56 ? 4 : -1;
  return -1;
}

/** 血月柱（SceneMetrics.cs:542-546：480 frameY≥54 → BloodMoonMonolith →
 *  Main.cs:61417 并入 BloodMoonActive） */
export function bloodMoonMonolithOf(sheet: number, frameY: number): boolean {
  return sheet === 480 && frameY >= 54;
}

/** SwitchMB（WorldGen.cs:51413-51456 1:1）：八音盒 139 / 南瓜灯 35 共用。
 *  锚点：num3 = frameY/18 对 2 取余（行内偏移）、num4 = frameX/18 ≥2 再减 2（列内偏移）；
 *  2×2 区内 139/35 格 frameX ±36（<36 → +36，否则 -36），整体 SkipWire。
 *  ★R20-A9:SkipWire 有 `if (Wiring.running)` 门（:51449-51455）——右键路径
 *  （running=false）不得写 skip,否则残留 4 格吞掉下一次 BFS 的信号。
 *  ★R20-I19:翻帧格须 active()（:51436 幽灵格照翻=原版不翻） */
export function switchMB(w: Wiring, x: number, y: number): void {
  const st = w.st;
  const i = st.idx(x, y);
  let num3 = Math.floor(st.frameY[i] / 18);
  while (num3 >= 2) num3 -= 2;
  let num4 = Math.floor(st.frameX[i] / 18);
  if (num4 >= 2) num4 -= 2;
  const ox = x - num4, oy = y - num3;
  for (let k = ox; k < ox + 2; k++) {
    for (let l = oy; l < oy + 2; l++) {
      if (!st.inBounds(k, l)) continue;
      const ii = st.idx(k, l);
      const sh = w.sheetOf(k, l);
      if (st.flags[ii] === 0 || (sh !== 139 && sh !== 35)) continue;
      const fx = st.frameX[ii] < 36 ? st.frameX[ii] + 36 : st.frameX[ii] - 36;
      st.setTile(k, l, st.type[ii], fx, st.frameY[ii]);
    }
  }
  if (w.running) {
    w.skipCell(ox, oy); w.skipCell(ox + 1, oy);
    w.skipCell(ox, oy + 1); w.skipCell(ox + 1, oy + 1);
  }
}

/** SwitchFountain（WorldGen.cs:51607-51660 1:1）：喷泉 207，2×4 区 frameY ±72。
 *  锚点：num3 = frameX/18 对 2 取余、num4 = frameY/18 ≥4 再减 4。
 *  ★R20-A9:SkipWire 有 running 门（:51643-51653）;★R20-I19:翻帧格须 active() */
export function switchFountain(w: Wiring, x: number, y: number): void {
  const st = w.st;
  const i = st.idx(x, y);
  let num3 = Math.floor(st.frameX[i] / 18);
  while (num3 >= 2) num3 -= 2;
  let num4 = Math.floor(st.frameY[i] / 18);
  if (num4 >= 4) num4 -= 4;
  const ox = x - num3, oy = y - num4;
  for (let k = ox; k < ox + 2; k++) {
    for (let l = oy; l < oy + 4; l++) {
      if (!st.inBounds(k, l)) continue;
      const ii = st.idx(k, l);
      if (st.flags[ii] !== 0 && w.sheetOf(k, l) === 207) {
        const fy = st.frameY[ii] < 72 ? st.frameY[ii] + 72 : st.frameY[ii] - 72;
        st.setTile(k, l, st.type[ii], st.frameX[ii], fy);
      }
    }
  }
  // 原版 2×4 全区 SkipWire（:51643-51653，后于翻帧、先于返回）
  if (w.running) {
    for (let k = ox; k < ox + 2; k++) {
      for (let l = oy; l < oy + 4; l++) w.skipCell(k, l);
    }
  }
}

/** SwitchMonolith（WorldGen.cs:51459-51605 1:1）：天塔柱族 frameY 翻转。
 *  区块 2×3（733 为 3×3）；410 阈值 56，其余 54；658 为 +54 对 162 取模循环（三态）。
 *  ★R20-A9:SkipWire 有 running 门（:51595-51604,后于翻帧）;★R20-I19:翻帧格须 active()
 *  （:51485-51488 !active() continue） */
export function switchMonolith(w: Wiring, x: number, y: number): void {
  const st = w.st;
  const i = st.idx(x, y);
  const sheet = w.sheetOf(x, y);
  const bw = sheet === 733 ? 3 : 2;   // :51462-51465
  const bh = 3;
  let num3 = Math.floor(st.frameX[i] / 18);
  while (num3 >= bw) num3 -= bw;
  let num4 = Math.floor(st.frameY[i] / 18);
  while (num4 >= bh) num4 -= bh;
  const ox = x - num3, oy = y - num4;
  for (let k = ox; k < ox + bw; k++) {
    for (let l = oy; l < oy + bh; l++) {
      if (!st.inBounds(k, l)) continue;
      const ii = st.idx(k, l);
      if (st.flags[ii] === 0) continue;
      const sh = w.sheetOf(k, l);
      if (sh < 0) continue;
      let fy = st.frameY[ii];
      if (sh === 410) fy = fy < 56 ? fy + 56 : fy - 56;
      else if (sh === 658) fy = (fy + 54) % 162;   // :51568-51577
      else if (sh === 480 || sh === 509 || sh === 657 || sh === 720 || sh === 721 || sh === 725 || sh === 733) {
        fy = fy < 54 ? fy + 54 : fy - 54;
      } else continue;
      st.setTile(k, l, st.type[ii], st.frameX[ii], fy);
    }
  }
  if (w.running) {
    for (let k = ox; k < ox + bw; k++) {
      for (let l = oy; l < oy + bh; l++) w.skipCell(k, l);
    }
  }
}

/** 陷阱(137)发射(1458 Wiring.cs:1764-1890 case 137 + Item.cs placeStyle)。frameY/18=种类:
 *  0飞镖(98) 1超级飞镖(184) 2烈焰(187,隐形+尘埃) 3尖刺球(185) 4长矛(186) 5剧毒飞镖(980) */
function fireTrap(w: Wiring, ctx: DeviceCtx, x: number, y: number): void {
  const st = w.st;
  const i = st.idx(x, y);
  const kind = Math.floor(st.frameY[i] / 18);
  if (kind === 0 || kind === 1 || kind === 2 || kind === 5) {
    if (!w.checkMech(x, y, 200)) return;
    // 方向:frameX 0=左 18=右;frameY<36 平置 / ≥36 竖置(上下)
    const dirX = st.frameX[i] === 0 ? -1 : st.frameX[i] === 18 ? 1 : 0;
    const dirY = st.frameX[i] < 36 ? 0 : st.frameX[i] < 72 ? -1 : 1;
    const speed = kind === 0 ? 12 : kind === 1 ? 12 : kind === 5 ? 12 : 5;
    const dmg = kind === 0 ? 20 : kind === 5 ? 30 : 40;
    const px = x * 16 + 8 + 10 * dirX, py = y * 16 + 8 + 10 * dirY;
    // ★R20-H2(缺失·高):1.4.5 新陷阱剧毒飞镖机关(物品 5135,Item.cs:41146-41158
    // createTile 137 placeStyle 5 → frameY=90)。原版 case 5 与 0/1/2 同支
    // （Wiring.cs:1777-1810）:弹 980 VenomDartTrap / 伤 30 / 速 12;980 SetDefaults
    // （Projectile.cs:9332-9340）10×10 aiStyle1 penetrate-1 trap,命中 NPC/玩家
    // 均 AddBuff(70=Venom,300t)（:11714/:12353——projstatus 表已含 980→毒 300t）
    ctx.shootProjectile(px, py, dirX * speed, dirY * speed, dmg,
      kind === 0 ? 'dart' : kind === 1 ? 'superdart' : kind === 5 ? 'venomdart' : 'flame');
  } else if (kind === 3) {
    // 尖刺球(1457 Wiring.cs:1812-1857 case 3;1456 :1812-1856 同文——两版活跃分支逐字节一致):
    // CheckMech 300 → frameX 四向定向(:1833-1852 frameX/18:case0/1 下+1/case2 上−1/
    // case3 左−1/case4 右+1);speed = 4×dir + Next(-20+(dir==1?20:0),
    // 21-(dir==-1?20:0))×0.05(:1853-1854)→ 顺向 [4,5]/反向 [-5,-4]/法向 [-1,1];
    // 出生偏移 14×dir(:1855)、伤 40(:1830)。
    // ★预算扫描(:1819-1826)原版即死代码:扫描比较 type==num96 时 num96 尚为初值 0
    // (:1770),num96=185 在扫描后才赋(:1829)→ num99 恒 200 → 无预算上限。
    // 1456 的"纯下丢"形态(:1960-1965 vx=Next(-20,21)×0.05/vy=4+Next(0,21)×0.05)位于
    // case -7(:1942-1968)=第二个 switch(num95) 负值段,num95=frameY/18≥0 恒不可达——
    // 本仓旧实现误取该死分支,现按两版一致的活跃分支定向发射。
    if (!w.checkMech(x, y, 300)) return;
    let sx = 0, sy = 1;                              // case 0/1 = 下(:1835-1839)
    switch (Math.floor(st.frameX[i] / 18)) {
      case 2: sx = 0; sy = -1; break;                // 上(:1840-1843)
      case 3: sx = -1; sy = 0; break;                // 左(:1844-1847)
      case 4: sx = 1; sy = 0; break;                 // 右(:1848-1852)
    }
    const jit = (d: number) => {                     // Next(-20+(d==1?20:0), 21-(d==-1?20:0))×0.05
      const lo = -20 + (d === 1 ? 20 : 0);
      const hi = 21 - (d === -1 ? 20 : 0);
      return (lo + Math.floor(Math.random() * (hi - lo))) * 0.05;
    };
    ctx.shootProjectile(x * 16 + 8 + 14 * sx, y * 16 + 8 + 14 * sy,
      4 * sx + jit(sx), 4 * sy + jit(sy), 40, 'spiky');
  } else if (kind === 4) {
    // 长矛机关(1456 Wiring.cs:1859-1888 case 4;1457 :1859-1890 ≡ 1405 :1601-1634 同文):
    // CheckMech 90 → frameX/18 四向定向:case 0/1 下(+1)/case 2 上(−1)/
    // case 3 左(−1)/case 4 右(+1);速 8(:1884-1885)、伤 60(:1886)、弹 186(:1887)、
    // 出生偏移 18×dir(:1888)。
    if (!w.checkMech(x, y, 90)) return;
    let sx = 0, sy = 1;                              // case 0/1 = 下(:1866-1870)
    switch (Math.floor(st.frameX[i] / 18)) {
      case 2: sx = 0; sy = -1; break;                // 上(:1871-1874)
      case 3: sx = -1; sy = 0; break;                // 左(:1875-1878)
      case 4: sx = 1; sy = 0; break;                 // 右(:1879-1882)
    }
    ctx.shootProjectile(x * 16 + 8 + 18 * sx, y * 16 + 8 + 18 * sy, sx * 8, sy * 8, 60, 'spear');
  }
}

/** 热喷泉 443(Wiring.cs:2284-2312;由 HitSwitch 直调) */
export function geyserTrap(w: Wiring, ctx: DeviceCtx, x: number, y: number): boolean {
  const st = w.st;
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  const num = Math.floor(st.frameX[i] / 36);
  const i1 = x - Math.floor((st.frameX[i] - num * 36) / 18);
  if (!w.checkMech(i1, y, 200)) return false;
  const up = num < 2;
  ctx.shootProjectile(
    (i1 + 1) * 16, (y + (up ? 0 : 1)) * 16,
    0, up ? -8 : 8, 20, 'geyser',
  );
  return true;
}

/** 雕像 style → 原版 NPC id 表(Wiring.cs:1892-1996)。
 *  num79 = frameX/36 + (frameY/54 % 3) * 55 */
const STATUE_NPC: Record<number, number | number[]> = {
  5: 73, 13: 24, 30: 6, 35: 2,
  51: [299, 538], 52: 356, 53: 357, 54: [355, 358], 55: [367, 366],
  56: [359, 359, 359, 359, 360], 57: 377, 58: 300, 59: [364, 362], 60: 148, 61: 361,
  62: [487, 486, 485], 64: 86, 65: 490, 66: 82, 67: 449, 68: 167, 69: 480, 70: 48,
  71: [170, 180, 171], 72: 481, 73: 482, 74: 430, 75: 489, 76: 611, 77: 602,
  78: [595, 596, 599, 597, 600, 598], 79: [616, 617],
  80: [671, 672], 81: 673, 82: [674, 675], // 1.4.4+ 新雕像（:2260-2267）
};
/** flag7（生成区实心 → poof 不生成）的 style（:2270-2282；64=小丑? 71=史莱姆王组） */
const STATUE_SOLID_CHECK = new Set([64, 71]);
/** 单独分支的雕像 style（Wiring.cs :2290-2440）。dx/dy 为生成点偏移、
 *  solid=生成区实心时 poof、pool=随机池（28 蛇三色等）、
 *  area=实心判定区覆盖（缺省 6×3 spawnAreaSolid）、
 *  quota=MechSpawn 配额查的 id（缺省按抽中 id）、party=派对态换刷（R20-G4） */
const STATUE_NPC_DIRECT: Record<number, { npc: number | number[]; dx?: number; dy?: number; solid?: boolean; area?: [number, number, number, number]; quota?: number; party?: [number, number] }> = {
  4: { npc: 1, dy: -12 },
  7: { npc: 49, dx: -4, dy: -6 },
  8: { npc: 55, dy: -12 },
  // ★R20-G4:兔子雕像派对变体（:2306-2317 PartyIsUp → 540 PartyBunny;
  //  MechSpawn 等价组 [46,540,303,337] 已在 NPC_MECH_GROUPS）
  9: { npc: 46, dy: -12, party: [46, 540] },
  10: { npc: 21 },
  // ★R20-G6:雕像 16 实心判定区 = SolidTiles(ax-1..ax+1, ay..ay+1)（:2325-2336 3×2,
  //  曾误用 6×3 spawnAreaSolid）
  16: { npc: 42, dy: -12, solid: true, area: [-1, 0, 1, 1] },
  18: { npc: 67, dy: -12 },
  23: { npc: 63, dy: -12 },
  27: { npc: 85, dx: -9 },
  // ★R20-G7:蛇雕像配额查 74（:2356-2361 MechSpawn 只查 74,生成随机 74/297/298）
  28: { npc: [74, 297, 298], dy: -12, quota: 74 },
  42: { npc: 58, dy: -12 },
  // ★R20-G5:史莱姆王雕像生成 Y = num143-12（:2393-2404,曾漏 dy）
  50: { npc: 65, solid: true, dy: -12 },
};
/** 物品雕像 style → [原版 item id, ...MechSpawn 配额同查的等价 id]
 *  （2 星 184/1735/1868、17 炸弹 166、37 心 58/1734/1867；:2408-2420）
 *  dy=掉落点 Y 偏移（★R20-G8:炸弹雕像 num143-20,:2412-2416,曾 -16） */
const STATUE_ITEM: Record<number, { item: number; mechIds: number[]; dy?: number }> = {
  2: { item: 184, mechIds: [184, 1735, 1868] },
  17: { item: 166, mechIds: [166], dy: -20 },
  37: { item: 58, mechIds: [58, 1734, 1867] },
};

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/** 雕像 105(Wiring.cs:1866-2215) */
function fireStatue(w: Wiring, ctx: DeviceCtx, x: number, y: number): void {
  const st = w.st;
  const i = st.idx(x, y);
  // 锚点与 style(:1867-1879)
  const num73 = Math.floor(st.frameX[i] / 18);
  let num74 = 0;
  let rem = num73;
  while (rem >= 2) { rem -= 2; num74++; }
  const ox = x - rem;
  const ax = x - Math.floor(st.frameX[i] % 36 / 18);
  const ay = y - Math.floor(st.frameY[i] % 54 / 18);
  const num79 = Math.floor(st.frameX[i] / 36) + Math.floor(st.frameY[i] / 54 % 3) * 55;
  w.skipCell(ax, ay); w.skipCell(ax, ay + 1); w.skipCell(ax, ay + 2);
  w.skipCell(ax + 1, ay); w.skipCell(ax + 1, ay + 1); w.skipCell(ax + 1, ay + 2);
  const px = ax * 16 + 16, py = (ay + 3) * 16;
  // 生成区实心判定（:2274 SolidTiles(num139-2..num139+3, num138..num138+2)；flag7/部分直刷用。
  //  ★R20-G6:直刷支可带 area=[dx0,dy0,dx1,dy1] 覆盖（雕像 16 = ax-1..ax+1, ay..ay+1）
  const spawnAreaSolid = (area?: [number, number, number, number]) => {
    const x0 = area ? ax + area[0] : ax - 2, y0 = area ? ay + area[1] : ay;
    const x1 = area ? ax + area[2] : ax + 3, y1 = area ? ay + area[3] : ay + 2;
    for (let sx = x0; sx <= x1; sx++) {
      for (let sy = y0; sy <= y1; sy++) {
        if (st.inBounds(sx, sy) && st.isSolid(sx, sy)) return true;
      }
    }
    return false;
  };
  // NPC 雕像主表（spawn 于雕像底中心 (px,py)；:2268-2282）
  const entry = STATUE_NPC[num79];
  if (entry !== undefined) {
    const npcId = Array.isArray(entry) ? pick(entry) : entry;
    if (w.checkMech(ax, ay, 30) && ctx.mechSpawnOk(px, py, npcId)) {
      if (!STATUE_SOLID_CHECK.has(num79) || !spawnAreaSolid()) {
        ctx.spawnNpc(npcId, px, py);
      } else {
        ctx.sfx('tink', px, py);
      }
    }
    return;
  }
  // 单独分支 NPC 雕像（各自偏移/实心判定/配额/派对变体；:2290-2440）
  const direct = STATUE_NPC_DIRECT[num79];
  if (direct !== undefined) {
    // ★R20-G4:兔子雕像 PartyIsUp → 540 PartyBunny（:2306-2317）
    let npcId = Array.isArray(direct.npc) ? pick(direct.npc) : direct.npc;
    if (direct.party && ctx.partyIsUp?.()) npcId = direct.party[1];
    // ★R20-G7:配额查 quota（缺省按抽中 id;蛇雕像 MechSpawn 只查 74）
    if (w.checkMech(ax, ay, 30) && ctx.mechSpawnOk(px, py, direct.quota ?? npcId)) {
      if (!direct.solid || !spawnAreaSolid(direct.area)) {
        ctx.spawnNpc(npcId, px + (direct.dx ?? 0), py + (direct.dy ?? 0));
      } else {
        ctx.sfx('tink', px, py);
      }
    }
    return;
  }
  // 物品雕像（CheckMech 600；心/星要过全部等价 id 的 MechSpawn 配额；:2408-2420）
  const itemEntry = STATUE_ITEM[num79];
  if (itemEntry !== undefined) {
    const ok = w.checkMech(ax, ay, 600)
      && itemEntry.mechIds.every((mid) => ctx.itemSpawnOk(px, py, mid));
    // ★R20-G8:掉落点 Y = num143-20（炸弹雕像,:2412-2416;星/心 -16 不变）
    if (ok) ctx.dropItem(itemEntry.item, px, py + (itemEntry.dy ?? -16));
    return;
  }
  switch (num79) {
    case 34: { // 蘑菇雕像:2×3 变 tile 349 动画(:2108-2119)
      const T349 = TILE_BY_KEY['v_349_mushroom_statue'] ?? 0;
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 3; dy++) {
          st.setTile(ax + dx, ay + dy, T349, dx * 18 + 216, dy * 18);
        }
      }
      return;
    }
    case 40: case 41: // 城镇 NPC 搬迁(CheckMech 300,:2133-2186)
      if (w.checkMech(ax, ay, 300)) ctx.relocateTownNpc(num79 === 40 ? 0 : 1, px, py);
      return;
    case 63: // 随机传送雕像：164 + 额外 MechSpawn(165)（:2226-2229）
      if (w.checkMech(ax, ay, 30) && ctx.mechSpawnOk(px, py, 164) && ctx.mechSpawnOk(px, py, 165)) {
        ctx.spawnNpc(164, px, py);
      }
      return;
  }
}

/** 马桶烟花（Wiring.cs:1498-1509）：tile 497 与 tile 15 马桶样式（frameY/40==1 或 20）共用。
 *  num68 = j - frameY%40/18（锚点上格）；SkipWire 两格；CheckMech(锚点, 60) → 弹 733
 *  ToiletEffect：静态水花发射器（速度 0 / damage 0），位于 (i*16+8, num68*16+12) */
function fireworkToilet(w: Wiring, ctx: DeviceCtx, x: number, y: number): void {
  const st = w.st;
  const i = st.idx(x, y);
  const num68 = y - Math.floor(st.frameY[i] % 40 / 18);
  w.skipCell(x, num68); w.skipCell(x, num68 + 1); // :1501-1502
  if (!w.checkMech(x, num68, 60)) return;          // :1503（60t 冷却）
  ctx.shootProjectile(x * 16 + 8, num68 * 16 + 12, 0, 0, 0, 'toiletPop'); // :1505
}

/** 巨石雕像 531(Wiring.cs:1997-2016)。★R20-G9:生成点 = ((num90+1)*16, num91*16+28)
 *  （:2004-2006 vector2=(num90+1,num91)*16 后 Y+=28f）——曾写成 (oy+1)*16=+16 */
function fireBoulderStatue(w: Wiring, ctx: DeviceCtx, x: number, y: number): void {
  const st = w.st;
  const i = st.idx(x, y);
  const ox = x - Math.floor(st.frameX[i] % 36 / 18);
  const oy = y - Math.floor(st.frameY[i] % 36 / 18);
  if (!w.checkMech(ox, oy, 900)) return;
  w.skipCell(ox, oy); w.skipCell(ox + 1, oy); w.skipCell(ox, oy + 1); w.skipCell(ox + 1, oy + 1);
  ctx.shootProjectile(ox * 16 + 16, oy * 16 + 28, 0, 0, 70, 'boulder');
}

/** 可接线灯器件的开关帧判定(Wiring.cs 翻帧 delta 推导):on = frame%(2δ) < δ。
 *  火把 δ=66(22px×3 变体一组)、蜡烛族 δ=18、2×2 灯具 δ=36、吊灯/彩灯 δ=54、篝火走 Y 轴 δ=36 */
export const LIGHT_TOGGLE: Record<number, ['x' | 'y', number]> = {
  4: ['x', 66],
  33: ['x', 18], 174: ['x', 18], 49: ['x', 18], 372: ['x', 18],
  42: ['x', 18], 92: ['x', 18], 93: ['x', 18],
  95: ['x', 36], 100: ['x', 36], 126: ['x', 36], 173: ['x', 36], 564: ['x', 36],
  34: ['x', 54], 149: ['x', 54],
  215: ['y', 36],
};

/** 该格灯光是否点亮(非灯器件恒 true;供 LightingEngine 查询) */
export function lightIsOn(sheet: number, frameX: number, frameY: number): boolean {
  const t = LIGHT_TOGGLE[sheet];
  if (!t) return true;
  const v = t[0] === 'x' ? frameX : frameY;
  return v % (2 * t[1]) < t[1];
}

/** HitWireSingle 器件主分发表。返回 true = 已处理 */
export function deviceTable(w: Wiring, ctx: DeviceCtx, sheet: number, x: number, y: number): boolean {
  const st = w.st;
  const i = st.idx(x, y);
  switch (sheet) {
    case 4: // 火把 frameX ±66(:1207-1213)
      flipCell(w, x, y, 66);
      return true;
    case 356: { // 魔幻日晷（WR57:1137-1157,R8-48）：2×3 SkipWire + Sundialing()
      const ax = x - Math.floor(st.frameX[i] % 36 / 18);
      const ay = y - Math.floor(st.frameY[i] % 54 / 18);
      for (let k = ax; k < ax + 2; k++) for (let l = ay; l < ay + 3; l++) w.skipCell(k, l);
      ctx.timeSkip?.('dawn');
      return true;
    }
    case 663: { // 魔幻月晷（WR57:1158-1175,R8-48）：同构 Moondialing()
      const ax = x - Math.floor(st.frameX[i] % 36 / 18);
      const ay = y - Math.floor(st.frameY[i] % 54 / 18);
      for (let k = ax; k < ax + 2; k++) for (let l = ay; l < ay + 3; l++) w.skipCell(k, l);
      ctx.timeSkip?.('dusk');
      return true;
    }
    case 10: // 关门 → 开(随机方向+反向,原版 :1171-1188)
      ctx.doorOpen(x, y);
      return true;
    case 11:
      ctx.doorClose(x, y);
      return true;
    case 15: { // 马桶椅样式（Wiring.cs:1498-1509 与 tile 497 共用分支；frameY/40==1 或 20）
      if (Math.floor(st.frameY[i] / 40) !== 1 && Math.floor(st.frameY[i] / 40) !== 20) return true;
      fireworkToilet(w, ctx, x, y);
      return true;
    }
    case 33: case 174: case 49: case 372: case 646: // 蜡烛族 frameX ±18(:1754-1759 ToggleCandle;★R20-I14 补 646 影烛)
      flipCell(w, x, y, 18);
      return true;
    case 34: // 吊灯 3×3 frameX ±54(:1405-1428)
      flipBlock(w, x, y, 3, 3, 'x', 54, 54);
      return true;
    case 35: case 139: // 南瓜灯/八音盒：SwitchMB（WorldGen.cs:50977-51021；Wiring.cs:2019-2022）
      switchMB(w, x, y);
      return true;
    case 207: // 喷泉：SwitchFountain（WorldGen.cs:51171-51209；Wiring.cs:2023）
      switchFountain(w, x, y);
      return true;
    case 410: case 480: case 509: case 657: case 658: case 720: case 721: case 725: case 733:
      // 天塔柱族：SwitchMonolith（WorldGen.cs:51023-51169；Wiring.cs:2032-2036）
      switchMonolith(w, x, y);
      return true;
    case 42: // 挂链灯笼 1×2 frameX ±18(:1214-1227)
      flipBlock(w, x, y, 1, 2, 'x', 18, 18);
      return true;
    case 92: // 路灯柱 1×6 frameX ±18(:1483-1494)
      flipBlock(w, x, y, 1, 6, 'x', 18, 18);
      return true;
    case 93: // 灯族 ToggleLamp 1×3 frameX ±18（Wiring.cs:1687-1688→:2954-2975;⚠️5 勘误:前注"蒂基火炬"误名）
      flipBlock(w, x, y, 1, 3, 'x', 18, 18);
      return true;
    case 95: case 100: case 126: case 173: case 564: // 2×2 灯具族 frameX ±36(:1381-1404)
      flipBlock(w, x, y, 2, 2, 'x', 36, 36);
      return true;
    case 105:
      fireStatue(w, ctx, x, y);
      return true;
    case 130: { // 通电石→断电石(:1426-1434)。★R20-I6:原版门(C# 优先级 &&先于||):
      //   tile[i,j-1]!=null && ( !active || ( !PreventsActuationUnder[type] && CanKillTile ) )
      // ——11 型全表(TileID.cs:313);曾用 3 型子集{21,88,467}且漏 CanKillTile。
      // 上方未激活时【不查】CanKillTile 直接过(B 支短路)
      const aboveActive = y > 0 && st.inBounds(x, y - 1) && st.flags[st.idx(x, y - 1)] !== 0;
      if (!aboveActive) {
        swapTile(w, x, y, 'v_130_active_stone_block', 'v_131_inactivestoneblock');
        return true;
      }
      if (PREVENTS_ACTUATION_UNDER.has(w.sheetOf(x, y - 1))) return true;
      if (!canKillTileAt(w, x, y)) return true;
      swapTile(w, x, y, 'v_130_active_stone_block', 'v_131_inactivestoneblock');
      return true;
    }
    case 131:
      swapTile(w, x, y, 'v_130_active_stone_block', 'v_131_inactivestoneblock');
      return true;
    case 137:
      fireTrap(w, ctx, x, y);
      return true;
    case 141: // 炸药(:1781-1785)：清格 + Projectile 108(500伤/半径10)
      w.skipCell(x, y);
      st.setTile(x, y, 0);
      // SW-R3 2026-09-03（F-5 同径）：伤盒=108 SetDefaults 260×260（P.cs:1960-1968）
      // 半宽 130;与 Game.explodeAt 链爆位同口径（旧 undefined→R*TILE=160 混用地形半径）
      ctx.explode(x, y, 500, 10, true, 130, 108);  // 归因=Projectile 108 Explosives
      return true;
    case 149: // 节日彩灯 frameX ±54(:1244-1250)
      flipCell(w, x, y, 54);
      return true;
    case 219:
    case 642: { // 提取机（Wiring.cs:1993-1995 → Extractinator :2563-2593）：
      // 通电自动消耗邻域箱子里的可提取物。锚点按 3×3(54px) 帧内偏移回算（:2567-2568），
      // 冷却 checkMech 60t（:2569/:2571）；箱子查找/消耗/掉落在 ctx（Game 侧拥有箱子与物品栏）。
      const ax = x - Math.floor(st.frameX[i] % 54 / 18);
      const ay = y - Math.floor(st.frameY[i] % 54 / 18);
      if (!w.checkMech(ax, ay, 60)) return true;
      const out = ctx.extractinatorPull(ax, ay, sheet);
      if (out && out.itemType > 0) {
        // :2588 Item.NewItem(num*16, num2*16, 32, 32) → 锚点 2×2 判定框中心
        ctx.dropItemStack(out.itemType, out.stack, ax * 16 + 16, ay * 16 + 16);
      }
      return true;
    }
    case 209: { // 大炮（Wiring.cs:1237-1346 1:1）：旋转+开火复合状态机。
      // num31=块内列(0/3=旋转态,1/2=待发) num32=行内偏移 num35=仰角带(frameY/54,0-8)
      // num36=水平带(frameX/72: 0/1=右向 大炮/兔兔炮, 3/4=左向)
      const num31 = Math.floor(st.frameX[i] % 72 / 18);
      const num32 = Math.floor(st.frameY[i] % 54 / 18);
      const ox = x - num31, oy = y - num32;
      const num35 = Math.floor(st.frameY[i] / 54);
      const num36 = Math.floor(st.frameX[i] / 72);
      let num37 = -1;
      if (num31 === 1 || num31 === 2) num37 = num32;
      // 旋转半边：列3 → 仰角 -54（带0停）；列0 → +54（带8停）
      let num38 = 0;
      if (num31 === 3) num38 = -54;
      if (num31 === 0) num38 = 54;
      if (num35 >= 8 && num38 > 0) num38 = 0;
      if (num35 === 0 && num38 < 0) num38 = 0;
      if (num38 !== 0) {
        for (let cx = ox; cx < ox + 4; cx++) {
          for (let cy = oy; cy < oy + 3; cy++) {
            if (!st.inBounds(cx, cy)) continue;
            w.skipCell(cx, cy);
            const ci = st.idx(cx, cy);
            st.setTile(cx, cy, st.type[ci], st.frameX[ci], st.frameY[ci] + num38);
          }
        }
      }
      // 水平朝向带翻转：3/4 带 + 行0/1 → frameX ±72（下一次触发反向）
      if ((num36 === 3 || num36 === 4) && (num37 === 0 || num37 === 1)) {
        const fx = num36 === 3 ? 72 : -72;
        for (let cx = ox; cx < ox + 4; cx++) {
          for (let cy = oy; cy < oy + 3; cy++) {
            if (!st.inBounds(cx, cy)) continue;
            w.skipCell(cx, cy);
            const ci = st.idx(cx, cy);
            st.setTile(cx, cy, st.type[ci], st.frameX[ci] + fx, st.frameY[ci]);
          }
        }
      }
      if (num37 === -1) return true; // 只旋转未开火
      // 开火半边：半仰角(<2)时左向(带3/4)不发射（flag2，Wiring.cs:1301-1304）
      const flag2 = !((num36 === 3 || num36 === 4) && num37 < 2);
      // 伤害/CheckMech 时长（Wiring.cs:1306-1330）：0=大炮 300/480，1=兔兔炮 350/3600，
      // 其余（3/4 传送门炮）damage 0 / time 30——原版 switch 只设这两档
      const damage = num36 === 0 ? 300 : num36 === 1 ? 350 : 0;
      const time = num36 === 0 ? 480 : num36 === 1 ? 3600 : 30;
      // 全局冷却门（Wiring.cs:1312-1314/1321-1323：冷却中直接返回）
      if (num36 === 0 && w.cannonCoolDown > 0) return true;
      if (num36 === 1 && w.bunnyCannonCoolDown > 0) return true;
      // ★R20-F2:原版 `CheckMech(...) & flag2`（:1330）非短路——flag2=false（左向低
      // 仰角）时仍登记 CheckMech 冷却；曾 `!flag2 ||` 短路不登记
      const mechOk = w.checkMech(ox, oy, time);
      if (!(mechOk && flag2)) return true;
      // WorldGen.ShootFromCannon（WorldGen.cs:50606-50718 1:1）
      // 弹种（:50611-50631）：ammo=num36+1 → 0→162 炮弹 / 1→281 爆炸兔兔 / 3·4→601（速度 3）
      const speed = num36 === 3 || num36 === 4 ? 3 : 14; // :50608 num=14f；601 时 num=3f(:50623/50628)
      // 初速方向表（:50640-50683）：仰角带 0-8 → (10,0)…(0,-10)…(-10,0)
      const ANGLE_V: Array<readonly [number, number]> = [
        [10, 0], [7.5, -2.5], [5, -5], [2.75, -6], [0, -10],
        [-2.75, -6], [-5, -5], [-7.5, -2.5], [-10, 0],
      ];
      const [bx, by] = ANGLE_V[num35] ?? [0, -10];
      // 归一化到 speed（:50706-50708 num8 = num/|v|）
      const len = Math.hypot(bx, by);
      const vx = (bx * speed) / len, vy = (by * speed) / len;
      // 出膛位置（:50685 (x+2)*16,(y+2)*16；601 仅加 (0/5,5) 偏移 :50689-50696）
      let px = (ox + 2) * 16, py = (oy + 2) * 16;
      if (num36 === 3 || num36 === 4) {
        if (num35 === 4) px += 5;
        py += 5;
      }
      // num36 2 原版发彩带弹 178（WorldGen.cs:51043-51045 ammo3 → type 178,damage
      //  0 纯视觉——★BJ704-G14 件1 勘误:旧三元式把 band2 落 'portalbolt'=整型错配,
      //  与手工火把档（band<3 含 2）同刀对齐）;num36 3/4 原版发 PortalGunBolt 601
      // （:50622-50631）：速度 3、damage 0、ai[0] = ammo5 ? 1 : 0（传送门 form，
      //  橙 0/蓝 1）。撞块 → PortalHelper.TryPlacingPortal 落门（entities/Portal.ts），
      //  不再沿用巨石弹体
      const kind: TrapShotKind = num36 === 0 ? 'cannonball' : num36 === 1 ? 'bunny'
        : num36 === 2 ? 'confetti' : 'portalbolt';
      const form = num36 === 4 ? 1 : 0; // :50622-50631（ammo4 → ai0=0 / ammo5 → ai0=1）
      // 全局冷却置位（Wiring.cs:1334-1339：大炮 120 / 兔兔炮 480）——先于弹内判定，
      // 与原版一致（冷却在 HitWireSingle 置位，BunnyCannonCanFire 在 ShootFromCannon 内）
      if (num36 === 0) w.cannonCoolDown = 120;
      if (num36 === 1) w.bunnyCannonCoolDown = 480;
      // 兔兔炮场内上限（WorldGen.cs:50697-50701 → BunnyCannonCanFire :51150-51192：
      //   NPC614（前 100 槽全量）+弹281 计数 ≥4 拒绝——★BJ704-G11：活兔落定 →
      //   ReleaseNPC(614) 接通后 countProjectiles 亦计 critters 桶 614;NPC 槽位
      //   空位门（num2 空槽计数）系 vanilla 100 槽数据结构面,仓内无槽位模型不入）
      if (kind === 'bunny' && ctx.countProjectiles('bunny', px, py, Infinity) >= 4) return true;
      ctx.shootProjectile(px, py, vx, vy, damage, kind, form);
      return true;
    }
    case 210: // 地雷 ExplodeMine(:3093)：清格 + Projectile 164(250伤)——
      // 164 不在 ExplodeTiles 判定表内 = **不破坏地形**（纯伤害爆炸）
      st.setTile(x, y, 0);
      // SW-R3 2026-09-03（F-5 同径）：伤盒=164 SetDefaults 128×128（P.cs:1969-1977）
      // 半宽 64——旧 undefined→R*TILE=0(半径 0)致实体伤近零;不在 164 SetDefaults
      // 也不在 PrepareBombToBlow 任何 Resize 分支 → 盒=自盒 128²
      ctx.explode(x, y, 250, 0, false, 64, 164);  // 归因=Projectile 164 Landmine
      return true;
    case 212: { // 雪球发射器（Wiring.cs:1345-1418 1:1）：旋转+开火复合状态机。
      // num51=块内列(0/2=旋转态,1=待发) num52=行内偏移 num55=朝向带(frameX/54,0左 1右)
      const num51 = Math.floor(st.frameX[i] % 54 / 18);
      const num52 = Math.floor(st.frameY[i] % 54 / 18);
      const ox = x - num51, oy = y - num52;
      const num55 = Math.floor(st.frameX[i] / 54);
      let num56 = -1;
      if (num51 === 1) num56 = num52;
      // 瞄准旋转：列0→frameX -54（带0停）、列2→+54（带1停）（:1359-1365）
      let num57 = 0;
      if (num51 === 0) num57 = -54;
      if (num51 === 2) num57 = 54;
      if (num55 >= 1 && num57 > 0) num57 = 0;
      if (num55 === 0 && num57 < 0) num57 = 0;
      if (num57 !== 0) {
        for (let cx = ox; cx < ox + 3; cx++) {
          for (let cy = oy; cy < oy + 3; cy++) {
            if (!st.inBounds(cx, cy)) continue;
            w.skipCell(cx, cy);
            const ci = st.idx(cx, cy);
            st.setTile(cx, cy, st.type[ci], st.frameX[ci] + num57, st.frameY[ci]);
          }
        }
      }
      if (num56 === -1) return true; // 只旋转未开火
      // 开火门（:1391）：全局冷却 0 + CheckMech(锚点,60)
      if (w.snowballCannonCoolDown > 0 || !w.checkMech(ox, oy, 60)) return true;
      w.snowballCannonCoolDown = 15; // :1393
      // 弹速（:1394）：12 + rand(0..449)*0.01 = 12.00..16.49
      const speed = 12 + Math.floor(Math.random() * 450) * 0.01;
      // 方向（:1395-1396）：X=rand(85..104) / Y=rand(-35..10)（Main.rand.Next 上界开区间）
      let dx = 85 + Math.floor(Math.random() * 20);
      const dy = -35 + Math.floor(Math.random() * 46);
      // 出膛位置（:1400 (x+2)*16-8,(y+2)*16-8）+ 朝向偏移（:1401-1405：左带 X-12 / 右带 X+12）
      let px = (ox + 2) * 16 - 8, py = (oy + 2) * 16 - 8;
      if (num55 === 0) { dx *= -1; px -= 12; } else { px += 12; }
      // 归一化到 speed（:1410-1415）后发射 166 雪球：35 伤 / 3.5 击退（:1397-1399）
      const len = Math.hypot(dx, dy);
      ctx.shootProjectile(px, py, (dx * speed) / len, (dy * speed) / len, 35, 'snowball');
      return true;
    }
    case 215: // 篝火 3×2 frameY ±36(:1003-1020)——★R20-I11 整块同型校验(ToggleCampFire :3025)
      flipBlock(w, x, y, 3, 2, 'y', 36, 36, undefined, true);
      return true;
    case 216: { // 烟花火箭（Wiring.cs:1492-1495 → WorldGen.LaunchRocket WorldGen.cs:62184-62206）
      // LaunchRocket：行 = frameY/40（0-3 → 弹 167-170 红/绿/蓝/黄）；frameY%40==18 说明
      // 点的是下半格，锚点 y 上移（:62188-62194）
      let ly = y;
      if (st.frameY[i] % 40 === 18) ly--;
      // 发射位 (x*16+8, y*16+4+2)、速度 (0,-8)、damage 150 / kb 7（:62196-62199）
      ctx.shootProjectile(x * 16 + 8, ly * 16 + 6, 0, -8, 150, 'fireworkRocket', Math.floor(st.frameY[i] / 40));
      // 烟花方块是消耗品：发射即移除 1×2 两格（:62203-62204 active(false)）
      st.setTile(x, ly, 0);
      st.setTile(x, ly + 1, 0);
      w.skipCell(x, y); // SkipWire（Wiring.cs:1494）
      return true;
    }
    case 244: // 泡泡机 3×2 frameX ±54(:1272-1293)
      flipBlock(w, x, y, 3, 2, 'x', 54, 54);
      return true;
    case 255: case 256: case 257: case 258: case 259: case 260: case 261: { // 宝石块 off→on(:863-873)
      if (st.wire[i] & 16) return true; // 原版有致动器时不响应
      const to = TILE_BY_KEY[GEMSPARK_ON[sheet - 255]] ?? 0;
      if (to) st.setTile(x, y, to, st.frameX[i], st.frameY[i]);
      return true;
    }
    case 262: case 263: case 264: case 265: case 266: case 267: case 268: { // on→off
      if (st.wire[i] & 16) return true;
      const to = TILE_BY_KEY[GEMSPARK_OFF[sheet - 262]] ?? 0;
      if (to) st.setTile(x, y, to, st.frameX[i], st.frameY[i]);
      return true;
    }
    case 314: // 压板轨道（Wiring.cs:1746-1752）：CheckMech 5 + FlipSwitchTrack 翻转轨道指向。
      // FlipSwitchTrack（Minecart.cs:1302-1325）：普通型前/后轨互换（分叉换边）、
      // 加速型 FrameTrack(pound) 循环下一个加速向
      if (w.checkMech(x, y, 5)) {
        flipSwitchTrack(st, x, y);
      }
      return true;
    case 335: { // 烟花盒 2×2（Wiring.cs:1511-1523 → WorldGen.LaunchRocketSmall WorldGen.cs:62208-62222）
      const num72 = y - Math.floor(st.frameY[i] / 18);
      const num73 = x - Math.floor(st.frameX[i] / 18);
      w.skipCell(num73, num72); w.skipCell(num73 + 1, num72);
      w.skipCell(num73, num72 + 1); w.skipCell(num73 + 1, num72 + 1);
      if (!w.checkMech(num73, num72, 30)) return true; // CheckMech 30（:1518-1520）
      // LaunchRocketSmall 的 frameX/frameY==18 再回退（WorldGen.cs:62210-62213）对电路路径是
      // 空操作——num73/num72 已是 2×2 锚点（frameX/frameY==0），此处不再重复
      // 弹 415+rand(4)（红/绿/蓝/黄）、速度 (0,-8)、damage 0（:62213-62215）
      ctx.shootProjectile(num73 * 16 + 16, num72 * 16 + 2, 0, -8, 0, 'fireworksBoxRocket', Math.floor(Math.random() * 4));
      return true;
    }
    case 338: { // 烟花喷泉 1×2（Wiring.cs:1525-1553）
      const num69 = y - Math.floor(st.frameY[i] / 18);
      const num70 = x - Math.floor(st.frameX[i] / 18);
      w.skipCell(num70, num69); w.skipCell(num70, num69 + 1);
      if (!w.checkMech(num70, num69, 30)) return true; // CheckMech 30（:1538-1540）
      // 去重（:1542-1547）：同锚点已有 aiStyle73 弹在喷则不再生成
      if (ctx.hasFountainAt?.(num70, num69)) return true;
      // 弹 419+rand(4)（黄/红/蓝/彩虹），静态发射器（速度 0），ai[0]/ai[1] = 锚点（:1548-1550）
      ctx.shootProjectile(num70 * 16 + 8, num69 * 16 + 2, 0, 0, 0, 'fireworkFountain',
        Math.floor(Math.random() * 4), [num70, num69]);
      return true;
    }
    case 386: case 387: { // 活板门开/关互换——★BJ324（2026-09-24）改完整委托 shiftTrapdoor
      //（Wiring.cs:1443-1449 同函数面:playerAbove:true 先试,失败反向重试 :1446-1449
      //  ——导线路径玩家高度不可得,原版即按 playerAbove:true/false 双掷并集;SkipWire
      //  面由 shiftTrapdoor 原版序内联[关臂先 Validate 后 SkipWire 再占位门早退也照跳
      //  :51907/:51949,开臂 :52004];EmptyTile 占位门=ctx.areaEmpty 单源 per-cell 化;
      //  CanKillTile 门 :51990=Wiring.canKillTile;尾 TileFrame 逐格面=ctx.tileFrame;
      //  音效 SoundID 8 成功/9 尾流经 ctx.sfx 带原版落点）
      const opts = {
        skipCell: (sx: number, sy: number) => w.skipCell(sx, sy),
        blocked: ctx.areaEmpty ? (bx: number, by: number) => !ctx.areaEmpty!(bx, by, 1, 1) : undefined,
        canKill: (cx: number, cy: number) => canKillTileAt(w, cx, cy),
        sfx: (n: 'door_open' | 'door_close', px: number, py: number) => ctx.sfx?.(n, px, py),
        tileFrame: (tx2: number, ty2: number) => ctx.tileFrame?.(tx2, ty2),
      };
      if (!shiftTrapdoor(w.st, x, y, true, opts)) shiftTrapdoor(w.st, x, y, false, opts);
      return true;
    }
    case 388: case 389: { // 高门关/开互换——★BJ322（2026-09-24）改委托 shiftTallGate
      //（Wiring.cs:1460 `WorldGen.ShiftTallGate(i, j, flag4)` 同函数同参面:forced 缺省
      //  false=实体占位门生效（EmptyTile ignoreTiles,开/关两向 :52206-52212）→
      //  ctx.areaEmpty 单源;SkipWire(:52201-52207)→w.skipCell;Validate 方格+
      //  整列裸写+尾 TileFrame 面全在 shiftTallGate 内,替代旧 ox/oy 手工归一
      //  +逐格 setTile 直写（后者半写态会被 CheckTallGate 中途判坏=BJ322 病灶;
      //  旧 `frameX%20/18` 锚偏移亦非原版——vanilla 无此算,1 宽门列=点击列本相））
      shiftTallGate(st, x, y, sheet === 389, undefined, {
        skipCell: (sx, sy) => w.skipCell(sx, sy),
        blocked: ctx.areaEmpty ? (bx, by) => !ctx.areaEmpty!(bx, by, 1, 1) : undefined,
        afterWrite: ctx.afterWrite,
      });
      return true;
    }
    case 405: // 壁炉 3×2 frameX ±54(:1021-1038)
      flipBlock(w, x, y, 3, 2, 'x', 54, 54);
      return true;
    case 406: // 烟囱 3×3 三态循环 +54 / 越阈 -108（Wiring.cs:1071-1091）= 0→54→108→0
      flipBlock(w, x, y, 3, 3, 'y', 108, 54, -108);
      return true;
    case 411: // 引爆器 2×2 frameX ±36(:1057-1074)
      flipBlock(w, x, y, 2, 2, 'x', 36, 36);
      return true;
    case 421: case 422: { // 传送带反向互换(:844-861;有致动器不响应)
      if (st.wire[i] & 16) return true;
      const other = TILE_BY_KEY[sheet === 421 ? 'v_422_conveyor_belt_ccw' : 'v_421_conveyorbeltleft'] ?? 0;
      if (other) st.setTile(x, y, other, st.frameX[i], st.frameY[i]);
      return true;
    }
    case 425: { // 广播盒（Wiring.cs:1177-1230 1:1）：锚点 2×2 内登记的告示牌文本 →
      // 粉色聊天广播（NewTextMultiline）；无牌/空文本静默返回。
      // AnnouncementBoxRange 默认 -1 = 全图（设置项，引擎暂未接设置门，恒全图）。
      // ★SW-FX18 2026-09-10 复核：牌面文字编辑 UI 已实装（tileSign 族右键
      // → openSignEditor 懒建 → UI.showSignDialog 读/编辑双态 → setSignText
      // 写回 world.signs；本广播读面即同一 signs 表,编辑→触发全链贯通）——
      // 旧注"牌面编辑 UI 未接入"已过时注销
      const num5 = Math.floor(st.frameX[i] % 36 / 18);
      const num6 = Math.floor(st.frameY[i] % 36 / 18);
      const ox = x - num5, oy = y - num6;
      for (let m = ox; m < ox + 2; m++) {
        for (let n = oy; n < oy + 2; n++) {
          if (st.inBounds(m, n)) w.skipCell(m, n);
        }
      }
      ctx.announce?.(ox, oy);
      return true;
    }
    case 442: return true; // 投射物垫板(触发源侧处理)
    case 443:
      geyserTrap(w, ctx, x, y);
      return true;
    case 452: // 呆萌气球机 3×3 frameX ±54(:1132-1149)
      flipBlock(w, x, y, 3, 3, 'x', 54, 54);
      return true;
    case 455: // 派对纪念碑（Wiring.cs:2037-2039 → BirthdayParty.ToggleManualParty，
      // BirthdayParty.cs:145-163）：切换 ManualParty（开→升气球天/彩带，入夜 CheckNight 结束）
      ctx.toggleParty?.();
      return true;
    case 476: return true; // 高尔夫球洞(无高尔夫系统)
    case 497: // 马桶（Wiring.cs:1498-1509，与 tile 15 马桶样式共用分支）
      fireworkToilet(w, ctx, x, y);
      return true;
    case 506: // 巴斯特雕像 2×3 frameX ±72(:2516-2545)——★R20-I11 整块同型校验(:2526)
      flipBlock(w, x, y, 2, 3, 'x', 72, 72, undefined, true);
      return true;
    case 531:
      fireBoulderStatue(w, ctx, x, y);
      return true;
    case 546: case 557: // 格栅开/关互换(:2262-2271)
      swapTile(w, x, y, 'v_546_grate', 'v_557_grateclosed');
      return true;
    case 565: // 造雾机 2×2 frameX ±36(:1358-1379)
      flipBlock(w, x, y, 2, 2, 'x', 36, 36);
      return true;
    case 593: // 小火山 frameX ±18(Wiring.cs:1697-1709;仅临时动画零声音——曾自加 roar,2026-08-18 对账删)
      flipCell(w, x, y, 18);
      return true;
    case 594: // 大火山 2×2 frameX ±36(Wiring.cs:1711-1741;同上零声音)
      flipBlock(w, x, y, 2, 2, 'x', 36, 36);
      return true;
    case 349: { // ★R20-I15(缺失·低):蘑菇雕像块导线翻帧（Wiring.cs:2485-2514）
      // 2×3 整块 frameX ±216（锚 frameX/18 折 2 / frameY/18%3）;临时动画(视觉级)未接
      const n113 = Math.floor(st.frameY[i] / 18) % 3;
      const ay2 = y - n113;
      let n115 = Math.floor(st.frameX[i] / 18);
      while (n115 >= 2) n115 -= 2;
      const ax2 = x - n115;
      const d = st.frameX[st.idx(ax2, ay2)] !== 0 ? -216 : 216;   // :2504 翻转前读锚帧
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 3; dy++) {
          const ii = st.idx(ax2 + dx, ay2 + dy);
          w.skipCell(ax2 + dx, ay2 + dy);
          st.setTile(ax2 + dx, ay2 + dy, st.type[ii], st.frameX[ii] + d, st.frameY[ii]);
        }
      }
      return true;
    }
  }
  return false;
}

/** 装配:把器件表挂到 Wiring(器件 case 之外的默认落点)。
 *  ★R20-I4:boulderFall 钩子已摘除——原版致动缩入不构成巨石失撑
 *  （Check2x2 判据不含 inActive 位,WorldGen.cs:48937-48944）,
 *  巨石滚出只挂"支撑被真实破坏"链（Game.breakTile → spawnBoulderFamilyRoll →
 *  convertBoulderRoll 单口,BJ102 债② 2026-09-16） */
export function attachDevices(w: Wiring, ctx: DeviceCtx): void {
  w.device = (ww, sheet, x, y) => deviceTable(ww, ctx, sheet, x, y);
  w.teleportPair = (a, b) => ctx.teleportPair(a, b);
}
