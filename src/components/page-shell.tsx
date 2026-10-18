import { Link } from "@tanstack/react-router"
import { RiArrowLeftLine } from "@remixicon/react"

import { BrandMark } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"

type PageShellProps = {
  title: string
  description?: string
  eyebrow?: React.ReactNode
  backLabel?: string
  backActions?: React.ReactNode
  actions?: React.ReactNode
  topBarContent?: React.ReactNode
  breadcrumb?: string
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
  topBarContent,
  breadcrumb,
  width = "default",
  children,
}: PageShellProps) {
  return (
    <main className="min-h-svh bg-background">
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-8 px-4 pt-6 pb-10 sm:px-8",
          width === "narrow" ? "max-w-3xl" : "max-w-5xl"
        )}
      >
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center justify-between gap-4 text-xs"
        >
          <div className="flex min-w-0 items-center gap-3">
            {backLabel ? (
              <Link
                to="/"
                className="flex items-center gap-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RiArrowLeftLine className="size-3.5" aria-hidden />
                {backLabel}
              </Link>
            ) : (
              <Link to="/" aria-label="LinearDesk home">
                <BrandMark />
              </Link>
            )}
            <span className="text-muted-foreground/50" aria-hidden>
              /
            </span>
            <span
              className="truncate text-muted-foreground"
              aria-current="page"
            >
              {breadcrumb ?? (backLabel ? title : "Requests")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {topBarContent}
            <ThemeToggle />
            {backLabel ? backActions : actions}
          </div>
        </nav>
        <header className="flex flex-col gap-3">
          {eyebrow ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          {backLabel && actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
          <h1
            className={cn(
              "font-heading leading-[1.15] font-semibold tracking-[-0.03em] text-balance",
              backLabel
                ? "text-[clamp(1.75rem,4vw,2.125rem)]"
                : "text-[clamp(1.875rem,4vw,2.5rem)]"
            )}
          >
            {title}
          </h1>
          {description ? (
            <p className="text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </header>
        {children}
      </div>
    </main>
  )
}
