import { describe, expect, it } from 'vitest';
import type { BookmarkIndexItem, BookmarkNode } from '../shared/types';
import { buildFolderTree, filterBookmarks, ROOT_FOLDER_ID } from './view-model';

/**
 * 生成测试用书签节点，避免每个用例重复构造样板数据。
 */
const createFolder = (id: string, title: string, children: BookmarkNode[] = []): BookmarkNode => ({
  id,
  title,
  type: 'folder',
  children
});

/**
 * 生成测试用索引项，便于验证目录过滤行为。
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

describe('buildFolderTree', () => {
  it('should skip bookmark nodes and keep folder hierarchy', () => {
    const tree: BookmarkNode[] = [
      createFolder('0', '', [
        createFolder('10', 'Toolbar', [
          {
            id: 'b-1',
            title: 'Example',
            type: 'bookmark',
            parentId: '10',
            url: 'https://example.com'
          }
        ]),
        createFolder('20', 'Work')
      ])
    ];

    const result = buildFolderTree(tree);
    expect(result.map((node) => node.id)).toEqual(['10', '20']);
    expect(result[0]?.children).toHaveLength(0);
  });
});

describe('filterBookmarks', () => {
  it('should return uncategorized bookmarks when selecting root', () => {
    const items = [
      createItem({
        id: '1',
        title: 'Root',
        titleNorm: 'root',
        parentId: '0',
        path: [],
        urlNorm: 'https://root.dev'
      }),
      createItem({
        id: '2',
        title: 'Inside folder',
        titleNorm: 'inside folder',
        parentId: '10',
        path: ['Toolbar'],
        urlNorm: 'https://inside.dev'
      })
    ];

    const result = filterBookmarks(items, ROOT_FOLDER_ID, '');
    expect(result.map((item) => item.id)).toEqual(['1']);
  });

  it('should filter by folder and query together', () => {
    const items = [
      createItem({
        id: '1',
        title: 'Alpha Doc',
        titleNorm: 'alpha doc',
        parentId: '10',
        path: ['Work'],
        urlNorm: 'https://alpha.dev'
      }),
      createItem({
        id: '2',
        title: 'Beta Note',
        titleNorm: 'beta note',
        parentId: '10',
        path: ['Work'],
        urlNorm: 'https://beta.dev'
      }),
      createItem({
        id: '3',
        title: 'Gamma',
        titleNorm: 'gamma',
        parentId: '20',
        path: ['Life'],
        urlNorm: 'https://gamma.dev'
      })
    ];

    const result = filterBookmarks(items, '10', 'beta');
    expect(result.map((item) => item.id)).toEqual(['2']);
  });
});
