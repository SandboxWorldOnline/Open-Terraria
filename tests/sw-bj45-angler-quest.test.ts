// SW-BJ45（2026-09-09）渔夫任务提交链回归：用户实报「上次刚交过蝙蝠鱼、这次任务又
// 是蝙蝠鱼、持鱼却提交不了」。
// 金标（1.4.5.7 反编译，1458 同域 diff=零变更）：
//   重掷     Main.AnglerQuestSwap（Main.cs:3851-3998）——名单清+旗清+rand.Next(41)
//            纯随机（无不重复门 → 连抽同鱼合法），黎明触发 UpdateTime_StartDay:66352
//   提交     Main.NPCChatText_DoAnglerQuest（Main.cs:40921-40949）——双门
//            !anglerQuestFinished && !anglerWhoFinishedToday.Contains(name)；
//            FindItem(anglerQuestItemNetIDs[anglerQuest]) 比对域=原版内部 id
//   读档重构 WorldGen.playWorldCallBack（WorldGen.cs:6781-6784）——单机读档装配尾
//            `netMode==0 && anglerWhoFinishedToday.Contains(player.name)
//            → anglerQuestFinished=true`（ResetTemps WorldFile.cs:628-629 先清）
//   存档段   WorldFile.cs:1335-1341 Save / 2159-2173 Load（名单+savedAngler+任务索引）
// 本批修刀：①读档完成旗重构（World.reconstructAnglerFinished + Game.afterWorldLoad
// 接线，曾整缺=用户实报根因：同日读档后旗=false 而名单门仍拦，UI 却呈现任务可交）
// ②wld 导入 angler 段读位即收（曾丢弃 → 导入世界任务恒索引 0=蝙蝠鱼 2450 且名单清空）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { ANGLER_QUEST_ITEMS, rollAnglerQuest, seededRng } from '../src/data/vanillaFishing';
import { VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { VI_ID } from '../src/data/itemKeys';
import { loadSave } from '../src/save/SaveFile';
import { parseWld } from '../src/wld/WldParser';
import { parseWldToSave } from '../src/wld/WldImport';

const WLD = join(__dirname, '..', 'Starter_World Master.wld');

/** fishing-full 同款基准世界门（普通种子/未困难/腐化侧假设无关——本批只断言域面） */
const freshGates = {
  hardMode: false, evil: 'corrupt' as const, anyBoss: false, hasWorldSurface: true,
};

describe('SW-BJ45 渔夫任务链', () => {
  describe('读档完成旗重构（WorldGen.cs:6781-6784）', () => {
    it('名单含本玩家 → finished=true（单机）', () => {
      const w = new World(1200, 400, 42);
      w.anglerQuestFinished = false;                     // ResetTemps WF:628-629 同位
      w.anglerWhoFinishedToday = ['泰拉瑞亚人'];
      w.reconstructAnglerFinished('泰拉瑞亚人', false);
      expect(w.anglerQuestFinished).toBe(true);
    });

    it('名单无本玩家 / 名单空 → 保持 false', () => {
      const w = new World(1200, 400, 42);
      w.anglerWhoFinishedToday = ['别人'];
      w.reconstructAnglerFinished('泰拉瑞亚人', false);
      expect(w.anglerQuestFinished).toBe(false);
      w.anglerWhoFinishedToday = [];
      w.reconstructAnglerFinished('泰拉瑞亚人', false);
      expect(w.anglerQuestFinished).toBe(false);
    });

    it('联机不重构（原版 netMode!=0 走 msg74 下发，MessageBuffer.cs:3145-3152）', () => {
      const w = new World(1200, 400, 42);
      w.anglerWhoFinishedToday = ['泰拉瑞亚人'];
      w.reconstructAnglerFinished('泰拉瑞亚人', true);
      expect(w.anglerQuestFinished).toBe(false);
    });

    it('重构幂等且不给名单外玩家放行（swap 清名单后次日读档=false）', () => {
      const w = new World(1200, 400, 42);
      w.anglerWhoFinishedToday = ['泰拉瑞亚人'];
      w.reconstructAnglerFinished('泰拉瑞亚人', false);
      expect(w.anglerQuestFinished).toBe(true);
      // 黎明 swap 清名单+旗（Main.cs:3805-3806）→ 同态再读档不得复活旗
      w.anglerWhoFinishedToday = [];
      w.anglerQuestFinished = false;
      w.reconstructAnglerFinished('泰拉瑞亚人', false);
      expect(w.anglerQuestFinished).toBe(false);
    });
  });

  describe('提交比对域（Main.cs:40928 FindItem 域贯通）', () => {
    it('41 条任务鱼 vid→内部 id 映射全非零（0 哨兵位禁命中）', () => {
      expect(ANGLER_QUEST_ITEMS).toHaveLength(41);
      expect(ANGLER_QUEST_ITEMS[0]).toBe(2450);          // 蝙蝠鱼=索引 0（导入缺省位）
      for (const vid of ANGLER_QUEST_ITEMS) {
        const key = VANILLA_ITEM_KEY_BY_ID[vid];
        expect(key, `vid ${vid} 未注册`).toMatch(new RegExp(`^vi_${vid}_`));
        expect(VI_ID(vid), `vid ${vid} 映射为零哨兵`).toBeGreaterThan(0);
      }
    });
  });

  describe('连抽同鱼合法（Main.cs:3812 rand.Next(41) 无不重复门）', () => {
    it('存在种子使相邻两日抽到同一条鱼（无防重复门的行为学证明）', () => {
      let sameAdjacent = 0;
      for (let seed = 1; seed <= 64; seed++) {
        let prev = -1;
        for (let day = 1; day <= 30; day++) {
          const q = rollAnglerQuest(freshGates, seededRng(seed * 7919 + day));
          if (q === prev) sameAdjacent++;
          prev = q;
        }
      }
      expect(sameAdjacent).toBeGreaterThan(0);           // 连抽同鱼=原版本相，非 bug
    });

    it('蝙蝠鱼(2450)在普通种子域可被抽为当日任务（含索引 0 直取）', () => {
      let hit = false;
      for (let seed = 1; seed <= 4096 && !hit; seed++) {
        const q = rollAnglerQuest(freshGates, seededRng(seed));
        hit = ANGLER_QUEST_ITEMS[q] === 2450;
      }
      expect(hit).toBe(true);
    });
  });

  // ★BJ730 环境依赖守卫：Starter_World Master.wld 为用户手工投放的真版世界夹具,
  //  当前不在位（fx20-wt/ 旧工作树存有副本）——按 wld-npc-home-import 同款
  //  skipIf 习语守卫,夹具恢复即自动回跑（勿硬修;登记债见 bj730a 台账）。
  describe.skipIf(!existsSync(WLD))('wld 导入 angler 段（WorldFile.cs:1335-1341/2159-2173）', () => {
    it('parser 捕获 → save.angler 透传 → loadSave 回填世界（含蝙蝠鱼索引 0 收敛）', () => {
      const buf = new Uint8Array(readFileSync(WLD));
      const wld = parseWld(buf);
      const { save } = parseWldToSave(buf);
      expect(save.angler).toBeDefined();
      expect(save.angler!.quest).toBe(wld.anglerQuest);
      expect(save.angler!.quest).toBeGreaterThanOrEqual(0);
      expect(save.angler!.quest).toBeLessThan(ANGLER_QUEST_ITEMS.length);
      expect(save.angler!.whoFinishedToday).toEqual(wld.anglerWhoFinishedToday);

      const { world } = loadSave(JSON.stringify(save));
      expect(world.anglerQuest).toBe(wld.anglerQuest);
      expect(world.anglerWhoFinishedToday).toEqual(wld.anglerWhoFinishedToday);
    });
  });

  // ================= ★SW-RB10b（2026-09-10）红队审计修复面 tripwire =================
  describe('★SW-RB10b 读档重构调用时序（vanilla LoadPlayer 先于 playWorldCallBack:6781-6784）', () => {
    const gameSrc = () => readFileSync(join(__dirname, '..', 'src/core/Game.ts'), 'utf8');
    const mainSrc = () => readFileSync(join(__dirname, '..', 'src/mainFlow.ts'), 'utf8');

    it('重构唯一调用点=外观落位后（mainFlow.applyAppearance）——afterWorldLoad 首跑时 appearance 未应用，playerName() 回落缺省名与名单恒不符=修复空转（本文件旧名单项「泰拉瑞亚人」恰=zh 缺省名掩盖了该面）', () => {
      const g = gameSrc();
      // 唯一调用点必须在新公开方法体内（先见方法签名,后见 world 调用）
      const calls = g.split('this.world.reconstructAnglerFinished(').length - 1;
      expect(calls, 'Game.ts 只允许一处 world.reconstructAnglerFinished 调用').toBe(1);
      const mIdx = g.indexOf('reconstructAnglerFinishedOnPlayerNamed(): void');
      const cIdx = g.indexOf('this.world.reconstructAnglerFinished(');
      expect(mIdx).toBeGreaterThanOrEqual(0);
      expect(cIdx).toBeGreaterThan(mIdx);
      // mainFlow 外观落位后补跑（时序修正的落点）
      const m = mainSrc();
      expect(m).toMatch(/function applyAppearance[\s\S]{0,1400}?reconstructAnglerFinishedOnPlayerNamed/);
    });

    it('读档路径不得重掷任务（vanilla 重掷仅生成尾 WorldGen.cs:22655 与黎明 Main.cs:66352）——swap/睡渔夫放置须以 freshlyCreated 门住 else 支（镇民全灭档读档也落该支）', () => {
      // ★SW-FX52 锁形更新（2026-09-13,守卫意图等价）：SW-FX42 批在 swap 与
      // placeSleepingAngler 之间合法插入权威端断言块（sendAnglerQuestAssert,
      // 见 sw-fx42-mp-faces），旧紧邻式锁面陈旧爆红——0-300 字符窗保留
      // 「freshlyCreated 门 + swap 先行 + 放置收尾」的顺序约束,不放行跨函数错位
      expect(gameSrc()).toMatch(
        /if \(this\.freshlyCreated\) \{\s*this\.anglerQuestSwap\(\);[\s\S]{0,300}?this\.placeSleepingAngler\(\);\s*\}/,
      );
    });
  });
});
