import { create } from 'zustand';
import { browser } from '../shared/browser';
import type { BookmarkIndexItem, BookmarkNode, RuntimeRequest, RuntimeResponse } from '../shared/types';
import {
  appendBookmarkOptimistically,
  appendFolderOptimistically,
  applyBookmarkDeleteOptimistically,
  applyBookmarkEditOptimistically,
  applyBookmarkMoveOptimistically,
  buildFolderPathMap,
  removeBookmarksInFoldersOptimistically,
  removeFolderSubtreeOptimistically,
  renameFolderOptimistically,
  replaceBookmarkOptimistically,
  replaceFolderOptimistically
} from './index-items';
import { ROOT_FOLDER_ID } from './view-model';

interface PopupState {
  tree: BookmarkNode[];
  items: BookmarkIndexItem[];
  query: string;
  selectedFolderId: string;
  loading: boolean;
  moving: boolean;
  error: string;
  load: () => Promise<void>;
  setQuery: (value: string) => void;
  setSelectedFolderId: (folderId: string) => void;
  moveBookmark: (bookmarkId: string, parentId: string) => Promise<boolean>;
  createFolder: (parentId: string, title: string) => Promise<string | null>;
  createBookmark: (parentId: string, title: string, url: string) => Promise<boolean>;
  deleteFolder: (folderId: string) => Promise<boolean>;
  renameFolder: (folderId: string, title: string) => Promise<boolean>;
  updateBookmark: (bookmarkId: string, title: string, url: string) => Promise<boolean>;
  deleteBookmark: (bookmarkId: string) => Promise<boolean>;
}

/**
 * 统一封装 popup 到 background 的消息请求，避免页面层散落 API 细节。
 * 入参：运行时请求对象。
 * 出参：运行时响应对象。
 */
const request = async (message: RuntimeRequest): Promise<RuntimeResponse> => {
  const response = (await browser.runtime.sendMessage(message)) as RuntimeResponse;
  return response;
};

/**
 * 生成用于乐观更新的临时 ID，避免创建动作在响应前无法定位占位节点。
 * 入参：前缀。
 * 出参：唯一临时 ID。
 */
const createTempId = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const usePopupStore = create<PopupState>((set, get) => ({
  tree: [],
  items: [],
  query: '',
  selectedFolderId: ROOT_FOLDER_ID,
  loading: false,
  moving: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });

    try {
      const [treeResponse, indexResponse] = await Promise.all([
        request({ type: 'bookmarks/get-tree' }),
        request({ type: 'bookmarks/get-index' })
      ]);

      if (!treeResponse.ok || !('tree' in treeResponse)) {
        throw new Error(treeResponse.ok ? 'Invalid tree response.' : treeResponse.error);
      }

      if (!indexResponse.ok || !('index' in indexResponse)) {
        throw new Error(indexResponse.ok ? 'Invalid index response.' : indexResponse.error);
      }

      set({ tree: treeResponse.tree, items: indexResponse.index.items, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load bookmarks.';
      set({ error: message, loading: false });
    }
  },

  setQuery: (value: string) => {
    set({ query: value });
  },

  setSelectedFolderId: (folderId: string) => {
    set({ selectedFolderId: folderId });
  },

  moveBookmark: async (bookmarkId: string, parentId: string) => {
    set({ moving: true, error: '' });

    const previousItems = get().items;
    const currentTree = get().tree;

    set({
      items: applyBookmarkMoveOptimistically(previousItems, currentTree, bookmarkId, parentId)
    });

    try {
      const response = await request({
        type: 'bookmarks/move',
        bookmarkId,
        parentId
      });

      if (!response.ok) {
        throw new Error(response.error);
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move bookmark.';
      // 后端失败时回滚乐观更新，避免列表路径与真实数据不一致。
      set({ items: previousItems, error: message });
      return false;
    } finally {
      set({ moving: false });
    }
  },

  createFolder: async (parentId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      set({ error: '目录名称不能为空。' });
      return null;
    }

    set({ moving: true, error: '' });

    const previousTree = get().tree;
    const previousSelectedFolderId = get().selectedFolderId;
    const tempId = createTempId('__temp-folder');

    set({
      tree: appendFolderOptimistically(previousTree, {
        id: tempId,
        parentId,
        title: trimmedTitle
      })
    });

    try {
      const response = await request({
        type: 'bookmarks/create-folder',
        parentId,
        title: trimmedTitle
      });

      if (!response.ok) {
        throw new Error(response.error);
      }
      if (!('created' in response)) {
        throw new Error('Invalid create-folder response.');
      }

      const nextSelectedFolderId =
        get().selectedFolderId === tempId ? response.created.id : get().selectedFolderId;

      set({
        tree: replaceFolderOptimistically(get().tree, tempId, response.created),
        selectedFolderId: nextSelectedFolderId
      });
      return response.created.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create folder.';
      set({ tree: previousTree, selectedFolderId: previousSelectedFolderId, error: message });
      return null;
    } finally {
      set({ moving: false });
    }
  },

  createBookmark: async (parentId: string, title: string, url: string) => {
    const trimmedTitle = title.trim();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      set({ error: '书签 URL 不能为空。' });
      return false;
    }

    set({ moving: true, error: '' });

    const previousItems = get().items;
    const currentTree = get().tree;
    const folderPathMap = buildFolderPathMap(currentTree);
    const tempId = createTempId('__temp-bookmark');

    set({
      items: appendBookmarkOptimistically(previousItems, {
        id: tempId,
        title: trimmedTitle,
        url: trimmedUrl,
        parentId,
        path: folderPathMap.get(parentId) ?? []
      })
    });

    try {
      const response = await request({
        type: 'bookmarks/create-bookmark',
        parentId,
        title: trimmedTitle,
        url: trimmedUrl
      });

      if (!response.ok) {
        throw new Error(response.error);
      }
      if (!('created' in response)) {
        throw new Error('Invalid create-bookmark response.');
      }

      const latestPathMap = buildFolderPathMap(get().tree);
      set({
        items: replaceBookmarkOptimistically(get().items, tempId, {
          id: response.created.id,
          title: response.created.title,
          url: response.created.url,
          parentId: response.created.parentId ?? parentId,
          path: latestPathMap.get(response.created.parentId ?? parentId) ?? []
        })
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create bookmark.';
      set({ items: previousItems, error: message });
      return false;
    } finally {
      set({ moving: false });
    }
  },

  deleteFolder: async (folderId: string) => {
    if (folderId === ROOT_FOLDER_ID) {
      set({ error: '根目录不支持删除。' });
      return false;
    }

    set({ moving: true, error: '' });

    const previousTree = get().tree;
    const previousItems = get().items;
    const previousSelectedFolderId = get().selectedFolderId;
    const { nextTree, removedFolderIds } = removeFolderSubtreeOptimistically(previousTree, folderId);

    const nextSelectedFolderId = removedFolderIds.has(previousSelectedFolderId)
      ? ROOT_FOLDER_ID
      : previousSelectedFolderId;

    set({
      tree: nextTree,
      items: removeBookmarksInFoldersOptimistically(previousItems, removedFolderIds),
      selectedFolderId: nextSelectedFolderId
    });

    try {
      const response = await request({ type: 'bookmarks/delete-folder', folderId });
      if (!response.ok) {
        throw new Error(response.error);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete folder.';
      set({
        tree: previousTree,
        items: previousItems,
        selectedFolderId: previousSelectedFolderId,
        error: message
      });
      return false;
    } finally {
      set({ moving: false });
    }
  },

  /**
   * 重命名目录：本地先行乐观更新，失败时回滚。
   */
  renameFolder: async (folderId: string, title: string) => {
    if (folderId === ROOT_FOLDER_ID) {
      set({ error: '根目录不支持重命名' });
      return false;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      set({ error: '目录名称不能为空' });
      return false;
    }

    set({ moving: true, error: '' });

    const previousTree = get().tree;
    set({
      tree: renameFolderOptimistically(previousTree, folderId, trimmedTitle)
    });

    try {
      const response = await request({
        type: 'bookmarks/rename-folder',
        folderId,
        title: trimmedTitle
      });
      if (!response.ok) {
        throw new Error(response.error);
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename folder.';
      // \u540e\u7aef\u5931\u8d25\u65f6\u56de\u6eda\u76ee\u5f55\u6811\uff0c\u907f\u514d\u76ee\u5f55\u540d\u4e0e\u771f\u5b9e\u6570\u636e\u957f\u671f\u4e0d\u4e00\u81f4\u3002
      set({ tree: previousTree, error: message });
      return false;
    } finally {
      set({ moving: false });
    }
  },

  updateBookmark: async (bookmarkId: string, title: string, url: string) => {
    set({ moving: true, error: '' });

    const previousItems = get().items;
    set({
      items: applyBookmarkEditOptimistically(previousItems, {
        bookmarkId,
        title,
        url
      })
    });

    try {
      const response = await request({
        type: 'bookmarks/update',
        bookmarkId,
        title,
        url
      });
      if (!response.ok) {
        throw new Error(response.error);
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update bookmark.';
      // 后端失败时回滚本地乐观更新，避免界面与真实数据长期不一致。
      set({ items: previousItems, error: message });
      return false;
    } finally {
      set({ moving: false });
    }
  },

  deleteBookmark: async (bookmarkId: string) => {
    set({ moving: true, error: '' });

    const previousItems = get().items;
    set({
      items: applyBookmarkDeleteOptimistically(previousItems, bookmarkId)
    });

    try {
      const response = await request({
        type: 'bookmarks/delete',
        bookmarkId
      });
      if (!response.ok) {
        throw new Error(response.error);
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete bookmark.';
      // 后端失败时回滚本地乐观删除，保证列表与真实数据一致。
      set({ items: previousItems, error: message });
      return false;
    } finally {
      set({ moving: false });
    }
  }
}));
