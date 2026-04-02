/**
 * row_id + version 付き CSV の読み書き・差分計算ユーティリティ
 *
 * フォーマット:
 *   row_id,version,日付,距離,...
 *   row_abc,3,2024-01-15,5.2km,...
 *   row_def,1,2024-01-22,3.1km,...
 *   ,,2024-02-01,4.0km,...          ← row_id/version 空 = 新規行
 */

import { writeFileSync } from 'fs';

/**
 * CSV の1列目が row_id かどうかを判定
 */
export function hasRowIdColumn(csv: string): boolean {
  const firstLine = csv.split('\n')[0] ?? '';
  const firstHeader = firstLine.split(',')[0]?.trim();
  return firstHeader === 'row_id';
}

/**
 * row_id + version 付き CSV からメタデータを抽出し、データ列のみの csv_data を返す
 */
export function extractRowMeta(csv: string): {
  csvData: string;
  rowIds: (string | null)[];
  rowVersions: (number | null)[];
} {
  const lines = csv.split('\n');
  const rowIds: (string | null)[] = [];
  const rowVersions: (number | null)[] = [];
  const csvLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;

    if (i === 0) {
      // ヘッダー行: row_id,version を除去
      const cols = line.split(',');
      csvLines.push(cols.slice(2).join(','));
      continue;
    }

    // データ行: 1列目=row_id, 2列目=version, 残り=データ
    const firstComma = line.indexOf(',');
    if (firstComma < 0) continue;
    const secondComma = line.indexOf(',', firstComma + 1);
    if (secondComma < 0) continue;

    const rowId = line.substring(0, firstComma).trim();
    const versionStr = line.substring(firstComma + 1, secondComma).trim();
    rowIds.push(rowId || null);
    rowVersions.push(versionStr ? parseInt(versionStr, 10) : null);
    csvLines.push(line.substring(secondComma + 1));
  }

  return { csvData: csvLines.join('\n'), rowIds, rowVersions };
}

/**
 * row_id + version 付き CSV を書き出す
 */
export function writeRowIdCsv(
  path: string,
  csvData: string,
  rowIds: string[],
  rowVersions: number[],
): void {
  const lines = csvData.split('\n').filter(l => l.trim() !== '');
  const outputLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (i === 0) {
      outputLines.push(`row_id,version,${lines[i]}`);
    } else {
      const rowId = rowIds[i - 1] ?? '';
      const version = rowVersions[i - 1] ?? '';
      outputLines.push(`${rowId},${version},${lines[i]}`);
    }
  }

  writeFileSync(path, outputLines.join('\n') + '\n', 'utf-8');
}

/**
 * 差分計算: スナップショットと現在のCSVを比較し、変更行・新規行のみを返す
 *
 * @param currentCsv - 現在のCSV（row_id, version 付き）
 * @param snapshotCsv - スナップショット（row_id, version 付き）
 * @returns 変更行のみのデータ + 未変更行の情報
 */
export function computeRowDiff(
  currentCsv: string,
  snapshotCsv: string,
): {
  changedCsvData: string;
  changedRowIds: (string | null)[];
  changedRowVersions: (number | null)[];
  unchangedRows: { rowId: string; version: number }[];
} {
  const current = extractRowMeta(currentCsv);
  const snapshot = extractRowMeta(snapshotCsv);

  // スナップショットの行をrow_idで索引化（データ部分で比較するため）
  const snapshotDataByRowId = new Map<string, string>();
  const snapshotDataLines = snapshot.csvData.split('\n');
  // 1行目はヘッダー、2行目以降がデータ
  for (let i = 0; i < snapshot.rowIds.length; i++) {
    const rowId = snapshot.rowIds[i];
    if (rowId) {
      snapshotDataByRowId.set(rowId, snapshotDataLines[i + 1] ?? '');
    }
  }

  const currentDataLines = current.csvData.split('\n');
  const header = currentDataLines[0] ?? '';
  const changedLines: string[] = [header];
  const changedRowIds: (string | null)[] = [];
  const changedRowVersions: (number | null)[] = [];
  const unchangedRows: { rowId: string; version: number }[] = [];

  for (let i = 0; i < current.rowIds.length; i++) {
    const rowId = current.rowIds[i];
    const version = current.rowVersions[i];
    const dataLine = currentDataLines[i + 1] ?? '';

    if (!rowId) {
      // 新規行（row_id なし）→ 常に含める
      changedLines.push(dataLine);
      changedRowIds.push(null);
      changedRowVersions.push(null);
      continue;
    }

    const snapshotLine = snapshotDataByRowId.get(rowId);
    if (snapshotLine === undefined || snapshotLine !== dataLine) {
      // スナップショットにない or データが異なる → 変更行
      changedLines.push(dataLine);
      changedRowIds.push(rowId);
      changedRowVersions.push(version);
    } else {
      // 未変更行
      unchangedRows.push({ rowId, version: version ?? 1 });
    }
  }

  return {
    changedCsvData: changedLines.join('\n'),
    changedRowIds,
    changedRowVersions,
    unchangedRows,
  };
}
