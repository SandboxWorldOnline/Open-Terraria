// 注册桥(2026-10-04):RegistrationPlan → 各数据模块注册 API。
// 域翻译在这里集中:mod 内容键 → 全键/stable id/tile 键/掉落 Rule。
// 全部走各数据模块的 registerMod* 追加面(零改原版面;零 mod 时整文件无副作用)。
import type { RegistrationPlan } from './types';
import { registerModItem, ITEM_DEFS } from '../data/items';
import { registerModTile, TILE_BY_KEY, TILE_DEFS, WALL_BY_KEY, type TileDef } from '../data/tiles';
import { ITEM_TO_MOUNT } from '../entities/Mounts';   // ★第三批:mod 坐骑物品映射
import { registerModNpc, registerModTownNpc, type VanillaNpc } from '../data/vanillaNpcs';
import { registerModBoss, registerModWormChain } from '../entities/Enemy';
import { registerModBuff, modBuffTypeOf } from './buffs';
import { appendModSummonEntries, type SummonEntry } from '../core/DebugSummonPanel';
import { registerModRecipes, registerModAdjTile, type VanillaRecipe } from '../data/vanillaRecipes';
import { registerModItemFunc } from '../data/vanillaItemFunc';
import { registerModCombat } from '../data/vanillaItemCombat';
import { registerModStats } from '../data/vanillaItemStats';
import { registerModWingStats } from '../data/vanillaWingStats';
import { registerModNpcRules, registerModNpcValue } from '../drops/NpcDrops';
import { registerModProj, registerModNpcOnHitPlayerBuff } from './hooks';
import { registerModRarity, modRarityIdOf } from './rarity';   // ★刀3-1:稀有度档色
import { registerModPet } from './pets';                        // ★刀3-2:mod 宠物
import { registerModEquipKind } from '../data/vanillaEquip';    // ★刀3-2:装备分类 overlay
import { registerModGoreId, registerModGoreTexSize, registerModNpcDeathGore, modGoreIdOf } from './gore';   // ★刀3-3:mod gore
import { registerModWall, registerModWallMeta } from './walls';   // ★刀3-墙:mod 墙
import { registerModNpcDrawSpec, registerModItemGlowmask } from './drawspecs';   // ★刀2-C1:绘制声明面
import { registerModCanUseRule } from './hooks';   // ★刀5-A 族:canUse 声明规则
import { registerModHairData } from './hairs';   // ★第三批:mod 发型
import { registerModDustData } from './dusts';   // ★第四批:mod 尘埃
import { collectModAchievement } from './modAchievements';   // ★成就域 L1 面(content/achievements/*.json)
import { bumpHairCountMax } from '../player/Appearance';   // ★R-A:hairCountMax 可变顶(零调用修正)
import { registerModMountData } from './mounts';   // ★第三批:mod 坐骑

/** pack 贴图字节(带 textures/ 前缀归一;register 期 PNG 头读取用) */
function packTexBytesLocal(pack: { files: Map<string, Uint8Array> } | undefined, texPath: string): Uint8Array | null {
  if (!pack) return null;
  return pack.files.get(texPath.startsWith('textures/') ? texPath : `textures/${texPath}`)
    ?? pack.files.get(texPath) ?? null;
}
import { MOD_SPAWN_RULES } from '../world/spawn/VanillaSpawner';
import { registerModBiomeFlag } from '../world/SceneMetrics';

const PENDING_BIOME_FLAGS: Array<{ flag: string; tileId: number }> = [];
/** ★D11-M2(2026-10-14):pending 群系旗 teardown(热重载;旧=漂移 internal 复活) */
export function _resetPendingBiomeFlagsForTests(): void {
  PENDING_BIOME_FLAGS.length = 0;
}

/** 装载完成后由 loader 调:注册 mod 群系旗(SceneMetrics 通用面;threshold 40) */
export function bindModBiomeFlags(): void {
  for (const { flag, tileIds } of groupBiomeFlags()) registerModBiomeFlag({ flag, tileIds, threshold: 40 });
}
function groupBiomeFlags(): Array<{ flag: string; tileIds: number[] }> {
  const m = new Map<string, number[]>();
  for (const { flag, tileId } of PENDING_BIOME_FLAGS) {
    const arr = m.get(flag) ?? []; arr.push(tileId); m.set(flag, arr);
  }
  return [...m].map(([flag, tileIds]) => ({ flag, tileIds }));
}
import { registerModShopStock } from './shops';
import { registerModResearch } from '../stats/Research';

export interface RegistrationApplied {
  items: number; tiles: number; npcs: number; recipes: number; projs: number;
}

/** combat.shoot 域换算(P2):数字=原版 vid 直传;字符串 `proj:<key>`/mod 键 →
 *  分配表 allocated projId(ModProj 分流门=projId≥2000 段) */
function resolveShoot(plan: RegistrationPlan, modId: string, raw: number | string): number | string | undefined {
  if (typeof raw === 'number') return raw;
  const full = raw.startsWith('mod_') ? raw
    : raw.startsWith('proj:') ? `mod_${modId}_${raw.slice(5)}`
      : `mod_${modId}_${raw}`;
  const id = plan.allocation.projs.get(full);
  if (id === undefined) throw new Error(`[mod-register] mod ${modId} 引用未注册弹幕: ${raw}`);
  return id;
}

/** tile 键解析:本 mod tile 键 / 原版 tile 键(直接透传,TILE_BY_KEY 同域) */
function resolveTileKey(modId: string, tileKey: string): string {
  return tileKey.startsWith('mod_') ? tileKey : tileKey;
}

/** mod 配方 → VanillaRecipe 域翻译。tile:数字=原版 TileID;字符串=tile 键
 *  (原版键经 TILE_BY_KEY 换 internal id——站点门按 internal id 求值)。 */
function buildVanillaRecipe(plan: RegistrationPlan, modId: string, spec: RegistrationPlan['recipes'][number]['spec']): VanillaRecipe {
  const keyOf = (raw: string): number => {
    if (/^\d+$/.test(raw)) return Number(raw);                      // 原版 vid(数字字面)
    const full = raw.startsWith('mod_') ? raw : `mod_${modId}_${raw}`;
    const id = plan.allocation.items.get(full);
    if (id === undefined) throw new Error(`[mod-recipe] mod ${modId} 配方引用未注册物品: ${raw}`);
    return id;
  };
  const items: VanillaRecipe['items'] = [];
  for (const it of spec.items ?? []) items.push({ id: keyOf(it.item), stack: it.stack });
  for (const it of spec.vanillaItems ?? []) items.push({ id: it.id, stack: it.stack });
  let tile = -1;
  if (typeof spec.tile === 'number') tile = spec.tile;
  else if (typeof spec.tile === 'string') {
    const tk = resolveTileKey(modId, spec.tile);
    if (tk.startsWith('mod_')) {
      const stable = plan.allocation.tiles.get(tk);
      if (stable === undefined) throw new Error(`[mod-recipe] mod ${modId} 配方站点 tile 未注册: ${tk}`);
      // ★B5b 真机探针定谳:站点门(stationSatisfierTiles/craftingGrid)按【internal id】
      //  比对,mod tile internal=注册序数组下标 ≠ stable——曾误存 stable(伪 sheet)
      //  =站点配方永不可合成(伪 sheet≡stable 恒等式只对渲染取图成立)
      tile = TILE_BY_KEY[tk] ?? stable;
    } else {
      tile = TILE_BY_KEY[tk] ?? -1;
    }
  }
  return {
    create: keyOf(spec.create),
    createStack: spec.createStack ?? 1,
    tile,
    items,
    groups: [],
    water: spec.water, honey: spec.honey, lava: spec.lava,
    notDecraftable: true,   // 双保险(registerModRecipes 亦强制)
  };
}

/** mod 简单掉落表 → 原版 Rule 形(chance→denom 取整;noLuck=确定性掷)。
 *  ★P4 红蓝修正：chance≤0/非有限 → 跳过该条(旧实现 1/0=Infinity→int 恒 0→必掉,
 *  0% 变 100%)。
 *  ★P7 红蓝修正(M4 高优②):item 支持原版 vid 数字串(如 "Gel"→漏,但 "23"=Gel vid
 *  经 validatePlanReferences 的 itemOf 数字支直通)——旧实现只查 mod 分配表,
 *  掉 Gel/镜片等原版素材全被略。 */
function buildDropRules(plan: RegistrationPlan, modId: string, spec: RegistrationPlan['npcSpecs'][number]['spec']): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const d of spec.drops ?? []) {
    const chance = d.chance ?? 1;
    if (!(chance > 0) || !Number.isFinite(chance)) continue;   // 0%/坏值=不掉(声明语义)
    let id: number;
    if (typeof d.item === 'number') {
      id = d.item;                                             // 原版 vid 直通
    } else if (/^\d+$/.test(d.item)) {
      id = Number(d.item);                                     // 原版 vid 直通
    } else {
      const full = d.item.startsWith('mod_') ? d.item : `mod_${modId}_${d.item}`;
      const mapped = plan.allocation.items.get(full);
      if (mapped === undefined) throw new Error(`[mod-drops] mod ${modId} NPC ${spec.key} 掉落引用未注册物品: ${d.item}`);
      id = mapped;
    }
    // ★六十刀难度档:bossBag 声明(专家档掉袋+zeroValue,经典不掉)=原版 BossBag 语义
    if (d.bossBag) {
      out.push({ k: 'bossBag', item: id });
      continue;
    }
    // ★三百零八:flag 条件门(hardMode/downed_x)=引擎 cond 规则(evalCond 消费)
    const dflag = (d as unknown as { flag?: string }).flag;
    if (dflag) {
      const fl = dflag;
      out.push({
        k: 'cond', item: id, min: d.min ?? 1, max: d.max ?? 1,
        num: 1, denom: Math.max(1, Math.round(1 / Math.min(1, chance))),
        cond: { name: fl === 'hardMode' ? 'IsHardmode' : 'WorldFlag', args: fl === 'hardMode' ? [] : [fl] },
        noLuck: true,
      });
      continue;
    }
    out.push({
      k: 'common', item: id, min: d.min ?? 1, max: d.max ?? 1,
      num: 1, denom: Math.max(1, Math.round(1 / Math.min(1, chance))), noLuck: true,
    });
  }
  return out;
}

/**
 * 按计划注册全部 mod 内容。任一条目 fail-fast 抛错(loader 捕获后整 mod 报错,
 * 已注册部分保留——id 分配器保证重试时同 plan 同 id,不产生漂移)。
 */
export function applyRegistrationPlan(plan: RegistrationPlan): RegistrationApplied {
  let items = 0, tiles = 0, npcs = 0, recipes = 0, projs = 0;
  // ★一百一十刀:TILE_DEFS 活引用绑定 gen pass sheet 消费面(RemoveStupidTiles 白名单;
  //  mod tile 伪 sheet≡stable id 恒不在原版白名单=天然免疫,数组为活引用后续追加自动可见)
  (globalThis as unknown as { __calamityTileDefs?: unknown }).__calamityTileDefs = TILE_DEFS;
  // ★一百一十二刀:键→内部 id 全表(运行时事件链消费;TILE_BY_KEY 含 vanilla v_* 键)
  (globalThis as unknown as { __calamityTileIdByKey?: unknown }).__calamityTileIdByKey = TILE_BY_KEY;
  // ★成就域 L1 面(2026-10-22):content/achievements/*.json → collect(与
  //  sw.achievement 脚本路径共用 pending;apply 先于 entry 相位=JSON 先入列,
  //  跨形态同键由脚本侧 collect 的重复闸 fail-fast;build 出口统一翻译)
  for (const a of plan.achSpecs ?? []) collectModAchievement(a.modId, a.key, a.spec);
  // projectiles(P2):数据 spec → ModProj 注册簿(代码钩由 entry 的 sw.projectileHook 追加)
  for (const pr of plan.projSpecs) {
    const s = pr.spec;
    registerModProj(pr.projId, pr.modId, {
      texture: s.texture,
      gravity: s.gravity,
      lifetime: s.lifetime,
      pierce: s.pierce,
      tileCollide: s.tileCollide,
      width: s.width,
      height: s.height,
      rotateToVelocity: s.rotateToVelocity,
      homing: s.homing,
      homingDist: s.homingDist,
      frames: s.frames,
      hitRefresh: s.hitRefresh,
      frameRate: s.frameRate,
      noContactDamage: s.noContactDamage,
      holdout: s.holdout,
      additive: s.additive,
      fullbright: s.fullbright,
      overPlayers: s.overPlayers,
    }, pr.fullKey);
    projs++;
  }
  // B6:声明 buff 注册(9000+ 伪 vanilla;键字典序=确定性,与 plan 分配序同源)
  for (const b of plan.buffSpecs ?? []) {
    // npcDps 通用 dot tick(1/60 逐拍累进,≥1 取整施伤;max 合并语义在 applyModNpcBuff)
    const dps = b.spec.npcDps;
    registerModBuff(b.modId, b.spec.key, {
      name: b.spec.name ?? b.spec.key,
      texture: b.spec.texture,
      onNpcTick: dps
        ? (enemy, game) => {
            const t = enemy as unknown as { _modDotCarry?: number };
            // ★615:玩家 debuff 轴乘(攻者 alcohol/IVDrip 面;category=声明面
            //  debuffCategory(缺省 sickness=DoT 主类);Calamity DebuffData 全量聚合=登记)
            let dpsEff = dps;
            const amp = (game as unknown as { player?: { __swDebuffAmp?: Record<string, number> | null } }).player?.__swDebuffAmp;
            const cat = (b.spec as unknown as { debuffCategory?: string }).debuffCategory ?? 'sickness';
            if (amp && typeof amp[cat] === 'number') dpsEff = dps * (1 + amp[cat]);
            t._modDotCarry = (t._modDotCarry ?? 0) + dpsEff / 60;
            if (t._modDotCarry >= 1) {
              const d = Math.floor(t._modDotCarry);
              t._modDotCarry -= d;
              (enemy as unknown as {
                hurt: (dmg: number, kbx: number, kby: number, g: unknown,
                  armorPen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
              }).hurt(d, 0, 0, game, undefined, false, 1, true);
            }
          }
        : undefined,
    });
  }
  // tile 先注册(物品 placeTile 引用 tile 键)
  for (const t of plan.tileSpecs) {
    const spec = t.spec;
    const dropId = spec.dropItem
      ? plan.allocation.items.get(spec.dropItem.startsWith('mod_') ? spec.dropItem : `mod_${t.modId}_${spec.dropItem}`)
      : undefined;
    if (spec.dropItem && dropId === undefined) {
      throw new Error(`[mod-tile] mod ${t.modId} tile ${spec.key} 掉落引用未注册物品: ${spec.dropItem}`);
    }
    // ★一百一十八刀:群系旗派生推入(修复 108R2 后 PENDING_BIOME_FLAGS 无推入
    // =ZoneAstral/Sulphur 生产惰性)——tile 键族派生(键含 astral/sulphurous;
    // 通用=spec.biomeFlag 声明面优先)
    const biomeFlagName = spec.biomeFlag
      ?? (t.fullKey.includes('astral') ? 'astral' : t.fullKey.includes('sulphurous') ? 'sulphur' : t.fullKey.includes('brimstone_slag') ? 'brimstone' : t.fullKey.includes('navystone') || t.fullKey.includes('eutrophic_sand') ? 'sunken' : null);
    const modTileInternal = registerModTile({
      key: t.fullKey,
      name: spec.name ?? spec.key,
      solid: spec.solid ?? false,
      platform: spec.platform ?? false,
      decor: spec.decor ?? false,
      chest: spec.chest ?? false,
      framed: spec.framed ?? false,
      w: spec.w,
      h: spec.h,
      opacity: spec.opacity ?? (spec.solid ? 1 : 0),
      pick: spec.pick ?? 0,
      axe: spec.axe ?? -1,
      mapColor: spec.mapColor ?? '#808080',
      // ★B7 八十一刀:树数据面透传(growsOn/sapling→MOD_TREE_IDS/MOD_SAPLING 载体)
      growsOn: spec.growsOn ?? null,
      sapling: spec.sapling ?? null,
      blend: spec.frame === 'blend' || spec.frame === 'auto' ? true : false,
      drop: dropId,
      vanilla: {
        sheet: t.stableId,                       // mod tile 恒等式:伪 sheet id≡stable id
        frame: spec.frame ?? 'style',
        // ★B5b 修正:fw/fh=占格数(TEdit frameSize 语义,与原版 tile 一致)——
        //  曾误用 frameWidth(px) → 1×1 块按 16×18 格渲染/放置=灾难性错位
        fw: spec.w ?? 1,
        fh: spec.h ?? 1,
      },
    }, t.stableId);
    if (biomeFlagName) PENDING_BIOME_FLAGS.push({ flag: biomeFlagName, tileId: modTileInternal });
    // ★B6:AdjTiles 兼用站点(闭包后裔=stationSatisfierTiles 自动含 mod 站点)
    for (const adj of spec.adjTiles ?? []) registerModAdjTile(modTileInternal, adj);
    tiles++;
  }
  // npcs
  const modSummonAccum: SummonEntry[] = [];   // F6 面板条目暂存(循环尾一次性追加)
  // ★刀3-3:mod gore(先于 npcs——deathGore 引用解析依赖;PNG IHDR 头同步读尺寸
  //  @16/@20 大端,零解码——GorePiece 构造器碰撞盒查本表)
  for (const g of plan.goreSpecs) {
    registerModGoreId(g.goreId, g.fullKey);
    const pack = plan.mods.find((m) => m.manifest.id === g.modId)?.pack;
    const bytes = packTexBytesLocal(pack, g.spec.texture);
    // ★红队 R3-m2:PNG 签名校验(8 字节魔数)+尺寸界钳(垃圾头防巨盒 resizeBox)
    if (bytes && bytes.length > 24
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const w = dv.getUint32(16), h = dv.getUint32(20);
      if (w >= 1 && w <= 4096 && h >= 1 && h <= 4096) registerModGoreTexSize(g.goreId, w, h);
    }
  }
  // ★刀3-墙:mod 墙(先于 items——placeWall 引用;WALL_DEFS/WALL_BY_KEY 直追加,
  //  墙 id=internal=stable 零恒等表;dropItem 引用物品=items 应用后二段解析)
  for (const w of plan.wallSpecs) {
    registerModWall(w.wallId, w.fullKey, {
      name: w.spec.name ?? w.spec.key,
      mapColor: w.spec.mapColor ?? '#808080',
      opacity: w.spec.opacity ?? 1,
      ...(w.spec.largeFrame !== undefined ? { largeFrame: w.spec.largeFrame } : {}),
    }, { unbreakable: w.spec.unbreakable === true, ...(w.spec.dungeonGate !== undefined ? { dungeonGate: w.spec.dungeonGate } : {}) });
  }
  // ★第三批:mod 坐骑(先于 items——mountItem 引用;MOUNT_DATA 追加+ITEM_TO_MOUNT)
  for (const mt of plan.mountSpecs) {
    const bt = modBuffTypeOf(mt.modId, mt.spec.buff);
    registerModMountData(mt.mountId, {
      buff: bt,
      // ★R-A-F9(2026-10-13):贴图键闭环——消费端 Mounts.textures() 读 backTexture/
      //  frontTexture(名字键 Mount_<id>.png 同原版 vanilla-mounts.json 键形);旧实现
      //  只喂 assets 别名(vanilla/Mount_<id>.png)未设本双键=注入键零消费点(坐骑隐形)
      backTexture: `Mount_${mt.mountId}.png`,
      frontTexture: `Mount_${mt.mountId}.png`,
      runSpeed: mt.spec.runSpeed,
      acceleration: mt.spec.acceleration,
      jumpHeight: mt.spec.jumpHeight,
      jumpSpeed: mt.spec.jumpSpeed,
      ...(mt.spec.heightBoost !== undefined ? { heightBoost: mt.spec.heightBoost } : {}),
      ...(mt.spec.flightTimeMax !== undefined ? { flightTimeMax: mt.spec.flightTimeMax } : {}),
      ...(mt.spec.fatigueMax !== undefined ? { fatigueMax: mt.spec.fatigueMax } : {}),
      ...(mt.spec.fallDamage !== undefined ? { fallDamage: mt.spec.fallDamage } : {}),
      ...(mt.spec.extraFall !== undefined ? { extraFall: mt.spec.extraFall } : {}),
      ...(mt.spec.dashSpeed !== undefined ? { dashSpeed: mt.spec.dashSpeed } : {}),
      ...(mt.spec.swimSpeed !== undefined ? { swimSpeed: mt.spec.swimSpeed } : {}),
      ...(mt.spec.usesHover !== undefined ? { usesHover: mt.spec.usesHover } : {}),
      ...(mt.spec.constantJump !== undefined ? { constantJump: mt.spec.constantJump } : {}),
      ...(mt.spec.blockExtraJumps !== undefined ? { blockExtraJumps: mt.spec.blockExtraJumps } : {}),
      ...(mt.spec.canUseWings !== undefined ? { CanUseWings: mt.spec.canUseWings } : {}),
      totalFrames: mt.spec.totalFrames,
      ...(mt.spec.playerYOffsets !== undefined ? { playerYOffsets: mt.spec.playerYOffsets } : {}),
      ...(mt.spec.xOffset !== undefined ? { xOffset: mt.spec.xOffset } : {}),
      ...(mt.spec.yOffset !== undefined ? { yOffset: mt.spec.yOffset } : {}),
      ...(mt.spec.playerHeadOffset !== undefined ? { playerHeadOffset: mt.spec.playerHeadOffset } : {}),
      ...(mt.spec.emitsLight !== undefined ? { emitsLight: mt.spec.emitsLight } : {}),
      ...(mt.spec.lightColor !== undefined ? { lightColor: mt.spec.lightColor } : {}),
      ...(mt.spec.standingFrameStart !== undefined ? { standingFrameStart: mt.spec.standingFrameStart } : {}),
      ...(mt.spec.standingFrameCount !== undefined ? { standingFrameCount: mt.spec.standingFrameCount } : {}),
      ...(mt.spec.standingFrameDelay !== undefined ? { standingFrameDelay: mt.spec.standingFrameDelay } : {}),
      ...(mt.spec.runningFrameStart !== undefined ? { runningFrameStart: mt.spec.runningFrameStart } : {}),
      ...(mt.spec.runningFrameCount !== undefined ? { runningFrameCount: mt.spec.runningFrameCount } : {}),
      ...(mt.spec.runningFrameDelay !== undefined ? { runningFrameDelay: mt.spec.runningFrameDelay } : {}),
      ...(mt.spec.flyingFrameStart !== undefined ? { flyingFrameStart: mt.spec.flyingFrameStart } : {}),
      ...(mt.spec.flyingFrameCount !== undefined ? { flyingFrameCount: mt.spec.flyingFrameCount } : {}),
      ...(mt.spec.flyingFrameDelay !== undefined ? { flyingFrameDelay: mt.spec.flyingFrameDelay } : {}),
      ...(mt.spec.inAirFrameStart !== undefined ? { inAirFrameStart: mt.spec.inAirFrameStart } : {}),
      ...(mt.spec.inAirFrameCount !== undefined ? { inAirFrameCount: mt.spec.inAirFrameCount } : {}),
      ...(mt.spec.inAirFrameDelay !== undefined ? { inAirFrameDelay: mt.spec.inAirFrameDelay } : {}),
      ...(mt.spec.idleFrameStart !== undefined ? { idleFrameStart: mt.spec.idleFrameStart } : {}),
      ...(mt.spec.idleFrameCount !== undefined ? { idleFrameCount: mt.spec.idleFrameCount } : {}),
      ...(mt.spec.idleFrameDelay !== undefined ? { idleFrameDelay: mt.spec.idleFrameDelay } : {}),
      ...(mt.spec.swimFrameStart !== undefined ? { swimFrameStart: mt.spec.swimFrameStart } : {}),
      ...(mt.spec.swimFrameCount !== undefined ? { swimFrameCount: mt.spec.swimFrameCount } : {}),
      ...(mt.spec.swimFrameDelay !== undefined ? { swimFrameDelay: mt.spec.swimFrameDelay } : {}),
      ...(mt.spec.dashingFrameStart !== undefined ? { dashingFrameStart: mt.spec.dashingFrameStart } : {}),
      ...(mt.spec.dashingFrameCount !== undefined ? { dashingFrameCount: mt.spec.dashingFrameCount } : {}),
      ...(mt.spec.dashingFrameDelay !== undefined ? { dashingFrameDelay: mt.spec.dashingFrameDelay } : {}),
    });
    // ITEM_TO_MOUNT 扩条(物品 vid → mount id;quickMount/useMountItem 消费)
    for (const it of plan.itemSpecs) {
      if (it.spec.mountItem === undefined || it.modId !== mt.modId) continue;
      const mk = it.spec.mountItem.startsWith('mod_') ? it.spec.mountItem : `mod_${mt.modId}_${it.spec.mountItem}`;
      if (mk === mt.fullKey) {
        (ITEM_TO_MOUNT as Record<string, number>)[String(it.stableId)] = mt.mountId;
        registerModEquipKind(it.stableId, 'mount');   // ★R-A:装备分类 overlay(坐骑物品槽准入)
      }
    }
  }
  // ★第三批:mod 发型(hairs → registerModHairData 递增 _hairCountMax)
  for (const hr of plan.hairSpecs) {
    registerModHairData(hr.hairId, hr.spec.texture, hr.spec.back !== false, hr.spec.female === true);
    bumpHairCountMax(hr.hairId);   // ★R-A:validateAppearance/CHAR_CREATION_HAIRS 可变顶递增
  }
  // ★第四批:mod 尘埃(400+ 段;per-type 贴图 alias)
  for (const d of plan.dustSpecs) {
    registerModDustData(d.dustType, d.spec.texture, d.spec.motionType ?? 15, d.spec.fullbright === true, d.spec.noLight === true);   // ★R-C-D12-F1:noLight opt-out
  }
  for (const n of plan.npcSpecs) {
    const spec = n.spec;
    registerModNpc(n.npcId, {
      id: n.npcId,
      name: spec.name,
      frames: spec.frames ?? 2,
      lifeMax: spec.lifeMax,
      damage: spec.damage,
      defense: spec.defense,
      knockBackResist: spec.knockBackResist ?? 1,
      aiStyle: spec.aiStyle,
      width: spec.width ?? 20,
      height: spec.height ?? 20,
      npcSlots: 1,
      noGravity: spec.noGravity ?? false,
      noTileCollide: spec.noTileCollide ?? false,
      friendly: spec.friendly ?? false,
      townNPC: spec.townNPC ?? false,
      HitSound: spec.HitSound ?? 'NPC_Hit_1',
      DeathSound: spec.DeathSound ?? 'NPC_Killed_1',
      scale: spec.scale ?? 1,
      critter: spec.critter,
      alpha: spec.alpha,
      behindTiles: spec.behindTiles,
    } satisfies VanillaNpc);
    // ★刀2-C1:绘制声明面(frameRate/glowmask/fullbright → vanillaFrameIdx 顶部
    //  早退/drawNpcGlow 查表/npcWhiteLiftQueue ga=1 捕获)
    if (spec.frameRate !== undefined || spec.glowmask || spec.fullbright) {
      registerModNpcDrawSpec(n.npcId, {
        ...(spec.frameRate !== undefined ? { frameRate: spec.frameRate } : {}),
        ...(spec.glowmask ? { glowTex: `vanilla/NPC_Glow_${n.npcId}.png` } : {}),
        ...(spec.fullbright ? { fullbright: true } : {}),
      });
    }
    // ★P8:Boss 位直亮(VANILLA_BOSS_IDS.add——血条/Boss 槽/掉落锚定三消费点)
    if (spec.boss) registerModBoss(n.npcId);
    // ★P8:蠕虫链声明(头条目;body×bodyCount + tail → segIds,键→id 经分配表)
    if (spec.worm) {
      const bodyId = plan.allocation.npcs.get(`mod_${n.modId}_${spec.worm.body}`);
      const tailId = plan.allocation.npcs.get(`mod_${n.modId}_${spec.worm.tail}`);
      if (bodyId === undefined || tailId === undefined) {
        throw new Error(`[mod-worm] mod ${n.modId} NPC ${spec.key} 蠕虫链引用未注册段: ${spec.worm.body}/${spec.worm.tail}`);
      }
      const segIds: number[] = [];
      for (let i = 0; i < spec.worm.bodyCount; i++) segIds.push(bodyId);
      segIds.push(tailId);
      registerModWormChain(n.npcId, segIds);
    }
    // ★mod 城镇NPC实体化补链(2026-10-04 GLM娘实验批):townNPC 声明 → 运行时挂
    //   TOWN_NPC_IDS/extra/头贴索引三链(TownNPC ctor/入驻链/住房UI 全按此解析)。
    //   extra 缺省 = max(2, frames−16)(人形族 14 帧行走区惯例;GLM娘 26→10)
    if (spec.townNPC) {
      const extra = spec.extraFrames ?? Math.max(2, (spec.frames ?? 2) - 16);
      registerModTownNpc(n.fullKey, n.npcId, extra, n.modId, spec.arrival);
    }
    modSummonAccum.push({
      id: n.npcId, name: spec.name,
      boss: false, critter: !!spec.critter, town: !!spec.townNPC,
      lifeMax: spec.lifeMax,
    });
    const dropRules = buildDropRules(plan, n.modId, spec);
    if (dropRules.length > 0) registerModNpcRules(n.npcId, dropRules);
    // ★B7 一百零八刀:自然生成行注册(spec.spawn:{zone,water,mult};无声明=不自然刷)
    //  ★二百八十八刀:数组=多规则 OR 档(PerforatorCyst 三层血量门族)
    if (spec.spawn) {
      const spawnRules = Array.isArray(spec.spawn) ? spec.spawn : [spec.spawn];
      for (const sr of spawnRules) {
        MOD_SPAWN_RULES.push({
          npcId: n.npcId, zone: sr.zone ?? null,
          water: sr.water ?? false, mult: sr.mult ?? 1,
          ...(sr.maxCount !== undefined ? { maxCount: sr.maxCount } : {}),
          ...(sr.depth ? { depth: sr.depth } : {}),
          ...(sr.requireFlags ? { requireFlags: sr.requireFlags } : {}),
          ...(sr.blockFlags ? { blockFlags: sr.blockFlags } : {}),
        });
      }
    }
    // ★CalPlayer 基建(六十四刀):接触命中玩家施加声明面 debuff(OnHitPlayer 形)
    if (spec.onHitPlayer) {
      const buffId = modBuffTypeOf(n.modId, spec.onHitPlayer.buff);
      if (!buffId) throw new Error(`[mod-npc] mod ${n.modId} NPC ${spec.key} onHitPlayer buff 未注册: ${spec.onHitPlayer.buff}`);
      registerModNpcOnHitPlayerBuff(n.npcId, {
        buffId, duration: spec.onHitPlayer.duration, chance: spec.onHitPlayer.chance,
      });
    }
    // ★P7 红蓝修正(M4 高优①):mod NPC 金币价值接线(旧实现 ModNpcContent.value
    //  声明被丢弃→mod 怪恒 0 金)
    if (spec.value !== undefined) registerModNpcValue(n.npcId, spec.value);
    // ★刀3-3:死亡碎块声明(gore 键/原版 id 双形;loop=片数;GorePiece.deathGoreFor 回退)
    if (spec.deathGore?.length) {
      registerModNpcDeathGore(n.npcId, spec.deathGore.map((d) => {
        const gid = typeof d.gore === 'number' ? d.gore
          : modGoreIdOf(d.gore.startsWith('mod_') ? d.gore : `mod_${n.modId}_${d.gore}`);
        if (gid === undefined) {
          throw new Error(`[mod-npc] mod ${n.modId} NPC ${spec.key} 引用未注册 gore: ${d.gore}`);
        }
        return { id: gid, loop: d.n, scale: d.scale };
      }));
    }
    npcs++;
  }
  // F6 召唤面板追加面(mod 条目;零 mod 时 SUMMON_ENTRIES 零扰动)
  if (modSummonAccum.length > 0) appendModSummonEntries(modSummonAccum);
  // ★刀3-1:mod 稀有度档色(先于 items——物品 rare `{$rarity}` 解析依赖档表)
  for (const r of plan.raritySpecs) registerModRarity(r.rarityId, r.spec.color, r.fullKey);
  // items(combat/func/stats 拆写三表;placeTile 翻译)
  for (const it of plan.itemSpecs) {
    const spec = it.spec;
    // ★刀3-1:rare 形二态——数字直传 / {$rarity: key} → 档 id(未注册键 fail-loud)
    const rareResolved = spec.rare === undefined ? undefined
      : typeof spec.rare === 'number' ? spec.rare
        : (() => {
            const full = `mod_${it.modId}_${spec.rare.$rarity}`;
            const id = modRarityIdOf(full);
            if (id === undefined) {
              throw new Error(`[mod-item] mod ${it.modId} 物品 ${spec.key} 引用未注册稀有度: ${full}`);
            }
            return id;
          })();
    const def: Parameters<typeof registerModItem>[0] = {
      key: it.fullKey,
      name: spec.name,
      rare: rareResolved,
      value: spec.value,
      maxStack: spec.maxStack ?? 999,
    };
    if (spec.placeTile !== undefined) {
      const tk = resolveTileKey(it.modId, spec.placeTile);
      if (tk.startsWith('mod_')) {
        const stable = plan.allocation.tiles.get(tk);
        if (stable === undefined) throw new Error(`[mod-item] mod ${it.modId} 物品 ${spec.key} 放置 tile 未注册: ${tk}`);
        def.tile = tk;
      } else {
        def.tile = tk;                          // 原版 tile 键直传
      }
    }
    registerModItem(def, it.stableId);
    if (spec.func?.canUseOwnedBelow) {
      // ★刀5-A 族:canuse-rules 数据解释器注册(proj 键解析=resolveShoot 同通道)
      const cb = spec.func.canUseOwnedBelow;
      const projId = typeof cb.proj === 'number' ? cb.proj
        : resolveShoot(plan, it.modId, cb.proj) as number;
      registerModCanUseRule(it.stableId, { ownedProjBelow: { proj: projId, lt: cb.lt } });
    }
    if (spec.glowmask) {
      // ★刀2-C1:物品 glowmask(伪 GlowMaskID=1000+stableId-30000;贴图 alias 进
      //  Glow_ 空间,drawDrop 捕获+collectDropItemGlow 查表全链白嫖)
      registerModItemGlowmask(it.stableId);
    }
    if (spec.placeWall !== undefined) {
      // ★刀3-墙:放置墙面(plan.allocation.walls 解析;def.wallId=updateUse 派发门
      //  heldDef.wallId 消费面,与 vanilla-wallitems 挂法同式)
      const raw = spec.placeWall;
      const wid = raw.startsWith('mod_') ? plan.allocation.walls.get(raw)
        : plan.allocation.walls.get(`mod_${it.modId}_${raw}`) ?? WALL_BY_KEY[raw];
      if (wid === undefined) {
        throw new Error(`[mod-item] mod ${it.modId} 物品 ${spec.key} placeWall 引用未注册墙: ${raw}`);
      }
      (ITEM_DEFS[it.stableId] as { wallId?: number }).wallId = wid;
    }
    if (spec.pet) {
      // ★刀3-2:mod 宠物(MOD_PETS 反查表+装备分类 overlay;buffSpecs 先于 items 应用,
      //  modBuffTypeOf 此处必命中;proj 字符串形走 resolveShoot 同通道)
      registerModPet(it.stableId, {
        buffType: modBuffTypeOf(it.modId, spec.pet.buff),
        projId: typeof spec.pet.proj === 'number' ? spec.pet.proj
          : resolveShoot(plan, it.modId, spec.pet.proj) as number,
        light: spec.pet.light === true,
      });
      registerModEquipKind(it.stableId, spec.pet.light ? 'light' : 'pet');
    }
    if (spec.research !== undefined) registerModResearch(it.stableId, spec.research);
    if (spec.func) registerModItemFunc(it.stableId, spec.func);
    if (spec.combat) {
      const combat = { ...spec.combat };
      if (combat.shoot !== undefined) {
        combat.shoot = resolveShoot(plan, it.modId, combat.shoot);
        // ★三百六十八:altShoot 右键换弹(resolveShoot 同通道;字面数字=原版 vid)
        if ((it.spec as unknown as { altShoot?: string | number }).altShoot !== undefined) {
          const rawAlt = (it.spec as unknown as { altShoot?: string | number }).altShoot;
          const altResolved = typeof rawAlt === 'number' ? rawAlt
            : resolveShoot(plan, it.modId, rawAlt as string | number) as number;
        (ITEM_DEFS[it.stableId] as { altShoot?: number }).altShoot = altResolved;
        }
      }
      registerModCombat(it.stableId, combat as unknown as Parameters<typeof registerModCombat>[1]);
    }
    if (spec.stats) registerModStats(it.stableId, {
      def: spec.stats.def, s: spec.stats.s, acc: spec.stats.acc, van: spec.stats.van, life: spec.stats.life,
      // ★四百八十二刀:盔甲绘制槽序号(套装匹配键 hs|bs|ls——extract-armor 提取器
      //  写入 content;mod 甲自编号 3000+ 段,与原版 1-100 无碰撞)
      ...(spec.stats.hs !== undefined ? { hs: spec.stats.hs } : {}),
      ...(spec.stats.bs !== undefined ? { bs: spec.stats.bs } : {}),
      ...(spec.stats.ls !== undefined ? { ls: spec.stats.ls } : {}),
      // ★六十六刀:UpdateEquip 加法面透传(读侧=聚合器配饰环,余段登记)
      dmgMelee: spec.stats.dmgMelee, dmgRanged: spec.stats.dmgRanged, dmgMagic: spec.stats.dmgMagic, dmgAll: spec.stats.dmgAll,
      critMelee: spec.stats.critMelee, critRanged: spec.stats.critRanged, critMagic: spec.stats.critMagic,
      moveMult: spec.stats.moveMult, endurance: spec.stats.endurance,
      // ★603:mod 翼槽+翼属性(C# [AutoloadEquip(Wings)]+WingStats;slot=4000+ 段
      //  按注册序=确定性;消费=wingStatOf mod 表回退)
      ...(spec.stats.wing ? { wing: spec.stats.wing } : {}),
    }, it.stableId);
    if (spec.stats?.wing && spec.stats?.wingStats) {
      registerModWingStats(spec.stats.wing, spec.stats.wingStats);
    }
    items++;
  }
  // ★刀3-墙:墙掉落二段解析(dropItem→物品 vid;items 全量注册后才能解析)
  {
    const itemOf = (modId: string, raw: string): number | undefined => {
      if (/^\d+$/.test(raw)) return Number(raw);
      const full = raw.startsWith('mod_') ? raw : `mod_${modId}_${raw}`;
      return plan.allocation.items.get(full);
    };
    for (const w of plan.wallSpecs) {
      if (w.spec.dropItem === undefined) continue;
      const vid = itemOf(w.modId, w.spec.dropItem);
      if (vid === undefined) {
        throw new Error(`[mod-wall] mod ${w.modId} 墙 ${w.spec.key} dropItem 引用未注册物品: ${w.spec.dropItem}`);
      }
      registerModWallMeta(w.wallId, { dropItemVid: vid, unbreakable: w.spec.unbreakable === true, ...(w.spec.dungeonGate !== undefined ? { dungeonGate: w.spec.dungeonGate } : {}) });
    }
  }
  // shops(P3):物品 id 解析(本 mod 键/原版 vid);price 缺省=物品 value(原版
  // price:null→value 同相;无 value=500 兜底)
  for (const sh of plan.shops) {
    const entries: Array<[number, number]> = [];
    for (const it of sh.spec.items) {
      const id = itemRefOf(plan, sh.modId, it.item);
      const defValue = ITEM_DEFS[id]?.value;
      entries.push([id, it.price ?? (typeof defValue === 'number' ? defValue : 500)]);
    }
    // ★三百十七:npcId string=npcKey → allocation.npcs 解析(mod townNPC 商店)
    let nid: number;
    if (typeof sh.spec.npcId === 'string') {
      const full = sh.spec.npcId.startsWith('mod_') ? sh.spec.npcId : `mod_${sh.modId}_${sh.spec.npcId}`;
      const resolved = plan.allocation.npcs.get(full);
      if (resolved === undefined) throw new Error(`[mod-shop] mod ${sh.modId} 商店 npcKey 未注册: ${sh.spec.npcId}`);
      nid = resolved;
    } else {
      nid = sh.spec.npcId;
    }
    // ★三百十八:requireFlags 条件门透传(shops.json item 级)
    const rawSpec = sh.spec as unknown as { requireFlags?: string[] };
    if (rawSpec.requireFlags?.length) {
      registerModShopStock(nid, entries.map(([id, price]) => ({ id, price, requireFlags: rawSpec.requireFlags! })));
    } else {
      registerModShopStock(nid, entries);
    }
  }
  // recipes
  const recipeList = plan.recipes.map((r) => buildVanillaRecipe(plan, r.modId, r.spec));
  if (recipeList.length > 0) registerModRecipes(recipeList);
  recipes = recipeList.length;
  return { items, tiles, npcs, recipes, projs };
}

/** 商店条目物品解析:数字=原版 vid 直传;字符串=mod 物品键 → stable id */
function itemRefOf(plan: RegistrationPlan, modId: string, raw: string | number): number {
  if (typeof raw === 'number') return raw;
  if (/^\d+$/.test(raw)) return Number(raw);   // ★三百十七:数字串=原版 vid 直通(同 drops P7 判例)
  const full = raw.startsWith('mod_') ? raw : `mod_${modId}_${raw}`;
  const id = plan.allocation.items.get(full);
  if (id === undefined) throw new Error(`[mod-shop] mod ${modId} 引用未注册物品: ${raw}`);
  return id;
}
