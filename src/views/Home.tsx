import React from 'react';
import { usePlayer } from '../context/PlayerContext';
import { Song } from '../types';
import './Home.css';

// Mock trending tracks
const trendingTracks: Song[] = [
  {
    id: '224745308',
    title: 'Good Life',
    artist: 'Kanye West',
    coverUrl: 'https://resources.tidal.com/images/c88d5ef3/7e19/4e07/a64d/74c4e2a1db44/320x320.jpg',
    duration: 207,
    genre: 'Hip-Hop',
  },
  {
    id: '251380836',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    coverUrl: 'https://resources.tidal.com/images/5f3ed0e6/37d0/4d28/ad27/623e9e4bc8ee/320x320.jpg',
    duration: 200,
    genre: 'Pop',
  },
];

const Home: React.FC = () => {
  const { playSong } = usePlayer();

  return (
    <div className="home">
      <header className="home-header">
        <h1>Welcome to VibeStream</h1>
        <p>Powered by monochrome's API</p>
      </header>

      <section className="section">
        <h2>Trending Now</h2>
        <div className="track-grid">
          {trendingTracks.map((track) => (
            <div
              key={track.id}
              className="track-card"
              onClick={() => playSong(track)}
            >
              <img
                src={track.coverUrl}
                alt={track.title}
                className="track-cover"
              />
              <div className="track-info-card">
                <div className="track-title">{track.title}</div>
                <div className="track-artist">{track.artist}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Features</h2>
        <div className="features">
          <div className="feature-card">
            <h3>🎵 High Quality</h3>
            <p>Stream music in LOW, HIGH, LOSSLESS, or HI_RES_LOSSLESS quality</p>
          </div>
          <div className="feature-card">
            <h3>🔍 Search</h3>
            <p>Search for tracks, albums, artists, and playlists</p>
          </div>
          <div className="feature-card">
            <h3>📱 Mobile First</h3>
            <p>Optimized for mobile devices with a beautiful UI</p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;

