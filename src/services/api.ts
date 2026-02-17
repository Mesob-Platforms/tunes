import { Song, Artist, Album, Playlist, Quality } from '../types';

const API_BASE_URL = '/api';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class APICache {
  private cache: Map<string, CacheEntry<unknown>>;
  
  constructor() {
    this.cache = new Map();
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new APICache();

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchWithRetry(url: string): Promise<any> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      
      if (response.status === 429) {
        console.warn(`Rate limit hit, retrying in ${attempt * 500}ms...`);
        await delay(attempt * 500);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${attempt} failed for ${url}:`, error);
      if (attempt < maxRetries) {
        await delay(attempt * 200);
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

function getImageUrl(id: string, size: number = 320): string {
  if (!id) return '';
  if (id.startsWith('http')) return id;
  const formattedId = id.replace(/-/g, '/');
  return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
}

function extractStreamUrlFromManifest(manifest: string): string | null {
  try {
    const decoded = atob(manifest);
    
    // Check for DASH manifest (XML)
    if (decoded.includes('<MPD')) {
      // DASH streams - create a blob URL
      const blob = new Blob([decoded], { type: 'application/dash+xml' });
      return URL.createObjectURL(blob);
    }
    
    // Try JSON format
    try {
      const parsed = JSON.parse(decoded);
      if (parsed?.urls?.[0]) {
        return parsed.urls[0];
      }
    } catch {
      // Not JSON
    }
    
    // Try to extract URL from decoded string
    const urlMatch = decoded.match(/https?:\/\/[\w\-.~:?#[@!$&'()*+,;=%/]+/);
    return urlMatch ? urlMatch[0] : null;
  } catch (error) {
    console.error('Failed to decode manifest:', error);
    return null;
  }
}

// Recursively finds a section with 'items' array (monochrome's normalizeSearchResponse approach)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findSearchSection(source: any, key: string, visited: Set<any>): any {
  if (!source || typeof source !== 'object') return null;
  if (Array.isArray(source)) {
    for (const e of source) {
      const f = findSearchSection(e, key, visited);
      if (f) return f;
    }
    return null;
  }
  if (visited.has(source)) return null;
  visited.add(source);
  if ('items' in source && Array.isArray(source.items)) return source;
  if (key in source) {
    const f = findSearchSection(source[key], key, visited);
    if (f) return f;
  }
  for (const v of Object.values(source)) {
    const f = findSearchSection(v, key, visited);
    if (f) return f;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractItems(data: any, key: string): any[] {
  const section = findSearchSection(data, key, new Set());
  return section?.items || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSong(item: any): Song {
  const artist = item.artist?.name || (item.artists?.[0]?.name) || 'Unknown Artist';
  return {
    id: item.id?.toString() || '',
    title: item.version ? `${item.title} (${item.version})` : (item.title || 'Unknown Title'),
    artist,
    coverUrl: item.album?.cover ? getImageUrl(item.album.cover) : '',
    duration: item.duration || 0,
    genre: 'Unknown',
    album: item.album ? {
      id: item.album.id?.toString(),
      title: item.album.title,
      cover: item.album.cover,
    } : undefined,
    explicit: item.explicit || false,
    audioQuality: item.audioQuality,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toArtist(item: any): Artist {
  return {
    id: item.id?.toString() || '',
    name: item.name || 'Unknown Artist',
    picture: item.picture ? getImageUrl(item.picture, 320) : null,
    popularity: item.popularity || 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAlbum(item: any): Album {
  return {
    id: item.id?.toString() || '',
    title: item.title || 'Unknown Album',
    cover: item.cover ? getImageUrl(item.cover) : null,
    artistName: item.artist?.name || item.artists?.[0]?.name || 'Unknown Artist',
    artist: item.artist ? {
      id: item.artist.id?.toString() || '',
      name: item.artist.name || 'Unknown Artist',
    } : undefined,
    releaseDate: item.releaseDate,
    numberOfTracks: item.numberOfTracks,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlaylist(item: any): Playlist {
  return {
    id: item.uuid || item.id?.toString() || '',
    title: item.title || 'Unknown Playlist',
    image: item.image ? getImageUrl(item.image) : (item.squareImage ? getImageUrl(item.squareImage) : null),
    numberOfTracks: item.numberOfTracks,
  };
}

export const api = {
  getTrack: async (id: string, quality: Quality = 'LOW'): Promise<Song | null> => {
    const cacheKey = `track_${id}_${quality}`;
    const cached = cache.get<Song>(cacheKey);
    if (cached) return cached;

    try {
      const data = await fetchWithRetry(`${API_BASE_URL}/track/?id=${id}&quality=${quality}`);
      
      // Handle various response formats (monochrome's normalizeTrackResponse approach)
      const raw = data.data ?? data;
      let trackData, infoData;

      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (!trackData && entry && 'duration' in entry) trackData = entry;
          if (!infoData && entry && 'manifest' in entry) infoData = entry;
        }
      } else {
        trackData = raw;
        infoData = raw;
      }

      if (!infoData?.manifest) {
        console.error('No manifest found in track response');
        return null;
      }

      const audioUrl = extractStreamUrlFromManifest(infoData.manifest);
      if (!audioUrl) {
        console.error('Could not extract audio URL from manifest');
        return null;
      }

      const song: Song = {
        id: (trackData?.trackId || trackData?.id || id).toString(),
        title: trackData?.version ? `${trackData.title} (${trackData.version})` : (trackData?.title || 'Unknown Title'),
        artist: trackData?.artist?.name || trackData?.artists?.[0]?.name || 'Unknown Artist',
        coverUrl: trackData?.album?.cover ? getImageUrl(trackData.album.cover) : '',
        duration: trackData?.duration || 0,
        genre: 'Unknown',
        audioUrl,
        album: trackData?.album ? {
          id: trackData.album.id?.toString(),
          title: trackData.album.title,
          cover: trackData.album.cover,
        } : undefined,
        explicit: trackData?.explicit || false,
        audioQuality: quality,
      };

      cache.set(cacheKey, song);
      return song;
    } catch (error) {
      console.error(`Error fetching track ${id}:`, error);
      return null;
    }
  },

  // Search - uses monochrome's separate endpoints for each type, run in parallel
  search: async (query: string): Promise<{ tracks: Song[]; artists: Artist[]; albums: Album[]; playlists: Playlist[] }> => {
    const cacheKey = `search_${query}`;
    const cached = cache.get<{ tracks: Song[]; artists: Artist[]; albums: Album[]; playlists: Playlist[] }>(cacheKey);
    if (cached) return cached;

    const encodedQuery = encodeURIComponent(query);

    try {
      // Parallel search like monochrome (separate endpoints per type)
      const [tracksData, artistsData, albumsData, playlistsData] = await Promise.allSettled([
        fetchWithRetry(`${API_BASE_URL}/search/?s=${encodedQuery}`),
        fetchWithRetry(`${API_BASE_URL}/search/?a=${encodedQuery}`),
        fetchWithRetry(`${API_BASE_URL}/search/?al=${encodedQuery}`),
        fetchWithRetry(`${API_BASE_URL}/search/?p=${encodedQuery}`),
      ]);

      const tracks = tracksData.status === 'fulfilled'
        ? extractItems(tracksData.value, 'tracks').map(toSong)
        : [];

      const artists = artistsData.status === 'fulfilled'
        ? extractItems(artistsData.value, 'artists').map(toArtist)
        : [];

      const albums = albumsData.status === 'fulfilled'
        ? extractItems(albumsData.value, 'albums').map(toAlbum)
        : [];

      const playlists = playlistsData.status === 'fulfilled'
        ? extractItems(playlistsData.value, 'playlists').map(toPlaylist)
        : [];

      const result = { tracks, artists, albums, playlists };
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Error searching for "${query}":`, error);
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }
  },

  // Get album details with tracks
  getAlbum: async (id: string): Promise<{ album: Album; tracks: Song[] } | null> => {
    const cacheKey = `album_${id}`;
    const cached = cache.get<{ album: Album; tracks: Song[] }>(cacheKey);
    if (cached) return cached;

    try {
      const jsonData = await fetchWithRetry(`${API_BASE_URL}/album/?id=${id}`);
      const data = jsonData.data || jsonData;

      let albumObj = null;
      let tracksSection = null;

      if (data && typeof data === 'object' && !Array.isArray(data)) {
        if ('numberOfTracks' in data || 'title' in data) {
          albumObj = data;
        }
        if ('items' in data) {
          tracksSection = data;
        }
      }

      if (!albumObj) return null;

      const album = toAlbum(albumObj);
      const tracks = (tracksSection?.items || []).map((i: { item?: unknown }) => toSong(i.item || i));

      const result = { album, tracks };
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Error fetching album ${id}:`, error);
      return null;
    }
  },

  // Get artist details
  getArtist: async (id: string): Promise<Artist | null> => {
    const cacheKey = `artist_${id}`;
    const cached = cache.get<Artist>(cacheKey);
    if (cached) return cached;

    try {
      const jsonData = await fetchWithRetry(`${API_BASE_URL}/artist/?id=${id}`);
      const data = jsonData.data || jsonData;
      const rawArtist = data.artist || (Array.isArray(data) ? data[0] : data);

      if (!rawArtist) return null;

      const artist = toArtist(rawArtist);
      cache.set(cacheKey, artist);
      return artist;
    } catch (error) {
      console.error(`Error fetching artist ${id}:`, error);
      return null;
    }
  },

  getCoverUrl: (id: string, size: number = 320): string => {
    return getImageUrl(id, size);
  },

  clearCache: () => {
    cache.clear();
  },
};
