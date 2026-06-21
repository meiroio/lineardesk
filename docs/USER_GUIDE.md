# LinearDesk — User Guide

LinearDesk is the front door for support and bug reports. You file a request —
from the web portal or straight from Slack — and it becomes a tracked issue for
the team in Linear. You can follow its status, add details, and close it, all
without needing a Linear account yourself.

There are two ways in:

- **Web portal** — <https://lineardesk.vercel.app>. Sign in with Google or
  request a magic link for your approved work email.
- **Slack** — mention the app, or use the message shortcut.

Both create the same kind of request, and both show up in your customer
organization's portal list.

---

## 1. Filing a request

### From the web portal

1. Go to <https://lineardesk.vercel.app> and sign in with Google or a magic
   link for your approved work email.
2. Click **New request**.
3. Fill in the form:
   - **Title** — a short summary (e.g. "CSV export returns a 500").
   - **Severity** — Urgent / High / Medium / Low (see the guide below).
   - **Expected behaviour** — what should happen.
   - **Current behaviour** — what actually happens.
   - **Steps to reproduce** — how to trigger it (`1. … 2. … 3. …`).
4. **Paste screenshots** directly into any of the three text fields — they
   upload and attach to the issue automatically.
5. Click **Submit request**. You land on the request page, where you can track
   it from then on.

### From Slack

You can file without leaving the conversation where the problem came up. Two
ways, mentioning being the smoothest:

| Way          | How                                            | Best for                                                                                                         |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Mention**  | Type `@LinearDesk` in a thread                 | A thread that already describes the problem — the AI drafts the whole ticket for you                             |
| **Shortcut** | On a message: **⋯ → Create LinearDesk ticket** | Turning one specific message into a ticket (AI pre-fills the form from the thread; you review before submitting) |

**Mention (`@LinearDesk`)** — the app reads the whole thread (including any
images), drafts a ticket, creates it, and replies in-thread with the draft so
you can check it at a glance, plus a link to edit the details. No form, no
clicks. This is the recommended way — use it whenever the conversation already
explains the issue.

**The ⋯ shortcut** opens a short form (Title, Expected / Current / Steps,
Severity), pre-filled from the thread using AI; review, tweak, and submit. Use
it to turn one specific message into a ticket.

A few things worth knowing about Slack intake:

- **It's filed under your customer organization.** The ticket is attributed
  using your Slack email and is visible to approved users from the same
  organization in the portal. If your Slack profile has no email, or the email
  domain is not approved, the app can't file the ticket and will tell you so.
- **Images come along.** A mention attaches images from the thread; the shortcut
  attaches images on the selected message. They're added to the Linear issue.
- **A link back to the Slack thread** is added to the ticket, so the team can
  see the original conversation.
- **Mentions default to Medium severity** (there's no picker in that flow). If
  it's more or less urgent, change it later from the portal — see
  [Editing a request](#editing-a-request).

### Choosing a severity

| Severity   | Use when                                                    |
| ---------- | ----------------------------------------------------------- |
| **Urgent** | Broken for everyone, production is down, or data is at risk |
| **High**   | A major feature is broken with no workaround                |
| **Medium** | Broken, but there's a workaround (this is the default)      |
| **Low**    | Minor or cosmetic                                           |

---

## 2. Tracking your requests

The portal home page (**Requests**) lists the tickets filed under your customer
organization, with their live Linear status. It refreshes on its own every few
seconds, so a status change made by the team shows up without a reload.

Your request list is shared across your customer organization. Other approved
users from the same organization can see tickets filed under your company's
approved domains, and you can see theirs.

- **Active / Done filter** — the list shows **Active** requests by default.
  Switch to **Done** to see finished ones (Done, Canceled, Duplicate).
- **Severity filter** — narrow the list to one or more severities.
- Each row shows the title, the Linear ID (e.g. `BAS-82`), when it was last
  updated, its severity, and its current status. Click a row to open it.

### What the statuses mean

| Status          | Meaning                           |
| --------------- | --------------------------------- |
| **Triage**      | Received, not yet sorted          |
| **Backlog**     | Accepted and queued               |
| **In Progress** | Someone is working on it          |
| **Done**        | Fixed / resolved                  |
| **Canceled**    | Won't be actioned                 |
| **Duplicate**   | Already tracked by another ticket |

Done, Canceled, and Duplicate count as "finished" — those are the ones hidden
behind the **Done** filter.

---

## 3. Working a request

Open any request to see its full description, the activity so far, and the
actions you can take.

### Adding more detail (replies)

Use the **reply** box on the request page to add information — a new clue, an
answer to a question, another screenshot's context. Your reply is posted as a
comment on the Linear issue, and the team's replies in Linear show up here under
**Activity**.

### Editing a request

While a request is still open (not Done / Canceled / Duplicate), approved users
in the ticket's customer organization see an **Edit** button on the description.
You can change the **Title**, the **Description**, and the **Severity**. Saving
updates both the portal and the underlying Linear issue.

This is the place to fix up a ticket the AI drafted from a Slack mention, or to
bump the severity if things got worse.

> Editing is limited to approved users in the ticket's customer organization,
> and only while the request is open.

### Closing a request

If a request no longer needs the team's attention, you can close it yourself
from the request page:

- **Resolved** — it's handled / no longer an issue.
- **Canceled** — it shouldn't be worked on after all.

Closed requests move into the **Done** filter on your list. (The team can also
close or change status from Linear — either way, the status you see here stays
in sync.)

---

## How it connects to Linear

Every request becomes an issue in the team's Linear workspace. You don't need a
Linear account — the portal is your view into it:

- The status on your list and request page is the **real Linear status**,
  updated live as the team moves the issue along.
- Your replies become Linear comments, and Linear comments show up in your
  Activity feed.
- Screenshots you attach are uploaded to the Linear issue.

---

## Quick answers

- **Where did my Slack ticket go?** Your organization's portal list. Make sure
  your Slack profile has an email set and that its domain is approved for your
  customer organization.
- **The mention didn't create anything.** Send a _new_ mention (each is handled
  once). If it still doesn't, AI drafting may be turned off in your workspace —
  use the **⋯ → Create LinearDesk ticket** shortcut instead.
- **The AI got the details wrong.** That's expected sometimes — open the portal
  link from the confirmation and **Edit** the title, description, or severity.
- **I don't see my finished tickets.** Switch the list filter from **Active** to
  **Done**.
- **Can I attach a screenshot?** Yes — paste it into any field on the web form,
  or include it in the Slack thread/message you file from.
