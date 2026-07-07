/**
 * match_column 方式 CSV の差分計算ユーティリティ
 *
 * match_column push は row_id を持たず「照合列の値」で既存行を upsert する。
 * 従来は毎回全行を送っていたが、スナップショット (前回 push 成功時の CSV) と
 * 照合列の値でキー比較し、変更・新規行のみを送ることで大型フィードの反映を高速化する。
 *
 * 削除 (スナップショットにあって現在に無いキー) はここでは扱わない
 * (サーバ行の削除は呼び出し側の削除同期に委ねる。CLI 単体では消さない)。
 */

/** 引用符・改行対応の最小 CSV パーサ (レコード内改行も扱う)。 */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuote = false;
      } else field += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // 末尾の空レコード (trailing newline 由来) を除去
  return records.filter(r => !(r.length === 1 && r[0] === ''));
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsvLine(fields: string[]): string {
  return fields.map(csvField).join(',');
}

/**
 * meta.match_column (列名 or 列ID) を CSV ヘッダ名に解決する。
 * 列ID 指定の場合は meta.columns の id→name で引く。解決できなければそのまま返す
 * (サーバ側は列名/列ID 両対応のため、CSV ヘッダに無ければ差分は諦めて全行送信になる)。
 */
export function resolveMatchHeaderName(
  matchColumn: string,
  columns?: Array<{ id?: string; name: string }>,
): string {
  const byId = columns?.find(c => c.id === matchColumn);
  return byId?.name ?? matchColumn;
}

export interface MatchColumnDiff {
  /** ヘッダ + 変更・新規行のみの CSV (変更 0 件ならヘッダのみ) */
  changedCsv: string;
  changedCount: number;
  unchangedCount: number;
}

/**
 * 照合列の値で current / snapshot を突き合わせ、変更・新規行のみの CSV を返す。
 *
 * null を返すケース (呼び出し側は全行送信にフォールバックする):
 * - どちらかに照合列ヘッダが無い
 * - ヘッダ行が一致しない (列の追加・改名・並び替えは行比較の前提が崩れるため全行送信)
 * - current 側で照合列の値が空 or 重複する行がある (キーとして信頼できない)
 */
export function computeMatchColumnDiff(
  currentCsv: string,
  snapshotCsv: string,
  matchHeaderName: string,
): MatchColumnDiff | null {
  const current = parseCsvRecords(currentCsv);
  const snapshot = parseCsvRecords(snapshotCsv);
  const header = current[0];
  const snapHeader = snapshot[0];
  if (!header || !snapHeader) return null;
  if (toCsvLine(header) !== toCsvLine(snapHeader)) return null;
  const keyIdx = header.indexOf(matchHeaderName);
  if (keyIdx < 0) return null;

  const currentKeys = new Set<string>();
  for (const r of current.slice(1)) {
    const key = (r[keyIdx] ?? '').trim();
    if (!key || currentKeys.has(key)) return null;
    currentKeys.add(key);
  }

  const snapByKey = new Map<string, string>();
  for (const r of snapshot.slice(1)) {
    const key = (r[keyIdx] ?? '').trim();
    if (key) snapByKey.set(key, JSON.stringify(r));
  }

  const changedLines: string[] = [];
  let unchangedCount = 0;
  for (const r of current.slice(1)) {
    const key = (r[keyIdx] ?? '').trim();
    if (snapByKey.get(key) === JSON.stringify(r)) {
      unchangedCount++;
    } else {
      changedLines.push(toCsvLine(r));
    }
  }

  return {
    changedCsv: `${[toCsvLine(header), ...changedLines].join('\n')}\n`,
    changedCount: changedLines.length,
    unchangedCount,
  };
}
