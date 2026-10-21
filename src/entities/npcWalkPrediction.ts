// ===================== AI_007 行走预测共享叶子（★BJ704-G6 D12 抽取）=====================
// 本模块自 TownNPC.ts 原位迁出（2026-10-21,G3 登记债 D12 预案「抽共享叶子防
// Enemy↔TownNPC import 环」——TownNPC.ts:57 已 `import type { Enemy } from './Enemy'`,
// Enemy 侧反向 import TownNPC 即成环）。逻辑零改动：Enemy 侧 townCritterWalkAI
// 三消费位（NPC.cs:54136/:54280/:54534）此前未接 avoidFalling 真值——TownCritter
// 恒 false（:56268 早退）= 41 型零扰动,唯 614 爆炸兔（非集成员）吃到真实避坠。
// 消费端：Enemy.townCritterWalkAI / TownNPC 行走臂 / Game.ts（经 TownNPC 再导出）。
import { TILE } from '../core/constants';
import { drownCollision } from '../stats/TouchDamage';
import { TILE_BY_KEY } from '../data/tiles';
import type { TileStore } from '../world/TileStore';

/** 关门/高门关态判定(行走预测器放行用——门列不算坑、不算跳障实体) */
export function isClosedDoorOrGate(t: number): boolean {
  return t === TILE_BY_KEY['door_closed'] || t === TILE_BY_KEY['tall_gate_closed'];
}

/** AI_007 家域容忍带 ±35（homeFloorX±HOME_DRIFT_RANGE 内不豁免避坠——
 *  远处赶路（带外且朝家走）才愿意跳坑,NPC.cs:56268 flag 同式） */
export const HOME_DRIFT_RANGE = 35;

/** AI_007_TownEntities_GetWalkPrediction（NPC.cs:56093-56165）1:1：
 *  keepwalking 三路（:56098-56117）：①起步期（isLikeATownNPC && ai[1]<30，即
 *  走程剩余 <30t）身体竖线（Top→Bottom × width 展开 = 自身占据列）命中
 *  AvoidedByNPCs 块 → 续走（SearchAvoidedByNPCs：命中集合块=阻断，keepwalking
 *  取反 = 挤开走）；②未阻断时前方盒（X−20/宽+40）内有 velocity.X==0 的
 *  friendly NPC → 续走（挤人绕行）；③溺水恒续走。①②由调用方合算为
 *  crowdedOrBlocked 传入（plotAvoidClear 反相 + crowdedByStationaryNpc）。
 *  消费点（:54609-54613 障碍段尾）：keepwalking → 走程重置 90t。
 *  avoidFalling 主链：前视列扫 j=−1..+4（:56279）：液体累计 num / 岩浆 flag2 /
 *  首个实心格（:56291 `nactive() && Main.tileSolid[type]`——★BJ656 三站同式
 *  定谳,仓内=isVanillaTileSolid）记落点 p 并放行；avoidFalling |= flag2（岩浆
 *  恒避）；num ≥ ceil(h/16)（深水没身）→ 避；落点水淹（DrownCollision）→ 避。
 *  豁免（:56120-56123）：TownCritter 恒不避；不在 home±35 且正朝 home 走 →
 *  不避（远处赶路愿意跳坑）。
 *  ★Enemy 侧调用面（BJ704-G6 D12）：critter 无 isLikeATownNPC（=type==453‖
 *  townNPC,NPC.cs:6880-6889,小动物两皆假）→ startLeg 恒 false=keepwalking③
 *  单值（=drowning 入参同构旧实现）;avoidFalling 对 614 = 真实避坠。 */
export function walkPrediction(
  st: TileStore, myTileX: number, homeFloorX: number, isTownCritter: boolean,
  dir: number, tileX: number, tileY: number, heightPx: number,
  startLeg = false, drowning = false, crowdedOrBlocked = false, widthPx = 20,
): { keepwalking: boolean; avoidFalling: boolean } {
  // ---- keepwalking（:56098-56117）----
  let keepwalking = false;
  if (startLeg && crowdedOrBlocked) {
    keepwalking = true;                    // ① 贴 AvoidedByNPCs 块 / ② 挤站定友方
  }
  if (!keepwalking && drowning) keepwalking = true;       // ③ 溺水续走（:56116）
  // ---- avoidFalling（:56119-56165）----
  let avoidFalling = true;
  if (isTownCritter || (!(myTileX >= homeFloorX - HOME_DRIFT_RANGE && myTileX <= homeFloorX + HOME_DRIFT_RANGE)
    && dir === Math.sign(homeFloorX - myTileX))) {
    avoidFalling = false;                     // :56120-56123
  }
  if (!avoidFalling) return { keepwalking, avoidFalling };
  let lava = false;
  let px = 0, py = 0;                         // 落点 p（X!=0 判有效）
  let depth = 0;
  for (let j = -1; j <= 4; j++) {
    const ty = tileY + j;
    if (!st.inBounds(tileX, ty)) continue;
    const idx = st.idx(tileX, ty);
    if (st.liquid[idx] > 0) {
      depth++;
      if (st.liquidType[idx] === 2) { lava = true; break; }   // :56136-56140
    }
    if (st.type[idx] !== 0 && isClosedDoorOrGate(st.type[idx])) {
      continue;   // ★2026-08-30:关门列=可行走面(门口到达的前提;否则避坠停走死循环在门前)
    }
    // ★BJ656（2026-10-12）支撑谓词统一=st.isVanillaTileSolid（=原版裸
    // Main.tileSolid[type] 代理,nactive() 门,平台九件套经双旗真值
    // Main.cs:8031-32 计入）——与臂B/坑口停走三站同式（NPC.cs:56291/:54771-72/
    // :54563 全 `nactive() && Main.tileSolid[type]`）。旧 isSolid∪isPlatform 系
    // 2026-08-31 平台落点修复（用户实报向导楼梯/dyer 屋内铁证:npcMove span=0,
    // 平台前视只认 isSolid 会判深坑钉死原地——该案保真,平台计入不变）,但其注释
    // 锚 SolidOrSlopedTileOrPlatform 系错锚（NPC.cs:53335=FindGoodRestingSpot
    // :53352 找地板谓词,非本扫描）,isPlatform 把家具顶（桌14/工作台18 等原版
    // tileSolid=false）一并宽化=登记债;本刀摘除家具顶,平台保 8-31 案。
    if (st.isVanillaTileSolid(tileX, ty)) {
      if (depth > 0) { px = tileX; py = ty; }                 // :56148-56151
      avoidFalling = false;                                   // 实心落点 → 放行
      break;
    }
  }
  avoidFalling ||= lava;                                      // :56154
  const bodyTiles = Math.ceil(heightPx / 16);
  if (depth >= bodyTiles) avoidFalling = true;                // :56156-56159
  if (!avoidFalling && px !== 0 && py !== 0) {
    // 落点没顶检验（:56298-56312：ToWorldCoordinates(8,0) + (−W/2,−H) 后走
    // DrownCollision(width,height,gravDir=1)——★F4 换真探针几何，宽度取
    // widthPx（缺省 20 = 本仓城镇盒宽；仅影响 min(10,W) 探针 ±1px 级）
    avoidFalling = drownCollision(
      st, px * TILE + 8 - widthPx / 2, py * TILE - heightPx, widthPx, heightPx, 1,
    );
  }
  return { keepwalking, avoidFalling };
}
