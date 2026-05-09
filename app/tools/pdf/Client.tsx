"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { formatBytes } from "@/lib/format";

type Mode = "merge" | "extract";

type LoadedPdf = {
  id: string;
  file: File;
  pageCount: number;
};

export default function PdfPage() {
  const tool = findTool("pdf")!;
  const [mode, setMode] = useState<Mode>("merge");

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          {([
            { id: "merge", label: "Merge", sub: "combine PDFs" },
            { id: "extract", label: "Extract", sub: "pull pages out" },
          ] as { id: Mode; label: string; sub: string }[]).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`flex flex-col items-start rounded-[var(--radius-card)] border-2 border-ink px-4 py-2 text-left transition-colors ${
                mode === m.id
                  ? "bg-teal text-cream"
                  : "bg-cream hover:bg-teal-soft"
              }`}
            >
              <span className="font-display text-base font-extrabold leading-tight">
                {m.label}
              </span>
              <span
                className={`text-xs ${mode === m.id ? "text-cream/80" : "text-ink-muted"}`}
              >
                {m.sub}
              </span>
            </button>
          ))}
        </div>

        {mode === "merge" ? <MergePane /> : <ExtractPane />}

        <p className="text-xs text-ink-muted">
          Everything happens in your browser — your files never leave this
          device.
        </p>
      </div>
    </ToolFrame>
  );
}

function MergePane() {
  const [pdfs, setPdfs] = useState<LoadedPdf[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const list = Array.from(files).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (list.length === 0) {
      setError("Drop a PDF, please.");
      return;
    }
    try {
      const { PDFDocument } = await import("pdf-lib");
      const loaded: LoadedPdf[] = [];
      for (const f of list) {
        const buf = await f.arrayBuffer();
        const doc = await PDFDocument.load(buf, { ignoreEncryption: false });
        loaded.push({
          id: `${f.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          file: f,
          pageCount: doc.getPageCount(),
        });
      }
      setPdfs((prev) => [...prev, ...loaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that PDF.");
    }
  }, []);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setPdfs((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const ni = idx + dir;
      if (ni < 0 || ni >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[ni]] = [next[ni], next[idx]];
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setPdfs((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const merge = useCallback(async () => {
    if (pdfs.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const out = await PDFDocument.create();
      for (const p of pdfs) {
        const buf = await p.file.arrayBuffer();
        const src = await PDFDocument.load(buf);
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const pg of pages) out.addPage(pg);
      }
      const bytes = await out.save();
      // pdf-lib returns Uint8Array; convert via slicing the underlying buffer.
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/pdf" });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed.");
    } finally {
      setBusy(false);
    }
  }, [pdfs, resultUrl]);

  const totalPages = pdfs.reduce((a, p) => a + p.pageCount, 0);

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className="card-chunk flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-cream p-8 text-center"
      >
        <p className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">
          Drop PDFs to merge
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-chunk rounded-[var(--radius-button)] bg-teal px-5 py-2 font-display text-sm font-extrabold text-cream"
        >
          Or choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {error && (
        <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
          {error}
        </p>
      )}

      {pdfs.length > 0 && (
        <ol className="flex flex-col gap-2">
          {pdfs.map((p, i) => (
            <li key={p.id}>
              <div className="card-chunk flex items-center gap-3 rounded-[var(--radius-card)] bg-cream p-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-teal-soft font-display text-xs font-extrabold">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-base font-bold tracking-tight">
                    {p.file.name}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {p.pageCount} pages · {formatBytes(p.file.size)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(p.id, -1)}
                    disabled={i === 0}
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-cream text-xs font-bold transition-colors hover:bg-teal-soft disabled:opacity-30"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(p.id, 1)}
                    disabled={i === pdfs.length - 1}
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-cream text-xs font-bold transition-colors hover:bg-teal-soft disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="rounded-full border-2 border-ink bg-cream px-2 text-xs font-bold transition-colors hover:bg-tomato-soft"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {pdfs.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={merge}
            disabled={busy}
            className="btn-chunk rounded-[var(--radius-button)] bg-teal px-6 py-3 font-display text-base font-extrabold text-cream disabled:opacity-60"
          >
            {busy ? "Merging…" : `Merge ${pdfs.length} PDFs`}
          </button>
          <p className="text-sm text-ink-muted">
            Output: 1 PDF, {totalPages} pages
          </p>
        </div>
      )}

      {resultUrl && (
        <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-teal-soft p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-teal text-lg text-cream">✓</div>
          <p className="flex-1 font-bold">Ready.</p>
          <a
            href={resultUrl}
            download="merged.pdf"
            className="btn-chunk rounded-[var(--radius-button)] bg-teal px-5 py-2 font-display text-sm font-extrabold text-cream"
          >
            Download
          </a>
        </div>
      )}
    </div>
  );
}

function ExtractPane() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [pageRange, setPageRange] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const acceptFile = useCallback(async (f: File) => {
    setError(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    if (!(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) {
      setError("That doesn't look like a PDF.");
      return;
    }
    try {
      const { PDFDocument } = await import("pdf-lib");
      const buf = await f.arrayBuffer();
      const doc = await PDFDocument.load(buf);
      setArrayBuffer(buf);
      setPdf({
        id: `${f.name}-${Date.now()}`,
        file: f,
        pageCount: doc.getPageCount(),
      });
      setPageRange(`1-${doc.getPageCount()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that PDF.");
    }
  }, [resultUrl]);

  const parsedPages = useMemo(() => {
    if (!pdf) return null;
    return parsePageRange(pageRange, pdf.pageCount);
  }, [pageRange, pdf]);

  const extract = useCallback(async () => {
    if (!pdf || !arrayBuffer || !parsedPages || parsedPages.error || parsedPages.pages.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const src = await PDFDocument.load(arrayBuffer);
      const out = await PDFDocument.create();
      const indices = parsedPages.pages.map((p) => p - 1);
      const copied = await out.copyPages(src, indices);
      for (const c of copied) out.addPage(c);
      const bytes = await out.save();
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
        type: "application/pdf",
      });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extract failed.");
    } finally {
      setBusy(false);
    }
  }, [pdf, arrayBuffer, parsedPages, resultUrl]);

  return (
    <div className="flex flex-col gap-4">
      {!pdf ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) acceptFile(f);
          }}
          className="card-chunk flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-cream p-8 text-center"
        >
          <p className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">
            Drop a PDF
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn-chunk rounded-[var(--radius-button)] bg-teal px-5 py-2 font-display text-sm font-extrabold text-cream"
          >
            Choose a file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) acceptFile(f);
              e.currentTarget.value = "";
            }}
          />
        </div>
      ) : (
        <>
          <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-cream p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-teal text-lg text-cream">▤</div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold">
                {pdf.file.name}
              </p>
              <p className="text-sm text-ink-soft">
                {pdf.pageCount} pages · {formatBytes(pdf.file.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPdf(null);
                setArrayBuffer(null);
                setPageRange("");
                if (resultUrl) URL.revokeObjectURL(resultUrl);
                setResultUrl(null);
              }}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-semibold transition-colors hover:bg-cream-deep"
            >
              Pick another
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="page-range"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Pages to keep
            </label>
            <input
              id="page-range"
              type="text"
              value={pageRange}
              onChange={(e) => setPageRange(e.target.value)}
              placeholder="1-3, 5, 8-10"
              className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-2 font-mono text-base focus:outline-none"
            />
            {parsedPages && parsedPages.error ? (
              <p className="text-xs font-semibold text-tomato">{parsedPages.error}</p>
            ) : parsedPages ? (
              <p className="text-xs text-ink-muted">
                {parsedPages.pages.length} page{parsedPages.pages.length === 1 ? "" : "s"}: {summariseRange(parsedPages.pages)}
              </p>
            ) : null}
          </div>

          {error && (
            <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={extract}
            disabled={busy || !parsedPages || !!parsedPages.error || parsedPages.pages.length === 0}
            className="btn-chunk self-start rounded-[var(--radius-button)] bg-teal px-6 py-3 font-display text-base font-extrabold text-cream disabled:opacity-60"
          >
            {busy ? "Extracting…" : "Extract pages"}
          </button>

          {resultUrl && (
            <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-teal-soft p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-teal text-lg text-cream">✓</div>
              <p className="flex-1 font-bold">Ready.</p>
              <a
                href={resultUrl}
                download={`${pdf.file.name.replace(/\.pdf$/i, "")}-extract.pdf`}
                className="btn-chunk rounded-[var(--radius-button)] bg-teal px-5 py-2 font-display text-sm font-extrabold text-cream"
              >
                Download
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function parsePageRange(
  input: string,
  total: number,
): { pages: number[]; error?: string } {
  const cleaned = input.trim();
  if (!cleaned) return { pages: [], error: "Enter a range like 1-3, 5, 8-10." };
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  const pages = new Set<number>();
  for (const p of parts) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < 1 || b > total || a > b) {
        return { pages: [], error: `Range ${a}-${b} is out of 1–${total}.` };
      }
      for (let i = a; i <= b; i++) pages.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = Number(p);
      if (n < 1 || n > total) {
        return { pages: [], error: `Page ${n} is out of 1–${total}.` };
      }
      pages.add(n);
    } else {
      return { pages: [], error: `Couldn't read "${p}".` };
    }
  }
  return { pages: [...pages].sort((a, b) => a - b) };
}

function summariseRange(pages: number[]): string {
  if (pages.length === 0) return "";
  const out: string[] = [];
  let start = pages[0];
  let prev = start;
  for (let i = 1; i <= pages.length; i++) {
    const p = pages[i];
    if (p !== prev + 1) {
      out.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = p;
    }
    prev = p;
  }
  return out.join(", ");
}
