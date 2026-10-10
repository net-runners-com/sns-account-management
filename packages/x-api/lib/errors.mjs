// X セッション/認証関連のエラー検出と専用 Error クラス
// 401/403 + X 固有 error code を見て session 切れか判定する.

/**
 * セッション期限切れ・凍結・ロック等の認証関連エラー
 */
export class XSessionError extends Error {
  constructor(message, { status, code, accountName, body } = {}) {
    super(message);
    this.name = "XSessionError";
    this.status = status;
    this.code = code;
    this.accountName = accountName;
    this.body = body;
  }
}

/**
 * X 固有 error code → 意味
 * (https://developer.x.com/en/docs/x-api/v1/error-codes-responses)
 */
const X_AUTH_ERROR_CODES = {
  32: "Could not authenticate you (auth_token 不正/期限切れ)",
  64: "Account suspended (アカウント凍結)",
  89: "Invalid or expired token (auth_token 期限切れ)",
  99: "Unable to verify your credentials (cookie 不整合)",
  135: "Timestamp out of bounds (system clock 異常)",
  186: "Tweet too long",
  215: "Bad authentication data (Bearer or session 不正)",
  326: "Account temporarily locked (captcha/2FA 要対応)",
  353: "CSRF (ct0) mismatch",
};

/**
 * fetch response から session 関連エラーを検出
 *
 * @param {number} status HTTP status
 * @param {object} body   parsed JSON body (optional)
 * @param {string} accountName 呼び出し元アカウント
 * @returns {XSessionError|null}
 */
export function detectSessionError(status, body, accountName) {
  const errors = body?.errors;
  const firstCode = Array.isArray(errors) && errors[0]?.code;
  const firstMsg = Array.isArray(errors) && errors[0]?.message;

  if (firstCode && X_AUTH_ERROR_CODES[firstCode]) {
    return new XSessionError(
      `${X_AUTH_ERROR_CODES[firstCode]} (code ${firstCode}): ${firstMsg || ""}`.trim(),
      { status, code: firstCode, accountName, body }
    );
  }

  if (status === 401) {
    return new XSessionError(
      "401 Unauthorized — auth_token 期限切れ or 無効",
      { status, accountName, body }
    );
  }

  // 403 は rate-limit でも出るので X 固有 code が無い場合だけ session 扱い
  if (status === 403 && !firstCode) {
    return new XSessionError(
      "403 Forbidden — ct0 mismatch / cookie 不整合の可能性",
      { status, accountName, body }
    );
  }

  return null;
}

/**
 * CLI でユーザー向けに表示する標準メッセージ
 */
export function formatSessionErrorForCLI(err) {
  const lines = [
    `ERROR: X セッション無効 (${err.accountName || "?"})`,
    `  ${err.message}`,
    "",
    "復旧手順:",
    "  1. Chrome で x.com にログインし直す",
    "  2. DevTools > Application > Cookies > x.com から auth_token, ct0, ... を再取得",
    "  3. accounts/x_accounts.json を更新 (or import スクリプトで上書き)",
    "  4. node libs/x-api/check_session.mjs --account <name> で生死確認",
  ];
  return lines.join("\n");
}
