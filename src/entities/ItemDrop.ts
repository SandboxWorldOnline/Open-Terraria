// 掉落物实体：重力、落地、磁吸拾取
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { ITEM_GRAVITY, ITEM_MAX_FALL, MAGNET_RADIUS, TILE } from '../core/constants';
import { moveAndCollide } from '../physics/TileCollision';
import { ITEM_DEFS, ITEM_NO_GRAVITY_VIDS, ITEM_RECOVERABLE_IMPORTANT } from '../data/items';
import { coinIndexOf, ammoSlotAccepts, canFillEmptyAmmoSlot } from '../items/Inventory';
import type { Player } from './Player';
import { IGNORES_ENCUMBERING_STONE_VIDS } from './Player';
import { NEBULA_BOOSTER_VIDS, nebulaBoosterFamOf } from './NebulaBooster';   // ★BJ424 星云 booster 单源
import { WALL_ALLOWS_WIND } from './Mounts';   // ★BJ745 A41：TryFillBucket 墙白名单（WallID.cs:54 单源）
import { getDropScanCtx, grabRangeBonusFor } from './dropScanCtx';
import {
  canShimmerItem, coinLuckAmount, getTransformToItem,
  decraftOutcome, decraftRand3, isItemDecraftableAndUnlocked,
  internalIdOfVanilla,
  makeNpcOfItem, npcShimmerTransformTo,
} from '../stats/Shimmer';
import { VANILLA_ITEM_KEY_BY_ID } from '../data/items';
import { VANILLA_ITEM_COLOR, VANILLA_ITEM_ALPHA } from '../data/vanillaItemColor';
import { vanillaItemDimsOfVid } from '../data/vanillaItemDims';
import { canTakeToPersonalInventory, canMergeStack } from '../ui/SlotActions';   // ★BJ558 拉取满包门（ItemSpace 等价单源）
import { canVoidVaultAccept } from './Player';   // ★BJ558 cofveve 臂（CanVoidVaultAccept :39735-39747）

/** CantTakeLunchMoney（NPCID.cs:4468,39 型）——专家模式怪捡钱豁免表（R14-A3） */
const CANT_TAKE_LUNCH_MONEY = new Set([394, 393, 392, 690, 492, 491, 662, 384, 478, 535,
  658, 659, 660, 128, 131, 129, 130, 139, 267, 247, 248, 246, 249, 245, 409, 410,
  397, 396, 401, 400, 440, 68, 534, 316, 259, 260, 43, 175, 101]);
import { liquidCollision } from '../stats/TouchDamage';
import { wetCollision } from './npcLiquid';
import { dustWaterFor } from '../render/WeatherRenderer';   // Dust.dustWater()（Dust.cs:405-421,waterStyle 映射）
import itemRareJson from '../data/vanilla-itemrare.json';
import { spawnWOF } from './bossAI_wof';
import type { TownNPC } from './TownNPC';
import { isNpcValidForBestiaryKillCredit } from '../data/Bestiary';   // IIII232 图鉴杀数补账
import { BestiarySub } from '../net/syncModules';                     // const enum 编译期消除

/** Item.rare（tools 提取，缺省 0 = 白色——Item.cs 类默认）
 *  CheckLavaDeath else 分支的 (rare==0 || rare==-1) 烧毁门用（WorldItem.cs:803） */
const ITEM_RARE = itemRareJson as Record<string, number>;
/** ItemID.Sets.IsLavaImmuneRegardlessOfRarity（ItemID.cs:62）：黑曜石肤族/
 *  熔岩护身符族等 18 件——rare 高于 0 也照烧豁免名单外，此名单内恒免疫 */
const LAVA_IMMUNE_ITEMS = new Set([
  318, 312, 173, 174, 175, 4422, 2701, 205, 206, 207, 1128, 2340, 2739, 2492, 1127, 85, 581, 582,
]);

/** ★偏差1 阈值（2026-09-17 用户拍板明令分歧）：微光上浮顶板钉死超时 = 300t（5s）。
 *  原版无任何超时/绕行——钉死恢复面只有下潜拾取（Player.cs:35187 钉死态速度≈0.05
 *  可拾）或挖开顶板；本仓超时后置 tileCollide=false 穿块上浮（fixedUpdate shimmered
 *  段），脱离微光柱即恢复。 */
const SHIMMER_UNSTICK_T = 300;

export class ItemDrop extends Entity {
  /** 命中盒尺寸：★BJ326 件 2（2026-09-24）——12×12 统一简化退役,构造期按 vid 自
   *  vanilla-itemdims（Item.cs SetDefaults width/height 终值,99.6% 覆盖）注入；
   *  表外（SW 物品/流分析缺口）回落 12×12。消费面=物理/拾取/岩浆/微光探针（全吃
   *  this.w/h,原版本相=按 vid）;渲染 drawDrop 盒中心锚定 → 中心不变绘制不变 */
  w = 12; h = 12;
  itemId: number;
  stack: number;
  age = 0;
  bobPhase: number;
  /** 原版 Item.color（Item.cs SetDefaults 静态表——SW-BJ60 定谳:可见染=铁锭 22(:1640)/
   *  凝胶 23(:1658)/鲨鱼鳍 319(:5180),草本 313-318 无 item.color 原样;
   *  构造期按 vid 自 VANILLA_ITEM_COLOR 注入，Renderer.itemColorSprite 两遍着色消费） */
  color?: number[]; // [r, g, b, a]
  /** 原版 Item.alpha（Item.cs SetDefaults 静态表——SW-FX49 亲读提取）：GetAlpha
   *  默认支（Item.cs:49328-49347）pass1 底图维 f=(255−alpha)/255，掉落绘制
   *  （Main.cs:39284）经此变暗/半透明（凝胶 175≈31% 不透明度、星怒 100≈61%、
   *  幽灵翼 255=全透明）。构造期按 vid 自 VANILLA_ITEM_ALPHA 注入（>0 才存）；
   *  75 坠星/120 熔岩之弓被 GetAlpha 特例中和（:49191/:49197→不透明）不入表 */
  alpha?: number;
  /** 心(58)/星(184) 是 pickup 类物品（ItemID.Sets.IsAPickup, ItemID.cs:248）：
   *  碰触即回血 20 / 回蓝 100 并消失，永不进背包（Player.PickupItem :34610-34630） */
  /** 星云 booster（★BJ424：'nebula' = 3453-55 NebulaPickup 族——拾取 →
   *  NebulaLevelup（Player.PickupItem :35322-35332），fam 由 vid 反查：
   *  3453=伤/3454=命/3455=魔） */
  pickup?: 'heart' | 'star' | 'manastar' | 'nebula';
  /** 原版 grabDelayTime 同构位：玩家主动抛出的物品 =100t（Player.cs:5191
   *  DropSelectedItem → NewItemOwnership.GrabDelayForLocalPlayer/ForAllPlayers →
   *  WorldItem.cs:309-317 grabDelayTime=DefaultGrabDelay(100)），GrabItems
   *  （Player.cs:35183）按 grabDelayPlayer 挡抛出者拾回；普通战利品
   *  （ownership None→单人 ReserveForLocalPlayer,Item.cs:49737-49740）恒 0。
   *  ★BJ311（2026-09-23）：摘除全物品统一 25t 拾取延迟门（wiki-mechanics-audit
   *  -2026-08-13.md:912 挂账债）——原版 GrabItems 无任何年龄门，NPC 掉落 tick1
   *  即可拾取/拉取；用户实报「岩浆烫死旅商不掉商贩帽」根因：帽触浆首拍即烧
   *  （CheckLavaDeath 无计时）<26 拍门期 → 贴旁玩家救场窗被关死（原版拉取
   *  先于物品更新,且被抓取帧跳过岩浆检测=必救活） */
  noGrabDelay = 0;
  /** 实例级放置样式（旗 place_v_91:掉旗时注入 bannerId;拾取随实例流转——
   *  ItemDef.placeStyle 是类级,多 style 单物品需实例位,2026-08-13） */
  placeStyle?: number;
  prefix?: number;   // 词缀（Item.prefix,随实例流转）
  // ---- 微光（WorldItem.cs:25-27/434/486-558/806-840/1781-1931）----
  /** 浸在微光中（Collision.shimmer 盒命中，:434/:944） */
  shimmerWet = false;
  /** 已被微光转化（上浮漂浮、暂不可拾取，:34466 速度 <0.2 才可拾） */
  shimmered = false;
  /** 微光浸入进度 0-1（:27/:806-840 +0.01/t，>0.9 触发 GetShimmered；离池衰减） */
  shimmerTime = 0;
  /** 本端私有实例（原版 Item.instanced，MessageBuffer.cs:1468 case 90 落位）：
   *  per-client 掉落（Boss 袋族）各端经 module14 各得一份——不上报 msg21
   *  （netDropSweep/SimHost.dropSweep 跳过），仅本端玩家可见可拾（原版
   *  playerIndexTheItemIsReservedFor=Main.myPlayer 语义——各端只持有自己的副本,
   *  天然互不可见）。拾取后入包照常（转为随身物品,跨端同步走 msg5） */
  netLocalOnly = false;
  /** 被玩家拉取/抓取中（原版 beingGrabbed——星白天消失的豁免位,拉取路径置位） */
  grabbed = false;
  // ---- 出入液溅花粘滞镜像（WorldItem.cs:884-1051；语义同 Player.wetSticky 族,
  //      2026-09-17 微光发声面普查接线——溅花支此前整缺）----
  /** 原版 wet 粘滞位（WetCollision 任意液体;:901 置真/:981 支首置假） */
  wetSticky = false;
  /** 原版 wetCount（:907/:997 置 20;:1049-1051 逐帧 --）——出入水去抖 */
  wetCount = 0;
  /** 原版 lavaWet（:884-887 本拍 LavaCollision 置;:1045 !wet 清） */
  splashLavaWet = false;
  /** 原版 honeyWet（:946-948 WetCollision 首中旗置;:1045-1047 !wet 清） */
  splashHoneyWet = false;
  /** 原版 shimmerWet 溅花镜像（:949-951 WetCollision 首中旗置;:1045-1049 !wet 清）
   *  ——与状态域 this.shimmerWet（整盒微光探针,转化判定定谳口径）分离：混合液池
   *  （水垫微光）首中水格时原版 Collision.shimmer 不置 → 溅花支走水档 */
  splashShimmerWet = false;
  /** ★偏差1 穿块开关（Body.tileCollide 镜像,TileCollision.ts moveAndCollide :1077
   *  false=位移直写通道）：缺省 undefined = 照常碰撞（原版同相）；上浮钉死
   *  ≥SHIMMER_UNSTICK_T 拍置 false 穿顶板上浮，脱离微光柱（③支悬停）或被拉动
   *  摘旗（shimmered=false）后恢复 undefined */
  tileCollide?: boolean | undefined;
  /** ★BJ206 2026-09-20：hoik 单向墙承载（Body.hoik 注，TileCollision.ts:98-111）
   *  ——原版落地物走 WorldItem.MoveInWorld 的 Collision.TileCollision（:1059 湿支/
   *  :1072 干支，均不传第 10 参吃形参缺省【true】=Collision.cs:2299）⇒ 掉落物
   *  原版本体可穿 Hoik 单向墙（水平坡邻配对支）。本仓 moveAndCollide 承载
   *  （fixedUpdate :430）Body.hoik 缺省 falsy=整缺 → 补 true。 */
  hoik = true;
  /** ★偏差1 钉死计数：连续「上浮中顶头碰撞」拍数（moveAxis 上顶支置 hitHead,
   *  TileCollision.ts:465-466；受阻链任一拍断开即归零） */
  shimmerStuckT = 0;

  constructor(x: number, y: number, itemId: number, stack = 1, vx = 0, vy = -2) {
    super();
    this.x = x; this.y = y;
    this.itemId = itemId;
    this.stack = stack;
    this.vx = vx;
    this.vy = vy;
    this.bobPhase = Math.random() * Math.PI * 2;
    // 原版 Item.color 静态表（Item.cs SetDefaults，凝胶 23 染蓝等）——SetDefaults
    // 语义随实例走：掉落物一落地就带着色，渲染端 tintedSprite 消费（此前无人赋值
    // = 死代码，凝胶掉地上也是灰的）。存档/重建走构造自愈，无需序列化。
    const vid = (ITEM_DEFS[itemId]?.vid ?? -1);
    // ★BJ326 件 2：命中盒按 vid（原版 Item.NewItem 收【中心】→ worldItem.Center,
    // Item.cs:49739——盒尺寸取 Item.width/height;spawnDrop 中心锚由此承担半盒偏移）
    const dims = vanillaItemDimsOfVid(vid);
    if (dims) { this.w = dims[0]; this.h = dims[1]; }
    const ic = vid > 0 ? VANILLA_ITEM_COLOR[vid] : undefined;
    if (ic && ic[3] > 0) this.color = [...ic];
    // ★SW-FX49 Item.alpha 静态表注入（GetAlpha 默认支 pass1 维,与 color 域无
    // 耦合——星怒 65 color A=0 但 alpha=100 照样半透明;幽灵翼 823 全透明）
    const al = vid > 0 ? VANILLA_ITEM_ALPHA[vid] : undefined;
    if (al && al > 0) this.alpha = al;
  }

  /** ★BJ343 件 1（2026-09-25）：变型点按 vid 重刷命中盒——原版三处变型全走 Item.
   *  SetDefaults 语义（重置 width/height）：①WorldItem.cs:1752 微光转化
   *  `inner.SetDefaults(transformToItem)` ②EmergencyStacking.cs:447 钱币升面
   *  （71/72/73/74 盒互异 [10,10]/[10,12]/[10,14]/[12,14],Item.cs:2219-2282）
   *  ③NetMessage msg21 槽位全态覆写换 type（WriteItem 全写,重 assert 重建同语义）。
   *  此前变型只改 itemId 不刷 w/h → 命中盒沿用旧 vid 尺寸（物理/拾取/岩浆烧毁/
   *  微光探针全消费）。表外 vid 回落 12×12 统一盒（构造同款缺省语义） */
  refreshDimsFromVid(): void {
    const vid = (ITEM_DEFS[this.itemId]?.vid ?? -1);
    const dims = vanillaItemDimsOfVid(vid);
    if (dims) { this.w = dims[0]; this.h = dims[1]; }
    else { this.w = 12; this.h = 12; }
  }

  fixedUpdate(dt: number, game: GameHooks) {
    this.age++;
    this.grabbed = false;   // beingGrabbed 每 tick 复位（WorldItem.cs:437,拉取路径再置位）
    const vid = (ITEM_DEFS[this.itemId]?.vid ?? -1);   // 全函数消费（岩浆/微光/吸附等段）

    // R14-A3：专家模式怪捡钱币（WorldItem.GetPickedUpByMonsters_Money :1127-1219,
    // Update 入口 :412-416 `if (Main.expertMode && IsACoin)`）——命中合格怪吸收
    // 50-75%（铜 +0-50%、银 +0-25%,钳 1）入 enemy.extraValue,死亡并入钱币掉落
    // （NPC.cs:80497 num += extraValue）;CantTakeLunchMoney 39 型豁免(NPCID.cs:4468)。
    // 此前整链缺失=专家"怪偷钱→杀怪夺回"经济循环缺位
    if ((this.age & 3) === 0) {
      const mVid = (ITEM_DEFS[this.itemId]?.vid ?? -1);
      if (mVid >= 71 && mVid <= 74) {
        const w = game.world as unknown as { isExpert?: boolean; flags?: Record<string, boolean> };
        if (w?.isExpert) {
          for (const n of game.enemies()) {
            const e = n as unknown as {
              dead?: boolean; vanillaId?: number; x: number; y: number; w: number; h: number;
              lifeMax?: number; friendly?: boolean; spawnedFromStatue?: boolean; extraValue?: number;
              immortal?: boolean; dontTakeDamage?: boolean;
            };
            if (e.dead || e.vanillaId == null) continue;
            if ((e.lifeMax ?? 0) <= 5 || e.friendly || e.immortal || e.dontTakeDamage
              || e.spawnedFromStatue) continue;
            if (CANT_TAKE_LUNCH_MONEY.has(e.vanillaId)) continue;
            if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
            // 吸收比（:1178-1190）：Next(50,76)×0.01 基础；铜 71 再 +Next(51)×0.01、
            // 银 72 再 +Next(26)×0.01；钳 1；吸收量 = stack×ratio（不足 1 不吸收）
            let ratio = (50 + Math.floor(Math.random() * 26)) * 0.01;
            if (mVid === 71) ratio += Math.floor(Math.random() * 51) * 0.01;
            if (mVid === 72) ratio += Math.floor(Math.random() * 26) * 0.01;
            if (ratio > 1) ratio = 1;
            const take = Math.floor(this.stack * ratio);
            if (take < 1) break;
            e.extraValue = (e.extraValue ?? 0) + take * (mVid === 74 ? 1000000 : mVid === 73 ? 10000 : mVid === 72 ? 100 : 1);
            this.stack -= take;
            if (this.stack <= 0) { this.stack = 0; this.dead = true; }
            game.spawnParticles?.(e.x + e.w / 2, e.y + e.h / 2, '#FFD966', 6, 1.2, { life: 18 });   // moneyPing 尘近似
            break;
          }
        }
      }
    }

    // 铜物品落在可转化史莱姆上（WorldItem.GetPickedUpByMonsters_Special :1160-1191）：
    // 铜盔 89 / 铜短剑 3507 且未解锁 → 命中 {1 蓝史莱姆, 302 蒙面, 333-336 缎带} →
    // TransformCopperSlime（侍从史莱姆 684 + unlockedSlimeCopperSpawn，NPC.cs:19099-19121）
    // 并消耗 1 个（:1186-1190）
    if ((this.age & 3) === 0) {
      const cVid = (ITEM_DEFS[this.itemId]?.vid ?? -1);
      if ((cVid === 89 || cVid === 3507)) {
        const flags = (game.world as unknown as { flags: Record<string, boolean> }).flags ?? {};
        if (!flags['unlockedSlimeCopperSpawn']) {
          for (const n of game.enemies()) {
            const e = n as { dead?: boolean; vanillaId?: number; x: number; y: number; w: number; h: number };
            if (e.dead || e.vanillaId == null) continue;
            const id = e.vanillaId;
            if (id !== 1 && id !== 302 && (id < 333 || id > 336)) continue;
            if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
            flags['unlockedSlimeCopperSpawn'] = true;
            e.dead = true;   // Transform 原位换体
            game.spawnParticles?.(e.x + e.w / 2, e.y + e.h / 2, '#E8A060', 10, 1.5, { life: 24 });
            game.spawnNpcByVanilla?.(684, e.x, e.y);
            this.stack--;
            if (this.stack <= 0) { this.stack = 0; this.dead = true; }
            break;
          }
        }
      }
    }

    const player = (game as unknown as { player: Player }).player;
    let beingGrabbed = false;
    // ★BJ311（2026-09-23）：摘全局 25t 门（见 noGrabDelay 块注）——仅保留
    // noGrabDelay（≙原版 grabDelayTime,只挡玩家自抛件）；GrabItems
    // （Player.cs:35181-35203）对普通战利品零延迟,本门曾连带拉取一起挡 26 拍
    if (player && !player.dead && this.age > this.noGrabDelay) {
      // 顶部速度门（GrabItems Player.cs:34466）：shimmered 且速度 ≥0.2 → **拾取与
      // 拉取整体跳过**（此前只拦拾取不拦拉动 → 拉动加速反而把物品锁死在 ≥0.2 永不可拾）
      const grabbable = !(this.shimmered && Math.hypot(this.vx, this.vy) >= 0.2);
      if (grabbable) {
      // 原版 GrabItems(Player.cs:34461-34524):hitbox 相交=直接拾取;
      // 否则玩家盒 ±42px(defaultItemGrabRange :2406)扩展盒相交=拉取；
      // 拉取半径加成段 = Player.GetItemGrabRange 全表（终零波 GRAB_RANGE 一行改造：
      // 帧扫描路径经 grabRangeBonusFor(ctx,vid) 逐 vid 展开——金戒指币族+350/
      // 星族/心族/4143/3822/NebulaPickup 六项全部按原版 vid 门生效；
      // 旧 grabRangeBonus(-1)+pickup 分类拼装 retired）
      // ★帧扫描快照（dropScanCtx.ts 头注；trace 实测 equip 热点 54.4% 主线程自耗
      //   时——grabRangeBonus/canAccept 曾每帧每物触发 equipStats 内容键全量重建）。
      //   四旗输入与 preventAll 在一帧内恒定（拾取写面不触及任何输入域），同值严格
      //   等价；快照缺席（单测/探针直调本 fixedUpdate 不经 Entities.update）回退
      //   player.getItemGrabRangeBonus(vid) 直读。
      const scan = getDropScanCtx(player);
      const vidThis = (ITEM_DEFS[this.itemId]?.vid ?? -1);
      let GRAB_RANGE: number;
      let canAccept: boolean;
      if (scan) {
        GRAB_RANGE = 42 + grabRangeBonusFor(scan, vidThis);
        canAccept = !scan.preventAll || IGNORES_ENCUMBERING_STONE_VIDS.has(vidThis);
      } else {
        const gb = (player as unknown as { getItemGrabRangeBonus?: (v: number) => number })
          .getItemGrabRangeBonus;
        GRAB_RANGE = 42
          + (gb ? gb.call(player, vidThis)
            : grabRangeBonusFor({   // 裸 stub 宿主回退：只有 grab 遗留值可用
                treasureMagnet: false, goldRing: false, manaMagnetEquip: false,
                heartreachBuff: false, grab: (player as { grabRangeBonus?: number }).grabRangeBonus ?? 0,
                heart: 0, star: 0, preventAll: false,
              }, vidThis));
        canAccept = (player as unknown as {
          canAcceptItemIntoInventory?: (vid: number) => boolean;
        }).canAcceptItemIntoInventory?.(vidThis) ?? true;
      }
      const touching =
        this.x < player.x + player.w && this.x + this.w > player.x &&
        this.y < player.y + player.h && this.y + this.h > player.y;
      const inGrabRange =
        this.x < player.x + player.w + GRAB_RANGE && this.x + this.w > player.x - GRAB_RANGE &&
        this.y < player.y + player.h + GRAB_RANGE && this.y + this.h > player.y - GRAB_RANGE;
      // ★F5① preventAllItemPickups 消费端（CanAcceptItemIntoInventory Player.cs
      //  :35172-35179）：4346 拖累石在场（机械族三路聚合 → equipStats 位）时,世界
      //  物品的【拾取与拉取】两通道只放行 IgnoresEncumberingStone 白名单成员
      //  （心/星族,ItemID.cs:250）——vanilla GrabItems :35187 把该门挂在循环 continue
      //  上（两通道一并跳过）、CanPullItem :39453 复判同一门。心/星吸附本就属白名单,
      //  阻挡面=其余一切物品。MP 候补：packet 自报 take 只在本地拾取成立后发生,
      //  无独立 intake 位可漏。
      if (touching && canAccept) {
        if (this.pickup) {
          if (this.pickup === 'nebula') {
            // 星云 booster 拾取（Player.PickupItem :35322-35332）：音 7 +
            // NebulaLevelup（buffType=Item 3453→179伤/3454→173命/3455→176魔,
            // Item.cs:31008-31017）+ TurnToAir。原版无飘字/粒子（区别于心/星的
            // HealEffect/ManaEffect 面板文字）——可见反馈 = buff 栏三色档位图标
            // （Player.nebulaBuffIcons UI 补 C 批已挂 Buff_173-181.png）
            player.nebulaLevelup(nebulaBoosterFamOf(ITEM_DEFS[this.itemId]?.vid ?? -1));
          } else if (this.pickup === 'heart') {
            player.hp = Math.min(player.maxHp, player.hp + 20);
            game.addDamageNumber(player.cx, player.y, 20, false, '#40E080');
          } else if (this.pickup === 'manastar') {
            // 法力斗篷之星 4143(Player.cs:35357-35371):音 7 + 魔力 +50 + ManaHeat(0.2,2s)
            player.mana = Math.min(player.maxMana, player.mana + 50);
            player.tryApplyManaHeat(0.2, 2);
            game.addDamageNumber(player.cx, player.y, 50, false, '#4080FF');
          } else {
            player.mana = Math.min(player.maxMana, player.mana + 100);
            // 1457: 拾取魔力星附加 ManaHeat(0.2, 2s)（PickupItem :35346-35351——
            //   184/1735/1868 星族分支内 myPlayer 门下 TryApplyManaHeat）
            player.tryApplyManaHeat(0.2, 2);
            game.addDamageNumber(player.cx, player.y, 100, false, '#4080FF');
          }
          this.dead = true;
          game.recLog?.('pickup', { key: this.pickup, n: 1 });   // 行为录制：心/星碰触即取
          game.playSfx('pickup', 1); // 原版 SoundID 7 Grab
          return;
        }
        const before = this.stack;
        let left = player.inv.add(this.itemId, this.stack, this.prefix, this.placeStyle);
        // 成就：拾取通知（AchievementsHelper.NotifyItemPickup——仅入包部分；
        //  WorldItem 拾取路径，合成/初始装备不经此）
        if (left < before) {
          const vid = (ITEM_DEFS[this.itemId]?.vid ?? -1);
          if (vid > 0) game.achievements?.notifyItemPickup(vid);
        }
        // ---- 虚空袋溢流兜底（孤儿武器 B3 波 工单1；Player.GetItem_VoidVault
        //  :39703-39760：PickupItemFromWorld.CanGoIntoVoidVault=true 门下,背包
        //  接不住的余量灌 bank4=banks[3]。原版 vaul【不】持续吸物——本支只在
        //  left>0（有装不下的余量）时触达，即满背包装不下的溢流语义）----
        if (left > 0 && player.useVoidBag()) {
          const preVoid = left;
          // ★F2 手头件词缀随行（Player.cs:39845 inv[i]=returnItem 含 prefix / :39749 同词缀合并门）
          const dep = player.depositIntoVoidVault(this.itemId, left, this.prefix);
          if (dep < preVoid) {
            const vidV = (ITEM_DEFS[this.itemId]?.vid ?? -1);
            if (vidV > 0) game.achievements?.notifyItemPickup(vidV);   // :39768 NotifyItemPickup
            game.notifyInventoryChanged();
            game.recLog?.('pickup', { key: ITEM_DEFS[this.itemId]?.key ?? this.itemId, vid: vidV, n: preVoid - dep, void: true });
            game.playSfx(coinIndexOf(this.itemId) >= 0 ? 'coin' : 'pickup', 0.75);  // SoundID 7/38(:39753)
            const defV = ITEM_DEFS[this.itemId];
            if (defV) game.showPickupLabel(defV.key, preVoid - dep, this.prefix);   // PopupText ItemPickupToVoidContainer(:39760)
            left = dep;
          }
        }
        if (left === 0) {
          // MP：整堆拾取即时自报 take（op1）——替代傀儡清扫的对死推断
          // （清扫无法区分"被拾取"与"TTL 超时"，曾把超时误报成拾取反杀真身）
          if (this.netPuppet && this.netId) game.puppetDropTaken?.(this);
          this.dead = true;
          game.recLog?.('pickup', { key: ITEM_DEFS[this.itemId]?.key ?? this.itemId, n: before, vid: (ITEM_DEFS[this.itemId]?.vid ?? -1) });   // 行为录制：整堆拾取
          game.notifyInventoryChanged();
          // 钱币拾取用专属音效，其余走通用拾取（vi_71-74 单轨）
          // 音量略低（0.75）：拾取与挖掘声同时触发时两者都可闻，不被 Grab 盖住
          game.playSfx(coinIndexOf(this.itemId) >= 0 ? 'coin' : 'pickup', 0.75);
          const def = ITEM_DEFS[this.itemId];
          // 飘字计数（PopupText.NewText :38609）：picked = 实际入包数
          if (def) game.showPickupLabel(def.key, before, this.prefix);
          return;
        }
        if (left !== before) {
          game.notifyInventoryChanged();
          // 部分拾取（背包该堆被填满）同样飘字（:38623——picked = 填入的差额）
          const def = ITEM_DEFS[this.itemId];
          if (def) game.showPickupLabel(def.key, before - left, this.prefix);
        }
        this.stack = left;
        // MP：他人掉落的残余上报（msg21 op3 携余量全态，形状与 spawn 同）——原版
        // msg21 为服务器权威单向广播，本仓所有权分散在生成端，拾取端必须把
        // "还剩多少"报回去，否则拥有者 60t 重 assert 会用陈旧全量把残余刷回去
        // （人人可再捡 = 物品复制）。★仅在本次拾取真实改变余量时发（背包已满
        // 的持续重叠不得每拍一帧刷屏——2026-08-28 全面 review 收口） */
        if (left > 0 && left !== before && this.netPuppet && this.netId) game.puppetDropResidue?.(this);
      } else if (inGrabRange && canAccept
        && this.itemSpaceCanPull(player, vidThis)) {   // ★F5① 拉取面同门（CanPullItem :39453）+★BJ558 ItemSpace 满包门（:35220-35224）
        this.shimmered = false;
        beingGrabbed = true;
        this.grabbed = true;
        // ★BJ424：NebulaPickup 恒走 PullItem_Pickup 档（GrabItems :35229-35230,
        // speed 12/acc 5——归一方向×speed 与现速按 (acc−1):1 混合,Player.cs
        // :34527-34541）。心/星/币的 Pickup 档各有自身条件门（lifeMagnet/manaMagnet/
        // goldRing）,缺省 Common 与本仓既有面同相——本刀只接 nebula 恒达档。
        if (NEBULA_BOOSTER_VIDS.has(vidThis)) {
          const dxN = player.cx - this.cx, dyN = player.cy - this.cy;
          const dN = Math.sqrt(dxN * dxN + dyN * dyN) || 1;
          this.vx = (this.vx * 4 + (dxN / dN) * 12) / 5;
          this.vy = (this.vy * 4 + (dyN / dN) * 12) / 5;
        } else {
        // PullItem_Common(:34533-34584):每轴 0.45 步进、钳 4(水平含 player.vx),
        // 速度反向时附加 ×0.75 反拉——被拉取帧跳过瓦片碰撞(WorldItem.cs:587-597
        // else 分支仅 position+=velocity),物品穿墙飞向玩家。
        // ★CanPullItem 分支先清 shimmered（Player.cs:34498）——拉动一旦开始,
        // 微光速度门解除,后续按普通物品吸走拾取（此前不清 → 拉动中恒 ≥0.2 死锁）
        const SPEED = 0.45, MAXV = 4, BACK = 0.75;
        if (player.cx > this.cx) {
          if (this.vx < MAXV + player.vx) this.vx += SPEED;
          if (this.vx < 0) this.vx += SPEED * BACK;
        } else {
          if (this.vx > -MAXV + player.vx) this.vx -= SPEED;
          if (this.vx > 0) this.vx -= SPEED * BACK;
        }
        if (player.cy > this.cy) {
          if (this.vy < MAXV) this.vy += SPEED;
          if (this.vy < 0) this.vy += SPEED * BACK;
        } else {
          if (this.vy > -MAXV) this.vy -= SPEED;
          if (this.vy > 0) this.vy -= SPEED * BACK;
        }
        }
      }
      }   // /if (grabbable) —— 顶部速度门（Player.cs:34466）
    }

    if (beingGrabbed) {
      // 原版被抓取帧:无重力无碰撞,直接位移(WorldItem.cs:596 ApplyMovement)
      this.x += this.vx;
      this.y += this.vy;
    } else {
      // ★BJ745 A41（issue#35,2026-11-01）：空桶收雨（WorldItem.cs:404-406 →
      //   TryFillBucket :553-576）——位置=非抓取帧物理段头（UpdateShimmer/MoveInWorld
      //   之前）。门链与掷式逐行：保留 myPlayer（SP 恒真;MP 远端掉落保留位未建模,
      //   登记台账）→ raining → isThereAWorldSurface（本仓生成世界恒有地表,不建模）
      //   → IsSurfaceForAtmospherics（WorldGen.cs:11003-11016：常规 y≤worldSurface;
      //   remix y>rockLayer 且 y<maxTilesY−350）→ 盒心格 InWorld ∧
      //   WallID.Sets.AllowsWind[wall]（含 wall 0=无墙）→ num3=600/dayRate（仅
      //   dayRate∈(0,600) 才除——快进提频;冻结 dayRate=0 与缺省 1 同为 1/600 档）
      //   → Next(num3)==0 ∧ NextFloat()<maxRaining → 整堆 205→206（SetDefaults 保
      //   stack,SyncItem=MP 60t 断言全态覆写自然携带）。
      if (vid === 205) this.tryFillBucket(game);
      // 液体采样（身体中心格；本仓液体编码 1水 2岩浆 3蜂蜜 4微光）——仅作重力档选择
      const st0 = game.world.store;
      const ci = st0.idx(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
      const wetType = st0.liquid[ci] > 30 ? st0.liquidType[ci] : 0;
      // shimmerWet = Collision.shimmer（WorldItem :949-951 ← LiquidCollision :1600-1655）：
      // 整盒擦到任一 liquid>0 微光格即 true（坡面格另判上格液体）。★旧实现中心单格
      // >30——浅液面/盒缘擦液时 Shimmering 不跑 → 同一物品"有时能分解有时不能"根因
      this.shimmerWet = liquidCollision(st0, this.x, this.y, this.w, this.h, 4);
      // 上浮意图（★偏差1 钉死检测消费位：moveAndCollide 后按 rising∧hitHead 连锁计数）
      let rising = false;
      if (this.shimmered) {
        // 已微光化：无重力（:487 gravity=0）。上浮/悬停三分支（:515-536）：
        //  ① shimmerWet（身在微光中）→ vy-0.05/t 钳 -4 继续上浮；
        //  ② 干态但**下方 2 格内仍有微光**（还悬在微光柱上方）→ 同①继续上浮；
        //  ③ 干态且下方无微光 → vy×0.9 衰减悬停——速度降到 <0.2 才可被拾取
        //    （此前漏了②③：恒加速上浮 → 撞顶也不减速 → 永远 ≥0.2 永不可拾）
        if (this.shimmerWet) {
          rising = true;
        } else {
          const bx = Math.floor(this.cx / TILE), by = Math.floor(this.cy / TILE);
          for (let j = by; j < by + 2; j++) {
            if (st0.inBounds(bx, j)) {
              const bi = st0.idx(bx, j);
              if (st0.liquid[bi] > 0 && st0.liquidType[bi] === 4) { rising = true; break; }
            }
          }
        }
        if (rising) { if (this.vy > -4) this.vy -= 0.05; }
        else this.vy *= 0.9;
        // 上浮白光尘（WorldItem.cs:488-497）：1/30t 一枚 dust 309，盒内随机点 +
        // 抖动 X∈[-8,5) Y∈[-8,5)，四色表 1/1/1/3 权重（255,255,210 / 190,245,255 /
        // 255,150,255 / 190,175,255），scale×1.1、velocity×0.3 近似静态
        if (Math.random() < 1 / 30) {
          const c = Math.floor(Math.random() * 6);
          const color = c === 0 ? '#FFFFD2' : c === 1 ? '#BEF5FF' : c === 2 ? '#FF96FF' : '#BEAFFF';
          game.spawnParticles(
            this.x + Math.random() * this.w + (Math.random() * 13 - 8),
            this.y + Math.random() * this.h + (Math.random() * 13 - 8),
            color, 1, 0.3, { life: 40 + Math.random() * 12, grav: -0.01, size: 1.1 });
        }
      } else {
        // 掉落物液体物理（WorldItem.cs:418-450：空气 0.1/7、水 0.08/5、蜂蜜 0.05/3、
        // 微光 0.065/4；浸液加 wetVelocity 阻尼）——独立于玩家 GRAVITY
        // ★FX44（2026-09-15）：ItemID.Sets.ItemNoGravity 族先于重力分流——原版
        // MoveInWorld（WorldItem.cs:779-794）`if (!shimmered && ItemNoGravity[type])`
        // 分支【不加 g】，速度双向 ×0.95 阻尼（<0.1 归零）后照常 TileCollision/
        // SlopeCollision → 魂六件/四塔碎片/星云拾取/4143 等掉落即停在死亡点悬停
        // 不落地（微光化物品除外——shimmered 走 else 支原版同款,上方 if 已先行）。
        // 曾整缺该分流 = 魂按常规掉落坠地：飞龙高空杀魂直坠地底/视野外（用户实报
        // 「不掉飞翔之魂」体验根因）+ 地面怪魂落地不悬停（双向偏差同根）。
        if (ITEM_NO_GRAVITY_VIDS.has(vid)) {
          this.vy *= 0.95;
          if (Math.abs(this.vy) < 0.1) this.vy = 0;
        } else {
          const g = wetType === 1 ? 0.08 : wetType === 3 ? 0.05 : wetType === 4 ? 0.065 : ITEM_GRAVITY;
          const mf = wetType === 1 ? 5 : wetType === 3 ? 3 : wetType === 4 ? 4 : ITEM_MAX_FALL;
          this.vy = Math.min(this.vy + g, mf);
          if (wetType === 1 || wetType === 3) { this.vx *= 0.95; } // 浸液额外阻尼（:440 wetVelocity 近似）
        }
      }
      // 水平摩擦（:927-932 通用段：vx*=0.95，|vx|<0.1 归零）——★shimmered 物品
      // 同样执行。曾误放非 shimmered 分支内：decraft 散射初速永不衰减 → 产物无限
      // 横漂 + 速度恒 >0.2 永不可拾取
      this.vx *= 0.95;
      if (Math.abs(this.vx) < 0.1) this.vx = 0;
      moveAndCollide(this, game.world, this.vx, this.vy);
      // ★偏差1（2026-09-17 用户拍板明令分歧）：上浮顶板钉死超时穿块兜底。
      //  原版：上浮走正常 TileCollision（WorldItem.cs:1059/:1072 ← Collision.cs:2446
      //  上行钳制 velocity.Y=0），头顶实心顶板 = 垂直钉死在接触点下——无超时/无绕行/
      //  无按龄消失（1.4.4+），恢复面只有下潜拾取（钉死态速度≈0.05<0.2 可拾,
      //  Player.cs:35187）或挖开顶板。本仓：连续 ≥SHIMMER_UNSTICK_T 拍「上浮中顶头
      //  碰撞」（moveAxis 上顶支置 hitHead,TileCollision.ts:465-466;受阻链任一拍
      //  断开即归零）→ tileCollide=false 直写位移穿块上浮，直至 ③支悬停（脱离微光柱）
      //  或被拉动摘旗（shimmered=false）恢复碰撞。通畅柱上浮/液面悬停正常路径
      //  hitHead 恒假，逐位保持原版；穿块窗口内被拾取即随拾取销毁，无状态泄漏面。
      if (this.shimmered && rising && this.hitHead) {
        this.shimmerStuckT++;
      } else {
        this.shimmerStuckT = 0;
      }
      if (this.shimmerStuckT >= SHIMMER_UNSTICK_T) this.tileCollide = false;
      if (this.tileCollide === false && (!this.shimmered || !rising)) {
        this.tileCollide = undefined;   // 脱离微光柱/摘旗 → 恢复原版碰撞
        this.shimmerStuckT = 0;
      }
      // 岩浆死亡（WorldItem.Update :576-580：MoveInWorld 后 lavaWet → CheckLavaDeath）。
      // 仅非抓取帧（else 分支）——被抓取帧走 ApplyMovement 不检岩浆
      const lavaNow = liquidCollision(game.world.store, this.x, this.y, this.w, this.h, 2);
      if (lavaNow) {
        this.checkLavaDeath(game);
        if (this.dead) return;
      }
      // 出入液溅花 1:1（WorldItem.cs MoveInWorld :884-1050——原版位次即非抓取帧
      // 物理段内,被抓取帧整段跳过）——见 itemSplashFace
      this.itemSplashFace(game, lavaNow);
    }
    // （出入液溅花已 1:1 移入非抓取帧物理段尾 itemSplashFace——WorldItem.cs:884-1050
    //   位次；旧实现"中心格>80 水/蜜 ∧ vy>1.2 + playSfx 六变体乱掷"退役,转化共尾
    //   伴发的 shimmerSplash 名路由亦退役——见 tryDecraft 尾注。旧注"WetCollision
    //   只认 !lava && !shimmer"系把 DrownCollision 当 WetCollision 的误读——
    //   WetCollision 对任意液体为真）
    if (this.shimmerWet && !this.shimmered) {
      this.updateShimmer(game);
    } else if (this.shimmerTime > 0) {
      // WorldItem.cs:552-558（shimmered 也走）：转化后 shimmerTime 自 1 衰减 -0.01/t
      // ——驱动上浮白光渐亮（lightRGB 读 (1-shimmerTime)*0.8，:511）
      this.shimmerTime = Math.max(0, this.shimmerTime - 0.01);
    }
    void ITEM_DEFS;
    // ---- 消失条件 = 原版 DespawnIfMeetingConditions（WorldItem.cs:652-690）----
    // 时序 = Update 尾部（抓取置位后判定,与原版同拍）。★1.4 已移除通用 5 分钟
    // 消失——仅四类特例+出界+堆叠归零,无 age 上限;曾自创 600s 全体消失=掉落配额
    // （Item.MechSpawn）饱和后的自愈节奏与原版不符（2026-08-27 用户定案完全对齐）。
    {
      const dvid = (ITEM_DEFS[this.itemId]?.vid ?? -1);
      const wd = (game.world ?? {}) as unknown as {
        w?: number; h?: number; spawnX?: number; spawnY?: number;
        clock?: { isDay?: boolean }; seedFlags?: { remix?: boolean };
        oldOnesArmy?: { ongoing?: boolean };
      };
      // ① 陨星 75：白天（非 remix/未微光）→ 星尘 15×10 + 星星碎砾 16-18×3。
      //   ★原版 !beingGrabbed 条件为死逻辑：beingGrabbed 在物品自身 Update 头被
      //   无条件复位（WorldItem.cs:437），Player 侧置位先于复位被抹（单人恒 false）——
      //   本仓 grabbed 置位发生在同方法内（复位之后），判读会泄漏 → 不进判定
      if (dvid === 75 && wd.clock?.isDay && !wd.seedFlags?.remix && !this.shimmered) {
        game.spawnParticles?.(this.x + 11, this.y + 11, '#FFECB3', 10, 1.2, { life: 20 });
        this.dead = true; return;
      }
      // ② 4143：生成超 300t → 靛蓝尘×20（:664）
      if (dvid === 4143 && this.age > 300) {
        game.spawnParticles?.(this.x + 11, this.y + 11, '#4169E1', 20, 1.0, { life: 20 });
        this.dead = true; return;
      }
      // ③ 3822：非 DD2 进行中 → 金尘×(18-24)（:672）
      if (dvid === 3822 && !wd.oldOnesArmy?.ongoing) {
        game.spawnParticles?.(this.x + 11, this.y + 11, '#FFD966', 18 + Math.floor(Math.random() * 7), 1.5, { life: 24 });
        this.dead = true; return;
      }
      // ④ 出界（InWorld 20 格余量外,:580-612）：
      //    RecoverableImportantItem → Center=出生点坐标(回出生点,velocity 清零)
      //    其余 → 消失
      if (typeof wd.w === 'number' && typeof wd.h === 'number') {
        const tx2 = Math.floor(this.x / 16), ty2 = Math.floor(this.y / 16);
        if (tx2 < 20 || ty2 < 20 || tx2 >= wd.w - 20 || ty2 >= wd.h - 20) {
          if (ITEM_RECOVERABLE_IMPORTANT.has(dvid) && typeof wd.spawnX === 'number' && typeof wd.spawnY === 'number') {
            this.x = wd.spawnX * 16 + 8 - this.w / 2;
            this.y = wd.spawnY * 16 + 8 - this.h / 2;   // Center = 出生点格中心
            this.vx = 0; this.vy = 0;
          } else {
            this.dead = true;
          }
          return;
        }
      }
    }
  }

  /** 上浮白光（WorldItem.cs:511 AddLight(Center,(1-shimmerTime)*0.8 ×3)）：
   *  转化瞬间 shimmerTime=1 不发光，漂浮 100t 内渐亮至 0.8——Game 点光扫描
   *  drops 桶消费本 getter */
  get lightRGB(): [number, number, number] | null {
    if (!this.shimmered) return null;
    const k = (1 - this.shimmerTime) * 0.8;
    return [k, k, k];
  }
  /** 光源锚点缺省（实体中心，Game 扫描回退语义） */
  lightRGBAt: { x: number; y: number } | null = null;


  /** WorldItem.Shimmering（:806-840）：脚上方格是微光且可转化 → 进度 +0.01/t，
   *  >0.9 触发 GetShimmered；不在微光中则进度衰减。转化触发在本地玩家侧语义
   *  （netMode!=1 门对单人恒真） */
  private updateShimmer(game: GameHooks): void {
    const st = game.world.store;
    const tx = Math.floor(this.cx / TILE);
    // :810-812 采样 (Center.X/16, position.Y/16 - 1)——物品顶上一格
    const ty = Math.floor(this.y / TILE) - 1;
    const vid = (ITEM_DEFS[this.itemId]?.vid ?? -1);
    const inShimmer = st.inBounds(tx, ty)
      && st.liquid[st.idx(tx, ty)] > 0 && st.liquidType[st.idx(tx, ty)] === 4;
    const flags = (game.world as unknown as { flags: Record<string, boolean> }).flags ?? {};
    // :49056 decraft 位:有配方可分解的物品也进入微光(原先只有转化目标才进)
    const decraftCtx = {
      stack: this.stack,
      crimsonWorld: !!game.world.crimson,
      downedBoss3: !!(flags['downed_35'] || flags.downedSkeletron),
      downedGolemBoss: !!flags['downed_245'],
    };
    // 月后锁取世界 flags（原版 NPC.downedMoonlord；恒 false 会把月后物永久挡在微光外）
    const downedMoonlord = !!flags['downed_398'];
    // :49052/:49056 运行时门：560 雨中禁入 / 4986 已解锁彩虹史莱姆后禁入
    const shimmerCtx = {
      slimeRain: !!(game.world as unknown as { weather?: { slimeRain?: boolean } }).weather?.slimeRain,
      rainbowSlimeUnlocked: !!flags['unlockedSlimeRainbowSpawn'],
    };
    if (inShimmer && canShimmerItem(vid, downedMoonlord, game.world.clock.moonPhase, decraftCtx, shimmerCtx)) {
      this.shimmerTime += 0.01;
      if (this.shimmerTime > 0.9) {
        this.shimmerTime = 0.9;
        this.getShimmered(game);
      }
    } else if (this.shimmerTime > 0) {
      this.shimmerTime = Math.max(0, this.shimmerTime - 0.01);
    }
  }

  /** WorldItem.GetShimmered（:1781-1931）分支顺序 1:1：钱币(:1786) →
   *  ShimmerTransformToItem(:1809) → 4986 彩虹史莱姆解锁(:1816) → 560 史莱姆雨
   *  (:1838) → makeNPC 放生(:1855) → decraft(:1878)。**decraft 必须排在钱币/转化
   *  之后**：钱币 71-74 与火炬 8 等都有 IsCrafted 配方，放前面会抢走转化/coinLuck 分支 */
  private getShimmered(game: GameHooks): void {
    const vid = (ITEM_DEFS[this.itemId]?.vid ?? -1);
    // 微光转化完成音 = SoundID.Item176（WorldItem.cs:1689-1696 ShimmerEffect——
    // GetShimmered 全部分支【共尾】单点调用 :1875,钱币支不 return 也走）。
    // 音量 ×0.9 = LegacySoundPlayer.cs:520-521（case 2 num==176 支）。
    // 本仓链是早退分支结构 → 每个落地分支补一次（下方各支同款行）。
    // ★共尾同时发 TRANSMUTE_ITEM prog 27（WorldItem.cs:1878
    // `AchievementsHelper.NotifyProgressionEvent(27)`——GetShimmered 共尾段,转化/
    // decraft/钱币/放生各支同发,2026-09-04 成就触发面审计接线）
    const shimmerDoneSfx = (): void => {
      game.playSfxFile?.('Item_176', 0.9, this.cx, this.cy);
      game.achievements?.notifyProgressionEvent(27);
    };
    if (vid === 71 || vid === 72 || vid === 73 || vid === 74) {
      // 钱币 → 微光化币（:1791-1810）：面额放大后 AddCoinLuck（距离 <1000px 才累计，
      // LuckState.addCoinLuck 1:1），物品消失
      const amount = coinLuckAmount(vid, this.stack);
      const player = (game as unknown as { player: Player }).player;
      const dist = Math.hypot(player.cx - this.cx, player.cy - this.cy);
      player.luckState.addCoinLuck(dist, amount);
      shimmerDoneSfx();                                        // 原版共尾 :1875
      this.stack = 0;
      this.dead = true;
      return;
    }
    const target = getTransformToItem(vid, game.world.clock.moonPhase);   // 3461 月相砖动态分支
    if (target > 0) {
      const iid = internalIdOfVanilla(target);
      if (iid >= 0) {
        this.itemId = iid;       // SetDefaults(target) 原堆叠保留（:1813-1817）
        this.refreshDimsFromVid();   // ★BJ343 件1：SetDefaults 语义含 w/h 重置（WorldItem.cs:1752）
        this.shimmered = true;    // 上浮漂浮
        this.shimmerTime = 1;
        this.vx *= 0.1; this.vy *= 0.1;
        shimmerDoneSfx();                                      // Item176（WorldItem.cs:1875 共尾）
        return;
      }
    }
    // 4986 闪耀史莱姆气球（:1816-1837）：首次入微光 → 解锁彩虹史莱姆城镇 NPC 681
    // （从 Center.X+4 落点出生，继承物品速度，shimmerTransparency=1 渐显）并消耗 1 个；
    // 已解锁则整组分支跳过（return，物品原样滞留微光）
    if (vid === 4986) {
      const flags = (game.world as unknown as { flags: Record<string, boolean> }).flags ?? {};
      if (flags['unlockedSlimeRainbowSpawn']) return;         // :1818-1821
      flags['unlockedSlimeRainbowSpawn'] = true;              // NPC.unlockedSlimeRainbowSpawn
      const e = game.spawnNpcByVanilla?.(681, this.cx + 4, this.cy);
      if (e) { e.vx = this.vx; e.spawnAlpha = 254; e.alphaFade = true; }
      // 成就：彩虹史莱姆解锁复查（WorldItem.cs:1771 WorldGen.
      // CheckAchievement_RealEstateAndTownSlimes 1:1——ALL_TOWN_SLIMES 26 面补全，
      // 2026-09-04 审计接；原"成就项未接，登记"注退役）
      game.checkAchievementRealEstateAndTownSlimes?.();
      this.stack--;
      if (this.stack <= 0) { this.stack = 0; this.dead = true; }   // :1832-1836 type=0
      else this.shimmerTime = 1;                                   // :1948-1951 共尾
      this.vx *= 0.1; this.vy *= 0.1;                              // :1958
      shimmerDoneSfx();                                      // Item176（WorldItem.cs:1875 共尾）
      return;
    }
    // 560 史莱姆王冠（:1838-1854）：雨未进行 → 触发史莱姆雨并消耗 1 个
    if (vid === 560) {
      const wd = (game.world as unknown as { weather?: { slimeRain?: boolean; startSlimeRain?: () => void } }).weather;
      if (wd?.slimeRain) return;                              // :1840-1843
      wd?.startSlimeRain?.();                                 // Main.StartSlimeRain
      this.stack--;
      if (this.stack <= 0) { this.stack = 0; this.dead = true; }   // :1845-1848
      else this.shimmered = true;                                  // :1850-1853
      shimmerDoneSfx();                                      // Item176（WorldItem.cs:1875 共尾）
      return;
    }
    // makeNPC 瓶中小动物（:1855-1877）：逐个放生（上限 min(stack, 空闲 NPC 槽, 50)），
    // 放生目标优先 ShimmerTransformToNPC[makeNPC]（表内小动物全 → 677 微光蝇）
    const makeNpc = makeNpcOfItem(vid);
    if (makeNpc > 0) {
      const to = npcShimmerTransformTo(makeNpc);
      const npcId = to >= 0 ? to : makeNpc;                  // :1866
      // NPC.GetAvailableAmountOfNPCsToSpawnUpToSlot(:81435)：0..199 空闲槽数，钳 stack
      const active = (game.enemies?.().length ?? 0) + (game.critters?.().length ?? 0);
      let left = Math.min(this.stack, Math.max(0, 200 - active));
      for (let guard = 50; guard > 0 && left > 0 && this.stack > 0; guard--, left--) {  // :1860 num3=50
        this.stack--;
        const e = game.spawnNpcByVanilla?.(npcId, this.cx, this.y + this.h);
        if (e) { e.spawnAlpha = 254; e.alphaFade = true; }    // :1869 shimmerTransparency=1
      }
      this.shimmered = true;                                  // :1872
      if (this.stack <= 0) { this.stack = 0; this.dead = true; }   // :1873-1876
      else this.shimmerTime = 1;
      this.vx *= 0.1; this.vy *= 0.1;
      shimmerDoneSfx();                                      // Item176（WorldItem.cs:1875 共尾）
      return;
    }
    this.tryDecraft(game, vid);   // :1878 else-if 链末端
  }

  /** WorldItem.GetShimmered decraft 分支（:1878-1946）1:1：
   *  纯计算走 Shimmer.decraftOutcome（材料序返还；组材料【替换】为组代表
   *  RecipeGroup.DecraftItemId——非追加；customShimmerResults 覆盖表；炼金逐单位
   *  1/3 蒸发；单垛 ≤9999）。此处仅负责逐垛 spawn（shimmered 上浮 + ≥2 材料
   *  按序号散射）与扣减 */
  private tryDecraft(game: GameHooks, vid: number): boolean {
    const flags = (game.world as unknown as { flags: Record<string, boolean> }).flags ?? {};
    const crimsonWorld = !!game.world.crimson;
    const downedBoss3 = !!(flags['downed_35'] || flags.downedSkeletron);
    const downedGolemBoss = !!flags['downed_245'];
    // :1878 入口 = IsItemDecraftableAndIsDecraftUnlocked（配方存在 ∧ 未锁 ∧ ≥1 次）
    if (!isItemDecraftableAndUnlocked(vid, this.stack, crimsonWorld, downedBoss3, downedGolemBoss)) {
      return false;
    }
    // ★NB-G 种子注入（2026-09-03）：rand3 走世界种子专用流（decraftRand3,Shimmer.ts
    //  WorldEvolution 同型=host.seed→RNG 专用实例续流）——曾缺注入落 Math.random()
    //  缺省参（炼金 1/3 蒸发不可复现,NB-G 唯一硬阻塞）
    const outcome = decraftOutcome(vid, this.stack, crimsonWorld, decraftRand3(game.world));
    if (!outcome) return false;   // 空垛不回退：炼金全蒸发时原版照扣 stack（:1879-1933）
    // ★偏差2（2026-09-17 用户拍板明令分歧）：产物出生列预扫（decraftSpawnX）——
    //  原版恒在分解点出生（SpawnShimmeredItem WorldItem.cs:629-645 → RequestNewItem
    //  `worldItem.Center = center`,Item.cs:49747），上浮被顶板钳死即永久钉住；本仓
    //  在通畅列存在时改列出生，整湖有盖/超深回退原位 = 原版（详方法注）。
    const sx = this.decraftSpawnX(game);
    outcome.piles.forEach((p, k) => {
      const key = VANILLA_ITEM_KEY_BY_ID[p.vid];
      if (!key) return;
      // 散射序号按【材料】递增（原版 num7，:1846/:1855）而非按垛：超额拆垛
      // 共享同一序号、炼金全蒸发的材料序号不空缺——曾 k+1 按垛计数，拆垛后
      // 续材料的散射速度整体错档
      // ★D1 对账修正（2026-09-17）：散射初速对齐 1457 SpawnShimmeredItem
      //  （WorldItem.cs:629-645）——:631 `new Vector2(itemNumber * (itemNumber % 2 * 2
      //  - 1), 0f)` = 整值 ±num7（0,+1,−2,+3…）、Y 恒 0，经 RequestNewItem
      //  （Item.cs:49748 velocity.HasValue 全量覆盖出生速度）生效；1457 num7【0 基】
      //  （:1846 `int num7 = 0` + :1855 后缀自增 `SpawnShimmeredItem(num7++,…)`），
      //  本仓 slots 1 基（忠实 1456：WorldItem1456.cs decraft 材料循环头 num7++）
      //  → n = slots[k]−1。曾用 1456 旧式（1456 :676-678 `n×(1+n·0.05)` 偶数×−1 +
      //  requiredItem[1] spread 门 + 出生速度=random×0.1）——08-23 基线切换漏网，
      //  recon-item 闸门只对账数据面不覆盖速度面故此前未爆。1457 无 spread 门：
      //  单材料 num7=0 → 速度自然为零向量，不需分支。`||0` = n=0 时 0×(−1)=−0 归一。
      const n = outcome.slots[k] - 1;
      const vx = n * (n % 2 * 2 - 1) || 0;      // :631 逐字（0,+1,−2,+3,−4…）
      const d = game.spawnDrop(sx, this.cy, key, p.stack, vx, 0);
      if (!d) return;
      d.shimmered = true;   // :635（1456 :1924 同位）上浮漂浮
      d.shimmerTime = 1;    // :634（1456 :1923 同位）
      // （1457 SpawnShimmeredItem :636-637 出生硬置 shimmerWet/wet=true——本仓次帧
      //  全盒探针回算（fixedUpdate liquidCollision），盒擦液即真，净行为同相）
    });
    this.stack -= outcome.consumed;              // :1927 stack -= 次数×createStack
    if (this.stack <= 0) { this.stack = 0; this.dead = true; }
    else this.shimmerTime = 1;                   // :1936 剩余 stack 保留并重置浸入进度
    // Item176 转化音（WorldItem.cs:1875 GetShimmered 共尾 → ShimmerEffect :1689-1696；
    // ×0.9 = LegacySoundPlayer.cs:520）——decraft 支同走该尾；prog 27 同共尾（:1878）。
    // （旧伴发的 shimmerSplash 名路由退役：原版转化共尾只发 Item176,入池
    //   Splash_4 在 WetCollision 翻转拍由 itemSplashFace 发——2026-09-17 发声面对齐）
    game.playSfxFile?.('Item_176', 0.9, this.cx, this.cy);
    game.achievements?.notifyProgressionEvent(27);
    return true;
  }

  /** ★偏差2（2026-09-17 用户拍板明令分歧）：decraft 产物出生列预扫。
   *  原版：产物恒在分解点出生（SpawnShimmeredItem WorldItem.cs:629-645 →
   *  RequestNewItem `worldItem.Center = center`,Item.cs:49747），上浮被 TileCollision
   *  上行支（Collision.cs:2446）钳制 → 头顶实心顶板 = 垂直钉死（恢复面 = 下潜拾取/
   *  挖顶板，无超时）。本仓：自原物中心列按 |offset| 递增（0,+1,−1…+6,−6，同距先右）
   *  取最近「通畅列」= 出生格在微光液内 ∧ 自出生行向上至首个非微光液格（=浮出平衡面）
   *  全程 st.isSolid 为假 ∧ 平衡面上一格无实心（悬停平衡中心横跨该边界）；命中 →
   *  产物改在该列中心出生（offset=0 保持原版中心像素 = 常态零偏差）；整湖有盖/超深
   *  → 回退原物中心 = 原版。谓词与 moveAxis 上顶支同源（st.isSolid）——坡/半砖按
   *  实心保守计（原版部分坡格不拦上行，保守回退 = 宁可原版勿误移）。
   *  仅选出生点，上浮物理逐位不动；与偏差1（超时穿块）分层：预扫失败才由兜底接手。
   *  联机：纯世界读态 + 固定扫描序，各端确定性同结果。 */
  private decraftSpawnX(game: GameHooks): number {
    const st = game.world.store;
    const col0 = Math.floor(this.cx / TILE);
    const row0 = Math.floor(this.cy / TILE);
    const open = (col: number): boolean => {
      if (!st.inBounds(col, row0)) return false;
      const i0 = st.idx(col, row0);
      if (st.isSolid(col, row0)) return false;
      if (!(st.liquid[i0] > 0 && st.liquidType[i0] === 4)) return false;
      for (let r = row0 - 1; r >= row0 - 64; r--) {
        if (!st.inBounds(col, r)) return false;
        if (st.isSolid(col, r)) return false;
        const li = st.idx(col, r);
        if (!(st.liquid[li] > 0 && st.liquidType[li] === 4)) {
          // 首个非微光液格 = 浮出平衡面（空气或覆盖水层,与 ③支终止语义同口径）；
          // 平衡中心横跨其上格边界 → 上格也须无实心,否则产物钉在液面下
          if (r - 1 < 0 || !st.inBounds(col, r - 1) || st.isSolid(col, r - 1)) return false;
          return true;
        }
      }
      return false;   // 64 格内未见平衡面（超深/异常柱）→ 保守回退原版
    };
    for (let off = 0; off <= 6; off++) {
      if (open(col0 + off)) return off === 0 ? this.cx : (col0 + off + 0.5) * TILE;
      if (off > 0 && open(col0 - off)) return (col0 - off + 0.5) * TILE;
    }
    return this.cx;
  }

  // ---- 出入液溅花 1:1（WorldItem.cs MoveInWorld :884-1050；2026-09-17 微光发声面
  //      普查接线——旧实现为中心格>80 水/蜜 ∧ vy>1.2 近似 + playSfx('splash')
  //      Splash_0..5 六变体乱掷,微光入/出池两支整缺）：
  //      wet = WetCollision（npcLiquid 1:1 移植体,任意液体含岩浆/微光——物品无
  //      shimmering 豁免）翻转 + wetCount==0（:904-907/:995-997）;wetCount=20。
  //      音 = PlaySound(19)=Splash_N（SoundEngine.cs:102 Style 缺省 1）：微光入 4
  //      (:921)/微光出 5(:1000)/水/蜜/岩浆缺省 1(:934/:947/:961/:1013/:1026/:1040)
  //      ——与玩家档(水0/微光入2出3)、NPC 档(水0+静音名单)均不同,物品无静音名单;
  //      Splash_4/5 ×0.75 音量与 [-20,0] 音高抖动由 Sfx 库 FILE_CASE_VOL/PITCH 承载
  //      尘 = 微光 10×308 四色(Next(6) 1:1:1:3) scale0.8 vy−4 vx×2.5 noGravity
  //      （入:899-919/出:1002-1017,盒 y+h/2−8）、水 10×dustWater() α100 scale0.8
  //      （入:926-935 盒−8/出:1026-1034 盒无−8）、蜜 5×152（:937-946/:1019-1025）、
  //      岩浆 5×35（:953-962/:1035-1043,盒−8）；粘滞三旗 !wet 拍末清偿（:1045-1049）----
  private itemSplashFace(game: GameHooks, lavaNow: boolean): void {
    const r = wetCollision(game.world.store, this.x, this.y, this.w, this.h);
    const wetNow = r.wet;
    if (r.honey) this.splashHoneyWet = true;
    if (r.shimmer) this.splashShimmerWet = true;
    if (lavaNow) this.splashLavaWet = true;
    if (wetNow) {
      if (!this.wetSticky) {                              // :900 if (!wet)
        if (this.wetCount === 0) {                        // :906
          this.wetCount = 20;                             // :907
          if (!lavaNow) {                                 // :908（本拍 LavaCollision）
            if (this.splashShimmerWet) {                  // :909
              this.splashDust(game, 'shimmer', this.y + this.h / 2 - 8);
              game.playSfxWav?.('Splash_4', 1, this.x, this.y);   // :921 style 4
            } else if (this.splashHoneyWet) {             // :936
              this.splashDust(game, 'honey', this.y + this.h / 2 - 8);
              game.playSfxWav?.('Splash_1', 1, this.x, this.y);   // :934 缺省 style 1
            } else {                                      // :937-947 水
              this.splashDust(game, 'water', this.y + this.h / 2 - 8);
              game.playSfxWav?.('Splash_1', 1, this.x, this.y);   // :947 缺省 style 1
            }
          } else {                                        // :948 岩浆 else 支
            this.splashDust(game, 'lava', this.y + this.h / 2 - 8);
            game.playSfxWav?.('Splash_1', 1, this.x, this.y);     // :961 缺省 style 1
          }
        }
        this.wetSticky = true;                            // :978 wet = true
      }
    } else if (this.wetSticky) {                          // :979 else if (wet)
      this.wetSticky = false;                             // :981 wet = false（支首）
      if (this.wetCount === 0) {                          // :995
        this.wetCount = 20;                               // :997
        if (!this.splashLavaWet) {                        // :998（粘滞 lavaWet）
          if (this.splashShimmerWet) {                    // :999
            this.splashDust(game, 'shimmer', this.y + this.h / 2 - 8);
            game.playSfxWav?.('Splash_5', 1, this.x, this.y);     // :1000 style 5
          } else if (this.splashHoneyWet) {               // :1018
            this.splashDust(game, 'honey', this.y + this.h / 2 - 8);
            game.playSfxWav?.('Splash_1', 1, this.x, this.y);     // :1013 缺省 style 1
          } else {                                        // :1019-1026 水
            this.splashDust(game, 'water', this.y + this.h / 2);
            game.playSfxWav?.('Splash_1', 1, this.x, this.y);     // :1026 缺省 style 1
          }
        } else {                                          // :1027 岩浆 else 支
          this.splashDust(game, 'lava', this.y + this.h / 2 - 8);
          game.playSfxWav?.('Splash_1', 1, this.x, this.y);       // :1040 缺省 style 1
        }
      }
    }
    if (!wetNow) {                                        // :1044-1049 !wet 清粘滞三旗
      this.splashLavaWet = false;
      this.splashHoneyWet = false;
      this.splashShimmerWet = false;
    }
    if (this.wetCount > 0) this.wetCount--;               // :1050-1052
  }

  /** 溅花尘（WorldItem.cs 四支;物品档 counts=微光10/水10/蜜5/岩浆5,玩家档 50/50/20/20）
   *  ——复用 spawnDust 原版尘池 + NewDust 分型补链,与 Player.splash*Dust 同式 */
  private splashDust(game: GameHooks, kind: 'shimmer' | 'water' | 'honey' | 'lava',
    boxY: number): void {
    const waterStyle = (game as { renderer?: { waterStyle?: number } }).renderer?.waterStyle ?? 0;
    const n = kind === 'honey' || kind === 'lava' ? 5 : 10;
    const type = kind === 'shimmer' ? 308
      : kind === 'water' ? dustWaterFor(waterStyle)
        : kind === 'honey' ? 152 : 35;
    for (let i = 0; i < n; i++) {
      const d = game.spawnDust?.(this.x - 6, boxY, this.w + 12, 24, type);
      if (!d) continue;
      if (kind === 'shimmer') {
        d.vx *= 0.5; d.vy = d.vy * 0.5 + 1;   // NewDust 308 支补链（Dust.cs:227-231）
        d.vy -= 4; d.vx *= 2.5;
        d.scale = 0.8;
        d.noGravity = true;
        const roll = (Math.random() * 6) | 0;   // Main.rand.Next(6)（:905/:1008）
        d.color = roll === 0 ? { r: 255, g: 255, b: 210, a: 255 }
          : roll === 1 ? { r: 190, g: 245, b: 255, a: 255 }
          : roll === 2 ? { r: 255, g: 150, b: 255, a: 255 }
          : { r: 190, g: 175, b: 255, a: 255 };
      } else if (kind === 'water') {
        d.vy -= 4; d.vx *= 2.5;
        d.scale = 0.8; d.alpha = 100; d.noGravity = true;
      } else {
        d.vx *= 0.1; d.vy = -0.5;             // NewDust 34/35/152 支补链（Dust.cs:246-254）
        d.vy -= kind === 'honey' ? 1 : 1.5;
        d.vx *= 2.5;
        d.scale = 1.3; d.alpha = 100; d.noGravity = true;
      }
    }
  }

  /** WorldItem.CheckLavaDeath（1456 :731-804 = 1457 :686-703;红蓝-D 2026-09-18
   *  锚勘误——原 :731-804/:800-804 系 1456 域）1:1：
   *  - vid 267 向导巫毒娃娃（1457 :692-696 委派 VoodooDollLavaDeath :705-777）：
   *    TurnToAir(:713) → 场上每只向导（type 22）
   *    StrikeNPCNoInteraction(9999, 10, -direction) 致死(:725) + **每杀一只调一次**
   *    NPC.SpawnWOF(物品位置)（:728；首次生成后 AnyNPCs(113) 门挡掉后续调用，
   *    净效果 = 杀完全部向导再召）→ stack 余量随机处决城镇 NPC 直到扣完（:736-758）。
   *  - 其余物品（:697-702）：rare 门 :698——rare 0/-1 且不在 IsLavaImmuneRegardlessOfRarity → 烧毁。
   *  单人语义缺省：playerIndexTheItemIsReservedFor==myPlayer 恒真、netMode 门不适用。
   *  ★BJ574（2026-10-08）：两处 hurt 补传 force=true（第 8 参）——原版
   *  StrikeNPCNoInteraction=StrikeNPC(owner:255) 全链不查无敌帧（NPC.cs:82012→
   *  :82017），本仓 TownNPC.hurt 的 iframes/shimmerRise 拒收窗若不 force 会在
   *  向导刚受击时吞掉烧娃致死（IIIII223 F-8 既有登记域；判别面
   *  tests/bj574-voodoo-lava-wof.test.ts ①⑥）。
   *  差异：原版 StrikeNPC 后 NPC 当 tick 仍 active（死亡在下一 Update 收口），余量
   *  随机池可能命中垂死向导；本仓 TownNPC.hurt 即时置 dead，池自然排除，净效果一致 */
  /** ★BJ745 A41：TryFillBucket 1:1（WorldItem.cs:553-576）——空桶 205 掉落物在
   *  雨天地表露天处按 600/dayRate 与雨强随机收雨变水桶 206（整堆保 stack）。
   *  调用位=非抓取帧物理段头（:404-406）;墙白名单 WALL_ALLOWS_WIND 单源
   *  （Mounts.ts,WallID.cs:54）。 */
  private tryFillBucket(game: GameHooks): void {
    const w = game.world as unknown as {
      weather?: { raining?: boolean; maxRaining?: number };
      groundLevel: number; rockLevel: number; h: number;
      seedFlags?: { remix?: boolean };
      dayRate?(): number;
    };
    // :555-557 保留/雨/地表三门——isThereAWorldSurface 本仓恒真不建模;remix 分支
    // IsSurfaceForAtmospherics（WorldGen.cs:11003-11016）与常规 y≤worldSurface 并道
    if (!w.weather?.raining) return;
    const tx = Math.trunc(this.cx / TILE), ty = Math.trunc(this.cy / TILE);
    const remix = !!w.seedFlags?.remix;
    const surfaceOk = remix
      ? (ty > w.rockLevel && ty < w.h - 350)
      : ty <= w.groundLevel;
    if (!surfaceOk) return;
    const st = game.world.store as unknown as {
      inBounds(x: number, y: number): boolean; idx(x: number, y: number): number; wall: ArrayLike<number>;
    };
    if (!st.inBounds(tx, ty)) return;
    if (!WALL_ALLOWS_WIND.has(st.wall[st.idx(tx, ty)])) return;   // 含 wall 0
    // :566-573 掷式——num3=600（仅 dayRate∈(0,600) 才除——快进提频;0/1 同档 1/600）
    let num3 = 600;
    const dayRate = w.dayRate?.() ?? 1;
    if (dayRate > 0 && dayRate < num3) num3 = Math.trunc(num3 / dayRate);
    if (Math.floor(Math.random() * num3) !== 0) return;             // Next(num3) == 0
    if (Math.random() >= (w.weather.maxRaining ?? 0)) return;       // NextFloat() < maxRaining
    // :574-575 整堆 205→206（SetDefaults 保 stack;SyncItem=MP 断言全态覆写自然携带）
    const iid = internalIdOfVanilla(206);
    if (iid < 0) return;
    this.itemId = iid;
    this.refreshDimsFromVid();
  }

  private checkLavaDeath(game: GameHooks): void {
    const vid = (ITEM_DEFS[this.itemId]?.vid ?? -1);
    if (vid === 267) {
      let num = this.stack;
      this.dead = true;                       // TurnToAir
      // ★IIIII232：图鉴杀数补账（WorldItem.cs:723-727/:756-760——原版 StrikeNPCNoInteraction
      //  前对每只被处决 NPC 直调 Kills.RegisterKill（IsNPCValidForBestiaryKillCredit 门；
      //  不经 NPCLoot 的交互门——NoInteraction 路径本就无 playerInteraction 位）。
      //  本仓 TownNPC.hurt 死亡链不经 onEnemyKilled，故在此直记 + module4 广播。
      //  可见面：城镇条目解锁门=聊天（TownNPCUICollectionInfoProvider），杀数仅计数器；
      //  但 35 裁缝师（MULTI_SOURCES 68 条目 kill 支）等经 creditId 归并可成为杀数来源）
      const bestiary = (game.world as unknown as { bestiary?: {
        registerKill(netId: number): number } }).bestiary;
      const net = (game as unknown as { net?: { sendBestiaryEvent?(e: unknown): void } }).net;
      const creditKill = (n: TownNPC): void => {
        if (!bestiary || n.vanillaId == null) return;
        if (!isNpcValidForBestiaryKillCredit(n.vanillaId, false)) return;
        const killCount = bestiary.registerKill(n.vanillaId);
        net?.sendBestiaryEvent?.({ sub: BestiarySub.Kill, netId: n.vanillaId, count: killCount });
      };
      const npcs = ((game.npcs?.() ?? []) as TownNPC[]).filter((n) => !n.dead);
      let flag = false;
      for (const n of npcs) {
        if (n.vanillaId !== 22) continue;
        creditKill(n);                        // :722-724 RegisterKill 先于 StrikeNPC
        // ★BJ574（2026-10-08，IIIII223 F-8 清偿）：StrikeNPCNoInteraction =
        // StrikeNPC(owner:255)（NPC.cs:82012→:82017）全链【不读】无敌帧——本仓
        // TownNPC.hurt 的 iframes 拒收窗（TownNPC.ts `!force` 门）须以 force=true
        // 打穿，否则向导刚受击（iframes>0）时烧娃致死当拍被吞（原版必杀）。
        n.hurt(9999, 10 * (n.facing || 1), 0, game, 0, 0, false, true);   // StrikeNPCNoInteraction(9999, 10f, -dir)
        num--;
        flag = true;
        spawnWOF(game, this.x, this.y);       // :748 娃娃掉落位置（娃娃已烧，位置留用）
      }
      if (flag) {
        const pool = npcs.filter((n) => !n.dead);      // isLikeATownNPC ≙ 城镇 NPC 桶
        while (num > 0 && pool.length > 0) {
          const n = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
          creditKill(n);                      // :755-757 同上（余量随机处决支）
          n.hurt(9999, 10 * (n.facing || 1), 0, game, 0, 0, false, true);   // ★BJ574 force：余量处决支同 owner=255 强制面（:82012）
          num--;
        }
      }
      return;
    }
    if (LAVA_IMMUNE_ITEMS.has(vid)) return;
    const rare = ITEM_RARE[String(vid)] ?? 0;
    if (rare === 0 || rare === -1) {
      this.dead = true;
      game.recLog?.('burn', { vid, n: this.stack });   // 行为录制：掉落物岩浆烧毁
    }
  }

  draw() { /* Renderer 统一绘制 */ }

  /** ★BJ558（2026-10-08）拉取面满包门 = Player.ItemSpace(worldItem).CanTakeItem
   *  （GrabItems :35220-35224 `status = ItemSpace(worldItem); if (!CanPullItem(
   *  worldItem, status)) continue;` + CanPullItem :39449-39457 `status.CanTakeItem
   *  ? CanAcceptItemIntoInventory(item) : false`）。原版满包且无堆叠/空格/袋位时
   *  CanTakeItem=false → 物品【原地不动不吸】;本仓此前整缺此门=满包仍把不可堆叠
   *  物吸到身上堆积（碰触拾取臂无此门同构,装不下留原地——原版 PickupItem :35383
   *  →GetItem 装不下 ReplaceWith 留位,本仓 touching 支同相不接）。
   *  臂结构（ItemSpace :39463-39507,canTakeToPersonalInventory 为其单源等价）：
   *  ① IsAPickup 恒真（心/星/星云 booster——:39465-39468）;
   *  ② 0-49 空格/可堆叠（:39473-39480,canItemSlotAcceptPickup :39530-39541）;
   *  ③ 弹药 54-57（:39482-39500 FillAmmo 面+无条件第二扫）;
   *  ④ cofveve 虚空袋臂（:39502-39505 → {CanTakeItem:true, ItemIsGoingToVoidVault
   *     :true}）——canTakeToPersonalInventory 返回值按 ItemSpaceStatus :246-256
   *     语义（CanTakeItemToPersonalInventory=CanTakeItem&&!VoidVault）剔除了该臂,
   *     而【拉取门消费的是 CanTakeItem 原值】（吸向玩家后碰触经 PickupItem→GetItem
   *     的 CanGoIntoVoidVault 支进 bank4,本仓 depositIntoVoidVault 兜底已接）→
   *     此处显式补回（useVoidBag + CanVoidVaultAccept :39735-39747 + bank4 有
   *     空位/可堆位,ItemSpaceForCofveve :39509-39528 逐槽扫描同构）。
   *  uniqueStack 臂（:39469-39471）=原版死码不建模（SW-BP1 证据结案）。
   *  桩宿主无背包面（inv.slots 缺席,如 BJ326 stub）→ 保守放行（拾取接线测试语义
   *  与门无关）;真 Player 恒有 58 槽。每帧每物仅拉取范围物品走到（&& 短路惰性）,
   *  常态有空格/可堆即首中早退,满包最坏 58 槽扫=原版 ItemSpace 同构开销。 */
  private itemSpaceCanPull(player: Player, vid: number): boolean {
    const slots = (player as unknown as { inv?: { slots?: (Record<string, unknown> | null)[] } })
      .inv?.slots;
    if (!slots) return true;
    const def = ITEM_DEFS[this.itemId];
    if (!def) return true;
    const maxStack = def.maxStack;
    if (canTakeToPersonalInventory(
      slots as Parameters<typeof canTakeToPersonalInventory>[0],
      this.itemId, maxStack,
      coinIndexOf(this.itemId) >= 0,
      ammoSlotAccepts(this.itemId),
      this.prefix,
      canFillEmptyAmmoSlot(this.itemId),
    )) return true;
    // cofveve 臂补回（CanTakeItem 原值面;canTakeToPersonalInventory 已剔除）
    if (!(player as unknown as { useVoidBag?: () => boolean }).useVoidBag?.()) return false;
    if (!canVoidVaultAccept(vid)) return false;
    const bank4 = (player as unknown as {
      banks?: Array<Array<{ id: number; stack: number; prefix?: number; placeStyle?: number } | null | undefined> | undefined>;
    }).banks?.[3];
    if (!Array.isArray(bank4)) return false;
    return bank4.some((s) => !s || (s.stack < maxStack
      && canMergeStack(s, { id: this.itemId, prefix: this.prefix })));
  }
}
