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
 * 收集目录树中的全部目录 id。
 * 入参：目录树。
 * 出参：目录 id 数组（用于“全部展开/全部收起”）。
 */
export const collectAllFolderIds = (folderTree: FolderViewNode[]): string[] => {
  const ids: string[] = [];

  /**
   * 深度优先收集目录 id，保证父节点先于子节点。
   */
  const visit = (nodes: FolderViewNode[]): void => {
    nodes.forEach((node) => {
      ids.push(node.id);
      if (node.children.length > 0) {
        visit(node.children);
      }
    });
  };

  visit(folderTree);
  return ids;
};

/**
 * 获取指定目录及其所有子目录的 id 集合。
 * 入参：目录树、目标目录 id。
 * 出参：子树目录 id 集合；若目录不存在则返回空集合。
 */
export const collectFolderSubtreeIds = (
  folderTree: FolderViewNode[],
  folderId: string
): Set<string> => {
  /**
   * 在目录树中查找目标目录节点。
   */
  const findFolder = (nodes: FolderViewNode[]): FolderViewNode | null => {
    for (const node of nodes) {
      if (node.id === folderId) {
        return node;
      }
      if (node.children.length > 0) {
        const found = findFolder(node.children);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };

  const target = findFolder(folderTree);
  if (!target) {
    return new Set<string>();
  }

  const ids = new Set<string>();

  /**
   * 收集目标目录整棵子树的目录 id。
   */
  const collect = (node: FolderViewNode): void => {
    ids.add(node.id);
    node.children.forEach((child) => collect(child));
  };

  collect(target);
  return ids;
};

/**
 * 按目录与搜索词过滤书签列表。
 * 入参：索引书签、选中目录 id、选中目录子树 id 集合、搜索词。
 * 出参：符合条件的书签列表。
 */
export const filterBookmarks = (
  items: BookmarkIndexItem[],
  selectedFolderId: string,
  selectedFolderSubtreeIds: Set<string> | null,
  query: string
): BookmarkIndexItem[] => {
  const queryNorm = normalizeText(query);

  return items.filter((item) => {
    // 搜索栏始终全局生效：有搜索词时忽略目录筛选，仅做全量匹配。
    if (queryNorm) {
      return item.titleNorm.includes(queryNorm) || item.urlNorm.includes(queryNorm);
    }

    // 根目录展示“未归入任何目录路径”的书签。
    const matchesFolder =
      selectedFolderId === ROOT_FOLDER_ID
        ? item.path.length === 0
        : Boolean(item.parentId && selectedFolderSubtreeIds?.has(item.parentId));

    if (!matchesFolder) {
      return false;
    }
    return true;
  });
};
