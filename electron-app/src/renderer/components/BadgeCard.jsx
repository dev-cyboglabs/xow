import React from 'react';
import { formatTimestamp } from '../utils/formatTime';

export default function BadgeCard({ visitor, onPlay, onInfo }) {
  // Show barcode as Visitor ID if name is empty
  const hasName = visitor.visitorName && visitor.visitorName.trim() !== '';
  const displayName = hasName ? visitor.visitorName : `Visitor ID: ${visitor.barcode || 'Unknown'}`;
  const company = visitor.company && visitor.company.trim() !== '' ? visitor.company : 'No Company Info';
  const initials = hasName && visitor.visitorName.length >= 2 
    ? visitor.visitorName.slice(0, 2).toUpperCase() 
    : (visitor.barcode && visitor.barcode.length >= 2 ? visitor.barcode.slice(0, 2).toUpperCase() : '??');

  return (
    <div className="badge-card">
      {/* Avatar */}
      <div className="badge-avatar">
        <span className="badge-initials">{initials}</span>
      </div>

      {/* Name or Visitor ID */}
      <div className="badge-name" title={displayName}>{displayName}</div>

      {/* Company */}
      <div className="badge-company" title={company}>{company}</div>

      {/* Timestamp */}
      <div className="badge-timestamp">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        Scanned: {formatTimestamp(visitor.timestamp)}
      </div>

      {/* Actions */}
      <div className="badge-actions">
        <button
          className="badge-btn play-btn"
          onClick={() => onPlay(visitor.timestamp)}
          title="Play video from this scan"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Play
        </button>
        <button
          className="badge-btn info-btn"
          onClick={() => onInfo(visitor)}
          title="View visitor info"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="8" strokeWidth="3" strokeLinecap="round" />
            <line x1="12" y1="12" x2="12" y2="16" />
          </svg>
          Info
        </button>
      </div>
    </div>
  );
}
