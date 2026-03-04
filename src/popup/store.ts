import { create } from 'zustand';
import { browser } from '../shared/browser';
import type { BookmarkIndexItem, BookmarkNode, RuntimeResponse } from '../shared/types';
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
  moveBookmark: (bookmarkId: string, parentId: string) => Promise<void>;
}

/**
 * 统一封装 popup 到 background 的消息请求，避免页面层散落 API 细节。
 */
const request = async <T extends RuntimeResponse>(
  message:
    | { type: 'bookmarks/get-tree' }
    | { type: 'bookmarks/get-index' }
    | { type: 'bookmarks/move'; bookmarkId: string; parentId: string }
): Promise<T> => {
  const response = (await browser.runtime.sendMessage(message)) as T;
  return response;
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
        request<RuntimeResponse>({ type: 'bookmarks/get-tree' }),
        request<RuntimeResponse>({ type: 'bookmarks/get-index' })
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

    try {
      const response = await request<RuntimeResponse>({
        type: 'bookmarks/move',
        bookmarkId,
        parentId
      });
      if (!response.ok) {
        throw new Error(response.error);
      }

      // 移动成功后立即刷新，确保目录与列表状态一致。
      await get().load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move bookmark.';
      set({ error: message });
    } finally {
      set({ moving: false });
    }
  }
}));
