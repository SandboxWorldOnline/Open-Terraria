// 音效：原版 wav 素材（public/sounds/）+ WebAudio 合成兜底。
// **按需加载 + 首播补播（2026-08-21）**：播放未命中缓存时后台 fetch+decode
// （bufferPromises 去重、failed 负缓存防 404 循环），★本次触发不再丢声——
// 旧实现 ensureBuffer 同步返回 null → playWavFile return false，首播静默/落合成，
// 解码完成后第二声起才命中真声（用户报"发射子弹第一声永远静默"根因）。
// 现 deferPlay 在解码完成后按原触发参数补播一次，playWavFile 返回 true 告知
// 调用方"有声可闻"（合成兜底/通用 hit 回退不叠加）；仅负缓存命中（加载失败过）
// 才返回 false 走合成。另在首次取得 AudioContext 时批量预热高频清单
// WARMUP_NAMES（枪族/挖掘/战斗/UI——Item_36/41 等此前不在世界载入预热面），
// 把补播窗提前到进世界前。定向预热仍用 preloadFiles（如 Boss 召唤前取咆哮声）。
// hit 敌人受击 / hurt 玩家受击 / pickup 拾取 / dig 挖掘 / place 放置 / drink 饮用 / chop 砍树 / splash 落水
// + killed 怪物死亡 / zombie 僵尸环境声 / roar Boss咆哮 / coin 拾币 / door_open door_close / tink 敲石 / shatter 玻璃破碎 / drown 溺水
import { options } from './Options';

export type SfxName =
  | 'hit' | 'hurt' | 'pickup' | 'dig' | 'place' | 'drink' | 'chop' | 'splash'
  | 'killed' | 'pkilled' | 'zombie' | 'roar' | 'coin' | 'door_open' | 'door_close' | 'tink' | 'shatter' | 'drown'
  | 'menuOpen' | 'menuClose' | 'menuTick'
  | 'menuAccept'   // SoundID.MenuAccept = CreateTrackable("menu_accept")（SoundID.cs:1068），
                   //   SecretSeed.Enable 播（WorldGen.cs:539）——世界创建页录入秘种子解锁音
  | 'chat'         // SoundID 24 = Chat（SoundID.cs:48）——UIWorldCreation 秘种子文本命中
                   //   特殊种子时 PlaySound(24)（UIWorldCreation.cs:833）
  | 'unlock'
  | 'bowShoot'   // 原版 SoundID.Item5（弓弦，Item.cs case 99 UseSound）
  | 'throw'      // 原版 SoundID.Item1（手里剑/投掷刀 UseSound）
  | 'explosion'  // 原版 SoundID.Item14（爆炸通用：手雷/炸弹/炸药/巨石,Projectile.cs 20+ 处）
  | 'explosionGrenade'  // 原版 SoundID.Item62（榴弹族闷爆：手雷 30/火箭一型 133/二型 136/三型 139，
                        //   Projectile.cs:74471-74475/:74539-74543——Kill 按弹型分支）
  | 'hailImpact'   // 原版 SoundID.Item89（1037/1049 落地爆 Kill：Projectile.cs:75285）
  | 'rocketJet' | 'starboardJet'  // 原版 SoundID.Item13/Item24（妖精翅 4/星璇悬浮板 45 喷射音）
  | 'beeSummon'  // 原版 SoundID.Item173（Abeemination 蜂后召唤音，Player.cs:43185——Boss 召唤音唯一非 Roar 例外）
  | 'thunder'   // 原版 SoundID 43（Thunder_0-5，NewLightning 的 thunderDelay 归零时播）
  | 'mech'       // 原版 SoundID 28（Mech_0：器件右键切换音，Player.cs:31762/31799/31803）
  | 'portalOrange' | 'portalBlue' // 原版 Item_115 / Item_114（传送门弹撞块落门音，Projectile.cs:16675-16683）
  | 'dd2Flameburst'  // DD2_FlameburstTowerShot（Sounds/Custom/dd2_flameburst_tower_shot_0-2，AI_131 :65533）
  | 'dd2Ballista'    // DD2_BallistaTowerShot（AI_134 :65674）
  | 'dd2Explosive'   // DD2_ExplosiveTrapExplode（AI_138 :66104）
  | 'dd2Zap'         // DD2_LightningAuraZap（AI_137 :65947）
  | 'whipCrack'   // 原版 Item_152（DefaultToWhip UseSound——鞭甩响，Item.cs:47448）
  | 'summon'      // 原版 Item_44（召唤杖通用 UseSound）
  | 'eowDig'      // EOWDiggin（CreateTrackable("eow_dig") SoundID.cs:1151——EoW 三段掘地专属,
                  //   AI_006 :52389；此前误用 Dig_0/1/2 近似,2026-08-18 对齐）
  // ---- 液体六配对专属轨（SoundID.cs:823-827 CreateTrackable("liquids_*",3,Ambient)，原 Sounds/Custom/）----
  | 'liquidWaterLava'   // 水岩浆（TileChangeType.LavaWater）
  | 'liquidHoneyWater'  // 水蜂蜜
  | 'liquidHoneyLava'   // 岩浆蜂蜜
  | 'shimmerSplash'     // 微光×3：原版即 PlaySound(19,…,4) = Splash_4（case 19 style 4 音量 ×0.75，FILE_CASE_VOL 统一乘）
  // ---- 雕像宝箱怪三轨（SoundID.cs:1105/1107/1109 CreateTrackable，Sounds/Custom/）----
  | 'statueMimicScare'  // 唤醒惊吓（AI_126 :43878，音量 0.8）
  | 'statueMimicJump'   // 跳跃（:43892/:43900，音量 0.3）
  | 'statueMimicLaugh'  // 玩家死亡嘲笑 ×3 变体（:43928，音量 0.8）
  // ---- 枪族 UseSound（Item.cs：其余枪械通用 Item_11，此前已在库内）----
  | 'gunShot'      // SoundID.Item11 枪械通用
  | 'gunShotgun'   // SoundID.Item36 霰弹枪族 534/964/3788/4703
  | 'gunHandgun'   // SoundID.Item41 手枪族 164/219/1255/1929/2269/2270
  | 'record'      // SoundID.Item166（八音盒录音完成，Player.cs:15054）
  | 'mirror'      // SoundID.Item6（魔镜族 UseSound：Magic/Ice Mirror/Cell Phone/Shellphone :42297 族）
  | 'item8'       // SoundID.Item8（TeleportEffect style 7 恶魔海螺落点音,Main.cs:13542;★SW-RB10a 补）
  | 'bombFuse'    // SoundID.BombFuse = CreateTrackable("fuse")（SoundID.cs:1153，引信嘶声循环 0.2 音量）
  | 'conch'       // SoundID.Item64（海螺族 UseSound：Magic/Demon Conch/Shellphone 海洋地狱款）
  | 'jimsDrone'   // SoundID.JimsDrone = CreateTrackable("Drone").WithVolume(0.1)（SoundID.cs:1060）
                  //   AI_195 四轴竞速无人机引擎循环轨（Projectile.cs:41706-41708,清偿刀 A）
  | 'rcCar'       // SoundID.RCCar = CreateTrackable("rccar").WithVolume(0.015)（:1062）
                  //   AI_205 墙上飞车引擎循环轨（Projectile.cs:38995-38997,清偿刀 A）
  | 'dd2PortalLoop'   // DD2_EtherianPortalIdleLoop（SoundID.cs:984 无 WithVolume→基量 1;
                      //   NPC.cs:41409/:41458 GetActiveSound 空 → PlayTrackedSound 重建的
                      //   常驻循环轨——startTrackedLoop 距离衰减通道,终清波接入）
  | 'dd2KoboldIgniteLoop' // DD2_KoboldIgniteLoop（AI_107 :63969/:63991 引信循环轨;
                          //   曾不在 WAV_MAP→startTrackedLookup 恒 null=静默,终清波补键）
  | 'dd2KoboldChargeLoop' // DD2_KoboldScreamChargeLoop（AI_107 冲锋嘶叫循环轨,同上）
  | 'manaCrystal' // SoundID.Item29（LegacySoundStyle(2,29)：Item.cs:2657 物品 109 魔力水晶 UseSound
                  //   + ParticleOrchestrator.Spawn_ShimmerTownNPC :1756 城镇 NPC 微光到位音）
  // ---- 天气环境音循环轨（SceneState.cs:235-297 暴风雪双轨；SoundType.Ambient）----
  | 'blizzardStrong'    // blizzard_strong_loop（SoundID.cs:821 BlizzardStrongLoop，WithVolume(0.5)）
  | 'blizzardInside'    // blizzard_inside_building_loop（:819 BlizzardInsideBuildingLoop）
  | 'sandstormWind';    // ★登记缺失：原版沙暴无专属 wav（Sandstorm 只有视觉 shader + 风场 BGM），
                        //   全量 852 wav 中无 sandstorm/wind 条目——素材出现前 playLoop 恒 null

/** 天气环境音循环轨名（Weather.update 状态机 ↔ Sfx 循环句柄的接口面） */
export type WeatherLoopName = 'blizzardStrong' | 'blizzardInside' | 'sandstormWind';

/** 循环轨基础音量（SoundID 定义侧的 WithVolume，SfxName 注释同源） */
export const LOOP_BASE_VOL: Record<WeatherLoopName, number> = {
  blizzardStrong: 0.5,    // SoundID.cs:821 WithVolume(0.5f)
  blizzardInside: 1,      // :819 无 WithVolume → 1.0
  sandstormWind: 1,       // 素材缺失，占位
};

/** 循环音句柄（SceneState.cs:235-297 暴风雪双轨的常驻轨管理面：
 *  原版 PlayTrackedSound 拿 SlotId 后每帧改 Volume，轨不拆；此处同构） */
export interface SfxLoop {
  /** 停止并释放节点（幂等） */
  stop(): void;
  /** 目标音量 0-1（setTargetAtTime 平滑逼近 ~0.2s，防切换爆音） */
  setVolume(v: number): void;
  /** 节点是否仍在发声（含缓冲解码完成后起振；pending 期为 false） */
  readonly playing: boolean;
  /** 终态（stop() 或缓冲加载失败）——调用方可丢弃重建；
   *  非 dead 且 !playing = 解码在途，勿重建（否则每帧泄漏 GainNode） */
  readonly dead: boolean;
}

// 逻辑名 → 原版 wav 文件（多文件随机选 + 音高扰动；导出供测试/预热侧消费）
export const WAV_MAP: Record<SfxName, string[]> = {
  hit: ['NPC_Hit_1', 'NPC_Hit_2', 'NPC_Hit_3', 'NPC_Hit_4', 'NPC_Hit_5'],
  hurt: ['Player_Hit_0', 'Player_Hit_1', 'Player_Hit_2'],
  killed: ['NPC_Killed_1', 'NPC_Killed_2', 'NPC_Killed_3'],
  pkilled: ['Player_Killed'],
  // case 14 默认变体组 Main.rand.Next(3)（LegacySoundPlayer.cs:816）；音量 ×0.4 见 FILE_CASE_VOL
  zombie: ['Zombie_0', 'Zombie_1', 'Zombie_2'],
  // roar = boss 吼(Roar_0)——原版 NPC.cs 16 处 PlaySound(15,x,y,0) 全显式 style0;
  // 蠕虫掘地(:52393)/毁灭者(:50473)是 PlaySound(15,x,y) 无 style(style 默认 1)=Roar_1,
  // 走 playSfxWav('Roar_1') 直文件,勿用本键(曾随机二选一→一半概率播成 boss 唤醒音,
  // 2026-08-18 用户报"地底蠕虫音全变 boss 咆哮"修正)
  roar: ['Roar_0'],
  eowDig: ['eow_dig'],   // EoW 掘地专属轨（单文件;AI_006 :52389）
  pickup: ['Grab'],
  dig: ['Dig_0', 'Dig_1', 'Dig_2'],
  chop: ['Grass'],
  tink: ['Tink_0', 'Tink_1', 'Tink_2'],   // case21 Next(3) 全 3 变体(:927-939)
  place: ['Dig_0', 'Dig_1', 'Dig_2'],     // PlaySound(0)=Dig 全 3 变体(WorldGen.cs 放块)
  shatter: ['Shatter'],
  coin: ['Coin_0', 'Coin_1', 'Coin_2', 'Coin_3', 'Coin_4'],   // case38 Next(5)(:1354);Coins.wav 是 type18 掉落叮当(case18)勿混
  door_open: ['Door_Opened'],
  door_close: ['Door_Closed'],
  splash: ['Splash_0', 'Splash_1', 'Splash_2', 'Splash_3', 'Splash_4', 'Splash_5'],
  drown: ['Drown'],
  bowShoot: ['Item_5'],
  // 菜单 UI（原版 id 10=Menu_Open / id 11=Menu_Close / id 12=Menu_Tick）
  menuOpen: ['Menu_Open'],
  menuClose: ['Menu_Close'],
  unlock: ['Unlock'],   // SoundID 22 Unlock（箱解锁 Chest.cs:402/:476;神庙钥匙开锁同号）
  menuTick: ['Menu_Tick'],
  // 秘种子解锁音（Sounds/Custom/menu_accept.xnb 提取拍平；SoundID.cs:1068 MenuAccept）
  menuAccept: ['menu_accept'],
  // 特殊种子命中提示音（legacy PlaySound(24)=Chat；SoundID.cs:48，UIWorldCreation.cs:833）
  chat: ['Chat'],
  throw: ['Item_1'],
  explosion: ['Item_14'],
  explosionGrenade: ['Item_62'],  // 榴弹族闷爆（Kill :74471-74475/:74539-74543 弹型分支）
  hailImpact: ['Item_89'],        // 1037/1049 落地爆（Kill :75285 SoundID.Item89）
  rocketJet: ['Item_13'],  // SoundID.Item13（妖精翅 4 飞行喷射音，WingFrame :29034）
  starboardJet: ['Item_24'], // SoundID.Item24（星璇悬浮板 45 喷射音，:29716）
  // 2026-08-13 修正：素材提取管线把 Sounds/Custom/ 拍平进 public/sounds/ 根目录，
  // 此前带 'Custom/' 前缀的 fetch 恒 404（failed 静默无声）——改用平铺名
  dd2Flameburst: ['dd2_flameburst_tower_shot_0', 'dd2_flameburst_tower_shot_1', 'dd2_flameburst_tower_shot_2'],
  dd2Ballista: ['dd2_ballista_tower_shot_0', 'dd2_ballista_tower_shot_1', 'dd2_ballista_tower_shot_2'],
  dd2Explosive: ['dd2_explosive_trap_explode_0', 'dd2_explosive_trap_explode_1', 'dd2_explosive_trap_explode_2'],
  dd2Zap: ['dd2_lightning_aura_zap_0', 'dd2_lightning_aura_zap_1', 'dd2_lightning_aura_zap_2', 'dd2_lightning_aura_zap_3'],
  whipCrack: ['Item_152'],
  summon: ['Item_44'],
  beeSummon: ['Item_173'],
  thunder: ['Thunder_0', 'Thunder_1', 'Thunder_2', 'Thunder_3', 'Thunder_4', 'Thunder_5'],
  mech: ['Mech_0'],
  portalOrange: ['Item_115'],   // form 0（ai[1]==0 → Item115，Projectile.cs:16675-16683）
  portalBlue: ['Item_114'],     // form 1
  // 液体六配对专属轨（各 3 变体随机；SoundID.cs:823-827）
  liquidWaterLava: ['liquids_water_lava_0', 'liquids_water_lava_1', 'liquids_water_lava_2'],
  liquidHoneyWater: ['liquids_honey_water_0', 'liquids_honey_water_1', 'liquids_honey_water_2'],
  liquidHoneyLava: ['liquids_honey_lava_0', 'liquids_honey_lava_1', 'liquids_honey_lava_2'],
  shimmerSplash: ['Splash_4'],  // PlaySound(19,…,4)：微光配对固定 style 4（LegacySoundPlayer.cs:885 音量 ×0.75）
  // 雕像宝箱怪（Sounds/Custom/ 提取拍平；SoundID.cs:1105/1107/1109）
  statueMimicScare: ['statuemimic_scare'],
  statueMimicJump: ['statuemimic_jump'],
  statueMimicLaugh: ['statuemimic_laugh_0', 'statuemimic_laugh_1', 'statuemimic_laugh_2'],
  // 枪族（Item.cs UseSound；弓 Item_5 见 bowShoot）
  gunShot: ['Item_11'],
  gunShotgun: ['Item_36'],
  gunHandgun: ['Item_41'],
  record: ['Item_166'],
  mirror: ['Item_6'],
  item8: ['Item_8'],   // ★SW-RB10a：TeleportEffect case 7（恶魔海螺/地狱款贝壳手机落点）
  bombFuse: ['Fuse'],   // Content/Sounds/Custom/fuse.xnb → Fuse.wav（自提取，1.42s 循环）
  conch: ['Item_64'],
  // ---- 帕鲁机件引擎循环轨（清偿刀 A 2026-09-29；Sounds/ 提取拍平,Drone/rccar 素材
  //   已在库——sfx-wiring-golden 经 vanilla-soundtracks JimsDrone/RCCar 轨别名覆盖）----
  jimsDrone: ['Drone'],   // SoundID.JimsDrone（WithVolume 0.1,SoundID.cs:1060）
  rcCar: ['rccar'],       // SoundID.RCCar（WithVolume 0.015,:1062）
  // ---- DD2 跟踪循环轨（Sounds/Custom 提取拍平；startTrackedLoop 距离衰减+声像通道）----
  dd2PortalLoop: ['dd2_etherian_portal_idle_loop'],
  dd2KoboldIgniteLoop: ['dd2_kobold_ignite_loop'],
  dd2KoboldChargeLoop: ['dd2_kobold_scream_charge_loop'],
  // Item bank cue 29（case 2 无专属音量修正——LegacySoundPlayer.cs:519-643，
  // 默认 ±0.06 音高抖动由 PITCH_CASE.Item_ 表达,R22 前的全局 0.92+rand×0.16≈±0.115 过抖已废）
  manaCrystal: ['Item_29'],
  // ---- 天气环境音循环（Sounds/Custom/ 提取拍平；SceneState.cs:235-297 双轨管理）----
  blizzardStrong: ['blizzard_strong_loop'],
  blizzardInside: ['blizzard_inside_building_loop'],
  sandstormWind: [],    // ★无素材（见 SfxName 注释）——playWav/playLoop 均安全短路
  // 以下无原版素材，走合成
  drink: ['Item_3'],  // SoundID.Item3(药水饮用/回忆药水起始音;Item_3.wav 在盘,合成兜底仅剩硬失败路径)
};

/** 高频预热清单（Sfx 首次取得 AudioContext 时经 preloadNames 批量 decode，
 *  不阻塞不发声）。按需加载体系下"清单外的首播"由 deferPlay 补播兜底（一个
 *  fetch+decode 往返的延迟），本预热把高频轨的补播窗提前到进世界前：
 *  - 枪族三件（Item_11/36/41）——世界载入预热面（Game.ts）只有 Item_11，
 *    霰弹/手枪族本局首射静默 = 用户报障直接缺口；
 *  - 菜单三件套——首手势即菜单点击，UISfx 与 Game.sfx 是两个实例，各自预热；
 *  - 战斗/挖掘/拾取/门/液体高频。全 98 个 WAV_MAP 文件均在盘（2026-08-21 核对），
 *    合计 PCM 约 10MB 量级，远小于单首 BGM。 */
export const WARMUP_NAMES: SfxName[] = [
  // UI（首手势即菜单点击；menuAccept/chat=秘种子录入两音,世界创建页即用）
  'menuOpen', 'menuClose', 'menuTick', 'unlock', 'menuAccept', 'chat',
  // 战斗/挖掘/拾取高频
  'hit', 'hurt', 'killed', 'pkilled', 'pickup', 'dig', 'place', 'chop', 'tink',
  'shatter', 'coin', 'splash', 'drown', 'zombie', 'roar',
  'door_open', 'door_close', 'drink', 'mech',
  // 枪/弓/投掷/爆炸/召唤/鞭（"发射子弹首声静默"主面）
  'gunShot', 'gunShotgun', 'gunHandgun', 'bowShoot', 'throw', 'explosion',
  'explosionGrenade', 'summon', 'whipCrack',
];

/** 原版专属音量修正表（LegacySoundPlayer.PlaySound 各 case 内对 num2 的修正系数，
 *  Terarria1456/Terraria.Audio/LegacySoundPlayer.cs）。
 *  键 = wav 文件名（含变体号）；playWavFile 单点统一乘——playWav（逻辑名）、
 *  playFiles（per-NPC HitSound/DeathSound）、playSfxFile/playUseSound（Item_N 直播）
 *  全路径自动生效。未登记 = 1.0（绝大多数 case 无专属修正，调用方传 1 即原版语义）。 */
export const FILE_CASE_VOL: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  // case 14 ZombieMoan（:792-824）：默认组恒 ×0.4（:818）
  m.Zombie_0 = 0.4; m.Zombie_1 = 0.4; m.Zombie_2 = 0.4;
  // case 3 NPCHit（:645-671）：style 20-54 ×0.5（:648）、55/56 ×0.5（:660）、57 ×0.6（:656）；1-19 无修正
  for (let s = 20; s <= 54; s++) m[`NPC_Hit_${s}`] = 0.5;
  m.NPC_Hit_55 = 0.5; m.NPC_Hit_56 = 0.5; m.NPC_Hit_57 = 0.6;
  // case 4 NPCKilled（:672-694）：style 23-57 ×0.5（:675）、61/62 ×0.6（:679/:683）、
  //   10 已在播则跳过（:688——肉山尖啸去重,NPC_Killed_10 入 SINGLE_INSTANCE）
  for (let s = 23; s <= 57; s++) m[`NPC_Killed_${s}`] = 0.5;
  m.NPC_Killed_61 = 0.6; m.NPC_Killed_62 = 0.6;
  // case 2 Item（:519-643）：styles 53 ×0.75/55 ×0.75×0.75（:555-561）、37 ×0.5（:567）、
  //   52 ×0.35（:571）、157 ×0.7/158 ×0.8/159 ×0.75（:573-578/:587）、156 ×0.6（:625）、
  //   26/35/47 ×0.75（:634-637）、116/123 ×0.5（:536/:529）、124/125 ×0.65（:533）、
  //   129 ×0.6（:525）、176 ×0.9（:521）
  const itemVol: [number, number][] = [
    [26, 0.75], [35, 0.75], [47, 0.75], [37, 0.5], [52, 0.35], [53, 0.75],
    [55, 0.5625], [116, 0.5], [123, 0.5], [124, 0.65], [125, 0.65], [129, 0.6],
    [156, 0.6], [157, 0.7], [158, 0.8], [159, 0.75], [176, 0.9],
    [210, 0.35],   // R4-37：GlacierFang_Charging（LegacySoundPlayer.cs:579 case 210 ×0.35）
  ];
  for (const [s, v] of itemVol) m[`Item_${s}`] = v;
  // ---- 现代音库单件（SoundID.cs CreateTrackable 的 WithVolume——style 内建档,
  //   调用方传 1 即原版语义）----
  m.sonar_potion = 0.65;   // SoundID.cs:1128 SonarPotion.WithVolume(0.65f)——咬钩提示音
  // case 19 Splash（:870-909）：styles 2/3 ×0.75（:876-879）、4/5 ×0.75（:880-883，微光/岩浆对）
  m.Splash_2 = 0.75; m.Splash_3 = 0.75; m.Splash_4 = 0.75; m.Splash_5 = 0.75;
  // case 29 Zombie 怪物声（:1007-1049）：24-87 ×0.5、88-91 ×0.7、92 ×0.5、93-99 ×0.4、
  //   100/101 ×0.25、102/103 ×0.4、104 ×0.55
  for (let s = 24; s <= 87; s++) m[`Zombie_${s}`] = 0.5;
  // ★Roar_1 无文件级音量档:case15 style1(蠕虫掘地 :52393/:50473)num18=1 满响;
  //   0.25 是 style4(沙鲨游弋 :42661)调用点专属,由调用方显式传(bossAI_dd2)——
  //   曾按文件名统一乘 → 蠕虫掘地被压 1/4,2026-08-18 修正
  m.Zombie_109 = 0.3;  // case45 Dolphin(:1063 ×0.3)——海豚跃出声
  // ★Zombie_7 无文件级档（2026-08-26 审计修正）：同文件两消费面音量不同——
  //   case14 style542 沙鲨扑咬 ×0.4 vs case29 style7 吸血鬼闲话 ×1.0（:1008-1052
  //   style<24 无乘区）。文件级表无法双值,×0.4 移交沙鲨调用点显式传
  //   （bossAI_dd2 出沙扑咬），闲话路径回归原版满响。
  // case14 style489/586 分支（:808-816,Next(21,24)=Zombie_21/22/23）两分支都 ×0.4
  //   （:803/:813）——血僵尸 489/僵尸鱼人 586 闲话池（曾缺档在播偏大 ~2.5×）
  m.Zombie_21 = 0.4; m.Zombie_22 = 0.4; m.Zombie_23 = 0.4;
  for (let s = 88; s <= 91; s++) m[`Zombie_${s}`] = 0.7;
  m.Zombie_92 = 0.5;
  for (let s = 93; s <= 99; s++) m[`Zombie_${s}`] = 0.4;
  m.Zombie_100 = 0.25; m.Zombie_101 = 0.25;
  m.Zombie_102 = 0.4; m.Zombie_103 = 0.4; m.Zombie_104 = 0.55;
  // case 26 Mummy（:968-976）Zombie_3/4 ×0.9；case 30 Duck（:1105-1126）Zombie_10-12 ×0.75
  m.Zombie_3 = 0.9; m.Zombie_4 = 0.9;
  m.Zombie_10 = 0.75; m.Zombie_11 = 0.75; m.Zombie_12 = 0.75;
  // ---- R22 小动物/海鸟族十组档（2026-08-24 对拍 LegacySoundPlayer 各 case,1457 同行号）----
  //   此前整族缺档 → 小动物环境声响 3-7 倍（红队 R22 定罪高项）
  m.Zombie_13 = 0.35;                                        // case31 Frog(:1128-1134)
  for (let s = 14; s <= 19; s++) m[`Zombie_${s}`] = 0.15;    // case32 Bird(:1136-1148)
  m.Zombie_15 = 0.2;                                         // case33 鼠(:1203-1213)——覆盖上行的 15
  for (let s = 106; s <= 108; s++) m[`Zombie_${s}`] = 0.2;   // case44 Seagull(:1054-1061)
  for (let s = 110; s <= 114; s++) m[`Zombie_${s}`] = 0.9;   // case46 Owl(:1074-1092)
  for (let s = 115; s <= 117; s++) m[`Zombie_${s}`] = 0.5;   // case65(:1400-1411)
  for (let s = 118; s <= 120; s++) m[`Zombie_${s}`] = 0.3;   // case67 Cockatiel(:1147-1158)
  for (let s = 121; s <= 123; s++) m[`Zombie_${s}`] = 0.45;  // case66(:1183-1198)
  for (let s = 126; s <= 128; s++) m[`Zombie_${s}`] = 0.22;  // case68 Macaw(:1159-1170)
  for (let s = 129; s <= 130; s++) m[`Zombie_${s}`] = 0.2;   // case69 Toucan(:1171-1182)
  return m;
})();

/** 原版逐类型音高抖动表（LegacySoundPlayer.PlaySound 各 case 的 Pitch 随机式
 *  + 现代 trackable 的 WithPitchVariance;R22 修复:旧实现全局一档
 *  playbackRate=0.92+rand×0.16≈±0.115,与原版逐类型档系统性偏差——门 ±0.20/
 *  草 ±0.30/Item ±0.06/鸟 -0.70..+0.25/受击咆哮菜单等不抖）。
 *  键 = wav 文件名;值 = [lo,hi]（单位 0.01,含端点,XNA Next(lo,hi+1)*k 等价）。
 *  ★双语义（2026-08-26 F1 全表对源审计,Terarria1458）：
 *  · LSP 显式式档 = case 内 Next(a,b)×k 直录 [a,b]×k——不经 GetRandomPitch,原样精确;
 *  · WithPitchVariance(v) 档 = **半幅 ±v/2**——GetRandomPitch=NextFloat()×v−v×0.5
 *    （Terraria.Audio/SoundStyle.cs:42）;trackable 走 type42(LSP :1383-1388 无自身
 *    Pitch)+尾部 += GetRandomPitch(ActiveSound.cs:83/:94),故终值 ∈ ±PV/2 非全幅,
 *    表内登记 [-v×50, v×50]（曾按全幅 ±v×100 登记系统性宽 2 倍,F1 已修）。
 *  未登记文件 = 不抖（原版无 Pitch 赋值的 case 与 CreateTrackable 默认 PitchVariance=0 同语义;
 *  player_hit_* 宠物语音按 SoundID.cs WithPitchVariance(0.4) 登记半幅 ±20）。
 *  显式 pitch 参数（乐器 musicPitch 直传,Player.cs:45928）仍优先于本表。 */
export const PITCH_CASE: Record<string, [number, number] | null> = (() => {
  const m: Record<string, [number, number] | null> = {};
  const put = (files: string[], v: [number, number] | null) => { for (const f of files) m[f] = v; };
  const rng = (prefix: string, lo: number, hi: number): string[] =>
    Array.from({ length: hi - lo + 1 }, (_, k) => `${prefix}${lo + k}`);
  // —— 无音高族（对应 case 无 Pitch 赋值）——
  put(['Player_Hit_0', 'Player_Hit_1', 'Player_Hit_2', 'Player_Killed',   // case1(:506)/case5(:699)
    'Menu_Open', 'Menu_Close', 'Menu_Tick',                               // case10/11/12(:753/:763/:773)
    'Shatter',                                                            // case13(:786)
    'Roar_0', 'Roar_1',                                                   // case15(:829-845)
    'Coins',                                                              // case18(:868)
    'Tink_0', 'Tink_1', 'Tink_2',                                         // case21(:927-939)
    'Unlock',                                                             // case22(:940-949)
    'Drown'], null);                                                      // case23(:950)
  put(['Zombie_0', 'Zombie_1', 'Zombie_2',                                // case14 ZombieMoan(:796-827)
    'Zombie_7', 'Zombie_21', 'Zombie_22', 'Zombie_23'], null);
  put(['Zombie_6', 'Zombie_8'], [-10, 10]);   // case29 style6/8 弗兰肯/面怪闲话(:1051 ±0.10;
                                              //   Zombie_7 保持 null=case14-542 无抖动与 case29 有抖动同文件冲突,取沙鲨侧)
  put(['Zombie_115', 'Zombie_116', 'Zombie_117'], null);                  // case65(:1389-1405 无 Pitch)
  put(['Female_Hit_0', 'Female_Hit_1', 'Female_Hit_2'], null);            // case20(:914-926)
  // —— ±0.10 档 Next(-10,11)×0.01 ——
  put(rng('Dig_', 0, 2), [-10, 10]);              // case0(:453)
  put(rng('NPC_Hit_', 1, 58), [-10, 10]);         // case3(:673)
  put(rng('NPC_Killed_', 1, 68), [-10, 10]);      // case4(:696)
  put(rng('Thunder_', 0, 5), [-10, 10]);          // case43(:479)
  put(['Grab',                                    // case7(:728)
    'Zombie_3', 'Zombie_4',                       // case26 Mummy(:978)
    'Mech_0',                                     // case28(:1008)
    'Zombie_109'], [-10, 10]);                    // case45 Dolphin(:1071)
  put(rng('Zombie_', 24, 104), [-10, 10]);        // case29 怪物语音库(:1051)
  put(rng('Zombie_', 110, 114), [-10, 10]);       // case46 Owl(:1091)
  put(['Splash_0', 'Splash_1', 'Splash_2', 'Splash_3'], [-10, 10]);  // case19 style0-3(:891)
  put(['Splash_4', 'Splash_5'], [-20, 0]);        // case19 style4/5 微光对(:887 低音高)
  put(['Grass'], [-30, 30]);                      // case6 chop(:717)
  put(['Door_Opened', 'Door_Closed'], [-20, 20]); // case8/9(:739/:750)
  put(rng('Coin_', 0, 4), [-8, 8]);               // case38 拾币(:1354 ±0.08)
  // —— 小动物/海鸟族（R22 随映射修正一并接入）——
  put(rng('Zombie_', 106, 108), [-70, 0]);        // case44 Seagull(:1059 -0.70..0)
  put(['Zombie_10', 'Zombie_11'], [-70, 0]);      // case30 Duck 常规(:1120)
  put(['Zombie_12'], [-40, 20]);                  // case30 Duck 稀有 12(:1124)
  put(['Zombie_13'], [-40, 20]);                  // case31 Frog(:1133)
  put(rng('Zombie_', 14, 19), [-70, 25]);         // case32 Bird(:1144 -0.70..+0.25)
  put(['Zombie_15'], [-10, 30]);                  // case33 鼠(:1212 -0.10..+0.30)
  put([...rng('Zombie_', 118, 120), ...rng('Zombie_', 126, 128), ...rng('Zombie_', 129, 130)],
    [-5, 5]);                                     // case67/68/69 鹦鹉族(:1156/:1168/:1180 ±0.05)
  put(['Zombie_121', 'Zombie_122', 'Zombie_123'], [-15, 15]);  // case66(:1200)
  // —— Item 音库：case2 默认 ±0.06（:635）;特例逐条 ——
  put(rng('Item_', 1, 211), [-6, 6]);
  m.Item_53 = [-40, -22];    // :616 Next(-20,-11)×0.02
  m.Item_55 = [22, 40];      // :619 反相档
  m.Item_132 = [-2, 2];      // :622 ×0.001
  m.Item_153 = [-15, 15];    // :625 ×0.003
  m.Item_156 = [-10, 10];    // :628 ×0.002
  m.Item_169 = [-86, -74];   // :643-645 默认档后 Pitch -= 0.8
  m.Item_26 = null; m.Item_47 = null;   // :638-642 Pitch=Main.musicPitch(乐器直传不随机)
  // Item_35 双语义:乐器(铃507,显式 musicPitch 直传跳本表,Game.ts:9629)=null 语义;
  // 但 BellHurt/BalloonHurt 族=WithPitchVariance(0.4f)(SoundID.cs:1140)→半幅 ±0.20
  // (2026-08-26 审计补)。消费面核验:铃走显式 pitch 跳过本表,受击/宠物侧无显式=吃档 ✓
  m.Item_35 = [-20, 20];
  // 鼓槌十档(LegacySoundPlayer.cs:1237-1248 case53-62→Item_139..148):数字型支无 Pitch
  // 赋值(仅 ×0.7 音量)——2026-08-25 音频对账收口,勿吃 case2 默认 ±0.06 抖动
  for (let d = 139; d <= 148; d++) m[`Item_${d}`] = null;
  // —— 宠物史莱姆受击语音（SoundID.cs 各 Hurt 全链 WithPitchVariance(0.4f)→半幅 ±0.20;
  //  vanillaNpcAmbience 表注同源。逐条行号:chicken :1142/chicken_rare :1144/frog :1146/
  //  goat :1148/retro :1150/cat :1154/dog :1156/turkey :1158/goblin :1160/crow :1162/
  //  balloon :1164(BalloonDeath :1166 同文件)/undead :1168/vampire :1170/fairy :1172）——
  put(['player_hit_balloon', 'player_hit_cat', 'player_hit_chicken', 'player_hit_chicken_rare',
    'player_hit_crow', 'player_hit_dog', 'player_hit_fairy', 'player_hit_frog',
    'player_hit_goat', 'player_hit_goblin', 'player_hit_retro', 'player_hit_turkey',
    'player_hit_undead', 'player_hit_vampire'], [-20, 20]);
  // —— F1 审计补档（WithPitchVariance 半幅族,实播但此前缺档;SoundID.cs 定源）——
  // eow_dig PV=0.02f(:1176)→±0.01 / statuemimic 三轨 PV=0.1f(:1130/:1132/:1134)→±0.05 /
  // trash_item PV=0.25f(:1124)→±0.125 / lucyaxe_talk PV=0.1f(:1028)→±0.05
  put(['eow_dig'], [-1, 1]);
  put(['statuemimic_scare', 'statuemimic_jump', 'statuemimic_laugh_0', 'statuemimic_laugh_1',
    'statuemimic_laugh_2', 'lucyaxe_talk_0', 'lucyaxe_talk_1', 'lucyaxe_talk_2',
    'lucyaxe_talk_3', 'lucyaxe_talk_4'], [-5, 5]);
  put(['trash_item_0', 'trash_item_1'], [-12.5, 12.5]);
  // —— 系统单件接线批补档——
  //  ★双语义（F1 2026-08-26）:WithPitchVariance(v) 档=±v/2 半幅（GetRandomPitch=
  //  NextFloat()×v−v/2,SoundStyle.cs:42;trackable type42 无自身 Pitch+尾部 += ,
  //  LSP :1383-1388/ActiveSound.cs:83）;LSP 显式 case 式=Next(a,b)×0.01 原样直录。
  m.Double_Jump = [-10, 10];   // LSP.cs case16(:846) Pitch=Next(-10,11)×0.01(:854) 显式式,保持全区间（多段跳族）
  m.best_reforge = [-5, 5];    // SoundID.cs:1122 BestReforge.WithPitchVariance(0.1f)→半幅 ±0.05（曾误 ±0.10）
  m.sonar_potion = [-1.5, 1.5];  // SoundID.cs:1128 SonarPotion.WithPitchVariance(0.03f)→半幅 ±0.015（连续均匀的 3 点离散近似）
  // —— 玩家语音批（voiceVariant/语音饰品子系统,PlayerVoice.ts 消费）——
  m.player_hit_default = [-10, 10];   // SoundID.cs:1138 DefaultPlayerHurt.WithPitchVariance(0.2f)→半幅 ±0.10（曾误 ±0.20）
  m.player_death_retro = [-20, 20];   // SoundID.cs:1152 RetroDeath.WithPitchVariance(0.4f)→半幅 ±0.20（曾误 ±0.40）
  return m;
})();

/** PITCH_CASE 单点消费：返回该文件的播放速率倍率（2^pitch）。
 *  显式 pitch 直传跳过;表项 null → 恒 1（不抖）;缺省 → 恒 1（未登记=原版无抖动） */
export function pitchRateFor(file: string, explicitPitch?: number): number {
  if (explicitPitch != null) return 2 ** explicitPitch;
  const t = PITCH_CASE[file];
  if (!t) return 1;
  const roll = t[0] + Math.floor(Math.random() * (t[1] - t[0] + 1));
  return 2 ** (roll / 100);
}

// ---------------------------------------------------------------------------
// Ambient 环境音轨（独立音量轨）
// ---------------------------------------------------------------------------
// 原版双通道（互斥替换，非叠加）：
//  ① Legacy 路径：DoesSoundScaleWithAmbientVolume（LegacySoundPlayer.cs:1443-1461）
//     的 14 个 SoundID 走 Main.ambientVolume（:420-423 num2 *= ambientVolume），
//     其余走 Main.soundVolume（:427）；
//  ② 现代路径：CreateTrackable(..., SoundType.Ambient)（SoundID.cs:819-827）经
//     ActiveSound.DetermineIntendedVolume（ActiveSound.cs:150-153）按
//     SoundType.Ambient → ambientVolume。
// 成员 → wav 文件全集（LegacySoundPlayer 各 case 的 bank 索引）：
//   30 Duck→Zombie_10-12（:1101-1122）/ 31 Frog→Zombie_13（:1124-1134）/
//   32 Bird→Zombie_14（:1136-1148）/ 33 Critter→Zombie_15（:1199-1211）/
//   34 Waterfall→Liquid_0（:1248-1278 SoundLiquid[0] 跟踪循环）/
//   35 Lavafall→Liquid_1（:1280-1310）/ 39 Drip→Drip_0-2（:1354-1360）/
//   43 Thunder→Thunder_0-5（:457-477）/ 44 Seagull→Zombie_106-108（:1050-1057）/
//   45 Dolphin→Zombie_109（:1058-1068）/ 46 Owl→Zombie_110-114（:1070-1090）/
//   67 Cockatiel→Zombie_118-120（:1143-1154）/ 68 Macaw→Zombie_126-128（:1155-1166）/
//   69 Toucan→Zombie_129-130（:1167-1177）
//   + SoundType.Ambient trackable：blizzard 双轨 + liquids_* 六配对（SoundID.cs:819-827）
export const AMBIENT_FILES: ReadonlySet<string> = new Set([
  // SoundID 30/31/32/33（Duck/Frog/Bird/Critter，Zombie 音库）
  'Zombie_10', 'Zombie_11', 'Zombie_12', 'Zombie_13', 'Zombie_14', 'Zombie_15',
  // SoundID 34/35（Waterfall/Lavafall 跟踪循环）
  'Liquid_0', 'Liquid_1',
  // SoundID 39（Drip）
  'Drip_0', 'Drip_1', 'Drip_2',
  // SoundID 43（Thunder）
  'Thunder_0', 'Thunder_1', 'Thunder_2', 'Thunder_3', 'Thunder_4', 'Thunder_5',
  // SoundID 44/45/46（Seagull/Dolphin/Owl）
  'Zombie_106', 'Zombie_107', 'Zombie_108', 'Zombie_109',
  'Zombie_110', 'Zombie_111', 'Zombie_112', 'Zombie_113', 'Zombie_114',
  // SoundID 67/68/69（Cockatiel/Macaw/Toucan）
  'Zombie_118', 'Zombie_119', 'Zombie_120', 'Zombie_126', 'Zombie_127', 'Zombie_128',
  'Zombie_129', 'Zombie_130',
  // SoundType.Ambient trackable（SoundID.cs:819-827）
  'blizzard_strong_loop', 'blizzard_inside_building_loop',
  'liquids_water_lava_0', 'liquids_water_lava_1', 'liquids_water_lava_2',
  'liquids_honey_water_0', 'liquids_honey_water_1', 'liquids_honey_water_2',
  'liquids_honey_lava_0', 'liquids_honey_lava_1', 'liquids_honey_lava_2',
]);

/** 音轨分派（LegacySoundPlayer.cs:420-429 的 if/else 同构）：
 *  ambient 成员 → ambientVol（替换 master）；其余 → masterVol。
 *  播放链单点消费（playWavFile / startLoopFile / setRain），测试可直断言 */
export function trackVolumeFor(file: string, ambientVol: number, masterVol: number): number {
  return AMBIENT_FILES.has(file) ? ambientVol : masterVol;
}

/** ★BJ74（2026-09-14 用户报「蘑菇群系 BGM 一轮后不 loop、变嗡嗡声」取证定谳）：
 *  Chromium AudioBufferSourceNode 循环回绕缺陷——loop=true 且循环终点=缓冲区
 *  绝对末帧时，特定总帧数的 buffer 在首轮回绕后渲染器冻结为「单渲染量子
 *  （128 帧）重复块」：音乐停、余音是恒定低鸣（用户口中的"嗡嗡声"），且
 *  **onended 不触发**（09-07 为"播完一轮停止"加的 ended 哨兵因此恒抓不到；
 *  行为日志 bgm 环零事件=无 sel/stop/ended 亦为佐证——图无迁移，声自己变质）。
 *  本机 Chrome 152.0.7977.84 实测矩阵（tools 外 /tmp/bj74-www 探针,Music_29.mp3
 *  解码长 3665419 帧 @48kHz）：
 *  · 全长循环（原实现）→ 76.4s 后冻结恒定 -51.7dB/zc=32/rep=128,两轮不愈;
 *  · 尾部补零对齐 128（3665472 帧,循环仍跨绝对末帧）→ 冻结为静默同病;
 *  · 循环终点内收（trim 至 3665408 / 或不拷贝仅设 loopEnd=3665408/48000）→
 *    两轮+ 全程真音乐,零冻结。合成正弦扫频同长度判别：仅 3665419 帧中毒,
 *    3665418/3665420 均活——与内容无关、帧数触发（Chromium 回绕算术缺陷）。
 *  修 = 循环终点恒内收一个量子尾（rem==0 收 128 帧、否则收 rem 帧,≤128 帧
 *  ≈2.7ms;曲尾本身是原版淡出,不可闻）——循环永不触碰缓冲区绝对末帧。
 *  原版锚（★RB18 翻案定谳 2026-09-14,更正本段;缺陷论/变体矩阵/接线说明不变）：
 *  Wave Bank.xwb 104/104 流 loopStart 恒 0 且 loopEnd==波全长=整波循环（xwb 逐流
 *  解析,不存在"尾部不播"域）;mp3 提取即整波（xwb-extract vgmstream 带 -i）,解码
 *  实长 3665419@48k = 3367680 帧@44101 换算链保时长落点（±1 帧舍入）→整缓冲循环
 *  =原版语义。BJ74 曾记「全长 162.7s/尾 86s 原版永不播」系 vgmstream 无 -i 时
 *  「loop×2+fade10s」预估播报值误读,非 xwb 事实。本内收一量子 = Chromium 回绕
 *  缺陷逼出的对原版刻意偏差（原版 XAudio2 循环直达末帧无此缺陷）,非「与原版
 *  loopEnd 等价备案」——与原版边界差 ≈0.23ms = 内收 11 帧本身+换算链舍入伪影
 *  （旧记「差≤7 帧」系按 44100 误率折算的伪值）。
 *  消费面：本仓全部 4 处 loop=true（Audio.track / Sfx.stepCue /
 *  Sfx.startTrackedLoop / Sfx.startLoopFile）统一走本函数,禁裸 `loop = true`
 *  （守卫 tests/bgm-loop-end-guard.test.ts 结构断言+变异证红）。 */
export function applyLoopBounds(src: AudioBufferSourceNode, buf: AudioBuffer): void {
  src.loop = true;
  const rem = buf.length % 128;
  if (buf.length > 128) {
    const end = buf.length - (rem === 0 ? 128 : rem);
    src.loopStart = 0;
    src.loopEnd = end / buf.sampleRate;
  }
}

// ---- 环境音 cue 斜坡状态机（LegacyAudioSystem.cs:219-274 1:1；风 cue45/雨 cue28 共用）----

/** Main.musicFade[i] + AudioTrack.IsPlaying 等价态 */
export interface AmbientCueState { fade: number; playing: boolean; }

/** 环境 cue 载体层（XACT AudioTrack 等价物）：增益面 + 解码缓冲 + 源节点 + 斜坡态。
 *  src 非空 ⇔ cue 在播（Reuse+Play 建新源 / Stop 停拆）——真起停语义非静音常驻 */
export interface CueLayer {
  gain: GainNode | null;
  buf: AudioBuffer | null;
  loading: boolean;
  src: AudioBufferSourceNode | null;
  cue: AmbientCueState;
}

/**
 * 单步推进环境 cue（每 tick 调用，60Hz）——UpdateAmbientCueState(:236-250) /
 * UpdateAmbientCueTowardStopping(:253-273) 逐分支同构：
 *  门开：systemVolume==0 → Immediate 停但 fade 冻结(:229-234)；!playing 按旧 fade
 *        起播(不递增,:236-241)；否则 fade +0.005 钳 1(:243-248)。
 *  门关：!playing → fade 清零(:255-258)；否则 fade −0.005，≤0 即停(:260-270)。
 * 返回本帧 SetVariable 音量 = fade × ambientVolume × level；null = 本帧不动音量
 * （未播放）。level 为 case 公式值 num7/num11（不含 ambient）。
 */
export function stepAmbientCue(
  st: AmbientCueState, level: number, ambient: number, gate: boolean,
): number | null {
  const sys = Math.max(0, Math.min(1, level)) * ambient;   // systemVolume = ambientVolume × num7
  if (gate) {
    if (sys === 0) {
      // :229-234 仅在播才 Stop(Immediate)；未播=原版整支 return 什么都不动（含音量）
      const was = st.playing;
      st.playing = false;
      return was ? 0 : null;
    }
    if (!st.playing) st.playing = true;                    // Reuse+Play，旧 fade 音量起播
    else st.fade = Math.min(1, st.fade + 0.005);           // musicFade 斜坡
  } else {
    if (!st.playing) {
      st.fade = 0;                                         // TowardStopping !IsPlaying 清零
      return null;
    }
    st.fade = Math.max(0, st.fade - 0.005);
    if (st.fade <= 0) {
      st.playing = false;                                  // Stop(Immediate)
      return 0;
    }
  }
  return st.fade * sys;
}

/** 声像接线单点：g → StereoPanner(pan) → destination（不支持时直连=中心）。
 *  pan ∈ [-1,1]（panOf 已钳）;恒过 panner 节点避免"后补 panner 双路出声" */
function connectPan(ctx: AudioContext, g: GainNode, pan: number): void {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(ctx.destination);
  } else {
    g.connect(ctx.destination);
  }
}

// ---------------------------------------------------------------------------
// SoundPlayOverrides 对账（Terraria.Audio/SoundPlayOverrides.cs 全文 + 全调用点，
// 2026-08-20 审计核销）。★结论：原版**没有** SoundID→别的音效/音调的替换表——
// 结构体仅一个字段 `float? Volume`，是 PlayTrackedSound/PlayTrackedLoopedSound 的
// 按次音量覆写参数（SoundEngine.cs:121/:137 → SoundPlayer.cs:11/:28，>10000px
// 屏心粗筛丢弃 → ActiveSound 构造：Volume=1f → UseOverrides(ActiveSound.cs:36-42
// 有值即覆盖) → 首播 Sound.Volume = DetermineIntendedVolume(ActiveSound.cs:138-161)
// = clamp( 距离衰减(1−d/2500，非 global) × Style.Volume × Volume覆写 × 音轨
// (sound|ambient|music), 0, 1 )。覆写挂在 ActiveSound 实例上，SoundEngine.Update
// （SoundPlayer.cs:101-115）每帧重算——外部逐帧改 activeSound.Volume/Position
// 持续生效。
// 调用点全表（1456 全量 grep 恰好 1 条，即"覆写表"全集）：
//   Player.cs:28111-28114 吸血鬼种子阳光炽灼嘶声环 —— style=SoundID.VampireSizzle
//   （CreateTrackable("sizzle").WithVolume(1f)，SoundID.cs:1039，默认
//   SoundType.Sound → soundVolume=master）、position=玩家 Center、
//   loopingCondition=VampireSizzleTracker.IsActiveAndInGame（!gameMenu &&
//   vampireSeed && sunScorchCounter>0）、Volume 覆写=GetLerpValue(0,120,
//   sunScorchCounter,true)；此后每帧 activeSound.Volume=lerp / Position=Center
//   （:28117-28119）。一次性 PlayTrackedSound 路径全游戏零 override 调用方。
// 本仓接线（覆写即查表落地）：Player.updateSunScorchValues → GameHooks.
// startLoopSfx('sizzle', lerp, 1) → playLoopFile(vol=lerp[Volume 覆写],
// base=1[Style.Volume]) → startLoopFile 目标音量 = min(1, vol×base×
// trackVolumeFor(master))——乘区序与 DetermineIntendedVolume 逐项一致；
// 循环条件=counter 归零拆轨 ≈ loopingCondition。断言见 tests/sound-overrides.test.ts。
// 遗留（不 bind，登记）：非 global 轨的距离衰减/Pan 在本仓循环轨未建模——sizzle
// 对本机玩家恒 d≈0（相机跟人），仅"吸血鬼种子+联机存活态观战他人"边缘态有差。
// ---------------------------------------------------------------------------

// ---- 资源包音效覆盖（M13）----
// 包内 Sounds/<X>（wav/mp3/ogg）→ 键 'X'（sounds/<X>.wav 的 file 部分）。
// 优先级高于基础源；多包同键由 ResourcePackManager 按优先级序预合并后整表下发。
// 替换/清空时须驱逐各实例已解码缓冲与失败负缓存——否则已播过的声音钉死旧源。
const packSoundOverrides = new Map<string, Uint8Array>();
const sfxInstances = new Set<Sfx>();

/** 全量下发资源包音效覆盖（合并终态）。affected = 新旧键并集驱逐缓存。 */
export function applySfxPackOverrides(sounds: ReadonlyMap<string, Uint8Array>): void {
  const affected = new Set([...packSoundOverrides.keys(), ...sounds.keys()]);
  packSoundOverrides.clear();
  for (const [k, v] of sounds) packSoundOverrides.set(k, v);
  for (const inst of sfxInstances) inst.evictSoundCache(affected);
}

/** 测试/调试探针：当前覆盖表只读视图 */
export function sfxPackOverrideKeys(): string[] { return [...packSoundOverrides.keys()]; }

/** 调试探针:覆盖表逐键头 4 字节 + 长度(XNB='XNBx' vs WAV='RIFF'——区分解码与否) */
export function sfxPackOverrideProbe(): Array<{ k: string; len: number; head: string }> {
  return [...packSoundOverrides.entries()].map(([k, v]) => ({
    k, len: v.length, head: [...v.subarray(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join(' ') + `'${String.fromCharCode(...v.subarray(0, Math.min(4, v.length)))}'`,
  }));
}

// ---- 资源包音乐覆盖（★SW-FX16 2026-09-10 原版锚定补缺）----
// 原版资源包可替换音乐轨 = LegacyAudioSystem.LoadFromSources(:34-54) 按
// "Music/<曲名>" 资产路径经 FindReplacementTrack(:84-124) 取 .ogg/.wav/.mp3
// 替换（音效 .xnb 走 Sounds/ 内容源面——本仓对应 packSoundOverrides）。仓库 BGM
// 载体 = audios/music/Music_<id>.mp3（Audio.buffer），风/雨环境 cue =
// Music_45/Music_28（Sfx.loadCueBuffer）——两路都挂本表。键 = 'Music_<id>' 茎名。
// 表放 Sfx（低层模块,Audio 单向 import 防环）；AudioSystem 解码缓存驱逐经
// setMusicOverrideListener 回调（Audio 模块装配时登记,见 core/Audio.ts）。
// ★适配登记：①原版换曲即停旧轨重载（LegacyAudioSystem.cs:50-54 Stop+换轨）,
//   本仓在播轨继续到下次切曲才吃到新源（Web 便利档,不重启音乐状态机）；
//   ②Safari decodeAudioData 不解 ogg——包内 ogg 音乐在 Safari 解码失败=该曲
//   负缓存静默（音效面同风险已登记）,面向 Web 的包建议 mp3/wav。
const packMusicOverrides = new Map<string, Uint8Array>();
let musicOverridesListener: ((affected: string[]) => void) | null = null;

/** 登记音乐覆盖变更监听（Audio 模块装载时调用,驱逐其解码缓存）。返回旧监听。 */
export function setMusicOverrideListener(l: ((affected: string[]) => void) | null): ((affected: string[]) => void) | null {
  const prev = musicOverridesListener;
  musicOverridesListener = l;
  return prev;
}

/** 全量下发资源包音乐覆盖（合并终态）。返回受影响键（新旧并集,供驱逐）。 */
export function applyMusicPackOverrides(music: ReadonlyMap<string, Uint8Array>): string[] {
  const affected = new Set([...packMusicOverrides.keys(), ...music.keys()]);
  packMusicOverrides.clear();
  for (const [k, v] of music) packMusicOverrides.set(k, v);
  musicOverridesListener?.([...affected]);
  return [...affected];
}

/** 取一条音乐覆盖字节（Audio.buffer / Sfx.loadCueBuffer 消费）。 */
export function musicPackOverride(stem: string): Uint8Array | undefined {
  return packMusicOverrides.get(stem);
}

/** 测试/调试探针：当前音乐覆盖键 */
export function musicPackOverrideKeys(): string[] { return [...packMusicOverrides.keys()]; }

export class Sfx {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  /** B6:mod 音频注入口(applyModAssets 后 main.ts 调)——key=自定义键,value=解码缓冲 */
  registerModAudio(key: string, buf: AudioBuffer): void { this.buffers.set(key, buf); }

  /** 音效事件追踪（2026-09-03 用户需求：F5 长按录制窗记录音效播放序列）。
   *  静态钩覆盖本仓全部 Sfx 实例（Game.sfx + UISfx 共享单例——游戏内的对话
   *  按钮/相机快门等菜单实例音同入账）；main.ts 接线后在事件时刻经 flow?.game
   *  解析活 Game 的 audioRec.sfx 环——换世界/HMR 双实例不钉死旧 Game。
   *  事件类 k：wav=触发面（含结局码 o）/out=补播实际出声/syn=合成兜底/
   *  loop·loopX=循环轨起停/loopF=循环轨加载失败/cue=风·雨环境 cue 起停 */
  static onEvent: ((k: string, d: unknown, tag: string) => void) | null = null;
  /** 实例出身（''=Game.sfx 世界实例；'ui'=UISfx 菜单共享单例）——事件第 3 参透传 */
  dbgTag = '';

  private emit(k: string, d: unknown): void {
    if (Sfx.onEvent) Sfx.onEvent(k, d, this.dbgTag);
  }

  constructor() {
    sfxInstances.add(this);   // 资源包覆盖下发时的缓冲驱逐对象
  }

  /** 资源包覆盖变更：驱逐受影响键的解码缓冲与失败负缓存（下次播放重取当前源）。
   *  包级可见（applySfxPackOverrides 跨实例调用） */
  evictSoundCache(files: Iterable<string>): void {
    for (const f of files) {
      this.buffers.delete(f);
      this.failed.delete(f);
    }
  }

  /** 在途解码（Promise 去重：ensureBuffer 同步面 / deferPlay 补播 / 循环轨
   *  共用的单一加载管线，防并发重复 fetch） */
  private bufferPromises = new Map<string, Promise<AudioBuffer | null>>();
  /** 取回失败/不存在的文件（负缓存，防 404 每次重试）。
   *  ★限时而非永久（2026-08-24 秃鹫死音报障）：SW cache-miss + 瞬时网络失败
   *  （vite 重启/SW 版本切换清缓存窗口）会把文件打进 failed → 该文件【整场】
   *  回退合成音（低频音效如秃鹫 NPC_Killed_31 首次请求即踩空的典型场景）。
   *  失败时刻入 failAt，超过 RETRY 窗口后放行重新加载。真 404（数据错名）
   *  每 15s 多一次 fetch，代价可忽略。 */
  private failed = new Set<string>();
  private failedAt = new Map<string, number>();
  /** 负缓存重试窗口（ms） */
  private static FAILED_RETRY_MS = 15_000;
  /** 负缓存是否仍有效（窗口内 true；过期自动解除） */
  private failedFresh(file: string): boolean {
    if (!this.failed.has(file)) return false;
    const at = this.failedAt.get(file) ?? 0;
    if (performance.now() - at >= Sfx.FAILED_RETRY_MS) {
      this.failed.delete(file);
      this.failedAt.delete(file);
      return false;
    }
    return true;
  }
  private markFailed(file: string): void {
    this.failed.add(file);
    this.failedAt.set(file, performance.now());
  }
  muted = false;
  /** 主音量 0..1（M6 设置页） */
  master = 1;
  /** Ambient 环境音量 0..1（Main.ambientVolume，Main.cs:1413 默认 1f；config 键
   *  "VolumeAmbient" Main.cs:4159/4383）。环境音族按此轨替换 master（见
   *  AMBIENT_FILES 注释） */
  ambient = 1;
  /** 载入期静音门（Game 侧置位/解除）：afterWorldLoad 的 waterCheck 全图收敛期间，
   *  killTile/breakTile/合并音会以 listener=(0,0) 满响（"进世界音效爆发"根因）。
   *  只盖一次性播放入口（play/playWavFile/startTrackedLoop——playWav/playFiles
   *  漏斗进 playWavFile 已被盖）；循环轨（天气/BGM/雨声）不经此门 */
  suppress = false;

  /** 原版单实例"播着跳过"族(LegacySoundPlayer.cs:实例 State==Playing 时 return null
   *  不重触发)——Roar(case 15 :825-841):多段蠕虫(毁灭者 80 段各自掷 soundDelay)靠
   *  同槽互斥收敛为单声,否则每 10-20t 满响吼叫叠成音墙。
   *  ★BJ291 勘误:BJ273 头注「僵尸族(case14/26/29)每次都播」半错——case 14(:796-827)/
   *  case 26(:972-983)确无 State 门每次都播;case 29(:1044-1048)【有】逐变体槽
   *  State==Playing → return null 在播跳过门,已入本集(下方 BJ291 块)。
   *  NPC_Hit(case3)是 Stop-重播、NPC_Killed(case4)每次都播,仍不在此列(R22 登记面维持)。 */
  private static readonly SINGLE_INSTANCE = new Set([
    'Roar_0', 'Roar_1', 'NPC_Killed_10',
    // 成就解锁音去重（AchievementInitializer.cs OnAchievementCompleted：FindActiveSound
    // ==null 才 PlayTrackedSound——进世界批量补授多成就同帧解锁时原版只响一声,
    // 2026-08-26 review 补,否则 achOnWorldEnter 一帧 N 连播叠音墙）
    'achievement_complete',
    // ★BJ273：case 3 style 57 在播跳过（LegacySoundPlayer.cs:654-657 State==Playing
    // → return null）——同 case 其余 style 是停旧播新（:666-674,SINGLE_SLOT_STOP）,
    // 57 单独走 skip 语义,勿并入 stop 集
    'NPC_Hit_57',
    // ★BJ289（2026-09-23 T2 全表差集落刀）：case 19 Splash 逐变体槽在播跳过
    // （LegacySoundPlayer.cs:875-878 SoundInstanceSplash[num].State != Stopped
    // → break 无声）——Splash_4/5 另有兄弟互斥门（:899-913,SPLASH_SIBLING 注）:
    // 微光(style4)/岩浆(style5)对同帧只出先到者。play() 合成回退已被
    // lastTriggerOutcome==='skip' 闸拦住（在播跳过=原版无声,不得补近似音）
    'Splash_0', 'Splash_1', 'Splash_2', 'Splash_3', 'Splash_4', 'Splash_5',
    // ★BJ289：case 28 Mech 在播跳过（:1001-1004 SoundInstanceMech[num].State ==
    // Playing → return null;器件右键切换音,Player.cs:31762/31799/31803）
    'Mech_0',
    // ★BJ291（2026-09-23,U1 漏修④⑤落刀;1457=1458 同门——LSP.cs:1044-1048/:1064-1068）：
    // case 29 怪物语音库逐变体槽在播跳过（num=Style 槽 State==Playing → return null;
    // 音量档乘全在 FILE_CASE_VOL:24-87 ×0.5/88-91 ×0.7/92 ×0.5/93-99 ×0.4/100-101
    // ×0.25/102 ×0.4/103 ×0.4/104 ×0.55）。24..104=档乘全域钉死;门本身对一切 style
    // 生效——仓内可达 style 补 6/8/9/20/105/124/125（弗兰肯闲话/面怪/猪龙 grunt/猪龙鱼
    // 公爵/暗影焰游魂显形/狼 378 起跳咬齿/蜂后冲刺吼;各文件单写者=case29,逐文件槽
    // 同构 1:1）。style 7(吸血鬼)例外不入:同文件被 case14-542 沙鲨扑咬无门面共用
    // （FILE_CASE_VOL Zombie_7 注）,入集会错杀 case14 面 → 登记近似（BJ291 残留）。
    // 消费面:vanillaNpcAmbience IDLE_SOUNDS——「32」=vanilla NPC.IdleSounds()
    // 的 else-if【分段数】（NPC.cs:91184-91317,1458 同 :91184 起;1456 :91115 起）
    // 非仓表条目数（仓表=32 分支按共享谓词展开成 52 型键;Enemy.ts:3147 逐变体
    // 直名播。★BJ293 2026-09-23 口径勘误:旧注「IdleSounds 32 类」未注明口径,
    // 易误读作仓表条目;闲话/受击族 case 14-69 分段与本表无关——本表全 PlaySound(29))+
    // CHATTER/CRITTER+Enemy.ts:7335(:7516)+bossAI 89/100/102/105/125/20——同变体叠响可闻差。
    // ★组3.2 核后并入（逐变体门=逐文件槽同构）:case 30 稀有支 Zombie_12（:1110-1114
    // rare 槽忙检;常规 10/11 无门不入）/case 32 逐变体(:1137-1140)/case 33(:1205-1208)/
    // case 67/68/69 逐变体(:1149-1152/:1161-1164/:1173-1176)。case 46(:1075-1082 先查
    // 110+111 任一在播即整支 null)/case 65(:1391-1401)仍是【整体忙检】≠逐文件槽,
    // 不入集=登记近似（BJ291 残留;case44 Seagull 原文本就无门）。
    // ★BJ704-G10（R2-F9,2026-10-21）case 66 三重整体忙检（:1185-1195 Zombie_121/
    // 122/123 任一在播即整支 null）落模清偿——入 SINGLE_INSTANCE（占槽注册,自身
    // 在播跳过）+ GROUP_BUSY 群门（组内任一在播跳过,见 siblingBlocked）;
    // ±0.15 音调=PITCH_CASE[case66] 表档（:342,0c186b4c 起在位,R2-F9「pitch 未传」
    // 前提勘误——playSfxFiles pitch 参是显式直传通道,表档才是随机抖动正道）。
    'Zombie_121', 'Zombie_122', 'Zombie_123',
    ...Array.from({ length: 81 }, (_, k) => `Zombie_${k + 24}`),
    'Zombie_6', 'Zombie_8', 'Zombie_9', 'Zombie_20', 'Zombie_105', 'Zombie_124', 'Zombie_125',
    'Zombie_109',   // ★BJ291（U1 漏修⑤）：case 45 Dolphin 在播跳过（音量档 FILE_CASE_VOL:244 已在）
    'Zombie_12',    // case 30 稀有支 1/300（:1110-1114）
    'Zombie_14', 'Zombie_15', 'Zombie_16', 'Zombie_17', 'Zombie_18', 'Zombie_19',
                    // case 32 逐变体(:1137-1140)/case 33 num=15(:1205-1208)
    'Zombie_118', 'Zombie_119', 'Zombie_120',   // case 67 逐变体(:1149-1152)
    'Zombie_126', 'Zombie_127', 'Zombie_128',   // case 68 逐变体(:1161-1164)
    'Zombie_129', 'Zombie_130',                 // case 69 逐变体(:1173-1176)
  ]);
  /** ★R26 GAP-05:Item 音库(case 2 LegacySoundPlayer.cs:519-643)三组实例槽语义——
   *  原版每个 style 一条 SoundInstanceItem[num] 槽,快速连发时:
   *  · SKIP_IF_PLAYING(styles 53/55/159,:555-561/:587-591):在播 → return null 不重触发;
   *  · OVERLAP_OK(例外不停播清单 styles 9/10/24/26/34/43/103/156/162/205,:604-615):
   *    不停旧实例自由叠响(Crystal Storm Item_9 连发多层音墙=原版真态!);
   *  · 其余全部 default(:600-603):**先 .Stop() 上一实例再建新实例**(Stop-then-play)
   *    ——快速连发的魔法杖(Item_13/20/21/8…)原版是单实例替换非多层叠响。
   *  键=wav 文件名(Item_N 与槽号 num 一一对应);case 1 的 Item_1→18/19 轮换发生在
   *  槽判定之前(playWavFile 头),轮换后的文件按自身组别管理(:556 重赋值 num 后再走槽) */
  private static readonly ITEM_SKIP_IF_PLAYING = new Set(['Item_53', 'Item_55', 'Item_159']);
  private static readonly ITEM_OVERLAP_OK = new Set([
    'Item_9', 'Item_10', 'Item_24', 'Item_26', 'Item_34', 'Item_43',
    'Item_103', 'Item_156', 'Item_162', 'Item_205',
    // ★2026-08-26 终审修正:曾把 Item_124/125(弹 462 二选一音)划入免停组,依据是
    //   "SoundEngine.PlaySound(SoundID.Item124)=新音频系统路径零槽管理"——该论断在
    //   1.4.5.8 反编译源不成立:LegacyAudioSystem 是唯一音频系统(SoundEngine.Initialize
    //   Terraria.Audio/SoundEngine.cs:24-33 只返回 Legacy/Disabled),LegacySoundStyle
    //   重载(SoundID.Item124=LegacySoundStyle(2,124),SoundID.cs:664/:666)在
    //   PlaySound(LegacySoundStyle…) SoundEngine.cs:88-100 折算回 (type=2,style=124)
    //   int 路径:102-109→LegacySoundPlayer.PlaySound case2:num=124 既不在免停组
    //   (:598-608)也不在 53/55/159 在播跳过组——落 default 先 .Stop() 再建新实例
    //   (:592-597)= stop 档。三连矢(dur-14/-7/dur 每 7t 一发)掷到同文件时原版即
    //   截断上一发尾音,本仓照抄。
  ]);
  /** ★BJ273（2026-09-22 用户报「长按右键连取取物音越来越响」定谳落刀）：原版单实例
   *  槽【停旧播新】族——LegacySoundPlayer.PlaySound 各 case 对命名槽/逐变体槽先
   *  .Stop() 旧实例再 CreateInstance 新实例（同槽互斥截断,快速连发永不叠响）。
   *  本仓此前对 Menu_Tick 等落 'none'（自由叠响）：右键连取加速梯节拍
   *  （stackDelay 7→2 拍=117→33ms;superFastStack 期同帧多件）短于 Menu_Tick
   *  解码时长 71.4ms,同时在响实例数单调上升=主观渐强,探针实测 33ms×14 连发
   *  零互斥+并发爬升。逐案锚（Terarria1457/Terraria.Audio/LegacySoundPlayer.cs）：
   *  case 0 Dig 逐变体槽（:443-449）/ case 1 PlayerHit 逐变体槽（:506-517）/
   *  case 3 NPCHit 逐 style 槽（:666-674;style 57=skip 见 SINGLE_INSTANCE 注）/
   *  case 5 PlayerKilled（:699-707）/ case 6 Grass（:709-719）/ case 7 Grab
   *  （:720-730）/ case 8/9 Door（:731-752）/ case 10/11/12 Menu Open/Close/Tick
   *  （:753-785）/ case 13 Shatter（:786-795）。
   *  逐变体槽=逐文件槽（singlePlaying 键=文件名:同变体才互斥截断,跨变体照常叠响,
   *  与原版 SoundInstanceDig[num13]/SoundInstancePlayerHit[num15] 按下标分槽同构）。
   *  对照不收入=原版语义本就叠响/另档：case 4 NPCKilled 仅覆槽引用不 Stop（:693）、
   *  case 2 Item 三组槽（R26 ITEM_* 表）、case 15 Roar/case 19 Splash/case 28 Mech/
   *  case 29 僵尸族/case 45 Dolphin 在播跳过（SINGLE_INSTANCE;★BJ291 勘误——case 29
   *  非「每次都播」,BJ273 头注半错,见 SINGLE_INSTANCE 头勘误注）。
   *  ★BJ289（2026-09-23 T2 全表差集落刀）：case 21/22/23/43 停旧播新入集。逐案锚
   *  （Terarria1457/Terraria.Audio/LegacySoundPlayer.cs;1458 行号全同）：case 21 Tink
   *  逐变体槽 num17=Next(3) 停旧播新（:927-939）/ case 22 Unlock 命名槽（:940-949）/
   *  case 23 Drown 命名槽（:950-960）/ case 43 Thunder 六变体槽（:457-477——掷前先
   *  挑非在播槽至多 6 掷,全在播才停末掷槽;本仓逐文件槽 stop 与之等价,「挑空槽预掷」
   *  不建模=登记近似:雷声触发间隔≫样本长,仅多雷并发时可闻有差）。
   *  T2 表外 direct-name 族（不经 WAV_MAP 的 playWavFile 直名播,各案登记面）：
   *  16 DoubleJump（Player.ts 登记不建模）/ 63·64 Research（ResearchUI.ts 登记不建模）
   *  ——新登记债：case 20 FemaleHit 逐变体 stop（PlayerVoice 可达）/ case 27 Pixie
   *  在播跳过+在播实例音量刷新（Enemy.ts 可达）未建模。 */
  private static readonly SINGLE_SLOT_STOP = new Set([
    'Menu_Tick', 'Menu_Open', 'Menu_Close',
    'Grab', 'Door_Opened', 'Door_Closed', 'Shatter', 'Grass',
    'Player_Killed', 'Player_Hit_0', 'Player_Hit_1', 'Player_Hit_2',
    'Dig_0', 'Dig_1', 'Dig_2',
    ...Array.from({ length: 56 }, (_, k) => `NPC_Hit_${k + 1}`),   // style 1..56
    'NPC_Hit_58',   // 57=skip 档（SINGLE_INSTANCE）,58 回归 stop
    // ★BJ289：case 43 Thunder 六变体槽轮转 stop（:457-477;PITCH_CASE ±0.10 已档）
    ...Array.from({ length: 6 }, (_, k) => `Thunder_${k}`),
    'Tink_0', 'Tink_1', 'Tink_2',   // case 21 :927-939 逐变体槽（PITCH null 已档）
    'Unlock',                       // case 22 :940-949 命名槽
    'Drown',                        // case 23 :950-960 命名槽
    // ★BJ291（U1 漏修⑥）：case 40 Camera 快门命名槽停旧播新（LegacySoundPlayer.cs
    // :1366-1372 SoundInstanceCamera != null → .Stop() 再 CreateInstance;1458 :1367-1373
    // 同构零变更）——CaptureMode.ts:377 playWavFile('Camera') 连拍叠响消除
    'Camera',
  ]);

  /** ★BJ289：case 19 Splash_4/5 兄弟互斥门（LegacySoundPlayer.cs:899-913）——num=4
   *  须 Splash_5 槽空/已停才出声,num=5 对称;实例虽已建但 soundEffectInstance 置 null
   *  不 Play（:1417-1424）=本次无声无占位（未播实例 State=Stopped 不拦后播）。
   *  微光配对(style4)与岩浆(style5)相邻触发同帧只出先到者。 */
  private static readonly SPLASH_SIBLING: Record<string, string> = {
    Splash_4: 'Splash_5',
    Splash_5: 'Splash_4',
  };
  /** 单实例槽分类('skip'=在播跳过 / 'stop'=先停后播 / 'none'=不管理可自由叠响):
   *  Item_N 全体入槽管理(槽引用照记,default 组停旧、例外组只换绑),Roar 族维持 skip,
   *  ★BJ273 单槽停旧播新族见 SINGLE_SLOT_STOP 注 */
  private static slotAction(file: string): 'skip' | 'stop' | 'none' {
    if (Sfx.SINGLE_INSTANCE.has(file)) return 'skip';
    if (Sfx.SINGLE_SLOT_STOP.has(file)) return 'stop';
    if (/^Item_\d+$/.test(file)) {
      if (Sfx.ITEM_SKIP_IF_PLAYING.has(file)) return 'skip';
      if (Sfx.ITEM_OVERLAP_OK.has(file)) return 'none';
      return 'stop';
    }
    return 'none';
  }
  /** 单实例槽:file → 正在播的 source(onended 清) */
  private singlePlaying = new Map<string, AudioBufferSourceNode>();
  /** ★BJ704-G10（R2-F9）case 66 三重整体忙检群（LSP :1185-1195）——组内【任一】
   *  在播即整支 return null（互斥群≠逐文件槽≠兄弟对;三文件共一组,组员须在
   *  SINGLE_INSTANCE 占槽注册本门才可观测）。现役组员=Zombie_121/122/123
   *  （75 HappyBomb case66 小丑笑声,唯一消费面 DART_STYLE 75 sfx）。 */
  private static readonly GROUP_BUSY: Readonly<Record<string, readonly string[]>> = {
    Zombie_121: ['Zombie_121', 'Zombie_122', 'Zombie_123'],
    Zombie_122: ['Zombie_121', 'Zombie_122', 'Zombie_123'],
    Zombie_123: ['Zombie_121', 'Zombie_122', 'Zombie_123'],
  };
  /** ★BJ289 case 19 兄弟互斥门 + ★G10 case 66 群门：本文件的兄弟槽/互斥群任一
   *  在播 = 本次无声（skip 同语义,结局码同 'skip';即时路径与 deferPlay 补播两处消费） */
  private siblingBlocked(file: string): boolean {
    const sib = Sfx.SPLASH_SIBLING[file];
    if (sib !== undefined && this.singlePlaying.has(sib)) return true;
    const grp = Sfx.GROUP_BUSY[file];
    return grp !== undefined && grp.some((f) => this.singlePlaying.has(f));
  }
  /** 最近一次同步触发链的结局码（play() 合成回退判据专用）：playWavFile 在
   *  playWavFileCore 返回处单点落值,play() 先清后读——同同步块内无重入窗口;
   *  异步 deferPlay 的 skip 重判不经此（只静默 return）。★BJ289：'skip'=原版在播
   *  跳过=无声,play() 据此跳过合成兜底（否则 case 15/19/28 的"在播跳过"会凭空
   *  补一声近似音,违背原版静默语义）;其余结局码不改变 play() 原有回退面 */
  private lastTriggerOutcome: 'ok' | 'q' | 'sup' | 'skip' | 'mut' | 'att' | 'fail' | null = null;
  /** Stop-then-play 的"先停"半边(default 分支 :600-603 SoundInstanceItem[num].Stop()):
   *  立即停旧源并清槽,新实例随后入槽。幂等(空槽静默) */
  private stopSingleSlot(file: string): void {
    const prev = this.singlePlaying.get(file);
    if (prev) {
      try { prev.stop(); } catch { /* 已停 */ }
      this.singlePlaying.delete(file);
    }
  }

  /** 按需取缓冲（同步面）：命中返回缓冲；未命中触发后台加载并同步返回 null。
   *  资源包覆盖优先（M13，AssetSourceController.UseResourcePacks 的音频源同语义）：
   *  包内 Sounds/<X> 先于 sprites/ 基础源查询——命中即用包字节，不走 fetch。 */
  private ensureBuffer(file: string): AudioBuffer | null {
    const buf = this.buffers.get(file);
    if (buf) return buf;
    if (this.failedFresh(file)) return null;
    const ctx = this.ensure(true);
    if (!ctx) return null;
    void this.ensureBufferAsync(file, ctx);   // 后台加载（bufferPromises 去重）
    return null;
  }

  /** 定向预热（不阻塞）：把指定 wav 后台取齐，播放时即命中 */
  preloadFiles(files: Iterable<string>) {
    for (const f of files) this.ensureBuffer(f);
  }

  /** 按逻辑名预热（WAV_MAP 展开到具体文件） */
  preloadNames(names: SfxName[]) {
    for (const n of names) for (const f of WAV_MAP[n] ?? []) this.ensureBuffer(f);
  }

  // ---- 环境 cue 双层（风 cue45 / 雨 cue28）：XACT AudioTrack 载体面 1:1 ----
  //  每层 = 增益节点 + 解码缓冲 + 源节点 + musicFade 状态机。★播放态转写：
  //  Reuse()+Play() = 新建 BufferSource 从头起播（XACT cue 重播语义，非"静音常驻"）；
  //  Stop(Immediate) = 源节点真停拆。波 bank 未备（buf 未解码）= LegacyAudioSystem
  //  :220 IsPrepared 早退 → 状态机整帧冻结（fade 不进不退）。加载失败静默。
  private cueLayers = {
    /** WindAmbience cue45（Main.cs:11723-11749）。★可闻边界 = worldSurface（最深谷列
     *  +25,TerrainPass.cs:206）非本地草皮线——高原山下挖矿仍判「地表」继续播风 */
    wind: { gain: null, buf: null, loading: false, src: null, cue: { fade: 0, playing: false } } as CueLayer,
    /** RainAmbience cue28（Main.cs:11700-11720 case28；基线 num11=0.5 是原版真态） */
    rain: { gain: null, buf: null, loading: false, src: null, cue: { fade: 0, playing: false } } as CueLayer,
  };

  /** 设置风声强度（每帧驱动）：level = case45 公式值 num7（含 shimmer/atmo⁴,不含
   *  ambient）;gate = |wind|≥20/50 && SurfaceAtmospherics */
  setWind(level: number, gate: boolean) {
    const ctx = this.ensure(true);
    if (!ctx) return;
    this.stepCue('wind', this.cueLayers.wind, ctx, 'audios/music/Music_45.mp3', level, gate);
  }

  /** 设置雨声强度（每帧驱动）：level = case28 公式值 num11;gate = ZoneRain && !ZoneSnow */
  setRain(level: number, gate: boolean) {
    const ctx = this.ensure(true);
    if (!ctx) return;
    this.stepCue('rain', this.cueLayers.rain, ctx, 'audios/music/Music_28.mp3', level, gate);
  }

  /** 单层推进（LegacyAudioSystem.UpdateAmbientCueState/TowardStopping 的载体半边） */
  private stepCue(name: 'wind' | 'rain', L: CueLayer, ctx: AudioContext, file: string, level: number, gate: boolean): void {
    if (!L.gain) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(ctx.destination);
      L.gain = g;
      this.loadCueBuffer(ctx, L, file);
    }
    if (!L.buf) return;                       // :220 !WaveBank.IsPrepared → 整机冻结
    const was = L.cue.playing;
    const v = stepAmbientCue(L.cue, level, this.ambient, gate);
    if (was !== L.cue.playing) this.emit('cue', { c: name, on: L.cue.playing ? 1 : 0 });
    if (!was && L.cue.playing) {              // :237-239 Reuse()+Play() 从头起播
      const src = ctx.createBufferSource();
      src.buffer = L.buf;
      applyLoopBounds(src, L.buf);            // ★BJ74 循环终点内收（Chromium 回绕缺陷,见函数注）
      src.connect(L.gain!);
      src.start();
      L.src = src;
    } else if (was && !L.cue.playing && L.src) {   // :232/:269 Stop(Immediate) 停拆
      try { L.src.stop(); } catch { /* 已停 */ }
      L.src = null;
    }
    // 失焦环境归零（QuietAmbientSounds FocusHelper.cs:109）：MP 豁免时 ctx 在跑，
    // 靠本因子把环境 cue 静音；状态机照走（原版只乘音量不停车）。
    // ★勿把因子喂进 stepAmbientCue 的 ambient 参——0 会走 sys===0 Immediate 停支
    if (v !== null) this.setGainNow(L.gain.gain, v * this.ambientQuiet());
  }

  /** 波 bank 后台取齐（失败静默：buf 恒 null = 冻结无声，雨/风均为可选层）。
   *  ★SW-FX16：资源包音乐覆盖优先——Music_45/Music_28 与 BGM 同表
   *  （原版资源包音乐替换覆盖全 AudioTracks 含环境 cue,LegacyAudioSystem.cs:34-54）；
   *  层缓冲随层节点常驻,覆盖变更不回灌已建层（登记于 applyMusicPackOverrides 注）。 */
  private loadCueBuffer(ctx: AudioContext, L: CueLayer, file: string): void {
    if (L.loading) return;
    L.loading = true;
    const ov = musicPackOverride(file.replace(/^.*\//, '').replace(/\.[^.]+$/, ''));
    if (ov) {
      ctx.decodeAudioData(ov.slice().buffer)
        .then((buf) => { L.buf = buf; })
        .catch(() => {});
      return;
    }
    fetch(file)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => (ab ? ctx.decodeAudioData(ab) : null))
      .then((buf) => { if (buf) L.buf = buf; })
      .catch(() => {});
  }

  /** 每帧 SetVariable("Volume") 同构：清调度后瞬时赋值（原版逐帧直写音量无平滑） */
  private setGainNow(p: AudioParam, v: number): void {
    const t = this.ctx!.currentTime;
    p.cancelScheduledValues(t);
    p.value = Math.max(0, v);
  }

  /** 环境音 cue 双轨全停（退世界/销毁时调用）：源节点停拆 + Immediate 静音 + 状态机
   *  归零。★review 修（2026-08-24）：stopWeatherLoops 原单次 setRain(0,false) 只走一帧
   *  渐熄步进、天气链已停更 → gain 滞留近满幅漏进菜单；风层此前更无退出静音路径
   *  （既有泄漏，大风天退世界风声长鸣）。跨世界不复用 fade（destroy「防下个世界
   *  复用旧状态」同语义）；解码缓冲保留（WaveBank 备妥态跨世界成立），下次起播
   *  从头开始——与原版 Stop 后 Reuse 一致 */
  stopAmbientCues(): void {
    for (const L of [this.cueLayers.wind, this.cueLayers.rain]) {
      L.cue = { fade: 0, playing: false };
      if (L.src) { try { L.src.stop(); } catch { /* 已停 */ } L.src = null; }
      if (L.gain) this.setGainNow(L.gain.gain, 0);
    }
  }


  /** 世界声距离衰减（LegacySoundPlayer.cs:160 SoundAttenuationDistance = 2500px） */
  static readonly ATTEN = 2500;
  /** 监听器（原版 Main.Camera.Center，相机中心非玩家）；Game 每帧更新。未进世界=(0,0) */
  private lx = 0; private ly = 0;
  setListener(x: number, y: number) { this.lx = x; this.ly = y; }
  /** 原版距离衰减（LegacySoundPlayer.cs:381-401）：dist ≥2500 → 不播；
   *  vol × (1 - dist/2500)。不传坐标（x=-1 语义）→ 全量（UI/玩家自身动作声） */
  private atten(vol: number, x?: number, y?: number): number {
    if (x == null || y == null) return vol;
    const d = Math.hypot(x - this.lx, y - this.ly);
    if (d >= Sfx.ATTEN) return 0;
    return vol * (1 - d / Sfx.ATTEN);
  }

  /** 原版声像（LegacySoundPlayer.cs:398）：pan = dx/(MaxWorldViewSize.X/2) 钳 ±1。
   *  MaxWorldViewSize=(1920,1200) 是恒常量（Main.cs:754-758），分母 = 960 非窗口宽。
   *  R22 补齐：旧实现全程无声像（单声道定位）。 */
  static readonly PAN_HALF_VIEW = 960;
  private panOf(x?: number, y?: number): number {
    if (x == null || y == null) return 0;
    return Math.max(-1, Math.min(1, (x - this.lx) / Sfx.PAN_HALF_VIEW));
  }

  // ---- 失焦音频闸（红队 R3-E2 ①③④ 重构 2026-09-03；初版 2026-08-25 最小形态）----
  //  原版三分闸（UpdateAudio 头部 Main.cs:11193-11202：allowMusic=false →
  //  audioSystem.PauseAll() + SoundEngine.StopAmbientSounds()）：
  //  · 音乐 AllowMusic(FocusHelper.cs:85-95)=失焦取 Main.SettingPlayWhenUnfocused
  //    (Main.cs:268 默认 false)——后台放行仅音乐、主动开关；
  //  · 音效 PauseSounds(:97-107)=!GameplayActive && netMode==0 即暂停（SoundEngine.cs
  //    :54-63 PauseAll/ResumeAll）——【与开关无关】：单机失焦 sfx 恒停、联机豁免；
  //  · 环境音 QuietAmbientSounds(:109)=失焦恒归零（LegacySoundPlayer.cs:422）。
  //  Web 同构 = 按 ctx 类别分闸（本仓 sfx/BGM 分 ctx）：'music'=BGM 唯一 ctx
  //  （Audio.ts 登记）、'sfx'=其余（ambient 循环层/风·雨环境 cue 全在 sfx ctx 上，
  //  suspend 即静音）；suspend/resume 与 XACT Pause/Resume 同为「冻结+原地续播」。
  private static ctxRegistry = new Map<AudioContext, 'sfx' | 'music'>();
  /** 失焦两源（①）：visibilitychange=tab 隐藏；window blur=可见但未激活（点另一
   *  应用/第二屏——原版 Main.instance.IsActive 的 Web 等价态，曾漏此源照常出声） */
  private static visHidden = false;
  private static winBlurred = false;
  /** 两源合并（①：任一"未激活"即停，focus+visible 双恢复才续）——原版
   *  UpdateFocus 逐帧轮询 IsActive（FocusHelper.cs:139），Web 事件面无轮询，
   *  两事件各置一源后按并集取态 */
  static isAppInactive(): boolean {
    return Sfx.visHidden || Sfx.winBlurred;
  }
  /** MP（netMode==1）失焦豁免探针（④）：原版暂停/停声两门都带 netMode==0 条件
   *  （FocusHelper.cs:97-107 PauseSounds / :139-141 UpdateFocus）——联机失焦游戏
   *  照跑、sfx 不停。Game 构造期接线（可读 net 态 `() => !!this.net?.active`，
   *  ClientNet.active），destroy 摘除；null=未接（单机语义） */
  static mpProbe: (() => boolean) | null = null;
  /** ★后台泵音频豁免探针（2026-09-29 后台 SFX 通道）：pumpGate 四门同口径
   *  （running/world/!paused + backgroundRun/playWhenUnfocused 两开关,Game 构造期
   *  接线、destroy 摘除,mpProbe 同款生命周期;null=未接=旧行为）。
   *  消费面三处：①setAudioSuspension——后台泵模式下 sfx ctx 不随失焦挂起
   *  （PauseSounds :97-107 的 Web 泵豁免臂——世界后台照跑时音效随世界延续）；
   *  ②ensure() gateBlocked——同放行 resume；③ambientQuiet()——QuietAmbientSounds
   *  :109 的后台放行臂（环境 cue/循环轨/ambient 一次性族按冻结视口延续,雨在下=
   *  雨声在）。探针 false（暂停=用户选择/菜单/停机/任一开关关）=旧行为失焦静音 */
  static bgAudioProbe: (() => boolean) | null = null;

  /** 各 AudioContext 创建点登记(Sfx.ensure / AudioSystem.audio)。kind 分闸类别
   *  （③）。★闸监听挂首个 ctx 登记处（幂等，④）——boot 期 BGM ctx 先于任何
   *  Sfx 播放建立时闸也在位（旧实现 ensure 侧接线存在无闸窗口）。
   *  短命实例(Game 级 sfx)销毁时必须 releaseAudioContext 摘除,防死 ctx 被表钉死
   *  (HMR 双实例/连续读档内存教训);长命实例(BGM/菜单)随 app 存活无需摘 */
  static registerAudioContext(c: AudioContext, kind: 'sfx' | 'music' = 'sfx'): void {
    Sfx.ctxRegistry.set(c, kind);
    Sfx.hookAudioGateOnce();
  }

  /** 销毁时从失焦闸注册表摘除（Game.destroy 调用） */
  releaseAudioContext(): void {
    if (this.ctx) Sfx.ctxRegistry.delete(this.ctx);
  }

  /** 失焦闸总开关：inactive=true 落闸,false 续播(ResumeAll)。分类别（③）：
   *  'music' ctx 仅开关关时挂起（AllowMusic :85-95 失焦放行仅音乐——开关开=后台听歌）；
   *  'sfx' ctx 恒挂起（PauseSounds :97-107 与开关无关）,MP 豁免（mpProbe,④）,
   *  ★后台泵豁免（bgAudioProbe,2026-09-29 后台 SFX 通道）——世界后台照跑
   *  （pumpGate 全开）时音效随世界延续,失焦挂起只对「世界冻住」的失焦生效；
   *  ambient 层在 sfx ctx 上随 suspend 静音,泵/MP 豁免时由 ambientQuiet() 承接
   *  （MP 期仍归零=QuietAmbientSounds :109 无 netMode 门;泵期放行见其注）。
   *  resume 被拒(iOS 低电量模式/无手势历史)时挂下一次 pointerdown 重试——
   *  AudioSystem.armUnlock 手势兜底同款 */
  static setAudioSuspension(inactive: boolean): void {
    const musicContinue = options.data.playWhenUnfocused;   // AllowAudioUnfocused :23
    for (const [c, kind] of Sfx.ctxRegistry) {
      if (inactive) {
        if (kind === 'music' && musicContinue) continue;
        if (kind === 'sfx' && (Sfx.mpProbe?.() ?? false)) continue;
        if (kind === 'sfx' && (Sfx.bgAudioProbe?.() ?? false)) continue;
        if (c.state === 'running') void c.suspend().catch(() => {});
      } else if (c.state === 'suspended') {
        void c.resume().catch(() => {
          window.addEventListener('pointerdown', () => { void c.resume().catch(() => {}); }, { once: true });
        });
      }
    }
  }
  /** 页面级监听只挂一次(多实例/HMR 重跑防重);首个 ctx 登记处接线（④）。
   *  ★①两源合并:visibilitychange(tab 隐藏)∪window blur(可见但未激活)——blur 独立
   *  于 visibilitychange 触发（点另一应用窗口=可见但失焦,曾漏=照常出声根因①）；
   *  恢复按 isAppInactive() 合并态重判（一源未清不清闸）。
   *  ★node 单测环境无 document——守卫跳过(失焦闸纯浏览器行为) */
  private static audioGateHooked = false;
  private static hookAudioGateOnce(): void {
    // window 只探可调用面——测试桩可能给局部 window 对象（无 addEventListener）
    if (Sfx.audioGateHooked || typeof document === 'undefined'
      || typeof window?.addEventListener !== 'function') return;
    Sfx.audioGateHooked = true;
    document.addEventListener('visibilitychange', () => {
      Sfx.visHidden = document.hidden;
      Sfx.setAudioSuspension(Sfx.isAppInactive());
    });
    window.addEventListener('blur', () => {
      Sfx.winBlurred = true;
      Sfx.setAudioSuspension(Sfx.isAppInactive());
    });
    window.addEventListener('focus', () => {
      Sfx.winBlurred = false;
      Sfx.setAudioSuspension(Sfx.isAppInactive());
    });
  }

  /** 失焦环境静音因子（QuietAmbientSounds FocusHelper.cs:109 → LegacySoundPlayer.cs
   *  :422 `num2 *= ambientVolume × (Quiet?0:1)`，无 netMode 门）：未激活=0。
   *  单机下 sfx ctx 已 suspend（因子冗余但同语义）；MP 豁免下 ctx 仍在跑，
   *  ambient 轨靠本因子归零（一次性 ambient 族与环境循环层两处消费）。
   *  ★后台泵豁免（2026-09-29 后台 SFX 通道）：bgAudioProbe 开（pumpGate 全开=世界
   *  后台照跑）时因子回 1——雨声/风声 cue、暴风雪循环轨、ambient 一次性族
   *  （鸟鸣/小动物声,AMBIENT_FILES 族）按冻结视口延续;探针 false=旧行为归零 */
  private ambientQuiet(): number {
    if (!Sfx.isAppInactive()) return 1;
    return (Sfx.bgAudioProbe?.() ?? false) ? 1 : 0;
  }

  private ensure(silent = false): AudioContext | null {
    if (this.muted && !silent) return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      Sfx.registerAudioContext(this.ctx);
    }
    // ★失焦闸配合（①③）：未激活期间禁止自动 resume(否则网络回调等触发的 ensure
    //   会拆闸)。sfx ctx 单机恒停（PauseSounds 与开关无关）、MP 豁免、后台泵豁免
    //   （bgAudioProbe——世界后台照跑时泵路径触发的 ensure 放行 resume）;BGM ctx 的
    //   放行面在 Audio.audio()（AllowMusic :85-95 取开关）。node 单测无事件源=可见
    const gateBlocked = Sfx.isAppInactive() && !(Sfx.mpProbe?.() ?? false)
      && !(Sfx.bgAudioProbe?.() ?? false);
    if (this.ctx.state === 'suspended' && !gateBlocked) this.ctx.resume().catch(() => {});
    this.warmup();
    return this.ctx;
  }

  /** 高频预热（每实例一次）：首次取得 AudioContext 即后台 decode WARMUP_NAMES。
   *  触发点 = 该实例第一次任何播放/预热（菜单实例 UISfx.sfx 在首手势、
   *  Game.sfx 在世界载入 preloadNames 处）——把枪声等高频轨的按需加载窗
   *  提前到进世界前。静音时不取（解除静音后的首播再触发）。 */
  private warmed = false;
  private warmup(): void {
    if (this.warmed || this.muted) return;
    this.warmed = true;
    this.preloadNames(WARMUP_NAMES);
  }

  /** 播放原版 wav（随机变体 + 轻微音高扰动）；vol 0-1 */
  playWav(name: SfxName, vol = 1, x?: number, y?: number): boolean {
    const list = WAV_MAP[name];
    if (!list || !list.length) return false;
    return this.playWavFile(list[Math.floor(Math.random() * list.length)], vol, x, y);
  }

  /** 播放任意 wav 文件列表（随机选 + 音高扰动）；供怪物专属声效用。
   *  pitch = 显式 XNA pitchOffset（arcSurgeFx :1268 变调消费,经 playWavFile 直入
   *  pitchRateFor explicitPitch 档 2^pitch——传入即跳过该文件 PITCH_CASE 抖动表,原版
   *  Style.PitchVariance=0 时 GetRandomPitch 恒 0 同语义）。
   *  ★BJ704-G10（R2-F9）：单实例/互斥群在播跳过（'skip'）返回【true】——「本次
   *  触发已按原版语义处置（=有意静默）」,抑制 Game.playSfxFiles 的 'hit' 合成
   *  兜底（BJ289 play() 同判据:在播跳过=原版 return null 无声,勿补近似音;
   *  唯一活体=75 HappyBomb case66 群门,Item_53/55/159 skip 档同受益）。 */
  playFiles(files: string[], vol = 1, x?: number, y?: number, pitch?: number): boolean {
    if (!files.length) return false;
    const ok = this.playWavFile(files[Math.floor(Math.random() * files.length)], vol, x, y, pitch);
    return ok || this.lastTriggerOutcome === 'skip';
  }

  /** 跟踪式循环音（SoundEngine.PlayTrackedLoopedSound 语义，AI_016 :44276 引信嘶声）:
   *  返回句柄 {stop, setPos}——setPos 按距离衰减刷新音量（ProjectileAudioTracker
   *  跟随弹体）。缓冲未就绪返回 null（调用方下 tick 重试即可）。 */
  startTrackedLoop(name: SfxName, vol: number, x: number, y: number): {
    stop(): void; setPos(px: number, py: number): void; setVolume?(v: number): void;
    setPitch?(p: number): void;
  } | null {
    if (this.suppress) return null;          // 载入期静音门（见字段注释）
    const list = WAV_MAP[name];
    if (!list || !list.length) return null;
    const ctx = this.ensure();
    if (!ctx) return null;
    const buf = this.ensureBuffer(list[0]);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    applyLoopBounds(src, buf);              // ★BJ74 循环终点内收（Chromium 回绕缺陷,见函数注）
    src.playbackRate.value = pitchRateFor(list[0]);
    const g = ctx.createGain();
    // setVolume 面积(终清波)：ActiveSound.Volume 逐帧覆写语义(NPC.cs:41464 女皇水晶
    // 收门段 Volume=scale / 天气轨同构)——乘在基量上,与位置衰减 atten 相互独立
    let vmul = 1;
    let lx = x, ly = y;
    // ★清偿刀 A（2026-09-29）：终钳 min(1,·) = 原版 DetermineIntendedVolume 尾
    //  Clamp(num,0,1)（ActiveSound.cs:160）——既有消费者 vmul≤1 时无感（幂等）,
    //  AI_195/205 引擎轨透传原值 num4（0..25）时接住近场超 1 面等原版钳口。
    const applyAt = (px: number, py: number) => {
      g.gain.value = Math.min(1, this.atten(vol * vmul, px, py) * this.master);
      if (panner) panner.pan.value = this.panOf(px, py);
    };
    // `panner` 在下方声明——applyAt 仅在句柄返回后被调用(TDZ 安全)
    g.gain.value = this.atten(vol * vmul, x, y) * this.master;
    src.connect(g);
    // 声像跟随（原版跟踪轨每次 PlaySound 重设 Pan=num3 同语义）
    let panner: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.value = this.panOf(x, y);
      g.connect(panner);
      panner.connect(ctx.destination);
    } else {
      g.connect(ctx.destination);
    }
    src.start();
    // 循环轨起/停事件（引信/传送门/Kobold 等跟踪循环）：走到这里缓冲必已就绪
    // （未就绪上方已 return null 由调用方下 tick 重试）——本事件即实际起振时刻
    const loopFile = list[0];
    this.emit('loop', {
      f: loopFile, v: vol,
      ...(x != null && y != null ? { x: Math.round(x), y: Math.round(y) } : {}),
    });
    return {
      stop: () => {
        this.emit('loopX', { f: loopFile });
        try { src.stop(); } catch { /* 已停 */ } g.disconnect(); panner?.disconnect();
      },
      setPos: (px: number, py: number) => {
        lx = px; ly = py;
        applyAt(px, py);
      },
      setVolume: (v: number) => {
        // ★清偿刀 A：上钳 1→10——ActiveSound.Volume 原文无钳（ActiveSound.cs:15 裸
        //  字段,数值钳在 DetermineIntendedVolume 终口=上方 applyAt）,AI_195/205 引擎
        //  轨 Volume=num4（0..100 档）透传需要 >1 域;既有 0..1 消费者逐值不变。
        vmul = Math.max(0, Math.min(10, v));
        applyAt(lx, ly);
      },
      // ★清偿刀 A：ActiveSound.Update 逐帧 `Sound.Pitch = Pitch`（ActiveSound.cs:140,
      //  绝对覆写语义）——AI_195/205 引擎轨 Pitch = Clamp(Remap(推力档,0,100,−1,1)
      //  + bump, −1, 1)（Projectile.cs:41711/:39001）;XNA Pitch → 播放率 2^pitch。
      setPitch: (p: number) => {
        src.playbackRate.value = 2 ** p;
      },
    };
  }

  /** ★BJ728-A（债1,BJ715-A D-⑤S 清偿）：跟踪式一次性音（SoundEngine.PlayTrackedSound
   *  一次性档——枯萎兽灵气脉冲 DD2_WitherBeastAuraPulse，NPC.cs:64084-64094）。
   *  每次调用在变体组内随机取一（LegacySoundStyle.Style getter=Random.Next(_style,
   *  _style+Variations) 每播重掷，LegacySoundStyle.cs:24-29）非循环播放；返回句柄
   *  {done, stop, setPos}——onended 置 done+断节点（ActiveSound 槽随播毕释放,
   *  GetActiveSound 转 null 同语义——调用方下拍判 done 即重触发，重触发节拍=音长
   *  本身 2.3/3.0s 两变体交替）；setPos 刷新距离衰减/声像（在播实例
   *  activeSound.Position=Center 跟随，:64093）。音量=调用方传值（CreateTrackable
   *  无 WithVolume → SoundStyle 缺省 1，SoundStyle.cs:35；本文件 FILE_CASE_VOL/
   *  PITCH_CASE 均无该族档=不乘不抖，与原版一致）。缓冲未就绪返回 null（后台懒加载
   *  已触发，调用方下拍重试——GetActiveSound 空重播同语义）。
   *  ★禁 startTrackedLoop 近似顶替（BJ715-A 备案：loop=true 丢变体随机+无重触发
   *  节拍=反模式⑧）；反向同理，循环语义勿用本函数。 */
  startTrackedOneShot(files: string[], vol: number, x: number, y: number): {
    readonly done: boolean; stop(): void; setPos(px: number, py: number): void;
  } | null {
    if (this.suppress) return null;          // 载入期静音门（同 startTrackedLoop）
    if (!files.length) return null;
    const file = files[Math.floor(Math.random() * files.length)];   // 每播随机变体
    const ctx = this.ensure();
    if (!ctx) return null;
    const buf = this.ensureBuffer(file);
    if (!buf) return null;                   // 未就绪静默，下拍重试
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitchRateFor(file);
    const g = ctx.createGain();
    // 终钳 min(1,·)=原版 DetermineIntendedVolume 终口 Clamp(num,0,1)（ActiveSound.cs:160,
    // 同 startTrackedLoop applyAt 清偿刀 A 判据）
    const applyAt = (px: number, py: number) => {
      g.gain.value = Math.min(1, this.atten(vol, px, py) * this.master);
      if (panner) panner.pan.value = this.panOf(px, py);
    };
    g.gain.value = Math.min(1, this.atten(vol, x, y) * this.master);
    src.connect(g);
    // 声像（原版跟踪轨每次重设 Pan 同语义；`panner` 下方声明,applyAt 仅句柄返回后调用）
    let panner: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.value = this.panOf(x, y);
      g.connect(panner);
      panner.connect(ctx.destination);
    } else {
      g.connect(ctx.destination);
    }
    let done = false;
    src.onended = () => { done = true; g.disconnect(); panner?.disconnect(); };
    src.start();
    // 触发面事件（与 playWavFile 同形；实际出声=同步起振故 o='ok'）
    this.emit('wav', {
      f: file, v: Math.round(vol * 1000) / 1000,
      x: Math.round(x), y: Math.round(y), o: 'ok',
    });
    return {
      get done() { return done; },
      stop: () => { try { src.stop(); } catch { /* 已停 */ } },
      setPos: (px: number, py: number) => applyAt(px, py),
    };
  }

  // ---- 环境循环轨（SoundEngine.PlayTrackedSound 语义：常驻节点 + 音量平滑跟随）----

  /** 异步取缓冲（单一加载管线：ensureBuffer 同步面 / deferPlay 首播补播 /
   *  循环轨"缓冲就绪后再起振"共用；bufferPromises 去重防并发重复 fetch）。
   *  资源包覆盖优先于 fetch（与 ensureBuffer 同语义）。 */
  private ensureBufferAsync(file: string, ctx: AudioContext): Promise<AudioBuffer | null> {
    const hit = this.buffers.get(file);
    if (hit) return Promise.resolve(hit);
    if (this.failedFresh(file)) return Promise.resolve(null);
    const pending = this.bufferPromises.get(file);
    if (pending) return pending;
    const p = (async () => {
      try {
        const override = packSoundOverrides.get(file);
        if (override) {
          const decoded = await ctx.decodeAudioData(override.slice().buffer).catch(() => null);
          if (decoded) { this.buffers.set(file, decoded); this.failed.delete(file); this.failedAt.delete(file); return decoded; }
          // ★材质包坏键回退原版(2026-10-12):旧=markFailed 静默——包内一根坏键
          //  吃掉原版声(用户实报受击全哑)。改为落穿下方 opus/mp3 原版 fetch,
          //  双失败才负缓存。坏包诊断仍可经 DebugReport(rejectedBlank 同族)。
        }
        // ★双格式回退(2026-09-04 Opus 兼容报告定案):.opus 主(Safari 桌面全系
        //  对 Ogg Opus 的 decodeAudioData 仍"部分支持")→ decode 失败/404 →
        //  .mp3 回退(wav→mp3 96k,全兼容,体积仅原 1/10)。双失败 → 15s 负缓存。
        for (const ext of ['opus', 'mp3'] as const) {
          try {
            const r = await fetch(`sounds/${file}.${ext}`);
            if (!r.ok) continue;                     // 404 → 下一格式
            const decoded = await ctx.decodeAudioData(await r.arrayBuffer()).catch(() => null);
            if (decoded) {
              this.buffers.set(file, decoded);
              this.failed.delete(file); this.failedAt.delete(file);
              return decoded;
            }
            // decode 失败(该浏览器不支持此编码)→ 下一格式
          } catch { /* 网络瞬态 → 下一格式 */ }
        }
        this.markFailed(file);
        return null;
      } catch {
        this.markFailed(file);
        return null;
      } finally {
        this.bufferPromises.delete(file);
      }
    })();
    this.bufferPromises.set(file, p);
    return p;
  }

  /** 循环轨底层（任意 wav 文件 + 外部基础音量 + 可选 XNA Pitch）；缓冲未就位时句柄先行返回，
   *  解码完成后自动起振——调用方无需重试。pitch 语义与 startBuffer 同款
   *  （SoundEffectInstance.Pitch -1..1，频率倍率 2^pitch；显式直传跳过 PITCH_CASE） */
  private startLoopFile(file: string, vol: number, base: number, pitch?: number): SfxLoop | null {
    const ctx = this.ensure();
    if (!ctx) return null;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const st = {
      src: null as AudioBufferSourceNode | null,
      vol: Math.max(0, Math.min(1, vol)),
      base,
      rate: pitchRateFor(file, pitch),
      started: false,
      stopped: false,
      failed: false,
    };
    const apply = () => {
      // 循环轨同款音轨分派（ActiveSound.cs:150-153 SoundType.Ambient → ambientVolume）
      // ×失焦环境静音因子（QuietAmbientSounds :109；MP 豁免时环境循环轨归零）
      const target = Math.min(1, st.vol * st.base * trackVolumeFor(file, this.ambient * this.ambientQuiet(), this.master));
      gain.gain.setTargetAtTime(target, ctx.currentTime, 0.2);
    };
    const handle: SfxLoop = {
      stop: () => {
        if (st.stopped) return;
        st.stopped = true;
        if (st.started) this.emit('loopX', { f: file });   // 实起过的轨才记停
        try { st.src?.stop(); } catch { /* 已停 */ }
        st.src?.disconnect();
        gain.disconnect();
      },
      setVolume: (v: number) => {
        st.vol = Math.max(0, Math.min(1, v));
        if (st.started && !st.stopped) apply();
      },
      get playing() { return st.started && !st.stopped; },
      get dead() { return st.stopped || st.failed; },
    };
    void this.ensureBufferAsync(file, ctx).then((buf) => {
      if (st.stopped) return;
      if (!buf) { st.failed = true; gain.disconnect(); this.emit('loopF', { f: file }); return; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      applyLoopBounds(src, buf);            // ★BJ74 循环终点内收（Chromium 回绕缺陷,见函数注）
      if (st.rate !== 1) src.playbackRate.value = st.rate;
      src.connect(gain);
      src.start();
      st.src = src;
      st.started = true;
      apply();
      this.emit('loop', { f: file, v: st.vol, b: base });   // 实际起振（解码完成时刻）
    });
    return handle;
  }

  /**
   * 环境循环轨播放（SoundEngine.PlayTrackedSound 语义）：返回常驻句柄，
   * 音量经 setVolume 每帧跟随（天气状态机驱动）。默认音量 0.3（不吵）。
   * 无素材轨（如 sandstormWind）返回 null——调用方跳过即可，无需重试。
   */
  playLoop(name: WeatherLoopName, vol = 0.3): SfxLoop | null {
    const list = WAV_MAP[name];
    if (!list || !list.length) return null;
    return this.startLoopFile(list[0], vol, LOOP_BASE_VOL[name]);
  }

  /** 按文件名播放循环（瀑布/岩浆跟踪循环等；pitch = XNA Pitch，case34 瀑布 −0.2） */
  playLoopFile(file: string, vol = 0.3, base = 1, pitch?: number): SfxLoop | null {
    return this.startLoopFile(file, vol, base, pitch);
  }

  /** 缓冲起振（playWavFile 即时路径与 deferPlay 补播共用的出声单点）：
   *  音高（PITCH_CASE 逐类型档,pitch 直传跳过）+ 音轨分派（LegacySoundPlayer.cs:420-429：
   *  ambient 成员 ×ambientVolume，其余 ×soundVolume(master)——替换而非叠加）+ 声像 +
   *  单实例占槽（onended=自然播完/stop 均触发,清槽后可重播）。★R26：Item_N 全体
   *  入槽（SoundInstanceItem[num] 每播重绑——例外组旧实例不 stop 自然播完但槽已换绑,
   *  下一次 default 组播放只停最新绑定的那个,:604-615 语义保真） */
  private startBuffer(file: string, buf: AudioBuffer, vol: number, pitch?: number, pan = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitchRateFor(file, pitch);
    const g = ctx.createGain();
    // ×失焦环境静音因子（QuietAmbientSounds :109 → LegacySoundPlayer.cs:422 同位——
    //   走 ambient 轨的一次性环境族在失焦 MP 期归零；非 ambient 轨吃 master 不受影响）
    g.gain.value = Math.min(1, vol * trackVolumeFor(file, this.ambient * this.ambientQuiet(), this.master));
    src.connect(g);
    connectPan(ctx, g, pan);
    src.start();
    if (Sfx.slotAction(file) !== 'none') {
      this.singlePlaying.set(file, src);
      src.onended = () => {
        if (this.singlePlaying.get(file) === src) this.singlePlaying.delete(file);
      };
    }
  }

  /** 首播补播（首声不丢，2026-08-21）：本次触发未命中缓存→ensureBuffer 已触发
   *  后台加载，解码完成后按原触发参数补播一次。门/互斥在补播时点重判
   *  （suppress 置位后排队的补播被拦——与即时路径同一门语义）；ctx 仍 suspended
   *  则挂 resume 后起振。加载失败（负缓存）则本次保持静默，后续触发经
   *  playWavFile false 走合成兜底（WAV_MAP 全 98 文件在盘，实际不达）。
   *  ★R26：互斥重判扩为三组槽语义——skip 组在播丢弃;stop 组先停旧实例再补播
   *  （连发首拍未命中缓存、第二拍已命中并播出的场景,槽序与即时路径一致）。 */
  private deferPlay(file: string, ctx: AudioContext, vol: number, x: number | undefined, y: number | undefined, pitch: number | undefined, replace: boolean | undefined): void {
    void this.ensureBufferAsync(file, ctx).then((buf) => {
      if (!buf || this.suppress) return;
      if (!replace) {
        const act = Sfx.slotAction(file);
        if (act === 'skip') {
          if (this.singlePlaying.has(file)) return;
          if (this.siblingBlocked(file)) return;   // ★BJ289 case 19 Splash_4/5 兄弟互斥
        }
        if (act === 'stop') this.stopSingleSlot(file);
      }
      const fire = () => {
        // 补播实际出声事件（与触发面 'wav'/o:q 成对）：v=终值音量
        // （衰减×FILE_CASE_VOL 已乘）——解码往返时长即触发 tick 与本事件 tick 差
        this.emit('out', { f: file, v: Math.round(vol * 1000) / 1000 });
        this.startBuffer(file, buf, vol, pitch, this.panOf(x, y));
      };
      if (ctx.state === 'suspended') void ctx.resume().then(fire, fire);
      else fire();
    });
  }

  /** 按文件名直播。返回值 = "有声可闻"：已即时播出，或未命中缓存但已排队
   *  deferPlay 补播（返回 true——调用方的合成兜底/通用 hit 回退不叠加出声）；
   *  仅硬失败返回 false：载入静音门 / 静音 / 无 AudioContext / 距离衰减归零 /
   *  负缓存命中（该文件已知加载失败）。
   *  vol 语义 = 原版 volumeScale（调用方传 1 = 原版默认）；原版各 case 的专属
   *  音量修正（FILE_CASE_VOL）在此单点统一乘，调用方无需手传修正系数。
   *  pitch = XNA SoundEffectInstance.Pitch（-1..1，频率倍率 2^pitch）——乐器族
   *  （Player.cs:45928 Main.musicPitch 直传 PlaySound 第 4 参）需要逐音符变调，
   *  传该参时跳过默认 ±0.08 抖动（音符音高是语义本体，不容扰动）。
   *  replace = case 36 ForceRoar 语义（:1312-1325 直接 CreateInstance 覆盖槽、
   *  旧实例在 _trackedInstances 里继续自然播完）——无视互斥每次都播、槽位换绑
   *  新实例（旧 onended 因槽已换绑不误删）。case 15 调用勿传（保持播着跳过） */
  playWavFile(file: string, vol = 1, x?: number, y?: number, pitch?: number, replace?: boolean): boolean {
    // ★R26 GAP-06:case 2 style 1 三变体轮换(LegacySoundPlayer.cs:556-563):
    // `num11=Main.rand.Next(3); num11==1→num=18; num11==2→num=19`——**随机**三选一
    // (非顺序轮换),近战挥砍嘶声 Item_1 有 2/3 概率换播 Item_18/Item_19。库层单点拦截:
    // 所有 PlaySound(2,1) 调用面(挥剑/投掷/回旋镖/链锤 UseSound…)统一轮换;后续音量/
    // 音高/槽互斥全按轮换后文件计(原版 num 重赋值后再建实例同序,PITCH/FILE 表已含 18/19)
    // 轮换前置到本层：trace 事件必须记轮换后的真文件（"挥砍音不对"的头号候选,录制面直接可见）
    if (file === 'Item_1') {
      const roll = Math.floor(Math.random() * 3);
      if (roll === 1) file = 'Item_18';
      else if (roll === 2) file = 'Item_19';
    }
    // 触发面事件（audio.sfx 通道）：一次触发一条、含结局码——出声本身由
    // deferPlay 的 'out' 记实际出声 tick（解码延迟可判）。o 语义：
    // ok=即时出声 / q=解码完成后补播 / sup=载入静音门 / skip=单实例在播跳过 /
    // mut=静音或无 AudioContext / att=距离衰减归零 / fail=负缓存（合成兜底在即）
    // ★未挂钩时零分配（dig 高频路径,载荷仅在钩存在时构造）
    const oc = this.playWavFileCore(file, vol, x, y, pitch, replace);
    this.lastTriggerOutcome = oc;   // ★BJ289：play() 合成回退判据（同步窗口,见字段注）
    if (Sfx.onEvent) {
      this.emit('wav', {
        f: file,
        v: Math.round(vol * 1000) / 1000,
        ...(x != null && y != null ? { x: Math.round(x), y: Math.round(y) } : {}),
        o: oc,
        ...(replace ? { rep: 1 } : {}),
      });
    }
    return oc === 'ok' || oc === 'q';
  }

  /** 播放决策主体（playWavFile 抽壳为录制让路）：返回结局码（原 early-return
   *  逐分支改 return 值——门序/互斥/衰减/负缓存/补播语义逐行不变） */
  private playWavFileCore(file: string, vol: number, x: number | undefined, y: number | undefined, pitch: number | undefined, replace: boolean | undefined): 'ok' | 'q' | 'sup' | 'skip' | 'mut' | 'att' | 'fail' {
    if (this.suppress) return 'sup';         // 载入期静音门（见字段注释）
    // 单实例互斥(R26 GAP-05 扩为三组:skip 在播跳过 / stop 先停旧实例再播 / none 自由叠响;
    // 见 slotAction 注释——case 15 Roar 维持 skip、case36 replace 豁免一切)
    if (!replace) {
      const act = Sfx.slotAction(file);
      if (act === 'skip') {
        if (this.singlePlaying.has(file)) return 'skip';
        if (this.siblingBlocked(file)) return 'skip';   // ★BJ289 case 19 Splash_4/5 兄弟互斥
      }
      if (act === 'stop') this.stopSingleSlot(file);
    }
    const ctx = this.ensure();
    if (!ctx) return 'mut';
    const v = this.atten(vol, x, y);
    if (v <= 0) return 'att';
    vol = v * (FILE_CASE_VOL[file] ?? 1);
    const buf = this.ensureBuffer(file);
    if (!buf) {
      if (this.failedFresh(file)) return 'fail';   // 负缓存窗口内→合成兜底（过期自动重载）
      this.deferPlay(file, ctx, vol, x, y, pitch, replace);   // ★首播不丢
      return 'q';
    }
    this.startBuffer(file, buf, vol, pitch, this.panOf(x, y));
    return 'ok';
  }

  play(name: SfxName, vol = 1, x?: number, y?: number) {
    if (this.suppress) return;               // 载入期静音门（见字段注释）
    // 优先原版素材，失败回退合成（master 在 playWavFile/osc 各自生效一次）。
    // 带坐标时衰减（atten），≤0 直接不播——合成回退也不触发
    if (x != null && y != null && this.atten(vol, x, y) <= 0) return;
    this.lastTriggerOutcome = null;          // 先清后读（playWav 未触达 playWavFile 时防陈旧值）
    if (this.playWav(name, vol, x, y)) return;
    if (this.lastTriggerOutcome === 'skip') return;   // ★BJ289：在播跳过=原版无声,勿落合成兜底补近似音
    const ctx = this.ensure();
    if (!ctx) return;
    // 合成兜底实际出声事件：仅 wav 面 fail/缺档才达此路径——听感是"近似音"
    // 而非原版素材的直接证据（"音效不对"排查首选过滤器 k==='syn'）
    this.emit('syn', { n: name });
    const t = ctx.currentTime;
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + delay + dur);
      g.gain.setValueAtTime(vol * this.master, t + delay);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t + delay);
      o.stop(t + delay + dur);
    };
    switch (name) {
      case 'hit': osc('square', 320, 110, 0.09, 0.12); break;
      case 'chop': osc('triangle', 220, 80, 0.12, 0.16); break;
      case 'hurt': osc('sawtooth', 180, 60, 0.22, 0.14); break;
      case 'killed': osc('square', 260, 60, 0.25, 0.14); break;
      case 'pkilled': osc('sawtooth', 160, 40, 0.6, 0.18); break;
      case 'zombie': osc('sawtooth', 90, 55, 0.5, 0.1); break;
      case 'roar': osc('sawtooth', 70, 40, 0.9, 0.2); break;
      case 'eowDig': osc('square', 120, 70, 0.12, 0.08); break;   // 缺文件兜底(实体在库)
      case 'pickup': osc('sine', 520, 990, 0.09, 0.1); osc('sine', 780, 1320, 0.08, 0.06, 0.05); break;
      case 'dig': osc('square', 140, 90, 0.05, 0.06); break;
      case 'tink': osc('sine', 900, 500, 0.06, 0.08); break;
      case 'place': osc('triangle', 260, 120, 0.08, 0.12); break;
      case 'drink': osc('sine', 300, 620, 0.06, 0.08); osc('sine', 420, 780, 0.06, 0.07, 0.07); osc('sine', 560, 940, 0.06, 0.06, 0.14); break;
      case 'splash': osc('sine', 700, 200, 0.18, 0.1); break;
      case 'summon': {
        // 召唤杖 UseSound(Item_44)近似:短促"噗"——高频下扫正弦 + 一撮噪声气声
        osc('sine', 900, 260, 0.16, 0.14);
        osc('triangle', 1400, 500, 0.08, 0.06);
        break;
      }
      case 'whipCrack': {
        // 鞭响(Item_152)近似:高频噪声急促炸开 + 快速衰减
        const wDur = 0.12, wn = Math.floor(ctx.sampleRate * wDur);
        const wBuf = ctx.createBuffer(1, wn, ctx.sampleRate);
        const wd = wBuf.getChannelData(0);
        for (let i = 0; i < wn; i++) wd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / wn, 3);
        const wSrc = ctx.createBufferSource();
        wSrc.buffer = wBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1200;
        const wg = ctx.createGain();
        wg.gain.value = 0.18 * this.master;
        wSrc.connect(hp).connect(wg).connect(ctx.destination);
        wSrc.start(t);
        break;
      }
      case 'explosion': {
        // 噪声爆发近似(原版 Item_14):一次性白噪 buffer + 低频 thump。
        // ★曾无此分支:按需加载首播(wav 还在 fetch)完全静音 = "炸弹没有音效"主因
        const dur = 0.5, n = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(120, t + dur);
        const g = ctx.createGain();
        g.gain.value = 0.5 * this.master;
        src.connect(lp).connect(g).connect(ctx.destination);
        src.start(t);
        osc('sine', 90, 35, 0.35, 0.35); // 低频冲击
        break;
      }
      case 'coin': osc('sine', 990, 1400, 0.07, 0.08); osc('sine', 1320, 1760, 0.09, 0.06, 0.05); break;
      case 'door_open': osc('triangle', 180, 320, 0.12, 0.1); break;
      case 'door_close': osc('triangle', 320, 160, 0.1, 0.1); break;
      case 'shatter': osc('square', 1400, 300, 0.15, 0.1); break;
      case 'drown': osc('sine', 400, 90, 0.4, 0.1); break;
      case 'mirror': osc('sine', 700, 1900, 0.3, 0.06); osc('sine', 1400, 2800, 0.25, 0.04, 0.1); break;   // 魔镜闪烁上行
      case 'conch': osc('sine', 220, 330, 0.25, 0.08); osc('sine', 330, 440, 0.3, 0.06, 0.2); break;        // 海螺低鸣
      case 'item8': osc('sine', 180, 620, 0.28, 0.07); break;   // ★SW-RB10a：Item8 传送嗖声合成兜底
    }
  }
}
