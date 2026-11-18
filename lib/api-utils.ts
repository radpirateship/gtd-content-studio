/**
 * API request/response helpers for Next.js route handlers.
 *
 * Pure helpers (redactSensitiveData, summarizeIssues, getErrorMessage) live in
 * lib/api-utils-core.ts so they can be unit-tested without pulling in
 * next/server or the Neon-backed activity log. This module re-exports them
 * for convenience; nothing else needs to change at the call sites.
 */

import { NextResponse } from "next/server"
import type { ZodType } from "zod"
import { logActivity } from "@/lib/activity-log"
import { redactSensitiveData } from "./api-utils-core"

export { redactSensitiveData, summarizeIssues, getErrorMessage } from "./api-utils-core"

type LogStatus = "success" | "error" | "warning"

export async function parseAndValidateJson<T>(
  request: Request,
  schema: ZodType<T>
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> {
  let rawBody: unknown

  try {
    rawBody = await request.json()
  } catch {
    return {
      success: false,
      response: NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }),
    }
  }

  const result = schema.safeParse(rawBody)
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: "Invalid request body",
          details: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      ),
    }
  }

  return { success: true, data: result.data }
}

export function logRouteEvent(
  action: string,
  opts: {
    category: string
    status?: LogStatus
    detail?: string
    metadata?: Record<string, unknown>
    durationMs?: number
  }
) {
  const metadata = opts.metadata ? (redactSensitiveData(opts.metadata) as Record<string, unknown>) : undefined

  logActivity(action, {
    category: opts.category,
    status: opts.status,
    detail: opts.detail,
    durationMs: opts.durationMs,
    metadata,
  })
}
