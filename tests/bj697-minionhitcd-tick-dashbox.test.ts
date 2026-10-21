// ★BJ697（2026-10-20 BJ696 登记债①②清偿）判别锁。
//  债① MinionHitCd 读位衰减 → 原版逐 t 全表递减：
//   原版 DecrementLocalImmuneTimeCounters（Projectile.cs:17365-17385）在 Update 头
//   :15330 每 t 恰一次,先于一切 AI/伤害;表读（:12595 flag2）纯读无副作用。旧仓
//   「读位衰减」（ready 时才 −1）→ 离靶冻结:敌不在判定窗的拍不衰减,跨次冲刺烧表
//   （BJ696 探针 63/77 拒帧=DPS 3-5× 损耗）。修=MinionHitCd.tick() 宿主 fixedUpdate
//   头驱动（龙链段 parentRef≠null 与头共享实例,唯头 tick=每 t 恰一减）+ready 纯读化。
//   修后探针:hurt 8→48,hitCdSelf 拒帧 63→0。
//  债② 533 冲刺物理盒 +6：GetCollisionParams（Projectile.cs:20102-20105）
//   `type==533 && ai[0]>=6 → colWidth/Height=width/height+6`,resizeAnchor 缺省
//   (0.5,0.5)（:19983）→ Center 锚 26×26,仅 TileCollision 通道（:17697-17698）;
//   NPC 伤害盒（Damage_GetHitbox :15037 无 533 支=恒 20×20）不动（BJ696 反定谳）。
//   hitTilesFx :18304 传裸 width/height=还原后原盒 ✓。
//  ★变异自证：M1 摘 tick 调用 → §1 恰红;M2 ready 回读位衰减 → §1 恰红;
//  M3 摘 dashBox6 包盒 → §2 恰红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MinionProj, MinionHitCd } from '../src/entities/MinionProj';
import type { GameHooks } from '../src/entities/types';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');

function makeHooks() {
  const w = new World(200, 120, 7, 'bj697');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const projectiles: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never, player: player as never, enemies: () => [], critters: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {}, showPickupLabel: () => {},
  } as unknown as GameHooks;
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown) => void } }).entities = {
    projectiles,
    add: (e: unknown) => { projectiles.push(e); },
  };
  return { hooks, player, projectiles };
}

// ============================================================
// §1 债①：逐 t 递减语义（M1/M2 位）
// ============================================================
describe('§1 MinionHitCd 逐 t 递减（原版 :17365-17385/:15330）', () => {
  it('纯读门：无 tick 永拒（旧读位衰减=读一次放一拍,恰为病灶形态）', () => {
    const cd = new MinionHitCd();
    expect(cd.ready(1, 3)).toBe(true);
    // 无 tick 的连续读全部拒（读不再有衰减副作用=原版 :12595 纯读）
    for (let i = 0; i < 10; i++) expect(cd.ready(1, 3)).toBe(false);
  });
  it('★BJ703-F 真回归修正:−1 永免标记不阻断（rainbowBurstHitFace :7910 现役写位,原版 uint 回绕=零阻）', () => {
    const cd = new MinionHitCd();
    expect(cd.ready(1, -1)).toBe(true);          // 首写 −1 过门
    expect(cd.ready(1, -1)).toBe(true);          // 再读不阻断（旧 has() 门恰红=同 tick 后续爆全拒）
    cd.tick(); cd.tick();
    expect(cd.ready(1, -1)).toBe(true);          // tick 不衰零扰动
    expect(cd.ready(2, 5)).toBe(true);           // 异敌正常
    expect(cd.ready(2, 5)).toBe(false);          // cd>0 族照旧阻断
  });
  it('离靶冻结修复：不查询的拍照常衰减（cd=12 → 12 tick 后复通）', () => {
    const cd = new MinionHitCd();
    expect(cd.ready(1, 12)).toBe(true);
    for (let i = 0; i < 11; i++) cd.tick();          // 无人查询,纯墙拍衰减
    expect(cd.ready(1, 12)).toBe(false);             // 第 12 拍仍拒
    cd.tick();
    expect(cd.ready(1, 12)).toBe(true);              // 恰 12 拍复通
  });
  it('实体驱动：533 无敌在场（无查询面）hitCd 表仍随 fixedUpdate 衰减', () => {
    const { hooks, player } = makeHooks();
    const m = new MinionProj(player.cx, player.cy, 533, 25, 4, false, 0, false, () => player);
    const cd = m.hitCd as unknown as MinionHitCd;
    expect(cd.ready(42, 12)).toBe(true);
    for (let t = 0; t < 12; t++) m.fixedUpdate(1 / 60, hooks);   // 无敌人=零查询
    expect(cd.ready(42, 12)).toBe(true);             // 旧实现:恒 false(冻结)恰红
  });
  it('龙链共享实例单减：头 tick 段不 tick（源锚）+ 段 parentRef 守卫', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    expect(src).toContain('if (!this.parentRef) this.hitCd.tick();');
    // 段共享位（两处）在案
    expect(src).toContain('m.hitCd = this.hitCd; // 全链共用命中表');
    expect(src).toContain('a.hitCd = b.hitCd = this.hitCd;');
  });
  it('龙链行为：头+段同拍各跑 fixedUpdate → 表恰减 1', () => {
    const { hooks, player, projectiles } = makeHooks();
    const head = new MinionProj(player.cx, player.cy, 625, 25, 4, false, 0, false, () => player);
    projectiles.push(head);
    head.fixedUpdate(1 / 60, hooks);                 // 首:spawn 段 626-628
    const seg = projectiles.find((m) => (m as MinionProj).projId === 626) as MinionProj;
    expect(seg).toBeDefined();
    const cd = head.hitCd as unknown as MinionHitCd;
    expect(cd.ready(42, 7)).toBe(true);
    // 恰减 1:6 拍后仍拒,7 拍复通（若段也 tick=双速恰红）
    for (let t = 0; t < 6; t++) { head.fixedUpdate(1 / 60, hooks); seg.fixedUpdate(1 / 60, hooks); }
    expect(cd.ready(42, 7)).toBe(false);
    head.fixedUpdate(1 / 60, hooks); seg.fixedUpdate(1 / 60, hooks);
    expect(cd.ready(42, 7)).toBe(true);
  });
});

// ============================================================
// §2 债②：533 冲刺物理盒 +6（M3 位;行为面由 bj650 ④校准位承载）
// ============================================================
describe('§2 533 冲刺物理盒 26×26（GetCollisionParams :20102-20105）', () => {
  it('integrate533 包盒源锚：dA0≥6 → w/h+6 中心锚 + moveAndCollide 后按新中心还原', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
    const i = src.indexOf('private integrate533');
    const block = src.slice(i, src.indexOf('private ', i + 10));
    expect(block).toContain('const dashBox6 = this.dA0 >= 6;');
    expect(block).toContain('this.w += 6; this.h += 6; this.x -= 3; this.y -= 3;');
    expect(block).toContain('this.x = ncx533 - ow533 / 2; this.y = ncy533 - oh533 / 2;');
    // 还原在 hitTilesFx 之前（裸盒消费面 :18304 传 width/height 非 colWidth）
    const iRestore = block.indexOf('this.x = ncx533 - ow533 / 2');
    const iHitTiles = block.indexOf('game.hitTilesFx');
    expect(iRestore).toBeGreaterThan(-1);
    expect(iHitTiles).toBeGreaterThan(iRestore);
  });
  it('反编译锚：type==533 && ai[0]>=6 → colWidth/Height +6;resizeAnchor (0.5,0.5)', () => {
    const van = readFileSync(join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');
    const i = van.indexOf('else if (type == 533 && ai[0] >= 6f)');
    expect(i).toBeGreaterThan(-1);
    expect(van.slice(i, i + 160)).toContain('colWidth = width + 6;');
    expect(van.slice(i, i + 200)).toContain('colHeight = height + 6;');
    const g = van.indexOf('public void GetCollisionParams');
    expect(van.slice(g, g + 200)).toContain('resizeAnchor = new Vector2(0.5f, 0.5f)');
  });
  it('伤害盒不动锚：Damage_GetHitbox 无 533 支（NPC 伤害恒 20×20,BJ696 反定谳）', () => {
    const van = readFileSync(join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');
    const g = van.indexOf('public Rectangle Damage_GetHitbox()');
    expect(g).toBeGreaterThan(-1);
    const block = van.slice(g, g + 4200);   // 函数体（下一 public 方法前）
    expect(block, 'Damage_GetHitbox 无 533 支（20×20 恒定）').not.toContain('== 533');
  });
});
