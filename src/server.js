// Express server with WebSocket for OBS overlay
import express from 'express';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { facebookCommentsConfig } from './config.js';
import { commentsService } from './service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Set up EJS
app.set('view engine', 'ejs');
app.set('views', join(__dirname, '../views'));

// Serve static files
app.use(express.static(join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => {
    res.render('overlay', {
        title: 'Facebook Live Comments Overlay'
    });
});

// Start HTTP server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📺 Open this URL in OBS Browser Source`);
});

// Set up WebSocket
const wss = new WebSocketServer({ server });

// Track connected clients
const clients = new Set();

wss.on('connection', (ws) => {
    console.log('✅ New client connected');
    clients.add(ws);

    ws.on('close', () => {
        console.log('❌ Client disconnected');
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Broadcast to all connected clients
function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.readyState === 1) { // OPEN
            client.send(message);
        }
    });
}

// Track seen comment IDs to only show new ones
const seenCommentIds = new Set();

// Start polling comments
console.log('\n🔄 Starting comment polling...\n');

commentsService.pollComments(
    facebookCommentsConfig,
    1000, // Poll every 1 second
    (comments) => {
        // Filter only new comments
        const newComments = comments.filter(comment => {
            if (seenCommentIds.has(comment.id)) {
                return false;
            }
            seenCommentIds.add(comment.id);
            return true;
        });

        if (newComments.length > 0) {
            console.log(`📨 ${newComments.length} new comment(s)`);

            // Send new comments to all connected clients
            newComments.forEach(comment => {
                broadcast({
                    type: 'new_comment',
                    comment: {
                        id: comment.id,
                        name: comment.from?.name || 'Unknown',
                        message: comment.message || '',
                        avatar: comment.from?.picture?.data?.url || '',
                        time: comment.created_time
                    }
                });
            });
        }
    },
    (error) => {
        console.error(`❌ Polling error: ${error.message}`);
    }
);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
