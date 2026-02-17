import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { PlayerProvider } from './context/PlayerContext';
import Home from './views/Home';
import Search from './views/Search';
import { BottomNav } from './components/BottomNav';
import { NowPlaying } from './components/NowPlaying';
import { FullPlayer } from './components/FullPlayer';
import './App.css';

function App() {
  return (
    <Router>
      <PlayerProvider>
        <div className="app">
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/search" element={<Search />} />
            </Routes>
          </main>
          <NowPlaying />
          <BottomNav />
          <FullPlayer />
        </div>
      </PlayerProvider>
    </Router>
  );
}

export default App;

