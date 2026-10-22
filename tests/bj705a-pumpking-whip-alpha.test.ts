// ★BJ705-A（2026-10-22）：南瓜王(327)被暗黑收割者(4680)抽打后「头部变透明」——
// 用户实报定谳锁（小概率事件,探针自然复现不可依赖,以机制面钉值）。
//
// 定谳链（完整证据链见 src/assets/SpriteAtlas.ts schedulePreloadRescan 注）：
//  · 病灶=资产窗假体：Renderer.drawEnemy 中 327 披风(PumpkingCloak)/328 双刃
//    (PumpkingArm)等部件贴图独立加载、先于本体 if (r) 判空绘制；NPC_{id} 主表
//    虽经 BJ636 前置到进世界门槛,但门槛期 preloadFiles 失败【静默】（发布形态
//    prune-dist 删光散件,SW 空窗/缺件期 fetch 恒 404,内置 800ms 单发重试不够
//    穿窗）→ 失败件只能等【首绘消费】才走 ensureVImage 10s TTL 重试。南瓜王
//    这类波次 boss 进世界后数分钟才首见：门槛窗失败的主表整个前中期无人重试,
//    首见拍恰在战斗接触（=用户「抽打后」的观察位）,本体 if (r) 跳画而部件照画
//    =「头部变透明」。前案身份=BJ636（2026-10-11 线上实报"一进游戏所有怪物透明,
//    刷新重进自愈"——同根 vnpc 判空跳画,修=主表全集前置预载）;BJ532（鸟妖间歇
//    透明,accFail 弃队窗）为另一前案族（GL 批丢,本案权排后:病灶实体仍整帧渲染）。
//  · 判别锁探针 scripts/_bj705a-nullwindow.mjs（工作区实跑）：强制
//    NPC_327.png 失败窗（vimages 驱逐+_vImageFailed 标记）后,头区 orange
//    1554→240（−85%,cloak/双刃照常渲染）——「头没了、其余在」逐帧复现。
//    自然复现三探针（minimal/horde-stress/dist-0.1.63）全绿=本地服务无 SW/CDN
//    空窗,与「小概率」自洽（触发面=发布形态资产域）。
//  · 本刀（最小刀,「宁回退不丢精灵」律下不做部件门控）：
//    ①部件散件入 VANILLA_MISC 预载（BJ636 的部件漏员收口：Arm_Bone/Arm_Bone_3/
//      PumpkingCloak/PumpkingArm）;
//    ②preloadMiscAndNpcs 挂失败件限时回扫（10s 节拍×60 轮,把主表失败件的重试
//      从「首绘」提前到「进世界后立刻」——南瓜王首见前已有分钟级自愈窗）。
//  · 登记债：①残余窗内部件/本体不对称假体仍可见（门控会丢更多精灵且 boss 整体
//    隐形比缺头更不可打,不落）;②散件恒 404 根因在 SW/CDN 资产域（部署面）,
//    回扫只缩短暴露窗;③若复现,录 [SpriteAtlas] BJ705-A warn 行 + accDiag。
//  变异证红：
//   M1 VANILLA_MISC 摘 PumpkingCloak.png → ①红
//   M2 preloadMiscAndNpcs 摘 .then(schedulePreloadRescan) → ③红
//   M3 回扫摘 rounds 上限 → ②(b)红（warn 不发+循环不收口）
//   M4 回扫 miss 过滤改全量 files → ②(a)红（每轮重发已就绪件=风暴面回归）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VANILLA_MISC, SpriteAtlas } from '../src/assets/SpriteAtlas';

const HERE = dirname(fileURLToPath(import.meta.url));
const atlasSrc = readFileSync(join(HERE, '..', 'src', 'assets', 'SpriteAtlas.ts'), 'utf8');

describe('① 判别锁:部件散件入 VANILLA_MISC（M1 证红面;BJ636 部件漏员收口）', () => {
  it('南瓜王/骷髅王部件四散件在预载清单（Arm_Bone/Arm_Bone_3/PumpkingCloak/PumpkingArm）', () => {
    for (const f of ['vanilla/Arm_Bone.png', 'vanilla/Arm_Bone_3.png',
      'vanilla/PumpkingCloak.png', 'vanilla/PumpkingArm.png']) {
      expect(VANILLA_MISC).toContain(f);   // 摘任一件=红（部件回到首见懒加载窗）
    }
  });
  it('散件在盘上真实存在（防清单指向空文件=预载恒失败）', () => {
    for (const f of ['Arm_Bone.png', 'Arm_Bone_3.png', 'PumpkingCloak.png', 'PumpkingArm.png']) {
      const buf = readFileSync(join(HERE, '..', 'public', 'sprites', 'vanilla', f));
      expect(buf.readUInt32BE(0)).toBe(0x89504e47 >>> 0);   // PNG 签名
    }
  });
});

describe('② 回扫行为锁（preloadMiscAndNpcs → schedulePreloadRescan;M3/M4 证红面）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { Image?: unknown }).Image = class { src = ''; };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { Image?: unknown }).Image;
    vi.restoreAllMocks();
  });

  const mkAtlas = (preloadImpl: (files: string[]) => Promise<void>) => {
    const at = new SpriteAtlas();
    const calls: string[][] = [];
    vi.spyOn(at, 'preloadFiles').mockImplementation((files: Iterable<string>) => {
      const list = [...files];
      calls.push(list);
      return preloadImpl(list);
    });
    return { at, calls };
  };

  it('(a) 每轮只重发未就绪件（miss 过滤）;第 3 轮落地后自清定时器（零风暴增量+自愈收口）', async () => {
    const { at, calls } = mkAtlas(async (list) => {
      // 回扫第 3 轮（=第 4 次 preloadFiles 调用,含初载）全部落地
      if (calls.length >= 4) for (const f of list) at.vimages.set(f, {} as never);
    });
    await at.preloadMiscAndNpcs();
    expect(calls.length).toBe(1);                       // 初载一发
    const first = calls[0];
    expect(first).toContain('vanilla/NPC_327.png');     // ★南瓜王主表在预载面（BJ636 成员锚）
    expect(first).toContain('vanilla/PumpkingCloak.png');
    await vi.advanceTimersByTimeAsync(10_000);          // 回扫轮 1:全量 miss
    await vi.advanceTimersByTimeAsync(10_000);          // 回扫轮 2:仍 miss
    await vi.advanceTimersByTimeAsync(10_000);          // 回扫轮 3:落地（await 后入表）
    await vi.advanceTimersByTimeAsync(10_000);          // 回扫轮 4:miss 空 → 自清（无第 5 次调用）
    expect((at as unknown as { _preloadRescan: unknown })._preloadRescan).toBeUndefined();
    expect(calls.length).toBe(4);                       // 初载 + 回扫 1..3;落地轮后再无调用
    for (let i = 1; i < 4; i++) expect(calls[i].length).toBe(first.length);   // 全 miss 期等量
    expect(calls[3]).toEqual(first);                    // 第 3 轮仍是全量（落地发生在 await 后）
  });

  it('(b) 60 轮上限后 warn 一发收口（M3:摘上限=warn 不发且循环不收口）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { at } = mkAtlas(async () => { /* 永不落地（资产域恒 404 档） */ });
    await at.preloadMiscAndNpcs();
    for (let i = 0; i < 59; i++) await vi.advanceTimersByTimeAsync(10_000);
    expect(warn).not.toHaveBeenCalled();               // 59 轮内不吵
    await vi.advanceTimersByTimeAsync(10_000);          // 第 60 轮 → 收口
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toContain('BJ705-A');
    expect((at as unknown as { _preloadRescan: unknown })._preloadRescan).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);          // 收口后不再有第 61 轮
  }, 20_000);

  it('(c) 回扫节拍=10s（与 ensureVImage 失败 TTL 同率;改 1s=风暴面回归在此红）', async () => {
    const { at, calls } = mkAtlas(async () => {});
    await at.preloadMiscAndNpcs();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls.length).toBe(1);                      // 10s 内无第二轮
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);               // 让 interval 回调的微任务走完
    expect(calls.length).toBe(2);
  });
});

describe('③ 结构锁:预载→回扫链在位（M2 证红面）', () => {
  it('preloadMiscAndNpcs 以 .then 挂 schedulePreloadRescan（摘链=失败件回到首绘重试）', () => {
    expect(atlasSrc).toMatch(
      /preloadFiles\(files\)\.then\(\(\) => this\.schedulePreloadRescan\(files\)\)/,
    );
  });
  it('回扫三要素在位：10s 节拍 / 60 轮上限 / warn 收口行', () => {
    expect(atlasSrc).toContain('setInterval(() => { void tick(); }, 10_000)');
    expect(atlasSrc).toMatch(/rounds >= 60/);
    expect(atlasSrc).toContain('BJ705-A 预载回扫');
  });
  it('病灶面备案锚:drawEnemy 部件先于本体 if (r)（现状结构——不对称假体的宿主,改动须过本刀判语）', () => {
    const r = readFileSync(join(HERE, '..', 'src', 'render', 'Renderer.ts'), 'utf8');
    const cloakIdx = r.indexOf('if (e.vanillaId === 327) this.drawPumpkingCloak(e);');
    const rIdx = r.indexOf('const r = this.atlas.vnpc(drawId, frameIdx);');
    expect(cloakIdx).toBeGreaterThan(0);
    expect(rIdx).toBeGreaterThan(cloakIdx);   // 披风先于本体判空=假体结构在案（登记债①）
  });
});
