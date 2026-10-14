export async function extractPdfText(file: Blob): Promise<string> {
  const pdfjs = await import("pdfjs-dist");

  // Let the bundler resolve the worker from node_modules, so it always
  // matches the installed pdfjs-dist version.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const loadingTask = pdfjs.getDocument({
    data: await file.arrayBuffer(),
  });
  const pdf = await loadingTask.promise;

  try {
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      const pageText = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("")
        .trim();

      pageTexts.push(`Page ${pageNumber}\n${pageText}`);
    }

    return pageTexts.join("\n\n");
  } finally {
    await loadingTask.destroy();
  }
}
