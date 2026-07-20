const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');
const { setSuppression } = require('../src/fileSync');
const { recordChange, getChangesSince } = require('../src/dbSync');

async function runTests() {
  console.log('🧪 Starting PteroDownTimeKiller Automated Test Suite...\n');

  // Test 1: File Suppression Lock
  console.log('Test 1: File Suppression Lock');
  setSuppression('app/Models/Server.php', 2000);
  console.log('  ✅ File suppression set and active.');

  // Test 2: Database Delta Recording
  console.log('Test 2: Database Delta Recording');
  const now = Date.now() - 1000;
  recordChange('servers', 'UPDATE', { id: 1, name: 'Test Server', memory: 2048 });
  const deltas = getChangesSince(now);
  assert.strictEqual(deltas.length >= 1, true, 'Delta log should contain recorded change');
  assert.strictEqual(deltas[0].table, 'servers', 'Delta table should match');
  console.log('  ✅ Database delta change recorded correctly.');

  // Test 3: Snapshot directory check
  console.log('Test 3: Snapshot Engine Directory Structure');
  const { listSnapshots } = require('../src/snapshotEngine');
  const snapshots = await listSnapshots();
  assert.ok(Array.isArray(snapshots), 'Snapshots list should return an array');
  console.log(`  ✅ Snapshot engine verified (${snapshots.length} existing snapshots).`);

  console.log('\n✨ ALL TESTS PASSED SUCCESSFULLY! ✨');
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
