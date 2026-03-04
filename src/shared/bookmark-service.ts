import { browser } from './browser';
import type { BookmarkNode } from './types';

const toNodeType = (node: browser.Bookmarks.BookmarkTreeNode): 'bookmark' | 'folder' =>
  node.url ? 'bookmark' : 'folder';

const fromTreeNode = (node: browser.Bookmarks.BookmarkTreeNode): BookmarkNode => ({
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

  async create(input: browser.Bookmarks.CreateDetailsType): Promise<BookmarkNode> {
    const created = await browser.bookmarks.create(input);
    return fromTreeNode(created);
  },

  async update(id: string, changes: browser.Bookmarks.UpdateChangesType): Promise<BookmarkNode> {
    const updated = await browser.bookmarks.update(id, changes);
    return fromTreeNode(updated);
  },

  async move(id: string, destination: browser.Bookmarks.DestinationType): Promise<BookmarkNode> {
    const moved = await browser.bookmarks.move(id, destination);
    return fromTreeNode(moved);
  },

  async removeTree(id: string): Promise<void> {
    await browser.bookmarks.removeTree(id);
  }
};
