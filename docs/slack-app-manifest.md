# Slack app manifest

Paste this into [api.slack.com/apps](https://api.slack.com/apps) → "Create New App" → "From a manifest". Replace every occurrence of `lineardesk.vercel.app` with your own domain before saving.

> **Scope changes require a reinstall.** If you add or remove OAuth scopes (e.g. adding `channels:history`), Slack will show a "reinstall required" banner in your app settings. After reinstalling, Slack issues a new bot token — update `SLACK_BOT_TOKEN` in your environment.

```yaml
display_information:
  name: LinearDesk
features:
  bot_user:
    display_name: LinearDesk
  slash_commands:
    - command: /ticket
      url: https://lineardesk.vercel.app/api/slack/commands
      description: File a LinearDesk ticket
  shortcuts:
    - name: Create LinearDesk ticket
      type: message
      callback_id: slack_ticket_submit
      description: Turn this message into a LinearDesk ticket
oauth_config:
  scopes:
    bot: [commands, chat:write, users:read, users:read.email, files:read, channels:history, groups:history, app_mentions:read]
settings:
  event_subscriptions:
    request_url: https://lineardesk.vercel.app/api/slack/events
    bot_events:
      - app_mention
  interactivity:
    is_enabled: true
    request_url: https://lineardesk.vercel.app/api/slack/interactivity
```

> **`app_mentions:read` + Event Subscriptions (Phase 2).** Adding `app_mentions:read` to the bot scopes and enabling Event Subscriptions both require **reinstalling** the Slack app — Slack will show a "reinstall required" banner. After reinstalling, Slack issues a new bot token; update `SLACK_BOT_TOKEN` in your environment. When you first save the Event Subscriptions URL, Slack will POST a `url_verification` challenge to `https://lineardesk.vercel.app/api/slack/events`; the route echoes the challenge automatically.

> **DM limitation.** The `channels:history` and `groups:history` scopes cover public and private channels. Threads in **DMs or group DMs are not read** — that would require `im:history` / `mpim:history`, which are not included. When the shortcut is triggered from a DM, the AI-draft step is skipped and the modal opens pre-filled with the triggering message text only; ticket creation still works normally.
