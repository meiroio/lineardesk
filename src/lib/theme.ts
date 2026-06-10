export const THEME_STORAGE_KEY = "lineardesk-theme"

// Inlined in the document head so the correct theme class is set before first
// paint. Must stay dependency-free and in sync with toggleTheme below.
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`

export function toggleTheme() {
  const root = document.documentElement
  const dark = !root.classList.contains("dark")

  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light")
  } catch {
    // Persistence unavailable (e.g. private browsing) — theme still applies
    // for the current page lifetime.
  }
}
