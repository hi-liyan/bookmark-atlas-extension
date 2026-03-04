import type { BookmarkIndexItem, BookmarkIndexSnapshot, BookmarkNode } from './types';
import { normalizeText, normalizeUrl } from './normalize';

const INDEX_VERSION = 1;

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
