/**
 * Edge-safe auth middleware: only checks for the presence of a session cookie.
 * Server components do the real session verification (full Auth.js + DB),
 * so middleware never imports `pg`, `argon2`, or any Node-only module.
 */
import { type NextRequest, NextResponse } from 'next/server';

const PROTECTED = ['/dashboard', '/agents', '/logs', '/settings', '/voice', '/analysis'];
const AUTH_PAGES = ['/login', '/signup'];

const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthPage = AUTH_PAGES.includes(pathname);

  const hasSession = SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));

  if (isProtected && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }
  if (isAuthPage && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
