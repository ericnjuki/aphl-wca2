const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

type ApiResponse<T> = { data: T; error: null } | { data: null; error: string };

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
