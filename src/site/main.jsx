import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../print.css';
import './site.css';
import StationSyncSite from './StationSyncSite.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StationSyncSite />
  </StrictMode>
);
