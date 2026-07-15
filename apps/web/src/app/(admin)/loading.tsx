import { Skeleton } from "@/components/ui/skeleton";

// The admin surface's own loading state. Without this, navigating between admin
// screens falls through to the app-root loading.tsx, whose Suspense boundary
// sits ABOVE the admin layout — so the sidebar blanks out on every click and
// the whole shell appears to reload. This boundary sits inside the shell: the
// sidebar and header hold still, and only the page area shows the skeleton.
// A screen with a more specific shape (members) still ships its own loading.tsx.
export default function AdminLoading() {
  return (
    <div aria-busy aria-label="Loading">
      {/* PageHeader-shaped: title, description, and the action slot. */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-10 w-32 shrink-0 sm:block" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    </div>
  );
}
