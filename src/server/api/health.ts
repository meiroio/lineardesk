import { Elysia } from "elysia"

import { HealthResponseModel } from "./contracts"

export function createHealthApi() {
  return new Elysia({ name: "api.health" }).get(
    "/health",
    () => ({ ok: true }),
    {
      response: HealthResponseModel,
    }
  )
}
