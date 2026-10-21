// ★BJ696（2026-10-20）：致命球 533 召唤物零伤——伤害面反相矫正判别锁（用户实报）。
//  定谳（反编译亲读，双锚）：
//  · Damage() 全局每拍（Projectile.cs:17184，Update 主体、numUpdates 循环外）→
//    Damage_CanDealDamage（:12461）projPet 门（:12495，projPet[533]=true Main.cs:8922）
//    —— `(type != 533 || !(ai[0] >= 6f) || !(ai[0] <= 8f))` 汇出 = 533 唯冲刺态
//    ai[0]∈[6,8] 可伤；待机 0-2 / 蓄力 3-5 / 归位 9-11 全 blocked。
//  · 伤害盒 = Damage_GetHitbox（:15037）无 533 支 = 恒 20×20（SetDefaults :6005-6006）；
//    「冲刺盒 +6」（GetCollisionParams :20102）系瓷砖碰撞/SwitchTiles 通道
//    （使用位 :17697 TileCollision / :19976 SwitchTiles 亲读）——【伤害面不落 pad】，
//    父会话嫌疑①「冲刺伤害盒+6」证伪（过度矫正防线=M3）。
//  · 旧实现尾位无条件发伤（待机/归位/触发拍）+ 冲刺/蓄力分支提前 return 零伤
//    = 与原版整段反相（用户实报根因）。修 = contact533 唯一伤害出口（门内聚），
//    调用位=冲刺分支尾（持续拍）+ 函数尾（触发拍 dA0 已入 6-8，原版 post-AI 读位同相）。
//  变异证红：M1 门摘除（contact533 恒放行）→ §2 待机/蓄力重叠必红；
//   M2 冲刺出口摘除 → §2① 必红；M2b 尾位出口摘除 → §2④ 必红；
//   M3 伤害盒 pad=3（证伪面回潮）→ §3 结构锁必红；M4 旧尾位无条件 contact 回潮 → §2② 必红。
//  ★夹具纪律（BJ514/BJ634/BJ635 判例防「夹具喂幻影」）：真 Enemy 盒 + maxHp=100000
//  （canBeChasedBy lifeMax>5 门）+ boss 旗 + 真 World/真 Player/直驱 fixedUpdate。
//  ★登记债（不在本锁）：MinionHitCd 读位衰减（MinionProj.ts MinionHitCd 类）vs 原版
//  localNPCImmunity 逐拍递减（:16779 Update 头 → :17365 全表递减）——跨次冲刺烧表压制
//  命中节奏（探针 61/77 被拒重叠帧=自表冻结项），影响面=全 usesLocalNPCImmunity 随从
//  族+龙链共享实例，另刀落。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MinionProj } from '../src/entities/MinionProj';
import { maintainMinionBuffs } from '../src/core/Game';
import { BuffType } from '../src/stats/Buffs';
import type { GameHooks } from '../src/entities/types';

// ★C档可移植：仓库外反编译依赖——缺则源码锚节 skip（本机在=真跑）
const EXT_MISSING = !existsSync(new URL('../../Terarria1457', import.meta.url));

const GAME = join(__dirname, '..');

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp?: number; vanillaId?: number;
  boss?: boolean;
  hurt: (d: number, kx?: number, ky?: number, g?: GameHooks) => boolean;
  hits: number[];
}
const mkEnemy = (id: number, cx: number, cy: number, w = 60, h = 60): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy,
    hp: 100000, maxHp: 100000, vanillaId: 48, boss: true, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

function makeHooks(enemies: MockEnemy[] = []) {
  const w = new World(200, 120, 7, 'bj696');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown) => void } }).entities = {
    projectiles: added,
    add: (e: unknown) => { added.push(e); },
  };
  return { hooks, store: w.store, player, added };
}

let minionSeq = 0;
const minion = (player: Player, hooks: GameHooks, cx: number, cy: number): MinionProj => {
  const m = new MinionProj(cx, cy, 533, 25, 4, false, 0, false, () => player);
  m.id = ++minionSeq;
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;   // 533 真盒 20×20（构造器 SetDefaults :6005-6006 档）
  (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
  return m;
};
/** 球心与敌心重合（20×20 球盒全嵌敌盒） */
const overlapEnemy = (m: MinionProj, e: MockEnemy): void => {
  m.x = e.cx - m.w / 2; m.y = e.cy - m.h / 2;
};

// ============================================================
// ① 原版锚（projPet 门/伤害盒亲读锁——读错反编译即红）
// ============================================================
describe.skipIf(EXT_MISSING)('① 原版锚：projPet 门=533 唯冲刺态可伤 + 伤害盒恒 20×20', () => {
  it('Damage_CanDealDamage projPet 门含 533 冲刺豁免子句（:12495）', () => {
    const src = readFileSync(join(GAME, '..', 'Terarria1457', 'Terraria', 'Projectile.cs'), 'utf8');
    const i = src.indexOf('private bool Damage_CanDealDamage()');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('public void Damage()'));
    expect(block).toContain('(type != 533 || !(ai[0] >= 6f) || !(ai[0] <= 8f))');
  });
  it('projPet[533] = true（Main.cs 布表）', () => {
    const src = readFileSync(join(GAME, '..', 'Terarria1457', 'Terraria', 'Main.cs'), 'utf8');
    expect(src).toContain('projPet[533] = true;');
  });
  it('Damage_GetHitbox 无 533 支（伤害盒恒 20×20；「冲刺盒+6」属 GetCollisionParams 瓷砖通道）', () => {
    const src = readFileSync(join(GAME, '..', 'Terarria1457', 'Terraria', 'Projectile.cs'), 'utf8');
    const i = src.indexOf('public Rectangle Damage_GetHitbox()');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('private void SelfHurtPlayers()'));
    expect(block).not.toContain('type == 533');
    // +6 分支只在 GetCollisionParams（瓷砖碰撞盒，:20102；尾界=:20165 RainbowBoulder_CheckBounce）
    const j = src.indexOf('public void GetCollisionParams(');
    const gBlock = src.slice(j, src.indexOf('private void RainbowBoulder_CheckBounce('));
    expect(gBlock).toContain('type == 533 && ai[0] >= 6f');
  });
});

// ============================================================
// ② 行为面：projPet 门反相矫正（M1/M2/M2b/M4 各必恰红）
// ============================================================
describe('② 533 伤害出口=唯冲刺态（post-AI dA0∈[6,8]）', () => {
  it('冲刺持续拍重叠 → 结算伤害（M2 摘冲刺出口 → 红）', () => {
    const e = mkEnemy(1, 60 * 16 + 300, 90 * 16);
    const { hooks, player } = makeHooks([e]);
    const m = minion(player, hooks, e.cx, e.cy);
    overlapEnemy(m, e);
    (m as unknown as { dA0: number }).dA0 = 6;   // 冲刺带直置（触发态外）
    (m as unknown as { dA1: number }).dA1 = 10;  // 段内（≤40 不断）
    m.vx = 0; m.vy = 0;                          // 零速=驻留重叠
    m.fixedUpdate(1, hooks);
    expect(e.hits.length).toBeGreaterThanOrEqual(1);
    expect(e.hits[0]).toBe(25);                  // dLai2=0 全额（半伤面 BJ650 件2 另域）
  });

  it('待机态重叠 → 零伤（旧尾位无条件发伤=反相病灶；M1 门摘除/M4 旧尾回潮 → 红）', () => {
    const e = mkEnemy(2, 60 * 16 + 300, 90 * 16);
    const { hooks, player } = makeHooks([e]);
    const m = minion(player, hooks, e.cx, e.cy);
    overlapEnemy(m, e);
    (m as unknown as { dA0: number }).dA0 = 0;   // 待机带
    (m as unknown as { dA1: number }).dA1 = 1;   // 攻击间隔窗内（>0 阻断触发支）
    m.vx = 0; m.vy = 0;
    m.fixedUpdate(1, hooks);
    expect(e.hits.length).toBe(0);
  });

  it('蓄力态重叠 → 零伤（:12495 projPet 门 3-5 blocked；M1 门摘除 → 红）', () => {
    const e = mkEnemy(3, 60 * 16 + 300, 90 * 16);
    const { hooks, player } = makeHooks([e]);
    const m = minion(player, hooks, e.cx, e.cy);
    overlapEnemy(m, e);
    (m as unknown as { dA0: number }).dA0 = 3;   // 蓄力带（分支提前 return）
    m.vx = 0; m.vy = 0;
    m.fixedUpdate(1, hooks);
    expect(e.hits.length).toBe(0);
  });

  it('触发拍重叠 → 结算伤害（原版 Damage() 读 post-AI ai[0]；M2b 摘尾位出口 → 红）', () => {
    const e = mkEnemy(4, 60 * 16 + 300, 90 * 16);
    const { hooks, player } = makeHooks([e]);
    const m = minion(player, hooks, e.cx, e.cy);
    overlapEnemy(m, e);
    // dA0=0/dA1=0 冷却好 + 敌 <800 → 触发支入冲刺带（dA0=6）→ 尾位出口同拍放行
    m.fixedUpdate(1, hooks);
    expect((m as unknown as { dA0: number }).dA0).toBe(6);
    expect(e.hits.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// ③ 结构锁：contact533 唯一出口 + 伤害盒无 pad（M3 pad 回潮 → 红）
// ============================================================
describe('③ 结构锁：门聚 contact533/双出口/伤害盒零 pad', () => {
  const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');

  it('contact533 存在且门=projPet 汇出式（摘门=恒放行回归）', () => {
    const i = src.indexOf('private contact533(game: GameHooks, dmg0: number): void');
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, i + 400);
    expect(body).toContain('if (this.dA0 < 6 || this.dA0 > 8) return;');
  });
  it('调用位恰 2 处（冲刺分支尾+函数尾），deadlySpherePhase 内零直呼 this.contact(', () => {
    const calls = src.split('this.contact533(game, dmg0)').length - 1;
    expect(calls).toBe(2);
    const ph = src.indexOf('private deadlySpherePhase(');
    const phBody = src.slice(ph, src.indexOf('private contact533('));
    expect(phBody).not.toContain('this.contact(');   // M3 pad=3 直呼/M4 旧尾位回潮 → 红
  });
  it('contact533 内 contact 调用零 pad（Damage_GetHitbox 无 533 支=恒 20×20）', () => {
    const i = src.indexOf('private contact533(');
    const body = src.slice(i, src.indexOf('\n  }', i));
    expect(body).toContain('this.contact(game, this.dLai2 >= 40 ? Math.trunc(dmg0 * 0.5) : dmg0)');
    expect(body).not.toContain('pad');
  });
});

// ============================================================
// ④ 多球共存：维护链杀支不误伤（同型互斥/槽位自裁反证）
// ============================================================
describe('④ 双 533 共存', () => {
  it('buff 在场 → maintainMinionBuffs 不杀（杀支=旧嫌疑④面）', () => {
    const { hooks, player, added } = makeHooks([]);
    const a = minion(player, hooks, player.cx, player.cy);
    const b = minion(player, hooks, player.cx, player.cy);
    player.buffs.set(BuffType.DeadlySphere, 300);
    maintainMinionBuffs(player, added, () => {});   // added ≡ [a, b]（makeHooks 双向同桶）
    expect(a.dead).toBe(false);
    expect(b.dead).toBe(false);
  });
  it('buff 缺席 → 同拍直杀（原版凭证语义反面锁）', () => {
    const { hooks, player, added } = makeHooks([]);
    const a = minion(player, hooks, player.cx, player.cy);
    const b = minion(player, hooks, player.cx, player.cy);
    maintainMinionBuffs(player, added, () => {});
    expect(a.dead).toBe(true);
    expect(b.dead).toBe(true);
  });
  it('双球同场 60 拍互不杀（分离力只推不杀；探针场景单测化）', () => {
    const e = mkEnemy(5, 60 * 16 + 1200, 90 * 16);   // >800 不触发攻击
    const { hooks, player } = makeHooks([e]);
    const a = minion(player, hooks, player.cx - 10, player.cy);
    const b = minion(player, hooks, player.cx - 10, player.cy);
    for (let t = 0; t < 60; t++) { a.fixedUpdate(1, hooks); b.fixedUpdate(1, hooks); }
    expect(a.dead).toBe(false);
    expect(b.dead).toBe(false);
  });
});
