// ★BJ706-B（2026-10-22 用户转报 Linux 部署实报:贴图文件名大小写错配）防复发锁。
//  机制:macOS 大小写不敏感 FS 上,git 索引名与盘面名、代码引用与盘面名的**大小写
//  差异无声工作**;Linux 部署（大小写敏感）checkout 落索引名 → 代码引用大写名 404。
//  实报三枚（部署仓 7bfb35d 修）:gore_240/projectile_179/projectile_618 → 本仓索引
//  随刀同修（git mv 大写）+ 本锁钉死两面:
//  §1 git 索引名 vs 盘面名 逐字节等（防再写入错大小写文件）;
//  §2 src 代码字面量引用（'vanilla/…​.png' 等）vs 盘面 大小写精确命中（防引用错大小写）。
//  ★M1 变异（索引回小写或引用改错大小写）→ 恰红。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  it('vanilla/ 下 Gore_/Projectile_/NPC_/Item_/Extra_/Glow_/Tiles_/Chain/Portrait_ 族禁小写前缀', () => {
    const FAMS = ['gore_', 'projectile_', 'npc_', 'item_', 'extra_', 'glow_', 'tiles_', 'chain', 'portrait_'];
    const files = globSync(join(GAME, 'public/sprites/vanilla/*.png')).map((f) => f.slice(f.lastIndexOf('/') + 1));
    const bad = files.filter((f) => !f[0].match(/[A-Z]/) && FAMS.some((x) => f.toLowerCase().startsWith(x)));
    expect(bad, `家族前缀小写文件 ${bad.length} 枚: ${bad.join(', ')}`).toEqual([]);
  });
});
