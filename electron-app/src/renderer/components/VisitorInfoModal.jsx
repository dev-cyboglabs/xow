import { useEffect, useState } from 'react';
import { formatTimestamp, formatDurationWithUnit } from '../utils/formatTime';

/* ── Video thumbnail captured at visitor's timestamp ─────── */
function VideoThumbnail({ recording, timestamp }) {
  const [src, setSrc] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!recording?.videoChunks?.length) { setStatus('error'); return; }

    let cancelled = false;
    let vid = null;

    async function capture() {
      try {
        const chunkObj = recording.videoChunks[0];
        // videoChunks entries are objects with a .fileName property
        const chunkName = typeof chunkObj === 'string' ? chunkObj : chunkObj?.fileName;
        if (!chunkName) { setStatus('error'); return; }

        const filePath = await window.xowAPI.getVideoPath(
          recording.drivePath, chunkName, recording.metaDir
        );
        if (!filePath || cancelled) { setStatus('error'); return; }

        const url = window.xowAPI.filePathToUrl(filePath);
        vid = document.createElement('video');
        vid.muted = true;
        vid.preload = 'metadata';
        vid.src = url;

        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 6000);
          vid.onloadedmetadata = () => {
            const seekTo = Math.max(0, Math.min(timestamp, vid.duration - 0.1));
            vid.currentTime = seekTo;
          };
          vid.onseeked = () => { clearTimeout(t); resolve(); };
          vid.onerror  = () => { clearTimeout(t); reject(new Error('load error')); };
        });

        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.width  = 320;
        canvas.height = 180;
        canvas.getContext('2d').drawImage(vid, 0, 0, 320, 180);
        if (!cancelled) { setSrc(canvas.toDataURL('image/jpeg', 0.85)); setStatus('ready'); }
      } catch {
        if (!cancelled) setStatus('error');
      } finally {
        if (vid) { vid.src = ''; }
      }
    }

    capture();
    return () => { cancelled = true; if (vid) vid.src = ''; };
  }, [recording, timestamp]);

  if (status === 'ready' && src) {
    return <img src={src} className="modal-thumb" alt="Video frame" />;
  }

  return (
    <div className={`modal-thumb-placeholder${status === 'loading' ? ' loading' : ''}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    </div>
  );
}

export default function VisitorInfoModal({ visitor, importedData, recording, isOpen, onClose, onPlay }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  if (!isOpen || !visitor) return null;

  // Merge imported data (takes priority) with scan data
  const resolvedName    = importedData?.visitorName || visitor.visitorName || '';
  const resolvedCompany = importedData?.company     || visitor.company     || '';
  const resolvedEmail   = importedData?.email       || visitor.email       || '';
  const resolvedPhone   = importedData?.phone       || visitor.phone       || '';

  const hasName = resolvedName.trim() !== '';
  const displayName = hasName ? resolvedName : `Visitor ID: ${visitor.barcode || 'Unknown'}`;

  function copyInfo() {
    const text = [
      `Name: ${resolvedName || '—'}`,
      `Company: ${resolvedCompany || '—'}`,
      `Email: ${resolvedEmail || '—'}`,
      `Phone: ${resolvedPhone || '—'}`,
      `Badge ID: ${visitor.barcode}`,
      `Scanned: ${formatDurationWithUnit(visitor.timestamp)}`,
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
    }).catch(() => {});
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <span className="modal-title">Visitor Information</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Video thumbnail + Name */}
        <div className="modal-avatar-row">
          <VideoThumbnail recording={recording} timestamp={visitor.timestamp} />
          <div>
            <div className="modal-visitor-name">{displayName}</div>
            {resolvedCompany.trim() !== '' && <div className="modal-visitor-company">{resolvedCompany}</div>}
          </div>
        </div>

        {/* Info Rows */}
        <div className="modal-info-rows">
          <InfoRow
            icon={<PersonIcon />}
            label="Name"
            value={resolvedName || <span className="muted">—</span>}
          />
          <InfoRow
            icon={<BuildingIcon />}
            label="Company"
            value={resolvedCompany || <span className="muted">—</span>}
          />
          <InfoRow
            icon={<EmailIcon />}
            label="Email"
            value={resolvedEmail || <span className="muted">—</span>}
          />
          <InfoRow
            icon={<PhoneIcon />}
            label="Phone"
            value={resolvedPhone || <span className="muted">—</span>}
          />
          <InfoRow
            icon={<TagIcon />}
            label="Badge ID"
            value={<code className="badge-code">{visitor.barcode}</code>}
          />
          <InfoRow
            icon={<ClockIcon />}
            label="Scanned"
            value={formatDurationWithUnit(visitor.timestamp)}
          />
        </div>

        {/* Play CTA */}
        <button
          className="modal-play-btn"
          onClick={() => onPlay(visitor.timestamp)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Play @ {formatTimestamp(visitor.timestamp)}
        </button>

        {/* Footer */}
        <div className="modal-footer">
          <button className={`btn-secondary${copied ? ' btn-success' : ''}`} onClick={copyInfo}>
            {copied ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy Info
              </>
            )}
          </button>
          <button className="btn-ghost" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="info-row">
      <div className="info-row-icon">{icon}</div>
      <div className="info-row-label">{label}</div>
      <div className="info-row-value">{value}</div>
    </div>
  );
}

const PersonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const BuildingIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M9 22V12h6v10M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01" />
  </svg>
);
const EmailIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);
const PhoneIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5 19.79 19.79 0 0 1 1.61 4.9 2 2 0 0 1 3.59 2.72h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
const TagIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);
const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);
