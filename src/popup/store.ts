import { create } from 'zustand';
import { browser } from '../shared/browser';
import type { BookmarkIndexItem, BookmarkNode, RuntimeResponse } from '../shared/types';
import { normalizeText, normalizeUrl } from '../shared/normalize';

interface PopupState {
  tree: BookmarkNode[];
  items: BookmarkIndexItem[];
  query: string;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  setQuery: (value: string) => void;
}

const request = async <T extends RuntimeResponse>(type: 'bookmarks/get-tree' | 'bookmarks/get-index'): Promise<T> => {
  const response = (await browser.runtime.sendMessage({ type })) as T;
  return response;
};

const matches = (item: BookmarkIndexItem, query: string): boolean => {
  if (!query) {
    return true;
  }

  const queryNorm = normalizeText(query);
  return item.titleNorm.includes(queryNorm) || normalizeUrl(item.url).includes(queryNorm);
};

export const usePopupStore = create<PopupState>((set, get) => ({
  tree: [],
  items: [],
  query: '',
  loading: false,
  error: '',
  load: async () => {
    set({ loading: true, error: '' });

    try {
      const [treeResponse, indexResponse] = await Promise.all([
        request<RuntimeResponse>('bookmarks/get-tree'),
        request<RuntimeResponse>('bookmarks/get-index')
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
  }
}));

export const useFilteredItems = (): BookmarkIndexItem[] => {
  const { items, query } = usePopupStore.getState();
  return items.filter((item) => matches(item, query));
};
