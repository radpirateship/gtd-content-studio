/**
 * Client-side fetch wrapper.
 *
 * Keeps requests same-origin so the session cookie is sent automatically,
 * and redirects to /login if the session has expired.
 */

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: init?.credentials ?? 'same-origin',
  })

  if (
    typeof window !== 'undefined' &&
    response.status === 401 &&
    typeof input === 'string' &&
    !input.startsWith('/api/auth/')
  ) {
    const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.assign(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  return response
}
