const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
let charts = {};

async function loadDashboardData() {
  try {
    // Get current user
    const userRes = await fetch(`${API_BASE_URL}/api/me`, { credentials: 'include' });
    if (!userRes.ok) {
      window.location.href = 'auth.html';
      return;
    }
    
    const user = await userRes.json();
    document.getElementById('userGreeting').textContent = `Welcome back, ${user.firstName}!`;

    // Get progress data
    const progressRes = await fetch(`${API_BASE_URL}/api/progress`, { 
      credentials: 'include' 
    });
    
    if (!progressRes.ok) {
      throw new Error('Failed to fetch progress');
    }

    const progressData = await progressRes.json();
    
    // Update stats
    updateStats(progressData);
    
    // Render charts
    renderCharts(progressData);
    
    // Render history table
    renderHistoryTable(progressData);

  } catch (err) {
    console.error('Error loading dashboard:', err);
    alert('Failed to load dashboard data');
  }
}

function updateStats(data) {
  const stats = {
    totalWorkouts: data.length,
    bestHold: Math.max(...data.map(d => d.best_hold || 0), 0),
    avgGoodReps: data.length > 0 ? Math.round(data.reduce((sum, d) => sum + (d.reps_good || 0), 0) / data.length) : 0,
    totalDuration: Math.round(data.reduce((sum, d) => sum + (d.duration_seconds || 0), 0) / 3600)
  };

  document.getElementById('totalWorkouts').textContent = stats.totalWorkouts;
  document.getElementById('bestHoldTime').textContent = stats.bestHold.toFixed(1) + 's';
  document.getElementById('avgGoodReps').textContent = stats.avgGoodReps;
  document.getElementById('totalDuration').textContent = stats.totalDuration + 'h';
}

function renderCharts(data) {
  // Workout Frequency (Last 7 Days)
  const last7Days = getLast7DaysData(data);
  renderFrequencyChart(last7Days);

  // Reps Performance
  const squatData = data.filter(d => d.workout_type === 'squat');
  renderRepsChart(squatData);

  // Average Angles
  renderAnglesChart(data);

  // Workout Duration
  renderDurationChart(data);
}

function getLast7DaysData(data) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const counts = new Array(7).fill(0);
  const today = new Date();

  data.forEach(d => {
    const workoutDate = new Date(d.workout_date);
    const daysAgo = Math.floor((today - workoutDate) / (1000 * 60 * 60 * 24));
    if (daysAgo < 7) {
      counts[6 - daysAgo]++;
    }
  });

  return { days, counts };
}

function renderFrequencyChart(data) {
  const ctx = document.getElementById('frequencyChart').getContext('2d');
  
  if (charts.frequency) charts.frequency.destroy();
  
  charts.frequency = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.days,
      datasets: [{
        label: 'Workouts',
        data: data.counts,
        backgroundColor: 'rgba(102, 126, 234, 0.6)',
        borderColor: 'rgba(102, 126, 234, 1)',
        borderWidth: 2,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function renderRepsChart(data) {
  const ctx = document.getElementById('repsChart').getContext('2d');
  
  if (charts.reps) charts.reps.destroy();
  
  const labels = data.slice(-10).map((_, i) => `Workout ${i + 1}`);
  const totalReps = data.slice(-10).map(d => d.reps_total || 0);
  const goodReps = data.slice(-10).map(d => d.reps_good || 0);

  charts.reps = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Reps',
          data: totalReps,
          borderColor: 'rgba(102, 126, 234, 1)',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          tension: 0.4,
          fill: true
        },
        {
          label: 'Good Reps',
          data: goodReps,
          borderColor: 'rgba(76, 175, 80, 1)',
          backgroundColor: 'rgba(76, 175, 80, 0.1)',
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderAnglesChart(data) {
  const ctx = document.getElementById('anglesChart').getContext('2d');
  
  if (charts.angles) charts.angles.destroy();
  
  const avgKnee = (data.reduce((sum, d) => sum + (d.average_knee_angle || 0), 0) / data.length || 0).toFixed(1);
  const avgHip = (data.reduce((sum, d) => sum + (d.average_hip_angle || 0), 0) / data.length || 0).toFixed(1);
  const avgTorso = (data.reduce((sum, d) => sum + (d.average_torso_angle || 0), 0) / data.length || 0).toFixed(1);

  charts.angles = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Knee Angle', 'Hip Angle', 'Torso Angle'],
      datasets: [{
        label: 'Average Angles (°)',
        data: [avgKnee, avgHip, avgTorso],
        borderColor: 'rgba(118, 75, 162, 1)',
        backgroundColor: 'rgba(118, 75, 162, 0.2)',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        r: {
          beginAtZero: true,
          max: 180
        }
      }
    }
  });
}

function renderDurationChart(data) {
  const ctx = document.getElementById('durationChart').getContext('2d');
  
  if (charts.duration) charts.duration.destroy();
  
  const labels = data.slice(-10).map((_, i) => `Session ${i + 1}`);
  const durations = data.slice(-10).map(d => Math.round((d.duration_seconds || 0) / 60));

  charts.duration = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Duration (minutes)',
        data: durations,
        borderColor: 'rgba(255, 152, 0, 1)',
        backgroundColor: 'rgba(255, 152, 0, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderHistoryTable(data) {
  const container = document.getElementById('historyTable');
  
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No workout history yet. Start a workout to see your progress!</p></div>';
    return;
  }

  const sortedData = data.sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date));

  let html = `
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Date</th>
          <th>Total Reps</th>
          <th>Good Reps</th>
          <th>Best Hold</th>
          <th>Avg Knee</th>
          <th>Avg Hip</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
  `;

  sortedData.forEach(record => {
    const date = new Date(record.workout_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const time = new Date(record.workout_date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const duration = Math.round(record.duration_seconds / 60);

    html += `
      <tr>
        <td><span class="tag ${record.workout_type}">${record.workout_type}</span></td>
        <td>${date} ${time}</td>
        <td>${record.reps_total || 0}</td>
        <td>${record.reps_good || 0}</td>
        <td>${record.best_hold?.toFixed(1) || 0}s</td>
        <td>${record.average_knee_angle?.toFixed(1) || 0}°</td>
        <td>${record.average_hip_angle?.toFixed(1) || 0}°</td>
        <td>${duration}m</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

async function logout() {
  try {
    await fetch(`${API_BASE_URL}/api/logout`, {
      method: 'POST',
      credentials: 'include'
    });
  } catch (err) {
    console.error('Logout error:', err);
  }
  window.location.href = 'auth.html';
}

// Load data on page load
window.addEventListener('load', loadDashboardData);
