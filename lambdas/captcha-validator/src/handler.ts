import { APIGatewayProxyHandler } from "aws-lambda";
import axios, { AxiosError } from "axios";
import { ILogger, Logger } from "@wedding/common";

const conf = {
  region: process.env.MY_AWS_REGION ?? "eu-west-1",
  recaptcha_secret_key: process.env.RECAPTCHA_SECRET_KEY,
  // optional: allow overriding endpoint (e.g., recaptcha.net if google blocked)
  recaptcha_verify_url:
    process.env.RECAPTCHA_VERIFY_URL ||
    "https://www.google.com/recaptcha/api/siteverify",
};

const logger: ILogger = new Logger();

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    if (logger.isDebugEnabled()) {
      // Do NOT log the token
      logger.debug(
        `Incoming request: { hasBody: ${!!event.body}, sourceIp: ${
          (event.requestContext as any)?.identity?.sourceIp ?? "n/a"
        } }`
      );
    }

    // Parse body safely
    let token: string | undefined;
    try {
      const body = JSON.parse(event.body || "{}");
      token = body?.token;
      // Optional: v3 action/remoteip pass-through
      // const expectedAction = body?.expectedAction as string | undefined;
      // const remoteip = body?.remoteip as string | undefined;
    } catch {
      return resp(400, apiFail("bad-request"));
    }

    if (!token) {
      logger.warn("Missing reCAPTCHA token in request body");
      return resp(400, apiFail("bad-request", ["missing-input-response"]));
    }

    const secret = conf.recaptcha_secret_key;
    if (!secret) {
      logger.error("Missing RECAPTCHA_SECRET_KEY in environment variables");
      return resp(500, apiFail("server-error", ["config-missing"]));
    }

    // Call Google with a short timeout
    logger.info("Calling reCAPTCHA siteverify");
    const google = await axios.post(
      conf.recaptcha_verify_url,
      new URLSearchParams({ secret, response: token /*, remoteip*/ }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 3500, // ms
        validateStatus: () => true, // handle non-200 gracefully
      }
    );

    const data = google.data ?? {};
    if (logger.isDebugEnabled()) {
      logger.debug(
        `Google status=${google.status} success=${
          data?.success
        } errors=${JSON.stringify(data?.["error-codes"] ?? [])}`
      );
    }

    // Hard network errors still go to catch; here we consider HTTP errors as well
    const success = !!data?.success;

    if (success) {
      logger.info("reCAPTCHA validation passed");
      return resp(200, {
        success: true,
        challengeTs: data?.challenge_ts,
        hostname: data?.hostname,
      });
    }

    // Classify Google error codes
    const errorCodes: string[] = data?.["error-codes"] ?? [];

    // Common codes: https://developers.google.com/recaptcha/docs/verify
    // - missing-input-secret, invalid-input-secret, missing-input-response, invalid-input-response,
    // - bad-request, timeout-or-duplicate
    const reason = classifyReason(errorCodes);

    // Client-side issues -> 400, infra issues -> 502
    if (
      reason === "expired" ||
      reason === "invalid" ||
      reason === "duplicate" ||
      reason === "bad-request"
    ) {
      logger.warn(
        `reCAPTCHA validation failed: reason=${reason} codes=${errorCodes.join(
          ","
        )}`
      );
      return resp(400, apiFail(reason, errorCodes));
    } else {
      logger.error(
        `reCAPTCHA upstream error: reason=${reason} codes=${errorCodes.join(
          ","
        )}`
      );
      return resp(502, apiFail(reason, errorCodes));
    }
  } catch (err) {
    const ax = err as AxiosError;

    if (ax?.code === "ECONNABORTED") {
      logger.error("reCAPTCHA verify timeout");
      return resp(504, apiFail("network-error", ["timeout"]));
    }

    if (ax?.isAxiosError) {
      logger.error("Network error calling reCAPTCHA", ax);
      return resp(502, apiFail("network-error", [ax.code || "axios-error"]));
    }

    logger.error("Unexpected error during reCAPTCHA validation", err);
    return resp(500, apiFail("server-error"));
  }
};

// --- helpers ---

function classifyReason(errorCodes: string[]): CaptchaVerifyResponse["reason"] {
  const codes = new Set((errorCodes || []).map((c) => String(c)));

  if (codes.has("timeout-or-duplicate")) return "expired"; // could also be 'duplicate'; pick 'expired' to force re-solve
  if (
    codes.has("invalid-input-response") ||
    codes.has("missing-input-response")
  )
    return "invalid";
  if (codes.has("bad-request")) return "bad-request";
  if (codes.has("missing-input-secret") || codes.has("invalid-input-secret"))
    return "server-error";
  // fallthrough (unknown): treat as server/upstream problem
  return "server-error";
}

type CaptchaVerifyResponse = {
  success: boolean;
  reason?:
    | "expired"
    | "invalid"
    | "duplicate"
    | "bad-request"
    | "server-error"
    | "network-error";
  errorCodes?: string[];
  challengeTs?: string;
  hostname?: string;
};

function apiFail(
  reason: NonNullable<CaptchaVerifyResponse["reason"]>,
  errorCodes?: string[]
): CaptchaVerifyResponse {
  return {
    success: false,
    reason,
    ...(errorCodes?.length ? { errorCodes } : {}),
  };
}

function resp(statusCode: number, body: CaptchaVerifyResponse) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify(body),
  };
}
