/**
 * Pure utility functions for API request/response handling — separated from the
 * Next.js + activity-log dependent helpers in lib/api-utils.ts so they can be
 * unit-tested in node:test. Most callers should import from lib/api-utils.ts
 * (which re-exports everything here); import directly from this file only in tests.
 */

import type { ZodIssue } from "zod"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function shouldRedactKey(key: string): boolean {
  return /token|secret|password|authorization|api[-_]?key|cookie/i.test(key)
}

/**
 * Walk a value tree and redact strings that are stored under sensitive-looking
 * keys, plus truncate long strings to 500 chars. Used before logging request
 * metadata so we don't accidentally leak credentials into the activity log.
 */
export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item))
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        shouldRedactKey(key) ? "[REDACTED]" : redactSensitiveData(nestedValue),
      ])
    )
  }

  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 497)}...`
  }

  return value
}

/**
 * Format the first 5 Zod validation issues into a single human-readable line.
 */
export function summarizeIssues(issues: ZodIssue[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "body"
      return `${path}: ${issue.message}`
    })
    .join("; ")
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
