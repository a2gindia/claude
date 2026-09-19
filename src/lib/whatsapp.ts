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
  const apiKey = process.env.KWIKENGAGE_API_KEY;
  if (!apiKey) return { sent: false, skipped: "KWIKENGAGE_API_KEY not set" };

  const to = toWaNumber(input.phone);
  if (!to) return { sent: false, skipped: "no valid phone" };

  const templateId = process.env.KWIKENGAGE_PLAN_READY_TEMPLATE_ID || "plan_ready";
  const language = process.env.KWIKENGAGE_PLAN_READY_LANGUAGE || "en";
  const firstName = (input.name || "there").trim().split(/\s+/)[0];

  const body = {
    to,
    channel: "whatsapp",
    content: {
      type: "template",
      template: {
        template_id: templateId,
        language,
        // Template body variables: {{1}} = first name, {{2}} = one-tap login link.
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: firstName },
              { type: "text", text: input.magicLink },
            ],
          },
        ],
      },
    },
  };

  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`KwikEngage ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { messageId?: string };
  return { sent: true, messageId: json.messageId };
}
