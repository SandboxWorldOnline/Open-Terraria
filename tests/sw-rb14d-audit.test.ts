// SW-RB14d 红蓝对抗批（FX36/FX37/FX38/FX40 审计修复）——断言全部按「旧实现退化值」
// 设计：旧代码在本文件下必红（变异证红内建），金标行号逐条标注。
//   金标：Player.cs:28276（StepUp 正挂门 `(carpetFrame != -1 || velocity.Y >= gravity)`）/
//   :24555+:24637（maxFallSpeed=10 复位 → 无条件 +0.01 字段终值 10.01;湿档 3/7/6/2 同过此闸）/
//   :24600-24624（湿档覆写）/ Recipe.cs:228-256+:478-494（UpdateRecipeList 身份追焦+钳制）/
//   CraftingUI.cs:131-139（VisuallyRepositionRecipes 新焦点行接管旧偏移=glideY 不变）/
//   PlayerInput.cs:1407/:901-902（ScrollWheelValue 跨事件累计、帧差分量化）/
//   UserInterface.cs:219-222 + UIList.cs:109-116（滚轮上滚=viewPosition 向顶）。
//   Bestiary：painted 登记面自愈契约（FX37 F1/F2/F7）/ FillInfoForEntry 实时读 tracker（F3）/
//   FillBestiarySpaceWithEntries→DeselectEntryButton（UIBestiaryTest.cs:340-347,F5）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { moveAndCollide, type Body } from '../src/physics/TileCollision';
import { World } from '../src/world/World';
import { TILE, GRAVITY, PLAYER_MAX_FALL_SPEED, MAX_FALL_SPEED } from '../src/core/constants';
import { TILE_BY_KEY } from '../src/data/tiles';
import {
  vanillaWheelNotches, wheelEventPx, craftSnapEase, craftSnapCrossedRow,
} from '../src/ui/craftingGrid';
import { bestiarySweepTargets, type BestiaryRow } from '../src/ui/BestiaryPanel';
import { bestiaryEntries, UnlockState } from '../src/data/Bestiary';

const SRC = (f: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');

const STONE_ID = TILE_BY_KEY['stone'] ?? 1;

function flatWorld(): World {
  const w = new World(480, 120, 30, 'open');
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, 70, STONE_ID, 0, 0);
    w.store.setTileSilent(x, 71, STONE_ID, 0, 0);
  }
  return w;
}

/** 1 级台阶世界：row 69 在 x∈[40,50] 抬一级（E3 同几何,sw-fx34 域E） */
function stepWorld(): World {
  const w = flatWorld();
  for (let x = 40; x <= 50; x++) w.store.setTileSilent(x, 69, STONE_ID, 0, 0);
  return w;
}

const mkBody = (w: World, over: Partial<Body>): Body => ({
  x: 40 * TILE - 20, y: 70 * TILE - 42, w: 20, h: 42, vx: 3, vy: GRAVITY,
  onGround: false, hitWall: false, hitHead: false,
  stepUp: true, stepUpHolds: false, stepDownGate: 'gravity',
  ...over,
});

// ═══ FX40-h1：StepUp 正挂速度门（Player.cs:28276）═══
describe('SW-RB14d A：StepUp 正挂门=(∨毯展开)∧vy≥gravity 字段（:28276;旧消费者恒 vy>=0）', () => {
  it('A1 源锁：消费者三态门 + 玩家侧两腿承载位（★BJ704-G12 债7：毯腿承载升级 carpetFlying 单一真源）', () => {
    const s = SRC('physics/TileCollision.ts');
    expect(s).toContain('b.stepUpCarpet === true || b.vy >= (b.stepUpVeloFloor ?? 0)');
    expect(s).not.toContain('} else if (b.vy >= 0) {');   // 旧恒 vy>=0 门退役
    const p = SRC('entities/Player.ts');
    // ★BJ704-G12（G5 登记债7）：carpetTime>0∧inputJump 近似（外门拒拍/余油末拍偏宽）
    // → carpetFlying（≙ carpetFrame!=-1 本拍在展开,G5 R4-P2② 单一真源）
    expect(p).toContain('this.stepUpCarpet = this.carpetFlying;');
    expect(p).not.toContain('this.stepUpCarpet = this.carpetTime > 0 && this.inputJump;');
    expect(p).toContain('this.stepUpVeloFloor = this.gField;');
  });
  it('A2 [0,g) 窗不再上探：水行/悬停 vy=0 → 不踏（旧 vy>=0 门踏=变异红）', () => {
    const w = stepWorld();
    const b = mkBody(w, { vy: 0, stepUpVeloFloor: GRAVITY });
    moveAndCollide(b, w, 0, 0);
    expect(b.y).toBe(70 * TILE - 42);          // 旧门退化值=69*TILE-42（空中踏步）
  });
  it('A3 贴地 vy=gField 过门：上台阶照旧（恒等面回归锁）', () => {
    const w = stepWorld();
    const b = mkBody(w, { vy: GRAVITY, stepUpVeloFloor: GRAVITY });
    moveAndCollide(b, w, 0, 0);
    expect(b.y).toBe(69 * TILE - 42);
  });
  it('A4 毯展开腿：飞毯缓降 vy=-0.4 + stepUpCarpet → 上探（旧门 vy<0 拦=变异红）', () => {
    const w = stepWorld();
    const b = mkBody(w, { vy: -GRAVITY, stepUpVeloFloor: GRAVITY, stepUpCarpet: true });
    moveAndCollide(b, w, 0, 0);
    expect(b.y).toBe(69 * TILE - 42);
  });
  it('A5 NPC 族缺省面逐位不变：无 stepUpVeloFloor 回退 0 门（vy>=0 字面）', () => {
    const w = stepWorld();
    const b = mkBody(w, { vy: GRAVITY });
    delete (b as Partial<Body>).gField;
    delete (b as Partial<Body>).stepUpCarpet;
    delete (b as Partial<Body>).stepUpVeloFloor;
    moveAndCollide(b, w, 0, 0);
    expect(b.y).toBe(69 * TILE - 42);          // 缩水带外 vy=0.4 仍过 0 门=旧行为
  });
  it('A6 缩水带阈=gField：太空带 vy=0.1+gField=0.1 过门（阈值非 0=门活）', () => {
    const w = stepWorld();
    const b = mkBody(w, { vy: 0.1, stepUpVeloFloor: 0.1 });
    moveAndCollide(b, w, 0, 0);
    expect(b.y).toBe(69 * TILE - 42);
  });
});

// ═══ FX40-b：maxFallSpeed 字段终值 +0.01（:24555 复位 10 → :24637 无条件加 0.01）═══
describe('SW-RB14d B：玩家落速字段终值 10.01（:24637;湿档 3/7/6/2 同过 +0.01 闸）', () => {
  it('B1 常量：PLAYER_MAX_FALL_SPEED=10.01;NPC 共用面 MAX_FALL_SPEED 保持 10', () => {
    expect(PLAYER_MAX_FALL_SPEED).toBe(10.01);
    expect(MAX_FALL_SPEED).toBe(10);
  });
  it('B2 源锁：玩家干/湿钳位全部换读字段终值;湿档四档 3.01/7.01/6.01/2.01', () => {
    const p = SRC('entities/Player.ts');
    expect(p).toContain('lMaxFall = 3.01');
    expect(p).toContain('lMaxFall = 7.01');
    // ★X2 重锚（2026-10-01）:BJ260-F1（b21333f4,2026-09-22）湿链残项 S6——原版序
    //  =液体档覆写先于 UpdateJumpHeight 尾段（jumpBoost 钳 max 6.51 + jumpSpeed
    //  加成 :19717-19720/:19745）,单行平值形态拆两段=湿态蛙腿/徽章加成不再整丢
    expect(p).toContain('lMaxFall = 6.01');
    expect(p).toContain('lJSpd = Math.max(5.51, eqM.jumpBoost ? 6.51 : 0) + eqM.jumpSpd; lJT = 25;');
    expect(p).toContain('lMaxFall = 2.01');
    expect(p).not.toContain('lMaxFall = 5;');          // 水档旧值退役
    // 干链钳位（行为面 = sw-fx40 域B B1-B3 已换算 PLAYER_MAX_FALL_SPEED）
    expect(p).toContain('Math.min(this.vy + grav, PLAYER_MAX_FALL_SPEED)');
  });
});

// ═══ FX37：painted 登记面自愈契约 + selectRow 实时性 + 重建清选中 ═══
describe('SW-RB14d D：图鉴登记面/选中面（FX37 F1/F2/F3/F4/F5/F7/F8）', () => {
  const row = (creditId: string, npcId: number, state: UnlockState): BestiaryRow => {
    const entry = bestiaryEntries().find((e) => e.creditId === creditId) ?? {
      id: 0, creditId, kind: 'enemy' as const, sources: [], goldGate: false,
    };
    return { entry, entryId: entry.id, npcId, state, name: 'x', kills: 0 };
  };
  it('D1 sweep 反查 first-wins（≡旧 working.find;旧 Map last-wins=变异红）', () => {
    const rows = [row('Zombie', 3, UnlockState.Stats), row('Zombie', 4, UnlockState.Stats)];
    const c = {};
    const targets = bestiarySweepTargets([{ canvas: c, creditId: 'Zombie' }], rows, new WeakSet());
    expect(targets).toHaveLength(1);
    expect(targets[0].npcId).toBe(3);          // 旧实现退化值=4（Map 直 set 尾胜）
  });
  it('D2 源锁：bg 半画格不再登记 painted（登记权移交终端落笔点）', () => {
    const s = SRC('ui/BestiaryPanel.ts');
    expect(s).not.toContain('if (bgImg || ovs.length) this.painted.add(canvas);');
    expect(s).toContain('登记权移交终端落笔点');
  });
  it('D3 源锁：contextlost 除名登记面（restore 永不来时 sweep 仍可重试）', () => {
    const s = SRC('ui/BestiaryPanel.ts');
    expect(s).toContain("e.preventDefault(); this.painted.delete(canvas); });");
    expect(s).not.toContain("addEventListener('contextlost', (e) => e.preventDefault());");
  });
  it('D4 源锁：丢_context_期不登记（绘制静默 no-op 时 painted 不收）', () => {
    const s = SRC('ui/BestiaryPanel.ts');
    expect(s).toContain("if (!(cx.isContextLost && cx.isContextLost())) this.painted.add(canvas);");
  });
  it('D5 源锁：landOnce 终结一次（bitmap 重试成功二次 land=α<255 变体加深重影）', () => {
    const s = SRC('ui/BestiaryPanel.ts');
    expect(s).toContain('    let landed = false;');
    expect(s).toContain('      if (landed) return;');
  });
  it('D6 源锁：selectRow 按 creditId 从 tracker 现取行（击杀/解锁推进后点击不显旧态）', () => {
    const s = SRC('ui/BestiaryPanel.ts');
    expect(s).toContain('bestiaryRows(this.flow.getTracker()).find((w) => w.entry.creditId === r.entry.creditId) ?? r');
  });
  it('D7 源锁：选中持久视觉拆除（★BJ506 定谳：原版 _selectedEntryButton 写后不读、网格无选中视觉——RB14d F4"全格标记"面随 .sel 外描一并退役；改锁无选中面 + 选中只填详情栏）', () => {
    const s = SRC('ui/BestiaryPanel.ts');
    expect(s).not.toContain('.sw-bst-cell.sel');
    expect(s).toContain('private selectRow(r: BestiaryRow): void');
    expect(s).toContain('this.selected = fresh;');
  });
  it('D8 源锁：重建即清选中（FillBestiarySpaceWithEntries→DeselectEntryButton :340-347；★BJ506 重排后锚=refreshNow 头部序词复位——selectSeq>seq 的排队后选中保留）', () => {
    const s = SRC('ui/BestiaryPanel.ts');
    const refreshNow = s.slice(s.indexOf('private refreshNow(seq'), s.indexOf('private progressPercent()'));
    expect(refreshNow).toContain('this.selected = this.selectSeq > seq ? this.selected : null;');
  });
});

// ═══ FX38：滚轮归一/累计量化/重建追焦/vui 方向 ═══
describe('SW-RB14d E：合成滚距（FX38 F1/F2/F3/F6）', () => {
  it('E1 deltaMode 归一：Firefox 行模式 ±3 行/notch → 40px/行（旧 ±1 行当 1 notch=3× 过计）', () => {
    expect(wheelEventPx(-3, 1)).toBe(-120);          // 1 notch（鼠标一格）
    expect(wheelEventPx(-1, 1)).toBe(-40);           // 亚 notch
    expect(wheelEventPx(-240, 0)).toBe(-240);        // 像素模式直通
    expect(wheelEventPx(-1, 2)).toBe(-120);          // 页模式近似
  });
  it('E2 行模式整类不再吞零：（−3,1）→1 档（旧调用点缺 deltaMode → trunc(3/120)=0=变异红）', () => {
    expect(vanillaWheelNotches(-3, 1)).toBe(1);
    expect(vanillaWheelNotches(-1, 1)).toBe(0);      // 亚 notch 仍吞（C# 整除同相）
    expect(vanillaWheelNotches(-120, 0)).toBe(1);
    expect(vanillaWheelNotches(120, 0)).toBe(-1);
    expect(vanillaWheelNotches(-240, 0)).toBe(2);
    expect(vanillaWheelNotches(-119, 0)).toBe(0);
  });
  it('E3 余数累计器代数：两拍 −60 累计 −120 → 1 档（旧逐事件 trunc 双零=变异红）', () => {
    // 原版 ScrollWheelValue 跨事件累计(:1407 +=)、帧差分 /120(:901-902) ⇒
    // 同构:pend 累计、整档消费、余数留置
    let pend = 0;
    pend += wheelEventPx(-60, 0);
    let num = vanillaWheelNotches(pend);
    expect(num).toBe(0);                              // 首拍子档吞
    pend += num * 120;
    pend += wheelEventPx(-60, 0);
    num = vanillaWheelNotches(pend);
    expect(num).toBe(1);                              // 累计达 1 档
    pend += num * 120;
    expect(pend).toBe(0);                             // 余数留置归零
  });
  it('E4 源锁：列表滚轮走累计器 + 三调用点补传 deltaMode + 重建追焦/vui 取负', () => {
    const s = SRC('ui/UI.ts');
    expect(s).toContain('this.vinvCraftWheelPendPx += wheelEventPx(e.deltaY, e.deltaMode);');
    expect(s).toContain('const num = vanillaWheelNotches(this.vinvCraftWheelPendPx);');
    expect(s).toContain('this.vinvCraftWheelPendPx += num * 120;');   // 整档消费余数留置
    expect(s).not.toContain('vanillaWheelNotches(e.deltaY);');        // 旧单参调用退役
    expect(s).toContain('const idx = avail.findIndex((p2) => p2.r === oldRecipe);');
    expect(s).toContain('this.vinvCraftFocusV = nextFocus;');         // 直写（glideY 不动=VisuallyReposition 语义）
    expect(s).toContain('this.vinvCraftWheelPendPx = 0;');            // teardown 清零
    const vui = SRC('vui/VUI.ts');
    expect(vui).toContain('VUI.wheel += -Math.sign(e.deltaY);');      // 上滚=+1（原版向顶）
  });
  it('E5 吸附/行界音纯函数恒等（回归锁:FX38 本刀面未被本批扰动）', () => {
    expect(craftSnapEase(-100)).toBeCloseTo(-97 + 6.5, 9);
    expect(craftSnapEase(-6)).toBe(0);                // |−5.82|≤6.5 → 0
    expect(craftSnapCrossedRow(0, -64)).toBe(false);
    expect(craftSnapCrossedRow(0, -65)).toBe(true);
  });
});
