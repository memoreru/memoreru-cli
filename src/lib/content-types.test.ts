import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_TYPES, CONTENT_TYPE_KIND, isContentType } from './content-types.js';

test('content types cover the public schema and every type has a sync dispatch', () => {
  const schema = JSON.parse(readFileSync(join(process.cwd(), 'schemas/memoreru.json'), 'utf8'));
  const schemaTypes = schema.definitions.entry.properties.contentType.enum as string[];
  assert.deepEqual([...CONTENT_TYPES].sort(), [...schemaTypes].sort());
  assert.deepEqual(Object.keys(CONTENT_TYPE_KIND).sort(), [...schemaTypes].sort());
  for (const type of schemaTypes) assert.equal(isContentType(type), true);
  assert.equal(isContentType('unknown'), false);
});
