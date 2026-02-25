// Client-side service for Vercel Blob storage.
// Drop-in replacement for the IndexedDB-backed db.ts service.

export interface CloudRecording {
  url: string;           // Vercel Blob URL (acts as unique id)
  pathname: string;
  size: number;
  uploadedAt: string;    // ISO string from Vercel Blob
  date: string;          // original recording ISO date
  duration: number;      // seconds
  notes: string;
}

// ─── Internal types ────────────────────────────────────────────────

interface BlobListItem {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
}

interface BlobListResponse {
  blobs: BlobListItem[];
  cursor?: string;
  hasMore: boolean;
}

// ─── Filename encoding helpers ─────────────────────────────────────
// Format: recordings/{safe-date}_dur{seconds}_note{base64}.csv

function buildFilename(date: string, duration: number, notes: string): string {
  const safe = date.replace(/[:.]/g, '-');
  const encodedNotes = notes ? btoa(unescape(encodeURIComponent(notes))) : '';
  return `recordings/${safe}_dur${duration}_note${encodedNotes}.csv`;
}

function parseFilename(pathname: string): { date: string; duration: number; notes: string } {
  const filename = pathname.split('/').pop() || '';
  const dateMatch = filename.match(/^(.+?)_dur/);
  const durMatch = filename.match(/_dur(\d+)_/);
  const noteMatch = filename.match(/_note([^.]*?)\.csv$/);

  let date = '';
  if (dateMatch) {
    date = dateMatch[1]
      .replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z/, '$1-$2-$3T$4:$5:$6.$7Z');
  }

  const duration = durMatch ? parseInt(durMatch[1], 10) : 0;

  let notes = '';
  if (noteMatch && noteMatch[1]) {
    try {
      notes = decodeURIComponent(escape(atob(noteMatch[1])));
    } catch {
      notes = '';
    }
  }

  return { date, duration, notes };
}

// ─── Public API (mirrors db.ts) ────────────────────────────────────

/**
 * Save a new recording — replaces `saveRecording` from db.ts.
 */
export async function saveRecording(duration: number, data: string, notes: string = ''): Promise<void> {
  const date = new Date().toISOString();
  const filename = buildFilename(date, duration, notes);

  const res = await fetch('/api/blob/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, data }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
}

/**
 * Get all recordings — replaces `getAllRecordings` from db.ts.
 * Returns newest-first.
 */
export async function getAllRecordings(): Promise<CloudRecording[]> {
  const all: CloudRecording[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`/api/blob/list?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to list cloud recordings');

    const result: BlobListResponse = await res.json();

    for (const blob of result.blobs) {
      if (!blob.pathname.startsWith('recordings/')) continue;
      const meta = parseFilename(blob.pathname);
      all.push({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
        ...meta,
      });
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  // Newest first
  return all.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

/**
 * Delete a recording by its blob URL — replaces `deleteRecording` from db.ts.
 */
export async function deleteRecording(blobUrl: string): Promise<void> {
  const res = await fetch('/api/blob/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: blobUrl }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete');
  }
}

/**
 * Update notes on a recording.
 * Vercel Blob is immutable, so we download the CSV, delete the old blob,
 * and re-upload with the new filename that encodes the updated notes.
 */
export async function updateRecordingNotes(blobUrl: string, notes: string): Promise<void> {
  // 1. Download existing CSV data
  const downloadRes = await fetch(`/api/blob/download?url=${encodeURIComponent(blobUrl)}`);
  if (!downloadRes.ok) throw new Error('Failed to download recording for note update');
  const { data } = await downloadRes.json();

  // 2. Parse existing metadata from the old blob
  //    We need the original date & duration to rebuild the filename
  const listRes = await fetch('/api/blob/list');
  if (!listRes.ok) throw new Error('Failed to list recordings');
  const listResult: BlobListResponse = await listRes.json();
  const existing = listResult.blobs.find(b => b.url === blobUrl);
  if (!existing) throw new Error('Recording not found in cloud');

  const meta = parseFilename(existing.pathname);

  // 3. Delete old blob
  await deleteRecording(blobUrl);

  // 4. Re-upload with updated notes
  const filename = buildFilename(meta.date, meta.duration, notes);
  const uploadRes = await fetch('/api/blob/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, data }),
  });

  if (!uploadRes.ok) {
    throw new Error('Failed to re-upload recording with updated notes');
  }
}

/**
 * Download the CSV content from a cloud recording.
 */
export async function downloadRecordingData(blobUrl: string): Promise<string> {
  const res = await fetch(`/api/blob/download?url=${encodeURIComponent(blobUrl)}`);
  if (!res.ok) throw new Error('Failed to download recording');
  const { data } = await res.json();
  return data;
}
