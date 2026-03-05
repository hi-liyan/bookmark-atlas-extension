import { describe, expect, it } from 'vitest';
import type { BookmarkIndexItem, BookmarkNode } from '../shared/types';
import {
  appendBookmarkOptimistically,
  appendFolderOptimistically,
  applyBookmarkDeleteOptimistically,
  applyBookmarkEditOptimistically,
  applyBookmarkMoveOptimistically,
  removeBookmarksInFoldersOptimistically,
  removeFolderSubtreeOptimistically,
  replaceBookmarkOptimistically,
  replaceFolderOptimistically
} from './index-items';

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

/**
 * 构造测试用目录节点。
 * 入参：目录 ID、标题、子节点。
 * 出参：目录类型书签节点。
 */
const createFolder = (id: string, title: string, children: BookmarkNode[] = []): BookmarkNode => ({
  id,
  title,
  type: 'folder',
  children
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

describe('applyBookmarkDeleteOptimistically', () => {
  it('should remove the target bookmark item', () => {
    const items: BookmarkIndexItem[] = [createItem({ id: '1' }), createItem({ id: '2' })];

    const nextItems = applyBookmarkDeleteOptimistically(items, '1');

    expect(nextItems.map((item) => item.id)).toEqual(['2']);
  });

  it('should keep items unchanged when target bookmark does not exist', () => {
    const items: BookmarkIndexItem[] = [createItem({ id: '1' })];

    const nextItems = applyBookmarkDeleteOptimistically(items, 'missing');

    expect(nextItems).toEqual(items);
  });
});

describe('bookmark optimistic mutations', () => {
  it('should append and replace optimistic bookmark correctly', () => {
    const items: BookmarkIndexItem[] = [createItem({ id: '1' })];

    const appended = appendBookmarkOptimistically(items, {
      id: '__temp__',
      parentId: 'folder-2',
      title: ' Temp ',
      url: ' https://temp.dev ',
      path: ['工作']
    });
    expect(appended[0]).toMatchObject({
      id: '__temp__',
      title: 'Temp',
      url: 'https://temp.dev',
      parentId: 'folder-2',
      path: ['工作']
    });

    const replaced = replaceBookmarkOptimistically(appended, '__temp__', {
      id: 'real-id',
      parentId: 'folder-3',
      title: 'Real',
      url: 'https://real.dev',
      path: ['归档']
    });
    expect(replaced[0]).toMatchObject({
      id: 'real-id',
      parentId: 'folder-3',
      path: ['归档']
    });
  });

  it('should move bookmark and refresh parent/path according to target folder', () => {
    const tree: BookmarkNode[] = [
      createFolder('0', '', [createFolder('10', 'Work', [createFolder('11', 'Project')])])
    ];
    const items: BookmarkIndexItem[] = [
      createItem({ id: '1', parentId: '10', path: ['Work'] }),
      createItem({ id: '2', parentId: '11', path: ['Work', 'Project'] })
    ];

    const nextItems = applyBookmarkMoveOptimistically(items, tree, '1', '11');
    expect(nextItems[0]).toMatchObject({
      id: '1',
      parentId: '11',
      path: ['Work', 'Project']
    });
    expect(nextItems[1]).toEqual(items[1]);
  });
});

describe('folder optimistic mutations', () => {
  it('should append folder under parent and replace temp id with real node', () => {
    const tree: BookmarkNode[] = [createFolder('0', '', [createFolder('10', 'Work')])];

    const appendedTree = appendFolderOptimistically(tree, {
      id: '__temp-folder__',
      parentId: '10',
      title: 'Inbox'
    });

    const parent = appendedTree[0]?.children?.[0];
    expect(parent?.children?.[0]).toMatchObject({ id: '__temp-folder__', title: 'Inbox' });

    const replacedTree = replaceFolderOptimistically(appendedTree, '__temp-folder__', {
      id: '20',
      parentId: '10',
      type: 'folder',
      title: 'Inbox',
      children: []
    });

    expect(replacedTree[0]?.children?.[0]?.children?.[0]).toMatchObject({ id: '20' });
  });

  it('should remove target folder subtree and related bookmark items', () => {
    const tree: BookmarkNode[] = [
      createFolder('0', '', [
        createFolder('10', 'Work', [createFolder('11', 'Project'), createFolder('12', 'Archive')]),
        createFolder('20', 'Life')
      ])
    ];
    const items: BookmarkIndexItem[] = [
      createItem({ id: '1', parentId: '10' }),
      createItem({ id: '2', parentId: '11' }),
      createItem({ id: '3', parentId: '20' })
    ];

    const { nextTree, removedFolderIds } = removeFolderSubtreeOptimistically(tree, '10');
    expect(Array.from(removedFolderIds).sort()).toEqual(['10', '11', '12']);
    expect(nextTree[0]?.children?.map((node) => node.id)).toEqual(['20']);

    const filteredItems = removeBookmarksInFoldersOptimistically(items, removedFolderIds);
    expect(filteredItems.map((item) => item.id)).toEqual(['3']);
  });
});