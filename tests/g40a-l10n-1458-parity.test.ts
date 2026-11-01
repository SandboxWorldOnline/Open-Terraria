// ★G40-A D4(bj747a D2 清偿,2026-11-01):l10n base 分片 ↔ Terarria1458 语言包
// 全量逐字对拍锁(12 语言 × 7 分片)。
//
// 背景:BJ747-A 观察 ~70 缺键+~20 旧译差(袍外词条)登记为「基线整体刷新决策,
// 须整刀处理,勿单点手改」。本刀清偿:1458 语言包逐字回填 tools/l10n/<culture>
// <shard>.json base 分片(新增 2807 键+更新 1388 值——含 fr-FR $Gender 枚举更名
// 863 处、Warmth/MagicCuffs/WorkBench/Smolstar/DD2 光环塔等旧译刷新、1.4.5 UI/
// buff/Palworld 新键段),build-l10n 重建 12 语言产物。
//
// 优先级面(build-l10n.mjs 合并序):en 分片→custom en→custom target→【target 分片
// (最高)】——base 分片是 vanilla 命名空间的权威层(BJ747-A 判例「custom 覆盖不了
// target 既有键」),回填后 custom 层 vanilla-ns 条目自然让位(Mods.* 自有命名空间
// 不受影响)。1457↔1458 语言包全量 diff 逐字节相同(亲验),锚 1458=锚 1457。
//
// 锁面:
//  · §1 分片全量对拍:missing=0 ∧ changed=0(逐 culture 逐 shard 逐键逐值);
//  · §2 extra 白名单:repo-only 键恰 = 7 Net.* interop 残留 ×12(无消费者,保留
//    备案;新增 repo-only 键=红,须扩白名单+登记);
//  · §3 产物抽查:回填面代表键在 public/l10n 产物在位且 {$} 引用已展开
//    (MagicCuffs→BandofStarpower 展开/WorkBench→CommonItemTooltip 展开/
//    Buffs 带 {InputTrigger_QuickBuff} 活绑 token——运行时 substitution 表解析,
//    Lang.ts:131 链);
//  · §4 探测器正控:missing/changed/extra 三态夹具自证非恒绿。
// 1458 树不在盘(clone 侧)→ 整文件 skip(C 档可移植,_vf-worldwide-parity 同 idiom)。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(here, '..');
const REPO_ROOT = join(GAME_ROOT, '..');
const L10N = join(REPO_ROOT, 'tools', 'l10n');
const OUT_DIR = join(GAME_ROOT, 'public', 'l10n');
const CULTURES = ['en-US', 'de-DE', 'it-IT', 'fr-FR', 'es-ES', 'ru-RU',
  'zh-Hans', 'pt-BR', 'pl-PL', 'ja-JP', 'ko-KR', 'zh-Hant'];
const SHARDS = ['', '.Game', '.Items', '.Legacy', '.NPCs', '.Projectiles', '.Town'];
const vanPath = (c: string, s: string) =>
  join(REPO_ROOT, 'Terarria1458', `Terraria.Localization.Content.${c}${s}.json`);

/** 尾逗号/BOM 容错(原版嵌入资源带尾逗号;l10n-merge parseLenient 同式) */
const parseLenient = (raw: string) => JSON.parse(raw.replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1'));

/** 对拍探测器:返回 missing/changed/extra 三清单(全键=cat+'.'+key) */
export function diffShard(repo: Record<string, Record<string, string>>,
  van: Record<string, Record<string, string>>): {
  missing: string[]; changed: string[]; extra: string[];
} {
  const missing: string[] = [], changed: string[] = [], extra: string[] = [];
  for (const [cat, entries] of Object.entries(van)) {
    const rc = repo[cat] ?? {};
    for (const [k, v] of Object.entries(entries)) {
      if (!(k in rc)) missing.push(`${cat}.${k}`);
      else if (rc[k] !== v) changed.push(`${cat}.${k}`);
    }
  }
  for (const [cat, entries] of Object.entries(repo)) {
    const vc = van[cat] ?? {};
    for (const k of Object.keys(entries)) if (!(k in vc)) extra.push(`${cat}.${k}`);
  }
  return { missing, changed, extra };
}

const EXT_MISSING = !CULTURES.every((c) => existsSync(vanPath(c, '')));
(EXT_MISSING ? describe.skip : describe)('G40-A l10n base 分片 ↔ 1458 全量逐字对拍', () => {
  it('§1 12 语言 × 7 分片:missing=0 ∧ changed=0(逐键逐值)', () => {
    const problems: string[] = [];
    for (const c of CULTURES) {
      for (const s of SHARDS) {
        const repo = parseLenient(readFileSync(join(L10N, `${c}${s}.json`), 'utf8'));
        const van = parseLenient(readFileSync(vanPath(c, s), 'utf8'));
        const { missing, changed } = diffShard(repo, van);
        for (const k of missing.slice(0, 5)) problems.push(`缺 ${c}${s} ${k}`);
        for (const k of changed.slice(0, 5)) problems.push(`值异 ${c}${s} ${k}`);
      }
    }
    expect(problems, `base 分片与 1458 漂移(回填脚本 /tmp/recon/g40a-l10n-backfill.mjs 同式重放): ${problems.join('; ')}`).toEqual([]);
  });

  it('§2 repo-only 键恰 = 7 Net.* interop 残留(×12 语言,英文同值,零消费备案)', () => {
    const ALLOWED = new Set(['Net.ClientStatusComplete', 'Net.ClientSendingData',
      'Net.ClientRequestedWorldInfo', 'Net.ClientPlaying', 'Net.WaitingForClients',
      'Net.ClientsConnected', 'Net.IsReceivingTileData']);
    const problems: string[] = [];
    for (const c of CULTURES) {
      const repo = parseLenient(readFileSync(join(L10N, `${c}.json`), 'utf8'));
      const van = parseLenient(readFileSync(vanPath(c, ''), 'utf8'));
      const { extra } = diffShard(repo, van);
      for (const k of extra) {
        if (!ALLOWED.has(k)) problems.push(`${c} ${k}`);
      }
      if (extra.filter((k) => ALLOWED.has(k)).length !== ALLOWED.size) {
        problems.push(`${c} Net.* 白名单不全(${extra.length})`);
      }
    }
    expect(problems, `repo-only 键超出白名单(新增自有键须登记扩白名单,勿混入 vanilla 镜像层): ${problems.join('; ')}`).toEqual([]);
  });

  it('§3 产物抽查(12 语言全量在位 + {$} 引用已展开 + token 形原样活绑)', () => {
    // 12 语言产物全量在位:回填面代表键(UI 新键段/buff 新键段/新八音盒/WorkBench 引用)
    for (const c of CULTURES) {
      const d = JSON.parse(readFileSync(join(OUT_DIR, `${c}.json`), 'utf8'));
      expect(typeof d.UI?.PortraitsDetailed, `${c}/UI.PortraitsDetailed`).toBe('string');
      expect(typeof d.BuffName?.BlueLightning, `${c}/BuffName.BlueLightning`).toBe('string');
      expect(typeof d.BuffDescription?.Warmth, `${c}/BuffDescription.Warmth`).toBe('string');
      expect(typeof d.ItemName?.MusicBoxRainbowBoulder, `${c}/ItemName.MusicBoxRainbowBoulder`).toBe('string');
      // WorkBench → {$CommonItemTooltip.WorkBench} 展开(与共享键同值)
      expect(d.ItemTooltip?.WorkBench, `${c}/ItemTooltip.WorkBench`).toBe(d.CommonItemTooltip?.WorkBench);
    }
    const zh = JSON.parse(readFileSync(join(OUT_DIR, 'zh-Hans.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(OUT_DIR, 'en-US.json'), 'utf8'));
    // MagicCuffs → {$ItemTooltip.BandofStarpower} 展开为星力手环行(+40 魔力)+ 新二行
    expect(zh.ItemTooltip.MagicCuffs).toBe('最大魔力值增加40\n受伤时恢复魔力');
    expect(en.ItemTooltip.MagicCuffs).toBe('Increases maximum mana by 40\nRestores mana when damaged');
    // token 形原样保留({InputTrigger_QuickBuff} 运行时 substitution 表解析,
    // Lang.ts:131 链/InputTrigger_QuickBuff 注册 LanguageManager.ts:117)
    expect(zh.CommonItemTooltip.Buffs).toContain('{InputTrigger_QuickBuff}');
    // fr-FR $Gender 枚举更名(FeminineSingular,863 处族的代表锚)
    const fr = JSON.parse(readFileSync(join(OUT_DIR, 'fr-FR.json'), 'utf8'));
    expect(fr.ItemName?.['IronPickaxe$Gender']).toBe('FeminineSingular');
  });

  it('§4 探测器正控:missing/changed/extra 三态夹具(证非恒绿)', () => {
    const repo = { A: { x: '1', y: '2', z: '3' } };
    const van = { A: { x: '1', y: '9', w: '0' } };
    const d = diffShard(repo as never, van as never);
    expect(d.missing).toEqual(['A.w']);
    expect(d.changed).toEqual(['A.y']);
    expect(d.extra).toEqual(['A.z']);
  });
});
