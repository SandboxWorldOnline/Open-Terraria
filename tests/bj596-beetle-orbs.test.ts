// BJ596 甲虫护甲 orb 子系统整缺清偿（BJ595 套装视效普查登记大面 B1/B2）。
//
// ★定谳（原版 1457 亲读）——
//   面1 物理（UpdateArmorSets_Always_Beetle,Player.cs:16556-16612,经 UpdateArmorSets
//     :16419-16427 每拍调度,Always_Beetle 先于 Always_Solar）：
//     · 门 = beetleDefense||beetleOffense（:16558）——双套不在身整段早退
//       （beetleCounter=0f :16560 在 BeetleMeter 计数域,已销案 B3）;pos/vel 冻结不归零。
//     · 3 帧条动画每 tick 步进 0→1→2 循环（:16563-16571,frameCounter>=1 门恒真=
//       反编译残迹式）;未用槽位（i=orbs..3）归零（:16573-16577）。
//     · 每 orb（j<beetleOrbs,:16578-16612）：pos+=vel → vel+=Next(-100,101)×0.005
//       双轴（±0.5/t² 随机游走）→ 外环 |pos|>100:弹簧目标 −pos/|pos|×20、
//       vel=(vel×9+目标)/10 → 内环 |pos|>30:目标半径 10、混合 19/20 → |vel|>2:
//       vel×0.9（渐近限速非硬钳）→ pos−=playerVel×0.25（移动拖尾）。
//     · 球数 = beetleOrbs（buff 95/96/97 壳族→1/2/3、98/99/100 猛攻族→1/2/3,
//       :10430-10526 同步;计数域=B3 销案面 BeetleMeter）——充能档视觉差 = orb 数,
//       两族各 3 档上限（任务估计"2/3/4"系误,原版 3 槽数组 :947/:949 钉死 3）。
//     · 无 stealth/wet/潜行门（1457 全式亲读:门串只有旗对）;死亡相 Player.Update
//       `if (dead) {UpdateDead(); return;}`（:24943-24949）先于 UpdateArmorSets
//       （:25882）→ 物理冻结+不绘。
//   面2 绘制（DrawPlayer_37_BeetleBuff,PlayerDrawLayers.cs:4130-4155;层序
//     LegacyPlayerRenderer.cs:255-257 = 36_CTG 后/38_Eyebrella 前,手持物(27)之上）：
//     · 门 = (beetleOffense||beetleDefense)==false || shadow!=0 → 早退（:4131-4133）。
//     · 每 orb：5 残影（j=0..4:偏移 −vel×j、色=colorArmorBody×(0.5−j·0.1) R/G/B/A
//       四通道字节截断乘）+ 本体（全色零偏移,最后入 DrawDataCache=画最上）。
//     · colorArmorBody = GetImmuneAlphaPure(Lighting.GetColorClamped(玩家中心,White),0)
//       （PlayerDrawSet.cs:452）=光照色×(255−immuneAlpha)/255——GetImmuneAlphaPure
//       无 >125 截断门（:54834-54842,与本体硬闪烁 GetImmuneAlpha :54822 有别=平滑淡出）
//       ×(1−shimmerTransparency)。
//     · 帧条源矩形 (0, H/3·frame+1, W, H/3−2)（:4151,C# 整除）;origin=(W/2, H/6)
//       （:4153,整除）;scale 1;playerEffect 朝向翻转;贴图 TextureAssets.Beetle
//       （本仓 vanilla/BeetleOrb.png,26×68 3 帧竖条,BJ595 判资产在库）。
//   本仓落刀：物理 = Player.fixedUpdateBody 盾球轨道块之前（Always_Beetle<Always_Solar
//     位次对映,:16421-16423）+ 纯函数 stepBeetleOrb;绘制 = Renderer.drawPlayer 眼球伞
//     云盖块之前（37<38 层序对映,手持物之上）+ 参数面单源 beetleOrbDrawPlan;色乘走
//     实体窗 compositeLight 光乘域（RGB×k·A×k ≙ α_eff=k·immK 不透明底线性等价）。
//   销案面（本套件不重查,B3 域）：蓄能梯子/受击减球/buff 图标 = BeetleMeter
//     （tests/aura-beetle-buff.test.ts + bj595 census B3）。
//   原版壳硬化受击面（顺手全查）：Hurt :38607-38623 = 伤×(1−0.15·orbs)+orbs--+
//     重钉 buff+counter=0——无专属尘/音效支（ApplyArmorSoundAndDustChanges :38452
//     只含 boneArmor/frostArmor 旗）→ 原版本就静默,无缺面可登记。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { stepBeetleOrb, beetleOrbDrawPlan } from '../src/entities/Player';
import { BeetleMeter } from '../src/player/BeetleMeter';

const PLY = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8');
const RDR = readFileSync(new URL('../src/render/Renderer.ts', import.meta.url), 'utf8');
const CENSUS = readFileSync(new URL('./bj595-armor-set-vfx-census.test.ts', import.meta.url), 'utf8');

/** 确定性 PRNG（mulberry32）——统计锁用（避免 Math.random 的 CI 漂移）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const V = () => ({ x: 0, y: 0 });

// ============ 面1：物理式逐参锁（Player.cs:16556-16612） ============

describe('BJ596 面1：随机游走域（:16581-16582 Next(-100,101)×0.005）', () => {
  it('rand=0 → −0.5 精确;rand≈1 → +0.5;rand=0.5 → 零加速（±0.5/t² 双轴）', () => {
    const p1 = V(), v1 = V();
    stepBeetleOrb(p1, v1, 0, 0, () => 0);
    expect(v1).toEqual({ x: -0.5, y: -0.5 });
    const p2 = V(), v2 = V();
    stepBeetleOrb(p2, v2, 0, 0, () => 0.999999);
    expect(v2).toEqual({ x: 0.5, y: 0.5 });
    const p3 = V(), v3 = V();
    stepBeetleOrb(p3, v3, 0, 0, () => 0.5);      // floor(0.5×201)=100 → (100−100)×0.005=0
    expect(v3).toEqual({ x: 0, y: 0 });
  });

  it('pos+=vel 先于本拍加速（加速在下一拍生效——时序锁）', () => {
    const p = V(), v = V();
    stepBeetleOrb(p, v, 0, 0, () => 0.505);      // floor(0.505×201)=101 → 加速 +0.005
    expect(p).toEqual({ x: 0, y: 0 });           // 本拍 pos 未吃加速
    expect(v).toEqual({ x: 0.005, y: 0.005 });
    stepBeetleOrb(p, v, 0, 0, () => 0.505);
    expect(p).toEqual({ x: 0.005, y: 0.005 });   // 次拍才位移
  });
});

describe('BJ596 面1：双环回拉（:16587-16603）', () => {
  it('外环 |pos|>100：弹簧目标 −pos/|pos|×20、vel=(vel×9+目标)/10', () => {
    const p = { x: 0, y: 120 }, v = V();
    stepBeetleOrb(p, v, 0, 0, () => 0.5);
    expect(v).toEqual({ x: 0, y: -2 });          // (0×9 + −120×20/120)/10 = −2
    expect(p).toEqual({ x: 0, y: 120 });         // pos 本拍不被回拉改写（只改 vel）
  });

  it('内环 30<|pos|≤100：目标半径 10、混合 19/20', () => {
    const p = { x: 40, y: 0 }, v = V();
    stepBeetleOrb(p, v, 0, 0, () => 0.5);
    expect(v).toEqual({ x: -0.5, y: 0 });        // 40×(−10/40)/20 = −0.5
    const p2 = { x: 0, y: 100 }, v2 = V();       // 边界 |=100 不吃外环吃内环（>100 严格）
    stepBeetleOrb(p2, v2, 0, 0, () => 0.5);
    expect(v2).toEqual({ x: 0, y: -0.5 });       // 100×(−10/100)/20 = −0.5
  });

  it('|pos|≤30 双环都不触发;斜向弹簧目标逐分量锁', () => {
    const p = { x: 10, y: 0 }, v = V();
    stepBeetleOrb(p, v, 0, 0, () => 0.5);
    expect(v).toEqual({ x: 0, y: 0 });
    const p3 = { x: 60, y: 80 }, v3 = V();       // |pos|=100 整内环:目标 = −(60,80)×0.1
    stepBeetleOrb(p3, v3, 0, 0, () => 0.5);
    expect(v3).toEqual({ x: -0.3, y: -0.4 });    // −6/20, −8/20
  });
});

describe('BJ596 面1：限速+拖尾（:16604-16612）', () => {
  it('|vel|>2 → ×0.9;恰 2 不衰减（渐近限速非硬钳）', () => {
    const p = V(), v = { x: 3, y: 0 };
    stepBeetleOrb(p, v, 0, 0, () => 0.5);
    expect(v).toEqual({ x: 2.7, y: 0 });
    const p2 = V(), v2 = { x: 2, y: 0 };
    stepBeetleOrb(p2, v2, 0, 0, () => 0.5);
    expect(v2).toEqual({ x: 2, y: 0 });          // >2 严格
    const p3 = V(), v3 = { x: 0, y: -2.5 };
    stepBeetleOrb(p3, v3, 0, 0, () => 0.5);
    expect(v3).toEqual({ x: 0, y: -2.25 });
  });

  it('pos −= playerVel×0.25（移动拖尾,双轴）', () => {
    const p = { x: 10, y: 0 }, v = V();
    stepBeetleOrb(p, v, 4, -8, () => 0.5);
    expect(p).toEqual({ x: 9, y: 2 });
  });

  it('全序锁：pos+=vel → 加速 → 环拉 vel → 限速 → 拖尾（单掷复现）', () => {
    const p = { x: 0, y: 0 }, v = { x: 2, y: 2 };
    stepBeetleOrb(p, v, 0, 0, () => 0.5);
    // pos=(2,2),|pos|=2.83≤30 无环;|vel|=2.83>2 → ×0.9
    expect(p).toEqual({ x: 2, y: 2 });
    expect(v).toEqual({ x: 1.8, y: 1.8 });
  });

  it('统计界（6000 步×6×种子族）：|vel| 有界（>2 衰减收敛,非硬钳渐近）、|pos| 有界且回落内环', () => {
    // 界推导：>2 支 ×0.9 与 ±0.5 双轴加速的平稳分布短程越界 ~2.7(实测界),
    // 钳 3.0;无 >2 衰减（变异面）随机游走 6000 步 std≈22 必爆 3.0=判别力面;
    // 无双环（变异面）pos 同理漂出 150。
    for (const seed of [11, 23, 47, 97, 131, 211]) {
      const rand = mulberry32(seed);
      const p = V(), v = V();
      let maxP = 0, maxV = 0, backInner = false;
      for (let i = 0; i < 6000; i++) {
        stepBeetleOrb(p, v, 0, 0, rand);
        const d = Math.hypot(p.x, p.y), s = Math.hypot(v.x, v.y);
        maxP = Math.max(maxP, d); maxV = Math.max(maxV, s);
        if (i > 100 && d <= 30) backInner = true;
      }
      expect(maxV, `seed${seed} vel 界`).toBeLessThanOrEqual(3.0);
      expect(maxP, `seed${seed} pos 界`).toBeLessThanOrEqual(150);
      expect(backInner, `seed${seed} 回落内环`).toBe(true);
    }
  });
});

// ============ 面2：绘制锁（PlayerDrawLayers.cs:4130-4155） ============

describe('BJ596 面2：5 残影+本体参数面（beetleOrbDrawPlan）', () => {
  it('6 条目：残影 j=0..4 偏移 −vel×j、k=0.5−0.1j;本体 k=1 最后（画最上）', () => {
    const plan = beetleOrbDrawPlan({ x: 1.5, y: -2 }, 0, 26, 68);
    expect(plan).toHaveLength(6);
    // j=0 偏移 ±0（IEEE −0 与 +0 同值,toBeCloseTo 兼容符号）
    expect(plan[0].ox).toBeCloseTo(0); expect(plan[0].oy).toBeCloseTo(0);
    expect(plan[0].k).toBe(0.5); expect(plan[0].main).toBe(false);
    expect(plan[1]).toMatchObject({ ox: -1.5, oy: 2, main: false });
    expect(plan[1].k).toBeCloseTo(0.4);
    expect(plan[2]).toMatchObject({ ox: -3, oy: 4, main: false });
    expect(plan[2].k).toBeCloseTo(0.3);
    expect(plan[3]).toMatchObject({ ox: -4.5, oy: 6, main: false });
    expect(plan[3].k).toBeCloseTo(0.2);          // 0.5−0.3 浮点尾差（C# 侧被 byte 截断吸收）
    expect(plan[4]).toMatchObject({ ox: -6, oy: 8, main: false });
    expect(plan[4].k).toBeCloseTo(0.1);
    expect(plan[5]).toMatchObject({ ox: 0, oy: 0, main: true });
    expect(plan[5].k).toBe(1);
  });

  it('3 帧条源矩形 (0, H/3·frame+1, W, H/3−2) 整除 + origin (W/2, H/6)（:4151/:4153）', () => {
    // 26×68（vanilla/BeetleOrb.png 实测）：H/3=22 → sy=1/23/45、sh=20;H/6=11、W/2=13
    for (const [frame, sy] of [[0, 1], [1, 23], [2, 45]] as const) {
      const plan = beetleOrbDrawPlan(V(), frame, 26, 68);
      for (const s of plan) expect(s.sy, `frame${frame}`).toBe(sy);
      expect(plan[0].sh).toBe(20);
      expect(plan[0].orgX).toBe(13);
      expect(plan[0].orgY).toBe(11);
    }
    // 26×66（vanilla 原生档同值——整除稳健）
    const alt = beetleOrbDrawPlan(V(), 1, 26, 66);
    expect(alt[0].sy).toBe(23);
    expect(alt[0].sh).toBe(20);
  });
});

// ============ 充能档视觉差锁（orb 数=档位,两族各 3 上限） ============

describe('BJ596 充能档：beetleOrbs 1/2/3 驱动 orb 体数（B3 计数域消费面）', () => {
  it('防御族梯子：180t/球,封顶 3（buff 95/96/97 → 1/2/3 档）', () => {
    const meter = new BeetleMeter();
    const host: { beetleOrbs?: number } = { beetleOrbs: 0 };
    for (let i = 0; i < 180; i++) meter.tick(host, false, true);
    expect(host.beetleOrbs).toBe(1);
    for (let i = 0; i < 180; i++) meter.tick(host, false, true);
    expect(host.beetleOrbs).toBe(2);
    for (let i = 0; i < 180; i++) meter.tick(host, false, true);
    expect(host.beetleOrbs).toBe(3);
    for (let i = 0; i < 1800; i++) meter.tick(host, false, true);   // 长充不越 3
    expect(host.beetleOrbs).toBe(3);
  });

  it('进攻族：高蓄能直达 3 球（buff 98/99/100 → 1/2/3 档）;球数=档位差', () => {
    const meter = new BeetleMeter();
    const host: { beetleOrbs?: number } = { beetleOrbs: 0 };
    meter.registerHit(6000, true);                    // counter=6000 > 400+1200+3600=5200
    meter.tick(host, true, false);
    expect(host.beetleOrbs).toBe(3);
    // 掉到 1 档线以下 → 1 球（视觉差=球数随档）
    meter.registerHit(-4597, true);                   // counter=6197−4597=1600（测试注水面）
    meter.tick(host, true, false);                    // −3 → 1597 ∈ (400,1600] → 档1
    expect(host.beetleOrbs).toBe(1);
  });

  it('3 球满档时三槽物理全部活性（数组 3 槽 = 两族各 3 档上限的承载面）', () => {
    const slots = [V(), V(), V()].map((p) => p);
    const vels = [V(), V(), V()];
    for (let i = 0; i < 120; i++) {
      for (let k = 0; k < 3; k++) stepBeetleOrb(slots[k], vels[k], 0, 0, mulberry32(1000 + i * 3 + k));
    }
    for (let k = 0; k < 3; k++) {
      expect(Math.hypot(slots[k].x, slots[k].y), `slot${k} 已离中心`).toBeGreaterThan(0.5);
      expect(Math.hypot(slots[k].x, slots[k].y), `slot${k} 有界`).toBeLessThanOrEqual(140);
    }
  });
});

// ============ 接线锁（源文锁：位次/门/消费面） ============

describe('BJ596 接线锁', () => {
  it('物理挂 fixedUpdateBody、位次在盾球轨道块之前（原版 Always_Beetle<Always_Solar :16421-23）', () => {
    expect(PLY.includes('export function stepBeetleOrb')).toBe(true);
    const atPhysics = PLY.indexOf('stepBeetleOrb(this.beetlePos');
    const atSolarOrbit = PLY.indexOf('const mntType = this.ridingMount ? this.mount.type : -1');
    expect(atPhysics).toBeGreaterThan(-1);
    expect(atSolarOrbit).toBeGreaterThan(-1);
    expect(atPhysics).toBeLessThan(atSolarOrbit);
    // 门 = 双旗对 + 死亡相停（原版 Update dead 早退 :24943-24949 先于 UpdateArmorSets）
    expect(PLY).toContain('if (!this.dead && (eqM.beetleDef === true || eqM.beetleOff === true)) {');
    // 3 帧条残迹式照抄（frameCounter>=1 恒真门 + >2 循环）
    expect(PLY).toContain('if (this.beetleFrameCounter >= 1) {');
    expect(PLY).toContain('if (this.beetleFrame > 2) this.beetleFrame = 0;');
    // 未用槽归零（:16573-16577）
    expect(PLY).toContain('for (let i = this.beetleOrbs; i < 3; i++) {');
    // 3 槽持久数组（Player.beetlePos/Vel :947/:949）
    expect(PLY).toContain('beetlePos = [ { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 } ];');
    expect(PLY).toContain('beetleVel = [ { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 } ];');
    expect(PLY).toMatch(/beetleFrame = 0;/);
  });

  it('绘制挂 drawPlayer 眼球伞块之前（原版 37<38 层序）、手持物之后（27<37）', () => {
    expect(RDR.includes('vanilla/BeetleOrb.png')).toBe(true);
    // ★BJ730 改判史：旧锚裸 'DrawPlayer_37/38_…' 走 indexOf 首中——后续波注释
    //  （鞭线体/水前面层链注,提及 38 层）先于真绘制位抢中致序断言错位。改用真
    //  绘制位区段头形态锚（唯一）,层序本体未动（22105 drawUseItem < 22108 Beetle
    //  < 22147 Eyebrella 实测在位）。
    const atBeetle = RDR.indexOf('★BJ596 甲虫 orb（DrawPlayer_37_BeetleBuff');
    const atEyebrella = RDR.indexOf('眼球伞云盖（DrawPlayer_38_EyebrellaCloud');
    const atHeld = RDR.indexOf('drawUseItem(ctx, p, swing, flicker)');
    expect(atBeetle).toBeGreaterThan(-1);
    expect(atBeetle).toBeGreaterThan(atHeld);          // 手持物(27)之下（先画）
    expect(atBeetle).toBeLessThan(atEyebrella);        // 眼球伞(38)之上（先画）
    // 门 = 双旗对 + !dead + !mntHidden（原版 :4131 旗对 + 死亡相不进层链 + 变身隐防御门）
    expect(RDR).toContain('(p.equipStats.beetleDef === true || p.equipStats.beetleOff === true) && !p.dead && !mntHidden');
    // 每 orb 循环 = 球数驱动（充能档视觉差消费面）
    expect(RDR).toContain('i < p.beetleOrbs');
    expect(RDR).toContain('beetleOrbDrawPlan(p.beetleVel[i], p.beetleFrame');
    // immune 平滑淡出（GetImmuneAlphaPure 无 >125 截断门,:54834-54842）
    expect(RDR).toContain('(255 - Math.min(255, p.immuneAlpha)) / 255');
  });

  it('资产在库（BJ595 判）+ 3 帧竖条实测尺寸', () => {
    const path = new URL('../public/sprites/vanilla/BeetleOrb.png', import.meta.url);
    expect(existsSync(path)).toBe(true);
    const buf = readFileSync(path);
    expect(buf.readUInt32BE(16)).toBe(26);   // W
    expect(buf.readUInt32BE(20)).toBe(68);   // H（3 帧条,整除 22/帧）
  });
});

// ============ BJ595 台账双向锁（销案面不重查） ============

describe('BJ596 ↔ BJ595 台账双向锁', () => {
  it('B1/B2 已从 registered-debt 翻转 fixed-bj596（登记面清偿）', () => {
    expect(CENSUS).toMatch(/\{ id: 'B1',[^}]*verdict: 'fixed-bj596'/);
    expect(CENSUS).toMatch(/\{ id: 'B2',[^}]*verdict: 'fixed-bj596'/);
    // 原「全缺」锁已反转（不得再断言 beetlePos/BeetleOrb 不存在）
    expect(CENSUS.includes("expect(PLY.includes('beetlePos')).toBe(false)")).toBe(false);
    expect(CENSUS.includes("expect(RDR.includes('BeetleOrb')).toBe(false)")).toBe(false);
  });

  it('B3 计数域维持 isomorphic 销案（本套件不重查蓄能/buff 面）', () => {
    expect(CENSUS).toMatch(/\{ id: 'B3', set: 'Beetle', face: '蓄能 buff 95-100 计数域', verdict: 'isomorphic'/);
  });
});
