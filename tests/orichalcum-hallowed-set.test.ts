// 终零波·Player.ts 域批（2026-09-01）回归锚——硬模式矿族 on-hit 三套 + 神圣幻影闪避链。
// 原版真值 = Terarria1458：
//   · ArmorSetBonuses.cs :455-464 全组合展开(Builder.Set(int[],int[],int[]) :81-107)
//     与 Effect 赋值 :216-236（Palladium/Orichalcum/Hallowed/HallowedSummoner）；
//   · Player.OnHit（Player.cs:6913-7040）：钛金→神圣 buff59(:6937-6940)→帕拉钯
//     buff58(:6942-6945)→花瓣弹 221(:6963-6985)→叶绿引援叶(:6986-7040) 同位次链；
//   · 弹 221 SetDefaults（Projectile.cs:3068-3080）+ AI_041（:28179-28189）
//     + extraUpdates=2 子步折叠（Projectile.Update :16781-17346）；
//   · 快速再生 lifeRegenCount+=4/t（UpdateLifeRegen :19385-19387）；
//   · Hurt 第四闪避支（:38516-38519 → ShadowDodge :38306-38326）。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { BuffType } from '../src/stats/Buffs';
import { Game } from '../src/core/Game';
import { Enemy } from '../src/entities/Enemy';
import { OrichalcumPetal } from '../src/entities/OrichalcumPetalProj';
import {
  HurtCooldownBuckets,
  registerGlobalHurtBuckets,
} from '../src/player/HurtCooldownBuckets';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

function mkWorld(): World {
  const w = new World(160, 160, 33, 'final-wave-player');
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, 60, 1, 0, 0);
  return w;
}

/** 佩戴三件套并走真实装备路径（equipStats 记忆化对象为只读快照，不直改） */
function equipSet(p: Player, headVid: number, bodyVid: number, legsVid: number): void {
  p.inv.armor[0] = { id: iid(headVid), stack: 1 };
  p.inv.armor[1] = { id: iid(bodyVid), stack: 1 };
  p.inv.armor[2] = { id: iid(legsVid), stack: 1 };
}

function playerStub(): Player {
  return new Player(40 * 16, 54 * 16, new Inventory());
}

/** Object.create(Game.prototype) 桩（chloro-setbonus.test 同构）——camera 世界 px 布局 */
function gameStub(p: Player): {
  g: Record<string, unknown>;
  cam: { x: number; y: number; viewW: number; viewH: number; zoom: number };
} {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  g.player = p;
  const projArr: unknown[] = [];
  g.entities = { projectiles: projArr, add: (e: unknown) => { projArr.push(e); return e; } };
  // camera: 视区中心 (10000,2000)、canvas 1280×720、zoom=2 ⇒ 世界视区 640×360
  const cam = { x: 10000, y: 2000, viewW: 1280, viewH: 720, zoom: 2 };
  g.camera = cam;
  return { g, cam };
}

/** 完整 hooks 桩（blue-r6 fakeHooks 同构 + 本批消费钩子面） */
function fakeHooks(w: World, p?: Player): Record<string, unknown> {
  return {
    world: w, player: p ?? null,
    enemies: () => [], critters: () => [], projectiles: () => [],   // ★BJ744 改判史：G36-A BJ740-D2 清偿线 Player.ts:5159 读 game.projectiles?.()（GameHooks 契约=方法,旧数组形夹具炸 is not a function）
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    spawnDust: () => {}, showPickupLabel: () => {}, recLog: () => {},
    scene: {},
    spawnOnHitPetals: undefined, spawnTitaniumShard: undefined,
  };
}

describe('①套装表收编（ArmorSetBonuses.cs :455-464 展开面 ↔ vanillaArmorSets 键）', () => {
  it.each([1210, 1211, 1212])('山铜头 %i × 胸 1213 × 腿 1214 → onHitPetal', (headVid) => {
    const p = playerStub();
    equipSet(p, headVid as number, 1213, 1214);
    expect(p.equipStats.onHitPetal).toBe(true);
    expect(p.equipStats.onHitDodge).toBe(false);
    expect(p.equipStats.onHitRegen).toBe(false);
  });
  it.each([1205, 1206, 1207])('帕拉钯头 %i × 胸 1208 × 腿 1209 → onHitRegen', (headVid) => {
    const p = playerStub();
    equipSet(p, headVid as number, 1208, 1209);
    expect(p.equipStats.onHitRegen).toBe(true);
  });
  it.each([
    [553, '头盔'], [558, '面具'], [559, '头饰'],
    [4896, '远古面具'], [4897, '远古头盔'], [4898, '远古头饰'],
  ])('神圣头 %i(%s) × 神圣胸腿首档 → onHitDodge', (headVid) => {
    const p = playerStub();
    equipSet(p, headVid as number, 551, 552);
    expect(p.equipStats.onHitDodge).toBe(true);
  });
  it('神圣胸/腿第二变体（4900 远古胸/4901 远古腿）→ onHitDodge', () => {
    const p = playerStub();
    equipSet(p, 4896, 4900, 4901);
    expect(p.equipStats.onHitDodge).toBe(true);
  });
  it.each([4873, 4899])('神圣召唤兜帽头 %i → onHitDodge 召唤上限走旧双链合计 +3', (headVid) => {
    const bare = playerStub();
    const minionsBefore = bare.maxMinions;
    const p = playerStub();
    equipSet(p, headVid as number, 4900, 4901);
    expect(p.equipStats.onHitDodge).toBe(true);
    // maxMinions+2 不在 vanillaArmorSets 新表承载（防双记）——vanilla 同效旧链：
    // 兜帽散件 SUMMON_GEAR{slot:1}(:16023 头件固有) + SUMMON_SET 套键{slot:2}
    expect(p.maxMinions).toBe(minionsBefore + 3);   // 1(散件)+2(套装)=+3（:229 等效面）
  });
  it('混搭缺一不亮（山铜头+神圣胸腿→全 false）；快照换装即时生效', () => {
    const p = playerStub();
    equipSet(p, 1210, 551, 552);
    expect(p.equipStats.onHitPetal).toBe(false);
    expect(p.equipStats.onHitDodge).toBe(false);
    expect(p.equipStats.onHitRegen).toBe(false);
    equipSet(p, 553, 551, 552);
    expect(p.equipStats.onHitDodge).toBe(true);       // 记忆化键随装备变化重建
  });
});

describe('②Game.spawnOnHitPetals（Player.OnHit :6963-6985 直译）', () => {
  function armedPlayer(): Player {
    const p = playerStub();
    equipSet(p, 1210, 1213, 1214);       // 山铜 Mask 三件
    return p;
  }

  it('命中拍：petalTimer=20 置位 + 出生恰一只 type221 dmg36/kb0/crit0/pierce−1 面', () => {
    const p = armedPlayer();
    const { g } = gameStub(p);
    const spawnOnHitPetals = (g as unknown as { spawnOnHitPetals: (x: number, y: number) => void })
      .spawnOnHitPetals;
    spawnOnHitPetals.call(g, 10100, 2050);
    expect(p.petalTimer).toBe(20);                       // :6964 共享窗 20t
    const petal = ((g.entities as { projectiles: OrichalcumPetal[] }).projectiles)[0];
    expect(petal.projId).toBe(221);
    expect(petal.damage).toBe(36);                       // NewProjectile 字面量（:6984）
    expect(petal.knockback).toBe(0);
    expect(petal.critChance).toBe(0);                    // 无类别旗永不暴击（δA bug① 先例）
    expect(petal.lifeT).toBe(120);                       // SetDefaults timeLeft
  });

  it.each([1, -1])('facing=%i：出生点=朝向背面屏幕边、y∈屏带、速度恰 24px/子步指向命中点', (facing) => {
    const p = armedPlayer();
    p.facing = facing;
    const { g, cam } = gameStub(p);
    const spawnOnHitPetals = (g as unknown as { spawnOnHitPetals: (x: number, y: number) => void })
      .spawnOnHitPetals;
    const sx = cam.x - cam.viewW / (2 * cam.zoom);        // Main.screenPosition.X
    const sy = cam.y - cam.viewH / (2 * cam.zoom);
    const sw = cam.viewW / cam.zoom;
    const sh = cam.viewH / cam.zoom;
    spawnOnHitPetals.call(g, sx + sw / 2, sy + sh / 2);   // 命中点≈屏中
    const petal = (g.entities as { projectiles: OrichalcumPetal[] }).projectiles[0];
    expect(petal.x).toBe(facing === 1 ? sx : sx + sw);    // :6968-6970 direction 分支
    expect(petal.y).toBeGreaterThanOrEqual(sy);           // y2=sy+Next(screenHeight)
    expect(petal.y).toBeLessThan(sy + sh);
    expect(Math.hypot(petal.vx, petal.vy)).toBeCloseTo(24, 3);   // 无条件 24f/len 归一
  });

  it('petalTimer!=0 早退（与叶绿引援共享窗）；无套装早退且不置位', () => {
    const p = armedPlayer();
    p.petalTimer = 20;                                    // 叶绿刚引援过（同字段）
    const { g } = gameStub(p);
    (g as unknown as { spawnOnHitPetals: (x: number, y: number) => void })
      .spawnOnHitPetals.call(g, 10100, 2050);
    expect((g.entities as { projectiles: unknown[] }).projectiles.length).toBe(0);

    const bare = playerStub();                            // 未穿山铜
    const g2 = gameStub(bare);
    (g2.g as unknown as { spawnOnHitPetals: (x: number, y: number) => void })
      .spawnOnHitPetals.call(g2.g, 10100, 2050);
    expect((g2.g.entities as { projectiles: unknown[] }).projectiles.length).toBe(0);
    expect(bare.petalTimer).toBe(0);                      // 门内不置位（原版同序）
  });
});

describe('③OrichalcumPetal 实体（AI_041 + extraUpdates 子步折叠）', () => {
  function petGame(w: World): GameHooksLike {
    return { world: w, enemies: () => [] } as unknown as GameHooksLike;
  }
  interface GameHooksLike {
    world: World;
    fixedUpdateWasCalled?: boolean;
  }

  it('每 tick 推进 ×3 子步、rotation += vx*0.01×3、timeLeft 折叠寿命 40 拍静默消亡', () => {
    const game = petGame(mkWorld());
    const petal = new OrichalcumPetal(1200, 1200, 4, 6);   // 世界中心区：40 拍位移
    const r0 = petal.rot;                                  // ((48,72)) 不触任何边界带
    petal.fixedUpdate(1 / 60, game as never);
    expect(petal.x).toBeCloseTo(1200 + 12, 4);             // position += velocity ×3（EU=2）
    expect(petal.y).toBeCloseTo(1200 + 18, 4);
    expect(petal.rot).toBeCloseTo(r0 + 4 * 0.01 * 3, 4);   // AI_041 每子步 :28186
    expect(petal.lifeT).toBe(117);                         // 120 − 3 子步
    let t = 1;
    while (!petal.dead && t < 60) { petal.fixedUpdate(1 / 60, game as never); t++; }
    expect(t).toBe(40);                                    // 恰第 40 拍寿命尽（120/3）
    expect(petal.dead).toBe(true);
  });

  it('tileCollide=false：穿过实心墙体不消亡（穿透飞行,AI_041 无碰撞段）', () => {
    const w = mkWorld();
    for (let y = 40; y <= 58; y++) w.store.setTileSilent(52, y, 1, 0, 0);
    const game = petGame(w);
    const petal = new OrichalcumPetal(700, 952, 8, 0);    // 横向直穿墙柱(格 52)
    const x0 = petal.x;
    petal.fixedUpdate(1 / 60, game as never);
    expect(petal.dead).toBe(false);
    expect(petal.x).toBeGreaterThan(x0 + 20);             // 已越过墙缘(仍在飞)
  });

  it('世界边界原值判定：越过世界右缘即出界消亡（Projectile.cs:16787 同式）', () => {
    const w = mkWorld();
    const game = petGame(w);
    const tw = w.store.w * 16;
    const petal = new OrichalcumPetal(tw - 60, 400, 30, 0);   // 右缘近旁高速外向
    petal.fixedUpdate(1 / 60, game as never);
    expect(petal.dead).toBe(true);
  });
});

describe('④Enemy.hurt OnHit 链（:6937 神圣/:6942 帕拉钯/:6963 山铜 与钛金同位次）', () => {
  function enemyAndHooks(headVid: number, bodyVid: number, legsVid: number) {
    const e = Enemy.fromVanilla(21, 0, 0)!;               // 绿史莱姆
    e.maxHp = 100000; e.hp = 100000;
    (e.def as { defense?: number }).defense = 0;
    const p = playerStub();
    equipSet(p, headVid, bodyVid, legsVid);
    // 先绑定原实现再上 spy——mock 内直呼 this.apply 会自指递归
    const origApply = p.buffs.apply.bind(p.buffs) as (t: BuffType, s: number) => void;
    const applySpy = vi.spyOn(p.buffs, 'apply').mockImplementation(origApply);
    const petalCalls: Array<{ x: number; y: number }> = [];
    const hooks = Object.assign(fakeHooks(mkWorld(), p), {
      spawnOnHitPetals: (x: number, y: number): void => {
        p.petalTimer = 20;                                // 复刻 Game 端置位
        petalCalls.push({ x, y });
      },
      spawnTitaniumShard: (): void => {},
    });
    return { e, p, hooks: hooks as never, applySpy, petalCalls };
  }

  it('神圣套命中 → 施加 ShadowDodge(59)；timer≠0 时不再施加（:6938 门）', () => {
    const { e, p, hooks, applySpy } = enemyAndHooks(553, 551, 552);
    e.hurt(50, 1, -2, hooks, 0, false, 0, true);          // fromPlayer=true
    expect(applySpy.mock.calls.map((c) => c[0])).toContain(BuffType.ShadowDodge);
    const has59 = (p as unknown as { hasVanillaBuff(v: number): boolean })
      .hasVanillaBuff(59);
    expect(has59).toBe(true);
    p.shadowDodgeTimer = 1800;
    e.iframes = 0;
    applySpy.mockClear();
    e.hurt(50, 1, -2, hooks, 0, false, 0, true);
    expect(applySpy.mock.calls.map((c) => c[0])).not.toContain(BuffType.ShadowDodge);
  });

  it('来源排除表拒收（srcProjId∈{221,227,908…} 不授 buff/不放花瓣）', () => {
    const { e, hooks, applySpy, petalCalls } = enemyAndHooks(1210, 1213, 1214);
    e.hurt(50, 1, -2, hooks, 0, false, 0, true, 0, 908);   // 钛金碎片再命中
    expect(applySpy.mock.calls.length).toBe(0);
    expect(petalCalls.length).toBe(0);
  });

  it('非 fromPlayer 命中（敌方内战/环境）不触发整条 OnHit 链', () => {
    const { e, hooks, applySpy, petalCalls } = enemyAndHooks(1210, 1213, 1214);
    e.hurt(50, 1, -2, hooks);                              // 缺省 fromPlayer=false
    expect(applySpy.mock.calls.length).toBe(0);
    expect(petalCalls.length).toBe(0);
  });

  it('山铜套命中 → 钩子携带受击敌怪中心并只有残血>5 时触发', () => {
    const { e, hooks, petalCalls } = enemyAndHooks(1210, 1213, 1214);
    e.hurt(50, 1, -2, hooks, 0, false, 0, true);
    expect(petalCalls.length).toBe(1);
    expect(petalCalls[0].x).toBe(e.cx);                    // victim.Center 代 OnHit(x,y)
    e.hp = 3;                                              // life>5 残血门外的死亡边缘
    e.iframes = 0;
    e.hurt(2, 1, -2, hooks, 0, false, 0, true);
    expect(petalCalls.length).toBe(1);                     // 残血豁免门拒收
  });

  it('第四闪避支闭环：buff59 在场受伤 → 返回 0+免疫满填+timer=1800+剥离', () => {
    registerGlobalHurtBuckets(new HurtCooldownBuckets());
    const p = playerStub();
    p.buffs.apply(BuffType.ShadowDodge, 30);               // AddBuff(59,1800) 等价
    const dealt = p.damage(100, p.cx, p.y - 10, false, false, 1);
    expect(dealt).toBe(0);                                 // Hurt 第四支清零（:38517-19）
    expect(p.shadowDodgeTimer).toBe(1800);                 // :38326 重整窗
    expect(p.iframes).toBeGreaterThan(0);                  // ShadowDodge 免疫满填面
  });

  it('帕拉钯套命中 → 施加 RapidHealing(58)；再生段 flat +4/t（:19385-19387）', () => {
    const { e, p, hooks, applySpy } = enemyAndHooks(1205, 1208, 1209);
    e.hurt(50, 1, -2, hooks, 0, false, 0, true);
    expect(applySpy.mock.calls.map((c) => c[0])).toContain(BuffType.RapidHealing);
    // 再生消费差分：两测各把 lifeRegenTime 钉回同值（num5 相同）、accum 钉
    // 0.5（防跨 1 取整边界分岔），单拍增量只差 flat +4/120
    const acc = (): number => (p as unknown as { regenAccum: number }).regenAccum;
    expect(p.maxHp).toBeGreaterThanOrEqual(100);
    for (let i = 0; i < 30 && !p.onGround; i++) p.fixedUpdate(1 / 60, hooks as never);   // 落地稳态
    p.hp = p.maxHp - 40;                       // 开再生窗（hp<maxHp 且非致死档）
    p.buffs.apply(BuffType.RapidHealing, 10);
    p.lifeRegenTime = 600;
    (p as unknown as { regenAccum: number }).regenAccum = 0.5;   // 半程余量防边界
    p.fixedUpdate(1 / 60, hooks as never);
    const withDelta = acc() - 0.5;                               // 本拍入账量
    expect(withDelta).toBeGreaterThan(0);                        // 有再生在累积
    p.buffs.remove(BuffType.RapidHealing);
    p.lifeRegenTime = 600;
    (p as unknown as { regenAccum: number }).regenAccum = 0.5;
    p.fixedUpdate(1 / 60, hooks as never);
    const withoutDelta = acc() - 0.5;
    expect(withoutDelta).toBeGreaterThanOrEqual(0);
    expect(withDelta - withoutDelta).toBeCloseTo(4 / 120, 2);   // lifeRegenCount += 4/拍
  });
});

describe('⑤甲件 aggro 轴（终零波批,GrantArmorBenefits :13852-13874/:13983-13997）', () => {
  it('龟甲三件 1316/1317/1318 → aggro +750（250×3 多源叠加）', () => {
    const p = playerStub();
    equipSet(p, 1316, 1317, 1318);
    expect(p.equipStats.aggroPiece).toBe(750);
    expect(p.aggro).toBe(750);              // 无潜行链 → 裸叠
  });
  it('甲虫防御档 2199/2201/2202 → +900（头/腿 250 + 壳胸 400）;进攻档 2200 无贡献', () => {
    const def = playerStub();
    equipSet(def, 2199, 2201, 2202);
    expect(def.equipStats.aggroPiece).toBe(900);
    const off = playerStub();
    equipSet(off, 2199, 2200, 2202);
    expect(off.equipStats.aggroPiece).toBe(500);
  });
  it('日曜三件 → +900；无潜行链时 getter 直通', () => {
    const p = playerStub();
    equipSet(p, 2763, 2764, 2765);
    expect(p.equipStats.aggroPiece).toBe(900);
    expect(p.aggro).toBe(900);
  });
});
