// ★BJ747-A A39（2026-11-01,issue#35）：七宝石袍 l10n 键在位锁。
//   原版（Terarria1458 语言包）：袍 tooltip 4 行 = 魔力行 + 耗魔行 +
//   {$CommonItemTooltip.GemRobe} + {$CommonItemTooltip.GemEffect<Stone>}（构建期展开）；
//   CommonItemTooltip.GemRobe + GemEffect×7 共 8 键 12 语言齐备。
//   修复面：tools/l10n/<12 语言>.Items.json base 分片（target 分片在 build-l10n
//   合并序中优先级最高——custom 覆盖不了既有键，故落 base）追加两行引用 + 补 8 键，
//   `node scripts/build-l10n.mjs` 重建产物。
//   消费链：UI.resolveStaticTip → ItemTooltip.<ITEM_NAME_BY_ID[vid]>（1282-1287/4256
//   → AmethystRobe..AmberRobe，idNames 映射在位——本测试 ④ 锁）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const L10N_DIR = join(here, '..', 'public', 'l10n');
const CULTURES = ['en-US', 'de-DE', 'it-IT', 'fr-FR', 'es-ES', 'ru-RU', 'zh-Hans', 'pt-BR', 'pl-PL', 'ja-JP', 'ko-KR', 'zh-Hant'];

const ROBES: Array<[string, string, number]> = [
  // [ItemTooltip 键, GemEffect 后缀, vanilla vid]
  ['AmethystRobe', 'Amethyst', 1282],
  ['TopazRobe', 'Topaz', 1283],
  ['SapphireRobe', 'Sapphire', 1284],
  ['EmeraldRobe', 'Emerald', 1285],
  ['RubyRobe', 'Ruby', 1286],
  ['DiamondRobe', 'Diamond', 1287],
  ['AmberRobe', 'Amber', 4256],
];

describe('BJ747-A A39 七宝石袍 l10n 4 行 + Gem 键（12 语言）', () => {
  for (const culture of CULTURES) {
    it(`${culture}：7 袍 4 行（第 3 行 GemRobe、第 4 行 GemEffect<石>），无未展开引用`, () => {
      const d = JSON.parse(readFileSync(join(L10N_DIR, `${culture}.json`), 'utf8'));
      const cit = d.CommonItemTooltip;
      for (const [robe, stone] of ROBES) {
        const tip: string = d.ItemTooltip[robe];
        const lines = tip.split('\n');
        expect(lines.length, `${culture}/${robe} 行数（原版 4 行）`).toBeGreaterThanOrEqual(3);
        expect(tip, `${culture}/${robe} 未展开引用残留`).not.toContain('{$');
        expect(lines[lines.length - 2], `${culture}/${robe} 倒数第 2 行 = GemRobe`).toBe(cit.GemRobe);
        expect(lines[lines.length - 1], `${culture}/${robe} 末行 = GemEffect${stone}`).toBe(cit[`GemEffect${stone}`]);
        // 前段语义行保留（魔力行 + 耗魔行——ja-JP 旧基线 4 袍为 & 单行形态，行数下限 3）
        expect(lines[0].length, `${culture}/${robe} 首行非空`).toBeGreaterThan(0);
      }
      // 8 键全在（GemStaff 无消费面暂缓——见 BJ747 台账 D1 登记债）
      for (const k of ['GemRobe', 'GemEffectAmethyst', 'GemEffectTopaz', 'GemEffectSapphire',
        'GemEffectEmerald', 'GemEffectRuby', 'GemEffectDiamond', 'GemEffectAmber']) {
        expect(typeof cit[k], `${culture}/CommonItemTooltip.${k}`).toBe('string');
        expect((cit[k] as string).length).toBeGreaterThan(0);
      }
    });
  }

  it('zh-Hans / en-US 真值抽查（对 Terarria1458 语言包逐字）', () => {
    const zh = JSON.parse(readFileSync(join(L10N_DIR, 'zh-Hans.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(L10N_DIR, 'en-US.json'), 'utf8'));
    // ★G40-A D4（2026-11-01,bj747a D2 基线整体刷新）改判：BJ747-A 当时按「保留
    //   base 既有前两行旧译文,只追加两行引用」最小合规落刀——本刀 1458 全量逐字
    //   回填后首行更新为 1458 值「最大魔力【值】增加20」（一字之差即本改判判据）。
    expect(zh.ItemTooltip.AmethystRobe).toBe('最大魔力值增加20\n魔力消耗降低5%\n为宝石魔法附魔\n紫晶自有其道');
    expect(zh.CommonItemTooltip.GemRobe).toBe('为宝石魔法附魔');
    expect(zh.CommonItemTooltip.GemEffectAmber).toBe('琥珀开辟前路');
    expect(en.ItemTooltip.AmethystRobe).toBe('Increases maximum mana by 20\n5% reduced mana cost\nEnchants gem-powered magic\nAmethysts find their path');
    expect(en.CommonItemTooltip.GemRobe).toBe('Enchants gem-powered magic');
    expect(en.CommonItemTooltip.GemEffectRuby).toBe('Rubies flash double');
  });

  it('① 源分片在位（防产物陈旧假绿）：tools/l10n 12 语言袍行含引用 + 8 键', () => {
    const SRC = join(here, '..', '..', 'tools', 'l10n');
    if (!existsSync(join(SRC, 'zh-Hans.Items.json'))) return;   // C 档可移植：clone 侧缺 tools = skip
    for (const culture of CULTURES) {
      const raw = readFileSync(join(SRC, `${culture}.Items.json`), 'utf8');
      for (const [robe, stone] of ROBES) {
        expect(raw, `${culture} 源分片 ${robe} 引用行`).toContain(
          `{$CommonItemTooltip.GemRobe}\\n{$CommonItemTooltip.GemEffect${stone}}"`);
      }
      expect(raw, `${culture} 源分片 GemRobe 键`).toContain('"GemRobe":');
    }
  });

  it('② idNames 真链：ITEM_NAME_BY_ID 含 7 袍（resolveStaticTip 的名键来源）', async () => {
    const mod = await import('../src/i18n/idNames.generated');
    for (const [robe, , vid] of ROBES) {
      expect(mod.ITEM_NAME_BY_ID[vid], `vid ${vid} → ${robe}`).toBe(robe);
    }
  });
});
