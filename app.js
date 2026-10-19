"use strict";

const dashboard = document.querySelector("#dashboard");
const startButton = document.querySelector("#start-button");
const settingsButton = document.querySelector("#settings-button");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsClose = document.querySelector("#settings-close");
const styleSelect = document.querySelector("#style-select");
const speedScaleInput = document.querySelector("#speed-scale-input");
const speedUnitInputs = [...document.querySelectorAll('input[name="speed-unit"]')];
const speedScaleUnit = document.querySelector("#speed-scale-unit");
const gpsStatus = document.querySelector("#gps-status");
const speedValue = document.querySelector("#speed-value");
const dialSpeed = document.querySelector("#dial-speed");
const needle = document.querySelector("#needle");
const dialTicks = document.querySelector("#dial-ticks");
const dialLabels = document.querySelector("#dial-labels");
const dialInnerTicks = document.querySelector("#dial-inner-ticks");
const storageKey = "motoheat-dash-settings";
const kmhToMph = 0.6213711922;
const mphToKmh = 1 / kmhToMph;
const supportedStyle = (style) =>
  style && typeof style.id === "string" && typeof style.name === "string" &&
  typeof style.description === "string" && ["digital", "analog"].includes(style.display) &&
  ["system", "serif", "mono", "condensed"].includes(style.font) &&
  ["light", "dark"].includes(style.scheme) &&
  typeof style.needlePath === "string" && /^[MmLlZz0-9.\s-]+$/.test(style.needlePath) &&
  Number.isInteger(style.ticksPerMajor) && style.ticksPerMajor >= 1 && style.ticksPerMajor <= 10 &&
  (style.labelStep === undefined ||
    (Number.isInteger(style.labelStep) && style.labelStep > 0)) &&
  (style.numberColor === undefined || /^#[\da-f]{6}$/i.test(style.numberColor)) &&
  (style.tickColor === undefined || /^#[\da-f]{6}$/i.test(style.tickColor)) &&
  (style.majorTickWidth === undefined || (Number.isFinite(style.majorTickWidth) &&
    style.majorTickWidth >= 1 && style.majorTickWidth <= 8)) &&
  (style.centerSpeed === undefined || typeof style.centerSpeed === "boolean") &&
  ["background", "surface", "foreground", "muted", "accent", "line"].every((key) =>
    typeof style[key] === "string" && /^#[\da-f]{6}$/i.test(style[key]));

let styles = [];
let currentStyleIndex = 0;
let speedUnit = "kmh";
let speedScale = 260;
let watchId = null;
let previousFix = null;
let latestSpeed = null;
let lastFixTime = 0;
let parallaxActive = false;
let parallaxRequest = 0;
let orientationBaseline = null;

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch (error) {
    console.warn("Could not read saved dashboard settings:", error);
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      styleId: styles[currentStyleIndex]?.id,
      speedUnit,
      speedScale,
    }));
  } catch (error) {
    console.warn("Could not save dashboard settings:", error);
  }
}

function applyStyle(style) {
  document.documentElement.dataset.style = style.id;
  document.documentElement.dataset.centerSpeed = String(Boolean(style.centerSpeed));
  document.documentElement.style.colorScheme = style.scheme;
  for (const [property, key] of [
    ["--bg", "background"],
    ["--surface", "surface"],
    ["--foreground", "foreground"],
    ["--muted", "muted"],
    ["--accent", "accent"],
    ["--line", "line"],
  ]) {
    document.documentElement.style.setProperty(property, style[key]);
  }
  document.documentElement.style.setProperty("--tick-color", style.tickColor || style.foreground);
  document.documentElement.style.setProperty("--major-tick-width", style.majorTickWidth || 2.7);
  document.documentElement.style.setProperty("--number-color", style.numberColor || style.foreground);
  document.documentElement.style.setProperty("--glow-color", style.accent);
  document.documentElement.style.setProperty("--font", {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    condensed: '"Arial Narrow", "Roboto Condensed", Impact, sans-serif',
  }[style.font]);
  needle.setAttribute("d", style.needlePath);
  document.querySelector("#digital-display").hidden = style.display !== "digital";
  document.querySelector("#analog-display").hidden = style.display !== "analog";
  document.querySelector('meta[name="theme-color"]').content = style.background;
}

function populateSettings(settings) {
  styleSelect.replaceChildren(...styles.map((style) => new Option(style.name, style.id)));
  const savedStyleId = settings.styleId;
  const savedIndex = styles.findIndex((style) => style.id === savedStyleId);
  currentStyleIndex = savedIndex < 0 ? 0 : savedIndex;
  if (savedStyleId && savedIndex < 0) console.warn(`Unknown saved dashboard style: ${savedStyleId}`);
  speedUnit = settings.speedUnit === "mph" ? "mph" : "kmh";
  const storedScale = Number(settings.speedScale);
  speedScale = speedScaleIsValid(storedScale, speedUnit)
    ? storedScale
    : speedUnit === "mph" ? 160 : 260;
  styleSelect.value = styles[currentStyleIndex].id;
  speedScaleInput.value = String(speedScale);
  speedScaleInput.min = String(scaleBounds(speedUnit).min);
  speedScaleInput.max = String(scaleBounds(speedUnit).max);
  for (const input of speedUnitInputs) input.checked = input.value === speedUnit;
  applyStyle(styles[currentStyleIndex]);
  updateSpeedUnitDisplay();
  buildDialTicks();
  renderSpeed();
}

function updateStyle() {
  const selectedIndex = styles.findIndex((style) => style.id === styleSelect.value);
  if (selectedIndex < 0) {
    console.error(`Unknown dashboard style: ${styleSelect.value}`);
    return;
  }
  currentStyleIndex = selectedIndex;
  applyStyle(styles[currentStyleIndex]);
  buildDialTicks();
  renderSpeed();
  saveSettings();
}

function updateSpeedScale() {
  const selectedScale = Number(speedScaleInput.value);
  if (!speedScaleIsValid(selectedScale, speedUnit)) {
    console.error(`Invalid speed scale: ${speedScaleInput.value}`);
    speedScaleInput.value = String(speedScale);
    return;
  }
  speedScale = selectedScale;
  buildDialTicks();
  renderSpeed();
  saveSettings();
}

function scaleBounds(unit) {
  return unit === "mph" ? { min: 60, max: 200 } : { min: 100, max: 320 };
}

function speedScaleIsValid(value, unit) {
  const bounds = scaleBounds(unit);
  return Number.isInteger(value) && value >= bounds.min && value <= bounds.max && value % 10 === 0;
}

function updateSpeedUnitDisplay() {
  const unitLabel = speedUnit === "mph" ? "mph" : "km/h";
  document.querySelectorAll(".speed-unit, .dial-unit").forEach((element) => {
    element.textContent = unitLabel;
  });
  speedScaleUnit.textContent = unitLabel;
  speedScaleInput.min = String(scaleBounds(speedUnit).min);
  speedScaleInput.max = String(scaleBounds(speedUnit).max);
}

function updateSpeedUnit() {
  const nextUnit = speedUnitInputs.find((input) => input.checked)?.value;
  if (nextUnit !== "kmh" && nextUnit !== "mph") {
    console.error(`Invalid speed unit: ${nextUnit}`);
    return;
  }
  if (nextUnit === speedUnit) return;

  const speedScaleKmh = speedUnit === "mph" ? speedScale * mphToKmh : speedScale;
  speedUnit = nextUnit;
  const convertedScale = speedUnit === "mph" ? speedScaleKmh * kmhToMph : speedScaleKmh;
  const bounds = scaleBounds(speedUnit);
  speedScale = Math.min(bounds.max, Math.max(bounds.min, Math.round(convertedScale / 10) * 10));
  speedScaleInput.value = String(speedScale);
  updateSpeedUnitDisplay();
  buildDialTicks();
  renderSpeed();
  saveSettings();
}

function sweepNeedle() {
  needle.classList.remove("is-sweeping");
  void needle.getBoundingClientRect();
  needle.classList.add("is-sweeping");
}

async function startParallax() {
  if (parallaxActive || matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("DeviceOrientationEvent" in window)) return;
  const request = ++parallaxRequest;
  const OrientationEvent = window.DeviceOrientationEvent;
  try {
    if (typeof OrientationEvent.requestPermission === "function") {
      const permission = await OrientationEvent.requestPermission();
      if (permission !== "granted") {
        console.warn("Device orientation permission was not granted");
        return;
      }
    }
    if (request !== parallaxRequest) return;
    orientationBaseline = null;
    window.addEventListener("deviceorientation", onDeviceOrientation, { passive: true });
    parallaxActive = true;
  } catch (error) {
    console.warn("Device orientation permission failed:", error);
  }
}

function stopParallax() {
  parallaxRequest += 1;
  window.removeEventListener("deviceorientation", onDeviceOrientation);
  parallaxActive = false;
  orientationBaseline = null;
  dashboard.style.setProperty("--parallax-x", "0px");
  dashboard.style.setProperty("--parallax-y", "0px");
  dashboard.style.setProperty("--reflection-x", "0px");
  dashboard.style.setProperty("--reflection-y", "0px");
}

function onDeviceOrientation(event) {
  if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
  if (!orientationBaseline) {
    orientationBaseline = { beta: event.beta, gamma: event.gamma };
    return;
  }

  const beta = event.beta - orientationBaseline.beta;
  const gamma = event.gamma - orientationBaseline.gamma;
  const screenAngle = ((screen.orientation?.angle || 0) % 360 + 360) % 360;
  let tiltX;
  let tiltY;
  if (screenAngle === 90) {
    tiltX = beta;
    tiltY = -gamma;
  } else if (screenAngle === 180) {
    tiltX = -gamma;
    tiltY = -beta;
  } else if (screenAngle === 270) {
    tiltX = -beta;
    tiltY = gamma;
  } else {
    tiltX = gamma;
    tiltY = beta;
  }

  const maxOffset = 5;
  const x = Math.max(-maxOffset, Math.min(maxOffset, tiltX / 18 * maxOffset));
  const y = Math.max(-maxOffset, Math.min(maxOffset, tiltY / 18 * maxOffset));
  dashboard.style.setProperty("--parallax-x", `${x.toFixed(2)}px`);
  dashboard.style.setProperty("--parallax-y", `${y.toFixed(2)}px`);
  dashboard.style.setProperty("--reflection-x", `${(x * -0.35).toFixed(2)}px`);
  dashboard.style.setProperty("--reflection-y", `${(y * -0.35).toFixed(2)}px`);
}

function setGpsState(state, message) {
  dashboard.dataset.gpsState = state;
  gpsStatus.textContent = message;
}

function renderSpeed() {
  const speed = latestSpeed === null
    ? null
    : latestSpeed * 3.6 * (speedUnit === "mph" ? kmhToMph : 1);
  const display = speed === null ? "---" : String(Math.round(speed));
  speedValue.textContent = display;
  dialSpeed.textContent = display;
  document.querySelector("#screen-reader-speed").textContent =
    speed === null ? "Waiting for GPS speed" :
      `Speed ${display} ${speedUnit === "mph" ? "miles per hour" : "kilometres per hour"}`;
  const fraction = Math.min((speed || 0) / speedScale, 1);
  needle.style.transform = `rotate(${-135 + fraction * 270}deg)`;
}

function updateStartButton() {
  const active = watchId !== null;
  startButton.classList.toggle("is-active", active);
  startButton.setAttribute("aria-label", active ? "Stop GPS" : "Start GPS");
}

function haversineMetres(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function onPosition(position) {
  const coords = position.coords;
  const receivedAt = Date.now();
  lastFixTime = receivedAt;
  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) ||
      !Number.isFinite(coords.accuracy) || coords.accuracy > 100) {
    setGpsState("searching", "Waiting for an accurate GPS fix");
    previousFix = null;
    latestSpeed = null;
    renderSpeed();
    return;
  }

  const fix = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    time: Number.isFinite(position.timestamp) ? position.timestamp : receivedAt,
  };
  let nextSpeed = null;
  if (Number.isFinite(coords.speed) && coords.speed >= 0) {
    nextSpeed = coords.speed;
  } else if (previousFix && fix.time > previousFix.time &&
      fix.time - previousFix.time <= 5000 && fix.accuracy <= 50 && previousFix.accuracy <= 50) {
    const elapsedSeconds = (fix.time - previousFix.time) / 1000;
    const calculatedSpeed = haversineMetres(previousFix, fix) / elapsedSeconds;
    if (Number.isFinite(calculatedSpeed) && calculatedSpeed <= 100) nextSpeed = calculatedSpeed;
  }

  previousFix = fix;
  latestSpeed = nextSpeed;
  renderSpeed();
  setGpsState("live", "GPS connected");
}

function onPositionError(error) {
  stopParallax();
  const messages = {
    1: "Location permission denied",
    2: "GPS signal unavailable",
    3: "GPS request timed out",
  };
  setGpsState("error", messages[error.code] || "GPS error");
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  latestSpeed = null;
  previousFix = null;
  renderSpeed();
  updateStartButton();
}

function stopGps() {
  stopParallax();
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  previousFix = null;
  latestSpeed = null;
  lastFixTime = 0;
  renderSpeed();
  setGpsState("ready", "GPS ready");
  updateStartButton();
}

function startGps() {
  if (!("geolocation" in navigator)) {
    stopParallax();
    setGpsState("error", "GPS is not available in this browser");
    return;
  }
  if (!window.isSecureContext) {
    stopParallax();
    setGpsState("error", "GPS requires a secure connection");
    return;
  }
  void startParallax();
  setGpsState("searching", "Searching for GPS");
  updateStartButton();
  try {
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    });
    updateStartButton();
  } catch (error) {
    console.error("Could not start GPS:", error);
    stopParallax();
    setGpsState("error", "Could not start GPS");
    updateStartButton();
  }
}

function addDialPath(group, x1, y1, x2, y2, className) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`);
  path.setAttribute("class", className);
  group.append(path);
}

function buildDialTicks() {
  const style = styles[currentStyleIndex];
  if (!style || style.display !== "analog") return;
  const labelStep = style.labelStep || 20;
  const marks = [];
  const labels = [];
  let previousValue = null;
  for (let intervalStart = 0; intervalStart < speedScale; intervalStart += labelStep) {
    const intervalEnd = Math.min(intervalStart + labelStep, speedScale);
    for (let subdivision = 0; subdivision <= style.ticksPerMajor; subdivision += 1) {
      if (previousValue !== null && subdivision === 0) continue;
      const value = intervalStart + (intervalEnd - intervalStart) * subdivision / style.ticksPerMajor;
      const isLabel = subdivision === 0 || subdivision === style.ticksPerMajor || value === speedScale;
      const major = subdivision === 0 || subdivision === style.ticksPerMajor || value === speedScale;
      const angle = (-135 + value * 270 / speedScale) * Math.PI / 180;
      const innerRadius = major ? 117 : 124;
      const outerRadius = 132;
      const innerX = 160 + Math.sin(angle) * innerRadius;
      const innerY = 160 - Math.cos(angle) * innerRadius;
      const outerX = 160 + Math.sin(angle) * outerRadius;
      const outerY = 160 - Math.cos(angle) * outerRadius;
      const mark = document.createElementNS("http://www.w3.org/2000/svg", "g");
      addDialPath(mark, innerX, innerY, outerX, outerY, major ? "dial-tick major" : "dial-tick");
      if (isLabel) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const labelRadius = 103;
        label.setAttribute("x", (160 + Math.sin(angle) * labelRadius).toFixed(1));
        label.setAttribute("y", (160 - Math.cos(angle) * labelRadius).toFixed(1));
        label.setAttribute("class", "dial-number");
        const displayedValue = speedUnit === "mph" ? Math.round(value) : value;
        label.textContent = String(displayedValue);
        labels.push(label);
      }
      marks.push(mark);
    }
    previousValue = intervalEnd;
  }
  dialTicks.replaceChildren(...marks);
  dialLabels.replaceChildren(...labels);

  const innerMarks = [];
  const innerDivisions = Math.max(12, Math.ceil(speedScale / labelStep) * style.ticksPerMajor);
  for (let index = 0; index < innerDivisions; index += 1) {
    const angle = index * 360 / innerDivisions * Math.PI / 180;
    const major = index % Math.max(1, Math.round(innerDivisions / 12)) === 0;
    const innerRadius = major ? 72 : 76;
    const outerRadius = 82;
    const innerX = 160 + Math.sin(angle) * innerRadius;
    const innerY = 160 - Math.cos(angle) * innerRadius;
    const outerX = 160 + Math.sin(angle) * outerRadius;
    const outerY = 160 - Math.cos(angle) * outerRadius;
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "g");
    addDialPath(mark, innerX, innerY, outerX, outerY, major ? "dial-inner-tick major" : "dial-inner-tick");
    innerMarks.push(mark);
  }
  dialInnerTicks.replaceChildren(...innerMarks);
}

async function initialize() {
  const styleResponse = await fetch("./styles.json", { cache: "no-cache" });
  if (!styleResponse.ok) throw new Error(`Could not load dashboard styles (${styleResponse.status})`);
  const configuration = await styleResponse.json();
  if (!configuration || !Array.isArray(configuration.styles) ||
      !configuration.styles.length || !configuration.styles.every(supportedStyle)) {
    throw new Error("Dashboard style configuration is invalid");
  }
  styles = configuration.styles;
  populateSettings(readSettings());
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Could not register offline support:", error);
    });
  }
}

settingsButton.addEventListener("click", () => settingsDialog.showModal());
settingsClose.addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
styleSelect.addEventListener("change", updateStyle);
speedUnitInputs.forEach((input) => input.addEventListener("change", updateSpeedUnit));
speedScaleInput.addEventListener("change", updateSpeedScale);
startButton.addEventListener("click", () => {
  if (watchId !== null) stopGps();
  else {
    sweepNeedle();
    startGps();
  }
});

needle.addEventListener("animationend", (event) => {
  if (event.animationName !== "needle-sweep") return;
  needle.classList.remove("is-sweeping");
  renderSpeed();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || watchId === null) return;
  if (lastFixTime && Date.now() - lastFixTime > 5000) {
    latestSpeed = null;
    renderSpeed();
    setGpsState("searching", "Waiting for GPS");
  }
});

window.setInterval(() => {
  if (watchId === null || !lastFixTime || Date.now() - lastFixTime <= 5000) return;
  latestSpeed = null;
  previousFix = null;
  renderSpeed();
  setGpsState("searching", "Waiting for GPS");
}, 1000);

initialize().catch((error) => {
  console.error("Could not initialize Dashstyle:", error);
  setGpsState("error", "Could not load dashboard styles");
});
