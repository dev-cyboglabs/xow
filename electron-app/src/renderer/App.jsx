import React, { useState, useEffect } from 'react';
import RecordingList from './screens/RecordingList';
import BadgeGrid from './screens/BadgeGrid';
import VideoPlayer from './screens/VideoPlayer';
import TermsAndConditions from './screens/TermsAndConditions';

// screens: 'terms' | 'recordings' | 'badges' | 'video'
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
  const [videoParams, setVideoParams] = useState(null); // { startTimestamp, visitor }
  // visitorDataMap: keyed by barcode string → { visitorName, company, email, phone }
  const [visitorDataMap, setVisitorDataMap] = useState({});

  const goToRecordings = () => {
    setSelectedRecording(null);
    setVideoParams(null);
    setScreen('recordings');
  };

  const goToBadges = (recording, drive) => {
    setSelectedRecording(recording);
    if (drive) setSelectedDrive(drive);
    setVideoParams(null);
    setScreen('badges');
  };

  const goToVideo = (params) => {
    setVideoParams(params);
    setScreen('video');
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
          onOpenRecording={(rec, drive) => goToBadges(rec, drive)}
        />
      )}
      {screen === 'badges' && selectedRecording && (
        <BadgeGrid
          recording={selectedRecording}
          drive={selectedDrive}
          onBack={goToRecordings}
          onPlay={(params) => goToVideo(params)}
          visitorDataMap={visitorDataMap}
          onSetVisitorDataMap={setVisitorDataMap}
        />
      )}
      {screen === 'video' && selectedRecording && videoParams && (
        <VideoPlayer
          recording={selectedRecording}
          drive={selectedDrive}
          startTimestamp={videoParams.startTimestamp}
          visitor={videoParams.visitor}
          onBack={() => setScreen('badges')}
        />
      )}
    </div>
  );
}
