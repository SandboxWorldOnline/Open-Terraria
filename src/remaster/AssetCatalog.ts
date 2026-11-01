// 素材目录聚合(重制管线单一真源):把分散在六处数据源的切帧定义聚合为
// 统一 AssetEntry 查询。纯函数、零游戏运行时依赖(node 单测与浏览器双端可用):
//   tile/wall → vanilla.json {grid,stride}(以 sheet 实际尺寸步进——cols/rows
//               不可信,压板 135 cols=0 前科;与 vframeAt 语义对齐)
//   npc       → vanilla-npcs.json frames(纵条 frameH=⌊H/frames⌋);
//               2D 网格族 NPC_GRIDS;594 横条/690 拼装等特殊路径 excluded
//   projectile→ vanilla-projframes.json(纵条同 npc)
//   item      → vanilla.json ix/iy/iw/ih 子矩形 + ITEM_ANIMATION 竖切;
//               无矩形独立 PNG 条目(3861/3862,★BJ743-A)整图收录=vicon 回退同构
//   ui        → vanilla-ui.json files(整图;纸娃娃族前缀 excluded)
//   gore/glow/buff/misc → remaster-index.json 清单(整图;液体/树冠/背景 excluded)
import type { VanillaData } from '../assets/SpriteAtlas';
import type { AssetEntry, EntryLayout, FrameRect, RemasterCategory } from './types';
import { NPC_GRIDS, npcGridFrames, type NpcGridDef } from './NpcGridLayouts';

/** 一期排除的 vanilla 文件前缀(整图族;条目仍入目录,灰显给理由) */
const EXCLUDED_FILE_PREFIXES: Array<[RegExp, string]> = [
  [/^vanilla\/Background_\d+/, '大风景图走独立缓存(BiomeBackground.imgs),二期专项'],
  [/^vanilla\/Tree_Tops_\d+|^vanilla\/Tree_Branches_\d+/, '树冠/树枝带 marker 变体带语义(fy=198/220/242),二期专项'],
  [/^vanilla\/Liquid_\d+|^vanilla\/Misc_water_\d+|^vanilla\/Waterfall_\d+/, '液体纹理是程序化合成的输入而非普通贴图,替换破坏液体渲染'],
  [/^vanilla\/NPC_Head(_Boss)?_/, '旗帜头像(独立 vmisc 消费),二期'],
];
/** 一期排除的 vanilla-ui 键前缀(纸娃娃族:复合变体网格,重制破坏肢体装配/通道回退) */
const EXCLUDED_UI_PREFIXES: Array<[RegExp, string]> = [
  [/^Player_\d+_\d+\.png$/, '纸娃娃变体通道(40×56×20 复合网格),二期专项'],
  [/^Armor_(Head|Armor|Legs)_\d+\.png$/, '盔甲纸娃娃族(9×4 复合变体网格),二期专项'],
];
/** 特殊渲染路径 NPC(不走纵条/网格,通用切帧必错) */
const EXCLUDED_NPC: Record<number, string> = {
  594: '横条 8 变体(256×76=32×76×8,变体=ai[2]),走 drawWindyBalloon 专属路径',
  690: '雕像宝箱怪恒画 Tiles_105 拼装形态,不消费 NPC_690 贴图',
};

export interface CatalogInput {
  vanilla: VanillaData;
  /** vanilla-npcs.json 原始形状(id → {frames?,name?,…}) */
  npcData: Record<string, { frames?: number; name?: string }>;
  /** vanilla-projframes.json(id → 帧数;缺省 1) */
  projFrames: Record<string, number>;
  /** vanilla-ui.json .files(键 → 'vanilla-ui/xxx.png') */
  uiFiles: Record<string, string>;
  /** remaster-index.json(sheet → [w,h];tile/wall/npc/projectile 帧枚举依赖) */
  sizes: Record<string, [number, number]>;
  /** ITEM_ANIMATION 形状(只取 n;浏览器端由调用方从 SpriteAtlas 传入) */
  itemAnim?: Record<number, { n: number }>;
  /** 2D 网格 NPC 布局(缺省 NPC_GRIDS) */
  npcGrid?: Record<number, NpcGridDef>;
}

export interface Catalog {
  entries: AssetEntry[];
  byKey: Map<string, AssetEntry>;
  byCategory: Map<RemasterCategory, AssetEntry[]>;
}

/** 按 stride 步进枚举网格帧(行优先;与 vframeAt 任意偏移语义一致——
 *  cols/rows 只来自 TEdit 元数据,压板 135 cols=0 前科,不可信) */
export function gridFrames(sheetW: number, sheetH: number, grid: readonly [number, number], stride: readonly [number, number]): FrameRect[] {
  const out: FrameRect[] = [];
  let idx = 0;
  for (let y = 0; y + grid[1] <= sheetH; y += stride[1]) {
    for (let x = 0; x + grid[0] <= sheetW; x += stride[0]) {
      out.push({ x, y, w: grid[0], h: grid[1], frameIdx: idx++ });
    }
  }
  return out;
}

/** 纵条帧枚举(frameH=⌊H/frames⌋,与 vnpc/projFrameImg 同式) */
export function vstripFrames(sheetW: number, sheetH: number, count: number): FrameRect[] {
  if (count <= 1) return [{ x: 0, y: 0, w: sheetW, h: sheetH, frameIdx: 0 }];
  const fh = Math.floor(sheetH / count);
  const out: FrameRect[] = [];
  for (let i = 0; i < count; i++) out.push({ x: 0, y: i * fh, w: sheetW, h: fh, frameIdx: i });
  return out;
}

function excludedFor(file: string): string | undefined {
  for (const [re, why] of EXCLUDED_FILE_PREFIXES) if (re.test(file)) return why;
  return undefined;
}

/** 聚合六类数据源 → 统一目录 */
export function buildCatalog(inp: CatalogInput): Catalog {
  const entries: AssetEntry[] = [];
  const sizes = inp.sizes ?? {};
  const sizeOf = (file: string): [number, number] | null => sizes[file] ?? null;

  // ---- tile ----
  for (const [id, m] of Object.entries(inp.vanilla.tiles)) {
    const sz = sizeOf(m.sheet);
    const frames = sz ? gridFrames(sz[0], sz[1], m.grid, m.stride) : [];
    entries.push({
      key: `tile:${id}`, category: 'tile', name: m.name, sheet: m.sheet,
      layout: 'grid', frames,
      meta: { grid: m.grid, stride: m.stride, excluded: sz ? undefined : '缺 sheet 尺寸(remaster-index 未收录)' },
    });
  }
  // ---- wall ----
  for (const [id, m] of Object.entries(inp.vanilla.walls)) {
    const sz = sizeOf(m.sheet);
    const frames = sz ? gridFrames(sz[0], sz[1], m.grid, m.stride) : [];
    entries.push({
      key: `wall:${id}`, category: 'wall', name: m.name, sheet: m.sheet,
      layout: 'grid', frames,
      meta: { grid: m.grid, stride: m.stride, excluded: sz ? undefined : '缺 sheet 尺寸(remaster-index 未收录)' },
    });
  }
  // ---- npc(纵条 + 2D 网格 + 特殊排除) ----
  const npcGrid = inp.npcGrid ?? NPC_GRIDS;
  for (const [id, nd] of Object.entries(inp.npcData)) {
    const nid = Number(id);
    const sheet = `vanilla/NPC_${nid}.png`;
    const name = nd.name ?? `NPC ${nid}`;
    const excl = EXCLUDED_NPC[nid];
    if (excl) {
      // 排除=不能【按帧】切分(frames 空 → complete 只取决于整图记录);
      // 整图重制经 WHOLE_FRAME_IDX 哨兵走工作台 whole 模式
      entries.push({ key: `npc:${id}`, category: 'npc', name, sheet, layout: 'whole', frames: [], meta: { excluded: excl } });
      continue;
    }
    const grid = npcGrid[nid];
    if (grid) {
      // 显式网格布局:cellW×cellH×cols×rows 是权威尺寸(不依赖 index;
      // sheet 实际尺寸只作越界钳制)
      const sz = sizeOf(sheet) ?? [grid.cols * grid.cellW, grid.rows * grid.cellH];
      const rects = npcGridFrames(grid, sz[0], sz[1]);
      entries.push({
        key: `npc:${id}`, category: 'npc', name, sheet, layout: 'grid2d',
        frames: rects.map((r, i) => ({ ...r, frameIdx: i })),
      });
      continue;
    }
    // vanilla.json 20 条显式 meta 优先(frameH 权威,不依赖 index)
    const explicit = inp.vanilla.npcs?.[id];
    const frames = explicit
      ? vstripFrames(explicit.frameW, explicit.frameH * explicit.count, explicit.count)
      : (sizeOf(sheet) ? vstripFrames(sizeOf(sheet)![0], sizeOf(sheet)![1], nd.frames ?? 1) : []);
    entries.push({
      key: `npc:${id}`, category: 'npc', name, sheet,
      layout: (explicit?.count ?? nd.frames ?? 1) > 1 ? 'vstrip' : 'whole',
      frames,
      meta: { excluded: (!explicit && !sizeOf(sheet)) ? '缺 sheet 尺寸(remaster-index 未收录)' : undefined },
    });
  }
  // 网格族兜底:vanilla-npcs.json 是 SetDefaults 提取,个别网格 NPC(如 696)
  // 缺登记——凡 npcGrid 表有而 npcData 无的,按网格布局补建条目
  for (const [id, grid] of Object.entries(npcGrid)) {
    if (inp.npcData[id]) continue;
    const sheet = `vanilla/NPC_${id}.png`;
    const sz = sizeOf(sheet) ?? [grid.cols * grid.cellW, grid.rows * grid.cellH];
    const rects = npcGridFrames(grid, sz[0], sz[1]);
    entries.push({
      key: `npc:${id}`, category: 'npc', name: `NPC ${id}`, sheet, layout: 'grid2d',
      frames: rects.map((r, i) => ({ ...r, frameIdx: i })),
    });
  }
  // ---- projectile ----
  const projIds = new Set<string>(Object.keys(inp.projFrames));
  for (const file of Object.keys(sizes)) {
    const m = /^vanilla\/Projectile_(\d+)\.png$/.exec(file);
    if (!m) continue;
    projIds.delete(m[1]);
  }
  for (const file of Object.keys(sizes)) {
    const m = /^vanilla\/Projectile_(\d+)\.png$/.exec(file);
    if (!m) continue;
    const id = m[1];
    const sz = sizeOf(file)!;
    const frames = vstripFrames(sz[0], sz[1], inp.projFrames[id] ?? 1);
    entries.push({
      key: `proj:${id}`, category: 'projectile', name: `Projectile ${id}`, sheet: file,
      layout: (inp.projFrames[id] ?? 1) > 1 ? 'vstrip' : 'whole', frames,
    });
  }
  // projFrames 里登记但 index 无文件的(理论不存在;防御)
  for (const id of projIds) {
    entries.push({ key: `proj:${id}`, category: 'projectile', name: `Projectile ${id}`, sheet: `vanilla/Projectile_${id}.png`, layout: 'whole', frames: [], meta: { excluded: '缺 sheet 尺寸(remaster-index 未收录)' } });
  }
  // ---- item(shelf-pack 进 Item_Atlas 子矩形;动画物品竖切;无矩形独立 PNG 整图) ----
  for (const [id, m] of Object.entries(inp.vanilla.items)) {
    const anim = inp.itemAnim?.[Number(id)];
    let frames: FrameRect[];
    let layout: EntryLayout = 'subrect';
    let excl: string | undefined;
    if (m.ix === undefined || m.iw === undefined || m.ih === undefined) {
      // ★BJ743-A（2026-10-31,R24 SEV-3 棘轮实红;BJ731 让位「atlas-append 自愈」
      //   销案定谳）：3861/3862（Ogre/DarkMage 宝藏袋）经 atlas-append-1457 追加通道
      //   以独立 PNG 落盘——icon 指 vanilla/Item_<id>.png 且【无】ix/iy/iw/ih 子矩形
      //   （4722 First Fractal 同形但有显式矩形）。SpriteAtlas.vicon 对无矩形条目
      //   回退【整图】语义（sx0/sy0/整宽高）,本目录同构收录,否则 item 计数对拍
      //   6174≠6176 + 帧枚举 byKey 缺键爆红。尺寸取 remaster-index（IHDR 真值）;
      //   缺尺寸=防御档 excluded 条目（类别计数仍保全量）。
      const sz = sizeOf(m.icon);
      layout = 'whole';
      frames = sz ? [{ x: 0, y: 0, w: sz[0], h: sz[1], frameIdx: 0 }] : [];
      excl = sz ? undefined : '缺 sheet 尺寸(remaster-index 未收录)';
    } else {
      const x = m.ix, y = m.iy ?? 0, w = m.iw, h = m.ih;
      if (anim && anim.n > 1) {
        // 竖条动画物品:整条被打包进 atlas,按 n 竖切(sliceItemAnimFrame 同式)
        const fh = Math.floor(h / anim.n);
        frames = Array.from({ length: anim.n }, (_, i) => ({ x, y: y + i * fh, w, h: fh, frameIdx: i }));
      } else {
        frames = [{ x, y, w, h, frameIdx: 0 }];
      }
    }
    entries.push({
      key: `item:${id}`, category: 'item', name: m.name, sheet: m.icon,
      layout, frames,
      meta: { animFrames: anim && anim.n > 1 ? anim.n : undefined, excluded: excl },
    });
  }
  // ---- ui(整图;纸娃娃族排除;尺寸来自 remaster-index) ----
  for (const [key, file] of Object.entries(inp.uiFiles)) {
    let excl: string | undefined;
    for (const [re, why] of EXCLUDED_UI_PREFIXES) if (re.test(key)) { excl = why; break; }
    const sz = sizeOf(file);
    entries.push({
      key: `ui:${key}`, category: 'ui', name: key, sheet: file,
      layout: 'whole',
      // excluded(纸娃娃族)=不能逐帧;frames 清空,整图走 whole 模式
      frames: excl ? [] : (sz ? [{ x: 0, y: 0, w: sz[0], h: sz[1], frameIdx: 0 }] : []),
      meta: { excluded: excl },
    });
  }
  // ---- gore/glow/buff/misc(整图;index 全量减去已归属族) ----
  const claimed = new Set<string>(entries.map((e) => e.sheet));
  for (const file of Object.keys(sizes)) {
    if (!file.startsWith('vanilla/') || claimed.has(file)) continue;
    if (/^vanilla\/(Tiles|Wall|NPC|Projectile|Item_Atlas|Player_|Armor_)/.test(file)) continue; // 已归属/纸娃娃
    let category: RemasterCategory = 'misc';
    let id = file.replace(/^vanilla\//, '').replace(/\.png$/, '');
    let name = id;
    let m = /^vanilla\/Gore_(\d+)\.png$/.exec(file);
    if (m) { category = 'gore'; id = m[1]; name = `Gore ${id}`; }
    else if ((m = /^vanilla\/Glow_(\d+)\.png$/.exec(file))) { category = 'glow'; id = m[1]; name = `Glow ${id}`; }
    else if ((m = /^vanilla\/Buff_(\d+)\.png$/.exec(file))) { category = 'buff'; id = m[1]; name = `Buff ${id}`; }
    const mExcl = excludedFor(file);
    entries.push({
      key: `${category}:${id}`, category, name, sheet: file,
      layout: 'whole',
      // excluded(液体/树冠/背景等)=不能逐帧;整图走 whole 模式(frames 清空)
      frames: mExcl ? [] : [{ x: 0, y: 0, w: sizes[file][0], h: sizes[file][1], frameIdx: 0 }],
      meta: { excluded: mExcl },
    });
  }

  const byKey = new Map(entries.map((e) => [e.key, e]));
  const byCategory = new Map<RemasterCategory, AssetEntry[]>();
  for (const e of entries) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e); byCategory.set(e.category, list);
  }
  return { entries, byKey, byCategory };
}
