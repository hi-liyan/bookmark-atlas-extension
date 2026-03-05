import type { BookmarkIndexItem } from '../shared/types';
import { applyBookmarkEditOptimistically } from './index-items';

/**
 * 构造测试用书签项，避免每个用例重复声明基础字段。
 * 入参：需要覆盖的字段。
 * 出参：完整书签索引项。
 */
const createItem = (overrides: Partial<BookmarkIndexItem>): BookmarkIndexItem => ({
  id: 'bookmark-1',
  title: 'Alpha',
  titleNorm: 'alpha',
  url: 'https://example.com/alpha',
  urlNorm: 'example.com/alpha',
  parentId: 'folder-1',
  path: ['目录'],
  ...overrides
});

describe('applyBookmarkEditOptimistically', () => {
  it('should update title/url and normalized fields for target bookmark', () => {
    const items: BookmarkIndexItem[] = [
      createItem({ id: '1', title: 'Old', titleNorm: 'old', url: 'https://old.com', urlNorm: 'old.com' }),
      createItem({ id: '2', title: 'Keep', titleNorm: 'keep', url: 'https://keep.com', urlNorm: 'keep.com' })
    ];

    const nextItems = applyBookmarkEditOptimistically(items, {
      bookmarkId: '1',
      title: '  New Title  ',
      url: ' https://Example.com/new/ '
    });

    expect(nextItems[0]).toMatchObject({
      id: '1',
      title: 'New Title',
      titleNorm: 'new title',
      url: 'https://Example.com/new/',
      urlNorm: 'example.com/new'
    });
    expect(nextItems[1]).toEqual(items[1]);
  });

  it('should keep original array items when bookmark id is not found', () => {
    const items: BookmarkIndexItem[] = [createItem({ id: '1' })];

    const nextItems = applyBookmarkEditOptimistically(items, {
      bookmarkId: 'missing',
      title: 'No Change',
      url: 'https://none.com'
    });

    expect(nextItems).toEqual(items);
  });
});