// 蓝队 R23b 修复回归(红队 /tmp/recon/red-team-r23b.md 定罪项)。
// 覆盖:P1 四柱盾期无敌穿透 / L1 lunar_misc solidRect 参数序 / T1 火星飞碟 -1/-2 消散 /
//       D1 邪教徒二阶段选招表(14 槽+仪式) / G1 DD2 黑暗魔法师治疗轮换 /
//       P2 星旋 LOS 门反相(源级钉扎)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Enemy } from '../src/entities/Enemy';
import { TILE } from '../src/core/constants';
import { martianSaucerAI } from '../src/entities/bossAI_martian';
import { cultistPick } from '../src/entities/bossAI_lategame';
import { darkMageAI, DD2_EVENT_HOOKS } from '../src/entities/bossAI_dd2';

/** 全应答 game 桩:hurt/AI 沿途的 game.* 调用全部吞掉;显式赋值的属性可回读 */
function stubGame(worldOverrides: Record<string, unknown> = {}): unknown {
  const store = {
    w: 1200, h: 2400,
    inBounds: () => true,
    isSolid: () => false,
    isPlatform: () => false,
    idx: () => 0,
    get: () => 0,
    type: [0], half: [0], slope: [0], wire: [0],
    liquid: [0], liquidType: [0],
  };
  const world = {
    w: store.w, h: store.h,
    groundLevel: 200, rockLevel: 400,     // tile 坐标
    seedFlags: {}, flags: {},
    store,
    lunarEvent: { shield: { solar: 100, vortex: 100, nebula: 100, stardust: 100 } },
    isExpert: false,
    ...worldOverrides,
  };
  const target: Record<PropertyKey, unknown> = {
    player: null,
    world,
    enemies: () => [],
    spawnParticles: () => undefined,
    playSfxFiles: () => undefined,
    playSfxWav: () => undefined,
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => undefined;             // 其余任意方法调用吞掉
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

describe('R23b-P1 四柱盾期无敌(R23b 必修1)', () => {
  it('盾>0 时 towerAI 写真 dontTakeDamage → pierce=1 单发弹也被全通道挡下', () => {
    const tower = Enemy.fromVanilla(517, 4000, 1600)!;
    expect(tower).toBeTruthy();
    const g = stubGame() as never;
    // 驱动真实 towerAI(TS private 编译后为原型方法)
    (tower as unknown as Record<string, (g: never, p: null) => void>)['towerAI'](g as never, null);
    expect(tower.dontTakeDamage).toBe(true);          // 盾=100 → 原版 :39493-39501 全通道闸
    const hp0 = tower.hp;
    // pierce=1 单发弹(箭/枪弹):修复前绕过 iframes 免疫门直伤塔体;现被 dontTakeDamage 挡下
    expect(tower.hurt(500, 0, 0, g, 0, false, 1)).toBe(false);
    expect(tower.hp).toBe(hp0);
    // pierce=2 同样挡下(对照)
    expect(tower.hurt(500, 0, 0, g, 0, false, 2)).toBe(false);
    expect(tower.hp).toBe(hp0);
  });

  it('盾扣到 0 → 下一 tick 自动清旗解封(可正常受伤)', () => {
    const tower = Enemy.fromVanilla(422, 4000, 1600)!;
    const g = stubGame() as never;
    (tower as unknown as Record<string, (g: never, p: null) => void>)['towerAI'](g as never, null);
    expect(tower.dontTakeDamage).toBe(true);
    // 盾破(Game 扣盾侧归零)
    (g as unknown as { world: { lunarEvent: { shield: Record<string, number> } } })
      .world.lunarEvent.shield.vortex = 0;
    (tower as unknown as Record<string, (g: never, p: null) => void>)['towerAI'](g as never, null);
    expect(tower.dontTakeDamage).toBe(false);
    const hp0 = tower.hp;
    tower.hurt(500, 0, 0, g, 0, false, 1);
    expect(tower.hp).toBeLessThan(hp0);
  });
});

describe('R23b-P2 星旋空中门 LOS 门方向(必修1附带)', () => {
  it('支线 b 合格点须视线通畅(1458 :39722-39724 !CanHitLine → 弃点)', () => {
    const src = readFileSync('src/entities/Enemy.ts', 'utf8');
    expect(src).toContain('if (!losClear(game, this.cx, this.cy, player.cx, player.cy)) continue;');
    expect(src).not.toContain('if (losClear(game, this.cx, this.cy, player.cx, player.cy)) continue;');
  });
});

describe('R23b-L1 lunar_misc solidRect 参数序(R23b 必修2)', () => {
  it('签名为 C# SolidTiles 区间序 (x0,x1,y0,y1),调用点区间序实参零错位', () => {
    const src = readFileSync('src/entities/bossAI_lunar_misc.ts', 'utf8');
    // 签名 = 区间序(对拍 CultistRitual.cs:102-131 / NPC.cs 石碑落点)
    expect(src).toContain('function solidRect(game: GameHooks, x0: number, x1: number, y0: number, y1: number)');
    // 石碑仪式四柱净空(:429-432)与碑侧落点(:491)按区间序传参——签名修正后语义归正
    // ★BJ731 改判史（2026-10-27）：BJ715-A-③（2026-10-25）四柱净空收编单源
    //   RuntimeEvents.cultistCheckFloorPts（谓词域勘正 isSolidStrict+isPlatformsType）
    //   ——lunar_misc 内联 `!solidRect(game, x-1, x+1, y-3, y-1)` 站已撤,改
    //   ritualCheckFloor 委托;区间序实参锁随迁 RuntimeEvents（bj715a 件3 承接
    //   行为面,本锁只钉实参序）。
    expect(src).toContain('!solidRect(game, tx - 1, tx + 1, y - 3, y - 1)');
    expect(src).toContain('return cultistCheckFloorPts(game.world.store, cx, cy);');
    const rts = readFileSync('src/world/evolution/RuntimeEvents.ts', 'utf8');
    expect(rts).toContain('!solidRect(st, x - 1, x + 1, y - 3, y - 1)');
    // 旧角点序调用(findTeleportSpot 3×3 净空)必须已改写为区间序
    expect(src).toContain('solidRect(game, tx - 1, tx + 1, ty - 1, ty + 1)');
    expect(src).not.toContain('solidRect(game, tx - 1, ty - 1, tx + 1, ty + 1)');
  });

  it('touchesSolid 收口到 solidRect 单一实现;inSolidBody(ALL 语义)已删除', () => {
    const src = readFileSync('src/entities/bossAI_lunar_misc.ts', 'utf8');
    expect(src).toContain('return solidRect(game,');
    expect(src).not.toMatch(/function inSolidBody/);
    // 大宝箱怪三处(F4)+穿墙族共 10 处全部走 ANY 语义 touchesSolid
    expect(src.match(/touchesSolid\(game, e/g)?.length).toBeGreaterThanOrEqual(10);
  });
});

describe('R23b-T1 火星飞碟 -1/-2 态消散(R23b 必修3)', () => {
  it('-1 态越界(玩家跑出 5600px 后爬升出界)→ 出界钳制+直消散(不再永久爬升)', () => {
    const e = Enemy.fromVanilla(395, 6000, 1600)!;
    e.bInit = true;                       // 跳过部件生成(桩 game 无 spawn 通道)
    e.ai0 = -1;
    e.x = 999999;                         // 右界外(st.w*TILE+100 = 19200+100)
    const g = stubGame() as never;
    martianSaucerAI(e, g as never, null);
    expect(e.dead).toBe(true);            // 修复前:-1 分支早退跳过钳制 → 永久无敌爬升体
    expect(e.x).toBeLessThanOrEqual(1200 * TILE + 100);   // position=Vector2.Clamp
  });

  it('-1 态未出界时照常爬升存活(vy−0.4/t),不误杀', () => {
    const e = Enemy.fromVanilla(395, 6000, 1600)!;
    e.bInit = true;
    e.ai0 = -1;
    const g = stubGame() as never;
    martianSaucerAI(e, g as never, null);
    expect(e.dead).toBe(false);
    expect(e.vy).toBeLessThan(0);
  });
});

describe('R23b-D1 邪教徒二阶段选招表(R23b 必修4)', () => {
  it('P2 表 14 槽且末槽=仪式(4):1458 case13 num13=4 + ai[3]=-1(:65407-65409)', () => {
    const e = Enemy.fromVanilla(440, 1000, 800)!;         // 克隆体当桩(只消费 ai3)
    e.ai3 = 11;
    expect(cultistPick(e, true)).toBe(3);                 // 第 12 拍=雷,不复位
    expect(e.ai3).toBe(11);
    e.ai3 = 12;
    expect(cultistPick(e, true)).toBe(0);                 // ★新增第 13 拍=冲(修复前表长 12 直接回卷)
    expect(e.ai3).toBe(12);
    e.ai3 = 13;
    expect(cultistPick(e, true)).toBe(4);                 // ★第 14 拍=远古仪式(P2 曾永不进仪式态)
    expect(e.ai3).toBe(-1);                               // 表尾复位 → 下轮回 0
  });

  it('P1 表仍 12 槽末槽=仪式(回归不劣化)', () => {
    const e = Enemy.fromVanilla(439, 1000, 800)!;
    e.ai3 = 10;
    expect(cultistPick(e, false)).toBe(0);
    e.ai3 = 11;
    expect(cultistPick(e, false)).toBe(4);
    expect(e.ai3).toBe(-1);
  });

  it('头注旧断言「循环(二阶段不再仪式)」已摘除,新表 14 槽在案', () => {
    const src = readFileSync('src/entities/bossAI_lategame.ts', 'utf8');
    expect(src).not.toContain('循环(二阶段不再仪式)');
    expect(src).toContain('[0, 1, 0, 5, 0, 3, 0, 5, 0, 2, 0, 3, 0, 4]');
  });
});

describe('R23b-G1 DD2 黑暗魔法师三招轮换(R23b 必修5)', () => {
  function makeMage(): { mage: Enemy; g: never; hurtFriends: Enemy[] } {
    const mage = Enemy.fromVanilla(565, 5000, 1600)!;     // T3 黑暗魔法师
    mage.bInit = true;
    mage.ai0 = 0;                         // 跳过生成期 -1120 行走 dormant 爬升(直入选招域)
    const hurtFriends = [
      Enemy.fromVanilla(552, 5100, 1620)!,
      Enemy.fromVanilla(553, 4900, 1640)!,
    ];
    for (const f of hurtFriends) f.hp = f.maxHp - 1;      // ±600×±200 内两名受伤友军
    const fakePlayer = { dead: false, cx: 5200, cy: 1560, aggro: 0 };
    const g = stubGame() as never;
    (g as unknown as { player: unknown }).player = fakePlayer;
    (g as unknown as { enemies: () => Enemy[] }).enemies = () => [mage, ...hurtFriends];
    return { mage, g, hurtFriends };
  }
  /** 推进到出生 60t 后的首个选招拍(x[3]≥60 且 ai[0]==0),返回当拍 ai0 */
  function tickUntilPick(mage: Enemy, g: never): number {
    for (let i = 0; i < 300; i++) {
      darkMageAI(mage, g, null);
      if (mage.ai0 > 0) return mage.ai0;
    }
    return mage.ai0;
  }

  it('轮换值 ai[1]=1(治疗)被保留 → 施法号 127(修复前被 let next=0 压成 97)', () => {
    const { mage, g } = makeMage();
    mage.ai1 = 1;                                         // 上招为暗影矢后轮换指向治疗
    expect(tickUntilPick(mage, g)).toBe(127);             // 674 治疗幽灵施法起手(:66675)
  });

  it('轮换值 ai[1]=2(召骷髅)在受伤友军≥2 时同样保留(不被强制覆盖)', () => {
    const { mage, g } = makeMage();
    const prevCanRaise = DD2_EVENT_HOOKS.canRaiseGoblinsHere;
    DD2_EVENT_HOOKS.canRaiseGoblinsHere = () => true;     // 有尸点 → 不回退 0
    try {
      mage.ai1 = 2;
      expect(tickUntilPick(mage, g)).toBe(183);           // :66678 召骷髅施法起手
    } finally {
      DD2_EVENT_HOOKS.canRaiseGoblinsHere = prevCanRaise;
    }
  });

  it('ai[1]=0(暗影矢)近距有视线 → 97(基线回归)', () => {
    const { mage, g } = makeMage();
    mage.ai1 = 0;
    expect(tickUntilPick(mage, g)).toBe(97);
  });
});
