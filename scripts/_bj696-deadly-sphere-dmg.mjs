// ★BJ696 复现探针：致命球 533 召唤物零伤——单测域全绿（bj635/bj650 59 测）,须活体链取证。
//   场景:533×2 + 高血敌,泵 900t,逐 60t 采样敌 hp/533 态机(dA0 段位)/contact 计数。
//   ★v2(本刀):①maxMinions 是 getter(Player.ts:3697)→ 旧 p.maxMinions=4 静默 no-op
//   →上限 1→自裁块杀第二颗(球消失伪影)——改走 equipStats.minionSlots=3;
//   ②第二颗球 dead 写位陷阱(栈捕获);③contact 按态(dA0 桶)计数+门归因(iframes/局部
//   cd/hurt);④逐 hurt 事件流水(独立结算数判别)。
import { launchBrowser, openPage, bootstrap, createGame, pump, ledger, freezeClock } from '../tools/probe/lib/index.mjs';
import { spawnEnemy } from '../tools/probe/lib/entities.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5206';
const L = ledger();

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('世界就绪', gen.ok, JSON.stringify(gen).slice(0, 80));
await freezeClock(page, { tod: 0.345 });
await pump(page, 30);

const setup = await page.evaluate(() => {
  const g = window.__swGame;
  const p = g.player;
  p.debugGod = true;
  const st = g.world.store;
  // 空旷平地走廊
  for (let tx = 50; tx <= 90; tx++) {
    for (let ty = 0; ty < st.h; ty++) { if (st.hasTile(tx, ty)) { g.player.y = (ty - 6) * 16; break; } }
    break;
  }
  p.x = 60 * 16; p.vx = 0; p.vy = 0;
  g.camera.x = p.cx; g.camera.y = p.cy;
  return { px: p.cx, py: p.cy, minions: p.maxMinions, dmgMult: p.summonDamageMult };
});
console.log('场景:', JSON.stringify(setup));

const eMeta = await spawnEnemy(page, 3, setup.px + 160, setup.py + 40);
L.chk('敌怪生成', eMeta.ok, JSON.stringify(eMeta).slice(0, 80));

const run = await page.evaluate(async () => {
  const g = window.__swGame;
  const p = g.player;
  const { buffTypeByVanilla, BuffType } = await import('/src/stats/Buffs.ts');
  // ★BJ696v2:maxMinions 是只读 getter(1+buff+equipStats.minionSlots+modDyn,:3697)——
  // equipStats 每 tick 重算,手设被清 → 探针上限走 buff 通道(Summoning 57+Bewitched 26
  // 各 +1,:3698-3699)→ 上限 3 ≥ 两球
  p.buffs.set(BuffType.Summoning, 3600);
  p.buffs.set(BuffType.Bewitched, 3600);
  const bt = buffTypeByVanilla(161);   // 533 致命球 buff 161
  if (bt) p.buffs.set(bt, 300);
  const { MinionProj } = await import('/src/entities/MinionProj.ts');
  const spawned = [];
  for (let i = 0; i < 2; i++) {
    const m = new MinionProj(p.cx - 10, p.cy - 10, 533, 25, 4, false, 0, false, () => g.player);
    g.entities.add(m, 'projectiles');
    spawned.push(m);
  }
  let en = null;
  for (const e of g.entities.enemies) if (e.vanillaId === 3 && !e.dead) { en = e; break; }
  if (en) { en.hp = 20000; en.lifeMax = 20000; }
  let tickNow = 0;
  // ★②第二颗球 dead 写位陷阱(栈捕获→killLog)
  const killLog = [];
  for (let i = 0; i < spawned.length; i++) {
    const m = spawned[i];
    let d = m.dead;
    Object.defineProperty(m, 'dead', {
      configurable: true,
      get() { return d; },
      set(v) {
        if (v && !d) killLog.push({ i, t: tickNow, stack: (new Error().stack ?? '').split('\n').slice(1, 5).join(' | ') });
        d = v;
      },
    });
  }
  // 插桩：contact 调用计数(按 dA0 桶)+ AABB 重叠帧计数+ hurt 流水+门归因
  const proto = Object.getPrototypeOf(g.entities.projectiles.find((e) => e.projId === 533));
  const stats = { contact: 0, overlap: 0, byState: {}, hurts: [], blocked: { iframes: 0, localCd: 0, other: 0, hitCdSelf: 0 } };
  const lastHurtAt = new Map();   // en.id → 上次 hurt tick(局部 cd 归因)
  if (!proto.__bj696) {
    proto.__bj696 = true;
    const oc = proto.contact;
    proto.contact = function (gg, dmg, cdIn, pad) {
      stats.contact++;
      const st0 = this.dA0;
      const bucket = st0 <= 2 ? 'idle' : st0 <= 5 ? 'charge' : st0 <= 8 ? 'dash' : 'return';
      stats.byState[bucket] = (stats.byState[bucket] ?? 0) + 1;
      const en2 = gg.enemies().find((e) => e.vanillaId === 3 && !e.dead);
      if (en2) {
        const ov = this.x < en2.x + en2.w && this.x + this.w > en2.x && this.y < en2.y + en2.h && this.y + this.h > en2.y;
        if (ov) {
          stats.overlap++;
          const h0 = stats.hurts.length;
          const r = oc.call(this, gg, dmg, cdIn, pad);
          if (stats.hurts.length === h0) {
            if ((en2.iframes ?? 0) > 0) stats.blocked.iframes++;
            else if (tickNow - (lastHurtAt.get(en2.id) ?? -99) <= 12) stats.blocked.localCd++;
            else {
              // ★深归因:本球 hitCd 私表该敌余量(读位衰减=登记债面)>1 → hitCd 自表
              const cdv = (Number.isFinite(this.hitCd?.map?.get?.(en2.id))) ? this.hitCd.map.get(en2.id) : null;
              if (cdv !== null && cdv !== undefined && cdv > 1) stats.blocked.hitCdSelf++;
              else stats.blocked.other++;
            }
          }
        } else oc.call(this, gg, dmg, cdIn, pad);
      } else oc.call(this, gg, dmg, cdIn, pad);
    };
    const oh = Object.getPrototypeOf(g.entities.enemies[0]).hurt;
    Object.getPrototypeOf(g.entities.enemies[0]).hurt = function (dmg, ...a) {
      stats.hurts.push({ t: tickNow, dmg, hpAfter: this.hp - dmg });
      lastHurtAt.set(this.id, tickNow);
      return oh.call(this, dmg, ...a);
    };
  }
  const trace = [];
  for (let t = 0; t < 900; t++) {
    tickNow = t;
    const sp0 = g.entities.projectiles.find((e) => !e.dead && e.projId === 533);
    const pre = sp0 ? sp0.dA0 : -1;
    g.fixedUpdate(1 / 60);
    const sp = g.entities.projectiles.find((e) => !e.dead && e.projId === 533);
    en = g.entities.enemies.find((e) => e.vanillaId === 3 && !e.dead) ?? null;
    if (t % 60 === 59) {
      await wait0();
      const spheres = g.entities.projectiles.filter((e) => !e.dead && e.projId === 533);
      trace.push({
        t: t + 1, hp: en?.hp ?? null, n: spheres.length,
        states: spheres.map((s) => s.dA0),
        dist: en && spheres[0] ? Math.round(Math.hypot(en.cx - spheres[0].cx, en.cy - spheres[0].cy)) : -1,
        iframes: en?.iframes ?? null,
      });
    }
    void pre;
  }
  window.__bj696dash = [];
  function wait0() { return new Promise((r) => setTimeout(r, 0)); }
  const finalSpheres = g.entities.projectiles.filter((e) => !e.dead && e.projId === 533).length;
  return { trace, stats, killLog, finalSpheres, dmgMult: p.summonDamageMult, maxMinions: p.maxMinions };
});
console.log('\n533 态机/hp 轨迹:');
for (const s of run.trace) console.log(`  t=${s.t} hp=${s.hp} 球=${s.n} dA0=[${s.states}] dist=${s.dist} ifr=${s.iframes}`);
console.log(`  contact 调用=${run.stats.contact} 按态=${JSON.stringify(run.stats.byState)} AABB 重叠帧=${run.stats.overlap}`);
console.log(`  hurt 事件(${run.stats.hurts.length}):`, run.stats.hurts.slice(0, 12).map((h) => `t${h.t}:-${h.dmg}`).join(' '));
console.log(`  重叠帧被拒归因:`, JSON.stringify(run.stats.blocked));
console.log(`  第二颗球死亡陷阱:`, run.killLog.length ? JSON.stringify(run.killLog) : '无(两球共存)');
console.log(`  终局存活球=${run.finalSpheres} maxMinions(run 内)=${run.maxMinions}`);
console.log(`  → 判别: contact 应落在 dash 桶(原版 projPet 门 533 唯冲刺态可伤),hp 独立结算 ≥3`);
L.chk('随从上限≥3(buff 通道)', run.maxMinions >= 3, `maxMinions=${run.maxMinions}`);
const last = run.trace[run.trace.length - 1];
L.chk('致命球造成伤害(hp 下降)', last.hp !== null && last.hp < 20000, `hp=${last.hp}(初始 20000)`);
L.chk('独立结算 ≥3', run.stats.hurts.length >= 3, `hurt 事件=${run.stats.hurts.length}`);
L.chk('contact 落冲刺态(原版 projPet 门同相)', (run.stats.byState.dash ?? 0) > 0 && (run.stats.byState.idle ?? 0) === 0, `按态=${JSON.stringify(run.stats.byState)}`);
L.chk('两球共存至终局', run.finalSpheres === 2, `finalSpheres=${run.finalSpheres} killLog=${run.killLog.length}`);

await browser.close();
L.print();
process.exit(L.exitCode());
