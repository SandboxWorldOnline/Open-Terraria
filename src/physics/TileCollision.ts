// 分轴扫描 tile AABB 碰撞
import { TILE, GRAVITY } from '../core/constants';
import { TILE_DEFS, IGNORED_BY_NPC_STEP_UP_SHEETS } from '../data/tiles';
import type { World } from '../world/World';

// ★BJ94 D2（2026-09-16 渲染性能域分配普查）：applyStepUp 每调重建的【内容恒定】Set
// （scripts/_bj94-set-census.mjs 构造器计数子类法实锤：moveAndCollide 逐实体调用 =
//   每帧 ≥1 次——TownNPC 恒 1/帧+敌群 AI 走 physics 路径再叠加；字面量内容、
//   仅 .has 只读消费、引用不逃逸）→ 模块级单例提为纯常量（行为零差）。
// ★不挂 ?swperf 闸的判据：本提升属字面量外提级零语义（无任何行为面可回退），
//   而挂闸需 physics→render 的 perfFlags 交叉 import（本文件现有依赖仅
//   core/data/world）——为不新开层间边而保持无闸；与 Game.ts 挂闸三表判据分列。
/** IgnoredByNpcStepUp（TileID.cs:209：14 篝火桌?/469 Tables2/18 工作台/16 铁砧/134 秘银砧——NPC 不踏）
 *  ★BJ221 收编单源 data/tiles.ts:IGNORED_BY_NPC_STEP_UP_SHEETS（sheet 域转出口别名,§6k） */
export const NPC_STEPUP_IGNORE = IGNORED_BY_NPC_STEP_UP_SHEETS;

export interface Body {
  x: number; y: number;       // 左上角（px）
  w: number; h: number;
  vx: number; vy: number;
  onGround: boolean;
  hitWall: boolean;
  hitHead: boolean;
  /** 原版 collideY（NPC.cs:93804，Collision_MoveWhileDry `oldVelocity.Y != velocity.Y`）：
   *  本轴 tile 碰撞改写了 vy（落地/顶头清零）。★取值时点 = 分轴碰撞循环后、
   *  slopeCollide 之前——与原版 collideY 在 ApplyTileCollision 后、SlopeCollision 前
   *  写出的时序一致（坡面贴合清零 vy 不置位）。消费点：AI_001 携物梯
   *  :61309 气球弹跳 / :61932/:62124 落地嵌固回退（preCollideVy 配对读）。 */
  collideY?: boolean;
  /** 平台单向碰撞：仅当开启且下落时与平台碰撞 */
  dropThrough?: boolean;
  /** ★BJ608（2026-10-10）：平台嵌入驻留承接 opt-in——true 时越行块嵌入支
   *  （prevB∈(顶,顶+16]→拉回平台顶）才对本体生效。原版 TileCollision 无此承接
   *  （Collision.cs:2364 门+else 链 !tileSolidTop 三排=嵌入盒永不承接），唯一合法
   *  消费者=哨兵 spawn 嵌入驻留（Player.cs:50045-50063+MinionProj 置位面）。 */
  embedPlatSnap?: boolean;
  /** ★BJ609（2026-10-10）：fallThrough 慢放行/快承接半边（原版 fallThrough≠fall2 拆分）。
   *  原版 Player.cs:28296 `fallThrough = controlDown` 按 S 期平台【非全量放行】——
   *  Collision.cs:2391 门 `(!(solidTop&fallThrough) || !((vy≤1)|fall2))`：isPlat∧fallThrough
   *  时 vy≤1（慢速）放行、vy>1（快速）仍承接（高速下落逐级被平台接住=原版逐级阶梯下降）。
   *  fall2（ignorePlats，Player.cs:28298 GoingDownWithGrapple/pulley/mount.Cart/gravDir=-1）
   *  =平台整体不承接，与 fallThrough 两语义（原版 Projectile.cs:17705-17721/NPC.cs:93867
   *  Collision_MoveNormal 均以 (flag6,flag6)/(fall,fall) 双参=永不承接）。
   *  本仓 Body.dropThrough 历史语义=「平台永不承接」（≡原版双参合流），弹体/NPC/随从/
   *  钩爪下拉/爬墙各源照旧零改；本字段【仅】玩家 inputDown 源置 true（Player.ts 每拍写，
   *  gravDir=-1 时原版强 fall2 故不置）——平台门读到 dropThrough∧platFallThrough 同置时
   *  vy>1 仍承接（原版 :2391 后半）。 */
  platFallThrough?: boolean;
  /** slopeEmbedRevert 回退锚:moveAndCollide 入口处记录的本 tick 移动前位置 */
  px?: number; py?: number;
  /** Projectile.tileCollide 镜像（AI 逐态直写,如蜘蛛 :62843-62860 穿平台/归位飞行
   *  :61410、蛙 :50648/:51266）——false 时 Collision.TileCollision 整段跳过、位移直写
   *  （原版弹幕 Update :17000+ 同构）。缺省 true=照常碰撞 */
  tileCollide?: boolean;
  /** 启用原版自动上台阶（Collision.StepUp）：行走实体（玩家/敌人/小动物/城镇NPC）置 true；
   *  掉落物/弹幕/墓碑等不参与（原版它们不调 StepUp） */
  stepUp?: boolean;
  /** StepUp holdsMatching（Collision.StepUp 第 8 参）：true 时允许把站台面
   *  （tileSolidTop 顶行：平台/桌子/铁砧/笼子…）当落脚格抬升——玩家传 controlUp
   *  （Player.cs:23258/:27753）。★对抗修复批③2026-09-01（NPC.cs:54513-54527）：
   *  城镇 NPC 该参【不是】恒 true——原版传的是每拍计算的 flag22（家平线门：
   *  homeTileY*16−32 > position.Y ⇔ 本体高于家线 32px+ 时 false→holds=false,
   *  不再踏站台面）；TownNPC.fixedUpdate 每 tick 按 flag22 写本字段，其余族仍恒 true。 */
  stepUpHolds?: boolean;
  stepUpNpc?: boolean;
  /** ★SW-FX34：重力方向（Collision.StepUp/Down 第 7 参 `(int)gravDir`，Player.cs:28271/
   *  28275/:23719-23726 传入；Collision.cs:3641 签名缺省 1）。缺省/1 = 原版 gravDir=1
   *  半边（现有实现逐位不变）；仅反重力玩家写 -1（Player.fixedUpdate 每 tick 同步）。
   *  NPC/掉落物/弹幕族不写 = 恒 1 半边。 */
  gravDir?: 1 | -1;
  /** ★SW-FX34：倒挂 StepUp 每 tick 门（Player.cs:28273-28275 `(carpetFrame != -1 ||
   *  velocity.Y <= gravity) && !controlUp`——玩家侧算好传入；Body 无输入/飞毯语境）。
   *  仅 gravDir=-1 且本 tick 满足门时为 true；gravDir=1 消费面照旧走 vy>=0 通用门。 */
  stepUpInvGate?: boolean;
  /** ★SW-RB14d：正挂 StepUp 速度门（Player.cs:28276 `(carpetFrame != -1 ||
   *  velocity.Y >= gravity)`）——玩家侧逐 tick 预计算传入：stepUpCarpet=毯展开腿
   *  （仓承载 carpetTime>0∧controlJump,同 stepUpInvGate 的毯腿 :22031）；/
   *  stepUpVeloFloor=gravity 字段值（gField,深度缩水带 0.4×num6）。
   *  缺省 undefined = NPC 族门字面 `velocity.Y >= 0`（NPC.cs:54525）逐位不变。
   *  旧消费者恒用 `vy >= 0`：[0,gravity) 窗（水行 vy=0/悬停/跳顶点 vy≈0+）原版
   *  不过门却上探（跳顶点横越台阶="空中踏步"）,飞毯缓降（vy=−0.4）原版可探却
   *  被拦,双向各偏一次。 */
  stepUpCarpet?: boolean;
  stepUpVeloFloor?: number;
  /** ★SW-FX34：本 tick Y 轴向下被拦（原版 Collision.down，Collision.cs:2398-2410）。
   *  moveAxis dir>0 阻挡置位、moveAndCollide 头部复位。原版 Update :28467-28471
   *  `gravDir==-1 && Collision.down → velocity.Y=-0.01; jump=0`（倒挂顶头）消费。 */
  hitDown?: boolean;
  /** GetTileCollisionParameters 底对齐缩盒（NPC.cs:93950-93983,IIIII235 2026-09-10）：
   *  逐类型 cHeight 缩减量（px）——290 圣骑士 cHeight=40 → inset=62−40=22。
   *  moveAndCollide 管线期间整盒下移 inset+盒高缩减（feet 不变,盒顶下移）,
   *  出口还原（详 moveAndCollide 入口/出口注）。undefined=全盒（原版缺省路径） */
  collTopInset?: number;
  /** StepDown 触发门。原版两处均为 == 精确等值（NPC.cs:54374 velocity.Y==0、
   *  Player.cs:23252 velocity.Y==gravity）——语义 = 仅"贴地行走"吸附,空中实体不吸附。
   *  本仓 NPC 族重力在碰撞【前】累加（贴地时 vy=GRAVITY≠0）,故 NPC 门取语义等价的
   *  onGround；玩家取原版字面 vy===GRAVITY（'gravity'）。
   *  'never' = 恒不吸附：AI_007 的 !flag22 门取反形（NPC.cs:54518 `!flag22 && vy==0`
   *  才调 Collision.StepDown——flag22 为真〔本体不低于「家平线−32px」〕时不吸附；
   *  TownCritter 族 homeTileY=-1 ⇒ flag22 恒真 ⇒ 即本档,2026-08-19；★对抗修复批③
   *  起城镇 NPC 全体由 TownNPC.fixedUpdate 按 flag22 三态写本字段）。
   *  ★曾用 vy>=0 宽门：低空飞行小动物（萤火虫/蝴蝶平飞 vy≥0）脚下 7~17px 有落面
   *  即被瞬移按压 → "怪力按地+闪现"周期循环（飞行 AI 抬升后再次触发） */
  stepDownGate?: 'grounded' | 'gravity' | 'never';
  /** ★BJ703-C D1（2026-10-21）：WalkDownSlope 预备阶段显式 opt-out。stepDownGate
   *  的 'never' 档【只】门 StepDown（flag22 语义,NPC.cs:54518-21）——原版 NPC 的
   *  Collision_WalkDownSlopes 无条件跑（UpdateCollision 首步 :93667,内门 vy==gravity
   *  Collision.cs:1695）,玩家 SlopeDownMovement 也仅 mount48/shimmering 豁免
   *  （Player.cs:23607）。'never' 档此前把本阶段连带拦截 = aiStyle-7 小动物/TownNPC
   *  flag22-true 下坡贴地缺失;解耦后仅本旗 true 才跳过（玩家载具态=保守档,原版
   *  矿车/贴轨照跑 SlopeDownMovement——登记债 BJ703-C D8）。 */
  walkDownSlopeOff?: boolean;
  /** ★BJ227：Collision.StepDown 第 8 参 waterWalk（Player.cs:23717/:28267 两处调用均传
   *  `waterWalk || waterWalk2`——水上行走族走下台阶时把【液面】也当 7~17px 吸附窗内
   *  落面（Collision.cs:3603-3610 液面臂，liquid>0 且上格无液）。玩家 fixedUpdate 每
   *  tick 写（waterWalk∪waterWalk2∪水上行走药水 buff15，gravDir==-1 时原版
   *  :27866-27869 整旗清零故写 false）；NPC/其他体不写 = 缺省 false 逐位不变。 */
  stepDownWaterWalk?: boolean;
  /** 液体位移减速因子（原版 waterMovementSpeed 族，NPC.cs:5946：水/岩浆 .5、蜂蜜 .25、
   *  微光 .375；dry=1）。Entity 基类缺省 1，Enemy 侧由 npcLiquid.updateNpcLiquid 写入 */
  liqFactor?: number;
  /** 湿身态（NPC.wet 碰撞盒触液）。unembedPass 对 wet 体整段跳过——水中嵌入由
   *  原版浮力/水物理接管（AI_001 wet 段 cs:61877/62080），兜底踢入水中=非原版扰动 */
  wet?: boolean;
  /** ★BJ647（2026-10-12）：城镇 NPC 坐姿态（AI_007 ai[0]==5 族）。unembedPass 对
   *  sitPose 体整段让位——原版坐锚 Bottom=(x*16+8+2*dir, y*16(+16))（NPC.cs:53285-86
   *  /:55972-75）无净空门,贴墙椅（frameX 档朝墙侧 +2px）钉位后盒缘合法嵌墙 1-4px;
   *  原版全文无 unembed 等价机制,vx=0 坐姿无位移=无碰撞响应=嵌墙稳定坐（Bottom−2px
   *  探针恒椅格,坐满 900+rand(10800)）。横推把探针格打到邻列 → canSitAt 失败起身 →
   *  夜间回家臂走回再坐 = 用户实录「走到右侧瞬移到左侧重新走路」循环。
   *  ★撞名规避：独立 sitPose 不用 sitting——Player.sitting（Player.ts:2196,坐姿
   *  交互态,每拍 moveAndCollide(this)）不得触发本让位面。TownNPC.fixedUpdate 头部
   *  每 tick 同步 this.sitPose = this.sitting */
  sitPose?: boolean;
  /** 连续中心格嵌入 tick 计数（unembedPass 延迟门用；脱出/未嵌入即复位） */
  embedTicks?: number;
  /** 本嵌入会话（embedTicks 未清零期）topEmbedded 横推已消耗预算 px
   *  （2026-09-01 tent 弹飞收敛帽；脱出即清零） */
  embedPushed?: number;
  /** 原版 Collision.TileCollision 第 10 参 hoik（★Collision.cs:2299 形参缺省【true】，
   *  旧注"默认 false"系误读=2026-09-01 tent 案定谳错误的病灶）。原版消费面:玩家
   *  Player.cs:23791 传 `!flag`(20×42 恒 true)、NPC.cs:93868/:93881/:93904 不传吃
   *  缺省 true、Projectile.cs:17822 快速弹幕 hoik=true。★SW-FX34b 2026-09-15 起
   *  玩家侧恢复 true(Player.hoik 字段);Body 缺省仍 falsy=NPC 族 2026-09-01 登记
   *  债维持关(tent 悬臂案例:幽灵入场+hitWall 恒 false——其弹飞本体已由 unembed
   *  收敛帽 fix,入场半边实为原版本体行为)。★SW-FX34c 2026-09-18（用户实报"玩家
   *  能过单向墙、弹幕过不了"）弹幕域恢复 true:Projectile.HandleMovement(:17578)
   *  全路径 hoik=true——高速子步进显式 bool hoik=true(:17822-23→:17852 传参),
   *  慢速干路(:17960)/湿路三支(:17726/:17740/:17754)/aiStyle10 四支(:17705-18)
   *  不传该参吃缺省 true;无 owner 豁免(friendly/hostile 同相)。1456/1457/1458
   *  三树同相（1456 Projectile.cs:16376/:16405、1458 Projectile.cs:17823/:17852）。
   *  先例:DirtBallProj SW-AL2 F-3(aiStyle10 族)/本字段注。 */
  hoik?: boolean;
  /** ★SW-FX34c 2026-09-18：hoik 跨格态自由通行的【无条件】豁免旗（原版跨格态
   *  =无任何推离,Collision.cs:2437-2456 各支前提以移前盒判定、跨格态全假,与齿列
   *  无关）。玩家侧 fx34b 即此语义（本仓 Player 置 true=原样保留）;弹幕域 hoik
   *  开启后【缺省不置位】=跨格态仍要求身后格坡邻配对（与入口门同判据）——
   *  单向墙穿行期身后格恒为齿列→通行不受影响;而 fx 时代"止步"容器
   *  （2026-09-01 穿门定罪两案:旋刃 38×38 盒心落玩家中心贴脸对门、斜下先入柱
   *  再压门带——原版对跨格态同样无推离=原版本体相,本仓因盒心落玩家中心的
   *  出膛几何刻意收窄）得以保留。置 true 仅限原版无条件跨格自由半边的
   *  已定谳体（现=Player）。 */
  hoikAcrossFree?: boolean;
  /** ★SW-BJ6 2026-09-07：vanilla 嵌固回退漂移活跃旗（AI_001 NPC.cs:62139/:62331
   *  `position.X -= velocity.X + direction` 本拍刚执行时由 AI 置位）。
   *  unembedPass 读到即整段让位并清位（consume-once）——原版无任何 unembed 等价
   *  机制，嵌入体由该漂移每拍 1px 自行解卡（坡角相移穿越即此通道），本仓
   *  unembed 在漂移中段的弹射属非原版瞬移。仅 AI_001 史莱姆两处写点。 */
  unwedgeDrift?: boolean;
  /** ★斜坡 G2 门入口快照（2026-08-31 统一阻尼修复）：moveAndCollide 每 tick 在
   *  速度辅助/分轴解析【前】记录——slopeCollide 的贴合门用（原版
   *  `y = Position.Y + Velocity.Y`，Collision.cs G2 `Position.Y + num7 < y`） */
  vyEntry?: number;
  feetEntry?: number;
  /** ★SW-FX40（h2）：原版 Player.gravity 字段拍末值（:24559 复位 0.4f → :24884
   *  `gravity *= num6` 深度缩水 → 慢Fall 链 :27228/:27232 `gravity=gravity/3f*gravDir`
   *  签名改写）。StepDown 门（Player.cs:28265 `velocity.Y == gravity`）、StepUp 倒挂
   *  门（:28271 `velocity.Y <= gravity`）、WalkDownSlope 参（:23610 `gravity*gravDir`）
   *  全读此字段——旧常数字面 GRAVITY 在深度缩水带（num6<1，太空/低重力带）与贴地
   *  实际 vy 错位 → 门恒哑。缺省 undefined → 回退 GRAVITY（Body 级测试/非玩家实体
   *  旧行为逐位不变）。 */
  gField?: number;
}

/** Collision.StepUp（Collision.cs:3641-3770，gravDir=1、holdsMatching=false）：
 *  水平行走【意图速度】先探前方一列 → 满足净空门即抬升最多 16.1px
 *  （半砖 8px / 整砖台阶 16px）。玩家（Player.cs:23258/:27753）与全部 NPC
 *  （NPC.cs:54382，先于 TileCollision 用未受阻的速度调用）共用——
 *  此前只有玩家有自研版上台阶，敌人/小动物/城镇 NPC 全部卡死在半砖/台阶。
 *  gfxOffY 视觉缓动无对应渲染通道，位置直接抬升（原版 NPC 同样瞬间抬）。 */
function applyStepUp(b: Body, world: World, holds: boolean, npcMode: boolean): void {
  const vx = b.vx;
  if (vx === 0) return;
  const dir = Math.sign(vx);
  const st = world.store;
  const probeX = b.x + vx;                       // vector.X = position.X + velocity.X
  const num2 = Math.floor((probeX + b.w / 2 + (b.w / 2 + 1) * dir) / TILE);
  const num3 = Math.floor((b.y + b.h - 1) / TILE); // 脚底行（gravDir=1）
  const num4 = Math.floor(b.h / TILE) + (b.h % TILE !== 0 ? 1 : 0);
  if (!st.inBounds(num2, num3) || num3 >= st.h - 40) return;
  const solidAt = (x: number, y: number): boolean =>
    st.inBounds(x, y) && st.isSolid(x, y);       // 平台非 tileSolid → 不阻挡（vanilla 语义）
  const halfAt = (x: number, y: number): boolean =>
    st.inBounds(x, y) && !!st.half[st.idx(x, y)];
  const slopeAt = (x: number, y: number): number =>
    st.inBounds(x, y) ? st.slope[st.idx(x, y)] : 0;
  // 站台面（:3713 holdsMatching 门 = `(tileSolidTop&&frameY==0) || Platforms(19/427/
  //  435-439) || type==380`）——★不含 239 矿锭（可站可下穿但 StepUp 不踏），
  //  在 isPlatform（平台行为族含 239）基础上排除
  const platAt = (x: number, y: number): boolean => st.inBounds(x, y) && st.isPlatform(x, y)
    && TILE_DEFS[st.type[st.idx(x, y)]]?.vanilla?.sheet !== 239;
  // IgnoredByNpcStepUp 集已提为模块级 NPC_STEPUP_IGNORE（★BJ94 D2——每调 1 次构造消除）
  const sheetAt = (x: number, y: number): number => {
    const d = st.inBounds(x, y) ? TILE_DEFS[st.type[st.idx(x, y)]] : undefined;
    return (d as unknown as { vanilla?: { sheet?: number } })?.vanilla?.sheet ?? -1;
  };
  // flag（:3700-3708）：身体放入探柱（j=2..num4 上方行全净空）
  for (let j = 2; j <= num4; j++) if (solidAt(num2, num3 - j)) return;
  // flag2（:3710-3714）：后上方对角净空
  if (solidAt(num2 - dir, num3 - num4)) return;
  const centerX = b.x + b.w / 2;
  // flag3（:3725-3728）：脚上一格净空 / 面朝坡 / 半砖且其上净空
  {
    const s = slopeAt(num2, num3 - 1);
    const ok = !solidAt(num2, num3 - 1)
      || (s === 1 && centerX > num2 * TILE)
      || (s === 2 && centerX < num2 * TILE + TILE)
      || (halfAt(num2, num3 - 1) && !solidAt(num2, num3 - num4 - 1));
    if (!ok) return;
  }
  // flag4（:3713-3721）：落脚格实心（面朝坡且身体沉入）/ 或脚上一格是半砖 /
  //   holdsMatching 站台面落脚（(solidTop&&frameY==0)||Platforms||type==380，
  //   上一格非实心且非站台（flag4 &= !solidTop[type]||!solidTop[tile2]），NPC 排除集）
  {
    const fs = slopeAt(num2, num3);
    const topSlope = fs === 1 || fs === 2;
    const a = solidAt(num2, num3)
      && (!topSlope || (fs === 1 && centerX < num2 * TILE) || (fs === 2 && centerX > num2 * TILE + TILE))
      && (!topSlope || b.y + b.h > num3 * TILE);
    const bb = halfAt(num2, num3 - 1) && solidAt(num2, num3 - 1);
    const cc = holds && platAt(num2, num3)
      && !solidAt(num2, num3 - 1)
      && !platAt(num2, num3 - 1)
      && (!npcMode || !NPC_STEPUP_IGNORE.has(sheetAt(num2, num3)));
    if (!(a || bb || cc)) return;
  }
  // X 重叠门（:3745-3748）：探柱与移动后身体横向相交
  if (!(num2 * TILE < probeX + b.w && num2 * TILE + TILE > probeX)) return;
  // 抬升（:3750-3770）：半砖上一格 → rowTop-8；本格半砖 → rowTop+8；上限 16.1px
  let target = num3 * TILE;
  if (halfAt(num2, num3 - 1)) target -= 8;
  else if (halfAt(num2, num3)) target += 8;
  if (target >= b.y + b.h) return;
  if (b.y + b.h - target > 16.1) return;
  b.y = target - b.h;
}

/** ★SW-FX34 Collision.StepUp 反重力半边（Collision.cs:3641-3779 的 `gravDir != 1`
 *  else 支，1457 逐值）：倒挂玩家沿天花板行走时「上台阶」= 探柱在身体【顶行】
 *  （num3=(y+0.1)/16），落脚格在探柱列、台阶面向下凸出 → 身体整体【下移】
 *  num7=num3*16+16（顶边贴台阶格底），并清 vy（:3773 `velocity.Y = 0f`）。
 *  与 gravDir=1 半边的语义差（原文如此,非省略）：
 *  · flag3 的坡面豁免是「任意 slope!=0」（:3733 `tile.slope() != 0`）——normal 半边
 *    是 slope1/2 各带 centerX 侧别门；
 *  · flag4 无 topSlope 侧别/沉入附加门（:3737-3741）；
 *  · 终门多两腿：头行 bottomSlope（坡 3/4）拒踏、tile2（头行下一行）为平台拒踏
 *    （:3770-3772）；
 *  · 抬升写 position.Y=num7 + velocity.Y=0（normal 半边不写 vy）。
 *  holdsMatching 的 frameY==0 沿用本文件 normal 半边的近似（平台上方无平台；
 *  倒挂镜像 = 头行下一行无平台）。X 重叠门/探列算法与 normal 半边同式。 */
function applyStepUpInv(b: Body, world: World, holds: boolean): void {
  const vx = b.vx;
  if (vx === 0) return;                           // 与 normal 半边同门（vanilla num=0 探中列,仓制早退）
  const st = world.store;
  const probeX = b.x + vx;                        // vector.X = position.X + velocity.X
  const dir = Math.sign(vx);                      // num
  const num2 = Math.floor((probeX + b.w / 2 + (b.w / 2 + 1) * dir) / TILE);
  const num3 = Math.floor((b.y + 0.1) / TILE);    // 身体顶行（:3663 `(int)((double)vector.Y + 0.1) / 16`）
  const num4 = Math.floor(b.h / TILE) + (b.h % TILE !== 0 ? 1 : 0);
  if (!st.inBounds(num2, num3) || num3 >= st.h - 40) return;   // :3666-3668
  // 存在性门（:3673-3686）：顶行下 i=1..num4+1 行、对角列 num3+num4 行须在界内
  // （原版 !InWorld || tile==null → return；仓制 store 无 null 格 → 越界=return）
  for (let i = 1; i < num4 + 2; i++) {
    if (!st.inBounds(num2, num3 + i)) return;
  }
  if (!st.inBounds(num2 - dir, num3 + num4)) return;
  // flag（:3700-3708 镜像）：探柱内身体下方行 j=2..num4 全净空
  for (let j = 2; j <= num4; j++) if (solidAtInv(st, num2, num3 + j)) return;
  // flag2（:3710-3714 镜像）：对角格净空
  if (solidAtInv(st, num2 - dir, num3 + num4)) return;
  // flag3（:3729-3735）：头行下一格净空 / 任意坡 / 半砖且再下一格净空
  {
    const s = slopeAtInv(st, num2, num3 + 1);
    const ok = !solidAtInv(st, num2, num3 + 1)
      || s !== 0
      || (halfAtInv(st, num2, num3 + 1) && !solidAtInv(st, num2, num3 + num4 + 1));
    if (!ok) return;
  }
  // flag4（:3736-3741）：头行=阻挡实心 / holdsMatching 站台面顶（下一行非实心非平台）/
  //   下一行是半砖
  {
    const a = solidAtInv(st, num2, num3);
    const cc = holds && platAtInv(st, num2, num3)
      && !solidAtInv(st, num2, num3 + 1) && !platAtInv(st, num2, num3 + 1);
    const bb = halfAtInv(st, num2, num3 + 1) && solidAtInv(st, num2, num3 + 1);
    if (!(a || cc || bb)) return;
  }
  // X 重叠门（:3745-3748 同式）
  if (!(num2 * TILE < probeX + b.w && num2 * TILE + TILE > probeX)) return;
  // 终门（:3770-3772）：头行 bottomSlope（坡 3/4）拒踏；下一行平台拒踏
  const headSlope = slopeAtInv(st, num2, num3);
  if (headSlope === 3 || headSlope === 4) return;
  if (platAtInv(st, num2, num3 + 1)) return;
  // 抬升（:3773-3779）：身体顶边贴台阶格底（num7=num3*16+16），≤16.1px 才生效,清 vy
  const num7 = num3 * TILE + TILE;
  if (!(num7 > b.y)) return;
  if (num7 - b.y > 16.1) return;
  b.y = num7;
  b.vy = 0;
}

// —— applyStepUpInv 辅助谓词（与 applyStepUp 内联版同语义,提为独立小函数避免
//    触碰 normal 半边已验证的实现体）——
function solidAtInv(st: World['store'], x: number, y: number): boolean {
  return st.inBounds(x, y) && st.isSolid(x, y);
}
function halfAtInv(st: World['store'], x: number, y: number): boolean {
  return st.inBounds(x, y) && !!st.half[st.idx(x, y)];
}
function slopeAtInv(st: World['store'], x: number, y: number): number {
  return st.inBounds(x, y) ? st.slope[st.idx(x, y)] : 0;
}
function platAtInv(st: World['store'], x: number, y: number): boolean {
  return st.inBounds(x, y) && st.isPlatform(x, y)
    && TILE_DEFS[st.type[st.idx(x, y)]]?.vanilla?.sheet !== 239; // 239 矿锭不踏（同 applyStepUp）
}

/** 格子的半砖碰撞盒（原版 Collision.cs:1320-1324 三处一致）：下半 8px。
 *  返回 null = 非实心；[top, bottom] = 碰撞盒的像素 y 区间 */
function solidSpan(world: World, tx: number, ty: number): [number, number] | null {
  const st = world.store;
  if (!st.isSolid(tx, ty)) return null;
  const top = ty * TILE + (st.half[st.idx(tx, ty)] ? 8 : 0);
  return [top, (ty + 1) * TILE];
}

/** Collision.StepDown（Collision.cs:3577-3638，gravDir=1、waterWalk=false）：
 *  贴地行走时脚下 7~17px 内有落面（半砖顶/台阶/平台）→ 直接吸附下去，
 *  消除下楼梯的腾空帧（onGround 连续，AI 跳跃/攻击门不抖动）。
 *  玩家（Player.cs:23252，vy==gravity 时）与 NPC（NPC.cs:54377，vy==0 时）共用。 */
function applyStepDown(b: Body, world: World): void {
  const vx = b.vx;
  if (vx === 0) return;
  const st = world.store;
  const probeX = b.x + vx;                          // vector.X = position.X + velocity.X
  // vector.Y = ⌊(y+h)/16⌋×16 - h（:3581 先把脚底吸附到格线）
  const snapY = Math.floor((b.y + b.h) / TILE) * TILE - b.h;
  const rowA = Math.floor((snapY + b.h + 4) / TILE); // num3（:3585）
  const col0 = Math.floor(probeX / TILE), col1 = Math.floor((probeX + b.w) / TILE);
  const num4 = Math.floor(b.h / TILE) + (b.h % TILE !== 0 ? 1 : 0);
  let best = (rowA + num4) * TILE;                  // num5 初始（远下方默认）
  for (let i = col0; i <= col1; i++) {
    for (let j = rowA; j <= rowA + 1; j++) {
      if (!st.inBounds(i, j)) continue;
      const ji = st.idx(i, j);
      // ★BJ227 液面落面臂（Collision.cs:3603-3610，waterWalk 形参门）：水行族走下台阶
      // 时把液面（liquid>0 且上格无液）也算吸附落面——num7=液面像素高、num8=液面 Y。
      // 原版无液体种别排除（岩浆同样吸附——waterWalk 形参=waterWalk||waterWalk2 照抄）；
      // 相交盒用原 position（非探针 x,:3607 Rectangle(position.X,...)），与实心臂同一
      // FloatIntersect 形状（i*16, j*16-17, 16, 16）。
      if (b.stepDownWaterWalk && st.liquid[ji] > 0 && (j === 0 || st.liquid[st.idx(i, j - 1)] === 0)) {
        const num7 = Math.floor(st.liquid[ji] / 32) * 2 + 2;
        const num8 = j * TILE + TILE - num7;
        if (i * TILE < b.x + b.w && i * TILE + TILE > b.x
          && j * TILE - 17 < b.y + b.h && j * TILE - 17 + TILE > b.y && num8 < best) {
          best = num8;
        }
      }
      if (!(st.isSolid(i, j) || st.isPlatform(i, j))) continue; // tileSolid||tileSolidTop（:3614）
      let top = j * TILE;
      if (st.half[ji]) top += 8;                    // 半砖顶 +8（:3618-3621）
      // FloatIntersect(tile 行, 以原 position 判定 :3623)
      if (i * TILE < b.x + b.w && i * TILE + TILE > b.x
        && j * TILE - 17 < b.y + b.h && j * TILE - 17 + TILE > b.y && top < best) {
        best = top;
      }
    }
  }
  const gap = best - (b.y + b.h);                   // num10（:3630）
  if (gap > 7 && gap < 17) b.y = best - b.h;        // :3632-3637
}

/** 单个轴的移动 + 碰撞解析。返回是否发生碰撞。 */
function moveAxis(b: Body, world: World, dx: number, dy: number): { hitX: boolean; hitY: boolean } {
  let hitX = false, hitY = false;
  const st = world.store;
  const avx = Math.abs(b.vx);
  // 原版坡面放行门（Collision.cs:2361-2387 flag3）：从高/低侧贴面走近的坡面格
  // 不参与本轴碰撞（交给 slopeCollide 对角线贴合）。全部以【移动前】位置判定
  // （原版 vector3,:2306）——传参 ox/oy,勿用移动后的 b.x/b.y。
  // 地面坡门是 feet-|vx| <= 格底(top+16,:2375/:2379 的 num7=格高)——不是格顶!
  // 写成格顶会让低侧贴地进入永远不过 → 孤立坡前一格被 X 拦截卡死。
  // slope1 左高右低 / 2 右高左低 / 3 左低右高(天花板) / 4 右低左高(天花板)
  const slopePass = (tx: number, ty: number, ox: number, oy: number): boolean => {
    const j = st.idx(tx, ty);
    const sl = st.slope[j];
    if (sl === 0 || st.half[j]) return false;
    const top = ty * TILE;
    if (sl === 1) return oy + b.h - avx <= top + TILE && ox >= tx * TILE;
    if (sl === 2) return oy + b.h - avx <= top + TILE && ox + b.w <= tx * TILE + TILE;
    if (sl === 3) return oy + avx >= top && ox >= tx * TILE;
    return oy + avx >= top && ox + b.w <= tx * TILE + TILE; // 4
  };
  // X 轴
  if (dx !== 0) {
    b.x += dx;
    const dir = Math.sign(dx);
    const oldX = b.x - dx; // 本步移动前位置（原版 vector3）
    const edgeX = dir > 0 ? b.x + b.w : b.x;
    const tx = Math.floor(edgeX / TILE);
    const y0 = Math.floor(b.y / TILE), y1 = Math.floor((b.y + b.h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (slopePass(tx, ty, oldX, b.y)) continue;
      const span = solidSpan(world, tx, ty);
      // 半砖只占下半：身体底部没超过半砖顶面（ty*16+8）则不拦
      if (span && b.y + b.h > span[0]) {
        // 原版拦截前提（:2406/:2426）：上一位置【完全】在该格一侧（贴面接近）才拦；
        // 身体已横向跨在格上（上坡爬升中段,脚沉在斜面下）不拦——交给 slopeCollide
        // 抬升,否则上坡会被每帧推回卡死。
        // ★2026-09-01 穿门定罪收窄：跨格豁免此前对【全部】图格生效 → 普通整块
        //   （slope0 非半砖,如闭合门 door_closed/箱柜架体）只要身体在进入该列前
        //   就已横向跨在其上,此后逐子步全部放行 = 整体穿墙。实锤两案：
        //   ① 荆棘旋刃 38×38 盒心落玩家中心(Projectile.cs:1154-1163 width/height=38),
        //     贴脸对关闭门掷出时出生盒右缘越门柱内 9px → 全程 hw=false 直穿;
        //   ② 斜下轨迹以行未重叠姿态先入柱、再下行压入门带 → 同理跨格态永拦失效。
        //   修法：跨格态仅对坡(slope≠0)/半砖(half)维持放行(其几何由 slopeCollide
        //   对角贴合接管);普通整块改为【止步不回拉】——抵消本子步横移冻结在移前位,
        //   不做整身回钳（嵌深任意大时回钳=瞬移,走滑下坡接平地的脚线沉降帧会被拽）。
        //   与原版可观测结果一致(vanilla TileCollision :2355 目标盒相交 + Vector3 跨格
        //   双支全假时同样无推离,但 vanilla 弹幕 Update 逐帧原速复位,玩家盒 20 宽中心
        //   出膛不会跨进邻柱;本仓旋刃族盒尺寸放大后必须引擎层兜底)。closeDoor 有
        //   EmptyTile 占格拒关门(Door.ts blocked 回调),关门压人不由此触发。
        const jw = st.idx(tx, ty);
        const wasAcross = dir > 0 ? oldX + b.w > tx * TILE + 0.01 : oldX < (tx + 1) * TILE - 0.01;
        if (wasAcross) {
          if (st.slope[jw] !== 0 || st.half[jw]) continue; // 坡/半砖跨格态:原放行语义不变
          // ★SW-FX34b hoik 嵌格自由通行（vanilla Collision.cs:2437-2456 分支全以
          //  【移前】盒判定:盒已与该格横向重叠 → 左/右撞墙支前提
          //  `vector3.X+Width<=vector4.X` / `vector3.X>=vector4.X+16` 均假,
          //  下/顶支亦不命中 → 原版对嵌格【无任何推离】,本子步位移照常生效。
          //  这是 hoik 穿越的后半程:坡邻豁免(:2412/:2432)放进入口后,靠本语义
          //  横穿实心柱、从对侧走出（wiki 水平单向墙"glitch into the attached
          //  block"）。
          //  ★SW-FX34c 2026-09-18 收窄分档：弹幕域 hoik 开启后（Body.hoik 注,
          //  原版 Projectile 全路径 hoik=true→单向墙可穿）若继续无条件跨格,
          //  fx 时代"止步"容器（2026-09-01 穿门定罪案①②,本函数下文）被整条
          //  架空=贴脸对门直穿复活。收窄=弹幕（未置 hoikAcrossFree）跨格态
          //  仍要求【身后格坡邻配对】（与下方入口门同判据——单向墙穿行期
          //  身后格恒为齿列,1 厚墙全程通行不受影响;穿门案身后格为空气→
          //  止步照旧）。玩家 Player.hoikAcrossFree=true=fx34b 无条件原样。
          if (b.hoik) {
            if (b.hoikAcrossFree === true) continue;
            const biA = tx - dir;
            const bsA = biA >= 0 && biA < st.w ? st.slope[st.idx(biA, ty)] : 0;
            if (dir > 0 ? (bsA === 2 || bsA === 4) : (bsA === 1 || bsA === 3)) continue;
          }
          b.x -= dx;                                       // 整块跨格态:止步(移前位),零回拉
          b.vx = 0;
          hitX = true;
          break;
        }
        // hoik 坡链放行（:2412/:2432）：身后格是配套坡面（同向坡链中段）→ 不拦。
        // ★原版为 TileCollision 形参（Collision.cs:2299 缺省【true】——旧注"默认
        //   false"系误读,玩家/NPC 原版恒可达此支）。★SW-FX34b 2026-09-15:玩家经
        //   Player.hoik=true 恢复原版半边——wiki 水平单向墙(楼梯平台列贴墙,按下
        //   右行穿墙/反向被挡)即由此支+嵌格自由通行(hoik 嵌格支)承载。曾无条件
        //   启用 → 天花板坡邻接实心格被豁免:玩家/NPC 幽灵穿入净空不足的悬臂禁区
        //  （2026-09-01 tent 案例:x591 墙被右邻 (592,328) slope3 放走 1px 入场 →
        //   头顶嵌实心 → unembed 弹飞——弹飞元凶已由 unembed 收敛帽另案 fix,
        //   入场半边=原版本体行为）。NPC 族维持关(登记债)。★SW-FX34c 2026-09-18:
        //   弹幕域经 Body.hoik=true 接入（原版 Projectile 全路径 hoik=true,用户
        //   实报"玩家能过弹幕过不了"）——消费面本支+跨格收窄支（上方）双门。
        //   ★身后格读改守卫式（界外=坡 0=不豁免,即原版 :2412 `i<1` 短路与右支
        //   扫描域钳制的等价形;旧裸 idx 在 tx=0/tx=w-1 会撞邻行索引=错格读）。
        if (b.hoik) {
          const bj = tx - dir;
          const bs = bj >= 0 && bj < st.w ? st.slope[st.idx(bj, ty)] : 0;
          if (dir > 0 && (bs === 2 || bs === 4)) continue;
          if (dir < 0 && (bs === 1 || bs === 3)) continue;
        }
        if (dir > 0) b.x = tx * TILE - b.w;
        else b.x = (tx + 1) * TILE;
        // ★SW-BJ19 2026-09-07：钳位后速度=实际位移残量,不再硬清零（vanilla 1:1）。
        //  原版 TileCollision X 拦截支 result.X = tile左缘-(移前右缘)（Collision.cs:2437/
        //  :2446 截断式）,调用方 velocity = result（Player.cs:23730-23747/:23766）——
        //  贴行进方向的剩余位移保留为速度。本仓曾 b.vx=0 硬清零:上坡爬行时身体右缘
        //  每逢坡缝(坡面对角线高端邻接整砖顶,脚带 ≤1px 亚像素滞后)触发拦截,速度
        //  从 ~3 直接归零,跑链以 +0.08/t 重建(30+ 拍)= 用户实报"上坡走着走着突然
        //  减速"（SW-BJ19 行为日志:vx 3→0.12-0.96 驻留 30-60 拍,x 51318-51345 两道
        //  坡缝）。残量语义下跨缝只损失本拍越界部分,速度连续。跨格态(上方 wasAcross
        //  支)维持零位移零速度 = 反穿墙兜底(该支位移本就归零,残量恒 0,不受本刀影响)。
        const landed = dir > 0 ? b.x - oldX : oldX - b.x;   // 本子步实际前进量=vanilla result.X 残量
        b.vx = dir > 0 ? Math.max(0, landed) : -Math.max(0, landed);
        hitX = true;
        break;
      }
    }
  }
  // Y 轴
  if (dy !== 0) {
    const oldY = b.y; // 移动前位置（原版 vector3.Y）
    b.y += dy;
    const dir = Math.sign(dy);
    const edgeY = dir > 0 ? b.y + b.h : b.y;
    const ty = Math.floor(edgeY / TILE);
    const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w - 0.01) / TILE);
    // 原版取整行最高面（Collision.cs:1610-1631 num13 取最大盒顶），不能 break 在最左列——
    // 否则左列半砖/右列整砖时身体会嵌进整砖 8px
    let bestTop = Infinity;
    // ★BJ-C9-SP（2026-10-09）越行平台补漏（哨兵杖 2366 实报「只能落实体物块」第二站）：
    //  下方平台门只查【新边缘行】ty——落速一拍可跨行（vy 钳 10~16 ≥ 行内剩余深度），
    //  单行平台在被越过行上不可检=穿落。此处补扫 oldBottom 行..ty−1 的越行平台格
    //  （单向顶面语义不变：prevBottom ≤ top+1 主门;实心不在此列——原版实心下面行
    //  连片,边缘行恒可检,保持既有语义零变）。dropThrough（按 ↓ 下穿）照旧豁免。
    const bottomRowOld = Math.floor(((b.y + b.h) - dy - 0.01) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      const solid = world.store.isSolid(tx, ty);
      const span = solidSpan(world, tx, ty);
      // ★SW-FX34b：半砖盒顶 +8（Collision.cs:2350-2354 `vector4.Y += 8`）——平台族
      //   落地面同步（wiki 竖直单向墙"底部平台"=锤 3 次半砖平台,接人面=格顶+8）
      const halfTop = st.half[st.idx(tx, ty)] ? 8 : 0;
      // ★BJ609（2026-10-10）：按 S（dropThrough∧platFallThrough 同置）期非全量放行——
      //   原版 :2391 `(!(solidTop&fallThrough) || !((vy≤1)|fall2))`：isPlat∧fallThrough∧
      //   !fall2 时 vy≤1 放行、vy>1 仍承接（高速下落逐级接住=阶梯下降）。b.vy=本拍
      //   碰撞前速度（原版 Velocity.Y 同量纲,px/tick,向下正）——子步 ≤8px 不改写 vy。
      //   仅 dropThrough（弹体/NPC/钩爪/爬墙源）=fall2 恒不承接,语义零变。
      const plat = (!b.dropThrough || (b.platFallThrough === true && b.vy > 1)) && dir > 0
        && world.store.isPlatform(tx, ty)
        && (b.y + b.h) - dy <= ty * TILE + halfTop + 1; // 上一位置在平台之上（半砖平台面=格顶+8）
      if (dir > 0) {
        if (!solid && !plat) continue;
        // ★天花板坡(3/4)顶面=实体地面（原版 topSlopes() 仅指 1/2：slope3/4 只参与
        //   "从下方顶头"结算，从上方踩其顶面按整块落地——Collision.cs:1610 solid 判
        //   `!tile.topSlopes()`。曾全坡一律交给 slopePass → 嵌入 6px 的 walked-on
        //   3/4 被拒重新着地 = 僵尸/掉落物在锤型天花坡上永久钉死+3px 抖动判例）
        const slv = st.slope[st.idx(tx, ty)] ?? 0;
        if (slv !== 3 && slv !== 4 && slopePass(tx, ty, b.x, oldY)) continue; // 坡面格交给 slopeCollide 对角线贴合
        // 落地门槛（Collision.cs:1610/1631）：新底部越过盒顶 且 上一位置在盒顶之上，
        // 否则（嵌入/侧入）不吸附——半砖盒顶是 ty*16+8，只进入行上半不算落地
        const top = span ? span[0] : ty * TILE + halfTop;
        if (b.y + b.h <= top || (b.y + b.h) - dy > top + 0.01) continue;
        if (top < bestTop) bestTop = top;
      } else {
        if (!solid) continue;
        if (slopePass(tx, ty, b.x, oldY)) continue;
        // 上顶：上一位置在盒底之下才命中；取最低盒底（最先撞到的天花板）
        const bottom = (ty + 1) * TILE;
        if (b.y >= bottom || b.y - dy < bottom - 0.01) continue;
        if (bottom < bestTop) bestTop = bottom;
      }
    }
    // ★BJ-C9-SP 越行平台格检查（见上注）——只扫平台（实心语义零变）:
    //  prevBottom ≤ top+1 = 从上来主门;prevBottom ∈ (top, top+16] = 放置嵌入驻留
    //  面（PickSentryLandingSpot spawnY=i×16−24 对 h=50 的 377 盒底嵌平台格 10px,
    //  原版哨兵对准平台可驻=用户实报基准;横移入格（vx≠0 行走穿越）不在此 door——
    //  ★BJ608（2026-10-10）嵌入支收窄为 opt-in（b.embedPlatSnap,仅哨兵置位）——
    //  嵌入解析源码位今已钉死:原版 TileCollision 平台承接【唯一】入口=Collision.cs:2364
    //  `vector3.Y + Height <= vector4.Y`（旧脚≤平台顶）,else 链其余三支全部
    //  `!Main.tileSolidTop` 排除平台（:2435/:2449/:2464）→ 嵌入盒（旧脚已低于平台顶）
    //  永不承接=下落体穿平台后绝不被抬回。旧嵌入支对一切下落体生效:十周年派对区
    //  行272长平台+x3930 竖列平台（行273/274/275,16px 间距）下,短按 S 穿落释放即被
    //  连拉抬回原平台（真机拍序 feet 4394→4384→4368→4352 三拍梯爬;用户实报
    //  「下落到下一格平台时被强制抬升到上面平台」=BJ608 两件套物证复现）。哨兵
    //  spawn 面保留（Player.cs:50045-50063 spawnY=(首实心行−1)×16−24 嵌 10px+出膛
    //  vy15,BJ-C9-SP 端到端基准）。
    // ★BJ609：越行补扫同门——按 S 慢速（vy≤1）放行、快速（vy>1）仍逐行承接（:2391）；
    //   仅 dropThrough（fall2 源）恒跳过,嵌入支 opt-in 收窄面零变。
    if (dir > 0 && (!b.dropThrough || (b.platFallThrough === true && b.vy > 1))) {
      for (let tyy = bottomRowOld; tyy < ty; tyy++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!world.store.isPlatform(tx, tyy)) continue;
          const prevB = (b.y + b.h) - dy;
          const topP = tyy * TILE;
          if (prevB > topP + 1 && !(b.embedPlatSnap === true && prevB > topP && prevB <= topP + TILE)) continue;
          if (topP < bestTop) bestTop = topP;
        }
      }
    }
    if (bestTop !== Infinity) {
      if (dir > 0) { b.y = bestTop - b.h; b.onGround = true; b.hitDown = true; }
      else { b.y = bestTop; b.hitHead = true; }
      b.vy = 0;
      hitY = true;
    }
  }
  return { hitX, hitY };
}

/** ★斜坡贴合 G2 速度门 + collideY 回写（2026-08-31 统一"阻尼陷入/逃出"修复）：
 *  原版 SlopeCollision 的贴合带两道我们缺失的门——
 *  · G2（:1947 `Position.Y + num7 < y`，y=入口英尺+本帧速度Y）：只有当贴合把
 *    身体抬到【高于本帧速度目标】时才生效——上升中/掠过的碰撞盒（飞行眼球/
 *    上抛物/高速穿越）被拒贴，杜绝逐帧拉拽（=用户报"阻尼陷入/逃出"，任何
 *    走 moveAndCollide 的主体统一中招：玩家/NPC/眼球/掉落物）；
 *  · collideY 回写（:1954 bitsByte[num3]=true）：贴合成功置 collideY——飞行
 *    AI（AI_002 collideY→oldVy×-0.5 弹跳）与掉落物结算靠它离场，缺失=贴着
 *    坡面爬行不反弹。
 *  天花板坡对称：门取 max(当前头，入口头+速度Y)。
 *  ★回退开关：localStorage sw_slope_g2='0'（重进世界生效）恢复旧无条件贴合。 */
let SLOPE_G2 = (() => {
  try { return typeof localStorage === 'undefined' || localStorage.getItem('sw_slope_g2') !== '0'; }
  catch { return true; }
})();
/** 回退审计用（tests/slope-g2 kill-switch 断言）：G2 门当前是否启用 */
export const SLOPE_G2_ENABLED = SLOPE_G2;
/** 运行时切换（探针 A/B 鉴别用；生产回退仍走 localStorage 重进世界） */
export function setSlopeG2(v: boolean): void { SLOPE_G2 = v; }

/** ★WalkDownSlope 预备阶段开关（2026-09-01 用户"角色阻尼滑入斜坡"终局修复）：
 *  vanilla 移动前阶段 Collision.WalkDownSlope（Collision.cs:1691-1795）全量移植。
 *  旧"速度辅助"其实是它的残缺尾巴（:1776-1794 vy+=|vx|），缺了 ：1696 活性门
 *  与全宽落面扫描 → 上/下坡起步帧 X 先走 Y 未跟上 = 脚悬空再被贴合拉回的
 *  阻尼沉浮。★回退开关：localStorage sw_slope_wd='0'（重进世界生效）。 */
let WALKDOWN_PRE = (() => {
  try { return typeof localStorage === 'undefined' || localStorage.getItem('sw_slope_wd') !== '0'; }
  catch { return true; }
})();
export const WALKDOWN_PRE_ENABLED = WALKDOWN_PRE;
export function setWalkDownPre(v: boolean): void { WALKDOWN_PRE = v; }

/** 原版 Collision.WalkDownSlope（1457 Collision.cs:1691-1795）逐字适配：
 *  贴地行走者即将步入下行地面坡（slope1 右行 / slope2 左行）时，于分轴移动【前】
 *  给 vy 追加 |vx| —— 让 Y 与 X 同帧同步走对角线，消灭"先平移再被轴后贴合拽回"
 *  的每帧沉浮循环。玩家 SlopingCollision 前置调用、NPC UpdateCollision 首步
 *  Collision_WalkDownSlopes 同源。与旧速度辅助的差异：
 *  ① 门：仅 vy==gravity 的纯贴地态激活（vanilla :1695 字面早退）；
 *  ② 落面扫描：【全身体宽度】[x..x+w] × (feet+4)/16 行起两行的矩形上探窗
 *     （17px 窗,:1717-1719 + Intersects 判定），取最贴脚候选——不再是只看中心列,
 *     接近坡第一列即同步补偿（阻尼残差根因）;
 *  ③ 表面等高续链门（:1735-1743）：同层表面并列时只跟随与行走方向配套的同侧
 *     坡链（slope==dirCode），防跨结构误触发。 */
/** ★export 仅为 sw-fx34 倒挂门测试直驱（moveAndCollide 内部的中间态 vy 不可外察） */
export function walkDownSlopePre(b: Body, world: World, wasGround: boolean): void {
  if (!WALKDOWN_PRE) return;
  // 活性门（:1695 字面 `Velocity.Y != gravity` 早退）：玩家侧 vy===GRAVITY 字面
  // 等价；NPC 族本仓重力先累加、碰撞头已清 onGround——贴地判据用入口快照
  // wasGround（'grounded' 档）;跳起首帧 vy<0 / 飞行体照旧早退。
  // ★BJ703-C D1：TownCritter 'never' 档（AI_007 flag22 语义）不再连带跳过本阶段
  //   ——见下方 walkDownSlopeOff 门注（'never' 只辖 StepDown）。
  if (!b.stepUp) return;
  // ★BJ703-C D1（2026-10-21）：'never' 连带拦截退役——原版 NPC 无条件跑
  //   Collision_WalkDownSlopes（NPC.cs:93667,UpdateCollision 首步;flag22 只门
  //   StepDown :54518-21）,玩家 SlopeDownMovement 也仅 mount48 豁免
  //   （Player.cs:23607）。显式 opt-out = walkDownSlopeOff（玩家载具态保守档,
  //   见 Body 字段注）;AI_007 flag22-true 小动物/城镇 NPC 的下坡贴地由此复活,
  //   'never' 体落默认 'grounded' 门（wasGround ∧ vy>=0,原版 vy==gravity 内门
  //   的 NPC 域等价——本仓重力先累加,vy 恒 gravity 值非 0）。
  if (b.walkDownSlopeOff === true) return;
  const gate = b.stepDownGate ?? 'grounded';
  // ★SW-FX34：门值 = gravity*gravDir（Player.cs:23610 `Collision.WalkDownSlope(…,
  //  gravity * gravDir)` → Collision.cs:1695 `Velocity.Y != gravity` 早退）——倒挂
  //  贴顶态 vy=-GRAVITY 过门（vanilla 语义：倒挂玩家同样跑 WalkDownSlope,其扫描窗
  //  仍在身体【下方】、vy 追加也恒为世界向下 +=|vx|——原文本不随 gravDir 镜像,
  //  倒挂时只有身下恰有地面坡的罕见摆位才会被「拖离天花板」= 原版 quirk,照单全收）。
  //  gravDir=1 半边数值恒等。
  const gdWs: 1 | -1 = b.gravDir === -1 ? -1 : 1;
  // ★SW-FX40（h2）：门值 = gravity*gravDir（:23610）——gravity 字段=深度缩水值
  //  （b.gField,缺省回退 GRAVITY=旧字面,Body 级测试/非玩家实体逐位不变）
  if (gate === 'gravity' ? b.vy !== (b.gField ?? GRAVITY) * gdWs : !(wasGround && b.vy >= 0)) return;
  const st = world.store;
  // 扫描窗（:1698-1720）：j0=(feet+4)/16；候选面须在 (j*16-17, j*16) 的 17px 上探带内
  // 与身体盒相交，且 num5 <= num(初始 (j0+3)*16 大帽)。solid||solidTop(平台族)均可作面。
  const xC0 = Math.floor(b.x / TILE), xC1 = Math.floor((b.x + b.w) / TILE);
  const jA = Math.floor((b.y + b.h + 4) / TILE);
  let bestTop = (jA + 3) * TILE;    // num 初始
  let txB = -1, tyB = -1;           // num2/num3
  for (let i = xC0; i <= xC1; i++) {
    for (let j = jA; j <= jA + 1; j++) {
      if (!st.inBounds(i, j)) continue;
      if (!st.isActive(i, j)) continue;
      if (!st.isSolid(i, j) && !st.isPlatform(i, j)) continue;
      let top = j * TILE;
      if (st.half[st.idx(i, j)]) top += 8;   // halfBrick 面 +8（:1721-1723）
      // 17px 上探带矩形相交（:1717 Rectangle(j*16-17,…,16,16) vs 身体盒）+ 高度帽
      const bandOk = b.x + b.w > i * TILE && b.x < i * TILE + TILE
        && j * TILE - 17 < b.y + b.h && j * TILE - 17 + TILE > b.y;
      if (!bandOk || top > bestTop) continue;
      if (top === bestTop && txB !== -1 && tyB !== -1) {
        // 等高并列续链（:1735-1743）：前候选是坡时，只接受坡型==行走方向档位的新格;
        // 前候选非坡(平坦/半砖)则照单全收（else 分支直落）
        const prevIsSlope = st.slope[st.idx(txB, tyB)] !== 0;
        if (prevIsSlope && st.slope[st.idx(i, j)] !== (b.vx < 0 ? 2 : 1)) continue;
      }
      bestTop = top;
      txB = i; tyB = j;
    }
  }
  // 终段（:1766-1794）：选中面为下行坡且方向/进深满足 → vy += |vx|（纯加法,+不取反）
  if (txB === -1 || tyB === -1) return;
  const sl = st.slope[st.idx(txB, tyB)];
  if (sl !== 1 && sl !== 2) return;
  const vx0 = txB * TILE;
  if (sl === 1) {
    const depth = b.x - vx0;
    if (b.y + b.h >= tyB * TILE + depth && b.vx > 0) b.vy += Math.abs(b.vx);
  } else {
    const depth = vx0 + TILE - (b.x + b.w);
    if (b.y + b.h >= tyB * TILE + depth && b.vx < 0) b.vy += Math.abs(b.vx);
  }
}

/** 原版 Collision.SlopeCollision（1456 Collision.cs:1796-2036）适配：
 *  常规碰撞后对重叠坡面格做对角线贴合——身体沉到斜面下时抬回斜面上
 *  （走路沿坡爬升;多格取最高贴合位,与原版 y 最小值机制一致）。
 *  slope1/2 地面坡:slope1 左高右低(左行爬升)、slope2 右高左低;
 *  slope3/4 天花板坡:对称向下推离。
 *  受阻回退已对齐原版收尾两分支（:2004-2019 抬升受阻 shortfall X 滑移+双清+up=false;
 *  :2020-2034 天花板下推受阻=截短下推+bitsByte[3]/[4] X 滑移+双清,2026-09-08）。
 *  与原版的偏差（稳定性取舍,均在行内注释标记）：
 *  - num4 钳 ≥0（原版 num4<0 跳过）：坡顶过渡瞬间防脱钩下沉
 *  - 未移植 :2003 的"重跑 TileCollision 校验"本体（分轴结构代价高）:截短量由
 *    守卫扫描的 vector5 等价（受阻格最小 格顶−脚底,:2388 进近门内）提供,下推
 *    受阻支已按其语义落刀,校验候选面（实心/站台面顶/半砖+8/坡面放行门）已
 *    逐 facet 对齐（见下推受阻支行内注释） */
function slopeCollide(
  b: Body, world: World, feetEntry: number, vyEntry: number, wasGround: boolean,
  captureOnly = false, xPre = b.x,
): boolean {
  const st = world.store;
  // ★扫描窗 = 本帧 X 移动前后的并集跨度（2026-09-01 台阶交界漏帧终修）：
  //   原版 SlopeCollision 与 TileCollision 的跨格判定全部以【移动前】vector
  //   （position 或 position+velocity 预测）为准——20px 身体横穿 16px 坡格时，
  //   仅看移动后位置会让旧坡格在贴线过程中提前 1-2 帧"水平出窗"，恰逢换格
  //   空窗（下一坡格脚带未入）→ 无候选无支撑 2-3 帧纯重力坠落（实测 SPD 全速
  //   每处台阶端点漏帧、feet 追线中断实录）。并入集后旧格保持可评直至身体
  //   【完整】离开其跨度——与原版逐格语义一致。
  // [取证钩子] window.__SW_SLOPE_LOG 为数组时逐次记录候选评估（探针用；恒关零成本）
  const SLOGR = (globalThis as Record<string, unknown> | undefined)?.__SW_SLOPE_LOG as unknown[] | undefined;
  let srec: string[] | null = null;
  if (SLOGR && SLOGR.length < 300000) {
    srec = [];
    srec.push(`CALL feet=${(b.y + b.h).toFixed(2)} vy=${b.vy.toFixed(2)} vx=${b.vx.toFixed(2)} wasG=${wasGround ? 1 : 0} body=[${b.x.toFixed(1)},${(b.x + b.w).toFixed(1)}]`);
  }
  const ux0 = Math.min(b.x, xPre), ux1 = Math.max(b.x + b.w, xPre + b.w);
  const x0 = Math.floor(ux0 / TILE), x1 = Math.floor((ux1 - 0.01) / TILE);
  const y0 = Math.floor(b.y / TILE), y1 = Math.floor((b.y + b.h - 0.01) / TILE);
  if (srec) srec.push(`  win x[${x0}..${x1}] y[${y0}..${y1}] probe=+${((wasGround && b.vy >= 0) ? 1 : 0)}`);
  let bestLift = 0;      // 最大抬升量（负 y 位移;0 = 无贴合）
  // 原版 bitsByte[1]/[2]（:1965,num3=1/2 在 y 棘轮严格胜出支内置位）——shortfall 滑向用。
  // ★双旗非单值（与 bestDropSlope3/4 同配方）：两位同设时原版写序 [1] 先(:2008-2010)
  // [2] 后(:2012-2014),[2] 的绝对写整体覆盖（终位=Position.X+num9,左滑）。
  //  ★可达性定谳（2026-09-08）：会 diverge 的序（bit2 先置、bit1 后严格胜出）要求
  //  slope2 格在 slope1 格左侧同排且 bodyLeft>slope1.tileLeft ⇒ bodyRight>slope2.tileRight
  //  ⇒ slope2 的 rawNum4<0 ⇒ 原版走 :1968-1998 站顶支（不置 bit）/本仓走 :602 站顶——
  //  两边同样先制,该序结构性不可达;可达双 bit 序（slope1 左 slope2 右）新旧公式同值。
  //  故本配方为【结构镜像+死码清除】（旧式 slope3 臂系死码：branch 1 只读
  //  bitsByte[1]/[2],bestLift 亦只在 1/2 置位）,非行为修复。
  let bestLiftSlope1 = false;
  let bestLiftSlope2 = false;
  let bestDrop = 0;      // 天花板最大下推量
  // 原版 bitsByte[3]/[4]（:1906,num3=3/4 在 y2 棘轮胜出支内置位）——受阻支滑向用。
  // ★双旗非单值：两坡位都曾严格胜出时两位同设,原版写序 [3] 先 [4] 后（:2024-2031）
  // ⇒ [4] 覆盖 [3]（右滑被左滑覆盖）——单值 argmax 会写错该角。
  let bestDropSlope3 = false;
  let bestDropSlope4 = false;
  let bestSnapY = -1;    // ★面随下贴候选（对角线目标 y；>0 = 有下贴）
  let bestSnapGap = 17;  // 脚底到对角线的正距离（越小越优先）
  // ★SW-BJ6 2026-09-07：vanilla else 支站顶候选（Collision.cs:1968-1977）——
  //  实心地面坡 rawNum4<0（身体缘已越过坡面高端）时原版不走抬升路径,直接把
  //  脚站到格顶（num8 = vector4.Y - Height,棘轮取最高者），无受阻检查无滑移。
  let bestStandTop = Infinity;
  let positionChanged = false;  // 贴合是否实际移动了 body（消费方 Y 冻结判定）
  let levelSupport: boolean | null = null;  // 行走优先级守卫（等高平顶支撑;惰性求值一次）

  // ★贴地前瞻行（+1）：跨坡格交界时脚底尚未探入下一行、旧格又已水平出窗——
  // 两候选皆不可见的裸奔缝（v5 探针 t47 定案,每列一次 5 帧空簇的根源）。
  // 仅贴地下行时多扫一行,让下一列对角线提前一帧进入候选窗。
  const yProbe = (wasGround && b.vy >= 0) ? y1 + 1 : y1;
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= yProbe; ty++) {
      if (!st.inBounds(tx, ty)) continue;
      const i = st.idx(tx, ty);
      const slope = st.slope[i];
      if (slope === 0 || st.half[i]) {
        continue;
      }
      const vx0 = tx * TILE, vy0 = ty * TILE;
      // ★面随下贴候选（真·must-be-first，2026-08-31 存档复现定案）：必须置于
      // 【所有】前进性 continue（平台脚带门/上行方向档/重叠门）之前——跨两坡格
      // 交界瞬间旧格已水平出窗、新格脚底未入其脚带,任一前门先跑都会让该格在
      // 交界帧不可见（实心坡 v5-t47 / 平台坡存档 t32 双例定罪）。门 =
      // wasGround + vy≥0 + !dropThrough + gap∈(0.05,17px)(=StepDown 吸附窗界
      // Collision.cs:3629)；线 = vy0 + num4(num4 按左/右缘进深钳 [0,TILE],
      // tip-over 场景 num4=0 ⇒ 线=格顶,gap≈0 防误拉)；候选取最贴近脚下者。
      //   ★上行排除门（2026-09-01 用户日志「上坡一段后掉落」定罪）：爬升方向
      //   与本坡下落向相反时（slope1 向左爬 / slope2 向右爬），身后仍重叠的
      //   低位格会持续发候选，把爬势按帽速逐帧拽回低线→爬升停滞致脱梯坠落。
      //   日志实录：L行 dx-26~79 同帧 dy+16~30 的反向拖拽段。
      //   ★wasGround 软门（2026-09-01 交替处阶梯下行漏帧终修，用户 F5 地形快照
      //   回放实锤）：坡格交界帧 slopeCollide 双候选皆缺席 → onGround 掉一帧 →
      //   walkDownSlopePre/速度辅助的 vy===GRAVITY 精确门就此失活（空中 vy
      //   只会越来越大永不复位）→ 整段纯重力坠落直到落地（实测 SPD3.0 每级台阶
      //   边界漏 2-3 帧、vy 序列 0.4/0.8/1.2）。修 = 非贴地帧只要缺口仍在「近线
      //   窗口」（≤ 半身 + 本帧行程：正常衔接最大浮空就是踏上下一坡格前的一步）
      //   也发候选——恢复通道不再依赖 wasGround 自愈；大缺口（真高空/坠崖）与
      //   上行排除门维持原语义不变。
      const nearLine = Math.abs(b.vx) > 0.01;   // 行走中才有近线豁免（静止浮空照旧走 wasGround 门）
      // ★行走优先级守卫（2026-09-01 用户「返回被提前引下实心梯」定罪，marks(41) 实锤）：
      //   身体横跨内存在与脚底等高（±2px）的平台/整砖平顶时禁用下贴——凹槽口
      //   (3166,275) 平台坡的下贴抢在顶面单向承接（Y 轴 crossing catch）之前把
      //   身体拽上对角线,顺势滑进 (3167,276) 实心梯（原版无主动下贴,顶面承接
      //   优先）。坡格自身顶=对角高角,非平顶,不构成等高支撑（纯对角链不受影响,
      //   第五波交界自愈保持）;hold S(dropThrough) 时顶面承接本就关闭,守卫随
      //   gap 窗自然失效,下穿语义不变。
      if (levelSupport === null) {
        levelSupport = false;
        const feetNow = b.y + b.h;
        const lx0 = Math.floor(b.x / TILE), lx1 = Math.floor((b.x + b.w - 0.01) / TILE);
        const lr0 = Math.floor((feetNow - 2) / TILE), lr1 = Math.floor((feetNow + 2) / TILE);
        for (let lx = lx0; lx <= lx1 && !levelSupport; lx++) {
          for (let ly = lr0; ly <= lr1; ly++) {
            if (!st.inBounds(lx, ly)) continue;
            const li = st.idx(lx, ly);
            if (st.slope[li] !== 0) continue;
            if (!st.isSolid(lx, ly) && !st.isPlatform(lx, ly)) continue;
            const top = ly * TILE + (st.half[li] ? 8 : 0);
            // 只认【托住身体】的顶面:顶在脚底上方 0~2px(含微陷)才算等高支撑;
            // 顶在脚底下方(下坡末段前方 1-2px 的落面)不构成支撑,不否决下贴
            if (top >= feetNow - 2 && top <= feetNow + 0.5) { levelSupport = true; break; }
          }
        }
      }
      if ((wasGround || nearLine) && b.vy >= 0 && !b.dropThrough && (slope === 1 || slope === 2)
        && !((slope === 1 && b.vx < -0.01) || (slope === 2 && b.vx > 0.01))) {
        const n4s = Math.max(0, Math.min(TILE,
          slope === 1 ? b.x - vx0 : vx0 + TILE - (b.x + b.w)));
        const gapS = vy0 + n4s - (b.y + b.h);          // >0 浮于面上 / ≤0 沉入
        if (!levelSupport && gapS > 0.05 && gapS <= b.w / 2 + Math.abs(b.vx) && gapS < bestSnapGap) {
          bestSnapGap = gapS;
          bestSnapY = vy0 + n4s;
          if (srec) srec.push(`  snap@${tx},${ty} y=${bestSnapY} gap=${bestSnapGap.toFixed(2)}${levelSupport ? ' VETO' : ''}`);
        }
      }
      // 坡面平台（平台锤楼梯，slope 恒 1/2——3/4 不存在于平台锤循环）：单向门
      // 1:1（Collision.cs:1851-1866）——上升中不挡（交给 stepUp 爬楼梯）；
      // 脚带内 [格顶, 格底+1+|vx|] 才接；上行方向档（slope1 且 vx≥0 /
      // slope2 且 vx≤0 且脚恰在上一行）不接
      const isSolidCell = st.isSolid(tx, ty);
      const isPlatSlope = !isSolidCell && st.isPlatform(tx, ty)
        && (slope === 1 || slope === 2);
      if (!isSolidCell && !isPlatSlope) {
        
        continue;
      }
      if (isPlatSlope) {
        if (srec) srec.push(`  ${tx},${ty} dropThrough`);
        if (b.dropThrough) continue;   // 按住下 = 楼梯下穿（stairFall 可见语义）
        if (srec) srec.push(`  ${tx},${ty} vy<0:${b.vy.toFixed(2)}`);
        if (b.vy < 0) continue;
        if (b.y + b.h < ty * TILE || b.y + b.h - (1 + Math.abs(b.vx)) > ty * TILE + TILE) { if (srec) srec.push(`  ${tx},${ty} band feet=${(b.y+b.h).toFixed(1)} [${ty*TILE},${ty*TILE+TILE+1+Math.abs(b.vx).toFixed(1)}]`); continue; }
        if (((slope === 1 && b.vx >= 0) || (slope === 2 && b.vx <= 0))
          && Math.floor((b.y + b.h) / TILE) - 1 === ty) { if (srec) srec.push(`  ${tx},${ty} dirGate feetRow=${Math.floor((b.y+b.h)/TILE)}`); continue; }
      }
      if (b.x + b.w <= vx0 || b.x >= vx0 + TILE || b.y + b.h <= vy0 || b.y >= vy0 + TILE) { if (srec) srec.push(`  ${tx},${ty} overlap body=[${b.x.toFixed(1)},${(b.x+b.w).toFixed(1)}]x[${b.y.toFixed(1)},${(b.y+b.h).toFixed(1)}]`); continue; }
      // 对角线水平偏移（:1882-1893/1927-1934）：slope1/3 取身体左缘进格深度,
      // slope2/4 取右缘。钳到 ≥0（与原版 num4<0 即跳过的差异,见函数头注释）：
      // 坡顶过渡瞬间(高侧缘越过坡面)原版会脱钩,脚底残留在对角线端点下方数像素,
      // 落地门槛不补救 → 角色沉进坡格;钳位后贴合保持到水平重叠结束,送脚到
      // 对角线高端点(=相邻整砖顶),由常规落地无缝接管
      let num4: number;
      if (slope === 1 || slope === 3) num4 = b.x - vx0;
      else num4 = vx0 + TILE - (b.x + b.w);
      // ★SW-BJ6 2026-09-07：rawNum4 = 钳 0 前的原始缘进深（vanilla num4 字面，
      //  :1927-1934）。实心地坡 rawNum4<0 走原版 else 支站顶（见 bestStandTop），
      //  不再钳 0 后走抬升→受阻→±4px shortfall 滑移（坡角嵌入案 t=188 一刀）。
      const rawNum4 = num4;
      // 平台坡【不钳 0】（原版 :1935+ num4<0 即跳过 = 高端侧外脱钩，楼梯竖柱
      // 里侧可走过）；实心坡维持钳 0（坡顶过渡贴合，见函数头注释）
      // ★2026-09-01 交替处坠落修（用户存档 3222-3223/275 实录）：num4 以【缘】
      //   进深判定——玩家右缘越过坡格右缘(num4<0)即跳过，但站在坡面高端末
      //   1-2px 的玩家（脚沉入 vy0 仅数 px）本应由邻接平平台接管，其着陆门槛
      //   (≤top+1)差 0.6px 边界失败 → 两侧都撒手 = 站着穿透坠落 4 格。
      //   修 = 沉深门：脚在坡顶 vy0 之下 ≤8px（坡顶过渡带）时钳 0 支持
      //   （坡顶 = 邻接平台面等高，钳 0 零跳变）；深陷（竖柱里侧穿越,沉>8px）
      //   维持原版跳过语义。
      if (isPlatSlope) {
        if (num4 < 0) {
          if (b.y + b.h - vy0 > 8) continue;
          num4 = 0;
        }
      } else {
        num4 = Math.max(0, num4);
      }
      if (slope === 3 || slope === 4) {
        // 天花板坡（:1883-1921）：头在斜面上方才贴合下推
        if (b.y <= vy0 + TILE - num4) {
          const num5 = vy0 + TILE - b.y - num4;
          // G2 对称门（头目标=入口头+速度Y 与当前头取大）+ 命中即回写 collideY
          if (SLOPE_G2 && b.y + num5 <= Math.max(b.y, feetEntry - b.h + vyEntry)) continue;
          if (num5 > bestDrop) {
            bestDrop = num5;
            if (slope === 3) bestDropSlope3 = true; else bestDropSlope4 = true; // bitsByte[num3]（:1906）
            if (SLOPE_G2) b.collideY = true;
          }
        }
      } else {
        // ★SW-BJ6 2026-09-07：原版 else 支（Collision.cs:1968-1977）——实心地坡
        // rawNum4<0（身体缘已越过坡面高端）不走抬升路径,直接把脚站到格顶
        //（vector2.Y 棘轮,num8 = vector4.Y - Height,门 = 当前候选沉在格顶之下）,
        // 无 G2 门无受阻检查无滑移。曾钳 0 走抬升→被堵→±4px shortfall 滑移
        // = 非原版踢入墙体一刀（流浪汉舌 (1825,317) s1 坡角实录 t=188 dx=-5）。
        if (!isPlatSlope && rawNum4 < 0) {
          const standTop = vy0 - b.h;
          if (Math.min(b.y, bestStandTop) > standTop && standTop < bestStandTop) {
            bestStandTop = standTop;
          }
          continue;
        }
        // 地面坡（:1935-1966）：沉到斜面下才抬回（gap<0 即抬升；面随下贴候选
        // 已上提到重叠门前,此处只保留抬升路径）
        const gap = vy0 + num4 - (b.y + b.h);          // >0 浮于面上 / ≤0 沉入面下
        if (gap >= 0) { if (srec) srec.push(`  ${tx},${ty} gap>=0 ${gap.toFixed(2)} num4=${num4.toFixed(2)}`); continue; }
        const num7 = gap;
        // ★G2 速度门（:1947）：贴合结果必须高于「入口英尺+本帧速度Y」与当前
        //   落地位的较小者——上升/掠过者拒贴（阻尼根因）
        if (SLOPE_G2 && !(b.y + num7 < Math.min(b.y + b.h, feetEntry + vyEntry))) continue;
        if (num7 < bestLift) {
          bestLift = num7;
          if (slope === 1) bestLiftSlope1 = true; else bestLiftSlope2 = true; // bitsByte[num3]=true（:1965,y 棘轮严格胜出支内）
          if (SLOPE_G2) b.collideY = true;   // bitsByte[num3]=true（:1954）
        }
      }
    }
  }
  // ★SW-BJ6 2026-09-07：else 支站顶应用（vanilla vector2.Y 棘轮收尾,取最高者,
  //  优先于抬升——抬升目标 feet=vy0+num4 ≥ 站顶 feet=vy0）。受阻判定按原版
  //  重跑 TileCollision 语义（:2003-2017）只认【新交】整块：站位前旧盒已与该格
  //  相交的（坡角 0.01px 搭边态）被 TileCollision else 支忽略（:2440 无分支）,
  //  不构成截短——vanilla 在坡角处把身体站进实心柱 0~1px 即为原版本体行为,
  //  后续由 AI 嵌固回退漂移（unwedgeDrift）按原版通道解卡。
  let standApplied = false;
  if (bestStandTop !== Infinity && bestStandTop < b.y) {
    let blocked = false;
    const sx0 = Math.floor(b.x / TILE), sx1 = Math.floor((b.x + b.w - 0.01) / TILE);
    const sy0 = Math.floor(bestStandTop / TILE), sy1 = Math.floor((bestStandTop + b.h - 0.01) / TILE);
    for (let tx = sx0; tx <= sx1 && !blocked; tx++) {
      for (let ty = sy0; ty <= sy1; ty++) {
        if (!st.inBounds(tx, ty)) continue;
        const j = st.idx(tx, ty);
        if (!st.isSolid(tx, ty) || st.slope[j] > 0 || st.half[j]) continue;
        const top = ty * TILE + (st.half[j] ? 8 : 0);
        if (!(b.x + b.w > tx * TILE && b.x < tx * TILE + TILE)) continue;
        // 旧盒（站位前）已与该格相交 = 原版忽略支,不算新交
        const already = b.y + b.h > top && b.y < (ty + 1) * TILE;
        if (!already) { blocked = true; break; }
      }
    }
    if (!blocked) {
      b.y = bestStandTop;
      positionChanged = true;
      if (b.vy > 0) b.vy = 0;                       // :1975-1977 vector3.Y > 0 → 0
      if (b.vy >= 0) b.onGround = true;
      if (SLOPE_G2) b.collideY = true;              // 站位=本帧 Y 结算改写 velocity.Y
      standApplied = true;
      if (srec) srec.push(`STAND top=${bestStandTop.toFixed(2)}`);
    }
  }
  if (!standApplied && bestLift < 0) {
    const ny = b.y + bestLift;
    // 抬升后不能嵌进实心
    let blocked = false;
    const bx0 = Math.floor(b.x / TILE), bx1 = Math.floor((b.x + b.w - 0.01) / TILE);
    const by0 = Math.floor(ny / TILE), by1 = Math.floor((ny + b.h - 0.01) / TILE);
    for (let tx = bx0; tx <= bx1 && !blocked; tx++) {
      for (let ty = by0; ty <= by1; ty++) {
        if (!st.inBounds(tx, ty)) continue;
        const j = st.idx(tx, ty);
        if (!st.isSolid(tx, ty) || st.slope[j] > 0 || st.half[j]) continue;
        const top = ty * TILE + (st.half[j] ? 8 : 0);
        if (b.x + b.w > tx * TILE && b.x < tx * TILE + TILE && ny + b.h > top && ny < (ty + 1) * TILE) { blocked = true; break; }
      }
    }
    if (!blocked) {
      b.y = ny;
      positionChanged = true;
      if (b.vy > 0) b.vy = 0;
      // ★onGround 仅下落/静止贴合置位（原版 velocity.Y==0 落地语义）：上升期（vy<0）
      //   空中经过坡面格的贴合不置——否则裸装半空再按跳会走地面跳跃门=免费二段跳
      //   （2026-08-19 用户报+行为录制定位；探针 _slopejump.mjs 复现 vy+2.31→-2.55）
      if (b.vy >= 0) b.onGround = true;
    } else {
      // ★shortfall X-slide（vanilla Collision.cs:2001-2019 逐字,2026-09-07 v_200 坡楔案重写）：
      //   抬升被上方实心堵住。本仓受阻判定=整抬弃用（Y 不动,achieved=0）⇒
      //   num9 = 截短前速度Y − 实际速度Y = bestLift（<0）；按胜出坡向转水平滑动：
      //   bitsByte[1]（slope1）→ X -= num9、bitsByte[2]（slope2）→ X += num9
      //   （:2008-2014；num9<0 ⇒ 两者均为沿坡向后退让）；并【双清速度】
      //   （:2016-2017 vector3.X = 0f; vector3.Y = 0f）——该清零是 AI_003 卡死计数链
      //   NPC.cs:57703 `position.X == oldPosition.X` → 满计数停索敌(:57914)→游荡转向
      //   (:57955-57975) 的物理前提；缺失时位置逐拍振荡,计数永不点火 = 战士族在
      //   坡楔型地形永久 ±px 弹跳（behavior-log-Starter_World 2026-09-07 v_200 实锤,
      //   翻转实验2实测平衡态钉驻 cx ±0.1px、vx 0~0.07）。
      //   逐 tick 施行（原版无接触期记忆）。2026-09-01"弹飞太远"病灶在旧实现的
      //   固定 4px 一次量,非逐 tick 本身——★F4③（2026-09-08 口径订正）本仓
      //   num9 = 全额截短前速度差（= |bestLift|,受阻判定整抬弃用无部分抬升,
      //   原文 :2007 vector2.Y = Position.Y + vector5.Y 的部分写回未移植）,
      //   非"精确 num9";平衡态滑移仍为亚像素量级,个别场景若仍见远滑,以 srec
      //   的 lift= 值归因,勿回退固定量。
      //   旧 slopeBlockFired 一次性门及其 bestLift>=0 复位行一并退役（字段无外部
      //   消费面,已自 Body 接口删除）。
      // ②X 滑移（:2008-2014）：两写均自 Position.X 绝对式,写序 [1] 先 [2] 后 ⇒
      //   双 bit 同设时 [2] 整体覆盖（终位=Position.X+num9）——bestLiftSlope1/2 双旗
      //   配方（可达性定谳见声明处;单 bit 退化与旧单值 argmax 同值）。
      const liftX = b.x;                                   // 原版 Position.X（坡段不改 X）
      if (bestLiftSlope1) b.x = liftX - bestLift;          // :2008-2010（num9<0 ⇒ 右滑）
      if (bestLiftSlope2) b.x = liftX + bestLift;          // :2012-2014（后写覆盖 ⇒ 左滑）
      b.vy = 0;                                            // :2016-2017 双清
      b.vx = 0;
      // ★F4④（2026-09-08）up = false 镜像（Collision.cs:2018,branch 1 收尾行）：
      //   原版 up = TileCollision 天花板接触旗（:2448 `up = true`,移前盒底在格底
      //   之下=上顶）,branch 1（:2004-2019）收尾明文清位——坡面贴合吞掉了本帧
      //   位移,顶头报告一并抑制,防消费面误动作。本仓等价字段 = b.hitHead
      //   （moveAxis 上行 Y 命中置位,TileCollision.ts moveAxis dir<0 支）;
      //   原版消费面 = NPC.cs:93736/:93930 vy=0.01 下推、Player.cs:23731/:23767
      //   jump=0、:28463 vy=0.01。仅受阻支清（branch 2 :2020-2034 无此行——
      //   天花板下推受阻支不清 up,勿顺手镜像）。窗口窄:紧随双清之后逐字对位。
      b.hitHead = false;
      // 物理埋点（探针取证用；window.__swPhysDbg 为真时计数）
      const dbg = (globalThis as Record<string, unknown> | undefined)?.__swPhysDbg as Record<string, number> | undefined;
      if (dbg) dbg.shortfall = (dbg.shortfall ?? 0) + 1;
    }
  } else if (!standApplied && bestSnapY > 0) {
    // ★面随下贴执行（与抬升互斥——本 tick 有沉入贴合时无需下贴）：
    //   脚底压回对角线 + 置接地 + 清落速（原版面随态 velocity.Y==0 同效）。
    //   守卫对称抬升守卫：目标位不得嵌进整砖/半砖（坡线端点紧贴支撑砖顶的畸形地形）
    const ny = bestSnapY - b.h;
    let blocked = false;
    const bx0 = Math.floor(b.x / TILE), bx1 = Math.floor((b.x + b.w - 0.01) / TILE);
    const by0 = Math.floor(ny / TILE), by1 = Math.floor((ny + b.h - 0.01) / TILE);
    for (let tx = bx0; tx <= bx1 && !blocked; tx++) {
      for (let ty = by0; ty <= by1; ty++) {
        if (!st.inBounds(tx, ty)) continue;
        const j = st.idx(tx, ty);
        if (!st.isSolid(tx, ty) || st.slope[j] > 0 || st.half[j]) continue;
        const top = ty * TILE + (st.half[j] ? 8 : 0);
        if (b.x + b.w > tx * TILE && b.x < tx * TILE + TILE && ny + b.h > top + 0.05 && ny < (ty + 1) * TILE) { blocked = true; break; }
      }
    }
    if (!blocked) {
      // ★下行速率帽（2026-09-01 锯齿收官,用户实录贴平15帧+单帧+10~16px猛坠）：
      //   贴线的竖向位移超过对角线理论速度(|vx| 推进对应落差+1.2 容差)即说明
      //   候选跨了共线远端/多级格顶——按速度帽渐进追线,缺口后续 tick 闭合；
      //   离散台阶的整级位移由 StepDown 负责(不经此路),不受本帽影响。
      const diagCap = Math.abs(b.vx) + 1.2;
      const drop = ny - b.y;                 // >0 = 向下追线
      if (drop > diagCap) {
        b.y += diagCap;
        if (b.vy > diagCap) b.vy = diagCap;
        b.onGround = true;
      } else {
        b.y = ny;
        if (b.vy > 0) b.vy = 0;
        b.onGround = true;       // wasGround 门已挡飞行体/跳起首帧,无二段跳外溢
      }
    }
  }
  if (bestDrop > 0) {
    positionChanged = true;
    // 下推守卫:推离后不能嵌进下方实心(对称于抬升守卫)。★F3/F4③（2026-09-08）升格为
    // 原版受阻支的 vector5 等价采集:同趟扫出「允许下推量」= 受阻格中(格顶−当前脚底)
    // 的最小正值(:2388 进近门 `vector3.Y + Height <= vector4.Y` 同式;num6 棘轮取最高
    // 格顶同义)——即原版 :2003 重跑 TileCollision 的放行量 vector5.Y。
    const ny = b.y + bestDrop;    let blocked = false;
    let allowedDrop = Infinity;   // vector5.Y 等价 ∈ [0,bestDrop);Infinity = 无进近门内受阻格
    const bx0 = Math.floor(b.x / TILE), bx1 = Math.floor((b.x + b.w - 0.01) / TILE);
    const by0 = Math.floor(ny / TILE), by1 = Math.floor((ny + b.h - 0.01) / TILE);
    for (let tx = bx0; tx <= bx1; tx++) {
      for (let ty = by0; ty <= by1; ty++) {
        if (!st.inBounds(tx, ty)) continue;
        const j = st.idx(tx, ty);
        const sl = st.slope[j];
        let top: number;
        if (sl === 1 || sl === 2) {
          continue;   // flag2 恒真（:2372-2374）⇒ :2399 !flag2 恒假 ⇒ 地面坡从不截短下推
        }
        if (sl === 3 || sl === 4) {
          // 坡面放行门（:2363/:2367 flag3）——重跑校验位移 X=0 ⇒ |Velocity.X|=0,
          // 过门（移前头在格顶之下且缘未越低端）跳过;不过门 ⇒ 以格顶截短
          //（:2388-2403,num7=16,flag2=false）——天花板坡顶面=实心地面（moveAxis 同约定）
          const topTile = ty * TILE;
          const pass = (sl === 3 ? b.x >= tx * TILE : b.x + b.w <= tx * TILE + TILE)
            && b.y >= topTile;
          if (pass) continue;
          top = topTile;
        } else if (!st.isSolid(tx, ty) && !st.isPlatform(tx, ty)) {
          continue;     // 非实心非站台面（:2330-2334 flag 门;isPlatform 即 tileSolidTop&&frameY==0 语义,TileStore :205-240）
        } else {
          top = ty * TILE + (st.half[j] ? 8 : 0);   // :2350-2354（半砖盒顶 +8）
        }
        if (b.x + b.w > tx * TILE && b.x < tx * TILE + TILE && ny + b.h > top && ny < (ty + 1) * TILE) {
          blocked = true;
          const gap = top - (b.y + b.h);            // ≥0 = 进近门内(未嵌,:2388);<0 = 已嵌态
          if (gap >= 0 && gap < allowedDrop) allowedDrop = gap;
        }
      }
    }
    const dbg = (globalThis as Record<string, unknown> | undefined)?.__swPhysDbg as Record<string, number> | undefined;
    if (blocked && dbg) dbg.ceilDropBlocked = (dbg.ceilDropBlocked ?? 0) + 1;
    if (!blocked || !Number.isFinite(allowedDrop)) {
      // 无截短:无受阻格,或受阻格全为已嵌态(进近门不过 ⇒ 校验不截短 ⇒ :2004/:2020
      // 两分支均不点火)——全推 + 坡面推离速率地板原样(:1899-1907)。
      b.y = ny;
      if (b.vy < 0.0101) b.vy = 0.0101; // 原版向下推离（:1902-1905）
    } else {
      // ★天花板坡受阻支对齐原文（Collision.cs:2020-2034 `else if (vector5.Y < velocity.Y)`,
      // 2026-09-08 落刀,销 2026-09-01 登记债——此前本支=整段弃用位移+速度保持+无滑移）：
      //   velocity = vector2 − Position = 坡面下推位移(num5,本仓 bestDrop);vector5 =
      //   以该位移重跑无坡 TileCollision 的放行量(本仓 allowedDrop);分支条件
      //   vector5.Y < velocity.Y = 下推被下方地形截短。原文明文三件：
      //   ①截短下推 :2023 vector2.Y = Position.Y + vector5.Y（采纳放行量=部分下推,
      //     脚底落在受阻格顶,非【弃用】）;
      //   ②沿坡水平滑移 :2024-2031 num10 = vector5.Y − velocity.Y < 0（:2022）,
      //     bitsByte[3]→vector2.X = Position.X − num10（slope3 头顶净空向右增 ⇒ 右滑）、
      //     bitsByte[4]→+num10（slope4 ⇒ 左滑）;两位同设时原版写序 [3]后[4] ⇒ [4]覆盖;
      //   ③速度双清 :2032-2033 vector3.X = 0f; vector3.Y = 0f（清的是全速度,含本帧
      //     重力/轴速度——AI_003 卡死计数链 NPC.cs:57703 的物理前提,与 shortfall 支
      //     :2016-2017 同源）。
      //   X 写回为自 Position.X 的绝对式（本仓坡段不改 X ⇒ b.x 即 Position.X,见下）。
      //   截短候选面已按原版校验全开（2026-09-08 续刀）：半砖盒顶+8（:2350-2354）、
      //   站台面顶（:2330-2334+:2391——校验调用 :2003 硬编码 fallThrough=false ⇒
      //   无需 fallThrough 状态机;isPlatform 谓词=TileStore :205-240 已定谳的
      //   tileSolidTop&&frameY==0 语义）、坡面放行门（:2361-2387 flag3,校验位移
      //   X=0 ⇒ |Velocity.X|=0;slope1/2 flag2 恒真从不截短,slope3/4 过门跳过/
      //   不过门按格顶截短）;已嵌态原版走全推（校验无支命中）,本仓同
      //   （归 !Number.isFinite 臂）。
      b.y += allowedDrop;                                  // ①:2023
      const num10 = allowedDrop - bestDrop;                // ②:2022（<0）
      // ②原版两写均为【自 Position.X 绝对式】（坡段不改 X ⇒ b.x 即 Position.X）——
      //   两位同设时 [4] 的绝对写整体覆盖 [3],非增量抵消;单 bit 退化同增量等价。
      const dropX = b.x;                                   // 原版 Position.X
      if (bestDropSlope3) b.x = dropX - num10;             // :2024-2026（num10<0 ⇒ 右滑）
      if (bestDropSlope4) b.x = dropX + num10;             // :2028-2030（后写覆盖 ⇒ 左滑）
      b.vx = 0;                                            // ③:2032
      b.vy = 0;                                            // ③:2033
    }
  }
  if (srec) {
    srec.push(`END lift=${bestLift.toFixed(2)} snap=${bestSnapY.toFixed(2)} drop=${bestDrop.toFixed(2)} posChanged=${positionChanged ? 1 : 0}`);
    SLOGR!.push(srec.join('\n'));
  }
  return bestLift < 0 || bestDrop > 0;
}

/** 原版 Collision.noSlopeCollision（Collision.cs:2038-2113）+ NPC.Collision_MoveBlazingWheel
 *  （NPC.cs:93918-93926）——type 72 刺球专用碰撞（ApplyTileCollision :93755-93757 按
 *  type==72 分派；且 :93715 把 type 72 排除在 MoveSlopesAndStairFall 之外）：
 *  · 碰撞盒 = 身体中心 12×12（num=num2=12 :93921-93924），非全身盒
 *  · 斜面当整块（noSlope 无坡面放行/贴合）、平台穿透（fallThrough+fall2 :93925）
 *  · 速度按盒夹取 → 整体位移；collideX/collideY 按「速度是否被改」置位
 *    （Collision_MoveWhileDry :93734-93747：天花板接触 up→vy=0.01 下推也置 collideY）
 *  通用 moveAndCollide 的 slopeCollide 推离不置 collideY 旗 → AI_021 永远看不到
 *  Y 碰撞、永不翻向 = 刺球在地牢凹袋楔死（2026-08-25 用户报，种子 12345 复现实录） */
export function moveNoSlopeBox(b: Body, world: World, dx: number, dy: number): void {
  const st = world.store;
  const oldVX = dx, oldVY = dy;
  const bx = b.x + b.w / 2 - 6, by = b.y + b.h / 2 - 6;   // 12×12 盒左上 = 中心-6
  let rx = dx, ry = dy;
  let up = false, down = false;
  const tx0 = Math.max(0, Math.floor(bx / TILE) - 1), tx1 = Math.min(st.w - 1, Math.floor((bx + 12) / TILE) + 2);
  const ty0 = Math.max(0, Math.floor(by / TILE) - 1), ty1 = Math.min(st.h - 1, Math.floor((by + 12) / TILE) + 2);
  for (let i = tx0; i <= tx1; i++) {
    for (let j = ty0; j <= ty1; j++) {
      if (!st.inBounds(i, j)) continue;
      const ji = st.idx(i, j);
      if (!st.isActive(i, j)) continue;
      const solidTop = !st.isSolid(i, j) && st.isPlatform(i, j);
      if (!st.isSolid(i, j) && !solidTop) continue;
      let vy4 = j * TILE, h7 = TILE;
      if (st.half[ji]) { vy4 += 8; h7 -= 8; }
      const vx4 = i * TILE;
      // 目标位盒不重叠 → 跳过（noSlopeCollision 的 vector2 = Position+Velocity）
      if (bx + dx + 12 <= vx4 || bx + dx >= vx4 + TILE || by + dy + 12 <= vy4 || by + dy >= vy4 + h7) continue;
      if (by + 12 <= vy4) {
        // 从上方来 = 地板；fallThrough+fall2 → 平台顶穿透（:1902 前置条件取反）
        if (solidTop) continue;
        ry = Math.min(ry, vy4 - (by + 12));
        down = true;
      } else if (bx + 12 <= vx4 && !solidTop) {
        rx = Math.min(rx, vx4 - (bx + 12));            // 从左来,右侧墙
      } else if (bx >= vx4 + TILE && !solidTop) {
        rx = Math.max(rx, vx4 + TILE - bx);            // 从右来,左侧墙
      } else if (by >= vy4 + h7 && !solidTop) {
        up = true;                                      // 从下方来,天花板
        ry = Math.max(ry, vy4 + h7 - by);
      }
    }
  }
  b.x += rx; b.y += ry;
  b.vx = rx; b.vy = ry;
  if (up) b.vy = 0.01;                                 // Collision.up → vy=0.01（:93736-93738）
  b.hitWall = rx !== oldVX;
  b.hitHead = up;
  b.onGround = down;
  b.collideY = ry !== oldVY;
}

/** 移动并碰撞。高速时分子步防穿透。 */
export function moveAndCollide(b: Body, world: World, dx: number, dy: number) {
  // tileCollide=false（Projectile.tileCollide 镜像,蜘蛛 :62852-62860 穿平台/归位飞行
  // :61410、蛙 :50648 等 AI 逐态直写）→ 碰撞整段跳过,位移直写（原版 Update 逐子步
  // `if (tileCollide) { TileCollision... } position += velocity` 同构）
  if (b.tileCollide === false) {
    b.x += dx; b.y += dy;
    b.onGround = false; b.hitWall = false; b.hitHead = false; b.collideY = false;
    return;
  }
  // NPC Collision_MoveWhileWet（NPC.cs:93986）：wet 时位移 ×liquidMoveFactor（velocity 不变，
  // 只缩位移）。由 npcLiquid.updateNpcLiquid 每 tick 写入（dry=1 跳过）；实体基类缺省 1。
  const lf = b.liqFactor;
  if (lf !== undefined && lf !== 1) { dx *= lf; dy *= lf; }
  // ★GetTileCollisionParameters 底对齐缩盒入口（NPC.cs:93950-93983;IIIII235 2026-09-10）：
  //  原版逐类型 cHeight 缩减后 `cPosition.Y += height − cHeight`（底对齐）——TileCollision
  //  /SlopeCollision/StepUp 全走缩盒（:93685/:93824/:64909 三消费点）。等价承载=管线期间
  //  整盒下移 inset 且盒高同步缩减：feet(y+h) 恒不变（落地/坡面/StepDown 语义零变化）,
  //  只有盒顶（顶头/StepUp 探柱/unembed 顶行判据）下移 inset=视觉头部可压进上方墙格
  //  （圣骑士 290 cHeight=40,inset=22——3 格高走廊通行,原版同款）。出口还原见尾段。
  const inset = b.collTopInset ?? 0;
  if (inset > 0) { b.y += inset; b.h -= inset; }
  const wasGround = b.onGround;   // 上一 tick 落地态（StepDown 贴地门用——重置前捕获）
  b.onGround = false;
  b.hitWall = false;
  b.hitHead = false;
  b.hitDown = false;             // ★SW-FX34：Collision.down 逐 tick 复位（Player.cs:28467 消费）
  b.collideY = false;            // 原版 collideY 逐 tick 复位（NPC.cs:93741）
  const gdBody: 1 | -1 = b.gravDir === -1 ? -1 : 1;   // ★SW-FX34：缺省 1=原版 gravDir 半边
  // 原版 StepUp/StepDown 在 TileCollision 之前用未受阻的意图速度探测
  // （Player.cs:23252-23263 / NPC.cs:54377-54382）。StepDown 门：玩家 vy===GRAVITY
  // （原版字面 :23252）、NPC 族 onGround（原版 :54374 vy==0 在该时点=贴地语义；
  // 本仓重力先加,==0 恒假,取等价门）——宽门 vy>=0 会把低空飞行小动物周期性
  // 瞬移按压到地面（萤火虫/蝴蝶"怪力按地+闪现"根因）
  if (b.stepUp) {
    const gate = b.stepDownGate ?? 'grounded';
    // 'never'（AI_007 TownCritter flag22 恒 true 档）跳过 StepDown,StepUp 照常。
    // ★BJ703-C D1：'never' 只辖本 StepDown 门——WalkDownSlope 预备阶段
    //   （下方 walkDownSlopePre）不再被连带拦截（原版 NPC :93667 无条件跑）。
    // ★'grounded' 门补 vy>=0（2026-08-25）：原版字面 vy==0（NPC.cs:54374）在跳起
    //   首 tick（AI 已置 vy=-8）同样不吸附——曾只查 wasGround，跳起首 tick 被
    //   StepDown 先拽下 16px 再起跳（观感=起跳顿挫/沉一下；探针 tick=56 实录
    //   from y3928→3944 且 v=(−1.5,−8)）。vy>=0 不复活旧"低空飞虫被按地"bug
    //   （那需要无 wasGround 门；飞虫 wasGround 恒 false 本就不吸附）
    if (gate === 'never') { /* no StepDown */ }
    // ★SW-FX40（h2）：'gravity' 门值 = 原版 gravity 字段（:28265 `velocity.Y == gravity`
    //  ——深度缩水带 gravity=0.4×num6<0.4,贴地 vy 同步缩水,旧常数字面在该带恒假=门哑）。
    //  玩家侧 fixedUpdate 每 tick 写 b.gField;未写（NPC/测试裸 Body）回退 GRAVITY 旧行为。
    else if (gate === 'gravity' ? b.vy === (b.gField ?? GRAVITY) : (wasGround && b.vy >= 0)) applyStepDown(b, world);
    // ★SW-FX34 StepDown 倒挂语义备案（Collision.cs:3577-3638 + Player.cs:28267-28271）：
    //  原 Collision.StepDown 函数体【完全不读 gravDir 形参】（扫描/吸附恒向世界下方,
    //  num5=(num3+num4)*16 向下找落面）——其触发门 `velocity.Y == gravity`（:28271,
    //  取正 gravity）对倒挂贴顶态（本仓重力链后 vy=-GRAVITY）恒不成立 ⇒ 原版倒挂
    //  玩家【无 StepDown 吸附】（脱阶靠重力回吸天花板,1-2 tick 内自行归位）。本仓
    //  `b.vy === GRAVITY` 字面门对倒挂同样恒不成立 = 与原版逐位同结果,零修改。
    // ★对抗修复批③2026-09-01 D-F3（cs:54525-54527）：原版 AI_007 的 StepUp 整个
    // 包在 `if (velocity.Y >= 0f)` 里——上升帧（跳跃首 tick / 击退上抛）不探台面,
    // 杜绝半空中贴身探测到 16.1px 内落脚格被瞬移抬升的"怪力上吸"。
    // ★SW-RB14d 勘误：旧注"玩家侧原版同形(vy>=0)"系误读——玩家门是
    //  Player.cs:28276 `(carpetFrame != -1 || velocity.Y >= gravity)`（阈=gravity
    //  字段非 0,且毯展开腿）。旧消费者恒 `vy >= 0`：[0,gravity) 窗（水行 vy=0/
    //  悬停 vy=0/跳顶点 vy≈0+）原版不过门却上探（跳顶点横越 1 格台阶=空中踏步）,
    //  飞毯缓降（vy=−0.4<0）原版可探却被拦——双向各偏一次。玩家经 stepUpCarpet/
    //  stepUpVeloFloor 承载原门;缺省 undefined = NPC 族门字面 vy>=0 逐位不变。
    if (gdBody === -1) {
      // ★SW-FX34：倒挂 StepUp 门（Player.cs:28273-28275 `(carpetFrame != -1 ||
      //  velocity.Y <= gravity) && !controlUp`——玩家侧逐 tick 预计算写 stepUpInvGate;
      //  holdsMatching 实参= controlUp 同款,经 stepUpHolds 承载）。
      //  探柱/抬升走 applyStepUpInv（Collision.cs:3641-3779 else 支 1:1）。
      if (b.stepUpInvGate === true) applyStepUpInv(b, world, !!b.stepUpHolds);
    } else if (b.stepUpCarpet === true || b.vy >= (b.stepUpVeloFloor ?? 0)) {
      applyStepUp(b, world, !!b.stepUpHolds, b.stepUpNpc === true);
    }
  }
  // ★WalkDownSlope 预备阶段（2026-09-01 全量移植,见 walkDownSlopePre 注释）：
  //   vanilla 玩家 SlopingCollision 前置/NPC UpdateCollision 首步同源。开启后
  //   接管 vy+=|vx| 的全部职责；旧中心列"速度辅助"保留为回退开关路径（二选一,
  //   防双重补偿把下坡吸成急坠）。
  walkDownSlopePre(b, world, wasGround);
  // 速度辅助（Collision.cs:1773-1790 = WalkDownSlope 尾巴的残缺移植）：脚底中心
  // 所在格是 slope1/2、水平速度朝低侧、脚已沉到对角线 → dy += |dx|。
  // ★仅在 WALKDOWN_PRE 关闭时执行（旧语义回退路径;sw_slope_wd='0' 复原）
  if (!WALKDOWN_PRE) {
    const st = world.store;
    const feetRow = Math.floor((b.y + b.h) / TILE);
    const midCol = Math.floor((b.x + b.w / 2) / TILE);
    if (dx !== 0 && st.inBounds(midCol, feetRow)) {
      // ★坡格下探(2026-09-01 交替处踏入下坠终修):浮在坡面上方的玩家 feetRow
      //   在坡格上方 1-3 行——只查 feetRow 会失明(漂移累积成 4-5px 下坠)。
      //   向下探测 3 行找同向坡格,按【中心面】算落差,落差 ≤半身时一步补齐。
      for (let dr = 0; dr <= 3; dr++) {
        const fy = feetRow + dr;
        if (!st.inBounds(midCol, fy)) break;
        const fi = st.idx(midCol, fy);
        const fs = st.slope[fi];
        if ((fs !== 1 && fs !== 2) || st.half[fi]
          || !(st.isSolid(midCol, fy) || st.isPlatform(midCol, fy))) {
          if (st.isActive(midCol, fy) && st.isSolid(midCol, fy)) break;  // 实心挡路=下方无坡
          continue;
        }
        const vx0 = midCol * TILE;
        const centerX = b.x + b.w / 2;
        const surfCenter = fs === 1
          ? fy * TILE + (centerX - vx0)
          : fy * TILE + (vx0 + TILE - centerX);
        const num4 = fs === 1 ? b.x - vx0 : vx0 + TILE - (b.x + b.w);
        // ★门终形(2026-09-01 踏入下坠终修):窗口 = 半身 + 单帧位移。
        //   踏入瞬间落差 = 半身(w/2≈10px)——定值门 deficit≤10 被浮空增长
        //   (无辅助时落差每帧增长 |dx|)一步越限后【永久关闭】,且浮空时
        //   wasGround=false 锁死 wasGround 门 → 无恢复路径 → 自由落体
        //   (用户实录 125px)。动态窗 = b.w/2 + |dx| 恰容纳「上帧未辅助的
        //   本帧增长」,跳跃跨越(落差按弧线增长远超 |dx|)仍被排除;
        //   补差帽同窗,单帧贴面不瞬移。
        const deficitCap = b.w / 2 + Math.abs(dx);
        const deficit = surfCenter - (b.y + b.h);
        const ztr = (globalThis as { __GLUETRACE?: unknown[] }).__GLUETRACE;
        if (ztr && ztr.length < 400) ztr.push({ dx: +dx.toFixed(2), mid: midCol, fy, fs, num4: +num4.toFixed(1), def: +deficit.toFixed(1), feet: +(b.y + b.h).toFixed(1), vy: +b.vy.toFixed(2), applied: false });
        if (num4 >= 0 && deficit >= -TILE && deficit <= deficitCap
          && ((fs === 1 && b.vx > 0) || (fs === 2 && b.vx < 0))) {
          const add = Math.max(Math.abs(dx), Math.min(deficit, deficitCap));
          dy += add;
          if (ztr && ztr.length) (ztr[ztr.length - 1] as { applied?: number }).applied = +add.toFixed(2);
        }
        break;   // 找到首个坡格即止(无论是否命中辅助)
      }
    }
  }
  // ★G2 入口快照（速度辅助之后、分轴之前——原版 y = Position.Y + Velocity.Y
  //   在 TileCollision 头部、速度辅助(:1773)之前）
  const feetEntry = b.y + b.h;
  const vyEntry = b.vy;
  b.vyEntry = vyEntry; b.feetEntry = feetEntry;
  // ★★2026-08-31 终版：贴合在分轴【前】+ 贴合后 dy=0（分轴 Y 不再推移）。
  //   旧序（轴后贴合）棘轮阻尼（-16px 恒定）;首版重排序（轴前贴合但分轴仍推）
  //   正反馈弹射（±40-90px 传送）。根因=贴合定位坡面后，分轴 Y 仍按原始重力
  //   dy 推移 → 身体被推离坡面 → 下一帧再贴回 → 循环。
  //   修=贴合后 dy=0：坡面贴合即最终 Y 定位（等同原版 SlopeCollision 先行、
  //   Y-sweep 见 vy=0 无附加位移）。X 分轴照常（行走不受影响）。
  //   面随 assist 的 dy+=|dx| 已被贴合本身覆盖（贴合=定位在坡面上）。
  const xPre = b.x;   // slopeCollide 扫描并集窗基準（见函数注释）
  const maxStep = 8;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps, sy = dy / steps;
    const { hitX, hitY } = moveAxis(b, world, sx, sy);
    if (hitX) { b.hitWall = true; dx = 0; }
    if (hitY) { b.collideY = true; dy = 0; }
    if (dx === 0 && dy === 0) break;
  }
  // ★轴后贴合（稳定序）+ 振幅限幅 + G2 + collideY：分轴架构下最稳组合
  slopeCollide(b, world, feetEntry, vyEntry, wasGround, false, xPre);
  unembedPass(b, world);
  // ★GetTileCollisionParameters 底对齐缩盒出口（NPC.cs:93950-93983;IIIII235 2026-09-10）：
  //   还原本体坐标/盒高（语义见入口注）——碰撞管线全程只见【下部 cHeight 缩盒】,
  //   本体 y/h 与盒外消费面（AI 探针/LOS/绘制）保持原 SetDefaults 全盒
  if (inset > 0) { b.h += inset; b.y -= inset; }
}

/** ★BJ227：Collision.WaterCollision（Collision.cs:2793-2820）1:1——液面下坠跨越钉位。
 *  原版消费面 = Player.DryCollision 两处（Player.cs:23738 有限元步进支/:23774 单步支,
 *  `if (waterWalk || waterWalk2)` 门）——【干态】运动路径专属；湿态路径
 *  Player.WetCollision（:23622-23640）只走 TileCollision+位移因子,无任何液面钉位。
 *  语义：实体下坠时新盒底跨越液面（旧盒底 ≤ 面顶 < 新盒底）→ velocity.Y 被【替换】
 *  为 `面顶 − 旧盒底`（= 把位移钳到面顶,position += 后盒底恰停在液面上）。
 *  逐格判定五条件（:2806-2812）：新盒 X 相交格列 ∧ 新盒底 > 面顶 ∧ 新盒顶 < 面顶+液高
 *  ∧ 旧盒底 ≤ 面顶 ∧ !fallThrough（fallThrough 由调用侧门——按 ↓ 主动下潜让位）。
 *  液面高 num2 = liquid/32*2+2（C# 整除；255→16/128→10/1→2）、面顶 = j*16+16−num2。
 *  上格无液（tile[i,j−1].liquid==0）= 液面判据；`(!lava() || lavaWalk)` = 岩浆面仅在
 *  lavaWalk（= 纯 waterWalk：熔岩护足 908/泰拉靴 5000/水上行走药水 buff15——水上漂靴
 *  863/黑曜石水上漂靴 907 是 waterWalk2,岩浆面【不】钉位照常下沉）时成立。
 *  扫描窗 = 旧盒膨胀 1 格（:2799-2804,X/Y 均旧盒基）;i/j 循环上界【排他】;
 *  末中者胜（result 逐格覆写,i 升序 j 升序 = 同列最深面）。
 *  返回 = 钉位后的面顶 Y（px）；null = 本拍无跨越（velocity 原样）。 */
export function waterSurfacePinCrossed(
  st: World['store'], oldX: number, oldY: number, w: number, h: number,
  newX: number, newY: number, lavaWalk: boolean,
): number | null {
  const i0 = Math.max(0, Math.min(Math.floor(oldX / TILE) - 1, st.w - 1));
  const i1 = Math.max(0, Math.min(Math.floor((oldX + w) / TILE) + 2, st.w - 1));
  const j0 = Math.max(0, Math.min(Math.floor(oldY / TILE) - 1, st.h - 40));
  const j1 = Math.max(0, Math.min(Math.floor((oldY + h) / TILE) + 2, st.h - 40));
  const oldBottom = oldY + h;
  const newBottom = newY + h;
  let result: number | null = null;
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      if (!st.inBounds(i, j)) continue;
      const idx = st.idx(i, j);
      if (st.liquid[idx] <= 0) continue;                               // :2806 liquid > 0
      if (j > 0 && st.liquid[st.idx(i, j - 1)] !== 0) continue;        // :2806 上格无液（液面判据）
      if (!lavaWalk && st.liquidType[idx] === 2) continue;             // :2806 (!lava() || lavaWalk)——LIQUID_TYPE.LAVA=2
      const num2 = Math.floor(st.liquid[idx] / 32) * 2 + 2;            // :2807 液面像素高（C# 整除）
      const surfY = j * TILE + TILE - num2;                            // :2809 面顶
      if (newX + w > i * TILE && newX < i * TILE + TILE                // :2810 新盒 X 相交
        && newBottom > surfY && newY < surfY + num2                    // :2811-2812 跨越（新底过面 ∧ 新顶未穿格底）
        && oldBottom <= surfY) {                                       // :2812 旧底 ≤ 面顶
        result = surfY;                                                // result.Y = 面 − 旧底（此处回面顶,由调用侧换算）
      }
    }
  }
  return result;
}

const EMBED_DELAY_TICKS = 15;
function unembedPass(b: Body, world: World): void {
  // ★湿身体整段跳过（2026-09-03 复核）：兜底抬升/横推是本仓自愈发明,原版无等价
  //  机制；水中嵌入体由原版水物理接管——AI_001 wet 浮力段（cs:62080-62128,water
  //  探针盒 10×h/2）+ 嵌入体上升不拦（TileCollision cs:2455 `vector3.Y >= tileBottom`
  //  门=旧位在格下才拦,已嵌入=穿透,原版同款）。湿体抬升踢（史莱姆水囊案实测
  //  600t 内 1 次 +16px,非主 bounce 源）属水中非原版扰动,兜底让位于原版。
  //  干侧救援（凹龛/tent/活埋）不受影响。主 bounce 源=slopeCollide 贴合
  //  （vanilla 同款,另案定谳）。
  if (b.wet) return;
  // ★RB29/FX34b 2026-09-15（红队 MED findings F1+F2）：hoik 体整段让位——vanilla
  //  同相 = 原版全文【无任何 unembed 等价机制】, Collision.cs 无此通道。FX34b 玩家侧
  //  恢复 hoik=true（Player.hoik）后,穿行期（wiki 单向墙 ~12t）盒顶行压进实心墙列 →
  //  topEmbedded 2t 快速支反复点火 +16px/拍（单墙=抬 16px 站墙内块顶;2 厚墙连锁
  //  16→32→48 越墙逃逸=vanilla 禁止方向,探针 _rb29-physics.mjs P4b/P6b 实证）；
  //  2 厚墙转运 >15t 时 centerSolid 15t 支同样介入 → 单支豁免（仅 topEmbedded 加
  //  !b.hoik）堵不全,取整段让位：hoik 嵌格自由通行（moveAxis :375 支）本就是原版
  //  穿越通道,穿行期一切抬升/横推均非原版扰动。wet 让位同构。Body 级 wet 消融
  //  定谳件=tests/_tmp-rb29-hoik-transit.test.ts（已转正为
  //  tests/hoik-oneway-wall.test.ts 「hoik 穿行期 unembed 让位」断言后删除）。
  //  NPC 族 hoik=false（2026-09-01 登记债）救援不变;unembed-pass.test.ts 全部
  //  用例（凹龛/活埋/贴墙/刷角）Body 均缺省 falsy 不受影响。
  if (b.hoik) return;
  // ★BJ647 2026-10-12：坐姿态整段让位（用户实报巫医 Kogi-ghi/海盗 David「走到右侧
  //  瞬移到左侧重新走路」150t 循环;debug-report 十周年纪念种子 18-05/18-11 + 探针
  //  _bj647-repro.mjs t=438-441 逐拍实录:forceSit 钉位 cx=62954=3934*16+8+2*1 →
  //  本支 topEmbedded 2t 快速横推 −16px → 坐探针格从椅列变桌列 canSitAt 失败 →
  //  起身臂 wT=90/tl=43 → 夜间回家臂 REST_LEG 325 重走 → 再坐再推）。原版坐锚无
  //  净空门（NPC.cs:53285-86/:55972-75）,贴墙椅盒缘嵌墙 1-4px 是合法稳态;原版无
  //  unembed 等价机制=嵌墙长坐（探针恒椅格）。本支纯自愈兜底对合法锚位让位,
  //  与 wet/hoik/unwedgeDrift 让位判例同构。判别测试 tests/bj647-townnpc-wander。
  if (b.sitPose) return;
  // ★SW-BJ6 2026-09-07：vanilla 嵌固回退漂移活跃期整段让位（consume-once）。
  //  原版嵌入体的唯一自救 = AI_001 的 position.X -= velocity.X + direction
  //  （NPC.cs:62139 贴地支/:62331 滞空支，门 collideY+oldVelocity.Y≠0+
  //  SolidCollision——SolidCollision :2713 对坡格取整块盒，站坡姿态恒判真），
  //  每拍 1px 匀速解卡；坡角高端邻实心柱时漂移越过墙缘后经 SolidCollision 的
  //  (柱,行) 格持续判真 → 不再自限 → 匀速相移穿越墙带（流浪汉舌 (1825,317) s1
  //  坡角实录 t=188-210，绿史莱姆整只穿到井侧=原版本体行为）。本仓 unembed 在
  //  漂移中段（embedTicks 计满 15）单帧横推 ≤64px 弹回原侧 = 非原版瞬移，把
  //  vanilla 一次干净穿越打断成"沉入→弹出"循环（用户行为日志实录）。漂移
  //  活跃期交还原版机制，与 wet 让位同构。 */
  if (b.unwedgeDrift) {
    b.unwedgeDrift = false;
    return;
  }
  const st = world.store;
  const cx = Math.floor((b.x + b.w / 2) / TILE);
  const cy = Math.floor((b.y + b.h / 2) / TILE);
  if (!st.inBounds(cx, cy)) return;
  const ci = st.idx(cx, cy);
  // ★顶带嵌入 variant（2026-08-25 用户存档凹龛实锤）：盒中心在空气袋但【顶行】
  // 压进悬突天花板（1 宽×2 高凹龛容不下 42px 高僵尸,头部嵌锡矿 8-10px）——
  // 中心格判空气→旧触发器恒不点火;而头部嵌入使 X/Y 碰撞互锁(移动目的地仍与
  // 实心相交=恒拦)→原版物理也自愈不能。顶行任一实心(非坡/半砖/平台)计入触发,
  // 15t 延迟门照旧滤瞬态(跳跃磕檐/StepUp 抬升的瞬时顶接触每帧复位计数)。
  // 站立/行走态顶行必为空气(42px 盒站 16px 地面,顶行高于地面 2 行)无误触发。
  const topRow = Math.floor(b.y / TILE);
  let topEmbedded = false;
  if (!st.isSolid(cx, cy)) {
    const nx0 = Math.floor(b.x / TILE), nx1 = Math.floor((b.x + b.w - 0.01) / TILE);
    for (let tx = nx0; tx <= nx1; tx++) {
      if (!st.inBounds(tx, topRow)) continue;
      const ti = st.idx(tx, topRow);
      if (st.isSolid(tx, topRow) && st.slope[ti] === 0 && !st.half[ti] && !st.isPlatform(tx, topRow)) {
        topEmbedded = true;
        break;
      }    }
  }
  // ★中心格判据须排除坡/半砖/平台(与上方顶行变体及函数头注释同款)——掉落物
  //  12px 高,站斜面对角线低侧时中心点必沉入坡面实心三角(合法贴合姿态,
  //  slopeCollide 逐 tick 管理),无排除=被判真嵌入→15t 后上抬 16px→重力落回
  //  →循环("掉落物在斜坡上下移-瞬移-再下移",2026-08-25 用户实报+存档标记定位)
  const centerSolid = st.isSolid(cx, cy) && st.slope[ci] === 0 && !st.half[ci] && !st.isPlatform(cx, cy);
  const embedded = centerSolid || topEmbedded;
  if (!embedded) {
    b.embedTicks = 0;   // 脱出/未嵌入:计数复位(瞬态嵌片靠原版物理自愈)
    b.embedPushed = 0;  // 横推预算同会话复位(2026-09-01 tent 收敛帽)
    return;
  }
  // ★悬空刷角假嵌入门（2026-09-02 向导电梯定谳,用户实报 Starter World 楔死+
  //   行为日志 326 事件+探针 _guidewedge-verdict A/B 复现）：仅【顶行】刷实心
  //  墙角（topEmbedded,中心格干净）且身体【无支撑】(!onGround)的姿态 = 掠过
  //  墙顶/平台角的瞬态假嵌入——真城镇 NPC 案例：向导 18×40 挤 1 格宽门洞,
  //  左缘 1px 嵌进 (3180,378) 王朝木、脚下 379-383 全空,顶行每 10t 擦到
  //  (3180,378)→抬升支 +16px→重力拉回,极限环 cy 6055↔6070 永久电梯（日志
  //  hw=1 顶墙+g=0+末尾 −14px 回弹）。★门取 vy>=0 非 >0（2026-09-02 备案
  //  收齐扩面）：vy==0 悬空态（跳跃顶点恰刷角 / 顶头 catch 当拍 / 悬停飞行
  //  体贴檐）同属无支撑,抬升同样是 16px 非原版瞬移;vy<0 真上升段保持旧路径
  //  不扩面。有支撑面（地面 catch / 坡面 glue）在 unembedPass 时点恒
  //  onGround=true 或 vy 已被清零→不落本门（slopeCollide :190 贴合置
  //  onGround 实证）。原版无 unembed 等价机制,此姿态交还原版物理：继续
  //  下沉直至被下方合法面 catch（实测落到下方平台/坡道→自行走脱困）；
  //  若下方全实心则沉成 centerSolid 活埋→15t 延迟支接管,无漏救窗口。
  //  真卡顶（站台态 onGround=true,凹龛/tent 案）与活埋（centerSolid）不走
  //  本门,照旧救援。
  if (topEmbedded && !centerSolid && !b.onGround && b.vy >= 0) return;
  const emb = (b.embedTicks ?? 0) + 1;
  b.embedTicks = emb;
  // ★topEmbedded 快速响应(2026-08-31):头顶 solid 区嵌入的 15t 延迟期 = 无限上下
  //  弹跳期(站台+上方家具 1 格空隙),观感不可接受。top-embed 检出可靠性高(逐列扫
  //  solid 含坡面三角判定),2t 即可确认非瞬态。
  const delay = topEmbedded ? 2 : EMBED_DELAY_TICKS;
  if (emb < delay) return;
  // ① 向上:从盒顶行上方起找连续净空(≤3 格),每 tick 至多上移 1 格
  let clear = 0;
  for (let k = 1; k <= 3; k++) {
    const ty = topRow - k;
    if (!st.inBounds(cx, ty) || st.isSolid(cx, ty)) break;
    clear = k;
  }
  if (clear > 0) {
    const lift = Math.min(clear * TILE, TILE);
    if (lift > 0) {
      const ny = b.y - lift;
      // ★增量条带验证(2026-08-25 限速改):只验新扫过的顶带(旧顶行以上至新顶行)
      // ——限速后盒下半仍嵌在原实心里(救援前提),整盒验证恒假自否。
      // 原整盒验证(2026-08-24)配全深抬升,语义=一次到位;限速后逐格爬出,
      // 每步只须保证新进入的行净空(坡/半砖/平台不拦,同原判)。
      const nx0 = Math.floor(b.x / TILE), nx1 = Math.floor((b.x + b.w - 0.01) / TILE);
      const newRow = Math.floor(ny / TILE);
      const oldRow = Math.floor(b.y / TILE);
      let fits = true;
      for (let tx = nx0; tx <= nx1 && fits; tx++) {
        for (let ty = newRow; ty < oldRow && fits; ty++) {
          if (!st.inBounds(tx, ty)) continue;
          const ti = st.idx(tx, ty);
          if (st.isSolid(tx, ty) && st.slope[ti] === 0 && !st.half[ti] && !st.isPlatform(tx, ty)) {
            fits = false;
            break;
          }
        }
      }
      if (fits) {
        b.y = ny;
        if (b.vy > 0) b.vy = 0;
        return;
      }
    }
  }
  // ② 水平:左右各探 2 格,取连续净空更宽的一侧平移
  const sideClear = (dir: number): number => {
    let n = 0;
    for (let k = 1; k <= 4; k++) {
      const tx = cx + dir * k;
      if (!st.inBounds(tx, cy) || st.isSolid(tx, cy)) break;
      n = k;
    }
    return n;
  };
  const l = sideClear(-1), r = sideClear(1);
  if (l === 0 && r === 0) return;
  const dir = r >= l ? 1 : -1;
  // ★2026-09-01 tent 弹飞定罪:topEmbedded 一口气 min(max(l,r),4) 格爆推 =
  //  "阻尼走到悬臂尽头被弹出数格以外"的元凶(vanilla 无 unembed 等价机制,本支
  //  纯 worldgen 坏形自愈兜底)。收敛:每 tick 至多 1 格,本嵌入会话累计 ≤2 格,
  //  超帽即放弃本支(降级驻留,① 垂直支每 tick 重试)——禁止远程传送弹射。
  const wide = Math.min(Math.max(l, r), topEmbedded ? 1 : 4);
  const used = b.embedPushed ?? 0;
  const budget = topEmbedded ? Math.max(0, 2 * TILE - used) : wide * TILE;
  const push = Math.min(wide * TILE, budget);
  if (push <= 0) return;
  const nx = b.x + dir * push;
  // 增量条带验证（同上移支）：只验新扫入的前缘列
  const leadCol = dir > 0 ? Math.floor((nx + b.w - 0.01) / TILE) : Math.floor(nx / TILE);
  let fits = true;
  for (let ty = Math.floor(b.y / TILE); ty <= Math.floor((b.y + b.h - 0.01) / TILE); ty++) {
    if (!st.inBounds(leadCol, ty)) continue;
    const ti = st.idx(leadCol, ty);
    if (st.isSolid(leadCol, ty) && st.slope[ti] === 0 && !st.half[ti] && !st.isPlatform(leadCol, ty)) {
      fits = false;
      break;
    }
  }
  if (fits) {
    b.x = nx;
    b.vx = 0;
    if (topEmbedded) b.embedPushed = used + push;   // 预算记账(会话帽)
    const dbg = (globalThis as Record<string, unknown> | undefined)?.__swPhysDbg as Record<string, number> | undefined;
    if (dbg) dbg.unembedH = (dbg.unembedH ?? 0) + 1;
  }
}

// ---- ★SW-FX40（g）：UpdateTouchingTiles 探针族（Player.cs:57734-57765 →
//      Collision.IsClearSpotTest :2547-2600 + FindCollisionTile :2602-2681）----
//  探针语义：体从 start 起按 (dx,dy) 位移是否被 tile 拦截（原版
//  `TileCollision(position - vector, vector, …) != vector`）——用 scratch Body 走
//  moveAxis（单轴分步/坡面放行门/残量语义与玩家碰撞同源），只写 scratch 不触世界。
//  slope 支近似：原版 SlopeCollision 对【位移后】盒做贴合（结果≠入参=命中）；本仓
//  slopeCollide 带 G2/入口门无法无副作用复用 → 以「盒与坡格静态相交」近似（坡面
//  命中面=贴合带，消费面 GetHurtTile 兜底排除窒息族且尖刺族无坡，偏差不达消费面）。

/** 单次 TileCollision 探针（IsClearSpotTest/FindCollisionTile 公用）。
 *  start=(x,y)（位移【前】盒位）,位移=(dx,dy)。返回是否被拦截。 */
export function tileCollisionProbeBlocked(
  world: World, x: number, y: number, w: number, h: number,
  dx: number, dy: number, gravDir: 1 | -1,
): boolean {
  const scratch: Body = {
    x, y, w, h, vx: dx, vy: dy,
    onGround: false, hitWall: false, hitHead: false,
    gravDir, stepUp: false,
  };
  const { hitX, hitY } = moveAxis(scratch, world, dx, dy);
  return hitX || hitY;
}

/** 坡支近似探针（IsClearSpotTest checkSlopes / FindCollisionTile checkSlopes）：
 *  盒 [x..x+w)×[y..y+h) 与任一致动坡格（slope≠0）静态相交 → 命中。 */
export function slopeProbeHit(
  world: World, x: number, y: number, w: number, h: number,
): boolean {
  const st = world.store;
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.01) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.01) / TILE);
  for (let i = x0; i <= x1; i++) {
    for (let j = y0; j <= y1; j++) {
      if (!st.inBounds(i, j)) continue;
      const k = st.idx(i, j);
      if (st.slope[k] !== 0 && st.isActive(i, j)) return true;
    }
  }
  return false;
}

/** Collision.IsClearSpotTest（:2547-2600）：四向卡笛尔 TileCollision 探针
 *  （start=position−vector、位移=vector → 扫过 [position−testMag, position] 带）
 *  + checkSlopes 时四向 SlopeCollision 探针（start=position 原位）。全通=净空。 */
export function isClearSpotTest(
  world: World, x: number, y: number, w: number, h: number,
  testMag: number, gravDir: 1 | -1, checkSlopes: boolean,
): boolean {
  if (!tileCollisionProbeBlocked(world, x - testMag, y, w, h, testMag, 0, gravDir)
    && !tileCollisionProbeBlocked(world, x + testMag, y, w, h, -testMag, 0, gravDir)
    && !tileCollisionProbeBlocked(world, x, y - testMag, w, h, 0, testMag, gravDir)
    && !tileCollisionProbeBlocked(world, x, y + testMag, w, h, 0, -testMag, gravDir)) {
    if (!checkSlopes) return true;
    // 原版四向 SlopeCollision 探针 start 均为 position 原位——静态相交判定四向同值,
    // 单次即四向并集（偏差见头部注）
    return !slopeProbeHit(world, x, y, w, h);
  }
  return false;
}

/** Collision.FindCollisionTile 竖向半边（:2602-2643 Direction 2/3——UpdateTouchingTiles
 *  两处实参恒为 `sign(vy)==1 ? 2 : 3`，横向半边 :2644-2681 零调用面不移植）。
 *  Direction 2=下探（vector=(0,+testMag)，y=(int)(position.Y+Height)/16），
 *  3=上探（vector=(0,−testMag)，y=(int)position.Y/16）。列切分按原文：首列
 *  num=min(16−x%16,Width)、中列 16 递进（num2+16≤Width−16）、尾列余宽。
 *  返回触碰格点集（列为探针子盒左缘列、行为前缘行——:2616/:2626/:2636 字面）。 */
export function findCollisionTileVertical(
  world: World, dir: 2 | 3, x: number, y: number, w: number, h: number,
  testMag: number, gravDir: 1 | -1, checkSlopes: boolean,
): Array<{ x: number; y: number }> {
  const list: Array<{ x: number; y: number }> = [];
  const dy = dir === 2 ? testMag : -testMag;
  const ty = Math.floor((y + (dir === 2 ? h : 0)) / TILE);
  const blocked = (sx: number, cw: number): boolean =>
    tileCollisionProbeBlocked(world, sx, y - dy, cw, h, 0, dy, gravDir)
    || (checkSlopes && slopeProbeHit(world, sx, y, cw, h));
  const num = Math.min(16 - (((x % 16) + 16) % 16), w);   // :2612（C# 浮点模恒 ≥0）
  let num2 = num;
  if (blocked(x, num)) list.push({ x: Math.floor(x / 16), y: ty });
  for (; num2 + 16 <= w - 16; num2 += 16) {
    if (blocked(x + num2, 16)) list.push({ x: Math.floor((x + num2) / 16), y: ty });
  }
  const rest = w - num2;
  if (rest > 0 && blocked(x + num2, rest)) list.push({ x: Math.floor((x + num2) / 16), y: ty });
  return list;
}
