import React, { useState, useEffect } from 'react';
import xowLogo from '../../../assets/xow-logo-light.svg';
import BadgeCard from '../components/BadgeCard';
import VisitorInfoModal from '../components/VisitorInfoModal';
import { formatDuration, formatDateTime, formatTimestamp } from '../utils/formatTime';
import { exportVisitorsCSV } from '../utils/exportCSV';
import { decryptEncFile, parseVisitorData } from '../utils/decryptData';

export default function BadgeGrid({ recording, drive, onBack, onPlay, visitorDataMap, onSetVisitorDataMap }) {
  const [infoVisitor, setInfoVisitor] = useState(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error'|'info', msg }
  const scans = recording.barcodeScans || [];
  const dt = formatDateTime(recording.createdAt);
  const importedCount = Object.keys(visitorDataMap || {}).length;

  // Auto-dismiss toast after 4 s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function handlePlay(timestamp, visitor) {
    onPlay({ startTimestamp: timestamp, visitor });
  }

  function handlePlayFull() {
    onPlay({ startTimestamp: 0, visitor: null });
  }

  async function handleImport() {
    setImporting(true);
    try {
      const result = await window.xowAPI.openEncFile();
      if (!result) { setImporting(false); return; } // user cancelled

      const bytes = new Uint8Array(result.data);
      const decrypted = await decryptEncFile(bytes);
      const { map, count } = parseVisitorData(decrypted, result.fileName);

      onSetVisitorDataMap(map);

      const matchCount = scans.filter(s => map[s.barcode]).length;
      if (count === 0) {
        setToast({ type: 'info', msg: 'File imported but contained no records.' });
      } else if (matchCount === 0) {
        setToast({ type: 'info', msg: `Data imported (${count} records), but no matches found for current visitors.` });
      } else {
        setToast({ type: 'success', msg: `Visitor data imported! ${count} records loaded · ${matchCount} visitor${matchCount !== 1 ? 's' : ''} matched.` });
      }
    } catch (e) {
      setToast({ type: 'error', msg: `Decryption failed: ${e.message}` });
    } finally {
      setImporting(false);
    }
  }

  function handleClearData() {
    onSetVisitorDataMap({});
    setToast({ type: 'info', msg: 'Imported visitor data cleared.' });
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
        <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Data loaded badge */}
          {importedCount > 0 && (
            <div className="import-status-badge">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 12h6M9 16h6M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
              </svg>
              {importedCount} {importedCount === 1 ? 'record' : 'records'} loaded
              <button className="import-clear-btn" onClick={handleClearData} title="Clear imported data">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
          {/* Import button */}
          <button className="btn-import" onClick={handleImport} disabled={importing}>
            {importing ? (
              <>
                <svg className="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Importing...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Import Visitor Data
              </>
            )}
          </button>
        </div>
      </header>

      {/* Toast notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span className="toast-icon">
            {toast.type === 'success' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {toast.type === 'error' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {toast.type === 'info' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="8" strokeWidth="3" strokeLinecap="round" />
                <line x1="12" y1="12" x2="12" y2="16" />
              </svg>
            )}
          </span>
          <span className="toast-msg">{toast.msg}</span>
          <button className="toast-close" onClick={() => setToast(null)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

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
                importedData={(visitorDataMap || {})[scan.barcode] || null}
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
          importedData={(visitorDataMap || {})[infoVisitor.barcode] || null}
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
