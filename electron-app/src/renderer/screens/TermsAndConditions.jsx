import React, { useState } from 'react';
import xowLogo from '../../../assets/xow-logo-light.svg';

const CARD_WIDTH  = 640;
const CARD_HEIGHT = 480;
const BODY_HEIGHT = 360;

const STEPS = [
  {
    title: 'Welcome to XoW Play',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
          XoW Play is an offline desktop application developed by <strong>Cyboglabs</strong> for
          viewing visitor badges and playing back video recordings captured by the XoW Recorder
          system.
        </p>
        <div style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
        }}>
          {[
            'Fully offline — no data ever leaves your device',
            'View visitor badges and recording metadata',
            'Play back encrypted visitor video recordings',
            'Import recordings from removable drives',
          ].map((text) => (
            <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>—</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.6 }}>
          Please read and accept the Terms and Conditions on the following pages before using this
          application.
        </p>
      </div>
    ),
  },
  {
    title: 'License & Authorized Use',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Section heading="License">
          XoW Play is licensed for use solely by authorized personnel of the organization that
          deployed it. Redistribution, reverse engineering, or modification of the application
          without explicit written permission from Cyboglabs is prohibited.
        </Section>
        <Section heading="Authorized Use Only">
          You must only access visitor recordings and badge data that you are legally permitted to
          view under applicable laws and your organization's policies. Unauthorized access to or
          sharing of visitor data is strictly prohibited and may constitute a criminal offence.
        </Section>
        <Section heading="Offline Operation">
          XoW Play operates entirely offline. No visitor data, recordings, or personal information
          is transmitted to any external server or third party. All data remains on your local
          device or connected removable storage.
        </Section>
      </div>
    ),
  },
  {
    title: 'Data Privacy & Security',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Section heading="Visitor Data Privacy">
          The application processes sensitive personal data including visitor names, contact details,
          and video/audio recordings. You are responsible for handling this data in compliance with
          all applicable data protection laws or other relevant legislation.
        </Section>
        <Section heading="Data Security">
          You are responsible for the physical and logical security of the device on which XoW Play
          is installed. Restrict access to authorized personnel only. Cyboglabs accepts no liability
          for unauthorized access resulting from inadequate device security.
        </Section>
        <Section heading="Data Retention">
          You are solely responsible for managing the retention and deletion of visitor recordings.
          Ensure recordings are retained only as long as required and are securely deleted thereafter
          in line with your organization's policies and applicable law.
        </Section>
      </div>
    ),
  },
  {
    title: 'Disclaimer & Liability',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Section heading="Disclaimer of Warranties">
          XoW Play is provided "as is" without warranty of any kind, express or implied, including
          but not limited to warranties of merchantability, fitness for a particular purpose, or
          non-infringement. Cyboglabs does not warrant that the application will be error-free or
          uninterrupted.
        </Section>
        <Section heading="Limitation of Liability">
          To the fullest extent permitted by law, Cyboglabs shall not be liable for any indirect,
          incidental, special, or consequential damages arising from your use of XoW Play or any
          data accessed through it.
        </Section>
        <Section heading="Changes to Terms">
          Cyboglabs reserves the right to update these Terms. An updated version will be presented
          upon the next application launch following a significant update. Contact:{' '}
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>business@cyboglabs.com</span>
        </Section>
      </div>
    ),
  },
  {
    title: 'Confirm & Agree',
    isLast: true,
    content: null,
  },
];

function Section({ heading, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--text)',
        textTransform: 'uppercase',
        letterSpacing: '0.6px',
        marginBottom: 5,
      }}>
        {heading}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>{children}</p>
    </div>
  );
}

export default function TermsAndConditions({ onAccepted }) {
  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [declining, setDeclining] = useState(false);

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  async function handleConfirm() {
    if (!agreed) return;
    await window.xowAPI.acceptTerms();
    onAccepted();
  }

  async function handleDecline() {
    setDeclining(true);
    await window.xowAPI.declineTerms();
  }

  return (
    <div className="modal-overlay">
      <div style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        maxWidth: 'calc(100vw - 40px)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={xowLogo} alt="XoW" style={{ height: 20 }} />
            <span style={{ color: 'var(--border)', fontSize: 14 }}>|</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{current.title}</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-sub)', fontWeight: 500 }}>
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--surface-2)', flexShrink: 0 }}>
          <div style={{
            height: '100%',
            width: `${((step + 1) / STEPS.length) * 100}%`,
            background: 'var(--accent)',
            transition: 'width 0.25s ease',
          }} />
        </div>

        {/* Body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--border) transparent',
        }}>
          {isLast ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px 16px',
                fontSize: 13,
                color: 'var(--text-muted)',
                lineHeight: 1.7,
              }}>
                By accepting, you confirm that you have read and understood the XoW Play Terms and
                Conditions, including your responsibilities regarding authorized use, visitor data
                privacy, and data security.
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  style={{ marginTop: 2, width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, userSelect: 'none' }}>
                  I have read and agree to the <strong>Terms and Conditions</strong>. I confirm that
                  I am an authorized user and will handle all visitor data in accordance with
                  applicable laws and my organization's policies.
                </span>
              </label>

              <p style={{ fontSize: 11, color: 'var(--text-sub)' }}>
                Last updated: April 2026 · Cyboglabs · business@cyboglabs.com
              </p>
            </div>
          ) : (
            current.content
          )}
        </div>

        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, padding: '10px 0', flexShrink: 0 }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background: i === step ? 'var(--accent)' : i < step ? 'var(--border-light)' : 'var(--border)',
                transition: 'all 0.2s ease',
              }}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
          flexShrink: 0,
        }}>
          <button
            className="btn-secondary"
            onClick={handleDecline}
            disabled={declining}
          >
            {declining ? 'Closing...' : 'Decline'}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button className="btn-secondary" onClick={() => setStep(s => s - 1)}>
                Back
              </button>
            )}
            {isLast ? (
              <button
                className="btn-primary"
                onClick={handleConfirm}
                disabled={!agreed}
                style={{ opacity: agreed ? 1 : 0.4, cursor: agreed ? 'pointer' : 'not-allowed' }}
              >
                Confirm & Agree
              </button>
            ) : (
              <button className="btn-primary" onClick={() => setStep(s => s + 1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
