import { browser } from '../shared/browser';
import { buildBookmarkIndex } from '../shared/bookmark-index';
import { bookmarkService } from '../shared/bookmark-service';
import type { BookmarkIndexSnapshot, RuntimeRequest, RuntimeResponse } from '../shared/types';

const INDEX_STORAGE_KEY = 'bookmark-index-snapshot';

let cachedIndex: BookmarkIndexSnapshot | null = null;
let isRebuilding = false;

const rebuildIndex = async (): Promise<BookmarkIndexSnapshot> => {
  if (isRebuilding && cachedIndex) {
    return cachedIndex;
  }

  isRebuilding = true;
  try {
    const tree = await bookmarkService.getTree();
    const snapshot = buildBookmarkIndex(tree);
    cachedIndex = snapshot;
    await browser.storage.local.set({ [INDEX_STORAGE_KEY]: snapshot });
    return snapshot;
  } finally {
    isRebuilding = false;
  }
};

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

const scheduleRebuild = (): void => {
  void rebuildIndex();
};

browser.bookmarks.onCreated.addListener(scheduleRebuild);
browser.bookmarks.onRemoved.addListener(scheduleRebuild);
browser.bookmarks.onChanged.addListener(scheduleRebuild);
browser.bookmarks.onMoved.addListener(scheduleRebuild);

browser.runtime.onInstalled.addListener(() => {
  void rebuildIndex();
});

browser.runtime.onStartup.addListener(() => {
  void rebuildIndex();
});

browser.runtime.onMessage.addListener(
  async (request: RuntimeRequest): Promise<RuntimeResponse> => {
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
        const index = await rebuildIndex();
        return { ok: true, rebuiltAt: index.updatedAt };
      }

      return { ok: false, error: 'Unsupported request type.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  }
);
