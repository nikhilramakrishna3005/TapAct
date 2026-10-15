/** Short header date, for example "Wed, Oct 14". Uses the viewer's locale. */
export function formatTodayHeaderDate(ms: number, locale?: string): string {
  return new Date(ms).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
