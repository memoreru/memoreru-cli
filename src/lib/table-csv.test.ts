import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPulledTableCell } from './table-csv.js';

test('URL pull writes the URL and leaves the optional label out of CSV', () => {
  assert.equal(
    formatPulledTableCell({ url: 'https://example.test', label: 'Example' }, 'url'),
    'https://example.test',
  );
});

test('URL pull keeps accepting legacy string inputs from the server contract', () => {
  assert.equal(formatPulledTableCell('https://example.test', 'url'), 'https://example.test');
});
