import React, { useState } from 'react';
import RecordingList from './screens/RecordingList';
import BadgeGrid from './screens/BadgeGrid';
import VideoPlayer from './screens/VideoPlayer';

// screens: 'recordings' | 'badges' | 'video'
export default function App() {
  const [screen, setScreen] = useState('recordings');
  const [selectedDrive, setSelectedDrive] = useState(null);
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [videoParams, setVideoParams] = useState(null); // { startTimestamp, visitor }

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
