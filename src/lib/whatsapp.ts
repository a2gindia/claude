// "Your plan is ready" over WhatsApp via KwikEngage. Reliable delivery (email
// lands in spam). Non-fatal: the plan is already stored + replayable. No-ops
// unless KWIKENGAGE_API_KEY + a phone are present, so it's safe to deploy before
// the WhatsApp template is live.

const SEND_URL = process.env.KWIKENGAGE_SEND_URL || "https://api.kwikengage.ai/send-message/v2";

// KwikEngage wants the number with country code and no "+", e.g. 919876543210.
function toWaNumber(phone: string): string | null {
  let d = (phone || "").replace(/\D/g, "");
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 ? d : null;
}

export async function sendPlanReadyWhatsApp(input: { name: string; phone: string; magicLink: string }): Promise<{ sent: boolean; skipped?: string; messageId?: string }> {
  const apiKey = process.env.KWIKENGAGE_API_KEY?.trim();
  if (!apiKey) return { sent: false, skipped: "KWIKENGAGE_API_KEY not set" };

  const to = toWaNumber(input.phone);
  if (!to) return { sent: false, skipped: "no valid phone" };

  // .trim() guards against a trailing newline in the Render env value (a common
  // paste artifact that makes KwikEngage 404 the template).
  const templateId = (process.env.KWIKENGAGE_PLAN_READY_TEMPLATE_ID || "plan_ready_magic_link").trim();
  const language = (process.env.KWIKENGAGE_PLAN_READY_LANGUAGE || "en").trim();
  const firstName = (input.name || "there").trim().split(/\s+/)[0];

  // Template shape: body has one variable ({{1}} = first name); the login link is a
  // DYNAMIC URL button whose base ends in ...&token_hash={{1}} — so the button
  // variable is just the per-user token hash extracted from the magic link.
  const th = input.magicLink.match(/[?&]token_hash=([^&]+)/);
  const tokenHash = th ? decodeURIComponent(th[1]) : null;

  const components: unknown[] = [{ type: "body", parameters: [{ type: "text", text: firstName }] }];
  if (tokenHash) {
    components.push({ type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: tokenHash }] });
  }

  const body = {
    to,
    channel: "whatsapp",
    content: {
      type: "template",
      template: { template_id: templateId, language, components },
    },
  };

  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify(body),
  });
  const raw = await res.text().catch(() => "");
  console.log(`[whatsapp] KwikEngage HTTP ${res.status} body: ${raw.slice(0, 500)}`);
  if (!res.ok) throw new Error(`KwikEngage ${res.status}: ${raw.slice(0, 300)}`);

  let json: { success?: boolean; messageId?: string; data?: { messageId?: string }; error?: string } = {};
  try {
    json = JSON.parse(raw);
  } catch {
    /* non-JSON 2xx — treat as sent */
  }
  // Some gateways return HTTP 200 with a failure body — don't count that as sent.
  if (json.success === false || json.error) {
    throw new Error(`KwikEngage accepted (${res.status}) but reported failure: ${raw.slice(0, 300)}`);
  }
  return { sent: true, messageId: json.messageId ?? json.data?.messageId };
}
