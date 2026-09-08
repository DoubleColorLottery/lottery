import { timingSafeEqual } from "node:crypto";
import { createError, getHeader, type H3Event } from "h3";

const MIN_CRON_SECRET_LENGTH = 16;

type RuntimeEnv = Record<string, string | undefined>;

export function getCronSecretStatus(env: RuntimeEnv = process.env): { configured: boolean; validLength: boolean } {
  const secret = env.CRON_SECRET || "";

  return {
    configured: secret.length > 0,
    validLength: secret.length >= MIN_CRON_SECRET_LENGTH,
  };
}

export function verifyCronSecret(providedSecret: string | null | undefined, expectedSecret = process.env.CRON_SECRET): boolean {
  if (!expectedSecret || expectedSecret.length < MIN_CRON_SECRET_LENGTH || !providedSecret) return false;

  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function assertCronAuthorized(event: H3Event) {
  const bearer = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const providedSecret = getHeader(event, "x-cron-secret") || bearer;

  if (!verifyCronSecret(providedSecret)) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }
}
