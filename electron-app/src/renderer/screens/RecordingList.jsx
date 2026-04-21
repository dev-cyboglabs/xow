import React, { useState, useEffect, useCallback } from 'react';
import { formatDuration, formatDateTime } from '../utils/formatTime';
import xowLogo from '../../../assets/xow-logo-light.svg';

export default function RecordingList({ selectedDrive, onDriveChange, onOpenRecording }) {
  const [drives, setDrives] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);

  const loadDrives = useCallback(async () => {
    try {
      const found = await window.xowAPI.getDrives();
      setDrives(found || []);
      if (!selectedDrive && found && found.length > 0) {
        const xowDrive = found.find((d) => d.hasXoW) || found[0];
        onDriveChange(xowDrive);
      }
    } catch (e) {
      console.error('Drive detection failed:', e);
    }
  }, [selectedDrive, onDriveChange]);

  useEffect(() => {
    loadDrives();
  }, []);

  useEffect(() => {
    if (selectedDrive) loadRecordings(selectedDrive.mountpoint);
  }, [selectedDrive]);

  async function loadRecordings(mountpoint) {
    setLoading(true);
    setError('');
    try {
      const result = await window.xowAPI.getRecordings(mountpoint);
      if (result.error) setError(result.error);
      setRecordings(result.recordings || []);
    } catch (e) {
      setError('Failed to read recordings: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setScanning(true);
    try {
      // Reload drives
      const found = await window.xowAPI.getDrives();
      setDrives(found || []);
      
      // If current drive is no longer available, select first drive with recordings
      const currentDriveStillExists = found?.some(d => d.mountpoint === selectedDrive?.mountpoint);
      
      if (!currentDriveStillExists && found && found.length > 0) {
        // Current drive removed, select first available drive with recordings
        const xowDrive = found.find((d) => d.hasXoW) || found[0];
        onDriveChange(xowDrive);
        await loadRecordings(xowDrive.mountpoint);
      } else if (selectedDrive) {
        // Current drive still exists, reload its recordings
        await loadRecordings(selectedDrive.mountpoint);
      }
    } catch (e) {
      console.error('Refresh failed:', e);
    } finally {
      setScanning(false);
    }
  }

  function handleDriveSelect(e) {
    const mp = e.target.value;
    const drive = drives.find((d) => d.mountpoint === mp);
    if (drive) onDriveChange(drive);
  }

  return (
    <div className="screen">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="app-logo">
            <img src={xowLogo} alt="XoW" className="app-logo-img" />
          </div>
        </div>
        <div className="header-right">
          {/* No offline badge */}
        </div>
      </header>

      {/* Drive Selector */}
      <div className="drive-selector-bar">
        <div className="drive-selector-inner">
          <div className="drive-selector-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <span>Drive</span>
          </div>
          <select
            className="drive-select"
            value={selectedDrive?.mountpoint || ''}
            onChange={handleDriveSelect}
          >
            {drives.length === 0 && (
              <option value="">No removable drives found</option>
            )}
            {drives.map((d) => (
              <option key={d.mountpoint} value={d.mountpoint}>
                {d.description} {d.hasXoW ? '✓ XoW' : ''}
              </option>
            ))}
          </select>
          <button className="btn-ghost" onClick={handleRefresh} disabled={scanning}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={scanning ? 'spin' : ''}
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {scanning ? 'Scanning...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="main-content">
        {!selectedDrive && (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <p>Insert an SD card or USB drive and click Refresh</p>
          </div>
        )}

        {selectedDrive && loading && (
          <div className="empty-state">
            <div className="spinner" />
            <p>Scanning for recordings...</p>
          </div>
        )}

        {selectedDrive && !loading && error && (
          <div className="error-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E54B2A" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="error-text">{error}</p>
            <p className="error-sub">Make sure the drive has a <code>XoW</code> folder with metadata files.</p>
          </div>
        )}

        {selectedDrive && !loading && !error && recordings.length === 0 && (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <p>No recordings found in {selectedDrive.mountpoint}XoW</p>
            <p className="empty-sub">Transfer recording files from your Android device first.</p>
          </div>
        )}

        {selectedDrive && !loading && recordings.length > 0 && (
          <div className="recordings-section">
            <div className="section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              {recordings.length} Recording{recordings.length !== 1 ? 's' : ''} on {selectedDrive.description}
            </div>
            <div className="recordings-list">
              {recordings.map((rec) => (
                <RecordingItem
                  key={rec.sessionId}
                  recording={rec}
                  onOpen={() => onOpenRecording(rec, selectedDrive)}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function RecordingItem({ recording, onOpen }) {
  const dt = formatDateTime(recording.createdAt);
  const duration = formatDuration(recording.totalDuration);
  const visitorCount = recording.barcodeScans?.length || 0;

  return (
    <div className="recording-item">
      <div className="rec-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E54B2A" strokeWidth="1.5">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </div>
      <div className="rec-details">
        <div className="rec-datetime">{dt.date} &mdash; {dt.time}</div>
        <div className="rec-meta">
          <span className="rec-badge duration">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            {duration}
          </span>
          <span className="rec-badge visitors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {visitorCount} visitor{visitorCount !== 1 ? 's' : ''}
          </span>
          {recording.isComplete && (
            <span className="rec-badge complete">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Complete
            </span>
          )}
        </div>
      </div>
      <div className="rec-actions">
        <button className="btn-primary" onClick={onOpen}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 3h22v18H1zM1 9h22" />
          </svg>
          Open Recording
        </button>
      </div>
    </div>
  );
}
