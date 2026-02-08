import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Error boundary to prevent blank screens
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App crash:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return React.createElement('div', {
        style: { background: '#0a0a0b', color: '#e8e6e1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', padding: 20, textAlign: 'center' }
      },
        React.createElement('div', null,
          React.createElement('h1', { style: { fontSize: 24, marginBottom: 12 } }, 'Something went wrong'),
          React.createElement('p', { style: { color: '#737373', marginBottom: 16 } }, String(this.state.error)),
          React.createElement('button', {
            onClick: () => { localStorage.clear(); window.location.reload(); },
            style: { background: '#10b981', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontSize: 14, cursor: 'pointer' }
          }, 'Clear cache & reload')
        )
      );
    }
    return this.props.children;
  }
}

// Unregister any old service workers that might cache stale content
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for (var registration of registrations) {
      registration.unregister();
    }
  });
}

createRoot(document.getElementById('root')).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
);
