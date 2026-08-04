(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResidentadoSessionStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DEFAULT_DB_NAME = 'residentado-v1-1';
  const DEFAULT_DB_VERSION = 2;
  const FALLBACK_PREFIX = 'residentado_v1_1_fallback_';

  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });
  }

  function localStorageAvailable() {
    try {
      const storage = root.localStorage;
      if (!storage) return false;
      const key = `${FALLBACK_PREFIX}probe`;
      storage.setItem(key, '1');
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function fallbackRead(name, defaultValue) {
    if (!localStorageAvailable()) return defaultValue;
    try {
      const raw = root.localStorage.getItem(`${FALLBACK_PREFIX}${name}`);
      return raw == null ? defaultValue : JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  }

  function fallbackWrite(name, value) {
    if (!localStorageAvailable()) return;
    root.localStorage.setItem(`${FALLBACK_PREFIX}${name}`, JSON.stringify(value));
  }

  function createStore(options = {}) {
    const dbName = options.dbName || DEFAULT_DB_NAME;
    const dbVersion = Number(options.dbVersion || DEFAULT_DB_VERSION);
    let dbPromise = null;
    let mode = 'uninitialized';

    function ensureIndex(store, name, keyPath, indexOptions = {}) {
      if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, indexOptions);
    }

    async function open() {
      if (dbPromise) return dbPromise;
      if (!root.indexedDB) {
        mode = 'localStorage';
        dbPromise = Promise.resolve(null);
        return dbPromise;
      }

      dbPromise = new Promise((resolve) => {
        let settled = false;
        try {
          const request = root.indexedDB.open(dbName, dbVersion);
          request.onupgradeneeded = () => {
            const db = request.result;
            const tx = request.transaction;
            if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata', { keyPath: 'key' });
            if (!db.objectStoreNames.contains('questions')) db.createObjectStore('questions', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('topics')) db.createObjectStore('topics', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('sessions')) {
              const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
              ensureIndex(sessions, 'status', 'status', { unique: false });
              ensureIndex(sessions, 'updated_at', 'updated_at', { unique: false });
              ensureIndex(sessions, 'user_id', 'user_id', { unique: false });
              ensureIndex(sessions, 'completed_at', 'completed_at', { unique: false });
            } else if (tx) {
              const sessions = tx.objectStore('sessions');
              ensureIndex(sessions, 'status', 'status', { unique: false });
              ensureIndex(sessions, 'updated_at', 'updated_at', { unique: false });
              ensureIndex(sessions, 'user_id', 'user_id', { unique: false });
              ensureIndex(sessions, 'completed_at', 'completed_at', { unique: false });
            }
            if (!db.objectStoreNames.contains('attempts')) {
              const attempts = db.createObjectStore('attempts', { keyPath: 'client_attempt_id' });
              ensureIndex(attempts, 'session_id', 'session_id', { unique: false });
              ensureIndex(attempts, 'syncStatus', 'syncStatus', { unique: false });
              ensureIndex(attempts, 'user_id', 'user_id', { unique: false });
              ensureIndex(attempts, 'updated_at', 'updated_at', { unique: false });
            } else if (tx) {
              const attempts = tx.objectStore('attempts');
              ensureIndex(attempts, 'session_id', 'session_id', { unique: false });
              ensureIndex(attempts, 'syncStatus', 'syncStatus', { unique: false });
              ensureIndex(attempts, 'user_id', 'user_id', { unique: false });
              ensureIndex(attempts, 'updated_at', 'updated_at', { unique: false });
            }
            if (!db.objectStoreNames.contains('outbox')) {
              const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
              ensureIndex(outbox, 'dedupeKey', 'dedupeKey', { unique: false });
              ensureIndex(outbox, 'createdAt', 'createdAt', { unique: false });
            }
            if (!db.objectStoreNames.contains('userSnapshots')) db.createObjectStore('userSnapshots', { keyPath: 'dataset' });
          };
          request.onsuccess = () => {
            if (settled) return;
            settled = true;
            mode = 'indexedDB';
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
          };
          request.onerror = () => {
            if (settled) return;
            settled = true;
            mode = 'localStorage';
            resolve(null);
          };
          request.onblocked = () => {
            if (settled) return;
            settled = true;
            mode = 'localStorage';
            resolve(null);
          };
        } catch {
          mode = 'localStorage';
          resolve(null);
        }
      });
      return dbPromise;
    }

    function keyFieldFor(storeName) {
      if (storeName === 'metadata') return 'key';
      if (storeName === 'userSnapshots') return 'dataset';
      if (storeName === 'attempts') return 'client_attempt_id';
      return 'id';
    }

    async function put(storeName, value) {
      const db = await open();
      if (!db) {
        const rows = fallbackRead(storeName, []);
        const keyField = keyFieldFor(storeName);
        const index = rows.findIndex(row => String(row?.[keyField]) === String(value?.[keyField]));
        if (index >= 0) rows[index] = value;
        else rows.push(value);
        fallbackWrite(storeName, rows);
        return value;
      }
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value);
      await transactionDone(transaction);
      return value;
    }

    async function get(storeName, key) {
      const db = await open();
      if (!db) {
        const rows = fallbackRead(storeName, []);
        const keyField = keyFieldFor(storeName);
        return rows.find(row => String(row?.[keyField]) === String(key)) || null;
      }
      const transaction = db.transaction(storeName, 'readonly');
      return promisifyRequest(transaction.objectStore(storeName).get(key));
    }

    async function getAll(storeName) {
      const db = await open();
      if (!db) return fallbackRead(storeName, []);
      const transaction = db.transaction(storeName, 'readonly');
      return promisifyRequest(transaction.objectStore(storeName).getAll());
    }

    async function remove(storeName, key) {
      const db = await open();
      if (!db) {
        const rows = fallbackRead(storeName, []);
        const keyField = keyFieldFor(storeName);
        fallbackWrite(storeName, rows.filter(row => String(row?.[keyField]) !== String(key)));
        return;
      }
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(key);
      await transactionDone(transaction);
    }

    async function replaceCorpus(questionRows, topicRows, manifest = {}) {
      const questions = Array.isArray(questionRows) ? questionRows : [];
      const topics = Array.isArray(topicRows) ? topicRows : [];
      const savedAt = new Date().toISOString();
      const metadataRows = [
        { key: 'corpusRevision', value: manifest.dataset_revision || manifest.datasetRevision || null, updatedAt: savedAt },
        { key: 'corpusRowCount', value: questions.length, updatedAt: savedAt },
        { key: 'topicRowCount', value: topics.length, updatedAt: savedAt },
        { key: 'corpusManifest', value: { ...manifest, cached_at: savedAt }, updatedAt: savedAt },
      ];
      const db = await open();
      if (!db) {
        fallbackWrite('questions', questions);
        fallbackWrite('topics', topics);
        const currentMetadata = fallbackRead('metadata', []);
        const byKey = new Map(currentMetadata.map(row => [row.key, row]));
        metadataRows.forEach(row => byKey.set(row.key, row));
        fallbackWrite('metadata', [...byKey.values()]);
        return { questionCount: questions.length, topicCount: topics.length, savedAt };
      }
      const transaction = db.transaction(['questions', 'topics', 'metadata'], 'readwrite');
      const qStore = transaction.objectStore('questions');
      const tStore = transaction.objectStore('topics');
      const mStore = transaction.objectStore('metadata');
      qStore.clear();
      tStore.clear();
      questions.forEach(row => qStore.put(row));
      topics.forEach(row => tStore.put(row));
      metadataRows.forEach(row => mStore.put(row));
      await transactionDone(transaction);
      return { questionCount: questions.length, topicCount: topics.length, savedAt };
    }

    async function getCachedCorpus() {
      const [questions, topics, revision, manifest] = await Promise.all([
        getAll('questions'),
        getAll('topics'),
        get('metadata', 'corpusRevision'),
        get('metadata', 'corpusManifest'),
      ]);
      return {
        questions,
        topics,
        revision: revision?.value || null,
        manifest: manifest?.value || null,
      };
    }

    async function putSession(row, syncStatus = row?.syncStatus || 'pending') {
      const stamp = new Date().toISOString();
      return put('sessions', { ...row, syncStatus, localUpdatedAt: stamp });
    }

    async function getSessionsForUser(userId, status = null) {
      const rows = await getAll('sessions');
      return rows
        .filter(row => (!userId || String(row?.user_id || '') === String(userId)) && (!status || row?.status === status))
        .sort((a, b) => new Date(b.completed_at || b.localUpdatedAt || b.updated_at || 0) - new Date(a.completed_at || a.localUpdatedAt || a.updated_at || 0));
    }

    async function getActiveSessions(userId = null) { return getSessionsForUser(userId, 'active'); }
    async function getCompletedSessions(userId = null) { return getSessionsForUser(userId, 'completed'); }

    async function putAttempt(attempt, syncStatus = attempt?.syncStatus || 'pending') {
      if (!attempt?.client_attempt_id) throw new Error('client_attempt_id is required');
      return put('attempts', { ...attempt, syncStatus, localUpdatedAt: new Date().toISOString() });
    }

    async function bulkPutAttempts(rows, syncStatus = 'synced') {
      const list = (Array.isArray(rows) ? rows : []).filter(row => row?.client_attempt_id);
      if (!list.length) return 0;
      const stamp = new Date().toISOString();
      const db = await open();
      if (!db) {
        const current = fallbackRead('attempts', []);
        const byKey = new Map(current.map(row => [String(row.client_attempt_id), row]));
        list.forEach(row => byKey.set(String(row.client_attempt_id), { ...row, syncStatus: row.syncStatus || syncStatus, localUpdatedAt: stamp }));
        fallbackWrite('attempts', [...byKey.values()]);
        return list.length;
      }
      const transaction = db.transaction('attempts', 'readwrite');
      const store = transaction.objectStore('attempts');
      list.forEach(row => store.put({ ...row, syncStatus: row.syncStatus || syncStatus, localUpdatedAt: stamp }));
      await transactionDone(transaction);
      return list.length;
    }

    async function getAttemptsForUser(userId = null) {
      const rows = await getAll('attempts');
      return rows.filter(row => !userId || String(row?.user_id || '') === String(userId));
    }

    async function attemptsBySession(sessionId, userId = null) {
      const rows = await getAttemptsForUser(userId);
      return rows.filter(row => String(row?.session_id || '') === String(sessionId || ''));
    }

    async function setUserSnapshot(dataset, rows, metadata = {}) {
      const key = String(dataset || '');
      if (!key) throw new Error('dataset is required');
      return put('userSnapshots', {
        dataset: key,
        rows: Array.isArray(rows) ? rows : [],
        metadata: { ...metadata },
        updatedAt: new Date().toISOString(),
      });
    }

    async function getUserSnapshot(dataset) { return get('userSnapshots', String(dataset || '')); }

    async function queueOperation(type, payload, dedupeKey = null) {
      const row = { type, payload, dedupeKey, createdAt: new Date().toISOString(), attempts: 0 };
      const db = await open();
      if (!db) {
        const rows = fallbackRead('outbox', []);
        let saved;
        if (dedupeKey) {
          const index = rows.findIndex(item => item.dedupeKey === dedupeKey);
          if (index >= 0) {
            saved = { ...rows[index], ...row, id: rows[index].id };
            rows[index] = saved;
          } else {
            saved = { ...row, id: Date.now() + Math.random() };
            rows.push(saved);
          }
        } else {
          saved = { ...row, id: Date.now() + Math.random() };
          rows.push(saved);
        }
        fallbackWrite('outbox', rows);
        return saved;
      }
      const transaction = db.transaction('outbox', 'readwrite');
      const store = transaction.objectStore('outbox');
      if (dedupeKey) {
        const index = store.index('dedupeKey');
        const existing = await promisifyRequest(index.get(dedupeKey));
        if (existing) store.put({ ...existing, ...row, id: existing.id });
        else store.add(row);
      } else store.add(row);
      await transactionDone(transaction);
      return row;
    }

    async function migrateLegacyLocalStorage() {
      if (!localStorageAvailable()) return { migrated: false, reason: 'localStorage_unavailable' };
      const marker = await get('metadata', 'legacyLocalStorageImportedAt');
      if (marker) return { migrated: false, reason: 'already_migrated' };
      let sessionCount = 0;
      let attemptCount = 0;
      try {
        const legacySessions = JSON.parse(root.localStorage.getItem('residentado_piloto_sessions_v2') || '[]');
        for (const row of legacySessions) {
          if (!row?.id) continue;
          await putSession(row, 'legacy');
          sessionCount += 1;
        }
      } catch {}
      try {
        const legacyAttempts = JSON.parse(root.localStorage.getItem('residentado_piloto_attempts_v3') || '[]');
        for (const row of legacyAttempts) {
          if (!row?.client_attempt_id) continue;
          await putAttempt(row, 'legacy');
          attemptCount += 1;
        }
      } catch {}
      await put('metadata', { key: 'legacyLocalStorageImportedAt', value: new Date().toISOString(), sessionCount, attemptCount });
      return { migrated: true, sessionCount, attemptCount };
    }

    return {
      open,
      mode: () => mode,
      replaceCorpus,
      getCachedCorpus,
      putSession,
      getSession: id => get('sessions', id),
      getActiveSessions,
      getCompletedSessions,
      getSessionsForUser,
      getAllSessions: () => getAll('sessions'),
      deleteSession: id => remove('sessions', id),
      putAttempt,
      bulkPutAttempts,
      getAttempt: clientAttemptId => get('attempts', clientAttemptId),
      getAllAttempts: () => getAll('attempts'),
      getAttemptsForUser,
      attemptsBySession,
      setUserSnapshot,
      getUserSnapshot,
      queueOperation,
      listOutbox: () => getAll('outbox'),
      deleteOutbox: id => remove('outbox', id),
      setMetadata: (key, value) => put('metadata', { key, value, updatedAt: new Date().toISOString() }),
      getMetadata: key => get('metadata', key),
      migrateLegacyLocalStorage,
    };
  }

  return { createStore, DEFAULT_DB_NAME, DEFAULT_DB_VERSION };
});
