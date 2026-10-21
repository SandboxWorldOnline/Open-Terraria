# AGENTS.md — 给 AI 编码代理的上手指南

> 本文件面向任何 AI 编码代理（Claude Code / Codex / Cursor / 其他）。
> 你没有本项目历史会话的记忆——本文件 + 它指向的仓内档案就是你的「记忆替身」。
> 与 CLAUDE.md（Claude Code 会话的运维细则，位于开发者本机）互补；冲突时以本文件为准。

## 一、这是什么项目

**Terraria 1.4.5.8 的 Web 复刻**（自研引擎，TypeScript + Canvas 2D/WebGL2，无游戏引擎）。

## 二、唯一铁律：先定谳，再动刀

一切修复**先有机制级证据**（源码锚点 / 重放 / 物证），禁止凭感觉改；修复后必有独立验证。
完整方法论见 `docs/methodology/campaign-playbook.md`（大型任务必读）。

**行为真值层级**（高→低）：
1. **反编译源码 `Terarria1457/`（C#）**——不在本仓库！需要开发者在Steam购买Terraria原版后自行反编译获得。
   代价为 1:1 对齐的任何工作都需要它；没有时用下一层。
2. **提取数据表 `src/data/vanilla-*.json`**——从反编译源提取的数值面（物品/NPC/掉落/帧表），
   已过对账闸门，是仓内的数值权威。
3. Terraria Wiki（可能过期，注明来源）。

⚠️ 没有反编译树的会话：做**功能修复**时以数据表+wiki 为据并在 PR 里注明证据层级；
数值对齐类工作（1457/1458 parity）没有反编译树就**不要动数值面**。

**克隆即可跑契约**：clone 后 `npm install && npm run dev / test / build` 全链可跑。
缺失的可选外部依赖（反编译树 / 音效 wav 母带 `assets-src` / fixture 世界）全部**优雅降级**：
缺 → 警告 + 补齐指引，绝不硬崩。你新写的工具也要遵守这个契约。

## 三、仓库地图（快速定位）

| 目录 | 职责 |
|---|---|
| `src/render/` | 渲染管线：chunk 烘焙（ChunkBake/ChunkCache）、液体（VanillaLiquidRenderer）、光照（src/lighting/） |
| `src/entities/` | 玩家/敌怪/弹幕/Boss AI（bossAI_*.ts）/坐骑 |
| `src/world/gen/vanilla/` | 原版世界生成 pass 链（TerrainPass/CavesPass/DungeonPass…） |
| `src/wld/` | 原版 .wld 存档解析/导入 |
| `src/mods/` | mod 系统（L1 声明式 + L2 脚本 API，.swmod 包） |
| `src/data/` | 从反编译提取的数值表 + 图集索引（**受对账闸门保护**） |
| `src/ui/` | DOM UI（背包/设置/合成） |
| `scripts/` | 构建/发布/探针（`_` 前缀 = 一次性诊断探针） |
| `tools/` | 对账闸门/审计器/`_` 前缀 env 门控测试 |
| `tests/` | 正式测试（~1900 文件）+ fixtures |
| `docs/` | **判例档案库**（见第八节） |

## 四、日常命令

```bash
npm install            # Node ≥ 20（开发基准 22）
npm run start:analyze   # ★本地调试首选：构建到 dist-analyze + 预览 http://localhost:4173
                        #  (无 HMR 不反复刷新；--minify false --sourcemap，天然适合分析/断点/性能录制)
npm run dev             # 共享 dev server http://localhost:5199（仅纯 UI/样式快改时用；
                        #  多会话共用，HMR 会互相撕页面；探针场景禁用）
npm test             # vitest 全量（2600+ 用例）
npx tsc --noEmit     # 类型检查（存量 0 错；新错=你的）
npm run build        # 普通构建 → dist/
```

**改动如何进入 main**：只许 PR 合入（分支保护），
CI 必需检查 = gitleaks 全史泄密扫描；PR 模板要求行为类变更填写「原版依据」。
本地 pre-commit 同款钩子：`sh scripts/git-hook-pre-commit.sh --install`。

**1457 数值纪律**：1457 反编译与早期版本（1456）冲突时，一律以 1457 最终态为准；
源码注释标明反编译出处（文件名+行号），注释里的"原版默认 X"是历史最大误读源——
不确定时直接读反编译源码签名行/原始语句，不采信注释转述。

## 五、测试三层结构（不要被数量吓到）

1. **正式测试** `tests/*.test.ts`——回归闸门，必须全绿；
   其中的**金标闸门族**（`atlas-append-golden` / `item-stats-golden-1457` / `npc-stats-golden` /
   `npc-frame-golden` 等）是冻结的权威快照——回滚/重排/手改数据会立即爆红，**红了先找根因，
   禁止重冻金标来"修复"测试**；
2. **`tests/_*.test.ts` / `tools/_*.test.ts`**——案件探针，**env 门控**（如 `SW_III88=1` 才真跑），
   默认 skip 零开销。运行方式 `SW_XXX=1 npx vitest run tools/_xxx.test.ts`；
3. **fixture 档案** `tests/fixtures/`——固定种子世界快照；缺失时测试**按设计 skip 并打印再产指引**
   （`SW_GEN_WORLD_FIXTURES=1 npx vitest run tests/world-fixture-gen.test.ts`）。

修复行为面 = 必须带测试（断言锚在测试头注里标反编译行号）。

## 六、诊断探针纪律（本项目的核心工作方式）

游戏内 **F5** = 一键调试报告（错误日志/行为回放/音频记录）；**长按 F5** = 完整操作序列的长按录制开始或长按录制结束。
用户报障优先要 F5 报告。探针脚本（puppeteer 驱动本机 Chrome）：

```bash
# 必须自带私有 vite 实例（52xx 端口错开，绝不动 5199）
SW_PORT=5201 SW_NO_HMR=1 SW_CACHE=/tmp/sw-vite-5201 nohup npx vite > /tmp/vite-5201.log 2>&1 &
SW_ORIGIN=http://localhost:5201 node tools/run-diag.mjs scripts/_你的探针.mjs
# 收尾 kill 自己的 52xx 实例（先 pgrep 确认）
```

若要接近生产形态（混淆后/性能录制），探针也可直接打 `start:analyze` 的 4173
（`SW_ORIGIN=http://localhost:4173`，改码后重跑构建即生效）。

- **同步驱动帧探针的三个门**（否则 fixedUpdate 不跑、假阴性）：驱动期
  `game.paused=false` + 清 `_tpVeil`/`_entryFreeze` 冻结窗标志（渲染冻结窗
  会绕过逻辑步进）+ 会移动的实体（鸟/兽）逐帧钉位。动态改行为用 wrap
  原型方法，勿用 eval(toString) 重写类方法（语法/绑定坑）。

验证 = 数值说话（像素采样/直方图/逐字节 diff），不看截图感觉。

### 性能调查：Chrome trace 录制 + x-ray 拆解

用户报「卡顿/掉帧」时按此流程自查（不要凭感觉猜热点）：

1. **录制**：4173（analyze 形态）打开游戏 → F12 → Performance 面板 →
   ⏺ Record → 复现卡顿场景（10~60 秒）→ Stop → 右键时间轴 **Save Profile…**
   导出 `.json`（可达数百 MB，属正常）；
2. **拆解**（一次性工具，稳定 schema，别手写扫描器）：
   ```bash
   node --max-old-space-size=8192 tools/trace-x-ray.mjs <trace.json> --md
   # → digest.json + 人读摘要（帧距分布/drawImage%/GC 三类/慢帧 top 函数表）
   # 嫌疑函数归因: --probe fn1,fn2  |  前后对比: diff <a.digest> <b.digest>
   ```
3. **读数口径**（工具头注有完整定义）：主线程=CrRendererMain；
   drawImage% = 样本自耗时/主线程采样墙钟；LPR（LazyPixelRef）≈1/渲染帧=健康 GPU 路径，
   飙到数百/帧=软件栅格慢路径指纹；Commit 单次 p90>10ms=栅格提交病灶。
   修后重录一份 diff，热点消失+帧距回归才算闭环。
4. **读数陷阱**（历史误判案浓缩——trace 里的数不都是真相）：
   - **anchor fps 在轻负载场景全废**：主线程每帧只 2-3ms 时 ≥3ms 的 rAF 锚稀疏，
     fps 会读出 25 这种假数。判帧率稳定性/顿挫必须挖原始 trace 的
     FireAnimationFrame 时间戳差分直方图（python 遍历 traceEvents：主线程
     rAF 批按 >2.5ms 去重合并后取 gap 分布；120fps 锁槽判据=错拍率
     「gap>1.26×档周期」<2%）。曾据假 fps 误判整机降档，实为挥鞭窗采样；
   - **主线程 idle 高 ≠ 没瓶颈**：GPU/合成侧等待在主线程表现为 idle。
     判据=合成器线程 `DrawFrame` 事件 gap 分布（p90>2×档周期=GPU 域病灶）；
   - **对比必须同口径**：「函数体自耗」（cpuProfile nodes 里该函数帧的样本）
     ≠「函数内 API 调用耗时」（drawImage 等的 caller 归因）——拿前者比后者
     曾产出 "-99%" 误报（实际 -10%）；
   - **时域三坑**：①录制器启动成本（CpuProfiler::StartProfiling 250-820ms）
     落在游戏帧里=伪卡顿（x-ray 默认已剔除，手挖时要防）；②trace 含菜单期时
     世界内 span 要从进世界时刻起算；③ProfileChunk 采样时域起点=
     StartProfiling 事件时刻，stall 窗对齐要补偏移；
   - **验证某函数是否在跑/自耗**：遍历 ProfileChunk 的
     `args.data.cpuProfile.{nodes,samples,timeDeltas}`，按函数名匹配样本累加
     timeDeltas（用于确认批/优化路径真的被执行）；
   - **无头探针（puppeteer）的性能读数不可信**：无头 Chrome=SwiftShader 软件光栅，
     GL op 数量级的收益测不出（顶点量相同）；且 Mac 与 Windows 成本模型不同
     （Windows 有 per-op 驱动税）——探针只证正确性，性能结论需用户实机 trace。

## 七、你的「记忆替身」：仓内档案库

本项目的全部决策史都在仓库里，按需查阅：

| 要什么 | 去哪 |
|---|---|
| **70 天逐日开发全记录**（每天做了什么/为什么/怎么做的） | `docs/devlog/DAILY_DEVLOG.md` |
| 迭代方法论（红蓝对抗/金标/收官八步） | `docs/methodology/campaign-playbook.md` |
| 某个机制为什么这样实现（判例/定谳） | `docs/` 按域归档（recon/wave 文档）+ 各源文件头注 |
| 某个 bug 的取证细节 | `docs/evidence/` |
| mod 开发(接口/示例) | `docs/mod-dev-guide.md` |
| **移植一个 tML mod(方案)** | §九 + `docs/calamity-port-assessment.md`(画像/工时锚) |
| mod 平台能力面定谳(五刀战役收官档) | `docs/mod-five-knives-recon-2026-10-13.md` |
| **材质包(资源包)导入** | §十 + `docs/howto-texture-pack.md` |

**红蓝对抗**：重要修复应派两个角色——一个修、一个独立红队专职攻击这次改动
（找回归/边界/副作用，findings 按 CONFIRMED/PLAUSIBLE 定谳，「攻击了什么为何没打穿」写进报告）。

## 八、会咬你的硬规则（历史事故浓缩）

1. **`public/sprites/vanilla.json` / `vanilla-ui.json` 禁手改禁全量重跑**——追加素材一律走
   `node scripts/atlas-append-1457.mjs` 通道；踩坏了用 `sh scripts/restore-vanilla-json.sh` 恢复；
2. **数值/帧表受对账闸门保护**——动 `src/data/vanilla-*.json` 前先跑
   `node tools/recon-item-1456-1457.mjs`（DRIFT 必须=0）与 `node tools/recon-npc-1456-1457.mjs`；
   **动画帧表另有专属闸门**（`node tools/recon-tileanim.mjs` DRIFT=0 + `npx vitest run tests/tile-anim-authority.test.ts`
   双测全绿）——改 `src/render/TileAnim.ts` 三表前必跑；
3. **l10n**：新增 `Mods.SandboxWorld.*` 键先补 l10n 自有源（`tools/l10n-custom/{zh-Hans,en-US}.json`，
   **位于仓库外层目录**——克隆后无此目录时 build-l10n 走既有产物幂等跳过；要改文案源需自备该目录结构）
   再 `node scripts/build-l10n.mjs`，否则 l10n-audit 阻断构建；
4. **改着色器必换全新 `SW_CACHE` 重启 vite**（旧缓存吞新着色器）；
5. **测试夹具勿共享可变状态**（历史上多次「夹具喂幻影值掩护真机炸点」）；
6. **共享热文件禁整文件回写**——并行会话/agent 常见，小粒度 Edit 基于盘上最新内容；
7. grep 用 `command grep`（仅开发者本机环境：grep 被 ugrep 包装会静默漏报二进制文件；标准环境无此问题）。

---

## 九、移植一个 tML mod(方案)

swmod 平台能力面(2026-10-13 五刀战役收官) = **L1 声明式 16 域 + L2 脚本钩
78 面 + 浏览器独有六接口**(富 DOM UI / 持久存储 / GLSL 后处理 / 剪贴板 /
联网 / worker)。工坊普查(`docs/mod-census-2026-10/README.md`:15,859 mod /
3.97 亿累计订阅,1M+ 档 79 个占 54.3%)判谳的 5 缺口(mod UI / 实体自绘 /
L1 补面 / 全局钩 / detour 等价物)已全部落地——战役实录
`docs/mod-five-knives-recon-2026-10-13.md`。

### 流程(六步,先定谳再动刀)

1. **解包**:`node scripts/_tmod-unpack.mjs <x.tmod> <outDir>`。格式以
   TmodFile.cs:198-260 源码定谳(2024.x:条目=varint 名+int32 ulen+int32 clen,
   **无 offset/flag 字节,表序累积定位**;clen==ulen=存储,否则 raw deflate)。
2. **画像评估**:hook 覆写频率普查(哪些域/多少文件/多少行),对标
   `docs/calamity-port-assessment.md` 的画像表;工时锚 = AI 批量转译实证吞吐
   ≈8,000+ 行/日(全量灾厄级 ≈4-7 个月,单 Boss 试点 1-2 周)。
3. **数据面提取**:SetDefaults 族 → `content/*.json`。**提取器文化**:新域先写
   提取器(模板 = `tools/extract-*`,灾厄全套在 `tools/extract-calamity/`),
   产物带 report,**禁手敲数值表**。已知判例:提取器有盲区(placeStyle 案)——
   重产前先反哺盲区,不默认旧产物全对。
4. **L1 声明**:**能声明就声明**(16 域 schema 见 mod-dev-guide.md §3);
   声明面自动获得存档/联机/资产/l10n 全链,id 分配全确定性(拓扑序+字典序)。
5. **L2 脚本钩**:只写行为差异(概念映射见下表);重计算走 `sw.worker`,
   联网走 manifest `net` 域白名单声明。
6. **验证**:mod 域测试(`tests/mod-*.test.ts` 为模板)+ 实机装载探针
   (walk census / 进世界游玩)+ `mods/_integration` 联合装载。数值对拍:
   **有原版可跑就用 tML headless 实跑 oracle**(灾厄 = `mods/calamity/golden-oracle/`
   的 .twld + 逐位面,「三跑三值」定谳);无 oracle 的域靠人工游玩+代码审查,
   差异登记 GAPS 台账,**不静默近似**。

### tML → sw 概念映射

| tML | sw | 说明 |
|---|---|---|
| ModItem/NPC/Proj `.SetDefaults` | `content/*.json`(L1) | 数值面零代码 |
| `ModNPC.AI` / `ModProjectile.AI` | `sw.npcAi` / `sw.projectileHook` | 裸钩无 base class,共享尾段照走 |
| `GlobalNPC` / `GlobalItem` | `sw.globalNpc` / `sw.onHitAny` | 全域含原版实体 |
| `ModPlayer`(字段/命中修正链) | `sw.playerHook`(九 kind) | modifyHurtByNpc/modifyHitNpc 族 |
| `ModSystem` | `sw.system` | preUpdate/postUpdate/onWorldLoad… |
| `ModTileEntity` | `sw.tileEntity` | 存读/联机快照全自动 |
| IL/detour(MonoMod) | `sw.vanillaOverride`(具名修正槽) | 无槽则在引擎侧开显式钩(自有 TS 源码,比 MonoMod 更直接) |
| ModUI / ModConfigScreen | `sw.ui.panel` / `sw.ui.htmlPage` | 像素面板 / 富 DOM overlay |
| HLSL 全屏后处理 | `sw.shader` / `sw.screenFx` | HLSL **不能照搬**,按 WebGL2+本仓混合语义重写 |

### 参考移植(全在仓内,源码+定谳文档)

| mod | 演示面 | 文档 |
|---|---|---|
| `rivals` | Boss 多阶段 AI/弹幕/掉落 | `docs/howto-boss-mod.md` |
| `glmgirl` | 城镇 NPC 全链(入住/对话/召唤/存档) | `docs/howto-town-npc-mod.md` |
| `calamity` | 全量转译(6.83.0,12,216 文件,320+ 刀) | `mods/calamity/GAPS.md`(7,393 行台账) |
| `magic-storage` | tile entity + 邻接网络 + 带源合成 | `mods/magic-storage/PORTING.md` |
| `lights-and-shadows` | 全屏后处理(XNA 输出合并器逐级钳语义精推) | `mods/lights-and-shadows/PORTING.md` |

### 会咬你的判例(mod 移植特有)

- **mod gen pass 集成挂死**:FCP tileFrame 引擎自环(2×2 零命中败支),
  「>20min 生成」案 = GAPS.md 三百二十刀(修后 26s);新 gen pass 上线前
  必跑全管线计时,不能只看单 pass 正确。
- **L1 声明形态**:recipes/shops = 单文件(`content/recipes.json`/`shops.json`),
  宠物/掉落 = 内嵌字段(物品 `pet`/NPC `drops`)——写成目录=内容静默丢失;
  装载器现已对未知 `content/<dir>/` fail-loud 警告(2026-10-22 pets/drops
  假目录文档案),新增目录域必须同步 `plan.ts` 的 `KNOWN_CONTENT_DIRS`,
  文档接口声明以 `templates/mod-api.d.ts` + 实装代码为准、禁照抄旧文档。
- **存档降级面**:缺 mod 读档 = 占位+携带,**禁洗档**(A1 语义三域:
  物品/TE/墙)——动 save 链前先读 mods 侧占位实现(unloaded item/TE 携带)。
- **重装语义**:重装已启用 mod 保留既有启停态;首装缺省启用、面板导入
  不自动启用(意图在调用方显式传,勿改缺省值——曾因收紧缺省炸 12 测)。

---

## 十、材质包(资源包):导入要求与验收

**形态 = 原版 ResourcePack.cs 1:1**(`src/resources/` 即 M13 原版语义实现;
被退役的只是 RemotionPanel 自创格式的用户入口,运行时底座共用)。
权威档:`docs/howto-texture-pack.md`(实测样本 = Waifu 3293723058,
3029 文件,端到端含重启持久恢复)。

### 包格式(受理门)

根 = `pack.json`(Name/Author/Description/Version)+ 可选 `icon.png` + `Content/**`:

- `Content/Images/<资产名>.png`——平铺命名(NPC_474/Item_4888/Gore_320/
  Armor_Head_184/Player_0_4);`Images/UI/**`(含 Cursor);
- `Content/Sounds/**`——原版 .xnb 音效(仅 PCM;LZX/ADPCM 登记跳过);
- `Content/Music/Music_<id>.*`、`Content/Fonts/**`、`Content/Localization/`;
- `Content/TownNPCs/`——档案名族(`<Name>_<Variant>.png` + `Shimmered/` +
  `Portraits/Portrait_<X>.png`,城镇 NPC 本体+对话头像全链)。

键映射 = `src/resources/packPaths.ts`(平铺族/UI 展平/Armor 双写/玩家分件
双写 vanilla/+vanilla-ui/)。**改映射表 = 改代码走测试**,不是改数据配置。

### 三条导入通道

| 通道 | 形态 | 链路 |
|---|---|---|
| zip 上传 | .zip | `importPack` → `readResourcePack` |
| 文件夹导入 | webkitdirectory 选区 | `importPackFromFiles` → `readResourcePackFromFiles`(持久化回封 STORED zip) |
| 桌面工坊扫描 | Steam 订阅目录 | `desktop/main.mjs` 路由(候选根穷举 mac/win/linux/多库盘 vdf)→ 现打包 zip → 既有 zip 通道 |

### 验收(动解析/映射/导入链后必跑)

1. **round-trip 持久**:导入→启用→刷新→恢复(有单测);
2. **逐像素比对**:注入位图 vs 原版文件 diffPct(关类别=0 / 开=非 0)——
   **禁屏幕饱和度采样**(向导走动+光照污染判例);探针
   `scripts/_waifu-pack-probe.mjs` / `scripts/_rp-cats-probe.mjs`;
3. **类别开关差量回退**:每包 12 类开关,`appliedImageKeys` 台账差量回退
   (重放只加不减 = 旧病);
4. **坏包防线**:全透明 sheet 拒绝 + 回退原版(控制台拒绝日志 = 预期);
   Sfx 覆盖解码失败回退原版 fetch(旧 = markFailed 静默吞原版声)。

### 会咬你的坑(全部实报判例)

- 文件夹回封必须 `normalizePackFilePaths`(带 webkitRelativePath 外层前缀
  → 刷新后「缺 pack.json」);
- 手写 STORED zip 三坑:`Array.flat()` 不展平 TypedArray / 本地+中央头段
  必须写文件名字节 / pack.json 要进包体文件面;
- `.xnb` 扩展名须保留到解码分派(剥掉 = 原始 XNB 直进 Sfx 覆盖表 → 静默);
  XNB v5 容器是 **7bit shared/objects 计数**(误读 u32 = 多吞 6 字节);
- 换肤覆盖键序:**包自带显式键优先**,root `NPC_<id>.png` 派生别名只作兜底;
  NPC_Head 派生头像已撤(包自带真头像,派生放大过度)。
