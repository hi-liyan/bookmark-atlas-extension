import type { BookmarkIndexItem, BookmarkIndexSnapshot, BookmarkNode } from './types';
import { normalizeText, normalizeUrl } from './normalize';

const INDEX_VERSION = 1;

/**
 * 递归提取可检索书签项：仅收集 bookmark 节点，自动忽略 folder/separator。
 * 入参：当前节点数组、目录路径、输出数组。
 * 出参：累计后的书签索引项数组。
 */
const collectItems = (
  nodes: BookmarkNode[],
  path: string[] = [],
  output: BookmarkIndexItem[] = []
): BookmarkIndexItem[] => {
  nodes.forEach((node) => {
    if (node.type === 'folder') {
      const nextPath = node.title ? [...path, node.title] : path;
      if (node.children) {
        collectItems(node.children, nextPath, output);
      }
      return;
    }

    if (node.type !== 'bookmark') {
      return;
    }

    output.push({
      id: node.id,
      title: node.title,
      titleNorm: normalizeText(node.title),
      url: node.url,
      urlNorm: normalizeUrl(node.url),
      parentId: node.parentId,
      path
    });
  });

  return output;
};

export const buildBookmarkIndex = (tree: BookmarkNode[]): BookmarkIndexSnapshot => ({
  version: INDEX_VERSION,
  updatedAt: Date.now(),
  items: collectItems(tree)
});