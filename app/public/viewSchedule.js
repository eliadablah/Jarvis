// Daily rotation across the five looks, by the device's local clock:
//   06:00 B Daylight, 09:00 D Aurora, 12:00 A Evergreen, 15:00 E Ember,
//   18:00 C Mission control, 22:00 D Aurora (night).
// A placeholder rotation so the looks can be compared on dev; edit the table to change it.
const ROTATION = [
  [360, 'b'],
  [540, 'd'],
  [720, 'a'],
  [900, 'e'],
  [1080, 'c'],
  [1320, 'd'],
];

/** Pick a dashboard design using the device's local clock. */
export function scheduledDesign(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new TypeError('scheduledDesign requires a valid Date.');
  }
  const minutes = date.getHours() * 60 + date.getMinutes();
  // Before 06:00 the previous evening's last slot (Aurora night) is still running.
  let design = ROTATION[ROTATION.length - 1][1];
  for (const [start, name] of ROTATION) if (minutes >= start) design = name;
  return design;
}

const NAMES = {
  a: 'a', aye: 'a', evergreen: 'a',
  b: 'b', bee: 'b', daylight: 'b',
  c: 'c', see: 'c', 'mission control': 'c',
  d: 'd', dee: 'd', aurora: 'd',
  e: 'e', ember: 'e',
};

/** Parse only view controls, leaving model and task commands to their handlers. */
export function parseViewCommand(text) {
  if (typeof text !== 'string') return null;
  const normalized = text.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(?:resume|enable|start|restore|use|switch to|turn on)\s+(?:the\s+)?(?:automatic|auto)\s+(?:views?|themes?|designs?|cycle)\b/.test(normalized)
      || /\b(?:set|switch|change)\s+(?:the\s+)?(?:view|theme|design)\s+to\s+(?:automatic|auto)\b/.test(normalized)
      || /^(?:automatic|auto)\s+(?:views?|themes?|designs?)$/.test(normalized)) {
    return { mode: 'auto' };
  }
  const match = normalized.match(/\b(?:view|theme|design)\s+(?:to\s+)?(a|b|c|d|e|aye|bee|see|dee|evergreen|daylight|mission control|aurora|ember)\b/)
    || normalized.match(/\b(?:switch to|show|use|open)\s+(evergreen|daylight|mission control|aurora|ember)\b/);
  if (!match) return null;
  return { mode: 'manual', design: NAMES[match[1]] };
}
