import { ILogger } from "../services/logger.service";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// types you can reuse
export type CaptchaDecision =
  | { isHuman: true; statusCode: 200 }
  | {
      isHuman: false;
      statusCode: 400;
      reason: "expired" | "invalid" | "duplicate" | "bad-request";
    }
  | {
      isHuman: false;
      statusCode: 5_02 | 5_04 | 5_00;
      reason: "network-error" | "server-error";
    }
  | { isHuman: false; statusCode: 500; reason: "invoke-error" };

export async function validateRecaptcha(
  token: string,
  validatorFunctionName: string,
  logger: ILogger,
  lambdaClient: LambdaClient
): Promise<CaptchaDecision> {
  const fn = validatorFunctionName;
  if (!fn) throw new Error("Missing CAPTCHA_VALIDATOR_FUNCTION_NAME");

  if (logger.isDebugEnabled())
    logger.debug(`Invoking captcha validator lambda: ${fn}`);

  // APIGW proxy style event for the validator
  const payload = { body: JSON.stringify({ token }) };

  try {
    const out = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(payload)),
      })
    );

    // Lambda-level error (function crashed/threw)
    if (out.FunctionError) {
      logger.error(
        `Captcha validator returned FunctionError: ${out.FunctionError}`
      );
      return { isHuman: false, statusCode: 500, reason: "invoke-error" };
    }

    const text = out.Payload
      ? new TextDecoder().decode(out.Payload as Uint8Array)
      : "";
    if (!text) {
      logger.error("Captcha validator returned empty payload");
      return { isHuman: false, statusCode: 500, reason: "invoke-error" };
    }

    let res: any = {};
    try {
      res = JSON.parse(text);
    } catch {
      logger.error("Captcha validator payload is not JSON");
      return { isHuman: false, statusCode: 500, reason: "invoke-error" };
    }

    const statusCode: number = res?.statusCode ?? 500;
    let body: any = {};
    try {
      body = res?.body ? JSON.parse(res.body) : {};
    } catch {
      body = {};
    }

    if (logger.isDebugEnabled()) {
      // Don't print the token; body.success/reason is fine to log
      logger.debug(
        `Captcha validator response: status=${statusCode} body=${JSON.stringify(
          body
        )}`
      );
    }

    // Happy path
    if (statusCode === 200 && body?.success === true) {
      return { isHuman: true, statusCode: 200 };
    }

    // Classify known client-side failures
    if (statusCode === 400) {
      const reason = (body?.reason ??
        (Array.isArray(body?.errorCodes) &&
        body.errorCodes.includes("timeout-or-duplicate")
          ? "expired"
          : "invalid")) as CaptchaDecision & any;
      // Narrow to allowed literals
      const mapped: "expired" | "invalid" | "duplicate" | "bad-request" =
        reason === "expired" ||
        reason === "invalid" ||
        reason === "duplicate" ||
        reason === "bad-request"
          ? reason
          : "invalid";
      return { isHuman: false, statusCode: 400, reason: mapped };
    }

    // Upstream/transient/server issues
    if (statusCode === 502 || statusCode === 504) {
      return { isHuman: false, statusCode, reason: "network-error" };
    }

    return { isHuman: false, statusCode: 500, reason: "server-error" };
  } catch (err) {
    // Transport-level failure (Invoke API)
    logger.error("Error invoking captcha validator", err as Error);
    return { isHuman: false, statusCode: 500, reason: "invoke-error" };
  }
}
