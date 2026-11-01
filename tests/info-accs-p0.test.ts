import { it, expect } from 'vitest';
import { statOfInternal } from '../src/data/vanillaItemStats';
import { ITEM_DEFS } from '../src/data/items';

// ★BJ744 改判史：BJ740 ACC15 勘正 5 件误资格（3124 case 块无 InfoAccessory——邻
//  3123 有;5358-5361 @Item.cs:42506+ 同款非 InfoAccessory 通路）→ 27→22。
const IDS = [15,16,17,18,393,395,707,708,709,3036,3037,3084,3095,3096,3099,3102,3118,3119,3120,3121,3122,3123];

it('P0: 22 件信息饰品 acc==1 且物品已登记可装备（★BJ744:BJ740 ACC15 后 27→22）', () => {
  // statOfInternal 吃内部数组下标——经 key 反查(vi_<vid>_)再验
  const keyOf = (vid: number) => ITEM_DEFS.findIndex(d => d && (d.vid === vid || (d.key.startsWith(`vi_${vid}_`))));   // ★方案 A:守洞
  for (const vid of IDS) {
    const iid = keyOf(vid);
    expect(iid, `vid ${vid} 未登记`).toBeGreaterThanOrEqual(0);
    expect(statOfInternal(iid)?.acc, `vid ${vid} acc`).toBe(1);
  }
});
