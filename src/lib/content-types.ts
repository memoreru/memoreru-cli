import { readFileSync } from 'node:fs';

const manifestSchema = JSON.parse(
  // Compiled files live in dist/src/lib; schemas are packaged at the package root.
  readFileSync(new URL('../../../schemas/memoreru.json', import.meta.url), 'utf8'),
) as {
  definitions: { entry: { properties: { contentType: { enum: string[] } } } };
};
const schemaContentTypes = manifestSchema.definitions.entry.properties.contentType.enum;

/** Content types accepted by the bundled manifest schema. */
export const CONTENT_TYPES: readonly string[] = schemaContentTypes;

export type ContentType = keyof typeof CONTENT_TYPE_KIND;

export function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

export type ContentTypeKind = 'folder' | 'document' | 'table' | 'settings';

/** Dispatch classification for the content types accepted by the manifest schema. */
export const CONTENT_TYPE_KIND = {
  folder: 'folder',
  page: 'document',
  table: 'table',
  slide: 'document',
  view: 'settings',
  graph: 'settings',
  dashboard: 'settings',
  screen: 'settings',
  report: 'settings',
  workflow: 'settings',
} as const satisfies Record<string, ContentTypeKind>;

export function isSettingsContentType(type: ContentType): boolean {
  return CONTENT_TYPE_KIND[type] === 'settings';
}
