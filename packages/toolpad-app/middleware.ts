import 'urlpattern-polyfill';
import { NextRequest, NextResponse } from 'next/server';
import config from './src/server/config';

interface ToolpadMiddlewareNext {
  (): Promise<Response>;
}

interface ToolpadMiddleware {
  (req: NextRequest, next: ToolpadMiddlewareNext): Promise<Response>;
}

const PUBLIC_URLS = [
  new URLPattern({ pathname: '/_next/static/:path*' }),
  new URLPattern({ pathname: '/health-check' }),
];

function matchAny(patterns: URLPattern[], input: URLPatternInit | string): URLPatternResult | null {
  // eslint-disable-next-line no-restricted-syntax
  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (match) {
      return match;
    }
  }
  return null;
}

async function basicAuthMiddleware(
  req: NextRequest,
  next: ToolpadMiddlewareNext,
): Promise<Response> {
  if (matchAny(PUBLIC_URLS, req.url)) {
    return next();
  }

  const match = new URLPattern({ pathname: '/deploy/:appId/:path*' }).exec(req.url);
  if (match) {
    const { appId } = match.pathname.groups;
    console.log(req.url, appId);
  }

  const basicAuth = req.headers.get('authorization');

  if (basicAuth) {
    const auth = basicAuth.split(' ')[1];
    const [user, pwd] = atob(auth).toString().split(':');

    if (user === config.basicAuthUser && pwd === config.basicAuthPassword) {
      return next();
    }
  }

  return new Response(null, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  });
}

/**
 * Helper that allows chaining Next.js middlewares similar to express
 */
async function callMiddlewares(chain: ToolpadMiddleware[], req: NextRequest): Promise<Response> {
  const [first, ...rest] = chain;
  const next = async () => {
    if (rest.length > 0) {
      return callMiddlewares(rest, req);
    }
    return NextResponse.next();
  };
  return first(req, next);
}

export async function middleware(req: NextRequest): Promise<Response> {
  return callMiddlewares([basicAuthMiddleware], req);
}
