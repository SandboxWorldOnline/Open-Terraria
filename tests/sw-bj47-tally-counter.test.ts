// SW-BJ47 杀怪计数器（Tally Counter vid 3095）三刀回归（2026-09-09）：
//   实报"现在计的是带上配饰后击杀的数量"——实机探针定谳：计数本体=终身旗账
//   （world.bannerKills ≡ BannerSystem.killCount,装备无关,活证 bannerKills{"87":7}→
//   装备显示 7）。真偏差三处,本文件逐刀锁：
//   ① lastCreatureHit 写位：原版三写位均为【命中即写】非击杀写（Player.cs:20609-20619
//      ApplyDamageToNPC / :44769-44775 ItemCheck 近战 / Projectile.cs:13382-13389
//      ownedBySomeone 弹）——击杀结算 CountKillForBannersAndDropThem（NPC.cs:80627-80637）
//      只管旗数不写此位。曾击杀时写 → 装备后未杀过怪恒"杀敌数不可用",杀一只才亮行,
//      观感即"从带上配饰起才算"（定谳=用户实报的机制级解释）。
//   ② lastCreatureHit 值域：Player.cs:2575 存 `BannerSystem.NPCtoBanner(...)` 旗种 id
//      （未映射 = 0,BannerSystem.cs NPCtoBanner default :1449 return 0）非 NPC id——
//      打无旗怪后行应灰"杀敌数不可用"（Main.cs:47845-47853 `lastCreatureHit <= 0` 支）。
//   ③ 显示名域：Main.cs:47852 `Lang.GetNPCNameValue(BannerSystem.BannerToNPC(
//      lastCreatureHit))` = 旗种规范代表名（同旗多 NPC 统一名,如鸟旗 8 = 74 鸟,
//      74/297/298 同旗——被杀变体 297 冠蓝鸦也显示"鸟"）,非被杀变体名。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { saveGame, loadSave } from '../src/save/SaveFile';
import { recordBannerKill, bannerOfNpc, bannerToNpcOf } from '../src/world/Banners';
import { hitCritters } from '../src/entities/projTargets';
import type { GameHooks } from '../src/entities/types';

function makeGame(): GameHooks {
  const world = new World(96, 48, 7, 'bj47');
  world.groundLevel = 16;
  world.rockLevel = 32;
  return {
    world,
    player: null,
    enemies: () => [],
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    spawnParticles: () => {},
    playSfxFiles: () => {},
    playSfxWav: () => {},
    onEnemyKilled: () => {},
    net: { active: false, mySlot: 0 },
  } as unknown as GameHooks;
}

describe('SW-BJ47 ① lastCreatureHit 命中写位（Player.cs:20609/:44769/:13382 三写位并集）', () => {
  it('玩家命中即写,值域 = 旗种 banner id 非 NPC id（僵尸 3 → 旗 87）', () => {
    const g = makeGame();
    (g as { player: unknown }).player = { addDPS: () => {}, lastCreatureHit: -1, dead: false };
    const e = Enemy.fromVanilla(3, 40 * 16, 20 * 16);
    expect(e).toBeTruthy();
    e!.hurt(10, 1, 0, g, 0, false, 0, true);   // 非致命命中（hp 100  survival）
    expect((g as { player: { lastCreatureHit: number } }).player.lastCreatureHit)
      .toBe(bannerOfNpc(3));
    expect((g as { player: { lastCreatureHit: number } }).player.lastCreatureHit)
      .toBe(87);                                // 旗种域 1:1（Player.cs:2575 写 NPCtoBanner 结果）
    expect(e!.hp).toBeGreaterThan(0);           // ★未杀也写 = 命中即写（击杀写曾致行不亮）
  });

  it('无玩家交互命中不写（陷阱/岩浆等价 fromPlayer=false,原版无环境写位）', () => {
    const g = makeGame();
    (g as { player: unknown }).player = { addDPS: () => {}, lastCreatureHit: -1, dead: false };
    const e = Enemy.fromVanilla(3, 40 * 16, 20 * 16);
    e!.hurt(10, 1, 0, g, 0, false, 0, false);
    expect((g as { player: { lastCreatureHit: number } }).player.lastCreatureHit).toBe(-1);
  });

  it('训练假人 488（无旗怪）命中写 0 → 行灰"杀敌数不可用"（NPCtoBanner default return 0）', () => {
    const g = makeGame();
    (g as { player: unknown }).player = { addDPS: () => {}, lastCreatureHit: -1, dead: false };
    const d = Enemy.fromVanilla(488, 40 * 16, 20 * 16);
    expect(d).toBeTruthy();
    if (d) d.dummyAnchor = [40, 20];
    d!.hurt(100, 1, 0, g, 0, false, 0, true);
    expect(bannerOfNpc(488)).toBe(0);           // BannerSystem.cs NPCtoBanner 未映射 = 0
    expect((g as { player: { lastCreatureHit: number } }).player.lastCreatureHit).toBe(0);
  });

  it('免疫帧内重复命中不写（hurt 头部早退 = 原版免疫门先行,须实扣命中才写）', () => {
    const g = makeGame();
    (g as { player: unknown }).player = { addDPS: () => {}, lastCreatureHit: -1, dead: false };
    const e = Enemy.fromVanilla(3, 40 * 16, 20 * 16);
    e!.hurt(10, 1, 0, g, 0, false, 0, true);    // 首击实扣 → 写旗 87
    const first = (g as { player: { lastCreatureHit: number } }).player.lastCreatureHit;
    // 同一拍换旗种域已是 87；用第二只僵尸在免疫帧内被击 → 不改写（值恒等场景退化,
    // 改用史莱姆 1 → 旗 254 断言不被免疫帧击改写）
    const slime = Enemy.fromVanilla(1, 44 * 16, 20 * 16);
    e!.iframes = 10;                             // 人为置免疫帧
    slime!.hurt(10, 1, 0, g, 0, false, 0, true);
    slime!.iframes = 0;
    slime!.hurt(10, 1, 0, g, 0, false, 0, true); // 出帧后实扣 → 改写为史莱姆旗
    expect(first).toBe(87);
    expect((g as { player: { lastCreatureHit: number } }).player.lastCreatureHit)
      .toBe(bannerOfNpc(1));                     // bannerOfNpc(1)（绿史莱姆旗）
  });
});

describe('SW-BJ47 ② 计数递增装备无关性 + ③ 显示名/计数域（数据面 1:1）', () => {
  it('recordBannerKill 不读任何配饰态：装备前后同账本累加（终身上计）', () => {
    const world = new World(64, 32, 42, '测试');
    const zb = bannerOfNpc(3);
    for (let i = 0; i < 7; i++) recordBannerKill(world.bannerKills, 3);   // 未装备期击杀
    expect(world.bannerKills[zb]).toBe(7);
    // "装备 Tally Counter"——递增路径零消费配饰位（InfoAccs 只点亮行）:再杀 3 → 10
    for (let i = 0; i < 3; i++) recordBannerKill(world.bannerKills, 3);
    expect(world.bannerKills[zb]).toBe(10);
  });

  it('显示三元组：旗 8 规范代表 = 74 鸟（74/297/298 同旗,变体杀也显规范名）+ 计数同账本', () => {
    // BannerSystem.cs:1156 BannerToNPC(8)=74;NPCtoBanner :74/297/298 → 8（探针实况:
    // 杀 297 冠蓝鸦曾显示"冠蓝鸦: 1"=②旧偏差,现应规范名"鸟"）
    expect(bannerToNpcOf(8)).toBe(74);
    expect(bannerOfNpc(74)).toBe(8);
    expect(bannerOfNpc(297)).toBe(8);
    expect(bannerOfNpc(298)).toBe(8);
  });

  it('存读档回环后显示源（world.bannerKills）保值——计数与 lastCreatureHit 解耦', () => {
    const world = new World(64, 32, 42, '测试');
    world.bannerKills = { 87: 12 };
    const player = new Player(100, 100, new Inventory());
    const back = loadSave(saveGame(world, player, 0));
    expect(back.world.bannerKills[87]).toBe(12);
    // lastCreatureHit 不落玩家存档（Player.cs:2575 实例域非持久,存档面无此字段）→
    // 读档恒回 -1 → 行灰"杀敌数不可用",实扣命中后亮行显示终身 12+1——计数不随
    // 玩家域重置（原版本相,Main.cs:47845-47853）
    expect((back.player as { lastCreatureHit?: number }).lastCreatureHit).toBeUndefined();
    expect(new Player(100, 100, new Inventory()).lastCreatureHit).toBe(-1);
  });
});

describe('SW-BJ47 ④ Game.ts 接线锁（击杀写摘除 + 显示面旗种域/规范名）', () => {
  const gamePath = fileURLToPath(new URL('../src/core/Game.ts', import.meta.url));
  const src = () => readFileSync(gamePath, 'utf8');

  it('击杀结算路径零 lastCreatureHit 写（原版 CountKillForBannersAndDropThem 只管旗数）', () => {
    const s = src();
    expect(s).not.toContain('this.player.lastCreatureHit = enemy.vanillaNetId');
    expect(s).toContain('SW-BJ47');              // 迁移注锚（onEnemyKilled 摘除注）
  });

  it('显示面 = BannerToNPC 规范名 + 终身旗账（Main.cs:47845-47853 1:1）', () => {
    const s = src();
    expect(s).toContain('Lang.npcName(bannerToNpcOf(p.lastCreatureHit))');
    expect(s).toContain('w.bannerKills[p.lastCreatureHit] ?? 0');
  });

  it('命中写位在 Enemy.hurt fromPlayer 尾段（三写位并集单漏斗）', () => {
    const s = readFileSync(fileURLToPath(new URL('../src/entities/Enemy.ts', import.meta.url)), 'utf8');
    // ★BJ710-G35 D3b（2026-10-25）：键式收编 bannerNpcKeyOf 单源（BannerID()
    //  netID≥-10 上界——-12 getGood 僵尸回落 type 吃僵尸旗,语义升级非行为回退）
    expect(s).toContain('pl.lastCreatureHit = bannerOfNpc(bannerNpcKeyOf(this) ?? 0);');
    expect((s.match(/bannerOfNpc\(bannerNpcKeyOf\(this\) \?\? 0\);/g) ?? []).length).toBe(2);   // 假人/实战两写位
    expect(s).toContain("import { bannerOfNpc } from '../world/Banners'");
  });
});

// ===================== ⑤ SW-RB10d 补刀：critter 命中面 fromPlayer 收口 =====================
//  原版小动物=Main.npc 桶成员：近战（Player.cs:44593-44612 无 critter 排除→:44769 写）、
//  玩家弹/爆炸（Projectile.Damage_PVE :13382 ownedBySomeone 写,:13712 addDPS 同门,
//  StrikeNPC :13702/:82097 owner==myPlayer → LocalPlayerInteraction）。仓库分桶后
//  critter 支曾全数 fromPlayer=false → 杀鸟（74→旗 8）不进旗杀账/图鉴/计数器行。
//  trap 弹（弹 12 坠星 Projectile.cs:939 trap=true → OwnedBySomeone :580-588=false）
//  反向锁:不写不计数（旧 FallingStar fromPlayer=true=反向偏差,已修）。
describe('SW-BJ47 ⑤ RB10d critter 命中写位收口（Projectile.cs:13382 并集×critter 桶）', () => {
  const mkGameWithCritter = (critter: Enemy) => {
    const g = makeGame();
    (g as { critters: () => unknown[] }).critters = () => [critter];
    (g as { player: unknown }).player = { addDPS: () => {}, lastCreatureHit: -1, dead: false };
    return g;
  };

  it('玩家弹命中 critter：Enemy.hurt 收 fromPlayer=true → lastCreatureHit=旗种域', () => {
    const bird = Enemy.fromVanilla(74, 40 * 16, 20 * 16)!;      // 蓝鸟 74 → 旗 8
    const g = mkGameWithCritter(bird);
    const hit = hitCritters({ x: bird.x, y: bird.y, w: bird.w, h: bird.h }, g);
    expect(hit).toBe(true);
    expect((g as { player: { lastCreatureHit: number } }).player.lastCreatureHit)
      .toBe(bannerOfNpc(74));
  });

  it('trap 弹（坠星 ctx）命中 critter：ownedBySomeone=false → 不写（Projectile.cs:580/:939）', () => {
    const bird = Enemy.fromVanilla(74, 40 * 16, 20 * 16)!;
    const g = mkGameWithCritter(bird);
    hitCritters({ x: bird.x, y: bird.y, w: bird.w, h: bird.h }, g, { trap: true });
    expect((g as { player: { lastCreatureHit: number } }).player.lastCreatureHit).toBe(-1);
  });

  it('变异锁：critter 爆炸/近战/弹三支 fromPlayer=true 在位（旧缺参爆红）', () => {
    const s = readFileSync(fileURLToPath(new URL('../src/core/Game.ts', import.meta.url)), 'utf8');
    // 773 贴附爆炸 critter 支（F-BJ47-A）——★BJ490①（2026-10-04）锁随 ★BJ467④ 演进;
    //  ★BJ729-A（2026-10-27）改判史第二笔：S02（BJ723-B 2026-10-26）将 crit ×2 移入
    //  Enemy.hurt 防后（NPC.cs:82067 单次乘区）——critter 支预倍形 `×(critterTimerCrit
    //  ? 2 : 1)` 已摘（Game.ts:34380 注）,本锁随迁现役定谳形：dmg 臂 = EoW/5 尾臂基伤
    //  （无预倍）,crit 位次 = pen 后 critterTimerCrit（单布尔承载防后 ×2/暴击色/击退
    //  ×1.4 三面）。变异面保持判别力：摘 critterTimerCrit 消费/crit 位次任一 → 红
    //  （敌怪支 en.hurt 同形但 en/c 可辨）。
    expect(s).toMatch(/c\.hurt\(\(this\.world\.isExpert && \(c\.vanillaId \?\? 0\) >= 13 && \(c\.vanillaId \?\? 0\) <= 15\s*\?\s*Math\.trunc\(cdmg \/ 5\) : cdmg\),\s*\(kbDir \|\| \(Math\.sign\(c\.cx - exPx\) \|\| 1\)\) \* 8, 0, this, pen, critterTimerCrit, 0, true\)/);
    // settleKillExplosion 两支（F-BJ47-B）——★BJ729-A（2026-10-27）改判史：双支已被
    //  BJ723-B D4（BJ725-A 清偿）升级 crit 掷+DV 形（41 支 dmgVC/critC :46033 +
    //  settleKillExplosion 支 dmgVCK/critCK :46640,旧 Math.max(1,trunc)+false 静态
    //  假位退役;此前本断言被上方 773 锁失败短路=第二处被掩盖陈旧面,随刀随迁）。
    expect(s.match(/c\.hurt\(applyBannerDamageDealt\(this, c, dmgVC\w*\), cx - c\.cx, 0, this, 0, critC\w*, 0, true\)/g)?.length).toBe(2);
    // 近战 critter 支（F-BJ47-C）
    expect(s).toContain('c.hurt(5, 0, 0, this, 0, false, 0, true);');
    // 坠星敌怪支 trap 语义（F-BJ47-E）：pierce=-1 后 fromPlayer=false
    const fs = readFileSync(fileURLToPath(new URL('../src/entities/FallingStar.ts', import.meta.url)), 'utf8');
    expect(fs).toMatch(/STAR_KB, 0, game, 0, false, -1, false\)/);
  });
});
