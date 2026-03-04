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
