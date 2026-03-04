# Firefox 书签管理扩展（TypeScript）设计文档

## 1. 目标与范围

### 1.1 目标
开发一个基于 TypeScript 的书签管理浏览器扩展（Firefox 优先，兼容 Chrome），用于高效管理用户书签，支持：
- 读取用户已保存书签（含目录结构）
- 目录维度管理（浏览、移动、重命名、创建、删除）
- 基于书签名、URL 的模糊搜索
- 书签相似搜索（名称相似、URL 相似、域名相似）
- 在设置页配置 CouchDB 并进行云同步（可开关）

### 1.2 非目标（首版不做）
- 云端账户系统
- 页面内容全文索引（仅使用书签元数据）
- AI 语义搜索（可作为后续增强）

## 2. 用户场景

1. 用户打开扩展首页，查看书签目录树并展开子目录。
2. 用户输入关键字，按“名称 + URL 模糊匹配”快速定位书签。
3. 用户对某个书签触发“查找相似”，系统返回相似条目以便去重或归档。
4. 用户将选中书签移动到指定目录，或批量整理。

## 3. 技术方案总览

### 3.1 技术栈
- 语言：TypeScript
- 框架：React + TypeScript
- 样式：Tailwind CSS + daisyUI
- 状态管理：Zustand
- 构建：Vite
- 扩展标准：WebExtensions（Firefox 优先，兼容 Chrome）
- API 类型：`webextension-polyfill` + `@types/firefox-webext-browser`
- 测试：Vitest（单元）+ Playwright（可选 E2E）

### 3.2 模块划分
- `popup`：主操作界面（目录树、搜索、结果列表）
- `background`：统一处理书签 API 调用、索引构建、缓存更新
- `sync`：CouchDB 同步引擎（推送、拉取、冲突处理、重试）
- `shared`：类型定义、搜索算法、工具函数
- `options`：偏好设置（索引策略、相似阈值、停用词、主题）

### 3.3 Firefox 优先 + Chrome 兼容策略
- 统一使用 `browser.*` API（基于 `webextension-polyfill`），避免直接写 `chrome.*`
- 首发目标：Firefox Developer Edition 验证并发布
- 兼容目标：Chrome MV3 同步支持（通过 `manifest` 字段差异化打包）
- 打包策略：维护 `manifest.firefox.json` 与 `manifest.chrome.json`，构建时注入对应清单
- 差异处理：将权限、background 配置、options 行为放入适配层，业务逻辑共用
### 3.4 架构图（逻辑）
- UI 层（popup/options）
  - 发起命令：查询、搜索、移动、更新
- Service 层（background）
  - 调用 `browser.bookmarks.*`
  - 维护内存索引与持久化索引（`browser.storage.local`）
  - 调用 `sync` 执行 CouchDB 双向同步
- 数据层
  - Firefox bookmarks 树
  - 本地索引快照
  - CouchDB 远端文档库

### 3.5 CouchDB 同步策略（本地优先）
- 同步模型：本地书签树作为主工作副本，远端 CouchDB 作为跨设备同步源
- 同步方向：默认双向（push + pull），支持仅上传/仅下载
- 同步触发：
  - 手动点击“立即同步”
  - 本地书签变更后延迟触发（防抖）
  - 周期同步（例如每 5/15/30 分钟）
- 增量机制：记录 `lastSyncSeq`，使用 CouchDB `_changes` 拉取增量
- 冲突策略（可配置）：
  - `latest-write-wins`（默认）
  - `prefer-local`
  - `prefer-remote`
- 失败重试：指数退避（最大重试次数可配）

## 4. 权限与清单

### 4.1 Manifest 权限
- `bookmarks`：读写书签
- `storage`：缓存索引、用户设置
- `alarms`（可选）：定时触发云同步
- `menus`（可选）：右键菜单触发“相似搜索”
- `host_permissions`：用户配置的 CouchDB 地址

### 4.2 manifest 示例（核心字段）
```json
{
  "manifest_version": 3,
  "name": "Bookmark Manager",
  "version": "0.1.0",
  "permissions": ["bookmarks", "storage", "alarms"],
  "host_permissions": ["https://your-couchdb-host.example.com/*"],
  "background": { "scripts": ["background.js"] },
  "action": { "default_popup": "popup.html" },
  "options_ui": { "page": "options.html", "open_in_tab": true }
}
```

> 注：Firefox 对 MV3 service worker 支持与 Chrome 存在差异，首版可采用 Firefox 兼容的 background scripts 方案。

### 4.3 设置页（CouchDB）配置项
- `syncEnabled`：启用/关闭云同步
- `serverUrl`：CouchDB 服务地址（例如 `https://couch.example.com`）
- `database`：数据库名（例如 `bookmark_sync`）
- `username` / `password`：基础认证（或 API Token）
- `syncIntervalMin`：周期同步间隔（分钟）
- `syncMode`：`two-way` / `push-only` / `pull-only`
- `conflictPolicy`：`latest-write-wins` / `prefer-local` / `prefer-remote`
- `autoSyncOnChange`：本地变更后自动同步
- `verifySSL`：是否严格校验证书（默认开启）

建议在设置页提供“测试连接”和“立即同步”按钮，并展示最近同步时间、同步条数、失败原因。

## 5. 数据模型设计

### 5.1 书签节点标准化
```ts
export type BookmarkNodeType = "bookmark" | "folder";

export interface BookmarkNode {
  id: string;
  parentId?: string;
  type: BookmarkNodeType;
  title: string;
  url?: string;
  index?: number;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BookmarkNode[];
}
```

### 5.2 索引结构
```ts
export interface BookmarkIndexItem {
  id: string;
  titleNorm: string;     // 归一化标题
  urlNorm: string;       // 归一化 URL
  hostname?: string;     // 域名
  pathTokens: string[];  // 路径 token
  titleTokens: string[];
  urlTokens: string[];
}

export interface BookmarkIndexSnapshot {
  version: number;
  updatedAt: number;
  items: BookmarkIndexItem[];
}
```

### 5.3 归一化规则
- 小写化
- 去除首尾空格
- URL 去协议（`http/https`）与末尾斜杠
- 全角转半角（可选）
- 去除常见噪声 token（`www`, `com` 可降权而非完全移除）

## 6. 搜索设计

### 6.1 模糊搜索（名称 / URL）
组合评分策略（加权）：
- 前缀匹配（prefix）权重高
- 子串匹配（substring）权重中
- token 命中率（token coverage）
- 编辑距离（Levenshtein）归一化得分

建议评分公式（示例）：
`score = 0.35 * prefix + 0.25 * substring + 0.25 * tokenCoverage + 0.15 * (1 - editDistanceNorm)`

### 6.2 相似搜索
给定目标书签 A，返回 Top-K 相似书签：
- 标题相似：Jaccard(token set) + 编辑距离
- URL 相似：域名相同加分；路径 token Jaccard
- 目录相似：若位于相近路径（同父目录/同祖先）加分

建议综合评分：
`sim = 0.4 * titleSim + 0.4 * urlSim + 0.2 * folderProximity`

### 6.3 性能策略
- 首次加载全量索引（异步）
- 增量更新：监听 `bookmarks.onCreated/onRemoved/onChanged/onMoved`
- 搜索防抖：150ms
- 大数据量（>20k）时：
  - 限制候选集（按 token 倒排先召回）
  - 分页返回（Top-N + 下一页）

## 7. 目录管理设计

### 7.1 能力
- 目录树展示（懒展开）
- 新建/重命名/删除目录
- 单条或批量移动书签到目录
- 拖拽排序（后续）

### 7.2 API 映射
- 读取：`browser.bookmarks.getTree`
- 创建目录：`browser.bookmarks.create({ parentId, title })`
- 更新：`browser.bookmarks.update(id, { title })`
- 删除：`browser.bookmarks.removeTree(id)`
- 移动：`browser.bookmarks.move(id, { parentId, index })`

## 8. UI/交互设计（首版）

### 8.1 主界面布局
- 左侧：目录树
- 顶部：搜索框（模式切换：模糊 / 相似）
- 右侧：书签列表（标题、URL、目录、操作）
- 组件建议（daisyUI）：`navbar`、`drawer`、`tree`（自实现）+ `menu`、`input`、`tabs`、`table`、`badge`、`modal`、`toast`

### 8.2 关键交互
- 输入关键字即搜（防抖）
- 选择某个书签后点击“找相似”
- 列表支持多选并移动目录
- 操作后提示（toast）并即时刷新

### 8.3 视觉与可用性原则
- 默认提供 2 套 daisyUI 主题（`light` + `corporate`），支持用户切换
- 高密信息布局：列表行可切换“舒适/紧凑”
- 键盘优先：`/` 聚焦搜索、`j/k` 上下选择、`m` 移动、`d` 删除（带确认）
- 所有批量危险操作必须二次确认并显示影响数量

## 9. 比原生更友好的产品 Idea

1. 智能收件箱（Inbox）  
   新增书签先进入临时区，用户再批量归档到目录，减少“先想目录再收藏”的成本。
2. 一键去重建议  
   自动识别标题近似、URL 等价（含参数清洗）和同域重复，支持“保留最新/保留最常访问”策略。
3. 快速整理规则  
   用户定义规则（如域名包含 `github.com` 自动归档到“开发/GitHub”），收藏后自动整理。
4. 阅读队列模式  
   为“稍后读”目录提供状态（未读/已读/过期），支持批量清理过期链接。
5. 搜索结果解释  
   每条结果显示命中原因（标题前缀命中、同域名、目录相近），提升可理解性。
6. 低摩擦批处理  
   支持多选后“移动 + 打标签 + 重命名模板”连续动作，减少重复点击。
7. 回收站与撤销  
   删除先进入回收站（本地缓存），提供 7 天内恢复，降低误删风险。
8. 目录健康度视图  
   显示“大目录”“长期未整理目录”“疑似无效链接目录”，引导用户定期治理。
## 10. 错误处理与边界

- 权限缺失：提示并引导重新授权
- 书签树为空：展示空状态引导
- URL 非法或为空：降级为仅标题匹配
- 删除目录时包含子项：二次确认
- 索引损坏：自动重建并记录日志

## 11. 安全与隐私

- 所有数据仅存本地（`storage.local`）
- 用户启用 CouchDB 同步后，书签元数据会上传至用户配置的 CouchDB
- 不注入网页，不读取页面正文
- 提供“清空索引缓存”操作
- 凭据建议：
  - 优先使用 CouchDB 限权账号（仅允许目标数据库读写）
  - 仅通过 HTTPS 连接 CouchDB
  - 设置页支持“清除凭据”和“重新认证”

## 12. 测试策略

### 12.1 单元测试
- 归一化函数
- 模糊评分函数
- 相似评分函数
- 目录路径计算

### 12.2 集成测试
- 书签增删改移动后索引一致性
- 搜索结果排序稳定性
- 大数据量性能基线（例如 10k/20k）
- CouchDB 同步正确性（首轮全量 + 增量 `_changes`）
- 同步冲突处理验证（三种冲突策略）

### 12.3 手工验证
- Firefox 开发者模式加载临时扩展
- Chrome 开发者模式加载临时扩展（兼容性验证）
- 验证权限、UI、搜索、目录管理全流程
## 13. 里程碑

### M1 - 基础可用（1 周）
- 工程初始化（React + TS + TailwindCSS + daisyUI + Vite + Zustand）
- 书签读取与目录树展示
- 基础模糊搜索（标题/URL）

### M2 - 管理能力（1 周）
- 创建/重命名/删除目录
- 移动书签（单条/批量）
- 索引增量更新

### M3 - 相似搜索与优化（1 周）
- 相似搜索 Top-K
- 搜索性能优化
- Firefox 首发打包 + Chrome 兼容打包
- 测试补齐与发布准备

### M4 - 云同步（1 周）
- 设置页完成 CouchDB 配置与连接测试
- 双向同步与增量同步（`_changes`）落地
- 冲突处理、重试机制、同步状态面板
## 14. 后续扩展

- 重复书签自动检测与一键整理
- 自定义排序策略（按使用频率/时间）
- 导入导出（JSON/HTML）
- 基于本地模型的语义相似搜索

---

## 附：建议目录结构
```txt
bookmark-manager/
  src/
    background/
      index.ts
      bookmark-service.ts
      indexer.ts
    popup/
      main.tsx
      App.tsx
      components/
    options/
      main.tsx
    shared/
      types.ts
      normalize.ts
      fuzzy-search.ts
      similar-search.ts
  public/
    manifest.json
    popup.html
    options.html
  tests/
    unit/
    integration/
  package.json
  tsconfig.json
```
