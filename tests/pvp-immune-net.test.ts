// ============================================================================
// PvP 对齐清零批（2026-08-30）net 层单测：
//   ① 免疫余量传输——msg16 PlayerLifeMana 追加尾段 [i16 pvpImmuneRemaining]，
//     攻端门禁 API getProxyPvpImmuneRemaining（原版攻端直读 Main.player[victim].immune
//     的 victim-settles 等价位；1457 ItemCheck_MeleeHitPVP 门禁串 Player.cs:44429
//     「|| player.immune ||」，Damage_PVP 同支 Projectile.cs:14652）。
//   ② 被击端实扣权威展示链——msg117 PlayerHurt（原版 MessageID.PlayerHurtV2 同号；
//     发送侧 Player.cs:38658-38861 netMode==1 结算尾 SendData(16)+SendPlayerHurt，
//     接收侧重放 MessageBuffer.cs:3882-3897 quiet Hurt → 音效+尘+飘字）。
// 覆盖矩阵：
//   - 新↔旧双端编解码兼容（旧端剥尾缺省 0=不拦=改动前行为；旧端无尾不重置既有镜像）
//   - 免疫余量随包刷新 + 本地 tick 衰减（有向误差只余包延迟级，永续残留不存在）
//   - msg117 crit/pvp 位往返 + 截断/NaN/零伤脏包拒收 + 服务器 slot 权威覆写
//   - 限流闸白名单不影响合法流（60/s 全数转发，超限才踢）
//   - victim→server→attacker 全链路 hook 到达
// 全程 mock 传输层（journey-mp / mp-sync-pack / mp-loot 同款假 ws 字节流直连）。
// ============================================================================
import { describe, it, expect } from 'vitest';
import { NetWriter, NetReader, Msg, PlayerHurtFlags, PLAYER_HURT_LEN, readPlayerHurt, writePlayerHurt } from '../src/net/protocol';
import { ClientNet, beetlePvpCredit } from '../src/net/ClientNet';
import type { RemotePlayerState } from '../src/net/ClientNet';

// ---------------------------------------------------------------------------
// 测试基建（house harness 先例同款）
// ---------------------------------------------------------------------------

/** 假 ws：send 采集帧（readyState=1=OPEN），close 置 3 */
function fakeWs() {
  const sent: Uint8Array[] = [];
  const ws = {
    sent,
    readyState: 1,
    bufferedAmount: 0,
    send: (data: ArrayBuffer | Uint8Array) => { sent.push(new Uint8Array(data as ArrayBuffer)); },
    close: () => { ws.readyState = 3; },
    onopen: null, onmessage: null, onclose: null, onerror: null,
  };
  return ws;
}

/** 帧流解析出 (msgId, payload) 列表（合帧 WS 消息逐帧切分，len 头剥除） */
function parseFrames(frames: Uint8Array[]): Array<{ msgId: number; payload: NetReader; len: number }> {
  const out: Array<{ msgId: number; payload: NetReader; len: number }> = [];
  for (const f of frames) {
    let p = 0;
    while (p + 3 <= f.length) {
      const len = f[p] | (f[p + 1] << 8);
      out.push({ msgId: f[p + 2], payload: new NetReader(f.subarray(p + 3, p + len)), len });
      p += len;
    }
  }
  return out;
}

/** 采集某 msgId 的原始完整帧 [len][msgId][payload] */
function framesRaw(sent: Uint8Array[], msgId: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const f of sent) {
    let p = 0;
    while (p + 3 <= f.length) {
      const len = f[p] | (f[p + 1] << 8);
      if (f[p + 2] === msgId) out.push(f.subarray(p, p + len));
      p += len;
    }
  }
  return out;
}

/** 剥 [len][msgId] 头喂 ClientNet.handle */
function feedNet(net: ClientNet, frame: Uint8Array): void {
  (net as unknown as { handle(msgId: number, r: NetReader): void })
    .handle(frame[2], new NetReader(frame.subarray(3)));
}

type NetPriv = { ws: { sent: Uint8Array[] } };
const wsOf = (net: ClientNet) => (net as unknown as NetPriv).ws;

function mkNet(mySlot: number, hooks: Record<string, unknown> = {}, player: Record<string, unknown> = {}) {
  const net = new ClientNet(
    {
      player: {
        appearance: null, hostile: false, team: 0,
        inv: { slots: [], armor: [], dye: [], miscDyes: [], selected: 0 },   // ★X2 补桩:Q3（7ca51ffd）四容器 +miscDyes[5]
        x: 0, y: 0, vx: 0, vy: 0, facing: 1, dead: false, sleeping: false,
        inputX: 0, inputJump: false, inputDown: false, inputUp: false,
        hp: 100, maxHp: 100, deathsPve: 0, deathsPvp: 0, mana: 50, maxMana: 100, luck: 0,
        ...player,
      },
    } as never,
    { onWorldReady: () => {}, ...hooks } as never,
  );
  net.mySlot = mySlot;
  net.active = true;
  (net as unknown as NetPriv).ws = fakeWs();
  return net;
}

/** 在 net 状态表登记远端玩家（msg16 镜像写入的先决条件；GA 由 PlayerActive/msg13 登记） */
function seedPeer(net: ClientNet, slot: number): RemotePlayerState {
  const p = {
    slot, name: `玩家${slot}`, appearance: '{}', x: 0, y: 0, vx: 0, vy: 0,
    up: false, down: false, left: false, right: false, jump: false, useItem: false,
    dash: false,   // ★BJ742-A R22-⑦：RemotePlayerState 新字段（ctrlBits[7]）
    facing: 1, selectedItem: 0, dead: false, fresh: false, active: true, lastFresh: 0,
    ghostPhase: false,   // ★G43 D-N15：msg13 flagBits[1] 独立硬核幽灵位（缺省不计）
    hostile: true, team: 0, hp: 100, maxHp: 100, sleeping: false,
    deathsPve: 0, deathsPvp: 0, mana: 0, manaMax: 0, luck: 0, pvpImmuneT: 0, pvpDefense: null,
    camTarget: null, sitting: false, porAnchors: null,   // G36-A D3 新字段
    buffTypes: new Array(44).fill(0),   // ★BJ755-A T1：msg50 镜像（SW 原生协议恒零）
  };
  net.players.set(slot, p);
  return p;
}

/** 构造 msg16 帧（与 ClientNet.syncHp 写序逐字段同构）；withImmune=false 模拟旧端形状；
 *  def=★F14 第三尾段 statDefense 镜像（位置序恒跟在免疫段后） */
function lifeManaFrame(slot: number, opts?: {
  hp?: number; maxHp?: number; dPve?: number; dPvp?: number;
  mana?: number; manaMax?: number; luck?: number; immune?: number; withImmune?: boolean;
  def?: number;
}): Uint8Array {
  const o = { hp: 70, maxHp: 100, dPve: 1, dPvp: 2, mana: 50, manaMax: 120, luck: 0.25, immune: 8, ...(opts ?? {}) };
  const w = new NetWriter(Msg.PlayerLifeMana);
  w.u8(slot); w.i16(o.hp); w.i16(o.maxHp);
  w.u16(o.dPve).u16(o.dPvp);
  w.i16(o.mana); w.i16(o.manaMax); w.f32(o.luck);
  if (o.withImmune !== false) w.i16(o.immune);
  if (o.def !== undefined) w.u16(o.def);
  return w.finish();
}

const mirrorOf = (net: ClientNet, slot: number) => net.players.get(slot)?.pvpImmuneT;
const decay = (net: ClientNet) => (net as unknown as { decayProxyImmune(): void }).decayProxyImmune();
const syncHpNow = (net: ClientNet) => (net as unknown as { syncHp(): void }).syncHp();

/** room.ts 测试桩结构（动态导入模块的类型按本表收口——避免自引用推断成环） */
interface RcStub {
  ws: { sent: Uint8Array[]; readyState: number };
  slot: number; state: number; isHost: boolean;
  [k: string]: unknown;
}
interface RoomStub {
  handle(c: RcStub, msgId: number, r: NetReader): void;
  flushOutbox(): void;
  newClient(ws: unknown): RcStub;
  readonly clients: Set<RcStub>;
  roomStats: { kicks: number };
}

async function mkRoom(): Promise<{
  room: RoomStub;
  mkClient(slot: number, isHost?: boolean): RcStub;
  clientToRoom(rc: RcStub, net: ClientNet): void;
  roomToNets(sentOwner: Uint8Array[], nets: ClientNet[]): void;
}> {
  const { Room } = await import('../../server/src/room');
  const worldMod = await import('../src/world/World');
  const room = new Room(new worldMod.World(64, 32, 42, 'pvp-room')) as unknown as RoomStub;
  const mkClient = (slot: number, isHost = false) => {
    const c = room.newClient(fakeWs());
    c.slot = slot; c.state = 10; c.isHost = isHost;
    room.clients.add(c);
    return c;
  };
  /** 客户端 net 出站帧 → 服务器入站（单机回环：合成 WS 流按帧喂 handle） */
  const clientToRoom = (rc: RcStub, net: ClientNet) => {
    for (const joined of wsOf(net).sent.splice(0)) {
      let p = 0;
      while (p + 3 <= joined.length) {
        const len = joined[p] | (joined[p + 1] << 8);
        room.handle(rc, joined[p + 2], new NetReader(joined.subarray(p + 3, p + len)));
        p += len;
      }
    }
    room.flushOutbox();
  };
  /** 客户端下行帧 → 各 ClientNet 入站 */
  const roomToNets = (sentOwner: Uint8Array[], nets: ClientNet[]) => {
    for (const frame of sentOwner.splice(0)) {
      let p = 0;
      while (p + 3 <= frame.length) {
        const len = frame[p] | (frame[p + 1] << 8);
        for (const n of nets) feedNet(n, frame.subarray(p, p + len));
        p += len;
      }
    }
  };
  return { room, mkClient, clientToRoom, roomToNets };
}

// ---------------------------------------------------------------------------
// ①-a msg16 免疫尾编解码 + 双向兼容矩阵
// ---------------------------------------------------------------------------
describe('msg16 PvP 免疫尾（2026-08-30 批）：新形状编解码', () => {
  it('新形状：基础段+死亡计数+mana/luck+免疫尾逐字段进镜像', () => {
    const net = mkNet(0);
    seedPeer(net, 2);
    feedNet(net, lifeManaFrame(2, { hp: 55, immune: 300 }));
    const rp = net.players.get(2)!;
    expect(rp.hp).toBe(55);
    expect(mirrorOf(net, 2)).toBe(300);            // 复活 SpawnImmune 300t 无钳位失真
    expect(rp.luck).toBeCloseTo(0.25);
    expect(rp.deathsPvp).toBe(2);
  });

  it('免疫窗内再受击：新值直接覆盖（刷新语义非叠加）', () => {
    const net = mkNet(0);
    seedPeer(net, 2);
    feedNet(net, lifeManaFrame(2, { immune: 8 }));
    feedNet(net, lifeManaFrame(2, { immune: 40 }));
    feedNet(net, lifeManaFrame(2, { immune: 8 }));
    expect(mirrorOf(net, 2)).toBe(8);              // 覆盖到最新包值
  });

  it('负值尾段拒收为 0（防御：i16 半区非法）', () => {
    const net = mkNet(0);
    seedPeer(net, 2);
    feedNet(net, lifeManaFrame(2, { immune: -5 }));
    expect(mirrorOf(net, 2)).toBe(0);
  });

  it('未注册 slot 的镜像无写入面（未知 slot 静默、查询恒 0）', () => {
    const net = mkNet(0);
    feedNet(net, lifeManaFrame(6, { immune: 8 }));
    expect(mirrorOf(net, 6)).toBeUndefined();
    expect(net.getProxyPvpImmuneRemaining(6)).toBe(0);
  });
});

describe('msg16 免疫尾：新旧双向降级矩阵', () => {
  it('旧形状帧（无免疫尾）到达：既有镜像不被重置，交由本地衰减归零', () => {
    const net = mkNet(0);
    seedPeer(net, 2);
    feedNet(net, lifeManaFrame(2, { immune: 40 }));
    expect(mirrorOf(net, 2)).toBe(40);
    // 旧端形状 = 去掉尾段 2 字节（其余同构）
    feedNet(net, lifeManaFrame(2, { withImmune: false }));
    expect(mirrorOf(net, 2)).toBe(40);             // 未清零——混合环境不清窗,防抖动丢门禁
    decay(net);
    expect(mirrorOf(net, 2)).toBe(39);             // 唯一 0 化路径 = 衰减
  });

  it('字节级证明：旧客户端读法消费新帧后恰余 2 字节免疫尾（无害未读）', () => {
    const frame = lifeManaFrame(2, { immune: 8 });
    const r = new NetReader(frame.subarray(3));
    r.u8(); r.i16(); r.i16();                      // slot/hp/maxHp
    r.u16(); r.u16();                              // 死亡计数（remaining>=2 门恒过）
    r.i16(); r.i16(); r.f32();                     // mana/luck（remaining>=8 门恒过）
    expect(r.remaining).toBe(2);                   // 旧端剩余视界内多出的字节=免疫尾
  });

  it('旧服务器重打包等价模拟：新帧剥免疫尾后仍可安全入表（hp/vitals 正常）', () => {
    const full = lifeManaFrame(2, { hp: 33, immune: 8 });
    const stripped = full.subarray(0, full.length - 2);
    const net = mkNet(0);
    seedPeer(net, 2);
    feedNet(net, new Uint8Array(stripped));
    expect(net.players.get(2)!.hp).toBe(33);
    expect(mirrorOf(net, 2)).toBe(0);              // 缺省 0 = 不拦 = 改动前行为
  });

  it('syncHp 上行写序回归：尾段含 [mana i16][manaMax i16][luck f32][iframes i16][defense u16]', () => {
    const net = mkNet(0, {}, { hp: 70, iframes: 80, defense: 63 });
    syncHpNow(net);
    const raw = framesRaw(wsOf(net).sent, Msg.PlayerLifeMana);
    expect(raw.length).toBe(1);
    const r = new NetReader(raw[0].subarray(3));
    expect(r.u8()).toBe(0);
    expect(r.i16()).toBe(70); expect(r.i16()).toBe(100);
    expect(r.u16()).toBe(0); expect(r.u16()).toBe(0);
    expect(r.i16()).toBe(50); expect(r.i16()).toBe(100);
    expect(r.f32()).toBeCloseTo(0);
    expect(r.i16()).toBe(80);                      // General 免疫余量随包上行
    expect(r.u16()).toBe(63);                      // ★F14 statDefense 镜像尾段
    expect(r.remaining).toBe(0);
  });

  // ---- ★F14（2026-08-31 清零批四）statDefense 镜像尾：编解码 + 降级矩阵 ----
  it('★F14 新形状：免疫段后第三尾段 u16 进镜像；初始 null=未知语义', () => {
    const net = mkNet(0);
    seedPeer(net, 3);
    expect(net.players.get(3)!.pvpDefense).toBeNull();       // 初始未知——非零值占位
    feedNet(net, lifeManaFrame(3, { hp: 90, immune: 8, def: 63 }));
    expect(net.players.get(3)!.pvpDefense).toBe(63);
    // 免疫位面行为不变
    expect(mirrorOf(net, 3)).toBe(8);
  });

  it('★F14 两尾全无的旧形状帧：def 镜像保持 null（消费侧弃账不虚增，免疫不重置）', () => {
    const net = mkNet(0);
    seedPeer(net, 3);
    feedNet(net, lifeManaFrame(3, { hp: 80, immune: 40 }));
    feedNet(net, lifeManaFrame(3, { hp: 79, withImmune: false }));   // 旧 server 重建形态
    expect(net.players.get(3)!.pvpDefense).toBeNull();
    expect(mirrorOf(net, 3)).toBe(40);                       // 免疫混合环境不清窗先例延续
  });

  it('★F14 字节级：新帧在旧客户端读法下恰余 4 字节（免疫2+防御2，len 前缀互不干扰无害未读）', () => {
    const frame = lifeManaFrame(2, { immune: 8, def: 50 });
    const r = new NetReader(frame.subarray(3));
    r.u8(); r.i16(); r.i16();
    r.u16(); r.u16();
    r.i16(); r.i16(); r.f32();
    expect(r.remaining).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// ①-b 攻端消费 API（GA 门串契约面）
// ---------------------------------------------------------------------------
describe('getProxyPvpImmuneRemaining（攻端 player.immune 同构查询）', () => {
  it('未知 slot / 尚未收到尾段 → 0（不拦，等于现状）', () => {
    const net = mkNet(0);
    expect(net.getProxyPvpImmuneRemaining(9)).toBe(0);
    expect(net.getProxyPvpImmuneRemaining(-1)).toBe(0);
  });

  it('随包刷新 + 每 tick 衰减 1 + 0 封底', () => {
    const net = mkNet(0);
    seedPeer(net, 7);
    feedNet(net, lifeManaFrame(7, { immune: 8 }));
    expect(net.getProxyPvpImmuneRemaining(7)).toBe(8); // 此刻原版 :44429 门应为 continue
    decay(net); decay(net); decay(net);
    expect(net.getProxyPvpImmuneRemaining(7)).toBe(5);
    for (let i = 0; i < 10; i++) decay(net);
    expect(net.getProxyPvpImmuneRemaining(7)).toBe(0); // 封底不为负
  });

  it('tick() 集成路由：每 fixedUpdate 一次衰减、状态上报节流早退不拦截衰减', () => {
    const net = mkNet(0);
    seedPeer(net, 7);
    feedNet(net, lifeManaFrame(7, { immune: 3 }));
    for (let i = 0; i < 4; i++) net.tick();
    expect(net.getProxyPvpImmuneRemaining(7)).toBe(0);
    expect(framesRaw(wsOf(net).sent, Msg.PlayerState).length).toBeGreaterThan(0);  // tick 真实出帧
  });

  it('notifyPlayerHurtSettled 清 msg16 节流窗：结算后下一帧立即携新鲜免疫尾上行', () => {
    const net = mkNet(0, {}, { hp: 60 });
    syncHpNow(net);                                   // 基线包（hp=60）
    expect(framesRaw(wsOf(net).sent, Msg.PlayerLifeMana).length).toBe(1);
    syncHpNow(net);                                   // 未清窗：200ms 节流吞掉
    expect(framesRaw(wsOf(net).sent, Msg.PlayerLifeMana).length).toBe(1);
    net.notifyPlayerHurtSettled();                    // GA 在 damagePlayer 成功回调里调用
    syncHpNow(net);
    const frames = framesRaw(wsOf(net).sent, Msg.PlayerLifeMana);
    expect(frames.length).toBe(2);                    // 不被节流吞（原版结算尾三连包时序等价）
    const tail = new NetReader(frames[1].subarray(3));
    tail.u8(); tail.i16(); tail.i16(); tail.u16(); tail.u16(); tail.i16(); tail.i16(); tail.f32();
    expect(tail.i16()).toBe(0);                       // stub 无免疫 → 平时随包携 0
  });
});

// ---------------------------------------------------------------------------
// ②-a msg117 PlayerHurt 编解码
// ---------------------------------------------------------------------------
describe('msg117 PlayerHurt 帧格式（原版 MessageID.PlayerHurtV2 同号）', () => {
  it('crit/pvp 位往返 + 击退向 + 世界坐标', () => {
    const src = { slot: 3, dmg: 12, x: 320.5, y: 640.25, dir: -1, flags: PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp };
    const m = readPlayerHurt(new NetReader(writePlayerHurt(src).subarray(3)))!;
    expect(m.slot).toBe(3);
    expect(m.dmg).toBe(12);
    expect(m.x).toBe(320.5);
    expect(m.y).toBe(640.25);
    expect(m.dir).toBe(-1);
    expect(m.flags & PlayerHurtFlags.Crit).not.toBe(0);
    expect(m.flags & PlayerHurtFlags.Pvp).not.toBe(0);
  });

  it('载荷定宽 13B、msgId=117（原版 SendPlayerHurt SendData(117) 号位）', () => {
    const f = writePlayerHurt({ slot: 0, dmg: 1, x: 0, y: 0, dir: 1, flags: 0 });
    expect(f.length).toBe(PLAYER_HURT_LEN + 3);
    expect(f[2]).toBe(Msg.PlayerHurt);
    expect(Msg.PlayerHurt).toBe(117);
  });

  it('脏包拒收：截断 / 零伤 / NaN 坐标 / 结构级超长 → null', () => {
    const build = (dmg: number, x: number, y: number, extra = 0) => {
      const wr = new NetWriter(Msg.PlayerHurt);
      wr.u8(2); wr.i16(dmg); wr.f32(x); wr.f32(y); wr.i8(1); wr.u8(1);
      for (let i = 0; i < extra; i++) wr.u8(0);
      return wr.finish().subarray(3);
    };
    expect(readPlayerHurt(new NetReader(build(0, 0, 0)))).toBeNull();       // 零伤无展示语义
    expect(readPlayerHurt(new NetReader(build(-7, 0, 0)))).toBeNull();      // 负伤
    expect(readPlayerHurt(new NetReader(build(10, NaN, 5)))).toBeNull();    // S6 NaN 清洗
    expect(readPlayerHurt(new NetReader(build(10, 1, 5, 1)))).toBeNull();   // 结构级超长
    expect(readPlayerHurt(new NetReader(build(10, 1, 5).subarray(0, 11)))).toBeNull();  // 截断
  });
});

// ---------------------------------------------------------------------------
// ②-b ClientNet 发送/接收分发（含 self 守卫与旧端语义）
// ---------------------------------------------------------------------------
describe('ClientNet.sendPlayerHurt / onPlayerHurt 分发', () => {
  it('发送方按自身 slot 组帧（slot 由服务器权威覆写,上行值仅占位语义）', () => {
    const net = mkNet(5);
    net.sendPlayerHurt(55, 320.5, 640.25, 1, PlayerHurtFlags.Pvp);
    const raw = framesRaw(wsOf(net).sent, Msg.PlayerHurt);
    expect(raw.length).toBe(1);
    const m = readPlayerHurt(new NetReader(raw[0].subarray(3)))!;
    expect(m.slot).toBe(5);
    expect(m.dmg).toBe(55);
    expect(m.flags & PlayerHurtFlags.Pvp).not.toBe(0);
    expect(m.flags & PlayerHurtFlags.Crit).toBe(0);
  });

  it('他人帧 → hook 到达；self 帧防御兜底丢弃（不双显）', () => {
    const got: Array<{ slot: number; flags: number }> = [];
    const net = mkNet(0, { onPlayerHurt: (slot: number, _d: number, _x: number, _y: number, _dir: number, flags: number) => { got.push({ slot, flags }); } });
    feedNet(net, writePlayerHurt({ slot: 2, dmg: 8, x: 10, y: 20, dir: 1, flags: PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp }));
    feedNet(net, writePlayerHurt({ slot: 0, dmg: 8, x: 10, y: 20, dir: 1, flags: 0 }));   // self 兜底位
    expect(got.length).toBe(1);
    expect(got[0].slot).toBe(2);
    expect(got[0].flags & PlayerHurtFlags.Crit).not.toBe(0);
  });

  it('结构漂移防御：同号异形帧静默丢弃（对齐旧端 default 忽略语义）', () => {
    const got: unknown[] = [];
    const net = mkNet(0, { onPlayerHurt: (...a: unknown[]) => got.push(a) });
    (net as unknown as { handle(msgId: number, r: NetReader): void })
      .handle(Msg.PlayerHurt, new NetReader(new Uint8Array([1, 2, 3])));
    expect(got.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 服务端中继（server/src/room.ts）
// ---------------------------------------------------------------------------
describe('Room 中继：msg16 免疫尾透传 + msg117 定向广播', () => {
  async function mkRig() {
    const r = await mkRoom();
    const host = r.mkClient(0, true);
    const guest = r.mkClient(1);
    const relay = (c: RcStub, msgId: number, frame: Uint8Array) => {
      r.room.handle(c, msgId, new NetReader(frame.subarray(3)));
      r.room.flushOutbox();
    };
    return { ...r, host, guest, relay };
  }

  it('msg16 免疫尾透传：上行带尾 → 其他端收到的重打包帧保留同值尾（排除发送者）', async () => {
    const rig = await mkRig();
    const hostBefore = rig.host.ws.sent.length;
    rig.relay(rig.guest, Msg.PlayerLifeMana, lifeManaFrame(99 /* 占位,服务器覆写 */, { hp: 88, immune: 8 }));
    expect(rig.guest.ws.sent.filter((f) => parseFrames([f]).some((x) => x.msgId === Msg.PlayerLifeMana)).length).toBe(0); // 发送者排除
    expect(rig.host.ws.sent.length).toBe(hostBefore + 1);
    const back = rig.host.ws.sent[hostBefore];
    expect(back[2]).toBe(Msg.PlayerLifeMana);
    const rr = new NetReader(back.subarray(3));
    expect(rr.u8()).toBe(1);                           // 权威 slot=发送者
    expect(rr.i16()).toBe(88);
    rr.i16(); rr.u16(); rr.u16(); rr.i16(); rr.i16(); rr.f32();
    expect(rr.i16()).toBe(8);                          // 免疫尾逐值存活
    expect(rr.remaining).toBe(0);
  });

  it('msg16 旧客户端形状（无尾）上行 → 下行帧也不携带尾（对旧接收端零字节差）', async () => {
    const rig = await mkRig();
    const hostBefore = rig.host.ws.sent.length;
    rig.relay(rig.guest, Msg.PlayerLifeMana, lifeManaFrame(1, { withImmune: false }));
    const back = rig.host.ws.sent[hostBefore];
    const rr = new NetReader(back.subarray(3));
    rr.u8(); rr.i16(); rr.i16(); rr.u16(); rr.u16(); rr.i16(); rr.i16(); rr.f32();
    expect(rr.remaining).toBe(0);                      // 广播层无多余字节
  });

  it('★F14 statDefense 尾透传：上行带第三尾段 → 其他端重打包帧保留同值（排除发送者）', async () => {
    const rig = await mkRig();
    const hostBefore = rig.host.ws.sent.length;
    rig.relay(rig.guest, Msg.PlayerLifeMana,
      lifeManaFrame(99 /* 占位,服务器覆写 */, { hp: 88, immune: 8, def: 63 }));
    expect(rig.guest.ws.sent.filter((f) => parseFrames([f]).some((x) => x.msgId === Msg.PlayerLifeMana)).length).toBe(0);
    const back = rig.host.ws.sent[hostBefore];
    expect(back[2]).toBe(Msg.PlayerLifeMana);
    const rr = new NetReader(back.subarray(3));
    rr.u8();                                           // 权威 slot=1
    rr.i16();                                          // hp（值断言在免疫尾用例）
    rr.i16(); rr.u16(); rr.u16(); rr.i16(); rr.i16(); rr.f32();
    rr.i16();                                          // 免疫尾
    expect(rr.u16()).toBe(63);                         // ★def 尾逐值存活——双尾同批转发不互吞
    expect(rr.remaining).toBe(0);
  });

  it('msg117：伪造他人 slot 被权威覆写为发送者本人 + 排除发送者', async () => {
    const rig = await mkRig();
    const hostBefore = rig.host.ws.sent.length;
    rig.relay(rig.guest, Msg.PlayerHurt,
      writePlayerHurt({ slot: 0, dmg: 42, x: 320.5, y: 96.25, dir: -1, flags: PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp }));
    expect(parseFrames(rig.guest.ws.sent).filter((f) => f.msgId === Msg.PlayerHurt).length).toBe(0);   // 被击者自己已显示,不回灌
    expect(rig.host.ws.sent.length).toBe(hostBefore + 1);
    const m = readPlayerHurt(new NetReader(rig.host.ws.sent[hostBefore].subarray(3)))!;
    expect(m.slot).toBe(1);                            // ★slot 权威=发送者（伪冒 slot0 不通过）
    expect(m.dmg).toBe(42);
    expect(m.x).toBe(320.5); expect(m.y).toBe(96.25);
    expect(m.flags).toBe(PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp); // 样式位原样透传
  });

  it('msg117：NaN 坐标/零伤等脏包静默丢弃，不发广播', async () => {
    const rig = await mkRig();
    const bad = () => {
      const w = new NetWriter(Msg.PlayerHurt);
      w.u8(0); w.i16(10); w.f32(NaN); w.f32(5); w.i8(1); w.u8(0);
      return w.finish();
    };
    rig.relay(rig.guest, Msg.PlayerHurt, bad());
    rig.relay(rig.guest, Msg.PlayerHurt, writePlayerHurt({ slot: 0, dmg: 0, x: 1, y: 1, dir: 1, flags: 0 }));
    expect(parseFrames(rig.host.ws.sent).filter((f) => f.msgId === Msg.PlayerHurt).length).toBe(0);
  });

  it('限流闸：60/s 合法流全数转发（新帧不在限流盲区），第 61 包触发频控踢', async () => {
    const rig = await mkRig();
    const legal = writePlayerHurt({ slot: 1, dmg: 1, x: 1, y: 1, dir: 1, flags: 0 });
    for (let i = 0; i < 60; i++) rig.relay(rig.guest, Msg.PlayerHurt, legal);
    expect(parseFrames(rig.host.ws.sent).filter((f) => f.msgId === Msg.PlayerHurt).length).toBeGreaterThanOrEqual(60);
    rig.relay(rig.guest, Msg.PlayerHurt, legal);       // 第 61 包 = RATE_LIMIT[msg117]=60 触顶 → kick
    expect(rig.room.roomStats.kicks).toBeGreaterThan(0);
    expect(rig.guest.ws.readyState).toBe(3);           // ws 已关闭（send 只做 readyState 判定）
  }, 20000);
});

// ---------------------------------------------------------------------------
// 端到端链路：victim → server → attacker（实扣数字与暴击位跨「机」往返）
// ---------------------------------------------------------------------------
describe('端到端链路（victim-settles 权威展示闭环）', () => {
  function bootE2E(): Promise<{
    room: RoomStub; victimRc: RcStub; attackerRc: RcStub;
    victim: ClientNet; attacker: ClientNet;
    hurtOnAttacker: Array<{ slot: number; dmg: number; x: number; y: number; flags: number }>;
    hurtOnVictim: number[];
    pumpVictimUp(): void;
    pumpServerToAttacker(): void;
  }> {
    return mkRoom().then(({ room, mkClient, clientToRoom, roomToNets }) => {
      const victimRc = mkClient(1);
      const attackerRc = mkClient(0);

      const hurtOnAttacker: Array<{ slot: number; dmg: number; x: number; y: number; flags: number }> = [];
      const hurtOnVictim: number[] = [];
      const victim = mkNet(1, { onPlayerHurt: () => { hurtOnVictim.push(1); } }, { hp: 45, iframes: 8 });
      const attacker = mkNet(0, {
        onPlayerHurt: (slot: number, dmg: number, x: number, y: number, _dir: number, flags: number) =>
          hurtOnAttacker.push({ slot, dmg, x, y, flags }),
      });
      seedPeer(attacker, 1);                          // GA 侧 PlayerActive/msg13 登记等价

      const pumpVictimUp = () => clientToRoom(victimRc, victim);   // victim 上行→服务器
      const pumpServerToAttacker = () => roomToNets(attackerRc.ws.sent, [attacker]);
      return { room, victimRc, attackerRc, victim, attacker, hurtOnAttacker, hurtOnVictim, clientToRoom, roomToNets, pumpVictimUp, pumpServerToAttacker };
    });
  }

  it('crit/pvp 位 + 实扣值完整到达 attacker；victim 自身零回环双显', async () => {
    const e = await bootE2E();

    // —— 并轨链 ①：victim 受击后的 hp 变化包（携 8t 免疫尾）先抵 attacker ——
    e.victim.notifyPlayerHurtSettled();
    syncHpNow(e.victim);
    e.pumpVictimUp();
    e.pumpServerToAttacker();
    expect(e.attacker.getProxyPvpImmuneRemaining(1)).toBe(8);   // 攻端门禁即刻生效

    // —— 并轨链 ②：victim 实扣结算 → 权威飘字广播（GA 消费契约形态）——
    e.victim.sendPlayerHurt(23, 48.5, 96.25, -1, PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp);
    e.pumpVictimUp();
    e.pumpServerToAttacker();

    expect(e.hurtOnAttacker.length).toBe(1);
    expect(e.hurtOnAttacker[0]).toEqual({
      slot: 1, dmg: 23, x: 48.5, y: 96.25,
      flags: PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp,
    });
    expect(e.hurtOnVictim.length).toBe(0);          // 被击者已本地显示,中继排除发送者

    // —— 衰减沿用本地 tick：8t 后攻端门禁自然解锁（门串 continue → 放行）——
    for (let i = 0; i < 8; i++) e.attacker.tick();
    expect(e.attacker.getProxyPvpImmuneRemaining(1)).toBe(0);
  }, 20000);

  it('弱环境降级：victim 帧经「剥尾中继」仍可解（attacker 查询退化 0=不拦，不炸）', async () => {
    const e = await bootE2E();
    e.victim.notifyPlayerHurtSettled();             // 造一条带尾的 msg16 上行
    syncHpNow(e.victim);
    // 模拟旧 server 重打包（已知退化路径）：上行帧解析到已知字段为止、未知尾全剥
    // （★F14 起,msg16 尾段=免疫 2B + statDefense 2B——旧 server 一并剥除）
    for (const joined of wsOf(e.victim).sent.splice(0)) {
      let p = 0;
      while (p + 3 <= joined.length) {
        const len = joined[p] | (joined[p + 1] << 8);
        const msgId = joined[p + 2];
        const stripTail = (msgId === Msg.PlayerLifeMana) ? -4 : 0;
        e.room.handle(e.victimRc, msgId, new NetReader(joined.subarray(p + 3, p + len + stripTail)));
        p += len;
      }
    }
    e.room.flushOutbox();
    e.pumpServerToAttacker();
    expect(mirrorOf(e.attacker, 1)).toBe(0);        // 尾被剥 → 镜像缺省 0 = 不拦 = 现状
    expect(e.attacker.players.get(1)!.hp).toBe(45); // 基础镜像不受影响
    expect(e.attacker.players.get(1)!.pvpDefense).toBeNull();   // ★def 同批剥离=null 弃账面
    e.attacker.tick();                              // 本地衰减/prune 照常运转、无异常抛出
  }, 20000);

  it('★F14 甲虫记账端到端：victim(statDefense=20) settle 两包（msg16 尾先行）→ attacker 未决挥击经 msg117 消费入账 = vanilla 返回段式', async () => {
    const { room, mkClient, clientToRoom, roomToNets } = await mkRoom();
    const victimRc = mkClient(1);
    const attackerRc = mkClient(0);
    const victim = mkNet(1, {}, { hp: 45, iframes: 8, defense: 20 });
    const attacker = mkNet(0, {});
    seedPeer(attacker, 1);
    const credits: Array<{ slot: number; credit: number; off: boolean }> = [];
    attacker.onMeleePvpBeetleCredit = (slot, credit, off) => credits.push({ slot, credit, off });

    // —— 攻端受理命中登记（Game 近战 PvP 区等价动作；rawDmg=36 crit=off=true）——
    attacker.notePendingMeleeHit(1, 36, true, true);

    // —— 并轨链①：victim hp 变化包先行（携 statDefense=20 的第三尾段）——
    victim.notifyPlayerHurtSettled();
    syncHpNow(victim);
    clientToRoom(victimRc, victim);
    roomToNets(attackerRc.ws.sent, [attacker]);
    expect(attacker.players.get(1)!.pvpDefense).toBe(20);   // 镜像新鲜到位

    // —— 并轨链②：victim 实扣结算权威广播（近战支=Pvp|crit|MeleeSource，★F-1）——
    victim.sendPlayerHurt(23, 48.5, 96.25, 1,
      PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp | PlayerHurtFlags.MeleeSource);
    clientToRoom(victimRc, victim);
    roomToNets(attackerRc.ws.sent, [attacker]);

    expect(credits.length).toBe(1);
    expect(credits[0]).toEqual({
      slot: 1,
      credit: beetlePvpCredit(36, true, 20),        // trunc(36×2 − 10)=62 ≡ vanilla num2
      off: true,
    });
    void room; void victimRc;
  }, 20000);
});
