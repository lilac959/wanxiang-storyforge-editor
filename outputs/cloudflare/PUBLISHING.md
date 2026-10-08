# 新版编辑器与独立运行端部署

两个 Worker 共用 `PROJECT_STORE` 媒体 KV，并共用编辑器 Worker 内的 `ProjectCoordinator` Durable Object。私有草稿和发布版本存入 Durable Object，旧作品及原媒体继续从现有 KV 读取。

## 部署

```sh
npm ci
npm run check
npm test
npm run build
npx wrangler deploy --config outputs/cloudflare/wrangler.jsonc
npx wrangler deploy --config outputs/cloudflare/wrangler.game.jsonc
```

先部署编辑器，创建 `v2-projects` SQLite Durable Object 迁移；再部署引用该对象的游戏 Worker。保留已有编辑器 `PUBLISH_TOKEN` secret；新环境才需要通过 `wrangler secret put PUBLISH_TOKEN` 设置，真实密钥不要写入 Git。游戏 Worker 不需要发布密钥，即使收到有效授权也拒绝私有接口及写入。

Wrangler 4.148.0 已完成部署包检查。`npm run build` 原样复制素材，对超限视频生成媒体分块；Asset binding 内使用规范化的 `/game` 路径，避免 `.html` 重定向循环。

## 数据与兼容

- 浏览器优先恢复本机草稿，旧数据迁移前保存本机备份；旧脚本和 `/legacy` 恢复入口保留。
- 授权后的草稿自动同步；串行保存、修订号比对，冲突时保留本机修改。
- 发布时先检查素材并上传，再建立不可变版本，最后切换最新指针。回退只切换指针。
- 播放器固定本次打开时的版本；访问 `?version=版本号` 可永久定位该版本。刷新固定作品链接才会读最新发布版。
- 新版尚未发布时，运行端会读取旧 `/api/project` 并迁移播放。因此升级程序不会把旧作品替换为制作示例。
- 媒体 SHA-256 去重，每块 20 MB、每文件上限 1 GB，原视频不转码。KV 跨区域传播可能延迟，上传确认失败时可重试，旧版本保留。
- 历史版本和媒体暂不自动清理；当前是单创作者授权，非多租户账户系统。

## 自定义域名

目标为 `https://www.talesparkai.cc/`，绑定到 `wanxiang-game`；编辑器仍使用独立 workers.dev 地址。Cloudflare Custom Domain 要求该域名对应一个已激活的 Cloudflare zone，不能仅把外部 DNS 的 CNAME 指向 workers.dev。

接入前必须完整保留现有 DNS，尤其 Google 邮箱 MX、TXT、SPF、DKIM 和 DMARC；域名仍可在 Namecheap 购买和续费，只切换 DNS 托管。确认 Cloudflare 指派的域名服务器并等待 zone 激活后，为游戏配置增加：

```json
"routes": [{ "pattern": "www.talesparkai.cc", "custom_domain": true }]
```

2026-10-08 已完成接入：zone 已激活，两个域名均绑定到 `wanxiang-game`，Namecheap 使用 `derek.ns.cloudflare.com` 与 `luciana.ns.cloudflare.com`。Google MX、域名验证 TXT、DKIM TXT、验证 CNAME 均已保留并逐项比对。

`www.talesparkai.cc` 是正式作品地址；裸域名及 HTTP 首页跳转至 HTTPS 正式地址。编辑器的 `PLAYER_URL` 环境变量用于生成正式分享链接，公开的 `/api/site` 只提供这个地址。域名账号和 DNS 原始备份不纳入 Git。

参考：[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

## 本机测试

`npm start` 提供同样的草稿、媒体和发布 API，并将测试数据保存到 `work/local-data`。默认授权 `local-development-only`，服务仅监听 127.0.0.1。可用 `PORT`、`STORYFORGE_DATA`、`PUBLISH_TOKEN` 环境变量覆盖；此适配器不用于公网生产。

`npm test` 覆盖真实 HTTP/磁盘持久化以及服务权限、版本冲突、缺媒体、不可变版本和回退。浏览器验收记录在 `docs/VERIFICATION.md`。
