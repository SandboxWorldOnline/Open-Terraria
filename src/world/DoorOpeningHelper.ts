// ★SW-AS1 2026-09-05 普通门/高门自动开关全量移植（1.4.5 新机制）。
// 原版唯一标杆 Terraria.GameContent.DoorOpeningHelper.cs（1457 全文精读,下注行号=该文件）；
// 挂点链:Player.cs:2897 字段 / :56704 Player() 构造 / :24897 Update 内
// `if (whoAmI == Main.myPlayer) doorHelper.Update(this)` / :21555 DashMovement 内
// dash>0 每帧 AllowOpeningDoorsByVelocityAloneForATime(num17*3)。
// 本仓 Update 调用点=Game.fixedUpdate（原高门简化面 updateTallGateAuto 同位,已退役）；
// msg19/msg13 等价面=联机层（ClientNet.DoorEvent）,单机直写 store 先落（同旧简化面口径）。
import type { TileStore } from './TileStore';
import { T, TILE_BY_KEY } from '../data/tiles';
import { openDoor, closeDoor, shiftTallGate, tallGateRowOf, type ShiftTallGateOpts } from './Door';
import { MOUNT_SETS } from '../entities/Mounts';

// 原版 tile id 10/11/388/389 的本仓内部 id（sheet id 空间≠内部 id,见 Door.isLockedDoor 注）
const DOOR_CLOSED_T = T.DOOR_CLOSED;   // 原版 10
const DOOR_OPEN_T = T.DOOR_OPEN;       // 原版 11
const TALL_GATE_CLOSED_T = TILE_BY_KEY['v_388_tall_gate_closed'] ?? -1;   // 原版 388
const TALL_GATE_OPEN_T = TILE_BY_KEY['v_389_tall_gate_open'] ?? -1;       // 原版 389

/** DoorAutoOpeningPreference（:10-15;Options.doorOpeningPreference 同名映射） */
export type DoorAutoOpeningPreference = 'disabled' | 'gamepadOnly' | 'enabled';

/** 玩家信息视窗（原版 Player 的 Hitbox/velocity/control 面,Game 侧装配） */
export interface DoorHelperPlayerView {
  x: number; y: number; w: number; h: number;   // Hitbox（px;Player.cs:55083 20×42）
  vx: number;                                   // velocity.X（:302 入口门）
  gravDir: number;                              // (int)player.gravDir（:321）
  controlLeft: boolean;                         // controlLeft（:320;本仓 Player.inputLeft）
  controlRight: boolean;                        // controlRight（:320;本仓 Player.inputRight）
  velocityContribution: number;                 // GetAutoDoorVelocityContribution()（:325）
  usingGamepad: boolean;                        // PlayerInput.UsingGamepad（:257;本作无手柄恒 false）
}

/** 环境注入:门音/关门实体占格臂（原版内置在 WorldGen 发声/EmptyTile,本仓 Door.ts 纯函数） */
export interface DoorHelperEnv {
  /** SoundID 8(:38108)/9(:32197)/高门 :52213 的代播面 */
  sfx?: (name: string) => void;
  /** CloseDoor 的 Collision.EmptyTile(ignoreTiles:true) 臂——只看玩家/NPC 占位 */
  blocked?: (x: number, y: number) => boolean;
  /** ★BJ322（2026-09-24）：ShiftTallGate 尾 TileFrame 面（:52224-52231）注入——
   *  helper 自动开/关高门走裸写窗后由 Game 侧扫面收口完整性/邻件复检 */
  afterWrite?: (ax: number, ay: number) => void;
  /** ★BJ722-A D3（2026-10-26）：普通门开门 smash 清位 KillTile 钩（OpenDoor :38095）
   *  ——注入 breakTile（掉落/尘/声全语义）;缺省回落 setTile(0) 近似 */
  killCell?: (x: number, y: number) => void;
}

/** DoorCloseAttemptResult（:17-23） */
export type DoorCloseAttemptResult =
  | 'stillInDoorArea' | 'closedDoor' | 'failedToCloseDoor' | 'doorIsInvalidated';

/** DoorOpenCloseTogglingInfo（:17-21）——_ongoingOpenDoors 条目（锚格+handler 种别） */
interface OngoingDoor { x: number; y: number; kind: 'common' | 'tallGate' }

/** PlayerInfoForOpeningDoors（:32-41） */
interface PlayerInfoForOpeningDoors {
  hitboxToOpenDoor: Rect;
  intendedOpeningDirection: number;
  playerGravityDirection: number;
  scanLeft: number; scanTop: number; scanRight: number; scanBottom: number;   // tileCoordSpace 含端
}

interface Rect { x: number; y: number; w: number; h: number }

/** XNA Rectangle.Intersects:严格不等式——贴边零宽不算相交 */
function rectsIntersect(a: Rect, b: Rect): boolean {
  return b.x < a.x + a.w && a.x < b.x + b.w && b.y < a.y + a.h && a.y < b.y + a.h;
}

/** Rectangle.Intersect +「Width>0||Height>0」（:130/:201）:单轴零宽接触（贴边）交
 *  0×n 矩形仍算命中;双轴零宽（角点相触）不算（Intersect 仅 right<x||bottom<y 才 Empty）。 */
function rectsTouchOrOverlap(a: Rect, b: Rect): boolean {
  const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ow >= 0 && oh >= 0 && (ow > 0 || oh > 0);
}

/** Player.GetAutoDoorVelocityContribution（Player.cs:24534-24540 1:1）:velocity.X;
 *  骑滚轴鞋（MountID.Sets.IsRollerSkates={57,58,59,60},MountID.cs:19）且 |vx|<3f →
 *  3f×sign(vx)（慢速钳到可开门速;零速仍 0——Math.Sign(0f)=0）。 */
export function getAutoDoorVelocityContribution(vx: number, mountActive: boolean, mountType: number): number {
  let num = vx;
  if (mountActive && mountType >= 0 && !!MOUNT_SETS.IsRollerSkates?.[mountType] && Math.abs(num) < 3) {
    num = 3 * Math.sign(num);
  }
  return num;
}

// ================= CommonDoorOpeningInfoProvider（:57-142） =================

/** ProvideInfo（:59-69）:扫描格 Y -= frameY%54/18 归一门顶锚格（关/开门帧同式:
 *  frameY = 54*(style%36)+dy*18 → %54 = dy*18） */
export function commonDoorProvideAnchor(st: TileStore, x: number, y: number): [number, number] {
  return [x, y - Math.floor((st.frameY[st.idx(x, y)] % 54) / 18)];
}

/** TryOpenDoor（:71-107）。门盒=锚格 16×48;gravDir 1→高+16(64)、-1→Y-16 高+16
 *  （本仓 gravDir 恒 1,分支仍 1:1）。先严格相交门再垂直全含门,双向往复重试
 *  （:94-105 成功判据=tile 不再是关门型）;开门音=WorldGen.OpenDoor :38108 SoundID 8。 */
export function commonDoorTryOpenDoor(
  st: TileStore, ax: number, ay: number, intendedDir: number, gravDir: number,
  hitbox: Rect, sfx?: (name: string) => void, killCell?: (x: number, y: number) => void,
): boolean {
  const rect: Rect = { x: ax * 16, y: ay * 16, w: 16, h: 48 };
  if (gravDir === 1) rect.h += 16;
  else if (gravDir === -1) { rect.y -= 16; rect.h += 16; }
  if (!rectsIntersect(rect, hitbox)) return false;                                    // :86-89
  if (hitbox.y < rect.y || hitbox.y + hitbox.h > rect.y + rect.h) return false;       // :90-93 垂直全含
  const kc = killCell ? { killCell } : undefined;   // ★BJ722-A D3：smash=KillTile 全语义
  openDoor(st, ax, ay, intendedDir, kc);
  if (st.get(ax, ay) !== DOOR_CLOSED_T) { sfx?.('door_open'); return true; }          // :95-99
  openDoor(st, ax, ay, -intendedDir, kc);
  if (st.get(ax, ay) !== DOOR_CLOSED_T) { sfx?.('door_open'); return true; }          // :101-105
  return false;
}

/** TryCloseDoor（:109-141）。足印=锚格 16×48,frameX%72/18 列移（1=右列→左移一格、
 *  2=反向锚列→右移一格;0/3=自身列即闭列——vanilla switch 缺如即正确落点）+ Inflate(1,0);
 *  交【未收缩未前移】的 player.Hitbox → StillInDoorArea。关门音=CloseDoor :32197 SoundID 9。 */
export function commonDoorTryCloseDoor(
  st: TileStore, ax: number, ay: number, hitbox: Rect,
  sfx?: (name: string) => void, blocked?: (x: number, y: number) => boolean,
): DoorCloseAttemptResult {
  if (!st.hasTile(ax, ay) || st.get(ax, ay) !== DOOR_OPEN_T) return 'doorIsInvalidated';   // :112-116
  const num = Math.floor((st.frameX[st.idx(ax, ay)] % 72) / 18);                            // :117
  const rect: Rect = { x: ax * 16, y: ay * 16, w: 16, h: 48 };                              // :118
  if (num === 1) rect.x -= 16;                                                              // :121-123
  else if (num === 2) rect.x += 16;                                                         // :124-126
  rect.x -= 1; rect.w += 2;                                                                 // :128 Inflate(1,0)
  if (rectsTouchOrOverlap(rect, hitbox)) return 'stillInDoorArea';                          // :129-133
  if (closeDoor(st, ax, ay, Math.random, blocked)) { sfx?.('door_close'); return 'closedDoor'; }   // :134-139
  return 'failedToCloseDoor';                                                               // :140
}

// ================= TallGateOpeningInfoProvider（:144-214） =================

/** ProvideInfo（:146-156）:vanilla 式 `frameY%90/18` 在本仓帧域 {0,20,38,56,74}
 *  （TileObject heights 累进）与 tallGateRowOf（CheckTallGate :52129-52133 heights
 *  递减）同值;用 Door.ts 权威归一器。 */
export function tallGateProvideAnchor(st: TileStore, x: number, y: number): [number, number] {
  return [x, y - tallGateRowOf(st.frameY[st.idx(x, y)])];
}

/** TryOpenDoor（:158-187）。门盒=锚格 16×80（gravDir 同上）;ShiftTallGate(X,Y,false)=开
 *  （本仓 shiftTallGate 成功侧内播 SoundID 8,:52213 不分开关）。
 *  ★BJ322：blocked/afterWrite 透传 shiftTallGate（原版 ShiftTallGate 内置 EmptyTile
 *  :52206 + 尾 TileFrame 面 :52224,helper 路径 forced=false 同门生效）。 */
export function tallGateTryOpenDoor(
  st: TileStore, ax: number, ay: number, gravDir: number,
  hitbox: Rect, sfx?: (name: string) => void,
  opts?: ShiftTallGateOpts,
): boolean {
  const rect: Rect = { x: ax * 16, y: ay * 16, w: 16, h: 80 };                        // :161
  if (gravDir === 1) rect.h += 16;
  else if (gravDir === -1) { rect.y -= 16; rect.h += 16; }
  if (!rectsIntersect(rect, hitbox)) return false;                                    // :172-175
  if (hitbox.y < rect.y || hitbox.y + hitbox.h > rect.y + rect.h) return false;       // :176-179
  return shiftTallGate(st, ax, ay, false, sfx, opts) !== null;                        // :180-186
}

/** TryCloseDoor（:189-213）。足印=锚格 16×80 + Inflate(1,0)（高门无列移,:197 为死赋值）。 */
export function tallGateTryCloseDoor(
  st: TileStore, ax: number, ay: number, hitbox: Rect, sfx?: (name: string) => void,
  opts?: ShiftTallGateOpts,
): DoorCloseAttemptResult {
  if (!st.hasTile(ax, ay) || st.get(ax, ay) !== TALL_GATE_OPEN_T) return 'doorIsInvalidated';  // :193-196
  const rect: Rect = { x: ax * 16, y: ay * 16, w: 16, h: 80 };                                 // :198
  rect.x -= 1; rect.w += 2;                                                                    // :199
  if (rectsTouchOrOverlap(rect, hitbox)) return 'stillInDoorArea';                             // :200-204
  if (shiftTallGate(st, ax, ay, true, sfx, opts)) return 'closedDoor';                         // :205-211
  return 'failedToCloseDoor';                                                                  // :212
}

// ================= DoorOpeningHelper 主体 =================

/** TryGetHandler（:366-378）:WorldGen.InWorld(x,y,3) 门 + tile.type ∈ {10,388}。
 *  注:vanilla 只查 tile.type 不查 active——幽灵残型格交给 openDoor/shiftTallGate
 *  的 ValidateTileSquareIsActiveAndOfType 臂拒开（X2-F7 已建）。 */
function tryGetHandler(st: TileStore, x: number, y: number): OngoingDoor['kind'] | null {
  if (x < 3 || y < 3 || x >= st.w - 3 || y >= st.h - 3) return null;   // InWorld fluff=3
  const t = st.get(x, y);
  if (t === DOOR_CLOSED_T) return 'common';
  if (t === TALL_GATE_CLOSED_T) return 'tallGate';
  return null;
}

export class DoorOpeningHelper {
  /** PreferenceSettings（:216 static,缺省 EnabledForEverything）——本仓消费
   *  Options.doorOpeningPreference（Settings UI 已有三档,R8① 登记差异清偿） */
  preference: DoorAutoOpeningPreference = 'enabled';
  /** _ongoingOpenDoors（:230）——只跟踪 helper 自己开的门;手动/NPC 开的不入列（vanilla 同） */
  private ongoing: OngoingDoor[] = [];
  /** _timeWeCanOpenDoorsUsingVelocityAlone（:232） */
  private velocityAlone = 0;

  /** 测试/断言面:锚格 (x,y) 是否在跟踪 */
  isTrackingOpenDoor(x: number, y: number): boolean {
    return this.ongoing.some((d) => d.x === x && d.y === y);
  }

  /** AllowOpeningDoorsByVelocityAloneForATime（:234-237） */
  allowOpeningDoorsByVelocityAloneForATime(frames: number): void {
    this.velocityAlone = frames;
  }

  /** Update（:239-250）:先关扫 →（偏好过门）开扫 → 窗递减 */
  update(st: TileStore, p: DoorHelperPlayerView, env: DoorHelperEnv = {}): void {
    this.lookForDoorsToClose(st, p, env);
    if (this.shouldTryOpeningDoors(p)) this.lookForDoorsToOpen(st, p, env);
    if (this.velocityAlone > 0) this.velocityAlone--;
  }

  /** ShouldTryOpeningDoors（:252-260;PlayerInput.UsingGamepad 本作恒 false=SmartCursor 口径） */
  private shouldTryOpeningDoors(p: DoorHelperPlayerView): boolean {
    if (this.preference === 'enabled') return true;
    return this.preference === 'gamepadOnly' && p.usingGamepad;
  }

  /** LookForDoorsToClose（:278-289）:倒序遍历,非 StillInDoorArea 一律 RemoveAt
   *  （ClosedDoor=关成/DoorIsInvalidated=被拆/FailedToCloseDoor=足印被堵——皆放弃跟踪不重试） */
  private lookForDoorsToClose(st: TileStore, p: DoorHelperPlayerView, env: DoorHelperEnv): void {
    const hitbox: Rect = { x: p.x, y: p.y, w: p.w, h: p.h };   // GetPlayerInfoForClosingDoor :291-297
    for (let i = this.ongoing.length - 1; i >= 0; i--) {
      const info = this.ongoing[i];
      const res = info.kind === 'common'
        ? commonDoorTryCloseDoor(st, info.x, info.y, hitbox, env.sfx, env.blocked)
        : tallGateTryCloseDoor(st, info.x, info.y, hitbox, env.sfx,
          { blocked: env.blocked, afterWrite: env.afterWrite });
      if (res !== 'stillInDoorArea') this.ongoing.splice(i, 1);
    }
  }

  /** LookForDoorsToOpen（:299-316）:站定门=方向 0 且 vx==0 整帧跳过（右键关门后站
   *  门口不被下一 tick 弹开）;扫描区含端双循环逐格 TryAutoOpeningDoor */
  private lookForDoorsToOpen(st: TileStore, p: DoorHelperPlayerView, env: DoorHelperEnv): void {
    const info = this.getPlayerInfoForOpeningDoor(p);
    if (info.intendedOpeningDirection === 0 && p.vx === 0) return;
    for (let i = info.scanLeft; i <= info.scanRight; i++) {
      for (let j = info.scanTop; j <= info.scanBottom; j++) {
        this.tryAutoOpeningDoor(st, i, j, info, env);
      }
    }
  }

  /** GetPlayerInfoForOpeningDoor（:318-352） */
  private getPlayerInfoForOpeningDoor(p: DoorHelperPlayerView): PlayerInfoForOpeningDoors {
    const num = (p.controlRight ? 1 : 0) - (p.controlLeft ? 1 : 0);   // :320
    const gravDir = p.gravDir;                                         // :321
    // :322-324 hitbox.Y -= -1; Height += -2（上下各收 1px）
    const hitbox: Rect = { x: p.x, y: p.y + 1, w: p.w, h: p.h - 2 };
    let num2 = p.velocityContribution;                                 // :325
    if (num === 0 && this.velocityAlone === 0) num2 = 0;               // :326-329
    const value = num + num2;                                          // :330
    const num3 = Math.sign(value) * Math.ceil(Math.abs(value));        // :331
    hitbox.x += num3;                                                  // :332
    let dir = num;
    if (num === 0) dir = Math.sign(value);                             // :333-336
    // :337-343 Union(Hitbox, Hitbox+num3) → TopLeft/BottomRight.ToTileCoordinates
    //  (Utils.cs:1899-1901 `(int)v>>4` = 地板除 16)
    const ux = Math.min(p.x, p.x + num3);
    const uw = Math.max(p.x + p.w, p.x + p.w + num3) - ux;
    return {
      hitboxToOpenDoor: hitbox,
      intendedOpeningDirection: dir,
      playerGravityDirection: gravDir,
      scanLeft: Math.floor(ux / 16), scanTop: Math.floor(p.y / 16),
      scanRight: Math.floor((ux + uw) / 16), scanBottom: Math.floor((p.y + p.h) / 16),
    };
  }

  /** TryAutoOpeningDoor（:352-364）:handler → ProvideInfo → TryOpenDoor → 入跟踪列 */
  private tryAutoOpeningDoor(st: TileStore, x: number, y: number, info: PlayerInfoForOpeningDoors, env: DoorHelperEnv): void {
    const kind = tryGetHandler(st, x, y);
    if (!kind) return;
    const [ax, ay] = kind === 'common' ? commonDoorProvideAnchor(st, x, y) : tallGateProvideAnchor(st, x, y);
    const opened = kind === 'common'
      ? commonDoorTryOpenDoor(st, ax, ay, info.intendedOpeningDirection, info.playerGravityDirection, info.hitboxToOpenDoor, env.sfx, env.killCell)
      : tallGateTryOpenDoor(st, ax, ay, info.playerGravityDirection, info.hitboxToOpenDoor, env.sfx,
        { blocked: env.blocked, afterWrite: env.afterWrite });
    if (opened) this.ongoing.push({ x: ax, y: ay, kind });
  }
}
