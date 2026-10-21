import { describe, it, expect } from 'vitest';
import { Arrow, setProjSpriteOverride } from '../src/entities/Arrow';
import { World } from '../src/world/World';
import type { GameHooks } from '../src/entities/types';

function openWorld(): World {
  const w = new World(300, 200, 7, 'hw');
  for (let x = 0; x < 300; x++) for (let y = 100; y < 200; y++) w.store.setTile(x, y, 1);
  return w;
}
function makeGame(w: World): GameHooks {
  const hooks: GameHooks = {
    world: w as never, player: null as never, enemies: () => [], critters: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {}, showPickupLabel: () => {},
  } as unknown as GameHooks;
  (hooks as unknown as { entities: unknown }).entities = { projectiles: [], add: () => {} };
  return hooks;
}

describe('diag', () => {
  it('485 draw early-return 定位', () => {
    setProjSpriteOverride(485, { width: 24, height: 120, complete: true, naturalWidth: 24 } as unknown as HTMLImageElement);
    const a = new Arrow(1000, 1600, 6, 0, 10, 1, 485, {});
    a.fixedUpdate(1 / 60, makeGame(openWorld()));
    const calls: Array<{ ga: number; gco: string }> = [];
    let ga = 1, gco = 'source-over';
    const ctx = {
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      set globalAlpha(v: number) { ga = v; },
      get globalAlpha() { return ga; },
      set globalCompositeOperation(v: string) { gco = v; },
      get globalCompositeOperation() { return gco; },
      filter: 'none', imageSmoothingEnabled: false,
      drawImage: () => { calls.push({ ga, gco }); },
    } as unknown as CanvasRenderingContext2D;
    a.draw({ ctx, mainPlayer: undefined } as never, undefined as never);
    console.log('calls=', calls.length, 'dead=', a.dead, 'alpha=', a.alpha, 'hwFrame=', (a as unknown as { hwFrame: number }).hwFrame, 'age=', a.age);
    // 关键态全 dump
    expect(calls.length).toBeGreaterThanOrEqual(0);
  });
});
