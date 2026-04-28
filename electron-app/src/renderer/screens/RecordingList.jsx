import React, { useState, useEffect, useCallback } from 'react';
import { formatDuration, formatDateTime, formatDateTime12Hour } from '../utils/formatTime';
import xowLogo from '../../../assets/xow-logo-light.svg';

export default function RecordingList({ selectedDrive, onDriveChange, onOpenRecording }) {
  const [drives, setDrives] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState(null);

  // Auto-dismiss save toast
  useEffect(() => {
    if (!saveToast) return;
    const t = setTimeout(() => setSaveToast(null), 5000);
    return () => clearTimeout(t);
  }, [saveToast]);

  async function showLocalPath() {
    const localPath = await window.xowAPI.getLocalPath();
    alert(`Local storage path:\n${localPath}`);
  }

  async function handleImportToLocal() {
    if (!selectedDrive || selectedDrive.isLocal) return;
    setSaving(true);
    try {
      const result = await window.xowAPI.importToLocal(selectedDrive.mountpoint);
      if (!result.success) {
        setSaveToast({ type: 'error', msg: result.error || 'Import failed.' });
        return;
      }
      setSaveToast({ type: 'success', msg: `Saved locally! ${result.copiedFiles} files copied. Drive can now be unplugged.` });
      // Refresh drives so Local Storage entry appears
      const found = await window.xowAPI.getDrives();
      setDrives(found || []);
      const localEntry = found?.find(d => d.isLocal);
      if (localEntry) onDriveChange(localEntry);
    } catch (e) {
      setSaveToast({ type: 'error', msg: 'Import failed: ' + e.message });
    } finally {
      setSaving(false);
    }
  }

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
    
    // Auto-detect drive changes every 2 seconds
    const interval = setInterval(async () => {
      try {
        const found = await window.xowAPI.getDrives();
        const currentDriveCount = drives.length;
        const newDriveCount = found?.length || 0;
        
        // Only update if drive count changed (insertion or removal)
        if (currentDriveCount !== newDriveCount) {
          console.log('Drive change detected:', currentDriveCount, '->', newDriveCount);
          setDrives(found || []);
          
          // If new drive inserted and no drive currently selected
          if (!selectedDrive && found && found.length > 0) {
            const xowDrive = found.find((d) => d.hasXoW) || found[0];
            onDriveChange(xowDrive);
          }
          
          // If current drive was removed
          const currentDriveStillExists = found?.some(d => d.mountpoint === selectedDrive?.mountpoint);
          if (selectedDrive && !currentDriveStillExists) {
            if (found && found.length > 0) {
              const xowDrive = found.find((d) => d.hasXoW) || found[0];
              onDriveChange(xowDrive);
            } else {
              onDriveChange(null);
              setRecordings([]);
              setError('');
            }
          }
        }
      } catch (e) {
        console.error('Auto-detect failed:', e);
      }
    }, 2000); // Check every 2 seconds
    
    return () => clearInterval(interval);
  }, [drives.length, selectedDrive, onDriveChange]);

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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              <option value="">Waiting for external storage...</option>
            )}
            {drives.map((d) => (
              <option key={d.mountpoint} value={d.mountpoint}>
                {d.description} {d.hasXoW ? '✓ XoW' : ''}
              </option>
            ))}
          </select>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {selectedDrive && !selectedDrive.isLocal && (
              <button
                className="btn-import"
                onClick={handleImportToLocal}
                disabled={saving}
                title="Save recordings locally for offline use"
              >
                {saving ? (
                  <>
                    <svg className="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Save Locally
                  </>
                )}
              </button>
            )}
            <button className="btn-ghost" onClick={showLocalPath} title="Show local storage path">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <button className="btn-ghost" onClick={handleRefresh} disabled={scanning} title="Manual refresh">
              <svg
                width="18"
                height="18"
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
            </button>
          </div>
        </div>
      </div>

      {/* Save toast */}
      {saveToast && (
        <div className={`toast toast-${saveToast.type}`}>
          <span className="toast-icon">
            {saveToast.type === 'success' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {saveToast.type === 'error' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
          </span>
          <span className="toast-msg">{saveToast.msg}</span>
          <button className="toast-close" onClick={() => setSaveToast(null)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="main-content">
        {!selectedDrive && (
          <div className="empty-state">
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
              <path d="M20 7h-3a2 2 0 0 1-2-2V2"/>
              <path d="M9 18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2z"/>
              <path d="M3 7v11a2 2 0 0 0 2 2h2"/>
              <rect x="9" y="2" width="11" height="20" rx="2"/>
            </svg>
            <p style={{fontSize: '22px', fontWeight: 600, marginTop: '20px'}}>Insert External Storage</p>
            <p style={{fontSize:'18px'}} className="empty-sub">Connect a USB drive or SD card with XoW Play</p>
      
          </div>
        )}

        {selectedDrive && loading && (
          <div className="empty-state">
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <p style={{fontSize: '22px', fontWeight: 600, marginTop: '20px'}}>Scanning for recordings...</p>
            <p style={{fontSize:'18px'}} className="empty-sub">Please wait while we search the drive</p>
          </div>
        )}

        {selectedDrive && !loading && error && (
          <div className="error-state">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#E54B2A" strokeWidth="1.2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <p className="error-text">No XoW Recordings Found</p>
            <p className="error-sub">Please insert an external storage device with XoW recordings</p>
            <p className="error-sub" style={{marginTop: '8px', fontSize: '12px', opacity: 0.7}}>Make sure the drive contains a <code>XoW</code> folder with <code>metadata_*.json</code> files</p>
          </div>
        )}

        {selectedDrive && !loading && !error && recordings.length === 0 && (
          <div className="empty-state">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <p style={{fontSize: '18px', fontWeight: 600, marginTop: '20px'}}>No Recordings Found</p>
            <p className="empty-sub">Transfer recording files from your Android device to:</p>
            <p className="empty-sub" style={{marginTop: '8px'}}><code style={{fontSize: '13px'}}>{selectedDrive.mountpoint}XoW/</code></p>
          </div>
        )}

        {selectedDrive && !loading && recordings.length > 0 && (
          <div style={{padding: '0 20px 20px'}}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px'
            }}>
              <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--play)" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <h2 style={{fontSize: '16px', fontWeight: 600, color: 'var(--text)'}}>
                  {recordings.length} Recording{recordings.length !== 1 ? 's' : ''}
                </h2>
              </div>
              <span style={{fontSize: '12px', color: 'var(--text-sub)'}}>{selectedDrive.description}</span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '16px'
            }}>
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
  const dt = formatDateTime12Hour(recording.createdAt);
  const duration = formatDuration(recording.totalDuration);
  const visitorCount = recording.barcodeScans?.length || 0;
  
  const durationHours = Math.floor(recording.totalDuration / 3600);
  const durationMinutes = Math.floor((recording.totalDuration % 3600) / 60);
  const formattedDuration = durationHours > 0 
    ? `${durationHours}:${String(durationMinutes).padStart(2, '0')} hr`
    : `${durationMinutes}:${String(Math.floor(recording.totalDuration % 60)).padStart(2, '0')} min`;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
    }}>
      {/* Header */}
      <div style={{display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border)'}}>
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '6px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <div style={{flex: 1}}>
          <div style={{fontSize: '14px', fontWeight: 600, color: 'var(--text)'}}>Recording Session</div>
          {recording.isComplete && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              marginTop: '3px',
              color: 'var(--text-sub)',
              fontSize: '11px',
              fontWeight: 500
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Complete
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
        <div style={{display: 'flex', alignItems: 'center'}}>
          <span style={{color: 'var(--text-sub)', fontWeight: 500, minWidth: '100px', fontSize: '12px'}}>Date:</span>
          <span style={{color: 'var(--text)', fontWeight: 600, fontSize: '13px'}}>{dt.date}</span>
        </div>
        <div style={{display: 'flex', alignItems: 'center'}}>
          <span style={{color: 'var(--text-sub)', fontWeight: 500, minWidth: '100px', fontSize: '12px'}}>Time start:</span>
          <span style={{color: 'var(--text)', fontWeight: 600, fontSize: '13px'}}>{dt.time}</span>
        </div>
        <div style={{display: 'flex', alignItems: 'center'}}>
          <span style={{color: 'var(--text-sub)', fontWeight: 500, minWidth: '100px', fontSize: '12px'}}>Total duration:</span>
          <span style={{color: 'var(--text)', fontWeight: 600, fontSize: '13px'}}>{formattedDuration}</span>
        </div>
        <div style={{display: 'flex', alignItems: 'center'}}>
          <span style={{color: 'var(--text-sub)', fontWeight: 500, minWidth: '100px', fontSize: '12px'}}>Visitor count:</span>
          <span style={{color: 'var(--text)', fontWeight: 700, fontSize: '13px'}}>{visitorCount}</span>
        </div>
      </div>

      {/* Action button */}
      <button className="btn-primary" onClick={onOpen} style={{
        width: '100%',
        justifyContent: 'center',
        marginTop: '4px'
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        Open Recording
      </button>
    </div>
  );
}
