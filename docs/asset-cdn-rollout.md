# 资产分片 CDN 化:方案A 落地与生产迁移计划(2026-10-13)

> 状态(2026-10-13 更新):**preview 与生产均已切源**(v0.1.70-beta 起,双域 cdn.json 200,
> 生产域 sandboxworld.online 端到端探针 PASS:12900/12900 failed=0,npmmirror 通道 444 命中)。
> 回退机制已加固:黑洞超时(TTFB 20s/空闲 30s)+ 嫌疑降级(同 run + 跨重启),
> **双 CDN 全不可用时自动回同源**——见第三节候选序与「回退保证」。

## ★发布 SOP 对照(发布会话必读;老流程 → 新流程)

```
老流程                                新流程
──────                                ──────
npm run build:release                 npm run build:release
                                      node scripts/publish-assets-cdn.mjs \      ← ★新增步骤(所有部署的前置)
                                        --dist dist-release --timeout 600
wrangler pages deploy \               wrangler pages deploy \
  dist-release --branch preview         dist-release --branch preview
                                      wrangler pages deploy \                    (生产 main 同一份 dist,
                                        dist-release --branch main                不再需要任何删除操作)
(双域名哈希核验)                       (不变)+ curl 一眼双域 cdn.json 应 200      (可选加一眼)
```

**发布脚本三种终态**:
- 双源全绿 → 照常部署;
- 仅 jsDelivr 绿(npmmirror sync 排队中,几分钟~几十分钟)→ 照常部署(全球道顶上),
  10-30 分钟后重跑 `--skip-publish` 补入 tgzUrls 再部署一次(纯 cdn.json 差量,秒级);
- 全红 → 等 10 分钟重跑(npm 传播窗口),不必排查。
- npm 凭据失效(脚本 exit 1 报 E403/EOTP)→ 续期 granular token(bypass 2FA)或 `--otp`。
- **忘跑发布脚本 ≠ 故障**:preview 静默回同源直连,功能无损只是慢;补跑即恢复。


## 一、架构总览

```
发布侧:
  npm run build:release                 → dist-release/(分片 zips 内容寻址 p<i>-<hash8>.zip)
  node scripts/publish-assets-cdn.mjs   → 逐分片发 npm 包(@sandboxworld/assets-p<i>,
                                          版本=0.0.0-<hash8> 幂等)→ npmmirror sync
                                          → 验活(zipBytes 对账)→ 写 dist-release/assets-zip/cdn.json
  wrangler pages deploy dist-release --project-name sandboxworld --branch preview

客户端(AssetCache + asset-warm.worker + partFetcher):
  init 时与 manifest 并行拉 assets-zip/cdn.json(可选;404=纯同源,静默)
  → warm jobs 每片带候选序 [npmmirror, jsDelivr, '/assets-zip/<file>']
  → worker fetchPartBuffer 按候选回退(长度校验/字节账回卷语义与旧版逐位一致)
  → 解压后按【相对路径】写 Cache API —— ★缓存键与来源无关,换源不换版本
```

**版本不变式(关键安全性质)**:SW 缓存名 = fnv1a32(基础版本 | manifest contentHash)。
cdn.json 不参与版本 hash ⇒ 切源/回滚对存量用户的缓存**零失效、零重拉**(符合
asset-repull-cost-policy:内容变更才付一次性全量,切源这类纯通道变更绝不付流量)。

## 二、已实测的硬事实(2026-10-13)

| 事实 | 数值/结论 | 证据 |
|---|---|---|
| jsDelivr 单文件上限 | 50MB | 官方报错原文 `File size exceeded the configured limit of 50 MB`;47.4MB 文件实测 206 |
| jsDelivr npm tarball 上限 | **150MB** | 408MB 包 403 `Package size exceeded the configured limit of 150 MB` ⇒ 单包 281MB 方案不可行,**必须分片多包** |
| **npmmirror unpkg files API 白名单** | **新包默认 403/451** | `cnpm/unpkg-white-list`;scope 级加白要求 scope 内有周下载 >10k 热门包 ⇒ 全新 scope **此路不通** |
| **npmmirror tarball 无白名单** | 实测通,302 → `cdn.npmmirror.com`(阿里) | registry 核心功能 ⇒ **国内快车道走 tarball**(tgz 包着 zip,客户端 gunzip+tar 取 zip) |
| 国内源速度口径 | npmmirror tarball 本机实测 4.3MB/s / TTFB 0.23s(阿里国内 CDN,对国内用户只快不慢) | ★本机其余测速(jsDelivr/CF Pages)受代理污染**不作国内真值**,线上以 SW trace `源分布` 为准 |
| CORS | npmmirror tarball / jsDelivr 均 `Access-Control-Allow-Origin: *` | 浏览器 worker 跨域 fetch 可行 |
| sw.js 对 CDN fetch | 天然直通不拦截 | CDN URL pathname 不含 `sprites/fonts/l10n/sounds/audios`,不落任何 respondWith 分支,**sw.js 零改动** |
| 发布形态散件面 | `sprites/vanilla`/`sounds`/`audios/music` 已被 prune | zip 分片是这些字节的**唯一来源** ⇒ CDN 化分片=自动覆盖全部资产字节(字体/单体 sprite/音效/音乐全在内) |
| 分片体积 | pack-assets 硬帽 20MiB(Pages 单文件帽 25MiB) | 两 CDN 双限额天然满足 |
| npm 发布凭据 | 网页登录会话令牌已不可 publish(E403) | 须 **granular access token + bypass 2FA**(或开 2FA 走 OTP;`--otp`/`NPM_CONFIG_OTP` 已支持) |

## 二点五、候选源优先级与回退保证(客户端硬编码)

1. **npmmirror tarball**(国内道,`tgzUrls`):`registry.npmmirror.com/<pkg>/-/<name>-<ver>.tgz` → `cdn.npmmirror.com`;tgz 字节数由发布脚本验活时实测回填,客户端按此做长度校验
2. **jsDelivr zip**(全球道,`urls`):`cdn.jsdelivr.net/npm/<pkg>@<ver>/<file>`(内容寻址,immutable)
3. **同源**(末位兜底):`/assets-zip/<file>` —— cdn.json 缺失/全灭 = 纯同源(旧行为)

**回退保证(v0.1.70-beta 加固,生产切源前置条件)**:
- 候选失败(拒连/404/长度不符/解包炸)→ 字节账回卷 → 下一候选,origin 恒末位 ⇒
  **双 CDN 全不可用时必然落到同源**,机制上保证,不依赖运维介入。
- ★黑洞挂起防护:国内"不可用"常表现为连接吊死而非拒连——裸 fetch 会被 45s 看门狗
  反复 force 重启且每次先撞同一挂起源 = 活锁。加固两层:
  ①partFetcher 逐候选 TTFB 超时 20s + body 空闲超时 30s(可注入,单测锁定);
  ②嫌疑降级:worker 'candFail' 上报 → 页面嫌疑账(跨重启)+ worker 同 run 账
  (同 run 互补),坏源被排到队尾(origin 之前),后续分片不再撞它。
- 全候选失败(含同源)→ failed>0 → 15s 自动补拉 ≤5 轮 + online 即时重试(原有语义)。

## 三、fonts / 单体 sprites 的结论

**无需单独做**:fonts、sprites/vanilla(含单体 NPC_*.png)、sounds、audios/music
全部在 zip 分片内(pack-assets INPUT_DIRS),发布形态散件已 prune。CDN 化分片
即覆盖。剩余散件=代码 chunk(主 chunk 13MB)+ l10n(刻意同源网络优先)——
代码走 CDN 会牵动 index.html/壳缓存语义,当前不值得,列入「不做」清单。

### ★BJ724-A 复核(2026-10-26):入口 JS 走 CDN = 登记部署面任务书,代码侧不硬造

弱网实报「入口 JS 69.7s ERR_ABORTED,幕布永转无重试」曾把「入口走 CDN」重新
提上桌。定谳(构建产物+消费链亲读):**可用性问题已由 BJ724-A 两层收口**
(sw.js fetchShell 正文看门狗+单次重试 / index.html 内联启动看门狗自动重注一发
+60s 握手超时——入口失败不再幕布永转),CDN 化余下的是**提速项**而非可用性项,
且有三处部署面架构障碍,维持「不做」并登记任务书:

1. **发现面不可达**:入口 `<script type="module" crossorigin
   src="/assets/index-<hash>.js">`(dist/index.html 实形)在浏览器解析期即发起,
   先于一切页面 JS;素材 CDN 的发现机制(assets-zip/cdn.json)由页侧 AssetCache
   拉取,对入口天然迟到。CDN URL(包名@版本)只有发布时才知道,sw.js/index.html
   均为静态字节——须构建期注入(define/模板),发布管线改造。
2. **回退面只能内联**:入口失败时页面无 JS 可用,候选降级逻辑(源站→CDN,同
   partFetcher 形态)只能活在 index.html 内联脚本;BJ724-A 刀2 的「重注一发」
   骨架可扩展为双候选,但候选表注入同障碍①。
3. **缓存语义**:shell 支 cache-first 键=源站 URL;CDN 直取体落 SW 缓存需定义
   键映射(hash 内容寻址名恰好可自校验,是现成的完整性门)。

触发条件:再有弱网「入口慢」实报(非「入口失败」——那已封死)/发版节奏允许时
再开工;届时按 publish-assets-cdn 增量(把 dist/assets 入 tarball)+构建期注入
双候选表 + 探针验活三步走。

## 四、幂等与发布纪律

- **版本=0.0.0-<hash8>**(内容寻址):同名=同字节=已发布即跳过;重跑零副作用。
- **cdn.json 只写 dist 工件,不进 public/**:常规构建永不携带 ⇒ 生产部署天然同源。
- 分片内容变更才产生新包;未验活 URL 不入 cdn.json(客户端自动回同源,功能无损)。
- 每次发版后(部署 preview 前)跑一次:
  `node scripts/publish-assets-cdn.mjs --dist dist-release --timeout 600`
  (忘跑 = preview 回同源直连,功能无损,只是慢;下次补跑即恢复)

### 同步延迟窗口(2026-10-13 实测,发布链专属,用户侧无感)

```
npm publish → ①npm 本体传播 ~6-8 分钟(元数据/tarball 渐次可读)
            → ②npmmirror sync 排队(几分钟~几十分钟,cnpmcore 队列制;
               脚本 PUT /-/package/<enc>/syncs 正确入队加速)
```

- 验活门挡在 cdn.json 之前 ⇒ cdn.json 里的 URL 当场验活=永久有效,**运行时永不见未就绪源**。
- **发布节奏**:双源全绿→直接部署;仅 jsDelivr 绿→照常部署(全球道顶上),
  10-30 分钟后 `--skip-publish` 重跑补入 tgzUrls 再部署一次(纯 cdn.json 差量,秒级);
  全红→等 10 分钟重跑(npm 传播窗口),不必排查。
- npmmirror 对未同步包 451/422,不做 tarball 透明回源——所以验活门是必须的,
  也是充分的。

## 五、生产切换(已执行,2026-10-13)

前置满足:preview 稳定运行 + 端到端探针 PASS(trace 源分布以 npmmirror 为主、origin≈0)。

1. 加固版客户端(v0.1.70-beta,含黑洞超时+嫌疑降级)构建 + 发布(幂等,双源 14/14 秒验活)。
2. **同一 dist-release 先后部署 preview 与 main**(原子部署,双域逐位一致)。
3. 部署后双域名核验:双域 cdn.json 200、index.html md5 对拍一致、build-id 一致。
4. 生产域端到端探针 PASS(冷 profile 12900/12900 failed=0,npmmirror 444 命中)。
5. ★生产老用户(v0.1.67)资产内容未变 ⇒ 缓存版本号不变 ⇒ **切源对他们零重拉**。

**回滚(如需)**:删除 dist-release/assets-zip/cdn.json → 重新部署 main(或部署一个
更新的纯构建)。存量缓存不受影响(版本不变式),用户零流量损失。

## 六、风险登记

- **包名抢注**:@sandboxworld scope 需为发布账号所有;npm 包一旦发布不可复用版本号
  (内容寻址版本天然规避)。
- **CDN 可用性**:npmmirror(阿里)国内最稳;jsDelivr 主域国内历史封锁期——客户端
  按序回退 + 同源末位兜底,最坏=回到现状速度。
- **npm 账号风控**:281MB/次 的发布量对 npm 免费额度无压力(public 包无限额);
  短时间大量新版本发布可能触发 npm 短暂限流,脚本并发已压到 2。
- **旧 preview 客户端**:切源前已部署的 bundle 不认识 cdn.json,继续同源——自然过期,
  无需处理。
- **npm 元数据传播延迟**:publish 成功后 registry 元数据/tarball 可见有 5-10 分钟
  窗口(2026-10-13 实测)——发布脚本验活超时 ≠ 失败,稍后 `--skip-publish` 重跑即得。
- **tgz 通道字节口径**:tarball 传输字节 ≈ zipBytes + 0.1%(tar 头/gzip 开销),
  进度条 bytesTotal 仍按 zipBytes 口径、bytesDone 按实际传输(钳制防越界),
  偏差 <2%,显示层可忽略。
