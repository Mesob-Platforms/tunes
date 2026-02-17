import React, { useEffect } from 'react';
import { ChevronDown, Play, Pause, SkipForward, SkipBack } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import './FullPlayer.css';

export const FullPlayer: React.FC = () => {
  const { state, isExpanded, togglePlay, toggleExpand, setCurrentTime } = usePlayer();

  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isExpanded]);

  if (!isExpanded || !state.currentSong) return null;

  const progress = state.currentSong.duration
    ? (state.currentTime / state.currentSong.duration) * 100
    : 0;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!state.currentSong) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const percent = x / width;
    const newTime = percent * state.currentSong.duration;
    setCurrentTime(newTime);
  };

  return (
    <div className="full-player">
      <div className="full-player-header">
        <button
          className="close-btn"
          onClick={() => toggleExpand(false)}
          aria-label="Close player"
        >
          <ChevronDown size={28} />
        </button>
        <div className="header-title">Now Playing</div>
        <div style={{ width: 28 }} />
      </div>

      <div className="full-player-content">
        <div className="album-art-large">
          <img
            src={state.currentSong.coverUrl}
            alt={state.currentSong.title}
          />
        </div>

        <div className="track-details">
          <h1 className="song-title">{state.currentSong.title}</h1>
          <p className="song-artist">{state.currentSong.artist}</p>
        </div>

        <div className="progress-section">
          <div className="progress-track" onClick={handleSeek}>
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="time-labels">
            <span>{formatTime(state.currentTime)}</span>
            <span>{formatTime(state.currentSong.duration)}</span>
          </div>
        </div>

        <div className="player-controls">
          <button className="control-btn-large" aria-label="Previous track">
            <SkipBack size={32} fill="currentColor" />
          </button>
          <button
            className="control-btn-play"
            onClick={togglePlay}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
          >
            {state.isPlaying ? (
              <Pause size={36} fill="currentColor" />
            ) : (
              <Play size={36} fill="currentColor" />
            )}
          </button>
          <button className="control-btn-large" aria-label="Next track">
            <SkipForward size={32} fill="currentColor" />
          </button>
        </div>

        <div className="quality-badge">
          Quality: {state.quality}
        </div>
      </div>
    </div>
  );
};

