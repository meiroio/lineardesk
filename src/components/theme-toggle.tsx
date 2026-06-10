import { RiMoonLine, RiSunLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { toggleTheme } from "@/lib/theme"

export function ThemeToggle({ className }: { className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      className={className}
      onClick={toggleTheme}
    >
      <RiSunLine aria-hidden className="dark:hidden" />
      <RiMoonLine aria-hidden className="hidden dark:block" />
    </Button>
  )
}
