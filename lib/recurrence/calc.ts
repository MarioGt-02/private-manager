/**
 * Deterministic calendar recurrence math.
 *
 * All dates are represented as `"YYYY-MM-DD"` strings (date-only) and computed
 * using UTC calendar math so a monthly/yearly schedule never shifts across a
 * timezone boundary. `today()` intentionally uses local calendar date because
 * "completion date" means the user's local day.
 */

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurrenceBasis = "scheduled_date" | "completion_date";

function toISODate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  // monthIndex is 0-based
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function parseISODate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

/**
 * Add `interval` units of `frequency` to a date-only value.
 * Monthly/yearly clamp to the end of the target month (Jan 31 + 1 month → Feb 28/29).
 */
export function addInterval(value: string, frequency: RecurrenceFrequency, interval: number): string {
  const { year, month, day } = parseISODate(value);
  const base = new Date(Date.UTC(year, month - 1, day));

  switch (frequency) {
    case "daily":
      base.setUTCDate(base.getUTCDate() + interval);
      break;
    case "weekly":
      base.setUTCDate(base.getUTCDate() + interval * 7);
      break;
    case "monthly": {
      const lastDay = daysInMonth(year, month - 1 + interval);
      base.setUTCDate(1);
      base.setUTCMonth(month - 1 + interval);
      base.setUTCDate(Math.min(day, lastDay));
      break;
    }
    case "yearly": {
      const lastDay = daysInMonth(year + interval, month - 1);
      base.setUTCFullYear(year + interval);
      base.setUTCMonth(month - 1);
      base.setUTCDate(Math.min(day, lastDay));
      break;
    }
  }

  return toISODate(base);
}

/** The user's local calendar date, as `"YYYY-MM-DD"`. */
export function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
