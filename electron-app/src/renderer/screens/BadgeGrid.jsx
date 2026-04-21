import React, { useState } from 'react';
import xowLogo from '../../../assets/xow-logo-light.svg';
import BadgeCard from '../components/BadgeCard';
import VisitorInfoModal from '../components/VisitorInfoModal';
import { formatDuration, formatDateTime, formatTimestamp } from '../utils/formatTime';
import { exportVisitorsCSV } from '../utils/exportCSV';

export default function BadgeGrid({ recording, drive, onBack, onPlay }) {
  const [infoVisitor, setInfoVisitor] = useState(null);
  const scans = recording.barcodeScans || [];
  const dt = formatDateTime(recording.createdAt);

  function handlePlay(timestamp, visitor) {
    onPlay({ startTimestamp: timestamp, visitor });
  }

  function handlePlayFull() {
    onPlay({ startTimestamp: 0, visitor: null });
  }

  async function handleExportCSV() {
    const sessionDate = dt.date.replace(/[/]/g, '-');
    const defaultName = `visitors_${sessionDate}.csv`;
    const csv = exportVisitorsCSV(scans, recording.createdAt);
    try {
      const result = await window.xowAPI.saveCsv(csv, defaultName);
      if (result.success) {
        // Brief flash — use native alert in Electron context
        alert(`Saved to: ${result.path}`);
      }
    } catch (e) {
      alert('Export failed: ' + e.message);
    }
  }

  return (
    <div className="screen">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <img src={xowLogo} alt="XoW" className="app-logo-img header-logo-sm" />
          <div className="header-divider" />
          <button className="btn-back" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Recordings
          </button>
          <div className="header-divider" />
          <div className="header-info">
            <span className="header-duration" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              {formatDuration(recording.totalDuration)}
            </span>
            <span className="header-dot">·</span>
            <span className="header-visitors" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
              {scans.length} visitors
            </span>
          </div>
        </div>
        <div className="header-right">
          {/* No offline badge */}
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content badge-main">
        {scans.length === 0 ? (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="23" y1="18" x2="17" y2="18" />
            </svg>
            <p>No visitor scans in this recording</p>
            <p className="empty-sub">The recording contains video but no barcode scans were captured.</p>
            <button className="btn-primary mt-4" onClick={handlePlayFull}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Play Full Recording
            </button>
          </div>
        ) : (
          <div className="badge-grid">
            {scans.map((scan, idx) => (
              <BadgeCard
                key={scan.barcode + idx}
                visitor={scan}
                onPlay={(ts) => handlePlay(ts, scan)}
                onInfo={(v) => setInfoVisitor(v)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer Actions */}
      {scans.length > 0 && (
        <footer className="badge-footer">
          <button className="btn-play-full" onClick={handlePlayFull}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Play Full Recording
          </button>
        </footer>
      )}

      {/* Visitor Info Modal */}
      {infoVisitor && (
        <VisitorInfoModal
          visitor={infoVisitor}
          isOpen={!!infoVisitor}
          onClose={() => setInfoVisitor(null)}
          onPlay={(ts) => {
            setInfoVisitor(null);
            handlePlay(ts, infoVisitor);
          }}
        />
      )}
    </div>
  );
}
