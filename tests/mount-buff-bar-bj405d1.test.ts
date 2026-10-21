// ★BJ405-D1（2026-09-30 清偿刀 K①）：坐骑 buff 出栏 + 右键下马。
//
// 定谳锚（Terarria1457 亲读,行号 = 1457 基线）：
// · 原版坐骑 buff = 真 buff 槽成员：SetMount → AddBuff(_data.buff, 3600)
//   （Mount.cs:6291）;每 tick UpdateBuffs MountType 分支（Player.cs:9968-9971）
//   SetMount 重入 + buffTime=10 重钉——掉 buff 即 CheckMountBuff 强制下坐
//   （Mount.cs:5333,经 Player.cs:18948 ResetEffects 段）。
// · 无时长字+不入档 = Main.cs:9345-9352 循环段对【全部】MountType buff 置
//   buffNoTimeDisplay + buffNoSave（66 坐骑全量;非逐条写位。★清偿刀 P4 锚勘误
//   2026-09-30:旧引 :9342-9349 漂移,1457 亲读复核——for :9345/双置位 :9349-9350）。
// · 图标/右键域 = DrawBuffIcon（Main.cs:44042-44091,与其他 buff 同一循环无特支）;
//   右键 → TryRemovingBuff（Main.cs:44093-44117）坐骑支 :44100-44103：
//   `mount.Active && mount.CheckBuff(b)` → TryDismount,flag=true 顶替 DelBuff;
//   Sound 12（:44107）在 flag 判定【之前】恒响——FailedNoSpace 单次拒绝亦响,
//   坐骑与图标保持（无 QuickMount 三连败链,那是物品再召路径 :5738-5753）。
// · buff→mount 表 = BuffID.Sets.MountType（BuffID.cs:152,66 对）;本仓等价表 =
//   vanilla-mounts.json buffMount（BUFF_TO_MOUNT）。
// · 本仓模型 = mount.active 单一真源（Mounts.ts setMount 注承运,BJ405-D1 前坐骑
//   buff 不出栏）;本刀 = UI 坐骑派生通道（宠物通道同构）+ 右键下马
//   （UI.dismountFromBuffBar）+ 普通循环跳过哨兵防 374/377/384/391/392 双图标。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { BUFF_TO_MOUNT, MountInstance, type MountedPlayerView } from '../src/entities/Mounts';
import {
  BUFF_NO_TIME_DISPLAY, BUFF_NO_SAVE, BuffState, buffTypeByVanilla, buffRightClickRemovable,
} from '../src/stats/Buffs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_TS = readFileSync(join(ROOT, 'src/ui/UI.ts'), 'utf8');
const MOUNTS_TS = readFileSync(join(ROOT, 'src/entities/Mounts.ts'), 'utf8');

/** 66 坐骑伴生 buff 全表（= BUFF_TO_MOUNT 键域;vanilla BuffID.Sets.MountType 等价） */
const MOUNT_BUFF_IDS = Object.keys(BUFF_TO_MOUNT).map(Number);

/** 五个在册 BuffType 坐骑伴生（BJ357 变身三件 + Trusty 疾旋鼬二件） */
const REGISTERED_MOUNT_BUFFS = [374, 377, 384, 391, 392];

// ---- 测试世界/玩家（bj357 同款 harness） ----
const fakeHooks = (w: World, p?: Player) => ({
  world: w, player: p, enemies: () => [], critters: () => [],
  spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
  cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
  spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
  playSfxFiles: () => {}, showPickupLabel: () => {},
});
const mkWorld = (): World => {
  const w = new World(80, 120, 72, 'bj405d1');
  for (let x = 20; x <= 60; x++) w.store.setTileSilent(x, 80, 1);
  return w;
};
const mkPlayer = (w: World): Player => new Player(30 * 16, 77 * 16, new Inventory());
const tick = (p: Player, w: World, n: number): void => {
  for (let i = 0; i < n; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
};
const view = (over: Partial<MountedPlayerView> = {}): MountedPlayerView => ({
  x: 100, y: 100, w: 20, h: 42, vx: 0, vy: 0,
  onGround: true, inWater: false, facing: 1,
  inputX: 0, inputJump: false, inputUp: false, inputDown: false,
  prevInputJump: false, gravDir: 1, store: null, ...over,
});

// ---------------------------------------------------------------------------
// ① 源锚（落点在码）
// ---------------------------------------------------------------------------
describe('① BJ405-D1 源锚：通道 + 跳过哨 + 右键下马挂线', () => {
  it('普通循环跳过哨兵在码：坐骑伴生 buff 不走 buffBlocks（防双图标）', () => {
    expect(UI_TS).toContain('if (UI.mountVanillaBuffs().has(BUFF_DEFS[t].vanillaBuff)) continue;');
  });

  it('坐骑通道块 = makeBuffBlock(null, 0, true) 单坐骑派生', () => {
    expect(UI_TS).toContain('this.makeBuffBlock(null, 0, true)');
    expect(UI_TS).toContain('mountBuffBlocks = new Map<0,');
  });

  it('右键下马链序 = TryRemovingBuff 坐骑支 1:1（active 门→抚摸停→TryDismount→Sound 12）', () => {
    const s = UI_TS.indexOf('private dismountFromBuffBar(): void {');
    expect(s, 'UI.dismountFromBuffBar 在码').toBeGreaterThan(-1);
    const body = UI_TS.slice(s, UI_TS.indexOf('}\n', s));
    // 门序（:44100-44107）：CheckBuff 门 → TryDismount → Sound 12（判在 flag 前=失败亦响）
    const activeGate = body.indexOf('if (!p.mount.active) return;');
    const petting = body.indexOf('p.stopPettingAnimal()');
    const dismount = body.indexOf('p.mount.tryDismount(p, this.game)');
    const sound = body.indexOf("this.game.sfx.play('menuTick')");
    expect(activeGate).toBeGreaterThan(-1);
    expect(petting).toBeGreaterThan(activeGate);       // Dismount :6229-6231 抚摸随下坐终止
    expect(dismount).toBeGreaterThan(petting);
    expect(sound).toBeGreaterThan(dismount);           // Sound 12 :44107 无条件（失败亦响）
  });

  it('contextmenu 门序 = 坐骑支先于宠物支先于右键门（TryRemovingBuff 分支序）', () => {
    const s = UI_TS.indexOf("block.addEventListener('contextmenu'");
    const e = UI_TS.indexOf('return { block, icon, time };', s);
    const body = UI_TS.slice(s, e);
    const mount = body.indexOf('if (mountChannel) this.dismountFromBuffBar();');
    const pet = body.indexOf('else if (t === null) this.game.togglePetSlot(petSlot);');
    const gate = body.indexOf('else if (buffRightClickRemovable(t)) {');
    expect(mount).toBeGreaterThan(-1);
    expect(pet).toBeGreaterThan(mount);
    expect(gate, 'BJ405 基线锚（右键门字面量）必须原位保留').toBeGreaterThan(pet);
  });

  it('签名位两处同源（tickBuffLive 计算位 + refreshBuffs 回写位）', () => {
    expect(UI_TS.split("sig += 'm' + this.mountBarSig() + ',';").length - 1).toBe(2);
  });

  it('通道块入 reflow 池 + buildHud/closeAll 清理', () => {
    expect(UI_TS).toContain('this.petBuffBlocks, this.mountBuffBlocks, this.nebulaBuffBlocks');
    expect(UI_TS.split('this.mountBuffBlocks.clear();').length - 1).toBe(2);
  });

  it('Mounts.tryDismount 透传 game（下马尘 DoSpawnDust :6234 面;既有调用方零变化）', () => {
    // ★BJ704-G18 锁随刀迁移：game 参由旧内联结构类型改 MountDustGame（G17 债2/3
    //  typed 尘通道）——透传语义不变,锁锚同步
    expect(MOUNTS_TS).toContain('tryDismount(p: MountedPlayerView, game?: MountDustGame)');
    expect(MOUNTS_TS).toContain('this.dismount(p, game);');
  });
});

// ---------------------------------------------------------------------------
// ② 表审计：66 坐骑全表 1:1（BuffID.Sets.MountType BuffID.cs:152 对拍）
// ---------------------------------------------------------------------------
describe('② BJ405-D1 表审计：66 坐骑伴生 buff 全表', () => {
  it('BUFF_TO_MOUNT = 66 对,坐骑 id 无重复（buff→mount 双射右支）', () => {
    expect(MOUNT_BUFF_IDS.length).toBe(66);
    const mounts = Object.values(BUFF_TO_MOUNT);
    expect(new Set(mounts).size).toBe(mounts.length);
    for (const m of mounts) expect(m, '坐骑 id 域 [0,65]').toBeGreaterThanOrEqual(0);
  });

  it('五个在册伴生（374/377/384/391/392）∈ 全表 ∧ 有 BuffType 映射', () => {
    for (const vb of REGISTERED_MOUNT_BUFFS) {
      expect(MOUNT_BUFF_IDS.includes(vb), `vanilla ${vb} ∈ MountType 表`).toBe(true);
      expect(buffTypeByVanilla(vb), `vanilla ${vb} 有 BuffType 映射`).toBeDefined();
    }
  });

  it('66 坐骑 buff 全族不在 DEBUFFS（非 debuff → 右键域恒过首行门 :44109）', () => {
    // 66 件中仅五件有 BuffType 映射——映射件逐一判;表位真值 = 全族非 debuff
    for (const vb of REGISTERED_MOUNT_BUFFS) {
      const t = buffTypeByVanilla(vb)!;
      expect(buffRightClickRemovable(t), `${vb} 非表成员可右键（门不拦,下马在通道层）`).toBe(true);
    }
  });

  it('无时长字表补收：BUFF_NO_TIME_DISPLAY 收全五在册伴生（Main.cs:9345-9352）', () => {
    for (const vb of REGISTERED_MOUNT_BUFFS) {
      expect(BUFF_NO_TIME_DISPLAY.has(vb), `隐字 ${vb}`).toBe(true);
    }
  });

  it('★P4 不入档表补收：BUFF_NO_SAVE 收全五在册伴生（头注声称该面,断言补钉）', () => {
    // Main.cs:9345-9352 循环双置位的另一半——旧 BUFF_NO_SAVE 缺 391/392（旧注
    // 「本仓未映射不落库」失实:BuffType 120/121 已映射+BJ357 重钉面使骑乘态
    // 恒活在 BuffState）→ 骑乘存档落 391/392+读档幻影 buff。本钉=五件全量。
    for (const vb of REGISTERED_MOUNT_BUFFS) {
      expect(BUFF_NO_SAVE.has(vb), `不入档 ${vb}`).toBe(true);
    }
  });

  it('★P4 存档面判别：骑乘态 391/392 活 buff 不落盘+读档不复活（buffNoSave 拦截）', () => {
    // BJ357 重钉面实况：useMountItem apply 60s + fixedUpdate ridingMount 每 tick
    // 重钉 10t≈0.167s（≥toSave 0.05s 阈）——不补表则骑乘存档落 391/392,读档即
    // 幻影 buff（下马态出栏图标）。判别：同一 BuffState,391/392 入表前后翻转。
    const b = new BuffState();
    const t391 = buffTypeByVanilla(391)!;
    const t392 = buffTypeByVanilla(392)!;
    b.apply(t391, 60);
    b.apply(t392, 60);
    expect(b.toSave()).toEqual([]);          // 收刀前落 [['391',60],['392',60]]=幻影源
    const b2 = new BuffState();              // 读档面独立实例（apply 语义=加 buff 非清空）
    b2.applySaved([[391, 60], [392, 60]]);
    expect(b2.active.has(t391)).toBe(false); // 读档面同门拦（幻影不复活）
    expect(b2.active.has(t392)).toBe(false);
    // 对照位：非坐骑伴生照常落盘（面不误伤——5 铁皮不在 BUFF_NO_SAVE 名单）
    b.apply(buffTypeByVanilla(5)!, 30);
    expect(b.toSave().length).toBe(1);
  });

  it('通道块无时长字锚（mui.time 恒空串=非 1Hz 倒计时路径）', () => {
    const s = UI_TS.indexOf('---- 坐骑 buff（★BJ405-D1 派生通道');
    const e = UI_TS.indexOf('---- 星云增益派生通道', s);
    const body = UI_TS.slice(s, e);
    expect(body).toContain("mui.time.textContent = '';   // buffNoTimeDisplay 全 66（Main.cs:9345-9352）");
  });
});

// ---------------------------------------------------------------------------
// ③ 行为判别：右键下马 = tryDismount 单次尝试 + 下马尘透传
// ---------------------------------------------------------------------------
describe('③ BJ405-D1 行为：TryDismount 单次尝试 + DoSpawnDust 透传', () => {
  it('右键下马（开阔地）：下马成功 + 出生尘回调恰一次（Dismount :6234 面透传）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(61, p);
    expect(p.ridingMount).toBe(true);
    const dusts: number[] = [];
    const game = { spawnParticles: (..._a: unknown[]) => { dusts.push(1); } };
    expect(p.mount.tryDismount(p, game)).toBe(true);
    expect(p.ridingMount).toBe(false);
    expect(dusts.length).toBe(1);                    // DoSpawnDust(isDismounting) 1:1
  });

  it('FailedNoSpace（1 格高隧道）：单次拒绝——不掷尘、仍骑乘（右键 Sound 照响=UI 层序）', () => {
    const w = mkWorld();
    for (let x = 26; x <= 34; x++) w.store.setTileSilent(x, 78, 1);   // 79 行剩 16px 净空
    const p = mkPlayer(w);
    tick(p, w, 8);
    expect(p.mount.setMount(61, p)).toBe(true);
    const dusts: number[] = [];
    const game = { spawnParticles: (..._a: unknown[]) => { dusts.push(1); } };
    expect(p.mount.tryDismount(p, game)).toBe(false);   // 20×42 回长不出 = FailedNoSpace
    expect(p.ridingMount).toBe(true);                   // 坐骑保持（flag 顶替 DelBuff 面）
    expect(dusts.length).toBe(0);                       // 无尘（原版失败支零视觉伴随）
  });

  it('向后兼容：不传 game 的旧调用面（Game.tryDismountMount 等）零变化', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(1, p);
    expect(p.mount.tryDismount(p)).toBe(true);          // game 缺省=无尘支,行为同旧
    expect(p.ridingMount).toBe(false);
  });

  it('视图桩级：61 妖精 buff=384 / 64 可靠疾旋鼬 buff=391（通道图标源）', () => {
    const m61 = new MountInstance();
    m61.setMount(61, view());
    expect(m61.buff).toBe(384);
    const m64 = new MountInstance();
    m64.setMount(64, view());
    expect(m64.buff).toBe(391);
  });
});

// ---------------------------------------------------------------------------
// ④ 判别变异锁（登记面：摘哨兵/摘下马链/摘签名位任一即红）
// ---------------------------------------------------------------------------
describe('④ BJ405-D1 变异判别锁', () => {
  it('变异 M1（摘普通循环跳过哨）→ ① 跳过哨锚红', () => {
    expect(UI_TS).toContain('UI.mountVanillaBuffs()');
  });
  it('变异 M2（右键改走 buffs.remove）→ dismountFromBuffBar 缺 tryDismount 链即红', () => {
    const s = UI_TS.indexOf('private dismountFromBuffBar(): void {');
    const body = UI_TS.slice(s, s + 600);
    expect(body).toContain('p.mount.tryDismount(p, this.game)');
    expect(body).not.toContain('buffs.remove');
  });
  it('通道真值在 mount.active：ridingMount 假时签名位归 0（下马即整刷）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(3, p);
    expect(p.mount.active).toBe(true);
    expect(Math.max(0, p.mount.buff)).toBe(130);        // mount 3 slime → buff 130（buffMount 表）
    p.mount.dismount(p);
    expect(p.mount.active).toBe(false);
    expect(Math.max(0, p.mount.buff)).toBe(0);          // mountBarSig 下马归 0
  });
});
