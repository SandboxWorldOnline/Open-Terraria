// ★BJ705-G26 件2:南瓜王 327/哀木 325 全亮表情叠画（BJ705-A 登记债③清偿）。
// 定谳（1457 亲读,Main.cs:26044-26063——DrawNPCDirect 本体链之后的后绘 extras
// 区 else-if 链,本体之上;120/137/138 残影支紧邻同域）:
//   · type 327: PumpkingFace Color.White 1 笔 + 9 笔 (110−n×10)×4 通道同值灰阶
//     抖动残影（jitter = rand.Next(−10,11)×0.2 双轴独立 = ±2px）;
//   · type 325: TreeFace 同构（:26054-26063）;
//   · 锚 = 标准本体锚（num46=0（108/124/357/467/537 族外）/num47=NPCAddHeight=0
//     （:22208 表无 327/325）/gfxOffY=0（地面 boss）→ 面锚≡体锚）;
//   · sourceRect = rCurrentNPC.frame（表情帧与本体帧同拍——贴图逐字节同构:
//     PumpkingFace 102×1368 ≡ NPC_327;TreeFace 248×1880 ≡ NPC_325）;
//   · 混合 = 不读光照色（Color.White/恒灰非 GetAlpha）=全亮域。
// 落刀:Renderer.drawEnemy 后绘 extras 区 npcWhiteLiftQueue 10 笔/帧（主笔 ga:1;
//   残影 tint=[g,g,g]+tintA=g 两步式=BJ551 判例域 XNA 预乘逐字节）;抖动折 cx/cy。
// 变异恰红（本文件 §E 派生三变异）:M1 整块摘除/M2 主笔 ga 档漂移/M3 残影 tintA 档
//   漂移——结构锁全红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RENDERER = join(process.cwd(), 'src', 'render', 'Renderer.ts');
const VAN = join(process.cwd(), 'public', 'sprites', 'vanilla');

const pngDim = (name: string): [number, number] => {
  const b = readFileSync(join(VAN, name));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('BJ705-G26 件2 §A 贴图帧几何（表情帧 ≡ 本体帧逐字节同构）', () => {
  it('PumpkingFace 102×1368 ≡ NPC_327;TreeFace 248×1880 ≡ NPC_325（r.sy 帧行直用前提）', () => {
    expect(pngDim('PumpkingFace.png')).toEqual(pngDim('NPC_327.png'));
    expect(pngDim('PumpkingFace.png')).toEqual([102, 1368]);
    expect(pngDim('TreeFace.png')).toEqual(pngDim('NPC_325.png'));
    expect(pngDim('TreeFace.png')).toEqual([248, 1880]);
  });
});

describe('BJ705-G26 件2 §B 灰阶梯子+抖动域（:26049-26052 算式）', () => {
  it('残影灰阶 9 档:100/90/…/20（110−n×10,RGB=A 通道同值）', () => {
    const ladder = Array.from({ length: 9 }, (_, k) => 110 - (k + 1) * 10);
    expect(ladder).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20]);
  });
  it('抖动域 ±2px 步 0.2（rand.Next(−10,11)×0.2 等价域）', () => {
    for (let i = 0; i < 500; i++) {
      const j = (Math.floor(Math.random() * 21) - 10) * 0.2;
      expect(j).toBeGreaterThanOrEqual(-2);
      expect(j).toBeLessThanOrEqual(2);
      expect(Math.abs(j * 5 - Math.round(j * 5))).toBeLessThan(1e-9);   // 0.2 步进格点
    }
  });
  it('XNA 预乘代数:残影终像素 = tex.rgb·tex.a·(g/255) + bg·(1−tex.a·g/255)（两步式逐字节）', () => {
    // 消费侧两步式（BJ551 判例域）:dest-out(g/255) 后 lighter(tinted rgb×g/255)
    const g = 100, texR = 200, texA = 0.5, bg = 120;
    const xna = texR * texA * (g / 255) + bg * (1 - texA * (g / 255));
    const twoStep = (bg * (1 - texA * (g / 255))) + (texR * (g / 255) * texA);
    expect(twoStep).toBeCloseTo(xna, 12);
  });
});

describe('BJ705-G26 件2 §C 接线结构锁（Renderer 源锚——防静默回退）', () => {
  const src = readFileSync(RENDERER, 'utf8');
  it('C1 挂点=后绘 extras 区（drawNpcTrailGhostsOverBody 块后）+ 双型门', () => {
    const i = src.indexOf('if (NPC_TRAIL_GHOST_IDS.has(e.vanillaId ?? -1)) {');
    const j = src.indexOf('if (e.vanillaId === 327 || e.vanillaId === 325) {');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);   // 120/137/138 残影支同域之后=原版链序同相
    expect(src).toContain('★BJ705-G26 件2（2026-10-22,BJ705-A 登记债③清偿）');
  });
  it('C2 主笔 ga:1 全亮 + 残影 tint/tintA 两步式 + 9 笔循环 + 抖动折 cx/cy', () => {
    expect(src).toContain("const faceTex = e.vanillaId === 327 ? 'vanilla/PumpkingFace.png' : 'vanilla/TreeFace.png';");
    expect(src).toContain('cx: e.cx, cy: e.cy, rot: gRot, mirror: gMirror, scale, by: bodyY, ga: 1,');
    expect(src).toContain('for (let n = 1; n < 10; n++) {');
    expect(src).toContain('const g = 110 - n * 10;   // :26049 (110−num265×10) 通道同值灰阶 100→20');
    expect(src).toContain('cx: e.cx + (Math.floor(Math.random() * 21) - 10) * 0.2,   // rand.Next(−10,11)×0.2');
    expect(src).toContain('tint: [g, g, g], tintA: g,');
    expect(src).toContain('sy: r.sy, sw: r.sw, sh: r.sh,');   // 帧行=本体帧同拍
  });
  it('C3 帧位/锚参数面注记在位（面锚≡体锚三零定谳防再查）', () => {
    expect(src).toContain('num47=NPCAddHeight=0（表无 327/325）');
    expect(src).toContain('逐字节同构（102×1368/248×1880');
  });
});
