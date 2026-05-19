// API Client for AMYC Financial Management System
// Handles authentication tokens and provides typed API methods

const getAuthToken = (): string | null => {
  try {
    const stored = localStorage.getItem('amyc-auth-store');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Zustand persist stores: { state: { ... } } or directly as state object
      const state = parsed.state || parsed;
      return state?.authToken || null;
    }
  } catch {}
  return null;
};

export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest', // CSRF protection header
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(endpoint, { ...options, headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Hitilafu ya mtandao' }));
    throw new Error(error.error || error.message || 'Hitilafu ya mtandao');
  }
  return res.json();
}

export function apiGet<T = any>(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const url = new URL(endpoint, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
  }
  return apiFetch<T>(url.pathname + url.search);
}

export function apiPost<T = any>(endpoint: string, body: any): Promise<T> {
  return apiFetch<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPut<T = any>(endpoint: string, body: any): Promise<T> {
  return apiFetch<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiDelete<T = any>(endpoint: string): Promise<T> {
  return apiFetch<T>(endpoint, { method: 'DELETE' });
}
