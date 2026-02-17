import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search, Library, User } from 'lucide-react';
import './BottomNav.css';

export const BottomNav: React.FC = () => {
  const location = useLocation();
  
  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="bottom-nav">
      <Link to="/" className={`nav-item ${isActive('/') ? 'active' : ''}`}>
        <Home size={24} />
        <span>Home</span>
      </Link>
      <Link to="/search" className={`nav-item ${isActive('/search') ? 'active' : ''}`}>
        <Search size={24} />
        <span>Search</span>
      </Link>
      <Link to="/library" className={`nav-item ${isActive('/library') ? 'active' : ''}`}>
        <Library size={24} />
        <span>Library</span>
      </Link>
      <Link to="/profile" className={`nav-item ${isActive('/profile') ? 'active' : ''}`}>
        <User size={24} />
        <span>Profile</span>
      </Link>
    </nav>
  );
};

