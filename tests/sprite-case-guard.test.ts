// ★BJ706-B（2026-10-22 用户转报 Linux 部署实报:贴图文件名大小写错配）防复发锁。
//  机制:macOS 大小写不敏感 FS 上,git 索引名与盘面名、代码引用与盘面名的**大小写
//  差异无声工作**;Linux 部署（大小写敏感）checkout 落索引名 → 代码引用大写名 404。
//  实报三枚（部署仓 7bfb35d 修）:gore_240/projectile_179/projectile_618 → 本仓索引
//  随刀同修（git mv 大写）+ 本锁钉死两面:
//  §1 git 索引名 vs 盘面名 逐字节等（防再写入错大小写文件）;
//  §2 src 代码字面量引用（'vanilla/…​.png' 等）vs 盘面 大小写精确命中（防引用错大小写）;
//  §3 动态族前缀大小写不变式（模板串引用=§2 正则盲区兜底;★BJ718-A/R17-D2 扩四族）;
//  §4 remaster-index.json 数据面 ≡ 盘面 PNG（json 数据文件=§1-§3 盲区;★BJ718-A/R17-D3）。
//  ★M1 变异（索引回小写或引用改错大小写）→ 恰红。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';

const GAME = join(__dirname, '..');

function gitLsSprites(): string[] {
  return execFileSync('git', ['ls-files', 'public/sprites/'], { cwd: GAME, encoding: 'utf8' })
    .split('\n').filter((l) => l.length > 0);
}

function diskSprites(): Map<string, string> {
  const m = new Map<string, string>();   // lower → 精确名
  for (const f of globSync(join(GAME, 'public/sprites/**/*.*'))) {
    const rel = f.startsWith(GAME + '/') ? f.slice(GAME.length + 1) : f;   // globSync 绝对路径→仓相对（join 尾斜杠双拼坑）
    m.set(rel.toLowerCase(), rel);
  }
  return m;
}

describe('§1 git 索引名 ≡ 盘面名（逐字节）', () => {
  it('全部 sprites 索引路径在盘上以相同大小写存在', () => {
    const idx = gitLsSprites();
    expect(idx.length).toBeGreaterThan(5000);   // 资产库规模下限（防空跑假绿）
    const disk = diskSprites();
    const bad: string[] = [];
    for (const p of idx) {
      if (disk.get(p.toLowerCase()) !== p) bad.push(p);
    }
    expect(bad, `索引/盘面大小写错配 ${bad.length} 枚: ${bad.slice(0, 10).join(', ')}`).toEqual([]);
  });
});

describe('§2 代码引用大小写精确命中盘面', () => {
  it("src 内 'vanilla|misc|ui/xxx.png' 字面量全部精确存在", () => {
    const disk = diskSprites();
    const bad: string[] = [];
    const seen = new Set<string>();
    // 采样扫描 src 全量 .ts/.mjs（引用面大,扫描一次缓存）
    const files = globSync(join(GAME, 'src/**/*.{ts,mjs}'));
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/['"]((?:vanilla|misc|ui)\/[A-Za-z0-9_\-./]+\.png)['"]/g)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const full = `public/sprites/${m[1]}`;
        if (disk.get(full.toLowerCase()) !== full) bad.push(m[1]);
      }
    }
    expect(seen.size).toBeGreaterThan(50);   // 引用面规模下限
    expect(bad, `引用大小写错配 ${bad.length} 枚: ${bad.slice(0, 10).join(', ')}`).toEqual([]);
  });
});

describe('§3 动态族前缀大小写不变式（模板串引用盲区兜底）', () => {
  it('vanilla/ 下 Gore_/Projectile_/NPC_/Item_/Extra_/Glow_/Tiles_/Chain/Portrait_/Waterfall_/Armor_/Shimmered_/Misc_ 族禁小写前缀', () => {
    // ★BJ718-A(R17-D2) 扩四前缀:Waterfall_/Armor_/Shimmered_/Misc_——WaterfallRenderer
    // :181-205(`vanilla/Waterfall_${…}.png`)与 packPaths:140-153(`vanilla/Shimmered_${…}`/
    // `vanilla/Armor_${…}`/SUBDIR_TO_VANILLA 'misc'→`vanilla/Misc_${…}`)为模板串动态
    // 引用,§2 字面量正则不捕获 → §3 族表须随动态引用面走（R17 判例）。盘面已核 0 小写。
    const FAMS = ['gore_', 'projectile_', 'npc_', 'item_', 'extra_', 'glow_', 'tiles_', 'chain', 'portrait_',
      'waterfall_', 'armor_', 'shimmered_', 'misc_'];
    const files = globSync(join(GAME, 'public/sprites/vanilla/*.png')).map((f) => f.slice(f.lastIndexOf('/') + 1));
    const bad = files.filter((f) => !f[0].match(/[A-Z]/) && FAMS.some((x) => f.toLowerCase().startsWith(x)));
    expect(bad, `家族前缀小写文件 ${bad.length} 枚: ${bad.join(', ')}`).toEqual([]);
  });
});

// ★BJ718-A（R17-D3）§4 json 数据面锁：§1-§3 均不扫数据文件（R17 判例「数据面盲区」）
//  ——remaster-index.json 曾在 2026-10-22 BJ706-B 大小写 rename 后未重跑生成器,
//  残留 gore_240/projectile_179/projectile_618 三枚小写键（generatedAt 08-22 早于
//  rename）+漏收录 4 新件+5 枚陈旧尺寸。本锁钉死生成器契约（gen-remaster-index.mjs
//  头注「素材重打包后需重跑本脚本」）:索引键集与尺寸 ≡ 盘面 PNG（IHDR 直读同式）。
describe('§4 remaster-index.json ≡ 盘面 PNG（gen-remaster-index 重跑纪律锁）', () => {
  it('索引无陈旧键/无缺收录/无陈旧尺寸（键与 IHDR 逐键逐值）', () => {
    const idx = JSON.parse(readFileSync(join(GAME, 'public/sprites/remaster-index.json'), 'utf8'));
    const idxKeys = new Set<string>([...Object.keys(idx.vanilla), ...Object.keys(idx['vanilla-ui'])]);
    expect(idxKeys.size).toBeGreaterThan(11000);   // 规模下限（防空跑假绿）
    const stale: string[] = [];      // 索引有、盘面无（陈旧键——R17-D3 小写键族在此判红）
    const missing: string[] = [];    // 盘面有、索引无（新素材未重跑生成器）
    const sizeDrift: string[] = [];  // 键在、IHDR 尺寸漂（换图未重跑）
    const buf = Buffer.alloc(24);
    // glob 名 = 盘面真名（readdir 实际条目,大小写精确——existsSync 在 macOS 大小写
    // 不敏感,不能用于本判）
    const diskKeys = new Set<string>();
    for (const dir of ['vanilla', 'vanilla-ui']) {
      for (const f of globSync(join(GAME, `public/sprites/${dir}/*.png`))) {
        const key = `${dir}/${f.slice(f.lastIndexOf('/') + 1)}`;
        diskKeys.add(key);
        const sz = idx[dir][key];
        if (!sz) { missing.push(key); continue; }
        // IHDR 直读（gen-remaster-index.mjs pngSize 同式;fd 24 字节读,免全文件载入）
        const fd = openSync(f, 'r');
        try { readSync(fd, buf, 0, 24, 0); } finally { closeSync(fd); }
        if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) continue;
        if (sz[0] !== buf.readUInt32BE(16) || sz[1] !== buf.readUInt32BE(20)) sizeDrift.push(key);
      }
    }
    for (const k of idxKeys) if (!diskKeys.has(k)) stale.push(k);
    expect(stale, `索引陈旧键 ${stale.length} 枚: ${stale.slice(0, 10).join(', ')}`).toEqual([]);
    expect(missing, `索引缺收录 ${missing.length} 枚: ${missing.slice(0, 10).join(', ')}`).toEqual([]);
    expect(sizeDrift, `索引陈旧尺寸 ${sizeDrift.length} 枚: ${sizeDrift.slice(0, 10).join(', ')}`).toEqual([]);
  });
});
