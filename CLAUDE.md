# Claude Development Practices

This document outlines the development practices, patterns, and methodologies used while building the Infinite Canvas application with Claude AI assistance.

## 🧠 Development Approach

### Iterative Development
- **Task-Driven Development**: Each feature was broken down into specific, actionable tasks
- **Incremental Improvements**: Features were built iteratively, starting with basic functionality and gradually adding complexity
- **Continuous Refinement**: Code was regularly refactored and improved based on testing and user feedback

### Problem-Solving Methodology
1. **Analysis First**: Always investigated existing code structure before making changes
2. **Root Cause Investigation**: When bugs occurred, traced them to their source rather than applying quick fixes
3. **Security-First Mindset**: Considered security implications of every feature, especially file uploads and user input
4. **Performance Awareness**: Optimized for performance, especially with real-time multiplayer features

## 📋 Task Management

### Todo-Driven Development
- **TodoWrite Tool Usage**: Extensively used todo lists to track progress and ensure nothing was missed
- **Priority-Based Workflow**: Tasks were prioritized as high, medium, or low importance
- **Status Tracking**: Tasks progressed through pending → in_progress → completed states
- **Real-time Updates**: Todo lists were updated immediately as work progressed

### Example Todo Workflow
```markdown
1. Investigate current rotation handle implementation (high priority)
2. Improve rotation handle hit detection area (high priority)
3. Add rotation cursor feedback (high priority)
4. Test rotation handle usability (medium priority)
```

## 🔍 Code Investigation Practices

### Systematic Code Exploration
- **Task Tool Usage**: Used the Task tool for comprehensive code searches when uncertain about implementation details
- **Pattern Recognition**: Looked for existing patterns and conventions before implementing new features
- **Dependency Analysis**: Always checked what libraries and frameworks were already in use

### Search Strategies
1. **Keyword Searches**: Used specific terms related to functionality (e.g., "rotation", "upload", "validation")
2. **Function Searches**: Located specific functions and their implementations
3. **Pattern Matching**: Found similar implementations to maintain consistency
4. **Context Gathering**: Read surrounding code to understand implementation patterns

## 🏗️ Architecture Decisions

### Security-First Development

#### File Upload Security
```javascript
// Multiple layers of validation
const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
const allowedExtensions = ['.jpg', '.jpeg', '.png'];

// Server-side validation
if (!allowedMimeTypes.includes(file.mimetype) && !allowedExtensions.includes(fileExtension)) {
    return cb(new Error('Only JPG and PNG image files are allowed'), false);
}
```

**Rationale**: SVG files were explicitly blocked due to potential JavaScript injection vulnerabilities.

#### Input Validation
```javascript
// Room name validation to prevent path traversal
function validateRoomName(roomName) {
    if (!roomName || typeof roomName !== 'string') return false;
    const validPattern = /^[a-zA-Z0-9-]+$/;
    return validPattern.test(roomName) && roomName.length >= 3 && roomName.length <= 50;
}
```

**Rationale**: Strict validation prevents directory traversal attacks and ensures safe file system operations.

### Performance Optimizations

#### Image Caching
```javascript
// Client-side image caching for performance
if (!this.imageCache) {
    this.imageCache = new Map();
}
const cacheKey = element.filename;
let img = this.imageCache.get(cacheKey);
```

**Rationale**: Prevents redundant image loading and improves rendering performance.

#### Efficient Hit Detection
```javascript
// Larger hit areas for better UX
const rotateHitRadius = isMobile ? 20 : 15; // Larger than visual radius
const rotateRadius = isMobile ? 12 : 6;    // Visual radius
```

**Rationale**: Makes interactive elements easier to click while maintaining visual clarity.

## 🔧 Problem-Solving Examples

### File Upload Path Issue

**Problem**: Room name validation error during multer file processing
**Root Cause**: `req.body.roomName` not available during multer destination function execution
**Solution**: 
1. Upload to temporary directory first
2. Validate room name after upload
3. Move file to room-specific directory
4. Clean up on errors

```javascript
// Changed from inline validation to post-upload validation
destination: async (req, file, cb) => {
    // Use temporary uploads directory initially
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
}
```

### Rotation Handle Usability

**Problem**: Rotation handles were difficult to interact with
**Analysis**: 6px hit radius too small, no visual feedback for hover state
**Solution**: 
1. Increased hit detection area (15px) while keeping visual size (6px)
2. Added cursor feedback (crosshair)
3. Added hover effects (glow, color change)

### Animation Replay Issue

**Problem**: Loading animation played for all users when someone joined
**Analysis**: Animation triggered on every 'init' message
**Solution**: Added `hasPlayedInitialAnimation` flag to play only once per session

```javascript
// Only play animation once per page load
if (this.elements.length > 0 && !this.hasPlayedInitialAnimation) {
    this.hasPlayedInitialAnimation = true;
    this.startLoadingAnimation();
}
```

## 🗄️ Data Management Strategy

### Room-Based Architecture
```
data/
├── uploads/
│   ├── room-123/
│   │   ├── image1.png
│   │   └── image2.jpg
│   └── room-456/
│       └── image3.png
├── room-123.json
└── room-456.json
```

**Benefits**:
- Isolated storage per room
- Easy cleanup of old rooms
- Prevents cross-room file access
- Scalable architecture

### Automatic Cleanup System
```javascript
// Daily cleanup at 2 AM
cron.schedule('0 2 * * *', () => {
    console.log('Running scheduled room cleanup...');
    cleanupOldRooms();
});
```

**Strategy**: 
- Tracks `lastModified` timestamp for each room
- Automatically removes rooms older than 30 days
- Deletes both room data and associated uploads
- Provides manual cleanup endpoint for testing

## 🎨 User Experience Improvements

### Visual Feedback Enhancements

#### Cursor Management
```javascript
updateCursor() {
    let cursor = '';
    if (this.getRotateHandle(this.mouse.x, this.mouse.y)) {
        cursor = 'crosshair';
    } else if (this.getResizeHandle(this.mouse.x, this.mouse.y)) {
        cursor = 'nw-resize';
    }
    this.canvas.style.cursor = cursor;
}
```

#### Hover Effects
```javascript
// Visual feedback on hover
if (isHoveringRotate) {
    this.ctx.shadowColor = '#28a745';
    this.ctx.shadowBlur = 8;
    this.ctx.fillStyle = '#34ce57'; // Brighter color
}
```

### Accessibility Considerations
- **Touch Support**: Larger hit areas on mobile devices
- **Visual Feedback**: Clear indication of interactive elements
- **Keyboard Support**: Escape key to deselect, Delete key for deletion
- **Error Messages**: Clear, actionable error messages

## 📐 Code Quality Practices

### Consistent Patterns
- **Function Naming**: Descriptive names following camelCase convention
- **Error Handling**: Consistent try-catch blocks with cleanup
- **Validation**: Same validation patterns across client and server
- **State Management**: Centralized state updates with proper synchronization

### Documentation Strategy
- **Inline Comments**: Explain complex logic and business rules
- **Function Documentation**: Clear parameter and return value descriptions
- **Security Notes**: Document security-related decisions
- **TODO Comments**: Mark areas for future improvement

### Testing Approach
- **Manual Testing**: Comprehensive testing with multiple browser windows
- **Edge Case Testing**: Test with invalid inputs, large files, network issues
- **Cross-Platform Testing**: Desktop and mobile device testing
- **Performance Testing**: Test with many elements and users

## 🔄 Development Workflow

### Typical Feature Development
1. **Requirement Analysis**: Understand the problem and constraints
2. **Code Investigation**: Use Task tool to understand existing implementation
3. **Planning**: Create todo list with prioritized tasks
4. **Implementation**: Code incrementally, updating todos
5. **Testing**: Verify functionality works as expected
6. **Documentation**: Update README and inline comments
7. **Security Review**: Ensure no security vulnerabilities introduced

### Debugging Process
1. **Error Analysis**: Read error messages carefully and trace stack traces
2. **Code Review**: Check recent changes that might have caused issues
3. **Logging**: Add strategic console.log statements for debugging
4. **Isolation**: Test individual components to isolate problems
5. **Fix Verification**: Ensure fix doesn't break other functionality

## 🛡️ Security Practices

### Input Sanitization
- **File Type Validation**: Multiple layers (MIME type, extension, content)
- **Size Limits**: Enforce reasonable file size limits (3MB)
- **Path Validation**: Prevent directory traversal attacks
- **Room Name Sanitization**: Only allow safe characters

### File Handling Security
- **Temporary Storage**: Use temporary directories for initial uploads
- **Cleanup on Error**: Always clean up files when operations fail
- **Access Control**: Serve files through controlled endpoints
- **Content Validation**: Verify file contents match declared types

### Network Security
- **WebSocket Validation**: Validate all incoming WebSocket messages
- **Rate Limiting**: Implicit rate limiting through file size restrictions
- **Error Hiding**: Don't expose internal paths or system information

## 📚 Lessons Learned

### Technical Insights
1. **Multer Timing**: Form data isn't immediately available in destination functions
2. **Canvas Performance**: Caching and selective rendering crucial for performance
3. **WebSocket Reliability**: Need robust reconnection and error handling
4. **File System Operations**: Always use async/await for file operations

### Development Insights
1. **Todo Lists Essential**: Critical for tracking complex multi-step features
2. **Security First**: Much easier to build security in than add it later
3. **User Testing**: Real user feedback reveals usability issues not apparent to developers
4. **Incremental Development**: Small, testable changes are more reliable

### Tools and Patterns
1. **Task Tool**: Invaluable for understanding large codebases
2. **Grep Tool**: Essential for finding specific patterns and functions
3. **Read Tool**: Critical for understanding implementation details
4. **Error Handling**: Consistent patterns make debugging much easier

## 🚀 Future Improvements

### Identified Enhancement Opportunities
1. **Database Integration**: Replace JSON files with proper database
2. **Real-time Performance**: Optimize for larger numbers of concurrent users
3. **Advanced Export**: Add more export formats and options
4. **Collaborative Features**: Add comments, version history, and permissions
5. **Mobile App**: Native mobile application for better touch experience

### Technical Debt
1. **Code Organization**: Split large files into smaller, focused modules
2. **State Management**: Implement more sophisticated state management patterns
3. **Testing**: Add automated tests for critical functionality
4. **Monitoring**: Add application performance monitoring and alerting

This document serves as a guide for future development and demonstrates the thoughtful, security-conscious approach taken throughout the project development process.