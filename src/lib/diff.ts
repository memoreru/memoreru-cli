/**
 * テキスト差分生成（Myers diff アルゴリズム）
 *
 * 行単位の diff を unified diff 形式で出力する。
 * 外部ライブラリ不要。
 */

// =============================================================================
// 型定義
// =============================================================================

interface DiffEdit {
  type: 'keep' | 'insert' | 'delete';
  line: string;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  edits: DiffEdit[];
}

// =============================================================================
// Myers diff アルゴリズム
// =============================================================================

/**
 * Myers の O(ND) diff アルゴリズムで最短編集スクリプトを求める。
 * 行単位で比較し、keep / insert / delete の編集列を返す。
 */
function myersDiff(oldLines: string[], newLines: string[]): DiffEdit[] {
  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;

  // 特殊ケース
  if (n === 0 && m === 0) return [];
  if (n === 0) return newLines.map(line => ({ type: 'insert', line }));
  if (m === 0) return oldLines.map(line => ({ type: 'delete', line }));

  // V 配列: k → x 座標のマッピング（各 d ステップの最遠到達点）
  // offset で負のインデックスをシフト
  const offset = max;
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  v.fill(-1);
  v[offset + 1] = 0;

  // trace: 各 d ステップでの V 配列のスナップショット
  const trace: Int32Array[] = [];

  outer:
  for (let d = 0; d <= max; d++) {
    const vCopy = new Int32Array(v);
    trace.push(vCopy);

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1]; // 下に移動（insert）
      } else {
        x = v[offset + k - 1] + 1; // 右に移動（delete）
      }

      let y = x - k;

      // 対角線（一致する行）を可能な限り進む
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) {
        break outer;
      }
    }
  }

  // trace をバックトラックして編集列を構築
  const edits: DiffEdit[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;

    // 対角線（keep）を逆順に追加
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ type: 'keep', line: oldLines[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        // insert
        y--;
        edits.push({ type: 'insert', line: newLines[y] });
      } else {
        // delete
        x--;
        edits.push({ type: 'delete', line: oldLines[x] });
      }
    }
  }

  edits.reverse();
  return edits;
}

// =============================================================================
// Unified diff フォーマット
// =============================================================================

/** 編集列からハンク（変更ブロック）を抽出 */
function buildHunks(edits: DiffEdit[], contextLines: number): Hunk[] {
  const hunks: Hunk[] = [];

  // 変更行のインデックスを収集
  const changeIndices: number[] = [];
  for (let i = 0; i < edits.length; i++) {
    if (edits[i].type !== 'keep') {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // 変更行をグループ化（contextLines * 2 以内なら同じハンクにまとめる）
  const groups: number[][] = [];
  let currentGroup: number[] = [changeIndices[0]];

  for (let i = 1; i < changeIndices.length; i++) {
    if (changeIndices[i] - changeIndices[i - 1] <= contextLines * 2 + 1) {
      currentGroup.push(changeIndices[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [changeIndices[i]];
    }
  }
  groups.push(currentGroup);

  // 各グループからハンクを生成
  for (const group of groups) {
    const firstChange = group[0];
    const lastChange = group[group.length - 1];

    const start = Math.max(0, firstChange - contextLines);
    const end = Math.min(edits.length - 1, lastChange + contextLines);

    const hunkEdits = edits.slice(start, end + 1);

    let oldStart = 1;
    let oldCount = 0;
    let newStart = 1;
    let newCount = 0;

    // start より前の行数を数えて開始行を計算
    let oldLine = 0;
    let newLine = 0;
    for (let i = 0; i < start; i++) {
      if (edits[i].type === 'keep' || edits[i].type === 'delete') oldLine++;
      if (edits[i].type === 'keep' || edits[i].type === 'insert') newLine++;
    }
    oldStart = oldLine + 1;
    newStart = newLine + 1;

    for (const edit of hunkEdits) {
      if (edit.type === 'keep' || edit.type === 'delete') oldCount++;
      if (edit.type === 'keep' || edit.type === 'insert') newCount++;
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, edits: hunkEdits });
  }

  return hunks;
}

/** unified diff 形式の文字列を生成 */
function formatUnifiedDiff(
  oldLabel: string,
  newLabel: string,
  edits: DiffEdit[],
  contextLines = 3,
): string {
  const hunks = buildHunks(edits, contextLines);
  if (hunks.length === 0) return '';

  const lines: string[] = [];
  lines.push(`--- ${oldLabel}`);
  lines.push(`+++ ${newLabel}`);

  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    for (const edit of hunk.edits) {
      switch (edit.type) {
        case 'keep':
          lines.push(` ${edit.line}`);
          break;
        case 'delete':
          lines.push(`-${edit.line}`);
          break;
        case 'insert':
          lines.push(`+${edit.line}`);
          break;
      }
    }
  }

  return lines.join('\n');
}

// =============================================================================
// 公開 API
// =============================================================================

/**
 * 2つのテキストの差分を Git 互換の unified diff 形式で生成する。
 * 差分がなければ空文字列を返す。
 *
 * filePath を指定すると `diff --git a/path b/path` ヘッダを出力する。
 */
export function generateDiff(
  oldContent: string,
  newContent: string,
  oldLabel: string,
  newLabel: string,
  filePath?: string,
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // 末尾の空行を処理（split で最後に空文字列ができる場合）
  if (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') oldLines.pop();
  if (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop();

  const edits = myersDiff(oldLines, newLines);
  const diff = formatUnifiedDiff(oldLabel, newLabel, edits);
  if (!diff) return '';

  if (filePath) {
    return `diff --git a/${filePath} b/${filePath}\n${diff}`;
  }
  return diff;
}
