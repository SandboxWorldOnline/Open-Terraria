// ★BJ219 弹幕域 Projectile.oldPos 残影族全表（2026-09-20）——BJ209（NPC 域拖影全族
// 普查刀）登记的弹幕另案。原版锚（Terarria1457；1458 对拍=DrawProj 残影区逐字节
// 等价,唯一差异 642 激光 slowMagicUse α 项不涉残影）：
//   · 记录面 = ProjectileID.Sets.TrailingMode（Terarria1457/Terraria.ID/ProjectileID.cs:385
//     全表）+ TrailCacheLength（:387 全表）+ Projectile.Update 子步循环内
//     UpdateTrails（Projectile.cs:17197-17300,mode 0-5 六式;【每子步】一段=extraUpdates
//     弹逐子步后移）。原版缺省 TrailingMode=-1 = 不记录。
//   · 绘制面 = Main.DrawProjDirect 通用残影表（Main.cs:30609-31360,num164/165/166/167/
//     168/169 参数系+逐型色/帧/锚特支）+ 专用帧残影四弹（409 剃刀台风 :32543-32561 /
//     437 吉加电矛 :32563-32586 / 385 鲨龙卷 :34867-34891 / 388 痂王幼体 :34895-34927,
//     形制与通用表同构:i 步进帧锚渐隐,并入同一参数表）。
//   · 排除面（本仓已有独立实现,勿双画——普查定谳 2026-09-20）：
//       660 天界碎裂（Arrow.draw 内联,Main.cs:30974-30980/:31363 已 1:1）/
//       94/1114 书族十份渐隐（Arrow.draw starTrail,Main.cs:35247-35317）/
//       502 喵刀 250 段链（Arrow.draw meowTrail,Main.cs:32495-32513）/
//       1047/1090 彩虹巨石 250 链+Extra_55（RollingBoulder.ts trailX 环,Main.cs:33279-33400）/
//       466/580 闪电链 Extra_33 激光链（LightningBoltProj.ts,Main.cs:34629-34700）/
//       34/16/106 弦带 shader（TrailShader FlameLash/MagicMissile/LightDisc,Main.cs:28616-28690）/
//       121-126+597+1120 宝石弦带（TrailShader RainbowRod）/
//       721/739-752 高尔夫插值尾迹（GolfBall.ts,Main.cs:31471-31512）/
//       933/1100/973 斩弧剑族（SwingArc.ts tneGhostLayers/ZenithSword mode4 环,
//         Main.cs:28136-28190/:30381-30611）。
//   · 高尔夫球通用表条目 quirk（先定谳勿"修"）：num166=0/num164=0/num165=-1 → 循环体
//     恒不执行（(num165>0&&0<num164) 与 (num165<0&&num170>0) 皆假）——表内条目为
//     死参数,真尾迹在 :31471 专用块,故本表不收 golf 球。661 同式死条目（1,0,1 → 空
//     循环;黑环在 :31362 特支）——收录但天然空循环。
//   · 1458 对拍：sed 区间 diff（Main.cs:28136-35700 两树逐行）仅 642 slowMagicUse
//     num296=proj.Opacity 一处（TurretLaser α 乘子）,残影面零变更。
//
// 本文件三件套：
//   PROJ_TRAILING_MODE / PROJ_TRAIL_CACHE_LEN —— ProjectileID.cs:385/:387 全表照录；
//   ProjGhostRing —— 记录面（mode 0-5 逐式 1:1,含 mode3 松弛 0.65/mode4 玩家位移补偿/
//     mode1 frameCounter 门）;接线在各类位移尾（原版 UpdateTrails 位序 :17198=
//     HandleMovement/Damage 之后）每子步调 record;
//   drawProjGhosts —— 绘制面通用循环（α=(end−i)/(cacheLen×1.5)（step<0 用 start−i,
//     :31331-31336）、scale=Lerp(bodyScale,gScale,i/denom)、rot=mode0 用当前本体角/
//     mode2-4 用 oldRot[i]（:31338-31342）+rotMul×(i−1)×镜像向、镜像=XOR oldSpriteDirection
//     ==−1（mode2/3/4,1001/933/1100 豁免 :31337-31341）、Zero 哨兵跳过、超环长跳过
//     （:31134 门））。
// 颜色=预乘习语（XNA AlphaBlend=预乘,rgb=贡献面/A=背景衰减面;GolfBall [G2]/npcExtraParts
// 同惯例）：aMul==1 档 source-over 单笔（globalAlpha=fade ⇒ rgb×fade+dst×(1−fade) 与
// XNA 逐项相等）;aMul<1 特支（639/640 A=127、711 A 环、684/706/710 A/=i、916 随机 127、
// 872 A×0.6、864 A/=4、833-835 A=0）双笔（黑染 cut=A 衰减 + 'lighter' add=rgb 贡献）。
// 逐型特支色（AI_156/171/173、FQW、星座、悬浮魔剑辉光）按 Projectile.cs 原式 1:1。
// 登记近似（参数面外,逐条注释锚定）：
//   ① ring dir = 记录拍 spriteDirection（★BJ703-B D1 勘误收编 2026-10-21:1457 全量
//      普查后按员落真值——Arrow/Dart 记 1（其 mode2/3/4 成员原版 AI 全程无
//      spriteDirection 写）;MinionProj 仅翻转员（755/833-835）记 facing、余记 1。
//      旧案「镜像特异 id 未在活动集」已证伪（755/833-835 活跃且翻转）,dir 基底
//      同刀接通（drawProjGhosts mirror=本体当前翻转,mode2/3/4 XOR 消费））;
//   ② ★BJ235 勘误翻案：BJ219 原判「873/976 槽色×格光未乘=暗处残影偏亮」系误捆绑——
//      反编译亲读 :31364-31368,通用环内逐槽 Lighting.GetColor 乘【仅 976】一块
//      （873 的行号引用实际也落在 976 块内,873 染色=AI_171_GetColor×0.5×timeLeft 门,
//      无光项）;且本仓光照面 = compositeLight 全屏 multiply（Renderer.ts:7216 判例:
//      「不再逐条取 lightAt,否则与全屏 pass 双重相乘会过暗」）——每个残影像素本就按
//      其屏幕位吃格光,逐槽再乘=双乘过暗。563 的逐槽 GetColor（:35291）同理由全屏乘
//      承载（563 轨面BJ235 落地,见 drawHslMidpointTrail 注）。
//   ③ 864 辉光色相 whoAmI%6 项以 0 档近似（环内同色;原版随弹序异色）
//      ——★BJ650件1 retired（2026-10-12）：whoAmI 通道落地（DrawGhostOpts.whoAmI）,
//      色式 1:1（hue 6 档循环 + A 面 (byte)178/4=44）,864 消费位传本实体 id;
//   ④ 931 FQW 色玩家名彩蛋支（Cenx 等四人名,GetFairyQueenWeaponsColorFull switch）
//      未移植（常名不可达,色式主干 1:1）;
//   ⑤ 388 专用块 origin=(w/2,h/2)（proj 尺寸系 :34921）以帧矩形中心承载（同帧同尺寸
//      时逐值等价）。
// ★BJ235（2026-09-21）接线续批（BJ219 登记债清偿）：
//   · GHOST_TINT[833-835] 补 ×lerpValue2 速度染因子（:31307-31314 逐值,BJ219 漏乘）;
//   · GHOST_FRAME 帧门 gateFrame（:30706/:30716——833 frame==8/834-835 frame==10
//     时锚特支整支跳过,BJ219 无门）;
//   · 四特支链/带绘制面落地：drawGreenBandTrail（1020/1024/1026,:28309-28328/
//     :28508-28561）/ drawCeleb2Chain（715-718,:33997-34083）/ drawRainbowChain
//     （1089,:33270-33306）/ drawHslMidpointTrail（563,:35283-35299）;
//   · 811 ai0 白染预混（:30846 Remap(ai0,0,15,1,0.3)）判镰=光照域项,本仓由
//     SELF_LUMINOUS_PROJS[811] whiten=true 光地板承载（Renderer.ts:10943,全亮端
//     Lerp(W,W,k)=W 恒等）——染侧不重复实现,无需 ai0 喂入。
//     ★BJ245（2026-09-21）勘误补注：ai0 写入方已证（AI_001 flag3 缺省 ai[0]++,
//     P.cs:57019-57021）→ 光地板 k=whiteK811(age) 15 拍 1.0→0.3 衰减,染侧
//     「不重复实现」裁决不变（环槽白→绯渐变基色随地板同步衰减,ai0 槽仍 0）。
//   · 接线位：MinionProj（533/755/833-835 本体环）/ RollingBoulder（1055,frame 系
//     end,BJ219 表已在）/ Celeb2（715-718 链+环）/ WeaponProj GlowstickProj（1089）
//     / YoyoProj（563）/ Arrow dispatch（ai1=empressHue 喂入+1026 绿带呼出）。

import { tintedTex } from '../render/StringLine';
import { hslToRgb255 } from '../render/AuroraSky';

type Ctx = CanvasRenderingContext2D;
type Tex = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

// ===================== 记录面全表（ProjectileID.cs:385/:387 照录） =====================

/** ProjectileID.Sets.TrailingMode（ProjectileID.cs:385）——键=弹 id,值=记录式;
 *  缺省 -1 = 不记录（UpdateTrails 全跳）。 */
export const PROJ_TRAILING_MODE: Readonly<Record<number, number>> = {
  94: 0, 301: 0, 388: 0, 385: 0, 408: 0, 409: 0, 435: 0, 436: 0, 437: 0, 438: 0,
  452: 0, 459: 0, 462: 0, 502: 0, 503: 0, 466: 1, 532: 0, 533: 0, 573: 0, 580: 1,
  582: 0, 585: 0, 592: 0, 601: 0, 617: 0, 636: 0, 638: 0, 639: 0, 640: 0,
  424: 0, 425: 0, 426: 0, 1037: 0, 660: 0, 661: 0, 671: 2, 664: 0, 666: 0, 668: 0,
  675: 0, 680: 2, 682: 0, 684: 0, 686: 2, 700: 0, 706: 0, 709: 0, 710: 2, 711: 2,
  712: 0, 715: 2, 716: 2, 717: 2, 718: 2, 261: 0, 721: 0, 729: 2, 732: 0, 731: 0,
  739: 0, 740: 0, 741: 0, 742: 0, 743: 0, 744: 0, 745: 0, 746: 0, 747: 0, 748: 0,
  749: 0, 750: 0, 751: 0, 752: 0, 755: 2, 766: 2, 767: 2, 768: 2, 769: 2, 770: 2,
  771: 2, 811: 2, 814: 2, 822: 2, 823: 2, 824: 2, 826: 2, 827: 2, 828: 2, 829: 2,
  830: 2, 838: 2, 839: 2, 840: 2, 843: 2, 844: 2, 845: 2, 846: 2, 850: 2, 852: 2,
  853: 2, 856: 0, 857: 0, 864: 2, 873: 2, 872: 2, 833: 2, 834: 2, 835: 2, 818: 2,
  902: 0, 883: 0, 887: 0, 893: 0, 894: 0, 909: 0, 916: 2, 34: 3, 16: 3, 79: 3,
  931: 2, 933: 4, 946: 2, 964: 0, 965: 0, 977: 2, 976: 2, 973: 2, 106: 5, 85: 3,
  1001: 3, 1020: 2, 1024: 2, 1039: 2, 1026: 0, 1045: 2, 1047: 0, 1055: 0, 1089: 0,
  1090: 0, 1100: 4, 1097: 2, 1106: 3, 121: 2, 122: 2, 123: 2, 124: 2, 597: 2,
  125: 2, 126: 2, 1114: 0, 1120: 2, 563: 2,
};

/** ProjectileID.Sets.TrailCacheLength（ProjectileID.cs:387）——缺省 10。 */
export const PROJ_TRAIL_CACHE_LEN: Readonly<Record<number, number>> = {
  466: 20, 502: 25, 580: 20, 636: 20, 640: 20, 686: 20, 711: 20, 715: 20, 716: 20,
  717: 20, 718: 20, 261: 20, 721: 20, 729: 20, 731: 20, 739: 20, 740: 20, 741: 20,
  742: 20, 743: 20, 744: 20, 745: 20, 746: 20, 747: 20, 748: 20, 749: 20, 750: 20,
  751: 20, 752: 20, 766: 60, 767: 60, 768: 60, 769: 60, 770: 60, 771: 80, 814: 40,
  822: 80, 823: 80, 824: 60, 826: 60, 827: 65, 828: 60, 829: 60, 830: 80, 838: 80,
  839: 60, 840: 60, 843: 60, 844: 65, 845: 80, 846: 80, 850: 80, 852: 60, 853: 60,
  856: 2, 857: 2, 864: 60, 873: 60, 872: 120, 833: 20, 834: 20, 835: 20, 818: 20,
  883: 41, 887: 51, 893: 71, 894: 10, 909: 5, 916: 20, 34: 30, 16: 30, 79: 60,
  931: 20, 933: 60, 946: 20, 977: 30, 976: 60, 973: 20, 106: 15, 85: 60, 1001: 12,
  1020: 20, 1024: 40, 1039: 20, 1026: 10, 1045: 30, 1047: 25, 1089: 25, 1090: 10,
  1100: 60, 1097: 20, 1106: 60, 121: 30, 122: 30, 123: 30, 124: 30, 597: 30,
  125: 30, 126: 30, 1120: 20, 563: 60,
};

export function projTrailingMode(id: number): number {
  return PROJ_TRAILING_MODE[id] ?? -1;
}
export function projTrailCacheLen(id: number): number {
  return PROJ_TRAIL_CACHE_LEN[id] ?? 10;
}

// ===================== 记录面（Projectile.cs:17197-17300 逐式） =====================

/** oldPos/oldRot/oldSpriteDirection 三环 + 已填计数（原版未填槽=Vector2.Zero 哨兵,
 *  绘制/消费端跳过——本仓以 filled 计数承载同语义,世界原点 (0,0) 弹位不受误伤）。 */
export class ProjGhostRing {
  readonly cap: number;
  readonly mode: number;
  /** 扁平历史：槽 0=最新（原版 oldPos[0]）;未填槽读数=NaN（Zero 哨兵等价） */
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pr: Float64Array;   // oldRot（mode 2/3/4/5 记录）
  readonly pd: Int8Array;      // oldSpriteDirection（mode 2/3/4 记录）
  filled = 0;

  constructor(id: number) {
    this.cap = projTrailCacheLen(id);
    this.mode = projTrailingMode(id);
    this.px = new Float64Array(this.cap).fill(NaN);
    this.py = new Float64Array(this.cap).fill(NaN);
    this.pr = new Float64Array(this.cap).fill(NaN);
    this.pd = new Int8Array(this.cap);
  }

  /** 每子步位移后调（原版 UpdateTrails 位序）。isTickHead=本 tick 首子步
   *  （mode 4 玩家位移补偿只在 numUpdates==0 施加 :17283）;frameCounter=原版
   *  Projectile.frameCounter（mode 1 门 :17207,本仓 Arrow 无此字段→恒 0 档=每子步
   *  可记录,mode 1 仅 466/580（LightningBoltProj 自管）不受影响）。 */
  record(x: number, y: number, rot: number, dir: number,
    isTickHead: boolean, frameCounter = 0, playerDx = 0, playerDy = 0): void {
    const m = this.mode;
    if (m < 0) return;
    if (m === 1 && !(frameCounter === 0 || this.filled === 0)) return;   // :17207 门
    // ---- 位移链（全 mode 公共段 :17199-17201/:17210-17211/:17237-17240/...）----
    for (let i = this.cap - 1; i > 0; i--) {
      this.px[i] = this.px[i - 1]; this.py[i] = this.py[i - 1];
      if (m >= 2) { this.pr[i] = this.pr[i - 1]; this.pd[i] = this.pd[i - 1]; }
    }
    this.px[0] = x; this.py[0] = y;
    if (m === 2 || m === 3 || m === 4) {
      this.pr[0] = rot; this.pd[0] = dir;
    } else if (m === 5) {
      this.pr[0] = rot;    // mode 5：oldRot[0]=velocity.ToRotation()（:17296 调用方传）
    }
    if (this.filled < this.cap) this.filled++;
    // ---- mode 3：松弛单程（:17248-17273,amount=0.65,num26=1）----
    if (m === 3) {
      for (let i = this.cap - 1; i > 0; i--) {
        if (Number.isNaN(this.px[i])) continue;
        const dx = this.px[i - 1] - this.px[i], dy = this.py[i - 1] - this.py[i];
        if (Math.hypot(dx, dy) > 2) {
          this.px[i] += dx * 0.65; this.py[i] += dy * 0.65;
        }
        this.pr[i] = Math.atan2(dy, dx);
      }
    }
    // ---- mode 4：玩家位移补偿（:17274-17289,numUpdates==0 时旧槽 += 玩家帧位移）----
    if (m === 4 && isTickHead) {
      for (let i = 1; i < this.cap; i++) {
        if (!Number.isNaN(this.px[i])) { this.px[i] += playerDx; this.py[i] += playerDy; }
      }
    }
  }

  at(i: number): { x: number; y: number; rot: number; dir: number } | null {
    if (i < 0 || i >= this.cap || i >= this.filled) return null;   // Zero 哨兵+:31134 门
    return { x: this.px[i], y: this.py[i], rot: this.pr[i], dir: this.pd[i] };
  }
}

// ===================== 绘制面参数表（Main.cs:30609-31360 照录） =====================

/** 通用表逐型参数：start=num166/end=num164/step=num165/gScale=num167/denom=num168/
 *  rotMul=num169。缺省=表头初始化（1,8,2,1,15,0）（Main.cs:30724-30730）。
 *  动态档（459 scale×8、533 ai0 三态、1055 frame 系、388 ai0==2 长档）在
 *  drawProjGhosts 内展开。 */
interface GhostParams { start: number; end: number; step: number; gScale: number; denom: number; rotMul: number }
const P = (start: number, end: number, step: number, gScale: number, denom = 15, rotMul = 0): GhostParams =>
  ({ start, end, step, gScale, denom, rotMul });
const DEF = P(1, 8, 2, 1);

/** 通用残影表 id 全集（Main.cs:30609 长条件;golf 球 721/739-752 表内死条目不收——
 *  循环恒空,真尾迹在 :31471 专用块）。 */
export const GHOST_PARAMS: Readonly<Record<number, GhostParams>> = {
  261: P(18, 0, -2, 1.3),                          // 大地之杖滚石 :30771-30775
  408: DEF, 435: DEF, 682: DEF, 732: DEF,          // 缺省档
  424: P(1, 10, 2, 0.6), 425: P(1, 10, 2, 0.6), 426: P(1, 10, 2, 0.6),  // :30989-30992
  436: P(1, 8, 2, 0.5),                            // :30985-30988（仅 step/scale 覆写,end 留 8）
  438: P(1, 10, 2, 1),                             // :30997-31000
  452: P(1, 10, 3, 0.5),                           // :31001-31004
  459: P(1, 8, 2, 0.3),                            // 充能爆裂炮弹（end/step 动态 :31017-31024）
  454: P(1, 5, 1, 0.2),                            // :31005-31008
  462: P(1, 7, 1, 0.2),                            // :31009-31012
  503: P(1, 9, 3, 0.5),                            // 星怒 :30787-30790
  532: P(1, 10, 1, 0.7, 15, 0.2),                  // 骨头手套 :31054-31058
  533: P(1, 8, 2, 1),                              // 致命球（动态档 ai0∈[6,8] :31084-31098）
  573: DEF,                                        // 星云弹缺省档
  582: P(1, 10, 2, 0.7, 15, 0.2),                  // 机师扳手 :31036-31042
  585: P(1, 7, 1, 0.2),                            // 裁缝诅咒 :31013-31016
  592: P(1, 10, 2, 1),                             // 火星行者激光 :31094-31097
  601: P(1, 8, 1, 0.3),                            // 精门枪弹 :31090-31093
  636: P(1, 20, 3, 0.5),                           // 破晓 :31099-31102
  638: P(1, 5, 1, 1),                              // 月主子弹 :31051-31054
  639: P(1, 10, 1, 1),                             // 月主幻弓矢 :31081-31084
  640: P(1, 20, 1, 1),                             // 月主幻弓矢尾 :31077-31080
  661: P(1, 0, 1, 0.5),                            // 黑矢（死条目:1→0 空循环,黑环在 :31362 特支）
  664: P(1, 8, 2, 0.4), 666: P(1, 8, 2, 0.4), 668: P(1, 8, 2, 0.4),   // :31029-31032
  671: P(5, 0, -1, 2.6),                           // 火龙吐息 :30837-30841
  675: P(1, 5, 1, 0.4),                            // 暗师弹 :31021-31024
  680: P(1, 9, 3, 0.5),                            // 弩炮 :31085-31088
  684: P(1, 8, 1, 0.75),                           // 骑士音爆 :31025-31028
  686: P(19, 0, -3, 0.5),                          // 贝蒂火球 :30822-30827
  700: P(1, 5, 1, 2.6),                            // 僧杖二阶 :30862-30865
  706: P(9, 0, -2, 0.5),                           // 凤凰箭 :31045-31048
  709: P(1, 8, 2, 0.5),                            // 僧杖三阶副弹 :31049-31053
  710: P(9, 0, -2, 0.5),                           // 贝蒂箭 :31037-31040
  711: P(19, 0, -3, 0.5),                          // 学徒三阶弹 :30828-30833
  729: P(18, 0, -2, 1.3),                          // 超星斩 :30796-30800
  731: P(19, 0, -1, 0.5),                          // 雷弹 :30878-30881
  755: P(5, 0, -1, 2.6),                           // 蝠光 :30857-30861
  811: P(5, 0, -1, 2.6),                           // 血弹 :30842-30848
  814: P(18, 0, -1, 1),                            // 血鹦鹉螺弹 :30849-30856
  818: P(18, 0, -2, 1),                            // 白虎扑击 :30786-30790
  819: DEF,                                        // 血箭缺省档
  833: P(6, 0, -1, 1.5), 834: P(6, 0, -1, 1.5), 835: P(6, 0, -1, 1.5), // 磁暴虎 :30781-30785
  864: P(12, 0, -1, 1.4),                          // 悬浮魔剑 :30888-30892
  872: P(79, 0, -1, 1, 10),                        // 光女永恒虹 :30939-30945
  873: P(39, 0, -1, 1.4, 40),                      // 光女虹带 :30918-30923
  894: DEF, 901: DEF,                              // 宠物缺省档
  902: P(1, 10, 2, 0.7, 15, 0.2),                  // 战斗扳手 :31036-31042
  909: P(5, 0, -1, 1),                             // 岩巨石 :30766-30770
  916: P(19, 0, -1, 1.4),                          // 暗镰鞭 :30893-30898
  931: P(19, 0, -1, 0.7, 20),                      // 光女魔弹 :30924-30929
  964: P(1, 5, 1, 2.6), 965: P(1, 5, 1, 2.6),      // 微光暗影 :30866-30869
  976: P(18, 0, -3, 1.3),                          // 丛草刃弹 :30801-30806
  977: P(18, 0, -2, 1.3),                          // 村正弹 :30791-30795
  1001: P(10, 0, -2, 1.3),                         // 南瓜弹 :30807-30812
  1026: P(8, 0, -2, 0.5),                          // 藤壶弹 :30746-30750
  1037: DEF,                                       // 流星鞭流星缺省档
  1039: P(19, 0, -1, 0.7, 20),                     // 星座弹 :30936-30941
  1045: P(18, 0, -2, 1.3),                         // 月主鞭 proc :30812-30816
  1055: P(1, 8, 1, 1),                             // 骸巨石（end=frame 动态 :30728-30735）
  1097: P(19, 0, -3, 0.5),                         // 火绒狐火球 :30822-30827
  // ---- 专用帧残影四弹（形制同构并入;逐值 Main.cs:32543/:32563/:34867/:34895）----
  409: P(1, 10, 2, 0.5),                           // 剃刀台风（fade=(10−i)/15 ≡ 标准式,cacheLen=10）
  437: P(1, 10, 2, 0.2),                           // 吉加电矛（同上）
  385: P(1, 8, 2, 0.4),                            // 鲨龙卷（fade=Lerp(1,(8−i)/15,0.3) 特式→TINT 385）
  388: P(1, 2, 1, 1),                              // 痂王幼体（ai0==2→end=9 动态 :34903-34911）
};

/** 帧锚特支（Main.cs:30617-30726）+ 帧行进（916/873/976 逐槽推进 :31346-31362）。 */
export interface GhostFrameSpec {
  frameRow: 'cur' | 'zero' | 'next' | 'curHalfW' | 's976' | 'g873' | 'g916' | 'n408';
  originY?: number;      // 覆写 origin.Y（负值=自底 h+originY,如 686/711/1097 h−70）
  originX?: number | 'dirEdge';   // 'dirEdge'=W−20/20 按 spriteDirection（700/964/965）;负值=flip 条件偏移
  zeroHalfH?: boolean;   // 833-835 zero.Y+=h/2（:30703-30716）
  cellW?: number; cellH?: number;   // s976 32×18 单元
  /** ★BJ235 帧门（:30706/:30716）：833 frame==8 / 834-835 frame==10 时【整支跳过】
   *  ——rectangle4/origin8/zero 全回缺省档（帧矩形=cur 行、origin=帧心、zero 不偏移）。
   *  原文 `if (proj.type == 833 && proj.frame != 8) {…}`——门内才改锚。 */
  gateFrame?: number;
}
export const GHOST_FRAME: Readonly<Record<number, GhostFrameSpec>> = {
  503: { frameRow: 'cur', originY: 70 },             // :30643-30645
  686: { frameRow: 'cur', originY: -70 },            // originY=h−70 :30646-30648
  711: { frameRow: 'cur', originY: -70 },
  1097: { frameRow: 'cur', originY: -70 },
  438: { frameRow: 'zero' },                         // rect.Y=0 :30649-30651
  452: { frameRow: 'zero' },
  408: { frameRow: 'n408' },                         // rect.Y=num161（行+1,非帧系）:30655-30657
  636: { frameRow: 'cur', originY: 10 },             // :30658-30660
  638: { frameRow: 'cur', originY: 2 },              // :30661-30663
  639: { frameRow: 'cur', originY: 5 },              // :30664-30666
  640: { frameRow: 'cur', originY: 5 },
  710: { frameRow: 'cur', originY: 5 },
  700: { frameRow: 'cur', originX: 'dirEdge' },      // :30667-30669
  964: { frameRow: 'cur', originX: 'dirEdge' },      // :30674-30676
  965: { frameRow: 'cur', originX: 'dirEdge' },
  872: { frameRow: 'curHalfW' },                     // 半宽+右列 :30677-30679 + :30943 X+=Width
  833: { frameRow: 'cur', zeroHalfH: true, originY: -4, originX: -7, gateFrame: 8 },   // :30706-30713（frame==8 整支跳）
  834: { frameRow: 'cur', zeroHalfH: true, originY: -4, originX: -2, gateFrame: 10 },  // :30714-30721（frame==10 整支跳）
  835: { frameRow: 'cur', zeroHalfH: true, originY: -4, originX: -2, gateFrame: 10 },
  864: { frameRow: 'next' },                         // value16.Y+=Height（一次,:30892）
  916: { frameRow: 'g916' },                         // 逐槽行进 H,回绕 H×frames（:31346-31349）
  873: { frameRow: 'g873' },                         // 逐槽行进 H+2,回绕 (H+2)×7（:31358-31362）
  976: { frameRow: 's976', cellW: 32, cellH: 18 },   // 32×18 单元,逐槽行进 H+2=20 回绕 140（:30804/:31355-31361）
};

// ===================== 逐型色特支（Main.cs:31141-31344 + Projectile.cs 色函数） =====================

export interface TintCtx {
  id: number;
  i: number;             // 槽序
  start: number; end: number;
  fade: number;          // 标准渐隐 (end−i)/(len×1.5)（step<0 用 start−i）
  ai0: number; ai1: number;
  timeLeft: number;
  opacity: number;       // proj.Opacity（1−alpha/255）
  bodyScale: number;
  vxLen: number;         // |velocity|（833-835 白染门）
  rng: () => number;     // 916 播种随机（seed=timeLeft LCG,循环内顺序消费）
  /** ★BJ650件1：whoAmI（Projectile 实体序,Projectile.cs:80378 GetFloatingDagger-
   *  MinionGlowColor 消费)——缺省 0=旧 0 档近似（登记③ retired:864 消费） */
  whoAmI?: number;
}

/** 返回 [r,g,b] 染色（0-255）与 aMul（α 乘子=特支 A 面系数,1=A≡fade 档）。 */
export type GhostTintFn = (c: TintCtx) => { rgb: [number, number, number]; aMul: number; gScaleMul?: number } | null;

const lerpC = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
const getLerp = (f0: number, f1: number, v: number) => clamp01((v - f0) / (f1 - f0));

const BLUE: [number, number, number] = [0, 0, 255];
const WHITE: [number, number, number] = [255, 255, 255];

/** ★清偿 C1/R5-F1（2026-10-14）：XNA `Color * float` 逐字节截断量化单源——
 *  (byte)(c×f) = C# 显式转换截断（仓内判例 AuroraSky.ts:23 + 同文件 :10958
 *  「(byte)76.5=76」;Gore/Projectile 色式 ×0.7f 等同款）。消费位=GHOST_TINT[864]
 *  与 MinionProj glow864TexPair（864 辉光 ×0.7f 双面）——旧 JS Math.round 中点档
 *  +1（hue0 (57,61,157)≠XNA (57,60,156),R5 node 实算基准表六档三通道）。 */
export function xnaColorMulByte(rgb: readonly [number, number, number], f: number): [number, number, number] {
  return [Math.trunc(rgb[0] * f), Math.trunc(rgb[1] * f), Math.trunc(rgb[2] * f)];
}

// ---- ★清偿 C2/R5-F2（2026-10-14）：弹幕贴图覆盖通知注册表 ----
// RemasterRuntime.setProjSpriteOverride（Arrow.ts）就地换图后,依赖 projSprite 的
// 模块级烘焙缓存需失效（旧只清 Arrow 内 spriteCache/frameCache——GLOW864_CACHE
// 永驻旧剪影,辉光贴素材包旧模）。接线选本模块=Arrow 与 MinionProj 双方既有依赖
// （Arrow.ts:34 / MinionProj.ts:30 双向 import MinionProj↔Arrow 已成环,再拉直连
// 会加深环;注册表习语零新边）。
const projSpriteOverrideHooks: Array<(projId: number) => void> = [];
/** 订阅贴图覆盖失效通知（模块加载期注册一次） */
export function onProjSpriteOverride(fn: (projId: number) => void): void {
  projSpriteOverrideHooks.push(fn);
}
/** setProjSpriteOverride 内派发（同步、逐订阅者,异常面=订阅者自担） */
export function notifyProjSpriteOverride(projId: number): void {
  for (const fn of projSpriteOverrideHooks) fn(projId);
}

export const GHOST_TINT: Readonly<Record<number, GhostTintFn>> = {
  // ★BJ371：409 剃刀台风（GetAlpha 409 专属支 P.cs:81148-81151 恒 (250,250,250,200)
  //  不读 α——本体/残影同色;aMul=1 = 单笔 source-over 档,A 侧 200/255 由调用位
  //  bodyAlpha 承载（Arrow.draw 409 支）,fade=(10−i)/15 在环内通用式）
  409: () => ({ rgb: [250, 250, 250], aMul: 1 }),
  // ---- 蓝染 0.5 族（:31141-31143）----
  408: () => ({ rgb: lerpC(WHITE, BLUE, 0.5), aMul: 1 }),
  435: () => ({ rgb: lerpC(WHITE, BLUE, 0.5), aMul: 1 }),
  682: (c) => ({ rgb: [127.5, 127.5 / c.i, 255], aMul: 1 }),      // 蓝染 0.5 后 G/=i（:31141+:31301-31304）
  732: () => ({ rgb: lerpC(WHITE, BLUE, 0.5), aMul: 1 }),
  731: () => ({ rgb: lerpC(WHITE, BLUE, 0.5), aMul: 1 }),
  1026: () => ({ rgb: lerpC(WHITE, BLUE, 0.5), aMul: 1 }),
  436: () => ({ rgb: lerpC(WHITE, [50, 205, 50], 0.5), aMul: 1 }),   // LimeGreen :31144-31146
  424: (c) => ({ rgb: [255, 127.5 / c.i, 127.5 / c.i], aMul: 1 / c.i }),   // 红染 0.5 后 B,G,A/=i（:31147+:31318-31322）
  425: (c) => ({ rgb: [255, 127.5 / c.i, 127.5 / c.i], aMul: 1 / c.i }),
  426: (c) => ({ rgb: [255, 127.5 / c.i, 127.5 / c.i], aMul: 1 / c.i }),
  1037: (c) => ({ rgb: [255, 127.5 / c.i, 127.5 / c.i], aMul: 1 / c.i }),  // :31148+:31323-31327
  639: () => ({ rgb: WHITE, aMul: 0.5 }),                                     // A=127 :31151-31153
  640: (c) => ({ rgb: [255 / c.i, 255, 255], aMul: 0.5 }),                    // R/=i + A=127 :31207-31210/:31154
  671: (c) => ({ rgb: lerpC(WHITE, [160, 32, 240], clamp01(c.i / c.end)), aMul: 1 }),  // 紫 grad :31155-31157
  811: (c) => ({ rgb: lerpC(WHITE, [110, 10, 30], clamp01(c.i / c.end)), aMul: 1 }),   // 绯×0.5 grad :31158-31160
  814: (c) => ({ rgb: lerpC(WHITE, [127.5, 127.5, 127.5], clamp01(c.i / c.end)), aMul: 1 }),  // 自暗 grad :31161-31163
  261: (c) => ({ rgb: lerpC(WHITE, [60, 60, 60], clamp01(c.i / c.end)), aMul: 1 }),    // 灰 grad :31164-31166
  438: (c) => ({ rgb: [255, 255 / c.i, 255 / c.i], aMul: 1 }),                // G,B/=i :31205-31208
  755: () => ({ rgb: [220, 20, 60], aMul: 1 }),                               // AI_156_GetColor=Crimson（P.cs type755 支）
  873: (c) => {                                                              // AI_171_GetColor :31212-31217
    const rgb = hslToRgb255((c.ai1 + 0.5) % 1, 1, 0.5);
    return { rgb, aMul: 0.5 * getLerp(0, 20, c.timeLeft) };   // A/=2 × timeLeft 门
  },
  931: (c) => ({ rgb: hslToRgb255((c.ai1 + 0.5) % 1, 1, 0.5), aMul: 0.5 * getLerp(0, 20, c.timeLeft) }),  // FQW(0.5) :31218-31222
  1039: (c) => ({ rgb: hslToRgb255((c.ai1 + 0.5) % 1, 1, 0.5), aMul: 0.5 * getLerp(0, 20, c.timeLeft) }), // 星座(0.5) :31223-31227
  872: (c) => {                                                              // AI_173_GetColor :31228-31236
    const h0 = hslToRgb255((c.ai1 + 0) % 1, 1, 0.5);
    const rgb: [number, number, number] = [h0[0] * 0.4, h0[1] * 0.4, h0[2] * 0.4];
    let aMul = 0.6;
    if (c.i > 80) aMul *= 0.15 * getLerp(120, 80, c.i);
    return { rgb, aMul };
  },
  864: (c) => {                                                              // FDMGlow A/=4 :31237-31240
    // ★BJ650件1（2026-10-12）色式精化（GetFloatingDaggerMinionGlowColor P.cs:80377-80381
    //  1:1）：hue = 0.66 + 0.33×(whoAmI%6)/6（6 档蓝→品红循环,随弹序异色——旧 0 档
    //  近似登记③ retired）;s=0.7/l=0.6 → hslToRgb255;×0.7f = XNA 逐字节截断。
    //  ★清偿 C1/R5-F1（2026-10-14）：量化点上移至本表=xnaColorMulByte 截断单源
    //  （旧注释「byte 噪声在染色 bake 面内」实为下游 :629 Math.round=中点档 +1,
    //  hue0 (57,61,157)≠XNA (57,60,156);与 MinionProj glow864TexPair 同函数）。
    //  下游 tintedTex Math.round 对已整值幂等。A 面：255×0.7→(byte)178 → /4=44
    //  （C# byte 整除,旧 aMul=0.25 忽略 ×0.7 的 A 通道=1.45× 过亮,retired）。
    const hue = 0.66 + 0.33 * (((c.whoAmI ?? 0) % 6) / 6);
    const h0 = hslToRgb255(hue, 0.7, 0.6);
    return {
      rgb: xnaColorMulByte(h0, 0.7),
      aMul: Math.trunc(Math.trunc(255 * 0.7) / 4) / 255,   // (byte)178 → /4=44（byte 整除）→ 44/255
    };
  },
  686: (c) => {                                                              // 紫/黑两段 :31241-31252
    const t = c.i / c.start;
    const rgb = t < 0.5
      ? lerpC(WHITE, [160, 32, 240], getLerp(0, 0.5, t))
      : lerpC([160, 32, 240], [0, 0, 0], getLerp(0.5, 1, t));
    return { rgb, aMul: 1 };
  },
  1097: (c) => {                                                             // 橙红/红两段+ai1 :31253-31271
    const t = c.i / c.start;
    let rgb = t < 0.5
      ? lerpC(WHITE, [255, 69, 0], getLerp(0, 0.5, t))
      : lerpC([255, 69, 0], [255, 0, 0], getLerp(0.5, 1, t));
    let gMul: number | undefined;
    if (c.ai1 === 1) {
      rgb = lerpC(rgb, [255, 0, 0], clamp01(t * 3));
      rgb = lerpC(rgb, [0, 0, 0], getLerp(0.33, 0.66, t));
      gMul = 1.25;
    }
    return { rgb, aMul: 1, gScaleMul: gMul };
  },
  711: (c) => {                                                              // 紫/黑两段+A 环 :31272-31282
    const t = c.i / c.start;
    const rgb = t < 0.5
      ? lerpC(WHITE, [128, 0, 255], getLerp(0, 0.5, t))
      : lerpC([128, 0, 255], [0, 0, 0], getLerp(0.5, 1, t));
    const a = t < 0.5 ? 1 - 0.2941 * getLerp(0, 0.5, t) : 0.7059 + 0.2941 * getLerp(0.5, 1, t);
    return { rgb, aMul: a };
  },
  684: (c) => {                                                              // :31284-31293
    let k = 1 / c.i;
    if (c.i === 1) k /= 2;
    return { rgb: [255, 255 * k, 255 * k], aMul: k };
  },
  // ★BJ704-G2（2026-10-21,ghost 缺面 7 员清算）706 GetAlpha 专属支勘误——原版
  //  color38 = GetAlpha(:80830-80833 `706 → (255−α,255−α,255−α,180−⌊α/2⌋−⌊α/4⌋)`
  //  int 除法、负 A byte 钳 0)【先于】/=i 段（:31273-31278 B,G,A/=num170）——旧表
  //  白底 /i 漏 GetAlpha 面（淡入期残影偏亮,A 恒 255/i 过实;alpha=255 出拍 A=0
  //  全隐=原版环爆前不可见）。rgb=A/=i 通道=byte 除截断。
  706: (c) => {
    const a = Math.round(255 * (1 - c.opacity));
    const w = 255 - a;
    const aBase = Math.max(0, 180 - Math.trunc(a / 2) - Math.trunc(a / 4));
    return {
      rgb: [w, Math.trunc(w / c.i), Math.trunc(w / c.i)],
      aMul: Math.trunc(aBase / c.i) / 255,
    };
  },
  710: (c) => ({ rgb: [255, 255 / c.i, 255 / c.i], aMul: 1 / c.i }),
  // ★BJ704-G2：459/709 GetAlpha :81063-81066 同支 `(255,255,255,200)` 恒（不读
  //  alpha 淡入——AI 的 α−30 全无视觉面）→ 白染 + A 面 200/255（409 同族先例
  //  走调用位 bodyAlpha,本组走 aMul 档与 GHOST_TINT 单源一致）。
  459: () => ({ rgb: WHITE, aMul: 200 / 255 }),
  709: () => ({ rgb: WHITE, aMul: 200 / 255 }),
  818: (c) => {                                                              // OurFavoriteColor :31299-31306
    const k = getLerp(0, 0.3, c.ai0) * getLerp(1, 0.7, c.ai0);
    const ofc: [number, number, number] = [255, 231, 69];
    return {
      rgb: [
        ofc[0] * k + (255 - ofc[0] * k) * k,
        ofc[1] * k + (255 - ofc[1] * k) * k,
        ofc[2] * k + (255 - ofc[2] * k) * k,
      ],
      // ★BJ704-G2（2026-10-21）aMul 1→0 勘误：原版 ourFavoriteColor.A=0 ∧
      //  value17=(255,255,255,0).A=0 → Lerp A≡0 → A=0 纯加法（833-835 同族;
      //  旧 aMul=1=source-over 黑染衰减背景——延迟相 ai0<0 时 num175=0 → 全黑
      //  残影可见遮暗,原版加法黑=零贡献不可见）。
      aMul: 0,
    };
  },
  // ★BJ235 补速染因子（:31307-31314 逐值）——lerpValue2 = GetLerpValue(0,6,|velocity|)
  //  （≤0 → 0,≥6 → 1）;原式 color38 = Lerp(color38,White,l×0.5) 后 A=0、color38*=l。
  //  白染预混项的 base=projectileColor（光照域）→ 本仓光照走 compositeLight 全屏乘,
  //  染侧只承载 ×l 因子（全亮格处 1:1;暗格差=格光项,登记②同账）。A=0 → 纯加法
  //  单 'lighter' 笔,aMul=0（globalAlpha=fade 承载 :31329 的 ×fade）。
  833: (c) => { const l = clamp01(c.vxLen / 6); return { rgb: [255 * l, 255 * l, 255 * l] as [number, number, number], aMul: 0 }; },
  834: (c) => { const l = clamp01(c.vxLen / 6); return { rgb: [255 * l, 255 * l, 255 * l] as [number, number, number], aMul: 0 }; },
  835: (c) => { const l = clamp01(c.vxLen / 6); return { rgb: [255 * l, 255 * l, 255 * l] as [number, number, number], aMul: 0 }; },
  592: (c) => ({ rgb: [255 / c.i, 255 / c.i, 255], aMul: 1 }),               // R,G/=i :31315-31317
  964: (c) => ({ rgb: [0, 0, 0], aMul: 1 }),                                 // Black×Opacity（opacity 走 bodyAlpha 面）:31328-31330
  965: (c) => ({ rgb: [0, 0, 0], aMul: 1 }),
  385: (c) => ({ rgb: WHITE, aMul: (0.3 + 0.7 * (8 - c.i) / 15) / c.fade }), // Lerp(1,(8−i)/15,0.3) 折算 :34879-34883
};

// ===================== 绘制面 =====================

/** 循环参数解析（静态表+动态档展开;纯函数——单测/绘制共用）。
 *  返回 null = 该 id 不在通用表（或 step==0 死条目 → 循环体不执行）。 */
export function resolveGhostLoop(
  id: number, ai0: number, frame: number, bodyScale: number,
): { start: number; end: number; step: number; gScale: number; denom: number; rotMul: number } | null {
  const p = GHOST_PARAMS[id];
  if (!p) return null;
  let { start, end, step, gScale, denom, rotMul } = p;
  if (id === 459) {                                    // :31017-31024（scale×8 档）
    end = Math.trunc(bodyScale * 8);
    step = Math.trunc(end / 4);
    if (step < 1) step = 1;
    gScale = 0.3;
  } else if (id === 533) {                             // :31084-31098（ai0 三态）
    if (ai0 >= 6 && ai0 <= 8) {
      end = ai0 === 6 ? 8 : 4;
      step = 1;
      rotMul = ai0 !== 7 ? 0.2 : 0;
    } else {
      end = 0; step = 0;
    }
  } else if (id === 1055) {                            // :30728-30735（frame 系）
    end = frame;
    if (frame === 8) end--;
    if (frame === 9) end -= 2;
  } else if (id === 388) {                             // :34903-34911（ai0==2 长档）
    end = ai0 === 2 ? 9 : 2;
    step = 1;
  }
  if (step === 0) return null;
  return { start, end, step, gScale, denom, rotMul };
}

export interface DrawGhostOpts {
  ring: ProjGhostRing;
  id: number;
  tex: Tex | null;              // 本体贴图（projSprite 产物;调用方判空后直传）
  frames: number;               // projFrames[id]（帧矩形行高除数）
  frame: number;                // 当前帧序
  bodyW: number; bodyH: number; // 本体盒尺寸（世界 px——zeroHalfH/位置消费）
  bodyRot: number;              // 本体有效旋转（mode 0 档 ghost 角=本体角,:31333）
  bodyScale: number;            // proj.scale
  bodyAlpha: number;            // GetAlpha 承载面（drawGlobalAlpha 产物 0-1）
  ai0: number; ai1: number;
  timeLeft: number;
  opacity: number;
  vxLen: number;
  spriteDirection: number;      // 当前 spriteDirection 语义（dirEdge 锚/镜像偏移;登记①）
  /** ★BJ650件1：whoAmI（弹实体序,864 辉光色相消费;缺省 0=旧 0 档近似） */
  whoAmI?: number;
  /** ★BJ700-A（2026-10-20）mode0 本体翻转：原版 ghost 恒吃本体当前翻转
   *  `SpriteEffects spriteEffects = dir`（Main.cs:31334——dir=DrawProjDirect
   *  :30530-30534 的 spriteDirection==−1 → FlipHorizontally）。本仓 mode0 原无
   *  翻转通道（仅 mode2/3/4 吃 oldSpriteDirection XOR）;408（PROJ_ROT_RIGHT
   *  左飞镜像族）首例接入。
   *  ★BJ703-B D1（2026-10-21）dir 基底扩权：本参=「本体当前翻转」单源,全 mode 消费
   *  ——mode0/1/5 直取（:31334）;mode2/3/4 作 XOR 基底（:31336-31344
   *  `spriteEffects = dir ^ oldSpriteDirection[i]`,豁免 1001/933/1100=基底直取）。
   *  基底消费面（1457 全量普查,AI 函数逐支核）=755（AI_156 :52446-52451 每拍
   *  spriteDirection=player.direction‖sign(vx),MinionProj facing 同源）/
   *  833-835（AI_067 :50753-50970 多写位,MinionProj facing 同源）/1001
   *  （AI_194 :42056 sign(vx),豁免档=基底直取,Arrow 传 vx<0）;其余 mode2/3/4
   *  成员（671/680/686/710/711/729/811/814/872/873/931/976/977/1039/1045/1097/
   *  864…）原版 AI 全程无 spriteDirection 写（基底恒 None）→ 缺省 undefined
   *  =现状零改动。缺省 undefined=全族现状零改动。
   *  ★BJ704-G9（2026-10-21,R1-P1-2 勘误销案）普查表勘正——533 系【mode0】
   *  （TrailingMode[533]=0,ProjectileID.cs:385）非 mode2/3/4 员,旧列误并;
   *  且「aiStyle-66 块尾 :30712 spriteDirection=direction ⇒ 387/388/533 幽灵按
   *  dir 翻」系【结构误植】:亲证括号平衡,:30712 位于 aiStyle-【68】块尾
   *  （:30654-30729,成员仅 399/669）;aiStyle-66 块=:30084-30649,【零】
   *  spriteDirection 写（AI_066_TryInterceptingTarget :43142 同零写）⇒
   *  387/388/533 spriteDirection 恒 1（SetDefaults 缺省）→ dir 恒 None →
   *  mode0 幽灵（:31334 直取）与本体均【恒不翻】——仓内 mirror 恒 false=
   *  1:1 正确,R1-P1-2 假信念销案,勿再收编 533/388 入翻转集。864/946 本体
   *  不翻同谳（AI_169_Smolstars :46559-46700 零写/AI_156 :52457 写位仅 755 支）
   *  ——「本体不翻=存量债」登记随销。*/
  mirror?: boolean;
  /** ★BJ704-G2（2026-10-21）调用侧整色覆写（GHOST_TINT 无法自取的运行时色）：
   *  601 GetAlpha :80870-80873 `→ PortalHelper.GetPortalColor(owner,ai[0])` 整支
   *  替换 color38（PortalHelper.cs:380-394 A=66）→ rgb=门色、aMul=66/255——
   *  调用位（PortalGunBolt.draw）持 form 直取 portalColor 传入。设置即短路
   *  GHOST_TINT[id]。 */
  tintOverride?: { rgb: [number, number, number]; aMul: number };
}

/** 通用残影绘制（Main.cs:31134-31349 循环 1:1）。在【本体之前】调用（原版残影块
 *  先于本体绘制段）。Zero 哨兵=未填槽跳过;超环长跳过（:31134）;661 死条目天然空循环。 */
export function drawProjGhosts(ctx: Ctx, o: DrawGhostOpts): void {
  const loop = resolveGhostLoop(o.id, o.ai0, o.frame, o.bodyScale);
  if (!loop || !o.tex) return;
  const { ring } = o;
  if (ring.mode < 0) return;
  const { start, end, step, gScale, denom, rotMul } = loop;
  let spec = GHOST_FRAME[o.id];
  if (spec && spec.gateFrame !== undefined && o.frame === spec.gateFrame) {
    spec = { frameRow: 'cur' };   // ★BJ235 帧门（:30706/:30716）——门命中整支回缺省档
  }
  const frames = Math.max(1, o.frames);
  const img = o.tex;
  const iw = img.width, ih = img.height;
  // ---- 帧矩形（rectangle4/value16;逐型覆写照录）----
  let sx = 0, sy = 0, sw = iw, sh = Math.floor(ih / frames);
  let ox = sw / 2, oy = sh / 2;
  if (spec) {
    switch (spec.frameRow) {
      case 'zero': sy = 0; break;
      case 'n408': sy = sh; break;
      case 'next': sy = sh * (o.frame + 1); break;                 // value16.Y+=Height（一次,自当前帧行 :30892）
      case 'cur': sy = sh * o.frame; break;
      case 'curHalfW': sw = Math.floor(iw / 2); ox = sw / 2; sx = iw - sw; sy = sh * o.frame; break;
      case 's976': sw = 32; sh = 18; sy = 18 * o.frame; ox = 16; oy = 9; break;
      case 'g873': sh = Math.floor(ih / 7); sy = sh * o.frame; ox = sw / 2; oy = sh / 2; break;
      // ★BJ704-G11（件5b）：916 除数 7→6 勘正——projFrames[916]=6（Main.cs:8592）,
      //  ghost 帧矩形 = rectangle4 = 帧高 ih/6;873 的 /7 系 ghost 循环硬编码行数
      //  （:31380 num180×7,projFrames[873] 无赋值）不可混源。本 spec 现无消费载体
      //  （鞭族无 ghost 环,WhipProj 不经 drawProjGhosts）——除数随判语勘正防未来
      //  鞭 ghost 刀继承错值,载体缺口维持登记（whip ghost 域）。
      case 'g916': sh = Math.floor(ih / 6); sy = sh * o.frame; ox = sw / 2; oy = sh / 2; break;
    }
    if (spec.originY !== undefined) {
      oy = spec.originY < 0 ? sh + spec.originY : spec.originY;
    }
    if (spec.originX === 'dirEdge') {
      ox = o.spriteDirection === 1 ? sw - 20 : 20;
    } else if (spec.originX !== undefined && spec.originX < 0) {
      // ★BJ704-G11（件1）：833-835 origin8.X −= 7|2×ToDirectionInt（Main.cs:30711/
      //  :30718,Utils.cs:2131 flip?1:−1）——右向 W/2+7|2 / 左向 W/2−7|2。旧 0/1 乘数
      //  =右向漏 +7|2px（G10「ghost 侧已建模同值」表述勘误:帧门/zeroHalfH 同值,
      //  乘数语义差一角）;ghost 绘制与本体共用 origin8/zero（:31383 直传）。
      ox += spec.originX * (o.spriteDirection === -1 ? 1 : -1);
    }
  } else {
    sy = sh * o.frame;
  }
  // 916 播种随机（_tempSeededRandom.SetSeed(timeLeft)——LCG 简种,循环内顺序消费）
  let rngState = (Math.max(1, Math.abs(Math.trunc(o.timeLeft))) | 0) || 1;
  const rng = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) | 0;
    return ((rngState >>> 9) % 1000) / 1000;
  };
  const cacheLen = ring.cap;
  const mirrorExempt = o.id === 1001;                    // 1001/933/1100 豁免（933/1100 不在本表）
  for (let i = start; (step > 0 && i < end) || (step < 0 && i > end); i += step) {
    if (i >= cacheLen) continue;                          // :31134 环长门
    const slot = ring.at(i);
    if (!slot) continue;                                  // Zero 哨兵
    const fade = (step < 0 ? start - i : end - i) / (cacheLen * 1.5);   // :31331-31336
    // ---- 色（:31137-31330 特支链）----
    let rgb: [number, number, number] = WHITE;
    let aMul = 1;
    let gScaleEff = gScale;
    let alphaOverride = -1;                               // 916 专用 fade 替换
    const tint = GHOST_TINT[o.id];
    if (o.tintOverride) {                                 // ★BJ704-G2：调用侧整色覆写（601 门色）
      rgb = o.tintOverride.rgb; aMul = o.tintOverride.aMul;
    } else if (o.id === 916) {                                   // :31346-31357 整色替换
      const roll = rng();
      rgb = roll >= 2 / 3 ? [0, 0, 0]
        : lerpC([106, 90, 205], [0, 0, 0], 0.2 + 0.8 * rng());
      alphaOverride = getLerp(0, cacheLen * 0.75, step < 0 ? start - i : end - i);
    } else if (tint) {
      const t = tint({ id: o.id, i, start, end, fade, ai0: o.ai0, ai1: o.ai1,
        timeLeft: o.timeLeft, opacity: o.opacity, bodyScale: o.bodyScale,
        vxLen: o.vxLen, rng, whoAmI: o.whoAmI });
      if (t) { rgb = t.rgb; aMul = t.aMul; if (t.gScaleMul) gScaleEff *= t.gScaleMul; }
    }
    const fadeEff = alphaOverride >= 0 ? alphaOverride : fade;
    // ---- 姿态（:31333-31347）----
    const useOldRot = ring.mode === 2 || ring.mode === 3 || ring.mode === 4;
    // ★BJ703-B D1（2026-10-21）dir 基底全 mode 接通（原版 :31330-31344 逐字）:
    //  SpriteEffects dir = 本体当前翻转（DrawProjDirect :30530-30534,mirror 传参）;
    //  mode2/3/4 非豁免 = dir XOR oldSpriteDirection[i]（:31340-31344）、豁免
    //  （1001/933/1100）= dir 直取;mode0/1/5 = dir 直取（:31334,分支外=基底原样）。
    //  drawOnce 的 rotate→scale(-1,1) 合成 = XNA R(rot)∘M 同相（BJ700-A 已证）。
    const dirFlip = o.mirror === true;                                 // dir 基底
    const ghostFlip = useOldRot
      ? (mirrorExempt ? dirFlip : dirFlip !== (slot.dir === -1))       // XOR 镜像
      : dirFlip;
    // ★BJ704-G10 卫生注（R2-F8）：rotMul 项翻转因子原版 :31385 用【基底 dir】
    //  （`−((dir & FlipHorizontally)!=0).ToDirectionInt()`）,本仓用 ghostFlip
    //  （mode2/3/4 的 XOR 结果）。现员两式同值——rotMul≠0 全员（532/582/902 mode0;
    //  533 ai0∈[6,8] 档 MinionProj 蝙蝠不翻转族）基底≡XOR 结果;未来出现
    //  「mode2/3/4 + rotMul≠0 + 翻转员」组合时两式分叉,届时按 :31385 改用 dirFlip。
    const flipMul = ghostFlip ? -1 : 1;
    const rot = (useOldRot ? slot.rot : o.bodyRot)
      + o.bodyRot * rotMul * (i - 1) * flipMul;
    // ---- 位置（:31330-31331 + :31351 绘制位）----
    let gx = slot.x + o.bodyW / 2;
    let gy = slot.y + o.bodyH / 2;
    if (spec?.zeroHalfH) gy += o.bodyH / 2;               // 833-835 zero.Y+=h/2
    if (o.id === 916) {                                   // NextVector2Circular(8,8) 抖动
      const aJ = rng() * Math.PI * 2, rJ = rng() * 8;
      gx += Math.cos(aJ) * rJ; gy += Math.sin(aJ) * rJ;
    }
    const scale = o.bodyScale + (gScaleEff - o.bodyScale) * (i / denom);  // Lerp(bodyScale,gScale,i/denom)
    // ---- 帧行进（916/873/976 逐槽累积推进）----
    let syI = sy;
    if (o.id === 873) {
      const rh = Math.floor(ih / 7) + 2;
      syI = (sh * o.frame + rh * (i - start + 1)) % (rh * 7);
    } else if (o.id === 916) {
      syI = (sh * (o.frame + (i - start + 1))) % (sh * frames);
    } else if (o.id === 976) {
      syI = (18 * o.frame + 20 * (i - start + 1)) % 140;
    }
    // ---- 预乘双笔（aMul==1 单笔 source-over 与 XNA 逐项相等;否则 cut+add 两笔）----
    const addGa = Math.max(0, Math.min(1, o.bodyAlpha * fadeEff));
    const cutGa = Math.max(0, Math.min(1, o.bodyAlpha * fadeEff * aMul));
    if (addGa <= 0 && cutGa <= 0) continue;
    // ★BJ371：flatten=true→false（白底大方块根因,头注 BJ371 刀位注）——
    //  染色后保 alpha 形状 = XNA 预乘 src.rgb=tex.rgb×tex.a×color 语义
    const addTex = tintedTex(img, [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])], false);
    if (!addTex) continue;
    const drawOnce = (tex: Tex, ga: number, blend: GlobalCompositeOperation): void => {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = ga;
      ctx.globalCompositeOperation = blend;
      ctx.translate(gx, gy);
      ctx.rotate(rot);
      if (ghostFlip) ctx.scale(-1, 1);
      ctx.drawImage(tex, sx, syI, sw, sh, -ox * scale, -oy * scale, sw * scale, sh * scale);
      ctx.restore();
    };
    // ★BJ371（2026-09-27 用户实报「剃刀台风白底大方块」定谳刀）：addTex 染面
    //  flatten=true 会把贴图透明域 multiply 填成【不透明染色底】（canvas multiply:
    //  αb=0 域 Co=Cs,αo=1——页内微测 srcOpaquePx 5028→13872 全幅填实,探针
    //  _bj371-typhoon-verdict M1）——409 白染面画 source-over=半透白底大方块
    //  （用户症状①）；aMul<1 族 'lighter' 面同把白底全额加算=同族白块。
    //  XNA SpriteBatch 预乘语义 src.rgb=tex.rgb×tex.a×color.rgb——canvas 复刻必须
    //  保 alpha 形状（flatten=false）：单笔 source-over+ga=色.a 与预乘逐项相等，
    //  'lighter' 面贡献=tex.rgb×color×tex.a×ga（透明域贡献 0）——两式均正确。
    if (aMul >= 0.999) {
      drawOnce(addTex, addGa, 'source-over');
    } else {
      const cutTex = tintedTex(img, [0, 0, 0], false);
      if (cutTex && cutGa > 0) drawOnce(cutTex, cutGa, 'source-over');   // A 衰减面（黑×aMul×fade）
      drawOnce(addTex, addGa, 'lighter');                                // rgb 贡献面
    }
  }
}

// ===================== ★BJ235 接线续批：四特支链/带绘制面 =====================
// 以下四式在原版都是 DrawProjDirect 内【自管 oldPos 环】的专用块（不进 :30609
// 通用表），记录面共用 ProjGhostRing（TrailingMode 表驱动）。调用位约定：
//   绿带 1020/1024/1026 = DrawProjDirect 头（:28508-28561,先于一切）;
//   Celeb2 715-18 链 = 第二本体支锚链内（:33997-34083,先于本体）;
//   1089 彩虹荧光棒链 = 本体后（:33270-33306）;563 Gradient 轨 = 本体后（:35283-35299）。
// 光照：四式原版【不乘 projectileColor】（自着色）——本仓实体层统一被 compositeLight
// 全屏乘（repo 习语,Renderer.ts:7216 判例），563 原版逐槽 Lighting.GetColor 与
// 976 的逐槽亮度（:31368）在 repo 侧由同一全屏乘按像素粒度承载 = 双方 1:1，
// 不再逐槽 lightAt（避免双乘过暗,同 WoF 判例）。

/** DrawTrail（Main.cs:28309-28328）——绿带 1020/1024/1026 共享体。
 *  MagicPixel 1×1 白像素 ×(4, segLen) 条带,origin=(0.5,1)（底心）、rot=段向+π/2；
 *  逐段 α 因子 = Remap(i,0,cap,1,0) = 1−i/cap。
 *  baseColor×A：1020 两遍 (±10,2) 偏移 (177,255,32) A=127（:28301-28307,偏移随
 *  oldRot 旋——mode 2 环已记）；1024/1026 单遍零偏移 (140,234,180) A=255（:28556/:28559）。
 *  原 1×1 白像素条带在 canvas 直译 = fillRect(0,−2,len,4)（段向旋转系内 4px 宽带）。 */
export function drawGreenBandTrail(
  ctx: Ctx, ring: ProjGhostRing, id: number,
  sizeW: number, sizeH: number, bodyAlpha = 1,
): void {
  const cap = ring.cap;
  const pass = (offX: number, offY: number, rgb: [number, number, number], aBase: number): void => {
    for (let i = cap - 1; i > 0; i--) {
      const s0 = ring.at(i), s1 = ring.at(i - 1);
      if (!s0) continue;                                   // oldPos[i]==Zero 哨兵（:28320）
      if (!s1) continue;                                   // 本仓哨兵语义同域（未填槽跳）
      // 偏移随各槽 oldRot 旋（:28321/:28322）——mode0 环 oldRot 缺省 0（本仓 NaN 哨兵
      // → 归零,vanilla float 数组零值同相;1026 mode0 ×零偏移=死码同相）
      const a0 = Number.isFinite(s0.rot) ? s0.rot : 0;
      const a1 = Number.isFinite(s1.rot) ? s1.rot : 0;
      const x1 = s0.x + sizeW / 2 + (offX * Math.cos(a0) - offY * Math.sin(a0));
      const y1 = s0.y + sizeH / 2 + (offX * Math.sin(a0) + offY * Math.cos(a0));
      const x0 = s1.x + sizeW / 2 + (offX * Math.cos(a1) - offY * Math.sin(a1));
      const y0 = s1.y + sizeH / 2 + (offX * Math.sin(a1) + offY * Math.cos(a1));
      const len = Math.hypot(x0 - x1, y0 - y1);
      if (!(len > 0)) continue;
      const k = Math.max(0, Math.min(1, 1 - i / cap));     // num4（:28325 Remap 1→0）
      const ga = Math.max(0, Math.min(1, aBase * k * bodyAlpha));
      if (ga <= 0) continue;
      ctx.save();
      ctx.globalAlpha = ga;
      ctx.fillStyle = `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
      ctx.translate(x1, y1);
      ctx.rotate(Math.atan2(y0 - y1, x0 - x1));
      ctx.fillRect(0, -2, len, 4);                          // MagicPixel ×(4,len)
      ctx.restore();
    }
  };
  // ★清偿刀 N（2026-09-30）：1020 支退役——1020 载体已随刀 A 改挂 DroneProjs 实体
  //  （JimsDroneProj.draw 自带双尾迹+本体）,Arrow 不再携带 1020=本函数 1020 分支
  //  死支摘除;且 1020 原版 DrawContinuousTrail（Main.cs:28301-28328）有 cPet 染料门
  //  （cPet==0 绿带 127/255、cPet!=0 白带过整弹染料 pass）,染色版在 DroneProjs 落地
  //  （src/data/projDye.ts dyedSolidBand）,本函数仅承载无染料门的 1024/1026。
  if (id === 1024 || id === 1026) {
    pass(0, 0, [140, 234, 180], 1);                        // :28556-28561
  }
}

/** Celeb2 烟花链（Main.cs:33997-34083）——715-718 三帧横条【第 2 帧】沿段链。
 *  逐段：锚 = oldPos[i]+size/2、rot=oldRot[i]、origin=(帧宽/2,0)、
 *  scale=(段长/帧宽, 1)、color = GetCeleb2Color()×0.8（A=127→0.8×127/255）
 *  ×(1−i/20)；变体 2（Gold）＝i+timeLeft mod 20 摆动表 ±(1..3)×4px 沿段向 + scale×0.6
 *  （:34020-34062）；变体 5（紫）scale×0.5（:34064-34066）。 */
export function drawCeleb2Chain(
  ctx: Ctx, ring: ProjGhostRing, tex: Tex | null,
  baseColor: [number, number, number], variant: number,
  timeLeft: number, sizeW: number, sizeH: number, frameW: number, frameH: number,
): void {
  if (!tex) return;
  const cap = ring.cap;
  const fx = frameW * 2;                                    // value112.X += W×2（:34006 第 2 帧）
  const aBase = (127 / 255) * 0.8;                          // celeb2Color.A=127 ×0.8（:34003-34004）
  const WOB: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 1, 7: -1, 8: -2, 9: -3, 10: -2, 11: -1 };
  for (let i = cap - 1; i > 0; i--) {
    const s0 = ring.at(i), s1 = ring.at(i - 1);
    if (!s0) continue;                                      // vector102==vector101 哨兵（:34009）
    if (!s1) continue;
    const x1 = s0.x + sizeW / 2, y1 = s0.y + sizeH / 2;
    const x0 = s1.x + sizeW / 2, y0 = s1.y + sizeH / 2;
    const len = Math.hypot(x0 - x1, y0 - y1);
    const rot = Number.isFinite(s0.rot) ? s0.rot : 0;       // num412 = oldRot[i]（mode 2;mode0 归零）
    let sxMul = len / frameW;                               // scale17.X（:34012）
    let syMul = 1;
    let wx = 0, wy = 0;
    if (variant === 2) {                                    // :34015-34062
      let ph = (i + Math.trunc(timeLeft)) % 20;
      if (ph < 0) ph += 20;
      const w = WOB[ph] ?? 0;
      wx = Math.cos(rot) * w * 4;                           // vector103=oldRot 单位向 ×w×4
      wy = Math.sin(rot) * w * 4;
      sxMul *= 0.6; syMul *= 0.6;
    } else if (variant === 5) {                             // :34064-34066
      sxMul *= 0.5; syMul *= 0.5;
    }
    const k = 1 - i / cap;                                  // color110（:34013）
    const ga = Math.max(0, Math.min(1, aBase * k));
    if (ga <= 0) continue;
    ctx.save();
    ctx.globalAlpha = ga;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x1 + wx, y1 + wy);
    ctx.rotate(rot);
    ctx.drawImage(tex as CanvasImageSource, fx, 0, frameW, frameH,
      -frameW / 2 * sxMul, 0, frameW * sxMul, frameH * syMul);   // origin=(W/2,0)（:34005）
    ctx.restore();
  }
}

/** 彩虹荧光棒链（Main.cs:33270-33306）——1089 专用 MagicPixel 段带。
 *  色 = (DiscoR,DiscoG,DiscoB) A=127；带宽 2.2×2=4.4、长=段长（1×1 像素直译 fillRect）；
 *  双端渐隐：num342=1 起【新端】i≤10 逐槽 −0.1（先取值后减,:33288-33294）——
 *  槽 i≤10 依次 ×1,0.9,…,0.1；num344=0 起【最老非零槽】起 13 槽内逐槽 +1/13（≤1）——
 *  老端渐显爬坡（:33295-33302）。alpha = 127/255 × num342 × num344。 */
export function drawRainbowChain(
  ctx: Ctx, ring: ProjGhostRing, disco: [number, number, number],
  sizeW: number, sizeH: number,
): void {
  const cap = ring.cap;
  let newestFade = 1;                                       // num342（:33283）
  let oldestRamp = 0;                                       // num344（:33284）
  let oldestSeen = -1;                                      // num347（首个非零槽,只记一次 :33286-33289）
  const ramp = 1 / 13;                                      // num346 = 1/13（:33282）
  for (let i = cap - 1; i > 0; i--) {
    const s0 = ring.at(i), s1 = ring.at(i - 1);
    if (!s0) continue;                                      // vector84==vector83 哨兵（:33285）
    if (!s1) continue;
    if (oldestSeen === -1) oldestSeen = i;
    const x1 = s0.x + sizeW / 2, y1 = s0.y + sizeH / 2;
    const x0 = s1.x + sizeW / 2, y0 = s1.y + sizeH / 2;
    const len = Math.hypot(x0 - x1, y0 - y1);
    const rot = Math.atan2(y0 - y1, x0 - x1);               // rotation28=段向（−π/2 由 origin 系承担）
    const ga0 = newestFade * oldestRamp;                    // color89 因子序（先取值后更新）
    const ga = Math.max(0, Math.min(1, (127 / 255) * ga0));
    if (i <= 10) newestFade = Math.max(0, newestFade - 0.1);        // :33289-33294
    if (oldestSeen !== -1 && i >= oldestSeen - 13) oldestRamp = Math.min(1, oldestRamp + ramp);  // :33295-33302
    if (ga <= 0) continue;
    ctx.save();
    ctx.globalAlpha = ga;
    ctx.fillStyle = `rgb(${Math.round(disco[0])},${Math.round(disco[1])},${Math.round(disco[2])})`;
    ctx.translate(x1, y1);
    ctx.rotate(rot);
    ctx.fillRect(0, -2.2, len, 4.4);                        // MagicPixel ×(4.4,len)（顶心锚=段起,canvas 简化:长轴 +X）
    ctx.restore();
  }
}

/** 563 Gradient 悠悠球轨（Main.cs:35283-35299）——10 槽 hsl 双笔（槽位+中点）。
 *  逐槽：hue = ((1−i/10)²/5) mod 1（:35289）、A=127、×(1−i/10)²、×0.65；
 *  rot = 本体当前 rotation（num514 块外 proj.rotation 直读,:35293）、
 *  scale = proj.scale（563 SetDefaults 1.05,调用方传）；双笔位 = 槽位心 与
 *  Lerp(槽[i],槽[i−1],0.5) 中点（:35293-35296）。原版逐槽 Lighting.GetColor 乘
 *  由 repo compositeLight 全屏乘按像素粒度承载（本文件头 BJ235 光照注）。 */
export function drawHslMidpointTrail(
  ctx: Ctx, ring: ProjGhostRing, tex: Tex | null,
  bodyRot: number, bodyScale: number, frames: number, frame: number,
  frameW: number, frameH: number,
): void {
  if (!tex) return;
  const cap = 10;                                           // num517 = 10（:35286）
  const sh = frameH;
  const sx = Math.round(frame * sh);
  for (let i = cap - 1; i >= 1; i--) {
    const s0 = ring.at(i), s1 = ring.at(i - 1);
    if (!s0) continue;                                      // 未填槽跳（原版 Zero 槽画向原点=老 dead 槽,活动窗内不可达）
    const t = i / cap;                                      // num519（:35288）
    const hue = (((1 - t) * (1 - t)) / 5) % 1;              // :35289
    const [r, g, b] = hslToRgb255(hue, 1, 0.5);
    const ga = Math.max(0, Math.min(1, (127 / 255) * (1 - t) * (1 - t) * 0.65));  // A=127×(1−t)²×0.65
    if (ga <= 0) continue;
    // ★BJ704-G2（2026-10-21,BJ703-F 债④清偿）：flatten=true→false——563 悠悠球贴图
    //  16×16 二值 α、81.3% 非零（资产实测）,摊平把 18.7% 透明域填成不透明染色底 →
    //  A=127×0.65 半透单笔下方块边可见;保形=BJ371 判例（贡献=tex.rgb×tex.a×C.rgb,
    //  透明域 0）。
    const addTex = tintedTex(tex, [Math.round(r), Math.round(g), Math.round(b)], false);
    if (!addTex) continue;
    const drawAt = (x: number, y: number): void => {
      ctx.save();
      ctx.globalAlpha = ga;
      ctx.imageSmoothingEnabled = false;
      ctx.translate(x, y);
      ctx.rotate(bodyRot);
      ctx.drawImage(addTex as CanvasImageSource, 0, sx, frameW, sh,
        -frameW / 2 * bodyScale, -sh / 2 * bodyScale, frameW * bodyScale, sh * bodyScale);
      ctx.restore();
    };
    drawAt(s0.x + 8, s0.y + 8);                             // +size/2（num153=texW/2=8,num152=0 :35293）
    if (s1) drawAt((s0.x + s1.x) / 2 + 8, (s0.y + s1.y) / 2 + 8);   // 中点笔（:35294-35296）
  }
}
