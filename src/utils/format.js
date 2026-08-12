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

// แสดงเวลาแบบนาฬิกา เช่น "14:30 น."
export function formatClock(dateStr) {
  if (!dateStr) return '–';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
}

// แสดงวันที่+เวลาแบบย่อ เช่น "13 ส.ค. 15:00 น." ถ้าเป็นวันนี้จะโชว์แค่เวลา
export function formatDateTime(dateStr) {
  if (!dateStr) return '–';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '–';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return formatClock(dateStr);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' ' + formatClock(dateStr);
}
