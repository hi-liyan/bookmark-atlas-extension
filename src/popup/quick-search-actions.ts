import { browser } from '../shared/browser';
import type { BookmarkIndexItem, RuntimeRequest, RuntimeResponse } from '../shared/types';

export interface EditBookmarkDraft {
  id: string;
  title: string;
  url: string;
}

export interface QuickSearchBookmarkOpenOptions {
  openInNewTab: boolean;
  keepQuickSearchWindowInForeground: boolean;
}

type MutationRequest =
  | { type: 'bookmarks/update'; bookmarkId: string; title: string; url: string }
  | { type: 'bookmarks/delete'; bookmarkId: string }
  | { type: 'bookmarks/rebuild-index' };

export type EditBookmarkDraftValidationResult =
  | { ok: true; title: string; url: string }
  | { ok: false; error: string };

/**
 * 请求背景页书签索引，为快捷搜索提供数据源。
 * 入参：无。
 * 出参：书签索引项数组。
 */
export const loadBookmarkItems = async (): Promise<BookmarkIndexItem[]> => {
  const response = (await browser.runtime.sendMessage({
    type: 'bookmarks/get-index'
  })) as RuntimeResponse;

  if (!response.ok || !('index' in response)) {
    throw new Error(response.ok ? 'Invalid index response.' : response.error);
  }

  return response.index.items;
};

/**
 * 请求背景页按设置打开书签，并根据配置保持快捷搜索窗口在前台。
 * 入参：书签索引项、打开行为配置。
 * 出参：Promise<void>。
 */
export const openBookmarkInNewTab = async (
  item: BookmarkIndexItem,
  options: QuickSearchBookmarkOpenOptions
): Promise<void> => {
  if (!item.url) {
    return;
  }

  const response = (await browser.runtime.sendMessage({
    type: 'quick-search/open-bookmark',
    url: item.url,
    openInNewTab: options.openInNewTab,
    keepQuickSearchWindowInForeground: options.keepQuickSearchWindowInForeground
  })) as RuntimeResponse;

  if (!response.ok) {
    throw new Error(response.error);
  }
};

/**
 * 根据书签项构建书签编辑草稿，供弹窗表单初始化。
 * 入参：书签索引项。
 * 出参：可编辑的书签草稿。
 */
export const buildEditBookmarkDraft = (item: BookmarkIndexItem): EditBookmarkDraft => ({
  id: item.id,
  title: item.title,
  url: item.url ?? ''
});

/**
 * 校验并清洗书签编辑草稿，确保提交前 URL 不为空。
 * 入参：书签编辑草稿。
 * 出参：校验结果（成功返回清洗后的 title/url，失败返回错误文案）。
 */
export const validateEditBookmarkDraft = (draft: EditBookmarkDraft): EditBookmarkDraftValidationResult => {
  const title = draft.title.trim();
  const url = draft.url.trim();
  if (!url) {
    return { ok: false, error: '书签 URL 不能为空' };
  }

  return { ok: true, title, url };
};

/**
 * 执行快捷搜索内的书签更新：先更新书签，再强制重建索引。
 * 入参：书签编辑草稿。
 * 出参：Promise<void>。
 */
export const updateBookmarkFromQuickSearch = async (draft: EditBookmarkDraft): Promise<void> => {
  const validation = validateEditBookmarkDraft(draft);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  await runMutation({
    type: 'bookmarks/update',
    bookmarkId: draft.id,
    title: validation.title,
    url: validation.url
  });
  await runMutation({ type: 'bookmarks/rebuild-index' });
};

/**
 * 执行快捷搜索内的书签删除：删除书签后重建索引，保证结果集与缓存一致。
 * 入参：书签 ID。
 * 出参：Promise<void>。
 */
export const deleteBookmarkFromQuickSearch = async (bookmarkId: string): Promise<void> => {
  await runMutation({ type: 'bookmarks/delete', bookmarkId });
  await runMutation({ type: 'bookmarks/rebuild-index' });
};

/**
 * 统一发送书签变更请求，并校验返回是否成功。
 * 入参：变更请求。
 * 出参：Promise<void>。
 */
const runMutation = async (request: MutationRequest): Promise<void> => {
  const response = (await browser.runtime.sendMessage(request as RuntimeRequest)) as RuntimeResponse;
  if (!response.ok) {
    throw new Error(response.error);
  }
};
