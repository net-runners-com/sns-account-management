// .note ファイルを食わせて下書きを作るCLI
// 使い方: node --env-file=.env post_note_file.mjs <file.note>
import { getClient } from "./session.mjs";
import { postNoteFile } from "./lib/index.mjs";
import { readFileSync } from "fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node post_note_file.mjs <file.note>");
  process.exit(1);
}
const text = readFileSync(file, "utf8");
const client = await getClient();
const r = await postNoteFile(client, text);
console.log("✓ saved draft");
console.log("  noteKey:", r.noteKey);
console.log("  URL:    ", r.editUrl);
