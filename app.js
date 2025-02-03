const express = require('express');
const { User, UserType } = require('./models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const sharp = require('sharp');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();
const debug = process.env.DEBUG === 'true' 
  ? (...args) => console.log('[Debug]', ...args)
  : () => {};

const requiredEnvVars = ['JWT_SECRET', 'JWT_EXPIRES_IN', 'SALT'];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    debug(`Missing required environment variable (.env) : ${varName}`);
    process.exit(1);
  }
});
const PYTHON_SERVER_URL = process.env.PYTHON_SERVER_URL || 'http://127.0.0.1:8000';

// console.log(UserType)
const app = express();
app.use(express.json());

// Serve static files (e.g., camera.html)
app.use(express.static(path.join(__dirname, 'public')));

// auth middleware
const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) throw new Error('Authorization header missing');

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ uid: decoded.uid });

    if (!user) throw new Error('User not found');
    req.user = user;

    debug(`Authenticated user: ${user.uid}`);
    next();
  } catch (error) {
    debug('Authentication error:', error.message);
    res.status(401).json({ error: 'Please authenticate' });
  }
};


// Create media directories if they don't exist
const mediaDir = process.env.MEDIA || 'media';
const directories = ['images', 'pdfs', 'csvs', 'extras', 'attendance', 'remarks'];
directories.forEach(dir => {
  const dirPath = path.join(mediaDir, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    debug(`Created directory: ${dirPath}`);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
// Add any file type validation here if needed    
    cb(null, true);
  }
});

// File upload route
app.post('/upload', upload.any(), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const processedFiles = [];

    for (const file of req.files) {
      let destPath;
      
      if (file.mimetype.startsWith('image/')) {
// For images, process and save as JPEG        
        const basename = path.basename(file.originalname, path.extname(file.originalname));
        const jpegFilename = `${basename}.jpeg`;
        destPath = path.join(mediaDir, 'images', jpegFilename);

// Process image directly from buffer and save        
        await sharp(file.buffer)
          .jpeg()
          .toFile(destPath);
      } else {
// For non-image files, determine directory based on MIME type        
        let targetDir;
        if (file.mimetype === 'application/pdf') {
          targetDir = 'pdfs';
        } else if (file.mimetype === 'text/csv' || file.mimetype === 'application/csv') {
          targetDir = 'csvs';
        } else {
          targetDir = 'extras';
        }

        destPath = path.join(mediaDir, targetDir, file.originalname);
// Write non-image files directly from buffer        
        fs.writeFileSync(destPath, file.buffer);
      }

      processedFiles.push(destPath);
    }

    res.json({ 
      message: 'Files processed and saved successfully.',
      files: processedFiles 
    });
  } catch (error) {
    debug('File processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload image for a specific user by UID
app.post('/:uid/image', upload.single('image'), async (req, res) => {
  try {
    const { uid } = req.params;

// Check if the UID exists in the database    
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

// Ensure a file was uploaded    
    if (!req.file) {
      return res.status(400).json({ error: 'No image file was uploaded.' });
    }

// Validate that the uploaded file is an image    
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed.' });
    }

// Define the destination path for the image    
    const destPath = path.join(mediaDir, 'images', `${uid}.jpeg`);

// Process the image: convert to JPEG and save    
    await sharp(req.file.buffer)
      .jpeg()
      .toFile(destPath);

    debug(`Image saved successfully for user: ${uid}`);

// Respond with success message and file path    
    res.json({
      message: 'Image uploaded and processed successfully.',
      filePath: destPath,
    });
  } catch (error) {
    debug('Image upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { uid: user.uid, usertype: user.usertype },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create user
app.post('/users', auth, async (req, res) => {
  try {
    const userData = { ...req.body };
    delete userData.uid;
    delete userData.rollno;
    
    const user = new User(userData);
    await user.save();
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get user as self
app.get('/users/me', auth, async (req, res) => {
  try {
    // Convert mongoose document to plain object and remove password
    const user = req.user.toObject();
    delete user.password;
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users
app.get('/users', auth, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user by UID
app.get('/users/:uid', auth, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.params.uid }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get users by type
app.get('/users/type/:usertype', auth, async (req, res) => {
  const user = req.params.usertype;
  if (!UserType.hasOwnProperty(user)) {
    return res.status(404).json({ error: 'User type not found' });
  }

  try {
    const users = await User.find({ usertype: user }).select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user (full update)
app.put('/users/:uid', auth, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.params.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updates = { ...req.body };
    delete updates.uid;
    delete updates.usertype;
    delete updates.rollno;

    Object.assign(user, updates);
    await user.save();
    res.json(user);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

// Partial update user
app.patch('/users/:uid', auth, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.params.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updates = { ...req.body };
    delete updates.uid;
    delete updates.usertype;
    delete updates.rollno;

    Object.assign(user, updates);
    await user.save();
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete user
app.delete('/users/:uid', auth, async (req, res) => {
  try {
    const user = await User.findOneAndDelete({ uid: req.params.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port http://127.0.0.1:${PORT}`);
});