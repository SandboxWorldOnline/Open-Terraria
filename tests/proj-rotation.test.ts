// 弹幕旋转模式回归(PROJ_ROT_RIGHT):贴图朝右族不得回落到默认 +π/2
// (用户报"食人鱼枪的鱼要转 90 度"——根因 = 通用绘制恒 +π/2)
// 数据锚:scripts/_projrot-audit.mjs 扫 AI_001 type 链 + 各 AI 的 rotation 赋值
import { describe, it, expect } from 'vitest';
import { PROJ_ROT_RIGHT, PROJ_ROT_DIAG, PROJ_ROT_DIAG_0P785, PROJ_ROT_DIAG_PI4, PROJ_NO_ROT, PROJ_ROT_ASIS } from '../src/entities/Arrow';
import { Arrow } from '../src/entities/Arrow';

describe('PROJ_ROT_RIGHT 朝右贴图族(原版 rotation=ToRotation,非 +π/2)', () => {
  it('食人鱼 190(1156 食人鱼枪,aiStyle 39 :26122-26140 模式)', () => {
    expect(PROJ_ROT_RIGHT.has(190)).toBe(true);
  });

  it('魔法飞弹 16(113,AI_009 :54039)/ Flamelash 34(218,八帧行)', () => {
    expect(PROJ_ROT_RIGHT.has(16)).toBe(true);
    expect(PROJ_ROT_RIGHT.has(34)).toBe(true);
  });

  it('837(AI_001 显式 MIRROR :54715)/ 1023(仅 wiggle 基姿态 0)', () => {
    expect(PROJ_ROT_RIGHT.has(837)).toBe(true);
    expect(PROJ_ROT_RIGHT.has(1023)).toBe(true);
  });

  it('默认族不入表:箭 1/子弹 14(AI_001 默认 +π/2 :54877)', () => {
    expect(PROJ_ROT_RIGHT.has(1)).toBe(false);
    expect(PROJ_ROT_RIGHT.has(14)).toBe(false);
  });
});

describe('PROJ_ROT_DIAG 剑气族(aiStyle 27,rotation=atan2+0.785f 即 +45°,:26909-26911)', () => {
  // 用户报"附魔剑光束角度偏"——曾走默认 +π/2 恒偏 45°
  // ★BJ704-G11（件4）：字面拆集——aiStyle27 族字面 0.785f（非 π/4,残差 0.0004rad
  //  旧断言 π/4 系共用集近似,随拆集重铸）
  it('成员表:114/115/116/132/156/173 全落 0P785 集;660/451 落 PI4 集;并集=旧 DIAG', () => {
    for (const id of [114, 115, 116, 132, 156, 173]) {
      expect(PROJ_ROT_DIAG_0P785.has(id), `proj ${id}`).toBe(true);
      expect(PROJ_ROT_DIAG_PI4.has(id), `proj ${id}`).toBe(false);
    }
    for (const id of [660, 451]) {
      expect(PROJ_ROT_DIAG_PI4.has(id), `proj ${id}`).toBe(true);
      expect(PROJ_ROT_DIAG_0P785.has(id), `proj ${id}`).toBe(false);
    }
    expect([...PROJ_ROT_DIAG].sort((a, b) => a - b)).toEqual([114, 115, 116, 132, 156, 173, 451, 660]);
    expect(PROJ_ROT_RIGHT.has(173)).toBe(false);   // 不在朝右表
  });

  it('173 水平飞行 → 绘制旋转 = 0.785（速度角 0 + 原文字面 0.785f,G11 重铸）', () => {
    const a = new Arrow(0, 0, 9.5, 0, 23, 4.25, 173, { grav: 0 });
    const rotate: number[] = [];
    const ctx = {
      save() {}, restore() {}, translate() {}, rotate(r: number) { rotate.push(r); },
      scale() {}, drawImage() {}, fillRect() {}, strokeRect() {},
      set imageSmoothingEnabled(_: boolean) {}, set fillStyle(_: string) {},
      set strokeStyle(_: string) {}, set globalAlpha(_: number) {}, set lineWidth(_: number) {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    } as unknown as CanvasRenderingContext2D;
    a.draw({ ctx } as never, {} as never);
    expect(rotate).toHaveLength(1);
    expect(rotate[0]).toBeCloseTo(0.785, 5);   // 原文字面 0.785f（:26910-26911,≠π/4）
    expect(rotate[0]).not.toBeCloseTo(Math.PI / 4, 5);
  });
  it('660 水平飞行 → 绘制旋转 = π/4（:58632-58634 MathF.PI/4f 字面支）', () => {
    const a = new Arrow(0, 0, 9.5, 0, 23, 4.25, 660, { grav: 0 });
    const rotate: number[] = [];
    const ctx = {
      save() {}, restore() {}, translate() {}, rotate(r: number) { rotate.push(r); },
      scale() {}, drawImage() {}, fillRect() {}, strokeRect() {},
      set imageSmoothingEnabled(_: boolean) {}, set fillStyle(_: string) {},
      set strokeStyle(_: string) {}, set globalAlpha(_: number) {}, set lineWidth(_: number) {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    } as unknown as CanvasRenderingContext2D;
    a.draw({ ctx } as never, {} as never);
    expect(rotate).toHaveLength(1);
    expect(rotate[0]).toBeCloseTo(Math.PI / 4, 5);
  });
});

describe('武器弹幕旋转全审计（AI_001 异常分支 ∩ 武器可达，2026-08-17 复查批）', () => {
  // ★R27 勘误（红队 R27 §1 P1）：宝石法杖弹 121-126/597 曾被断言"恒直立"——原注释引
  // "aiStyle 29 全链 :24994-25207 零 rotation 赋值"与源码不符，AI_029_GemStaffs_
  // ActuallyGemStaffs 尾部显式 rotation = velocity.ToRotation()（1457:38644/1458:38691）
  // ——已移出 NO_ROT，走默认 atan2 对齐速度角
  it('R27：宝石法杖弹 121-126/597 移出 NO_ROT（rotation=velocity.ToRotation(),:38691）', () => {
    for (const id of [121, 122, 123, 124, 125, 126, 597]) {
      expect(PROJ_NO_ROT.has(id), `proj ${id}`).toBe(false);
    }
    // 留表项：521 水晶脉冲（同函数尾行也应旋转,消费面未核对,登记）/79 由 MissileProj 绘制
    expect(PROJ_NO_ROT.has(521)).toBe(true);
    expect(PROJ_NO_ROT.has(79)).toBe(true);
  });

  it('121 宝石珠水平飞行 → 绘制旋转 = 0（速度向摆放,非 +π/2）', () => {
    expect(PROJ_ROT_ASIS.has(121)).toBe(true);
    const a = new Arrow(0, 0, 8, 0, 10, 1, 121, { grav: 0 });
    const rotate: number[] = [];
    const ctx = {
      save() {}, restore() {}, translate() {}, rotate(r: number) { rotate.push(r); },
      scale() {}, drawImage() {}, fillRect() {}, strokeRect() {},
      set imageSmoothingEnabled(_: boolean) {}, set fillStyle(_: string) {},
      set strokeStyle(_: string) {}, set globalAlpha(_: number) {}, set lineWidth(_: number) {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    } as unknown as CanvasRenderingContext2D;
    a.draw({ ctx } as never, {} as never);
    expect(rotate).toHaveLength(1);
    expect(rotate[0]).toBeCloseTo(Math.atan2(0, 8), 5);   // = 0（速度角本身）
  });

  it('660 天穹碎裂 → DIAG(+45°)；485 地狱之翼 → RIGHT(朝右+flip)', () => {
    expect(PROJ_ROT_DIAG.has(660)).toBe(true);
    expect(PROJ_ROT_RIGHT.has(485)).toBe(true);
  });

  it('312 南瓜灯恒旋：两 tick spinRot = 2×vx×0.02，绘制不对齐速度', () => {
    const a = new Arrow(0, 0, 10, 0, 10, 2, 312, { grav: 0 });
    const hooks = {
      world: {
        store: {
          inBounds: () => true, get: () => 0, isSolid: () => false,
          w: 100, h: 100, liquid: new Uint8Array(1), liquidType: new Uint8Array(1),
          // 湿段预置全体化(2026-09-04)后首拍走 WetCollision/LavaCollision——补最小面
          idx: () => 0, flags: new Uint8Array(1), slope: new Uint8Array(1),
        },
      },
      enemies: () => [], critters: () => [], spawnDrop: () => null,
      addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {},
      spawnParticles: () => {}, playSfx: () => {}, playSfxFiles: () => {},
      damagePlayer: (): number => 0, notifyInventoryChanged: () => {}, showPickupLabel: () => {},
      spawnEnemy: () => {},
    } as never;
    a.fixedUpdate(1, hooks);
    const r1 = a.spinRot;
    a.fixedUpdate(1, hooks);
    expect(r1).toBeCloseTo(0.2, 6);
    expect(a.spinRot).toBeCloseTo(0.4, 6);
  });
});
