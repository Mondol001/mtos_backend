import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_DEFAULT_MOUJA_ID,
  getBuiltInKhatianDetail,
  getBuiltInSurveyCounts,
  searchBuiltInPreviews,
  verifyBuiltInKhatianMeta,
} from './catalog.ts';

test('server catalog loads CS and SA built-in counts accurately', () => {
  const counts = getBuiltInSurveyCounts(BUILTIN_DEFAULT_MOUJA_ID);
  assert.equal(counts.CS, 854);
  assert.equal(counts.SA, 1177);
});

test('searchBuiltInPreviews masks sensitive fields while surfacing matched dags', () => {
  const previews = searchBuiltInPreviews({
    moujaId: BUILTIN_DEFAULT_MOUJA_ID,
    surveyType: 'CS',
    query: '2713',
    searchField: 'all',
  });
  assert.equal(previews.length, 1);
  assert.equal(previews[0].khatianNo, '১');
  assert.deepEqual(previews[0].matchedDags, ['২৭১৩']);
  assert.equal('owners' in previews[0], false);
  assert.equal('fatherOrHusband' in previews[0], false);
});

test('getBuiltInKhatianDetail and verification return full unmasked record for server unlock path', () => {
  const detail = getBuiltInKhatianDetail(BUILTIN_DEFAULT_MOUJA_ID, 'CS', '1');
  assert.ok(detail);
  assert.ok(detail.owners.length > 1);
  assert.ok(detail.dags.includes('২৭১৩'));

  const meta = verifyBuiltInKhatianMeta(BUILTIN_DEFAULT_MOUJA_ID, 'CS', '1');
  assert.equal(meta.valid, true);
  assert.match(meta.verificationCode, /^MTOS-CS-1-[A-Z0-9]+$/);
});
