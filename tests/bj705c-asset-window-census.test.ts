// ★BJ705-C（2026-10-22）：「BJ705-A 修复是否代表其它独立加载的贴图都有同问题?
// 仓库里还有多少这种?」——用户提问驱动的家族普查收口定谳锁。
//
// 定谳（普查矩阵完整版见 memory/bj705c-asset-window-census.md;判别锁探针
// scripts/_bj705c-nullwindow-census.mjs 六员实证,强制失败窗采样区【部分】变化
// =本体仍在的不对称假体:WoF 墙身 0.42/Prime 臂骨 0.56/光女翼 0.37/月总头
// 0.04/鹿角怪雾 0.25/蚁狮下体 0.39）：
//  · 机制=BJ705-A 同根家族:NPC 本体(NPC_{id}.png 主表,BJ636 预载+BJ705-A 回扫)
//    与部件散件(Extra_/Glow_/Chain_/专属 png)走两条重试钟——部件只在首绘触发
//    ensureVImage 10s TTL,SW/CDN 空窗内逐文件命中态漂移=任意混搭假体窗
//    （「有眼无墙」/「飘臂」/「无翼」/「头在体缺」）。
//  · 修法=分级①:敌怪/城镇 NPC 绘制路径部件差集(138 件/563KB,vs 主表
//    3.17MB=+18%)入 VANILLA_MISC——经 preloadMiscAndNpcs 自动进 BJ705-A 回扫集
//    与 worldWarmUrls P1 暖存面(原 P2 miscVanilla,零增量流量只改时序)。
//  · 销案面（判语③,不入表）:弹幕/尘/gore/掉落域(本体亦首绘懒载=同钟双缺,
//    BJ636 整缺类非 BJ705-A 不对称类)、玩家配饰/发型/UI 面板(帧 1 即首绘+自愈,
//    PaperDoll 就绪门在案)、玩家手持 Glow 族(Glow_25/195/216-218/BeetleOrb 等)。
//  · 登记债:①残余窗内预载件失败仍可见假体（回扫只缩窗;「宁回退不丢精灵」律
//    下不做部件门控,BJ705-A 判语沿用）;②绘制序不对称结构本体门前独立门未动
//    （预载覆盖为正解,结构备案见 ③ 消费面锚）。
//  变异证红：
//   M1 VANILLA_MISC 摘 ...VANILLA_ENEMY_PARTS spread → ①/②红
//   M2 表内文件名改错/删 → ①盘上存在红
//   M3 表加入已预载 NPC_{id} 键 → ①零重叠红（冗余面回归）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VANILLA_MISC, VANILLA_ENEMY_PARTS, SpriteAtlas } from '../src/assets/SpriteAtlas';
import { worldWarmUrls } from '../src/net/AssetCache';
import vanillaNpcsJson from '../public/sprites/vanilla-npcs.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const atlasSrc = readFileSync(join(HERE, '..', 'src', 'assets', 'SpriteAtlas.ts'), 'utf8');

/** 探针六员实证锚（scripts/_bj705c-nullwindow-census.mjs PASS 面） */
const PROBE_PROVEN = [
  'vanilla/WallOfFlesh.png', 'vanilla/Arm_Bone_2.png', 'vanilla/Extra_159.png',
  'vanilla/Extra_26.png', 'vanilla/Extra_245.png', 'vanilla/AntlionBody.png',
];

describe('① 判别锁:敌怪路径部件散件全集入预载(M1 证红面)', () => {
  it('VANILLA_ENEMY_PARTS 非空且经 spread 全量进 VANILLA_MISC(摘 spread=部件回懒加载窗)', () => {
    expect(VANILLA_ENEMY_PARTS.length).toBeGreaterThanOrEqual(138);
    expect(atlasSrc).toMatch(/\.\.\.VANILLA_ENEMY_PARTS,/);
    for (const f of VANILLA_ENEMY_PARTS) expect(VANILLA_MISC).toContain(f);
  });
  it('探针六员实证成员在表(判别锁探针 PASS 面的静态钉值)', () => {
    for (const f of PROBE_PROVEN) expect(VANILLA_ENEMY_PARTS).toContain(f);
  });
  it('全件盘上真实存在且为 PNG(防清单指向空文件=预载恒失败,M2)', () => {
    for (const f of VANILLA_ENEMY_PARTS) {
      const p = join(HERE, '..', 'public', 'sprites', f);
      expect(existsSync(p), p).toBe(true);
      expect(readFileSync(p).readUInt32BE(0)).toBe(0x89504e47 >>> 0);
    }
  });
  it('与既有预载面零重叠(M3:NPC 主表/特殊表键混入=冗余面回归)', () => {
    const npcSheets = new Set<string>();
    for (const id of Object.keys(vanillaNpcsJson as Record<string, unknown>)) {
      npcSheets.add(`vanilla/NPC_${id}.png`);
    }
    const miscBefore = (() => {   // ③节之前既有的 VANILLA_MISC 固定项(链/液体/BJ705-A 四件)
      const head = atlasSrc.slice(0, atlasSrc.indexOf('export const VANILLA_ENEMY_PARTS'));
      return new Set([...head.matchAll(/'(vanilla\/[A-Za-z0-9_]+\.png)'/g)].map((m) => m[1]));
    })();
    for (const f of VANILLA_ENEMY_PARTS) {
      expect(npcSheets.has(f), `${f} 已在 NPC 主表预载集`).toBe(false);
      expect(miscBefore.has(f), `${f} 与既有 VANILLA_MISC 固定项重复`).toBe(false);
    }
  });
  it('内部零重复(同件双列=清单卫生回归)', () => {
    expect(new Set(VANILLA_ENEMY_PARTS).size).toBe(VANILLA_ENEMY_PARTS.length);
  });
});

describe('② 行为锁:部件随 preloadMiscAndNpcs/暖存面同源(双源律)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { Image?: unknown }).Image = class { src = ''; };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { Image?: unknown }).Image;
    vi.restoreAllMocks();
  });
  it('(a) preloadMiscAndNpcs 预载集含全部部件(BJ705-A 回扫集同源覆盖)', async () => {
    const at = new SpriteAtlas();
    const calls: string[][] = [];
    vi.spyOn(at, 'preloadFiles').mockImplementation((files: Iterable<string>) => {
      calls.push([...files]);
      return Promise.resolve();
    });
    await at.preloadMiscAndNpcs();
    expect(calls.length).toBe(1);
    const set = new Set(calls[0]);
    for (const f of VANILLA_ENEMY_PARTS) expect(set.has(f), f).toBe(true);
  });
  it('(b) worldWarmUrls(SW P1 暖存)含全部部件(P2→P1 只改时序的对面锁)', () => {
    const warm = new Set(worldWarmUrls());
    for (const f of VANILLA_ENEMY_PARTS) {
      expect(warm.has(`sprites/${f}`), f).toBe(true);
    }
  });
});

describe('③ 结构锁:普查矩阵消费面锚(防表-消费点漂移=表变死清单)', () => {
  const rendererSrc = readFileSync(join(HERE, '..', 'src', 'render', 'Renderer.ts'), 'utf8');
  const partsSrc = readFileSync(join(HERE, '..', 'src', 'render', 'npcExtraParts.ts'), 'utf8');
  it('链族/臂骨消费点在位(绘制序不对称宿主——改动须过 BJ705-C 判语)', () => {
    // 本体门前独立门九支链(drawEnemy 11939-11962 域)
    expect(rendererSrc).toContain("this.drawPrimeArm(e)");
    expect(rendererSrc).toContain("'vanilla/Arm_Bone_2.png'");
    expect(rendererSrc).toContain("'vanilla/Chain12.png'");
    expect(rendererSrc).toContain("'vanilla/Chain21.png'");
    expect(rendererSrc).toContain("'vanilla/Chain26.png' : 'vanilla/Chain27.png'");
    expect(rendererSrc).toContain("'vanilla/Chain10.png'");
  });
  it('boss 专属支部件消费点在位', () => {
    expect(rendererSrc).toContain("'vanilla/WallOfFlesh.png'");
    expect(rendererSrc).toContain("'vanilla/Extra_159.png'");   // 光女翼
    expect(rendererSrc).toContain("'vanilla/Extra_177.png'");   // 史后冠
    expect(rendererSrc).toContain("'vanilla/Extra_245.png'");   // 鹿角怪雾
    expect(partsSrc).toContain("'vanilla/DukeFishron.png'");
    expect(partsSrc).toContain("'vanilla/Chaos.png'");
  });
  it('GlowMask 族消费面在位(NPC_GLOW 表键抽取源)', () => {
    expect(rendererSrc).toMatch(/NPC_GLOW_ORBIT/);
    expect(rendererSrc).toContain("'vanilla/Glow_48.png'");     // 飞碟主体
    expect(rendererSrc).toContain("'vanilla/Glow_286.png'");    // 宝石小动物
  });
});
