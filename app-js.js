// app.js - Express web server for the subtitle generator (Heroku version)

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateImprovedSubtitles } = require('./subtitle-generator');

const app = express();
const port = process.env.PORT || 3000;

// Create tmp directories if they don't exist
const tmpDir = path.join(__dirname, 'tmp');
const uploadsDir = path.join(tmpDir, 'uploads');
const downloadsDir = path.join(__dirname, 'public', 'downloads');

// Ensure directories exist
[tmpDir, uploadsDir, downloadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Set up storage for uploaded files - using memory storage for Heroku
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// Set file size limits and file types
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB file size limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio and video files
    const filetypes = /mp3|mp4|wav|avi|mov|m4a|webm|ogg|aac|flac/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only audio and video files are allowed!'));
    }
  }
});

// Serve static files
app.use(express.static('public'));

// Setup JSON parsing for API responses
app.use(express.json());

// Serve the upload form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle file uploads
app.post('/upload', upload.single('mediaFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Start processing in the background
    res.status(202).json({
      message: 'File uploaded successfully. Processing started.',
      fileId: path.basename(req.file.path, path.extname(req.file.path)),
      status: 'processing'
    });

    // Process the file with our subtitle generator
    const filePath = req.file.path;
    const result = await generateImprovedSubtitles(filePath);

    // Copy SRT files to the downloads directory
    const rawSrtName = path.basename(result.rawSrtPath);
    const improvedSrtName = path.basename(result.improvedSrtPath);
    
    fs.copyFileSync(
      result.rawSrtPath, 
      path.join(downloadsDir, rawSrtName)
    );
    
    fs.copyFileSync(
      result.improvedSrtPath, 
      path.join(downloadsDir, improvedSrtName)
    );

    // Update the status file for the frontend to check
    const statusData = {
      status: 'completed',
      raw: `/downloads/${rawSrtName}`,
      improved: `/downloads/${improvedSrtName}`,
      originalFileName: req.file.originalname
    };

    fs.writeFileSync(
      path.join(downloadsDir, `${path.basename(req.file.path, path.extname(req.file.path))}.json`),
      JSON.stringify(statusData)
    );

    // Clean up the original upload file to save space
    try {
      fs.unlinkSync(filePath);
    } catch (cleanupError) {
      console.warn('Could not remove temporary file:', cleanupError);
    }

  } catch (error) {
    console.error('Error processing file:', error);
    
    // Write error status for the frontend to check
    fs.writeFileSync(
      path.join(downloadsDir, `${path.basename(req.file.path, path.extname(req.file.path))}.json`),
      JSON.stringify({
        status: 'error',
        error: error.message || 'Unknown error occurred'
      })
    );

    // Clean up the original upload file
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      console.warn('Could not remove temporary file:', cleanupError);
    }
  }
});

// API endpoint to check processing status
app.get('/status/:fileId', (req, res) => {
  const statusFilePath = path.join(downloadsDir, `${req.params.fileId}.json`);
  
  if (fs.existsSync(statusFilePath)) {
    const statusData = JSON.parse(fs.readFileSync(statusFilePath, 'utf8'));
    res.json(statusData);
  } else {
    res.json({ status: 'processing' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Subtitle generator app listening at http://localhost:${port}`);
});
