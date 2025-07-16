class InfiniteCanvas {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.elements = [];
        this.selectedElement = null;
        this.selectedElements = new Set(); // Multi-select support
        
        this.camera = {
            x: 0,
            y: 0,
            zoom: 1
        };
        
        this.mouse = {
            x: 0,
            y: 0,
            worldX: 0,
            worldY: 0,
            isDragging: false,
            dragStartX: 0,
            dragStartY: 0,
            selectionStart: null, // For selection box
            dragButton: null // Track which button initiated the drag
        };
        
        this.gridSize = 50;
        this.snapToGrid = false;
        this.selectedShape = null;
        this.mode = 'select';
        this.isPlacing = false;
        this.isSizing = false; // For drag-to-size when placing shapes
        this.sizingShape = null; // Temporary shape being sized
        this.isResizing = false;
        this.isRotating = false;
        this.resizeHandle = null;
        this.isEditingLabel = false;
        this.isSelecting = false; // For selection box
        this.selectionBox = null;
        this.clipboard = [];
        
        // Inline text editing
        this.isEditingText = false;
        this.editingTextElement = null;
        this.textCursorPosition = 0;
        this.textCursorVisible = true;
        this.textCursorInterval = null;
        
        // History management for undo/redo
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 50;
        this.isUndoRedo = false;
        
        // Layers system
        this.layers = [{
            id: 'layer_0',
            name: 'Layer 1',
            visible: true,
            locked: false,
            elements: []
        }];
        this.activeLayerId = 'layer_0';
        
        this.ws = null;
        this.isConnected = false;
        this.pendingUpdates = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        
        // Connection heartbeat monitoring
        this.lastHeartbeat = Date.now();
        this.heartbeatInterval = null;
        this.connectionCheckInterval = 60000; // Check every minute
        
        // Room functionality
        this.roomName = null;
        this.isJoiningRoom = false;
        this.roomPassword = null;
        this.isPasswordProtected = false;
        
        // Animation system
        this.isAnimating = false;
        this.animationStartTime = 0;
        this.animationDuration = 2000; // 2 seconds total
        this.animatedElements = new Map(); // Track animation state per element
        this.hasPlayedInitialAnimation = false; // Track if initial animation has been played
        
        this.userId = 'user_' + Math.random().toString(36).substr(2, 9);
        this.userName = this.generateRandomName();
        this.otherUsers = new Map();
        this.lastMouseUpdate = 0;
        this.shapeUsers = new Map(); // Track which user is manipulating which shape
        
        // Touch handling for mobile
        this.touches = [];
        this.lastTouchDistance = 0;
        this.lastTouchCenter = { x: 0, y: 0 };
        this.isPinching = false;
        
        // Tooltip system
        this.tooltip = {
            visible: false,
            text: '',
            x: 0,
            y: 0,
            timer: null
        };
        
        this.init();
    }
    
    async init() {
        this.resizeCanvas();
        this.setupEventListeners();
        
        // Handle room routing
        await this.handleRoomRouting();
        
        this.setupWebSocket();
        this.saveToHistory('Initial state');
        this.updateLayerUI();
        this.render();
        
        // Set initial username in UI
        document.getElementById('username').textContent = `👤 ${this.userName}`;
        
        window.addEventListener('resize', () => this.resizeCanvas());
        window.addEventListener('hashchange', () => this.handleHashChange());
    }
    
    async handleRoomRouting() {
        // Get room name from URL hash
        const hash = window.location.hash.substr(1); // Remove #
        
        if (hash && this.validateRoomName(hash)) {
            // Valid room name in URL
            this.roomName = hash;
            console.log(`Joining room from URL: ${this.roomName}`);
        } else {
            // No valid room name, generate one and redirect
            try {
                const response = await fetch('/api/room/generate');
                const data = await response.json();
                this.roomName = data.roomName;
                
                // Update URL with new room name
                window.location.hash = this.roomName;
                console.log(`Generated new room: ${this.roomName}`);
            } catch (error) {
                console.error('Failed to generate room name:', error);
                // Fallback to local generation
                this.roomName = this.generateLocalRoomName();
                window.location.hash = this.roomName;
            }
        }
        
        // Update page title with room name
        document.title = `Infinite Canvas - ${this.roomName}`;
        
        // Update room name display in UI
        this.updateRoomNameDisplay();
    }
    
    isMobileDevice() {
        return window.innerWidth <= 768 || 'ontouchstart' in window;
    }
    
    validateRoomName(roomName) {
        if (!roomName || typeof roomName !== 'string') return false;
        // Only allow letters, numbers, and hyphens
        const validPattern = /^[a-zA-Z0-9-]+$/;
        // Must be between 3 and 50 characters
        return validPattern.test(roomName) && roomName.length >= 3 && roomName.length <= 50;
    }
    
    generateLocalRoomName() {
        const adjectives = ['happy', 'creative', 'bright', 'swift', 'clever', 'cool', 'calm', 'bold', 'warm', 'quick'];
        const nouns = ['canvas', 'space', 'room', 'studio', 'board', 'place', 'zone', 'area', 'lab', 'hub'];
        const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const number = Math.floor(Math.random() * 1000);
        return `${adjective}-${noun}-${number}`;
    }
    
    async handleHashChange() {
        const newHash = window.location.hash.substr(1); // Remove #
        
        // If hash is empty or same as current room, do nothing
        if (!newHash || newHash === this.roomName) return;
        
        console.log(`Hash changed from ${this.roomName} to ${newHash}`);
        
        // Validate new room name
        if (!this.validateRoomName(newHash)) {
            console.warn(`Invalid room name: ${newHash}, staying in current room`);
            // Revert hash to current room
            window.location.hash = this.roomName;
            return;
        }
        
        // Switch to new room
        await this.switchRoom(newHash);
    }
    
    async switchRoom(newRoomName) {
        console.log(`Switching from room "${this.roomName}" to "${newRoomName}"`);
        
        // Store old room name for rollback if needed
        const oldRoomName = this.roomName;
        
        try {
            // Update room name
            this.roomName = newRoomName;
            
            // Update page title and UI
            document.title = `Infinite Canvas - ${this.roomName}`;
            this.updateRoomNameDisplay();
            
            // Clear current state
            this.clearCanvas();
            
            // Close current WebSocket connection
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            
            // Reset connection state
            this.isConnected = false;
            this.isJoiningRoom = false;
            this.hasPlayedInitialAnimation = false; // Reset animation flag for new room
            this.updateConnectionStatus('Switching rooms...');
            
            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Setup new WebSocket connection to new room
            this.setupWebSocket();
            
        } catch (error) {
            console.error('Error switching rooms:', error);
            
            // Rollback on error
            this.roomName = oldRoomName;
            document.title = `Infinite Canvas - ${this.roomName}`;
            this.updateRoomNameDisplay();
            window.location.hash = oldRoomName;
            this.updateConnectionStatus('Error switching rooms');
        }
    }
    
    clearCanvas() {
        // Clear current canvas state
        this.elements = [];
        this.selectedElements.clear();
        this.selectedElement = null;
        this.hideColorPicker();
        this.hideTextFormatPopup();
        this.layers = [{
            id: 'layer_0',
            name: 'Layer 1',
            visible: true,
            locked: false,
            elements: []
        }];
        this.activeLayerId = 'layer_0';
        
        // Clear history
        this.history = [];
        this.historyIndex = -1;
        
        // Clear other users
        this.otherUsers.clear();
        this.shapeUsers.clear();
        
        // Reset camera
        this.camera = { x: 0, y: 0, zoom: 1 };
        
        // Update UI
        this.updateLayerUI();
        this.render();
        
        console.log('Canvas cleared for room switch');
    }
    
    updateRoomNameDisplay() {
        const roomNameElement = document.getElementById('roomName');
        if (roomNameElement && this.roomName) {
            roomNameElement.textContent = `🏠 ${this.roomName}`;
        }
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.render();
    }
    
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Disable right-click menu
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        
        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        
        document.querySelectorAll('.shape-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.selectShape(e.target.dataset.shape));
        });
        
        document.getElementById('clearAll').addEventListener('click', () => this.clearAllElements());
        document.getElementById('username').addEventListener('click', () => this.editUsername());
        document.getElementById('roomName').addEventListener('click', () => this.editRoomName());
        document.getElementById('lockIcon').addEventListener('click', () => this.toggleRoomPassword());
        
        // History controls
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('redoBtn').addEventListener('click', () => this.redo());
        
        // Layer controls
        document.getElementById('addLayerBtn').addEventListener('click', () => this.addLayer());
        document.getElementById('deleteLayerBtn').addEventListener('click', () => this.deleteLayer());
        
        // Export controls
        document.getElementById('exportBtn').addEventListener('click', () => this.showExportDialog());
        
        // Image upload controls
        document.getElementById('imageUploadBtn').addEventListener('click', () => this.triggerImageUpload());
        document.getElementById('imageInput').addEventListener('change', (e) => this.handleImageUpload(e));
        
        // Snap to grid toggle
        document.getElementById('snapToggle').addEventListener('click', () => this.toggleSnapToGrid());
        
        // Side panel toggle for mobile
        document.getElementById('sidePanelToggle').addEventListener('click', () => this.toggleSidePanel());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
        // Paste event for images
        document.addEventListener('paste', (e) => this.handlePaste(e));
        
        document.getElementById('labelInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.finishLabelEdit();
            } else if (e.key === 'Escape') {
                this.cancelLabelEdit();
            }
        });
        
        document.getElementById('labelInput').addEventListener('blur', () => {
            this.finishLabelEdit();
        });
        
        window.addEventListener('beforeunload', () => {
            if (this.ws) {
                this.ws.close();
            }
        });
    }
    
    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.canvas.width / 2) / this.camera.zoom + this.camera.x,
            y: (screenY - this.canvas.height / 2) / this.camera.zoom + this.camera.y
        };
    }
    
    worldToScreen(worldX, worldY) {
        return {
            x: (worldX - this.camera.x) * this.camera.zoom + this.canvas.width / 2,
            y: (worldY - this.camera.y) * this.camera.zoom + this.canvas.height / 2
        };
    }
    
    updateMousePosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
        
        const worldPos = this.screenToWorld(this.mouse.x, this.mouse.y);
        this.mouse.worldX = worldPos.x;
        this.mouse.worldY = worldPos.y;
        
        // Snap to grid if enabled
        if (this.snapToGrid) {
            this.mouse.worldX = Math.round(this.mouse.worldX / this.gridSize) * this.gridSize;
            this.mouse.worldY = Math.round(this.mouse.worldY / this.gridSize) * this.gridSize;
        }
        
        const coordsElement = document.getElementById('coordinates');
        if (coordsElement) {
            coordsElement.textContent = 
                `x: ${Math.round(this.mouse.worldX)}, y: ${Math.round(this.mouse.worldY)}`;
        }
    }
    
    updateTouchPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0] || e.changedTouches[0];
        
        this.mouse.x = touch.clientX - rect.left;
        this.mouse.y = touch.clientY - rect.top;
        
        const worldPos = this.screenToWorld(this.mouse.x, this.mouse.y);
        this.mouse.worldX = worldPos.x;
        this.mouse.worldY = worldPos.y;
        
        // Snap to grid if enabled
        if (this.snapToGrid) {
            this.mouse.worldX = Math.round(this.mouse.worldX / this.gridSize) * this.gridSize;
            this.mouse.worldY = Math.round(this.mouse.worldY / this.gridSize) * this.gridSize;
        }
        
        const coordsElement = document.getElementById('coordinates');
        if (coordsElement) {
            coordsElement.textContent = 
                `x: ${Math.round(this.mouse.worldX)}, y: ${Math.round(this.mouse.worldY)}`;
        }
    }
    
    // History Management
    saveToHistory(description) {
        if (this.isUndoRedo) return;
        
        const state = {
            elements: JSON.parse(JSON.stringify(this.elements)),
            layers: JSON.parse(JSON.stringify(this.layers)),
            camera: JSON.parse(JSON.stringify(this.camera)),
            description: description,
            timestamp: Date.now()
        };
        
        // Remove any states after current index
        this.history = this.history.slice(0, this.historyIndex + 1);
        
        // Add new state
        this.history.push(state);
        
        // Keep history size manageable
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
        
        this.updateHistoryUI();
    }
    
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreFromHistory();
            console.log('Undo:', this.history[this.historyIndex].description);
        }
    }
    
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restoreFromHistory();
            console.log('Redo:', this.history[this.historyIndex].description);
        }
    }
    
    restoreFromHistory() {
        this.isUndoRedo = true;
        const state = this.history[this.historyIndex];
        
        this.elements = JSON.parse(JSON.stringify(state.elements));
        this.layers = JSON.parse(JSON.stringify(state.layers));
        this.camera = JSON.parse(JSON.stringify(state.camera));
        
        // Rebuild layer-element relationships
        this.rebuildLayerElementRelationships();
        
        this.selectedElement = null;
        this.selectedElements.clear();
        this.hideColorPicker();
        this.hideTextFormatPopup();
        this.updateLayerUI();
        this.updateHistoryUI();
        this.render();
        
        // Send full state to server
        this.sendUpdate('fullSync', {
            elements: this.elements,
            layers: this.layers
        });
        
        this.isUndoRedo = false;
    }
    
    updateHistoryUI() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        
        undoBtn.disabled = this.historyIndex <= 0;
        redoBtn.disabled = this.historyIndex >= this.history.length - 1;
        
        undoBtn.title = this.historyIndex > 0 ? 
            `Undo: ${this.history[this.historyIndex].description}` : 'Nothing to undo';
        redoBtn.title = this.historyIndex < this.history.length - 1 ? 
            `Redo: ${this.history[this.historyIndex + 1].description}` : 'Nothing to redo';
    }
    
    handleMouseDown(e) {
        this.updateMousePosition(e);
        
        // Right-click for panning
        if (e.button === 2) {
            this.mouse.isDragging = true;
            this.mouse.dragButton = 2;
            this.mouse.dragStartX = this.mouse.x;
            this.mouse.dragStartY = this.mouse.y;
            this.mouse.cameraStartX = this.camera.x;
            this.mouse.cameraStartY = this.camera.y;
            this.canvas.style.cursor = 'grabbing';
            return;
        }
        
        // Left-click only for shape placement and interaction
        if (e.button !== 0) return;
        
        if (this.isPlacing && this.selectedShape) {
            // Check if we're on mobile - use click-to-place instead of drag-to-size
            if (this.isMobileDevice()) {
                this.placeShape(this.mouse.worldX, this.mouse.worldY);
            } else {
                this.startShapeSizing(this.mouse.worldX, this.mouse.worldY);
            }
            return;
        }
        
        const resizeHandle = this.getResizeHandle(this.mouse.x, this.mouse.y);
        if (resizeHandle) {
            this.isResizing = true;
            this.resizeHandle = resizeHandle;
            this.canvas.className = 'resizing';
            return;
        }
        
        const rotateHandle = this.getRotateHandle(this.mouse.x, this.mouse.y);
        if (rotateHandle) {
            this.isRotating = true;
            this.canvas.className = 'rotating';
            this.lastRotationAngle = null; // Initialize rotation tracking
            return;
        }
        
        const bringForwardHandle = this.getBringForwardHandle(this.mouse.x, this.mouse.y);
        if (bringForwardHandle) {
            this.bringForward();
            return;
        }
        
        const bringBackwardHandle = this.getBringBackwardHandle(this.mouse.x, this.mouse.y);
        if (bringBackwardHandle) {
            this.bringBackward();
            return;
        }
        
        const colorPickerHandle = this.getColorPickerHandle(this.mouse.x, this.mouse.y);
        if (colorPickerHandle) {
            this.openColorPicker();
            return;
        }
        
        const textFormatHandle = this.getTextFormatHandle(this.mouse.x, this.mouse.y);
        if (textFormatHandle) {
            this.openTextFormatPopup();
            return;
        }
        
        const groupHandle = this.getGroupHandle(this.mouse.x, this.mouse.y);
        if (groupHandle) {
            this.toggleGroupSelection();
            return;
        }
        
        const deleteHandle = this.getDeleteHandle(this.mouse.x, this.mouse.y);
        if (deleteHandle) {
            this.deleteSelectedElements();
            return;
        }
        
        const clickedElement = this.getElementAtPosition(this.mouse.worldX, this.mouse.worldY);
        
        // If we're editing text and clicked somewhere else, finish editing
        if (this.isEditingText && (!clickedElement || clickedElement !== this.editingTextElement)) {
            this.finishInlineTextEdit();
            // Don't return, continue with normal click handling
        }
        
        if (clickedElement) {
            if (e.detail === 2) {
                if (clickedElement.shape === 'text') {
                    this.startInlineTextEdit(clickedElement);
                } else {
                    this.startLabelEdit(clickedElement);
                }
                return;
            }
            
            // Multi-select with Ctrl/Cmd
            if (e.ctrlKey || e.metaKey) {
                if (this.selectedElements.has(clickedElement)) {
                    this.selectedElements.delete(clickedElement);
                    this.selectedElement = this.selectedElements.size > 0 ? 
                        Array.from(this.selectedElements)[0] : null;
                } else {
                    this.selectedElements.add(clickedElement);
                    this.selectedElement = clickedElement;
                }
            } else {
                // Check if clicked element is already part of multi-selection
                if (this.selectedElements.has(clickedElement) && this.selectedElements.size > 1) {
                    // Don't change selection, just prepare for multi-element drag
                    this.selectedElement = clickedElement; // Make clicked element the primary
                } else {
                    // Single selection - check if element is grouped
                    this.selectedElements.clear();
                    
                    if (clickedElement.groupId) {
                        // Select all elements in the same group
                        this.elements.forEach(element => {
                            if (element.groupId === clickedElement.groupId) {
                                this.selectedElements.add(element);
                            }
                        });
                    } else {
                        // Select just this element
                        this.selectedElements.add(clickedElement);
                    }
                    
                    this.selectedElement = clickedElement;
                    this.hideColorPicker();
        this.hideTextFormatPopup();
                }
            }
            
            this.mouse.isDragging = true;
            this.mouse.dragButton = 0;
            this.mouse.dragStartX = this.mouse.worldX - clickedElement.x;
            this.mouse.dragStartY = this.mouse.worldY - clickedElement.y;
            
            // Send shape selection to others
            this.sendUpdate('shapeSelect', { 
                id: clickedElement.id,
                action: 'selected'
            });
        } else {
            // Start selection box if no element clicked
            if (!e.ctrlKey && !e.metaKey) {
                this.selectedElements.clear();
                this.selectedElement = null;
                this.hideColorPicker();
        this.hideTextFormatPopup();
                this.isSelecting = true;
                this.mouse.selectionStart = { x: this.mouse.worldX, y: this.mouse.worldY };
            }
            
            this.mouse.isDragging = true;
            this.mouse.dragButton = 0;
            this.mouse.dragStartX = this.mouse.x;
            this.mouse.dragStartY = this.mouse.y;
            this.mouse.cameraStartX = this.camera.x;
            this.mouse.cameraStartY = this.camera.y;
        }
        
        this.render();
    }
    
    handleMouseMove(e) {
        this.updateMousePosition(e);
        
        // Check for tooltips and cursors (only when not dragging)
        if (!this.mouse.isDragging && !this.isResizing && !this.isRotating && !this.isSizing) {
            this.checkTooltips();
            this.updateCursor();
        } else {
            this.hideTooltip();
        }
        
        if (this.isSizing && this.sizingShape) {
            this.updateShapeSize();
            this.render();
            return;
        }
        
        if (this.isResizing && this.selectedElement && this.resizeHandle) {
            this.resizeElement(this.resizeHandle);
            // Send live resize update
            this.sendUpdate('move', {
                id: this.selectedElement.id,
                x: this.selectedElement.x,
                y: this.selectedElement.y,
                width: this.selectedElement.width,
                height: this.selectedElement.height,
                action: 'resizing'
            });
            this.render();
            return;
        }
        
        if (this.isRotating && this.selectedElement) {
            this.rotateElements();
            // Send live rotate update for all selected elements
            this.selectedElements.forEach(element => {
                this.sendUpdate('move', {
                    id: element.id,
                    x: element.x,
                    y: element.y,
                    rotation: element.rotation,
                    action: 'rotating'
                });
            });
            this.render();
            return;
        }
        
        if (this.mouse.isDragging) {
            if (this.mouse.dragButton === 2) {
                // Right-click panning
                const deltaX = (this.mouse.x - this.mouse.dragStartX) / this.camera.zoom;
                const deltaY = (this.mouse.y - this.mouse.dragStartY) / this.camera.zoom;
                this.camera.x = this.mouse.cameraStartX - deltaX;
                this.camera.y = this.mouse.cameraStartY - deltaY;
            } else if (this.selectedElement && !this.isSelecting) {
                // Move selected elements
                const newX = this.mouse.worldX - this.mouse.dragStartX;
                const newY = this.mouse.worldY - this.mouse.dragStartY;
                
                const deltaX = newX - this.selectedElement.x;
                const deltaY = newY - this.selectedElement.y;
                
                console.log(`Moving ${this.selectedElements.size} elements by delta (${deltaX}, ${deltaY})`);
                
                // Move all selected elements by the same delta
                this.selectedElements.forEach(element => {
                    element.x += deltaX;
                    element.y += deltaY;
                    console.log(`Element ${element.id} moved to (${element.x}, ${element.y})`);
                });
                
                // Send live movement update for all selected elements
                this.selectedElements.forEach(element => {
                    this.sendUpdate('move', {
                        id: element.id,
                        x: element.x,
                        y: element.y,
                        action: 'moving'
                    });
                });
            } else if (this.isSelecting) {
                // Update selection box
                this.selectionBox = {
                    x: Math.min(this.mouse.selectionStart.x, this.mouse.worldX),
                    y: Math.min(this.mouse.selectionStart.y, this.mouse.worldY),
                    width: Math.abs(this.mouse.worldX - this.mouse.selectionStart.x),
                    height: Math.abs(this.mouse.worldY - this.mouse.selectionStart.y)
                };
            } else {
                // Pan camera
                const deltaX = (this.mouse.x - this.mouse.dragStartX) / this.camera.zoom;
                const deltaY = (this.mouse.y - this.mouse.dragStartY) / this.camera.zoom;
                this.camera.x = this.mouse.cameraStartX - deltaX;
                this.camera.y = this.mouse.cameraStartY - deltaY;
            }
            this.render();
        }
    }
    
    handleMouseUp(e) {
        if (this.isSizing && this.sizingShape) {
            this.completeShapeSizing();
            return;
        }
        
        if (this.isSelecting) {
            // Complete selection box
            this.completeSelection();
            this.isSelecting = false;
            this.selectionBox = null;
            this.mouse.selectionStart = null;
        }
        
        if (this.mouse.isDragging && this.selectedElement) {
            // Send update for all selected elements
            this.selectedElements.forEach(element => {
                this.sendUpdate('update', element);
                this.sendUpdate('shapeRelease', { id: element.id });
            });
            this.saveToHistory('Move elements');
        }
        
        if (this.isResizing || this.isRotating) {
            if (this.isRotating) {
                // Send update for all selected elements after rotation
                this.selectedElements.forEach(element => {
                    this.sendUpdate('update', element);
                    this.sendUpdate('shapeRelease', { id: element.id });
                });
                this.saveToHistory('Rotate elements');
                this.lastRotationAngle = null; // Reset rotation tracking
                this.initialElementPositions = null;
                this.initialElementRotations = null;
            } else {
                // Resize only affects primary element
                this.sendUpdate('update', this.selectedElement);
                this.sendUpdate('shapeRelease', { id: this.selectedElement.id });
                this.saveToHistory('Resize element');
            }
        }
        
        this.mouse.isDragging = false;
        this.mouse.dragButton = null;
        this.canvas.style.cursor = '';
        this.isResizing = false;
        this.isRotating = false;
        this.resizeHandle = null;
        this.canvas.className = '';
    }
    
    handleWheel(e) {
        // Skip wheel events if currently pinching (mobile)
        if (this.isPinching) return;
        
        e.preventDefault();
        this.updateMousePosition(e);
        
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(5, this.camera.zoom * zoomFactor));
        
        if (newZoom !== this.camera.zoom) {
            const worldPos = this.screenToWorld(this.mouse.x, this.mouse.y);
            this.camera.zoom = newZoom;
            const newWorldPos = this.screenToWorld(this.mouse.x, this.mouse.y);
            
            this.camera.x += worldPos.x - newWorldPos.x;
            this.camera.y += worldPos.y - newWorldPos.y;
            
            this.render();
        }
    }
    
    drawGrid() {
        const gridSize = this.gridSize * this.camera.zoom;
        
        if (gridSize < 10) return;
        
        this.ctx.strokeStyle = '#e0e0e0';
        this.ctx.lineWidth = 1;
        
        const startX = (-this.camera.x * this.camera.zoom + this.canvas.width / 2) % gridSize;
        const startY = (-this.camera.y * this.camera.zoom + this.canvas.height / 2) % gridSize;
        
        this.ctx.beginPath();
        for (let x = startX; x < this.canvas.width; x += gridSize) {
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
        }
        for (let y = startY; y < this.canvas.height; y += gridSize) {
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
        }
        this.ctx.stroke();
    }
    
    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.drawGrid();
        
        // Sort elements by layer order and z-index within each layer, then render
        const sortedElements = [...this.elements].sort((a, b) => {
            // First sort by layer order
            const layerAIndex = this.layers.findIndex(l => l.id === a.layerId);
            const layerBIndex = this.layers.findIndex(l => l.id === b.layerId);
            if (layerAIndex !== layerBIndex) {
                return layerAIndex - layerBIndex;
            }
            
            // Then sort by z-index within the same layer
            const zIndexA = a.zIndex || 0;
            const zIndexB = b.zIndex || 0;
            return zIndexA - zIndexB;
        });
        
        // Only render visible elements (performance optimization)
        sortedElements.forEach(element => {
            if (!this.isElementVisible(element) || !this.isElementInVisibleLayer(element)) return;
            
            const screenPos = this.worldToScreen(element.x, element.y);
            this.drawElement(element, screenPos);
        });
        
        // Draw user labels for manipulated shapes (one label per user)
        this.drawUserLabelsForShapes();
        
        // Draw sizing shape if in sizing mode
        if (this.isSizing && this.sizingShape) {
            const screenPos = this.worldToScreen(this.sizingShape.x, this.sizingShape.y);
            this.drawSizingShape(this.sizingShape, screenPos);
        }
        
        // Draw selection box
        this.drawSelectionBox();
        
        // Draw multi-selection highlights
        this.drawMultiSelectionHighlights();
        
        // Draw resize handles for selection (single element or multi-element)
        if (this.selectedElements.size > 0) {
            this.drawResizeHandles();
        }
        
        this.drawOtherUsersCursors();
        
        // Draw tooltip (last so it appears on top)
        this.drawTooltip();
    }
    
    // Performance optimization - check if element is visible
    isElementVisible(element) {
        const screenPos = this.worldToScreen(element.x, element.y);
        const margin = Math.max(element.width, element.height) * this.camera.zoom + 100;
        
        return screenPos.x > -margin && screenPos.x < this.canvas.width + margin &&
               screenPos.y > -margin && screenPos.y < this.canvas.height + margin;
    }
    
    // Deselect elements in a specific layer
    deselectElementsInLayer(layerId) {
        const elementsToDeselect = [];
        
        // Find all selected elements in this layer
        this.selectedElements.forEach(element => {
            if (element.layerId === layerId) {
                elementsToDeselect.push(element);
            }
        });
        
        // Remove them from selection
        elementsToDeselect.forEach(element => {
            this.selectedElements.delete(element);
            // Send shape release to server
            this.sendUpdate('shapeRelease', { id: element.id });
        });
        
        // Clear primary selection if it's in this layer
        if (this.selectedElement && this.selectedElement.layerId === layerId) {
            this.selectedElement = null;
        }
        
        // Set new primary selection if any elements are still selected
        if (this.selectedElements.size > 0 && !this.selectedElement) {
            this.selectedElement = Array.from(this.selectedElements)[0];
        }
        
        console.log(`Deselected ${elementsToDeselect.length} elements from layer ${layerId}`);
    }
    
    // Clear selections that are in hidden or locked layers
    clearInvalidSelections() {
        const elementsToDeselect = [];
        
        this.selectedElements.forEach(element => {
            const layer = this.layers.find(l => l.id === element.layerId);
            if (layer && (!layer.visible || layer.locked)) {
                elementsToDeselect.push(element);
            }
        });
        
        elementsToDeselect.forEach(element => {
            this.selectedElements.delete(element);
            this.sendUpdate('shapeRelease', { id: element.id });
        });
        
        // Clear primary selection if it's invalid
        if (this.selectedElement) {
            const layer = this.layers.find(l => l.id === this.selectedElement.layerId);
            if (layer && (!layer.visible || layer.locked)) {
                this.selectedElement = null;
            }
        }
        
        // Set new primary selection if any elements are still selected
        if (this.selectedElements.size > 0 && !this.selectedElement) {
            this.selectedElement = Array.from(this.selectedElements)[0];
        } else if (this.selectedElements.size === 0) {
            this.selectedElement = null;
        }
        
        if (elementsToDeselect.length > 0) {
            console.log(`Cleared ${elementsToDeselect.length} invalid selections`);
        }
    }
    
    // Touch event handlers for mobile support
    handleTouchStart(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 1) {
            // Single touch - handle as potential element selection or panning
            this.updateTouchPosition(e);
            
            // Check for resize handles first (if we have a selected element)
            const resizeHandle = this.getResizeHandle(this.mouse.x, this.mouse.y);
            if (resizeHandle) {
                this.isResizing = true;
                this.resizeHandle = resizeHandle;
                this.canvas.className = 'resizing';
                return;
            }
            
            // Check for rotate handle
            const rotateHandle = this.getRotateHandle(this.mouse.x, this.mouse.y);
            if (rotateHandle) {
                this.isRotating = true;
                this.canvas.className = 'rotating';
                return;
            }
            
            // Check for z-index handles
            const bringForwardHandle = this.getBringForwardHandle(this.mouse.x, this.mouse.y);
            if (bringForwardHandle) {
                this.bringForward();
                return;
            }
            
            const bringBackwardHandle = this.getBringBackwardHandle(this.mouse.x, this.mouse.y);
            if (bringBackwardHandle) {
                this.bringBackward();
                return;
            }
            
            // Check for color picker handle
            const colorPickerHandle = this.getColorPickerHandle(this.mouse.x, this.mouse.y);
            if (colorPickerHandle) {
                this.openColorPicker();
                return;
            }
            
            // Check for text format handle
            const textFormatHandle = this.getTextFormatHandle(this.mouse.x, this.mouse.y);
            if (textFormatHandle) {
                this.openTextFormatPopup();
                return;
            }
            
            // Check for group handle
            const groupHandle = this.getGroupHandle(this.mouse.x, this.mouse.y);
            if (groupHandle) {
                this.toggleGroupSelection();
                return;
            }
            
            // Check for delete handle
            const deleteHandle = this.getDeleteHandle(this.mouse.x, this.mouse.y);
            if (deleteHandle) {
                this.deleteSelectedElements();
                return;
            }
            
            // Handle shape placement on touch devices
            if (this.isPlacing && this.selectedShape) {
                this.placeShape(this.mouse.worldX, this.mouse.worldY);
                return;
            }
            
            // Check if touching an element
            const touchedElement = this.getElementAtPosition(this.mouse.worldX, this.mouse.worldY);
            
            if (touchedElement) {
                // Check if element is in a visible, unlocked layer
                const layer = this.layers.find(l => l.id === touchedElement.layerId);
                if (!layer || !layer.visible || layer.locked) {
                    // Element is not selectable, start panning instead
                    this.selectedElements.clear();
                    this.selectedElement = null;
                    this.hideColorPicker();
        this.hideTextFormatPopup();
                    this.mouse.isDragging = true;
                    this.mouse.dragStartX = this.mouse.x;
                    this.mouse.dragStartY = this.mouse.y;
                    this.mouse.cameraStartX = this.camera.x;
                    this.mouse.cameraStartY = this.camera.y;
                    return;
                }
                
                // Handle element selection and dragging directly
                if (this.selectedElements.has(touchedElement)) {
                    // Element is already selected - prepare for dragging
                    this.selectedElement = touchedElement;
                    this.mouse.isDragging = true;
                    this.mouse.dragStartX = this.mouse.x;
                    this.mouse.dragStartY = this.mouse.y;
                    
                    // Store initial positions for all selected elements
                    this.selectedElements.forEach(element => {
                        if (!element.initialPosition) {
                            element.initialPosition = { x: element.x, y: element.y };
                        }
                    });
                    
                    // Send shape selection notification
                    this.sendUpdate('shapeSelect', { 
                        id: touchedElement.id,
                        action: 'selected'
                    });
                } else {
                    // Select the touched element - check if element is grouped
                    this.selectedElements.clear();
                    
                    if (touchedElement.groupId) {
                        // Select all elements in the same group
                        this.elements.forEach(element => {
                            if (element.groupId === touchedElement.groupId) {
                                this.selectedElements.add(element);
                            }
                        });
                    } else {
                        // Select just this element
                        this.selectedElements.add(touchedElement);
                    }
                    
                    this.selectedElement = touchedElement;
                    this.hideColorPicker();
        this.hideTextFormatPopup();
                    
                    // Prepare for potential dragging
                    this.mouse.isDragging = true;
                    this.mouse.dragStartX = this.mouse.x;
                    this.mouse.dragStartY = this.mouse.y;
                    touchedElement.initialPosition = { x: touchedElement.x, y: touchedElement.y };
                    
                    // Send shape selection notification
                    this.sendUpdate('shapeSelect', { 
                        id: touchedElement.id,
                        action: 'selected'
                    });
                    
                    console.log('Touch selected element:', touchedElement.id);
                }
                this.render();
            } else {
                // Start panning (no element touched)
                this.selectedElements.clear();
                this.selectedElement = null;
                this.hideColorPicker();
        this.hideTextFormatPopup();
                this.mouse.isDragging = true;
                this.mouse.dragStartX = this.mouse.x;
                this.mouse.dragStartY = this.mouse.y;
                this.mouse.cameraStartX = this.camera.x;
                this.mouse.cameraStartY = this.camera.y;
            }
        } else if (this.touches.length === 2) {
            // Two finger touch - prepare for pinch zoom
            this.isPinching = true;
            this.lastTouchDistance = this.getTouchDistance(this.touches[0], this.touches[1]);
            this.lastTouchCenter = this.getTouchCenter(this.touches[0], this.touches[1]);
            
            // Clear any existing selection or dragging
            this.mouse.isDragging = false;
        this.mouse.dragButton = null;
        this.canvas.style.cursor = '';
            this.selectedElement = null;
            this.selectedElements.clear();
        }
    }
    
    handleTouchMove(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 1) {
            this.updateTouchPosition(e);
            
            if (this.isResizing && this.selectedElement && this.resizeHandle) {
                // Resizing element
                this.resizeElement(this.resizeHandle);
                // Send live resize update
                this.sendUpdate('move', {
                    id: this.selectedElement.id,
                    x: this.selectedElement.x,
                    y: this.selectedElement.y,
                    width: this.selectedElement.width,
                    height: this.selectedElement.height,
                    action: 'resizing'
                });
                this.render();
                return;
            }
            
            if (this.isRotating && this.selectedElement) {
                // Rotating elements
                this.rotateElements();
                // Send live rotate update for all selected elements
                this.selectedElements.forEach(element => {
                    this.sendUpdate('move', {
                        id: element.id,
                        x: element.x,
                        y: element.y,
                        rotation: element.rotation,
                        action: 'rotating'
                    });
                });
                this.render();
                return;
            }
            
            if (this.selectedElement && this.mouse.isDragging) {
                // Moving selected element(s) directly
                const deltaX = (this.mouse.x - this.mouse.dragStartX) / this.camera.zoom;
                const deltaY = (this.mouse.y - this.mouse.dragStartY) / this.camera.zoom;
                
                this.selectedElements.forEach(element => {
                    if (element.initialPosition) {
                        element.x = element.initialPosition.x + deltaX;
                        element.y = element.initialPosition.y + deltaY;
                        
                        // Apply snap to grid if enabled
                        if (this.snapToGrid) {
                            element.x = Math.round(element.x / this.gridSize) * this.gridSize;
                            element.y = Math.round(element.y / this.gridSize) * this.gridSize;
                        }
                        
                        // Send live movement update
                        this.sendUpdate('move', {
                            id: element.id,
                            x: element.x,
                            y: element.y,
                            action: 'moving'
                        });
                    }
                });
                
                this.render();
            } else if (this.mouse.isDragging) {
                // Panning the canvas
                const deltaX = (this.mouse.x - this.mouse.dragStartX) / this.camera.zoom;
                const deltaY = (this.mouse.y - this.mouse.dragStartY) / this.camera.zoom;
                this.camera.x = this.mouse.cameraStartX - deltaX;
                this.camera.y = this.mouse.cameraStartY - deltaY;
                this.render();
            }
        } else if (this.touches.length === 2 && this.isPinching) {
            // Pinch zoom
            const currentDistance = this.getTouchDistance(this.touches[0], this.touches[1]);
            const currentCenter = this.getTouchCenter(this.touches[0], this.touches[1]);
            
            // Calculate zoom
            const zoomFactor = currentDistance / this.lastTouchDistance;
            const newZoom = Math.max(0.1, Math.min(5, this.camera.zoom * zoomFactor));
            
            if (newZoom !== this.camera.zoom) {
                // Get world position of zoom center
                const rect = this.canvas.getBoundingClientRect();
                const centerX = currentCenter.x - rect.left;
                const centerY = currentCenter.y - rect.top;
                
                const worldPos = this.screenToWorld(centerX, centerY);
                
                this.camera.zoom = newZoom;
                
                const newWorldPos = this.screenToWorld(centerX, centerY);
                this.camera.x += worldPos.x - newWorldPos.x;
                this.camera.y += worldPos.y - newWorldPos.y;
                
                this.render();
            }
            
            // Update for next frame
            this.lastTouchDistance = currentDistance;
            this.lastTouchCenter = currentCenter;
        }
    }
    
    handleTouchEnd(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);
        
        if (this.touches.length === 0) {
            // All touches ended
            if (this.isResizing || this.isRotating) {
                // Finish resizing/rotating
                if (this.isRotating) {
                    // Send update for all selected elements after rotation
                    this.selectedElements.forEach(element => {
                        this.sendUpdate('update', element);
                        this.sendUpdate('shapeRelease', { id: element.id });
                    });
                    this.saveToHistory('Rotate elements');
                    this.lastRotationAngle = null; // Reset rotation tracking
                this.initialElementPositions = null;
                this.initialElementRotations = null;
                } else if (this.selectedElement) {
                    // Resize only affects primary element
                    this.sendUpdate('update', this.selectedElement);
                    this.sendUpdate('shapeRelease', { id: this.selectedElement.id });
                    this.saveToHistory('Resize element');
                }
                this.isResizing = false;
                this.isRotating = false;
                this.resizeHandle = null;
                this.canvas.className = '';
            } else if (this.selectedElement && this.mouse.isDragging) {
                // Finish element movement - send final updates and save to history
                this.selectedElements.forEach(element => {
                    this.sendUpdate('update', element);
                    this.sendUpdate('shapeRelease', { id: element.id });
                    // Clean up initial position
                    delete element.initialPosition;
                });
                this.saveToHistory('Move elements');
                this.mouse.isDragging = false;
                this.mouse.dragButton = null;
                this.canvas.style.cursor = '';
                console.log('Touch move completed for', this.selectedElements.size, 'elements');
            } else {
                // Finish panning
                this.mouse.isDragging = false;
        this.mouse.dragButton = null;
        this.canvas.style.cursor = '';
            }
            this.isPinching = false;
        } else if (this.touches.length === 1 && this.isPinching) {
            // One finger left, switch from pinch to pan
            this.isPinching = false;
            this.updateTouchPosition(e);
            this.mouse.isDragging = true;
            this.mouse.dragStartX = this.mouse.x;
            this.mouse.dragStartY = this.mouse.y;
            this.mouse.cameraStartX = this.camera.x;
            this.mouse.cameraStartY = this.camera.y;
        }
    }
    
    // Helper functions for touch handling
    getTouchDistance(touch1, touch2) {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    getTouchCenter(touch1, touch2) {
        return {
            x: (touch1.clientX + touch2.clientX) / 2,
            y: (touch1.clientY + touch2.clientY) / 2
        };
    }
    
    drawElement(element, screenPos) {
        // Check for animation state
        const animState = this.getElementAnimationState(element);
        if (animState && !animState.visible) {
            return; // Element not yet visible in animation
        }
        
        this.ctx.save();
        
        // Apply animation transformations if animating
        if (animState) {
            this.ctx.globalAlpha = animState.opacity;
            this.ctx.translate(screenPos.x + animState.offsetX, screenPos.y + animState.offsetY);
            this.ctx.rotate(element.rotation || 0);
            this.ctx.scale(this.camera.zoom * animState.scale, this.camera.zoom * animState.scale);
        } else {
            this.ctx.translate(screenPos.x, screenPos.y);
            this.ctx.rotate(element.rotation || 0);
            this.ctx.scale(this.camera.zoom, this.camera.zoom);
        }
        
        this.ctx.fillStyle = element.color;
        if (element === this.selectedElement) {
            this.ctx.strokeStyle = element.groupId ? '#6f42c1' : '#007bff'; // Purple for grouped, blue for normal
            this.ctx.lineWidth = 3;
        } else {
            this.ctx.strokeStyle = '#333';
            this.ctx.lineWidth = 1;
        }
        
        switch (element.shape) {
            case 'square':
            case 'rectangle':
                this.ctx.fillRect(-element.width/2, -element.height/2, element.width, element.height);
                this.ctx.strokeRect(-element.width/2, -element.height/2, element.width, element.height);
                break;
            case 'circle':
                this.ctx.beginPath();
                this.ctx.arc(0, 0, element.width/2, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
                break;
            case 'triangle':
                this.ctx.beginPath();
                this.ctx.moveTo(0, -element.height/2);
                this.ctx.lineTo(-element.width/2, element.height/2);
                this.ctx.lineTo(element.width/2, element.height/2);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
                break;
            case 'star':
                this.drawStar(0, 0, 5, element.width/2, element.width/4);
                this.ctx.fill();
                this.ctx.stroke();
                break;
            case 'image':
                this.drawImage(element);
                break;
            case 'text':
                this.drawText(element);
                break;
        }
        
        // Only render text labels for non-text elements
        if (element.text && element.shape !== 'text') {
            this.ctx.fillStyle = '#333';
            this.ctx.font = '14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(element.text, 0, 5);
        }
        
        this.ctx.restore();
    }
    
    drawImage(element) {
        // Images are cached for performance
        if (!this.imageCache) {
            this.imageCache = new Map();
        }
        
        const cacheKey = element.filename;
        let img = this.imageCache.get(cacheKey);
        
        if (!img) {
            // Create new image and cache it
            img = new Image();
            img.onload = () => {
                // Re-render when image loads
                this.render();
            };
            img.onerror = () => {
                console.error('Failed to load image:', element.filename);
            };
            img.src = `/api/uploads/${this.roomName}/${element.filename}`;
            this.imageCache.set(cacheKey, img);
        }
        
        // Only draw if image is loaded
        if (img.complete && img.naturalWidth > 0) {
            this.ctx.drawImage(img, -element.width/2, -element.height/2, element.width, element.height);
            
            // Draw border if selected
            if (element === this.selectedElement) {
                this.ctx.strokeStyle = element.groupId ? '#6f42c1' : '#007bff'; // Purple for grouped, blue for normal
                this.ctx.lineWidth = 3;
                this.ctx.strokeRect(-element.width/2, -element.height/2, element.width, element.height);
            }
        } else {
            // Draw placeholder while loading
            this.ctx.fillStyle = '#f0f0f0';
            this.ctx.fillRect(-element.width/2, -element.height/2, element.width, element.height);
            this.ctx.strokeStyle = '#ccc';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(-element.width/2, -element.height/2, element.width, element.height);
            
            // Draw loading text
            this.ctx.fillStyle = '#666';
            this.ctx.font = '14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('Loading...', 0, 0);
        }
    }
    
    drawText(element) {
        // Set font properties with new formatting support
        const fontSize = element.fontSize || 20;
        const fontFamily = element.fontFamily || 'Arial';
        const fontWeight = element.fontWeight || 'normal';
        const fontStyle = element.fontStyle || 'normal';
        
        this.ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        const text = element.text || 'Double-click to edit';
        const lines = text.split('\n');
        const lineHeight = fontSize * 1.2; // Add some line spacing
        
        // Draw text with the element's color
        this.ctx.fillStyle = element.color;
        
        // Calculate starting Y position to center all lines
        const totalHeight = lines.length * lineHeight;
        const startY = -(totalHeight / 2) + (lineHeight / 2);
        
        // Draw each line
        lines.forEach((line, index) => {
            const y = startY + (index * lineHeight);
            this.ctx.fillText(line, 0, y);
            
            // Draw strikethrough if enabled
            if (element.textDecoration === 'line-through') {
                const textWidth = this.ctx.measureText(line).width;
                this.ctx.strokeStyle = element.color;
                this.ctx.lineWidth = Math.max(1, fontSize * 0.05);
                this.ctx.beginPath();
                this.ctx.moveTo(-textWidth/2, y);
                this.ctx.lineTo(textWidth/2, y);
                this.ctx.stroke();
            }
        });
        
        // Draw cursor if this element is being edited
        if (this.isEditingText && this.editingTextElement === element && this.textCursorVisible) {
            this.drawTextCursor(element, text, lines, lineHeight, startY);
        }
        
        // Draw border if selected
        if (element === this.selectedElement) {
            this.ctx.strokeStyle = element.groupId ? '#6f42c1' : '#007bff'; // Purple for grouped, blue for normal
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(-element.width/2, -element.height/2, element.width, element.height);
        }
    }
    
    drawTextCursor(element, text, lines, lineHeight, startY) {
        // Set font properties to match text
        const fontSize = element.fontSize || 20;
        const fontFamily = element.fontFamily || 'Arial';
        const fontWeight = element.fontWeight || 'normal';
        const fontStyle = element.fontStyle || 'normal';
        
        this.ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // Find which line the cursor is on
        let currentPos = 0;
        let currentLine = 0;
        let cursorLinePos = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const lineLength = lines[i].length + 1; // +1 for newline character
            if (currentPos + lineLength > this.textCursorPosition) {
                currentLine = i;
                cursorLinePos = this.textCursorPosition - currentPos;
                break;
            }
            currentPos += lineLength;
        }
        
        // Handle case where cursor is at the very end
        if (currentLine >= lines.length) {
            currentLine = lines.length - 1;
            cursorLinePos = lines[currentLine].length;
        }
        
        // Get text before cursor on current line
        const currentLineText = lines[currentLine] || '';
        const textBeforeCursor = currentLineText.slice(0, cursorLinePos);
        
        // Measure text width to position cursor
        const currentLineWidth = this.ctx.measureText(currentLineText).width;
        const textBeforeWidth = this.ctx.measureText(textBeforeCursor).width;
        
        // Calculate cursor position (adjust for center alignment)
        const cursorX = -currentLineWidth / 2 + textBeforeWidth;
        const cursorY = startY + (currentLine * lineHeight);
        
        // Draw cursor line
        this.ctx.strokeStyle = element.color;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(cursorX, cursorY - (element.fontSize || 20) / 2);
        this.ctx.lineTo(cursorX, cursorY + (element.fontSize || 20) / 2);
        this.ctx.stroke();
    }
    
    drawSizingShape(element, screenPos) {
        // Draw the sizing shape with a dashed outline to indicate it's being created
        this.ctx.save();
        this.ctx.translate(screenPos.x, screenPos.y);
        this.ctx.rotate(element.rotation || 0);
        this.ctx.scale(this.camera.zoom, this.camera.zoom);
        
        // Semi-transparent fill
        this.ctx.fillStyle = element.color + '80'; // Add transparency
        this.ctx.strokeStyle = '#007bff';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]); // Dashed line to show it's being sized
        
        switch (element.shape) {
            case 'square':
            case 'rectangle':
                this.ctx.fillRect(-element.width/2, -element.height/2, element.width, element.height);
                this.ctx.strokeRect(-element.width/2, -element.height/2, element.width, element.height);
                break;
            case 'circle':
                this.ctx.beginPath();
                this.ctx.arc(0, 0, element.width/2, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
                break;
            case 'triangle':
                this.ctx.beginPath();
                this.ctx.moveTo(0, -element.height/2);
                this.ctx.lineTo(-element.width/2, element.height/2);
                this.ctx.lineTo(element.width/2, element.height/2);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
                break;
            case 'star':
                this.drawStar(0, 0, 5, element.width/2, element.width/4);
                this.ctx.fill();
                this.ctx.stroke();
                break;
            case 'text':
                // Draw background rectangle for text
                this.ctx.fillRect(-element.width/2, -element.height/2, element.width, element.height);
                this.ctx.strokeRect(-element.width/2, -element.height/2, element.width, element.height);
                
                // Draw text preview
                this.ctx.fillStyle = element.color;
                const fontSize = element.fontSize || 20;
                const fontFamily = element.fontFamily || 'Arial';
                const fontWeight = element.fontWeight || 'normal';
                const fontStyle = element.fontStyle || 'normal';
                
                this.ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(element.text || 'Double-click to edit', 0, 0);
                break;
        }
        
        // Show dimensions text
        this.ctx.setLineDash([]); // Reset dash
        this.ctx.fillStyle = '#007bff';
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${Math.round(element.width)} × ${Math.round(element.height)}`, 0, element.height/2 + 20);
        
        this.ctx.restore();
    }
    
    drawStar(x, y, spikes, outerRadius, innerRadius) {
        let rot = Math.PI / 2 * 3;
        let step = Math.PI / spikes;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x, y - outerRadius);
        
        for (let i = 0; i < spikes; i++) {
            let x1 = x + Math.cos(rot) * outerRadius;
            let y1 = y + Math.sin(rot) * outerRadius;
            this.ctx.lineTo(x1, y1);
            rot += step;
            
            x1 = x + Math.cos(rot) * innerRadius;
            y1 = y + Math.sin(rot) * innerRadius;
            this.ctx.lineTo(x1, y1);
            rot += step;
        }
        
        this.ctx.lineTo(x, y - outerRadius);
        this.ctx.closePath();
    }
    
    selectShape(shape) {
        if (!this.canUserWrite()) {
            this.showReadOnlyError();
            return;
        }
        
        // If clicking the same shape button, toggle off placement mode
        const shapeBtn = document.querySelector(`[data-shape="${shape}"]`);
        if (shapeBtn.classList.contains('active')) {
            this.exitPlacementMode();
            return;
        }
        
        document.querySelectorAll('.shape-btn').forEach(btn => btn.classList.remove('active'));
        shapeBtn.classList.add('active');
        
        this.selectedShape = shape;
        this.mode = 'place';
        this.isPlacing = true;
        this.canvas.className = 'placing';
        
        const instruction = this.isMobileDevice() ? 
            `Tap to place ${shape} (tap button again to exit)` : 
            `Click and drag to size ${shape}, or click to place default size (click button again to exit)`;
        document.getElementById('mode').textContent = instruction;
    }
    
    placeShape(x, y) {
        const element = {
            id: Date.now() + Math.random(), // Ensure uniqueness
            x: x,
            y: y,
            width: 80,
            height: 80,
            rotation: 0,
            color: this.getRandomColor(),
            shape: this.selectedShape,
            text: '',
            layerId: this.activeLayerId
        };
        
        if (this.selectedShape === 'rectangle') {
            element.width = 120;
            element.height = 60;
        } else if (this.selectedShape === 'text') {
            element.text = 'Double-click to edit';
            element.fontSize = 20;
            element.fontFamily = 'Arial';
            element.width = 200;
            element.height = 30;
        }
        
        this.elements.push(element);
        this.addElementToLayer(element);
        this.sendUpdate('add', element);
        this.saveToHistory(`Add ${this.selectedShape}`);
        
        // Exit placement mode and select the new element
        this.exitPlacementMode();
        this.selectedElement = element;
        this.selectedElements.clear();
        this.selectedElements.add(element);
        
        // Send shape selection to others
        this.sendUpdate('shapeSelect', { 
            id: element.id,
            action: 'selected'
        });
        
        this.render();
    }
    
    startShapeSizing(x, y) {
        // Create a temporary shape that will be sized by dragging
        this.sizingShape = {
            id: Date.now() + Math.random(), // Ensure uniqueness
            x: x, // Start position
            y: y, // Start position
            startX: x, // Remember start position
            startY: y, // Remember start position
            width: 0, // Will be calculated based on drag
            height: 0, // Will be calculated based on drag
            rotation: 0,
            color: this.getRandomColor(),
            shape: this.selectedShape,
            text: '',
            layerId: this.activeLayerId
        };
        
        this.isSizing = true;
        this.canvas.className = 'placing';
        document.getElementById('mode').textContent = `Drag to size ${this.selectedShape} (or release to place default size)`;
    }
    
    updateShapeSize() {
        if (!this.sizingShape) return;
        
        // Calculate width and height from start position to current mouse position
        const startX = this.sizingShape.startX;
        const startY = this.sizingShape.startY;
        const currentX = this.mouse.worldX;
        const currentY = this.mouse.worldY;
        
        // Calculate width and height (absolute values)
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        
        // Set minimum size
        const minSize = 10;
        this.sizingShape.width = Math.max(width, minSize);
        this.sizingShape.height = Math.max(height, minSize);
        
        // Update position to be the center between start and current positions
        this.sizingShape.x = (startX + currentX) / 2;
        this.sizingShape.y = (startY + currentY) / 2;
        
        // Apply snap to grid if enabled
        if (this.snapToGrid) {
            this.sizingShape.x = Math.round(this.sizingShape.x / this.gridSize) * this.gridSize;
            this.sizingShape.y = Math.round(this.sizingShape.y / this.gridSize) * this.gridSize;
            this.sizingShape.width = Math.round(this.sizingShape.width / this.gridSize) * this.gridSize;
            this.sizingShape.height = Math.round(this.sizingShape.height / this.gridSize) * this.gridSize;
        }
    }
    
    completeShapeSizing() {
        if (!this.sizingShape) return;
        
        // If shape is too small (user did a quick click), place default size shape
        if (this.sizingShape.width < 10 || this.sizingShape.height < 10) {
            this.placeShape(this.sizingShape.startX, this.sizingShape.startY);
            this.isSizing = false;
            this.sizingShape = null;
            return;
        }
        
        // Create the final element
        const element = {
            id: this.sizingShape.id,
            x: this.sizingShape.x,
            y: this.sizingShape.y,
            width: this.sizingShape.width,
            height: this.sizingShape.height,
            rotation: this.sizingShape.rotation,
            color: this.sizingShape.color,
            shape: this.sizingShape.shape,
            text: this.sizingShape.text,
            layerId: this.sizingShape.layerId
        };
        
        // Add to elements and layer
        this.elements.push(element);
        this.addElementToLayer(element);
        this.sendUpdate('add', element);
        this.saveToHistory(`Add ${this.selectedShape}`);
        
        // Clean up sizing state
        this.isSizing = false;
        this.sizingShape = null;
        
        // Exit placement mode and select the new element
        this.exitPlacementMode();
        this.selectedElement = element;
        this.selectedElements.clear();
        this.selectedElements.add(element);
        
        // Send shape selection to others
        this.sendUpdate('shapeSelect', { 
            id: element.id,
            action: 'selected'
        });
        
        this.render();
    }
    
    cancelShapeSizing() {
        this.isSizing = false;
        this.sizingShape = null;
        this.canvas.className = 'placing';
        
        const instruction = this.isMobileDevice() ? 
            `Tap to place ${this.selectedShape} (tap button again to exit)` : 
            `Click and drag to size ${this.selectedShape}, or click to place default size (click button again to exit)`;
        document.getElementById('mode').textContent = instruction;
        
        this.render();
    }
    
    exitPlacementMode() {
        document.querySelectorAll('.shape-btn').forEach(btn => btn.classList.remove('active'));
        this.selectedShape = null;
        this.mode = 'select';
        this.isPlacing = false;
        this.isSizing = false;
        this.sizingShape = null;
        this.canvas.className = '';
        document.getElementById('mode').textContent = 'Select a shape or click existing shapes to edit';
    }
    
    getRandomColor() {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF'];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    getElementAtPosition(worldX, worldY) {
        // Sort elements by layer order and z-index within each layer (same as rendering order)
        const sortedElements = [...this.elements].sort((a, b) => {
            // First sort by layer order
            const layerAIndex = this.layers.findIndex(l => l.id === a.layerId);
            const layerBIndex = this.layers.findIndex(l => l.id === b.layerId);
            if (layerAIndex !== layerBIndex) {
                return layerAIndex - layerBIndex;
            }
            
            // Then sort by z-index within the same layer
            const zIndexA = a.zIndex || 0;
            const zIndexB = b.zIndex || 0;
            return zIndexA - zIndexB;
        });
        
        // Check elements from top to bottom (reverse order of rendering)
        for (let i = sortedElements.length - 1; i >= 0; i--) {
            const element = sortedElements[i];
            
            // Skip elements in hidden or locked layers
            const layer = this.layers.find(l => l.id === element.layerId);
            if (layer && (!layer.visible || layer.locked)) {
                continue;
            }
            
            if (element.shape === 'circle') {
                const dx = worldX - element.x;
                const dy = worldY - element.y;
                const radius = element.width / 2;
                if (dx * dx + dy * dy <= radius * radius) {
                    return element;
                }
            } else {
                if (worldX >= element.x - element.width / 2 &&
                    worldX <= element.x + element.width / 2 &&
                    worldY >= element.y - element.height / 2 &&
                    worldY <= element.y + element.height / 2) {
                    return element;
                }
            }
        }
        return null;
    }
    
    drawResizeHandles() {
        if (this.selectedElements.size === 0) return;
        
        const isMobile = window.innerWidth <= 768;
        const handleSize = isMobile ? 16 : 8;
        const rotateRadius = isMobile ? 12 : 6;
        const deleteSize = isMobile ? 20 : 12;
        
        if (this.selectedElements.size === 1) {
            // Single element - draw resize handles, rotation handle, and delete handle
            const element = this.selectedElement;
            const screenPos = this.worldToScreen(element.x, element.y);
            const w = element.width * this.camera.zoom;
            const h = element.height * this.camera.zoom;
            
            const left = screenPos.x - w/2;
            const right = screenPos.x + w/2;
            const top = screenPos.y - h/2;
            const bottom = screenPos.y + h/2;
            
            this.ctx.fillStyle = '#007bff';
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            
            // Draw corner handles
            this.drawHandle(left - handleSize/2, top - handleSize/2, handleSize);
            this.drawHandle(right - handleSize/2, top - handleSize/2, handleSize);
            this.drawHandle(left - handleSize/2, bottom - handleSize/2, handleSize);
            this.drawHandle(right - handleSize/2, bottom - handleSize/2, handleSize);
            
            // Draw rotation handle
            const rotateY = top - (isMobile ? 30 : 20);
            const isHoveringRotate = this.getRotateHandle(this.mouse.x, this.mouse.y);
            
            // Add glow effect when hovering
            if (isHoveringRotate) {
                this.ctx.shadowColor = '#28a745';
                this.ctx.shadowBlur = 8;
                this.ctx.shadowOffsetX = 0;
                this.ctx.shadowOffsetY = 0;
            }
            
            this.ctx.fillStyle = isHoveringRotate ? '#34ce57' : '#28a745';
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(screenPos.x, rotateY, rotateRadius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
            
            // Reset shadow
            this.ctx.shadowColor = 'transparent';
            this.ctx.shadowBlur = 0;
            
            // Draw z-index and delete controls in a vertical column
            const iconSize = isMobile ? 20 : 14;
            const iconSpacing = isMobile ? 4 : 3;
            const iconColumn = right + (isMobile ? 15 : 12);
            
            // Calculate positions for all icons (add text formatting for text elements)
            const isTextElement = element.shape === 'text';
            const iconCount = isTextElement ? 5 : 4;
            const totalHeight = iconSize * iconCount + iconSpacing * (iconCount - 1);
            const startY = top - (isMobile ? 5 : 2);
            
            const upArrowX = iconColumn;
            const upArrowY = startY;
            const colorPickerX = iconColumn;
            const colorPickerY = startY + iconSize + iconSpacing;
            
            // Text formatting icon for text elements
            let textFormatX, textFormatY, deleteX, deleteY, downArrowX, downArrowY;
            if (isTextElement) {
                textFormatX = iconColumn;
                textFormatY = startY + (iconSize + iconSpacing) * 2;
                deleteX = iconColumn;
                deleteY = startY + (iconSize + iconSpacing) * 3;
                downArrowX = iconColumn;
                downArrowY = startY + (iconSize + iconSpacing) * 4;
            } else {
                deleteX = iconColumn;
                deleteY = startY + (iconSize + iconSpacing) * 2;
                downArrowX = iconColumn;
                downArrowY = startY + (iconSize + iconSpacing) * 3;
            }
            
            // Common styling
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 2;
            
            // Bring forward arrow (up) - Blue theme
            this.ctx.fillStyle = '#007bff';
            this.ctx.fillRect(upArrowX, upArrowY, iconSize, iconSize);
            this.ctx.strokeRect(upArrowX, upArrowY, iconSize, iconSize);
            
            // Draw up arrow icon
            this.ctx.fillStyle = '#fff';
            this.ctx.font = `bold ${isMobile ? 12 : 10}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('▲', upArrowX + iconSize/2, upArrowY + iconSize/2);
            
            // Color picker handle - Orange theme
            this.ctx.fillStyle = '#fd7e14';
            this.ctx.fillRect(colorPickerX, colorPickerY, iconSize, iconSize);
            this.ctx.strokeRect(colorPickerX, colorPickerY, iconSize, iconSize);
            
            // Draw color picker icon (paint palette)
            this.ctx.fillStyle = '#fff';
            const colorScale = isMobile ? 1.2 : 0.8;
            const colorCenterX = colorPickerX + iconSize/2;
            const colorCenterY = colorPickerY + iconSize/2;
            
            // Draw palette outline (oval)
            this.ctx.beginPath();
            this.ctx.ellipse(colorCenterX, colorCenterY, 5 * colorScale, 4 * colorScale, 0, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw palette hole (thumb hole)
            this.ctx.fillStyle = '#fd7e14';
            this.ctx.beginPath();
            this.ctx.arc(colorCenterX + 2 * colorScale, colorCenterY - 1 * colorScale, 1.5 * colorScale, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw small color dots on palette
            this.ctx.fillStyle = '#fff';
            const dotSize = 0.8 * colorScale;
            this.ctx.beginPath();
            this.ctx.arc(colorCenterX - 2 * colorScale, colorCenterY - 1 * colorScale, dotSize, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.beginPath();
            this.ctx.arc(colorCenterX, colorCenterY + 1.5 * colorScale, dotSize, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.beginPath();
            this.ctx.arc(colorCenterX - 1 * colorScale, colorCenterY + 1 * colorScale, dotSize, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Text formatting handle - Purple theme (only for text elements)
            if (isTextElement) {
                this.ctx.fillStyle = '#6f42c1';
                this.ctx.fillRect(textFormatX, textFormatY, iconSize, iconSize);
                this.ctx.strokeRect(textFormatX, textFormatY, iconSize, iconSize);
                
                // Draw "T" icon for text formatting
                this.ctx.fillStyle = '#fff';
                this.ctx.font = `bold ${isMobile ? 14 : 12}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('T', textFormatX + iconSize/2, textFormatY + iconSize/2);
            }
            
            // Delete handle (trash icon) - Red theme
            this.ctx.fillStyle = '#dc3545';
            this.ctx.fillRect(deleteX, deleteY, iconSize, iconSize);
            this.ctx.strokeRect(deleteX, deleteY, iconSize, iconSize);
            
            // Draw trash icon with better proportions
            this.ctx.fillStyle = '#fff';
            const trashScale = isMobile ? 1.4 : 1.0;
            const trashCenterX = deleteX + iconSize/2;
            const trashCenterY = deleteY + iconSize/2;
            
            // Trash can body
            const trashWidth = 8 * trashScale;
            const trashHeight = 6 * trashScale;
            const trashX = trashCenterX - trashWidth/2;
            const trashY = trashCenterY - trashHeight/2 + 1 * trashScale;
            this.ctx.fillRect(trashX, trashY, trashWidth, trashHeight);
            
            // Trash can lid
            const lidWidth = 10 * trashScale;
            const lidHeight = 2 * trashScale;
            const lidX = trashCenterX - lidWidth/2;
            const lidY = trashY - 1 * trashScale;
            this.ctx.fillRect(lidX, lidY, lidWidth, lidHeight);
            
            // Trash can handle
            const handleWidth = 4 * trashScale;
            const handleHeight = 1 * trashScale;
            const handleX = trashCenterX - handleWidth/2;
            const handleY = lidY - 2 * trashScale;
            this.ctx.fillRect(handleX, handleY, handleWidth, handleHeight);
            
            // Bring backward arrow (down) - Gray theme
            this.ctx.fillStyle = '#6c757d';
            this.ctx.fillRect(downArrowX, downArrowY, iconSize, iconSize);
            this.ctx.strokeRect(downArrowX, downArrowY, iconSize, iconSize);
            
            // Draw down arrow icon
            this.ctx.fillStyle = '#fff';
            this.ctx.fillText('▼', downArrowX + iconSize/2, downArrowY + iconSize/2);
        } else {
            // Multi-element selection - draw rotation handle at selection center
            const selectionBounds = this.getSelectionBounds();
            const centerScreen = this.worldToScreen(selectionBounds.centerX, selectionBounds.centerY);
            
            // Draw rotation handle at selection center
            const rotateDistance = isMobile ? 30 : 20;
            const rotateX = centerScreen.x;
            const rotateY = centerScreen.y - selectionBounds.height * this.camera.zoom / 2 - rotateDistance;
            const isHoveringRotate = this.getRotateHandle(this.mouse.x, this.mouse.y);
            
            // Add glow effect when hovering
            if (isHoveringRotate) {
                this.ctx.shadowColor = '#28a745';
                this.ctx.shadowBlur = 8;
                this.ctx.shadowOffsetX = 0;
                this.ctx.shadowOffsetY = 0;
            }
            
            this.ctx.fillStyle = isHoveringRotate ? '#34ce57' : '#28a745';
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 2;
            
            this.ctx.beginPath();
            this.ctx.arc(rotateX, rotateY, rotateRadius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
            
            // Reset shadow
            this.ctx.shadowColor = 'transparent';
            this.ctx.shadowBlur = 0;
            
            // Check if any selected elements are grouped
            const hasGroupedElements = Array.from(this.selectedElements).some(element => element.groupId);
            const allElementsGrouped = Array.from(this.selectedElements).every(element => element.groupId);
            
            // Draw group/ungroup handle for multi-selection
            const groupIconSize = isMobile ? 20 : 14;
            const groupX = centerScreen.x + selectionBounds.width * this.camera.zoom / 2 + (isMobile ? 20 : 15);
            const groupY = centerScreen.y - selectionBounds.height * this.camera.zoom / 2 - (isMobile ? 10 : 5);
            
            // Group icon - Purple theme for group, Orange theme for ungroup
            this.ctx.fillStyle = allElementsGrouped ? '#fd7e14' : '#6f42c1';
            this.ctx.fillRect(groupX, groupY, groupIconSize, groupIconSize);
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(groupX, groupY, groupIconSize, groupIconSize);
            
            // Draw group/ungroup icon
            this.ctx.fillStyle = '#fff';
            this.ctx.font = `bold ${isMobile ? 12 : 10}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            if (allElementsGrouped) {
                // Draw ungroup icon (disconnected squares)
                const iconScale = isMobile ? 1.2 : 0.8;
                const centerX = groupX + groupIconSize/2;
                const centerY = groupY + groupIconSize/2;
                
                // Draw two small squares
                this.ctx.fillRect(centerX - 5 * iconScale, centerY - 3 * iconScale, 4 * iconScale, 4 * iconScale);
                this.ctx.fillRect(centerX + 1 * iconScale, centerY - 1 * iconScale, 4 * iconScale, 4 * iconScale);
            } else {
                // Draw group icon (connected squares)
                this.ctx.fillText('⊞', groupX + groupIconSize/2, groupY + groupIconSize/2);
            }
            
            // Draw delete handle for multi-selection
            this.ctx.fillStyle = '#dc3545';
            const deleteX = groupX + groupIconSize + (isMobile ? 8 : 5);
            const deleteY = groupY;
            this.ctx.fillRect(deleteX, deleteY, deleteSize, deleteSize);
            this.ctx.strokeRect(deleteX, deleteY, deleteSize, deleteSize);
            
            // Draw trash icon details
            this.ctx.fillStyle = '#fff';
            const iconScale = isMobile ? 1.6 : 1;
            this.ctx.fillRect(deleteX + 2 * iconScale, deleteY + 3 * iconScale, 8 * iconScale, 1 * iconScale);
            this.ctx.fillRect(deleteX + 3 * iconScale, deleteY + 5 * iconScale, 2 * iconScale, 5 * iconScale);
            this.ctx.fillRect(deleteX + 7 * iconScale, deleteY + 5 * iconScale, 2 * iconScale, 5 * iconScale);
        }
    }
    
    drawHandle(x, y, size) {
        this.ctx.fillRect(x, y, size, size);
        this.ctx.strokeRect(x, y, size, size);
    }
    
    showResizeHandles() {
        // This method is now handled by drawResizeHandles in render()
    }
    
    hideResizeHandles() {
        // This method is now handled by the render() method
    }
    
    updateResizeHandles() {
        // This method is now handled by the render() method
    }
    
    getResizeHandle(screenX, screenY) {
        // Only allow resize for single, non-grouped elements
        if (this.selectedElements.size !== 1) return null;
        if (!this.selectedElement) return null;
        
        // Don't allow resize for grouped elements
        if (this.selectedElement.groupId) return null;
        
        // Don't allow resize handles if element is in hidden or locked layer
        if (!this.isElementInVisibleLayer(this.selectedElement)) return null;
        
        const layer = this.layers.find(l => l.id === this.selectedElement.layerId);
        if (layer && layer.locked) return null;
        
        const screenPos = this.worldToScreen(this.selectedElement.x, this.selectedElement.y);
        const w = this.selectedElement.width * this.camera.zoom;
        const h = this.selectedElement.height * this.camera.zoom;
        
        // Larger handles for mobile
        const isMobile = window.innerWidth <= 768;
        const handleSize = isMobile ? 16 : 8;
        const left = screenPos.x - w/2;
        const right = screenPos.x + w/2;
        const top = screenPos.y - h/2;
        const bottom = screenPos.y + h/2;
        
        // Check each corner handle
        if (this.isPointInRect(screenX, screenY, left - handleSize/2, top - handleSize/2, handleSize, handleSize)) return 'nw';
        if (this.isPointInRect(screenX, screenY, right - handleSize/2, top - handleSize/2, handleSize, handleSize)) return 'ne';
        if (this.isPointInRect(screenX, screenY, left - handleSize/2, bottom - handleSize/2, handleSize, handleSize)) return 'sw';
        if (this.isPointInRect(screenX, screenY, right - handleSize/2, bottom - handleSize/2, handleSize, handleSize)) return 'se';
        
        return null;
    }
    
    getRotateHandle(screenX, screenY) {
        if (this.selectedElements.size === 0) return null;
        
        const isMobile = window.innerWidth <= 768;
        const rotateRadius = isMobile ? 12 : 6;
        const rotateHitRadius = isMobile ? 20 : 15; // Larger hit area for easier clicking
        const rotateDistance = isMobile ? 30 : 20;
        
        if (this.selectedElements.size === 1) {
            // Single element rotation handle
            const element = this.selectedElement;
            if (!this.isElementInVisibleLayer(element)) return null;
            
            const layer = this.layers.find(l => l.id === element.layerId);
            if (layer && layer.locked) return null;
            
            const screenPos = this.worldToScreen(element.x, element.y);
            const w = element.width * this.camera.zoom;
            
            const rotateX = screenPos.x;
            const rotateY = screenPos.y - w/2 - rotateDistance;
            
            const dx = screenX - rotateX;
            const dy = screenY - rotateY;
            
            return (dx * dx + dy * dy <= rotateHitRadius * rotateHitRadius);
        } else {
            // Multi-element rotation handle (at selection center)
            const selectionBounds = this.getSelectionBounds();
            const centerScreen = this.worldToScreen(selectionBounds.centerX, selectionBounds.centerY);
            
            const rotateX = centerScreen.x;
            const rotateY = centerScreen.y - selectionBounds.height * this.camera.zoom / 2 - rotateDistance;
            
            const dx = screenX - rotateX;
            const dy = screenY - rotateY;
            
            return (dx * dx + dy * dy <= rotateHitRadius * rotateHitRadius);
        }
    }
    
    isPointInRect(px, py, x, y, w, h) {
        return px >= x && px <= x + w && py >= y && py <= y + h;
    }
    
    getBringForwardHandle(screenX, screenY) {
        if (this.selectedElements.size !== 1) return null;
        
        const element = this.selectedElement;
        if (!this.isElementInVisibleLayer(element)) return null;
        
        const layer = this.layers.find(l => l.id === element.layerId);
        if (layer && layer.locked) return null;
        
        const screenPos = this.worldToScreen(element.x, element.y);
        const w = element.width * this.camera.zoom;
        const h = element.height * this.camera.zoom;
        
        const isMobile = window.innerWidth <= 768;
        const iconSize = isMobile ? 20 : 14;
        const iconColumn = screenPos.x + w/2 + (isMobile ? 15 : 12);
        const startY = screenPos.y - h/2 - (isMobile ? 5 : 2);
        
        const upArrowX = iconColumn;
        const upArrowY = startY;
        
        return this.isPointInRect(screenX, screenY, upArrowX, upArrowY, iconSize, iconSize);
    }
    
    getBringBackwardHandle(screenX, screenY) {
        if (this.selectedElements.size !== 1) return null;
        
        const element = this.selectedElement;
        if (!this.isElementInVisibleLayer(element)) return null;
        
        const layer = this.layers.find(l => l.id === element.layerId);
        if (layer && layer.locked) return null;
        
        const screenPos = this.worldToScreen(element.x, element.y);
        const w = element.width * this.camera.zoom;
        const h = element.height * this.camera.zoom;
        
        const isMobile = window.innerWidth <= 768;
        const iconSize = isMobile ? 20 : 14;
        const iconSpacing = isMobile ? 4 : 3;
        const iconColumn = screenPos.x + w/2 + (isMobile ? 15 : 12);
        const startY = screenPos.y - h/2 - (isMobile ? 5 : 2);
        
        const downArrowX = iconColumn;
        const isTextElement = element.shape === 'text';
        const downArrowY = startY + (iconSize + iconSpacing) * (isTextElement ? 4 : 3);
        
        return this.isPointInRect(screenX, screenY, downArrowX, downArrowY, iconSize, iconSize);
    }
    
    getColorPickerHandle(screenX, screenY) {
        if (this.selectedElements.size !== 1) return null;
        
        const element = this.selectedElement;
        if (!this.isElementInVisibleLayer(element)) return null;
        
        const layer = this.layers.find(l => l.id === element.layerId);
        if (layer && layer.locked) return null;
        
        const screenPos = this.worldToScreen(element.x, element.y);
        const w = element.width * this.camera.zoom;
        const h = element.height * this.camera.zoom;
        
        const isMobile = window.innerWidth <= 768;
        const iconSize = isMobile ? 20 : 14;
        const iconSpacing = isMobile ? 4 : 3;
        const iconColumn = screenPos.x + w/2 + (isMobile ? 15 : 12);
        const startY = screenPos.y - h/2 - (isMobile ? 5 : 2);
        
        const colorPickerX = iconColumn;
        const colorPickerY = startY + iconSize + iconSpacing;
        
        return this.isPointInRect(screenX, screenY, colorPickerX, colorPickerY, iconSize, iconSize);
    }

    getTextFormatHandle(screenX, screenY) {
        if (this.selectedElements.size !== 1) return null;
        
        const element = this.selectedElement;
        if (!this.isElementInVisibleLayer(element)) return null;
        if (element.shape !== 'text') return null;
        
        const layer = this.layers.find(l => l.id === element.layerId);
        if (layer && layer.locked) return null;
        
        const screenPos = this.worldToScreen(element.x, element.y);
        const w = element.width * this.camera.zoom;
        const h = element.height * this.camera.zoom;
        
        const isMobile = window.innerWidth <= 768;
        const iconSize = isMobile ? 20 : 14;
        const iconSpacing = isMobile ? 4 : 3;
        const iconColumn = screenPos.x + w/2 + (isMobile ? 15 : 12);
        const startY = screenPos.y - h/2 - (isMobile ? 5 : 2);
        
        const textFormatX = iconColumn;
        const textFormatY = startY + (iconSize + iconSpacing) * 2;
        
        return this.isPointInRect(screenX, screenY, textFormatX, textFormatY, iconSize, iconSize);
    }

    getGroupHandle(screenX, screenY) {
        if (this.selectedElements.size <= 1) return null;
        
        const isMobile = window.innerWidth <= 768;
        const groupIconSize = isMobile ? 20 : 14;
        const selectionBounds = this.getSelectionBounds();
        const centerScreen = this.worldToScreen(selectionBounds.centerX, selectionBounds.centerY);
        
        const groupX = centerScreen.x + selectionBounds.width * this.camera.zoom / 2 + (isMobile ? 20 : 15);
        const groupY = centerScreen.y - selectionBounds.height * this.camera.zoom / 2 - (isMobile ? 10 : 5);
        
        return this.isPointInRect(screenX, screenY, groupX, groupY, groupIconSize, groupIconSize);
    }

    getDeleteHandle(screenX, screenY) {
        if (this.selectedElements.size === 0) return null;
        
        const isMobile = window.innerWidth <= 768;
        const deleteSize = isMobile ? 20 : 12;
        const deleteDistance = isMobile ? 20 : 15;
        const deleteOffset = isMobile ? 10 : 5;
        
        if (this.selectedElements.size === 1) {
            // Single element delete handle
            const element = this.selectedElement;
            if (!this.isElementInVisibleLayer(element)) return null;
            
            const layer = this.layers.find(l => l.id === element.layerId);
            if (layer && layer.locked) return null;
            
            const screenPos = this.worldToScreen(element.x, element.y);
            const w = element.width * this.camera.zoom;
            const h = element.height * this.camera.zoom;
            
            const iconSize = isMobile ? 20 : 14;
            const iconSpacing = isMobile ? 4 : 3;
            const iconColumn = screenPos.x + w/2 + (isMobile ? 15 : 12);
            const startY = screenPos.y - h/2 - (isMobile ? 5 : 2);
            
            const deleteX = iconColumn;
            const isTextElement = element.shape === 'text';
            const deleteY = startY + (iconSize + iconSpacing) * (isTextElement ? 3 : 2);
            
            return this.isPointInRect(screenX, screenY, deleteX, deleteY, iconSize, iconSize);
        } else {
            // Multi-element delete handle (adjusted for group button)
            const selectionBounds = this.getSelectionBounds();
            const centerScreen = this.worldToScreen(selectionBounds.centerX, selectionBounds.centerY);
            
            const groupIconSize = isMobile ? 20 : 14;
            const groupX = centerScreen.x + selectionBounds.width * this.camera.zoom / 2 + (isMobile ? 20 : 15);
            const deleteX = groupX + groupIconSize + (isMobile ? 8 : 5);
            const deleteY = centerScreen.y - selectionBounds.height * this.camera.zoom / 2 - deleteOffset;
            
            return this.isPointInRect(screenX, screenY, deleteX, deleteY, deleteSize, deleteSize);
        }
    }
    
    bringForward() {
        if (!this.selectedElement) return;
        
        // Initialize zIndex if not present
        if (this.selectedElement.zIndex === undefined) {
            this.selectedElement.zIndex = 0;
        }
        
        // Find other elements that might be at the same layer position
        const sameLayerElements = this.elements.filter(el => 
            el.layerId === this.selectedElement.layerId && el.id !== this.selectedElement.id
        );
        
        // Find the highest zIndex in the same layer
        const maxZIndex = Math.max(0, ...sameLayerElements.map(el => el.zIndex || 0));
        
        // Bring forward by setting zIndex higher than the current max
        this.selectedElement.zIndex = maxZIndex + 1;
        
        // Send update
        this.sendUpdate('update', this.selectedElement);
        this.saveToHistory('Bring forward');
        this.render();
    }
    
    bringBackward() {
        if (!this.selectedElement) return;
        
        // Initialize zIndex if not present
        if (this.selectedElement.zIndex === undefined) {
            this.selectedElement.zIndex = 0;
        }
        
        // Find other elements that might be at the same layer position
        const sameLayerElements = this.elements.filter(el => 
            el.layerId === this.selectedElement.layerId && el.id !== this.selectedElement.id
        );
        
        // Find the lowest zIndex in the same layer
        const minZIndex = Math.min(0, ...sameLayerElements.map(el => el.zIndex || 0));
        
        // Bring backward by setting zIndex lower than the current min
        this.selectedElement.zIndex = minZIndex - 1;
        
        // Send update
        this.sendUpdate('update', this.selectedElement);
        this.saveToHistory('Send backward');
        this.render();
    }
    
    openColorPicker() {
        if (!this.selectedElement) return;
        
        // Hide any existing color picker
        this.hideColorPicker();
        this.hideTextFormatPopup();
        
        // Create color palette container
        const colorPalette = document.createElement('div');
        colorPalette.id = 'colorPalette';
        colorPalette.style.cssText = `
            position: fixed;
            background: white;
            border: 2px solid #007bff;
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 2000;
            width: 240px;
        `;
        
        // Create header with title and close button
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid #eee;
        `;
        
        const title = document.createElement('div');
        title.textContent = 'Choose Color';
        title.style.cssText = `
            font-weight: bold;
            color: #333;
            font-size: 14px;
        `;
        
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.style.cssText = `
            background: #dc3545;
            border: none;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            color: white;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
        `;
        
        closeButton.addEventListener('mouseenter', () => {
            closeButton.style.background = '#c82333';
        });
        
        closeButton.addEventListener('mouseleave', () => {
            closeButton.style.background = '#dc3545';
        });
        
        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideColorPicker();
        this.hideTextFormatPopup();
        });
        
        header.appendChild(title);
        header.appendChild(closeButton);
        colorPalette.appendChild(header);
        
        // Create color grid container
        const colorGrid = document.createElement('div');
        colorGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(8, 1fr);
            gap: 4px;
        `;
        
        // Color palette with 32 colors
        const colors = [
            '#FF0000', '#FF4500', '#FF8C00', '#FFD700',
            '#ADFF2F', '#00FF00', '#00FF7F', '#00FFFF',
            '#0080FF', '#0000FF', '#4169E1', '#8A2BE2',
            '#FF1493', '#FF69B4', '#DC143C', '#B22222',
            '#800000', '#A0522D', '#D2691E', '#CD853F',
            '#DAA520', '#808000', '#556B2F', '#006400',
            '#008080', '#4682B4', '#191970', '#800080',
            '#000000', '#404040', '#808080', '#FFFFFF'
        ];
        
        // Add color swatches
        colors.forEach(color => {
            const swatch = document.createElement('div');
            swatch.style.cssText = `
                width: 24px;
                height: 24px;
                background-color: ${color};
                border: 2px solid ${color === this.selectedElement.color ? '#007bff' : '#ccc'};
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
            `;
            
            swatch.addEventListener('mouseenter', () => {
                swatch.style.transform = 'scale(1.1)';
                swatch.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            });
            
            swatch.addEventListener('mouseleave', () => {
                swatch.style.transform = 'scale(1)';
                swatch.style.boxShadow = 'none';
            });
            
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                this.applyColor(color);
                // Update the border to show current selection
                this.updateColorSwatchSelection(colorGrid, color);
            });
            
            colorGrid.appendChild(swatch);
        });
        
        // Add the color grid to the palette
        colorPalette.appendChild(colorGrid);
        
        // Position the palette near the color picker icon
        const element = this.selectedElement;
        const screenPos = this.worldToScreen(element.x, element.y);
        const w = element.width * this.camera.zoom;
        const h = element.height * this.camera.zoom;
        
        const isMobile = window.innerWidth <= 768;
        const iconSize = isMobile ? 20 : 14;
        const iconSpacing = isMobile ? 4 : 3;
        const iconColumn = screenPos.x + w/2 + (isMobile ? 15 : 12);
        const startY = screenPos.y - h/2 - (isMobile ? 5 : 2);
        const colorPickerY = startY + iconSize + iconSpacing;
        
        let paletteX = iconColumn + iconSize + 10;
        let paletteY = colorPickerY;
        
        // Adjust position to keep palette on screen
        const paletteWidth = 240;
        const paletteHeight = 160; // Increased height for header + close button
        
        if (paletteX + paletteWidth > window.innerWidth) {
            paletteX = iconColumn - paletteWidth - 10;
        }
        if (paletteY + paletteHeight > window.innerHeight) {
            paletteY = window.innerHeight - paletteHeight - 10;
        }
        if (paletteX < 10) paletteX = 10;
        if (paletteY < 10) paletteY = 10;
        
        colorPalette.style.left = paletteX + 'px';
        colorPalette.style.top = paletteY + 'px';
        
        // Add to document
        document.body.appendChild(colorPalette);
    }
    
    openTextFormatPopup() {
        if (!this.selectedElement || this.selectedElement.shape !== 'text') return;
        
        // Hide any existing text format popup
        this.hideTextFormatPopup();
        
        // Create text format popup container
        const textFormatPopup = document.createElement('div');
        textFormatPopup.id = 'textFormatPopup';
        textFormatPopup.style.cssText = `
            position: fixed;
            background: white;
            border: 2px solid #6f42c1;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 2000;
            width: 280px;
            font-family: Arial, sans-serif;
        `;
        
        // Create header with title and close button
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid #eee;
        `;
        
        const title = document.createElement('div');
        title.textContent = 'Text Formatting';
        title.style.cssText = `
            font-weight: bold;
            color: #333;
            font-size: 16px;
        `;
        
        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.style.cssText = `
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: 24px;
            height: 24px;
        `;
        closeButton.addEventListener('click', () => this.hideTextFormatPopup());
        
        header.appendChild(title);
        header.appendChild(closeButton);
        textFormatPopup.appendChild(header);
        
        // Font size section
        const fontSizeSection = document.createElement('div');
        fontSizeSection.style.cssText = `margin-bottom: 16px;`;
        
        const fontSizeLabel = document.createElement('label');
        fontSizeLabel.textContent = 'Font Size:';
        fontSizeLabel.style.cssText = `
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: #333;
        `;
        
        const fontSizeInput = document.createElement('input');
        fontSizeInput.type = 'range';
        fontSizeInput.min = '8';
        fontSizeInput.max = '72';
        fontSizeInput.value = this.selectedElement.fontSize || 20;
        fontSizeInput.style.cssText = `
            width: 100%;
            margin-bottom: 8px;
        `;
        
        const fontSizeDisplay = document.createElement('span');
        fontSizeDisplay.textContent = `${this.selectedElement.fontSize || 20}px`;
        fontSizeDisplay.style.cssText = `
            font-size: 12px;
            color: #666;
        `;
        
        fontSizeInput.addEventListener('input', (e) => {
            const newSize = parseInt(e.target.value);
            fontSizeDisplay.textContent = `${newSize}px`;
            this.selectedElement.fontSize = newSize;
            this.sendUpdate('update', this.selectedElement);
            this.render();
        });
        
        fontSizeSection.appendChild(fontSizeLabel);
        fontSizeSection.appendChild(fontSizeInput);
        fontSizeSection.appendChild(fontSizeDisplay);
        textFormatPopup.appendChild(fontSizeSection);
        
        // Font family section
        const fontFamilySection = document.createElement('div');
        fontFamilySection.style.cssText = `margin-bottom: 16px;`;
        
        const fontFamilyLabel = document.createElement('label');
        fontFamilyLabel.textContent = 'Font Family:';
        fontFamilyLabel.style.cssText = `
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: #333;
        `;
        
        const fontFamilySelect = document.createElement('select');
        fontFamilySelect.style.cssText = `
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        `;
        
        const fontFamilies = [
            { value: 'Arial', label: 'Arial' },
            { value: 'Helvetica', label: 'Helvetica' },
            { value: 'Times New Roman', label: 'Times New Roman' },
            { value: 'Courier New', label: 'Courier New' },
            { value: 'Georgia', label: 'Georgia' },
            { value: 'Verdana', label: 'Verdana' },
            { value: 'Comic Sans MS', label: 'Comic Sans MS' },
            { value: 'Impact', label: 'Impact' },
            { value: 'Trebuchet MS', label: 'Trebuchet MS' }
        ];
        
        fontFamilies.forEach(font => {
            const option = document.createElement('option');
            option.value = font.value;
            option.textContent = font.label;
            option.style.fontFamily = font.value;
            if (font.value === (this.selectedElement.fontFamily || 'Arial')) {
                option.selected = true;
            }
            fontFamilySelect.appendChild(option);
        });
        
        fontFamilySelect.addEventListener('change', (e) => {
            this.selectedElement.fontFamily = e.target.value;
            this.sendUpdate('update', this.selectedElement);
            this.render();
        });
        
        fontFamilySection.appendChild(fontFamilyLabel);
        fontFamilySection.appendChild(fontFamilySelect);
        textFormatPopup.appendChild(fontFamilySection);
        
        // Font style section
        const fontStyleSection = document.createElement('div');
        fontStyleSection.style.cssText = `margin-bottom: 16px;`;
        
        const fontStyleLabel = document.createElement('label');
        fontStyleLabel.textContent = 'Font Style:';
        fontStyleLabel.style.cssText = `
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: #333;
        `;
        
        const fontStyleButtons = document.createElement('div');
        fontStyleButtons.style.cssText = `
            display: flex;
            gap: 8px;
        `;
        
        // Bold button
        const boldButton = document.createElement('button');
        boldButton.textContent = 'B';
        boldButton.style.cssText = `
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: ${this.selectedElement.fontWeight === 'bold' ? '#6f42c1' : 'white'};
            color: ${this.selectedElement.fontWeight === 'bold' ? 'white' : '#333'};
            font-weight: bold;
            cursor: pointer;
            flex: 1;
        `;
        
        boldButton.addEventListener('click', () => {
            this.selectedElement.fontWeight = this.selectedElement.fontWeight === 'bold' ? 'normal' : 'bold';
            boldButton.style.background = this.selectedElement.fontWeight === 'bold' ? '#6f42c1' : 'white';
            boldButton.style.color = this.selectedElement.fontWeight === 'bold' ? 'white' : '#333';
            this.sendUpdate('update', this.selectedElement);
            this.render();
        });
        
        // Italic button
        const italicButton = document.createElement('button');
        italicButton.textContent = 'I';
        italicButton.style.cssText = `
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: ${this.selectedElement.fontStyle === 'italic' ? '#6f42c1' : 'white'};
            color: ${this.selectedElement.fontStyle === 'italic' ? 'white' : '#333'};
            font-style: italic;
            cursor: pointer;
            flex: 1;
        `;
        
        italicButton.addEventListener('click', () => {
            this.selectedElement.fontStyle = this.selectedElement.fontStyle === 'italic' ? 'normal' : 'italic';
            italicButton.style.background = this.selectedElement.fontStyle === 'italic' ? '#6f42c1' : 'white';
            italicButton.style.color = this.selectedElement.fontStyle === 'italic' ? 'white' : '#333';
            this.sendUpdate('update', this.selectedElement);
            this.render();
        });
        
        // Strikethrough button
        const strikeButton = document.createElement('button');
        strikeButton.textContent = 'S';
        strikeButton.style.cssText = `
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: ${this.selectedElement.textDecoration === 'line-through' ? '#6f42c1' : 'white'};
            color: ${this.selectedElement.textDecoration === 'line-through' ? 'white' : '#333'};
            text-decoration: line-through;
            cursor: pointer;
            flex: 1;
        `;
        
        strikeButton.addEventListener('click', () => {
            this.selectedElement.textDecoration = this.selectedElement.textDecoration === 'line-through' ? 'none' : 'line-through';
            strikeButton.style.background = this.selectedElement.textDecoration === 'line-through' ? '#6f42c1' : 'white';
            strikeButton.style.color = this.selectedElement.textDecoration === 'line-through' ? 'white' : '#333';
            this.sendUpdate('update', this.selectedElement);
            this.render();
        });
        
        fontStyleButtons.appendChild(boldButton);
        fontStyleButtons.appendChild(italicButton);
        fontStyleButtons.appendChild(strikeButton);
        
        fontStyleSection.appendChild(fontStyleLabel);
        fontStyleSection.appendChild(fontStyleButtons);
        textFormatPopup.appendChild(fontStyleSection);
        
        // Position popup near the text format handle
        const screenPos = this.worldToScreen(this.selectedElement.x, this.selectedElement.y);
        const w = this.selectedElement.width * this.camera.zoom;
        const h = this.selectedElement.height * this.camera.zoom;
        
        const isMobile = window.innerWidth <= 768;
        const iconSize = isMobile ? 20 : 14;
        const iconSpacing = isMobile ? 4 : 3;
        const iconColumn = screenPos.x + w/2 + (isMobile ? 15 : 12);
        const textFormatY = screenPos.y - h/2 - (isMobile ? 5 : 2) + (iconSize + iconSpacing) * 2;
        
        let popupX = iconColumn + 30;
        let popupY = textFormatY;
        
        // Ensure popup stays within viewport
        if (popupX + 280 > window.innerWidth) {
            popupX = iconColumn - 280 - 30;
        }
        if (popupY + 300 > window.innerHeight) {
            popupY = window.innerHeight - 300;
        }
        if (popupY < 0) {
            popupY = 10;
        }
        
        textFormatPopup.style.left = popupX + 'px';
        textFormatPopup.style.top = popupY + 'px';
        
        // Add to document
        document.body.appendChild(textFormatPopup);
    }
    
    hideTextFormatPopup() {
        const popup = document.getElementById('textFormatPopup');
        if (popup) {
            popup.remove();
        }
    }
    
    toggleGroupSelection() {
        if (this.selectedElements.size <= 1) return;
        
        const allElementsGrouped = Array.from(this.selectedElements).every(element => element.groupId);
        
        if (allElementsGrouped) {
            this.ungroupSelectedElements();
        } else {
            this.groupSelectedElements();
        }
    }
    
    groupSelectedElements() {
        if (!this.canUserWrite()) {
            this.showReadOnlyError();
            return;
        }
        
        if (this.selectedElements.size <= 1) return;
        
        // Generate a unique group ID
        const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Apply group ID to all selected elements
        this.selectedElements.forEach(element => {
            element.groupId = groupId;
            this.sendUpdate('update', element);
        });
        
        this.saveToHistory('Group shapes');
        this.render();
        
        console.log(`Grouped ${this.selectedElements.size} elements with groupId: ${groupId}`);
    }
    
    ungroupSelectedElements() {
        if (!this.canUserWrite()) {
            this.showReadOnlyError();
            return;
        }
        
        if (this.selectedElements.size === 0) return;
        
        // Get all group IDs from selected elements
        const groupIds = new Set();
        this.selectedElements.forEach(element => {
            if (element.groupId) {
                groupIds.add(element.groupId);
            }
        });
        
        // Remove group ID from all elements that belong to these groups
        this.elements.forEach(element => {
            if (element.groupId && groupIds.has(element.groupId)) {
                delete element.groupId;
                this.sendUpdate('update', element);
            }
        });
        
        this.saveToHistory('Ungroup shapes');
        this.render();
        
        console.log(`Ungrouped elements from ${groupIds.size} group(s)`);
    }
    
    updateColorSwatchSelection(colorGrid, selectedColor) {
        // Update all swatches to show the new selection
        const swatches = colorGrid.children;
        for (let swatch of swatches) {
            const swatchColor = swatch.style.backgroundColor;
            // Convert RGB to hex to compare
            const hexColor = this.rgbToHex(swatchColor);
            if (hexColor.toUpperCase() === selectedColor.toUpperCase()) {
                swatch.style.border = '2px solid #007bff';
                swatch.style.boxShadow = '0 0 0 1px #007bff';
            } else {
                swatch.style.border = '2px solid #ccc';
                swatch.style.boxShadow = 'none';
            }
        }
    }
    
    rgbToHex(rgb) {
        // Convert rgb(r, g, b) to hex
        const result = rgb.match(/\d+/g);
        if (!result) return rgb;
        const [r, g, b] = result.map(Number);
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
    }
    
    hideColorPicker() {
        const existingPalette = document.getElementById('colorPalette');
        if (existingPalette) {
            document.body.removeChild(existingPalette);
        }
    }
    
    applyColor(color) {
        if (!this.selectedElement) return;
        
        // Update element color
        this.selectedElement.color = color;
        
        // Send update to server
        this.sendUpdate('update', this.selectedElement);
        this.saveToHistory(`Change color to ${color}`);
        this.render();
    }

    deleteSelectedElements() {
        if (!this.canUserWrite()) {
            this.showReadOnlyError();
            return;
        }
        
        if (this.selectedElements.size === 0) return;
        
        const elementsToDelete = Array.from(this.selectedElements);
        
        elementsToDelete.forEach(element => {
            const index = this.elements.indexOf(element);
            if (index > -1) {
                this.elements.splice(index, 1);
                this.removeElementFromLayer(element);
                this.sendUpdate('delete', { id: element.id });
            }
        });
        
        this.selectedElements.clear();
        this.selectedElement = null;
        this.saveToHistory('Delete elements');
        this.render();
    }
    
    clearAllElements() {
        if (!this.canUserWrite()) {
            this.showReadOnlyError();
            return;
        }
        
        if (this.elements.length === 0) {
            alert('Canvas is already empty!');
            return;
        }
        
        const confirmation = confirm(`Are you sure you want to clear all ${this.elements.length} shapes? This action can be undone.`);
        
        if (confirmation) {
            this.elements = [];
            this.selectedElement = null;
            this.selectedElements.clear();
            this.layers.forEach(layer => layer.elements = []);
            this.sendUpdate('clear', {});
            this.saveToHistory('Clear canvas');
            this.render();
            console.log('All elements cleared');
        }
    }
    
    resizeElement(handle) {
        const element = this.selectedElement;
        const worldPos = this.screenToWorld(this.mouse.x, this.mouse.y);
        
        // Store original bounds
        const originalLeft = element.x - element.width / 2;
        const originalRight = element.x + element.width / 2;
        const originalTop = element.y - element.height / 2;
        const originalBottom = element.y + element.height / 2;
        
        let newLeft = originalLeft;
        let newRight = originalRight;
        let newTop = originalTop;
        let newBottom = originalBottom;
        
        switch (handle) {
            case 'nw':
                newLeft = worldPos.x;
                newTop = worldPos.y;
                break;
            case 'ne':
                newRight = worldPos.x;
                newTop = worldPos.y;
                break;
            case 'sw':
                newLeft = worldPos.x;
                newBottom = worldPos.y;
                break;
            case 'se':
                newRight = worldPos.x;
                newBottom = worldPos.y;
                break;
        }
        
        // Calculate new dimensions
        let newWidth = Math.max(20, Math.abs(newRight - newLeft));
        let newHeight = Math.max(20, Math.abs(newBottom - newTop));
        
        // For images, preserve aspect ratio
        if (element.shape === 'image') {
            const originalAspectRatio = element.width / element.height;
            
            // Determine which dimension to constrain based on the handle being dragged
            if (handle === 'nw' || handle === 'se') {
                // Diagonal resize - use the dimension that changed more
                const widthChange = Math.abs(newWidth - element.width);
                const heightChange = Math.abs(newHeight - element.height);
                
                if (widthChange > heightChange) {
                    newHeight = newWidth / originalAspectRatio;
                } else {
                    newWidth = newHeight * originalAspectRatio;
                }
            } else if (handle === 'ne' || handle === 'sw') {
                // Diagonal resize - use the dimension that changed more
                const widthChange = Math.abs(newWidth - element.width);
                const heightChange = Math.abs(newHeight - element.height);
                
                if (widthChange > heightChange) {
                    newHeight = newWidth / originalAspectRatio;
                } else {
                    newWidth = newHeight * originalAspectRatio;
                }
            }
            
            // Ensure minimum size is respected while maintaining aspect ratio
            const minSize = 20;
            if (newWidth < minSize) {
                newWidth = minSize;
                newHeight = newWidth / originalAspectRatio;
            }
            if (newHeight < minSize) {
                newHeight = minSize;
                newWidth = newHeight * originalAspectRatio;
            }
            
            // Recalculate bounds based on constrained dimensions
            const centerX = (newLeft + newRight) / 2;
            const centerY = (newTop + newBottom) / 2;
            
            newLeft = centerX - newWidth / 2;
            newRight = centerX + newWidth / 2;
            newTop = centerY - newHeight / 2;
            newBottom = centerY + newHeight / 2;
        }
        
        // Update element
        element.width = newWidth;
        element.height = newHeight;
        element.x = (newLeft + newRight) / 2;
        element.y = (newTop + newBottom) / 2;
    }
    
    rotateElements() {
        if (this.selectedElements.size === 1) {
            // Single element rotation (around its center)
            const element = this.selectedElement;
            const centerScreen = this.worldToScreen(element.x, element.y);
            const angle = Math.atan2(this.mouse.y - centerScreen.y, this.mouse.x - centerScreen.x);
            element.rotation = angle + Math.PI/2;
        } else {
            // Multi-element rotation (around selection center)
            const selectionCenter = this.getSelectionCenter();
            const centerScreen = this.worldToScreen(selectionCenter.x, selectionCenter.y);
            const currentAngle = Math.atan2(this.mouse.y - centerScreen.y, this.mouse.x - centerScreen.x);
            
            // Initialize rotation tracking on first call
            if (this.lastRotationAngle === null) {
                this.lastRotationAngle = currentAngle;
                // Store initial positions and rotations
                this.initialElementPositions = new Map();
                this.initialElementRotations = new Map();
                
                this.selectedElements.forEach(element => {
                    this.initialElementPositions.set(element.id, { x: element.x, y: element.y });
                    this.initialElementRotations.set(element.id, element.rotation || 0);
                });
                return;
            }
            
            const deltaAngle = currentAngle - this.lastRotationAngle;
            
            // Apply rotation to all selected elements
            this.selectedElements.forEach(element => {
                const initialPos = this.initialElementPositions.get(element.id);
                const initialRot = this.initialElementRotations.get(element.id);
                
                if (initialPos) {
                    // Rotate position around selection center
                    const dx = initialPos.x - selectionCenter.x;
                    const dy = initialPos.y - selectionCenter.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const initialAngle = Math.atan2(dy, dx);
                    const totalRotation = currentAngle - this.lastRotationAngle;
                    const newAngle = initialAngle + totalRotation;
                    
                    element.x = selectionCenter.x + Math.cos(newAngle) * distance;
                    element.y = selectionCenter.y + Math.sin(newAngle) * distance;
                    element.rotation = initialRot + totalRotation;
                }
            });
        }
    }
    
    getSelectionCenter() {
        if (this.selectedElements.size === 0) return { x: 0, y: 0 };
        
        let totalX = 0;
        let totalY = 0;
        
        this.selectedElements.forEach(element => {
            totalX += element.x;
            totalY += element.y;
        });
        
        return {
            x: totalX / this.selectedElements.size,
            y: totalY / this.selectedElements.size
        };
    }
    
    getSelectionBounds() {
        if (this.selectedElements.size === 0) return { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
        
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        
        this.selectedElements.forEach(element => {
            const halfWidth = element.width / 2;
            const halfHeight = element.height / 2;
            
            minX = Math.min(minX, element.x - halfWidth);
            maxX = Math.max(maxX, element.x + halfWidth);
            minY = Math.min(minY, element.y - halfHeight);
            maxY = Math.max(maxY, element.y + halfHeight);
        });
        
        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        return {
            x: minX,
            y: minY,
            width: width,
            height: height,
            centerX: centerX,
            centerY: centerY
        };
    }
    
    startLabelEdit(element) {
        this.isEditingLabel = true;
        const input = document.getElementById('labelInput');
        const screenPos = this.worldToScreen(element.x, element.y);
        
        input.style.display = 'block';
        input.style.left = (screenPos.x - 50) + 'px';
        input.style.top = (screenPos.y + 30) + 'px';
        input.value = element.text || '';
        
        input.focus();
        input.select();
        
        this.editingElement = element;
    }
    
    finishLabelEdit() {
        if (!this.isEditingLabel) return;
        
        const input = document.getElementById('labelInput');
        if (this.editingElement) {
            this.editingElement.text = input.value;
            this.sendUpdate('update', this.editingElement);
            this.saveToHistory('Edit label');
        }
        
        input.style.display = 'none';
        this.isEditingLabel = false;
        this.editingElement = null;
        this.render();
    }
    
    cancelLabelEdit() {
        const input = document.getElementById('labelInput');
        input.style.display = 'none';
        this.isEditingLabel = false;
        this.editingElement = null;
    }
    
    // Inline text editing functions
    startInlineTextEdit(element) {
        this.isEditingText = true;
        this.editingTextElement = element;
        this.textCursorPosition = element.text ? element.text.length : 0;
        this.textCursorVisible = true;
        
        // Start cursor blinking
        this.textCursorInterval = setInterval(() => {
            this.textCursorVisible = !this.textCursorVisible;
            this.render();
        }, 500);
        
        // Select the text element
        this.selectedElements.clear();
        this.selectedElements.add(element);
        this.selectedElement = element;
        
        this.render();
    }
    
    finishInlineTextEdit() {
        if (!this.isEditingText || !this.editingTextElement) return;
        
        // Stop cursor blinking
        if (this.textCursorInterval) {
            clearInterval(this.textCursorInterval);
            this.textCursorInterval = null;
        }
        
        // Send update to server
        this.sendUpdate('update', this.editingTextElement);
        this.saveToHistory('Edit text');
        
        this.isEditingText = false;
        this.editingTextElement = null;
        this.textCursorPosition = 0;
        this.textCursorVisible = true;
        
        this.render();
    }
    
    handleTextEditingKeyDown(e) {
        if (!this.editingTextElement) return;
        
        e.preventDefault();
        
        let text = this.editingTextElement.text || '';
        const cursorPos = this.textCursorPosition;
        
        switch (e.key) {
            case 'Escape':
                this.finishInlineTextEdit();
                break;
                
            case 'Enter':
                if (e.shiftKey) {
                    // Shift+Enter finishes editing
                    this.finishInlineTextEdit();
                } else {
                    // Regular Enter adds line break
                    text = text.slice(0, cursorPos) + '\n' + text.slice(cursorPos);
                    this.editingTextElement.text = text;
                    this.textCursorPosition++;
                }
                break;
                
            case 'Backspace':
                if (cursorPos > 0) {
                    text = text.slice(0, cursorPos - 1) + text.slice(cursorPos);
                    this.textCursorPosition--;
                    this.editingTextElement.text = text;
                }
                break;
                
            case 'Delete':
                if (cursorPos < text.length) {
                    text = text.slice(0, cursorPos) + text.slice(cursorPos + 1);
                    this.editingTextElement.text = text;
                }
                break;
                
            case 'ArrowLeft':
                if (cursorPos > 0) {
                    this.textCursorPosition--;
                }
                break;
                
            case 'ArrowRight':
                if (cursorPos < text.length) {
                    this.textCursorPosition++;
                }
                break;
                
            case 'Home':
                this.textCursorPosition = 0;
                break;
                
            case 'End':
                this.textCursorPosition = text.length;
                break;
                
            default:
                // Handle regular character input
                if (e.key.length === 1) {
                    text = text.slice(0, cursorPos) + e.key + text.slice(cursorPos);
                    this.editingTextElement.text = text;
                    this.textCursorPosition++;
                }
                break;
        }
        
        this.render();
    }
    
    // Keyboard shortcuts handler
    handleKeyDown(e) {
        // Handle inline text editing
        if (this.isEditingText) {
            this.handleTextEditingKeyDown(e);
            return;
        }
        
        // Don't handle shortcuts when editing labels
        if (this.isEditingLabel) return;
        
        // Handle escape key
        if (e.key === 'Escape') {
            if (this.isEditingText) {
                this.finishInlineTextEdit();
            } else if (this.isSizing) {
                this.cancelShapeSizing();
            } else if (this.isPlacing) {
                this.exitPlacementMode();
            } else {
                this.selectedElements.clear();
                this.selectedElement = null;
                this.hideColorPicker();
        this.hideTextFormatPopup();
                this.render();
            }
            return;
        }
        
        // Handle delete/backspace
        if (e.key === 'Delete' || e.key === 'Backspace') {
            this.deleteSelectedElements();
            return;
        }
        
        // Handle Ctrl/Cmd combinations
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'z':
                    if (e.shiftKey) {
                        this.redo();
                    } else {
                        this.undo();
                    }
                    e.preventDefault();
                    break;
                case 'y':
                    this.redo();
                    e.preventDefault();
                    break;
                case 'c':
                    this.copySelectedElements();
                    e.preventDefault();
                    break;
                case 'v':
                    // Regular Ctrl+V for pasting elements (images handled by paste event)
                    this.pasteElements();
                    e.preventDefault();
                    break;
                case 'x':
                    this.cutSelectedElements();
                    e.preventDefault();
                    break;
                case 'a':
                    this.selectAllElements();
                    e.preventDefault();
                    break;
                case 'd':
                    this.duplicateSelectedElements();
                    e.preventDefault();
                    break;
                case 'g':
                    this.toggleSnapToGrid();
                    e.preventDefault();
                    break;
            }
        }
        
        // Handle arrow keys for nudging
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            this.nudgeSelectedElements(e.key, e.shiftKey ? 10 : 1);
            e.preventDefault();
        }
    }
    
    // Selection methods
    completeSelection() {
        if (!this.selectionBox) return;
        
        this.selectedElements.clear();
        
        this.elements.forEach(element => {
            // Only select elements in visible, unlocked layers
            const layer = this.layers.find(l => l.id === element.layerId);
            if (layer && layer.visible && !layer.locked && this.isElementInSelectionBox(element)) {
                this.selectedElements.add(element);
                
                // If this element is grouped, select all elements in the same group
                if (element.groupId) {
                    this.elements.forEach(groupedElement => {
                        if (groupedElement.groupId === element.groupId) {
                            this.selectedElements.add(groupedElement);
                        }
                    });
                }
                
                // Send shape selection to others
                this.sendUpdate('shapeSelect', { 
                    id: element.id,
                    action: 'selected'
                });
            }
        });
        
        this.selectedElement = this.selectedElements.size > 0 ? 
            Array.from(this.selectedElements)[0] : null;
        
        console.log(`Selected ${this.selectedElements.size} elements via selection box`);
        
        this.render();
    }
    
    isElementInSelectionBox(element) {
        const box = this.selectionBox;
        
        // Calculate element bounds
        const elementLeft = element.x - element.width / 2;
        const elementRight = element.x + element.width / 2;
        const elementTop = element.y - element.height / 2;
        const elementBottom = element.y + element.height / 2;
        
        // Calculate selection box bounds
        const boxLeft = box.x;
        const boxRight = box.x + box.width;
        const boxTop = box.y;
        const boxBottom = box.y + box.height;
        
        // Check if selection box intersects with element bounds
        return !(elementRight < boxLeft || 
                 elementLeft > boxRight || 
                 elementBottom < boxTop || 
                 elementTop > boxBottom);
    }
    
    selectAllElements() {
        this.selectedElements.clear();
        this.elements.forEach(element => {
            // Only select elements in visible, unlocked layers
            const layer = this.layers.find(l => l.id === element.layerId);
            if (layer && layer.visible && !layer.locked) {
                this.selectedElements.add(element);
            }
        });
        this.selectedElement = this.selectedElements.size > 0 ? 
            Array.from(this.selectedElements)[0] : null;
        this.render();
    }
    
    // Clipboard operations
    copySelectedElements() {
        if (this.selectedElements.size === 0) return;
        
        this.clipboard = Array.from(this.selectedElements).map(element => 
            JSON.parse(JSON.stringify(element))
        );
        
        console.log(`Copied ${this.clipboard.length} elements`);
    }
    
    cutSelectedElements() {
        this.copySelectedElements();
        this.deleteSelectedElements();
    }
    
    pasteElements() {
        if (this.clipboard.length === 0) return;
        
        this.selectedElements.clear();
        const offset = 20; // Paste offset
        
        this.clipboard.forEach((element, index) => {
            const newElement = {
                ...element,
                id: Date.now() + Math.random() + index, // Ensure uniqueness
                x: element.x + offset,
                y: element.y + offset,
                layerId: this.activeLayerId
            };
            
            this.elements.push(newElement);
            this.addElementToLayer(newElement);
            this.selectedElements.add(newElement);
            this.sendUpdate('add', newElement);
        });
        
        this.selectedElement = Array.from(this.selectedElements)[0];
        this.saveToHistory('Paste elements');
        this.render();
        
        console.log(`Pasted ${this.clipboard.length} elements`);
    }
    
    // Image handling methods
    triggerImageUpload() {
        document.getElementById('imageInput').click();
    }
    
    async handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Only allow JPG and PNG files for security reasons
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        const allowedExtensions = ['.jpg', '.jpeg', '.png'];
        const fileExtension = file.name.toLowerCase().split('.').pop();
        
        if (!allowedMimeTypes.includes(file.type) || !allowedExtensions.includes('.' + fileExtension)) {
            alert('Only JPG and PNG image files are allowed.');
            return;
        }
        
        // Check file size (max 3MB)
        if (file.size > 3 * 1024 * 1024) {
            alert('Image file is too large. Maximum size is 3MB.');
            return;
        }
        
        await this.processImageFile(file);
        
        // Clear the input so the same file can be uploaded again
        event.target.value = '';
    }
    
    async handlePaste(event) {
        // Only handle paste if not editing a label
        if (this.isEditingLabel) return;
        
        const items = event.clipboardData?.items;
        if (!items) return;
        
        for (let item of items) {
            // Only allow JPG and PNG files for security reasons
            const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
            
            if (allowedMimeTypes.includes(item.type)) {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    await this.processImageFile(file);
                }
                break;
            }
        }
    }
    
    async processImageFile(file) {
        try {
            // Create FormData for file upload
            const formData = new FormData();
            formData.append('image', file);
            formData.append('roomName', this.roomName);
            
            // Upload file to server
            const response = await fetch('/api/upload/image', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error('Failed to upload image');
            }
            
            const data = await response.json();
            
            // Create image element on canvas
            await this.createImageElement(data.filename, data.originalName);
            
        } catch (error) {
            console.error('Error processing image:', error);
            alert('Failed to upload image. Please try again.');
        }
    }
    
    async createImageElement(filename, originalName) {
        // Create an HTML Image to get dimensions
        const img = new Image();
        
        return new Promise((resolve, reject) => {
            img.onload = () => {
                // Calculate scaled dimensions (max 400px on either side)
                const maxSize = 400;
                let width = img.width;
                let height = img.height;
                
                if (width > maxSize || height > maxSize) {
                    const scale = Math.min(maxSize / width, maxSize / height);
                    width = width * scale;
                    height = height * scale;
                }
                
                // Create the image element
                const element = {
                    id: Date.now() + Math.random(),
                    x: this.camera.x, // Place at camera center
                    y: this.camera.y,
                    width: width,
                    height: height,
                    rotation: 0,
                    shape: 'image',
                    filename: filename,
                    originalName: originalName,
                    text: '',
                    layerId: this.activeLayerId
                };
                
                // Add to canvas
                this.elements.push(element);
                this.addElementToLayer(element);
                this.sendUpdate('add', element);
                this.saveToHistory(`Add image: ${originalName}`);
                
                // Select the new image
                this.selectedElements.clear();
                this.selectedElements.add(element);
                this.selectedElement = element;
                
                this.render();
                console.log(`Added image: ${originalName} (${width}x${height})`);
                resolve();
            };
            
            img.onerror = () => {
                reject(new Error('Failed to load image'));
            };
            
            img.src = `/api/uploads/${this.roomName}/${filename}`;
        });
    }
    
    duplicateSelectedElements() {
        this.copySelectedElements();
        this.pasteElements();
    }
    
    // Loading animation system
    startLoadingAnimation() {
        this.isAnimating = true;
        this.animationStartTime = Date.now();
        this.animatedElements.clear();
        
        // Calculate animation delays for each element based on distance from center
        const centerX = this.camera.x;
        const centerY = this.camera.y;
        
        this.elements.forEach((element, index) => {
            // Calculate distance from center for delay calculation
            const distance = Math.sqrt(
                Math.pow(element.x - centerX, 2) + 
                Math.pow(element.y - centerY, 2)
            );
            
            // Calculate angle from center to determine slide direction
            const angle = Math.atan2(element.y - centerY, element.x - centerX);
            
            // Stagger animation based on distance and index
            const baseDelay = (index * 80) + (distance * 0.1);
            const animationDelay = Math.min(baseDelay, 1500); // Max 1.5s delay
            
            // Store animation data
            this.animatedElements.set(element.id, {
                element: element,
                startTime: this.animationStartTime + animationDelay,
                duration: 600, // Individual animation duration
                startAngle: angle,
                originalX: element.x,
                originalY: element.y,
                slideDistance: 300 // Distance to slide from
            });
        });
        
        console.log(`Starting loading animation for ${this.elements.length} elements`);
        this.animateLoadingFrame();
    }
    
    animateLoadingFrame() {
        if (!this.isAnimating) return;
        
        const currentTime = Date.now();
        const totalElapsed = currentTime - this.animationStartTime;
        
        // Check if animation is complete
        let allAnimationsComplete = true;
        this.animatedElements.forEach(animData => {
            if (currentTime < animData.startTime + animData.duration) {
                allAnimationsComplete = false;
            }
        });
        
        if (allAnimationsComplete && totalElapsed > 500) {
            // Animation complete
            this.isAnimating = false;
            this.animatedElements.clear();
            this.render();
            console.log('Loading animation completed');
            return;
        }
        
        // Continue animation
        this.render();
        requestAnimationFrame(() => this.animateLoadingFrame());
    }
    
    getElementAnimationState(element) {
        if (!this.isAnimating) return null;
        
        const animData = this.animatedElements.get(element.id);
        if (!animData) return null;
        
        const currentTime = Date.now();
        const elapsed = currentTime - animData.startTime;
        
        // Not started yet
        if (elapsed < 0) {
            return {
                opacity: 0,
                scale: 0,
                offsetX: 0,
                offsetY: 0,
                visible: false
            };
        }
        
        // Animation in progress
        if (elapsed < animData.duration) {
            const progress = elapsed / animData.duration;
            const easeProgress = this.easeOutCubic(progress);
            
            // Calculate slide-in effect
            const slideDistance = animData.slideDistance * (1 - easeProgress);
            const offsetX = Math.cos(animData.startAngle) * slideDistance;
            const offsetY = Math.sin(animData.startAngle) * slideDistance;
            
            return {
                opacity: easeProgress,
                scale: 0.3 + (0.7 * easeProgress), // Scale from 30% to 100%
                offsetX: offsetX,
                offsetY: offsetY,
                visible: true
            };
        }
        
        // Animation complete
        return {
            opacity: 1,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            visible: true
        };
    }
    
    easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }
    
    easeInOutQuart(t) {
        return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    }
    
    // Element nudging
    nudgeSelectedElements(direction, distance) {
        if (this.selectedElements.size === 0) return;
        
        const dx = direction === 'ArrowLeft' ? -distance : 
                  direction === 'ArrowRight' ? distance : 0;
        const dy = direction === 'ArrowUp' ? -distance : 
                  direction === 'ArrowDown' ? distance : 0;
        
        this.selectedElements.forEach(element => {
            element.x += dx;
            element.y += dy;
            this.sendUpdate('update', element);
        });
        
        this.saveToHistory('Nudge elements');
        this.render();
    }
    
    // Snap to grid
    toggleSnapToGrid() {
        this.snapToGrid = !this.snapToGrid;
        const toggle = document.getElementById('snapToggle');
        toggle.classList.toggle('active', this.snapToGrid);
        toggle.textContent = this.snapToGrid ? '✓ Snap' : 'Snap';
        console.log('Snap to grid:', this.snapToGrid);
    }
    
    // Mobile side panel toggle
    toggleSidePanel() {
        const sidePanel = document.getElementById('sidePanel');
        const toggle = document.getElementById('sidePanelToggle');
        
        if (sidePanel.classList.contains('expanded')) {
            sidePanel.classList.remove('expanded');
            toggle.textContent = '📋';
        } else {
            sidePanel.classList.add('expanded');
            toggle.textContent = '✖';
        }
    }
    
    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.lastHeartbeat = Date.now();
            this.updateConnectionStatus('Connected');
            
            // Start connection monitoring
            this.startConnectionMonitoring();
            
            // Join room first
            if (this.ws.readyState === WebSocket.OPEN && this.roomName) {
                this.joinRoomWithPassword();
            }
        };
        
        // Handle ping from server - respond with pong
        // This will be handled in the message handler now
        
        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleServerMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        this.ws.onclose = (event) => {
            console.log('WebSocket disconnected:', event.code, event.reason);
            this.isConnected = false;
            this.updateConnectionStatus('Disconnected');
            
            // Stop connection monitoring
            this.stopConnectionMonitoring();
            
            // Implement exponential backoff for reconnection
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
                this.reconnectAttempts++;
                
                console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
                setTimeout(() => {
                    this.setupWebSocket();
                }, delay);
            } else {
                console.error('Max reconnection attempts reached');
                this.updateConnectionStatus('Failed');
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateConnectionStatus('Error');
        };
    }
    
    handleServerMessage(message) {
        const { type, data } = message;
        
        switch (type) {
            case 'ping':
                // Respond to server ping with pong
                this.lastHeartbeat = Date.now();
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'pong',
                        timestamp: Date.now()
                    }));
                }
                break;
                
            case 'error':
                console.error('Server error:', data.message);
                this.updateConnectionStatus('Error: ' + data.message);
                
                // Handle password authentication errors
                if (data.message && data.message.includes('password')) {
                    this.isJoiningRoom = false;
                    // Remove stored password since it's incorrect
                    localStorage.removeItem(`room_password_${this.roomName}`);
                    
                    alert('Incorrect password. Please try again.');
                    
                    // Re-attempt to join with new password
                    setTimeout(() => {
                        this.joinRoomWithPassword();
                    }, 100);
                }
                break;
                
            case 'init':
                // Room joined successfully and initial state received
                if (this.isJoiningRoom) {
                    this.isJoiningRoom = false;
                    console.log(`Successfully joined room: ${this.roomName}`);
                    
                    // Send user info after joining room
                    if (this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({
                            type: 'userInfo',
                            data: {
                                userId: this.userId,
                                userName: this.userName
                            }
                        }));
                    }
                    
                    // Send any pending updates
                    while (this.pendingUpdates.length > 0) {
                        const update = this.pendingUpdates.shift();
                        this.ws.send(JSON.stringify(update));
                    }
                }
                
                // Initial state from server
                this.elements = data.elements || [];
                this.camera = data.camera || { x: 0, y: 0, zoom: 1 };
                this.layers = data.layers || [{
                    id: 'layer_0',
                    name: 'Layer 1',
                    visible: true,
                    locked: false,
                    elements: []
                }];
                this.activeLayerId = this.layers[0].id;
                
                // Update password protection status and user role
                this.isPasswordProtected = data.isPasswordProtected || false;
                this.userRole = data.userRole || 'admin';
                this.updateLockIcon();
                
                // Show user role in UI
                this.updateUserRoleDisplay();
                
                // Rebuild layer-element relationships
                this.rebuildLayerElementRelationships();
                
                this.updateLayerUI();
                
                // Start loading animation only if there are elements AND this is the first time
                if (this.elements.length > 0 && !this.hasPlayedInitialAnimation) {
                    this.hasPlayedInitialAnimation = true;
                    this.startLoadingAnimation();
                } else {
                    this.render();
                }
                
                console.log(`Loaded ${this.elements.length} elements and ${this.layers.length} layers from room ${this.roomName}`);
                break;
                
            case 'add':
                // Another user added an element
                const existingAdd = this.elements.find(el => el.id === data.id);
                if (!existingAdd) {
                    this.elements.push(data);
                    this.addElementToLayer(data);
                    this.render();
                    console.log(`${data.userName} added element:`, data.id);
                }
                break;
                
            case 'update':
                // Another user updated an element
                const updateIndex = this.elements.findIndex(el => el.id === data.id);
                if (updateIndex !== -1) {
                    this.elements[updateIndex] = { ...this.elements[updateIndex], ...data };
                    
                    // If another user updated the shape I have selected, clear my selection
                    if (this.selectedElement && this.selectedElement.id === data.id && data.userId !== this.userId) {
                        this.selectedElement = null;
                        this.hideResizeHandles();
                        this.showTemporaryMessage(`${data.userName} modified your selected shape`);
                    }
                    
                    this.render();
                    console.log(`${data.userName} updated element:`, data.id);
                }
                break;
                
            case 'delete':
                // Another user deleted an element
                const deleteIndex = this.elements.findIndex(el => el.id === data.id);
                if (deleteIndex !== -1) {
                    const elementToDelete = this.elements[deleteIndex];
                    this.elements.splice(deleteIndex, 1);
                    this.removeElementFromLayer(elementToDelete);
                    
                    // Clear selection if deleted element was selected
                    if (this.selectedElement && this.selectedElement.id === data.id) {
                        this.selectedElement = null;
                    }
                    this.selectedElements.delete(elementToDelete);
                    
                    // Clear shape user tracking
                    this.shapeUsers.delete(data.id);
                    this.render();
                    console.log(`${data.userName} deleted element:`, data.id);
                }
                break;
                
            case 'clear':
                // Another user cleared all elements
                this.elements = [];
                this.selectedElement = null;
                this.selectedElements.clear();
                this.layers.forEach(layer => layer.elements = []);
                this.shapeUsers.clear(); // Clear all shape user tracking
                this.updateLayerUI();
                this.render();
                console.log(`${data.userName} cleared all elements`);
                break;
                
            case 'move':
                // Another user is moving/resizing/rotating an element (live update)
                const moveIndex = this.elements.findIndex(el => el.id === data.id);
                if (moveIndex !== -1) {
                    this.elements[moveIndex].x = data.x;
                    this.elements[moveIndex].y = data.y;
                    if (data.width !== undefined) this.elements[moveIndex].width = data.width;
                    if (data.height !== undefined) this.elements[moveIndex].height = data.height;
                    if (data.rotation !== undefined) this.elements[moveIndex].rotation = data.rotation;
                    
                    // Track which user is manipulating this shape
                    this.shapeUsers.set(data.id, {
                        userName: data.userName,
                        userId: data.userId,
                        action: data.action || 'moving',
                        color: this.getUserColor(data.userId)
                    });
                    
                    // If another user is manipulating the shape I have selected, clear my selection
                    if (this.selectedElement && this.selectedElement.id === data.id && data.userId !== this.userId) {
                        this.selectedElement = null;
                        this.hideResizeHandles();
                        this.showTemporaryMessage(`${data.userName} took control of your selected shape`);
                    }
                    
                    this.render();
                }
                break;
                
            case 'shapeSelect':
                // Another user selected a shape
                this.shapeUsers.set(data.id, {
                    userName: data.userName,
                    userId: data.userId,
                    action: data.action || 'selected',
                    color: this.getUserColor(data.userId)
                });
                
                // If another user selected the shape I have selected, clear my selection
                if (this.selectedElement && this.selectedElement.id === data.id && data.userId !== this.userId) {
                    this.selectedElement = null;
                    this.hideResizeHandles();
                    this.showTemporaryMessage(`${data.userName} selected your shape`);
                }
                
                this.render();
                break;
                
            case 'shapeRelease':
                // Another user released a shape
                this.shapeUsers.delete(data.id);
                this.render();
                break;
                
            case 'cursor':
                // Another user's cursor position
                this.updateOtherUserCursor(data);
                break;
                
            case 'userJoined':
                // New user joined
                this.updateUserCount(data.userCount);
                console.log(`User ${data.userName} joined`);
                break;
                
            case 'userLeft':
                // User left
                this.otherUsers.delete(data.userId);
                this.updateUserCount(data.userCount);
                this.render();
                console.log(`User ${data.userName} left`);
                break;
                
            case 'fullSync':
                // Full state synchronization for undo/redo
                if (data.elements) {
                    this.elements = data.elements;
                }
                if (data.layers) {
                    this.layers = data.layers;
                    this.updateLayerUI();
                }
                this.selectedElement = null;
                this.selectedElements.clear();
                this.render();
                console.log(`${data.userName} synchronized full state`);
                break;
                
            case 'addLayer':
                // Another user added a layer
                const existingLayer = this.layers.find(l => l.id === data.id);
                if (!existingLayer) {
                    this.layers.push(data);
                    this.updateLayerUI();
                    console.log(`${data.userName} added layer:`, data.name);
                }
                break;
                
            case 'deleteLayer':
                // Another user deleted a layer
                const layerIndex = this.layers.findIndex(l => l.id === data.id);
                if (layerIndex !== -1) {
                    const layer = this.layers[layerIndex];
                    
                    // Remove elements from this layer
                    layer.elements.forEach(elementId => {
                        const elementIndex = this.elements.findIndex(el => el.id === elementId);
                        if (elementIndex !== -1) {
                            this.elements.splice(elementIndex, 1);
                        }
                    });
                    
                    // Remove layer
                    this.layers.splice(layerIndex, 1);
                    
                    // Update active layer if needed
                    if (this.activeLayerId === data.id) {
                        this.activeLayerId = this.layers[0]?.id || 'layer_0';
                    }
                    
                    this.updateLayerUI();
                    this.render();
                    console.log(`${data.userName} deleted layer:`, layer.name);
                }
                break;
                
            case 'updateLayer':
                // Another user updated a layer
                const updateLayerIndex = this.layers.findIndex(l => l.id === data.id);
                if (updateLayerIndex !== -1) {
                    this.layers[updateLayerIndex] = { ...this.layers[updateLayerIndex], ...data };
                    
                    // Clear selections if layer is now hidden or locked
                    if (!data.visible || data.locked) {
                        this.deselectElementsInLayer(data.id);
                    }
                    
                    this.updateLayerUI();
                    this.render();
                    console.log(`${data.userName} updated layer:`, data.name);
                }
                break;
                
            case 'roomPasswordChanged':
                // Another user changed the room password protection
                this.isPasswordProtected = data.isPasswordProtected;
                this.updateLockIcon();
                const passwordStatus = data.isPasswordProtected ? 'enabled' : 'disabled';
                this.showTemporaryMessage(`Room password protection ${passwordStatus} by another user`);
                break;
                
            case 'camera':
                // Another user changed camera view (optional - could be disabled for privacy)
                // this.camera = data;
                // this.render();
                break;
        }
    }
    
    sendUpdate(type, data) {
        const update = { 
            type, 
            data: {
                ...data,
                userId: this.userId,
                userName: this.userName
            }
        };
        
        if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(update));
            } catch (error) {
                console.error('Error sending update:', error);
                this.pendingUpdates.push(update);
            }
        } else {
            // Store update for when connection is restored
            if (this.pendingUpdates.length < 100) { // Prevent memory issues
                this.pendingUpdates.push(update);
            }
        }
    }
    
    updateConnectionStatus(status) {
        const statusColors = {
            'Connected': '#28a745',
            'Disconnected': '#dc3545',
            'Error': '#ffc107',
            'Failed': '#dc3545'
        };
        
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.style.color = statusColors[status] || '#666';
            statusElement.className = `connection-status ${status.toLowerCase()}`;
        }
        
        // Update mode display color
        const modeElement = document.getElementById('mode');
        if (modeElement && status !== 'Connected') {
            modeElement.style.color = statusColors[status] || '#666';
        }
    }
    
    startConnectionMonitoring() {
        // Clear any existing interval
        this.stopConnectionMonitoring();
        
        this.heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastHeartbeat = now - this.lastHeartbeat;
            
            // If we haven't received a ping in 75 seconds (50s ping interval + 25s buffer)
            if (timeSinceLastHeartbeat > 75000) {
                console.log('Connection appears stale, forcing reconnect');
                this.ws.close(1000, 'Heartbeat timeout');
            }
        }, this.connectionCheckInterval);
    }
    
    stopConnectionMonitoring() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    showTemporaryMessage(message) {
        const modeElement = document.getElementById('mode');
        const originalText = modeElement.textContent;
        const originalColor = modeElement.style.color;
        
        // Show temporary message
        modeElement.textContent = message;
        modeElement.style.color = '#ff6b35';
        
        // Restore original after 2 seconds
        setTimeout(() => {
            modeElement.textContent = originalText;
            modeElement.style.color = originalColor;
        }, 2000);
    }
    
    generateRandomName() {
        const adjectives = ['Quick', 'Clever', 'Bright', 'Swift', 'Bold', 'Calm', 'Brave', 'Sharp', 'Smart', 'Cool', 'Fast', 'Wild', 'Strong', 'Wise', 'Silent'];
        const animals = ['Fox', 'Wolf', 'Eagle', 'Hawk', 'Bear', 'Lion', 'Tiger', 'Owl', 'Deer', 'Cat', 'Falcon', 'Shark', 'Raven', 'Lynx', 'Panther'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const animal = animals[Math.floor(Math.random() * animals.length)];
        return `${adj} ${animal}`;
    }
    
    editUsername() {
        const newName = prompt('Enter your name:', this.userName);
        if (newName && newName.trim() && newName.trim() !== this.userName) {
            this.userName = newName.trim();
            document.getElementById('username').textContent = `👤 ${this.userName}`;
            
            
            // Send updated name to server (without duplicating in sendUpdate)
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'userInfo',
                    data: {
                        userId: this.userId,
                        userName: this.userName
                    }
                }));
            }
        }
    }
    
    editRoomName() {
        const currentRoom = this.roomName;
        const newRoomName = prompt(
            'Enter room name to join:\n\n' +
            'Rules:\n' +
            '• Only letters, numbers, and hyphens (-) allowed\n' +
            '• Between 3-50 characters\n' +
            '• Examples: my-room, team-canvas-2024, project-alpha\n\n' +
            'Current room:', 
            currentRoom
        );
        
        if (!newRoomName) {
            return; // User cancelled
        }
        
        const trimmedName = newRoomName.trim();
        
        // Check if room name actually changed
        if (trimmedName === currentRoom) {
            return; // No change
        }
        
        // Validate room name
        if (!this.validateRoomName(trimmedName)) {
            alert(
                'Invalid room name!\n\n' +
                'Please use only:\n' +
                '• Letters (a-z, A-Z)\n' +
                '• Numbers (0-9)\n' +
                '• Hyphens (-)\n' +
                '• Length: 3-50 characters\n\n' +
                'Examples: my-room, team-canvas-2024, project-alpha'
            );
            return;
        }
        
        // Confirm room switch
        const confirmed = confirm(
            `Switch to room "${trimmedName}"?\n\n` +
            `You will leave "${currentRoom}" and join "${trimmedName}".\n` +
            'Any unsaved work in the current room will remain in that room.'
        );
        
        if (confirmed) {
            // Update URL hash to trigger room switch
            window.location.hash = trimmedName;
        }
    }
    
    async toggleRoomPassword() {
        // Check if user is readonly and wants to upgrade to admin
        if (this.userRole === 'readonly') {
            this.showAdminUpgradeDialog();
            return;
        }
        
        // Only admin users can change passwords
        if (this.userRole !== 'admin') {
            alert('Only administrators can change room passwords.');
            return;
        }
        
        if (this.isPasswordProtected) {
            // Room is currently password protected - ask to remove passwords
            const confirmed = confirm(
                'Remove password protection from this room?\n\n' +
                'Anyone will be able to access this room without a password.'
            );
            
            if (confirmed) {
                await this.setRoomPasswords('', '');
            }
        } else {
            // Room is not password protected - show password setup dialog
            this.showPasswordSetupPopup();
        }
    }
    
    showPasswordSetupPopup() {
        // Hide any existing password popup
        this.hidePasswordPopup();
        
        // Create password popup container
        const passwordPopup = document.createElement('div');
        passwordPopup.id = 'passwordPopup';
        passwordPopup.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 3000;
        `;
        
        const popupContent = document.createElement('div');
        popupContent.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            width: 400px;
            max-width: 90vw;
            font-family: Arial, sans-serif;
        `;
        
        popupContent.innerHTML = `
            <h2 style="margin: 0 0 16px 0; color: #333; font-size: 18px;">
                ${this.isPasswordProtected ? 'Manage Room Passwords' : 'Set Room Passwords'}
            </h2>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: bold; color: #333;">
                    Admin Password:
                </label>
                <input type="password" id="adminPasswordInput" placeholder="Full access + password management" 
                       style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                <div style="font-size: 12px; color: #666; margin-top: 4px;">
                    Admin users can edit everything and change passwords
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: bold; color: #333;">
                    Read-only Password:
                </label>
                <input type="password" id="readonlyPasswordInput" placeholder="View-only access" 
                       style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                <div style="font-size: 12px; color: #666; margin-top: 4px;">
                    Read-only users can view but not edit the canvas
                </div>
            </div>
            
            <div style="font-size: 12px; color: #666; margin-bottom: 20px; padding: 8px; background: #f8f9fa; border-radius: 4px;">
                💡 At least one password must be set. Leave empty to skip that password type.
            </div>
            
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="cancelPasswordBtn" style="padding: 8px 16px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer;">
                    Cancel
                </button>
                <button id="savePasswordBtn" style="padding: 8px 16px; border: none; border-radius: 4px; background: #007bff; color: white; cursor: pointer;">
                    Save Passwords
                </button>
            </div>
        `;
        
        passwordPopup.appendChild(popupContent);
        
        // Add event listeners
        const cancelBtn = popupContent.querySelector('#cancelPasswordBtn');
        const saveBtn = popupContent.querySelector('#savePasswordBtn');
        const adminInput = popupContent.querySelector('#adminPasswordInput');
        const readonlyInput = popupContent.querySelector('#readonlyPasswordInput');
        
        cancelBtn.addEventListener('click', () => this.hidePasswordPopup());
        
        saveBtn.addEventListener('click', () => {
            const adminPwd = adminInput.value.trim();
            const readonlyPwd = readonlyInput.value.trim();
            
            if (!adminPwd && !readonlyPwd) {
                alert('At least one password must be set.');
                return;
            }
            
            this.hidePasswordPopup();
            this.setRoomPasswords(adminPwd, readonlyPwd);
        });
        
        // Close popup when clicking outside
        passwordPopup.addEventListener('click', (e) => {
            if (e.target === passwordPopup) {
                this.hidePasswordPopup();
            }
        });
        
        // Handle Enter key
        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                saveBtn.click();
            }
        };
        
        adminInput.addEventListener('keydown', handleEnter);
        readonlyInput.addEventListener('keydown', handleEnter);
        
        // Add to document and focus first input
        document.body.appendChild(passwordPopup);
        adminInput.focus();
    }
    
    hidePasswordPopup() {
        const popup = document.getElementById('passwordPopup');
        if (popup) {
            popup.remove();
        }
    }
    
    showAdminUpgradeDialog() {
        // Hide any existing password popup
        this.hidePasswordPopup();
        
        // Create admin upgrade popup
        const passwordPopup = document.createElement('div');
        passwordPopup.id = 'passwordPopup';
        passwordPopup.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 3000;
        `;
        
        const popupContent = document.createElement('div');
        popupContent.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            width: 400px;
            max-width: 90vw;
            font-family: Arial, sans-serif;
        `;
        
        popupContent.innerHTML = `
            <h2 style="margin: 0 0 16px 0; color: #333; font-size: 18px;">
                Upgrade to Admin Access
            </h2>
            
            <div style="margin-bottom: 16px; padding: 12px; background: #fff3cd; border-radius: 4px; border: 1px solid #ffeaa7;">
                <div style="font-size: 14px; color: #856404; margin-bottom: 8px;">
                    <strong>Current Access:</strong> Read-only
                </div>
                <div style="font-size: 12px; color: #856404;">
                    Enter the admin password to upgrade to full editing access
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: bold; color: #333;">
                    Admin Password:
                </label>
                <input type="password" id="adminUpgradeInput" placeholder="Enter admin password" 
                       style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                <div style="font-size: 12px; color: #666; margin-top: 4px;">
                    Admin access allows full editing and password management
                </div>
            </div>
            
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="cancelUpgradeBtn" style="padding: 8px 16px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer;">
                    Cancel
                </button>
                <button id="upgradeBtn" style="padding: 8px 16px; border: none; border-radius: 4px; background: #28a745; color: white; cursor: pointer;">
                    Upgrade Access
                </button>
            </div>
        `;
        
        passwordPopup.appendChild(popupContent);
        
        // Add event listeners
        const cancelBtn = popupContent.querySelector('#cancelUpgradeBtn');
        const upgradeBtn = popupContent.querySelector('#upgradeBtn');
        const adminInput = popupContent.querySelector('#adminUpgradeInput');
        
        cancelBtn.addEventListener('click', () => this.hidePasswordPopup());
        
        upgradeBtn.addEventListener('click', () => {
            const adminPassword = adminInput.value.trim();
            
            if (!adminPassword) {
                alert('Please enter the admin password.');
                return;
            }
            
            this.hidePasswordPopup();
            this.upgradeToAdminAccess(adminPassword);
        });
        
        // Close popup when clicking outside
        passwordPopup.addEventListener('click', (e) => {
            if (e.target === passwordPopup) {
                this.hidePasswordPopup();
            }
        });
        
        // Handle Enter key
        adminInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                upgradeBtn.click();
            }
        });
        
        // Add to document and focus input
        document.body.appendChild(passwordPopup);
        adminInput.focus();
    }
    
    async upgradeToAdminAccess(adminPassword) {
        try {
            // Close current WebSocket connection
            if (this.ws) {
                this.ws.close();
            }
            
            // Store the admin password
            localStorage.setItem(`room_password_${this.roomName}`, adminPassword);
            
            // Reconnect with admin password - setupWebSocket will automatically call joinRoomWithPassword
            this.setupWebSocket();
            
            // Show success message
            this.showTemporaryMessage('Access upgraded to Admin!', 'success');
            
        } catch (error) {
            console.error('Error upgrading to admin access:', error);
            alert('Failed to upgrade access. Please try again.');
        }
    }
    
    async setRoomPasswords(adminPassword, readonlyPassword) {
        try {
            const response = await fetch(`/api/room/${this.roomName}/password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    adminPassword: adminPassword,
                    readonlyPassword: readonlyPassword 
                })
            });
            
            if (response.ok) {
                this.isPasswordProtected = adminPassword.length > 0 || readonlyPassword.length > 0;
                this.updateLockIcon();
                
                // Store admin password in localStorage for this room (if set)
                if (adminPassword) {
                    localStorage.setItem(`room_password_${this.roomName}`, adminPassword);
                } else if (readonlyPassword) {
                    localStorage.setItem(`room_password_${this.roomName}`, readonlyPassword);
                } else {
                    localStorage.removeItem(`room_password_${this.roomName}`);
                }
                
                // Send update to other users
                this.sendUpdate('roomPasswordChanged', {
                    isPasswordProtected: this.isPasswordProtected
                });
                
                const message = this.isPasswordProtected ? 
                    'Password protection enabled for this room.' : 
                    'Password protection removed from this room.';
                alert(message);
            } else {
                const error = await response.json();
                alert('Failed to update room passwords: ' + error.message);
            }
        } catch (error) {
            console.error('Error setting room passwords:', error);
            alert('Failed to update room passwords. Please try again.');
        }
    }
    
    async promptForRoomPassword(roomName) {
        // Check if we have a stored password for this room
        const storedPassword = localStorage.getItem(`room_password_${roomName}`);
        if (storedPassword) {
            return storedPassword;
        }
        
        // Prompt user for password
        const password = prompt(
            `Room "${roomName}" is password protected.\n\n` +
            'Enter the password to access this room:'
        );
        
        return password;
    }
    
    updateLockIcon() {
        const lockIcon = document.getElementById('lockIcon');
        if (this.isPasswordProtected) {
            lockIcon.textContent = '🔒';
            lockIcon.className = 'lock-icon locked';
            lockIcon.title = 'Room is password protected - click to manage passwords';
        } else {
            lockIcon.textContent = '🔓';
            lockIcon.className = 'lock-icon unlocked';
            lockIcon.title = 'Room is not protected - click to set passwords';
        }
    }
    
    updateUserRoleDisplay() {
        const userRoleElement = document.getElementById('userRole');
        if (userRoleElement) {
            if (this.userRole === 'readonly') {
                userRoleElement.textContent = '👁️ Read-only';
                userRoleElement.className = 'user-role readonly';
                userRoleElement.title = 'You have read-only access to this room';
            } else {
                userRoleElement.textContent = '✏️ Admin';
                userRoleElement.className = 'user-role admin';
                userRoleElement.title = 'You have full access to this room';
            }
        }
        
        // Update UI elements based on user role
        this.updateUIForUserRole();
    }
    
    canUserWrite() {
        return this.userRole === 'admin';
    }
    
    showReadOnlyError() {
        alert('You have read-only access to this room. Only administrators can make changes.');
    }
    
    updateUIForUserRole() {
        const readonlyElements = [
            'squareBtn', 'circleBtn', 'triangleBtn', 'textBtn', 'starBtn',
            'clearBtn', 'uploadBtn', 'addLayerBtn', 'deleteLayerBtn',
            'lockIcon'
        ];
        
        readonlyElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                if (this.userRole === 'readonly') {
                    element.disabled = true;
                    element.style.opacity = '0.5';
                    element.style.cursor = 'not-allowed';
                    element.title = 'Read-only access - cannot edit';
                } else {
                    element.disabled = false;
                    element.style.opacity = '';
                    element.style.cursor = '';
                    element.title = element.getAttribute('data-original-title') || '';
                }
            }
        });
    }
    
    async joinRoomWithPassword() {
        try {
            this.isJoiningRoom = true;
            
            // First, check if the room requires a password
            const checkResponse = await fetch(`/api/room/${this.roomName}/check`);
            const checkData = await checkResponse.json();
            
            let password = null;
            if (checkData.requiresPassword) {
                password = await this.promptForRoomPassword(this.roomName);
                if (password === null) {
                    // User cancelled password prompt
                    alert('Access cancelled. You will be redirected to a new room.');
                    window.location.hash = '';
                    window.location.reload();
                    return;
                }
            }
            
            // Send join room request with password if needed
            this.ws.send(JSON.stringify({
                type: 'joinRoom',
                data: {
                    roomName: this.roomName,
                    password: password
                }
            }));
            
        } catch (error) {
            console.error('Error joining room:', error);
            this.isJoiningRoom = false;
            alert('Failed to join room. Please try again.');
        }
    }
    
    throttledSendCursor(e) {
        const now = Date.now();
        if (now - this.lastMouseUpdate < 50) return; // Throttle to 20fps
        
        this.lastMouseUpdate = now;
        this.updateMousePosition(e);
        
        this.sendUpdate('cursor', {
            x: this.mouse.x,
            y: this.mouse.y,
            worldX: this.mouse.worldX,
            worldY: this.mouse.worldY,
            action: this.getCurrentAction()
        });
    }
    
    getCurrentAction() {
        if (this.isSizing) return `sizing ${this.selectedShape}`;
        if (this.isPlacing) return `placing ${this.selectedShape}`;
        if (this.isResizing) return 'resizing';
        if (this.isRotating) return 'rotating';
        if (this.mouse.isDragging && this.selectedElement) return 'moving';
        if (this.mouse.isDragging) return 'panning';
        return 'idle';
    }
    
    updateOtherUserCursor(data) {
        if (data.userId === this.userId) return; // Don't show own cursor
        
        this.otherUsers.set(data.userId, {
            userName: data.userName,
            x: data.x,
            y: data.y,
            worldX: data.worldX,
            worldY: data.worldY,
            action: data.action,
            lastUpdate: Date.now(),
            color: this.getUserColor(data.userId)
        });
        
        // Remove old cursor positions
        setTimeout(() => {
            const user = this.otherUsers.get(data.userId);
            if (user && Date.now() - user.lastUpdate > 3000) {
                this.otherUsers.delete(data.userId);
                this.render();
            }
        }, 3000);
    }
    
    getUserColor(userId) {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43'];
        const hash = userId.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);
        return colors[Math.abs(hash) % colors.length];
    }
    
    drawOtherUsersCursors() {
        this.otherUsers.forEach((user, userId) => {
            this.drawUserCursor(user);
        });
    }
    
    showTooltip(text, x, y) {
        if (this.tooltip.timer) {
            clearTimeout(this.tooltip.timer);
        }
        
        this.tooltip.timer = setTimeout(() => {
            this.tooltip.visible = true;
            this.tooltip.text = text;
            this.tooltip.x = x;
            this.tooltip.y = y;
            this.render();
        }, 500); // Show tooltip after 500ms delay
    }
    
    hideTooltip() {
        if (this.tooltip.timer) {
            clearTimeout(this.tooltip.timer);
            this.tooltip.timer = null;
        }
        if (this.tooltip.visible) {
            this.tooltip.visible = false;
            this.render();
        }
    }
    
    drawTooltip() {
        if (!this.tooltip.visible) return;
        
        const padding = 8;
        const fontSize = 12;
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        
        const textWidth = this.ctx.measureText(this.tooltip.text).width;
        const textHeight = fontSize;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = textHeight + padding * 2;
        
        // Adjust position to keep tooltip on screen
        let tooltipX = this.tooltip.x + 10;
        let tooltipY = this.tooltip.y - boxHeight - 10;
        
        if (tooltipX + boxWidth > this.canvas.width) {
            tooltipX = this.tooltip.x - boxWidth - 10;
        }
        if (tooltipY < 0) {
            tooltipY = this.tooltip.y + 20;
        }
        
        // Draw tooltip background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(tooltipX, tooltipY, boxWidth, boxHeight);
        
        // Draw tooltip border
        this.ctx.strokeStyle = '#555';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(tooltipX, tooltipY, boxWidth, boxHeight);
        
        // Draw tooltip text
        this.ctx.fillStyle = '#fff';
        this.ctx.fillText(this.tooltip.text, tooltipX + padding, tooltipY + padding);
    }
    
    checkTooltips() {
        let tooltipText = null;
        
        // Check for handles and show appropriate tooltips
        if (this.getRotateHandle(this.mouse.x, this.mouse.y)) {
            tooltipText = this.selectedElements.size > 1 ? 'Rotate selection' : 'Rotate element';
        } else if (this.getBringForwardHandle(this.mouse.x, this.mouse.y)) {
            tooltipText = 'Bring forward';
        } else if (this.getBringBackwardHandle(this.mouse.x, this.mouse.y)) {
            tooltipText = 'Send backward';
        } else if (this.getColorPickerHandle(this.mouse.x, this.mouse.y)) {
            tooltipText = 'Change color';
        } else if (this.getTextFormatHandle(this.mouse.x, this.mouse.y)) {
            tooltipText = 'Format text';
        } else if (this.getGroupHandle(this.mouse.x, this.mouse.y)) {
            const allElementsGrouped = Array.from(this.selectedElements).every(element => element.groupId);
            tooltipText = allElementsGrouped ? 'Ungroup shapes' : 'Group shapes';
        } else if (this.getDeleteHandle(this.mouse.x, this.mouse.y)) {
            tooltipText = this.selectedElements.size > 1 ? 'Delete selection' : 'Delete element';
        } else if (this.getResizeHandle(this.mouse.x, this.mouse.y)) {
            tooltipText = 'Resize element';
        }
        
        if (tooltipText) {
            this.showTooltip(tooltipText, this.mouse.x, this.mouse.y);
        } else {
            this.hideTooltip();
        }
    }
    
    updateCursor() {
        let cursor = '';
        
        // Check for rotation handle
        if (this.getRotateHandle(this.mouse.x, this.mouse.y)) {
            cursor = 'crosshair';
        } else if (this.getResizeHandle(this.mouse.x, this.mouse.y)) {
            cursor = 'nw-resize';
        } else if (this.getBringForwardHandle(this.mouse.x, this.mouse.y) || 
                   this.getBringBackwardHandle(this.mouse.x, this.mouse.y) ||
                   this.getColorPickerHandle(this.mouse.x, this.mouse.y) ||
                   this.getTextFormatHandle(this.mouse.x, this.mouse.y) ||
                   this.getGroupHandle(this.mouse.x, this.mouse.y) ||
                   this.getDeleteHandle(this.mouse.x, this.mouse.y)) {
            cursor = 'pointer';
        }
        
        this.canvas.style.cursor = cursor;
    }
    
    // Draw selection box
    drawSelectionBox() {
        if (!this.selectionBox || !this.isSelecting) return;
        
        const box = this.selectionBox;
        const startScreen = this.worldToScreen(box.x, box.y);
        const endScreen = this.worldToScreen(box.x + box.width, box.y + box.height);
        
        this.ctx.strokeStyle = '#007bff';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(startScreen.x, startScreen.y, 
                          endScreen.x - startScreen.x, 
                          endScreen.y - startScreen.y);
        
        this.ctx.fillStyle = 'rgba(0, 123, 255, 0.1)';
        this.ctx.fillRect(startScreen.x, startScreen.y, 
                         endScreen.x - startScreen.x, 
                         endScreen.y - startScreen.y);
        
        this.ctx.setLineDash([]);
    }
    
    // Draw multi-selection highlights
    drawMultiSelectionHighlights() {
        if (this.selectedElements.size <= 1) return;
        
        this.selectedElements.forEach(element => {
            if (element === this.selectedElement) return; // Skip primary selection
            
            const screenPos = this.worldToScreen(element.x, element.y);
            const w = element.width * this.camera.zoom;
            const h = element.height * this.camera.zoom;
            
            // Different highlight for grouped elements
            if (element.groupId) {
                this.ctx.strokeStyle = '#6f42c1'; // Purple for grouped
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([5, 2]);
            } else {
                this.ctx.strokeStyle = '#28a745'; // Green for multi-select
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([3, 3]);
            }
            
            this.ctx.strokeRect(screenPos.x - w/2, screenPos.y - h/2, w, h);
            this.ctx.setLineDash([]);
        });
    }
    
    drawUserCursor(user) {
        // Draw cursor pointer
        this.ctx.save();
        this.ctx.translate(user.x, user.y);
        this.ctx.rotate(-Math.PI / 4);
        
        this.ctx.fillStyle = user.color;
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(8, 0);
        this.ctx.lineTo(3, 5);
        this.ctx.lineTo(5, 7);
        this.ctx.lineTo(0, 12);
        this.ctx.closePath();
        this.ctx.fill();
        
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
        
        this.ctx.restore();
        
        // Draw user name and action
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(user.x + 12, user.y - 20, 
            this.ctx.measureText(`${user.userName} - ${user.action}`).width + 8, 16);
        
        this.ctx.fillStyle = 'white';
        this.ctx.font = '11px Arial';
        this.ctx.fillText(`${user.userName} - ${user.action}`, user.x + 16, user.y - 8);
    }
    
    updateUserCount(count) {
        document.getElementById('userCount').textContent = `👥 ${count}`;
    }
    
    drawUserLabelsForShapes() {
        // Group shapes by user
        const userShapes = new Map();
        
        this.shapeUsers.forEach((shapeUser, shapeId) => {
            if (shapeUser.userId !== this.userId) {
                if (!userShapes.has(shapeUser.userId)) {
                    userShapes.set(shapeUser.userId, {
                        user: shapeUser,
                        shapes: []
                    });
                }
                
                const element = this.elements.find(el => el.id === shapeId);
                if (element && this.isElementVisible(element) && this.isElementInVisibleLayer(element)) {
                    userShapes.get(shapeUser.userId).shapes.push(element);
                }
            }
        });
        
        // Draw one label per user
        userShapes.forEach((userInfo, userId) => {
            if (userInfo.shapes.length > 0) {
                // Calculate center position of all shapes for this user
                let centerX = 0, centerY = 0;
                let minY = Infinity;
                
                userInfo.shapes.forEach(shape => {
                    const screenPos = this.worldToScreen(shape.x, shape.y);
                    centerX += screenPos.x;
                    centerY += screenPos.y;
                    minY = Math.min(minY, screenPos.y - (shape.height * this.camera.zoom / 2));
                });
                
                centerX /= userInfo.shapes.length;
                centerY /= userInfo.shapes.length;
                
                // Draw label above the topmost shape
                const labelY = minY - 25;
                const shapeCount = userInfo.shapes.length;
                const labelText = shapeCount === 1 ? 
                    `${userInfo.user.userName} - ${userInfo.user.action}` : 
                    `${userInfo.user.userName} - ${userInfo.user.action} (${shapeCount} shapes)`;
                
                this.drawShapeUserLabel(centerX, labelY, labelText, userInfo.user.color);
            }
        });
    }
    
    drawShapeUserLabel(x, y, labelText, color) {
        // Measure text width
        this.ctx.font = '12px Arial';
        const textWidth = this.ctx.measureText(labelText).width;
        
        // Draw background
        this.ctx.fillStyle = color;
        this.ctx.fillRect(
            x - textWidth/2 - 6,
            y - 2,
            textWidth + 12,
            16
        );
        
        // Draw border
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(
            x - textWidth/2 - 6,
            y - 2,
            textWidth + 12,
            16
        );
        
        // Draw text
        this.ctx.fillStyle = 'white';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(labelText, x, y + 10);
        
        // Draw small arrow pointing down
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(x - 4, y + 14);
        this.ctx.lineTo(x + 4, y + 14);
        this.ctx.lineTo(x, y + 20);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
    }
    
    // Layers System
    addLayer() {
        const newLayer = {
            id: 'layer_' + Date.now(),
            name: `Layer ${this.layers.length + 1}`,
            visible: true,
            locked: false,
            elements: []
        };
        
        this.layers.push(newLayer);
        this.activeLayerId = newLayer.id;
        this.updateLayerUI();
        this.saveToHistory('Add layer');
        
        // Send layer update to server
        this.sendUpdate('addLayer', newLayer);
    }
    
    deleteLayer() {
        if (this.layers.length <= 1) {
            alert('Cannot delete the last layer');
            return;
        }
        
        const layerIndex = this.layers.findIndex(layer => layer.id === this.activeLayerId);
        if (layerIndex === -1) return;
        
        const layer = this.layers[layerIndex];
        
        // Remove elements from this layer
        layer.elements.forEach(elementId => {
            const elementIndex = this.elements.findIndex(el => el.id === elementId);
            if (elementIndex !== -1) {
                const element = this.elements[elementIndex];
                this.elements.splice(elementIndex, 1);
                this.sendUpdate('delete', { id: element.id });
            }
        });
        
        // Remove layer
        this.layers.splice(layerIndex, 1);
        
        // Set new active layer
        this.activeLayerId = this.layers[Math.max(0, layerIndex - 1)].id;
        
        this.updateLayerUI();
        this.saveToHistory('Delete layer');
        this.render();
        
        // Send layer deletion to server
        this.sendUpdate('deleteLayer', { id: layer.id });
    }
    
    addElementToLayer(element) {
        if (!element.layerId) {
            element.layerId = this.activeLayerId;
        }
        
        const layer = this.layers.find(l => l.id === element.layerId);
        if (layer && !layer.elements.includes(element.id)) {
            layer.elements.push(element.id);
            console.log(`Added element ${element.id} to layer ${layer.name}`);
        } else if (!layer) {
            console.warn(`Layer ${element.layerId} not found for element ${element.id}`);
        }
        
        // Update layer UI to reflect new element count
        this.updateLayerUI();
    }
    
    removeElementFromLayer(element) {
        // Remove from all layers to be safe
        this.layers.forEach(layer => {
            const index = layer.elements.indexOf(element.id);
            if (index !== -1) {
                layer.elements.splice(index, 1);
            }
        });
        
        // Update layer UI to reflect new element count
        this.updateLayerUI();
    }
    
    toggleLayerVisibility(layerId) {
        const layer = this.layers.find(l => l.id === layerId);
        if (layer) {
            layer.visible = !layer.visible;
            this.updateLayerUI();
            this.render();
            
            // Send layer update to server
            this.sendUpdate('updateLayer', layer);
        }
    }
    
    toggleLayerLock(layerId) {
        const layer = this.layers.find(l => l.id === layerId);
        if (layer) {
            layer.locked = !layer.locked;
            
            // If layer is now locked, deselect any selected elements in this layer
            if (layer.locked) {
                this.deselectElementsInLayer(layerId);
            }
            
            this.updateLayerUI();
            
            // Send layer update to server
            this.sendUpdate('updateLayer', layer);
        }
    }
    
    setActiveLayer(layerId) {
        this.activeLayerId = layerId;
        this.updateLayerUI();
        
        // Note: Don't send active layer to server as it's per-user preference
    }
    
    updateLayerUI() {
        const layersList = document.getElementById('layersList');
        if (!layersList) return;
        
        layersList.innerHTML = '';
        
        this.layers.forEach(layer => {
            const layerItem = document.createElement('div');
            layerItem.className = 'layer-item';
            layerItem.innerHTML = `
                <button class="layer-visibility" onclick="canvas.toggleLayerVisibility('${layer.id}')">
                    ${layer.visible ? '👁️' : '🚫'}
                </button>
                <button class="layer-lock" onclick="canvas.toggleLayerLock('${layer.id}')">
                    ${layer.locked ? '🔒' : '🔓'}
                </button>
                <span class="layer-name" onclick="canvas.setActiveLayer('${layer.id}')">${layer.name}</span>
                <span class="layer-count">(${layer.elements.length})</span>
            `;
            layersList.appendChild(layerItem);
        });
        
        console.log('Updated layer UI. Active layer:', this.activeLayerId);
    }
    
    isElementInVisibleLayer(element) {
        // If element doesn't have a layer, assign it to active layer
        if (!element.layerId) {
            element.layerId = this.activeLayerId;
            this.addElementToLayer(element);
        }
        
        const layer = this.layers.find(l => l.id === element.layerId);
        return layer && layer.visible;
    }
    
    // Rebuild layer-element relationships after loading
    rebuildLayerElementRelationships() {
        console.log('Rebuilding layer-element relationships...');
        console.log('Elements:', this.elements.length);
        console.log('Layers:', this.layers.length);
        
        // Clear all layer elements
        this.layers.forEach(layer => {
            layer.elements = [];
        });
        
        // Add elements back to their layers
        this.elements.forEach(element => {
            if (!element.layerId) {
                element.layerId = this.activeLayerId || this.layers[0]?.id;
                console.log(`Assigned element ${element.id} to layer ${element.layerId}`);
            }
            this.addElementToLayer(element);
        });
        
        // Clear any selections that are now in hidden or locked layers
        this.clearInvalidSelections();
        
        console.log('Layer element counts:', this.layers.map(l => ({ name: l.name, count: l.elements.length })));
    }
    
    // Export functionality
    showExportDialog() {
        const dialog = document.getElementById('exportDialog');
        if (dialog) {
            dialog.style.display = 'block';
        }
    }
    
    hideExportDialog() {
        const dialog = document.getElementById('exportDialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }
    
    exportCanvas(format, options = {}) {
        const { width = 1920, height = 1080, background = '#ffffff' } = options;
        
        // Create temporary canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Set background
        tempCtx.fillStyle = background;
        tempCtx.fillRect(0, 0, width, height);
        
        // Calculate bounds of all elements
        const bounds = this.calculateElementsBounds();
        
        // Calculate scale and offset to fit all elements
        const scale = Math.min(
            (width * 0.8) / bounds.width,
            (height * 0.8) / bounds.height
        );
        
        const offsetX = (width - bounds.width * scale) / 2 - bounds.minX * scale;
        const offsetY = (height - bounds.height * scale) / 2 - bounds.minY * scale;
        
        // Sort elements by layer order and z-index within each layer (same as main render)
        const sortedElements = [...this.elements].sort((a, b) => {
            // First sort by layer order
            const layerAIndex = this.layers.findIndex(l => l.id === a.layerId);
            const layerBIndex = this.layers.findIndex(l => l.id === b.layerId);
            if (layerAIndex !== layerBIndex) {
                return layerAIndex - layerBIndex;
            }
            
            // Then sort by z-index within the same layer
            const zIndexA = a.zIndex || 0;
            const zIndexB = b.zIndex || 0;
            return zIndexA - zIndexB;
        });
        
        // Draw elements in correct order
        sortedElements.forEach(element => {
            if (!this.isElementInVisibleLayer(element)) return;
            
            tempCtx.save();
            tempCtx.translate(
                element.x * scale + offsetX,
                element.y * scale + offsetY
            );
            tempCtx.rotate(element.rotation || 0);
            tempCtx.scale(scale, scale);
            
            this.drawElementOnContext(tempCtx, element);
            tempCtx.restore();
        });
        
        // Export based on format
        switch (format) {
            case 'png':
                this.downloadCanvasAsPNG(tempCanvas);
                break;
            case 'jpg':
                this.downloadCanvasAsJPG(tempCanvas);
                break;
            case 'svg':
                this.exportAsSVG(options);
                break;
        }
        
        this.hideExportDialog();
    }
    
    calculateElementsBounds() {
        if (this.elements.length === 0) {
            return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        this.elements.forEach(element => {
            if (!this.isElementInVisibleLayer(element)) return;
            
            const left = element.x - element.width / 2;
            const right = element.x + element.width / 2;
            const top = element.y - element.height / 2;
            const bottom = element.y + element.height / 2;
            
            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, right);
            maxY = Math.max(maxY, bottom);
        });
        
        return {
            minX, minY, maxX, maxY,
            width: maxX - minX,
            height: maxY - minY
        };
    }
    
    drawElementOnContext(ctx, element) {
        ctx.fillStyle = element.color;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        
        switch (element.shape) {
            case 'square':
            case 'rectangle':
                ctx.fillRect(-element.width/2, -element.height/2, element.width, element.height);
                ctx.strokeRect(-element.width/2, -element.height/2, element.width, element.height);
                break;
            case 'circle':
                ctx.beginPath();
                ctx.arc(0, 0, element.width/2, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                break;
            case 'triangle':
                ctx.beginPath();
                ctx.moveTo(0, -element.height/2);
                ctx.lineTo(-element.width/2, element.height/2);
                ctx.lineTo(element.width/2, element.height/2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            case 'star':
                this.drawStarOnContext(ctx, 0, 0, 5, element.width/2, element.width/4);
                ctx.fill();
                ctx.stroke();
                break;
            case 'image':
                // Draw image on export context
                if (this.imageCache && this.imageCache.has(element.filename)) {
                    const img = this.imageCache.get(element.filename);
                    if (img.complete && img.naturalWidth > 0) {
                        ctx.drawImage(img, -element.width/2, -element.height/2, element.width, element.height);
                    }
                }
                break;
            case 'text':
                // Draw text on export context
                const fontSize = element.fontSize || 20;
                const fontFamily = element.fontFamily || 'Arial';
                const fontWeight = element.fontWeight || 'normal';
                const fontStyle = element.fontStyle || 'normal';
                
                ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = element.color;
                
                const text = element.text || 'Double-click to edit';
                const lines = text.split('\n');
                const lineHeight = fontSize * 1.2;
                const totalHeight = lines.length * lineHeight;
                const startY = -(totalHeight / 2) + (lineHeight / 2);
                
                lines.forEach((line, index) => {
                    const y = startY + (index * lineHeight);
                    ctx.fillText(line, 0, y);
                    
                    // Draw strikethrough if enabled
                    if (element.textDecoration === 'line-through') {
                        const textWidth = ctx.measureText(line).width;
                        ctx.strokeStyle = element.color;
                        ctx.lineWidth = Math.max(1, fontSize * 0.05);
                        ctx.beginPath();
                        ctx.moveTo(-textWidth/2, y);
                        ctx.lineTo(textWidth/2, y);
                        ctx.stroke();
                    }
                });
                break;
        }
        
        if (element.text) {
            ctx.fillStyle = '#333';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(element.text, 0, 5);
        }
    }
    
    drawStarOnContext(ctx, x, y, spikes, outerRadius, innerRadius) {
        let rot = Math.PI / 2 * 3;
        let step = Math.PI / spikes;
        
        ctx.beginPath();
        ctx.moveTo(x, y - outerRadius);
        
        for (let i = 0; i < spikes; i++) {
            let x1 = x + Math.cos(rot) * outerRadius;
            let y1 = y + Math.sin(rot) * outerRadius;
            ctx.lineTo(x1, y1);
            rot += step;
            
            x1 = x + Math.cos(rot) * innerRadius;
            y1 = y + Math.sin(rot) * innerRadius;
            ctx.lineTo(x1, y1);
            rot += step;
        }
        
        ctx.lineTo(x, y - outerRadius);
        ctx.closePath();
    }
    
    downloadCanvasAsPNG(canvas) {
        const link = document.createElement('a');
        link.download = 'canvas-export.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }
    
    downloadCanvasAsJPG(canvas) {
        const link = document.createElement('a');
        link.download = 'canvas-export.jpg';
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
    }
    
    exportAsSVG(options = {}) {
        const { width = 1920, height = 1080, background = '#ffffff' } = options;
        const bounds = this.calculateElementsBounds();
        
        const scale = Math.min(
            (width * 0.8) / bounds.width,
            (height * 0.8) / bounds.height
        );
        
        const offsetX = (width - bounds.width * scale) / 2 - bounds.minX * scale;
        const offsetY = (height - bounds.height * scale) / 2 - bounds.minY * scale;
        
        let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
        svg += `<rect width="${width}" height="${height}" fill="${background}"/>`;
        
        // Sort elements by layer order and z-index within each layer (same as main render)
        const sortedElements = [...this.elements].sort((a, b) => {
            // First sort by layer order
            const layerAIndex = this.layers.findIndex(l => l.id === a.layerId);
            const layerBIndex = this.layers.findIndex(l => l.id === b.layerId);
            if (layerAIndex !== layerBIndex) {
                return layerAIndex - layerBIndex;
            }
            
            // Then sort by z-index within the same layer
            const zIndexA = a.zIndex || 0;
            const zIndexB = b.zIndex || 0;
            return zIndexA - zIndexB;
        });
        
        sortedElements.forEach(element => {
            if (!this.isElementInVisibleLayer(element)) return;
            
            const x = element.x * scale + offsetX;
            const y = element.y * scale + offsetY;
            const w = element.width * scale;
            const h = element.height * scale;
            
            let transform = `translate(${x}, ${y})`;
            if (element.rotation) {
                transform += ` rotate(${element.rotation * 180 / Math.PI})`;
            }
            
            svg += `<g transform="${transform}">`;
            
            switch (element.shape) {
                case 'square':
                case 'rectangle':
                    svg += `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="${element.color}" stroke="#333" stroke-width="1"/>`;
                    break;
                case 'circle':
                    svg += `<circle cx="0" cy="0" r="${w/2}" fill="${element.color}" stroke="#333" stroke-width="1"/>`;
                    break;
                case 'triangle':
                    svg += `<polygon points="0,${-h/2} ${-w/2},${h/2} ${w/2},${h/2}" fill="${element.color}" stroke="#333" stroke-width="1"/>`;
                    break;
                case 'text':
                    const fontSize = (element.fontSize || 20) * scale;
                    const fontFamily = element.fontFamily || 'Arial';
                    const fontWeight = element.fontWeight || 'normal';
                    const fontStyle = element.fontStyle || 'normal';
                    const textDecoration = element.textDecoration === 'line-through' ? 'line-through' : 'none';
                    
                    const text = element.text || 'Double-click to edit';
                    const lines = text.split('\n');
                    const lineHeight = fontSize * 1.2;
                    const totalHeight = lines.length * lineHeight;
                    const startY = -(totalHeight / 2) + (lineHeight / 2);
                    
                    lines.forEach((line, index) => {
                        const y = startY + (index * lineHeight);
                        svg += `<text x="0" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" font-style="${fontStyle}" text-decoration="${textDecoration}" fill="${element.color}">${line}</text>`;
                    });
                    break;
            }
            
            if (element.text) {
                svg += `<text x="0" y="5" text-anchor="middle" font-family="Arial" font-size="14" fill="#333">${element.text}</text>`;
            }
            
            svg += '</g>';
        });
        
        svg += '</svg>';
        
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const link = document.createElement('a');
        link.download = 'canvas-export.svg';
        link.href = URL.createObjectURL(blob);
        link.click();
    }
    
}

const canvas = new InfiniteCanvas();

// Additional UI event handlers
document.addEventListener('DOMContentLoaded', () => {
    // Export size selector
    const exportSize = document.getElementById('exportSize');
    const customSize = document.getElementById('customSize');
    
    if (exportSize) {
        exportSize.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customSize.style.display = 'flex';
            } else {
                customSize.style.display = 'none';
                const [width, height] = e.target.value.split('x');
                document.getElementById('customWidth').value = width;
                document.getElementById('customHeight').value = height;
            }
        });
    }
    
    // Close modal when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            canvas.hideExportDialog();
        }
    });
    
    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('exportDialog').style.display === 'block') {
            canvas.hideExportDialog();
        }
    });
    
    // Auto-collapse side panel on mobile
    function handleResize() {
        const sidePanel = document.getElementById('sidePanel');
        const toggle = document.getElementById('sidePanelToggle');
        
        if (window.innerWidth <= 768) {
            sidePanel.classList.remove('expanded');
            if (toggle) toggle.textContent = '📋';
        } else {
            sidePanel.classList.remove('expanded');
            if (toggle) toggle.textContent = '📋';
        }
    }
    
    // Handle window resize
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check
});