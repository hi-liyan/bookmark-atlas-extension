# Bookmark Manager 开发任务清单（Tasks）

> 来源文档：`DESIGN.md`  
> 技术栈：React + TypeScript + TailwindCSS + daisyUI + Vite + Zustand  
> 目标平台：Firefox 优先，兼容 Chrome

## 1. 项目初始化（M1）

- [ ] 初始化 Vite + React + TS 工程
- [ ] 安装依赖：`tailwindcss`、`daisyui`、`zustand`、`webextension-polyfill`
- [ ] 配置 Tailwind + daisyUI 主题（至少 `light`、`corporate`）
- [ ] 配置扩展构建输出目录（popup/options/background）
- [ ] 新建双清单：`manifest.firefox.json`、`manifest.chrome.json`
- [ ] 建立统一 API 适配层（统一走 `browser.*`）
- [ ] 建立基础目录结构（`src/popup`、`src/options`、`src/background`、`src/sync`、`src/shared`）

验收标准：
- [ ] Firefox 可加载临时扩展并打开 popup 页面
- [ ] Chrome 可加载构建产物（允许部分功能后续补齐）

## 2. 书签基础能力（M1）

- [ ] 封装 `bookmark-service`：`getTree/get/create/update/move/removeTree`
- [ ] popup 实现目录树展示与展开
- [ ] 书签列表展示（标题、URL、所属目录）
- [ ] 建立本地索引模型与首次全量索引
- [ ] 建立书签事件监听（create/remove/change/move）并增量更新索引

验收标准：
- [ ] 扩展启动后可完整读取并展示书签树
- [ ] 书签变更后 UI 在可接受延迟内刷新

## 3. 搜索能力（M1-M3）

- [ ] 实现标准化模块：标题/URL 归一化、token 化
- [ ] 实现模糊搜索评分（prefix/substring/token/edit-distance）
- [ ] 搜索输入防抖（150ms）
- [ ] 实现相似搜索（title/url/folder proximity）
- [ ] 支持 Top-K 和分页
- [ ] 在结果中展示“命中原因”标签

验收标准：
- [ ] 关键字可命中标题与 URL
- [ ] 相似搜索结果排序稳定，可复现

## 4. 目录管理（M2）

- [ ] 新建目录
- [ ] 重命名目录
- [ ] 删除目录（含二次确认）
- [ ] 单条移动书签
- [ ] 批量移动书签
- [ ] 操作反馈（toast）与失败错误提示

验收标准：
- [ ] 所有目录操作能正确落到浏览器真实书签数据
- [ ] 批量移动支持至少 100 条书签

## 5. UI/UX 提升（M2-M3）

- [ ] 顶栏搜索 + 模式切换（模糊/相似）
- [ ] 列表密度切换（舒适/紧凑）
- [ ] 键盘快捷键：`/`、`j/k`、`m`、`d`
- [ ] 多选操作栏（移动、删除、归档）
- [ ] 设置页主题切换（daisyUI）
- [ ] 空状态/加载状态/错误状态统一组件

验收标准：
- [ ] 核心流程可仅键盘完成
- [ ] 在移动端窄宽度下可用（基础响应式）

## 6. CouchDB 云同步（M4）

- [ ] 定义同步配置模型（`syncEnabled/serverUrl/database/...`）
- [ ] options 页面实现 CouchDB 配置表单
- [ ] 实现“测试连接”
- [ ] 实现“立即同步”按钮
- [ ] 实现双向同步（push + pull）
- [ ] 实现增量同步（`_changes` + `lastSyncSeq`）
- [ ] 实现同步模式：`two-way/push-only/pull-only`
- [ ] 实现冲突策略：`latest-write-wins/prefer-local/prefer-remote`
- [ ] 实现失败重试（指数退避）
- [ ] 同步状态面板（最近时间、成功数、失败原因）

验收标准：
- [ ] 两台浏览器在同一 CouchDB 下可完成增量同步
- [ ] 断网恢复后可继续同步，不丢数据

## 7. 安全与隐私

- [ ] 敏感配置最小化存储（账号信息可清除）
- [ ] HTTPS 校验默认开启
- [ ] 提供“清空索引缓存”“清除同步配置”
- [ ] 使用限权 CouchDB 账号进行联调

验收标准：
- [ ] 用户可随时关闭同步并删除配置

## 8. 测试与质量

- [ ] 单元测试：normalize、fuzzy、similar、path
- [ ] 集成测试：索引一致性、排序稳定性
- [ ] 同步测试：全量、增量、冲突、重试
- [ ] 性能测试：10k/20k 书签检索延迟
- [ ] 手工测试：Firefox + Chrome 兼容验证

验收标准：
- [ ] 关键模块测试通过率达标（建议 >80%）
- [ ] 在 Firefox 完成首发可用版本验证

## 9. 发布与交付

- [ ] 版本号与变更日志
- [ ] 打包 Firefox 版本
- [ ] 打包 Chrome 兼容版本
- [ ] 编写安装与配置说明（含 CouchDB 同步）

验收标准：
- [ ] 产物可被本地手动安装并完成核心流程

## 10. 建议执行顺序

1. 项目初始化
2. 书签基础能力
3. 模糊搜索
4. 目录管理
5. 相似搜索 + UI/UX 提升
6. CouchDB 同步
7. 测试与发布

## 11. 当前优先级（建议）

- P0：M1（可读取、可搜索、可展示）
- P1：M2（可管理）
- P2：M3（更智能搜索 + 体验优化）
- P3：M4（云同步）
