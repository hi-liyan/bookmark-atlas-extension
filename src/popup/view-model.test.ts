import { describe, expect, it } from 'vitest';
import type { BookmarkIndexItem, BookmarkNode } from '../shared/types';
import {
  buildFolderTree,
  collectAllFolderIds,
  collectFolderSubtreeIds,
  filterBookmarks,
  ROOT_FOLDER_ID
} from './view-model';

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

    const result = filterBookmarks(items, ROOT_FOLDER_ID, null, '');
    expect(result.map((item) => item.id)).toEqual(['1']);
  });

  it('should include children folders when selecting parent folder', () => {
    const folderTree = buildFolderTree([
      createFolder('0', '', [createFolder('10', 'Work', [createFolder('11', 'Project')])])
    ]);
    const items = [
      createItem({
        id: '1',
        title: 'Alpha Doc',
        titleNorm: 'alpha doc',
        parentId: '10',
        path: ['Work', 'Project'],
        urlNorm: 'https://alpha.dev'
      }),
      createItem({
        id: '2',
        title: 'Child Note',
        titleNorm: 'child note',
        parentId: '11',
        path: ['Work', 'Project'],
        urlNorm: 'https://child.dev'
      })
    ];

    const subtreeIds = collectFolderSubtreeIds(folderTree, '10');
    const result = filterBookmarks(items, '10', subtreeIds, '');
    expect(result.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('should search globally when query is not empty', () => {
    const items = [
      createItem({
        id: '1',
        title: 'Alpha',
        titleNorm: 'alpha',
        parentId: '10',
        path: ['Work'],
        urlNorm: 'https://alpha.dev'
      }),
      createItem({
        id: '2',
        title: 'Beta',
        titleNorm: 'beta',
        parentId: '20',
        path: ['Life'],
        urlNorm: 'https://beta.dev'
      })
    ];

    const result = filterBookmarks(items, '10', new Set<string>(['10']), 'beta');
    expect(result.map((item) => item.id)).toEqual(['2']);
  });
});

describe('folder utility functions', () => {
  it('should collect all folder ids in tree', () => {
    const folderTree = buildFolderTree([
      createFolder('0', '', [createFolder('10', 'A', [createFolder('11', 'B')]), createFolder('12', 'C')])
    ]);

    expect(collectAllFolderIds(folderTree)).toEqual(['10', '11', '12']);
  });

  it('should return empty set when subtree root is missing', () => {
    const folderTree = buildFolderTree([createFolder('0', '', [createFolder('10', 'A')])]);
    expect(Array.from(collectFolderSubtreeIds(folderTree, '404'))).toEqual([]);
  });

  it('should collect target folder and all descendants for subtree ids', () => {
    const folderTree = buildFolderTree([
      createFolder('0', '', [
        createFolder('10', 'A', [
          createFolder('11', 'A-1'),
          createFolder('12', 'A-2', [createFolder('13', 'A-2-1')])
        ])
      ])
    ]);

    const subtreeIds = collectFolderSubtreeIds(folderTree, '10');
    expect(Array.from(subtreeIds).sort()).toEqual(['10', '11', '12', '13']);
  });
});
