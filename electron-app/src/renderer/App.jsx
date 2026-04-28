import React, { useState, useEffect } from 'react';
import RecordingList from './screens/RecordingList';
import RecordingView from './screens/RecordingView';
import ContactBook from './screens/ContactBook';
import TermsAndConditions from './screens/TermsAndConditions';

export default function App() {
  const [screen, setScreen] = useState('recordings');
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    window.xowAPI.checkTerms()
      .then((accepted) => {
        setTermsAccepted(!!accepted);
        setTermsChecked(true);
      })
      .catch(() => {
        setTermsAccepted(false);
        setTermsChecked(true);
      });
  }, []);

  const [selectedDrive, setSelectedDrive] = useState(null);
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [visitorDataMap, setVisitorDataMap] = useState(() => {
    // Load visitor data from localStorage on app start
    try {
      const saved = localStorage.getItem('xow_visitor_data');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error('Failed to load visitor data from localStorage:', e);
      return {};
    }
  });

  // Save visitor data to localStorage whenever it changes
  useEffect(() => {
    try {
      if (Object.keys(visitorDataMap).length > 0) {
        localStorage.setItem('xow_visitor_data', JSON.stringify(visitorDataMap));
      } else {
        localStorage.removeItem('xow_visitor_data');
      }
    } catch (e) {
      console.error('Failed to save visitor data to localStorage:', e);
    }
  }, [visitorDataMap]);

  const goToRecordings = () => {
    setSelectedRecording(null);
    setScreen('recordings');
  };

  const goToRecording = (recording, drive) => {
    setSelectedRecording(recording);
    if (drive) setSelectedDrive(drive);
    setScreen('recording');
  };

  const goToContactBook = (recording) => {
    setSelectedRecording(recording);
    setScreen('contacts');
  };

  if (!termsChecked) return null;

  if (!termsAccepted) {
    return <TermsAndConditions onAccepted={() => setTermsAccepted(true)} />;
  }

  return (
    <div className="app-root">
      {screen === 'recordings' && (
        <RecordingList
          selectedDrive={selectedDrive}
          onDriveChange={setSelectedDrive}
          onOpenRecording={(rec, drive) => goToRecording(rec, drive)}
          onOpenContactBook={goToContactBook}
          visitorDataMap={visitorDataMap}
        />
      )}
      {screen === 'recording' && selectedRecording && (
        <RecordingView
          recording={selectedRecording}
          drive={selectedDrive}
          onBack={goToRecordings}
          visitorDataMap={visitorDataMap}
          onSetVisitorDataMap={setVisitorDataMap}
        />
      )}
      {screen === 'contacts' && selectedRecording && (
        <ContactBook
          recording={selectedRecording}
          visitorDataMap={visitorDataMap}
          onBack={goToRecordings}
        />
      )}
    </div>
  );
}
