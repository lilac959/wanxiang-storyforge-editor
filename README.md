# 万象环轨 · 互动影游编辑器

原生 HTML、CSS、JavaScript 编辑器，包含剧情节点、分镜、时间轴、鼠标 QTE、电影黑边及项目导入导出。

## 本地运行

安装 Node.js 后，在仓库根目录执行：

```sh
node work/server.cjs
```

打开 http://127.0.0.1:4173/ 。运行源码和所需素材位于 `outputs/storyforge`。

## 构建与打包

```sh
node outputs/cloudflare/build.cjs
python work/package-mechanical.py
```

Cloudflare 部署配置位于 `outputs/cloudflare/wrangler.jsonc`，部署前需登录对应账号。构建副本、打包 ZIP 和临时设计稿不纳入版本管理。

## 检查与维护

详见 [维护记录](work/REFACTOR.md)。现有浏览器测试仍包含原开发机的 Playwright 和 Edge 绝对路径，换机器运行前需要调整。部分历史测试对应旧设计；最近的回归集合为 `work/run-refactor-checks.cjs`。

`work/refactor-backup/timeline-editor.js` 是渲染一致性测试使用的历史基线，不属于运行入口。
