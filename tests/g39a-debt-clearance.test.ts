// ★G39-A（2026-11-01,遗留债 A 组清偿刀）判别锁。
// 覆盖：bj742a D-③（微光闪避源实体三查门）+D-⑥（PlrImport tick 量化）;
//       bj745a D-②（甲光 effective 三槽）+D-④（adtnOnHit 余 9 站）;
//       bj746a D1（日曜/克盾穿甲池）+D2（664/666/668 溅射 debuff）+D5（908 drawLayer）
//       +D6（塔弹 owner pen）;
//       g36a D-⑧（召唤杖 Titan KB 序）+D-⑨（Teleport 头段双字段）+D-⑩（4760 持盾视觉）;
//       bj738a D5（门渲染层序——r15 R15-6+G36 D5 合围,本文件零改动销案锁）。
// 标杆：Terarria1457（Player.cs:39049-39072/:53984-54007/:37701-37715/:37090-37094;
//       Projectile.cs:11325-11337/:12852/:13684-86/:46174;NPC.cs:79110-79230;
//       NPCID.cs:4883/ProjectileID.cs:433）。
// 变异恰红（withMutation 子进程隔离）在同文件 M 组。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { withMutation } from './mutation-guard';
import { BuffType } from '../src/stats/Buffs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { Enemy } from '../src/entities/Enemy';
import { Arrow } from '../src/entities/Arrow';
import { TitaniumStormShard } from '../src/entities/proj1457';
import {
  CAN_HIT_PAST_SHIMMER_PROJS, CAN_HIT_PAST_SHIMMER_NPCS,
} from '../src/entities/projTargets';
import { INVASION_GROUP } from '../src/world/Invasion';
import { exportPlr, parsePlr } from '../src/save/PlrImport';
import type { Appearance } from '../src/player/Appearance';
import type { SaveData } from '../src/save/serialize';
import type { GameHooks } from '../src/entities/types';

const GAME_SRC = readFileSync(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8');
const PLAYER_SRC = readFileSync(join(process.cwd(), 'src', 'entities', 'Player.ts'), 'utf8');
const MINION_SRC = readFileSync(join(process.cwd(), 'src', 'entities', 'MinionProj.ts'), 'utf8');
const RENDERER_SRC = readFileSync(join(process.cwd(), 'src', 'render', 'Renderer.ts'), 'utf8');
const MOUNT_SRC = readFileSync(join(process.cwd(), 'src', 'entities', 'MountCombat.ts'), 'utf8');
const PLR_SRC = readFileSync(join(process.cwd(), 'src', 'save', 'PlrImport.ts'), 'utf8');

afterEach(() => { vi.restoreAllMocks(); });

// ============ A. bj742a D-③：微光闪避源实体三查门（:39059-39072） ============

describe('G39-A ① 微光源实体三查门：双表 + 入侵负组 + 门行为', () => {
  it('A1 CanHitPastShimmer 双表（ProjectileID.cs:433 45 员 / NPCID.cs:4883 50 员,抽查代表）', () => {
    expect(CAN_HIT_PAST_SHIMMER_PROJS.size).toBe(45);
    expect(CAN_HIT_PAST_SHIMMER_NPCS.size).toBe(50);
    for (const id of [605, 270, 719, 100, 84, 83, 96, 101, 102, 949, 1041, 1125]) {
      expect(CAN_HIT_PAST_SHIMMER_PROJS.has(id), `弹表缺 ${id}`).toBe(true);
    }
    for (const id of [535, 5, 13, 14, 15, 666, 267, 36, 210, 211, 397, 396, 400]) {
      expect(CAN_HIT_PAST_SHIMMER_NPCS.has(id), `NPC 表缺 ${id}`).toBe(true);
    }
    // 表外负控
    expect(CAN_HIT_PAST_SHIMMER_PROJS.has(20)).toBe(false);
    expect(CAN_HIT_PAST_SHIMMER_NPCS.has(3)).toBe(false);
  });

  it('A2 INVASION_GROUP 负组三段（NPC.cs:79155-79228——南瓜月 -1/霜月 -2/OOA -3;550·328 原文缺位）', () => {
    expect(INVASION_GROUP[338]).toBe(-1);
    expect(INVASION_GROUP[352]).toBe(-1);
    expect(INVASION_GROUP[305]).toBe(-2);
    expect(INVASION_GROUP[330]).toBe(-2);
    expect(INVASION_GROUP[327]).toBe(-2);
    expect(INVASION_GROUP[547]).toBe(-3);
    expect(INVASION_GROUP[578]).toBe(-3);
    expect(INVASION_GROUP[551]).toBe(-3);
    // 原文缺位（case 无 550/328——勿扩表）
    expect(INVASION_GROUP[550]).toBeUndefined();
    expect(INVASION_GROUP[328]).toBeUndefined();
    // 正组不动（三消费面 `group===invasionType` 正值守卫零扰动）
    expect(INVASION_GROUP[26]).toBe(1);
    expect(INVASION_GROUP[143]).toBe(2);
    expect(INVASION_GROUP[662]).toBe(3);
    expect(INVASION_GROUP[520]).toBe(4);
  });

  it('A3 Player.damage 微光门：源禁闪避位翻转受击（通道消费端 :38484）', () => {
    const p = new Player(0, 0, new Inventory());
    p.shimmering = true;
    p.hp = 400;
    // 缺省（环境源,TryGetCausingEntity 失败）→ 闪避返 0
    expect(p.damage(50, 0, 0, false)).toBe(0);
    expect(p.hp).toBe(400);
    // 源禁闪避（boss/入侵族/表内弹）→ 照常受伤
    (p as unknown as { __swShimmerNoDodge?: boolean }).__swShimmerNoDodge = true;
    expect(p.damage(50, 0, 0, false)).toBeGreaterThan(0);
    expect(p.hp).toBeLessThan(400);
  });

  it('A4 结构锁：damagePlayer 源块三查 + hitPlayer/bit7 弹 vid 透传', () => {
    expect(GAME_SRC).toContain('CAN_HIT_PAST_SHIMMER_NPCS.has(attacker.vanillaId)');
    expect(GAME_SRC).toContain('CAN_HIT_PAST_SHIMMER_PROJS.has(opts.projVid)');
    expect(GAME_SRC).toContain('__swShimmerNoDodge');
    expect(PLAYER_SRC).toContain('const shmSrcNoDodge =');
    // hitPlayer 普通分支（projVid 单传无 projDomain=不进 mod 链）
    expect(readFileSync(join(process.cwd(), 'src', 'entities', 'projTargets.ts'), 'utf8'))
      .toContain('evpId !== undefined ? { projVid: evpId } : undefined');
    // bit7 爆炸面（SelfHurtPlayers :15130 ByProjectile）
    expect(GAME_SRC).toContain("{ projVid: projType }");
  });
});

// ============ B. bj742a D-⑥：PlrImport tick 量化（:55518-55530 往返无损） ============

describe('G39-A ② .plr buff tick 往返逐位无损（2450t 药水病随机档/70t 亚秒档）', () => {
  const mkAppearance = (): Appearance => ({
    name: 'g39a', hair: 0, skinVariant: 0,
    hairColor: { r: 1, g: 2, b: 3 }, skinColor: { r: 4, g: 5, b: 6 }, eyeColor: { r: 7, g: 8, b: 9 },
    shirtColor: { r: 10, g: 11, b: 12 }, undershirtColor: { r: 13, g: 14, b: 15 },
    pantsColor: { r: 16, g: 17, b: 18 }, shoeColor: { r: 19, g: 20, b: 21 },
    difficulty: 0, voiceVariant: 1, voicePitchOffset: 0,
  });
  const mkState = (buffs: Array<[number, number]>): SaveData['player'] => ({
    hp: 100, x: 0, y: 0,
    inventory: Array.from({ length: 58 }, () => null),
    selected: 0, baseMaxHp: 100, baseMaxMana: 20, mana: 20,
    banks: [[], [], [], []],
    armor: Array.from({ length: 20 }, () => null),
    dye: Array.from({ length: 10 }, () => null),
    miscEquips: [null, null, null, null, null],
    miscDyes: [null, null, null, null, null],
    buffs,
    anglerQuestsFinished: 0,
    builderAccStatus: [],
  });
  it.each([
    [2450, 2450 / 60],   // 药水病 2400-4200 随机档中值域（旧整秒化 2450/60→41s 漂移 +1s）
    [2453, 2453 / 60],   // 非整秒档（旧 round(2453/60)=41s → 导出 2460t=+7t 漂移）
    [70, 70 / 60],       // 亚秒档（旧 round=1s=+60t 膨胀）
  ])('tick %i → 秒 %s 逐位往返（export→parse）', (ticks, sec) => {
    const bytes = exportPlr(mkAppearance(), mkState([[21, sec]]));
    const parsed = parsePlr(bytes);
    expect(parsed.playerState.buffs).toEqual([[21, sec]]);
  });
  it('结构锁：读侧 tick 直除 + 写侧 round 语义注（BJ742-A R21-⑥ 同病双面）', () => {
    expect(PLR_SRC).toContain('Math.max(1 / 60, time / 60)');
    expect(PLR_SRC).toContain('G39-A（bj742a D-⑥）');
  });
});

// ============ C. bj745a D-②：甲光 effective 三槽 ============

describe('G39-A ③ 甲光 effective 链（:25818-20 head/body/legs=GetEffectiveArmor 族）', () => {
  it('结构锁：computeArmorLights 三槽 getEffectiveArmor（旧裸 inv.armor[0-2]）', () => {
    expect(GAME_SRC).toContain('statOfInternal(player.inv.getEffectiveArmor(0)?.id ?? -1)?.hs ?? -1');
    expect(GAME_SRC).toContain('statOfInternal(player.inv.getEffectiveArmor(1)?.id ?? -1)?.bs ?? -1');
    expect(GAME_SRC).toContain('statOfInternal(player.inv.getEffectiveArmor(2)?.id ?? -1)?.ls ?? -1');
    expect(GAME_SRC).not.toContain('statOfInternal(player.inv.armor[0]?.id ?? -1)?.hs ?? -1');
  });
});

// ============ D. bj745a D-④：adtnOnHit 余 9 站（OnHit 族 hp>5 门豁免） ============

describe('G39-A ④ adtnOnHit 九站（ApplyDamageToNPC :20599-20600 无 hp 门）', () => {
  it('D1 行为：hp=3 残血敌 + adtnOnHit=true → OnHit 钛金屏障照 proc（旧 hp>5 门拦死）', () => {
    const mk = (adtn: boolean): number => {
      const e = new Enemy('zombie', 100 * 16, 96 * 16);
      e.hp = 3;                                   // 残血（<5,hp>5 门拦）
      const applySpy = vi.fn();
      const w = new World(64, 64, 7, 'g39a-adtn');
      w.groundLevel = 40;
      const game = {
        world: w,
        player: {
          x: -9999, y: -9999, w: 0, h: 0, dead: false, cx: -9999, cy: -9999,
          titaniumStormCd: 0, luck: 0,
          buffs: { apply: applySpy, has: () => false },
          equipStats: { titaniumStorm: true },
          addDPS: () => {},
        },
        enemies: () => [], critters: () => [], npcs: () => [],
        spawnTitaniumShard: vi.fn(),
        spawnDust: () => {}, spawnParticles: () => {}, spawnBurst: () => {},
        spawnDrop: () => null,
        playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
        cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      } as unknown as GameHooks;
      e.hurt(10, 0, 0, game, 0, false, 0, true, 0, 0, 1, adtn);
      return applySpy.mock.calls.length;
    };
    expect(mk(true)).toBe(1);    // ★adtnOnHit 豁免：残血仍 proc（AddBuff(306,10)）
    expect(mk(false)).toBe(0);   // 旧形（近战/弹幕调用位 hp>5 门）残血不 proc
  });

  it('D2 结构锁：七站注入（狱火 2348/矿车 2343/踩踏三支 2430·5465·4264/克盾 3097/日曜直击 608/DeadCells 5465/dash6 5665）', () => {
    expect(GAME_SRC).toContain('en.hurt(dmg, 0, 0, this, playerAP, false, 0, true, 0, 0, 1, true);');
    expect(MOUNT_SRC).toContain('playerArmorPenOf(game), crit, 0, true, 0, 0, 1, true');
    expect(MOUNT_SRC).toContain('false, 0, true, 0, 0, 1, true);   // crit:false 字面（见文件头注）');
    expect(PLAYER_SRC).toContain('en.hurt(dmg, dir * kb, -4, game, playerArmorPenOf(game), crit, 0, true, 0, 0, 1, true);');
    expect(PLAYER_SRC).toContain('en.hurt(dmg3, dir3 * kb3, -4, game, playerArmorPenOf(game), crit3, 0, true, 0, 0, 1, true);');
    expect(PLAYER_SRC).toContain('crit, 0, true, 0, 0, 1, true);          // :29036 ApplyDamageToNPC');
  });
});

// ============ E. bj746a D1/D2/D5/D6 ============

describe('G39-A ⑤ 日曜/克盾穿甲池 + 664 溅射 debuff + 908 drawLayer + 塔弹 owner pen', () => {
  it('E1 D1 结构锁：608 爆闪环（Player.ts 冲撞侧）+ 反击块（Game.ts）穿甲池', () => {
    expect(PLAYER_SRC).toContain('playerArmorPenOf(game), critF, -1, true);   // pierce=-1=608 写 10t 档');
    expect(GAME_SRC).toContain('(p.equipStats.armorPen ?? 0), false, -1, true');
    expect(GAME_SRC).toContain('0, 608, 1);');
  });

  it('E2 D2 行为：664 Kill 溅射 StatusNPC（Next(3)==0 → On Fire 24,3-5s——★BJ746 台账「Blackout」系 NPC 侧 buff24 误标,表真值=onFireT）', () => {
    const a = new Arrow(100 * 16, 96 * 16, 1, 0, 20, 2, 664, { grav: 0 });
    const hurtCalls: Array<{ dmg: number; blackout: number }> = [];
    const enemyStub = {
      x: 100 * 16, y: 96 * 16, w: 16, h: 16, dead: false, id: 7,
      iframes: 0,
      onFireT: 0,
      hurt: (d: number) => { hurtCalls.push({ dmg: d, blackout: enemyStub.onFireT }); return true; },
    };
    const game = {
      player: { luck: 0, equipStats: {}, setApprenticeT3: false },
      enemies: () => [enemyStub],
      critters: () => [],
      spawnDust: () => null, spawnParticles: () => {},
      playSfxFile: () => {},
    } as unknown as GameHooks;
    Math.random = () => 0;    // Next(3)==0 门开（掷下沿）
    (a as unknown as { killNow(g: GameHooks): void }).killNow(game);
    Math.random = Math.random;   // no-op（afterEach restoreAllMocks 兜不了原生重指,还原链在测试尾）
    expect(hurtCalls.length).toBe(1);           // 溅射环结算 1 靶
    expect(enemyStub.onFireT).toBeGreaterThanOrEqual(3);   // durMin 180t=3s
    expect(enemyStub.onFireT).toBeLessThanOrEqual(5);      // durMax 300t=5s
  });

  it('E3 D5 单元：TitaniumStormShard.projOverPlayers 随环绕相位翻转（:46174 sin≤0→3/else 4）', () => {
    const mk = (misc: number): boolean => {
      const s = new TitaniumStormShard(0, 0, 10, 5);
      const game = {
        player: {
          x: 0, y: 0, cx: 0, cy: 0, oldX: 0, oldY: 0, dead: false,
          buffs: { has: () => true },
          miscCounterNormalized: misc,
        },
        projectiles: () => [s],
        enemies: () => [], critters: () => [],
      } as unknown as GameHooks;
      s.fixedUpdate(1 / 60, game);
      return s.projOverPlayers;
    };
    // 相位 f=(index/total+misc×6)×2π（index=0/total=1）——misc=0:sin(0)=0 → ≤0 →
    // false(3 BehindProjectiles);misc=1/24:sin(π/2)=1 → >0 → true(4 OverPlayers)
    expect(mk(0)).toBe(false);
    expect(mk(1 / 24)).toBe(true);
  });

  it('E4 D5/D6 结构锁：Renderer 第三分派源 + 塔弹 owner pen 注入（11 处）', () => {
    expect(RENDERER_SRC).toContain('(e as { projOverPlayers?: boolean }).projOverPlayers === true');
    // D6:MinionProj spawn 注入（389 laser/shooter.shot×2/tier.shot/680/s53/1026/继承/fox flame/1120——
    // 调用形 10 处,helper 定义另计）
    expect(MINION_SRC.match(/ownerArmorPenOf\(game\)/g)?.length).toBe(10);
  });
});

// ============ F. g36a D-⑧/⑨/⑩ ============

type KbOpts = { titan?: boolean; minionKB?: number; minionKbBonus?: number };
const gwkb = (kb: number, summon: boolean, o: KbOpts = {}): number => {
  const fake = {
    player: {
      equipStats: { kbGlove: false, minionKB: o.minionKB ?? 0, shroomiteSet: false, vortexSet: false },
      buffs: {
        has: (t: BuffType) => t === BuffType.Titan && !!o.titan,
        minionKbBonus: o.minionKbBonus ?? 0,
      },
      stealth: 1, vortexStealthActive: false,
    },
  };
  return (Game.prototype as unknown as {
    getWeaponKnockback(k: number, kd: 'melee' | 'ranged' | 'magic', s: boolean): number;
  }).getWeaponKnockback.call(fake, kb, 'ranged', summon);
};

describe('G39-A ⑥ 召唤杖 Titan KB 序 + Teleport 头段双字段 + 4760 持盾视觉', () => {
  it('F1 D-⑧ 单元：summon 分支全池（装备 minionKB+buff minionKbBonus）→ (kb+mkb)×Titan', () => {
    expect(gwkb(4, true)).toBe(4);                              // 裸直通（无池）
    expect(gwkb(4, true, { minionKB: 2 })).toBe(6);             // +装备面
    expect(gwkb(4, true, { minionKB: 2, minionKbBonus: 1 })).toBe(7);   // ★buff 面进池（饱腹 +0.5/+0.75/+1 族）
    expect(gwkb(4, true, { minionKB: 2, minionKbBonus: 1, titan: true })).toBe(10.5);  // (4+2+1)×1.5——序=加后乘
    expect(gwkb(4, false)).toBe(4);                             // 非 summon 不吃池
  });

  it('F2 D-⑧ 结构锁：MinionProj 命中拍 mkb 承载拆除（出生烘焙互斥——防双计回潮）', () => {
    expect(MINION_SRC).not.toContain('+ mkb)');
    expect(MINION_SRC).not.toContain('minionKbBonus ?? 0');
    expect(GAME_SRC).toContain("cwIn.kind === 'whip' || cwIn.kind === 'summon'),");
  });

  it('F3 D-⑨ 单元：teleportHeadReset 双字段 + fixedUpdate 递减（:37702-37703/:16868-70）', () => {
    const p = new Player(0, 0, new Inventory());
    expect(p.funkTownCd).toBe(0);
    expect(p.environmentBuffImmunityTimer).toBe(0);
    p.teleportHeadReset();
    expect(p.funkTownCd).toBe(100);
    expect(p.environmentBuffImmunityTimer).toBe(4);
    const w = new World(64, 64, 7, 'g39a-tp');
    w.groundLevel = 40;
    const game = { world: w, player: p, enemies: () => [], critters: () => [] } as unknown as GameHooks;
    p.fixedUpdate(1 / 60, game);
    expect(p.funkTownCd).toBe(99);
    expect(p.environmentBuffImmunityTimer).toBe(3);
    // 结构锁：成就门（Game 群系到达块 :16880/:16884 冷却门）+ 九传送面接线
    expect(GAME_SRC).toContain('player.funkTownCd === 0) {   // ★G39-A（g36a D-⑨）');
    expect(GAME_SRC.match(/teleportHeadReset\?\.\(\)/g)?.length).toBe(5);   // Game×5
    expect(PLAYER_SRC.match(/this\.teleportHeadReset\(\)/g)?.length).toBe(3);   // HoD/女王钩/微光脱困
    expect(readFileSync(join(process.cwd(), 'src', 'entities', 'Portal.ts'), 'utf8'))
      .toContain('p.teleportHeadReset?.();');   // Portal×1 —— 合计九面
  });

  it('F4 D-⑩ 结构锁：4760 持盾视觉（:37090-37094 shield=9/cShield=0——Renderer 局部覆写非缓存污染）', () => {
    expect(RENDERER_SRC).toContain('const shieldSlot4760 = shield4760Active ? 9 : ad.shield;');
    expect(RENDERER_SRC).toContain('const dyeShield4760 = shield4760Active ? 0 : ad.dyeShield;');
    expect(RENDERER_SRC).not.toContain('ad.shield = 9');      // 勿写缓存对象
    expect(PLAYER_SRC).toContain('heldShield866InFlight = false;');
    expect(PLAYER_SRC).not.toContain('private heldShield866InFlight');
  });
});

// ============ G. bj738a D5：门渲染层序（r15 R15-6 + G36 D5 合围——零改动销案锁） ============

describe('G39-A ⑦ bj738a D5 销案锁（坐/睡 vs 站双档,两刀合围在位）', () => {
  it('结构锁：双档门+双档本体（RefreshPlayerDrawOrder :22465-22498 二分 1:1）', () => {
    // 坐/睡门（2c'.2=BehindNPCs 组,tile 上/NPC 下）
    expect(RENDERER_SRC).toContain('if (player.sitting || player.sleeping) {\n      this.drawPotionOfReturnGates(player, cam, viewW, viewH, z);');
    // 坐/睡本体（实体窗头,r15 R15-6——NPC 层之前）
    expect(RENDERER_SRC).toContain('if ((player.sitting || player.sleeping) && !player.dead) this.drawPlayer(player, world, swing, flicker);');
    // 站立门+本体（AfterProjectiles 组,drawPlayer 前位）
    expect(RENDERER_SRC).toContain('if (!(player.sitting || player.sleeping)) {\n      this.drawPotionOfReturnGates(player, cam, viewW, viewH, z);');
    // 远端双档+opacity 0.1
    expect(RENDERER_SRC).toContain('if (rp.sitting || rp.sleeping) this.drawPotionOfReturnGates(rp, cam, viewW, viewH, z, 0.1);');
    expect(RENDERER_SRC).toContain('if (!(rp.sitting || rp.sleeping)) this.drawPotionOfReturnGates(rp, cam, viewW, viewH, z, 0.1);');
  });
});

// ============ M. 变异恰红（withMutation 子进程隔离） ============

describe.skipIf(process.env.SW_G39A_MUT)('G39-A 变异恰红（四发+逐字节还原）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/g39a-debt-clearance.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_G39A_MUT: '1' },
    });

  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `G39A ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    const post = createHash('sha256').update(readFileSync(file)).digest('hex');
    expect(post, `还原对拍 ${file}`).toBe(pristineSha);
  };

  const PT = join(process.cwd(), 'src', 'entities', 'Player.ts');
  const IV = join(process.cwd(), 'src', 'world', 'Invasion.ts');
  const GT = join(process.cwd(), 'src', 'core', 'Game.ts');

  it('M1 微光源三查门摘除 → A3 红（boss/入侵族源被微光吞回潮）', () => {
    mutate(PT,
      'if (this.shimmering && dodgeable && shmEffCc !== ImmunityCooldownID.BossNoCheese && !shmSrcNoDodge) return 0;',
      'if (this.shimmering && dodgeable && shmEffCc !== ImmunityCooldownID.BossNoCheese) return 0;   // G39A-M1',
      'A3 Player.damage 微光门');
  });

  it('M2 INVASION_GROUP 负组摘除 → A2 红（南瓜月/霜月/OOA 组号丢失）', () => {
    mutate(IV,
      "  for (let id = 338; id <= 352; id++) g[id] = -1;              // ★G39-A：南瓜月",
      "  // G39A-M2 摘除",
      'A2 INVASION_GROUP 负组三段');
  });

  it('M3 wrapper summon 扩参摘除 → F2 红（召唤杖 KB 序回旧形——结构锁捕获）', () => {
    mutate(GT,
      "cwIn.kind === 'whip' || cwIn.kind === 'summon'),",
      "cwIn.kind === 'whip'),   // G39A-M3",
      'F2 D-⑧ 结构锁');
  });

  it('M4 狱火 adtnOnHit 摘除 → D2 红（:10326 ApplyDamageToNPC 站豁免位丢失——结构锁捕获;D1 行为锁锁 Enemy.hurt 参本体,不经调用点）', () => {
    mutate(GT,
      'en.hurt(dmg, 0, 0, this, playerAP, false, 0, true, 0, 0, 1, true);',
      'en.hurt(dmg, 0, 0, this, playerAP, false, 0, true);   // G39A-M4',
      'D2 结构锁');
  });
});
