// ★BJ184 登记债①：armorPen equipStats 消费面 ?? 0 扫平判别网（BJ175 家族续刀）。
// 背景：BJ175 已把 Player stat getter + manaCost/pickSpeed 等 26 站防御化并声明
// 「Game.ts 武器管线深处的站点由同类站点代表」。armorPen 是 equipStats 数值面
// 最大单面——消费面普查（2026-09-19 复核）：97 站 = Game.ts 92（算术直读 90 +
// 已护 2）+ WhipProj 1（三元臂）+ MountCombat 1 + MinionProj 3。
// ★清偿刀 Z（2026-09-29）钉数复核重计：Game.ts 92→97——5 新站全为 eq 形、出生
// 即带 `(… ?? 0)` 括号习语（防御闸/括号闸均过,纯钉数陈旧红）。逐站身份（快照
// 对账定谳:/tmp/game-backup.ts 09-25 00:59 实测 95→current 97 差分=BJ345 两站;
// census 92→95 差分=BJ282/BJ286 三站,测试出生日期交叉钉）：
//   ① `fang.armorPen`   :18814 BJ282 毒液法杖 2188/剧毒法杖 1308 专支
//     （tests/bj282-multishot-census.test.ts 09-22 生）
//   ② `knife.armorPen`  :20242 BJ282 吸血鬼飞刀 1569 专支（shoot 304,同批）
//   ③ `wall.armorPen`   :18857 BJ286 爬藤怪法杖 3014 诅咒焰墙
//     （tests/bj286-clinger-staff-wall.test.ts 09-23 生）
//   ④ `sphere.armorPen` :18880 BJ345 磁球 1266（MagnetSphereProj 254,
//     tests/magnet-sphere.test.ts 09-25 生）
//   ⑤ `bolt260.armorPen`:18898 BJ345 同族收编炼狱叉 1295（HeatRay BeamBolt 260）
//   今日 X 刀增补零 armorPen 字样——今日 5 会话 590 处 Edit 逐条解析零 armorPen
//   触笔（transcript 逐 Edit 解析+09-27→今日站数 97 恒等双证）。测试壳
// `equipStats:{}` 桩致动 = undefined 入算术 ⇒ NaN 注入弹幕 armorPen，经弹间
// 拷贝（spore/cloud/slam/blade 系）/`+=`（Arrow:2212）/settlePen 链式放大。
// 本刀（BJ184）把算术直读 90 站（全在 Game.ts）+ WhipProj 三元臂 1 站扫
// `(x ?? 0)`（缺省 0 = 加算池语义）。★BJ171/184 括号习语：`a - x ?? 0` 解析为
// `(a - x) ?? 0`——NaN 非 nullish 防御失效，故 ?? 表达式全程加括号。
// 判别网三层：
//   ①静态站闸：5 消费文件剥注释后，每处 eq/equipStats 源 armorPen 读必须紧跟
//     `??`；Game.ts 另加括号习语闸（逐行钉 `(eq.armorPen ?? 0)` /
//     `(this.player.equipStats.armorPen ?? 0)` 两形）+ 站数钉死（新增站不防御
//     即红、防御了不改钉数也红=强制过闸复核）。
//   ②行为面：仓内唯一桶 playerArmorPenOf（MountCombat:644，本批 export 供测）
//     桩 {} → 0；汇单点 npcCheckArmorPenetration 的 |0 截断契约
//     （undefined/NaN ≡ 0——WhipProj 三元/裸 undefined 传参安全的根）；
//     真 Player computeEquipStats 缺省 armorPen=0（90 站读的真值源，桩面同值
//     =BJ175「防御不歪真档」同款）。
//   ③变异证红：M1（:13687 天顶剑 zPayload）/M2（:17861 黄蜂枪 wasp）摘 ??0 →
//     ①闸红（两发已跑全红，档案登记）。
// 不覆盖（登记）：Game.ts 90 站埋在武器使用管线深处（全仓 0 处 new Game()，
// BJ175 同款边界）——逐站判别力由①静态闸承担，行为面由②同类站点代表。
// 已护免刀站（闸内以 ?? 形在册）：Game.ts :27935/:39233（原 ?? 0，本批统一
// 加括号）；MinionProj :2826/:2958/:4330（BJ 前批已护）;MountCombat :646。
// ★BJ491③（2026-10-04）站数钉过期复绿（HEAD 先在红,守卫断言本就全绿=仅钉陈旧）：
//   WhipProj 1→2——新增站 = :756 Y2 settle 城镇臂 flatPen 透传（原版 Damage_PVE_Inner
//   :12852 `num6 = GetArmorPenetration(melee) + armorPenetration` 玩家分量,:13686
//   `checkArmorPenetration(num6,…)` 消费;鞭 GetArmorPenetration(melee=false)=通用档,
//   敌怪环 :851 同形——原 :626 三元臂行漂至 :851,身份未变）。
//   MinionProj 3→5——:3266（946 泰拉棱镜体触敌臂）/:3299（946 城镇臂 flatPen）/
//   :3431（阿比盖尔 833-835 臂 hurt 参）=BJ453-467 域主清偿连带落盘（原 :2826/:2958/
//   :4330 三站同批迁移重位,旧锚行号退役）+ :4921/:5021（StrikeNPC :12068 玩家 AP+
//   弹幕 AP 两源,`+ projectileData().armorPenetration` 伴读不匹配 READ 闸=每站仅记
//   equipStats 源 1 次）。逐站亲读复核=合法 armorPen 读位（各喂 hurt armorPen 参/
//   flatPen 通道,非误报）;守卫面（unguarded/unparened 断言）零改动。
//   总站数 102→105（97+2+1+5+0）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { playerArmorPenOf } from '../src/entities/MountCombat';
import { npcCheckArmorPenetration } from '../src/entities/projStatus';

/** 消费面 5 文件（equipStats 源 armorPen 读的全集——普查 2026-09-19，
 *  data/vanilla* 为生产面、其余实体文件为弹幕自身字段面（类缺省 0+汇截断），不在闸内）
 *  ★BJ703-F 钉复核对账（2026-10-21,存量红分诊=钉陈旧,守卫面 unguarded/unparened
 *  两断言全空=纯钉漂移零新裸站）：
 *    Game.ts 97→98：新站=runModModifyHitNpc mod 钩参（D2 独立结算面,mods 平台批
 *      2026-10-12/13,`(eq.armorPen ?? 0) + this.player.meleeArmorPen` 全括号习语过闸）。
 *    MinionProj 5→4：BJ684 批（2026-10-15）阿比盖尔臂两单源站收编 ai156Strike
 *      共享结算体（两源=玩家 AP+弹幕 AP,StrikeNPC :12068/:12852 原序）+BJ703-D4
 *      （2026-10-21）946 城镇臂 flatPen 同改两源——5−2+1=4,逐站亲读合法读位
 *      （身份锁=tests/bj491-critroll-tail2-three.test.ts ③3b）。 */
const FILES: Array<[string, number]> = [
  ['src/core/Game.ts', 98],      // 88 eq 形 + 10 this.player.equipStats 直读形（★Z 刀 92→97,BJ282×2/BJ286×1/BJ345×2;★BJ703-F 97→98=D2 runModModifyHitNpc mod 钩参站）
  ['src/entities/WhipProj.ts', 2],   // ★BJ491③ 1→2：:756 Y2 城镇 settle flatPen（:13686 num6 玩家通用 armorPen 透传）+ :851 敌怪环 hurt 参（原 :626 三元臂,行漂）
  ['src/entities/MountCombat.ts', 1], // :646 playerArmorPenOf 唯一桶
  ['src/entities/MinionProj.ts', 4],  // ★BJ491③ 3→5→★BJ703-F 5→4（BJ684 ai156Strike 收编+BJ703-D4 946 两源,见上注）：946 城镇/ai156Strike/contactTown 三两源站+contact 敌怪环单源站
  ['src/entities/Arrow.ts', 0],       // 仅注释提及；读面=弹幕自身字段（缺省 0）
];

/** eq/equipStats 源 armorPen 读（:5138/:13536/:42003 的 miscEquips 形 eq 无
 *  armorPen 读——tsc 形状即证，不入 READ） */
const READ = /\b(?:eq|equipStats\??)\.armorPen\b/g;

/** 剥块注释+行注释（// 后全弃——URL 形 '://x' 全仓 5 文件 0 处，已核） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, '');
}

interface ScanResult {
  unguarded: string[];   // 读后非 ??（防御缺失）
  unparened: string[];   // Game.ts 括号习语缺失（?: 前无 (…?? 0) 全形）
  counts: Map<string, number>;
}

function scan(): ScanResult {
  const res: ScanResult = { unguarded: [], unparened: [], counts: new Map() };
  for (const [file] of FILES) {
    const src = stripComments(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    let n = 0;
    for (const m of src.matchAll(READ)) {
      n++;
      const rest = src.slice((m.index ?? 0) + m[0].length);
      if (!/^\s*\?\?/.test(rest)) {
        res.unguarded.push(`${file}#${n}: …${src.slice(Math.max(0, (m.index ?? 0) - 24), (m.index ?? 0) + 40)}…`);
        continue;
      }
      if (file === 'src/core/Game.ts') {
        // 括号习语：该读所在行必须含 (eq.armorPen ?? 0) 或 (this.player.equipStats.armorPen ?? 0)
        const lineStart = src.lastIndexOf('\n', m.index ?? 0) + 1;
        const lineEnd = src.indexOf('\n', m.index ?? 0);
        const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        if (!/\((?:eq|this\.player\.equipStats)\.armorPen\s*\?\?\s*0\)/.test(line)) {
          res.unparened.push(`${file}#${n}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    res.counts.set(file, n);
  }
  return res;
}

describe('BJ184 armorPen 桩面 NaN 防御判别网', () => {
  it('①静态站闸：105 站全防御（?? 紧随）、Game.ts 98 刀站全括号习语、站数钉死', () => {
    const res = scan();
    expect(res.unguarded).toEqual([]);
    expect(res.unparened).toEqual([]);
    for (const [file, pin] of FILES) {
      expect(res.counts.get(file), file).toBe(pin);
    }
  });

  it('②仓内唯一桶 playerArmorPenOf：equipStats:{} 桩 → 0（非 NaN/undefined）', () => {
    const stub = { player: { equipStats: {} } } as never;
    expect(playerArmorPenOf(stub)).toBe(0);
    expect(Number.isNaN(playerArmorPenOf(stub))).toBe(false);
  });

  it('②汇单点截断契约：undefined/NaN armorPen ≡ 0（Enemy/TownNPC hurt 安全根）', () => {
    expect(npcCheckArmorPenetration(30, undefined as never)).toBe(0);
    expect(npcCheckArmorPenetration(30, Number.NaN)).toBe(0);
    expect(npcCheckArmorPenetration(30, 15)).toBe(7);   // 真值面不歪（15<30 → 15/2 截 7）
  });

  it('②真 computeEquipStats 缺省面：armorPen=0（90 站读的真值源；桩 {} 同值不歪真档）', () => {
    const p = new Player(40 * 16, 54 * 16, new Inventory());
    expect(p.equipStats.armorPen).toBe(0);
    expect(Number.isNaN(p.equipStats.armorPen)).toBe(false);
  });
});
