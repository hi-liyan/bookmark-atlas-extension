import { normalizeText, normalizeUrl } from '../shared/normalize';
import type { BookmarkIndexItem } from '../shared/types';

export interface BookmarkEditPatch {
  bookmarkId: string;
  title: string;
  url: string;
}

/**
 * 对索引列表应用书签编辑结果，用于 UI 的乐观更新。
 * 入参：当前索引列表、编辑补丁（书签 ID/标题/URL）。
 * 出参：应用补丁后的新索引列表。
 */
export const applyBookmarkEditOptimistically = (
  items: BookmarkIndexItem[],
  patch: BookmarkEditPatch
): BookmarkIndexItem[] => {
  const nextTitle = patch.title.trim();
  const nextUrl = patch.url.trim();

  return items.map((item) => {
    if (item.id !== patch.bookmarkId) {
      return item;
    }

    return {
      ...item,
      title: nextTitle,
      url: nextUrl,
      // 编辑后同步更新归一化字段，确保搜索结果与 UI 文本一致。
      titleNorm: normalizeText(nextTitle),
      urlNorm: normalizeUrl(nextUrl)
    };
  });
};

/**
 * 对索引列表应用书签删除结果，用于 UI 的乐观更新。
 * 入参：当前索引列表、待删除书签 ID。
 * 出参：删除目标项后的新索引列表。
 */
export const applyBookmarkDeleteOptimistically = (
  items: BookmarkIndexItem[],
  bookmarkId: string
): BookmarkIndexItem[] => {
  return items.filter((item) => item.id !== bookmarkId);
};
