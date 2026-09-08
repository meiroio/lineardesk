type WaitUntil = (promise: Promise<unknown>) => void

type VercelRequestContext = {
  get?: () => { waitUntil?: WaitUntil } | undefined
}

// Resolve the runtime's waitUntil so post-response work keeps the serverless
// function alive. Workers-style runtimes may attach it to the request instead.
function getWaitUntil(request: Request): WaitUntil | undefined {
  const onRequest = (request as { waitUntil?: WaitUntil }).waitUntil
  if (typeof onRequest === "function") return onRequest.bind(request)

  const store = (
    globalThis as Record<symbol, VercelRequestContext | undefined>
  )[Symbol.for("@vercel/request-context")]
  const context = store?.get?.()
  return typeof context?.waitUntil === "function"
    ? context.waitUntil.bind(context)
    : undefined
}

export async function scheduleBackground(
  request: Request,
  work: Promise<unknown>,
  errorLabel: string
) {
  const safe = work.catch((error) => console.error(errorLabel, error))
  const waitUntil = getWaitUntil(request)
  if (waitUntil) {
    waitUntil(safe)
    return
  }

  // Bun's persistent server continues the I/O after the response. Awaiting here
  // makes Slack's acknowledgement depend on AI and upstream API latency.
  void safe
}
