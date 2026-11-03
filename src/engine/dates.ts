/**
 * Relative dates: "today", "+30d", "-7d", "+2w", "+1m", "+1y".
 * Resolved to a Salesforce date string (YYYY-MM-DD) in the runner's local time zone.
 */
const RELATIVE_DATE = /^(?:today|([+-])(\d+)([dwmy]))$/;

export function isRelativeDate(value: string): boolean {
  return RELATIVE_DATE.test(value);
}

export function resolveRelativeDate(value: string, now: Date = new Date()): string | undefined {
  const match = RELATIVE_DATE.exec(value);
  if (!match) return undefined;

  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (value !== 'today') {
    const amount = Number(match[2]) * (match[1] === '-' ? -1 : 1);
    switch (match[3]) {
      case 'd':
        date.setDate(date.getDate() + amount);
        break;
      case 'w':
        date.setDate(date.getDate() + amount * 7);
        break;
      case 'm':
        date.setMonth(date.getMonth() + amount);
        break;
      default:
        date.setFullYear(date.getFullYear() + amount);
    }
  }
  return formatDate(date);
}

export function formatDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
