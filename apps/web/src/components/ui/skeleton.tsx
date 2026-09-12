import { cn } from "@/lib/utils"

// A loading placeholder is a shape waiting to be filled, and in Soft Clay every
// shape is a pill. The quiet lavender fill, not grey: a skeleton should look
// like the page holding its breath, not like a different product.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-full bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
