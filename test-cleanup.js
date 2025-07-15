const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Create a test room that's 31 days old
async function createTestRoom() {
    const testRoomName = 'test-old-room-123';
    const testRoomPath = path.join(DATA_DIR, `${testRoomName}.json`);
    
    // Create test room data with old timestamp
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 31); // 31 days ago
    
    const testRoomData = {
        elements: [
            {
                id: 123456,
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                rotation: 0,
                color: '#FF0000',
                shape: 'rectangle',
                text: 'Test Element',
                layerId: 'layer_0'
            }
        ],
        camera: { x: 0, y: 0, zoom: 1 },
        layers: [{
            id: 'layer_0',
            name: 'Layer 1',
            visible: true,
            locked: false,
            elements: []
        }],
        password: '',
        isPasswordProtected: false,
        timestamp: oldDate.toISOString(),
        lastModified: oldDate.toISOString()
    };
    
    // Write test room file
    await fs.writeFile(testRoomPath, JSON.stringify(testRoomData, null, 2));
    
    // Create test uploads directory and file
    const testUploadsDir = path.join(UPLOADS_DIR, testRoomName);
    await fs.mkdir(testUploadsDir, { recursive: true });
    await fs.writeFile(path.join(testUploadsDir, 'test-image.png'), 'test content');
    
    console.log(`Created test room: ${testRoomName}`);
    console.log(`Test room timestamp: ${oldDate.toISOString()}`);
    console.log(`Test uploads directory: ${testUploadsDir}`);
}

// Test the cleanup function
async function testCleanup() {
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
    const now = Date.now();
    
    console.log('Testing cleanup function...');
    console.log(`Current time: ${new Date().toISOString()}`);
    console.log(`Max age: ${maxAge} ms (${maxAge / (24 * 60 * 60 * 1000)} days)`);
    
    try {
        // Get all room files
        const files = await fs.readdir(DATA_DIR);
        const roomFiles = files.filter(file => file.endsWith('.json'));
        
        console.log(`Found ${roomFiles.length} room files`);
        
        for (const file of roomFiles) {
            const roomName = path.basename(file, '.json');
            const filePath = path.join(DATA_DIR, file);
            
            try {
                const data = await fs.readFile(filePath, 'utf8');
                const roomData = JSON.parse(data);
                
                const lastModified = roomData.lastModified || roomData.timestamp;
                if (lastModified) {
                    const roomAge = now - new Date(lastModified).getTime();
                    const daysSinceModified = Math.floor(roomAge / (24 * 60 * 60 * 1000));
                    
                    console.log(`Room: ${roomName}`);
                    console.log(`  Last modified: ${lastModified}`);
                    console.log(`  Age: ${daysSinceModified} days`);
                    console.log(`  Should be cleaned: ${roomAge > maxAge}`);
                    
                    if (roomAge > maxAge) {
                        console.log(`  Would delete: ${filePath}`);
                        console.log(`  Would delete: ${path.join(UPLOADS_DIR, roomName)}`);
                    }
                }
            } catch (error) {
                console.error(`Error processing ${file}:`, error);
            }
        }
    } catch (error) {
        console.error('Error during test:', error);
    }
}

// Run the test
async function runTest() {
    await createTestRoom();
    await testCleanup();
}

runTest().catch(console.error);