const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = 3001;
const DATA_FILE = path.join(__dirname, 'canvas-data.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, './public')));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store canvas state in memory
let canvasState = {
    elements: [],
    camera: { x: 0, y: 0, zoom: 1 },
    timestamp: new Date().toISOString()
};

// Store connected users
let connectedUsers = new Map();

// Load initial state from file
async function loadInitialState() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const loadedState = JSON.parse(data);
        
        // Ensure backward compatibility with old format
        if (!loadedState.layers) {
            loadedState.layers = [{
                id: 'layer_0',
                name: 'Layer 1',
                visible: true,
                locked: false,
                elements: loadedState.elements ? loadedState.elements.map(el => el.id) : []
            }];
        }
        
        // Ensure layers array is properly initialized
        if (!Array.isArray(loadedState.layers)) {
            loadedState.layers = [{
                id: 'layer_0',
                name: 'Layer 1',
                visible: true,
                locked: false,
                elements: []
            }];
        }
        
        canvasState = loadedState;
        console.log(`Loaded canvas with ${canvasState.elements.length} elements and ${canvasState.layers.length} layers`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('No existing canvas data, starting with empty state');
            // Ensure layers array is initialized even when no file exists
            if (!canvasState.layers) {
                canvasState.layers = [{
                    id: 'layer_0',
                    name: 'Layer 1',
                    visible: true,
                    locked: false,
                    elements: []
                }];
            }
        } else {
            console.error('Error loading initial state:', error);
        }
    }
}

// Save state to file
async function saveState() {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(canvasState, null, 2));
    } catch (error) {
        console.error('Error saving state:', error);
    }
}

// Ensure canvas state has proper layers array
function ensureLayersArray() {
    if (!canvasState.layers || !Array.isArray(canvasState.layers)) {
        canvasState.layers = [{
            id: 'layer_0',
            name: 'Layer 1',
            visible: true,
            locked: false,
            elements: []
        }];
        console.log('Initialized default layers array');
    }
}

// Apply incremental update to canvas state
function applyUpdate(update) {
    const { type, data } = update;
    
    // Ensure layers array exists before any operation
    ensureLayersArray();
    
    switch (type) {
        case 'add':
            canvasState.elements.push(data);
            // Add to layer if specified
            if (data.layerId) {
                const layer = canvasState.layers.find(l => l.id === data.layerId);
                if (layer && !layer.elements.includes(data.id)) {
                    layer.elements.push(data.id);
                }
            }
            break;
        case 'update':
            const updateIndex = canvasState.elements.findIndex(el => el.id === data.id);
            if (updateIndex !== -1) {
                canvasState.elements[updateIndex] = { ...canvasState.elements[updateIndex], ...data };
            }
            break;
        case 'delete':
            canvasState.elements = canvasState.elements.filter(el => el.id !== data.id);
            // Remove from layers
            canvasState.layers.forEach(layer => {
                const index = layer.elements.indexOf(data.id);
                if (index !== -1) {
                    layer.elements.splice(index, 1);
                }
            });
            break;
        case 'clear':
            canvasState.elements = [];
            canvasState.layers.forEach(layer => {
                layer.elements = [];
            });
            break;
        case 'move':
            // Live movement update - don't save to file, just broadcast
            break;
        case 'cursor':
            // Cursor updates - don't save to file, just broadcast
            break;
        case 'shapeSelect':
        case 'shapeRelease':
            // Shape interaction tracking - don't save to file, just broadcast
            break;
        case 'userInfo':
            // User info updates - store in connected users
            connectedUsers.set(data.userId, {
                userName: data.userName,
                lastSeen: Date.now()
            });
            break;
        case 'fullSync':
            // Full state synchronization for undo/redo
            if (data.elements) {
                canvasState.elements = data.elements;
            }
            if (data.layers) {
                canvasState.layers = data.layers;
                console.log(`Full sync: ${data.layers.length} layers, ${data.elements ? data.elements.length : 'unchanged'} elements`);
            }
            break;
        case 'addLayer':
            canvasState.layers.push(data);
            console.log(`Added layer: ${data.name} (${data.id})`);
            break;
        case 'deleteLayer':
            const layerIndex = canvasState.layers.findIndex(l => l.id === data.id);
            if (layerIndex !== -1) {
                const layer = canvasState.layers[layerIndex];
                console.log(`Deleting layer: ${layer.name} with ${layer.elements.length} elements`);
                // Remove all elements from this layer
                layer.elements.forEach(elementId => {
                    canvasState.elements = canvasState.elements.filter(el => el.id !== elementId);
                });
                canvasState.layers.splice(layerIndex, 1);
            }
            break;
        case 'updateLayer':
            const layerUpdateIndex = canvasState.layers.findIndex(l => l.id === data.id);
            if (layerUpdateIndex !== -1) {
                canvasState.layers[layerUpdateIndex] = { ...canvasState.layers[layerUpdateIndex], ...data };
                console.log(`Updated layer: ${data.name || canvasState.layers[layerUpdateIndex].name}`);
            }
            break;
        case 'camera':
            canvasState.camera = data;
            break;
    }
    
    canvasState.timestamp = new Date().toISOString();
}

// Broadcast update to all connected clients except sender
function broadcastUpdate(update, senderWs) {
    const message = JSON.stringify(update);
    wss.clients.forEach(client => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    //console.log('New client connected');
    let userId = null;
    
    // Ensure layers array exists before sending to client
    ensureLayersArray();
    
    // Send current state to new client
    ws.send(JSON.stringify({
        type: 'init',
        data: canvasState
    }));
    
    // Handle messages from client
    ws.on('message', async (message) => {
        try {
            const update = JSON.parse(message);
            //console.log('Received update:', update.type, update.data?.id || update.data?.userId || 'other');
            
            // Track user ID for this connection
            if (update.type === 'userInfo') {
                userId = update.data.userId;
                
                // Broadcast user joined to others
                broadcastUpdate({
                    type: 'userJoined',
                    data: {
                        userId: update.data.userId,
                        userName: update.data.userName,
                        userCount: connectedUsers.size + 1
                    }
                }, ws);
            }
            
            // Apply update to server state
            applyUpdate(update);
            
            // Save to file only for persistent updates
            if (!['move', 'cursor', 'userInfo', 'shapeSelect', 'shapeRelease'].includes(update.type)) {
                await saveState();
            }
            
            // Broadcast to other clients
            broadcastUpdate(update, ws);
            
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', () => {
        //console.log('Client disconnected');
        
        if (userId) {
            const user = connectedUsers.get(userId);
            connectedUsers.delete(userId);
            
            // Broadcast user left to others
            wss.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'userLeft',
                        data: {
                            userId: userId,
                            userName: user?.userName || 'Unknown',
                            userCount: connectedUsers.size
                        }
                    }));
                }
            });
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// REST API endpoints for backward compatibility
app.get('/api/load', (req, res) => {
    res.json(canvasState);
});

app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'running', 
        timestamp: new Date().toISOString(),
        connectedClients: wss.clients.size,
        elements: canvasState.elements.length
    });
});

// Start server
server.listen(PORT, async () => {
    await loadInitialState();
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('WebSocket server ready for multiplayer connections');
    console.log('REST API endpoints:');
    console.log('  GET /api/load - Load canvas data');
    console.log('  GET /api/status - Server status');
});