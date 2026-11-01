// ★BJ103-A1b（2026-09-16）传送相机过渡两面守卫：近距 SetCameraLerp(0.1) 滑行 /
//   远距 BlackFadeCameraTeleport+硬吸合。金标 = 1457 反编译（1458 同域行号 +6 对齐,
//   BJ103-A1 头注同批 sed 区间 diff 实证）：
//   · StartCameraTransitionForPlayerTeleport（Main.cs:63526-63542）：
//     ①IsCameraTrackingObject（:63528-63531）→ pan += 旧位−新位,不过渡;
//     ②oldPosition += CurrentPan;CurrentPan = Zero（:63532-63534）;
//     ③dist < BlackFadeDist（:3127 = UnscaledSize.Length()/2+100）→ SetCameraLerp(0.1,
//       lerpSpeedupDelay)（:3235-3240;Style==1 → delay=10 :37744-37746,Player.cs:45899
//       混乱之杖 Teleport(pos,1)）;
//     ④dist ≥ → BlackFadeCameraTeleport()（:63500-63524）+ screenPosition =
//       PlayerFocusedScreenPosition()（:63541 硬吸合）。
//   · 滑行消费（DoDraw_UpdateCameraPosition 尾 :63580-63600,Update 域 60Hz :62781）：
//     timer≥toggle 后每 tick lerp += ((timer−toggle)/3+1)×0.001 钳 1
//     （UpdateCameraLerp :18326-18340）;到位判据 dist(prev,hard)−|v|<0.25 → 吸合硬位。
//   · 次级副作用（BlackFadeCameraTeleport 内,maxQ :63511 / UpdateSceneMetrics :63514 /
//     instantBGTransitionCounter=10+bgDelay=0+bgStyle=preferred :63513/:63519-63521 /
//     Cloud.lastCameraCenter=null :63518）→ gfxQuality=1 / _forceSceneRescan /
//     BiomeBackground.instantBGTransition / SkyRenderer.resetCloudCamAnchor。
// 变异证红（开发期实测）：M1 摘 ramp 行 → 滑行率组红；M2 到位判据 −|v| 摘除 →
//   速度豁免组红；M3 黑幕支摘 blackFadeIn → 远距组红；M4 pan 折叠摘除 → 折叠组红；
//   M5 调用点改回 camera.x=p.cx 直跟 → 调用点结构锁红。
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Camera } from '../src/render/Camera';
import { gfxQuality } from '../src/core/GfxQuality';
import { Game } from '../src/core/Game';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const gameSrc = read('src/core/Game.ts');

const mkCam = (): Camera => new Camera(2000, 2000) as Camera;

// ============================================================
// ① Camera 滑行面（SetCameraLerp :3235-3240 + UpdateCameraLerp :18326-18340）
// ============================================================
describe('BJ103-A1b Camera.startTeleportLerp/advanceTeleportLerp（Main.cs:3235/:18326-18340）', () => {
  it('首拍=0.1+首档 ramp（timer1≥0 → +((1-0)/3+1)×0.001 → 0.101333…）,位移=hard×率', () => {
    const cam = mkCam();
    cam.startTeleportLerp(0.1, 0);
    expect(cam.teleportLerp).toBeCloseTo(0.1, 12);
    cam.x = 0; cam.y = 0;
    cam.advanceTeleportLerp(100, 0, 0);
    const rate = 0.1 + ((1 - 0) / 3 + 1) * 0.001;      // 0.101333…
    expect(cam.teleportLerp).toBeCloseTo(rate, 12);
    expect(cam.x).toBeCloseTo(100 * rate, 9);          // Lerp(prev,hard,lerp) :63596
  });

  it('ramp 逐拍累进（timer2 → 再 +((2-0)/3+1)×0.001）', () => {
    const cam = mkCam();
    cam.startTeleportLerp(0.1, 0);
    cam.advanceTeleportLerp(1000, 0, 0);
    const r1 = cam.teleportLerp;
    cam.advanceTeleportLerp(1000, 0, 0);
    expect(cam.teleportLerp).toBeCloseTo(r1 + ((2 - 0) / 3 + 1) * 0.001, 12);
  });

  it('delay=10（Style==1 杖族 :37744-37746）：前 9 拍率钉 0.1,第 10 拍起 ramp', () => {
    const cam = mkCam();
    cam.startTeleportLerp(0.1, 10);
    for (let i = 0; i < 9; i++) cam.advanceTeleportLerp(5000, 0, 0);
    expect(cam.teleportLerp).toBeCloseTo(0.1, 12);      // timer1..9 < 10 → 无 ramp
    cam.advanceTeleportLerp(5000, 0, 0);                 // 第 10 拍:timer=10 ≥ 10
    expect(cam.teleportLerp).toBeCloseTo(0.1 + ((10 - 10) / 3 + 1) * 0.001, 12);
  });

  it('到位判据（:63588-63593）dist−|v|<0.25 → 吸合硬位+lerp=0;速度豁免（−|v| 差项）', () => {
    const cam = mkCam();
    cam.startTeleportLerp(0.1, 0);
    cam.x = 100; cam.y = 100;
    cam.advanceTeleportLerp(100.2, 100, 0);              // dist 0.2 < 0.25
    expect(cam.teleportLerp).toBe(0);
    expect(cam.x).toBeCloseTo(100.2, 12);                // 吸合硬位（该帧 screenPosition 已=硬位）
    // 速度豁免:dist 1.0,|v| 0.8 → 0.2 < 0.25 → 吸合（玩家自身移动补完差量）
    const cam2 = mkCam();
    cam2.startTeleportLerp(0.1, 0);
    cam2.x = 0; cam2.y = 0;
    cam2.advanceTeleportLerp(1.0, 0, 0.8);
    expect(cam2.teleportLerp).toBe(0);
    expect(cam2.x).toBeCloseTo(1.0, 12);
    // 反形:dist 1.0,|v| 0 → 1.0 ≥ 0.25 → 继续滑
    const cam3 = mkCam();
    cam3.startTeleportLerp(0.1, 0);
    cam3.x = 0; cam3.y = 0;
    cam3.advanceTeleportLerp(1.0, 0, 0);
    expect(cam3.teleportLerp).toBeGreaterThan(0);
    expect(cam3.x).toBeGreaterThan(0);
  });

  it('率钳 1（:18335-18337）+ lerp≤0 零操作（窗外=follow 域）', () => {
    const cam = mkCam();
    cam.startTeleportLerp(0.99, 0);
    for (let i = 0; i < 300; i++) cam.advanceTeleportLerp(1e6, 0, 0);
    expect(cam.teleportLerp).toBeLessThanOrEqual(1);
    const dead = mkCam();
    dead.teleportLerp = 0;
    dead.x = 7;
    dead.advanceTeleportLerp(999, 999, 0);
    expect(dead.x).toBe(7);
  });
});

// ============================================================
// ② Game.startCameraTransitionForPlayerTeleport 两面（Main.cs:63526-63542）
//    （Game 原型台,不实例化——world/renderer/golfState 桩注入）
// ============================================================
interface TransitionHarness {
  game: Record<string, unknown> & {
    startCameraTransitionForPlayerTeleport: (ox: number, oy: number, delay?: number) => void;
  };
  cam: Camera;
  player: { x: number; y: number; cx: number; cy: number; w: number; h: number; vx: number; vy: number; dead: boolean };
  renderer: { blackFadeIn: number; biomeBg: { instantBGTransition: () => void }; sky: { resetCloudCamAnchor: () => void } };
}
function harness(): TransitionHarness {
  const cam = mkCam();
  const player = { x: 5000, y: 5000, cx: 5010, cy: 5021, w: 20, h: 42, vx: 0, vy: 0, dead: false };
  const renderer = {
    blackFadeIn: 0,
    biomeBg: { instantBGTransition: vi.fn() },
    sky: { resetCloudCamAnchor: vi.fn() },
  };
  const game = Object.create(Game.prototype) as unknown as TransitionHarness['game'] & Record<string, unknown>;
  game.camera = cam;
  game.player = player;
  game.golfState = { tryGetCameraTrackingPosition: () => null };
  game.renderer = renderer;
  return { game: game as TransitionHarness['game'], cam, player, renderer };
}

describe('BJ103-A1b Game.startCameraTransitionForPlayerTeleport（近滑行/远黑幕+硬吸合）', () => {
  it('近距（dist<BlackFadeDist）→ SetCameraLerp(0.1,delay),相机【不】瞬吸', () => {
    const h = harness();
    // 旧位 5050 → dist 50 ≪ 黑幕阈（1200×900 屏阈 884.6,避 800×600=600 边界混用）
    h.cam.viewW = 1200; h.cam.viewH = 900;
    h.cam.x = 4000; h.cam.y = 4000;
    h.game.startCameraTransitionForPlayerTeleport(5050, 5000);
    expect(h.cam.teleportLerp).toBeCloseTo(0.1, 12);
    expect(h.cam.x).toBe(4000);                          // 未吸合（滑行面接管）
    expect(h.renderer.blackFadeIn).toBe(0);              // 无黑幕
    expect(h.cam.panX).toBe(0);                          // pan 清零（:63534）
  });

  it('远距 → BlackFadeCameraTeleport 次级面全落+硬吸合 p.cx/p.cy（:63541）', () => {
    gfxQuality.value = 0.4;
    const h = harness();
    h.cam.viewW = 1200; h.cam.viewH = 900;
    h.cam.x = 3000; h.cam.y = 3000;
    h.game.startCameraTransitionForPlayerTeleport(500, 500);   // dist≫阈值
    expect(h.renderer.blackFadeIn).toBe(255);             // :63506
    expect(h.cam.x).toBeCloseTo(h.player.cx, 12);         // PlayerFocusedScreenPosition 等价
    expect(h.cam.y).toBeCloseTo(h.player.cy, 12);
    expect(h.cam.teleportLerp).toBe(0);                   // 远距不走滑行
    expect(gfxQuality.value).toBe(1);                     // maxQ=true（:63511）
    expect(h.renderer.biomeBg.instantBGTransition).toHaveBeenCalled();       // :63513/:63519-63521
    expect(h.renderer.sky.resetCloudCamAnchor).toHaveBeenCalled();           // :63518
    (h.game as unknown as { _forceSceneRescan: boolean })._forceSceneRescan = false;    // 清闸
    gfxQuality.reset();
  });

  it('pan 折叠（:63532-63534）：CurrentPan 并入旧位参与距离判定,随后清零', () => {
    const h = harness();
    h.cam.viewW = 1200; h.cam.viewH = 900;                 // 阈 884.6
    h.cam.panX = 900; h.cam.panY = 0;                      // 旧位+900 → dist 900 ≥ 884.6 → 远距
    h.game.startCameraTransitionForPlayerTeleport(h.player.x, h.player.y);
    expect(h.cam.panX).toBe(0);                            // 折叠后清零
    expect(h.renderer.blackFadeIn).toBe(255);              // 折叠距离计入 → 黑幕支
    // 反形:无 pan 时同位近距 → 滑行支
    const h2 = harness();
    h2.cam.viewW = 1200; h2.cam.viewH = 900;
    h2.game.startCameraTransitionForPlayerTeleport(h2.player.x, h2.player.y);
    expect(h2.cam.teleportLerp).toBeCloseTo(0.1, 12);
  });

  it('跟踪镜头支（IsCameraTrackingObject :63528-63531）：pan 补偿旧位差,不过渡', () => {
    const h = harness();
    h.game.golfState = { tryGetCameraTrackingPosition: () => ({ x: 1, y: 1 }) };
    h.cam.panX = 0; h.cam.panY = 0;
    h.game.startCameraTransitionForPlayerTeleport(4900, 5000);   // 旧位差 100 → pan 补偿
    expect(h.cam.panX).toBe(-100);                         // pan += 旧位−新位
    expect(h.cam.teleportLerp).toBe(0);
    expect(h.renderer.blackFadeIn).toBe(0);
  });

  it('delay 穿线：Style==1 面（混乱之杖 teleportToMouse）传 10,其余缺省 0', () => {
    const h = harness();
    h.cam.viewW = 1200; h.cam.viewH = 900;
    h.game.startCameraTransitionForPlayerTeleport(5050, 5000, 10);
    h.cam.advanceTeleportLerp(h.player.cx, h.player.cy, 0);
    expect(h.cam.teleportLerp).toBeCloseTo(0.1, 12);       // 首拍无 ramp（timer1<10）
    const h2 = harness();
    h2.cam.viewW = 1200; h2.cam.viewH = 900;
    h2.game.startCameraTransitionForPlayerTeleport(5050, 5000);
    h2.cam.advanceTeleportLerp(h2.player.cx, h2.player.cy, 0);
    expect(h2.cam.teleportLerp).toBeCloseTo(0.1 + ((1 - 0) / 3 + 1) * 0.001, 12);
  });
});

// ============================================================
// ③ 调用点结构锁（汇线完整面——逐调用点锁源码,防回退 camera.x=p.cx 直跟）
// ============================================================
describe('BJ103-A1b 传送面调用点结构锁', () => {
  it('六汇线全部接 startCameraTransitionForPlayerTeleport（Player.Teleport :37747 汇聚等价）', () => {
    // ★G39-A（2026-11-01）窗口扩 9000→9300：teleportHeadReset 双字段插行（g36a D-⑨
    //  清偿,九传送面各 +2 行）把 fireRecallTeleport 体内过渡调用推出窗外——
    //  G36-A 判例 3（结构锁窗口是脆弱依赖）第二例;勿再手改本窗须先查在位窗口锁。
    for (const fn of ['fireRecallTeleport', 'wormholeTeleportTo', 'teleportNear',
      'teleportToMouse', 'playerNoSpaceTeleport', 'respawnPlayer']) {
      const i = gameSrc.search(new RegExp(`(private |  )${fn}\\(`));
      expect(i, fn).toBeGreaterThan(0);
      const body = gameSrc.slice(i, i + 9300);
      expect(/startCameraTransitionForPlayerTeleport\(/.test(body), `${fn} 未接过渡`).toBe(true);
    }
  });

  it('相机段消费=advanceTeleportLerp 收编 follow（teleportLerp>0 门）', () => {
    expect(/if \(this\.camera\.teleportLerp > 0\) \{\s*\n\s*this\.camera\.advanceTeleportLerp\(/.test(gameSrc)).toBe(true);
  });

  it('old camera.x=p.cx 直跟已在三汇线内退役（残留=回退伪影）', () => {
    for (const fn of ['fireRecallTeleport', 'wormholeTeleportTo', 'teleportNear']) {
      const i = gameSrc.indexOf(`private ${fn}`);
      const body = gameSrc.slice(i, i + 9000);
      expect(/this\.camera\.x = p\.cx/.test(body), `${fn} 仍残留直跟 snap`).toBe(false);
    }
  });

  it('blackFadeCameraTeleport 次级面四件齐（blackFadeIn/gfxQuality/scene 闸/bg+云）', () => {
    const i = gameSrc.indexOf('private blackFadeCameraTeleport');
    const body = gameSrc.slice(i, i + 1400);
    expect(body).toContain('blackFadeIn = 255');
    expect(body).toContain('gfxQuality.value = 1');
    expect(body).toContain('_forceSceneRescan = true');
    expect(body).toContain('instantBGTransition()');
    expect(body).toContain('resetCloudCamAnchor()');
  });

  it('scene 15t 扫描门挂即时重扫闸（UpdateBiomesIfMovedEnoughForBlackFade 等价）', () => {
    expect(gameSrc).toContain('if (this.tickCount % 15 === 0 || this._forceSceneRescan)');
    expect(gameSrc).toContain('this._forceSceneRescan = false');
  });
});
