export function formatTimestamp(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  return formatTimestamp(seconds);
}

export function formatDateTime(isoString) {
  if (!isoString) return { date: 'Unknown', time: '' };
  try {
    const d = new Date(isoString);
    const date = d.toLocaleDateString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const time = d.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return { date, time };
  } catch {
    return { date: isoString, time: '' };
  }
}
