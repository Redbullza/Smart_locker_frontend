import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { getJSON, postJSON, request } from '../api';
import { formatMinutes, formatClock, formatDateTime, formatElapsed } from '../utils/format';
import {
  bangkokParts,
  bangkokDateStr,
  bangkokMaxDateStr,
  fromBangkok,
  defaultLaterSlot,
  clampToNow,
} from '../utils/time';
import RelocationModal from '../components/RelocationModal';
import UserHistory from '../components/UserHistory';

const SIZE_LABEL = { small: 'เล็ก', medium: 'กลาง', large: 'ใหญ่' };
const STATUS_LABEL = {
  available: 'ว่าง',
  busy: 'ไม่ว่าง', // มีคนอื่นใช้อยู่ ณ ตอนนี้
  in_use: 'กำลังใช้งาน', // แสดงเฉพาะตู้ที่ฉันใช้อยู่
  unavailable: 'ปิดใช้งาน',
  maintenance: 'ซ่อมบำรุง',
};
const MIN_MINUTES = 15;
const MAX_MINUTES = 24 * 60;
const MINUTES_STEP = 15;
const DEFAULT_MINUTES = 120; // 2 ชม.
const MAX_ADVANCE_DAYS = 7;

// ตัวเลือกเวลาแบบ 24 ชม. เสมอ (ไม่ใช้ <input type="time"> เพราะ browser จะโชว์เป็น 12 ชม. AM/PM
// ตาม locale ของเครื่อง/OS ผู้ใช้ ซึ่งบังคับด้วย HTML/CSS ให้เป็น 24 ชม. ไม่ได้เลย)
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')); // เลือกได้ทุกนาที

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('locker_user') || 'null');
  } catch {
    return null;
  }
}

// ---------------- icons (inline, no external deps) ----------------
function IconLockers(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}
function IconTicket(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4Z" />
      <path d="M13 5v2M13 17v2M13 10.5v3" />
    </svg>
  );
}
const BOOKING_FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'using', label: 'กำลังใช้งาน' },
  { key: 'booked', label: 'จองไว้ · รอใช้' },
];
// กำลังใช้งาน = ถึงเวลาแล้วและใช้ตู้ได้ (รวมเกินเวลา) / ที่เหลือคือจองไว้รอใช้ (รวมกรณีถึงเวลาแต่ตู้ยังไม่ว่าง)
function phaseGroup(phase) {
  return phase === 'active' || phase === 'overdue' ? 'using' : 'booked';
}

function IconHistory(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function bookingPhase(b) {
  const now = Date.now();
  const start = new Date(b.start_time).getTime();
  const end = new Date(b.end_time).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 'active'; // fallback ข้อมูลเก่าที่ไม่มี start/end
  if (b.blocked) return 'waiting'; // ถึงเวลาแล้วแต่ผู้ใช้คนก่อนยังไม่เอาของออก
  if (now < start) return 'upcoming';
  if (now < end) return 'active';
  return 'overdue';
}

export default function HomePage() {
  // ---------------- auth ----------------
  const [currentUser, setCurrentUser] = useState(loadStoredUser);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [authMsg, setAuthMsg] = useState(null); // { type, text }

  // ---------------- lockers / bookings ----------------
  const [lockers, setLockers] = useState([]);
  const [lockersLoaded, setLockersLoaded] = useState(false);
  const [lockersError, setLockersError] = useState(false);
  const [myBookings, setMyBookings] = useState([]);
  const [updatedAt, setUpdatedAt] = useState('–');
  const [page, setPage] = useState('all'); // 'all' = ตู้ทั้งหมด, 'mine' = ตู้ของฉัน
  const [bookingFilter, setBookingFilter] = useState('all'); // all | using | booked
  const [relocation, setRelocation] = useState(null);
  const snoozedRef = useRef(new Set()); // booking ที่ผู้ใช้กด "รอก่อน" ในรอบนี้

  // ---------------- booking (จองตรง) ----------------
  const [selectedMinutes, setSelectedMinutes] = useState({}); // { [locker_id]: minutes }
  const [selectedSchedule, setSelectedSchedule] = useState({}); // { [locker_id]: { mode: 'now'|'later', date, time } }
  const [bookingBusyId, setBookingBusyId] = useState(null);

  // ---------------- payment (คิดเงินตามขนาดตู้ ก่อนยืนยันจอง — QR จำลอง) ----------------
  const [paymentOverlay, setPaymentOverlay] = useState(false);
  const [paymentSession, setPaymentSession] = useState(null); // { session_id, locker_number, locker_size, amount, ref_code, qr_payload, planned_minutes }
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentMsg, setPaymentMsg] = useState(null);
  const [paidAmount, setPaidAmount] = useState(null);

  // ---------------- pin result (หลังจองสำเร็จ) ----------------
  const [pinResultOverlay, setPinResultOverlay] = useState(false);
  const [pinResultCode, setPinResultCode] = useState('------');
  const [pinResultMinutes, setPinResultMinutes] = useState(null);
  const [pinResultStart, setPinResultStart] = useState(null);
  const [pinResultEnd, setPinResultEnd] = useState(null);

  // ---------------- pin input (open/close locker) — จำลองกดปุ่มที่ตู้จริง, ยังต้องกรอก PIN ----------------
  const [pendingAction, setPendingAction] = useState(null); // { booking_id, action }
  const [pinInputOverlay, setPinInputOverlay] = useState(false);
  const [pinInputValue, setPinInputValue] = useState('');
  const [pinInputMsg, setPinInputMsg] = useState(null);
  const [pinInputBusy, setPinInputBusy] = useState(false);

  // ---------------- batch quick-action (ในแอป ไม่ต้องกรอก PIN ซ้ำ เพราะ login แล้ว) ----------------
  const [selectedBookingIds, setSelectedBookingIds] = useState({}); // { [booking_id]: true }
  const [batchBusy, setBatchBusy] = useState(false);

  // ---------------- return result ----------------
  const [returnResultOverlay, setReturnResultOverlay] = useState(false);
  const [returnResult, setReturnResult] = useState({ title: 'คืนตู้สำเร็จ', desc: 'ขอบคุณที่ใช้บริการ' });

  const userRef = useRef(currentUser);
  userRef.current = currentUser;

  const navigate = useNavigate();

  // แยกหน้า admin/user เด็ดขาด — login เป็น admin แล้ว redirect ไปหน้า /admin ทันที ไม่เห็นหน้านี้เลย
  useEffect(() => {
    if (currentUser?.role === 'admin') {
      navigate('/admin', { replace: true });
    }
  }, [currentUser, navigate]);

  // ---------------- data loading ----------------
  const loadLockers = useCallback(async () => {
    try {
      const uid = userRef.current?.user_id;
      const json = await getJSON('/lockers' + (uid ? `?user_id=${uid}` : ''));
      // ถ้า backend ส่งสถานะแบบเก่า (occupied/overdue) มา ให้แสดงเป็น "ไม่ว่าง" เสมอ
      setLockers((json.data || []).map((l) => (
        l.display_status === 'occupied' || l.display_status === 'overdue' ? { ...l, display_status: 'busy' } : l
      )));
      setLockersLoaded(true);
      setLockersError(false);
      setUpdatedAt('อัปเดตล่าสุด ' + formatClock(new Date()));
    } catch (err) {
      setLockersError(true);
    }
  }, []);

  const loadMyBookings = useCallback(async () => {
    const user = userRef.current;
    if (!user) return;
    const json = await getJSON('/my-bookings?user_id=' + user.user_id);
    const bookings = (json.data || []).filter((b) => b.status === 'active');
    setMyBookings(bookings);
  }, []);

  useEffect(() => {
    loadLockers();
    loadMyBookings();
    const id = setInterval(() => {
      loadLockers();
      loadMyBookings();
    }, 5000);
    return () => clearInterval(id);
  }, [loadLockers, loadMyBookings]);

  useEffect(() => {
    loadLockers();
    loadMyBookings();
    if (!currentUser) {
      setMyBookings([]);
      setPage('all');
      setRelocation(null);
    }
  }, [currentUser, loadLockers, loadMyBookings]);

  // ---------------- แจ้งผู้ใช้คนถัดไป: ถึงเวลาจองแล้วแต่คนก่อนยังไม่เอาของออก ----------------
  useEffect(() => {
    if (relocation) return;
    const blocked = myBookings.find((b) => b.blocked && !snoozedRef.current.has(b.booking_id));
    if (blocked) {
      setRelocation({ booking: blocked, step: 'ask', options: [], loading: false, busy: false, msg: null, selectedId: null, result: null });
    }
  }, [myBookings, relocation]);

  // ระหว่างที่ modal เปิด ถ้าคนก่อนหน้านำของออกแล้ว (ตู้เดิมว่าง) ไม่ต้องย้ายแล้ว ให้ปิด modal
  useEffect(() => {
    if (!relocation || relocation.step === 'done') return;
    const still = myBookings.find((b) => b.booking_id === relocation.booking.booking_id);
    if (myBookings.length > 0 && (!still || !still.blocked)) setRelocation(null);
  }, [myBookings, relocation]);

  function patchRelocation(patch) {
    setRelocation((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function loadRelocationOptions(bookingId) {
    patchRelocation({ loading: true, msg: null, selectedId: null });
    try {
      const json = await getJSON(`/bookings/${bookingId}/relocation-options?user_id=${currentUser.user_id}`);
      if (!json.success) {
        patchRelocation({ loading: false, options: [], msg: { type: 'error', text: json.message } });
        return;
      }
      patchRelocation({ loading: false, options: json.data || [] });
    } catch {
      patchRelocation({ loading: false, options: [], msg: { type: 'error', text: 'โหลดรายการตู้ไม่สำเร็จ ลองใหม่อีกครั้ง' } });
    }
  }

  function handleRelocAccept() {
    patchRelocation({ step: 'pick' });
    loadRelocationOptions(relocation.booking.booking_id);
  }

  async function handleRelocConfirmMove() {
    if (!relocation?.selectedId) return;
    patchRelocation({ busy: true, msg: null });
    try {
      const res = await postJSON(`/bookings/${relocation.booking.booking_id}/relocate`, {
        user_id: currentUser.user_id,
        locker_id: relocation.selectedId,
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) {
        patchRelocation({ busy: false, msg: { type: 'error', text: json?.message || 'ย้ายตู้ไม่สำเร็จ' } });
        if (json?.code === 'locker_taken') loadRelocationOptions(relocation.booking.booking_id);
        return;
      }
      patchRelocation({ busy: false, step: 'done', result: { kind: 'moved', ...json } });
      loadLockers();
      loadMyBookings();
    } catch (err) {
      patchRelocation({ busy: false, msg: { type: 'error', text: 'เกิดข้อผิดพลาด: ' + err.message } });
    }
  }

  async function handleRelocConfirmDecline() {
    patchRelocation({ busy: true, msg: null });
    try {
      const res = await postJSON(`/bookings/${relocation.booking.booking_id}/decline-relocation`, {
        user_id: currentUser.user_id,
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) {
        patchRelocation({ busy: false, msg: { type: 'error', text: json?.message || 'ยกเลิกไม่สำเร็จ' } });
        return;
      }
      patchRelocation({ busy: false, step: 'done', result: { kind: 'declined', message: json.message } });
      loadLockers();
      loadMyBookings();
    } catch (err) {
      patchRelocation({ busy: false, msg: { type: 'error', text: 'เกิดข้อผิดพลาด: ' + err.message } });
    }
  }

  function handleRelocSnooze() {
    snoozedRef.current.add(relocation.booking.booking_id);
    setRelocation(null);
  }

  // เปิดหน้าต่างย้ายตู้ซ้ำจากรายการจอง (หลังเคยกด "รอก่อน")
  function reopenRelocation(booking) {
    snoozedRef.current.delete(booking.booking_id);
    setRelocation({ booking, step: 'ask', options: [], loading: false, busy: false, msg: null, selectedId: null, result: null });
  }

  // ---------------- auth handlers ----------------
  function handleToggleMode() {
    setIsRegisterMode((v) => !v);
    setAuthMsg(null);
  }

  async function handleSubmit() {
    const uname = username.trim();
    const pass = password;
    if (!uname || !pass) {
      setAuthMsg({ type: 'error', text: 'กรุณากรอก username และ password' });
      return;
    }

    if (isRegisterMode) {
      const fn = firstname.trim();
      const ln = lastname.trim();
      if (!fn || !ln) {
        setAuthMsg({ type: 'error', text: 'กรุณากรอกชื่อ-นามสกุล' });
        return;
      }
      const res = await postJSON('/register', { username: uname, password: pass, firstname: fn, lastname: ln });
      const json = await res.json();
      if (!json.success) {
        setAuthMsg({ type: 'error', text: json.message });
        return;
      }
      setAuthMsg({ type: 'success', text: 'สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ' });
      setIsRegisterMode(false);
      return;
    }

    const res = await postJSON('/login', { username: uname, password: pass });
    const json = await res.json();
    if (!json.success) {
      setAuthMsg({ type: 'error', text: json.message });
      return;
    }

    setCurrentUser(json);
    localStorage.setItem('locker_user', JSON.stringify(json));
    setAuthMsg(null);
  }

  function handleLogout() {
    setCurrentUser(null);
    localStorage.removeItem('locker_user');
  }

  // ---------------- booking + คิดเงินตามขนาดตู้ ----------------
  function getMinutesFor(lockerId) {
    return selectedMinutes[lockerId] ?? DEFAULT_MINUTES;
  }

  function handleMinutesChange(lockerId, minutes) {
    setSelectedMinutes((prev) => ({ ...prev, [lockerId]: Number(minutes) }));
  }

  function getScheduleFor(lockerId) {
    if (selectedSchedule[lockerId]) return selectedSchedule[lockerId];
    const locker = lockers.find((l) => l.locker_id === lockerId);
    // ตู้ที่ไม่ว่างตอนนี้ จองได้เฉพาะ "จองล่วงหน้า" จึงเริ่มที่โหมดนั้นเลย
    const notFreeNow = locker && (locker.display_status === 'busy' || locker.display_status === 'in_use');
    return { mode: notFreeNow ? 'later' : 'now', ...defaultLaterSlot() };
  }

  function handleScheduleModeChange(lockerId, mode) {
    const current = getScheduleFor(lockerId);
    const slot = mode === 'later' ? clampToNow(current.date, current.time) : current;
    setSelectedSchedule((prev) => ({ ...prev, [lockerId]: { ...current, ...slot, mode } }));
  }

  // เลือกวัน/เวลาได้อิสระ ยกเว้นย้อนหลัง — ถ้าเลือกเวลาที่ผ่านไปแล้วจะถูกดึงกลับเป็นเวลาปัจจุบัน
  function handleScheduleFieldChange(lockerId, field, value) {
    const current = getScheduleFor(lockerId);
    const next = { ...current, [field]: value };
    const slot = clampToNow(next.date, next.time);
    setSelectedSchedule((prev) => ({ ...prev, [lockerId]: { ...next, ...slot } }));
  }

  function handleScheduleTimePartChange(lockerId, part, value) {
    const current = getScheduleFor(lockerId).time || '09:00';
    const [h, m] = current.split(':');
    const nextTime = part === 'hour' ? `${value}:${m ?? '00'}` : `${h ?? '09'}:${value}`;
    handleScheduleFieldChange(lockerId, 'time', nextTime);
  }

  // ชั่วโมง/นาทีที่ย้อนหลังแล้ว (เฉพาะเมื่อเลือกวันนี้) จะกดเลือกไม่ได้
  function isHourPast(date, hour) {
    return date === bangkokDateStr() && Number(hour) < Number(bangkokParts().hh);
  }
  function isMinutePast(date, hour, minute) {
    const now = bangkokParts();
    return date === bangkokDateStr() && Number(hour) === Number(now.hh) && Number(minute) < Number(now.mm);
  }

  // ISO string ของเวลาที่จะเริ่มใช้ตู้ หรือ null ถ้า "ใช้ตอนนี้" / false ถ้าข้อมูลไม่ถูกต้อง
  function resolveStartTime(lockerId) {
    const schedule = getScheduleFor(lockerId);
    if (schedule.mode === 'now') return null;
    if (!schedule.date || !schedule.time) {
      alert('กรุณาเลือกวันและเวลาที่ต้องการจอง');
      return false;
    }
    const combined = fromBangkok(schedule.date, schedule.time); // ตีความเป็นเวลาไทย (UTC+7) เสมอ
    if (Number.isNaN(combined.getTime())) {
      alert('วันเวลาที่เลือกไม่ถูกต้อง');
      return false;
    }
    if (combined.getTime() < Date.now() - 60 * 1000) {
      alert('เลือกเวลาย้อนหลังไม่ได้');
      return false;
    }
    return combined.toISOString();
  }

  async function handleBook(locker) {
    if (!currentUser) return;
    const minutes = getMinutesFor(locker.locker_id);
    const startTime = resolveStartTime(locker.locker_id);
    if (startTime === false) return; // วัน/เวลาที่เลือกไม่ถูกต้อง — แจ้งเตือนไปแล้ว

    setBookingBusyId(locker.locker_id);
    setPaymentMsg(null);

    try {
      const res = await postJSON('/payment-sessions', {
        user_id: currentUser.user_id,
        locker_id: locker.locker_id,
        minutes,
        start_time: startTime,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }
      const json = await res.json();
      if (!json.success) {
        alert(json.message);
        return;
      }

      setPaymentSession(json);
      setPaymentOverlay(true);
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
      console.error('Create payment session error:', err);
    } finally {
      setBookingBusyId(null);
    }
  }

  // ---------------- payment modal (QR จำลอง) ----------------
  async function handlePaymentCancel() {
    if (paymentSession?.session_id) {
      request(`/payment-sessions/${paymentSession.session_id}/cancel`, { method: 'PUT' }).catch(() => {});
    }
    setPaymentOverlay(false);
    setPaymentSession(null);
    setPaymentMsg(null);
  }

  async function handlePaymentConfirm() {
    if (!paymentSession?.session_id) return;
    setPaymentBusy(true);
    setPaymentMsg(null);

    try {
      const res = await request(`/payment-sessions/${paymentSession.session_id}/confirm`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }
      const json = await res.json();
      if (!json.success) {
        setPaymentMsg({ type: 'error', text: json.message });
        return;
      }

      setPaymentOverlay(false);
      setPaidAmount(json.amount ?? paymentSession.amount);
      setPinResultCode(json.pin_code);
      setPinResultMinutes(json.planned_minutes ?? paymentSession.planned_minutes);
      setPinResultStart(json.start_time ?? paymentSession.start_time);
      setPinResultEnd(json.end_time ?? paymentSession.end_time);
      setPinResultOverlay(true);
      setPaymentSession(null);
      loadLockers();
      loadMyBookings();
    } catch (err) {
      setPaymentMsg({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
      console.error('Confirm payment error:', err);
    } finally {
      setPaymentBusy(false);
    }
  }

  // ---------------- pin input (open / close) ----------------
  function openPinModal(booking_id, action) {
    setPendingAction({ booking_id, action });
    setPinInputValue('');
    setPinInputMsg(null);
    setPinInputOverlay(true);
  }

  function handlePinInputCancel() {
    setPinInputOverlay(false);
    setPendingAction(null);
  }

  async function handlePinInputConfirm() {
    if (!pendingAction) return;
    const pin_code = pinInputValue.trim();
    if (!pin_code) {
      setPinInputMsg({ type: 'error', text: 'กรุณากรอกรหัส PIN' });
      return;
    }

    setPinInputBusy(true);

    try {
      const res = await postJSON('/verify-pin', {
        booking_id: pendingAction.booking_id,
        pin_code,
        action: pendingAction.action,
      });

      const json = await res.json().catch(() => null);

      if (!json) {
        setPinInputMsg({ type: 'error', text: `เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status})` });
        return;
      }
      if (!json.success) {
        // ครอบคลุมทั้งกรณี PIN ผิด (401) และกรอกผิดเกินกำหนดจนโดน cooldown (429)
        setPinInputMsg({ type: 'error', text: json.message });
        return;
      }

      setPinInputOverlay(false);
      const wasClose = pendingAction.action === 'close';
      setPendingAction(null);
      loadLockers();
      loadMyBookings();

      if (wasClose) {
        setReturnResult({ title: 'คืนตู้สำเร็จ', desc: 'ขอบคุณที่ใช้บริการ' });
        setReturnResultOverlay(true);
      }
    } catch (err) {
      setPinInputMsg({ type: 'error', text: `เกิดข้อผิดพลาด: ${err.message}` });
      console.error('Verify-pin error:', err);
    } finally {
      setPinInputBusy(false);
    }
  }

  // ---------------- batch quick-action (ในแอป ไม่ต้องกรอก PIN ซ้ำ) ----------------
  function toggleBookingSelected(bookingId) {
    setSelectedBookingIds((prev) => ({ ...prev, [bookingId]: !prev[bookingId] }));
  }

  function selectAllBookings(bookingIds, checked) {
    const next = {};
    bookingIds.forEach((id) => { next[id] = checked; });
    setSelectedBookingIds(next);
  }

  async function handleBatchAction(action, bookingIds) {
    const ids = bookingIds ?? Object.keys(selectedBookingIds).filter((id) => selectedBookingIds[id]).map(Number);
    if (ids.length === 0) return;

    setBatchBusy(true);
    try {
      const res = await postJSON('/bookings/batch-action', {
        user_id: currentUser.user_id,
        items: ids.map((booking_id) => ({ booking_id, action })),
      });
      const json = await res.json().catch(() => null);
      if (!json) {
        alert(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status})`);
        return;
      }

      const results = json.results || [];
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        alert(
          'บางรายการดำเนินการไม่สำเร็จ:\n' +
          failed.map((f) => `ตู้ booking #${f.booking_id}: ${f.message}`).join('\n')
        );
      }

      const succeeded = results.length - failed.length;
      setSelectedBookingIds({});
      loadLockers();
      loadMyBookings();

      if (action === 'close' && succeeded > 0) {
        setReturnResult({ title: 'คืนตู้สำเร็จ', desc: `คืนตู้แล้ว ${succeeded} ใบ` });
        setReturnResultOverlay(true);
      }
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
      console.error('Batch action error:', err);
    } finally {
      setBatchBusy(false);
    }
  }

  // ---------------- derived stats ----------------
  const statTotal = lockers.length;
  const statAvailable = lockers.filter((l) => l.display_status === 'available').length;
  const statInUse = lockers.filter((l) => l.display_status === 'busy' || l.display_status === 'in_use').length;

  const bookingsWithPhase = useMemo(
    () => myBookings.map((b) => ({ ...b, phase: bookingPhase(b) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myBookings, updatedAt]
  );
  const usingCount = bookingsWithPhase.filter((b) => phaseGroup(b.phase) === 'using').length;
  const bookedCount = bookingsWithPhase.length - usingCount;
  const visibleBookings = bookingsWithPhase.filter(
    (b) => bookingFilter === 'all' || phaseGroup(b.phase) === bookingFilter
  );

  if (currentUser?.role === 'admin') {
    return null; // กำลัง redirect ไป /admin ผ่าน useEffect ด้านบน ไม่ต้องโชว์หน้านี้แม้แต่แวบเดียว
  }

  return (
    <div className="wrap" id="top">
      <header>
        <div>
          <p className="eyebrow">Prince of Songkla University · Faculty of Liberal Arts</p>
          <h1>ระบบตู้รับฝากของอัจฉริยะ</h1>
          <p className="subtitle">จุดบริการตู้ล็อกเกอร์ ตึกคณะศิลปศาสตร์</p>
        </div>
      </header>

      <div className="panel">
        {!currentUser ? (
          <div>
            <h2>{isRegisterMode ? 'สมัครสมาชิกใหม่' : 'เข้าสู่ระบบเพื่อจองตู้'}</h2>
            <div className="form-row">
              <input
                type="text"
                placeholder="ชื่อผู้ใช้ (username)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                type="password"
                placeholder="รหัสผ่าน"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {isRegisterMode && (
              <div className="form-row" style={{ marginTop: 10 }}>
                <input
                  type="text"
                  placeholder="ชื่อจริง"
                  value={firstname}
                  onChange={(e) => setFirstname(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="นามสกุล"
                  value={lastname}
                  onChange={(e) => setLastname(e.target.value)}
                />
              </div>
            )}
            <div className="form-row" style={{ marginTop: 14, display: 'block' }}>
              <button className="btn primary" style={{ width: '100%' }} onClick={handleSubmit}>
                {isRegisterMode ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
              </button>
            </div>
            <button className="toggle-link" onClick={handleToggleMode}>
              {isRegisterMode ? 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครสมาชิก'}
            </button>
            {authMsg && <div className={`msg ${authMsg.type}`}>{authMsg.text}</div>}
          </div>
        ) : (
          <div className="account-row">
            <div className="account-info">
              เข้าสู่ระบบเป็น <b>{currentUser.firstname} {currentUser.lastname}</b>
              <span className="role">{currentUser.role}</span>
            </div>
            <button className="btn ghost" onClick={handleLogout}>ออกจากระบบ</button>
          </div>
        )}
      </div>

      {currentUser && (
        <div className="tabs page-tabs" role="tablist">
          <button role="tab" aria-selected={page === 'all'} className={`tab-btn ${page === 'all' ? 'active' : ''}`} onClick={() => setPage('all')}>
            ตู้ทั้งหมด
          </button>
          <button role="tab" aria-selected={page === 'mine'} className={`tab-btn ${page === 'mine' ? 'active' : ''}`} onClick={() => setPage('mine')}>
            ตู้ของฉัน{myBookings.length > 0 && <span className="tab-count">{myBookings.length}</span>}
          </button>
          <button role="tab" aria-selected={page === 'history'} className={`tab-btn ${page === 'history' ? 'active' : ''}`} onClick={() => setPage('history')}>
            ประวัติการใช้งาน
          </button>
        </div>
      )}

      {page === 'all' && (<>
      <div className="stats">
        <div className="stat"><div className="num">{statTotal || '–'}</div><div className="label">ตู้ทั้งหมด</div></div>
        <div className="stat ok"><div className="num">{statAvailable || '–'}</div><div className="label">ว่าง</div></div>
        <div className="stat danger"><div className="num">{statInUse || '–'}</div><div className="label">กำลังใช้งาน</div></div>
      </div>

      <div id="lockers" className="section-label"><span>ผังตู้ล็อกเกอร์ — เลือกขนาดที่ต้องการ</span><div className="rule" /></div>
      <div className="grid">
        {lockersError ? (
          <div className="empty">เชื่อมต่อ API ไม่ได้ ตรวจสอบว่า server กำลังรันอยู่หรือไม่</div>
        ) : !lockersLoaded ? (
          <div className="empty">กำลังโหลดข้อมูลตู้ล็อกเกอร์...</div>
        ) : lockers.length === 0 ? (
          <div className="empty">ยังไม่มีตู้ล็อกเกอร์ในระบบ</div>
        ) : (
          lockers.map((l) => (
            <div className={`locker ${l.display_status}`} key={l.locker_id}>
              <span className="dot" />
              <div className="number">{l.locker_number}</div>
              <div className="size-tag">ขนาด{SIZE_LABEL[l.size] || l.size}</div>
              <div className="location">{l.location}</div>
              <span className="pill">{STATUS_LABEL[l.display_status] || l.display_status}</span>

              {l.display_status === 'busy' && (
                <div className="status-note">ตอนนี้มีผู้ใช้งานอยู่ · จองล่วงหน้าได้</div>
              )}
              {l.display_status === 'in_use' && (
                <div className="status-note mine">{l.my_overdue ? 'ตู้ของคุณ · เกินเวลาที่จองไว้' : 'คุณกำลังใช้ตู้นี้'}</div>
              )}

              {l.display_status === 'maintenance' ? (
                <button className="btn" disabled>ปิดปรับปรุง</button>
              ) : l.display_status === 'unavailable' ? (
                <button className="btn" disabled>ปิดใช้งาน</button>
              ) : (
                <>
                  <div className="schedule-row">
                    <button
                      type="button"
                      className={`chip ${getScheduleFor(l.locker_id).mode === 'now' ? 'active' : ''}`}
                      disabled={!currentUser || l.display_status !== 'available'}
                      title={l.display_status !== 'available' ? 'ตู้ไม่ว่างตอนนี้ จองได้เฉพาะล่วงหน้า' : undefined}
                      onClick={() => handleScheduleModeChange(l.locker_id, 'now')}
                    >
                      ใช้ตอนนี้
                    </button>
                    <button
                      type="button"
                      className={`chip ${getScheduleFor(l.locker_id).mode === 'later' ? 'active' : ''}`}
                      disabled={!currentUser}
                      onClick={() => handleScheduleModeChange(l.locker_id, 'later')}
                    >
                      จองล่วงหน้า
                    </button>
                  </div>
                  {getScheduleFor(l.locker_id).mode === 'later' && (
                    <div className="schedule-datetime">
                      <input
                        type="date"
                        lang="th-TH"
                        min={bangkokDateStr()}
                        max={bangkokMaxDateStr()}
                        disabled={!currentUser}
                        value={getScheduleFor(l.locker_id).date}
                        onChange={(e) => handleScheduleFieldChange(l.locker_id, 'date', e.target.value)}
                      />
                      <div className="schedule-time-row">
                        <select
                          aria-label="ชั่วโมง"
                          disabled={!currentUser}
                          value={(getScheduleFor(l.locker_id).time || '09:00').split(':')[0]}
                          onChange={(e) => handleScheduleTimePartChange(l.locker_id, 'hour', e.target.value)}
                        >
                          {HOUR_OPTIONS.map((h) => <option key={h} value={h} disabled={isHourPast(getScheduleFor(l.locker_id).date, h)}>{h}</option>)}
                        </select>
                        <span className="schedule-time-sep">:</span>
                        <select
                          aria-label="นาที"
                          disabled={!currentUser}
                          value={(getScheduleFor(l.locker_id).time || '09:00').split(':')[1]}
                          onChange={(e) => handleScheduleTimePartChange(l.locker_id, 'minute', e.target.value)}
                        >
                          {MINUTE_OPTIONS.map((m) => {
                            const sch = getScheduleFor(l.locker_id);
                            return <option key={m} value={m} disabled={isMinutePast(sch.date, (sch.time || '09:00').split(':')[0], m)}>{m}</option>;
                          })}
                        </select>
                        <span className="schedule-time-hint">24 ชม. · UTC+7</span>
                      </div>
                    </div>
                  )}

                  <label className="hours-label" htmlFor={`minutes-${l.locker_id}`}>
                    ระยะเวลา · <b>{formatMinutes(getMinutesFor(l.locker_id))}</b>
                  </label>
                  <input
                    id={`minutes-${l.locker_id}`}
                    className="hours-range"
                    type="range"
                    min={MIN_MINUTES}
                    max={MAX_MINUTES}
                    step={MINUTES_STEP}
                    disabled={!currentUser}
                    value={getMinutesFor(l.locker_id)}
                    onChange={(e) => handleMinutesChange(l.locker_id, e.target.value)}
                  />
                  <div className="hours-range-scale"><span>15 นาที</span><span>24 ชม.</span></div>

                  <button
                    className="btn primary"
                    disabled={!currentUser || bookingBusyId === l.locker_id}
                    onClick={() => handleBook(l)}
                  >
                    {!currentUser
                      ? 'เข้าสู่ระบบก่อน'
                      : bookingBusyId === l.locker_id
                      ? 'กำลังเตรียมชำระเงิน...'
                      : getScheduleFor(l.locker_id).mode === 'later' ? 'จองล่วงหน้า' : 'จองตู้'}
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      </>)}

      {page === 'mine' && (<>
      <div id="my-bookings" className="section-label"><span>รายการจองของฉัน</span><div className="rule" /></div>
      <div>
        {!currentUser ? (
          <div className="empty">เข้าสู่ระบบก่อนเพื่อดูรายการจองของคุณ</div>
        ) : myBookings.length === 0 ? (
          <div className="empty">ยังไม่มีตู้ที่ใช้อยู่หรือจองไว้ — ไปที่หน้า “ตู้ทั้งหมด” เพื่อจองตู้</div>
        ) : (
          <>
            <div className="stats mine-stats">
              <div className="stat danger"><div className="num">{usingCount}</div><div className="label">กำลังใช้งาน</div></div>
              <div className="stat"><div className="num">{bookedCount}</div><div className="label">จองไว้ · รอใช้</div></div>
            </div>

            <div className="chip-filter" role="group" aria-label="กรองรายการ">
              {BOOKING_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={bookingFilter === f.key}
                  className={`chip ${bookingFilter === f.key ? 'active' : ''}`}
                  onClick={() => { setBookingFilter(f.key); setSelectedBookingIds({}); }}
                >
                  {f.label}
                  {f.key === 'using' && ` (${usingCount})`}
                  {f.key === 'booked' && ` (${bookedCount})`}
                </button>
              ))}
            </div>

            {visibleBookings.length === 0 ? (
              <div className="empty">ไม่มีรายการในหมวดนี้</div>
            ) : (
              <>
                {visibleBookings.some((b) => b.phase === 'active' || b.phase === 'overdue') && (
                  <div className="batch-toolbar">
                    <label className="batch-select-all">
                      <input
                        type="checkbox"
                        checked={visibleBookings.filter((b) => b.phase === 'active' || b.phase === 'overdue').every((b) => selectedBookingIds[b.booking_id])}
                        onChange={(e) =>
                          selectAllBookings(
                            visibleBookings.filter((b) => b.phase === 'active' || b.phase === 'overdue').map((b) => b.booking_id),
                            e.target.checked
                          )
                        }
                      />
                      เลือกทั้งหมด
                    </label>
                    <button
                      className="btn primary small"
                      disabled={batchBusy || Object.values(selectedBookingIds).every((v) => !v)}
                      onClick={() => handleBatchAction('open')}
                    >
                      {batchBusy ? 'กำลังดำเนินการ...' : 'ปลดล็อกที่เลือก'}
                    </button>
                    <button
                      className="btn ghost small"
                      disabled={batchBusy || Object.values(selectedBookingIds).every((v) => !v)}
                      onClick={() => handleBatchAction('close')}
                    >
                      คืนตู้ที่เลือก
                    </button>
                  </div>
                )}

                {visibleBookings.map((b) => {
                  const phase = b.phase;
                  const usable = phase === 'active' || phase === 'overdue';
                  return (
                    <div className="booking" key={b.booking_id}>
                      {usable && (
                        <label className="booking-check">
                          <input
                            type="checkbox"
                            checked={!!selectedBookingIds[b.booking_id]}
                            onChange={() => toggleBookingSelected(b.booking_id)}
                          />
                        </label>
                      )}
                      <div className="info">
                        ตู้ <b>{b.locker_number}</b>
                        <span className="pin-tag">PIN: {b.pin_code}</span>
                        {phase === 'active' && <span className="pin-tag state using">กำลังใช้งาน</span>}
                        {phase === 'overdue' && <span className="pin-tag danger">เกินเวลา</span>}
                        {phase === 'upcoming' && <span className="pin-tag state booked">จองไว้</span>}
                        {phase === 'waiting' && <span className="pin-tag danger">รอตู้ว่าง</span>}
                        <br />
                        <span style={{ color: 'var(--muted)' }}>{b.location}</span><br />
                        {phase === 'upcoming' ? (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                            จองล่วงหน้าไว้ {formatDateTime(b.start_time)} – {formatClock(b.end_time)} · ยังไม่เริ่มใช้งาน
                          </span>
                        ) : phase === 'waiting' ? (
                          <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                            {new Date(b.start_time).getTime() > Date.now()
                              ? 'ผู้ใช้คนก่อนยังไม่นำของออกและเลยเวลาแล้ว · อาจใช้ตู้นี้ไม่ได้ตามเวลาที่จอง'
                              : 'ถึงเวลาของคุณแล้ว แต่ผู้ใช้คนก่อนยังไม่นำของออก · ยังเปิดตู้นี้ไม่ได้'}
                          </span>
                        ) : phase === 'overdue' ? (
                          <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                            ควรคืนตู้ตั้งแต่ {formatDateTime(b.end_time)} · เกินเวลามาแล้ว {formatElapsed(b.end_time)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                            กำลังใช้งาน {formatClock(b.start_time)} – {formatClock(b.end_time)}
                            {b.planned_minutes ? ` · ${formatMinutes(b.planned_minutes)}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="actions">
                        {phase === 'waiting' ? (
                          <button className="btn primary" onClick={() => reopenRelocation(b)}>เลือกตู้ใหม่</button>
                        ) : phase === 'upcoming' ? (
                          <span className="wait-note">เปิดใช้ได้เมื่อถึงเวลา</span>
                        ) : (
                          <>
                            <button className="btn primary" disabled={batchBusy} onClick={() => handleBatchAction('open', [b.booking_id])}>
                              ปลดล็อกตู้
                            </button>
                            <button className="btn ghost" disabled={batchBusy} onClick={() => handleBatchAction('close', [b.booking_id])}>
                              คืนตู้ (ว่าง)
                            </button>
                            <button className="btn-link-small" onClick={() => openPinModal(b.booking_id, 'open')}>
                              กรอก PIN ที่ตู้เอง (จำลอง)
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      </>)}

      {page === 'history' && currentUser && <UserHistory user={currentUser} active={page === 'history'} />}

      <footer>
        <button className="btn ghost" onClick={() => { loadLockers(); loadMyBookings(); }}>รีเฟรชตอนนี้</button>
        <span className="updated">{updatedAt}</span>
      </footer>

      {/* Bottom app nav — mobile only */}
      <nav className="bottom-nav">
        <button className={page === 'all' ? 'active' : ''} onClick={() => { setPage('all'); window.scrollTo({ top: 0 }); }}>
          <IconLockers /> ตู้ทั้งหมด
        </button>
        <button
          className={page === 'mine' ? 'active' : ''}
          disabled={!currentUser}
          onClick={() => { setPage('mine'); window.scrollTo({ top: 0 }); }}
        >
          <IconTicket /> ตู้ของฉัน
        </button>
        <button
          className={page === 'history' ? 'active' : ''}
          disabled={!currentUser}
          onClick={() => { setPage('history'); window.scrollTo({ top: 0 }); }}
        >
          <IconHistory /> ประวัติ
        </button>
      </nav>

      {/* Modal: สแกน QR เพื่อชำระเงิน (จำลอง) */}
      <div className={`overlay ${paymentOverlay ? 'show' : ''}`}>
        <div className="modal">
          <h3>สแกนเพื่อชำระเงิน</h3>
          <p>
            ตู้หมายเลข <b>{paymentSession?.locker_number ?? '–'}</b> · ขนาด{SIZE_LABEL[paymentSession?.locker_size] || paymentSession?.locker_size}
            {' '}— QR นี้จะไม่ซ้ำกับครั้งก่อนแม้ราคาจะเท่ากัน
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
            <div style={{ background: '#fff', padding: 10, borderRadius: 10, border: '1px solid var(--line)' }}>
              {paymentSession && <QRCodeSVG value={paymentSession.qr_payload} size={180} />}
            </div>
          </div>
          <div className="info-row"><span>จำนวนเงิน</span><b style={{ color: 'var(--gold)', fontSize: 16 }}>{paymentSession?.amount ?? '–'} บาท</b></div>
          <div className="info-row"><span>เริ่มใช้งาน</span><b>{paymentSession?.start_time ? formatDateTime(paymentSession.start_time) : 'ตอนนี้'}</b></div>
          <div className="info-row"><span>ระยะเวลา</span><b>{paymentSession?.planned_minutes ? formatMinutes(paymentSession.planned_minutes) : 'ไม่ระบุ'}</b></div>
          <div className="info-row"><span>รหัสอ้างอิง</span><b style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5 }}>{paymentSession?.ref_code ?? '–'}</b></div>
          <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
            * QR จำลองสำหรับสาธิตระบบเท่านั้น ไม่ใช่ QR ชำระเงินจริง
          </p>
          {paymentMsg && <div className={`msg ${paymentMsg.type}`}>{paymentMsg.text}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={handlePaymentCancel}>ยกเลิก</button>
            <button className="btn primary" disabled={paymentBusy} onClick={handlePaymentConfirm}>
              {paymentBusy ? 'กำลังตรวจสอบ...' : 'ฉันชำระเงินแล้ว'}
            </button>
          </div>
        </div>
      </div>

      {/* Modal: แสดงรหัส PIN หลังจองสำเร็จ */}
      <div className={`overlay ${pinResultOverlay ? 'show' : ''}`}>
        <div className="modal">
          <h3>จองตู้สำเร็จ</h3>
          <p>จำรหัสนี้ไว้ให้ดี ใช้สำหรับเปิด-ปิดตู้ของคุณ</p>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <span className="pin-tag" style={{ fontSize: 20, padding: '10px 20px' }}>{pinResultCode}</span>
          </div>
          {pinResultStart && (
            <div className="info-row"><span>เริ่มใช้งาน</span><b>{formatDateTime(pinResultStart)}</b></div>
          )}
          {pinResultEnd && (
            <div className="info-row"><span>ถึง</span><b>{formatDateTime(pinResultEnd)}</b></div>
          )}
          {pinResultMinutes && (
            <div className="info-row"><span>ระยะเวลา</span><b>{formatMinutes(pinResultMinutes)}</b></div>
          )}
          {paidAmount != null && (
            <div className="info-row"><span>ชำระแล้ว</span><b style={{ color: 'var(--gold)' }}>{paidAmount} บาท</b></div>
          )}
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setPinResultOverlay(false)}>รับทราบ</button>
          </div>
        </div>
      </div>

      {/* Modal: กรอกรหัส PIN เพื่อเปิด/คืนตู้ */}
      <div className={`overlay ${pinInputOverlay ? 'show' : ''}`}>
        <div className="modal">
          <h3>{pendingAction?.action === 'open' ? 'กรอกรหัส PIN เพื่อปลดล็อก' : 'กรอกรหัส PIN เพื่อคืนตู้'}</h3>
          <p>
            {pendingAction?.action === 'open'
              ? 'ยืนยันรหัสเพื่อเปิดตู้ฝากของ (ระบบจะบันทึก log ว่ามีการเปิดตู้)'
              : 'ยืนยันรหัสเพื่อคืนตู้ — ตู้จะกลับมาว่างให้คนอื่นจองต่อได้ทันที'}
          </p>
          <input
            type="text"
            placeholder="เช่น 123456"
            maxLength={6}
            value={pinInputValue}
            onChange={(e) => setPinInputValue(e.target.value)}
          />
          {pinInputMsg && <div className={`msg ${pinInputMsg.type}`}>{pinInputMsg.text}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={handlePinInputCancel}>ยกเลิก</button>
            <button className="btn primary" disabled={pinInputBusy} onClick={handlePinInputConfirm}>
              {pinInputBusy ? 'กำลังดำเนินการ...' : 'ยืนยัน'}
            </button>
          </div>
        </div>
      </div>

      {/* Modal: แสดงผลหลังคืนตู้ */}
      <div className={`overlay ${returnResultOverlay ? 'show' : ''}`}>
        <div className="modal">
          <h3>{returnResult.title}</h3>
          <p>{returnResult.desc}</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setReturnResultOverlay(false)}>รับทราบ</button>
          </div>
        </div>
      </div>

      <RelocationModal
        state={relocation}
        onAccept={handleRelocAccept}
        onSelect={(id) => patchRelocation({ selectedId: id })}
        onConfirmMove={handleRelocConfirmMove}
        onAskDecline={() => patchRelocation({ step: 'confirmDecline', msg: null })}
        onBackToAsk={() => patchRelocation({ step: 'ask', msg: null })}
        onConfirmDecline={handleRelocConfirmDecline}
        onReload={() => loadRelocationOptions(relocation.booking.booking_id)}
        onSnooze={handleRelocSnooze}
        onClose={() => setRelocation(null)}
      />
    </div>
  );
}
