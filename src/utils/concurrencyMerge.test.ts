import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISORY_LOCK_TTL_MS,
  checkAdvisoryLock,
  diffChangedFields,
  mergeRecordWithBase,
  reconcileCollectionWithPending,
} from './concurrencyMerge';
import { PersistentSyncQueue } from './syncQueue';

test('diffChangedFields extracts only keys altered relative to base snapshot', () => {
  const base = {
    id: 'c1',
    status: 'Belum ditangani',
    description: 'Terlambat',
    initialAction: 'Teguran',
    _version: 1,
  };
  const next = {
    ...base,
    description: 'Terlambat 3 hari berturut-turut',
    _version: 99,
  };
  assert.deepEqual(diffChangedFields(base, next), {
    description: 'Terlambat 3 hari berturut-turut',
  });
});

test('mergeRecordWithBase preserves concurrent edits from another teacher on different fields', () => {
  const baseSnapshot = {
    id: 'c1',
    description: 'Terlambat masuk',
    initialAction: 'Teguran',
    status: 'Belum ditangani',
    counselorName: 'Ibu Sari',
    _version: 1,
  };

  // Teacher A committed first, changing status + counselorName -> _version became 2
  const serverLatest = {
    ...baseSnapshot,
    status: 'Dalam pemantauan',
    counselorName: 'Ibu Ratna',
    _version: 2,
    updatedBy: 'Ibu Ratna',
  };

  // Teacher B concurrently edited description + initialAction from stale baseSnapshot
  const teacherBFormSave = {
    ...baseSnapshot,
    description: 'Terlambat masuk 4 kali dalam seminggu',
    initialAction: 'Pembinaan khusus + WA orang tua',
  };

  const merged = mergeRecordWithBase({
    base: baseSnapshot,
    server: serverLatest,
    patch: teacherBFormSave,
    actorName: 'Pak Hendra',
    nowISO: '2026-11-21T09:00:00.000Z',
  });

  // Teacher A's status & counselorName preserved, Teacher B's description & initialAction applied!
  assert.equal(merged.status, 'Dalam pemantauan');
  assert.equal(merged.counselorName, 'Ibu Ratna');
  assert.equal(merged.description, 'Terlambat masuk 4 kali dalam seminggu');
  assert.equal(merged.initialAction, 'Pembinaan khusus + WA orang tua');
  assert.equal(merged._version, 3);
  assert.equal(merged.updatedBy, 'Pak Hendra');
  assert.equal(merged.lockBy, null);
});

test('checkAdvisoryLock detects active other-user locks and ignores own or expired locks', () => {
  const now = 1_700_000_000_000;
  const activeOther = checkAdvisoryLock(
    { lockBy: 'guru_2', lockByName: 'Ibu Sari', lockExpiresAt: now + ADVISORY_LOCK_TTL_MS },
    'guru_1',
    now
  );
  assert.equal(activeOther.lockedByOther, true);
  assert.equal(activeOther.lockOwnerName, 'Ibu Sari');

  const ownLock = checkAdvisoryLock(
    { lockBy: 'guru_1', lockByName: 'Pak Budi', lockExpiresAt: now + 5000 },
    'guru_1',
    now
  );
  assert.equal(ownLock.lockedByOther, false);

  const expiredLock = checkAdvisoryLock(
    { lockBy: 'guru_2', lockByName: 'Ibu Sari', lockExpiresAt: now - 1000 },
    'guru_1',
    now
  );
  assert.equal(expiredLock.lockedByOther, false);
});

test('reconcileCollectionWithPending preserves optimistic creates, updates, and deletes over stale snapshot', () => {
  const serverDocs = [
    { id: 'c1', title: 'Server A' },
    { id: 'c2', title: 'Server B' },
  ];
  const merged = reconcileCollectionWithPending(serverDocs, [
    { opId: '1', docId: 'c3', action: 'create', data: { id: 'c3', title: 'Optimistic C' } },
    { opId: '2', docId: 'c1', action: 'update', data: { title: 'Updated A' } },
    { opId: '3', docId: 'c2', action: 'delete' },
  ]);

  assert.deepEqual(merged, [
    { id: 'c1', title: 'Updated A' },
    { id: 'c3', title: 'Optimistic C' },
  ]);
});

test('PersistentSyncQueue executes FIFO in order and rolls back on permanent failure', async () => {
  const queue = new PersistentSyncQueue();
  const executed: string[] = [];
  let rolledBack = false;

  queue.setExecutor(async (item) => {
    if (item.docId === 'fail_doc') {
      throw new Error('permission-denied');
    }
    executed.push(`${item.action}:${item.docId}`);
  });

  await queue.enqueue({
    entity: 'cases',
    action: 'create',
    docId: 'case_1',
    payload: { id: 'case_1' },
  });

  await queue.enqueue({
    entity: 'counselingLogs',
    action: 'create',
    docId: 'clog_1',
    payload: { id: 'clog_1' },
  });

  await assert.rejects(
    () =>
      queue.enqueue({
        entity: 'parentCalls',
        action: 'update',
        docId: 'fail_doc',
        payload: { id: 'fail_doc' },
        onRollback: () => {
          rolledBack = true;
        },
      }),
    /permission-denied/
  );

  assert.deepEqual(executed, ['create:case_1', 'create:clog_1']);
  assert.equal(rolledBack, true);
  assert.equal(queue.getSnapshot().pendingCount, 0);
});
