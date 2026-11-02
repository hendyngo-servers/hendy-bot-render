const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFeatureName, buildFeatureFiles } = require('./scaffold-feature');

test('validates kebab-case feature names', () => {
  assert.equal(validateFeatureName('order-history'),'order-history');
  assert.throws(()=>validateFeatureName('../escape'),/slug/);
  assert.throws(()=>validateFeatureName('UPPER'),/slug/);
  assert.throws(()=>validateFeatureName(''),/slug/);
});

test('creates bot feature template and tests without enabling it', () => {
  const files=buildFeatureFiles({name:'order-history',category:'bot',description:'Order tools'});
  assert.ok(files['apps/backend-api/src/features/order-history/index.js']);
  assert.ok(files['apps/backend-api/src/features/order-history/index.test.js']);
  assert.equal(JSON.parse(files['apps/backend-api/src/features/order-history/feature.json']).enabled,false);
});

test('creates dashboard feature in dashboard-owned folder', () => {
  const files=buildFeatureFiles({name:'customer-card',category:'dashboard'});
  assert.ok(files['apps/admin-dashboard/features/customer-card/index.js']);
  assert.equal(Object.keys(files).some(key=>key.endsWith('.test.js')),false);
});

test('rejects unsupported feature category', () => {
  assert.throws(()=>buildFeatureFiles({name:'foo',category:'system'}),/Loại tính năng/);
});
