import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { QueryClientProvider } from "@tanstack/react-query"

import { createAppRouterContext } from "@/lib/app-context"
import type { AppRouterContext } from "@/lib/app-context"

import { routeTree } from "./routeTree.gen"

export function getRouter(
  context: AppRouterContext = createAppRouterContext()
) {
  const router = createTanStackRouter({
    routeTree,
    context,

    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    Wrap: ({ children }) => (
      <QueryClientProvider client={context.queryClient}>
        {children}
      </QueryClientProvider>
    ),
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
