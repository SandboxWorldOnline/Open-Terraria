// module8 编排粒子 L5 长尾批回归（2026-08-31）：~33 型 Spawn_ 收编 + 生产者接线。
// 锚表：
//   - fx/orchestraFx.ts 追加段 = 各型 Spawn_* 派生（净计数/寿命/尘型断言）
//   - Game.netApplyParticleOrchestra 真派发（Game.prototype 桩,同 l5 批口径）
//   - 生产者接线结构断言（WhipTag/SnapStrike/Player/Arrow/SwingArc/WhipProj/proj1457/Game）
//   - 枚举值域 = Terarria1458 ParticleOrchestraType.cs 序列直译（生成式全表对齐）
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/core/Game';
import { World } from '../src/world/World';
import type { TileStore } from '../src/world/TileStore';
import type { DustColor } from '../src/fx/VanillaDust';
import type { VDust } from '../src/fx/VanillaDust';
import {
  ParticleOrchestraType, writeParticleModule, readParticleModule,
} from '../src/net/syncModules';
import * as syncModulesNS from '../src/net/syncModules';
import { NetModule, NetReader } from '../src/net/protocol';
import {
  terraBladeFx, trueNightsEdgeFx, excaliburFx, trueExcaliburFx,
  deadCellsBarnacleShotFiringFx,
} from '../src/fx/orchestraFx';
import { fadingParticles } from '../src/fx/FadingParticles';

type PartRec = { x: number; y: number; color: string; count: number; opts: Record<string, unknown> };
type DustRec = { type: number; scale: number; ret: VDust; perfect: boolean };

function mkGame(store?: TileStore) {
  const particles: PartRec[] = [];
  const dusts: DustRec[] = [];
  const wavs: Array<{ file: string; vol: number }> = [];
  const files: Array<{ names: string[]; vol: number }> = [];
  const ats: Array<{ name: string }> = [];
  const g = Object.create(Game.prototype) as unknown as Game & Record<string, (...a: never[]) => unknown>;
  g.spawnParticles = ((x: number, y: number, color: string, count: number,
    _speed?: number, opts: Record<string, unknown> = {}) => {
    void x; void y;
    particles.push({ x, y, color, count, opts });
  }) as never;
  g.spawnDust = ((x: number, y: number, w: number, h: number, type: number,
    vx = 0, vy = 0, alpha = 0, color?: DustColor | null, scale = 1, noGravity = false,
    perfect = false) => {
    void w; void h; void vx; void vy;
    const ret: VDust = {
      active: true, x, y, vx, vy, type, scale, alpha, fadeIn: 0,
      noGravity, noLight: false, noLightEmittance: false, color: color ?? null,
      followEnt: null, attractTo: null,
      rotation: 0, fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1,
    };
    dusts.push({ type, scale, ret, perfect });
    return ret;
  }) as never;
  // ★BJ704-R12 P1-1 夹具补：BJ703-B D3 白影改走 game.cloneDust 钩后本桩缺 cloneDust
  // （Game.prototype.cloneDust 对 vanillaDust-undefined 桩返 null）→ 白影不入账
  // （如 StardustPunch/PrincessWeapon d267=4 得 2 恒红）。镜像桩=L5 同款
  // （G2 修 L5 漏 L6,D3 回归清单二漏）。
  g.cloneDust = ((d: VDust) => {
    const c = { ...d } as VDust;
    dusts.push({ type: c.type, scale: c.scale, ret: c, perfect: false });
    return c;
  }) as never;
  g.playSfxWav = ((file: string, vol?: number) => { wavs.push({ file, vol: vol ?? 1 }); }) as never;
  g.playSfxFiles = ((names: string[], vol?: number) => { files.push({ names, vol: vol ?? 1 }); }) as never;
  g.playSfxAt = ((name: string) => { ats.push({ name }); }) as never;
  g.broadcastParticleOrchestra = (() => undefined) as never;
  g.player = { x: 100, y: 200, w: 20, h: 42 } as never;
  g.net = { mySlot: 0, players: new Map() } as never;
  g.world = { store: store ?? new World(160, 200, 30, 'orch-l6-stub').store } as never;
  return { g, particles, dusts, wavs, files, ats };
}

function apply(g: Game, type: number, px = 500, py = 400, mx = 0, my = 0, ui = 0): void {
  Object.getPrototypeOf(g)
    .netApplyParticleOrchestra.call(g, type, {
      posX: px, posY: py, moveX: mx, moveY: my, uniqueInfo: ui, invoker: 0,
    });
}

/** Terarria1458 Terraria.GameContent.Drawing/ParticleOrchestraType.cs 序列直译（0..82） */
const VANILLA_ENUM = [
  'Keybrand', 'FlameWaders', 'StellarTune', 'WallOfFleshGoatMountFlames', 'BlackLightningHit',
  'RainbowRodHit', 'BlackLightningSmall', 'StardustPunch', 'PrincessWeapon', 'PaladinsHammer',
  'NightsEdge', 'SilverBulletSparkle', 'TrueNightsEdge', 'Excalibur', 'TrueExcalibur',
  'TerraBlade', 'ChlorophyteLeafCrystalPassive', 'ChlorophyteLeafCrystalShot', 'BestReforge',
  'PetExchange', 'SlapHand', 'FlyMeal', 'VampireOnFire', 'GasTrap', 'ItemTransfer',
  'ShimmerArrow', 'TownSlimeTransform', 'LoadoutChange', 'ShimmerBlock', 'Digestion',
  'WaffleIron', 'PooFly', 'ShimmerTownNPC', 'ShimmerTownNPCSend', 'DeadCellsMushroomBoiExplosion',
  'DeadCellsDownDashExplosion', 'DeadCellsBarnacleShotFiring', 'BlueLightningSmall',
  'ShadowOrbExplosion', 'UFOLaser', 'DeadCellsBeheadedEffect', 'DeadCellsFlint',
  'DeadCellsBarrelExplosion', 'DeadCellsMushroomBoiTargetFound', 'MoonLordWhipHit',
  'MoonLordWhipEye', 'PlayerVoiceOverrideSound', 'RainbowBoulder1', 'RainbowBoulder2',
  'RainbowBoulder3', 'RainbowBoulder4', 'FakeFish', 'LakeSparkle', 'NatureFly', 'FakeFishJump',
  'ClassyCane', 'MagnetSphereBolt', 'HeatRay', 'ShadowbeamHostile', 'ShadowbeamFriendly',
  'RainbowBoulderPetBounce', 'StormLightning', 'StormlightningWindup', 'PaladinsShieldHit',
  'HeroicisSetSpawnSound', 'BlueLightningSmallLong', 'InScreenDungeonSpawn', 'CattivaHit',
  'PaladinsHammerShockwave', 'SnappingStone', 'HarpyCharm', 'ArcSurge', 'FormatC', 'SporeCloud',
  'SnappingStoneMelee', 'SnappingStoneSummon', 'PhoenixQuiver', 'RedLightningSmall',
  'SeraphNecklace', 'SnappingStoneRecharge', 'PyroclasticStoneRecharge', 'ArmletOfRuinRecharge',
];

describe('L6 长尾批·枚举值域（vanilla 序列直译）+ wire 往返', () => {
  it('enum 全表值 == vanilla 1458 序列', () => {
    // ★TS2475 归零（2026-09-03 顺手,同文件锚同步批）：const enum 值不得进任意表达式
    //  （含 as cast——原 (ParticleOrchestraType as Record..)[name] 自 9-1 syncModules
    //  const enum 化起即 type 红）——动态查表改经 namespace 对象 cast,运行时语义不变
    const enumTable = syncModulesNS as unknown as Record<string, Record<string, number>>;
    VANILLA_ENUM.forEach((name, i) => {
      expect(enumTable.ParticleOrchestraType[name]).toBe(i);
    });
  });
  it('module8 write→read 往返保真（新增长尾型抽样）', () => {
    for (const t of [ParticleOrchestraType.Keybrand, ParticleOrchestraType.BlueLightningSmallLong,
      ParticleOrchestraType.SnappingStoneSummon, ParticleOrchestraType.ItemTransfer,
      ParticleOrchestraType.ArmletOfRuinRecharge]) {
      const wire = writeParticleModule(t, {
        posX: 10.5, posY: -20.25, moveX: 3.5, moveY: -4.5, uniqueInfo: (7 << 24) | 6166, invoker: 2,
      });
      const r0 = new NetReader(wire.subarray(3));
      expect(r0.u16()).toBe(NetModule.Particles);         // 消费 moduleId 后再读载荷
      const r = readParticleModule(r0);
      expect(r.type).toBe(t);
      expect(r.settings.posX).toBeCloseTo(10.5);
      expect(r.settings.uniqueInfo).toBe((7 << 24) | 6166);
      expect(r.settings.invoker).toBe(2);
    }
  });
});

describe('剑刃轨迹族（SwingArc/Slash/Fly 生产锚 → dispatch 消费）', () => {
  it('NightsEdge(10) 六臂紫尘双层', () => {
    const { g, particles } = mkGame();
    apply(g, ParticleOrchestraType.NightsEdge);
    expect(particles.length).toBe(6);
  });
  it('TrueNightsEdge(12) 双臂绿族 + d75 尘锥（每臂 i<2 双掷 × ± 对 = 8,:3205-3217）', () => {
    const { g, particles, dusts } = mkGame();
    apply(g, ParticleOrchestraType.TrueNightsEdge);
    expect(particles.length).toBe(4);
    expect(dusts.filter((d) => d.type === 75).length).toBe(8);
  });
  it('Excalibur(13) 八臂金十字；TrueExcalibur(14) 红粉前置带加成', () => {
    const { g, particles } = mkGame();
    apply(g, ParticleOrchestraType.Excalibur);
    expect(particles.length).toBe(8);
    const r2 = mkGame();
    apply(r2.g, ParticleOrchestraType.TrueExcalibur);
    expect(r2.particles.length).toBe(8 + 4);             // 红粉前置双带 ×2
  });
  it('TerraBlade(15) 三带十粒+d107×8（±臂 scale 对 .8/1.4）', () => {
    const { g, particles, dusts } = mkGame();
    apply(g, ParticleOrchestraType.TerraBlade, 500, 400, 8, 0);
    expect(particles.length).toBe(10);
    const ds = dusts.filter((d) => d.type === 107);
    expect(ds.length).toBe(8);
    expect(ds.every((d) => d.perfect)).toBe(true);        // B3：剑族尘必走 perfect 通道
  });
  it('MoonLordWhipHit(44)/Eye(45)：双色笔触/单残影', () => {
    const a = mkGame();
    apply(a.g, ParticleOrchestraType.MoonLordWhipHit, 100, 100, 4, 0);
    expect(a.particles.length).toBe(2);
    expect(a.dusts.filter((d) => d.type === 229).length).toBeGreaterThanOrEqual(2);
    const b = mkGame();
    apply(b.g, ParticleOrchestraType.MoonLordWhipEye, 100, 100, 20, 0);
    expect(b.particles.length).toBe(1);
    expect(b.particles[0].opts.life).toBe(45);
  });
  it('StardustPunch(7)/PrincessWeapon(8)：sparkle 对+d267', () => {
    for (const t of [ParticleOrchestraType.StardustPunch, ParticleOrchestraType.PrincessWeapon]) {
      const { g, particles, dusts } = mkGame();
      apply(g, t, 300, 300, 2, 0.5);
      // ★oracle 重产（2026-09-03）：sparkle 对已从 spawnParticles 承载 1:1 迁移到
      // spawnDust-prettySparkle 通道（orchestraFx ★迁移注——彩粒 ColorTint A=0 +
      // 白核 (255,255,255,0)、Scale=vector2（白核 ×0.6）、Rotation=π/2、TTL60、
      // APF 双项 角向 f̂×−vector3/60+线性 −vector/60 彩 /30 白核（原版 :3427/:3436））
      // ——两粒 type0 尘即 sparkle 对，旧 particles.length===2 断言随载体退役
      const sparkles = dusts.filter((d) => d.type === 0);
      expect(sparkles.length).toBe(2);
      for (const s of sparkles) {
        expect(s.ret.prettySparkle).toBe(true);
        expect(s.ret.rotation).toBe(Math.PI / 2);
        expect(s.ret.ttl).toBe(60);
      }
      // ★F6 MINOR（2026-09-01）：PrincessWeapon 按 :3402-3408 每彩尘配一 CloneDust 白影
      // 整粒补齐 → d267 2彩+2白=4；★⑥掷序清偿（2026-09-02）：StardustPunch 同构白影补
      // （:3454-3458 与 princessWeapon 全同构,scale=源/2、color 白、零掷）→ 两型均 4
      expect(dusts.filter((d) => d.type === 267).length).toBe(4);
    }
  });
});

describe('雷族（黑雷三味/蓝红小雷共体/长链/蓄势/护壁/ArcSurge 余像）', () => {
  it('BlackLightningHit(4)=7 环', () => {
    const { g, particles } = mkGame();
    apply(g, ParticleOrchestraType.BlackLightningHit);
    expect(particles.length).toBe(7);
  });
  it('BlackLightningSmall(6)=1..2 组拖带', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 24; i++) {
      const { g, particles } = mkGame();
      apply(g, ParticleOrchestraType.BlackLightningSmall, 100, 100, 1, 0);
      seen.add(particles.length);
    }
    expect([...seen].sort()).toEqual([1, 2]);
  });
  it('Blue(37)/Red(77) 小雷共体——packedColor 载荷分色可达且 1..2 组', () => {
    const packed = (255 | (100 << 8) | (155 << 16)) >>> 0;
    const seenColor = new Set<number>();
    const seenCount = new Set<number>();
    for (let i = 0; i < 24; i++) {
      const { g, particles } = mkGame();
      apply(g, ParticleOrchestraType.BlueLightningSmall, 50, 60, 1, 0, packed);
      seenCount.add(particles.length);
      seenColor.add(particles[0].color.startsWith('rgba(255,100,') ? 1 : 2);
    }
    expect([...seenCount].sort()).toEqual([1, 2]);
    expect([...seenColor]).toEqual([1]);                 // packed 档双色同源（value=color×.75 同载荷）
  });
  it('BlueLightningSmallLong(65)：40px 门 + 25px 步进串', () => {
    const short = mkGame();
    apply(short.g, ParticleOrchestraType.BlueLightningSmallLong, 0, 0, 30, 0);
    expect(short.particles.length).toBe(0);               // <40px 单站门
    const long = mkGame();
    apply(long.g, ParticleOrchestraType.BlueLightningSmallLong, 0, 0, 130, 0);
    expect(long.particles.length).toBeGreaterThanOrEqual(5);  // ~5 站复播
  });
  it('StormlightningWindup(62)：主帧条+白影双层同心（组数×2）', () => {
    let doubled = true;
    for (let i = 0; i < 12; i++) {
      const { g, particles } = mkGame();
      apply(g, ParticleOrchestraType.StormlightningWindup);
      if (particles.length % 2 !== 0 || particles.length < 2) doubled = false;
    }
    expect(doubled).toBe(true);
  });
  it('StormLightning(61) 占位注册面：零粒子（折线由 proj1457 原生承担）', () => {
    const { g, particles } = mkGame();
    apply(g, ParticleOrchestraType.StormLightning);
    expect(particles.length).toBe(0);
  });
  it('PaladinsShieldHit(63)：两锚位 d57×4×2', () => {
    const { g, dusts } = mkGame();
    Object.getPrototypeOf(g).netApplyParticleOrchestra.call(g,
      ParticleOrchestraType.PaladinsShieldHit,
      { posX: 0, posY: 0, moveX: 0, moveY: 0, uniqueInfo: 0, invoker: 0 });
    expect(dusts.filter((d) => d.type === 57).length).toBe(8);
  });
  it('ArcSurge(71)：Item15+Item_203 双音与端点闪光（★L′-F1 音档错名定罪）', () => {
    const { g, particles, wavs, files } = mkGame();
    apply(g, ParticleOrchestraType.ArcSurge, 600, 700, 100, 200);
    expect(wavs.some((w) => w.file === 'Item_15')).toBe(true);
    // ★L′-F1（2026-09-02 红队对抗,仲裁成立）：SoundID.cs:822 ArcSurge=LegacySoundStyle(2,203)
    //  =Item 族 → Item_203.wav（盘上 24300B;旧 'arcsurge' 臆造名盘上无档=哑音）——
    //  有效音量=WithVolumePerceived(0.4)^1.6609（LegacySoundStyle.cs:69-74）×volumeScale 0.6
    expect(files.some((f) => f.names[0] === 'Item_203')).toBe(true);
    expect(files.some((f) => f.names[0] === 'Item_203' && Math.abs((f.vol ?? 1) - 0.131) < 0.001)).toBe(true);
    expect(particles.length).toBeGreaterThanOrEqual(3);
  });
});

describe('配饰（SnapStrike 三味脉冲环带+充能三连+弧线引矢家族）', () => {
  it('SnappingStone(69) 音 Item72；Melee(74) pyroclastic+d6；Summon(75) armlet+d172/d211', () => {
    // ★池化清偿（2026-09-03）：环带 spawnParticles 方块近似退役 →
    //  kind0/kind2 FadingParticle 入 fx/FadingParticles.ts 池、kind1 PrettySparkle
    //  入 spawnDust prettySparkle 专用档（逐粒包络 ps* 字段）——断言面随迁
    const before = fadingParticles.count;
    const a = mkGame();
    apply(a.g, ParticleOrchestraType.SnappingStone, 400, 400, 120, 1);
    expect(a.wavs.some((w) => w.file === 'Item_72' && w.vol === 1)).toBe(true);
    expect(a.particles.length).toBe(0);                 // 方块近似退役
    const ring0 = [...fadingParticles.each()].slice(before);
    expect(ring0.length).toBe(2);                       // FadingParticle×2（:610-627）
    for (const f of ring0) {
      expect(f.texKey).toBe('vanilla/Projectile_1121.png');
      expect(f.tintR).toBe(30); expect(f.tintG).toBe(180); expect(f.tintB).toBe(255); expect(f.tintA).toBe(0);
      expect(f.timeToLive).toBe(20);
      expect(f.fadeIn).toBe(0.1); expect(f.fadeOut).toBe(0.1);
      expect(f.delay).toBe(3);                          // Delay=(int)MovementVector.Y×3,Y=1
      const ms = Math.min(0.12, 120 / 256);
      expect(f.scaleVelX).toBeCloseTo((6 * ms) / 20, 12);
      expect(f.scaleAccX).toBeCloseTo(-((6 * ms) / 20) / 20, 12);
    }
    const b = mkGame();
    apply(b.g, ParticleOrchestraType.SnappingStoneMelee, 400, 400, 120, 1);
    expect(b.wavs.some((w) => w.file === 'pyroclastic_stone' && w.vol === 0.5)).toBe(true);
    expect(b.particles.length).toBe(0);
    // 红/金两粒 PrettySparkle → spawnDust prettySparkle 档（ret 字段逐值断言）
    const rings = b.dusts.filter((d) => d.ret.prettySparkle === true);
    expect(rings.length).toBe(2);
    const red = rings[0].ret, gold = rings[1].ret;
    // ★R3 ③（2026-09-03）oracle 重产：ColorTint A=原版字节量化值（红 .5f→127/:665、
    //  金 1f→255/:666）——A 进 color2.A dst 衰减公式（PrettySparkleParticle.cs:66-67）
    expect(red.color).toEqual({ r: 255, g: 0, b: 0, a: 127 });
    expect(gold.color).toEqual({ r: 255, g: 242, b: 0, a: 255 });
    expect(red.psAdditive).toBe(0.35);                     // AdditiveAmount 红粒独写（:681）
    expect(gold.psAdditive).toBeUndefined();               // 金循环 :698-721 无写入=缺省 1f
    for (const r of [red, gold]) {
      expect(r.ttl).toBe(30);                               // TimeToLive=num（:677/:706）
      expect(r.psFadeInEnd).toBe(15); expect(r.psFadeOutStart).toBe(15); expect(r.psFadeOutEnd).toBe(30);
      expect(r.psFadeInNorm).toBe(5e-6); expect(r.psFadeOutNorm).toBe(0.95);
      expect(r.psDrawVert).toBe(false);                     // DrawVerticalAxis=false（:686/:713）
      expect(r.psAge).toBe(0);
      expect(r.scaleY).toBeCloseTo(r === red ? 2.2 * 1.5 : 1.4 * 1.5, 12);
      expect(r.scaleX).toBeCloseTo(r === red ? 8.8 * 1.5 : 5.6 * 1.5, 12);
      expect(r.scax).toBeCloseTo(-4 / 30, 12);              // ScaleAcceleration=vector/num（:679/:708）
      expect(r.scay).toBe(0);
      expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(21, 12);   // 速度幅=dir×14×1.5（:677/:706+恒真支）
      expect(Math.hypot(r.ax!, r.ay!)).toBeCloseTo(14 / 30, 12);  // APF=−Velocity/num【赋值序在 ×1.5 前】
      expect(r.ax! / r.vx).toBeLessThan(0);                 // 减速弧（方向相反）
    }
    expect(red.scaleX! / red.scaleY!).toBeCloseTo(8.8 / 2.2, 12);
    expect(b.dusts.filter((d) => d.type === 6).length).toBe(4);          // ★⑨批重构（2026-09-03）：d6 对只挂金带内（:722-730 i 循环 ×2,每轮 ± 金臂各一粒）
    const before2 = fadingParticles.count;
    const c = mkGame();
    apply(c.g, ParticleOrchestraType.SnappingStoneSummon, 400, 400, 120, 2);
    expect(c.wavs.some((w) => w.file === 'armlet_of_ruin')).toBe(true);
    expect(c.dusts.filter((d) => d.type === 172).length).toBe(15);
    expect(c.dusts.filter((d) => d.type === 211).length).toBe(8);
    const ring2 = [...fadingParticles.each()].slice(before2);
    expect(ring2.length).toBe(3);                       // 1132 圈×2 + Extra_34 旋星×1
    expect(ring2.filter((f) => f.texKey === 'vanilla/Projectile_1132.png').length).toBe(2);
    expect(ring2.filter((f) => f.texKey === 'vanilla/Extra_34.png').length).toBe(1);
    for (const f of ring2) {
      expect(f.tintR).toBe(90); expect(f.tintG).toBe(110); expect(f.tintB).toBe(255); expect(f.tintA).toBe(90);
      expect(f.timeToLive).toBe(20);
      expect(f.delay).toBe(6);                          // Y=2 → Delay=Y×3
      const sv = (9 * 0.12) / 20;
      expect(f.scaleVelX).toBeCloseTo(sv, 12);
      expect(f.scaleAccX).toBeCloseTo(-sv / 20, 12);
      expect(f.fadeIn).toBe(0.1);
    }
    expect(ring2[0].fadeOut).toBe(0.3);                 // :759
    expect(ring2[2].fadeOut).toBe(0.5);                 // :779
  });
  it('充能三连(79/80/81)：invoker 锚位尘链（noGravity/noLight/followPlayer 面）', () => {
    const snap = mkGame();
    apply(snap.g, ParticleOrchestraType.SnappingStoneRecharge);
    expect(snap.dusts.length).toBe(10);
    expect(snap.dusts.every((d) => d.ret.noGravity && d.ret.noLight && d.ret.followPlayer)).toBe(true);
    expect(snap.dusts[0].ret.y).toBe(200 + 42 / 2);       // player.y+h/2（stub y=200）
    const pyro = mkGame();
    apply(pyro.g, ParticleOrchestraType.PyroclasticStoneRecharge);
    expect(pyro.dusts.length).toBe(15);
    expect(pyro.dusts.every((d) => d.scale === 1.5)).toBe(true);
    const armlet = mkGame();
    apply(armlet.g, ParticleOrchestraType.ArmletOfRuinRecharge);
    expect(armlet.dusts.length).toBe(10);
    expect(armlet.dusts[0].ret.alpha).toBe(60);
  });
  it('HarpyCharm(70)/PhoenixQuiver(76)/SeraphNecklace(78) 分味：外抛组 4|8 与音差', () => {
    const h = mkGame();
    apply(h.g, ParticleOrchestraType.HarpyCharm, 100, 100, 6, 0);
    expect(h.wavs.some((w) => w.file === 'Item_39')).toBe(true);
    expect(h.particles.length).toBe(4 + 3 + 1);
    const p = mkGame();
    apply(p.g, ParticleOrchestraType.PhoenixQuiver, 100, 100, 6, 0);
    expect(p.wavs.some((w) => w.file === 'Item_20')).toBe(true);
    expect(p.particles.length).toBe(8 + 6 + 1);           // up×2 升格
    const s2 = mkGame();
    apply(s2.g, ParticleOrchestraType.SeraphNecklace, 100, 100, 6, 0);
    expect(s2.particles.length).toBe(15);
  });
});

describe('杂项（Keybrand/GasTrap/Shimmer/TownSlime/Cattiva/RB 族/BestReforge/银箭/微光箭/行进尘束/环境件）', () => {
  it('Keybrand(0)：三带金橙+蓝白扩点', () => {
    const { g, particles } = mkGame();
    apply(g, ParticleOrchestraType.Keybrand);
    expect(particles.length).toBe(3 + 3 + 1);           // ★δB9 第二带=3 片（num2=3 循环）
  });
  it('GasTrap(23)：Item16 音+外环12/内环10 绿雾', () => {
    const { g, particles, wavs } = mkGame();
    apply(g, ParticleOrchestraType.GasTrap, 100, 100, 2, 0);
    expect(wavs.some((w) => w.file === 'Item_16')).toBe(true);
    expect(particles.length).toBe(22);
  });
  it('ShimmerArrow(25)：两轮十六 sparkles+首轮 d306×8', () => {
    const { g, particles, dusts } = mkGame();
    apply(g, ParticleOrchestraType.ShimmerArrow);
    expect(particles.length).toBe(16);
    expect(dusts.filter((d) => d.type === 306).length).toBe(8);
  });
  it('ShimmerBlock(28)：uniqueInfo/1000 缩放档（兜底 1）', () => {
    const { g, particles } = mkGame();
    apply(g, ParticleOrchestraType.ShimmerBlock, 100, 100, 0.8, 0.1, 2500);
    expect(particles.length).toBe(1);
    expect(particles[0].opts.size).toBeCloseTo(2.5 * 1.2);
    const f2 = mkGame();
    apply(f2.g, ParticleOrchestraType.ShimmerBlock, 100, 100, 0, 0, 0);
    expect(f2.particles[0].opts.size).toBeCloseTo(1.2);
  });
  it('TownSlimeTransform(26)：书呆 d4×60/铜 d43×40/长 d43×30+升腾', () => {
    const n = mkGame();
    apply(n.g, ParticleOrchestraType.TownSlimeTransform, 100, 100, 0, 0, 0);
    expect(n.dusts.filter((d) => d.type === 4).length).toBe(60);
    const c = mkGame();
    apply(c.g, ParticleOrchestraType.TownSlimeTransform, 100, 100, 0, 0, 1);
    expect(c.dusts.filter((d) => d.type === 43).length).toBe(40);
    const e = mkGame();
    apply(e.g, ParticleOrchestraType.TownSlimeTransform, 100, 100, 0, 0, 2);
    expect(e.dusts.filter((d) => d.type === 43).length).toBe(30);
    expect(e.particles.length).toBe(8);                   // gore61-63 升腾近似
  });
  it('CattivaHit(67)：六芒簇金橙', () => {
    const { g, particles } = mkGame();
    apply(g, ParticleOrchestraType.CattivaHit);
    expect(particles.length).toBe(6);
    // ★⑨lifeExact 清偿（2026-09-03）：TTL=num5=16f 定值（:3774→TimeToLive :3791）——
    //  旧 life:16 抖动档退役,opts 键随改
    expect(particles.every((p) => p.opts.lifeExact === 16)).toBe(true);
  });
  it('RainbowBoulder 族：RB1 环列/RB2 双星/RB4 带音/pet 无音', () => {
    const b1 = mkGame();
    apply(b1.g, ParticleOrchestraType.RainbowBoulder1);
    expect(b1.particles.length).toBeGreaterThanOrEqual(12);
    expect(b1.dusts.filter((d) => d.type === 66).length).toBe(21);
    const b2 = mkGame();
    apply(b2.g, ParticleOrchestraType.RainbowBoulder2, 100, 100, 3, 0);
    expect(b2.particles.length).toBe(2);
    const b4 = mkGame();
    apply(b4.g, ParticleOrchestraType.RainbowBoulder4, 100, 100, 5, 0);
    expect(b4.wavs.some((w) => w.file === 'rainbow_boulder')).toBe(true);
    expect(b4.dusts.filter((d) => d.type === 66).length).toBe(14);
    const pet = mkGame();
    apply(pet.g, ParticleOrchestraType.RainbowBoulderPetBounce, 100, 100, 5, 0);
    expect(pet.wavs.length).toBe(0);                      // pet 味省 RainbowBoulder 音
    expect(pet.dusts.filter((d) => d.type === 66).length).toBe(8);
  });
  it('BestReforge(18)：八粒上旋 grav .1635/life 60', () => {
    const { g, particles } = mkGame();
    apply(g, ParticleOrchestraType.BestReforge);
    expect(particles.length).toBe(8);
    expect(particles.every((p) => p.opts.grav === 0.1635 && p.opts.life === 60)).toBe(true);
  });
  it('UFOLaser/MagnetSphereBolt/HeatRay 行进尘束（160 二选色/160 四层/162 四层）', () => {
    const ufo = mkGame();
    apply(ufo.g, ParticleOrchestraType.UFOLaser, 200, 200, 120, 200, 8000);
    expect(ufo.dusts.length).toBeGreaterThan(0);
    expect(new Set(ufo.dusts.map((d) => d.type))).toEqual(new Set([160]));
    const mag = mkGame();
    apply(mag.g, ParticleOrchestraType.MagnetSphereBolt, 200, 200, 0, 120, 8000);
    expect(mag.dusts.length).toBeGreaterThan(10);         // 每站四层回拖
    expect(new Set(mag.dusts.map((d) => d.type))).toEqual(new Set([160]));
    const heat = mkGame();
    apply(heat.g, ParticleOrchestraType.HeatRay, 200, 200, 120, 0, 4000);
    expect(new Set(heat.dusts.map((d) => d.type))).toEqual(new Set([162]));
  });
  it('ItemTransfer(24)：flags 随机起点位分段', () => {
    const plain = mkGame();
    apply(plain.g, ParticleOrchestraType.ItemTransfer, 200, 200, 80, 40, 71);
    expect(plain.particles.length).toBe(1);
    const rand = mkGame();
    apply(rand.g, ParticleOrchestraType.ItemTransfer, 200, 200, 80, 40, 71 | (1 << 24));
    expect(rand.particles.length).toBe(2);
  });
  it('PooFly(31)/InScreenDungeonSpawn(66)/NatureFly(53)/LakeSparkle(52) 环境件', () => {
    const poo = mkGame();
    apply(poo.g, ParticleOrchestraType.PooFly);
    expect(poo.particles.length).toBe(1);
    expect(poo.particles[0].opts.life).toBe(300);
    const dg = mkGame();
    apply(dg.g, ParticleOrchestraType.InScreenDungeonSpawn, 400, 400, 28, 42, 181);
    expect(dg.particles.length).toBeGreaterThanOrEqual(2);
    expect(dg.particles.length).toBeLessThanOrEqual(4);
    const nf = mkGame();
    apply(nf.g, ParticleOrchestraType.NatureFly);
    expect(nf.particles.length).toBe(1);
    expect(nf.particles[0].color.includes(',0.67)')).toBe(true);   // α170 字节化
    const ls = mkGame();
    apply(ls.g, ParticleOrchestraType.LakeSparkle, 100, 100, 16, 0);
    expect(ls.particles.length).toBe(1);
    // ★F2 积分步翻新：初速零 + 加速度 (move/60)/TTL——旧判词 vx=moveX(16) 原值
    // （火箭形）退役；lifeExact 与 life 同值（TTL 耦合参数不抖动）
    expect(ls.particles[0].opts.vx).toBe(0);
    expect(ls.particles[0].opts.vy).toBe(0);
    expect(ls.particles[0].opts.ay).toBe(0);
    expect(ls.particles[0].opts.ax)
      .toBeCloseTo(16 / 60 / (ls.particles[0].opts.lifeExact as number), 12);
    expect(ls.particles[0].opts.lifeExact).toBeGreaterThanOrEqual(50);
    expect(ls.particles[0].opts.lifeExact).toBeLessThanOrEqual(140);
  });
  it('★F5 BarnacleShotFiring d2 scale 边界：Next(-5,5) 上值 4 → 1.24（旧 ×11 上探 1.25）', () => {
    // 统计判别（对 rng 消费序稳健——rot() 助手 ★F6 清偿后每调用 2 掷）：
    // ×10 判别式 scale ∈ [1.15,1.24]；旧 ×11 在 40 轮×15 粒≈600 掷里
    // P(全躲开 1.25 档 rng∈[10/11,1)) ≈ 3e-28,漏检不可能
    let seed = 7;
    const rng = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >>> 8) / 0x800000;
    };
    let d2Count = 0;
    for (let k = 0; k < 40; k++) {
      const g2 = mkGame();
      deadCellsBarnacleShotFiringFx(g2.g as never, 100, 100, 1, 0, rng);
      for (const d of g2.dusts) {
        if (d.type !== 2) continue;
        d2Count++;
        expect(d.scale).toBeGreaterThanOrEqual(1.15);
        expect(d.scale).toBeLessThanOrEqual(1.24);
      }
      seed = (seed + 7919) & 0x7fffffff;
    }
    expect(d2Count).toBe(600);
  });
  it('HeroicisSetSpawnSound(64)=rainbow_boulder 音；PlayerVoiceOverrideSound(46)=变声字分派', () => {
    const he = mkGame();
    apply(he.g, ParticleOrchestraType.HeroicisSetSpawnSound, 100, 100);
    expect(he.wavs.some((w) => w.file === 'rainbow_boulder')).toBe(true);
    // ★2026-09-01 变声字落账：uniqueInfo=voiceSlot 直通 player/PlayerVoice.hurtVoicePlan
    // （Spawn_ :2870-2885 临时置 voiceOverride 后 PlayHurtSound 的仓内等价口）——
    // 19 谁皮垫 → Item_16；3（DST 档未移植）→ 落 variant 缺省男声库
    const pv = mkGame();
    apply(pv.g, ParticleOrchestraType.PlayerVoiceOverrideSound, 100, 100, 0, 0, 19);
    expect(pv.wavs.some((w) => w.file === 'Item_16')).toBe(true);
    const pv2 = mkGame();
    apply(pv2.g, ParticleOrchestraType.PlayerVoiceOverrideSound, 100, 100, 0, 0, 3);
    expect(pv2.wavs.some((w) => /^Player_Hit_/.test(w.file))).toBe(true);
  });
  it('FormatC(72)：金芒双层+d213 金尘十二', () => {
    const { g, particles, dusts } = mkGame();
    apply(g, ParticleOrchestraType.FormatC, 300, 300, 6, -2);
    expect(particles.length).toBe(2);
    expect(dusts.filter((d) => d.type === 213).length).toBe(12);
  });
  it('SilverBulletSparkle/ShimmerArrow/弧线引矢 Kill 支：producer 结构面（clientOnly:true 本地直驱）', () => {
    const src = readFileSync('src/entities/Arrow.ts', 'utf8');
    expect(src).toContain('silverBulletSparkleFx(game, this.cx, this.cy, 0, 0)');
    expect(src).toContain('shimmerArrowFx(game, this.cx, this.cy)');
    expect(src).toContain('harpyCharmFamilyFx(');
    expect(src).toContain('ParticleOrchestraType.SeraphNecklace');
  });
});

describe('生产者接线结构断言（module8 上行/clientOnly 直驱按原 netMode 面）', () => {
  function has(file: string, needle: string): boolean {
    return readFileSync(file, 'utf8').includes(needle);
  }
  it('WhipTag：DarkHarvest/ElectricEel/SwordWhip 三 tag 收编+上行', () => {
    expect(has('src/entities/WhipTag.ts', 'blackLightningHitFx(game, ctx.hx, ctx.hy)'));
    expect(has('src/entities/WhipTag.ts', 'ParticleOrchestraType.BlackLightningHit'));
    expect(has('src/entities/WhipTag.ts', 'blueLightningSmallLongFx(g, px, py, mvEx, mvEy)'));
    expect(has('src/entities/WhipTag.ts', 'trueExcaliburFx(game, ctx.hx, ctx.hy)'));
    expect(has('src/entities/WhipTag.ts', "spawnParticles?.(px, py, '#60C8FF'")).toBe(false);  // 占位退役
  });
  it('SnapStrike：三味环带+广播与 kind 分派', () => {
    expect(has('src/stats/SnapStrike.ts', 'snappingStoneRingFx(game, kind, t.cx, t.cy, msX, strikes)'));
    expect(has('src/stats/SnapStrike.ts', 'ParticleOrchestraType.SnappingStoneSummon'));
    expect(has('src/stats/SnapStrike.ts', 'export function snapStrikeDust'));
    // ★F3（2026-09-01）：尘段载荷直用（收端禁再掷/再除）——收端 |X|/2、尘段
    //   (0.3+1.4r) 复掷两式均退役；本地 msX 与广播/环带三面共吃同一载荷
    expect(has('src/core/Game.ts', 'snapStrikeDust(this, kind, s.posX, s.posY, s.moveX);')).toBe(true);
    expect(has('src/core/Game.ts', 'Math.abs(s.moveX) / 2')).toBe(false);
    expect(has('src/stats/SnapStrike.ts', 'snapStrikeDust(game, kind, t.cx, t.cy, msX);')).toBe(true);
    expect(has('src/stats/SnapStrike.ts', 'const num = Math.min(0.12, mvX / 256);')).toBe(true);
    expect(has('src/stats/SnapStrike.ts', '0.3 + 1.4 * rand()')).toBe(false);
    // ★W-A1（2026-09-03）：本/远端统一"producer 传原值/消费端按原文换算"——环带收端
    //   预除 256 退役（曾与本地传原值分叉;kind0 钳(X/256,.12)/kind2 num=1f 常量两式
    //   已下沉 orchestraFx 内按原文逐 kind 消费）
    expect(has('src/core/Game.ts',
      'snappingStoneRingFx(this, kind, s.posX, s.posY, s.moveX, Math.max(0, s.moveY | 0));')).toBe(true);
    expect(has('src/core/Game.ts', 's.moveX / 256')).toBe(false);
    expect(has('src/fx/orchestraFx.ts', 'const ms = Math.min(0.12, mvX / 256);')).toBe(true);
    // ★W-A2：受击者拍=完整 Spawn_ 本地面（音+环带+尘,Projectile.cs:14431-37 clientOnly:false）
    expect(has('src/stats/SnapStrike.ts',
      'snappingStoneRingFx(game, kind, ctx.victimBox.cx, ctx.victimBox.cy, vh, 0);')).toBe(true);
  });
  it('★F5 Next(a,b) 上界开区间 off-by-one 三站（Next(-20,40)=60 值/Next(-5,5)=10 值）', () => {
    expect(has('src/entities/Arrow.ts', 'Math.floor(Math.random() * 60) - 20')).toBe(true);
    // 窄针：Arrow.ts:3811 另有合法 Math.random()*61（Next(60,121) 气泡档），勿宽匹配
    expect(has('src/entities/Arrow.ts', 'Math.floor(Math.random() * 61) - 20')).toBe(false);
    expect(has('src/entities/Arrow.ts', 'Math.floor(Math.random() * 10) - 5')).toBe(true);
    expect(has('src/fx/orchestraFx.ts', 'Math.floor(rng() * 10 - 5)')).toBe(true);
    expect(has('src/fx/orchestraFx.ts', 'rng() * 11 - 5')).toBe(false);
  });
  it('★F3 收端分派：SnappingStone 载荷 X 直入尘段 num=钳(X/256,.12)（禁 |X|/2 再掷）', () => {
    const { g } = mkGame();
    const made: Array<{ type: number; vx: number; noGravity: boolean }> = [];
    (g as unknown as Record<string, unknown>).vanillaDust = {
      spawn: (_x: number, _y: number, _w: number, _h: number, type: number) => {
        const d = { type, vx: 1, vy: 1, scale: 0, fadeIn: 9,
          noGravity: false, noLight: false, noLightEmittance: false };
        made.push(d);
        return d;
      },
    };
    apply(g, ParticleOrchestraType.SnappingStone, 500, 400, 16, 1);
    expect(made.length).toBe(20);
    const num = Math.min(0.12, 16 / 256);
    for (const d of made) {
      const f = d.type === 226 ? (d.noGravity ? 0.5 : 0.25) : 1;
      expect(d.vx).toBeCloseTo(64 * num * f, 12);
      expect([226, 15]).toContain(d.type);
    }
  });
  it('Player：充能三连改走收编本体+上行', () => {
    expect(has('src/entities/Player.ts', 'snappingStoneRechargeFx(game, rk, this.x, this.y, this.w, this.h)'));
    expect(has('src/entities/Player.ts', 'ParticleOrchestraType.PyroclasticStoneRecharge'));
  });
  it('SwingArc/WhipProj/proj1457：剑刃轨迹族+月主鞭+导通链电', () => {
    // ★δB1：MovementVector=弹体速度载荷（Projectile.cs:13015 settings.MovementVector=velocity）
    expect(has('src/entities/SwingArc.ts', 'swordTrailOrchestra(game, this.projId, e, Math.sign(this.ai0) || 1, 0)'));
    expect(has('src/entities/SwingArc.ts', 'swordTrailOrchestra(game, 973, e, this.vx, this.vy)'));
    expect(has('src/entities/SwingArc.ts', 'swordTrailOrchestra(game, 972, e, this.vx, this.vy)'));
    expect(has('src/entities/WhipProj.ts', 'moonLordWhipHitFx(game, hxP, hyP, mX, mY)'));
    expect(has('src/entities/WhipProj.ts', 'ParticleOrchestraType.MoonLordWhipHit'));
    expect(has('src/entities/proj1457.ts', 'blueLightningSmallLongFx(game, pxL.x, pxL.y, mvLx, mvLy)'));
  });
  it('Game：Keybrand 近战接线 + QuickStack ItemTransfer 广播（Q-F3/F4/F5 形翻新：端点=箱锚像素面、PlayerToChest 四旗、逐帧出站）', () => {
    expect(has('src/core/Game.ts', 'keybrandFx(this, kbX, kbY)'));
    expect(has('src/core/Game.ts', 'this.broadcastParticleOrchestra(ParticleOrchestraType.Keybrand, kbX, kbY)'));
    // Q-F5 单帧退役 → emitItemTransferFx 逐帧出站（Q-F4 四旗随载荷,Q-F3 端点像素面）
    expect(has('src/core/Game.ts',
      'itemTransferFx(this, sx, sy, ex, ey, vid, ITEM_TRANSFER_PLAYER_TO_CHEST_BITS >> 24)'));
    expect(has('src/core/Game.ts',
      'this.broadcastParticleOrchestra(ParticleOrchestraType.ItemTransfer, sx, sy,\n      ex - sx, ey - sy, (vid & 0xffffff) | ITEM_TRANSFER_PLAYER_TO_CHEST_BITS)'));
    expect(has('src/core/Game.ts', 'ParticleOrchestraType.ItemTransfer'));
  });
  it('dispatch 分支覆盖终态清单；叶绿两型归代理域；PaladinsHammer=vanilla 孤儿登记', () => {
    const src = readFileSync('src/net/syncModules.ts', 'utf8');
    expect(src).toContain('Keybrand = 0');
    expect(src).toContain('ArmletOfRuinRecharge = 81');
    expect(src).toContain('PaladinsHammer = 9');
  });
});

// ==================== 剑族尘锥 B3 回归（RotatedBy 臂向量真式 + perfect 通道） ====================
//
// 原文统一式 = Dust.NewDustPerfect(PositionInWorld, TYPE, 臂向量.RotatedBy(
// NextFloatDirection()×τ×0.025) × NextFloat())——TerraBlade :2788/:2791、Excalibur
// :2850/:2853、TrueExcalibur :3012/:3015、TrueNightsEdge :3211/:3214（1457↔1458 同文）。
// 速率域 [0,|臂|=4]px/t、方向贴臂 ±0.157rad；旧直译 side*(rng*2−1)*k*rng 各向同性
// 标量抖动慢 ~50 倍且不贴臂（红队 B3 finding 定罪面）。池语义见 wing-visuals 的
// NewDustPerfect describe（position/velocity 完整覆写绕开烟雾族特例）。

const TAU = Math.PI * 2;
const JMAX = TAU * 0.025;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 贴臂判定：速度向量到 ±臂向量的最小夹角 */
function angularDeviation(vx: number, vy: number, ax: number, ay: number): number {
  return Math.min(
    Math.abs(Math.atan2(vx * ay - vy * ax, vx * ax + vy * ay)),
    Math.abs(Math.atan2(vy * ax - vx * ay, -(vx * ax) - vy * ay)),
  );
}

describe('剑族尘锥 B3 回归（速率 ≤4px/t 贴臂向 + perfect 旗声明）', () => {
  it('TerraBlade d107×8：速率域[0,4]、方向贴臂、scale 对(.8|1.4)、全走 perfect', () => {
    let maxSpeedSeen = 0;
    for (let seed = 1; seed <= 32; seed++) {
      const { g, dusts } = mkGame();
      terraBladeFx(g, 500, 400, -0.6, 0.8, mulberry32(seed));
      const ds = dusts.filter((d) => d.type === 107);
      expect(ds.length).toBe(8);
      const base = Math.atan2(0.8, -0.6) + Math.PI / 2;
      ds.forEach((d, i) => {
        const arm = base + Math.PI / 2 * Math.floor(i / 2);   // 发射序=臂×(±对)
        maxSpeedSeen = Math.max(maxSpeedSeen, Math.hypot(d.ret.vx, d.ret.vy));
        expect(Math.hypot(d.ret.vx, d.ret.vy)).toBeLessThanOrEqual(4 + 1e-9);
        if (Math.hypot(d.ret.vx, d.ret.vy) > 1e-9) {
          expect(angularDeviation(d.ret.vx, d.ret.vy, Math.cos(arm), Math.sin(arm)))
            .toBeLessThanOrEqual(JMAX + 1e-9);
        }
        expect(d.perfect).toBe(true);
      });
      expect(ds.filter((d) => d.ret.scale === 0.8).length).toBe(4);   // +臂 :2788
      expect(ds.filter((d) => d.ret.scale === 1.4).length).toBe(4);   // −臂 :2791
    }
    expect(maxSpeedSeen).toBeGreaterThan(3.5);          // 满速可达（旧式帽 ~0.16 永不到）
  });

  it('TrueNightsEdge d75×8：每臂两掷双对、速率域[0,4]、方向贴臂、全走 perfect', () => {
    for (let seed = 1; seed <= 32; seed++) {
      const { g, dusts } = mkGame();
      trueNightsEdgeFx(g, 300, 300, mulberry32(seed));
      const ds = dusts.filter((d) => d.type === 75);
      expect(ds.length).toBe(8);
      ds.forEach((d, i) => {
        const arm = Math.PI / 4 + Math.PI / 2 * Math.floor(i / 4);   // 双臂 {π/4, 3π/4}
        expect(Math.hypot(d.ret.vx, d.ret.vy)).toBeLessThanOrEqual(4 + 1e-9);
        if (Math.hypot(d.ret.vx, d.ret.vy) > 1e-9) {
          expect(angularDeviation(d.ret.vx, d.ret.vy, Math.cos(arm), Math.sin(arm)))
            .toBeLessThanOrEqual(JMAX + 1e-9);
        }
        expect(d.ret.scale).toBe(1.4);
        expect(d.perfect).toBe(true);
      });
    }
  });

  it('Excalibur d169 仅第二黄带无门 ×8（数量核对修正：旧直译两带全挂 ×16）', () => {
    for (let seed = 1; seed <= 32; seed++) {
      const { g, dusts } = mkGame();
      excaliburFx(g, 120, 120, mulberry32(seed));
      const ds = dusts.filter((d) => d.type === 169);
      expect(ds.length).toBe(8);                        // 4 臂 × ±对，无门
      expect(ds.every((d) => d.perfect)).toBe(true);
      // 臂向 = τ/4 网格（基角 0,步 π/2）——方向最小角偏离 ≤ JMAX
      ds.forEach((d) => {
        if (Math.hypot(d.ret.vx, d.ret.vy) > 1e-9) {
          const dev = [0, 1, 2, 3].map((k) => angularDeviation(
            d.ret.vx, d.ret.vy, Math.cos(Math.PI / 2 * k), Math.sin(Math.PI / 2 * k),
          ));
          expect(Math.min(...dev)).toBeLessThanOrEqual(JMAX + 1e-9);
        }
      });
    }
  });

  it('TrueExcalibur：前置带 d242 per-arm 门(≤4)+黄带 d169 门(≤16)，sparkle 计数不变', () => {
    let seenD242 = new Set<number>();
    let seenD169Max = 0;
    for (let seed = 1; seed <= 64; seed++) {
      const { g, particles, dusts } = mkGame();
      trueExcaliburFx(g, 60, 70, mulberry32(seed));
      expect(particles.length).toBe(12);                // 红粉前置 4 + 金黄四臂 8
      const c242 = dusts.filter((d) => d.type === 242).length;
      const c169 = dusts.filter((d) => d.type === 169).length;
      expect(c242 % 2).toBe(0);
      expect(c242).toBeLessThanOrEqual(4);              // 2 臂 × ±对
      expect(c169 % 2).toBe(0);
      expect(c169).toBeLessThanOrEqual(16);             // 4 臂 × ±对
      expect(dusts.every((d) => d.perfect)).toBe(true);
      seenD242.add(c242);
      seenD169Max = Math.max(seenD169Max, c169);
    }
    expect([...seenD242].some((n) => n > 0)).toBe(true);      // 50% 门可放行
    expect(seenD242.has(4) || seenD242.has(0)).toBe(true);    // 两态可达
    expect(seenD169Max).toBeGreaterThan(0);
  });
});
