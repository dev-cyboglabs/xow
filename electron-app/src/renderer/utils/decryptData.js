import * as XLSX from 'xlsx';

const FIXED_KEY = '3f8a2c7d1e4b9f6a05c8e2d7b3a1f4c90e6d8b2a5f7c3e9d1b4a8f2c6e0d5b7a';

function hexToBytes(hex) {
  const clean = hex.replace(/\s/g, '');
  return new Uint8Array(clean.match(/.{2}/g).map(b => parseInt(b, 16)));
}

// Decrypts an XoW .enc file (XoWE magic + 12-byte IV + AES-256-GCM ciphertext)
export async function decryptEncFile(uint8Array) {
  if (
    uint8Array[0] !== 0x58 || uint8Array[1] !== 0x6F ||
    uint8Array[2] !== 0x57 || uint8Array[3] !== 0x45
  ) {
    throw new Error('Invalid file: not an XoW encrypted file. Missing XoWE header.');
  }
  const iv = uint8Array.slice(4, 16);
  const ciphertext = uint8Array.slice(16);
  const keyBytes = hexToBytes(FIXED_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, cryptoKey, ciphertext
  );
  return new Uint8Array(decrypted);
}

function normHeader(h) {
  return String(h).toLowerCase().replace(/[\s_\-.]+/g, '');
}

function findCol(headers, ...terms) {
  const norm = headers.map(normHeader);
  // Try exact match first
  for (const term of terms) {
    const i = norm.findIndex(h => h === term);
    if (i !== -1) return i;
  }
  // Then try substring match
  for (const term of terms) {
    const i = norm.findIndex(h => h.includes(term));
    if (i !== -1) return i;
  }
  return -1;
}

function parseCSVLine(line) {
  const parts = [];
  let cur = '', quoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; }
    else if (ch === ',' && !quoted) { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

// Parses decrypted bytes into a visitor map keyed by barcode/visitor ID
export function parseVisitorData(uint8Array, encFileName) {
  const origName = encFileName.replace(/\.enc$/i, '');
  const ext = origName.split('.').pop().toLowerCase();

  let headers, rows;

  if (ext === 'csv') {
    let text = new TextDecoder().decode(uint8Array);
    // Remove BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) throw new Error('Decrypted file is empty.');
    headers = parseCSVLine(lines[0]);
    console.log('DEBUG: Parsed CSV headers:', headers);
    rows = lines.slice(1).map(parseCSVLine);
  } else {
    // xlsx / xls
    const wb = XLSX.read(uint8Array, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    headers = (data[0] || []).map(String);
    rows = data.slice(1).map(r => headers.map((_, i) => String(r[i] ?? '')));
  }

  const idCol    = findCol(headers, 'visitorid', 'badgeid', 'barcode', 'visitorbarcode', 'id');
  const nameCol  = findCol(headers, 'visitorname', 'fullname', 'name');
  const compCol  = findCol(headers, 'company', 'organization', 'org', 'employer');
  const emailCol = findCol(headers, 'email', 'emailaddress', 'mail');
  const phoneCol = findCol(headers, 'phone', 'mobile', 'contact', 'tel', 'phonenumber');

  console.log('DEBUG: Column indices - ID:', idCol, 'Name:', nameCol, 'Company:', compCol, 'Email:', emailCol, 'Phone:', phoneCol);
  console.log('DEBUG: Normalized headers:', headers.map(h => normHeader(h)));

  if (idCol === -1) {
    throw new Error(
      'Cannot find visitor ID column.\n' +
      'Expected a column named "Visitor ID", "Barcode", "Badge ID", or "ID".\n' +
      `Found columns: ${headers.join(', ')}\n` +
      `Normalized: ${headers.map(h => normHeader(h)).join(', ')}`
    );
  }

  const map = {};
  for (const row of rows) {
    const id = String(row[idCol] || '').trim();
    if (!id) continue;
    map[id] = {
      visitorName: nameCol  >= 0 ? String(row[nameCol]  || '').trim() : '',
      company:     compCol  >= 0 ? String(row[compCol]  || '').trim() : '',
      email:       emailCol >= 0 ? String(row[emailCol] || '').trim() : '',
      phone:       phoneCol >= 0 ? String(row[phoneCol] || '').trim() : '',
    };
  }

  return { map, count: Object.keys(map).length };
}
