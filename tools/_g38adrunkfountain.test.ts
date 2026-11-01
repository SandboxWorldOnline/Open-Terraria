// G38-A 取证仪(G38-D1 债复核用,常驻):vanilla x86 rig drunk 5162020 终态喷泉计数——
// BJ731 D2 登记债清偿。rig 产物 /tmp/g38a-rig/worlds/g38adrunk.wld(arch -x86_64
// 强制 x86 slice,autocreate=1=4200×1200,seed=5162020=数值 SpecialSeedValues 触发
// drunk,WorldSeedOption_Drunk.cs 亲读)。对照面:SW drunk-world-gen.test.ts 断言
// fountains=0(Piles 云腿判死,机制五环 1457 亲读)。
// 用法:cd game && npx vitest run --config vitest.g38atmp.config.ts tools/_g38adrunkfountain.test.ts
import { it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseWldToSave } from '../src/wld/WldImport';
import { loadSave } from '../src/save/SaveFile';
import { TILE_DEFS } from '../src/data/tiles';

const WLD = '/tmp/g38a-rig/worlds/g38adrunk.wld';

it('vanilla x86 drunk 5162020 终态喷泉(tile 207)计数 + drunk 双邪恶自证', () => {
  if (!existsSync(WLD)) throw new Error(`rig 产物缺失 ${WLD}`);
  const buf = new Uint8Array(readFileSync(WLD));
  const { save } = parseWldToSave(buf);
  const { world } = loadSave(JSON.stringify(save));
  const st = world.store;
  const N = st.w * st.h;
  // SHEET 表:SW 内部 id → vanilla sheet(vanilla tile id 域)
  const SHEET = new Int32Array(TILE_DEFS.length).fill(-1);
  for (let i = 0; i < TILE_DEFS.length; i++) {
    const s = TILE_DEFS[i]?.vanilla?.sheet;
    if (typeof s === 'number') SHEET[i] = s;
  }
  let fountains = 0;
  const bySheet = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    if (!st.flags[i]) continue;
    const sh = SHEET[st.type[i]] ?? -1;
    if (sh < 0) continue;
    bySheet.set(sh, (bySheet.get(sh) ?? 0) + 1);
    if (sh === 207) fountains++;
  }
  // drunk 自证:双邪恶群系并存(v_25 ebonstone/v_203 crimstone)
  const ebon = bySheet.get(25) ?? 0;
  const crim = bySheet.get(203) ?? 0;
  console.log(`[g38a] world ${st.w}x${st.h}; fountains(tile207)=${fountains}`);
  console.log(`[g38a] drunk 自证: ebonstone(25)=${ebon} crimstone(203)=${crim} ` +
    `(云族189=${bySheet.get(189) ?? 0}, 雪云460=${bySheet.get(460) ?? 0})`);
  expect(ebon).toBeGreaterThan(300);
  expect(crim).toBeGreaterThan(300);
  // 判别:vanilla x86 终态喷泉计数(SW 侧断言 0——Piles 云腿判死原版同构)
  console.log(`[g38a] verdict: vanilla x86 fountains=${fountains} vs SW=0 → ` +
    (fountains === 0 ? '一致(Piles 判死定谳成立)' : '不一致(SW 机制定谳存疑)'));
}, 120000);

import { expect } from 'vitest';
