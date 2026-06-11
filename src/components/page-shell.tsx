import { Link } from "@tanstack/react-router"
import { RiArrowLeftLine } from "@remixicon/react"

import { ThemeToggle } from "@/components/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type PageShellProps = {
  title: string
  description?: string
  eyebrow?: React.ReactNode
  /** When set, renders a back-to-requests row above the header. */
  backLabel?: string
  /** Actions rendered in the back row, next to the theme toggle. */
  backActions?: React.ReactNode
  actions?: React.ReactNode
  width?: "default" | "narrow"
  children?: React.ReactNode
}

export function PageShell({
  title,
  description,
  eyebrow,
  backLabel,
  backActions,
  actions,
  width = "default",
  children,
}: PageShellProps) {
  return (
    <main className="min-h-svh bg-background">
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8",
          width === "narrow" ? "max-w-3xl" : "max-w-5xl"
        )}
      >
        {backLabel ? (
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/"
              className={buttonVariants({
                variant: "ghost",
                className: "-ml-3 w-fit",
              })}
            >
              <RiArrowLeftLine aria-hidden />
              {backLabel}
            </Link>
            <div className="flex items-center gap-2">
              {backActions}
              <ThemeToggle />
            </div>
          </div>
        ) : null}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            {eyebrow ? (
              <p className="text-sm font-medium text-muted-foreground">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="text-2xl font-semibold text-balance">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {backLabel ? null : <ThemeToggle />}
          </div>
        </header>
        <Separator />
        {children}
      </div>
    </main>
  )
}
