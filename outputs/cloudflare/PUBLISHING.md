# 独立游戏站与编辑器同步

编辑器与游戏 Worker 共享一个 Cloudflare KV namespace。读配置和素材是公开接口；写入需要编辑器 Worker 的 `PUBLISH_TOKEN` secret。游戏 Worker 即便意外配置了相同 secret，也拒绝所有写请求。

## 一次性配置

1. 创建 `wanxiang_storyforge_project` KV namespace，并把同一个 namespace 绑定到两个 Worker 的 `PROJECT_STORE`。KV 不需要开通 R2。
2. 将高强度随机密钥写入编辑器 Worker 的 secret：`npx wrangler secret put PUBLISH_TOKEN --config outputs/cloudflare/wrangler.jsonc`。不要把密钥提交到 Git。
3. 执行 `node outputs/cloudflare/build.cjs`，然后分别部署 `wrangler.jsonc` 和 `wrangler.game.jsonc`。
4. 在原编辑器浏览器中连接发布密钥并点击“部署”，上传实际使用的项目。首次发布前，游戏站显示“作品尚未发布”，不会擅自采用默认项目。

编辑器首次部署会询问发布密钥。也可通过仅含 fragment 的私有设置链接 `编辑器地址/#publish-key=密钥` 连接，脚本读取后立即清除地址中的 fragment。设置链接不要分享；玩家只使用无密钥的游戏网址。发布权限保存在该编辑器浏览器中，可通过清除 `storyforge-publish-token` 或轮换 Worker secret 撤销。

## 保存与部署规则

编辑器启动优先读取云端部署版本，跳过默认项目初始化；原浏览器草稿保留为本机备份，可用“恢复本机草稿”找回。无云端部署时才加载本机或默认项目。读取失败禁止部署。

“保存配置”仅保存本机。编辑器每 30 秒检查部署版本：未编辑时自动更新，有草稿时提示刷新且不覆盖草稿。部署使用打开项目时的版本号；旧版客户端必须刷新才能部署。

- 编辑时仍自动保存本机草稿；点击“部署”才同步游戏站。导出项目不触发发布。
- 图片、视频按 SHA-256 去重，每 20 MB 一块永久保存并直接上传，不转码；目前单文件上限为 1 GB。
- 所有素材就绪后才原子替换发布配置。失败保留旧发布版和本机草稿，可再次点击保存重试。
- 部署使用编辑基准 ETag 检查旧版本冲突。当前 KV 为最终一致存储，跨地区传播可能延迟，极短窗口内同时部署仍存在竞争；不应把此检查视为强一致事务锁。
- 游戏站每 30 秒检查版本，未开始时自动刷新配置；正在游戏时提示有更新，点击更新或重新开始才切换。新打开和重新开始都会读取最新版。
- 老素材暂不自动清理，避免影响正在播放旧版本的访客。长期使用应增加保留周期及按版本清理策略。

## 本地验证

在 `outputs/cloudflare/.dev.vars` 写入仅用于本地测试的 `PUBLISH_TOKEN=local-test-publish-key`（已被 Git 排除）。

```sh
node outputs/cloudflare/build.cjs
npx wrangler dev --config outputs/cloudflare/wrangler.jsonc --port 4176 --persist-to work/cloudflare-local
npx wrangler dev --config outputs/cloudflare/wrangler.game.jsonc --port 4175 --persist-to work/cloudflare-local
node work/test-cloud-publishing.cjs
```

测试使用浏览器独立上下文和本地 KV，不修改线上配置。验证保存、分块素材上传、独立播放、重新开始读取最新版、Range 视频请求、权限拒绝、缺素材时保留旧配置和并发冲突。浏览器测试路径与已有测试一样按原开发机配置。
