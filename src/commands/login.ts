/**
 * memoreru login / logout コマンド
 *
 * login: ブラウザフローで認証（CAPTCHA/2FA/OAuth 対応）
 * logout: 指定プロファイルまたは全プロファイルを削除
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { exec } from 'child_process';
import { setProfile, deleteProfile, clearCredentials, type Profile } from '../lib/credentials.js';

// ---------------------------------------------------------------------------
// ブラウザ起動ヘルパー
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  switch (process.platform) {
    case 'darwin':
      exec(`open "${url}"`);
      break;
    case 'win32':
      // start の第1引数はウィンドウタイトル。空文字を渡さないと URL がタイトル扱いになる
      exec(`start "" "${url}"`);
      break;
    default:
      exec(`xdg-open "${url}"`);
  }
}

// ---------------------------------------------------------------------------
// Set-Cookie ヘッダーからセッションクッキー値を抽出
// ---------------------------------------------------------------------------

/**
 * Set-Cookie ヘッダーからセッションクッキー値を抽出。
 * Node.js 18 では getSetCookie() が未実装のため、get('set-cookie') からもパースする。
 */
function extractSessionCookie(res: Response): string | null {
  // Node.js 20+: getSetCookie() で個別の Set-Cookie ヘッダーを取得
  const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
  for (const header of setCookieHeaders) {
    const match = header.match(/better-auth\.session_token=([^;]+)/);
    if (match) return match[1];
  }

  // Node.js 18 フォールバック: get('set-cookie') は複数ヘッダーを ", " で結合する場合がある
  const rawHeader = res.headers.get('set-cookie');
  if (rawHeader) {
    const match = rawHeader.match(/better-auth\.session_token=([^;,]+)/);
    if (match) return match[1];
  }

  return null;
}

// ---------------------------------------------------------------------------
// ブラウザログイン
// ---------------------------------------------------------------------------

async function loginWithBrowser(
  baseUrl: string,
  port?: number,
): Promise<{ cookie: string; user: { id: string; name: string; email: string }; tenantId: string }> {
  const state = randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('ログインがタイムアウトしました（120秒）。再度お試しください。'));
    }, 120_000);

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch');
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }

      // 成功ページを先に返す
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>認証完了</h2><p>このタブを閉じてください。</p>
        </body></html>`);

      clearTimeout(timeout);

      try {
        // 認可コードをセッショントークンに交換
        const exchangeRes = await fetch(`${baseUrl}/api/cli-auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!exchangeRes.ok) {
          const body = await exchangeRes.text().catch(() => '');
          server.close();
          reject(new Error(`認可コードの交換に失敗しました (${exchangeRes.status}): ${body}`));
          return;
        }

        const cookie = extractSessionCookie(exchangeRes);
        if (!cookie) {
          server.close();
          reject(new Error('セッションクッキーを取得できませんでした。'));
          return;
        }

        const data = (await exchangeRes.json()) as {
          user: { id: string; name: string; email: string };
          tenant_id: string;
        };

        server.close();
        resolve({
          cookie,
          user: data.user,
          tenantId: data.tenant_id,
        });
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(port || 0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        clearTimeout(timeout);
        server.close();
        reject(new Error('ローカルサーバーの起動に失敗しました。'));
        return;
      }

      const actualPort = addr.port;
      const authUrl = `${baseUrl}/cli-auth?port=${actualPort}&state=${state}`;

      console.log(`🌐 ブラウザを開いています...`);
      console.log(`   ${authUrl}`);
      console.log(`   認証を待っています... (Ctrl+C でキャンセル)`);

      openBrowser(authUrl);
    });
  });
}

// ---------------------------------------------------------------------------
// login コマンド
// ---------------------------------------------------------------------------

export async function loginCommand(options: {
  profile?: string;
  url?: string;
  port?: string;
}) {
  const baseUrl = (options.url || process.env.MEMORERU_URL || 'https://memoreru.com').replace(
    /\/$/,
    '',
  );
  const profileName = options.profile || 'default';

  try {
    const port = options.port ? parseInt(options.port, 10) : undefined;
    const result = await loginWithBrowser(baseUrl, port);

    const profile: Profile = {
      cookie: result.cookie,
      base_url: baseUrl,
      user_id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      tenant_id: result.tenantId,
      created_at: new Date().toISOString(),
    };

    setProfile(profileName, profile);

    console.log(`\n✅ ログイン成功`);
    console.log(`   ユーザー: ${result.user.name} (${result.user.email})`);
    console.log(`   プロファイル '${profileName}' に保存しました`);
  } catch (err) {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// logout コマンド
// ---------------------------------------------------------------------------

export async function logoutCommand(options: { profile?: string; all?: boolean }) {
  if (options.all) {
    clearCredentials();
    console.log(`✅ すべてのプロファイルを削除しました`);
  } else {
    const profileName = options.profile || 'default';
    deleteProfile(profileName);
    console.log(`✅ プロファイル '${profileName}' のセッションを削除しました`);
  }
}
