import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/api/auth',
  '/_next',
  '/favicon.ico',
  '/health',
];

// Routes that require specific roles
const PROTECTED_ROUTES: { pattern: RegExp; roles: string[] }[] = [
  { pattern: /^\/admin/, roles: ['admin'] },
  { pattern: /^\/settings\/billing/, roles: ['admin', 'manager'] },
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('access_token')?.value
    ?? request.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'enterprise-app',
      audience: 'enterprise-app-clients',
    });

    // Check role-based access for protected routes
    const protectedRoute = PROTECTED_ROUTES.find(({ pattern }) =>
      pattern.test(pathname),
    );

    if (protectedRoute) {
      const userRoles = (payload.roles as string[]) ?? [];
      const hasRole = protectedRoute.roles.some((r) => userRoles.includes(r));

      if (!hasRole) {
        return NextResponse.redirect(new URL('/403', request.url));
      }
    }

    // Forward user info to server components via headers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', String(payload.sub));
    requestHeaders.set('x-user-roles', JSON.stringify(payload.roles ?? []));

    return NextResponse.next({ request: { headers: requestHeaders } });

  } catch {
    // Token invalid or expired — redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(loginUrl);

    // Clear the invalid cookie
    response.cookies.delete('access_token');
    return response;
  }
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
