import { describe, expect, it } from 'vitest';
import { ROOT_FOLDER_ID } from './view-model';
import { isPopupViewStateSnapshot, sanitizePopupViewStateSnapshot } from './view-state';

describe('isPopupViewStateSnapshot', () => {
  it('should return true for valid snapshot shape', () => {
    const value = {
      query: 'alpha',
      selectedFolderId: '100',
      expandedFolderIds: ['100', '200']
    };

    expect(isPopupViewStateSnapshot(value)).toBe(true);
  });

  it('should return false for invalid snapshot shape', () => {
    const value = {
      query: 'alpha',
      selectedFolderId: 100,
      expandedFolderIds: ['100', 200]
    };

    expect(isPopupViewStateSnapshot(value)).toBe(false);
  });
});

describe('sanitizePopupViewStateSnapshot', () => {
  it('should fallback selected folder to root when folder is missing', () => {
    const result = sanitizePopupViewStateSnapshot(
      {
        query: 'keyword',
        selectedFolderId: 'missing-folder',
        expandedFolderIds: ['100']
      },
      new Set<string>(['100', '200'])
    );

    expect(result.selectedFolderId).toBe(ROOT_FOLDER_ID);
  });

  it('should drop invalid expanded folders and keep unique ids', () => {
    const result = sanitizePopupViewStateSnapshot(
      {
        query: '',
        selectedFolderId: ROOT_FOLDER_ID,
        expandedFolderIds: ['100', 'invalid', '100', '200']
      },
      new Set<string>(['100', '200'])
    );

    expect(result.expandedFolderIds).toEqual(['100', '200']);
  });
});
