// Mod 类型面(2026-10-04,P0 L1 数据 mod)。
// 设计锚:game/docs/mod-loader-design.md;基线=session-13 规划(2026-08-11)。
// 能力分层:L1 纯数据(本文件全部类型)/L2 脚本(P1)/L3 白名单补丁(P2+)。
import type { ModTownArrivalSpec } from '../data/vanillaNpcs';
import type { ModRarityContent } from './rarity';   // ★刀3-1:稀有度档色 schema(类型单向)
import type { ModPetContent } from './pets';        // ★刀3-2:宠物声明 schema(类型单向)
import type { ModGoreContent } from './gore';       // ★刀3-3:gore 声明 schema(类型单向)
import type { ModWallContent } from './walls';      // ★刀3-墙:墙声明 schema(类型单向)
import type { ModMountContent } from './mounts';    // ★第三批:坐骑声明 schema(类型单向)
import type { ModHairContent } from './hairs';      // ★第三批:发型声明 schema(类型单向)
import type { ModDustContent } from './dusts';      // ★第四批:尘埃声明 schema(类型单向)
import type { ModAchievementSpec } from './modAchievements';   // ★成就域 L1 面 schema(类型单向)
export type { ModRarityContent };
export type { ModGoreContent };
export type { ModWallContent };
export type { ModMountContent };
export type { ModHairContent };
export type { ModDustContent };

/** mod 清单(mod.json)。id=命名空间,全仓唯一。 */
export interface ModManifest {
  /** ^[a-z][a-z0-9_]{1,31}$;存档/联机 key 与 l10n 命名空间 Mods.<id>.* 由此派生 */
  id: string;
  name: string;
  /** semver x.y.z(解析为数字三元组比较) */
  version: string;
  author?: string;
  description?: string;
  /** mod API 版本(当前 1);引擎不认的 api 拒载 */
  api: number;
  side: 'both' | 'client' | 'server';
  /** 依赖:modId → 版本约束(^1.2.3 前缀式或精确 x.y.z) */
  dependencies?: Record<string, string>;
  /** ★Tier1-c(2026-10-14):联网域白名单(空/缺省=sw.net 整缺;*.x.y 子域通配) */
  net?: string[];
  /** ★P2:声明式配置表(键→类型+缺省;entry 经 sw.config 读写;面板内联编辑) */
  config?: Record<string, {
    type: 'bool' | 'number' | 'string';
    default: boolean | number | string;
    label?: string;
    min?: number;
    max?: number;
  }>;

  /** ★608:变身视觉表(纸娃娃三甲槽覆写;slot=5001+ 段——assets.ts 别名注入
   *  Armor_Head_/Armor_Legs_<slot>;消费=Renderer dollEquip 覆写臂) */
  visualSheets?: Array<{ head?: number; body?: number; legs?: number;
    headTex?: string; bodyTex?: string; legsTex?: string }>;
}

/** L1 物品内容(content/items/*.json)。字段面=ItemDef/itemfunc/itemcombat/itemstats
 *  三表的 mod 子集——注册时拆写到各运行时表,白嫖原版派发面(updateUse/combatWeapon)。 */
export interface ModItemContent {
  /** mod 内唯一键;运行时全键 = `mod_<modid>_<key>` */
  key: string;
  name: string;
  /** 稀有度:数字直填;或 `{$rarity: key}` 引用本 mod content/rarities 档(注册期解析,
   *  ★刀3-1)。原版值域 -13..10;mod 档=12+ 段(mods/rarity.ts;11=原版词缀位移可达域) */
  rare?: number | { $rarity: string };
  /** ★刀3-2:宠物声明(tML 同构 buff+proj 组合;buff=本 mod content/buffs 键,
   *  proj=`proj:<key>`/裸键/原版 proj vid;light=true=光宠槽 1) */
  pet?: ModPetContent;
  /** ★刀3-墙:可放置墙面(本 mod content/walls 键/原版墙键 `wN_*`;注册期解析成
   *  wallId 挂 def——updateUse 派发门 heldDef.wallId 消费,放置/ReplaceWall 全链白嫖) */
  placeWall?: string;
  value?: number;
  maxStack?: number;
  /** 战斗面(vanilla-itemcombat 语义)。shoot:数字=原版弹 vid;字符串 `proj:<key>`=
   *  本 mod 声明弹幕(P2,plan 期换算 allocated projId) */
  combat?: {
    damage?: number; knockBack?: number; useTime?: number; useAnimation?: number;
    shoot?: number | string; shootSpeed?: number; mana?: number;
    /** ★P7 红蓝补(M2):弹药流消费面——引擎 rangedAmmoWeapon 读 combat.useAmmo */
    useAmmo?: number;
    melee?: boolean; ranged?: boolean; magic?: boolean; summon?: boolean;
    noMelee?: boolean; autoReuse?: boolean; useTurn?: boolean; crit?: number;
    /** ★三百六十八:右键换弹(altFunctionUse==2 时覆写 combat.shoot) */
  altShoot?: string | number;
};
  /** 功能面(vanilla-itemfunc 语义):工具力/放置/药水/弹药 */
  func?: {
    useStyle?: number; pick?: number; axe?: number; hammer?: number;
    createTile?: number; placeStyle?: number;
    consumable?: number; potion?: number;
    healLife?: number; healMana?: number;
    /** ★D6(2026-10-13):buffType 双域——number=原版 id/mod 伪 id(9000+,反查表直查);
     *  string=mod buff 键(消费期解析——applyRegistrationPlan 先于 entry 相位,注册期
     *  解析不可行;键→BuffType→伪 vanilla id 进 BUFF_BY_VANILLA 既有通道) */
    buffType?: number | string; buffTime?: number;
    ammo?: number; useAmmo?: number;
    autoReuse?: number; useTime?: number; useTurn?: number;
    /** B6:宝藏袋开包面(右键/使用消耗,AllOptionsAtOnce+保底语义;item=本 mod 键或
     *  原版 vid 数字串;chance 0-1 缺省 1;全空掷=保底首条×1)。
     *  coins=按 NPC 价值掷币(CoinsBasedOnNPCValue;值=本 mod 键或原版 npcId) */
    bagLoot?: Array<{ item?: string | number; coins?: string | number; min?: number; max?: number; chance?: number }>;
    /** ★刀5-A 族:在场弹补位门(canuse-rules 数据解释器;proj=`proj:<key>`/裸键/
     *  原版 proj vid;lt=门限——本弹在场数 < lt 才可用,召唤/炮台类「补位门」) */
    canUseOwnedBelow?: { proj: string | number; lt: number };
  };
  /** 盔甲/配饰面(vanilla-itemstats 语义)。def=防御;s='h'|'b'|'l';acc=1 功能配饰/0 社交;
   *  life=生命回复(hpPerSec=life/2);dmg 各系/crit 各系/moveMult/endurance=UpdateEquip
   *  加法形(六十六刀;引擎 PlayerEquipStats 同名面,读侧=聚合器环) */
  stats?: { def?: number; s?: 'h' | 'b' | 'l'; acc?: 0 | 1; van?: 1; life?: number;
    dmgMelee?: number; dmgRanged?: number; dmgMagic?: number; dmgAll?: number;
    critMelee?: number; critRanged?: number; critMagic?: number;
    moveMult?: number; endurance?: number;
    /** ★四百八十二刀:盔甲绘制槽序号(套装匹配键;extract-armor 写入,3000+ 段) */
    hs?: number; bs?: number; ls?: number;
    /** ★603:mod 翼槽(4000+ 段;[AutoloadEquip(Wings)];wingStatOf mod 表回退) */
    wing?: number;
    /** ★603:mod 翼属性(C# WingStats 全字段;wing 槽声明时必附) */
    wingStats?: { time: number; accSpeed: number; accelMult: number;
      hover?: boolean; hoverT?: number; hoverS?: number; }; };
  /** P4:旅程研究所需献祭数(缺省=不可研究) */
  research?: number;
  /** 可放置:目标 tile 键(本 mod tile 键或原版 tile 键 v_<TileID>_*);缺省=不可放置 */
  placeTile?: string;
  /** ★第三批:坐骑召唤件(本 mod content/mounts 键;注册期解析→ITEM_TO_MOUNT 扩条) */
  mountItem?: string;
  /** 贴图(textures/ 下相对路径);缺省=无名占位(灰格) */
  texture?: string;
  /** ★刀2-C1:掉落/手持光罩(贴图 alias 到 vanilla/Glow_<伪 GlowMaskID>.png,
   *  1000+ 段=原版 379 张空间外;drawDrop 捕获+flushItemGlow 全链白嫖) */
  glowmask?: { texture: string };
}

/** mod tile 稳定段上限(B5 扩窗定谳:原 2047=保守帽;全仓审计零 11 位打包——
 *  存档 RLE/联机 tile 通道均 u16(65535)语义,4095 留 4× 余量,u16 内零破坏) */
export const MOD_TILE_STABLE_MAX = 4095;
/** L1 tile 内容(content/tiles/*.json)。稳定 id 走 1030-4095 空闲区(append-only)。 */
export interface ModTileContent {
  key: string;
  name?: string;
  solid?: boolean; platform?: boolean; decor?: boolean;
  /** 多格框架物体(B5b 站点族):framed=true + w/h=占格数;渲染 fw/fh=w/h 同源 */
  framed?: boolean; w?: number; h?: number;
  /** B6:兼用原版站点(AdjTiles 语义;如 CosmicAnvil≈铁砧+秘银砧) */
  adjTiles?: number[];
  /** ★一百一十三刀:功能性宝箱 tile(2×2;开箱 UI/箱实体绑定;loot 走生成期
   *  gs.mods.chests sink) */
  chest?: boolean;
  opacity?: number;
  pick?: number; axe?: number;
  mapColor?: string;
  /** 帧模式:'auto'=8 向融合(需整表),'style'=逐 style 竖帧,'blend'=独立块。缺省 style */
  frame?: 'auto' | 'style' | 'blend';
  /** 贴图表(textures/ 相对路径,Tiles_N.png 同构整表) */
  texture: string;
  /** 单帧尺寸(px);缺省 16×16 */
  frameWidth?: number; frameHeight?: number;
  /** style 数(帧表竖向/横向 style 槽数;缺省 1) */
  styles?: number;
  /** 破坏掉落:本 mod 物品键;缺省=不掉落 */
  dropItem?: string;
  /** ★B7 七十八刀:树数据面(GrowsOnTileId 生长锚/树苗 tile 键;引擎树砍链接=余段) */
  growsOn?: string | null;
  sapling?: string | null;
  /** ★一百零八审计修:群系旗声明(键→'astral'/'sulphurous' 等;装载期注册
   *  registerModBiomeFlag,SceneMetrics 派生 modBiomes 旗) */
  biomeFlag?: string;
}

/** L1 NPC 内容(content/npcs/*.json)。原版 VanillaNpc 形子集;id 走 800+。
 *  aiStyle 复用原版已移植 AI 核(Enemy.ts switch);自定义 AI=L2。 */
export interface ModNpcContent {
  key: string;
  name: string;
  aiStyle: number;
  lifeMax: number;
  damage: number;
  defense: number;
  knockBackResist?: number;
  width?: number; height?: number;
  frames?: number;
  /** 行走帧回卷上界 extra(ExtraFramesCount 语义;仅 townNPC 消费)。
   *  缺省启发式 max(2, frames−16)——人形族 14 帧行走区(2..frames−extra−1)惯例;
   *  自制帧表请显式声明(frames=26 → 10) */
  extraFrames?: number;
  scale?: number;
  friendly?: boolean; townNPC?: boolean;
  noGravity?: boolean; noTileCollide?: boolean;
  critter?: boolean;
  /** ★刀2-C1:声明帧率(tick/帧;缺省 6t=vanillaFrameIdx 通用档;AI 写
   *  customFrameIdx 仍最优先) */
  frameRate?: number;
  /** ★刀2-C1:NPC glowmask(发光叠画,与本体同布局帧表;贴图 alias
   *  vanilla/NPC_Glow_<npcId>.png;drawNpcGlow 查表) */
  glowmask?: { texture: string };
  /** ★刀2-C1:全亮(npcWhiteLiftQueue 捕获 ga=1,compositeLight 后全亮复绘) */
  fullbright?: boolean;
  /** ★刀3-3:死亡碎块声明(HitEffect NewGore 形;gore=本 mod content/gores 键或
   *  原版 gore id 数字;n=片数(loop);scale 缺省=1(spawnDeathGore 缺省档,
   *  ★红队 R3-m3 勘正:vanillaScale 支仅在原版表 scaleExpr 条目,声明形不暴露) */
  deathGore?: Array<{ gore: string | number; n?: number; scale?: number }>;
  HitSound?: string;
  DeathSound?: string | null;
  /** 价值(金币掷,原版 npcvalue 语义) */
  value?: number;
  /** 简单掉落表(chance 0-1;缺省 1)。item:本 mod 物品键 或 原版 vid 数字串(P7)。
   *  bossBag:1=专家档掉袋(BossBag=DropBasedOnExpertMode(DropNothing,1×bag);零值袋) */
  drops?: Array<{ item: string | number; min?: number; max?: number; chance?: number; bossBag?: number }>;
  /** ★CalPlayer 基建(六十四刀):接触命中玩家施加 debuff(OnHitPlayer AddBuff 形;
   *  buff=本 mod sw.buff 键,duration=秒,chance 0-1 缺省 1;实扣>0 才授) */
  onHitPlayer?: { buff: string; duration: number; chance?: number };
  /** ★B7 一百零八刀:自然生成行(zone=vanilla 群系键;water=水域门;mult=权重倍;
   *  无声明=不自然刷。灾厄群系门件=世界生成接入后启用) */
  spawn?: { zone?: string; water?: boolean; mult?: number; maxCount?: number; depth?: { min: number; max: number }; requireFlags?: string[]; blockFlags?: string[] }
    | Array<{ zone?: string; water?: boolean; mult?: number; maxCount?: number; depth?: { min: number; max: number }; requireFlags?: string[]; blockFlags?: string[] }>;   // ★二百八十八刀:多规则 OR 档(PerforatorCyst 三层血量门族)
  /** ★P8:Boss 位(血条/Boss 槽/掉落锚定;三消费点 VANILLA_BOSS_IDS.has 直亮) */
  boss?: boolean;
  /** ★P8:SetDefaults alpha 语义(出生透明度/渐显;透传 VanillaNpc.alpha) */
  alpha?: number;
  /** ★P8:behindTiles(钻地族被前景方块遮挡;透传 VanillaNpc.behindTiles) */
  behindTiles?: boolean;
  /** ★P8:蠕虫链声明(头条目专用;body×bodyCount + tail,原版 87/454 spec 同构)。
   *  声明后自然生成/F6/召唤三条建链路自动建链(mod 头 800+) */
  worm?: { body: string; tail: string; bodyCount: number };
  /** 贴图(textures/ 相对路径;NPC_<id>.png 语义) */
  texture?: string;
  /** 头贴(textures/ 相对路径;24×24,NPC_Head_{idx} 语义——住房UI行/地图图标/旗帜)。
   *  仅 townNPC 消费;索引由注册面自增分配 */
  head?: string;
  /** 对话头像(textures/ 相对路径;Detailed 模式 <img> 用,mod 包内 png 走 blob
   *  objectURL;CloseUp/Retro 用本体帧 0 现算,与本字段无关) */
  portrait?: string;
  /** 入驻条件(townNPC 消费;全缺省=不在场即候选;条件 AND) */
  arrival?: ModTownArrivalSpec;
}

/** P2 弹幕内容(content/projectiles/*.json)。数据 spec=ModProj 内置缺省行为参数;
 *  代码钩(update/onHit 族)经 entry 的 sw.projectileHook 追加。projId 2000+ 段。 */
export interface ModProjContent {
  key: string;
  /** 贴图 textures/ 相对路径(Projectile_<projId>.png 语义) */
  texture: string;
  gravity?: number;
  lifetime?: number;
  /** 穿透次数(缺省 1;≤0=无限) */
  pierce?: number;
  tileCollide?: boolean;
  width?: number;
  height?: number;
  rotateToVelocity?: boolean;
  /** ★三百三十:追踪 profile(homing accel/距离门;分类器回填) */
  homing?: number;
  homingDist?: number;
  /** ★五百八十五:竖排帧数(贴图高=frames×单帧高;绘制按 (ageTicks/6)%frames 切行;
   *  缺省 1=整图) */
  frames?: number;
  /** ★619-R3F13:帧节奏(tick/帧;缺省 6) */
  frameRate?: number;
  /** ★五百八十五:同敌重击窗(tick;命中记录按 ageTicks 过期=常驻召唤体可再命中;
   *  缺省 0=永久去重) */
  hitRefresh?: number;
  /** ★618-R2F9:接触伤害豁免(healer/defense 守卫;C# CanDamage=false 同位) */
  noContactDamage?: boolean;
  /** ★刀2-C1:A=0 纯加性(XNA 预乘恒等式='lighter'+ga=1;拖尾/光晕族) */
  additive?: boolean;
  /** ★刀2-C1:全亮(projFullbrightQueue 乘光后重绘;引导光族) */
  fullbright?: boolean;
  /** ★刀2-C1:画在玩家之后(drawLayer 4/7/8 族=PROJ_DRAW_OVER_PLAYERS 同槽) */
  overPlayers?: boolean;
  /** ★三百五十一:holdout(channel 魔耗面;声明面直通) */
  holdout?: { manaRate?: number; manaCost?: number };
}

/** P3 商店上架(content/shops.json)。npcId=原版 NPC id(城镇商);price 缺省=物品
 *  value(与原版 shopstock price:null→value 语义同相)。 */
export interface ModShopContent {
  npcId: number | string;   // ★三百十七:string=npcKey(解析走 allocation.npcs)
  items: Array<{ item: string | number; price?: number }>;
}

/** L1 buff 内容(content/buffs/*.json)。BuffType 运行时追加域(9000+ 伪 vanilla);
 *  声明面=名称/贴图/debuff 位;Update 逻辑=代码钩(B6 OnHit/弹幕 debuff 连锁前置)。 */
export interface ModBuffContent {
  key: string;
  name?: string;
  /** 图标(textures/ 相对路径;必填——buff 栏全链依赖) */
  texture: string;
  /** B6 数据面:NPC 侧每秒伤害(dot;OnHit/弹幕 debuff 施加后的可见效果) */
  npcDps?: number;
}

/** L1 配方(content/recipes.json)。VanillaRecipe 形(vid 域=本 mod 物品 stable id/
 *  原版 vid 混用——配方消费面按内部 id 求值,mod stable id 天然同域)。 */
export interface ModRecipeContent {
  create: string;            // 本 mod 物品键
  createStack?: number;
  /** 站点:原版 TileID(-1=徒手);或本 mod tile 键 */
  tile?: number | string;
  items?: Array<{ item: string; stack: number }>;   // item=本 mod 键或原版 vid 数字串
  /** 原版物品材料:vid 数字(与 mod 键混用) */
  vanillaItems?: Array<{ id: number; stack: number }>;
  water?: boolean; honey?: boolean; lava?: boolean;
}

// ================= ID 分配域(design.md §2) =================
/** mod 物品 stable 段基址(plan-A 恒等域扩展段;硬顶 65535=Uint16Array 上限) */
export const MOD_ITEM_STABLE_BASE = 30000;
/** mod tile stable 段基址(PRIV_TILE_STABLE 表尾 1029 之后;硬顶 2047) */
export const MOD_TILE_STABLE_BASE = 1030;
/** mod NPC id 段基址(原版 Count=697;成就门 vanillaId<697=原版域边界) */
export const MOD_NPC_ID_BASE = 800;
/** mod 弹幕 projId 段基址(原版 1457 至 1135;2000+ 留缓冲;弹域无硬表上限——
 *  Arrow/碰撞/绘制全按值查表,缺表=默认行为) */
export const MOD_PROJ_ID_BASE = 2000;
/** mod buff 伪 vanillaBuff 段基址(BuffType 运行时另配;图标键 Buff_<伪id> 走
 *  mods/buffs.ts 的 objectURL 覆盖,不落 /sprites/vanilla) */
export const MOD_BUFF_VANILLA_BASE = 9000;
/** mod 稀有度档 id 段基址(★刀3-1:原版 rare 值域 -13..10,词缀档位移可达 11
 *  (Item.Prefix clamp 上限=原版紫档域)——12 起为 mod 档(对齐 tML 灾厄 12/13 惯例);
 *  硬顶 254) */
export const MOD_RARITY_ID_BASE = 12;
/** mod gore id 段基址(★刀3-3。★红队 R3-C1 段位修正:伪锚「原版 max=696」实为
 *  NPC Count=697 误搬——原版 gore id 空间实到 1406(vanilla-gore.json _meta.tex
 *  键域 1..1406,1404 张 Gore_*.png,死亡表项直引 697-1406),697 起段会劫持
 *  原版 Gore_697+ 贴图/碰撞盒/物理家族。基址 1500=1406+缓冲) */
export const MOD_GORE_ID_BASE = 1500;
/** mod 墙 stable 段基址(★刀3-墙:原版 WALL_DEFS id 0-366 连续 367 条实测;u16
 *  存档通道原生兼容;硬顶 4095=对齐 tile 段纪律) */
export const MOD_WALL_STABLE_BASE = 367;
/** mod 墙段硬顶(u16 内;溢出 fail-fast) */
export const MOD_WALL_STABLE_MAX = 4095;
/** mod 坐骑 id 段基址(★第三批:原版 MOUNT_COUNT=66,ids 0-65) */
export const MOD_MOUNT_STABLE_BASE = 66;
/** mod 坐骑段硬顶(矿车/ability 后置,首刀只接非矿车声明族) */
export const MOD_MOUNT_STABLE_MAX = 200;
/** mod 发型 id 段基址(★第三批:原版 HAIR_COUNT=228,ids 0-227;byte 域顶 255) */
export const MOD_HAIR_BASE = 228;
/** mod 发型段硬顶(byte 域=存档 1 字节;255-228=28 个 mod 发型槽) */
export const MOD_HAIR_MAX = 255;
/** mod 尘埃 type 段基址(★第四批:原版 VanillaDust ~355 type 用满;400 留缓冲) */
export const MOD_DUST_TYPE_BASE = 400;
/** mod 尘埃段硬顶(6000 池容量无关=type 只是标签;硬顶 1000) */
export const MOD_DUST_TYPE_MAX = 1000;

/** id 分配快照(确定性:拓扑序 + mod id 字典序 + mod 内键字典序) */
export interface ModIdAllocation {
  /** 全物品键 `mod_<modid>_<key>` → stable id */
  items: Map<string, number>;
  /** 全 tile 键 `mod_<modid>_<key>` → stable id */
  tiles: Map<string, number>;
  /** 全 NPC 键 `mod_<modid>_<key>` → npc id */
  npcs: Map<string, number>;
  /** 全弹幕键 `mod_<modid>_<key>` → projId(P2;2000+ 段) */
  projs: Map<string, number>;
  /** 全 buff 键 `mod_<modid>_<key>` → 伪 vanilla id(B6 声明 buff;9000+ 段) */
  buffs: Map<string, number>;
  /** 全稀有度键 `mod_<modid>_<key>` → 档 id(★刀3-1;12+ 段) */
  rarities: Map<string, number>;
  /** 全 gore 键 `mod_<modid>_<key>` → gore id(★刀3-3;1500+ 段) */
  gores: Map<string, number>;
  /** 全墙键 `mod_<modid>_<key>` → wall id(★刀3-墙;367+ 段) */
  walls: Map<string, number>;
  /** 全坐骑键 `mod_<modid>_<key>` → mount id(★第三批;66+ 段) */
  mounts: Map<string, number>;
  /** 全发型键 `mod_<modid>_<key>` → hair id(★第三批;228-255 段) */
  hairs: Map<string, number>;
  /** 全尘埃键 `mod_<modid>_<key>` → dust type(★第四批;400+ 段) */
  dusts: Map<string, number>;
}

/** 注册计划(plan 纯数据 → register.ts 消费;loader 与数据模块解耦) */
export interface RegistrationPlan {
  mods: Array<{ manifest: ModManifest; pack: ModPack }>;
  /** 拓扑序(依赖在前) */
  order: string[];
  allocation: ModIdAllocation;
  itemSpecs: Array<{ modId: string; spec: ModItemContent; stableId: number; fullKey: string }>;
  tileSpecs: Array<{ modId: string; spec: ModTileContent; stableId: number; fullKey: string }>;
  npcSpecs: Array<{ modId: string; spec: ModNpcContent; npcId: number; fullKey: string }>;
  projSpecs: Array<{ modId: string; spec: ModProjContent; projId: number; fullKey: string }>;
  shops: Array<{ modId: string; spec: ModShopContent }>;
  recipes: Array<{ modId: string; spec: ModRecipeContent }>;
  /** B6:声明 buff 计划(确定性伪 vanilla id 已分配) */
  buffSpecs: Array<{ modId: string; spec: ModBuffContent; pseudoVanilla: number; fullKey: string }>;
  /** ★刀3-1:mod 稀有度档色计划(12+ 段;先于 itemSpecs 消费) */
  raritySpecs: Array<{ modId: string; spec: ModRarityContent; rarityId: number; fullKey: string }>;
  /** ★刀3-3:mod gore 计划(1500+ 段;NPC deathGore 引用解析依赖) */
  goreSpecs: Array<{ modId: string; spec: ModGoreContent; goreId: number; fullKey: string }>;
  /** ★刀3-墙:mod 墙计划(367+ 段;先于 itemSpecs——placeWall 引用解析依赖) */
  wallSpecs: Array<{ modId: string; spec: ModWallContent; wallId: number; fullKey: string }>;
  /** ★第三批:mod 坐骑计划(66+ 段;先于 itemSpecs——mountItem 引用解析依赖) */
  mountSpecs: Array<{ modId: string; spec: ModMountContent; mountId: number; fullKey: string }>;
  /** ★第三批:mod 发型计划(228-255 段) */
  hairSpecs: Array<{ modId: string; spec: ModHairContent; hairId: number; fullKey: string }>;
  /** ★第四批:mod 尘埃计划(400+ 段) */
  dustSpecs: Array<{ modId: string; spec: ModDustContent; dustType: number; fullKey: string }>;
  /** ★成就域 L1 面(2026-10-22):content/achievements/*.json(纯条件成就零脚本)。
   *  无 id 分配——全键即存档名;register 期经 collectModAchievement 与
   *  sw.achievement 脚本路径合流(跨形态同键 fail-fast)。 */
  achSpecs: Array<{ modId: string; key: string; spec: ModAchievementSpec }>;
}

/** 解析后的 mod 包(zip 展开) */
export interface ModPack {
  manifest: ModManifest;
  /** 相对路径(如 'content/items/sword.json'/'textures/x.png')→ 字节 */
  files: Map<string, Uint8Array>;
  /** ★包根 icon.png(2026-10-13 模组面板重构):dataURL(缺省 null)——面板行图标 */
  iconDataUrl?: string | null;
}

/** 装载结果(UI 面板/日志/存档头消费) */
export interface ModLoadResult {
  loaded: Array<{ manifest: ModManifest; counts: { items: number; tiles: number; npcs: number; projs: number; recipes: number; buffs: number } }>;
  errors: Array<{ modId: string; error: string }>;
  allocation: ModIdAllocation | null;
}

/** 存档头 mod 清单项(serialize SaveData.mods 可选键)。
 *  ★P5 id 平移完整解:itemIds/tileIds=存档期分配映射(fullKey→stableId)——读档
 *  构建 savedStable→currentStable 重映射,卸/换前排位 mod 时后位 mod 内容不错位
 *  (缺键=内容已移除→既有 ??0 占位语义)。 */
export interface SaveModEntry {
  id: string;
  version: string;
  items: number; tiles: number; npcs: number;
  itemIds?: Array<[string, number]>;
  tileIds?: Array<[string, number]>;
}
