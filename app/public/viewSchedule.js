/** Pick a dashboard design using the device's local clock. */
export function scheduledDesign(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new TypeError('scheduledDesign requires a valid Date.');
  }
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 360 && minutes < 690) return 'b';
  if (minutes >= 690 && minutes < 1140) return 'a';
  return 'c';
}

/** Parse only view controls, leaving model and task commands to their handlers. */
export function parseViewCommand(text) {
  if (typeof text !== 'string') return null;
  const normalized = text.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(?:resume|enable|start|restore|use|switch to|turn on)\s+(?:the\s+)?(?:automatic|auto)\s+(?:views?|themes?|designs?|cycle)\b/.test(normalized)
      || /\b(?:set|switch|change)\s+(?:the\s+)?(?:view|theme|design)\s+to\s+(?:automatic|auto)\b/.test(normalized)
      || /^(?:automatic|auto)\s+(?:views?|themes?|designs?)$/.test(normalized)) {
    return { mode: 'auto' };
  }
  const match = normalized.match(/\b(?:view|theme|design)\s+(?:to\s+)?(a|b|c|aye|bee|see|evergreen|daylight|mission control)\b/)
    || normalized.match(/\b(?:switch to|show|use|open)\s+(evergreen|daylight|mission control)\b/);
  if (!match) return null;
  const design = { a: 'a', aye: 'a', evergreen: 'a', b: 'b', bee: 'b', daylight: 'b', c: 'c', see: 'c', 'mission control': 'c' }[match[1]];
  return { mode: 'manual', design };
}
