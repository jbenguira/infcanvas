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
        this.isResizing = false;
        this.isRotating = false;
        this.resizeHandle = null;
        this.isEditingLabel = false;
        this.isSelecting = false; // For selection box
        this.selectionBox = null;
        this.clipboard = [];
        
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
        this.setupWebSocket();
        this.saveToHistory('Initial state');
        this.updateLayerUI();
        this.render();
        
        // Set initial username in UI
        document.getElementById('username').textContent = `👤 ${this.userName}`;
        
        window.addEventListener('resize', () => this.resizeCanvas());
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
        
        // History controls
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('redoBtn').addEventListener('click', () => this.redo());
        
        // Layer controls
        document.getElementById('addLayerBtn').addEventListener('click', () => this.addLayer());
        document.getElementById('deleteLayerBtn').addEventListener('click', () => this.deleteLayer());
        
        // Export controls
        document.getElementById('exportBtn').addEventListener('click', () => this.showExportDialog());
        
        // Snap to grid toggle
        document.getElementById('snapToggle').addEventListener('click', () => this.toggleSnapToGrid());
        
        // Side panel toggle for mobile
        document.getElementById('sidePanelToggle').addEventListener('click', () => this.toggleSidePanel());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
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
            this.placeShape(this.mouse.worldX, this.mouse.worldY);
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
        
        const deleteHandle = this.getDeleteHandle(this.mouse.x, this.mouse.y);
        if (deleteHandle) {
            this.deleteSelectedElements();
            return;
        }
        
        const clickedElement = this.getElementAtPosition(this.mouse.worldX, this.mouse.worldY);
        
        if (clickedElement) {
            if (e.detail === 2) {
                this.startLabelEdit(clickedElement);
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
                    // Single selection
                    this.selectedElements.clear();
                    this.selectedElements.add(clickedElement);
                    this.selectedElement = clickedElement;
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
        
        // Check for tooltips (only when not dragging)
        if (!this.mouse.isDragging && !this.isResizing && !this.isRotating) {
            this.checkTooltips();
        } else {
            this.hideTooltip();
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
            
            // Draw user name if someone is manipulating this shape
            const shapeUser = this.shapeUsers.get(element.id);
            if (shapeUser && shapeUser.userId !== this.userId) {
                this.drawShapeUserLabel(element, screenPos, shapeUser);
            }
        });
        
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
            
            // Check for delete handle
            const deleteHandle = this.getDeleteHandle(this.mouse.x, this.mouse.y);
            if (deleteHandle) {
                this.deleteSelectedElements();
                return;
            }
            
            // Check if touching an element
            const touchedElement = this.getElementAtPosition(this.mouse.worldX, this.mouse.worldY);
            
            if (touchedElement) {
                // Check if touched element is part of multi-selection
                if (this.selectedElements.has(touchedElement) && this.selectedElements.size > 1) {
                    // Prepare for multi-element drag
                    this.selectedElement = touchedElement;
                    this.mouse.isDragging = true;
                    this.mouse.dragStartX = this.mouse.worldX - touchedElement.x;
                    this.mouse.dragStartY = this.mouse.worldY - touchedElement.y;
                } else {
                    // Simulate mouse down for element selection
                    const mouseEvent = {
                        clientX: e.touches[0].clientX,
                        clientY: e.touches[0].clientY,
                        ctrlKey: false,
                        metaKey: false,
                        detail: 1
                    };
                    this.handleMouseDown(mouseEvent);
                }
            } else {
                // Start panning
                this.mouse.isDragging = true;
                this.mouse.dragStartX = this.mouse.x;
                this.mouse.dragStartY = this.mouse.y;
                this.mouse.cameraStartX = this.camera.x;
                this.mouse.cameraStartY = this.camera.y;
                this.selectedElement = null;
                this.selectedElements.clear();
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
                // Moving selected element
                const mouseEvent = {
                    clientX: e.touches[0].clientX,
                    clientY: e.touches[0].clientY
                };
                this.handleMouseMove(mouseEvent);
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
                // Finish element manipulation
                const mouseEvent = {
                    clientX: e.changedTouches[0].clientX,
                    clientY: e.changedTouches[0].clientY
                };
                this.handleMouseUp(mouseEvent);
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
        this.ctx.save();
        this.ctx.translate(screenPos.x, screenPos.y);
        this.ctx.rotate(element.rotation || 0);
        this.ctx.scale(this.camera.zoom, this.camera.zoom);
        
        this.ctx.fillStyle = element.color;
        this.ctx.strokeStyle = element === this.selectedElement ? '#007bff' : '#333';
        this.ctx.lineWidth = element === this.selectedElement ? 3 : 1;
        
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
        }
        
        if (element.text) {
            this.ctx.fillStyle = '#333';
            this.ctx.font = '14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(element.text, 0, 5);
        }
        
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
        
        document.getElementById('mode').textContent = `Click to place ${shape} (click button again to exit)`;
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
    
    exitPlacementMode() {
        document.querySelectorAll('.shape-btn').forEach(btn => btn.classList.remove('active'));
        this.selectedShape = null;
        this.mode = 'select';
        this.isPlacing = false;
        this.canvas.className = '';
        document.getElementById('mode').textContent = 'Select a shape or click existing shapes to edit';
    }
    
    getRandomColor() {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF'];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    getElementAtPosition(worldX, worldY) {
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const element = this.elements[i];
            
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
            this.ctx.fillStyle = '#28a745';
            const rotateY = top - (isMobile ? 30 : 20);
            this.ctx.beginPath();
            this.ctx.arc(screenPos.x, rotateY, rotateRadius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
            
            // Draw z-index and delete controls in a vertical column
            const iconSize = isMobile ? 20 : 14;
            const iconSpacing = isMobile ? 4 : 3;
            const iconColumn = right + (isMobile ? 15 : 12);
            
            // Calculate positions for all three icons
            const totalHeight = iconSize * 3 + iconSpacing * 2;
            const startY = top - (isMobile ? 5 : 2);
            
            const upArrowX = iconColumn;
            const upArrowY = startY;
            const deleteX = iconColumn;
            const deleteY = startY + iconSize + iconSpacing;
            const downArrowX = iconColumn;
            const downArrowY = startY + (iconSize + iconSpacing) * 2;
            
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
            this.ctx.fillStyle = '#28a745';
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            
            const rotateDistance = isMobile ? 30 : 20;
            const rotateX = centerScreen.x;
            const rotateY = centerScreen.y - selectionBounds.height * this.camera.zoom / 2 - rotateDistance;
            
            this.ctx.beginPath();
            this.ctx.arc(rotateX, rotateY, rotateRadius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
            
            // Draw delete handle for multi-selection
            this.ctx.fillStyle = '#dc3545';
            const deleteX = centerScreen.x + selectionBounds.width * this.camera.zoom / 2 + (isMobile ? 20 : 15);
            const deleteY = centerScreen.y - selectionBounds.height * this.camera.zoom / 2 - (isMobile ? 10 : 5);
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
        if (!this.selectedElement) return null;
        
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
            
            return (dx * dx + dy * dy <= rotateRadius * rotateRadius);
        } else {
            // Multi-element rotation handle (at selection center)
            const selectionBounds = this.getSelectionBounds();
            const centerScreen = this.worldToScreen(selectionBounds.centerX, selectionBounds.centerY);
            
            const rotateX = centerScreen.x;
            const rotateY = centerScreen.y - selectionBounds.height * this.camera.zoom / 2 - rotateDistance;
            
            const dx = screenX - rotateX;
            const dy = screenY - rotateY;
            
            return (dx * dx + dy * dy <= rotateRadius * rotateRadius);
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
        const downArrowY = startY + (iconSize + iconSpacing) * 2;
        
        return this.isPointInRect(screenX, screenY, downArrowX, downArrowY, iconSize, iconSize);
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
            const deleteY = startY + iconSize + iconSpacing;
            
            return this.isPointInRect(screenX, screenY, deleteX, deleteY, iconSize, iconSize);
        } else {
            // Multi-element delete handle
            const selectionBounds = this.getSelectionBounds();
            const centerScreen = this.worldToScreen(selectionBounds.centerX, selectionBounds.centerY);
            
            const deleteX = centerScreen.x + selectionBounds.width * this.camera.zoom / 2 + deleteDistance;
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

    deleteSelectedElements() {
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
        const newWidth = Math.max(20, Math.abs(newRight - newLeft));
        const newHeight = Math.max(20, Math.abs(newBottom - newTop));
        
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
    
    // Keyboard shortcuts handler
    handleKeyDown(e) {
        // Don't handle shortcuts when editing labels
        if (this.isEditingLabel) return;
        
        // Handle escape key
        if (e.key === 'Escape') {
            if (this.isPlacing) {
                this.exitPlacementMode();
            } else {
                this.selectedElements.clear();
                this.selectedElement = null;
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
    
    duplicateSelectedElements() {
        this.copySelectedElements();
        this.pasteElements();
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
            this.updateConnectionStatus('Connected');
            
            // Send user info on connect
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
        };
        
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
            case 'init':
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
                
                // Rebuild layer-element relationships
                this.rebuildLayerElementRelationships();
                
                this.updateLayerUI();
                this.render();
                console.log(`Loaded ${this.elements.length} elements and ${this.layers.length} layers from server`);
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
            
            this.ctx.strokeStyle = '#28a745';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([3, 3]);
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
    
    drawShapeUserLabel(element, screenPos, shapeUser) {
        // Calculate label position above the shape
        const labelY = screenPos.y - (element.height * this.camera.zoom / 2) - 25;
        const labelText = `${shapeUser.userName} - ${shapeUser.action}`;
        
        // Measure text width
        this.ctx.font = '12px Arial';
        const textWidth = this.ctx.measureText(labelText).width;
        
        // Draw background
        this.ctx.fillStyle = shapeUser.color;
        this.ctx.fillRect(
            screenPos.x - textWidth/2 - 6,
            labelY - 2,
            textWidth + 12,
            16
        );
        
        // Draw border
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(
            screenPos.x - textWidth/2 - 6,
            labelY - 2,
            textWidth + 12,
            16
        );
        
        // Draw text
        this.ctx.fillStyle = 'white';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(labelText, screenPos.x, labelY + 10);
        
        // Draw small arrow pointing to shape
        this.ctx.fillStyle = shapeUser.color;
        this.ctx.beginPath();
        this.ctx.moveTo(screenPos.x - 4, labelY + 14);
        this.ctx.lineTo(screenPos.x + 4, labelY + 14);
        this.ctx.lineTo(screenPos.x, labelY + 20);
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
        
        // Draw elements
        this.elements.forEach(element => {
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
            case 'pdf':
                this.exportAsPDF(tempCanvas, options);
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
        
        this.elements.forEach(element => {
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
    
    exportAsPDF(canvas, options = {}) {
        // For PDF export, we'll use jsPDF if available, otherwise fallback to PNG
        if (typeof jsPDF !== 'undefined') {
            const pdf = new jsPDF({
                orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });
            
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save('canvas-export.pdf');
        } else {
            console.warn('jsPDF not available, falling back to PNG export');
            this.downloadCanvasAsPNG(canvas);
        }
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