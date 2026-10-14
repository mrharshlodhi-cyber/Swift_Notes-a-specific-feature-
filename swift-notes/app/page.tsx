"use client";

import { extractPdfText } from "../lib/pdf-text";
import { downloadNotesAsPdf } from "../lib/download-notes-pdf";
import {
  Show,
  SignInButton,
  SignUpButton,
  useSession,
  useClerk,
  useUser,
} from "@clerk/nextjs";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";

import {
  deleteImagesForNote,
  getImagesForNote,
  replaceImagesForNote,
  type StoredNoteImage,
} from "../lib/image-db";
import {
  deleteCloudFolder,
  deleteCloudNote,
  loadCloudNotes,
  renameCloudFolder,
  saveCloudNote,
} from "../lib/supabase-notes";

type NoteImage = {
  id: string;
  name: string;
  url: string;
  blob: Blob;
  type: string;
  createdAt: number;
};

type SavedNote = {
  id: string;
  title: string;
  text: string;
  subject?: string;
  parentNoteId?: string;
};

function subjectForNote(note: Pick<SavedNote, "title" | "subject">): string {
  if (note.subject?.trim()) return note.subject.trim();

  // Older notes did not store a subject. Use the start of their title as a
  // helpful folder suggestion, e.g. "DBMS — AI summary" -> "DBMS".
  const inferred = note.title.split(/\s+[—–-]\s+/)[0]?.trim();
  return inferred || "General";
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function isSavedNote(value: unknown): value is SavedNote {
  if (typeof value !== "object" || value === null) return false;

  const note = value as Record<string, unknown>;

  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    typeof note.text === "string"
  );
}

type MindMapNode = {
  id: number;
  label: string;
  children: MindMapNode[];
};

function cleanMindMapLabel(line: string): string {
  let label = line.trim().replace(/\s+%%.*$/, "");

  if (label.startsWith("root((") && label.endsWith("))")) {
    return label.slice(6, -2).trim();
  }

  // Mermaid permits optional node IDs followed by a shape such as id[Label].
  label = label.replace(/^[\w-]+(?=[([{>])/, "");
  return label.replace(/^[\s([\]{>}]+|[\s)\]}]+$/g, "").trim();
}

function parseMindMap(source: string): MindMapNode | null {
  const lines = source
    .replace(/```(?:mermaid)?/gi, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim() && line.trim().toLowerCase() !== "mindmap");

  let root: MindMapNode | null = null;
  const parents: Array<{ indent: number; node: MindMapNode }> = [];

  lines.forEach((line, id) => {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const label = cleanMindMapLabel(line);
    if (!label) return;

    const node: MindMapNode = { id, label, children: [] };

    if (!root) {
      root = node;
      parents.push({ indent, node });
      return;
    }

    while (parents.length > 1 && parents[parents.length - 1].indent >= indent) {
      parents.pop();
    }

    const parent = parents[parents.length - 1].node;
    parent.children.push(node);
    parents.push({ indent, node });
  });

  return root;
}

function isMindMapSource(source: string): boolean {
  const diagramSource = source.trimStart().replace(/^```(?:mermaid)?\s*/i, "");
  return /^mindmap\b/i.test(diagramSource);
}

function MindMapBranch({
  node,
  isRoot = false,
}: {
  node: MindMapNode;
  isRoot?: boolean;
}) {
  return (
    <li className="mindmap-node">
      <div className={isRoot ? "mindmap-label mindmap-root" : "mindmap-label"}>
        {node.label}
      </div>
      {node.children.length > 0 && (
        <ul className="mindmap-children">
          {node.children.map((child) => (
            <MindMapBranch key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function MindMapPreview({ source }: { source: string }) {
  if (!isMindMapSource(source)) return null;

  const root = parseMindMap(source);
  if (!root) return null;

  return (
    <section className="mt-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
      <h2 className="font-semibold text-slate-800">Mind map preview</h2>
      <div className="mindmap-scroll mt-4 rounded-lg bg-white p-4">
        <ul className="mindmap-tree">
          <MindMapBranch node={root} isRoot />
        </ul>
      </div>
    </section>
  );
}

function WelcomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12 text-slate-900">
      <section className="w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
        <div className="grid md:grid-cols-[1.05fr_0.95fr]">
          <div className="p-8 sm:p-12 lg:p-16">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-700">
              SwiftNotes
            </p>
            <h1 className="mt-6 max-w-xl text-4xl font-bold tracking-tight sm:text-5xl">
              Your ideas, organized for learning.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-slate-600">
              Keep your study notes, PDFs, images, summaries, and mind maps
              together in one calm workspace.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <SignUpButton mode="modal">
                <button
                  type="button"
                  className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-800"
                >
                  Create account
                </button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Log in
                </button>
              </SignInButton>
            </div>
            <p className="mt-5 text-sm text-slate-500">
              Your notebook is waiting for you.
            </p>
          </div>
          <div className="relative hidden min-h-[440px] overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 p-10 text-white md:flex md:flex-col md:justify-between">
            <div aria-hidden="true" className="absolute inset-0 opacity-20">
              <div className="absolute -right-16 -top-20 h-72 w-72 rounded-full border-[36px] border-white" />
              <div className="absolute -bottom-24 -left-12 h-72 w-72 rounded-full border-[36px] border-white" />
            </div>
            <div className="relative rounded-2xl border border-white/25 bg-white/10 p-5 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">
                A space for every subject and every kind of note
              </p>
              <div className="mt-5 space-y-3">
                {[
                  "📄  AI study notes",
                  "Mind Maps",
                  "Summary",
                  "Notes from Videos",
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 font-medium"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <p className="relative text-sm text-blue-100">
              Write it yourself. Build on it with AI.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function AccountSidebar({
  noteCount,
  subjectCount,
  onClearDeviceData,
  isBusy,
}: {
  noteCount: number;
  subjectCount: number;
  onClearDeviceData: () => void;
  isBusy: boolean;
}) {
  const { user } = useUser();
  const clerk = useClerk();
  const name = user?.fullName || "Student account";
  const email = user?.primaryEmailAddress?.emailAddress || "Signed in";
  const initials =
    [user?.firstName, user?.lastName]
      .filter(Boolean)
      .map((part) => part?.[0])
      .join("")
      .toUpperCase() || email.slice(0, 1).toUpperCase();

  return (
    <aside className="mb-4 flex min-w-0 flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:sticky lg:top-6 lg:mb-0 lg:h-[calc(100vh-3rem)] lg:w-64 lg:shrink-0">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-700">
          SwiftNotes
        </p>
        <p className="mt-1 text-sm text-slate-500">Your study workspace</p>
      </div>

      <section className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="px-1 pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Your account
        </p>
        <div className="flex min-w-0 items-center gap-3">
          {user?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-800">
              {initials}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">
              {name}
            </p>
            <p className="truncate text-xs text-slate-500" title={email}>
              {email}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => clerk.openUserProfile()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"
          >
            Manage account
          </button>
          <button
            type="button"
            onClick={() => void clerk.signOut({ redirectUrl: "/" })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={onClearDeviceData}
            disabled={isBusy}
            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-left text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear this device’s data
          </button>
          <p className="px-1 text-xs leading-5 text-slate-500">
            Clears this account’s local copy only. Synced notes remain in your
            account.
          </p>
        </div>
      </section>

      <section className="rounded-xl bg-blue-50/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
          Workspace
        </p>
        <p className="mt-3 font-semibold text-slate-800">My notebook</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {noteCount} {noteCount === 1 ? "saved item" : "saved items"} across{" "}
          {subjectCount} {subjectCount === 1 ? "subject" : "subjects"}
        </p>
      </section>

      <p className="mt-auto hidden border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500 lg:block">
        Your notes and study materials, organized by subject.
      </p>
    </aside>
  );
}

export default function Home() {
  const { isLoaded: clerkLoaded, user } = useUser();
  const { session } = useSession();
  const sessionRef = useRef(session);
  const sessionId = session?.id ?? null;
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const userId = user?.id ?? null;
  const activeUserId = useRef(userId);
  const notesStorageKey = userId ? `swiftnotes-notes:${userId}` : null;
  const [notesOwnerId, setNotesOwnerId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [images, setImages] = useState<NoteImage[]>([]);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<
    string | null
  >(null);
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [parentNoteId, setParentNoteId] = useState<string | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(
    null,
  );
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [folderNotebookId, setFolderNotebookId] = useState<string | null>(null);
  const [folderRenameMode, setFolderRenameMode] = useState(false);
  const [isExtractedTextDraft, setIsExtractedTextDraft] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeNotes, setYoutubeNotes] = useState<{
    title: string;
    text: string;
  } | null>(null);

  // Temporary preview URLs (attachment id -> blob URL) so we can release them.
  const imageUrls = useRef(new Map<string, string>());
  // Lets a newer load or clear cancel an older, slower one.
  const imageLoadId = useRef(0);
  const loadedImageOwners = useRef(new Set<string>());
  // True when attachments were added or removed since the last save or open.
  const imagesChanged = useRef(false);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const persistNotes = useCallback(
    (nextNotes: SavedNote[]) => {
      if (!notesStorageKey) {
        throw new Error("A signed-in account is required to save notes.");
      }

      localStorage.setItem(notesStorageKey, JSON.stringify(nextNotes));
    },
    [notesStorageKey],
  );

  const clearTemporaryImages = useCallback(() => {
    imageLoadId.current += 1;
    imageUrls.current.forEach((url) => URL.revokeObjectURL(url));
    imageUrls.current.clear();
    imagesChanged.current = false;
    setImages([]);
    setSelectedAttachmentId(null);
  }, []);

  const loadImagesForNote = useCallback(async (noteId: string) => {
    const thisLoadId = ++imageLoadId.current;

    try {
      const savedImages = await getImagesForNote(noteId);

      // Ignore an older request if the user switched notes while it was loading.
      if (thisLoadId !== imageLoadId.current) return;
      loadedImageOwners.current.add(noteId);

      const visibleImages: NoteImage[] = savedImages.map((image) => ({
        id: image.id,
        name: image.name ?? "Attachment",
        blob: image.blob,
        type: image.type,
        createdAt: image.createdAt,
        url: URL.createObjectURL(image.blob),
      }));

      visibleImages.forEach((image) => {
        imageUrls.current.set(image.id, image.url);
      });

      // Keep anything added while the load was in flight.
      setImages((previous) => [...visibleImages, ...previous]);
    } catch {
      if (thisLoadId === imageLoadId.current) {
        setStatus("Couldn't load this note's attachments.");
      }
    }
  }, []);

  // Release preview URLs when the component unmounts.
  useEffect(() => {
    const urls = imageUrls.current;

    return () => {
      imageLoadId.current += 1;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  // Ask the browser not to evict our stored notes and attachments.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => {});
  }, []);

  // Cloud data is the source of truth after the first successful sync. Keep a
  // per-account browser copy so a temporary network/config issue can't erase
  // access to notes already on this device.
  useEffect(() => {
    activeUserId.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!clerkLoaded || !userId || !notesStorageKey || !sessionId) return;
    let cancelled = false;

    async function hydrate() {
      setNotesOwnerId(null);
      loadedImageOwners.current.clear();
      clearTemporaryImages();
      setNotes([]);
      setSelectedNoteId(null);
      setParentNoteId(null);
      setExpandedFolderKeys(new Set());
      setSubject("");
      setTitle("");
      setText("");
      setStatus(null);

      try {
        const token = await sessionRef.current?.getToken();
        if (!token)
          throw new Error("Clerk didn't provide a Supabase session token.");
        let cloud = await loadCloudNotes(token, userId!);
        if (cancelled || activeUserId.current !== userId) return;

        if (cloud.notes.length > 0) {
          const migrationKey = `swiftnotes-cloud-migrated:${userId}`;
          if (localStorage.getItem(migrationKey) !== "true") {
            const cached = localStorage.getItem(notesStorageKey!);
            const cachedValue: unknown = cached ? JSON.parse(cached) : [];
            const cachedNotes = Array.isArray(cachedValue)
              ? cachedValue.filter(isSavedNote)
              : [];
            const remoteIds = new Set(cloud.notes.map((note) => note.id));
            const synchronizedAttachmentOwners = new Set(
              cloud.files.map((file) => file.noteId),
            );
            for (const localNote of cachedNotes.filter(
              (note) => !remoteIds.has(note.id),
            )) {
              const ownerNoteId = localNote.parentNoteId ?? localNote.id;
              const syncAttachments =
                !synchronizedAttachmentOwners.has(ownerNoteId);
              const localImages = syncAttachments
                ? await getImagesForNote(ownerNoteId)
                : [];
              await saveCloudNote(token, userId!, localNote, localImages, {
                syncAttachments,
              });
              synchronizedAttachmentOwners.add(ownerNoteId);
            }
            localStorage.setItem(migrationKey, "true");
            if (cachedNotes.some((note) => !remoteIds.has(note.id))) {
              cloud = await loadCloudNotes(token, userId!);
            }
          }
          persistNotes(cloud.notes);
          for (const note of cloud.notes) {
            const noteImages = cloud.files
              .filter((file) => file.noteId === note.id)
              .map((file) => file.image);
            await replaceImagesForNote(note.id, noteImages);
          }
          setNotes(cloud.notes);
          const firstNote = cloud.notes[0];
          setSelectedNoteId(firstNote.id);
          setParentNoteId(firstNote.parentNoteId ?? null);
          setSubject(subjectForNote(firstNote));
          setTitle(firstNote.title);
          setText(firstNote.text);
          setNotesOwnerId(userId);
          void loadImagesForNote(firstNote.parentNoteId ?? firstNote.id);
          return;
        }

        const migrationKey = `swiftnotes-cloud-migrated:${userId}`;
        if (localStorage.getItem(migrationKey) === "true") {
          // An empty cloud after a completed migration means the user's notes
          // were deleted. Do not resurrect them from an older device cache.
          persistNotes([]);
          setNotes([]);
          localStorage.removeItem("swiftnotes-notes");
          localStorage.removeItem("swiftnotes-note");
          setNotesOwnerId(userId);
          return;
        }

        // First-time migration: move this account's local notes and files to
        // Supabase. Keep the browser copy if any upload fails, so it can retry.
        let savedNotes = localStorage.getItem(notesStorageKey!);
        if (savedNotes === null) {
          savedNotes = localStorage.getItem("swiftnotes-notes");
        }
        const oldNote = localStorage.getItem("swiftnotes-note");
        let loadedNotes: SavedNote[] = [];
        if (savedNotes !== null) {
          const parsed: unknown = JSON.parse(savedNotes);
          loadedNotes = Array.isArray(parsed) ? parsed.filter(isSavedNote) : [];
        } else if (oldNote) {
          const parsed: unknown = JSON.parse(oldNote);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "title" in parsed &&
            "text" in parsed &&
            typeof parsed.title === "string" &&
            typeof parsed.text === "string"
          ) {
            loadedNotes = [
              {
                id: crypto.randomUUID(),
                title: parsed.title,
                text: parsed.text,
                subject: subjectForNote({ title: parsed.title }),
              },
            ];
          }
        }
        persistNotes(loadedNotes);
        setNotes(loadedNotes);
        for (const note of loadedNotes) {
          const ownerNoteId = note.parentNoteId ?? note.id;
          const noteImages = await getImagesForNote(ownerNoteId);
          await saveCloudNote(token, userId!, note, noteImages);
        }
        if (loadedNotes.length > 0) {
          const firstNote = loadedNotes[0];
          setSelectedNoteId(firstNote.id);
          setParentNoteId(firstNote.parentNoteId ?? null);
          setSubject(subjectForNote(firstNote));
          setTitle(firstNote.title);
          setText(firstNote.text);
          void loadImagesForNote(firstNote.parentNoteId ?? firstNote.id);
        }
        localStorage.removeItem("swiftnotes-notes");
        localStorage.removeItem("swiftnotes-note");
        localStorage.setItem(`swiftnotes-cloud-migrated:${userId}`, "true");
        setNotesOwnerId(userId);
        setStatus(
          loadedNotes.length > 0
            ? "Your existing notes are now synced to Supabase."
            : null,
        );
      } catch (error) {
        if (cancelled) return;
        console.error("Could not load the notebook from Supabase.", error);
        // Cloud is unavailable or not yet linked: retain and show the local copy.
        try {
          const cached =
            localStorage.getItem(notesStorageKey!) ??
            localStorage.getItem("swiftnotes-notes");
          const parsed: unknown = cached ? JSON.parse(cached) : [];
          const loadedNotes = Array.isArray(parsed)
            ? parsed.filter(isSavedNote)
            : [];
          setNotes(loadedNotes);
          if (loadedNotes.length) {
            const firstNote = loadedNotes[0];
            setSelectedNoteId(firstNote.id);
            setParentNoteId(firstNote.parentNoteId ?? null);
            setSubject(subjectForNote(firstNote));
            setTitle(firstNote.title);
            setText(firstNote.text);
            void loadImagesForNote(firstNote.parentNoteId ?? firstNote.id);
          }
          setStatus(
            "Supabase isn't connected yet; showing this device's saved copy. Check the Supabase and Clerk connection, then try again.",
          );
        } catch {
          setStatus("Couldn't load notes from Supabase or this browser.");
        }
        setNotesOwnerId(userId);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [
    clerkLoaded,
    userId,
    notesStorageKey,
    sessionId,
    loadImagesForNote,
    clearTemporaryImages,
    persistNotes,
  ]);

  const canSave =
    title.trim().length > 0 || text.trim().length > 0 || images.length > 0;

  function hasUnsavedChanges(ignorePendingAttachmentChanges = false) {
    const saved = notes.find((note) => note.id === selectedNoteId);
    const untouchedFolderDefaults =
      selectedFolderName !== null &&
      subject.trim() === selectedFolderName.trim() &&
      title.trim() === selectedFolderName.trim() &&
      text.trim() === "";

    const textChanged = saved
      ? saved.title !== title ||
        saved.text !== text ||
        subjectForNote(saved) !== subject.trim()
      : !untouchedFolderDefaults &&
        (subject.trim() !== "" || title.trim() !== "" || text.trim() !== "");

    return (
      textChanged || (!ignorePendingAttachmentChanges && imagesChanged.current)
    );
  }

  function confirmDiscard(ignorePendingAttachmentChanges = false) {
    return (
      !hasUnsavedChanges(ignorePendingAttachmentChanges) ||
      window.confirm("Discard your unsaved changes?")
    );
  }

  function handleNewNote() {
    if (!confirmDiscard()) return;

    clearTemporaryImages();
    setSelectedNoteId(null);
    setParentNoteId(null);
    setSelectedFolderName(null);
    setFolderNotebookId(null);
    setFolderRenameMode(false);
    setIsExtractedTextDraft(false);
    setSubject("");
    setTitle("");
    setText("");
    setStatus("New note started. Save it when you’re ready.");
  }

  async function handleClearDeviceData() {
    if (!userId || !notesStorageKey || isBusy) return;
    if (
      !window.confirm(
        "Clear this account's saved notes and attachments from this device? This won't delete notes synced to Supabase. Any unsynced local work will be removed and may not be recoverable.",
      )
    ) {
      return;
    }

    let cachedNotes: SavedNote[] = [];
    try {
      const cached = localStorage.getItem(notesStorageKey);
      try {
        const parsed: unknown = cached ? JSON.parse(cached) : [];
        cachedNotes = Array.isArray(parsed) ? parsed.filter(isSavedNote) : [];
      } catch {
        // Remove a malformed cache too; current in-memory notes still identify
        // the attachment owners that can be safely cleared.
      }
      localStorage.removeItem(notesStorageKey);
    } catch {
      setStatus(
        "Couldn't clear this device's notes. Check browser storage and try again.",
      );
      return;
    }

    setIsBusy(true);
    try {
      const attachmentOwners = new Set(
        [...notes, ...cachedNotes].map((note) => note.parentNoteId ?? note.id),
      );
      loadedImageOwners.current.forEach((noteId) =>
        attachmentOwners.add(noteId),
      );
      [parentNoteId, selectedNoteId, folderNotebookId].forEach((id) => {
        if (id) attachmentOwners.add(id);
      });

      const cleanupResults = await Promise.allSettled(
        Array.from(attachmentOwners, (noteId) => deleteImagesForNote(noteId)),
      );

      clearTemporaryImages();
      loadedImageOwners.current.clear();
      setNotes([]);
      setSelectedNoteId(null);
      setParentNoteId(null);
      setSelectedFolderName(null);
      setFolderNotebookId(null);
      setFolderRenameMode(false);
      setIsExtractedTextDraft(false);
      setSubject("");
      setTitle("");
      setText("");
      setYoutubeNotes(null);

      setStatus(
        cleanupResults.every((result) => result.status === "fulfilled")
          ? "This device's saved copy was cleared. Your Supabase notes are unchanged and will return when you sign in again."
          : "The local notes list was cleared, but some attachment files couldn't be removed from this device.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  function handleSelectNote(note: SavedNote) {
    clearTemporaryImages();
    setSelectedNoteId(note.id);
    setParentNoteId(note.parentNoteId ?? null);
    setSelectedFolderName(subjectForNote(note));
    setFolderNotebookId(null);
    setFolderRenameMode(false);
    setIsExtractedTextDraft(false);
    setSubject(subjectForNote(note));
    setTitle(note.title);
    setText(note.text);
    setStatus(`Opened "${note.title || "Untitled note"}".`);
    // Generated notes show the source notebook's attachments beside them.
    void loadImagesForNote(note.parentNoteId ?? note.id);
  }

  function handleSelectFolder(folder: string) {
    if (isBusy) return;

    const folderItems = notes.filter(
      (note) =>
        subjectForNote(note).toLocaleLowerCase() === folder.toLocaleLowerCase(),
    );
    const topLevelItems = folderItems.filter((note) => !note.parentNoteId);
    const folderNote =
      topLevelItems.find(
        (note) =>
          note.title.trim().toLocaleLowerCase() ===
          folder.trim().toLocaleLowerCase(),
      ) ??
      topLevelItems.find(
        (note) =>
          note.title.trim().toLocaleLowerCase() !== "untitled note" &&
          !/\s+[—–-]\s+AI\s+(?:study\s+)?(?:notes|summary|mind\s+map)$/i.test(
            note.title,
          ),
      ) ??
      topLevelItems.find(
        (note) =>
          !/\s+[—–-]\s+AI\s+(?:study\s+)?(?:notes|summary|mind\s+map)$/i.test(
            note.title,
          ),
      );

    if (folderNote) {
      handleSelectNote(folderNote);
      setSelectedFolderName(folder);
      setFolderNotebookId(folderNote.id);
      setFolderRenameMode(true);
      setIsExtractedTextDraft(false);
      return;
    }

    clearTemporaryImages();
    setSelectedNoteId(null);
    setParentNoteId(null);
    setSelectedFolderName(folder);
    setFolderNotebookId(null);
    setFolderRenameMode(true);
    setIsExtractedTextDraft(false);
    setSubject(folder);
    setTitle(folder);
    setText("");
    setStatus(`Opened the ${folder} folder.`);
  }

  async function handleSave() {
    if (isBusy) return;

    const requestedFolderName = title.trim();
    if (
      !isExtractedTextDraft &&
      folderRenameMode &&
      selectedFolderName &&
      requestedFolderName &&
      requestedFolderName.toLocaleLowerCase() !==
        selectedFolderName.toLocaleLowerCase()
    ) {
      const oldFolder = selectedFolderName;
      const nextFolder = requestedFolderName;
      const renamedNotes = notes.map((note) => {
        if (
          subjectForNote(note).toLocaleLowerCase() !==
          oldFolder.toLocaleLowerCase()
        ) {
          return note;
        }

        const isFolderNotebook =
          note.id === folderNotebookId ||
          (!note.parentNoteId &&
            note.title.trim().toLocaleLowerCase() ===
              oldFolder.toLocaleLowerCase());
        const alreadyNamedAsFolder =
          note.title.trim().toLocaleLowerCase() ===
          nextFolder.toLocaleLowerCase();

        if (isFolderNotebook) {
          return {
            ...note,
            title: nextFolder,
            subject: nextFolder,
            parentNoteId: undefined,
          };
        }

        if (alreadyNamedAsFolder) {
          // Promote a previously-created same-name child to be the folder's
          // notebook, instead of leaving a duplicate note inside the folder.
          return { ...note, subject: nextFolder, parentNoteId: undefined };
        }

        return { ...note, subject: nextFolder };
      });

      setIsBusy(true);
      try {
        const token = await session?.getToken();
        if (!token)
          throw new Error("Please sign in again to sync this folder.");
        const folderNoteId =
          folderNotebookId ??
          notes.find(
            (note) =>
              !note.parentNoteId &&
              subjectForNote(note).toLocaleLowerCase() ===
                oldFolder.toLocaleLowerCase() &&
              note.title.trim().toLocaleLowerCase() ===
                oldFolder.toLocaleLowerCase(),
          )?.id ??
          null;
        const promotedNoteIds = notes
          .filter(
            (note) =>
              note.id !== folderNoteId &&
              note.parentNoteId !== undefined &&
              subjectForNote(note).toLocaleLowerCase() ===
                oldFolder.toLocaleLowerCase() &&
              note.title.trim().toLocaleLowerCase() ===
                nextFolder.toLocaleLowerCase(),
          )
          .map((note) => note.id);
        await renameCloudFolder(token, oldFolder, nextFolder, {
          folderNoteId,
          promotedNoteIds,
        });
        persistNotes(renamedNotes);
        setNotes(renamedNotes);
        setSubject(nextFolder);
        setTitle(nextFolder);
        setSelectedFolderName(nextFolder);
        setFolderNotebookId(
          renamedNotes.find(
            (note) =>
              !note.parentNoteId &&
              note.title.trim().toLocaleLowerCase() ===
                nextFolder.toLocaleLowerCase(),
          )?.id ?? null,
        );
        setStatus(`Renamed the folder to "${nextFolder}".`);
      } catch {
        setStatus(
          "Couldn't rename the folder in Supabase. Check the Clerk–Supabase connection and try again.",
        );
      } finally {
        setIsBusy(false);
      }
      return;
    }

    const id = selectedNoteId ?? crypto.randomUUID();
    const existingNote = notes.find((note) => note.id === selectedNoteId);
    const oldFolder =
      selectedFolderName ?? (existingNote ? subjectForNote(existingNote) : "");
    const isNotebookFolder = Boolean(
      existingNote &&
      !existingNote.parentNoteId &&
      folderNotebookId === existingNote.id,
    );
    const titleDefinesFolder = Boolean(
      selectedFolderName &&
      title.trim() &&
      title.trim().toLocaleLowerCase() !== oldFolder.toLocaleLowerCase(),
    );
    const nextFolder =
      isNotebookFolder && titleDefinesFolder
        ? title.trim()
        : subject.trim() || title.trim() || "General";

    const noteToSave: SavedNote = {
      id,
      subject: nextFolder,
      ...(parentNoteId ? { parentNoteId } : {}),
      title,
      text,
    };

    const isRenamingFolder =
      !isExtractedTextDraft &&
      selectedFolderName !== null &&
      oldFolder.toLocaleLowerCase() !== nextFolder.toLocaleLowerCase() &&
      (isNotebookFolder || selectedNoteId === null);

    if (
      isRenamingFolder &&
      selectedNoteId === null &&
      existingNote === undefined
    ) {
      // This path handles folders that have files but no top-level notebook
      // note to select; keep it so those legacy folders can still be renamed.
      const renamedNotes = notes.map((note) =>
        subjectForNote(note).toLocaleLowerCase() ===
        oldFolder.toLocaleLowerCase()
          ? { ...note, subject: nextFolder }
          : note,
      );

      setIsBusy(true);
      try {
        const token = await session?.getToken();
        if (!token)
          throw new Error("Please sign in again to sync this folder.");
        await renameCloudFolder(token, oldFolder, nextFolder);
        persistNotes(renamedNotes);
        setNotes(renamedNotes);
        setSubject(nextFolder);
        setSelectedFolderName(nextFolder);
        setStatus(`Renamed folder to "${nextFolder}".`);
      } catch {
        setStatus(
          "Couldn't rename the folder in Supabase. Check the Clerk–Supabase connection and try again.",
        );
      } finally {
        setIsBusy(false);
      }
      return;
    }
    const updatedNotes = notes.some((note) => note.id === id)
      ? notes.map((note) => {
          if (note.id === id) return noteToSave;
          if (
            isRenamingFolder &&
            subjectForNote(note).toLocaleLowerCase() ===
              oldFolder.toLocaleLowerCase()
          ) {
            return { ...note, subject: nextFolder };
          }
          return note;
        })
      : [...notes, noteToSave];

    const imageOwnerId = noteToSave.parentNoteId ?? id;
    const hasSavedImageOwner = notes.some(
      (note) => (note.parentNoteId ?? note.id) === imageOwnerId,
    );
    if (
      imagesChanged.current &&
      hasSavedImageOwner &&
      !loadedImageOwners.current.has(imageOwnerId)
    ) {
      setStatus(
        "Please wait for the saved attachments to finish loading, then save again.",
      );
      return;
    }
    const syncAttachments = imagesChanged.current || !hasSavedImageOwner;
    const imagesToSave: StoredNoteImage[] = images.map((image) => ({
      id: image.id,
      noteId: imageOwnerId,
      blob: image.blob,
      type: image.type,
      createdAt: image.createdAt,
      name: image.name,
    }));

    setIsBusy(true);

    let priorAttachments: StoredNoteImage[] | null = null;
    let attachmentsReplaced = false;
    try {
      // Save the notes list first. If that fails, don't report success.
      persistNotes(updatedNotes);

      // Save this note's attachments, removing any the user removed.
      if (syncAttachments) {
        priorAttachments = await getImagesForNote(imageOwnerId);
        await replaceImagesForNote(imageOwnerId, imagesToSave);
        attachmentsReplaced = true;
      }
      const token = await sessionRef.current?.getToken();
      if (!token || !userId)
        throw new Error("Please sign in again to sync this note.");
      await saveCloudNote(token, userId, noteToSave, imagesToSave, {
        syncAttachments,
      });

      // Best-effort cleanup of the old single-note key.
      try {
        localStorage.removeItem("swiftnotes-note");
      } catch {
        // The new saved-notes list is already stored.
      }

      if (syncAttachments) imagesChanged.current = false;
      setNotes(updatedNotes);
      if (isExtractedTextDraft) {
        const folderNote = updatedNotes.find(
          (note) => note.id === noteToSave.parentNoteId && !note.parentNoteId,
        );
        setSelectedNoteId(folderNote?.id ?? null);
        setParentNoteId(null);
        setSubject(nextFolder);
        setSelectedFolderName(nextFolder);
        setFolderNotebookId(folderNote?.id ?? null);
        setFolderRenameMode(true);
        setTitle(folderNote?.title ?? nextFolder);
        setText(folderNote?.text ?? "");
        setIsExtractedTextDraft(false);
        setStatus(`Saved extracted PDF text as a file in ${nextFolder}.`);
      } else {
        setSelectedNoteId(id);
        setSubject(nextFolder);
        setSelectedFolderName(nextFolder);
        setFolderNotebookId(isNotebookFolder ? id : null);
        setStatus("Note and attachments saved to your notebook.");
      }
    } catch (error) {
      if (attachmentsReplaced && priorAttachments) {
        try {
          await replaceImagesForNote(imageOwnerId, priorAttachments);
        } catch {
          // Keep the original save error visible; attachment rollback is best effort.
        }
      }

      // Put storage back to what's on screen.
      try {
        persistNotes(notes);
      } catch {
        // Nothing more we can do.
      }

      console.error("Couldn't sync this note.", error);
      setStatus(
        "Couldn't sync this note. Check the Supabase and Clerk connection, then try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (isBusy) return;

    const note = notes.find((item) => item.id === id);
    const label = note?.title || "Untitled note";

    if (
      !window.confirm(
        `Delete "${label}" and its attachments? This can't be undone.`,
      )
    ) {
      return;
    }

    setIsBusy(true);

    try {
      const updatedNotes = notes.filter((item) => item.id !== id);

      const token = await session?.getToken();
      if (!token) throw new Error("Please sign in again to delete this note.");
      await deleteCloudNote(token, id);

      let localNotesSaved = true;
      try {
        // Keep [] in storage when the last note is deleted. This prevents
        // the old single-note key from restoring an already-deleted note.
        persistNotes(updatedNotes);
      } catch {
        localNotesSaved = false;
      }

      // The cloud delete succeeded, so reflect it in the UI even if updating
      // the browser cache failed. Hydration will reconcile that cache later.
      setNotes(updatedNotes);

      let imagesDeleted = true;

      try {
        await deleteImagesForNote(id);
      } catch {
        imagesDeleted = false;
      }

      if (selectedNoteId === id) {
        const nextNote = updatedNotes[0] ?? null;

        clearTemporaryImages();
        setSelectedNoteId(nextNote?.id ?? null);
        setParentNoteId(nextNote?.parentNoteId ?? null);
        setSubject(nextNote ? subjectForNote(nextNote) : "");
        setTitle(nextNote?.title ?? "");
        setText(nextNote?.text ?? "");

        if (nextNote) {
          void loadImagesForNote(nextNote.parentNoteId ?? nextNote.id);
        }
      }

      // Best-effort cleanup of the old single-note key.
      try {
        localStorage.removeItem("swiftnotes-note");
      } catch {
        // The saved-notes list is already stored.
      }

      setStatus(
        !localNotesSaved
          ? imagesDeleted
            ? "Note deleted from Supabase, but the browser cache couldn't be updated."
            : "Note deleted from Supabase, but the browser cache and some attachments couldn't be updated."
          : imagesDeleted
            ? "Note and attachments deleted from Supabase."
            : "Note deleted, but its attachments couldn't be removed from storage.",
      );
    } catch {
      setStatus(
        "Couldn't delete this note from Supabase. Check the Clerk–Supabase connection and try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteFolder(folder: string) {
    if (isBusy) return;

    const folderNotes = notes.filter(
      (note) =>
        subjectForNote(note).toLocaleLowerCase() === folder.toLocaleLowerCase(),
    );
    if (folderNotes.length === 0) return;

    const itemLabel = folderNotes.length === 1 ? "saved item" : "saved items";
    const draftWillBeDiscarded =
      selectedFolderName?.toLocaleLowerCase() === folder.toLocaleLowerCase() &&
      hasUnsavedChanges();
    const draftWarning = draftWillBeDiscarded
      ? " Your unsaved changes in this folder will also be discarded."
      : "";
    if (
      !window.confirm(
        `Delete the "${folder}" folder and its ${folderNotes.length} ${itemLabel}, including their attachments? This can't be undone.${draftWarning}`,
      )
    ) {
      return;
    }

    setIsBusy(true);
    try {
      const folderNoteIds = new Set(folderNotes.map((note) => note.id));
      const updatedNotes = notes.filter(
        (note) =>
          subjectForNote(note).toLocaleLowerCase() !==
          folder.toLocaleLowerCase(),
      );

      let token: string | null | undefined;
      try {
        token = await session?.getToken();
        if (!token)
          throw new Error("Please sign in again to delete this folder.");
        await deleteCloudFolder(token, folder);
      } catch {
        setStatus(
          "Couldn't delete this folder from Supabase. Check the Clerk–Supabase connection and try again.",
        );
        return;
      }

      let localNotesSaved = true;
      try {
        persistNotes(updatedNotes);
      } catch {
        localNotesSaved = false;
      }

      // Supabase has deleted the folder; don't leave stale folder contents on
      // screen if this browser cannot persist the updated local list.
      setNotes(updatedNotes);

      const attachmentOwners = new Set(
        folderNotes.map((note) => note.parentNoteId ?? note.id),
      );
      const deletionResults = await Promise.allSettled(
        Array.from(attachmentOwners, (noteId) => deleteImagesForNote(noteId)),
      );
      const attachmentsDeleted = deletionResults.every(
        (result) => result.status === "fulfilled",
      );

      if (
        selectedFolderName?.toLocaleLowerCase() ===
          folder.toLocaleLowerCase() ||
        (selectedNoteId !== null && folderNoteIds.has(selectedNoteId)) ||
        (parentNoteId !== null && folderNoteIds.has(parentNoteId))
      ) {
        clearTemporaryImages();
        setSelectedNoteId(null);
        setParentNoteId(null);
        setSelectedFolderName(null);
        setFolderNotebookId(null);
        setFolderRenameMode(false);
        setSubject("");
        setTitle("");
        setText("");
      }

      setStatus(
        !localNotesSaved
          ? attachmentsDeleted
            ? `Deleted the "${folder}" folder from Supabase, but the browser cache couldn't be updated.`
            : `Deleted the "${folder}" folder from Supabase, but the browser cache and some attachments couldn't be updated.`
          : attachmentsDeleted
            ? `Deleted the "${folder}" folder and its contents.`
            : `Deleted the "${folder}" folder, but some attachments couldn't be removed from browser storage.`,
      );
    } finally {
      setIsBusy(false);
    }
  }

  function addAttachment(blob: Blob, name: string) {
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(blob);

    imageUrls.current.set(id, url);
    imagesChanged.current = true;

    setImages((previous) => [
      ...previous,
      {
        id,
        name,
        url,
        blob,
        type: blob.type,
        createdAt: Date.now(),
      },
    ]);

    setStatus(null);
  }

  function removeImage(id: string) {
    const url = imageUrls.current.get(id);

    if (url) {
      URL.revokeObjectURL(url);
      imageUrls.current.delete(id);
    }

    imagesChanged.current = true;
    setImages((previous) => previous.filter((image) => image.id !== id));
    setSelectedAttachmentId((selected) => (selected === id ? null : selected));
  }

  function handlePasteEvent(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFile = Array.from(event.clipboardData.files).find((file) =>
      file.type.startsWith("image/"),
    );

    if (!imageFile) return;

    const hasText = event.clipboardData.getData("text/plain").length > 0;

    if (!hasText) event.preventDefault();

    addAttachment(imageFile, imageFile.name || "Pasted snapshot");
  }

  function handleFiles(
    event: ChangeEvent<HTMLInputElement>,
    kind: "pdf" | "image",
  ) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";

    const problems: string[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        problems.push(`${file.name} is over 10 MB.`);
        continue;
      }

      if (kind === "pdf") {
        const isPdf =
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf");

        if (!isPdf) {
          problems.push(`${file.name} is not a PDF.`);
          continue;
        }

        // Some browsers leave the type empty, which would make the blob
        // download instead of opening, so set it explicitly.
        addAttachment(file.slice(0, file.size, "application/pdf"), file.name);
      } else {
        if (!IMAGE_TYPES.includes(file.type)) {
          problems.push(`${file.name} must be a PNG, JPEG, WebP, or GIF.`);
          continue;
        }

        addAttachment(file, file.name);
      }
    }

    // Set once, after the loop, so an error isn't wiped by a later good file.
    setStatus(problems.length > 0 ? problems.join(" ") : null);
  }

  async function handleExtractPdf(image: NoteImage) {
    if (isBusy) return;
    if (!confirmDiscard(true)) return;

    setIsBusy(true);
    setStatus(`Extracting text from ${image.name}...`);

    try {
      const extractedText = await extractPdfText(image.blob);

      if (!extractedText.trim()) {
        setStatus(
          "No selectable text found. This may be a scanned PDF; OCR will be a later step.",
        );
        return;
      }

      const currentFolder =
        subject.trim() ||
        selectedFolderName?.trim() ||
        (selectedNoteId
          ? subjectForNote(
              notes.find((note) => note.id === selectedNoteId) ?? {
                title: image.name,
              },
            )
          : "General");
      const sourceId = parentNoteId ?? selectedNoteId ?? folderNotebookId;

      // Extraction creates a separate saved file, rather than changing the
      // selected folder's same-name notebook note.
      setSubject(currentFolder);
      setSelectedFolderName(currentFolder);
      setFolderRenameMode(false);
      setFolderNotebookId(null);
      setIsExtractedTextDraft(true);
      setSelectedNoteId(null);
      setParentNoteId(sourceId ?? null);
      setTitle(`${image.name} — Extracted text`);
      setText(`--- Extracted from ${image.name} ---\n\n${extractedText}`);

      setStatus(
        `Text extracted into a new draft in ${currentFolder}. Click Save note to add it to that folder.`,
      );
    } catch (error) {
      console.error("PDF text extraction failed:", error);
      const details = error instanceof Error ? error.message : String(error);
      setStatus(`Couldn't extract text from ${image.name}: ${details}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function generateStudyNotes(
    source: Record<string, unknown>,
    statusMessage: string,
    alreadyBusy = false,
    options: {
      ignorePendingAttachmentChanges?: boolean;
      keepAttachments?: boolean;
    } = {},
  ) {
    if (isBusy && !alreadyBusy) return;

    if (
      !alreadyBusy &&
      !confirmDiscard(options.ignorePendingAttachmentChanges)
    ) {
      return;
    }

    setIsBusy(true);
    setStatus(statusMessage);

    try {
      const response = await fetch("/api/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source),
      });
      const result: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "AI couldn't generate notes. Please try again.";
        setStatus(message);
        return;
      }

      if (
        typeof result !== "object" ||
        result === null ||
        !("title" in result) ||
        typeof result.title !== "string" ||
        !("text" in result) ||
        typeof result.text !== "string"
      ) {
        setStatus("The AI response was incomplete. Please try again.");
        return;
      }

      // Keep generated material in the folder of the note it came from.
      // An explicitly selected subject folder takes precedence over its title.
      const sourceFolder =
        subject.trim() ||
        title.trim() ||
        (typeof source.sourceTitle === "string"
          ? source.sourceTitle.trim()
          : "") ||
        "General";
      setSubject(sourceFolder);
      // File the result inside the notebook it came from, and keep that
      // notebook's materials on screen.
      const sourceNotebookId = parentNoteId ?? selectedNoteId;
      if (sourceNotebookId) {
        setParentNoteId(sourceNotebookId);
      } else if (!options.keepAttachments) {
        clearTemporaryImages();
      }
      // A generated title belongs to the new file. Don't let folder
      // rename-on-save treat this programmatic title change as a folder rename.
      setFolderRenameMode(false);
      setFolderNotebookId(null);
      setSelectedNoteId(null);
      setTitle(result.title);
      setText(result.text);
      const taskLabel =
        source.task === "summary"
          ? "summary"
          : source.task === "mindmap"
            ? "mind map"
            : source.task === "formulas"
              ? "formulas"
              : "notes";
      setStatus(
        `AI ${taskLabel} ${taskLabel === "formulas" ? "are" : "is"} ready to edit. Select Save note to keep it.`,
      );
    } catch (error) {
      console.error("AI note generation failed:", error);
      setStatus(
        "Couldn't generate notes. Check your connection and try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Could not read the image."));
          return;
        }
        resolve(reader.result.slice(reader.result.indexOf(",") + 1));
      };
      reader.readAsDataURL(blob);
    });
  }

  async function handleGenerateFromSelectedAttachment(
    task: "notes" | "summary" | "mindmap" | "formulas",
  ) {
    const attachment = images.find(
      (image) => image.id === selectedAttachmentId,
    );
    if (isBusy || !attachment) return;
    if (!confirmDiscard(true)) return;

    setIsBusy(true);
    const taskLabel = task === "mindmap" ? "mind map" : task;
    setStatus(`Preparing ${attachment.name} for AI ${taskLabel}...`);

    try {
      const sourceImages: Array<{ mimeType: string; data: string }> = [];
      let content = "";
      if (
        attachment.type === "application/pdf" ||
        attachment.name.toLowerCase().endsWith(".pdf")
      ) {
        const pdfText = await extractPdfText(attachment.blob);
        if (!pdfText.trim()) {
          setStatus(
            `No selectable text found in ${attachment.name}. Scanned-PDF OCR is a later step.`,
          );
          return;
        }
        content = `--- Extracted from ${attachment.name} ---\n${pdfText}`;
      } else {
        sourceImages.push({
          mimeType: attachment.type,
          data: await blobToBase64(attachment.blob),
        });
      }

      await generateStudyNotes(
        {
          sourceType: "study",
          task,
          sourceTitle: attachment.name,
          content,
          images: sourceImages,
        },
        `Asking AI to create ${taskLabel} from ${attachment.name}...`,
        true,
        {
          ignorePendingAttachmentChanges: true,
          keepAttachments: true,
        },
      );
    } catch (error) {
      console.error(`AI ${taskLabel} generation failed:`, error);
      setStatus(
        `Couldn't prepare ${attachment.name} for AI. Please try again.`,
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleGenerateFromYoutube() {
    const url = youtubeUrl.trim();
    if (!url) {
      setStatus("Paste a public YouTube video URL first.");
      return;
    }

    if (isBusy) return;

    setIsBusy(true);
    setYoutubeNotes(null);
    setStatus("Asking AI to study the public YouTube video...");

    try {
      const response = await fetch("/api/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "youtube",
          sourceTitle: "YouTube video",
          videoUrl: url,
        }),
      });
      const result: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "AI couldn't generate video notes. Please try again.";
        setStatus(message);
        return;
      }

      if (
        typeof result !== "object" ||
        result === null ||
        !("title" in result) ||
        typeof result.title !== "string" ||
        !("text" in result) ||
        typeof result.text !== "string"
      ) {
        setStatus("The AI response was incomplete. Please try again.");
        return;
      }

      setYoutubeNotes({ title: result.title, text: result.text });
      setStatus(
        "Video notes are ready. Preview them here or download the PDF.",
      );
    } catch (error) {
      console.error("YouTube note generation failed:", error);
      setStatus(
        "Couldn't generate video notes. Check your connection and try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveYoutubeNotes() {
    if (!youtubeNotes || isBusy) return;

    const noteToSave: SavedNote = {
      id: crypto.randomUUID(),
      subject: subject.trim() || title.trim() || "General",
      title: youtubeNotes.title,
      text: youtubeNotes.text,
    };
    const updatedNotes = [...notes, noteToSave];

    setIsBusy(true);
    try {
      const token = await session?.getToken();
      if (!token || !userId)
        throw new Error("Please sign in again to sync these notes.");
      await saveCloudNote(token, userId, noteToSave, []);
      persistNotes(updatedNotes);
      setNotes(updatedNotes);
      setStatus(
        `Video notes saved to your ${noteToSave.subject} folder in Supabase.`,
      );
    } catch {
      setStatus(
        "Couldn't save these video notes to Supabase. Check the Clerk–Supabase connection and try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleGenerate(
    kind: "notes" | "summary" | "mindmap" | "formulas",
  ) {
    await handleGenerateFromSelectedAttachment(kind);
  }

  const showingMindMap = isMindMapSource(text);
  const isFolderRenamePending = Boolean(
    !isExtractedTextDraft &&
    folderRenameMode &&
    selectedFolderName &&
    title.trim() &&
    title.trim().toLocaleLowerCase() !== selectedFolderName.toLocaleLowerCase(),
  );
  const selectedSavedNote = notes.find((note) => note.id === selectedNoteId);
  const currentAttachmentFolder =
    selectedFolderName?.trim() ||
    (selectedSavedNote ? subjectForNote(selectedSavedNote) : null);
  const attachmentsVisible =
    !currentAttachmentFolder ||
    expandedFolderKeys.has(currentAttachmentFolder.toLocaleLowerCase());
  const isFileRenamePending = Boolean(
    !isExtractedTextDraft &&
    selectedSavedNote &&
    title.trim() &&
    title.trim() !== selectedSavedNote.title.trim() &&
    !(
      folderNotebookId === selectedSavedNote.id &&
      !selectedSavedNote.parentNoteId
    ),
  );

  // A subject folder contains its saved notes directly. The note whose title
  // matches the folder is the folder's source notebook, not a duplicate file.
  const subjectGroups = Object.entries(
    notes.reduce<Record<string, { name: string; notes: SavedNote[] }>>(
      (groups, note) => {
        const name = subjectForNote(note);
        const key = name.toLocaleLowerCase();
        (groups[key] ??= { name, notes: [] }).notes.push(note);
        return groups;
      },
      {},
    ),
  )
    .map(([, group]) => [group.name, group.notes] as [string, SavedNote[]])
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const savedFileCount = subjectGroups.reduce((count, [folder, folderNotes]) => {
    const folderNotebook = folderNotes.find(
      (note) =>
        !note.parentNoteId &&
        note.title.trim().toLocaleLowerCase() ===
          folder.trim().toLocaleLowerCase(),
    );
    return count + folderNotes.length - (folderNotebook ? 1 : 0);
  }, 0);

  function renderNoteRow(note: SavedNote) {
    const isSelected = selectedNoteId === note.id;

    return (
      <li
        key={note.id}
        className={`flex min-w-0 items-center gap-2 rounded-lg border p-2 transition-colors ${
          isSelected
            ? "border-blue-300 bg-blue-50"
            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        <button
          type="button"
          onClick={() => handleSelectNote(note)}
          disabled={isBusy}
          className="min-w-0 flex-1 px-2 py-1.5 text-left font-medium text-slate-800 disabled:opacity-50"
          title={note.title || "Untitled note"}
        >
          <span className="block truncate">
            {note.title || "Untitled note"}
          </span>
          {isSelected && (
            <span className="mt-0.5 block text-xs font-normal text-blue-700">
              Currently open
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => void handleDelete(note.id)}
          disabled={isBusy}
          aria-label={`Delete ${note.title || "Untitled note"}`}
          title="Delete note"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ×
        </button>
      </li>
    );
  }

  return (
    <>
      <Show when="signed-out">
        <WelcomePage />
      </Show>
      <Show when="signed-in">
        {userId && notesOwnerId === userId ? (
          <main className="min-h-screen bg-slate-100 p-3 text-slate-900 sm:p-4 lg:flex lg:items-start lg:gap-4 lg:p-5">
            <AccountSidebar
              noteCount={savedFileCount}
              subjectCount={subjectGroups.length}
              onClearDeviceData={() => void handleClearDeviceData()}
              isBusy={isBusy}
            />
            <section className="mx-auto min-w-0 max-w-7xl flex-1 rounded-2xl bg-white p-4 shadow sm:p-5 lg:min-h-[calc(100vh-2.5rem)]">
              <h1 className="mt-2 text-3xl font-bold">My notebook</h1>

              <p className="mt-2 text-slate-600">
                Write a note, paste video snapshots, and attach PDFs to study
                them.
              </p>

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:items-start">
                <div className="min-w-0">
                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold">Saved notes</h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {savedFileCount} {savedFileCount === 1 ? "note" : "notes"}{" "}
                        in your notebook
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleNewNote}
                      disabled={isBusy}
                      className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
                    >
                      New note
                    </button>
                  </div>

                  {notes.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">
                      No saved notes yet. Write one below and select Save note.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2 pr-1 lg:max-h-[26vh] lg:overflow-y-auto">
                      {subjectGroups.map(([folder, folderNotes]) => {
                        const folderNotebook = folderNotes.find(
                          (note) =>
                            !note.parentNoteId &&
                            note.title.trim().toLocaleLowerCase() ===
                              folder.trim().toLocaleLowerCase(),
                        );
                        const folderFiles = folderNotes.filter(
                          (note) => note.id !== folderNotebook?.id,
                        );

                        return (
                          <div
                            key={folder}
                            className="relative overflow-hidden rounded-xl border border-slate-200 bg-white"
                          >
                            <details>
                              <summary
                                onClick={(event) => {
                                  const details = event.currentTarget.parentElement;
                                  if (!(details instanceof HTMLDetailsElement)) return;
                                  if (isBusy) {
                                    event.preventDefault();
                                    return;
                                  }

                                  const folderKey = folder.toLocaleLowerCase();
                                  if (details.open) {
                                    setExpandedFolderKeys((current) => {
                                      const next = new Set(current);
                                      next.delete(folderKey);
                                      return next;
                                    });
                                    if (
                                      selectedFolderName?.toLocaleLowerCase() ===
                                      folderKey
                                    ) {
                                      setSelectedAttachmentId(null);
                                    }
                                    setStatus(`Closed "${folder}".`);
                                  } else {
                                    setExpandedFolderKeys((current) =>
                                      new Set(current).add(folderKey),
                                    );
                                    handleSelectFolder(folder);
                                  }
                                }}
                                className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50 px-4 py-3 pr-14 font-semibold text-slate-800 hover:bg-slate-100"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span aria-hidden="true">📁</span>
                                  <span className="truncate">{folder}</span>
                                </span>
                                <span className="shrink-0 text-xs font-normal text-slate-500">
                                  {folderFiles.length}{" "}
                                  {folderFiles.length === 1 ? "file" : "files"}
                                </span>
                              </summary>

                              {folderFiles.length > 0 && (
                                <ul className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
                                  {folderFiles.map((file) =>
                                    renderNoteRow(file),
                                  )}
                                </ul>
                              )}
                            </details>
                            <button
                              type="button"
                              onClick={() => void handleDeleteFolder(folder)}
                              disabled={isBusy}
                              aria-label={`Delete ${folder} folder and all its contents`}
                              title={`Delete ${folder} folder`}
                              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white text-lg text-slate-400 shadow-sm transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <label className="mt-4 block font-medium" htmlFor="title">
                    Note title
                  </label>

                  <input
                    id="title"
                    className="mt-2 w-full rounded-lg border border-slate-300 p-3"
                    placeholder="For example: ER Model lecture"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />

                  {showingMindMap ? (
                    <div className="mt-6">
                      <MindMapPreview source={text} />
                    </div>
                  ) : (
                    <>
                      <label className="mt-4 block font-medium" htmlFor="note">
                        Note
                      </label>

                      <textarea
                        id="note"
                        className="mt-2 h-54 min-h-[160px] w-full resize-y rounded-lg border border-slate-300 p-4"
                        placeholder="Write something, or copy an image and press Ctrl/Cmd+V here..."
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        onPaste={handlePasteEvent}
                      />
                    </>
                  )}
                </div>

                <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <h2 className="mb-4 font-semibold">Study sources</h2>
                  {images.length > 0 && attachmentsVisible && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 lg:max-h-[24vh] lg:overflow-y-auto">
                      <ul className="flex flex-wrap gap-3">
                        {images.map((image) => {
                          const isImage = image.type.startsWith("image/");

                          const isSelected = selectedAttachmentId === image.id;

                          return (
                            <li
                              key={image.id}
                              className={`relative h-28 w-28 rounded-lg ${isSelected ? "ring-2 ring-blue-600 ring-offset-2" : ""}`}
                            >
                              {isImage ? (
                                <>
                                  <a
                                    href={image.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open ${image.name} full size`}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={image.url}
                                      alt={image.name}
                                      className="h-28 w-28 rounded-lg border border-slate-200 object-cover"
                                    />
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedAttachmentId((selected) =>
                                        selected === image.id ? null : image.id,
                                      )
                                    }
                                    disabled={isBusy}
                                    aria-pressed={isSelected}
                                    aria-label={`${isSelected ? "Selected" : "Select"} ${image.name} for AI tools`}
                                    className={`absolute bottom-1 left-1 rounded px-2 py-1 text-[10px] text-white disabled:opacity-50 ${isSelected ? "bg-emerald-700" : "bg-slate-700 hover:bg-slate-800"}`}
                                  >
                                    {isSelected ? "Selected" : "Select"}
                                  </button>
                                </>
                              ) : (
                                <div className="flex h-28 w-28 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-2 text-center">
                                  <a
                                    href={image.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full truncate text-xs hover:underline"
                                  >
                                    <span className="block font-bold text-red-700">
                                      PDF
                                    </span>
                                    {image.name}
                                  </a>

                                  <button
                                    type="button"
                                    onClick={() => void handleExtractPdf(image)}
                                    disabled={isBusy}
                                    className="mt-2 rounded border border-slate-300 px-2 py-1 text-[10px] hover:bg-white disabled:opacity-50"
                                  >
                                    Extract text
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedAttachmentId((selected) =>
                                        selected === image.id ? null : image.id,
                                      )
                                    }
                                    disabled={isBusy}
                                    aria-pressed={isSelected}
                                    aria-label={`${isSelected ? "Selected" : "Select"} ${image.name} for AI tools`}
                                    className={`mt-1 rounded px-2 py-1 text-[10px] text-white disabled:opacity-50 ${isSelected ? "bg-emerald-700" : "bg-slate-700 hover:bg-slate-800"}`}
                                  >
                                    {isSelected ? "Selected" : "Select"}
                                  </button>
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => removeImage(image.id)}
                                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-sm shadow"
                                aria-label={`Remove ${image.name}`}
                              >
                                ×
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <label htmlFor="youtube-url" className="block font-medium">
                      Generate notes from a YouTube video
                    </label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        id="youtube-url"
                        type="url"
                        value={youtubeUrl}
                        onChange={(event) => {
                          setYoutubeUrl(event.target.value);
                          setYoutubeNotes(null);
                        }}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white p-3"
                        disabled={isBusy}
                      />
                      <button
                        type="button"
                        onClick={() => void handleGenerateFromYoutube()}
                        disabled={isBusy || !youtubeUrl.trim()}
                        className="rounded-lg bg-blue-700 px-4 py-2 text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Generate notes
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Works with public individual videos. Playlist links aren’t
                      supported yet.
                    </p>
                    {youtubeNotes && (
                      <section className="mt-4 rounded-xl border border-blue-200 bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-slate-900">
                              {youtubeNotes.title}
                            </h3>
                            <p className="mt-1 text-xs text-slate-500">
                              AI study notes from this video
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleSaveYoutubeNotes}
                              className="rounded-lg border border-blue-700 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                            >
                              Save in{" "}
                              {subject.trim() || title.trim() || "General"}{" "}
                              folder
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                downloadNotesAsPdf(
                                  youtubeNotes.title,
                                  youtubeUrl,
                                  youtubeNotes.text,
                                )
                              }
                              className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
                            >
                              Download PDF
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                          {youtubeNotes.text}
                        </div>
                      </section>
                    )}
                  </div>
                  <div className="mt-10 flex flex-wrap gap-x-2 gap-y-3">
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={!canSave || isBusy}
                      className="rounded-lg bg-blue-700 px-4 py-2 text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isBusy
                        ? "Working..."
                        : isExtractedTextDraft
                          ? `Save file in ${subject.trim() || selectedFolderName || "subject folder"}`
                          : isFolderRenamePending
                            ? "Rename folder"
                            : isFileRenamePending
                              ? "Rename file"
                              : "Save note"}
                    </button>

                    <button
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                      disabled={isBusy}
                      className="rounded-lg border border-blue-700 px-4 py-2 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Upload PDF
                    </button>

                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      onChange={(event) => handleFiles(event, "pdf")}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isBusy}
                      className="rounded-lg border border-blue-700 px-4 py-2 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Upload image
                    </button>

                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      onChange={(event) => handleFiles(event, "image")}
                      className="hidden"
                    />

                    <div className="flex basis-full flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleGenerate("notes")}
                        disabled={!selectedAttachmentId || isBusy}
                        className="rounded-lg bg-blue-700 px-4 py-2 text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        AI notes
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleGenerate("summary")}
                        disabled={!selectedAttachmentId || isBusy}
                        className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Summary
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleGenerate("mindmap")}
                        disabled={!selectedAttachmentId || isBusy}
                        className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Mind map
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleGenerate("formulas")}
                        disabled={!selectedAttachmentId || isBusy}
                        className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Formulas
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {selectedAttachmentId
                      ? `AI tools will use ${images.find((image) => image.id === selectedAttachmentId)?.name ?? "the selected attachment"} only.`
                      : "Select an attachment above to make AI notes, summary, mind maps, or formulas."}
                  </p>
                </div>
              </div>

              {status && (
                <p role="status" className="mt-4 text-sm text-slate-600">
                  {status}
                </p>
              )}
            </section>
          </main>
        ) : (
          <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-slate-600">
            <p>Opening your notebook…</p>
          </main>
        )}
      </Show>
    </>
  );
}
