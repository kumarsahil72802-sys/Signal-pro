const test = require('node:test');
const assert = require('node:assert/strict');

const { runQualityFilters } = require('../../services/signalEngine/generatorParts/core');

test('runQualityFilters blocks confidence below hard minimum 50', () => {
  const result = runQualityFilters(49, { valid: true, score: 12, current: 100, average: 90 }, 1.2);
  assert.equal(result.passed, false);
  assert.match(result.reason, /hard minimum \(50\)/i);
});

test('runQualityFilters allows confidence at default effective threshold boundary', () => {
  const result = runQualityFilters(54, { valid: true, score: 12, current: 100, average: 90 }, 1.2);
  assert.equal(result.passed, true);
});
