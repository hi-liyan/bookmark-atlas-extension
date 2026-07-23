import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkIndexItem } from '../shared/types';

const mockedBrowser = vi.hoisted(() => ({
  sendMessage: vi.fn()
}));

vi.mock('../shared/browser', () => ({
  browser: {
    runtime: {
      sendMessage: mockedBrowser.sendMessage
    }
  }
}));

import { buildEditTagDraft, openBookmarkInNewTab, validateEditTagDraft } from './quick-search-actions';
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

afterEach(() => {
  mockedBrowser.sendMessage.mockReset();
});

describe('openBookmarkInNewTab', () => {
  it('should ask the background page to open a tab while preserving the quick search foreground state', async () => {
    mockedBrowser.sendMessage.mockResolvedValue({
      ok: true,
      openedInNewTabUrl: 'https://example.com/open'
    });
    const item = createItem({
      id: 'bookmark-open',
      title: 'Open target',
      url: 'https://example.com/open'
    });

    await openBookmarkInNewTab(item, {
      openInNewTab: true,
      keepQuickSearchWindowInForeground: true
    });

    expect(mockedBrowser.sendMessage).toHaveBeenCalledWith({
      type: 'quick-search/open-bookmark',
      url: 'https://example.com/open',
      openInNewTab: true,
      keepQuickSearchWindowInForeground: true
    });
  });

  it('should skip bookmarks without a URL', async () => {
    await openBookmarkInNewTab(
      createItem({
        id: 'bookmark-without-url',
        title: 'No URL'
      }),
      {
        openInNewTab: false,
        keepQuickSearchWindowInForeground: false
      }
    );

    expect(mockedBrowser.sendMessage).not.toHaveBeenCalled();
  });
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
