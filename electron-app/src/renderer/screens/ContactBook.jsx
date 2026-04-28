import React, { useState, useMemo } from 'react';
import xowLogo from '../../../assets/xow-logo-light.svg';

export default function ContactBook({ recording, visitorDataMap, onBack }) {
  const [searchQuery, setSearchQuery] = useState('');

  // Get only visitors who actually scanned (have timestamps in the recording)
  const scannedBarcodes = useMemo(() => {
    const barcodes = new Set();
    if (recording?.barcodeScans) {
      recording.barcodeScans.forEach(scan => {
        if (scan.barcode) barcodes.add(scan.barcode);
      });
    }
    return barcodes;
  }, [recording]);

  // Filter to only show contacts that match scanned visitors
  const contacts = useMemo(() => {
    if (!visitorDataMap) return [];
    
    const contactList = [];
    Object.entries(visitorDataMap).forEach(([barcode, data]) => {
      // Only include if this barcode was scanned in the recording
      if (scannedBarcodes.has(barcode)) {
        contactList.push({
          barcode,
          name: data.visitorName || '',
          company: data.company || '',
          phone: data.phone || '',
          email: data.email || '',
        });
      }
    });
    
    return contactList;
  }, [visitorDataMap, scannedBarcodes]);

  // Filter contacts based on search query
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    
    const query = searchQuery.toLowerCase();
    return contacts.filter(contact => 
      contact.name.toLowerCase().includes(query) ||
      contact.company.toLowerCase().includes(query) ||
      contact.phone.toLowerCase().includes(query) ||
      contact.email.toLowerCase().includes(query)
    );
  }, [contacts, searchQuery]);

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
            Back
          </button>
          <div className="header-divider" />
          <div className="header-info">
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
              Contact Book
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-sub)', marginLeft: '8px' }}>
              {contacts.length} visitor{contacts.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content" style={{ padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          {/* Header with Title and Search */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: '24px',
            gap: '20px'
          }}>
            {/* Left: Title */}
            <div>
              <h1 style={{ 
                fontSize: '24px', 
                fontWeight: 700, 
                color: 'var(--text)',
                margin: 0 
              }}>
                Visitor Contacts
              </h1>
              <p style={{ 
                fontSize: '13px', 
                color: 'var(--text-sub)', 
                marginTop: '4px' 
              }}>
                {contacts.length} contact{contacts.length !== 1 ? 's' : ''} from this recording
              </p>
            </div>

            {/* Right: Search Box */}
            <div style={{ position: 'relative', width: '350px' }}>
              <svg 
                style={{ 
                  position: 'absolute', 
                  left: '14px', 
                  top: '50%', 
                  transform: 'translateY(-50%)', 
                  pointerEvents: 'none' 
                }} 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="var(--text-sub)" 
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px 10px 40px',
                  fontSize: '13px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  outline: 'none',
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
          </div>

        {/* Contact List */}
        {contacts.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '60px 20px', 
            color: 'var(--text-sub)' 
          }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" style={{ margin: '0 auto 16px' }}>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>No Contact Data</p>
            <p style={{ fontSize: '13px' }}>Import visitor data to see contact information</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '60px 20px', 
            color: 'var(--text-sub)' 
          }}>
            <p style={{ fontSize: '14px' }}>No contacts found matching "{searchQuery}"</p>
          </div>
        ) : (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '16px'
          }}>
            {filteredContacts.map((contact, idx) => (
              <ContactCard key={contact.barcode + idx} contact={contact} />
            ))}
          </div>
        )}
        </div>
      </main>
    </div>
  );
}

// Contact Card Component
function ContactCard({ contact }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '16px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '16px',
    }}>
      {/* Avatar */}
      <div style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: '#E54B2A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
      }}>
        {contact.name.length >= 2 ? contact.name.slice(0, 2).toUpperCase() : 'V?'}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ 
          fontSize: '15px', 
          fontWeight: 600, 
          color: '#000',
          marginBottom: '4px',
        }}>
          {contact.name || 'Unknown Visitor'}
        </div>
        
        {contact.company && (
          <div style={{ 
            fontSize: '13px', 
            color: '#000',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            {contact.company}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px', color: 'var(--text-sub)' }}>
          {contact.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>{contact.phone}</span>
            </div>
          )}
          
          {contact.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span>{contact.email}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
