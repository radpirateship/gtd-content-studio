/**
 * Lightweight error reporter. GTD does not use Sentry, so this logs to the
 * server console (visible in Vercel logs). Signature kept compatible with the
 * NN version so ported routes can call reportError(err, context) unchanged.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (context && Object.keys(context).length > 0) {
    console.error("[reportError]", message, JSON.stringify(context));
  } else {
    console.error("[reportError]", message);
  }
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
}
