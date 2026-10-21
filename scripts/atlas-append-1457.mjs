// 1457 新素材追加式集成:既有 vanilla.json 条目零改动(教训:全量重排会破坏
// SW/索引缓存链,2026-08-21 贴图全错事故)。新素材走:
//   ①49 新物品(6147-6195)→ 新页 Item_Atlas_2.png(shelf-pack,与 vanilla-atlas.mjs
//     同机制:2048²/2px gutter/按高度降序) + items/itemNames 增键
//   ②tile 753 → Tiles_753.png 单图 + tiles/tileNames 增键(元数据取 TEdit tiles.json)
//   ③单图直引族拷贝:Projectile_1111-1135 / Buff_389-400 / Acc 新条 / Extra_304-315 /
//     Glow_379-383(运行时懒加载按文件名命中,无需 json 键)
// 用法:node scripts/atlas-append-1457.mjs   (在 game/ 下;幂等:已存在的键跳过)
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const ASSETS = join(ROOT, '..', 'terraria-assets', 'Images');
const XNB_NEW = '/tmp/recon/xnb1457_new';
const TEDIT = join(ROOT, '..', 'Terraria-Map-Editor', 'src', 'TEdit.Terraria', 'Data');
const OUT_DIR = join(ROOT, 'public', 'sprites', 'vanilla');
const OUT_JSON = join(ROOT, 'public', 'sprites', 'vanilla.json');

const srcOf = (name) => existsSync(join(ASSETS, name)) ? join(ASSETS, name)
  : existsSync(join(ASSETS, 'Accessories', name)) ? join(ASSETS, 'Accessories', name)
  : existsSync(join(XNB_NEW, name)) ? join(XNB_NEW, name) : null;

function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const before = readFileSync(OUT_JSON, 'utf8');
const v = JSON.parse(before);
const items = JSON.parse(readFileSync(join(TEDIT, 'items.json'), 'utf8'));
const tilesT = JSON.parse(readFileSync(join(TEDIT, 'tiles.json'), 'utf8'));
const itemById = new Map(items.map((i) => [i.id, i]));
const tileById = new Map(tilesT.map((t) => [t.id, t]));
let copied = 0, missing = [];

// ---- ① 49 新物品 → Item_Atlas_2 ----
const ATLAS_W = 2048, ATLAS_H = 2048, GUTTER = 2;
const NEW_ITEMS = [];
for (let id = 6147; id <= 6195; id++) {
  if (v.items[String(id)]) continue; // 幂等
  const meta = itemById.get(id);
  const src = srcOf(`Item_${id}.png`);
  if (!meta || !src) { missing.push(`Item_${id}(${!meta ? 'meta' : 'png'})`); continue; }
  NEW_ITEMS.push({ id, meta, src, ...pngSize(src) });
}
if (NEW_ITEMS.length) {
  NEW_ITEMS.sort((a, b) => b.h - a.h);
  const page = new PNG({ width: ATLAS_W, height: ATLAS_H });
  let x = GUTTER, y = GUTTER, shelfH = 0;
  for (const { id, meta, src, w: iw, h: ih } of NEW_ITEMS) {
    if (x + iw + GUTTER > ATLAS_W) { x = GUTTER; y += shelfH + GUTTER; shelfH = 0; }
    if (y + ih + GUTTER > ATLAS_H) { writeFileSync(join(OUT_DIR, 'Item_Atlas_3.png'), PNG.sync.write(page)); throw new Error('溢出到第 4 页——扩充脚本'); }
    const png = PNG.sync.read(readFileSync(src));
    PNG.bitblt(png, page, 0, 0, iw, ih, x, y);
    v.items[String(id)] = { name: meta.name, key: meta.key, createTile: meta.createTile ?? null, icon: 'vanilla/Item_Atlas_2.png', ix: x, iy: y, iw, ih };
    v.itemNames[String(id)] = meta.name ?? '';   // ★SW-FX26（2026-09-10）：items/itemNames 成对写——
                                                 //   本文件头契约"items/itemNames 增键",8/21 批漏 itemNames 半边
    x += iw + GUTTER;
    if (ih > shelfH) shelfH = ih;
  }
  writeFileSync(join(OUT_DIR, 'Item_Atlas_2.png'), PNG.sync.write(page));
  console.log(`Item_Atlas_2.png: ${NEW_ITEMS.length} 新物品`);
}

// ---- ①a itemNames 49 键缺口回填（SW-FX26 / FX22 定谳,2026-09-10）----
// 8/21 追加批 items 6147-6195 已落库而 itemNames 全缺（只写 items 忘 itemNames,
// 头部契约漏半边）——唯 WldImport vanillaItemNames 查表 miss 面。名字源=已落库
// items[k].name（TEdit items.json 显示名,与既有 itemNames 命名法同源:
// 6144'Music Box (Skeletron)'/6146'Music Box (Silence)'逐字一致）。幂等:
// items 缺或 itemNames 已有即跳过;纯增键,既有键零改动。
let named = 0;
for (let id = 6147; id <= 6195; id++) {
  const ks = String(id);
  if (v.items[ks]?.name && !v.itemNames[ks]) { v.itemNames[ks] = v.items[ks].name; named++; }
}
if (named) console.log(`itemNames 回填: ${named} 键（6147-6195）`);

// ---- ①b TEdit 缺口补打包（2026-08-22 资产审计 ❌1）----
// TEdit items.json 缺 26 个 1.4.4+ 新物品 id（0/2772/2773/2775/2777/2778/2780/
// 2782/2783/2785/2881/3462/3463/3465/3847-3851/3861/3862/3978/4010/4058/4143/
// 4722），其中已注册进游戏数据的仅 4722 First Fractal（items.ts vi_4722_first_fractal，
// itemfunc melee/shoot 857/useStyle 5）——缺键时 vicon(4722) 返回 null → 程序化兜底
// 图标。其余 25 张源图无 def/itemfunc 消费方（审计 ❌2 备案，注册时在此补一行）。
// ★勿改回 vanilla-atlas.mjs 主驱动：全量重跑会重排既有子矩形并丢弃本脚本追加键
// （2026-08-21 贴图全错事故）。此处走单体直引（vicon 无 ix/iy 即整图语义），
// 幂等：键已存在即跳过。
if (!v.items['4722']) {
  const src = srcOf('Item_4722.png');
  if (src) {
    copyFileSync(src, join(OUT_DIR, 'Item_4722.png')); copied++;
    v.items['4722'] = { name: 'First Fractal', key: 'FirstFractal', createTile: null, icon: 'vanilla/Item_4722.png' };
    v.itemNames['4722'] = 'First Fractal';
    console.log('TEdit 缺口补打包: Item_4722 First Fractal（单体直引）');
  } else missing.push('Item_4722(png)');
}

// ---- ①c TEdit 缺口有消费方补注册（★BJ69 2026-09-14,RB15 债账「3861/3862 物品注册」）----
// 3861/3862 = Ogre/DarkMage 宝藏袋（ItemID.cs:9268/:9270 BossBagOgre/BossBagDarkMage;
// ItemID.Sets.BossBag 全集成员=vanillaBossBags.ts BOSS_BAG_IDS 锚）。TEdit items.json
// 缺条目（①b 注 26 件清单）→ vanilla.json items/itemNames 增键 + 源图单体直引。
// 注册后 items.ts 自动注册循环（vanilla.json 驱动）产出 def=玩家可持用,右键开包面
// （UI.tryOpenContainer → openBagItem 首支 BOSS_BAG_IDS 路由 openBossBag）自动覆盖;
// 3861/3862 主战利品 case 整缺+NPC 576/564 value=0f（NPC.cs:16314/:16484）→ 开袋
// 零产出=原版刻意,不改产出。命名:官 l10n 无 ItemName.BossBagOgre/BossBagDarkMage 键
// （en-US Items.json 仅 BossBag* 系 tooltip 键,id-maps en='none'=官方未本地化）——
// name 按袋族命名法补（3860 'Treasure Bag (Betsy)' 同源 TEdit 面）;key 用 ItemID.cs
// 常量名。显示名 = tools/l10n-custom ItemName.* 补译（en 官名不存在,按袋族式样）。
if (!v.items['3861'] || !v.items['3862']) {
  const EXTRA_ITEMS = {
    3861: { name: 'Treasure Bag (Ogre)', key: 'BossBagOgre' },
    3862: { name: 'Treasure Bag (Dark Mage)', key: 'BossBagDarkMage' },
  };
  for (const [idStr, meta] of Object.entries(EXTRA_ITEMS)) {
    if (v.items[idStr]) continue;   // 幂等
    const src = srcOf(`Item_${idStr}.png`);
    if (!src) { missing.push(`Item_${idStr}(png)`); continue; }
    copyFileSync(src, join(OUT_DIR, `Item_${idStr}.png`)); copied++;
    v.items[idStr] = { name: meta.name, key: meta.key, createTile: null, icon: `vanilla/Item_${idStr}.png` };
    v.itemNames[idStr] = meta.name;
    console.log(`TEdit 缺口补注册: Item_${idStr} ${meta.name}（单体直引）`);
  }
}

// ---- ② tile 753 ----
if (!v.tiles['753']) {
  const meta = tileById.get(753);
  const src = srcOf('Tiles_753.png');
  if (meta && src) {
    copyFileSync(src, join(OUT_DIR, 'Tiles_753.png')); copied++;
    const base = {
      name: meta.name, key: meta.key, sheet: 'vanilla/Tiles_753.png',
      solid: !!meta.solid, blend: !!meta.blend, framed: !!meta.framed, light: !!meta.light,
      color: meta.color ?? '#9A8FA0', placement: meta.placement ?? null,
      grid: meta.textureGrid ?? [16, 16],
      stride: meta.textureGrid
        ? [meta.textureGrid[0] + (Array.isArray(meta.frameGap) ? meta.frameGap[0] : (meta.frameGap ?? 2)),
           meta.textureGrid[1] + (Array.isArray(meta.frameGap) ? meta.frameGap[1] : (meta.frameGap ?? 2))]
        : [18, 18],
      frameSize: meta.frameSize ?? [[1, 1]], isStone: false, isGrass: false, mergeWith: null,
    };
    // cols/rows 与原管线一致:从 png 实际尺寸按 stride 推
    const { w, h } = pngSize(src);
    base.cols = Math.floor(w / base.stride[0]);
    base.rows = Math.floor(h / base.stride[1]);
    v.tiles['753'] = base;
    v.tileNames['753'] = meta.name;
    console.log('tile 753 增键:', meta.name, `${base.cols}x${base.rows}`);
  } else missing.push(`Tiles_753(${!meta ? 'meta' : 'png'})`);
}

// ---- ②b 伪装宝箱族(TextureCopyLoad:icon 复制源箱矩形;items.ts 自动注册循环生效) ----
{
  const raw = readFileSync(join(ROOT, '..', 'Terarria1457', 'Terraria.ID', 'ItemID.cs'), 'utf8');
  const seg = raw.split('TextureCopyLoad = Factory.CreateIntSet(-1,')[1].split(');')[0];
  const nums = seg.match(/\d+/g).map(Number);
  const tex = {};
  for (let i = 0; i + 1 < nums.length; i += 2) tex[nums[i]] = nums[i + 1];
  const tedit = JSON.parse(readFileSync(join(TEDIT, 'items.json'), 'utf8'));
  const tbyid = new Map(tedit.map((i) => [i.id, i]));
  for (const [fakeStr, src] of Object.entries(tex)) {
    const ks = String(fakeStr);
    if (v.items[ks]) continue;
    const meta = tbyid.get(Number(ks));
    const srcE = v.items[String(src)];
    if (!meta || !srcE) continue;
    v.items[ks] = { name: meta.name ?? '', key: meta.key ?? '', createTile: meta.createTile ?? null,
      icon: srcE.icon, ix: srcE.ix, iy: srcE.iy, iw: srcE.iw, ih: srcE.ih };
    v.itemNames[ks] = meta.name ?? '';
  }
}

// ---- ③ 单图直引族 ----
const SINGLES = [];
for (let id = 1111; id <= 1135; id++) SINGLES.push(`Projectile_${id}.png`);
for (let id = 389; id <= 400; id++) SINGLES.push(`Buff_${id}.png`);
for (const id of [40, 41]) SINGLES.push(`Acc_Back_${id}.png`);
SINGLES.push('Acc_Front_17.png', 'Acc_Neck_13.png', 'Acc_Neck_14.png',
  'Acc_Shield_10.png', 'Acc_Shield_11.png', 'Acc_Shield_12.png', 'Acc_Waist_17.png');
for (let id = 25; id <= 32; id++) SINGLES.push(`Acc_HandsOn_${id}.png`);
for (let id = 16; id <= 18; id++) SINGLES.push(`Acc_HandsOff_${id}.png`);
for (let id = 304; id <= 315; id++) SINGLES.push(`Extra_${id}.png`);
for (let id = 379; id <= 383; id++) SINGLES.push(`Glow_${id}.png`);
// ★BJ704-G2（2026-10-21,债③）：Glow_200（32×54）——630 幻象弓载体 GlowMask[200]
//  白127 柔光叠画（Main.cs:32670,EntitySpriteDraw GlowMask 表=Images/Glow_N.png 直引）
SINGLES.push('Glow_200.png');
// ★SW-FX9（2026-09-10）：Item_75 陨星（22×208 竖 8 帧）——764 UpbeatStar 宠物
// DrawProjWithStarryTrail 覆绘消费（Main.cs:38326-38332 Frame(1,8) 取顶帧;
// 资产面处置裁决=索资产:terraria-assets/Images/Item_75.png 在源池,非占位/跳过）
SINGLES.push('Item_75.png');
for (const name of SINGLES) {
  const dst = join(OUT_DIR, name);
  if (existsSync(dst)) continue;
  const src = srcOf(name);
  if (!src) { missing.push(name); continue; }
  copyFileSync(src, dst); copied++;
}
console.log(`单图拷贝: ${copied} 张`);

// ---- 写回 + 自验:既有键零改动 ----
const after = JSON.stringify(v);
const vAfter = JSON.parse(after);
let drift = 0;
for (const seg of ['tiles', 'items', 'walls', 'npcs', 'armorIndex', 'tileNames', 'itemNames']) {
  for (const k of Object.keys(v[seg])) {
    if (JSON.stringify(v[seg][k]) !== JSON.stringify(vAfter[seg][k])) drift++;
  }
}
if (drift) throw new Error(`既有键被改动 ${drift} 处——中止写回`);
writeFileSync(OUT_JSON, after);
console.log(`vanilla.json: items ${Object.keys(v.items).length} / itemNames ${Object.keys(v.itemNames).length} / tiles ${Object.keys(v.tiles).length}`);
if (missing.length) { console.log('缺失(未阻塞):', missing.join(', ')); }
console.log('OK');
