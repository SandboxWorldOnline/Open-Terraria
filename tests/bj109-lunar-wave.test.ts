// ★BJ109 落刀批（2026-09-16）十项定谳交接回归：A 摘 zone 外门 / B crystalDeath 伪影
// 拆除 / C spawnMoonLordOnPlayer 门 / D 塔心 x / E 398 死清 IsUp / F 发弹门 / G
// 护盾泡泡 / H glow 脉动 / I FilterTower / J 自发光地板。
// 权威锚（重定位后）：
//   A  SceneMetrics.cs:130/:276-282/:912-920 + ScanNPCPositions :738-749（无条件全表）
//      + Player.cs:16832 ZoneTowerSolar=CloseEnoughToSolarTower + NPC.cs:404-408
//   B  Projectile.cs:986（aiStyle132=弹 672 DD2 败北水晶）+37019-75（其滤镜链）；
//      塔死 NPC.cs:80125-80146 无弹体无滤镜
//   C  NPC.cs:81378-81387 case 398 门=!AnyNPCs(398)，其它 Boss 在场照召；
//      ★BJ110-a 落位 NewNPC(:81594)→Bottom=(X,Y)（Entity.cs:130 position=(X−w/2,Y−h)）
//   D  WorldGen.cs:87950-87952 NewNPC((num3+num4)*16, num7*16) + NPC.cs:81592
//      nPC.Bottom=(X,Y)（中心 x=X 无 +8）
//   E  NPC.cs:80213-80216 case 398 → LunarApocalypseIsUp=false
//   F  NPC.cs:80100-80136 发弹唯一门=ShieldStrengthTower*>0
//   G  Main.cs:24551-24598（Perlin 600²+ForceField pass+AlphaBlend）+
//      DyeInitializer.cs:426 注册 + PixelShader.cso obj48（实测 Misc_Perlin α 恒 255）
//   H  Main.cs:24483-24520（4+|GetAlpha−.5|·4 / 517: 2+|·|·9 + UnitX·2；A=64 灰
//      Color(64,64,64,0)）+ AI_094 :39519 vy=sin(2π·ai0/300)×0.5（净半径 ~3.7px）
//   I  ScreenEffectInitializer.cs:14-17 四塔预设 + SceneState.cs:107-111（塔心−(0,10)+
//      flag4 压独石）+ ScreenShader.cso obj9 FilterTower
//   J  Projectile.cs:80895-80931 GetAlpha 专支（538/573/575/578/579 灰度白化族）
import { describe, it, expect, beforeAll, vi } from 'vitest';
// ★BJ730 改判史：BJ109-H 动态 import Renderer（27.9k+ 行,随渲染波持续增重）在
//  esbuild 转换+模块初始化跨过 vitest 缺省 5s 测试超时=超时伪红（BJ712-A 判例
//  签名同源;vitest-default-timeout-pseudo-red 仓内习语放宽）——非行为回归。
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });
import { readFileSync } from 'node:fs';

const gameSrc = () => readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const rendererSrc = () => readFileSync(new URL('../src/render/Renderer.ts', import.meta.url), 'utf8');

/** 区块抽取：从 startMark 行起至 endMark 行前（含两端标记行） */
function block(src: string, startMark: string, endMark: string): string {
  const lines = src.split('\n');
  const s = lines.findIndex((l) => l.includes(startMark));
  const e = lines.findIndex((l, i) => i > s && l.includes(endMark));
  expect(s, `startMark 未命中: ${startMark}`).toBeGreaterThanOrEqual(0);
  expect(e, `endMark 未命中: ${endMark}`).toBeGreaterThan(s);
  return lines.slice(s, e).join('\n');
}

// ---------------------------------------------------------------------------
// A. zone 外门摘除（BJ109-A）：CloseEnoughTo*Tower 无 LunarApocalypseIsUp 参与
// ---------------------------------------------------------------------------
describe('BJ109-A：星璇塔 Zone 无事件门外门', () => {
  it('zone 计算块不再被 w.lunarEvent.active 门控', () => {
    const zone = block(gameSrc(), '★BJ109-A 摘外门', 'fairyHelpfulActive =');
    expect(zone).not.toContain('w.lunarEvent.active');
    expect(zone).toContain('TOWER_ZONE_RADIUS * TOWER_ZONE_RADIUS');   // 距离平方 ≤（:917）
  });
  it('判距对齐原版 ≤（SceneMetrics.cs:917 DistanceSquared<=range²）', () => {
    const zone = block(gameSrc(), '★BJ109-A 摘外门', 'fairyHelpfulActive =');
    expect(zone).toMatch(/dx \* dx \+ dy \* dy <= TOWER_ZONE_RADIUS \* TOWER_ZONE_RADIUS/);
  });
});

// ---------------------------------------------------------------------------
// B. crystalDeath 伪影整支拆除（BJ109-D 假#1）——拆除态固化，复辟即红
// ---------------------------------------------------------------------------
describe('BJ109-B：crystalDeath 伪影拆除态', () => {
  it('LunarEvent.ts 无 crystalDeath/startCrystalDeath/tickCrystalDeath/CRYSTAL_DEATH_TICKS', () => {
    const src = readFileSync(new URL('../src/world/LunarEvent.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/crystalDeath\??\s*:/);   // 字段声明面（定谳注释除外）
    expect(src).not.toMatch(/export (const|function) (startCrystalDeath|tickCrystalDeath|CRYSTAL_DEATH_TICKS)/);
    expect(src).not.toContain('startCrystalDeath(w');   // onTowerKilled 调用面
    expect(src).not.toContain('★批 III 尾窗');          // 旧伪影注释族不得残留
  });
  it('Game.ts 塔死链不传 at、tick 链无水晶驱动', () => {
    const src = gameSrc();
    const killFn = block(src, 'private onLunarTowerKilled', 'private onLunarMinionKilled');
    expect(killFn).toContain('onTowerKilled(this.world, towerId, (id) => this.hasNpcId(id), this.lunarHost())');
    expect(killFn).not.toMatch(/,\s*at/);               // at 传参拆除
    expect(src).not.toContain('tickCrystalDeath(');
  });
  it('Renderer 滤镜链无水晶 tint/vortex 产位（pass 端口保留=真 DD2 弹 672 基建）', () => {
    const src = rendererSrc();
    expect(src).not.toContain('lec?.crystalDeath');
    expect(src).not.toContain("passes.push({ kind: 'FilterCrystalDestructionColor'");
    expect(src).not.toContain("passes.push({ kind: 'FilterCrystalDestructionVortex'");
  });
});

// ---------------------------------------------------------------------------
// C. spawnMoonLordOnPlayer 门=!AnyNPCs(398)（NPC.cs:81378-81387）
// ---------------------------------------------------------------------------
describe('BJ109-C：月总召唤门', () => {
  it('门=hasNpcId(398)，不再拒其它 Boss；占槽回退=槽空才接管', () => {
    const fn = block(gameSrc(), 'private spawnMoonLordOnPlayer', 'private spawnDeerclopsOnPlayer');
    expect(fn).toContain('if (this.hasNpcId(398)) return;');
    expect(fn).not.toContain('if (this.boss) return;');
    expect(fn).toContain('if (!this.boss) this.boss = e;');
  });
  it('★BJ110-a 落位锚：Bottom.y=Center.Y−150 → 左上 y=py−150−h（NewNPC :81594 + Entity.cs:130）', () => {
    const fn = block(gameSrc(), 'private spawnMoonLordOnPlayer', 'private spawnDeerclopsOnPlayer');
    expect(fn).toContain('e.y = p.cy - 150 - e.h;');   // 底边=玩家中心上方 150px
    expect(fn).not.toMatch(/p\.cy - 150 - e\.h \/ 2/); // 盒心式旧值（半盒差）复辟即红
    expect(fn).toContain('e.x = p.cx - e.w / 2;');     // Bottom.x=Center.X → position.X=X−w/2
  });
});

// ---------------------------------------------------------------------------
// D. spawnLunarTower 中心 x（WorldGen.cs:87950 + NPC.cs:81592 Bottom 语义）
// ---------------------------------------------------------------------------
describe('BJ109-D：塔落位中心 x=tx*16', () => {
  it('spawnLunarTower 无 +8（Bottom=(X,Y)：盒心 x=tx*16−w/2、顶 y=ty*16−h）', () => {
    const fn = block(gameSrc(), 'private spawnLunarTower', 'triggerLunarApocalypse(): void');
    expect(fn).toContain('Enemy.fromVanilla(id, tx * TILE, ty * TILE)');
    expect(fn).toContain('e.x = tx * TILE - e.w / 2;');
    expect(fn).toContain('e.y = ty * TILE - e.h;');
    expect(fn).not.toContain('tx * TILE + 8');
  });
});

// ---------------------------------------------------------------------------
// E. 398 死清 LunarApocalypseIsUp（NPC.cs:80213-80216）
// ---------------------------------------------------------------------------
describe('BJ109-E：月总死清天启旗', () => {
  it('击杀链 downed_398 置位处接 clearLunarApocalypse（398 专属支）', () => {
    const src = gameSrc();
    expect(src).toContain('if (this.boss.vanillaId === 398) clearLunarApocalypse(w);');
    const srcL = readFileSync(new URL('../src/world/LunarEvent.ts', import.meta.url), 'utf8');
    const fn = srcL.slice(srcL.indexOf('export function clearLunarApocalypse'));
    expect(fn).toContain('w.lunarEvent.active = false;');
    expect(fn).toContain('persist(w);');   // flags 落档同步（lunarApocalypseUp 位）
  });
});

// ---------------------------------------------------------------------------
// F. 发弹门摘 active（NPC.cs:80100-80136 唯一门=盾>0）
// ---------------------------------------------------------------------------
describe('BJ109-F：月小怪死亡发弹门', () => {
  it('击杀链 isTowerMinion 支无 lunarEvent.active 前置', () => {
    const fn = block(gameSrc(), '★BJ109-D 摘发弹门', '入侵击杀扣分');
    expect(fn).toContain('} else if (isTowerMinion(enemy.vanillaId)) {');
    expect(fn).not.toContain('lunarEvent.active && isTowerMinion');
    expect(fn).toContain('this.onLunarTowerKilled(enemy.vanillaId);');   // at 传参随 B 拆
  });
});

// ---------------------------------------------------------------------------
// G. 护盾 ForceField 泡泡（Main.cs:24551-24598 + SM2 pass）
// ---------------------------------------------------------------------------
describe('BJ109-G：塔护盾泡泡渲染', () => {
  it('drawTowerShield 单源走 drawForceFieldBubble（旧方罩 towerShieldTex 整支拆除）', () => {
    const src = rendererSrc();
    const fn = block(src, 'private drawTowerShield', '568/569 出生态紫雾');
    expect(fn).toContain('drawForceFieldBubble(this.ctx, this, {');
    expect(fn).toContain('cy: e.cy - 10 * scale');   // 绘制位=塔心−(0,10)（:24547）
    expect(fn).toContain('radius: 300 * scale');     // 600² 源矩形 → 半径 300×scale
    expect(fn).toContain('breakT: breaking ? Math.min(1, e.ai3 / 30) : -1');   // num321
    expect(src).not.toMatch(/towerShieldTex\s*\(/);      // 旧方罩调用面拆除
    expect(src).not.toContain('towerShieldTexCache');    // 缓存整支拆除
    expect(src).not.toMatch(/PILLAR_FF\./);              // 自造计时器随死码支拆除
    expect(src).not.toMatch(/const PILLAR_FF/);
  });
  it('SM2 ForceField pass 产泡形（外缘 α=0 径向衰减,非整幅方罩）', async () => {
    const { getPass, runPassOnImageData, defaultUniforms } =
      await import('../src/fx/SM2Effect');
    const pass = getPass('ForceField');
    expect(pass).not.toBeNull();
    const S = 64;
    const data = new Uint8ClampedArray(S * S * 4);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < S * S; i++) {
      const v = Math.round(rnd() * 255);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
    const u = defaultUniforms();
    u.uColor = [1, 1, 1];
    u.uTime = 12.5;
    u.uSourceRect = [0, 0, S, S];
    u.uImageSize0 = [S, S];
    const before = data.slice();
    runPassOnImageData(pass!, data, S, S, u);
    const A = (x: number, y: number) => data[(y * S + x) * 4 + 3];
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== data[i]) changed++;
    expect(changed).toBeGreaterThan(1024);           // 非透传（swirl 调制生效）
    expect(A(1, 1)).toBe(0);                         // 外缘衰减=非方罩（旧方罩全幅 255）
    let innerMax = 0;
    for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) innerMax = Math.max(innerMax, A(x, y));
    expect(innerMax).toBeGreaterThan(0);             // 泡内有可见结构
  });
  it('ForceFieldBubble 源贴图=Misc_Perlin（Images/Misc/Perlin,Main.cs:24554）', () => {
    const src = readFileSync(new URL('../src/fx/ForceFieldBubble.ts', import.meta.url), 'utf8');
    expect(src).toContain("ensureVImage('vanilla/Misc_Perlin.png')");
    expect(src).not.toContain("ensureVImage('vanilla/Perlin.png')");
  });
});

// ---------------------------------------------------------------------------
// H. glow 脉动三修（Main.cs:24483-24520）——★BJ509 锚更新（2026-10-04）：num/xoff/
//    四向偏移等价收编静态纯函数 npcGlowVel4Num/npcGlowVel4Offsets（收集/消费/测试
//    单源），判别力逐项保留（517 base/mult 钉值/逐通道 GetAlpha−0.5/UnitX 偏移/
//    旋转偏移式）；vel4 分支保留收集面锚（BJ509 落刀=残影挪 7d''' 光照合成后）。
// ---------------------------------------------------------------------------
describe('BJ109-H：四塔 glow 光照脉动', () => {
  it('npcGlowVel4Num 纯函数：base/mult 钉值（4+|GetAlpha−0.5|·4；517=2+|·|·9）', async () => {
    const { Renderer } = await import('../src/render/Renderer');
    const R = Renderer as unknown as { npcGlowVel4Num: (vid: number, l: readonly number[] | null) => number };
    // 493/422/507 = 4 + |light−127.5|·4；517 = 2 + |·|·9
    expect(R.npcGlowVel4Num(493, [0, 0, 0])).toBeCloseTo(4 + Math.sqrt(3 * 0.25) * 4, 5);
    expect(R.npcGlowVel4Num(422, [0, 0, 0])).toBeCloseTo(4 + Math.sqrt(3 * 0.25) * 4, 5);
    expect(R.npcGlowVel4Num(507, [0, 0, 0])).toBeCloseTo(4 + Math.sqrt(3 * 0.25) * 4, 5);
    expect(R.npcGlowVel4Num(517, [0, 0, 0])).toBeCloseTo(2 + Math.sqrt(3 * 0.25) * 9, 5);
    // 偏色档（:24509 连续域）：[128,0,0] → (0.00196,−0.5,−0.5) length≈0.70724
    expect(R.npcGlowVel4Num(493, [128, 0, 0])).toBeCloseTo(4 + Math.sqrt(0.0019607 * 0.0019607 + 0.5) * 4, 4);
    // 满光/黑光同 length（灰光色距 0.5 恒 √0.75）——原版 GetAlpha 域同式
    expect(R.npcGlowVel4Num(493, [255, 255, 255])).toBeCloseTo(4 + Math.sqrt(3 * 0.25) * 4, 5);
    // 光照未就绪 → base 保守档
    expect(R.npcGlowVel4Num(493, null)).toBe(4);
    expect(R.npcGlowVel4Num(517, null)).toBe(2);
  });
  it('npcGlowVel4Offsets 纯函数：velocity.RotatedBy(k·π/2)×num + 517 +UnitX×2（:24518 挂 X 不挂 Y）', async () => {
    const { Renderer } = await import('../src/render/Renderer');
    const R = Renderer as unknown as { npcGlowVel4Offsets: (vx: number, vy: number, num: number, xoff?: number) => Array<[number, number]> };
    // vy=0.5 悬停摆、num=4+√0.75·4、xoff=0（493）——k=0 无旋转：dx=vx·num=0、dy=vy·num
    const num = 4 + Math.sqrt(3 * 0.25) * 4;
    const o = R.npcGlowVel4Offsets(0, 0.5, num, 0);
    expect(o.length).toBe(4);
    expect(o[0][0]).toBeCloseTo(0, 9);
    expect(o[0][1]).toBeCloseTo(0.5 * num, 9);
    expect(o[1][0]).toBeCloseTo(-0.5 * num, 9);   // k=1：90° 旋转 (vx·0−vy·1)·num
    expect(o[1][1]).toBeCloseTo(0, 9);
    expect(o[2][1]).toBeCloseTo(-0.5 * num, 9);
    // 517 xoff 恒 +2 挂 X（k=0 档）：dx = vx·num + 2
    const o2 = R.npcGlowVel4Offsets(0, 0.5, num, 2);
    expect(o2[0][0]).toBeCloseTo(2, 9);
    expect(o2[0][1]).toBeCloseTo(0.5 * num, 9);   // Y 无 xoff（旧错位回归锁）
  });
  it('vel4 分支收集面（BJ509）：num/xoff 走纯函数单源 + lightAt 读点', () => {
    const fn = block(rendererSrc(), "g.mode === 'vel4'", 'trail：419 火月怪');
    expect(fn).toContain('Renderer.npcGlowVel4Num(e.vanillaId ?? -1,');
    expect(fn).toContain('const xoff = e.vanillaId === 517 ? 2 : 0;');   // +UnitX×2
    expect(fn).toContain('this.lighting?.lightAt(Math.floor(e.cx / TILE), Math.floor(e.cy / TILE))');
    expect(fn).toContain('this.towerGlowQueue.push({');   // ★BJ509 收集面（7d''' 消费）
    // 旧错位（+2 挂 dy）不得残留
    expect(fn).not.toContain('+ (e.vanillaId === 517 ? 2 : 0);\n');
  });
});

// ---------------------------------------------------------------------------
// I. FilterTower 塔邻接屏幕染色（ScreenEffectInitializer.cs:14-17 + SceneState.cs:107-111）
// ---------------------------------------------------------------------------
describe('BJ109-I：FilterTower 染色', () => {
  it('四塔预设 = UseColor/UseOpacity 1:1（:14-17）', async () => {
    const { TOWER_FILTER_PRESETS } = await import('../src/render/GLScreenFilters');
    expect(TOWER_FILTER_PRESETS.nebula).toEqual({ color: [1, 0, 0.9], useOpacity: 0.35 });
    expect(TOWER_FILTER_PRESETS.solar).toEqual({ color: [1, 0.7, 0], useOpacity: 0.3 });
    expect(TOWER_FILTER_PRESETS.stardust).toEqual({ color: [0, 0.5, 1], useOpacity: 0.5 });
    expect(TOWER_FILTER_PRESETS.vortex).toEqual({ color: [0, 0.7, 0.7], useOpacity: 0.5 });
  });
  it('FRAG_TOWER 字节码主项锁（obj9：纵横度量/扫描幅/双辅 tap/V+min 推色）', async () => {
    const { SCREEN_FX_FRAGS } = await import('../src/render/GLScreenFilters');
    const f = SCREEN_FX_FRAGS['FilterTower']!;
    expect(f).toContain('rel * vec2(1.5, 1.0)');                  // c11=(1.5,1,…) 纵横度量
    // ★BJ346 勘误重产（preshader c0=1000·uProgress+180 直读；旧式 len−uProgress 系误读）：
    expect(f).toContain('50.0 / denom');                          // 波前半径（c11.w=50,带号保向）
    expect(f).toContain('180.0 + 1000.0 * uProgress');            // preshader c0（lit16=1000/lit17=180）
    expect(f).toContain('5.0) * uIntensity');                     // 幅帽 c12.x=5
    expect(f).toContain('2.25 * (duv - vUv)');                    // tapB（c13.z=2.25）
    expect(f).toContain('3.5 * (duv - vUv)');                     // tapC（c13.w=3.5）
    expect(f).toContain('float k = sum - 1.0');                   // k=V+mn−1（c11.y=1）★BJ346 重产
    expect(f).toContain('mix(sC.rgb, tgt * sC.a, uOpacity)');     // lerp 尾段
    expect(f).toContain('col.b += sA.b - sC.b');                  // :397-399 色差修正
    expect(f).toContain('col.g += sB.g - sC.g');                  // :401-403
  });
  it('Renderer 产位：lunarTowersNear 真喂数 + FilterTower pass 组装', () => {
    const src = rendererSrc();
    // ★多柱串柱定谳 2026-09-25：per-type 四槽（SceneState.cs:108-111 四行各管各槽）
    expect(src).toContain('lunarTowersNear: (() => {');
    expect(src).toContain('TOWER_KEYS.some((k) => tows[k] != null)');
    expect(src).toContain("kind: 'FilterTower'");
    // ★BJ346 勘误重产：targetPx=塔心世界系（ScreenShaderData.Apply 双端同减 offScreenRange）
    expect(src).toContain('targetPx: [tow.x, tow.y]');
    expect(src).not.toContain('targetPx: [tow.x - screenPos[0]');
    expect(src).toContain('preset.useOpacity * this._towerFilterOpacity[k]');
    // 盾态三支驱动抽纯函数（Main.cs:24564/24573/24581，★BJ346）
    expect(src).toContain('towerFilterDrive(tow.shieldUp, tow.ai3)');
    expect(src).not.toContain('intensity = Math.min(5, 15 * num320) + 1;');
    // MonolithFilters stub 注释更新（flag4 已接真喂数）
    const mono = readFileSync(new URL('../src/render/MonolithFilters.ts', import.meta.url), 'utf8');
    expect(mono).toContain('★BJ109-I 2026-09-16 已接真喂数');
  });
  it('_lunarTowerFilterTargets：per-type 四槽 ≤4000px 最近塔 + 塔心−(0,10)（多柱串柱定谳）', () => {
    const src = rendererSrc();
    const fn = block(src, 'private _lunarTowerFilterTargets', 'FilterTower 的 Filter.Opacity 斜坡');
    expect(fn).toContain('d2 <= TOWER_ZONE_RADIUS * TOWER_ZONE_RADIUS');
    expect(fn).toContain('bestD2[key] ?? Infinity');       // per-type 最近（ClosestNPCPosition[type] 逐型）
    expect(fn).toContain('x: t.cx, y: t.cy - 10');         // SceneState.cs:107-110 −(0,10)
  });
});

// ---------------------------------------------------------------------------
// J. 自发光地板追加（Projectile.cs:80895-80931 GetAlpha 灰度白化族）
// ---------------------------------------------------------------------------
describe('BJ109-J：月族弹自发光地板', () => {
  let lumOf: (pid: number) => (proj: object) => { floor: number; whiten: boolean };
  beforeAll(async () => {
    (globalThis as Record<string, unknown>).Image = class {
      src = ''; onload: (() => void) | null = null;
      width = 0; height = 0;
      addEventListener() { /* noop */ }
    };
    const anyStub = (): Record<string, unknown> => new Proxy(function stub() { /* noop */ } as unknown as Record<string, unknown>, {
      get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyStub()),
      set: () => true,
      apply: () => anyStub(),
      construct: () => anyStub(),
    });
    (globalThis as Record<string, unknown>).document = { createElement: () => anyStub() };
    (globalThis as unknown as { addEventListener: unknown }).addEventListener = () => {};
    (globalThis as Record<string, unknown>).window = { addEventListener: () => {}, removeEventListener: () => {} };
    const { Renderer } = await import('../src/render/Renderer');
    new Renderer(null as never);
    const map = (Renderer as unknown as {
      SELF_LUMINOUS_PROJS: Map<number, (proj: never) => { floor: number; whiten: boolean }>;
    }).SELF_LUMINOUS_PROJS;
    lumOf = (pid: number) => {
      const f = map.get(pid);
      expect(f, `SELF_LUMINOUS_PROJS 缺 ${pid}`).toBeDefined();
      return (proj: object) => f!(proj as never);
    };
  }, 120000);

  it('538/573/575：floor=(255−α)/255（α 敏感）+ whiten=true', () => {
    for (const pid of [538, 573, 575]) {
      expect(lumOf(pid)({ alpha: 0 })).toEqual({ floor: 1, whiten: true });
      expect(lumOf(pid)({ alpha: 128 })).toEqual({ floor: 127 / 255, whiten: true });
      expect(lumOf(pid)({ alpha: 255 })).toEqual({ floor: 0, whiten: true });
    }
  });
  it('578/579：floor 恒 1 + whiten=true（实弹相 α 恒 0,aiStyle108 上膛窗不建模）', () => {
    for (const pid of [578, 579]) {
      expect(lumOf(pid)({ alpha: 0 })).toEqual({ floor: 1, whiten: true });
      expect(lumOf(pid)({ alpha: 200 })).toEqual({ floor: 1, whiten: true });
    }
  });
  it('加算族 537/540/539/574/580 不入表（world 层 lighter 维持,455 先例）', async () => {
    const { Renderer } = await import('../src/render/Renderer');
    const map = (Renderer as unknown as {
      SELF_LUMINOUS_PROJS: Map<number, unknown>;
    }).SELF_LUMINOUS_PROJS;
    for (const pid of [537, 539, 540, 574, 580]) expect(map.has(pid)).toBe(false);
  });
});
