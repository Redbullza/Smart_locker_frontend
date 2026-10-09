import { useCallback, useEffect, useState } from 'react';
import { getJSON } from '../api';
import { formatMinutes, formatBaht, formatDateTimeFull } from '../utils/format';

const SIZE_LABEL = { small: 'เล็ก', medium: 'กลาง', large: 'ใหญ่' };
const STATUS_LABEL = { completed: 'คืนตู้แล้ว', cancelled: 'ยกเลิก' };
const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'completed', label: 'คืนตู้แล้ว' },
  { key: 'cancelled', label: 'ยกเลิก' },
];

// ประวัติการใช้งานของผู้ใช้ที่ล็อกอินอยู่ (เห็นเฉพาะของตัวเอง)
export default function UserHistory({ user, active }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | error
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const json = await getJSON('/my-history?user_id=' + user.user_id);
      if (!json.success) throw new Error(json.message);
      setRows(json.data || []);
      setSummary(json.summary);
      setState('ok');
    } catch {
      setState('error');
    }
  }, [user.user_id]);

  // โหลดใหม่ทุกครั้งที่เปิดแท็บนี้
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const visible = rows.filter((r) => filter === 'all' || r.status === filter);

  return (
    <div>
      <div className="section-label"><span>ประวัติการใช้งานของฉัน</span><div className="rule" /></div>

      {summary && (
        <div className="stats mine-stats three">
          <div className="stat"><div className="num">{summary.completed_count}</div><div className="label">ครั้งที่ใช้งาน</div></div>
          <div className="stat"><div className="num">{summary.total_spent.toLocaleString('th-TH')}</div><div className="label">ค่าบริการรวม (บาท)</div></div>
          <div className="stat"><div className="num small">{formatMinutes(summary.total_minutes)}</div><div className="label">เวลาใช้รวม</div></div>
        </div>
      )}

      <div className="chip-filter" role="group" aria-label="กรองประวัติ">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            className={`chip ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {state === 'loading' ? (
        <div className="empty">กำลังโหลดประวัติ...</div>
      ) : state === 'error' ? (
        <div className="empty">โหลดประวัติไม่สำเร็จ <button className="btn-link-small" onClick={load}>ลองใหม่</button></div>
      ) : visible.length === 0 ? (
        <div className="empty">ยังไม่มีประวัติการใช้งานในหมวดนี้</div>
      ) : (
        visible.map((r) => (
          <div className="booking history-item" key={r.booking_id}>
            <div className="info">
              ตู้ <b>{r.locker_number}</b>
              <span className="pin-tag state">ขนาด{SIZE_LABEL[r.size] || r.size}</span>
              <span className={`pin-tag state ${r.status === 'completed' ? 'done' : 'cancel'}`}>{STATUS_LABEL[r.status] || r.status}</span>
              <br />
              <span style={{ color: 'var(--muted)' }}>{r.location}</span><br />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                {formatDateTimeFull(r.start_time)} → {formatDateTimeFull(r.completed_at || r.end_time)}
                {r.status === 'completed' && r.actual_minutes != null && ` · ใช้จริง ${formatMinutes(r.actual_minutes)}`}
                {r.planned_minutes ? ` · จอง ${formatMinutes(r.planned_minutes)}` : ''}
              </span>
            </div>
            <div className="history-amount">
              <b className={r.status === 'cancelled' ? 'struck' : ''}>{formatBaht(r.amount)}</b>
              {r.status === 'cancelled' && <small>ไม่คิดค่าบริการ</small>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
