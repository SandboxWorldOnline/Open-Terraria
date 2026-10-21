// 一次性诊断(用后即删):复放 sweep seq#99,定位 |vx|>9 拍
import { it } from 'vitest';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';
import { seededRandom } from './seeded-rng';

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const f = k ? ITEM_BY_KEY[k] : undefined;
  if (f === undefined) throw new Error(`vid ${vid} 未注册`);
  return f;
};
const fakeHooks = (w: World, p: unknown) => ({
  world: w, player: p,
  playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
  addDamageNumber: () => {}, spawnParticles: () => {}, spawnDust: () => null,
  spawnDrop: () => null, damagePlayer: (): number => 0, onEnemyKilled: () => {},
  entities: { add: () => {} }, enemies: () => [], critters: () => [], npcs: () => [],
});
const BOTTLES = [0, 53, 987, 1724, 3201, 857] as const;

it('diag seq99', async () => {
  const { Player: PCtor } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  const w = new World(1200, 240, 44, 'bj705b-sweep');
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) { w.store.setTileSilent(x, 150, 1, 0, 0); w.store.setTileSilent(x, 151, 1, 0, 0); }
  for (let y = 120; y < 150; y++) for (let x = 130; x < 170; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
  const game = fakeHooks(w, null);
  const seq = 99;
  const rnd = seededRandom(0x705B000 + seq);
  const bottle = BOTTLES[Math.floor(rnd() * BOTTLES.length)];
  const wings = rnd() < 0.25;
  const magi = !wings && bottle === 0 && rnd() < 0.2;
  const shadow = rnd() < 0.2;
  const mountMode = rnd() < 0.7 ? 'ground' : rnd() < 0.85 ? 'midair' : 'none';
  console.log('gear: bottle=%s wings=%s magi=%s shadow=%s mountMode=%s', bottle, wings, magi, shadow, mountMode);
  const p = new PCtor(100 * 16, 140 * 16, new Inventory());
  if (bottle) p.inv.armor[4] = { id: iid(bottle), stack: 1 };
  if (wings) p.inv.armor[3] = { id: iid(492), stack: 1 };
  if (magi) p.inv.armor[4] = { id: iid(5107), stack: 1 };
  if (shadow) {
    p.inv.armor[0] = { id: iid(102), stack: 1 };
    p.inv.armor[1] = { id: iid(101), stack: 1 };
    p.inv.armor[2] = { id: iid(100), stack: 1 };
  }
  for (let t = 0; t < 90; t++) { p.fixedUpdate(1 / 60, game as never); if (p.onGround) break; }
  if (mountMode === 'ground') p.mount.setMount(14, p);
  let mounted = mountMode === 'ground';
  const midairAt = mountMode === 'midair' ? 60 + Math.floor(rnd() * 200) : -1;
  let dir = rnd() < 0.5 ? 1 : -1;
  let hold = 0, downT = 0;
  for (let t = 0; t < 340; t++) {
    if (rnd() < 0.012) dir = rnd() < 0.15 ? 0 : (rnd() < 0.5 ? 1 : -1);
    if (hold === 0 && rnd() < 0.02) hold = 2 + Math.floor(rnd() * 13);
    if (downT === 0 && rnd() < 0.003) downT = 5 + Math.floor(rnd() * 16);
    p.inputX = dir; p.inputJump = hold > 0; p.inputDown = downT > 0;
    if (hold > 0) hold--;
    if (downT > 0) downT--;
    p.fixedUpdate(1 / 60, game as never);
    if (!mounted && t === midairAt && !p.onGround) { p.mount.setMount(14, p); mounted = true; console.log('t=%s MIDAIR MOUNT (vy=%s)', t, p.vy.toFixed(2)); }
    if (Math.abs(p.vx) > 9) {
      console.log('t=%s vx=%s vy=%s y=%s x=%s mounted=%s pj=%s jh=%s wet=%s down=%s wings?%s', t, p.vx.toFixed(2), p.vy.toFixed(2), (p.y / 16).toFixed(1), (p.x / 16).toFixed(1), mounted, (p as unknown as { performingJump: string | null }).performingJump, p.jumpHold, (p as unknown as { wet: boolean }).wet, p.inputDown, wings);
    }
  }
}, 30000);
