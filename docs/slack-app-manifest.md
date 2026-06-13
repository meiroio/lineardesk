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
    bot: [commands, chat:write, users:read, users:read.email, files:read, channels:history, groups:history]
settings:
  interactivity:
    is_enabled: true
    request_url: https://lineardesk.vercel.app/api/slack/interactivity
```
