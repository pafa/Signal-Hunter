// Convert only timezones already identified by a provider adapter. Never infer US time.
const offsets = new Map([['UTC', 0], ['Asia/Shanghai', 480], ['Asia/Hong_Kong', 480]]);

export function validProviderMinute(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return false;
  const iso = value.replace(' ', 'T') + ':00.000Z';
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString() === iso;
}

export function providerMinuteTimestamp(value, timezone) {
  if (!validProviderMinute(value) || !offsets.has(timezone)) return null;
  return Date.parse(value.replace(' ', 'T') + ':00.000Z') - offsets.get(timezone) * 60000;
}
