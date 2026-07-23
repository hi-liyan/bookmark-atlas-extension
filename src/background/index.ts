import { browser } from '../shared/browser';
import { buildBookmarkIndex } from '../shared/bookmark-index';
import { bookmarkService } from '../shared/bookmark-service';
import type { BookmarkIndexSnapshot, RuntimeRequest, RuntimeResponse, SyncConfig } from '../shared/types';
import { getSyncStatus, runSyncNow } from '../sync/engine';
import { createSingleFlightController } from './single-flight';

const INDEX_STORAGE_KEY = 'bookmark-index-snapshot';
const SYNC_CONFIG_STORAGE_KEY = 'sync-config';
const QUICK_SEARCH_COMMAND = 'open-quick-search';
const QUICK_SEARCH_PAGE = 'quick-search.html';
const QUICK_SEARCH_WINDOW_WIDTH = 760;
const QUICK_SEARCH_WINDOW_HEIGHT = 520;
const AUTO_SYNC_DEBOUNCE_MS = 1200;

let cachedIndex: BookmarkIndexSnapshot | null = null;
let quickSearchWindowId: number | null = null;
let quickSearchSourceWindowId: number | null = null;
let quickSearchSourceTabId: number | null = null;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 重建书签索引并写入缓存与本地存储。
 * 入参：无。
 * 出参：最新书签索引快照。
 */
const rebuildIndexController = createSingleFlightController(async (): Promise<BookmarkIndexSnapshot> => {
  const tree = await bookmarkService.getTree();
  const snapshot = buildBookmarkIndex(tree);
  cachedIndex = snapshot;
  await browser.storage.local.set({ [INDEX_STORAGE_KEY]: snapshot });
  return snapshot;
});

/**
 * 执行索引重建，并发请求会复用同一轮重建结果。
 * 入参：无。
 * 出参：最新书签索引快照。
 */
const rebuildIndex = (): Promise<BookmarkIndexSnapshot> => rebuildIndexController.run();

/**
 * 执行“新鲜重建”：若已有进行中的重建，先等待其完成，再补一轮重建。
 * 入参：无。
 * 出参：最新书签索引快照。
 */
const rebuildIndexFresh = (): Promise<BookmarkIndexSnapshot> => rebuildIndexController.runFresh();

/**
 * 获取当前可用索引：优先内存缓存，其次本地存储，最后触发重建。
 * 入参：无。
 * 出参：书签索引快照。
 */
const getIndex = async (): Promise<BookmarkIndexSnapshot> => {
  if (cachedIndex) {
    return cachedIndex;
  }

  const stored = await browser.storage.local.get(INDEX_STORAGE_KEY);
  const fromStorage = stored[INDEX_STORAGE_KEY] as BookmarkIndexSnapshot | undefined;
  if (fromStorage) {
    cachedIndex = fromStorage;
    return fromStorage;
  }

  return rebuildIndex();
};

/**
 * 异步触发索引重建，供书签事件监听复用。
 * 入参：无。
 * 出参：void。
 */
const scheduleRebuild = (): void => {
  void rebuildIndex();
};

/**
 * 从本地配置中读取同步开关与自动同步开关，用于书签事件后的后台调度。
 * 入参：无。
 * 出参：同步配置或 null。
 */
const getSyncConfig = async (): Promise<SyncConfig | null> => {
  const stored = await browser.storage.local.get(SYNC_CONFIG_STORAGE_KEY);
  const config = stored[SYNC_CONFIG_STORAGE_KEY] as SyncConfig | undefined;
  return config ?? null;
};

const runSyncController = createSingleFlightController(async () => runSyncNow());

/**
 * 在书签变更后调度一次自动同步（防抖），避免短时间高频事件触发多轮请求。
 * 入参：无。
 * 出参：void。
 */
const scheduleAutoSync = (): void => {
  if (autoSyncTimer !== null) {
    clearTimeout(autoSyncTimer);
  }

  autoSyncTimer = setTimeout(() => {
    void (async () => {
      const config = await getSyncConfig();
      if (!config || !config.syncEnabled || !config.autoSyncOnChange) {
        return;
      }

      try {
        await runSyncController.run();
      } catch {
        // 自动同步失败不阻断用户操作；失败信息会写入 sync status 供设置页展示。
      }
    })();
  }, AUTO_SYNC_DEBOUNCE_MS);
};

/**
 * 计算快捷搜索窗口的居中位置，优先相对最近聚焦浏览器窗口居中。
 * 入参：无。
 * 出参：可用于 windows.create 的 left/top 坐标及触发快捷键的浏览器窗口 ID。
 */
const getCenteredQuickSearchPosition = async (): Promise<{
  left: number;
  top: number;
  sourceWindowId: number | null;
}> => {
  try {
    const focusedWindow = await browser.windows.getLastFocused();
    const baseLeft = focusedWindow.left ?? 0;
    const baseTop = focusedWindow.top ?? 0;
    const baseWidth = focusedWindow.width ?? QUICK_SEARCH_WINDOW_WIDTH;
    const baseHeight = focusedWindow.height ?? QUICK_SEARCH_WINDOW_HEIGHT;

    // 使用最近窗口尺寸计算中心点，确保弹窗不会跑到屏幕负坐标。
    const left = Math.max(0, Math.round(baseLeft + (baseWidth - QUICK_SEARCH_WINDOW_WIDTH) / 2));
    const top = Math.max(0, Math.round(baseTop + (baseHeight - QUICK_SEARCH_WINDOW_HEIGHT) / 2));
    return { left, top, sourceWindowId: focusedWindow.id ?? null };
  } catch {
    return { left: 120, top: 120, sourceWindowId: null };
  }
};

/**
 * 获取指定浏览器窗口的当前激活标签，用于“非新标签打开”时复用原标签。
 * 入参：浏览器窗口 ID 或 null。
 * 出参：激活标签 ID 或 null。
 */
const getActiveTabId = async (windowId: number | null): Promise<number | null> => {
  if (windowId === null) {
    return null;
  }

  try {
    const [activeTab] = await browser.tabs.query({ windowId, active: true });
    return activeTab?.id ?? null;
  } catch {
    return null;
  }
};

/**
 * 打开或聚焦快捷搜索窗口，提供类 Spotlight 的全局书签搜索入口。
 * 入参：无。
 * 出参：Promise<void>。
 */
const openQuickSearchWindow = async (): Promise<void> => {
  if (quickSearchWindowId !== null) {
    try {
      await browser.windows.update(quickSearchWindowId, { focused: true });
      return;
    } catch {
      // 记录的窗口可能已被关闭；忽略错误并继续创建新窗口。
      quickSearchWindowId = null;
    }
  }

  const { left, top, sourceWindowId } = await getCenteredQuickSearchPosition();
  const created = await browser.windows.create({
    url: browser.runtime.getURL(QUICK_SEARCH_PAGE),
    type: 'popup',
    width: QUICK_SEARCH_WINDOW_WIDTH,
    height: QUICK_SEARCH_WINDOW_HEIGHT,
    left,
    top,
    focused: true
  });

  quickSearchWindowId = created.id ?? null;
  quickSearchSourceWindowId = sourceWindowId;
  quickSearchSourceTabId = await getActiveTabId(sourceWindowId);
};

/**
 * 按快捷搜索设置打开书签，并在需要时将快捷搜索窗口保持在前台。
 * 入参：待打开书签 URL、是否新标签打开、是否保持快捷搜索窗口前台。
 * 出参：Promise<void>。
 */
const openBookmarkFromQuickSearch = async (
  url: string,
  openInNewTab: boolean,
  keepQuickSearchWindowInForeground: boolean
): Promise<void> => {
  const tabCreateProperties =
    quickSearchSourceWindowId === null
      ? { url, active: !keepQuickSearchWindowInForeground }
      : { url, active: !keepQuickSearchWindowInForeground, windowId: quickSearchSourceWindowId };

  if (!openInNewTab && quickSearchSourceTabId !== null) {
    try {
      await browser.tabs.update(quickSearchSourceTabId, { url, active: true });
    } catch {
      // 来源标签可能已关闭，回退为在来源窗口新建标签以确保书签仍能打开。
      await browser.tabs.create(tabCreateProperties);
    }
  } else {
    await browser.tabs.create(tabCreateProperties);
  }

  if (!keepQuickSearchWindowInForeground || quickSearchWindowId === null) {
    return;
  }

  try {
    // 新标签创建后显式夺回焦点，保证用户可连续搜索并多次打开书签。
    await browser.windows.update(quickSearchWindowId, { focused: true });
  } catch {
    // 搜索窗口可能在创建标签期间被关闭；此时无需影响已成功创建的标签。
    quickSearchWindowId = null;
  }
};

browser.bookmarks.onCreated.addListener(() => {
  scheduleRebuild();
  scheduleAutoSync();
});
browser.bookmarks.onRemoved.addListener(() => {
  scheduleRebuild();
  scheduleAutoSync();
});
browser.bookmarks.onChanged.addListener(() => {
  scheduleRebuild();
  scheduleAutoSync();
});
browser.bookmarks.onMoved.addListener(() => {
  scheduleRebuild();
  scheduleAutoSync();
});

browser.windows.onRemoved.addListener((windowId: number) => {
  if (quickSearchWindowId === windowId) {
    quickSearchWindowId = null;
    quickSearchSourceWindowId = null;
    quickSearchSourceTabId = null;
  }
});

browser.commands.onCommand.addListener((command: string) => {
  if (command === QUICK_SEARCH_COMMAND) {
    void openQuickSearchWindow();
  }
});

browser.runtime.onInstalled.addListener(() => {
  void rebuildIndex();
});

browser.runtime.onStartup.addListener(() => {
  void rebuildIndex();
});

browser.runtime.onMessage.addListener(async (request: RuntimeRequest): Promise<RuntimeResponse> => {
  try {
    if (request.type === 'bookmarks/get-tree') {
      const tree = await bookmarkService.getTree();
      return { ok: true, tree };
    }

    if (request.type === 'bookmarks/get-index') {
      const index = await getIndex();
      return { ok: true, index };
    }

    if (request.type === 'bookmarks/rebuild-index') {
      const index = await rebuildIndexFresh();
      return { ok: true, rebuiltAt: index.updatedAt };
    }

    if (request.type === 'bookmarks/move') {
      await bookmarkService.move(request.bookmarkId, { parentId: request.parentId });
      await rebuildIndexFresh();
      return { ok: true, movedId: request.bookmarkId };
    }

    if (request.type === 'bookmarks/move-folder') {
      await bookmarkService.move(request.folderId, { parentId: request.parentId });
      await rebuildIndexFresh();
      return { ok: true, movedFolderId: request.folderId };
    }

    if (request.type === 'bookmarks/create-folder') {
      const created = await bookmarkService.create({
        parentId: request.parentId,
        title: request.title,
        type: 'folder'
      });
      await rebuildIndexFresh();
      return { ok: true, created };
    }

    if (request.type === 'bookmarks/create-bookmark') {
      const created = await bookmarkService.create({
        parentId: request.parentId,
        title: request.title,
        url: request.url,
        type: 'bookmark'
      });
      await rebuildIndexFresh();
      return { ok: true, created };
    }

    if (request.type === 'bookmarks/delete-folder') {
      await bookmarkService.removeTree(request.folderId);
      await rebuildIndexFresh();
      return { ok: true, deletedFolderId: request.folderId };
    }

    if (request.type === 'bookmarks/rename-folder') {
      await bookmarkService.update(request.folderId, {
        title: request.title
      });
      await rebuildIndexFresh();
      return { ok: true, renamedFolderId: request.folderId };
    }

    if (request.type === 'bookmarks/update') {
      await bookmarkService.update(request.bookmarkId, {
        title: request.title,
        url: request.url
      });
      await rebuildIndexFresh();
      return { ok: true, updatedId: request.bookmarkId };
    }

    if (request.type === 'bookmarks/delete') {
      await bookmarkService.remove(request.bookmarkId);
      await rebuildIndexFresh();
      return { ok: true, deletedId: request.bookmarkId };
    }

    if (request.type === 'quick-search/open-bookmark') {
      await openBookmarkFromQuickSearch(
        request.url,
        request.openInNewTab,
        request.keepQuickSearchWindowInForeground
      );
      return { ok: true, openedInNewTabUrl: request.url };
    }

    if (request.type === 'sync/get-status') {
      const syncStatus = await getSyncStatus();
      return { ok: true, syncStatus };
    }

    if (request.type === 'sync/run-now') {
      const syncResult = request.config ? await runSyncNow(request.config) : await runSyncController.runFresh();
      await rebuildIndexFresh();
      return { ok: true, syncResult };
    }

    return { ok: false, error: 'Unsupported request type.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: message };
  }
});
