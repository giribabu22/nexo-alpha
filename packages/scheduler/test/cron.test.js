import test from "node:test";
import assert from "node:assert/strict";

import { parseCronExpression, getNextRunTime } from "../dist/index.js";

test("parses '* * * * *' as unrestricted on every field", () => {
  const schedule = parseCronExpression("* * * * *");

  assert.equal(schedule.minute.restricted, false);
  assert.equal(schedule.hour.restricted, false);
  assert.equal(schedule.dayOfMonth.restricted, false);
  assert.equal(schedule.month.restricted, false);
  assert.equal(schedule.dayOfWeek.restricted, false);
});

test("parses '*/5 * * * *' as every 5th minute", () => {
  const schedule = parseCronExpression("*/5 * * * *");

  assert.deepEqual(
    [...schedule.minute.allowed].sort((a, b) => a - b),
    [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
  );
});

test("parses '0 9 * * 1-5' as 9am on weekdays", () => {
  const schedule = parseCronExpression("0 9 * * 1-5");

  assert.deepEqual([...schedule.minute.allowed], [0]);
  assert.deepEqual([...schedule.hour.allowed], [9]);
  assert.deepEqual(
    [...schedule.dayOfWeek.allowed].sort((a, b) => a - b),
    [1, 2, 3, 4, 5]
  );
});

test("parses '15,45 * * * *' as a comma-separated minute list", () => {
  const schedule = parseCronExpression("15,45 * * * *");

  assert.deepEqual([...schedule.minute.allowed].sort((a, b) => a - b), [15, 45]);
});

test("normalizes day-of-week 7 to 0 (Sunday)", () => {
  const schedule = parseCronExpression("0 0 * * 7");

  assert.deepEqual([...schedule.dayOfWeek.allowed], [0]);
});

test("rejects an expression without exactly 5 fields", () => {
  assert.throws(() => parseCronExpression("* * * *"), /expected 5 fields/);
  assert.throws(() => parseCronExpression("* * * * * *"), /expected 5 fields/);
});

test("rejects an out-of-range value", () => {
  assert.throws(() => parseCronExpression("60 * * * *"), /out of range/);
  assert.throws(() => parseCronExpression("* 24 * * *"), /out of range/);
});

test("rejects garbage syntax", () => {
  assert.throws(() => parseCronExpression("abc * * * *"), /Invalid cron field segment/);
});

test("getNextRunTime finds the next matching minute for '*/5 * * * *'", () => {
  const schedule = parseCronExpression("*/5 * * * *");
  const from = new Date(2026, 0, 1, 10, 2, 30); // Jan 1 2026, 10:02:30

  const next = getNextRunTime(schedule, from);

  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 0);
  assert.equal(next.getDate(), 1);
  assert.equal(next.getHours(), 10);
  assert.equal(next.getMinutes(), 5);
  assert.equal(next.getSeconds(), 0);
});

test("getNextRunTime rolls over to the next day when no hour matches today", () => {
  const schedule = parseCronExpression("0 9 * * *");
  const from = new Date(2026, 0, 1, 10, 0, 0); // already past 9am

  const next = getNextRunTime(schedule, from);

  assert.equal(next.getDate(), 2);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);
});

test("getNextRunTime uses OR semantics when both day-of-month and day-of-week are restricted", () => {
  // The 1st of the month, OR any Monday.
  const schedule = parseCronExpression("0 0 1 * 1");

  // Jan 2, 2026 is a Friday, not the 1st and not a Monday -> should skip ahead
  // to Jan 5, 2026 (Monday).
  const from = new Date(2026, 0, 2, 0, 0, 0);
  const next = getNextRunTime(schedule, from);

  assert.equal(next.getDate(), 5);
  assert.equal(next.getDay(), 1);
});
