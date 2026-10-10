// プロフィール編集 CLI
//
// 自己紹介を更新:
//   node profile_edit.mjs --bio "新しい自己紹介"
//
// 表示名 / 外部リンク も同時更新:
//   node profile_edit.mjs --bio "..." --name "ハンドルネーム" --url "https://..."
//
// 公開 / 非公開 切替:
//   node profile_edit.mjs --private          # 非公開に
//   node profile_edit.mjs --public           # 公開に
//
// 興味・関心:
//   node profile_edit.mjs --interests "AI,プログラミング,DIY"
//
// Bio リンク (新規追加):
//   node profile_edit.mjs --add-link "https://example.com" --link-title "ポートフォリオ"
//
// Bio リンク (編集):
//   node profile_edit.mjs --edit-link 17979289031844079 --link-url "https://new.url" --link-title "新タイトル"
//
// Bio リンク (削除):
//   node profile_edit.mjs --remove-link 17979289031844079
//
// (link_id は --get で取得)
//
// Instagram バッジ:
//   node profile_edit.mjs --ig-badge on
//   node profile_edit.mjs --ig-badge off
//
// 現在状態の取得:
//   node profile_edit.mjs --get
//
// account は --account or env THREADS_ACCOUNT 必須.
import { editProfile, updateInterests, getProfileEditState, listBioLinks, upsertBioLink, removeBioLink, setInstagramBadge } from "./lib/profile_edit.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
const updates = {};
let interests = null;
let addLinkUrl = null, addLinkTitle = "", addLinkId = null;  // addLinkId 指定で edit
let editLinkId = null, editLinkUrl = null, editLinkTitle = "";
let removeLinkId = null;
let igBadge = null;  // null|true|false
let mode = "edit";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--bio" || a === "--biography") updates.biography = args[++i];
  else if (a === "--name") updates.name = args[++i];
  else if (a === "--username") updates.username = args[++i];
  else if (a === "--url" || a === "--external-url") updates.external_url = args[++i];
  else if (a === "--private") updates.is_private = true;
  else if (a === "--public") updates.is_private = false;
  else if (a === "--interests") interests = args[++i].split(",").map(s => s.trim()).filter(Boolean);
  else if (a === "--add-link") addLinkUrl = args[++i];
  else if (a === "--link-title") addLinkTitle = args[++i];
  else if (a === "--edit-link") editLinkId = args[++i];
  else if (a === "--link-url") editLinkUrl = args[++i];
  else if (a === "--remove-link") removeLinkId = args[++i];
  else if (a === "--ig-badge") {
    const v = args[++i];
    igBadge = v === "on" || v === "true" || v === "1";
  }
  else if (a === "--get") mode = "get";
}

if (!accountName) { console.error("ERROR: --account or env THREADS_ACCOUNT required"); process.exit(1); }

if (mode === "get") {
  // links は別 query で詳細取れる (link_id 付き)
  const r = await listBioLinks({ accountName });
  console.log(`HTTP ${r.http}`);
  console.log("=== bio links (with link_id) ===");
  for (const l of r.links) console.log(`  link_id=${l.link_id}  title="${l.title}"  url=${l.url}`);
  if (r.links.length === 0) console.log("  (no links)");
  process.exit(0);
}

if (Object.keys(updates).length === 0 && !interests && !addLinkUrl && !editLinkId && !removeLinkId && igBadge === null) {
  console.error("usage: node profile_edit.mjs [--bio TEXT] [--name TEXT] [--url URL] [--private | --public]");
  console.error("                              [--interests A,B,C] [--add-link URL --link-title TITLE]");
  console.error("                              [--ig-badge on|off] [--get]");
  process.exit(1);
}

if (Object.keys(updates).length > 0) {
  console.log(`[profile-edit] account=${accountName}  fields=${Object.keys(updates).join(",")}`);
  const r = await editProfile({ accountName, ...updates });
  console.log(`HTTP ${r.http}`);
  if (r.json?.errors) {
    console.error("FAIL:", JSON.stringify(r.json.errors, null, 2).slice(0, 500));
    process.exit(1);
  }
  console.log("✅ profile updated");
}

if (interests) {
  console.log(`[interests] account=${accountName}  tags=[${interests.join(", ")}]`);
  const r = await updateInterests({ accountName, tags: interests });
  console.log(`HTTP ${r.http}`);
  if (r.json?.errors) {
    console.error("FAIL:", JSON.stringify(r.json.errors, null, 2).slice(0, 500));
    process.exit(1);
  }
  console.log("✅ interests updated");
}

if (addLinkUrl) {
  console.log(`[bio-link add] account=${accountName}  url="${addLinkUrl}" title="${addLinkTitle}"`);
  const r = await upsertBioLink({ accountName, url: addLinkUrl, title: addLinkTitle });
  console.log(`HTTP ${r.http}`);
  if (r.json?.errors) {
    console.error("FAIL:", JSON.stringify(r.json.errors, null, 2).slice(0, 500));
    process.exit(1);
  }
  console.log("✅ bio link added");
}

if (editLinkId) {
  if (!editLinkUrl) {
    console.error("ERROR: --edit-link は --link-url <url> も必要");
    process.exit(1);
  }
  console.log(`[bio-link edit] id=${editLinkId} url="${editLinkUrl}" title="${addLinkTitle}"`);
  const r = await upsertBioLink({ accountName, linkId: editLinkId, url: editLinkUrl, title: addLinkTitle });
  console.log(`HTTP ${r.http}`);
  if (r.json?.errors) {
    console.error("FAIL:", JSON.stringify(r.json.errors, null, 2).slice(0, 500));
    process.exit(1);
  }
  console.log("✅ bio link edited");
}

if (removeLinkId) {
  console.log(`[bio-link remove] id=${removeLinkId}`);
  const r = await removeBioLink({ accountName, linkId: removeLinkId });
  console.log(`HTTP ${r.http}`);
  if (r.json?.errors) {
    console.error("FAIL:", JSON.stringify(r.json.errors, null, 2).slice(0, 500));
    process.exit(1);
  }
  console.log("✅ bio link removed");
}

if (igBadge !== null) {
  console.log(`[ig-badge] account=${accountName}  ${igBadge ? "show" : "hide"}`);
  const r = await setInstagramBadge({ accountName, show: igBadge });
  console.log(`HTTP ${r.http}`);
  if (r.json?.errors) {
    console.error("FAIL:", JSON.stringify(r.json.errors, null, 2).slice(0, 500));
    process.exit(1);
  }
  console.log("✅ Instagram badge updated");
}
