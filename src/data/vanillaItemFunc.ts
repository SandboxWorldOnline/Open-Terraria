// 道具功能画像运行时（tools/extract-itemfunc.mjs 从 Item.cs 提取;提取器结构绑定 SetDefaults1-5=1456 布局,存量字段两版同值,1457 新物品段走手补）。
// 用途：vi_ 批次物品的功能桥接——工具（镐/斧/锤挖掘）、药水（治疗/魔力/Buff）。
export interface ItemFunc {
  /** B6:宝藏袋开包面(使用消耗;AllOptionsAtOnce+保底;item=mod 键或原版 vid;
   *  coins=按 NPC 价值掷币) */
  bagLoot?: Array<{ item?: string | number; coins?: string | number; min?: number; max?: number; chance?: number }>;
  melee?: number; ranged?: number; magic?: number; summon?: number;
  noMelee?: number; damage?: number; mana?: number;
  pick?: number; axe?: number; hammer?: number;
  createTile?: number; createWall?: number; placeStyle?: number;
  consumable?: number; potion?: number;
  healLife?: number; healMana?: number;
  /** ★D6(2026-10-13):union 扩展——string=mod buff 键(消费期 itemBuffIdOf 解析;
   *  原版 json 恒数字,零扰动) */
  buffType?: number | string; buffTime?: number;
  ammo?: number; useAmmo?: number; notAmmo?: number;
  shoot?: number; channel?: number; holdStyle?: number; torch?: number;
  useStyle?: number; knockBack?: number; autoReuse?: number;
  /** Item.noUseGraphic（Item.cs:170 缺省 false;json 已有键,类型补列——★清偿刀 H①
   *  5451/5738 holdStyle 7 双件皆 1,静持不画的消费面锚） */
  noUseGraphic?: number;
  fishingPole?: number;  // 钓竿力度（9 支；抛竿入口判定）
  useTime?: number;     // 数据表当前未提取（Game.ts:12113 用 ?? 15 兜底）；提取器补键后即生效
  bait?: number;        // 鱼饵力度（29 种；消耗率 1/(1+bait/6)）
  /** Item.cs useTurn=true（本表 1533 件有此键=1；全量 3504 件在 combat 表同名列——
   *  工具/食物/可放置族，Item.cs:170 缺省 false）。2026-08-17 提取器回填 */
  useTurn?: number;
}

import funcJson from './vanilla-itemfunc.json';

const FUNC = funcJson as Record<string, ItemFunc>;

/** 原版 item id → 功能画像 */
export function itemFuncOfVid(vid: number): ItemFunc | null {
  return FUNC[String(vid)] ?? null;
}

// 1457: 叶绿军刃 1227 重做（Terarria1457 Item.cs:15140-15158）useStyle 1→13（短剑直刺姿势）。
// 完整重做还含 shoot 228→1127（ChlorophyteSaberStab 新弹，未实装）——弹体替换随新弹批落，
// 本表先对齐 useStyle（heldUseStyle 持姿路由消费）；damage/shoot 等战斗字段以
// vanilla-itemcombat.json 为权威（本表同名字段非武器伤害取数口）。
FUNC['1227'] = { ...FUNC['1227'], useStyle: 13 };

// ★BJ738 改判史（P08,2026-10-31,issue #28）：SetDefaults case 226 直通 case 227
//   （Item.cs:4195-4212 `case 226: case 227: this.type = 227;` 共享块）——226 的
//   功能画像 = 227 全量（consumable/potion/healLife 90/useStyle 9/useTurn）。
//   提取器对归一化 case 无独立产出（itemfunc['226'] 缺）→ 存量 SW 档已落盘的
//   vi_226 条目（vid→key 归一前导入的旧档）使用面由本别名保底;新导入/搜索/
//   授予走 items.ts VANILLA_VID_NORMALIZE 直落 vi_227（本条目=纵深防御面）。
FUNC['226'] = { ...FUNC['227'] };

// 1457: DD2 宠物蛋族共享 case 基值 200/703 + 嵌套 case 覆写（Item.cs:34034-34047——
// 组 3855 Gato=200/703、3856 Ghost=201/702（提取器已中）、3857 Dragon=202/701）。
// ★F-STRUCT 泛化重产（2026-09-03）：提取器嵌套 case per-id 归并已自愈——3857 表内
// 直出 202/701（本纠偏幂等退居保险）；3855 表内仍缺档（fallthrough 组基值不入单值
// 面,提取器只对已有条目覆写）→ 本行仍为 3855 的唯一供给方,勿删。
// 原版消费者：Game.ts 快捷 buff/召唤路径读 itemFuncOfVid().buffType/shoot。
FUNC['3855'] = { ...FUNC['3855'], buffType: 200, shoot: 703 };
FUNC['3857'] = { ...FUNC['3857'], buffType: 202, shoot: 701 };

// 1457: Variant 条件面三件基态 autoReuse=false（Item.cs 亲读——1325 :16413 显式
// `autoReuse = false`、3069/5147 基块无 autoReuse 赋值=缺省 false;Variant==
// StrongerVariant 支内才 true）。提取器 Variant 条件面取支内值=基态伪值——
// 持手重复门（Game.ts :10554 autoReuse&&mouseHeld）曾让三件基态误连发。
// ★F-STRUCT 泛化重产（2026-09-03）已自愈：1325 表内直出 0（基态显式 false）;3069/
// 5147 表内按「基态缺省=无键」删除该键 → 本三行幂等（补 0=缺省等价）退居保险,
// 与 vanilla-itemcombat.json 同名列口径一致（item-variants.test.ts:283 同证）。
FUNC['1325'] = { ...FUNC['1325'], autoReuse: 0 };
FUNC['3069'] = { ...FUNC['3069'], autoReuse: 0 };
FUNC['5147'] = { ...FUNC['5147'], autoReuse: 0 };

// 悠悠球族 useStyle 5 提取缺口（Item.cs case 3262 起共享 case 块 `useStyle = 5;
// noUseGraphic = true; noMelee = true`——跨 id 大块提取器漏列；3292/3389/5294 三件
// 已在表）。useSwing 持姿路由（heldUseStyle）与 useStyleBodyRow 身体行（:35986-36011
// 瞄准向行 2/3/4 分档）消费；缺省回退 1 会把悠悠球挥舞画成三段挥砍姿势。
for (const yoyoVid of [3262, 3278, 3279, 3280, 3281, 3282, 3283, 3284, 3285, 3286,
  3287, 3288, 3289, 3290, 3291, 3315, 3316, 3317]) {
  if (!FUNC[String(yoyoVid)]) FUNC[String(yoyoVid)] = {};
  FUNC[String(yoyoVid)].useStyle = 5;
}

// R32（2026-08-25）：血肉抛竿 2421 提取缺口——Item.cs:23071-23100 `type >= 2421 &&
// type <= 2422` 共享 SetDefaults 块（useStyle 1 / useAnimation 8 / useTime 8 /
// shoot = 381 + type - 2421），提取器只落了 2422。2421 数值支：fishingPole=22 /
// shootSpeed 13.5 / rare 1（物品本体暂未入库 items.ts，功能画像先补全=钓竿族判定/
// 浮漂弹配对/静持门在册即生效）。
FUNC['2421'] = { useStyle: 1, shoot: 381, fishingPole: 22 };

// R32（2026-08-25）：竿族 shoot 键补全——Item.cs:23001 `shoot = 361 + type - 2291`
// （2291-2296 共享块）/:23074（2421-2422 块）。提取器只落了 2289/4325/4442 三支的
// shoot，其余五支缺键（消费端存活门已改读 bobberProjIdFor 移植表，此处补全供
// 其他 shoot 消费方对齐 SetDefaults 终值）。
FUNC['2291'] = { ...FUNC['2291'], shoot: 361 };
FUNC['2292'] = { ...FUNC['2292'], shoot: 362 };
FUNC['2293'] = { ...FUNC['2293'], shoot: 363 };
FUNC['2294'] = { ...FUNC['2294'], shoot: 364 };
FUNC['2295'] = { ...FUNC['2295'], shoot: 365 };
FUNC['2296'] = { ...FUNC['2296'], shoot: 366 };
FUNC['2422'] = { ...FUNC['2422'], shoot: 382 };

// SW-E1 2026-09-03：Power Bomb 5594 / Sticky Power Bomb 5595——Item.cs:44024-44028
// `DefaultToBomb(1086+(type-5594), 6f)`（DefaultToBomb 本体 :47771-47783）共享算式
// 提取器不解析 → 本表/combat 表双缺=死物品。功能画像推导终值：shoot 1086/1087、
// useStyle 1、useTime=useAnimation 40、consumable、noMelee（本接口无 shootSpeed/
// useAnimation/noUseGraphic 键——战斗面完整值在 vanillaItemCombat.ts EXTRACT_PATCH
// '5594'/'5595'）；爆炸伤 200/击退 9 由弹侧 PrepareBombToBlow（P.cs:47652-47657）
// 承载，物品面 damage/knockBack 缺省 0=原版同态。消费面=itemTooltip 分类行/
// MobileControls 持械门（Game 投掷分流走 combatWeapon 不经本表,与炸弹 166 同构）。
// SW-X1 2026-09-04（L-2②）：整对象替换改 spread 合并——本三行是手填画像,若未来
// vanilla-itemfunc.json 重产（解析直出面比手填多 autoReuse/noUseGraphic 等键,
// Blue 实证）,整对象替换会静默剥掉解析键;spread 合并后手填键只做覆写。
FUNC['5594'] = { ...FUNC['5594'], shoot: 1086, useStyle: 1, useTime: 40, consumable: 1, noMelee: 1 };
FUNC['5595'] = { ...FUNC['5595'], shoot: 1087, useStyle: 1, useTime: 40, consumable: 1, noMelee: 1 };

// SW-K1 2026-09-03：割草机 4049（Item.cs:35615-35618 → DefaultToLawnMower
// :48532-48541 形参赋值提取器不解析 → json 缺键）。useStyle 11 = MowTheLawn
// （ItemUseStyleID.cs:27——1457 bodyFrame 行档 Player.cs:36624-36639,与 useStyle 8
// GolfPlay 是两档,仓内 Renderer.useStyleBodyRow case 11 行 4/3/2 即本档,仅注释
// 名互换）;holdStyle 1 = 静持也渲染（Renderer 静持门读 itemFunc.holdStyle）;
// useTime/autoReuse 战斗面权威在 vanillaItemCombat.ts EXTRACT_PATCH '4049'。
// SW-X1 2026-09-04（L-2②）：同上 spread 合并防重产剥键（解析直出比手填多
// autoReuse/noUseGraphic,Blue 实证）。
FUNC['4049'] = { ...FUNC['4049'], useStyle: 11, holdStyle: 1 };

/** 内部 item id（vi_ key）→ 功能画像 */
export function itemFuncOfInternal(id: number, key: string): ItemFunc | null {
  const m = /^vi_(\d+)_/.exec(key);
  return m ? FUNC[m[1]] ?? null : null;
}

/** ★Mod 物品功能画像注册面(2026-10-04):vid=mod stable id(30000+),写 FUNC 同表
 *  ——itemFuncOfVid(vid) 派发面零改即通(手填补丁先例同款,SW-E1/K1/R32 同机制)。 */
export function registerModItemFunc(vid: number, func: ItemFunc): void {
  if (vid < 30000) throw new Error(`[mod-itemfunc] vid 须 ≥30000(mod 段): ${vid}`);
  FUNC[String(vid)] = { ...func };
}

/** ★D11-M4(2026-10-14):mod func teardown(热重载;旧=残留=B 物品拿 A 的
 *  useStyle/shoot[发射 A 的弹幕])——vid≥30000 段清 */
export function _resetModItemFuncForTests(): void {
  for (const k of Object.keys(FUNC)) if (Number(k) >= 30000) delete FUNC[k];
}
