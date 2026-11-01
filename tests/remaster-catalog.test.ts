// 素材重制管线 M1:AssetCatalog 帧枚举正确性(一切的地基)。
// 对拍四路:tile 帧矩形=vframeAt 语义(尺寸步进而非 cols/rows)、NPC 帧高=⌊H/frames⌋、
// proj 与 vanilla-projframes 全量、item 全命中 Item_Atlas ix/iy;外加 npcGrid 覆盖
// drawNpcGrid 全调用处、排除集(ui 纸娃娃/594/690/液体树冠背景)生效。
// 运行:npx vitest run tests/remaster-catalog.test.ts
import { describe, it, expect } from 'vitest';
import vanillaJson from '../public/sprites/vanilla.json';
import vanillaNpcsJson from '../public/sprites/vanilla-npcs.json';
import vanillaUiJson from '../public/sprites/vanilla-ui.json';
import projFramesJson from '../src/data/vanilla-projframes.json';
import remasterIndex from '../public/sprites/remaster-index.json';
import { buildCatalog, gridFrames, vstripFrames } from '../src/remaster/AssetCatalog';
import { NPC_GRIDS, npcGridFrames } from '../src/remaster/NpcGridLayouts';
import type { VanillaData } from '../src/assets/SpriteAtlas';

const vanilla = vanillaJson as unknown as VanillaData;
const npcData = vanillaNpcsJson as Record<string, { frames?: number; name?: string }>;
const uiFiles = (vanillaUiJson as { files: Record<string, string> }).files;
const projFrames = projFramesJson as Record<string, number>;
const sizes = {
  ...(remasterIndex as unknown as { vanilla: Record<string, [number, number]> }).vanilla,
  ...(remasterIndex as unknown as { 'vanilla-ui': Record<string, [number, number]> })['vanilla-ui'],
};

const catalog = buildCatalog({
  vanilla, npcData, projFrames, uiFiles, sizes,
  // itemAnim:从 SpriteAtlas 导 ITEM_ANIMATION 形状注入会拖整模块;此处只验非动画路径,
  // 动画物品竖切由 FrameOps/工作台侧集成探针覆盖
});

describe('remaster catalog 基础规模', () => {
  it('类别条目数与素材库对拍', () => {
    expect(catalog.byCategory.get('tile')!.length).toBe(Object.keys(vanilla.tiles).length);
    expect(catalog.byCategory.get('wall')!.length).toBe(Object.keys(vanilla.walls).length);
    // npc = npcData 全量 + 网格表里有而 npcData 无的兜底(vanilla-npcs.json 随
    // 并行 NPC 补录增长,696 等已入 SetDefaults → 兜底为 0;断言动态算)
    const npcExpect = Object.keys(npcData).length
      + Object.keys(NPC_GRIDS).filter((id) => !npcData[id]).length;
    expect(catalog.byCategory.get('npc')!.length).toBe(npcExpect);
    expect(catalog.byCategory.get('item')!.length).toBe(Object.keys(vanilla.items).length);
    expect(catalog.byCategory.get('ui')!.length).toBe(Object.keys(uiFiles).length);
    // projectile = index 里的 Projectile_*.png 总数
    const projFiles = Object.keys(sizes).filter((f) => /^vanilla\/Projectile_\d+\.png$/.test(f));
    expect(catalog.byCategory.get('projectile')!.length).toBe(projFiles.length);
  });
});

describe('tile/wall 帧枚举 = vframeAt 语义', () => {
  it('按 sheet 实际尺寸 stride 步进(压板 135 cols=0 前科)', () => {
    const plate = catalog.byKey.get('tile:135')!;
    expect(plate).toBeTruthy();
    expect(plate.frames.length).toBeGreaterThan(0);
    // Tiles_135 实际尺寸步进:16×200 竖条 18 步长 → 帧数 = 高度步进数
    const sz = sizes['vanilla/Tiles_135.png'];
    const expectRows = Math.floor((sz[1] - 16) / 18) + 1;
    expect(plate.frames.length).toBe(expectRows);
    expect(plate.frames[0]).toEqual({ x: 0, y: 0, w: 16, h: 16, frameIdx: 0 });
  });
  it('普通表:288×270 Dirt(16/18)→ 16 列 × 15 行 行优先', () => {
    const dirt = catalog.byKey.get('tile:0')!;
    expect(dirt.frames.length).toBe(16 * 15);
    expect(dirt.frames[1]).toEqual({ x: 18, y: 0, w: 16, h: 16, frameIdx: 1 });
    expect(dirt.frames[16]).toEqual({ x: 0, y: 18, w: 16, h: 16, frameIdx: 16 });
  });
  it('wall:grid 32/stride 36 步进', () => {
    const stone = catalog.byKey.get('wall:1')!;
    const sz = sizes['vanilla/Wall_1.png'];
    const cols = Math.floor((sz[0] - 32) / 36) + 1;
    const rows = Math.floor((sz[1] - 32) / 36) + 1;
    expect(stone.frames.length).toBe(cols * rows);
  });
  it('gridFrames 越界不产生半帧', () => {
    expect(gridFrames(100, 100, [16, 16], [18, 18]).length).toBe(25); // 100/18 → 0..90=6 列
  });
});

describe('npc 帧枚举', () => {
  it('纵条:帧高 = ⌊H/frames⌋(蓝史莱姆 2 帧)', () => {
    const slime = catalog.byKey.get('npc:1')!;
    const sz = sizes['vanilla/NPC_1.png'];
    const fh = Math.floor(sz[1] / 2);
    expect(slime.layout).toBe('vstrip');
    expect(slime.frames).toHaveLength(2);
    expect(slime.frames[1]).toEqual({ x: 0, y: fh, w: sz[0], h: fh, frameIdx: 1 });
  });
  it('vanilla.json 显式 meta(frameW/frameH/count)优先于尺寸推断', () => {
    const m = vanilla.npcs!['46'];
    const e = catalog.byKey.get('npc:46')!;
    expect(e.frames).toHaveLength(m.count);
    expect(e.frames[0]).toMatchObject({ x: 0, y: 0, w: m.frameW, h: m.frameH });
  });
  it('单帧 NPC = whole 整图', () => {
    const e = catalog.byKey.get('npc:2')!;
    if ((npcData['2'].frames ?? 1) === 1) {
      expect(e.layout).toBe('whole');
      expect(e.frames).toHaveLength(1);
    }
  });
  it('2D 网格族:NPC_GRIDS 覆盖 drawNpcGrid 全调用处且帧数=cols×rows', () => {
    for (const id of [657, 576, 577, 696, 564, 565, 668]) {
      expect(NPC_GRIDS[id], `NPC ${id} 应在网格表`).toBeTruthy();
      const e = catalog.byKey.get(`npc:${id}`)!;
      expect(e.layout).toBe('grid2d');
      const def = NPC_GRIDS[id];
      expect(e.frames.length).toBe(def.cols * def.rows);
    }
  });
  it('657 inflateY=2:帧高 120(122-2),y 偏移 +1', () => {
    const e = catalog.byKey.get('npc:657')!;
    expect(e.frames[0]).toMatchObject({ x: 0, y: 1, w: 180, h: 120 });
    expect(e.frames[1]).toMatchObject({ x: 180, y: 1 }); // 行优先:idx1=(col1,row0)
  });
  // ★SW-RB10e 2026-09-10 勘误：vanilla Frame(5,5,fx,fy,2,2) 末两参 = Utils.Frame
  //  sizeOffset【外扩 +2】（Utils.cs:1389-1395 rect=(218fx,240fy,220,242)），非内缩
  //  padding——本表只载网格基准（纯 218×240 格），渲染侧 drawDeerclopsGrid 自算
  //  外扩+表缘裁剪；旧断言 {x:2,y:2,w:214,h:236} 系内缩误读
  it('668 网格基准:纯 218×240 格(外扩 +2 由渲染侧承载)', () => {
    const e = catalog.byKey.get('npc:668')!;
    expect(e.frames[0]).toMatchObject({ x: 0, y: 0, w: 218, h: 240 });
    expect(e.frames[1]).toMatchObject({ x: 218, y: 0, w: 218, h: 240 });
  });
  it('横条/拼装特殊路径排除(594/690)', () => {
    expect(catalog.byKey.get('npc:594')!.meta?.excluded).toBeTruthy();
    expect(catalog.byKey.get('npc:690')!.meta?.excluded).toBeTruthy();
  });
  it('npcGridFrames = sheet 全格行优先枚举(与渲染 idx 折行无关)', () => {
    const rects = npcGridFrames(NPC_GRIDS[696], 384, 1242);
    expect(rects).toHaveLength(6 * 27);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 64, h: 46 });
    expect(rects[6]).toEqual({ x: 0, y: 46, w: 64, h: 46 });    // 行优先:idx6=(col0,row1)
    expect(rects[9]).toEqual({ x: 192, y: 46, w: 64, h: 46 });  // idx9=(col3,row1)
  });
});

describe('projectile 帧枚举', () => {
  it('与 vanilla-projframes.json 全量对拍(帧数>1 的全部 vstrip)', () => {
    for (const [id, n] of Object.entries(projFrames)) {
      const e = catalog.byKey.get(`proj:${id}`);
      if (!e) continue;
      expect(e.frames.length).toBe(n);
      if (n > 1) expect(e.layout).toBe('vstrip');
    }
  });
  it('未登记弹幕默认单帧 whole', () => {
    const e = catalog.byKey.get('proj:1')!;
    expect(projFrames['1'] ?? 1).toBe(1);
    expect(e.layout).toBe('whole');
    expect(e.frames).toHaveLength(1);
  });
});

describe('item 帧枚举', () => {
  it('全部条目命中 Item_Atlas 子矩形;无矩形独立 PNG(3861/3862)整图收录(★BJ743-A)', () => {
    let whole = 0;
    for (const [id, m] of Object.entries(vanilla.items)) {
      const e = catalog.byKey.get(`item:${id}`)!;
      expect(e.sheet).toBe(m.icon);
      if (m.ix === undefined || m.iw === undefined || m.ih === undefined) {
        // ★BJ743-A：无矩形条目（atlas-append 独立 PNG 落盘形,vicon 整图回退同构）
        //   ——frames[0] = remaster-index IHDR 整图矩形,layout=whole。
        expect(e.layout).toBe('whole');
        const sz = sizes[m.icon];
        expect(sz, `item ${id} 独立 PNG 须在 remaster-index`).toBeTruthy();
        expect(e.frames[0]).toEqual({ x: 0, y: 0, w: sz[0], h: sz[1], frameIdx: 0 });
        whole++;
      } else {
        expect(e.frames[0]).toEqual({ x: m.ix, y: m.iy, w: m.iw, h: m.ih, frameIdx: 0 });
      }
    }
    // 3861(Ogre)/3862(DarkMage)宝藏袋——atlas-append-1457 追加通道独立 PNG 形
    expect(whole).toBe(2);
    expect(catalog.byKey.get('item:3861')!.sheet).toBe('vanilla/Item_3861.png');
    expect(catalog.byKey.get('item:3862')!.sheet).toBe('vanilla/Item_3862.png');
  });
});

describe('排除集', () => {
  it('ui 纸娃娃族灰显(Player_/Armor_ 三族)', () => {
    const player = catalog.byKey.get('ui:Player_0_0.png')!;
    expect(player.meta?.excluded).toBeTruthy();
    const head = catalog.byKey.get('ui:Armor_Head_10.png');
    if (head) expect(head.meta?.excluded).toBeTruthy();
  });
  it('液体/树冠/背景/旗帜头像 excluded', () => {
    expect(catalog.byKey.get('misc:Liquid_0')?.meta?.excluded).toBeTruthy();
    expect(catalog.byKey.get('misc:Tree_Tops_5')?.meta?.excluded).toBeTruthy();
    expect(catalog.byKey.get('misc:Background_0')?.meta?.excluded).toBeTruthy();
  });
  it('misc 不重复收录已归属族(Tiles/NPC/Projectile/Item_Atlas)', () => {
    for (const e of catalog.byCategory.get('misc')!) {
      expect(e.sheet).not.toMatch(/^vanilla\/(Tiles_|NPC_|Projectile_|Item_Atlas)/);
    }
  });
});

describe('vstripFrames 数学', () => {
  it('count=1 整图;count>1 等高纵条', () => {
    expect(vstripFrames(30, 100, 1)).toEqual([{ x: 0, y: 0, w: 30, h: 100, frameIdx: 0 }]);
    const f = vstripFrames(30, 101, 3);
    expect(f.map((r) => r.h)).toEqual([33, 33, 33]);
    expect(f[2].y).toBe(66);
  });
});
