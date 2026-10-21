// ★BJ699（2026-10-20 用户实报「跳跃时角色贴图还是站立态」）判别锁。
//  定谳：落地毯复位误读——原版 Player.cs:26299-26311 `if (!carpet) canCarpet=false;
//  else if (vy==0||sliding) { canCarpet=true; carpetTime=0; }` 是【清零】非回满,且带
//  飞毯配饰门。旧写（干支 :7470/湿支 :6974 两处,2026-08-16 水体批引入）
//  `canCarpet=true; carpetTime=300` 无门无清零 → 无毯玩家落地燃料恒满,腾空即被
//  帧链（Renderer playerFrameRows `!onGround && carpetTime>0` → 身行6毯姿+腿行0
//  毯钉腿）判为飞毯滑翔=「跳跃贴图站立」真身（探针 _bj699-jump-frame:修前空中
//  行(6,0)/修后(5,5)）。2026-08-16 当时只在帧消费门补 airborne（打补丁未除根）。
//  ★变异自证：M1 回 `canCarpet=true;carpetTime=300` → §1/§2 恰红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');

describe('§1 落地毯复位（原版 :26299-26311;M1 位）', () => {
  it('公共位：配饰门 + carpetTime 清 0 + vy==0∨sliding 域（BJ704-G5 扩域后形）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'Player.ts'), 'utf8');
    // ★BJ704-G5（R4-P2①）：复位迁至 fixedUpdate 头部公共位（每拍门,域=vy==0∨wallCling）
    expect(src).toContain('if (!eqM.carpet) this.canCarpet = false;');
    expect(src).toContain('else if (this.vy === 0 || this.wallCling) { this.canCarpet = true; this.carpetTime = 0; }');
    // 旧形（回满 300 无门）零残留
    expect(src).not.toContain('this.canCarpet = true;        // :26173');
    expect(src).not.toMatch(/canCarpet = true;\s*\n\s*this\.carpetTime = 300;/);
  });
  it('反编译锚：!carpet→canCarpet=false;vy==0||sliding→canCarpet=true+carpetTime=0', () => {
    const van = readFileSync(join(VAN, 'Terraria', 'Player.cs'), 'utf8');
    const i = van.indexOf('if (!carpet)');
    expect(i).toBeGreaterThan(-1);
    const block = van.slice(i, i + 500);
    expect(block).toContain('canCarpet = false;');
    expect(block).toContain('else if (velocity.Y == 0f || sliding)');
    expect(block).toContain('canCarpet = true;');
    expect(block).toContain('carpetTime = 0;');
  });
  it('激活面不动锚：燃料 300 只在激活拍授予（CarpetMovement :22030）', () => {
    const src = readFileSync(join(GAME, 'src', 'entities', 'Player.ts'), 'utf8');
    // 两处激活位（干/湿）保留 canCarpet=false + carpetTime=300
    expect((src.match(/this\.canCarpet = false; this\.carpetTime = 300;/g) ?? []).length).toBe(2);
    const van = readFileSync(join(VAN, 'Terraria', 'Player.cs'), 'utf8');
    const j = van.indexOf('if (controlJump && canCarpet)');
    expect(j).toBeGreaterThan(-1);
    expect(van.slice(j, j + 120)).toContain('carpetTime = 300;');
  });
});

describe('§2 帧行消费链（Renderer playerFrameRows 毯门语义）', () => {
  it('毯门在位：carpetFlying（本拍在展开）→ 腿 0 / 身 6（BJ704-G5 余油窗退役后形）', () => {
    const src = readFileSync(join(GAME, 'src', 'render', 'Renderer.ts'), 'utf8');
    // ★BJ704-G5（R4-P2②）：门=本拍在展开（≙ carpetFrame>=0）,非余油 carpetTime>0
    expect(src).toContain('if (p.carpetFlying) legs = 0;');
    // ★BJ704-G19 迁移：沙暴臂改读 sandStormVisual（jump 窗口∧上升——原版 :36838-36840
    //   读 sandStorm 字段;旧 performingJump 键控含下落段）
    expect(src).toContain('p.sandStormVisual || p.carpetFlying) body = 6');
  });
  it('反编译锚：原版毯腿钉 0（:36570-36576 carpetFrame>=0）与毯身行 6（:36839 sandStorm‖carpetFrame>=0）', () => {
    const van = readFileSync(join(VAN, 'Terraria', 'Player.cs'), 'utf8');
    // 腿链：carpetFrame>=0 → legFrame.Y=0（:36570-36576;本仓以 carpetTime>0∧inputJump
    // 为 carpetFrame!=-1 的等价承载——见 Player.ts :8007 注,carpetFrame 字段不建模）
    const i = van.indexOf('if (carpetFrame >= 0)');
    expect(i).toBeGreaterThan(-1);
    expect(van.slice(i, i + 200)).toContain('reference4.Y = 0');
    // 身链：sandStorm ‖ carpetFrame>=0 → bodyFrame.Y = 6（:36838-36841）
    const j = van.indexOf('else if (sandStorm || carpetFrame >= 0)');
    expect(j).toBeGreaterThan(-1);
    expect(van.slice(j, j + 120)).toContain('bodyFrame.Y = bodyFrame.Height * 6');
  });
});
