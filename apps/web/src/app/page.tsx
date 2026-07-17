import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

import { Landing } from "./_components/landing";

// `/` is public (the proxy lists it in unauthenticatedPaths): a signed-in
// admin goes straight to their dashboard; everyone else gets the landing
// page. Its CTA links to /dashboard — a proxy-protected path — so sign-in
// starts through the EXISTING mechanism: the proxy performs the WorkOS
// redirect (middleware may write the PKCE cookie; a page render may not,
// which is why the CTA is not a getSignInUrl() href).
export default async function Home() {
  const { user } = await withAuth();
  if (user) redirect("/dashboard");

  return <Landing />;
}
