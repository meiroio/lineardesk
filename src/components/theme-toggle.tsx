import { RiMoonLine, RiSunLine } from "@remixicon/react"
import { Button } from "@ui-sdk/react/button"

import { toggleTheme } from "@/lib/theme"

export function ThemeToggle({ className }: { className?: string }) {
  return (
    <Button
      data-variant="ghost"
      aria-label="Toggle theme"
      className={className}
      onClick={toggleTheme}
    >
      <RiSunLine aria-hidden className="hidden dark:block" />
      <RiMoonLine aria-hidden className="dark:hidden" />
    </Button>
  )
}
