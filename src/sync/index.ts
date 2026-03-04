import type { SyncConfig } from '../shared/types';

export const validateSyncConfig = (config: SyncConfig): string[] => {
  const issues: string[] = [];

  if (config.syncEnabled && !config.serverUrl.startsWith('https://')) {
    issues.push('CouchDB server URL must use HTTPS.');
  }

  if (config.syncEnabled && !config.database.trim()) {
    issues.push('Database is required when sync is enabled.');
  }

  return issues;
};
