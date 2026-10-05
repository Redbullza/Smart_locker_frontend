// แปลงจำนวนนาทีเป็นข้อความอ่านง่าย เช่น 90 -> "1 ชม. 30 นาที", 45 -> "45 นาที", 120 -> "2 ชม."
export function formatMinutes(mins) {
  if (mins == null) return '–';
  const total = Number(mins);
  if (!Number.isFinite(total) || total <= 0) return '–';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} นาที`;
  if (m === 0) return `${h} ชม.`;
  return `${h} ชม. ${m} นาที`;
}

// เวลาไทยเสมอ ไม่ว่าเครื่อง/เบราว์เซอร์ผู้ใช้จะตั้ง timezone เป็นอะไรก็ตาม
const TZ = 'Asia/Bangkok';

// แสดงเวลาแบบนาฬิกา เช่น "14:30 น."
export function formatClock(dateStr) {
  if (!dateStr) return '–';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) + ' น.';
}

// แสดงวันที่+เวลาแบบย่อ เช่น "13 ส.ค. 15:00 น." ถ้าเป็นวันนี้จะโชว์แค่เวลา
export function formatDateTime(dateStr) {
  if (!dateStr) return '–';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '–';
  const now = new Date();
  const isToday = d.toLocaleDateString('en-CA', { timeZone: TZ }) === now.toLocaleDateString('en-CA', { timeZone: TZ });
  if (isToday) return formatClock(dateStr);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ }) + ' ' + formatClock(dateStr);
}

// แสดงวันที่+เวลาแบบเต็ม เช่น "12/8/2569 19:47:44" ใช้ในตาราง log ของ admin
export function formatFullDateTime(dateStr) {
  if (!dateStr) return '–';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('th-TH', { timeZone: TZ });
}

// ระยะเวลาที่ผ่านมาแล้วตั้งแต่เวลาที่ระบุ เช่น "1 ชม. 5 นาที" ใช้บอกว่าเกินเวลามานานเท่าไร
export function formatElapsed(startStr) {
  if (!startStr) return '–';
  const start = new Date(startStr);
  if (Number.isNaN(start.getTime())) return '–';
  const totalMinutes = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} นาที`;
  return `${hours} ชม. ${minutes} นาที`;
}
