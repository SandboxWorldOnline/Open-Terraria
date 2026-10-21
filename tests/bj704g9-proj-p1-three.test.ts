// ★BJ704-G9（2026-10-21）弹幕域 P1 三件清偿——判别锁 + 反编译源锚。
//  件1 R2-F1+F10（喵刀 502 死亡跳）：原版 HandleMovement type502 块
//    （:18317-18365）尘环（:18337-18348）与扩盒 Damage()（:18349-18364）位于
//    kill/else【两分支之外】——第 5 跳（kill 跳）仍 position+=velocity 前移
//    （:18323）→30 尘最大彩虹环+40+8×5=80px 最大 AOE（Kill() 不拦块内直线码;
//    Damage() 无 active 门 :12502,Damage_CanDealDamage 无 502 拒 :12463）。
//    附带清偿：a)盒交换心锚定（旧 `this.w=box 后读 this.cx`=顶左钉死,偏
//    (box−16)/2;原版 position=Center 先于尺寸交换 :18354-18356）;b)R2-F10 扩盒
//    割草（Damage() :12515-12518 friendly+myPlayer 先 CutTiles——扩盒面积割草/
//    碎罐;常盒逐拍割面=Entity.ts 中央收口既有,死亡跳 killNow 后中央跳过 ⇒
//    弹跳位即死亡跳唯一割面）。
//  件2 R1-P1-2（533/388 ghost 镜像）——★销案（假信念证伪）：finding 前提
//    「aiStyle-66 块尾 :30712 spriteDirection=direction」系【结构误植】——
//    亲证括号平衡：:30712 位于 aiStyle-【68】块尾（:30654-30729,成员仅 399/669）;
//    aiStyle-66 块=:30084-30649 零 spriteDirection 写（AI_066_TryInterceptingTarget
//    同零写）⇒ 387/388/533 spriteDirection 恒 1 → dir 恒 None（Main.cs:30530-30533
//    读 spriteDirection 非 direction）→ mode0 幽灵（:31334 直取）与本体均恒不翻
//    =仓内 mirror 恒 false 1:1 正确。同族「864/946 本体不翻=存量债」随销
//    （AI_169 :46559-46700 零写/AI_156 :52457 写位仅 755 支）。普查表勘正：
//    533 系 mode0（ProjectileID.cs:385）非 mode2/3/4 员。
//  件3 G1 登记债①+R1-P2②（两小刀）：
//    ①虎 state5 入/离态拍零 contact——原版 Damage() 在 AI 外每拍跑,四个过渡拍
//    （入态 :51147-51152 / 出域 :50541-50546 / 支承滞回 :50561-50565 / 丢目标
//    :50597-50601）均以静止盒照结触（:12463 仅拒 833-835∧ai0==4）→ 四口补
//    contact（零位移=入态拍零积分家族近似,保留）。
//    ②蜘蛛步行 cd 双制归一——vanilla 390-392=usesIDStaticNPCImmunity+
//    idStaticNPCHitCooldown=15（SetDefaults :4754-4755,步行/爬墙同表跨实例共享）;
//    旧步行支显式私表 20（cd 值偏+不共享）→ 摘参回落 contactResolve=idStatic 15。
// 变异恰红清单（逐发验证后还原）：M1 恢复 `meowCount>=5 早退` → §1 红;
//  M2 盒锚定回顶左 → §1.2 红;M3 摘 cutTilesBox → §1.4 红;M4 蜘蛛回私表 20 →
//  §4 红;M5 摘任一过渡 contact → §3/§5 红;M6 GHOST_FLIP_DIR 收编 533 → §2 红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Arrow } from '../src/entities/Arrow';
import { MinionProj, minionTrueBox } from '../src/entities/MinionProj';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import { PROJ_TRAILING_MODE } from '../src/entities/projGhostTrail';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { pinGameTimeTicks } from '../src/core/GameTime';
import type { GameHooks } from '../src/entities/types';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const EXT_MISSING = !readFileSync(join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');
const read = (p: string) => readFileSync(p, 'utf8');

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp: number; iframes?: number;
  hurt: (d: number, ...rest: unknown[]) => boolean;
  hits: number[];
}
const mkEnemy = (id: number, cx: number, cy: number, w = 60, h = 60): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy,
    hp: 100000, maxHp: 100000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

interface DustRec { type: number; noGravity: boolean; scale: number; x: number; y: number; vx: number; vy: number }

/** 喵刀直驱夹具（bj482 makeGame 同式 + spawnDust/cutTile 记录仪） */
function makeMeowGame(enemies: MockEnemy[] = []) {
  const w = new World(200, 120, 7, 'bj704g9-meow');
  const list: unknown[] = [...enemies];
  const dusts: DustRec[] = [];
  const cutTiles: Array<[number, number]> = [];
  const hooks: GameHooks = {
    world: w as never,
    player: null,
    enemies: () => list,
    npcs: () => [],
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: (x: number, y: number) => { cutTiles.push([x, y]); },
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    spawnDust: ((x: number, y: number, _bw: number, _bh: number, type: number,
      vx: number, vy: number, _a: unknown, _c: unknown, _s: unknown,
      noGravity?: boolean) => {
      const d: DustRec = { type, noGravity: noGravity === true, scale: 0, x, y, vx, vy };
      dusts.push(d);
      return d;
    }) as never,
  } as unknown as GameHooks;
  return { hooks, dusts, cutTiles };
}

/** 随从夹具（bj704g1 makeHooks 同式） */
function makeMinionGame(enemies: MockEnemy[] = []) {
  const w = new World(200, 140, 7, 'bj704g9-minion');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 140; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  } as unknown as GameHooks;
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown) => void } }).entities = {
    projectiles: added,
    add: (e: unknown) => { added.push(e); },
  };
  return { hooks, player, added, world: w };
}

let seq = 0;
const minion = (player: Player, hooks: GameHooks, cx: number, cy: number,
  projId: number, damage = 20): MinionProj => {
  const m = new MinionProj(cx, cy, projId, damage, 2, false, 0, false, () => player);
  m.id = ++seq;
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
  (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
  return m;
};
const S = (m: unknown) => m as unknown as Record<string, number | boolean>;

// ============================================================
// §0 原版源锚（结构锁——读错/漂移即红）
// ============================================================
describe.skipIf(EXT_MISSING)('§0 原版锚', () => {
  const van = read(join(VAN, 'Terraria', 'Projectile.cs'));

  it('R2-F1:502 块尘环+Damage() 在 kill/else 两分支之外（:18317-18365）', () => {
    const i = van.indexOf('else if (type == 502)');
    const b = van.slice(i, van.indexOf('else if (type == 444)', i));
    expect(b).toContain('MathHelper.Clamp(++ai[0], 1f, 5f)');
    expect(b).toContain('position += velocity;');
    const iKill = b.indexOf('Kill();');
    const iDust = b.indexOf('Dust.NewDust(base.Center, 0, 0, 66');
    const iDamage = b.indexOf('Damage();', iDust);
    const iElse = b.indexOf('else\r\n\t\t\t\t\t{');        // kill/else 分叉
    expect(iKill).toBeGreaterThan(-1);
    expect(iKill).toBeGreaterThan(iElse);                 // Kill 在分支内
    expect(iDust).toBeGreaterThan(iKill);                 // 尘环在 Kill 后=分支外
    expect(iDamage).toBeGreaterThan(iDust);               // Damage() 最后=分支外
    expect(b).toContain('width = (height = 40 + 8 * (int)ai[0]);');
  });
  it('R2-F1:Damage() 无 active 门（:12502 起,DebugOptions→CanDealDamage）', () => {
    const i = van.indexOf('public void Damage()');
    const b = van.slice(i, i + 400);
    expect(b.indexOf('Damage_CanDealDamage()')).toBeGreaterThan(-1);
    expect(b.slice(0, b.indexOf('Damage_CanDealDamage()'))).not.toContain('!active');
  });
  it('R2-F10:Damage() 内 friendly+myPlayer 先 CutTiles（:12515-12518）', () => {
    const i = van.indexOf('public void Damage()');
    const b = van.slice(i, i + 900);
    expect(b).toContain('if (friendly && owner == Main.myPlayer && !npcProj && !minion && type != 1054)');
    const iCut = b.indexOf('CutTiles();');
    const iPve = b.indexOf('Damage_PVE(');
    expect(iCut).toBeGreaterThan(-1);
    expect(iPve).toBeGreaterThan(iCut);                   // 割草先于结算
  });
  it('R1-P1-2 反证::30712 spriteDirection=direction 属 aiStyle-68 块尾（成员 399/669）', () => {
    // ★链相对定位：AI 分发链外另有早位 on-hit 链（:13182 亦现 aiStyle==68,只写
    //  direction 不写 spriteDirection）——须以 66 锚（全文件唯此一处）起算链内 67/68/69。
    const i66 = van.indexOf('else if (aiStyle == 66)');
    const i67 = van.indexOf('else if (aiStyle == 67)', i66);
    const i68 = van.indexOf('else if (aiStyle == 68)', i67);
    const i69 = van.indexOf('else if (aiStyle == 69)', i68);
    expect(i66).toBeGreaterThan(-1);
    expect(i67).toBeGreaterThan(i66);
    expect(i68).toBeGreaterThan(i67);
    expect(i69).toBeGreaterThan(i68);
    const blk66 = van.slice(i66, i67);
    expect(blk66).not.toContain('spriteDirection');       // ★66 块零写（假信念反证核心）
    const blk68 = van.slice(i68, i69);
    expect(blk68).toContain('spriteDirection = direction;');   // :30712 在 68 块尾
    // SetDefaults（区界内）:387/388/533=aiStyle 66;399/669=aiStyle 68
    const iSet = van.indexOf('public void SetDefaults');
    const region = van.slice(iSet, van.indexOf('private void UseGroupStaticImmunity', iSet));
    const sdBlock = (t: number): string => {
      const i = region.indexOf(`else if (type == ${t})`);
      expect(i).toBeGreaterThan(-1);
      const next = region.indexOf('else if (type ==', i + 10);
      return region.slice(i, next > 0 ? next : i + 500);
    };
    for (const t of [387, 388, 533]) expect(sdBlock(t)).toContain('aiStyle = 66;');
    for (const t of [399, 669]) expect(sdBlock(t)).toContain('aiStyle = 68;');
  });
  it('R1-P1-2:TrailingMode 533/388=0、864/946=2;dir 读 spriteDirection（Main.cs:30530）', () => {
    const pid = read(join(VAN, 'Terraria.ID', 'ProjectileID.cs'));
    const m = pid.match(/TrailingMode = Factory\.CreateIntSet\([^)]*\)/)![0];
    expect(m).toMatch(/\b388, 0,/);
    expect(m).toMatch(/\b533, 0,/);
    expect(m).toMatch(/\b864, 2,/);
    expect(m).toMatch(/\b946, 2,/);
    expect(m).not.toMatch(/\b387, /);                     // 387 无幽灵（缺省 -1）
    const main = read(join(VAN, 'Terraria', 'Main.cs'));
    expect(main).toContain('if (proj.spriteDirection == -1)');
  });
  it('件3①:虎入态扫描 return（:51147-1152）+state5 三出态 return+:12463 仅拒 833-835∧ai0==4', () => {
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    expect(fn).toContain('ai[0] = 5f;');
    const i5 = fn.indexOf('ai[0] = 5f;');
    expect(fn.slice(i5, i5 + 120)).toContain('return;');  // 入态整段退
    expect(van).toContain('(type == 833 && ai[0] == 4f)');   // :12463 拒收仅此窗
    expect(van).toContain('type == 834 && ai[0] == 4f');
    expect(van).toContain('type == 835 && ai[0] == 4f');
  });
  it('件3②:蜘蛛 390-392 idStatic 15（SetDefaults :4754-4755,步行/爬墙同表）', () => {
    const i = van.indexOf('else if (type == 390 || type == 391 || type == 392)');
    const b = van.slice(i, i + 320);
    expect(b).toContain('usesIDStaticNPCImmunity = true;');
    expect(b).toContain('idStaticNPCHitCooldown = 15;');
  });
  it('插队刀①:533 本体=:30609 glowmask 族支（:31578 盒心+帧心;名单含 533）', () => {
    const main = read(join(VAN, 'Terraria', 'Main.cs'));
    const list = main.slice(main.indexOf('if (proj.type == 408 || proj.type == 435'), main.indexOf('{', main.indexOf('if (proj.type == 408 || proj.type == 435')));
    expect(list).toContain('proj.type == 533');
    expect(list).toContain('proj.type == 755');
    expect(list).toContain('proj.type == 833');
    // 本体 :31578:位=Center+zero+(0,gfxOffY+num151)、origin8、rotation24、num192、dir
    expect(main).toContain('EntitySpriteDraw(value15, proj.Center + zero - screenPosition + new Vector2(0f, proj.gfxOffY + (float)num151), rectangle4, color48, rotation24, origin8, num192, dir);');
    // 533 无 zero/origin8/num151 特判:num151 表（:30077-30528）无 533 项
    const tbl = main.slice(main.indexOf('int num151 = 0;'), main.indexOf('if (proj.type == 408 || proj.type == 435'));
    expect(tbl).not.toContain('== 533');
  });
  it('插队刀②:GlowMask[128]=Images/Glow_128 × White*0.3 同锚叠画（:31588-31591）', () => {
    const main = read(join(VAN, 'Terraria', 'Main.cs'));
    const iBody = main.indexOf('EntitySpriteDraw(value15, proj.Center + zero - screenPosition + new Vector2(0f, proj.gfxOffY + (float)num151), rectangle4, color48, rotation24, origin8, num192, dir);');
    expect(iBody).toBeGreaterThan(-1);
    const i = main.indexOf('else if (proj.type == 533)', iBody);   // :31588（本体后紧邻）
    const b = main.slice(i, i + 400);
    expect(b).toContain('TextureAssets.GlowMask[128].Value');
    expect(b).toContain('Microsoft.Xna.Framework.Color.White * 0.3f');
    expect(b).toContain('proj.Center - screenPosition');
    expect(b).toContain('origin8, pr');               // 同 origin/scale 截断可见
    const gid = read(join(VAN, 'Terraria.ID', 'GlowMaskID.cs'));
    expect(gid).toContain('public const short DeadlySphere = 128;');
    const ai = read(join(VAN, 'Terraria.Initializers', 'AssetInitializer.cs'));
    expect(ai).toContain('"Images\\\\Glow_" + num41');   // Glow_N.png 直引族
  });
  it('插队刀③★销案:533 自旋系数=0.04（:30483-30486 型专属）,0.1 系 aiStyle-65 块', () => {
    // 「:30040/:30074 rotation += vx*0.1 ⇒ 533 修 0.1」定谳被证伪——两写位均在
    // aiStyle==65 块内（:30011-30083）;533（aiStyle 66）自旋=0.04 且带 ai0<3∨≥9 门,
    // 与仓内 :6581 逐字同相（勿改成 0.1=会反向偏离原版 2.5×）。
    expect(van).toContain('if (type == 533 && (this.ai[0] < 3f || this.ai[0] >= 9f))');
    const i533 = van.indexOf('if (type == 533 && (this.ai[0] < 3f || this.ai[0] >= 9f))');
    expect(van.slice(i533, i533 + 150)).toContain('rotation += velocity.X * 0.04f;');
    const i65 = van.indexOf('else if (aiStyle == 65)');
    const i66 = van.indexOf('else if (aiStyle == 66)');
    const blk65 = van.slice(i65, i66);
    expect(blk65.match(/rotation \+= velocity\.X \* 0\.1f;/g)).toHaveLength(2);   // :30040/:30074=65 族
  });
});

// ============================================================
// §1 件1 喵刀死亡跳三面（行为锁;直驱 meowBounceOff）
// ============================================================
describe('§1 R2-F1+F10 死亡跳三面', () => {
  const drive = (hooks: GameHooks, meowCount: number, x = 1000, y = 1000, vx = 8, vy = 6) => {
    const cat = new Arrow(x, y, vx, vy, 40, 2, 502, { grav: 0, life: 600, pierce: 5 });
    (cat as unknown as { meowCount: number }).meowCount = meowCount;
    const ret = (cat as unknown as { meowBounceOff: (g: GameHooks) => boolean }).meowBounceOff(hooks);
    return { cat, ret };
  };

  it('1.1 死亡跳:前移+消亡+30 尘最大彩虹环（type66/noGravity/scale=1+5/3）', () => {
    const { hooks, dusts } = makeMeowGame();
    const { cat, ret } = drive(hooks, 4);
    expect(ret).toBe(true);
    expect(cat.dead).toBe(true);                          // 旧早退路径消亡面保持
    expect(cat.x).toBe(1000 + 8);                         // :18323 position += velocity
    expect(cat.y).toBe(1000 + 6);
    expect(dusts.length).toBe(30);                        // 10+ai0×4=30（旧早退=0 → 必红）
    for (const d of dusts) {
      expect(d.type).toBe(66);
      expect(d.noGravity).toBe(true);
      expect(d.scale).toBeCloseTo(1 + 5 / 3, 12);
    }
    const r = Math.hypot(8, 6) * 0 + 8;                   // r=3+ai0=8（环半径分量抽样）
    const v0 = Math.hypot(dusts[0].vx, dusts[0].vy);
    expect(v0).toBeGreaterThanOrEqual(3 * 0.8);
    expect(v0).toBeLessThanOrEqual(r * 1.05 * 1.2);
    expect(dusts[0].x).toBeCloseTo(1008 + 8, 6);          // 心=前移后 Center
    expect(dusts[0].y).toBeCloseTo(1008 + 6, 6);
  });

  it('1.2 死亡跳 AOE:心锚定 80px 盒结算（敌在心锚盒内/旧顶左锚盒外 → 必须命中）', () => {
    const en = mkEnemy(9, 988, 1000, 20, 20);             // 中心盒 [976,1056] 内、旧顶左 [1008,1088] 外
    const { hooks } = makeMeowGame([en]);
    const { cat } = drive(hooks, 4);
    expect(cat.dead).toBe(true);
    expect(en.hits.length).toBe(1);                       // 旧早退=0/旧顶左锚=0 → 双重必红
  });

  it('1.3 死亡跳 AOE 与主命中环同表:meowHitCd 窗内敌拒收', () => {
    const en = mkEnemy(10, 1016, 1014, 40, 40);           // 正叠新心
    const { hooks } = makeMeowGame([en]);
    const cat = new Arrow(1000, 1000, 8, 6, 40, 2, 502, { grav: 0, life: 600, pierce: 5 });
    (cat as unknown as { meowCount: number }).meowCount = 4;
    (cat as unknown as { meowHitCd: Map<number, number> }).meowHitCd.set(en.id, 5);
    (cat as unknown as { meowBounceOff: (g: GameHooks) => boolean }).meowBounceOff(hooks);
    expect(cat.dead).toBe(true);
    expect(en.hits.length).toBe(0);                       // cd 窗拒（同表=localNPCImmunity 同构）
  });

  it('1.4 R2-F10:扩盒割草（friendly 割 36 格;hostile 零割）', () => {
    const { hooks, cutTiles } = makeMeowGame();
    drive(hooks, 4);
    // 心=(1016,1014) box=80 → 盒 [976,1056]×[974,1054] → 格列 61..66 × 行 60..65
    // （cutTilesBox 排除界:+1 为循环排除,末含格=trunc((y+h)/16)=65）=36 格
    expect(cutTiles.length).toBe(36);
    expect(cutTiles).toContainEqual([61, 60]);
    expect(cutTiles).toContainEqual([66, 65]);
    const h2 = makeMeowGame();
    const cat2 = new Arrow(1000, 1000, 8, 6, 40, 2, 502, { grav: 0, life: 600, pierce: 5 });
    (cat2 as unknown as { meowCount: number }).meowCount = 4;
    (cat2 as unknown as { hostile: boolean }).hostile = true;   // :12516 friendly 门
    (cat2 as unknown as { meowBounceOff: (g: GameHooks) => boolean }).meowBounceOff(h2.hooks);
    expect(h2.cutTiles.length).toBe(0);
  });

  it('1.5 非死亡跳回归:计数 1→反射+14 尘+48px 盒 AOE 照跑', () => {
    const en = mkEnemy(11, 1016, 1014, 30, 30);           // 心锚 48 盒 [992,1040] 内
    const { hooks, dusts } = makeMeowGame([en]);
    const { cat, ret } = drive(hooks, 0);
    expect(ret).toBe(true);
    expect(cat.dead).toBe(false);
    expect((cat as unknown as { meowCount: number }).meowCount).toBe(1);
    expect(dusts.length).toBe(14);                        // 10+1×4
    expect(en.hits.length).toBe(1);                       // AOE 心锚（旧顶左锚 [1008,1056]:x∈[992,1040] 部分覆盖,敌 x∈[1001,1031] 两锚均中——非判别位,判别位在 1.2）
  });
});

// ============================================================
// §2 件2 R1-P1-2 销案锁（533/388 幽灵恒不翻=mirror 恒 false 1:1 正确）
// ============================================================
describe('§2 R1-P1-2 销案锁', () => {
  it('2.1 GHOST_FLIP_DIR 精确集=[755,833,834,835]——勿收编 533/388/864/946', () => {
    const set = (MinionProj as unknown as { GHOST_FLIP_DIR: Set<number> }).GHOST_FLIP_DIR;
    expect([...set].sort((x, y) => x - y)).toEqual([755, 833, 834, 835]);
  });
  it('2.2 TrailingMode 表:533/388=mode0（非 mode2/3/4）;864/946=2', () => {
    expect(PROJ_TRAILING_MODE[533]).toBe(0);
    expect(PROJ_TRAILING_MODE[388]).toBe(0);
    expect(PROJ_TRAILING_MODE[864]).toBe(2);
    expect(PROJ_TRAILING_MODE[946]).toBe(2);
  });
  it('2.3 源锁:projGhostTrail 普查勘正（mode2/3/4 员列不含 533;销案注在位）', () => {
    const src = read(join(GAME, 'src', 'entities', 'projGhostTrail.ts'));
    expect(src).not.toContain('533/864');                 // 旧误列形
    expect(src).toContain('R1-P1-2');
    expect(src).toContain('aiStyle-【68】');               // :30712 结构误植定谳锚
    expect(src).toContain('533 系【mode0】');
  });
});

// ============================================================
// §3 件3① 虎 state5 入/离态拍接触（行为锁+结构锁）
// ============================================================
describe('§3 虎 state5 过渡拍接触（G1 登记债①）', () => {
  it('3.1 入态拍:敌下方 15 行全空 → 首拍入 state5 且叠盒敌吃 1 hit（旧零 contact）', () => {
    // 敌悬空行 70（下方 70..84 行 15 格全空,地面在行 100）;虎叠盒直落 walk 支
    const en = mkEnemy(1, 63 * 16 + 8, 70 * 16);
    const { hooks, player } = makeMinionGame([en]);
    const m = minion(player, hooks, en.cx, en.cy, 833);
    S(m).pounceCd = 1000;
    m.fixedUpdate(1, hooks);
    expect(S(m).tigerA0).toBe(5);                         // 入态（:51149）
    expect(en.hits.length).toBe(1);                       // ★入态拍静止盒照结触（旧=0 → 必红）
  });

  it('3.2 支承滞回离态拍:+3 行支承 → 回 walk 且叠盒敌吃 1 hit（旧零 contact）', () => {
    const en = mkEnemy(2, 60 * 16 + 200, 90 * 16 - 60);
    const { hooks, player, world } = makeMinionGame([en]);
    world.store.setTile(Math.floor(en.cx / 16), Math.floor(en.y / 16) + 3, 1);   // 支承@+3 行
    const m = minion(player, hooks, en.cx, en.cy, 833);
    S(m).pounceCd = 1000; S(m).tigerA0 = 5;
    m.fixedUpdate(1, hooks);
    expect(S(m).tigerA0).toBe(0);                         // 离态回 walk
    expect(en.hits.length).toBe(1);                       // ★离态拍照结触（旧=0 → 必红）
  });

  it('3.3 结构锁:tigerBody 七处 contact（4 过渡+3 常态）,四过渡口均在 return 前', () => {
    const src = read(join(GAME, 'src', 'entities', 'MinionProj.ts'));
    const i = src.indexOf('private tigerBody(');
    const b = src.slice(i, src.indexOf('private tigerFrameTick(', i));
    expect(b.match(/this\.contact\(game, dmg0 \* scale, 10\);/g)).toHaveLength(7);
    // 入态口:rows >= 15 → contact → return
    const iEnter = b.indexOf('if (rows >= 15)');
    const segE = b.slice(iEnter, b.indexOf('return;', iEnter));
    expect(segE).toContain('this.contact(game, dmg0 * scale, 10);');
    // 丢目标/出域/滞回三出态口同形（contact 在 return 前）
    for (const anchor of ['if (!tgtPre)', '(dMe5 < dP5 ? dMe5 : dP5) > 800', 'if (rows5 < 7)']) {
      const j = b.indexOf(anchor);
      expect(j).toBeGreaterThan(-1);
      const seg = b.slice(j, b.indexOf('return;', j));
      expect(seg).toContain('this.contact(game, dmg0 * scale, 10);');
    }
  });
});

// ============================================================
// §4 件3② 蜘蛛步行 cd 归一（idStatic 15 共享,旧私表 20）
// ============================================================
describe('§4 蜘蛛步行 cd 双制归一（R1-P2②）', () => {
  it('4.1 同型双蛛同拍共享 idStatic 15:首蛛咬、次蛛同拍拒（旧私表=双咬必红）', () => {
    const en = mkEnemy(3, 60 * 16 + 80, 90 * 16 - 30, 120, 60);
    const { hooks, player } = makeMinionGame([en]);
    pinGameTimeTicks(0);
    const s1 = minion(player, hooks, en.cx - 30, en.cy, 390);
    const s2 = minion(player, hooks, en.cx + 30, en.cy, 390);
    s1.fixedUpdate(1, hooks);
    s2.fixedUpdate(1, hooks);
    expect(en.hits.length).toBe(1);                       // 跨实例共享（旧各咬一口=2 → 必红）
  });

  it('4.2 15t 绝对到期解封复咬（次蛛 15 拍后再咬;私表 20 拍=仍拒）', () => {
    const en = mkEnemy(4, 60 * 16 + 80, 90 * 16 - 30, 120, 60);
    const { hooks, player } = makeMinionGame([en]);
    pinGameTimeTicks(0);
    const s1 = minion(player, hooks, en.cx - 30, en.cy, 390);
    const s2 = minion(player, hooks, en.cx + 30, en.cy, 390);
    s1.fixedUpdate(1, hooks);
    s2.fixedUpdate(1, hooks);                             // 拒（4.1 同式）
    pinGameTimeTicks(15);
    s2.fixedUpdate(1, hooks);                             // stored 15 ≤ 15 → 解封复咬
    expect(en.hits.length).toBe(2);
    pinGameTimeTicks(30);
    const s3 = minion(player, hooks, en.cx - 30, en.cy, 390);
    s3.fixedUpdate(1, hooks);                             // stored 30（15 拍写 15+15）≤ 30 → 再咬
    expect(en.hits.length).toBe(3);                       // 共享表跨实例连续消费
  });

  it('4.3 结构锁:步行支摘显式 20（contactResolve 回落 idStatic 15）', () => {
    const src = read(join(GAME, 'src', 'entities', 'MinionProj.ts'));
    const i = src.indexOf('private spiderStep(');
    const b = src.slice(i, src.indexOf('private frogStep(', i));
    expect(b).not.toContain('this.contact(game, dmg0, 20)');     // 旧私表形退役（963 阿比盖尔 20 系其本值,域外）
    expect(b).toContain('if (this.spFriendly && this.contact(game, dmg0)) this.spLai1 = 20;');
  });
});

// ============================================================
// §5 插队刀：533 本体锚改道 :30609 glowmask 族支（用户实报「自旋旋转原点不对」）
// ============================================================
describe('§5 533 本体锚（:31578 盒心+帧心;旧通用尾=偏心公转）', () => {
  // sw-bj16 ③ 同款夹具：fakeTex + 记录型 ctx
  const fakeTex = (w: number, h: number): HTMLImageElement =>
    ({ width: w, height: h }) as unknown as HTMLImageElement;
  class FakeCanvas {
    width = 0; height = 0;
    getContext() {
      return { drawImage() {}, imageSmoothingEnabled: false };
    }
  }
  (globalThis as { document?: unknown }).document = {
    createElement: (): FakeCanvas => new FakeCanvas(),
  };
  const recordingCtx = () => {
    const draws: Array<{ tex: unknown; args: number[] }> = [];
    const translates: number[][] = [];
    const rots: number[] = [];
    const ctx = {
      save() {}, restore() {},
      translate(x: number, y: number) { translates.push([x, y]); },
      rotate(a: number) { rots.push(a); },
      scale(_x: number, _y: number) {},
      set imageSmoothingEnabled(_: boolean) {},
      set globalAlpha(_: number) {},
      set fillStyle(_: string) {}, set strokeStyle(_: string) {},
      fillRect() {}, strokeRect() {},
      drawImage(tex: unknown, ...rest: number[]) { draws.push({ tex, args: rest }); },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, draws, translates, rots };
  };
  const mkHooks = () => {
    const player = new Player(60 * 16, 90 * 16, new Inventory());
    const hooks = {
      world: { store: { setTile: () => {}, isSolid: () => false, inBounds: () => true } } as never,
      player: player as never,
      enemies: () => [], critters: () => [], spawnDrop: () => null, damagePlayer: (): number => 0,
      addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
      playSfxFiles: () => {}, showPickupLabel: () => {},
    } as never;
    return { hooks, player };
  };

  it('5.1 行为锁:translate=[cx,cy]+rotate(rot)+drawImage=[−24,−24]（48×48 帧 vs 20×20 盒）', () => {
    setProjSpriteOverride(533, fakeTex(48, 1008));            // 21 帧 × 48
    const { hooks, player } = mkHooks();
    const bx = minionTrueBox(533);
    const m = new MinionProj(player.cx, 100 * 16 - bx.h, 533, 10, 2, false, 0, false, () => player);
    (m as unknown as { alphaFade: number }).alphaFade = 0;
    (m as unknown as { dFrame: number }).dFrame = 4;
    (m as unknown as { rot: number }).rot = 1.234;
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy]]);           // ★:31578 盒心锚（旧通用尾=[cx+14,cy] → 必红）
    expect(rec.rots).toContain(1.234);                        // rotation24=proj.rotation
    expect(rec.draws).toHaveLength(1);                        // 单次主绘（glow 走 pushGlowOps,无 r 时跳过）
    expect(rec.draws[0].args).toEqual([-24, -24]);            // origin8=帧心（旧=帧宽/2 与盒半高混算 → 必红）
  });

  it('5.2 结构锁:533 专支在通用尾之前 + glow op 迁入 + 旧尾块摘除（防双记）', () => {
    const src = read(join(GAME, 'src', 'entities', 'MinionProj.ts'));
    const iBranch = src.indexOf('if (this.projId === 533 && img) {');
    const iGeneric = src.indexOf('const off3 = img');
    expect(iBranch).toBeGreaterThan(-1);
    expect(iBranch).toBeLessThan(iGeneric);                   // 专支先于通用尾
    const branch = src.slice(iBranch, src.indexOf('return;', iBranch));
    expect(branch).toContain('ctx.translate(this.cx, this.cy)');
    expect(branch).toContain('ctx.rotate(this.rot)');
    expect(branch).toContain("ensureVImage('vanilla/Glow_128.png')");
    expect(branch).toContain('tint: [76 / 255, 76 / 255, 76 / 255], alpha: 76 / 255');
    // 旧尾 Glow_128 块摘除（防双记）:全文件 Glow_128 ensureVImage 唯一
    expect(src.match(/ensureVImage\('vanilla\/Glow_128\.png'\)/g)).toHaveLength(1);
  });

  it('5.3 结构锁:自旋系数 0.04 在位（:30483-30486;勿改成 0.1=aiStyle-65 误锚）', () => {
    const src = read(join(GAME, 'src', 'entities', 'MinionProj.ts'));
    expect(src).toContain('if (this.dA0 < 3 || this.dA0 >= 9) this.rot += this.vx * 0.04;');
    expect(src).not.toContain('this.rot += this.vx * 0.1;');  // 0.1 系 aiStyle-65 族,勿误植（864 :46636 0.1+0.05 系其本值不受此锁）
  });
});
