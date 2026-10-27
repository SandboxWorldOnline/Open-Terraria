// ★BJ486（2026-10-03）掷率族四残余判别测试（BJ482 新登记债清偿）：
//   ① StormLightning 1117/1122 自建环 TimerCrit（:12928）受理位消费补位——
//      1091 trap=true → OwnedBySomeone=false（:580-589）整 crit 块不可达=正确缺位。
//   ② Game.ts spawn 位 critTotal/arcCrit 退役载体死写全普查摘除结构锁——
//      BJ482 十三旗标位 + 全普查新发现四位（wall/gf/charge/carrier）+
//      PhoenixBolt 百分点→分数域单位错位修复（100% 暴击病）。
//   ③ 近战弧子代弹掷率口径迁移：rollVanillaHitCrit（owner 装配）——定谳=原版
//      Player.cs:25712-25714 每帧把持械 item.crit 折入三系 crit → GetWeaponCrit
//      （:54009）与弹面掷（:12915-12927）同源 ⇒ 弹面掷含持械武器 crit=原版口径,
//      动态读（命中拍）取代静态冻结载体;arcCrit/arcCritZ 载体全数退役。
//   ④ bonusCritChance 三写入点建模：698 武僧蓄爆 +25 通道形参化接线（:12912-12914
//      num13 + :70581-70582）；2269 左轮/:11142 父继承=登记不接线（生产端未建模/
//      无可观测消费面,见 proj1457 rollVanillaHitCrit 体注）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TileStore } from '../src/world/TileStore';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { StormLightning, rollVanillaHitCrit } from '../src/entities/proj1457';
import { SwingArc, LightsBaneSlash, GrassSlash } from '../src/entities/SwingArc';
import { MonkSlam } from '../src/entities/MonkStaffFury';
import { ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');

interface HurtCall { dmg: number; crit: boolean }

function mkEnemy(id: number, x: number, y: number, w = 24, h = 24) {
  const calls: HurtCall[] = [];
  const e = {
    id, x, y, w, h, dead: false, vanillaId: 15 as number | null, maxHp: 100, hp: 100,
    iframes: 0, lastStrikeDealt: 0, attempts: 0,
    get cx() { return this.x + this.w / 2; },
    get cy() { return this.y + this.h / 2; },
    hurt(this: { attempts: number; lastStrikeDealt: number }, dmg: number,
      _kx: number, _ky: number, _g: unknown, _pen: number, crit: boolean): boolean {
      this.attempts++;
      this.lastStrikeDealt = dmg;
      calls.push({ dmg, crit: !!crit });
      return true;
    },
  };
  return { e, calls };
}

/** bj383 夹具同源（TileStore 世界+全钩桩）。player 可带 critChance/inv/TimerCrit 侦听 */
function makeHooks(opts: {
  enemies?: unknown[];
  player?: Record<string, unknown>;
} = {}): GameHooks {
  const player = {
    equipStats: {}, cx: 80 * TILE, cy: 90 * TILE, x: 80 * TILE - 10, y: 90 * TILE - 21,
    w: 20, h: 42, dead: false, facing: 1, vx: 0, vy: 0,
    buffs: { has: () => false },
    ...opts.player,
  };
  return {
    world: { store: new TileStore(200, 120) } as never,
    player,
    enemies: () => opts.enemies ?? [],
    critters: () => [],
    npcs: () => [],
    projectiles: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    cutTilesBox: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {}, playSfxAt: () => {},
    showPickupLabel: () => {},
    addLightAt: () => {},
    spawnDust: () => null,
    startLoopSfx: () => ({ stop: () => {}, setVolume: () => {}, playing: true, dead: false }),
    stack: { anyTagged: () => false, hasActiveEffect: () => false },
  } as unknown as GameHooks;
}

afterEach(() => { vi.restoreAllMocks(); });

const PX = 80, PY = 90;

// ================= ① StormLightning 受理位 TimerCrit 消费 =================

describe('BJ486-①：StormLightning 自建环 TimerCrit :12928 消费（BJ467②/475③ 同族补位）', () => {
  it('1a 1122 掷率不达（关断钉）+ TimerCrit 满蓄 → 照强制 crit + 消费位收到靶盒', () => {
    const timer: Array<[number, number, number, number]> = [];
    const { e, calls } = mkEnemy(41, PX * TILE, PY * TILE, 64, 64);
    const g = makeHooks({
      enemies: [e],
      player: {
        critChance: () => 0,                       // 三类掷关断钉（旧掷式 ≤0 恒假同相）
        tryConsumingTimerCrit: (_g: unknown, x: number, y: number, w: number, h: number) => {
          timer.push([x, y, w, h]);
          return true;                             // 满蓄 6170 → 强制 crit
        },
      },
    });
    const bolt = new StormLightning(1122, PX * TILE + 8, PY * TILE + 8, 60, 2);
    bolt.critChance = 0;                           // 钉住三类掷=false（判别面隔离）
    bolt.seed = 12345;
    for (let i = 0; i < 60 && !bolt.dead; i++) bolt.fixedUpdate(1 / 60, g);
    expect(bolt.dead).toBe(true);
    expect(timer.length).toBe(1);                  // 消费位恰一次（:12928 无条件面）
    expect(timer[0]).toEqual([e.x, e.y, e.w, e.h] as unknown as [number, number, number, number]);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);              // ref crit 强制翻转 → hurt crit 位
    expect(calls[0].dmg).toBe(60);                 // ★S02(BJ723-B)改判:×2=Enemy.hurt 防后——spy 收未翻倍基伤(旧 120=预倍形)
  });

  it('1b 1122 无 6170（消费返回假）→ 无强制 crit（消费≠恒真）', () => {
    const { e, calls } = mkEnemy(42, PX * TILE, PY * TILE, 64, 64);
    const g = makeHooks({
      enemies: [e],
      player: {
        critChance: () => 0,
        tryConsumingTimerCrit: () => false,        // 未满蓄/非负窗
      },
    });
    const bolt = new StormLightning(1122, PX * TILE + 8, PY * TILE + 8, 60, 2);
    bolt.critChance = 0;
    bolt.seed = 12345;
    for (let i = 0; i < 60 && !bolt.dead; i++) bolt.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(false);
    expect(e.attempts).toBe(1);
  });

  it('1c 1091 trap=true → OwnedBySomeone=false 整 crit 块不可达：TimerCrit 零消费（正确缺位）', () => {
    const timer: Array<[number, number, number, number]> = [];
    const { e, calls } = mkEnemy(43, PX * TILE, PY * TILE, 64, 64);
    const g = makeHooks({
      enemies: [e],
      player: {
        critChance: () => 0,
        tryConsumingTimerCrit: (_g: unknown, x: number, y: number, w: number, h: number) => {
          timer.push([x, y, w, h]);
          return true;
        },
      },
    });
    const bolt = new StormLightning(1091, PX * TILE + 8, PY * TILE + 8, 60, 2);
    (bolt as unknown as { life: number }).life = 2;   // 压寿命直达 doKill（bj383 同式）
    bolt.critChance = 0;
    bolt.seed = 12345;
    for (let i = 0; i < 80 && !bolt.dead; i++) bolt.fixedUpdate(1 / 60, g);
    expect(bolt.dead).toBe(true);
    expect(e.attempts).toBe(1);                    // 敌面照常结算
    expect(timer.length).toBe(0);                  // ★缺位=正确（:580-589 整块跳过）
    expect(calls[0]?.crit).toBe(false);
  });
});

// ================= ② 死写全普查结构锁 =================

describe('BJ486-②：Game.ts 退役载体死写全普查摘除（结构锁）', () => {
  const game = () => SRC('core/Game.ts');

  it('2a BJ482 十三旗标位+全普查新发现四位=写位全数不在盘上', () => {
    const s = game();
    const absent = [
      /^\s*twister\.critChance\s*=/m,                    // 旗标1 BookStormTwister
      /blade\.critChance\s*=\s*arcCrit;/m,               // 旗标2 ChloroClaymoreBlade
      /spore\.critChance\s*=\s*arcCrit;/m,               // 旗标3 ChloroSporeCloud
      /cloud\.critChance\s*=\s*arcCrit;/m,               // 旗标4 ChloroSporeCloud(奖励击)
      /slam\.critChance\s*=\s*arcCrit;/m,                // 旗标5 ChloroBladeSlam
      /^\s*wall\.critChance\s*=\s*critTotal;/m,          // 新发现 ClingerStaffWallProj
      /^\s*gf\.critChance\s*=\s*critTotal;/m,            // 新发现 GlacierFangShot
      /^\s*petal\.critChance\s*=\s*critTotal;/m,         // 旗标6 PetalstormShot
      /^\s*bolt6155\.critChance\s*=\s*critTotal;/m,      // 旗标7 StormLightning(1117)
      /^\s*b\.critChance\s*=\s*critTotal;/m,             // 旗标8 StormLightning(1122)
      /^\s*bolt731\.critChance\s*=\s*critTotal;/m,       // 旗标9 ThunderBoltShot
      /^\s*beam\.critChance\s*=\s*critTotal;/m,          // 旗标10 LaserMachinegunLaser
      /^\s*mg\.critChance\s*=\s*critTotal;/m,            // 旗标11 LaserMachinegunHolder
      /^\s*circle\.critChance\s*=\s*critTotal;/m,        // 旗标12 PrincessMagicCircle
      /^\s*stab\.critChance\s*=\s*critTotal;/m,          // 旗标13 ChloroSaberStab
      /^\s*charge\.critChance\s*=\s*critTotal;/m,        // 新发现 FlintChargeProj(无伤载体)
      /^\s*carrier\.critChance\s*=\s*critTotal;/m,       // 新发现 PhoenixChannel(载体无伤面)
    ];
    for (const re of absent) expect(re.test(s)).toBe(false);
  });

  it('2b 十七处摘除位注释留痕在盘（逐位锚）', () => {
    const s = game();
    // 13 旗标 + wall/gf/charge/carrier 四新发现 = 17 处 BJ486② 锚
    const n = (s.match(/★BJ486② 退役载体死写摘除/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(17);
  });

  it('2c PhoenixBolt 单位错位修复：critTotal 百分点不再入分数域载体（100% 暴击病）', () => {
    const codeOnly = game().replace(/^\s*\/\/[^\n]*/gm, '');   // 剥注释行防锚注自噬
    expect(/new PhoenixBolt\([\s\S]{0,400}?bolt\.critChance/.test(codeOnly)).toBe(false);
    expect(/new PhoenixBolt\([\s\S]{0,400}?bolt\.armorPen = arpenTotal;/.test(codeOnly)).toBe(true);
    // 摘除后 PhoenixBolt 面=owner 装配掷（706 ranged 旗）
    const bolt = SRC('entities/PhoenixBowProj.ts');
    expect(bolt).toContain('rollVanillaHitCrit(this.projId, game)');
    expect(/Math\.random\(\)\s*<\s*this\.critChance/.test(bolt)).toBe(false);
  });

  it('2d arcCrit/arcCritZ 挥击面载体定义与全部写位=盘上零残留', () => {
    const s = game();
    const codeOnly = s.replace(/^\s*\/\/[^\n]*/gm, '');   // 剥注释行防锚注自噬
    expect(/const arcCrit\s*=|const arcCritZ\s*=/.test(codeOnly)).toBe(false);
    expect(/=\s*arcCritZ?;/.test(codeOnly)).toBe(false);
    expect(/crit:\s*arcCritZ/.test(codeOnly)).toBe(false);   // zPayload.crit 字段
    expect(/zsword\.critChance/.test(codeOnly)).toBe(false); // fireZenithSword 写位
    expect(/zenith\?: \{ useTime: number; fired: number; vid: number; dmg: number; crit: number/.test(codeOnly)).toBe(false);
  });
});

// ================= ③ 弧子代弹掷率口径迁移 =================

describe('BJ486-③：弧子代弹掷率=rollVanillaHitCrit（owner 装配,含 :25712 持械折入）', () => {
  it('3a SwingArc(972) 面掷：聚合 50+random 0.5 → 照暴（旧固定 0.04 档必假）', () => {
    const g = makeHooks({ player: { critChance: () => 50, inv: { heldItem: () => null } } });
    const { e, calls } = mkEnemy(51, (80 * TILE) - 300, (90 * TILE) - 300, 600, 600);
    g.enemies = () => [e];
    const owner = { x: 80 * TILE - 10, y: 90 * TILE - 21, w: 20, h: 42, cx: 80 * TILE, cy: 90 * TILE, facing: 1, dead: false };
    const arc = new SwingArc(owner, 972, 25, 40, 1, 1);
    arc.critChance = 0.04;                          // 类字段默认（载体写位已摘,值不再被读）
    vi.spyOn(Math, 'random').mockReturnValue(0.5);  // 0.5 < 0.04+0.50=0.54 → crit
    arc.fixedUpdate(1, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);
    expect(calls[0].dmg).toBe(40);                  // ★S02 改判:未翻倍基伤(旧 80=预倍形)
  });

  it('3b LightsBaneSlash(974) 面掷=同口径（Birth 拍 ai0 折叠+Damage 面掷=原版双掷面并存）', () => {
    const g = makeHooks({ player: { critChance: () => 50, inv: { heldItem: () => null } } });
    const { e, calls } = mkEnemy(52, 60 * TILE, 60 * TILE, 60, 60);
    g.enemies = () => [e];
    const lb = new LightsBaneSlash(60 * TILE, 60 * TILE, 1, 0, 30, 1);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    lb.fixedUpdate(1, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);
    expect(calls[0].dmg).toBe(30);                 // ★S02 改判:未翻倍基伤(旧 60=预倍形)
  });

  it('3c GrassSlash(976) 面掷=同口径', () => {
    const g = makeHooks({ player: { critChance: () => 50, inv: { heldItem: () => null } } });
    const { e, calls } = mkEnemy(53, 50 * TILE, 50 * TILE, 60, 60);
    g.enemies = () => [e];
    const gs = new GrassSlash(50 * TILE, 50 * TILE, 16, 0, 20, 0.05);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    gs.fixedUpdate(1, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);
  });

  it('3d 持械折入：inv.heldItem 提供锁匙刃 671（crit 16）→ 阈值抬至 0.04+0.16', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    const critStat = itemCombat(671)?.crit ?? 0;
    expect(id671).toBeGreaterThanOrEqual(0);          // 物品表已建（IDG 域）
    expect(critStat).toBe(16);                        // 键匙刃 crit=16（bj313 同谳面）
    const threshold = 0.04 + critStat / 100;
    const g0 = makeHooks({ player: { critChance: () => 0, inv: { heldItem: () => ({ id: id671, prefix: 0 }) } } });
    // random=折入前后阈值中点：无折入 0.04 档必假;折入 item.crit 档必真
    vi.spyOn(Math, 'random').mockReturnValue((0.04 + threshold) / 2);
    expect(rollVanillaHitCrit(972, g0)).toBe(true);
    const g1 = makeHooks({ player: { critChance: () => 0, inv: { heldItem: () => null } } });
    expect(rollVanillaHitCrit(972, g1)).toBe(false);
  });

  it('3e 全迁移面结构锁：九文件掷率形态+vanilla 弹 id 锚+974 出生拍双件', () => {
    const swing = SRC('entities/SwingArc.ts');
    expect(/Math\.random\(\)\s*<\s*this\.critChance/.test(swing)).toBe(false);
    for (const id of [972, 973, 974, 976, 933, 321]) {
      expect(swing).toContain(`readonly projId = ${id};`);
    }
    expect(swing).toContain('rollVanillaHitCrit(this.projId, game)');
    expect(/Math\.random\(\)\s*<\s*this\.critChance/.test(SRC('entities/FirstFractal.ts'))).toBe(false);
    expect(SRC('entities/FirstFractal.ts')).toContain('readonly projId = 857;');
    expect(/Math\.random\(\)\s*<\s*this\.critChance/.test(SRC('entities/TideSlash.ts'))).toBe(false);
    expect(SRC('entities/TideSlash.ts')).toContain('readonly projId = 451;');
    const solar = SRC('entities/SolarEruption.ts');
    expect(solar).toContain('readonly projId = 611;');
    expect(solar.split('rollVanillaHitCrit(this.projId, game)').length - 1).toBe(2);   // 611 敌怪面+BJ729-A 城镇 settle 面（D1 B19,2026-10-27,1→2——锁语义=面存在性非清单冻结,BJ725-A 判例 3）;612 无类旗保持原样
    const missile = SRC('entities/MissileProj.ts');
    expect(missile).toContain('rollVanillaHitCrit(this.projId, game)');               // StarfuryStar(9)
    expect(missile).toContain('readonly projId = 9;');
    const gameTs = SRC('core/Game.ts');
    // 974 出生拍 crit 掷单位修复（:49369 Main.rand.Next(100) < meleeCrit）+ TimerCrit
    expect(/\*\s*100\s*\+\s*4/.test(gameTs)).toBe(false);
    expect(gameTs).toContain("critChance('melee') + 4");
    expect(gameTs).toContain('crit974');
    expect(gameTs).toContain('sx974 - 8, sy974 - 8, 16, 16');   // CenteredRectangle(vector62,16,16)
    // 弧子代弹退役写位（十位）=零残留
    for (const v of ['arc', 'fly', 'slash', 'lb', 'gs', 'ff', 'tide', 'whip', 'star9']) {
      expect(new RegExp(`^\\s*${v}\\.critChance\\s*=\\s*arcCrit;`, 'm').test(gameTs)).toBe(false);
    }
  });
});

// ================= ④ bonusCritChance 三写入点 =================

describe('BJ486-④：bonusCritChance num13 形参化（:12912-12914）', () => {
  it('4a rollVanillaHitCrit 第三形参：698+25 → 阈值 0.04+agg+0.25（>0 才入掷）', () => {
    const g = makeHooks({ player: { critChance: () => 50, inv: { heldItem: () => null } } });
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    expect(rollVanillaHitCrit(698, g)).toBe(false);      // 0.6 < 0.54 假
    expect(rollVanillaHitCrit(698, g, 25)).toBe(true);   // 0.6 < 0.79 真（+25 通道）
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    expect(rollVanillaHitCrit(698, g, -5)).toBe(true);   // 负值不入掷（:12912 >0 门）
  });

  it('4b MonkSlam 面接线：+25 形参直传（旧 critTotal+0.25 载体建模退役）', () => {
    const g = makeHooks({ player: { critChance: () => 50, inv: { heldItem: () => null } } });
    const { e, calls } = mkEnemy(61, 70 * TILE, 70 * TILE, 90, 240);
    g.enemies = () => [e];
    const slam = new MonkSlam(70 * TILE + 20, 70 * TILE + 40, 1, 0, 50);
    vi.spyOn(Math, 'random').mockReturnValue(0.6);       // 0.6 < 0.79 → crit
    slam.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);
    expect(calls[0].dmg).toBe(50);                  // ★S02 改判:未翻倍基伤(旧 100=预倍形)
    const fury = SRC('entities/MonkStaffFury.ts');
    expect(fury).toContain('rollVanillaHitCrit(this.projId, game, 25)');
    const gameTs = SRC('core/Game.ts');
    expect(/slam\.critChance\s*=\s*critTotal\s*\+\s*0\.25/.test(gameTs)).toBe(false);
  });

  it('4c 2269 左轮/:11142 父继承=登记不接线（体注锚在盘,生产端未建模）', () => {
    const p = SRC('entities/proj1457.ts');
    expect(p).toContain('2269 左轮 :11134');
    expect(p).toContain(':11142 父弹继承');
    expect(p).toContain('登记不接线');
    // 仓内无 bonusCritChance 字段（ApplyStatsFromSource 等价面不存在）
    expect(/bonusCritChance[\s\S]{0,40}=\s*25;/.test(p)).toBe(false);
  });
});
