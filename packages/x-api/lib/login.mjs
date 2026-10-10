// X (Twitter) 自動ログイン (username + password)
// /i/api/1.1/onboarding/task.json の subtask 状態機械を進めて auth_token / ct0 を取得
//
// 注意: X の bot 検知は厳しい. 失敗パターン:
//   - 2FA 有効アカウント → LoginTwoFactorAuthChallenge で停止 (TODO 対応可)
//   - captcha 要求       → ArkoseLogin で停止 (突破不可)
//   - phone verify 要求  → LoginAcid で停止
//   - account locked    → code 326 / 88
//
// 使用例:
//   import { loginWithCredentials } from "./lib/login.mjs";
//   const { auth_token, ct0, user_id } = await loginWithCredentials({ username, password });
import { X_WEB_BEARER } from "../session.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const SUBTASK_VERSIONS = {
  action_list: 2, alert_dialog: 1, app_download_cta: 1, check_logged_in_account: 1,
  choice_selection: 3, contacts_live_sync_permission_prompt: 0, cta: 7, email_verification: 2,
  end_flow: 1, enter_date: 1, enter_email: 2, enter_password: 5, enter_phone: 2,
  enter_recaptcha: 1, enter_text: 5, enter_username: 2, generic_urt: 3,
  in_app_notification: 1, interest_picker: 3, js_instrumentation: 1, menu_dialog: 1,
  notifications_permission_prompt: 2, open_account: 2, open_home_timeline: 1,
  open_link: 1, phone_verification: 4, privacy_options: 1, security_key: 3,
  select_avatar: 4, select_banner: 2, settings_list: 7, show_code: 1, sign_up: 2,
  sign_up_review: 4, tweet_selection_urt: 1, update_users: 1, upload_media: 1,
  user_recommendations_list: 4, user_recommendations_urt: 1, wait_spinner: 3,
  web_modal: 1,
};

class LoginError extends Error {
  constructor(message, { stage, subtaskId, body } = {}) {
    super(message);
    this.name = "XLoginError";
    this.stage = stage;
    this.subtaskId = subtaskId;
    this.body = body;
  }
}

function pickCookie(setCookieHeader, name) {
  if (!setCookieHeader) return null;
  const re = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`);
  const m = setCookieHeader.match(re);
  return m ? m[1] : null;
}

/**
 * Set-Cookie ヘッダー全部から所定 cookie 集約
 * Node fetch の getSetCookie() を使う
 */
function collectCookies(response, jar) {
  const arr =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  for (const line of arr) {
    const m = line.match(/^([^=]+)=([^;]+)/);
    if (m) jar[m[1]] = m[2];
  }
}

function jarToCookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * 1. guest_token 取得
 */
async function getGuestToken() {
  const r = await fetch("https://api.x.com/1.1/guest/activate.json", {
    method: "POST",
    headers: {
      Authorization: X_WEB_BEARER,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
  });
  if (r.status !== 200) {
    throw new LoginError(`guest_token 取得失敗 HTTP ${r.status}`, { stage: "guest_token" });
  }
  const j = await r.json();
  if (!j.guest_token) throw new LoginError("guest_token missing in response", { stage: "guest_token", body: j });
  return j.guest_token;
}

/**
 * onboarding/task.json POST. flow_token + subtasks を返す.
 */
async function postTask(body, { guestToken, flowName, jar }) {
  const url = flowName
    ? `https://api.x.com/1.1/onboarding/task.json?flow_name=${encodeURIComponent(flowName)}`
    : "https://api.x.com/1.1/onboarding/task.json";
  const headers = {
    Authorization: X_WEB_BEARER,
    "Content-Type": "application/json",
    "User-Agent": UA,
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    "x-guest-token": guestToken,
  };
  if (jar.ct0) headers["x-csrf-token"] = jar.ct0;
  if (Object.keys(jar).length) headers.Cookie = jarToCookieHeader(jar);

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  collectCookies(r, jar);
  let j = null;
  try { j = await r.json(); } catch {}
  if (r.status >= 400 || j?.errors) {
    throw new LoginError(
      `task ${flowName || "(continue)"} HTTP ${r.status}: ${JSON.stringify(j?.errors || j).slice(0, 300)}`,
      { stage: "task", body: j }
    );
  }
  return { json: j, status: r.status };
}

/**
 * X username + password でログインして cookie を取得
 *
 * @param {object} opts
 * @param {string} opts.username  screen_name / email / phone
 * @param {string} opts.password
 * @returns {Promise<{auth_token, ct0, user_id, screen_name, allCookies}>}
 */
export async function loginWithCredentials({ username, password } = {}) {
  if (!username || !password) throw new Error("username + password required");

  const guestToken = await getGuestToken();
  const jar = { gt: guestToken };

  // STEP 1: flow init
  const initBody = {
    input_flow_data: {
      flow_context: {
        debug_overrides: {},
        start_location: { location: "manual_link" },
      },
    },
    subtask_versions: SUBTASK_VERSIONS,
  };
  let { json: state } = await postTask(initBody, { guestToken, flowName: "login", jar });

  // 状態機械を進める. 安全のため最大 12 step.
  for (let step = 0; step < 12; step++) {
    const subtasks = state?.subtasks || [];
    if (subtasks.length === 0) {
      // 完了 (LoginSuccessSubtask は subtasks=[] になることがある)
      break;
    }
    const sub = subtasks[0];
    const id = sub.subtask_id;
    let respPayload = null;

    switch (id) {
      case "LoginJsInstrumentationSubtask":
        respPayload = {
          subtask_id: id,
          js_instrumentation: { response: "{}", link: "next_link" },
        };
        break;
      case "LoginEnterUserIdentifierSSO":
        respPayload = {
          subtask_id: id,
          settings_list: {
            setting_responses: [
              {
                key: "user_identifier",
                response_data: { text_data: { result: username } },
              },
            ],
            link: "next_link",
          },
        };
        break;
      case "LoginEnterAlternateIdentifierSubtask":
        // email / phone 確認要求
        respPayload = {
          subtask_id: id,
          enter_text: { text: username, link: "next_link" },
        };
        break;
      case "LoginEnterPassword":
        respPayload = {
          subtask_id: id,
          enter_password: { password, link: "next_link" },
        };
        break;
      case "AccountDuplicationCheck":
        respPayload = {
          subtask_id: id,
          check_logged_in_account: { link: "AccountDuplicationCheck_false" },
        };
        break;
      case "LoginTwoFactorAuthChallenge":
        throw new LoginError(
          "2FA 有効. TOTP コードが必要 (現在自動入力非対応). 一時的に 2FA OFF にするか b 案 (Chrome cookie import) を使ってください.",
          { stage: id, subtaskId: id }
        );
      case "LoginAcid":
        throw new LoginError(
          "LoginAcid (email/phone verify) 要求. 自動継続不可. ログインを web から手動完了してください.",
          { stage: id, subtaskId: id }
        );
      case "ArkoseLogin":
        throw new LoginError(
          "Captcha (Arkose) 要求. 自動突破不可. b 案 (Chrome cookie import) を使ってください.",
          { stage: id, subtaskId: id }
        );
      case "DenyLoginSubtask":
        throw new LoginError("Login denied (X 側で拒否)", { stage: id, subtaskId: id, body: sub });
      case "LoginSuccessSubtask":
      case "OpenAccount":
      case "open_account":
        // 成功
        step = 999;
        break;
      default:
        throw new LoginError(`未知の subtask: ${id}`, { stage: id, subtaskId: id, body: sub });
    }

    if (step >= 999) break;

    const next = await postTask(
      { flow_token: state.flow_token, subtask_inputs: [respPayload] },
      { guestToken, flowName: null, jar }
    );
    state = next.json;
  }

  if (!jar.auth_token || !jar.ct0) {
    throw new LoginError("auth_token / ct0 が cookie jar に到着しなかった", { stage: "final", body: { jar } });
  }

  // user_id (twid) も cookie から取れる
  const twidRaw = jar.twid || "";
  const m = decodeURIComponent(twidRaw).match(/u=(\d+)/);
  const user_id = m ? m[1] : null;

  return {
    auth_token: jar.auth_token,
    ct0: jar.ct0,
    twid: jar.twid,
    kdt: jar.kdt,
    att: jar.att,
    guest_id: jar.guest_id,
    user_id,
    allCookies: { ...jar },
  };
}
