import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Routes } from "@/lib/routes";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPath = path.startsWith(Routes.Login) || path.startsWith(Routes.Register);
  const isApiPath = path.startsWith("/api");
  const isPortalPath = path.startsWith("/portal"); // đặt hàng online theo token
  const isPublic = isAuthPath || isApiPath || isPortalPath || path === Routes.Home;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = Routes.Login;
    return NextResponse.redirect(url);
  }

  if (user && isAuthPath) {
    const url = request.nextUrl.clone();
    if (user.email?.toLowerCase() === "review@lumapos.shop") {
      url.pathname = Routes.OnlineSales;
      url.searchParams.set("tab", "overview");
      url.searchParams.set("channel", "shopee");
    } else {
      url.pathname = Routes.Dashboard;
    }
    return NextResponse.redirect(url);
  }

  return response;
}
