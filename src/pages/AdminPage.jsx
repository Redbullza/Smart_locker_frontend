import { useEffect, useState, useCallback, useMemo } from 'react';
import { getJSON, putJSON } from '../api';

const ACTION_LABEL = { book: 'จองตู้', open: 'ปลดล็อกตู้', close: 'คืนตู้', wrong_pin: 'กรอก PIN ผิด', admin_release: 'Admin ปล่อยตู้' };
const LOCKER_STATUS_LABEL = { available: 'ว่าง', unavailable: 'ไม่ว่าง', maintenance: 'ซ่อมบำรุง' };
const USER_STATUS_LABEL = { active: 'ปกติ', suspended: 'ถูกระงับ' };
const ROLE_LABEL = { admin: 'Admin', user: 'User' };
const BOOKING_STATUS_LABEL = { active: 'กำลังใช้งาน', completed: 'คืนแล้ว', cancelled: 'ถูกปล่อย/ยกเลิก' };

const TABS = [
  { key: 'logs', label: 'ประวัติการใช้งาน' },
  { key: 'allbookings', label: 'การจองทั้งหมด' },
  { key: 'users', label: 'จัดการผู้ใช้งาน' },
  { key: 'lockers', label: 'จัดการตู้ล็อกเกอร์' },
  { key: 'reports', label: 'รายงานสรุป' },
];

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('locker_user') || 'null');
  } catch {
    return null;
  }
}

// ---------------- icons (inline, no external deps) ----------------
function IconHome(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}
function IconRefresh(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export default function AdminPage() {
  const currentUser = useMemo(loadStoredUser, []);
  const isAdmin = currentUser && currentUser.role === 'admin';

  const [activeTab, setActiveTab] = useState('logs');

  const [dashboard, setDashboard] = useState({});
  const [updatedAt, setUpdatedAt] = useState('–');

  const [allLogs, setAllLogs] = useState([]);
  const [logsError, setLogsError] = useState(false);
  const [filterAction, setFilterAction] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const [bookings, setBookings] = useState([]);
  const [bookingsError, setBookingsError] = useState(false);

  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState(false);

  const [lockers, setLockers] = useState([]);
  const [lockersError, setLockersError] = useState(false);

  const [reportPeriod, setReportPeriod] = useState('daily');
  const [reports, setReports] = useState([]);
  const [reportsError, setReportsError] = useState(false);

  const loadDashboard = useCallback(async () => {
    const json = await getJSON('/dashboard');
    setDashboard(json.data || {});
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const json = await getJSON('/logs');
      setAllLogs(json.data || []);
      setLogsError(false);
    } catch {
      setLogsError(true);
    }
  }, []);

  const loadAllBookings = useCallback(async () => {
    try {
      const json = await getJSON('/bookings');
      setBookings(json.data || []);
      setBookingsError(false);
    } catch {
      setBookingsError(true);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const json = await getJSON('/users');
      setUsers(json.data || []);
      setUsersError(false);
    } catch {
      setUsersError(true);
    }
  }, []);

  const loadLockers = useCallback(async () => {
    try {
      const json = await getJSON('/lockers');
      setLockers(json.data || []);
      setLockersError(false);
    } catch {
      setLockersError(true);
    }
  }, []);

  const loadReports = useCallback(async (period) => {
    try {
      const json = await getJSON('/reports?period=' + period);
      setReports(json.data || []);
      setReportsError(false);
    } catch {
      setReportsError(true);
    }
  }, []);

  const loadAll = useCallback(() => {
    loadDashboard();
    loadLogs();
    loadAllBookings();
    loadUsers();
    loadLockers();
    loadReports(reportPeriod);
    setUpdatedAt('อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH'));
  }, [loadDashboard, loadLogs, loadAllBookings, loadUsers, loadLockers, loadReports, reportPeriod]);

  useEffect(() => {
    if (!isAdmin) return;
    loadAll();
    const id = setInterval(loadAll, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    loadReports(reportPeriod);
  }, [reportPeriod, isAdmin, loadReports]);

  async function releaseBooking(booking_id) {
    if (!confirm('ยืนยันปล่อยตู้นี้? ตู้จะกลับเป็นสถานะว่างทันที')) return;
    await putJSON(`/bookings/${booking_id}/release`);
    loadAllBookings();
    loadDashboard();
  }

  async function toggleUserStatus(user_id, status) {
    await putJSON(`/users/${user_id}/status`, { status });
    loadUsers();
  }

  async function changeLocker(locker_id, field, value) {
    await putJSON(`/lockers/${locker_id}`, { [field]: value });
    loadLockers();
    loadDashboard();
  }

  const filteredLogs = useMemo(() => {
    let rows = allLogs;
    if (filterAction) rows = rows.filter((r) => r.action === filterAction);
    const search = filterSearch.trim().toLowerCase();
    if (search) {
      rows = rows.filter(
        (r) =>
          (r.locker_number || '').toLowerCase().includes(search) ||
          (r.firstname || '').toLowerCase().includes(search) ||
          (r.lastname || '').toLowerCase().includes(search)
      );
    }
    return rows;
  }, [allLogs, filterAction, filterSearch]);

  if (!isAdmin) {
    return (
      <div className="wrap admin">
        <header>
          <div>
            <p className="eyebrow">Prince of Songkla University · Faculty of Liberal Arts</p>
            <h1>แผงควบคุมผู้ดูแลระบบ</h1>
            <p className="subtitle">จัดการผู้ใช้งาน / ตู้ล็อกเกอร์ / ประวัติ / รายงาน — ฝากได้ไม่จำกัดเวลา ไม่มีค่าปรับ</p>
          </div>
          <div className="top-links"><a href="/">← กลับหน้าหลัก</a></div>
        </header>
        <div className="guard-panel">
          <h2>ต้องเข้าสู่ระบบด้วยบัญชี Admin</h2>
          <p>บัญชีของคุณไม่มีสิทธิ์เข้าถึงหน้านี้ กรุณาเข้าสู่ระบบด้วยบัญชีที่มี role เป็น admin</p>
          <a className="btn primary" href="/">กลับไปหน้าหลักเพื่อเข้าสู่ระบบ</a>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap admin">
      <header>
        <div>
          <p className="eyebrow">Prince of Songkla University · Faculty of Liberal Arts</p>
          <h1>แผงควบคุมผู้ดูแลระบบ</h1>
          <p className="subtitle">จัดการผู้ใช้งาน / ตู้ล็อกเกอร์ / ประวัติ / รายงาน — ฝากได้ไม่จำกัดเวลา ไม่มีค่าปรับ</p>
        </div>
        <div className="top-links"><a href="/">← กลับหน้าหลัก</a></div>
      </header>

      <div className="stats admin">
        <div className="stat"><div className="num">{dashboard.total_lockers ?? '0'}</div><div className="label">ตู้ทั้งหมด</div></div>
        <div className="stat ok"><div className="num">{dashboard.available_lockers ?? '0'}</div><div className="label">ว่าง</div></div>
        <div className="stat danger"><div className="num">{dashboard.in_use_lockers ?? '0'}</div><div className="label">ไม่ว่าง</div></div>
        <div className="stat grey"><div className="num">{dashboard.maintenance_lockers ?? '0'}</div><div className="label">ซ่อมบำรุง</div></div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== แท็บ: ประวัติการใช้งาน ===== */}
      <div className={`tab-panel ${activeTab === 'logs' ? 'active' : ''}`}>
        <div className="filter-row">
          <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
            <option value="">ทุกประเภทเหตุการณ์</option>
            <option value="book">จองตู้</option>
            <option value="open">เปิดตู้</option>
            <option value="close">คืนตู้</option>
            <option value="wrong_pin">กรอก PIN ผิด</option>
            <option value="admin_release">Admin ปล่อยตู้</option>
          </select>
          <input
            type="text"
            placeholder="ค้นหาชื่อผู้ใช้หรือหมายเลขตู้..."
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>เวลา</th><th>ตู้</th><th>ผู้ใช้งาน</th><th>เหตุการณ์</th></tr></thead>
            <tbody>
              {logsError ? (
                <tr><td colSpan={4} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : filteredLogs.length === 0 ? (
                <tr><td colSpan={4} className="empty">ไม่พบข้อมูล</td></tr>
              ) : (
                filteredLogs.map((r, i) => (
                  <tr key={i}>
                    <td data-label="เวลา">{new Date(r.timestamp).toLocaleString('th-TH')}</td>
                    <td data-label="ตู้">{r.locker_number}</td>
                    <td data-label="ผู้ใช้งาน">{r.firstname} {r.lastname}</td>
                    <td data-label="เหตุการณ์"><span className={`badge ${r.action}`}>{ACTION_LABEL[r.action] || r.action}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== แท็บ: การจองทั้งหมด ===== */}
      <div className={`tab-panel ${activeTab === 'allbookings' ? 'active' : ''}`}>
        <div className="section-label"><span>การจองทั้งหมด — ปล่อยตู้ที่ไม่มีคนมาใช้งานได้ที่นี่</span><div className="rule" /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ตู้</th><th>ผู้จอง</th><th>ตั้งใจฝาก (ชม.)</th><th>สถานะการจอง</th><th>จัดการ</th></tr></thead>
            <tbody>
              {bookingsError ? (
                <tr><td colSpan={5} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={5} className="empty">ยังไม่มีรายการจอง</td></tr>
              ) : (
                bookings.map((b) => (
                  <tr key={b.booking_id}>
                    <td data-label="ตู้">{b.locker_number}</td>
                    <td data-label="ผู้จอง">{b.firstname} {b.lastname}</td>
                    <td data-label="ตั้งใจฝาก (ชม.)">{b.planned_hours ?? '–'}</td>
                    <td data-label="สถานะการจอง"><span className={`badge ${b.status}`}>{BOOKING_STATUS_LABEL[b.status] || b.status}</span></td>
                    <td data-label="จัดการ">
                      {b.status === 'active' ? (
                        <button className="btn warn small" onClick={() => releaseBooking(b.booking_id)}>ปล่อยตู้ (ไม่มาใช้)</button>
                      ) : '–'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== แท็บ: จัดการผู้ใช้งาน ===== */}
      <div className={`tab-panel ${activeTab === 'users' ? 'active' : ''}`}>
        <div className="section-label"><span>ผู้ใช้งานทั้งหมด — ตรวจสอบ/ระงับสิทธิ์</span><div className="rule" /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ชื่อ-นามสกุล</th><th>Username</th><th>บทบาท</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
            <tbody>
              {usersError ? (
                <tr><td colSpan={5} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="empty">ยังไม่มีผู้ใช้งาน</td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u.user_id}>
                    <td data-label="ชื่อ-นามสกุล">{u.firstname} {u.lastname}</td>
                    <td data-label="Username">{u.username}</td>
                    <td data-label="บทบาท"><span className={`badge ${u.role}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
                    <td data-label="สถานะ"><span className={`badge ${u.status}`}>{USER_STATUS_LABEL[u.status] || u.status}</span></td>
                    <td data-label="จัดการ">
                      {u.status === 'active' ? (
                        <button className="btn danger small" onClick={() => toggleUserStatus(u.user_id, 'suspended')}>ระงับสิทธิ์</button>
                      ) : (
                        <button className="btn ok small" onClick={() => toggleUserStatus(u.user_id, 'active')}>คืนสิทธิ์</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== แท็บ: จัดการตู้ล็อกเกอร์ ===== */}
      <div className={`tab-panel ${activeTab === 'lockers' ? 'active' : ''}`}>
        <div className="section-label"><span>ตู้ล็อกเกอร์ทั้งหมด — เปิด/ปิด/ซ่อมบำรุง/ขนาด</span><div className="rule" /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>หมายเลขตู้</th><th>ตำแหน่ง</th><th>ขนาด</th><th>สถานะ</th><th>เปลี่ยนสถานะ</th></tr></thead>
            <tbody>
              {lockersError ? (
                <tr><td colSpan={5} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : lockers.length === 0 ? (
                <tr><td colSpan={5} className="empty">ยังไม่มีตู้ล็อกเกอร์</td></tr>
              ) : (
                lockers.map((l) => (
                  <tr key={l.locker_id}>
                    <td data-label="หมายเลขตู้">{l.locker_number}</td>
                    <td data-label="ตำแหน่ง">{l.location}</td>
                    <td data-label="ขนาด">
                      <select value={l.size} onChange={(e) => changeLocker(l.locker_id, 'size', e.target.value)}>
                        <option value="small">เล็ก</option>
                        <option value="medium">กลาง</option>
                        <option value="large">ใหญ่</option>
                      </select>
                    </td>
                    <td data-label="สถานะ"><span className={`badge ${l.status}`}>{LOCKER_STATUS_LABEL[l.status] || l.status}</span></td>
                    <td data-label="เปลี่ยนสถานะ">
                      <select value={l.status} onChange={(e) => changeLocker(l.locker_id, 'status', e.target.value)}>
                        <option value="available">ว่าง</option>
                        <option value="unavailable">ไม่ว่าง</option>
                        <option value="maintenance">ซ่อมบำรุง</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== แท็บ: รายงานสรุป ===== */}
      <div className={`tab-panel ${activeTab === 'reports' ? 'active' : ''}`}>
        <div className="section-label"><span>รายงานการใช้งาน</span><div className="rule" /></div>
        <div className="filter-row">
          <select value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value)}>
            <option value="daily">รายวัน</option>
            <option value="monthly">รายเดือน</option>
            <option value="yearly">รายปี</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{reportPeriod === 'yearly' ? 'ปี' : reportPeriod === 'monthly' ? 'เดือน' : 'วันที่'}</th>
                <th>จองตู้</th><th>เปิดตู้</th><th>คืนตู้</th><th>PIN ผิด</th>
                <th>รวมเหตุการณ์</th><th>อัตราการใช้ตู้</th>
              </tr>
            </thead>
            <tbody>
              {reportsError ? (
                <tr><td colSpan={7} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : reports.length === 0 ? (
                <tr><td colSpan={7} className="empty">ยังไม่มีข้อมูล</td></tr>
              ) : (
                reports.map((r, i) => (
                  <tr key={i}>
                    <td data-label={reportPeriod === 'yearly' ? 'ปี' : reportPeriod === 'monthly' ? 'เดือน' : 'วันที่'}>{r.period_label}</td>
                    <td data-label="จองตู้">{r.bookings}</td>
                    <td data-label="เปิดตู้">{r.opens}</td>
                    <td data-label="คืนตู้">{r.closes}</td>
                    <td data-label="PIN ผิด">{r.wrong_pins}</td>
                    <td data-label="รวมเหตุการณ์"><b>{r.total_events}</b></td>
                    <td data-label="อัตราการใช้ตู้">{r.utilization_rate}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <footer style={{ marginTop: 24 }}>
        <button className="btn" onClick={loadAll}>รีเฟรชตอนนี้</button>
        <span className="updated">{updatedAt}</span>
      </footer>

      {/* Bottom app nav — mobile only */}
      <nav className="bottom-nav">
        <a href="/"><IconHome /> หน้าหลัก</a>
        <button className="active" onClick={loadAll}><IconRefresh /> รีเฟรช</button>
      </nav>
    </div>
  );
}
