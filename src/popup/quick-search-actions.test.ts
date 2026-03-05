import { describe, expect, it } from 'vitest';
import type { BookmarkIndexItem } from '../shared/types';
import { buildEditTagDraft, validateEditTagDraft } from './quick-search-actions';

/**
 * 构造标签草稿测试用书签，避免重复样板。
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

describe('buildEditTagDraft', () => {
  it('should build draft from bookmark item', () => {
    const item = createItem({
      id: 'bookmark-1',
      title: 'Alpha',
      url: 'https://example.com/alpha'
    });

    const draft = buildEditTagDraft(item);
    expect(draft).toEqual({
      id: 'bookmark-1',
      title: 'Alpha',
      url: 'https://example.com/alpha'
    });
  });

  it('should fallback url to empty string when bookmark has no url', () => {
    const item = createItem({
      id: 'bookmark-2',
      title: 'Folder like item'
    });

    const draft = buildEditTagDraft(item);
    expect(draft.url).toBe('');
  });
});

describe('validateEditTagDraft', () => {
  it('should trim title and url when draft is valid', () => {
    const result = validateEditTagDraft({
      id: 'bookmark-3',
      title: '  Alpha Docs  ',
      url: '  https://example.com/docs  '
    });

    expect(result).toEqual({
      ok: true,
      title: 'Alpha Docs',
      url: 'https://example.com/docs'
    });
  });

  it('should reject empty url draft', () => {
    const result = validateEditTagDraft({
      id: 'bookmark-4',
      title: 'No URL',
      url: '   '
    });

    expect(result).toEqual({
      ok: false,
      error: '标签 URL 不能为空'
    });
  });
});