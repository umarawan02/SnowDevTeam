/**
 * Runs once when the Node server starts. The pipeline and deploy jobs are
 * fire-and-forget in this process, so a restart orphans anything in flight —
 * recover those tickets so they aren't stuck forever.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recoverStaleTickets } = await import("@/lib/pipeline/recover");
    await recoverStaleTickets();
  } catch (err) {
    console.error("[instrumentation] recoverStaleTickets failed:", err);
  }
}
