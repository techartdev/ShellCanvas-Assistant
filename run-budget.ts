// SPDX-License-Identifier: MPL-2.0
export const defaultRunLimits = Object.freeze({ rounds: 30, minutes: 30 });
export function runLimits(value?: { rounds?: unknown; minutes?: unknown }) {
  const valid = (n: unknown, max: number, fallback: number) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= max
      ? n
      : fallback;
  return {
    rounds: valid(
      value?.rounds,
      Number.MAX_SAFE_INTEGER,
      defaultRunLimits.rounds,
    ),
    minutes: valid(value?.minutes, 240, defaultRunLimits.minutes),
  };
}
export class RunPaused extends Error {}
/** Approval reading time does not consume active work time. Stop remains live. */
export function activeDeadline(
  controller: AbortController,
  milliseconds: number,
) {
  let remaining = milliseconds,
    started = performance.now(),
    paused = false,
    closed = false;
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    started = performance.now();
    timer = setTimeout(
      () =>
        controller.abort(
          new RunPaused(
            "Paused at the active-time limit. Completed results are saved.",
          ),
        ),
      remaining,
    );
  };
  arm();
  return {
    pause() {
      if (closed || paused) return;
      remaining = Math.max(0, remaining - (performance.now() - started));
      clearTimeout(timer);
      paused = true;
    },
    resume() {
      if (!closed && paused) {
        paused = false;
        arm();
      }
    },
    close() {
      closed = true;
      clearTimeout(timer);
    },
  };
}
