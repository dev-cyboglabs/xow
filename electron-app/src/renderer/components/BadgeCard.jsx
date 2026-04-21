import React from 'react';
import { formatTimestamp } from '../utils/formatTime';

export default function BadgeCard({ visitor, importedData, onPlay, onInfo }) {
  // Merge imported data (takes priority) with scan data
  const resolvedName    = importedData?.visitorName || visitor.visitorName || '';
  const resolvedCompany = importedData?.company     || visitor.company     || '';
  const isEnriched = !!importedData;

  const hasName = resolvedName.trim() !== '';
  const displayName = hasName ? resolvedName : `Visitor ID: ${visitor.barcode || 'Unknown'}`;
  const company = resolvedCompany.trim() !== '' ? resolvedCompany : 'No Company Info';
  const initials = hasName && resolvedName.length >= 2
    ? resolvedName.slice(0, 2).toUpperCase()
    : (visitor.barcode && visitor.barcode.length >= 2 ? visitor.barcode.slice(0, 2).toUpperCase() : '??');

  return (
    <div className={`badge-card${isEnriched ? ' badge-card--enriched' : ''}`}>
      {/* Verified dot shown when imported data matched */}
      {isEnriched && (
        <div className="badge-verified" title="Visitor data matched from imported file">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}

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
        Enter: {formatTimestamp(visitor.timestamp)}
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
