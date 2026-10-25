// 旗帜系统（Terraria.GameContent/BannerSystem.cs + ItemID.Sets 1:1）
// 数据 = tools/extract-banners.mjs 提取（NPCtoBanner 457 怪【★BJ334 负 netID 盲区
// 修复,含 -1..-10 史莱姆族 10 键】/ BannerToItem 特例+级联区间 /
// BannerToNPC 规范代表表 287 项【含 7 负规范】/ KillsToBanner 门槛表,默认 50）。
// 击杀计数→达标公告+授予;屏内旗 tile 91 解码→bannerId→npc 集（buff 乘区在 Game/Enemy 消费）。
import bannersJson from '../data/vanilla-banners.json';
import { TILE } from '../core/constants';
import { TILE_BY_KEY } from '../data/tiles';

const D = bannersJson as unknown as {
  npcToBanner: Record<string, number>;
  bannerToItem: Record<string, number>;
  bannerRanges: Array<{ gt: boolean; min: number; base: number; off: number }>;
  bannerToNpc: Record<string, number>;
  killsToBanner: Record<string, number>;
};

export const NPC_TO_BANNER = D.npcToBanner;
/** banner→npcs 反查（一次性反转） */
const BANNER_TO_NPCS = (() => {
  const m = new Map<number, Set<number>>();
  for (const [npcS, banner] of Object.entries(D.npcToBanner)) {
    const npc = +npcS;
    let s = m.get(banner);
    if (!s) { s = new Set(); m.set(banner, s); }
    s.add(npc);
  }
  return m;
})();

/** 物品 → 旗帜对应 NPC id（tooltip 显示名注入用;非旗帜物品 -1）。
 *  itemToBanner 满表在 ItemID.Sets（Main.cs 同源）——此处由 npcToBanner 全表
 *  反查构建（一次性,290 条）;bannerToItem 仅 6 条显式项（多 banner 共享 item 的
 *  特例,反查自然覆盖）。 */
const ITEM_TO_NPC: Map<number, number> = (() => {
  const m = new Map<number, number>();
  // ★BJ334(2026-09-24)：规范代表优先（D.bannerToNpc = 原版 BannerToNPC 箭头表）
  //  ——同旗多 NPC 时原版 tooltip/公告名一律取规范代表（BannerSystem.cs:249-255）,
  //  负键入库后最小 id 近似会翻错（母史莱姆旗 146 的 NPC 集 {-5,16},最小=-5 宝宝,
  //  原版规范=16 母史莱姆）;负变体旗本身（2928→-3 绿史莱姆等）也由此覆盖。
  for (const [banner, npc] of Object.entries(D.bannerToNpc)) {
    const item = bannerItemId(Number(banner));
    if (item > 0 && !m.has(item)) m.set(item, Number(npc));
  }
  // npcToBanner 反查补缺（规范表外仍可达的旗）
  for (const [npc, banner] of Object.entries(NPC_TO_BANNER)) {
    const item = bannerItemId(Number(banner));
    if (item > 0 && !m.has(item)) m.set(item, Number(npc));
  }
  return m;
})();

export function bannerNpcOfItem(itemId: number): number {
  return ITEM_TO_NPC.get(itemId) ?? -1;
}

export function bannerOfNpc(npcId: number): number {
  return D.npcToBanner[String(npcId)] ?? D.npcToBanner[npcId] ?? 0;
}

/** BannerToItem（:282-362 特例+级联;末段无条件 1615+banner-1 兜底 1..87） */
export function bannerItemId(banner: number): number {
  const special = D.bannerToItem[String(banner)] ?? D.bannerToItem[banner];
  if (special !== undefined) return special;
  for (const r of D.bannerRanges) {
    if (r.gt ? banner > r.min : banner >= r.min) return r.base + banner - r.off;
  }
  return 0;
}

/** ItemID.Sets.KillsToBanner（默认 50,DD2 族 10/100/1000 等 43 特例） */
export function killsNeededForBanner(itemId: number): number {
  return D.killsToBanner[String(itemId)] ?? D.killsToBanner[itemId] ?? D.killsToBanner['*'] ?? 50;
}

/** BannerToNPC（BannerSystem.cs:1156 switch，旗种 → 规范代表 NPC id；1..292 提取面
 *  280 项,表外 12 旗 90/94/119/131/151/155/159/181/182/183/194/200 = 原版 `_ => 0`
 *  兜底且 NPCtoBanner 侧无任何 NPC 映射（不可达））。同旗多 NPC（蓝史莱姆
 *  74/297/298 → 旗 8）公告/tooltip 一律取规范代表名——不能用 npcToBanner 反查的
 *  最小 npc id 顶替（机制不同：原版公告名 = BannerSystem.AddNPCKillBy :249-255
 *  `Lang.GetNPCName(BannerToNPC(num))`）。 */
export function bannerToNpcOf(banner: number): number {
  return D.bannerToNpc[String(banner)] ?? D.bannerToNpc[banner] ?? 0;
}

/**
 * NPC.ExcludedFromDeathTally（NPC.cs:80610-80625）死亡记账排除面：
 *   - NPCID.Sets.ProjectileNPC（NPCID.cs:4805）11 类：25/30/665/33/112/666/261/265/371/516/519
 *   - NPCID.Sets.PositiveNPCTypesExcludedFromDeathTally（NPCID.cs:4869）7 类：
 *     121/384/478/479/410/472/378
 *   - ★BJ334：负 netID 分支（NPC.cs:80610-80619）-5/-1 排除,其余负变体计旗——
 *     实现+锚见 excludedFromDeathTally 内注（曾注"本仓不建模/恒非负"=负变体
 *     未入数据面时的陈旧判词,今废）。
 * 原版 CountKillForBannersAndDropThem（NPC.cs:80627-80637）整门在其内——即便
 * vanilla-banners.json 有映射也【不计旗数/不掉旗】（Boss/弹幕型/特殊 NPC 杀数只进
 * NPC.kills 计数行,不进 BannerSystem.killCount）。1456:4799/:4861 = 1457 逐值相同。
 */
const EXCLUDED_FROM_DEATH_TALLY = new Set([
  25, 30, 665, 33, 112, 666, 261, 265, 371, 516, 519,   // NPCID.Sets.ProjectileNPC :4805
  121, 384, 478, 479, 410, 472, 378,                    // PositiveNPCTypesExcludedFromDeathTally :4869
]);

export function excludedFromDeathTally(npcId: number): boolean {
  // ★BJ334(2026-09-24)：负 netID 分支（NPC.cs:80610-80619）——仅 -5(BabySlime)/
  //  -1(Slimeling) 排除,其余负变体（-2 恶翅/-3 绿/-4 粉/-6 黑/-7 紫/-8 红/-9 黄/
  //  -10 丛林史莱姆）照常计旗。曾整缺（表无负键时负 id 查不到旗=banner<=0 早退,
  //  碰巧同相;vanilla-banners.json 补负键后此门成为活性位——-5 若漏排会误计
  //  母史莱姆旗 146）。
  if (npcId < 0) return npcId === -5 || npcId === -1;
  return EXCLUDED_FROM_DEATH_TALLY.has(npcId);
}

/**
 * ★bannerStyleOf（⑤巡检 2026-09-03 十三批）：旗种 id（BannerSystem 域 1-292）→
 * tile 91 帧 style 域的逆写。SceneMetrics.cs:419-441 正变换 = S−21（首带）+ 每带
 * +111、S≥311 再 −1、S≥312 再 −1 —— 逆写即 S = banner+21，落进被抽掉的 311/312
 * 两格时再 +1 跳过（311/312 是原版独立非敌旗档 5497 PinkBanner/5498，
 * vanillaStyleDrops.BANNERS 同域）。缺它：旗 290/291（item 5651/5672）写进
 * 311/312 空档 = 无旗 buff + 破坏掉错物 + 空帧；旗 292（5673）落 313 = 被解码成
 * 290。原版旗物品 Item.placeStyle 即 style 直域（Item.cs:19231
 * `placeStyle = 22 + type - 1615` 等），本仓 kill-drop 实例位载旗种 id
 * （Game.spawnDrop 第 7 参），放置点经本函数换算（bannerStyleDomain）。
 */
export function bannerStyleOf(banner: number): number {
  let s = banner + 21;
  if (s >= 311) s++;
  if (s >= 312) s++;
  return s;
}

/**
 * 击杀记账（BannerSystem.AddNPCKillBy :193-216 语义简化版——原版 claimable+UI 领取,
 * 本仓达标即返 true 由调用方公告+掉旗）。返回 true = 恰跨过整数倍门槛（应授予一面旗）。
 * ★ExcludedFromDeathTally 门（NPC.cs:80627 `if (!ExcludedFromDeathTally())`——
 *   ProjectileNPC 11 类 + PositiveNPCTypesExcludedFromDeathTally 7 类不计数）：
 *   前置于计数本体,排除类连 killCount 递增都不发生（原版 AddNPCKillBy 整体不达）。
 *   GetWereThereAnyInteractions 交互门在调用侧（NPC.cs:79652-79661 包整段,Game.ts）。
 */
export function recordBannerKill(kills: Record<number, number>, npcId: number): boolean {
  const banner = bannerOfNpc(npcId);
  if (banner <= 0) return false;
  if (excludedFromDeathTally(npcId)) return false;
  kills[banner] = (kills[banner] ?? 0) + 1;
  const itemId = bannerItemId(banner);
  const need = killsNeededForBanner(itemId);
  return need > 0 && kills[banner] % need === 0;
}

/**
 * 屏内旗扫描（SceneMetrics.cs:419-447 解码 1:1）：
 *   num = frameX/18 + frameY 每降一行 +111（旗 sheet 横排 111 列/带换行）；
 *   跳过 = (frameX<396 && frameY<54)（首带前 22 列=非敌旗区）|| num==311 || num==312
 *   （原版空帧占位样式）；banner = frameX/18 − 21 + 行×111，num≥311 再 −1、≥312 再 −1
 *   （311/312 两格被抽掉后的整体前移校正）。
 * ★tile id：原版比较 tile.type==91（原版 id 空间）；本仓内部 id 空间下旗
 *   v_91_banners 的内部 id 是动态注册序（当前=164；字面量 91 实为
 *   v_189_cloud_block）——曾写字面量 91 → `_bannerNpcs` 恒空集，受击减伤/
 *   敌怪增伤/敌弹增伤三条旗 buff 链全族静默失效（R21-7.5）。故必须经
 *   TILE_BY_KEY 反查内部 id，禁止钉死数字。
 * 返回 npcId 集（buff 消费侧用）。
 */
export function scanBannerNpcs(
  store: import('./TileStore').TileStore,
  x0: number, y0: number, x1: number, y1: number,
): Set<number> {
  const npcs = new Set<number>();
  const bannerTileId = TILE_BY_KEY['v_91_banners'];
  if (bannerTileId === undefined) return npcs;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      // ★G1 谓词形态批（2026-09-04）：SceneMetrics.ScanTiles :365-372
      //  `if (!tile.active()) { liquid 计数; continue; }`=裸 active()——致动旗照计入
      //  减伤/增伤 buff 面（nactive 门曾使致动旗整族静默失效）
      if (!store.hasTile(x, y)) continue;
      const i = store.idx(x, y);
      if (store.type[i] !== bannerTileId) continue;
      const fx = Math.floor(store.frameX[i] / 18), fyRaw = store.frameY[i];
      let rows = 0;
      for (let fy = fyRaw; fy >= 54; fy -= 54) rows++;
      const num = fx + rows * 111;
      // 首带前 22 列（fx<396）且首行 = 特殊旗区非敌旗；311/312 = 原版空帧跳过
      if ((store.frameX[i] < 396 && fyRaw < 54) || num === 311 || num === 312) continue;
      let banner = fx - 21 + rows * 111;
      if (num >= 311) banner--;
      if (num >= 312) banner--;
      const set = BANNER_TO_NPCS.get(banner);
      if (set) for (const n of set) npcs.add(n);
    }
  }
  return npcs;
}

/** 屏内旗的【代表 NPC】集（旗 buff tooltip 名单用，Main.cs:21558-21612
 *  bannerMouseOver 1:1：循环按 BannerSystem 旗种枚举，每面旗经 BannerToNPC(i)
 *  取一个代表 NPC 名 = 一旗一行。同种多面旗去重（Set）；多 NPC 旗（僵尸旗覆盖
 *  全僵尸族变体）只出一行代表名，不逐变体罗列——2026-09-01 用户实报名单重复根因。
 *  ★BJ334：代表 = BannerToNPC 规范代表（循环内注;最小 id 仅规范 0 时兜底,
 *  负变体旗入库后最小 id 近似会把母史莱姆旗翻成 -5 宝宝名） */
export function scanBannerReps(
  store: import('./TileStore').TileStore,
  x0: number, y0: number, x1: number, y1: number,
): Set<number> {
  const reps = new Set<number>();
  const bannerTileId = TILE_BY_KEY['v_91_banners'];
  if (bannerTileId === undefined) return reps;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      // ★G1 谓词形态批（2026-09-04）：同 scanBannerNpcs——SceneMetrics.ScanTiles
      //  :365-372 裸 active() → hasTile（致动旗照计）
      if (!store.hasTile(x, y)) continue;
      const i = store.idx(x, y);
      if (store.type[i] !== bannerTileId) continue;
      const fx = Math.floor(store.frameX[i] / 18), fyRaw = store.frameY[i];
      let rows = 0;
      for (let fy = fyRaw; fy >= 54; fy -= 54) rows++;
      const num = fx + rows * 111;
      if ((store.frameX[i] < 396 && fyRaw < 54) || num === 311 || num === 312) continue;
      let banner = fx - 21 + rows * 111;
      if (num >= 311) banner--;
      if (num >= 312) banner--;
      const set = BANNER_TO_NPCS.get(banner);
      if (set) {
        // ★BJ334(2026-09-24)：代表 = 原版 BannerToNPC 规范代表（Main.cs:21558-21612
        //  每旗一行名的原文口径;本函数头注同）。最小 id 近似在负变体旗入库后翻错
        //  （146 集 {-5,16} 取 -5=宝宝,原版规范=16 母史莱姆）。规范 0（12 不可达旗）
        //  回退最小 id 保旧行为。
        const canonical = bannerToNpcOf(banner);
        if (canonical !== 0) {
          reps.add(canonical);
        } else {
          let min = Infinity;
          for (const n of set) if (n < min) min = n;
          reps.add(min);
        }
      }
    }
  }
  return reps;
}

/** 旗 buff 乘区（ItemID.Sets.BannerStrength:普通族 1.0 → 伤 ×1.5/受伤 ×0.75,
 *  专家 ×2/×0.5;DD2 族(itemId 3837-3846)0.2 档 → ×1.1/×0.917,专家 ×1.2/×0.833
 *  ——2026-08-13 区分,itemId 参数=旗的对应物品 id） */
const DD2_BANNER_ITEMS = new Set([3837, 3838, 3839, 3840, 3841, 3842, 3843, 3844, 3845, 3846]);
export function bannerDamageMult(expert: boolean, itemId = 0): number {
  const dd2 = DD2_BANNER_ITEMS.has(itemId);
  if (dd2) return expert ? 1.2 : 1.1;
  return expert ? 2 : 1.5;
}
export function bannerReceivedMult(difficulty: number, itemId = 0): number {
  // ★BJ716-A（R15-P2-4，2026-10-25）：布尔档 → 曲线式——原版 DamageReceived 曲线
  //  keys{Classic(1):k1, Expert(2):k2}（ItemID.cs:28-31）,Sample 双端钳界+段内线性
  //  （GameDifficultyData.cs:35-55——R15 判例1）;旅程滑杆分数难度∈(1,2) 连续插值,
  //  旧布尔档 mainExpertMode 在 (1,2) 恒 k1=旗减伤弱于原版（R15 判例3「布尔档
  //  只在整数难度轴等价」）。非旅程整数值两式逐值相同;k1/k2 端点保持三位小数
  //  不动（G35 D6 锁——0.917/0.833 vs 0.9166667/0.8333333 分歧带不可达,零扰动）。
  //  消费位传 mainDifficulty(world)（projTargets applyBannerDamageReceivedOnProj +
  //  Game.ts 接触面 :44764）;难度≤1（含旅程 0.5）→ k1,≥2（专家/大师/传奇）→ k2。
  const dd2 = DD2_BANNER_ITEMS.has(itemId);
  const k1 = dd2 ? 0.917 : 0.75;
  const k2 = dd2 ? 0.833 : 0.5;
  if (difficulty <= 1) return k1;
  if (difficulty >= 2) return k2;
  return k1 + (k2 - k1) * (difficulty - 1);
}
