# SwiftNotes

SwiftNotes is a study workspace for organizing notes, PDFs, images, and AI-generated study materials into subject folders.

## ✨ Key Features

- Organize saved notes as files inside subject folders.
- Write notes and paste screenshots directly into the notebook.
- Upload PDFs and images as study attachments.
- Extract selectable text from PDFs into a saved note.
- Generate AI study notes, summaries, mind maps, and formula lists from a selected attachment.
- Generate study notes from public individual YouTube videos.
- Keep notes and attachments synchronized with Supabase across signed-in sessions.
- Export notes as PDF.

## 🛠️ Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **UI:** React 19, Tailwind CSS 4
- **Authentication:** Clerk
- **Database and file storage:** Supabase (Postgres and private Storage bucket)
- **AI:** Google Gemini API
- **PDF processing:** `pdfjs-dist`

## 🤖 AI Study Pipeline

### Input Sources

- Selected image or PDF attachment
- Note text and attached snapshots
- Public individual YouTube video URL

### Processing

- Select an attachment and choose AI notes, summary, mind map, or formulas.
- For PDFs, SwiftNotes extracts selectable text in the browser before sending it for AI processing. Scanned PDFs without selectable text need OCR, which is not currently included.
- Image data or extracted text is sent to the signed-in app's server endpoint. The server checks the request and calls Gemini using a server-side API key.
- YouTube generation sends the public video URL to the server endpoint.

### Generated Results

Generated material appears as an editable draft in the notebook. Choose **Save note** to store it as a file in the relevant folder.

## 📁 Project Structure

```text
swift-notes/
├── app/
│   ├── api/generate-notes/   # Signed-in AI generation endpoint
│   ├── globals.css           # Global styles and mind-map styles
│   ├── layout.tsx            # App layout and providers
│   └── page.tsx               # Notebook interface and workflows
├── lib/
│   ├── image-db.ts            # Browser IndexedDB attachment cache
│   ├── pdf-text.ts            # PDF text extraction
│   └── supabase-notes.ts      # Supabase database and Storage operations
├── public/                    # Static assets and PDF.js worker
├── supabase/migrations/       # Database, RLS, and Storage setup SQL
├── .env.example               # Placeholder environment-variable template
└── package.json
```

## ⚙️ Installation & Setup

### Prerequisites

- Node.js and npm
- A Clerk application
- A Supabase project configured to accept Clerk authentication
- A Gemini API key from Google AI Studio

### 1. Clone the Repository

```bash
git clone https://github.com/mrharshlodhi-cyber/Swift_Notes-a-specific-feature-.git
cd Swift_Notes-a-specific-feature-/swift-notes
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env.local` and fill in the values from Clerk, Supabase, and Google AI Studio:

```powershell
Copy-Item .env.example .env.local
```

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
GEMINI_API_KEY=your_gemini_api_key
```

Keep `.env.local` private. Never commit it or expose secret keys in client-side code.

### 4. Configure Supabase

1. In Supabase Authentication, enable Clerk as a third-party authentication provider.
2. In the Supabase SQL Editor, apply the SQL migration files in `supabase/migrations/` in timestamp order.
3. Confirm the `swiftnotes-files` Storage bucket is private and its policies are present.

The migrations create the notebooks, notes, and attachments tables, user-scoped RLS policies, the private Storage bucket, and table grants.

### 5. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🔄 Application Workflow

1. Sign in through Clerk.
2. Create or open a subject folder and write a note, paste an image, or upload a study attachment.
3. Save notes and attachments; note records sync to Supabase Postgres and file contents sync to Supabase Storage.
4. Select an attachment to extract PDF text or request an AI result.
5. Edit generated drafts if needed, then save them as files in the folder.

## 🔐 Privacy & Security Notes

- Clerk identifies the signed-in user; Supabase RLS policies restrict database rows to that user's Clerk ID.
- The `swiftnotes-files` bucket is private. Storage policies restrict file access to the signed-in user's folder.
- The AI generation endpoint requires a signed-in user before calling Gemini.
- Selected source content is sent to Gemini when an AI generation action is requested.
- `.env.local` contains credentials and must remain private. `.env.example` contains placeholders only.

## 🚧 Limitations

- YouTube generation supports public individual videos; playlist links are not supported.
- PDF extraction reads selectable text. Scanned PDFs require OCR, which is not currently supported.
- AI results can be incomplete or incorrect; review generated study material before relying on it.
- AI generation requires a valid Gemini API key and is subject to provider availability and usage limits.

## 🔮 Future Improvements

Possible improvements for later versions:

- OCR support for scanned PDFs.
- Per-user AI usage limits and quota tracking.
- A user-controlled backup and restore workflow.

## 🎯 Project Objective

SwiftNotes aims to give students one organized place to collect study materials, write notes, and turn selected sources into useful study aids.

## 👤 Author

Created by [@mrharshlodhi-cyber](https://github.com/mrharshlodhi-cyber).
