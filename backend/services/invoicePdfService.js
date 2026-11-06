/* global process, Buffer */
import PDFDocument from 'pdfkit';
import { paymentSupabase } from '../config/supabase.js';

const BUCKET = process.env.INVOICE_BUCKET || 'product-invoices';
const SIGNED_URL_TTL_SECONDS = 300;

export const invoicePath = (invoiceId) => `invoices/${invoiceId}.pdf`;

const money = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;

const renderPdf = (invoice) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  doc.fontSize(20).text(invoice.trust_name || 'Invoice', { align: 'left' });
  doc.moveDown(0.5).fontSize(10)
    .text(`Invoice No: ${invoice.invoice_number}`)
    .text(`Invoice Date: ${invoice.invoice_date || ''}`)
    .text(`Status: ${invoice.status}`);
  if (invoice.member_name) doc.text(`Billed to: ${invoice.member_name}`);
  if (invoice.transaction_id) doc.text(`Payment Ref: ${invoice.transaction_id}`);
  doc.moveDown();
  if (invoice.product_name) {
    doc.fontSize(12).text(`${invoice.product_name}  x ${invoice.quantity ?? 1}`);
    doc.moveDown(0.5);
  }
  doc.fontSize(11)
    .text(`Subtotal: ${money(invoice.subtotal)}`)
    .text(`Discount: ${money(invoice.discount_amount)}`)
    .text(`Tax: ${money(invoice.tax_amount)}`)
    .text(`Transport: ${money(invoice.transport_fee)}`)
    .fontSize(13).text(`Total: ${money(invoice.total_amount)}`);
  doc.end();
});

const loadInvoice = async (invoiceId) => {
  const { data, error } = await paymentSupabase.from('product_invoices')
    .select('id, invoice_number, invoice_date, subtotal, discount_amount, tax_amount, transport_fee, total_amount, status, purchase_id, product_purchases:purchase_id(quantity, member_id, trust_id, product_price:product_price_id(product_catalog:product_id(product_name)))')
    .eq('id', invoiceId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const purchase = data.product_purchases || {};
  const [trust, member, payment] = await Promise.all([
    paymentSupabase.from('Trust').select('name').eq('id', purchase.trust_id).maybeSingle(),
    paymentSupabase.from('Members').select('Name').eq('members_id', purchase.member_id).maybeSingle(),
    paymentSupabase.from('product_payments').select('transaction_id').eq('invoice_id', invoiceId)
      .eq('status', 'success').limit(1).maybeSingle(),
  ]);
  return {
    ...data, quantity: purchase.quantity,
    product_name: purchase.product_price?.product_catalog?.product_name || null,
    trust_name: trust.data?.name || null, member_name: member.data?.Name || null,
    transaction_id: payment.data?.transaction_id || null,
  };
};

const ensureBucket = async () => {
  const { error } = await paymentSupabase.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists|duplicate/i.test(error.message || '')) throw error;
};

/** Build the PDF and store it privately at invoices/<invoice_id>.pdf. */
export const generateAndStoreInvoicePdf = async (invoiceId) => {
  const invoice = await loadInvoice(invoiceId);
  if (!invoice) return null;
  const pdf = await renderPdf(invoice);
  const upload = () => paymentSupabase.storage.from(BUCKET)
    .upload(invoicePath(invoiceId), pdf, { contentType: 'application/pdf', upsert: true });
  let { error } = await upload();
  if (error && /bucket not found/i.test(error.message || '')) {
    await ensureBucket();
    ({ error } = await upload());
  }
  if (error) throw error;
  return invoicePath(invoiceId);
};

/** Short-lived signed URL; builds the PDF first if it was never stored. */
export const getInvoiceSignedUrl = async (invoiceId) => {
  const sign = () => paymentSupabase.storage.from(BUCKET)
    .createSignedUrl(invoicePath(invoiceId), SIGNED_URL_TTL_SECONDS);
  let { data, error } = await sign();
  if (error || !data?.signedUrl) {
    if (!(await generateAndStoreInvoicePdf(invoiceId))) return null;
    ({ data, error } = await sign());
  }
  if (error) throw error;
  return data.signedUrl;
};
