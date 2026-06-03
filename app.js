// Concretus - Core Application Controller (Supabase Integrated)

// === SUPABASE CONFIGURATION ===
// Replace these placeholders with your actual Supabase URL and Anon Key
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

let supabaseClient = null;

// Prevent naming collisions with window.supabase library
if (SUPABASE_URL !== "YOUR_SUPABASE_URL" && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY") {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.error("Supabase CDN failed to load.");
  }
}

// Fallback seed data if Supabase credentials are not configured
const SEED_BATCH_DATA = [
  {
    id: "349010", 
    projectNo: "707303/1",
    orderNo: "95205419",
    clientName: "תעשיות רדימיקס בע״מ",
    contractor: "סולל בונה בע״מ",
    inspector: "אינג' אברהם כהן",
    siteAddress: "מרחב דרום באר שבע",
    buildingDesc: "בניין משרדים גובה 5 קומות",
    element: "קיר",
    volume: 8,
    supplier: "רדימיקס",
    isCertified: "כן",
    concreteType: "ב-30",
    cementType: "צ.פ",
    aggregateSize: "פוליה קטנה: כ-19 מ״מ",
    exposureClass: 2,
    characterization: ["רגיל", "משאבה"],
    sampledFrom: "הערבל",
    slump: 8,
    deliveryNote: "95205419",
    mixerNo: "349",
    batchNo: "1",
    samplerName: "משה לוי",
    timeStart: "13:00",
    timeEnd: "13:30",
    samplesCount: 6,
    dimension: 150,
    area: 22500,
    status: "completed",
    castDate: "2026-05-01",
    testDate: "2026-05-29",
    failureLoad7d: 745.0,
    strength7d: 33.11,
    failureLoad28d: 952.0,
    strength28d: 42.31,
    conformity: "pass",
    certSerial: "CERT-2026-10492",
    remarks: "הבטון סופק בטמפרטורה תקינה, לא הוספו מים בשטח.",
    signature1: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAABGAQMAaad5K2v3AAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAABRJREFUeNpjYBgFo2AUjIJRMApIBwAGQAABeW2tagAAAABJRU5ErkJggg=="
  }
];

const CONCRETE_CLASS_LIMITS = {
  "ב-15": 15,
  "ב-20": 20,
  "ב-25": 25,
  "ב-30": 30,
  "ב-40": 40,
  "ב-50": 50,
  "ב-60": 60
};

// --- Application Core State ---
let cubes = [];
let activeUser = null;
let activeUserRole = "field_worker"; 
let isRegisterMode = false;

let activeWaybillCube = null;
let activeTestingCube = null;
let activeDimension = 150; 
let isSafetyShieldClosed = false;
let isCrushingInProgress = false;

let canvases = {};
let contexts = {};
let drawingStates = {};
let values = { volume: 8, slump: 8, samples: 6, exposure: 2 };

// --- Initialize App ---
document.addEventListener("DOMContentLoaded", () => {
  setupRouter();
  
  const dateInput = document.getElementById("casting-date");
  if (dateInput) dateInput.valueAsDate = new Date();

  if (supabaseClient) {
    checkActiveSession();
  } else {
    document.getElementById("auth-panel").classList.add("hidden");
    document.getElementById("app-wrapper").classList.remove("hidden");
    console.warn("Supabase keys not found. Running in local fallback mode.");
    loadFallbackData();
  }
});

// --- Fallback Local Methods ---
function loadFallbackData() {
  const stored = localStorage.getItem("concretus_is_cubes");
  if (stored) {
    cubes = JSON.parse(stored);
  } else {
    cubes = [...SEED_BATCH_DATA];
    localStorage.setItem("concretus_is_cubes", JSON.stringify(cubes));
  }
  renderDashboardCubes();
  renderLedgerTable();
  renderLabQueue();
  renderAnalyticsDashboard();
  updateHeaderStats();
}

// --- Check Active Session & Profile Status ---
async function checkActiveSession() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    
    if (session) {
      await establishSessionUser(session.user);
    } else {
      showAuthScreen();
    }
  } catch (err) {
    console.error("Session verification error:", err.message);
    showAuthScreen();
  }
}

async function establishSessionUser(user) {
  activeUser = user;
  
  try {
    let { data, error } = await supabaseClient
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .maybeSingle();
      
    if (error) {
      console.warn("Could not retrieve profile:", error.message);
    }

    if (!data) {
      const fallbackName = user.user_metadata?.full_name || user.email.split('@')[0];
      const fallbackRole = user.user_metadata?.role || "field_worker";
      
      const { data: newProfile, error: insertError } = await supabaseClient
        .from("profiles")
        .insert({
          id: user.id,
          full_name: fallbackName,
          role: fallbackRole
        })
        .select()
        .maybeSingle();
        
      if (insertError) {
        console.error("Failed to automatically generate profile row:", insertError.message);
        data = { role: fallbackRole, full_name: fallbackName };
      } else {
        data = newProfile;
      }
    }
    
    activeUserRole = data ? data.role : "field_worker";
    const userFullName = data ? data.full_name : user.email;
    
    const wrapper = document.getElementById("app-wrapper");
    wrapper.className = "app-container role-" + activeUserRole;
    
    document.getElementById("current-user-name").textContent = userFullName;
    document.getElementById("current-user-role").textContent = activeUserRole === "manager" ? "מנהל מערכת" : "דוגם שטח";
    document.getElementById("current-user-avatar").textContent = userFullName.slice(0, 2).toUpperCase();

    document.getElementById("auth-panel").classList.add("hidden");
    document.getElementById("app-wrapper").classList.remove("hidden");

    if (activeUserRole === "field_worker") {
      switchActiveView("casting-view");
    } else {
      switchActiveView("dashboard-view");
    }
    
    await syncAllDataFromSupabase();

  } catch (err) {
    console.error("Session establishment error:", err.message);
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById("app-wrapper").classList.add("hidden");
  document.getElementById("auth-panel").classList.remove("hidden");
}

// --- Supabase Authentication Methods ---
async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const fullname = document.getElementById("auth-fullname").value.trim();
  const feedback = document.getElementById("auth-feedback");

  feedback.style.display = "none";

  if (!supabaseClient) {
    alert("Supabase config invalid or incomplete.");
    return;
  }

  try {
    if (isRegisterMode) {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullname || "משתמש חדש",
            role: "field_worker"
          }
        }
      });
      if (error) throw error;
      
      feedback.style.display = "block";
      feedback.className = "feedback success";
      feedback.textContent = "הרשמה הושלמה בהצלחה! כעת ניתן להתחבר.";
      toggleAuthMode();
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });
      if (error) throw error;
      
      await establishSessionUser(data.user);
    }
  } catch (err) {
    feedback.style.display = "block";
    feedback.className = "feedback error";
    feedback.textContent = "שגיאה: " + err.message;
  }
}

async function handleSignOut() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  activeUser = null;
  showAuthScreen();
}

function toggleAuthMode() {
  isRegisterMode = !isRegisterMode;
  const title = document.getElementById("auth-title");
  const submitBtn = document.getElementById("btn-auth-submit");
  const toggleText = document.getElementById("auth-toggle-text");
  const regFields = document.getElementById("register-only-fields");

  if (isRegisterMode) {
    title.textContent = "הרשמת משתמש חדש";
    submitBtn.textContent = "צור חשבון";
    toggleText.textContent = "כבר רשום? התחבר כאן";
    regFields.classList.remove("hidden");
  } else {
    title.textContent = "כניסה למערכת";
    submitBtn.textContent = "התחבר";
    toggleText.textContent = "אין לך חשבון? הרשם כאן";
    regFields.classList.add("hidden");
  }
}

// --- Sync Data ---
async function syncAllDataFromSupabase() {
  if (!supabaseClient) return;
  
  triggerSyncPulseAnimation("טוען נתונים מהענן...");
  
  try {
    const { data, error } = await supabaseClient
      .from("concrete_samples")
      .select("*")
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    
    cubes = data.map(dbRow => ({
      id: dbRow.id,
      projectNo: dbRow.project_no,
      orderNo: dbRow.order_no,
      clientName: dbRow.client_name,
      contractor: dbRow.contractor,
      inspector: dbRow.inspector,
      siteAddress: dbRow.site_address,
      buildingDesc: dbRow.building_desc,
      element: dbRow.element,
      volume: Number(dbRow.volume),
      supplier: dbRow.supplier,
      isCertified: dbRow.is_certified,
      concreteType: dbRow.concrete_type,
      cementType: dbRow.cement_type,
      aggregateSize: dbRow.aggregate_size,
      exposureClass: dbRow.exposure_class,
      characterization: dbRow.characterization || [],
      sampledFrom: dbRow.sampled_from,
      slump: dbRow.slump,
      deliveryNote: dbRow.delivery_note,
      mixerNo: dbRow.mixer_no,
      batchNo: dbRow.batch_no,
      samplerName: dbRow.sampler_name,
      timeStart: dbRow.time_start,
      timeEnd: dbRow.time_end,
      samplesCount: dbRow.samples_count,
      dimension: dbRow.dimension,
      area: dbRow.area,
      status: dbRow.status,
      castDate: dbRow.cast_date,
      testDate: dbRow.test_date,
      failureLoad7d: dbRow.failure_load_7d ? Number(dbRow.failure_load_7d) : null,
      strength7d: dbRow.strength_7d ? Number(dbRow.strength_7d) : null,
      failureLoad28d: dbRow.failure_load_28d ? Number(dbRow.failure_load_28d) : null,
      strength28d: dbRow.strength_28d ? Number(dbRow.strength_28d) : null,
      conformity: dbRow.conformity,
      certSerial: dbRow.cert_serial,
      remarks: dbRow.remarks,
      signature1: dbRow.signature1,
      signature2: dbRow.signature2
    }));

    renderDashboardCubes();
    renderLedgerTable();
    renderLabQueue();
    renderAnalyticsDashboard();
    updateHeaderStats();

  } catch (err) {
    console.error("Fetch syncing error:", err.message);
  }
}

// --- View Router ---
function setupRouter() {
  const navItems = document.querySelectorAll(".sidebar .nav-item");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetView = item.getAttribute("data-view");
      if (activeUserRole === "field_worker" && ["dashboard-view", "lab-view", "reports-view"].includes(targetView)) {
        alert("שגיאה: אין לך הרשאות לגשת לעמוד זה.");
        return;
      }

      navItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      switchActiveView(targetView);
    });
  });
}

function switchActiveView(viewId) {
  if (activeUserRole === "field_worker" && ["dashboard-view", "lab-view", "reports-view"].includes(viewId)) {
    viewId = "casting-view";
  }

  document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active-view"));
  const targetViewPanel = document.getElementById(viewId);
  if (targetViewPanel) {
    targetViewPanel.classList.add("active-view");
  }

  document.querySelectorAll(".sidebar .nav-item").forEach(item => {
    if (item.getAttribute("data-view") === viewId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  const headerTitle = document.getElementById("header-view-title");
  const headerDesc = document.getElementById("header-view-desc");

  switch(viewId) {
    case "dashboard-view":
      headerTitle.textContent = "לוח בקרה כללי";
      headerDesc.textContent = "ניטור מדדים, יציקות פעילות, והתראות על בדיקות לחיצה ממתינות.";
      renderDashboardCubes();
      updateHeaderStats();
      break;
    case "casting-view":
      headerTitle.textContent = "טופס נטילת בטון דיגיטלי";
      headerDesc.textContent = "מילוי פרטי נטילת מדגמים בשטח ואימות דפי מדבקות בזמן אמת.";
      renderCastingSideList();
      resetCastingFormState();
      break;
    case "dispatch-view":
      headerTitle.textContent = "פנקס נטילות ומשלוחים";
      headerDesc.textContent = "צפייה בפנקס נטילות שטח פעיל, הפקת קודי QR ושילוח למעבדה.";
      renderLedgerTable();
      break;
    case "lab-view":
      headerTitle.textContent = "חדר בדיקות ולחיצה";
      headerDesc.textContent = "קליטת מדגמי בטון המגיעים מהשטח והזנה ידנית של עומסי שבר.";
      renderLabQueue();
      resetCrusherState();
      break;
    case "reports-view":
      headerTitle.textContent = "תעודות ואישורי בדיקה";
      headerDesc.textContent = "הפקת תעודות בדיקה לפי ת״י 118, בחינת אחוזי תקינות וייצוא נתונים.";
      renderAnalyticsDashboard();
      break;
  }
}

// --- Header Stats Counter ---
function updateHeaderStats() {
  const statTotal = document.getElementById("stat-total-cast");
  const statTransit = document.getElementById("stat-transit");
  const statCompliance = document.getElementById("stat-compliance");
  const statFailed = document.getElementById("stat-failed");

  const total = cubes.length;
  const transit = cubes.filter(c => c.status === "transit" || c.status === "tested_7d").length;
  const completed = cubes.filter(c => c.status === "completed");
  const failed = completed.filter(c => c.conformity === "fail").length;
  
  let compliance = 100;
  if (completed.length > 0) {
    compliance = ((completed.length - failed) / completed.length) * 100;
  }

  if (statTotal) statTotal.textContent = total;
  if (statTransit) statTransit.textContent = transit;
  if (statCompliance) statCompliance.textContent = compliance.toFixed(1) + "%";
  if (statFailed) statFailed.textContent = failed;
}

// --- Step 1: Sticker Verification Logic (Updated to 6-digit requirements) ---
function verifySticker() {
  const inputVal = document.getElementById("sticker-number").value;
  const feedback = document.getElementById("sticker-feedback");
  const formBody = document.getElementById("casting-form");
  const verifyBtn = document.getElementById("btn-verify");
  const stickerInput = document.getElementById("sticker-number");

  if (inputVal.length !== 6) {
    feedback.style.display = "block";
    feedback.className = "feedback error";
    feedback.innerText = "❌ שגיאה: יש להזין מספר מדבקה באורך 6 ספרות בדיוק.";
    formBody.classList.add("hidden");
    return;
  }

  const exists = cubes.some(c => c.id === inputVal);
  if (exists) {
    feedback.style.display = "block";
    feedback.className = "feedback error";
    feedback.innerHTML = `⚠️ שגיאה: מדבקה מספר <b>${inputVal}</b> כבר נמצאת בשימוש במערכת. נא להזין מספר אחר.`;
    formBody.classList.add("hidden");
    return;
  }

  feedback.style.display = "block";
  feedback.className = "feedback success";
  feedback.innerHTML = `✓ דף מדבקות <b>${inputVal}</b> אושר ומקושר לטופס זה.`;

  stickerInput.disabled = true;
  verifyBtn.style.display = "none";
  formBody.classList.remove("hidden");
}

function resetCastingFormState() {
  document.getElementById("sticker-number").disabled = false;
  document.getElementById("sticker-number").value = "";
  document.getElementById("btn-verify").style.display = "block";
  document.getElementById("sticker-feedback").style.display = "none";
  document.getElementById("casting-form").classList.add("hidden");
  document.getElementById("casting-form").reset();
  
  document.querySelectorAll(".btn-option").forEach(o => o.classList.remove("selected"));
  document.querySelectorAll(".checkbox-tile").forEach(t => {
    t.classList.remove("checked");
    const input = t.querySelector('input[type="checkbox"]');
    if (input) input.checked = false;
  });

  values = { volume: 8, slump: 8, samples: 6, exposure: 2 };
  document.getElementById("exposure-display").innerText = values.exposure;
  document.getElementById("slump-display").innerText = values.slump;
  document.getElementById("samples-display").innerText = values.samples;

  canvases = {};
  contexts = {};
  drawingStates = {};
}

// --- Accordion Logic ---
function toggleAccordion(header) {
  const accordion = header.parentElement;
  accordion.classList.toggle("active");

  if (accordion.id === "accordion-section-5" && accordion.classList.contains("active")) {
    setTimeout(() => {
      initSignatureCanvas(1, 'canvas-1', 'sig-text-1');
      initSignatureCanvas(2, 'canvas-2', 'sig-text-2');
    }, 100);
  }
}

// --- Checkbox & Selector Helpers ---
function selectOption(groupId, element, val) {
  const group = document.getElementById(groupId);
  const options = group.getElementsByClassName("btn-option");
  for (let opt of options) {
    opt.classList.remove("selected");
  }
  element.classList.add("selected");
  
  if (groupId === "element-group") document.getElementById("selected-element").value = val;
  if (groupId === "certified-group") document.getElementById("is-certified").value = val;
  if (groupId === "sampled-from-group") document.getElementById("selected-sampled-from").value = val;
}

function toggleCheckbox(tile) {
  const checkbox = tile.querySelector('input[type="checkbox"]');
  checkbox.checked = !checkbox.checked;
  tile.classList.toggle("checked", checkbox.checked);
}

function selectDimensionTile(dims, element) {
  activeDimension = dims;
  const tiles = document.querySelectorAll(".radio-tile-label");
  tiles.forEach(t => t.classList.remove("active-tile"));
  element.classList.add("active-tile");
  element.querySelector("input").checked = true;
}

function adjustValue(type, amount) {
  values[type] += amount;
  if (values[type] < 0) values[type] = 0;
  
  const displayElement = document.getElementById(`${type}-display`);
  if (displayElement) displayElement.innerText = values[type];
}

// --- Signature Drawing Mechanics ---
function initSignatureCanvas(id, canvasId, textId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  canvases[id] = canvas;
  contexts[id] = ctx;
  drawingStates[id] = false;

  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;

  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function start(e) {
    drawingStates[id] = true;
    const placeholder = document.getElementById(textId);
    if (placeholder) placeholder.style.display = "none";
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  function draw(e) {
    if (!drawingStates[id]) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
  }

  function stop() { drawingStates[id] = false; }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", stop);

  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  window.addEventListener("touchend", stop);
}

function clearSignatureCanvas(id) {
  const canvas = canvases[id];
  const ctx = contexts[id];
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const placeholder = document.getElementById(`sig-text-${id}`);
    if (placeholder) placeholder.style.display = "block";
  }
}

function isSignatureCanvasEmpty(id) {
  const canvas = canvases[id];
  if (!canvas) return true;
  const blank = document.createElement('canvas');
  blank.width = canvas.width;
  blank.height = canvas.height;
  return canvas.toDataURL() === blank.toDataURL();
}

// --- Dynamic Feed Render (Dashboard View) ---
function renderDashboardCubes() {
  const container = document.getElementById("dashboard-cube-list");
  if (!container) return;
  container.innerHTML = "";

  const sortedCubes = [...cubes].reverse().slice(0, 5);

  if (sortedCubes.length === 0) {
    container.innerHTML = `<div class="manifest-empty" style="height: 100px;"><p>אין נטילות בטון רשומות במערכת.</p></div>`;
    return;
  }

  sortedCubes.forEach(cube => {
    const item = document.createElement("div");
    item.className = "cube-item-compact";

    let statusClass = "status-casted";
    let statusIcon = "fa-cube";
    let strengthDisplay = "";

    if (cube.status === "transit") {
      statusClass = "status-transit";
      statusIcon = "fa-truck-moving";
    } else if (cube.status === "tested_7d") {
      statusClass = "status-testing";
      statusIcon = "fa-clock";
      const str7d = cube.strength7d ? cube.strength7d.toFixed(2) : "0.00";
      strengthDisplay = `
        <div class="strength-result" style="color: var(--safety-orange);">
          ${str7d} MPa (7d)
          <span>ממתין לגיל 28d</span>
        </div>
      `;
    } else if (cube.status === "completed") {
      statusClass = "status-completed";
      statusIcon = "fa-square-check";
      const confClass = cube.conformity === "pass" ? "text-success" : "text-danger";
      const str28d = cube.strength28d ? cube.strength28d.toFixed(2) : "0.00";
      strengthDisplay = `
        <div class="strength-result ${confClass}">
          ${str28d} MPa (28d)
          <span>סוג ${cube.concreteType}</span>
        </div>
      `;
    }

    item.innerHTML = `
      <div class="cube-info-group" style="gap: 16px;">
        <div class="cube-icon-box ${statusClass}">
          <i class="fa-solid ${statusIcon}"></i>
        </div>
        <div class="cube-meta-box">
          <span class="cube-serial" style="text-align: right;">מדבקה #${cube.id}</span>
          <span class="cube-desc" style="text-align: right;">${cube.clientName} • ${cube.element}</span>
        </div>
      </div>
      <div class="cube-badge-group">
        <span class="status-chip status-${cube.status === 'tested_7d' ? 'testing' : cube.status}">
          ${cube.status === 'completed' ? (cube.conformity === 'pass' ? 'תקין' : 'נכשל') : (cube.status === 'tested_7d' ? 'נבדק 7 ימים' : 'בדרך')}
        </span>
        ${strengthDisplay}
      </div>
    `;

    item.addEventListener("click", () => {
      if (cube.status === "casted") {
        switchActiveView("dispatch-view");
        loadWaybillDetails(cube.id);
      } else if (cube.status === "transit" || cube.status === "tested_7d") {
        if (activeUserRole === "manager") {
          switchActiveView("lab-view");
          loadCubeToTestingChamber(cube.id);
        } else {
          alert("פעולה חסומה: רק מנהלי מעבדה יכולים לגשת לחדר הבדיקות והלחיצה.");
        }
      } else if (cube.status === "completed") {
        if (activeUserRole === "manager") {
          openCertificateModal(cube.id);
        } else {
          alert("פעולה חסומה: רק מנהלים מוסמכים יכולים לפתוח תעודות בדיקה.");
        }
      }
    });

    container.appendChild(item);
  });
}

// --- Casting Form View: Pending dispatch side list ---
function renderCastingSideList() {
  const container = document.getElementById("side-pending-dispatch");
  if (!container) return;
  container.innerHTML = "";

  const casted = cubes.filter(c => c.status === "casted");
  if (casted.length === 0) {
    container.innerHTML = `<p style="font-size: 11px; color: var(--text-muted); text-align: center;">אין נטילות הממתינות לשילוח.</p>`;
    return;
  }

  casted.slice(0, 3).forEach(c => {
    const card = document.createElement("div");
    card.style = `background-color: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;`;
    card.innerHTML = `
      <div style="text-align: right;">
        <div style="font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--text-primary);">מדבקה #${c.id}</div>
        <div style="font-size: 10px; color: var(--text-secondary);">${c.element} • סוג בטון ${c.concreteType}</div>
      </div>
      <i class="fa-solid fa-angle-left" style="color: var(--text-muted);"></i>
    `;
    card.onclick = () => {
      switchActiveView("dispatch-view");
      loadWaybillDetails(c.id);
    };
    container.appendChild(card);
  });
}

// --- Concrete Cast Form Submission ---
async function handleCastSubmission(e) {
  e.preventDefault();

  if (isSignatureCanvasEmpty(1)) {
    alert("⚠️ שגיאה: נדרשת חתימת דוגם מוסמך על מנת לאשר את פרוטוקול נטילת המדגם.");
    return;
  }

  // Safe fallback utility: if a required field is left empty, the code falls back to the placeholder value.
  const getFormValue = (id) => {
    const el = document.getElementById(id);
    if (!el) return "";
    return el.value.trim() !== "" ? el.value.trim() : (el.placeholder || "");
  };

  const stickerNo = document.getElementById("sticker-number").value;
  const projectNo = getFormValue("project-no");
  const orderNo = getFormValue("order-no");
  const castingDate = document.getElementById("casting-date").value;
  const clientName = getFormValue("client-name");
  
  // Optional fields: read raw values directly without placeholder fallbacks
  const contractor = document.getElementById("contractor").value.trim();
  const inspector = document.getElementById("inspector").value.trim();
  
  const siteAddress = getFormValue("site-address");
  const buildingDesc = getFormValue("building-desc");

  const element = document.getElementById("selected-element").value;
  const supplier = getFormValue("supplier");
  const isCertified = document.getElementById("is-certified").value;
  const concreteType = document.getElementById("concrete-type").value;
  const cementType = getFormValue("cement-type");
  const aggregateSize = document.getElementById("aggregate-size").value;
  
  const characCheckboxes = document.querySelectorAll('input[name="charac"]:checked');
  const characterization = Array.from(characCheckboxes).map(cb => cb.value);

  const sampledFrom = document.getElementById("selected-sampled-from").value;
  const deliveryNote = getFormValue("delivery-note");
  const mixerNo = getFormValue("mixer-no");
  const batchNo = getFormValue("batch-no");
  const samplerName = getFormValue("sampler-name");
  const timeStart = document.getElementById("time-start").value;
  const timeEnd = document.getElementById("time-end").value;
  const remarks = document.getElementById("remarks").value;

  // Read volume from number input field with standard fallback
  const volEl = document.getElementById("volume-input");
  const volumeVal = volEl && volEl.value !== "" ? parseFloat(volEl.value) : parseFloat(volEl.placeholder || "8");

  const area = activeDimension === 150 ? 22500 : 10000;

  const newCube = {
    id: stickerNo, 
    projectNo,
    orderNo,
    clientName,
    contractor,
    inspector,
    siteAddress,
    buildingDesc,
    element,
    volume: volumeVal,
    supplier,
    isCertified,
    concreteType,
    cementType,
    aggregateSize,
    exposureClass: values.exposure,
    characterization,
    sampledFrom,
    slump: values.slump,
    deliveryNote,
    mixerNo,
    batchNo,
    samplerName,
    timeStart,
    timeEnd,
    samplesCount: values.samples,
    dimension: activeDimension,
    area,
    status: "casted",
    castDate: castingDate,
    remarks,
    signature1: canvases[1].toDataURL(),
    signature2: isSignatureCanvasEmpty(2) ? "" : canvases[2].toDataURL()
  };

  if (supabaseClient) {
    triggerSyncPulseAnimation("שומר נטילה בענן...");
    try {
      const { error } = await supabaseClient.from("concrete_samples").insert({
        id: newCube.id,
        project_no: newCube.projectNo,
        order_no: newCube.orderNo,
        client_name: newCube.clientName,
        contractor: newCube.contractor,
        inspector: newCube.inspector,
        site_address: newCube.siteAddress,
        building_desc: newCube.buildingDesc,
        element: newCube.element,
        volume: newCube.volume,
        supplier: newCube.supplier,
        is_certified: newCube.isCertified,
        concrete_type: newCube.concreteType,
        cement_type: newCube.cementType,
        aggregate_size: newCube.aggregateSize,
        exposure_class: newCube.exposureClass,
        characterization: newCube.characterization,
        sampled_from: newCube.sampledFrom,
        slump: newCube.slump,
        delivery_note: newCube.deliveryNote,
        mixer_no: newCube.mixerNo,
        batch_no: newCube.batchNo,
        sampler_name: newCube.samplerName,
        time_start: newCube.timeStart,
        time_end: newCube.timeEnd,
        samples_count: newCube.samplesCount,
        dimension: newCube.dimension,
        area: newCube.area,
        status: newCube.status,
        cast_date: newCube.castDate,
        remarks: newCube.remarks,
        signature1: newCube.signature1,
        signature2: newCube.signature2,
        created_by: activeUser.id
      });
      if (error) throw error;
      
      await syncAllDataFromSupabase();
    } catch (err) {
      alert("שגיאה בשמירה בענן: " + err.message);
      return;
    }
  } else {
    cubes.unshift(newCube);
    saveState();
    triggerSyncPulseAnimation("מסנכרן נטילה מול ענן...");
  }

  setTimeout(() => {
    switchActiveView("dispatch-view");
    loadWaybillDetails(stickerNo);
  }, 1200);
}

function triggerSyncPulseAnimation(message) {
  const syncBadge = document.getElementById("sync-status");
  const syncText = document.getElementById("sync-text");
  
  if (syncBadge && syncText) {
    syncBadge.classList.add("syncing");
    syncText.textContent = message;
    
    setTimeout(() => {
      syncBadge.classList.remove("syncing");
      syncText.textContent = "מחובר לענן מעבדה";
    }, 2000);
  }
}

// --- Dispatch Ledger Table Rendering ---
function renderLedgerTable() {
  const tbody = document.getElementById("ledger-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const ledgerCubes = cubes.filter(c => c.status === "casted" || c.status === "transit");
  const ledgerCount = document.getElementById("ledger-count-display");
  if (ledgerCount) ledgerCount.textContent = `נמצאו ${ledgerCubes.length} נטילות פעילות בפנקס`;

  if (ledgerCubes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">פנקס נטילות ריק. כל המדגמים שולחו או עובדו במעבדה.</td></tr>`;
    return;
  }

  ledgerCubes.forEach(cube => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td class="bold" style="font-family: var(--font-mono); text-align: right;">מדבקה #${cube.id}</td>
      <td class="bold">${cube.clientName || '---'}</td>
      <td>${cube.samplerName || '---'}</td>
      <td>${cube.concreteType}</td>
      <td>סומך ${cube.slump}</td>
      <td>${cube.castDate}</td>
      <td><span class="status-chip status-${cube.status}">${cube.status === 'transit' ? 'בדרך למעבדה' : 'בשטח האתר'}</span></td>
      <td style="text-align: left;">
        <button class="action-icon-btn"><i class="fa-solid fa-file-invoice"></i></button>
      </td>
    `;
    tr.onclick = () => loadWaybillDetails(cube.id);
    tbody.appendChild(tr);
  });
}

// --- Loading Waybill Manifest ---
function loadWaybillDetails(id) {
  const cube = cubes.find(c => c.id === id);
  if (!cube) return;

  activeWaybillCube = cube;
  
  document.getElementById("manifest-empty-view").style.display = "none";
  document.getElementById("manifest-filled-view").style.display = "block";
  
  document.getElementById("waybill-project").textContent = cube.clientName;
  document.getElementById("waybill-id").textContent = `מדבקה #${cube.id}`;
  document.getElementById("waybill-mix").textContent = cube.concreteType;
  document.getElementById("waybill-slump").textContent = cube.slump;
  document.getElementById("waybill-location").textContent = `${cube.element} - ${cube.buildingDesc}`;
  document.getElementById("waybill-cast-date").textContent = cube.castDate;
  document.getElementById("waybill-exposure").textContent = cube.exposureClass;
  document.getElementById("waybill-dims").textContent = `${cube.dimension}x${cube.dimension}x${cube.dimension} מ"מ`;
  document.getElementById("waybill-sampler-name").textContent = cube.samplerName;
  
  const sigImg = document.getElementById("waybill-sig-image");
  if (sigImg && cube.signature1) {
    sigImg.src = cube.signature1;
    sigImg.style.display = "block";
  }

  drawProceduralQRCode(cube.id, "manifest-qr-canvas");

  const dispatchBtn = document.getElementById("btn-dispatch-waybill");
  if (dispatchBtn) {
    if (cube.status === "transit") {
      dispatchBtn.disabled = true;
      dispatchBtn.innerHTML = `<i class="fa-solid fa-truck-moving"></i> המדגם נשלח ונמצא בדרך למעבדה`;
      dispatchBtn.style.backgroundColor = "var(--bg-input)";
      dispatchBtn.style.color = "var(--text-secondary)";
    } else {
      dispatchBtn.disabled = false;
      dispatchBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> שלח למעבדה באופן דיגיטלי`;
      dispatchBtn.style.backgroundColor = "var(--safety-orange)";
      dispatchBtn.style.color = "#000";
    }
  }
}

function drawProceduralQRCode(text, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  ctx.clearRect(0,0, size, size);

  ctx.fillStyle = "#FFF";
  ctx.fillRect(0,0, size, size);

  ctx.fillStyle = "#000";
  
  ctx.fillRect(0, 0, 18, 18);
  ctx.fillStyle = "#FFF"; ctx.fillRect(3, 3, 12, 12);
  ctx.fillStyle = "#000"; ctx.fillRect(6, 6, 6, 6);

  ctx.fillRect(size - 18, 0, 18, 18);
  ctx.fillStyle = "#FFF"; ctx.fillRect(size - 15, 3, 12, 12);
  ctx.fillStyle = "#000"; ctx.fillRect(size - 12, 6, 6, 6);

  ctx.fillRect(0, size - 18, 18, 18);
  ctx.fillStyle = "#FFF"; ctx.fillRect(3, size - 15, 12, 12);
  ctx.fillStyle = "#000"; ctx.fillRect(6, size - 12, 6, 6);

  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }

  const squareSize = 3;
  const gridCells = Math.floor(size / squareSize);
  
  ctx.fillStyle = "#000";
  for (let x = 0; x < gridCells; x++) {
    for (let y = 0; y < gridCells; y++) {
      if (x < 7 && y < 7) continue;
      if (x >= gridCells - 7 && y < 7) continue;
      if (x < 7 && y >= gridCells - 7) continue;

      const randValue = Math.sin(hash + (x * 45.3) + (y * 91.8)) * 10000;
      if ((randValue - Math.floor(randValue)) > 0.5) {
        ctx.fillRect(x * squareSize, y * squareSize, squareSize, squareSize);
      }
    }
  }
}

async function dispatchActiveCube() {
  if (!activeWaybillCube) return;

  activeWaybillCube.status = "transit";

  if (supabaseClient) {
    triggerSyncPulseAnimation("מעדכן סטטוס שילוח...");
    try {
      const { error } = await supabaseClient
        .from("concrete_samples")
        .update({ status: "transit" })
        .eq("id", activeWaybillCube.id);
      
      if (error) throw error;
      
      await syncAllDataFromSupabase();
    } catch (err) {
      alert("שגיאה בעדכון השילוח: " + err.message);
      return;
    }
  } else {
    saveState();
    triggerSyncPulseAnimation("מעדכן סטטוס שילוח...");
  }

  setTimeout(() => {
    renderLedgerTable();
    loadWaybillDetails(activeWaybillCube.id);
    updateHeaderStats();
  }, 1200);
}

function printWaybill() {
  if (!activeWaybillCube) return;
  
  const printContent = document.getElementById("print-manifest-area").outerHTML;
  const win = window.open("", "_blank");
  win.document.write(`
    <html>
      <head>
        <title>מדבקת נטילה - ${activeWaybillCube.id}</title>
        <style>
          body { font-family: sans-serif; padding: 40px; display: flex; justify-content: center; direction: rtl; }
          .manifest-sheet { border: 2px solid #000; padding: 24px; max-width: 400px; width: 100%; border-radius: 8px; position: relative; }
          .manifest-logo { font-weight: bold; border-bottom: 2px solid #000; display: inline-block; margin-bottom: 12px; font-size: 14px; }
          .manifest-header { display: flex; justify-content: space-between; }
          .manifest-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; border-top: 1px dashed #CCC; padding-top: 12px; }
          .manifest-label { font-size: 10px; color: #666; text-transform: uppercase; }
          .manifest-val { font-weight: bold; font-size: 14px; }
          .manifest-sig-box { margin-top: 24px; border-top: 1px solid #CCC; padding-top: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
          .manifest-sig-img { max-height: 40px; }
        </style>
      </head>
      <body>
        ${printContent}
        <script>
          const srcCanvas = window.opener.document.getElementById("manifest-qr-canvas");
          const destCanvas = document.getElementById("manifest-qr-canvas");
          destCanvas.getContext("2d").drawImage(srcCanvas, 0,0);
          window.print();
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

// --- Lab Reception Queue Rendering ---
function renderLabQueue() {
  const container = document.getElementById("lab-queue-list");
  if (!container) return;
  container.innerHTML = "";

  const transCubes = cubes.filter(c => c.status === "transit" || c.status === "tested_7d");

  if (transCubes.length === 0) {
    container.innerHTML = `
      <div class="manifest-empty" style="height: 250px;">
        <i class="fa-solid fa-clipboard-check"></i>
        <p>אין קוביות הממתינות לקבלה בתור המעבדה.</p>
        <span style="font-size: 11px;">עבור לכרטיסיית "טופס נטילה" על מנת ליצור מדגמים ולשלח אותם באופן דיגיטלי.</span>
      </div>
    `;
    return;
  }

  transCubes.forEach(cube => {
    const activeClass = (activeTestingCube && activeTestingCube.id === cube.id) ? "active-queue-item" : "";
    const card = document.createElement("div");
    card.className = `queue-item ${activeClass}`;
    
    let stageText = "הגיע (ממתין ל-7ימים)";
    if (cube.status === "tested_7d") {
      stageText = "נבדק 7ימים (ממתין ל-28ימים)";
    }

    card.innerHTML = `
      <div class="queue-item-meta" style="text-align: right;">
        <span class="queue-item-id">מדבקה #${cube.id}</span>
        <span class="queue-item-desc">${cube.clientName} • בטון ${cube.concreteType}</span>
      </div>
      <div>
        <span class="status-chip status-${cube.status}">${stageText}</span>
      </div>
    `;
    card.onclick = () => loadCubeToTestingChamber(cube.id);
    container.appendChild(card);
  });
}

function filterLabQueue(query) {
  const items = document.querySelectorAll("#lab-queue-list .queue-item");
  items.forEach(item => {
    const txt = item.querySelector(".queue-item-id").textContent.toLowerCase();
    if (txt.includes(query.toLowerCase())) {
      item.style.display = "flex";
    } else {
      item.style.display = "none";
    }
  });
}

// --- Lab Receive & Setup Staged Testing Chamber ---
function loadCubeToTestingChamber(id) {
  const cube = cubes.find(c => c.id === id);
  if (!cube) return;

  activeTestingCube = cube;
  renderLabQueue();

  document.getElementById("telem-specimen-id").textContent = `מדבקה #${cube.id}`;
  document.getElementById("telem-mix-grade").textContent = cube.concreteType;
  
  document.getElementById("manual-crush-inputs").style.display = "block";

  const input7d = document.getElementById("lab-load-7d");
  const input28d = document.getElementById("lab-load-28d");
  const calc7d = document.getElementById("strength-7d-calc");
  const calc28d = document.getElementById("strength-28d-calc");

  if (cube.status === "transit") {
    input7d.disabled = false;
    input7d.value = "";
    calc7d.innerText = "חוזק: 0.00 MPa";

    input28d.disabled = true;
    input28d.value = "";
    calc28d.innerText = "נעול - ממתין להשלמת בדיקת 7 ימים";

    document.getElementById("simulator-status-panel").innerHTML = `
      <p style="font-size: 12px; color: var(--safety-orange); text-align: center; margin: 0;">
        <i class="fa-solid fa-clock"></i> שלב א' (גיל 7 ימים): הזן את עומס השבר ב-kN לשמירת אינדיקציה ראשונית.
      </p>
    `;
  } else if (cube.status === "tested_7d") {
    input7d.disabled = true;
    input7d.value = cube.failureLoad7d;
    calc7d.innerText = `חוזק 7 ימים סופי: ${cube.strength7d.toFixed(2)} MPa`;

    input28d.disabled = false;
    input28d.value = "";
    calc28d.innerText = "חוזק: 0.00 MPa";

    document.getElementById("simulator-status-panel").innerHTML = `
      <p style="font-size: 12px; color: var(--success); text-align: center; margin: 0;">
        <i class="fa-solid fa-circle-check"></i> שלב ב' (גיל 28 יום): הזן את עומס השבר הסופי לאישור התאמה לתקן והפקת תעודה.
      </p>
    `;
  }
}

function resetCrusherState() {
  activeTestingCube = null;
  document.getElementById("telem-specimen-id").textContent = "טרם נבחרה קובייה";
  document.getElementById("telem-mix-grade").textContent = "N/A";
  document.getElementById("manual-crush-inputs").style.display = "none";

  document.getElementById("simulator-status-panel").innerHTML = `
    <p style="font-size: 12px; color: var(--text-secondary); text-align: center; margin: 0;">
      <i class="fa-solid fa-circle-question"></i> בחר מדגם פעיל מהתור משמאל על מנת לפתוח את שדות הזנת הנתונים.
    </p>
  `;
}

function calculateOnTheFlyStrength(age) {
  if (!activeTestingCube) return;
  const loadInput = document.getElementById(`lab-load-${age}`).value;
  const outputSpan = document.getElementById(`strength-${age}-calc`);
  
  if (!loadInput) {
    outputSpan.innerText = "חוזק: 0.00 MPa";
    return;
  }

  const load = parseFloat(loadInput);
  const area = activeTestingCube.area;
  const strength = (load * 1000) / area;
  outputSpan.innerText = `חוזק מחושב: ${strength.toFixed(2)} MPa`;
}

// --- Staged Manual Result Submission ---
async function saveManualCrushResults() {
  if (!activeTestingCube) return;

  const area = activeTestingCube.area;
  const mix = activeTestingCube.concreteType;
  const specLimit = CONCRETE_CLASS_LIMITS[mix] || 30;

  if (activeTestingCube.status === "transit") {
    const load7dRaw = document.getElementById("lab-load-7d").value;
    if (!load7dRaw) {
      alert("⚠️ שגיאה: יש להזין עומס שבר (kN) בגיל 7 ימים.");
      return;
    }

    const load7d = parseFloat(load7dRaw);
    const strength7d = (load7d * 1000) / area;

    activeTestingCube.status = "tested_7d";
    activeTestingCube.failureLoad7d = load7d;
    activeTestingCube.strength7d = parseFloat(strength7d.toFixed(2));
    
    if (supabaseClient) {
      triggerSyncPulseAnimation("שומר תוצאות 7 ימים...");
      try {
        const { error } = await supabaseClient
          .from("concrete_samples")
          .update({
            status: "tested_7d",
            failure_load_7d: load7d,
            strength_7d: activeTestingCube.strength7d
          })
          .eq("id", activeTestingCube.id);
        
        if (error) throw error;
        await syncAllDataFromSupabase();
      } catch (err) {
        alert("שגיאה בשמירה: " + err.message);
        return;
      }
    } else {
      const idx = cubes.findIndex(c => c.id === activeTestingCube.id);
      if (idx !== -1) {
        cubes[idx] = { ...activeTestingCube };
      }
      saveState();
      triggerSyncPulseAnimation("שומר תוצאות 7 ימים...");
    }

    setTimeout(() => {
      resetCrusherState();
      renderLabQueue();
      renderDashboardCubes();
      updateHeaderStats();
    }, 1200);

  } else if (activeTestingCube.status === "tested_7d") {
    const load28dRaw = document.getElementById("lab-load-28d").value;
    if (!load28dRaw) {
      alert("⚠️ שגיאה: יש להזין עומס שבר (kN) בגיל 28 יום.");
      return;
    }

    const load28d = parseFloat(load28dRaw);
    const strength28d = (load28d * 1000) / area;

    const passes = strength28d >= specLimit;
    const conformity = passes ? "pass" : "fail";

    const certRand = Math.floor(10000 + Math.random() * 90000);
    const certSerial = `CERT-2026-${certRand}`;

    activeTestingCube.status = "completed";
    activeTestingCube.failureLoad28d = load28d;
    activeTestingCube.strength28d = parseFloat(strength28d.toFixed(2));
    activeTestingCube.conformity = conformity;
    activeTestingCube.certSerial = certSerial;
    activeTestingCube.testDate = new Date().toISOString().split('T')[0];

    if (supabaseClient) {
      triggerSyncPulseAnimation("מפיק תעודת בדיקה...");
      try {
        const { error } = await supabaseClient
          .from("concrete_samples")
          .update({
            status: "completed",
            failure_load_28d: load28d,
            strength_28d: activeTestingCube.strength28d,
            conformity: conformity,
            cert_serial: certSerial,
            test_date: activeTestingCube.testDate
          })
          .eq("id", activeTestingCube.id);
        
        if (error) throw error;
        await syncAllDataFromSupabase();
      } catch (err) {
        alert("שגיאה בהפקת תעודה: " + err.message);
        return;
      }
    } else {
      const idx = cubes.findIndex(c => c.id === activeTestingCube.id);
      if (idx !== -1) {
        cubes[idx] = { ...activeTestingCube };
      }
      saveState();
      triggerSyncPulseAnimation("מפיק תעודת בדיקה...");
      renderAnalyticsDashboard(); 
    }

    document.getElementById("simulator-status-panel").innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; direction: rtl;">
        <p style="font-size: 12px; color: var(--success); margin: 0;">
          <i class="fa-solid fa-certificate"></i> הבדיקות הושלמו ותעודת בדיקה הופקה בהצלחה!
        </p>
        <button class="btn btn-primary" style="width: auto; padding: 6px 14px; font-size: 11px; background-color: var(--success);" onclick="switchActiveView('reports-view')">לחץ כאן למעבר למאגר התעודות</button>
      </div>
    `;

    setTimeout(() => {
      renderLabQueue();
      renderDashboardCubes();
      updateHeaderStats();
    }, 1000);
  }
}

// --- Project Analytics & Completed ledger rendering ---
function renderAnalyticsDashboard() {
  const container = document.getElementById("svg-chart-container");
  if (!container) return;

  const completed = cubes.filter(c => c.status === "completed").reverse();
  
  if (completed.length === 0) {
    container.innerHTML = `<div class="manifest-empty" style="height: 200px; width: 100%;"><p>אין תעודות בדיקה חתומות במערכת. בצע בדיקות לחיצה לקבלת סטטיסטיקה.</p></div>`;
    return;
  }

  container.innerHTML = "";

  const strengths = completed.map(c => c.strength28d || 0);
  const maxStrength = Math.max(...strengths, 65);
  
  completed.forEach(c => {
    const colWidth = 100 / completed.length;
    const str28 = c.strength28d ? c.strength28d : 0;
    const percentHeight = (str28 / maxStrength) * 80;
    
    const barBox = document.createElement("div");
    barBox.className = "chart-bar-container";
    barBox.style.width = `${colWidth}%`;
    
    let barColor = "var(--safety-orange)";
    if (c.conformity === "fail") {
      barColor = "var(--danger)";
    }

    barBox.innerHTML = `
      <div class="chart-bar" style="height: ${percentHeight}%; background: ${barColor};">
        <div class="chart-bar-tooltip" style="direction: rtl;">
          מדבקה #${c.id}<br>${str28.toFixed(2)} MPa (${c.concreteType})
        </div>
      </div>
      <div class="chart-axis-label" style="font-size: 10px;">#${c.id}</div>
    `;

    barBox.onclick = () => openCertificateModal(c.id);
    container.appendChild(barBox);
  });

  renderMixConformityList();
  renderCompletedLedger();
}

function renderMixConformityList() {
  const container = document.getElementById("compliance-progress-list");
  if (!container) return;
  container.innerHTML = "";

  const completed = cubes.filter(c => c.status === "completed");
  
  const grades = {};
  completed.forEach(c => {
    if (!grades[c.concreteType]) {
      grades[c.concreteType] = { total: 0, passed: 0 };
    }
    grades[c.concreteType].total++;
    if (c.conformity === "pass") {
      grades[c.concreteType].passed++;
    }
  });

  const mixes = Object.keys(CONCRETE_CLASS_LIMITS);
  
  mixes.forEach(mix => {
    const data = grades[mix] || { total: 0, passed: 0 };
    const compliance = data.total > 0 ? (data.passed / data.total) * 100 : 100;
    const barColor = compliance < 90 ? "var(--danger)" : (compliance === 100 ? "var(--success)" : "var(--safety-yellow)");

    const item = document.createElement("div");
    item.className = "mix-compliance-item";
    item.innerHTML = `
      <div class="mix-meta-row" style="direction: rtl;">
        <span>תקן עבור סוג ${mix}</span>
        <span class="text-safety">${data.passed}/${data.total} תקינים</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${compliance}%; background: ${barColor};"></div>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderCompletedLedger() {
  const tbody = document.getElementById("completed-ledger-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const completed = cubes.filter(c => c.status === "completed");

  if (completed.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 32px;">אין תעודות חתומות במאגר עדיין.</td></tr>`;
    return;
  }

  completed.forEach(c => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    
    const load7d = c.failureLoad7d ? c.failureLoad7d.toFixed(1) : '---';
    const load28d = c.failureLoad28d ? c.failureLoad28d.toFixed(1) : '---';
    const strength28d = c.strength28d ? c.strength28d.toFixed(2) : '---';

    tr.innerHTML = `
      <td class="bold" style="font-family: var(--font-mono); text-align: right;">${c.certSerial || '---'}</td>
      <td style="font-family: var(--font-mono);">${c.id}</td>
      <td class="bold">${c.clientName || '---'}</td>
      <td>${c.element || '---'}</td>
      <td>${c.concreteType || '---'}</td>
      <td>סומך ${c.slump}</td>
      <td>${load7d}</td>
      <td>${load28d}</td>
      <td class="bold">${strength28d}</td>
      <td><span class="status-chip status-${c.conformity === 'pass' ? 'completed' : 'casted'}">${c.conformity === 'pass' ? 'מתאים' : 'נכשל'}</span></td>
      <td style="text-align: left;">
        <button class="action-icon-btn" onclick="openCertificateModal('${c.id}'); event.stopPropagation();"><i class="fa-solid fa-certificate"></i></button>
      </td>
    `;
    tr.onclick = () => openCertificateModal(c.id);
    tbody.appendChild(tr);
  });
}

// --- Client Filter Search for Final Report Ledger ---
function filterCertificatesByClient(query) {
  const tbody = document.getElementById("completed-ledger-body");
  if (!tbody) return;

  const rows = tbody.getElementsByTagName("tr");
  Array.from(rows).forEach(row => {
    const certSerial = row.getElementsByTagName("td")[0].textContent.toLowerCase();
    const stickerId = row.getElementsByTagName("td")[1].textContent.toLowerCase();
    const clientName = row.getElementsByTagName("td")[2].textContent.toLowerCase();
    
    const searchTarget = query.toLowerCase();

    if (
      clientName.includes(searchTarget) || 
      stickerId.includes(searchTarget) || 
      certSerial.includes(searchTarget)
    ) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  });
}

// --- Compressive Strength Test Certificate Modal popup ---
function openCertificateModal(id) {
  const cube = cubes.find(c => c.id === id);
  if (!cube) return;

  const modal = document.getElementById("cert-modal");
  if (!modal) return;

  modal.classList.add("active-modal");

  document.getElementById("cert-serial").textContent = cube.certSerial || '---';
  document.getElementById("cert-specimen-id").textContent = cube.id;
  document.getElementById("cert-cast-date").textContent = cube.castDate || '---';
  document.getElementById("cert-test-date").textContent = cube.testDate || cube.castDate;
  document.getElementById("cert-location").textContent = `${cube.element || '---'} - ${cube.buildingDesc || '---'}`;
  document.getElementById("cert-project").textContent = `פרויקט מס׳ ${cube.projectNo || '---'}`;
  document.getElementById("cert-grade").textContent = cube.concreteType || '---';
  document.getElementById("cert-slump").textContent = cube.slump;
  document.getElementById("cert-dims").textContent = `${cube.dimension}x${cube.dimension}x${cube.dimension} מ"מ`;
  document.getElementById("cert-cement").textContent = cube.cementType || '---';
  
  const load7 = cube.failureLoad7d ? cube.failureLoad7d.toFixed(1) + " kN" : '---';
  const str7 = cube.strength7d ? cube.strength7d.toFixed(2) + " MPa" : '---';
  const load28 = cube.failureLoad28d ? cube.failureLoad28d.toFixed(1) + " kN" : '---';
  const str28 = cube.strength28d ? cube.strength28d.toFixed(2) + " MPa" : '---';

  document.getElementById("cert-load-7d").textContent = load7;
  document.getElementById("cert-strength-7d").textContent = str7;
  document.getElementById("cert-load-28d").textContent = load28;
  
  const mpaDisplay28d = document.getElementById("cert-strength-28d");
  mpaDisplay28d.textContent = str28;

  const watermark = document.getElementById("cert-watermark");
  const conformityText = document.getElementById("cert-conformity-text");

  if (cube.conformity === "pass") {
    watermark.textContent = "מתאים לתקן";
    watermark.className = "cert-status-watermark";
    conformityText.textContent = "מתאים לתקן";
    conformityText.style.color = "var(--success)";
    mpaDisplay28d.style.color = "var(--success)";
  } else {
    watermark.textContent = "כשל התאמה";
    watermark.className = "cert-status-watermark cert-failed";
    conformityText.textContent = "כשל התאמה";
    conformityText.style.color = "var(--danger)";
    mpaDisplay28d.style.color = "var(--danger)";
  }

  const sigImg = document.getElementById("cert-sig-image");
  if (sigImg && cube.signature1) {
    sigImg.src = cube.signature1;
  }
}

function closeCertificateModal() {
  const modal = document.getElementById("cert-modal");
  if (modal) {
    modal.classList.remove("active-modal");
  }
}

// --- CSV Export Tool for Excel ---
function exportReportsCSV() {
  const completed = cubes.filter(c => c.status === "completed");
  if (completed.length === 0) {
    alert("אין מדגמים מאושרים לייצוא.");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Certificate ID,Specimen ID,Project Agreement Number,Order Number,Client Name,Contractor,Inspector,Site Address,Building Description,Element,Casting Volume (m3),Concrete Supplier,Is Certified,Concrete Grade,Cement Type,Aggregate Size,Exposure Class,Slump,Delivery Note,Mixer Number,Batch Number,Sampler Name,Start Time,End Time,Samples Count,Dimension (mm),Ultimate Load 7d (kN),Strength 7d (MPa),Ultimate Load 28d (kN),Compressive Strength 28d (MPa),Conformity\n";

  completed.forEach(c => {
    const row = [
      c.certSerial,
      c.id,
      `"${c.projectNo}"`,
      `"${c.orderNo}"`,
      `"${c.clientName}"`,
      `"${c.contractor}"`,
      `"${c.inspector}"`,
      `"${c.siteAddress}"`,
      `"${c.buildingDesc}"`,
      `"${c.element}"`,
      c.volume,
      c.supplier,
      c.isCertified,
      c.concreteType,
      c.cementType,
      `"${c.aggregateSize}"`,
      c.exposureClass,
      c.slump,
      c.deliveryNote,
      `"${c.mixerNo}"`,
      c.batchNo,
      `"${c.samplerName}"`,
      c.timeStart,
      c.timeEnd,
      c.samplesCount,
      c.dimension,
      c.failureLoad7d,
      c.strength7d,
      c.failureLoad28d,
      c.strength28d,
      c.conformity
    ].join(",");
    csvContent += row + "\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `דוח_מעבדה_בטון_סיסטם_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function saveState() {
  localStorage.setItem("concretus_is_cubes", JSON.stringify(cubes));
}