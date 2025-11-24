import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { Config } from '../config';
import { WsjtxManager } from '../wsjtx/WsjtxManager';

export class WebServer {
    private app: express.Application;
    private server: http.Server;
    private wss: WebSocketServer;
    private config: Config;
    private wsjtxManager: WsjtxManager;

    constructor(config: Config, wsjtxManager: WsjtxManager) {
        this.config = config;
        this.wsjtxManager = wsjtxManager;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSockets();
    }

    private setupMiddleware() {
        this.app.use(express.json());
        // Serve static files from the React frontend app
        const frontendPath = path.join(__dirname, '../../frontend/dist');
        this.app.use(express.static(frontendPath));
    }

    private setupRoutes() {
        this.app.get('/api/status', (req, res) => {
            res.json({ status: 'ok', mode: this.config.mode });
        });

        // Handle React routing, return all requests to React app
        this.app.get('*', (req, res) => {
            const frontendPath = path.join(__dirname, '../../frontend/dist');
            res.sendFile(path.join(frontendPath, 'index.html'));
        });
    }

    private setupWebSockets() {
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('Web Client connected');

            // Send initial state
            ws.send(JSON.stringify({ type: 'WELCOME', message: 'Connected to WSJT-X MCP Server' }));

            ws.on('message', (message: string) => {
                console.log('Received:', message);
            });
        });
    }

    public start() {
        const port = this.config.web.port;
        this.server.listen(port, () => {
            console.log(`Web Dashboard running at http://localhost:${port}`);
        });
    }
}
