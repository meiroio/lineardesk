# The tests are the part you actually review

*How I test an AI-built helpdesk through its real seams, and why writing the failing test became the human's job.*

Most of the code in LinearDesk was written fast. Some of it I typed; a lot of it a model drafted while I described what I wanted. That changes something people don't say out loud often enough: when the implementation is cheap to produce and cheap to throw away, the implementation stops being the thing you trust. The test does.

So the question I kept asking while building out the suite wasn't "is this function correct." It was "if I regenerate this whole file tomorrow, what tells me the product still works for a customer." That question reorganized how I test.

This is a write-up of where I landed: four layers of tests, with most of the attention on the business layer, and a working habit of going from a plain-language requirement, to a failing test, to filled-in code, to a behavior that stays locked even when the code underneath it gets rewritten.

## Four layers, and which ones earned the attention

I ended up with four kinds of tests:

1. Unit tests for isolated functions and adapters.
2. API integration tests that call the real Elysia app with `createApiApp(...).fetch(...)`.
3. Business-flow tests under `src/server/__tests__/business`, which use a fake world but the real API routes.
4. A frontend smoke test that renders the real router with an injected app context, instead of mocking module singletons.

The unit layer is the one most people already write, and it's the least interesting here. It tells you a function does what its signature promises. Useful, but a passing unit test for a parser says nothing about whether a customer can file a bug.

The top three layers are where the value moved. They verify behavior through real boundaries: HTTP routing, Elysia response contracts, auth and session resolution, organization access, and frontend routing. When a model writes the body of a route, those boundaries are exactly the things that quietly break.

## "BDD" here is a discipline, not a framework

I don't use Cucumber or Gherkin. There's no `.feature` file and no step-definition glue. The behavior-driven part lives in two rules:

- Every test is named after a business outcome.
- Every test proves that outcome through the same door a browser or Slack would use.

Read the test titles from `request-lifecycle.test.ts` and `access-boundaries.test.ts` out loud:

```ts
it("lets an approved customer create, discuss, and close a request", ...)
it("keeps customer organizations isolated across list and detail views", ...)
it("rejects invalid customer input before creating Linear side effects", ...)
it("ignores duplicate Linear webhooks without applying later payload drift", ...)
```

Those map almost one-to-one onto business requirements. The requirement usually exists first, in a ticket, a support conversation, a sentence from a customer, and the useful property is that I can translate it into a test like this and read it back out of the test without much loss in either direction. I'm not claiming a non-engineer would sit down and read the file; the code around the titles is still code. The point is that the distance between "what the product should do" and "what this test asserts" stays short and reversible. That round trip is how I check I actually understood the requirement before building it, and how I re-validate that understanding later.

## The world: fake the edges, keep the middle real

The business tests run against a fake world. The trick is being precise about what "fake" covers. I swap only the true edges of the system, the things I can't or shouldn't run in a unit test: the Postgres repository, the Linear gateway, the Slack gateway, the Gemini extractor, the auth bridge, and the clock. Everything in between stays real.

`makeBusinessWorld()` builds in-memory versions of those edges and wires them into the actual application:

```ts
const app = createApiApp({
  config,
  repo,        // in-memory Map, not Postgres
  linear,      // records the inputs it was called with
  auth,        // reads a test session token from a header
  orgAccess,   // resolves orgs by email domain, in memory
  slack,
  gemini,
  verifyWebhook: ({ rawBody }) => JSON.parse(rawBody),
})
```

What stays real is everything that actually decides product behavior: the routing, the request validation, the auth and session resolution, the organization-access checks, the serialization, the status codes, and the order in which side effects fire. A test then reads like a user story:

```ts
const world = makeBusinessWorld()

world.addOrganization({
  id: "org-acme", name: "Acme", slug: "acme", domains: ["example.com"],
})
const session = world.signIn({ id: "user-ada", email: "ada@example.com" })

const response = await world.postJson("/requests", validRequestBody, session)

expect(response.status).toBe(201)
expect(world.linearCreateInputs).toEqual([
  expect.objectContaining({ requesterEmail: "ada@example.com" }),
])
```

No database is running. No network call leaves the process. The test is fast and deterministic. But the request still went through real routing, real validation, real auth, and real org resolution before it reached the fake Linear gateway. If any of those break, this test goes red, and it goes red for the same reason a real customer would see a failure.

This is also why I stopped reaching for `vi.mock` on the modules I was testing. Mocking the function under test mostly tells you the mock works. Injecting fakes at the system's real edges tells you the system works.

## From requirement, to red, to green, to covered

Here's the loop in practice, using a rule that's easy to state and easy to get wrong: *if a customer submits an incomplete bug report, reject it with clear messages, and do not create anything in Linear.*

That second clause is the one that matters. A naive implementation validates input, but only after it has already created the Linear issue. The customer sees an error; meanwhile a junk ticket is sitting in the tracker.

**Start from the requirement, written as a failing test.** Before the route handles this case, you write the test that says what "correct" means:

```ts
const invalidCreateResponse = await world.postJson("/requests", {
  title: " ",
  severity: "blocked",
  expectedBehaviour: "",
  currentBehaviour: "",
  stepsToReproduce: "",
}, session)

expect(invalidCreateResponse.status).toBe(400)
await expect(invalidCreateResponse.json()).resolves.toMatchObject({
  error: "validation_error",
  issues: expect.arrayContaining([
    "Title must be at least 3 characters",
    "Severity must be one of: urgent, high, medium, low",
  ]),
})
expect(world.linearCreateInputs).toEqual([]) // nothing reached Linear
```

Run it. It fails, because the behavior isn't built yet. That red is the spec talking.

**Fill in the code until it's green.** In the route, that means parsing and validating the body first, returning a `400` with the specific issues, and only calling `deps.linear.createHelpdeskIssue(...)` after validation passes:

```ts
let input
try {
  input = parseCreateRequestInput(body)
} catch (error) {
  if (error instanceof RequestValidationError) {
    return status(400, { error: "validation_error", issues: error.issues })
  }
  throw error
}

const linearIssue = await deps.linear.createHelpdeskIssue({ /* ... */ })
```

Now it's green.

**The coverage is the lock.** That last assertion, `expect(world.linearCreateInputs).toEqual([])`, is doing the real work. A test that only checks for a `400` would pass even with the side effect ordered wrong. By asserting that the Linear gateway was never called, the test pins down a sequencing guarantee, not just an output. If a future regeneration reorders the handler and creates the issue before validating, the status code might still be `400`, but `linearCreateInputs` won't be empty, and the test goes red.

This is the habit that makes the suite worth keeping: assert the side effects and their order, not only the response body. The business tests are full of this. Duplicate webhooks must not apply later payload drift. A closed ticket must reject edits with a `409`. A Slack mention from an unapproved email domain must post a failure and create nothing. Each of those is a product requirement, encoded as an assertion about what did and didn't happen.

## Make the contract structural, then test the structure

An API has a contract whether or not you write it down. The choice is between a contract that lives in a handler's head and one the code can check.

Each route now declares every status it can return, as a typed model:

```ts
.post("/requests", handler, {
  body: CreateRequestBodyModel,
  response: {
    201: PortalRequestResponseModel,
    400: ValidationErrorResponseModel,
    401: ErrorResponseModel,
    403: ErrorResponseModel,
    409: ErrorResponseModel,
  },
})
```

Then a test reads that metadata back off the Elysia app and asserts the exact set of declared statuses:

```ts
const responseStatuses = (method, path) => {
  const route = app.routes.find(
    (candidate) => candidate.method === method && candidate.path === path,
  )
  expect(route, `${method} ${path}`).toBeDefined()
  return Object.keys(route?.hooks.response ?? {}).sort()
}

expect(responseStatuses("POST", "/api/requests"))
  .toEqual(["201", "400", "401", "403", "409"])
```

This tests the API as architecture, not just as runtime behavior. If a handler starts returning an undocumented status, or someone drops the `409` that a closed ticket depends on, the contract test fails before anyone ships a client against the wrong shape. And when I want a generated Eden client or an OpenAPI document later, the response schemas are already the source of truth, so the generated client and the running route agree by construction.

I push the same idea across the front-end seam with a compile-time check. The client's view of a request and the server's contract model have to be the same type, enforced by a small type-equality helper:

```ts
const requestTypesMatch: Equal<ClientPortalRequest, ContractPortalRequest> = true
```

If the two drift, the project stops compiling. The frontend can't quietly assume a field the backend stopped sending.

## Inject dependencies instead of mocking globals

The business tests are only simple because the seam they use is a real design decision, not a test-time hack. Dependencies are a named Elysia plugin decorated onto the request context:

```ts
export function createApiDependenciesPlugin(resolveApiDependencies) {
  return new Elysia({ name: "api.dependencies" })
    .decorate("resolveApiDependencies", resolveApiDependencies)
}
```

Feature routes consume it explicitly, so the dependencies show up in the typed route context rather than being captured from a module the file happens to import:

```ts
export function createRequestsApi(apiDependencies) {
  return new Elysia({ name: "api.requests" })
    .use(apiDependencies)
    .post("/requests", async ({ request, resolveApiDependencies, status }) => {
      const deps = resolveApiDependencies()
      // ...
    })
}
```

Because the seam is in the design, the world just passes fakes in. There's nothing to monkey-patch.

The frontend smoke test follows the same philosophy on the other side of the wire. Instead of mocking the API module's singletons, it injects an `AppRouterContext` (the API client, auth, and the auth guard) into the real router, then drives a real flow:

```ts
renderPortal("/", { api: { apiPost, fetchRequest, fetchRequests, /* ... */ }, auth, requirePortalAuth })

fireEvent.click(screen.getByRole("link", { name: /new request/i }))
// fill Title, severity, expected/current behaviour, steps...
fireEvent.click(screen.getByRole("button", { name: "Submit request" }))

await waitFor(() => {
  expect(apiPost).toHaveBeenCalledWith("/api/requests", {
    title: "Smoke flow CSV export failure",
    severity: "high",
    expectedBehaviour: "The CSV export downloads.",
    currentBehaviour: "The export returns a 500.",
    stepsToReproduce: "Open Reports and click Export CSV.",
  })
})
```

Real router, real TanStack Query client, fake API at the edge. The test exercises routing, the auth guard, the form, and the navigation to the detail page, and it asserts the exact request body the form produces. It's an acceptance test for the customer's path, running in jsdom in a few milliseconds.

## What this is worth when a model writes the code

Here's the part that ties back to the opening. When you can regenerate a route handler in seconds, the implementation isn't the asset anymore. The asset is a description of correct behavior that you can re-run against any implementation, including the next one the model writes.

That reframes the old TDD advice. Writing the failing test first used to feel like the slow, disciplined tax you paid up front. Now it's the opposite: the failing test is the cheap, high-leverage part, and it's the part a human should own, because it's where intent gets pinned down. Let the model fill the inside of the function. Keep your hands on the test that says what filled-in means.

It also tells you where to spend review time. I read the business and contract tests carefully, because they're the spec. I skim the generated handler, because if it's wrong, the spec catches it. A green business suite plus a green contract test means the product still behaves, the API still has the shape clients depend on, and the customer's path through the UI still works, regardless of how the code under them got written.

The rules I follow now, in short:

- Test through the app's front door, not the handler in isolation.
- Name each test after the business outcome it proves.
- Fake only the true edges; keep routing, auth, validation, and serialization real.
- Assert side effects and their ordering, not just status codes.
- Declare the response contract as structure, and test the structure.
- Inject dependencies; don't mock the module you're testing.

I didn't write these tests to feel safe. I wrote them so I can keep letting a machine rewrite the code and still know, every single run, whether the product does what a customer needs.
