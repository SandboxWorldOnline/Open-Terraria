// 更新横幅版本段 -beta 后缀结构锁(2026-09-23):防回归到纯三段式正则。
// 病史:0.1.35-beta 上线后横幅显示「vBvemkH」(bundle 指纹短码)——根因=
// UpdateCheck/UpdateBanner 两处 /^\d+\.\d+\.\d+$/ 把 -beta 判非版本段,回退
// 显示 bundle 名。修=两处正则放开预发布后缀;本测试钉住新正则在位。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcOf = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const NEW_RE = String.raw`/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/`;

describe('update-version-beta 更新横幅版本段', () => {
  it('UpdateCheck/UpdateBanner 两处正则均接受预发布后缀(纯三段式即红)', () => {
    expect(srcOf('src/update/UpdateCheck.ts')).toContain(NEW_RE);
    expect(srcOf('src/update/UpdateBanner.ts')).toContain(NEW_RE);
  });

  it('行为钉:新正则对 0.1.35-beta 放行、对旧三段式放行、对指纹/HTML 拒绝', () => {
    const re = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/;
    expect(re.test('0.1.35-beta')).toBe(true);
    expect(re.test('0.1.34')).toBe(true);
    expect(re.test('index-BvemkHnu.js')).toBe(false);
    expect(re.test('<!DOCTYPE')).toBe(false);
  });

  it('★2026-09-30 构建时间戳面:build-id 三段式解析 + 横幅组合显示 + 本地构建刷戳', () => {
    const uc = srcOf('src/update/UpdateCheck.ts');
    const ub = srcOf('src/update/UpdateBanner.ts');
    // UpdateCheck:bundle 取末段(戳挤位防御)+ 10 位戳识别并拼进 version
    expect(uc).toContain("parts[parts.length - 1] ?? ''");
    expect(uc).toContain('/^\\d{10}$/.test(parts[1]');
    expect(uc).toContain("filter(Boolean).join(' ')");
    // UpdateBanner:首段版本+次段戳组合显示(戳缺省容忍)
    expect(ub).toContain("version.split(/\\s+/)");
    expect(ub).toContain('/^\\d{10}$/.test(vTokens[1]');
    // 本地构建刷戳:dev/build/build:analyze/start/start:analyze 前缀 stamp-build(不升版;
    // ★start:analyze 是自带完整 vite build 的独立长命令,漏接=用户实报「本地构建仍显示旧戳」)
    // ★BJ731 改判史（2026-10-27）：v0.1.66（72c67689）起 build:analyze/start/
    //   start:analyze 前挂 `npm run test:assets-guard && ` 素材闸——stamp-build
    //   退居第二位但仍先于 vite build（戳语义不变）,断言自 startsWith 放宽为
    //   链内含（dev/build 仍居首=双形态并存）。
    const pkg = JSON.parse(srcOf('package.json'));
    for (const k of ['dev', 'build', 'build:analyze', 'start', 'start:analyze']) {
      expect(pkg.scripts[k].includes('node scripts/stamp-build.mjs')).toBe(true);
    }
    expect(pkg.scripts.dev.startsWith('node scripts/stamp-build.mjs')).toBe(true);
    expect(pkg.scripts.build.startsWith('node scripts/stamp-build.mjs')).toBe(true);
    expect(srcOf('scripts/versionStamp.mjs')).toContain('APP_BUILD_STAMP');
    expect(srcOf('scripts/bump-version.mjs')).toContain('writeVersionTs');
  });
});
