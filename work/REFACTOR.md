# 编辑器维护记录（2026-09-18）

## 项目入口与边界

- `outputs/storyforge/index.html` 是运行入口，按顺序加载普通脚本，脚本之间共享全局函数和状态；不能直接按 ES module 的引用方式判断是否使用。
- `app.js` 管理项目数据、旧数据迁移、属性面板、素材导入、保存及播放调度。
- `timeline-editor.js` 管理时间轴渲染、选中状态、拖动及键盘调时；`cinema.js` 管理黑边时间区间。
- `mouse-qte.js`、`tail-qte.js`、`qte-audio.js` 分别负责手势、片尾播放控制和交互音效。
- `choice-position.js` 管理选项位置；`sorting.js` 和 `board-menu.js` 管理排序及分镜菜单；`archive.js` 管理 ZIP。
- 样式按 `style.css` → `ux-theme.css` → `psd-theme.css` 叠加，前两份仍提供当前界面的基础规则。
- `outputs/cloudflare/build.cjs` 生成部署目录及媒体分块；`work/package-mechanical.py` 打包整个运行目录。不要直接维护 `outputs/cloudflare/public` 中的副本。
- 项目没有 package.json、锁文件或统一测试命令；浏览器端使用原生 JavaScript。`work/test-*.cjs` 是各阶段留下的独立检查。

## 本次修改

- 将时间轴的二次字符串替换、HTML 搜索插入和包装切片改为一次直接生成最终结构；保留原有 DOM、样式类、时间字段及交互接口。
- 删除已被 `data-time-key` 通用拖动处理替代的 `.timeline-trim` 旧事件处理和 CSS，以及旧的中间渲染函数与未使用局部变量。
- 合并分镜复制、插入、删除、排序后的画面及播放位置同步，复用 `showEditorBoard`。
- 对时间轴、排序和分镜菜单三个模块进行格式整理，不对主应用做整体重写。
- 移除排序测试对源 CSS 的写入；将两项旧测试更新为现行时间轴控件及独立黑边时间字段。

## 已执行验证

- 所有运行目录 JavaScript 文件语法检查通过；三个整理模块的 Prettier 检查通过。
- `test-refactor-markup.cjs`：49 种时间轴组合与修改前 HTML 完全一致。
- `test-timeline-editor.cjs`、`test-timing-tracks.cjs`：画布拖动、属性选择、缩放、时间轴调时及持久化通过。
- `test-board-position.cjs`：真实页面复制、删除、排序后画面及时间位置同步通过。
- `run-refactor-checks.cjs` 中 12 项检查全部通过：ZIP、排序、分镜数据、素材替换、素材拖入、保存导出、分支时间轴、选项位置、选项状态、独立电影黑边、中文输入、QTE 播完后跳转。详细结果见 `refactor-test-results.json`。
- Cloudflare 本地构建及编辑器 ZIP 打包完成。本次未发布线上版本。

## 保留与限制

- 无 Git 仓库，修改前文件保存在 `work/refactor-backup`；此次修改以当前文件为基础，未回退用户现有内容。渲染对比测试使用该快照。
- 历史设计稿、素材、原始 PSD 输出、数据迁移及旧主题文件保留：素材可由导入配置或浏览器保存数据间接引用，迁移支持已有项目；旧主题参与级联，不能仅凭文本搜索删除。
- 没有逐项运行所有历史测试；部分断言对应已废弃的旧设计。本次修正了与改动直接相关的两项，未将其余历史测试宣称为通过。
- 手机检查使用横屏浏览器模拟，未在实体手机上验证；本次未验证线上网络、真实账户部署和人工听感。
- 主应用仍使用共享全局状态，职责较集中；本次优先清理已确认冗余，保留后续渐进拆分空间。
