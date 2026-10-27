// SW-FX5（2026-09-10）工具域登记债收口：docs/audit/item-audit-2026-08-22.md 工具节
// E1-E9 现状定谳后的【残余】补债 + 已清项回归钉。
//
// 现状定谳表（对盘 2026-09-10，1457 反编译锚）：
//  E1 锤墙 ×1.5+CanPlayerSmashWall → 已清（SW-BO1/BF1/BN5；Game.ts 拆墙段 ：18928/:19011）；
//     【残余=拆墙节拍】原版 TryHittingWall :46303 门 `toolTime == 0`，写值
//     `itemTime = sItem.useTime / 2`（:46343 直写,int 除）；整形 ApplyItemTime=useTime
//     （:46370）；镐支 itemTime=(int)(useTime×pickSpeed)（:46163-46166）；祭坛/珠
//     ApplyItemTime=useTime（:46087/:46089）。五写点共享一个 itemTime → 门与最后动作
//     种类无关。本仓曾自创 `max(8,挥击档)` 窗 + 尾写 3/4 偏移 → 圣锤（367: useTime14/
//     anim27,Item.cs case 367）拆墙 20t/击 vs 原版 7t/击（审计 E1 自证"圣锤原版 1 击/7t"）
//     慢 3 倍。修=lastMineItemTime 镜像 itemTime 写值,hammer 节流窗读之。
//  E2 九缺口 → 全清：①软块二倍 SOFT_DIG_SHEETS(:54616) ②地牢砖 X 中带豁免(:54599-54604)
//     ③677-679 入 TILE_DUNGEON_SHEETS(Main.cs:7944-7946) ④137 frameY/18∈[1,4] 210 门
//     (:54589-54596) ⑤128/269 本仓三通道全断不移植（Game.ts tileHitDamage 内备案注,
//     Item.cs:7310-7321/:21280/:35346 + WldParser.ts:144）⑥404 +5(:54621) ⑦199/绳族
//     =100(:54624) ⑧77 深度线=maxTilesY-200(:54577,Main.cs:2886) ⑨25/203 infectedSeed
//     豁免(:54557)——本文件逐支钉回归。
//  E3 挥摆节奏 → 审计误诊：原版重启门=itemAnimation 归零（:43084,时长=useAnimation），
//     itemTime（useTime）只节流动画内的命中（ItemCheck_Shoot flag4 :43868 同理），审计
//     "原版=useTime 重启"反了。残余=工具支挥摆时长下限钳 14 非原版（SetItemAnimation
//     val=max(val,1) :4440-4447）→ 快工具 5 件（2176/2776/2781/2786/3466,useAnimation=12）
//     动画/挥击音/重启 14t→12t。修=max(14,…)→max(1,…)。
//  E4 射程外起手 → 审计误诊：原版起手动画+UseSound 无射程门（ItemCheck_CheckCanUse_Inner
//     :52680-52866 无域门 → ItemCheck_StartActualUse :52290-52330 无条件 ApplyItemAnimation
//     + PlaySound(UseSound)），IsTargetTileInItemRange（:45986→:46005-46007）只拦挖掘动作。
//     本仓工具支先起手+播声再 tryMine 射程门（Game.ts 工具支/tryMine :18531）=已 1:1，勿"修"。
//  E5 光标图标 → 已清（src/player/ToolCursorIcon.ts 五支置位全量移植+tileBoost 全表）。
//  E6 图层两路 → 已清（2026-08-22 手持层级统一：Renderer.ts 手持物层单路 ：13349,
//     "旧'非工具画身体前'分支已退役" :13498）。
//  E7 非匹配静默 → 审计误诊：原版分派 tileHammer→tileAxe→pick（:46039-46166），镐点树落
//     tileAxe 支但 `if (sItem.axe > 0)` 域外（:46063）=无 KillTile 无击打音；斧点石三分支
//     全不中=同静。审计引 :45108/:45148 的 KillTile(fail:true) 在 sItem.axe>0 域内=匹配
//     工具零伤才响。本仓 toolMatchesTile 不匹配 → mining=null 静默返回=已 1:1，本文件钉面。
//  E8 tileHammer 族 → 已清（祭坛反噬/暗影珠/695·696 复刻件/镐排除/drill 直调豁免，
//     Main.cs:7343-7346 全表 {26,31,695,696}）。
//  E9 叶绿 200 → 已清（tiles.ts:102 pick:200；Player.cs:54553）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/core/Game';
import { HitTile } from '../src/core/HitTile';
import { World } from '../src/world/World';
import { TileStore } from '../src/world/TileStore';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { SOFT_DIG_SHEETS, TILE_ROPE_SHEETS } from '../src/core/Game';
import { TILE_HAMMER_SHEETS } from '../src/data/tiles';   // ★BJ187 修旧绑定:BJ158② 已把 tileHammer 单源收编 data/tiles,Game 不再导出（测试面 undefined 陈旧红）

const gameSrc = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');

// ---- tryMine 锤/镐行为壳（_hammer-wall-priority 同式 + lastMineItemTime 显式置 0
//      =构造器初值；Object.create 壳不跑字段初始化器） ----
function mkMineGame(w: World) {
  const g = Object.create(Game.prototype) as unknown as Record<string, any> & {
    tryMine: (...a: unknown[]) => void;
  };
  g.netCanEditTile = () => true;
  g.inTileRange = () => true;
  g.world = w;
  g.hitTiles = new HitTile();
  g.tickCount = 0;
  g.lastMineHitTick = -999;
  g.lastMineItemTime = 0;   // 构造器初值镜像
  g.mining = null;
  g.hardnessCache = 0;
  g.input = { mouseHeld: true, mouseX: 0, mouseY: 0 };
  g.camera = { screenToWorld: () => [0, 0] };
  g.player = {
    buffs: { has: () => false, wellFedTier: 0, hungerPickSpeed: 0 },
    usedAmbrosia: false,
    equipStats: { chiselSpeed: false },
    inv: { heldItem: () => null },
  };
  const sounds: string[] = [];
  const dusts: number[] = [];
  g.killTileBreakSound = () => { sounds.push('hit'); };
  g.killWallSound = () => { sounds.push('wall'); };
  g.spawnParticles = (_x: number, _y: number, _c: string, n: number) => { dusts.push(n); };
  g.spawnDrop = () => null;
  g.sfx = { play: () => {}, playWavFile: () => {}, playSfxFile: () => {} };
  g.playSfxFile = () => {};
  g.breakTile = () => {};
  g.tileAboveProtected = () => false;
  g.canPoundTile = () => true;
  g.trackTile = 0;
  // ★BJ730 夹具补桩：tryMine 接入意图猜测器（intentionGuesser.track/allowTracking,
  //  Game 构造器字段 :3956——真 Game 恒有,Object.create 壳须手铺,同壳模式既有习语）。
  g.intentionGuesser = { track: () => {}, allowTracking: () => {}, update: () => {} };
  g.hammerPoundRelease = false;
  return { g, sounds, dusts };
}

// HitTile 池号：1=挖掘（默认）,2=拆墙（Player.hitTile type 位;HitTile.ts addDamage type=1）
const dmg2 = (g: Record<string, unknown>, x: number, y: number, k = 1): number =>
  (g.hitTiles as { getDamage: (x: number, y: number, k?: number) => number }).getDamage(x, y, k);

describe('SW-FX5 E1 残余：拆墙节拍 = itemTime = useTime/2（Player.cs:46303/:46343）', () => {
  it('① 半速节拍：useTime=14（圣锤 367 spec）→ 击拍 0/7/14t；6t 窗内被吞', () => {
    const w = new World(40, 40, 20, 'open');
    const st = w.store;
    st.setTile(20, 20, TILE_BY_KEY['stone'], 0, 0);
    st.setWall(20, 20, 1);                                  // 石墙（房墙族恒可拆）
    const { g } = mkMineGame(w);
    // power 25 → floor(25×1.5)=37/击 → 3 击破（111≥100）；木锤 7 spec（useTime20/anim30）
    const hit = (t: number) => {
      g.tickCount = t;
      g.tryMine(20, 20, 25, 'hammer', 30, 14);
    };
    hit(0);
    expect(dmg2(g, 20, 20, 2)).toBe(37);                       // ×1.5 账（:46332 PickWall）
    hit(6);
    expect(dmg2(g, 20, 20, 2)).toBe(37);                       // 6 < 14/2=7 → 吞（旧 max(8,挥击档) 窗在此落击=变异红）
    hit(7);
    expect(dmg2(g, 20, 20, 2)).toBe(74);                       // 7 ≥ 7 → 第二击
    hit(14);
    expect(st.wall[st.idx(20, 20)]).toBe(0);                // 14 ≥ 7 → 第三击破墙
  });

  it('② 整形写 useTime：整形后 <useTime 窗内拆墙被吞，t=useTime 落击（:46370）', () => {
    const w = new World(40, 40, 20, 'open');
    const st = w.store;
    st.setTile(20, 20, TILE_BY_KEY['stone'], 0, 0);
    st.setWall(20, 20, 1);
    const { g } = mkMineGame(w);
    g.hammerPoundRelease = true;
    g.tryMine(20, 20, 40, 'hammer', 20, 6);                 // t=0 整形消费闩
    const i = st.idx(20, 20);
    expect(st.half[i] !== 0 || st.slope[i] !== 0).toBe(true);
    g.tickCount = 3;
    g.tryMine(20, 20, 40, 'hammer', 20, 6);                 // 3 < 6（itemTime=useTime）→ 吞
    expect(dmg2(g, 20, 20, 2)).toBe(0);
    g.tickCount = 6;
    g.tryMine(20, 20, 40, 'hammer', 20, 6);                 // t=6 → 拆墙落击
    expect(dmg2(g, 20, 20, 2)).toBe(60);                       // floor(40×1.5)
  });

  it('③ 共享 itemTime：镐击后 hammer 拆墙等【镐的】useTime×pickSpeed（:46163 一域）', () => {
    const w = new World(40, 40, 20, 'open');
    const st = w.store;
    st.setTile(20, 20, TILE_BY_KEY['stone'], 0, 0);
    st.setWall(20, 20, 1);
    const { g } = mkMineGame(w);
    g.tryMine(20, 20, 40, 'pick', 20, 10);                  // t=0 镐击（itemTime=10,无糖分链 ×1）
    expect(dmg2(g, 20, 20)).toBe(40);                       // 镐伤 40 落挖掘池（k=1）
    g.tickCount = 5;
    g.tryMine(20, 20, 40, 'hammer', 20, 6);                 // 5 < 10（镐写值）→ 吞（旧 max(8,20) 窗不读镐写值=变异红）
    expect(dmg2(g, 20, 20, 2)).toBe(0);
    g.tickCount = 10;
    g.tryMine(20, 20, 40, 'hammer', 20, 6);                 // t=10 → 落击
    expect(dmg2(g, 20, 20, 2)).toBe(60);
  });

  it('④ 数据锚：圣锤 367 useTime=14/anim27（Item.cs case 367）→ 原版拆墙 7t/击', () => {
    expect(itemCombat(367)!.useTime).toBe(14);
    expect(itemCombat(367)!.useAnimation).toBe(27);
  });

  it('⑤ ★SW-RB11b E1 反向共享：锤墙写 useTime/2 后切镐，本地窗（useTime=3）不再提前放行（:43911 toolTime 镜像共享 itemTime）', () => {
    const w = new World(40, 40, 20, 'open');
    const st = w.store;
    st.setTile(20, 20, TILE_BY_KEY['stone'], 0, 0);
    st.setWall(20, 20, 1);
    const { g } = mkMineGame(w);
    g.tryMine(20, 20, 40, 'hammer', 20, 14);                // t=0 拆墙（itemTime=14/2=7）
    expect(dmg2(g, 20, 20, 2)).toBe(60);
    g.tickCount = 3;
    g.tryMine(20, 20, 40, 'pick', 20, 3);                   // 3 < 7（锤写值）→ 吞（旧本地门按镐 useTime=3 放行=偏差）
    expect(dmg2(g, 20, 20)).toBe(0);
    g.tickCount = 7;
    g.tryMine(20, 20, 40, 'pick', 20, 3);                   // t=7 ≥ 7 → 镐落击
    expect(dmg2(g, 20, 20)).toBe(40);
  });

  it('⑥ ★SW-RB11b F5：(int) 截断非四舍五入（:46163 `(int)(useTime×pickSpeed)`）——15×0.85=12.75→12 拍（round=13 慢 1 拍）', () => {
    const w = new World(40, 40, 20, 'open');
    w.store.setTile(20, 20, TILE_BY_KEY['stone'], 0, 0);
    const { g } = mkMineGame(w);
    // 饱食三档 −0.15 → pickSpeed=0.85（pickSpeedMult 减量链,无 Mining/chisel 等其余源）
    g.player.buffs.wellFedTier = 3;
    const hit = (t: number) => { g.tickCount = t; g.tryMine(20, 20, 40, 'pick', 20, 15); };
    hit(0);
    expect(dmg2(g, 20, 20)).toBe(40);
    g.tickCount = 12;                                        // 12 ≥ ⌊15×0.85⌋=12 → 落击（round=13 时 12<13 被吞）
    g.tryMine(20, 20, 40, 'pick', 20, 15);
    expect(dmg2(g, 20, 20)).toBe(80);
  });
});

describe('SW-FX5 E3 残余：工具支挥摆时长下限钳 14→1（SetItemAnimation :4440-4447）', () => {
  it('结构锚：工具支 spd= max(1, round(useAnimation/attackSpeedMult))，14 钳退役', () => {
    // ★BJ730 改判史：旧形 `Math.max(1, Math.round((tool.speed ?? 46) / attackSpeedMult))`
    //  ——BJ640（2026-10-11 攻速三面重写）整面替换:①方向应【乘】M 非÷（+加成→变短）
    //  ②词缀 spd 烘定 roundCSf32Mul ③(int) 截断 truncCSf32Mul（f32 位级,:4438-4446）;
    //  下限钳 1 语义在新形在位（:4444 同源）,锁随 BJ640 形。
    expect(gameSrc).toContain('Math.max(1, truncCSf32Mul(roundCSf32Mul(nativeSpd, psSw?.spd ?? 1), this.player.attackSpeedMult))');
    expect(gameSrc).not.toContain('Math.max(14, Math.round((tool.speed');
  });
  it('数据锚：快工具 5 件 useAnimation=12（修复前挥摆/挥击音/重启被钳 14t）', () => {
    for (const vid of [2176, 2776, 2781, 2786, 3466]) {
      expect(itemCombat(vid)!.useAnimation, `vid ${vid}`).toBe(12);
      expect(itemCombat(vid)!.useTime, `vid ${vid}`).toBeLessThan(12);
    }
  });
});

// ---- tileHitDamage 纯 GetPickaxeDamage 面（sw-rb9c shell 同式：respectCanKillTile=false
//      ——原版 GetPickaxeDamage 本体无 CanKillTile 门,在 PickTile 层 :54474） ----
function dmgShell(h = 1200, groundLevel = 300, storeW = 4200, realStore?: TileStore) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    tileHitDamage: (tx: number, ty: number, type: number, toolType: 'pick' | 'axe' | 'hammer',
      power: number, respectTransformingTiles?: boolean, respectCanKillTile?: boolean) => number;
  };
  g.world = { h, groundLevel, seedFlags: {} as Record<string, unknown>,
    store: realStore ?? { w: storeW, h } };
  g.input = {};
  return g;
}
const dmgOf = (g: ReturnType<typeof dmgShell>, x: number, y: number, type: number, power: number): number =>
  g.tileHitDamage(x, y, type, 'pick', power, false, false);

describe('SW-FX5 E2 逐支回归钉（GetPickaxeDamage :54540-54700 已清项防回退）', () => {
  it('① 软块二倍速全表（:54616 num += pickPower）', () => {
    expect([...SOFT_DIG_SHEETS].sort((a, b) => a - b)).toEqual([0, 40, 53, 57, 59, 123, 147, 224, 397]);
    const g = dmgShell();
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['snow'], 35)).toBe(70);   // 147 雪：35+35
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['dirt'], 35)).toBe(70);   // 0 土（sw-rb9c 已钉,双钉）
  });

  it('② 地牢砖 X 中带豁免（:54597-54604：仅 y>worldSurface 且 X 出 [35%,65%] 带才要 100）', () => {
    const g = dmgShell();
    const blue = TILE_BY_KEY['v_41_blue_brick'];            // sheet 41,pick 100
    expect(dmgOf(g, 2100, 400, blue, 40)).toBe(20);         // 中带内（0.35×4200=1470 ≤ 2100 ≤ 2730）：÷2 不归零
    expect(dmgOf(g, 100, 400, blue, 40)).toBe(0);           // 带外（x<1470）+地表下+<100 → 0
    expect(dmgOf(g, 100, 400, blue, 100)).toBe(50);         // 带外满门槛 → ÷2
    expect(dmgOf(g, 2100, 400, blue, 100)).toBe(50);        // 中带内满门槛 → ÷2
    expect(dmgOf(g, 100, 200, blue, 40)).toBe(20);          // 地表【上】（y≤300）无门 → ÷2
  });

  it('③ 677-679 远古地牢砖入 tileDungeon 族（Main.cs:7944-7946）：÷2 + 100 门 + 中带豁免', () => {
    const g = dmgShell();
    const ancient = TILE_BY_KEY['v_677_ancient_blue_brick'];
    expect(TILE_HAMMER_SHEETS.has(677)).toBe(false);
    expect(dmgOf(g, 2100, 400, ancient, 40)).toBe(20);      // 中带豁免同 41
    expect(dmgOf(g, 100, 400, ancient, 40)).toBe(0);        // 带外地表下 <100 → 0
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['v_678_ancient_green_brick'], 40)).toBe(0);
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['v_679_ancient_pink_brick'], 100)).toBe(50);
  });

  it('④ 137 机关 frameY/18∈[1,4] 210 门（:54589-54596）；style 0/5 任意镐', () => {
    const store = new TileStore(100, 200);
    const g = dmgShell(1200, 300, 4200, store);
    const trap = TILE_BY_KEY['v_137_traps'];
    store.setTile(50, 100, trap, 0, 0);                     // style 0（frameY=0 飞镖）
    expect(dmgOf(g, 50, 100, trap, 100)).toBe(100);
    store.setTile(50, 100, trap, 0, 18);                    // style 1（超枪）
    expect(dmgOf(g, 50, 100, trap, 100)).toBe(0);
    expect(dmgOf(g, 50, 100, trap, 210)).toBe(210);
    store.setTile(50, 100, trap, 0, 72);                    // style 4（frameY/18=4 长矛）
    expect(dmgOf(g, 50, 100, trap, 209)).toBe(0);
    store.setTile(50, 100, trap, 0, 90);                    // style 5（毒镖）
    expect(dmgOf(g, 50, 100, trap, 100)).toBe(100);
  });

  it('⑤ 404 沙漠化石 +5（:54621）', () => {
    const g = dmgShell();
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['desert_fossil'], 0)).toBe(5);
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['desert_fossil'], 30)).toBe(35);
  });

  it('⑥ 199 猩红草 / 绳族 =100 一击（:54624；tileRope Main.cs:9452-9460）', () => {
    const g = dmgShell();
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['v_199_crimson_grass_block'], 10)).toBe(100);
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['v_213_rope'], 10)).toBe(100);
    expect(TILE_ROPE_SHEETS.has(213)).toBe(true);
  });

  it('⑨ 25/203 infectedSeed 豁免（:54557 !Main.infectedSeed 域内 65 门失效）', () => {
    const g = dmgShell();
    (g.world as { seedFlags: Record<string, unknown> }).seedFlags = {};
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['v_25_ebonstone_block'], 40)).toBe(0);
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['v_203_crimstone_block'], 64)).toBe(0);
    (g.world as { seedFlags: Record<string, unknown> }).seedFlags = { infectedSeed: true };
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['v_25_ebonstone_block'], 40)).toBe(20);  // ÷2 不归零
    expect(dmgOf(g, 100, 400, TILE_BY_KEY['v_25_ebonstone_block'], 65)).toBe(32);
  });

  it('⑧ 77 深度线=maxTilesY-200（sw-rb9c 已钉,此处钉染疫种子侧不牵动）+ E9 叶绿 200', () => {
    const g = dmgShell();
    (g.world as { seedFlags: Record<string, unknown> }).seedFlags = { infectedSeed: true };
    expect(dmgOf(g, 100, 500, TILE_BY_KEY['v_77_hellforge'], 35)).toBe(35);   // 地狱层上无门（:54577 条件不成立）
    expect(dmgOf(g, 100, 1000, TILE_BY_KEY['v_77_hellforge'], 35)).toBe(0);
    expect(dmgOf(g, 100, 500, TILE_BY_KEY['ore_chlorophyte'], 65)).toBe(0);   // E9（:54553 门 200）
    expect(dmgOf(g, 100, 500, TILE_BY_KEY['ore_chlorophyte'], 200)).toBe(40); // ÷5（:54552）
  });
});

describe('SW-FX5 E7 静默面定谳钉（分派不匹配=无 KillTile 无击打音,Player.cs:46039-46166）', () => {
  it('① 镐点树（tileAxe 支 axe>0 域外）：无音无尘无积累', () => {
    const w = new World(40, 40, 20, 'open');
    const st = w.store;
    st.setTile(20, 20, TILE_BY_KEY['tree'], 0, 0);
    const { g, sounds, dusts } = mkMineGame(w);
    g.tryMine(20, 20, 40, 'pick', 20, 10);
    expect(g.mining).toBe(null);
    expect(sounds).toEqual([]);
    expect(dusts).toEqual([]);
    expect(dmg2(g, 20, 20)).toBe(0);
  });

  it('② 斧点石（三分支全不中）：同静', () => {
    const w = new World(40, 40, 20, 'open');
    const st = w.store;
    st.setTile(20, 20, TILE_BY_KEY['stone'], 0, 0);
    const { g, sounds, dusts } = mkMineGame(w);
    g.tryMine(20, 20, 40, 'axe', 20, 10);
    expect(g.mining).toBe(null);
    expect(sounds).toEqual([]);
    expect(dusts).toEqual([]);
    expect(dmg2(g, 20, 20)).toBe(0);
  });

  it('③ 对照组：匹配工具零伤（陨石 <50 镐）仍播击打音（KillTile fail 支,审计 E7 引据的真相）', () => {
    const w = new World(40, 40, 20, 'open');
    const st = w.store;
    st.setTile(20, 20, TILE_BY_KEY['ore_meteorite'], 0, 0);
    const { g, sounds } = mkMineGame(w);
    g.tryMine(20, 20, 40, 'pick', 20, 10);
    expect(sounds).toEqual(['hit']);                        // 匹配+零伤 → fail 支响（:45108 域=sItem.axe>0 内）
    expect(dmg2(g, 20, 20)).toBe(0);
  });

  it('④ E8 回归钉：镐点暗影珠（tileHammer 族）静默无积累（镐排除,:46039 分派首支）', () => {
    expect([...TILE_HAMMER_SHEETS].sort((a, b) => a - b)).toEqual([26, 31, 695, 696]);
    const w = new World(40, 40, 20, 'open');
    const st = w.store;
    const orb = Object.entries(TILE_BY_KEY).find(([, id]) => TILE_DEFS[id as number]?.vanilla?.sheet === 31)?.[1] as number;
    expect(orb).toBeDefined();
    st.setTile(20, 20, orb!, 0, 0);
    const { g, sounds, dusts } = mkMineGame(w);
    g.tryMine(20, 20, 100, 'pick', 20, 10);
    expect(g.mining).toBe(null);
    expect(sounds).toEqual([]);
    expect(dusts).toEqual([]);
    expect(dmg2(g, 20, 20)).toBe(0);
  });
});

describe('SW-FX5 E4/E3 定谳备案钉（现状已 1:1,防误"修"）', () => {
  it('E4：工具支起手+播声先于 tryMine 射程门（原版 StartActualUse :52290 无域门=同构,勿倒置）', () => {
    const toolBranch = gameSrc.slice(gameSrc.indexOf("if (tool && (tool.type === 'pick'"));
    const swingStart = toolBranch.indexOf('this.swing = { t: spd, dur: spd');
    const useSound = toolBranch.indexOf('this.playUseSound(');
    const mineCall = toolBranch.indexOf('this.tryMine(tx, ty, dual.power');
    expect(swingStart).toBeGreaterThan(-1);
    expect(useSound).toBeGreaterThan(swingStart);
    expect(mineCall).toBeGreaterThan(useSound);             // 射程门在 tryMine 内部（:18531）
    expect(gameSrc).toContain('if (!opts?.drill && !this.inTileRange(tx, ty)) { this.mining = null; return; }');
  });
  it('E2-⑤ 128/269 不移植备案注在盘（三通道全断,Item.cs:7310-7321/:21280/:35346）', () => {
    expect(gameSrc).toContain('128 Mannequin/269 Womannequin');
  });
});
