// 清偿刀 E（X 波 2026-09-29）：X4-债3（死亡/幽灵相 buff 计时面）+ X4-债4（BJ401 残面
// 4262 特效旗/手持光抑制）落刀判别测试。
// 定谳锚（1457 反编译亲读）：
//  ① X4-债3：
//   - 死亡相清非持久 buff：UpdateDead Player.cs:17112-17117
//     `for i<maxBuffs: if (buffType[i]<=0 || !Main.persistentBuff[buffType[i]])
//     { buffTime[i]=0; buffType[i]=0; }`——裸字段写零，无音效/尘等视觉伴随。
//   - Main.persistentBuff 全表仅 8 项置真（Main.cs:9337-9344）= 武器浸剂八族
//     {71,73-79}；72 Midas 不在内（BuffID.cs:295-311 实名核对）。
//   - 幽灵/死亡相 UpdateBuffs 不跑：Player.Update ghost/dead 早退（:24938-24948）
//     先于主调用 :25763——计时冻结；死亡相改跑 UpdateDead（每帧同幂等清）。
//  ② X4-债4：
//   - 耍蛇笛 4262 音符 gore：ItemCheck_ApplyUseStyle useStyle==5 支 Player.cs:51723-51751
//     （itemAnimation>0 每帧经 AnimatePlayerAndGetItemFrame :43712）：Next(20)==0 →
//     gore Next(570,573) @(Center.X+dir·30−6, itemLocation.Y−30)、itemLocation.Y=
//     MountedCenter.Y−6 → 净 Y=MountedCenter.Y−36；v=(WindForVisuals×2+dir·0.3,−0.5)
//     逐分量 ×(1+Next(−50,51)×0.01)；571→X−4、572→X−8；scale 0.8；门=非
//     DontHoldItems 坐骑（:51735-51737）。
//   - 手持光/食饮粒子门：Player.cs:43178 `if (!JustDroppedAnItem && IsAllowedToHoldItems)`
//     ——IsAllowedToHoldItems 由变身坐骑 case 55/56/61 置 false（Mount.cs:5195-5200）。
//  ③ X4-债6（迅猛龙身前非脸族）：真偏差已修（Renderer drawAccFrontLayers 54 豁免支拆除），
//     行为判别在 bj401-mount61-equip-hidden.test.ts；此处锁 vanilla 锚原读面。
// 变异证红：M1 摘死亡相 clearNonPersistent → 死亡相清组红；M2 tick 门回退（this.dead?0:
// → 无条件 tick）→ 幽灵相冻结组红。（cp 备份+逐字节还原+sha256 对拍）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { BuffState, BuffType, PERSISTENT_BUFFS } from '../src/stats/Buffs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const mkWorld = (): World => new World(200, 120, 42, 'x4-debt3');

const fakeHooks = (w: World, p: Player) => ({
  world: w,
  player: p,
  enemies: () => [],
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
});

const step = (p: Player, w: World, ticks = 1): void => {
  for (let i = 0; i < ticks; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
};

// ============================================================
// ① X4-债3：死亡相清非持久 buff + 幽灵/死亡相 tick 冻结
// ============================================================
describe('X4-债3-A 持久表锚（Main.cs:9337-9344 全表 8 项）', () => {
  it('PERSISTENT_BUFFS = 武器浸剂八族 {71,73-79}；72 Midas 不在内', () => {
    expect([...PERSISTENT_BUFFS].sort((a, b) => a - b)).toEqual([71, 73, 74, 75, 76, 77, 78, 79]);
    expect(PERSISTENT_BUFFS.has(72)).toBe(false);
  });
});

describe('X4-债3-B clearNonPersistent（UpdateDead :17112-17117 判据 1:1）', () => {
  it('浸剂幸存，其余（含 72 邻域金药剂例 Ironskin/Regen/OnFire）全清（★BJ739 B06 改判：'
    + '浸剂同刻仅一——Main.meleeBuff 互斥 Main.cs:9100-07+Player.cs:5352-65,旧夹具三浸剂'
    + '并存系未建互斥期的 un-vanilla 前提,改单浸剂+逐族轮换）', () => {
    // 八浸剂逐员轮换：每个单独挂+清非持久 → 幸存且计时不折损
    for (const [bt, vid] of [[BuffType.ImbueVenom, 71], [BuffType.ImbueCursed, 73],
      [BuffType.ImbueFire, 74], [BuffType.ImbueGold, 75], [BuffType.ImbueIchor, 76],
      [BuffType.ImbueNano, 77], [BuffType.ImbueParty, 78], [BuffType.ImbuePoison, 79]] as const) {
      const b = new BuffState();
      b.apply(bt, 10);                   // 持久族
      b.apply(BuffType.Ironskin, 10);    // 5 非持久
      b.apply(BuffType.Regen, 10);       // 2 非持久
      b.apply(BuffType.OnFire, 10);      // 24 非持久
      b.clearNonPersistent();
      expect(b.has(bt), `浸剂 ${vid} 幸存`).toBe(true);
      expect(b.active.get(bt)).toBe(10); // 幸存者计时不折损
      expect(b.has(BuffType.Ironskin)).toBe(false);
      expect(b.has(BuffType.Regen)).toBe(false);
      expect(b.has(BuffType.OnFire)).toBe(false);
    }
  });
  it('互斥相锁（BJ739 B06）：换浸剂 = 旧浸剂即刻出栏（死亡清非持久时栏内恒仅一新浸剂）', () => {
    const b = new BuffState();
    b.apply(BuffType.ImbueVenom, 10);
    b.apply(BuffType.ImbuePoison, 30);   // 换毒 → 毒液即刻出栏
    b.clearNonPersistent();
    expect(b.has(BuffType.ImbuePoison)).toBe(true);
    expect(b.active.get(BuffType.ImbuePoison)).toBe(30);
    expect(b.has(BuffType.ImbueVenom)).toBe(false);
  });
});

describe('X4-债3-C 死亡相：死亡分支清非持久 buff（每 tick 幂等）+ 浸剂幸存', () => {
  it('hp≤0 首拍：非持久全清、浸剂保留（原版死亡帧 UpdateDead 即清）', () => {
    const w = mkWorld();
    const p = new Player(100 * TILE, 60 * TILE, new Inventory());
    p.buffs.apply(BuffType.ImbueVenom, 10);
    p.buffs.apply(BuffType.Ironskin, 10);
    p.hp = 0;
    step(p, w, 1);
    expect(p.dead).toBe(true);
    expect(p.buffs.has(BuffType.Ironskin)).toBe(false);    // 死亡即清
    expect(p.buffs.has(BuffType.ImbueVenom)).toBe(true);   // 持久幸存
  });
  it('死亡相次拍起 tick 停：幸存浸剂计时冻结（原版死亡相 buffTime 不走 UpdateBuffs 递减）', () => {
    const w = mkWorld();
    const p = new Player(100 * TILE, 60 * TILE, new Inventory());
    p.buffs.apply(BuffType.ImbueVenom, 10);
    p.hp = 0;
    step(p, w, 1);
    expect(p.dead).toBe(true);
    const t1 = p.buffs.active.get(BuffType.ImbueVenom)!;
    step(p, w, 30);                                        // 半秒死亡相
    expect(p.buffs.active.get(BuffType.ImbueVenom)).toBe(t1);   // 冻结（旧病=前进 0.5s）
  });
});

describe('X4-债3-D 幽灵相：UpdateBuffs 整门停（Player.cs:24938-24942 先于 :25763）', () => {
  it('hardcore 幽灵（dead∧difficulty2∧respawnTimer≤0）：buff 计时零前进', () => {
    const w = mkWorld();
    const p = new Player(100 * TILE, 60 * TILE, new Inventory());
    p.hp = 0;
    p.dead = true;
    p.respawnTimer = 0;
    (p as unknown as { _deathPartsInit: boolean })._deathPartsInit = true;
    (p as unknown as { appearance?: { difficulty: number } }).appearance = { difficulty: 2 };
    p.buffs.apply(BuffType.ImbueVenom, 10);
    expect(p.isGhostPhase(w)).toBe(true);
    const t0 = p.buffs.active.get(BuffType.ImbueVenom)!;
    step(p, w, 60);                                        // 幽灵相一秒自由飞行
    expect(p.buffs.active.get(BuffType.ImbueVenom)).toBe(t0);   // 冻结（旧病=前进 1s）
  });
  it('幽灵相非持久 buff 不复活也不消散（死亡相已清空=终态）', () => {
    const w = mkWorld();
    const p = new Player(100 * TILE, 60 * TILE, new Inventory());
    p.buffs.apply(BuffType.ImbueVenom, 10);
    p.hp = 0;
    step(p, w, 1);                                         // 死亡相清非持久
    p.respawnTimer = 0;
    (p as unknown as { appearance?: { difficulty: number } }).appearance = { difficulty: 2 };
    step(p, w, 10);
    expect(p.buffs.has(BuffType.ImbueVenom)).toBe(true);
    expect(p.buffs.has(BuffType.OnFire)).toBe(false);
  });
});

// ============================================================
// ② X4-债4：4262 音符 gore 位 + 手持光抑制门（源码锚,era-guard 家族）
// ============================================================
describe('X4-债4 源码锚锁（Game.ts）', () => {
  const src = read('src/core/Game.ts');

  it('耍蛇笛音符 gore 位在途（ApplyUseStyle :51723-51751 1:1 面）', () => {
    const i = src.indexOf('耍蛇笛 4262 音符 gore');
    expect(i).toBeGreaterThan(0);
    const seg = src.slice(i, i + 1800);
    expect(seg).toContain('=== 4262');                              // 特效旗挂 vid
    expect(seg).toContain('570 + Math.floor(Math.random() * 3)');   // Next(570,573)
    expect(seg).toContain('Math.floor(Math.random() * 20) === 0');  // Next(20)==0
    expect(seg).toContain("this.player.cx + dir * 30 - 6");         // Center.X+dir·30−6
    expect(seg).toContain('this.player.cy - 36');                   // MountedCenter.Y−6−30
    expect(seg).toContain('vid57x === 572');                        // 572→X−8
    expect(seg).toContain('vid57x === 571');                        // 571→X−4
    expect(seg).toContain('wind * 2 + dir * 0.3');                  // WindForVisuals×2+dir·0.3
    expect(seg).toContain('-0.5 * (1 + jy)');                       // vy=−0.5
    expect(seg).toContain('GorePiece.newGore(vid57x');              // 非 perfect=标准扰动
  });
  it('音符位挂 DontHoldItems 门（:51735-51737 flag 支同相）', () => {
    const i = src.indexOf('耍蛇笛 4262 音符 gore');
    const seg = src.slice(i, i + 1800);
    expect(seg).toContain('MOUNT_SETS.DontHoldItems?.[this.player.mount.type] ?? false');
  });
  it('手持光挂 IsAllowedToHoldItems 同义门（:43178——DontHoldItems 三坐骑 heldDef=null）', () => {
    const i = src.indexOf('★X4-债4 手持光抑制半边');
    expect(i).toBeGreaterThan(0);
    const seg = src.slice(i, i + 700);
    expect(seg).toContain('MOUNT_SETS.DontHoldItems?.[player.mount.type] ?? false');
    expect(seg).toContain('? null');
  });
});

// ============================================================
// ③ X4-债6：迅猛龙 ExceptHelmets 染色面锚（行为判别在 bj401 套件）
// ============================================================
describe('X4-债6 源码锚锁（Renderer.ts）', () => {
  const src = read('src/render/Renderer.ts');
  it('veloHead 头盔照画路径在位（ExceptHelmets 保留 colorArmorHead 半边）', () => {
    expect(src).toContain('const veloHead = mntHidden && p.mount.type === 54;');
  });
  it('drawAccFrontLayers 旧 54 豁免支已拆（身前非脸族整隐=原版染色面）', () => {
    const i = src.indexOf('private drawAccFrontLayers');
    const seg = src.slice(i, i + 2400);
    expect(seg).toContain('MOUNT_SETS.PlayerIsHidden?.[mnt.type]) return;');
    expect(seg).not.toContain('mnt.type !== 54');
  });
});
