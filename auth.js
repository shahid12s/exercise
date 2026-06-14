// Tab switching
function switchTab(tab, clickEvent) {
  const tabs = document.querySelectorAll('.auth-tab');
  const contents = document.querySelectorAll('.auth-content');
  
  tabs.forEach(t => t.classList.remove('active'));
  contents.forEach(c => c.classList.remove('active'));
  
  const activeEvent = clickEvent || window.event;
  if (activeEvent?.target) {
    activeEvent.target.classList.add('active');
  }
  document.getElementById(`${tab}-content`).classList.add('active');
}

window.switchTab = switchTab;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://exercise-pdms.onrender.com';

async function readResponseBody(res) {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return await res.json();
  }

  const text = await res.text();
  return { message: text || `Request failed with status ${res.status}` };
}

// Login form handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const messageEl = document.getElementById('login-message');
  
  try {
    const res = await fetch(`${API_BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'
    });

    const data = await readResponseBody(res);

    if (!res.ok) {
      throw new Error(data.message || 'Login failed');
    }

    messageEl.textContent = 'Login successful! Redirecting...';
    messageEl.className = 'auth-message success';

    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1500);

  } catch (err) {
    messageEl.textContent = err.message || 'Login failed';
    messageEl.className = 'auth-message error';
  }
});

// Signup form handler
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const firstName = document.getElementById('signup-firstname').value;
  const lastName = document.getElementById('signup-lastname').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;
  const messageEl = document.getElementById('signup-message');
  
  try {
    // Client-side validation
    if (!firstName || !lastName) {
      throw new Error('First and last names are required');
    }
    
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    
    if (password !== confirm) {
      throw new Error('Passwords do not match');
    }

    const res = await fetch(`${API_BASE_URL}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, password, confirm }),
      credentials: 'include'
    });

    const data = await readResponseBody(res);

    if (!res.ok) {
      throw new Error(data.message || 'Signup failed');
    }

    messageEl.textContent = 'Account created! Redirecting...';
    messageEl.className = 'auth-message success';

    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1500);

  } catch (err) {
    messageEl.textContent = err.message || 'Signup failed';
    messageEl.className = 'auth-message error';
  }
});

// Check if user is already logged in
window.addEventListener('load', async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/me`, {
      credentials: 'include'
    });

    if (res.ok) {
      // User is already logged in, redirect to main page
      window.location.href = 'index.html';
    }
  } catch (err) {
    // User not logged in, stay on auth page
  }
});
