import { redirect } from "next/navigation";

// `/` is the admin's front door, so it goes straight to the dashboard. The
// proxy already gates it: a signed-out visitor is bounced to WorkOS sign-in
// before this ever renders. Members never land here — their world is
// /s/[token], which lives outside the proxy matcher entirely.
export default function Home() {
  redirect("/dashboard");
}
