import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { supabase } from '../services/supabaseClient';

const formatRupees = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;

const authConfig = async () => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Please sign in as an admin first.');
  return { headers: { Authorization: `Bearer ${token}` } };
};

const AdminPayments = ({ onNavigate }) => {
  const [transfers, setTransfers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      const config = await authConfig();
      const [failed, all] = await Promise.all([
        api.get('/admin/payments/failed-transfers', config),
        api.get('/admin/payments', config),
      ]);
      setTransfers(failed.data?.transfers || []);
      setPayments(all.data?.payments || []);
    } catch (error) {
      setMessage(error?.response?.data?.message || error.message || 'Failed to load payments.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refund = async (payment) => {
    const remaining = payment.amount - payment.refunded_amount;
    const input = window.prompt(`Refund amount in Rs. (max ${remaining.toFixed(2)}). Leave as is for a full refund.`, remaining.toFixed(2));
    if (input === null) return;
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0) { setMessage('Enter a valid amount.'); return; }
    setBusyId(payment.payment_id);
    try {
      const result = await api.post('/admin/payments/refund',
        { payment_id: payment.payment_id, amount }, await authConfig());
      setMessage(result.data?.fully_refunded ? 'Refund complete.' : 'Partial refund recorded.');
      await load();
    } catch (error) {
      setMessage(error?.response?.data?.message || error.message || 'Refund failed.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Payments</h1>
      {message ? <p role="status" className="mb-3">{message}</p> : null}

      <h2 className="text-xl font-semibold mb-2">Failed transfers</h2>
      {transfers.length === 0 ? <p className="mb-4">No failed transfers.</p> : (
        <ul className="mb-4">
          {transfers.map((item) => (
            <li key={item.id} className="mb-2">
              {item.payment_id} / {item.order_id} / {item.transfer_id} - {formatRupees(item.amount)}
              {item.reason ? ` - ${item.reason}` : ''}
              {item.purchase_hold ? ' (purchase held)' : ''}
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-xl font-semibold mb-2">Payments</h2>
      {payments.length === 0 ? <p>No payments yet.</p> : (
        <ul>
          {payments.map((item) => {
            const done = item.status === 'refunded' || item.amount - item.refunded_amount <= 0;
            return (
              <li key={item.payment_id} className="mb-2">
                {item.payment_id} - {formatRupees(item.amount)} - {item.status}
                {item.refunded_amount ? ` (refunded ${formatRupees(item.refunded_amount)})` : ''}
                {item.refund?.status === 'failed' ? ' - last refund failed' : ''}{' '}
                {done ? null : (
                  <button type="button" disabled={busyId === item.payment_id} onClick={() => void refund(item)}
                    className="px-2 py-1 bg-blue-500 text-white rounded">
                    Refund
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" onClick={() => onNavigate('home')} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
        Back to Home
      </button>
    </div>
  );
};

export default AdminPayments;
