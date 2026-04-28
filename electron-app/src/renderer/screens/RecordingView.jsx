import React, { useEffect, useRef, useState, useCallback } from 'react';
import xowLogo from '../../../assets/xow-logo-light.svg';
import VisitorInfoModal from '../components/VisitorInfoModal';
import { formatTimestamp, formatDuration, formatDateTime, formatDateTime12Hour } from '../utils/formatTime';
import { findChunkForTimestamp } from '../utils/videoHelper';
import { decryptEncFile, parseVisitorData } from '../utils/decryptData';
import { exportVisitorsCSV } from '../utils/exportCSV';

// ── Sidebar visitor card ────────────────────────────────────────
function VisitorCard({ visitor, importedData, active, cardRef, onClick, onInfo }) {
  const resolvedName    = importedData?.visitorName || visitor.visitorName || '';
  const resolvedCompany = importedData?.company     || visitor.company     || '';
  const hasName    = resolvedName.trim() !== '';
  const displayName = hasName ? resolvedName : `Visitor · ${visitor.barcode?.slice(0, 8) || 'Unknown'}`;
  const company    = resolvedCompany.trim() !== '' ? resolvedCompany : null;
  const initials   = hasName && resolvedName.length >= 2
    ? resolvedName.slice(0, 2).toUpperCase()
    : (visitor.barcode?.length >= 2 ? visitor.barcode.slice(0, 2).toUpperCase() : 'V?');

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
        background: active ? 'rgba(229,75,42,0.06)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Avatar */}
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: active ? '#E54B2A' : '#625f5c', //avator color
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, color: '#fff',
        transition: 'background 0.15s',
      }}>
        {initials}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: active ? 'var(--accent)' : '#000',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginBottom: 2,
        }}>
          {displayName}
        </div>
        {company && (
          <div style={{
            fontSize: 11, color: '#000',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 2,
          }}>
            {company}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#000' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          {formatTimestamp(visitor.timestamp)}
        </div>
      </div>

      {/* Info button */}
      <button
        onClick={e => { e.stopPropagation(); onInfo(visitor); }}
        title="Visitor info"
        style={{
          flexShrink: 0, background: 'transparent', border: '1px solid var(--border)',
          borderRadius: 6, padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        Info
      </button>
    </div>
  );
}

// ── Main RecordingView ──────────────────────────────────────────
export default function RecordingView({ recording, drive, onBack, visitorDataMap, onSetVisitorDataMap }) {
  // Video state
  const videoRef        = useRef(null);
  const timelineRef     = useRef(null);
  const chunkStartRef   = useRef(0);
  const globalTimeRef   = useRef(0);
  const initialLoadDone = useRef(false);
  const cardRefs        = useRef([]);

  const [resolvedChunks, setResolvedChunks] = useState([]);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume]         = useState(1);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  // UI state
  const [infoVisitor, setInfoVisitor] = useState(null);
  const [importing, setImporting]     = useState(false);
  const [toast, setToast]             = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const chunks       = recording.videoChunks || [];
  const scans        = recording.barcodeScans || [];
  const totalDuration = recording.totalDuration || 0;
  const importedCount = Object.keys(visitorDataMap || {}).length;
  const dt = formatDateTime12Hour(recording.createdAt);

  // Filter scans based on search query
  const filteredScans = scans.filter(scan => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const importedData = (visitorDataMap || {})[scan.barcode];
    const name = (importedData?.visitorName || scan.visitorName || '').toLowerCase();
    const company = (importedData?.company || scan.company || '').toLowerCase();
    return name.includes(query) || company.includes(query);
  });

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Resolve file paths
  useEffect(() => {
    async function resolve() {
      setLoading(true);
      setError('');
      initialLoadDone.current = false;
      try {
        const resolved = await Promise.all(
          chunks.map(async (c) => {
            const fullPath = await window.xowAPI.getVideoPath(drive.mountpoint, c.fileName, recording.metaDir);
            return { ...c, url: fullPath ? window.xowAPI.filePathToUrl(fullPath) : null };
          })
        );
        setResolvedChunks(resolved);
      } catch (e) {
        setError('Failed to load video: ' + e.message);
      } finally {
        setLoading(false);
      }
    }
    resolve();
  }, [recording, drive]);

  // Initial load
  useEffect(() => {
    if (resolvedChunks.length === 0 || loading || initialLoadDone.current) return;
    initialLoadDone.current = true;
    chunkStartRef.current = chunks[0]?.startTime || 0;
    setTimeout(() => loadChunk(0, 0), 100);
  }, [resolvedChunks, loading]);

  function loadChunk(idx, seekTo = 0) {
    const video = videoRef.current;
    if (!video || !resolvedChunks[idx]) return;
    const chunk = resolvedChunks[idx];
    if (!chunk.url) { setError(`Video file not found: ${chunk.fileName}`); return; }
    video.pause();
    video.src = chunk.url;
    video.load();
    video.onloadedmetadata = () => {
      if (seekTo > 0 && seekTo < video.duration) video.currentTime = seekTo;
      const p = video.play();
      if (p) p.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    };
    video.onerror = () => setError(`Failed to load: ${chunk.fileName}`);
  }

  // Playback events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onTimeUpdate() {
      const g = chunkStartRef.current + video.currentTime;
      globalTimeRef.current = g;
      setCurrentTime(g);
    }
    function onEnded() {
      const next = currentChunkIdx + 1;
      if (next < resolvedChunks.length) {
        chunkStartRef.current = chunks[next]?.startTime || 0;
        setCurrentChunkIdx(next);
        loadChunk(next, 0);
      } else {
        setIsPlaying(false);
      }
    }
    function onPlay()  { setIsPlaying(true); }
    function onPause() { setIsPlaying(false); }

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [currentChunkIdx, resolvedChunks, chunks]);

  function seekToGlobalTime(globalTime) {
    const clamped = Math.max(0, Math.min(totalDuration, globalTime));
    const { chunkIdx, offsetWithinChunk } = findChunkForTimestamp(chunks, clamped);
    if (chunkIdx !== currentChunkIdx) {
      chunkStartRef.current = chunks[chunkIdx]?.startTime || 0;
      setCurrentChunkIdx(chunkIdx);
      loadChunk(chunkIdx, offsetWithinChunk);
    } else {
      if (videoRef.current) videoRef.current.currentTime = offsetWithinChunk;
    }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const p = video.play();
      if (p) p.catch(() => {});
    } else {
      video.pause();
    }
  }

  function handleVolumeChange(e) {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
  }

  function handleTimelineClick(e) {
    if (!timelineRef.current || totalDuration === 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekToGlobalTime(ratio * totalDuration);
  }

  // Active card: the scan whose segment contains currentTime
  const activeIdx = scans.reduce((acc, scan, i) => {
    const nextTs = scans[i + 1]?.timestamp ?? totalDuration;
    return currentTime >= scan.timestamp && currentTime < nextTs ? i : acc;
  }, -1);

  // Auto-scroll sidebar to active card
  useEffect(() => {
    if (activeIdx >= 0 && cardRefs.current[activeIdx]) {
      cardRefs.current[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeIdx]);

  // Import visitor data
  async function handleImport() {
    setImporting(true);
    try {
      const result = await window.xowAPI.openEncFile();
      if (!result) { setImporting(false); return; }
      const bytes = new Uint8Array(result.data);
      const decrypted = await decryptEncFile(bytes);
      const { map, count } = parseVisitorData(decrypted, result.fileName);
      onSetVisitorDataMap(map);
      const matchCount = scans.filter(s => map[s.barcode]).length;
      if (count === 0) {
        setToast({ type: 'info', msg: 'File imported but contained no records.' });
      } else if (matchCount === 0) {
        setToast({ type: 'info', msg: `${count} records loaded · no matches for current visitors.` });
      } else {
        setToast({ type: 'success', msg: `${count} records loaded · ${matchCount} visitor${matchCount !== 1 ? 's' : ''} matched.` });
      }
    } catch (e) {
      setToast({ type: 'error', msg: `Decryption failed: ${e.message}` });
    } finally {
      setImporting(false);
    }
  }

  function handleClearData() {
    onSetVisitorDataMap({});
    setToast({ type: 'info', msg: 'Visitor data cleared.' });
  }

  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="screen">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-left">
          <img src={xowLogo} alt="XoW" className="app-logo-img header-logo-sm" />
          <div className="header-divider" />
          <button className="btn-back" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
          <div className="header-divider" />
          <div className="header-info">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              {formatDuration(recording.totalDuration)}
            </span>
            <span className="header-dot">·</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
              {scans.length} visitors
            </span>
            <span className="header-dot">·</span>
            <span style={{ color: 'var(--text-muted)' }}>{dt.date} <span className="header-dot">·</span> {dt.time}</span>
          </div>
        </div>
        <div className="header-right">
          {importedCount > 0 && (
            <div className="import-status-badge">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 12h6M9 16h6M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
              </svg>
              {importedCount} records loaded
              <button className="import-clear-btn" onClick={handleClearData} title="Clear">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
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
                  <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Import Visitor Data
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Body: video left + cards right ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left — video player */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0a0a0a', minWidth: 0 }}>

          {/* Video area */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', minHeight: 0 }}>
            {loading && (
              <div className="video-loading">
                <div className="spinner large" />
                <p>Loading video...</p>
              </div>
            )}
            {error && (
              <div className="video-error">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E54B2A" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p style={{ color: '#888', marginTop: 8 }}>{error}</p>
              </div>
            )}
            {!loading && !error && (
              <video
                ref={videoRef}
                className="main-video"
                playsInline
                onClick={togglePlay}
              />
            )}
          </div>

          {/* Controls */}
          {!loading && !error && (
            <div className="video-controls">
              {/* Timeline */}
              <div className="timeline-container">
                <div className="timeline-track" ref={timelineRef} onClick={handleTimelineClick}>
                  <div className="timeline-fill" style={{ width: `${progress}%` }} />
                  <div className="timeline-thumb" style={{ left: `${progress}%` }} />
                  {/* Visitor markers */}
                  {scans.map((scan, i) => {
                    const pct = totalDuration > 0 ? (scan.timestamp / totalDuration) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="timeline-marker"
                        style={{ left: `${pct}%` }}
                        onClick={e => { e.stopPropagation(); seekToGlobalTime(scan.timestamp); }}
                        title={`Visitor at ${formatTimestamp(scan.timestamp)}`}
                      >
                        <div className="marker-dot" />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Control bar */}
              <div className="control-bar">
                <button className="ctrl-btn play-pause" onClick={togglePlay}>
                  {isPlaying ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </button>

                <span className="time-display">
                  {formatTimestamp(currentTime)} / {formatTimestamp(totalDuration)}
                </span>

                <div className="volume-group">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    {volume > 0   && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
                    {volume > 0.5 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
                  </svg>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={volume} onChange={handleVolumeChange}
                    className="volume-slider"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right — visitor cards sidebar */}
        <div style={{
          width: 300,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid var(--border)',
          background: 'var(--surface)',
          overflow: 'hidden',
        }}>
          {/* Sidebar header */}
          <div style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
            flexShrink: 0,
          }}>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Visitors
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>
                {scans.length} recorded · click to jump
              </div>
            </div>
            {/* Search box */}
            <div style={{ padding: '0 14px 12px 14px' }}>
              <div style={{ position: 'relative' }}>
                <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-sub)" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  placeholder="Search by name or company..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '7px 10px 7px 32px',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    outline: 'none',
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                />
              </div>
            </div>
          </div>

          {/* Card list */}
          <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>
            {scans.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-sub)', fontSize: 13 }}>
                No visitor scans in this recording.
              </div>
            ) : filteredScans.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-sub)', fontSize: 13 }}>
                No visitors found matching "{searchQuery}"
              </div>
            ) : (
              filteredScans.map((scan, idx) => {
                const originalIdx = scans.indexOf(scan);
                return (
                  <VisitorCard
                    key={scan.barcode + originalIdx}
                    visitor={scan}
                    importedData={(visitorDataMap || {})[scan.barcode] || null}
                    active={activeIdx === originalIdx}
                    cardRef={el => { cardRefs.current[originalIdx] = el; }}
                    onClick={() => seekToGlobalTime(scan.timestamp)}
                    onInfo={v => setInfoVisitor(v)}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Toast ── */}
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

      {/* ── Visitor Info Modal ── */}
      {infoVisitor && (
        <VisitorInfoModal
          visitor={infoVisitor}
          importedData={(visitorDataMap || {})[infoVisitor.barcode] || null}
          recording={recording}
          isOpen={!!infoVisitor}
          onClose={() => setInfoVisitor(null)}
          onPlay={ts => {
            setInfoVisitor(null);
            seekToGlobalTime(ts);
          }}
        />
      )}
    </div>
  );
}
