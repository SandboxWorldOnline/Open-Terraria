// ★P0-A 资产面完整性锁（2026-09-27 星云案:Projectile_618 以小写 project_618 落盘,
//   索引/分片按小写名收编,运行时按规范大写名取 → 发布面 404 → 兜底 stroke 病）。
// 三道对账(全部大小写敏感——APFS existsSync 大小写不敏感,必须 readdir 精确比对):
//   ①index→disk:assets-index.json(miscVanilla+miscUi) 每条目在盘上存在【精确同名】;
//   ②disk→index:按 genAssetsIndex 同一排除面(Item_Atlas_*/Tiles_N/Wall_N/NPC_N),
//     盘上每个 png 必须入索引——防「文件晚于索引落盘」类静默漏编(本 Incident 根因);
//   ③zip→disk:pack-assets manifest 全条目盘上精确同名——分片与盘面零漂移;
//   ④家族大小写规范面:运行时按 Projectile_N/Gore_N 等规范大写插值取图——盘上家族
//     文件若以小写词首落盘(源库小写案:projectile_179/618、gore_240)即红。
//   dist-release 面(发布产物,CI 可能无此目录→存在才验):index/manifest 同步对账。
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PUB = join(ROOT, 'public');

/** genAssetsIndex 的排除面（scripts/vanilla-atlas.mjs:533 原式）——tiles/walls/npcs
 *  走 vanilla.json 表驱动枚举,Item_Atlas 走 preloadIcons 专用通道,均不入 misc 索引 */
function miscVanillaFilter(f: string): boolean {
  return f.endsWith('.png') && !/^Item_Atlas_/.test(f)
    && !/^Tiles_\d+\.png$/.test(f) && !/^Wall_\d+\.png$/.test(f) && !/^NPC_\d+\.png$/.test(f);
}

/** 运行时按规范大写词首插值取图的家族（运行时 request 形如 `vanilla/${fam}_${id}.png`;
 *  源库小写变体 project_618/gore_240/projectile_179 已修,此锁防复发） */
const CANONICAL_FAMILIES: ReadonlyArray<[RegExp, string]> = [
  [/^projectile_(\d+)\.png$/i, 'Projectile_'],
  [/^gore_(\d+)\.png$/i, 'Gore_'],
  [/^npc_(\d+)\.png$/i, 'NPC_'],
  [/^item_(\d+)\.png$/i, 'Item_'],
  [/^tiles_(\d+)\.png$/i, 'Tiles_'],
  [/^wall_(\d+)\.png$/i, 'Wall_'],
  [/^glow_(\d+)\.png$/i, 'Glow_'],
  [/^extra_(\d+)\.png$/i, 'Extra_'],
  [/^chain(\d*)\.png$/i, 'Chain'],
  [/^cloud_(\d+)\.png$/i, 'Cloud_'],
  [/^moon_(\d+)\.png$/i, 'Moon_'],
  [/^coin_(\d+)\.png$/i, 'Coin_'],
  [/^waterfall_(\d+)\.png$/i, 'Waterfall_'],
  [/^background_(\d+)\.png$/i, 'Background_'],
];

function dirSet(rel: string): Set<string> {
  return new Set(readdirSync(join(PUB, rel)));
}

describe('★P0-A 资产面完整性（index/zip/盘三面大小写敏感对账）', () => {
  const diskVan = dirSet('sprites/vanilla');
  const diskUi = dirSet('sprites/vanilla-ui');

  it('① assets-index 每条目在盘上精确同名（含大小写）', () => {
    const idx = JSON.parse(readFileSync(join(PUB, 'assets-index.json'), 'utf8')) as {
      miscVanilla: string[]; miscUi: string[];
    };
    const missVan = idx.miscVanilla.filter((e) => !diskVan.has(e.slice('sprites/vanilla/'.length)));
    const missUi = idx.miscUi.filter((e) => !diskUi.has(e.slice('sprites/vanilla-ui/'.length)));
    expect(missVan, `索引条目盘上缺/大小写漂移: ${missVan.slice(0, 20).join(', ')}`).toEqual([]);
    expect(missUi, `索引条目盘上缺/大小写漂移: ${missUi.slice(0, 20).join(', ')}`).toEqual([]);
  });

  it('② 盘上每个 misc png 必已入索引（防文件晚于索引落盘的静默漏编）', () => {
    const idx = JSON.parse(readFileSync(join(PUB, 'assets-index.json'), 'utf8')) as {
      miscVanilla: string[]; miscUi: string[];
    };
    const idxVan = new Set(idx.miscVanilla);
    const idxUi = new Set(idx.miscUi);
    const leakVan = [...diskVan].filter(miscVanillaFilter)
      .filter((f) => !idxVan.has(`sprites/vanilla/${f}`));
    const leakUi = [...diskUi].filter((f) => !idxUi.has(`sprites/vanilla-ui/${f}`));
    expect(leakVan, `盘上未入索引: ${leakVan.slice(0, 20).join(', ')}（重跑 vanilla-atlas --index-only）`).toEqual([]);
    expect(leakUi, `盘上未入索引: ${leakUi.slice(0, 20).join(', ')}（重跑 vanilla-atlas --index-only）`).toEqual([]);
  });

  it('③ pack-assets manifest 全条目盘上精确同名（分片↔盘零漂移）', () => {
    // ★开源仓 clone 修复（2026-11-02）:assets-zip/=gitignore 开发机打包产物,clone
    //   侧缺=本面 skip（对照 ⑤ dist-release 存在才验同形）。
    const mPath = join(PUB, 'assets-zip', 'manifest.json');
    if (!existsSync(mPath)) return;
    const m = JSON.parse(readFileSync(mPath, 'utf8')) as {
      parts: Array<{ entries: string[] }>;
    };
    const bad: string[] = [];
    for (const p of m.parts) {
      for (const e of p.entries) {
        let ok = false;
        if (e.startsWith('sprites/vanilla/')) ok = diskVan.has(e.slice('sprites/vanilla/'.length));
        else if (e.startsWith('sprites/vanilla-ui/')) ok = diskUi.has(e.slice('sprites/vanilla-ui/'.length));
        else ok = existsSync(join(PUB, e));   // fonts/sounds/audios 非大小写敏感域,存在性即可
        if (!ok) bad.push(e);
      }
    }
    expect(bad, `manifest 条目盘上缺/大小写漂移: ${bad.slice(0, 20).join(', ')}（重跑 pack-assets）`).toEqual([]);
  });

  it('④ 家族文件词首大小写=运行时规范形（小写变体=发布面 404 源）', () => {
    const bad: string[] = [];
    for (const name of diskVan) {
      for (const [re, canon] of CANONICAL_FAMILIES) {
        if (re.test(name) && !name.startsWith(canon)) { bad.push(`${name}（应为 ${canon}*）`); break; }
      }
    }
    for (const name of diskUi) {
      for (const [re, canon] of CANONICAL_FAMILIES) {
        if (re.test(name) && !name.startsWith(canon)) { bad.push(`${name}（应为 ${canon}*）`); break; }
      }
    }
    expect(bad, `家族文件大小写漂移: ${bad.slice(0, 20).join(', ')}`).toEqual([]);
  });

  it('⑤ dist-release 面（存在才验）:index/manifest 与盘同步', () => {
    const rel = join(ROOT, 'dist-release');
    if (!existsSync(join(rel, 'assets-index.json'))) return;   // CI 无发布产物则跳
    // ★开源仓 clone 修复（2026-11-02）:public/assets-zip 同为 gitignore 产物——
    //   clone 侧两侧都无,⑤ 的对拍对象缺席=skip（dist-release 在而 public 缺
    //   仅发生在藏产物模拟/异常态,不构成可判面）。
    if (!existsSync(join(PUB, 'assets-zip', 'manifest.json'))) return;
    const idx = JSON.parse(readFileSync(join(rel, 'assets-index.json'), 'utf8')) as { miscVanilla: string[] };
    const pubIdx = JSON.parse(readFileSync(join(PUB, 'assets-index.json'), 'utf8')) as { miscVanilla: string[] };
    // 发布 index 与源 index 同源（vite build 直拷 public/）——条目集一致
    expect(new Set(idx.miscVanilla)).toEqual(new Set(pubIdx.miscVanilla));
    const relMan = JSON.parse(readFileSync(join(rel, 'assets-zip', 'manifest.json'), 'utf8')) as {
      parts: Array<{ entries: string[] }>;
    };
    const pubMan = JSON.parse(readFileSync(join(PUB, 'assets-zip', 'manifest.json'), 'utf8')) as {
      parts: Array<{ entries: string[] }>;
    };
    const relAll = new Set(relMan.parts.flatMap((p) => p.entries));
    const pubAll = new Set(pubMan.parts.flatMap((p) => p.entries));
    expect(relAll).toEqual(pubAll);
  });
});
