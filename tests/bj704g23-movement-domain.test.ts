// ★BJ705-G23（2026-10-22）登记债清偿·玩家运动域两件大刀：
//
// 件1【bj705b-wing-cap 翼档族】（含 ⑩ 2026-08-31 滚轴鞋翼横移 deferred 域收口）——
//   亲读 1457（1456 交叉复核同形）定谳：
//   · Mount.CanUseWings（Mount.cs:574-583）:未骑乘/_data null 恒【真】;骑乘走
//     MountData.CanUseWings——全表唯 SetAsRollerSkate（:2579）置真=滚轴鞋 57-60,
//     其余坐骑骑乘期 :26830-33 wings/wingsLogic 清零 + :26826-28 runSlowdown=0.2。
//     「仓坐骑恒禁翼」纵向域（wings/wingTime/flying 门 mountCanWings*）本就分型
//     正确（57-60 放行）——偏差全在横向域：
//   · WingAirLogicTweaks（1457 :29536-55/1456 :28838-62）总门 :26696
//     `wingsLogic>0 && vy≠0 && !merman && mount.CanUseWings`;函数体只抬
//     **accRunSpeed**（:29550-52 AccRunSpeedOverride>accRunSpeed 才写=只抬不压;
//     悬浮档 :29543-45 DownHoverSpeedOverride 无条件置换可压低）——maxRunSpeed 不动;
//     runAcceleration *= AccRunAccelerationMult（:29555）。修前三面:
//     ①缺 CanUseWings 门→骑乘+翼 airborne maxRun=max(8,9)=9px/t≈45mph 瞬态
//       （幽灵翼 29/32 档;恶魔翼 6.25<8 数值死面）+accRun=maxRun 置换坐骑 DashSpeed;
//     ②cap 抬 maxRun（原版只抬 accRun）→顶速直达而非慢爬坡;BJ705-B 的
//       boostBase/preWingMaxRun 补丁基底退役（boost 直接乘 maxRun=vanilla 原句）;
//     ③accRun=maxRun 置换 gear accRunSpeed（靴 6/6.75 clobber）+滚轴鞋+翼 accRun
//       少 +1 加法（vanilla cap 在 :26838-42 叠加前=翼值入 += 基底;仓以
//       (max(accRun−add,wingVal))+add 还原）。
//   · 爬坡内门/双份加速（HorizontalMovement :20091/:20121 内门 `vy==0 ||
//     wingsLogic>0 || mount.CanFly(this)`;:20096/:20126 第二份 ×0.2 的 wingsLogic>0）
//     ——旧 wingAir=`!onGround && wing && wingTime>0 && !mnt` 三重窄化退役:
//     滑翔相（燃料尽）ramp 照跑/滚轴鞋+翼 ramp 放行/飞行坐骑（CanFly）无翼放行。
//
// 件2【g19-jump-release-zero jumpHold 相位族】——原版 JumpMovement（:20786-21208）
//   生命周期=按键沿置 jump=jumpHeight×mult、按住 sustain 钉 vy+jump--、vy==0 清、
//   **松键（controlJump false）即 jump=0（:21201-21208 else 支）**——剩余预算丢弃,
//   半空再按不恢复钉速（重按须走起跳门）;CCed 亦清（:25432-34 controlJump 压零）。
//   仓 jumpHold 耗尽制=松键后余量照跑:窗口消费者（瓶/坐骑 boost、翼飞行门、飞毯门、
//   坐骑飞行门、mountJump 门、沙暴窗）松键后多开 ≤jumpHold 拍+半空重按恢复钉速
//   =免费二段跳残余（2026-08-19 行为录制只修「冻结」变体,其 :22446 锚系 1456
//   GrappleMovement 误锚——1457/1456 两版 jump-- 均在 controlJump 门内,勘误随刀）。
//   修=sustain 块补 `else if (!inputJump) jumpHold=0`（含按住 sustain 语义保真）。
//
// 判别锁=本文件（§W 翼档族行为面+§J 相位族行为面+§S 结构锁）;域回归=bj705b
//   （含 §1 随机扫描 2400 条档）/bj705/g19/g5/g4/g12-g16/g20/g22/mounts 全族。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';

const ROOT = join(__dirname, '..');
const playerSrc = readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8');
const vanMount = readFileSync(join(ROOT, '..', 'Terarria1457', 'Terraria', 'Mount.cs'), 'utf8');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

const fakeHooks = (w: World, p: unknown) => ({
  world: w, player: p,
  playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
  addDamageNumber: () => {}, spawnParticles: () => {}, spawnDust: () => null,
  spawnDrop: () => null, damagePlayer: (): number => 0, onEnemyKilled: () => {},
  entities: { add: () => {} }, enemies: () => [], critters: () => [], npcs: () => [],
  notifyInventoryChanged: () => {}, spawnEnemy: () => {}, cutTile: () => {},
});

type P = import('../src/entities/Player').Player;

async function mkPlayer(xPx: number, yPx: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  return new Player(xPx, yPx, new Inventory());
}

/** 500×240（bj705b 夹具判例:bordersMovement 底界脚钳不罩 row150 地面;500 宽漂移有余） */
function makeGroundWorld(seed: string, ground = 150): World {
  const w = new World(500, 240, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

async function settle(p: P, game: unknown, maxT = 120): Promise<void> {
  p.inputX = 0; p.inputJump = false; p.inputDown = false;
  for (let t = 0; t < maxT; t++) { p.fixedUpdate(1 / 60, game as never); if (p.onGround) break; }
}

function pressJump(p: P, game: unknown): void {
  p.inputJump = true; p.jumpEdgePrev = false;
  p.fixedUpdate(1 / 60, game as never);
  p.inputJump = false;
}

// ---------------------------------------------------------------------------
// §W 件1 翼档族（行为面）
// ---------------------------------------------------------------------------
describe('BJ705-G23 §W 翼档 cap 1:1（WingAirLogicTweaks :29536-55 × :26696 门）', () => {
  it('W1 骑 14+太阳翼(3468) 空中横移峰 ≤8.6（修前 cap 无门 maxRun=max(8,9)=9≈45mph 瞬态）', async () => {
    const w = makeGroundWorld('g23-w1');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(3468), stack: 1 };      // 太阳翼（slot 29:accSpeed 9,×2.5）
    await settle(p, game);
    expect(p.mount.setMount(14, p)).toBe(true);        // Basilisk（CanUseWings=false 族）
    let peak = 0;
    for (let t = 0; t < 240; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); peak = Math.max(peak, Math.abs(p.vx)); }
    expect(peak).toBeGreaterThan(7.9);                 // 骑乘极速在位（≈8.2=41mph 前提）
    pressJump(p, game);                                // 坐骑跳（空中拍进 cap 域）
    for (let t = 0; t < 200; t++) {
      p.inputX = 1; p.inputJump = false; p.inputDown = false;
      p.fixedUpdate(1 / 60, game as never);
      peak = Math.max(peak, Math.abs(p.vx));
      if (p.onGround && t > 10) break;
    }
    expect(peak).toBeLessThanOrEqual(8.6);             // 修前 ≈9.2-9.3（45mph 瞬态）
  }, 30000);

  it('W2 未骑乘太阳翼:空中横移走慢爬坡（vx@40 ≤7.0;修前 maxRun=9 全速段直达）且续爬到 ≥8.5', async () => {
    const w = makeGroundWorld('g23-w2');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(3468), stack: 1 };
    await settle(p, game);
    for (let t = 0; t < 120; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }   // 跑满 ≈3
    p.inputJump = true; p.jumpEdgePrev = false;        // 起跳并【持跳】（窗口→翼飞行续弧）
    let vx40 = 0, peak = 0;
    for (let t = 0; t < 400; t++) {
      p.inputX = 1; p.inputDown = false;
      p.fixedUpdate(1 / 60, game as never);
      if (t === 40) vx40 = Math.abs(p.vx);
      peak = Math.max(peak, Math.abs(p.vx));
      if (p.onGround && t > 60) break;
    }
    p.inputJump = false;
    expect(vx40).toBeLessThanOrEqual(7.0);             // 修前 ≈9（maxRun 直达）;修后 ≈6.1（0.4×runAcc 爬坡）
    expect(vx40).toBeGreaterThan(5.0);                 // 双份加速在跑（:20096 ×2.5 → 0.08/t;撤双份=4.6 必红）
    expect(peak).toBeGreaterThanOrEqual(8.5);          // 慢爬坡最终达 accRun=9（ramp 放行=门正确）
  }, 30000);

  it('W3 滚轴鞋(58)+太阳翼:accRun=9+1=10（叠加前基底 max+加法）+accelMult×2.5 入 runAcc（修前 9/无 mult）', async () => {
    const w = makeGroundWorld('g23-w3');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(3468), stack: 1 };
    await settle(p, game);
    expect(p.mount.setMount(58, p)).toBe(true);        // 绿溜冰鞋（CanUseWings=additive 真）
    for (let t = 0; t < 240; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }   // 跑满 ≈4
    p.inputJump = true; p.jumpEdgePrev = false;        // 持跳：skate 档窗口(2)→翼飞行（骑乘放行）
    let peak = 0, vx60 = 0, vx80 = 0;
    for (let t = 0; t < 400; t++) {
      p.inputX = 1; p.inputDown = false;
      p.fixedUpdate(1 / 60, game as never);
      if (t === 60) vx60 = Math.abs(p.vx);
      if (t === 80) vx80 = Math.abs(p.vx);
      peak = Math.max(peak, Math.abs(p.vx));
      if (p.onGround && t > 100) break;
    }
    p.inputJump = false;
    expect(vx60).toBeGreaterThanOrEqual(8.8);          // 中程爬坡率（×2.5 → 0.12/t ≈9.9;撤 mult=8.1 必红）
    expect(vx80).toBeGreaterThanOrEqual(9.3);          // 撤 +1 加法=帽 9.0 必红
    expect(peak).toBeGreaterThanOrEqual(9.5);          // 修前 ≈9.2（accRun=9 无 +1/无 ×2.5）
    expect(peak).toBeLessThanOrEqual(10.8);            // 帽上界（10+一步过冲）
  }, 30000);

  it('W5 滑翔相（wingTime 尽）ramp 照跑::20091 wingsLogic>0 无 wingTime 项（旧门=压回 maxRun 3）', async () => {
    const w = makeGroundWorld('g23-w5');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(3468), stack: 1 };
    await settle(p, game);
    p.fixedUpdate(1 / 60, game as never);              // 静置 1 拍回满 wingTime（夹具判例）
    for (let t = 0; t < 120; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }   // 跑满 ≈3
    p.wingTime = 30;                                   // 种子短油量（30 拍飞行→滑翔相）
    p.inputJump = true; p.jumpEdgePrev = false;        // 持跳：窗口(15)→飞行(30)→滑翔
    let landVx = 0;
    for (let t = 0; t < 500; t++) {
      p.inputX = 1; p.inputDown = false;
      p.fixedUpdate(1 / 60, game as never);
      if (p.onGround && t > 30) { landVx = Math.abs(p.vx); break; }
    }
    p.inputJump = false;
    expect(landVx).toBeGreaterThanOrEqual(7.0);        // 滑翔相 ramp 续爬（新 ≈9;旧 wingTime>0 门=衰减回 ≈3）
    expect(landVx).toBeLessThanOrEqual(9.6);           // accRun=9 帽
  }, 30000);
});

// ---------------------------------------------------------------------------
// §J 件2 jumpHold 相位族（行为面）
// ---------------------------------------------------------------------------
describe('BJ705-G23 §J 松键即清（:21201-08）× sustain 保真（:20823-38）', () => {
  it('J1 持跳 sustain:窗口逐拍流逝+vy 钉速（controlJump 按住时 jump 不清）', async () => {
    const w = makeGroundWorld('g23-j1');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    await settle(p, game);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game as never);              // fire 拍（jumpStartedThisTick 免 sustain）
    expect(p.jumpHold).toBe(15);                       // PLAYER_JUMP_TICKS
    for (let t = 0; t < 5; t++) p.fixedUpdate(1 / 60, game as never);   // 持跳 5 拍
    expect(p.jumpHold).toBe(10);                       // 逐拍 −1（松键清零不触——按住语义保真）
    expect(p.vy).toBeLessThan(-4.5);                   // 钉速在位（-effJumpSpd,干档 5.01）
    p.inputJump = false;
  }, 30000);

  it('J2 松键即清+半空重按【不】恢复钉速（旧耗尽制=免费二段跳残余）', async () => {
    const w = makeGroundWorld('g23-j2');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    await settle(p, game);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game as never);              // fire
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game as never);   // 持 3（12）
    p.inputJump = false;
    p.fixedUpdate(1 / 60, game as never);              // 松键拍
    expect(p.jumpHold).toBe(0);                        // ★:21201-08 剩余预算丢弃（旧=11 续跑）
    for (let t = 0; t < 2; t++) p.fixedUpdate(1 / 60, game as never);   // 松键 2（重力衰减）
    const vyPre = p.vy;
    p.inputJump = true; p.jumpEdgePrev = false;        // 半空重按
    p.fixedUpdate(1 / 60, game as never);
    expect(p.jumpHold).toBe(0);                        // 不复窗（重按须走起跳门）
    expect(p.vy).toBeGreaterThan(vyPre - 0.05);        // 不复钉（旧=vy 钉回 -effJumpSpd 大幅上跳）
    expect(p.vy).toBeGreaterThan(-6.0);                // 非钉速值（重力衰减后 > -5）
    p.inputJump = false;
  }, 30000);

  it('J3 暴雪瓶 boost 窗随松键死:release+repress 后 vx 不再吃 ×3/×1.5（旧=余量照跑至 4.5+）', async () => {
    const w = makeGroundWorld('g23-j3');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[4] = { id: iid(987), stack: 1 };       // 暴雪瓶
    await settle(p, game);
    pressJump(p, game);                                // 首跳（tap——松键即清）
    p.fixedUpdate(1 / 60, game as never);              // 空中沿
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game as never);              // 空中瓶跳 fire（performingJump=Blizzard）
    expect((p as unknown as { performingJump: string | null }).performingJump).toBe('Blizzard');
    for (let t = 0; t < 3; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }   // 持 3（boost live,vx→≈3.7）
    p.inputJump = false;
    for (let t = 0; t < 6; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }   // 松 6（boost 须死）
    p.inputJump = true; p.jumpEdgePrev = false;
    for (let t = 0; t < 15; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }  // 重按 15
    p.inputJump = false;
    expect(Math.abs(p.vx)).toBeLessThan(4.0);          // 旧=窗余量照跑 vx≈4.5+;修后回落 ≈3
  }, 30000);

  it('J4 翼飞行门松键即开:tap+重按 2 拍内 flag19 接管（wingTime 耗）（旧=被余量窗封至耗尽）', async () => {
    const w = makeGroundWorld('g23-j4');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(492), stack: 1 };       // 恶魔翼
    await settle(p, game);
    const wtMax = (p as unknown as { equipStats: { wing: { time: number } } }).equipStats.wing.time;
    // settle 落地拍即断（onGround 尾拍置位,回满段在碰撞前跑）——补 1 拍静置让
    // wingTime 回满门（:8411 onGround∧!inputJump）先跑（真实游戏站立多拍自然达成）
    p.fixedUpdate(1 / 60, game as never);
    expect(p.wingTime).toBe(wtMax);                    // 回满前提（100）
    pressJump(p, game);                                // tap 跳（松键即清窗）
    p.fixedUpdate(1 / 60, game as never);              // 空中沿 1
    p.inputJump = true; p.jumpEdgePrev = false;        // 半空重按（持）
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game as never);
    p.inputJump = false;
    expect(p.wingTime).toBeLessThan(wtMax);            // 重按 2-3 拍内翼飞行已接管耗油
    expect(p.wingTime).toBeGreaterThan(0);             // （旧=jumpHold 余量封门,wingTime 恒满）
  }, 30000);
});

// ---------------------------------------------------------------------------
// §S 结构锁（源文本锚——变异恰红锚）
// ---------------------------------------------------------------------------
describe('BJ705-G23 §S 结构锁', () => {
  it('S1 翼档 cap 块::26696 门四臂（wing/vy≠0/!merman/CanUseWings）+:29550-52 只抬 accRun', () => {
    expect(playerSrc).toContain('if (eqM.wing && this.vy !== 0 && !this.merman && mntCanWings) {');
    expect(playerSrc).toContain('} else if (ws.accSpeed !== -1 && ws.accSpeed > accRun - additiveDash) {');
    expect(playerSrc).toContain('accRun = ws.accSpeed + additiveDash;   // :29550-52 只抬不压;maxRun 不动');
    expect(playerSrc).toContain('if (ws.hoverSpeed !== -1) accRun = ws.hoverSpeed + additiveDash;   // :29543-45 无条件置换（可压低）');
    expect(playerSrc).toContain('if (wingCapFired) runAcc = mulPreAdd(runAcc, wingAccMul, additiveAcc);');
    // BJ705-B 补丁基底代码形绝迹（注释史注除外——cap 1:1 后退化恒等已撤）
    expect(playerSrc).not.toContain('const boostBase');
    expect(playerSrc).not.toContain('mulPreAdd(boostBase');
    expect(playerSrc).not.toContain('let preWingMaxRun');
  });

  it('S2 爬坡内门/双份加速:20091/:20121/:20096/:20126（wingsLogicEff 三重窄化退役）', () => {
    expect(playerSrc).toContain('const canRamp = this.vy === 0 || wingsLogicEff > 0 || !!(mnt && mnt.canFly(this));');
    expect(playerSrc).toContain('if (wingsLogicEff > 0) this.vx += ix * runAcc * 0.2;   // :20096/:20126 第二份（wingsLogic>0）');
    expect(playerSrc).toContain('const wingsLogicEff = eqM.wing && mntCanWings ? eqM.wing.logic : 0;');
    expect(playerSrc).not.toContain('this.wingTime > 0 && !mnt;');   // 旧 wingAir 谓词绝迹
  });

  it('S3 松键即清支（:21201-08）+ sustain 钉位（inputJump 分支承载）+ G25 挂爪冻结门', () => {
    expect(playerSrc).toContain('else if (!this.inputJump) {');
    expect(playerSrc).toContain('this.jumpHold = 0;');
    expect(playerSrc).toContain('this.vy = -effJumpSpd * gd;');
    // 起跳拍互斥（fire 拍不进 sustain）+ 挂爪/舌缚冻结门（G25 [g23-sustain-grapple-freeze]
    // 清偿:≙原版 :26692 else-if——JumpMovement 整段不跑）在位
    expect(playerSrc).toContain('if (this.jumpHold > 0 && !jumpStartedThisTick\n      && !this.grappling[0] && !this.buffs.has(BuffType.TheTongue)) {');
  });

  it('S4 vanilla CanUseWings 分型普查:Mount.cs 唯 SetAsRollerSkate 置真+未激活恒真', () => {
    // 全表唯一赋值位（:2579）;字段缺省 false（:255 MountData 字段无初始化）
    const assigns = vanMount.match(/newMount\.CanUseWings = true;/g) ?? [];
    expect(assigns.length).toBe(1);
    expect(vanMount).toContain('SetAsRollerSkate');
    // 属性（:574-583,非 :255 字段）:未激活/_data null → true
    const m = vanMount.match(/public bool CanUseWings\s*\n\t\{\s*\n\t\tget\s*\n\t\t\{\s*\n\t\t\tif \(_data == null \|\| !_active\)\s*\n\t\t\t\{\s*\n\t\t\t\treturn true;/);
    expect(m).not.toBeNull();
  });

  it('S5 七笔登记债清偿/销案注在位（G25 收口后——防回潮/防误再登记）', () => {
    // ★BJ705-G25（2026-10-22）七笔全清:六修一销。锁清偿/销案判语形态——标签回潮
    //   （重新出现「登记」形态）即红。
    expect(playerSrc).toContain('[g23-merman-sustain-infinite] 清偿（:20832-36）');   // merman 湿态不减计数
    expect(playerSrc).toContain('[g23-wing45-dash-friction] 清偿（WingAirLogicTweaks 尾段');   // :29557-59 翼45 掷后摩擦×6
    expect(playerSrc).toContain('[g23-coast-band-friction] 清偿');   // 带内滞空滑行保持
    expect(playerSrc).toContain('[g23-fullspeed-dashdelay-1457] 清偿');   // 1457 全速两支+字段直通
    expect(playerSrc).toContain('[g23-sustain-grapple-freeze] 清偿（:26692 else-if 门）');   // 挂爪期预算冻结
    expect(playerSrc).toContain('[g23-num15-field-face] 清偿');   // :21429 字段面直通
    expect(playerSrc).toContain('[g23-mounted-wingframe-reset] 销案');   // :27596-99 零感知销案
    // 销案件防再登记判语在位
    expect(playerSrc).toContain('零玩家可感知面,不落刀');
  });
});
