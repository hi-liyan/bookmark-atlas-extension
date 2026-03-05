import { browser } from './browser';
import type { BookmarkNode } from './types';

/**
 * 规范化书签节点类型：优先使用浏览器原始 type，缺失时按 url 兜底判断。
 * 入参：浏览器书签树节点。
 * 出参：统一后的节点类型（bookmark/folder/separator）。
 */
const toNodeType = (node: browser.bookmarks.BookmarkTreeNode): 'bookmark' | 'folder' | 'separator' => {
  if (node.type === 'bookmark' || node.type === 'folder' || node.type === 'separator') {
    return node.type;
  }

  return node.url ? 'bookmark' : 'folder';
};

/**
 * 将浏览器书签树节点转换为共享 BookmarkNode，确保字段结构统一。
 * 入参：浏览器书签树节点。
 * 出参：项目内部书签节点对象。
 */
const fromTreeNode = (node: browser.bookmarks.BookmarkTreeNode): BookmarkNode => ({
  id: node.id,
  parentId: node.parentId,
  type: toNodeType(node),
  title: node.title,
  url: node.url,
  index: node.index,
  dateAdded: node.dateAdded,
  dateGroupModified: node.dateGroupModified,
  children: node.children?.map(fromTreeNode)
});

export const bookmarkService = {
  async getTree(): Promise<BookmarkNode[]> {
    const tree = await browser.bookmarks.getTree();
    return tree.map(fromTreeNode);
  },

  async get(id: string): Promise<BookmarkNode[]> {
    const nodes = await browser.bookmarks.get(id);
    return nodes.map(fromTreeNode);
  },

  async create(input: browser.bookmarks.CreateDetails): Promise<BookmarkNode> {
    const created = await browser.bookmarks.create(input);
    return fromTreeNode(created);
  },

  async update(id: string, changes: browser.bookmarks._UpdateChanges): Promise<BookmarkNode> {
    const updated = await browser.bookmarks.update(id, changes);
    return fromTreeNode(updated);
  },

  async move(id: string, destination: browser.bookmarks._MoveDestination): Promise<BookmarkNode> {
    const moved = await browser.bookmarks.move(id, destination);
    return fromTreeNode(moved);
  },

  async remove(id: string): Promise<void> {
    await browser.bookmarks.remove(id);
  },

  async removeTree(id: string): Promise<void> {
    await browser.bookmarks.removeTree(id);
  }
};