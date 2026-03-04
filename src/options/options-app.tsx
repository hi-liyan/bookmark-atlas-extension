import { useEffect, useState } from 'react';
import { browser } from '../shared/browser';
import type { SyncConfig } from '../shared/types';

const STORAGE_KEY = 'sync-config';

const defaultConfig: SyncConfig = {
  syncEnabled: false,
  serverUrl: '',
  database: '',
  username: '',
  password: '',
  syncIntervalMin: 15,
  syncMode: 'two-way',
  conflictPolicy: 'latest-write-wins',
  autoSyncOnChange: true,
  verifySSL: true
};

export const OptionsApp = () => {
  const [config, setConfig] = useState<SyncConfig>(defaultConfig);
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    void (async () => {
      const stored = await browser.storage.local.get(STORAGE_KEY);
      const value = stored[STORAGE_KEY] as SyncConfig | undefined;
      if (value) {
        setConfig(value);
      }
    })();
  }, []);

  const save = async (): Promise<void> => {
    await browser.storage.local.set({ [STORAGE_KEY]: config });
    setSavedMessage('Settings saved.');
    setTimeout(() => setSavedMessage(''), 1500);
  };

  return (
    <main className="min-h-screen bg-base-200 p-6 text-base-content">
      <section className="mx-auto max-w-2xl rounded-box border border-base-300 bg-base-100 p-5">
        <h1 className="mb-4 text-xl font-semibold">Sync Settings</h1>

        <div className="form-control mb-3">
          <label className="label cursor-pointer justify-start gap-2">
            <input
              checked={config.syncEnabled}
              className="toggle"
              onChange={(event) => setConfig({ ...config, syncEnabled: event.target.checked })}
              type="checkbox"
            />
            <span className="label-text">Enable CouchDB Sync</span>
          </label>
        </div>

        <label className="form-control mb-3">
          <span className="label-text">Server URL</span>
          <input
            className="input input-bordered"
            onChange={(event) => setConfig({ ...config, serverUrl: event.target.value })}
            placeholder="https://couchdb.example.com"
            type="url"
            value={config.serverUrl}
          />
        </label>

        <label className="form-control mb-3">
          <span className="label-text">Database</span>
          <input
            className="input input-bordered"
            onChange={(event) => setConfig({ ...config, database: event.target.value })}
            type="text"
            value={config.database}
          />
        </label>

        <div className="flex justify-end gap-2">
          {savedMessage ? <span className="text-sm text-success">{savedMessage}</span> : null}
          <button className="btn btn-primary" onClick={() => void save()} type="button">
            Save
          </button>
        </div>
      </section>
    </main>
  );
};
