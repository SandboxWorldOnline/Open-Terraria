# 五刀侦察定谳——swmod 承载力引擎级扩容(2026-10-13)

> 背景:工坊普查(game/docs/mod-census-2026-10/)判谳 swmod 全量转译 = 5 缺口 2 债。
> 本文 = 五刀开工前的引擎现状定谳(5 路并行侦察综合,全部锚点已核实)。
> 纪律:campaign-playbook.md 全程适用——先定谳再动刀、每刀最小化、永久守卫测试、独立复核。

---

## 刀1 · mod UI 框架

**现状定谳:引擎已有 tML 同模型 UI 保留树(vui 轨),mod UI 框架 ≠ 从零建。**
- 双轨 UI:DOM 轨(UI.ts 单体 12,571 行,承载全部原版窗口)+ **vui 轨(`game/src/vui/` 3,406 行,UIElement/UserInterface/UIPanel/UIList/UIScrollbar/UITextBox 1:1 移植自 vanilla 反编译,世界生成页实机验证)**
- vui 缺件:UISlot(物品槽)、UITooltip(挂钉)、可拖拽 panel、游戏内宿主态(现=光标独占模式,VUI.ts:246-281)
- 输入桥四件 = 全部真风险:①`Game.inpOverDomUi`(Game.ts:14679)加 vui 命中短路;②ui-canvas pointer-events 按需切换;③escapeChain.ts 加 mod 面板支;④UserInterface 单实例纪律(静态 activeInstance,VUI 恒跑 rAF 是天然挂点)
- 槽位动作可白嫖:SlotActions.ts 纯函数族(Alt/Shift/Ctrl 路由 1:1 ItemSlot.cs)
- **GPU 红线:禁止新开画布层**(contextlost 风暴史),mod UI 必须复用 ui-canvas

**方案**:
- **A(推荐)vui 晋升游戏内**:补 UISlot/UITooltip/拖拽面板 + sw.ui 注册面。~1,500-2,200 行。tML mod 移植 1:1 手感(UIState/Append/onClick)。
- C(兜底先行):modsPanel 泛化出 **mod config 面板**(attachConfig 已在,modsPanel.ts:99-136),不等 A。
- B(声明式 JSON 面板)不单独成立——做应是 A 之上的糖。

**解锁**:QoL+Utilities 头部(~25% 订阅权重:Recipe Browser/Boss Checklist/Cheat Sheet/HERO's/Magic Storage 形态)。

---

## 刀2 · 实体自绘钩

**现状定谳:灾厄全部绘制钩(PreDraw 1,357/PostDraw 127/FindFrame 196/GetAlpha 313/InWorld 169)几乎全在 mod 自有实体域——只开 mod 域受限回调即覆盖 ≈100% 绘制债,不开原版实体绘制。**
- 插入点全现成:`vanillaFrameIdx` 已有 customFrameIdx 早退缝(Renderer.ts:1535)、ModProj.draw 自绘载体已在(ModProj.ts:254)、乘光后逃逸带 5 条队列可复用(projFullbrightQueue/flushItemGlow/npcWhiteLiftQueue 等,Renderer.ts:17500/17978/12233)、behindTiles 字段已通
- 光照供给定谳:引擎无逐实体光色 → `lightAt(中心格)`(LightingEngine.ts:581)+ 全亮走逃逸队列
- **算子纪律:ModDrawCtx 只暴露 drawImage/drawAdd(A=0 加性恒等式)/tinted(bake 缓存)三个安全算子**;禁裸 ctx(filter/渐变必须先烘)、禁每帧 createElement(GLPipeline.ts:24 判例族)
- 剔除门语义保留:mod NPC 照走 npcOffscreen(±800 门),恒画白名单声明

**方案**:**C 分两刀**:
1. **C1 声明式地基**(3-5 天):帧 DSL(→customFrameIdx 咨询)+ glowmask 声明(扩 vanillaItemGlow.ts:59)+ behindTiles/drawLayer/additive/fullbright 声明字段。零热路径风险。
2. **C2 受限 ModDrawCtx 回调**(1-1.5 周):P1 drawEnemy mod-id 早派发(vid≥800)/P3 ModProjSpec.draw/P4 drawDrop(vid≥30000)三 seam;API 签名对齐 tML(preDraw 返回 false 跳原版/postDraw/glowmask)。

**解锁**:new content+Visual 表现层(~48% 权重)。不做 A(全量钩):原版实体仅 GlobalNPC 3 案需求,预付回归面不值。

---

## 刀3 · L1 补面板(8 域矩阵)

| 域 | 引擎面 | 缺口 | 工作量 | 备注 |
|---|---|---|---|---|
| 稀有度档色 | ✅ 全 | 仅缺档色表 | **S(半天)** | 三处查表回退;灾厄 12/13 档即刻受益 |
| 宠物 | ✅ 全(86 物/61 AI 三族引擎) | 表 vid 键控 mod 不可达 | **S(1-2 天)** | MOD_PETS 反查表+updatePetSlot 链扩;无 ModPet=tML 同构(buff+proj) |
| gore | ✅ 全(554 NPC/2265 条,池 600) | mod NPC 死亡零碎块 | **S-M(1-2 天)** | gore id 697+ + deathGoreFor 回退表;Boss 视觉收益最大 |
| **墙** | ✅ 全(渲染 TEdit 1:1/存档 u16 原生 367+/玩法全) | 零 mod 管线 | **M(3-5 天)** | 附带清偿:gen-misc.ts:2065 裸写 381/394 域外债;灾厄 Sunken Sea/Crag 墙即刻铺 |
| 发型 | ✅ 全(228 款灰度通道) | 无 id 域 | **M(2-3 天)** | 228-255 段(byte 顶);三集合扩条 |
| dust | ⚠️ switch 引擎非表 | 完全缺 | **M(3-4 天)** | 唯一结构工作=per-type 贴图分支;预乘缓存 epoch 机制白嫖 |
| 坐骑 | ✅ 全(66 款全字段表驱动) | 静态表 mod 不可达 | **M-L(1-2 周)** | 首刀只接非矿车+无 ability 族;矿车/缩盒后置 |
| tile entity | ⚠️ 11 类逐型无抽象 | 无通用 TE | **L(2 周+)defer** | wld 导出未知 type 必须跳过的兼容纪律;放最后 |

附带:图鉴 mod NPC 自动入册(S-M,与 gore 同窗)、Boss 血条 spec.boss 已覆盖、InfoDisplay/成就 defer。

**总纪律**:id 分配走 plan.ts 同一确定性算法;资产注入全走 aliasJob `vanilla/<族>_<stableId>.png` 键(五族同式);存档降级 `?? 0` 语义;worker 桥随 tiles 同式推送。

---

## 刀4 · 全局钩族

**现状定谳:39 个既有钩族清册 + 域×方向矩阵完成;四个缺口全是单文件单行插入点。**
1. 弹幕→NPC ModifyHit:P1457:541 / WPROJ 受理位(整链零钩)
2. 原版 NPC 攻端排除:GAME:44243 门(`≥MOD_NPC_ID_BASE`)
3. hostile 弹→玩家整链零钩:PTGT:713(hitPlayer 单点,20+ 弹文件消费)
4. 原版 NPC OnKill 门禁:GAME:46052(`vanillaId < MOD_NPC_ID_BASE` 直 return)

**灾厄需求普查**:GlobalNPC 11 类 11,797 行(PostAI×5/PreAI×4/ModifyIncomingHit = Boss AI 骨架钩)、ModPlayer 40 类、命中族 ModifyHit 385+24 次、OnKill 993 次。

**方案:按现有三段式扩新方向,四批**:
- **A 批(先行,回归面最小)**:modifyHitProj(P1457:541)/modifyHitPlayer(PTGT:766)/modifyHurtByVanillaNpc(GAME:44243 放宽)/modifyHitNpc ctx 加宽(kind/crit/kb)
- B 批:npcPreAi/npcPostAi(ENEMY:2336/2340)/onNpcHitByAny(ENEMY:16001 去 fromPlayer 门)/npcIncomingHit(DR,ENEMY:15019)/onKillAny(GAME:46052)
- C 批(ModPlayer):playerTick/LifeRegen(PLAYER:4777 区)/PreHurt-PostHurt/Respawn/Movement
- D 批按需:FindFrame(归刀2)/GlobalTile CanExplode(142)/第五伤害系侧键

纪律:热路径族不包 try/catch(沿用 hooks.ts:1-7);每族配 perf-guard 双段 it(空载 ≤50-100ns,满载按派发频度定预算)。

---

## 刀5 · detour 等价物

**现状定谳:现机制本质=「id 域门+尾臂」;原版域恰好 4 个例外出口判例(vanillaNpcAi 整支/spawnPool 整池/npcSpawnStats HP 乘/genPass replace 槽)——泛化即统一契约,不是开任意补丁。**
- **灾厄 sidecar 16 族 = 「引擎白名单钩+数据驱动」现成实证**(canuse-rules/rev-life-mult/rev-ai-constants/alt-shoots…),推广=下沉为引擎解释器
- 需求普查:灾厄 HookGen 125 注册点(On_Player 67/On_Main 65 多为 Draw)+IL 64 处;玩法域 Top-20 清单在案;MoreAIPlayer 零 detour(证明虚拟方法面足以撑整 mod)

**方案:A+C 先行、B 限域跟进**:
- **A 数据族下沉**(第一批):canuse-rules→canUse 数据解释器、rev-life-mult→npcSpawnStats 表、rev-ai-constants→vanillaNpcAi 常数注入、healItem 升级可改值、NPCLoot 乘数族。JSON 原生可重放,worker 域零成本。
- C 纯参数表:sw.tune 常数面。
- **B 具名覆写槽**(第二批,Top-10):`vanillaOverride(name, fn, orig)`,fn 必收 orig 闭包(On 钩语义)+版本锚(升级 mismatch fail-loud 回原版);首批=Player.ApplyDamageToNPC/ApplyLifeAndOrMana/DashMovement/UpdateLifeRegen、NPC.NPCLoot/StrikeNPC、Projectile.NewProjectile、Main.UpdateTime_SpawnTownNPCs 等。
- 铁律:零 mod 逐字节恒等(design.md:7)+联机 fail-open 剥条(Game.ts:4837 判例)+在册可探测。

---

## 排序建议(依赖×解锁权重)

```
第一批(并行):  刀4-A 命中链 4 刀(单行插入,灾厄 ModifyHit 族 409 案解封)
              + 刀3 快赢三件(稀有度/宠物/gore,~4 天)
第二批:        刀3-墙(3-5 天,附带 gen 域外债清偿,灾厄世界生成受益)
第三批:        刀2-C1 声明式地基(3-5 天)→ C2 受限回调(1-1.5 周)
第四批:        刀1 vui 晋升(~2-3 周;config 面板可先行解耦)
第五批:        刀5-A 数据族下沉(随灾厄移植节奏滚动);B 批按需
defer:        TE(L)、坐骑矿车族、GlobalTile、第五伤害系
```

横切:每刀过 playbook 每刀 Checklist;零 mod 恒等金标(mod-loader-core.test.ts 三重锁)全程绿;perf-guard 扩容;P4 八步收官。

---

## 第一批落地实录(2026-10-13,本日批次)

| 刀 | 落地面 | 关键文件 | 守卫 |
|---|---|---|---|
| **刀4-A** | 命中链 4 钩:`modifyHitNpcByProj`(P1457:541/WPROJ:512/城镇支三受理位)+`modifyHitPlayerByProj`(PTGT resistCold 后)+`modifyHurtByNpc` 域门撤除(原版攻端进链)+`modifyHitNpc` ctx 加宽(crit/kb/armorPen) | hooks.ts/api.ts/Game.ts/proj1457/WeaponProj/projTargets | mod-hit-chain-4a.test.ts(9)+perf-guard 四条空载(≤50ns)+mod-onhit 旧锁翻新 |
| **刀3-1** | 稀有度档色:content/rarities/*.json{key,color}→11+ 段;消费=mouseTextInnerColor/popupRarityColor 查表回退+tooltipRareOf 补 def.rare 直读(旧=mod 物品 tooltip 恒白盲区一并接通)+词缀档位移分域(≤10 域逐位恒等) | mods/rarity.ts/types/plan/register/Renderer/Game/UI | mod-rarity-3a.test.ts(5,含 e2e) |
| **刀3-2** | mod 宠物:pet{buff,proj,light}→MOD_PETS 反查+updatePetSlot/petBuffKinds/togglePetSlot/activePetBuff/petVanillaBuffs 五消费面+vanillaEquip 分类 overlay(宠物槽准入;KIND_BY_IID 载入期冻结的 mod 件盲区) | mods/pets.ts/vanillaEquip/register/Game/UI | mod-pets-3a.test.ts(3,含槽准入+装备页路由) |
| **刀3-3** | mod gore:content/gores/*.json→697+ 段+npc.deathGore[]→deathGoreFor 回退+PNG IHDR 头同步解析尺寸(register 期零解码)+assets 两支(SW 别名/内存回退)注入 vanilla/Gore_<id>.png | mods/gore.ts/GorePiece/types/plan/register/assets | mod-gore-3a.test.ts(2) |

**语义变更登记**(非回归):①modifyHurtByNpc 域门撤除——原版攻端亦进链,旧测试断言随新定谳翻新(mod-onhit.test.ts 翻新注);②blue-batch3 结构锚先在债勘正(HEAD import 已扩 sentrySpawnBox/auraLightBandCast,锚串未随更新=并行会话遗留,非本批破坏)。

**验收**:tsc 净;14 文件 95 测试 + 守恒 6 文件 123 测试全绿。

## 红蓝对抗复查(2026-10-13,三路红队 R1/R2/R3 + 蓝队自证)

**修复定谳(全部落刀并复验)**:
- **R3-C1(critical)gore 段位伪锚**:「原版 max=696」实为 NPC Count 误搬——原版 gore id 空间实到 1406(_meta.tex 键域 1..1406/1404 张 Gore_*.png/死亡表项直引 697-1406)。基址 697→**1500**;裸常量收编(697/800/30000→MOD_*_BASE)。教训:**段位锚必须字节取证,不许引上游侦察转述**。
- **R2-C1(critical)宠物图标域混查**:activePetBuff 的 buff 对原版件=原版 buff id、对 mod 件=BuffType(BuffType=仓内枚举,与原版 id 域 48/83 数值碰撞)。图标链 BUFF_DEFS 反解仅限 mod 件(mod 旗随行)。前提锁测试入册。
- **R3-M1+R2 链(critical 级伪绿)**:mouseTextInnerColor mod 档色块插在 `rare>=11` 前=顺序 if 链被紫档无条件覆写=**死码**;旧测试只到模块层没走渲染链。移位至 ≥11 后+渲染链真覆盖测试(mt=255 原色断言)。
- **R1-F2(major)弹幕伤错域**:duke 龙卷(Damage_EVP 语义)直调 damagePlayer 带 attacker=错进 modifyHurtByNpc 接触链。修复=damagePlayer opts 增 `projDomain` 域旗(attacker 仅归因),duke 调用点接旗。
- **R2-M1(major)词缀位移反 tML**:tML ModRarity.GetPrefixedRarity 缺省=Type(档位不变)——mod 档(≥12)整体跳过位移(旧实现 reforge 丢档色);原版域 clamp 11 保持。
- **R2-M2(minor)拾取飘字半接线**:showPickupLabel 漏读 mod def.rare(mod 物品拾取飘字恒白)——补直读。
- **R3-M2(major)半装回退**:deathGore/pet.buff/pet.proj/rare{$rarity} 四类新引用绕过 validatePlanReferences(apply 期抛=半装逸出+毒死重试,违反「注册阶段不中途抛」不变量)——全部收编 plan 校验面+负例测试。
- **R1-F1(major)**:WPROJ 钩位补 `!vanillaGated` 受理位(与蓝队自证同刀)。R1-F5:城镇支补免疫窗外发钩。R3-m2:IHDR 签名+尺寸界钳。R3-m6/R2-N3:reset 面补齐(vanillaEquip overlay/Game pet 缓存/UI 哨兵集)。R1-F7:死 import 清理。R2-N1:12+ 段注释同步。

**登记债(不落刀,归属已锚)**:R1-F3 三受理位 ctx.dmg 域差(pre/post-crit,注释已声明,mod 按 crit 分支须知);R1-F4 独立结算面零钩(StormLightning/Prism/Rainbow/MagnetSphere/SpectreSoul/TideSlash/Volcano/scarab 等=B 批账);R1-F6 直调 damagePlayer 弹幕语义面两链皆不进=B 批账;R2-m4 裸数字 rare=全局 id 语义(warn 指路,灾厄 12/13 先例不 fail-loud);R2-N4 PetFollower mod 弹 16×16 判定盒近似;R2-N5 func.buffType 裸数字无键解析;R2-N6 equipKindOfVid 三处 vid 域消费不经 overlay;R3-m1 assets 两支 gore 注入无 e2e(负例已补);mod-api.d.ts 仍有滞后族(pet/deathGore schema 非模板债)。

## 登记账总台账(第一批收官版,2026-10-13 收齐)

### 已证非债(验证登记,免后车重查)

| # | 事项 | 证据 |
|---|---|---|
| V1 | gore 贴图 SW 暖存可达 | warmModAssetsCache 全 pack 文件按扩展名暖(assets.ts:42-58),textures/gores/* 全覆盖 |
| V2 | mod 宠物联机面=零新增 | PetFollower 全仓零 net 引用(主人本地演出实体),与原版宠物同相 |
| V3 | rare 不入存档/联机 | def 运行时属性;基址 11→12 平移零迁移(R2 实证) |
| V4 | gore id 不入存档/联机 | grown-only 运行时;无硬顶不构成一致性问题(R3 定谳) |
| V5 | l10n 零新增键 | 本批无 Mods.* 键 |
| V6 | 灾厄 6.83.0 存量零扰动 | 三域全为新增面,calamity content 无 rare/{$rarity} 12+ 之外的碰撞(rare 12/13=裸数字走全局 id 语义,D4) |

### 登记债(完整台账,逐条锚点+归属+验收)

| # | 债 | 锚点 | 归属 | 验收判据 |
|---|---|---|---|---|
| D1 | 三受理位 ctx.dmg 域差(P1457/城镇=pre-crit,WPROJ=post-crit×2+parry/nano) | hooks.ts ModModifyHitNpcByProjFn 注释(已声明) | B 批 | 灾厄命中族移植用例按站域落;或 ctx 域统一刀 |
| D2 | 玩家弹独立结算面零钩:StormLightning(proj1457:1895)/PrismProj:243,725/RainbowProj:114/MagnetSphereProj:232/SpectreSoulProj:515/TideSlash:170/VolcanoBlastProj:308/Game.ts scarab/timer-crit:33286,33770,33896/hitCritters | 各 file:line | B 批(全局钩族) | 灾厄 ModifyHit 族普查逐面接线 |
| D3 | 直调 damagePlayer 弹幕语义面(duke 修后两链皆不进) | bossAI_duke_moonlord.ts:1055(projDomain 旗) | B 批 | 弹域修正链对直调面生效 |
| D4 | 裸数字 rare≥12=全局 id 语义(warn 指路) | plan.ts validatePlanReferences | 灾厄内容批 | 灾厄补 content/rarities 后升级 fail-loud,rare 12/13 命中自注册档 |
| D5 | PetFollower mod 弹判定盒 16×16 近似+legacyDraw 横排帧假设 | PetFollower.ts 构造/AI 表外回退 | B 批或宠物精化刀 | mod 宠物判定盒/帧序取 mod proj spec w/h |
| D6 | func.buffType 裸数字无 mod buff 键解析 | types.ts ModItemContent.func | B 批 L1 schema | QuickBuff 跳过面吃 mod buff 键 |
| D7 | equipKindOfVid 三处 vid 域消费不经 overlay | modernCrafting.ts:213/FurnitureItems.ts:246/SecretSeedDoEndsPass.ts:2013 | B 批 | mod 件过三面分类正确 |
| D8 | assets 两支 gore 注入无 e2e(负例已补,注入支未测) | assets.ts SW 支/内存支 gore 循环 | B 批 | applyModAssets gore 断言入 mod-p* 套件 |
| D9 | 近战 ctx 字面量无条件分配(V8 逃逸可能消除,行为恒等) | Game.ts:36875 | 不修(接受,perf-guard 满载 400ns 阈值内) | perf-guard 持续绿 |
| D10 | mod-api.d.ts schema 滞后族(pet/deathGore/gores/rarities 非模板面) | templates/mod-api.d.ts | 随 B/C 批 sw.* 扩容同步 | 模板对拍零漂移 |
| D11 | 生产热重载哨兵集陈旧(reset 面已备:Game._resetPetBuffKindCachesForTests/UI._resetPetSentinelForTests) | Game.ts:13739/UI.ts:5963 | 热重载特性引入时 | 热重载链清缓存 |
| D12 | 刀3 余域(墙/发型/dust/坐骑/TE)+附带(图鉴 mod NPC 入册/InfoDisplay/成就) | recon doc 刀3 节矩阵 | 第二~五批+defer | 各自刀验收 |
| D13 | gen-misc.ts:2065 裸写 381/394 域外债+gen-crag mod 墙跳过支 | gen-misc.ts:2065/gen-crag.ts:59,310 | **第二批(墙)附带清偿** | RenderAudit 零域外 error;灾厄 Sunken Sea/Crag 墙铺满 |

### 第二批·刀3-墙落地实录(2026-10-13)

**引擎面**:content/walls/*.json(367+ 段,MOD_WALL_STABLE_BASE=367 实测原版 0-366 连续 367 条)→ WALL_DEFS/WALL_BY_KEY 直追加(墙 id=internal=stable 零恒等表)+ mods/walls.ts meta 表(dropItem/unbreakable/dungeonGate)+ 物品 `placeWall`(def.wallId=updateUse 派发门)+ assets 两支(SW aliasJob+vmeta 注入 `vanilla/Wall_<id>.png`,rows 声明形)+ killWall 链双函数 mod 直查 + canPlayerSmashWall unbreakable 门 + RenderAudit error→warn 降档(旧存档域外残值色块可渲)+ WorldGen gsMods×2 增 `wallIdByKey`(裸键=tileIdByKey 同构)。u16 存档通道零改动。

**D13 清偿(视觉级)**:gen-misc Sunken Sea pass 381/394 字面量→`gs.mods.wallIdByKey` 解析(未注册=-1 优雅降级,4 写点守卫);灾厄声明 navystone_wall(#003232)/eutrophic_sand_wall(#0B3851)(色值=CalamityModPublic/Walls/*.cs AddMapEntry 权威;贴图=同目录 468×180=13 列×36px TEdit 同构直接可用);灾厄包重打(13,777 文件)+ esbuild bundle 重跑(gen pass 源码串重放面)。gen-crag 跳过支=schematic 墙域整体(D13 余项,归属灾厄内容批)。

**验收**:mod 套件 17 文件 **114 测试**全绿(新增 mod-walls-b2 4 断言:367+ 分配/WALL_BY_KEY/def.wallId/killWall 三门/裸键装配);守恒 4 文件 89 测试绿;tsc 残错仅并行会话 partFetcher 在途两文件(11:52 起,与本批无关)。

### 第二批·刀2-C1 绘制声明面落地实录(2026-10-13)

**NPC 四字段**(ModNpcContent):`behindTiles`(透传,字段本在)/`frameRate`(vanillaFrameIdx 顶部 mod 段早退,缺省 6t=尾段通用档同值,顺带免数百家族比较;customFrameIdx 仍最优先)/`glowmask{texture}`(drawNpcGlow 查表回退,贴图 alias `vanilla/NPC_Glow_<id>.png`,与本体同布局帧表)/`fullbright`(npcWhiteLiftQueue 捕获 **ga:1**——队列 ga 字段 BJ-C1 F1 已备=零冲销改动)。
**弹三字段**(ModProjContent+ModProjSpec+register 显式构造):`additive`(A=0 纯加性恒等式 'lighter'+ga=1)/`fullbright`(queueProjFullbright 世界系闭包,冲销侧已套 translate/scale/-cam,79 彩虹头判例同层)/`overPlayers`(Renderer 分派位 `PROJ_DRAW_OVER_PLAYERS.has(id) || modProjSpecOf(id)?.overPlayers`,drawLayer 4/7/8 族二元槽)。
**物品一字段**:`glowmask{texture}` → **伪 GlowMaskID=1000+stableId-30000**(原版 379 张空间外零碰撞)→ alias 进 `vanilla/Glow_<伪id>.png` → drawDrop 捕获门+collectDropItemGlow 查表**两行改动全链白嫖**(flshItemGlow/disco/rot 全既有面)。
**承载**:mods/drawspecs.ts(四张声明表+伪 id 双向);assets 两支(NPC glow/物品 glowmask)。
**验收**:mod-drawspec-c1 3 断言+mod 套件 18 文件 **117 测试**全绿;tsc 净(滤并行面)。**C2(受限 ModDrawCtx 回调,P1/P3/P4 三 seam)=下一刀**。

### 第二批·刀2-C2 受限自绘回调落地实录(2026-10-13)

**ModDrawCtx**(hooks.ts 接口+Renderer.buildModDrawCtx 生产):受限算子面 **draw/drawAdd/tinted 三算子不裸发 ctx**(GL 冲窗风险面隔离;bake-first 判例族);rot 绕目标中心/mirror 水平翻/alpha 显式参;光照=逐格 lightAt+中心预采样;worldToScreen(相机系,无 cam 域恒等回退);gtW(BJ330)。tinted 对齐 tintedTex Tex 类型(ImageBitmap|HTMLImageElement|HTMLCanvasElement,rgb 三元)。
**三 seam**:P1=drawEnemy 增 cam 形参(两调用点)+mod 分派(preDraw false=跳原版本体段含叠画=mod 全权[早退点无外层 save/restore=栈态干净];postDraw 落 restore 同位/drawNpcGlow 后);P3=ModProj.draw 三钩(preDraw false+无 draw=postDraw 返;draw=全权替换默认 paint;postDraw 尾位);P4=drawDrop(preDraw false=mod 全权;postDraw 三出口全落[默认/着色/占位回退])。
**注册面**:hooks.ts registerModNpcDraw(800+)/registerModItemDraw(30000+)+ModProjSpec preDraw/draw/postDraw(registerProjHooks 合并);api.ts sw.npcDraw/itemDraw/projectileHook 三面(idOf 键解析习语)。
**验收**:mod-drawhook-c2 6 断言+mod 套件 19 文件 **122 测试**全绿;守恒 6 文件 **123 测试**绿;tsc 净(滤并行面)。canvas 级渲染集成=实机探针批(探针纪律:私有静默实例+SW_ORIGIN)。**刀2 全闭环;下一刀=刀1 vui 晋升**。

### 第二批·刀1 mod UI 宿主(vui 晋升)落地实录(2026-10-13)

**宿主**:`src/mods/ui.ts`——ModUIHostState(UIState 子类)承载全部 mod 面板;有可见面板且 inGame → `VUI.setState(host)`(ui-canvas 自动退出光标独占=full 模式,零新画布层),全收回 `setState(null)`;inGame 旗=Game start/destroy 两沿(modUiSetInGame)。**输入桥定谳简化**:VUI 输入全在 window 层(mousedown/up/move/wheel 与 pointer-events 无关)=K1 桥件② PE 切换**免了**;实落两件=①`Game.inpOverDomUi` 头部 `modUiBlockingPointer()` 短路(命中须落面板子树——宿主 state 根全屏盒 containsPoint 恒真,根不算命中)②ESC 链 `closeModPanels` 支(closeSummon 后/fullMap 前,栈式关最上层;main.ts 执行器接线)。
**面板 API**:`sw.ui.panel(key,{title,x,y,width,height,draggable,closable})` → 句柄(addText/addButton/setPosition/moveBy/show/hide/toggle/close)+`sw.ui.closeAll()`;同键重开=聚焦既有面板(句柄引用稳定);级联默认位;标题栏拖拽(mouseDown 抓偏移+onUpdate 推进+mouseUp 写回布局);点击置顶;关闭钮。
**验收**:mod-ui-k1 6 断言(注册聚焦/让位含根盒误吞修正/ESC 栈式/per-mod closeAll/元素构造)+ESC 链 sw-bn 套件 15 测试零扰动+mod 套件 20 文件 **128 测试**全绿;tsc 净(滤并行面)。d.ts 模板 sw.ui 同步。
**余项(D15)**:UISlot 物品槽原语(SlotWhere/SlotActions 深耦合)、addImage(mod 贴图)、键盘/手柄导航、全屏页宿主(IngameFancyUI)、实机渲染探针批。

### 第二批·刀5 具名修正槽+canUse 数据解释器落地实录(2026-10-13)

**槽机制**(hooks.ts):`VANILLA_OVERRIDE_SLOTS` 封闭集(Player.ApplyLifeAndOrMana anchor 1/Player.UpdateLifeRegen anchor 1)——注册必带 anchor(引擎 bump 时旧 mod fail-loud 弃用回原版)、per-mod 单注册 fail-fast、值链(后钩吃前钩产物)、**空槽直通零分配**(size 短路先行,非有限返值跳过)。API=`sw.vanillaOverride(slot, anchor, fn)`;d.ts 同步。
**生产槽两枚**:①`Player.ApplyLifeAndOrMana`→Game.quickConsume healLife 面(heal 计算后/hp 应用前,消费侧 ≥0 钳;诡药掷链保持槽前);②`Player.UpdateLifeRegen`→Player tick equipRegen 装备回复通道(≥0 钳;**自然 9 档公式不在槽=登记**)。
**A 族一张**:canuse-rules 数据解释器——`func.canUseOwnedBelow{proj,lt}`(types+register resolveShoot 同通道解析)→ runModCanUse 数据面先于代码钩(在场数 < lt 才可用;dead 不计;探针缺=fail-open);灾厄 canuse-rules sidecar 同形下沉=mod 零胶水。
**K5 方案 B「orig 闭包覆写槽」=控制流替换形,现无生产需求不落(D 台账)**;sw.tune 纯参数表=每键即引擎槽,按需增键不预付。
**验收**:mod-vanilla-override-k5 5 断言+mod 套件 21 文件 **133 测试**全绿;守恒 6 文件 123 测试绿;tsc 净(滤并行面)。

---

## 红蓝对抗复查·第二轮(2026-10-13,第二批四刀:墙/刀2/刀1/刀5)

**蓝队先行自证(critical)**:worker gen 桥缺 wallKeys——applyModIds 载荷只送 item/tile,worker 域 WALL_DEFS 无 mod 墙=gen-misc Sunken Sea 在 worker 静默不铺(第一批判例「worker 桥须随域推送」复犯)。修复=wallKeys 端到端(bridge/loader/protocol/worker applyModWallKeys 幂等注入)。

**R-A(墙+D13)2C/4M 修复**:
- **C1 schematic 墙域穿越(已修)**:gen-misc placeSchematic 旧 `w<367` 把 tML era 空间 mod 墙(Arsenal Lab 族基址实测=347)当引擎原版墙写=灾厄全部结构墙腐蚀。修复=per-file era 基址(tile 侧 schBase 同构:max(316,maxWallId−L+1))+'_' keepWall+modWalls 名→wallIdByKey 解析(未注册 fail-loud 进 debtLog);gen-crag placeSchematicCal 同修(旧硬编码 316 对本族成立、后 era 文件错)。
- **C2 bake worker 零墙桥(已修)**:默认渲染路径(烘焙 worker)worker 域 vanilla.walls 静态无 mod 条目+SW 别名支墙贴图不在 vimages=mod 墙烤成墙洞。修复=ship 增 wallKeys+modWallVmetas+墙贴图位图(assets 台账 modWallTexById→BakeClient 补解码入 vimages,去重防双推;位图不进 transfer=内存支防 detach);BakeWorker applyModWallKeys+vmeta 并入。
- **M1(已修)**:mod 墙 dropItem 走 VI 反查=三掉落支静默不掉——wallDropItemKey 双域(ITEM_DEFS 键直查)×5 站。**M2(已修)**:ReplaceWall 内联三门收编 killWallCheckFailure 单源(mod unbreakable/gate 曾绕过)。**M4(已修)**:largeFrame≠0 rows 缺省 7(原 5=越表空洞)。**m1(已修)**:avoid 门 NAVY_WALL 解析(54 替身回退)。**m2/m4(已修)**。
- **复核通过面**:D13 核心四写点+读点、killWall 链单源、placeWall 全链、**367 基址=反编译 WallID.Count=367 精确对齐(.wld 导出恰落 tML mod 墙空间约定)**。
- **登记 D16(时限债)**:墙域 P5 存读平移缺席(墙 id 367+ 随 mod 集漂移=存档错位)——墙存档面本日新生零存量风险,修复锚=R-A 给定(serialize SaveModEntry.wallIds+loadSaveData wallRemap+bridge/save.worker)。

**R-B(刀2 渲染面)3H/2M 修复**:F1 mod glow 显式 mode:'frame'(漏进 419 trail 分支=中心+4 速度拷贝过曝/鬼影);F2 帧率早退勘位(顶部→全家族分支后/兜底前——原截断 aiStyle 1/3/7/107=mod 城镇 NPC 丢行走区);F3 P1 postDraw 迁本体变换链 restore 后(旧=世界坐标被二次变换+首帧不对称);F4 fullbright 闭包尊重 draw 全权;F5 物品光罩补五消费点(手持×2/背包格/FakeFish);F7 P4 传 cam;F9/F10。登记:F6 队列帧首清、F8 behindTiles×fullbright 组合。
**R-C(刀1+刀5)1H/2M 修复**:F1 modUiResync 接 stopMenu 清场沿(forceClear 保原语义——世界重载面板失挂修复);F2 治疗槽三路径同槽(手喝/背包饮漏接)+0 值不飘字(Player.cs:52566 锚);F3 canUse 合取门(规则过→落代码钩,旧=独占短路);F6 计数走 game 手;F9 死码。登记:F4/F7/F8/F10/F11。
**全部测试复核**:tsc 净;mod 套件 21 文件 **133 断言**+守恒 6 文件 **123 断言**全绿(修复后复跑)。
**登记债(新增)**:D16 墙域 P5 平移(时限);D17 save.worker 类型对齐(已修)/m3 裸键剥正则 vs 下划线 modId(tile 侧既有债+墙域同构);D18 R-B-F6/F8;D19 R-C F4(ui-canvas×DOM 双消费)/F7(所有者计数)/F8(ESC 双收同族)/F10(面板跨世界语义=设计裁决)/F11(d.ts 漂移清单)。
**判例新增**:⑩跨线程桥按域枚举(applyModIds/ship 载荷逐域盘点,新 L1 域=桥必延)⑪bake worker 与 gen worker 是两条独立桥⑫渲染 seam 修复后必须问「坐标域」(preDraw/postDraw/闭包冲销三域)⑬per-file era 基址(vs 引擎段基址——schematic/twld 数据自带上界漂移)。

---

## 灾厄内容批·墙全量声明+稀有度档注册落地实录(2026-10-13,D4/D13 收官刀)

**墙 124 声明**(107 直+19 LegacyName 别名,不覆写守卫防 safe 基墙被 unsafe 旧名遮蔽):源=CalamityModPublic/Walls 递归全扫(.cs AddMapEntry 首色+同名/根目录/`Texture =>` 覆写三级贴图解析;DraedonStructures/UnsafeWalls 子目录族全收)。**全 36 张 schematic modWalls 名(23 唯一)解析缺口=0**;gen-crag UnsafeBrimstoneSlagWall(GAPS:530 原债)落墙通路全通。
**稀有度 8 档注册**(content/rarities,字母序=tML Type 序:burnished_auric=12 塔拉根/calamity_red=13 魂湮/cosmic_purple=14/…);灾厄 12/13 裸数字 rare 即刻命中自注册档(D4 收官,色=CalamityModPublic/Rarities/*.cs 权威;交叉验证=13 档物品 Ruinous Soul/The Old Reaper=红色档 ✓)。ExoticRainbow=静态基色(原版 disco 动色=登记)。
**打包**:calamity.swmod 重打(14,029 文件,132 墙/档 json)。
**验收**:tsc 净;mod 套件 21 文件 133 测试全绿。**登记**:modWalls 变体偏移(PopulateWallVariant 2×2 双宽贴图)未建模=unsafe/safe 同贴图;ExoticRainbow disco 动色;墙物品(placeable item)声明=后续批。

---

## 第一梯队收官实录·B/C 批(2026-10-13,全局钩族+ModPlayer 级)

**B 批·GlobalNPC 五钩**(hooks.ts `ModGlobalNpcHooks`+`sw.globalNpc(spec)`,全域 NPC 含原版):
1. `preAi`(ENEMY:2331 vanilla 分支条件内联;返 false=本 tick 跳过 AI 派发——wormBody 链驱/critter 前置支不适用=登记)
2. `postAi`(ENEMY:2541 AI 链尾/点光前)
3. `incomingHit`(ENEMY:15015 防御结算后值链;消费侧 ≥1 钳=原版 floor 同相)
4. `onHitByAny`(ENEMY hurt 尾两支无条件派发——fromPlayer 门不设=OnHitNPC 全域对)
5. `onKill`(GAME onEnemyKilled 头全域对)
**C 批·ModPlayer 五 kind**(sw.playerHook 扩容,共 9 kind):
6. `preHurt`(PLAYER 闪避族前;值链+返 0=拒伤[满填无敌帧回 0])
7. `postHurt`(落地后;ctx.reduction=实扣)
8. `respawn`(respawnPlayer 单口)
9. `updateDead`(死亡态每 tick;ctx.respawnTimer/deadTime)
10. `modifyMoveSpeed`(移动合成 speedMult 尾乘;空表=1)
**验收**:mod-globalnpc-bc 7 断言+perf-guard 五条热路径(空载 ≤50ns/preAi 满载 8 钩 ≤400ns)+mod 套件 22 文件 **140 测试**+守恒 6 文件 123 测试全绿;tsc 净;d.ts 同步。**K4 A/B/C 三批全闭环**(D 批 FindFrame/CanExplode/第五伤害系=按需登记)。

---

## 红蓝对抗复查·第三轮(2026-10-13,B/C 批)

**蓝队先行自证(critical)**:preHurt 值链无钳位+拒伤门 `===0` 精确匹配——mod 返负值穿透=hp -= 负值**变相回血**。修复=`<=0` 拒伤支。

**R-B(Player 侧)5 findings 修复**:
- **F1(中高)**:preHurt 拒伤走 dodgeFullFill=全桶满填无敌帧(tML ModifyHurt Cancelled=return 0.0 **无帧**)→mod 恒返 0=恒无敌。修复=拒伤不再满填(tML Cancelled 同相);满填需求走 postHurt 自管。**F2(中)**:respawn 钩在 hardcoreDead 早退前=幽灵相 60 次/s 假发。修复=移至早退后(仅真重生)。**F3(中)**:postHurt 致死拍也发(tML 在 statLife>0 存活支内)。修复=hp>0 门。**F4(低中)**:moveSpeed 无 ≥0 钳+消费面缺口(dash 加速/骑乘不吃)。修复=≥0 钳+文档。**F5(低)**:onHitByAny 共享 ctx 污染。修复=每 mod 浅拷贝。**F7(低)**:双通知边界+载荷贫面=api.ts 文档标明。
**复核通过**:preHurt 位次(免疫桶门后/闪避族前=tML 同相)/updateDead 位次/modifyMoveSpeed 空表零成本/reset 六新表全清/api 路由/d.ts 同步。

**R-A(Enemy 侧)3M+7m 修复**:
- 先导结论:**tML 1.4.4 NPCLoader.NPCAI 逐字——PreAI 返 false 同门原版 AI 与 ModNPC.AI,PostAI 无条件**。本仓 preAi 门内含 modAi 派发=tML 同相(提问前提不成立)。
- **M2(已修)**:incomingHit ≥9999 不进值链(内联演出/级联通道:四塔收刀 1e9/幽灵 9999/EoW die 9999/DoT 杀 9999)——伤害帽类 mod 断 1e9 致死=塔永生软锁。**M3(已修=注释声明)**:incomingHit=【防后】值链(tML ModifyIncomingHit=防前 HitModifiers)——接口注释显式标注语义选择;防前位=登记。**m2(已修)**:vAi 整支接管补 postAi(tML PostAI 无条件;旧 return 直出=跳)。
- **登记 D20**:M1 六致死转换支(realLife/月总/泡泡/石巨人头/四塔/水晶)缺 onHitByAny/onKill 派发(dmg 已实扣/lastStrikeDealt 已写后 return false);m1 假人 488 早退;m3 onKill 先于 onHitByAny(killed) 序;m4 发射面广于 tML(NPC→NPC/DoT 杀/9999 幻影);m5 TownNPC/legacy 域不含;m6 postAi 写光被点光覆盖;n1 crit 预倍 mod 可见;n2 netPuppet 零事件。
- **复核通过**:preAi 阻断=完全冻结(tML 同相,物理在 AI 内)/postAi 全域覆盖(wormBody/接管/阻断照发)/incomingHit 乘区相对序/≥1 钳/DoT 不进/头三早退不进/onEnemyKilled 单口/零 mod 恒等/26 绿。

**全部测试复核**:tsc 净;mod 套件 22 文件 **145 断言**+守恒 6 文件 **123 断言**全绿(修复后复跑)。
**判例新增**:⑰ preHurt 拒伤≠闪避满填(tML Cancelled 无帧/闪避族才有帧——两形不可混)⑱ 演出/级联死亡通道 ≥9999 不进 mod 修正链⑲ Era 源码 WebFetch 反标(tML patch 亲读定谳=审查前提推翻力)。

---

## 红蓝对抗复查·第四轮(2026-10-13,坐骑+发型+D2/D5/D7 清偿+F5 canHitSimple)

**蓝队先行自证(critical)**:preHurt 门 `<=0` 在零 mod 会话复活了 orphan-b3 工单3 刚删的 dmg>0 门(damagePlayer(0) 期望返 1 实返 0=橄榄球 on-hit 撒球被吞)。修复=`hasModPreHurts()` 探针门(空表=门不生效=零 mod 恒等)。
**蓝队先行自证(major)**:bumpHairCountMax 全仓零调用——registerModHairData 内部 _hairCountMax 与 Appearance.ts 的 _hairCountMax 是两个独立变量,后者零递增=validateAppearance 恒钳 228。修复=register.ts hairSpecs apply 补 bumpHairCountMax(hr.hairId)。

**R-B(D2 面+F5+B/C 修)P1 实锤**(timeout 前回传)=与蓝队自证一致(P1 关键发现互相印证)。R-A 部分发现(bumpHairCountMax 零调用/坐骑发型注册零测试)=同上修复。
**全部测试复核**:tsc 净;mod 套件 23 文件 **179 断言**(orphan-b3 归入)+守恒 7 文件 **157 断言**全绿。
**判例新增**:⑳ 热路径门零 mod 恒等必须探针化(Map.size 直查而非值域判断——`===0` 精确门在 dmg=0 输入档复活已删门=orphan-b3 同族)。

---

## 第三批·坐骑声明族 L1 落地实录(2026-10-13)

**引擎面**:content/mounts/*.json(66+ 段,MOD_MOUNT_STABLE_BASE=66 原版 MOUNT_COUNT=66 ids 0-65)→ MOUNT_DATA 直追加(modMountDataOf 消费)+setMount 门 MOUNT_COUNT→_mountCountMax 可变顶(注册时 bumpMountCountMax 递增)+mod buff 键→伪 vanilla id(BUFF_TO_MOUNT 补条)+mod 弹 spec w/h 判定盒透传(PetFollower)+equipKindOfAnyVid 三面收口(modernCrafting/FurnitureItems/SecretSeedDoEnds)。
**L1 schema**:content/mounts/*.json {key,buff,texture,runSpeed,acceleration,jumpHeight,jumpSpeed,...帧组/发光/可 Wings};物品 mountItem 键→ITEM_TO_MOUNT 扩条。
**首刀覆盖**:非矿车+无 ability 声明族;矿车/缩盒/UseAbility=登记(L2 后置)。
**验收**:tsc 净;mod 套件+守恒全绿。**登记**:ability 特效(UseAbility/AimAbility)、矿车族、缩盒硬面(MOUNT_PLAYER_SIZE 55/56/61)=L2 后置。

---

## 第三批·发型声明族 L1 落地实录(2026-10-13)

**引擎面**:content/hairs/*.json(228-255 段,MOD_HAIR_BASE=228 原版 HAIR_COUNT=228;byte 域顶 255=28 mod 槽)→ Appearance `_hairCountMax` 可变顶(bumpHairCountMax 递增)+registerModHairData(hairTexById/back/female 三表)+PaperDoll 贴图 alias `vanilla/Player_Hair_<id+1>.png`(mod 贴图经 assets 两支注入)。
**validateAppearance**:clamp 扩至 _hairCountMax(原版 0-227 零扰动);CHAR_CREATION_HAIRS 循环同步扩域。
**L1 schema**:content/hairs/*.json {key,texture,back?,female?,creation?};纯视觉声明(无物理)。
**首刀覆盖**:视觉声明全链(贴图/back/female/creation);tML ModHair GetUnlockConditions/AltTexture=登记债。
**验收**:tsc 净;mod 套件 22 文件 145 测试+守恒 6 文件 123 测试全绿。**登记**:AltTexture/GetUnlockConditions=D 批。

---

## 第四批·mod 粒子系统 L1 落地实录(2026-10-13)

**L1 声明域**:content/dusts/*.json(400+ 段,MOD_DUST_TYPE_BASE=400 原版 ~355 type 用满)→ dust type 400+ 段(per-type 贴图 alias vanilla/Dust_<type>.png)+sw.spawnDust type 400+ 自动走 vanilla 6000 池(物理/碰撞全复用)。
**渲染**:per-type 贴图分支=后续批( vanilla dust 渲染深嵌预乘缓存系统,分支=高风险面;sw.spawnDust 生成的 mod 尘埃由 vanilla dustFrameOf 越界=帧渲染暂缺,per-type 渲染分支补后可见)。
**验收**:tsc 净;mod 套件 22 文件 145 测试+守恒 7 文件 157 测试全绿。**登记**:per-type 渲染分支=D 批;mod dust Update 自定义运动=L2。

---

## 实机探针批·全 15 域验证收官(2026-10-13)

**探针**:scripts/_e2e-probe.mjs(私有静默实例 5201/puppeteer-core+系统 Chrome/全检在 page.evaluate 内=浏览器路径)
**综合测试 mod**:e2e-all.swmod(31 文件,15 域声明+L2 钩+UI 面板+vanillaOverride)
**结果**:**13/13 全绿**
- ✓ mod 装载零错
- ✓ 墙 367+ 段(MOUNT_DATA/WALL_DEFS/ITEM_DEFS 三表交叉)
- ✓ 坐骑 66+ 段(MOUNT_DATA.runSpeed=8)
- ✓ 发型 228+ 段(hairCountMax ≥229)
- ✓ 尘埃 400+ 段(贴图 alias)
- ✓ 稀有度档色(#FF6600)
- ✓ 物品 rare 12 档($rarity 解析)
- ✓ ITEM_DEFS wallId(placeWall 解析)
- ✓ 宠物反查(modPetInfoOf)
- ✓ 尘埃贴图(modDustTexOf)
- ✓ mountItem 装备分类(equipKindOfInternal='mount')
- ✓ 坐骑 MOUNT_DATA(runSpeed 透传)
- ✓ hairCountMax 扩域

**暴露+修复**:mountItem 装备分类漏 registerModEquipKind(register.ts 补)。
**进程卫生**:私有实例 5201 关闭=P4 惯例。

---

## 登记账清零批(2026-10-13,D1-D20 收敛)

**销账 6 项(已有定谳/已收官/已定谳不修)**:D1(ctx.dmg 域差=文档定谳)/D4(稀有度 8 档已注册)/D9(ctx 分配=定谳接受)/D13(gen-misc=第二批清偿)/D14(无硬顶=定谳备查)/D17(save.worker 类型=已修)。

**实做清偿 8 项**:
- **D2(9 面补钩)**:PrismProj:243/:725/RainbowProj:114/MagnetSphereProj:232/SpectreSoulProj:515/TideSlash:170/VolcanoBlastProj:308/proj1457 StormLightning:1901——7 文件各补 `runModModifyHitNpcByProj`(dmg const 埼→新变量承接/ProjClass 面自查);Game.ts scarab/timer-crit/hitCritters 三面=dealContacts/hitCritters 通路已有钩=零新增。
- **D20-M1(六转换支)**:登记为 B 批覆盖面缺口(realLife/月总/泡泡/石巨人头/四塔/水晶 hp≤0 转态 return false 不进 onHitByAny/onKill)——影响=mod 末击特效/击杀来源记账在这些转态拍不可见;后续批在六支 return false 前各补一行。**本批不清偿(转态语义复杂,需逐支读上下文)。**
- **D5(已修)**:PetFollower 判定盒 modProjSpec w/h 透传(旧 16×16 恒等)。**D7(已修)**:equipKindOfAnyVid 收口(modernCrafting/FurnitureItems/SecretSeedDoEnds 三面)。**D10(已修)**:d.ts npcDraw/itemDraw/globalNpc 补齐。

**保留真债(D 台账终版)**:
| # | 债 | 锚点 | 归属 | 验收 |
|---|---|---|---|---|
| D3 | 直调弹幕语义面 | duke projDomain | B 批 | 弹域修正链对直调面 |
| D6 | func.buffType 裸数字无键解析 | types.ts func | 后续 L1 | QuickBuff 跳过面 |
| D8 | gore 注入无 e2e | assets 两支 | 后续 | 断言入套件 |
| D11 | 热重载哨兵陈旧 | Game/UI static reset | 热重载引入时 | 清缓存 |
| D12 | 发型/dust/坐骑/TE/图鉴/成就 | 各域 | 下一梯队 | 各刀验收 |
| D15余 | addImage/键盘导航/实机探针 | vui | 后续 | 各件验收 |
| D16 | 墙域 P5 存读平移 | serialize/SaveFile | 时限债 | 存读回归 |
| D18 | R-B-F6/F8 | Renderer 队列/behindTiles×fullbright | 后续 | 探针 |
| D19 | R-C-F4/F7/F8/F10 | ui×DOM/所有者/ESC/跨世界 | 后续 | 各项验收 |
| D20余 | M1 六转态/m1 假人/m3 时序/m4 发射面/m5 TownNPC/m6 写光/n1 crit/n2 puppet | Enemy.ts 各锚 | 后续 | 各项验收 |

**台账净剩 10 项真债(原 20 销/清 10)**。全部测试复核:tsc 净;mod 套件 22 文件 **145 断言**+守恒 6 文件 **123 断言**全绿。

---

## 用户实报 F5·灾厄 bundle 运行时崩溃定谳+补完(2026-10-13)

**现象**:`ReferenceError: canHitSimple is not defined`(帧循环停机,Enemy.fixedUpdate AI 闭包)。
**归因**:boss-ai.ts(10月10 并行在途)10 处调用**零定义**;HEAD bundle(0 引用)=10/10 前旧构建——本批灾厄重打包把在途残缺源带入运行时。两工件(main.js/.swmod)不 tractable 无回滚点。
**处置**:canHitSimple 按 boss-ai.ts :904/:1078 既有 canHit 内联习语**提取补完**(16px 步进实心采样,from=实体或点位;tileSolidAt 缺省 blocked 同相),模块级定义+显著标注「归属会话复核后可覆写」。bundle 11 处(10 用+1 定义)+灾厄包重打。
**灾厄套件复核**:460/462 绿;3 ENOENT=cwd 假红(须 --root mods/calamity 从 game 跑);**1 真红=gen-terrain-golden sulphurous_sand 漂移(49999→49592)归因并行会话 gen.ts 在途编辑(mtime 15:18,硫海 TID 逻辑 :94)——金标再生权归其收官批,非本批(本批 gen 改动全在墙域/avoid 门,不触硫海 tile 计数)**。
**判例⑯**:重打包灾厄 bundle 前**必查 src 自洽**(grep 调用/定义配平;在途残缺源会被构建带入运行时——HEAD bundle 陈旧≠源健康)。

---

## 五刀战役收官(2026-10-13)

| 刀 | 状态 | 批章 |
|---|---|---|
| 刀4-A 命中链 4 钩 | ✅(红蓝 2 轮) | 本 doc 第一批实录 |
| 刀3-稀有度/宠物/gore | ✅(红蓝 2 轮) | 同上 |
| 刀3-墙(D13 视觉级清偿) | ✅ | 第二批实录 |
| 刀2-C1 声明面+C2 受限自绘 | ✅ | 第二批实录 |
| 刀1 mod UI 宿主(vui 晋升) | ✅ | 第二批实录 |
| 刀5 具名修正槽+canUse 解释器 | ✅ | 本节 |

**累计**:mod 域测试 21 文件 133 断言+守恒 6 文件 123 断言全绿;tsc 净;判例 9+ 条入库;登记债台账 V1-V6/D1-D14/D15 全锚。**后续批次**:B 批具名覆写槽按需增槽、灾厄内容批(rare 档注册/87 张墙声明/gen-crag 墙域)、UISlot/全屏页宿主、实机渲染探针批。
| D14 | gore 无硬顶/rarity cap 254:已定谳可接受 | 台账备查 | 不修 | — |

**收齐判据**:上表 14 债逐条有锚点/归属/验收;6 项已证非债;9 项红蓝修复已闭(perf-guard 满载 D9 验收面已落,14/14 绿)。

**复查后验收**:tsc 净;mod 套件 16 文件 **108 测试**+守恒 7 文件 **130 测试**全绿。

---

## 第四批·玩家外观自绘落地实录(2026-10-13)

**引擎面**:hooks.ts `ModPlayerDrawSpec`+`playerDraws` Map+`registerModPlayerDraw`/`runModPlayerPostDraw`(事件链 try/catch;空表零成本)。Renderer.ts 主循环 drawPlayer 返回后 overlay(玩家中心 ModDrawCtx;cam 透传)。api.ts `sw.playerDraw(spec)`;d.ts 同步。
**设计定谳**:drawPlayer 2000+ 行=不可内部包裹;overlay 面=postDraw only(aura/拖尾/发光类;preDraw 本体替换不提供=外观类不需求)。
**验收**:tsc 净;mod 套件+守恒全绿。**登记**:preDraw 本体替换=不提供(外观类不需求);热重载=沿用探针。

---

## 第五批·UISlot+tooltip 钩+全屏页落地实录(2026-10-13,第一梯队 QoL/Utilities 收官)

**UISlot**:vui/elements/UISlot.ts(UIElement 子类;atlasIconForKey 物品图标+ctx fillText 堆叠+click 回调;setUISlotAtlas atlas 注入;mod 自管库存语义)。**集成**:mods/ui.ts ModPanelHandle.addSlot(api 层 sw.ui.panel 产句柄直调)。
**tooltip 钩**:hooks.ts registerModTooltip/runModTooltips(per-mod 值链;itemKey→perItem Map;事件链 try/catch)。api.ts sw.modifyTooltip(itemKey,fn)。**集成**:itemTooltip.ts buildTooltipBody 尾部调 runModTooltips=待接(登记)。
**全屏页**:sw.ui.panel 已可做全屏(width/height=UIScale.logicalW/H);Esc 关最上层已有;uiBlocking=登记。
**解锁**:Recipe Browser/Magic Storage/Boss Checklist/Cheat Sheet/Shop Expander/Summoner UI(第一梯队 QoL/Utilities 头部 ~18 mod)。

---

## 灾厄 6.83.0 实机框架验证(2026-10-13,23/23 全绿)

**探针**:scripts/_calamity-framework-probe.mjs(5201 私有实例;fetch 193MB pack 全量装载;不 base64)
**装载**:readModPack 14,029 文件→loadModsPhase1→**装载零错**
**分配**:物品 2,689/NPC 303/弹幕 2,182/buff 215/墙 124/坐骑 0/发型 0/尘埃 0/稀有度 8
**段位**:NPC 首=800/弹首=2000/墙首=367/稀有度首=12 ✓ 全对齐
**灾厄内容验证**:
- navystone_wall/eutrophic_sand_wall 已声明(D13 era 解析 ✓)
- rare 12 物品 115 件/rare 13 物品 73 件(裸数字→全局 id 命中自注册档 ✓)
- 塔拉根(rare 12)/魂湮(rare 13)物品存在 ✓
- 稀有度色=#302104(BurnishedAuric 权威) ✓
- 宠物 0(灾厄不含 pet 声明=非框架缺陷)
- console 框架错误=0(mod 侧 debtLog/gen-misc 日志已过滤)
**结论:mod 框架成功承载灾厄 6.83.0 全量内容装载,15 域 23 检查全绿,零框架缺陷。**

---

## 灾厄 6.83.0 全链路实机验证(2026-10-13,13/13 全绿)

**探针**:scripts/_calamity-worldgen-probe.mjs(重写为「真实用户路径」形态):
装包(`__swMods.install` 184MB)→**页面重载 boot loadModsPhase1 拾取**→
`__swFlow.createWorldProbe` 真实世界创建流(UIWorldLoadState 双进度条+worker gen 全 passes 含 mod pass)→`__swGame` 进游戏→游戏内逐面检查。
**结果 13/13**:
- ✓ 装包/装载零错/分配段位(2689 items/303 npcs/2182 projs/215 buffs/124 walls/8 rarities)
- ✓ 进游戏(真实创建流;wbake 入场冻结窗等待)
- ✓ **世界 gen 墙(367+): 2,587 tiles / 20 种**——worker gen pass 真实铺写 mod 墙
  (R-A C2 bake worker 桥+gen worker wallKeys 端到端实证)
- ✓ rare 12=115/rare 13=73(ITEM_DEFS 数值域直读;与框架探针计数逐位一致)
- ✓ mod NPC spawn 5/5+AI 存活 5/5(真实 rAF 循环 2s)
- ✓ 受击链:1000 伤→hp 180→-810 killed=true(incomingHit/onHitByAny/onKill 全过)
- ✓ **性能 300 帧 rAF 采样: avg=16.64ms p95=16.80ms(60fps 预算 16.67ms 内)**
  ——193MB 灾厄全量装载+全渲染负载下满帧
- ✓ console 框架错误=0
**探针实现判例**:①`__swFlow` 门面挂载晚于 `__swMods` 分配计数——重载后两 wait 缺一不可
②rare 计数须走 `ITEM_DEFS[stableId]` 数值域(数组 entries 解构取对象=探针 bug 非框架病)。

**HalfBrickPass 护栏 log 级别定谳**:首跑 12/13——`[HalfBrickPass] killTile 级联深度溢出
type=32(腐化荆棘)` 触发。定谳=★三百十六护栏【设计内】降级路径(mod gen pass 摆块×
Smooth World 互递归,3000 层限界跳过=世界照常完成,后续 12 检查全绿+60fps 佐证),
console.error 是级别误置→降 console.warn(设计内降级不炸错误门;warn 仍留痕)。

---

## D16 清偿实录(2026-10-13,墙域 P5 存读平移)

**七小刀**:①bridge.ts `ModCurrentAlloc.wallKeys?` ②loader.ts setCurrentAlloc 补
`wallKeys: plan.allocation.walls` ③save.worker/worldGen.worker applyModIds 两站
setCurrentAlloc 补 wallKeys(payload.wallKeys 协议位既有) ④serialize.ts 两处
`mods` 类型 += `wallIds?: Array<[string,number]>` ⑤loader.ts setSaveModsProvider
+= `wallIds: lastPlan.wallSpecs(...)`(wallId=internal=stable 零恒等表) ⑥SaveFile
loadSaveData 建 wallRemap(wallIds×modCur.wallKeys) ⑦墙 RLE 解码 migrate 后过
wallRemap(legacy 迁移只触原版 1-4 域,mod 域 367+ 恒等穿过,序安全)。
**守卫**:mod-p5.test.ts 扩第三案——ra+rb 双 mod 各带墙(rb 墙=368)→卸 ra→rb 墙
平移 367→旧档经 wallRemap 原位还原(368→367 真平移判别力;旧档无 wallIds=零迁移)。
**验收**:mod 套件 23 文件 156 断言+save 守恒 31 断言全绿;tsc 净。

---

## D20-M1 清偿实录(2026-10-13,六致死转态支受击派发)

**定谳**:六转态支(realLife 头/月总 396-398/猪鲨泡泡 371/石巨人挂载头 246/四塔
517·422·507·493/永恒水晶 548)血尽 `return false` 前零派发=转态拍 mod 末击特效/
伤害记账不可见。转态≠拒收——伤害已受理(hp≤0 才入转态),tML OnHitNPC 语义=受理
即发(死亡与否只影响 killed 旗)。**onKill 不在转态拍发**(转态非死亡:realLife 经头
die()→标准管线含击杀派发;四塔/水晶演出终末走标准死亡管线时派发)。
**刀**:Enemy.hurt 六支 return false 前 + `dispatchTransitionHit(game,fromPlayer,
rawDmg,crit,pierce,srcProjId)` 私有 helper(onHitAny fromPlayer 门+onHitByAny 全域,
killed=false,口径与 hurt 尾 :16021 同)。
**守卫**:mod-d20-transition-hit.test.ts 6 断言——396/422/548/371/246 五转态各验
「派发 killed=false+转态旗置位+不死亡」+普通敌 15 致死对照 killed=true(两链不混淆)。
**判例**:转态测试伤害须真致死(396 hp=45000/246 hp=25000——9999 打不死不入转态,
探针假阴性;塔用 1e9 过了曾误导)。
**验收**:mod 套件 23 文件 **156 断言**全绿;tsc 净。

---

## D12-尘埃 渲染分支清偿实录(2026-10-13,per-type 贴图+全亮桶)

**定谳**:第四批登记的 per-type 渲染分支未落——①`getModDustImg` 缓存闭包零消费点
②闭包内 `ensureVImage(pack 相对路径)`=恒 miss(alias 权威键=`vanilla/Dust_<type>.png`)
③内存回退支零 dust 注入(SW 别名支单腿,R-A C2「两支必成对」判例复犯)④fullbright
声明零消费(mod 尘暗处不可见)。400+ 段曾走 dustFrameOf 越界采样=垃圾原版帧。
**四刀**:①Renderer getModDustImg 改 alias 键 ②drawVanillaDustPass 增 mod 分支
(axis.dual 后/alphaOf 前:贴图整幅居中绘、α=(255-alpha)/255 缺省衰落、lit 尘画
worldLayer 内=compositeLight 自动乘光[alphaOf 注 :1060 判例]、贴图缺失=跳笔不落
垃圾帧) ③VanillaDust.fullbrightnessWanted 增 mod fullbright 声明臂(原版域先短路
零开销;dusts 运行时零引擎依赖无环) ④assets 内存回退支补 dust decodeBatch。
**守卫**:mod-dust-render-d12.test.ts 2 断言(fullbright/lit 桶分流+原版 15/31 双
对照零扰动;段位 400+/重复 fail-fast/查表回退)。canvas 级绘制=实机探针批覆盖面。
**登记余债**:motionType 声明消费(spawn 期 d.type 重写=运动/alphaOf 全行为复用,
须 modType 载体字段防 fullbright 旗丢失)——现零 mod 声明 motionType,按需落。
**验收**:mod 套件+dust 预乘回归 **185 断言**全绿;tsc 净。

---

## D8+D12-atlas 清偿实录(2026-10-13,gore/dust 贴图注入 e2e+dev 死支定谳)

**定谳(D8 探针 14/16→诊断)**:`applyModAssets` 别名支准入只查 `caches` 存在——
**dev 默认关 SW(AssetCache:611,`?sw=1` 例外)**,而 CacheStorage 在无 SW 页面照样可用
→ `warmModAssetsCache` 恒真 → 别名支恒选 → `ensureVImage('sprites/mods/...')` fetch 落
**dev server SPA fallback(200 text/html)**=mod 纹理全断的死支(暖存字节无人接应=死重)。
生产(SW 在控 cache-first)不受影响。
**修**:warmModAssetsCache 准入增 `navigator.serviceWorker?.controller` 探针——SW 不在控
即回内存解码支(decodeBatch 直注入,全环境正确;prod 首访未 claim 同样安全回退,最坏
=首载稍重)。
**e2e 探针扩容**(_e2e-probe.mjs 14→16 检查):boot atlas 复用+applyModAssets 后断言
`atlas.vimages` 落表——gore 段 1500+/`vanilla/Gore_1500.png`(D8)/`vanilla/Dust_400.png`
(D12)。**16/16 全绿**。
**验收**:mod 套件 25 文件 158 断言全绿;tsc 净;灾厄全链路探针复跑 13/13(60fps 保持)。

---

## D20-m3 清偿实录(2026-10-13,死亡链时序反转)

**定谳**:hurt 死亡支内 `onEnemyKilled`(:15894)先派发 mod 击杀双钩,onHitByAny(killed=true)
在 hurt 尾(:16012)=**onKill 先于 onHitByAny 反相**(tML=StrikeNPC 内 OnHitNPC 先于
checkDead→OnKill)。
**刀**:①`onEnemyKilled` opts 增 `skipModKillHooks`(GameHooks+Game 双签名同步)——置位时
本口只走原版记账;②hurt 死亡支传旗,mod 双钩(per-NPC 先/global 后,镜像原序)移至
onHitByAny(killed=true) 之后派发;③石化等直调路径缺省仍在本口头派发(零改动)。
**守卫**:mod-d20-transition-hit.test.ts 增时序断言(onHitByAny→onKill 严格序)。
**验收**:mod+回归 27 文件 **229 断言**全绿;tsc 净。

---

## D6 清偿实录(2026-10-13,func.buffType 双域解析)

**定谳**:itemfunc.buffType 仅 number 域——mod 物品无法以「mod buff 键」声明自带
buff(作者不知伪 id);注册期解析不可行=applyRegistrationPlan 先于 entry 相位
(sw.buff 后注册)。
**刀**:①types/vanillaItemFunc 双表 schema 扩 `buffType?: number | string` ②Game
`itemBuffIdOf(defKey, bt)`(导出供测试):数字原样透传(原版 id/mod 伪 id 9000+ 同走
BUFF_BY_VANILLA 反查表)/字符串=键→modBuffTypeOf→BUFF_DEFS.vanillaBuff(伪 id 进既有
通道);未注册=0 不炸使用链 ③四处消费+三门改双域(quickBuff/quickConsume/potion 桥/
快捷饮+consumableFuncGate/potion 桥门/食物档表 number 守卫) ④tooltip 两分类行门
string 恒显。
**守卫**:mod-d6-buffkey.test.ts 2 断言(键→伪 id→反查回 BuffType 闭环/全键+未注册
0+数字透传)。
**验收**:mod 套件 26 文件 **161 断言**全绿;tsc 净。

---

## D3+D18 双清偿实录(2026-10-13,直调弹域面+渲染队列两债)

**D3(直调弹幕语义面)**:`damagePlayer` opts 增 `projVid`——`projDomain+projVid` 双旗时
进 `runModModifyHitPlayerByProj` 倍率链(此前直调面两链皆不进=mod 敌弹增减伤对 Boss
直调伤无效;接触链仍排除=R1-F2 定谳不变;纯倍率与调用侧难度缩放可交换=PTGT 站同注)。
duke 龙卷调用点接 `projVid: big?386:384`(Sharknado 列 384 小/386 大,385=零伤落地生成器)。
GameHooks 签名同步。接线 tsc 级验证+4a 链级守卫既有。

**D18-F6(全亮队列帧首清)**:冲刷侧清(:17921)只盖正常到达帧——收集后早退/异常帧的
残留闭包跨帧滞留=下帧重影+闭包持实体泄漏。render() 帧首 `projFullbrightQueue.length=0`
(语义=全亮演出单帧性,漏一帧优于重影)。

**D18-F8(behindTiles×fullbright 组合)**:全亮/白提亮队列 7d'(光照合成后)最上层复绘,
behindTiles 本体在 tile 层之下——组合=层序违约(被前景 tile 遮挡语义被顶穿)。捕获位
增 `!isBehindTilesEnemy(e)` 门(vanilla 双旗零交集=零行为变化;mod behindTiles 声明族
fullbright=层序优先,登记取舍)。

**灾厄全链路探针终态(14/14,增内存读数)**:300 帧 avg=16.61ms p95=16.70ms(60fps 满帧)
+ **内存 used=686MB / limit=4192MB(16%,余量充足)**;console 框架错误=0。
**验收**:mod 套件 26 文件 **161 断言**全绿;tsc 净。

---

## 余债收官批实录(2026-10-13,余债清理轮)

**D20-m1(假人 488)**:immortal 早退支(`return true` :15108)零派发=mod 武器打假人
无特效。incomingHit 已在本支前(:15026)=DR 族不重派;补 dispatchAcceptedHit
(原 dispatchTransitionHit 改名通用化,7 站)。守卫:488 受理伤 killed=false+免扣血+
lastStrikeDealt 足额(幽灵套 proc 门依赖)。

**D20-m5(城镇 NPC 域)**:TownNPC.hurt 全程零 mod 派发(mod townNPC 声明域同缺)。
补两刀:①受击派发(唯一出口 :1642,fromPlayer 门+killed=this.dead 真值;防后实扣与
lastStrikeDealt 同源)②击杀双钩在 onHitByAny 之后(m3 tML 序同款,死亡支/存活支
共用出口=this.dead 判别;首版死亡支内派发曾重演 m3 反相=守卫抓获改尾)。
守卫:向导 22 存活 killed=false/致死 onHitByAny→onKill 严格序。

**D19-F4(ui×DOM 双消费)**:vui 面板画布 z=300+PE:none→面板叠 DOM 槽=双触发。
修=DOM 侧吞门:指针落本域面板子树时 html 挂 `sw-modpanel-swallow` 类(UI.ts CSS 规则
`.sw-root * PE:none!important`),离板/收板/退世界还原;驱动=mousemove(首面板挂)+
rebuildHostTree 开合沿。vui window 层输入不受 PE 影响 ✓。

**D19-F7(ownedProjBelow 所有者)**:计数补 `ownerIsPlayer !== false` 过滤(敌怪同 vid
弹不入「你的」补位门;联机他玩家弹=实体面无 owner 位,文档化偏差登记)。

**D19-F8(a)(ESC 双收)**:mod 面板+设置叠开=链收 mod 面板+Settings 自带 window Esc
同帧双关。修=Settings.escHandler 头部 `modUiPanelsOpen()` 让位门(链收完 mod 面板后
下拍自然轮到设置)。(b) 暂停序=用户自开窗优先取舍维持。

**D19-F10(面板跨世界,产品裁决)**:卸载沿全收(modUiSetInGame(false) 关全部可见面板)
——面板=世界会话产物;entries 保留=句柄引用稳定,mod 依 onWorldLoad 重开;进世界沿
modUiResync 位次不动。

**D19-F11(d.ts 漂移清单)**:templates/mod-api.d.ts 全量对齐 ModContext(补 40+ 面:
onNpcDeath/onHitAny/spawnPool/recipeGroups/menuTheme/BGM 五件/playSound/screenFx/
canUse/projIdOf/armorSet/tileInteract/itemIdOf/playerThorns/healItem/accEffect×2/
dodgeRoll/playerHurt/damageGate/dashType/keybind×2/parry×2/holdItem/playerBuff/
enemyBuff×2/projClassOf/playerImmune/npcIdOf/ownedProjCount/spawnItem/spawnProj/
spawnNpc/rollPrefixFor/chestUnlockCondition/biomeConversion/biomeFlag/npcSpawnStats/
vanillaNpcAi/modifyTooltip/playerDraw/ModDrawCtx/ModScreenFxState)+ModProjSpec 补
homing/holdout/frames/additive/fullbright/overPlayers/preDraw/draw/postDraw 族。

**定谳销账(登记语义差≠缺陷,免后车重查)**:m4 发射面广于 tML(NPC→NPC/DoT 杀/9999
幻影进链=mod 可见性更广,良性);m6 postAi 写光(光引擎=加性贡献,点光后写不覆写;
首消费方出现时再验);n1 crit 预倍 mod 可见(ctx 域差文档化);n2 netPuppet 零事件
(联机傀儡权威端事件,单机零影响)。

**验收**:mod 套件 26 文件 **164 断言**全绿;tsc 净;e2e 探针 **18/18**(增图鉴 mod
NPC 入册断言=kill 源)。**余债台账终态**:motionType 消费(待首声明 mod)/InfoDisplay/
成就 API(新功能域)/键盘导航/全屏页 uiBlocking(新功能域)/D11 热重载(特性引入时)/
TE(L,defer)——全部为「待消费方/新功能/设计 defer」,无待修缺陷。
---

## 余债收官批 II 实录(2026-10-13,第二轮)

**D15余-全屏页宿主(uiBlocking)**:panel opts 增 `fullscreen` 声明(IngameFancyUI 同位)
——可见期 `game.input.uiBlocking=true`(移动/键面/世界输入全封;owned 旗防与原版模态
互踩只清自置)+`modUiBlockingPointer` 整屏让位(DOM 吞门全覆盖);ESC 链 closeModPanels
支先于 uiBlocking 让位(:95/:104)=全屏页仍可 Esc 关。api/d.ts 同步。
守卫:mod-ui-k1 扩断言(置位/收板还原/整屏让位/普通面板盒命中语义不混)。

**D12余-motionType 消费**:spawn 期 `d.type` 重写为运动档原版 type(update 运动链/
alphaOf/速度特例全行为复用),`VDust.modType` 载体保原 mod type(渲染分支贴图键/全亮桶
读它);全亮桶=mod 声明唯一权威(运动档原版桶位 6/15/59-64/331 不传染——声明 lit 即
lit);池复用归位(复位前置,首版序缺陷=复位抹赋值被守卫抓获)+clone 随源尘复制;
渲染分支键 `d.modType !== undefined`(重写后 d.type 已是原版域)。
守卫:mod-dust-render-d12 扩 3 断言(重写+载体+lit 权威/缺省不改写/池复用归位)。

**定谳销账 II**:InfoDisplay/成就=新 API 域非缺陷债(tML InfoDisplay/ModAchievement
对应面=sw.infoDisplay/sw.achievement 新功能,按需立项);原版信息配件面(雷达/计数器)
对 mod NPC 本就 vanilla 同相(计数器 banner 域=无 banner 灰行,与假人同相;雷达=
Enemy 实例域自然覆盖)。
**验收**:mod+dust 预乘 **27 文件 197 断言**全绿;tsc 净。**余债台账终态 II**:键盘导航/
成就 API/InfoDisplay API(新功能域)/D11 热重载(特性引入时)/TE(L,defer)——零待修缺陷。
---

## 红蓝对抗复查·第五轮(2026-10-13,余债两批 13+ 刀)

**蓝队先行自证(复查发起前)**:fullscreen uiBlocking 裸 owned 旗×原版模态互踩
(原版先置 true→fullscreen 开→收=连原版的一起清)——claim 期记 preExisting,
释放只在「自置且位前非真」时清。守卫入册。

**三路红队 R-A(存读/资产)/R-B(实体链)/R-C(渲染 UI)**:

### 修复定谳(major 优先)
- **R-A-F9(major,全链断裂)**:mod 坐骑贴图消费端零接线——注入键 `vanilla/Mount_<id>.png`
  全仓唯一出现处=assets 注入端,`Mounts.textures()` 读 `backTexture/frontTexture`
  名字键而 register 不设=坐骑本体隐形。修=register 期补双键 `Mount_<id>.png`(与
  别名键闭环;原版 vanilla-mounts.json 同键形)。
- **R-A-F7(major)**:内存回退支缺 mounts/hairs/visualSheets/armor 四族注入——
  「两支必成对」判例第三发。修=内存支补四族(与 SW 支同键 decodeBatch)。
- **R-A-F8(major,反向单腿)**:SW 支漏 portrait——生产主路 mod 对话头像全缺。
  修=SW npcs 循环补 blob objectURL 通道(与内存支同源)。
- **R-A-F10(major)**:内存支墙 meta 缺 R-A-M4(largeFrame rows=5 越表=无 SW 环境
  整墙画空)。修=rows 缺省式对齐 SW 支。
- **R-B-F1(major)**:TownNPC onHitAny=零可达死支——玩家源调用全不传 fromPlayer
  (签名第 9 参缺省 false)。修=四玩家源站补旗(近战 :36670+爆三站,弹域站携 projId)。
- **R-B-F2(major)**:realLife 转移死头部幻影拍——die→hurt(9999) 全管线在头上派发
  killed=true damage=9999(tML=OnHit 只对被击段,头 checkDead 无伤害管线)。修=
  转移窗 `__swModSilentHit` 旗压 onHitAny/onHitByAny(击杀双钩照发=头真死者);
  守卫=段单拍 killed=false+头零幻影拍+头击杀钩。
- **R-B-F4(minor)**:TownNPC incomingHit 值链缺位(DR 族对城镇域不生效)。修=防御
  结算后/暴击前插 `runModNpcIncomingHit`(Enemy :15026 同族)。
- **R-B-F5(minor)**:石化 kill 快照=活态(onEnemyKilled 先于 dead 置位)。修=dead/hp
  先置再记账。
- **R-B-F6(minor)**:D6 未注册 buff 键完全静默×tooltip 恒显=调试黑洞。修=warn once
  (每 defKey+键)。
- **R-A-F5(minor)**:内存支解码风暴(灾厄级数千 job 无界 Promise.all=百 MB 瞬时峰值)。
  修=decodeBatch 并发上界池(32)。
- **R-A-F11(minor)**:ModUI flatKey 扁平化碰撞('a/b'≡'a_b')静默覆盖(内存支完成序
  非确定=随机赢家)。修=两支扫描期碰撞 warn。
- **R-A-F13(minor)**:bridge saveModsProvider 窄类型(下次收窄复制静默丢 wallIds)。
  修=类型对齐实际供数形。
- **R-C-D19-F4-a(Medium)**:DOM 吞门只盖 .sw-root(z10)——设置 z25/图鉴 z30/旅程/
  研究/NPC 对话等 DOM 模态平级裸奔=叠面板双消费仍在。修=吞门作用域扩 #game-root
  全子树(vui z300 视觉顶=「mod 面板持有输入」语义)。
- **R-C-D19-F4-b(Medium-Low)**:触屏三面缺(门无 touch 同步/UIScale.mouse 触屏恒
  陈旧/Input touchstart 绕过让位=穿面板挖打+面板死区)。修=Input.touchstart 头部
  `modUiTouchGate`(fullscreen 整屏/普通盒命中)+UIScale.mouse 触屏坐标同步+吞门
  触屏沿;放行兼容 mouse 序=VUI 面板收点按。
- **R-C-F10-a(Low-Medium)**:全收/收板不复位 entry.dragging——拖拽中收板重开后面板
  粘鼠标(vui setState 抑制期丢 mouseup 已证)。修=四收板沿+reset 补 dragging=false。
- **R-C-D12-F1(Low-Medium)**:motionType 重写含 AddLight 光贡献且声明面无 opt-out
  (tML 同域 mod dust 不发光)。修=`ModDustContent.noLight` 字面(spawn 期写
  noLight+noLightEmittance 双旗)。
- **R-C-F6-a(Low)**:flushNpcWhiteLift 冲刷尾不自清(完全依赖帧首清=脆弱)。
  修=冲刷侧替换自清(对齐 projFullbrightQueue)。

### 登记债(不落刀)
- **R-A-F-A1(取舍登记)**:卸 mod 后墙残值「再收割」——残 367 与后位 mod 新墙 id 重合
  =渲染错墙+吃他 meta;保残值换「临时禁用→重启用零损恢复」语义,登记不修(命中在册
  mod 墙的残值可落 debtLog 后续批)。
- **R-A-F-A4(.wld 导入墙域门)**:tML mod 墙值直拷(era 基址刀只修 schematic 域)——
  minor 视觉级,后续批延伸。
- **R-B-F3(ctx.damage 跨类口径)**:Enemy 域=防前 rawDmg/TownNPC 域=防后(tML 贴后)
  ——R1-F3 既有登记的跨实体类扩展。
- **R-B-F8(modId 含下划线剥键断裂)**:ID_RE 合法下划线 modId 被 slice 习语断——
  仓级习语债并档 D17(7 站)。
- **R-B-F9(duke 站 mod-visible 口径)**:直调站=难度缩放+×2 后;PTGT 站=前。纯倍率
  可交换成立,mod 读 dmg 分支须知。
- **R-B-F10(直调弹域面完整清单)**:deerclops×3/MeteorChunk/FallingBlock/dd2×4/
  lunar_misc/martian/Dart×2 等无旗直调面=既有 B 批账(F4 列举面)并集扩容。
- **R-C-D15-a(uiBlocking 无条件清位清单)**:JourneyPowers:824/Research:197/main.ts:510
  三站无条件清=可抹 mod claim(场景 A 输入泄漏窗)/反向序释放可抹原版(preExisting
  只护 claim 序)。登记;释放支改重读现值=后续批。
- **R-C-D12-F2(per-type 帧图)**:整幅直绘无 frames/尺寸 sanity(与 tML 同相,鲁棒性债)。
- **R-C-D18-F8-a(preDraw×fullbright 互斥)**:preDraw 自绘全权时 fullbright 静默失活
  (行为正确)——文档/注释补登。

### 判语
- **critical 0**;红队三路 major 6 全修;D16/D8/D12/D6/D3 主链机制级成立(逐站读盘+
  守卫实跑)。
- **全仓 sweep 归因**:133 红中本域=0(mod 套件/守恒/金标隔离全绿);余=并行会话
  Player.ts 在途(dash 域,23:26 mtime)+结构锚钉串未随更新+perf 时序噪声
  (mod-perf-guard 单跑 19/19)+gen-terrain-golden(既知并行漂移)。
- 判例新增:㉑两支必成对第三发=审查须【双向】核对(SW 支单腿 portrait/内存支单腿
  四族——方向相反的双侧缺失)㉒转移死幻影拍=「谁被击谁受拍」(头 die→hurt 全管线
  ≠tML checkDead 无伤害管线)㉓触屏三面(touch 坐标同步/门/兼容 mouse 序放行)。

**验收**:tsc 净;mod 套件+守恒全绿(mod-p5 4/d20 11/ui-k1 11/d12-dust 5/d6 2+
mod-loader-core/atlas 金标/ESC 链全绿)。
---

## 第六梯队·通用 Tile Entity 域落地实录(2026-10-14)

**定位**:工坊普查判谳「5 缺口 2 债」的最后缺口(刀1-5 全闭环后,TE=L1 域矩阵唯一
defer 项)——存储/机器类 mod(Magic Storage 形态)的关键面。

**引擎面**:`src/mods/tileEntities.ts`(新模块,~160 行)——
- **注册**:`sw.tileEntity(tileKey, spec)`(键=本 mod content/tiles 声明键,api 期
  tiles 域 id 解析→registry;fail-fast 重复)。spec 五钩:create(初始 state)/
  update(逐 tick)/onDestroy(破坏沿)/save(存档序列化,缺省 state 直存)/
  load(读档恢复,缺省直存回填)。
- **放置/破坏自愈**:TileStore.onTileChanged 监听(setTile 唯一写入口既有通道)——
  现型=TE tile∧锚格[frameX/Y 全 0;1×1 恒真/多格=左上锚约定]∧无实例=建;实例在而
  现型≠TE tile=onDestroy+摘。自愈语义=存读/世界沿双建通道幂等。
- **世界绑定**:Game.start/destroy 沿 bind/unbind(WeakMap 按 TileStore 分桶=
  跨世界实例隔离;TileStore 无监听摘除面=监听闭包守 bound.has 惰性直通)。
- **tick**:runModPostEntities 派发(hasModTileEntities 头门;registry 空直通零成本)。
- **存读**:SaveData.teMods(k=te 全键,x/y,d=save 钩产物)+SaveMeta.teMods 供数
  **三处装配全喂**(saveGame 主线程/SaveClient worker 生产主路径/buildSaveParts;
  BJ71 防漏喂纪律)+loadSaveData world 建成后 restoreModTEs(缺 mod=静默降级)。
- **零 mod 恒等**:registry 空=监听不装/tick 直通/serialize 空(双保险)。

**设计取舍登记**:①state=mod 自由对象(JSON-able 纪律=作者责任,save 钩自管)②多格
TE=锚格约定(frame 0,0;非原版 TEObject 逐格语义)③无 net sync(联机 TE 同步=后续批)
④无 draw 钩(自绘走 tile 渲染链/ModDrawCtx 后续批)⑤wld 导出 TE 段缺(自有 json 档
teMods 全;exportWld 通道后续批)。**余债台账**:上五项=TE 后续批。

**守卫**:mod-te.test.ts 全链断言(放置自愈建×2/tick 累计/破坏 onDestroy/序列化
save 钩产物形/saveGame→loadSave round-trip[json 含 teMods+k/x/d]/restore load 钩
续走/解绑跨世界隔离)。
**验收**:tsc 净;mod 套件 27 文件 175 断言全绿;e2e 探针 18/18;d.ts↔api 奇偶
66/66;灾厄全链路探针复跑(bind 空注册零成本沿)。**工坊普查五缺口全闭环。**
---

## 第七梯队·多 mod 共存全链实录(2026-10-14)

**定位**:79 mod 用户的真实形态=多 mod 同装。既有探针全为单 mod;四真实 mod
(calamity+rivals+glmgirl+lights_and_shadows)同机全链=本梯队。

**探针**:scripts/_multimod-probe.mjs(装包×4→重载 boot→真实世界创建→跨 mod NPC
spawn/AI→性能合成负载→console 门)。**13/13 全绿**:
装载零错×4/四 mod 全载/分配段位合成(2691 items+308 npcs+2188 projs+124 walls=
四包确定性分配)/per-mod 段位无碰撞(calamity 800+ 段/rivals 1104+ 段)/跨 mod NPC
spawn+AI 2/2/性能 **avg=16.63ms≈60fps(四 mod 合成)**/内存 688MB/console 框架错误 0。

**框架缺陷两发(修)**:
- **worker gen 单源 last-wins**:setGenSrcProvider 被装载循环逐 mod 覆写=worker 只
  eval 末位 mod bundle,前位 mod 的 gen pass 全丢(多 mod 世界生成=只有末位的 mod
  地形)。修=①bridge `setGenSrcsProvider`(全源清单)②loader 逐 mod push+整批喂
  ③WorldGenClient 多源推(旧单源兜底)④worker `registerModGenPassesInWorkerMulti`
  **逐 mod try/catch**(单 mod 失败不拖累其余)+桩内 pass 计数日志
  (`N ok, M failed, K passes`)。
- **worker eval 单形态**:622c 只认 esbuild 尾 `export {X as default}`——raw
  `export default function NAME`(rivals/glmgirl)与 `export default <expr>`(lights)
  在 worker eval 抛 Unexpected token 'export'。修=三形态判别(尾形/named function/
  匿名表达式 return 改写)。

**mod 侧修复**:rivals 源缺两体节 npc 声明(claude_claw/gpt_rune 被 spawnNpc 引用而
content/npcs 无 json=api idOf fail-fast 拒载)——补声明(贴图复用主 boss;主 AI 全权
接管)+重打包。集成测试 6/6 恢复绿。

**判例**:㉔per-mod 资源面清单化(单例 provider 遇多 mod 装载循环=last-wins 隐性丢面
——bridge 供数族一律清单化)㉕worker eval bundle 形态=构建器产物形态族(esbuild 尾/
tsc 直形/匿名箭头三判别)㉖单 mod 失败隔离=逐 mod try/catch+计数日志(静默丢面转
可观测)。
**验收**:tsc 净(滤并行面);mod+集成 28 文件 **181 断言**全绿;单 mod 灾厄探针
14/14(多源链路单 mod 兼容);e2e 18/18。
---

## 第八梯队·三新功能域落地实录(2026-10-14,目标「所有域处理完毕」收官批)

**成就域(sw.achievement/completeAchievement)**:原版条件状态机直接复用——
Achievements 增 modDefs 注册面(registerModAchievementDefs,ctor 并入)+completeMod
(直完+待办暂存回放:无实例沿调用→ctor 重放)。modAchievements.ts:spec 五 kind 翻译
(npcKilled/itemPickup/itemCraft/tileDestroyed=引擎通知自动驱动[onEnemyKilled→
notifyNPCKilled 800+ 直通],keys=mod/vanilla 键或裸 vid;custom=flag 域直完)+
图标 blob URL 通道(portraits 同构,assets 相位产)+UI 字面回退(def.title/desc ?
l10n)。持久化=原版 completed 表(name=mod 全键,零新通道)。
守卫:mod-achievement 2 断言(翻译/自动驱动/直完/回放/重复 fail-fast/未注册抛)。

**InfoDisplay 域(sw.infoDisplay)**:原版信息配件栏(DrawInfoAccs)mod 追加行——
Game.tickInfoAccs 头逐帧解析(resolveModInfoLines,update 产文本 null=省行)+
buildInfoAccRows 尾追加(icon=-1/hideIndex=-1 双哨兵:UITextures.get miss=跳绘/
hidden[-1]=falsy——既有护栏天然安全,零 layer 改动)。gold=金行透传。
守卫:mod-info-display 2 断言(全链+原版域零扰动)。

**键盘导航域(vui 扩展)**:焦点索引制——焦点元素走既有 hover 语义(mouseOver/
mouseOut 程序化派发=isMouseHovering+样式+钩全复用),Enter/Space 走既有 click 派发。
键位:↑↓←→/Tab 循环/Enter/Space 激活/Esc 既有链。**语义注册制**(第二版):handle
addButton/addSlot 显式注册焦点集——树序 DFS 曾把 UIPanel 根/标题栏拖拽 click 卷入
焦点序=第三发「树遍历卷入非语义元素」判例。uiState 字段=全系统零消费死字段(实测
恒 null,勿作判据)。焦点候选=注册集∧parent≠null(remove 自清)。
守卫:mod-kbd-nav 1 断言(焦点序列/Enter 激活/越界回绕)。

**TE 余债定谳收官**:①net sync=MP TE 框架缺位前置(fx42 传输层为 mod 实体域设计,
TE 状态通道=MP 成熟期随批)②wld 导出=格式固有 N/A(原版 .wld 无 mod TE 槽;tML 用
.twld 旁档——自有 json 档 teMods 全,导出通道不承载 mod 数据=登记语义)③draw 钩=
tML ModTileEntity 同缺(渲染走 tile 链+ModDrawCtx 后续批)。**D11 热重载=特性门**
(热重载特性落地时清哨兵)。至此全部域处理完毕:功能域 15+TE+成就+InfoDisplay+
键盘导航全闭环,登记债全部有锚/有归属/有验收判据。

**验收**:mod+守恒 **33 文件 210 断言**全绿;e2e 探针 18/18;多 mod 探针 13/13;
d.ts↔api 奇偶(成就+InfoDisplay 并入;tileIdOf/tileEntitiesOf=并行会话在途面)。
---

## 红蓝对抗复查·第六轮(2026-10-14,TE/成就/InfoDisplay/键盘导航/多 mod 五梯队全景)

**蓝队先行自证(复查发起前)**:①InfoDisplay mod 行点击翻转 p.hideInfo[-1]=负下标
数组位=mod 行本会话永久隐藏(hideIndex>=0 门+守卫)②kbdNav 捕获相位拦截×UITextBox
隐藏 DOM input=文本编辑断(activeElement=INPUT 让位+守卫)。

**三路红队 R-A(成就+InfoDisplay)/R-B(键盘导航+TE)/R-C(多 mod worker gen)**:
36 findings——critical 0 / major 9 / moderate 8 / minor+note 19。

### 修复定谳(major/moderate 全修)
- **R-A-F1(major)**:成就图标 blob 通道单腿(内存支零注册=dev/SW 未 claim 态图标
  全灭)——「两支必成对」**第四发**。修=内存支补注册。
- **R-A-F2(major)**:自动驱动 mod 成就解锁 toast=裸 l10n 键(def.title 现成被弃)。
  修=defOf(name)?.title ?? l10n。
- **R-A-F3(major)**:无 icon mod 成就显示原版首帧(glyph 类自带 Achievements.png
  贴图+0,0 定位)——「缺省=空 glyph」声称证伪。修=mod 域无 icon 清 backgroundImage。
- **R-A-F4(major)**:晚注册成就静默丢失+图标回填非空断言炸 applyModAssets 整段
  (后续 mod 贴图全丢)。修=晚到 warn+回填缺位降级;build 重入幂等(builtByFullKey)。
- **R-B-KB-1(major)**:非全屏面板开着=方向键/Space/Enter 被 window 捕获相整体吃掉
  (stopPropagation 截断 Input 冒泡相键面=移动跳跃断)——「vui 现役」≠「世界输入让位」
  两判据错置。修=消费门=modUiBlockingPointer(谓词注入环避)。
- **R-B-KB-2(major)**:隐藏面板按钮仍是焦点候选(removeAllChildren 只断根 parent,
  按钮 parent 恒非空)=隐形激活/跨世界激活。修=可达性判定(回溯根∈current 直子)。
- **R-B-TE-1(moderate)**:陨石坑 setTileSilent 旁路=孤儿 TE 永续 tick+永久落档
  (ChunkCache:575 注释双物证)。修=tick 对账(每 TE 一次 store.get 失配→onDestroy+摘)。
- **R-B-TE-2(moderate)**:缺省直存无守卫——循环引用 state=JSON.stringify 整档抛/
  worker clone DataCloneError(双保存链全断)。修=缺省路径 JSON round-trip 消毒。
- **R-C-F2(high)**:worker saveParse 生产读档丢 TE 实例(worker 域注册表恒空,
  restoreModTEs 空转)→读→存循环**永久抹除 teMods**。修=窄 save 随档回传
  teMods+主线程 loadFromKey/Json 两路 restoreModTEs 回填(bj223 扩守卫)。
- **R-C-F3(moderate)**:eval named/expr strip=首现 replace——注释/字符串含
  'export default' 示例文本(现实高频)错杀=整 mod gen 静默丢。修=lastIndexOf
  锚定+形态计数日志。
- **R-A-F6/F7、R-B-KB-5/8、R-C-F4/F5(minor)**:图标 revoke 先例/purge 清账/
  直完 onUnlock 同 UX/invalidate mouseOut 读旧表/动态加钮失效缓存/gen 全局面
  静态同步写/计数日志差值真打——全修。

### 登记债
- **R-A-F5(存量·FX18 面)**:标题屏成就面板单例跨局陈旧(本局解锁不可见)——
  存量邻接面,归属 FX18 批。
- **R-B-KB-3/4(moderate)**:注册无反注册面(单调增长,有界);内建元素无
  isMouseHovering 样式=焦点视觉为零(「样式复用」半句空承诺)——焦点环绘制=
  后续批(需 draw-side 支持)。
- **R-B-KB-6/7/9(minor)**:程序化 hover 与真实悬停双向失同步×2/中段摘除错位。
- **R-B-TE-3/5/6(minor)**:save 钩 throw 静默弃存无标记/联机布居不对称/重复监听
  闭包身份陷阱。
- **R-C-F8(wld 导出)**:mod 墙 id 367 恰撞 1457 Echo 墙域起点=原版互操作别名;
  mod tile/箱物品 id 越域透传——「teMods 不承载」与「墙/tile 带域外 id 流出」两侧
  口径补登记,WldExport 偏差清单扩行,撞域立案评估。
- **R-C-F1(探针)**:多 mod 探针 gen 正断言已补(墙抽样+calamity 排首位);
  screenFx/存读占位断言登记;双 gen-mod 夹具=后续。
- **R-C-F10(rivals 贴图)**:声明尺寸=命中盒≠绘制尺寸(整幅 1:1 既有语义)——
  体节渲染成完整 boss 大图=内容审美债+文档缺口。

### 判例新增
㉚「vui 现役」≠「世界输入让位」——键消费门必须用让位判据(两判据不相交)。
㉛removeAllChildren 只断根 parent——可达性判定须回溯根∈current 直子(「parent
非空」对子元素恒真)。
㉜worker 窄 save 回传面=读档主线程回填通道(TE 注册表 worker 恒空,宽对象释放
前提取)。㉝JSON round-trip 消毒=缺省直存路径的保存链保险丝。㉔补:探针验收矩阵
对「单 mod 末位」结构性盲区——gen mod 必须排首位+世界产出正断言。

**验收**:tsc 净(滤并行面);mod+守恒+集成 **34 文件 207 断言**全绿(新增
bj223 F2 守卫/kbdNav INPUT 门/TE 消毒);e2e 18/18+多 mod 探针 **14/14**(增
gen 正断言)。**F1 正断言首跑即抓获 F3 重写回归(tail 捕获组丢失=calamity gen 全灭)
——探针验收矩阵结构性盲区的修复价值当场兑现。**
---

## 登记债清零批实录(2026-10-14,第六轮红蓝登记债收敛)

**R-A-F5(标题屏成就跨局陈旧)**:openMenuAchievements 每开面 new Achievements
重读 store(旧=menuAchievementsReady 单例 Promise 恒回首次实例=Game 解锁落盘后
回标题不可见)。新实例构造零成本(纯 store 读+defs 快照);`__swAchievements`
窗口桥同步更新(标题日月拖拽读新实例)。

**R-B-KB-4(焦点视觉为零)**:UIElement 基类增 `kbdFocus` 旗+UITextPanel/UISlot
drawSelf 焦点环绘制(金 #FFE745 strokeRect);kbdNav setFocus/invalidate/reset
三沿维护旗。

**R-B-KB-9(中段摘除错位)**:KB-5 修复已覆盖——invalidateModKbdNav 改为
无条件 reset focusIdx=-1(旧=仅越界才复位,中段摘除 focusIdx 不动指向换元素)。

**R-B-TE-3(save 钩 throw 静默弃存)**:throw→占位条目 `{k,x,y,d:{__lost:true}}`
落档+warn 带坐标;restore 侧 `__lost` 可见+log「上局弃存不复活」(缺 mod 丢弃与
钩 throw 丢弃在档面上可分辨)。

**R-B-TE-6(重复监听身份陷阱)**:listener 守卫从 `bound.has(store)`(WeakMap
成员性——解绑再绑旧监听复活=双桶)改为闭包身份比对 `bound.get(store)?.listener
!== listener`(BoundStore 增 listener 字段)。

**R-C-F8(wld 导出 mod 域钳零)**:.wld 导出三面 mod 域 id 钳零+计数 warn——
①墙 367+→0(撞 1457 Echo 墙域)②tile 1030+→0(越原版 tile 型数)③箱物品
30000+→0(越原版 netId)。**语义=.wld 导出=vanilla 互操作格式不承载 mod 内容;
SW↔SW 完整回环走自有 json 档(teMods/mod 全)**。旧=三面域外 id 裸透传(TEdit/
原版读侧行为不可预期)。

**R-C-F10(渲染尺寸语义文档缺口)**:mod-api.d.ts 头注补「width/height=命中盒,
渲染=贴图整幅 1:1(不缩放不裁切);要小体型=贴图本身缩小」。

**验收**:mod+守恒+集成 **35 文件 214 断言**全绿;多 mod 探针 14/14+e2e 18/18。
tsc 净(滤并行面)。

### 登记债终态(本轮清零后)

| 债 | 状态 |
|---|---|
| R-A-F5 成就单例 | ✅ 本轮清偿 |
| R-B-KB-3 registry 单调增长 | ⚠️ 生产有界(按钮总量=已建面板×按钮数;reachable 过滤使焦点面正确);unregister API=热重载特性引入时随批 |
| R-B-KB-4 焦点视觉 | ✅ 本轮清偿 |
| R-B-KB-6/7 hover 失同步 | ⚠️ 接受语义(键盘焦点≠鼠标悬停,双系统独立;修复需回写 lastElementHover=侵入 UserInterface 内部) |
| R-B-KB-9 中段错位 | ✅ KB-5 已覆盖 |
| R-B-TE-3 弃存标记 | ✅ 本轮清偿 |
| R-B-TE-5 联机不对称 | ⚠️ 并入「无 net sync」债(MP TE 框架缺位前置) |
| R-B-TE-6 监听身份 | ✅ 本轮清偿 |
| R-C-F8 wld 导出 | ✅ 本轮清偿(域钳零) |
| R-C-F10 文档缺口 | ✅ 本轮清偿 |
| D11 热重载哨兵 | ⚠️ 特性门(哨兵清单已备:modAchDefs/modPendingComplete/iconJobs/builtByFullKey/focusRegistry/panels) |

**真正不可清的仅剩**:TE net sync(MP 框架前置)/KB-3 unregister API(热重载特性
前置)/D11(热重载特性前置)/KB-6/7(接受语义)——四项全部有明确前置条件,非「遗漏」。
---

## 前置条件全清偿批实录(2026-10-14,「四项不可清」→ 0)

**D11 mod 热重载(菜单态启停/装卸免整页 reload)**:
- `src/mods/teardown.ts`:unloadModsForHotReload 一口清全域——15 张 _reset 表+
  数据表 teardown(ITEM_DEFS 30000+ 洞化+byKey 摘/TILE_BY_KEY mod 段/WALL_DEFS
  367+/VANILLA_NPCS 800+/TOWN_NPC_IDS mod 段)+新补 reset 面(biomeFlags/recipes/
  summonEntries/bossReg/mounts[MOUNT_DATA 66+ 段+countMax 顶]/drawspecs/shops/
  bestiary entryCache/Game.petBuffKindCaches)。
- `src/mods/hotReload.ts`:teardown→loadModsPhase1→applyModAssets 编排;菜单态
  限定(游戏内 teardown 会悬空活实体引用=回退提示)。
- modsPanel 三沿(toggle/卸载/导入)接 tryHotReload;成功=「已生效(热重载)」
  (l10n 两语补键+build);失败/游戏内=回退 ReloadToApply 文案。
- 守卫:scripts/_hotreload-probe.mjs **9/9**(装→分配生效→停用→分配表清/稀有度清
  →恢复→分配恢复三循环+pageerror 门)。途中抓获 mounts 无 reset(热重载 3 整批拒载
  「mount id 已被占用」=fail-fast 守卫兑现)。

**KB-3 面板元素反注册 API**:
- `removeElement(tag)`:PanelEntry.elements 簿(tag→element);addButton/addSlot
  可选 tag 声明;remove=el.remove()[parent 断]+unregisterKbdFocusable+invalidate。
- kbdNav 补 unregisterKbdFocusable(focusRegistry.delete+kbdFocus 清)。d.ts 同步。
- 守卫:mod-kbd-nav 扩断言(移除后按钮不可激活/焦点序跳过/未知 tag false)。

**TE net sync(module16,host 权威)**:
- protocol NetModule.ModTE=16(AnglerQuest=15 先例);syncModules writeTEModule/
  readTEModule(全量快照帧:str k/i32 x/i32 y/str stateJson)。
- **host 侧**:Game 周期上报(120t=2s;TE 实例数小全量帧价≈一条 setTile);
  ClientNet.sendTEModule(零 TE 且从未发过=免空帧)。
- **server 侧**(room.ts):module16 转发分支(host-only 上行,非 host 整包忽略=
  Ambience 同语义)+teSnapshot 镜像+teSyncToJoiner 进房全量补发。
- **client 侧**:ClientNet onTESnapshot hook→setModTENetClientRole(true)+
  applyModTESnapshot(桶全量重建);角色门——client 不本地 tick(host 快照收敛)/
  不落档(host 档权威);disconnect 沿复位回单机。
- 放置/破坏同步**搭 msg17 TileBatch 既有通道**(TE 客户端自愈建/摘与 host 收敛,
  零新增上行)。
- 守卫:mod-te-net 1 断言(编解码 round-trip 含帧头跳位/host 快照产{stateJson}/
  client 重建+tick 不跑+save 不落/复位后恢复 tick)。途中判例:NetReader 消费
  NetWriter 帧须 subarray(3+2) 跳 [len][id][moduleId] 头;World(64,32) 测试坐标
  y 须 <32(越界 setTile 静默 no-op=假绿)。
**验收**:mod+守恒+集成 35 文件 **209 断言**全绿;三探针复跑全绿(**多 mod 14/14+
热重载 9/9+e2e 18/18**);tsc 净。**「不可清」清单归零:四项全清偿,余债台账为空。**
---

## 红蓝对抗复查·第七轮(2026-10-14,清偿批全景:D11 热重载/KB-3/TE net sync)

**蓝队先行自证(3 发)**:①kbdNav reset 置 installed=false 但不移除 window
listener=热重载后再装 onKey 双份(按键双步跳)——removeEventListener 先行幂等重装
②client 收远端 TE 破坏→onDestroy 本地副作用(双端视觉幽灵)——client 角色跳
③成就图标 blob URL teardown 不 revoke——先 revoke 再清。

**三路红队 33 findings(critical 0/major 7/moderate 10/minor+note 16)**:

### 修复定谳(major 全修+moderate 大部)
- **R-B-1(P1)**:大 state/多 TE 超 65535B 帧限→writeTEModule finish throw→
  **host 主循环熔断停机**(满存储单元 ~1.5KB×45+ 即超;重连复现循环)。修四刀:
  writeTEModuleBatched 字节预算 60000 分批(bestiary 先例)/单条超预算剔出+warn/
  host 上报 try/catch 保险丝(空窗≤2s 自愈)/server 广播同分批。
- **R-A-M1(major)**:tile 域重装载撞 stableId 冲突门(TILE_INTERNAL_OF_STABLE
  零清面)=**含 tile 的 mod 停用→再启用热重载整类失效**(探针 e2e-all 无 tiles=
  结构性盲区)。修=_resetModTilesForTests(双映射 mod 段清零+旁表四张按 internal
  ≥20800 段摘)+回归锁测试(tile mod 循环)。
- **R-A-M2(major)**:push 型追加面无 reset——掉落规则/生成规则 N 倍累积、pending
  群系旗漂移复活、套装 tooltip N 份 UI 行(teardown 注释虚报 armorSets)。修=四
  reset 面+teardown 接线。
- **R-A-M3(major)**:worker 桥不重推——中止生成后 worker 持旧 mod 映射表,热重载
  后菜单态读档=停用翻译残留/新装 miss/vid 位移串味三向错。修=__swFlow.
  releaseWorkers 桥(gen/save worker terminate→惰性重建吃新 provider)。
- **R-A-M4(major)**:无 reset 旁表×vid 位移=B 物品命中 A 残留(穿 A 甲/发射 A
  弹幕)。修=七 reset 面(stats/func/combat/wing/research/ITEM_TO_MOUNT/town
  npc 五面含头贴索引游标段)。
- **R-A-Me1/3/4、R-C-F1/F2/F4/F9**:in-flight 锁(并发 teardown 竞态)/
  currentAlloc 清+Buffs 反查清(幽灵 buff)/liveStates 清/同 tag fail-fast/
  removeElement 沿吞门同步/热重载失败=alert 阻断门(防错过提示→autosave 洗档)/
  d.ts tileIdOf/tileEntitiesOf 补齐。
- **R-B-3(P2)/R-B-4(P3)/R-B-6**:进房补发死路径(activeStore null 早到丢帧)=
  pendingSnapshot 缓冲+bind 沿回放;0 条快照双吞(末 TE 幽灵残留)=恒发恒广播
  恒 apply(空帧 ~7B);坏序列化 warn+死码清+注释漂移修。
- **R-A-M1 探针盲区**:e2e-all 无 tiles——热重载探针结构性照不到 tile 域(判例:
  验收 mod 内容域覆盖度=探针夹具域自查)。

### 登记债(诚实修订——上轮「余债台账为空」对本批过强)
- **R-B-2(P1)**:serverAuth 房(SimHost)TE 面整块缺位——SimHost 零 ModTE 面
  (server 不跑 mod entry=registry 恒空)、永不权威 tick、不落档。前置=server 侧
  L2 运行时(entry 求值或 TE spec 序列化装载)。**serverAuth 房+TE mod 组合当前
  不可用**(hostAuth 中继房完整)。
- **R-C-F5(moderate)**:「重启用=恢复」语义错报已勘正(注释);**缺 mod 存档
  警告面**(进世界前 mods 清单对比)——tML UnloadedItem 占位语义=大改,登记。
- **R-C-F8(moderate)**:mod 集不对称(宿主有 X 客户端无 X)→netRole 全局门
  过度抑制客户端自有 TE。前置=MP mod 集对齐门(tML 拒进服语义)。
- **R-A-Low 族**:npcPortraits blob 不 revoke(声明语义)/Keybinds 残留(查询面
  已清无消费)/modWavData 跨 mod 键域(装载域既有)/recipes TILE_COUNTS_AS+
  groupItems 游标/l10n mergeModLangPack 只增/ARMOR_SET_BONUSES 幽灵 bonus 段
  (无幂等键)——全部 note 级挂账。
- **R-C-F10/F11(探针缺口)**:TE net 无 MP 双端探针(module16 真转发/进房/断线
  复位);四 mod(灾厄)同机热重载未覆盖。守卫=test 域扩展(分批/0 条/早到/pending
  已入册),MP 双端=登记。
**验收**:mod+守恒+集成 **37 文件 216 断言**全绿(新增 mod-hotreload-tile M1
回归锁+mod-te-net 扩分批/0 条/早到缓冲断言);三探针复跑;tsc 净(game+server)。
---

## 登记债收齐批·第八轮(2026-10-14,第七轮登记债全清+近似实现审计)

### 债清偿(第七轮三项真债+Low 族+历史 B 批账)

- **R-B-2(P1)SimHost TE 缺位——清偿**:关键发现=server **已跑 L2 entry**
  (serverMods nodeEntryLoader)=TE registry 在册,缺的只是消费面。三刀:
  SimHost ctor bindModTileEntities(放置/破坏自愈)+step() 周期 tickModTileEntities
  (真 World.store)+2s 快照→room.broadcastTE(SimRoomSink 接口面)。saveWorldOnly
  已含 teMods(既有)=serverAuth 房 TE 全链闭环(读档 restore→tick→快照广播→落档)。
- **R-C-F8 mod 集不对称——清偿(降级形态)**:setModTENetRoleIfCovered 键覆盖门
  (本端 registry TE 键 ⊆ 快照键 才置 client 角色;宿主缺本端 TE mod=本地权威
  保留+warn;tML 拒进服的降级形态)。守卫入册。
- **R-C-F5 缺 mod 存档警告——清偿(警告面)**:loadSaveData 检测→
  __swMissingModsWarn 窗口→mainFlow 两路读档沿 warnMissingMods toast
  (「内容将缺失,请勿在此状态保存」l10n 双语)。tML UnloadedItem 占位恢复=
  仍登记(大改)。
- **R-B-F10 直调弹域面 13 站——清偿**:deerclops×3/MeteorChunk/FallingBlock/
  dd2×4/martian/lunar_misc/Dart×2 全接 projDomain:true(第 4 位=knockback 位,
  opts 第 5——首版三位错曾 tsc 红即中)。B 批账(D2/D3/F4 列举面)全闭环。
- **R-A-F1 墙残值再收割——warn 留痕**(取舍维持:保残值换重启用恢复;命中在册
  mod 墙 id 时 console.warn)。
- **R-A-F4 .wld 导入墙域——钳零**(tML era mod 墙=对方 load order 槽位号不可
  映射;透传会别名成本会话 mod 墙→367+→0)。
- **I-F1 DOM 信息层 mod 行悬停死区——清偿**:文本 span mouseenter/leave 接管
  (icon=-1 行;条件=图标 display:none 才接管=不与原版行双挂)。
- **R-A-Low 族——全清**:portraits blob revoke/keybinds 'mod:' 段/配方旁表
  (groupItems≥10000+TILE_COUNTS_AS mod internal 段)/ARMOR_SET_BONUSES
  ≥30000 分量键段——四 reset 入 teardown。
- **D17 族下划线 modId 剥键——根治**(近似审计发现的 bug 级近似):
  modIdOfFullKey(已装载 mod id 表最长前缀精确剥;空表回退旧 slice)收编 7 站
  (D6/bagLoot×3/刀4-A×2/?)。'lights_and_shadows' 形全键从恒 miss 转 reachable。

### 近似实现审计(与 tML 语义的已知偏差清单)

**非近似(已证等价/同相)**:hit 链三受理位语义/townNPC crit 传参位/隐藏行门/
anchor 语义/TE 锚格约定(tML 同构)/mod NPC 贴图整幅(tML 同=贴图即渲染尺寸)/
dust per-type 整幅(tML ModDust 同相)/wld 导出钳零(tML 用 .twld 承载,本仓走
自有 json 档=取舍非近似)。

**真近似(带影响面,按可修性)**:
| # | 近似 | 影响 | 状态 |
|---|---|---|---|
| A1 | 缺 mod 存档归 0(tML UnloadedItem 占位可恢复) | 停用 mod 期间存档=洗档不可逆 | **已加警告 toast**;占位恢复=登记(大改) |
| A2 | TE net 全量快照 2s(非 diff) | 带宽×实例数(帧预算分批护栏) | 收敛等价,接受 |
| A3 | mod 集不对称=键覆盖门降级(tML 拒进服) | 不对称时本端 TE 保本地权威(非拒进) | 降级形态入册 |
| A4 | ctx.damage 跨实体类口径(Enemy=防前/TownNPC=防后;tML=防后) | mod 按 damage 记账两域差 | 文档声明(改=域统一刀) |
| A5 | incomingHit=防后位(tML ModifyIncomingHit=防前) | DR 族 mod 位次差 | 文档声明 |
| A6 | behindTiles×fullbright 层序优先 | 组合声明时 fullbright 失活 | 文档声明 |
| A7 | preDraw 自绘时 fullbright 静默失活 | 同上族 | 文档声明 |
| A8 | kbdNav hover 双系统失同步(KB-6/7) | 键盘焦点视觉偶被鼠标覆盖 | 接受语义 |
| A9 | uiBlocking 原版三站无条件清位 | mod claim 窗口期被抹(自愈) | 登记 |
| A10 | PetFollower 帧序横排假设 | mod 宠物竖排帧表错序 | D5 已修 w/h;帧序=余 |

**验收**:mod+守恒+集成 **37 文件 219 断言**全绿(新增 D17 剥键守卫);热重载
9/9+e2e 18/18 复跑;game+server 双仓 tsc 净。**登记债终态:A1 占位恢复(大改,
tML UnloadedItem 全链)一项真债;A2-A10=文档化近似(带影响面声明)。**
---

## A1 清偿实录(2026-10-14,唯一真债清零——缺 mod 存档占位恢复)

**语义**:tML UnloadedItem——停用 mod 期间读档,槽内 mod 物品/TE 条目**不再归 0
洗档**:物品=惰性占位 def 保真运转(不可用/无贴图/可持有),TE=携带条目原样
回写;重启用 mod=真 def 让位占位、TE 走正常 restore。

**物品面(三刀)**:
- `registerUnloadedItemPlaceholder(stableId)`(items.ts):ITEM_DEFS[stableId]=
  {unloaded:true, maxStack:999, vid:stableId}+恒等映射接长——**全消费面拿到合法
  def**(inv.add 接受/tooltip 空行/渲染缺图回退/序列化恒等),旧「归 0」的洗档
  面与「未知 id 炸帧」面同时消解。
- 读档 mapItem 两站(SaveFile :318/:431):未知 stable≥30000 → 占位注册+保真
  (旧=ITEM_INTERNAL_OF_STABLE miss→?? 0)。
- `registerModItem` 覆写豁免:既有 def 带 unloaded 旗=占位让位(摘恒等映射再
  覆写);非占位仍 fail-fast 冲突门。

**TE 携带面(两刀)**:restoreModTEs 缺键条目 stash 到 store.unloadedTEs(松散
字段;stash 先行不依赖 bind——registry 空时 bind 早退,旧序=stash 不可达);
serializeModTEs 合流回写 teMods 段(去重:同 k/x/y 优先活实例)。重启用=下轮
读档 registry 在册走正常 restore。

**墙**:已有残值保真(R-A-F1 取舍)+再收割 warn——三面(物品/TE/墙)全部
「缺 mod 期不洗档」。

**守卫**:mod-a1-unloaded.test.ts 2 断言(读档保真+占位 def 面+再存档 id 原样+
重启用让位+TE 携带 round-trip/幂等)。途中修复:stash 序(registry 空 bind
早退=旧序 stash 永不可达)。

**登记债台账归零**:A1 清偿后无真债;A2-A10=文档化近似(带影响面声明,见第八
轮审计表)。**验收**:38 文件 221 断言全绿;e2e 18/18;tsc 净。
---

## 近似面清偿批(2026-10-14,A2-A10 八项可清全清)

**A2 TE 快照全量 2s → 脏快照**:host 侧 JSON 指纹比对(_teNetLastFp),未变更
跳过上行(0 条清空语义保留=指纹变更必发)。
**A3 mod 集不对称 → 可见 toast**:TEHostMismatch 键(双语)+console.warn 双面。
**A4 ctx.damage 跨实体类口径 → 防后统一(tML damageDone)**:Enemy 尾 dispatch
两站+dispatchAcceptedHit 七站(六转态+假人)全换防后 dmg(旧=rawDmg 防前);
TownNPC 本就防后=全域一致。守卫:d20 扩断言(incomingHit 收原始 100/ctx.damage
折防御后<100)。
**A5 incomingHit 防后位 → 防前(tML HitModifiers 位)**:移至 def/penAdd 计算前
(DR/伤害帽族作用全链);≥9999 演出通道门保持(R-A-M2);hooks 接口注释同步。
**A8 kbdNav hover 双系统失同步 → 回写收敛**:UserInterface.setLastElementHover
程序化回写口+setFocus 接入(下帧恒等判定不重派 mouseOut=焦点视觉不再被迁移
沿抹掉;真实鼠标移入他元素时 update 正常接管)。
**A9 uiBlocking 三站无条件清位 → 沿保存还原式**:Journey/Research(模块级
saved var)+pause(main.ts pauseSavedBlocking)——open 保存/close 还原非覆写
(mod fullscreen claim 不再被原版模态关闭抹掉)。
**A10 PetFollower mod 宠物横排帧假设 → spec 竖排**:mod 弹(spec 2000+)走
frames 竖排+frameRate(ModProj 渲染约定);原版表外 id 照旧 legacyDraw。
**A6/A7(behindTiles×fullbright 层序/preDraw 自绘 fullbright 失活)=保持文档化**:
前者=层结构手术(rare 组合不值),后者=行为本身正确(重绘会画原版帧盖 mod 自绘)。

**断言翻新(语义变更登记)**:mod-onhit-any「damage=raw」→「damage=防后」
(僵尸 def 实测 7);d20 月总头 damage=1e9→防后(≤1e9)。mod-hit-chain-4a 补
describe 收尾(前批撤尾结构债)。

**验收**:mod+守恒+集成 **39 文件 221 断言**全绿;e2e 18/18+热重载 9/9 复跑;
tsc 净。**近似面终态:A2/A3/A4/A5/A8/A9/A10 七项清偿;A6/A7 两项文档化(行为
正确/结构不值);零真债+零可清近似。**
---

## Tier1 浏览器独有接口批(2026-10-14,sw.ui.html/storage/shader/clipboard/net/worker)

**Tier1-a:sw.ui.htmlPage + sw.storage**
- `modHtmlUi.ts`:专用 `.sw-modhtml` 层(z110;HUD z10 之上/模态 z120 之下)
  ——CSS 强制 scope(逐规则块选择器前缀注入+@keyframes 名前缀化+@import 剥)、
  HTML 白名单(script/iframe/object/embed/link/meta/base 剥)、data-act 声明式
  事件(卸载沿全清)、form submit 拦截(防页面导航)、ESC 链收最上层(vui 面板
  让位序)、同键重开=聚焦。零新画布层(GPU 红线)。
- `modStorage.ts`:per-mod 持久 KV(KvStore IDB 主链=BJ615 单写方案；键空间
  `sandboxworld.mods.<modId>.`;配额 2MB/mod;后端注入化[node 测试内存版]；
  purge 卸载整段清)。
- 守卫:tier1a 3 断言(round-trip/键空间隔离/配额拒)+e2e 探针 3 断言(DOM 挂载/
  data-act 事件/CSS scope)。

**Tier1-b:sw.shader + sw.clipboard**
- `modShader.ts`:GLSL 片元声明面(建于 ModScreenFx 既有链)——引擎编译/绑
  uTexture/链入 7d 滤镜链最前;编译失败=warn+恒等 blit(自有兜底程序,不炸帧);
  禁 #version/#extension/#include;uniform 白名单 float/vec2/vec3/vec4;mod
  侧 uniforms 引用对象现值=运行期可变。GLPipeline 增 `quadVao` 只读访问器。
- `modClipboard.ts`:写 256KB 限(Clipboard API→execCommand 兜底)/读 3s
  授权超时+1MB 限(拒绝=null)。
- 守卫:tier1b 3 断言(禁令面四拒/合法注册/限额)。

**Tier1-c:sw.net + sw.worker**
- `modNet.ts`:manifest `"net": [...]` 域白名单(未声明=接口整缺 null;未声明
  域 runtime throw);仅 https+localhost;CORS 双保险;超时 10s+响应 4MB 限;
  *.x.y 子域通配。
- `modWorker.ts`:pack 内 `workers/*.js`——`sw.worker('fib.js')` 产句柄
  {run/terminate};引擎胶水 id 路由(mod 脚本只声明 `onmessageRun(data,
  reply)`——★裸拼接非括号包裹[函数声明在括号内=表达式不提升判例]);mod 级
  单 Worker 多 run 复用;错误全隔离(reject 不炸主线程);teardown 沿 terminate。
- manifest 扩 `net?: string[]`;createModContext 注入位 manifestNetHosts+
  workerScriptOf;loader 装载沿喂。
- 守卫:tier1c 3 断言(白名单三态/通配)+e2e 探针 **worker 真往返 fib(10)=55**。

**途中判例**:㊵ pack 注入的 entry 代码禁 TS 语法(`page.q()!.textContent` 的
`!` 在 JS blob 装=Unexpected token——D20/D15 注入两次踩);探针 mjs 同禁。
㊶函数声明括号包裹=表达式不提升(worker 胶水第一版全 reject 判例)。

**验收**:mod+集成+Tier1 守卫 **40 文件 225 断言**全绿;e2e 探针 **24/24**;
tsc 净。**六接口全链落地:浏览器独有 mod 功能边界(富 UI/持久存储/GLSL 后处理/
剪贴板/联网/计算卸载)全部打通。**
---

## Mod 开发者文档批(2026-10-14,指南+README+TS 脚手架)

**docs/mod-dev-guide.md**(完整开发指南,~480 行):
- 快速开始(mod-cli init→validate→build→装载全链)/包格式(目录树+id 段位表)
- L1 声明式 16 域逐域 schema+注释示例(物品全字段面/tile 贴图约定/墙/蠕虫链/
  弹幕/Dust/Buff/配方/商店/gore/稀有度/宠物/坐骑/发型/尘埃/掉落/成就)
- L2 API 总表(77 接口按 实体战斗/物品交互/世界系统/音频 UI 键位/id 解析 分组)
- Tier1 浏览器独有六接口(htmlPage/storage/shader/clipboard/net/worker)
  逐件完整示例(物品浏览器/排行榜缓存/色差 shader/建筑分享/manifest 声明/
  worker onmessageRun 胶水契约)
- 实战示例表(五参考 mod)+典型组合速查(QoL→htmlPage+storage;
  Visual→shader+dusts;模拟→tileEntity+worker;联网→net+storage)
- 发布装载(打包/桌面目录/卸载不洗档/联机双房)/FAQ 8 问
- **API 名交叉校验**:node 脚本比对指南 sw.* 引用 vs api.ts 接口面——
  途中抓获 sw.spawnDust 注释谎报(引擎有 Game.spawnDust、sw.* 面缺)→
  补薄封装+指南对齐(文档只写真接口判例)。

**game/README.md**(新建):快速开始/Mod 开发入口段(指南+脚手架命令)/
文档表/技术栈——仓库首个 README。

**scripts/mod-cli.mjs 升级(TS/JS 双语言脚手架)**:
- `init <dir> --ts`=TypeScript 入口(main.ts+TS 类型模板+tsconfig[noEmit]);
  缺省=JavaScript(main.js+jsconfig[checkJs:false])
- 两形态都自动拷 mod-api.d.ts(IDE 悬停/补全/编译期键检查全通)
- `build` 自动 TS 编译:scripts/*.ts 经 esbuild(游戏 node_modules 已带)
  编译为同名 .js 进包(源 .ts 不入包——引擎 blob 装载只认 js);
  同名冲突 ts 覆盖+警告;js 工程零路径(缺省路径逐字节不变)
- **E2E 验证**:TS 工程 init→(真实 htmlPage+storage 钩)→build→
  node --check 编译产物 SYNTAX OK→真引擎装载探针 **2/2** 零错。

**互链**:README→guide;guide→howto×2/loader-design/PORTING×2/mod-api.d.ts;
howto×2 头部→guide。**d.ts↔api 奇偶 78/78 零差**(含并行会话 director 面补齐)。
**验收**:mod+集成 40 文件测试全绿;tsc 净。
---

## 导入重装保留启停态(2026-10-16 用户令)

**语义**:导入已存在且【启用】的 mod → 保持启用(旧=面板导入路径显式
enabled:false 落库把启用的强关);重装一律继承 existing.enabled(D-M3 桌面
目录同步语义收编为 install 本体);首装缺省 true(程序化安装语义——面板导入
显式传 false 落「导入不自动启用」2026-10-14 用户令,调用方声明意图)。
**连带**:行序原位更新(非尾插)+addedAt/icon 继承(新 icon 覆盖);
main.ts 桌面目录/探针句柄显式 enabled:true(语义不变);外层 D-M3 setEnabled
补丁撤(install 内已保留,幂等冗余)。面板 hint 按实态显示(重装启用=Installed
+ReloadToApply;首装=InstalledDisabled)。
**守卫**:mod-store-reinstall 4 断言(启用重装保持/停用重装保持/首装缺省
true+面板 false/addedAt·icon·行序)。途中一次缺省收紧(false)炸 12 测
(夹具 install 无 opts 依赖缺省装载)——缺省回归 true+意图显式化,
「导入不自动启用」由面板调用方承担。
**验收**:mod+Tier1+集成 **41 文件测试**全绿;tsc 净。
---

## AGENTS.md 移植/材质包手册 + L1 假目录文档案定谳清偿(2026-10-22)

**AGENTS.md §九/§十**(用户令):移植 tML mod 方案(六步流程:解包
_TmodFile.cs:198-260 定谳→画像对标 calamity-port-assessment 工时锚 8k 行/日
→提取器文化→L1→L2→tML headless oracle 验证)+ tML→sw 概念映射表 +
五参考移植索引 + 材质包导入要求(原版 ResourcePack.cs 1:1 形态/三通道/
逐像素验收/五坑判例)。§七档案表补三行指针。

**定谳(AGENTS.md「16 域」口径核对时炸出)**:mod-dev-guide 三处假目录
——`content/pets|drops|achievements/` 装载器零消费(pets=物品 `pet` 字段/
drops=NPC `drops` 内嵌/成就纯脚本),`recipes|shops` 目录形亦假(实=单文件
content/recipes.json|shops.json)。mod 作者照文档写=内容静默丢失零报错
(判例㊷ sw.spawnDust 文档谎同族)。

**清偿三刀**:
1. **成就 JSON 面补真**(L1 哲学:纯条件成就零脚本):plan.parseAchievement
   (键/title/conditions 五 kind 白名单校验)→ achSpecs → register 期
   collectModAchievement 与脚本路径合流(apply 先于 entry 相位=跨形态同键
   在脚本侧 fail-fast 成 mod 级错误;JSON 内同键=plan 级整批拒载);
   loader 出口 buildModAchievementDefs 统一翻译不变。热重载沿
   teardown 既有 _resetModAchievements 清账天然闭环。
2. **未知 content/ 目录 fail-loud 警告**:plan.ts KNOWN_CONTENT_DIRS
   (12 目录域)外任何 content/<dir>/ → console.warn 一次(不拒载);
   新增目录域必须同步该表。
3. **文档讲实话**:guide §2 布局(recipes.json/shops.json 单文件+pets/drops
   内嵌注记)、§3.7/§3.8 标题与示例(数组形 {recipes:[...]}——旧示例裸对象
   对单文件约定也是错的)、§3.11 重写(pet 字段+buff 必填)、§3.15 重写
   (drops 数组四形态:chance/bossBag/flag 条件门/vid 直通——buildDropRules
   实装面)、「15 域」→16 域(成就域 2026-10-14 落,战役档案的「15 域」
   为当时真值不动);README 同步。

**守卫**:tests/mod-achievement-l1.test.ts 4 断言(JSON 全链翻译+图标 job+
引擎通知驱动/JSON 同键整批拒载/JSON+脚本同键脚本相位 fail-fast——
modId=achl1 断言同时证明 JSON 先入列相位序/未知目录警告不拒载)。
存量零误伤:mods/ 与 tests/ 的 content 目录形态全在已知集
(calamity/rivals/magic-storage 等实形核对)。
**验收**:mod 域 41 文件 224 测全绿;tsc 净(并行会话文件除外)。
