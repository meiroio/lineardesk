import { describe, expect, it } from "vitest"

import {
  assertNoDomainOwnershipConflicts,
  normalizeCustomerDomains,
  shouldBackfillRequest,
} from "../../../scripts/seed-customer-org"

describe("customer organization seed script", () => {
  it("dedupes and normalizes customer email domains", () => {
    expect(
      normalizeCustomerDomains(" Example.COM,example.com,Support.Example.org ")
    ).toEqual(["example.com", "support.example.org"])
  })

  it("rejects invalid and public customer email domains", () => {
    expect(() => normalizeCustomerDomains("gmail.com")).toThrow(
      "Refusing to seed public email domain: gmail.com"
    )
    expect(() => normalizeCustomerDomains("mail.com")).toThrow(
      "Refusing to seed public email domain: mail.com"
    )
    expect(() => normalizeCustomerDomains(".example.com")).toThrow(
      "Invalid domain: .example.com"
    )
    expect(() => normalizeCustomerDomains("example..com")).toThrow(
      "Invalid domain: example..com"
    )
    expect(() => normalizeCustomerDomains("bad-.example.com")).toThrow(
      "Invalid domain: bad-.example.com"
    )
  })

  it("rejects domain mappings owned by another organization", () => {
    expect(() =>
      assertNoDomainOwnershipConflicts(
        [{ domain: "example.com", organizationId: "other-org" }],
        "target-org"
      )
    ).toThrow(
      "Email domain example.com is already mapped to organization other-org"
    )
  })

  it("only backfills unmapped requests with matching requester domains", () => {
    expect(
      shouldBackfillRequest(
        { requesterEmail: "ada@example.com", organizationId: null },
        ["example.com"]
      )
    ).toBe(true)
    expect(
      shouldBackfillRequest(
        { requesterEmail: "ada@example.com", organizationId: "org-1" },
        ["example.com"]
      )
    ).toBe(false)
  })
})
