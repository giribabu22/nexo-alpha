import { NexoError } from "@nexo-alpha/core";

export class NexoCronError extends NexoError {
  constructor(message: string) {
    super("NEXO_CRON_ERROR", message);
    this.name = "NexoCronError";
  }
}

export interface CronFieldSchedule {
  readonly allowed: ReadonlySet<number>;
  readonly restricted: boolean;
}

export interface CronSchedule {
  readonly minute: CronFieldSchedule;
  readonly hour: CronFieldSchedule;
  readonly dayOfMonth: CronFieldSchedule;
  readonly month: CronFieldSchedule;
  readonly dayOfWeek: CronFieldSchedule;
}

function fullRange(min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (let n = min; n <= max; n++) {
    values.add(n);
  }
  return values;
}

function resolveSegment(segment: string, min: number, max: number): number[] {
  if (segment === "*") {
    return [...fullRange(min, max)];
  }

  const stepOnly = /^\*\/(\d+)$/.exec(segment);
  if (stepOnly) {
    const step = Number(stepOnly[1]);
    if (step <= 0) {
      throw new NexoCronError(`Invalid cron step "${segment}": step must be positive.`);
    }
    const values: number[] = [];
    for (let n = min; n <= max; n += step) {
      values.push(n);
    }
    return values;
  }

  const range = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(segment);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const step = range[3] !== undefined ? Number(range[3]) : 1;

    if (start > end) {
      throw new NexoCronError(`Invalid cron range "${segment}": start is greater than end.`);
    }
    if (step <= 0) {
      throw new NexoCronError(`Invalid cron range "${segment}": step must be positive.`);
    }

    const values: number[] = [];
    for (let n = start; n <= end; n += step) {
      values.push(n);
    }
    return values;
  }

  const exact = /^\d+$/.exec(segment);
  if (exact) {
    return [Number(segment)];
  }

  throw new NexoCronError(`Invalid cron field segment "${segment}".`);
}

function parseField(
  raw: string,
  min: number,
  max: number,
  normalize?: (value: number) => number
): CronFieldSchedule {
  if (raw === "*") {
    return { allowed: fullRange(min, max), restricted: false };
  }

  const values = new Set<number>();

  for (const segment of raw.split(",")) {
    for (const value of resolveSegment(segment, min, max)) {
      const normalized = normalize ? normalize(value) : value;

      if (normalized < min || normalized > max) {
        throw new NexoCronError(
          `Invalid cron field "${raw}": value ${value} is out of range [${min}, ${max}].`
        );
      }

      values.add(normalized);
    }
  }

  return { allowed: values, restricted: true };
}

export function parseCronExpression(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new NexoCronError(
      `Invalid cron expression "${expression}": expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}.`
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string
  ];

  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dayOfMonth, 1, 31),
    month: parseField(month, 1, 12),
    // 7 is a common alias for Sunday alongside 0; normalize so both mean the same thing.
    dayOfWeek: parseField(dayOfWeek, 0, 7, (value) => (value === 7 ? 0 : value))
  };
}

function matches(schedule: CronSchedule, date: Date): boolean {
  const minuteOk = schedule.minute.allowed.has(date.getMinutes());
  const hourOk = schedule.hour.allowed.has(date.getHours());
  const monthOk = schedule.month.allowed.has(date.getMonth() + 1);

  const domOk = schedule.dayOfMonth.allowed.has(date.getDate());
  const dowOk = schedule.dayOfWeek.allowed.has(date.getDay());

  const dayOk =
    schedule.dayOfMonth.restricted && schedule.dayOfWeek.restricted
      ? domOk || dowOk
      : domOk && dowOk;

  return minuteOk && hourOk && monthOk && dayOk;
}

const MAX_SEARCH_MINUTES = 60 * 24 * 366 * 4;

export function getNextRunTime(schedule: CronSchedule, from: Date): Date {
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < MAX_SEARCH_MINUTES; i++) {
    if (matches(schedule, candidate)) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new NexoCronError(
    "No matching cron run time found within the 4-year search horizon."
  );
}
