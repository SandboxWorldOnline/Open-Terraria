// 注册计划构建(纯逻辑,零数据模块依赖——loader 与注册面解耦缝)。
// 拓扑排序(Kahn)+ 确定性 id 分配(拓扑序内 mod id 字典序;mod 内内容键字典序)
// =联机双端一致性与存档 id 稳定性的根(design.md §2)。
import type {
  ModBuffContent, ModGoreContent, ModIdAllocation, ModItemContent, ModMountContent, ModNpcContent, ModPack, ModProjContent,
  ModDustContent, ModHairContent, ModRarityContent, ModRecipeContent, ModShopContent, ModTileContent, ModWallContent, RegistrationPlan,
} from './types';
import {
  MOD_BUFF_VANILLA_BASE, MOD_GORE_ID_BASE, MOD_ITEM_STABLE_BASE, MOD_NPC_ID_BASE, MOD_PROJ_ID_BASE,
  MOD_DUST_TYPE_BASE, MOD_DUST_TYPE_MAX, MOD_HAIR_BASE, MOD_HAIR_MAX, MOD_MOUNT_STABLE_BASE, MOD_MOUNT_STABLE_MAX, MOD_RARITY_ID_BASE, MOD_TILE_STABLE_BASE, MOD_TILE_STABLE_MAX, MOD_WALL_STABLE_BASE, MOD_WALL_STABLE_MAX,
} from './types';
import { modItemFullKey, versionSatisfies } from './manifest';
import { discoverPackJsonPaths, readPackJson } from './pack';
import type { ModAchievementSpec } from './modAchievements';   // ★成就域 L1 面(类型单向)

export class ModPlanError extends Error {}

/** 已知 content/ 子目录域(fail-loud 未知目录警告用;recipes/shops=单文件
 *  约定 content/<域>.json,目录形=未知要警告)。新增目录域必须同步此表。 */
const KNOWN_CONTENT_DIRS = new Set([
  'items', 'tiles', 'walls', 'npcs', 'projectiles', 'buffs', 'gores',
  'rarities', 'mounts', 'hairs', 'dusts', 'achievements',
]);

// ---- 内容 spec 校验(坏条目 fail-fast 整 mod 拒载;错误信息带 modId+键) ----

function fail(modId: string, what: string, key: string): never {
  throw new ModPlanError(`mod ${modId} ${what} 键 "${key}" 校验失败`);
}

function parseItem(modId: string, raw: unknown): ModItemContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'item', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'item', key);
  if (typeof o.name !== 'string' || o.name.length === 0) fail(modId, 'item', key);
  return o as unknown as ModItemContent;
}

function parseTile(modId: string, raw: unknown): ModTileContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'tile', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'tile', key);
  if (typeof o.texture !== 'string' || o.texture.length === 0) fail(modId, 'tile', key);
  return o as unknown as ModTileContent;
}

/** ★刀3-1:mod 稀有度档(content/rarities/*.json {key,color}) */
function parseRarity(modId: string, raw: unknown): ModRarityContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'rarity', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'rarity', key);
  if (typeof o.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o.color)) fail(modId, 'rarity', key);
  return o as unknown as ModRarityContent;
}

/** ★刀3-3:mod gore(content/gores/*.json {key,texture}) */
function parseGore(modId: string, raw: unknown): ModGoreContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'gore', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'gore', key);
  if (typeof o.texture !== 'string' || o.texture.length === 0) fail(modId, 'gore', key);
  return o as unknown as ModGoreContent;
}

/** ★成就域 L1 面(2026-10-22):content/achievements/*.json
 *  {key,title,desc?,category?,icon?,conditions:[{kind,keys?,many?}]}——与
 *  sw.achievement 脚本路径同 spec(纯条件成就零脚本;custom 条件仍须脚本
 *  completeAchievement 驱动)。曾为 guide §3.16 文档谎言(装载器零消费),
 *  本函数=JSON 面补真的校验口。 */
function parseAchievement(modId: string, raw: unknown): { key: string; spec: ModAchievementSpec } {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'achievement', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'achievement', key);
  if (typeof o.title !== 'string' || o.title.length === 0) fail(modId, 'achievement', key);
  if (!Array.isArray(o.conditions) || o.conditions.length === 0) fail(modId, 'achievement', key);
  for (const c of o.conditions) {
    const kind = (c as Record<string, unknown> | null)?.kind;
    if (kind !== 'npcKilled' && kind !== 'itemPickup' && kind !== 'itemCraft' && kind !== 'tileDestroyed' && kind !== 'custom') {
      fail(modId, 'achievement', key);
    }
  }
  const { key: _drop, ...spec } = o as unknown as { key: string } & ModAchievementSpec;
  return { key, spec };
}

/** ★刀3-墙:mod 墙(content/walls/*.json {key,texture,...}) */
function parseWall(modId: string, raw: unknown): ModWallContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'wall', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'wall', key);
  if (typeof o.texture !== 'string' || o.texture.length === 0) fail(modId, 'wall', key);
  if (o.mapColor !== undefined && (typeof o.mapColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o.mapColor))) fail(modId, 'wall', key);
  if (o.largeFrame !== undefined && o.largeFrame !== 0 && o.largeFrame !== 1 && o.largeFrame !== 2) fail(modId, 'wall', key);
  return o as unknown as ModWallContent;
}

/** ★第三批:mod 坐骑(content/mounts/*.json) */
function parseMount(modId: string, raw: unknown): ModMountContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'mount', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'mount', key);
  if (typeof o.buff !== 'string' || o.buff.length === 0) fail(modId, 'mount', key);
  if (typeof o.texture !== 'string' || o.texture.length === 0) fail(modId, 'mount', key);
  if (typeof o.runSpeed !== 'number' || typeof o.acceleration !== 'number') fail(modId, 'mount', key);
  return o as unknown as ModMountContent;
}

/** ★第三批:mod 发型(content/hairs/*.json) */
function parseHair(modId: string, raw: unknown): ModHairContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'hair', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'hair', key);
  if (typeof o.texture !== 'string' || o.texture.length === 0) fail(modId, 'hair', key);
  return o as unknown as ModHairContent;
}

/** ★第四批:mod 尘埃(content/dusts/*.json) */
function parseDust(modId: string, raw: unknown): ModDustContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'dust', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'dust', key);
  if (typeof o.texture !== 'string' || o.texture.length === 0) fail(modId, 'dust', key);
  return o as unknown as ModDustContent;
}

function parseNpc(modId: string, raw: unknown): ModNpcContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'npc', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'npc', key);
  if (typeof o.name !== 'string' || o.name.length === 0) fail(modId, 'npc', key);
  if (typeof o.aiStyle !== 'number') fail(modId, 'npc', key);
  if (typeof o.lifeMax !== 'number' || typeof o.damage !== 'number' || typeof o.defense !== 'number') {
    fail(modId, 'npc', key);
  }
  return o as unknown as ModNpcContent;
}

function parseBuff(modId: string, raw: unknown): ModBuffContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'buff', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'buff', key);
  if (typeof o.texture !== 'string' || o.texture.length === 0) fail(modId, 'buff', key);
  return o as unknown as ModBuffContent;
}

function parseRecipe(modId: string, raw: unknown): ModRecipeContent {
  const o = raw as Record<string, unknown>;
  if (typeof o.create !== 'string') fail(modId, 'recipe', String(o.create ?? ''));
  return o as unknown as ModRecipeContent;
}

function parseProj(modId: string, raw: unknown): ModProjContent {
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : fail(modId, 'projectile', String(o.key ?? ''));
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) fail(modId, 'projectile', key);
  if (typeof o.texture !== 'string' || o.texture.length === 0) fail(modId, 'projectile', key);
  return o as unknown as ModProjContent;
}

// ---- 依赖拓扑排序(Kahn;缺依赖/环/版本不满足=整组拒载) ----

/** 返回拓扑序的 manifest id 数组。周期/缺依赖抛 ModPlanError。 */
export function topoSortMods(manifests: ModPack[]): string[] {
  const byId = new Map(manifests.map((p) => [p.manifest.id, p]));
  // 字典序准入=确定性(Kahn 队列按 id 升序弹出)
  const ids = manifests.map((p) => p.manifest.id).sort();
  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of ids) indeg.set(id, 0);
  for (const p of manifests) {
    for (const [dep, constraint] of Object.entries(p.manifest.dependencies ?? {})) {
      const depPack = byId.get(dep);
      if (!depPack) throw new ModPlanError(`mod ${p.manifest.id} 依赖缺失: ${dep}`);
      if (!versionSatisfies(depPack.manifest.version, constraint)) {
        throw new ModPlanError(`mod ${p.manifest.id} 依赖版本不满足: ${dep} 需 ${constraint} 实装 ${depPack.manifest.version}`);
      }
      indeg.set(p.manifest.id, (indeg.get(p.manifest.id) ?? 0) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(p.manifest.id);
    }
  }
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    queue.sort();
    const id = queue.shift()!;
    order.push(id);
    for (const next of dependents.get(id) ?? []) {
      const d = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== ids.length) {
    const stuck = ids.filter((id) => !order.includes(id));
    throw new ModPlanError(`mod 依赖环: ${stuck.join(', ')}`);
  }
  return order;
}

// ---- 计划构建 ----

/**
 * 拓扑序逐 mod 分配 id 并产出注册计划。
 * 确定性:①拓扑序(Kahn 字典序队列)②mod 内 items/tiles/npcs 各按全键字典序分配。
 * 同一 mod 集合恒得同一分配(联机双端/存档一致性根)。
 */
export function buildRegistrationPlan(packs: ModPack[]): RegistrationPlan {
  const order = topoSortMods(packs);
  const byId = new Map(packs.map((p) => [p.manifest.id, p]));
  const allocation: ModIdAllocation = { items: new Map(), tiles: new Map(), npcs: new Map(), projs: new Map(), buffs: new Map(), rarities: new Map(), gores: new Map(), walls: new Map(), mounts: new Map(), hairs: new Map(), dusts: new Map() };
  const itemSpecs: RegistrationPlan['itemSpecs'] = [];
  const tileSpecs: RegistrationPlan['tileSpecs'] = [];
  const npcSpecs: RegistrationPlan['npcSpecs'] = [];
  const projSpecs: RegistrationPlan['projSpecs'] = [];
  const shops: RegistrationPlan['shops'] = [];
  const recipes: RegistrationPlan['recipes'] = [];
  const buffSpecs: RegistrationPlan['buffSpecs'] = [];
  const raritySpecs: RegistrationPlan['raritySpecs'] = [];
  const goreSpecs: RegistrationPlan['goreSpecs'] = [];
  const wallSpecs: RegistrationPlan['wallSpecs'] = [];
  const mountSpecs: RegistrationPlan['mountSpecs'] = [];
  const hairSpecs: RegistrationPlan['hairSpecs'] = [];
  const dustSpecs: RegistrationPlan['dustSpecs'] = [];
  const achSpecs: RegistrationPlan['achSpecs'] = [];
  /** 成就全键去重(镜像 modAchievements.fullKeyOf 语义:mod_ 前缀键=显式全键) */
  const achSeen = new Set<string>();
  const idOf = (manifestId: string) => order.indexOf(manifestId);
  const sortedPacks = [...packs].sort((a, b) => idOf(a.manifest.id) - idOf(b.manifest.id));

  for (const pack of sortedPacks) {
    const modId = pack.manifest.id;
    // ★刀3-1:rarities(先于 items——物品 rare `{$rarity}` 引用档键;全键字典序分配 12+ 段)
    const raritySpecsOfPack: Array<{ spec: ModRarityContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'rarities')) {
      raritySpecsOfPack.push({ spec: parseRarity(modId, readPackJson(pack, path)) });
    }
    raritySpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of raritySpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.rarities.has(fullKey)) throw new ModPlanError(`mod ${modId} 稀有度键重复: ${spec.key}`);
      const rarityId = MOD_RARITY_ID_BASE + allocation.rarities.size;
      if (rarityId > 254) throw new ModPlanError(`mod 稀有度段溢出(>254): ${fullKey}`);
      allocation.rarities.set(fullKey, rarityId);
      raritySpecs.push({ modId, spec, rarityId, fullKey });
    }
    // ★刀3-3:gores(先于 npcs——npc deathGore 引用 gore 键;全键字典序分配 697+ 段)
    const goreSpecsOfPack: Array<{ spec: ModGoreContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'gores')) {
      goreSpecsOfPack.push({ spec: parseGore(modId, readPackJson(pack, path)) });
    }
    goreSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of goreSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.gores.has(fullKey)) throw new ModPlanError(`mod ${modId} gore 键重复: ${spec.key}`);
      const goreId = MOD_GORE_ID_BASE + allocation.gores.size;
      allocation.gores.set(fullKey, goreId);
      goreSpecs.push({ modId, spec, goreId, fullKey });
    }
    // ★刀3-墙:walls(先于 items——物品 placeWall 引用墙键;全键字典序分配 367+ 段)
    const wallSpecsOfPack: Array<{ spec: ModWallContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'walls')) {
      wallSpecsOfPack.push({ spec: parseWall(modId, readPackJson(pack, path)) });
    }
    wallSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of wallSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.walls.has(fullKey)) throw new ModPlanError(`mod ${modId} 墙键重复: ${spec.key}`);
      const wallId = MOD_WALL_STABLE_BASE + allocation.walls.size;
      if (wallId > MOD_WALL_STABLE_MAX) throw new ModPlanError(`mod 墙段溢出(>${MOD_WALL_STABLE_MAX}): ${fullKey}`);
      allocation.walls.set(fullKey, wallId);
      wallSpecs.push({ modId, spec, wallId, fullKey });
    }
    // ★第三批:mounts(先于 items——mountItem 引用解析;全键字典序分配 66+ 段)
    const mountSpecsOfPack: Array<{ spec: ModMountContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'mounts')) {
      mountSpecsOfPack.push({ spec: parseMount(modId, readPackJson(pack, path)) });
    }
    mountSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of mountSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.mounts.has(fullKey)) throw new ModPlanError(`mod ${modId} 坐骑键重复: ${spec.key}`);
      const mountId = MOD_MOUNT_STABLE_BASE + allocation.mounts.size;
      if (mountId > MOD_MOUNT_STABLE_MAX) throw new ModPlanError(`mod 坐骑段溢出(>${MOD_MOUNT_STABLE_MAX}): ${fullKey}`);
      allocation.mounts.set(fullKey, mountId);
      mountSpecs.push({ modId, spec, mountId, fullKey });
    }
    // ★第三批:hairs(全键字典序分配 228-255 段)
    const hairSpecsOfPack: Array<{ spec: ModHairContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'hairs')) {
      hairSpecsOfPack.push({ spec: parseHair(modId, readPackJson(pack, path)) });
    }
    hairSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of hairSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.hairs.has(fullKey)) throw new ModPlanError(`mod ${modId} 发型键重复: ${spec.key}`);
      const hairId = MOD_HAIR_BASE + allocation.hairs.size;
      if (hairId > MOD_HAIR_MAX) throw new ModPlanError(`mod 发型段溢出(>${MOD_HAIR_MAX}): ${fullKey}`);
      allocation.hairs.set(fullKey, hairId);
      hairSpecs.push({ modId, spec, hairId, fullKey });
    }
    // ★第四批:dusts(全键字典序分配 400+ 段)
    const dustSpecsOfPack: Array<{ spec: ModDustContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'dusts')) {
      dustSpecsOfPack.push({ spec: parseDust(modId, readPackJson(pack, path)) });
    }
    dustSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of dustSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.dusts.has(fullKey)) throw new ModPlanError(`mod ${modId} 尘埃键重复: ${spec.key}`);
      const dustType = MOD_DUST_TYPE_BASE + allocation.dusts.size;
      if (dustType > MOD_DUST_TYPE_MAX) throw new ModPlanError(`mod 尘埃段溢出(>${MOD_DUST_TYPE_MAX}): ${fullKey}`);
      allocation.dusts.set(fullKey, dustType);
      dustSpecs.push({ modId, spec, dustType, fullKey });
    }
    // items:全键字典序分配 stable id
    const itemSpecsOfPack: Array<{ path: string; spec: ModItemContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'items')) {
      const spec = parseItem(modId, readPackJson(pack, path));
      itemSpecsOfPack.push({ path, spec });
    }
    itemSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of itemSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.items.has(fullKey)) throw new ModPlanError(`mod ${modId} 物品键重复: ${spec.key}`);
      const stableId = MOD_ITEM_STABLE_BASE + allocation.items.size;
      if (stableId > 65535) throw new ModPlanError(`mod 物品段溢出(>65535): ${fullKey}`);
      allocation.items.set(fullKey, stableId);
      itemSpecs.push({ modId, spec, stableId, fullKey });
    }
    // tiles:全键字典序分配 stable id(1030-4095 空闲区,B5 扩窗)
    const tileSpecsOfPack: Array<{ spec: ModTileContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'tiles')) {
      tileSpecsOfPack.push({ spec: parseTile(modId, readPackJson(pack, path)) });
    }
    tileSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of tileSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.tiles.has(fullKey)) throw new ModPlanError(`mod ${modId} tile 键重复: ${spec.key}`);
      const stableId = MOD_TILE_STABLE_BASE + allocation.tiles.size;
      if (stableId > MOD_TILE_STABLE_MAX) throw new ModPlanError(`mod tile 段溢出(>${MOD_TILE_STABLE_MAX}): ${fullKey}`);
      allocation.tiles.set(fullKey, stableId);
      tileSpecs.push({ modId, spec, stableId, fullKey });
    }
    // projectiles:全键字典序分配 projId(2000+ 段;全局连续=跨 mod 确定性)
    const projSpecsOfPack: Array<{ spec: ModProjContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'projectiles')) {
      projSpecsOfPack.push({ spec: parseProj(modId, readPackJson(pack, path)) });
    }
    projSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of projSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.projs.has(fullKey)) throw new ModPlanError(`mod ${modId} projectile 键重复: ${spec.key}`);
      const projId = MOD_PROJ_ID_BASE + allocation.projs.size;
      allocation.projs.set(fullKey, projId);
      projSpecs.push({ modId, spec, projId, fullKey });
    }
    // buffs:全键字典序分配伪 vanilla id(9000+;B6 声明 buff)
    const buffSpecsOfPack: Array<{ spec: ModBuffContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'buffs')) {
      buffSpecsOfPack.push({ spec: parseBuff(modId, readPackJson(pack, path)) });
    }
    buffSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of buffSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.buffs.has(fullKey)) throw new ModPlanError(`mod ${modId} buff 键重复: ${spec.key}`);
      const pseudoVanilla = MOD_BUFF_VANILLA_BASE + allocation.buffs.size;
      allocation.buffs.set(fullKey, pseudoVanilla);
      buffSpecs.push({ modId, spec, pseudoVanilla, fullKey });
    }
    // npcs:全键字典序分配 npc id(800+)
    const npcSpecsOfPack: Array<{ spec: ModNpcContent }> = [];
    for (const path of discoverPackJsonPaths(pack, 'npcs')) {
      npcSpecsOfPack.push({ spec: parseNpc(modId, readPackJson(pack, path)) });
    }
    npcSpecsOfPack.sort((a, b) => (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0));
    for (const { spec } of npcSpecsOfPack) {
      const fullKey = modItemFullKey(modId, spec.key);
      if (allocation.npcs.has(fullKey)) throw new ModPlanError(`mod ${modId} npc 键重复: ${spec.key}`);
      const npcId = MOD_NPC_ID_BASE + allocation.npcs.size;
      allocation.npcs.set(fullKey, npcId);
      npcSpecs.push({ modId, spec, npcId, fullKey });
    }
    // recipes:单文件约定(content/recipes.json)
    const recipeRaw = readPackJson<ModRecipeContent[] | { recipes: ModRecipeContent[] }>(pack, 'content/recipes.json');
    if (recipeRaw !== null) {
      const list = Array.isArray(recipeRaw) ? recipeRaw : recipeRaw.recipes;
      if (!Array.isArray(list)) throw new ModPlanError(`mod ${modId} recipes.json 须数组`);
      for (const r of list) recipes.push({ modId, spec: parseRecipe(modId, r) });
    }
    // shops:单文件约定(content/shops.json,P3 商店上架)
    const shopRaw = readPackJson<ModShopContent[] | { shops: ModShopContent[] }>(pack, 'content/shops.json');
    if (shopRaw !== null) {
      const list = Array.isArray(shopRaw) ? shopRaw : shopRaw.shops;
      if (!Array.isArray(list)) throw new ModPlanError(`mod ${modId} shops.json 须数组`);
      for (const s of list) {
        // ★三百十七:npcId number=原版 vid | string=npcKey(mod townNPC 商店)
        if (typeof s?.npcId !== 'number' && typeof s?.npcId !== 'string') fail(modId, 'shop', String(s?.npcId ?? ''));
        shops.push({ modId, spec: s });
      }
    }
    // ★成就域 L1 面(2026-10-22):content/achievements/*.json(纯条件成就零
    //  脚本;无 id 分配——全键即存档名。register 期经 collectModAchievement 与
    //  脚本路径合流,跨形态同键在脚本侧 fail-fast 成 mod 级错误)
    for (const path of discoverPackJsonPaths(pack, 'achievements')) {
      const { key, spec } = parseAchievement(modId, readPackJson(pack, path));
      const fullKey = key.startsWith('mod_') ? key : `mod_${modId}_${key}`;
      if (achSeen.has(fullKey)) throw new ModPlanError(`mod ${modId} 成就键重复: ${key}`);
      achSeen.add(fullKey);
      achSpecs.push({ modId, key, spec });
    }
    // ★fail-loud(2026-10-22):未知 content/ 子目录警告——装载器只发现已知域,
    //  写错目录名(如不存在的 pets//drops/)或用目录形写单文件域(recipes/shops)
    //  =内容静默丢失零报错(mod-dev-guide pets/drops 假目录案的根因类)
    {
      const unknownDirs = new Set<string>();
      for (const p of pack.files.keys()) {
        const m = /^content\/([A-Za-z0-9_-]+)\//.exec(p);
        if (m && !KNOWN_CONTENT_DIRS.has(m[1])) unknownDirs.add(m[1]);
      }
      for (const dir of unknownDirs) {
        console.warn(
          `[mods] ${modId} 未识别的 content/${dir}/ 目录(内容将被忽略)。` +
          `目录域: ${[...KNOWN_CONTENT_DIRS].join('/')};recipes/shops 走单文件 content/<域>.json`,
        );
      }
    }
  }
  return { mods: sortedPacks.map((p) => ({ manifest: p.manifest, pack: p })), order, allocation, itemSpecs, tileSpecs, npcSpecs, projSpecs, shops, recipes, buffSpecs, raritySpecs, goreSpecs, wallSpecs, mountSpecs, hairSpecs, dustSpecs, achSpecs };
}

// ---- 引用校验(分配完成后统一验:跨 mod 引用也在此捕获;注册阶段因此不会中途抛错) ----

/** 校验计划内全部跨引用(掉落/放置/配方),缺引用抛 ModPlanError(整批拒载)。
 *  register.ts 内同名 throw 自此降级为防御性断言。
 *  原版 tile 键存在性经 setTileKeyProbe 注入(loader 装配 TILE_BY_KEY,本文件保持零重依赖)。 */
export function validatePlanReferences(plan: RegistrationPlan): void {
  const itemOf = (modId: string, raw: string): number => {
    if (/^\d+$/.test(raw)) return Number(raw);                      // 原版 vid
    const full = raw.startsWith('mod_') ? raw : `mod_${modId}_${raw}`;
    const id = plan.allocation.items.get(full);
    if (id === undefined) throw new ModPlanError(`mod ${modId} 引用未注册物品: ${raw}`);
    return id;
  };
  for (const t of plan.tileSpecs) {
    if (t.spec.dropItem !== undefined) itemOf(t.modId, t.spec.dropItem);
  }
  for (const it of plan.itemSpecs) {
    const pt = it.spec.placeTile;
    if (pt === undefined) continue;
    if (!pt.startsWith('mod_')) {
      if (tileKeyProbe()[pt] === undefined) {
        throw new ModPlanError(`mod ${it.modId} 物品 ${it.spec.key} 放置 tile 键不存在: ${pt}`);
      }
      continue;
    }
    if (!plan.allocation.tiles.has(pt)) {
      throw new ModPlanError(`mod ${it.modId} 物品 ${it.spec.key} 放置 tile 未注册: ${pt}`);
    }
  }
  for (const n of plan.npcSpecs) {
    for (const d of n.spec.drops ?? []) {
      if (typeof d.item === 'number') continue;   // 原版 vid 直通(P7)
      itemOf(n.modId, d.item);
    }
    // ★P8:蠕虫链段引用校验(body/tail 键必须已分配)
    if (n.spec.worm) {
      for (const segKey of [n.spec.worm.body, n.spec.worm.tail]) {
        const full = segKey.startsWith('mod_') ? segKey : `mod_${n.modId}_${segKey}`;
        if (!plan.allocation.npcs.has(full)) {
          throw new ModPlanError(`mod ${n.modId} NPC ${n.spec.key} 蠕虫链引用未注册段: ${segKey}`);
        }
      }
    }
  }
  for (const r of plan.recipes) {
    itemOf(r.modId, r.spec.create);
    for (const it of r.spec.items ?? []) itemOf(r.modId, it.item);
    // ★P4 红蓝修正(A-m1):原版 tile 键拼错静默降级为徒手配方 → 校验期拦
    const tile = r.spec.tile;
    if (typeof tile === 'string' && !tile.startsWith('mod_')) {
      if (tileKeyProbe()[tile] === undefined) {
        throw new ModPlanError(`mod ${r.modId} 配方站点 tile 键不存在: ${tile}`);
      }
    } else if (typeof tile === 'string' && !plan.allocation.tiles.has(tile)) {
      throw new ModPlanError(`mod ${r.modId} 配方站点 tile 未注册: ${tile}`);
    }
  }
  // ★P4 红蓝修正(A-M3):shops 引用校验(旧在 apply 期抛=半装违反「不半装」声明)
  for (const sh of plan.shops) {
    for (const it of sh.spec.items) {
      if (typeof it.item === 'number') continue;   // 原版 vid 直传
      itemOf(sh.modId, it.item);
    }
  }
  // 弹幕引用(P2):物品 combat.shoot 字符串 `proj:<key>`/mod 键 → 分配表
  for (const it of plan.itemSpecs) {
    const sh = it.spec.combat?.shoot;
    if (typeof sh !== 'string') continue;
    const full = sh.startsWith('mod_') ? sh
      : sh.startsWith('proj:') ? `mod_${it.modId}_${sh.slice(5)}`
        : `mod_${it.modId}_${sh}`;
    if (!plan.allocation.projs.has(full)) {
      throw new ModPlanError(`mod ${it.modId} 物品 ${it.spec.key} 引用未注册弹幕: ${sh}`);
    }
    // ★P4 边界收口(2026-10-05 B4 全量提取驱动)：magic/mana 类 + 声明弹放行——
    //  engine 侧 case 'magic' 通用尾支已插 mod 弹分流(付款/杖头锚/沉默门共享),
    //  原 fail-fast(C-MAJOR-4)前提消除。summon 类=MinionProj 通用兜底(真召唤 AI=B6)。
  }
  // ★红队 R3-M2(2026-10-13):三刀新增跨引用收编校验面(旧在 apply 期抛=半装
  //  违反「注册阶段不中途抛」不变量,apply 中途逸出会携半装全局表+毒死重试)
  //  ——pet.buff/pet.proj、item rare {$rarity}、npc.deathGore 三类。
  for (const it of plan.itemSpecs) {
    const spec = it.spec;
    if (spec.rare !== undefined && typeof spec.rare !== 'number') {
      const full = `mod_${it.modId}_${spec.rare.$rarity}`;
      if (!plan.allocation.rarities.has(full)) {
        throw new ModPlanError(`mod ${it.modId} 物品 ${spec.key} 引用未注册稀有度: ${spec.rare.$rarity}`);
      }
    } else if (typeof spec.rare === 'number' && spec.rare >= MOD_RARITY_ID_BASE) {
      // ★红队 R2-m4:裸数字 mod 档=全局 id 语义(跨 mod 泄漏风险;灾厄 12/13 先例
      //  在案,不 fail-loud 防破载)——无任何 mod 注册该档时 warn 指路 {$rarity}
      if (![...plan.allocation.rarities.values()].includes(spec.rare)) {
        console.warn(`[mod-plan] mod ${it.modId} 物品 ${spec.key} rare=${spec.rare} 为裸 mod 档 id 且无任何 mod 注册该档(显示回落紫档);建议改用 {"rare":{"$rarity":"key"}} 引用本 mod content/rarities 档`);
      }
    }
    if (spec.pet) {
      const buffFull = spec.pet.buff.startsWith('mod_') ? spec.pet.buff : `mod_${it.modId}_${spec.pet.buff}`;
      if (!plan.allocation.buffs.has(buffFull)) {
        throw new ModPlanError(`mod ${it.modId} 物品 ${spec.key} pet.buff 引用未注册 buff: ${spec.pet.buff}`);
      }
      if (typeof spec.pet.proj === 'string') {
        const projFull = spec.pet.proj.startsWith('mod_') ? spec.pet.proj
          : spec.pet.proj.startsWith('proj:') ? `mod_${it.modId}_${spec.pet.proj.slice(5)}`
            : `mod_${it.modId}_${spec.pet.proj}`;
        if (!plan.allocation.projs.has(projFull)) {
          throw new ModPlanError(`mod ${it.modId} 物品 ${spec.key} pet.proj 引用未注册弹幕: ${spec.pet.proj}`);
        }
      }
    }
  }
  for (const n of plan.npcSpecs) {
    for (const d of n.spec.deathGore ?? []) {
      if (typeof d.gore === 'number') continue;   // 原版 gore id 直通
      const full = d.gore.startsWith('mod_') ? d.gore : `mod_${n.modId}_${d.gore}`;
      if (!plan.allocation.gores.has(full)) {
        throw new ModPlanError(`mod ${n.modId} NPC ${n.spec.key} deathGore 引用未注册 gore: ${d.gore}`);
      }
    }
  }
  // ★第三批:物品 mountItem 引用校验
  for (const it of plan.itemSpecs) {
    const mi = it.spec.mountItem;
    if (mi === undefined) continue;
    const full = mi.startsWith('mod_') ? mi : `mod_${it.modId}_${mi}`;
    if (!plan.allocation.mounts.has(full)) {
      throw new ModPlanError(`mod ${it.modId} 物品 ${it.spec.key} mountItem 引用未注册坐骑: ${mi}`);
    }
  }
  // ★刀3-墙(R3-M2 同族收编):物品 placeWall 引用校验(mod 墙键/原版墙键双形)
  for (const it of plan.itemSpecs) {
    const pw = it.spec.placeWall;
    if (pw === undefined) continue;
    if (pw.startsWith('mod_')) {
      if (!plan.allocation.walls.has(pw)) {
        throw new ModPlanError(`mod ${it.modId} 物品 ${it.spec.key} placeWall 引用未注册墙: ${pw}`);
      }
      continue;
    }
    if (plan.allocation.walls.has(`mod_${it.modId}_${pw}`)) continue;   // 本 mod 裸键
    // 原版墙键(wN_*)存在性走 tileKeyProbe 同款注入?墙无 probe 面——register 期
    // WALL_BY_KEY 直查 fail-loud(原版键集静态,plan 期可经 wallKeyProbe 同构注入;
    // 本批=register 期防御性断言,登记 D 台账)
  }
}

/** 原版 tile 键存在性探测(避免 plan.ts import tiles.ts 拉重依赖;loader 装配) */
let _tileKeyProbe: () => Record<string, number> = () => ({});
export function setTileKeyProbe(fn: () => Record<string, number>): void { _tileKeyProbe = fn; }
function tileKeyProbe(): Record<string, number> { return _tileKeyProbe(); }
