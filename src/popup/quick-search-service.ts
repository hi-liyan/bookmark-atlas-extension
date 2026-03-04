import { normalizeText, normalizeUrl } from '../shared/normalize';
import type { BookmarkIndexItem } from '../shared/types';

const DEFAULT_LIMIT = 20;

/**
 * 计算单条书签与查询词的匹配分值，用于排序。
 * 入参：书签索引项、已归一化查询词。
 * 出参：分值；0 表示不匹配。
 */
const scoreItem = (item: BookmarkIndexItem, queryNorm: string): number => {
  if (!queryNorm) {
    return 1;
  }

  const titleNorm = item.titleNorm;
  const urlNorm = item.urlNorm || normalizeUrl(item.url);

  if (titleNorm.startsWith(queryNorm)) {
    return 120;
  }
  if (titleNorm.includes(queryNorm)) {
    return 90;
  }
  if (urlNorm.startsWith(queryNorm)) {
    return 70;
  }
  if (urlNorm.includes(queryNorm)) {
    return 50;
  }

  return 0;
};

/**
 * 构建快捷搜索结果列表：先过滤匹配项，再按分值与标题稳定排序。
 * 入参：书签索引项数组、原始查询词、返回上限。
 * 出参：可直接展示的搜索结果。
 */
export const buildQuickSearchResults = (
  items: BookmarkIndexItem[],
  query: string,
  limit = DEFAULT_LIMIT
): BookmarkIndexItem[] => {
  const queryNorm = normalizeText(query);

  const ranked = items
    .map((item) => ({ item, score: scoreItem(item, queryNorm) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      // 同分时使用标题字典序，保证键盘上下移动体验稳定可预测。
      return left.item.title.localeCompare(right.item.title, 'zh-CN');
    })
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.item);

  return ranked;
};

/**
 * 约束高亮索引，避免越界访问结果数组。
 * 入参：目标索引、当前结果数量。
 * 出参：可用索引；结果为空时返回 -1。
 */
export const clampHighlightIndex = (index: number, total: number): number => {
  if (total <= 0) {
    return -1;
  }

  if (index < 0) {
    return 0;
  }

  if (index >= total) {
    return total - 1;
  }

  return index;
};
