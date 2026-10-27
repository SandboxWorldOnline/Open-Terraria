// 终态四数组哈希金标门(2026-08-12 世界生成全量审计 Phase 3):
// generateWorld 终态 type/flags/wall/liquid 的 FNV-1a 硬断言——从此任何
// 管线 pass 的无意改动(漏掷骰/改常量/换顺序)都会被确定性抓住,而非等用户
// 肉眼发现「悬空宝石」式的生成期 bug。
//
// 基线再生(有意改动 worldgen 后):
//   UPDATE_GOLDEN=1 npx vitest run tests/world-final-hash.test.ts
// 提交前必须人工确认改动本身是原版 1:1(金标只锁"没变",不锁"对不对")。
// 注意:与 caves-checkpoint 的 C# 位级金标互补——那套锁到 underworld 且逐段,
// 本门锁全管线终态(含 corruption 之后的全部 pass)。
//
// ★2026-08-23 再生(1457 对齐档 2=**1457 基线重冻**)：项目基准切 ../Terarria1457/
//   后 worldgen 从 1456 硬钉整体切回 1457——HellFort 1457 复线(左翼先掷/翼行
//   Clamp(Next(10),3,3)/中央跨 Max-Min 钳/门落点 AttemptToPlaceDoor+doorExists
//   记账/右外门修复/塌墙阶段,helper 即插自 rollback1457/HellFort.1457.ts)/
//   makeTemple 砖线复线(深度组 GenerateBricks,rollback1457/TempleBricks.1457.ts)/
//   BuriedChests 三掷位(753 首支删/669 主物门删/主件池 Next(6)→Next(7) 六选加
//   6153 GlacierFang/尾段 753·669 副物品门复线)/FinalCleanup PlantCheck 判据族
//   补 61+spore 回写按 type2/case103 AnchorValid(Table) 逃生门/FinalSeedCleanup
//   终扫复线(1457 WorldGen.cs:22666→:692)。终态四数组哈希按 **1457 链新基线**
//   重冻(旧值锚 1456 几何,作废)。caves/shimmer 链 C# oracle 金标已同批翻 1457
//   并再生(76 检查点,双种子全绿)——oracle↔JS 双端同态。
//
// ── ★R3 复核批再生(2026-08-23 晚,蓝队) ──
//   9293480:     type 6cb0458b flags cbd422a4 wall ecddbfc9 liquid 187910ac
//   1511931452:  type 9ce0c031 flags c099611c wall f740fc50 liquid 76d0cd6f
//   重冻原因:
//   ① R3-8 makeTemple 末房深度组(W57:33852 三元死代码恒 num13,蓝队确认)——
//      删多余末房组框(少一次 Inflate(10) 填砖+4 条 StrictAngles 角线);
//   ② 工作区在途 YYYYY 批(并行会话,NOTRAPS #58 神庙锁门:FCP 摘
//      checkTileBreakability 门+LivingTree killTileGen 补同门)一并入基线。
//   ★R3-11(红队"丛林草丛 Next(60)/Next(230) 短路差")复核**驳回**:
//     `(Next(60)==0) & flag2` 与 `... && flag2` 求值序列相同——&& 左操作数
//     Next(60) 两版恒求值,短路的只是无副作用的 flag2 纯读,掷流逐位同。
//     曾试"先掷后判"修→金标四通道全移位(Next(60)==0 命中支内多掷
//     Next(230) 的真偏移),已回滚并在 SurfaceDecorPasses 留驳回注释。
//   caves oracle 检查点(76 点)在相关 pass 之前,不受影响(已验全绿)。
//
// ── 旧基线备案(1456 硬钉期,2026-08-21/22 批次) ──
//   9293480:     type 816e0bcf flags 93f048c5 wall 4f89a71f liquid 893afc95
//   1511931452:  type 1e3fcec8 flags 1e64968d wall cedb77a4 liquid dc75ac81
//   （批4 review 的 PlantCheck 61/碗锚/FSC 涂格等修复史见 git/批账,此处不再展开）
//
// ── ★IIIII153(GFB-E 嫁接收尾)统一时刻再生(2026-09-04 15:2x) ──
//   9293480:     type 4ce4ffc2 flags e1c7adcd wall 178c5701 liquid 0ec752c3
//   1511931452:  type 6c4c4c13 flags 7c15b684 wall 2ef6e888 liquid 1b568412
//   重冻原因:XIII 章(IIIII80)挂账「多车道共享树上终态哈希金标需统一时刻再生,已挂
//   GFB-E 清账」——R3 基线(08-23)后 09-02..09-04 worldgen 并行落刀数十文件(GFB-A..D/
//   GFB shimmer/神庙/#97 箱框/CXX palmRangeFrame/IIIII108c ClearTile 幽灵保域/IIIII110b
//   大屋 no-op 翻案等),终态四数组随之合法漂移。再生前认证(本批仪 tools/_iii153fin
//   .test.ts,SW_I153_SLOT=105_Final_Cleanup):JS 终态 vs x86 golden-g/105_Final_Cleanup
//   **八通道零差**(9293480/E0)——终态哈希面=槽链末锚同态,x86 认证;另 mile8 GFB
//   (golden-gfb-c)103 锚行 8 通道零差同刻复验。注意:-004_PostFinSeed 瞬态是
//   FinalCleanup pass **中途**锚(cs:22680 FinalizeSecretSeeds 语句尾,CXVII §JJHook
//   在案),其→105 差(霓虹苔域+液)为该 pass 后半段(ShimmerCleanUp+LiquidCheck
//   createMergeTilesDuringGen)合法增量,禁作终态对拍基准。共享树在飞:再生值=冻结
//   时刻快照,后续车道行为面改动会再次合法重触发本门,届时照本注规程再冻。
//
// ── ★BJ731 再生（2026-10-27 15:5x，上次冻结 09-06 后累积漂移收敛）──
//   9293480:     type e50ae4f7 flags 3050130c wall 41d20d3e liquid d63c9182
//   1511931452:  type 6934fde9 flags 3d190dec wall 88abbbba liquid aecab990
//   重冻原因:09-06 冻结后 worldgen 已定谳落刀面移流/改写——①BJ711-A/BJ715-A
//   仪式谓词域勘正（isSolidStrict+isPlatformsType 单源 cultistCheckFloorPts,
//   移地牢入口仪式位→下游掷流整体移位=四通道全漂主源;bj711a/bj715a 判别锁绿）
//   ②BJ548 种植箱连接帧 case 380 派发新增 ③IIII99d Check2x2 主组全集派发扩展
//   ④BJ182b/BJ210/BJ221 表收编（逐值全等,§6d/§6i/§6k 锁,零流移）。
//   连带定谳:drunk 5162020 浮空岛喷泉终态 24→0（Piles 段②天空带采样+云腿
//   Check2xX 判死,机制五环 1457 亲读 1:1,见 drunk-world-gen.test.ts ★BJ731
//   改判史——非回归,随流漂移的合法终态）。x86 槽链末锚认证未随本批重跑
//   （rig 源不在此会话）,登记债:下批 worldgen 落刀前以 oracle 复跑八通道
//   认证后再动刀。
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { generateWorld } from '../src/world/gen/WorldGen';
import { fnv1a } from './pass-hash.test';

const GOLDEN_DIR = join(__dirname, 'golden');
const CASES = [
  { seed: '9293480', evil: 0, file: 'world-final-9293480.json' },
  { seed: '1511931452', evil: 1, file: 'world-final-1511931452.json' },
];

// ★VVVVVV（2026-08-23）双态门配套：本文件金标=1457 oracle 再生线（world-final-*.json
// 2026-08-23 03:54,含 FinalSeedCleanup 1457 终扫）——置 SW_MB_1457=1 使 JS 侧走 1457
// 形继续认证该线;1456 线由 mile8 槽链对拍认证（tools/_mile8,缺省 1456）。
process.env.SW_MB_1457 = '1';
describe('终态哈希金标门(全管线)', () => {
  for (const c of CASES) {
    it(`种子 ${c.seed}:generateWorld 终态四数组哈希恒定`, async () => {
      const world = await generateWorld({ width: 4200, height: 1200, seedText: c.seed, evil: c.evil as 0 | 1 });
      const st = world.store;
      const hashes = {
        type: fnv1a(st.type), flags: fnv1a(st.flags),
        wall: fnv1a(st.wall), liquid: fnv1a(st.liquid),
      };
      const path = join(GOLDEN_DIR, c.file);
      if (process.env.UPDATE_GOLDEN === '1') {
        if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR);
        writeFileSync(path, JSON.stringify({ seed: c.seed, ...hashes }, null, 2));
        console.log(`[world-final-hash] 再生 ${path}`, hashes);
        return;
      }
      expect(existsSync(path), `金标缺失 ${c.file}(先 UPDATE_GOLDEN=1 再生)`).toBe(true);
      const golden = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
      expect(hashes.type).toBe(golden.type);
      expect(hashes.flags).toBe(golden.flags);
      expect(hashes.wall).toBe(golden.wall);
      expect(hashes.liquid).toBe(golden.liquid);
    }, 300000);
  }
});
