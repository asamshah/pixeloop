import { NextResponse, type NextRequest } from "next/server";

// Optional shared-password gate for the dashboard, credential form and APIs.
// Set APP_PASSWORD to enable (any username). Remove when real auth lands.
// /api/mcp and /api/cron/* have their own bearer secrets and are excluded.
export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Ads Agent"' },
  });
}

export const config = {
  matcher: ["/((?!api/mcp|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
