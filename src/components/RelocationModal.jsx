
import {formatClock, formatDateTime } from '../utils/format';

const SIZE_LABEL = { small: 'เล็ก', medium: 'กลาง', large: 'ใหญ่' };

// แจ้งผู้ใช้คนถัดไป เมื่อถึงเวลาจองของตัวเองแล้วแต่ผู้ใช้คนก่อนยังไม่เอาของออก (เลยเวลาที่กำหนด)
// ask (ถามว่าจะใช้ตู้อื่นไหม) -> pick (เลือกตู้ใหม่) | confirmDecline (นำการจองออก) -> done
export default function RelocationModal({
  state,
  onAccept,
  onSelect,
  onConfirmMove,
  onAskDecline,
  onBackToAsk,
  onConfirmDecline,
  onReload,
  onSnooze,
  onClose,
}) {
  if (!state) return null;
  const { booking, step, options, loading, busy, msg, selectedId, result } = state;

  const notStartedYet = new Date(booking.start_time).getTime() > Date.now(); // แจ้งล่วงหน้า ยังไม่ถึงเวลาเริ่มของเรา

  return (
    <div className="overlay show" role="dialog" aria-modal="true" aria-labelledby="relocation-title">
      <div className="modal relocation-modal">
        {step === 'ask' && (
          <>
            <div className="reloc-icon" aria-hidden="true">!</div>
            <h3 id="relocation-title">ตู้ {booking.locker_number} ยังมีของผู้ใช้ก่อนหน้า</h3>
            <p>

              {notStartedYet
                ? `การจองของคุณจะเริ่ม ${formatDateTime(booking.start_time)} แต่ผู้ใช้คนก่อนยังไม่ได้นำของออกและเลยเวลาที่กำหนดไว้แล้ว อาจใช้ตู้นี้ไม่ได้ตามเวลา `
                : 'ถึงเวลาจองของคุณแล้ว แต่ผู้ใช้คนก่อนยังไม่ได้นำของออกและเลยเวลาที่กำหนดไว้ ตอนนี้จึงยังใช้ตู้นี้ไม่ได้ '}
              ต้องการใช้ตู้อื่นแทนหรือไม่?

              ถึงเวลาจองของคุณแล้ว แต่ผู้ใช้คนก่อนยังไม่ได้นำของออกและเลยเวลาที่กำหนดไว้
              ตอนนี้จึงยังใช้ตู้นี้ไม่ได้ ต้องการใช้ตู้อื่นแทนหรือไม่?

            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onAskDecline}>ไม่ต้องการ</button>
              <button className="btn primary" onClick={onAccept}>ใช้ตู้อื่น</button>
            </div>
          </>
        )}

        {step === 'pick' && (
          <>
            <h3 id="relocation-title">เลือกตู้ใหม่</h3>
            <p>
              แสดงเฉพาะตู้ที่ยังไม่มีผู้ใช้ ขนาดเท่าเดิมหรือเล็กกว่า (ไม่ต้องจ่ายเพิ่ม) · ระยะเวลาและ PIN เดิม · {notStartedYet ? 'เริ่มตามเวลาจองเดิม' : 'เริ่มนับตั้งแต่ตอนนี้'}
              แสดงเฉพาะตู้ที่ยังไม่มีผู้ใช้ ขนาดเท่าเดิมหรือเล็กกว่า (ไม่ต้องจ่ายเพิ่ม) · ระยะเวลาและ PIN เดิม · เริ่มนับตั้งแต่ตอนนี้
            </p>
            {loading ? (
              <div className="empty">กำลังค้นหาตู้ที่ว่าง...</div>
            ) : options.length === 0 ? (
              <div className="empty">ขณะนี้ไม่มีตู้ว่างให้เปลี่ยน</div>
            ) : (
              <div className="reloc-options" role="radiogroup" aria-label="ตู้ที่ว่าง">
                {options.map((o) => (
                  <button
                    type="button"
                    key={o.locker_id}
                    role="radio"
                    aria-checked={selectedId === o.locker_id}
                    className={`reloc-option ${selectedId === o.locker_id ? 'selected' : ''}`}
                    onClick={() => onSelect(o.locker_id)}
                  >
                    <b>{o.locker_number}</b>
                    <span>ขนาด{SIZE_LABEL[o.size] || o.size}</span>
                    <small>{o.location}</small>
                  </button>
                ))}
              </div>
            )}
            {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={onBackToAsk} disabled={busy}>ย้อนกลับ</button>
              {options.length === 0 && !loading ? (
                <button className="btn primary" onClick={onReload}>ค้นหาอีกครั้ง</button>
              ) : (
                <button className="btn primary" disabled={busy || loading || !selectedId} onClick={onConfirmMove}>
                  {busy ? 'กำลังย้าย...' : 'ยืนยันใช้ตู้นี้'}
                </button>
              )}
            </div>
            {options.length === 0 && !loading && (
              <div className="reloc-footer">
                <button className="btn-link-small" onClick={onSnooze}>รอตู้เดิมก่อน (ถามใหม่ภายหลัง)</button>
                <button className="btn-link-small" onClick={onAskDecline}>ยกเลิกการจอง</button>
              </div>
            )}
          </>
        )}

        {step === 'confirmDecline' && (
          <>
            <h3 id="relocation-title">ยืนยันนำการจองออก?</h3>
            <p>
              การจองตู้ {booking.locker_number} ของคุณจะถูกยกเลิก และระบบจะไม่ถามเรื่องการเปลี่ยนตู้อีก
              (ระบบชำระเงินตอนนี้เป็นการจำลอง จึงยังไม่มีการคืนเงินจริง)
            </p>
            {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={onBackToAsk} disabled={busy}>ย้อนกลับ</button>
              <button className="btn danger" onClick={onConfirmDecline} disabled={busy}>
                {busy ? 'กำลังดำเนินการ...' : 'ยกเลิกการจอง'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <>
            <h3 id="relocation-title">{result.kind === 'moved' ? 'ย้ายตู้สำเร็จ' : 'นำการจองออกแล้ว'}</h3>
            {result.kind === 'moved' ? (
              <>
                <p>ตอนนี้คุณใช้ตู้ <b>{result.locker_number}</b> ได้เลย ใช้ PIN เดิมของการจองนี้</p>
                <div className="info-row"><span>ตู้ใหม่</span><b>{result.locker_number}</b></div>
                <div className="info-row"><span>PIN</span><b>{result.pin_code}</b></div>
                <div className="info-row"><span>ใช้ได้ถึง</span><b>{formatClock(result.end_time)}</b></div>
              </>
            ) : (
              <p>{result.message}</p>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>รับทราบ</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
