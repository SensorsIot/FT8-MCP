import { useEffect, useState } from 'react';
import { Settings } from './components/Settings';
import { SlicePanel } from './components/SlicePanel';
import type { SliceState, DashboardConfig, WebSocketMessage } from './types';

type Page = 'dashboard' | 'settings';

// Default dashboard config (used until server sends config)
const DEFAULT_CONFIG: DashboardConfig = {
  stationLifetimeSeconds: 120,
  colors: {
    worked: '#6b7280',
    normal: '#3b82f6',
    weak: '#eab308',
    strong: '#22c55e',
    priority: '#f97316',
    new_dxcc: '#ec4899',
  },
};

// Determine API base URL - use current host for production, localhost for dev
const getApiBase = () => {
  if (window.location.port === '5173' || window.location.port === '5174') {
    // Development mode - Vite dev server
    return `http://${window.location.hostname}:3001`;
  }
  // Production mode - served from the same server
  return '';
};

const API_BASE = getApiBase();
const WS_URL = `ws://${window.location.hostname}:3001`;

function App() {
  const [slices, setSlices] = useState<SliceState[]>([]);
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig>(DEFAULT_CONFIG);
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<Page>('dashboard');

  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnected(true);
      console.log('Connected to MCP Server');
    };

    ws.onmessage = (event) => {
      const data: WebSocketMessage = JSON.parse(event.data);
      console.log('Received:', data.type);

      if (data.type === 'STATIONS_UPDATE') {
        setSlices(data.slices);
        setDashboardConfig(data.config);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('Disconnected from MCP Server');
    };

    return () => ws.close();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">
                📡 WSJT-X Mission Control
              </h1>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-gray-300">
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
            <nav className="flex gap-2">
              <button
                onClick={() => setPage('dashboard')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  page === 'dashboard'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setPage('settings')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  page === 'settings'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                ⚙️ Settings
              </button>
            </nav>
          </div>
        </header>

        {page === 'dashboard' && (
          <div className="space-y-6">
            {/* Summary stats */}
            {slices.length > 0 && (
              <div className="flex gap-4 text-sm text-gray-400">
                <span>
                  <span className="text-blue-400 font-semibold">{slices.length}</span> slice{slices.length !== 1 ? 's' : ''} active
                </span>
                <span>
                  <span className="text-green-400 font-semibold">
                    {slices.reduce((acc, s) => acc + s.stations.filter(st => st.status !== 'worked').length, 0)}
                  </span> new stations
                </span>
                <span>
                  <span className="text-gray-400 font-semibold">
                    {slices.reduce((acc, s) => acc + s.stations.length, 0)}
                  </span> total
                </span>
              </div>
            )}

            {/* Slice panels grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {slices.length === 0 ? (
                <div className="col-span-full text-center py-12 text-gray-400">
                  <p className="mb-4">No active slices. Waiting for WSJT-X connections...</p>
                  <button
                    onClick={() => setPage('settings')}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Configure Settings
                  </button>
                </div>
              ) : (
                slices.map((slice) => (
                  <SlicePanel
                    key={slice.id}
                    slice={slice}
                    config={dashboardConfig}
                  />
                ))
              )}
            </div>

            {/* Legend */}
            {slices.length > 0 && (
              <div className="flex flex-wrap gap-4 text-xs text-gray-500 justify-center">
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: dashboardConfig.colors.strong }}></span>
                  <span>Strong</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: dashboardConfig.colors.normal }}></span>
                  <span>Normal</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: dashboardConfig.colors.weak }}></span>
                  <span>Weak</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: dashboardConfig.colors.worked }}></span>
                  <span>Worked</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: dashboardConfig.colors.priority }}></span>
                  <span>Priority</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: dashboardConfig.colors.new_dxcc }}></span>
                  <span>New DXCC</span>
                </div>
              </div>
            )}
          </div>
        )}

        {page === 'settings' && (
          <Settings onBack={() => setPage('dashboard')} apiBase={API_BASE} />
        )}
      </div>
    </div>
  );
}

export default App;
