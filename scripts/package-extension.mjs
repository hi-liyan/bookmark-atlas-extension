import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { ZipFile } from 'yazl';

const VALID_PLATFORMS = new Set(['firefox', 'chrome']);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * 解析命令行参数，支持 --platform=firefox|chrome 与 --version=x.y.z。
 * 入参：命令行参数数组。
 * 出参：解析后的平台和版本信息。
 */
const parseCliArgs = (argv) => {
  let platform = null;
  let version = null;

  for (const arg of argv) {
    if (arg.startsWith('--platform=')) {
      platform = arg.slice('--platform='.length).trim();
      continue;
    }

    if (arg.startsWith('--version=')) {
      version = arg.slice('--version='.length).trim();
      continue;
    }
  }

  return { platform, version };
};

/**
 * 递归收集目录下全部文件，用于后续打包写入 zip。
 * 入参：目标目录绝对路径。
 * 出参：文件绝对路径数组。
 */
const collectFilesRecursively = async (dirPath) => {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      const childFiles = await collectFilesRecursively(fullPath);
      files.push(...childFiles);
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
};

/**
 * 更新指定平台 manifest 的版本号，仅在传入 version 且与当前不一致时执行修改。
 * 入参：platform 平台名，version 目标版本号。
 * 出参：更新后的 manifest 版本号。
 */
const updateManifestVersion = async (platform, version) => {
  const manifestPath = resolve(process.cwd(), `manifest.${platform}.json`);
  const content = await readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(content);

  if (version && manifest.version !== version) {
    const replaced = content.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`);
    if (replaced !== content) {
      await writeFile(manifestPath, replaced, 'utf-8');
    } else {
      // 兜底分支：当版本字段正则未命中时，使用标准 JSON 输出保证版本更新可落地。
      manifest.version = version;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    }
  }

  return version ?? manifest.version;
};

/**
 * 执行单条 Node 脚本命令并继承标准输出，失败时抛错。
 * 入参：args Node 命令参数数组。
 * 出参：Promise<void>。
 */
const runNodeScript = async (args) =>
  new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('error', rejectBuild);
    child.on('exit', (code) => {
      if (code === 0) {
        resolveBuild();
        return;
      }
      rejectBuild(new Error(`Build failed with exit code ${code ?? 'unknown'}.`));
    });
  });

/**
 * 执行构建流程：先调用 Vite 打包，再复制目标平台 manifest。
 * 入参：platform 平台名。
 * 出参：Promise<void>。
 */
const runBuild = async (platform) => {
  await runNodeScript(['./node_modules/vite/bin/vite.js', 'build']);
  await runNodeScript(['./scripts/copy-manifest.mjs', platform]);
};

/**
 * 将 dist 目录打包为 zip，并写入 output 目录。
 * 入参：sourceDir 源目录，zipPath 目标 zip 文件路径。
 * 出参：Promise<void>。
 */
const zipDirectory = async (sourceDir, zipPath) =>
  new Promise(async (resolveZip, rejectZip) => {
    try {
      const zip = new ZipFile();
      const outStream = createWriteStream(zipPath);
      const files = await collectFilesRecursively(sourceDir);

      outStream.on('close', resolveZip);
      outStream.on('error', rejectZip);
      zip.outputStream.on('error', rejectZip);
      zip.outputStream.pipe(outStream);

      for (const filePath of files) {
        const zipRelativePath = relative(sourceDir, filePath).replace(/\\/g, '/');
        zip.addFile(filePath, zipRelativePath);
      }

      zip.end();
    } catch (error) {
      rejectZip(error);
    }
  });

/**
 * 主流程：参数校验 -> 可选更新版本 -> 构建 -> 压缩输出。
 * 入参：无。
 * 出参：Promise<void>。
 */
const main = async () => {
  const { platform, version } = parseCliArgs(process.argv.slice(2));

  if (!platform || !VALID_PLATFORMS.has(platform)) {
    console.error('Usage: npm run package -- --platform=firefox|chrome [--version=x.y.z]');
    process.exit(1);
  }

  if (version && !VERSION_PATTERN.test(version)) {
    console.error('Version format is invalid. Expected: x.y.z (supports optional prerelease/build suffix).');
    process.exit(1);
  }

  const projectRoot = process.cwd();
  const distDir = resolve(projectRoot, 'dist');
  const outputDir = resolve(projectRoot, 'output');
  const packageJsonPath = resolve(projectRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

  const finalVersion = await updateManifestVersion(platform, version);

  await runBuild(platform);

  const distStats = await stat(distDir);
  if (!distStats.isDirectory()) {
    throw new Error('dist directory is missing after build.');
  }

  await mkdir(outputDir, { recursive: true });
  const zipName = `${packageJson.name}-${platform}_${finalVersion}.zip`;
  const zipPath = resolve(outputDir, zipName);
  await rm(zipPath, { force: true });

  await zipDirectory(distDir, zipPath);
  console.log(`Packaged ${platform} extension: ${zipPath}`);
};

await main();
