import { normalizeText } from '../shared/normalize';
import type { BookmarkIndexItem, BookmarkNode } from '../shared/types';

export const ROOT_FOLDER_ID = '__root__';

export interface FolderViewNode {
  id: string;
  title: string;
  parentId?: string;
  children: FolderViewNode[];
}

const ROOT_FOLDER_TITLE_FALLBACK = '未命名目录';

/**
 * 将书签树中的目录节点转换为前端可直接渲染的层级结构。
 * 入参：浏览器书签树根数组。
 * 出参：仅包含目录的层级树（不包含书签节点）。
 */
export const buildFolderTree = (tree: BookmarkNode[]): FolderViewNode[] => {
  /**
   * 递归提取目录节点，保持原有父子关系。
   */
  const mapFolderNode = (node: BookmarkNode, parentId?: string): FolderViewNode | null => {
    if (node.type !== 'folder') {
      return null;
    }

    const title = node.title?.trim() ? node.title : ROOT_FOLDER_TITLE_FALLBACK;
    const children = (node.children ?? [])
      .map((child) => mapFolderNode(child, node.id))
      .filter((child): child is FolderViewNode => child !== null);

    return {
      id: node.id,
      title,
      parentId,
      children
    };
  };

  const result: FolderViewNode[] = [];

  tree.forEach((node) => {
    // 浏览器根节点常为空标题，仅作为容器，这里将其子目录提升到第一层展示。
    if (node.type === 'folder' && !node.title?.trim()) {
      (node.children ?? []).forEach((child) => {
        const folder = mapFolderNode(child);
        if (folder) {
          result.push(folder);
        }
      });
      return;
    }

    const folder = mapFolderNode(node);
    if (folder) {
      result.push(folder);
    }
  });

  return result;
};

/**
 * 将目录树拍平为 Map，便于按 id 快速查询目录信息。
 * 入参：目录树。
 * 出参：以目录 id 为键的目录 Map。
 */
export const flattenFolderTree = (folderTree: FolderViewNode[]): Map<string, FolderViewNode> => {
  const map = new Map<string, FolderViewNode>();

  /**
   * 深度优先遍历目录树并写入 Map。
   */
  const visit = (nodes: FolderViewNode[]): void => {
    nodes.forEach((node) => {
      map.set(node.id, node);
      if (node.children.length > 0) {
        visit(node.children);
      }
    });
  };

  visit(folderTree);
  return map;
};

/**
 * 按目录与搜索词过滤书签列表。
 * 入参：索引书签、选中目录 id、搜索词。
 * 出参：符合条件的书签列表。
 */
export const filterBookmarks = (
  items: BookmarkIndexItem[],
  selectedFolderId: string,
  query: string
): BookmarkIndexItem[] => {
  const queryNorm = normalizeText(query);

  return items.filter((item) => {
    // 根目录展示“未归入任何目录路径”的书签。
    const matchesFolder =
      selectedFolderId === ROOT_FOLDER_ID ? item.path.length === 0 : item.parentId === selectedFolderId;

    if (!matchesFolder) {
      return false;
    }

    if (!queryNorm) {
      return true;
    }

    return item.titleNorm.includes(queryNorm) || item.urlNorm.includes(queryNorm);
  });
};
