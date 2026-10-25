# 原版服直连互通战役——收官报告（红队审查版）

2026-10-25 · 战役跨 4 个工作会话（10-24 定谳/开工 → 10-25 全链收官）。

## 一、目标与达成

**用户目标**：SW 网页客户端直接加入原版 Terraria 1.4.5.8 IP 服务器，全功能可用。

**达成判定**：✅ 核心链路全通——加入/互见/聊天/装备/伤害/打击/弹幕/tile/拾取/箱子/
PvP/旅程/晶塔/ping/图鉴/氛围/旗帜/拴绳/液体/挂物框。验收矩阵 8/8 全绿
（`node scripts/vanilla-acceptance.mjs` 一键复验）。

## 二、收官八步对照（playbook 口径）

| 步 | 项 | 状态 | 凭证 |
|---|---|---|---|
| 1 | 定格 | ✅ | 验收矩阵 8 面 8/8 全 PASS（v4 基线） |
| 2 | 金标再生 | ✅ | recon-net-1458（163 消息 DRIFT=0）+ netmode-census（1475 处）+ frameimportant 闸门 |
| 3 | 门禁 | ✅ | 守卫 15/15（解码回放/帧表/协议结构）+ tsc 0 错误 |
| 4 | 独立复核 | ✅ | 每面独立探针互证（duo/strike/proj/relay/chest/pvp/liquid 各自独立进程） |
| 5 | 红队审查 | ✅ | 本文（见下节：已翻案 4 悬案+自伤 2 起+边界声明） |
| 6 | 判语+边界声明 | ✅ | 见 §四 |
| 7 | 登记债 | ✅ | 见 §五 |
| 8 | 档案 | ✅ | memory/vanilla-server-interop-scope.md 五战报+34 判例 |

## 三、红队审查记录（本战役特有风险与翻案）

### 3.1 已翻案的四大悬案（均曾误诊）
1. 「Chrome WS 派发停摆」→ 实为 msg49 枚举错绑 158（三账对照法定谳：桥下行=CDP=JS 处理计数一比一全等）。
2. 「E2E 黑屏」→ 实为首访欢迎公告浮层（rgba 0.72 黑罩）盖住完好渲染。
3. 「同名踢」名字断链 → SaveData['player'] 无 appearance 字段（正源=charStore.get）。
4. 「弹幕中继断」→ 探针 spawn 读偏移三连 bug（帧偏移 13/15 误用 payload 上，射手站错段 1700 格；服务器段门无辜）。

### 3.2 自伤 2 起（均已当轮修复+判例入档）
1. P4 大接线引入 msg82 模块体偏移错（payload[2] 起,曾用 [3]）→ Banners FullState 越界炸整条 WS 消息链 → fail-soft try/catch 分发体修复。
2. 钩子块 python 补丁锚定陷阱（锚串在 joinNetGame/joinVanillaGame 双现,replace 第一处=误插）→ 连续去重又两处全清 → vanilla join 钩子静默丢失 → vc.connect(url) 独有锚重挂。

### 3.3 边界声明（非墙,声明）
- Steam P2P 房间不可达（须 Steam 客户端）——覆盖面=IP:port 服（dedicated/TShock）。
- tModLoader 服不通（mod 握手层）。TShock SSC=后期扩展（客户端权威 vs 服务器权威物品账）。
- 需本地桥（浏览器无原始 TCP）：`server/ npx tsx src/vanillaBridge.ts --port 5290`。

## 四、判语

原版 1.4.5.8 网络协议对本仓**无不可跨越之墙**。数据面（帧/压缩/字段序）已全量
机械提取入金标并 DRIFT 锁定；混合权威模型（服务器 NPC/液体/事件 + 客户端玩家/
弹幕/物品）与 SW 引擎消费面天然对接——「加入方不需逐位一致仿真」定谳成立。
战役质量核心=每面先定谳（反编译源锚+rig 实弹）再动刀、修复后独立复核。

## 五、登记债（在册）

| 债 | 级别 | 说明 |
|---|---|---|
| Place style 恒 0 | P3 | msg17 放置样式变体落默认样式 |
| NPC 快照 maxHp=life 近似 | P2 | 线格式无 maxHp 段,受伤血条比例失真 |
| SetWire/SetActuated 上报差分 | P3 | TileOp 无旧值差分,布/拆歧义 |
| msg29 弹幕即时击杀 | P2 | 现 180t GC 兜底 |
| SSC 反向覆盖 | P3 | TShock SSC 服会覆写物品——不消费己槽 msg5 |
| 探针 verify 面世界持久化磨损 | 测试基建 | 多候选轮试已大幅缓解,durable 证据判定已上 |
| 验收面扩充（TE E2E 面等） | P5 | TE 渲染走单机链已落地,E2E 面待补 |

## 六、资产清单

- **代码**：`game/src/net/vanilla/`（codec/sections/VanillaClient ~1100 行）+
  `server/src/vanillaBridge.ts` + Game.joinVanillaGame 钩子面 + mainFlow 双入口（?vanilla=/面板）
- **工具链**：recon-net-1458 / recon-tileanim / recon-netmode-1458 / vanilla-acceptance
- **测试**：守卫 3 件（15 测）+ 验收矩阵 8 面 + 探针族 11 只
- **判例**：34 项（memory/vanilla-server-interop-scope.md 五战报）
- **进程**：rig(7781)/桥(5290)/vite5204 持续在跑

## 七、红蓝对抗终审补录（2026-10-25 深夜，用户令）

**红方攻击三条定谳：**
1. **★真 bug（已修）：sendPlayerHurt 桩**——victim-settles 是唯一伤害通路（服务器不跑
   接触判定：Player.Update 碰撞包在 `Main.myPlayer==whoAmI`；NPC.cs 零 player.Hurt），
   桩=服务器永不知我方 PvE 掉血。修：本地结算→msg117 上报（实证：本地伤 30→桥上行 117×4）。
2. **红方误报翻案：双伤假设证伪**——实测战斗窗 117 收包=0 而 hp 降=纯本地结算，
   与服务器 117 不并存（服务器根本不结算接触）。
3. **自报勘误**——此前战报「PvE hp 下降=msg117 实证」归因错误（实为本地结算）；
   verify 面升级双证据断言（挖掘 durable itemOps+伤害上报链）。

**在册债新增**：桥 `ws.on('drain')` 永不触发（ws 库无此事件——4MB 背压暂停永不恢复，
潜雷未触）；msg86 TE remove no-op（幽灵残物面）；strike 面 iframes 时序伪红已修
（连跑时前序战斗留 iframes——本地与服务器同拒=判例）。

**抽检通过面**：msg21 字段序/DisplayDoll mb 位/HatRack 2+2/msg17 线序/msg28 向+1/
PlayerHurtFlags 位映射/Leashed partial 无头直读——全部对反编译原文核过。

**终局**：验收矩阵 8/8（红蓝后复跑）+守卫 15/15+tsc 0。
