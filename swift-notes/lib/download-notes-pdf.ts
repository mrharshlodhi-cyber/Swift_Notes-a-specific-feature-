type PdfLine = { text: string; size: number; bold: boolean; gapBefore: number };

function toPdfText(value: string): string {
  const replacements: Record<string, string> = {
    "•": "-",
    "●": "-",
    "–": "-",
    "—": "-",
    "→": "->",
    "←": "<-",
    "×": "x",
    "÷": "/",
    "≤": "<=",
    "≥": ">=",
    "≠": "!=",
    "≈": "~",
    "π": "pi",
    "√": "sqrt",
    "°": " degrees",
    "’": "'",
    "‘": "'",
    "“": '"',
    "”": '"',
    "…": "...",
  };

  return value
    .replace(/[•●–—→←×÷≤≥≠≈π√°’‘“”…]/g, (character) => replacements[character] ?? character)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(value: string, maxCharacters: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (word.length > maxCharacters) {
      if (line) lines.push(line);
      line = "";
      for (let index = 0; index < word.length; index += maxCharacters) {
        lines.push(word.slice(index, index + maxCharacters));
      }
      continue;
    }

    const nextLine = line ? `${line} ${word}` : word;
    if (nextLine.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function createPdf(title: string, sourceUrl: string, text: string): Blob {
  const pdfTitle = toPdfText(title || "YouTube study notes");
  const safeUrl = toPdfText(sourceUrl);
  const lines: PdfLine[] = [];

  for (const originalLine of text.replace(/\r/g, "").split("\n")) {
    const line = toPdfText(originalLine).trim();
    if (!line) {
      lines.push({ text: "", size: 10, bold: false, gapBefore: 4 });
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const size = headingMatch[1].length <= 2 ? 14 : 12;
      for (const wrapped of wrapText(headingMatch[2], size === 14 ? 66 : 76)) {
        lines.push({ text: wrapped, size, bold: true, gapBefore: 7 });
      }
      continue;
    }

    const isBullet = /^[-*+]\s+/.test(line);
    const isNumbered = /^\d+[.)]\s+/.test(line);
    const cleanLine = line
      .replace(/^[-*+]\s+/, "• ")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
    const wrapped = wrapText(cleanLine, isBullet || isNumbered ? 88 : 94);

    wrapped.forEach((wrappedLine, index) => {
      lines.push({
        text: index > 0 && (isBullet || isNumbered) ? `  ${wrappedLine}` : wrappedLine,
        size: 10,
        bold: false,
        gapBefore: 0,
      });
    });
  }

  const pages: PdfLine[][] = [[]];
  let usedHeight = 0;
  for (const line of lines) {
    const lineHeight = line.size >= 14 ? 21 : line.size >= 12 ? 18 : 14;
    const cost = lineHeight + line.gapBefore;
    if (usedHeight + cost > 620) {
      pages.push([]);
      usedHeight = 0;
    }
    pages[pages.length - 1].push(line);
    usedHeight += cost;
  }

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  const pageObjectIds: number[] = [];
  const firstPageObjectId = 5;
  const firstContentObjectId = firstPageObjectId + pages.length;
  pages.forEach((pageLines, pageIndex) => {
    const pageObjectId = firstPageObjectId + pageIndex;
    const contentObjectId = firstContentObjectId + pageIndex;
    pageObjectIds.push(pageObjectId);

    const commands = ["BT", "/F1 8 Tf", "52 770 Td", "(SWIFTNOTES  |  VIDEO STUDY NOTES) Tj"];
    let y = 743;

    if (pageIndex === 0) {
      const titleLines = wrapText(pdfTitle, 54).slice(0, 3);
      for (const titleLine of titleLines) {
        commands.push(`/F1 18 Tf`, `1 0 0 1 52 ${y} Tm`, `(${escapePdfString(titleLine)}) Tj`);
        y -= 23;
      }
      commands.push("/F1 8 Tf", `1 0 0 1 52 ${y - 1} Tm`, `(Source: ${escapePdfString(safeUrl)}) Tj`);
      y -= 30;
    } else {
      commands.push("/F1 11 Tf", `1 0 0 1 52 ${y} Tm`, `(${escapePdfString(`${pdfTitle} (continued)`.slice(0, 90))}) Tj`);
      y -= 28;
    }

    for (const line of pageLines) {
      y -= line.gapBefore;
      y -= line.size >= 14 ? 21 : line.size >= 12 ? 18 : 14;
      commands.push(
        `/${line.bold ? "F1B" : "F1"} ${line.size} Tf`,
        `1 0 0 1 52 ${y} Tm`,
        `(${escapePdfString(line.text)}) Tj`,
      );
    }

    commands.push("ET");
    const stream = commands.join("\n");
    objects[pageObjectId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R /F1B 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  let document = "%PDF-1.4\n%SwiftNotes\n";
  const offsets = [0];
  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    if (!objects[objectId]) continue;
    offsets[objectId] = document.length;
    document += `${objectId} 0 obj\n${objects[objectId]}\nendobj\n`;
  }

  const objectCount = objects.length;
  const crossReferenceOffset = document.length;
  document += `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let objectId = 1; objectId < objectCount; objectId += 1) {
    document += `${String(offsets[objectId] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`;

  return new Blob([document], { type: "application/pdf" });
}

export function downloadNotesAsPdf(title: string, sourceUrl: string, text: string): void {
  const pdf = createPdf(title, sourceUrl, text);
  const url = URL.createObjectURL(pdf);
  const link = document.createElement("a");
  const filename = (title || "youtube-study-notes")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 90) || "youtube-study-notes";

  link.href = url;
  link.download = `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
