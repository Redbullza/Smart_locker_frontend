import { useEffect, useRef, useState, useCallback } from 'react';
import { getJSON, postJSON, request } from '../api';

const SIZE_LABEL = { small: 'เล็ก', medium: 'กลาง', large: 'ใหญ่' };
const STATUS_LABEL = { available: 'ว่าง', unavailable: 'ไม่ว่าง', maintenance: 'ซ่อมบำรุง' };
const HOURS_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];

function formatDuration(startStr) {
  const start = new Date(startStr.replace(' ', 'T'));
  const ms = Date.now() - start.getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} นาที`;
  return `${hours} ชม. ${minutes} นาที`;
}

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('locker_user') || 'null');
  } catch {
    return null;
  }
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

  // ---------------- booking (จองตรง ไม่มีขั้นตอนชำระเงิน) ----------------
  const [selectedHours, setSelectedHours] = useState({}); // { [locker_id]: hours }
  const [bookingBusyId, setBookingBusyId] = useState(null);

  // ---------------- pin result (หลังจองสำเร็จ) ----------------
  const [pinResultOverlay, setPinResultOverlay] = useState(false);
  const [pinResultCode, setPinResultCode] = useState('------');
  const [pinResultHours, setPinResultHours] = useState(null);

  // ---------------- pin input (open/close locker) ----------------
  const [pendingAction, setPendingAction] = useState(null); // { booking_id, action }
  const [pinInputOverlay, setPinInputOverlay] = useState(false);
  const [pinInputValue, setPinInputValue] = useState('');
  const [pinInputMsg, setPinInputMsg] = useState(null);
  const [pinInputBusy, setPinInputBusy] = useState(false);

  // ---------------- return result ----------------
  const [returnResultOverlay, setReturnResultOverlay] = useState(false);
  const [returnResult, setReturnResult] = useState({ title: 'คืนตู้สำเร็จ', desc: 'ขอบคุณที่ใช้บริการ' });

  const userRef = useRef(currentUser);
  userRef.current = currentUser;

  // ---------------- data loading ----------------
  const loadLockers = useCallback(async () => {
    try {
      const json = await getJSON('/lockers');
      setLockers(json.data || []);
      setLockersLoaded(true);
      setLockersError(false);
      setUpdatedAt('อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH'));
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
    loadMyBookings();
    if (!currentUser) setMyBookings([]);
  }, [currentUser, loadMyBookings]);

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

  // ---------------- booking (ฟรี ไม่มีขั้นตอนชำระเงิน) ----------------
  function getHoursFor(lockerId) {
    return selectedHours[lockerId] ?? 2;
  }

  function handleHoursChange(lockerId, hours) {
    setSelectedHours((prev) => ({ ...prev, [lockerId]: Number(hours) }));
  }

  async function handleBook(locker) {
    if (!currentUser) return;
    const hours = getHoursFor(locker.locker_id);
    setBookingBusyId(locker.locker_id);

    try {
      const res = await postJSON('/booking', {
        user_id: currentUser.user_id,
        locker_id: locker.locker_id,
        hours,
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

      setPinResultCode(json.pin_code);
      setPinResultHours(json.planned_hours ?? hours);
      setPinResultOverlay(true);
      loadLockers();
      loadMyBookings();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
      console.error('Booking error:', err);
    } finally {
      setBookingBusyId(null);
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

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      if (!json.success) {
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

  // ---------------- derived stats ----------------
  const statTotal = lockers.length;
  const statAvailable = lockers.filter((l) => l.status === 'available').length;
  const statUnavailable = lockers.filter((l) => l.status === 'unavailable').length;

  return (
    <div className="wrap">
      <header>
        <div>
          <p className="eyebrow">Prince of Songkla University · Faculty of Liberal Arts</p>
          <h1>ระบบตู้รับฝากของอัจฉริยะ</h1>
          <p className="subtitle">จุดบริการตู้ล็อกเกอร์ ตึกคณะศิลปศาสตร์ — หน้าทดสอบระบบ</p>
        </div>
        <div className="top-links">
          <a href="/admin">หน้า Admin →</a>
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
            <div className="form-row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={handleSubmit}>
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

      <div className="stats">
        <div className="stat"><div className="num">{statTotal || '–'}</div><div className="label">ตู้ทั้งหมด</div></div>
        <div className="stat ok"><div className="num">{statAvailable || '–'}</div><div className="label">ว่าง</div></div>
        <div className="stat danger"><div className="num">{statUnavailable || '–'}</div><div className="label">ไม่ว่าง</div></div>
      </div>

      <div className="section-label"><span>ผังตู้ล็อกเกอร์ — เลือกขนาดที่ต้องการ</span><div className="rule" /></div>
      <div className="grid">
        {lockersError ? (
          <div className="empty">เชื่อมต่อ API ไม่ได้ ตรวจสอบว่า server กำลังรันอยู่หรือไม่</div>
        ) : !lockersLoaded ? (
          <div className="empty">กำลังโหลดข้อมูลตู้ล็อกเกอร์...</div>
        ) : lockers.length === 0 ? (
          <div className="empty">ยังไม่มีตู้ล็อกเกอร์ในระบบ</div>
        ) : (
          lockers.map((l) => (
            <div className={`locker ${l.status}`} key={l.locker_id}>
              <span className="dot" />
              <div className="number">{l.locker_number}</div>
              <div className="size-tag">ขนาด{SIZE_LABEL[l.size] || l.size}</div>
              <div className="location">{l.location}</div>
              <span className="pill">{STATUS_LABEL[l.status] || l.status}</span>
              {l.status === 'available' ? (
                <>
                  <label className="hours-label" htmlFor={`hours-${l.locker_id}`}>ระยะเวลาที่ตั้งใจฝาก</label>
                  <select
                    id={`hours-${l.locker_id}`}
                    className="hours-select"
                    disabled={!currentUser}
                    value={getHoursFor(l.locker_id)}
                    onChange={(e) => handleHoursChange(l.locker_id, e.target.value)}
                  >
                    {HOURS_OPTIONS.map((h) => (
                      <option key={h} value={h}>{h} ชม.</option>
                    ))}
                  </select>
                  <button
                    className="btn primary"
                    disabled={!currentUser || bookingBusyId === l.locker_id}
                    onClick={() => handleBook(l)}
                  >
                    {!currentUser
                      ? 'เข้าสู่ระบบก่อน'
                      : bookingBusyId === l.locker_id
                      ? 'กำลังจอง...'
                      : 'จองตู้นี้'}
                  </button>
                </>
              ) : l.status === 'maintenance' ? (
                <button className="btn" disabled>ปิดปรับปรุง</button>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="section-label"><span>รายการจองของฉัน</span><div className="rule" /></div>
      <div>
        {!currentUser ? (
          <div className="empty">เข้าสู่ระบบก่อนเพื่อดูรายการจองของคุณ</div>
        ) : myBookings.length === 0 ? (
          <div className="empty">ยังไม่มีรายการจองที่ใช้งานอยู่</div>
        ) : (
          myBookings.map((b) => (
            <div className="booking" key={b.booking_id}>
              <div className="info">
                ตู้ <b>{b.locker_number}</b>
                <span className="pin-tag">PIN: {b.pin_code}</span>
                <br />
                <span style={{ color: 'var(--muted)' }}>{b.location}</span><br />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  ฝากมาแล้ว {formatDuration(b.created_at)}
                  {b.planned_hours ? ` · ตั้งใจฝาก ${b.planned_hours} ชม.` : ''} · ไม่จำกัดเวลา ไม่มีค่าปรับ
                </span>
              </div>
              <div className="actions">
                <button className="btn primary" onClick={() => openPinModal(b.booking_id, 'open')}>ปลดล็อกตู้</button>
                <button className="btn ghost" onClick={() => openPinModal(b.booking_id, 'close')}>คืนตู้ (ว่าง)</button>
              </div>
            </div>
          ))
        )}
      </div>

      <footer>
        <button className="btn ghost" onClick={() => { loadLockers(); loadMyBookings(); }}>รีเฟรชตอนนี้</button>
        <span className="updated">{updatedAt}</span>
      </footer>

      {/* Modal: แสดงรหัส PIN หลังจองสำเร็จ */}
      <div className={`overlay ${pinResultOverlay ? 'show' : ''}`}>
        <div className="modal">
          <h3>จองตู้สำเร็จ</h3>
          <p>จำรหัสนี้ไว้ให้ดี ใช้สำหรับเปิด-ปิดตู้ของคุณ</p>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <span className="pin-tag" style={{ fontSize: 20, padding: '10px 20px' }}>{pinResultCode}</span>
          </div>
          {pinResultHours && (
            <div className="info-row"><span>ตั้งใจฝาก</span><b>{pinResultHours} ชม.</b></div>
          )}
          <div className="info-row"><span>สถานะ</span><b>ฝากได้ไม่จำกัดเวลา ไม่มีค่าใช้จ่าย</b></div>
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
    </div>
  );
}
