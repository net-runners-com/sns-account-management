// X session 切れ時の自動再ログイン. credentials は env で渡す.
//
// env (大文字必須):
//   X_LOGIN_USERNAME_<UPPER_ACCOUNT_NAME>=...
//   X_LOGIN_PASSWORD_<UPPER_ACCOUNT_NAME>=...
//   または fallback:
//   X_LOGIN_USERNAME=...   (アカウント無指定 or 全アカ共用)
//   X_LOGIN_PASSWORD=...
import { loadAccounts, saveAccount } from "../session.mjs";
import { loginWithCredentials } from "./login.mjs";

function envFor(name, accountName) {
  const upper = String(accountName).toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return process.env[`X_LOGIN_${name}_${upper}`] ?? process.env[`X_LOGIN_${name}`];
}

export function getCredentials(accountName) {
  return {
    username: envFor("USERNAME", accountName),
    password: envFor("PASSWORD", accountName),
  };
}

/**
 * accounts/x_accounts.json に新 cookie を merge して書き戻す
 */
function persistCookies(accountName, login) {
  const cookies = [
    `auth_token=${login.auth_token}`,
    `ct0=${login.ct0}`,
    login.twid && `twid=${login.twid}`,
    login.guest_id && `guest_id=${login.guest_id}`,
    login.kdt && `kdt=${login.kdt}`,
    login.att && `att=${login.att}`,
    "lang=en",
  ].filter(Boolean).join("; ");

  saveAccount(accountName, {
    auth_token: login.auth_token,
    ct0: login.ct0,
    twid: login.twid,
    kdt: login.kdt,
    att: login.att,
    guest_id: login.guest_id,
    user_id: login.user_id,
    cookies,
    refreshed_at: new Date().toISOString(),
    refreshed_via: "auto_relogin",
  });
}

/**
 * accountName に対応する credentials で再ログイン → cookies を保存 → 新 acc を返す
 */
export async function reloginAccount(accountName) {
  const { username, password } = getCredentials(accountName);
  if (!username || !password) {
    throw new Error(
      `credentials missing for ${accountName}: env X_LOGIN_USERNAME_${accountName.toUpperCase()} / X_LOGIN_PASSWORD_${accountName.toUpperCase()} を設定`
    );
  }
  console.error(`[relogin] ${accountName} を再ログイン中...`);
  const login = await loginWithCredentials({ username, password });
  persistCookies(accountName, login);
  console.error(`[relogin] ${accountName} 成功 (auth_token 更新, user_id=${login.user_id})`);
  const all = loadAccounts();
  return all[accountName];
}
