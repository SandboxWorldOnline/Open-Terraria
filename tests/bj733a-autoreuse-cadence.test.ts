// BJ733-A 铜短剑自动连发节拍锁（2026-10-27 用户问「设置启用自动攻击后铜短剑戳得很快,
// 是原版行为吗」）——定谳链:
//   · 铜短剑 3507 原版 stats（Item.cs SetDefaults :31406-31417 亲读）: damage 5/
//     useTime 13/useAnimation 13/autoReuse **false**/shoot 938/noMelee——原版=每次
//     点击一戳,不自动连发。
//   · 「自动攻击」= 原版 1.4.4 设置 SettingsEnabled_AutoReuseAllItems
//     （Main.cs:262;Player.cs:24648 每 tick 同步 autoReuseAllWeapons）;消费位
//     TryAllowingItemReuse Player.cs:53542-53558:`(stressBall||autoReuseAllWeapons)
//     && damage>0 && (!channel||!channel)` → releaseUseItem——非 autoReuse 武器
//     也持按连发,节拍=useTime 完结（本仓 useTime===0 门,SW-AT1 同构）。
//   · 故 13 拍/戳 ≈ 4.6 戳/秒 = 原版开启该设置后的真实节拍（「感觉很快」=真值,
//     平时无连发挡着,人工点击 ~2-3/s 慢于机器连发才显得快）。
// 锁面:①数据面 1:1 ②开连发 600 拍戳数∈[40,60]（13 拍档）③关连发持按=恰 1 戳
// （fresh-click 门）④变异恰红（连发臂摘除→③红;useTime 门摘除→②红）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game } from '../src/core/Game';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { TILE } from '../src/core/constants';
import { newWiresRadialState } from '../src/stats/wiresRadial';
import { options } from '../src/core/Options';

const iid = (vid: number): number => {
  const k = VANILLA_ITEM_KEY_BY_ID[vid];
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

/** updateUse 可驱动最小 Game 桩（bj651 stubGame 同式）+938 戳击弹计数 */
function stubGame() {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  player.inv.add(iid(3507), 1);   // 铜短剑
  const sel = player.inv.slots.findIndex((s) => s && s.id === iid(3507));
  player.inv.selected = Math.max(0, sel);
  g.player = player;
  g.world = new World(120, 120, 30, 'bj733a');
  let stabs = 0;
  g.entities = {
    critters: [], npcs: [], enemies: [], projectiles: [],
    add: (e: unknown, kind: string) => {
      if (kind === 'projectiles' && (e as { projId?: number }).projId === 938) stabs++;
    },
  };
  g.input = {
    mouseDown: true, mouseHeld: true, mouseX: 700, mouseY: 300,
    rightDown: false, uiBlocking: false, downAction: () => false,
  };
  g.camera = { tileUnder: () => [60, 60], screenToWorld: () => [800, 0], x: 800, y: 0 };
  g.renderer = { canvas: { width: 800, height: 600 }, fullMap: { open: false }, timeUiHover: false, weatherUiHover: false };
  g.smartCursor = { showing: false };
  g.annotateMode = false;
  g.prevSwingMouse = false;
  g.mining = null;
  g.swingHitSet = new Set<number>();
  g.swingTileCutSet = new Set<number>();
  g.wiresRadial = newWiresRadialState();
  g.uiHeldItemRef = () => null;
  g.inpOverDomUi = () => false;
  g.achievements = { handleSpecialEvent: () => {} };
  g.cb = { onInventoryChanged: () => {}, onToast: () => {} };
  g.sfx = { play: () => true, playWav: () => true, playWavFile: () => true, playFiles: () => true };
  g.playSfxFile = () => {};
  g.playUseSound = () => {};
  const drive = (ticks: number): void => {
    for (let t = 0; t < ticks; t++) {
      // useTime 递减在 fixedUpdateBody(:4931)——真游戏每拍玩家 tick 先于使用分派
      (player as unknown as { fixedUpdateBody: (dt: number, gh: unknown) => void })
        .fixedUpdateBody(1 / 60, g);
      (g.updateUse as (dt: number) => void)(1 / 60);
    }
  };
  return { g, player, drive, count: () => stabs };
}

describe('BJ733-A 铜短剑自动连发节拍', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); options.data.autoReuseAllItems = false; });

  it('① 数据面 1:1:3507 useTime/useAnimation=13,autoReuse=false（Item.cs :31406-31417）', () => {
    const c = itemCombat(3507);
    expect(c?.useTime).toBe(13);
    expect(c?.useAnimation).toBe(13);
    expect(c?.autoReuse).toBe(false);
    expect(c?.damage).toBe(5);       // damage>0=全局连发臂受理面（:53550）
    expect(c?.shoot).toBe(938);
  });

  it('② 开连发:600 拍持按戳数 ∈[40,60]（13 拍/戳档,4.6/s——原版同节拍）', () => {
    options.data.autoReuseAllItems = true;
    const { drive, count } = stubGame();
    drive(600);
    const n = count();
    // 13 拍/戳 → 600/13≈46;容差吸收首戳沿与实现性 ±1 拍差
    expect(n, `600 拍实测 ${n} 戳,13 拍档预期 ≈46`).toBeGreaterThanOrEqual(40);
    expect(n).toBeLessThanOrEqual(60);
  });

  it('③ 关连发:持按=恰 1 戳（fresh-click 门——原版 autoReuse=false 逐点语义）', () => {
    options.data.autoReuseAllItems = false;
    const { drive, count } = stubGame();
    drive(600);
    expect(count(), '非 autoReuse 件持按不得连发（须松手再点）').toBe(1);
  });
});
