// 传送门（原版 Projectile 601 PortalGunBolt / 602 传送门实体 + PortalHelper.cs 1:1 精简核）。
// 链路：传送门炮（tile 209 num36 3/4，Wiring devices.ts）→ TrapShot 'portalbolt' →
// 撞块 GameHooks.placePortal → placePortal()（落点解算 + 旧门/相交门清理）→
// Portal 实体（props 桶渲染 + fixedUpdate 玩家穿越）。
// 锚点：
//   TryPlacingPortal      PortalHelper.cs:218-248（碰撞 tile → EDGES 法线搜索）
//   FindValidLine         :250-270（命中行 ±1 偏移重试）
//   IsValidLine           :272-286（三格 CanPlacePortalOn + 前方三格 BlockPortals）
//   AddPortal             :328-340（Support 校验 + RemoveMyOldPortal + RemoveIntersecting）
//   TryGoingThroughPortals :105-215（AABB×门线 → 出口点 + 四向净空 + 速度改向）
//   GetPortalColor        :397-409（单机：form0=橙 hsl(.12,1,.5) / form1=蓝 hsl(.52,1,.6)，A=66）
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import type { TileStore } from '../world/TileStore';
import { TILE } from '../core/constants';
import { texId } from '../render/texId';

/** 原版 EDGES（PortalHelper.cs:31-37）：下/上/右/左 四向单位法线 */
const EDGES: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];
/** 原版 SLOPE_EDGES（:38-44，已归一化）+ SLOPE_OFFSETS（:45-52），索引 = slope-1 */
const SLOPE_EDGES: ReadonlyArray<readonly [number, number]> =
  [[Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2]];
const SLOPE_OFFSETS: ReadonlyArray<readonly [number, number]> = [[1, -1], [-1, -1], [1, 1], [-1, 1]];

/** Main.hslToRgb（h∈[0,1)） */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 1) + 1) % 1 * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; } else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** 门色（GetPortalColor :397-409，单机分支：按 form 固定橙/蓝） */
export function portalColor(form: number): [number, number, number] {
  return form === 0 ? hslToRgb(0.12, 1, 0.5) : hslToRgb(0.52, 1, 0.6);
}

/** WorldGen.SolidOrSlopedTile 近似：实心 / 半砖 / 坡面（致动态 isSolid 已排除） */
function solidOrSloped(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  return st.isSolid(x, y) || st.half[i] !== 0 || st.slope[i] !== 0;
}

/** CanPlacePortalOn（:288-295）：实心或坡面即可承门（tile 496 Lemon exclusion 无此 tile） */
function canPlacePortalOn(st: TileStore, x: number, y: number): boolean {
  return solidOrSloped(st, x, y);
}

/** BlockPortals（:306-313）：门前方三格不得有实心块（tileCut/BreakableWhenPlacing
 *  细分集合未接入，实心即挡——装饰非实心天然放行） */
function blockPortals(st: TileStore, x: number, y: number): boolean {
  return st.inBounds(x, y) && st.isSolid(x, y);
}

/** IsValidLine（:272-286）：门线三格（中/前偏/后偏）同 slope 且可承门，
 *  垂直侧三格无阻挡 */
function isValidLine(st: TileStore, x: number, y: number, xOff: number, yOff: number): boolean {
  if (blockPortals(st, x + yOff, y - xOff)
    || blockPortals(st, x + yOff - xOff, y - xOff - yOff)
    || blockPortals(st, x + yOff + xOff, y - xOff + yOff)) return false;
  if (!st.inBounds(x, y) || !st.inBounds(x - xOff, y - yOff) || !st.inBounds(x + xOff, y + yOff)) return false;
  const i = st.idx(x, y);
  const i2 = st.idx(x - xOff, y - yOff);
  const i3 = st.idx(x + xOff, y + yOff);
  return canPlacePortalOn(st, x, y) && canPlacePortalOn(st, x - xOff, y - yOff) && canPlacePortalOn(st, x + xOff, y + yOff)
    && st.slope[i] === st.slope[i2] && st.slope[i] === st.slope[i3];
}

/** FindValidLine（:250-270）：命中行 ±1 偏移重试 */
function findValidLine(st: TileStore, x: number, y: number, xOff: number, yOff: number): [number, number] | null {
  if (isValidLine(st, x, y, xOff, yOff)) return [x, y];
  if (isValidLine(st, x - xOff, y - yOff, xOff, yOff)) return [x - xOff, y - yOff];
  if (isValidLine(st, x + xOff, y + yOff, xOff, yOff)) return [x + xOff, y + yOff];
  return null;
}

/** FindCollision（:315-326）：起点→终点逐 tile 步进，首个实心/坡面格。
 *  原版 Utils.PlotLine 按 tile 步进记录 lastX/lastY，返回最后访问格 px */
function findCollisionTile(st: TileStore, sx: number, sy: number, ex: number, ey: number): [number, number] | null {
  const dist = Math.hypot(ex - sx, ey - sy);
  const steps = Math.max(1, Math.ceil(dist / 8));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const tx = Math.floor((sx + (ex - sx) * t) / 16);
    const ty = Math.floor((sy + (ey - sy) * t) / 16);
    if (solidOrSloped(st, tx, ty)) return [tx, ty];
  }
  return null;
}

/** 传送门实体（原版 Projectile 602：ai[0]=angle、ai[1]=form） */
export class Portal extends Entity {
  /** 朝向角（弧度；门线方向 = angle 向量 ±22px，GetPortalEdges :382-387） */
  angle: number;
  /** 门色 form：0 橙 / 1 蓝（同玩家同 form 旧门被移除，RemoveMyOldPortal :342-353） */
  form: number;
  owner = 0;
  /** 穿越冷却（PortalCooldownForPlayers = 10 ticks，:203） */
  cooldown = 0;
  private anim = 0;
  private animT = 0;
  private static frameCache = new Map<string, HTMLCanvasElement>();

  constructor(x: number, y: number, angle: number, form: number) {
    super();
    this.x = x - 5;   // 602 碰撞盒 10×10（SetDefaults），实体锚点存中心语义 → 左上
    this.y = y - 5;
    this.w = 10; this.h = 10;
    this.angle = angle;
    this.form = form;
  }

  get centerX(): number { return this.x + 5; }
  get centerY(): number { return this.y + 5; }

  /** 门线两端（GetPortalEdges：中心 ± 22×angle 向量） */
  edges(): [number, number, number, number] {
    const dx = Math.cos(this.angle) * 22, dy = Math.sin(this.angle) * 22;
    return [this.centerX - dx, this.centerY - dy, this.centerX + dx, this.centerY + dy];
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.cooldown > 0) this.cooldown--;
    this.animT++;
    if (this.animT >= 4) { this.animT = 0; this.anim = (this.anim + 1) % 10; } // 原版 frameCounter 4tick 步进
    // 穿越判定（TryGoingThroughPortals :105-215）
    const p = game.player;
    if (p.dead || this.cooldown > 0) return;
    const [x1, y1, x2, y2] = this.edges();
    const pb = { x: p.x + p.vx, y: p.y + p.vy, w: p.w, h: p.h };
    if (!segHitsRect(x1, y1, x2, y2, pb.x - 2, pb.y - 2, pb.w + 4, pb.h + 4)) return;
    const other = portalRegistry().find((o) => o !== this && !o.dead && o.owner === this.owner && o.form !== this.form);
    if (!other) return;
    const st = game.world.store;
    // 出口点（GetPortalOutingPoint :372-394，返回实体左上落点）+ 沿出口法线推开原距离（:133-136）
    const [ox, oy, bx, by] = portalOutingPoint(p.w, p.h, other.centerX, other.centerY, other.angle);
    const dist = Math.hypot(p.cx - this.centerX, p.cy - this.centerY);
    const bl = Math.hypot(bx, by) || 1;
    const tx = ox + (bx / bl) * dist, ty = oy + (by / bl) * dist;
    // 四向 16px 扫掠净空（:138-161：任一方向受阻则放弃本次穿越）
    for (const [dx, dy] of [[16, 0], [-16, 0], [0, 16], [0, -16]] as const) {
      if (!sweepFree(st, tx, ty, dx, dy, p.w, p.h)) return;
    }
    // 速度改向（:163-186）：保速率，指向出口法线；零速给 0.1 最小推力
    let speed = Math.hypot(p.vx, p.vy);
    if (speed < 0.1) speed = 0.1;
    let dirX = bx / bl, dirY = by / bl;
    if (bx === 0 && by === 0) { dirX = p.facing || 1; dirY = 0; }
    p.vx = dirX * speed;
    p.vy = dirY * speed;
    if (by === -1 && p.vy > -0.1) p.vy = -0.1;  // 顶部门最小上抛（:177-180）
    p.x = tx;
    p.y = ty;
    // ★BJ714-A（R16-P1 面2）:骑矿车穿越随迁——vanilla TryGoingThroughPortals
    //  Player 支 player.Teleport(vector,4,num4)（PortalHelper.cs:187;msg96 网面
    //  MessageBuffer.cs:3557 同 style4）,Teleport :37698-37780 零 Dismount——
    //  不随迁=轨道旁门穿越下一拍被车「玩家坐骑位回写段」锁回。
    game.migrateMinecartOnTeleport?.();
    this.cooldown = 10;
    other.cooldown = 10;
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = r.atlas?.ensureVImage('vanilla/Projectile_602.png');
    const [cr, cg, cb] = portalColor(this.form);
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate(this.angle);
    if (img && (img.width > 0) && img.width > 0) {
      const frame = Portal.tintedFrame(img, this.anim, cr, cg, cb);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(frame, -9, -25);
    } else {
      // 贴图未就位回退：门色椭圆环（原版门基色 A=66/255，:407）
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 帧着色缓存（multiply + destination-in 保形；10 帧 × 2 色） */
  private static tintedFrame(tex: ImageBitmap | HTMLImageElement, frame: number, r: number, g: number, b: number): HTMLCanvasElement {
    const key = `${texId(tex)}|${frame}|${r},${g},${b}`;
    const hit = Portal.frameCache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = 18; c.height = 20;
    const cx = c.getContext('2d')!;
    cx.drawImage(tex, 0, frame * 20, 18, 20, 0, 0, 18, 20);
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = `rgb(${r},${g},${b})`;
    cx.fillRect(0, 0, 18, 20);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(tex, 0, frame * 20, 18, 20, 0, 0, 18, 20);
    Portal.frameCache.set(key, c);
    return c;
  }
}

/** 门注册表（props 桶同一实例；AddPortal 的 RemoveMyOldPortal/相交清理在此做） */
const registry: Portal[] = [];
export function portalRegistry(): Portal[] { return registry; }
export function clearPortals(): void { for (const p of registry) p.dead = true; registry.length = 0; }

/** 线段 × 矩形（Liang-Barsky 裁剪；Collision.CheckAABBvLineCollision 近似） */
function segHitsRect(x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, rw: number, rh: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, x1 - rx) && clip(dx, rx + rw - x1) && clip(-dy, y1 - ry) && clip(dy, ry + rh - y1);
}

/** 矩形区域无实心块 */
function boxFree(st: TileStore, x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.01) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.01) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (st.isSolid(tx, ty)) return false;
    }
  }
  return true;
}

/** 四向净空扫掠（TryGoingThroughPortals :138-161：从出口-16px 向出口 16px 步进的
 *  TileCollision 探测——整段无碰撞才放行；8px 步进采样近似） */
function sweepFree(st: TileStore, x: number, y: number, dx: number, dy: number, w: number, h: number): boolean {
  for (let s = -16; s <= 16; s += 8) {
    if (!boxFree(st, x + dx * s, y + dy * s, w, h)) return false;
  }
  return true;
}

/** GetPortalOutingPoint（:372-394 1:1）：按门朝向 8 分桶定出口偏移与法线 (bx,by) */
export function portalOutingPoint(w: number, h: number, px: number, py: number, angle: number): [number, number, number, number] {
  // MathHelper.WrapAngle 归一到 (-PI, PI]（atan2(1,0)+PI/2 = PI 会折到 -PI → default 桶）
  const a = ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const num = Math.round(a / (Math.PI / 4));
  switch (num) {
    case -2: case 2:
      return [px + (num === 2 ? -w : 0), py - h / 2, num === 2 ? -1 : 1, 0];
    case 0: case 4:
      return [px - w / 2, py + (num === 0 ? 0 : -h), 0, num === 0 ? 1 : -1];
    case -3: case 3:
      return [px + (num === -3 ? 0 : -w), py - h, num === -3 ? 1 : -1, -1];
    case -1: case 1:
      return [px + (num === -1 ? 0 : -w), py, num === -1 ? 1 : -1, 1];
    default:
      return [px, py, 0, 0];
  }
}

/** TryPlacingPortal（:218-248 1:1）+ AddPortal（:328-340）：解算落点并落门。
 *  boltX/boltY = 弹体左上 px；vx/vy = 撞击时速度；form = 门色 0 橙 / 1 蓝。
 *  返回新门（已入注册表；同 form 旧门与相交门标记 dead），失败返回 null */
export function placePortal(st: TileStore, boltX: number, boltY: number, vx: number, vy: number, form: number): Portal | null {
  const vlen = Math.hypot(vx, vy);
  if (vlen < 0.001) return null;
  const dx = vx / vlen, dy = vy / vlen;
  // FindCollision：弹位 → 弹位+速度+方向*32（:222）
  const hit = findCollisionTile(st, boltX + 5, boltY + 5, boltX + 5 + vx + dx * 32, boltY + 5 + vy + dy * 32);
  if (!hit) return null;
  const [tx, ty] = hit;
  const ti = st.idx(tx, ty);
  const slope = st.slope[ti];
  const half = st.half[ti] !== 0;
  for (let i = 0; i < (half ? 2 : EDGES.length); i++) {
    const [ex, ey] = EDGES[i]!;
    if (ex * dx + ey * dy <= 0) continue;   // Vector2.Dot(EDGES[i], vector) > 0
    const best = findValidLine(st, tx, ty, ey, -ex);
    if (!best) continue;
    // 位置 = 命中行中心 - 法线×8（半砖不偏移）；角度 = atan2(edge)+PI/2（:241-243）
    const cx = best[0] * 16 + 8 - ex * (half ? 0 : 8);
    const cy = best[1] * 16 + 8 - ey * (half ? 0 : 8);
    return addPortal(cx, cy, Math.atan2(ey, ex) + Math.PI / 2, form, dx >= 0 ? 1 : -1);
  }
  if (slope !== 0) {
    const [sx2, sy2] = SLOPE_EDGES[slope - 1]!;
    if (sx2 * -dx + sy2 * -dy > 0) {
      const [ox2, oy2] = SLOPE_OFFSETS[slope - 1]!;
      const best = findValidLine(st, tx, ty, -oy2, ox2);
      if (best) {
        return addPortal(best[0] * 16 + 8, best[1] * 16 + 8, Math.atan2(sy2, sx2) - Math.PI / 2, form, dx >= 0 ? 1 : -1);
      }
    }
  }
  return null;
}

/** AddPortal（:328-353）：同 form 旧门移除 + 门线相交门移除（:355-378） */
function addPortal(x: number, y: number, angle: number, form: number, direction: number): Portal {
  for (let i = registry.length - 1; i >= 0; i--) {
    const o = registry[i]!;
    if (o.dead) { registry.splice(i, 1); continue; }
    if (o.form === form) o.dead = true;                        // RemoveMyOldPortal
    else if (portalLinesIntersect(o, x, y, angle)) o.dead = true; // RemoveIntersectingPortals
  }
  for (let i = registry.length - 1; i >= 0; i--) if (registry[i]!.dead) registry.splice(i, 1);
  const p = new Portal(x, y, angle, form);
  p.vx = direction; // direction 留档（原版 projectile.direction）
  registry.push(p);
  return p;
}

/** Collision.CheckLinevLine（门线相交；:360-377） */
function portalLinesIntersect(a: Portal, bx: number, by: number, bAngle: number): boolean {
  const [ax1, ay1, ax2, ay2] = a.edges();
  const dx = Math.cos(bAngle) * 22, dy = Math.sin(bAngle) * 22;
  const [bx1, by1, bx2, by2] = [bx - dx, by - dy, bx + dx, by + dy];
  const d1x = ax2 - ax1, d1y = ay2 - ay1, d2x = bx2 - bx1, d2y = by2 - by1;
  const den = d1x * d2y - d1y * d2x;
  if (den === 0) return false;
  const t = ((bx1 - ax1) * d2y - (by1 - ay1) * d2x) / den;
  const u = ((bx1 - ax1) * d1y - (by1 - ay1) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
