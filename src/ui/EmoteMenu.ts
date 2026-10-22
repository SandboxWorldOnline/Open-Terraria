// 表情窗口（M4）——Terraria.GameContent.UI.States/UIEmotesMenu.cs（658L）+
// EmotesGroupListItem.cs + EmoteButton.cs 1:1 移植（DOM 化）。
//
// 结构（InitializePage :45-98）：7 分组按序——常规/RPS/物品/自然和天气/城镇/
// 小动物和怪物/危险;每组标题 + 分隔线 + 表情钮网格（EmotesGroupListItem 构造器
// 强制 maxEmotesPerRow=14）。
// 解锁门（GetEmotesCritters/GetEmotesBosses :153-283）：事件小动物 4 项 + Boss 全表
// 按 downed 旗标逐项加入——未击败的 Boss 不出现在窗口（击杀过才解锁,原版同款）。
// 表情钮（EmoteButton）：Extra_48 开口气泡帧(行0列1) + 表情图标（帧 0/1 每 10t
// 交替,UpdateFrame :33-40 20t 循环）+ 边框（UI/EmoteBubbleBorder,常态黑/悬停
// OurFavoriteColor(255,231,69) Main.cs:868）;悬停提示 "/{EmojiName}" + SoundID 12;
// 左键 = MakeLocalPlayerEmote + 关窗（LeftClick :90-95,IngameFancyUI.Close）。
// 打开入口 = 背包表情按钮（原版 Main.cs:41854 DrawEmoteIcon,图鉴角钮旁）。
// 打开期间暂停世界并阻断输入（IngameFancyUI 语义,同 BestiaryPanel 惯例）;
// Esc 关闭（capture 阶段拦截,防暂停键二次消费）。
import { Lang } from '../i18n/Lang';
import { EMOTE_NAMES } from '../data/vanillaEmotes';
import { lateImageRetry } from '../assets/lateImageRetry';
import { bindMouseTextTip } from './MouseTextTip';   // ★BJ-C4-F5

/** 世界旗标视图（解锁门输入;hardMode 与 downed_* 双键并集见各门注释） */
export interface EmoteGateFlags extends Record<string, boolean | undefined> {
  hardMode?: boolean;
}

/** 表情分组数据（纯函数——测试消费） */
export interface EmoteGroup { titleKey: string; ids: number[] }

/** GetEmotesGeneral（:108-116）1:1 */
export const EMOTES_GENERAL: readonly number[] = [
  0, 1, 2, 3, 15, 136, 94, 16, 135, 134,
  137, 138, 139, 17, 87, 88, 89, 91, 92, 93,
  8, 9, 10, 11, 14, 100, 146, 147, 148,
];

/** GetEmotesRPS（:118-121）1:1 */
export const EMOTES_RPS: readonly number[] = [36, 37, 38, 33, 34, 35];

/** GetEmotesItems（:123-131）1:1 */
export const EMOTES_ITEMS: readonly number[] = [
  7, 73, 74, 75, 76, 131, 77, 78, 79, 80,
  81, 82, 83, 84, 85, 86, 90, 132, 126, 127,
  128, 129, 149,
];

/** GetEmotesBiomesAndEvents（:133-141）1:1 */
export const EMOTES_BIOMES: readonly number[] = [
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 18, 19, 20, 21, 99, 4, 5, 6, 95,
  96, 97, 98,
];

/** GetEmotesTownNPCs（:143-151）1:1 */
export const EMOTES_TOWN: readonly number[] = [
  101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
  111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
  121, 122, 123, 124, 125, 130, 140, 141, 142, 145,
];

/** GetEmotesCritters（:153-176）1:1——事件小动物 4 项按入侵旗标逐项解锁 */
export function emotesCritters(f: EmoteGateFlags): number[] {
  const list: number[] = [12, 13, 61, 62, 63];
  list.push(67, 68, 69, 70);
  list.push(72);
  if (f['downedGoblins']) list.push(64);    // NPC.downedGoblins（哥布林入侵胜利）
  if (f['downedFrost']) list.push(66);      // NPC.downedFrost（雪人军团）
  if (f['downedPirates']) list.push(65);    // NPC.downedPirates（海盗入侵）
  if (f['downedMartians']) list.push(71);   // NPC.downedMartians（火星疯子）
  return list;
}

/** GetEmotesBosses（:178-283）1:1——Boss 表情按 downed 旗标逐项解锁。
 *  旗标键 = 本仓击杀链通用置位 downed_<vanillaId>（双键族并集：EoC=downed_4|
 *  downedEyeOfCthulhu/骷髅王=downed_35|downedSkeletron/史莱姆王=downed_50|
 *  downedSlimeKing,见 World.flags 初始化与 Game 击杀链） */
export function emotesBosses(f: EmoteGateFlags): number[] {
  const list: number[] = [];
  if (f['downed_4'] || f['downedEyeOfCthulhu']) list.push(39);   // downedBoss1（EoC）
  if (f['downed_13'] || f['downed_266']) {                        // downedBoss2（EoW|BoC）
    list.push(40);
    list.push(41);
  }
  if (f['downed_50'] || f['downedSlimeKing']) list.push(51);      // downedSlimeKing
  if (f['downed_668']) list.push(150);                            // downedDeerclops
  if (f['downed_222']) list.push(42);                             // downedQueenBee
  if (f['downed_35'] || f['downedSkeletron']) list.push(43);      // downedBoss3（骷髅王）
  if (f['hardMode']) list.push(44);                               // Main.hardMode（WoF）
  if (f['downed_657']) list.push(144);                           // downedQueenSlime（★曾误写 641=永锁,红蓝对抗 R3-C3 校正;解析侧写 downed_657）
  if (f['downed_134']) list.push(45);                             // downedMechBoss1（毁灭者）
  if (f['downed_127']) list.push(46);                             // downedMechBoss3（铁骷髅王）
  if (f['downed_125'] || f['downed_126']) list.push(47);          // downedMechBoss2（双子）
  if (f['downed_262']) list.push(48);                             // downedPlantBoss
  if (f['downed_245']) list.push(49);                             // downedGolemBoss
  if (f['downed_370']) list.push(50);                             // downedFishron
  if (f['downed_636']) list.push(143);                            // downedEmpressOfLight
  if (f['downed_439']) list.push(52);                             // downedAncientCultist
  if (f['downed_398']) list.push(53);                             // downedMoonlord
  if (f['downed_325'] || f['downedHalloweenTree']) list.push(54);           // downedHalloweenTree（哀木）
  if (f['downed_327'] || f['downedHalloweenKing']) list.push(55);           // downedHalloweenKing（南瓜王）
  if (f['downed_344'] || f['downedChristmasTree']) list.push(56);           // downedChristmasTree（常绿尖叫树）
  if (f['downed_345'] || f['downedChristmasIceQueen']) list.push(57);       // downedChristmasIceQueen（冰雪女王）
  if (f['downed_346'] || f['downedChristmasSantank']) list.push(58);        // downedChristmasSantank（圣诞坦克）
  if (f['downedPirates']) list.push(59);                          // downedPirates（荷兰飞船）
  if (f['downedMartians']) list.push(60);                         // downedMartians（火星飞碟）
  // DD2Event.DownedInvasionAnyDifficulty（:93-100）：旧运行时键 downedOldOnesArmyT1-3
  // + 导入域 dd2DownedT1-3 双读（2026-09-14 审计——旧导入档只有 dd2 键,曾漏读=表情 133 不解锁）
  if (f['downedOldOnesArmyT1'] || f['downedOldOnesArmyT2'] || f['downedOldOnesArmyT3']
    || f['dd2DownedT1'] || f['dd2DownedT2'] || f['dd2DownedT3']) {
    list.push(133);                                               // DD2Event.DownedInvasionAnyDifficulty
  }
  return list;
}

/** 全分组（TryAddingList 序 :91-97——空组不入列,原版同款） */
export function emoteGroups(f: EmoteGateFlags): EmoteGroup[] {
  const defs: Array<[string, number[]]> = [
    ['UI.EmoteCategoryGeneral', [...EMOTES_GENERAL]],
    ['UI.EmoteCategoryRPS', [...EMOTES_RPS]],
    ['UI.EmoteCategoryItems', [...EMOTES_ITEMS]],
    ['UI.EmoteCategoryBiomesAndEvents', [...EMOTES_BIOMES]],
    ['UI.EmoteCategoryTownNPCs', [...EMOTES_TOWN]],
    ['UI.EmoteCategoryCritters', emotesCritters(f)],
    ['UI.EmoteCategoryBosses', emotesBosses(f)],
  ];
  return defs.filter(([, ids]) => ids.length > 0).map(([titleKey, ids]) => ({ titleKey, ids }));
}

export interface EmoteMenuFlow {
  /** 世界旗标（解锁门;菜单每次打开现取） */
  gateFlags(): EmoteGateFlags;
  /** EmoteBubble.MakeLocalPlayerEmote（EmoteButton.LeftClick :93） */
  makeLocalPlayerEmote(emoteId: number): void;
  /** SoundID 12 = menuTick（悬停/按钮） */
  playTick(): void;
  /** 关闭后恢复（暂停/阻断态还原,同 BestiaryPanel.onBack） */
  onBack(): void;
}

const CSS = `
.sw-emote-menu { position:fixed; inset:0; z-index:1150; display:flex;
  align-items:center; justify-content:center;
  background:rgba(0,0,0,0.55); pointer-events:auto; }
.sw-emote-panel { width:590px; max-width:94vw; max-height:80vh; display:flex;
  flex-direction:column; padding:12px;
  /* UIPanel.BackgroundColor = (33,43,79)×0.8（InitializePage :58） */
  background:rgba(33,43,79,0.8); border:2px solid #7d92d6; border-radius:6px;
  color:#e8ecf8; font-family:"Fusion Pixel 12px","Microsoft YaHei",sans-serif; }
.sw-emote-list { overflow-y:auto; flex:1; padding:8px 12px; }
.sw-emote-group { margin:7px 0 14px 0; }
.sw-emote-sep { height:1px; margin:0 0 6px 0;
  background:linear-gradient(90deg, transparent, rgba(120,140,220,0.85), transparent); }
.sw-emote-title { text-align:center; font-size:13px; color:#e8ecf8;
  text-shadow:1px 1px 0 #000; margin-bottom:4px; }
.sw-emote-grid { display:flex; flex-wrap:wrap; }
/* 表情钮（EmoteButton）：气泡 34×28 + 图标帧 0/1（10t 交替）+ 边框 36×30;
   原生像素 → 2×（68×56/72×60）。边框 = UI/EmoteBubbleBorder 白图染色:
   常态黑 / 悬停 OurFavoriteColor(255,231,69)（预烘 dataURL,见 borderUrl） */
.sw-emote-btn { position:relative; width:72px; height:64px; margin:0 2px 4px 0;
  border:none; padding:0; background:transparent; cursor:pointer;
  image-rendering:pixelated; }
.sw-emote-btn .bubble { position:absolute; left:2px; top:2px; width:68px; height:56px;
  background-image:url(sprites/vanilla/Extra_48.png);
  background-size:544px 2184px; background-repeat:no-repeat;
  background-position:-68px 0; }   /* 行0列1 = 张开气泡帧（DrawSelf :60-62 value.X=W/8,Y=0） */
.sw-emote-btn .icon { position:absolute; left:2px; top:2px; width:68px; height:56px;
  background-image:url(sprites/vanilla/Extra_48.png);
  background-size:544px 2184px; background-repeat:no-repeat;
  background-position:var(--fx0) var(--fy); }
.sw-emote-menu.frame1 .sw-emote-btn .icon { background-position:var(--fx1) var(--fy); }
.sw-emote-btn .border { position:absolute; left:-4px; top:-4px; width:72px; height:60px;
  background-repeat:no-repeat; background-size:100% 100%; }
/* ★边框偏移 = 原版 vector-(2,2)（DrawSelf :77 EmoteBubbleBorder 中心对齐 -2px）——
   曾画在 (0,0) = 描边右/下被裁、左/上悬空（用户报"错误的 stroke"） */
.sw-emote-btn:hover .border { background-image:var(--border-hover); }
.sw-emote-btn:not(:hover) .border { background-image:var(--border-idle); }
`;

/** 边框染色 dataURL 预烘（白图 × 颜色乘法;黑常态 / OurFavoriteColor 悬停） */
const borderCache = new Map<string, string>();
function borderUrl(tint: readonly [number, number, number], src: HTMLImageElement): string | null {
  const key = tint.join(',');
  const hit = borderCache.get(key);
  if (hit) return hit;
  if (!src.width) return null;
  const c = document.createElement('canvas');
  c.width = 36; c.height = 30;
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(src, 0, 0);
  const d = cx.getImageData(0, 0, 36, 30);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = (d.data[i] * tint[0]) / 255;
    d.data[i + 1] = (d.data[i + 1] * tint[1]) / 255;
    d.data[i + 2] = (d.data[i + 2] * tint[2]) / 255;
  }
  cx.putImageData(d, 0, 0);
  const url = c.toDataURL();
  borderCache.set(key, url);
  return url;
}

/** 打开表情窗口。已开守卫（Esc 快按叠层防累积,同 BestiaryPanel 惯例） */
export function openEmoteMenu(parent: HTMLElement, flow: EmoteMenuFlow): void {
  if (document.querySelector('.sw-emote-menu')) return;
  if (!document.getElementById('sw-emote-style')) {
    const style = document.createElement('style');
    style.id = 'sw-emote-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const overlay = document.createElement('div');
  overlay.className = 'sw-emote-menu';
  const panel = document.createElement('div');
  panel.className = 'sw-emote-panel';
  const list = document.createElement('div');
  list.className = 'sw-emote-list';
  let close = () => {};   // 提前声明（按钮 click 需要 close;下方赋真身）

  // 边框素材（UI/EmoteMenuButton 同路径族;失败 → 无边框降级）
  let borderImg: HTMLImageElement | null = null;
  let idleUrl: string | null = null;
  let hoverUrl: string | null = null;
  {
    borderImg = new Image();
    borderImg.onload = () => {
      idleUrl = borderUrl([0, 0, 0], borderImg!);
      hoverUrl = borderUrl([255, 231, 69], borderImg!);
      applyBorders();
    };
    borderImg.src = 'sprites/vanilla-ui/UI_EmoteBubbleBorder.png';
    lateImageRetry(borderImg, 'sprites/vanilla-ui/UI_EmoteBubbleBorder.png');   // ★BJ705-G26 件4
  }
  const applyBorders = () => {
    if (idleUrl) overlay.style.setProperty('--border-idle', `url(${idleUrl})`);
    if (hoverUrl) overlay.style.setProperty('--border-hover', `url(${hoverUrl})`);
  };

  const groups = emoteGroups(flow.gateFlags());
  for (const g of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'sw-emote-group';
    const title = document.createElement('div');
    title.className = 'sw-emote-title';
    title.textContent = Lang.has(g.titleKey) ? Lang.text(g.titleKey) : g.titleKey;
    const sep = document.createElement('div');
    sep.className = 'sw-emote-sep';
    const grid = document.createElement('div');
    grid.className = 'sw-emote-grid';
    for (const id of g.ids) {
      grid.appendChild(makeEmoteButton(id, flow, () => close()));
    }
    wrap.append(sep, title, grid);
    list.appendChild(wrap);
  }
  // 返回按钮（UITextPanel<LocalizedText> "UI.Back" :78-88,GoBackClick 关窗）
  const backRow = document.createElement('div');
  backRow.style.cssText = 'display:flex; justify-content:center; flex:none; padding-top:6px;';
  const back = document.createElement('button');
  back.className = 'sw-back-btn';
  back.style.cssText = 'width:50%; padding:10px 0; background:rgba(63,82,151,0.8);'
    + 'border:2px solid #7d92d6; border-radius:6px; color:#fff; font:inherit; font-size:14px; cursor:pointer;';
  back.textContent = Lang.has('UI.Back') ? Lang.text('UI.Back') : 'UI.Back';
  back.addEventListener('mouseenter', () => flow.playTick());   // FadedMouseOver → SoundID 12
  back.addEventListener('click', () => close());
  backRow.appendChild(back);

  panel.appendChild(list);
  panel.appendChild(backRow);
  overlay.appendChild(panel);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  parent.appendChild(overlay);

  // 图标帧 0↔1 交替（EmoteButton.UpdateFrame :33-40：20t 循环,每 10t 换帧）。
  // 面板级单定时器翻转 class,按钮 CSS 变量分帧（非每钮独立 timer）
  const frameTimer = setInterval(() => {
    overlay.classList.toggle('frame1');
  }, 167);   // 10 tick ≈ 167ms（本仓固定 60fps 同速）

  // Esc 关闭（capture 拦截,防暂停键消费——DOM 面板惯例）
  const escHandler = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', escHandler, true);

  close = () => {
    clearInterval(frameTimer);
    window.removeEventListener('keydown', escHandler, true);
    overlay.remove();
    flow.onBack();
  };
}

/** EmoteButton（:10-97）：DOM 化。图标帧列 = emote*2%8 + frame,行 = 1+emote/4 */
function makeEmoteButton(emoteIndex: number, flow: EmoteMenuFlow, closeMenu: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'sw-emote-btn';
  btn.type = 'button';
  const nameKey = EMOTE_NAMES[emoteIndex];
  // 图标帧位置（GetFrame :29-31）：col = emote*2%8 + f（2× 缩放）;row = 1+emote/4
  const col0 = (emoteIndex * 2) % 8;
  const row = 1 + Math.floor(emoteIndex / 4);
  btn.style.setProperty('--fx0', `${-col0 * 68}px`);
  btn.style.setProperty('--fx1', `${-(col0 + 1) * 68}px`);
  btn.style.setProperty('--fy', `${-row * 56}px`);
  const bubble = document.createElement('span');
  bubble.className = 'bubble';
  const icon = document.createElement('span');
  icon.className = 'icon';
  const border = document.createElement('span');
  border.className = 'border';
  btn.append(bubble, icon, border);
  // 悬停：tooltip "/{EmojiName}"（DrawSelf :79-84）+ SoundID 12（MouseOver :68-73）
  // ★BJ-C4-F5（2026-10-06）：原生 browser title（OS 延迟气泡）→ 自绘 MouseText
  //   气泡族（MouseTextTip 单源）——原版面 = DrawSelf hovered 臂
  //   `Main.instance.MouseText("/" + EmojiName, 0, 0)`（EmoteButton.cs:79-84）,
  //   悬停即现/随动 = MouseText 家族语义,非 OS tooltip。
  const emojiName = Lang.has(`EmojiName.${nameKey}`) ? Lang.text(`EmojiName.${nameKey}`) : nameKey;
  bindMouseTextTip(btn, () => `/${emojiName}`);
  btn.addEventListener('mouseenter', () => flow.playTick());
  // 左键 = MakeLocalPlayerEmote + 关窗（LeftClick :90-95 + IngameFancyUI.Close）
  btn.addEventListener('click', () => {
    flow.makeLocalPlayerEmote(emoteIndex);
    closeMenu();
  });
  return btn;
}
