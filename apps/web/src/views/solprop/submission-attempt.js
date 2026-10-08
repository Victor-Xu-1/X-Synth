export function createSubmissionAttempts(lifetimeSignal) {
  let current = null;
  let sequence = 0;

  function invalidate() {
    const previous = current;
    current = null;
    previous?.controller.abort();
  }

  function isCurrent(attempt) {
    return Boolean(current && current.attempt === attempt && !lifetimeSignal.aborted && !attempt.signal.aborted);
  }

  lifetimeSignal.addEventListener("abort", invalidate, { once: true });

  return Object.freeze({
    begin() {
      invalidate();
      if (lifetimeSignal.aborted) return null;
      const controller = new AbortController();
      const attempt = Object.freeze({ id: ++sequence, signal: controller.signal });
      current = { attempt, controller };
      return attempt;
    },
    isCurrent,
    invalidate,
    retire(attempt) {
      if (isCurrent(attempt)) invalidate();
    },
  });
}
