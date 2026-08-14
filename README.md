# Bookmark Atlas Extension

## 打包方式

### 1. 安装依赖

```bash
npm install
```

### 2. 按平台打包

- 打包 Firefox（使用当前 `manifest.firefox.json` 版本号）：

```bash
npm run package:firefox
```

- 打包 Chrome（使用当前 `manifest.chrome.json` 版本号）：

```bash
npm run package:chrome
```

### 3. 打包时指定版本号

- Firefox 指定版本：

```bash
npm run package:firefox -- --version=0.1.1
```

- Chrome 指定版本：

```bash
npm run package:chrome -- --version=0.1.1
```

- 通用命令（显式指定平台）：

```bash
npm run package -- --platform=firefox --version=0.1.1
npm run package -- --platform=chrome --version=0.1.1
```

说明：
- 指定 `--version` 后，会先更新对应平台的 `manifest.{platform}.json` 中的 `version`，再执行构建与压缩。
- 不指定 `--version` 时，直接使用当前 manifest 中已有版本号打包。

### 4. 产物输出与命名

- 输出目录：`output/`
- 文件命名：`项目名-平台_版本号.zip`
- 示例：
  - `bookmark-atlas-extension-firefox_0.1.1.zip`
  - `bookmark-atlas-extension-chrome_0.1.1.zip`

### 5. 常见问题

- 如果执行 `npm run package:firefox --version=0.1.1` 只返回类似 `10.9.0`，这是 npm 把 `--version` 当成了 npm 自身参数。
- 正确写法必须带参数分隔符 `--`：

```bash
npm run package:firefox -- --version=0.1.1
```

- 也可直接执行脚本绕过 npm 参数转发：

```bash
node scripts/package-extension.mjs --platform=firefox --version=0.1.1
```

## Firefox 自分发流程

Firefox 正式版安装的扩展需要 Mozilla 签名。本项目的 `npm run package:firefox` 会生成待提交的 ZIP 包；请在 AMO 完成提交与审核后，再下载 Mozilla 签名的 XPI 文件用于自分发。

### 1. 构建待提交包

当前 Firefox 版本为 `0.1.3` 时，执行：

```bash
npm run package:firefox
```

生成的待提交包位于：

```text
output/bookmark-atlas-extension-firefox_0.1.3.zip
```

如需同时更新 Firefox manifest 版本并打包：

```bash
npm run package:firefox -- --version=0.1.3
```

### 2. 在 AMO 提交附加组件或新版本

1. 登录 https://addons.mozilla.org/ 的开发者后台。
2. 首次发布时选择提交附加组件；已有附加组件时进入对应项目并提交新版本。
3. 上传 `output/bookmark-atlas-extension-firefox_0.1.3.zip`。
4. 用于自分发时，选择仅供自行分发的提交渠道；如需在 AMO 商店展示，则选择在 AMO 列出。
5. 按后台要求填写版本说明、隐私信息及其他发布资料，并提交审核。

### 3. 下载签名 XPI 并自分发

审核通过后，在 AMO 的版本页面下载 Mozilla 签名的 XPI 文件，并按以下名称保存：

```text
bookmark_atlas-0.1.3.xpi
```

将该签名包提供给用户下载或通过内部渠道分发。若使用网站下载方式，服务器应以 `application/x-xpinstall` 作为该 XPI 文件的 `Content-Type` 响应头；用户也可以在 Firefox 中通过“从文件安装附加组件”安装已下载的 XPI。

> 注意：请勿将本地生成的 ZIP 直接改名为 `.xpi` 用于正式自分发；必须使用 AMO 审核并签名后下载的 XPI 文件。
