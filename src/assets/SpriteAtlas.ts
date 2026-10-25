// ★破环（2026-09-04）：AssetCache.ts:21 反向 import 本文件 VANILLA_MISC，静态互引在
//  SpriteAtlas 为环入口时，AssetCache 模块体 priorityPlan() 求值期触碰 TDZ 崩
//  （"VANILLA_MISC is not iterable"，所有拉游戏图的 vitest 导入期炸）。swTrace 是
//  纯日志面 → 懒载破环，首调时动态取回。
let swTraceLazy: ((msg: string) => void) | null = null;
const swTrace = (msg: string): void => {
  if (swTraceLazy) { swTraceLazy(msg); return; }
  void import('../net/AssetCache').then((m) => { swTraceLazy = m.swTrace; swTraceLazy(msg); }).catch(() => {});
};
// ★Maples 双轨渲染体系全退役刀1④（2026-10-17）：Unity 素材图集面（atlas.json/
// resources.json/annotations.json/地形·角色 png + rect/animFrames/loadAtlasFile/
// load/preloadMaplesWorld/hardAlpha/images 表）随域全删——audit 2026-10-16 定谳:
// 三「活」函数被烘焙链三重短路挡死+运行时探针 rectTally 全 0/autotilerTally 空;
// 唯一活面=Player.png 兜底(刀0 已换默认纸娃娃)与 NPC_2/3/4/81 敌怪支(⑤已删)。
// 本文件自此只承载原版素材命名空间（vanilla/vanilla-ui/图集子矩形/懒加载链）。
// 原版素材由 scripts/vanilla-atlas.mjs 生成（public/sprites/vanilla.json，独立命名空间、无 Unity y 翻转）
import vanillaJson from '../../public/sprites/vanilla.json';
import vanillaNpcsJson from '../../public/sprites/vanilla-npcs.json';
import vanillaUiJson from '../../public/sprites/vanilla-ui.json';

/** npc id → 动画帧数（SetDefaults 提取数据派生；懒加载 NPC 表用） */
const vanillaNpcFrames: Record<string, number> = Object.fromEntries(
  Object.entries(vanillaNpcsJson as Record<string, { frames?: number }>).map(([k, v]) => [k, v.frames ?? 1]),
);

export interface SpriteRect { name: string; x: number; y: number; w: number; h: number; }
export interface SpriteRef { file: string; sprite: string; }
export interface RuleDef {
  id: number;
  sprites: SpriteRef[];
  neighbors: number[];
  positions: Array<[number, number]>;
  transform: number;
  output: number;
}
export interface RuleTileDef { defaultSprite: SpriteRef | null; tilingRules: RuleDef[]; }

export interface AtlasFile { guid: string; sprites: SpriteRect[]; idToName: Record<string, string>; }
export interface AtlasData {
  files: Record<string, AtlasFile>;
  guidToFile: Record<string, string>;
}
export interface ResourcesData {
  items: Array<{ name: string; type: string; iconGuid: string | null; placeTile: string | null; funcList: string }>;
  tiles: Array<{ name: string; tileGuid: string; layer: string; digList: string; digTime: string; dropItemGuid: string }>;
  potions: Array<{ name: string; type: string; iconGuid: string | null; buffType: number | null; duration: number | null; isHealType: string }>;
  accessories: Array<{ name: string; type: string; iconGuid: string | null }>;
  buffs: Array<{ name: string; iconGuid: string | null }>;
  anims: Record<string, SpriteRef[]>;
  rules: Record<string, RuleTileDef>;
}

export interface DrawRect { img: ImageBitmap | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas; sx: number; sy: number; sw: number; sh: number; }

// ---- 原版素材命名空间（vanilla.json，TEdit 数据驱动） ----

// 进图必预载的杂项单图(2026-08-13 大瘦身 304→88):
// 保留两类——①chunk 静态烘焙消费(树冠/树枝/树干/仙人掌/蘑菇顶):晚到要等
// invalidateAll 重烘焙,fallback 会烤进 chunk,必须预载;②液体渲染首帧可见
// (水/岩浆/蜂蜜/微光的基础四张+瀑布三张):首帧闪素色不可接受。
// 其余全部移除转懒加载:NPC_Head 旗帜头像(vmisc)/链条与 Boss 部件叠画(vmisc)/
// Glow 叠画(ensureVImage)/机关弹幕(弹幕渲染懒加载)/导线图集(ensureVImage)/
// 月总手与光之女皇部件(vmisc)/Misc_Perlin——消费方全部每帧活画,ensureVImage
// 未就绪跳帧、下帧自愈。注意 NPC_Head 此前 121 张盲扫 id 0-120,其中 81-120
// 磁盘上不存在(真文件 0-80 + 独立命名的 NPC_Head_Boss_N)= 每次进图 40 个 404。
/** ★BJ705-C(2026-10-22)敌怪/城镇 NPC 绘制路径部件散件全集(用户问「BJ705-A 是否
 *  代表其它独立加载贴图都有同问题」的家族普查收口)。判别锁探针
 *  scripts/_bj705c-nullwindow-census.mjs 六员实证(强制失败窗,采样区部分变化=
 *  本体仍在):WoF 墙身 0.42/Prime 臂骨 0.56/光女翼 0.37/月总头 0.04/鹿角怪雾
 *  0.25/蚁狮下体 0.39——「部件缺/本体在」不对称假体与 BJ705-A 同根:
 *  · 机制=NPC 本体(NPC_{id}.png 主表,BJ636 预载+BJ705-A 回扫)与部件散件
 *    (Extra_/Glow_/Chain_/专属 png,首绘懒加载)走【两条重试钟】——发布形态
 *    SW/CDN 空窗内逐文件命中态漂移=任意混搭的假体窗(有眼无墙/飘臂/无翼)。
 *  · 本表=敌怪绘制路径消费的部件差集(Renderer.drawEnemy 树+npcExtraParts+
 *    NPC_GLOW/ORBIT 表逐位提取,vs 预载面);弹幕/尘/gore/玩家配饰/UI 域不收
 *    (本体亦懒=同钟双缺 BJ636 类,判语销案见 memory/bj705c-asset-window-census.md)。
 *  · 全部已在 SW P2 暖存面(miscVanilla)——入 P1 只改取件时序,零增量流量;
 *    本体域 3.17MB,本表 ~0.55MB(+17%)。经 VANILLA_MISC 自动进 BJ705-A 回扫集。 */
export const VANILLA_ENEMY_PARTS: readonly string[] = [
  // — 链族/臂骨(本体门前独立门:本体缺席窗内链照画=「断链/飘臂」假体) —
  'vanilla/Arm_Bone_2.png',    // Prime 部件臂骨 127-131(Main.cs:22633-22675,与 BJ705-A 四员同构)
  'vanilla/Chain4.png', 'vanilla/Chain5.png', 'vanilla/Chain14.png', // aiStyle13 藤蔓(通用/56/175)
  'vanilla/Chain10.png', 'vanilla/Chain11.png',   // Clinger 101 交替链
  'vanilla/Chain12.png',       // 双子互连 125/Mechdusa 蛇发/WoF 肌腱链+狂卷之舌
  'vanilla/Chain21.png',       // 石巨人拳链 247/248
  'vanilla/Chain24.png', 'vanilla/Chain25.png',   // 259/260 亮彩藤(含 drawBrightVines 光照后通道)
  'vanilla/Chain26.png', 'vanilla/Chain27.png',   // 世纪之花钩蔓/触须 263/264
  // — NPC_{id} 主表派生集之外的「本体」贴图(失败窗=本体级假体) —
  'vanilla/WallOfFlesh.png',   // WoF 墙身(113 头/114 饥饿者在主表——窗=「有眼无墙」)
  'vanilla/AntlionBody.png',   // 蚁狮 69 下体(门在 if(r) 内:头在体缺)
  'vanilla/Ninja.png',         // 史莱姆王 50 体内忍者
  'vanilla/DukeFishron.png',   // 猪鲨 370 二阶段金身叠层(npcExtraParts)
  'vanilla/Chaos.png',         // 混沌元素 120 残影(npcExtraParts)
  // — 专属绘制支部件(drawEnemy 早退分支内的独立门) —
  'vanilla/Extra_157.png', 'vanilla/Extra_158.png', 'vanilla/Extra_159.png',
  'vanilla/Extra_160.png', 'vanilla/Extra_187.png', 'vanilla/Extra_188.png', // 光女 636 双翼/施法臂/冠
  'vanilla/Extra_13.png', 'vanilla/Extra_14.png', 'vanilla/Extra_15.png',
  'vanilla/Extra_16.png', 'vanilla/Extra_17.png', 'vanilla/Extra_18.png',
  'vanilla/Extra_19.png', 'vanilla/Extra_25.png', 'vanilla/Extra_26.png',
  'vanilla/Extra_29.png',      // 月总 396 头/397 手/398 核心/400 游离眼
  'vanilla/Extra_40.png', 'vanilla/Extra_41.png', 'vanilla/Extra_42.png',
  'vanilla/Extra_43.png', 'vanilla/Extra_44.png', 'vanilla/Extra_45.png', // 荷兰飞盗船 491 旗/桨/帆
  'vanilla/Extra_177.png', 'vanilla/Extra_185.png', 'vanilla/Extra_186.png', // 史后 657 王冠/水晶核
  'vanilla/Extra_245.png',     // 鹿角怪 668 红雾环/前雾
  'vanilla/Extra_39.png',      // 史莱姆王 50 金冠
  'vanilla/Extra_76.png',      // 546 怒滚草亮核
  'vanilla/Extra_27.png', 'vanilla/Extra_30.png', 'vanilla/Extra_55.png',
  'vanilla/Extra_57.png', 'vanilla/Extra_59.png', 'vanilla/Extra_80.png',
  'vanilla/Extra_81.png', 'vanilla/Extra_82.png', 'vanilla/Extra_89.png',
  'vanilla/Extra_129.png', 'vanilla/Extra_289.png', // npcExtraParts 族(探测器束/邪教徒符印/陨石火怪拖尾等)
  'vanilla/Extra_51.png', 'vanilla/Extra_52.png', 'vanilla/Extra_53.png',
  'vanilla/Extra_72.png', 'vanilla/Extra_263.png', 'vanilla/Extra_264.png',
  'vanilla/Extra_265.png',     // 城镇 NPC 部件(施法光环/持枪手 overlay/派对帽/电工头饰/微光变体)
  'vanilla/Extra_199.png',     // 召唤鞭锁定标记(敌怪身上的目标环)
  'vanilla/HealthBar1.png', 'vanilla/HealthBar2.png', // boss 血条(实体绘制路径)
  // — GlowMask 族(NPC_GLOW + NPC_GLOW_ORBIT 表 + 特定位;门在 if(r) 内=缺件仅亮度衰减) —
  'vanilla/Extra_20.png', 'vanilla/Extra_56.png', 'vanilla/Extra_98.png',
  'vanilla/Bone_Laser.png', 'vanilla/Dest1.png', 'vanilla/Dest2.png', 'vanilla/Dest3.png',
  'vanilla/Eye_Laser.png', 'vanilla/Probe.png',
  'vanilla/Glow_11.png', 'vanilla/Glow_31.png', 'vanilla/Glow_32.png', 'vanilla/Glow_33.png',
  'vanilla/Glow_34.png', 'vanilla/Glow_48.png', 'vanilla/Glow_49.png', 'vanilla/Glow_50.png',
  'vanilla/Glow_100.png', 'vanilla/Glow_101.png', 'vanilla/Glow_108.png', 'vanilla/Glow_109.png',
  'vanilla/Glow_110.png', 'vanilla/Glow_132.png', 'vanilla/Glow_133.png', 'vanilla/Glow_134.png',
  'vanilla/Glow_135.png', 'vanilla/Glow_136.png', 'vanilla/Glow_137.png', 'vanilla/Glow_138.png',
  'vanilla/Glow_139.png', 'vanilla/Glow_141.png', 'vanilla/Glow_142.png', 'vanilla/Glow_143.png',
  'vanilla/Glow_144.png', 'vanilla/Glow_145.png', 'vanilla/Glow_146.png', 'vanilla/Glow_147.png',
  'vanilla/Glow_149.png', 'vanilla/Glow_150.png', 'vanilla/Glow_151.png', 'vanilla/Glow_152.png',
  'vanilla/Glow_153.png', 'vanilla/Glow_154.png', 'vanilla/Glow_155.png', 'vanilla/Glow_156.png',
  'vanilla/Glow_157.png', 'vanilla/Glow_158.png', 'vanilla/Glow_159.png', 'vanilla/Glow_160.png',
  'vanilla/Glow_161.png', 'vanilla/Glow_162.png', 'vanilla/Glow_163.png', 'vanilla/Glow_164.png',
  'vanilla/Glow_165.png', 'vanilla/Glow_166.png', 'vanilla/Glow_167.png', 'vanilla/Glow_169.png',
  'vanilla/Glow_170.png', 'vanilla/Glow_171.png', 'vanilla/Glow_172.png', 'vanilla/Glow_224.png',
  'vanilla/Glow_225.png', 'vanilla/Glow_226.png', 'vanilla/Glow_239.png', 'vanilla/Glow_253.png',
  'vanilla/Glow_254.png', 'vanilla/Glow_255.png', 'vanilla/Glow_286.png', 'vanilla/Glow_287.png',
  'vanilla/Glow_288.png', 'vanilla/Glow_290.png', 'vanilla/Glow_360.png',
];

export const VANILLA_MISC = [
  // ① chunk 烘焙族
  // 开关换 tile 对(全部跨表,开门/开栅态世界生成极罕见→表常未载→重烘跳格=消失~1s;
  // 2026-08-13 用户报地牢门,全族排查:门 10↔11/高门 388↔389/活板门 387↔386/格栅 557↔558)
  'vanilla/Tiles_10.png', 'vanilla/Tiles_11.png',
  'vanilla/Tiles_386.png', 'vanilla/Tiles_387.png', 'vanilla/Tiles_388.png', 'vanilla/Tiles_389.png',
  'vanilla/Tiles_557.png', 'vanilla/Tiles_558.png',
  ...Array.from({ length: 32 }, (_, i) => `vanilla/Tree_Tops_${i}.png`),
  ...Array.from({ length: 32 }, (_, i) => `vanilla/Tree_Branches_${i}.png`),
  ...Array.from({ length: 7 }, (_, i) => `vanilla/Tiles_5_${i}.png`),
  'vanilla/Tiles_323.png', 'vanilla/Tiles_72.png',  // 棕榈/发光蘑菇树干(群系专属但极小,常驻防传送闪失)
  'vanilla/Evil_Cactus.png', 'vanilla/Good_Cactus.png', 'vanilla/Crimson_Cactus.png',
  'vanilla/Shroom_Tops.png',
  // ①-bis 刺球锚链面(70 常刷于地牢,玩家首见=零预热情景;各 ~300B,同上防首帧闪失
  // ——drawSpikeBallChain 的 Chain/锚座 Spike_Base,红蓝对抗 2026-09-02 定谳补)
  'vanilla/Chain.png', 'vanilla/Spike_Base.png',
  // ② 液体首帧必需(其余 waterStyle 变体由 VanillaLiquidRenderer/WaterfallRenderer
  //    的 ensureVImage 活画路径按当前样式自取)
  'vanilla/Liquid_0.png', 'vanilla/Liquid_1.png', 'vanilla/Liquid_11.png', 'vanilla/Liquid_14.png',
  'vanilla/Misc_water_0.png', 'vanilla/Misc_water_1.png', 'vanilla/Misc_water_11.png', 'vanilla/Misc_water_14.png',
  'vanilla/Waterfall_0.png', 'vanilla/Waterfall_1.png', 'vanilla/Waterfall_14.png',
  // ③ boss 部件散件（★BJ705-A 2026-10-22:BJ636 NPC 主表预载的部件漏员）。这些是
  //    drawEnemy 专绘支的附属贴图（loadBitmapOnly 独立通道,不在 NPC_{id}.png 主表
  //    派生集内）——首次首见才懒加载,SW/CDN 空窗期失败=部件缺席窗;与本体表
  //    （主表预载,失败走回扫）不同拍=「本体在/部件缺」或「本体缺/部件在」的
  //    假体窗。全 4 张均为小散件（≤~10KB）,常驻零成本。
  //    · 36 骷髅王手两节臂骨 Arm_Bone / Red Hat 族 Arm_Bone_3（Main.cs:22543-22596）
  //    · 327 南瓜王披风 PumpkingCloak（:22499-22506）/ 328 双刃臂 PumpkingArm
  //      （:22508-22542）——用户实报「南瓜王被暗黑收割者抽打后头部变透明」
  //      定谳=资产窗假体（详见 preloadMiscAndNpcs 回扫注）,本批部件侧收口。
  'vanilla/Arm_Bone.png', 'vanilla/Arm_Bone_3.png',
  'vanilla/PumpkingCloak.png', 'vanilla/PumpkingArm.png',
  //    · 327/325 表情贴图 PumpkingFace/TreeFace（★BJ707-G29,G26 债②清偿:BJ705-G26
  //      件2 后绘 extras 表情叠画的懒载面——npcWhiteLiftQueue 消费侧 ensureVImage
  //      10s TTL 自愈通道承载,首见迟数拍;boss 表情装饰面入暖存免首帧闪缺）
  'vanilla/PumpkingFace.png', 'vanilla/TreeFace.png',
  // ④ 敌怪/NPC 绘制路径部件散件全集(★BJ705-C 2026-10-22 家族普查,表头注判别锁)
  ...VANILLA_ENEMY_PARTS,
];
export interface VanillaTileMeta {
  name: string; key: string; sheet: string;
  solid: boolean; blend: boolean; framed: boolean; light: boolean;
  color: string; placement: string | null;
  grid: [number, number];      // 帧像素尺寸（蜡烛类 [16,20]）
  stride: [number, number];    // 表内帧步长（grid+gap，如 [18,18]）
  frameSize: Array<[number, number]>; // 每个 style 的占格数
  cols: number; rows: number;
  isStone?: boolean; isGrass?: boolean; mergeWith?: number | null;
}
export interface VanillaItemMeta {
  name: string; key: string; icon: string; createTile: number | null;
  /** 图集子矩形(vanilla-atlas.mjs shelf-pack 后携带;旧单体条目无此组) */
  ix?: number; iy?: number; iw?: number; ih?: number;
}
export interface VanillaWallMeta {
  name: string; key: string; sheet: string; color: string;
  grid: [number, number]; stride: [number, number]; cols: number; rows: number;
  largeFrame?: number;
}
// NPC 贴图表（纵向帧条：小动物等）
export interface VanillaNpcMeta { sheet: string; frameW: number; frameH: number; count: number; }
export interface VanillaData {
  tiles: Record<string, VanillaTileMeta>;
  items: Record<string, VanillaItemMeta>;
  walls: Record<string, VanillaWallMeta>;
  npcs?: Record<string, VanillaNpcMeta>;
  tileNames?: Record<string, string>;  // 全量原版 tile id → 英文名（兼容报告用）
  itemNames?: Record<string, string>;
  /** 盔甲贴图槽位序号（Armor_Head/Armor_Armor/Armor_Legs 的索引，非物品 id） */
  armorIndex?: Record<string, { head: number; body: number; legs: number }>;
}

/** vui 键失配登记(运行期防线,2026-08-13;2026-08-14 精细化):
 *  二分类——【设计内回退查询】静默登记(仍入 F5 assetHealth 供审计);
 *  【真失配】详细 warn+调用点定位。判别:Paper_{v}_{n} 女性变体缺通道回退男体
 *  =PaperDoll.sheetRect 的正常路径,画面正确,不该刷屏。 */
const _vuiKeyMisses = new Set<string>();
const _vuiFallbackMisses = new Set<string>();
/** 设计内回退查询的键形态(命中即静默) */
const VUI_FALLBACK_SAFE: Array<RegExp> = [
  /^Player_\d+_\d+\.png$/,        // 纸娃娃变体通道回退(sheetRect ?? Player_0_N)
  /^Armor_Head_\d+\.png$/,         // 头甲可选槽(0=无头盔查询)
];
function vuiKeyMiss(name: string): void {
  const isFallback = VUI_FALLBACK_SAFE.some((re) => re.test(name));
  if (isFallback) { _vuiFallbackMisses.add(name); return; }  // 静默:F5 仍可见
  if (_vuiKeyMisses.has(name)) return;
  _vuiKeyMisses.add(name);
  // 调用点(首帧非本模块处)辅助定位:错误栈在此不可靠,给最近消费提示
  const near = _lastVuiConsumer ? ` 最近消费:最近一次 vui() 前 3 帧@${_lastVuiConsumer}` : '';
  console.warn(
    `[vui失配] '${name}' — 清单无此键。检查:①须带 .png 后缀 ②键拼写(vanilla-ui.json 为准) ` +
    `③若是新素材先跑 node scripts/vanilla-atlas.mjs 重建清单${near}`,
  );
}
/** vui() 调用方上下文记录(失配时给"谁在查"线索;只留最近 3 个消费点) */
const _vuiConsumerRing: string[] = [];
let _lastVuiConsumer = '';
export function noteVuiConsumer(where: string): void {
  _lastVuiConsumer = where;
  _vuiConsumerRing.push(where);
  if (_vuiConsumerRing.length > 3) _vuiConsumerRing.shift();
}

/** 驱逐 SW 资产缓存中该文件的条目(best-effort,失败静默——dev 无 SW 时
 *  caches API 仍可写,但无人读它,无副作用)。贴图加载失败时调用,让 TTL
 * 重试能拿到网络新字节而非同一份缓存毒。
 *  ★双门(2026-09-04 线上实锤"cache 逐会话缩水 12060→11966,丢的恰是天空族"):
 *  ①SW 未控制页面(controller 空窗/reload 后)时 Image 直连网络必 404(prune
 *  散件),此因触发 onerror 会把【缓存里完好的条目】当毒删掉=自毁循环(每会话
 *  空窗删一批,累计 94 条)——controller 缺席绝不驱逐;
 *  ②驱逐前 match 命中才删(miss=本无可删,更不该误伤)。 */
export function evictSwCacheEntry(file: string): void {
  if (typeof caches === 'undefined') return;
  if (!navigator.serviceWorker?.controller) return;   // 门①:SW 缺席=失败原因不在缓存
  const url = new URL('sprites/' + encodeURI(file), location.href).href;
  void (async () => {
    try {
      let deleted = 0;
      for (const name of await caches.keys()) {
        if (!name.startsWith('sw-assets-v')) continue;
        const c = await caches.open(name);
        const hit = await c.match(url);
        if (!hit) continue;                              // 门②:miss 本无可删
        await c.delete(url);
        deleted++;
      }
      if (deleted) swTrace(`evict ${file}(命中即删 ${deleted} 名)`);
    } catch { /* 隐私模式/权限异常忽略 */ }
  })();
}

export class SpriteAtlas {
  vanilla = vanillaJson as unknown as VanillaData;
  /** ★ImageBitmap 化(2026-08-14 根治):drawImage(HTMLImageElement) 走浏览器
   *  懒解码缓存,GPU 压力下被驱逐→静默重解码(三份 trace 14-21 万次解码风暴)。
   *  createImageBitmap = 自持已解码像素(原版 Texture2D 语义):绘制永不重解码,
   *  close() = Dispose。?bitmap=0 走旧 Image 路径(逃生门) */
  static readonly USE_BITMAP = typeof createImageBitmap === 'function'
    && !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('bitmap') && location.search.includes('bitmap=0'));
  vimages = new Map<string, ImageBitmap | HTMLImageElement>(); // 原版 PNG（干净像素，不做 hardAlpha）
  /** UI 贴图（vanilla-ui/，干净像素不 hardAlpha——UI 有抗锯齿边缘） */
  uiimages = new Map<string, ImageBitmap | HTMLImageElement>();
  private uiFiles = (vanillaUiJson as { files: Record<string, string> }).files;

  // ---- 原版素材 API（无 Unity y 翻转，按 TEdit 网格寻址） ----

  /** 原版图块元数据 */
  vmeta(sheetId: number): VanillaTileMeta | null {
    return this.vanilla.tiles[String(sheetId)] ?? null;
  }

  /** 原版图块表取帧（col,row 从 0 起）。越界/缺失返回 null */
  vframe(sheetId: number, col: number, row: number): DrawRect | null {
    const m = this.vmeta(sheetId);
    if (!m) return null;
    const img = this.ensureVImage(m.sheet);  // 懒加载兜底(正常路径 preloadVanillaWorld 已就绪)
    if (!img) return null;
    if (col < 0 || row < 0 || col >= m.cols || row >= m.rows) return null;
    return { img, sx: col * m.stride[0], sy: row * m.stride[1], sw: m.grid[0], sh: m.grid[1] };
  }

  /** 原版表内任意像素偏移取帧（style/显式帧：18px 步长的 frameX/frameY 直用） */
  vframeAt(sheetId: number, fx: number, fy: number): DrawRect | null {
    const m = this.vmeta(sheetId);
    if (!m) return null;
    // 与 vframe/vrect 同语义懒加载（ensureVImage）：place_v_* 物品图标走本方法,
    // 此前直接 vimages.get——表未载时不发加载请求,宝箱内家具类物品图标永久回退
    const img = this.ensureVImage(m.sheet);
    if (!img) return null;
    if (fx < 0 || fy < 0 || fx + m.grid[0] > img.width || fy + m.grid[1] > img.height) return null;
    return { img, sx: fx, sy: fy, sw: m.grid[0], sh: m.grid[1] };
  }

  /** 原版表内任意矩形（多格物体整体取图，如墓碑 2×2 = 34×34px） */
  vrect(sheetId: number, fx: number, fy: number, w: number, h: number): DrawRect | null {
    const m = this.vmeta(sheetId);
    if (!m) return null;
    const img = this.ensureVImage(m.sheet);
    if (!img) return null;
    if (fx < 0 || fy < 0 || fx + w > img.width || fy + h > img.height) return null;
    return { img, sx: fx, sy: fy, sw: w, sh: h };
  }

  /** 原版 NPC 贴图表取帧（纵向帧条，frameIdx 0-based）。
   *  未登记的 id 懒加载 vanilla/NPC_{id}.png（帧数来自 vanilla-npcs.json），首帧返回 null 下一帧生效 */
  private lazyNpcMeta = new Map<string, VanillaNpcMeta>();
  /** ⚠仅适用【纵向帧条】NPC 表。横向变体横条 NPC（如 594 风气球 = 8 列×32px 变体,
   *  Main.cs:23383 Frame(8,1,ai[2])）走此路径会把整条横排画出来——此类 NPC 必须
   *  在 Renderer.drawEnemy 加专属分支按列切片（见 drawWindyBalloon）。 */
  vnpc(npcId: number, frameIdx: number): DrawRect | null {
    let m: VanillaNpcMeta | undefined = this.vanilla.npcs?.[String(npcId)];
    if (!m) {
      const key = String(npcId);
      m = this.lazyNpcMeta.get(key);
      if (!m) {
        const sheet = `vanilla/NPC_${npcId}.png`;
        // ★B6 用户实报定谳:mod NPC(id≥800)不走 ensureVImage 的网络 fetch——
        //  mod 贴图由 applyModAssets 注入 vimages(异步);护栏期间 vimages 可能
        //  尚未注入 → fetch 404 → 负缓存 → 永久隐形。改为直查 vimages,
        //  命中即构 meta,未命中返回 null(下一帧自愈,注入完成后自然可见)。
        if (npcId >= 800) {
          // ★三百十一/十二:miss 时——别名在册(=SW 暖存有此件)→ensureVImage
          //  自然 fetch(SW mod 缓存路线);无别名(回退支/未暖存)→恒 null 等注入
          //  (原语义;裸 fetch 原版路径=404 连环事故,三百十一首版教训)
          const img0 = this.hasAssetAlias(sheet) ? this.ensureVImage(sheet) : null;
          if (!img0) return null;
          const frames0 = (vanillaNpcFrames as Record<string, number>)[key]
            ?? vanillaNpc(npcId)?.frames ?? 1;
          const fh0 = Math.max(1, Math.floor(img0.height / frames0));
          m = { sheet, frameW: img0.width, frameH: fh0, count: frames0 };
          this.lazyNpcMeta.set(key, m);
        } else {
          const img = this.ensureVImage(sheet);
          if (!img) return null;
          const frames = (vanillaNpcFrames as Record<string, number>)[key]
            ?? vanillaNpc(npcId)?.frames ?? 1;
          const fh = Math.max(1, Math.floor(img.height / frames));
          m = { sheet, frameW: img.width, frameH: fh, count: frames };
          this.lazyNpcMeta.set(key, m);
        }
      }
    }
    const img = this.ensureVImage(m.sheet);
    if (!img) return null;
    const idx = Math.max(0, Math.min(m.count - 1, frameIdx));
    if (npcId === 677) {
      return { img, sx: 0, sy: Math.max(0, Math.min(4, frameIdx)), sw: m.frameW, sh: m.frameH };
    }
    return { img, sx: 0, sy: idx * m.frameH, sw: m.frameW, sh: m.frameH };
  }
  vTileName(id: number): string | null { return this.vanilla.tileNames?.[String(id)] ?? null; }
  vItemName(id: number): string | null { return this.vanilla.itemNames?.[String(id)] ?? null; }

  vnpcMeta(npcId: number): VanillaNpcMeta | null {
    return this.vanilla.npcs?.[String(npcId)] ?? null;
  }

  /** 原版杂项单图（呼吸气泡等） */
  /** 杂项单图(旗帜头像/链条/Boss 部件/Glow 叠画等,全为每帧活画)——
   *  miss 走 ensureVImage 触发懒加载:未就绪返回 null,消费方下帧自愈
   *  (2026-08-13 前 vimages.get 直取——脱离 VANILLA_MISC 预载即永不出现) */
  /** ★二百八十九:vimages 表直查(零请求零副作用)——mod 注入键存在性判定
   *  (Boss 地图头/血条 mod 头像:无素材走兜底,不发 404 探测)
   *  ★三百十一:assetAlias 在册=该键必有 SW 缓存资源(mod 暖存登记过)=真 */
  hasVImage(file: string): boolean {
    return this.vimages.has(file) || this.assetAlias.has(file);
  }

  // ---- ★三百十一:mod 资源 SW 同路线(mod 加载时资源暖进 SW 缓存,消费时经
  //      ensureVImage 自然 fetch 命中;与本体 sprites/ 同源策略,零特判渲染面) ----
  /** 别名表:消费键(vanilla/NPC_801.png 等)→ SW 缓存 URL(sprites/ 相对路径)。
   *  ensureVImage fetch 时查表改源;落 vimages 仍用消费键(消费面零改) */
  private assetAlias = new Map<string, string>();
  setAssetAlias(key: string, url: string): void {
    this.assetAlias.set(key, url);
  }
  hasAssetAlias(key: string): boolean {
    return this.assetAlias.has(key);
  }

  /** ★四百九十七刀:运行期 UI 清单键注入(mod 盔甲渲染链——Armor_Head_<hs>.png 等;
   *  原版 vanilla-ui.json 清单零扰动(禁重生成纪律),键=运行期 map 追加,
   *  path 走 ensureUiImage 的 assetAlias 别名 fetch 支(三百十一既有通道)) */
  registerUiFile(name: string, path: string): void {
    if (this.uiFiles[name]) return;   // 原版键在册=不覆写
    this.uiFiles[name] = path;
  }

  vmisc(path: string): DrawRect | null {
    const hit = this.vimages.get(path); // 命中直接返回(node 测试环境的已注入项同样有效)
    if (hit) return { img: hit, sx: 0, sy: 0, sw: hit.width, sh: hit.height };
    if (typeof Image === 'undefined') return null; // node 测试环境:无 Image,不触发加载
    const img = this.ensureVImage(path);
    if (!img) return null;
    return { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
  }

  /** UI 贴图（vanilla-ui/ 命名空间）。name 为白名单键，如 'UI_PanelBackground'。
   *  按需懒加载(消费方每帧重查,未就绪返回 null 自兜底)。
   *  ★键必须带 .png 后缀(uiFiles 键全部带)——裸键恒 null 且连请求都不发;
   *  每键 warn 一次(F5 报告 warn 环自动留痕;全屏地图 MapBG/Map 键失配由此类
   *  bug 实锤,2026-08-13) */
  /** 清单键存在查询(零请求零副作用):调用方拼变体通道等“试探性”预载清单前
   *  过滤——清单=构建期磁盘真相,键不存在则文件必然不存在(2026-09-04
   *  Player_11_0/1/2/4/6/8 族:原版变体 11 仅带 5 个差异通道,预载无条件 add
   *  全 14 通道=每会话固定 6 个 404/键)。 */
  uiFileExists(name: string): boolean {
    return name in this.uiFiles;
  }

  vui(name: string): DrawRect | null {
    const path = this.uiFiles[name];
    if (!path) {
      vuiKeyMiss(name);
      return null;
    }
    const img = this.ensureUiImage(path);
    if (!img) return null;
    return { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
  }

  private _uiPending = new Set<string>();
  /** UI 贴图失败负缓存(与 ensureVImage._vImageFailed 对称,2026-08-13 补):
   *  清单内但 404 的键若不加终态标记,每帧重查的消费方会每帧重发请求。
   *  ★TTL 化(2026-08-25 同类扫描):原永久 Set=一次失败整会话缺图(与刚修的
   *  preloadUiFiles 同族漏网);改 10s 过期重试,暖缓存到位即自愈 */
  private _uiFailed = new Map<string, number>();
  private static readonly UI_FAIL_TTL = 10_000;
  /** 失败负缓存截止时刻(值=until)。★404 分档(2026-08-27 手机实测"每次进世界
   *  Player_4_0/1/2 三连 404"):清单含逻辑全集键而磁盘无文件(变体 4 无独立
   *  head 通道,设计上回退 Player_0)=确定性不存在 → 10 分钟长负缓存;
   *  网络错/5xx → 10s 短负缓存(瞬态尽快重试)。HEAD 探测分档。 */
  private _uiFailUntil = new Map<string, number>();
  private static readonly UI_FAIL_TTL_404 = 600_000;
  private ensureUiImage(file: string): ImageBitmap | ImageBitmap | HTMLImageElement | null {
    const hit = this.uiimages.get(file);
    if (hit) return hit;
    const fail = this._uiFailed.get(file);
    if (fail !== undefined) {
      const until = this._uiFailUntil.get(file) ?? fail + SpriteAtlas.UI_FAIL_TTL;
      if (Date.now() < until) return null;
      this._uiFailed.delete(file);
      this._uiFailUntil.delete(file);
    }
    if (this._uiPending.has(file)) return null;
    this._uiPending.add(file);
    const im = new Image();
    im.onload = () => {
      // ImageBitmap 桥:入表即自持已解码像素(懒解码缓存驱逐免疫)
      const land = (store: ImageBitmap | HTMLImageElement) => {
        this.uiimages.set(file, store);
        this._uiPending.delete(file);
        this._uiFailed.delete(file);
        this._uiFailUntil.delete(file);
        this.flushUiWaiters(file, true);   // 唤醒 waitUi 等待者(2026-08-25)
      };
      if (!SpriteAtlas.USE_BITMAP) land(im);
      else tryBitmapUpgrade(im, file, land, () => land(im));  // 失败回退+退避重试(2026-08-18)
    };
    im.onerror = () => {
      this._uiPending.delete(file);
      this._uiFailed.set(file, Date.now());
      // 先短 TTL 占位,HEAD 探测后 404(确定性缺失)升级长 TTL——止住每 10s 重发
      this._uiFailUntil.set(file, Date.now() + SpriteAtlas.UI_FAIL_TTL);
      this.flushUiWaiters(file, false);
      void fetch(im.src, { method: 'HEAD' }).then((r) => {
        if (r.status === 404) this._uiFailUntil.set(file, Date.now() + SpriteAtlas.UI_FAIL_TTL_404);
      }).catch(() => { /* 探测失败维持短 TTL */ });
    };
    // ★三百十一:mod SW 同路线——别名在册则 fetch 别名 URL(自然过 SW 缓存
    //  cache-first);否则本键直取(原版路径语义不变)
    im.src = `sprites/${encodeURI(this.assetAlias.get(file) ?? file)}`;
    return null;
  }

  // ---- 可等待懒载(2026-08-25 用户要求"懒加载+串行":CharCreation 烘焙前置
  //      ensure,替代"发请求→失败→重试预算"的盲试链) ----
  private _uiWaiters = new Map<string, Array<(ok: boolean) => void>>();
  private flushUiWaiters(file: string, ok: boolean): void {
    const ws = this._uiWaiters.get(file);
    if (!ws) return;
    this._uiWaiters.delete(file);
    for (const w of ws) w(ok);
  }
  /** 等待单个 UI 贴图就绪(幂等触发懒载;404/失败也 settle=false 不悬挂)。
   *  ★入参是磁盘路径(vanilla-ui/…,清单解析后)非清单键——键→路径解析在 vui/
   *  ensureUiBatch,直传键会按错误路径发 404(ensureUiBatch 头注 2026-08-26 案) */
  waitUi(file: string): Promise<boolean> {
    this.ensureUiImage(file);
    if (this.uiimages.get(file)) return Promise.resolve(true);
    const fail = this._uiFailed.get(file);
    if (fail !== undefined) {
      const until = this._uiFailUntil.get(file) ?? fail + SpriteAtlas.UI_FAIL_TTL;
      if (Date.now() < until) return Promise.resolve(false);
      this._uiFailed.delete(file);
      this._uiFailUntil.delete(file);
    }
    return new Promise((resolve) => {
      const ws = this._uiWaiters.get(file) ?? [];
      ws.push((ok) => resolve(ok));
      this._uiWaiters.set(file, ws);
    });
  }
  /** 限并发池预载一批 UI 贴图(2026-08-27:原逐张串行 await——发型页 452 键
   *  串行 RTT 相加=加载缓慢主因;改 8 路并发池,总时长≈÷8。"避免并发风暴"
   *  由池上限保证;同文件重复请求由 waitUi 内部 waiter 去重合并)。
   *  ★入参语义=【清单键】(vanilla-ui.json 键,如 'Player_Hair_5.png')——与
   *  vui()/UITextures.get 同源,先经 uiFiles 解析成磁盘路径(vanilla-ui/ 前缀)
   *  再加载;清单外的入参按路径直用(资源包注入等直路径调用方的逃生门)。
   *  曾把键当路径直发(sprites/Player_Hair_5.png,缺 vanilla-ui/ 前缀)→ 发型页
   *  452 键全 404 且 SW 不缓存 404,开面板两波 904 个往返跑完才开始烘焙
   *  (2026-08-26 用户实报"发型列表等 904 个 404 才渲染")
   *  SW-BB1 2026-09-06 评估结案(不动):lane 循环的每次 await waitUi 都停在真实
   *  图片事件(onload/onerror/负缓存),无微任务风暴——"~60ms 单任务束"实测为
   *  同帧内多图 onload 回调+bitmap 升级批次,量级受 tryBitmapUpgrade 批形态支配,
   *  改批形态会波及全 UI 面加载语义(11 处 vui 消费方按帧重查)。值得动的判据:
   *  探针实测到单个 onload 批 >32ms 且落在关键交互窗口(而非后台预抢期)。
   *  全仓消费面仅 vui/assets/UITextures.ensure → CharCreation 两处(烘焙前置/
   *  变体预抢),超时等策略已在调用侧解决(D4b)。 */
  async ensureUiBatch(names: string[], concurrency = 8): Promise<void> {
    let i = 0;
    const lanes = Array.from({ length: Math.min(concurrency, names.length) }, async () => {
      while (i < names.length) {
        const raw = names[i++]!;
        const key = raw.endsWith('.png') ? raw : `${raw}.png`;
        const file = this.uiFiles[key] ?? key;
        try { await this.waitUi(file); } catch { /* 单文件失败不阻断整批 */ }
      }
    });
    await Promise.all(lanes);
  }

  /** 原版物品图标。构建期已 shelf-pack 进少数 Item_Atlas_k.png 图集(ix/iy/iw/ih
   *  子矩形,见 scripts/vanilla-atlas.mjs);旧单体条目(无矩形字段)回退整图语义。
   *  未加载时触发后台懒加载并返回 null(下帧生效)。
   *  资源包覆盖(M13):包内 Images/Item_<id>.png 以独立键注入 vimages
   *  (vanilla/Item_<id>.png——图集通道下盘上无此文件,仅资源包会产生该键),
   *  命中则整图直取,绕过图集子矩形(原版资源包替换 = 资产级覆盖同语义) */
  vicon(itemId: number): DrawRect | null {
    const packImg = this.vimages.get(`vanilla/Item_${itemId}.png`);
    if (packImg) return { img: packImg, sx: 0, sy: 0, sw: packImg.width, sh: packImg.height };
    const m = this.vanilla.items[String(itemId)];
    if (!m) return null;
    const img = this.ensureVImage(m.icon);
    if (!img) return null;
    if (m.ix !== undefined && m.iw !== undefined && m.ih !== undefined) {
      return { img, sx: m.ix, sy: m.iy ?? 0, sw: m.iw, sh: m.ih };
    }
    return { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
  }

  private _iconPending = new Set<string>();
  private _worldPreloaded = false;
  /** ★BJ705-A(2026-10-22):预载失败件限时回扫定时器句柄(undefined=无回扫在跑;
   *  见 schedulePreloadRescan 注)。 */
  private _preloadRescan: ReturnType<typeof setInterval> | undefined = undefined;
  /** 懒加载完成回调(Game 注册 → ChunkCache 全量标脏:晚到的表重新烘焙
   *  已缓存的 chunk,否则 fallback 会永久烤进 canvas) */
  onVImageLoaded: ((file: string) => void) | null = null;

  /** 预载文件清单(去重+decode)。tile/wall/NPC/misc 表与图标的统一底层 */
  async preloadFiles(files: Iterable<string>, onProgress?: (p: number) => void): Promise<void> {
    const list = [...new Set(files)];
    let done = 0;
    await Promise.all(list.map((f) => new Promise<void>((resolve) => {
      if (this.vimages.has(f)) { done++; onProgress?.(done / list.length); return resolve(); }
      const img = new Image();
      img.onload = () => {
        // ImageBitmap 桥(字节+解码双就绪的原生语义,替代 img.decode());
        // 晚到钩子须在 bitmap 落地后触发(消费方读的是表内对象)。
        // settled 门:进度/resolve 只结算一次;onVImageLoaded 在"失败落 Image→
        // 重试成功换 bitmap"路径会发第二次(=晚到表语义,触发对应 chunk 重烘,故意的)
        let settled = false;
        const land = (store: ImageBitmap | HTMLImageElement) => {
          this.vimages.set(f, store);
          if (!settled) { settled = true; done++; onProgress?.(done / list.length); resolve(); }
          this.onVImageLoaded?.(f);
        };
        if (!SpriteAtlas.USE_BITMAP) land(img);
        else tryBitmapUpgrade(img, f, land, () => land(img));
      };
      img.onerror = () => {
        // ★失败重试一次(2026-08-25 同类扫描):与 preloadUiFiles 同款——冷缓存窗口
        //   瞬时失败不留永久空表(settled 门防双计数,重试成功走晚到表语义重烘)
        if (!retried) {
          retried = true;
          setTimeout(() => { img.src = `sprites/${encodeURI(f)}`; }, 800);
          return;
        }
        resolve();
      };
      let retried = false;
      img.src = `sprites/${encodeURI(f)}`;
    })));
  }

  /** 按图块 sheet id + 墙 id 预载对应贴图表。
   *  Game 用出生点区域类型扫描调用——只载画面涉及的表(出生点半径内实测仅
   *  22/378 张图块表),而不是全量 ~750 张(~250MB 解码) */
  preloadTileSheetsFor(tileSheets: Iterable<number>, wallIds: Iterable<number>): Promise<void> {
    const files = new Set<string>();
    for (const id of tileSheets) {
      const m = this.vanilla.tiles[String(id)];
      if (m) files.add(m.sheet);
    }
    for (const id of wallIds) {
      const m = this.vanilla.walls[String(id)];
      if (m) files.add(m.sheet);
    }
    return this.preloadFiles(files);
  }

  /** 预载常驻杂项(树冠/液体/瀑布/电路)+ NPC 表——出生点必有,量小全载。
   *  ★BJ636(2026-10-11 线上实报"一进游戏所有怪物透明,刷新重进自愈"):
   *  旧清单只含 vanilla.json npcs 登记的 20 张特殊表——普通怪(史莱姆/僵尸等
   *  676 张 vanilla/NPC_{id}.png 散件)不在预载面,走 vnpc 首遇懒加载;发布形态
   *  prune-dist 删光 dist/sprites/vanilla 散件(字节只在 SW 缓存=zip 暖存直写),
   *  SW 未接管(首访空窗)或缓存缺件(warm 未完成/清空)时这些 fetch 全 404
   *  (SPA fallback 回 index.html),vnpc→ensureVImage 10s 冷却循环重试恒空 →
   *  drawEnemy if (r) 跳画 = 全体怪物透明,直到刷新后 SW 接管+缓存命中自愈。
   *  修=进世界门槛(await preloadSceneAssets)预载 NPC 主表全集(vanilla-npcs.json
   *  696 键,~3.17MB,远小于物品图标 24MB/tile 表)——进游戏零懒加载
   *  竞态窗;NPC_X_Alt_* 变体(22 张,特殊渲染分支消费)不进清单,按需自愈。
   *  ★C16c-F5(2026-10-12) 勘正:旧注 ~4.6MB/144 张系未实测估算——盘上实测预载集
   *  3.167MB(696 键派生 NPC_{id}.png ∪ vanilla.json npcs 20 特殊表),Alt_* 22 张。 */
  preloadMiscAndNpcs(): Promise<void> {
    const files = [
      ...VANILLA_MISC,
      ...Object.values(this.vanilla.npcs ?? {}).map((n) => n.sheet),
      ...Object.keys(vanillaNpcFrames).map((id) => `vanilla/NPC_${id}.png`),
    ];
    return this.preloadFiles(files).then(() => this.schedulePreloadRescan(files));
  }

  /** ★BJ705-A(2026-10-22):预载失败件限时自愈回扫(10s 节拍 ×60 轮 ≈10min)。
   *  定谳链(用户实报「南瓜月打南瓜王,暗黑收割者抽打后头部变透明,小概率」):
   *  · 机制=资产窗假体——Renderer.drawEnemy 里披风/双刃等部件贴图独立加载、
   *    先于本体 if (r) 判空绘制;NPC_{id} 主表虽已 BJ636 前置到进世界门槛,
   *    但门槛期 preloadFiles 失败是【静默】的(发布形态 prune-dist 删光散件,
   *    SW 未接管/缓存缺件窗恒 404,800ms 单次重试不够穿窗)——失败件之后
   *    只能等【首绘消费】才走 ensureVImage 10s TTL 重试。南瓜王这类波次 boss
   *    进世界后数分钟才首见:门槛窗失败的主表在整个前中期无人重试,首见拍
   *    恰在战斗接触(=用户「抽打后」观察位),本体跳画而部件照画=「头部变
   *    透明」。探针 scripts/_bj705a-nullwindow.mjs 判别锁:强制 NPC_327.png
   *    失败窗,头区 orange 1554→240(−85%)而画面其余照常渲染。
   *  · 回扫=把失败件的重试从「首绘」提前到「进世界后立刻」:每 10s 一发/
   *    文件(与 ensureVImage 失败 TTL 同节拍=零风暴增量;preloadFiles 自带
   *    800ms 单发重试同语义),落地即退出(健康会话零额外流量)。60 轮后仍缺
   *    → console.warn 一发收口(诊断面:后续实报凭此行定位资产域,非渲染域)。
   *  · 边界:node/worker 无 Image 环境直接不开(测试可注入 globalThis.Image
   *    + 桩 preloadFiles 驱动);多次进世界幂等(单例回扫,文件集同源)。
   *  · 登记债(本刀不落):①部件/本体不对称假体在残余窗内仍可见(「宁回退
   *    不丢精灵」——门控部件会丢更多精灵,且 boss 整体隐形比缺头更不可打);
   *    ②散件恒失败的根因在 SW/CDN 资产域(部署面),回扫只是缩短暴露窗。 */
  private schedulePreloadRescan(files: string[]): void {
    if (this._preloadRescan !== undefined || typeof Image === 'undefined') return;
    let rounds = 0;
    const tick = async (): Promise<void> => {
      const miss = files.filter((f) => !this.vimages.has(f));
      if (miss.length === 0) {
        clearInterval(this._preloadRescan);
        this._preloadRescan = undefined;
        return;
      }
      await this.preloadFiles(miss);   // 每文件每轮一发(已就绪件秒过,零重复)
      if (++rounds >= 60) {
        clearInterval(this._preloadRescan);
        this._preloadRescan = undefined;
        console.warn(`[SpriteAtlas] BJ705-A 预载回扫 ${rounds} 轮后仍缺 ${miss.length} 件(资产域/SW 缓存面,渲染侧已尽力):`,
          miss.slice(0, 8).join(', '), miss.length > 8 ? '…' : '');
      }
    };
    this._preloadRescan = setInterval(() => { void tick(); }, 10_000);
  }

  /** 预载世界渲染所需原版表(全量,~750 张)。仅调试/兜底用;正常路径走
   *  preloadTileSheetsFor + preloadMiscAndNpcs 的出生点子集 */
  async preloadVanillaWorld(): Promise<void> {
    if (this._worldPreloaded) return;
    this._worldPreloaded = true;
    await Promise.all([
      this.preloadTileSheetsFor(
        Object.keys(this.vanilla.tiles).map(Number),
        Object.keys(this.vanilla.walls).map(Number),
      ),
      this.preloadMiscAndNpcs(),
    ]);
  }

  /** 按需加载 vanilla 单图(去重;失败静默)。命中返回元素,否则 null。
   *  渲染路径一律用此入口(经 vimg 别名)——直接 vimages.get 会绕过懒加载与
   *  onVImageLoaded 重烘焙钩子(棕榈树干传送消失的根因)。
   *  烘焙追踪(bakeTracker,2026-08-13):ChunkCache 烘焙期间置 _baking,此处
   *  miss 发起加载时 note、onload 到达时 onLoaded——烘焙消费的任何懒取贴图
   *  晚到自动触发重烘焙,不再依赖 Game.ts 的前缀白名单(白名单保留作纵深) */
  bakeTracker: { _baking?: boolean; note(file: string): void; noteConsumed?: (file: string) => void; onLoaded(file: string): void } | null = null;
  ensureVImage(file: string): ImageBitmap | ImageBitmap | HTMLImageElement | null {
    const hit = this.vimages.get(file);
    if (hit) {
      // 消费登记(2026-08-19 素材重制热补丁):烘焙期命中(hit)的表也要登记到
      // ChunkCache.chunkConsumed——替换已就位 sheet 的精确重烘依据(onBakeAssetArrived
      // 只覆盖 miss 晚到链,对已就位表是 no-op)。可选方法:无 ChunkCache 的环境安全
      if (this.bakeTracker?._baking) this.bakeTracker.noteConsumed?.(file);
      return hit;
    }
    // ★note 先于 pending/failed 早退(2026-08-19 用户实报"生命树贴图不及时,
    // 手动破坏才渲染"):加载已在飞行中(预载/他人发起)时烘焙期 ensure 会早退,
    // 曾把 note 一起吞掉 → 表晚到无人重烘 = 缺表 fallback 钉死。failed 同 note:
    // 重试成功会二次 land → onLoaded → 重烘,链路反而闭环
    if (this.bakeTracker?._baking) this.bakeTracker.note(file);
    if (this._iconPending.has(file) || this.vImageFailed(file)) return null;
    this._iconPending.add(file);
    const im = new Image();
    im.onload = () => {
      // ImageBitmap 桥(2026-08-14 根治):入表即自持已解码像素;晚到/烘焙
      // 钩子在 bitmap 落地后触发(消费方读表内对象)
      const land = (store: ImageBitmap | HTMLImageElement) => {
        this.vimages.set(file, store);
        this._iconPending.delete(file);
        this._vImageFailed.delete(file);
        if (this.bakeTracker) this.bakeTracker.onLoaded(file);
        this.onVImageLoaded?.(file);  // 晚到的表 → ChunkCache 重烘焙
      };
      if (!SpriteAtlas.USE_BITMAP) land(im);
      else tryBitmapUpgrade(im, file, land, () => land(im));  // 失败回退+退避重试(重试成功二次 land=晚到重烘,安全)
    };
    im.onerror = () => {
      this._iconPending.delete(file);
      // ★TTL 失败负缓存(2026-08-19 用户实报"武器/弹幕/投掷物全隐形"):旧版
      // 永久黑名单——一次瞬时失败(vite 重启窗口/SW 缓存投毒条目/断网半秒)
      // = 该贴图【本页面生命周期内】永久消失,与"文件真不存在"不可区分。
      // 改 10s 冷却后允许重试;失败瞬间顺带驱逐 SW 缓存里的同路径条目
      // (cache-first 下不驱逐则重试永远再吃同一份坏字节)
      // ★瞬态失败不驱逐(2026-09-04 线上实锤"Tiles_123/NPC_357 命中即删"=
      //  驱逐了完好条目):一次 onerror 可能是 SW/网络瞬态——主动重试一次,
      //  成功=缓存完好(不驱逐);再失败才驱逐(真坏字节)
      this._vImageFailed.set(file, performance.now());
      const retry = new Image();
      retry.onload = () => {
        const store = SpriteAtlas.USE_BITMAP ? im : retry;
        this.vimages.set(file, store);
        this._vImageFailed.delete(file);
        if (this.bakeTracker) this.bakeTracker.onLoaded(file);
        this.onVImageLoaded?.(file);
      };
      retry.onerror = () => {
        this._vImageFailed.set(file, performance.now());
        // ★evict 移除(2026-09-04):发布形态缓存内容全部来自自家 zip(CRC 校验),
        //  无"投毒来源";SW 空窗期的加载失败曾误删完好条目(累计 94 条天空族)。
        //  持续性失败由 10s TTL 重试+对账补下自愈（★2026-09-17 勘误:旧注"15s"
        //  与 vImageFailed 冷却 10_000ms 不符,以代码为准）。
      };
      retry.src = im.src;
    };
    // ★三百十一:mod SW 同路线——别名在册则 fetch 别名 URL(自然过 SW 缓存
    //  cache-first);否则本键直取(原版路径语义不变)
    im.src = `sprites/${encodeURI(this.assetAlias.get(file) ?? file)}`;
    return null;
  }
  /** 表是否处于失败冷却(10s 内视为失败,供消费方分级告警;过期自动可重试) */
  vImageFailed(file: string): boolean {
    const at = this._vImageFailed.get(file);
    if (at === undefined) return false;
    if (performance.now() - at > 10_000) { this._vImageFailed.delete(file); return false; }
    return true;
  }
  private _vImageFailed = new Map<string, number>();

  // ---- 资产健康只读视图(F5 调试报告 assetHealth 段;运行期防线,2026-08-13) ----
  failedVImages(): string[] { return [...this._vImageFailed.keys()]; }
  failedUiImages(): string[] { return [...this._uiFailed.keys()]; }
  vuiMissKeys(): string[] { return [..._vuiKeyMisses]; }
  /** 设计内回退 miss(静默但可审计) */
  vuiFallbackMisses(): string[] { return [..._vuiFallbackMisses]; }
  /** 后台预取全部物品图标(保留兼容入口;预载流程请用 awaited 的 preloadIcons) */
  prefetchIcons(): void {
    void this.preloadIcons();
  }

  private _iconsPromise: Promise<void> | null = null;
  /** 预载全部物品图标素材。图集化后清单 = 去重后的 ~3 张 Item_Atlas_k.png
   *  (此前 6059 张单体逐张请求);缓存 Promise——并发 await 的调用者
   *  都会等到同一批加载完成(此前旗标早退会让第二个调用者拿到假完成) */
  preloadIcons(onProgress?: (p: number) => void): Promise<void> {
    if (this._iconsPromise) return this._iconsPromise;
    const icons = [...new Set(Object.values(this.vanilla.items).map((m) => m.icon))];
    let done = 0;
    this._iconsPromise = Promise.all(icons.map((f) => new Promise<void>((resolve) => {
      if (this.vimages.has(f)) { done++; onProgress?.(done / icons.length); return resolve(); }
      const im = new Image();
      let settledI = false;
      const landI = () => {
        this.vimages.set(f, im);
        if (settledI) return;   // 重试成功二次落地不双计数
        settledI = true;
        done++; onProgress?.(done / icons.length); resolve();
      };
      im.onload = landI;
      im.onerror = () => {
        // ★失败重试一次(同 preloadUiFiles 2026-08-25):拥塞窗口瞬时失败不留永久空图
        if (!retriedI) {
          retriedI = true;
          setTimeout(() => { im.src = `sprites/${encodeURI(f)}`; }, 800);
          return;
        }
        resolve();
      };
      let retriedI = false;
      im.src = `sprites/${encodeURI(f)}`;
    }))).then(() => undefined);
    return this._iconsPromise;
  }

  /** 预载 UI 贴图按 key 前缀(如 ['Player_'] = 纸娃娃身体/发型,545 张)。
   *  exclude:子族前缀排除表(如 'UI_Bestiary')——面板专属子族只在面板打开时
   *  由 vui 懒加载自愈,不进启动/进图预载(2026-08-13 UI_ 397 键收窄用)。 */
  async preloadUiPrefix(prefixes: string[], onProgress?: (p: number) => void, exclude?: string[]): Promise<void> {
    const files = Object.entries(this.uiFiles)
      .filter(([k]) => prefixes.some((p) => k.startsWith(p))
        && !(exclude ?? []).some((e) => k.startsWith(e)))
      .map(([, f]) => f);
    return this.preloadUiFiles(files, onProgress);
  }

  /** 按 UI 文件路径预载(装备中的具体 Armor 表;decode 保证首帧无解码卡顿) */
  async preloadUiFiles(files: Iterable<string>, onProgress?: (p: number) => void): Promise<void> {
    const list = [...new Set(files)];
    let done = 0;
    await Promise.all(list.map((f) => new Promise<void>((resolve) => {
      if (this.uiimages.has(f)) { done++; onProgress?.(done / list.length); return resolve(); }
      const im = new Image();
      im.onload = () => {
        // ImageBitmap 桥(2026-08-18 imglog 实锤漏网第四站:此处曾直接 set(Image)
        // +decode() ——预载清单含 UI_Cursor_0(菜单起每帧画)与 Player_ 纸娃娃表
        // (进世界起每帧画),永久 Image = trace 残余流两大恒定家族的全部来源)
        // settled 门:进度/resolve 只结算一次(失败重试成功会二次 land,只换表项)
        let settled = false;
        const land = (store: ImageBitmap | HTMLImageElement) => {
          this.uiimages.set(f, store);
          if (settled) return;
          settled = true;
          done++; onProgress?.(done / list.length); resolve();
        };
        if (!SpriteAtlas.USE_BITMAP) { land(im); return; }
        tryBitmapUpgrade(im, f, land, () => land(im));
      };
      im.onerror = () => {
        // ★失败重试一次(2026-08-25 用户实报首访偶现热栏图标永久缺失):冷缓存+
        //   暖缓存并发抢路的拥塞窗口里,个别图标请求瞬时失败——原 onerror 直接
        //   resolve 会留下永久空槽(直到刷新)。延迟 800ms 重试一次;再失败才维持
        //   原放弃语义(不存在的探测键仍只多 404 一遍,可忽略)。settled 门保证
        //   重试成功二次 land 只换表项不双计数(原注释语义)
        if (!retried) {
          retried = true;
          setTimeout(() => { im.src = `sprites/${encodeURI(f)}`; }, 800);
          return;
        }
        resolve();
      };
      let retried = false;
      im.src = `sprites/${encodeURI(f)}`;
    })));
  }

}

// ---- 物品图标：一律原版 Item_N（旧 Maples UI/ 图标层已整体移除） ----
import { TILE_BY_KEY, TILE_DEFS } from '../data/tiles';
import { vanillaNpc } from '../data/vanillaNpcs';   // mod NPC frames 运行时权威(G1 补链)

/** DrawAnimationVertical(int.MaxValue, 3) 的静态等价(IsFood 全表) */
const FOOD = { dur: Number.MAX_SAFE_INTEGER, n: 3, static: true };
const FOOD_IDS: number[] = [
  353, 357, 967, 969, 1787, 1911, 1912, 1919, 1920, 2266, 2267, 2268, 
  2425, 2426, 2427, 3195, 3532, 4009, 4010, 4011, 4012, 4013, 4014, 4015, 
  4016, 4017, 4018, 4019, 4020, 4021, 4022, 4023, 4024, 4025, 4026, 4027, 
  4028, 4029, 4030, 4031, 4032, 4033, 4034, 4035, 4036, 4037, 4282, 4283, 
  4284, 4285, 4286, 4287, 4288, 4289, 4290, 4291, 4292, 4293, 4294, 4295, 
  4296, 4297, 4403, 4411, 4614, 4615, 4616, 4617, 4618, 4619, 4620, 4621, 
  4622, 4623, 4624, 4625, 5009, 5041, 5042, 5092, 5093, 5275, 5277, 5278, 
  5537, 5645, 
];

/**
 * 物品贴图动画注册表(Main.InitializeItemAnimations :3685-3722 1:1)。
 * 食物族:ItemID.Sets.IsFood(:258,86 项)全部为竖 3 帧条,原版注册
 * DrawAnimationVertical(int.MaxValue,3) = 恒帧 0(顶部一帧);本表以 FOOD
 * 静态条目等价表达(切片帧高 = 总高/3)。
 * 物品源图是竖排多帧条(如坠星 Item_75=22×208),不切片会整条入画。
 * dur=tick/帧;pingPong=往返;static=true=恒帧 0(IsFood 的 int.MaxValue
 * 静态三帧与 NotActuallyAnimating 族)。
 */
export const ITEM_ANIMATION: Record<number, { dur: number; n: number; pingPong?: boolean; static?: boolean }> = {
  3581: { dur: 4, n: 4 },
  3580: { dur: 6, n: 4 },
  75: { dur: 5, n: 8, pingPong: true },    // 坠星 8 帧 PingPong 旋转
  575: { dur: 6, n: 4 }, 547: { dur: 6, n: 4 }, 520: { dur: 6, n: 4 },
  548: { dur: 6, n: 4 }, 521: { dur: 6, n: 4 }, 549: { dur: 6, n: 4 },
  3453: { dur: 6, n: 4 }, 3454: { dur: 6, n: 4 }, 3455: { dur: 6, n: 4 },
  4068: { dur: 6, n: 4, static: true },   // NotActuallyAnimating(:3701-3709)
  4069: { dur: 6, n: 4, static: true },
  4070: { dur: 6, n: 4, static: true },
  5644: { dur: 7, n: 9 },                 // ScryingOrb(专属着色器,垂直循环近似)
  // ---- 食物族(IsFood :258):竖 3 帧条,原版 int.MaxValue 恒帧 0 ----
  ...Object.fromEntries(FOOD_IDS.map((v) => [v, FOOD])),
};


/** 物品动画当前帧(DrawAnimationVertical.GetFrame 语义;tick=游戏 tick 或等价毫秒换算) */
export function itemAnimFrame(vid: number, tick: number): number {
  const a = ITEM_ANIMATION[vid];
  if (!a || a.static) return 0;
  const span = a.pingPong ? a.n * 2 - 2 : a.n;
  const idx = Math.floor(tick / a.dur) % span;
  return a.pingPong && idx >= a.n ? span - idx : idx;
}

/** 把整条 DrawRect 按帧切片(vid 无动画原样返回) */
export function sliceItemAnimFrame(vid: number, ar: DrawRect, tick: number): DrawRect {
  const a = ITEM_ANIMATION[vid];
  if (!a || a.n <= 1) return ar;
  const fh = ar.sh / a.n;
  const f = Math.min(a.n - 1, itemAnimFrame(vid, tick));
  return { img: ar.img, sx: ar.sx, sy: ar.sy + Math.round(fh * f), sw: ar.sw, sh: Math.round(fh) };
}

/** createTile → 物品 id 映射（place_v_* 图标首选原版物品贴图用;同 tile 多物品取最低 id） */
let CREATE_TILE_ITEM_MAP: Map<number, number> | null = null;
function itemByCreateTile(tileId: number): number | undefined {
  if (!CREATE_TILE_ITEM_MAP) {
    CREATE_TILE_ITEM_MAP = new Map();
    for (const [id, m] of Object.entries(vanillaJson.items)) {
      const ct = (m as { createTile?: number | null }).createTile;
      if (ct != null && !CREATE_TILE_ITEM_MAP.has(ct)) CREATE_TILE_ITEM_MAP.set(ct, Number(id));
    }
  }
  return CREATE_TILE_ITEM_MAP.get(tileId);
}

/** 原版物品的 createTile（UI 搜索面板去重用:惰性 vi_ 注册的 createTile tile 若
 *  已被 place_v 族覆盖,该 vi_ 件为不可放置死条目,不进搜索） */
export function vanillaItemCreateTile(vid: number): number | undefined {
  const ct = (vanillaJson.items as Record<string, { createTile?: number | null } | undefined>)[String(vid)]?.createTile;
  return ct ?? undefined;
}

/** place_v_<sheet>_<name> 键的 tile def 键（place_v_ 剥离） */
function tk0(key: string): string {
  return key.slice('place_'.length);
}

/** 多格 tile 图标拼装（place_v_* 图标用）：vanilla tile 帧表=18px 步进（16×16 帧
 *  +2px 边距,VanillaTiler :838/:1125 同源）——按 (tx×18,ty×18) 逐格取 16×16 贴到
 *  w×16 × h×16 画布,边距不入户。表未载返回 null（调用方走 UI 逐帧重试自愈）。
 *  缓存按 sheet（一表一 tile 族;首风格块在表原点） */
const TILE_FOOTPRINT_CACHE = new Map<number, HTMLCanvasElement | null>();
function tileFootprintCanvas(atlas: SpriteAtlas, sheet: number, w: number, h: number): HTMLCanvasElement | null {
  const hit = TILE_FOOTPRINT_CACHE.get(sheet);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') return null;
  const img = atlas.ensureVImage(`vanilla/Tiles_${sheet}.png`);
  if (!img || !(img.width > 0)) return null;   // 未载:不缓存,下次重试
  const c = document.createElement('canvas');
  c.width = w * 16; c.height = h * 16;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      cx.drawImage(img as CanvasImageSource, tx * 18, ty * 18, 16, 16, tx * 16, ty * 16, 16, 16);
    }
  }
  TILE_FOOTPRINT_CACHE.set(sheet, c);
  return c;
}

export function atlasIconForKey(atlas: SpriteAtlas, key: string): DrawRect | null {
  const vid = VANILLA_ITEM_ICON_MAP[key];
  if (vid !== undefined) return atlas.vicon(vid);
  // 阶段 5:vi_<id>_* 全量物品回退原版图标
  if (key.startsWith('vi_')) {
    const id = parseInt(key.slice(3), 10);
    if (Number.isFinite(id)) return atlas.vicon(id);
  }
  // 阶段 5:place_v_* 放置物品回退用图块贴图首帧作图标
  if (key.startsWith('place_v_')) {
    // ★sheet id 直接从键解析（place_v_<sheet>_<name>——不依赖 tile def:
    //   place_v_517_abigails_flower 等无 def 件此前直接 null=蓝/问号回退）
    const sm = /^place_v_(\d+)_/.exec(key);
    const sheet = sm ? Number(sm[1]) : -1;
    if (sheet > 0) {
      // ★首选原版物品贴图：createTile===sheet 的物品 → vicon=原版背包图标
      // （苔藓团/蜂巢/向日葵物品贴图,非 tile 贴图——曾用 tile 贴图:单格=碎片
      // (向日葵初报)/整块=18px 栅格边距十字缝(蜂巢)/苔藓=raw 石纹非原版观感）
      const itemId = itemByCreateTile(sheet);
      if (itemId !== undefined) {
        const ar = atlas.vicon(itemId);
        if (ar) return ar;
      }
      const tid = TILE_BY_KEY[tk0(key)];
      const td = tid !== undefined ? TILE_DEFS[tid] : undefined;
      if (td?.vanilla) {
        // 回退:多格 tile 逐格拼装（18px 步进）/单格 vframeAt
        if ((td.w ?? 1) > 1 || (td.h ?? 1) > 1) {
          const assembled = tileFootprintCanvas(atlas, td.vanilla.sheet, td.w ?? 1, td.h ?? 1);
          if (assembled) return { img: assembled, sx: 0, sy: 0, sw: assembled.width, sh: assembled.height };
          return null;   // 表未载:走 UI 逐帧重试自愈（勿回退单格碎片）
        }
        return atlas.vframeAt(td.vanilla.sheet, 0, 0) ?? atlas.vframe(td.vanilla.sheet, 0, 0);
      }
      // 无 tile def（阿比盖尔花 517 等召唤植物件）:首格直取(1×1 假设)
      return atlas.vframeAt(sheet, 0, 0);
    }
  }
  return null;
}

// 我们的 item key → 原版物品图标 id（TEdit items.json 核实；Maples 缺图标的用这层）
export const VANILLA_ITEM_ICON_MAP: Record<string, number> = {
  cs: 1547,
  // 电路工具(id-maps items.json 核实:530 电线/509,850,851,3612 四色扳手/510 钢丝钳/
  // 849 致动器/3620 致动魔杖/3625 五彩扳手/3611 宏伟蓝图)
  // 盔甲三件套（原版 id：胫甲 76-79 / 胸甲 80-83 / 头盔 89-92）
  // ---- 原版批次新材料 / 方块 / 家具 ----
  // wld 导入补全物品图标
  vi_2350_recall_potion: 2350,
  vi_188_healing_potion: 188,
  vi_282_glowstick: 282,
  vi_41_flaming_arrow: 41,
  vi_167_dynamite: 167,
  vi_279_throwing_knife: 279,
  vi_51_jester_s_arrow: 51,
  vi_19_gold_bar: 19,
  vi_302_water_walking_potion: 302,
  vi_305_gravitation_potion: 305,
  vi_43_suspicious_looking_eye: 43,
  vi_296_spelunker_potion: 296,
  vi_299_night_owl_potion: 299,
  vi_965_rope: 965,
  vi_303_archery_potion: 303,
  vi_304_hunter_potion: 304,
  vi_50_magic_mirror: 50,
  vi_42_shuriken: 42,
  vi_295_featherfall_potion: 295,
  vi_53_cloud_in_a_bottle: 53,
  vi_2329_dangersense_potion: 2329,
  vi_40_wooden_arrow: 40,
  vi_975_shoe_spikes: 975,
  vi_54_hermes_boots: 54,
  vi_301_thorns_potion: 301,
  vi_49_band_of_regeneration: 49,
  vi_2326_titan_potion: 2326,
  vi_297_invisibility_potion: 297,
  vi_166_bomb: 166,
  vi_5011_mace: 5011,
  vi_4425_shark_bait: 4425,
  vi_2351_teleportation_potion: 2351,
  vi_4460_sandcastle_bucket: 4460,
  vi_168_grenade: 168,
  vi_227_restoration_potion: 227,
  vi_930_flare_gun: 930,
  vi_931_flare: 931,
  vi_997_extractinator: 997,
  vi_52_angel_statue: 52,
  vi_265_hellfire_arrow: 265,
  vi_298_shine_potion: 298,
  vi_5007_dead_man_s_sweater: 5007,
  vi_117_meteorite_bar: 117,
  vi_186_breathing_reed: 186,
  vi_329_shadow_key: 329,
  vi_974_ice_torch: 974,
  vi_2322_mining_potion: 2322,
  vi_4915_tungsten_bullet: 4915,
  vi_946_umbrella: 946,
  vi_939_web_slinger: 939,
  vi_4870_potion_of_return: 4870,
  vi_288_obsidian_skin_potion: 288,
  vi_31_bottle: 31,
  vi_211_feral_claws: 211,
  vi_4404_inner_tube: 4404,
  vi_187_flipper: 187,
  vi_2198_ice_machine: 2198,
  vi_274_dark_lance: 274,
  vi_285_aglet: 285,
  vi_213_staff_of_regrowth: 213,
  vi_964_boomstick: 964,
  vi_1293_lihzahrd_power_cell: 1293,
  vi_2195_lihzahrd_furnace: 2195,
  vi_2766_solar_tablet_fragment: 2766,
  vi_300_battle_potion: 300,
  vi_2348_inferno_potion: 2348,
  vi_218_flamelash: 218,
  vi_3019_hellwing_bow: 3019,
  vi_112_flower_of_fire: 112,
  vi_220_sunfury: 220,
  vi_4345_can_of_worms: 4345,
  vi_953_climbing_claws: 953,
  vi_3069_wand_of_sparking: 3069,
  vi_212_anklet_of_the_wind: 212,
  vi_2204_honey_dispenser: 2204,
  vi_277_trident: 277,
  vi_863_water_walking_boots: 863,
  vi_751_cloud: 751,
  vi_155_muramasa: 155,
  vi_289_regeneration_potion: 289,
  vi_906_lava_charm: 906,
  vi_4055_dunerider_boots: 4055,
  vi_724_ice_blade: 724,
  vi_670_ice_boomerang: 670,
  vi_4061_storm_spear: 4061,
  vi_987_blizzard_in_a_bottle: 987,
  vi_4551_slice_of_hell_cake: 4551,
  vi_5010_treasure_magnet: 5010,
  vi_2323_heartreach_potion: 2323,
  vi_2345_lifeforce_potion: 2345,
  vi_290_swiftness_potion: 290,
  vi_291_gills_potion: 291,
  vi_280_spear: 280,
  vi_2325_builder_potion: 2325,
  vi_284_wooden_boomerang: 284,
  vi_2192_bone_welder: 2192,
  vi_5234_remnants_of_devotion: 5234,
  vi_156_cobalt_shield: 156,
  vi_157_aqua_scepter: 157,
  vi_163_blue_moon: 163,
  vi_113_magic_missile: 113,
  vi_3317_valor: 3317,
  vi_327_golden_key: 327,
  vi_164_handgun: 164,
  vi_294_magic_power_potion: 294,
  vi_4263_magic_conch: 4263,
  vi_4062_thunder_zapper: 4062,
  vi_1579_flurry_boots: 1579,
  vi_4056_ancient_chisel: 4056,
  vi_4346_encumbering_stone: 4346,
  vi_1319_snowball_cannon: 1319,
  vi_3199_ice_mirror: 3199,
  vi_950_ice_skates: 950,
  vi_4443_demonic_hellcart: 4443,
  vi_4737_ornate_shadow_key: 4737,
  vi_4276_bast_statue: 4276,
  vi_4262_snake_charmer_s_flute: 4262,
  vi_3093_herb_bag: 3093,
  vi_292_ironskin_potion: 292,
  vi_3084_radar: 3084,
  vi_4341_step_stool: 4341,
  vi_4978_fledgling_wings: 4978,
  vi_2197_sky_mill: 2197,
  vi_158_lucky_horseshoe: 158,
  vi_5254_blessing_from_the_heavens: 5254,
  vi_1156_piranha_gun: 1156,
  vi_1571_scourge_of_the_corruptor: 1571,
  vi_1260_rainbow_gun: 1260,
  vi_1572_staff_of_the_frost_hydra: 1572,
  vi_4607_desert_tiger_staff: 4607,
  vi_933_leaf_wand: 933,
  vi_832_living_wood_wand: 832,
  vi_4066_desert_minecart: 4066,
  vi_4450_shroom_minecart: 4450,
  vi_4423_scarab_bomb: 4423,
  vi_159_shiny_red_balloon: 159,
  vi_5258_see_the_world_for_what_it_is: 5258,
  vi_65_starfury: 65,
  vi_5388_eye_of_the_sun: 5388,
  vi_2219_celestial_magnet: 2219,
  vi_5255_love_is_in_the_trash_slot: 5255,
  vi_4426_bee_minecart: 4426,
  vi_3017_flower_boots: 3017,
  vi_3360_living_mahogany_wand: 3360,
  vi_3361_rich_mahogany_leaf_wand: 3361,
  vi_1309_slime_staff: 1309,
  vi_1845_necromantic_scroll: 1845,
  vi_1864_papyrus_scarab: 1864,
  vi_1158_pygmy_necklace: 1158,
  vi_3034_coin_ring: 3034,
  vi_308_moonglow_seeds: 308,
  vi_312_fireblossom_seeds: 312,
  vi_310_deathweed_seeds: 310,
  vi_307_daybloom_seeds: 307,
  vi_309_blinkroot_seeds: 309,
  vi_2357_shiverthorn_seeds: 2357,
  vi_311_waterleaf_seeds: 311,
  vi_1828_pumpkin_seed: 1828,
  vi_126_bottled_water: 126,
  vi_1134_bottled_honey: 1134,
  vi_3068_guide_to_plant_fiber_cordage: 3068,
  vi_4779_mushroom_hat: 4779,
  vi_4780_mushroom_vest: 4780,
  vi_4781_mushroom_pants: 4781,
vi_678_red_potion: 678,
  vi_281_blowpipe: 281,
  vi_293_mana_regeneration_potion: 293,
  vi_2767_solar_tablet: 2767,
  vi_3_stone_block: 3,
  vi_3213_money_trough: 3213,
  vi_94_wood_platform: 94,
  vi_2757_vortex_helmet: 2757,
  vi_4989_soaring_insignia: 4989,
  vi_75_fallen_star: 75,
  vi_3383_stardust_leggings: 3383,
  vi_4914_kaleidoscope: 4914,
  vi_26_stone_wall: 26,
  vi_1991_bug_net: 1991,
  vi_4828_superheated_blood: 4828,
  vi_3509_copper_pickaxe: 3509,
  vi_3507_copper_shortsword: 3507,
  vi_4755_grox_the_great_s_horned_cowl: 4755,
  vi_4756_grox_the_great_s_chestplate: 4756,
  vi_4757_grox_the_great_s_greaves: 4757,
  vi_214_hellstone_brick: 214,
  vi_5000_terraspark_boots: 5000,
  vi_5339_arcane_crystal: 5339,
  vi_5391_uncumbering_stone: 5391,
  vi_2585_slime_hook: 2585,
  vi_313_daybloom: 313,
  vi_267_guide_voodoo_doll: 267,
  vi_2649_steampunk_candle: 2649,
  vi_286_sticky_glowstick: 286,
  vi_3002_spelunker_glowstick: 3002,
  vi_4819_demon_conch: 4819,
  vi_1802_raven_staff: 1802,
  vi_3382_stardust_plate: 3382,
  vi_3270_item_frame: 3270,
  vi_3771_ancient_horn: 3771,
  vi_93_wood_wall: 93,
  vi_4281_finch_staff: 4281,
  vi_5407_star_royale_brick: 5407,
  vi_5401_lunar_rust_brick: 5401,
  vi_4716_mollusk_whistle: 4716,
  vi_3540_phantasm: 3540,
  vi_2176_shroomite_digging_claw: 2176,
  vi_2349_wrath_potion: 2349,
  vi_4679_morning_star: 4679,
  vi_1169_bone_key: 1169,
  vi_3863_betsy_mask: 3863,
  vi_3124_cell_phone: 3124,
  vi_3506_copper_axe: 3506,
  vi_4680_dark_harvest: 4680,
  vi_543_brown_pressure_plate: 543,
  vi_172_ash_block: 172,
  vi_171_sign: 171,
  vi_1723_living_wood_wall: 1723,
  vi_4754_grox_the_great_s_wings: 4754,
  vi_3353_mechanical_cart: 3353,
  vi_2287_winter_cape: 2287,
  vi_1179_chlorophyte_bullet: 1179,
  vi_4766_world_globe: 4766,
  vi_4954_celestial_starboard: 4954,
  vi_4730_ghostar_s_infinity_eight: 4730,
  vi_4758_blade_staff: 4758,
  vi_4765_tree_globe: 4765,
  vi_5342_ambrosia: 5342,
  vi_5328_chest_lock: 5328,
  vi_5343_peddler_s_satchel: 5343,
  vi_5285_moon_globe: 5285,
  vi_5289_minecart_upgrade_kit: 5289,
  vi_5336_advanced_combat_techniques_volume_two: 5336,
  vi_5451_kwad_racer_drone: 5451,
  vi_5359_shellphone_spawn: 5359,
  vi_3032_super_absorbant_sponge: 3032,
  vi_3031_bottomless_water_bucket: 3031,
  vi_509_red_wrench: 509,
  vi_4741_butcher_s_bloodstained_apron: 4741,
  vi_3065_star_wrath: 3065,
  vi_3063_meowmere: 3063,
  vi_3372_lunatic_cultist_mask: 3372,
  vi_1504_spectre_robe: 1504,
  vi_2769_cosmic_car_key: 2769,
  vi_216_shackle: 216,
  vi_4415_stone_door: 4415,
  vi_118_hook: 118,
  vi_1681_skeleton_banner: 1681,
  vi_283_seed: 283,
  vi_1173_grave_marker: 1173,
  vi_4379_wyvern_kite: 4379,
  vi_4378_xenon_moss: 4378,
  vi_4377_krypton_moss: 4377,
  vi_4376_rat_cage: 4376,
  vi_4375_rat: 4375,
  vi_4484_1_2_second_timer: 4484,
  vi_4824_wet_bomb: 4824,
  vi_4485_1_4_second_timer: 4485,
  vi_5378_cursed_flare: 5378,
  vi_5354_reflective_shades: 5354,
  vi_5387_raynbro_s_pants: 5387,
  vi_5386_raynbro_s_hoodie: 5386,
  vi_5390_raynbro_s_hood: 5390,
  vi_5338_aegis_fruit: 5338,
  vi_5404_cosmic_ember_brick: 5404,
  vi_5405_cryocore_brick: 5405,
  vi_5403_astra_brick: 5403,
  vi_346_safe: 346,
  vi_4829_cat_license: 4829,
  vi_3335_demon_heart: 3335,
  vi_4750_foodbarbarian_s_tattered_dragon_wings: 4750,
  vi_3042_phase_dye: 3042,
  vi_3024_skiphs_blood: 3024,
  vi_3054_shadowflame_knife: 3054,
  vi_5275_joja_cola: 5275,
  vi_5278_pomegranate: 5278,
  vi_5277_spicy_pepper: 5277,
  vi_5437_shellphone: 5437,
  vi_1507_spectre_hamaxe: 1507,
  vi_2250_steampunk_chest: 2250,
  vi_392_glass_wall: 392,
  vi_2699_weapon_rack: 2699,
  vi_3552_blue_flame_and_silver_dye: 3552,
  vi_5005_terraprisma: 5005,
  vi_4604_exotic_chew_toy: 4604,
  vi_4611_world_feeder_kite: 4611,
  vi_4649_blue_jellyfish_kite: 4649,
  vi_4796_dark_mage_s_tome: 4796,
  vi_4553_plasma_lamp: 4553,
  vi_4365_celestial_wand: 4365,
  vi_331_jungle_spores: 331,
  vi_2430_slimy_saddle: 2430,
  vi_4956_zenith: 4956,
  vi_2798_laser_drill: 2798,
  vi_2814_martian_chest: 2814,
  vi_210_vine: 210,
  vi_4371_yellow_kite: 4371,
  vi_4291_lemon: 4291,
  vi_2493_king_slime_mask: 2493,
  vi_1919_sugar_cookie: 1919,
  vi_1912_eggnog: 1912,
  vi_4023_grapes: 4023,
  vi_4792_the_black_spot: 4792,
  vi_529_red_pressure_plate: 529,
  vi_3066_smooth_marble_block: 3066,
  vi_183_glowing_mushroom: 183,
  vi_1103_slush_block: 1103,
  vi_2119_stone_slab: 2119,
  vi_593_snow_block: 593,
  vi_3081_marble_block: 3081,
  vi_1111_blue_berries: 1111,
  vi_1115_red_husk: 1115,
  vi_217_molten_hamaxe: 217,
  vi_122_molten_pickaxe: 122,
  vi_1827_bladed_glove: 1827,
  vi_2263_white_dynasty_wall: 2263,
  vi_330_obsidian_brick_wall: 330,
  vi_130_gray_brick_wall: 130,
  vi_2433_stone_slab_wall: 2433,
  vi_452_hornet_statue: 452,
  vi_453_bomb_statue: 453,
  vi_360_armor_statue: 360,
  vi_3711_wraith_statue: 3711,
  vi_438_star_statue: 438,
  vi_446_skeleton_statue: 446,
  vi_458_cross_statue: 458,
  vi_3655_scorpion_statue: 3655,
  vi_328_shadow_chest: 328,
  vi_2196_living_loom: 2196,
  vi_916_shadewood_work_bench: 916,
  vi_35_iron_anvil: 35,
  vi_36_work_bench: 36,
  vi_3240_tall_gate: 3240,
  vi_337_red_banner: 337,
  vi_3381_stardust_helmet: 3381,
  vi_1765_vampire_pants: 1765,
  vi_2859_lunar_cultist_robe: 2859,
  vi_2857_lunar_cultist_hood: 2857,
  vi_2998_summoner_emblem: 2998,
  vi_1175_headstone: 1175,
  vi_25_wooden_door: 25,
  vi_46_light_s_bane: 46,
  vi_352_keg: 352,
  vi_2340_minecart_track: 2340,
  vi_498_mannequin: 498,
  vi_4721_mushroom_beam: 4721,
  vi_819_living_wood_door: 819,
  vi_1458_obsidian_door: 1458,
  vi_3763_0x33_s_aviators: 3763,
  vi_176_mud_block: 176,
  vi_1569_vampire_knives: 1569,
  vi_857_sandstorm_in_a_bottle: 857,
  vi_2292_fiberglass_fishing_pole: 2292,
  vi_5238_constellation: 5238,
  vi_753_seaweed: 753,
  vi_5120_deer_thing: 5120,
  vi_5508_grim_old_barb: 5508,
  vi_5465_ram_rune: 5465,
  vi_5500_goat_s_tuft: 5500,
  vi_5499_froggy_neckband: 5499,
  vi_5507_balloony_beads: 5507,
  vi_5485_chicken_charm: 5485,
  vi_5502_cat_chime: 5502,
  vi_5504_turkey_wattle_necklace: 5504,
  vi_5506_crow_s_beak: 5506,
  vi_5503_dog_collar: 5503,
  vi_5534_fairy_choker: 5534,
  vi_5484_cow_bell: 5484,
  vi_5501_old_companion_locket: 5501,
  vi_5509_vampire_pendant: 5509,
  vi_5505_mean_goblin_s_spikes: 5505,
  vi_5525_cursed_piper_flute: 5525,
  // ---- 旧 UI 移除迁移补全（2026-08-09，全部 id 经 TEdit items.json 核实；
  //      木镐/木斧原版不存在，用铜镐 3509/铜斧 3506 代位） ----
};

/** 独立加载器共用 ImageBitmap 桥(二期,2026-08-14):
 *  用法:im.onload 里先照旧 set(Image),再调 upgradeToBitmap(im, b => map.set(k, b))
 *  ——消费方每帧重查,下一帧起拿到的就是自持解码像素;契约零变化 */
export function upgradeToBitmap(img: HTMLImageElement, onReady: (b: ImageBitmap) => void, onFail?: () => void): void {
  if (!SpriteAtlas.USE_BITMAP) return;
  tryBitmapUpgrade(img, bitmapLabel(img), onReady, () => onFail?.());
}

/** createImageBitmap 失败统计(2026-08-18;?imglog=1 / F5 可见)。
 *  ★压力窗口期(大世界进图/GPU 预算临界)失败并不罕见——此前静默回退 Image
 *  且【永不重试】= 每帧绘制的贴图(天空/群系背景)永久停在 Image 阶段,
 *  解码位图被逐出时反复 LazyPixelRef(trace 残余流 ~240/s 的主源) */
export const bmpFailStats = { count: 0, files: new Map<string, number>() };
function bitmapLabel(img: HTMLImageElement): string {
  const p = (img.src || '').split('/').filter(Boolean);
  return p.slice(-2).join('/');
}
const BMP_RETRY_DELAYS = [10_000, 20_000, 40_000];
const _bmpFailWarned = new Set<string>();
function noteBmpFail(label: string, attempt: number): void {
  bmpFailStats.count++;
  bmpFailStats.files.set(label, (bmpFailStats.files.get(label) ?? 0) + 1);
  // 每文件只警告一次(压力爆发期 50 张×3 重试=200 行会淹没警告环;计数仍全量入 stats)
  if (_bmpFailWarned.has(label)) return;
  _bmpFailWarned.add(label);
  console.warn(`[bitmap失败] ${label} — createImageBitmap 失败(GPU 压力窗口期常见),已回退 Image`
    + (attempt < BMP_RETRY_DELAYS.length ? `,${BMP_RETRY_DELAYS[attempt] / 1000}s 后自动重试` : ',放弃重试(重载页面可再试)'));
}
/** 带退避重试的升级:失败先让调用方落一次 Image(不缺图),10/20/40s 后重试;
 *  重试成功 onReady(bitmap) 把持有方的 Image 原地换掉。
 *  ★fallback 只在【首次失败】触发——后续重试失败不再重复落钩
 *  (ensureVImage 的 land 会发 onVImageLoaded→chunk 重烘,重复触发=重烘风暴) */
function tryBitmapUpgrade(
  img: HTMLImageElement, label: string,
  onReady: (b: ImageBitmap) => void, fallback: () => void, attempt = 0,
): void {
  let fellBack = false;
  const attemptOnce = (n: number): void => {
    // ★预乘位图：ImageBitmap 源忽略 UNPACK_PREMULTIPLY(见 loadAtlasFile 同注)——
    //  不预乘则 GL 预乘管线对直 alpha 数据双重变暗(沙漠背景暗晕根因)
    createImageBitmap(img, { premultiplyAlpha: 'premultiply' }).then((b) => {
      if (n > 0) console.log(`[bitmap重试成功] ${label}(第 ${n} 次)`);
      onReady(b);
    }, () => {
      if (!fellBack) { fellBack = true; fallback(); }
      noteBmpFail(label, n);
      if (n < BMP_RETRY_DELAYS.length) {
        setTimeout(() => {
          if (!(img.width > 0)) return;   // 图已被释放,放弃
          attemptOnce(n + 1);
        }, BMP_RETRY_DELAYS[n]);
      }
    });
  };
  attemptOnce(attempt);
}
/** 通用 bitmap-only 加载器(2026-08-17 修 trace⑨ 收尾两个真 bug):
 *  ①在飞守卫——此前未就绪期间每帧重 new Image = 请求风暴(雨/尘每粒子每帧)
 *  ②失败回退存 Image——此前失败静默 = 纹理永久缺(用户报"贴图丢失")
 *  ③(2026-08-18)失败回退非终态:退避重试,成功后 store(bitmap) 原地替换
 *  ④(2026-08-26)失败 TTL 负缓存(与 _uiFailed/_vImageFailed 同族)——发布形态
 *   sprites/vanilla 无散件(prune-dist 全裁,SW 分片暖缓存就位前 cache-miss →
 *   网络回退恒 404),而消费方(BiomeBackground.img/SkyRenderer.cloudTex 等全部
 *   16 处)都是绘制路径 if(!缓存) 调用:onerror 只清 pending 时每帧重发 =
 *   云族 ~60 req/s × N 文件的 404 风暴(2026-08-26 用户实报"进页面数千 404")。
 *   10s 冷却内直接早退,暖缓存落地后下个重试窗自愈 */
const _bmpOnlyPending = new Set<string>();
const _bmpOnlyFailed = new Map<string, number>();
const BMP_ONLY_FAIL_TTL = 10_000;
export function loadBitmapOnly(
  file: string, has: () => boolean, store: (x: ImageBitmap | HTMLImageElement) => void,
): void {
  if (has() || _bmpOnlyPending.has(file)) return;
  const failAt = _bmpOnlyFailed.get(file);
  if (failAt !== undefined) {
    if (Date.now() - failAt < BMP_ONLY_FAIL_TTL) return;
    _bmpOnlyFailed.delete(file);
  }
  _bmpOnlyPending.add(file);
  const im = new Image();
  im.onload = () => {
    const land = (x: ImageBitmap | HTMLImageElement) => {
      store(x);
      _bmpOnlyPending.delete(file);
      _bmpOnlyFailed.delete(file);
    };
    if (!SpriteAtlas.USE_BITMAP) { land(im); return; }
    tryBitmapUpgrade(im, file, (b) => land(b), () => land(im));
  };
  im.onerror = () => {
    _bmpOnlyPending.delete(file);
    _bmpOnlyFailed.set(file, Date.now());
  };
  im.src = `sprites/${file}`;
}

export const USE_BITMAP = SpriteAtlas.USE_BITMAP;
