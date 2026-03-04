import { useEffect, useMemo } from 'react';
import type { BookmarkIndexItem, BookmarkNode } from '../shared/types';
import { usePopupStore } from './store';

const TreeNode = ({ node }: { node: BookmarkNode }) => {
  if (node.type === 'bookmark') {
    return null;
  }

  return (
    <li>
      <details open>
        <summary className="text-sm">{node.title || 'Untitled folder'}</summary>
        <ul>
          {node.children?.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </ul>
      </details>
    </li>
  );
};

const BookmarkTable = ({ items }: { items: BookmarkIndexItem[] }) => (
  <div className="min-h-0 overflow-auto rounded-box border border-base-300">
    <table className="table table-zebra table-sm">
      <thead>
        <tr>
          <th>Title</th>
          <th>URL</th>
          <th>Folder</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.title || 'Untitled bookmark'}</td>
            <td className="max-w-64 truncate">{item.url ?? '-'}</td>
            <td>{item.path.join(' / ') || 'Root'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const PopupApp = () => {
  const { tree, items, query, loading, error, setQuery, load } = usePopupStore();

  useEffect(() => {
    void load();
  }, [load]);

  const filteredItems = useMemo(() => {
    const queryNorm = query.trim().toLowerCase();
    if (!queryNorm) {
      return items;
    }

    return items.filter(
      (item) => item.titleNorm.includes(queryNorm) || item.urlNorm.includes(queryNorm)
    );
  }, [items, query]);

  return (
    <div className="flex h-full flex-col bg-base-200 p-3 text-base-content">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Bookmark Manager</h1>
        <button className="btn btn-sm" onClick={() => void load()} type="button">
          Refresh
        </button>
      </div>

      <label className="input input-bordered mb-3 flex items-center gap-2">
        <input
          className="grow"
          placeholder="Search title or URL"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {loading ? <div className="alert alert-info mb-3">Loading bookmarks...</div> : null}
      {error ? <div className="alert alert-error mb-3">{error}</div> : null}

      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-3">
        <div className="min-h-0 overflow-auto rounded-box border border-base-300 bg-base-100 p-2">
          <h2 className="mb-2 text-sm font-semibold">Folders</h2>
          <ul className="menu menu-sm">
            {tree.map((node) => (
              <TreeNode key={node.id} node={node} />
            ))}
          </ul>
        </div>
        <BookmarkTable items={filteredItems} />
      </div>
    </div>
  );
};
