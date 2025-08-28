import { APIGatewayProxyHandler } from "aws-lambda";
import axios from "axios";
import { ILogger, Logger } from "@wedding/common";

const conf = {
  region: process.env.MY_AWS_REGION ?? "eu-west-1",
  recaptcha_secret_key: process.env.RECAPTCHA_SECRET_KEY,
};

const logger: ILogger = new Logger();

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    if (logger.isDebugEnabled()) {
      logger.debug(`Raw event: ${JSON.stringify(event)}`);
    }

    const { token } = JSON.parse(event.body || "{}");
    if (!token) {
      logger.error("Missing reCAPTCHA token in request body");
      return resp(400, { success: false, error: "Missing token" });
    }

    const secret = conf.recaptcha_secret_key || "";
    if (!secret) {
      logger.error("Missing RECAPTCHA_SECRET_KEY in environment variables");
      return resp(500, { success: false, error: "Configuration error" });
    }

    logger.info("Calling Google reCAPTCHA siteverify endpoint");

    const google = await axios.post(
      "https://www.google.com/recaptcha/api/siteverify",
      new URLSearchParams({ secret, response: token }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (logger.isDebugEnabled()) {
      logger.debug(`Google response: ${JSON.stringify(google.data)}`);
    }

    const success = !!google.data?.success;

    if (success) {
      logger.info("reCAPTCHA validation passed");
    } else {
      logger.error("reCAPTCHA validation failed");
    }

    return resp(200, { success });
  } catch (error) {
    logger.error("Error during reCAPTCHA validation", error);
    return resp(200, { success: false });
  }
};

const resp = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": true,
  },
  body: JSON.stringify(body),
});
