'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface FileRow {
  externalId: string;
  filename: string;
  status: string;
  chunkCount: number | null;
}

interface Props {
  agentExternalId: string;
  files: FileRow[];
}

export function KnowledgeUploader({ agentExternalId, files: initialFiles }: Props) {
  const [files, setFiles] = useState(initialFiles);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function upload(file: File) {
    setError(null);
    const optimistic: FileRow = {
      externalId: `pending_${Date.now()}`,
      filename: file.name,
      status: 'indexing',
      chunkCount: null,
    };
    setFiles((prev) => [optimistic, ...prev]);

    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/v1/agents/${agentExternalId}/knowledge`, {
      method: 'POST',
      body: fd,
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error ?? 'Upload failed');
      setFiles((prev) => prev.filter((f) => f.externalId !== optimistic.externalId));
      return;
    }
    setFiles((prev) =>
      prev.map((f) =>
        f.externalId === optimistic.externalId
          ? {
              externalId: json.file.externalId,
              filename: file.name,
              status: json.file.status,
              chunkCount: json.file.chunkCount ?? null,
            }
          : f,
      ),
    );
    startTransition(() => router.refresh());
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    for (const f of Array.from(list)) upload(f);
    e.target.value = '';
  }

  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-soft bg-fill px-6 py-8 text-sm text-ink-3 transition hover:bg-paper">
        <span className="font-medium">Drop a PDF, DOCX, MD, or TXT file</span>
        <span className="text-xs">or click to browse — up to 100 MB</span>
        <input type="file" onChange={onChange} className="hidden" multiple accept=".pdf,.docx,.md,.txt,.html,.csv" />
      </label>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      {files.length > 0 && (
        <ul className="mt-4 divide-y divide-line-soft">
          {files.map((f) => (
            <li key={f.externalId} className="flex items-center justify-between py-2 text-sm">
              <div className="truncate">{f.filename}</div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  f.status === 'indexed'
                    ? 'bg-accent-soft text-accent'
                    : f.status === 'failed'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-fill text-ink-3'
                }`}
              >
                {f.status}
                {f.chunkCount ? ` · ${f.chunkCount} chunks` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {isPending && <p className="mt-2 text-xs text-ink-3">Refreshing…</p>}
    </div>
  );
}
