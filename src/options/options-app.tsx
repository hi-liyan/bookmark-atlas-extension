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
  const [activeTab, setActiveTab] = useState<'sync' | 'shortcuts'>('sync');
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
    <main className="min-h-screen bg-base-200 px-4 py-6 text-base-content md:px-6">
      {/* 页面主体容器：统一控制最大宽度，避免信息过宽导致阅读困难 */}
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {/* 顶部标题栏：展示设置页定位和主操作按钮 */}
        <header className="rounded-box border border-base-300 bg-base-100 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">扩展设置</h1>
              <p className="text-sm text-base-content/70">使用标签页切换同步配置和快捷键配置，减少单页拥挤。</p>
            </div>
            {activeTab === 'sync' ? (
              <div className="flex items-center gap-3">
                {savedMessage ? <span className="text-sm text-success">{savedMessage}</span> : null}
                <button className="btn btn-primary" onClick={() => void save()} type="button">
                  保存设置
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="rounded-box border border-base-300 bg-base-100 p-4 md:p-5">
          {/* Tab 导航区：切换同步与快捷键两个设置分组 */}
          <div className="tabs tabs-box mb-4 w-fit bg-base-200">
            <button
              className={`tab ${activeTab === 'sync' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('sync')}
              type="button"
            >
              同步
            </button>
            <button
              className={`tab ${activeTab === 'shortcuts' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('shortcuts')}
              type="button"
            >
              快捷键
            </button>
          </div>

          {activeTab === 'sync' ? (
            <section>
              {/* 同步配置区：通过网格分组降低输入项密度 */}
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">同步配置</h2>
                  <p className="text-sm text-base-content/70">配置 CouchDB 地址、模式和冲突策略。保存后生效。</p>
                </div>
                <label className="label cursor-pointer gap-2">
                  <span className="label-text">启用同步</span>
                  <input
                    checked={config.syncEnabled}
                    className="toggle toggle-primary"
                    onChange={(event) => updateConfig('syncEnabled', event.target.checked)}
                    type="checkbox"
                  />
                </label>
              </div>

              {/* 连接信息输入区：服务器地址、数据库与账号凭据 */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="form-control md:col-span-2">
                  <span className="label-text mb-1">Server URL</span>
                  <input
                    className="input input-bordered w-full"
                    onChange={(event) => updateConfig('serverUrl', event.target.value)}
                    placeholder="https://couchdb.example.com"
                    type="url"
                    value={config.serverUrl}
                  />
                </label>

                <label className="form-control">
                  <span className="label-text mb-1">Database</span>
                  <input
                    className="input input-bordered w-full"
                    onChange={(event) => updateConfig('database', event.target.value)}
                    type="text"
                    value={config.database}
                  />
                </label>

                <label className="form-control">
                  <span className="label-text mb-1">同步间隔（分钟）</span>
                  <input
                    className="input input-bordered w-full"
                    min={1}
                    onChange={(event) => updateConfig('syncIntervalMin', Number(event.target.value) || 1)}
                    type="number"
                    value={config.syncIntervalMin}
                  />
                </label>

                <label className="form-control">
                  <span className="label-text mb-1">Username</span>
                  <input
                    autoComplete="username"
                    className="input input-bordered w-full"
                    onChange={(event) => updateConfig('username', event.target.value)}
                    type="text"
                    value={config.username}
                  />
                </label>

                <label className="form-control">
                  <span className="label-text mb-1">Password</span>
                  <input
                    autoComplete="current-password"
                    className="input input-bordered w-full"
                    onChange={(event) => updateConfig('password', event.target.value)}
                    type="password"
                    value={config.password}
                  />
                </label>

                <label className="form-control">
                  <span className="label-text mb-1">同步模式</span>
                  <select
                    className="select select-bordered w-full"
                    onChange={(event) => updateConfig('syncMode', event.target.value as SyncConfig['syncMode'])}
                    value={config.syncMode}
                  >
                    <option value="two-way">two-way</option>
                    <option value="push-only">push-only</option>
                    <option value="pull-only">pull-only</option>
                  </select>
                </label>

                <label className="form-control">
                  <span className="label-text mb-1">冲突策略</span>
                  <select
                    className="select select-bordered w-full"
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

              {/* 同步行为开关：影响自动同步与 HTTPS 证书校验 */}
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-2">
                  <input
                    checked={config.autoSyncOnChange}
                    className="checkbox checkbox-primary"
                    onChange={(event) => updateConfig('autoSyncOnChange', event.target.checked)}
                    type="checkbox"
                  />
                  <span className="label-text">书签变更后自动同步</span>
                </label>

                <label className="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-2">
                  <input
                    checked={config.verifySSL}
                    className="checkbox checkbox-primary"
                    onChange={(event) => updateConfig('verifySSL', event.target.checked)}
                    type="checkbox"
                  />
                  <span className="label-text">验证 HTTPS 证书</span>
                </label>
              </div>
            </section>
          ) : (
            <section>
              {/* 快捷键区：展示当前生效值，并引导到浏览器原生页面进行修改 */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">快捷键设置</h2>
                  <p className="text-sm text-base-content/70">展示当前快捷键，修改请使用浏览器原生快捷键设置页面。</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn btn-sm btn-outline" onClick={() => void loadShortcutCommands()} type="button">
                    刷新列表
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => void goToShortcutSettings()} type="button">
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
          )}
        </div>
      </section>
    </main>
  );
};
