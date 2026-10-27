// BJ732-A 玩家受伤音效「男/女形象播了其他声」三重分歧清偿（2026-10-27 用户报）：
//   ①新建初始外观 randomAppearance()（含 50%→voiceVariant=3,原版 Click_RandomizePlayer
//     :1571-1575 仅骰子钮掷）→ 每个新号一半概率出生即「其他」声
//   ②体型切换无语音 1↔2 自动跟随（原版 UpdateSelectedGender :1312-1330）
//   ③切换后无语音试听（原版 PlayVoicePreview :1518-1528）
// 原版定谳锚（亲读 Terarria1457）：
//   新建 = UICharacterSelect.cs:111 `new Player()` → Player() 构造器 :56702
//   skinVariant=0/hair=0/voiceVariant=1 男声/默认色板 = 固定默认,绝非随机。
// 锁面：纯函数四相/新建初始结构锁/骰子行为锁（原版 1:1 防误「修」）/试听接线锁/变异恰红。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoSwitchVoiceOnGenderFlip, hurtVoicePlan } from '../src/player/PlayerVoice';
import { defaultAppearance, randomAppearance, MALE_VARIANTS } from '../src/player/Appearance';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');
const CC = () => SRC('ui/CharCreation.ts');

afterEach(() => vi.restoreAllMocks());

describe('BJ732-A ① 新建初始=固定默认（原版 new Player() 同构）', () => {
  it('defaultAppearance:skinVariant=0 男/voiceVariant 未预填（消费侧按性别推导男声）', () => {
    const a = defaultAppearance('t');
    expect(a.skinVariant).toBe(0);
    expect(a.voiceVariant).toBeUndefined();
    // 推导面:男形象 → 男声文件
    const plan = hurtVoicePlan({ skinVariant: 0, voiceVariant: a.voiceVariant });
    expect(plan.files).toEqual(['Player_Hit_0', 'Player_Hit_1', 'Player_Hit_2']);
  });

  it('结构锁:构造器新建路径走 defaultAppearance(),不再出生即随机', () => {
    expect(CC()).toContain(': defaultAppearance();');
    // 构造器三元式后不得再直接 randomAppearance()（骰子钮 handler 的调用保留）
    expect(CC()).not.toMatch(/\? \{ \.\.\.structuredClone\(opts\.initial\) \}[^:]*: randomAppearance\(\);/s);
    // 骰子随机入口仍在（显式按钮才随机）
    expect(CC()).toMatch(/randomAppearance\(this\.appearance\.name\)/);
  });
});

describe('BJ732-A ② autoSwitchVoiceOnGenderFlip（原版 UpdateSelectedGender :1312-1330 纯函数面）', () => {
  it('男→女翻转:男声 1 → 女声 2', () => {
    expect(autoSwitchVoiceOnGenderFlip(1, true, false)).toBe(2);
  });
  it('女→男翻转:女声 2 → 男声 1', () => {
    expect(autoSwitchVoiceOnGenderFlip(2, false, true)).toBe(1);
  });
  it('「其他」3 双向存活（原版 switch 无 case3 分支=显式选择不被覆写）', () => {
    expect(autoSwitchVoiceOnGenderFlip(3, true, false)).toBe(3);
    expect(autoSwitchVoiceOnGenderFlip(3, false, true)).toBe(3);
  });
  it('同性别切换 no-op;缺省(undefined)no-op(推导兜底)', () => {
    expect(autoSwitchVoiceOnGenderFlip(1, true, true)).toBe(1);
    expect(autoSwitchVoiceOnGenderFlip(2, false, false)).toBe(2);
    expect(autoSwitchVoiceOnGenderFlip(undefined, true, false)).toBeUndefined();
  });
  it('结构锁:体型按钮接线（翻转调用+tracker 更新+尾部试听,原版 :1290-1330 同序）', () => {
    const cc = CC();
    expect(cc).toContain('autoSwitchVoiceOnGenderFlip(');
    expect(cc).toContain('this.voiceAutoSwitchPrevMale = male;');
    expect(cc).toContain('this.playVoicePreview();');
    expect(cc).toMatch(/private voiceAutoSwitchPrevMale = true;/);
  });
});

describe('BJ732-A ③ 骰子随机行为锁（原版 Click_RandomizePlayer :1571-1575——1:1 保持,防误「修」）', () => {
  it('随机掷 Next(2)==0 → 「其他」3;否则按掷出体型性别 1/2（原版怪相一并锁死）', () => {
    // mock 0.999:掷中末位体型 11(女款)→ 声按【校正前】体型定女声 2;随后发型性别
    // 校正(末位发型=男款)把体型翻回男款 0——**男形象+女声**=原版 Click_RandomizePlayer
    // :1571(先定声)与 :1577+(校正只翻体型不回写声)的原生怪相,1:1 保持勿「修」。
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const a1 = randomAppearance('t');
    expect(a1.skinVariant).toBe(0);
    expect(a1.voiceVariant).toBe(2);
    // voice 50% 档 → 3
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const a2 = randomAppearance('t');
    expect(a2.voiceVariant).toBe(3);
    const plan = hurtVoicePlan({ voiceVariant: a2.voiceVariant });
    expect(plan.files).toEqual(['player_hit_default']);
  });

  it('试听单源:playVoicePreview 类方法存在且 dresser 闭包收编（防双源漂移）', () => {
    const cc = CC();
    expect(cc).toMatch(/private playVoicePreview\(\): void/);
    expect(cc).toContain('const preview = () => this.playVoicePreview();');
  });
});
