/** Display uses the viewing device's clock/time zone, with an explicit 12-hour format. */
export function formatClock(date = new Date()) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00 ', ' ');
}
export function formatLocalDate(date = new Date()) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
export function relativeDay(date, now = new Date()) {
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  return date.toDateString() === now.toDateString() ? 'today' : date.toDateString() === tomorrow.toDateString() ? 'tomorrow' : date.toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'});
}
