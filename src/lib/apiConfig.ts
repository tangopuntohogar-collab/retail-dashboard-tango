/** Base URL del servidor (sin /api). Ej: http://localhost:3002 */
export function getServerBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL ?? 'http://localhost:3002';
  let s = String(raw).replace(/\/$/, '');
  // Compat: si alguien dejó la URL completa a /api/ventas
  if (s.endsWith('/api/ventas')) s = s.replace(/\/api\/ventas$/, '');
  return s;
}

export function apiPath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${getServerBaseUrl()}/api${p}`;
}

/** URL para endpoints que antes usaban VITE_API_URL como .../api/ventas */
export function ventasApiUrl(suffix = ''): string {
  const base = `${getServerBaseUrl()}/api/ventas`;
  return suffix ? `${base}${suffix.startsWith('?') || suffix.startsWith('/') ? '' : '/'}${suffix}` : base;
}
