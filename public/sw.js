/* SandboxWorld 资产持久缓存 Service Worker(2026-08-13;2026-08-19 zip 快路径)。
 * 职责:①拦截 /sprites|fonts|l10n|sounds|audios 的 GET 走 Cache API 磁盘缓存
 * (cache-first,未命中网络回填;l10n 例外=网络优先+离线回退,见 fetch 段注)——
 * 对 new Image()/fetch/@font-face 全透明;
 * ②接收页面 AssetCache 驱动器的 {init/warm/warm-cancel} 消息做后台下载
 *   (warm=逐文件,legacy 回退)。2026-08-19 起 zip 快路径改【页面直给】:
 *   AssetCache 在页面侧 fetch 分片 zip → fflate 解压 → 直接 cache.put(页面
 *   与 SW 共用同一 CacheStorage,key 同构)——SW 零参与,无消息协议/看门狗。
 * 版本:缓存名 sw-assets-v{version},version 由页面运行时计算(vanilla.json+
 * vanilla-ui.json 内容 hash [+ zip manifest contentHash] + CACHE_BUSTER)——
 * activate/init 清除非当前版本。
 * 不缓存:HTML/JS/API(vite hash 自足;碰它会有更新卡壳风险)。 */
'use strict';

const ASSET_RE = /\/(sprites|fonts|l10n|sounds|audios)\//;

// ★MIME 门(2026-08-26):CF Pages 对不存在文件按 SPA 规则回 **200+text/html**
// （线上 HAR 实证:sprites/vanilla/*.png 全部收到 index.html 兜底 ~1.6KB）。
// 只判 res.ok 会把兜底 HTML 当资产正文塞进 Cache API ——永久坏图毒丸。故所有
// 资产类回填必须按扩展名校验 content-type 族;不符一律视作 miss、拒入缓存。
const MIME_BY_EXT = [
  [/\.opus$/, /^audio\/ogg/],
  [/\.png$|\.jpe?g$|\.webp$|\.gif$/, /^image\//],
  [/\.woff2?$|\.ttf$/, /^font\//],
  [/\.json$/, /^(application\/json|text\/json)\b/],
  [/\.wav$|\.mp3$|\.ogg$/, /^audio\//],
  [/\.m?js$/, /^(application|text)\/(javascript|ecmascript)\b/],
  [/\.css$/, /^text\/css\b/],
];
/** 扩展名→规则直查（scrub 全缓存扫描×数千条,warm 首轮数千次 fetch——线性 6 正则
 *  在 CPU profile 里成 SW 线程头号热点,2026-08-28 trace 实证）。未登记=null 不拦 */
const MIME_BY_EXT_MAP = new Map();
for (const [re, want] of MIME_BY_EXT) {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'opus', 'ogg', 'woff2', 'woff', 'ttf', 'json',
    'wav', 'mp3', 'js', 'mjs', 'css']) {
    if (re.test('.' + ext)) MIME_BY_EXT_MAP.set(ext, want);
  }
}
function mimeOk(path, res) {
  // 与原线性正则严格同义：小写敏感、路径终点锚定（fetch/warm 传的都是无 query 路径）
  const m = /\.([a-z0-9]+)$/.exec(path);
  const want = m ? MIME_BY_EXT_MAP.get(m[1]) : undefined;
  if (!want) return true;   // 未登记扩展名不拦（维持旧行为）
  const ct = res.headers.get('content-type') || '';
  return want.test(ct);
}
// 规范 CT 表(zipExtract 落库用;与 src/net/assetMime.ts WARM_MIME 同族双侧同步,
// 与 normCacheKey 同款约定):★2026-09-16 修——旧表达式 mimeOk(path,new Response())
// 恒 false(裸 Response 无 CT 头),按需解压产物全落 application/octet-stream,
// 曾是清扫误杀同族的第三个潜伏病灶(音频解码不读 CT,仅卫生问题)。
const CT_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  opus: 'audio/ogg', ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', json: 'application/json', txt: 'text/plain',
};
function ctOf(path) {
  const m = /\.([a-z0-9]+)$/.exec(path);
  return (m && CT_BY_EXT[m[1]]) || 'application/octet-stream';
}
// ★warm 窗口 404 静默(2026-09-04):冷启动分片 warm 进行中,懒加载 miss 会穿透
// 到网络的真 404(prune 形态散件不存在,HAR 实报 Sun/Moon 5 连红)。功能上无碍
// (204 与 404 同样触发消费方 onerror/退避重试链,自愈语义零变化),但 DevTools
// Network/Console 满屏红、HAR 审计噪音大。改:页面 AssetCache 经 {type:'zip-warm'}
// 消息同步 warming 旗(SW 被杀重启后从 __sw_meta__ 恢复),窗口内对【图片类 GET
// miss 的 404】应答 204 No Content(无体→任何浏览器都必然 onerror)。边界:
//  · 仅 GET——HEAD 存在性探测(ui 失败负缓存长 TTL 分档)直通不受扰
//  · warm 终态后 miss 仍真 404 直通=诊断面保留;真首访(无版本缓存)无从判定,不拦
//  · 音频(2026-09-05 生产实报"hit.opus 404":版本换代重下窗口放方块触发 SFX):
//    fetch 型消费方 r.ok 对 204=true,但空体 decodeAudioData 必 reject——
//    Sfx.ensureBufferAsync(continue 下格式→15s 负缓存)与 Audio.buffer(markFailed)
//    均已在 try-catch 内,与 404 同归宿,已逐一核实(2026-09-05)
const MEDIA_MISS_RE = /\.png$|\.jpe?g$|\.webp$|\.gif$|\.opus$|\.ogg$|\.mp3$|\.wav$/;
let zipWarmActive = null;   // null=未知(SW 重启后),true/false=消息/缓存恢复
async function isZipWarmActive() {
  if (zipWarmActive !== null) return zipWarmActive;
  try {
    const cache = await getCache();
    const m = await cache.match('__sw_meta__');
    const j = m ? await m.json().catch(() => null) : null;
    zipWarmActive = !!(j && j.zipWarm);
  } catch { zipWarmActive = false; }
  return zipWarmActive;
}
function setZipWarmFlag(on) {
  zipWarmActive = !!on;
  return (async () => {
    try {
      const cache = await getCache();
      const m = await cache.match('__sw_meta__');
      const j = (m ? await m.json().catch(() => null) : null) || {};
      j.zipWarm = !!on;
      await cache.put('__sw_meta__', new Response(JSON.stringify(j)));
    } catch { /* 持久失败仅影响 SW 重启后的窗口判定,本轮内存旗已生效 */ }
  })();
}
/** warm 窗口图片 miss 静默应答(命中返回 204,否则 null=走原路径) */
async function silentWarmMiss(req, path) {
  if (req.method !== 'GET' || !MEDIA_MISS_RE.test(path)) return null;
  if (!(await isZipWarmActive())) return null;
  // x-sw-warm-miss 头:HAR 审计可直接识别"这是 warm 窗口静默,非真缺"
  return new Response(null, { status: 204, headers: { 'x-sw-warm-miss': '1' } });
}

const CACHE_PREFIX = 'sw-assets-v';
// ★三百十二:mod 资源独立缓存(页侧暖存;与本体版本缓存解耦——本体换代 gc
//  不触及、scrub/warm keys() 不并入;1.2 万 mod 条目曾暖进版本缓存=keys()
//  'Operation too large' AbortError 事故根因)
const MODS_CACHE = 'sw-mods-v1';
const MODS_RE = /^\/sprites\/mods\//;
let currentVersion = '';
let cacheReady = null;
let warmAbort = false;

const cacheName = () => CACHE_PREFIX + currentVersion;
function getCache() {
  if (!cacheReady) cacheReady = caches.open(cacheName());
  return cacheReady;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    await self.clients.claim();
    // ★版本未知(currentVersion='')时禁止 GC(2026-08-25 OSS 首访 404 风暴根因):
    //   首访 claim 落地可能晚于页面建缓存/开暖——此处按 keep='' 清扫会把暖缓存的
    //   sw-assets-v* 当孤儿整仓删掉(put 全部写进被删句柄=静默假完成)。GC 移交
    //   init 消息处的 gcOldCaches()(那时 version 已由消息带入)
    if (!currentVersion) return;
    const keep = cacheName();
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== keep) await caches.delete(name);
    }
  })());
});

const SHELL_RE = /^\/assets\/.+\.(js|css|woff2?)$/;
const isDocPath = (req, path) => req.destination === 'document' || path === '/' || path.endsWith('.html');

/** ★版本恢复(2026-09-04 线上实锤"进世界后天空/雷管族逐会话 404"):SW 进程被
 *  浏览器 ~3min 击杀重启后,内存 currentVersion 丢失('')——fetch handler 的
 *  `!currentVersion → return 放行` 让所有资产请求裸奔网络(prune 散件 404),
 *  且 zip 模式页面无周期 version 消息 ⇒ 永不恢复。兜底:caches.keys() 的唯一
 *  sw-assets-v* 名即当前版本(单版本不变式);推导一次,此后走同步快路径。 */
async function recoverVersion() {
  if (currentVersion) return currentVersion;
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX));
    if (names.length === 1) {
      currentVersion = names[0].slice(CACHE_PREFIX.length);
      cacheReady = null;
    }
  } catch { /* */ }
  return currentVersion;
}

/** 资产服务主逻辑(fetch handler 主体;返回 null = 放行网络) */
// ---- zip 分片按需提取(2026-09-09):cache miss 时从分片解压单文件返回 ----
// 解决「SW 缓存条目被驱逐/丢失 → 散件又不存在 → 贴图/音效 404」的整类问题。
// SW 内存缓存 manifest + 最近使用的分片 ArrayBuffer,避免重复网络请求。
let _zipManifest = null, _zipBuf = null, _zipName = '';
async function _getZipManifest() {
  if (_zipManifest) return _zipManifest;
  const cache = await getCache();
  let r = await cache.match('assets-zip/manifest.json').catch(() => null);
  if (!r) { r = await fetchAsset('assets-zip/manifest.json'); if (r.ok) try { cache.put('assets-zip/manifest.json', r.clone()); } catch {} }
  if (!r || !r.ok) return null;
  _zipManifest = await r.json();
  return _zipManifest;
}
async function zipExtract(path) {
  const m = await _getZipManifest();
  if (!m) return null;
  for (const part of m.parts) {
    const entries = part.entries || [];
    if (!entries.includes(path)) continue;
    const zipUrl = 'assets-zip/' + part.file;
    if (_zipName !== part.file || !_zipBuf) {
      const r = await fetchAsset(zipUrl);
      if (!r.ok) return null;
      _zipBuf = await r.arrayBuffer(); _zipName = part.file;
    }
    const dv = new DataView(_zipBuf);
    let eocd = -1;
    for (let i = _zipBuf.byteLength - 22; i >= Math.max(0, _zipBuf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    let off = dv.getUint32(eocd + 16, true);
    const cnt = dv.getUint16(eocd + 10, true);
    for (let i = 0; i < cnt; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const fnLen = dv.getUint16(off + 28, true);
      const exLen = dv.getUint16(off + 30, true);
      const cmLen = dv.getUint16(off + 32, true);
      const lhOff = dv.getUint32(off + 42, true);
      const method = dv.getUint16(off + 10, true);
      const cSize = dv.getUint32(off + 20, true);
      const fn = new TextDecoder().decode(new Uint8Array(_zipBuf, off + 46, fnLen));
      if (fn === path) {
        const lhFnLen = dv.getUint16(lhOff + 26, true);
        const lhExLen = dv.getUint16(lhOff + 28, true);
        const dataStart = lhOff + 30 + lhFnLen + lhExLen;
        const data = new Uint8Array(_zipBuf, dataStart, cSize);
        // ★规范 CT(2026-09-16):stored/deflate 两路统一按扩展名给 CT(见 CT_BY_EXT 注)
        if (method === 0) return new Response(data, { headers: { 'Content-Type': ctOf(path) } });
        const ds = new DecompressionStream('deflate-raw');
        const buf = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
        return new Response(buf, { headers: { 'Content-Type': ctOf(path) } });
      }
      off += 46 + fnLen + exLen + cmLen;
    }
    return null;   // 该分片里没找到(分片遍历已含所有 entries)
  }
  return null;   // 不在任何分片
}

async function serveAsset(req, path) {
  const cache = await getCache();
  const hit = await cache.match(req, { ignoreVary: true }).catch(() => null);
  if (hit) return hit;
  try {
    const res = await fetchAsset(req);
    // SPA 兜底(200+text/html)或异常:拒入缓存,并以真 404 应答——上层
    // onerror 立即稳定,不再因 HTML 解码失败进入帧循环重试(HAR:单图 5 连击)
    if (!res || !res.ok || res.type !== 'basic' || !mimeOk(path, res)) {
      // ★cache miss → 网络也 404 → 从 zip 分片按需解压(2026-09-09)
      try {
        const extracted = await zipExtract(path);
        if (extracted) {
          const clone = extracted.clone();
          cache.put(req, clone).catch(() => {});
          return extracted;
        }
      } catch { /* zip 提取失败继续走 404 */ }
      if (res && !res.ok) {
        return (await silentWarmMiss(req, path)) || res;
      }
      return (await silentWarmMiss(req, path)) || new Response('', { status: 404 });
    }
    // ★BJ702（2026-10-21 线上实报）:fire-and-forget put 必 .catch 吸收——弱网
    //   body 流中断时 put 抛 NetworkError=Uncaught(in promise) 控制台噪声(实报
    //   三连发),与 shell 支 2026-09-24 修同款;响应本体照常返回,put 失败仅丢
    //   一次缓存机会(下次 miss 重试)。
    cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    // ★fetch 瞬态失败(离线/闪断):二次 match 回退——期间可能有并发 put 落地
    const hit2 = await cache.match(req, { ignoreVary: true }).catch(() => null);
    return hit2 || Response.error();
  }
}

// ★BJ703-E 件2a（2026-10-21 BJ702 登记债 2 + 用户正面诉求「瞬断不会重试吗」）:
//   shell 支网络路径黑洞窗收口。BJ702 根因②:worker 脚本/新 hash chunk 经 SW
//   cache-first miss（新版本部署=全量新名冷缓存）→ respondWith 内 fetch 挂死
//   （无超时无重试，无 onerror）→ 调用方只能干等自身超时（worker=3s 握手窗）。
//   本包装只加在 shell 支的 fetch 调用上,缓存策略结构零变化:
//   · 8s AbortController 超时——仅约束到响应头（finally 即清 timer,不碰 body 流）;
//   · 单次重试——仅网络层失败/超时才走 catch（throw 才重试;404 等明确应答不重试）;
//   · 两连败落回原 504 offline 路径。瞬断窗内重试成功 → 响应照常回填缓存:即便
//     调用方已死（如被握手超时 terminate 的 worker）,脚本落缓存 ⇒ 下次 spawn
//     cache-first 秒开,BJ702「刷新即好」的恢复面不再依赖刷新。
function fetchShell(req) {
  const attempt = () => {
    if (typeof AbortController === 'undefined') return fetch(req);   // 老内核退化=原行为
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    return fetch(req, { signal: ctl.signal }).finally(() => clearTimeout(t));
  };
  return attempt().catch(attempt);
}

// ★BJ704-G8 F2（2026-10-21 BJ704-R6 P2 精选债2,703E 件2a 边界收口）:SW 内裸 fetch
//   全量分级收口。BJ703-E 只裹了 shell 支常态路,R6 点名残余 7 处+本刀普查补齐同族
//   3 处（真首访直通:323/主资产 miss 路:403/warm 单文件:477——自带重试×3 但无超时,
//   黑洞=单 lane 永挂+warm running 恒真堵重入）。域分级（导航 vs 资产）:
//   · 导航类（doc 两处）=fetchShell 同款（8s 超时+单次重试）——整页加载挂死风险
//     最高,重试代价一次性;
//   · 资产类（其余全部）=本包装:8s 超时兜底【单发不重试】——消费方（Image
//     onerror 退避链/warm 轮询重试）自有恢复面,SW 级重试会在黑洞窗把并发 N 图
//     放大成 2N 发请求风暴;超时 throw 落各分支既有 catch（离线回退/404 兜底）,
//     缓存策略结构零变化。超时锚 8000 与 fetchShell 双侧同步（改必同改）。
function fetchAsset(req) {
  if (typeof AbortController === 'undefined') return fetch(req);   // 老内核退化=原行为
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  return fetch(req, { signal: ctl.signal }).finally(() => clearTimeout(t));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // ★scheme 门(2026-08-13 用户实报):浏览器扩展注入的 chrome-extension:// 等
  // 请求也会进页面 SW——Cache API 只收 http(s),put 即抛
  // "Request scheme 'chrome-extension' is unsupported"。非 http(s) 一律放行。
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (req.method !== 'GET') return;
  const path = url.pathname;
  const assetish = ASSET_RE.test(path) || SHELL_RE.test(path) || path.startsWith('/l10n/');
  // ★SW 重启后 currentVersion=''——此窗口的资产请求放行=裸奔 404(prune)。
  //  兜底:caches.keys() 的唯一 sw-assets-v* 名 = 当前版本(单版本不变式),
  //  async 恢复一次后所有请求走 serveAsset 快路径。
  // ★2026-09-29 修「构建/发版后首访=上一版代码,刷新一次才新」:文档原被折进
  //  assetish(isDocPath)→SW 重启窗口走 serveAsset=资产 cache-first——文档被
  //  端出缓存旧 index.html→旧 chunk→整页旧代码;页面 init 带回版本号后刷新
  //  才落回 ② 网络优先。修=文档永不入本早退支,恒走 ② 网络优先(离线才回缓存)。
  // ★三百十二:mod 资源路(mods 独立缓存 cache-first;miss 直通——资源只经
  //  页侧暖存到库,网络本无此文件,回填只会缓存 404 毒丸)
  if (MODS_RE.test(path)) {
    e.respondWith((async () => {
      try {
        const modCache = await caches.open(MODS_CACHE);
        const hit = await modCache.match(req, { ignoreVary: true }).catch(() => null);
        if (hit) return hit;
      } catch { /* 存储不可用:直通 */ }
      return fetchAsset(req);
    })());
    return;
  }
  if (isDocPath(req, path)) {
    e.respondWith((async () => {
      const ver = await recoverVersion();
      const cache = ver ? await caches.open(CACHE_PREFIX + ver).catch(() => null) : null;
      try {
        const res = await fetchShell(req);   // ★BJ704-G8 F2:导航类=超时+单次重试(挂死整页→16s 有界+离线缓存回退)
        if (res && res.ok && cache) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) {
        const hit = cache ? await cache.match(req, { ignoreVary: true }).catch(() => null) : null;
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }
  if (assetish && !currentVersion) {
    e.respondWith((async () => {
      const ver = await recoverVersion();
      if (!ver) return fetchAsset(req);            // 无任何版本缓存(真首访)→ 网络(超时兜底)
      const res = await serveAsset(req, path);
      return res;                                  // ★BJ704-G17:?? 双保险死支已删(serveAsset :218-252 全返回路径恒 Response,直读核验)
    })());
    return;
  }

  // ② 应用壳(拆双策略,2026-08-25):
  //    a) 内容寻址资产(/assets/ 下 js/css/woff2 均为 vite 哈希名,不可变):
  //       cache-first——老用户重复访问零重下(实测省主 chunk 2.2MB gz/次)。
  //       新版本经 index.html(文档仍网络优先)引用新哈希名自然更新,不存在
  //       "更新卡壳":2026-08-13 的顾虑基于当时未依赖纯哈希寻址,现 /assets/
  //       下全部为内容寻址名,旧条目随版本换代(gcOldCaches)自然清理。
  //    b) 文档(index.html 等):网络优先+离线回退——版本发现入口,语义不变
  //       (唯一承载=上方 isDocPath 支;G17 前此处另有同式 isDoc 支,doc 提前后不可达已删)。
  const isShellJs = /^\/assets\/.+\.(js|css|woff2?)$/.test(path);
  // ★BJ704-G17 删码面:旧 isDoc 支(≡ :321 isDocPath 同式判定)在 2026-09-29 doc
  //  无条件提前后结构性不可达,整支移除——文档处理唯一权威=上方 isDocPath 支。
  if (isShellJs) {
    e.respondWith((async () => {
      // ★2026-09-24 修「部分机器新版本 504 offline 强刷无用」:①getCache 失败
      //   (存储禁用/隐私模式)不得整链炸——降级纯网络直通;②cache.put 拒绝
      //   (QuotaExceeded 等)不得吞掉已 fetch 到的响应(旧代码 await put 在返回
      //   路径 try 内,put 炸→好响应被 catch 吞→504,缓存命中面新资产全灭)。
      //   put 改 fire-and-forget(.catch 吸收),与其他回填位点(:227/:316/:341)同款。
      let cache = null;
      try { cache = await getCache(); } catch { /* 存储不可用:纯网络直通 */ }
      if (cache) {
        const hit = await cache.match(req, { ignoreVary: true }).catch(() => null);
        if (hit) return hit;
      }
      try {
        const res = await fetchShell(req);   // ★BJ703-E 件2a:超时+单次重试(见函数注)
        if (res && res.ok && mimeOk(path, res) && cache) cache.put(req, res.clone()).catch(() => {});
        if (res) return res;   // 非 ok(404 等)直通不缓存
      } catch (err) { /* 离线且无缓存 → 504 */ }
      return new Response('', { status: 504, statusText: 'offline' });
    })());
    return;
  }
  // ① 资产前缀:cache-first,未命中网络回填。
  //    ★例外:l10n 语言包是可变配置(build-l10n 会再生成)——网络优先+离线回退。
  //    cache-first 曾把 2026-08-14 多语言批的新键卡死在旧包(缓存版本号只由
  //    vanilla.json/ui 哈希决定,l10n 重建不换版本 → SW 永远命中旧包,页面显示裸键)
  if (path.startsWith('/l10n/')) {
    e.respondWith((async () => {
      const cache = await getCache();
      try {
        const res = await fetchAsset(req);   // ★BJ704-G8 F2:资产类=超时兜底(瞬断/挂死→离线缓存回退)
        // ★BJ702:put NetworkError 必 .catch(同 shell 支 2026-09-24;l10n 回填非关键路径)
        if (res && res.ok && res.type === 'basic' && mimeOk(path, res)) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreVary: true }).catch(() => null);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }
  if (!ASSET_RE.test(path)) return;
  e.respondWith((async () => {
    const cache = await getCache();
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    try {
      const res = await fetchAsset(req);   // ★BJ704-G8 F2:资产类=超时兜底(挂死→8s→二次 match 回退/Response.error)
      // SPA 兜底(200+text/html)或异常:拒入缓存,并以真 404 应答——上层
      // onerror 立即稳定,不再因 HTML 解码失败进入帧循环重试(HAR:单图 5 连击)
      if (!res || !res.ok || res.type !== 'basic' || !mimeOk(path, res)) {
        if (res && !res.ok) {
          return (await silentWarmMiss(req, path)) || res;   // warm 窗口图片 miss → 204 静默
        }
        return (await silentWarmMiss(req, path)) || new Response('', { status: 404 });
      }
      // ★BJ702:put NetworkError 必 .catch(同 shell 支 2026-09-24;miss 重试语义不变)
      cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      // ★fetch 瞬态失败(离线/闪断):二次 match 回退——期间可能有并发 put 落地
      const hit2 = await cache.match(req, { ignoreVary: true }).catch(() => null);
      return hit2 || Response.error();
    }
  })());
});

async function warm(tag, urls, base) {
  if (lastWarm.running) return;  // 重入守卫:看门狗补发时旧 warm 未死不叠跑
  warmAbort = false;
  const done0 = base || 0;
  lastWarm = { done: done0, total: done0 + urls.length, failed: 0, running: true };
  const cache = await getCache();
  // pathname 归一(去前导 /+★decode):cache 条目 URL 保留编码(空格=%20),
  // 清单是原始空格名——曾致带空格条目每轮恒判缺失、每次启动重下 58MB
  // (2026-08-27;与 src/net/AssetCache.ts normCacheKey 双侧同步)
  const have = new Set((await cache.keys()).map((r) => {
    const p = new URL(r.url).pathname.replace(/^\//, '');
    try { return decodeURIComponent(p); } catch { return p; }
  }));
  const missing = urls.filter((u) => !have.has(u.replace(/^\//, '')));
  const total = done0 + urls.length;
  let done = total - missing.length;
  let failed = 0;
  // ---- 自适应并发(2026-08-18 用户"按下载/处理速度自适应并行";曾固定 3 路) ----
  // AIMD:按实测单文件完成延迟 EMA 在 [MIN_CONC, MAX_CONC] 间调节——
  //   快(本地/内网,ema<30ms)每 32 文件 +1 路;慢(弱网/磁盘拥塞,ema>150ms)
  //   路数减半。MAX=8:HTTP/1.1 浏览器同源也就 6 连接,更高无意义(HTTP/2 部署
  //   下 8 路流也够吃带宽)。重试等待不计入延迟(那是网络瞬态,不是容量信号)。
  const MIN_CONC = 2, MAX_CONC = 8, START_CONC = 3;
  const BREATH_EVERY = 400;
  const BREATH_MS = 250;         // 喘息保持:Cache API 磁盘落盘缓冲排空窗口
  let conc = START_CONC;
  let ema = 60;                  // 单文件毫秒 EMA(初值中性)
  let sinceTune = 0;
  let cursor = 0;
  let sinceBreath = 0;
  let active = 0;
  const breath = () => new Promise((r) => setTimeout(r, BREATH_MS));
  // 固定开 MAX 路 worker,用动态 conc 信号量闸住——升/降路不重建 worker 池
  const workers = Array.from({ length: Math.min(MAX_CONC, missing.length) }, async () => {
    for (;;) {
      if (warmAbort) return;
      // 信号量:活跃数超过当前 conc 档 → 让出(微任务轮询,无计时器开销)
      while (active >= conc) {
        if (warmAbort) return;
        await new Promise((r) => setTimeout(r, 15));
      }
      active++;
      try {
        if (sinceBreath >= BREATH_EVERY) { sinceBreath = 0; await breath(); }
        const i = cursor++;
        if (i >= missing.length) return;
        const u = missing[i];
        const t0 = Date.now();
        // 单文件即时重试 ×3(间隔 300/600ms):弱网瞬断就地恢复,不必等全量
        // 跑完后的整轮补拉(2026-08-13 可靠性 review)
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          if (warmAbort) return;
          try {
            const res = await fetchAsset(u);   // ★BJ704-G8 F2:超时兜底单发——挂死 8s→throw 落本循环既有重试/退避,不再单 lane 永挂堵死 warm 重入
            if (res && res.ok && mimeOk(u, res)) { await cache.put(u, res); ok = true; }
            else if (attempt === 2) failed++;
          } catch (err) {
            if (attempt === 2) failed++;
          }
          if (!ok && attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
        // 延迟采样与调参(仅成功文件计入;失败重试的等待会污染信号)
        if (ok) {
          ema = ema * 0.9 + (Date.now() - t0) * 0.1;
          if (++sinceTune >= 32) {
            sinceTune = 0;
            if (ema < 30 && conc < MAX_CONC) conc++;
            else if (ema > 150 && conc > MIN_CONC) conc = Math.max(MIN_CONC, Math.floor(conc / 2));
          }
        }
        done++;
        sinceBreath++;
        lastWarm.done = done; lastWarm.failed = failed;
        if ((done & 7) === 0 || done === total) postProgress(tag, done, total, failed);
      } finally {
        active--;
      }
    }
  });
  await Promise.all(workers);
  lastWarm = { done, total, failed, running: false };
  postProgress(tag, done, total, failed);
  postMessageToPages({ type: 'warm-done', tag, done, total, failed, aborted: warmAbort, conc, emaMs: Math.round(ema) });
}

/** 分片 zip warm(2026-08-19):片下载(重试×3 同 legacy 参) → have-set 过滤 →
 * 逐文件 unzipSync(filter 单文件)+cache.put。★同步计算切成"单文件解压+单次
 * put"粒度(每步 <100ms),事件循环每文件回泵——watchdog/cancel/进度不饿死,
 * 无整片解压内存尖刺;每 200 文件 60ms 喘息(Cache API 落盘排空)。
 * 中途被杀:watchdog 重发本片,have-set 跳过已落条目=片内断点续传。 */
/** 旧版本缓存 GC(2026-08-19):版本随消息变但 sw.js 字节没变时 activate 不触发,
 * 旧缓存成孤儿——init 时顺带清(legacy 模式同款问题一并修) */
function gcOldCaches() {
  return (async () => {
    const keep = cacheName();
    // ★无版本会话(keep=CACHE_PREFIX 裸名)禁止清缓存——version 缺失意味着
    //   本会话没拿到清单,删"非当前"=删掉成功会话的全部暖存(2026-08-27)
    if (keep === CACHE_PREFIX) return;
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== keep) await caches.delete(name);
    }
  })().catch(() => {});
}

/** 毒丸卫生清扫(2026-08-26):旧版无 MIME 门时期,Pages SPA 兜底的
 * "200+text/html 伪图"曾被照常 cache.put;缓存名由页面内容 hash 推导、内容
 * 不变则同名——毒条目会跨 SW 换代存活并被 cache-first 直接命中(连 fetch 都
 * 不发,MIME 门无从拦截)。init 时逐条目核对已登记扩展名的 content-type,
 * 不符即删:删后下次请求走 miss→fetch→MIME 门拒置真 404,零好数据重下。 */
let scrubRunning = null;
async function scrubPoisonedEntries() {
  if (scrubRunning) return scrubRunning;
  scrubRunning = _scrubInner().finally(() => { scrubRunning = null; });
  return scrubRunning;
}
async function _scrubInner(force = false) {
  try {
    const cache = await getCache();
    // ★每版本一次(2026-08-28 trace 实证):全缓存逐条 match+MIME 是 SW 线程
    // 头号 CPU 热点(数千条×IO),而毒条目只能来自"坏部署写同名缓存"——同版本
    // 二次 init 纯重复扫。标记条目存版本内,跨 SW 重启仍跳过;换版本自然重扫。
    // force(gc 显式清理)无视标记强制重扫=同版本毒条目再现的逃生门。
    if (!force) try {
      const marker = await cache.match('__sw_meta__');
      if (marker) {
        const j = await marker.json().catch(() => null);
        if (j && j.scrubbedVersion === currentVersion) return;
      }
    } catch { /* 标记读失败按未清扫处理 */ }
    const bad = [];
    for (const req of await cache.keys()) {
      const p = new URL(req.url).pathname;
      if (!MIME_BY_EXT.some(([re]) => re.test(p))) continue;
      const res = await cache.match(req, { ignoreVary: true });
      if (!res) continue;
      // ★判据窄化(2026-09-16 根修):毒丸唯一来源=CF Pages SPA 兜底的
      //  「200+text/html 伪资产」,只删 text/html。旧判据 !mimeOk(p,res) 会把
      //  自家 zip warm 落库的合法 CT 一并判死——worker MIME 表漏 opus 时 863 条
      //  音效以 application/octet-stream 落缓存,每会话 gc 强扫整批删除 → 次会话
      //  have-set 对账判缺重拉 p4/p5(恰 40MB,HAR 三连会话实锤)→ CT 依旧错 →
      //  循环。非 text/html 的 CT 偏差不影响消费(audio 解码不读 CT),非毒。
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (ct === 'text/html') bad.push(req);
    }
    for (const r of bad) await cache.delete(r);
    if (bad.length) console.log(`[sw] 清除 SPA 兜底伪图 ${bad.length} 条`);
    // ★合并写入(2026-09-04):__sw_meta__ 还存 zipWarm 旗(warm 窗口静默),
    //  整对象覆盖会把它抹掉——SW 重启后窗口判定失真
    const prevMeta = await cache.match('__sw_meta__').catch(() => null);
    const prevJ = (prevMeta ? await prevMeta.json().catch(() => null) : null) || {};
    await cache.put('__sw_meta__', new Response(JSON.stringify({ ...prevJ, scrubbedVersion: currentVersion })));
  } catch { /* 清扫失败不阻断 init */ }
}

/** 缓存现状查询(页面初始完成判定/清理检测;附最近一轮 warm 统计) */
let lastWarm = { done: 0, total: 0, failed: 0, running: false };
async function reportStatus() {
  const cache = await getCache();
  // 排除 __sw_meta__ 标记——legacy 逐文件模式用全缓存条目数校准进度
  // (AssetCache state.done=min(cached,total)),计数语义必须与标记引入前逐位一致
  const cached = (await cache.keys()).filter((r) => !r.url.endsWith('/__sw_meta__')).length;
  postMessageToPages({ type: 'status', version: currentVersion, cached, warm: lastWarm });
}

function postProgress(tag, done, total, failed) {
  postMessageToPages({ type: 'warm-progress', tag, done, total, failed });
}
function postMessageToPages(msg) {
  self.clients.matchAll({ includeUncontrolled: true }).then((cs) => {
    for (const c of cs) c.postMessage(msg);
  }).catch(() => {});
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  // ★version 无状态化(2026-08-13 实测):SW 会被浏览器在 ~3min 处击杀,重启后
  // 内存里的 currentVersion 丢失——warm/status 消息必须自带 version 才能选对缓存
  const msgVersion = typeof d.version === 'string' && d.version ? d.version : null;
  if (msgVersion && msgVersion !== currentVersion) {
    currentVersion = msgVersion;
    cacheReady = null;
  }
  if (d.type === 'init') {
    getCache();
    // ★gc 权限模型(2026-08-27):init 不再顺带 gcOldCaches——manifest 失败的
    // 会话(版本回退 base 形态)一度借 init 把成功会话的暖存整批误清。现仅
    // 页面在【清单到手】后显式发 {type:'gc'} 才允许清理(见 AssetCache)。
    // scrub 卫生清扫同理收编到 gc 通道(它只该跑在可信版本确立后)。
    e.waitUntil(scrubPoisonedEntries());
  } else if (d.type === 'gc') {
    if (typeof d.version === 'string' && d.version) {
      if (d.version !== currentVersion) { currentVersion = d.version; cacheReady = null; }
      // gc = 页面显式清理(清理按钮/检测)。★scrub 收编回每版本一次标记
      //  (2026-09-16 根修):曾 _scrubInner(true) 每会话强扫全缓存,配合 worker
      //  MIME 表漏 opus 酿成 863 条音效每会话整批误删+40MB 重下循环。毒源已被
      //  入口 MIME 门(serveAsset/warm 回填)+窄化判据(只删 text/html)双重
      //  堵死,强制逃生门失去存在意义;附带省掉每会话 1.3 万条 match 的扫。
      e.waitUntil((async () => {
        try { await gcOldCaches(); await scrubPoisonedEntries(); }
        catch (err) { self.__swLastGcErr = String(err && err.message || err); }
      })());
    }
  } else if (d.type === 'warm') {
    if (!currentVersion) return; // 无版本(未 init 且消息未带)拒绝,防写错缓存
    // ★必须 waitUntil:否则 message 事件结束后 Chrome 随时终止 SW
    e.waitUntil(warm(d.tag || '', d.urls || [], d.base || 0).catch(() => {}));
  } else if (d.type === 'warm-cancel') {
    warmAbort = true;
  } else if (d.type === 'zip-warm') {
    // warm 窗口旗同步(页面 AssetCache emit 翻转检测;持久进 __sw_meta__,
    // SW 被杀重启后 isZipWarmActive 首调从缓存恢复)
    e.waitUntil(setZipWarmFlag(!!d.on));
  } else if (d.type === 'ping') {
    postMessageToPages({ type: 'pong', version: currentVersion, lastGcErr: self.__swLastGcErr ?? null });
  } else if (d.type === 'status') {
    if (!currentVersion) return;
    reportStatus();
  }
});
