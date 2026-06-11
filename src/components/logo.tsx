import { cn } from "@/lib/utils"

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="lineardesk-logo-gradient"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#5E6AD2" />
          <stop offset="100%" stopColor="#4B55A8" />
        </linearGradient>
      </defs>
      <rect
        x="20"
        y="25"
        width="60"
        height="45"
        rx="4"
        fill="none"
        stroke="url(#lineardesk-logo-gradient)"
        strokeWidth="4"
      />
      <path
        d="M40 45 L48 53 L62 38"
        fill="none"
        stroke="url(#lineardesk-logo-gradient)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M40 70 L50 80 L60 70"
        fill="none"
        stroke="url(#lineardesk-logo-gradient)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Logo className="size-5" />
      <span className="text-sm font-semibold text-foreground">LinearDesk</span>
    </span>
  )
}
