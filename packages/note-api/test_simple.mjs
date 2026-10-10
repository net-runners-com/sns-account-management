import { getClient } from "./session.mjs";
import { createNoteRaw, saveDraft, elements } from "./lib/index.mjs";

const client = await getClient();

const title = "テスト　テスト";
const { id: noteId, key: noteKey } = await createNoteRaw(client, { title });

const e = elements();
e.p("テスト記事です。");

const body = e.array.join("");
await saveDraft(client, { noteId, title, body });

console.log(`noteId:  ${noteId}`);
console.log(`noteKey: ${noteKey}`);
console.log(`URL:     https://editor.note.com/notes/${noteKey}/edit/`);
