import * as fs from 'fs';
import * as path from 'path';

// Simple file logger for debugging
class FileLogger {
    private logFilePath: string;
    private logStream: fs.WriteStream | null = null;

    constructor() {
        // Log to the project root directory
        this.logFilePath = path.join(process.cwd(), 'mcp-server.log');
        this.initLogFile();
    }

    private initLogFile() {
        try {
            // Create or append to log file
            this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
            this.log('=== MCP Server Started ===');
        } catch (error) {
            console.error('Failed to create log file:', error);
        }
    }

    log(...args: any[]) {
        const timestamp = new Date().toISOString();
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');

        const logLine = `[${timestamp}] ${message}\n`;

        // Write to file
        if (this.logStream) {
            this.logStream.write(logLine);
        }

        // Also write to stderr (so it doesn't break MCP stdio)
        console.error(message);
    }

    error(...args: any[]) {
        this.log('ERROR:', ...args);
    }

    warn(...args: any[]) {
        this.log('WARN:', ...args);
    }

    close() {
        if (this.logStream) {
            this.log('=== MCP Server Stopped ===');
            this.logStream.end();
        }
    }
}

// Singleton instance
export const logger = new FileLogger();
