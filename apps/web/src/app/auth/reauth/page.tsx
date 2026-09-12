import { Button } from "@/components/ui/button";

// A deliberate pause avoids an endless dashboard -> OAuth -> dashboard loop if
// Rails keeps rejecting the token. Starting OAuth belongs in a route handler.
export default function ReauthenticatePage() {
  return <main className="mx-auto max-w-lg space-y-6 px-5 py-16">
    <h1 className="text-2xl font-semibold">Please sign in again</h1>
    <p>We couldn&apos;t verify your household access. Sign in again to refresh your session. If this keeps happening, contact your household admin.</p>
    <Button asChild size="lg"><a href="/auth/sign-in">Sign in again</a></Button>
  </main>;
}
