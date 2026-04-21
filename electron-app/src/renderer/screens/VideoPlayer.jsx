import React, { useEffect, useRef, useState, useCallback } from 'react';
import xowLogo from '../../../assets/xow-logo-light.svg';
import { formatDuration, formatTimestamp } from '../utils/formatTime';
import { findChunkForTimestamp } from '../utils/videoHelper';

export default function VideoPlayer({ recording, drive, startTimestamp, visitor, onBack }) {
  const videoRef = useRef(null);
  const [resolvedChunks, setResolvedChunks] = useState([]);
  const [resolvedAudio, setResolvedAudio] = useState(null);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);  // global timeline time
  const [volume, setVolume] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timelineRef = useRef(null);
  const globalTimeRef = useRef(0);   // tracks accumulated time across chunks
  const chunkStartOffsetRef = useRef(0); // globalTime at start of current chunk
  const initialLoadDone = useRef(false); // prevent multiple initial loads

  const chunks = recording.videoChunks || [];
  const scans = recording.barcodeScans || [];
  const totalDuration = recording.totalDuration || 0;
  const displayName = visitor
    ? (visitor.visitorName || visitor.barcode || 'Unknown Visitor')
    : 'Full Recording';

  // Calculate segment boundaries for individual visitor playback
  let segmentStart = startTimestamp;
  let segmentEnd = totalDuration;
  let segmentDuration = totalDuration;
  
  if (visitor) {
    // Find the next scan after this one to determine segment end
    const currentScanIndex = scans.findIndex(s => s.timestamp === visitor.timestamp);
    if (currentScanIndex >= 0 && currentScanIndex < scans.length - 1) {
      // End at the next scan
      segmentEnd = scans[currentScanIndex + 1].timestamp;
    }
    segmentDuration = segmentEnd - segmentStart;
  }

  // Resolve file paths via IPC
  useEffect(() => {
    async function resolve() {
      setLoading(true);
      setError('');
      try {
        const resolved = await Promise.all(
          chunks.map(async (c) => {
            const fullPath = await window.xowAPI.getVideoPath(drive.mountpoint, c.fileName, recording.metaDir);
            return {
              ...c,
              url: fullPath ? window.xowAPI.filePathToUrl(fullPath) : null,
            };
          })
        );
        setResolvedChunks(resolved);

        if (recording.audioFileName) {
          const ap = await window.xowAPI.getAudioPath(drive.mountpoint, recording.audioFileName, recording.metaDir);
          setResolvedAudio(ap ? window.xowAPI.filePathToUrl(ap) : null);
        }
      } catch (e) {
        setError('Failed to load video files: ' + e.message);
      } finally {
        setLoading(false);
      }
    }
    resolve();
  }, [recording, drive]);

  // Load initial chunk once resolved
  useEffect(() => {
    if (resolvedChunks.length === 0 || loading || initialLoadDone.current) return;

    const { chunkIdx, offsetWithinChunk } = findChunkForTimestamp(chunks, startTimestamp);
    setCurrentChunkIdx(chunkIdx);
    chunkStartOffsetRef.current = chunks[chunkIdx]?.startTime || 0;
    initialLoadDone.current = true;
    
    // Delay slightly to ensure video element is mounted
    setTimeout(() => {
      loadChunk(chunkIdx, offsetWithinChunk);
    }, 100);
  }, [resolvedChunks, loading]);

  function loadChunk(idx, seekTo = 0) {
    const video = videoRef.current;
    if (!video || !resolvedChunks[idx]) return;
    const chunk = resolvedChunks[idx];
    if (!chunk.url) {
      setError(`Video file not found: ${chunk.fileName}`);
      return;
    }
    
    // Pause current playback before changing source
    video.pause();
    
    video.src = chunk.url;
    video.load();
    video.onloadedmetadata = () => {
      if (seekTo > 0 && seekTo < video.duration) {
        video.currentTime = seekTo;
      }
      // Use a promise chain to handle play properly
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
          })
          .catch((err) => {
            console.warn('Play interrupted:', err);
            setIsPlaying(false);
          });
      }
    };
    
    video.onerror = (e) => {
      console.error('Video load error:', e);
      setError(`Failed to load video: ${chunk.fileName}`);
    };
  }

  // Track global playback time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onTimeUpdate() {
      const globalT = chunkStartOffsetRef.current + video.currentTime;
      globalTimeRef.current = globalT;
      setCurrentTime(globalT);
      
      // Stop at segment end for individual visitor playback
      if (visitor && globalT >= segmentEnd) {
        video.pause();
        setIsPlaying(false);
      }
    }

    function onEnded() {
      // Don't auto-advance to next chunk if we're in visitor segment mode
      if (visitor) {
        setIsPlaying(false);
        return;
      }
      
      const nextIdx = currentChunkIdx + 1;
      if (nextIdx < resolvedChunks.length) {
        chunkStartOffsetRef.current = chunks[nextIdx]?.startTime || 0;
        setCurrentChunkIdx(nextIdx);
        loadChunk(nextIdx, 0);
      } else {
        setIsPlaying(false);
      }
    }

    function onPlay() { setIsPlaying(true); }
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

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Play failed:', err);
        });
      }
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
    if (!timelineRef.current || segmentDuration === 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    // Calculate target time within the segment
    const targetTime = segmentStart + (ratio * segmentDuration);
    seekToGlobalTime(targetTime);
  }

  function seekToGlobalTime(globalTime) {
    // Clamp to segment bounds
    const clampedTime = Math.max(segmentStart, Math.min(segmentEnd, globalTime));
    
    const { chunkIdx, offsetWithinChunk } = findChunkForTimestamp(chunks, clampedTime);
    if (chunkIdx !== currentChunkIdx) {
      chunkStartOffsetRef.current = chunks[chunkIdx]?.startTime || 0;
      setCurrentChunkIdx(chunkIdx);
      loadChunk(chunkIdx, offsetWithinChunk);
    } else {
      if (videoRef.current) videoRef.current.currentTime = offsetWithinChunk;
    }
  }

  function jumpToScan(scan) {
    seekToGlobalTime(scan.timestamp);
  }

  // Calculate progress within the current segment
  const progress = segmentDuration > 0 
    ? ((currentTime - segmentStart) / segmentDuration) * 100 
    : 0;

  return (
    <div className="screen video-screen">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <img src={xowLogo} alt="XoW" className="app-logo-img header-logo-sm" />
          <div className="header-divider" />
          <button className="btn-back" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Badges
          </button>
          <div className="header-divider" />
          <div className="header-info">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#E54B2A' }}>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>Now Playing: <strong>{displayName}</strong></span>
            {/* No timestamp display - clean interface */}
          </div>
        </div>
        <div className="header-right">
          {/* No offline badge */}
        </div>
      </header>

      {/* Video Area */}
      <main className="video-main">
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
            <p>{error}</p>
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
      </main>

      {/* Controls */}
      {!loading && !error && (
        <div className="video-controls">
          {/* Timeline */}
          <div className="timeline-container">
            <div
              className="timeline-track"
              ref={timelineRef}
              onClick={handleTimelineClick}
            >
              <div className="timeline-fill" style={{ width: `${progress}%` }} />
              <div className="timeline-thumb" style={{ left: `${progress}%` }} />
              {/* Clean timeline - no visitor markers */}
            </div>
          </div>

          {/* Control Bar */}
          <div className="control-bar">
            <button className="ctrl-btn play-pause" onClick={togglePlay}>
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>

            <span className="time-display">
              {visitor 
                ? `${formatTimestamp(currentTime - segmentStart)} / ${formatTimestamp(segmentDuration)}`
                : `${formatTimestamp(currentTime)} / ${formatTimestamp(totalDuration)}`
              }
            </span>

            <div className="volume-group">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {volume > 0 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
                {volume > 0.5 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
              </svg>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={handleVolumeChange}
                className="volume-slider"
              />
            </div>

            {/* No scan jump buttons - clean interface */}
          </div>
        </div>
      )}
    </div>
  );
}
