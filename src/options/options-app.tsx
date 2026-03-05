import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { browser } from '../shared/browser';
import type { SyncConfig } from '../shared/types';

const STORAGE_KEY = 'sync-config';

const defaultConfig: SyncConfig = {
  syncEnabled: false,
  serverUrl: '',
  database: '',
  username: '',
  password: '',
  syncIntervalMin: 15,
  syncMode: 'two-way',
  conflictPolicy: 'latest-write-wins',
  autoSyncOnChange: true,
  verifySSL: true
};

interface ShortcutCommandView {
  name: string;
  shortcut: string;
  description: string;
}

interface BrowserInfoApi {
  getBrowserInfo?: () => Promise<{ name: string }>;
}

interface ShortcutSettingsNavigationResult {
  mode: 'opened' | 'manual';
  manualMessage?: string;
}

/**
 * 将命令名转换为更易懂的中文显示，便于用户识别功能用途。
 * 入参：扩展命令名。
 * 出参：用于页面展示的命令标题。
 */
const getCommandDisplayName = (commandName: string): string => {
  if (commandName === 'open-quick-search') {
    return '快速搜索';
  }

  if (commandName === '_execute_action' || commandName === '_execute_browser_action') {
    return '主弹窗';
  }

  return commandName;
};

/**
 * 读取命令列表并转换为页面展示结构。
 * 入参：无。
 * 出参：快捷键命令数组。
 */
const getShortcutCommands = async (): Promise<ShortcutCommandView[]> => {
  const commands = await browser.commands.getAll();
  return commands.map((command: browser.commands.Command) => ({
    name: command.name,
    shortcut: command.shortcut || '未设置',
    description: command.description || '无描述'
  }));
};

/**
 * 更新同步配置中的指定字段，避免重复创建多处 setConfig 逻辑。
 * 入参：字段名与字段值。
 * 出参：void。
 */
const createConfigUpdater = (
  setConfig: Dispatch<SetStateAction<SyncConfig>>
): (<K extends keyof SyncConfig>(key: K, value: SyncConfig[K]) => void) => {
  return <K extends keyof SyncConfig>(key: K, value: SyncConfig[K]): void => {
    setConfig((previous) => ({ ...previous, [key]: value }));
  };
};

/**
 * 跳转浏览器原生快捷键设置页，统一处理 Firefox 与 Chromium 差异。
 * 入参：无。
 * 出参：Promise<ShortcutSettingsNavigationResult>。
 */
const openBrowserShortcutSettings = async (): Promise<ShortcutSettingsNavigationResult> => {
  const runtimeApi = browser.runtime as unknown as BrowserInfoApi;

  if (runtimeApi.getBrowserInfo) {
    const browserInfo = await runtimeApi.getBrowserInfo();
    if (browserInfo.name.toLowerCase().includes('firefox')) {
      // Firefox 会阻止扩展直接打开 about:addons，因此这里返回手动指引，避免抛出非法 URL 错误。
      return {
        mode: 'manual',
        manualMessage: 'Firefox 不允许扩展直接打开 about:addons。请手动打开 about:addons -> 管理你的扩展 -> 齿轮菜单 -> 管理扩展快捷键。'
      };
    }
  }

  await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  return { mode: 'opened' };
};

export const OptionsApp = () => {
  // 当前激活 tab：控制设置页三大区域（同步、快捷键、关于）的显示。
  const [activeTab, setActiveTab] = useState<'sync' | 'shortcuts' | 'about'>('sync');
  // 扩展基础信息：从 manifest 读取产品名与版本号，确保展示值与构建产物一致。
  const manifestInfo = browser.runtime.getManifest();
  const productName = manifestInfo.name || 'Bookmark Atlas';
  const productVersion = manifestInfo.version || '-';
  const [config, setConfig] = useState<SyncConfig>(defaultConfig);
  const [savedMessage, setSavedMessage] = useState('');
  const [shortcutCommands, setShortcutCommands] = useState<ShortcutCommandView[]>([]);
  const [shortcutError, setShortcutError] = useState('');
  const [shortcutNavError, setShortcutNavError] = useState('');
  const updateConfig = createConfigUpdater(setConfig);

  useEffect(() => {
    void (async () => {
      const stored = await browser.storage.local.get(STORAGE_KEY);
      const value = stored[STORAGE_KEY] as SyncConfig | undefined;
      if (value) {
        setConfig(value);
      }
    })();
  }, []);

  /**
   * 刷新快捷键命令列表，确保页面展示最新配置。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const loadShortcutCommands = async (): Promise<void> => {
    try {
      setShortcutError('');
      const commandViews = await getShortcutCommands();
      setShortcutCommands(commandViews);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取快捷键失败';
      setShortcutError(message);
    }
  };

  useEffect(() => {
    void loadShortcutCommands();
  }, []);

  /**
   * 保存同步配置到本地存储。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const save = async (): Promise<void> => {
    await browser.storage.local.set({ [STORAGE_KEY]: config });
    setSavedMessage('设置已保存');
    setTimeout(() => setSavedMessage(''), 1500);
  };

  /**
   * 打开浏览器快捷键设置页面，并在失败时展示友好提示。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const goToShortcutSettings = async (): Promise<void> => {
    try {
      setShortcutNavError('');
      const result = await openBrowserShortcutSettings();
      if (result.mode === 'manual') {
        setShortcutNavError(result.manualMessage || '当前浏览器不支持从扩展页直接打开快捷键设置，请手动进入浏览器设置页面。');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开浏览器快捷键设置页面';
      setShortcutNavError(message);
    }
  };

  return (
    <main className="min-h-screen bg-[#EFF3F7] px-4 py-6 text-slate-800 md:px-6">
      {/* 页面主体容器：统一控制最大宽度，避免信息过宽导致阅读困难 */}
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {/* 顶部标题栏：展示设置页定位和主操作按钮 */}
        <header className="rounded-[15px] border border-slate-200 bg-white p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">扩展设置</h1>
              <p className="text-sm text-slate-500">Bookmark Atlas 扩展设置页。</p>
            </div>
            {activeTab === 'sync' ? (
              <div className="flex items-center gap-3">
                {savedMessage ? <span className="text-sm text-[#138052]">{savedMessage}</span> : null}
                <button
                  className="rounded-lg bg-[#138052] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#106b45]"
                  onClick={() => void save()}
                  type="button"
                >
                  保存设置
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="rounded-[15px] border border-slate-200 bg-white p-4 md:p-5">
          {/* Tab 导航区：切换同步、快捷键与关于三个设置分组 */}
          <div className="mb-4 inline-flex w-fit rounded-[10px] bg-[#EFF3F7] p-1">
            <button
              className={`rounded-[8px] px-4 py-2 text-sm font-medium transition ${
                activeTab === 'sync'
                  ? 'bg-white text-[#138052] shadow-sm ring-1 ring-[#138052]/20'
                  : 'text-slate-600 hover:bg-white/80 hover:text-[#138052]'
              }`}
              onClick={() => setActiveTab('sync')}
              type="button"
            >
              同步
            </button>
            <button
              className={`rounded-[8px] px-4 py-2 text-sm font-medium transition ${
                activeTab === 'shortcuts'
                  ? 'bg-white text-[#138052] shadow-sm ring-1 ring-[#138052]/20'
                  : 'text-slate-600 hover:bg-white/80 hover:text-[#138052]'
              }`}
              onClick={() => setActiveTab('shortcuts')}
              type="button"
            >
              快捷键
            </button>
            <button
              className={`rounded-[8px] px-4 py-2 text-sm font-medium transition ${
                activeTab === 'about'
                  ? 'bg-white text-[#138052] shadow-sm ring-1 ring-[#138052]/20'
                  : 'text-slate-600 hover:bg-white/80 hover:text-[#138052]'
              }`}
              onClick={() => setActiveTab('about')}
              type="button"
            >
              关于
            </button>
          </div>

          {activeTab === 'sync' ? (
            <section>
              {/* 同步配置总览：展示本区域用途与全局总开关。 */}
              <div className="mb-4 flex flex-col gap-3 rounded-[12px] border border-[#138052]/20 bg-[#138052]/5 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">同步配置</h2>
                  <p className="text-sm text-slate-600">按“连接信息 / 同步策略 / 安全与自动化”分组配置，保存后生效。</p>
                </div>
                {/* 启用同步开关：决定是否允许后台执行同步流程。 */}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 py-2">
                  <input
                    checked={config.syncEnabled}
                    className="h-4 w-4 rounded border-slate-300 text-[#138052] focus:ring-[#138052]/30"
                    onChange={(event) => updateConfig('syncEnabled', event.target.checked)}
                    type="checkbox"
                  />
                  <span className="text-sm font-medium text-slate-700">启用同步</span>
                </label>
              </div>

              <div className="space-y-4">
                {/* 连接信息卡片：配置同步服务地址与认证信息。 */}
                <section className="rounded-[12px] border border-slate-200 bg-[#EFF3F7]/45 p-4">
                  <h3 className="text-base font-semibold text-slate-800">连接信息</h3>
                  <p className="mt-1 text-sm text-slate-500">用于建立与 CouchDB 的连接，建议仅填写当前环境所需配置。</p>
                  <div className="mt-4 space-y-3">
                    {/* 服务地址行：左侧标签与说明，右侧输入框。 */}
                    <label className="flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-white p-3 md:flex-row md:items-center md:gap-4">
                      <span className="shrink-0 md:w-64">
                        <span className="block text-sm font-medium text-slate-700">Server URL</span>
                        <span className="mt-1 block text-xs text-slate-500">CouchDB 服务地址，例如 `https://couchdb.example.com`。</span>
                      </span>
                      <input
                        className="w-full rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138052] focus:ring-2 focus:ring-[#138052]/15"
                        onChange={(event) => updateConfig('serverUrl', event.target.value)}
                        placeholder="https://couchdb.example.com"
                        type="url"
                        value={config.serverUrl}
                      />
                    </label>

                    {/* 数据库名行：左侧标签与说明，右侧输入框。 */}
                    <label className="flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-white p-3 md:flex-row md:items-center md:gap-4">
                      <span className="shrink-0 md:w-64">
                        <span className="block text-sm font-medium text-slate-700">Database</span>
                        <span className="mt-1 block text-xs text-slate-500">用于存放书签数据的数据库名称。</span>
                      </span>
                      <input
                        className="w-full rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138052] focus:ring-2 focus:ring-[#138052]/15"
                        onChange={(event) => updateConfig('database', event.target.value)}
                        placeholder="bookmark_atlas"
                        type="text"
                        value={config.database}
                      />
                    </label>

                    {/* 用户名行：左侧标签与说明，右侧输入框。 */}
                    <label className="flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-white p-3 md:flex-row md:items-center md:gap-4">
                      <span className="shrink-0 md:w-64">
                        <span className="block text-sm font-medium text-slate-700">Username</span>
                        <span className="mt-1 block text-xs text-slate-500">同步账号用户名，留空表示不使用账号认证。</span>
                      </span>
                      <input
                        autoComplete="username"
                        className="w-full rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138052] focus:ring-2 focus:ring-[#138052]/15"
                        onChange={(event) => updateConfig('username', event.target.value)}
                        type="text"
                        value={config.username}
                      />
                    </label>

                    {/* 密码行：左侧标签与说明，右侧输入框。 */}
                    <label className="flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-white p-3 md:flex-row md:items-center md:gap-4">
                      <span className="shrink-0 md:w-64">
                        <span className="block text-sm font-medium text-slate-700">Password</span>
                        <span className="mt-1 block text-xs text-slate-500">同步账号密码，仅在本地保存并用于连接时认证。</span>
                      </span>
                      <input
                        autoComplete="current-password"
                        className="w-full rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138052] focus:ring-2 focus:ring-[#138052]/15"
                        onChange={(event) => updateConfig('password', event.target.value)}
                        type="password"
                        value={config.password}
                      />
                    </label>
                  </div>
                </section>

                {/* 同步策略卡片：控制同步频率、方向与冲突处理。 */}
                <section className="rounded-[12px] border border-slate-200 bg-[#EFF3F7]/45 p-4">
                  <h3 className="text-base font-semibold text-slate-800">同步策略</h3>
                  <p className="mt-1 text-sm text-slate-500">根据网络和协作场景设置同步节奏与数据冲突处理方式。</p>
                  <div className="mt-4 space-y-3">
                    {/* 同步间隔行：左侧标签与说明，右侧输入框。 */}
                    <label className="flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-white p-3 md:flex-row md:items-center md:gap-4">
                      <span className="shrink-0 md:w-64">
                        <span className="block text-sm font-medium text-slate-700">同步间隔（分钟）</span>
                        <span className="mt-1 block text-xs text-slate-500">最小 1 分钟；数值越小，数据越实时但请求更频繁。</span>
                      </span>
                      <input
                        className="w-full rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138052] focus:ring-2 focus:ring-[#138052]/15"
                        min={1}
                        onChange={(event) => updateConfig('syncIntervalMin', Number(event.target.value) || 1)}
                        type="number"
                        value={config.syncIntervalMin}
                      />
                    </label>

                    {/* 同步模式行：左侧标签与说明，右侧下拉框。 */}
                    <label className="flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-white p-3 md:flex-row md:items-center md:gap-4">
                      <span className="shrink-0 md:w-64">
                        <span className="block text-sm font-medium text-slate-700">同步模式</span>
                        <span className="mt-1 block text-xs text-slate-500">`two-way` 双向，`push-only` 仅上传，`pull-only` 仅下载。</span>
                      </span>
                      <select
                        className="w-full rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138052] focus:ring-2 focus:ring-[#138052]/15"
                        onChange={(event) => updateConfig('syncMode', event.target.value as SyncConfig['syncMode'])}
                        value={config.syncMode}
                      >
                        <option value="two-way">two-way</option>
                        <option value="push-only">push-only</option>
                        <option value="pull-only">pull-only</option>
                      </select>
                    </label>

                    {/* 冲突策略行：左侧标签与说明，右侧下拉框。 */}
                    <label className="flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-white p-3 md:flex-row md:items-center md:gap-4">
                      <span className="shrink-0 md:w-64">
                        <span className="block text-sm font-medium text-slate-700">冲突策略</span>
                        <span className="mt-1 block text-xs text-slate-500">推荐 `latest-write-wins`，也可强制本地或远端优先。</span>
                      </span>
                      <select
                        className="w-full rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#138052] focus:ring-2 focus:ring-[#138052]/15"
                        onChange={(event) =>
                          updateConfig('conflictPolicy', event.target.value as SyncConfig['conflictPolicy'])
                        }
                        value={config.conflictPolicy}
                      >
                        <option value="latest-write-wins">latest-write-wins</option>
                        <option value="prefer-local">prefer-local</option>
                        <option value="prefer-remote">prefer-remote</option>
                      </select>
                    </label>
                  </div>
                </section>

                {/* 安全与自动化卡片：控制同步触发时机与连接安全校验。 */}
                <section className="rounded-[12px] border border-slate-200 bg-[#EFF3F7]/45 p-4">
                  <h3 className="text-base font-semibold text-slate-800">安全与自动化</h3>
                  <p className="mt-1 text-sm text-slate-500">建议在生产环境开启 HTTPS 校验，并按需开启自动同步。</p>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {/* 自动同步：本地书签变化后自动触发一次增量同步。 */}
                    <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-slate-200 bg-white px-3 py-3">
                      <input
                        checked={config.autoSyncOnChange}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#138052] focus:ring-[#138052]/30"
                        onChange={(event) => updateConfig('autoSyncOnChange', event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-700">书签变更后自动同步</span>
                        <span className="mt-1 block text-xs text-slate-500">开启后在新增、删除、移动书签后自动调度同步。</span>
                      </span>
                    </label>

                    {/* SSL 校验：控制是否校验证书合法性，保障传输安全。 */}
                    <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-slate-200 bg-white px-3 py-3">
                      <input
                        checked={config.verifySSL}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#138052] focus:ring-[#138052]/30"
                        onChange={(event) => updateConfig('verifySSL', event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-700">验证 HTTPS 证书</span>
                        <span className="mt-1 block text-xs text-slate-500">关闭仅用于自签证书测试环境，正式环境请保持开启。</span>
                      </span>
                    </label>
                  </div>
                </section>
              </div>
            </section>
          ) : activeTab === 'shortcuts' ? (
            <section>
              {/* 快捷键区：展示当前生效值，并引导到浏览器原生页面进行修改 */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">快捷键设置</h2>
                  <p className="text-sm text-slate-500">展示当前快捷键，修改请使用浏览器原生快捷键设置页面。</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-[#138052]/40 px-3 py-1.5 text-sm font-medium text-[#138052] transition hover:bg-[#138052]/10"
                    onClick={() => void loadShortcutCommands()}
                    type="button"
                  >
                    刷新列表
                  </button>
                  <button
                    className="rounded-lg bg-[#138052] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#106b45]"
                    onClick={() => void goToShortcutSettings()}
                    type="button"
                  >
                    去浏览器设置
                  </button>
                </div>
              </div>

              <div className="mb-3 rounded-box border border-base-300 bg-base-200/40 p-3 text-sm text-base-content/80">
                Firefox 将打开 <span className="font-mono">about:addons</span>；Chrome 将打开
                <span className="font-mono"> chrome://extensions/shortcuts</span>。
              </div>

              {shortcutError ? <div className="alert alert-error mb-3 text-sm">{shortcutError}</div> : null}
              {shortcutNavError ? <div className="alert alert-error mb-3 text-sm">{shortcutNavError}</div> : null}

              <div className="overflow-x-auto rounded-box border border-base-300">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>功能</th>
                      <th>命令</th>
                      <th>当前快捷键</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shortcutCommands.map((command) => (
                      <tr key={command.name}>
                        <td>
                          <div className="font-medium">{getCommandDisplayName(command.name)}</div>
                          <div className="text-xs text-base-content/60">{command.description}</div>
                        </td>
                        <td className="font-mono text-xs">{command.name}</td>
                        <td>{command.shortcut}</td>
                      </tr>
                    ))}
                    {shortcutCommands.length === 0 ? (
                      <tr>
                        <td className="text-sm text-base-content/70" colSpan={3}>
                          暂无命令信息
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section>
              {/* 关于页头图：突出产品品牌信息与定位说明。 */}
              <header className="mb-4 rounded-[14px] border border-[#138052]/20 bg-gradient-to-br from-[#138052]/10 via-white to-[#EFF3F7] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#138052]">About</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-800">{productName}</h2>
                <p className="mt-2 text-sm text-slate-600">本扩展用于高效管理书签并提供快速检索与同步能力。</p>
              </header>

              {/* 关于信息卡：展示产品名、版本、作者与开源地址。 */}
              <div className="rounded-[14px] border border-slate-200 bg-[#EFF3F7]/45 p-4">
                <div className="space-y-3 rounded-[12px] border border-slate-200 bg-white p-4">
                  {/* 产品名信息行：展示当前扩展名称。 */}
                  <div className="flex flex-col gap-1 border-b border-slate-100 pb-3 md:flex-row md:items-center md:justify-between">
                    <span className="text-sm font-medium text-slate-500">产品信息名</span>
                    <span className="text-sm font-semibold text-slate-800">{productName}</span>
                  </div>
                  {/* 版本号信息行：展示当前运行版本。 */}
                  <div className="flex flex-col gap-1 border-b border-slate-100 pb-3 md:flex-row md:items-center md:justify-between">
                    <span className="text-sm font-medium text-slate-500">版本号</span>
                    <span className="text-sm font-semibold text-slate-800">v{productVersion}</span>
                  </div>
                  {/* 作者信息行：展示作者署名。 */}
                  <div className="flex flex-col gap-1 border-b border-slate-100 pb-3 md:flex-row md:items-center md:justify-between">
                    <span className="text-sm font-medium text-slate-500">作者</span>
                    <span className="text-sm font-semibold text-slate-800">李炎</span>
                  </div>
                  {/* GitHub 信息行：提供项目仓库链接。 */}
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <span className="text-sm font-medium text-slate-500">GitHub</span>
                    <a
                      className="text-sm font-medium text-[#138052] underline decoration-[#138052]/40 underline-offset-4 transition hover:text-[#106b45]"
                      href="https://github.com/hi-liyan/bookmark-atlas-extension"
                      rel="noreferrer"
                      target="_blank"
                    >
                      https://github.com/hi-liyan/bookmark-atlas-extension
                    </a>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
};
