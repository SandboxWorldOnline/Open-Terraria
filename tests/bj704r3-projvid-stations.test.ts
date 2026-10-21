// ★BJ704-R3 P1①（2026-10-21 红蓝审查）判别锁：弹域双旗门 14 站普查。
//  定谳：Game.ts damagePlayer 弹域修正链门=【双旗】`opts?.projDomain &&
//  opts.projVid !== undefined`（D3 清偿所立）。R-B-F10 波（2026-10-14）给 13 站
//  只传了 projDomain 单旗——双旗门下单旗刀=静默 no-op,注释宣称「直调面进
//  modifyHitPlayerByProj 链;旧两链皆不进」为假陈述（mod 敌弹增减伤对 Betsy
//  火球/吐息/哥布林炸弹/食人魔砸/鹿角兽三弹/月耀球/火星死光/陨石块/落块/Dart
//  直调面全部不生效）。唯 duke_moonlord:1062 范式正确（projVid: this.big?386:384）。
//  修=14 站全部补 projVid（bossAI_dd2 686/687/681/683 · deerclops 961/962/965 ·
//  lunar_misc LunarOrb 动态 this.kind(539|574,duke 范式同构) · martian 447 ·
//  MeteorChunk 1078 · FallingBlock this.projId · Dart×2 this.projId）。
//  ★变异自证：M1 任一站回单旗（删 projVid 键）→ §1 红;M2 LunarOrb 回静态常量
//  → §2 红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const SRC_ROOTS = ['src/entities', 'src/core', 'src/ui', 'src/render', 'src/fx', 'src/save'];

/** 全仓 projDomain 站位普查（含工作树态） */
function allStations(): Array<{ file: string; line: string }> {
  const out: Array<{ file: string; line: string }> = [];
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const walk = (dir: string) => {
    for (const name of readdirSync(join(GAME, dir))) {
      const p = `${dir}/${name}`;
      const abs = join(GAME, p);
      if (statSync(abs).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts')) continue;
      for (const line of readFileSync(abs, 'utf8').split('\n')) {
        if (line.includes('projDomain: true')) out.push({ file: p, line });
      }
    }
  };
  for (const r of SRC_ROOTS) walk(r);
  return out;
}

describe('§1 双旗普查：全仓 projDomain 站位零单旗（M1 位）', () => {
  it('每站必带 projVid（双旗门 :44480 projDomain&&projVid!==undefined 才进链）', () => {
    const stations = allStations();
    expect(stations.length).toBeGreaterThanOrEqual(14);
    const bare = stations.filter((s) => !s.line.includes('projVid'));
    expect(bare).toEqual([]);
  });
  it('双旗门锚：Game.ts damagePlayer opts 门原文在位', () => {
    const src = readFileSync(join(GAME, 'src', 'core', 'Game.ts'), 'utf8');
    expect(src).toContain('if (opts?.projDomain && opts.projVid !== undefined)');
  });
});

describe('§2 九站静态 vid 与动态范式（反编译 ProjectileID 亲锚）', () => {
  const EXPECT: Array<[string, string]> = [
    ['src/entities/bossAI_dd2.ts', 'projVid: 686'],
    ['src/entities/bossAI_dd2.ts', 'projVid: 687'],
    ['src/entities/bossAI_dd2.ts', 'projVid: 681'],
    ['src/entities/bossAI_dd2.ts', 'projVid: 683'],
    ['src/entities/bossAI_deerclops.ts', 'projVid: 961'],
    ['src/entities/bossAI_deerclops.ts', 'projVid: 962'],
    ['src/entities/bossAI_deerclops.ts', 'projVid: 965'],
    ['src/entities/bossAI_lunar_misc.ts', 'projVid: this.kind'],
    ['src/entities/bossAI_martian.ts', 'projVid: 447'],
    ['src/entities/MeteorChunk.ts', 'projVid: 1078'],
    ['src/entities/FallingBlock.ts', 'projVid: this.projId'],
    ['src/entities/Dart.ts', 'projVid: this.projId'],
  ];
  it('逐站 vid 落位（LunarOrb=动态 this.kind:FallingBlock/Dart=this.projId）', () => {
    for (const [file, needle] of EXPECT) {
      const src = readFileSync(join(GAME, file), 'utf8');
      expect(src, `${file} 缺 ${needle}`).toContain(`{ projDomain: true, ${needle} }`);
    }
    const dart = readFileSync(join(GAME, 'src/entities/Dart.ts'), 'utf8');
    expect((dart.match(/\{ projDomain: true, projVid: this\.projId \}/g) ?? []).length).toBe(2);
  });
  it('反编译锚:vid 常数与 ProjectileID.cs 一致', () => {
    const van = readFileSync(join(VAN, 'Terraria.ID', 'ProjectileID.cs'), 'utf8');
    const ids: Array<[string, number]> = [
      ['DD2BetsyFireball', 686], ['DD2BetsyFlameBreath', 687], ['DD2GoblinBomb', 681],
      ['DD2OgreSmash', 683], ['DeerclopsIceSpike', 961], ['DeerclopsRangedProjectile', 962],
      ['InsanityShadowHostile', 965], ['SaucerDeathray', 447],
    ];
    for (const [name, id] of ids) {
      expect(van, `${name}=${id}`).toContain(`${name} = ${id};`);
    }
  });
});
