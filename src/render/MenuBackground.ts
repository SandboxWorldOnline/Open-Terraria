// 主菜单背景（1456 UpdateMenu 调度钟 2026-08-23；2026-08-26 层渲染外迁）。
// 原版标题屏 = 森林背景（DrawBG gameMenu 分支），调度本体在 Main.cs:20011
// UpdateMenu + :49011 DrawMenu（1458 反编译行号，下同；数值面与 1456 比对一致）：
//  · 时间（cs:20106-20180）：昼 time+=33.88235294117647/帧、夜 +=30.857142857142858
//    （60fps 定帧）→ 全昼夜 ≈44.1s 真实时间（昼 26.6s/夜 17.5s）。夜尽 time>32400
//    → time=0/dayTime=true/moonPhase++(wrap 8)/bloodMoon=false；昼尽 >54000 → 入夜。
//    初始 = 开局态 time 13500（8:15AM）/满月/moonType 0。
//  · 背景组重掷（cs:20070-20100）：夜 time≥16200 每夜一次 RandomizeBackgrounds；
//    昼 time≥27000 每日一次 moonType=Next(9)+重掷。173 守卫 ×2（treeBGSet1[0]==173
//    连重掷两次）。lockMenuBGChange：生成/读档世界期 true，menuMode==0 解锁。
//  · 森林样式池 RollRandomForestBGStyle（WorldGen.cs:7983）+ SetForestBGSet 全表
//    （:7589-7710，样式 1-13+31/51/71/72/73）。
//  · 星坠落：夜 rand(12)==0/帧 → 随机星 Fall（cs:20048 LetStarsFallInMenu）。
//  · 日月抓取（alreadyGrabbingSunOrMoon cs:20106）只冻结时间推进——重掷/坠星照跑。
//  · MenuXMovement += 4/帧，wrap ±2^31（cs:49041-49050）。
// 层渲染（远山/树层/腐化槽/tint 烘焙/173 动画/341 帧图）已于 2026-08-26 整体外迁
// BiomeBackground 的 menuMode 分支（原版「菜单/游戏内同一 DrawSurfaceBG，仅
// gameMenu 分支切差异」架构）——本类只剩调度钟 + sky.draw 接线，每 tick 经
// biomeBg.setMenuStyles/menuTick 驱动、biomeBg.drawMenu 出图。
import { starvedLock, glStatFrame } from './GLStats';
import { SkyRenderer } from './SkyRenderer';
import { BiomeBackground } from './BiomeBackground';
import { menuThemeSnapshot } from '../mods/hooks';
import { GLSpriteLayer } from './GLSpriteLayer';
import { Clock } from '../world/World';
import { lateImageRetry } from '../assets/lateImageRetry';
import {
  colorOfTheSkies, setFrameAurora, setFrameAtmo, setFrameBiome, setFrameCloudDim,
  setFrameLightning, setFrameHorizon,
} from '../lighting/SkyColor';

/** Main.rand 菜单侧替身（UnifiedRandom Next 语义：Next(n) ∈ 0..n-1） */
function nextInt(n: number): number { return Math.floor(Math.random() * n); }

/** RollRandomForestBGStyle（WorldGen.cs:7899-7911）加权滚掷 */
function rollForestStyle(): number {
  let n = nextInt(14);
  if ((n === 1 || n === 2) && nextInt(2) === 0) n = nextInt(14);
  if (n === 0) n = nextInt(14);
  if (n === 3 && nextInt(3) === 0) n = 31;
  if (n === 5 && nextInt(2) === 0) n = 51;
  if (n === 7 && nextInt(4) === 0) n = 71 + nextInt(3);
  return n;
}

/** 供 TitleMenu 读取的菜单时间状态（LogoA/LogoB 昼夜交叉淡化用） */
export const menuTimeInfo = { timeOfDay: 13500 / 54000 * 0.625 + 0.1875, dayFactor: 1 };

const FRAME_MS = 1000 / 60;          // 原版定帧步长（速度常量按帧计）
const MENU_X_WRAP = 2147483647;      // :47626 screenPosition.X wrap 边界

export class MenuBackground {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sky = new SkyRenderer();
  /** 仅供 setClockT/sky.draw 的 Clock 形参载体——时间由 tick 按原版公式直写 */
  private clock = new Clock(24 * 60 * 1000);

  // ---- 原版菜单调度状态（Main.UpdateMenu）----
  private vTime = 13500;              // Main.time（昼 0..54000 / 夜 0..32400）
  private dayTime = true;
  private moonPhase = 0;
  private moonType = 0;               // Main.moonType（:19759 每日 27000 后 Next(9) 重掷）
  private dayCount = 1;
  private menuBGChangedDay = false;   // cs:1949 字段/:20070 写点
  private menuBGChangedNight = false;
  private lockBG = false;             // lockMenuBGChange（生成/读档期）
  private grabbing = false;           // alreadyGrabbingSunOrMoon（只冻时间 cs:20106）
  /** 暂停门（2026-08-27 用户报:过渡图阶段菜单背景已在背后跑——时间空转+全屏
   *  天空渲染与资源下载/解码抢算力。菜单挂在 splash 后备场(2026-08-24 定案)但
   *  揭幕(main.ts revealBehind→resumeMenuBg)前零 tick 零绘制,画布保持黑底由
   *  splash 全遮;揭幕瞬间恢复,时间从初始值起播=「进主菜单才开始播动画」 */
  private paused = false;
  private grabUntil = 0;
  private starAcc = 0;                // 定帧累积器（坠星 1/12 每帧）
  /** 当前森林样式（WorldGen.treeBG1 菜单侧；初始 = 开局默认样式 1）。
   *  每 tick 经 biomeBg.setMenuStyles 注入渲染层 */
  style = 1;
  /** WorldGen.corruptBG（夜晚菜单槽 bgStyle=1 = Corruption！DrawBG cs:64981——
   *  UpdateMenu 的 setBG(1,style) cs:20085 保它过午夜重掷 = 夜槽可见性铁证） */
  private corruptStyle = 0;
  /** 层渲染宿主（menuMode 实例 = 原版 gameMenu 分支同栈）：双槽交叉淡化坡道
   *  （backgroundLayerTransitionSpeed=0.02 cs:64978）、远山/树层/腐化槽绘制、
   *  tint 烘焙全在其内——本类只写样式与昼夜旗（原版菜单零硬切：重掷保留
   *  可见槽由 randomizeMenuBG 的保槽逻辑承担，切换全走其 alphaFront 淡化） */
  private biomeBg = new BiomeBackground(true);
  /** ★三百十五:菜单主题背景(Calamity MainMenu 同构)——主题图在册=整幅替换
   *  并跳过视差;Cinders 火星粒子画于其上 */
  private themeImg: HTMLImageElement | null = null;
  private themeImgReady = false;
  private themeCinderImg: HTMLImageElement | null = null;
  private themeCinderReady = false;
  private cinders: Array<{ lifetime: number; time: number; idx: number; scale: number; vx: number; vy: number; x: number; y: number; color: string }> = [];

  private camX = 0;

  // ---- 菜单云 GL 层(2026-08-24 trace 热点修复) ----
  // 旧状:cloudGlLayer 只有 Renderer 帧路径注入(Renderer.ts:2552),菜单 tick 直调
  //  sky.draw 恒 null → 菜单云永远走 2D cloudTint 兜底 = 每云每帧染色缓存查+
  //  重烘+合成 drawImage(trace:云合成 2.4s+重烘 2.0s+cloudTint self 2.8s/54s,
  //  是菜单主线程第一热点)。GL 主路径(游戏内同款)逐精灵顶点色零副本。
  //  获取语义与 Renderer.acquireGL 1:1:活实例直取;上下文死亡 5s 退避;
  //  初始化失败 30s 闩(SwiftShader/--disable-gpu 下 GLSpriteLayer 自标
  //  unavailable → 恒走 2D 兜底,与旧菜单行为一致)。?cloudgl=0 逃生门同享。
  private glCloud: GLSpriteLayer | null = null;
  private glCloudRetryAt = 0;

  private acquireCloudGL(): GLSpriteLayer | null {
    if (!this.sky.useGLClouds) return null;
    const g = this.glCloud;
    if (g) {
      if (!g.unavailable) return g;
      if (performance.now() - g.diedAt < 5000) { this.glCloud = null; return null; }
      g.dispose();
      this.glCloud = null;
    }
    if (performance.now() < this.glCloudRetryAt) return null;
    // 饥饿锁(#三开压测批):菜单云 GL 层不参与重建竞争——死掉走 2D cloudTint 兜底,
    // 与游戏内四厂同一纪律(此前唯独本入口裸奔 = 三开菜单页死亡螺旋无人闸)
    if (starvedLock()) return null;
    const inst = new GLSpriteLayer();
    inst.statName = 'menubg';   // #perf-gpulog
    if (inst.unavailable) {
      inst.dispose();
      this.glCloudRetryAt = performance.now() + 30_000;
      return null;
    }
    this.glCloud = inst;
    return inst;
  }

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;z-index:0;';
    parent.insertBefore(this.canvas, parent.firstChild);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.resize);
    // 菜单帧态清零（UpdateMenu cs:20041-20044 lightning=0/Graveyard=0 语义）——
    // 退盘回菜单时 Renderer 的帧状态残留会渗进 colorOfTheSkies
    setFrameBiome(null);
    setFrameAurora(null);
    setFrameCloudDim(1);
    setFrameLightning(0);
    setFrameHorizon(null);
    setFrameAtmo(1);   // :62633 gameMenu 强制 atmo=1（★缺此则太空退盘残留 atmo=0
                       //  把标题天空涂黑——2026-08-25 最终清零 review 抓出）
    this.sky.moonType = 0;
    // 菜单地表默认值（小世界 surface≈4300px）：★原版 Main.worldSurface 无启动
    //  初始化（仅生成/读档/联机写入）——冷启动标题 num3=(300-屏Y)/max(1,0) 爆表，
    //  云/大气全废（vanilla 自身怪癖）；玩过一局回标题才有正常云。本仓菜单恒给
    //  小世界地表 → 云带/atmo 恒归位（优于原版冷启动态）
    if (this.sky.fx.surfaceY <= 0) {
      this.sky.fx.surfaceY = 4300;
      this.sky.fx.worldW = 4200;
    }
  }

  private resize = () => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

  /** 标题屏日月拖拽写时间（GOING_OLDSCHOOL B2，TitleMenu 反算 t01 抛出）。
   *  反解回 vanilla time/dayTime 供调度链继续；拖拽期时间冻结 = 本方法每次调用
   *  刷 grabUntil 300ms 尾窗（tick 里 grabbing=now<grabUntil ≈ 原版
   *  alreadyGrabbingSunOrMoon 按住态 cs:20106——松手后 300ms 内恢复推进，无感） */
  setClockT(time01: number): void {
    const t = ((time01 % 1) + 1) % 1;
    this.clock.timeOfDay = t;
    if (t > Clock.DAWN && t < Clock.DUSK) {
      this.dayTime = true;
      this.vTime = (t - Clock.DAWN) / 0.625 * 54000;
    } else {
      this.dayTime = false;
      this.vTime = ((((t - Clock.DUSK) % 1) + 1) % 1) / 0.375 * 32400;
    }
    this.grabUntil = performance.now() + 300;
  }

  /** 日月拖拽垂直跟手（Main.cs cs:63947/:63962 sunModY/moonModY）——透传 SkyRenderer */
  setCelestialModY(dayTime: boolean, modY: number): void {
    this.sky.setCelestialModY(dayTime, modY);
  }

  /** lockMenuBGChange（世界生成/读档期置 true，回标题解锁——mainFlow 接线点） */
  setBGLock(on: boolean): void { this.lockBG = on; }

  /** RandomizeBackgrounds 的菜单侧（UpdateMenu cs:20070-20100：重掷 + 173 守卫 ×2）。
   *  ★可见槽保留由调用方负责（cs:20085 setBG(1,style) 夜保腐化 /
   *  cs:20097 setBG(0,treeBG) 昼保森林）——原版菜单零硬切的关键 */
  private randomizeMenuBG(): void {
    this.style = rollForestStyle();
    if (this.style === 6) this.style = rollForestStyle();      // treeBGSet1[0]==173
    if (this.style === 6) this.style = rollForestStyle();
    const n = nextInt(6);                                       // RandomizeBackgrounds_Corruption
    this.corruptStyle = n === 5 ? (nextInt(2) === 0 ? 51 : 52) : n;
  }

  /** vanilla time/dayTime → Clock.timeOfDay（昼 4:30AM=0.1875 起 0.625 跨度） */
  private syncClock(): void {
    this.clock.timeOfDay = this.dayTime
      ? Clock.DAWN + (this.vTime / 54000) * 0.625
      : (Clock.DUSK + (this.vTime / 32400) * 0.375) % 1;
    this.clock.moonPhase = this.moonPhase;
    this.clock.dayCount = this.dayCount;
  }

  /** 揭幕前冻结（mainFlow.showTitle(bgPaused)→resumeMenuBg 接线） */
  setPaused(on: boolean): void { this.paused = on; }

  /** ★幕布期 z 抬升（2026-10-22 用户实报「渲染世界阶段动态背景早退」定谳修复）：
   *  c10e 转正（2026-10-01 缺省开）后 Game 三画布（sky2D/glCanvas/主画布）全部
   *  position:absolute（z-auto）且 attach() appendChild 到 root 末端——与本画布
   *  （z-index:0，insertBefore firstChild）同处 z-auto/0 层，CSS 绘制序按 DOM
   *  树序=三画布画在幕布【之上】，g.start() 首帧即整层埋掉幕布（读档「正在渲染
   *  世界」期进度条与游戏画面同屏=动态背景「早退」体感；wbake 覆盖门要遮的
   *  视口空白窗随之重新暴露）。c10e 转正前主画布是 static in-flow（绘制于全部
   *  positioned 元素之下），z0 幕布才盖得住——三开压测批幕布设计成立的前提
   *  即此，c10e 转正时未随迁（探针 scripts/_curtain-zorder-probe.mjs 窗内
   *  elementFromPoint=game-main 坐实）。
   *  修复=幕布期抬 z 0→5：盖过三画布（z-auto），低于 HUD（.sw-root z10,抑制期
   *  照旧在上）/DOM 进度页（z290,HUD 抑制豁免件）/VUI（z300）。置位=mainFlow.
   *  enterGame（g.start() 前——世界首帧起幕布恒在上）；复位=showTitle（实例
   *  复用沿，防御 quitToMenu 于幕布窗内退出等路径）；stopMenu 销毁画布=天然
   *  复位。标题态缺省 z0 语义零变化。 */
  setCurtainMode(on: boolean): void { this.canvas.style.zIndex = on ? '5' : '0'; }

  // ---- ★IIIII218 生成屏背景动效（Main.UpdateMenu/DrawMenu 生成期分支 1:1）----
  /** 生成屏种子表现旗标（mainFlow.createWorldFlow 注入；null=标题态全部还原）。
   *  vanilla 语义：以下分支全部判 WorldGen.remixWorldGen / drunkWorldGen /
   *  drunkWorldGenText（生成期旗,标题屏为 false）——表现面随机源一律 Math.random
   *  （原版此处消费 Main.rand,与本仓 genRand 世界掷流零共享,世界数据零扰动） */
  private genFlags: import('../vui/states/UIWorldLoadState').GenScreenSeedFlags | null = null;

  /** 生成屏旗标注入/清除（生成结束还原——mainFlow 接线） */
  setGenFlags(flags: import('../vui/states/UIWorldLoadState').GenScreenSeedFlags | null): void {
    this.genFlags = flags;
    if (!flags) {
      this.sky.menuCloudTypeForce = null;
      this.sky.menuNumCloudsOverride = null;
    }
  }

  /** 生成期每 tick 注入云强制（Cloud.cs:352-388 + Main.cs:20021-20026） */
  private applyGenCloudForce(): void {
    const f = this.genFlags;
    if (f?.drunkWorldGenText) {
      this.sky.menuNumCloudsOverride = f.dontStarveWorldGen
        ? 50
        : 100 + Math.floor(Math.random() * 100);          // Next(100,200) 每帧重掷
      this.sky.menuCloudTypeForce = (scale: number) => {  // 云型五档（Update :352-388 序）
        // ★IIIII223 F-4：onlyShimmerOceanWorlds=29 首支（Cloud.cs:354-356 +
        //  Main.cs:2758-2769 getter：drunkWorld && tenthAnniversaryWorld && !remixWorld
        //  && !zenithWorld → !notTheBees；生成期 WorldGen.cs:11142-11149 Main.*=*Gen
        //  同拍置位 → 旗标源=GenScreenSeedFlags 组合，218 批「无旗标源」备案解除）
        if (f.drunkWorldGen && f.tenthAnniversaryWorldGen && !f.remixWorldGen
          && !f.zenithWorld && !f.notTheBees) return 29;
        if (f.dontStarveWorldGen) {
          if (scale < 0.7) return 40;
          if (scale < 0.8) return 39;
          if (scale < 0.9) return 38;
          return 37;
        }
        if (f.getGoodWorldGen) return scale < 0.8 ? 25 : 26;
        return 28;
      };
    } else {
      this.sky.menuNumCloudsOverride = null;
      this.sky.menuCloudTypeForce = null;
    }
  }

  tick(dtMs: number) {
    if (this.paused) return;   // 零推进零绘制零 GL 云层获取——加载密集期不抢算力
    glStatFrame();   // #perf-gpulog:菜单循环推进 GPU 账本(Game 循环未建, gpulog 菜单期可观测)
    const frames = Math.min(8, dtMs / FRAME_MS);   // 后台标签回来防大步进雪崩
    const remixGen = !!this.genFlags?.remixWorldGen;
    const drunkGen = !!this.genFlags?.drunkWorldGen;
    // 星坠落（Main.cs:20047-20056 UpdateMenu）：`(!dayTime || remixWorldGen) &&
    //  (rand.Next(12)==0 || (drunkWorldGen && !remixWorld))`——remix 生成期【白昼】
    //  也坠星；drunk 非 remix = 每帧必坠（流星雨）。抓取中照跑；FocusHelper.
    //  LetStarsFallInMenu=窗口聚焦门（vanilla IsSelectedApplication,聚焦即真）
    if (!this.dayTime || remixGen) {
      this.starAcc += frames;
      while (this.starAcc >= 1) {
        this.starAcc -= 1;
        if (nextInt(12) === 0 || (drunkGen && !remixGen)) {
          this.sky.starFallAt(Math.random() * 1000, 1000);
          this.starFallCount++;   // ★IIIII218 观测面
        }
      }
    }
    // 背景组重掷调度（cs:20070-20100，抓取中照跑）。★可见槽保留（原版菜单零硬切）：
    //  夜重掷保 corruptBG（setBG(1,style) cs:20085——夜槽=腐化正显示）、
    //  昼重掷保 treeBG1（setBG(0,treeBG) cs:20097——昼槽=森林正显示）。
    //  锁定期两旗恒 true（cs:20096-20098 else 分支）——解锁后当夜/当日不再补掷，
    //  曾缺 = 解锁瞬间立即补掷一次（与原版时序差一拍）
    if (!this.lockBG) {
      if (this.dayTime) {
        this.menuBGChangedDay = false;
      } else if (!this.menuBGChangedDay && this.vTime >= 16200) {
        this.menuBGChangedDay = true;
        const keepCorrupt = this.corruptStyle;
        this.randomizeMenuBG();
        this.corruptStyle = keepCorrupt;
      }
      if (!this.dayTime) {
        this.menuBGChangedNight = false;
      } else if (!this.menuBGChangedNight && this.vTime >= 27000) {
        this.menuBGChangedNight = true;
        this.moonType = nextInt(9);                    // cs:20093 moonType=Next(9)
        this.sky.moonType = this.moonType;
        const keepForest = this.style;
        this.randomizeMenuBG();
        this.style = keepForest;
      }
    } else {
      this.menuBGChangedDay = true;                    // cs:20096-20098
      this.menuBGChangedNight = true;
    }
    // 样式注入 + 昼夜 bgStyle 翻转（cs:64981 夜=1 Corruption/昼=0 Forest1）与双槽
    // 0.02/帧交叉淡化（gameMenu transitionSpeed cs:64978 + FrontLayer 坡道 cs:65065）
    // ——状态机整体在 BiomeBackground.menuTick（menuMode 分支），本类只喂旗标
    this.biomeBg.setMenuStyles(this.style, this.corruptStyle);
    this.biomeBg.menuTick(this.dayTime, dtMs);
    // 时间推进（cs:20148-20180；alreadyGrabbingSunOrMoon → 冻结 cs:20106）
    this.grabbing = performance.now() < this.grabUntil;
    if (!this.grabbing) {
      if (this.dayTime) this.vTime += 33.88235294117647 * frames;
      else this.vTime += 30.857142857142858 * frames;
      if (!this.dayTime && this.vTime > 32400) {
        this.vTime = 0;
        this.dayTime = true;
        this.moonPhase = (this.moonPhase + 1) % 8;     // cs:20166-20170
        this.dayCount++;
      } else if (this.dayTime && this.vTime > 54000) {
        this.vTime = 0;
        this.dayTime = false;
      }
    }
    this.syncClock();
    menuTimeInfo.timeOfDay = this.clock.timeOfDay;
    menuTimeInfo.dayFactor = this.clock.dayFactor;
    // 云色单源（= Renderer 帧内 this.sky.cots 同款）：ColorOfTheSkies——菜单不喂
    //  则云回落 lastSkyTop(天空顶色深蓝)→深蓝云画在深蓝天上隐形（实测 lit=0）
    setFrameAtmo(1);   // :62633 gameMenu 每帧强制(实例复用时构造器复位不重跑)
    this.sky.cots = colorOfTheSkies(this.clock.timeOfDay, this.dayCount, false, false, this.moonPhase, true);
    // MenuXMovement（:47625-47631：+4/帧，wrap ±2^31）+ ★IIIII218 生成漂移臂
    // ★IIIII223 F-1：-20/帧嵌套在 if(WorldGen.drunkWorldGen) 内（Main.cs:20013-20018，
    // 1457/1458 逐字同构：`if (drunkWorldGen) { if (remixWorldGen) screenPosition.X -= 20f; }`）
    // ——仅 drunk∧remix（天顶族）漂移；纯 remix(dontdigup,drunk=false) 与纯 drunk 均
    // 【不漂移】（218 批误读嵌套层，把 -20 挂到了裸 remix 上）
    this.camX += (remixGen && drunkGen ? -20 : 0) * frames + 4 * frames;
    if (this.camX > MENU_X_WRAP) this.camX = 0;
    if (this.camX < -MENU_X_WRAP) this.camX = 0;
    // ★IIIII218 云强制/云量（drunkWorldGenText 生成期,Cloud.cs:352-388/cs:20021-20026）
    this.applyGenCloudForce();

    const W = this.canvas.width, H = this.canvas.height;
    // ★三百十五:菜单主题背景(CalamityMainMenu_Classic PreDrawLogo 同构)——
    //  主题图在册=整幅 cover 画出并【整体跳过】视差背景(sky/biomeBg/云/光斑;
    //  源注释「typical parallax background is skipped entirely」)+Cinders 火星
    //  粒子(红/黄/灰烬,自底升+左右摆)。logo 属 DOM 层不受此支影响。
    const theme = menuThemeSnapshot();
    if (theme?.background) {
      if (!this.themeImg || !this.themeImg.src.endsWith(theme.background)) {
        this.themeImgReady = false;
        const im = new Image();
        im.onload = () => { this.themeImgReady = true; };
        im.src = theme.background;
        lateImageRetry(im, theme.background);   // ★BJ705-G26 件4:迟到单发重试
        this.themeImg = im;
      }
      const ctx = this.ctx;
      if (this.themeImgReady && this.themeImg!.naturalWidth > 0) {
        const im = this.themeImg!;
        const xScale = W / im.naturalWidth;
        const yScale = H / im.naturalHeight;
        const scale = Math.max(xScale, yScale);   // cover(源 xScale/yScale 择大)
        const dx = xScale >= yScale ? 0 : -(im.naturalWidth * scale - W) * 0.5;
        const dy = yScale > xScale ? -(im.naturalHeight * scale - H) * 0.5 : 0;
        ctx.drawImage(im, dx, dy, im.naturalWidth * scale, im.naturalHeight * scale);
      } else {
        ctx.fillStyle = '#141018';
        ctx.fillRect(0, 0, W, H);
      }
      // Cinders 火星粒子(源 :84-136;CalamitasCinder 贴图,主题 URL 同域)
      if (theme.cinderTex) {
        if (!this.themeCinderImg || !this.themeCinderImg.src.endsWith(theme.cinderTex)) {
          this.themeCinderReady = false;
          const im2 = new Image();
          im2.onload = () => { this.themeCinderReady = true; };
          im2.src = theme.cinderTex;
          lateImageRetry(im2, theme.cinderTex);   // ★BJ705-G26 件4:迟到单发重试
          this.themeCinderImg = im2;
        }
      }
      for (let f = 0; f < frames; f++) {
        for (let i = 0; i < 5; i++) {
          if (Math.random() >= 1 / 4) continue;
          const gray = Math.random() < 1 / 3;
          const color = gray
            ? `rgb(${Math.round(105 + 90 * Math.random())},${Math.round(105 + 90 * Math.random())},${Math.round(105 + 90 * Math.random())})`
            : (Math.random() < 0.5 ? 'rgb(178,34,34)' : 'rgb(255,236,139)');
          const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
          this.cinders.push({
            lifetime: 200 + Math.floor(Math.random() * 100), time: 0, idx: this.cinders.length,
            scale: 1, x: W * (Math.random() * 1.2 - 0.1), y: H * 1.05,
            vx: Math.cos(ang) * 4, vy: Math.sin(ang) * 4, color,
          });
        }
        for (const c of this.cinders) {
          const tail01 = Math.min(1, Math.max(0, 1 - c.time / c.lifetime));
          c.scale = cinderLerp(0.6, 0.9, (c.idx % 6) / 6) * tail01 * (c.idx % 13 === 12 ? 2 : 1);
          const flySpeed = cinderLerp(3.2, 14, (c.idx % 21) / 21);
          const sway = Math.sin(c.time / 16 + c.idx) * 0.5 + 0.5;
          const ivA = -Math.PI / 2 + cinderLerp(-0.44, 0.44, sway);
          const ivx = Math.cos(ivA) + 1, ivy = Math.sin(ivA);
          const len = Math.hypot(ivx, ivy) || 1;
          const tvx = (ivx / len) * flySpeed, tvy = (ivy / len) * flySpeed;
          const interp = cinderLerp(0.01, 0.08, Math.min(1, Math.max(0, (c.time - 45) / 100)));
          c.vx += (tvx - c.vx) * interp;
          c.vy += (tvy - c.vy) * interp;
          c.time++;
          c.x += c.vx; c.y += c.vy;
        }
        for (let i = this.cinders.length - 1; i >= 0; i--) if (this.cinders[i].time >= this.cinders[i].lifetime) this.cinders.splice(i, 1);
      }
      for (const c of this.cinders) {
        const s2 = Math.max(1, 8 * c.scale);
        if (this.themeCinderReady && this.themeCinderImg!.naturalWidth > 0) {
          ctx.globalAlpha = Math.min(1, c.scale);
          ctx.drawImage(this.themeCinderImg!, c.x - s2 / 2, c.y - s2 / 2, s2, s2);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = c.color;
          ctx.fillRect(c.x - s2 / 2, c.y - s2 / 2, s2, s2);
        }
      }
      return;
    }
    // 相机 Y = surface·16 − 屏高（DrawMenu :47620）——云 num3 视差/atmo 归位
    const camY = this.sky.vanillaMenuCamY(H);
    // 云 GL 层每帧注入(Renderer 帧路径同款;不可用/退避期 null = 2D 兜底)
    this.sky.cloudGlLayer = this.acquireCloudGL();
    this.sky.draw(this.ctx, this.clock, W, H, this.camX, dtMs, camY);
    // 层渲染委托（远山/树层/腐化槽，BiomeBackground menuMode 分支）：
    // tint = ColorOfTheSkies 单源（:61409 菜单也跑 SetBackColor → :56194），近白免烘。
    // near = 云三通插层（原版 DrawSurfaceBG 层序 cs:60384-60457：Step1 远山 →
    // DrawClouds_Closer → Step2 远山 → DrawClouds_Closest → 树层）——菜单此前
    // 只画 sky 层内的 distant pass，closer/closest 两 pass 缺失
    this.biomeBg.drawMenu(this.ctx, W, H, this.layerTint(), this.camX, {
      closer: () => this.sky.drawCloudsNear(this.ctx, W, H, camY, 'closer'),
      closest: () => this.sky.drawCloudsNear(this.ctx, W, H, camY, 'closest'),
    });
    // 晨昏镜头光斑（DoDraw 菜单路径 cs:63074 DrawLensFlare——★层序在 DrawBG
    // cs:63061 之后 = 光斑画在背景层【上】；曾画在 drawMenu 之前 = 被山/树压住）。
    // 游戏内侧 cs:63274 另有调用点（Renderer 自管，未动）
    this.sky.drawMenuFlare(this.ctx, W, H, camY);
  }

  /** 层 tint = ColorOfTheSkies（cs:64527 菜单也跑 SetBackColor → 层色 ×cots）。
   *  近白免烘（正昼）；量化烘焙与缓存约定在 BiomeBackground.menuTinted */
  private layerTint(): [number, number, number] | null {
    setFrameAtmo(1);
    const c = colorOfTheSkies(this.clock.timeOfDay, this.dayCount, false, false, this.moonPhase, true);
    if (c[0] >= 254.5 && c[1] >= 254.5 && c[2] >= 254.5) return null;
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }

  destroy() {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
    this.canvas.width = 0; this.canvas.height = 0;   // 立刻还回后备(不等 GC;双开预算紧)
    this.biomeBg.dispose();    // 菜单层渲染宿主(烘焙画布/贴图缓存随菜单释放)
    this.glCloud?.dispose();   // 菜单云 GL 层随菜单销毁(上下文/纹理全释放)
    this.glCloud = null;
    this.sky.cloudGlLayer = null;
  }

  /** 调试探针 */
  lastDt = 0;
  clockTime(): number { return this.clock.timeOfDay; }

  // ---- ★IIIII218 生成屏动效观测面（探针专用,零行为影响）----
  /** 坠星累计（tick 星坠支每次 Fall +1——drunk 生成期应≈60/s,remix 白昼应>0） */
  starFallCount = 0;
  /** 生成屏动效快照：旗标/相机漂移速度(px/帧)/云量/云型样本/坠星累计 */
  genAnimDebug(): {
    genFlags: unknown; camX: number; cloudTarget: number | null;
    cloudTypes: number[]; starFallCount: number; lockBG: boolean;
  } {
    return {
      genFlags: this.genFlags,
      camX: Math.round(this.camX),
      cloudTarget: this.sky.menuNumCloudsOverride,
      cloudTypes: (this.sky as unknown as { vclouds: Array<{ type: number }> }).vclouds.slice(0, 12).map((c) => c.type),
      starFallCount: this.starFallCount,
      lockBG: this.lockBG,
    };
  }
}


const cinderLerp = (a: number, b: number, t: number): number => a + (b - a) * t;
