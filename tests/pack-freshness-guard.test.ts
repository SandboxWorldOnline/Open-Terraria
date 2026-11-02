// ★BJ630-R（2026-10-11）pack 新鲜度闸（BJ612 换图漏发链守卫刀）
//
// 判谳（蜘蛛女王「只有一半贴图」二次复报定谳，物证=debug-report-…11-14-36-523Z）：
//  BJ612 换 public/sprites/vanilla/Projectile_377/308.png（66→132 / 94→188 宽，
//  10-10 14:18）后，直到 10-11 19:09 无任何 pack-assets.mjs 重打；其间
//  build:analyze / 裸 vite build 链【不含 pack 步】把 BJ612 前的旧 zip 包原样
//  打进产物（用户 19:04 dist-analyze：bundle=2610111904 新码 × assets-zip=
//  06c34208 旧包，p3-8563b973 内 377 仍 66×450/308 仍 94×780）。构建版 SW zip
//  包 = 贴图唯一权威源（cache-first，Arrow.ts「发布形态缓存内容全部来自自家
//  zip(CRC 校验)」）→ 运行时 projSprite(377)=旧 66×450（report .render.projSprites
//  物证 w:66 h:450；.render.remaster appliedCount=0 排除重制覆写）× BJ612 新半宽
//  绘制码（MinionProj.ts:10061 halfW=sheet.width/2，Main.cs:34952 num481/=2 1:1）
//  → 33px 侧身窄条贴盒左缘 = F3 形态逐值命中。缓存版本链闭环：
//  composeVersion(8i6t72, 06c34208…) = cqcf3v = 用户运行时 assetCache.version
//  （新包 fdf00b2a… 应为 1bcji6q）。绘制链三站亲读无罪；真凶=构建链静默陈旧。
//  19:09 build:release 已触发重打自愈（public/assets-zip + dist-release =
//  fdf00b2a/p3-236f3eb7 = 132×450）。
//
// 本闸拦「换图不重打」复发：state.files（pack-assets 快路径账本）对账 public/
// 现盘（s/m 漂移者重哈希定谳——mtime 纯漂移内容同=不红，与 pack-assets 语义
// 逐式同构）+ manifest.contentHash 重算对拍 + 逐片 zip 内字节 sha1 抽检对拍
// public 实际字节（拦「state 新 zip 旧」形态）。红=先跑
// `node scripts/pack-assets.mjs` 再构建；绿=新构建自动携带新包（SW 版本键随
// contentHash 变化，缓存整批重建）。
//
// 运行：cd game && npx vitest run tests/pack-freshness-guard.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
// @ts-ignore — pack-assets.mjs 无类型声明（pack-assets.test.ts 的 @ts-expect-error
// 语义依赖其无类型面,不可旁挂 d.mts;此处局部标注消费类型）
import { scanInputs, ALGO_VERSION } from '../scripts/pack-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUB = join(ROOT, 'public');
const STATE_PATH = join(ROOT, '.pack-assets-state.json');
const OUT_DIR = join(PUB, 'assets-zip');

const sha1 = (buf: Buffer | Uint8Array) => createHash('sha1').update(buf).digest('hex');

interface PackFile { s: number; m: number; h: string }
interface PackState { algoVersion: number; vendorSha: string; files: Record<string, PackFile> }
interface ZipPart { file: string; phase: string; files: number; bytes: number; zipBytes: number; entries: string[]; inputHash: string }
interface ZipManifest { algoVersion: number; contentHash: string; totalFiles: number; totalBytes: number; parts: ZipPart[] }

// ★开源仓 clone 修复（2026-11-02,vibe-online 实报）:public/assets-zip/ 是
//   .gitignore:18 排除的【开发机打包产物】——clone 侧无此目录(以及 zip 分片)。
//   state(.pack-assets-state.json)随仓,但守卫对象是产物新鲜度——产物缺=无物可守,
//   整套 skip(clone/CI 侧;开发机产物在则照常全量校验)。
const PACKED = existsSync(join(OUT_DIR, 'manifest.json'));
const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as PackState;
const manifest = PACKED
  ? JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8')) as ZipManifest
  : null;
const files: string[] = scanInputs(PUB);

(PACKED ? describe : describe.skip)('BJ630-R：pack-assets 新鲜度闸（换图必重打，陈旧 zip 包=红）', () => {
  it('账本结构在位：algoVersion/vendorSha/manifest 分片计划齐全', () => {
    expect(state.algoVersion).toBe(ALGO_VERSION);
    expect(typeof state.vendorSha).toBe('string');
    expect(state.vendorSha.length).toBeGreaterThan(0);
    if (!manifest) return;   // ★clone 侧产物缺=skip 面
    expect(manifest.algoVersion).toBe(ALGO_VERSION);
    expect(manifest.parts.length).toBeGreaterThan(0);
    for (const p of manifest.parts) expect(existsSync(join(OUT_DIR, p.file)), `分片在盘 ${p.file}`).toBe(true);
    expect(manifest.totalFiles).toBe(files.length);
  });

  it('state 账本对账现盘：s/m 漂移者重哈希定谳（内容同=容忍 mtime 漂移,内容异=陈旧红）', () => {
    const drifted: string[] = [];
    for (const f of files) {
      const ent = state.files[f];
      if (!ent) { drifted.push(f); continue; }                       // 新文件未入账=未重打
      const st = statSync(join(PUB, f));
      if (ent.s === st.size && ent.m === Math.floor(st.mtimeMs)) continue;   // 快路径同 pack-assets
      // 慢路径：mtime/size 漂移 → 内容 sha1 定谳（pack-assets :155-160 同式）
      if (sha1(readFileSync(join(PUB, f))) !== ent.h) drifted.push(f);
    }
    expect(drifted, `state 账本陈旧（换图/换素材后未重打）:${drifted.slice(0, 8).join(',')}`).toEqual([]);
  });

  it('manifest.contentHash 重算对拍：state 账本重导出的内容指纹须与在盘 manifest 一致', () => {
    // pack-assets :166 原式：sha1( entries 按扫描序 "path:hash\n" 串 )
    if (!manifest) return;   // ★clone 侧产物缺=skip 面(describe.skip 已拦,TS 收窄)
    const expectHash = sha1(Buffer.from(files.map((f) => `${f}:${state.files[f]!.h}\n`).join(''), 'utf8'));
    expect(manifest.contentHash, 'manifest 与账本脱节=产物是旧包').toBe(expectHash);
  });

  it('逐片 zip 内字节抽检（首+尾 entry）：zip 解出 sha1 ≡ public 现盘 sha1', () => {
    if (!manifest) return;   // ★clone 侧产物缺=skip 面
    const bad: string[] = [];
    for (const part of manifest.parts) {
      const zbuf = new Uint8Array(readFileSync(join(OUT_DIR, part.file)));
      const un = unzipSync(zbuf);
      for (const name of [part.entries[0]!, part.entries[part.entries.length - 1]!]) {
        const inZip = un[name];
        expect(inZip, `zip 内条目缺失 ${part.file}!${name}`).toBeTruthy();
        const onDisk = readFileSync(join(PUB, name));
        if (sha1(inZip) !== sha1(onDisk)) bad.push(`${part.file}!${name}`);
      }
    }
    expect(bad, `zip 包内字节陈旧（打包含旧贴图）:${bad.slice(0, 6).join(',')}`).toEqual([]);
  });
});
