import process from "node:process"

import type { AppConfig } from "./types"

const DEFAULT_LINEAR_TEAM_ID = "87e7afa0-8d4c-4c43-86a5-090799f403b9"
const DEFAULT_LINEAR_TEAM_KEY = "BAS"
const DEFAULT_LINEAR_INITIAL_STATE_NAME = "Triage"
const DEFAULT_LINEAR_LABEL_NAME = "Bug"

type Env = Record<string, string | undefined>

function readEmailConfig(env: Env): AppConfig["email"] {
  const explicitProvider = env.EMAIL_PROVIDER?.trim().toLowerCase()
  const resendApiKey = env.RESEND_API_KEY?.trim()
  const provider = explicitProvider || (resendApiKey ? "resend" : "log")

  const base = {
    appName: env.EMAIL_APP_NAME?.trim() || "LinearDesk",
    from: env.EMAIL_FROM?.trim() || "LinearDesk <noreply@lineardesk.local>",
  }

  if (provider === "resend") {
    if (!resendApiKey) {
      throw new Error("Missing required environment variable: RESEND_API_KEY")
    }

    return { ...base, provider: "resend", resendApiKey }
  }

  if (provider !== "log") {
    throw new Error("EMAIL_PROVIDER must be 'resend' or 'log'")
  }

  return { ...base, provider: "log" }
}

function required(env: Env, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)

  return value
}

export function readAppConfig(env: Env = process.env): AppConfig {
  const slackSigningSecret = env.SLACK_SIGNING_SECRET?.trim()
  const slackBotToken = env.SLACK_BOT_TOKEN?.trim()
  const slack =
    slackSigningSecret && slackBotToken
      ? { signingSecret: slackSigningSecret, botToken: slackBotToken }
      : undefined

  const geminiApiKey = env.GEMINI_API_KEY?.trim()
  const gemini = geminiApiKey
    ? {
        apiKey: geminiApiKey,
        model: env.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
      }
    : undefined

  return {
    email: readEmailConfig(env),
    databaseUrl: required(env, "DATABASE_URL"),
    betterAuthSecret: required(env, "BETTER_AUTH_SECRET"),
    betterAuthUrl: required(env, "BETTER_AUTH_URL"),
    googleClientId: required(env, "GOOGLE_CLIENT_ID"),
    googleClientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
    linear: {
      apiKey: required(env, "LINEAR_API_KEY"),
      teamId: env.LINEAR_TEAM_ID?.trim() || DEFAULT_LINEAR_TEAM_ID,
      teamKey: env.LINEAR_TEAM_KEY?.trim() || DEFAULT_LINEAR_TEAM_KEY,
      initialStateName:
        env.LINEAR_INITIAL_STATE_NAME?.trim() ||
        DEFAULT_LINEAR_INITIAL_STATE_NAME,
      labelName: env.LINEAR_LABEL_NAME?.trim() || DEFAULT_LINEAR_LABEL_NAME,
      webhookSecret: required(env, "LINEAR_WEBHOOK_SECRET"),
    },
    slack,
    gemini,
  }
}
