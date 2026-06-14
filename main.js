const CONFIG = {
  camera: { width: 960, height: 540 },
  pose: {
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
    modelComplexity: 1,
    smoothLandmarks: true
  },
  general: {
    vis_thresh: 0.6,
    alpha_angle: 0.65,
    alpha_depth: 0.65
  },
  squat: {
    knee_stand_min: 165,
    hip_stand_min: 165,
    descent_gate_knee: 150,
    descent_gate_hip: 150,
    knee_depth_max: 110,
    hip_fold_max: 130,
    torso_upright_min: 160,
    shin_lean_max: 40,
    hip_below_knee_margin: -0.05,
    timers: {
      min_descent_time: 320,
      min_bottom_hold: 500,
      min_ascent_time: 250,
      min_rep_time: 2500,
      refractory_ms: 250
    }
  },
  wallsit: {
    knee_target: 90,
    knee_tolerance: 15
  }
};

const LM = {
  LEFT_HIP: 23,
  LEFT_KNEE: 25,
  LEFT_ANKLE: 27,
  LEFT_SHOULDER: 11,
  LEFT_HEEL: 29,
  LEFT_FOOT_INDEX: 31,
  RIGHT_HIP: 24,
  RIGHT_KNEE: 26,
  RIGHT_ANKLE: 28,
  RIGHT_SHOULDER: 12,
  RIGHT_HEEL: 30,
  RIGHT_FOOT_INDEX: 32,
  RIGHT_ANKLE_ID: 28
};

function angle3pt(a, b, c) {
  const ba = [a[0] - b[0], a[1] - b[1]];
  const bc = [c[0] - b[0], c[1] - b[1]];
  const denom = (Math.hypot(...ba) * Math.hypot(...bc)) + 1e-9;
  const cosang = Math.min(1, Math.max(-1, ((ba[0] * bc[0]) + (ba[1] * bc[1])) / denom));
  const ang = Math.acos(cosang) * 180 / Math.PI;
  return ang > 180 ? 360 - ang : ang;
}

function angleWithVertical(p1, p2) {
  const v = [p2[0] - p1[0], p2[1] - p1[1]];
  const dy = v[1];
  const dx = Math.abs(v[0]);
  return Math.abs(Math.atan2(dx, Math.abs(dy) > 1e-9 ? dy : 1e-9) * 180 / Math.PI);
}

class EMA {
  constructor(alpha = 0.65) { this.alpha = alpha; this._val = null; }
  update(x) { this._val = this._val === null ? x : (this.alpha * this._val + (1 - this.alpha) * x); return this._val; }
  reset() { this._val = null; }
  get value() { return this._val; }
}

function nowMs() { return performance.now(); }

function getLandmarkSafe(lms, idx) {
  if (!lms || !lms[idx]) return [0, 0, 0, 0];
  const lm = lms[idx];
  return [lm.x, lm.y, lm.z, lm.visibility ?? 0];
}

class PoseState {
  constructor(cfg) { this.cfg = cfg; this.lastLandmarks = null; }
  update(landmarks) { this.lastLandmarks = landmarks || null; }
  sideQuality(side) {
    if (!this.lastLandmarks) return 0;
    const pts = side === 'LEFT'
      ? [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_SHOULDER, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX]
      : [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_SHOULDER, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX];
    const vis = pts.map(p => (this.lastLandmarks[p]?.visibility ?? 0));
    return vis.reduce((a, b) => a + b, 0) / vis.length;
  }
  getSideLandmarks(side) {
    if (!this.lastLandmarks) return null;
    const keys = side === 'LEFT'
      ? [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_SHOULDER, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX]
      : [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_SHOULDER, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX];
    return keys.map(k => getLandmarkSafe(this.lastLandmarks, k));
  }
  static xy(lm) { return [lm[0], lm[1]]; }
}

class SquatCounter {
  constructor(cfg) {
    this.cfg = cfg;
    const s = cfg.squat; const g = cfg.general;
    this.vis_thresh = g.vis_thresh;
    this.alpha_angle = g.alpha_angle; this.alpha_depth = g.alpha_depth;
    this.knee_stand_min = s.knee_stand_min; this.hip_stand_min = s.hip_stand_min;
    this.descent_gate_knee = s.descent_gate_knee; this.descent_gate_hip = s.descent_gate_hip;
    this.knee_depth_max = s.knee_depth_max; this.hip_fold_max = s.hip_fold_max;
    this.torso_upright_min = s.torso_upright_min; this.shin_lean_max = s.shin_lean_max;
    this.hip_below_knee_margin = s.hip_below_knee_margin;
    const t = s.timers;
    this.min_descent_time = t.min_descent_time; this.min_bottom_hold = t.min_bottom_hold;
    this.min_ascent_time = t.min_ascent_time; this.min_rep_time = t.min_rep_time; this.refractory_ms = t.refractory_ms;

    this.STATE_TOP = 'TOP'; this.STATE_DESCENT = 'DESCENT'; this.STATE_BOTTOM = 'BOTTOM'; this.STATE_ASCENT = 'ASCENT';
    this.state = this.STATE_TOP;
    this.last_state_change_ms = nowMs();
    this.last_rep_ms = -1e9;
    this.reps_total = 0; this.reps_good = 0;

    this.sm_knee = new EMA(this.alpha_angle);
    this.sm_hip = new EMA(this.alpha_angle);
    this.sm_torso = new EMA(this.alpha_angle);
    this.sm_shin = new EMA(this.alpha_angle);
    this.sm_hip_y = new EMA(this.alpha_depth);
    this.sm_knee_y = new EMA(this.alpha_depth);

    this.resetRepTrackers();
  }

  resetRepTrackers() {
    this.min_knee_angle_seen = 180;
    this.min_hip_angle_seen = 180;
    this.max_torso_ang_seen = 0;
    this.max_shin_ang_seen = 0;
    this.max_depth_hip_minus_knee = -10;
  }

  evaluate(poseState) {
    const diagnostics = {
      state: this.state,
      reps_total: this.reps_total,
      reps_good: this.reps_good,
      feedback_lines: [],
      warn_lines: [],
      angles: {}
    };

    if (!poseState.lastLandmarks) {
      diagnostics.feedback_lines.push('No pose detected. Face the camera side-on.');
      return diagnostics;
    }

    const side = poseState.sideQuality('LEFT') >= poseState.sideQuality('RIGHT') ? 'LEFT' : 'RIGHT';
    const lms = poseState.getSideLandmarks(side);
    if (!lms) return diagnostics;
    const [hip, knee, ankle, shoulder, heel, toe] = lms;
    if (Math.min(hip[3], knee[3], ankle[3], shoulder[3]) < this.vis_thresh) {
      diagnostics.feedback_lines.push(`Low visibility on ${side} side. Re-position.`);
      return diagnostics;
    }

    const hip_xy = PoseState.xy(hip); const knee_xy = PoseState.xy(knee);
    const ankle_xy = PoseState.xy(ankle); const shoulder_xy = PoseState.xy(shoulder);
    const knee_ang = angle3pt(hip_xy, knee_xy, ankle_xy);
    const hip_ang = angle3pt(shoulder_xy, hip_xy, knee_xy);
    const torso_ang = angleWithVertical(hip_xy, shoulder_xy);
    const shin_ang = angleWithVertical(ankle_xy, knee_xy);

    const sk = this.sm_knee.update(knee_ang);
    const sh = this.sm_hip.update(hip_ang);
    const st = this.sm_torso.update(torso_ang);
    const ss = this.sm_shin.update(shin_ang);
    const shy = this.sm_hip_y.update(hip_xy[1]);
    const sky = this.sm_knee_y.update(knee_xy[1]);

    this.min_knee_angle_seen = Math.min(this.min_knee_angle_seen, sk);
    this.min_hip_angle_seen = Math.min(this.min_hip_angle_seen, sh);
    this.max_torso_ang_seen = Math.max(this.max_torso_ang_seen, st);
    this.max_shin_ang_seen = Math.max(this.max_shin_ang_seen, ss);
    const depth_hip_minus_knee = (shy - sky);
    this.max_depth_hip_minus_knee = Math.max(this.max_depth_hip_minus_knee, depth_hip_minus_knee);

    diagnostics.angles = {
      knee: sk, hip: sh, torso: st, shin: ss,
      min_knee_seen: this.min_knee_angle_seen,
      min_hip_seen: this.min_hip_angle_seen,
      max_torso_seen: this.max_torso_ang_seen,
      max_shin_seen: this.max_shin_ang_seen,
      max_depth_hip_minus_knee: this.max_depth_hip_minus_knee
    };

    const t = nowMs();
    const time_in_state = t - this.last_state_change_ms;
    const time_since_rep = t - this.last_rep_ms;

    if (this.state === this.STATE_TOP) {
      if ((sk < this.descent_gate_knee) && (sh < this.descent_gate_hip) && (time_since_rep > this.refractory_ms)) {
        this.state = this.STATE_DESCENT; this.last_state_change_ms = t; this.resetRepTrackers();
      }
    } else if (this.state === this.STATE_DESCENT) {
      const deep_enough = (sk <= this.knee_depth_max) || (this.max_depth_hip_minus_knee >= this.hip_below_knee_margin);
      if (deep_enough && time_in_state >= this.min_descent_time) {
        this.state = this.STATE_BOTTOM; this.last_state_change_ms = t;
      } else if ((sk > this.knee_stand_min && sh > this.hip_stand_min && time_in_state > 150)) {
        this.state = this.STATE_TOP; this.last_state_change_ms = t;
      }
    } else if (this.state === this.STATE_BOTTOM) {
      if (time_in_state >= this.min_bottom_hold) {
        if (sk > (this.knee_depth_max + 10) && sh > (this.hip_fold_max + 10)) {
          this.state = this.STATE_ASCENT; this.last_state_change_ms = t;
        }
      }
    } else if (this.state === this.STATE_ASCENT) {
      const reached_top = (sk >= this.knee_stand_min && sh >= this.hip_stand_min);
      const long_enough = ((t - this.last_state_change_ms) >= this.min_ascent_time);
      const total_rep_time = (t - (this.last_state_change_ms - this.min_bottom_hold - this.min_descent_time));
      const realistic_rep = (total_rep_time >= this.min_rep_time);

      if (reached_top && long_enough && realistic_rep) {
        const torso_ok = (this.max_torso_ang_seen >= this.torso_upright_min);
        const shin_ok = (this.max_shin_ang_seen <= this.shin_lean_max);
        const hip_below = (this.max_depth_hip_minus_knee >= this.hip_below_knee_margin) || (this.min_knee_angle_seen <= this.knee_depth_max);
        const depth_ok = (this.min_knee_angle_seen <= this.knee_depth_max) || (this.min_hip_angle_seen <= this.hip_fold_max);

        this.reps_total += 1;
        if (depth_ok && hip_below && torso_ok && shin_ok) {
          this.reps_good += 1;
        }

        this.last_rep_ms = t;
        this.state = this.STATE_TOP;
        this.last_state_change_ms = t;
        this.resetRepTrackers();
      } else if ((sk < this.descent_gate_knee && sh < this.descent_gate_hip) && time_in_state > 150) {
        this.state = this.STATE_DESCENT; this.last_state_change_ms = t;
      }
    }

    if (this.max_torso_ang_seen < this.torso_upright_min) {
      diagnostics.warn_lines.push(`Torso too forward (${st.toFixed(0)}°)`);
    } else {
      diagnostics.feedback_lines.push(`Torso OK (${st.toFixed(0)}°)`);
    }

    const toe_x = toe[0]; const knee_x = knee[0];
    if (knee_x > toe_x + 0.12) {
      diagnostics.warn_lines.push('Knees too far forward');
    } else {
      diagnostics.feedback_lines.push('Knee position OK');
    }

    if (this.max_depth_hip_minus_knee < this.hip_below_knee_margin) {
      diagnostics.warn_lines.push('Go deeper');
    } else {
      diagnostics.feedback_lines.push('Depth OK');
    }

    diagnostics.state = this.state;
    diagnostics.reps_total = this.reps_total;
    diagnostics.reps_good = this.reps_good;
    return diagnostics;
  }

  resetCounters() {
    this.reps_total = 0; this.reps_good = 0; this.state = this.STATE_TOP;
    this.last_state_change_ms = nowMs(); this.last_rep_ms = -1e9;
    this.resetRepTrackers();
    this.sm_knee.reset(); this.sm_hip.reset(); this.sm_torso.reset(); this.sm_shin.reset();
    this.sm_hip_y.reset(); this.sm_knee_y.reset();
  }
}

class WallSitTrainer {
  constructor(cfg) {
    this.cfg = cfg;
    this.knee_target = cfg.wallsit.knee_target;
    this.tolerance = cfg.wallsit.knee_tolerance;
    this.hold_start = null;
    this.best_hold = 0;
  }

  evaluate(poseState) {
    const diagnostics = { holding: false, hold_time: 0, best_hold: this.best_hold, feedback: [], angles: {} };
    if (!poseState.lastLandmarks) {
      diagnostics.feedback.push('No pose detected');
      return diagnostics;
    }

    const hip = getLandmarkSafe(poseState.lastLandmarks, LM.RIGHT_HIP);
    const knee = getLandmarkSafe(poseState.lastLandmarks, LM.RIGHT_KNEE);
    const ankle = getLandmarkSafe(poseState.lastLandmarks, LM.RIGHT_ANKLE_ID);

    const hip_xy = PoseState.xy(hip); const knee_xy = PoseState.xy(knee); const ankle_xy = PoseState.xy(ankle);
    const knee_angle = angle3pt(hip_xy, knee_xy, ankle_xy);
    diagnostics.angles.knee = knee_angle;

    const lower = this.knee_target - this.tolerance;
    const upper = this.knee_target + this.tolerance;
    if (knee_angle >= lower && knee_angle <= upper) {
      if (this.hold_start === null) this.hold_start = performance.now();
      const hold_time = (performance.now() - this.hold_start) / 1000;
      this.best_hold = Math.max(this.best_hold, hold_time);
      diagnostics.holding = true; diagnostics.hold_time = hold_time; diagnostics.best_hold = this.best_hold;
      diagnostics.feedback.push(`Holding: ${hold_time.toFixed(1)}s`);
    } else {
      this.hold_start = null; diagnostics.holding = false; diagnostics.feedback.push('Adjust position');
    }
    return diagnostics;
  }

  reset() { this.hold_start = null; this.best_hold = 0; }
}

const videoEl = document.getElementById('camera');
const canvasEl = document.getElementById('overlay');
const ctx = canvasEl.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const modeSelect = document.getElementById('mode');
const poseStateLabel = document.getElementById('poseState');
const statusText = document.getElementById('statusText');
const showSkeletonToggle = document.getElementById('showSkeleton');
const mirrorToggle = document.getElementById('mirrorView');
const feedbackList = document.getElementById('feedbackList');
const warnList = document.getElementById('warnList');
const repsTotalEl = document.getElementById('repsTotal');
const repsGoodEl = document.getElementById('repsGood');
const flowStateEl = document.getElementById('flowState');
const holdTimeEl = document.getElementById('holdTime');
const bestHoldEl = document.getElementById('bestHold');
const torsoAngleEl = document.getElementById('torsoAngle');
const kneeAngleEl = document.getElementById('kneeAngle');
const hipAngleEl = document.getElementById('hipAngle');
const hudStatus = document.getElementById('hudStatus');
const hudMode = document.getElementById('hudMode');
const exitWorkoutBtn = document.getElementById('exitWorkout');

const poseState = new PoseState(CONFIG.pose);
const squatCounter = new SquatCounter(CONFIG);
const wallSitTrainer = new WallSitTrainer(CONFIG);

let camera = null;
let pose = null;
let currentMode = 'squat';
let skeletonVisible = true;
let workoutMode = false;
let workoutStartTime = null;
let workoutMetrics = {
  angles: [],
  kneeAngles: [],
  hipAngles: [],
  torsoAngles: []
};

function setStatus(text, active = false) {
  statusText.textContent = text;
  if (hudStatus) hudStatus.textContent = text;
  const dot = document.querySelector('.hero__badge .dot');
  if (dot) dot.style.background = active ? 'var(--accent)' : 'var(--muted)';
}

function resizeCanvas() {
  const { videoWidth, videoHeight } = videoEl;
  if (!videoWidth || !videoHeight) return;
  canvasEl.width = videoWidth; canvasEl.height = videoHeight;
}

function renderOverlay(results) {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (!skeletonVisible || !results.poseLandmarks) return;
  drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#7fffd4', lineWidth: 4 });
  drawLandmarks(ctx, results.poseLandmarks, { color: '#ffb347', lineWidth: 2, radius: 4 });
}

function updateLists(listEl, items, warn = false) {
  listEl.innerHTML = '';
  if (!items || !items.length) {
    const li = document.createElement('li');
    li.textContent = '—'; listEl.appendChild(li); return;
  }
  items.forEach(txt => {
    const li = document.createElement('li');
    li.textContent = txt; if (warn) li.classList.add('warn'); listEl.appendChild(li);
  });
}

function updateDiagnostics(diag, angles = {}) {
  repsTotalEl.textContent = diag.reps_total ?? 0;
  repsGoodEl.textContent = diag.reps_good ?? 0;
  flowStateEl.textContent = diag.state ?? '—';
  torsoAngleEl.textContent = `${angles.torso ? angles.torso.toFixed(0) : 0}°`;
  kneeAngleEl.textContent = `${angles.knee ? angles.knee.toFixed(0) : 0}°`;
  hipAngleEl.textContent = `${angles.hip ? angles.hip.toFixed(0) : 0}°`;
  updateLists(feedbackList, diag.feedback_lines || diag.feedback);
  updateLists(warnList, diag.warn_lines, true);
}

function updatePoseLabel(text, tone = 'neutral') {
  poseStateLabel.textContent = text;
  const color = tone === 'ok' ? 'var(--success)' : tone === 'warn' ? 'var(--danger)' : 'var(--text)';
  poseStateLabel.style.color = color;
}

function enterWorkoutMode() {
  if (workoutMode) return;
  workoutMode = true;
  document.body.classList.add('workout-mode');
  if (hudMode) hudMode.textContent = currentMode === 'wallsit' ? 'Wall-sit' : currentMode === 'raw' ? 'Raw' : 'Squat';
}

function exitWorkoutMode() {
  if (!workoutMode) return;
  workoutMode = false;
  document.body.classList.remove('workout-mode');
}

async function onResults(results) {
  poseState.update(results.poseLandmarks);
  resizeCanvas();
  renderOverlay(results);

  let diag = { feedback_lines: [], warn_lines: [], state: '—', reps_total: 0, reps_good: 0 };
  if (currentMode === 'squat') {
    diag = squatCounter.evaluate(poseState);
  } else if (currentMode === 'wallsit') {
    diag = wallSitTrainer.evaluate(poseState);
    holdTimeEl.textContent = `${diag.hold_time?.toFixed(1) ?? 0}s`;
    bestHoldEl.textContent = `${diag.best_hold?.toFixed(1) ?? 0}s`;
  }

  // Track metrics for progress
  if (diag.angles) {
    if (diag.angles.knee !== undefined) workoutMetrics.kneeAngles.push(diag.angles.knee);
    if (diag.angles.hip !== undefined) workoutMetrics.hipAngles.push(diag.angles.hip);
    if (diag.angles.torso !== undefined) workoutMetrics.torsoAngles.push(diag.angles.torso);
  }

  if (!poseState.lastLandmarks) {
    updatePoseLabel('No pose detected', 'warn');
  } else {
    updatePoseLabel(currentMode === 'wallsit' ? 'Wall-sit tracking' : 'Squat tracking', 'ok');
  }

  updateDiagnostics(diag, diag.angles || {});
}

function initPose() {
  pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
  pose.setOptions(CONFIG.pose);
  pose.onResults(onResults);
}

async function startCamera() {
  if (camera) return;

  try {
    if (typeof Camera === 'undefined' || typeof Pose === 'undefined') {
      throw new Error('Camera libraries failed to load');
    }

    initPose();
    workoutStartTime = Date.now();
    workoutMetrics = { angles: [], kneeAngles: [], hipAngles: [], torsoAngles: [] };
    camera = new Camera(videoEl, {
      onFrame: async () => { await pose.send({ image: videoEl }); },
      width: CONFIG.camera.width,
      height: CONFIG.camera.height
    });
    await camera.start();
    startBtn.disabled = true; stopBtn.disabled = false; resetBtn.disabled = false;
    setStatus('Streaming', true);
    enterWorkoutMode();
  } catch (err) {
    camera = null;
    workoutStartTime = null;
    updatePoseLabel(err?.message || 'Camera failed to start', 'warn');
    setStatus('Camera error', false);
    startBtn.disabled = false; stopBtn.disabled = true; resetBtn.disabled = true;
    console.error('Camera startup error:', err);
  }
}

function stopCamera() {s
  if (camera && camera.stop) camera.stop();
  camera = null;
  startBtn.disabled = false; stopBtn.disabled = true;
  setStatus('Idle', false);
  poseState.update(null);
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  updatePoseLabel('Camera stopped', 'warn');
  exitWorkoutMode();
  
  // Save progress if workout was started
  if (workoutStartTime && (currentMode === 'squat' || currentMode === 'wallsit')) {
    saveWorkoutProgress();
  }
}

function resetCounters() {
  squatCounter.resetCounters();
  wallSitTrainer.reset();
  updateDiagnostics({ reps_total: 0, reps_good: 0, state: 'TOP', feedback_lines: [], warn_lines: [] });
  holdTimeEl.textContent = '0.0s';
  bestHoldEl.textContent = '0.0s';
}

const API_BASE_URL =
  window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://exercise-pdms.onrender.com';

async function readResponseBody(res) {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return await res.json();
  }

  const text = await res.text();
  return { message: text || `Request failed with status ${res.status}` };
}

async function apiRequest(path, options = {}) {
  console.log('API_BASE_URL:', API_BASE_URL);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    const msg = await readResponseBody(res).catch(() => ({}));
    throw new Error(msg.message || 'Request failed');
  }
  return readResponseBody(res);
}

async function handleLogout() {
  try { 
    await apiRequest('/api/logout', { method: 'POST' }); 
  } catch (err) { 
    console.error('Logout error:', err); 
  }
  window.location.href = 'auth.html';
}

async function ensureAuth() {
  try {
    await apiRequest('/api/me');
    startBtn.disabled = false;
  } catch {
    setStatus('Auth required', false);
    window.location.href = 'auth.html';
  }
}

async function saveWorkoutProgress() {
  try {
    const durationSeconds = Math.round((Date.now() - workoutStartTime) / 1000);
    
    // Calculate averages
    const avgKneeAngle = workoutMetrics.kneeAngles.length > 0
      ? workoutMetrics.kneeAngles.reduce((a, b) => a + b, 0) / workoutMetrics.kneeAngles.length
      : 0;
    
    const avgHipAngle = workoutMetrics.hipAngles.length > 0
      ? workoutMetrics.hipAngles.reduce((a, b) => a + b, 0) / workoutMetrics.hipAngles.length
      : 0;
    
    const avgTorsoAngle = workoutMetrics.torsoAngles.length > 0
      ? workoutMetrics.torsoAngles.reduce((a, b) => a + b, 0) / workoutMetrics.torsoAngles.length
      : 0;

    const progressData = {
      workoutType: currentMode,
      repsTotal: parseInt(repsTotal.textContent) || 0,
      repsGood: parseInt(repsGood.textContent) || 0,
      bestHold: currentMode === 'wallsit' ? parseFloat(bestHoldEl.textContent) || 0 : 0,
      avgKneeAngle,
      avgHipAngle,
      avgTorsoAngle,
      durationSeconds
    };

    await apiRequest('/api/progress', {
      method: 'POST',
      body: JSON.stringify(progressData)
    });

    console.log('Workout progress saved!');
  } catch (err) {
    console.error('Error saving progress:', err);
  }
}

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
resetBtn.addEventListener('click', resetCounters);
modeSelect.addEventListener('change', (e) => {
  currentMode = e.target.value;
  if (hudMode) hudMode.textContent = currentMode === 'wallsit' ? 'Wall-sit' : currentMode === 'raw' ? 'Raw' : 'Squat';
  resetCounters();
});
showSkeletonToggle.addEventListener('change', (e) => { skeletonVisible = e.target.checked; });
mirrorToggle.addEventListener('change', (e) => {
  const scale = e.target.checked ? -1 : 1;
  videoEl.style.transform = `scaleX(${scale})`;
  canvasEl.style.transform = `scaleX(${scale})`;
});
if (exitWorkoutBtn) exitWorkoutBtn.addEventListener('click', () => { stopCamera(); });
if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopCamera(); });

ensureAuth();
startBtn.disabled = false;
setStatus('Idle', false);
updatePoseLabel('No pose detected', 'warn');
updateDiagnostics({ reps_total: 0, reps_good: 0, state: 'TOP', feedback_lines: ['Camera not started'], warn_lines: [] });
