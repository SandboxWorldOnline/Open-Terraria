// EoC/机械 Boss 自然召唤旗生命周期守卫（2026-08-28 用户实报回归锁）。
// 缺陷史：spawnEyePending/spawnHardBossPending 的入夜清零两行曾写在 crossed(DUSK)
// 块【外】——每帧无条件执行 → 入夜 roll 置位的 pending 活不过一帧，消费端
// （nightTicks>4860 起每帧查旗）整夜读 false → "收到邪恶存在消息但克眼整夜
// 不生成直接天亮"。修=清零挪进 crossed(DUSK) 块内（每夜重置语义）。
// 原版：触发 StartNight(Main.cs:64732) / 消费 UpdateTime(Main.cs:64542-64621，
// spawnHardBoss 无条件清零=原版同款 :64621) / 黎明清旗(Main.cs:64625)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');

describe('自然 Boss 召唤旗生命周期（crossed(DUSK) 块内清零）', () => {
  it('入夜重置必须在 crossed(DUSK) 块内（紧随块开）', () => {
    expect(src).toMatch(
      /if \(crossed\(Clock\.DUSK\)\) \{\s*\n\s*this\.spawnEyePending = false;\s*\n\s*this\.spawnHardBossPending = 0;/,
    );
  });
  it('重置块必须与 roll 门紧邻（两者之间插入裸清零即破坏匹配）', () => {
    expect(src).toMatch(
      /this\.spawnHardBossPending = 0;\s*\n\s*\}\s*\n\s*if \(crossed\(Clock\.DUSK\) && !w\.isFastForwardingTime\(\)/,
    );
  });
  it('消费端仍为 nightTicks>4860 门 + 无条件清旗（原版 :64596 同款）', () => {
    // ★G42-A R30 P3-2（2026-11-02）随刀更新：EoC 分支补旅程滑杆关停拒
    //  （CanSpawnEnemiesNear NPC.cs:352-358）——滑杆==0 时玩家门失=旗保留
    //  （原版 :66053 清旗仅在 SpawnOnPlayer 后）;机械门=清旗无条件（:66093）
    //  + 召唤补滑杆拒。
    expect(src).toMatch(
      /if \(nightTicks > 4860 && surfaceOk && !nearMoonLord\) \{[\s\S]{0,700}?if \(this\.spawnEyePending && !spawnSliderOff\) \{\s*\n\s*this\.spawnEyePending = false;/,
    );
  });
  it('★G42-A R30 P3-2：滑杆关停拒三门在位（EoC 旗保留/机械窗耗/鹿角怪拒）', () => {
    expect(src).toMatch(
      /const spawnSliderOff = w\.isJourney && shouldDisableSpawns\(w\.journeyPowers\.spawnRateSlider\);/,
    );
    expect(src).toMatch(/if \(!this\.boss && !spawnSliderOff\) \{/);
    expect(src).toMatch(/&& !nearMoonLord && !spawnSliderOff\s*\n\s*&& !\(w\.lunarEvent\.moonLordCountdown > 0/);
  });
});
