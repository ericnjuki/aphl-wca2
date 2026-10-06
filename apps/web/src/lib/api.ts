const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ApiResponse<T> = { data: T; error: null } | { data: null; error: string };
export type BinaryResponse<T> = ApiResponse<T> & { status: number };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include', // always send session cookie
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return { data: null, error: (json as { error?: string })?.error ?? res.statusText };
    }

    return { data: json as T, error: null };
  } catch {
    return { data: null, error: 'Network error. Please check your connection.' };
  }
}

export const api = {
  get:    <T>(path: string)                    => request<T>(path),
  post:   <T>(path: string, body: unknown)     => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)     => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                    => request<T>(path, { method: 'DELETE' }),
};

// ── Workbooks (binary bodies) ────────────────────────────────────────────────

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 413) return 'The file is larger than 10 MB.';
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error ?? res.statusText;
}

/** POST an .xlsx file as the raw request body; the response is JSON. */
export async function postWorkbook<T>(path: string, file: Blob): Promise<BinaryResponse<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': XLSX_MIME },
      body: file,
    });
    if (!res.ok) return { data: null, error: await errorMessage(res), status: res.status };
    return { data: (await res.json()) as T, error: null, status: res.status };
  } catch {
    return { data: null, error: 'Network error. Please check your connection.', status: 0 };
  }
}

/** Hand a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** GET a file (e.g. a workbook export) and download it. Returns an error message, or null. */
export async function downloadFile(path: string, filename: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { credentials: 'include' });
    if (!res.ok) return await errorMessage(res);
    saveBlob(await res.blob(), filename);
    return null;
  } catch {
    return 'Network error. Please check your connection.';
  }
}
