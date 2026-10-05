// ===== เวลาทั้งระบบเป็นไทย (UTC+7 / Asia/Bangkok) ไม่ว่าเครื่องผู้ใช้จะตั้ง timezone ไว้เป็นอะไร =====
export const TZ = 'Asia/Bangkok';
export const TZ_OFFSET = '+07:00';
export const MAX_ADVANCE_DAYS = 7;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function bangkokParts(date = new Date()) {
  const o = {};
  for (const p of partsFormatter.formatToParts(date)) o[p.type] = p.value;
  return { y: o.year, m: o.month, d: o.day, hh: o.hour, mm: o.minute };
}

export function bangkokDateStr(date = new Date()) {
  const { y, m, d } = bangkokParts(date);
  return `${y}-${m}-${d}`;
}

export function bangkokTimeStr(date = new Date()) {
  const { hh, mm } = bangkokParts(date);
  return `${hh}:${mm}`;
}

export function bangkokMaxDateStr() {
  return bangkokDateStr(new Date(Date.now() + MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000));
}

// รวมวัน + เวลาที่ผู้ใช้เลือก (เวลาไทย) เป็น Date จริง
export function fromBangkok(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00${TZ_OFFSET}`);
}

// ค่าเริ่มต้นของ "จองล่วงหน้า" = เวลาปัจจุบัน ปัดขึ้นเป็นทวีคูณของ 5 นาที (ข้ามวันได้)
export function defaultLaterSlot() {
  const stepMs = 5 * 60 * 1000;
  const next = new Date(Math.ceil((Date.now() + 1000) / stepMs) * stepMs);
  return { date: bangkokDateStr(next), time: bangkokTimeStr(next) };
}

// ถ้าเลือกวัน/เวลาที่ผ่านไปแล้ว ให้ดึงกลับเป็นเวลาปัจจุบัน (นาทีปัจจุบันยังเลือกได้)
export function clampToNow(dateStr, timeStr) {
  const today = bangkokDateStr();
  if (dateStr < today) return { date: today, time: bangkokTimeStr() };
  if (dateStr === today && timeStr < bangkokTimeStr()) return { date: dateStr, time: bangkokTimeStr() };
  return { date: dateStr, time: timeStr };
}
