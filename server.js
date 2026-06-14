import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const app = express();
const PORT = process.env.PORT || 3001;
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : [
      'https://exercise-eight-pink.vercel.app'
    ];
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);

// Database pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function verifyDatabaseConnection() {
  const conn = await pool.getConnection();
  console.log('DATABASE CONNECTED');
  conn.release();
}


// Middleware
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

verifyDatabaseConnection().catch((err) => {
  console.error('DATABASE CONNECTION FAILED:', err);
});

// Helper function to verify JWT
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  let connection;
  try {
    console.log('Signup request:', req.body);
    const { firstName, lastName, email, password, confirm } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password !== confirm) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    connection = await pool.getConnection();

    // Check if email already exists
    const [rows] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    if (rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await connection.query(
      'INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)',
      [firstName, lastName, email, passwordHash]
    );

    console.log('User inserted:', result.insertId);

    const userId = result.insertId;
    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ message: 'Account created successfully', userId, email });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  let connection;
  try {
    const { email, password } = req.body;
    console.log('Login email:', email);

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    connection = await pool.getConnection();

    // Get user
    const [rows] = await connection.query('SELECT id, email, first_name, last_name, password_hash FROM users WHERE email = ?', [email]);
    console.log('User found:', rows);

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = rows[0];

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    console.log('JWT generated for user:', user.id);

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ 
      message: 'Login successful',
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
});

// Get current user
app.get('/api/me', async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [decoded.userId]);
    connection.release();

    if (rows.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    const user = rows[0];
    res.json({
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name
    });
  } catch (err) {
    console.error('Auth check error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/'
  });
  res.json({ message: 'Logged out successfully' });
});

// Save progress endpoint
app.post('/api/progress', async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const {
      workoutType,
      repsTotal,
      repsGood,
      bestHold,
      avgKneeAngle,
      avgHipAngle,
      avgTorsoAngle,
      durationSeconds
    } = req.body;

    const connection = await pool.getConnection();

    const [result] = await connection.query(
      `INSERT INTO progress (user_id, workout_type, reps_total, reps_good, best_hold, 
       average_knee_angle, average_hip_angle, average_torso_angle, duration_seconds) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        decoded.userId,
        workoutType,
        repsTotal,
        repsGood,
        bestHold,
        avgKneeAngle,
        avgHipAngle,
        avgTorsoAngle,
        durationSeconds
      ]
    );

    connection.release();

    res.json({
      message: 'Progress saved successfully',
      progressId: result.insertId
    });
  } catch (err) {
    console.error('Progress save error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get progress endpoint
app.get('/api/progress', async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const connection = await pool.getConnection();

    const [rows] = await connection.query(
      `SELECT * FROM progress WHERE user_id = ? ORDER BY workout_date DESC`,
      [decoded.userId]
    );

    connection.release();

    res.json(rows);
  } catch (err) {
    console.error('Progress fetch error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/', (req, res) => {
  res.send('Backend Running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
