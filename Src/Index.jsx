import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// IMPORTANT: This file provides the necessary entry point for React to mount the App component
// Netlify needs this structure to successfully boot the app and render the output into public/index.html

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} else {
    console.error("Could not find root element to mount the app.");
}

