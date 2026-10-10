// Threads ユーザー情報 + interop_messaging_user_fbid 取得 CLI
//
//   node user_fbid.mjs <username>                # 整形 summary (private/business/follower count 等)
//   node user_fbid.mjs --pk 78534392765
//   node user_fbid.mjs <username> --via hiroai   # Bearer 元アカウント指定
//   node user_fbid.mjs <username> --raw          # full IG user object
//   node user_fbid.mjs <username> --json         # 整形 summary を JSON で
//
// 出力フィールド:
//   username, pk, full_name, interop_messaging_user_fbid, fbid_v2
//   is_private, is_verified, is_business, account_type, has_threads
//   follower_count, following_count, media_count
//   biography, external_url, profile_pic_url
//   business: { category_name, public_email, public_phone, address }
import { getInteropFbidByUsername, getInteropFbidMulti } from "./lib/user_lookup.mjs";

const args = process.argv.slice(2);
let username = null, userId = null, viaAccount = null, raw = false, jsonOnly = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--pk" || a === "--user-id") { userId = args[++i]; continue; }
  if (a === "--via" || a === "--account") { viaAccount = args[++i]; continue; }
  if (a === "--raw") { raw = true; continue; }
  if (a === "--json") { jsonOnly = true; continue; }
  if (!a.startsWith("-") && !username) { username = a; continue; }
}

if (!username && !userId) {
  console.error('usage: node user_fbid.mjs (<username> | --pk <user_id>) [--via <account>] [--raw|--json]');
  process.exit(1);
}

try {
  const r = userId
    ? await getInteropFbidMulti({ candidates: [userId], viaAccount })
    : await getInteropFbidByUsername({ username, viaAccount });

  if (!r) {
    console.error("not found");
    process.exit(1);
  }

  if (raw) {
    console.log(JSON.stringify(r.raw, null, 2));
    process.exit(0);
  }

  // summary (raw 除外)
  const { raw: _, ...summary } = r;

  if (jsonOnly) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  // 整形出力
  console.log(`@${summary.username}  (${summary.full_name || "(no name)"})`);
  console.log(`  pk:                          ${summary.pk}`);
  console.log(`  fbid_v2:                     ${summary.fbid_v2 ?? "(null)"}`);
  console.log(`  interop_messaging_user_fbid: ${summary.interop_messaging_user_fbid ?? "❌ DM 不可"}`);
  const acctIcon = summary.is_business ? "🏢" : (summary.is_creator ? "🎨" : "👤");
  console.log(`  is_private:                  ${summary.is_private ? "🔒 非公開" : "公開"}`);
  console.log(`  is_verified:                 ${summary.is_verified ? "✅ 認証済" : "—"}`);
  console.log(`  account_type:                ${acctIcon} ${summary.account_type_label} ${summary.account_type ? `(${summary.account_type})` : ""}`);
  console.log(`  has_threads:                 ${summary.has_threads ? "✅" : "❌"}`);
  console.log(`  follower / following / posts: ${summary.follower_count ?? "?"} / ${summary.following_count ?? "?"} / ${summary.media_count ?? "?"}`);
  if (summary.biography) console.log(`  bio:                         ${summary.biography.slice(0, 80)}${summary.biography.length > 80 ? "..." : ""}`);
  if (summary.external_url) console.log(`  external_url:                ${summary.external_url}`);
  if (summary.business) {
    console.log(`  business:`);
    console.log(`    category:   ${summary.business.category_name ?? "—"}`);
    if (summary.business.public_email) console.log(`    email:      ${summary.business.public_email}`);
    if (summary.business.public_phone) console.log(`    phone:      ${summary.business.public_phone}`);
    if (summary.business.address?.city) console.log(`    address:    ${summary.business.address.street ?? ""} ${summary.business.address.city} ${summary.business.address.zip ?? ""}`);
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
