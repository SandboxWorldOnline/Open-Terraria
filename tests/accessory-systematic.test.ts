// 配饰审计系统性三项（docs/audit/item-audit-2026-08-22.md「全局系统性发现 7 行」表，
// 2026-08-22 系统性批）：
//   ① 配饰身上贴图十族绘制——vid→绘制槽提取表（tools/extract-acc-drawslots.mjs）+
//     equipStats.accDraw 聚合（UpdateVisibleAccessory :36441-36520）+ 渲染层
//     drawAccBehindLayers/drawAccFrontLayers（记录型 ctx 断言族与层序）
//   ② 信息/机械饰品背包生效域——inventory[0..57] 扫描（UpdateEquips :12494-12500）
//   ③ 翅膀 accelMult 消费（WingAirLogicTweaks :28852/:28856）+ jumpSpeedBoost 叠加
//     （:14250/:13986）+ 多翅膀槽序后写胜出（:12578-12586）+ aggro 轴 ±400 七件
// 数值基准 1457（Terarria1457/;本文件所涉配饰数值两版同值,绘制槽表已按 1457 再生）。
import { describe, it, expect } from 'vitest';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { accDrawSlotsOf } from '../src/data/vanillaAccDrawslots';
import { Inventory } from '../src/items/Inventory';
import { Player } from '../src/entities/Player';
import { BuffType } from '../src/stats/Buffs';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { Renderer } from '../src/render/Renderer';

const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

// ================= ① 贴图绘制槽：提取表数据 =================

describe('配饰系统性①：vid→绘制槽提取表（Item.cs SetDefaults 11 槽位字段）', () => {
  it('case 直赋抽查：49 手环 handOn=2 / 532 星星斗篷 back=2 / 899 太阳石 handOn=13 / 3991 奥术花 face=9 / 4822 焰行靴 shoe=22', () => {
    expect(accDrawSlotsOf(49)).toMatchObject({ handOn: 2 });
    expect(accDrawSlotsOf(532)).toMatchObject({ back: 2 });
    expect(accDrawSlotsOf(899)).toMatchObject({ handOn: 13 });   // ArmorIDs.HandOn.SunStone=13
    expect(accDrawSlotsOf(900)).toMatchObject({ handOn: 14 });   // MoonStone=14
    expect(accDrawSlotsOf(3991)).toMatchObject({ face: 9 });     // ArcaneFlower=9
    expect(accDrawSlotsOf(4822)).toMatchObject({ shoe: 22 });    // FlameWakerBoots=22
    expect(accDrawSlotsOf(156)).toMatchObject({ shield: 1 });    // CobaltShield
  });

  it('fall-through 组算式（type 参与式）：3250-3252 balloon=13..15 / 3730-3731 balloon=16..17 / 5104-5106 beard=2..4', () => {
    expect(accDrawSlotsOf(3250)).toMatchObject({ balloon: 13 });
    expect(accDrawSlotsOf(3251)).toMatchObject({ balloon: 14 });
    expect(accDrawSlotsOf(3252)).toMatchObject({ balloon: 15 });
    expect(accDrawSlotsOf(3730)).toMatchObject({ balloon: 16 });
    expect(accDrawSlotsOf(3731)).toMatchObject({ balloon: 17 });
    expect(accDrawSlotsOf(5104)).toMatchObject({ beard: 2 });
    expect(accDrawSlotsOf(5106)).toMatchObject({ beard: 4 });
  });

  it('default 体范围块（:22968）：虚荣披风 2284-2287 back=3..6 / front=1..4（case 段扫描盲区）', () => {
    expect(accDrawSlotsOf(2284)).toMatchObject({ back: 3, front: 1 });
    expect(accDrawSlotsOf(2287)).toMatchObject({ back: 6, front: 4 });
    expect(accDrawSlotsOf(2285)).toMatchObject({ back: 4, front: 2 });
  });

  it('无贴图配饰返回 null（1322 岩浆石/3090 皇家凝胶/3223 混乱之脑）；两栖靴 3990 有 shoe=18', () => {
    expect(accDrawSlotsOf(1322)).toBeNull();
    expect(accDrawSlotsOf(3090)).toBeNull();
    expect(accDrawSlotsOf(3223)).toBeNull();
    expect(accDrawSlotsOf(3990)).toMatchObject({ shoe: 18 });   // AmphibianBoots=18
    expect(accDrawSlotsOf(-1)).toBeNull();
  });
});

// ================= ① accDraw 聚合（Player.computeEquipStats） =================

describe('配饰系统性①：equipStats.accDraw 聚合（UpdateVisibleAccessory :36441-36520）', () => {
  it('装备即出槽：532 → back=2；2284 → back=3+front=1（同件双族）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(532), stack: 1 };
    expect(p.equipStats.accDraw.back).toBe(2);
    expect(p.equipStats.accDraw.front).toBe(0);
    p.inv.armor[3] = { id: _iid(2284), stack: 1 };
    expect(p.equipStats.accDraw.back).toBe(3);
    expect(p.equipStats.accDraw.front).toBe(1);
  });

  it('多槽后写覆盖 + back 披风清 front（:36459-36471）：slot3=2284 → slot4=532 后 back=2/front=0', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(2284), stack: 1 };
    p.inv.armor[4] = { id: _iid(532), stack: 1 };
    expect(p.equipStats.accDraw.back).toBe(2);   // 后槽胜出
    expect(p.equipStats.accDraw.front).toBe(0);  // back 赋值清 front（披风互斥）
  });

  it('社交槽 13-19 无条件生效 + 染料逐族配对（UpdateItemDye :9329-9420）：armor[13]=532+dye[3] → back=2/dyeBack=染料', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[13] = { id: _iid(532), stack: 1 };
    expect(p.equipStats.accDraw.back).toBe(2);
    p.inv.dye[3] = { id: _iid(1007), stack: 1 };   // 13%10=3 → dye[3]（cBack 路由）
    expect(p.equipStats.accDraw.dyeBack).toBe(1007);
  });

  it('balloon 双路由（DrawInFrontOfBackArmLayer={18}）：3250 → balloon=13 身后；5076 → balloonFront=18 身前', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(3250), stack: 1 };
    expect(p.equipStats.accDraw.balloon).toBe(13);
    expect(p.equipStats.accDraw.balloonFront).toBe(0);
    p.inv.armor[3] = { id: _iid(5076), stack: 1 };
    expect(p.equipStats.accDraw.balloon).toBe(0);
    expect(p.equipStats.accDraw.balloonFront).toBe(18);
  });

  it('六槽同戴全出槽（54 鞋/536 双手/53 腰/554 颈/223 脸/156 盾）；49 手环单测 handOn', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.extraAccessory = true;
    // ★2026-08-28 门修正（cs:18402-18409 extraAccessory && (expertMode||gameMenu) →
    //  第 6 配饰槽生效）：第 6 件（156 盾,armor[8]）需专家/大师世界门
    p.inv.gateExpert = true;
    [54, 536, 53, 554, 223, 156].forEach((vid, k) => { p.inv.armor[3 + k] = { id: _iid(vid), stack: 1 }; });
    const ad = p.equipStats.accDraw;
    expect(ad.shoe).toBe(6);
    expect(ad.handOff).toBe(8);
    expect(ad.handOn).toBe(15);   // 泰坦手套双槽（:7751-7752 handOn=15+handOff=8）
    expect(ad.waist).toBe(1);
    expect(ad.neck).toBe(2);
    // 223 脸=1 ∈ flower 集 → faceFlower 路由（2026-09-03 四层路由批,旧单层合并退役）
    expect(ad.faceFlower).toBe(1);
    expect(ad.face).toBe(0);
    expect(ad.shield).toBe(1);
    const q = new Player(0, 0, new Inventory());
    q.inv.armor[3] = { id: _iid(49), stack: 1 };
    expect(q.equipStats.accDraw.handOn).toBe(2);
  });
});

// ================= ① 渲染层：记录型 ctx 断言族与层序 =================

/** 记录型 ctx + 假 atlas 直调（parity-g-forensics/antlion-tilt 同款假体） */
function drawAccWithFake(method: 'drawAccBehindLayers' | 'drawAccFrontLayers', p: Player,
  sitting = false): { files: string[]; draws: Array<{ img: unknown; dx: number; dy: number }> } {
  const files: string[] = [];
  const draws: Array<{ img: unknown; dx: number; dy: number }> = [];
  const texStub = { width: 40, height: 1120 };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (k === 'canvas' ? undefined : (...a: unknown[]) => {
      if (String(k) === 'drawImage') {
        // drawImage(img, dx, dy) 或 (img, sx,sy,sw,sh, dx,dy,dw,dh)
        draws.push(a.length <= 3
          ? { img: a[0], dx: a[1] as number, dy: a[2] as number }
          : { img: a[0], dx: a[5] as number, dy: a[6] as number });
      }
      return undefined;
    }),
    set: () => true,
  });
  const proto = Renderer.prototype as unknown as Record<string, (...a: unknown[]) => void>;
  const fake = {
    ctx,
    atlas: { ensureVImage: (f: string) => { files.push(f); return texStub; } },
    wingTexSource: () => null,   // 染料链旁路（无染料时本就不走）
    drawAccBodyFrame: (proto.drawAccBodyFrame as (...a: unknown[]) => void),
  };
  p.sitting = sitting;
  proto[method].call(fake, ctx, p, { body: 0, legs: 0 }, 1, null);
  return { files, draws };
}

describe('配饰系统性①：渲染层十族绘制（记录型 ctx）', () => {
  it('身前族层序 = LegacyPlayerRenderer 身前段：Shoes→HandsOff→Waist→Neck→Beard→Face→Front→Shield→HandsOn', () => {
    const p2 = new Player(0, 0, new Inventory());
    p2.inv.extraAccessory = true;
    p2.inv.gateExpert = true;   // ★同上：armor[8] 第 6 配饰槽需专家/大师门（cs:18402-18409）
    [54, 536, 53, 554, 223, 156].forEach((vid, k) => { p2.inv.armor[3 + k] = { id: _iid(vid), stack: 1 }; });
    p2.inv.armor[13] = { id: _iid(5104), stack: 1 };   // 威尔逊短胡（社交槽 beard=2）
    const { files } = drawAccWithFake('drawAccFrontLayers', p2);
    expect(files).toEqual([
      'vanilla/Acc_Shoes_6.png',
      'vanilla/Acc_HandsOff_8.png',
      'vanilla/Acc_Waist_1.png',
      'vanilla/Acc_Neck_2.png',
      'vanilla/Acc_Beard_2.png',
      'vanilla/Acc_Face_1.png',
      'vanilla/Acc_Shield_1.png',
      'vanilla/Acc_HandsOn_15.png',
    ]);
  });

  it('身架族目标矩形 = 本体帧同位 (-20,-52,40,56)（原版各层锚化简）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(156), stack: 1 };   // 盾
    const { draws } = drawAccWithFake('drawAccFrontLayers', p);
    expect(draws.length).toBe(1);
    expect(draws[0].dx).toBe(-20);
    expect(draws[0].dy).toBe(-52);
  });

  it('身后族：back 披风 + 非躯干架气球（OffsetsPlayerOffhand 行锚）；坐姿隐藏披风（:36473）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(532), stack: 1 };    // back=2
    p.inv.armor[4] = { id: _iid(3250), stack: 1 };   // balloon=13
    const { files, draws } = drawAccWithFake('drawAccBehindLayers', p);
    expect(files).toEqual(['vanilla/Acc_Back_2.png', 'vanilla/Acc_Balloon_13.png']);
    // 披风 = bodyFrame 对齐；气球 = 行 0 锚 (14-40, 20-76) = (-26,-56)
    expect(draws[0].dx).toBe(-20);
    expect(draws[1].dx).toBe(-26);
    expect(draws[1].dy).toBe(-56);
    // 坐姿：披风消失（sitting → back=-1），气球照画
    const sit = drawAccWithFake('drawAccBehindLayers', p, true);
    expect(sit.files).toEqual(['vanilla/Acc_Balloon_13.png']);
  });

  it('front 族坐骑门（:3884 !mount.Active）：front 有槽但坐骑态不画（以 mnt 参数直给）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(2284), stack: 1 };   // back=3 + front=1
    p.inv.armor[4] = { id: _iid(156), stack: 1 };    // shield=1（mnt 门不波及）
    // mnt=null → front 画
    const withMount = drawAccWithFake('drawAccFrontLayers', p);
    expect(withMount.files).toContain('vanilla/Acc_Front_1.png');
    // mnt 非 null → front 跳过（drawAccFrontLayers 第 5 参 mnt）
    const files2: string[] = [];
    const texStub = { width: 40, height: 1120 };
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (k === 'canvas' ? undefined : () => undefined),
      set: () => true,
    });
    const proto = Renderer.prototype as unknown as Record<string, (...a: unknown[]) => void>;
    proto.drawAccFrontLayers.call({
      ctx,
      atlas: { ensureVImage: (f: string) => { files2.push(f); return texStub; } },
      wingTexSource: () => null,
      drawAccBodyFrame: proto.drawAccBodyFrame,
    }, ctx, p, { body: 0, legs: 0 }, 1, { type: 12 } as never);
    expect(files2).not.toContain('vanilla/Acc_Front_1.png');
    expect(files2).toContain('vanilla/Acc_Shield_1.png');   // 其余族照画
  });
});

// ================= ② 信息/机械饰品背包生效域 =================

describe('配饰系统性②：信息/机械饰品背包生效域（UpdateEquips :12494-12500 扫 inventory[0..57]）', () => {
  it('GPS 395 放背包格 5（非快捷栏非装备槽）→ accWatch=3 + compass + depthMeter', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.slots[5] = { id: _iid(395), stack: 1 };
    const g = p.equipStats.infoAccs;
    expect(g.accWatch).toBe(3);
    expect(g.accCompass).toBe(1);
    expect(g.accDepthMeter).toBe(1);
  });

  it('手机 3124 放弹药排 54 → 信息 12 门全开（0..57 含钱币/弹药/垃圾四排,1456/1457 同值字面）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.slots[54] = { id: _iid(3124), stack: 1 };
    const g = p.equipStats.infoAccs;
    expect(g.accWatch).toBe(3);
    expect(g.accCompass).toBe(1);
    expect(g.accDepthMeter).toBe(1);
    expect(g.accFishFinder).toBe(true);
    expect(g.accWeatherRadio).toBe(true);
    expect(g.accCalendar).toBe(true);
    expect(g.accThirdEye).toBe(true);
    expect(g.accJarOfSouls).toBe(true);
    expect(g.accCritterGuide).toBe(true);
    expect(g.accStopwatch).toBe(true);
    expect(g.accOreFinder).toBe(true);
    expect(g.accDreamCatcher).toBe(true);
  });

  it('机械族背包生效（RefreshMechanicalAccs :12397-12430 已建模三旗）：3619/3624/2216', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.slots[20] = { id: _iid(3619), stack: 1 };
    p.inv.slots[21] = { id: _iid(3624), stack: 1 };
    p.inv.slots[22] = { id: _iid(2216), stack: 1 };
    expect(p.equipStats.mechShowWires).toBe(true);
    expect(p.equipStats.autoActuator).toBe(true);
    expect(p.equipStats.autoPaint).toBe(true);
  });

  it('豁免仅限信息/机械类：功能配饰 1322 放背包不生效（仍须配饰槽）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.slots[0] = { id: _iid(1322), stack: 1 };
    expect(p.equipStats.magmaStone).toBe(false);
    p.inv.slots[0] = null;
    p.inv.armor[3] = { id: _iid(1322), stack: 1 };
    expect(p.equipStats.magmaStone).toBe(true);
  });

  it('equipStats 记忆化失效：先读缓存再放 GPS → infoAccs 即时更新（key 背包 I 档）', () => {
    const p = new Player(0, 0, new Inventory());
    expect(p.equipStats.infoAccs.accWatch).toBe(0);   // 预热缓存
    p.inv.slots[9] = { id: _iid(395), stack: 1 };
    expect(p.equipStats.infoAccs.accWatch).toBe(3);
    p.inv.slots[9] = null;
    expect(p.equipStats.infoAccs.accWatch).toBe(0);   // 取出同样失效
  });
});

// ================= ③ 四小件 =================

describe('配饰系统性③：jumpSpeedBoost 叠加（:14250/:13986 各 += 1.6）', () => {
  it('蛙腿 2423 + 两栖靴 3990 同戴 = 3.2（曾 Math.max 取单件 1.6）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(2423), stack: 1 };
    expect(p.equipStats.jumpSpd).toBeCloseTo(1.6);
    p.inv.armor[4] = { id: _iid(3990), stack: 1 };
    expect(p.equipStats.jumpSpd).toBeCloseTo(3.2);
  });

  it('蛙腿全家桶 3994/3995/3996 同为 +1.6 档（:14011-14024）', () => {
    for (const vid of [3994, 3995, 3996]) {
      const p = new Player(0, 0, new Inventory());
      p.inv.armor[3] = { id: _iid(vid), stack: 1 };
      expect(p.equipStats.jumpSpd, `vid ${vid}`).toBeCloseTo(1.6);
    }
  });
});

describe('配饰系统性③：多翅膀槽序后写胜出（:12578-12586 循环后写覆盖）', () => {
  it('slot3=天使之翼(槽2) + slot4=猪龙鱼之翼(槽26) → wingsLogic=26（曾前槽胜出）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(493), stack: 1 };
    p.inv.armor[4] = { id: _iid(2609), stack: 1 };
    expect(p.equipStats.wing?.logic).toBe(26);
    expect(p.equipStats.wing?.time).toBe(180);   // Fishron FlyTime 180 随胜出翅膀
    // 反向佩戴 → 天使之翼胜出
    const q = new Player(0, 0, new Inventory());
    q.inv.armor[3] = { id: _iid(2609), stack: 1 };
    q.inv.armor[4] = { id: _iid(493), stack: 1 };
    expect(q.equipStats.wing?.logic).toBe(2);
    expect(q.equipStats.wing?.time).toBe(100);
  });
});

describe('配饰系统性③：仇恨轴 ±400 七件（ApplyEquipFunctional :13992-14109）', () => {
  it('-400 四件：3015 恶臭香氛/3991 奥术花/4005 侦察瞄准镜/4006 潜行箭袋', () => {
    for (const vid of [3015, 3991, 4005, 4006]) {
      const p = new Player(0, 0, new Inventory());
      p.inv.armor[3] = { id: _iid(vid), stack: 1 };
      expect(p.equipStats.aggroAcc, `vid ${vid}`).toBe(-400);
      expect(p.aggro, `vid ${vid}`).toBe(-400);
    }
  });

  it('+400 三件：3016 血肉指虎/3992 狂战士手套/3998 英雄盾；多件累加', () => {
    for (const vid of [3016, 3992, 3998]) {
      const p = new Player(0, 0, new Inventory());
      p.inv.armor[3] = { id: _iid(vid), stack: 1 };
      expect(p.equipStats.aggroAcc, `vid ${vid}`).toBe(400);
    }
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(3016), stack: 1 };
    p.inv.armor[4] = { id: _iid(3992), stack: 1 };
    expect(p.equipStats.aggroAcc).toBe(800);
    // 正负对冲（3991 -400 + 3016 +400）
    p.inv.armor[5] = { id: _iid(3991), stack: 1 };
    expect(p.equipStats.aggroAcc).toBe(400);
  });

  it('社交槽不产仇恨（ApplyEquipVanity 无 aggro 赋值）：3016 放 armor[13] → 0', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[13] = { id: _iid(3016), stack: 1 };
    expect(p.equipStats.aggroAcc).toBe(0);
  });

  it('隐身药水钳位作用于含配饰轴的总值（:25437-25445）：3016 +400 被 invis 钳 -750', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(3016), stack: 1 };
    p.buffs.apply(BuffType.Invisibility, 60);
    expect(p.aggro).toBe(-750);
  });
});

describe('配饰系统性③：翅膀横移加速倍率消费（WingAirLogicTweaks :28852/:28856）', () => {
  function makeFlyer(wingVid: number) {
    const w = new World(160, 300, 30, 'open');
    for (let x = 0; x < 120; x++) w.store.setTile(x, 100, 1);
    // ★SW-FX44：喂完整 World（wing-flight 同法）——曾丢 w 只给 {store}，III224 深度
    // 重力 NaN 防灌带把夹具重力打成 0.25 档（升力/横移积分失真,生产面恒完整对象）
    w.groundLevel = 100;
    const p = new Player(50 * TILE, 96 * TILE, new Inventory());
    p.hp = 100;
    p.inv.armor[3] = { id: _iid(wingVid), stack: 1 };
    const hooks = {
      world: w as never,
      player: p as never,
      enemies: () => [], critters: () => [], spawnDrop: () => null,
      damagePlayer: (): number => 0, addDamageNumber: () => {}, cutTile: () => {},
      onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
      notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {},
      showPickupLabel: () => {},
    } as unknown as GameHooks;
    return { p, hooks };
  }

  it('猪龙鱼之翼（accelMult 2）空中横移加速快于天使之翼（accelMult 1）——同输入 40t', () => {
    const a = makeFlyer(493);    // 天使之翼 slot2：accelMult 1（vanillaWingStats 默认档）
    const f = makeFlyer(2609);   // 猪龙鱼之翼 slot26：accelMult 2（:28856 ×2 档）
    expect(a.p.equipStats.wing?.logic).toBe(2);
    expect(f.p.equipStats.wing?.logic).toBe(26);
    for (const { p, hooks } of [a, f]) {
      for (let i = 0; i < 60; i++) p.fixedUpdate(1 / 60, hooks);   // 落地站稳
      p.inputJump = true;
      p.inputX = 1;
    }
    // ★BJ731 改判史（2026-10-27）：原版分带（HorizontalMovement :20091-20101/
    //   :20121-20131）= |vx|<maxRunSpeed(3) 全加速;maxRunSpeed..accRunSpeed 带
    //   `vx += runAcceleration×0.2 + (wingsLogic>0 再 ×0.2)`——翼档全加速上界
    //   是 maxRunSpeed 非 accSpeed。实测本夹具:鱼龙 19t 过 3 → 0.16×0.4=0.064/t,
    //   天使 37.5t 过 3 → 0.08×0.4=0.032/t;40t 终值 鱼≈4.4>天≈3.10（比率 1.42
    //   非 ×2）=原版分带本相。旧「全程 ≈×2（未到 accSpeed 上限前）」期望把
    //   accRunSpeed 误当全加速上界=错锁。断言改两段：早段全带 ×2 档比 ≈2;
    //   40t 终值按分带预测。
    for (let t = 0; t < 10; t++) {
      a.p.fixedUpdate(1 / 60, a.hooks);
      f.p.fixedUpdate(1 / 60, f.hooks);
    }
    expect(f.p.vx).toBeGreaterThan(a.p.vx * 1.7);   // 全加速带（两翼 vx<3）×2 档
    expect(f.p.vx).toBeLessThan(a.p.vx * 2.1);
    for (let t = 10; t < 40; t++) {
      a.p.fixedUpdate(1 / 60, a.hooks);
      f.p.fixedUpdate(1 / 60, f.hooks);
    }
    // 分带后增益保持:鱼≈4.36（3+21×0.064）仍显著快于天≈3.10
    expect(f.p.vx).toBeGreaterThan(a.p.vx);
    expect(f.p.vx).toBeGreaterThan(4.2);
    expect(f.p.vx).toBeLessThan(4.6);
    expect(a.p.vx).toBeGreaterThan(0.5);   // 天使之翼确有横移（防两边都趴地假绿）
  });
});
