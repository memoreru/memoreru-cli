/**
 * Memoreru CLI ロゴ表示
 * 緑→青緑のグラデーション付きアスキーアート
 */

const LOGO = `\
 ███╗   ███╗ ███████╗ ███╗   ███╗  ██████╗  ██████╗  ███████╗ ██████╗  ██╗   ██╗
 ████╗ ████║ ██╔════╝ ████╗ ████║ ██╔═══██╗ ██╔══██╗ ██╔════╝ ██╔══██╗ ██║   ██║
 ██╔████╔██║ █████╗   ██╔████╔██║ ██║   ██║ ██████╔╝ █████╗   ██████╔╝ ██║   ██║
 ██║╚██╔╝██║ ██╔══╝   ██║╚██╔╝██║ ██║   ██║ ██╔══██╗ ██╔══╝   ██╔══██╗ ██║   ██║
 ██║ ╚═╝ ██║ ███████╗ ██║ ╚═╝ ██║ ╚██████╔╝ ██║  ██║ ███████╗ ██║  ██║ ╚██████╔╝
 ╚═╝     ╚═╝ ╚══════╝ ╚═╝     ╚═╝  ╚═════╝  ╚═╝  ╚═╝ ╚══════╝ ╚═╝  ╚═╝  ╚═════╝`;

// グラデーション: #4ade80 (緑) → #2dd4bf (青緑)
const START = { r: 74, g: 222, b: 128 };
const END = { r: 45, g: 212, b: 191 };

function interpolate(t: number): string {
  const r = Math.round(START.r + (END.r - START.r) * t);
  const g = Math.round(START.g + (END.g - START.g) * t);
  const b = Math.round(START.b + (END.b - START.b) * t);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function printLogo(): void {
  // カラー非対応の場合はプレーンテキスト
  if (!process.stdout.isTTY || process.env.NO_COLOR) {
    console.log(LOGO);
    return;
  }

  const lines = LOGO.split('\n');
  const totalLines = lines.length;

  for (let i = 0; i < totalLines; i++) {
    const t = totalLines <= 1 ? 0 : i / (totalLines - 1);
    process.stdout.write(`${interpolate(t)}${lines[i]}\x1b[0m\n`);
  }
}
