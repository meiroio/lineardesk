# Customer organization domain access - Design

- **Date:** 2026-06-20
- **Status:** Approved in brainstorming; pending implementation plan
- **Author:** Codex

## Goal

Let approved customer users sign in without Google-only friction, file tickets,
and see every ticket for their customer organization by default. Access remains
gated: a verified user must belong to a Better Auth organization whose approved
email domain matches their email, or must have been explicitly invited later.

## Context

- LinearDesk already uses Better Auth with Google OAuth and Postgres-backed
  sessions.
- Request ownership is currently email-scoped:
  `repo.listRequestsForEmail(email)` and `repo.getRequestForEmail(id, email)`.
- Slack-created tickets are attributed by Slack email, and then become visible
  when the same email signs into the portal.
- The current domain allowlist is `ALLOWED_EMAIL_DOMAINS` in env, checked during
  Better Auth user creation and on every API session check.
- The product direction is changing from "a user sees their own requests" to
  "a customer user sees all requests for their customer organization/domain".

## Locked decisions

| Area | Decision |
| --- | --- |
| Auth base | Keep Better Auth as the auth/session system. |
| Passwordless | Add Better Auth magic links as the customer-friendly sign-in path, while keeping Google sign-in. |
| Organization base | Use Better Auth's organization plugin for canonical organizations, memberships, invitations, active organization, roles, and future admin workflows. |
| Domain mapping | Add a LinearDesk-owned `organization_email_domains` table. Better Auth orgs do not replace this business rule. |
| Visibility | Users see tickets for their active/customer organization by default, not only tickets from their exact email. |
| Ticket ownership | Keep `requester_email` and nullable `requester_user_id` on tickets for attribution. Add `organization_id` for authorization and listing. |
| Enrollment | Verified login by an approved domain auto-adds the user to the matching Better Auth organization. Explicit invitations can be added later for users outside approved domains. |
| Public domains | Do not allow public/shared domains such as `gmail.com` or `outlook.com` as organization domains. |
| Domain uniqueness | A domain belongs to exactly one customer organization. |

## Model

Use Better Auth's organization plugin tables for:

- organizations
- members
- invitations
- active organization on session/user context
- roles and permissions

Add application tables/columns for LinearDesk-specific access:

```text
organization_email_domains
  id uuid primary key
  organization_id text not null
  domain text not null unique
  active boolean not null default true
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()

helpdesk_requests
  organization_id text null initially, then not null after backfill
```

`organization_id` stores the Better Auth organization identifier. During
implementation planning, confirm whether the Better Auth organization table is
represented in the local Drizzle schema. If it is, add a foreign key. If it is
not, keep the text id and enforce integrity through repository lookups and
tests.

## Access flow

```text
User signs in with Google or magic link
  -> Better Auth verifies identity and creates/loads session
  -> LinearDesk resolves email domain
  -> domain maps to active organization_email_domains row
  -> user is a Better Auth org member, or is auto-added as a member
  -> request context resolves active customer organization
  -> APIs list/read/mutate tickets scoped to organization_id
```

Domain matching is an enrollment mechanism. Ticket access after enrollment is
membership-based: a user may access an organization only if Better Auth says the
user is a member of that organization.

## Request behavior

### Listing

Replace `listRequestsForEmail(email)` with organization-scoped listing:

```text
listRequestsForOrganization(organizationId)
```

The portal home page lists active/done requests for the user's active
organization. The requester email remains visible on each ticket where useful,
because users will now see tickets filed by coworkers.

### Detail, comments, edit, close

Replace `getRequestForEmail(id, email)` with:

```text
getRequestForOrganization(id, organizationId)
```

Comments, edits, and close actions are allowed when:

1. The user has a valid Better Auth session.
2. The session resolves to an active customer organization.
3. The ticket's `organization_id` matches that organization.
4. Existing ticket-state rules still pass, such as "cannot edit closed ticket".

### Creation

For web-created tickets:

- Resolve organization from the authenticated session.
- Create the Linear issue with `requesterEmail = session.user.email`.
- Persist `requester_email`, `requester_user_id`, and `organization_id`.

For Slack-created tickets:

- Resolve Slack user email as today.
- Resolve organization from that email domain.
- If no active organization domain matches, reject the ticket with a clear
  Slack response.
- If the Better Auth user already exists, store `requester_user_id`; otherwise
  store null as today.
- Persist `organization_id` so the ticket is visible to the org immediately.

## Better Auth integration

### Magic link

Add the Better Auth magic link plugin and configure `sendMagicLink` with the
chosen email provider. The login page gets an email input alongside the Google
button. The server should check the email domain before sending a link so
unapproved addresses do not receive auth emails.

### Organization plugin

Add the Better Auth organization plugin on server and client. Use it for:

- creating/seeding customer organizations
- adding users as members after verified sign-in
- checking membership for every organization-scoped API request
- future invites, roles, and customer admin screens

Do not build customer self-management UI in v1. Seed organizations and domains
internally through migrations or an admin script.

### Active organization

Use the active organization from Better Auth only when it is one of the user's
memberships. If the user has exactly one customer organization, set/select that
organization automatically. If the user belongs to multiple organizations, v1
returns an explicit `multiple_organizations` state and blocks ticket access
until an org switcher is implemented.

## Configuration and migrations

- Replace `ALLOWED_EMAIL_DOMAINS` as the source of truth with database-backed
  organization domains.
- Keep `ALLOWED_EMAIL_DOMAINS` temporarily only as a migration/bootstrap aid if
  needed.
- Add a migration that:
  1. Enables Better Auth organization tables according to the plugin schema.
  2. Creates `organization_email_domains`.
  3. Adds nullable `organization_id` to `helpdesk_requests`.
  4. Backfills existing tickets from `requester_email` domain.
  5. Makes `organization_id` required once all existing rows resolve.

Backfill must fail loudly if an existing request uses an unmapped domain.
Operators should seed organizations/domains before applying the final not-null
constraint.

## Security and privacy

- A verified email domain gives broad org visibility by design. This must be
  explicit in UI copy and operator docs.
- Never authorize by domain string alone after login. Authorize by Better Auth
  organization membership and ticket `organization_id`.
- Do not allow public consumer domains in `organization_email_domains`.
- Keep domain unique globally. Shared domains require explicit invitations or a
  later email-level access table.
- Magic links use Better Auth's expiry and single-use token behavior. Add route
  or email-provider rate limiting when the selected email provider supports it.
- Avoid leaking whether a specific customer exists during login. User-facing
  errors should say the email is not approved for this portal.

## Error handling

- Login email has no approved domain: do not send a link; show "This email is
  not approved for portal access."
- Signed-in user has no organization membership and no domain match: sign out or
  show a blocked-access page.
- Multiple active orgs and no active org selected: return
  `multiple_organizations` and block ticket access until org switching exists.
- Slack ticket from unmapped email domain: reply that the email domain is not
  approved for LinearDesk.
- Existing ticket with missing `organization_id` after migration: treat as a
  data error and do not expose it through org-scoped APIs.

## Testing

- Config/domain resolver tests:
  - normalizes domains
  - rejects invalid/public domains
  - resolves approved domains to organization ids
  - rejects unmapped domains
- Repository tests:
  - list requests by organization
  - get detail by organization
  - rejects same email-domain guesses when `organization_id` does not match
  - creates web and Slack requests with organization id
- API tests:
  - unauthenticated requests still 401
  - authenticated user outside any approved organization gets 403
  - member can list/detail/comment/edit/close org tickets
  - member cannot access another organization's ticket
- Auth integration tests:
  - magic-link request blocks unapproved domains before email send
  - verified sign-in auto-adds matching org membership
  - existing member remains authorized even if the ticket requester is another
    user in the same org
- Migration/backfill tests or dry-run script:
  - maps existing tickets to orgs by `requester_email`
  - reports unmapped domains before enforcing not-null

## Rollout

1. Add Better Auth organization and magic-link plugins behind tests.
2. Add organization/domain tables and seed known customer organizations.
3. Add nullable `helpdesk_requests.organization_id` and backfill.
4. Deploy code that writes `organization_id` on new tickets and reads with a
   fallback only during migration.
5. Verify all production rows have `organization_id`.
6. Enforce not-null and remove email-scoped authorization paths.
7. Update README and user guide.

## Out of scope

- Customer-managed organization admin UI.
- Organization-level roles beyond the default member/admin concepts.
- Email-level exceptions for non-domain users.
- SSO/SAML.
- Cross-organization dashboards for internal support users.
- Per-ticket privacy settings such as "requester only".

## Risks

- **Privacy expectation mismatch:** org-wide visibility may surprise customers.
  Mitigate with explicit customer-facing copy and a later per-org visibility
  mode if needed.
- **Domain ownership changes:** storing `organization_id` on tickets preserves
  historical ownership if a domain mapping changes later.
- **Better Auth schema drift:** plugin-managed schema may affect Drizzle
  migration shape. Confirm exact generated tables during implementation
  planning.
- **Slack orphan users:** Slack users may file tickets before they have a Better
  Auth user. This remains fine because tickets store `organization_id` and
  `requester_user_id` can stay null.
- **Multi-org users:** rare initially, but the active-organization concept
  should stay in the design so future invites do not require another auth
  rewrite.
