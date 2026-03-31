/**
 * @memoreru-sdk/cli — Programmatic API
 *
 * CLI以外からもライブラリとして利用可能。
 */

export { configure } from './lib/api.js';
export type { ApiConfig, ContentSummary, PullImageMeta, PushImage, TableColumn, UpsertInput, UpsertResult } from './lib/api.js';
export {
  downloadImage,
  listChildren,
  listRootContents,
  pullContent,
  pullTableData,
  pushContent,
  upsertContent,
} from './lib/api.js';
export { scanDirectory } from './lib/scan.js';
export type { ScanEntry } from './lib/scan.js';
export { readManifest, readMeta, updateManifestEntry, writeMeta, buildMetaFromEntry } from './lib/manifest.js';
export { verifyTenant } from './lib/tenant.js';
export type { MemoreruManifest, MemoreruMeta } from './lib/manifest.js';
export { readState, writeState, classifyEntries, computeBodyHash, computeMetaHash, prepareSyncState, updateStateAfterSync } from './lib/state.js';
export type { StateFile, ContentSnapshot, FileStatus, StatusEntry } from './lib/state.js';
export { generateDiff } from './lib/diff.js';
