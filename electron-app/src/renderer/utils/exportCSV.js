import { formatTimestamp } from './formatTime';

export function exportVisitorsCSV(scans, createdAt) {
  const header = ['Name', 'Company', 'Email', 'Phone', 'Badge ID', 'Timestamp (m:ss)', 'Timestamp (s)'];

  const rows = scans.map((scan) => [
    csvEscape(scan.visitorName || ''),
    csvEscape(scan.company || ''),
    csvEscape(scan.email || ''),
    csvEscape(scan.phone || ''),
    csvEscape(scan.barcode),
    csvEscape(formatTimestamp(scan.timestamp)),
    scan.timestamp,
  ]);

  const lines = [header.join(','), ...rows.map((r) => r.join(','))];
  return lines.join('\r\n');
}

function csvEscape(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
