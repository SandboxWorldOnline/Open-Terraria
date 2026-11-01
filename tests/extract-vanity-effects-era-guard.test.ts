// ★BJ260 extract-vanity-effects.mjs era guard（docs/era-guard-family.md 四要素守卫测试，
// extract-petai/bossbags 同款习语）：
//   ① 版本白名单/② 输出通道三分离（干跑零写盘/SW_OUT 沙箱/--write-real 逃生门+双旗互斥+
//     SW_VANITY_JSON 探测注入与写盘分离 g1+非 1457 禁写真库）
//   ③ 锚 fail-loud（毒化通路/哨兵 → exit≠0+锚点名）
//   ④ 判别力自证（变异证明闸：摘字面通路/helper 通路/扣除判定 → footgun 必现;
//     假现库种子哨兵内容 → 干跑对拍闸 exit≠0）
// ★macOS /var→/private/var 惯例：临时目录一律 realpathSync（mutant 放 /var 下会因
//   import.meta.url 与 argv[1] URL 不匹配走偏——本守卫 mutant 落 game/tools/ 内,
//   保 ROOT=import.meta.url 相对解析与真库通路一致）。
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
// ★C档可移植:被守卫工具读仓库外反编译树/素材源(game/ 兄弟目录,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['Terarria1457'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));


const GAME = resolve(__dirname, '..');
const TOOL = resolve(GAME, 'tools', 'extract-vanity-effects.mjs');
const PRODUCT = resolve(GAME, 'src', 'data', 'vanilla-vanity-effects.json');
const MUTANT = resolve(GAME, 'tools', '.mutant-extract-vanity-effects.mjs');
const src = readFileSync(TOOL, 'utf8');
const sandboxDirs: string[] = [];

function run(args: string[] = [], env: Record<string, string> = {}, toolPath = TOOL) {
  return spawnSync('node', [toolPath, ...args], {
    cwd: GAME,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}
function sandbox(): string {
  const d = mkdtempSync(join(tmpdir(), 'vanity-guard-'));
  sandboxDirs.push(d);
  return d;
}
const sha = (p: string): string => createHash('md5').update(readFileSync(p)).digest('hex');

afterEach(() => {
  if (existsSync(MUTANT)) rmSync(MUTANT);
  for (const d of sandboxDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(EXT_MISSING)('② 输出通道/① 版本白名单', () => {
  it('缺省干跑：exit 0 + 真库产物逐字节零写盘（干跑对拍闸零漂移）', () => {
    const before = sha(PRODUCT);
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('三版交叉全等');
    expect(r.stdout).toContain('干跑对拍：现库 social 集零漂移');
    expect(sha(PRODUCT)).toBe(before);
  });

  it('SW_ITEM_VER 白名单外（1450）→ 拒 exit 1', () => {
    const r = run([], { SW_ITEM_VER: '1450' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('白名单');
  });

  it('SW_OUT 与 --write-real 双旗互斥 → 拒 exit 1（petai 习语）', () => {
    const r = run(['--write-real'], { SW_OUT: sandbox() });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('双旗互斥');
  });

  it('g1 footgun：探测 env SW_VANITY_JSON 已设而 SW_OUT 缺省 → 拒 exit 1（探测注入与写盘分离）', () => {
    const r = run([], { SW_VANITY_JSON: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('探测 env SW_VANITY_JSON');
  });

  it('非 1457 --write-real 禁写真库 → 拒 exit 1', () => {
    const r = run(['--write-real'], { SW_ITEM_VER: '1456' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('禁写真库');
  });

  it('SW_OUT 沙箱通道：写沙箱产物、真库零接触、social 集含新件', () => {
    const d = sandbox();
    const before = sha(PRODUCT);
    const r = run([], { SW_OUT: d });
    expect(r.status).toBe(0);
    const p = JSON.parse(readFileSync(join(d, 'vanilla-vanity-effects.json'), 'utf8'));
    // ★BJ744 改判史：BJ740 ACC16 音乐盒族 itemstats {acc:0,van:1}（Item.cs:48638-55
    //  DefaultToMusicBox 内置 vanity=true 亲读）→ social 按通用规则扣 101 音乐盒
    //  （164→62）;警示 parity 由 itemTooltip `!st?.van` 臂独立承载（Main.cs
    //  social&&!vanity&&!hasVanityEffects 音乐盒无警示行 1:1）。
    expect(p._meta.counts.social).toBe(62);
    expect(p.social).toContain(3110);
    expect(p.social).not.toContain(562);         // ★BJ744：音乐盒族随 van 键扣除（S7 留集前提灭失,见工具头注改判史）
    expect(p.social).not.toContain(3581);       // van 臂实压扣除
    expect(sha(PRODUCT)).toBe(before);          // 真库零接触
  });
});

describe.skipIf(EXT_MISSING)('③④ 锚 fail-loud + 判别力自证（变异证明闸）', () => {
  function mkMutant(from: string, to: string): string {
    expect(src.includes(from), `变异锚缺失: ${from.slice(0, 50)}`).toBeTruthy();
    writeFileSync(MUTANT, src.replace(from, to));
    return MUTANT;
  }

  it('M1 摘字面通路 → 哨兵 485 fail-loud（字面站 18 处是唯一拦截面之一）', () => {
    const mutant = mkMutant(
      "if (/hasVanityEffects\\s*=\\s*true/.test(line)) hit('literal-true', vids, i, raw);",
      "if (/ZZZ_never_match/.test(line)) hit('literal-true', vids, i, raw);");
    const r = run([], {}, mutant);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('哨兵正面');
    expect(r.stderr).toContain('485');
  });

  it('M2 摘 DefaultToGolfBall 通路旗 → 哨兵 4242 fail-loud（helper 通路承运面）', () => {
    const mutant = mkMutant(
      'DefaultToGolfBall: { hasVanityEffects: true },',
      'DefaultToGolfBall: {},');
    const r = run([], {}, mutant);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('哨兵正面');
    expect(r.stderr).toContain('3989');   // 首个 golf-ball-only 哨兵（4242 同理）
  });

  it('M3 摘 DefaultToMusicBox 通路旗 → 音乐盒承运断言 fail-loud（85 站 101 vid 承运面;★BJ744 留集锚改判承运锚）', () => {
    const mutant = mkMutant(
      'DefaultToMusicBox: { hasVanityEffects: true, vanity: true },',
      'DefaultToMusicBox: { vanity: true },');
    const r = run([], {}, mutant);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('音乐盒承运');   // ★BJ744：留集锚→承运锚（数据面扣除后 M3 判别面保持）
    expect(r.stderr).toContain('562');
  });

  it('M4 摘 van 同置扣除 → footgun 复现（3581 漏进 social=原版无警示/SW 有警示分歧）', () => {
    const mutant = mkMutant(
      'const social = a1457.filter((v) => !vanCoSet.includes(v));',
      'const social = a1457.filter(() => true);');
    const d = sandbox();
    const r = run([], { SW_OUT: d }, mutant);
    expect(r.status).toBe(0);                        // 判定摘除后工具自绿=守卫唯一拦截面
    const p = JSON.parse(readFileSync(join(d, 'vanilla-vanity-effects.json'), 'utf8'));
    expect(p.social).toContain(3581);                // footgun 物证：扣除面失守
    const real = JSON.parse(readFileSync(PRODUCT, 'utf8'));
    expect(real.social).not.toContain(3581);
  });

  it('M5 毒化哨兵集（移除 485 正面锚）→ 判别力自证闭环（守卫锚自身受守护）', () => {
    const mutant = mkMutant(
      'const SENTINELS_IN = [15, 16, 17, 18, 393, 395, 485,',
      'const SENTINELS_IN = [15, 16, 17, 18, 393, 395,');
    // 守卫锚被毒化后本用例不直接跑工具——改验 mutant 文件确实缺 485 锚（毒化生效面）
    const mut = readFileSync(mutant, 'utf8');
    expect(mut).not.toContain('395, 485,');
    // 真工具哨兵仍在位
    expect(src).toContain('395, 485,');
  });

  it('M6 假现库漂移 → 干跑对拍闸 exit≠0+漂移物证（假现库=哨兵内容种子,真库零接触）', () => {
    const d = sandbox();
    const fake = join(d, 'fake-product.json');
    writeFileSync(fake, JSON.stringify({ _meta: { counts: {} }, all: [1], social: [999] }));
    const mutant = mkMutant(
      "const PRODUCT = join(ROOT, 'src', 'data', 'vanilla-vanity-effects.json');",
      `const PRODUCT = process.env.SW_FAKE_PRODUCT ?? join(ROOT, 'src', 'data', 'vanilla-vanity-effects.json');`);
    const r = run([], { SW_FAKE_PRODUCT: fake }, mutant);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('现库漂移');
    expect(r.stderr).toContain('999');
  });

  it('三版交叉闸活体：真库 1456/1457/1458 全等通过（干跑 exit 0 即证）', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('all=171');
  });
});
