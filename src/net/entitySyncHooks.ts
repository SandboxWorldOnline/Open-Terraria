// 实体同步注入点（沿用 TileStore.netReporter 注入模式——entities 层不反向依赖 net 层）。
// Game 在联机模式下注入；单机恒 null（零开销）。
export const entityNet = {
  /** 傀儡受击上报（访客→房主 StrikeNPC：原始伤害+击退+crit 位，房主权威结算——BJ723-B D5 清偿（BJ725-A））。
   *  掉落物 spawn/take 不走此钩子（Game.netDropSweep/netSweepPuppets 直调
   *  net.sendItemOp——曾预留的 reportSpawn/reportTake 终审清扫已删） */
  reportStrike: null as null | ((netId: number, rawDmg: number, kbx: number, kby: number, crit?: boolean) => void),
};

/** 实体 netId 合成：高 8 位 = 拥有者 slot（防跨客户端本地 id 撞号），低 24 位 = 本地实体 id */
export function makeNetId(ownerSlot: number, localId: number): number {
  return ((ownerSlot & 0xff) << 24) | (localId & 0xffffff);
}

export function netIdLocal(netId: number): number {
  return netId & 0xffffff;
}
