import { QueryClient } from "@tanstack/react-query"

import { authClient } from "@/lib/auth-client"
import {
  apiPost,
  closeRequest,
  fetchRequest,
  fetchRequests,
  updateRequest,
  uploadImage,
} from "@/lib/helpdesk-api"
import type {
  PortalRequest,
  RequestResolution,
  UploadImageResponse,
} from "@/lib/helpdesk-api"
import { requirePortalAuth } from "@/lib/route-guards"

type MagicLinkInput = {
  email: string
  callbackURL: string
  errorCallbackURL: string
}

type MagicLinkResult = {
  error?: unknown
}

type SocialSignInInput = {
  provider: "google"
  callbackURL: string
}

export type HelpdeskApiClient = {
  apiPost: <T>(path: string, body: unknown) => Promise<T>
  closeRequest: (
    id: string,
    resolution: RequestResolution
  ) => Promise<{ request: PortalRequest }>
  fetchRequest: (id: string) => Promise<PortalRequest>
  fetchRequests: () => Promise<PortalRequest[]>
  updateRequest: (
    id: string,
    input: { title: string; description: string; severity: string }
  ) => Promise<{ request: PortalRequest }>
  uploadImage: (file: File) => Promise<UploadImageResponse>
}

export type PortalAuthClient = {
  signOut: () => Promise<unknown> | unknown
  signIn: {
    magicLink: (input: MagicLinkInput) => Promise<MagicLinkResult | void>
    social: (input: SocialSignInInput) => Promise<unknown> | unknown
  }
}

export type AppRouterContext = {
  api: HelpdeskApiClient
  auth: PortalAuthClient
  queryClient: QueryClient
  requirePortalAuth: () => Promise<void> | void
}

const defaultApi: HelpdeskApiClient = {
  apiPost,
  closeRequest,
  fetchRequest,
  fetchRequests,
  updateRequest,
  uploadImage,
}

const defaultAuth: PortalAuthClient = {
  signOut: () => authClient.signOut(),
  signIn: {
    magicLink: (input) => authClient.signIn.magicLink(input),
    social: (input) => authClient.signIn.social(input),
  },
}

export function createAppRouterContext(
  overrides: Partial<AppRouterContext> = {}
): AppRouterContext {
  return {
    api: defaultApi,
    auth: defaultAuth,
    queryClient:
      overrides.queryClient ??
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
        },
      }),
    requirePortalAuth,
    ...overrides,
  }
}
