import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { browser } from '../shared/browser';
import {
  defaultQuickSearchConfig,
  normalizeQuickSearchConfig,
  QUICK_SEARCH_CONFIG_STORAGE_KEY
} from '../shared/quick-search-config';
import type { QuickSearchConfig, RuntimeResponse, SyncConfig, SyncStatus } from '../shared/types';
import { testCouchDbConnection, validateConnectionConfig, validateSyncConfigCompleteness } from '../sync';

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

const defaultSyncStatus: SyncStatus = {
  running: false,
  lastSyncAt: null,
  lastSuccessAt: null,
  lastError: '',
  lastSyncSeq: '0',
  lastMode: null,
  lastLocalSnapshotAt: 0,
  pushedCount: 0,
  pulledCount: 0,
  retryCount: 0
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

type SyncConnectionStatus = 'idle' | 'testing' | 'success' | 'error';
type OptionsTab = 'quick-search' | 'sync' | 'shortcuts' | 'about';

/**
 * 将时间戳格式化为便于阅读的本地时间文本。
 * 入参：时间戳（毫秒）或 null。
 * 出参：格式化文本。
 */
const formatTime = (timestamp: number | null): string => {
  if (!timestamp) {
    return '暂无';
  }

  return new Date(timestamp).toLocaleString();
};

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
  // 当前激活 tab：控制设置页快速搜索、同步、快捷键与关于区域的显示。
  const [activeTab, setActiveTab] = useState<OptionsTab>('quick-search');
  // 扩展基础信息：品牌名仅用于 UI 展示，版本号仍从 manifest 读取以保持与构建产物一致。
  const manifestInfo = browser.runtime.getManifest();
  const productName = '快书签';
  const productSlogan = 'Find it. Open it. Instantly.';
  const productVersion = manifestInfo.version || '-';
  const [config, setConfig] = useState<SyncConfig>(defaultConfig);
  // 快捷搜索配置：独立于同步设置存储，避免无关配置相互影响。
  const [quickSearchConfig, setQuickSearchConfig] = useState<QuickSearchConfig>(defaultQuickSearchConfig);
  const [savedMessage, setSavedMessage] = useState('');
  const [shortcutCommands, setShortcutCommands] = useState<ShortcutCommandView[]>([]);
  const [shortcutError, setShortcutError] = useState('');
  const [shortcutNavError, setShortcutNavError] = useState('');
  // 同步错误提示：用于展示启用同步前的校验失败原因。
  const [syncValidationError, setSyncValidationError] = useState('');
  // 连接测试状态：控制测试按钮禁用与结果提示样式。
  const [syncConnectionStatus, setSyncConnectionStatus] = useState<SyncConnectionStatus>('idle');
  // 连接测试信息：展示“测试连接”或启用流程中的连通性结果。
  const [syncConnectionMessage, setSyncConnectionMessage] = useState('');
  // 同步状态快照：展示最近同步时间、序列号与错误信息。
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(defaultSyncStatus);
  // 立即同步执行状态：避免重复点击并反馈处理中状态。
  const [syncRunning, setSyncRunning] = useState(false);
  // 立即同步消息：展示本次执行结果（成功/失败）。
  const [syncRunMessage, setSyncRunMessage] = useState('');
  const updateConfig = createConfigUpdater(setConfig);

  useEffect(() => {
    void (async () => {
      const stored = await browser.storage.local.get([STORAGE_KEY, QUICK_SEARCH_CONFIG_STORAGE_KEY]);
      const value = stored[STORAGE_KEY] as SyncConfig | undefined;
      if (value) {
        setConfig(value);
      }
      setQuickSearchConfig(normalizeQuickSearchConfig(stored[QUICK_SEARCH_CONFIG_STORAGE_KEY]));
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
   * 从 background 拉取最新同步状态，用于刷新状态面板。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const loadSyncStatus = async (): Promise<void> => {
    const response = (await browser.runtime.sendMessage({ type: 'sync/get-status' })) as RuntimeResponse;
    if (response.ok && 'syncStatus' in response) {
      setSyncStatus(response.syncStatus);
      return;
    }

    if (!response.ok) {
      setSyncRunMessage(`读取同步状态失败：${response.error}`);
    }
  };

  useEffect(() => {
    void loadSyncStatus();
  }, []);

  useEffect(() => {
    if (activeTab !== 'sync') {
      return;
    }

    // 同步状态轮询：同步过程中定期拉取后台状态，保证“同步中/完成”展示及时刷新。
    const timer = setInterval(() => {
      void loadSyncStatus();
    }, 3000);

    return () => {
      clearInterval(timer);
    };
  }, [activeTab]);

  /**
   * 保存同步与快速搜索配置到本地存储。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const save = async (): Promise<void> => {
    await browser.storage.local.set({
      [STORAGE_KEY]: config,
      [QUICK_SEARCH_CONFIG_STORAGE_KEY]: quickSearchConfig
    });
    setSavedMessage('设置已保存');
    setTimeout(() => setSavedMessage(''), 1500);
  };

  /**
   * 手动执行立即同步：使用当前表单配置触发 background 同步引擎。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const runSyncNow = async (): Promise<void> => {
    const issues = validateSyncConfigCompleteness(config);
    if (issues.length > 0) {
      setSyncValidationError(issues[0]);
      return;
    }

    if (!config.syncEnabled) {
      setSyncValidationError('请先启用同步开关后再执行立即同步。');
      return;
    }

    setSyncValidationError('');
    setSyncRunning(true);
    setSyncRunMessage('正在执行同步...');

    try {
      // 立即同步使用当前页面草稿配置，避免用户忘记点“保存设置”导致参数不一致。
      const response = (await browser.runtime.sendMessage({
        type: 'sync/run-now',
        config
      })) as RuntimeResponse;

      if (!response.ok) {
        throw new Error(response.error);
      }

      if (!('syncResult' in response)) {
        throw new Error('同步响应格式错误。');
      }

      setSyncRunMessage(
        `同步完成：模式 ${response.syncResult.mode}，推送 ${response.syncResult.pushedCount}，拉取 ${response.syncResult.pulledCount}，重试 ${response.syncResult.retryCount}。`
      );
      await loadSyncStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : '立即同步失败';
      setSyncRunMessage(`同步失败：${message}`);
      await loadSyncStatus();
    } finally {
      setSyncRunning(false);
    }
  };

  /**
   * 执行连接测试并更新连接状态文案。
   * 入参：无。
   * 出参：Promise<boolean>，true 表示连接成功。
   */
  const runConnectionTest = async (): Promise<boolean> => {
    setSyncConnectionStatus('testing');
    setSyncConnectionMessage('正在测试与 CouchDB 的连接...');
    const result = await testCouchDbConnection(config);
    setSyncConnectionStatus(result.ok ? 'success' : 'error');
    setSyncConnectionMessage(result.message);
    return result.ok;
  };

  /**
   * 处理“启用同步”开关：先校验完整性，再校验连接，全部通过才允许启用。
   * 入参：开关目标状态。
   * 出参：Promise<void>。
   */
  const handleSyncEnabledChange = async (checked: boolean): Promise<void> => {
    if (!checked) {
      updateConfig('syncEnabled', false);
      setSyncValidationError('');
      return;
    }

    const issues = validateSyncConfigCompleteness(config);
    if (issues.length > 0) {
      updateConfig('syncEnabled', false);
      setSyncValidationError(issues[0]);
      setSyncConnectionStatus('error');
      setSyncConnectionMessage('同步未启用：请先补全连接信息。');
      return;
    }

    setSyncValidationError('');
    const isConnected = await runConnectionTest();
    if (!isConnected) {
      updateConfig('syncEnabled', false);
      return;
    }

    updateConfig('syncEnabled', true);
  };

  /**
   * 手动触发“测试连接”按钮逻辑：先检查表单完整性，再进行网络测试。
   * 入参：无。
   * 出参：Promise<void>。
   */
  const handleManualConnectionTest = async (): Promise<void> => {
    const issues = validateConnectionConfig(config);
    if (issues.length > 0) {
      setSyncValidationError(issues[0]);
      setSyncConnectionStatus('error');
      setSyncConnectionMessage('请先补全连接信息，再执行测试连接。');
      return;
    }

    setSyncValidationError('');
    await runConnectionTest();
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
        {/* 顶部标题栏：展示产品品牌、宣传语和主操作按钮 */}
        <header className="rounded-[15px] border border-slate-200 bg-white p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{productName}</h1>
              <p className="text-sm text-slate-500">{productSlogan}</p>
            </div>
            {activeTab === 'sync' || activeTab === 'quick-search' ? (
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
          {/* Tab 导航区：切换快速搜索、同步、快捷键与关于四个设置分组。 */}
          <div className="mb-4 inline-flex w-fit rounded-[10px] bg-[#EFF3F7] p-1">
            <button
              className={`rounded-[8px] px-4 py-2 text-sm font-medium transition ${
                activeTab === 'quick-search'
                  ? 'bg-white text-[#138052] shadow-sm ring-1 ring-[#138052]/20'
                  : 'text-slate-600 hover:bg-white/80 hover:text-[#138052]'
              }`}
              onClick={() => setActiveTab('quick-search')}
              type="button"
            >
              快速搜索
            </button>
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

          {activeTab === 'quick-search' ? (
            <section>
              {/* 快速搜索配置总览：集中说明书签打开方式与窗口关闭策略。 */}
              <div className="rounded-[12px] border border-[#138052]/20 bg-[#138052]/5 p-4">
                <h2 className="text-lg font-semibold text-slate-800">快速搜索</h2>
                <p className="mt-1 text-sm text-slate-600">配置书签打开位置，以及普通点击和右键菜单操作后的窗口行为。</p>
                <div className="mt-4 space-y-3">
                  {/* 普通点击打开位置：决定结果列表点击或 Enter 是否在来源浏览器窗口中新建标签。 */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-slate-200 bg-white px-3 py-3">
                    <input
                      checked={quickSearchConfig.openBookmarkInNewTab}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#138052] focus:ring-[#138052]/30"
                      onChange={(event) =>
                        setQuickSearchConfig((previous) => ({
                          ...previous,
                          openBookmarkInNewTab: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-700">点击书签在新标签页打开</span>
                      <span className="mt-1 block text-xs text-slate-500">关闭后会复用快捷键触发前的浏览器标签页打开书签。</span>
                    </span>
                  </label>

                  {/* 普通点击窗口行为：决定结果列表点击或 Enter 打开书签后是否关闭搜索弹窗。 */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-slate-200 bg-white px-3 py-3">
                    <input
                      checked={quickSearchConfig.closeWindowAfterBookmarkClick}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#138052] focus:ring-[#138052]/30"
                      onChange={(event) =>
                        setQuickSearchConfig((previous) => ({
                          ...previous,
                          closeWindowAfterBookmarkClick: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-700">点击书签后关闭窗口</span>
                      <span className="mt-1 block text-xs text-slate-500">关闭后将把焦点交给已打开书签所在的浏览器窗口。</span>
                    </span>
                  </label>

                  {/* 右键菜单窗口行为：右键菜单始终新标签打开，本开关只决定打开后的窗口关闭策略。 */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-slate-200 bg-white px-3 py-3">
                    <input
                      checked={quickSearchConfig.closeWindowAfterContextMenuOpen}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#138052] focus:ring-[#138052]/30"
                      onChange={(event) =>
                        setQuickSearchConfig((previous) => ({
                          ...previous,
                          closeWindowAfterContextMenuOpen: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-700">右键新标签页打开书签后关闭窗口</span>
                      <span className="mt-1 block text-xs text-slate-500">关闭后右键菜单中的“在新标签中打开”会关闭快速搜索窗口。</span>
                    </span>
                  </label>
                </div>
              </div>
            </section>
          ) : null}

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
                    onChange={(event) => {
                      void handleSyncEnabledChange(event.target.checked);
                    }}
                    type="checkbox"
                  />
                  <span className="text-sm font-medium text-slate-700">启用同步</span>
                </label>
              </div>
              {syncValidationError ? <div className="alert alert-error mb-3 text-sm">{syncValidationError}</div> : null}
              {syncRunMessage ? <div className="alert alert-info mb-3 text-sm">{syncRunMessage}</div> : null}

              {/* 同步执行卡片：提供立即同步入口与最近状态回显。 */}
              <section className="mb-4 rounded-[12px] border border-slate-200 bg-[#EFF3F7]/45 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-800">同步执行</h3>
                    <p className="mt-1 text-sm text-slate-500">支持 `two-way / push-only / pull-only`，按当前策略执行增量同步。</p>
                  </div>
                  {/* 立即同步按钮：触发后台同步引擎并更新状态面板。 */}
                  <button
                    className="rounded-lg bg-[#138052] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#106b45] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={syncRunning || syncStatus.running}
                    onClick={() => {
                      void runSyncNow();
                    }}
                    type="button"
                  >
                    {syncRunning || syncStatus.running ? '同步中...' : '立即同步'}
                  </button>
                </div>

                {/* 同步状态信息：展示最近执行时间、模式、序列号、推拉计数与失败原因。 */}
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-500">最近同步时间：</span>
                    <span className="font-medium text-slate-800">{formatTime(syncStatus.lastSyncAt)}</span>
                  </div>
                  <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-500">最近成功时间：</span>
                    <span className="font-medium text-slate-800">{formatTime(syncStatus.lastSuccessAt)}</span>
                  </div>
                  <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-500">最近模式：</span>
                    <span className="font-medium text-slate-800">{syncStatus.lastMode || '暂无'}</span>
                  </div>
                  <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-500">lastSyncSeq：</span>
                    <span className="font-mono text-slate-800">{syncStatus.lastSyncSeq || '0'}</span>
                  </div>
                  <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-500">推送/拉取：</span>
                    <span className="font-medium text-slate-800">
                      {syncStatus.pushedCount}/{syncStatus.pulledCount}
                    </span>
                  </div>
                  <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-500">重试次数：</span>
                    <span className="font-medium text-slate-800">{syncStatus.retryCount}</span>
                  </div>
                </div>
                {syncStatus.lastError ? <div className="mt-3 text-sm text-[#b42318]">最近错误：{syncStatus.lastError}</div> : null}
              </section>

              <div className="space-y-4">
                {/* 连接信息卡片：配置同步服务地址与认证信息。 */}
                <section className="rounded-[12px] border border-slate-200 bg-[#EFF3F7]/45 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <h3 className="text-base font-semibold text-slate-800">连接信息</h3>
                    {/* 测试连接按钮：用于在保存前快速验证当前连接参数可用性。 */}
                    <button
                      className="rounded-lg border border-[#138052]/40 px-3 py-2 text-sm font-medium text-[#138052] transition hover:bg-[#138052]/10 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={syncConnectionStatus === 'testing'}
                      onClick={() => {
                        void handleManualConnectionTest();
                      }}
                      type="button"
                    >
                      {syncConnectionStatus === 'testing' ? '测试中...' : '测试连接'}
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">用于建立与 CouchDB 的连接，建议仅填写当前环境所需配置。</p>
                  {syncConnectionMessage ? (
                    <div className={`mt-3 text-sm ${syncConnectionStatus === 'success' ? 'text-[#138052]' : 'text-[#b42318]'}`}>
                      {syncConnectionMessage}
                    </div>
                  ) : null}
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
          ) : activeTab === 'about' ? (
            <section>
              {/* 关于页头图：突出产品品牌信息与定位说明。 */}
              <header className="mb-4 rounded-[14px] border border-[#138052]/20 bg-gradient-to-br from-[#138052]/10 via-white to-[#EFF3F7] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#138052]">About</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-800">{productName}</h2>
                <p className="mt-2 text-sm font-medium text-[#138052]">{productSlogan}</p>
                <p className="mt-1 text-sm text-slate-600">快速找到想要的书签，立即打开。</p>
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
                    <span className="text-sm font-semibold text-slate-800">我在火星堆雪人</span>
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
          ) : null}
        </div>
      </section>
    </main>
  );
};
