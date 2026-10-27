// M13 资源包系统测试：zip 结构解析 / Content→本仓键映射 / 优先级与列表语义 /
// 管理器应用-撤销链（stub runtime+storage）/ Sfx 覆盖整表下发 / vicon 物品覆盖优先。
// node 环境：贴图解码与 IDB 均为注入 stub（同 remaster-runtime.test.ts 模式）。
// 运行:npx vitest run tests/resource-pack.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  mapPackAsset, stripContentRoot, isPackManifest, isPackIcon,
} from '../src/resources/packPaths';
import {
  readResourcePack, parsePackManifest, formatPackVersion, ResourcePackError,
} from '../src/resources/ResourcePackZip';
import {
  enabledSorted, disabledSorted, enableAsTopPriority, offsetPriority, cleanUpPriority, disablePack,
  type PackRow,
} from '../src/resources/ResourcePackList';
import { ResourcePackStore, type PackStorage } from '../src/resources/ResourcePackStore';
import { ResourcePackManager } from '../src/resources/ResourcePackManager';
import { applySfxPackOverrides, sfxPackOverrideKeys } from '../src/core/Sfx';
import { SpriteAtlas } from '../src/assets/SpriteAtlas';
import type { RemasterRuntime } from '../src/remaster/RemasterRuntime';

// ---------------------------------------------------------------------------
// 路径映射（权威 = ResourcePacksDefaultInfo.tsv 家族分布，见 packPaths.ts 头注）
// ---------------------------------------------------------------------------
describe('packPaths 映射', () => {
  it('Images 根级 → vanilla/<X>.png（Tiles/NPC/墙/弹幕/gore 族）', () => {
    expect(mapPackAsset('Images/Tiles_0.png')).toEqual([{ kind: 'image', file: 'vanilla/Tiles_0.png' }]);
    expect(mapPackAsset('Images/NPC_1.png')).toEqual([{ kind: 'image', file: 'vanilla/NPC_1.png' }]);
    expect(mapPackAsset('Images/Projectile_75.png')).toEqual([{ kind: 'image', file: 'vanilla/Projectile_75.png' }]);
    expect(mapPackAsset('Images/Item_75.png')).toEqual([{ kind: 'image', file: 'vanilla/Item_75.png' }]);
  });

  it('光标包：Images/UI/Cursor_N → vanilla-ui/UI_Cursor_N（AssetInitializer:796-799 权威路径）', () => {
    expect(mapPackAsset('Images/UI/Cursor_0.png')).toEqual([{ kind: 'image', file: 'vanilla-ui/UI_Cursor_0.png' }]);
    expect(mapPackAsset('Images/UI/Cursor_17.png')).toEqual([{ kind: 'image', file: 'vanilla-ui/UI_Cursor_17.png' }]);
    expect(mapPackAsset('Images/UI/SmartCursorArrow.png')).toEqual([{ kind: 'image', file: 'vanilla-ui/UI_SmartCursorArrow.png' }]);
  });

  it('盔甲族：Armor/ 子目录 → vui 消费键 + vanilla 镜像双写；根级 Armor_Head/Legs → vanilla + vui 双写', () => {
    expect(mapPackAsset('Images/Armor/Armor_81.png')).toEqual([
      { kind: 'image', file: 'vanilla-ui/Armor_Armor_81.png' },
      { kind: 'image', file: 'vanilla/Armor_Armor_81.png' },
    ]);
    expect(mapPackAsset('Images/Armor_Head_89.png')).toEqual([
      { kind: 'image', file: 'vanilla/Armor_Head_89.png' },
      { kind: 'image', file: 'vanilla-ui/Armor_Head_89.png' },
    ]);
  });

  it('其余子目录族 → vanilla/<族前缀>_<展平>', () => {
    expect(mapPackAsset('Images/Misc/water_0.png')).toEqual([{ kind: 'image', file: 'vanilla/Misc_water_0.png' }]);
    expect(mapPackAsset('Images/Accessories/Acc_HandsOn_1.png')).toEqual([{ kind: 'image', file: 'vanilla/Accessories_Acc_HandsOn_1.png' }]);
    // ★BJ731 改判史（2026-10-27）：2026-10-12 工坊包（娘化/Waifu）实测落地的
    //   TownNPCs 档案族规则——单段 <X>.png → vanilla/ 同名键（消费面
    //   townNpcProfileSheet 族,如 Guide_Default.png）。旧「族前缀展平
    //   TownNPCs_Alchemist.png」为该规则落地前旧相（BJ718-A 移交登记的陈旧面）。
    expect(mapPackAsset('Images/TownNPCs/Alchemist.png')).toEqual([{ kind: 'image', file: 'vanilla/Alchemist.png' }]);
    expect(mapPackAsset('Images/TownNPCs/Guide_Default.png')).toEqual([{ kind: 'image', file: 'vanilla/Guide_Default.png' }]);
    expect(mapPackAsset('Images/Backgrounds/Forest_Bg_0.png')).toEqual([{ kind: 'image', file: 'vanilla/Backgrounds_Forest_Bg_0.png' }]);
    expect(mapPackAsset('Images/SplashScreens/Splash.png')).toEqual([{ kind: 'image', file: 'vanilla/SplashScreens_Splash.png' }]);
  });

  it('音效族：Sounds/ 直名 + Custom/ 拍平（提取管线同款）', () => {
    expect(mapPackAsset('Sounds/Item_29.wav')).toEqual([{ kind: 'sound', file: 'Item_29' }]);
    expect(mapPackAsset('Sounds/Custom/dd2_flameburst_tower_shot_0.wav')).toEqual([{ kind: 'sound', file: 'dd2_flameburst_tower_shot_0' }]);
    expect(mapPackAsset('Sounds/Roar_0.mp3')).toEqual([{ kind: 'sound', file: 'Roar_0' }]);
    expect(mapPackAsset('Sounds/Liquid_0.ogg')).toEqual([{ kind: 'sound', file: 'Liquid_0' }]);
  });

  it('字体族：Fonts/<X>.ttf → SWRP:<基名>（web 适配）', () => {
    expect(mapPackAsset('Fonts/MyFont.ttf')).toEqual([{ kind: 'font', family: 'SWRP:MyFont' }]);
    expect(mapPackAsset('Fonts/Pixel.woff2')).toEqual([{ kind: 'font', family: 'SWRP:Pixel' }]);
  });

  it('未识别/不支持格式 → 空（xnb/rawimg 由读取层计数跳过）', () => {
    expect(mapPackAsset('Images/Tiles_0.xnb')).toEqual([]);
    expect(mapPackAsset('Images/Tiles_0.rawimg')).toEqual([]);
    expect(mapPackAsset('Cursors/Cursor_0.png')).toEqual([]);   // 1456 无此目录（以反编译为准）
    expect(mapPackAsset('Localization/Game.json')).toEqual([]);
    // ★BJ731 改判史（2026-10-27）：2026-10-12 工坊包实测（Waifu 19 张全 xnb）——
    //   .xnb 音效=容器内 PCM WAV,保留扩展名入 sound 映射（解码分派在
    //   parseFromEntries 按后缀判）;旧「→空」为该规则落地前旧相。
    expect(mapPackAsset('Sounds/Narration.xnb')).toEqual([{ kind: 'sound', file: 'Narration.xnb' }]);
  });

  it('Content 根剥离：大小写不敏感、反斜杠归一、目录与无 Content 前缀拒收', () => {
    expect(stripContentRoot('Content/Images/x.png')).toBe('Images/x.png');
    expect(stripContentRoot('content/Images/x.png')).toBe('Images/x.png');
    expect(stripContentRoot('Content\\Images\\x.png')).toBe('Images/x.png');
    expect(stripContentRoot('Images/x.png')).toBeNull();
    expect(stripContentRoot('Content/dir/')).toBeNull();
    expect(stripContentRoot('Content')).toBeNull();
    expect(isPackManifest('pack.json')).toBe(true);
    expect(isPackManifest('PACK.JSON')).toBe(true);
    expect(isPackIcon('icon.png')).toBe(true);
    expect(isPackManifest('Content/pack.json')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// zip 读取 + pack.json 清单
// ---------------------------------------------------------------------------
const PNG_1PX = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function makeZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

function manifestJson(name = '测试包', author = '作者甲', ver = { major: 1, minor: 2 }): Uint8Array {
  return strToU8(JSON.stringify({
    Name: name, Description: '描述文本', Author: author, Version: ver,
  }));
}

describe('ResourcePackZip 解析', () => {
  it('标准包：清单/图标/Content 分类入桶', () => {
    const zip = makeZip({
      'pack.json': manifestJson(),
      'icon.png': PNG_1PX,
      'Content/Images/UI/Cursor_0.png': PNG_1PX,
      'Content/Images/Tiles_0.png': PNG_1PX,
      'Content/Sounds/Item_29.wav': new Uint8Array([1, 2, 3, 4, 5]),
      'Content/Fonts/F.ttf': new Uint8Array([0, 0, 1, 0]),
    });
    const p = readResourcePack(zip);
    expect(p.manifest).toEqual({ name: '测试包', description: '描述文本', author: '作者甲', version: { major: 1, minor: 2 } });
    expect(p.iconPng).toEqual(PNG_1PX);   // fflate 解压为副本，值等非引用等
    expect([...p.images.keys()].sort()).toEqual(['vanilla-ui/UI_Cursor_0.png', 'vanilla/Tiles_0.png']);
    expect([...p.sounds.keys()]).toEqual(['Item_29']);
    expect([...p.fonts.keys()]).toEqual(['SWRP:F']);
    expect(p.counts.skippedXnb).toBe(0);
  });

  it('缺 pack.json 拒装（ResourcePack.cs:121-123 同语义）', () => {
    const zip = makeZip({ 'Content/Images/Tiles_0.png': PNG_1PX });
    expect(() => readResourcePack(zip)).toThrow(ResourcePackError);
    expect(() => readResourcePack(zip)).toThrow(/pack\.json/);
  });

  it('坏 zip / 坏 manifest 显式报错；xnb 计入 skippedXnb', () => {
    expect(() => readResourcePack(new Uint8Array([1, 2, 3]))).toThrow(ResourcePackError);
    const badJson = makeZip({ 'pack.json': strToU8('{not json'), 'Content/Images/Tiles_0.xnb': PNG_1PX });
    expect(() => readResourcePack(badJson)).toThrow(/pack\.json/);
    const zip = makeZip({ 'pack.json': manifestJson(), 'Content/Images/Tiles_0.xnb': PNG_1PX, 'Content/Unknown.bin': PNG_1PX });
    const p = readResourcePack(zip);
    expect(p.counts.skippedXnb).toBe(1);
    expect(p.counts.skippedUnknown).toBe(1);
    expect(p.images.size).toBe(0);
  });

  it('清单字段宽松：小写字段/缺字段回退；版本展示 M.m', () => {
    const m = parsePackManifest('{"name":"小写包","version":{"minor":3}}');
    expect(m).toEqual({ name: '小写包', description: '', author: '', version: { major: 0, minor: 3 } });
    expect(formatPackVersion(m.version)).toBe('0.3');
    expect(formatPackVersion({ major: 2, minor: 5 })).toBe('2.5');
  });

  it('Content 根外条目无视（包根散件不入内容桶）', () => {
    const zip = makeZip({ 'pack.json': manifestJson(), 'README.md': strToU8('x'), 'Content/Images/Tiles_0.png': PNG_1PX });
    const p = readResourcePack(zip);
    expect(p.images.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 列表语义（ResourcePackList.cs + UIResourcePackSelectionMenu 纯函数）
// ---------------------------------------------------------------------------
function row(partial: Partial<PackRow> & { id: string; fileName: string }): PackRow {
  return {
    name: partial.fileName, description: '', author: '',
    version: { major: 0, minor: 0 }, enabled: false, sortingOrder: 0,
    addedAt: 0, fileCount: 0, iconDataUrl: null,
    ...partial,
  } as PackRow;
}

describe('资源包列表语义', () => {
  it('EnabledPacks 序 = SortingOrder 升序；DisabledPacks 序 = Name/Version/FileName', () => {
    const rows = [
      row({ id: 'a', fileName: 'b.zip', name: 'B', enabled: true, sortingOrder: 1 }),
      row({ id: 'b', fileName: 'a.zip', name: 'A', enabled: true, sortingOrder: 0 }),
      row({ id: 'c', fileName: 'z.zip', name: 'Z' }),
      row({ id: 'd', fileName: 'y.zip', name: 'Y', version: { major: 2, minor: 0 } }),
      row({ id: 'e', fileName: 'y2.zip', name: 'Y', version: { major: 1, minor: 9 } }),
    ];
    expect(enabledSorted(rows).map((r) => r.id)).toEqual(['b', 'a']);
    expect(disabledSorted(rows).map((r) => r.id)).toEqual(['e', 'd', 'c']);
    // ↑ Y 1.9.0 < Y 2.0.0 < Z（Name → Version → FileName 决胜链）
  });

  it('启用置顶优先 = 其余启用包最大 order+1（SetResourcePackAsTopPriority :211-226）', () => {
    const rows = [
      row({ id: 'a', fileName: 'a.zip', enabled: true, sortingOrder: 0 }),
      row({ id: 'b', fileName: 'b.zip', enabled: true, sortingOrder: 5 }),
      row({ id: 'c', fileName: 'c.zip' }),
    ];
    enableAsTopPriority(rows[2], rows);
    expect(rows[2].enabled).toBe(true);
    expect(rows[2].sortingOrder).toBe(6);
    // 唯一启用包 → order 0
    const solo = [row({ id: 'x', fileName: 'x.zip' })];
    enableAsTopPriority(solo[0], solo);
    expect(solo[0].sortingOrder).toBe(0);
  });

  it('调序 = 与相邻交换；首尾钳制 no-op（OffsetResourcePackPriority :228-242）', () => {
    const rows = [
      row({ id: 'a', fileName: 'a.zip', enabled: true, sortingOrder: 0 }),
      row({ id: 'b', fileName: 'b.zip', enabled: true, sortingOrder: 1 }),
      row({ id: 'c', fileName: 'c.zip', enabled: true, sortingOrder: 2 }),
    ];
    expect(offsetPriority(rows[0], rows, -1)).toBe(false);           // 首位再升 no-op
    expect(offsetPriority(rows[0], rows, 1)).toBe(true);
    expect(enabledSorted(rows).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(offsetPriority(rows[2], rows, 1)).toBe(false);            // 尾位再降 no-op
    expect(offsetPriority(rows[2], rows, -1)).toBe(true);
    expect(enabledSorted(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('重整 = 按序重编 0..n-1；禁用保留行（CleanUpResourcePackPriority）', () => {
    const rows = [
      row({ id: 'a', fileName: 'a.zip', enabled: true, sortingOrder: 7 }),
      row({ id: 'b', fileName: 'b.zip', enabled: true, sortingOrder: 3 }),
      row({ id: 'c', fileName: 'c.zip', enabled: true, sortingOrder: 9 }),
    ];
    cleanUpPriority(rows);
    expect(enabledSorted(rows).map((r) => r.sortingOrder)).toEqual([0, 1, 2]);
    disablePack(rows[0]);
    cleanUpPriority(rows);
    expect(enabledSorted(rows).map((r) => r.id)).toEqual(['b', 'c']);
    expect(rows[0].enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 管理器（stub runtime + Map storage）
// ---------------------------------------------------------------------------
function makeStorage(): PackStorage & { reg: string; zips: Map<string, Blob> } {
  const s = {
    reg: '[]',
    zips: new Map<string, Blob>(),
    async getRegistry() { return s.reg; },
    async setRegistry(json: string) { s.reg = json; },
    async putZip(id: string, blob: Blob) { s.zips.set(id, blob); return true; },
    async getZip(id: string) { return s.zips.get(id) ?? null; },
    async deleteZip(id: string) { s.zips.delete(id); },
  };
  return s;
}

/** RemasterRuntime stub：apply 合并表、clearSheetEntry 删、restoreVanilla 清（终态可断言） */
function makeRuntime() {
  const state = new Map<string, unknown>();
  const calls = { apply: [] as string[][], restore: [] as string[][] };
  const rt = {
    state, calls,
    async apply(pack: { sheets: Map<string, Blob> }) {
      calls.apply.push([...pack.sheets.keys()]);
      for (const [f, b] of pack.sheets) state.set(f, b);
      return { applied: [...pack.sheets.keys()], failed: [] };
    },
    clearSheetEntry(file: string) { state.delete(file); },
    async restoreVanilla(files: Iterable<string>) { calls.restore.push(Array.from(files)); },
  };
  return rt as unknown as RemasterRuntime & typeof rt;
}

function packZip(cursorByte: number, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return makeZip({
    'pack.json': manifestJson(`包${cursorByte}`, `作者${cursorByte}`),
    'Content/Images/UI/Cursor_0.png': new Uint8Array([cursorByte]),
    ...extra,
  });
}

/** File 包装（fileName = 原版去重主键，须逐包唯一） */
function packFile(cursorByte: number, extra?: Record<string, Uint8Array>): File {
  return new File([packZip(cursorByte, extra) as unknown as BlobPart], `Pack${cursorByte}.zip`, { type: 'application/zip' });
}

describe('ResourcePackManager 应用链', () => {
  afterEach(() => { applySfxPackOverrides(new Map()); });

  it('导入默认禁用（FromJson 新包语义）；清单字段入行', async () => {
    const mgr = new ResourcePackManager(makeRuntime(), new ResourcePackStore(makeStorage()));
    const r = await mgr.importPack(packFile(1));
    expect(r.enabled).toBe(false);
    expect(r.name).toBe('包1');
    expect(r.author).toBe('作者1');
    expect(r.version).toEqual({ major: 1, minor: 2 });
    expect(r.fileCount).toBe(1);
    expect(r.iconDataUrl).toBeNull();   // 本 zip 无 icon.png
  });

  it('启用→注入 / 双包同键列表顶(先启用=低 order)胜 / 禁用→撤销+余包重放', async () => {
    // ★SW-FX16 优先级定谳修正：首写胜 = 列表顶（最小 order）= 冲突胜者
    // （AssetRepository.FirstOrDefault 真值锚,见 ResourcePackList.ts 文件头）。
    const rt = makeRuntime();
    const storage = makeStorage();
    const mgr = new ResourcePackManager(rt, new ResourcePackStore(storage));
    const a = await mgr.importPack(packFile(0x11));
    const b = await mgr.importPack(packFile(0x22));
    await mgr.setEnabled(a.id, true);
    expect(rt.state.get('vanilla-ui/UI_Cursor_0.png')).toBeTruthy();
    // 后启用落列底（SetResourcePackAsTopPriority=最大+1）→ 不压制 a（首写胜）
    await mgr.setEnabled(b.id, true);
    expect(rt.calls.apply[rt.calls.apply.length - 1]).toContain('vanilla-ui/UI_Cursor_0.png');
    const bothBlob = rt.state.get('vanilla-ui/UI_Cursor_0.png') as Blob;
    const bothBytes = new Uint8Array(await bothBlob.arrayBuffer());
    expect(bothBytes[0]).toBe(0x11);   // 列表顶 a 胜（SW-FX16 决断行）
    // 禁用 a（列表顶撤出）→ 余包 b 同键顶上
    await mgr.setEnabled(a.id, false);
    const finalBlob = rt.state.get('vanilla-ui/UI_Cursor_0.png') as Blob;
    const bytes = new Uint8Array(await finalBlob.arrayBuffer());
    expect(bytes[0]).toBe(0x22);
  });

  it('音效覆盖随启停整表重算（Sfx 跨实例通道）', async () => {
    const zip = makeZip({
      'pack.json': manifestJson(),
      'Content/Sounds/Item_29.wav': new Uint8Array([9, 9]),
    });
    const mgr = new ResourcePackManager(makeRuntime(), new ResourcePackStore(makeStorage()));
    const r = await mgr.importPack(zip);
    expect(sfxPackOverrideKeys()).toEqual([]);
    await mgr.setEnabled(r.id, true);
    expect(sfxPackOverrideKeys()).toEqual(['Item_29']);
    await mgr.setEnabled(r.id, false);
    expect(sfxPackOverrideKeys()).toEqual([]);
  });

  it('卸载：撤销文件 + 删持久化行/zip', async () => {
    const rt = makeRuntime();
    const storage = makeStorage();
    const mgr = new ResourcePackManager(rt, new ResourcePackStore(storage));
    const r = await mgr.importPack(packFile(0x33));
    await mgr.setEnabled(r.id, true);
    await mgr.remove(r.id);
    expect(rt.state.has('vanilla-ui/UI_Cursor_0.png')).toBe(false);
    expect(storage.zips.has(r.id)).toBe(false);
    expect((await mgr.refreshRows()).length).toBe(0);
  });

  it('同 fileName 再导入覆盖旧包（FromJson 按 FileName 去重）', async () => {
    const storage = makeStorage();
    const mgr = new ResourcePackManager(makeRuntime(), new ResourcePackStore(storage));
    const asFile = (): File => new File([packZip(1) as unknown as BlobPart], 'Pack.zip', { type: 'application/zip' });
    await mgr.importPack(asFile());
    await mgr.importPack(asFile());
    const rows = await mgr.refreshRows();
    expect(rows.length).toBe(1);
    expect(storage.zips.size).toBe(1);
  });

  it('启动恢复：持久化行+启用态 → 全量按优先级序应用（列表顶胜,SW-FX16）', async () => {
    const storage = makeStorage();
    {
      const mgr = new ResourcePackManager(makeRuntime(), new ResourcePackStore(storage));
      const a = await mgr.importPack(packFile(0x44));
      const b = await mgr.importPack(packFile(0x55));
      await mgr.setEnabled(a.id, true);
      await mgr.setEnabled(b.id, true);
    }
    const rt2 = makeRuntime();
    const mgr2 = new ResourcePackManager(rt2, new ResourcePackStore(storage));
    const { applied } = await mgr2.applyInstalled();
    expect(applied).toBe(2);
    const blob = rt2.state.get('vanilla-ui/UI_Cursor_0.png') as Blob;
    // a 先启用 = order 0 = 列表顶 = 首写胜（SW-FX16 优先级定谳：AssetRepository
    // .FirstOrDefault 真值锚,ResourcePackList.ts 文件头）
    expect(new Uint8Array(await blob.arrayBuffer())[0]).toBe(0x44);
  });
});

// ---------------------------------------------------------------------------
// Sfx 覆盖整表下发
// ---------------------------------------------------------------------------
describe('Sfx 资源包覆盖', () => {
  afterEach(() => { applySfxPackOverrides(new Map()); });

  it('整表替换语义：后写清旧键', () => {
    applySfxPackOverrides(new Map([['Item_29', new Uint8Array(1)], ['Zombie_14', new Uint8Array(1)]]));
    expect(sfxPackOverrideKeys().sort()).toEqual(['Item_29', 'Zombie_14']);
    applySfxPackOverrides(new Map([['Roar_0', new Uint8Array(1)]]));
    expect(sfxPackOverrideKeys()).toEqual(['Roar_0']);
    applySfxPackOverrides(new Map());
    expect(sfxPackOverrideKeys()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// vicon 物品覆盖（包内 Images/Item_N.png 整图直取，绕过图集子矩形）
// ---------------------------------------------------------------------------
describe('SpriteAtlas.vicon 资源包覆盖', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('包键命中 → 整图 DrawRect；未命中 → 常规图集路径', () => {
    const atlas = new SpriteAtlas();
    // node 无 Image：未命中路径会走 ensureVImage → new Image；stub 之（返回永不加载的假图）
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; src = ''; });
    const packImg = { width: 22, height: 208 } as unknown as ImageBitmap;
    atlas.vimages.set('vanilla/Item_75.png', packImg);
    const r = atlas.vicon(75);
    expect(r).toEqual({ img: packImg, sx: 0, sy: 0, sw: 22, sh: 208 });
    // 76 无包键：走图集通道（node 下 ensureVImage pending → null，不抛错即证走了旧路径）
    expect(atlas.vicon(76)).toBeNull();
  });
});
