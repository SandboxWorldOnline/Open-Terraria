# SandboxWorld Mod 开发指南

> 面向 mod 作者的完整开发文档。SandboxWorld 是 Terraria 1.4.5.7 的浏览器复刻
> (TypeScript + Canvas),mod 平台对齐 tModLoader 的核心概念(声明式内容 +
> 脚本钩子),并独有六项浏览器能力接口(富 DOM UI / 持久存储 / GLSL 后处理 /
> 剪贴板 / 联网 / 计算卸载)。
>
> - 引擎设计定谳:[mod-loader-design.md](mod-loader-design.md)
> - Boss mod 工作流(实战):[howto-boss-mod.md](howto-boss-mod.md)
> - 城镇 NPC mod 工作流(实战):[howto-town-npc-mod.md](howto-town-npc-mod.md)
> - 接口类型签名(IDE 用):[../templates/mod-api.d.ts](../templates/mod-api.d.ts)
>   ——拷入 mod 工程根,tsconfig `"include": ["mod-api.d.ts", "scripts/**/*.ts"]`
> - mod 开发脚手架:`node scripts/mod-cli.mjs init|build|validate`(模板/打包/校验)

---

## 目录

1. [快速开始(10 分钟)](#1-快速开始)
2. [包格式 .swmod](#2-包格式-swmod)
3. [L1 声明式内容(16 域)](#3-l1-声明式内容16-域)
4. [L2 脚本 API 总表](#4-l2-脚本-api-总表)
5. [浏览器独有接口(Tier1 六件)](#5-浏览器独有接口tier1-六件)
6. [实战示例](#6-实战示例)
7. [发布与装载](#7-发布与装载)
8. [常见问题](#8-常见问题)

---

## 1. 快速开始

```bash
# 脚手架(在 game/ 目录;--ts=TypeScript 入口[tsconfig+类型模板],缺省=JavaScript)
node scripts/mod-cli.mjs init mods/my_mod --ts
# 产出模板工程(mod.json/content//textures//scripts/main.ts+mod-api.d.ts+tsconfig.json)

# 校验(schema/引用/键唯一;打包前必跑)
node scripts/mod-cli.mjs validate mods/my_mod

# 打包 → .swmod(scripts/*.ts 自动 esbuild 编译进包;js 工程零路径)
node scripts/mod-cli.mjs build mods/my_mod -o mods/dist/my_mod.swmod

# 开发期装载:启动游戏 → 标题屏 Mod 按钮 → 导入 zip
```

**TypeScript 与 JavaScript 双支持**:两种入口最终都编译为 `scripts/main.js`
进包(TS 经 esbuild,类型检查走工程内 tsconfig——`npx tsc --noEmit`);
`mod-api.d.ts` 类型契约自动拷入工程(IDE 悬停/补全/编译期键检查全通)。
**入口代码禁 TS 专属运行时语法之外的一切**(纯类型标注 ok;`!.` 非 null
断言编译后消失 ok)。

**最小可玩 mod**(一个物品 + 一段脚本):

```
my_mod/
  mod.json
  content/items/wand.json
  textures/items/wand.png
  scripts/main.js
```

```jsonc
// mod.json
{
  "id": "my_mod",            // ^[a-z][a-z0-9_]{1,31}$;全键前缀 mod_<id>_ 派生
  "name": "我的第一个 Mod",
  "version": "1.0.0",
  "api": 1,
  "side": "both"             // both | client | server
}
```

```jsonc
// content/items/wand.json
{
  "key": "wand",
  "name": "星火魔杖",
  "value": 500,
  "maxStack": 1,
  "rare": 3,                             // 原版档 3=蓝;或 {"$rarity": "my_tier"} 引用自建档
  "combat": { "damage": 42, "knockBack": 5, "useTime": 18, "useAnimation": 24,
               "mana": 8, "shoot": "proj:spark", "shootSpeed": 9 },
  "texture": "items/wand.png"            // textures/ 相对路径
}
```

```js
// scripts/main.js —— 入口(main(sw) 同步执行)
export default function main(sw) {
  sw.log('my_mod ready!');

  // 声明弹幕(贴图+重力)
  // content/projectiles/spark.json 声明 {"key":"spark","texture":"proj/spark.png","gravity":0.12,...}

  // 弹幕行为钩:命中敌怪 20% 概率掉一枚星尘
  sw.projectileHook('spark', {
    onHit(p, enemy, game) {
      if (Math.random() < 0.2) sw.spawnItem(game, sw.itemIdOf('stardust'), p.x, p.y, 1);
    },
  });
}
```

**这就是全部**——装载后 wand 可合成(需配方)/可挥射/弹幕追尾逻辑生效。

---

## 2. 包格式 .swmod

zip 包,目录结构:

```
mod.json                  清单(id/name/version/api/side/dependencies/config/net)
content/
  items/*.json            物品(§3.1)
  tiles/*.json            方块(§3.2)
  walls/*.json            墙(§3.3)
  npcs/*.json             NPC(§3.4)
  projectiles/*.json      弹幕(§3.5)
  buffs/*.json            Buff(§3.6)
  recipes.json            配方(§3.7;★单文件,数组或 {recipes:[...]})
  shops.json              商店(§3.8;★单文件)
  gores/*.json            死亡碎块(§3.9)
  rarities/*.json         稀有度档色(§3.10)
  mounts/*.json           坐骑(§3.12)
  hairs/*.json            发型(§3.13)
  dusts/*.json            尘埃粒子(§3.14)
  achievements/*.json     成就(§3.16)
                          ★宠物(§3.11)=物品 pet 字段、掉落(§3.15)=NPC drops
                          字段——内嵌声明,无独立目录;写 content/pets/ 或
                          content/drops/ 目录会被 fail-loud 警告并忽略
textures/
  items/ tiles/ npcs/ ... 贴图(PNG;路径即 content 里 texture 字段)
  ui/*.png                sw.ui.htmlPage/addImage 用(约定目录)
  armor/<key>_<Part>.png  盔甲贴图(Head/Body/Legs)
workers/*.js              计算卸载 worker 脚本(§5.6)
i18n/zh-Hans.json 等      l10n(Mods.<id>.* 键)
scripts/main.js           L2 入口(可选)
icon.png                  面板图标
```

- **id 分配全确定性**(拓扑序+字典序):物品 30000+/tile 1030+/NPC 800+/
  弹幕 2000+/buff 9000+/墙 367+/gore 1500+/稀有度 12+——联机与存档一致性的根。
- 依赖:`"dependencies": {"calamity": "^6.0.0"}`(拓扑装载,缺依赖拒载)。
- 联网声明(§5.5):`"net": ["api.example.com", "*.cdn.example.org"]`。
- 声明式配置:`"config": {"power": {"type": "number", "default": 2}}`
  → `sw.config.get('power')`。

---

## 3. L1 声明式内容(16 域)

声明面全部走 `content/*.json`(零代码执行,装载期 schema 校验 fail-fast)。
**规则:能声明就声明**——声明面自动获得存档/联机/资产/l10n 全链支持,
脚本只写行为差异。

### 3.1 物品 content/items/*.json

```jsonc
{
  "key": "blade",                  // mod 内唯一;全键 mod_<id>_blade
  "name": "湮灭之刃",
  "value": 2500, "maxStack": 1,
  "rare": {"$rarity": "void"},     // 自建档(§3.10);或原版数字 -13..10
  "combat": {                      // vanilla-itemcombat 语义
    "damage": 180, "knockBack": 6.5, "useTime": 14, "useAnimation": 22,
    "shoot": "proj:void_wave",     // 本 mod 弹幕(proj: 前缀);数字=原版弹 vid
    "shootSpeed": 11, "crit": 8
  },
  "func": {                        // vanilla-itemfunc 语义
    "useStyle": 1, "autoReuse": 1, "mana": 10,
    "healLife": 60, "buffType": "my_rage", "buffTime": 300   // mod buff 键
  },
  "stats": { "hs": 4, "bs": 6, "ls": 5, "acc": 1, "def": 10 },   // 装备槽
  "placeTile": "void_altar",       // 放置本 mod tile
  "placeWall": "void_brick",       // 放置本 mod 墙
  "mountItem": "void_steed",       // 坐骑召唤物(§3.12)
  "glowmask": { "texture": "items/blade_glow.png" },   // 发光贴图
  "pet": { "buff": "void_wisp", "proj": "wisp", "light": true },   // 宠物(§3.11)
  "deathGore": "void_splat",       // 死亡碎块(§3.9)
  "dropSound": "Item_10",
  "texture": "items/blade.png"
}
```

### 3.2 方块 content/tiles/*.json

```jsonc
{
  "key": "void_altar",
  "name": "虚空祭坛",
  "solid": true, "pick": 65,              // 采集力需求(0=不可采)
  "mapColor": "#5A2A82",
  "w": 3, "h": 2,                          // 占格数(framed 件)
  "light": true, "lightColor": "#B080FF",
  "blend": true,                           // 与相邻同型合并
  "texture": "tiles/void_altar.png",       // TEdit 同构整表(§3.2.1)
  "dropItem": "void_shard", "dropMin": 2, "dropMax": 4
}
```

**3.2.1 贴图布局约定**(与原版一致):framed 件贴图=竖排 style 帧,
每帧宽 w×16+2px gutter、高 h×16+2px;非 framed=整块平铺。

### 3.3 墙 content/walls/*.json

```jsonc
{ "key": "void_brick", "mapColor": "#2A1A3A",
  "unbreakable": false,                    // true=锤墙恒拒(地牢 unsafe 墙同款)
  "dungeonGate": "skeletron",              // "golem" 需石巨人
  "dropItem": "void_brick_item",           // 锤墙掉落(缺省不掉)
  "largeFrame": 0, "rows": 5, "texture": "walls/void_brick.png" }   // 468×180 TEdit 整表
```

### 3.4 NPC content/npcs/*.json

```jsonc
{
  "key": "void_reaper",
  "name": "虚空收割者",
  "aiStyle": 0,                    // 0=自定义(sw.npcAi 接管);或原版家族 3/14/17...
  "lifeMax": 4200, "damage": 70, "defense": 30,
  "knockBackResist": 0.5,
  "width": 60, "height": 90,
  "frames": 6,                     // 竖排帧数
  "boss": true,                    // Boss 血条+击杀旗
  "townNPC": true,                 // 城镇 NPC(入住链;见 howto-town-npc-mod.md)
  "noGravity": false, "noTileCollide": false,
  "drops": [{ "item": "void_essence", "min": 8, "max": 14, "chance": 1 }],
  "texture": "npcs/void_reaper.png"
}
```

- 死亡碎块:`"deathGore": ["reaper_arm", "reaper_head"]`(§3.9)。
- 蠕虫链:`"wormChain": {"segs": ["reaper_body", "reaper_tail"]}`。
- 帧率/Glowmask/全发光/层序:见 §4 `npcDraw` 声明补充。

### 3.5 弹幕 content/projectiles/*.json

```jsonc
{
  "key": "void_wave",
  "texture": "proj/void_wave.png",
  "width": 30, "height": 22,
  "gravity": 0, "lifetime": 240, "pierce": 3,
  "frames": 4, "frameRate": 6,        // 竖排帧表
  "tileCollide": true, "rotateToVelocity": false,
  "additive": true,                   // A=0 加性(拖尾/光晕)
  "fullbright": true,                 // 不受光照
  "overPlayers": false,               // 画在玩家层之上
  "homing": 0.08, "homingDist": 600, // 追踪加速度/距离门
  "npcDebuff": { "buff": "void_curse", "duration": 4, "chance": 0.35 }
}
```

### 3.6 Buff content/buffs/*.json

```jsonc
{ "key": "void_curse", "name": "虚空侵蚀", "desc": "持续受到虚空伤害",
  "texture": "buffs/void_curse.png" }
```
脚本侧 `sw.buff('void_curse', { texture, onTick(player, game) {} })` 挂行为
(声明+代码二选一,行为重的走脚本)。

### 3.7 配方 content/recipes.json(★单文件:数组或 {recipes:[...]})

```jsonc
{ "recipes": [
  { "create": "void_blade", "createStack": 1,
    "items": [ { "item": "void_shard", "stack": 12 } ],   // mod 键或原版数字 vid
    "tile": "void_altar",                                   // 站点(本 mod tile 键/原版数字)
    "water": false, "honey": false, "lava": false } ] }
```

### 3.8 商店 content/shops.json(★单文件:数组或 {shops:[...]})

城镇 NPC 的商品清单(npcId=原版 vid 或 mod 城镇 NPC 键/物品键/价格)。

### 3.9 Gore(死亡碎块)content/gores/*.json

```jsonc
{ "key": "reaper_head", "texture": "gores/reaper_head.png" }
```
NPC json `deathGore: [...]` 引用;死亡时按物理弹射(引擎池 600)。

### 3.10 稀有度档 content/rarities/*.json

```jsonc
{ "key": "void", "color": "#8A2BE2" }
```
物品 `rare: {"$rarity": "void"}` 引用——档色进 tooltip/拾取飘字/词缀位移全链。

### 3.11 宠物(物品 `pet` 字段——无独立目录)

宠物 = **物品 json 的 `pet` 字段**(tML 同构:buff+proj 组合,无 ModPet 类);
召唤/跟随/光宠槽/换装全链自动接通:

```jsonc
// content/items/void_wisp_item.json
{ "key": "void_wisp_item", "name": "虚空幽火", "value": 50000,
  "pet": { "buff": "void_wisp",        // ★必填:mod buff 键(content/buffs 注册)
           "proj": "wisp",              // 本 mod 弹键(content/projectiles 声明)
           "light": true } }            // true=光宠槽(装备槽 1);缺省=宠物槽 0
```

### 3.12 坐骑 content/mounts/*.json

```jsonc
{ "key": "void_steed", "buff": "steed_summon", "texture": "mounts/void_steed.png",
  "runSpeed": 9, "acceleration": 0.18, "jumpHeight": 14, "jumpSpeed": 11,
  "flightTimeMax": 120, "canUseWings": false }
```
物品 `mountItem: "void_steed"` + mod buff 键。

### 3.13 发型 content/hairs/*.json

```jsonc
{ "key": "void_hair", "texture": "hairs/void_hair.png",
  "back": "hairs/void_hair_back.png", "female": true, "creation": true }
```
id 段 228-255(28 槽);角色创建/理发店自动入列。

### 3.14 尘埃 content/dusts/*.json

```jsonc
{ "key": "void_mote", "texture": "dusts/void_mote.png",
  "motionType": 6,             // 运动复用原版型(6=火苗上飘);缺省 15
  "fullbright": true, "scale": 1.2 }
```
`sw.spawnDust(game, type, x, y, ...)` 生成(数字 type=原版型/本 mod 400+ 分配型);mod 键 400+ 段反查表=登记。

### 3.15 掉落表(NPC `drops` 字段——无独立目录)

掉落 = **NPC json 的 `drops` 数组**(见 §3.4),逐条翻译成引擎掉落 Rule:

```jsonc
"drops": [
  { "item": "void_essence", "min": 8, "max": 14, "chance": 1 },
  { "item": 23, "chance": 0.1 },                                  // 原版裸 vid 直通
  { "item": "void_bag", "bossBag": 1 },                           // 专家档掉袋(经典档不掉)
  { "item": "void_key", "chance": 0.5, "flag": "hardMode" }       // 条件门:hardMode/downed_* 世界旗
]
```
更复杂的规则树走 L2 钩(`sw.onNpcDeath`/`sw.globalNpc`)。

### 3.16 成就 content/achievements/*.json(或 sw.achievement 声明)

```jsonc
{ "key": "void_slayer", "title": "虚空终结者", "desc": "击败虚空收割者",
  "icon": "icons/void_slayer.png",
  "conditions": [ { "kind": "npcKilled", "keys": ["void_reaper"] } ] }
```
四 kind 自动驱动(npcKilled/itemPickup/itemCraft/tileDestroyed);`custom`
走 `sw.completeAchievement('void_slayer')` 直完。

---

## 4. L2 脚本 API 总表

入口 `scripts/main.js`:`export default function main(sw) { ... }`。
全部接口挂在 `sw` 对象;键引用一律用**本 mod 内短键**(引擎自动解析全键)。

### 实体与战斗

| 接口 | 语义 |
|---|---|
| `sw.npcAi(key, fn)` | 接管 NPC AI(每 fixedUpdate;共享尾段照走) |
| `sw.vanillaNpcAi(ids, fn)` | 接管原版 NPC AI(复仇模式改造族) |
| `sw.globalNpc({preAi, postAi, incomingHit, onHitByAny, onKill})` | 全域 NPC 钩(tML GlobalNPC 形,含原版) |
| `sw.onHitNpc(itemKey, fn)` / `sw.onHitAny(fn)` | 物品命中/任意命中钩 |
| `sw.onNpcDeath(key, fn)` | NPC 死亡钩 |
| `sw.projectileHook(key, {update, onHit, onHitPlayer, onTileHit, onChannelEnd, preDraw, draw, postDraw})` | 弹幕行为+自绘三钩 |
| `sw.playerHook(kind, fn)` | 九 kind:modifyHurtByNpc/modifyHitNpc/modifyHitNpcByProj/modifyHitPlayerByProj/preHurt/postHurt/respawn/updateDead/modifyMoveSpeed |
| `sw.npcDraw(key, {preDraw, postDraw})` | NPC 自绘(preDraw false=跳原版) |
| `sw.itemDraw(key, {...})` | 物品世界自绘 |
| `sw.playerDraw({postDraw})` | 玩家外观 overlay |
| `sw.spawnProj(game, key, x, y, vx, vy, dmg, kb, ownerIsPlayer)` | 生成弹幕 |
| `sw.spawnNpc(game, key, x, y)` | 生成 NPC |
| `sw.spawnItem(game, itemId, x, y, stack)` | 生成掉落物 |
| `sw.enemyBuff(e, key, sec)` / `sw.enemyBuffVanilla(e, vid, sec)` | 施加 debuff |
| `sw.playerBuff(key, sec, player)` / `sw.playerImmune(key, player)` | 玩家 buff/免疫 |
| `sw.npcSpawnStats(fn)` | NPC 出生 stats 修正(HP 乘表) |
| `sw.tileEntity(key, spec)` | tile entity(§4.1) |

### 物品与交互

| 接口 | 语义 |
|---|---|
| `sw.itemUse(key, fn)` | 左键使用(返 true=消费) |
| `sw.canUse(key, fn)` | 使用条件门 |
| `sw.holdItem(key, fn)` | 手持每 tick |
| `sw.accEffect(key, fn)` / `sw.accEffectAppend` | 配饰效果 |
| `sw.tileInteract(key, fn)` | tile 右键 |
| `sw.armorSet(spec)` | 套装加成 |
| `sw.rollPrefixFor(vid)` | 随机词缀掷 |
| `sw.modifyTooltip(itemKey, fn)` | tooltip 行修改 |
| `sw.healItem(fn)` | 治疗物消费钩 |
| `sw.playerThorns(fn)` | 荆棘反伤 |
| `sw.dodgeRoll(fn)` / `sw.damageGate(fn)` / `sw.playerHurt(fn)` | 闪避/伤害闸/受击 |
| `sw.dashType(spec)` | dash 类 |
| `sw.parryGate(fn)` / `sw.parrySuccess(fn)` | parry 窗口/成功 |

### 世界与系统

| 接口 | 语义 |
|---|---|
| `sw.system({preUpdate, postEntities, postUpdate, onWorldLoad, onWorldUnload})` | 生命周期 |
| `sw.registerGenPass(name, fn)` | 世界生成 pass |
| `sw.biomeFlag(flag, spec)` / `sw.biomeConversion(spec)` | 群系旗/蔓延 |
| `sw.spawnPool(fn)` | 刷怪池独占 |
| `sw.chestUnlockCondition(key, fn)` | 功能箱解锁 |
| `sw.screenFx(pass)` | 全屏后处理(exec 自管 GL) |
| `sw.vanillaOverride(slot, anchor, fn)` | 具名修正槽(detour 等价物) |

### 音频/BGM/UI/键位

| 接口 | 语义 |
|---|---|
| `sw.music(key, file)` / `sw.bossMusic` / `sw.biomeMusic` / `sw.setMusic` | BGM 全链 |
| `sw.menuTheme(spec)` | 菜单主题 |
| `sw.playSound(files, vol, x, y)` | 原版音效键 |
| `sw.ui.panel(key, opts)` | 像素面板(addText/addButton/addSlot/addImage/removeElement) |
| `sw.ui.closeAll()` | 关全部本 mod 面板 |
| `sw.keybind(name, key)` / `sw.keyDown(name)` | 键位 |
| `sw.config.get/set` | 声明式配置 |
| `sw.log(...)` | 控制台日志 |

### id 解析(跨域引用)

`sw.itemIdOf` / `sw.npcIdOf` / `sw.tileIdOf` / `sw.projIdOf` / `sw.musicIdOf` /
`sw.tileEntitiesOf` / `sw.ownedProjCount` / `sw.rollPrefixFor` / `sw.projClassOf` /
`sw.readModNpcBuffs` / `sw.modBuffTypeOf`(经 sw.buff 内部)。

### 4.1 Tile Entity(sw.tileEntity)

```js
sw.tileEntity('storage_unit', {
  create: () => ({ items: [] }),                          // 初始 state
  update: (te, game) => { /* 逐 tick */ },                // 每世界 tick
  onDestroy: (te) => { /* 破坏(掉物/播音) */ },
  save: (te) => ({ items: te.state.items }),              // 存档序列化(缺省 state 直存)
  load: (te, data) => { te.state.items = data.items },   // 读档恢复
});
// 枚举:sw.tileEntitiesOf('storage_unit') → [{x, y, key, state}]
```
生命周期全自动:放置自愈建/破坏摘/存读/联机 host 权威快照(module16)。

---

## 5. 浏览器独有接口(Tier1 六件)

tML 没有的能力——**这是 SandboxWorld mod 的差异化边界**。

### 5.1 sw.ui.htmlPage —— 富 DOM overlay UI

HTML+CSS 直接写 UI(自动 scope),声明式事件,数据表格/搜索框/滚动列表零成本:

```js
const page = sw.ui.htmlPage('browser', {
  html: `
    <div class="hd">物品浏览器</div>
    <input data-act="search" placeholder="搜索…">
    <div data-el="results"></div>
    <button data-act="close">关闭</button>`,
  css: `
    .hd { font-size: 18px; color: #7d92d6; margin-bottom: 8px; }
    input { background:#1a2040; color:#fff; border:1px solid #7d92d6; padding:4px 8px; }
    .row { padding:2px 0; cursor:pointer } .row:hover { color:#ffd700 }`,
  actions: {
    search(el) {
      const q = el.value.toLowerCase();
      const results = page.q('[data-el=results]');
      results.innerHTML = ALL_ITEMS
        .filter(i => i.name.toLowerCase().includes(q))
        .map(i => `<div class="row">${i.name}</div>`).join('');
    },
    close() { page.hide(); },
  },
});
```
- CSS 自动加 `.sw-modhtml-<modId>` 前缀(零逃逸);`script/iframe` 等标签剥除。
- 句柄:`page.q(sel)` / `setHtml` / `show` / `hide` / `toggle` / `close`。
- ESC 收最上层;世界卸载全清。

### 5.2 sw.storage —— 持久 KV 存储

```js
await sw.storage.set('progress', { kills: 42, unlocked: ['zone_a'] });
const p = await sw.storage.get('progress');   // 跨会话跨世界
await sw.storage.delete('progress');
```
任意 JSON 值;per-mod 键空间+2MB 配额;与存档独立(任务系统/统计/笔记)。

### 5.3 sw.shader —— GLSL 屏幕后处理

```js
sw.shader({
  src: `
    precision mediump float;
    varying vec2 vUv;
    uniform float uTime;      // 自声明 uniform(uniforms 表注入)
    uniform vec2 uShift;
    void main() {
      vec2 uv = vUv + uShift * sin(vUv.y * 20.0 + uTime) * 0.005;
      gl_FragColor = texture2D(uTexture, uv);   // 采样器固定名 uTexture
    }`,
  uniforms: { uTime: 0, uShift: [0.5, 0.0] },   // 引用对象——运行期改值即动
});
// system 钩里逐帧推时间:
sw.system({ preUpdate: () => { uniforms.uTime += 0.016; } });
```
编译失败=warn+恒等直通(不炸帧);链入 7d 滤镜链最前(全部滤镜之下)。

### 5.4 sw.clipboard —— 剪贴板

```js
await sw.clipboard.write(JSON.stringify(schematicData));   // 建筑分享/导出
const text = await sw.clipboard.read();                    // 读(用户授权门;拒绝=null)
```

### 5.5 sw.net —— 联网 fetch(需 manifest 声明)

```jsonc
// mod.json 必须声明域白名单(未声明=sw.net 为 null)
"net": ["api.example.com", "*.cdn.example.org"]
```

```js
if (sw.net) {
  const leaderboard = await sw.net.fetchJson('https://api.example.com/top10');
  // 仅 https;未声明域 runtime throw;超时 10s/响应 4MB 限
}
```

### 5.6 sw.worker —— 计算卸载

```js
// pack 内 workers/analysis.js:
function onmessageRun(data, reply) {
  // 重计算(世界分析/寻路/统计)——不卡主线程 60fps
  const result = heavyAnalysis(data);
  reply(result);
}
```

```js
// main.js:
const w = sw.worker('analysis.js');
const result = await w.run({ region: [0, 0, 200, 200] });   // 结构化克隆往返
w.terminate();                                               // 用完即终
```

---

## 6. 实战示例

仓库自带五个参考 mod(`mods/<id>/` 源码,`mods/dist/*.swmod` 可直接装载):

| mod | 演示面 | 文档 |
|---|---|---|
| `rivals` | L2 双 Boss 多阶段 AI/体节/弹幕行为/掉落 | [howto-boss-mod.md](howto-boss-mod.md) |
| `glmgirl` | 城镇 NPC 全链(行走/对话/入住/召唤/存档) | [howto-town-npc-mod.md](howto-town-npc-mod.md) |
| `calamity` | 全量转译(5000+ 物品/300 NPC/124 墙/gen pass) | — |
| `magic-storage` | tile entity 跨读网络/带源合成 | [mods/magic-storage/PORTING.md](../mods/magic-storage/PORTING.md) |
| `lights-and-shadows` | screenFx 全屏后处理(光影) | [mods/lights-and-shadows/PORTING.md](../mods/lights-and-shadows/PORTING.md) |

**典型组合速查**:

- QoL/工具类(Recipe Browser 形态)→ `sw.ui.htmlPage`(搜索/表格)+ `sw.storage`(收藏)
- Visual/氛围类 → `sw.shader`(后处理)+ dusts/glowmask 声明
- 内容类(新武器/Boss)→ content/* 声明 + `sw.npcAi`/`sw.projectileHook`
- 模拟/大型类(工厂/流体)→ `sw.tileEntity` + `sw.worker`(重计算卸载)
- 联网类(排行榜/活动)→ `sw.net`(manifest 声明)+ `sw.storage`(缓存)

---

## 7. 发布与装载

- **打包**:`node scripts/mod-cli.mjs build <工程目录> -o <out>.swmod`。
- **Web 装载**:标题屏 → Mod → 导入 zip → 启停(菜单态热重载即时生效;
  游戏内改启停提示刷新)。
- **桌面**:`<userData>/mods/*.swmod` 目录自动发现(启动同步,装即用)。
- **卸载**:面板 ✕(资源缓存随卸载清;存档占位降级+重启用恢复——
  卸载期间物品/TE/墙**不洗档**,有缺 mod 警告 toast)。
- **联机**:hostAuth 中继房(host 权威)/ serverAuth 房(服务器权威);
  TE 走 module16 快照同步;mod 集不对称有 toast 提示(本端 TE 保本地权威)。

---

## 8. 常见问题

**Q: 贴图尺寸?**
NPC=竖排帧条(宽=单帧宽,高=frames×帧高);width/height 声明只定**命中盒**,
渲染=贴图整幅 1:1(要小体型=贴图本身缩小)。tile=TEdit 同构整表。
wall=468×180(13 列×36px)。

**Q: mod id 含下划线可以吗?**
可以(引擎全键匹配精确解析);脚本内引用一律短键,引擎自动挂 `mod_<id>_` 前缀。

**Q: 怎么调试?**
`sw.log()` 进控制台;打包前 `node scripts/mod-cli.mjs validate <工程>` 校验
(schema/引用/键唯一);装载错误进面板 LoadErrors 行。

**Q: 存档兼容?**
mod 内容按稳定 id 存档(确定性分配);缺 mod 读档=占位降级+警告,
**不洗档**——重启用即恢复(物品/TE/墙三面)。

**Q: 与 tML mod 的关系?**
概念同构(content 声明≈.cs SetDefaults、脚本钩≈ModNPC/ModPlayer/GlobalNPC
虚方法),知识可迁移;但 API 名是本仓的(非 tML 源码级兼容)。全量转译
走转译器(tmod → swmod),参考 calamity 移植。

---

*SandboxWorld mod 平台文档 · 2026-10-14 · 引擎 v0.1.x · mod api 1*
