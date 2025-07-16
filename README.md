# Infinite Canvas

A multiplayer web-based infinite canvas application that allows multiple users to collaboratively create, edit, and manage shapes on an unlimited scrollable grid in real-time. Built with HTML5 Canvas, WebSocket, and Node.js.

## 🚀 Features

### Core Canvas Features
- **Infinite Grid**: Scroll and zoom through an unlimited canvas space
- **Shape Tools**: Create squares, rectangles, circles, triangles, and stars
- **Image Upload**: Upload and manipulate JPG/PNG images (max 3MB)
- **Real-time Multiplayer**: See other users' changes instantly via WebSocket
- **Room System**: Multiple isolated rooms with unique URLs
- **Layer Management**: Organize elements in layers with visibility/lock controls

### Shape Manipulation
- **Resize**: Drag corner handles with aspect ratio preservation for images
- **Rotate**: Drag green rotation handle with improved cursor feedback
- **Move**: Drag shapes around with live updates
- **Delete**: Press Delete key or click red trash icon
- **Edit Labels**: Double-click shapes to add text
- **Z-Index Controls**: Bring shapes forward/backward
- **Color Picker**: Change shape colors

### Navigation & Controls
- **Pan**: Click and drag empty space or use right-click
- **Zoom**: Mouse wheel with smooth scaling
- **Touch Support**: Full mobile/tablet compatibility
- **Selection**: Click to select, Ctrl/Cmd+click for multi-select
- **Selection Box**: Drag to select multiple elements

### Multiplayer Features
- **Real-time Collaboration**: Instant synchronization across all users
- **User Cursors**: See other users' mouse positions
- **User Identification**: Unique usernames and colors
- **Connection Status**: Visual indication of connection state
- **Room Password Protection**: Secure rooms with password authentication

### Data Management
- **Auto-save**: All changes automatically saved and synchronized
- **Room Persistence**: Each room maintains its own state
- **File Management**: Room-specific file storage
- **Automatic Cleanup**: Old rooms (30+ days) automatically deleted
- **Export Options**: PNG, JPG, SVG, and PDF export

## 🛠️ Technology Stack

### Frontend
- **HTML5 Canvas**: High-performance 2D graphics rendering
- **Vanilla JavaScript**: No framework dependencies
- **WebSocket**: Real-time bidirectional communication
- **CSS3**: Modern styling and responsive design

### Backend
- **Node.js**: Server runtime
- **Express.js**: Web framework
- **WebSocket (ws)**: Real-time communication
- **Multer**: File upload handling
- **node-cron**: Scheduled cleanup tasks

### Storage
- **JSON Files**: Room state persistence
- **File System**: Image uploads per room
- **In-Memory**: Active room states and user sessions

## 📦 Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Setup
```bash
# Clone the repository
git clone <repository-url>
cd infcanvas

# Install dependencies
npm install

# Start the server
npm start
```

The application will be available at `http://localhost:3001`

### Development Mode
```bash
# Run with nodemon for auto-restart
npm run dev
```

## 🎮 Usage Guide

### Getting Started
1. **Access the App**: Open `http://localhost:3001` in your browser
2. **Room Creation**: A unique room is automatically generated
3. **Share Room**: Share the URL with others to collaborate
4. **Start Creating**: Use the toolbar to select shapes and start drawing

### Shape Creation
1. **Select Tool**: Click any shape button (square, rectangle, circle, triangle, star)
2. **Place Shapes**: Click anywhere on the canvas to place the selected shape
3. **Continue Placing**: Keep clicking to place more shapes of the same type
4. **Deselect**: Click the selected tool again or press Escape

### Shape Editing
1. **Select Shape**: Click on any existing shape
2. **Resize**: Drag the blue corner handles
3. **Rotate**: Drag the green circular handle (improved hit detection)
4. **Move**: Drag the shape itself
5. **Add Text**: Double-click the shape to add/edit labels
6. **Delete**: Press Delete/Backspace key or click the red trash icon
7. **Change Color**: Click the color picker handle
8. **Layer Control**: Use forward/backward arrows to change z-index

### Image Upload
1. **Upload**: Click the image button in toolbar
2. **Select File**: Choose JPG or PNG file (max 3MB)
3. **Paste Images**: Ctrl+V to paste images from clipboard
4. **Manipulation**: Resize (maintains aspect ratio), rotate, move like other shapes

### Navigation
- **Pan**: Click and drag empty space, or right-click drag
- **Zoom**: Mouse wheel to zoom in/out
- **Reset View**: Double-click empty space to reset camera

### Layer Management
1. **Layer Panel**: Access via the layers button
2. **Create Layer**: Add new layers for organization
3. **Visibility**: Toggle layer visibility
4. **Lock Layers**: Prevent editing of layer contents
5. **Reorder**: Drag layers to reorder

### Multiplayer
- **Join Room**: Multiple users can join the same room URL
- **Real-time Updates**: See changes instantly
- **User Cursors**: Colored cursors show other users' positions
- **User List**: See who's currently in the room

### Room Management
- **Room Names**: Rooms have human-readable names (e.g., "bright-room-168")
- **Password Protection**: Set passwords for private rooms
- **Room Switching**: Change room name in the toolbar
- **Persistence**: Rooms save automatically and persist across sessions

## 🔧 Configuration

### Environment Variables
```bash
PORT=3001                    # Server port (default: 3001)
```

### File Limits
- **Image Upload**: 3MB maximum file size
- **Supported Formats**: JPG, PNG only (SVG blocked for security)
- **Storage**: Room-specific directories in `./data/uploads/[roomname]/`

### Security Features
- **Room Name Validation**: Prevents path traversal attacks
- **File Type Validation**: Server and client-side validation
- **Password Protection**: Optional room passwords
- **Automatic Cleanup**: Old rooms deleted after 30 days

## 🌐 API Reference

### REST Endpoints
```
GET  /api/status                    # Server status and statistics
GET  /api/room/generate             # Generate new room name
GET  /api/room/:roomName/check      # Check if room exists/requires password
POST /api/room/:roomName/password   # Set room password
POST /api/upload/image              # Upload image file
POST /api/cleanup                   # Manual cleanup trigger (dev only)
```

### WebSocket Events
```javascript
// Client to Server
{
  type: 'joinRoom',
  data: { roomName: 'room-123', password: 'optional' }
}

{
  type: 'add',
  data: { /* element data */ }
}

{
  type: 'update',
  data: { /* element data */ }
}

{
  type: 'delete',
  data: { id: 'element-id' }
}

// Server to Client
{
  type: 'init',
  data: { elements: [...], layers: [...], camera: {...} }
}

{
  type: 'add',
  data: { /* element data */ }
}

{
  type: 'cursor',
  data: { userId: 'user-123', x: 100, y: 200 }
}
```

## 📁 Project Structure

```
infcanvas/
├── public/                          # Frontend files
│   ├── index.html                   # Main HTML file
│   ├── styles.css                   # CSS styles
│   └── canvas.js                    # Main application logic
├── data/                            # Data storage (gitignored)
│   ├── uploads/                     # Uploaded images
│   │   └── [roomname]/             # Room-specific uploads
│   └── *.json                      # Room state files
├── node_modules/                    # Dependencies
├── package.json                     # Project configuration
├── server.js                        # Backend server
├── .gitignore                       # Git ignore rules
├── README.md                        # This file
└── CLAUDE.md                        # Development practices
```

## 🔒 Security

### File Upload Security
- **File Type Validation**: Only JPG/PNG allowed
- **Size Limits**: 3MB maximum
- **SVG Blocked**: Prevents JavaScript injection
- **Path Validation**: Room names sanitized

### Room Security
- **Password Protection**: Optional room passwords
- **Name Validation**: Prevents path traversal
- **Automatic Cleanup**: Old rooms deleted

### Network Security
- **CORS Enabled**: Configurable origins
- **Input Validation**: All user inputs validated
- **Error Handling**: Secure error messages

## 🧹 Maintenance

### Automatic Cleanup
- **Schedule**: Daily at 2:00 AM
- **Criteria**: Rooms older than 30 days
- **Actions**: Deletes room file and all associated uploads
- **Manual Trigger**: `POST /api/cleanup` endpoint

### Monitoring
- **Server Status**: `/api/status` endpoint
- **Room Statistics**: Active rooms and user counts
- **Connection Tracking**: WebSocket connection monitoring
- **Error Logging**: Comprehensive error logging

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Style
- Use consistent indentation (4 spaces)
- Follow existing naming conventions
- Add comments for complex logic
- Validate all user inputs

### Testing
- Test multiplayer functionality with multiple browser windows
- Test image uploads with various file types and sizes
- Test room switching and password protection
- Test on different devices and screen sizes

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Troubleshooting

### Common Issues

**Connection Issues**
- Check if server is running on port 3001
- Verify WebSocket connection in browser dev tools
- Check firewall settings

**Image Upload Issues**
- Ensure file is JPG or PNG format
- Check file size is under 3MB
- Verify room name is valid

**Performance Issues**
- Limit number of elements on canvas
- Use layers to organize content
- Close unused browser tabs

### Debug Mode
Enable debug logging by setting:
```javascript
// In canvas.js
const DEBUG = true;
```

## 🔄 Version History

- **v1.0.0**: Initial release with basic shapes and multiplayer
- **v1.1.0**: Added image upload and layer management
- **v1.2.0**: Room system with password protection
- **v1.3.0**: Automatic cleanup and improved security
- **v1.4.0**: Enhanced rotation handles and aspect ratio preservation