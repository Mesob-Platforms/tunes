export interface Song {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  duration: number;
  genre: string;
  audioUrl?: string;
  album?: {
    id?: string;
    title?: string;
    cover?: string;
  };
  explicit?: boolean;
  audioQuality?: 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS';
}

export interface Artist {
  id: string;
  name: string;
  picture: string | null;
  popularity?: number;
}

export interface Album {
  id: string;
  title: string;
  cover: string | null;
  artistName?: string;
  artist?: {
    id: string;
    name: string;
  };
  releaseDate?: string;
  numberOfTracks?: number;
}

export interface Playlist {
  id: string;
  title: string;
  image: string | null;
  numberOfTracks?: number;
}

export interface PlayState {
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
  quality: 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS';
}

export type Quality = 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS';

