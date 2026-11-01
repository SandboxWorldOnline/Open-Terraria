// 史莱姆枪黏胶弹(Projectile 406,Item.cs case 2610 :25505-25518;SetDefaults
// Projectile.cs:4866-4875;AI aiStyle==60 Projectile.cs:29430-29700;NewProjectile
// 出生掷 ai[1] Projectile.cs:10919-10920 case 406;Kill :75506-75515)
// ——玩具武器:枪/弹伤害恒 0,唯一效果=重叠 NPC 单次施加 Slimed(137)180t 后即爆
// (红队 X-F2 三缺修复):
//   ① 总门(:29438 `if (this.ai[0] > 3f)`):出生头几拍不施加不触杀;ai[0] 由出膛
//     掷定的步进率累加——`ai[1]=Main.rand.Next(10,21)*0.1f`(NewProjectile
//     Projectile.cs:10919-10920 case 406 专案,∈{1.0..2.0 步长0.1})→ 首扫最早第 3 拍、
//     最迟第 5 拍(同族 GlobProj 同法)。
//   ② 施加即爆(NPC 循环 :29464-29481):循内 `nPC5.AddBuff(...)`(:29479)后立即
//     `Kill()`(:29481),无 break → 同 tick 重叠的全体有效 NPC 都吃 buff,而 Kill
//     自带 `if (!active) return;` 重入护栏(Projectile.cs:71756-71759)→ 尘爆只放
//     一次;JS 侧以 hitNpc 聚合+单次 killBurst 等价承接。AddBuff 先于 Kill ⇒
//     buff 必已落账再爆。
//   ③ type==406 液体触杀(num452==137 支 :29531-29555):弹盒覆盖 tile 列行扫,
//     任一液格水面线(ty*16 + trunc((256−液量)/32)×2)高于 Bottom.Y 即 Kill
//     (:29553)。
// Slimed 消费链(Enemy.slimedT ×2 火系 DoT 放大)此前只吃单次施加的原版语义,
// 旧实现的"逐 tick 持续光环"会把 DoT 叠成 ×2 常驻——本版回归单次+即爆。
//
// 运动语义:GetCollisionParams(:47745)碰撞盒缩 1×1=近乎穿透地形 → 不做 tileCollide;
// extraUpdates=2 原版每 tick 跑 3 个子步(Update while 循环,P.cs Update ~16785-17360),
// 三子步等速直线折叠为单步整速位移(家族登记偏差,GlobProj 同档);原版子步序=
// AI 先于 HandleMovement(:16880 vs :17120),故扫描按"位移前"位置判定,位移收尾。
// Kill 由 scale 衰减触发(scale −0.015/t → ~67t,射程≈8px/t×67)。行进带蓝黏尘
// 尾(dust4 RGB(0,80,255) α175 每 tick 6 粒沿速度梯度);死亡爆 40 粒同色大尘
// (vel=oldVelocity×0.2 散布,:75510-75515)。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { TILE } from '../core/constants';
import { applyBuffTicks } from './projStatus';

export class SlimeGlob extends Entity {
  w = 14; h = 14;
  dead = false;
  readonly projId = 406;
  private scale = 1;
  private ai0 = 0;                 // AI_060 ai[0]:门开拍数由步进率决定
  /** NewProjectile(:10919-10920 case 406):ai[1]=Next(10,21)×0.1 ∈{1.0..2.0 step .1},
   *  出生一次性掷定(此后每拍累加,不再重掷) */
  private readonly aiRate: number;
  private readonly oldVx: number;
  private readonly oldVy: number;

  constructor(x: number, y: number, vx: number, vy: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.aiRate = 1 + Math.floor(Math.random() * 11) * 0.1;
    // Kill(:75510 velocity=oldVelocity*0.2):extraUpdates=2 三子步等速直线,
    // 出膛速 ≡ 上 tick 首子步前速度,直取即等价
    this.oldVx = vx; this.oldVy = vy;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const st = game.world.store;
    // 世界边界(AI 前,Update 循环头 :16794-16813):越界直接消亡
    if (!st.inBounds(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) { this.dead = true; return; }

    // 寿命衰减(AI :29431-29437):scale −0.015/t;≤0 → Kill(velocity*=5 仅为
    // Kill 爆基向量动量感,killBurst 直接用 oldVx×0.2 承接)
    this.scale -= 0.015;
    if (this.scale <= 0) { this.killBurst(game); this.dead = true; return; }

    // === 施加/触杀总门(:29438 `if (this.ai[0] > 3f)`):出生头几拍纯飞行 ===
    if (this.ai0 > 3) {
      let hitNpc = false;
      // NPC 侧(:29464-29481):!active/dontTakeDamage/lifeMax<=1 剔除;重叠→AddBuff
      // (:29479)后即 Kill(:29481,无 break,C# 循环把重叠全员施加;Kill !active
      // 护栏保证只爆一次);
      // 门在 owner==Main.myPlayer 内=本地权威恒真。owner 本地=宿主模拟惯例,盒全尺寸
      for (const ent of game.enemies()) {
        const e = ent as unknown as {
          x: number; y: number; w: number; h: number; dead?: boolean;
          dontTakeDamage?: boolean; lifeMax?: number;
        };
        if (!e || e.dead || e.dontTakeDamage || (e.lifeMax !== undefined && e.lifeMax <= 1)) continue;
        if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
        applyBuffTicks(e as unknown as { [field: string]: number | undefined }, 137, 180);
        hitNpc = true;
      }
      if (hitNpc) { this.killBurst(game); this.dead = true; return; }

      // 其它玩家侧(:29485-29499 flag25 支):排除射手外的其它玩家 ApplyBuffTo(137,180)
      // +Kill(:29494);单人模式恒无目标(GlobProj 同位段先行例)。
      // ★BJ739 B11 定谳（2026-10-31,issue#29）：玩家侧 Slimed(137) 消费面已全量建模
      //  （BuffType.Slimed——drippingSlime 六火族 DoT 翻倍 UpdateLifeRegen :19102-19179
      //  + Main.debuff[137] 归位）;产源仍缺 = 登记债 BJ739-A D-①：
      //  ①victim-settles 架构下 shooter→远端玩家的 buff 传播无通道（msg50 SendPlayer
      //    Buffs 未实现[VanillaClient default 分支静默记账]+remotePlayerProxies 无 buff
      //    同步[Game.simulateRemotePlayers 注「proxy 无 buff 同步」]——对代理 apply
      //    = 零观察面死码,不落）;②远端射手→本地玩家路径需弹幕傀儡 AI 玩家臂或
      //    msg27 附载 buff 面（净协议面,另刀）。 mods/未来产源/测试经
      //  buffs.apply(BuffType.Slimed) 即达消费面

      // 液体触杀(num452==137 支 :29531-29555):覆盖格任一液面线低于 Bottom 即 Kill
      // (:29553);水面偏移 num469=(256−liquid)/32 整除×2px——入液即爆
      {
        const txL = Math.floor(this.x / TILE), txR = Math.floor((this.x + this.w) / TILE);
        const tyT = Math.floor(this.y / TILE), tyBot = Math.floor((this.y + this.h) / TILE);
        for (let i = txL; i <= txR; i++) {
          for (let j = tyT; j <= tyBot; j++) {
            if (!st.inBounds(i, j)) continue;
            const liq = st.liquid[st.idx(i, j)];
            if (liq > 0) {
              const surfY = j * TILE + Math.trunc((256 - liq) / 32) * 2;
              if (this.y + this.h > surfY) {
                this.killBurst(game);
                this.dead = true;
                return;
              }
            }
          }
        }
      }
    }

    // 重力尾(P.cs:29604-29607 aiStyle60 家族级:ai[0]>30 → velocity.Y+=0.1f——
    // 先判后加序;2026-08-26 X-F2 备案转正,此前"无重力登记"系误读)
    if (this.ai0 > 30) this.vy += 0.1;

    // 位移(vanilla 子步序=AI 先于 HandleMovement:扫描判定用位移前盒)。extraUpdates
    // 折叠为单步整速(家族登记偏差见文件头)
    this.x += this.vx; this.y += this.vy;

    // ai[0] 步进(:29604 同位段):驱动下一拍门开与重力门槛
    this.ai0 += this.aiRate;

    // 行进尾迹(type==406 支 :29661-29690):每 tick 6 粒 dust4 α175 色 RGB(0,80,255,100)
    // scale1.2,盒内缩 12×12,50% 二次 +25α,位置沿速度梯度(C# 循环体 continue 到
    // Kill 后照跑,这里尾随失拍一帧不影响观测面)
    const cA = Math.random() < 0.5 ? 0.69 : 0.55;
    for (let k = 0; k < 6; k++) {
      game.spawnParticles?.(
        this.x + this.w / 2 + this.vx * k / 6 + (Math.random() - 0.5) * (this.w - 12),
        this.y + this.h / 2 + this.vy * k / 6 + (Math.random() - 0.5) * (this.h - 12),
        'rgba(0,80,255,' + cA.toFixed(2) + ')', 1, 0.6,
        { life: 18 + (Math.random() * 10 | 0), vx: this.vx * 0.3, vy: this.vy * 0.3, damp: 0.98 });
    }
  }

  /** Kill 段(:75506-75515):velocity=oldVelocity×0.2 基向量 + 40 粒 dust4 α175
   *  scale1.6 散布 vel ±Next(-50,51)×0.015 锚 Center —— 观感=黏球啪嗒摊成一滩 */
  private killBurst(game: GameHooks): void {
    for (let k = 0; k < 40; k++) {
      game.spawnParticles?.(
        this.cx, this.cy,
        'rgba(0,80,255,0.69)', 1, 1.6,
        {
          life: 20 + (Math.random() * 18 | 0),
          vx: this.oldVx * 0.2 + ((Math.random() * 101 | 0) - 50) * 0.015,
          vy: this.oldVy * 0.2 + ((Math.random() * 101 | 0) - 50) * 0.015,
          grav: 0.08, damp: 0.97,
        });
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; atlas?: { vimages: Map<string, ImageBitmap | HTMLImageElement>; ensureVImage?: (f: string) => ImageBitmap | HTMLImageElement | null } | null }): void {
    const ctx = r.ctx;
    if (!ctx || !r.atlas) return;
    // 懒加载通道(lazyload-guards):ensureVImage miss 返 null→本帧早退,下帧自愈;禁直取贴图表
    const img = r.atlas.ensureVImage?.('vanilla/Projectile_406.png') ?? null;
    if (!img || !img.width) return;
    // alpha 恒 255(SetDefaults,无 AI 改写段)=不透明绘制,以 scale 收缩呈现消亡
    const s = Math.max(0.05, this.scale);
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.drawImage(img, (-this.w / 2) * s, (-this.h / 2) * s, this.w * s, this.h * s);
    ctx.restore();
  }
}
