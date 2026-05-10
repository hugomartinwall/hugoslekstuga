"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { formatBytes } from "@/lib/format";

type Mode = "merge" | "extract" | "split";

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
            { id: "extract", label: "Extract", sub: "keep / drop pages" },
            { id: "split", label: "Split", sub: "one PDF per page" },
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

        {mode === "merge" && <MergePane />}
        {mode === "extract" && <ExtractPane />}
        {mode === "split" && <SplitPane />}

        <p className="text-xs text-ink-muted">
          Everything happens in your browser — your files never leave this
          device.
        </p>
      </div>
    </ToolFrame>
  );
}

/* -------------------------------------------------------------------------
 * Merge — many PDFs in, one PDF out. Reorder via drag (desktop) or ↑/↓
 * buttons (mobile). The ↑/↓ buttons stay because HTML5 drag-and-drop
 * doesn't work on touch screens.
 * -----------------------------------------------------------------------*/

function MergePane() {
  const [pdfs, setPdfs] = useState<LoadedPdf[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; size: number } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const list = Array.from(files).filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
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

  const reorder = useCallback((from: number, to: number) => {
    if (from === to) return;
    setPdfs((prev) => {
      if (from < 0 || from >= prev.length) return prev;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
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
      const blob = new Blob(
        [
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        ],
        { type: "application/pdf" },
      );
      if (result) URL.revokeObjectURL(result.url);
      setResult({ url: URL.createObjectURL(blob), size: blob.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed.");
    } finally {
      setBusy(false);
    }
  }, [pdfs, result]);

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
              <div
                draggable
                onDragStart={(e) => {
                  setDragIdx(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData("text/plain"));
                  if (Number.isInteger(from)) reorder(from, i);
                  setDragIdx(null);
                }}
                onDragEnd={() => setDragIdx(null)}
                className={`card-chunk flex cursor-grab items-center gap-3 rounded-[var(--radius-card)] bg-cream p-3 active:cursor-grabbing ${
                  dragIdx === i ? "opacity-40" : ""
                }`}
              >
                <span
                  className="select-none text-ink-muted"
                  aria-hidden
                  title="Drag to reorder"
                >
                  ⋮⋮
                </span>
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

      {result && (
        <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-teal-soft p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-teal text-lg text-cream">
            ✓
          </div>
          <p className="flex-1 font-bold">Ready · {formatBytes(result.size)}</p>
          <a
            href={result.url}
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

/* -------------------------------------------------------------------------
 * Extract — pick one PDF, type a page range, get a slimmer PDF back.
 * "Keep" outputs only the listed pages; "Remove" outputs everything except
 * the listed pages. Same parser, inverted.
 * -----------------------------------------------------------------------*/

type ExtractAction = "keep" | "remove";

function ExtractPane() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [pageRange, setPageRange] = useState<string>("");
  const [action, setAction] = useState<ExtractAction>("keep");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; size: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const acceptFile = useCallback(
    async (f: File) => {
      setError(null);
      if (result) URL.revokeObjectURL(result.url);
      setResult(null);
      if (
        !(
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf")
        )
      ) {
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
    },
    [result],
  );

  const parsedPages = useMemo(() => {
    if (!pdf) return null;
    return parsePageRange(pageRange, pdf.pageCount);
  }, [pageRange, pdf]);

  // Final pages after the keep/remove inversion.
  const finalPages = useMemo(() => {
    if (!pdf || !parsedPages || parsedPages.error) return [];
    if (action === "keep") return parsedPages.pages;
    const set = new Set(parsedPages.pages);
    const inverted: number[] = [];
    for (let i = 1; i <= pdf.pageCount; i++) {
      if (!set.has(i)) inverted.push(i);
    }
    return inverted;
  }, [pdf, parsedPages, action]);

  const extract = useCallback(async () => {
    if (
      !pdf ||
      !arrayBuffer ||
      !parsedPages ||
      parsedPages.error ||
      finalPages.length === 0
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const src = await PDFDocument.load(arrayBuffer);
      const out = await PDFDocument.create();
      const indices = finalPages.map((p) => p - 1);
      const copied = await out.copyPages(src, indices);
      for (const c of copied) out.addPage(c);
      const bytes = await out.save();
      const blob = new Blob(
        [
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        ],
        { type: "application/pdf" },
      );
      if (result) URL.revokeObjectURL(result.url);
      setResult({ url: URL.createObjectURL(blob), size: blob.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extract failed.");
    } finally {
      setBusy(false);
    }
  }, [pdf, arrayBuffer, parsedPages, finalPages, result]);

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
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-teal text-lg text-cream">
              ▤
            </div>
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
                if (result) URL.revokeObjectURL(result.url);
                setResult(null);
              }}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-semibold transition-colors hover:bg-cream-deep"
            >
              Pick another
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Action
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAction("keep")}
                className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                  action === "keep"
                    ? "bg-teal text-cream"
                    : "bg-cream hover:bg-teal-soft"
                }`}
              >
                Keep these pages
              </button>
              <button
                type="button"
                onClick={() => setAction("remove")}
                className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                  action === "remove"
                    ? "bg-teal text-cream"
                    : "bg-cream hover:bg-teal-soft"
                }`}
              >
                Remove these pages
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="page-range"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Pages
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
              <p className="text-xs font-semibold text-tomato">
                {parsedPages.error}
              </p>
            ) : parsedPages ? (
              <p className="text-xs text-ink-muted">
                {action === "keep" ? "Keeping " : "Removing "}
                {parsedPages.pages.length} page
                {parsedPages.pages.length === 1 ? "" : "s"}:{" "}
                {summariseRange(parsedPages.pages)} · output:{" "}
                {finalPages.length} page
                {finalPages.length === 1 ? "" : "s"}
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
            disabled={
              busy ||
              !parsedPages ||
              !!parsedPages.error ||
              finalPages.length === 0
            }
            className="btn-chunk self-start rounded-[var(--radius-button)] bg-teal px-6 py-3 font-display text-base font-extrabold text-cream disabled:opacity-60"
          >
            {busy ? "Working…" : action === "keep" ? "Extract pages" : "Remove pages"}
          </button>

          {result && (
            <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-teal-soft p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-teal text-lg text-cream">
                ✓
              </div>
              <p className="flex-1 font-bold">
                Ready · {finalPages.length} page
                {finalPages.length === 1 ? "" : "s"} · {formatBytes(result.size)}
              </p>
              <a
                href={result.url}
                download={`${pdf.file.name.replace(/\.pdf$/i, "")}-${
                  action === "keep" ? "extract" : "trimmed"
                }.pdf`}
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

/* -------------------------------------------------------------------------
 * Split — one PDF in, many PDFs out (one per page or per chunk),
 * delivered as a zip.
 * -----------------------------------------------------------------------*/

const CHUNK_PRESETS = [1, 2, 5, 10];

function SplitPane() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [chunkSize, setChunkSize] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; size: number; count: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const acceptFile = useCallback(
    async (f: File) => {
      setError(null);
      if (result) URL.revokeObjectURL(result.url);
      setResult(null);
      if (
        !(
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf")
        )
      ) {
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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that PDF.");
      }
    },
    [result],
  );

  const outputCount = pdf ? Math.ceil(pdf.pageCount / chunkSize) : 0;

  const split = useCallback(async () => {
    if (!pdf || !arrayBuffer) return;
    setBusy(true);
    setError(null);
    try {
      const [{ PDFDocument }, JSZipMod] = await Promise.all([
        import("pdf-lib"),
        import("jszip"),
      ]);
      const JSZip = JSZipMod.default;
      const src = await PDFDocument.load(arrayBuffer);
      const total = src.getPageCount();
      const zip = new JSZip();
      const baseName = pdf.file.name.replace(/\.pdf$/i, "");
      const padWidth = String(total).length;
      let chunkIdx = 0;
      for (let start = 0; start < total; start += chunkSize) {
        chunkIdx++;
        const end = Math.min(start + chunkSize, total);
        const out = await PDFDocument.create();
        const indices: number[] = [];
        for (let p = start; p < end; p++) indices.push(p);
        const pages = await out.copyPages(src, indices);
        for (const pg of pages) out.addPage(pg);
        const bytes = await out.save();
        const buf = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const filename =
          chunkSize === 1
            ? `${baseName}-page-${String(start + 1).padStart(padWidth, "0")}.pdf`
            : `${baseName}-${String(start + 1).padStart(padWidth, "0")}-to-${String(end).padStart(padWidth, "0")}.pdf`;
        zip.file(filename, buf);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      if (result) URL.revokeObjectURL(result.url);
      setResult({
        url: URL.createObjectURL(zipBlob),
        size: zipBlob.size,
        count: chunkIdx,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Split failed.");
    } finally {
      setBusy(false);
    }
  }, [pdf, arrayBuffer, chunkSize, result]);

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
            Drop a PDF to split
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
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-teal text-lg text-cream">
              ▤
            </div>
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
                if (result) URL.revokeObjectURL(result.url);
                setResult(null);
              }}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-semibold transition-colors hover:bg-cream-deep"
            >
              Pick another
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Pages per file
            </p>
            <div className="flex flex-wrap gap-2">
              {CHUNK_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setChunkSize(n)}
                  className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                    chunkSize === n
                      ? "bg-teal text-cream"
                      : "bg-cream hover:bg-teal-soft"
                  }`}
                >
                  {n === 1 ? "1 (per page)" : `${n}`}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-muted">
              Output: {outputCount} PDF{outputCount === 1 ? "" : "s"}, delivered
              as a single zip.
            </p>
          </div>

          {error && (
            <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={split}
            disabled={busy || outputCount === 0}
            className="btn-chunk self-start rounded-[var(--radius-button)] bg-teal px-6 py-3 font-display text-base font-extrabold text-cream disabled:opacity-60"
          >
            {busy
              ? "Splitting…"
              : `Split into ${outputCount} PDF${outputCount === 1 ? "" : "s"}`}
          </button>

          {result && (
            <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-teal-soft p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-teal text-lg text-cream">
                ✓
              </div>
              <p className="flex-1 font-bold">
                Ready · {result.count} PDFs · {formatBytes(result.size)} (zip)
              </p>
              <a
                href={result.url}
                download={`${pdf.file.name.replace(/\.pdf$/i, "")}-split.zip`}
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

/* -------------------------------------------------------------------------
 * Page-range parser. Accepts comma-separated tokens, each either a single
 * page (`5`) or an inclusive range (`8-10`). Validates against the source
 * total. Returns a sorted, deduped list of 1-based page numbers, or an
 * error string ready to surface to the user.
 * -----------------------------------------------------------------------*/

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
