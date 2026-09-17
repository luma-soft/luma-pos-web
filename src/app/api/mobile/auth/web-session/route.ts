import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { mobileError } from "@/lib/mobile/response";
import {
  readBearerToken,
  readRefreshToken,
  resolveMobileWebSessionTarget,
} from "@/lib/mobile/web-session";

const noStoreHeaders = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

export async function GET(request: NextRequest) {
  const target = resolveMobileWebSessionTarget(
    request.nextUrl.searchParams.get("next"),
  );
  const accessToken = readBearerToken(request);
  const refreshToken = readRefreshToken(request);

  if (!target || !accessToken || !refreshToken) {
    return mobileError("errors.unauthorized", 401);
  }

  const response = NextResponse.redirect(new URL(target, request.url));
  Object.entries(noStoreHeaders).forEach(([name, value]) =>
    response.headers.set(name, value),
  );

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, value),
          );
        },
      },
    },
  );

  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error || !data.session || !data.user) {
      return mobileError("errors.unauthorized", 401);
    }

    return response;
  } catch {
    return mobileError("errors.unauthorized", 401);
  }
}
