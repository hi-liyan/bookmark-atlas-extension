import { browser } from '../shared/browser';
import { buildBookmarkIndex } from '../shared/bookmark-index';
import { bookmarkService } from '../shared/bookmark-service';
import type { BookmarkIndexSnapshot, RuntimeRequest, RuntimeResponse } from '../shared/types';
import { createSingleFlightController } from './single-flight';

const INDEX_STORAGE_KEY = 'bookmark-index-snapshot';
const QUICK_SEARCH_COMMAND = 'open-quick-search';
const QUICK_SEARCH_PAGE = 'quick-search.html';
const QUICK_SEARCH_WINDOW_WIDTH = 760;
const QUICK_SEARCH_WINDOW_HEIGHT = 520;

let cachedIndex: BookmarkIndexSnapshot | null = null;
let quickSearchWindowId: number | null = null;

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
 * 计算快捷搜索窗口的居中位置，优先相对最近聚焦浏览器窗口居中。
 * 入参：无。
 * 出参：可用于 windows.create 的 left/top 坐标。
 */
const getCenteredQuickSearchPosition = async (): Promise<{ left: number; top: number }> => {
  try {
    const focusedWindow = await browser.windows.getLastFocused();
    const baseLeft = focusedWindow.left ?? 0;
    const baseTop = focusedWindow.top ?? 0;
    const baseWidth = focusedWindow.width ?? QUICK_SEARCH_WINDOW_WIDTH;
    const baseHeight = focusedWindow.height ?? QUICK_SEARCH_WINDOW_HEIGHT;

    // 使用最近窗口尺寸计算中心点，确保弹窗不会跑到屏幕负坐标。
    const left = Math.max(0, Math.round(baseLeft + (baseWidth - QUICK_SEARCH_WINDOW_WIDTH) / 2));
    const top = Math.max(0, Math.round(baseTop + (baseHeight - QUICK_SEARCH_WINDOW_HEIGHT) / 2));
    return { left, top };
  } catch {
    return { left: 120, top: 120 };
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

  const { left, top } = await getCenteredQuickSearchPosition();
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
};

browser.bookmarks.onCreated.addListener(scheduleRebuild);
browser.bookmarks.onRemoved.addListener(scheduleRebuild);
browser.bookmarks.onChanged.addListener(scheduleRebuild);
browser.bookmarks.onMoved.addListener(scheduleRebuild);

browser.windows.onRemoved.addListener((windowId: number) => {
  if (quickSearchWindowId === windowId) {
    quickSearchWindowId = null;
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

    return { ok: false, error: 'Unsupported request type.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: message };
  }
});
