import { describe, expect, it } from "vitest";

import {
  REVIEW_INTERVALS_DAYS,
  initialSchedulingState,
  nextSchedulingState,
  type SchedulingState,
} from "@/domain/review/schedule";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

describe("nextSchedulingState", () => {
  it("advances the spacing ladder a full step on independent recall", () => {
    const state = nextSchedulingState(initialSchedulingState(), "recalled", NOW);
    expect(state.reviewStage).toBe(1);
    expect(state.successfulRecalls).toBe(1);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastResult).toBe("recalled");
    expect(daysBetween(NOW, state.dueAt!)).toBe(REVIEW_INTERVALS_DAYS[1]);
    expect(state.introducedAt).toEqual(NOW);
  });

  it("records a hint-assisted recall as a success but less aggressively", () => {
    const base: SchedulingState = { ...initialSchedulingState(), reviewStage: 2 };
    const independent = nextSchedulingState(base, "recalled", NOW);
    const hinted = nextSchedulingState(base, "recalled_with_hint", NOW);

    expect(hinted.successfulRecalls).toBe(1);
    // The ladder does not advance for a hinted answer, so its next interval is
    // strictly shorter than an independent recall from the same state.
    expect(hinted.reviewStage).toBe(2);
    expect(independent.reviewStage).toBe(3);
    expect(hinted.dueAt!.getTime()).toBeLessThan(independent.dueAt!.getTime());
  });

  it("increments failures and schedules a much earlier review on a wrong answer", () => {
    const base: SchedulingState = {
      ...initialSchedulingState(),
      reviewStage: 3,
      successfulRecalls: 4,
      consecutiveFailures: 1,
    };
    const state = nextSchedulingState(base, "wrong", NOW);

    expect(state.consecutiveFailures).toBe(2);
    expect(state.successfulRecalls).toBe(4);
    expect(state.reviewStage).toBe(2);
    // Earlier than even the shortest ladder interval (1 day).
    expect(state.dueAt!.getTime() - NOW.getTime()).toBeLessThan(DAY_MS);
    expect(state.lastResult).toBe("wrong");
  });

  it("treats a skip as neither success nor failure", () => {
    const base: SchedulingState = {
      ...initialSchedulingState(),
      reviewStage: 2,
      successfulRecalls: 3,
      consecutiveFailures: 1,
    };
    const state = nextSchedulingState(base, "skipped", NOW);

    expect(state.successfulRecalls).toBe(3);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.reviewStage).toBe(2);
    expect(state.lastResult).toBe("skipped");
    expect(state.dueAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("caps the interval at the top of the ladder (no permanent mastery)", () => {
    let state: SchedulingState = initialSchedulingState();
    for (let i = 0; i < 20; i += 1) {
      state = nextSchedulingState(state, "recalled", NOW);
    }
    const maxStage = REVIEW_INTERVALS_DAYS.length - 1;
    expect(state.reviewStage).toBe(maxStage);
    expect(daysBetween(NOW, state.dueAt!)).toBe(REVIEW_INTERVALS_DAYS[maxStage]);
    // The word still has a future due date; it never becomes permanently done.
    expect(state.dueAt).not.toBeNull();
  });

  it("clamps difficulty within range across repeated results", () => {
    let state = initialSchedulingState();
    for (let i = 0; i < 20; i += 1) {
      state = nextSchedulingState(state, "recalled", NOW);
    }
    expect(state.difficulty).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 20; i += 1) {
      state = nextSchedulingState(state, "wrong", NOW);
    }
    expect(state.difficulty).toBeLessThanOrEqual(1);
  });

  it("preserves the original introduced date on later reviews", () => {
    const first = nextSchedulingState(initialSchedulingState(), "recalled", NOW);
    const later = new Date(NOW.getTime() + 5 * DAY_MS);
    const second = nextSchedulingState(first, "recalled", later);
    expect(second.introducedAt).toEqual(NOW);
  });
});
