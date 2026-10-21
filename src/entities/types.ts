// 实体与 Game 交互的接口（避免循环依赖，只放类型）
import type { World } from '../world/World';

/** MP 掉落结算玩家表条目（GameHooks.lootPlayers；2026-08-20 per-client 批）。
 *  原版对应：closestPlayer = Player.FindClosest（Player.cs:11666-11689 曼哈顿
 *  中心距,active&&!dead）——luck/hp/mana 注入取最近者；per-client 族
 *  （bossBag/masterAll）按 interacting（npc.playerInteraction[slot]）门控 */
export interface LootPlayerCtx {
  slot: number;
  /** 玩家中心 px（perPlayer 掉落落点 = player.position,CommonCode.cs:73） */
  x: number; y: number;
  dead: boolean;
  /** Player.luck（msg16 尾段镜像；旧端无尾段缺省 0） */
  luck: number;
  hp: number; hpMax: number;
  mana: number; manaMax: number;
  /** npc.playerInteraction[slot]（打击过该 NPC） */
  interacting: boolean;
  /** Player.ZoneDungeon（地牢魂条件 NPC57:79880 用目标玩家 zone——R14-A11②） */
  zoneDungeon?: boolean;
}

export interface GameHooks {
  world: World;
  /** 主角(投射物命中判定用) */
  player: import('./Player').Player;
  /** M11 敌怪索敌候选玩家（原版 TargetClosest 扫 Main.player[0..254] 255 槽，
   *  NPC.cs:78456-78464）。Game 实现 = [本地玩家, ...remotePlayerProxies]（联机
   *  访客代理——真 Player 实例，位置/死亡/装备经 msg13/16/5 同步）；缺省 undefined
   *  时 Enemy.targetClosest 回退 [player]（单机/测试 mock 零回归）。顺序即槽序
   *  近似（本地=房主槽 0 最先，原版平距严格 < 比较取先扫描者） */
  candidatePlayers?(): import('./Player').Player[];
  /** 视口世界像素（Main.sWidth/sHeight 等价 = 画布尺寸÷缩放）——CanAnyPlayerSeeThisTile
   *  （NPC.cs:43877-43890 屏盒求交）等消费源。缺省 = 1920×1080 静态退档（单机测试 mock 兼容）。
   *  ★MINOR-6（2026-09-02）：CanAnyPlayerSeeThisTile 已画布无关化（原版常量 1920×1200,
   *  NPC.cs:6791-6793）,本钩子保留给其余真实视口消费点 */
  screenWorldSize?(): { w: number; h: number };
  /** NPC.noSpawnCycle（MINOR-2,NPC.cs:6186/:78797/:80991-80995）：本帧任一怪经
   *  CheckActive 消散（Enemy.runDespawnFx 置位）→ 同帧刷怪周期跳过一次
   *  （Game.trySpawnEnemy 入口消费+清零）。模拟宿主（SimHost 等）不置位=无消散,
   *  消费端读假值零回归 */
  noSpawnCycleThisFrame?: boolean;
  /** MP 掉落结算玩家表（NPCLoot :79634 closestPlayer / per-client 族的数据源；
   *  2026-08-20 per-client 批）。Game 实现 = [本地(slot=mySlot) + 远端代理
   *  （msg13 位 + msg16 尾段 hp/mana/luck 镜像）]；SimHost 实现 = room.onlineClients
   *  × enemy 交互集。interacting = npc.playerInteraction[slot]（Enemy.interactionSlots）。
   *  返回 undefined = 单人语义（结算走旧路径,resolveDrops lootPlayers 缺席零变化） */
  lootPlayers?(enemy: import('./Enemy').Enemy): LootPlayerCtx[] | undefined;
  /** per-client 掉落发放（CommonCode.DropItemLocalPerClientAndSetNPCMoneyTo0
   *  netMode==2 段的等价）：targetSlot=本端 → 本地 netLocalOnly 掉落（不同步,
   *  仅本端玩家可拾,原版 instanced=true + reservedFor=myPlayer 语义）；访客槽 →
   *  module14 定向下发。结算端（房主/SimHost）调用 */
  grantInstancedLoot?(
    targetSlot: number, x: number, y: number, itemKey: string,
    stack: number, vx: number, vy: number,
    prefix?: number,   // ★BJ390：本地实例词缀随件（module14 远端臂无词缀域=登记债）
  ): void;
  /** 敌人列表(投射物命中判定用) */
  enemies(): unknown[];
  /** 投射物桶只读（风暴落雷 800px 去重扫描用;StormLightningSpawner 消费） */
  projectiles?(): unknown[];
  /** Main.mapFullscreen（全屏地图开关——链锤 AI_015 击杀门 Projectile.cs:41057-41059
   *  消费：开图瞬间链锤消失。Game 实现 = renderer.fullMap.open 镜像;缺省 = 不杀） */
  mapFullscreen?(): boolean;
  /** 城镇 NPC 自卫弹入投射物桶(attackUpdate 消费) */
  spawnTownShot?(shot: import('./TownShot').TownShot): void;
  /** 小动物产生的弹幕入投射物桶（AI_024 鸟粪 1080 等；仅本地——MP 门禁在产生端） */
  spawnCritterProj?(e: import('./Entity').Entity): void;
  /** 玩家侧命中后效真弹入投射物桶（★α-H3④ WeaponProj.hitEnemies confetti 289 支
   *  ——Projectile.cs:13693-96 NewProjectile(289) 等价出射口。Game 实现 =
   *  entities.add(e,'projectiles')，联机由弹幕互播通道自然覆盖） */
  spawnFriendlyProj?(e: import('./Entity').Entity, opts?: { netSync?: boolean }): void;

  /** 叶绿水晶叶锚体（226）对账+缺位补生（Player.UpdateBuffs buff60 分支
   *  :11749-11766 的桶扫描语义：只留最先扫到的一只、多余 Kill、无存活才生成——
   *  Player.fixedUpdate buff 维护段消费，BuffType.LeafCrystal 在场才调 */
  updateChloroCrystalAnchor?(): void;
  /** 叶绿晶弹 227 发射出射口（Projectile.cs aiStyle42 :28253 与 Player.OnHit :7029
   *  两生产位共用；dmg/kb = Player.crystalLeafDamage/KB 静态 100/10 直传不吃面板，
   *  实体 ChloroLeafShot 内部再兜底缺省）。(x,y)=出生中心（原版 Center.X−4f, Center.Y） */
  spawnChloroLeafShot?(x: number, y: number, vx: number, vy: number): void;
  /** 叶绿水晶叶 on-hit 引援叶扫桶（Player.OnHit 尾段 :6986-7040 全语义含序依赖
   *  break 怪癖；Enemy.hurt fromPlayer 钛金 proc 同位次调用,victim=受击敌怪） */
  chloroOnHitLeafStrike?(victim: unknown): void;
  /** 山铜（奥利哈刚）套装 on-hit 花瓣弹（终零波批,2026-09-01）：Player.OnHit
   *  :6963-6985 `onHitPetal && petalTimer==0` 支——petalTimer=20 共享窗置位 +
   *  NewProjectile(221,36,kb0) 屏幕边出生。调用位 = Enemy.hurt fromPlayer 段
   *  （钛金→[神圣 buff59]→帕拉钯→花瓣→叶绿 同位次链）,(x,y)=受击敌怪中心 */
  spawnOnHitPetals?(x: number, y: number): void;
  /** 小动物列表(弹幕命中判定用;近战挥砍在 Game 内直接遍历桶) */
  critters(): unknown[];
  /** 城镇 NPC 列表(受击判定用;Game 实现 = entities.npcs 桶) */
  npcs?(): unknown[];
  /** 在世界上生成掉落物（返回实体便于染色等后处理）。x/y=掉落中心锚（盒左上按
   *  vid 半宽/半高回退,vanilla-itemdims）；vx/vy 缺省 undefined = 原版 NewItem
   *  velocity=null 随机初速掷（Item.cs:49746-49756,BJ326），显式传值=固定初速面 */
  spawnDrop(x: number, y: number, itemKey: string, count?: number, vx?: number, vy?: number,
    placeStyle?: number, prefix?: number): import('./ItemDrop').ItemDrop | null;
  /** 对玩家造成伤害（attacker 用于荆棘反伤/死亡归因；contactOnly=true 表示伤害源是
   *  NPC 接触（1457 Player.cs:31555-31692 Update_NPCCollision 循环）——荆棘只在接触
   *  分支反伤，弹幕命中不触发；pvp=true 走 Hurt 的 PvP 语义：8t 无敌帧 + pvpDeath 标记。
   *  返回值 = 实扣 HP（0=被无敌帧/闪避吞掉——Player.Hurt 返回 0 语义直通）。
   *  ★清零批·受击域（2026-08-31）：knockback/opts 两参为 A2 环境伤族接 msg117 通用
   *  漏斗新增（additive 透传位，缺省不动既有调用方语义）：
   *    · knockback=false：hitDirection=0 型站（岩浆/摔落/虚空/触格伤）不进击退段
   *      （Player.damage :37908-37912 的 hitDirection≠0 才写速度），此前环境站手调
   *      p.damage 有误传默认导致落地弹起 ±4.5px 的漂移，接漏斗后按原文关断；
   *    · opts.hitDir：msg117 命中向字面透传（FR3-F 钉语义允许 0=零击退，缺省仍按
   *      sign(cx−srcX)||1 推算不改五 PvP 支）；
   *    · opts.floatDealt/floatColor/noLocalFloat：本地飘字单点化控制——漏斗是唯一
   *      显示点，环境站经 damagePreview 预演回填终值保像素零漂移并消除双发。 */
  damagePlayer(dmg: number, srcX: number, srcY: number, attacker?: import('./Enemy').Enemy,
    contactOnly?: boolean, pvp?: boolean, knockback?: boolean,
    opts?: { hitDir?: number; floatDealt?: number; floatColor?: string; noLocalFloat?: boolean;
      /** ★红队 R1-F2:弹幕域旗(attacker 仅死亡归因,不进 modifyHurtByNpc 接触链) */
      projDomain?: boolean;
      /** ★D3:弹域修正链接线(projDomain+projVid 双旗→modifyHitPlayerByProj 倍率链) */
      projVid?: number }): number;
  /** ★充能电水母反噬单口（Player.TakeDamageFromJellyfish :44607-44613）——近战
   *  （ProcessHitAgainstNPC :44620）与弹幕（Damage_PVE_Inner :12682 ZappingJellyfish
   *  块）两口共用同一方法；proj1457.dealContacts 水母块消费 */
  takeDamageFromJellyfish?(e: unknown): void;
  /** ★F2 死亡结算单点（deaths 计数/掉落/硬核消亡——damagePlayer 致死分支与
   *  直扣 hp 致死站共用的幂等管线；Game 实现 settlePlayerDeath） */
  settlePlayerDeath?(pvp: boolean): void;
  /** X1 溺水观战回体（2026-09-01）：CheckDrowning 溺水直伤拍 SetOrRequestSpectating(-1)
   *  （Player.cs:23450——statLife-=2 (:23449) 与致死判 :23452-23455 之间，本地玩家门内
   *  全难度逐拍调）。原版语义：单机 netMode==0 两分支皆不进 = 纯 no-op（:17346-17375
   *  净空 return）；多人客户端半边 = spectating=-1 + msg150(whoAmI,target) 通报服务器
   *  重发焦点帧。target==spectating 早退（:17349-17351）保证逐拍重入零重发。
   *  Game 实现 askSpectateExit → setSpectating(-1)；缺省（测试 mock）= 静默跳过 */
  askSpectateExit?(): void;
  /** ★BJ108 登记债①清偿（2026-09-17）：玩家传送相机过渡实体侧单口——Main.
   *  StartCameraTransitionForPlayerTeleport（Main.cs:63526-63542/1458 :63532-63548）
   *  由 Player.Teleport :37747 全 style 汇聚调用（lerpSpeedupDelay 仅 Style==1 为 10,
   *  其余含 style12 微光脱困 Player.cs:29095 / style10 皇后钩瞬移 :22937 均 0）。
   *  Game 实现 = startCameraTransitionForPlayerTeleport（近滑行/远黑幕 BJ103-A1b
   *  单源）。消费面 = Player.shimmerUnstuck（style12）/doQueenSlimeHookTeleport
   *  （style10）；缺省（测试 mock/SimHost 无此钩）= 静默跳过 */
  startCameraTransitionForPlayerTeleport?(oldX: number, oldY: number, lerpSpeedupDelay?: number): void;
  /** 伤害数字飘字（dot=true 走 CombatText dot 样式:更小更短带重力,DoT 族用） */
  addDamageNumber(x: number, y: number, amount: number, crit: boolean, color?: string, dot?: boolean): void;
  /** 入侵开启 + 逼近公告（Game.startInvasionAndAnnounce 实体侧通道——火星探测器
   *  逃逸触发用;缺省回退方自行静默 startInvasion） */
  startInvasionWithAnnounce?(type: number, ignoreDelay?: boolean): boolean;
  /** PunchCameraModifier 近似（Main.instance.CameraModifiers）：dirX/dirY 方向
   *  单位向量 + strength(缺省 20) + frames(缺省 30)——鹿角怪震屏源 */
  punchCamera?(dirX: number, dirY: number, frames?: number, strength?: number,
    srcX?: number, srcY?: number): void;   // src = PunchCameraModifier.startPosition（距离衰减原点）
  /** 弹幕砍 tileCut 物（Projectile.CutTiles 语义：箭扫过杂草/瓦罐 → Game 内部分流） */
  /** ★SW-BJ67（2026-09-14）vid = 弹型上下文（vanilla Projectile.CutTiles 逐型豁免
   *  面 P.cs:15391-15393 消费——1047 滚过幼虫 231 不割;缺省 undefined = 无型） */
  cutTile(x: number, y: number, vid?: number, extraCutTreeCactus?: boolean): void;
  /** 传送门弹 601 落门（PortalHelper.TryPlacingPortal + AddPortal；Game 实现入 props 桶） */
  placePortal?(x: number, y: number, vx: number, vy: number, form: number): void;
  /** ★BJ562（2026-10-09）城镇 NPC 死亡墓碑出射口（NPC.checkDead townNPC 支
   *  DropTombstoneTownNPC NPC.cs:78971/:79082-79108 → NewProjectile 桶位）。
   *  Game 实现 = entities.add(t,'props')（玩家死亡墓碑 handlePlayerDeath 同桶）。
   *  缺省（测试 mock）= 静默 */
  spawnTownNpcTombstone?(t: import('./Tombstone').Tombstone): void;
  /** 破坏 tile（掉落+音效+帧刷新；Enemy 攻门拆门 = WorldGen.KillTile 语义） */
  breakTile?(x: number, y: number): void;
  /** ★SW-BJ93 债②（2026-09-16）滚石地形面薄委托：WorldGen.SlopeTile(i, j, 0, false,
   *  true)（WorldGen.cs:82045-82080 直译面）——SpreadTile 邻坡拍平（DelegateMethods.
   *  cs:534/:543,便便金字塔落位把下/上邻斜台拍回整块）消费。Game 实现 =
   *  worldGenSlopeTile(x, y, 0, false) 既有 1:1 面包装;缺省（测试 mock）= 静默跳过 */
  slopeTileAt?(x: number, y: number): boolean;
  /** ★SW-BJ93 债①/BJ102（2026-09-16）1002 Kill 支爆炸面薄委托：Game.explodeAt
   *  既有 1:1 面（SW-J1 谱系）——aiStyle16 Kill flag3 臂全序（SelfHurtPlayers
   *  :15104-15152 玩家段 / Damage PVE 链 dmg/2 :12971-75 / Kill_Bombs_DoUsualKillCode
   *  :80125 大族视觉）由 RollingBoulder.rbKill1002Face 单发消费。参表同 Game 私有
   *  explodeAt（tx/ty=格锚、radius、destroyTiles、hurtBox=伤害盒半宽、pen、projId、
   *  comparePx/Py=弹心像素、kb、kbDir）;缺省（测试 mock 无此钩）= 静默跳过 */
  explodeAt?(tx: number, ty: number, damage: number, radius: number, destroyTiles: boolean,
    hurtBox?: number, pen?: number, projId?: number, comparePx?: number, comparePy?: number,
    kb?: number, kbDir?: -1 | 0 | 1): unknown;
  /** 仙人掌支撑复查+整株断根(CheckCactus :54132 级联)——沙落/邻格变化后触发 */
  fellCactus?(x: number, y: number): void;
  /** 敌人死亡。opts.petrifyBypassInteractionGate（H2-2）：624 侏儒石化路径——
   *  原文不经 NPCLoot 交互门直记旗杀（NPC.cs:56456-56463）且不写
   *  lastCreatureHit/不调 NotifyNPCKilled */
  onEnemyKilled(key: string, enemy?: import('../entities/Enemy').Enemy,
    opts?: { petrifyBypassInteractionGate?: boolean;
      /** ★D20-m3:hurt 死亡支置位——mod 击杀双钩改 hurt 尾派发(tML 序),本口只走原版记账 */
      skipModKillHooks?: boolean }): void;
  /** 多格 framed 件运行期裸写（TileObject.Place TileObject.cs:94-110 语义：写循环期
   *  抑制 DECOR 逐格完整性裁决,全格写完后在锚点做一次 SquareTileFrame 级联
   *  （PlaceObject WorldGen.cs:51886-51888 尾）。Game 实现 = _decorPlaceBuilding 窗
   *  + 逐格 setTile（netReporter 照常逐格广播）+ checkDecorSquareFrame(锚点)。
   *  运行期放置单点——624 侏儒石化 PlaceTile(567)（NPC.cs:56449）消费；
   *  缺省（测试 mock）=调用侧回落逐格 setTile */
  placeObjectCells?(
    cells: ReadonlyArray<{ x: number; y: number; type: number; fx: number; fy: number }>,
    cascadeX: number, cascadeY: number,
  ): void;
  /** 成就系统（拾取通知等；仅 Game 本体注入） */
  achievements?: import('../core/Achievements').Achievements;
  /** 成就解锁弹窗(原版 InGamePopups.AchievementUnlockedPopup:底部居中 40px、
   *  5s、库存蓝底 64px 图标+边框+成就名;UI 实现,缺省回退 onToast) */
  onAchievementPopup?(name: string, title: string): void;
  /** 出生敌人 */
  spawnEnemy(key: string, x: number, y: number): void;
  /** 按原版 NPC id 出生（Enemy.fromVanilla；小动物入微光 Transform / makeNPC 放生用。
   *  Game 实现：入 critters 桶（同 spawnCritter 的 spawnVanilla 语义），联机访客拒绝。
   *  ★BJ704-G14 件2②：style/released 参=ReleaseNPC 语义域（356 蝴蝶 Style /
   *  released 释放旗=releaseOwner!=255）——释放域调用走 CanReleaseNPCs 内门
   *  （NPC.cs:80930,超限返 null） */
  spawnNpcByVanilla?(id: number, x: number, y: number, style?: number, released?: boolean): import('./Enemy').Enemy | null;
  /** WorldGen.CheckAchievement_RealEstateAndTownSlimes（WorldGen.cs:5581）——镇民
   *  史莱姆/Transform 族实体侧触发面（微光 4986 解锁等）回调 Game 实现 */
  checkAchievementRealEstateAndTownSlimes?: () => void;
  /** ★SW-BO1 2026-09-07：城镇 NPC 死亡复位优先型锁（NPC.cs:78986-78989）——
   *  homeless=true 且其类型正持 WorldGen.prioritizedTownNPCType 锁 → 锁清零。
   *  TownNPC.hurt 致死支消费；缺省（mock）= 静默 */
  townNpcPrioritizedLockReset?(homeless: boolean, npcId: number): void;
  /** 法力斗篷星雨(魔法武器命中触发,Projectile.cs:13892-13914):冷却门+生成 1 颗 723 法力星(ai2=1 落地掉 4143) */
  tryManaCloakStarOnMagicHit?(x: number, y: number): void;
  /** MP：他人掉落（傀儡）被本端【整堆】拾取后上报 take（op1）——拥有端移除真身。
   *  与部分拾取的 puppetDropResidue 成对；傀儡 TTL 自然消亡不得触发（否则
   *  拥有端把"丢包超时"当"被人捡走"，真身被误杀——2026-08-28 探针实锤） */
  puppetDropTaken?(d: import('./ItemDrop').ItemDrop): void;
  /** MP：他人掉落（傀儡）被本端部分拾取后的余量上报（msg21 op0 全态；Game 实现
   *  → 拥有端据以更新真身，防重 assert 回灌复制）。整堆拾取走 op1 take 不经此 */
  puppetDropResidue?(d: import('./ItemDrop').ItemDrop): void;
  /** 风暴落雷 bolt 折线校验（WorldGen.TrySpawnLightningBolt :72586-72589
   *  LightningGenerator.StormLightning.CanHitTarget 等价——折线无 tile 碰撞才可落） */
  stormLightningBolt?(seed: number, vx: number, vy: number):
    { positions: Array<{ x: number; y: number }>; collidedWithTile: boolean } | null;
  /** 生成 1091 世界落雷弹（TrySpawnLightningBolt :72590-72594 NewProjectile
   *  500 伤 ai0=-1 ai2=种子）——StormLightningSpawner 消费 */
  spawnStormBolt1091?(vx: number, vy: number, seed: number): void;
  /** AnyDanger（SpawnStormLightning :72448 NPC.AnyDanger=任一 boss 在场 → 频率÷1.5） */
  anyBossDanger?(): boolean;
  /** 粒子 */
  spawnParticles(
    x: number, y: number, color: string, count: number, speed?: number,
    opts?: { life?: number; damp?: number; grav?: number; size?: number; vx?: number; vy?: number;
      /** 逐 tick 恒定加速度（原版编排粒子 AccelerationPerFrame 通道——湖面星闪
       *  (move/60)/TTL、枭首者残影 vel/60 等双轴加速型 1:1 用；缺省 0）。
       *  ★F3 接线契约三件套（2026-09-02 红队 I′ 仲裁钉死,T2 待办消账）：
       *  ①【缺省重力】ax/ay 任一在位 → 缺省 grav=0（Game.particleGravDefault;
       *    编排粒子轨迹由 Velocity+APF 全责,显式 grav 恒优先）;
       *  ②【TTL 耦合】APF 按 TTL 折算的站一律传 lifeExact（缺省 life 是
       *    base×(0.6+0.4r) 抖动基值,喂 TTL 耦合公式=终速/位移积分漂移）;
       *  ③【princess/stardust 两站接线公式】（orchestraFx,参数现成 moveX/moveY/rng,
       *    ParticleOrchestrator.cs:3363/:3373-3374 及 stardustPunch 同构段）——
       *      ax = −(moveX×(0.6+0.35r))/60, ay = −(moveY×(0.6+0.35r))/60,
       *      vx/vy = move×(0.6+0.35r)×0.66, lifeExact: 60, grav: 0
       *    （APF 用 ×0.66 之前的 vector;减速零点 t=39.6 后反向漂移 20 拍=原版手感;
       *    同一 rng 掷取 pre-0.66 因子,mf=因子×0.66 双用不增掷）。 */
      ax?: number; ay?: number;
      /** 寿命不抖动档（编排粒子 TTL 耦合参数——加速度按 TTL 折算时必须同值,
       *  否则终速/位移积分漂移；★F3 契约②:APF 站一律走本档,
       *  缺省走 base×(0.6+0.4r) 抖动） */
      lifeExact?: number },
  ): void;
  /** 定向粒子爆发（烟花爆花/喷泉/马桶水花等原版 dust 带初速方向的场景；
   *  spawnParticles 为全向均匀发射，无法表达定向）。dir 为中心角、spread 为半散布，
   *  xMul/yMul 为原版轴向压缩（如 168 尘 y×0.75、马桶尘 x×0.5） */
  spawnBurst?(
    x: number, y: number, color: string, count: number, speed: number,
    dir: number, spread: number,
    opts?: { life?: number; damp?: number; grav?: number; xMul?: number; yMul?: number },
  ): void;
  /** 原版 Dust 池（VanillaDust.spawn 直通——NPC.HitEffect 鸟族血尘 61/252/301 等
   *  实体侧消费；leashedEnv 另有同款包装）。缺省 = 测试/无尘环境静默跳过 */
  dust?: {
    spawn(x: number, y: number, w: number, h: number, type: number, speedX?: number,
      speedY?: number, alpha?: number,
      color?: { r: number; g: number; b: number; a: number } | null, scale?: number): unknown;
  };
  /** 拾取物品后刷新 UI（掉落物实体调用） */
  notifyInventoryChanged(): void;
  /** 编排粒子广播（ParticleOrchestrator.BroadcastOrRequestParticleSpawn 联机半边：
   *  调用方本地视觉已生成,此钩子只送服务器中继（module8,排除发送者广播）。
   *  type = ParticleOrchestraType 注册序（net/syncModules）；moveX/Y = 位移型
   *  编排的 MovementVector（ShimmerTownNPCSend）；uniqueInfo = UniqueInfoPiece
   *  （LoadoutChange = 配装档序）；缺省 = 单机/无网静默 */
  broadcastParticleOrchestra?(type: number, x: number, y: number, moveX?: number, moveY?: number, uniqueInfo?: number): void;
  /** 原版 Dust 池（翅膀尘埃批引入；Game 本体实例化，缺省 = 不生成） */
  vanillaDust?: import('../fx/VanillaDust').VanillaDust;
  /** 无人机相机跟拍登记（DroneCameraTracker.Track——AI_195/AI_205 owner==myPlayer
   *  支逐帧调用 Projectile.cs:41688/:38825;清偿刀 A：I 刀出膛位代行退役,Track 归位
   *  AI 逐帧面）。proj 须满足 render/DroneCameraTracker.DroneCameraTrackable 结构面
   *  （projId/dead/cx/cy/ownerPlayer——DroneBase 实形满足）;缺省 = 无相机通道。 */
  droneCameraTrack?(proj: import('../render/DroneCameraTracker').DroneCameraTrackable): void;
  /** 世界坐标光源（翅膀 28 的 Bottom 微光等实体侧 AddLight） */
  addLightAt?(x: number, y: number, r: number, g: number, b: number): void;
  /** 读侧光照采样（0-255 RGB；翅膀 49 Heroicis 光照门消费）——区域外 [0,0,0] */
  lightAt?(x: number, y: number): [number, number, number] | null;
  /** 位置衰减音效（实体侧 SoundEngine.PlaySound）——name 走 SfxName */
  playSfxAt?(name: import('../core/Sfx').SfxName, x: number, y: number): void;
  /** 弹幕消亡钩子（Projectile.Kill 按弹型分发；x/y/w/h = 弹体命中盒，
   *  oldVx/oldVy = 消亡时速度——碎镜 1085 的 Kill 特效链消费；
   *  flags = 弹体态补充：hostile（Damage() 结算方向）/ ai0（92 坠星代际链）/
   *  kb+arpen（41 狱炎箭 64×64 重结算的击退/穿甲，取自弹体）/
   *  sc（弹体 SetDefaults scale——R27：95 诅咒之焰 Kill 尘 scale×scale 消费）/
   *  ownerLocal（★清偿刀G：Kill owner==Main.myPlayer 门的等价投影,Projectile.cs
   *  :71983——1020 成就 TO_INFINITY_AND_BEYOND 只认本地自有弹;傀儡显式 false） */
  onProjectileDeath?(projId: number, x: number, y: number, w?: number, h?: number, oldVx?: number, oldVy?: number, dmg?: number,
    flags?: { hostile?: boolean; ai0?: number; kb?: number; arpen?: number; sc?: number; ownerLocal?: boolean }): void;
  /** 粉末云实效（净化粉 proj 10 / 邪恶粉 11 / 猩红粉 463，Projectile.cs:22399-22533
   *  AI_006 每帧回调）：命中盒内逐格 WorldGen.Convert + Damage_TryUsingPowders（:13646）
   *  NPC 转化。Game 实现（evolution.convert + bound 税务官 Transform 链） */
  applyPowder?(projId: number, x: number, y: number, w: number, h: number): void;
  /** SW-U1 2026-09-04：Skeletron Prime 炮弹 102（BombSkeletronPrime）Kill 爆专用转发
   *  （Projectile.Kill_Bombs_DoUsualKillCode :80070-80115 通支视觉 + Kill_ExplodeTiles
   *  :79027-79035 FTW 闸门地形爆）。px/py = 弹心像素（vanilla 地形爆心 center2 =
   *  position = 弹心−11,经 explosionCompareHalfBoxPx(102)=11 落位）;radius/destroyTiles
   *  由弹侧 FTW 四象限门（primeBombTerrainRadius）传入;实体段在实现内中性化
   *  （hostile 弹对 NPC 零伤/SelfHurtPlayers 不跑——玩家伤走弹侧 hitPlayer） */
  explodePrimeBomb102?(tx: number, ty: number, px: number, py: number, radius: number, destroyTiles: boolean,
    kbDir?: -1 | 0 | 1): void;   // SW-AC1 2026-09-04：尾参=弹体朝向（Projectile.direction 弹末 vx 符号,缺省 0=旧径向）
  /** SW-X1 2026-09-04：Collision.HitTiles 转发（Game.hitTilesFx 实现——KillTile(fail:true)
   *  分型砖屑尘;655 蜂巢落地反弹同拍面 Projectile.cs:19382 消费） */
  hitTilesFx?(x: number, y: number, w: number, h: number, vx: number, vy: number): void;
  /** 吸血链（Projectile.vampireHeal/ghostHeal）：返回实际回复 HP（0 = 未生效） */
  applyLifeSteal?(kind: 'vampire' | 'ghost', dmg: number, numHits: number, x: number, y: number, isMagic?: boolean): number;
  /** 投射物显示名（Lang.GetProjectileName cs:444——死亡归因 DeathSource.Projectile 用） */
  projectileName?(id: number): string | null;
  /** 播放音效 */
  // 世界坐标声（原版 SoundEngine.PlaySound 带 x/y）：x/y 省略 = UI/玩家动作声不衰减
  playSfx(name: string, vol?: number, x?: number, y?: number): void;
  /** 怪物专属声效（原版文件名列表随机选）。pitch = XNA pitchOffset（SoundEngine.PlaySound
   *  SoundStyle 重载第 3 参——arcSurgeFx :1268 NextFloatDirection×0.2−0.05 变调消费） */
  playSfxFiles(files: string[], vol?: number, x?: number, y?: number, pitch?: number): void;
  /** 行为决策日志（debug-report behaviorTail 段;缺省=单人安静路径不记） */
  behavioLog?(k: string, d: unknown): void;
  /** 城镇 NPC 开关门即时事件广播（原版 msg19 DoorOpen 的等价通道，NPC.cs:54398/54610）：
   *  仅 NPC 模拟端（房主/SimHost）发送；远端立即重放开闭动作+音效（tile 终态由
   *  TileBatch 收敛）。kind='door' 普通 2×3 门 / 'gate' 高门(388/389)；closing=false=开。
   *  缺省 = 单人/旧客户端零发送 */
  npcDoorNet?(kind: 'door' | 'gate', x: number, y: number, closing: boolean, dir: number): void;
  /** ★BJ322（2026-09-24）：Collision.EmptyTile(x,y,ignoreTiles) 占位谓词（占用=true,
   *  只看玩家/NPC）——NPC/怪开合高门 ShiftTallGate(forced=false) 的实体占位门
   *  （WorldGen.cs:52206-52212,开/关两向）。缺省 = 无门（测试 mock/SimHost 零回归） */
  overlapsEntity?(px: number, py: number): boolean;
  /** ★BJ322：ShiftTallGate 尾 TileFrame 面（WorldGen.cs:52224-52231）等价扫面——
   *  NPC/怪开合高门裸写后的完整性/邻件复检。缺省 = 不评估（同上零回归） */
  tallGateTileFrameFace?(ax: number, ay: number): void;
  playSfxWav?(file: string, vol?: number, x?: number, y?: number, pitch?: number, replace?: boolean): void;   // 单 wav 直播（环境声三表;pitch=变调/EoC 连冲 0.6;replace=case36 ForceRoar 覆盖语义;可选=测试 mock 兼容）
  /** 跟踪式循环音（SoundEngine.PlayTrackedLoopedSound——AI_016 引信嘶声/
   *  DD2 传送门 idle 环(:41409/:41458)/小妖精引信双轨(:63969+)；
   *  返回句柄 stop/setPos/setVolume(ActiveSound.Volume 逐帧覆写档,NPC.cs:41464
   *  收门段 Volume=scale 消费)；Game 实现 = Sfx.startTrackedLoop，缺省无循环音） */
  startTrackedLoop?(
    name: string, vol: number, x: number, y: number,
  ): { stop(): void; setPos(px: number, py: number): void; setVolume?(v: number): void; setPitch?(p: number): void } | null;
  /** channel 蓄力期手持动画续期（Player.ItemCheck channel 分支 itemAnimation 钉满——
   *  手持法杖全程举向鼠标不脱落；GlacierFangShot/PrismProj 蓄力态逐 tick 调用） */
  refreshChannelItem?(aim?: number): void;
  /** 常驻循环轨按 wav 文件（SoundEngine.PlayTrackedLoopedSound 的音量跟随档——
   *  吸血鬼炽灼音环 SoundID.VampireSizzle（Player.cs:28107-28121）Volume 每帧 =
   *  GetLerpValue(0,120,sunScorchCounter)；Game 实现 = Sfx.playLoopFile，
   *  句柄 setVolume 每帧跟随 / stop 拆轨（loopingCondition =
   *  VampireSizzleTracker.IsActiveAndInGame，Terraria.Audio/VampireSizzleTracker.cs）；
   *  缺省无循环音（测试 mock 兼容） */
  startLoopSfx?(
    file: string, vol: number, base?: number,
  ): {
    stop(): void; setVolume(v: number): void;
    readonly playing: boolean; readonly dead: boolean;
  } | null;
  /** 矿车碾过压板轨道（Minecart.HitTrackSwitch → Wiring.HitSwitch，Minecart.cs:1287-1294）。
   *  Game 实现：路由到 Wiring.hitSwitch（压板/轨道族直接 TripWire） */
  hitTrackSwitch?(i: number, j: number): void;
  /** 按原版文件名直播（无合成兜底；缓冲未就位时仅触发后台懒加载，本播静默） */
  playSfxFile?(file: string, vol?: number, x?: number, y?: number): void;
  /** 行为录制（debug/BehaviorRecorder 环形日志——长按 F5 录制窗/短按 F5 报告
   *  尾巴）：实体侧一行式接入 `game.recLog?.('death', {...})`。缺省 undefined
   *  零开销；Game 本体实现 = recorder.log。恒安全（无窗也进环——追溯用） */
  recLog?(k: string, d: unknown): void;
  /** ChatHelper.BroadcastChatMessage（ChatHelper.cs:47-57）世界广播单口：本地消息列
   *  （Main.NewText → ChatMonitor 面）+ 联机 channel2 系统行中继其他端（server 侧
   *  slot=255 无名前缀 + RGB）。消费点 = 859 沙滩球踢次公告（Projectile.cs:18719
   *  Game.BallBounceResult + ChatColors.ServerMessage(255,240,20)）。缺省 undefined
   *  = 静默（mock 兼容）；SimHost 实现 = simRoom.notice（serverNotice 同色） */
  chatBroadcast?(text: string, r: number, g: number, b: number): void;
  /** 本地玩家表情气泡（EmoteBubble.MakeLocalPlayerEmote——饥饿链 146/147/148 等
   *  Player 侧触发；Game 实现 = makeLocalPlayerEmote（含联机转发/邻近 NPC 回应）） */
  playerEmote?(id: number): void;
  /** 骸骨头盔幻影生成（Projectile 964 NewProjectile——Player.SpawnHallucination
   *  :13627-13656 出参直传；Game 实现 = entities.add(InsanityShadowFriendly)） */
  spawnInsanityShadow?(p: import('./InsanityShadowFriendly').InsanitySpawnParams): void;
  /** 钛金屏障碎片 908 生成（Player.cs:6932-6935 ownedProjectileCounts[908]<7 →
   *  NewProjectile(908, 50dmg, 15kb)；Game 实现 = 计存活碎片+entities.add） */
  spawnTitaniumShard?(x: number, y: number): void;
  /** 强制雨滴（Rain.NewRainForced Rain.cs:134-171——眼球伞 5101 滴水用；
   *  Game 实现 = renderer.weatherFx.newRainForced） */
  spawnRainForced?(x: number, y: number, vx: number, vy: number): void;
  /** 拾取物品时在主角旁飘出物品名（picked = 本次入包数；prefix = 词缀——
   *  合并身份 = 词缀+本名，PopupText.NewText AffixName 语义） */
  showPickupLabel(itemKey: string, picked?: number, prefix?: number): void;
  /** 掉落系统补充上下文（灵魂/钥匙/风筝等条件）：Game 实现，缺省则这些条件按 false */
  dropContext?(): import('../drops/NpcDrops').DropExtras;
  /** 月事件上下文（南瓜月/霜月 wave-gate 掉落条件）：Game 实现，缺省按无事件（恒 false） */
  moonEventCtx?(): { kind: 1 | 2; wave: number } | null;
  /** WorldGen.Skyblock.noAltars（:3062/:3146-3167 读档 Census → 全图无 tile 26 恶魔
   *  祭坛才 true）：EyeOfCthulhuDefeatedAndNoAltarsInWorld 掉落条件数据源。Game 侧
   *  进图时一次全图普查缓存（会话期内静态——原版同语义）；缺省按 false */
  worldNoAltars?(): boolean;
  /** 环境判定（Game.scene，SceneMetrics 每 15t 以玩家为中心刷新；Boss 暴怒度/石巨人
   *  脱庙加成读 zoneJungle/zoneTemple——原版 Main.player[target].ZoneJungle/ZoneLihzhardTemple） */
  scene?: import('../world/SceneMetrics').SceneFlags;
  /** 原版 Dust 池直入（fx/VanillaDust.spawn——Dust.NewDust 签名对齐）。
   *  Gore 411-430 气泡族爆裂尘（Gore.cs:905-928，type 176-179）用；缺省静默丢弃。
   *  返回入池尘（调用侧可做原版 DelegateMethods 式的 NewDust 后置字段覆写——
   *  矿车轮火花 DelegateMethods.Minecart.Sparks 族即此模式）；池满/缺省 = null。
   *  perfect=true → Dust.NewDustPerfect 变体（Dust.cs:52-63）：完整 NewDust 链后
   *  position/velocity 完整覆写——0 宽盒抖动窗与烟雾族特例（242/75/169 的 vy 重掷
   *  + vx×0.3）被消解，定向速度原样入池；scale 走 NewDust 结果供调用侧后置赋值
   *  （ParticleOrchestrator 剑族尘锥/定向快尘一律走此通道） */
  spawnDust?(
    x: number, y: number, w: number, h: number, type: number,
    speedX?: number, speedY?: number, alpha?: number,
    color?: { r: number; g: number; b: number; a: number } | null, scale?: number,
    noGravity?: boolean, perfect?: boolean, prettySparkle?: boolean,
  ): import('../fx/VanillaDust').VDust | null;
  /** Dust.CloneDust（Dust.cs:260-288）：字段级复制回池（position/velocity/fadeIn/noGravity/
   *  scale/rotation/noLight/active/type/color/alpha/frame/shader/customData;noLightEmittance
   *  不复制=原版字段表语义）。Game 实现 = VanillaDust.clone 直通;池满/源尘失活 = null。
   *  首消费 = 661 光女 HitEffect CloneDust 回声（NPC.cs:82692-:82698/:82718-:82724——
   *  `if (numX != 6000)` 池满守卫=出尘成功才回声,消费侧 spawn null 短路同面）。
   *  LeashedCritter 帝皇蝶二段尘同源走 dust.clone 对象钩（Game.ts:26113）,非本钩 */
  cloneDust?(d: import('../fx/VanillaDust').VDust): import('../fx/VanillaDust').VDust | null;
  /** 鼠马车挖掘链的镐力门（MinecartDiggerHelper.HasPickPower :163-170 ←
   *  Player.HasEnoughPickPowerToHurtTile Player.cs:52964-52979）：背包最佳镐
   *  （GetBestPickaxe :39439-39450 前五十格最高 pick）对该格可伤。
   *  Game 实现 = bestPickaxePower + tileNoFail/门槛表；缺省 = true（放行近似） */
  pickPowerEnough?(x: number, y: number): boolean;
  /** 帕鲁钻地龟挖块（Player.PickTile :54398-54447 实体侧通道——AI_204_Digtoise
   *  Projectile.cs:39466-39505 消费）：tx/ty = 目标格，pickPower = 镐力
   *  （1123 = max(26, GetBestPickaxe.pick) :39476-39480 / 1098 恒 26），
   *  capDamage = dealDamageAsIfBaseNumberIs（1123=36 / 1098=26 :39475-39481）——
   *  每击伤害 = GetPickaxeDamage 后按 cap 比例钳制，hitTile 缓冲积累 ≥100 破坏。
   *  返回 true = 该格本次确有伤害（AI 的 num10 计数——有块但全不可伤 → 转离场态）。
   *  Game 实现 = petPickTile（与玩家/钻头坐骑共享 hitTile 单缓冲，原版同 Player.hitTile）；
   *  缺省 = 不挖（测试 mock 兼容） */
  petPickTile?(tx: number, ty: number, pickPower: number, capDamage: number): boolean;
  /** Player.GetBestPickaxe（:40413 前 0-49 格最高 pick 镐的 pick 值；无镐 = null）。
   *  1123 钻地龟镐力档（max(26, bestPickaxe.pick) :39476-39480）数据源 */
  bestPickaxePower?(): number | null;
  /** ★BJ433 帮工意图推断（PlayerIntentionGuesser.cs 全量移植 src/player/IntentionGuesser.ts
   *  ——Game 单例持有,tryMine/petPickTile 写侧 + fixedUpdate 每拍 Update）。
   *  AI_067_FreakingPirates_TryAssigningHelp（Projectile.cs:52208,1093/1112 捣蛋猫）
   *  消费；缺省 = 无帮工链（测试 mock 兼容） */
  intentionGuesser?: import('../player/IntentionGuesser').IntentionGuesser;
}
