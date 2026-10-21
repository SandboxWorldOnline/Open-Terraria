// module8 编排粒子 Spawn_* 视觉本体（收编池，2026-08-31 台账 L5 清偿）。
//
// 原版真值 = Terarria1458/Terraria.GameContent.Drawing/ParticleOrchestrator.cs
// 各 Spawn_<Type> 方法。收编规则：
//   · 本仓无 FadingParticle/PrettySparkle/Gas/BloodyExplosion 编排池系统——粒子
//     面按 GameHooks.spawnParticles/spawnDust/spawnBurst 组合近似（与既有六型
//     PetExchange/Digestion 等同口径），音/门/数量/相位参数 1:1；
//   · 每型视觉 = 纯函数 + rng 注入形参（生产缺省 Math.random；测试换种子驱动
//     "type 触发 → 粒子调用带特征参数"断言）；
//   · 生产端（clientOnly:false 型）= 本地调本函数 + broadcast 上行 module8;
//     netApplyParticleOrchestra 收包侧分支再调本函数 → 全端同款复放（原版语义 =
//     请求端 SpawnParticlesDirect 本地直生 + Broadcast 排除发送者,两面对同一本体）。
//   · ★F6（2026-09-01）随机分布形近似【统一登记】（判别式与盘形统计锚见
//     tests/spectre-stellar-procs.test.ts 的 nextVector2Circular 线性盘批）：
//     − Utils.RotatedByRandom(maxRadians)（Utils.cs:1785-1787）= NextDouble()×r −
//       NextDouble()×r = 对称【三角分布】（峰 0、肩 ±r）；
//     − Utils.NextVector2Circular(w,h)（Utils.cs:1301-1304）= NextVector2Unit()×(w,h)
//       ×NextFloat() = 角均匀×【线性半径】盘；
//     收编批旧写法 (rng()×2−1)×half【均匀】/逐轴 (2u−1)×r【盒均匀】曾全族登记为
//     近似；★F6 清偿（2026-09-01 用户点名,并行批落地）：circ() 助手与
//     deadCellsBarnacleShotFiringFx rot() 助手已改精确式——注意两助手现各消费
//     2 掷/次（旧 1 掷）,rng 消费序敏感的测试/仪器须重排；仍在册的均匀消费 =
//     内联 (rng()×2−1) 站（位置盒抖/角抖）：rainbowBoulderFx(10)/
//     townSlimeTransformFx(7)/rainbowRodHitFx(7)/keybrandFx(7)/formatCFx(5)/
//     stardustPunchFx(4)/snappingStoneRingFx(3)/snappingStoneRechargeFx(3)/
//     lightningSmallOrchestra(3)/inScreenDungeonSpawnFx(3)/deadCellsFlintFx(3)/
//     deadCellsDownDashExplosionFx(3)/stormLightningWindupFx·stellarTuneFx·
//     shimmerArrowFx·princessWeaponFx·mushroomBoiTargetFoundFx·itemTransferFx·
//     harpyCharmFamilyFx·gasTrapFx·deadCellsBeheadedHeadFx·classyCaneFx·
//     cattivaHitFx·blackLightningSmallFx·blackLightningHitFx·bestReforgeFx(各 2)/
//     swordConeArmDust·silverBulletSparkleFx·pooFlyFx·natureFlyFx·
//     moonLordWhipHitFx·arcSurgeFx(各 1)——后续新增型沿用同一登记不再逐站备注。
//     ★F6 终局甄别（2026-09-01,全部内联 (rng×2−1) 站逐站对 1458 原版掷点判别收口;
//     上清单系登记期嫌疑面,非全为三角/circ 债——NextFloatDirection 均匀站维持）：
//     ①三角化（真 RotatedByRandom,式=(rng()−rng())×maxRadians）=gasTrapFx 外/内环
//       (:2939 π/20/:2953 π/15)+harpyCharmFamilyFx 外抛(:529 maxRadians=本尊
//       6.2831854820251465≈τ 全圆——F6 对抗 C1 纠"→half π"笔误,非半幅)/内抛(:551
//       0.3141592741012573);
//     ②circ 化（真 NextVector2Circular,单掷双分量共享;C2 系统性=17 站逐分量双调用
//       清偿,掷数恢复原版=每站 2 掷）=rainbowRodHitFx sparkle(8,8)×scale(:3475)/
//       d267(1,1)(:3498)+方向标量共享(:3499)/白影 CloneDust(Dust.cs:260 无掷)/
//       deadCellsFlint(5,3)Y反(:1887)+位(7,0)(:1892)/deadCellsDownDash(5,3)Y反(:2144)
//       +位(10,0)(:2153)/deadCellsBeheadedHead(4,4)×num2(:1938)/stellarTune(12,12)×
//       0.7(:3685)/snappingStoneRechargeFx pyroclastic(2,4)(:448) ‖ C2 批新增：
//       stardustPunch 位(8,8)(:3422)+d267 速(2,2)(:3437)/princessWeapon 位(8,8)(:3367)/
//       formatC 位(8,8)(:3713)/blackLightningSmall 位(12,12)(:3527)/blackLightningHit
//       位(12,12)(:3570)/lightningSmall 位(6,6)(:3646)/stormLightningWindup 位(6,6)
//       (:1000)/keybrand 带1(4,4)(:3827)+带3(:3902)/townSlime 三味速(6,6)(:2570/:2584/
//       :2590)/cattiva 位(6,6)(:3776)/rainbowBoulder v3 d267 速(1,1)(:1633)/
//       bestReforge 位(16,16)(:3089 近似层)/silverBullet 位(4,4)(:3285)/itemTransfer
//       位(8,8)+速(24,24)(:2692 Square 近似)/inScreenDungeon 速(2,2)(:888)——
//       固定种子行为已漂移,锚这些站的坐标值须按新输出更新;
//     ③NextVector2CircularEdge 直译修=rainbowBoulderFx v1 d66(:1551,角均匀无半径掷
//       →X 清零(:1554)+Y>0 反号(:1556))——旧 dvyRaw 乘法为自造形变;
//     ④维持均匀（原版即 NextFloatDirection/NextFloat×2−1/Next(-n,n) 整数档）=
//       deadCellsFlint·DownDash 块尘近似层/flint 火花(:1836 前后无三角/circular 掷)/
//       stellarTune·blackLightningSmall·blackLightningHit·lightningSmall·
//       stormLightningWindup 角抖(:3682/:3525/:3566/:3638/:1002 均 NextFloatDirection×0.25)/
//       swordConeArmDust(:2788 族)/formatC(:3705/:3710/:3711)/shimmerArrow(:2610)/
//       cattiva(:3772)/gasTrap 径向 5+rand(:2937)。
//     ⑤★F6 对抗批收尾（2026-09-01 红队 findings→蓝队修复,tests/orchestra-f6-shape.test.ts
//       形锚闸门）：M1 三站成对尘第二粒取负向量（moonLordWhip :1698/:1702、shimmerArrow
//       :2666/:2671、snappingStone kind1 :724/:727——ja 单掷共享 xy+半径 NextFloat 单掷
//       乘整向量,旧 side 乘 sin 项/dvx·rng(),dvy·rng() 每分量独掷退役）;M2 paladinsHammer
//       径向速度单标量(:828-832);M3 rainbowBoulder v3 d267 Y 抖+CloneDust 精确复制
//       (scale=源/2、fadeIn=源×0.75、零掷);M4 rainbowRodHit jitter 单标量+掷序归位
//       (:3469/:3470)/princessWeapon 速度因子 (0.6+0.35r)×0.66(:3363+:3374)/
//       stardustPunch 全圆两掷+振幅 0.1·scale(:3414/:3419/:3420);M5 inScreenDungeon
//       矩形单侧采样+position−=velocity×5(:886-893);M6 rainbowBoulder v3 先加后旋+
//       位偏移用旋前速度+臂色 (num5+num3)%1(:1597/:1609/:1614/:1615)/classyCane 整数栅
//       位 Next(20)+速 Next(−10,11)×0.4(:2896-2902);MINOR=gasTrap sy 补 +moveY+
//       径向幅单掷(:2938)/silverBullet accel=−mv/30(:3290)/moonLordWhipEye
//       accel=−(mv×0.25)/45(:1914)/princessWeapon d267 CloneDust 白影整粒补(:3402-3408)。
//     ⑥掷序漂移【已清偿】（2026-09-02 蓝队批;同日红队 F′ 对抗复捞残余 14 笔=6 MAJOR
//       +8 MINOR 仲裁成立,已全部清偿,见各站 ★F-1..★F-14 标记）：
//       概念说明=「掷序漂移」指分布形（每掷的分布族/参数）已对、但掷的先后次序错位或
//       死掷（原版掷而弃值/掷后被覆写,返回值不入视觉面）缺漏,导致固定种子复现流与原版
//       Main.rand 调用序错位——死掷必须照样掷（补 `rng();`）才能保流对齐。清偿面：
//       deadCellsBarnacle 位→旋→速→scale（:2541-2545）/rainbowBoulder v1 d66 色先于
//       速度掷（:1549）/stellarTune 先 t 后 Next(2)+紫支补掷+scale 色后（:3686-3697）/
//       cattivaHit 同型色掷序+scale 掷接线（:3776-3789）/arcSurge pitch 掷+4 死掷
//       （:1268 pitch、:1274 死 Next(4,9)、:1275 死 Circular、:1278 Next(6) 帧）/
//       lightningSmall 相位掷+死 Next(1,3)+mix 掷序+速度 (1,0.5)×0.2（:3621-3647）/
//       blackLightningSmall 相位掷（:3515）+死双掷 Lerp、blackLightningHit 死双掷 Lerp
//       （:3528/:3569）/silverBullet 首尾死掷（:3280/:3283）/stardustPunch CloneDust
//       白影（:3454-3458,零掷）/moonLordWhip d229 noGravity+±臂先正后负（:1698-1703）。
//     ⑦★T批（2026-09-02 蓝队登记近似清偿 6 项）：keybrand 带1 色 Lerp(Gold,OrangeRed,t)
//       接线（:3830,旧 hsl 色相带近似退役）/townSlime 三味尘迁 spawnDust perfect 通道
//       （:2564-2603 全 NewDustPerfect,位/速池抖动消解,vy 翻转门读掷后值）/snappingStone
//       kind1 红金同角 π/2（:670/:699,旧金臂 3π/4 退役）/cattiva size 锚长轴 2×Scale.Y
//       （:3787+:3792+:3788——×4 是宽度轴,长轴=Scale.Y,PrettySparkle 双轴基建债登记）/
//       arcSurge pitch 掷真接线（:1268 Game.playSfxFiles 扩 pitch 形参）/631 无 charm 面
//       闭疑（aiStyle122≠1,Arrow.ts ★F5 注）。
//     ⑧★L′ 对抗批（2026-09-02 红队 L′ findings→蓝队修复,1 CRITICAL+5 MAJOR+4 MINOR
//       仲裁成立全清偿）：F-1 arcSurge 音档错名 'arcsurge'→'Item_203'（SoundID.cs:822
//       LegacySoundStyle(2,203)=Item 族→sounds/Item_203.wav）+有效音量 0.4^1.6609×0.6
//       ≈0.131（WithVolumePerceived,LegacySoundStyle.cs:69-74）/F-2 keybrand 带 3 掷序=
//       色(:3866)→Circular(4,4)(:3868)→Square(0.7,1.3)(:3869)（旧 circ 置 Square 后）/
//       F-3 townSlime 铜/长两味 vy 翻转门 `rng()<0.5`（Copper :2597/Elder :2570
//       Next(2)==0 ⟺ u<0.5,旧 >=0.5 反相）/F-4 Elder gore 位逐轴盒直译
//       RandomVector2(−30,30)×(0.5,1)（:2578;掷数 2+1 逐站对表,旧速度掷删=升腾常数）/
//       F-5 ElderSlime 尘 Lerp 起点=OurFavoriteColor 常量 (255,231,69)（Main.cs:886
//       全树唯一赋值,"随机型"前提为假,旧 rgb(97,146,213) helper 退役）/F-6 kind1 d6
//       走 perfect 通道+落池 scale=1.4（:724-729,消解烟雾 ×0.7 终值 0.98）/F-7 kind1
//       双臂恒真 ×1.5 支=速度幅 21+位偏 dir×147（:688-692/:715-719;旧 14/dir×63=漏支）;
//       MINOR=kind1 红臂色 Color(1,0,0,0.5)（:665,旧 (255,40,20) 臆造偏色）。
//     ⑨★lifeExact 系统性旧账（2026-09-02 L′ 登记→2026-09-03 蓝队首批清偿）：spawnParticles
//       的 `life` 档=base×(0.6+0.4r) 抖动基值（types.ts 契约）,凡原版 TimeToLive 钉值站本应
//       走 lifeExact——首批清偿=keybrand 带1/2/3（60/30/30：带1 num5=60f :3825+PrettySparkle
//       池缺省 60f、带2 num8=30f :3842→SetTypeInfo :3849、带3 timeToLive=30f :3865→:3872）/
//       cattivaHit（16：num5=16f :3774→TimeToLive :3791）/snappingStone kind1 sparkle
//       （30：int num=30 :658→TimeToLive :677/:706）;同批附带 kind1 size 归位（11/7→
//       6.6/4.2,2×Scale.Y 长轴换算,T5 同款）+d6 对重构只挂金臂（:722-730 i 循环嵌套,
//       掷账 9 掷对表）。**全池其余 life:N 站仍走抖动档**,后续批逐站读原文 TimeToLive
//       再翻新（改动会漂移固定种子行为,须连带测试锚同步重排,勿零散手改）。
// 粒子色彩：Main.hslToRgb(h,s,l) css 近似——伪彩虹族（RainbowRodHit 等）直接消费。
import type { GameHooks } from '../entities/types';
import { playHurtVoice } from '../player/PlayerVoice';
import { fadingParticles } from './FadingParticles';

/** 测试/生成共用 rng 形参缺省 */
type Rng = () => number;

/** Main.hslToRgb(h,s,l,a=255)（Main.cs:48689 Color.cs hsl 2 rgb 标准式）→ rgb 三元组
 *  ★BJ704-G2（2026-10-21）：三通道抽出单源——d267 源尘 newColor（ParticleOrchestrator
 *  :3496/:3394/:3445 直入 NewDust 染色参,旧走 css 字符串 hexToRgbArr 绕路）与
 *  css 串（spawnParticles 面）同数学。 */
export function orchestraHsl255(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1;
  const sat = s < 0 ? 0 : s > 1 ? 1 : s;
  const lig = l < 0 ? 0 : l > 1 ? 1 : l;
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const ch = (t: number): number => {
    let x = t; if (x < 0) x += 1; if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(ch(hue + 1 / 3) * 255),
    Math.round(ch(hue) * 255),
    Math.round(ch(hue - 1 / 3) * 255),
  ];
}

/** Main.hslToRgb → css `rgb()` 字符串（orchestraHsl255 包装） */
export function orchestraHslCss(h: number, s: number, l: number): string {
  const [r, g, b] = orchestraHsl255(h, s, l);
  return `rgb(${r},${g},${b})`;
}

/** Utils.Remap(v, fromMin, fromMax, toMin, toMax)（GetLerpValue clamped,FakeFish 同式） */
function remap(v: number, fMin: number, fMax: number, tMin: number, tMax: number): number {
  const t = (v - fMin) / (fMax - fMin);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return tMin + (tMax - tMin) * c;
}

// ==================== RainbowRodHit（:3462-3512）====================
//
// 万花筒鞭 tag / 彩虹魔杖弹 79 命中 / 死亡爆三处共用的虹彩簇：
//   · 6 掷（num2=6）双层 PrettySparkle：彩色层 ColorTint=hsl((hueBase+rand×0.33)%1,
//     1,0.4+rand×0.25)、白色核 scale×0.6；速度 = base+NextFloat()×τ 方向 ×1.5×scale
//     （scale=rand×0.4+0.4∈[0.4,0.8]→速幅 [0.6,1.2]px/t）+ MovementVector×
//     NextFloatDirection×0.15 抖动向量，加速度 −速度/60t 衰减（life≈60t 缺省档）；
//   · 12 × d267 微尘：色相 (hueBase+rand×0.12)%1、vel=circular(1,1)+MovementVector×
//     ±0.5、noGravity、scale .6+.9、fadeIn .7+.8；CloneDust 白影 scale/2 fadeIn×.75。
export function rainbowRodHitFx(
  game: GameHooks, x: number, y: number,
  moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const baseAng = rng() * Math.PI * 2;                    // num（:3463）
  const hueBase = rng();                                  // num3（:3465）
  for (let k = 0; k < 6; k++) {                           // 1/num2 六掷（:3467）
    // ★M4①（F6）：jitter=NextFloatDirection×0.15 单标量 xy 共享（:3469）——曾逐分量
    //  双掷;掷序归位=先 jitter 后 scale（原文 :3469 vector → :3470 vector2）
    const jit = (rng() * 2 - 1) * 0.15;
    const scale = rng() * 0.4 + 0.4;                      // vector2 ∈[0.4,0.8]（:3470）
    const ang = baseAng + rng() * Math.PI * 2;            // f（:3471）
    const spd = 1.5 * scale;                              // vector3（:3474）
    const vx = Math.cos(ang) * spd + moveX * jit;
    const vy = Math.sin(ang) * spd + moveY * jit;
    const off = circ(rng, 8);                             // ★F6 清偿：NextVector2Circular(8,8)（:3475）
    const offX = off.x * scale, offY = off.y * scale;     //  线性盘,单掷双分量共享（双层 sparkle 同位）
    const life = 60;                                      // num5（:3475 衰减窗=寿命）
    const px = x + offX, py = y + offY;
    // 彩色层（:3476-3489）+ 白色核（:3490-3500，scale×0.6）
    game.spawnParticles?.(px, py, orchestraHslCss((hueBase + rng() * 0.33) % 1, 1,
      0.4 + rng() * 0.25), 1, Math.abs(spd),
      { life, vx, vy, size: 2.4 * scale });
    game.spawnParticles?.(px, py, 'rgba(255,255,255,0.85)', 1, Math.abs(spd),
      { life, vx, vy, size: 1.44 * scale });              // ×0.6 白影
  }
  // ---- 12 × d267 + CloneDust 白影（:3501-3511）----
  for (let i = 0; i < 12; i++) {
    // ★BJ704-G2（2026-10-21,债② 清偿）：源尘双修——
    //  ① 校色（:3496）：newColor = hslToRgb((num3+rand×0.12)%1, 1, 0.4+rand×0.25)
    //   【2 掷先于一切】直入 NewDust 染色参（旧 color=null 丢色丢掷=掷序整段错位）。
    //  ② 后置写（:3497-3502）：NewDust(…, 0f, 0f, 0, newColor) 速度/scale 形参走
    //   缺省 0/1（池内 ±2 速抖/±2% 比例抖被覆写消解）,velocity=circular(1,1)+
    //   MovementVector×NextFloatDirection×0.5、noGravity、scale=.6+.9r、fadeIn=.7+.8r
    //   逐字段后置（旧走 spawn 形参=抖动叠加在终值上,±2 速抖 vs |v|≤~1.1 量级可见）。
    //  掷序（fx 流;池流另账）：color 2 → [NewDust 池掷] → circular 2 → dir 1 →
    //   scale 1 → fadeIn 1（原文 :3496-3502 逐位）。
    //  CloneDust（:3505-3508）白影 BJ703-B D3 已接 cloneDust 钩（scale/2、
    //  fadeIn×0.75、白）;钩随源尘后置写同步镜像精确值。
    const [cr2, cg2, cb2] = orchestraHsl255((hueBase + rng() * 0.12) % 1, 1, 0.4 + rng() * 0.25);
    const d = game.spawnDust?.(x, y, 1, 1, 267, 0, 0, 0,
      { r: cr2, g: cg2, b: cb2, a: 255 }, 1);
    const cv = circ(rng, 1);                              // :3498 NextVector2Circular(1,1)
    const jd = (rng() * 2 - 1) * 0.5;                     // :3499 NextFloatDirection×0.5
    const scl = 0.6 + rng() * 0.9;                        // :3501 scale
    const fd = 0.7 + rng() * 0.8;                         // :3502 fadeIn
    if (d) {
      d.vx = cv.x + moveX * jd;                           // :3498-3499 后置写（精确值）
      d.vy = cv.y + moveY * jd;
      d.noGravity = true;                                 // :3500
      d.scale = scl;                                      // :3501
      d.fadeIn = fd;                                      // :3502
    }
    // ★BJ703-B D3（2026-10-21）：白影改走 cloneDust 全字段拷贝（:3505-3508 →
    //  Dust.cs:265-288,BJ700-D/WhipProj 915 范式）——旧手工 spawnDust 重掷克隆,
    //  速度 ±2/scale ±2%/帧变体三独立抖动近似（位置 w=h=1 同 +4 无偏）;钩=源尘
    //  精确镜像,掷数同耗（clone 内部 spawn 7 掷=旧手搓同数,掷流零扰动）。
    if (d) {
      const w = game.cloneDust?.(d);
      if (w) {
        w.scale /= 2;                                  // :3506 dust.scale /= 2f
        w.fadeIn *= 0.75;                              // :3507 dust.fadeIn *= 0.75f
        w.color = { r: 255, g: 255, b: 255, a: 255 };  // :3508 new Color(255,255,255,255)
      }
    }
  }
}

// ==================== PaladinsHammerShockwave（:816-881）====================
//
// 301 圣骑士锤撞墙（Projectile.cs:19649-19661，PositionInWorld=position 左上、
// MovementVector=Size）。①50 掷放射环（1/2→d57 α200 scale1.8 / 1/3→d43 α254
// scale1.3,velocity=(落点−盒心)归一×9.5×NextFloat,noGravity）；②Item180 音；
// ③命中点 ±3 格（7×7）KillTile 块尘上抛（num5=4 调制——本仓冒烟粒逐格近似,
// 圈内上限 32 防 1457 原文无上限的稀疏地形尘爆,gore 池无 API 不接）。
export function paladinsHammerShockwaveFx(
  game: GameHooks, x: number, y: number, w: number, h: number, rng: Rng = Math.random,
): void {
  const ccx = x + w / 2, ccy = y + h / 2;
  game.playSfxWav?.('Item_180', 1, ccx, ccy);             // SoundEngine.PlaySound(Item180)（:822）
  for (let i = 0; i < 50; i++) {                          // （:823-848）
    if (rng() < 0.5) {                                    // Next(2)==0
      const d = game.spawnDust?.(x, y, w, h, 57, 0, 0, 200, null, 1.8);
      if (d) {
        const dl = Math.hypot(d.x - ccx, d.y - ccy) || 1;
        // ★M2（F6）：Normalize×9.5×NextFloat 单掷乘整向量（:828-832）——曾 vx/vy
        //  各掷一套半径（径向速度方向不变但模长分布=E[√(u v)] 偏离线性盘）
        const u = rng();
        d.noGravity = true;
        d.vx = ((d.x - ccx) / dl) * 9.5 * u;
        d.vy = ((d.y - ccy) / dl) * 9.5 * u;
      }
    }
    if (rng() < 1 / 3) {                                  // Next(3)==0
      const d = game.spawnDust?.(x, y, w, h, 43, 0, 0, 254, null, 1.3);
      if (d) {
        const dl = Math.hypot(d.x - ccx, d.y - ccy) || 1;
        const u = rng();                                  // 同上单掷（:838-842）
        d.noGravity = true;
        d.vx = ((d.x - ccx) / dl) * 9.5 * u;
        d.vy = ((d.y - ccy) / dl) * 9.5 * u;
      }
    }
  }
  // ---- ②命中点 7×7 格块尘（:851-871）----
  const ptx = Math.floor(ccx / 16), pty = Math.floor(ccy / 16);
  let n = 0;
  for (let j = pty - 3; j <= pty + 3 && n < 32; j++) {
    for (let i2 = ptx - 3; i2 <= ptx + 3 && n < 32; i2++) {
      if (!game.world.store.inBounds(i2, j) || !game.world.store.isSolid(i2, j)) continue;
      game.spawnDust?.(i2 * 16, j * 16, 16, 16, 14, 0, -3, 0, null, 1.12);   // 上抛块尘近似
      n++;
    }
  }
}

// ==================== Player 近战命中侧四连（Player.cs:44707-44745）====================
//
// SlapHand 3258（Spawn_ :2860-2863 纯 Item175）/ WaffleIron 5382（:2865-2868 纯
// Item178）/ FlyMeal 5129（:2914-2917 纯 Item16）/ ClassyCane 3351（:2887-2912:
// 0..1 掷 gore1218 纸屑 + 7×d10 α80 scale1.1 vy−1,2/3 noGravity——gore 无池以
// 白纸片粒子近似）。

/** Spawn_SlapHand（SoundID.Item175,巴掌拍击音） */
export function slapHandFx(game: GameHooks, x: number, y: number): void {
  game.playSfxWav?.('Item_175', 1, x, y);
}

/** Spawn_WaffleIron（SoundID.Item178,华夫饼烙印音） */
export function waffleIronFx(game: GameHooks, x: number, y: number): void {
  game.playSfxWav?.('Item_178', 1, x, y);
}

/** Spawn_FlyMeal（SoundID.Item16,苍蝇美食碎裂音） */
export function flyMealFx(game: GameHooks, x: number, y: number): void {
  game.playSfxWav?.('Item_16', 1, x, y);
}

/** Spawn_ClassyCane（:2887-2912）：20×20 盒内 0..1 掷纸屑(gore1218→白纸片粒)+
 *  7×d10 灰尘（α80,scale1.1,vx0/vy−1,Next(3)!=0 noGravity） */
export function classyCaneFx(game: GameHooks, x: number, y: number, rng: Rng = Math.random): void {
  const g0 = rng();
  if (g0 >= 0.5) {                                        // Next(0,2)==1（:2900）
    // ★M6②（F6）：位=整数栅（base=X−num2/2 后 +Next(20),:2895-2901）/速=Next(−10,11)×0.4
    //  （:2902）——曾连续均匀 ±6/±4 盒（原版是 20×20 格栅 21 档速度谱）
    game.spawnParticles?.(x + Math.floor(rng() * 20) - 10, y + Math.floor(rng() * 20) - 10,
      '#EDEDF2', 1, 1,
      { life: 40, vx: (Math.floor(rng() * 21) - 10) * 0.4, vy: -(3 + Math.floor(rng() * 6) * 0.3) });
  }
  for (let j = 0; j < 7; j++) {                           // num=7（:2904）
    // ★F-13（2026-09-02 对抗批）：Next(3) 掷先于池满哑元判定（原版 :2907 哑元照样掷）
    const ng = rng() >= 1 / 3;
    const d = game.spawnDust?.(x - 10, y - 10, 20, 20, 10, 0, -1, 80, null, 1.1);
    if (d && ng) d.noGravity = true;
  }
}

// ==================== DeadCells 族（死亡细胞种子联动批）====================

/**
 * Spawn_DeadCellsFlint（:1786-1901）：火石枪满蓄刺出土面时对周边地表的释放特效。
 * 设置面（AI_198_Flint_EmitSpikes :53240-53245）：PositionInWorld=start+(16,16)×
 * Directions=(dir,gravDir)、MovementVector=(32,gravDir)。扫盒 ±160px 内「实心且上
 * 格非实心」格 → KillTile 碎屑上抛调制 + PrettySparkle 橙火花（:1837-1868）；
 * 扫到任一合格格 → deadcells_flint_release（vol .5,:1884）+ 尘 228 ×30 向上喷散
 * （:1885-1890）+ 叠播 dd2_monk_staff_ground_impact（PlayTracked :1888）；零合格
 * 格静默返回。@returns 是否出现合格格（对应原 flag 分支——测试断言用）
 */
export function deadCellsFlintFx(
  game: GameHooks, x: number, y: number, gravitySign: number, rng: Rng = Math.random,
): boolean {
  const st = game.world.store;
  const cxT = Math.floor(x / 16), cyT = Math.floor(y / 16);
  let groundFound = false;
  for (let i = cxT - 4; i <= cxT + 4; i++) {              // point±num2 扫盒近似（num2=3,宽档≤(32/2)+24=40px→±3 格）
    for (let j = cyT - 4; j <= cyT + 4; j++) {
      if (!st.inBounds(i, j)) continue;
      if (!st.isSolid(i, j)) continue;
      if (st.inBounds(i, j - 1) && st.isSolid(i, j - 1)) continue;   // 上格非实心（:1814-1816）
      groundFound = true;
      // KillTile_GetTileDustAmount 碎屑 + PrettySparkle 橙火花近似（hue=0.12,:1829）
      game.spawnParticles?.(i * 16 + 8, j * 16, orchestraHslCss(0.12, 1, 0.5), 2, 1.6,
        { life: 24, vy: -(4 + rng() * 4), vx: (rng() * 2 - 1) * 2 });
    }
  }
  if (!groundFound) return false;
  // deadcells_flint_release（SoundID.cs:1116 vol .5 单变体组）+ 叠播 monk 冲地一声
  //（:1888 PlayTrackedSound;SoundID.cs:1008 三变体整组——仓内文件名带 _N 尾,组播=随机取一）
  game.playSfxFiles?.(['deadcells_flint_release'], 0.5, x, y);
  game.playSfxFiles?.(['dd2_monk_staff_ground_impact_0', 'dd2_monk_staff_ground_impact_1',
    'dd2_monk_staff_ground_impact_2'], 1, x, y);
  for (let m = 0; m < 30; m++) {                          // 尘 228 ×30（:1885-1890 从简 8+22 稀释视效帽）
    // ★F6 清偿：value=NextVector2Circular(5,3)（:1887）线性盘 + Y>0 反号（:1888-1890）；
    //  位抖=NextVector2Circular(7,0)（:1892,X 向扁盘）——y 提升段为仓内近似维持
    const cv = circ(rng, 5, 3);
    const dvy = cv.y > 0 ? -cv.y : cv.y;
    game.spawnParticles?.(x + circ(rng, 7, 0).x, y - rng() * 3,
      '#FFB400', 1, 0.7 + rng() * 0.8, { life: 26, vx: cv.x, vy: dvy });
  }
  void gravitySign;
  return true;
}

/**
 * Spawn_DeadCellsDownDashExplosion（:2128-2223）：死亡细胞下坠砸地爆（Player.
 * DoDeadCellsGroundPoundEffect :29005-29022,UniqueInfoPiece=strong?1:0、
 * MovementVector=(半径extent,gravDir)）。dust306 白影 ×40（hue=strong?0.01:0.55,
 * scale 1.9+0.8−0.6,color 白,strong ×1.5 速）+ 地表块尘上抛（本仓冒烟近似）+
 * PlayTracked DD2_MonkStaffGroundImpact。下坠跳系统本仓未移植（vanillaWingVisuals
 * 未移植登记④）→ 当前仅联机远端广播可达（producer 侧缺口见台账 L5 注）。
 */
export function deadCellsDownDashExplosionFx(
  game: GameHooks, x: number, y: number, strong: boolean, rng: Rng = Math.random,
): void {
  game.playSfxFiles?.(['dd2_monk_staff_ground_impact'], 0.8, x, y);   // PlayTracked（:2133）
  const speedMul = strong ? 1.5 : 1;                      // value *= 1.5f（:2147-2149）
  const hue = strong ? 0.01 : 0.55;                       // num3（:2150-2152）
  for (let i = 0; i < 40; i++) {                          // dust306 ×40（:2140-2155）
    // ★F6 清偿：value=NextVector2Circular(5,3)（:2144）线性盘 + Y>0 反号（:2145-2147）
    //  + strong ×1.5；位抖=NextVector2Circular(10,0)（:2153,X 向扁盘）
    const cv = circ(rng, 5, 3);
    const dvx = cv.x * speedMul, dvy = (cv.y > 0 ? -cv.y : cv.y) * speedMul;
    game.spawnParticles?.(x + circ(rng, 10, 0).x, y,
      orchestraHslCss(hue + rng() * 0.1, 1, 0.55), 1, 1.9,
      { life: 30, vx: dvx, vy: dvy, size: 1.3 + rng() * 0.8 });
  }
  // 地表块尘上抛（KillTile 段 :2171-2206 的近点行近似——extent 半径内首层实心面）
  const extentPx = strong ? 176 : 128;                    // num=176/128（:29010/:29013）
  const ptx = Math.floor(x / 16);
  let n = 0;
  for (let j = 1; j <= 3 && n < 14; j++) {
    for (const side of [-1, 1]) {
      const tx = ptx + side * Math.round(extentPx / 32), ty = Math.floor(y / 16) + j * 2 - 2;
      if (!game.world.store.inBounds(tx, ty) || !game.world.store.isSolid(tx, ty)) continue;
      game.spawnParticles?.(tx * 16 + 8, ty * 16, '#B0A08A', 2, 1.6,
        { life: 22, vy: -(3 + rng() * 4), vx: (rng() * 2 - 1) * 2 });
      n++;
    }
  }
}

/**
 * Spawn_DeadCellsMushroomBoiTargetFound（:2519-2532）：蘑菇小伙伴锁定目标的黄色
 * 冲击图标（ShockIconParticle,(255,255,10,150),寿命 15t,挂点父弹上方 40px）。
 * 父弹追踪由 MinionProj 承担,此函数只负责挂点位置的静态图标化粒子。
 */
export function mushroomBoiTargetFoundFx(game: GameHooks, x: number, y: number): void {
  game.spawnParticles?.(x, y, '#FFFF0A', 3, 0.6,
    { life: 15, grav: 0, damp: 0.97, size: 3.4, vy: -0.2 });
}

/**
 * Spawn_DeadCellsBarnacleShotFiring（:2534-2560）：藤壶哨站弹 1026 出膛特效。
 * producer = AI_028 1026 支 ai[1]==0 首子步门（Projectile.cs:27028-27038,
 * clientOnly:true,PositionInWorld=Center、MovementVector=velocity）：
 *   Item95 音 + 15×d2（NewDustPerfect 位±4、vel=moveDir.RotatedByRandom(0.19635)×
 *   (i≥8?3+r×2:7+r×2)、α50/scale 1.2+Next(-5,5)×.01（★F5 2026-09-01:×10,旧 ×11 多掷
 *   +5 档=Next(a,b) 上界开区间 off-by-one）/fadeIn .5/noGravity）+ 5×d267
 *   （±4、RotatedByRandom(0.09817)×r×8、α127、Lerp(DarkOliveGreen,White,r×0.25)、
 *   fadeIn .6+r×.6、scale .5、noGravity）。
 * ★2026-09-01 producer 锚补齐批：本仓 AI_197 出弹站（MinionProj 1025 支）首拍接线,
 * clientOnly:true → 本仓 owner 权威广播补远端（同 34 型偏差口径）。
 * ★⑥掷序清偿（2026-09-02）：两循环逐掷序归位原文（d2 位→旋→速→scale :2541-2544、
 * d267 位→旋→速→色→fadeIn :2552-2556），分布形不变、仅固定种子复现流对齐。
 */
export function deadCellsBarnacleShotFiringFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  game.playSfxWav?.('Item_95', 1, x, y);                   // SoundID.Item95（:2537）
  const ml = Math.hypot(moveX, moveY) || 1;
  const bx = moveX / ml, by = moveY / ml;                  // SafeNormalize
  const rot = (baseX: number, baseY: number, half: number): [number, number] => {
    // ★F6 清偿：RotatedByRandom（Utils.cs:1785-1787）= NextDouble×r − NextDouble×r
    //  对称【三角分布】（峰 0、肩 ±r）——曾 (rng×2−1)×half 均匀,尾巴密度偏低
    const ja = (rng() - rng()) * half;
    const c = Math.cos(ja), s = Math.sin(ja);
    return [baseX * c - baseY * s, baseX * s + baseY * c];
  };
  for (let i = 0; i < 15; i++) {                           // 15×d2（:2539-2550）
    // ★⑥清偿（2026-09-02）：掷序=位(:2541)→旋(:2542 RotatedByRandom)→速(:2542 三元支
    //  NextFloat)→scale(:2544)——曾 spd 先于 rot/位（固定种子复现流错位）
    const px = x + Math.floor(rng() * 8 - 4), py = y + Math.floor(rng() * 8 - 4);   // Next(-4,4)×2
    const [vx, vy] = rot(bx, by, 0.19634954631328583);
    const spd = i >= 8 ? 3 + rng() * 2 : 7 + rng() * 2;
    const d = game.spawnDust?.(px, py,
      0, 0, 2, vx * spd, vy * spd, 0, null, 1.2 + Math.floor(rng() * 10 - 5) * 0.01, true);
    if (d) { d.alpha = 50; d.fadeIn = 0.5; d.noGravity = true; }
  }
  for (let j = 0; j < 5; j++) {                            // 5×d267（:2551-2559）
    // ★⑥清偿：掷序=位(:2552)→旋(:2553)→速(:2553)→色(:2555)→fadeIn(:2556)——曾 t/位 错位
    const px = x + Math.floor(rng() * 8 - 4), py = y + Math.floor(rng() * 8 - 4);   // Next(-4,4)×2
    const [vx, vy] = rot(bx, by, 0.09817477315664291);
    const spd = rng() * 8;
    const t = rng() * 0.25;                                // Lerp(DOG,White,r×.25)
    const fdv = 0.6 + rng() * 0.6;                         // :2557 ★F-13 先掷后写（原版池满哑元照样掷）
    const d = game.spawnDust?.(px, py,
      0, 0, 267, vx * spd, vy * spd, 127,
      { r: Math.round(85 + 170 * t), g: Math.round(107 + 148 * t), b: Math.round(47 + 208 * t), a: 255 },
      0.5, true);
    if (d) { d.fadeIn = fdv; d.noGravity = true; }
  }
}

/**
 * Spawn_DeadCellsBarrelExplosion（:1710-1785）：木桶发射器弹 1023 Kill 爆编排——
 * 4 层 Extra[269] 三帧扩张环（TTL 25/20/25/25,tint(52,208,254,20)×1/.25/.3/1,
 * ScaleVelocity 2/8.5/2/3 per-25t,自旋 ±τ/25）+ 25 道 Extra[89] 辐条拖尾
 * （0.04 步进全圆,vel=dir×(4+7r)、pos=center+dir×(10+90r)−vel×4、accel=−vel/25、
 * FadeIn .2/Out .3,scale(0.4,0.8)×(0.6+0.6r),BehindPlayers）+ 7×d267
 * （α127 色(100,200,255,127)、scale2、vel=(0,12).RotatedBy(τ·j)×r,noGravity）。
 * FadingParticle 贴图池无登记：环层以 spawnParticles 单粒近似（尺寸=100px 帧 ×
 * 峰值 scale 0.4-0.6 域,池偏差同 L5 收编规则）,辐条/尘两段逐参数直译。
 * producer = Projectile.Kill 1023 支 :78567-78572（clientOnly:true）→ 本仓
 * Arrow.barrel1023Burst 接线+owner 权威广播补远端（34 型口径）。
 */
export function deadCellsBarrelExplosionFx(
  game: GameHooks, x: number, y: number, rng: Rng = Math.random,
): void {
  // 4 层扩张环（:1716-1770——帧序 0/101/101/202,TTL 25/20/25/25）
  const rings: Array<[number, number, string]> = [
    [25, 44, 'rgba(52,208,254,0.08)'],      // frame0 tint×1   scale 1→3
    [20, 22, 'rgba(52,208,254,0.02)'],      // frame1 tint×.25 scale .5→(0.5+6.8/25·20≈2.9)×.5
    [25, 40, 'rgba(52,208,254,0.024)'],     // frame1 tint×.3  同 p1 尺度
    [25, 36, 'rgba(52,208,254,0.08)'],      // frame2 tint×1   scale .9→(.9+3/25·25·1.5≈3.9)×.9
  ];
  for (const [life, size, col] of rings) {
    game.spawnParticles?.(x, y, col, 1, 0, { life, vx: 0, vy: 0, damp: 1, grav: 0, size });
  }
  for (let n = 0; n < 25; n++) {                           // 25 道辐条（:1772-1784,num+=0.04）
    const ang = Math.PI * 2 * (n * 0.04);
    const spd = 4 + 7 * rng();
    const px = x + Math.cos(ang) * (10 + 90 * rng()) - Math.cos(ang) * spd * 4;
    const py = y + Math.sin(ang) * (10 + 90 * rng()) - Math.sin(ang) * spd * 4;
    const k = 1 - 1 / 25;                                  // AccelerationPerFrame = −vel/25
    game.spawnParticles?.(px, py, 'rgba(52,208,254,0.08)', 1, spd,
      { life: 25, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, damp: k, grav: 0,
        size: 3.2 * (0.6 + 0.6 * rng()) });
  }
  for (let j = 0; j < 7; j++) {                            // 7×d267（:1786-1791 原文计段）
    const ang = Math.PI * 2 * j;
    const spd = rng();                                     // (0,12).RotatedBy(ang)×r
    const d = game.spawnDust?.(x, y, 0, 0, 267,
      -Math.sin(ang) * 12 * spd, Math.cos(ang) * 12 * spd, 127,
      { r: 100, g: 200, b: 255, a: 127 }, 2, true);
    if (d) d.noGravity = true;
  }
}

/**
 * Spawn_DeadCellsHeadEffect（dispatch :300-302 → :1920-1953）：枭首者头部 282
 * 联动残影——2 粒 FadingPlayerShaderParticle（num 0→1 步 .5）：num2=.5×Remap(|move|,
 * 0,10,.5,1)、TTL 15、vel=move×0.5、accel=vel/60、pos=载荷位+randUnit×num2×15×.5
 * +circular(4,4)×num2+move×num−vel×.5、scale(0.6,1.2)×num2、Rotation=move 角+π/2。
 * ★池偏差：FadingPlayerShaderParticle=玩家头贴图×cHead 染料着色的本体残影,本仓
 * 粒子池无贴图/染料通道 → 暖色光点近似（结构=数量/寿命/速度耦合/位置公式逐值）。
 * producer = Player.DoDeadCellsBeheadedParticles :24491-24510（head==282 逐帧,
 * clientOnly:true）→ 本仓 Player.deadCellsBeheadedStep 接线+广播补远端（34 型口径）。
 */
export function deadCellsBeheadedHeadFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const num2 = 0.5 * remap(Math.hypot(moveX, moveY), 0, 10, 0.5, 1);
  for (let num = 0; num < 1; num += 0.5) {
    const f = rng() * Math.PI * 2;
    const vx = moveX * 0.5, vy = moveY * 0.5;              // Velocity（:1936）
    const jc = circ(rng, 4);                               // ★F6 清偿：NextVector2Circular(4,4)（:1938）
    const px = x + Math.cos(f) * num2 * 15 * 0.5 + jc.x * num2
      + moveX * num - vx * 0.5;
    const py = y + Math.sin(f) * num2 * 15 * 0.5 + jc.y * num2
      + moveY * num - vy * 0.5;
    game.spawnParticles?.(px, py, 'rgba(255,200,120,0.55)', 1, Math.hypot(vx, vy),
      // AccelerationPerFrame = Velocity×(1/num4)×0.25 = vel/60（:1940 `×(0−−1/15)×0.25`
      // 双负号=正加速,寿命内 1v→1.25v 渐加速；★F4 2026-09-01 补——旧 damp:1 无加速
      { life: 15, vx, vy, ax: vx / 60, ay: vy / 60, grav: 0, size: 1.2 * num2 * 2 });
  }
}

/**
 * Spawn_StellarTune（:3675-3705）：星律吉他弹 856 Kill 星屑——5 粒 PrettySparkle
 * （ang=τ·(i/5)+phase+NextFloatDirection×.25、vel=dir×1.5×(0.7,0.7)=1.05、TTL 60、
 * acc=−vel/60、pos=载荷位+circular(12,12)×(0.7,0.7)、scale=(0.7,0.7)×(.2+.8r)、
 * 色=1/2 掷：Lerp(Gold,HotPink,r) ∶ Lerp(Violet,HotPink,r)）。
 * producer = Projectile.Kill 856 段 :72825-72831（clientOnly:true,invoker=owner）
 * → 本仓 SparkleGuitarProj.killStellarTune 接线+广播补远端（34 型口径）。
 */
export function stellarTuneFx(
  game: GameHooks, x: number, y: number, rng: Rng = Math.random,
): void {
  const phase = rng() * Math.PI * 2;                       // num（:3676）
  const lerpCss = (a: [number, number, number], b: [number, number, number], t: number): string =>
    `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  for (let i = 0; i < 5; i++) {                            // num2=5（:3678-3701）
    const ang = Math.PI * 2 * (i / 5) + phase + (rng() * 2 - 1) * 0.25;   // NextFloatDirection×.25 均匀
    const spd = 1.5 * 0.7;                                 // vector2 = 1.5×(0.7,0.7)
    const jc = circ(rng, 12);                              // ★F6 清偿：NextVector2Circular(12,12)（:3685）
    // ★⑥清偿（2026-09-02）：掷序=先 t（:3686 金 Lerp 恒掷）后 Next(2)（:3687）——紫支
    //  再补掷 t2（:3689,金支 1 掷）;scale 掷归色后（:3697）——曾 scale 先于色掷且紫支漏 t2
    const t = rng();
    const col = rng() < 0.5
      ? lerpCss([238, 130, 238], [255, 105, 180], rng())   // Lerp(Violet,HotPink,t2)（Next(2)==0 紫支）
      : lerpCss([255, 215, 0], [255, 105, 180], t);        // Lerp(Gold,HotPink,t)（金支）
    const scale = 0.2 + rng() * 0.8;
    game.spawnParticles?.(x + jc.x * 0.7, y + jc.y * 0.7,
      col, 1, spd, { life: 60, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        damp: 1 - 1 / 60, grav: 0, size: 1.4 * scale });
  }
}

// ==================== Shadowbeam 束铺撒（Spawn_Shadowbeam :1987-2005）===================
//
// 暗影束弹 294 的锚点→当前位置直线尘段（MovementVector=上一锚点、
// UniqueInfoPiece=|v|×1000 步距倍率——Arrow.SHADOWBEAM_ORCHESTRA_IDX 广播载荷
// 同语义）。hostile 版 velocityScalar=.03334/friendly .25 只差回拖偏移步长。
export function shadowbeamLineFx(
  game: GameHooks, ax: number, ay: number, bx: number, by: number,
  stepPx: number, hostile: boolean, rng: Rng = Math.random,
): void {
  const dxs = bx - ax, dys = by - ay;
  const dist = Math.hypot(dxs, dys);
  if (dist <= 0) return;
  const scalar = hostile ? 0.03334 : 0.25;                // velocityScalar（:1989-1993）
  const step = Math.max(4, stepPx);                       // arg.Length()<4 → 4 兜底（:1997-1999）
  const ux = dxs / dist, uy = dys / dist;
  for (let s = 0; s < dist; s += step) {                  // SpawnInLine 逐步（:2001-2004）
    const px = ax + ux * s, py = ay + uy * s;
    // 三联 d173：当前位 − 回拖 1/2 档（SpawnSingleLineDust ×3,:1987-2034）
    for (let k = 0; k < 3; k++) {
      const off = k * scalar * stepPx;
      game.spawnDust?.(px - ux * off, py - uy * off, 1, 1, 173,
        0, 0, 0, null, (70 + rng() * 40) * 0.013, true);
    }
  }
}

/** Remap 再导出（FakeFish.beRepelled 同表对拍用） */
export { remap as orchestraRemap };

// ==================== ChlorophyteLeafCrystalShot（P.cs:28282-28303 + :3130-3157）====
//
// 叶绿水晶叶套装（台账 L3 清偿批 2026-08-31）叶弹 227 的轨迹 streak——原版 aiStyle43
// 每子步请求（Projectile.cs:28282-28303 clientOnly:false），本仓 producer =
// entities/ChloroLeafCrystalProj ChloroLeafShot.trailStep（181 子步/拍采样 ≈4 次/拍,
// 密度差登记）;同型 ChlorophyteLeafCrystalPassive(16) 全树无生产位,不接。
// PrettySparkle streak 收编为 spawnParticles 长寿命直线粒 + 白核 additive 近似
// （Lighting.AddLight(0.05,0.2,0.1)×1.5 由粒子亮度承载）。
//
// ★δA bug③（2026-08-31 蓝队单条群）：UniqueInfoPiece 载荷链修齐——原版 producer 是
// 【三段式变换后】再 rgbToHsl 取 .X 存 (byte) 截断（P.cs:28282-84），旧实现广播的是
// 未变换 raw H 且 byte 化用 round。现 leafTrailInfoByte 为完整三段式全链直出；消费端
// Spawn_LeafCrystalShot（ParticleOrchestrator.cs:3139-46）从字节 hslToRgb(H,1,.5)
// →Lerp(·,Gold,R/255×0.5) 还原——生产/本地渲染/远端复放三面同一字节面。

/** Main.hslToRgb(H,S,L) 精确移植（Main.cs:48695-48737：双精度 hue2rgb+byte=Math.Round;
 *  与 render/AuroraSky.hslToRgb255 同式——fx 域独立副本避免 fx←render 依赖） */
function leafHslToRgb255(h: number, s: number, l: number): [number, number, number] {
  const hue2rgb = (c: number, t1: number, t2: number): number => {
    let x = c;
    if (x < 0) x += 1;                          // C# double 直写 c++/c--
    if (x > 1) x -= 1;
    if (6 * x < 1) return t1 + (t2 - t1) * 6 * x;
    if (2 * x < 1) return t2;
    if (3 * x < 2) return t1 + (t2 - t1) * (2 / 3 - x) * 6;
    return t1;
  };
  if (s === 0) {                                // Saturation==0 支（Main.cs:48700）
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const t = 2 * l - q;
  return [
    Math.round(hue2rgb(h + 1 / 3, t, q) * 255),
    Math.round(hue2rgb(h, t, q) * 255),
    Math.round(hue2rgb(h - 1 / 3, t, q) * 255),
  ];
}

/** Main.rgbToHsl(color).X 色相分量（Main.cs:48749-48790 float 式,Appearance.rgbToHsl 同式） */
function leafRgbToHue(r: number, g: number, b: number): number {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  if (mx === mn) return 0;                      // val==val2 → num4=0
  const d = mx - mn;
  let h: number;
  if (mx === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (mx === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return h / 6;
}

/** XNA Color.Lerp 逐通道 Round（仓内既定口径：CharCreation.lerpC/orchestraLerpRgb
 *  同式；两处 amount 经 Remap clamped/R/255 均 ∈[0,1],XNA Clamp 分支不触发） */
function leafLerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** 叶弹轨迹色相链 producer 三段式全文（Projectile.cs aiStyle43 段 P.cs:28282-28303,
 *  载荷截断含在内）。原文逐行：
 *   num330=((num329×-6×0.85+0.33)%1+1)%1   wrap 归一（num329=1-timeLeft/180）
 *   value2=hslToRgb(num330,1,0.5)          ① Main.hslToRgb byte 化
 *   value2=Lerp(value2,Red,Remap(num330,.33,.7,0,1))     ② Remap clamped 红端压带
 *   value2=Lerp(value2,Lerp(LimeGreen,Gold,.3),(int)value2.R/255f)  ③ 用②R 字节定量
 *   UniqueInfoPiece=(byte)(rgbToHsl(value2).X*255f)      载荷=【变换后】H 截断字节
 *  C# `(byte)` cast=向零截断（非 round）；RGB 域 [50..255] 无灰点,H∈(0,1) 必然。
 *  返回该字节即 type17 广播/本地渲染共用载荷 */
export function leafTrailInfoByte(timeLeft: number): number {
  const num329 = 1 - timeLeft / 180;
  const num330 = ((num329 * -6 * 0.85 + 0.33) % 1 + 1) % 1;
  let [r, g, b] = leafHslToRgb255(num330, 1, 0.5);            // ①
  const tRed = remap(num330, 0.33, 0.7, 0, 1);                // ② Utils.Remap clamped
  r = leafLerpChannel(r, 255, tRed);                          //    Red=(255,0,0,255)
  g = leafLerpChannel(g, 0, tRed);
  b = leafLerpChannel(b, 0, tRed);
  const tgtR = leafLerpChannel(50, 255, 0.3);                 // ③ Lerp(LimeGreen=(50,205,50),
  const tgtG = leafLerpChannel(205, 215, 0.3);                //    Gold=(255,215,0),0.3)
  const tgtB = leafLerpChannel(50, 0, 0.3);
  const tR = r / 255;                                         // (int)value2.R / 255f ×1f
  r = leafLerpChannel(r, tgtR, tR);
  g = leafLerpChannel(g, tgtG, tR);
  b = leafLerpChannel(b, tgtB, tR);
  return Math.trunc(leafRgbToHue(r, g, b) * 255);             // (byte)(H*255f) 截断
}

/** Spawn_LeafCrystalShot 终色（ParticleOrchestrator.cs:3139-46）：value=hslToRgb(
 *  uniqueInfoByte/255,1,0.5)→Color.Lerp(value,Gold,(int)value.R/255f×0.5f)。入参=
 *  编排载荷字节（δA 后两端语义：byte→hsl 全程与原版同构）;css rgb() 直返 */
export function leafSparkleCss(infoByte: number): string {
  const [r, g, b] = leafHslToRgb255((infoByte & 0xff) / 255, 1, 0.5);
  const tGold = (r / 255) * 0.5;                 // Color.Lerp(value, Gold, R/255*0.5f)
  const lr = leafLerpChannel(r, 255, tGold);     // Gold=(255,215,0)
  const lg = leafLerpChannel(g, 215, tGold);
  const lb = leafLerpChannel(b, 0, tGold);
  return `rgb(${lr},${lg},${lb})`;
}

/** Spawn_LeafCrystalShot 本体：LocalPosition -= Velocity×4f（:3152 逆航向拖尾）、
 *  Velocity=MovementVector、TimeToLive=30/半窗 FadeIn/Out=15（:3138/:3152-55）；入参
 *  infoByte=producer 载荷字节（leafTrailInfoByte/broadcast uniqueInfo 同槽位）。生产
 *  与 module8 消费两面对同一函数（L5 收编规则头注） */
export function leafCrystalShotFx(
  game: GameHooks, x: number, y: number, vx: number, vy: number, infoByte: number,
): void {
  const col = leafSparkleCss(infoByte);
  game.spawnParticles?.(x - vx * 4, y - vy * 4, col, 1, Math.hypot(vx, vy),
    { life: 30, vx, vy, size: 1.6 });
  game.spawnParticles?.(x - vx * 4, y - vy * 4, 'rgba(255,255,255,0.5)', 1, Math.hypot(vx, vy),
    { life: 22, vx, vy, size: 0.9 });                              // additive 白核近似
}

// ==================== 2026-08-31 L5 长尾批（追加收编段,标记 L6TAIL） ====================

/** 粒子种子缺省别名（新一批函数统一走 rng 形参注入） */
type Rnd = () => number;

/** XNA Color.PackedValue（RGBA 小端：R=最低字节）→ css `rgba()` 字符串。
 *  LightningSmall 族 UniqueInfoPiece 直传色打包值（Spawn_Lightning :3635-3640
 *  color.PackedValue=(uint)settings.UniqueInfoPiece） */
export function orchestraPackedCss(packed: number, alphaOverride?: number): string {
  const p = packed >>> 0;
  const r = p & 0xff, g = (p >>> 8) & 0xff, b = (p >>> 16) & 0xff;
  const a = alphaOverride ?? (p >>> 24) & 0xff;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/** C# float 色构造 new Color(fR,fG,fB,fA)→css（×255 截断=字节化） */
function fc(r: number, g: number, b: number, a = 1): string {
  const c = (v: number): number => Math.round(v * 255);
  return `rgba(${c(r)},${c(g)},${c(b)},${a})`;
}

/** Main.rand.NextVector2Circular(rx,ry)（Utils.cs:1301-1304）：
 *  NextVector2Unit()×(w,h)×NextFloat() = 角均匀 ×【线性半径】盘。
 *  ★F6 清偿（2026-09-01 用户点名）：曾 (rng()×2−1)×r 逐轴盒均匀=角非均匀+
 *  盒角溢出椭圆+半径密度偏高；本式与 SparkleGuitarProj.nextVector2Circular
 *  （唯一 1:1 先例）同构。P(R<t)=t/max 线性、E[R]=max/2（旧盒均匀 E=2/3·max）。 */
function circ(rnd: Rnd, rx: number, ry = rx): { x: number; y: number } {
  const a = rnd() * Math.PI * 2;
  const r = rnd();
  return { x: Math.cos(a) * r * rx, y: Math.sin(a) * r * ry };
}

/** SpawnHelper_SpawnInLine 的仓内等价步进器——按 [movementVector..position]
 *  区间每 stepPx 一站回调（Projectile.cs:2043-2059；step=Length()/1000 钳 ≥4） */
export function orchestraLineWalk(
  bx: number, by: number, px: number, py: number,
  uniqueInfo: number, perStep: (x: number, y: number, nx: number, ny: number) => void,
): void {
  let dxs = px - bx, dys = py - by;
  const dist = Math.hypot(dxs, dys);
  if (dist <= 0) return;
  dxs /= dist; dys /= dist;                            // SafeNormalize
  const step = Math.max(4, Math.abs(uniqueInfo) / 1000);
  for (let s = 0; s <= dist; s += step) {
    perStep(bx + dxs * s, by + dys * s, dxs * step, dys * step);
  }
}

/**
 * 剑族尘锥共体（B3 池层根修,2026-09-01）：ParticleOrchestrator 四型 Spawn_* 统一式
 * ——Dust.NewDustPerfect(PositionInWorld, TYPE, 臂向量.RotatedBy(
 * NextFloatDirection()×τ×0.025) × NextFloat()) 后置 noGravity=true + scale=常量赋值。
 * 锚行（1457 与 1458 该段逐行同文,TerraBlade 前置 diff 实证）：TerraBlade :2788/:2791、
 * Excalibur :2850/:2853、TrueExcalibur :3012/:3015、TrueNightsEdge :3211/:3214。
 * 速率域 [0,|臂|]（|臂|=4 → ≤4px/t）、方向贴臂 ±0.157rad——旧直译
 * `side*(rng*2−1)*k*rng` 各向同性标量抖动慢 ~50 倍且不贴臂（红队 B3 finding）。
 * 走 NewDustPerfect 通道（spawn 尾参 perfect=true）：velocity 完整覆写免遭
 * 烟雾族特例（242/75/169 的 vy 重掷+vx×0.3,scale×0.7 照留供后置赋值覆盖）侵蚀。
 */
function swordConeArmDust(
  game: GameHooks, x: number, y: number, type: number,
  armX: number, armY: number, negated: boolean, scale: number, rng: Rng,
): void {
  const jit = (rng() * 2 - 1) * Math.PI * 2 * 0.025;   // NextFloatDirection × τ × 0.025f
  const spd = rng();                                   // Main.rand.NextFloat()
  const c = Math.cos(jit), s = Math.sin(jit);
  const rx = armX * c - armY * s;
  const ry = armX * s + armY * c;                      // 臂向量.RotatedBy(jit)
  // NewDustPerfect(Position, Type, Velocity)：w/h=0/α0/color 缺省——perfect 覆写位速
  const d = game.spawnDust?.(x, y, 0, 0, type,
    negated ? -rx * spd : rx * spd,
    negated ? -ry * spd : ry * spd, 0, null, 1, false, true);
  if (d) { d.noGravity = true; d.scale = scale; }      // 原文紧跟的两句字段赋值
}

/**
 * Spawn_NightsEdge（:3221-3277）：永夜刃命中小三叉紫尘幕。双层各 3 臂（基角 π/4+π/4·i），
 * 第一层暗紫 rgba(64,25,128,.5)、第二层亮紫白底;TrueNightsEdge(:3155)=双臂绿族两档
 * + d75 尘锥（每臂 i<2 双掷 × ± 对,:3205-3217,共 ≤8）;i==1 强化臂原文死支（步长语义
 * 忠实保留不触发,登记）。
 */
export function nightsEdgeFx(
  game: GameHooks, x: number, y: number, rng: Rng = Math.random,
  variant: 'nightsedge' | 'truenightsedge' = 'nightsedge',
): void {
  const life = 30;
  if (variant === 'nightsedge') {
    for (let i = 0; i < 3; i++) {
      const boost = i === 1 ? 1.5 : 1;
      const spd = Math.PI / 4 + Math.PI / 4 * i;
      const vx = Math.cos(spd) * 4 * boost;
      const vy = Math.sin(spd) * 4 * boost;
      game.spawnParticles?.(x - vx * life * 0.25, y - vy * life * 0.25,
        fc(0.25, 0.1, 0.5, 0.5), 1, Math.hypot(vx, vy),
        { life, vx, vy, size: 2 * 1.1 });
      game.spawnParticles?.(x - vx * life * 0.25, y - vy * life * 0.25,
        fc(0.5, 0.25, 1, 1), 1, Math.hypot(vx, vy), { life, vx, vy, size: 2 * 0.7 });
    }
  } else {
    for (let i = 0; i <= 2; i += 2) {
      const spd = Math.PI / 4 + Math.PI / 4 * i;
      const vx = Math.cos(spd) * 4, vy = Math.sin(spd) * 4;
      game.spawnParticles?.(x - vx * life * 0.25, y - vy * life * 0.25,
        fc(0.3, 0.6, 0.3, 0.5), 1, 4, { life, vx, vy, size: 4 * 1.1 });
      game.spawnParticles?.(x - vx * life * 0.25, y - vy * life * 0.25,
        fc(0.6, 1, 0.2, 1), 1, 4, { life, vx, vy, size: 4 * 0.7 });
      for (let n2 = 0; n2 < 2; n2++) {                 // for i<2 双掷（:3205）
        swordConeArmDust(game, x, y, 75, vx, vy, false, 1.4, rng);   // :3206-3209
        swordConeArmDust(game, x, y, 75, vx, vy, true, 1.4, rng);    // :3210-3216
      }
    }
  }
}

/** Spawn_TrueNightsEdge 快捷入口 */
export function trueNightsEdgeFx(game: GameHooks, x: number, y: number, rng: Rng = Math.random): void {
  nightsEdgeFx(game, x, y, rng, 'truenightsedge');
}

/**
 * Spawn_Excalibur（:2798-2860）/ Spawn_TrueExcalibur（:2970-3084）：
 * 圣剑四臂金尘十字——尺度按臂奇偶 Scale.X=(i%2==0?2:4)*(1.1|0.7) 且奇数臂 Scale/Velocity
 * 再 ×1.5（:2809/:2833 定值式 + :2819-2823/:3040-3044/:3063-3067 奇臂增强段;1457/1458 同锚）
 * + d169 尘锥——原文只挂第二黄带（:2846-2857 Excalibur 无门/TrueExcalibur :3065-3078
 * per-arm 门 Next(2)!=0），第一金带与两变体共享的第一反抽带均无尘（B3 数量核对修正:
 * 旧直译两带全挂/16 粒）；真断钢多 π/4 基角红粉前置双带（d242 门 Next(2)!=0,:3009-3017,
 * 每臂一对 ≤4）。★δB2/B2b（2026-09-01）：曾按层定值(band===0?2:4)+丢奇臂 ×1.5→按臂
 * 奇偶重排补强;真断钢红粉前置两层原版均不赋 Velocity＝静止驻留（:2974-2989/:2991-3006
 * 无 Velocity 段）→ 删 ±v*0.2 幻加速度。剑鞭 SwordWhip tag proc 同用 TrueExcalibur
 * （WhipTagEffect_SwordWhip.cs:22 clientOnly:false）。
 */
export function excaliburFx(
  game: GameHooks, x: number, y: number, rng: Rng = Math.random,
  variant: 'excalibur' | 'trueexcalibur' = 'excalibur',
): void {
  if (variant === 'trueexcalibur') {
    const lifeT = 36, base = Math.PI / 4;
    for (let i = 0; i < 2; i++) {
      const a0 = base + Math.PI / 2 * i;
      const vx = Math.cos(a0) * 4, vy = Math.sin(a0) * 4;
      // δB2b：原版两层 PrettySparkle 均无 Velocity 赋值（:2974-2989/:2991-3006）＝静止驻留
      game.spawnParticles?.(x, y, fc(1, 0, 0.3, 1), 1, 4, { life: lifeT, vx: 0, vy: 0, size: 5 * 1.1 });
      game.spawnParticles?.(x, y, fc(1, 0.5, 0.8, 1), 1, 4, { life: lifeT, vx: 0, vy: 0, size: 3 * 0.7 });
      if (rng() >= 0.5) {                              // Next(2)!=0（:3009-3011）
        swordConeArmDust(game, x, y, 242, vx, vy, false, 1.4, rng);   // :3012-3014
        swordConeArmDust(game, x, y, 242, vx, vy, true, 1.4, rng);    // :3015-3017
      }
    }
  }
  const life = 30;
  for (let band = 0; band < 2; band++) {
    const innerScale = band === 0 ? 1.1 : 0.7;
    const tint = band === 0 ? fc(0.9, 0.85, 0.4, 0.5) : fc(1, 1, 0.2, 1);
    for (let i = 0; i < 4; i++) {
      const a0 = Math.PI / 2 * i;
      const vx = Math.cos(a0) * 4, vy = Math.sin(a0) * 4;
      const boost = i % 2 === 1 ? 1.5 : 1;             // δB2 奇臂增强（:2819-2823 等）
      const dirSign = band === 0 ? -1 : 1;
      game.spawnParticles?.(x, y, tint, 1, Math.hypot(vx, vy),
        { life, vx: dirSign * vx * 0.2 * boost, vy: dirSign * vy * 0.2 * boost,
          size: (i % 2 === 0 ? 2 : 4) * innerScale * boost });   // δB2 按臂奇偶定值
      // d169 尘带只属第二黄带（for j<1 循环在 num6 带 Add 之后,:2846/:3065）
      if (band === 1 && (variant === 'excalibur' || rng() >= 0.5)) {
        swordConeArmDust(game, x, y, 169, vx, vy, false, 1.4, rng);
        swordConeArmDust(game, x, y, 169, vx, vy, true, 1.4, rng);
      }
    }
  }
}

/** Spawn_TrueExcalibur 快捷入口 */
export function trueExcaliburFx(game: GameHooks, x: number, y: number, rng: Rng = Math.random): void {
  excaliburFx(game, x, y, rng, 'trueexcalibur');
}

/**
 * Spawn_TerraBlade（:2715-2797）：泰拉刃绿色三带击斩（基准角=MovementVector 角+π/2;
 * num2=settings.MovementVector.ToRotation()+π/2 :2720——1457/1458 同锚）。
 * ★δB1（2026-09-01）：(moveX,moveY)=弹体速度载荷（Projectile.Damage case984|985
 * settings.MovementVector=velocity Projectile.cs:13015;1457/1458 同行号）——调用侧曾把
 * 命中点 Y 的 (cos(hy),sin(hy)) 当角度传（SwingArc swordTrailOrchestra）。
 * 第三带每臂挂 d107 剑尖尘对（+臂 .8/:2788、−臂 1.4/:2791,共 8,B3 改剑族尘锥共体）。
 */
export function terraBladeFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const life = 30;
  const base = Math.atan2(moveY, moveX) + Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const a0 = base + Math.PI / 2 * i;
    const vx = Math.cos(a0) * 4, vy = Math.sin(a0) * 4;
    const odd = i % 2 === 1;
    game.spawnParticles?.(x, y, fc(0.2, 0.85, 0.4, 0.5), 1, 4,
      { life, vx: -vx * (odd ? 0.4 : 0.2), vy: -vy * (odd ? 0.4 : 0.2), size: 3 * 1.1 });
  }
  for (const s of [-1, 1]) {
    const a0 = base + Math.PI / 2 * s;
    const vx = Math.cos(a0) * 2, vy = Math.sin(a0) * 2;
    game.spawnParticles?.(x, y, fc(0.4, 1, 0.4, 0.5), 1, 2,
      { life, vx: -vy * 0.5, vy: vx * 0.5, size: 3 * 1.1 });
  }
  for (let i = 0; i < 4; i++) {
    const a0 = base + Math.PI / 2 * i;
    const vx = Math.cos(a0) * 4, vy = Math.sin(a0) * 4;
    const odd = i % 2 === 1;
    game.spawnParticles?.(x, y, fc(0.2, 1, 0.2, 1), 1, 4,
      { life, vx: vx * (odd ? 0.4 : 0.2), vy: vy * (odd ? 0.4 : 0.2), size: 3 * 0.7 });
    // d107 剑尖尘对（B3：RotatedBy(±τ×0.025)×NextFloat 贴臂向 + perfect 通道;
    // +臂 scale .8 :2788-2790 / −臂 scale 1.4 :2791-2793——旧直译两 scale 曾对调）
    swordConeArmDust(game, x, y, 107, vx, vy, false, 0.8, rng);
    swordConeArmDust(game, x, y, 107, vx, vy, true, 1.4, rng);
  }
}

/**
 * Spawn_MoonLordWhip（:1653-1710）：月主鞭命中的双色笔触（MovementVector 方向）
 * + d229 尘对。Projectile.Damage case1035/:1045 :13025/:13030 clientOnly:false
 * （1035 加 ±0.1τ 抖动载荷、1045 lerp 半程由调用侧折算进 posX/posY）。
 */
export function moonLordWhipHitFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  rng();                                                 // ★F-2（2026-09-02 对抗批）死掷（原版 :1656 num2=τ×NextFloat 被 :1657 SafeNormalize 覆写,RNG 流对齐）
  const dl = Math.hypot(moveX, moveY);
  const ang = dl > 0 ? Math.atan2(moveY / dl, moveX / dl) : 0;
  const life = 30;
  const vx = Math.cos(ang) * 4, vy = Math.sin(ang) * 4;
  game.spawnParticles?.(x - vx * life * 0.25, y - vy * life * 0.25,
    fc(0.3, 0.6, 0.7, 0.5), 1, 4, { life, vx, vy, size: 6 * 1.1 });
  game.spawnParticles?.(x - vx * life * 0.25, y - vy * life * 0.25,
    fc(0.2, 1, 0.4, 1), 1, 4, { life, vx, vy, size: 6 * 0.7 });
  for (let k = 0; k < 2; k++) {
    void k;
    // ★M1（F6）：d229 成对尘=±(vector2.RotatedBy(ja)×NextFloat)（:1698/:1702）——
    //  第二粒取负向量（旧 side 只乘 sin 项=自造形变）；ja 单掷共享 xy、半径 NextFloat
    //  单掷乘整向量（旧 dvx*rng(),dvy*rng() 每分量独掷）；swordConeArmDust 同范式
    // ★⑥清偿（2026-09-02）：臂序=先正后负（:1698 正臂先掷/:1702 负臂后掷,曾 [-1,1]
    //  反序）+ noGravity=true（:1699/:1703 NewDustPerfect 后置字段,曾漏）
    for (const side of [1, -1]) {
      const ja = (rng() * 2 - 1) * Math.PI * 2 * 0.025;  // NextFloatDirection×τ×0.025
      const c = Math.cos(ja), s = Math.sin(ja);
      const spd = rng();                                 // NextFloat 半径单掷
      const rx = side * (vx * c - vy * s) * spd;         // ±(vector2.RotatedBy(ja)×NextFloat)
      const ry = side * (vx * s + vy * c) * spd;
      // ★F-10（2026-09-02 对抗批）：位=旋后速度×4（:1701/:1705 `dust.position +=
      //  dust.velocity*4f`）——曾误用旋前基向量 (vx,vy)×4（偏移不随 ja/spd/负臂走）
      const d = game.spawnDust?.(x + rx * 4, y + ry * 4, 1, 1, 229, rx, ry, 0, null, 1.2);
      if (d) d.noGravity = true;
    }
  }
}

/**
 * Spawn_MoonLordWhipEye（:1897-1919）：月主鞭 proc 眼球残影（BehindPlayers、寿命 45t、
 * velocity=movementVector×0.05）。生产者 SpawnMoonLordWhipProc（P.cs:15005,1045 子鞭出生）。
 */
export function moonLordWhipEyeFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const ang = rng() * Math.PI * 2;                       // LocalPosition=+dir×num×num2×0.5
  game.spawnParticles?.(x + Math.cos(ang) * 22.5, y + Math.sin(ang) * 22.5,
    'rgba(255,255,255,0.65)', 1, 0,
    // ★MINOR（F6）：AccelerationPerFrame=−(MovementVector×0.25)/45（:1914,注释已有,曾漏实现）
    { life: 45, vx: moveX * 0.05, vy: moveY * 0.05,
      ax: -(moveX * 0.25) / 45, ay: -(moveY * 0.25) / 45, damp: 1, grav: 0, size: 2.2 + rng() * 0.9 });
}

/** hsl css → DustColor 反解（spawnDust color 形参直配,a 缺省 255） */
export function hexToRgbArr(css: string): { r: number; g: number; b: number; a: number } {
  const m = /rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/.exec(css);
  if (!m) return { r: 255, g: 255, b: 255, a: 255 };
  return {
    r: Number(m[1]), g: Number(m[2]), b: Number(m[3]),
    a: m[4] ? Math.round(Number(m[4]) * 255) : 255,
  };
}

/**
 * Spawn_StardustPunch（:3412-3461）：星尘拳命中紫罗兰光点（hue .59-.65）+ 白影 +
 * 2×d267 星屑×彩/白双层（scale .6+r×2、position ±Circular(16)）。生产者 P.cs:14315(1039)/
 * :14331(623)——MovementVector=(direction, rand±0.5)×(2..4),Position=lerp(center,盒最近
 * 点,.5)+Y 抖动。★⑥清偿（2026-09-02）：d267 CloneDust 白影整粒补（:3454-3458,零掷）。
 */
export function stardustPunchFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  // ★M4③（F6）：角支撑全圆两掷 phase=rng×τ / ang=phase+rng×τ（:3414/:3419——曾单掷
  //  均匀 ±π 半圆）+振幅 0.1·scale（:3420 曾 0.08）+速度因子 (0.3+0.35r) 单标量 xy
  //  共享（:3417 曾逐分量双掷）
  const phase = rng() * Math.PI * 2;                      // num（:3414）
  const mf = 0.3 + rng() * 0.35;                          // vector=MovementVector×(0.3+0.35r)（:3417）
  const scale = rng() * 0.4 + 0.4;                        // vector2 ∈[0.4,0.8]（:3418）
  const ang = phase + rng() * Math.PI * 2;                // f（:3419）
  const amp = 0.1 * scale;                                // vector3=0.1×vector2（:3420）
  const vxp = moveX * mf + Math.cos(ang) * amp;
  const vyp = moveY * mf + Math.sin(ang) * amp;
  const off = circ(rng, 8);                               // ★C2：NextVector2Circular(8,8)（:3422）单掷共享
  const px = x + off.x * scale, py = y + off.y * scale;
  // ★accel 接线（2026-09-02 收尾）：原版双项双档——角向 f̂×−(vector3/60)（vector3=amp
  //  =0.1×vector2）+ 线性 −vector/60（彩 :3427）/−vector/30（白核 :3436）；f̂=(cos,sin)(ang)
  const fHatX = Math.cos(ang), fHatY = Math.sin(ang);
  // ★1:1 迁移（2026-09-03）：同 princess——彩粒 ColorTint=hsl(...) A=0、白核
  //  Color=(255,255,255,0)、Scale=vector2（白核 ×0.6）、Rotation=π/2；APF 双项
  //  （角向 f̂×−vector3/60+线性 −vector/60 彩、/30 白核 :3427/:3436）
  const mkSD = (tint: { r: number; g: number; b: number; a: number } | null, szMul: number, apfLin: number): void => {
    // ★R3 ①（2026-09-03）：perfect=true——原版 PrettySparkle 不入 Dust 池,
    //  LocalPosition/Velocity 精确直装（stardust Velocity=f̂×vector3+vector :3426 彩/
    //  :3435 白核、LocalPosition=PositionInWorld+vector4 :3430/:3438）→ 消解 NewDust
    //  的 +4/+4 位偏与 ±2 速抖（prettySparkle 载体分支另已零掷直写,perfect 位为
    //  语义对齐）。prettySparkle 形参收 boolean（spawnDust 签名 Game.ts spawnDust 方法）
    const sp = game.spawnDust?.(px, py, 0, 0, 0, vxp, vyp, 0, tint, scale * szMul, true, true, true);
    if (!sp) return;
    sp.prettySparkle = true; sp.ttl = 60;
    sp.scaleX = scale * szMul; sp.scaleY = scale * szMul;
    sp.rotation = Math.PI / 2;
    sp.ax = -(fHatX * amp) / 60 - (moveX * mf) / apfLin;
    sp.ay = -(fHatY * amp) / 60 - (moveY * mf) / apfLin;
  };
  mkSD(hexToRgbArr(orchestraHslCss((0.6 + rng() * 0.05) % 1, 1, 0.4 + rng() * 0.25)), 1, 60);
  mkSD({ r: 255, g: 255, b: 255, a: 0 }, 0.6, 30);   // Scale=vector2×0.6 白影同速；Accel 线性项 30 档（:3436）
  for (let i = 0; i < 2; i++) {
    // ★C2（F6）：circ(2,2) 单掷共享 + move 因子 (0.5+0.5r)×1.4 单掷乘整向量
    //  （:3437-3444 曾 circ 逐分量双掷且 moveY 丢因子）
    const hueC = orchestraHslCss((0.59 + rng() * 0.05) % 1, 1, 0.4 + rng() * 0.25);
    const cv = circ(rng, 2);
    const df = (0.5 + rng() * 0.5) * 1.4;
    const scl = 0.6 + rng() * 2;
    const pc = circ(rng, 16);
    // ★BJ704-G2（债② ②族）：后置写（:3446-3451）——NewDust 形参速度/scale 缺省
    //  0/1,velocity=circular(2,2)+move 因子、noGravity、scale=.6+2r、position+=
    //  circ(16,16) 逐字段后置（旧 spawn 形参=池内 ±2 速抖/±2% 比例抖叠加终值）。
    const d = game.spawnDust?.(x + pc.x, y + pc.y, 1, 1, 267, 0, 0, 0,
      hexToRgbArr(hueC), 1);
    if (d) {
      d.vx = cv.x + moveX * df;                           // :3447-3448 后置写（精确值）
      d.vy = cv.y + moveY * df;
      d.noGravity = true;                                 // :3449
      d.scale = scl;                                      // :3450
    }
    // ★⑥清偿（2026-09-02）：CloneDust 白影整粒补（:3454-3458 与 princessWeapon :3404-3408
    //  全同构：scale=源/2、fadeIn=源×0.75（源 fadeIn=0→0）、color 白、零掷）——曾缺。
    //  ★BJ703-B D3（2026-10-21）：改走 cloneDust 钩（真·CloneDust 全字段拷贝,源尘
    //  精确镜像;旧手工 spawnDust 重掷=速度/scale/帧变体三独立抖动近似）。
    if (d) {
      const w = game.cloneDust?.(d);
      if (w) {
        w.scale /= 2;                                  // :3455 dust.scale /= 2f
        w.fadeIn *= 0.75;                              // :3456 dust.fadeIn *= 0.75f
        w.color = { r: 255, g: 255, b: 255, a: 255 };  // :3457 new Color(255,255,255,255)
      }
    }
  }
}

/**
 * Spawn_PrincessWeapon（:3357-3411）：公主法杖挥尾品红焰（终值 Velocity=movement×0.66）+
 * 白影 + 2×d267 尾尘（velocity 终值=MovementVector 覆写段直译）。Player.cs:51790
 * itemAnimation%4==0 挥拍面/P.cs:43546-67 三 proc 面（全 clientOnly:true 本地直驱）。
 */
export function princessWeaponFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  // ★M4②（F6）：速度=MovementVector×(0.6+0.35r)×0.66（:3363 终值覆写 :3374）——
  //  曾完全丢 (0.6+0.35r) 因子（终值式直译缺前段）
  // ★F-9（2026-09-02 对抗批）补 8 死掷：头 2（:3359 num/:3365 f——均拼进速度式后被
  //  :3374/:3385 终值覆写）+ 每 d267 3（:3396 Circular(2,2)×2+:3397 move 因子——被
  //  :3401 velocity=MovementVector 覆写）×2 粒
  rng();                                                 // 死掷（原版 :3359 num=τ×NextFloat,死代码链）
  const pre = 0.6 + rng() * 0.35;                        // vector 因子（:3363，pre-0.66 量——Accel 消费此量）
  const mf = pre * 0.66;                                 // :3374 终值覆写
  const scale = rng() * 0.4 + 0.2;                        // vector2 ∈[0.2,0.6]（:3364）
  const fAng = rng() * Math.PI * 2;                      // f（:3365 掷照常——★BJ704-R12 P2-3 勘正:Velocity 角向项被 :3374/:3385 终值覆写=死值,旧注「活值」系假信念;F-9 的死掷判定反而正确）
  const amp = 0.1 * scale;                               // vector3=0.1×vector2（:3366,同被覆写=死值）
  const vxp = moveX * mf;                                // :3374 终值=vector×0.66（角向不参与）
  const vyp = moveY * mf;
  const off = circ(rng, 8);                               // ★C2：NextVector2Circular(8,8)（:3367）单掷共享
  const px = x + off.x * scale, py = y + off.y * scale;
  // ★accel 接线（2026-09-02 收尾）：原版 :3376 AccelerationPerFrame=−vector/60（pre-0.66 量）
  // ★1:1 迁移（2026-09-03）：spawnParticles 单标量方块近似退役 → spawnDust
  //  prettySparkle 专用档（update 早退=APF+TTL;drawSparkleArms 双轴星芒承载）——
  //  原版彩粒 ColorTint=hsl(...) A=0、白核 Color=(255,255,255,0)、Scale=vector2
  //  （白核 ×0.6）、Rotation=π/2、APF=−vector/60（:3376-3390 连写覆写后有效式,
  //  f̂×vector3 项被第二连写覆盖不存在）、TTL 池缺省 60。
  const psTint = hexToRgbArr(orchestraHslCss((0.92 + rng() * 0.02) % 1, 1, 0.4 + rng() * 0.25));
  const mkPS = (tint: { r: number; g: number; b: number; a: number } | null, szMul: number): void => {
    // ★R3 ①（2026-09-03）：perfect=true——原版 PrettySparkle 不入 Dust 池,
    //  LocalPosition/Velocity 精确直装（princess Velocity=vector×0.66 终值 :3374 彩/
    //  :3385 白核、LocalPosition=PositionInWorld+vector4 :3377/:3387）→ 消解 NewDust
    //  的 +4/+4 位偏与 ±2 速抖（prettySparkle 载体分支另已零掷直写,perfect 位为
    //  语义对齐）。prettySparkle 形参收 boolean（spawnDust 签名 Game.ts spawnDust 方法）
    const sp = game.spawnDust?.(px, py, 0, 0, 0, vxp, vyp, 0, tint, scale * szMul, true, true, true);
    if (!sp) return;
    sp.prettySparkle = true; sp.ttl = 60;
    sp.scaleX = scale * szMul; sp.scaleY = scale * szMul;
    sp.rotation = Math.PI / 2;
    sp.ax = -(moveX * pre) / 60; sp.ay = -(moveY * pre) / 60;
  };
  mkPS(psTint, 1);
  mkPS({ r: 255, g: 255, b: 255, a: 0 }, 0.6);
  for (let i = 0; i < 2; i++) {
    // ★C2（F6）+MINOR：velocity 终值=MovementVector 覆写（:3406）+CloneDust 白影整粒
    //  补（:3402-3408 每彩尘配一白影：scale=源/2、fadeIn=源×0.75、color 白、零掷）
    const hueC = orchestraHslCss((0.92 + rng() * 0.02) % 1, 1, 0.4 + rng() * 0.25);
    circ(rng, 2);                                        // ★F-9 死掷（原版 :3396 Circular(2,2) 速度被 :3401 覆写）
    rng();                                               // ★F-9 死掷（原版 :3397 move 因子 (0.5+0.5r)×1.4 同被 :3401 覆写）
    const pc = circ(rng, 16);
    // ★BJ704-G2（债② ②族）：后置写（:3395-3401）——NewDust 形参缺省,velocity
    //  终值=MovementVector 覆写、scale=0.1 常量逐字段后置（旧 spawn 形参=池内
    //  ±2 速抖/±2% 比例抖叠在终值上）。fadeIn NewDust 已置 0（旧显式写冗余摘除）。
    const d = game.spawnDust?.(x + pc.x, y + pc.y, 1, 1, 267, 0, 0, 0,
      hexToRgbArr(hueC), 1);
    if (d) {
      d.noGravity = true;                                // :3398
      d.scale = 0.1;                                     // :3399（常量,非掷）
      d.vx = moveX;                                      // :3401 终值覆写（精确值）
      d.vy = moveY;
    }
    // ★BJ703-B D3（2026-10-21）：白影改走 cloneDust 钩（:3404-3407 → Dust.cs:265-288,
    //  BJ700-D 范式）——旧手工 spawnDust 重掷克隆速度/scale/帧三独立抖动近似;
    //  钩=源尘精确镜像（源 fadeIn=0 → ×0.75 仍 0,noGravity 随拷）。
    if (d) {
      const w = game.cloneDust?.(d);
      if (w) {
        w.scale /= 2;                                  // :3405 dust.scale /= 2f
        w.fadeIn *= 0.75;                              // :3406 dust.fadeIn *= 0.75f（0×0.75=0）
        w.color = { r: 255, g: 255, b: 255, a: 255 };  // :3407 new Color(255,255,255,255)
      }
    }
  }
}

/**
 * Spawn_FormatC（:3703-3763）：Format:C 法锤暴击金色星芒（Extra[98] 金 α127+白影双层,
 * 基角=MovementVector 角+π/2±0.9425）+ 12×d213 金尘旋升。
 * 生产者 Projectile.Damage case562 crit 门 :13003（clientOnly:false,MovementVector=velocity）。
 */
export function formatCFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const base = Math.atan2(moveY, moveX) + Math.PI / 2 + 0.9425 * (rng() * 2 - 1);
  const a0 = base + (rng() * 2 - 1) * 0.1;
  const mag = 3 * 0.7 * ((rng() * 2 - 1) || 1);
  const vel = Math.abs(mag);
  const off3 = circ(rng, 8);                             // ★C2：NextVector2Circular(8,8)（:3713）单掷共享
  const off = Math.cos(a0) * -mag * 0.7 * 15 * 0.2 + off3.x;
  const offY = Math.sin(a0) * -mag * 0.7 * 15 * 0.2 + off3.y;
  game.spawnParticles?.(x + off, y + offY, 'rgba(255,215,0,0.5)', 1, vel,
    { life: 15, vx: Math.cos(a0) * mag, vy: Math.sin(a0) * mag, size: 2.2 });
  game.spawnParticles?.(x + off, y + offY, 'rgba(255,255,255,0.6)', 1, vel,
    { life: 15, vx: Math.cos(a0) * mag, vy: Math.sin(a0) * mag, size: 1.32 });
  for (let i = 0; i < 12; i++) {
    // ★F-6（2026-09-02 对抗批）：掷序/掷数=原文 :3743-3753（7 掷/粒）——:3743 速×2 →
    //  :3745 fadeIn → :3747 `velocity *= Next(15,51)×0.01f`【单掷乘整向量,曾逐轴双掷】→
    //  :3748 X×=Next(25,101)×0.01 → :3749 Y−=Next(15,31)×0.1 → :3753 Next(3)。
    //  ★F-13 同族：掷先于池满哑元判定（原版 NewDust 恒出粒,哑元照样掷）
    const rvx = ((rng() * 5) | 0) - 2;
    const rvy = ((rng() * 5) | 0) - 2;
    const fd = ((rng() * 51) | 0) * 0.01;                // :3745（fadeIn=scale+1+此掷）
    const fM = (((rng() * 36) | 0) + 15) * 0.01;         // :3747 整向量单掷（★F-6 修复点）
    const fX = (((rng() * 76) | 0) + 25) * 0.01;         // :3748
    const fY = (((rng() * 16) | 0) + 15) * 0.1;          // :3749
    const noG = rng() >= 1 / 3;                          // :3753 Next(3)!=0 → noGravity=false
    const d = game.spawnDust?.(x, y, 1, 1, 213, rvx, rvy, 0, null, 1);
    if (!d) continue;
    d.noGravity = true;
    d.fadeIn = d.scale + 1 + fd;
    d.vx *= fM; d.vy *= fM;
    d.vx *= fX;
    d.vy -= fY;
    d.y -= 4;
    const rot = base + (d.vx! > 0 ? Math.PI / 2 : -Math.PI / 2);
    const nx = d.vx! * Math.cos(rot) - d.vy! * Math.sin(rot);
    const ny = d.vx! * Math.sin(rot) + d.vy! * Math.cos(rot);
    d.vx = nx; d.vy = ny;
    d.x -= nx * 5; d.y -= ny * 5;
    if (noG) d.noGravity = false; else d.scale *= 0.6;
  }
}

// ==================== 雷族（BlackLightning 族 + LightningSmall 蓝/红共体） ====================

/** 黑雷粒子主色档（Spawn_BlackLightning* :3529-3538/:3570-3578 四掷表）：
 *  :3528 弃色式 Lerp 双掷由两调用点先行补掷;本函数=:3530/:3571 Next(4)+支内单 NextFloat。
 *  ★F-4（2026-09-02 对抗批）：Lerp 方向=Lerp(base,Black,t) → RGB=base×(1−t) 递减
 *  （曾反向=base×t 渐亮,且把 0..255 域值喂进 fc 的 0..1 域=色值炸 255 倍的双伤）;
 *  支 2 基色回 (106,90,205)（曾 95/81/184 走样）;alpha 同式向 255 连续 Lerp
 *  （支 1=127+128t/支 2=60+195t,Black.Alpha=255）。 */
function blackLightningTint(rng: Rng): string {
  const roll = rng();
  if (roll < 0.25) {                                     // Next(4)==1（:3531-3534）
    const t = 0.1 + 0.7 * rng();
    return `rgba(${Math.round(106 * (1 - t))},${Math.round(90 * (1 - t))},${Math.round(205 * (1 - t))},${((127 + 128 * t) / 255).toFixed(3)})`;
  }
  if (roll < 0.5) {                                      // Next(4)==2（:3535-3538）
    const t = 0.1 + 0.8 * rng();
    return `rgba(${Math.round(106 * (1 - t))},${Math.round(90 * (1 - t))},${Math.round(205 * (1 - t))},${((60 + 195 * t) / 255).toFixed(3)})`;
  }
  return 'rgba(15,12,30,1)';                             // num7∈{0,3}：原版 colorTint=(0,0,0,255)（:3529/:3570）;近黑近似档维持登记（纯黑粒光照合成下不可见）
}

/**
 * Spawn_BlackLightningSmall（:3513-3552）：黑雷拖带（径向×spd×(1,0.5)×0.2+movementVector
 * 纵向牵引,scale .5,fadeOut .5）。NPC.cs:92297/P.cs:48715（clientOnly:true）。
 * ★⑥清偿（2026-09-02）：相位掷补（:3515 num=NextFloat×τ,曾漏掷）+死双掷 Lerp 补
 * （:3528 `Color.Lerp(Color.Lerp(Black,indigo,r×.5),value,r×.6)` 弃色式,2 掷不入视觉）。
 */
export function blackLightningSmallFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const phase = rng() * Math.PI * 2;                     // num（:3515）
  const groups = ((rng() * 2) | 0) + 1;                  // Next(1,3)（:3516）
  for (let g = 0; g < groups; g++) {
    // ★C3①（F6）：角抖=NextFloatDirection×0.25（:3525 均匀）——曾误接 circular(12).x×0.7
    const a = Math.PI * 2 * (g / groups) + phase + (rng() * 2 - 1) * 0.25;
    const spd = rng() * 4 + 0.1;
    // ★C3③（F6）：速度=dir×spd×(1,0.5)×0.2（:3542 逐轴）——y 系数曾 0.25、x 侧
    //  亦残留 0.5（同比半幅）,按 (1f,0.5f) 向量式归位 → y/x 系数比=0.5
    const vx = Math.cos(a) * spd * 0.2 + moveX;
    const vy = Math.sin(a) * spd * 0.5 * 0.2 + moveY;
    // ★C3②+C2（F6）：LocalPosition=NextVector2Circular(12,12)×0.7 单掷共享 xy（:3527）
    const off = circ(rng, 12);
    rng();                                               // 死掷（原版 :3528 弃色式 Lerp 第 1 掷,RNG 流对齐）
    rng();                                               // 死掷（原版 :3528 弃色式 Lerp 第 2 掷,RNG 流对齐）
    game.spawnParticles?.(x + off.x * 0.7, y + off.y * 0.7, blackLightningTint(rng), 1,
      Math.hypot(vx, vy), { life: 24, vx, vy, damp: 1, size: 0.5, grav: 0 });
  }
}

/**
 * Spawn_BlackLightningHit（:3554-3593）：黑雷爆——7 组扩散环帧条（scale One、
 * ScaleVelocity .05/t）。生产者 WhipTagEffect_DarkHarvest.cs:24 clientOnly:false +
 * P.EmitBlackLightningParticles :15201。
 * ★⑥清偿（2026-09-02）：死双掷 Lerp 补（:3569 弃色式,2 掷不入视觉,同 Small :3528）。
 */
export function blackLightningHitFx(
  game: GameHooks, x: number, y: number, _moveX = 0, _moveY = 0, rng: Rng = Math.random,
): void {
  const phase = rng() * Math.PI * 2;
  for (let g = 0; g < 7; g++) {
    const a = Math.PI * 2 * (g / 7) + phase + (rng() * 2 - 1) * 0.25;
    const spd = rng() * 4 + 0.1;
    const vx = Math.cos(a) * spd, vy = Math.sin(a) * spd * 0.5;
    const off = circ(rng, 12);                           // ★C2：circular(12,12)×0.7（:3570）单掷共享
    rng();                                               // 死掷（原版 :3569 弃色式 Lerp 第 1 掷,RNG 流对齐）
    rng();                                               // 死掷（原版 :3569 弃色式 Lerp 第 2 掷,RNG 流对齐）
    game.spawnParticles?.(x + off.x * 0.7, y + off.y * 0.7,
      blackLightningTint(rng), 1, Math.hypot(vx, vy),
      { life: 24, vx, vy, damp: 0.99, size: 1, grav: 0 });
  }
}

/**
 * Spawn_LightningSmall 共通本体（:3619-3673）：蓝(37)/红(77) 判序共用——UniqueInfoPiece
 * 打包色覆盖缺省 cyan 档、AddLight(.28,.56,.7)、10t 帧条+50% d226/d331 微尘随行。
 * ★⑥清偿（2026-09-02）：相位掷补（:3621 num=NextFloat×τ,曾漏掷）+死掷补（:3623 第二次
 * `Next(1,3)` 弃值）+mix 掷归 circular 后（:3641）+速度系数 (1,0.5)×0.2 归位（:3645,
 * 蓝 D 遗留=旧 (0.5,0.25)×0.2 同比半幅,与 blackLightningSmall C3③ 同族）。
 */
export function lightningSmallOrchestra(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0,
  packedColor = 0, rng: Rng = Math.random,
): void {
  game.addLightAt?.(x, y, 0.28, 0.56, 0.7);
  const colA = packedColor !== 0 ? orchestraPackedCss(packedColor, 255) : 'rgba(133,255,255,255)';
  const colB = packedColor !== 0 ? colA : 'rgba(15,100,155,255)';
  const phase = rng() * Math.PI * 2;                     // num（:3621）
  const groups = ((rng() * 2) | 0) + 1;                  // num2=Next(1,3)（:3622）
  rng();                                                 // 死掷（原版 :3623 Next(1,3) 掷不消费,RNG 流对齐）
  for (let g = 0; g < groups; g++) {
    const a = Math.PI * 2 * (g / groups) + phase + (rng() * 2 - 1) * 0.25;
    const spd = rng() * 4 + 0.1;
    // ★⑥清偿：速度=dir×spd×(1,0.5)×0.2（:3645 同 blackLightningSmall (1f,0.5f) 式）
    const vx = Math.cos(a) * spd * 0.2 + moveX;
    const vy = Math.sin(a) * spd * 0.5 * 0.2 + moveY;
    const off = circ(rng, 6);                            // ★C2：circular(6,6)×0.7（:3640）单掷共享
    const mix = rng() < 0.5 ? colA : colB;               // Lerp(color,value,r) 掷序归位（:3641）
    game.spawnParticles?.(x + off.x * 0.7, y + off.y * 0.7, mix, 1,
      Math.hypot(vx, vy), { life: 10, vx, vy, damp: 1, size: 1, grav: 0 });
    if (rng() >= 0.5) {                                  // Next(2)==0 → 1/2（:3654-3671）
      // ★F-8（2026-09-02 对抗批）：位=本体 LocalPosition=x+off×0.7（:3661 NewDustPerfect
      //  取 randomizedFrame.LocalPosition,曾钉 (x,y) 丢位偏）;scale 链=:3662 赋 0.8 →
      //  :3665 ×1.25（净 1.0,两段皆零掷,按原文全链落地——红队钉值 0.8 即 :3662 行）。
      //  微尘速度重掷 Circular(4,4)（:3664）★F-13 先掷后写（原版池满哑元照样掷）
      const j = circ(rng, 4);
      const d = game.spawnDust?.(x + off.x * 0.7, y + off.y * 0.7, 1, 1,
        packedColor !== 0 ? 331 : 226, vx, vy, 0,
        packedColor !== 0 ? hexToRgbArr(colA) : null, 1);
      if (d) {
        d.scale = 0.8;                                   // :3662（赋值抹 NewDust 抖,原版同）
        d.noGravity = true;
        d.vx = j.x; d.vy = j.y;
        d.scale *= 1.25;                                 // :3665（净 1.0）
        d.noLight = true;
      }
    }
  }
}

/** BlueLightningSmall(37)=lightningSmallOrchestra 直通（Red(77) 同体） */
export function blueLightningSmallFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, packedColor = 0, rng: Rng = Math.random,
): void { lightningSmallOrchestra(game, x, y, moveX, moveY, packedColor, rng); }

/** RedLightningSmall(77) 同体（vanilla dispatch 共用 Spawn_LightningSmall :400-404） */
export function redLightningSmallFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, packedColor = 0, rng: Rng = Math.random,
): void { lightningSmallOrchestra(game, x, y, moveX, moveY, packedColor, rng); }

/**
 * Spawn_BlueLightningSmallLong（:3595-3617）：电鳗鞭链电长距版——沿 MovementVector 每
 * 25px 一站复播 LightningSmall；<40px 单站不触发门。WhipTagEffect_ElectricEel.cs:46
 * （clientOnly:false）/P.cs:14484 浸液导通链（BroadcastOrRequest）。
 */
export function blueLightningSmallLongFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, packedColor = 0, rng: Rng = Math.random,
): void {
  const len = Math.hypot(moveX, moveY);
  if (len < 40) return;                                  // num3=40 门（:3605）
  const ux = moveX / len, uy = moveY / len;
  const stepPx = 25;
  let cxp = x, cyp = y;
  for (let s = 0; s < len; s += stepPx) {
    lightningSmallOrchestra(game, cxp, cyp, ux * 2, uy * 2, packedColor, rng);
    cxp += ux * stepPx; cyp += uy * stepPx;
  }
}

/**
 * Spawn_StormLightningWindup（:975-1025）：落雷蓄势白闪环（proj916 主帧条+半透白影
 * duplicate 双层同心;τ 相位环;1/3 概率位置跳到 v×(frames-1) 再反向减半）。
 * 生产者 P.cs:40510/:40520/:80294 + StormLightningParticle.cs:170（全 clientOnly:true）。
 */
export function stormLightningWindupFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, packedColor = 0, rng: Rng = Math.random,
): void {
  const phase = rng() * Math.PI * 2;
  const groups = ((rng() * 2) | 0) + 1;                  // Next(1,3)
  const white = packedColor !== 0 ? orchestraPackedCss(packedColor, 255) : 'rgba(255,255,255,255)';
  for (let g = 0; g < groups; g++) {
    const frames = ((rng() * 4) | 0) + 7;                // Next(7,11)
    const a = Math.PI * 2 * (g / groups) + phase + (rng() * 2 - 1) * 0.25;
    const spd = rng() * 3 + 0.1;
    let vx = Math.cos(a) * spd + moveX * 0.5;
    let vy = Math.sin(a) * spd * 0.5 + moveY * 0.5;
    const off = circ(rng, 6);                            // ★C2：circular(6,6)×0.7（:1000）单掷共享
    let px = x + off.x * 0.7, py = y + off.y * 0.7;
    if (rng() < 1 / 3) {                                 // Next(3)==0（:1014-1017）
      px += vx * (frames - 1);
      py += vy * (frames - 1);
      vx *= -0.5; vy *= -0.5;
    }
    game.spawnParticles?.(px, py, white, 1, Math.hypot(vx, vy),
      { life: frames, vx, vy, damp: 1, size: 1.5, grav: 0 });
    game.spawnParticles?.(px, py, 'rgba(255,255,255,0)', 1, Math.hypot(vx, vy),
      { life: frames, vx, vy, damp: 1, size: 0.75, grav: 0 });
  }
}

/**
 * Spawn_ArcLightning（:1245-1321;1457/1458 同锚行）收编段：1122 出手拍余像——玩家锚
 * 驻留帧条一束+终点 RandomizedFrame 对+AddLight+双音（Item15/Item_203 有效 vol
 * 0.131=0.4^1.6609×0.6（★L′-F1 感知档,SoundID.cs:822 WithVolumePerceived(0.4)）pitch
 * ±0.05..−0.25）。折线本体由 proj1457 自绘 LightningGenerator 路径承担（M 级⑥清偿,
 * 不重复生成）。★δB6（2026-09-01）按原文修正寿命/载荷面：
 *   · num2=16 基准、settings.MovementVector.Y==1f（雷暴档 :1253/:1257-1259）→ ×3=48;
 *     曾恒 16。锚条 TimeToLive=num2（:1280 SetTypeInfo）、端点对 num7=num2+Next(4,9)
 *     （:1291 → 16..24 / 雷暴档 48..56;曾 rand(4..8) 不含 num2 基准）;
 *   · 载荷语义回归原版：MovementVector=(seed(X),(Y==1)雷暴旗)、PositionInWorld=弹体终点
 *     （:1263 seed=MovementVector.X 整型入生成器）；玩家锚取
 *     Main.player[IndexOfPlayerWhoInvokedThis]→GetPlayerAnchorPos(RotatedRelativePoint(
 *     HandPosition ?? MountedCenter) StormLightningParticle.cs)≈盒心近似 ——invokerSlot
 *     槽无法解析时回退终点坐标（followPlayerIndex 跟随档无通道登记,原注释同口径）;
 *   · 端点白镜像粒与主粒共享同一 vector=circular(6,6)×0.7 偏移位（:1293 LocalPosition=
 *     settings.PositionInWorld(已覆写 EndPosition)+vector / :1311 mirror 同位）;scale 镜
 *     像 ×0.5=0.6375（:1317 Scale ×0.5f）。
 *   · ★⑥清偿（2026-09-02）rng 流归位：pitch 掷（:1268 NextFloatDirection×0.2−0.05,
 *     原版消费为变调——组播兜底通道无 pitch 形参,值暂弃,流对齐保序）+ 4 死掷 =
 *     第一循环 `Next(4,9)`(:1274 弃值)、`NextVector2Circular(6,6)`(:1275,SetBasicInfo
 *     消费后被 :1282 LocalPosition 覆写=视觉死掷)、帧选 `Next(6)`(:1278,原版消费为
 *     FadingParticle 帧面——本仓锚驻留帧条无帧面,弃值保流)。
 * @param stormTier settings.MovementVector.Y==1f 雷暴三倍寿命档
 */
export function arcSurgeFx(
  game: GameHooks, ex: number, ey: number,
  invokerSlot = -1, packedColor = 0, stormTier = false, rng: Rng = Math.random,
): void {
  const white = packedColor !== 0 ? orchestraPackedCss(packedColor, 255) : 'rgba(255,255,255,255)';
  const anchorBox = invokerSlot >= 0 ? orchestraPlayerAnchor(game, invokerSlot) : null;
  const anchorX = anchorBox ? anchorBox.x + anchorBox.w / 2 : ex;    // 手位≈盒心近似
  const anchorY = anchorBox ? anchorBox.y + anchorBox.h / 2 : ey;
  const lifeNum2 = stormTier ? 48 : 16;                  // num2×(num?3:1)（:1255-1259）
  const rot = Math.atan2(ey - anchorY, ex - anchorX) + Math.PI / 2;   // 锚向终点（:1288）
  void rot;
  game.addLightAt?.(ex, ey, 0.4, 0.8, 1);                // AddLight(PositionInWorld=EndPosition)（:1264）
  game.playSfxWav?.('Item_15', 1, anchorX, anchorY);     // PlaySound(Item15, playerAnchorPos)（:1266）
  const pitch = (rng() * 2 - 1) * 0.2 - 0.05;            // :1268 NextFloatDirection×0.2−0.05（SoundStyle 重载第 3 参=pitchOffset,值域 [−0.25,0.15)）
  // ★T4（2026-09-02 蓝队清偿）：pitch 掷真接线——原版 PlaySound(SoundID.ArcSurge, pos,
  //  pitch, 0.6)（SoundEngine.cs:88 重载=第 3 参 pitchOffset/第 4 参 volumeScale;Style 自身
  //  PitchVariance=0 默认,GetRandomPitch 走 SoundStyle 私有 _random 不耗 Main.rand 流）
  //  → Game.playSfxFiles 扩可选 pitch 形参（types.ts/Game.ts/Sfx.playFiles 三点透传）
  // ★L′-F1（2026-09-02 红队对抗,仲裁成立）：音档错名定罪——SoundID.cs:822 ArcSurge=
  //  LegacySoundStyle(2,203)=Item 族 style203 → sounds/Item_203.wav（盘上 24300B）;
  //  旧 'arcsurge' 臆造名盘上无档=哑音。音量=style 感知档 WithVolumePerceived(0.4)
  //  （LegacySoundStyle.cs:69-74 volume^1.6609,与 itemUseSound.ts:29 R4-41 同式）
  //  ×调用 volumeScale 0.6 → 有效 0.4^1.6609×0.6≈0.131（Item_203 不在 FILE_CASE_VOL
  //  表,playWavFile 直乘 1——调用参即终值）
  game.playSfxFiles?.(['Item_203'], 0.4 ** 1.6609 * 0.6, anchorX, anchorY, pitch);   // SoundID.ArcSurge=Item 族 203 号（SoundID.cs:822）
  // 第一循环（num3=1 单拍,:1272-1289）：三掷先于锚粒 Add
  rng();                                                 // 死掷（原版 :1274 Next(4,9) 掷不消费,RNG 流对齐）
  circ(rng, 6);                                          // 死掷（原版 :1275 Circular——:1282 LocalPosition 覆写,视觉死掷）
  rng();                                                 // 死掷（原版 :1278 Next(6) 帧选,本仓无帧面,RNG 流对齐）
  game.spawnParticles?.(anchorX, anchorY, white, 1, 0,
    { life: lifeNum2, vx: 0, vy: 0, damp: 1, size: 1.5, grav: 0 });   // 锚驻留帧条（:1277-1289）
  const frames = lifeNum2 + ((rng() * 5) | 0) + 4;       // num7=num2+Next(4,9)（:1293）
  const off = circ(rng, 6);                              // vector=circular(6,6) 两粒共享（:1294）
  game.spawnParticles?.(ex + off.x * 0.7, ey + off.y * 0.7, white, 1, 0,
    { life: frames, vx: 0, vy: 0, damp: 1, size: 1.275, grav: 0 });   // Scale=(1.5,0.75)×0.85（:1303）
  game.spawnParticles?.(ex + off.x * 0.7, ey + off.y * 0.7, 'rgba(255,255,255,0)', 1, 0,
    { life: frames, vx: 0, vy: 0, damp: 1, size: 0.6375, grav: 0 });  // 白镜像 ×0.5（:1308-1319）
}

/**
 * Spawn_PaladinsShieldHit（:903-973）：圣骑士盾分伤护壁闪——两玩家位各 d57×4
 * （v×3,noGravity,fadeIn 1.5,noLight）。PositionInWorld=(受击槽,持盾槽) int 对;
 * FadingParticle 盾精灵段（Item938 白盾膨胀 30t/15t）无贴图池登记。
 */
export function paladinsShieldHitFx(
  game: GameHooks, targetSlot: number, shieldSlot: number, rng: Rng = Math.random,
): void {
  const a = orchestraPlayerAnchor(game, targetSlot < 0 ? 255 : targetSlot);
  const b = orchestraPlayerAnchor(game, shieldSlot < 0 ? 255 : shieldSlot);
  for (const p of [a, b]) {
    if (!p) continue;
    for (let i = 0; i < 4; i++) {
      void rng;
      const d = game.spawnDust?.(p.x, p.y, 20, 42, 57, 0, 0, 0, null, 1);
      if (d) { d.vx *= 3; d.vy *= 3; d.noGravity = true; d.fadeIn = 1.5; d.noLight = true; }
    }
  }
}

/** 编排消费侧 invoker→世界锚解析（Main.player[IndexOfPlayerWhoInvokedThis] 等价） */
export function orchestraPlayerAnchor(
  game: GameHooks, slot: number,
): { x: number; y: number; w: number; h: number } | null {
  const net = (game as unknown as { net?: { mySlot?: number; players?: Map<number, { x: number; y: number }> } }).net;
  const me = (game as unknown as { player?: { x: number; y: number; w: number; h: number } }).player;
  if (net && slot !== net.mySlot) {
    const rp = net.players?.get(slot);
    if (rp) return { x: rp.x, y: rp.y, w: 20, h: 42 };
    return null;
  }
  return me ? { x: me.x, y: me.y, w: me.w, h: me.h } : null;
}

// ==================== 杂项族（Keybrand/GasTrap/Shimmer/TownSlime/Leaf/Cattiva/RB 族） ====================

/**
 * Spawn_Keybrand（:3816-3883;1457/1458 同锚）：锁匙刃命中三带——①3×金橙 sparkles
 * （PrettySparkle num2=3 :3822）②Extra[98] 白化橙渐变 FadingParticle ×3（num2=3 循环步长
 * 至带后 :3860 才重置 num2=1,:3848-3881——★δB9 曾只发 1 片+臆加白色伴生粒,按原文改 3 片;
 * 位向偏移=dir(num7)*vector4*vector*num8*0.2=0.7*0.7*30*0.2=2.94px+circular(4,4)×0.7 抖动）
 * ③Extra[174] 蓝白扩张闪点（num2=1 单粒 :3885-3911）。生产者 NPC.KeyBrandStrike :82005
 * clientOnly:false / Player.cs:35153 滑行面 clientOnly:true——★2026-09-01 定谳=原版
 * 死支（TryBouncingBlocks :35102 flag2 声明 false 后全程无置位,该支不可达）不接。
 */
export function keybrandFx(game: GameHooks, x: number, y: number, rng: Rng = Math.random): void {
  // ★F-5（2026-09-02 对抗批）补 8 掷归位原文（:3816-3883）：:3818 第一带基相位
  //  （真实消费进角度,非死掷）/:3843 带 2 色掷×3（Lerp(Gold,OrangeRed)→Lerp(White,·,.5),
  //  消费接线）/带 3 相位（:3861——原版消费进 Rotation,本池无旋转通道→流对齐掷）+
  //  带 3 色（:3866 Lerp(CornflowerBlue,White,t) A=127,消费接线）/:3869
  //  NextVector2Square(0.7,1.3)×2（消费进 ScaleVelocity/ScaleAcceleration——池无该
  //  通道,按原式积分峰值 scale=0.07+0.375·v̄（t=30 处,寿命内单调）折算进 size）
  const phase1 = rng() * Math.PI * 2;                    // num（:3818）
  for (let i = 0; i < 3; i++) {                          // 第一带（:3821-3835）
    const a = Math.PI * 2 * (i / 3) + phase1 + (rng() * 2 - 1) * 0.1;
    const spd = 1.5 * 0.7;
    const off = circ(rng, 4);                            // ★C2：circular(4,4)×0.7（:3826）单掷共享
    // ★T1（2026-09-02 蓝队清偿）：带 1 色原文 :3830 =Lerp(Gold,OrangeRed,t)——
    //  金(255,215,0)→橙红(255,69,0)：r≡255、g=215−146t、b=0，单掷与旧 hsl 同槽位
    //  （流对齐不变）；旧 orchestraHslCss(0.08+0.03r,1,0.45) 色相带近似退役
    const t1 = rng();
    // ★⑨lifeExact 清偿（2026-09-03）：带 1 TTL=60 定值——num5=60f（:3825,APF
    //  −vector2/num5 的减速零点）且本带未显式赋 TimeToLive → PrettySparkleParticle
    //  池缺省 60f（PrettySparkleParticle.cs:13 字段/:33 FetchFromPool）同窗;
    //  旧 life:60 抖动档实得 60×(0.6+0.4r)∈[36,60] 系统性偏短
    game.spawnParticles?.(x + off.x * 0.7, y + off.y * 0.7,
      fc(1, (215 - 146 * t1) / 255, 0, 1), 1, spd,
      { lifeExact: 60, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, size: 1.6 });
  }
  const aBase = rng() * Math.PI * 2;                     // num 重掷（:3836 死步长句后 :3837 基相位重掷,带 2 消费）
  for (let k = 0; k < 3; k++) {                          // 第二带 ×3（:3838-3859）
    const a2 = Math.PI * 2 * (k / 3) + aBase + (rng() * 2 - 1) * 0.1;
    // :3843-3845 色=Lerp(White, Lerp(Gold,OrangeRed,t), 0.5) A=0（★F-5 消费接线,曾钉死 fc(1,.72,.28,0)）
    const t2 = rng();
    const col2 = fc(1, (235 - 73 * t2) / 255, 127.5 / 255, 0);
    const jitter = circ(rng, 4);                         // vector5=circular(4,4)×vector（:3846）
    game.spawnParticles?.(
      x + Math.cos(a2) * 0.7 * 0.7 * 30 * 0.2 + jitter.x * 0.7,
      y + Math.sin(a2) * 0.7 * 0.7 * 30 * 0.2 + jitter.y * 0.7,
      col2, 1, 0.7,
      // ★⑨lifeExact 清偿（2026-09-03）：带 2 TTL=num8=30f 定值（:3842 → SetTypeInfo
      //  :3849 → FadingParticle.cs:36 timeTolive）;旧 life:30 抖动档同病
      { lifeExact: 30, vx: Math.cos(a2) * 0.7, vy: Math.sin(a2) * 0.7, size: 2 });
  }
  rng();                                                 // ★F-5 带 3 基相位（:3861,消费进 Rotation——本池无旋转通道→流对齐掷）
  const t3 = rng();                                      // :3866 Lerp(CornflowerBlue=(100,149,237),White,t) A=127（★F-5 消费接线）
  const col3 = `rgba(${Math.round(100 + 155 * t3)},${Math.round(149 + 106 * t3)},${Math.round(237 + 18 * t3)},0.498)`;
  // ★L′-F2（2026-09-02 红队对抗,仲裁成立）：带 3 掷序=色(:3866)→Circular(4,4)(:3868)→
  //  Square(0.7,1.3)(:3869)——旧 circ 置 sqx/sqy 之后=末三掷错位,固定种子流漂移
  const off3 = circ(rng, 4);                             // ★C2：第三带 circular(4,4)×0.7（:3868）单掷共享
  const sqx = rng() * 0.6 + 0.7;                         // :3869 NextVector2Square(0.7,1.3)（Utils.cs:1286 逐轴,★F-5 补掷）
  const sqy = rng() * 0.6 + 0.7;
  game.spawnParticles?.(x + off3.x * 0.7, y + off3.y * 0.7,   // 第三带（:3862-3882）
    col3, 1, 0,
    // ★⑨lifeExact 清偿（2026-09-03）：带 3 TTL=timeToLive=30f 定值（:3865 → SetTypeInfo :3872）
    { lifeExact: 30, grav: -0.02, damp: 0.97, size: 0.07 + 0.375 * ((sqx + sqy) / 2) });
}

/**
 * Spawn_GasTrap（:2924-2967）：毒气陷阱起爆——Item16 音+12 外环/10 内环绿调烟雾
 * （外环=movementVector+径向 5..6 且 RotatedByRandom(π/20);内环 2.5..3.95 隔位减半、
 * RotatedByRandom(π/15);寿命 50-70/80-110）。Projectile.cs:33160 弹1007首帧 Broadcast。
 */
export function gasTrapFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  game.playSfxWav?.('Item_16', 1, x, y);
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2;
    // ★MINOR（F6）：spinninpoint=movementVector+(5+NextFloat,0).RotatedBy(角)（:2938）——
    //  径向幅 (5+NextFloat) 单掷乘整臂；sy 补 +moveY（曾丢 movementVector.Y 项）
    const mag = 5 + rng();
    let sx = moveX + mag * Math.cos(a0);
    let sy = moveY + mag * Math.sin(a0);
    const ja = (rng() - rng()) * Math.PI / 20;           // ★F6 清偿：RotatedByRandom(π/20)（:2939）三角
    const rx = sx * Math.cos(ja) - sy * Math.sin(ja);
    const ry = sx * Math.sin(ja) + sy * Math.cos(ja);
    sx = rx; sy = ry;
    game.spawnParticles?.(x + sx, y + sy, 'rgba(190,230,180,0.30)', 1, 0,
      // ★F-11（2026-09-02 对抗批）：InitialScale=1+NextFloat×0.35（:2947,曾 1.2+0.42r）
      { life: 50 + ((rng() * 20) | 0), vx: sx, vy: sy, damp: 0.96, grav: -0.01, size: 1 + rng() * 0.35 });
  }
  for (let j = 0; j < 10; j++) {
    const a0 = (j / 10) * Math.PI * 2;
    const sBase = 2.5 + rng() * 1.45;
    let sx = sBase * Math.cos(a0), sy = sBase * Math.sin(a0);
    const ja = (rng() - rng()) * Math.PI / 15;           // ★F6 清偿：RotatedByRandom(π/15)（:2953）三角
    const rx = sx * Math.cos(ja) - sy * Math.sin(ja);
    const ry = sx * Math.sin(ja) + sy * Math.cos(ja);
    sx = rx; sy = ry;
    if (j % 2 === 0) { sx *= 0.5; sy *= 0.5; }
    game.spawnParticles?.(x, y, 'rgba(210,240,205,0.26)', 1, 0,
      // ★F-11：InitialScale=1+NextFloat×0.5（:2965,曾 1.25+0.6r）
      { life: 80 + ((rng() * 30) | 0), vx: sx, vy: sy, damp: 0.98, grav: -0.008, size: 1 + rng() * 0.5 });
  }
}

/**
 * Spawn_ShimmerArrow（:2605-2680）：微光箭两轮十字虹彩爆发（内层 hsl(rand,1,.5)/外层
 * lerp 白,首轮 d306 尘对）。生产者 P.cs:77676 弹1006/NPC.cs:86058（clientOnly:true）。
 */
export function shimmerArrowFx(game: GameHooks, x: number, y: number, rng: Rng = Math.random): void {
  for (let it = 0; it < 2; it++) {
    const jitter = (rng() * 2 - 1) * Math.PI * 2 * 0.05;
    const hueC = orchestraHslCss(rng(), 1, 0.5);
    const rgbC = hexToRgbArr(hueC);
    const valCss = `rgb(${Math.round((rgbC.r + 255) / 2)},${Math.round((rgbC.g + 255) / 2)},${Math.round((rgbC.b + 255) / 2)})`;
    for (let a = 0; a < 4; a++) {
      const ang = (Math.PI / 2) * a + jitter;
      const vx = Math.cos(ang) * 4, vy = Math.sin(ang) * 4;
      const oddA = a % 2 === 1;
      game.spawnParticles?.(x, y, hueC, 1, 4,
        { life: 20, vx: -vx * 0.2, vy: -vy * 0.2, size: (oddA ? 4 : 2) * 1.1 });
      game.spawnParticles?.(x, y, valCss, 1, 4,
        { life: 20, vx: vx * 0.2, vy: vy * 0.2, size: (oddA ? 4 : 2) * 0.7 });
      if (it === 0) {
        // ★M1（F6）：d306 成对尘=±(vector2.RotatedBy(ja)×NextFloat)（:2666/:2671）——
        //  第二粒取负向量、ja 单掷共享 xy、半径 NextFloat 单掷乘整向量
        // ★F-3（2026-09-02 对抗批）：臂序=正臂先（:2666 正 → :2671 负,曾 [-1,1] 反序）
        for (const side of [1, -1]) {
          const ja = (rng() * 2 - 1) * Math.PI * 2 * 0.025;   // NextFloatDirection×τ×0.025
          const c = Math.cos(ja), s = Math.sin(ja);
          const spd = rng();                             // NextFloat 半径单掷
          const d = game.spawnDust?.(x, y, 1, 1, 306,
            side * (vx * c - vy * s) * spd, side * (vx * s + vy * c) * spd,
            0, hexToRgbArr(hueC), 1.4);
          if (d) { d.noGravity = true; d.fadeIn = 1.2; }
        }
      }
    }
  }
}

/**
 * Spawn_ShimmerBlock（:2358-2377）：微光转化格上飘星（scale 系数=uniqueInfo/1000 兜底 1）。
 * 生产者 Player.cs:24002/NPC.cs:53792/P.cs:26459/:50642（全 clientOnly:true 本地直驱）。
 */
export function shimmerBlockFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0,
  uniqueInfo = 0, rng: Rng = Math.random,
): void {
  let scaleMul = uniqueInfo / 1000;
  if (!(scaleMul > 0)) scaleMul = 1;
  game.spawnParticles?.(x, y, orchestraHslCss(rng(), 0.75, 0.8), 1, Math.hypot(moveX, moveY),
    { life: 45, vx: moveX, vy: moveY, damp: 1, grav: 0, size: 1.2 * scaleMul });
}

/** 两色线性插值（Color.Lerp f 直译） */
function orchestraLerpCss(a: string, b: string, t: number): string {
  const pa = /rgb\((\d+),(\d+),(\d+)\)/.exec(a)!;
  const pb = /rgb\((\d+),(\d+),(\d+)\)/.exec(b)!;
  const mix = (sa: string, sb: string): number => Math.round(Number(sa) + (Number(sb) - Number(sa)) * t);
  return `rgb(${mix(pa[1], pb[1])},${mix(pa[2], pb[2])},${mix(pa[3], pb[3])})`;
}

/** 组件色插值（字节化） */
function orchestraLerpRgb(
  a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/**
 * Spawn_TownSlimeTransform 三味档（:2410 分派 → Nerdy :2561 / Copper :2577 / Elder :2545）。
 * kind：0 书呆（d4×60 蓝 α175）/ 1 铜（d43×40 铜白）/ 2 长（d43×30 OurFavoriteColor
 * (255,231,69) 常量→白 + gore61-63×8 近似升腾粒）。NPC.cs:19186/:19210/:80339 Broadcast 面。
 */
export function townSlimeTransformFx(
  game: GameHooks, kind: 0 | 1 | 2, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const mvx = moveX * 0.75, mvy = moveY * 0.75;
  // ★T2（2026-09-02 蓝队清偿,红队 F′）：三味原文全走 NewDustPerfect（Nerdy :2582/Copper
  //  :2591/Elder :2564）——spawnDust perfect=true 消解 NewDust 通道的 0 宽盒位抖+rand±2 速
  //  抖（Dart/bossAI_lategame 先例）；vy 翻转门（:2572/:2579 `dust.velocity.Y > 0`）随之读
  //  【掷后】精确速度而非池后抖值（原版短路与本仓一致:vy>0 才掷 Next(2)）
  switch (kind) {
    case 0:
      for (let i = 0; i < 60; i++) {
        // ★C2（F6）：(mv×0.75+circular(6,6))×NextFloat 单掷乘整臂（:2590）——曾 circ
        //  逐分量双掷+半径每分量独掷
        const cv = circ(rng, 6);
        const u = rng();
        const d = game.spawnDust?.(x, y, 1, 1, 4, (mvx + cv.x) * u, (mvy + cv.y) * u,
          175, { r: 0, g: 80, b: 255, a: 100 }, 0.6 + rng() * 1.4, false, true);
        if (d) d.noGravity = false;
      }
      break;
    case 1:
      for (let i = 0; i < 40; i++) {
        const c = circ(rng, 20);
        const cv = circ(rng, 6);                         // ★C2：同上单掷共享（:2584）
        const u = rng();
        const d = game.spawnDust?.(x + c.x, y + c.y, 1, 1, 43, (mvx + cv.x) * u, (mvy + cv.y) * u,
          26, hexToRgbArr(orchestraLerpCss('rgb(183,88,25)', 'rgb(255,255,255)', rng() * 0.5)), 1 + rng() * 1.4, false, true);
        if (!d) continue;
        d.fadeIn = 1.5;
        // ★L′-F3（2026-09-02 红队对抗,仲裁成立）：翻转门=Next(2)==0 ⟺ u<0.5（Copper :2597/
        //  Elder :2570;同文件 cattivaHitFx 同式先例）——旧 `rng() >= 0.5` 反相
        if (d.vy > 0 && rng() < 0.5) d.vy *= -1;
        d.noGravity = true;
      }
      break;
    default: {
      for (let i = 0; i < 30; i++) {
        const c = circ(rng, 20);
        const cv = circ(rng, 6);                         // ★C2：同上单掷共享（:2570）
        const u = rng();
        const d = game.spawnDust?.(x + c.x, y + c.y, 1, 1, 43, (mvx + cv.x) * u, (mvy + cv.y) * u,
          // ★L′-F5（2026-09-02 红队对抗,仲裁成立）：Lerp 起点=Main.OurFavoriteColor 常量
          //  (255,231,69)（Main.cs:886 全树唯一赋值,随机型前提为假）——旧"近似档"
          //  rgb(97,146,213) helper 退役
          26, hexToRgbArr(orchestraLerpCss('rgb(255,231,69)', 'rgb(255,255,255)', rng())), 1 + rng() * 1.4, false, true);
        if (!d) continue;
        d.fadeIn = 1.5;
        // ★L′-F3（2026-09-02 红队对抗,仲裁成立）：翻转门=Next(2)==0 ⟺ u<0.5（Copper :2597/
        //  Elder :2570;同文件 cattivaHitFx 同式先例）——旧 `rng() >= 0.5` 反相
        if (d.vy > 0 && rng() < 0.5) d.vy *= -1;
        d.noGravity = true;
      }
      for (let i = 0; i < 8; i++) {
        // ★L′-F4（2026-09-02 红队对抗,仲裁成立）：gore 位逐轴盒直译——:2578
        //  RandomVector2(rand,−30,30)×(0.5,1)（Utils.cs:2599 逐轴 (60r−30),X 轴 ×0.5/
        //  Y 轴全幅）;旧 circ(rng,15,30) 线性盘+Y 再 ×0.5=分布形+掷数双错。掷数逐站
        //  对表=2+1（位 X/Y 两掷+61+Next(3) 择型一掷）;速度掷 circ(rng,1)/1+rng()
        //  原版不存在（gore velocity=Zero×0.5）→ 删,升腾近似层改常数（旧均值）
        const gx = (rng() * 60 - 30) * 0.5;                // RandomVector2 X ×0.5（:2578）
        const gy = rng() * 60 - 30;                        // RandomVector2 Y 全幅（:2578）
        const goreId = 61 + ((rng() * 3) | 0);             // 61+Next(3) 择型（:2578;本池三型同款近似,值不入视觉面）
        void goreId;
        game.spawnParticles?.(x + gx, y + gy, '#EFEFBF', 1, 1.2,
          { life: 36, vx: 0, vy: -1.5, grav: 0.12, size: 1.6 });   // 升腾近似常数（原版 velocity=Zero,不掷）
      }
      break;
    }
  }
}

/** 主色插值消费桥（d213/d229 等缺省色彩学对拍测试用导出面） */
export { orchestraLerpCss as orchestraLerp };

/**
 * Spawn_LeafCrystalPassive（:3104-3128）：叶绿晶叶驻留三臂绿弧（life 90、FadeInEnd 10、
 * speed 0）。producer 归叶绿 SetBonus 代理弹体域（错峰约定）;编排视觉+消费派发本批在位。
 */
export function chlorophyteLeafCrystalPassiveFx(
  game: GameHooks, x: number, y: number, rng: Rng = Math.random,
): void {
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const a = phase + Math.PI * 2 * (i / 3);
    void a;
    game.spawnParticles?.(x, y, fc(0.3, 0.6, 0.3, 0.5), 1, 4,
      { life: 90, vx: 0, vy: 0, damp: 1, grav: 0, size: 2.2 });
  }
}

/**
 * Spawn_LeafCrystalShot 消费端色桥（=leafSparkleCss 同式委托——δA 后两实现合一,
 * 防色链分叉;入参=UniqueInfoPiece 载荷字节）。
 */
export function leafCrystalShotTint(uniqueHueByte: number): string {
  return leafSparkleCss(uniqueHueByte & 0xff);
}

/**
 * Spawn_CattivaHit（:3765-3796）：捣蛋猫命中金橙六芒簇（寿命 16t）。
 * 生产者 Projectile.SpawnHitVisuals type1093/1112 + P.cs:52194 挖掘镐力面（BroadcastOrRequest）。
 * ★⑥掷序清偿（2026-09-02）：逐掷序归位原文（jitter→circ→t→Next(2)[白支 t2]→scale
 * :3772-3789）,scale 掷真值接线 size（旧固定 2.4 弃掷）。
 * ★T5（2026-09-02 蓝队清偿）：PrettySparkleParticle.Draw（PrettySparkleParticle.cs:59-77）
 * 两条臂都乘【整个 Vector2 Scale】——水平臂 scale=(0.3,2)×num×Scale、垂直臂 (0.3,1)×…,
 * 即长度轴吃 Scale.Y×2、宽度轴吃 Scale.X×0.3;cattiva :3787 Scale=vector×(0.1+0.7r)、
 * :3792 Scale.X×=4、:3788 DrawVerticalAxis=false（只画单条）→ 实际形=【2k 长×1.2k 宽】
 * 的粗短辉条（k=0.7×(0.1+0.7r)）,×4 是【加宽】不是旧注的"长条拉伸"。本池粒子=单标量
 * size 方块、无旋转/无逐轴通道 → 双轴基建债登记,可表达轴修对：size=2×Scale.Y
 * =1.4×(0.1+0.7r)（长轴,掷值所载;旧 2×Scale.X=8×Scale.Y 系把宽度×4 误读为拉伸,放大 4×）。
 */
export function cattivaHitFx(game: GameHooks, x: number, y: number, _moveX = 0, _moveY = 0, rng: Rng = Math.random): void {
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 2 * (i / 6) + phase + (rng() * 2 - 1) * 0.25;
    const spd = 4.5 * 0.7;
    const off = circ(rng, 6);                            // ★C2：circular(6,6)×0.7（:3775）单掷共享
    // ★⑥清偿（2026-09-02）：色掷序同 stellarTune=先 t（:3776 金 Lerp 恒掷）后 Next(2)
    //  （:3777）——白支再补掷 t2（:3779）;scale 掷归色后（:3787）
    // ★T5：size=2×Scale.Y（长轴;宽度 0.3×Scale.X 与旋转 π/2+Rotation 池无通道,登记）
    const t = rng();
    const col = rng() < 0.5
      ? orchestraLerpCss('rgb(255,255,255)', 'rgb(255,165,0)', rng())   // Lerp(White,Orange,t2)（Next(2)==0 白支）
      : orchestraLerpCss('rgb(255,215,0)', 'rgb(255,165,0)', t);        // Lerp(Gold,Orange,t)（金支）
    const scl = 0.1 + rng() * 0.7;
    game.spawnParticles?.(x + off.x * 0.7, y + off.y * 0.7, col, 1, spd,
      // ★⑨lifeExact 清偿（2026-09-03）：TTL=num5=16f 定值（:3774 → TimeToLive=num5 :3791）——
      //  旧 life:16 抖动档实得 16×(0.6+0.4r)∈[9.6,16]
      { lifeExact: 16, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, damp: 0.95, size: 1.4 * scl, grav: 0 });
  }
}

// ==================== RainbowBoulder 族 + BestReforge + SilverBullet + 行进尘束三型 ====================

/**
 * Spawn_RainbowBoulder{1..4,PetBounce} 收编（:1506/:1562/:1589/:1435+pet 分支）：
 *  1 环形虹彩对+d66 环流尘×21 / 2 双星平移 / 3 小环列+d267 双层 / 4|pet 尘环+
 *  movementVector 轴向 sparkle 反向对（彩带 (sin,-cos)/白 (-sin,+cos),共线反向——
 *  δB10 修正后;14/8×d66、20/10 对;pet 味省音）。
 * 生产者：P.cs:20298(RB1 天基寻宝 clientOnly:true)/TileDrawing :6989(:6996)(RB3/RB2
 * 虹砖 ambience)/:20349 RB4 跃迁(clientOnly:false)放置面/50709 PetBounce——仓内锚
 * 在场性差异见登记。
 */
export function rainbowBoulderFx(
  game: GameHooks, variant: 1 | 2 | 3 | 4 | 'pet', x: number, y: number,
  moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const hslRand = (): string => orchestraHslCss(rng(), 1, 0.5);
  if (variant === 4 || variant === 'pet') {
    const pet = variant === 'pet';
    if (!pet) game.playSfxWav?.('rainbow_boulder', 1, x, y);
    const countD = pet ? 8 : 14;
    for (let i = 0; i < countD; i++) {
      const c = circ(rng, 30);
      const d = game.spawnDust?.(x + c.x, y + c.y, 1, 1, 66, 0, 0, 100, hexToRgbArr(hslRand()), pet ? 1.2 : 1.7);
      if (!d) continue;
      d.vx *= pet ? 2 : 3;
      d.vy *= pet ? 2 : 3;
      d.noGravity = true;
    }
    const ribbons = pet ? 10 : 20;
    const rotN = Math.atan2(moveY, moveX) + Math.PI / 2;
    // ★δB10：彩带 Velocity=(0,-1).RotatedBy(num5)=(sin num5,-cos num5)、白镜像=
    // (0,1).RotatedBy(num5)=(-sin num5,cos num5)=同一轴上反向共流（P.cs:1478/:1493,
    // 1457/1458 同锚）——曾用 (cos,sin)/(−sin,cos) 对子成错 90° 垂直轴
    const sxn = Math.sin(rotN), csn = Math.cos(rotN);
    for (let r = 0; r < ribbons; r++) {
      void r;
      const lifeT = ((rng() * 20) | 0) + 20;             // num7=Next(20,40)（:1477 两粒共享）
      const pc = circ(rng, pet ? 6 : 10);                // 彩带位=rect(num4) 盒内随机（:1475）
      game.spawnParticles?.(x + pc.x, y + pc.y,
        hslRand(), 1, 1, { life: lifeT, vx: sxn, vy: -csn, damp: 1, grav: 0, size: 1.7 });
      const pw = circ(rng, pet ? 6 : 10);                // 白镜像位独立盒内随机（:1490）——曾钉死 x,y
      game.spawnParticles?.(x + pw.x, y + pw.y, 'rgba(255,255,255,0.4)', 1, 1,
        { life: lifeT, vx: -sxn, vy: csn, damp: 1, grav: 0, size: 0.85 });
    }
    return;
  }
  if (variant === 2) {
    game.spawnParticles?.(x, y, hslRand(), 1, Math.hypot(moveX, moveY),
      { life: 25, vx: moveX, vy: moveY, damp: 1, grav: 0, size: 2 });
    game.spawnParticles?.(x, y, 'rgba(255,255,255,0.12)', 1, Math.hypot(moveX, moveY),
      { life: 25, vx: moveX, vy: moveY, damp: 1, grav: 0, size: 1 });
    return;
  }
  if (variant === 1) {
    // ★F-1（2026-09-02 对抗批）：v1 sparkle 环全链对齐 :1508-1546——环前 4 掷
    //  （:1508 相位/:1509 臂数/:1510 色基 num3/:1511 死 Next(2)）+ 每臂 9 掷
    //  （:1515 scale/:1516 死 num5/:1519 死 vector2/:1520 num6 寿命/:1521
    //  Circular(16,16)×2/:1522 CircularEdge/:1531 死色×2）;终色 :1532=(num4+num3)%1
    //  零掷且与 num3 耦合（曾 i/arms+rng 独掷、位=相位环 4.8、vy 恒 −1.5、life 恒 200）。
    //  速度=CircularEdge(1.5,1.5) 后 X 清零+Y>0 反号（:1523-1527）=纯上行 |sinθ|×1.5;
    //  加速度=num5 向×−(velocity/num6)（:1530,XNA 分量乘=只 y 轴有效）;
    //  白镜像 Scale=vector×0.3（:1544,alpha 0.35 为池可见性近似档维持）。
    const phase = rng() * Math.PI * 2;                   // num（:1508）
    const arms = 6 + ((rng() * 7) | 0);                  // num2=6+Next(7)（:1509）
    const colBase = rng();                               // num3 色基（:1510）
    rng();                                               // ★F-1 死掷（原版 :1511 Next(2) 掷不消费,RNG 流对齐）
    for (let i = 0; i < arms; i++) {
      const f = i / arms;                                // num4（:1512 步进 1/num2）
      const scl = rng() * 0.3 + 1;                       // vector（:1515）∈[1,1.3]
      rng();                                             // ★F-1 死掷（原版 :1516 num5 被 :1517 覆写）
      rng();                                             // ★F-1 死掷（原版 :1519 vector2 被 :1522 覆写）
      const life = ((rng() * 20) | 0) + 180;             // num6=Next(20)+180（:1520）
      const off = circ(rng, 16);                         // vector3=Circular(16,16)×vector（:1521）单掷共享
      const ea = rng() * Math.PI * 2;                    // vector2=CircularEdge(1.5,1.5)（:1522,角均匀无半径掷）
      let vy = Math.sin(ea) * 1.5;
      if (vy > 0) vy *= -1;                              // :1523 X 清零+:1524-1527 Y>0 反号 → 纯上行
      rng();                                             // ★F-1 死色掷 1（原版 :1531 hsl 色相掷被 :1532 覆写）
      rng();                                             // ★F-1 死色掷 2（原版 :1531 hsl 亮度掷同上）
      const aDir = phase + Math.PI * 2 * f;              // num5（:1517）
      const ay = Math.sin(aDir) * -(vy / life);          // Accel=num5 向×−(velocity/num6)（:1530,x 分量=0）
      const px = x + off.x * scl, py = y + off.y * scl;
      game.spawnParticles?.(px, py, orchestraHslCss((f + colBase) % 1, 1, 0.5), 1,
        Math.abs(vy), { life, vx: 0, vy, ax: 0, ay, grav: 0, size: 2 * scl });
      game.spawnParticles?.(px, py, 'rgba(255,255,255,0.35)', 1, Math.abs(vy),
        { life, vx: 0, vy, ax: 0, ay, grav: 0, size: 0.6 * scl });   // 白镜像 Scale=vector×0.3（:1544）
    }
    for (let i = 0; i < 21; i++) {                       // d66 环流尘（:1547-1559）
      // ★F6 清偿：velocity=NextVector2CircularEdge(1,1)（:1551,单位圆边=角均匀、无半径掷）
      //  ×(8+2×NextFloat) → X 清零（:1554）+ Y>0 反号（:1556-1558）——旧 dvyRaw 乘法为
      //  自造形变（速度密度被压向 0,非原版 |sin| 谱）
      // ★⑥清偿（2026-09-02）：色掷在先（:1549 NewDustDirect 色参恒先于速度掷求值）——
      //  曾 ang/sp 先掷色后掷（固定种子复现流错位）
      // ★F-13：fadeIn 掷先于池满哑元判定（:1552,原版哑元照样掷）
      const hue = hslRand();
      const ang = rng() * Math.PI * 2;
      const sp = 8 + 2 * rng();
      const fdv = 1 + rng();                             // fadeIn=1+NextFloat（:1552）
      const d = game.spawnDust?.(x, y, 16, 16, 66, Math.cos(ang) * sp, Math.sin(ang) * sp, 100, hexToRgbArr(hue), 1.7);
      if (d) {
        d.noGravity = true;
        d.fadeIn = fdv;
        d.vx = 0;
        if (d.vy > 0) d.vy *= -1;
        d.x -= d.vx * 5; d.y -= d.vy * 5;
      }
    }
    return;
  }
  // variant 3（:1589-1652）
  const phase = rng() * Math.PI * 2;
  const spinA = (Math.PI / 2) * (((rng() * 2) | 0) * 2 - 1);
  const arms = 3 + ((rng() * 7) | 0);
  for (let i = 0; i < arms; i++) {
    const a = phase + Math.PI * 2 * (i / arms);
    const sz = (rng() * 0.2 + 0.3) * 0.8 * (0.3 + 1.5 * rng());
    const ringR = 14 - arms + rng() * 3;
    const px = x + Math.cos(a) * ringR, py = y + Math.sin(a) * ringR;
    // ★M6①（F6）：jitter=MovementVector×NextFloatDirection×0.15 单标量 xy 共享（:1597）
    const jit = (rng() * 2 - 1) * 0.15;
    const sumX = Math.cos(a) * sz + moveX * jit;         // 先加：臂向×幅+jitter 同式（:1604）
    const sumY = Math.sin(a) * sz + moveY * jit;
    const cR = Math.cos(spinA), sR = Math.sin(spinA);
    const vx = sumX * cR - sumY * sR;                    // 后旋：对 sum 整体 RotBy(num4)（:1615）
    const vy = sumX * sR + sumY * cR;                    //  ——曾先旋基向量再加逐分量 jitter
    game.spawnParticles?.(px + sumX * 4, py + sumY * 4,  // 位偏移=旋前速度×4（:1614）
      orchestraHslCss((i / arms + phase) % 1, 1, 0.5), 1,          // 臂色=(num5+num3)%1（:1609）
      Math.hypot(vx, vy), { life: 90, vx, vy, damp: 0.99, grav: 0, size: 1.6 });
    game.spawnParticles?.(px + sumX * 4, py + sumY * 4, 'rgba(255,255,255,0.35)', 1, Math.hypot(vx, vy),
      { life: 90, vx, vy, damp: 0.99, grav: 0, size: 0.48 });
  }
  for (let i = 0; i < 4; i++) {                          // d267 双层（:1641-1652）
    // ★M3（F6）：①jitter=MovementVector×NextFloatDirection×0.5 单标量 xy 共享（:1635,
    //  曾逐分量双掷且 moveY 丢项）②白影=CloneDust 精确复制（Dust.cs:260：velocity/
    //  scale/fadeIn 逐字段复制——scale=源/2、fadeIn=源×0.75、color 白、零掷）
    const hueC = orchestraHslCss((phase + rng() * 0.12) % 1, 1, 0.4 + rng() * 0.25);
    const cv = circ(rng, 1);                             // ★C2：circular(1,1) 单掷共享
    const jd = (rng() * 2 - 1) * 0.5;
    const scl = 0.6 + rng() * 0.9;
    const fd = 0.7 + rng() * 0.8;
    const d = game.spawnDust?.(x, y, 1, 1, 267,
      cv.x + moveX * jd, cv.y + moveY * jd, 0, hexToRgbArr(hueC), scl);
    if (d) {
      // ★BJ704-R12 P2-2：velocity/scale/fadeIn 逐字段后置写（vanilla :1633-1638 形,
      //  G2 三站同款第 4 站——spawn 形参走池会叠 ±2 速抖/±2% 比例抖,后置=精确终值）
      d.vx = cv.x + moveX * jd;
      d.vy = cv.y + moveY * jd;
      d.scale = scl;
      d.noGravity = true; d.fadeIn = fd; d.noLight = true; d.noLightEmittance = true;
    }
    // ★BJ703-B D3（2026-10-21）：白影改走 cloneDust 钩（:1643-1648 → Dust.cs:265-288,
    //  BJ700-D 范式,旧手工 spawnDust 重掷=速度/scale/帧三独立抖动近似）。
    //  noLight 随源拷（:279）;noLightEmittance【不在】CloneDust 字段表（:273-286）
    //  ——原文 :1648 克隆后显式重置,同相后置写。
    if (d) {
      const w = game.cloneDust?.(d);
      if (w) {
        w.scale /= 2;                                  // :1644 dust.scale /= 2f
        w.fadeIn *= 0.75;                              // :1645 dust.fadeIn *= 0.75f
        w.color = { r: 255, g: 255, b: 255, a: 255 };  // :1646 new Color(255,255,255,255)
        w.noLight = true; w.noLightEmittance = true;   // :1647-1648（emittance 非拷贝字段,显式重置）
      }
    }
  }
}

/**
 * Spawn_BestReforge（:3084-3102）：顶级词缀重铸 Research_Spark 八粒上旋闪点
 * （Circular(3,4) 上半收口 −2Y、重力 .1635/t）。生产者 Main.ReforgeItemInReforgeSlot
 * :42645 top-tier 支（reforge UI 本地直驱=clientOnly:true）。
 */
export function bestReforgeFx(game: GameHooks, x: number, y: number, rng: Rng = Math.random): void {
  for (let i = 0; i < 8; i++) {
    // ★F-12（2026-09-02 对抗批）：删 circ(16,16) 位抖（:3090-3096 原文=Circular(3,4)
    //  上半收口 −2Y 后直入 CreativeSacrificeParticle(PositionInWorld),无独立位掷）——
    //  位与掷流双恢复（每粒 2 掷,曾 4 掷）
    const c = circ(rng, 3, 4);
    const vy = (c.y > 0 ? -c.y : c.y) - 2;
    game.spawnParticles?.(x, y, '#FFE98A', 1, 1,
      { life: 60, vx: c.x, vy, grav: 0.1635, damp: 0.995, size: 1.1 });
  }
}

/**
 * Spawn_SilverBulletSparkle（:3278-3300）：银箭白炽单粒 streak（FadeInEnd 10/
 * FadeOutStart 20/FadeOutEnd 30 特档、accel=−movementVector/30）。
 * 生产者 P.cs:71888(SeraphNecklaced 飞行体)/77659 弹981 贴块段（clientOnly:true）。
 * ★⑥掷序清偿（2026-09-02）：原文首尾各一死掷（:3280 `_ = NextFloat()×τ`、
 * :3283 `NextFloat();` 均弃值）——补掷保 RNG 流对齐（全站 5 掷=原版）。
 */
export function silverBulletSparkleFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  rng();                                                 // 死掷（原版 :3280 掷不消费,RNG 流对齐）
  const sz = rng() * 0.2 + 0.4;                          // vector（:3282）
  rng();                                                 // 死掷（原版 :3283 掷不消费,RNG 流对齐）
  const off = circ(rng, 4);                              // ★C2：circular(4,4)×scale（:3285）单掷共享
  game.spawnParticles?.(x + off.x * sz, y + off.y * sz,
    'rgba(255,255,255,0.85)', 1, Math.hypot(moveX, moveY),
    // ★MINOR（F6）：AccelerationPerFrame=−MovementVector/30（:3290,注释已有,曾漏实现）
    { life: 30, vx: moveX, vy: moveY, ax: -moveX / 30, ay: -moveY / 30, damp: 1, grav: 0, size: 2 * sz });
}

/** Spawn_UFOLaser（:1956-1963）：d160 LimeGreen/CornflowerBlue 二选一双层行进尘 */
export function ufoLaserTrailFx(
  game: GameHooks, bx: number, by: number, px: number, py: number, uniqueInfo: number, rng: Rng = Math.random,
): void {
  orchestraLineWalk(bx, by, px, py, uniqueInfo, (dx, dy, nx, ny) => {
    for (const back of [0, 0.25]) {
      const col = rng() < 0.5 ? 'rgb(50,205,50)' : 'rgb(100,149,237)';
      spawnSingleLineDust(game, 160, dx - nx * back, dy - ny * back, col, rng);
    }
  });
}

/** Spawn_MagnetSphereBolt（:1965-1974）：磁球闪电行进尘（d160 缺省色,4 层回拖） */
export function magnetSphereBoltTrailFx(
  game: GameHooks, bx: number, by: number, px: number, py: number, uniqueInfo: number, rng: Rng = Math.random,
): void {
  orchestraLineWalk(bx, by, px, py, uniqueInfo, (dx, dy, nx, ny) => {
    for (const back of [0, 0.25, 0.5, 0.75]) {
      spawnSingleLineDust(game, 160, dx - nx * back, dy - ny * back, null, rng);
    }
  });
}

/** Spawn_HeatRay（:1976-1985）：热射线行进尘（d162 缺省色,4 层回拖） */
export function heatRayTrailFx(
  game: GameHooks, bx: number, by: number, px: number, py: number, uniqueInfo: number, rng: Rng = Math.random,
): void {
  orchestraLineWalk(bx, by, px, py, uniqueInfo, (dx, dy, nx, ny) => {
    for (const back of [0, 0.25, 0.5, 0.75]) {
      spawnSingleLineDust(game, 162, dx - nx * back, dy - ny * back, null, rng);
    }
  });
}

/** SpawnHelper_SpawnSingleLineDust(:2065-2074)：scale=rand(70..110)×0.013、velocity×0.2 */
export function spawnSingleLineDust(
  game: GameHooks, type: number, x: number, y: number, color: string | null, rng: Rng = Math.random,
): void {
  const d = game.spawnDust?.(x, y, 1, 1, type, 0, 0, 0, color ? hexToRgbArr(color) : null,
    (((rng() * 40) | 0) + 70) * 0.013);
  if (d) { d.x = x; d.y = y; d.vx *= 0.2; d.vy *= 0.2; }
}

// ==================== 环境杂件（ItemTransfer/PooFly/Dungeon/Heroicis/Voice/Nature/Lake/Snapping 环带/充能/HarpyCharm 家族） ====================

/**
 * Spawn_ItemTransfer（:2682-2703）＝ Chest.VisualizeChestTransfer（Chest.cs:309-317）
 * 入箱飞行件。uniqueInfo 低24位=itemType、高字节 bits{RandomizeStart,...}。本仓以
 * "金闪→终点吸入"双段近似 ItemTransferParticle 图标位移动画（图标贴图池无 API 登记）。
 * 生产者 = QuickStackToNearbyChests 包装位（BroadcastOrRequest 面；QuickStacking.FillStack
 * :533 / InsertIntoFreeSlot :564 每次实际搬运各一帧，Game.emitItemTransferFx 逐帧出站）。
 * ★Q-F4 跨端形差备忘（2026-09-01）：生产端 Game 已按原版 PlayerToChest 四旗
 * （RandomizeStart|RandomizeEnd|TransitionIn|Fullbright=Chest.cs:30-36 → uniqueInfo
 * 高字节 0b1111）写入载荷，本消费端仍只读 bit0（flagsByte&0x01=散布项圈）——原版
 * bit1 RandomizeEnd/bit2 TransitionIn/bit3 Fullbright 是 ItemTransferParticle 内部位面，
 * 本仓金闪近似不含其几何语义；协议注释在 syncModules.ItemTransfer 处登记。
 */
export function itemTransferFx(
  game: GameHooks, sx: number, sy: number, ex: number, ey: number,
  itemTypeVid: number, flagsByte = 0, rng: Rng = Math.random,
): void {
  void itemTypeVid;                                     // ContentSamples.ItemsByType[type] 门——调用侧保证非 air
  const dxs = ex - sx, dys = ey - sy;
  const life = 60;
  // ★F-14（2026-09-02 对抗批）：掷流恒补齐原版 3 掷（:2692 IsAir 门在掷前,调用侧保证
  //  非 air → 与 bit 无关恒掷）——:2695 TTL=Next(60,80)（本仓 life 恒 60,死掷流对齐）
  //  + :2697 NextVector2Square(-1,1) 逐轴均匀 2 掷（Utils.cs:1286-88;曾 circ 盘近似且
  //  bit0 才掷）
  rng();                                                // 死掷（原版 :2695 num=Next(60,80) TTL）
  const sqx = rng() * 2 - 1, sqy = rng() * 2 - 1;       // :2697 Square(-1,1) 逐轴
  if ((flagsByte & 0x01) !== 0) {
    // 原版消费面：flag→startVelocity=vector2×24（:2699 第 5 参）/ flag2→startOffset=
    // vector2×8（第 6 参,同源单向量两档）;本仓 Q-F4 只读 bit0 → 两档并联登记（函数头注）
    game.spawnParticles?.(sx + sqx * 8, sy + sqy * 8, '#FFF3B0', 1, 2,
      { life: life - 10, vx: sqx * 24, vy: sqy * 24, damp: 0.94, grav: -0.02, size: 1.3 });
  }
  game.spawnParticles?.(sx, sy, '#FFE98A', 1, 1,
    { life, vx: dxs / life, vy: dys / life, damp: 1, grav: 0, size: 1.5 });
}

/**
 * Chest.IndicateBlockedChest（Chest.cs:3578-3598）：快堆 locked 箱拒收回执——
 * RoomCheckParticle（TextureAssets.Cd 图标）于箱锚 (chest.x*16+16, chest.y*16+16)
 * 挂 60t：ColorTint (255,40,40)、Velocity=UnitY*0.1、AccelerationPerFrame=-UnitY*0.4/60
 * （初速缓下后转上浮）、淡入淡出。生产者 = QuickStacking.IndicateBlockedChests
 * （QuickStacking.cs:270-287 单人半边 → :285 循环）。
 * ★仓内形差登记：RoomCheckParticle/Cd 图标无独立池,等价以红粒子通道表达
 * （本条=Q-F7 的最低成本正确位——世界空间可感知,与原版同为单帧事件型反馈）。
 */
export function blockedChestFx(game: GameHooks, x: number, y: number): void {
  game.spawnParticles?.(x, y + 2, 'rgba(255,40,40,0.95)', 1, 1,
    { life: 60, vx: 0, vy: 0.1, damp: 1, grav: -(0.4 / 60), size: 2 });
}

/**
 * Spawn_PooFly（:2326-2336）：便便史莱姆身周飞虫环境粒（寿命 300、50/400 密度门简化恒生）。
 * 生产者 NPC.cs:61457（ai1==5395 命名态每 30 掷一粒,clientOnly:true）;粪砖 ambience 面无通道登记。
 */
export function pooFlyFx(game: GameHooks, x: number, y: number, rng: Rng = Math.random): void {
  game.spawnParticles?.(x, y, 'rgba(140,110,80,0.9)', 1, 0.6,
    { life: 300, vx: circ(rng, 0.4).x, vy: circ(rng, 0.4).y, damp: 0.99, size: 0.7 });
}

/**
 * Spawn_InScreenDungeonSpawn（:882-896）：双地牢种子带层内怪出生纸屑爆（gore61-63×2..4）
 * + npcType 直播 HitSound（本仓以 hitSfx 名注入,缺省静默登记）。
 * 生产者 NPC.NewNPC :5267（dualDungeonsSeed && 地下带,BroadcastOrRequest,MovementVector=(w,h)）。
 */
export function inScreenDungeonSpawnFx(
  game: GameHooks, x: number, y: number, w: number, h: number, _npcType: number,
  hitSfx: string | null, rng: Rng = Math.random,
): void {
  const n = ((rng() * 3) | 0) + 2;                       // Next(2,5)
  const bx = x - 0.5 * w, by = y - h;                    // vector=positionInWorld+(−0.5,−1)×mv（:886）
  for (let i = 0; i < n; i++) {
    // ★M5（F6）：出生位=基点+(−16,−16)+mv×(NextFloat, 0.5+NextFloat×0.5) 矩形单侧采样
    //  （:887-891,曾 circular 盘误形）；速度=NextVector2Circular(2,2) 单掷共享（:888）+
    //  补 position−=velocity×5（:893,曾漏——出生瞬间回拖 5t 航程）
    const px = bx - 16 + w * rng();
    const py = by - 16 + h * (0.5 + rng() * 0.5);
    const gv = circ(rng, 2, 2);
    rng();                                               // ★F-7（2026-09-02 对抗批）死掷（原版 :891 NewGorePerfect 第 3 参 Next(61,64) gore 型,本仓无 gore 池）
    game.spawnParticles?.(px - gv.x * 5, py - gv.y * 5, '#EDEDF2', 1, Math.hypot(gv.x, gv.y),
      { life: 44, vx: gv.x, vy: gv.y, grav: 0.22, damp: 0.99, size: 1.4 });
  }
  if (hitSfx) game.playSfxFiles?.([hitSfx], 1, x, y);
}

/**
 * Spawn_HeroicisSetSpawnSound（:898-901）：英雄套装湿沙出土纯音 SoundID.RainbowBoulder。
 * 生产者 WorldItem.cs:610（沙漠 wet 单堆转化,BroadcastOrRequest）——转化链未移植,消费面在位。
 */
export function heroicisSetSpawnSoundFx(game: GameHooks, x: number, y: number): void {
  game.playSfxWav?.('rainbow_boulder', 1, x, y);
}

/**
 * Spawn_PlayerVoiceOverrideSound（:2870-2885）：远端玩家受击变声播报——原版收端临时置
 * player.voiceOverride=(sbyte)settings.UniqueInfoPiece 后 PlayHurtSound()（:2874-2883,
 * 播毕还原）。★2026-09-01"变声字未建模"登记消账：uniqueInfo 字节 = 语音饰品
 * Item.voiceSlot（DefaultToVoiceOverrideAccessory 家族,voiceSlotOfItem 同源域）→
 * 直通 player/PlayerVoice 的 override 受击分派（hurtVoicePlan OVERRIDE_HURT 表,
 * 与本地 PlayHurtSound 同一口）。生产者 Player.cs:45810-45818
 * ItemCheck_UsePlayerSoundOverrideAccessory（clientOnly:false,uniqueInfo=voiceSlot）。
 */
export function playerVoiceOverrideSoundFx(
  game: GameHooks, _invokerSlot: number, x: number, y: number, voiceOverrideByte = 0,
): void {
  void x; void y;                                          // 原版按 invoker 玩家本位播放（无坐标衰减面）
  playHurtVoice(game, { voiceOverride: voiceOverrideByte });
}

/** Spawn_NatureFly（:1323-1334）：森林花虻（hsl ≤.14/α170、寿命 180-300）。生产者
 * TileDrawing.cs:7017 clientOnly:true——tile-ambient 通道未建,消费面+直驱保留登记。 */
export function natureFlyFx(game: GameHooks, x: number, y: number, rng: Rng = Math.random): void {
  const rgb = hexToRgbArr(orchestraHslCss(rng() * 0.14, 0.1 + 0.6 * rng(), 0.3 + 0.3 * rng()));
  game.spawnParticles?.(x, y, `rgba(${rgb.r},${rgb.g},${rgb.b},0.67)`, 1, 0.5,
    { life: 180 + ((rng() * 121) | 0), vx: circ(rng, 0.5).x, vy: circ(rng, 0.5).y, damp: 0.995, size: 0.55 });
}

/**
 * Spawn_LakeSparkle（:1336-1353）：湖面闪光星（star0 BehindPlayers、寿命 50-140、旋转速度被
 * movementVector 长度钳制缩放、scale .5-1）。FakeFish 族统一收编迁移面（评估结论=迁入统一池;
 * FakeFishJump 保持局部——跃态需池内密度门,详见 syncModules 注）。
 * ★F2（2026-09-01）：积分步 = 初速零（SetBasicInfo :1343 Velocity=Zero）+ 加速度
 * (move/60)/TTL（:1339 vector=/60 → :1346 /num 两段除法）——旧码把 MovementVector
 * 原值当初速（火箭形,终速/TTL 均错 60×life 倍）；TTL 耦合走 lifeExact 同值。
 */
export function lakeSparkleFx(
  game: GameHooks, x: number, y: number, moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const life = 50 + ((rng() * 91) | 0);                    // SetTypeInfo(num=50+90×rand)
  game.spawnParticles?.(x, y, `rgba(255,255,255,${rng().toFixed(2)})`, 1, 0,
    { lifeExact: life, vx: 0, vy: 0, ax: moveX / 60 / life, ay: moveY / 60 / life,
      damp: 1, grav: 0, size: 1 + rng() });
}

/**
 * 拍击石系三味 Spawn_ 环带段（:593/:649/:734）——SnapStrike 尘链外补 FadingParticle/
 * PrettySparkle 环带与三味音（Item72 vol1/PyroclasticStone vol.5/ArmletOfRuin vol.5）:
 * kind0 Stone：FadingParticle×2（Projectile_1121 蓝圈,Delay=Y×3,fadingParticles 池）;
 * kind1 Melee：PrettySparkle×2 红/金（prettySparkle 专用档+逐粒包络 ps*,DrawVerticalAxis
 *   =false 只画水平臂）+ d6 成对微尘;
 * kind2 Summon：FadingProjectile_1132 圈起×2 + Extra_34 旋星×1（fadingParticles 池,
 *   Delay=Y×3）+ d172×15/d211×8 圆阵（1/6 重力回落 scale×.25）。
 * ★池化清偿（2026-09-03）：旧 spawnParticles 方块近似退役——FadingParticle 走
 *   fx/FadingParticles.ts 真池（ABasicParticle/FadingParticle.Update 1:1+贴图/包络
 *   逐值）,PrettySparkle 走 VanillaDust prettySparkle 档（psFadeInEnd/psDrawVert/
 *   scax 等逐粒包络扩展,缺省=FetchFromPool 默认,princess/stardust 零改动）。
 * ★W-A1（2026-09-03 本/远端口径统一）：形参 = 编排载荷 MovementVector.X【原值】——
 *   与 snapStrikeDust 同一口径（禁收端预除 256）。三种消费式逐一对原文：
 *   kind0 num = 钳(X/256, ≤.12)（:602/:606-608）→ 圈起 size=6×num（:619 (6,6)×num/20）;
 *   kind1 X 丢弃（:657 `_ = MovementVector.X/256f` 裸弃,sparkle/尘均不消费）;
 *   kind2 num = 1f 字面常量（:743,与载荷无关）→ 钳后恒 .12（:747-749）→ 圈起
 *   size=9×.12（:763/:780 (9,9)×num/20）、d172/d211 scale=max(.75,2×(10×num))（:791/:804）。
 *   曾错：本地传原值却按 min(.12,X) 直钳（小目标环带过肥）/收端预除 256 再钳（kind2
 *   欠尺,kind2 原文本不吃载荷）——双端现统一"producer 传原值/消费端按原文换算"。
 */
export function snappingStoneRingFx(
  game: GameHooks, kind: 0 | 1 | 2, x: number, y: number, mvX: number, delayTicks = 0, rng: Rng = Math.random,
): void {
  if (kind === 0) {
    const ms = Math.min(0.12, mvX / 256);                  // :602 + :606-608
    game.playSfxWav?.('Item_72', 1, x, y);
    // ★环带 1:1（2026-09-03 池化清偿）：FadingParticle×2（:610-627）——
    //  贴图 = Projectile[1121]（:595 LoadProjectile）、ColorTint (30,180,255,0)
    //  （:612 纯加法档）、SetBasicInfo(·,null,Zero,Zero)（:614 静止起步）、
    //  SetTypeInfo(20)（:615 TTL）、FadeIn/OutNormalizedTime 0.1/0.1（:617-618）、
    //  Scale=Zero → ScaleVelocity=(6,6)×num/20（:619）→ ScaleAcceleration=−sv/20
    //  （:620 圈起先胀后缩）、LocalPosition=载荷位、Delay=(int)MovementVector.Y×3
    //  （:625——Y=出弹序号+1 :14429/受击者拍 Y=0 :14433,延迟出圈节拍）
    for (let i = 0; i < 2; i++) {
      fadingParticles.spawn({
        x, y,
        timeToLive: 20, fadeIn: 0.1, fadeOut: 0.1,
        scale: 0,                                          // Scale=Vector2.Zero（:618 圈起自零成长）
        scaleVelX: (6 * ms) / 20, scaleVelY: (6 * ms) / 20,
        scaleAccX: -((6 * ms) / 20) / 20, scaleAccY: -((6 * ms) / 20) / 20,
        tint: [30, 180, 255, 0],
        texKey: 'vanilla/Projectile_1121.png',
        delay: delayTicks * 3,
      });
    }
    return;
  }
  if (kind === 1) {
    game.playSfxWav?.('pyroclastic_stone', 0.5, x, y);
    const boltPhase = (rng() * 2 - 1) * Math.PI * 2 * 0.05;
    const num2 = 14;                                     // :660 速度基幅（d6 微尘同吃此幅）
    // ★L′-F7（2026-09-02 红队对抗,仲裁成立）：两循环 num5/num6 各只取值 1 → `if (num==1f)`
    //  恒真支（:688-692/:715-719）=Velocity×1.5+LocalPosition−=Velocity×4 两臂同吃——
    //  sparkle 速度幅=num2×1.5=21（旧 14=漏 ×1.5）;位偏=基支 vector×num×num3（:683/:711,
    //  14×30×0.15=63）+恒真支 Velocity×4（21×4=84）→ dir×147（旧 dir×63=半程）
    const spd = num2 * 1.5;
    // ★T3（2026-09-02 蓝队清偿）：红金同角——原文 :670（红,num5=1）/:699（金,num6=1）
    //  同式 (π/4+π/4·num+num4).ToRotationVector2()×14 → 恒 π/2+boltPhase（num4 :662
    //  单掷共享）。旧金臂 π/4+π/2=3π/4 的 45° 分叉系自造
    const a0 = Math.PI / 4 + Math.PI / 4 + boltPhase;
    const posOff = num2 * 30 * 0.15 + spd * 4;             // 基支 63（:683/:711）+恒真支 84（:692/:719）
    // ★环带 1:1（2026-09-03 池化清偿）：PrettySparkle×2 → spawnDust prettySparkle
    //  专用档（Renderer.drawSparkleArms 双轴星芒承载,逐粒包络 ps* 字段）——
    //  红（num5 循环 :667-695）/金（num6 循环 :696-731）逐值：
    //   TTL=int num=30 定值（:658 → :677/:706）;FadeIn/OutEnd=15/15、FadeOutEnd=30
    //  （:675-676/:704-705 num/2、num）;FadeIn/OutNormalizedTime=5E-06/0.95
    //  （:675/:676——Opacity 档,前 1 拍全亮、末 5% 淡出）;Scale=(8,2)×1.1|0.7 再 ×1.5
    //  恒真支（:674/:703+ :690/:717）;ScaleAcceleration=vector/num=(−4,0)/30（:679/:708）;
    //  Rotation=vector3.ToRotation()=a0（:672/:701）;Velocity=dir×14 →×1.5=dir×21
    //  （:677/:706+ :690/:717）;AccelerationPerFrame=−Velocity/num【APF 赋值序在 ×1.5
    //  之前】=−dir×14/30（:681-684/:710-712）;DrawVerticalAxis=false 只画水平臂
    //  （:686/:713）;LocalPosition=位−dir×147（基支+恒真支）。
    //  ★R3 ③（2026-09-03 锚校正+dst 衰减清偿）：AdditiveAmount=0.35 只写【红粒】
    //  （:681——旧注 ":678/:707" 锚错,:678/:707 是两粒各自的 FadeOutEnd;金粒循环
    //  :698-721【无】AdditiveAmount 写入 = 池缺省 1f,PrettySparkleParticle.cs:20/:43）。
    //  PrettySparkleParticle.cs:66-67 color2.A = ColorTint.A×Op×0.5×(1−AdditiveAmount)
    //  → 红 A=0.5:0.498×0.5×0.65≈0.16×Op×num（AlphaBlend Main.cs:63205 下=A 只进
    //  dst 因子的 erase 项,Renderer.drawSparkleArms psAdditive 通道承载）;金 A=1.0 且
    //  additive=缺省 1f → color2.A=0 纯加色无 dst 衰减（旧注"纯加色档不可观测,登记
    //  既有"对金成立、对红不成立）。
    //  色：红 Color(1f,0f,0f,0.5f)（:665→A 字节量化 127）/金 Color(1f,0.95f,0f,1f)
    //  （:666→A=255）→ rgb 直入、A 进 psAdditive erase 面与 color2.A 公式。
    const mkRing = (r: number, g: number, b: number, a: number, sxMul: number, syMul: number,
      additive?: number): void => {
      const sp = game.spawnDust?.(x - Math.cos(a0) * posOff, y - Math.sin(a0) * posOff, 0, 0, 0,
        Math.cos(a0) * spd, Math.sin(a0) * spd, 0, { r, g, b, a }, 1, true, true, true);
      if (!sp) return;
      sp.prettySparkle = true;
      sp.ttl = 30; sp.psAge = 0;
      sp.scaleX = sxMul * 1.5; sp.scaleY = syMul * 1.5;
      sp.scax = -4 / 30; sp.scay = 0;
      sp.rotation = a0;
      sp.ax = -(Math.cos(a0) * num2) / 30; sp.ay = -(Math.sin(a0) * num2) / 30;
      sp.psFadeInEnd = 15; sp.psFadeOutStart = 15; sp.psFadeOutEnd = 30;
      sp.psFadeInNorm = 5e-6; sp.psFadeOutNorm = 0.95;
      sp.psDrawVert = false;
      if (additive !== undefined) sp.psAdditive = additive;   // 红=0.35（:681）;金缺省 1f 不写
    };
    mkRing(255, 0, 0, 127, 8.8, 2.2, 0.35);  // 红（:665 Color(1,0,0,.5)→A=127 + :681 additive）
    mkRing(255, 242, 0, 255, 5.6, 1.4);      // 金（:666 Color(1,.95,0,1)→A=255,0.95×255=242.25→242/:703）
    // d6 成对微尘【只挂金带内】（:722-730 i 循环 ×2,每轮 ± 金臂各一粒 NewDustPerfect;
    //  旧挂在红/金两色循环内=红臂也对生一对,方向标签错但数值恰同（T3 后红金同角）——
    //  本批按原版嵌套重构,掷数/掷序不变：每轮 正臂 ja→spd2 → 负臂 ja→spd2（:724 正臂
    //  先/:727 负臂后,★F-3 曾 [-1,1] 反序;★M1（F6）第二粒取负向量,ja/spd2 各自独掷,
    //  ja 单掷共享 xy、半径 NextFloat 单掷乘整向量——旧逐分量独掷已退役;幅=基 vector4
    //  （×14 非 ×1.5 档）;全站掷账=1（num4）+4 尘×2 掷=9 掷对表）
    for (let i = 0; i < 2; i++) {
      for (const side of [1, -1]) {
        const ja = (rng() * 2 - 1) * Math.PI * 2 * 0.025;   // NextFloatDirection×τ×0.025（:724/:727）
        const spd2 = rng();                                // NextFloat 半径单掷
        // ★L′-F6（2026-09-02 红队对抗,仲裁成立）：原版 NewDustPerfect（:724/:727）→
        //  spawnDust 补第 12 参 perfect=true（定向速度原样入池,烟雾族 vy 重掷+vx×0.3 消解）
        const d = game.spawnDust?.(x, y, 1, 1, 6,
          side * num2 * Math.cos(a0 + ja) * spd2, side * num2 * Math.sin(a0 + ja) * spd2,
          0, null, 1.4, false, true);
        if (d) {
          d.noGravity = true;
          d.scale = 1.4;                                   // Perfect 后覆写（:726/:729——消解烟雾族 ×0.7,旧终值 0.98）
        }
      }
    }
    return;
  }
  game.playSfxWav?.('armlet_of_ruin', 0.5, x, y);
  const numSummon = 0.12;                     // :743 num=1f 字面常量（载荷无关）→ 钳 :747-749 恒 .12
  // ★环带 1:1（2026-09-03 池化清偿）：FadingParticle 段（:752-787）——
  //  双圈×2 = Projectile[1132]（:754 LoadProjectile）、ColorTint (90,110,255,90)
  //  （:750 colorTint 覆写 :753/:755 两连写死值,A>0=预乘半透档）、SetTypeInfo(20)、
  //  FadeIn/OutNormalizedTime 0.1/0.3（:758-759）、ScaleVelocity=(9,9)×num/20 →
  //  ScaleAcceleration=−sv/20（:761-762）、Delay=Y×3（:766）;
  //  旋星×1 = Extra[34]（:757 TextureAssets.Extra[34]）、FadeIn/Out 0.1/0.5（:778-779）、
  //  RotationVelocity=NextFloatDirection×τ×0.33/60（:784）、Rotation=NextFloat×τ（:785）。
  for (let i = 0; i < 2; i++) {
    fadingParticles.spawn({
      x, y,
      timeToLive: 20, fadeIn: 0.1, fadeOut: 0.3,
      scale: 0,                                            // :760 Scale=Zero
      scaleVelX: (9 * numSummon) / 20, scaleVelY: (9 * numSummon) / 20,
      scaleAccX: -((9 * numSummon) / 20) / 20, scaleAccY: -((9 * numSummon) / 20) / 20,
      tint: [90, 110, 255, 90],
      texKey: 'vanilla/Projectile_1132.png',
      delay: delayTicks * 3,
    });
  }
  fadingParticles.spawn({
    x, y,
    timeToLive: 20, fadeIn: 0.1, fadeOut: 0.5,
    scale: 0,                                              // :777 Scale=Zero
    scaleVelX: (9 * numSummon) / 20, scaleVelY: (9 * numSummon) / 20,
    scaleAccX: -((9 * numSummon) / 20) / 20, scaleAccY: -((9 * numSummon) / 20) / 20,
    tint: [90, 110, 255, 90],
    texKey: 'vanilla/Extra_34.png',
    delay: delayTicks * 3,
    rotVel: (rng() * 2 - 1) * Math.PI * 2 * 0.33 / 60,   // :784 NextFloatDirection
    rot: rng() * Math.PI * 2,                            // :785 NextFloat
  });
  for (const [type, n] of [[172, 15], [211, 8]] as Array<[number, number]>) {   // :788-813
    for (let k = 0; k < n; k++) {
      const sp = circ(rng, 10);                          // Circular(10,10)（:792/:805）
      const g6 = rng() < 1 / 6;                          // :795/:808 Next(6)==0 ★F-13 先掷后写（原版池满哑元照样掷）
      const d = game.spawnDust?.(x, y, 1, 1, type, sp.x, sp.y, 0, null,
        Math.max(0.75, 2 * (10 * numSummon)),            // :793/:806 max(.75, 2×num4),num4=10×num（:791/:804）
        false, true);   // ★R3 ②（2026-09-03）：perfect=true——原版 NewDustPerfect（:792/:805,
                         //  Dust.cs:54-63 位速精确覆写=圆阵值原样入池,消解 +4/+4 位偏/±2 速抖;
                         //  kind1 d6 :2176 先例同通道对齐）;noGravity 由 :795-799 档后置写
      if (!d) continue;
      d.noGravity = true;
      if (g6) { d.noGravity = false; d.scale *= 0.25; }
    }
  }
}

/**
 * 充能三连收编（Player.Update_SnappingStone :28607/:28612/:28617 → Spawn_*Recharge
 * :454/:437/:418）：snapping=226×10 α255 pull/pyroclastic=6×15 Circular(2,4)/
 * armlet=15×10 α60 pull,全档 noLight/noGravity/noLightEmittance/followPlayer。
 */
export function snappingStoneRechargeFx(
  game: GameHooks, kind: 0 | 1 | 2, px: number, py: number, pw: number, ph: number, rng: Rng = Math.random,
): void {
  const cfg = kind === 0 ? { dust: 226, count: 10, alpha: 255, scale: 0.9, pull: true }
    : kind === 1 ? { dust: 6, count: 15, alpha: 255, scale: 1.5, pull: false }
      : { dust: 15, count: 10, alpha: 60, scale: 0.9, pull: true };
  for (let i = 0; i < cfg.count; i++) {
    // ★F-13（2026-09-02 对抗批）：pyroclastic 支的 Circular(2,4) 掷先于池满哑元判定
    //  （:448 原版哑元照样掷;pull 档原版无掷维持零掷）
    const pc = cfg.pull ? null : circ(rng, 2, 4);
    const d = game.spawnDust?.(px, py, pw, ph, cfg.dust, 0, 0, cfg.alpha, null, cfg.scale);
    if (!d) continue;
    d.noLight = true;
    d.noGravity = true;
    d.scale = cfg.scale;
    d.fadeIn = 1.1;
    d.y = py + ph / 2;
    if (pc) {
      // ★F6 清偿：Spawn_PyroclasticStoneRecharge=NextVector2Circular(2,4)（:448）线性盘
      //  ——曾裸 Math.random 逐轴盒均匀
      d.vx = pc.x; d.vy = pc.y;
    } else {
      d.vx *= 0.5;
      d.vy *= 3;
    }
    d.alpha = cfg.alpha;
    d.followPlayer = true;
    d.noLightEmittance = true;
  }
}

/**
 * Spawn_HarpyCharm 三味同体（:472-591）：弧线引矢家族（HarpyCharm 6166/PhoenixQuiver
 * 6181/SeraphNecklace 6180）。FadingParticle 外抛 RotatedByRandom(τ)×NextFloat×0.25×num4
 * 组 4(+2)/内环 ±0.314×1×num4 组 3(+2)+单粒 PrettySparkle 十字
 * （蓝 hsl(.65,1,.5)/红(242,42,0,20)/金(249,225,102,255)分味）;音 Item39/Item20。
 * 生产者 Projectile.ApplyHarpyCharm :58802 clientOnly:false。
 */
export function harpyCharmFamilyFx(
  game: GameHooks, itemVid: number, x: number, y: number,
  moveX = 0, moveY = 0, rng: Rng = Math.random,
): void {
  const phoenix = itemVid === 6181;
  const seraph = itemVid === 6180;
  const up = phoenix || seraph ? 2 : 1;
  if (phoenix) game.playSfxWav?.('Item_20', 1, x, y);
  else game.playSfxWav?.('Item_39', 1, x, y);
  const life = 30;
  for (let i = 0; i < 4 * up; i++) {
    // ★F6 清偿（C1）：RotatedByRandom(6.2831854820251465)（:529）三角=NextDouble×r−
    //  NextDouble×r——参数=maxRadians 本尊（≈τ 全圆）非半幅,曾 ×π 砍半支撑集
    const ja = (rng() - rng()) * 6.2831854820251465;
    const bx = moveX * Math.cos(ja) - moveY * Math.sin(ja);
    const by = moveX * Math.sin(ja) + moveY * Math.cos(ja);
    const spd = rng() * 0.25 * up;
    game.spawnParticles?.(x, y, 'rgba(255,255,255,0.75)', 1, Math.hypot(bx, by) * spd,
      { life, vx: bx * spd, vy: by * spd, damp: 1, grav: 0, size: 1.5 });
  }
  for (let i = 0; i < 3 * up; i++) {
    const ja = (rng() - rng()) * 0.3141592741012573;     // ★F6 清偿：RotatedByRandom(0.31415927)（:551）三角
    const bx = moveX * Math.cos(ja) - moveY * Math.sin(ja);
    const by = moveX * Math.sin(ja) + moveY * Math.cos(ja);
    const spd = rng() * up;
    game.spawnParticles?.(x, y, 'rgba(255,236,200,0.85)', 1, Math.hypot(bx, by) * spd,
      { life, vx: bx * spd, vy: by * spd, damp: 1, grav: 0, size: 1.5 });
  }
  {
    const lifeT = ((rng() * 20) | 0) + 20;               // Next(20,40)
    const col = phoenix ? 'rgba(242,42,0,0.08)' : seraph ? 'rgba(249,225,102,1)'
      : orchestraHslCss(0.65, 1, 0.5);
    const k = phoenix || seraph ? 0.3 : 1;
    game.spawnParticles?.(x, y, col, 1, Math.hypot(moveX, moveY) * k,
      { life: lifeT, vx: moveX * k, vy: moveY * k, damp: 1, grav: 0, size: 3.2 });
  }
}
