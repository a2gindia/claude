// Email delivery via Resend (SPEC §7 alternative; step 6b). Sends the "your plan is
// ready" email carrying the one-tap magic login link. Plain, minimal HTML.
import { Resend } from "resend";

const DEFAULT_FROM = "plans@a2glifestyle.com";

export interface SendPlanReadyInput {
  name: string;
  email: string;
  magicLink: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// For an href attribute: only & and " are structurally significant here.
const escapeAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Send the "plan ready" email with a one-tap login button. Throws on failure. */
export async function sendPlanReady({ name, email, magicLink }: SendPlanReadyInput): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set — cannot send email.");
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  const resend = new Resend(apiKey);

  const subject = `Your A2G diet plan is ready, ${name}`;
  const safeName = escapeHtml(name);
  const href = escapeAttr(magicLink);

  const html = [
    `<p>${safeName},</p>`,
    `<p>Your personalised 1-month diet plan is ready.<br>It&#39;s built around your goal and your diet — not a generic template.</p>`,
    `<p><a href="${href}" style="display:inline-block;padding:12px 20px;background:#111111;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">View your plan →</a></p>`,
    `<p>This link logs you in directly — no password needed.<br>It expires in 24 hours. If it stops working, reply to this email and we&#39;ll resend it.</p>`,
    `<p>— A2G</p>`,
  ].join("\n");

  const text = [
    `${name},`,
    ``,
    `Your personalised 1-month diet plan is ready.`,
    `It's built around your goal and your diet — not a generic template.`,
    ``,
    `View your plan: ${magicLink}`,
    ``,
    `This link logs you in directly — no password needed.`,
    `It expires in 24 hours. If it stops working, reply to this email and we'll resend it.`,
    ``,
    `— A2G`,
  ].join("\n");

  const { data, error } = await resend.emails.send({ from, to: email, subject, html, text });
  if (error) throw new Error(`sendPlanReady failed: ${error.message ?? JSON.stringify(error)}`);
  if (!data?.id) throw new Error("sendPlanReady: Resend returned no message id");
  return { id: data.id };
}

/**
 * Best-effort ops alert email to ALERT_TO (step 8). No-op (and never throws) unless
 * RESEND_API_KEY is set and ALERT_TO looks like an email address.
 */
export async function sendAlertEmail(subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_TO;
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  if (!apiKey || !to || !to.includes("@")) return;
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to, subject: `[A2G plan-service] ${subject}`, text });
  } catch (err) {
    console.warn(`[sendAlertEmail] failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
