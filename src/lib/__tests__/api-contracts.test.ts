import { describe, expect, it } from "vitest"

import type {
  PortalRequest as ClientPortalRequest,
  PortalRequestComment as ClientPortalRequestComment,
} from "../helpdesk-api"
import {
  PortalRequestCommentModel,
  PortalRequestListResponseModel,
  PortalRequestModel,
} from "@/server/api/contracts"
import type {
  PortalRequest as ContractPortalRequest,
  PortalRequestComment as ContractPortalRequestComment,
} from "@/server/api/contracts"

type Equal<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <
    TValue,
  >() => TValue extends TRight ? 1 : 2
    ? true
    : false

const requestTypesMatch: Equal<ClientPortalRequest, ContractPortalRequest> =
  true
const commentTypesMatch: Equal<
  ClientPortalRequestComment,
  ContractPortalRequestComment
> = true

void requestTypesMatch
void commentTypesMatch

describe("API contracts", () => {
  it("exposes reusable Elysia models for the portal request API", () => {
    expect(PortalRequestModel.type).toBe("object")
    expect(PortalRequestCommentModel.type).toBe("object")
    expect(PortalRequestListResponseModel.properties.requests.type).toBe(
      "array"
    )
  })
})
