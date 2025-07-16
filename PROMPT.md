# Infinite Canvas Project Recreation Prompts

This document contains all the prompts and instructions necessary to recreate the Infinite Canvas project from scratch with Claude AI assistance.

## Project Overview

The Infinite Canvas is a multiplayer web-based collaborative drawing application that allows multiple users to create, edit, and manage shapes on an unlimited scrollable grid in real-time. Built with HTML5 Canvas, WebSocket, and Node.js.

## Initial Setup Prompts

### 1. Project Initialization

```
Create a new Node.js project for a multiplayer infinite canvas web application. The project should include:
- A package.json with dependencies: express, cors, ws, multer, node-cron, fs
- A basic Express server setup with WebSocket support
- Static file serving for HTML, CSS, and JavaScript
- A basic HTML5 Canvas frontend
- File structure: server.js, public/index.html, public/canvas.js, public/styles.css
```

### 2. Basic Server Architecture

```
Set up a Node.js Express server with the following features:
- WebSocket server for real-time multiplayer communication
- Room-based architecture where each room has isolated state
- JSON file-based storage for room persistence in a data/ directory
- Basic CORS configuration
- Static file serving from public/ directory
- Listen on port 3001
```

### 3. Room Management System

```
Implement a room management system with these features:
- Room name validation (alphanumeric and hyphens only, 3-50 characters)
- Automatic room creation when users join non-existent rooms
- Room state includes: elements array, camera position, layers, timestamp
- File-based persistence using JSON files named {roomName}.json
- Generate random room names with format: {adjective}-{noun}-{number}
- Room password protection with optional password authentication
```

### 4. WebSocket Communication

```
Create a WebSocket communication system that handles:
- Room joining with password authentication
- Real-time shape updates (add, update, delete, move)
- User presence tracking and cursor position sharing
- Message types: joinRoom, add, update, delete, move, cursor, userInfo
- Broadcast updates to all clients in the same room except sender
- Error handling for invalid room names and wrong passwords
```

## Frontend Development Prompts

### 5. HTML5 Canvas Frontend

```
Create an HTML5 Canvas frontend with:
- Full-screen canvas that adapts to window size
- Toolbar with shape buttons (square, rectangle, circle, triangle, star)
- User interface showing room name, user count, connection status
- Keyboard shortcuts display
- Export functionality with multiple formats (PNG, JPG, SVG, PDF)
- Responsive design for mobile and desktop
```

### 6. Canvas Rendering System

```
Implement a canvas rendering system with:
- Infinite scrollable grid with zoom support
- Camera system with pan and zoom controls
- Shape rendering for basic geometric shapes (square, rectangle, circle, triangle, star)
- Selection handles for resize and rotation
- Visual feedback for hover states and selection
- Smooth animations and transitions
- High-performance rendering with selective updates
```

### 7. Shape Manipulation

```
Create shape manipulation features:
- Click-to-place shapes with selected tool
- Drag-to-resize with corner handles
- Rotation handles with improved hit detection
- Moving shapes by dragging
- Multi-select with Ctrl+click and selection box
- Keyboard shortcuts for common operations
- Visual feedback with cursors and hover effects
```

### 8. Image Upload System

```
Implement secure image upload with:
- File type validation (JPG, PNG only - no SVG for security)
- 3MB file size limit
- Multer middleware for handling uploads
- Room-specific upload directories
- Client-side drag-and-drop support
- Paste from clipboard functionality
- Image caching for performance
- Aspect ratio preservation during resize
```

## Advanced Features Prompts

### 9. Layer Management

```
Add a layer system with:
- Multiple layers per room
- Layer visibility and lock controls
- Drag-and-drop layer reordering
- Element assignment to layers
- Layer-specific operations
- Side panel with layer controls
- Visual indication of active layer
```

### 10. Undo/Redo System

```
Implement comprehensive undo/redo functionality:
- History stack with 50 operation limit
- State snapshots for complete canvas state
- Keyboard shortcuts (Ctrl+Z, Ctrl+Y)
- Visual feedback for undo/redo availability
- Multiplayer synchronization of undo/redo operations
- Efficient state management to prevent memory issues
```

### 11. Multiplayer Features

```
Enhance multiplayer functionality with:
- Real-time cursor tracking for all users
- User identification with random names and colors
- Visual indicators for users manipulating shapes
- User join/leave notifications
- Connection status monitoring
- Reconnection handling with exponential backoff
- User count display in toolbar
```

### 12. Export System

```
Create a comprehensive export system:
- Multiple format support (PNG, JPG, SVG, PDF)
- Custom size options with presets
- Background color selection
- High-quality rendering for exports
- Modal dialog for export options
- Progress indication for large exports
- Download handling for all formats
```

## Security & Performance Prompts

### 13. Security Implementation

```
Implement security measures:
- Input validation for room names (prevent path traversal)
- File upload restrictions (type, size, content validation)
- SVG blocking to prevent XSS attacks
- Password protection for rooms
- Safe file handling with temporary directories
- Error message sanitization
- Rate limiting considerations
```

### 14. File Management & Cleanup

```
Add automated file management:
- Automatic cleanup of old rooms (30+ days)
- Scheduled cleanup using node-cron (daily at 2 AM)
- Manual cleanup endpoint for testing
- Room-specific upload directories
- Cleanup of associated files when rooms are deleted
- Error handling for file operations
```

### 15. Performance Optimization

```
Optimize performance with:
- Image caching system
- Efficient hit detection for interactive elements
- Selective rendering updates
- Canvas optimization techniques
- Memory management for large canvases
- Touch/mobile optimizations
- Efficient WebSocket message handling
```

## Testing & Polish Prompts

### 16. Mobile Support

```
Add comprehensive mobile support:
- Touch event handling for pan, zoom, and shape manipulation
- Larger hit areas for touch interfaces
- Pinch-to-zoom functionality
- Touch-friendly UI elements
- Responsive design for various screen sizes
- Mobile-specific visual feedback
```

### 17. User Experience Enhancements

```
Improve user experience with:
- Smooth animations for loading and interactions
- Visual feedback for all user actions
- Improved rotation handles with better hit detection
- Hover effects and cursor changes
- Keyboard shortcut hints
- Connection status indicators
- Error messages and user guidance
```

### 18. Advanced Interactions

```
Add advanced interaction features:
- Selection box for multi-select
- Copy/paste functionality
- Duplicate shapes (Ctrl+D)
- Select all (Ctrl+A)
- Nudge selected shapes with arrow keys
- Right-click context menu
- Double-click to edit labels
- Snap to grid toggle
```

## Development Practices Prompts

### 19. Code Organization

```
Organize code with best practices:
- Modular JavaScript class structure
- Consistent error handling patterns
- Proper separation of concerns
- Clear naming conventions
- Comprehensive inline documentation
- Event-driven architecture
- State management patterns
```

### 20. Documentation & Maintenance

```
Create comprehensive documentation:
- Detailed README with setup instructions
- API documentation for WebSocket messages
- User guide with feature explanations
- Development practices documentation
- Security considerations documentation
- Troubleshooting guide
- Version history and changelog
```

## Deployment & Production Prompts

### 21. Production Readiness

```
Prepare for production deployment:
- Environment variable configuration
- Port configuration
- Static file serving optimization
- WebSocket connection handling
- Error logging and monitoring
- Health check endpoints
- Process management considerations
```

### 22. Testing Strategy

```
Implement comprehensive testing:
- Multi-browser testing
- Mobile device testing
- Network condition testing
- Large file upload testing
- Concurrent user testing
- Performance testing with many elements
- Security testing for input validation
```

## Implementation Order

### Phase 1: Core Foundation
1. Project initialization and basic server setup
2. Room management system
3. WebSocket communication
4. Basic HTML5 Canvas frontend
5. Simple shape creation and rendering

### Phase 2: Basic Functionality
6. Shape manipulation (move, resize, rotate)
7. Multi-user real-time updates
8. Basic persistence with JSON files
9. User interface and toolbar
10. Connection handling

### Phase 3: Advanced Features
11. Image upload system
12. Layer management
13. Undo/redo functionality
14. Export system
15. Security implementations

### Phase 4: Polish & Performance
16. Mobile support
17. Performance optimizations
18. User experience enhancements
19. Advanced interactions
20. Documentation and testing

## Key Technical Considerations

### WebSocket Message Format
```javascript
// Client to Server
{
  type: 'joinRoom',
  data: { roomName: 'room-123', password: 'optional' }
}

{
  type: 'add',
  data: { 
    id: 'shape-123',
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 50,
    height: 30,
    color: '#ff0000'
  }
}

// Server to Client
{
  type: 'init',
  data: { 
    elements: [...],
    layers: [...],
    camera: { x: 0, y: 0, zoom: 1 }
  }
}
```

### Room State Structure
```javascript
{
  elements: [
    {
      id: 'unique-id',
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 50,
      height: 30,
      color: '#ff0000',
      layerId: 'layer_0'
    }
  ],
  camera: { x: 0, y: 0, zoom: 1 },
  layers: [
    {
      id: 'layer_0',
      name: 'Layer 1',
      visible: true,
      locked: false,
      elements: ['shape-id-1', 'shape-id-2']
    }
  ],
  password: '',
  isPasswordProtected: false,
  timestamp: '2023-01-01T00:00:00.000Z',
  lastModified: '2023-01-01T00:00:00.000Z'
}
```

### Security Requirements
- Only allow JPG/PNG file uploads (no SVG)
- Validate room names to prevent path traversal
- Implement file size limits (3MB)
- Use temporary directories for upload processing
- Sanitize all user inputs
- Implement proper error handling without exposing internals

This comprehensive prompt collection ensures that all aspects of the Infinite Canvas project can be recreated with proper attention to security, performance, and user experience. Each prompt builds upon the previous ones to create a complete, production-ready application.