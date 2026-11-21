// Every internal link and asset goes through url() so the GitHub Pages
// base path (/research-digital-portfolio/) is always included.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function url(path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}

/** Full https:// address for canonical and Open Graph tags. */
export function absoluteUrl(path: string, site: URL | undefined): string {
  return new URL(url(path), site ?? 'http://localhost').href;
}
