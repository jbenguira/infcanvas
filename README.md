# Infinite Canvas

A multiplayer web-based infinite canvas application that allows multiple users to collaboratively create, edit, and manage shapes on an unlimited scrollable grid in real-time.

## Features

- **Infinite Grid**: Scroll and zoom through an unlimited canvas space
- **Shape Tools**: Create squares, rectangles, circles, triangles, and stars
- **Real-time Multiplayer**: See other users' changes instantly via WebSocket
- **Shape Manipulation**: 
  - Resize: Drag corner handles
  - Rotate: Drag green rotation handle
  - Move: Drag shapes around
  - Delete: Press Delete key or click red trash icon
  - Edit Labels: Double-click shapes to add text
- **Mouse Controls**: 
  - Pan: Click and drag empty space
  - Zoom: Mouse wheel
  - Shape Placement: Click after selecting a shape tool
- **Auto-save**: All changes are automatically saved and synchronized
- **Connection Status**: Visual indication of multiplayer connection state

## Setup

```bash
npm install
npm start
```

Then open http://localhost:3001 in your browser.

## Usage

### Shape Creation
1. **Select a shape tool**: Click any shape button (square, rectangle, circle, triangle, star)
2. **Place shapes**: Click anywhere on the canvas to place the selected shape
3. **Continue placing**: Keep clicking to place more shapes of the same type

### Shape Editing
1. **Select a shape**: Click on any existing shape
2. **Resize**: Drag the blue corner handles
3. **Rotate**: Drag the green circular handle above the shape
4. **Move**: Drag the shape itself
5. **Add text**: Double-click the shape to add/edit labels
6. **Delete**: Press Delete/Backspace key or click the red trash icon

### Navigation
- **Pan**: Click and drag empty space to move around
- **Zoom**: Use mouse wheel to zoom in/out

### Multiplayer
- Open multiple browser windows/tabs to test multiplayer functionality
- Changes made by one user appear instantly on all other connected clients
- Connection status is shown in the toolbar (green = connected, red = disconnected)

## API Endpoints

- `GET /api/load` - Load initial canvas data (REST fallback)
- `GET /api/status` - Server status and connection info
- `WebSocket: ws://localhost:3001` - Real-time multiplayer communication

## File Structure

```
infcanvas/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── canvas.js
├── package.json
├── server.js
├── canvas-data.json (created after first save)
└── README.md
```