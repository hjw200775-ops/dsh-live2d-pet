import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { normalizeWardrobe, defaultWardrobe } from '../runtime/wardrobe.mjs';
import path from 'node:path';
import { normalizeMouseFollow } from '../runtime/look.mjs';
import { randomBytes } from 'node:crypto';

const finite = value => typeof value === 'number' && Number.isFinite(value);

export function defaultDesktopPreferences() {
  return { schemaVersion: 1, bounds: null, displayId: null, alwaysOnTop: true, clickThrough: true, zoom: 1, model: { x: 0, y: 0 }, wardrobe: defaultWardrobe(), mouseFollow: normalizeMouseFollow(), quitWithHost: false };
}

export function sanitizeDesktopPreferences(input, previous = defaultDesktopPreferences()) {
  const result = structuredClone(previous);
  if (!input || typeof input !== 'object') return result;
  result.mouseFollow = normalizeMouseFollow(input.mouseFollow, result.mouseFollow || normalizeMouseFollow());
  if (input.alwaysOnTop === true || input.alwaysOnTop === false) result.alwaysOnTop = input.alwaysOnTop;
  if (input.clickThrough === true || input.clickThrough === false) result.clickThrough = input.clickThrough;
  if (input.quitWithHost === true || input.quitWithHost === false) result.quitWithHost = input.quitWithHost;
  if (finite(input.zoom) && input.zoom >= 0.25 && input.zoom <= 3) result.zoom = input.zoom;
  if (typeof input.displayId === 'string' && input.displayId.length < 80) result.displayId = input.displayId;
  if (input.model && finite(input.model.x) && finite(input.model.y) && Math.abs(input.model.x) <= 10000 && Math.abs(input.model.y) <= 10000) {
    result.model = { x: input.model.x, y: input.model.y };
  }
  if (input.wardrobe && typeof input.wardrobe === 'object') result.wardrobe = normalizeWardrobe(input.wardrobe);
  const bounds = input.bounds;
  if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(finite) && bounds.width >= 200 && bounds.width <= 10000 && bounds.height >= 240 && bounds.height <= 10000 && Math.abs(bounds.x) <= 20000 && Math.abs(bounds.y) <= 20000) {
    result.bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  return result;
}

export function placeBounds(preferences, displays, fallbackSize = { width: 460, height: 700 }) {
  const list = Array.isArray(displays) && displays.length ? displays : [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true }];
  const primary = list.find(display => display.primary) || list[0];
  const saved = preferences && preferences.bounds;
  const visibleEnough = (bounds, area) => {
    const left = Math.max(bounds.x, area.x);
    const top = Math.max(bounds.y, area.y);
    const right = Math.min(bounds.x + bounds.width, area.x + area.width);
    const bottom = Math.min(bounds.y + bounds.height, area.y + area.height);
    return right - left >= 80 && bottom - top >= 80;
  };
  if (saved) {
    const matched = list.find(display => display.id === preferences.displayId) || list.find(display => visibleEnough(saved, display.workArea));
    if (matched) {
      const area = matched.workArea;
      const fit = Math.min(1, area.width / saved.width, area.height / saved.height);
      const width = Math.max(200, Math.round(saved.width * fit));
      const height = Math.max(240, Math.round(saved.height * fit));
      const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
      const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
      const restored = { x, y, width, height };
      if (visibleEnough(restored, area)) return { ...restored, displayId: matched.id };
    }
  }
  const area = primary.workArea;
  return {
    x: Math.round(area.x + area.width - fallbackSize.width - 48),
    y: Math.round(area.y + 48),
    width: fallbackSize.width,
    height: fallbackSize.height,
    displayId: primary.id,
  };
}

export async function loadDesktopPreferences(file) {
  try {
    return sanitizeDesktopPreferences(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return defaultDesktopPreferences();
    const broken = `${file}.broken-${Date.now()}`;
    await copyFile(file, broken).catch(() => {});
    return defaultDesktopPreferences();
  }
}

export async function saveDesktopPreferences(file, value) {
  const clean = sanitizeDesktopPreferences(value, defaultDesktopPreferences());
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(clean, null, 2), 'utf8');
  await rename(temporary, file);
  return clean;
}
