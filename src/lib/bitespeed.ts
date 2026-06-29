// Bitespeed "plan ready" on email + WhatsApp (SPEC §7). DEFERRED — this is a stub
// that logs the intended call and returns. It is NOT wired into the main flow yet.
// When implementing: confirm Bitespeed's endpoint/payload against their API docs and
// use BITESPEED_API_KEY / BITESPEED_PLAN_READY_ID.
export interface SendPlanReadyInput {
  name: string;
  email: string;
  phone: string;
  login_url: string;
}

export async function sendPlanReady(input: SendPlanReadyInput): Promise<void> {
  console.log(
    `[bitespeed:stub] would trigger "plan ready" (email + WhatsApp) for ${input.name} ` +
      `<${input.email}> / ${input.phone} with a login link ` +
      `(BITESPEED_PLAN_READY_ID=${process.env.BITESPEED_PLAN_READY_ID ?? "unset"}). No-op.`,
  );
}
