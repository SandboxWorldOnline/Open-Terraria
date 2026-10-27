// BJ728-A 债2（BJ715-A 登记债清偿，2026-10-27）：蛾虫扫地产卵谓词域。
// 原版锚（亲读 Terarria1457）：NPC.cs ai0==4f 产卵扫列（:38563-38632）——
//   · 首探 :38580 `if (WorldGen.SolidTile(num1315, num1316)) continue;`
//   · 下潜臂 :38616 `if (WorldGen.SolidTile(num1315, num1316) || …) break;`
// WorldGen.SolidTile(int,int)（WorldGen.cs:70642-70664 严格式）= active ∧ tileSolid
// ∧ !tileSolidTop ∧ !halfBrick ∧ slope==0 ∧ !inActive ≡ TileStore.isSolidStrict。
// 旧本仓 solidTileAt=isSolid 宽谓词（半砖/坡面格当实心）——与 BJ715-A-③
// CheckFloor 谓词域同病族（isSolid/isStrict/Platforms 纯 type 三式不可混用判例）。
// 本刀：两站 1:1 换严式 + 死助手连坐删（BJ150-223 纪律）。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { TILE } from '../src/core/constants';
import { mothronAI } from '../src/entities/bossAI_lunar_misc';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME_ROOT, 'src', p), 'utf8');
const LM_SRC = join(GAME_ROOT, 'src/entities/bossAI_lunar_misc.ts');
const spawnVitest = (filter: string) => spawnSync('npx', ['vitest', 'run', filter, '--reporter=basic'],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, BJ728A_MUT_SKIP: '1' } });
const itMut = process.env.BJ728A_MUT_SKIP === '1' ? it.skip : it;
afterEach(() => vi.restoreAllMocks());

const W = 220, H = 160, PLAYER_TX = 110, PLAYER_TY = 60;

/** 扫列夹具：layers(x) 回调按列铺格;返回驱动一次 ai0=4 扫列后的蛾虫 */
function runScan(layers: (st: World['store'], x: number) => void): Enemy {
  const w = new World(W, H, 7, 'bj728a-mothron');
  w.groundLevel = 50;                                        // aboveGround=false（蛾虫 cy≈行60 在地下带,worldSurface 门不扰）
  (w as unknown as { clock: { eclipse: boolean } }).clock = { eclipse: true };
  for (let x = 0; x < W; x++) layers(w.store, x);
  const px = PLAYER_TX * TILE, py = PLAYER_TY * TILE;
  const player = {
    x: px, y: py, w: 20, h: 42, cx: px + 10, cy: py + 21,
    vx: 0, vy: 0, hp: 400, maxHp: 400, dead: false,
  };
  const hooks = {
    world: w, player,
    enemies: () => [], npcs: () => [], critters: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, spawnDust: () => null, playSfx: () => {}, playSfxFiles: () => {},
    showPickupLabel: () => {}, entities: { add: () => {} },
  } as unknown as GameHooks;
  const e = Enemy.fromVanilla(477, px, py)!;
  e.ai0 = 4;                                                 // 直入扫地产卵态
  mothronAI(e, hooks, player as never);
  return e;
}

describe('BJ728-A 债2：蛾虫产卵扫列谓词域（WorldGen.SolidTile 严格式夹具判别锁）', () => {
  it('A1 落地面判别（下潜臂 :38616）：半砖层 90 + 整砖 95 → 严式穿半砖落 95（宽式恰落 90）', () => {
    const e = runScan((st, x) => {
      st.setTile(x, 95, 1);                                  // 整砖地面
      st.setTile(x, 90, 1);                                  // 半砖层
      st.half[st.idx(x, 90)] = 1;
    });
    expect(e.ai0, '找到落点 → 4.1').toBe(4.1);
    expect(e.ai2, '落地面=整砖行 95（isSolidStrict 穿半砖;宽谓词变体恰红于此）').toBe(95);
  });

  it('A2 落地面判别（坡面变体）：slope 层 90 + 整砖 95 → 落 95', () => {
    const e = runScan((st, x) => {
      st.setTile(x, 95, 1);
      st.setTile(x, 90, 1);
      st.slope[st.idx(x, 90)] = 2;                           // 坡面 0-4 编码,非 0 即坡
    });
    expect(e.ai0).toBe(4.1);
    expect(e.ai2, '坡面格不作落地面（slope()==0 门,:70650）').toBe(95);
  });

  it('A3 起跳格判别（首探 :38580）：半砖满铺全部可能起跳行 28..94 + 整砖 95 → 严式穿层落 95;宽式首探把半砖起跳格当实心 → 1000 试全 continue 无落点（ai0 驻 0）', () => {
    const e = runScan((st, x) => {
      for (let y = 28; y <= 94; y++) { st.setTile(x, y, 1); st.half[st.idx(x, y)] = 1; }
      st.setTile(x, 95, 1);                                  // 唯一严式落地面
    });
    expect(e.ai0, '严式：半砖起跳格非实心不 continue,下潜穿半砖层至整砖 95').toBe(4.1);
    expect(e.ai2).toBe(95);
  });

  it('A4 平台负控（SOLID_LUT≡tileSolid∧!tileSolidTop）：平台层 90 两谓词同穿 → 落 95（谓词修复未动平台语义）', () => {
    const e = runScan((st, x) => {
      st.setTile(x, 95, 1);
      st.setTile(x, 90, 19);                                 // 木平台（tileSolidTop）
    });
    expect(e.ai0).toBe(4.1);
    expect(e.ai2, '平台格宽严两式均非实心（原版 SolidTile 同排除——非分歧面）').toBe(95);
  });
});

describe('BJ728-A 债2：结构锁', () => {
  it('B1 两站严式 + 死助手连坐删 + ritualCheckFloor 单源锚仍在', () => {
    const s = SRC('entities/bossAI_lunar_misc.ts');
    expect(s, '首探站（:38580 严格式）').toContain('if (st.isSolidStrict(tx, ty)) continue;');
    expect(s, '下潜臂站（:38616 严格式）')
      .toContain('if (st.isSolidStrict(tx, ty) || (aboveGround && ty > game.world.groundLevel)) break;');
    expect(s.includes('function solidTileAt'), '宽谓词死助手已删（BJ150-223 死路径连坐纪律）').toBe(false);
    expect(s.includes('solidTileAt(game'), '宽谓词调用面清零').toBe(false);
    expect(s, 'BJ715-A-③ 单源参照锚仍在（同病族判例链）').toContain('cultistCheckFloorPts');
  });
});

describe('BJ728-A 债2：变异恰红', () => {
  itMut('M1 下潜臂回退宽谓词 → A1 恰红（半砖误当落地面）', () => {
    withMutation(LM_SRC,
      'if (st.isSolidStrict(tx, ty) || (aboveGround && ty > game.world.groundLevel)) break;',
      'if (st.isSolid(tx, ty) || (aboveGround && ty > game.world.groundLevel)) break;',
      () => {
        const r = spawnVitest('tests/bj728a-mothron-scan-predicate.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('A1');
      }, { label: 'BJ728A-M1' });
  });
  itMut('M2 首探回退宽谓词 → A3 恰红（半砖起跳格整列误跳）', () => {
    withMutation(LM_SRC,
      'if (st.isSolidStrict(tx, ty)) continue;',
      'if (st.isSolid(tx, ty)) continue;',
      () => {
        const r = spawnVitest('tests/bj728a-mothron-scan-predicate.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('A3');
      }, { label: 'BJ728A-M2' });
  });
});
