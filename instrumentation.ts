export async function register() {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { startAutoRuntimeScheduler } = await import("@/src/application/scheduler/autoRuntimeScheduler");
    await startAutoRuntimeScheduler();
  } catch (error) {
    console.error("[instrumentation] Failed to start auto runtime scheduler:", error);
  }
}
