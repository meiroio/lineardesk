import type { EmailConfig } from "./types"

type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
}

export type EmailSender = {
  sendMagicLink: (input: { email: string; url: string }) => Promise<void>
  sendInvitation: (input: {
    email: string
    url: string
    inviterName?: string | null
    organizationName?: string | null
  }) => Promise<void>
}

export function createEmailSender(
  config: EmailConfig,
  fetchFn: typeof fetch = fetch
): EmailSender {
  async function sendEmail(message: EmailMessage) {
    if (config.provider === "log") {
      console.info("Email log", {
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      })
      return
    }

    const response = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Resend email failed with ${response.status} ${response.statusText}`
      )
    }
  }

  return {
    async sendMagicLink(input) {
      await sendEmail({
        to: input.email,
        subject: `Sign in to ${config.appName}`,
        html: `<p>Your ${escapeHtml(
          config.appName
        )} sign-in link</p><p><a href="${escapeHtml(
          input.url
        )}">Sign in to ${escapeHtml(
          config.appName
        )}</a></p>`,
        text: `Your ${config.appName} sign-in link:\n\n${input.url}`,
      })
    },

    async sendInvitation(input) {
      const organizationName = input.organizationName || config.appName
      const inviterText = input.inviterName
        ? `${input.inviterName} invited you to ${organizationName}.`
        : `You have been invited to ${organizationName}.`

      await sendEmail({
        to: input.email,
        subject: `Join ${organizationName}`,
        html: `<p>${escapeHtml(inviterText)}</p><p><a href="${escapeHtml(
          input.url
        )}">Accept invitation</a></p>`,
        text: `${inviterText}\n\nAccept invitation:\n\n${input.url}`,
      })
    },
  }
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
