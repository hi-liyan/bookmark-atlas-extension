import { normalizeText, normalizeUrl } from '../shared/normalize';
import type { BookmarkIndexItem, BookmarkNode } from '../shared/types';

export interface BookmarkEditPatch {
  bookmarkId: string;
  title: string;
  url: string;
}

export interface OptimisticBookmarkDraft {
  id: string;
  title: string;
  url?: string;
  parentId: string;
  path: string[];
}

export interface OptimisticFolderDraft {
  id: string;
  parentId: string;
  title: string;
}

export interface RemoveFolderSubtreeResult {
  nextTree: BookmarkNode[];
  removedFolderIds: Set<string>;
}

/**
 * 对索引列表应用书签编辑结果，用于 UI 的乐观更新。
 * 入参：当前索引列表、编辑补丁（书签 ID/标题/URL）。
 * 出参：应用补丁后的新索引列表。
 */
export const applyBookmarkEditOptimistically = (
  items: BookmarkIndexItem[],
  patch: BookmarkEditPatch
): BookmarkIndexItem[] => {
  const nextTitle = patch.title.trim();
  const nextUrl = patch.url.trim();

  return items.map((item) => {
    if (item.id !== patch.bookmarkId) {
      return item;
    }

    return {
      ...item,
      title: nextTitle,
      url: nextUrl,
      // 编辑后同步更新归一化字段，确保搜索结果与 UI 文本一致。
      titleNorm: normalizeText(nextTitle),
      urlNorm: normalizeUrl(nextUrl)
    };
  });
};

/**
 * 对索引列表应用书签删除结果，用于 UI 的乐观更新。
 * 入参：当前索引列表、待删除书签 ID。
 * 出参：删除目标项后的新索引列表。
 */
export const applyBookmarkDeleteOptimistically = (
  items: BookmarkIndexItem[],
  bookmarkId: string
): BookmarkIndexItem[] => {
  return items.filter((item) => item.id !== bookmarkId);
};

/**
 * 在索引列表中追加新书签占位项，用于创建动作的乐观更新。
 * 入参：当前索引列表、待追加的书签草稿。
 * 出参：追加后的新索引列表。
 */
export const appendBookmarkOptimistically = (
  items: BookmarkIndexItem[],
  draft: OptimisticBookmarkDraft
): BookmarkIndexItem[] => {
  const normalizedTitle = draft.title.trim();
  const normalizedUrl = draft.url?.trim();

  return [
    {
      id: draft.id,
      title: normalizedTitle,
      titleNorm: normalizeText(normalizedTitle),
      url: normalizedUrl,
      urlNorm: normalizeUrl(normalizedUrl),
      parentId: draft.parentId,
      path: [...draft.path]
    },
    ...items
  ];
};

/**
 * 将临时书签 ID 替换为真实 ID，并同步标题/URL 等字段。
 * 入参：当前索引列表、临时 ID、真实书签草稿。
 * 出参：替换后的新索引列表。
 */
export const replaceBookmarkOptimistically = (
  items: BookmarkIndexItem[],
  tempId: string,
  draft: OptimisticBookmarkDraft
): BookmarkIndexItem[] => {
  const normalizedTitle = draft.title.trim();
  const normalizedUrl = draft.url?.trim();

  return items.map((item) => {
    if (item.id !== tempId) {
      return item;
    }

    return {
      ...item,
      id: draft.id,
      title: normalizedTitle,
      titleNorm: normalizeText(normalizedTitle),
      url: normalizedUrl,
      urlNorm: normalizeUrl(normalizedUrl),
      parentId: draft.parentId,
      path: [...draft.path]
    };
  });
};

/**
 * 基于当前目录树生成“目录 ID -> 目录路径”映射，用于移动/创建时计算书签 path。
 * 入参：完整书签树。
 * 出参：目录 ID 到路径数组的映射。
 */
export const buildFolderPathMap = (tree: BookmarkNode[]): Map<string, string[]> => {
  const pathMap = new Map<string, string[]>();

  /**
   * 深度遍历目录并记录每个目录下书签应使用的 path。
   */
  const visit = (nodes: BookmarkNode[], path: string[]): void => {
    nodes.forEach((node) => {
      if (node.type !== 'folder') {
        return;
      }

      const nextPath = node.title.trim() ? [...path, node.title] : path;
      pathMap.set(node.id, nextPath);
      if (node.children?.length) {
        visit(node.children, nextPath);
      }
    });
  };

  visit(tree, []);
  return pathMap;
};

/**
 * 在乐观更新中移动书签：更新 parentId 与 path。
 * 入参：当前索引列表、目录树、书签 ID、目标目录 ID。
 * 出参：移动后的新索引列表。
 */
export const applyBookmarkMoveOptimistically = (
  items: BookmarkIndexItem[],
  tree: BookmarkNode[],
  bookmarkId: string,
  parentId: string
): BookmarkIndexItem[] => {
  const folderPathMap = buildFolderPathMap(tree);
  const nextPath = folderPathMap.get(parentId) ?? [];

  return items.map((item) => {
    if (item.id !== bookmarkId) {
      return item;
    }

    return {
      ...item,
      parentId,
      path: [...nextPath]
    };
  });
};

/**
 * 在目录树中乐观追加新目录。
 * 入参：当前树、目录草稿。
 * 出参：追加后的新树；若父目录不存在则返回原树。
 */
export const appendFolderOptimistically = (
  tree: BookmarkNode[],
  draft: OptimisticFolderDraft
): BookmarkNode[] => {
  const nextNode: BookmarkNode = {
    id: draft.id,
    parentId: draft.parentId,
    type: 'folder',
    title: draft.title,
    children: []
  };

  /**
   * 递归查找父目录并追加子目录，未命中时保持原引用以减少不必要重渲染。
   */
  const insertToParent = (nodes: BookmarkNode[]): { changed: boolean; nodes: BookmarkNode[] } => {
    let changed = false;
    const nextNodes = nodes.map((node) => {
      if (node.id === draft.parentId && node.type === 'folder') {
        changed = true;
        return {
          ...node,
          children: [...(node.children ?? []), nextNode]
        };
      }

      if (!node.children?.length) {
        return node;
      }

      const childResult = insertToParent(node.children);
      if (!childResult.changed) {
        return node;
      }

      changed = true;
      return {
        ...node,
        children: childResult.nodes
      };
    });

    return {
      changed,
      nodes: changed ? nextNodes : nodes
    };
  };

  return insertToParent(tree).nodes;
};

/**
 * 将目录树中的临时目录 ID 替换为真实目录 ID。
 * 入参：当前树、临时 ID、真实目录节点。
 * 出参：替换后的新树。
 */
export const replaceFolderOptimistically = (
  tree: BookmarkNode[],
  tempId: string,
  created: BookmarkNode
): BookmarkNode[] => {
  /**
   * 递归更新命中节点及其引用该临时 ID 的 parentId。
   */
  const replaceRecursively = (nodes: BookmarkNode[]): BookmarkNode[] => {
    return nodes.map((node) => {
      const nextId = node.id === tempId ? created.id : node.id;
      const nextParentId = node.parentId === tempId ? created.id : node.parentId;
      const nextChildren = node.children?.length ? replaceRecursively(node.children) : node.children;

      if (
        nextId === node.id &&
        nextParentId === node.parentId &&
        nextChildren === node.children
      ) {
        return node;
      }

      if (node.id === tempId) {
        // 命中临时目录时使用后端返回的数据覆盖，避免本地草稿与真实节点不一致。
        return {
          ...created,
          children: nextChildren ?? created.children
        };
      }

      return {
        ...node,
        id: nextId,
        parentId: nextParentId,
        children: nextChildren
      };
    });
  };

  return replaceRecursively(tree);
};


/**
 * 在目录树中乐观更新目标目录名称。
 * 入参：当前树、目标目录 ID、新名称。
 * 出参：更新后的新树；若未命中目录则返回原树。
 */
export const renameFolderOptimistically = (
  tree: BookmarkNode[],
  folderId: string,
  title: string
): BookmarkNode[] => {
  const nextTitle = title.trim();

  /**
   * 递归查找目录并仅在命中路径上创建新引用，避免整树重建。
   */
  const renameRecursively = (nodes: BookmarkNode[]): { changed: boolean; nodes: BookmarkNode[] } => {
    let changed = false;
    const nextNodes = nodes.map((node) => {
      if (node.id === folderId && node.type === 'folder') {
        changed = true;
        return {
          ...node,
          title: nextTitle
        };
      }

      if (!node.children?.length) {
        return node;
      }

      const childResult = renameRecursively(node.children);
      if (!childResult.changed) {
        return node;
      }

      changed = true;
      return {
        ...node,
        children: childResult.nodes
      };
    });

    return {
      changed,
      nodes: changed ? nextNodes : nodes
    };
  };

  return renameRecursively(tree).nodes;
};

/**
 * 从目录树中移除目标目录整棵子树，并返回被移除的目录 ID 集合。
 * 入参：当前树、待删除目录 ID。
 * 出参：删除后的新树与被删除目录集合。
 */
export const removeFolderSubtreeOptimistically = (
  tree: BookmarkNode[],
  folderId: string
): RemoveFolderSubtreeResult => {
  const removedFolderIds = new Set<string>();

  /**
   * 收集某个目录节点下的全部目录 ID，用于同步清理索引中的相关书签。
   */
  const collectFolderIds = (node: BookmarkNode): void => {
    if (node.type !== 'folder') {
      return;
    }

    removedFolderIds.add(node.id);
    node.children?.forEach((child) => collectFolderIds(child));
  };

  /**
   * 递归删除目标目录节点，保持其余结构不变。
   */
  const removeRecursively = (nodes: BookmarkNode[]): { changed: boolean; nodes: BookmarkNode[] } => {
    let changed = false;
    const nextNodes: BookmarkNode[] = [];

    nodes.forEach((node) => {
      if (node.id === folderId && node.type === 'folder') {
        collectFolderIds(node);
        changed = true;
        return;
      }

      if (!node.children?.length) {
        nextNodes.push(node);
        return;
      }

      const childResult = removeRecursively(node.children);
      if (!childResult.changed) {
        nextNodes.push(node);
        return;
      }

      changed = true;
      nextNodes.push({
        ...node,
        children: childResult.nodes
      });
    });

    return {
      changed,
      nodes: changed ? nextNodes : nodes
    };
  };

  const nextTree = removeRecursively(tree).nodes;
  return {
    nextTree,
    removedFolderIds
  };
};

/**
 * 删除目录后，同步清理该目录子树下的所有书签索引项。
 * 入参：当前索引列表、被删除目录 ID 集合。
 * 出参：清理后的新索引列表。
 */
export const removeBookmarksInFoldersOptimistically = (
  items: BookmarkIndexItem[],
  folderIds: Set<string>
): BookmarkIndexItem[] => {
  if (folderIds.size === 0) {
    return items;
  }

  return items.filter((item) => {
    if (!item.parentId) {
      return true;
    }
    return !folderIds.has(item.parentId);
  });
};