import 'dotenv/config';
import mysql from 'mysql2/promise';

async function setupDatabase() {
  try {
    const {
      DB_HOST,
      DB_PORT = '3306',
      DB_USER,
      DB_PASSWORD,
      DB_NAME
    } = process.env;

    console.log('DB_HOST:', DB_HOST);
    console.log('DB_PORT:', DB_PORT);
    console.log('DB_USER:', DB_USER);
    console.log('DB_NAME:', DB_NAME);

    if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
      throw new Error('Missing required database environment variables');
    }

    const connection = await mysql.createConnection({
      host: DB_HOST,
      port: Number(DB_PORT),
      user: DB_USER,
      password: DB_PASSWORD,
      multipleStatements: true
    });

    console.log('Connected to MySQL');

    // Drop and recreate database
    await connection.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    console.log('✅ Database dropped');

    await connection.query(`CREATE DATABASE \`${DB_NAME}\``);
    console.log('✅ Database created');

    await connection.query(`USE \`${DB_NAME}\``);
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
