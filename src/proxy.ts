import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Security headers to add to all responses
const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',                    // Prevent clickjacking
  'X-Content-Type-Options': 'nosniff',           // Prevent MIME type sniffing
  'Referrer-Policy': 'strict-origin-when-cross-origin', // Limit referrer info
  'X-XSS-Protection': '1; mode=block',           // Enable XSS filter
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', // Restrict browser features
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;",
};

// CSRF protection: Validate that state-changing requests come with proper headers
function isCSRFRequest(request: NextRequest): boolean {
  const method = request.method.toUpperCase();

  // Safe methods don't need CSRF protection
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return true;
  }

  // Check for custom header (API calls from our frontend always include this)
  const requestedWith = request.headers.get('x-requested-with');
  if (requestedWith === 'XMLHttpRequest') {
    return true;
  }

  // Check for authorization header (token-based auth)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return true;
  }

  // Check origin/referer for same-origin requests
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');

  if (origin && host && origin.includes(host)) {
    return true;
  }

  if (referer && host && referer.includes(host)) {
    return true;
  }

  return false;
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Add security headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  // CSRF check for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const method = request.method.toUpperCase();

    // Skip CSRF for auth routes (login/register) - they have their own protection
    if (request.nextUrl.pathname.startsWith('/api/auth/')) {
      return response;
    }

    // Skip for seed and validate routes
    if (request.nextUrl.pathname.startsWith('/api/seed') ||
        request.nextUrl.pathname.startsWith('/api/route')) {
      return response;
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !isCSRFRequest(request)) {
      return NextResponse.json(
        { error: 'Ombi halijatoka kwenye chanzo halali. CSRF check imeshindikana.' },
        { status: 403 }
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (sw.js, manifest.json, etc.)
     * - image files
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.ico|.*\\.woff|.*\\.woff2).*)',
  ],
};
