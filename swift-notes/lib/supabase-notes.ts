import { getImagesForNote, type StoredNoteImage } from "./image-db";

export type CloudNote = {
  id: string;
  title: string;
  text: string;
  subject?: string;
  parentNoteId?: string;
};

type DbNotebook = { id: string; name: string };
type DbNote = {
  id: string;
  notebook_id: string;
  source_note_id: string | null;
  title: string;
  content: string;
  kind: string;
};
type DbAttachment = {
  id: string;
  note_id: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  file_size: number;
};

const bucket = "swiftnotes-files";

function config() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!configuredUrl || !key || configuredUrl.includes("your-project") || key.includes("replace_me")) {
    throw new Error("Supabase isn't configured. Add your project URL and publishable key to .env.local.");
  }
  let url: string;
  try {
    // Accept either the project URL or a copied Data API endpoint such as
    // https://<project>.supabase.co/rest/v1; requests below add their own API path.
    url = new URL(configuredUrl).origin;
  } catch {
    throw new Error("The Supabase URL in .env.local is invalid. Use the project URL from Project Settings → Data API.");
  }
  return { url, key };
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = config();
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof Blob ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }
  const responseBody = await response.text();
  if (!responseBody.trim()) return undefined as T;
  try {
    return JSON.parse(responseBody) as T;
  } catch {
    throw new Error("Supabase returned an unreadable response. Please try again.");
  }
}

function noteKind(note: CloudNote): string {
  if (/\bAI\b.*\bsummary\b/i.test(note.title)) return "summary";
  if (/\bAI\b.*\bmind\s*map\b/i.test(note.title)) return "mind_map";
  if (/youtube|video/i.test(note.title)) return "video_notes";
  if (/\bAI\b.*\bnotes\b/i.test(note.title)) return "ai_notes";
  return "manual";
}

function query(value: string) {
  return encodeURIComponent(value);
}

async function getOrCreateNotebook(token: string, userId: string, name: string) {
  const rows = await request<DbNotebook[]>(
    token,
    `/rest/v1/notebooks?select=id,name&owner_id=eq.${query(userId)}`,
  );
  const existing = rows.find((row) => row.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (existing) return existing;
  const [created] = await request<DbNotebook[]>(token, "/rest/v1/notebooks?select=id,name", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ owner_id: userId, name }),
  });
  return created;
}

export async function saveCloudNote(
  token: string,
  userId: string,
  note: CloudNote,
  images: StoredNoteImage[],
  options: { syncAttachments?: boolean } = {},
) {
  const subject = note.subject?.trim() || note.title.trim() || "General";
  const notebook = await getOrCreateNotebook(token, userId, subject);
  await request(token, "/rest/v1/notes?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: note.id,
      owner_id: userId,
      notebook_id: notebook.id,
      source_note_id: note.parentNoteId ?? null,
      title: note.title.trim() || "Untitled note",
      content: note.text,
      kind: noteKind(note),
      source_type: null,
    }),
  });

  // A caller may not have loaded the existing attachment set yet. Save the
  // note while leaving its cloud attachments untouched in that case.
  if (options.syncAttachments === false) return;

  // Attachments are owned by their source note so AI-derived notes can show
  // the same study material. Replace metadata and storage objects together.
  const ownerNoteId = note.parentNoteId ?? note.id;
  const old = await request<DbAttachment[]>(
    token,
    `/rest/v1/attachments?select=id,storage_path&note_id=eq.${query(ownerNoteId)}`,
  );
  const keep = new Set(images.map((image) => image.id));
  const removed = old.filter((item) => !keep.has(item.id));
  if (removed.length) {
    await request(token, `/storage/v1/object/${bucket}`, {
      method: "DELETE",
      body: JSON.stringify({ prefixes: removed.map((item) => item.storage_path) }),
    });
    await request(token, `/rest/v1/attachments?note_id=eq.${query(ownerNoteId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    // Reinsert retained metadata after clearing the old owner rows.
  }

  for (const image of images) {
    const storagePath = `${userId}/${notebook.id}/${ownerNoteId}/${image.id}`;
    const { url, key } = config();
    const upload = await fetch(`${url}/storage/v1/object/${bucket}/${storagePath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        "Content-Type": image.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: image.blob,
    });
    if (!upload.ok) throw new Error(`Supabase attachment upload failed (${upload.status}).`);
    await request(token, "/rest/v1/attachments?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: image.id,
        owner_id: userId,
        note_id: ownerNoteId,
        file_name: image.name ?? "Attachment",
        mime_type: image.type || "application/octet-stream",
        storage_path: storagePath,
        file_size: image.blob.size,
      }),
    });
  }
}

export async function loadCloudNotes(token: string, userId: string) {
  const [notebooks, rows, attachments] = await Promise.all([
    request<DbNotebook[]>(token, `/rest/v1/notebooks?select=id,name&owner_id=eq.${query(userId)}&order=created_at.asc`),
    request<DbNote[]>(token, `/rest/v1/notes?select=id,notebook_id,source_note_id,title,content,kind&owner_id=eq.${query(userId)}&order=created_at.asc`),
    request<DbAttachment[]>(token, `/rest/v1/attachments?select=id,note_id,file_name,mime_type,storage_path,file_size&owner_id=eq.${query(userId)}`),
  ]);
  const notebookNames = new Map(notebooks.map((item) => [item.id, item.name]));
  const notes: CloudNote[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    text: row.content,
    subject: notebookNames.get(row.notebook_id) ?? "General",
    ...(row.source_note_id ? { parentNoteId: row.source_note_id } : {}),
  }));
  const files: Array<{ noteId: string; image: StoredNoteImage }> = [];
  const cachedImageGroups = await Promise.all(
    Array.from(new Set(attachments.map((attachment) => attachment.note_id))).map(
      async (noteId) => getImagesForNote(noteId).catch(() => []),
    ),
  );
  const cachedImagesById = new Map(
    cachedImageGroups.flat().map((image) => [image.id, image]),
  );
  for (const attachment of attachments) {
    const cachedImage = cachedImagesById.get(attachment.id);
    if (cachedImage?.noteId === attachment.note_id) {
      files.push({
        noteId: attachment.note_id,
        image: {
          ...cachedImage,
          type: attachment.mime_type,
          name: attachment.file_name,
        },
      });
      continue;
    }

    const { url, key } = config();
    const sign = await fetch(`${url}/storage/v1/object/sign/${bucket}/${attachment.storage_path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    if (!sign.ok) throw new Error(`Supabase attachment download link failed (${sign.status}).`);
    const { signedURL } = (await sign.json()) as { signedURL: string };
    const blobResponse = await fetch(signedURL.startsWith("http") ? signedURL : `${url}/storage/v1${signedURL}`);
    if (!blobResponse.ok) throw new Error("Couldn't download an attachment from Supabase.");
    files.push({
      noteId: attachment.note_id,
      image: {
        id: attachment.id,
        noteId: attachment.note_id,
        blob: await blobResponse.blob(),
        type: attachment.mime_type,
        createdAt: Date.now(),
        name: attachment.file_name,
      },
    });
  }
  return { notes, files };
}

export async function deleteCloudNote(token: string, noteId: string) {
  const attachments = await request<DbAttachment[]>(token, `/rest/v1/attachments?select=storage_path&note_id=eq.${query(noteId)}`);
  if (attachments.length) {
    await request(token, `/storage/v1/object/${bucket}`, {
      method: "DELETE",
      body: JSON.stringify({ prefixes: attachments.map((item) => item.storage_path) }),
    });
  }
  await request(token, `/rest/v1/notes?id=eq.${query(noteId)}`, { method: "DELETE" });
}

export async function deleteCloudFolder(token: string, folder: string) {
  const notebooks = await request<DbNotebook[]>(token, "/rest/v1/notebooks?select=id,name");
  const notebook = notebooks.find((item) => item.name.toLocaleLowerCase() === folder.toLocaleLowerCase());
  if (!notebook) return;
  const attachments = await request<DbAttachment[]>(token, `/rest/v1/attachments?select=storage_path,note_id`);
  const notes = await request<DbNote[]>(token, `/rest/v1/notes?select=id,notebook_id`);
  const noteIds = new Set(notes.filter((note) => note.notebook_id === notebook.id).map((note) => note.id));
  const paths = attachments.filter((item) => noteIds.has(item.note_id)).map((item) => item.storage_path);
  if (paths.length) {
    await request(token, `/storage/v1/object/${bucket}`, { method: "DELETE", body: JSON.stringify({ prefixes: paths }) });
  }
  await request(token, `/rest/v1/notebooks?id=eq.${query(notebook.id)}`, { method: "DELETE" });
}

export async function renameCloudFolder(
  token: string,
  oldName: string,
  newName: string,
  promotion?: { folderNoteId: string | null; promotedNoteIds: string[] },
) {
  const notebooks = await request<DbNotebook[]>(token, "/rest/v1/notebooks?select=id,name");
  const notebook = notebooks.find((item) => item.name.toLocaleLowerCase() === oldName.toLocaleLowerCase());
  if (!notebook) return;
  await request(token, `/rest/v1/notebooks?id=eq.${query(notebook.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: newName }),
  });
  // Keep the folder's header note and any promoted child in sync with the
  // relationship changes made in the local notebook state.
  const notebookNotes = await request<Array<Pick<DbNote, "id" | "title" | "source_note_id">>>(
    token,
    `/rest/v1/notes?select=id,title,source_note_id&notebook_id=eq.${query(notebook.id)}`,
  );
  const folderNoteId = promotion?.folderNoteId ?? notebookNotes.find(
    (note) =>
      !note.source_note_id &&
      note.title.trim().toLocaleLowerCase() === oldName.trim().toLocaleLowerCase(),
  )?.id;

  if (folderNoteId) {
    await request(token, `/rest/v1/notes?id=eq.${query(folderNoteId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ title: newName }),
    });
  }

  for (const promotedNoteId of promotion?.promotedNoteIds ?? []) {
    await request(token, `/rest/v1/notes?id=eq.${query(promotedNoteId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ source_note_id: null }),
    });
  }
}
