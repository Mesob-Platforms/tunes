import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Song, PlayState, Quality } from '../types';
import { api } from '../services/api';

interface PlayerContextType {
  state: PlayState;
  isExpanded: boolean;
  playSong: (song: Song) => void;
  togglePlay: () => void;
  toggleExpand: (expand?: boolean) => void;
  setCurrentTime: (time: number) => void;
  setQuality: (quality: Quality) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used within a PlayerProvider');
  return context;
};

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const [state, setState] = useState<PlayState>({
    currentSong: null,
    isPlaying: false,
    currentTime: 0,
    quality: 'LOW', // Start with LOW quality for faster loading
  });
  const [isExpanded, setIsExpanded] = useState(false);

  const playSong = useCallback(async (song: Song) => {
    // Pause and reset current audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setState(prev => ({ ...prev, currentSong: song, isPlaying: true, currentTime: 0 }));

    try {
      // Fetch the full song data with audio URL at the selected quality
      const fullSong = await api.getTrack(song.id, state.quality);
      
      if (fullSong?.audioUrl) {
        audioRef.current.src = fullSong.audioUrl;
        audioRef.current.load();
        
        try {
          await audioRef.current.play();
        } catch (e: any) {
          console.error("Error playing audio:", e);
          setState(prev => ({ ...prev, isPlaying: false }));
        }
      } else {
        console.error("No audio URL found for song:", song.title);
        setState(prev => ({ ...prev, isPlaying: false }));
      }
    } catch (error) {
      console.error("Failed to fetch audio for song:", song.title, error);
      setState(prev => ({ ...prev, isPlaying: false }));
    }
  }, [state.quality]);

  const togglePlay = useCallback(() => {
    if (state.currentSong) {
      if (state.isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(e => console.error("Error resuming audio:", e));
      }
      setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
    }
  }, [state.isPlaying, state.currentSong]);

  const toggleExpand = useCallback((expand?: boolean) => {
    setIsExpanded(expand !== undefined ? expand : !isExpanded);
  }, [isExpanded]);

  const setCurrentTime = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setState(prev => ({ ...prev, currentTime: time }));
  }, []);

  const setQuality = useCallback((quality: Quality) => {
    setState(prev => ({ ...prev, quality }));
    
    // If currently playing, reload with new quality
    if (state.currentSong && state.isPlaying) {
      const currentSong = state.currentSong;
      const currentTime = audioRef.current.currentTime;
      
      api.getTrack(currentSong.id, quality).then(fullSong => {
        if (fullSong?.audioUrl) {
          audioRef.current.src = fullSong.audioUrl;
          audioRef.current.load();
          audioRef.current.currentTime = currentTime;
          audioRef.current.play().catch(e => console.error("Error switching quality:", e));
        }
      });
    }
  }, [state.currentSong, state.isPlaying]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;

    const updateTime = () => {
      setState(prev => ({ ...prev, currentTime: audio.currentTime }));
    };

    const handleEnded = () => {
      setState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
    };

    const handleError = (e: ErrorEvent) => {
      console.error('Audio error:', e);
      setState(prev => ({ ...prev, isPlaying: false }));
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError as any);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError as any);
    };
  }, []);

  return (
    <PlayerContext.Provider value={{ state, isExpanded, playSong, togglePlay, toggleExpand, setCurrentTime, setQuality, audioRef }}>
      {children}
    </PlayerContext.Provider>
  );
};

