import { useEffect, useState } from 'react';

interface Instance {
  name: string;
  status: string;
  freq: string;
}

function App() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000');

    ws.onopen = () => {
      setConnected(true);
      console.log('Connected to MCP Server');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Received:', data);
      if (data.type === 'INSTANCES_UPDATE') {
        setInstances(data.instances);
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
          <h1 className="text-4xl font-bold text-white mb-2">
            📡 WSJT-X Mission Control
          </h1>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-gray-300">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {instances.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-400">
              No active instances. Waiting for WSJT-X connections...
            </div>
          ) : (
            instances.map((instance) => (
              <div
                key={instance.name}
                className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6 hover:border-blue-500 transition-colors"
              >
                <h3 className="text-xl font-semibold text-blue-400 mb-4">
                  {instance.name}
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Status:</span>
                    <span className="text-green-400">{instance.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Frequency:</span>
                    <span className="text-white font-mono">{instance.freq} MHz</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
