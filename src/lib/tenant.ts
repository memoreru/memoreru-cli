/**
 * テナント検証ユーティリティ
 *
 * MEMORERU_TENANT 環境変数によるテナント検証を行う。
 * 専用テナントで未設定の場合は警告を表示する。
 */

import { getTenantInfo } from './api.js';

export async function verifyTenant(): Promise<void> {
  const tenant = await getTenantInfo();
  const expected = process.env.MEMORERU_TENANT;

  if (expected) {
    // MEMORERU_TENANT が設定されている → 検証
    if (tenant.slug !== expected) {
      console.error(`\n❌ Tenant mismatch: expected "${expected}" but connected to "${tenant.slug}"`);
      process.exit(1);
    }
    console.log(`ℹ️ Tenant: ${tenant.slug} ✅`);
  } else if (tenant.isDefault) {
    // 共通テナント + 未設定 → 情報表示
    console.log(`ℹ️ Tenant: common (default)`);
  } else {
    // 専用テナント + 未設定 → 警告
    console.log(`⚠️ Tenant: ${tenant.slug} (set MEMORERU_TENANT to verify)`);
  }
}
