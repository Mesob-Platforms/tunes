import React, { useState, useCallback, useEffect } from 'react';
import { SearchIcon, Loader2 } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { api } from '../services/api';
import { Song, Artist, Album, Playlist } from '../types';
import './Search.css';

const Search: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{
    tracks: Song[];
    artists: Artist[];
    albums: Album[];
    playlists: Playlist[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { playSong } = usePlayer();

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults(null);
      return;
    }

    setIsLoading(true);
    try {
      const searchResults = await api.search(searchQuery);
      setResults(searchResults);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (query.length > 2) {
        performSearch(query);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [query, performSearch]);

  return (
    <div className="search-view">
      <div className="search-header">
        <div className="search-input-container">
          <SearchIcon size={20} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search for tracks, artists, albums..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {isLoading && <Loader2 size={20} className="loading-icon spin" />}
        </div>
      </div>

      {results && (
        <div className="search-results">
          {results.tracks.length > 0 && (
            <section className="results-section">
              <h2>Tracks</h2>
              <div className="tracks-list">
                {results.tracks.map((track) => (
                  <div
                    key={track.id}
                    className="track-item"
                    onClick={() => playSong(track)}
                  >
                    <img
                      src={track.coverUrl}
                      alt={track.title}
                      className="track-thumbnail"
                    />
                    <div className="track-item-info">
                      <div className="track-name">{track.title}</div>
                      <div className="track-artist-name">{track.artist}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.artists.length > 0 && (
            <section className="results-section">
              <h2>Artists</h2>
              <div className="artists-grid">
                {results.artists.map((artist) => (
                  <div key={artist.id} className="artist-card">
                    {artist.picture ? (
                      <img
                        src={artist.picture}
                        alt={artist.name}
                        className="artist-picture"
                      />
                    ) : (
                      <div className="artist-picture-placeholder">
                        {artist.name.charAt(0)}
                      </div>
                    )}
                    <div className="artist-name">{artist.name}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.albums.length > 0 && (
            <section className="results-section">
              <h2>Albums</h2>
              <div className="albums-grid">
                {results.albums.map((album) => (
                  <div key={album.id} className="album-card">
                    {album.cover ? (
                      <img
                        src={album.cover}
                        alt={album.title}
                        className="album-cover"
                      />
                    ) : (
                      <div className="album-cover-placeholder">
                        {album.title.charAt(0)}
                      </div>
                    )}
                    <div className="album-info">
                      <div className="album-title">{album.title}</div>
                      <div className="album-artist">{album.artistName}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.playlists.length > 0 && (
            <section className="results-section">
              <h2>Playlists</h2>
              <div className="playlists-grid">
                {results.playlists.map((playlist) => (
                  <div key={playlist.id} className="playlist-card">
                    {playlist.image ? (
                      <img
                        src={playlist.image}
                        alt={playlist.title}
                        className="playlist-image"
                      />
                    ) : (
                      <div className="playlist-image-placeholder">
                        {playlist.title.charAt(0)}
                      </div>
                    )}
                    <div className="playlist-title">{playlist.title}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.tracks.length === 0 &&
            results.artists.length === 0 &&
            results.albums.length === 0 &&
            results.playlists.length === 0 && (
              <div className="no-results">
                <p>No results found for "{query}"</p>
              </div>
            )}
        </div>
      )}

      {!results && !isLoading && (
        <div className="search-placeholder">
          <SearchIcon size={64} className="placeholder-icon" />
          <p>Search for your favorite music</p>
        </div>
      )}
    </div>
  );
};

export default Search;

