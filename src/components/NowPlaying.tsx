import React from 'react';
import { Play, Pause, SkipForward } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import './NowPlaying.css';

export const NowPlaying: React.FC = () => {
  const { state, togglePlay, toggleExpand } = usePlayer();
  
  if (!state.currentSong) return null;

  const progress = state.currentSong.duration
    ? (state.currentTime / state.currentSong.duration) * 100
    : 0;

  return (
    <div className="now-playing" onClick={() => toggleExpand(true)}>
      <div className="progress-bar" style={{ width: `${progress}%` }} />
      <div className="now-playing-content">
        <img
          src={state.currentSong.coverUrl}
          alt={state.currentSong.title}
          className="album-art"
        />
        <div className="track-info">
          <div className="track-title">{state.currentSong.title}</div>
          <div className="track-artist">{state.currentSong.artist}</div>
        </div>
        <div className="controls">
          <button
            className="control-btn"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
          >
            {state.isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
          </button>
          <button className="control-btn" aria-label="Next track">
            <SkipForward size={24} />
          </button>
        </div>
      </div>
    </div>
  );
};

