// 多人联机共享协议层（客户端与 Node 服务器共用，docs/multiplayer-design.md §1-2）。
// 帧格式对齐原版：[u16 len][u8 msgId][payload...]，小端，包上限 65535B。
// 消息 ID 尽量沿用原版 MessageID 编号（Hello=1/SLOT=3/WorldData=7/TileSection=10/
// PlayerSpawn=12/PlayerControls=13/TileManipulation=17/SetTime=18/NetModules=82/Ping=154）；
// 编码字段为本仓库简化集（protoVer 门禁——当前版本号以 PROTO_VER 常量为唯一真值,
// 演进史见其注释；曾在此硬编码「当前 v6」与常量漂移脱节，已移除字面量，二轮 FR5-F）。

export const PROTO_MAGIC = 'SW1';
/** v2：msg13 对齐原版 PlayerControls 布局（控制位+position+velocity）。
 *  v3：实体同步族（msg16/21/23/27/42）+ 箱子权威（msg31/32）+ sessionToken 重连
 *  v4：msg23 S→C 短码格式（key 每次全量→codeId 短码+按需全量）+ RoomPolicy 尾部 u16 maxPlayers
 *  v5：msg27 kind 高位 bit7=hostile（原版 Projectile.hostile 位——访客端据此对敌对弹幕
 *      傀儡本地结算 Damage_EVP；服务器剥除非房主置位）
 *  v6：msg27 kind 5-8（锚定 Boss 的自包含弹体：DukeSharknadoBolt/龙卷/MLDeathray/LunarOrb，
 *      tag 打包锚参数，访客重建真类本地跑确定性 AI）+ msg28 弹幕消亡上报（消幽灵弹窗口）+
 *      msg201 SSC 角色档下发（--ssc）。server 与 game 同仓库同时发布，不做向后兼容
 *  v7：PvP——msg13 flagBits[7]=hostile + 尾部 u8 team(0-5)；RoomPolicy 尾部 u8 pvpAllowed；
 *      msg44 StrikePlayer（近战 PvP 命中意向，被打方本地结算 HP——客户端权威模型）
 *  2026-08-30 批（增量通道，不升版——同 SpectateFocus=150 / NetModule 先例纪律：
 *      升版会踢掉在跑的旧 server 进程；两路均向后兼容，见各条目注释的降级矩阵）：
 *    a) msg16 PlayerLifeMana 再追加尾段 [i16 pvpImmuneRemaining]——被击端 PvP 免疫
 *       余量 tick 镜像（攻端 ItemCheck_MeleeHitPVP 门禁串含 player.immune 的
 *       victim-settles 等价位）。旧 server 只读已知段后重打包 → 免疫尾被剥 =
 *       接收端缺省 0（不拦 = 改动前行为）；新 server 结构透传。
 *    b) 新增 msg117 PlayerHurt（原版 MessageID.PlayerHurtV2 同号）：被击端实扣后
 *       的权威飘字/暴击广播帧。旧端 default 忽略未知号 = 看不到飘字，零影响。
 *  2026-08-31 批（增量通道，不升版——同上先例纪律）：
 *    c) msg27 kind=9 SparkleGuitarProj 真类重建支（分派序前置，弹 856 星璇之音）。
 *       降级矩阵：新端发 → 旧 server（白名单 (kind&0x3f)>8）剥条 / 旧 client switch
 *       落空建不出傀儡 = 弹体不显影，无崩溃无行为毒化；旧端发 → 新 client 结算面
 *       按 projId===856 在 netPuppetProjContact 归一（视线门豁免/crit 不掷/浸剂
 *       neither/×0.75 结算惩罚全按弹真值），故 kind9 主改的是【真类重建+盒尺寸
 *       32×32+贴图渲染】非结算正确性。
 *    d) msg27 aux 高位段（位 4-11）语义升级（不升版、不改线格式——GA4 同字段换
 *       真值口径，★ε#3）：携值由「base4+装备链」升级为含**持械 item.crit（词缀
 *       crt 已折入,Item.cs:585）**的 meleeCrit 完整终值——原版 Player.Update
 *       :25712-714 每帧 `meleeCrit += inventory[selectedItem].crit` 无条件跨系别
 *       加算,此前快照漏项致 PvP 暴击率跨端偏低 ≤20pp。双向降级矩阵：
 *       新端发→旧端收 = 旧端照常 (aux>>4)&255 读到即新终值（自动变准）；
 *       旧端发→新端收 = 缺持械加成＝旧行为不变。低 4 位浸剂段不动。
 *    e) msg27 kind=9（星璇之音）aux 启用为旋转相位 t01 千分位量化（不升版——
 *       kind9 支此前恒发 0,无共用面）：★FR5-F 傀儡 draw 读 private localAI[0] 而
 *       快照通道不携相位 → 远端恒静态角。发送端每快照携 round(t01×1000)；
 *       收端到包重锚 + 快照间隔内本地 +3/tick 等速自推进（发端 extraUpdates=2
 *       ⇒ 每 tick 三子步 AI）。降级：旧收端忽略 aux=旧静态角行为；旧发端 aux=0
 *       对新收端 = 相位钉 0（同旧行为）。弃 seen→tickCount 自推相位案：tickCount
 *       为各端自会话起点计数,跨端零对齐保证（裁决备案）。
 *    f) msg117 dir/srcX 语义钉死（★FR3-F 三轮蓝队，纯注释不改线格式）：
 *       srcX 锚点全站统一为【伤害源中心 x 世界 px】；dir ∈ {−1,+1}=击退向,
 *       0=零击退/未定义——狱火光环（原版 hitDirection=0 :10348）/圣骑士盾转移
 *       （:37751 同式）按原文传 0,近战类=攻端 facing 字段（:44434/:44491,非位置
 *       符号推算）。⚠ 当前接收端不消费 dir（Game.onPlayerHurt 形参 _dir 弃用），
 *       改造消费面前勿把 0 当「缺省未定」重新编码成 ±1——会放大成假击退。
 *    g) msg16 PlayerLifeMana 再追加尾段 [u16 pvpDefenseMirror]（★F14 甲虫 MP 记账
 *       BLOCKER 收敛,2026-08-31 清零批四）：statDefense 终值镜像——F14 定谳 vanilla
 *       近战 PvP 甲虫蓄能入账值【不是】被击者实扣 HP，而是攻击机 Hurt 返回段重算的
 *       CalculateDamagePlayersTakeInPVP(num×(crit?2:1), statDefense)（Player.cs:
 *       38864-38868 + Main.cs:67136-67143,num=DamageVar 卷终伤,crit 在 :38533-35
 *       先折乘）；该式所需唯一攻击机不可知输入 = 受方 statDefense → 以 msg16
 *       尾段随被击端「hp 变化包」上行镜像。语义位次=原版攻击机 Main.player[远端]
 *       .statDefense 本地代理（其同步链同样滞后一个状态批次）——镜像新鲜度与
 *       原版同层而非更劣：结算强制位 notifyPlayerHurtSettled 保证命中瞬间一帧内
 *       必有该目标的新鲜 hp 包在途。降级矩阵：新 client 发 → 旧 server 只读已知段
 *       重打包剥此尾 = 对端镜像缺省 null → 收包侧保守弃账（不虚增,见 ClientNet
 *       消费门注释）；旧 client/新 server 同理；解析为位置序容错读（remaining 门）
 *       与 a) 免疫余量尾段同构,不动既有序。
 *    h) msg117 flags 新增 bit2=MeleeSource（★F-1 四轮蓝队,2026-08-31 增量通道,
 *       不升版不改线格式——flags 本为 u8 位域,bit2 在同号帧内只做加位）：
 *       【melee-source 来源标记】,仅 Game 近战 PvP 支（ItemCheck_MeleeHitPVP 同构位
 *       :2899 的 reportPlayerHurt 调用）置位。缘由=msg117 不携伤害来源身份,而
 *       vanilla 全部五条 PvP 结算支中【只有近战支】给任何人记甲虫蓄能
 *       （beetleCounter += num2 / beetleCountdown = 0,Player.cs:44456-44460——
 *       另一处入账在 PvE 近战支 :44826-44828;爆炸 bit7/狱火 bit6/盾转移 bit5/
 *       PvP 弹四支均无）→ 接收端甲虫回执 FIFO 消费门必须按来源分支分账,否则
 *       「目标被狱火跳伤/被第三方弹幕命中」会抽走攻击端未决挥击造成错配充能。
 *       降级矩阵（双向）：新 client 发 → 旧 server readPlayerHurt/writePlayerHurt
 *       整字节透传 flags → 旧 client 仅读 bit0/bit1 = 飘字样式不受影响;
 *       旧 client 发 → flags 无 bit2 → 新收端不抽队不充能 = 甲虫少记账（保守
 *       欠计方向——宁可漏记不可把他人伤记进自己壳,与⑤TTL 弃账同向）。
 *    i) ★B1 钳位纯度批（2026-08-31,纯数值面裁决,不改线格式不升版）：全族 dmg 字段
 *       的原版语义 =【short 直写回绕】(SendData case 117 writer.Write((short)number2,
 *       NetMessage.cs:1447;读侧 ReadInt16 后零改写直入 Hurt,MessageBuffer.cs:3888/
 *       3894)。msg117 写层自造 min(9999) 移除(protocol.writePlayerHurt,同 F-3①
 *       notePendingMeleeHit 先例「自设帽=新发明近似」);msg27 中继 dmg 钳移除=纯透传
 *       (原版弹幕快照案 MessageBuffer.cs:1701+1744 读值即赋、TrySendData 复播零改写;
 *       "超高 dmg 秒杀访客"攻击面已由 hostile 剥除墙 + v7 InOpposingTeam/victim-settles
 *       双门禁消化,见 room.ts 该处注)。msg42/44 服务器上帽【保留】但定性改挂「策略层
 *       (滥用治理)」与协议语义切割：其结算面是本仓 client-authority 模型独有的访客直报
 *       伤害通道(原版 NPC/PvP 伤害均在服务器本地计算,无此暴露面),帽是安全网不是线格式
 *       契约。双向兼容矩阵：新端发 short 回绕帧 → 旧 server 中继仍钳 ≤9999(msg42/44
 *       老进程) = 高伤意向被剥到 9999,展示/意向欠额,无崩溃无错账;新 server 透传 × 旧
 *       client 自钳写 ≥9999 封顶输入 = 矩阵退化为恒等;回绕域仅由脏输入可达,接收端按
 *       各自合约清洗（msg117 脏帧整拒,msg44 由被击端本地门禁兜底）。Game.
 *       reportNonPvpPlayerHurt 上游 min(9999)(:2786) 在 Game.ts 属权外未动——实扣
 *       ≤maxHp 下永不绑定,残余为恒等路径。
 *    j) ★SW-AM1 2026-09-05（爆炸远端半边值同步,不升版不改线格式——msg44 flags 同
 *       字节位域按支割离复用,同 d)/h) 先例）：bit7 爆炸支内 bit1=dmgPreRolled——
 *       rawDmg 语义升级为【发送侧已掷终值】（SelfHurtPlayers :15118 DV+:15119-15122
 *       sweater cap 在爆炸端算毕,被炸端直读不再掷）。
 *       SW-AM2 2026-09-05（蓝F4）定性降格：vanilla 炸弹对玩家的伤是【两张脸】——
 *       SelfHurtPlayers :15104-15152（各端只结算本地玩家、本机 fresh luck
 *       :15107/:15118,无跨端同步）与 Damage_PVP :14637-14785（owner==myPlayer
 *       结算【其他 hostile 玩家】,:14718 owner 掷 → :14747 SendPlayerHurt 携掷后
 *       值=原生值同步,pvp:true 字面 :14748）。本仓 bit1 预掷终值的定性=
 *       借用 Damage_PVP 式"掷后下行"形制的【值同步策略选择】:bit7 面混载两类
 *       受击（PvP 掷弹伤/接线炸药伤）,与任一原版单脸都不完全同构,勿以单脸
 *       论证其同构性。
 *       位域论证（蓝F6）：bit7 帧现恒带 bit1（dmgPreRolled）,与 bits1-4 enchant
 *       域零撞位的性质=收端位序——Game.netApplyStrikePlayer 的 bit7 分支先于
 *       bits1-4 消费并 return（bit1 在该分支内读作 dmgPreRolled,不再下落）,
 *       enchant 域 (flags>>1)&15 仅近战支消费。服务器 room.ts flags 整字节透传,
 *       新旧 server 零改动。降级矩阵：旧发端（无位）→
 *       新收端=基伤本地掷（=改动前行为,逐位）;新发端→旧收端=对已掷值再掷（±15%
 *       重卷,有界漂移,无权威/崩溃面）。
 *    k) ★X4 清偿刀D（2026-09-29,MP netCameraTarget 面,增量通道不升版不改既有序）：
 *       msg13 flagBits[5]=hasCameraTarget + 帧尾追加 [f32 camX, f32 camY]（世界 px,
 *       位置序恒跟在 v7 team 段后）。原版锚=netCameraTarget 是原版 msg13
 *       （PlayerUpdate）第 4 控制字节 bitsByte24[5] 位 + 条件尾随 Vector2
 *       （NetMessage.cs:487/:507-509 写,MessageBuffer.cs:1049 读）;本仓 flag 字节为
 *       bitsByte22/24/26 合并字节,取空闲 bit5 与原版 [5] 位同位呼应。发送面=
 *       相机目标（GetObjectTrackingCameraPan 三域:观战 Main.cs:63682-63687/无人机
 *       DroneCameraTracker.TryTracking :63692-63694/高尔夫 LocalGolfState
 *       :63696-63699）+ 发送门 HasValue 翻转∨位移>160px（Main.cs:63671-63676）。
 *       消费面=服务器实体 AOI 过滤中心（原版唯一读者 NPC.StreamUpdatesToNearbyPlayers
 *       的 ReportedCameraPosition=netCameraTarget??position,NPC.cs:91765/Player.cs:
 *       3896-3905——本仓等价位 room.ts msg23/27 逐接收端过滤）。降级矩阵（双向）：
 *       新 client 发 → 旧 server 读 team 后重打包剥尾,但 flag 位原样过墙 → 新收端
 *       remaining<8 拒读=camTarget null（AOI 退回 avatar 位=改动前行为,零崩溃）;
 *       旧 client 发 → 无位无段 → 新收端 null 同前;新 server 对旧帧零字节差
 *       （remaining 门读不到段=不重编码）。
 *    l) ★X4 清偿刀G（2026-09-29,MP 弹幕快照 1020/1105 面,增量通道不升版不改既有序）：
 *       msg27 kind=11（帕鲁机件 DroneBase 1020/1105——详 msg27 kind 表内注）。
 *       定谳锚=原版这两弹的 MP 语义【owner 权威输入+全端分布式物理】：owner 端
 *       LocalInputCache 打包入 ai[0]（Projectile.cs:41679-41687/:38794-38824）、变化
 *       即 netUpdate=true 走 Msg27（ai[0]/ai[1]+pos+vel,NetMessage.cs:777-828 写/
 *       MessageBuffer.cs:1701-1744 读 ai[] 直赋）;AI 本体在 owner 门【外】,非 owner
 *       端照跑（输入取自快照 ai[0]、姿态取自 ai[1]）——即「操控输入经快照同步+
 *       各端本地模拟」,非主机权威逐拍推流。本仓等价实现=kind11 真类重建+傀儡本地
 *       AI 照跑+ai0/rotation/位置随快照硬重锚（DroneProjs.ts netDroneSync）+
 *       输入翻转绕过位移差分门强制出快照（netProjLast.ai0 差分位）。两通道独立性
 *       定谳：netCameraTarget（msg13 注k）=服务器 AOI 过滤中心,让无人机飞出的画面
 *       仍在本端 AOI 视野内（否则服务器把弹幕快照滤掉）;kind11 快照=弹幕状态同步
 *       本体——AOI 为快照的【配送面】,快照为 AOI 视野内的【货】,互不承载。降级
 *       矩阵：新端发→旧 server 白名单（>10）剥条=该弹不显影零崩溃;旧 client 发→
 *       无此 kind 不产出;新 server 对旧 kind 零字节差。 */
export const PROTO_VER = 7;

/** 消息 ID（v1 实现范围；编号对齐原版 MessageID.cs） */
export const enum Msg {
  Hello = 1,          // C→S {magic, protoVer, name, hostToken 兜底}
  Kick = 2,           // S→C {reason}（原版 Kick/Disconnect 同号）
  PlayerSlot = 3,     // S→C {slot, sessionToken}（原版同号 PlayerInfo=3：名字/外观在原版
                      //   走此包，我们拆到 Hello+msg4——字段分布简化，ID 保留；
                      //   sessionToken 为重连凭据）
  SyncPlayer = 4,     // 双向 {slot, appearanceJson}
  SyncPlayerItem = 5, // C→S→广播（v2 对齐原版 msg5 SyncPlayerItem 语义，批量变体）：
                      //   {u8 count, entries[{u8 playerSlot(服务端覆写), u8 container,
                      //    u8 itemSlot, u16 itemId(0=空), u16 stack}]}
                      //   container: 0=slots[0..57] 1=armor[0..19] 2=dye[0..9]
  RequestWorldData = 6, // C→S {}
  WorldData = 7,      // S→C {时间/尺寸/出生点/层线/flags/seed/name}
  SpawnTileData = 8,  // C→S {x, y}（客户端请求出生点周围 section）
  StatusText = 9,     // S→C {count}（将发的 strip 数，进度条）
  TileSection = 10,   // S→C {x0,y0,w,h, rleBytes}（200×20 条带）
  PlayerSpawn = 12,   // S→C {slot, x, y}（进房落点确认）
  PlayerState = 13,   // C→S→广播（v2 对齐原版 msg13）：{u8 slot, u8 ctrlBits, u8 flagBits,
                      //   u8 selectedItem, f32 x, f32 y, [f32 vx, f32 vy 若 flagBits[2]]}
                      //   ctrlBits: [0]up [1]down [2]left [3]right [4]jump [5]useItem [6]direction
                      //   flagBits: [2]hasVelocity [5]hasCameraTarget(注k) [6]ghost(死亡) [7]hostile
                      //   尾段（位置序,均 remaining 门）：[u8 team 0-5（v7）]
                      //   [f32 camX, f32 camY 若 flagBits[5]（注k,netCameraTarget 面）]
                      //   position=碰撞盒左上（原版语义）
  PlayerActive = 14,  // S→C 广播 {slot, active, name}
  TileBatch = 17,     // C→S→广播 {count, ops[]}（tile 操作批量，对齐 msg17 语义）
  SetTime = 18,       // S→C {timeOfDay, dayCount}
  DoorEvent = 19,     // C→S→广播（原版 MessageID 同号 DoorOpen；NPC.cs:54398/54610）：
                      //   {u8 flags(bit0=closing bit1=gate), i32 x(门/闸锚格), i32 y, i8 dir}
                      //   仅 NPC 模拟端（房主/SimHost）发送；远端立即重放开闭动作+音效。
                      //   tile 终态仍由 TileBatch 权威收敛，本包只补「即时性」= 原版 msg19 语义
  // ---- v3 实体同步（房主权威 + 服务器中继；ID 对齐原版 MessageID.cs） ----
  PlayerLifeMana = 16, // 双向 {u8 slot, i16 hp, i16 maxHp}（原版同号：客户端权威 HP，服务器中继）
                       // 尾段（位置序容错,均 remaining 门）：[u16 deathsPve][u16 deathsPvp]
                       // [i16 mana][i16 maxMana][f32 luck][i16 pvpImmuneRemaining（2026-08-30 批）]
                       // [u16 pvpDefenseMirror（2026-08-31 ★F14 甲虫记账批,g) 注）]
  SyncItem = 21,       // 房主→广播 {u32 netId, u8 op(0=spawn/1=take/2=despawn), str key,
                       //   u16 stack, f32 x,y,vx,vy}（原版同号 SyncItem）
  SyncNPC = 23,        // C→S（房主上行）：{u16 count, [u32 netId, str key, f32 x,y,vx,vy,
                       //    i16 hp, i16 maxHp, u16 animT, u8 flags(bit0=boss)]}
                       //    [u16 anchorCount, [u32 netId, f32 ai1, f32 ai2]×anchorCount
                       //     （帧级尾段，≥1 条锚点才附——刺球 NPC 70 aiStyle 20 锚点）]}
                       // S→C（v4 短码+AOI 逐端过滤）：{u16 count, [u8 eflags, ...,
                       //    eflags.bit0=含 key 全量(u32 netId + u16 codeId + str key)
                       //             bit1=boss；否则仅 u16 codeId（客户端 codeId→netId/key 表）]}
                       //    [u16 aiCount, [u16 code, f32 ai1, f32 ai2]×aiCount（帧级尾段，
                       //    ≥1 条锚点才附）]
                       //  ★两向尾段都必须在条目循环【后】：条目定长推进的旧端（旧 server/
                       //  旧访客）读完 count 条即返回，帧尾残余永不被当下一条 netId/eflags
                       //  消费=零错位（旧端无长度校验，条目内携带=整批错位+越界读抛
                       //  RangeError 毒化 FrameParser）。尾段自身=唯一标记（无新增位），
                       //  上行按 netId、下行按 code 关联回填
  SyncProjectile = 27, // 双向（各自的弹幕互播，原版同号）：
                       //   {u16 count, [u32 netId, u8 kind, str tag, i16 dmg, i16 aux, f32 x,y,vx,vy]}
                       //   （kind 低 6 位（接收掩码 0x3f）: 0=Arrow 1=WeaponProj族 2=Dart 3=TrapShot
                       //    4=MagicProj
                       //    5=DukeSharknadoBolt 6=DukeSharknadoTornado 7=MLDeathray 8=LunarOrb（v6：
                       //    Boss 锚定弹体，tag 打包锚参数——见 Game.netProjBroadcast 各分支注释）
                       //    9=SparkleGuitarProj（2026-08-31 增量通道，真类重建纯视觉快照驱动；
                       //    曾落进 kind1 武器族支被收端 melee 化结算——二轮 FR3-F。降级矩阵：
                       //    新端发→旧 server 白名单剥条/旧 client switch 落空 = 该弹不显影，
                       //    零崩溃零误伤；旧端发→新端结算面按 projId===856 真值归一，见
                       //    Game.netPuppetProjContact isTune 支）；
                       //    10=RainCloudProj 移动云（2026-09-03 增量通道：tag=`projId,anchorX,
                       //    anchorY`、aux=击退×100——仅 237/243 过网，238/244/239/245 各端本地
                       //    AI 衍生勿过网防双生成；降级矩阵同 9=switch 落空该弹不显影零崩溃）
                       //    11=帕鲁机件双弹 DroneBase（★清偿刀G 2026-09-29 增量通道：1020
                       //    JimsDrone/1105 RemoteControlCar 真类重建+傀儡本地 AI 照跑——原版
                       //    MP 语义=owner 端输入字节打进 ai[0]、变化即 netUpdate=true
                       //    （Projectile.cs:41679-41687/:38794-38824）,Msg27 携 ai[0]/ai[1]
                       //    +pos+vel（NetMessage.cs:777-828/MessageBuffer.cs:1701-1744 ai[]
                       //    直赋）,全端 AI 本体照跑;localAI[0..2] 不同步各端自持。tag=
                       //    `projId,rotMilli`（ai[1] 千分位量化）、aux=ai0 输入字节（≙ai[0],
                       //    0..63）、不携 bit6/bit7（damage=0 无结算面）。降级矩阵同 9/10=
                       //    新端发→旧 server（白名单>10）剥条/旧 client switch 落空该弹不
                       //    显影零崩溃;旧端发→无此 kind 不产出）
                       //    12=ModProj（★2026-10-04 P4 mod 通道：tag=projId——确定性分配
                       //    （拓扑序+键字典序）双端同 mod 集合恒同 id→spec 在册重建傀儡
                       //    （快照跟随+寿命+spec.update 视觉钩,伤害/tile host 权威不本地
                       //    结算）;缺 mod/未注册=null 剥条降级（零崩溃）。中继白名单
                       //    (kind&0x3f)>12 剥条——server/room.ts 同批放宽 11→12）
                       //    bit7(0x80)=hostile——原版 Projectile.hostile，v5 起 kind0/2/3 携带
                       //    （服务器剥除非房主置位），访客端对 hostile 傀儡本地结算 Damage_EVP；
                       //    bit6(0x40)=pvp——v7 玩家 PvP 弹：pvpAllowed 房内 hostile 玩家的
                       //    kind0(友方)/1/4 弹幕携带，与 bit7 独立（NPC 敌弹≠玩家 PvP 弹，
                       //    前者无条件命中、后者须过 InOpposingTeam 门禁）
  ProjDespawn = 28,  // C→S→广播（v6）：{u16 count, [u32 netId]}——弹幕消亡上报，
                    //   各端对自己拥有的弹幕在消亡时批量上报，接收端即时移除傀儡
                    //   （替代纯 180t 超时清扫：消除幽灵弹窗口 + 消亡闪烁）
  RequestChestOpen = 31, // C→S {i32 x, i32 y}（箱子锚点；原版同号）
  SyncChestItem = 32,  // S→C 下发 / C→S 槽位编辑（原版同号 SyncChestItem）：
                       //   {u16 chestIdx, i32 x, i32 y, u16 count, [u8 slot, u16 itemId, u16 stack]}
  ChestOpenState = 33, // C→S（SW-FX42 在用箱面，原版同号 ChestOpen）：{i16 chestIdx(-1=关),
                       //   i32 x, i32 y[, u8 nameLen, [str name]（SW-FX52-R12 改名尾段）]}——
                       //   客户端开/关箱公告（原版 Player.OpenChest 尾
                       //   SendData(33, chestIdx, chestX, chestY, nameLen...)，
                       //   NetMessage.cs:880-902 + MessageBuffer.cs:1962-1977：服务器据
                       //   此更新 Main.player[whoAmI].chest 并广播 msg80）。原版载荷尾部
                       //   即箱名改名段（num24 nameLen+string,NetMessage.cs:895-905 写 /
                       //   MessageBuffer.cs:1928-1937 读）——SW-FX52 起服务器受理：改名段
                       //   施加于【发送者当前在用箱】（=原版 Main.player[whoAmI].chest,
                       //   非本帧 idx）并广播 msg69 ChestName。nameLen 语义 1:1 原版：
                       //   0=无改名;1..20=后随 str（20 字符钳=NetMessage.cs:899-903
                       //   len==0||len>20 → 255 不写名）;255=清名（原版收端 :1948-1952
                       //   num24!=0 即写 string.Empty 的同款面）;21..254 非原版产出=按
                       //   无名处理。★线格式差备案：本仓 x/y 为 i32（原版 i16）且改名段
                       //   在其后——字段宽度简化同 msg3 先例,ID 保留;旧 server 只读已知
                       //   段后忽略尾段,新 server×旧 client 尾段 remaining=0 = 无改名,
                       //   双向兼容。上行生产面=箱改名 UI（本仓未实装,UI.ts:9025 债）——
                       //   编解码/服务器受理面已通,生产面登记不越界
  ChestName = 69,      // S→C 广播（SW-FX52-R12 箱改名，原版同号 ChestName）：{i16 chestIdx,
                       //   i16 x, i16 y, str name}——写面 NetMessage.cs:1119-1126 1:1；
                       //   生产 = 服务器受理 msg33 改名段后 TrySendData(69,-1,whoAmI,...)
                       //   （MessageBuffer.cs:1969）广播给除改名者外全体。读面
                       //   MessageBuffer.cs:3053-3074（netMode==1 支）：idx∈[0,8000) 门 +
                       //   坐标不符丢弃（chest.x!=num8||chest.y!=num9 → break）；本仓
                       //   镜像进 ChestData.name（消费面=地图标签 Renderer.ts:2418-2423 /
                       //   悬停名 CursorItemIcon.ts:107 / 箱面板题 UI.ts:9023-9031）；
                       //   未开过箱的端无本地箱记录 → 忽略（原版 CreateWorldChest 造
                       //   仅坐标桩——本仓访客模型无预开箱记录,名随 chestFrame 尾段
                       //   开箱时刻补齐,行为收敛同点）
  ChestInUse = 80,     // S→C 广播（SW-FX42 在用箱面，原版同号）：{u8 slot, i16 chestIdx,
                       //   i32 x, i32 y}——每玩家在用箱镜像（原版 Main.player[slot].chest,
                       //   NetMessage.cs:1180-1184 写 / MessageBuffer.cs:3220-3231 读，
                       //   值域 -3..7999；本仓放宽 i16 且附 x,y 供拒绝匹配）。
                       //   生产位 = msg31 授予（MessageBuffer.cs:1878）/ msg33 换箱关旧开新
                       //   （:1972）/ 进场补发（NetMessage.cs:2924 SyncOnePlayer 捆包段）。
                       //   消费 = Chest.UsingChest（Chest.cs:492-503）服务器拒开门 + 客户端
                       //   镜像（Wiring.cs:2571/:2667 提纯机/抽取机在用门等未来消费面）
  StrikeNPC = 42,      // 访客→房主（服务器定向转发）{u32 netId, i16 dmg, f32 kbx, f32 kby}[u8 crit]
                       //   （原版 42=Unknown42：旧 StrikeNPC 槽位；注释曾误写 crit/kbDir/srcX/srcY——
                       //    实际线格式自 v3 起即为 dmg+击退两分量，2026-08 校正）
                       //   BJ723-B D5 清偿（BJ725-A）：尾部追加 u8 crit（C→S 直附;S→C 在 slot 后重排——
                       //    旧端 remaining>0 只吃 slot,残留 crit 字节被旧端忽略=双向优雅降级）
  StrikePlayer = 44,   // C→S→定向转发（v7 PvP）：C→S {u8 targetSlot, i16 rawDmg, i16 kbx, i16 kby,
                       //   u16 weaponId, u8 flags}；S→C 追加尾部 u8 fromSlot
                       //   （服务器回填发送方槽位——被打端 InOpposingTeam 门禁需要攻击者身份，
                       //   不信任客户端自报）。PvP 命中意向广播。
                       //   flags：bit0=crit / bits1-4=武器浸剂 meleeEnchant / bit5=圣骑士盾转移
                       //   （rawDmg=转移额,被击端独立冷却槽,死因 teamTank）/
                       //   bit6=狱火光环（rawDmg=20,被击端 per-owner 60t 冷却,死因 inferno）/
                       //   bit7=爆炸意向（explodeAt/scarabBombExplode 广播,任意房放行——
                       //   服务器 room.ts 仅 bit7 绕 pvpAllowed 门;rawDmg=意向伤）
                       //   ★SW-AM1 2026-09-05：bit7 支内 bit1 复用为 dmgPreRolled——
                       //   rawDmg=发送侧已掷终值（SelfHurtPlayers :15118 DV+:15119-15122
                       //   sweater cap 爆炸端算毕,收端直读不再掷）。
                       //   SW-AM2 2026-09-05（蓝F4）：定性=值同步策略选择,非原版单脸
                       //   同构——vanilla 炸弹对玩家的伤有两张脸（SelfHurtPlayers
                       //   :15104-15152 受害端自结算、本机 fresh luck;Damage_PVP
                       //   :14637-14785 owner 结算 PvP 伤、:14718 掷后 :14747 下行）,
                       //   bit7 面混载两类受击,预掷终值只是借用后者的形制。
                       //   位域论证（蓝F6）：bit7 帧恒带 bit1（dmgPreRolled）,与
                       //   bits1-4 enchant 域零撞位的性质=收端位序——bit7 分支先于
                       //   bits1-4 消费并 return（bit1 在该分支内读作 dmgPreRolled,
                       //   不再下落）,enchant 域 (flags>>1)&15 仅近战支消费
                       //   （同 msg27 kind bit7=hostile 先例）;服务器 flags 整字节
                       //   透传,新旧 server 均零改动。降级矩阵：旧发端（无位）→新收端=
                       //   基伤本地掷（=改动前行为逐位）;新发端→旧收端=对已掷值再掷（±15%
                       //   重卷有界漂移,无权威/崩溃面）。详见 PROTO_VER 注 j)
                       //   权威模型=被打方本地结算（与 msg16 客户端权威 HP 同构）：
                       //   攻击端只报意向，被打端过 InOpposingTeam 门禁后自行结算扣血，
                       //   伪造包最多影响显示、无法强制扣血。武器 id 供死因文案（DeathSource.Player）
  PlayerHurt = 117,    // C→S→广播（2026-08-30 批，原版 MessageID.PlayerHurtV2 同号）：
                       //   被击端实扣结算后的权威飘字帧（victim-settles 权威展示链）。
                       //   线格式 {u8 slot, i16 dmg, f32 x, f32 y, i8 dir, u8 flags}——
                       //   slot 服务器权威覆写为发送者（被击者本人,防冒名假飘字）、
                       //   dmg = 本地实扣值（hp 减量,含防御/endurance 链终值,与原版
                       //   CombatText 显示的 num2 同口径）、
                       //   x,y = 被击端受击锚点;srcX 语义（★FR3-F）=伤害源中心 x;
                       //   dir = 击退向 ±1（0=零击退形制：狱火/盾转移原文 hitDirection 0,
                       //   近战=攻端 facing——语义与「收端当前不消费」事实见 PROTO_VER 注 f）、
                       //   flags bit0=crit / bit1=pvp（原版 SendPlayerHurt bitsByte[0]/[1]
                       //   同义,NetMessage.cs:2615-2621）/ bit2=melee-source 标记
                       //   （★F-1,h) 注——仅近战支置位,收端甲虫回执消费门分账用;
                       //   bits3-7 前向保留）。
                       //   ★位域自查备案（F-1 兼容论证）：msg44 StrikePlayer 的
                       //   bits1-4=enchant 位域（enchant<<1 打包,收端 (flags>>1)&15）
                       //   属【另一条消息】的载荷域,msg117 无浸剂字段不存在撞位——
                       //   dmg 为独立 i16（非 flags 内打包位段）故 i16 安全区证明分支
                       //   无涉;bit2 在本帧 u8 内首个空位。原版接收端以 msg117 重放 Hurt
                       //   （MessageBuffer.cs:3882-3897：Hurt(quiet:true) → 音效+尘+飘字）；
                       //   本仓重放面只剩飘字 = 接收端 showPickupLabel 族 addDamageNumber
                       //   直出（Game 接线,见 ClientNet.onPlayerHurt 契约注）
  SpectateFocus = 150, // C→S {i16 targetSlot}（v8 观战，对齐原版 msg150 SetOrRequestSpectating
                       //   语义子集）：服务器把该端 AOI 过滤中心从自身 avatar 切到观战目标
                       //   （-1 = 恢复）。旧 server 不识别此号 → default 忽略，AOI 退回
                       //   avatar 中心 = 优雅降级，故不升 PROTO_VER（同 NetModules 通道纪律）
  NetModules = 82,    // 双向 {moduleId, ...}（module1=聊天 module2=ping）
  EmoteBubble = 120,  // C→S→广播（M4 玩家表情,对齐原版 MessageID 120）：
                      //   C→S {u8 emoteId(0-150)}；S→C {u8 slot, u8 emoteId}。
                      //   原版：客户端 msg120 → 服务器权威 NewBubble + msg91 广播全体
                      //   （含发送者）；本仓中继模型=发送端本地即刻出泡 + 服务器校验
                      //   范围后中继其他端按 slot 出泡——观察行为等价,不升 PROTO_VER
  DryadStardew = 144, // C→S→广播（原版 MessageID 144：DryadText_Do_StardewValleyBit
                      //   netMode==1 时 SendData(144)——载荷空；服务器 HaveDryadDoStardew
                      //   Animation 经 NPC ai 同步传导。本仓演出=全局编排器无 ai 态，
                      //   等价=各端本地 startStardewAnimation()：发送端已本地播，
                      //   服务器中继排除发送者。语义对齐 Main.cs:40978-40983）
                      //   （旧 server default 忽略未知号,同 SpectateFocus=150 先例）
  Ping = 154,         // 简化独立心跳（module2 并存预留）
  // ---- v3 房间制扩展（docs/multiplayer-design.md §房间） ----
  RoomPolicy = 200,   // S→C {roomCode, roomName, isHost, protectTiles, protectItems, u16 maxPlayers(v4),
                      //   u8 pvpAllowed(v7), u8 ruleBits(v8 服务器房)}
  SscSync = 201,      // S→C（v6，--ssc 启用时）{str recordJson}——服务器角色档下发。
                      //   record = {hp, maxHp, x, y, inv, armor, dye, savedAt}（id=内部下标，
                      //   同版本 registry 一致）。客户端进房应用覆盖本地角色。
                      //   语义=存档型 SSC（原版 ServerSideCharacter 同款信任模型，非反作弊）
  SummonIntent = 202, // C→S（v8 服务器房）{str itemKey, f32 x, y, vx, vy, u8 flags}——召唤类物品使用
                      //   意图（Boss 召唤物/雕像刷怪等 NPC 生成族）。仅 serverAuth 房接受：
                      //   SimHost 反查物品表确认召唤类 + 规则门（forbidBossSummon）后按原版
                      //   语义生成（含 Boss 公告链）；非 serverAuth 房整包丢弃（中继房仍走
                      //   房主本地生成路径）。对齐设计文档 §P4"netMode==1 短路改发消息"。
                      //   ★(x,y) 线契约 = NewNPC Bottom 锚点（SpawnOnPlayer :81452-81454
                      //   X=num10*16+8/Y=num11*16 → NPC.cs:81594 Bottom=(X,Y)）——
                      //   2026-09-17 双端合流（旧中心锚 +8 约定废除,BJ113 域外登记③;
                      //   server 与 game 同仓发布不做向后兼容,PROTO_VER 注 v6 先例）。
                      //   ★flags bit0=naturalPath（2026-09-18 增量通道,同 SpectateFocus=150
                      //   先例不升 PROTO_VER）：自然路径意图（Game.summonBossAtTx
                      //   onPlayerTy===undefined 档）——毁灭者 134 地下 Y 覆写仅此档生效
                      //   （物品路径=SpawnOnPlayer 寻点原值不覆写,BJ114-c;旧客户端缺段,
                      //   服务器防御式读 0=物品路径语义,缺省无害）。
  ServerPingProbe = 203, // S→C {f64 serverTs, u8 n, [u8 slot, u16 rttMs]×n}（玩家列表面板
                      //   RTT 数据源——服务器 10s 主动探测 + 全房 RTT 表捎带）；
                      //   C→S 回显 {f64 serverTs}（服务器 Date.now()-serverTs = 该端
                      //   RTT，写下一帧探针表）。原版无玩家面板/ping 显示（仅 /playing
                      //   命令）——本仓自有通道，旧端未知号默认忽略（150 先例）
}

// ================= v8 服务器房规则（RoomPolicy 尾部 ruleBits；docs/server-room-plan.md §6） =================

/** 规则位（未知位双端忽略——前向兼容） */
export const enum RuleBits {
  /** 服务器权威模拟房：世界/NPC/事件由 SimHost 计算,客户端全按访客语义 */
  ServerAuth = 1 << 0,
  /** 禁召唤 Boss（SummonIntent 拒 + 客户端 UI 门禁灰显） */
  ForbidBossSummon = 1 << 1,
  /** 禁破坏 tile（msg17 SetTile 置 0 族拒;protectTiles = ForbidBreak|ForbidPlace 同置） */
  ForbidBreak = 1 << 2,
  /** 禁放置 tile */
  ForbidPlace = 1 << 3,
  /** 禁 PvP（= pvpAllowed 强制关;既有 msg27 bit6 / msg44 墙生效） */
  ForbidPvp = 1 << 4,
  /** 禁爆炸物（爆炸族 tile/物品链拒——保护建筑） */
  ForbidExplosives = 1 << 5,
  /** 和平模式（SimHost 刷怪短路 + 在场敌怪 EncourageDespawn） */
  PeaceMode = 1 << 6,
}

/** 房间规则（lobby 建房/PATCH 热更;gmToken 仅服务器持有不下发） */
export interface RoomRules {
  serverAuth: boolean;
  forbidBossSummon: boolean;
  forbidBreak: boolean;
  forbidPlace: boolean;
  forbidPvp: boolean;
  forbidExplosives: boolean;
  peaceMode: boolean;
}

export const DEFAULT_ROOM_RULES: RoomRules = {
  serverAuth: false, forbidBossSummon: false, forbidBreak: false,
  forbidPlace: false, forbidPvp: false, forbidExplosives: false, peaceMode: false,
};

export function rulesToBits(r: RoomRules): number {
  return (r.serverAuth ? RuleBits.ServerAuth : 0)
    | (r.forbidBossSummon ? RuleBits.ForbidBossSummon : 0)
    | (r.forbidBreak ? RuleBits.ForbidBreak : 0)
    | (r.forbidPlace ? RuleBits.ForbidPlace : 0)
    | (r.forbidPvp ? RuleBits.ForbidPvp : 0)
    | (r.forbidExplosives ? RuleBits.ForbidExplosives : 0)
    | (r.peaceMode ? RuleBits.PeaceMode : 0);
}

export function rulesFromBits(bits: number): RoomRules {
  return {
    serverAuth: !!(bits & RuleBits.ServerAuth),
    forbidBossSummon: !!(bits & RuleBits.ForbidBossSummon),
    forbidBreak: !!(bits & RuleBits.ForbidBreak),
    forbidPlace: !!(bits & RuleBits.ForbidPlace),
    forbidPvp: !!(bits & RuleBits.ForbidPvp),
    forbidExplosives: !!(bits & RuleBits.ForbidExplosives),
    peaceMode: !!(bits & RuleBits.PeaceMode),
  };
}

/** NetModule 表（0-2 对齐原版 NetworkInitializer.cs 注册序：Liquid/Text/Ping；
 *  JoinLeave=3 与原版 NetAmbienceModule 撞号——本协议双端自洽，无互操作需求）
 *  LeashedEntity=13 对齐原版注册序（NetworkInitializer.cs:25 第 14 个 Register）：
 *  旧双端 default 忽略未知 moduleId，新增通道不破坏在跑实例——故不升 PROTO_VER
 *  （升版会踢掉正在运行的旧 server 进程，共享开发环境不宜）
 *
 *  ★RV-R2② 分叉笺（2026-09-01）：本表 wire id 钉在 1.4.5.6 注册序基线
 *  （NetworkInitializer Register 顺序即 NetManager 分配的 moduleId）。1.4.5.7 在
 *  Bestiary 之后插入了 NetCreativeUnlocksModule（新 module，1457 占 id 5），其后所有
 *  原版 module 的原版侧 id 相对 1456 **整体 +1**：CreativePowers 5→6、PlayerReport
 *  6→7、TeleportPylon 7→8、Particles 8→9、PowerPermissions 9→10、Banners 10→11、
 *  CraftingRequests 11→12。本表不做跟随改号——SW 双端自洽无互操作需求，且改号会
 *  打断与在跑旧 server 的兼容。仅两处名义恰平：LeashedEntity 与 UnbreakableWallScan
 *  （1457 插入 +1 被 1456 独有的 TagEffectState.NetModule 注销位 −1 抵消，仍为
 *  13/14）。日后若接真实跨服互操作，须按 1457 序重排并升 PROTO_VER */
export const enum NetModule {
  Liquid = 0,   // 液体网格同步（原版 NetLiquidModule——注册序 id=0；net/syncModules.ts）：
                //   变化格 {i32 packed(x<<16|y), u8 liquid, u8 liquidType} 批量。房主
                //   （中继房）/SimHost（服务器房）权威跑 LiquidSim → 60ms 节流上报
                //   （原版 33ms/UpdateLiquid 末置换）；访客接收直写 store 不再本地模拟
  Text = 1,     // 聊天 {authorSlot, text, r, g, b}（author=255 无前缀，对齐原版 255=服务器）
                //   C→S 载荷 {str text, u8 channel, [u8 r,g,b 尾段]}：
                //   channel 0=房间聊天（默认,旧客户端无尾段;新客户端随附 RGB=Player.
                //   ChatColor 难度色,新 server 采用/旧 server 忽略回退金色）/
                //   1=世界频道（跨房全服,RGB 不附）/ 2=命令系统行（RGB 必附——服务器以
                //   slot=255 无名前缀中继;发起端已本地回显,广播排除发送者）/
                //   3=队伍频道（RGB 不附——服务器按 msg13 team 定向同队,队伍色）
  PingModule = 2, // 地图 ping（原版 NetPingModule——注册序 id=2；net/syncModules.ts）：
                  //   {f32 x, f32 y}（全屏地图 tile 坐标）；C→S → 广播排除发送者，
                  //   各端 Main.Pings 语义（15s 存活/10fps 五帧动画/容量 100）。
                  //   触发 = 全屏地图双击（<0.5s && <2px，Main.cs:54926-54931）
  JoinLeave = 3,  // S→C 系统 {slot, joined}——加入/离开公告（原版 Lang.mp[19]/[20]，服务器广播）
  Bestiary = 4,   // 图鉴进度（原版 NetBestiaryModule——注册序 id=4；net/syncModules.ts）：
                  //   批量 {u16 n, [u8 sub(0杀/1遇/2聊), i16 netId, 7bit 计数(仅杀)]}。
                  //   杀 = 权威端上行携累计值（NPCKillsTracker.RegisterKill 语义）；
                  //   遇/聊 = 首次事件上行（tracker flag 门）；进房全量补发
                  //   （三 tracker OnPlayerJoining）
  TeleportPylon = 7, // 晶塔（原版 NetTeleportPylonModule——注册序 id=7；net/syncModules.ts）：
                  //   sub0 加/sub1 删（房主差集广播→全房；进房全量）+ sub2 传送请求
                  //   （访客→房主门禁五连）+ sub3 本仓扩展回执（房主→请求端：
                  //   客户端权威移动模型下原版"服务器 Teleport+msg65"的等价落地）
  CreativePowers = 5, // M9 旅程力量（原版 NetCreativePowersModule——NetworkInitializer.cs:17
                      //   注册序 id=5）：世界侧力量全量态广播 + 个人侧（godmode/放置范围/
                      //   刷怪率）按 slot 广播 + 时段跳跃中继。载荷见 net/journeySync.ts
                      //   （原版按 powerId+子消息编码；本仓世界态聚合为单快照——语义等价
                      //   记录于 journeySync.ts 头注）。旧端 default 忽略未知 moduleId，
                      //   增量通道不升 PROTO_VER（同 LeashedEntity=13 先例）
  CreativeUnlocksReport = 6, // M9 研究进度上报（原版 NetCreativeUnlocksPlayerReportModule——
                      //   注册序 id=6）：C→S {u16 itemId, u16 amount} → S→C {u8 slot,
                      //   u16 itemId, u16 amount}（排除发送者广播——原版 dedServ 同款）；
                      //   接收端同队门（LocalPlayer.team>0 && 同队）才入本地 Research
  CreativePowerPermissions = 9, // M9 力量权限（原版 NetCreativePowerPermissionsModule——
                      //   注册序 id=9，S→C 专向）：{u8 sub0, u16 powerId, u8 level}；
                      //   level 0=LockedForEveryone/1=CanBeChangedByHostAlone/
                      //   2=CanBeChangedByEveryone（PowerPermissionLevel.cs，默认 2）。
                      //   C→S 同载荷 = 房主改权限（原版无此上行——服务器配置文件承担，
                      //   本仓以房主 UI 直改，语义对齐 journeypermission_* 配置行）
  LeashedEntity = 13, // 拴绳实体（原版 LeashedEntity.NetModule，msg82 承载）：
                      //   sub1=FullSync（新增/section 激活全量）/ sub2=PartialSync（周期位置）/
                      //   sub0=Remove——仅房主上行，服务器登记后按条带定向补发（见 net/leashedSync.ts）
  Particles = 8,  // 编排粒子（原版 NetParticlesModule——注册序 id=8；net/syncModules.ts）：
                  //   {u8 type, ParticleOrchestraSettings 21B}＝原版 22B 载荷 1:1（type +
                  //   f32×4 pos/move + i32 uniqueInfo + u8 invoker）。原版同步面 = 全部
                  //   ParticleOrchestra 编排特效（剑刃轨迹/物品转移/微光爆发族……），
                  //   纯 dust 不上网；本仓已移植的编排消费/生产子集见 syncModules.ts 头注
  InstancedLoot = 14, // per-client 掉落（原版 msg90 InstancedItem 的本仓 module 化,依
                  //   LeashedEntity=13 先例取 13+1；掉落结算权威端【仅房主/SimHost】上行,
                  //   服务器按 targetSlot 定向转发——其他端不可见不可拾）。语义 =
                  //   CommonCode.DropItemLocalPerClientAndSetNPCMoneyTo0（CommonCode.cs:35-58）：
                  //   Boss 袋族（bossBag 规则）各交互端各得一份 instanced 副本,
                  //   接收端本地生成 netLocalOnly 掉落（不上报 msg21——仅本端玩家可见可拾）
  AnglerQuest = 15, // 渔夫任务/季节强置位（SW-FX42,依 InstancedLoot=14 先例取 14+1）：
                  //   sub0=msg74 等价（任务号断言+新的一天复位）/ sub1=msg75 等价（交付
                  //   上行,服务器 per-slot 记账）/ sub2=force 季节位（msg7 bitsByte9[6][7]
                  //   等价——ForToday 位是 Game 运行时位,msg7 通用 flags map 不承载）。
                  //   编解码与语义锚见 net/syncModules.ts module15 段;
                  //   旧双端 default 忽略未知 moduleId,增量通道不升 PROTO_VER
  ModTE = 16, // ★TE net sync(2026-10-14,依 AnglerQuest=15 先例取 15+1):
              //   host 权威 TE 快照通道——S→C 全量 {u16 n, n×[str k, i32 x, i32 y,
              //   str stateJson]}(进房补发+周期重发[TE 实例数小,全量≈setTile 帧价];
              //   客户端伪造上行整包忽略=Ambience 同语义)。客户端 applyModTESnapshot
              //   重建本地实例桶(update 不跑、save 不落——host 档才是权威)。
              //   编解码见 net/syncModules.ts module16 段;超限分批=writeTEModuleBatched
  Ambience = 100, // 天空氛围（原版 NetAmbienceModule——注册序 id=3 被 JoinLeave 占用，
                  //   依 CreativePowerPermissions=9 先例走仓库私有大号 id；语义 1:1）：
                  //   S→C {u8 playerSlot, i32 seed, u8 skyEntityType}——服务器 AmbienceServer
                  //   10-120s 一次选玩家锚 + 选族掷点（room.ts 侧 AmbienceServer 1:1），
                  //   各端同 seed 重放出同一只鸟群/飞艇（FastRandom(seed) 同构）
}

// ================= Writer（小端，定宽；字符串 = u16 长度 + UTF-8） =================

export class NetWriter {
  private buf = new Uint8Array(256);
  private len = 0;
  private dv: DataView;

  constructor(private readonly msgId: number) {
    // 预留 [u16 len][u8 msgId]
    this.len = 3;
    this.dv = new DataView(this.buf.buffer);
  }

  private grow(need: number) {
    if (this.len + need <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + need) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.dv = new DataView(this.buf.buffer);
  }

  u8(v: number): this { this.grow(1); this.buf[this.len++] = v & 255; return this; }
  /** sbyte（原版 writer.Write(sbyte)——C# 有符号字节；v 超界按位回绕） */
  i8(v: number): this { return this.u8(v); }
  u16(v: number): this { this.grow(2); this.dv.setUint16(this.len, v, true); this.len += 2; return this; }
  i16(v: number): this { this.grow(2); this.dv.setInt16(this.len, v, true); this.len += 2; return this; }
  u32(v: number): this { this.grow(4); this.dv.setUint32(this.len, v >>> 0, true); this.len += 4; return this; }
  i32(v: number): this { this.grow(4); this.dv.setInt32(this.len, v, true); this.len += 4; return this; }
  f32(v: number): this { this.grow(4); this.dv.setFloat32(this.len, v, true); this.len += 4; return this; }
  f64(v: number): this { this.grow(8); this.dv.setFloat64(this.len, v, true); this.len += 8; return this; }
  bool(v: boolean): this { return this.u8(v ? 1 : 0); }
  bytes(b: Uint8Array): this { this.grow(b.length); this.buf.set(b, this.len); this.len += b.length; return this; }
  /** 半精度 f16（IEEE 754 binary16，舍入 = 就近偶数；XNA HalfVector2.PackedValue 1:1——
   *  原版 Utils.WritePackedVector2（Utils.cs:1395-1398）即写此 16 位打包值） */
  f16(v: number): this { return this.u16(f32ToHalf(v)); }
  str(s: string): this {
    const b = new TextEncoder().encode(s);
    this.u16(b.length);
    return this.bytes(b);
  }

  /** 回填长度前缀并返回完整帧（含 [u16 len][u8 id]）。finish 后禁止再写入（subarray 视图） */
  finish(): Uint8Array {
    // Q3 修复：守卫含头总长（此前 len-3 在 65533..65535 区间漏检 → setUint16 回绕 → 接收端脏流）
    if (this.len > 65535) throw new Error(`net: 包超限 ${this.len}`);
    this.dv.setUint16(0, this.len, true);
    this.buf[2] = this.msgId & 255;
    return this.buf.subarray(0, this.len);
  }
}

// ================= Reader =================

export class NetReader {
  private dv: DataView;
  private p = 0;
  constructor(private readonly buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(): number { return this.buf[this.p++]; }
  /** sbyte（原版 reader.ReadSByte()——无符号字节按符号位扩展） */
  i8(): number { const v = this.buf[this.p++]; return v & 0x80 ? v - 256 : v; }
  get remaining(): number { return this.buf.length - this.p; }
  u16(): number { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i16(): number { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u32(): number { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  i32(): number { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  f32(): number { const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
  f64(): number { const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  bool(): boolean { return this.u8() !== 0; }
  bytes(n: number): Uint8Array { const b = this.buf.subarray(this.p, this.p + n); this.p += n; return b; }
  /** 半精度 f16（配对 NetWriter.f16；NaN→NaN、Inf→Inf、下溢→±0） */
  f16(): number { return halfToF32(this.u16()); }
  str(): string {
    const n = this.u16();
    return new TextDecoder().decode(this.bytes(n));
  }
}

// ================= f16（half float）编解码：XNA HalfVector2 1:1 =================

const F32_BUF = new Float32Array(1);
const U32_BUF = new Uint32Array(F32_BUF.buffer);

/** 24 位尾数右移 + 就近偶数舍入（s ≥ 1） */
function rshiftRNE(m: number, s: number): number {
  const out = m >>> s;
  const rem = m & ((1 << s) - 1);
  const half = 1 << (s - 1);
  if (rem > half || (rem === half && (out & 1) === 1)) return out + 1;
  return out;
}

/** f32 → f16 位型（IEEE 754 binary16）。XNA HalfVector2 构造同源
 *  （Microsoft.Xna.Framework.Graphics.PackedVector 半精度规范）：
 *  上溢 → ±Inf、下溢（< 2^-24 量级）→ ±0、NaN 保号保尾数高位 */
export function f32ToHalf(v: number): number {
  F32_BUF[0] = v;                       // 先单精度化（对齐 C# float 运算精度）
  const x = U32_BUF[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const man = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (man ? 0x200 : 0); // Inf / NaN
  let e = exp - 127 + 15;               // f32 偏移 127 → f16 偏移 15
  if (e >= 31) return sign | 0x7c00;    // 上溢 → ±Inf
  if (e <= 0) {
    if (e < -10 || exp === 0) return sign;   // 下溢 / f32 亚正规 → ±0
    let sub = rshiftRNE(man | 0x800000, 14 - e);  // f16 亚正规尾数
    if (sub >= 0x400) return sign | 0x0400;       // 舍入进位到最小正规数
    return sign | sub;
  }
  let m = rshiftRNE(man, 13);
  if (m === 0x400) { m = 0; e++; if (e >= 31) return sign | 0x7c00; }
  return sign | (e << 10) | m;
}

/** f16 位型 → f32（精确：f16 全部可由 f32 无损表示） */
export function halfToF32(h: number): number {
  const sign = (h & 0x8000) >>> 15;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  let out: number;
  if (e === 0) out = m * 5.960464477539063e-8;   // 亚正规：m * 2^-24
  else if (e === 31) out = m ? NaN : Infinity;
  else out = (1 + m / 1024) * 2 ** (e - 15);
  return sign ? -out : out;
}

// ================= 帧流解析（粘包；对齐原版 CheckBytes 语义） =================

/** 字节流帧解析器：append 后逐帧回调 {msgId, payloadReader}，自动处理半包。
 *  P0.4 增量化：单一缓冲 + 读写偏移（旧版每 drain 把全部 chunk 合并成新数组——
 *  4 人房每秒数百次全量拷贝，纯 GC 压力）。残余半包 copyWithin 归位。 */
export class FrameParser {
  private buf = new Uint8Array(4096);
  private len = 0;
  private _draining = false;

  append(data: Uint8Array) {
    if (this._draining) throw new Error('FrameParser: drain 回调内禁止 append（会破坏解析缓冲）');
    if (this.len + data.length > this.buf.length) {
      let cap = this.buf.length;
      while (cap < this.len + data.length) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
    }
    // 拷贝入缓冲（ws 回调数据可能被复用）
    this.buf.set(data, this.len);
    this.len += data.length;
  }

  /** 解析所有完整帧；返回 false 表示缓冲为空。
   *  脏流防护：len 非法时按字节重同步（此前 break 不前进 → 永久失步 + 缓冲无限增长）。
   *  缓冲上限：超限重置（半包攻击防御）。P1.3 合包后单条 WS 消息可达 512KB
   *  （服务器 FLUSH_SLICE 切片；25 条 strip 拼发），上限须高于切片粒度——
   *  2026-08 实踩：沿用 256KB 旧值会把进房 strip 大包整包丢弃 → 世界组装永久卡死 */
  private static readonly MAX_BUFFER = 4 * 1024 * 1024;
  drain(cb: (msgId: number, r: NetReader) => void): boolean {
    if (this._draining) throw new Error('FrameParser: drain 重入');
    if (this.len < 3) return this.len > 0;
    if (this.len > FrameParser.MAX_BUFFER) { this.len = 0; return false; }
    this._draining = true;
    let p = 0;
    let any = false;
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    try {
      while (p + 3 <= this.len) {
        const len = dv.getUint16(p, true);
        if (len < 3 || len > 65535) { p += 1; continue; } // 脏字节：跳过重同步
        if (p + len > this.len) break; // 半包
        const msgId = this.buf[p + 2];
        try {
          cb(msgId, new NetReader(this.buf.subarray(p + 3, p + len)));
        } catch (e) {
          // netdbg：解析异常取证（?netdbg=1 时窗口可读；默认吞掉保持旧毒化语义）
          const g = globalThis as unknown as { __FRAME_ERRS?: Array<{ msgId: number; len: number; hex?: string; e: string }> };
          if (g.__FRAME_ERRS && g.__FRAME_ERRS.length < 8) {
            const hex = Array.from(this.buf.subarray(p + 3, Math.min(p + len, p + 15))).map((b) => b.toString(16).padStart(2, '0')).join(' ');
            g.__FRAME_ERRS.push({ msgId, len, hex, e: String((e as Error).message) });
          }
          // 一次性告警：静默吞帧不能完全无声（否则同步 bug 被藏死）；netdbg 时保持抛出便于断点
          const g2 = globalThis as unknown as { __FRAME_WARNED?: Set<number> };
          if (!g2.__FRAME_WARNED) g2.__FRAME_WARNED = new Set();
          if (!g2.__FRAME_WARNED.has(msgId)) {
            g2.__FRAME_WARNED.add(msgId);
            if (typeof console !== 'undefined') console.warn('[frame] 解析失败 msgId=' + msgId + ' len=' + len + '（每类一次）', (e as Error).message);
          }
          if ((globalThis as { location?: { search?: string } }).location?.search?.includes('netdbg')) throw e;
        }
        p += len;
        any = true;
      }
    } finally {
      this._draining = false;
      // 压缩必须在 finally：回调抛错时 p 已前进，若不归位会从 0 重放同一批帧
      // → 同一异常反复抛出，连接永久毒化（review C3）
      if (p > 0) {
        if (p < this.len) this.buf.copyWithin(0, p, this.len);
        this.len -= p;
      }
    }
    return any || this.len > 0;
  }
}

// ================= 玩家物品同步（msg5 SyncPlayerItem 批量变体） =================

export const enum ItemContainer {
  Slots = 0,  // inv.slots[0..57]
  Armor = 1,  // inv.armor[0..19]（0-2 盔甲/3-9 配饰/10-12 时装/13-19 时装配饰）
  Dye = 2,    // inv.dye[0..9]
  // ★清偿刀 Q3（2026-09-30）：miscDyes 段（inv.miscDyes[0..4] 杂项装备染料,
  //  Player.cs:1378）——弹幕染料四通道 cPet/cLight/cGrapple 的源槽（UpdateDyes
  //  Player.cs:9667-9692）。曾缺 → 傀儡弹染料通道全 0=fail-open（projDye MP 边界债）。
  //  段形态与既有三段同构（逐条 playerSlot+container+itemSlot+u16id+u16stack+prefix,
  //  条目定长 8 字节）;降级矩阵：旧端 applyRemoteItems `container>2` 门整条丢弃、
  //  readPlayerItems 定长循环不错位（帧级前向兼容,无需 PROTO_VER 翻面）。
  MiscDyes = 3, // inv.miscDyes[0..4]
}

export interface ItemSyncEntry {
  container: ItemContainer;
  itemSlot: number;
  itemId: number;   // 0 = 空
  stack: number;
  /** ★R16-13（2026-08-24）：重铸词缀（原版 msg5 SyncEquipment armor 段 PL:55466-55471
   *  同构带 prefix）——曾缺 → 远端装备显示/SSC 角色词缀全归零 */
  prefix?: number;
}

/** 容器→槽容量（★Q3 +miscDyes[5];消费面数组长度门+服务器值域校验同源） */
export const INV_SYNC_SIZES = [58, 20, 10, 5];

export function writePlayerItems(entries: Array<ItemSyncEntry & { playerSlot: number }>): Uint8Array {
  const w = new NetWriter(Msg.SyncPlayerItem);
  w.u16(entries.length);
  for (const e of entries) {
    w.u8(e.playerSlot);
    w.u8(e.container);
    w.u8(e.itemSlot);
    w.u16(e.itemId & 0xffff);
    w.u16(e.stack & 0xffff);
    w.u8(e.prefix ?? 0);   // ★R16-13：尾段 prefix（旧端按 remaining 门兼容读）
  }
  return w.finish();
}

export function readPlayerItems(r: NetReader): Array<ItemSyncEntry & { playerSlot: number }> {
  const n = r.u16();
  // ★R16-13：prefix 尾段兼容门——旧端每条 7 字节（1+1+1+2+2）,新端 8 字节
  const withPrefix = r.remaining >= n * 8;
  const out: Array<ItemSyncEntry & { playerSlot: number }> = [];
  for (let i = 0; i < n; i++) {
    const playerSlot = r.u8();
    const container = r.u8() as ItemContainer;
    const itemSlot = r.u8();
    const itemId = r.u16();
    const stack = r.u16();
    const prefix = withPrefix ? r.u8() : undefined;
    out.push({ playerSlot, container, itemSlot, itemId, stack, prefix });
  }
  return out;
}

// ================= PlayerHurt（msg117，被击端实扣权威飘字帧；2026-08-30 批） =================

/** flags 位（未知高位双端忽略——前向兼容；bit1 原版 SendPlayerHurt bitsByte[1]=pvp 同义）
 *  ★F-1 bit2=MeleeSource：伤害来源身份标记（PROTO_VER 注 h)。msg117 五条 PvP 生产支
 *  中仅近战支（ItemCheck_MeleeHitPVP 同构位,Game:2899）置位——收端甲虫回执 FIFO
 *  消费门按此分账：vanilla 只在近战支记 beetleCounter（Player.cs:44456-44460;
 *  PvE 近战另一处 :44826-44828,爆炸/狱火/盾转移/PvP 弹四支均无）。撞位自查见
 *  Msg.PlayerHurt 注（msg44 的 bits1-4 enchant 位域是另一条消息的载荷域,不冲突）。 */
export const enum PlayerHurtFlags {
  Crit = 1 << 0,
  Pvp = 1 << 1,
  MeleeSource = 1 << 2,
}

/** C→S / S→C 同形状。slot 段上行可填任意占位（服务器以发送者覆写——被击者本人
 *  权威，杜绝「伪造他人受伤」假飘字）；dmg = 被击端实扣值（≤0 视为脏数据）。 */
export interface PlayerHurtMsg {
  slot: number;
  dmg: number;
  x: number; y: number;   // 世界 px（飘字锚点）
  dir: number;            // 击退向 ±1（0 容忍,原版 hitDirection byte+1 编码的等价位）
  flags: number;          // PlayerHurtFlags
}

export const PLAYER_HURT_LEN = 13; // u8 + i16 + f32*2 + i8 + u8

/** ★B1 钳位纯度批（2026-08-31）：写层【无钳】= short 直写回绕语义。
 *  原版 SendData case 117 对 dmg 的唯一编码动作是 `writer.Write((short)number2)`
 *  （NetMessage.cs:1447，SendPlayerHurt :2615 族同式）——>32767 按 unchecked short
 *  回绕、<−32768 同理；此后路径再无任何数值改写（收端 ReadInt16 直入 Hurt,
 *  MessageBuffer.cs:3888/:3894）。本仓曾自造 min(9999) 上帽 = 既非原版语义也非
 *  策略面（msg117 全链只产飘字展示,零 HP 结算后果）——按 F-3① notePendingMeleeHit
 *  先例「自设帽=新发明近似」移除。NetWriter.i16 用 setInt16,超界值 ToInt16 截断回绕,
 *  与 C# unchecked (short) 强转逐字节同型。实扣值域合约见 readPlayerHurt 注：
 *  合法生产面 dmg∈[1..maxHp]（hp 减量被残血钳小）,回绕域对合法流量不可达。 */
export function writePlayerHurt(h: PlayerHurtMsg): Uint8Array {
  const w = new NetWriter(Msg.PlayerHurt);
  w.u8(h.slot & 0xff);
  w.i16(h.dmg);
  w.f32(h.x); w.f32(h.y);
  w.i8(Math.max(-1, Math.min(1, h.dir | 0)));
  w.u8(h.flags & 0xff);
  return w.finish();
}

/** 截断/缺字段返回 null（调用方静默丢弃——同 readDoorEvent 先例）。
 *  注意 remaining 判等严格 ==：多出的尾字节视为未知扩展拒收本帧
 *  （flags 高位才承载前向兼容;结构级变更应走新 msgId） */
export function readPlayerHurt(r: NetReader): PlayerHurtMsg | null {
  if (r.remaining !== PLAYER_HURT_LEN) return null;
  const slot = r.u8();
  const dmg = r.i16();
  // ★B1 钳位纯度批：原版读侧【无 GetShort 后钳】——`int damage = reader.ReadInt16()`
  //   直入 Player.Hurt（MessageBuffer.cs:3888/:3894），Hurt 内部经
  //   CalculateDamagePlayersTake 防后 floor≥1 把任意 i16 归一成可见值（Main.cs:67146-
  //   67155）。本仓重放面只剩飘字、无 Hurt 机，故以【帧级合约】替代数值改写：dmg 段
  //   语义=实扣 hp 减量∈[1..maxHp]（合法生产面天然出界不可达），≤0 即脏帧整帧拒收
  //   ——这是拒收门不是钳位（不做任何 in-range 数值改写,对垃圾输入也绝不产出
  //   「1 点假伤」飘字），与写层 short 回绕直写配套。若未来把重放面扩成 Hurt 式重算,
  //   此门应改为照抄原文（i16 全域受理 + 收端自身 normalize）。
  if (!(dmg > 0)) return null;
  const x = r.f32(), y = r.f32(), dir = r.i8(), flags = r.u8();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;   // S6 NaN 清洗
  return { slot, dmg, x, y, dir, flags };
}

// ================= 箱改名（msg69 ChestName + msg33 改名尾段；SW-FX52-R12） =================

/** msg33 改名尾段 nameLen 语义（原版 num24——NetMessage.cs:895-905 写 /
 *  MessageBuffer.cs:1928-1937 读）：0=无改名；1..20=后随名串（20=字符钳，
 *  NetMessage.cs:899-903 len==0||len>20 → 写 255 不写名）；255=清名；21..254=
 *  非原版产出（收端 num24=0 同款无名处理） */
export const CHEST_NAME_MAX = 20;
/** msg33 改名尾段清名哨兵（原版「长度非法」写值,收端 1948-1952 写 string.Empty） */
export const CHEST_NAME_CLEAR = 255;

export interface ChestNameMsg { chestIdx: number; x: number; y: number; name: string }

/** msg69 S→C 广播帧（NetMessage.cs:1119-1126：i16 idx + i16 x + i16 y + string name——
 *  ★SW-RB15d 定谳：三个 i16 字段逐位 1:1；string 长度前缀本仓=u16 LE（NetWriter.str），
 *  原版=BinaryWriter 7bit 变长（NetMessage.cs:120 writer；.NET Write(string) 语义）——
 *  本协议 SW 双端自洽（str/读面同配对），非跨端兼容面，登记差异勿当 1:1 引用。
 *  生产 = 服务器受理 msg33 改名段（MessageBuffer.cs:1969 TrySendData(69,-1,whoAmI,...)） */
export function writeChestName(chestIdx: number, x: number, y: number, name: string): Uint8Array {
  return new NetWriter(Msg.ChestName)
    .i16(chestIdx)
    .i16(x).i16(y)
    .str(name)
    .finish();
}

/** 截断/越界返回 null（idx∈[0,8000) 门=MessageBuffer.cs:3056/:3078；位置校验在消费端,
 *  同原版 chest.x!=num8||chest.y!=num9 → break :3068-3070）。 */
export function readChestName(r: NetReader): ChestNameMsg | null {
  if (r.remaining < 8) return null;   // i16×3 + u16 名长
  const chestIdx = r.i16();
  const x = r.i16(), y = r.i16();
  if (chestIdx < 0 || chestIdx >= 8000) return null;
  const name = r.str();
  return { chestIdx, x, y, name };
}

/** msg33 改名尾段解析（num24 语义 1:1）。在读完全部已知段后调用（尾段=remaining 门：
 *  旧端帧 remaining=0 → null=无改名）。返回 ''=清名（255）。 */
export function readChestRenameTail(r: NetReader): string | null {
  if (r.remaining < 1) return null;
  const len = r.u8();
  if (len >= 1 && len <= CHEST_NAME_MAX) {
    if (r.remaining < 2) return null;
    return r.str();
  }
  if (len === CHEST_NAME_CLEAR) return '';
  return null;   // 21..254：非原版产出（原版 num24=0 同款,MessageBuffer.cs:1937-1939）
}

// ================= tile 操作批量（msg17，对齐原版单点操作语义的批量变体） =================

export const enum TileOpAction {
  SetTile = 0,    // v=type, fx, fy
  SetWall = 1,    // v=wall
  SetHalfBrick = 5,
  SetSlope = 6,
  SetActuated = 3,
  SetWire = 4,    // v=bits
}

export interface TileOp {
  a: TileOpAction;
  x: number; y: number;
  v: number;
  fx: number; fy: number;
}

// ================= DoorEvent（msg19，NPC 开关门即时事件） =================
export interface DoorEventMsg { closing: boolean; gate: boolean; x: number; y: number; dir: number; }

export function writeDoorEvent(e: DoorEventMsg): Uint8Array {
  const w = new NetWriter(Msg.DoorEvent);
  w.u8((e.closing ? 1 : 0) | (e.gate ? 2 : 0));
  w.i32(e.x); w.i32(e.y); w.i8(e.dir);
  return w.finish();
}

export function readDoorEvent(r: NetReader): DoorEventMsg | null {
  if (r.remaining < 10) return null; // u8 + i32*2 + i8
  const flags = r.u8();
  const x = r.i32(), y = r.i32();
  const dir = r.i8();
  return { closing: (flags & 1) !== 0, gate: (flags & 2) !== 0, x, y, dir };
}

export function writeTileBatch(ops: TileOp[]): Uint8Array {
  const w = new NetWriter(Msg.TileBatch);
  w.u16(ops.length);
  for (const o of ops) {
    w.u8(o.a);
    w.i32(o.x); w.i32(o.y);
    w.u16(o.v & 0xffff);
    if (o.a === TileOpAction.SetTile) { w.u16(o.fx); w.u16(o.fy); }
  }
  return w.finish();
}

export function readTileBatch(r: NetReader): TileOp[] {
  const n = r.u16();
  const ops: TileOp[] = [];
  for (let i = 0; i < n; i++) {
    const a = r.u8() as TileOpAction;
    const x = r.i32(), y = r.i32(), v = r.u16();
    let fx = 0, fy = 0;
    if (a === TileOpAction.SetTile) { fx = r.u16(); fy = r.u16(); }
    ops.push({ a, x, y, v, fx, fy });
  }
  return ops;
}

// ================= tile strip RLE 编解码（msg10，codecVer=0 裸 RLE） =================
// 每 tile 完整状态 11B 裸（type u16/flags u8/frameX u16/frameY u16/wall u16/
// liquid u8/liquidType u8/half u8/slope u8/wire u8）；RLE 按"全状态相同"连续段编码
// [u16 count][14B 状态] = 16B/run，地下均质区压缩比极高。
// 条带默认 200×20（4000 格，全异态最坏 4000×16+15 ≈ 64015B < 65535 包上限——
// 余量仅 ~1.5KB！扩 strip 尺寸或加状态通道前必核此账，超限会触发 finish() 抛错）。

export interface StripRect { x0: number; y0: number; w: number; h: number; }

/** 编码一条 strip（读 store 指定矩形） */
export function encodeStrip(
  st: { w: number; h: number; type: Uint16Array; flags: Uint8Array; frameX: Uint16Array; frameY: Uint16Array;
        wall: Uint16Array; liquid: Uint8Array; liquidType: Uint8Array; half: Uint8Array; slope: Uint8Array; wire: Uint8Array },
  rect: StripRect,
): Uint8Array {
  const w = new NetWriter(Msg.TileSection);
  w.i32(rect.x0); w.i32(rect.y0); w.u16(rect.w); w.u16(rect.h);
  const idx = (x: number, y: number) => y * st.w + x;
  let run = 0;
  let rType = 0, rFlags = 0, rFx = 0, rFy = 0, rWall = 0, rLiq = 0, rLt = 0, rHalf = 0, rSlope = 0, rWire = 0;
  const flushRun = () => {
    if (run === 0) return;
    w.u16(run);
    w.u16(rType); w.u8(rFlags); w.u16(rFx); w.u16(rFy); w.u16(rWall);
    w.u8(rLiq); w.u8(rLt); w.u8(rHalf); w.u8(rSlope); w.u8(rWire);
    run = 0;
  };
  for (let y = rect.y0; y < rect.y0 + rect.h; y++) {
    for (let x = rect.x0; x < rect.x0 + rect.w; x++) {
      const i = idx(x, y);
      if (run > 0 && (
        st.type[i] !== rType || st.flags[i] !== rFlags || st.frameX[i] !== rFx || st.frameY[i] !== rFy
        || st.wall[i] !== rWall || st.liquid[i] !== rLiq || st.liquidType[i] !== rLt
        || st.half[i] !== rHalf || st.slope[i] !== rSlope || st.wire[i] !== rWire
      )) flushRun();
      if (run === 0) {
        rType = st.type[i]; rFlags = st.flags[i]; rFx = st.frameX[i]; rFy = st.frameY[i];
        rWall = st.wall[i]; rLiq = st.liquid[i]; rLt = st.liquidType[i];
        rHalf = st.half[i]; rSlope = st.slope[i]; rWire = st.wire[i];
      }
      run++;
    }
  }
  flushRun();
  return w.finish();
}

/** 解码一条 strip 直写目标 store（批量路径：绕过事件，调用方负责事后整块标脏） */
export function decodeStrip(
  st: { w: number; h: number; type: Uint16Array; flags: Uint8Array; frameX: Uint16Array; frameY: Uint16Array;
        wall: Uint16Array; liquid: Uint8Array; liquidType: Uint8Array; half: Uint8Array; slope: Uint8Array; wire: Uint8Array },
  r: NetReader,
): StripRect | null {
  const x0 = r.i32(), y0 = r.i32(), w = r.u16(), h = r.u16();
  if (x0 < 0 || y0 < 0 || x0 + w > st.w || y0 + h > st.h) return null;
  let written = 0;
  while (written < w * h) {
    const count = r.u16();
    // C2 防死循环：count=0（恶意/损坏数据）或 payload 已尽（截断）→ 终止并返回已写区域
    if (count === 0) break;
    const type = r.u16(), flags = r.u8(), fx = r.u16(), fy = r.u16(), wall = r.u16();
    const liq = r.u8(), lt = r.u8(), half = r.u8(), slope = r.u8(), wire = r.u8();
    for (let k = 0; k < count && written < w * h; k++) {
      const x = x0 + (written % w), y = y0 + Math.floor(written / w);
      const i = y * st.w + x;
      st.type[i] = type; st.flags[i] = flags; st.frameX[i] = fx; st.frameY[i] = fy; st.wall[i] = wall;
      st.liquid[i] = liq; st.liquidType[i] = lt; st.half[i] = half; st.slope[i] = slope; st.wire[i] = wire;
      written++;
    }
  }
  return { x0, y0, w, h };
}
