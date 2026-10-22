// 热补丁应用核心(RemasterRuntime):把素材包的混合 sheet 注入运行时贴图注册表。
// 注入矩阵(经代码逐一核实):
//   vanilla/*      → atlas.vimages.set(消费方每帧现查,下一帧生效)
//   vanilla-ui/*   → atlas.uiimages.set
//   Projectile_N   → 双写 vimages + setProjSpriteOverride(Arrow 独立缓存)
//   Buff_N         → buffIconUrl(objectURL;UI.ts 钩子消费——直链 <img src> 不经 atlas)
//   Item_Atlas_*   → vimages.set;应用事件带 hasItemAtlas(main.ts 装配清 UI.iconCache)
// 派生失效:texId WeakMap/cloudTint/_tintCache/GLSpriteLayer 换对象自动新键;
// tile/wall sheet → onSheetReplaced(ChunkCache 消费登记重烘,★禁 invalidateAll);
// BestiaryPanel.bstTintCache/弹幕 frameCache/UI.iconCache 经事件或钩子清。
// 卸载 = 重拉原版 sprites/ 原路径 + 按安装序重放其余 pack(Manager 负责)。
import { SpriteAtlas, upgradeToBitmap } from '../assets/SpriteAtlas';
import { lateImageRetryDefer } from '../assets/lateImageRetry';
import { setProjSpriteOverride } from '../entities/Arrow';
import type { LoadedPack } from './types';

export interface AppliedInfo {
  files: string[];
  /** 是否涉及 Item_Atlas(调用方据此清 UI 物品图标 dataURL 缓存) */
  hasItemAtlas: boolean;
  /** 涉及的 tile/wall sheet(调用方可观测重烘) */
  tileWallSheets: string[];
}

/** 应用结果(hash 校验等不阻断注入——混合 sheet 是整图,校验在导入侧)。 */
export interface ApplyResult { applied: string[]; failed: Array<{ file: string; reason: string }> }

const TILE_WALL_RE = /^vanilla\/(Tiles|Wall)_\d+(_\d+)?\.png$/;
const PROJ_RE = /^vanilla\/Projectile_(\d+)\.png$/;
const BUFF_RE = /^vanilla\/Buff_(\d+)\.png$/;
const ITEM_ATLAS_RE = /^vanilla\/Item_Atlas_\d+\.png$/;

/** 坏包防线:全透明 sheet 检测(2026-08-19 用户实报"武器/弹幕/投掷物全隐形")。
 *  vanilla 镜像 sheet 永远有非透明像素——整图 alpha 全零 = 空导出/坏包,静默注入
 *  会让该表全家贴图(弹幕/物品图标)隐形且 failedVImages 恒 0,无从归因。
 *  每 4 像素抽 1(2048² 图集 4M px→1M 采样;apply 为启动/导入时一次性,可接受)。 */
function canvasHasContent(img: ImageBitmap | HTMLImageElement): boolean {
  if (typeof document === 'undefined') return true;   // node 测试环境:不拦截
  try {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx || c.width === 0 || c.height === 0) return true;   // 无法检测,保守放行
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 16) return true;
    return false;
  } catch { return true; }
}

/** blob → ImageBitmap(失败回退 Image;tryBitmapUpgrade 同款桥,尊重 ?bitmap=0)。 */
export async function decodeSheet(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('png 解码失败'));
      img.src = url;
    });
    if (!SpriteAtlas.USE_BITMAP) return img;
    try {
      // ★预乘位图：ImageBitmap 源忽略 UNPACK_PREMULTIPLY(SpriteAtlas.ts 同注)——
      //  GL 预乘管线需位图自身预乘,否则 vimages 软边双重变暗
      return await createImageBitmap(img, { premultiplyAlpha: 'premultiply' });
    } catch {
      return img;   // GPU 压力窗失败:退 Image(可绘制,仅无自持像素)
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 原版 sheet 重拉(sprites/ 原路径;缺文件返回 null 留现状)。 */
export function loadVanillaSheet(file: string): Promise<ImageBitmap | HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const land = (src: ImageBitmap | HTMLImageElement) => resolve(src);
      // ★upgradeToBitmap 在 USE_BITMAP=false 时两个回调都不调——先判再走
      if (SpriteAtlas.USE_BITMAP) upgradeToBitmap(img, (b) => land(b), () => land(img));
      else land(img);
    };
    // ★BJ705-G26 件4:终态 onerror 型迟到单发重试（首败不 resolve(null),重启命中回填）
    lateImageRetryDefer(img, `sprites/${encodeURI(file)}`, () => resolve(null));
    img.src = `sprites/${encodeURI(file)}`;
  });
}

export class RemasterRuntime {
  /** tile/wall sheet 替换回调(Game 装配 → chunks.onSheetReplaced 精确重烘) */
  onSheetReplaced: ((file: string) => void) | null = null;
  /** 应用完成回调(main.ts 装配:清 UI.iconCache/注册 buff 钩子;工作台:刷新预览) */
  onApplied: ((info: AppliedInfo) => void) | null = null;

  private buffIcons = new Map<number, string>();

  constructor(
    private atlas: SpriteAtlas,
    /** 解码注入点(node 单测无 Image/createImageBitmap,注入 stub) */
    private decode: (blob: Blob) => Promise<ImageBitmap | HTMLImageElement> = decodeSheet,
    /** 原版重拉注入点(同上) */
    private loadVanilla: (file: string) => Promise<ImageBitmap | HTMLImageElement | null> = loadVanillaSheet,
    /** 透明度探测注入点(坏包防线,见 canvasHasContent;node 单测注入 stub) */
    private probeContent: (img: ImageBitmap | HTMLImageElement) => boolean = canvasHasContent,
  ) {}

  /** 启动/导入以来成功注入的文件(DebugReport 可见;restoreVanilla 时移除) */
  appliedFiles: string[] = [];
  /** 坏包防线拒绝的 sheet(全透明;DebugReport 可见) */
  rejectedBlank: string[] = [];

  /** 应用一个 pack(混合 sheet 已是完整图,解码即注入)。 */
  async apply(pack: LoadedPack): Promise<ApplyResult> {
    const applied: string[] = [];
    const failed: Array<{ file: string; reason: string }> = [];
    const tileWall: string[] = [];
    let hasItemAtlas = false;
    for (const [file, blob] of pack.sheets) {
      try {
        const img = await this.decode(blob);
        // ★坏包防线:全透明 sheet 拒绝注入(注入=该表全家贴图静默隐形)。
        //  ★降噪(2026-10-12):材质包对未覆盖内容【故意放空】是合法形态(空=回退
        //  原版,Waifu 包实测 194 张全是),逐文件 console.error=194 条噪音刷屏;
        //  收集进 rejectedBlank(汇总行由调用方打印),真坏包诊断走 DebugReport。
        if (!this.probeContent(img)) {
          this.rejectedBlank.push(file);
          failed.push({ file, reason: '全透明 sheet(空导出/坏包),已拒绝注入' });
          continue;
        }
        if (file.startsWith('vanilla-ui/')) {
          this.atlas.uiimages.set(file, img);
        } else {
          this.atlas.vimages.set(file, img);
        }
        if (TILE_WALL_RE.test(file)) { tileWall.push(file); this.onSheetReplaced?.(file); }
        const proj = PROJ_RE.exec(file);
        if (proj) setProjSpriteOverride(Number(proj[1]), img);
        const buff = BUFF_RE.exec(file);
        if (buff) this.setBuffIcon(Number(buff[1]), blob);
        if (ITEM_ATLAS_RE.test(file)) hasItemAtlas = true;
        applied.push(file);
        this.appliedFiles.push(file);
      } catch (e) {
        failed.push({ file, reason: (e as Error).message });
      }
    }
    const info: AppliedInfo = { files: applied, hasItemAtlas, tileWallSheets: tileWall };
    if (applied.length) {
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('sw:remaster-applied', { detail: info }));
      }
      this.onApplied?.(info);
    }
    return { applied, failed };
  }

  private setBuffIcon(buffId: number, blob: Blob): void {
    const old = this.buffIcons.get(buffId);
    if (old) URL.revokeObjectURL(old);   // 重复应用同 buff:旧 objectURL 即时回收
    this.buffIcons.set(buffId, URL.createObjectURL(blob));
  }

  /** UI.ts buff 栏钩子查询(override 源;null=用原版直链)。 */
  buffIconUrl(vanillaBuffId: number): string | null {
    return this.buffIcons.get(vanillaBuffId) ?? null;
  }

  /** 恢复一批文件为原版(sprites/ 原路径重拉;卸载/重放的基底)。
   *  清 Buff 覆盖 + 弹幕 override 回原版 + tile/wall 重烘。 */
  /** 清除一条注入映射(资源包禁用链,M13):删除后懒消费方经 ensureVImage/ensureUiImage
   *  重拉 sprites/ 原路径(包专有键无盘文件→404 负缓存即正确终态)。restoreVanilla
   *  只覆盖有盘文件的键,包专有键(如 vanilla/Item_N.png)须先清才能回退。 */
  clearSheetEntry(file: string): void {
    if (file.startsWith('vanilla-ui/')) this.atlas.uiimages.delete(file);
    else this.atlas.vimages.delete(file);
  }

  async restoreVanilla(files: Iterable<string>): Promise<void> {
    const list = [...new Set(files)];
    const restored: string[] = [];
    await Promise.all(list.map(async (file) => {
      const src = await this.loadVanilla(file);
      if (!src) return;   // 原版缺文件(本就不存在):留现状
      if (file.startsWith('vanilla-ui/')) this.atlas.uiimages.set(file, src);
      else this.atlas.vimages.set(file, src);
      const proj = PROJ_RE.exec(file);
      if (proj) setProjSpriteOverride(Number(proj[1]), src);
      restored.push(file);
      this.appliedFiles = this.appliedFiles.filter((f) => f !== file);
    }));
    // 清 buff 覆盖——★只清本次恢复文件对应的键(曾全量 clear:本 runtime 与素材
    //   重制包共享,禁用任一资源包会把重制包仍在用的 Buff 图一并干掉——复审 R3 P2)
    for (const f of list) {
      const bm = BUFF_RE.exec(f);
      if (!bm) continue;
      const url = this.buffIcons.get(Number(bm[1]));
      if (url) { URL.revokeObjectURL(url); this.buffIcons.delete(Number(bm[1])); }
    }
    // tile/wall 重烘
    for (const f of restored) if (TILE_WALL_RE.test(f)) this.onSheetReplaced?.(f);
    if (restored.length) {
      const info: AppliedInfo = {
        files: restored,
        hasItemAtlas: restored.some((f) => ITEM_ATLAS_RE.test(f)),
        tileWallSheets: restored.filter((f) => TILE_WALL_RE.test(f)),
      };
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('sw:remaster-applied', { detail: info }));
      }
      this.onApplied?.(info);
    }
  }

  /** 释放全部 buff objectURL(进程退出前;日常 apply/restore 经 buffIcons 自管理)。 */
  dispose(): void {
    for (const u of this.buffIcons.values()) URL.revokeObjectURL(u);
    this.buffIcons.clear();
  }
}
