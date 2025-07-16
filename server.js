const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const multer = require('multer');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, './public')));

// Validate room name to prevent path traversal and other attacks
function validateRoomName(roomName) {
    if (!roomName || typeof roomName !== 'string') return false;
    // Only allow letters, numbers, and hyphens
    const validPattern = /^[a-zA-Z0-9-]+$/;
    // Must be between 3 and 50 characters
    return validPattern.test(roomName) && roomName.length >= 3 && roomName.length <= 50;
}

// Check if user has write permission for the given operation
function hasWritePermission(ws, operationType) {
    // Admin users can do everything
    if (ws.userRole === 'admin') {
        return true;
    }
    
    // Readonly users cannot perform write operations
    if (ws.userRole === 'readonly') {
        return false;
    }
    
    // Default to admin for non-protected rooms
    return true;
}

// Serve uploaded images from room-specific directories
app.use('/api/uploads', express.static(UPLOADS_DIR));

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        // Use temporary uploads directory initially
        await fs.mkdir(UPLOADS_DIR, { recursive: true });
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        // Generate unique filename
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const ext = path.extname(file.originalname);
        const filename = `${timestamp}-${random}${ext}`;
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 3 * 1024 * 1024 // 3MB limit
    },
    fileFilter: (req, file, cb) => {
        // Only allow JPG and PNG files for security reasons
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        const allowedExtensions = ['.jpg', '.jpeg', '.png'];
        
        const fileExtension = path.extname(file.originalname).toLowerCase();
        
        if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPG and PNG image files are allowed'), false);
        }
    }
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store canvas states for different rooms
let roomStates = new Map();

// Store connected users per room
let roomUsers = new Map();

// Keepalive ping interval (45 seconds)
const PING_INTERVAL = 45000;

// Start keepalive ping for all connected clients
function startKeepalive() {
    setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'ping',
                    timestamp: Date.now()
                }));
            }
        });
    }, PING_INTERVAL);
}

// Generate a safe random room name
function generateRoomName() {
    const adjectives = ['happy', 'creative', 'bright', 'swift', 'clever', 'cool', 'calm', 'bold', 'warm', 'quick'];
    const nouns = ['canvas', 'space', 'room', 'studio', 'board', 'place', 'zone', 'area', 'lab', 'hub'];
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const number = Math.floor(Math.random() * 1000);
    return `${adjective}-${noun}-${number}`;
}

// Get file path for room
function getRoomFilePath(roomName) {
    if (!validateRoomName(roomName)) {
        throw new Error('Invalid room name');
    }
    return path.join(DATA_DIR, `${roomName}.json`);
}

// Initialize room state
function initRoomState() {
    return {
        elements: [],
        camera: { x: 0, y: 0, zoom: 1 },
        layers: [{
            id: 'layer_0',
            name: 'Layer 1',
            visible: true,
            locked: false,
            elements: []
        }],
        adminPassword: '',
        readonlyPassword: '',
        isPasswordProtected: false,
        timestamp: new Date().toISOString(),
        lastModified: new Date().toISOString()
    };
}

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating data directory:', error);
    }
}

// Load room state from file
async function loadRoomState(roomName) {
    if (!validateRoomName(roomName)) {
        throw new Error('Invalid room name');
    }
    
    try {
        const filePath = getRoomFilePath(roomName);
        const data = await fs.readFile(filePath, 'utf8');
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
        
        // Ensure password fields exist (backward compatibility)
        if (loadedState.password !== undefined) {
            // Migrate old password to admin password
            loadedState.adminPassword = loadedState.password;
            delete loadedState.password;
        }
        if (loadedState.adminPassword === undefined) {
            loadedState.adminPassword = '';
        }
        if (loadedState.readonlyPassword === undefined) {
            loadedState.readonlyPassword = '';
        }
        if (loadedState.isPasswordProtected === undefined) {
            loadedState.isPasswordProtected = loadedState.adminPassword.length > 0 || loadedState.readonlyPassword.length > 0;
        }
        
        // Ensure lastModified field exists (backward compatibility)
        if (loadedState.lastModified === undefined) {
            loadedState.lastModified = new Date().toISOString();
        }
        
        roomStates.set(roomName, loadedState);
        console.log(`Loaded room "${roomName}" with ${loadedState.elements.length} elements and ${loadedState.layers.length} layers`);
        return loadedState;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`No existing data for room "${roomName}", creating new room`);
            const newState = initRoomState();
            roomStates.set(roomName, newState);
            return newState;
        } else {
            console.error(`Error loading room "${roomName}":`, error);
            throw error;
        }
    }
}

// Save room state to file
async function saveRoomState(roomName) {
    if (!validateRoomName(roomName)) {
        throw new Error('Invalid room name');
    }
    
    try {
        const state = roomStates.get(roomName);
        if (!state) return;
        
        // Update last modified timestamp
        state.lastModified = new Date().toISOString();
        
        const filePath = getRoomFilePath(roomName);
        await fs.writeFile(filePath, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error(`Error saving room "${roomName}":`, error);
    }
}

// Cleanup old rooms and their assets
async function cleanupOldRooms() {
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
    const now = Date.now();
    
    try {
        console.log('Starting room cleanup...');
        
        // Get all room files
        const files = await fs.readdir(DATA_DIR);
        const roomFiles = files.filter(file => file.endsWith('.json'));
        
        let cleanedCount = 0;
        
        for (const file of roomFiles) {
            const roomName = path.basename(file, '.json');
            const filePath = path.join(DATA_DIR, file);
            
            try {
                // Read room data
                const data = await fs.readFile(filePath, 'utf8');
                const roomData = JSON.parse(data);
                
                // Check if room is older than 30 days
                const lastModified = roomData.lastModified || roomData.timestamp;
                if (lastModified) {
                    const roomAge = now - new Date(lastModified).getTime();
                    
                    if (roomAge > maxAge) {
                        console.log(`Cleaning up old room: ${roomName} (${Math.floor(roomAge / (24 * 60 * 60 * 1000))} days old)`);
                        
                        // Delete room file
                        await fs.unlink(filePath);
                        
                        // Delete room's upload directory
                        const roomUploadsDir = path.join(UPLOADS_DIR, roomName);
                        try {
                            await fs.rmdir(roomUploadsDir, { recursive: true });
                            console.log(`Deleted uploads directory for room: ${roomName}`);
                        } catch (err) {
                            if (err.code !== 'ENOENT') {
                                console.error(`Failed to delete uploads directory for room ${roomName}:`, err);
                            }
                        }
                        
                        // Remove from memory if loaded
                        if (roomStates.has(roomName)) {
                            roomStates.delete(roomName);
                        }
                        
                        cleanedCount++;
                    }
                }
            } catch (error) {
                console.error(`Error processing room file ${file}:`, error);
            }
        }
        
        console.log(`Room cleanup completed. Cleaned up ${cleanedCount} old rooms.`);
    } catch (error) {
        console.error('Error during room cleanup:', error);
    }
}

// Ensure room state has proper layers array
function ensureLayersArray(roomName) {
    const state = roomStates.get(roomName);
    if (!state) return;
    
    if (!state.layers || !Array.isArray(state.layers)) {
        state.layers = [{
            id: 'layer_0',
            name: 'Layer 1',
            visible: true,
            locked: false,
            elements: []
        }];
        console.log(`Initialized default layers array for room "${roomName}"`);
    }
}

// Apply incremental update to room state
function applyUpdate(update, roomName) {
    const { type, data } = update;
    const state = roomStates.get(roomName);
    if (!state) return;
    
    // Ensure layers array exists before any operation
    ensureLayersArray(roomName);
    
    switch (type) {
        case 'add':
            state.elements.push(data);
            // Add to layer if specified
            if (data.layerId) {
                const layer = state.layers.find(l => l.id === data.layerId);
                if (layer && !layer.elements.includes(data.id)) {
                    layer.elements.push(data.id);
                }
            }
            break;
        case 'update':
            const updateIndex = state.elements.findIndex(el => el.id === data.id);
            if (updateIndex !== -1) {
                state.elements[updateIndex] = { ...state.elements[updateIndex], ...data };
            }
            break;
        case 'delete':
            state.elements = state.elements.filter(el => el.id !== data.id);
            // Remove from layers
            state.layers.forEach(layer => {
                const index = layer.elements.indexOf(data.id);
                if (index !== -1) {
                    layer.elements.splice(index, 1);
                }
            });
            break;
        case 'clear':
            state.elements = [];
            state.layers.forEach(layer => {
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
            // User info updates - store in room users
            if (!roomUsers.has(roomName)) {
                roomUsers.set(roomName, new Map());
            }
            roomUsers.get(roomName).set(data.userId, {
                userName: data.userName,
                lastSeen: Date.now()
            });
            break;
        case 'fullSync':
            // Full state synchronization for undo/redo
            if (data.elements) {
                state.elements = data.elements;
            }
            if (data.layers) {
                state.layers = data.layers;
                console.log(`Full sync for room "${roomName}": ${data.layers.length} layers, ${data.elements ? data.elements.length : 'unchanged'} elements`);
            }
            break;
        case 'addLayer':
            state.layers.push(data);
            console.log(`Added layer to room "${roomName}": ${data.name} (${data.id})`);
            break;
        case 'deleteLayer':
            const layerIndex = state.layers.findIndex(l => l.id === data.id);
            if (layerIndex !== -1) {
                const layer = state.layers[layerIndex];
                console.log(`Deleting layer from room "${roomName}": ${layer.name} with ${layer.elements.length} elements`);
                // Remove all elements from this layer
                layer.elements.forEach(elementId => {
                    state.elements = state.elements.filter(el => el.id !== elementId);
                });
                state.layers.splice(layerIndex, 1);
            }
            break;
        case 'updateLayer':
            const layerUpdateIndex = state.layers.findIndex(l => l.id === data.id);
            if (layerUpdateIndex !== -1) {
                state.layers[layerUpdateIndex] = { ...state.layers[layerUpdateIndex], ...data };
                console.log(`Updated layer in room "${roomName}": ${data.name || state.layers[layerUpdateIndex].name}`);
            }
            break;
        case 'roomPasswordChanged':
            // Handle room password change notifications (broadcast only, no state change)
            break;
        case 'camera':
            state.camera = data;
            break;
    }
    
    state.timestamp = new Date().toISOString();
}

// Broadcast update to all connected clients in the same room except sender
function broadcastUpdate(update, senderWs, roomName) {
    const message = JSON.stringify(update);
    wss.clients.forEach(client => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN && client.roomName === roomName) {
            client.send(message);
        }
    });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    let userId = null;
    let roomName = null;
    
    // Track last pong time for connection health
    ws.lastPong = Date.now();
    
    // Handle messages from client
    ws.on('message', async (message) => {
        try {
            const update = JSON.parse(message);
            
            // Handle pong response from client
            if (update.type === 'pong') {
                ws.lastPong = Date.now();
                return;
            }
            
            // Handle room join
            if (update.type === 'joinRoom') {
                roomName = update.data.roomName;
                const providedPassword = update.data.password || '';
                
                // Validate room name
                if (!validateRoomName(roomName)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: { message: 'Invalid room name' }
                    }));
                    return;
                }
                
                // Load or create room state
                const roomState = await loadRoomState(roomName);
                
                // Check password if room is protected
                let userRole = 'admin'; // default for non-protected rooms
                
                if (roomState.isPasswordProtected) {
                    if (roomState.adminPassword && providedPassword === roomState.adminPassword) {
                        userRole = 'admin';
                    } else if (roomState.readonlyPassword && providedPassword === roomState.readonlyPassword) {
                        userRole = 'readonly';
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            data: { message: 'Incorrect password for this room' }
                        }));
                        return;
                    }
                }
                
                // Store room name and user role on the WebSocket connection
                ws.roomName = roomName;
                ws.userRole = userRole;
                
                // Ensure layers array exists before sending to client
                ensureLayersArray(roomName);
                
                // Send current room state to new client (without passwords)
                const clientState = {
                    elements: roomState.elements,
                    camera: roomState.camera,
                    layers: roomState.layers,
                    isPasswordProtected: roomState.isPasswordProtected,
                    userRole: userRole,
                    timestamp: roomState.timestamp
                };
                
                ws.send(JSON.stringify({
                    type: 'init',
                    data: clientState
                }));
                
                console.log(`Client joined room: ${roomName}`);
                return;
            }
            
            // All other messages require a room
            if (!roomName) {
                ws.send(JSON.stringify({
                    type: 'error',
                    data: { message: 'Must join a room first' }
                }));
                return;
            }
            
            // Track user ID for this connection
            if (update.type === 'userInfo') {
                userId = update.data.userId;
                
                // Get room users
                const roomUserMap = roomUsers.get(roomName) || new Map();
                
                // Broadcast user joined to others in the same room
                broadcastUpdate({
                    type: 'userJoined',
                    data: {
                        userId: update.data.userId,
                        userName: update.data.userName,
                        userCount: roomUserMap.size + 1
                    }
                }, ws, roomName);
            }
            
            // Check permissions for write operations
            const writeOperations = ['add', 'update', 'delete', 'clear', 'layer', 'paste'];
            const readOnlyOperations = ['move', 'cursor', 'userInfo', 'shapeSelect', 'shapeRelease'];
            
            if (writeOperations.includes(update.type)) {
                if (!hasWritePermission(ws, update.type)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: { message: 'You do not have permission to perform this action (readonly access)' }
                    }));
                    return;
                }
            }
            
            // Apply update to room state
            applyUpdate(update, roomName);
            
            // Save to file only for persistent updates
            if (!readOnlyOperations.includes(update.type)) {
                await saveRoomState(roomName);
            }
            
            // Broadcast to other clients in the same room
            broadcastUpdate(update, ws, roomName);
            
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log(`Client disconnected from room: ${roomName || 'no room'}`);
        
        if (userId && roomName) {
            const roomUserMap = roomUsers.get(roomName);
            if (roomUserMap) {
                const user = roomUserMap.get(userId);
                roomUserMap.delete(userId);
                
                // Broadcast user left to others in the same room
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && client.roomName === roomName) {
                        client.send(JSON.stringify({
                            type: 'userLeft',
                            data: {
                                userId: userId,
                                userName: user?.userName || 'Unknown',
                                userCount: roomUserMap.size
                            }
                        }));
                    }
                });
            }
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Image upload endpoint
app.post('/api/upload/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }
        
        const roomName = req.body.roomName;
        if (!validateRoomName(roomName)) {
            // Clean up uploaded file if room name is invalid
            await fs.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: 'Invalid room name' });
        }
        
        // Create room-specific uploads directory
        const roomUploadsDir = path.join(UPLOADS_DIR, roomName);
        await fs.mkdir(roomUploadsDir, { recursive: true });
        
        // Move file to room-specific directory
        const newFilePath = path.join(roomUploadsDir, req.file.filename);
        await fs.rename(req.file.path, newFilePath);
        
        console.log(`Image uploaded for room "${roomName}": ${req.file.originalname} -> ${req.file.filename}`);
        
        res.json({
            success: true,
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        });
        
    } catch (error) {
        console.error('Error uploading image:', error);
        // Clean up uploaded file on error
        if (req.file && req.file.path) {
            await fs.unlink(req.file.path).catch(() => {});
        }
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

// REST API endpoints
app.get('/api/room/:roomName/check', async (req, res) => {
    try {
        const roomName = req.params.roomName;
        if (!validateRoomName(roomName)) {
            return res.status(400).json({ error: 'Invalid room name' });
        }
        
        // Check if room exists and if it requires a password
        try {
            const filePath = getRoomFilePath(roomName);
            const data = await fs.readFile(filePath, 'utf8');
            const roomState = JSON.parse(data);
            
            res.json({ 
                exists: true, 
                requiresPassword: roomState.isPasswordProtected || false 
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Room doesn't exist yet
                res.json({ exists: false, requiresPassword: false });
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error('Error checking room:', error);
        res.status(500).json({ error: 'Failed to check room' });
    }
});

app.post('/api/room/:roomName/password', async (req, res) => {
    try {
        const roomName = req.params.roomName;
        const { adminPassword, readonlyPassword } = req.body;
        
        if (!validateRoomName(roomName)) {
            return res.status(400).json({ error: 'Invalid room name' });
        }
        
        // Load room state
        const roomState = await loadRoomState(roomName);
        
        // Update passwords
        roomState.adminPassword = adminPassword || '';
        roomState.readonlyPassword = readonlyPassword || '';
        roomState.isPasswordProtected = roomState.adminPassword.length > 0 || roomState.readonlyPassword.length > 0;
        roomState.timestamp = new Date().toISOString();
        
        // Save updated state
        await saveRoomState(roomName);
        
        res.json({ 
            success: true, 
            isPasswordProtected: roomState.isPasswordProtected 
        });
        
        console.log(`Password ${roomState.isPasswordProtected ? 'enabled' : 'disabled'} for room: ${roomName}`);
        
    } catch (error) {
        console.error('Error setting room password:', error);
        res.status(500).json({ error: 'Failed to set room password' });
    }
});

app.get('/api/room/generate', (req, res) => {
    const roomName = generateRoomName();
    res.json({ roomName });
});

app.get('/api/room/:roomName/load', async (req, res) => {
    try {
        const roomName = req.params.roomName;
        if (!validateRoomName(roomName)) {
            return res.status(400).json({ error: 'Invalid room name' });
        }
        
        const roomState = await loadRoomState(roomName);
        res.json(roomState);
    } catch (error) {
        console.error('Error loading room:', error);
        res.status(500).json({ error: 'Failed to load room' });
    }
});

app.get('/api/status', (req, res) => {
    const activeRooms = Array.from(roomStates.keys());
    const totalClients = wss.clients.size;
    const roomStats = {};
    
    activeRooms.forEach(roomName => {
        const state = roomStates.get(roomName);
        const users = roomUsers.get(roomName) || new Map();
        roomStats[roomName] = {
            elements: state ? state.elements.length : 0,
            users: users.size
        };
    });
    
    res.json({ 
        status: 'running', 
        timestamp: new Date().toISOString(),
        totalClients: totalClients,
        activeRooms: activeRooms.length,
        rooms: roomStats
    });
});

// Manual cleanup endpoint for testing
app.post('/api/cleanup', async (req, res) => {
    try {
        await cleanupOldRooms();
        res.json({ success: true, message: 'Cleanup completed' });
    } catch (error) {
        console.error('Manual cleanup failed:', error);
        res.status(500).json({ success: false, error: 'Cleanup failed' });
    }
});

// Start server
server.listen(PORT, async () => {
    await ensureDataDir();
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('WebSocket server ready for multiplayer room connections');
    console.log('REST API endpoints:');
    console.log('  GET /api/room/generate - Generate a random room name');
    console.log('  GET /api/room/:roomName/load - Load room data');
    console.log('  GET /api/status - Server status');
    
    // Schedule daily cleanup at 2 AM
    cron.schedule('0 2 * * *', () => {
        console.log('Running scheduled room cleanup...');
        cleanupOldRooms();
    });
    
    console.log('Daily room cleanup scheduled at 2:00 AM');
    
    // Start keepalive ping mechanism
    startKeepalive();
    console.log(`WebSocket keepalive pings started (every ${PING_INTERVAL/1000}s)`);
    console.log('Application-level ping/pong will be visible in browser network inspector');
});