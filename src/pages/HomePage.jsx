import { useEffect, useRef, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getJSON, postJSON, request } from '../api';

const SIZE_LABEL = { small: 'เล็ก', medium: 'กลาง', large: 'ใหญ่' };
const STATUS_LABEL = { available: 'ว่าง', unavailable: 'ไม่ว่าง', maintenance: 'ซ่อมบำรุง' };

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

  // ---------------- booking / QR payment flow ----------------
  const [pendingBooking, setPendingBooking] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [qrOverlay, setQrOverlay] = useState(false);
  const [qrInfo, setQrInfo] = useState(null); // { locker_number, locker_size, amount, ref_code, qr_payload }
  const [qrMsg, setQrMsg] = useState(null);
  const [qrConfirming, setQrConfirming] = useState(false);

  // ---------------- pin result (after payment) ----------------
  const [pinResultOverlay, setPinResultOverlay] = useState(false);
  const [pinResultCode, setPinResultCode] = useState('------');

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

  // ---------------- booking / QR payment ----------------
  async function openBookingConfirm(locker) {
    if (!currentUser) return;
    setPendingBooking(locker);

    try {
      const res = await postJSON('/payment-sessions', {
        user_id: currentUser.user_id,
        locker_id: locker.locker_id,
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

      setPendingSessionId(json.session_id);
      setQrInfo({
        locker_number: json.locker_number,
        locker_size: json.locker_size,
        amount: json.amount,
        ref_code: json.ref_code,
        qr_payload: json.qr_payload,
      });
      setQrMsg(null);
      setQrOverlay(true);
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message + '\nตรวจสอบว่ารัน migration-qr-payment.sql แล้วหรือยัง');
      console.error('Create payment session error:', err);
    }
  }

  async function handleQrCancel() {
    if (pendingSessionId) {
      request(`/payment-sessions/${pendingSessionId}/cancel`, { method: 'PUT' }).catch(() => {});
    }
    setQrOverlay(false);
    setPendingSessionId(null);
    setPendingBooking(null);
  }

  async function handleQrConfirm() {
    if (!pendingSessionId) return;
    setQrConfirming(true);
    setQrMsg(null);

    try {
      const res = await request(`/payment-sessions/${pendingSessionId}/confirm`, { method: 'POST' });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      if (!json.success) {
        setQrMsg({ type: 'error', text: json.message });
        return;
      }

      setQrOverlay(false);
      setPendingSessionId(null);
      setPinResultCode(json.pin_code);
      setPinResultOverlay(true);
      loadLockers();
      loadMyBookings();
    } catch (err) {
      setQrMsg({
        type: 'error',
        text: `เกิดข้อผิดพลาด: ${err.message} — ตรวจสอบว่ารัน migration-qr-payment.sql ครบแล้วหรือยัง`,
      });
      console.error('Confirm payment error:', err);
    } finally {
      setQrConfirming(false);
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
              <div className="price">{l.price} บาท / 2 ชม.</div>
              <span className="pill">{STATUS_LABEL[l.status] || l.status}</span>
              {l.status === 'available' ? (
                <button
                  className="btn primary"
                  disabled={!currentUser}
                  onClick={() =>
                    openBookingConfirm({
                      locker_id: l.locker_id,
                      locker_number: l.locker_number,
                      size: l.size,
                      price: l.price,
                    })
                  }
                >
                  {currentUser ? 'จองตู้นี้' : 'เข้าสู่ระบบก่อน'}
                </button>
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
                <span style={{ color: 'var(--muted)' }}>{b.location} · จ่ายแล้ว {b.price} บาท</span><br />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  ฝากมาแล้ว {formatDuration(b.created_at)} · ไม่จำกัดเวลา ไม่มีค่าปรับ
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

      {/* Modal: สแกน QR เพื่อชำระเงิน (จำลอง) */}
      <div className={`overlay ${qrOverlay ? 'show' : ''}`}>
        <div className="modal">
          <h3>สแกนเพื่อชำระเงิน</h3>
          <p>
            ตู้หมายเลข <b>{qrInfo?.locker_number ?? '–'}</b> · ขนาด{SIZE_LABEL[qrInfo?.locker_size] || qrInfo?.locker_size || '–'} — QR นี้จะไม่ซ้ำกับครั้งก่อนแม้ราคาจะเท่ากัน
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
            <div style={{ background: '#fff', padding: 10, borderRadius: 10, border: '1px solid var(--line)' }}>
              {qrInfo?.qr_payload && <QRCodeSVG value={qrInfo.qr_payload} size={180} />}
            </div>
          </div>
          <div className="info-row"><span>จำนวนเงิน</span><b style={{ color: 'var(--gold)', fontSize: 16 }}>{qrInfo?.amount ?? '–'} บาท</b></div>
          <div className="info-row"><span>รหัสอ้างอิง</span><b style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5 }}>{qrInfo?.ref_code ?? '–'}</b></div>
          <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
            * QR จำลองสำหรับสาธิตระบบเท่านั้น ไม่ใช่ QR ชำระเงินจริง
          </p>
          {qrMsg && <div className={`msg ${qrMsg.type}`}>{qrMsg.text}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={handleQrCancel}>ยกเลิก</button>
            <button className="btn primary" disabled={qrConfirming} onClick={handleQrConfirm}>
              {qrConfirming ? 'กำลังตรวจสอบ...' : 'ฉันชำระเงินแล้ว'}
            </button>
          </div>
        </div>
      </div>

      {/* Modal: แสดงรหัส PIN หลังจองสำเร็จ */}
      <div className={`overlay ${pinResultOverlay ? 'show' : ''}`}>
        <div className="modal">
          <h3>ชำระเงินสำเร็จ</h3>
          <p>จำรหัสนี้ไว้ให้ดี ใช้สำหรับเปิด-ปิดตู้ของคุณ</p>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <span className="pin-tag" style={{ fontSize: 20, padding: '10px 20px' }}>{pinResultCode}</span>
          </div>
          <div className="info-row"><span>สถานะ</span><b>ฝากได้ไม่จำกัดเวลา</b></div>
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
              : 'ยืนยันรหัสเพื่อคืนตู้ — ถ้าคืนช้ากว่ากำหนด ระบบจะคิดค่าปรับให้อัตโนมัติ'}
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

      {/* Modal: แสดงผลหลังคืนตู้ (ค่าปรับถ้ามี) */}
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
