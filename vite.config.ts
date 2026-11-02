// vite/vitest 共用配置。
// resolve.extensions 把 .ts 提到 .js 之前：`npm run build` 的 tsc 会在 src/ 里
// 产出与源码同名的 .js 编译产物，默认扩展序（.js 优先）会让 vitest/vite 解析到
// 过期的 .js 而不是 .ts 源码（表现为改了 .ts 测试却跑旧逻辑）。
import { defineConfig, type Plugin } from 'vite';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** l10n 键完整性自动检查 + 语言包过期自动重建。
 *  ① 自有文案源(tools/l10n-custom)或构建脚本比 public/l10n 产物新 → 先重跑 build-l10n.mjs
 *    （防"补了键没重建包"的静默裸键）。
 *  ② src 全部 Lang.text/has 字面键对 zh-Hans 合并包解析（tools/l10n-audit.mjs）：
 *    vite build 缺键即 fail（构建中断，列出键名与使用位置）；dev 启动仅 console 警告
 *    （不阻塞热更新）。vitest 不走这些钩子，回归由 tests/l10n-audit.test.ts 锁定。 */
function l10nAuditAuto(): Plugin {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)));
  const sources = [
    join(ROOT, '..', 'tools', 'l10n-custom'),
    join(ROOT, 'scripts', 'build-l10n.mjs'),
    join(ROOT, 'scripts', 'l10n-merge.mjs'),
  ];
  const stale = () => {
    if (!existsSync(join(ROOT, 'public', 'l10n', 'zh-Hans.json'))) return true;
    // ★C 档可移植（2026-10-18）：l10n 源目录（仓库外 ../tools/l10n-custom）在 clone 侧
    //   不存在——existsSync 守卫（缺源=不触发自动重建；产物 public/l10n 随仓跟踪，
    //   校验由 tests/l10n-audit.test.ts 在仓内面锁定）。曾 clone 侧 statSync 直抛 ENOENT
    //   → vitest 启动即崩（npm run test 全灭）。
    // ★开源仓 clone 修复（2026-11-02,vibe-online 实报）：G40 后分片源也迁到了仓库外
    //   ../tools/l10n/（12 语言×7 分片）——clone 侧该目录同样不存在。若只守卫 custom
    //   而 scripts/build-l10n.mjs 自身 mtime 晚于产物 mtime（git 检出顺序毫秒差）,
    //   stale() 仍真 → 自动重建 → build-l10n 缺分片硬崩（「缺分片: …/tools/l10n/
    //   en-US.json」启动即死）。守卫扩到分片目录：缺任一 l10n 源=恒不 stale,
    //   clone 侧以仓内产物直接跑（键校验仍由 l10n-audit 仓内面承载）。
    if (!existsSync(join(ROOT, '..', 'tools', 'l10n', 'en-US.json'))) return false;
    const srcNew = Math.max(...sources.map((f) => (existsSync(f) ? statSync(f).mtimeMs : 0)));
    return statSync(join(ROOT, 'public', 'l10n', 'zh-Hans.json')).mtimeMs < srcNew;
  };
  const audit = async () => {
    if (stale()) {
      console.log('[l10n-audit] 语言包源有更新,自动重建…');
      execFileSync('node', [join(ROOT, 'scripts', 'build-l10n.mjs')], { stdio: 'inherit' });
    }
    const { auditL10n } = await import('./tools/l10n-audit.mjs');
    return auditL10n(join(ROOT, 'src'), join(ROOT, 'public', 'l10n', 'zh-Hans.json'));
  };
  return {
    name: 'l10n-audit-auto',
    async configureServer() {
      const { used, missing, shape } = await audit();
      if (missing.length) {
        console.warn(`[l10n-audit] 警告: ${missing.length}/${used} 键缺失（dev 不阻塞，build 会失败）:`);
        for (const m of missing) console.warn(`  MISSING ${m.key} ← ${m.locs.join(', ')}`);
        console.warn('[l10n-audit] 可直接粘贴进仓库根 tools/l10n-custom/{zh-Hans,en-US}.json 后 node scripts/build-l10n.mjs:');
        for (const m of missing) console.warn(`  "${m.key}": "",`);
      }
      if (shape?.length) {
        console.warn(`[l10n-audit] 包形状违例 ${shape.length} 条（类别含点/空键/非字符串值=裸键类 bug，重跑 build-l10n）:`);
        for (const s of shape.slice(0, 10)) console.warn(`  SHAPE ${s}`);
      }
    },
    async buildStart() {
      const { used, missing, shape } = await audit();
      if (missing.length) {
        const lines = missing.map((m) => `  MISSING ${m.key}  ←  ${m.locs.join(', ')}`).join('\n');
        const stubs = missing.map((m) => `  "${m.key}": "",`).join('\n');
        throw new Error(`[l10n-audit] Lang 键缺失 ${missing.length}/${used} 条——请在 tools/l10n-custom/{en-US,zh-Hans}.json 补键后重试:\n${lines}\n\n可粘贴的补键桩(两份文件同键,zh 填译名):\n${stubs}`);
      }
      if (shape?.length) {
        throw new Error(`[l10n-audit] 语言包形状违例 ${shape.length} 条（类别含点/空条目键/非字符串值）——产物损坏，重跑 node scripts/build-l10n.mjs:\n  ${shape.slice(0, 10).join('\n  ')}`);
      }
      console.log(`[l10n-audit] ${used} 键全部命中 ✓`);
    },
  };
}

/** 素材过期自动重打包(物品图集/贴图表管线)。
 *  判定 = 源目录(terraria-assets/Images)·白名单·TEdit 数据·脚本本体的最新 mtime
 *  晚于产物(vanilla.json / Item_Atlas_0.png)的最旧 mtime → 同步重跑 vanilla-atlas.mjs。
 *  dev 启动与 vite build 均触发;vitest 会触发 configureServer(★SW-FX23 勘误:旧注
 *  "vitest 不走这些钩子"有误——createVitest 走 server 钩子,钩子内禁任何长任务/throw) */
function vanillaAtlasAuto(): Plugin {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)));
  const sources = [
    join(ROOT, '..', 'terraria-assets', 'Images'),
    join(ROOT, 'scripts', 'vanilla-whitelist.json'),
    join(ROOT, 'scripts', 'vanilla-atlas.mjs'),
    join(ROOT, '..', 'Terraria-Map-Editor', 'src', 'TEdit.Terraria', 'Data', 'items.json'),
    join(ROOT, '..', 'Terraria-Map-Editor', 'src', 'TEdit.Terraria', 'Data', 'tiles.json'),
    join(ROOT, '..', 'Terraria-Map-Editor', 'src', 'TEdit.Terraria', 'Data', 'walls.json'),
  ];
  const outputs = [
    join(ROOT, 'public', 'sprites', 'vanilla.json'),
    join(ROOT, 'public', 'sprites', 'vanilla', 'Item_Atlas_0.png'),
  ];
  const stale = () => {
    if (outputs.some((f) => !existsSync(f))) return true;
    const srcNew = Math.max(...sources.map((f) => (existsSync(f) ? statSync(f).mtimeMs : 0)));
    const outOld = Math.min(...outputs.map((f) => statSync(f).mtimeMs));
    return srcNew > outOld;
  };
  const run = () => {
    if (!stale()) return;
    // ★追加时代守卫（SW-FX23 2026-09-10）：vanilla.json 已进入追加通道时代
    //   （Item_Atlas_2/3 页引用在册），自动全量重打包会换页换坐标重排 6000+ 键——
    //   事故 8/21、8/23 0042c846、09-10 15:41 与 17:44（FX22 定谳=与 0042c846 事故
    //   blob 字节全等的同案重演）。自动通道退役：只提醒，不重跑（脚本本体另有
    //   --force-full 前的追加时代拒绝守卫）。增量一律走 atlas-append-1457.mjs。
    console.log('[vanilla-atlas-auto] 素材源有更新,但追加时代已禁用自动全量重打包。');
    console.log('  增量请走：node scripts/atlas-append-1457.mjs（幂等，自验既有键零改动）。');
    console.log('  全量重建需清空产物+脚本 --force-full（自担风险，事后必须全绿 atlas-append-golden+atlas-lint）。');
  };
  return {
    name: 'vanilla-atlas-auto',
    configureServer() { run(); },
    buildStart() { run(); },
  };
}

// —— 并行会话探针稳定性(2026-08-12)——
// 问题:多个并行会话共用同一 dev server(5199),任一会话改源码 → HMR/full-reload
// 把其他会话正在跑的 puppeteer 探针页面打断(navigation 错误反复 retry)。
// 方案:跑探针的会话起"私有静默实例"并指向它:
//   SW_PORT=5201 SW_NO_HMR=1 SW_CACHE=/tmp/sw-vite-5201 npx vite
//   SW_NO_HMR=1 → server.hmr=false:不发任何 reload 推送,页面稳定;watcher 仍正常
//   失效 transform 缓存,探针每次 page.goto 都拿到最新代码。
//   SW_CACHE → 独立预打包缓存,避免多实例并发 optimizeDeps 竞争。
// 约定:共享 5199 保留 HMR(人工试玩体验不变);任何会话不得 kill 5199;
// 探针脚本一律读 SW_ORIGIN(缺省回退 5199)。详见 memory: parallel-vite-sessions。
const PORT = Number(process.env.SW_PORT ?? 5199);
const NO_HMR = process.env.SW_NO_HMR === '1';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.mts', '.mjs', '.js', '.jsx', '.tsx', '.json'],
  },
  // worker 打包格式：默认 'iife' 遇到 worker 图内代码分割/动态 import 会构建报错；
  // 'es' 与 dev 态 module worker 一致（worldGen.worker 及其依赖全为静态 import）
  worker: { format: 'es' },
  server: {
    port: PORT,
    // 端口被占直接报错而非静默漂移(+1/+2…)——防"以为在 5199 实际在 5190"的
    // 双实例错位(曾致 VUI/UITextures 双模块"光标消失")
    strictPort: true,
    hmr: NO_HMR ? false : undefined,
  },
  cacheDir: process.env.SW_CACHE ?? 'node_modules/.vite',
  plugins: [vanillaAtlasAuto(), l10nAuditAuto(), atlasLintAuto()],
});

/** 素材自洽 lint(tools/atlas-lint.mjs 的 vite 钩子;照搬 l10nAuditAuto 双消费:
 *  dev 警告 / build 阻断;vitest 不走钩子,由 tests/atlas-lint.test.ts 锁定)。 */
function atlasLintAuto(): Plugin {
  return {
    name: 'atlas-lint-auto',
    async configureServer() {
      const { auditAtlas } = await import('./tools/atlas-lint.mjs');
      const r = auditAtlas();
      for (const e of r.errors) console.warn(`[atlas-lint] ERROR ${e.rule} sheet=${e.sheet ?? '-'} ${e.msg}`);
      for (const w of r.warns) console.warn(`[atlas-lint] warn ${w.rule} ${w.key ?? ''} sheet=${w.sheet ?? '-'} ${w.msg}`);
      if (r.errors.length) console.warn(`[atlas-lint] ${r.errors.length} error —— 构建将阻断`);
    },
    async buildStart() {
      const { auditAtlas } = await import('./tools/atlas-lint.mjs');
      const r = auditAtlas();
      if (r.errors.length) {
        throw new Error(`[atlas-lint] ${r.errors.length} 处 error(素材自洽)——先修再构建:\n` +
          r.errors.map((e) => `  ${e.rule} sheet=${e.sheet ?? '-'} ${e.key ?? ''} ${e.msg}`).join('\n'));
      }
      console.log(`[atlas-lint] ${r.sheets} 表全自洽 ✓ (${r.warns.length} warn)`);
    },
  };
}
