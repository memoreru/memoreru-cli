/**
 * memoreru init — テンプレート生成
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';

export async function initCommand(
  directory: string | undefined,
  options: { type: string },
) {
  const dir = directory || '.';
  const contentType = options.type;
  const title = basename(dir === '.' ? process.cwd() : dir);

  console.log(`\n🐣 Initializing ${contentType} in ${dir}`);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const manifestPath = join(dir, '.memoreru.json');

  if (contentType === 'folder') {
    // フォルダの中身を定義する空マニフェストを作成
    // フォルダ自体の登録は親ディレクトリのマニフェストで行う
    writeFileSync(manifestPath, '{}\n');
    console.log(`   Created ${manifestPath}`);
    console.log(`\n💡 Tip: Register this folder in the parent directory's .memoreru.json:`);
    console.log(`   "${title}": { "content_type": "folder", "title": "${title}" }`);
  } else if (contentType === 'view' || contentType === 'graph' || contentType === 'dashboard') {
    const fileName = `${title}.json`;
    const manifest: Record<string, Record<string, unknown>> = {
      [fileName]: { content_type: contentType, title },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`   Created ${manifestPath}`);

    const settingsPath = join(dir, fileName);
    if (!existsSync(settingsPath)) {
      writeFileSync(settingsPath, '{}\n');
      console.log(`   Created ${settingsPath}`);
    }
  } else {
    const ext = contentType === 'table' ? '.csv' : '.md';
    const fileName = `${title}${ext}`;

    const manifest: Record<string, Record<string, unknown>> = {
      [fileName]: {
        content_type: contentType,
        title,
      },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`   Created ${manifestPath}`);

    const bodyPath = join(dir, fileName);
    if (!existsSync(bodyPath)) {
      const content = contentType === 'table'
        ? 'Name,Description\n'
        : `# ${title}\n\n`;
      writeFileSync(bodyPath, content);
      console.log(`   Created ${bodyPath}`);
    }

    // 画像ディレクトリはページ・スライドのみ
    if (contentType !== 'table') {
      const imagesDir = join(dir, 'images');
      if (!existsSync(imagesDir)) {
        mkdirSync(imagesDir, { recursive: true });
        console.log(`   Created ${imagesDir}/`);
      }
    }
  }

  console.log('\n✅ Done. Edit your content, then run: memoreru push');
}
