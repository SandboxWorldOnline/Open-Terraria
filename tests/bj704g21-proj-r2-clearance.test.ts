// ★BJ704-G21（2026-10-21）弹幕域二轮审查清偿——R8 P2×5 + R8-N1 + R7 P2×2 八件
//  判别锁（锚=memory/bj704r7-minionproj-redblue2.md + bj704r8-arrow-redblue2.md
//  findings,G21 逐件定谳后清偿）。逐件判语：
//  1. R8-F1 炮冷却递减误挂 swing 门 → 迁 updateUse 头（原版 Player.cs:43922-25
//     在 ItemCheck_OwnerOnlyCode【方法体级】——if(itemAnimation>0) 块 :43817 早
//     在 :43851 闭括,括号平衡亲证;先减后查（PlaceThing :43948 在后）=fire-to-fire
//     恰 20 拍;闲时冻结病灶消除）。
//  2. R8-F2 TrapShot 爆面（162/281/1049/烟花）缺扩盒 CutTiles → blastDamage 内建
//     （Damage() :12515-18;位=damage 头门前——0 伤烟花盒 415-418 原版 192²
//     Damage() 照割,aiStyle34 Kill 尾 :78549-78556 括号扫描亲证）。
//  3. R8-F3 502 Kill 消散尘整缺 → killNow 502 支（:75080-75094 oldPos 逐点尘66
//     随机 hsl/α150/s0.7/noGravity——一切死亡路径共段）。
//  4. R8-F4 onProjectileDeath(178) Kill FX 三缺 → 第三重扰动 +=Next(−50,51)×0.05
//     +scale 抖+40×gore 276-282 整环（:76062-76092）;连带 284 gore scale 抖 ±20
//     （:77599-77600）+gore 左上锚（NewGore position=弹盒左上 :77602）。
//  5. R8-F5 blastDamage 缺 dontTakeDamage 门（:12604——充能水母吃炮弹/兔爆伤）
//     +Arrow aoeCd281 duck 桥 peek 纯读化（S2 拆相——idStaticReady/idStaticWrite
//     拆分,proj1457.HitCdImpl R1-C 同构）。
//  6. R8-N1 火把炮首发晚 1 拍 → cannon 块 useSwing 前置（原版启动块
//     ApplyItemAnimation :43074-43116 先于 PlaceThing,首拍三门全过;旧注「启动拍
//     PlaceThing 不跑」系伪锚）。
//  7. R7-P2-2 虎特攻尝试缺 damage != 0 门（:50194——0 伤不尝试且不置 10t 冷却）。
//  8. R7-P2-3 PhoenixBolt 706 本体 A 面 → vanillaProjAlpha[706] afade 档消费
//     （:80830-33 A=180−⌊α/2⌋−⌊α/4⌋,稳态 70.6%;G2 修 ghost 漏本体;charm 分流
//     对 706 不可达——HarpyCharmEffect 只选 arrow 弹,706 非 arrow）。
// （R7-P2-1 虎帧过渡拍=a026VyCollide 折相连带存量,维持登记不动——非本批面。）
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Game } from '../src/core/Game';
import { TrapShot } from '../src/entities/Dart';
import { Arrow, idStaticCheck, idStaticReady, idStaticWrite } from '../src/entities/Arrow';
import { MinionProj } from '../src/entities/MinionProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Wiring } from '../src/world/Wiring';
import { TILE_BY_KEY } from '../src/data/tiles';
import { PROJ_ALPHA_MOD } from '../src/data/vanillaProjAlpha';
import { resetGorePool, liveGorePieces } from '../src/entities/GorePiece';
import { pinGameTimeTicks, gameTickCount } from '../src/core/GameTime';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const gameSrc = () => read('src/core/Game.ts');
const dartSrc = () => read('src/entities/Dart.ts');
const arrowSrc = () => read('src/entities/Arrow.ts');
const minionSrc = () => read('src/entities/MinionProj.ts');
const phoenixSrc = () => read('src/entities/PhoenixBowProj.ts');

const VAN = join(ROOT, '..', 'Terarria1457');
const EXT_MISSING = !existsSync(join(VAN, 'Terraria', 'Projectile.cs'));
const van = EXT_MISSING ? '' : readFileSync(join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');
const vanPlayer = EXT_MISSING ? '' : readFileSync(join(VAN, 'Terraria', 'Player.cs'), 'utf8');

const TILE = 16;
const CANNON_T = TILE_BY_KEY['v_209_cannon']!;

/** ★共享桶是模块级单表（ID_STATIC_TABLES）——逐测单调推钟隔离（g14 同式） */
let g21Clock = 5000;
beforeEach(() => {
  g21Clock += 1000;
  pinGameTimeTicks(g21Clock);
  resetGorePool();
});

// ================================================================ §0 原版锚
describe.skipIf(EXT_MISSING)('§0 原版锚（读错/漂移即红——八件定谳链）', () => {
  it('R8-F1：cannonCooldown 递减=OwnerOnlyCode 方法体级（2 tab 缩进）且先于 PlaceThing', () => {
    const iFn = vanPlayer.indexOf('private void ItemCheck_OwnerOnlyCode(');
    const body = vanPlayer.slice(iFn, iFn + 4000);
    expect(body).toMatch(/\n\t\tif \(cannonCooldown > 0\)\n\t\t\{\n\t\t\tcannonCooldown--;\n\t\t\}/);   // 2 tab=方法体级（if(itemAnimation>0) 块内=3 tab）
    expect(body.indexOf('if (cannonCooldown > 0)')).toBeLessThan(body.indexOf('PlaceThing(doPlacementAction'));   // 先减后查
    expect(body.indexOf('if (itemAnimation > 0)')).toBeLessThan(body.indexOf('if (type == 6152'));   // :43817 块界内最后语句（块在 :43851 闭）
    expect(body.indexOf('if (type == 6152')).toBeLessThan(body.indexOf('if (cannonCooldown > 0)'));  // 递减在其后=块外
  });
  it('R8-F2：162 两段盒/281 128 盒/烟花 192 盒 Kill→Damage()（CutTiles 吃已扩盒）', () => {
    const iKill = van.indexOf('public void Kill()');   // Kill 分支域（SetDefaults 同型 else-if 防撞）
    const i281 = van.indexOf('else if (type == 281)', iKill);
    expect(van.slice(i281, i281 + 3000)).toContain('width = 128;');
    const i162 = van.indexOf('else if (type == 162)', iKill);
    const b162 = van.slice(i162, i162 + 2600);
    expect(b162).toContain('width = 64;');
    expect(b162.match(/Damage\(\);/g)).toHaveLength(2);                    // 两段（首段 4tab/次段 5tab 深位）
    const i34 = van.indexOf('else if (aiStyle == 34)', iKill);
    const b34 = van.slice(i34, i34 + 20000);   // 34 块跨 :78125-78557（~430 行,尾段 192 盒 Damage）
    expect(b34).toContain('width = 192;');
    expect(b34).toContain('penetrate = -1;');
    expect(b34.indexOf('width = 192;')).toBeLessThan(b34.indexOf('Damage();', b34.indexOf('width = 192;')));   // :78549-56 尾段 Damage（含 CutTiles）紧随扩盒
  });
  it('R8-F3：Kill 502 oldPos 逐点尘 66（随机 hsl/α150/s0.7/noGravity）', () => {
    const iKill = van.indexOf('public void Kill()');
    expect(van).toContain('for (int num437 = 0; num437 < oldPos.Length; num437++)');
    const i502 = van.indexOf('if (type == 502)', iKill);
    const b = van.slice(i502, van.indexOf('if (type == 510)', i502));
    expect(b).toContain('Dust.NewDust(oldPos[num437] + vector50, 0, 0, 66, 0f, 0f, 150, Color.Transparent, 0.7f)');
    expect(b).toContain('Main.hslToRgb(Main.rand.NextFloat(), 1f, 0.5f)');
    expect(b).toContain('Main.dust[num438].noGravity = true');
  });
  it('R8-F4：178 三重扰动+scale 抖+40 gore（gore scale 抖 ±20 先于第三重）', () => {
    const iKill = van.indexOf('public void Kill()');
    const i178 = van.indexOf('else if (type == 178)', iKill);
    const b = van.slice(i178, i178 + 1800);
    expect(b).toContain('num571].velocity.X += (float)Main.rand.Next(-50, 51) * 0.05f;');
    expect(b).toContain('dust2.scale *= 1f + (float)Main.rand.Next(-30, 31) * 0.01f;');
    expect(b).toContain('num572 < 40');
    expect(b).toContain('gore2.scale *= 1f + (float)Main.rand.Next(-20, 21) * 0.01f;');
    const iGore = b.indexOf('Gore.NewGore');
    expect(b.indexOf('gore2.scale *= 1f', iGore)).toBeLessThan(b.indexOf('* 0.05f;', iGore));   // gore 侧 scale 在 +=0.05 前（掷序）
    const iKill2 = van.indexOf('public void Kill()');
    const i284 = van.indexOf('for (int num782 = 0; num782 < 10; num782++)', iKill2);
    const b284 = van.slice(i284, i284 + 1600);
    expect(b284).toContain('gore2.scale *= 1f + (float)Main.rand.Next(-20, 21) * 0.01f;');   // 284 同面
    expect(b284).toContain('Gore.NewGore(position, -velocity * 0.3f, num786)');              // 左上锚
  });
  it('R8-F5：Damage_PVE 外环 dontTakeDamage 门（zap 例外）', () => {
    expect(van).toContain('if (flag2 && (!nPC.dontTakeDamage || NPCID.Sets.ZappingJellyfish[nPC.type]) && (nPC.aiStyle != 112 || !(nPC.ai[2] > 1f)))');
  });
  it('R8-N1：ShootFromCannon 三门 + 启动块 StartActualUse 先于 OwnerOnlyCode', () => {
    expect(vanPlayer).toContain('if (ItemTimeIsZero && itemAnimation > 0 && controlUseItem)');
    const iCheck = vanPlayer.indexOf('public void ItemCheck()');
    const body = vanPlayer.slice(iCheck, iCheck + 8000);
    expect(body.indexOf('ItemCheck_StartActualUse(item);')).toBeGreaterThan(-1);
    expect(body.indexOf('ItemCheck_StartActualUse(item);')).toBeLessThan(body.indexOf('ItemCheck_OwnerOnlyCode(ref context'));   // 启动块先行=首拍 itemAnimation 已在途
  });
  it('R7-P2-2：虎特攻 damage != 0 门（0 伤不尝试不置冷却）', () => {
    const iFn = van.indexOf('private void AI_067_FreakingPirates()');
    const body = van.slice(iFn, iFn + 60000);
    expect(body).toContain('if (damage != 0)');
    expect(body.indexOf('if (damage != 0)')).toBeLessThan(body.indexOf('AI_067_TigerSpecialAttack();'));
  });
  it('R7-P2-3：GetAlpha 673||706 支（A=180−α/2−α/4）', () => {
    expect(van).toContain('if (type == 673 || type == 706)');
    expect(van).toContain('return new Color(255 - alpha, 255 - alpha, 255 - alpha, 180 - alpha / 2 - alpha / 4);');
  });
});

// ================================================================ §1 源结构锁
describe('§1 源结构锁（判据表达式与位序,防静默回退）', () => {
  it('R8-F1：递减在 updateUse 头（早退链前）且先于炮检查;updateSwingHits 内无递减', () => {
    const s = gameSrc();
    const iUse = s.indexOf('private updateUse(');
    const iSwingFn = s.indexOf('private updateSwingHits()');
    const iNext = s.indexOf('private ', iUse + 20);
    const useBody = s.slice(iUse, iNext);
    const iDec = useBody.indexOf('if (this.cannonTorchCooldown > 0) this.cannonTorchCooldown--;');
    expect(iDec).toBeGreaterThan(-1);
    expect(iDec).toBeLessThan(useBody.indexOf('if (this.housingMode)'));          // 一切早退前（ItemCheck 逐 tick 语义）
    expect(iDec).toBeLessThan(useBody.indexOf('this.tryTorchFireCannon(tx, ty, heldDef.vid ?? -1);'));   // 先减后查
    const swingBody = s.slice(iSwingFn, s.indexOf('private ', iSwingFn + 20));
    expect(swingBody).not.toContain('cannonTorchCooldown');                       // 旧位（swing 门后=闲时冻结）已迁出
  });
  it('R8-N1：cannon 块 useSwing 前置（启动拍 ApplyItemAnimation 先于 PlaceThing）', () => {
    const s = gameSrc();
    const iBlock = s.indexOf('TORCH_ITEMS.has(heldDef.vid ?? -1)');
    const block = s.slice(iBlock, iBlock + 700);
    const iSw = block.indexOf('this.useSwing(heldDef, undefined, this.paintTileSpeed());');
    const iFire = block.indexOf('this.tryTorchFireCannon(tx, ty, heldDef.vid ?? -1);');
    expect(iSw).toBeGreaterThan(-1);
    expect(iSw).toBeLessThan(iFire);
  });
  it('R8-F2+F5：blastDamage 内 cutTilesBox（damage 头门前）+ dontTakeDamage 门（idStatic 写位前）', () => {
    const s = dartSrc();
    const iFn = s.indexOf('private blastDamage(');
    const body = s.slice(iFn, s.indexOf('private ', iFn + 20));
    const iCut = body.indexOf('if (!this.hostile) cutTilesBox(game, box.x, box.y, box.w, box.h);');
    const iZero = body.indexOf('if (this.damage <= 0) return;');
    const iDont = body.indexOf("dontTakeDamage === true) continue;");
    const iIdStatic = body.indexOf('idStaticCheck(idStaticKey,');   // ★G22：blast 位参数化（281/烟花 167-170 共表）
    expect(iCut).toBeGreaterThan(-1);
    expect(iZero).toBeGreaterThan(iCut);            // 割草先于 0 伤整退（:12516→:12576 序）
    expect(iDont).toBeGreaterThan(-1);
    expect(iDont).toBeLessThan(iIdStatic);          // 拒收不落桶账（写梯 :14031 深位）
  });
  it('R8-F3：killNow 502 支（empressHslRgb 随机彩 + 尘 66/α150/s0.7/noGravity + 零位跳过）', () => {
    const s = arrowSrc();
    const iKill = s.indexOf('private killNow(');
    const body = s.slice(iKill, s.indexOf('private ', iKill + 20));
    expect(body).toContain('if (this.projId === 502) {');
    expect(body).toContain('const rgb = empressHslRgb(Math.random());');
    expect(body).toContain('0, 0, 66,\n          0, 0, 150, null, 0.7, true');
    expect(body).toContain('if (px === 0 && py === 0) continue;');
  });
  it('R8-F4：178 三重扰动+scale 抖+40 gore;284 gore scale 抖+左上锚', () => {
    const s = gameSrc();
    const i178 = s.indexOf('if (projId === 178) {');
    const b178 = s.slice(i178, s.indexOf('if (projId === 284) {'));
    expect(b178.match(/d\.vx \+= nrand\(50\) \* 0\.05;/g)).toHaveLength(1);
    expect(b178).toContain('d.scale *= 1 + nrand(30) * 0.01;');
    expect(b178).toContain('for (let i = 0; i < 40; i++)');
    expect(b178).toContain('g.scale *= 1 + nrand(20) * 0.01;');
    const i284 = s.indexOf('if (projId === 284) {');
    const b284 = s.slice(i284, s.indexOf('if (projId === 286) {'));
    expect(b284).toContain('g.scale *= 1 + nrand(20) * 0.01;');
    expect(b284).toContain('x, y, -oldVx * 0.3, -oldVy * 0.3);');   // gore 左上锚（旧中心位）
  });
  it('R8-F5b：idStaticReady/idStaticWrite 拆分 + aoeCd281 桥 peek 纯读/commit 写', () => {
    const s = arrowSrc();
    expect(s).toContain('export function idStaticReady(projId: number, enemyId: number): boolean {');
    expect(s).toContain('export function idStaticWrite(projId: number, enemyId: number, cooldownTicks: number): void {');
    expect(s).toContain('peek: (id: number) => idStaticReady(281, id),');
    expect(s).toContain('commit: (id: number, cdv: number) => { idStaticWrite(281, id, cdv || 10); },');
    expect(s).not.toContain('peek: (id: number) => idStaticCheck(281, id, 10),');   // 旧读时写形退役
    // Dart 直击位保持融合形（过门即结算=写前置≡写后置）;爆位=G22 idStaticKey 参数
    //（281/烟花 167-170 共表,cd 单源 projectileData——bj704g22 A 组锁）
    expect(dartSrc().match(/idStaticCheck\(281, /g)).toHaveLength(1);
  });
  it('R7-P2-2：tigerBody dmg0!==0 门', () => {
    const s = minionSrc();
    expect(s).toContain('else if (dmg0 !== 0) {');
    const iGate = s.indexOf('else if (dmg0 !== 0) {');
    expect(s.slice(iGate, iGate + 400)).toContain('this.tigerSpecialAttack(game, p, dmg0)');
  });
  it('R7-P2-3：PhoenixBowProj 消费 afade 档（PROJ_ALPHA_MOD[706]）', () => {
    const s = phoenixSrc();
    expect(s).toContain("import { PROJ_ALPHA_MOD } from '../data/vanillaProjAlpha';");
    expect(s).toContain('const mod706 = PROJ_ALPHA_MOD[706]!;');
    expect(s).toContain('const gaBody = Math.max(0, ((mod706.rgba?.[3] ?? 255) - this.alphaI * (mod706.slope ?? 1)) / 255) * op;');
    expect(s).toContain('ctx.globalAlpha = gaBody;');
    const m = PROJ_ALPHA_MOD[706]!;
    expect(m.kind).toBe('afade');
    expect(m.rgba).toEqual([255, 255, 255, 180]);
    expect(m.slope).toBe(0.75);
    expect(m.inv).toBe(1);
  });
});

// ================================================================ §2 行为面
/** 世界 + 全录制 hooks（g14 idStaticWorld 同式 + cutTile/全尘字段记录） */
function g21World(enemyList: unknown[] = []) {
  const w = new World(80, 60, 42, 'open');
  w.groundLevel = 42;
  const hurts: Array<{ id: number; dmg: number }> = [];
  const cutTiles: Array<[number, number]> = [];
  const dusts: Array<{ type: number; x: number; y: number; vx: number; vy: number; alpha: number; scale: number; noGravity: boolean; color?: { r: number; g: number; b: number; a: number } }> = [];
  const hooks = {
    world: w,
    player: { x: -500, y: -500, w: 20, h: 42, dead: true, cx: -490, cy: -479, luck: 0,
      buffs: new Set(), inv: {} },
    enemies: () => enemyList,
    critters: () => [], npcs: () => [],
    playSfx: () => {}, playSfxFiles: () => {},
    spawnDust: (x: number, y: number, _bw: number, _bh: number, type: number,
      vx: number, vy: number, alpha: number, _c: unknown, scale = 1, noGravity = false) => {
      const d = { type, x, y, vx, vy, alpha, scale, noGravity, color: undefined as undefined | { r: number; g: number; b: number; a: number } };
      dusts.push(d);
      return d;
    },
    cutTile: (x: number, y: number) => { cutTiles.push([x, y]); },
    spawnParticles: () => {}, addDamageNumber: () => {}, onEnemyKilled: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0, spawnEnemy: () => {},
    notifyInventoryChanged: () => {}, showPickupLabel: () => {},
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as never;
  return { w, hooks, hurts, cutTiles, dusts };
}

describe('§2 R8-F1/N1 行为：20t 冷却窗 + fire-to-fire 拍数（先减后查）', () => {
  /** Game 原型桩（g14 stubGame 同式） */
  function stubCannon() {
    const w = new World(60, 60, 7, 'open');
    const spawned: TrapShot[] = [];
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    g.world = w;
    g.wiring = new Wiring(w.store);
    g.player = { useTime: 0 };
    g.cannonTorchCooldown = 0;
    g.entities = { add: (e: TrapShot) => { spawned.push(e); }, projectiles: [], critters: [] };
    for (let cx = 0; cx < 4; cx++) {
      for (let cy = 0; cy < 3; cy++) {
        w.store.setTileSilent(10 + cx, 20 + cy, CANNON_T, cx * 18, cy * 18);
      }
    }
    const fire = (swingT: number) => {
      g.swing = { t: swingT };
      return (Game.prototype as unknown as { tryTorchFireCannon: (tx: number, ty: number, vid: number) => boolean })
        .tryTorchFireCannon.call(g, 11, 21, 8);
    };
    return { g, spawned, fire };
  }
  it('fire-to-fire 恰 20 拍（先减后查:19 次递减拒/第 20 次放行）', () => {
    const { g, spawned, fire } = stubCannon();
    expect(fire(5)).toBe(true);
    expect((g as unknown as { cannonTorchCooldown: number }).cannonTorchCooldown).toBe(20);
    for (let i = 0; i < 19; i++) {                     // 19 拍逐 tick 递减（updateUse 头位）
      if ((g as unknown as { cannonTorchCooldown: number }).cannonTorchCooldown > 0) {
        (g as unknown as { cannonTorchCooldown: number }).cannonTorchCooldown--;
      }
      expect(fire(5)).toBe(false);                     // T+1..T+19 全拒
    }
    (g as unknown as { cannonTorchCooldown: number }).cannonTorchCooldown--;   // 第 20 拍递减 → 0
    expect(fire(5)).toBe(true);                        // T+20 可发（vanilla 同拍序）
    expect(spawned).toHaveLength(2);
  });
  it('闲时（无 swing/无放置动作）冷却照走——旧 swing 门冻结病灶已除（结构位锁的行为投影）', () => {
    // 递减位已锁 updateUse 头（§1）;此处锁窗口语义不依赖 swing:
    const { g, spawned, fire } = stubCannon();
    expect(fire(5)).toBe(true);
    for (let i = 0; i < 20; i++) {                     // 模拟 20 拍 updateUse 递减（无 swing 语境同走）
      if ((g as unknown as { cannonTorchCooldown: number }).cannonTorchCooldown > 0) {
        (g as unknown as { cannonTorchCooldown: number }).cannonTorchCooldown--;
      }
    }
    expect(fire(1)).toBe(true);
    expect(spawned).toHaveLength(2);
  });
});

describe('§3 R8-F2 行为：爆面扩盒 CutTiles（先于 damage 门）', () => {
  it('281 寿命爆：128 盒割 9×9=81 格', () => {
    const { hooks, cutTiles } = g21World();
    const b = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 350, 'bunny');
    (b as unknown as { life: number }).life = 1;
    b.fixedUpdate(1, hooks);
    expect(b.dead).toBe(true);
    expect(cutTiles.length).toBe(81);                  // 心 (654,654) 盒 590..718 → 36..44 列/行
    expect(cutTiles).toContainEqual([36, 36]);
    expect(cutTiles).toContainEqual([44, 44]);
  });
  it('162 撞块爆：64 盒 25 格 + 144 盒 100 格（两段各割）', () => {
    const { hooks, cutTiles } = g21World();
    const p = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 300, 'cannonball');
    (p as unknown as { life: number }).life = 1;
    p.fixedUpdate(1, hooks);
    expect(p.dead).toBe(true);
    expect(cutTiles.length).toBe(125);                 // 25（64 盒）+100（144 盒）
  });
  it('烟花 damage>0 爆（192 盒 13×13=169 格）;damage=0 盒同割（★G22 g21-fw-box-cut 清偿:原版照割）', () => {
    const a = g21World();
    const fw = new TrapShot(40 * TILE, 40 * TILE, 0, -5, 150, 'fireworkRocket');
    (fw as unknown as { life: number }).life = 1;
    fw.fixedUpdate(1, a.hooks);
    expect(fw.dead).toBe(true);
    expect(a.cutTiles.length).toBe(170);               // 169（192 盒 551..743 → 34..46 列/行）+1（G22 死亡拍小盒 14×14 @tile(40,40) 同拍重报——记录器无去重,原版双 Damage 同格幂等）
    const b = g21World();
    const box = new TrapShot(40 * TILE, 40 * TILE, 0, -5, 0, 'fireworksBoxRocket');
    (box as unknown as { life: number }).life = 1;
    box.fixedUpdate(1, b.hooks);
    expect(box.dead).toBe(true);
    expect(b.cutTiles.length).toBe(170);               // ★G22：0 伤盒爆面照割（旧 damage>0 调用位门=登记债本体;blastDamage 头 cut 先于 damage<=0 整退）
  });
});

describe('§4 R8-F5 行为：爆环 dontTakeDamage 拒收 + peek 纯读（零白写）', () => {
  it('Dart 爆环：dontTakeDamage 敌（充能水母形）不受伤且不落桶账', () => {
    const { hooks, hurts } = g21World();
    const jelly = { id: 9, vanillaId: 63, x: 40 * TILE, y: 40 * TILE, w: 24, h: 24, dead: false, iframes: 0,
      dontTakeDamage: true,
      hurt: (d: number) => { hurts.push({ id: 9, dmg: d }); return true; } };
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [jelly];
    const b = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 350, 'bunny');
    (b as unknown as { life: number }).life = 1;
    b.fixedUpdate(1, hooks);
    expect(b.dead).toBe(true);
    expect(hurts).toHaveLength(0);                     // 旧爆环无门=充能水母吃炮弹伤
    expect(idStaticCheck(281, 9, 10)).toBe(true);      // 拒收拍零落账（写梯 :14031 深位）——idStaticCheck 组合式即查即写
    expect(idStaticReady(281, 9)).toBe(false);         // （上行已写,自证组合式语义）
  });
  it('Arrow 281 爆弹 aoeCd281 桥 peek 纯读：充能水母在爆盒内不白写 10t 窗', () => {
    const { hooks, hurts } = g21World();
    const jelly = { id: 12, vanillaId: 63, x: 40 * TILE, y: 40 * TILE, w: 24, h: 24, dead: false, iframes: 0,
      dontTakeDamage: true,
      hurt: (d: number) => { hurts.push({ id: 12, dmg: d }); return true; } };
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [jelly];
    const blast = new Arrow(40 * TILE, 40 * TILE, 0, 0, 175, 0, 281, {});
    (blast as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (blast as unknown as { bunnyOwner: number }).bunnyOwner = 256;
    blast.fixedUpdate(1 / 60, hooks);
    expect(blast.dead).toBe(true);
    expect(hurts).toHaveLength(0);                     // 充能水母不受伤（dealContacts :12687 同构）
    expect(idStaticReady(281, 12)).toBe(true);         // ★旧 writing-peek=false（白写窗）;纯读=未落账
    // 同窗内真敌照结算（窗未被水母污染的净效果投影）:
    const foe = { id: 13, vanillaId: 3, x: 40 * TILE, y: 40 * TILE, w: 24, h: 24, dead: false, iframes: 0,
      hurt: (d: number) => { hurts.push({ id: 13, dmg: d }); return true; } };
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [foe];
    const blast2 = new Arrow(40 * TILE, 40 * TILE, 0, 0, 175, 0, 281, {});
    (blast2 as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (blast2 as unknown as { bunnyOwner: number }).bunnyOwner = 256;
    blast2.fixedUpdate(1 / 60, hooks);
    expect(hurts).toHaveLength(1);                     // 水母窗未污染 → 真敌照结（旧=被拒 10t）
    expect(hurts[0]!.id).toBe(13);
  });
  it('idStaticReady 纯读/idStaticWrite 写位（S2 拆相单源语义）', () => {
    expect(idStaticReady(281, 777)).toBe(true);        // 空表纯读
    expect(idStaticReady(281, 777)).toBe(true);        // 重复读无副作用（零写）
    idStaticWrite(281, 777, 10);
    expect(idStaticReady(281, 777)).toBe(false);       // 写后关窗
    pinGameTimeTicks(gameTickCount() + 11);
    expect(idStaticReady(281, 777)).toBe(true);        // 到期重开
  });
});

describe('§5 R8-F3 行为：502 Kill 消散尘（killNow 单口,一切死亡路径）', () => {
  it('meowTrail 逐点尘 66（随机 hsl 彩/α150/s0.7/noGravity/历史位+半盒心）;零位跳过', () => {
    const { hooks, dusts } = g21World();
    const cat = new Arrow(1000, 1000, 8, 6, 40, 2, 502, { grav: 0, life: 600, pierce: 5 });
    (cat as unknown as { meowTrail: number[] }).meowTrail = [
      960, 960, 980, 990, 0, 0, 1000, 1000,           // 3 实位 + 1 零位
    ];
    (cat as unknown as { killNow: (g: GameHooks) => void }).killNow(hooks);
    expect(cat.dead).toBe(true);
    const d66 = dusts.filter((d) => d.type === 66);
    expect(d66).toHaveLength(3);                       // 零位 (0,0) 跳过（:75084）
    const w = cat.w, h = cat.h;
    const srcs = [[960, 960], [980, 990], [1000, 1000]];
    for (const [i, d] of d66.entries()) {
      expect(d.alpha).toBe(150);
      expect(d.noGravity).toBe(true);
      expect(d.scale).toBeCloseTo(0.7, 12);
      const src = srcs[i]!;                            // trail 顺序保序（零位出列）
      expect(d.x).toBeCloseTo(src[0] + w / 2, 6);
      expect(d.y).toBeCloseTo(src[1] + h / 2, 6);
      expect(d.color).toBeDefined();
      const c = d.color!;
      expect(c.a).toBe(255);                           // hslToRgb 默认参 A=255（Main.cs:48689）
      expect(Math.max(c.r, c.g, c.b)).toBe(255);       // hsl(h,1,0.5) → max=255
      expect(Math.min(c.r, c.g, c.b)).toBe(0);         // min=0
    }
  });
});

describe('§6 R8-F4 行为：178 Kill FX 三缺清偿（85 尘+40 gore;284 5 gore）', () => {
  const deathStub = () => {
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    const dusts: Array<{ type: number; scale: number; vx: number; vy: number }> = [];
    g.spawnDust = (x: number, y: number, w: number, h: number, type: number,
      vx: number, vy: number, _a: number, _c: unknown, scale = 1) => {
      const d = { type, scale, vx, vy };
      dusts.push(d);
      return d;
    };
    return { g, dusts };
  };
  it('178：85×d139-142（第三重扰动 ±2.5 + scale 抖 0.84..1.56）+ 40×gore 276-282（scale 抖 ±20%）', () => {
    const { g, dusts } = deathStub();
    (Game.prototype as unknown as { onProjectileDeath: (...a: unknown[]) => void })
      .onProjectileDeath.call(g, 178, 100, 100, 10, 10, 3, 4, 20);
    expect(dusts).toHaveLength(85);
    for (const d of dusts) {
      expect(d.type).toBeGreaterThanOrEqual(139);
      expect(d.type).toBeLessThanOrEqual(142);
      expect(d.scale).toBeGreaterThanOrEqual(1.2 * 0.7);
      expect(d.scale).toBeLessThanOrEqual(1.2 * 1.3);
      // 第三重扰动 +=Next(−50,51)×0.05 ∈ [−2.5,2.5]（叠加 ±0.5/×0.5..1.5 后全域）:
      expect(d.vx).toBeGreaterThanOrEqual(3 * 0.5 - 0.5 - 2.5);
      expect(d.vx).toBeLessThanOrEqual(3 * 1.5 + 0.5 + 2.5);
      expect(d.vy).toBeGreaterThanOrEqual(4 * 0.5 - 0.5 - 2.5);
      expect(d.vy).toBeLessThanOrEqual(4 * 1.5 + 0.5 + 2.5);
    }
    const gores = liveGorePieces().filter((p) => p.goreId >= 276 && p.goreId <= 282);
    expect(gores).toHaveLength(40);
    for (const p of gores) {
      expect(p.scale).toBeGreaterThanOrEqual(0.8);     // 1×(1±0.20)
      expect(p.scale).toBeLessThanOrEqual(1.2);
      expect(p.x).toBe(100);                           // NewGore position=弹盒左上
      expect(p.y).toBe(100);
    }
  });
  it('284：10 尘 + 5 gore（scale 抖 ±20% 在位）', () => {
    const { g, dusts } = deathStub();
    (Game.prototype as unknown as { onProjectileDeath: (...a: unknown[]) => void })
      .onProjectileDeath.call(g, 284, 100, 100, 10, 10, 3, 4, 20);
    expect(dusts).toHaveLength(10);
    const gores = liveGorePieces().filter((p) => p.goreId >= 276 && p.goreId <= 282);
    expect(gores).toHaveLength(5);
    for (const p of gores) {
      expect(p.scale).toBeGreaterThanOrEqual(0.8);
      expect(p.scale).toBeLessThanOrEqual(1.2);
      expect(p.x).toBe(100);
      expect(p.y).toBe(100);
    }
  });
});

describe('§7 R7-P2-2 行为：虎特攻 damage != 0 门', () => {
  const mkTigerGame = () => {
    const w = new World(200, 120, 7, 'g21-tiger');
    w.groundLevel = 60;
    const hooks = {
      world: w, player: null as unknown as Player,
      enemies: () => [] as unknown[], critters: () => [], npcs: () => [],
      playSfx: () => {}, playSfxFiles: () => {}, spawnParticles: () => {},
      addDamageNumber: () => {}, onEnemyKilled: () => {}, spawnDrop: () => null,
      damagePlayer: (): number => 0, spawnEnemy: () => {}, notifyInventoryChanged: () => {},
      showPickupLabel: () => {}, cutTile: () => {},
      entities: { add: () => {}, projectiles: [] as unknown[] },
    } as never;
    const player = new Player(0, 0, new Inventory());
    player.x = 100 * TILE; player.y = 60 * TILE;
    const m = new MinionProj(player.cx, player.cy, 833, 41, 2, false, 0, false, () => player);
    (hooks as unknown as { player: Player }).player = player;
    (m as unknown as { id: number }).id = 9001;
    return { hooks, player, m };
  };
  it('dmg0=0（边角面）：不尝试不置冷却（pounceCd 恒 0;旧=成功 360/失败 10）', () => {
    const { hooks, player, m } = mkTigerGame();
    (m as unknown as { tigerBody: (g: GameHooks, p: Player, d: number) => void }).tigerBody(hooks, player, 0);
    expect((m as unknown as { pounceCd: number }).pounceCd).toBe(0);
    (m as unknown as { tigerBody: (g: GameHooks, p: Player, d: number) => void }).tigerBody(hooks, player, 0);
    expect((m as unknown as { pounceCd: number }).pounceCd).toBe(0);   // 次拍仍不置（无 10t 白窗）
  });
  it('dmg0>0：尝试照走（失败置 10t 重试窗——:50200 语义保持）', () => {
    const { hooks, player, m } = mkTigerGame();
    (m as unknown as { tigerBody: (g: GameHooks, p: Player, d: number) => void }).tigerBody(hooks, player, 41);
    const cd = (m as unknown as { pounceCd: number }).pounceCd;
    expect(cd === 10 || cd === 360).toBe(true);        // 无敌在场=失败 10;有敌=成功 360（两可皆证尝试在跑）
  });
});

describe('§8 R7-P2-3 数值面：706 afade 表档（本体 A 面）', () => {
  it('稳态 α=0 → ga=180/255≈70.6%（旧 100%）;α≥240 → 0（byte 钳）', () => {
    const m = PROJ_ALPHA_MOD[706]!;
    const ga = (alpha: number) =>
      Math.max(0, ((m.rgba?.[3] ?? 255) - alpha * (m.slope ?? 1)) / 255) * ((255 - alpha) / 255);
    expect(ga(0)).toBeCloseTo(180 / 255, 12);
    expect(ga(100)).toBeCloseTo((180 - 75) / 255 * (155 / 255), 12);
    expect(ga(240)).toBe(0);
    expect(ga(255)).toBe(0);
  });
});
