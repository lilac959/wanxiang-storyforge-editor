# 独立游戏站与编辑器同步

编辑器与游戏 Worker 共享一个私有 R2 bucket。读配置和素材是公开接口；写入需要编辑器 Worker 的 `PUBLISH_TOKEN` secret。游戏 Worker 即便意外配置了相同 secret，也拒绝所有写请求。

## 一次性配置

1. 在 Cloudflare 账号中开通 R2，再创建 `wanxiang-storyforge-project` bucket。
2. 将高强度随机密钥写入编辑器 Worker 的 secret：`npx wrangler secret put PUBLISH_TOKEN --config outputs/cloudflare/wrangler.jsonc`。不要把密钥提交到 Git。
3. 执行 `node outputs/cloudflare/build.cjs`，然后分别部署 `wrangler.jsonc` 和 `wrangler.game.jsonc`。
4. 在原编辑器浏览器中连接发布密钥并点击“保存配置”，上传实际使用的项目。首次发布前，游戏站显示“作品尚未发布”，不会擅自采用默认项目。

编辑器首次保存会询问发布密钥。也可通过仅含 fragment 的私有设置链接 `编辑器地址/#publish-key=密钥` 连接，脚本读取后立即清除地址中的 fragment。设置链接不要分享；玩家只使用无密钥的游戏网址。发布权限保存在该编辑器浏览器中，可通过清除 `storyforge-publish-token` 或轮换 Worker secret 撤销。

## 保存规则

- 编辑时仍自动保存本机草稿；点击“保存配置”才同步游戏站。导出项目不触发发布。
- 图片、视频逐项按 SHA-256 去重上传，R2 校验原始内容，不转码；目前单文件上限为 95 MB。
- 所有素材就绪后才原子替换发布配置。失败保留旧发布版和本机草稿，可再次点击保存重试。
- 并发保存通过 ETag 条件写入防止覆盖；发生冲突会提示重新检查后保存。
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

测试使用浏览器独立上下文和本地 R2，不修改线上配置。验证保存、素材上传、独立播放、重新开始读取最新版、Range 视频请求、权限拒绝、缺素材时保留旧配置和并发冲突。浏览器测试路径与已有测试一样按原开发机配置。
