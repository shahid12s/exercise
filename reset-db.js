import mysql from 'mysql2/promise.js';

async function setupDatabase() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'Shahid@12'
    });

    console.log('Connected to MySQL');

    // Drop and recreate database
    await connection.query('DROP DATABASE IF EXISTS workouts');
    console.log('✅ Database dropped');

    await connection.query('CREATE DATABASE workouts');
    console.log('✅ Database created');

    await connection.query('USE workouts');
    console.log('✅ Database selected');

    const createUsersTableSQL = `
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    await connection.query(createUsersTableSQL);
    console.log('✅ Users table created');

    const createProgressTableSQL = `
      CREATE TABLE progress (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        workout_type VARCHAR(50) NOT NULL,
        reps_total INT DEFAULT 0,
        reps_good INT DEFAULT 0,
        best_hold FLOAT DEFAULT 0,
        average_knee_angle FLOAT DEFAULT 0,
        average_hip_angle FLOAT DEFAULT 0,
        average_torso_angle FLOAT DEFAULT 0,
        duration_seconds INT DEFAULT 0,
        workout_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    await connection.query(createProgressTableSQL);
    console.log('✅ Progress table created');

    console.log('\n✅ Database setup completed successfully!');
    await connection.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

setupDatabase();
