import { createAuthBridge } from "../auth"
import { readAppConfig } from "../config"
import { createGeminiGateway } from "../ai/gemini"
import { createLinearGateway } from "../linear"
import { createOrgAccessRepository } from "../org-access"
import { createHelpdeskRepository } from "../repository"
import type {
  AppConfig,
  AuthBridge,
  GeminiGateway,
  HelpdeskRepository,
  LinearGateway,
  OrgAccessRepository,
  SlackGateway,
  VerifyWebhook,
} from "../types"
import { createSlackGateway } from "../slack/gateway"
import { verifyLinearWebhookPayload } from "../webhooks"

export type ApiDependencies = {
  config: AppConfig
  repo: HelpdeskRepository
  linear: LinearGateway
  auth: AuthBridge
  orgAccess: OrgAccessRepository
  slack?: SlackGateway
  gemini?: GeminiGateway
  verifyWebhook?: VerifyWebhook
}

export type ResolvedApiDependencies = ApiDependencies & {
  verifyWebhook: VerifyWebhook
}

export type ApiDependencyResolver = () => ResolvedApiDependencies

export function createDefaultDependencies(): ResolvedApiDependencies {
  const config = readAppConfig()

  return {
    config,
    repo: createHelpdeskRepository(),
    linear: createLinearGateway(config.linear),
    auth: createAuthBridge(config),
    orgAccess: createOrgAccessRepository(),
    slack: config.slack ? createSlackGateway(config.slack.botToken) : undefined,
    gemini: config.gemini ? createGeminiGateway(config.gemini) : undefined,
    verifyWebhook: ({ rawBody, signature, timestamp }) => {
      if (!signature) throw new Error("Missing Linear webhook signature")

      return verifyLinearWebhookPayload({
        rawBody,
        signature,
        timestamp,
        secret: config.linear.webhookSecret,
      })
    },
  }
}

export function withDefaultWebhookVerifier(
  deps: ApiDependencies
): ResolvedApiDependencies {
  return {
    ...deps,
    verifyWebhook:
      deps.verifyWebhook ??
      (({ rawBody, signature, timestamp }) => {
        if (!signature) throw new Error("Missing Linear webhook signature")

        return verifyLinearWebhookPayload({
          rawBody,
          signature,
          timestamp,
          secret: deps.config.linear.webhookSecret,
        })
      }),
  }
}
