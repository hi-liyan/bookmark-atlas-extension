import { describe, expect, it } from 'vitest';
import type { BookmarkIndexItem } from '../shared/types';
import { buildQuickSearchResults, clampHighlightIndex } from './quick-search-service';

/**
 * 生成快捷搜索测试数据，避免重复样板代码。
 */
const createItem = (partial: Partial<BookmarkIndexItem> & Pick<BookmarkIndexItem, 'id'>): BookmarkIndexItem => ({
  id: partial.id,
  title: partial.title ?? '',
  titleNorm: partial.titleNorm ?? '',
  url: partial.url,
  urlNorm: partial.urlNorm ?? '',
  parentId: partial.parentId,
  path: partial.path ?? []
});

describe('buildQuickSearchResults', () => {
  it('should sort title prefix match before url match', () => {
    const items: BookmarkIndexItem[] = [
      createItem({
        id: '1',
        title: 'Alpha Docs',
        titleNorm: 'alpha docs',
        url: 'https://example.com/docs',
        urlNorm: 'https://example.com/docs'
      }),
      createItem({
        id: '2',
        title: 'Reference',
        titleNorm: 'reference',
        url: 'https://alpha.example.com',
        urlNorm: 'https://alpha.example.com'
      })
    ];

    const results = buildQuickSearchResults(items, 'alpha');
    expect(results.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('should return only matched items', () => {
    const items: BookmarkIndexItem[] = [
      createItem({
        id: '1',
        title: 'Alpha Docs',
        titleNorm: 'alpha docs',
        url: 'https://alpha.example.com',
        urlNorm: 'https://alpha.example.com'
      }),
      createItem({
        id: '2',
        title: 'Gamma',
        titleNorm: 'gamma',
        url: 'https://gamma.example.com',
        urlNorm: 'https://gamma.example.com'
      })
    ];

    const results = buildQuickSearchResults(items, 'alpha');
    expect(results.map((item) => item.id)).toEqual(['1']);
  });
});

describe('clampHighlightIndex', () => {
  it('should return -1 when no result exists', () => {
    expect(clampHighlightIndex(3, 0)).toBe(-1);
  });

  it('should clamp into valid range', () => {
    expect(clampHighlightIndex(-3, 5)).toBe(0);
    expect(clampHighlightIndex(10, 5)).toBe(4);
    expect(clampHighlightIndex(2, 5)).toBe(2);
  });
});
