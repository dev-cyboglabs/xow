import React, { useState, useEffect } from 'react';
import RecordingList from './screens/RecordingList';
import RecordingView from './screens/RecordingView';
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
  const [visitorDataMap, setVisitorDataMap] = useState({});

  const goToRecordings = () => {
    setSelectedRecording(null);
    setScreen('recordings');
  };

  const goToRecording = (recording, drive) => {
    setSelectedRecording(recording);
    if (drive) setSelectedDrive(drive);
    setScreen('recording');
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
    </div>
  );
}
