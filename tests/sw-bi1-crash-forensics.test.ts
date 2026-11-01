// SW-BI1 2026-09-06 用户崩溃报告法证与修复（沙漠滚仙人掌球 → `k.hurt is not a function`
// → 帧循环守卫停机；同报告 49 连发 textContent 空指针）。
//
// 定谳链（详见报告）：
//  ① 致命崩溃 = 无 hurt 方法的对象流入 `.hurt(` 接收位。两条可达通道：
//     a) damagePlayer 的 attacker 槽（荆棘/日曜反击面 attacker.hurt）——滚仙人掌球
//        RollingBoulder 曾把自身当 attacker 传入（GameHooks.damagePlayer 形参放宽为
//        unknown 绕过类型闸）；本仓修复 = 弹侧不再传 attacker（全弹族调用约定）。
//     b) TrapShot 敌对陷阱弹的 critters/npcs 桶循环——npcs 桶含 PetFollower（宠物，
//        Game.updatePetSlot 入 'npcs' 桶、无 hurt 方法），机关镖/焰/冰雹弹碰上即炸。
//  ② 前任代理的「敌怪桶→城镇 NPC 唤醒链（wakeBoundEnemyNpc）」假说被物证排除：
//     崩溃帧玩家 x=54222，沉睡渔夫(v_376) x=101465（相距 4.7 万像素、满血仍在桶），
//     npcMove 遥测 8 镇民 ×82 次无 angler —— 唤醒从未发生；且迁移序本身安全
//     （e.dead 只标脏、compact 帧尾才摘、新 TownNPC 有 hurt、伤害循环带 instanceof 门）。
//  ③ textContent 刷屏（49 连发、两波、自止）= rAF 合并刷新通道上的非空断言查点
//     （UI.refreshCrafting 防御计数器等）在元素标记不齐时每帧空指针；本批改空守卫。
//
// 无 jsdom：行为面用「真类 + fake game hooks」驱动；落刀面用源文本结构锁。
// 运行：npx vitest run tests/sw-bi1-crash-forensics.test.ts --no-file-parallelism
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { TrapShot } from '../src/entities/Dart';
import { RollingBoulder } from '../src/entities/RollingBoulder';
import { EntityManager } from '../src/entities/Entity';
import { TownNPC } from '../src/entities/TownNPC';
import { PetFollower } from '../src/entities/PetFollower';
import { Enemy } from '../src/entities/Enemy';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

// ---- fake world/store：全空场（liquid=0 / 无实心格）----
function fakeStore() {
  const w = 64, h = 64;
  return {
    w, h,
    type: new Uint8Array(w * h),
    flags: new Uint8Array(w * h),
    slope: new Uint8Array(w * h),
    liquid: new Float32Array(w * h),
    liquidType: new Float32Array(w * h),
    idx: (x: number, y: number) => y * w + x,
    inBounds: (_x: number, _y: number) => true,
    isSolid: (_x: number, _y: number) => false,
    isPlatform: (_x: number, _y: number) => false,
  };
}

function fakeGame(over?: Partial<Record<string, unknown>>) {
  const store = fakeStore();
  const g = {
    world: { store, w: store.w, h: store.h },
    player: { dead: true, x: -9999, y: -9999, w: 1, h: 1, cx: -9999, cy: -9999 },
    enemies: () => [] as unknown[],
    critters: () => [] as unknown[],
    npcs: () => [] as unknown[],
    spawnParticles: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    spawnDust: () => undefined,
    damagePlayerCalls: [] as unknown[][],
    damagePlayer: function (...args: unknown[]) { (g.damagePlayerCalls as unknown[][]).push(args); return 0; },
    ...over,
  };
  return g as unknown as GameHooks & { damagePlayerCalls: unknown[][] };
}

// ================= ① 滚仙人掌球：弹体不得进 attacker 反击槽（根因刀） =================
describe('SW-BI1 RollingBoulder 命中玩家的 attacker 槽', () => {
  it('滚石碰玩家 → damagePlayer 只收 (dmg,sx,sy)，第 4 参 attacker 恒缺省', () => {
    const game = fakeGame();
    // 玩家活体、与滚石相交
    (game as unknown as { player: unknown }).player = {
      dead: false, iframes: 0, x: 100, y: 100, w: 20, h: 30,
    };
    const shot = new RollingBoulder(104, 104, 484);   // 仙人掌球（表值 proj727/dmg35）
    (shot as unknown as { tileCollide?: boolean }).tileCollide = false; // 纯积分（测漏斗不测碰撞）
    // ★SW-BJ93 债1（2026-09-16）随刀更新：aiStyle25 出膛宽限门（:12491 localAI[2]<=7
    //  → PVE/EVP 四面全免）——置拍龄 8 出宽限期（本测主旨=attacker 槽形状,非门面）。
    (shot as unknown as { localAI2: number }).localAI2 = 8;
    shot.vx = 1; shot.vy = 0;
    expect(() => shot.fixedUpdate(1 / 60, game)).not.toThrow();
    expect(game.damagePlayerCalls.length).toBe(1);
    const args = game.damagePlayerCalls[0]!;
    expect(args.length).toBe(3);                       // 无 attacker 实参 —— 反击面不可达
    expect(args[3]).toBeUndefined();
  });

  it('结构锁：RollingBoulder.damagePlayer 调用不含 this（防回归再送弹体进反击槽）', () => {
    const s = src('src/entities/RollingBoulder.ts');
    expect(s).toContain('game.damagePlayer(this.dmg, this.cx, this.cy);');
    expect(s).not.toContain('game.damagePlayer(this.dmg, this.cx, this.cy, this)');
  });
});

// ================= ② TrapShot 敌对弹 × npcs 桶宠物（二道防线） =================
describe('SW-BI1 TrapShot hostile 命中循环', () => {
  /** 宠物形状：有 dead/盒、无 hurt —— PetFollower 在 npcs 桶的真实形状 */
  const petLike = () => ({
    x: 100, y: 88, w: 20, h: 20, dead: false,
    fixedUpdate: () => {},
  });
  /** 城镇 NPC 形状：有 hurt —— 命中应照常结算 */
  const townLike = () => ({
    x: 100, y: 88, w: 20, h: 20, dead: false,
    hurtCalls: [] as unknown[][],
    hurt: function (...a: unknown[]) { (this.hurtCalls as unknown[][]).push(a); return true; },
    fixedUpdate: () => {},
  });

  function shotOver() {
    const critter = {
      x: 100, y: 88, w: 20, h: 20, dead: false,
      hurtCalls: [] as unknown[][],
      hurt: function (...a: unknown[]) { (this.hurtCalls as unknown[][]).push(a); return true; },
      fixedUpdate: () => {},
    };
    const pet = petLike();
    const town = townLike();
    const game = fakeGame({
      entities: { critters: [critter], npcs: [pet, town] },
    });
    // 机关镖（penetrate -1 → 穿透存续）；零速压在目标盒上（dart 无重力不位移）
    const shot = new TrapShot(100, 92, 0, 0, 25, 'dart');
    shot.hostile = true;
    return { game, shot, critter, pet, town };
  }

  it('hostile 机关镖压住宠物+镇民：不炸帧循环、镇民照常结算、宠物（无 hurt）静默跳过', () => {
    const { game, shot, critter, pet, town } = shotOver();
    expect(() => shot.fixedUpdate(1 / 60, game)).not.toThrow();
    expect((critter.hurtCalls as unknown[][]).length).toBe(1);      // critters 桶照常
    expect(critter.hurtCalls[0]![0]).toBe(game);                    // Critter.hurt(game) 单参
    expect((town.hurtCalls as unknown[][]).length).toBe(1);         // 镇民照常
    expect(town.hurtCalls[0]![0]).toBe(25);                         // damage
    expect((pet as { hurtCalls?: unknown }).hurtCalls).toBeUndefined();   // 宠物无 hurt —— 不炸不调
    expect(shot.dead).toBe(false);                                  // penetrate -1 存续
  });

  it('结构锁：TrapShot 三循环均带 hurt 守卫（critters/npcs/hailKill）', () => {
    const s = src('src/entities/Dart.ts');
    expect(s).toContain('if (c.dead || !c.hurt || !overlaps(c)) continue;');
    expect(s).toContain('if (n.dead || !n.hurt || !overlaps(n)) continue;');
    expect(s).toContain('if (t.dead || !t.hurt) continue;');
  });
});

// ================= ③ Game.damagePlayer 反击面守卫（结构锁） =================
describe('SW-BI1 damagePlayer attacker 反击面', () => {
  it('结构锁：荆棘支以 attackerHurtOk 为前置门;日曜支 AoE 化后守卫迁入循环内', () => {
    const s = src('src/core/Game.ts');
    expect(s).toContain(
      "const attackerHurtOk = typeof (attacker as unknown as { hurt?: unknown } | undefined)?.hurt === 'function';");
    expect(s).toContain(
      'if (attacker && attackerHurtOk && contactOnly && !pvp && !attacker.dead && flag3 && !attacker.dontTakeDamage) {');
    // ★BJ748（BJ745 A21 尾迹收口,2026-11-01）：日曜爆闪 608 AoE 化三修——原版 Kill
    //  :73438 penetrate=-1 + Damage() 160×160 盒（盒心=玩家中心）打盒内全敌,无
    //  attacker 门（弹族/环境耗盾也爆）⇒ 旧「attacker && attackerHurtOk && …」前置门
    //  随刀整摘。SW-BI1 防炸面不降级：hurt 形状守卫迁入 AoE 循环内（二道防线）。
    expect(s).toContain(
      'if (ok && p.solarShields < shieldsBefore) {');
    expect(s).toContain(
      "if (typeof en.hurt !== 'function') continue;   // SW-BI1 二道防线（无 hurt 攻击者形状）");
  });

  it('类形状：TownNPC/Enemy 有 hurt（反击面合法接收者）', () => {
    expect(typeof (TownNPC.prototype as unknown as { hurt?: unknown }).hurt).toBe('function');
    expect(typeof (Enemy.prototype as unknown as { hurt?: unknown }).hurt).toBe('function');
  });

  it('类形状：PetFollower 无 hurt（npcs 桶异构成员工厂——守卫存在的理由）', () => {
    expect((PetFollower.prototype as unknown as { hurt?: unknown }).hurt).toBeUndefined();
  });

  it('结构锁：PetFollower 仍入 npcs 桶（异构成员工厂位——新增桶成员必须过 hurt 审计）', () => {
    const s = src('src/core/Game.ts');
    expect(s).toContain("new PetFollower(");
    expect(s).toContain("this.entities.add(f, 'npcs');");
  });
});

// ================= ④ 唤醒迁移序（前任假说排除面的回归保险） =================
describe('SW-BI1 唤醒迁移序不变量', () => {
  it('结构锁：wakeBoundEnemyNpc 先标 dead 再入 npcs 桶（同帧伤害循环仍遍历到的是带 hurt 对象）', () => {
    const s = src('src/core/Game.ts');
    const iDead = s.indexOf('e.dead = true;                      // 原版同槽 Transform');
    const iAdd = s.indexOf("this.entities.add(npc, 'npcs');", iDead);
    expect(iDead).toBeGreaterThan(-1);
    expect(iAdd).toBeGreaterThan(iDead);
  });

  it('行为面：标记 dead 的旧 Enemy + 迁移入桶的新 NPC 过 EntityManager 一帧——dead 摘除、hurt 面完好', () => {
    const mgr = new EntityManager();
    const oldEnemy = {
      dead: true, fixedUpdate: () => {},
      hurtCalls: [] as unknown[][],
      hurt: function (...a: unknown[]) { (this.hurtCalls as unknown[][]).push(a); return true; },
    };
    const migratedNpc = {
      dead: false, fixedUpdate: () => {},
      hurtCalls: [] as unknown[][],
      hurt: function (...a: unknown[]) { (this.hurtCalls as unknown[][]).push(a); return true; },
    };
    (mgr.enemies as unknown[]).push(oldEnemy);       // 唤醒标脏后至帧尾 compact 前的敌怪桶态
    (mgr.npcs as unknown[]).push(migratedNpc);       // wakeBoundEnemyNpc 新建 TownNPC
    expect(() => mgr.update(1 / 60, { player: null } as unknown as never)).not.toThrow();
    expect(mgr.enemies.length).toBe(0);              // compact 摘除旧壳
    expect(mgr.npcs.length).toBe(1);                 // 新 NPC 存续
    expect((migratedNpc.hurt as unknown as { calls?: unknown[] }).calls).toBeUndefined();
    // 迁移后同帧伤害循环照常可达（hurt 仍是 function）
    expect(typeof migratedNpc.hurt).toBe('function');
    migratedNpc.hurt(10, 1, 0, null);
    expect(migratedNpc.hurtCalls.length).toBe(1);
  });
});

// ================= ⑤ textContent 空指针（独立事件） =================
describe('SW-BI1 textContent 逐帧写点空守卫', () => {
  it('结构锁：refreshCrafting 防御计数器 / 合成 ghost 非空断言已改空守卫', () => {
    const s = src('src/ui/UI.ts');
    expect(s).toContain('const defNumEl = defEl.querySelector(\'span\');');
    expect(s).toContain('if (defNumEl) defNumEl.textContent = String(p.defense);');
    expect(s).not.toContain("defEl.querySelector('span')!.textContent");
    expect(s).toContain('const ghostN = ghost.querySelector(\'.n\');');
    expect(s).not.toContain("ghost.querySelector('.n')!.textContent");
  });

  it('结构锁：refreshAll 仍为 rAF 合并通道（写点守卫不能改成绕过合并直刷）', () => {
    const s = src('src/ui/UI.ts');
    expect(s).toContain('private _refreshAllQueued = false;');
    expect(s).toContain('requestAnimationFrame(() => {');
  });
});
