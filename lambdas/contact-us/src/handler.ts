import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyHandler,
  APIGatewayProxyHandlerV2,
} from "aws-lambda";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  dateTimeUtils,
  EmailNotificationMessage,
  ILogger,
  Logger,
  webUtils,
} from "@wedding/common";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { Context } from "vm";

const conf = {
  region: process.env.MY_AWS_REGION ?? "eu-west-1",
  emailSnsTopicArn: process.env.EMAIL_SNS_TOPIC_ARN,
  toEmail: process.env.TO_EMAIL,
  use_recaptcha: process.env.USE_RECAPTCHA === "true",
  validatorFunctionName: process.env.CAPTCHA_VALIDATOR_FUNCTION_NAME,
};

const lambdaClient = new LambdaClient({ region: conf.region });

interface ContactFormData {
  name: string;
  surname: string;
  phone?: string;
  email?: string;
  message: string;
  recaptchaToken?: string;
}

const snsClient = new SNSClient({ region: conf.region });

const logger: ILogger = new Logger();

export const handler: APIGatewayProxyHandlerV2 = async (
  event: APIGatewayProxyEventV2,
  context: Context
) => {
  try {
    if (logger.isDebugEnabled()) {
      logger.debug(`Raw event arrived: ${JSON.stringify(event)}`);
    }
    const parsed = JSON.parse(event.body || "{}");

    const result = validateBody(parsed, event, context);
    if (result) {
      return result;
    }

    const body = parsed as unknown as ContactFormData;
    if (logger.isDebugEnabled()) {
      logger.debug(`Parsed body: ${JSON.stringify(body)}`);
    }

    const useRecaptcha = conf.use_recaptcha;

    if (useRecaptcha) {
      if (!body.recaptchaToken) {
        return webUtils.failure(
          400,
          "bad_captcha",
          "Missing reCAPTCHA token",
          context.awsRequestId,
          event.requestContext.requestId
        );
      }

      const isHuman = await validateRecaptcha(body.recaptchaToken);
      if (!isHuman) {
        return webUtils.failure(
          403,
          "bad_captcha",
          "Failed reCAPTCHA validation",
          context.awsRequestId,
          event.requestContext.requestId
        );
      }
    }

    const topicArn = conf.emailSnsTopicArn;
    if (!topicArn) {
      throw new Error(
        `Required environment variable EMAIL_SNS_TOPIC_ARN not set`
      );
    }

    // Publish to SNS topic
    const publishCommand = new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify({
        type: "contact-us",
        to: conf.toEmail?.split(",").map((e) => e.trim()) || [],
        subject: `Wedding Contact Form - New message from ${body.name}`,
        text: createTextMessage(body),
        html: createHtmlMessage(body),
      } as EmailNotificationMessage),
      MessageAttributes: {
        source: {
          DataType: "String",
          StringValue: "wedding-contact-us",
        },
      },
    });
    if (logger.isDebugEnabled()) {
      logger.debug(
        `Publishing SNS event with command: ${JSON.stringify(publishCommand)}`
      );
    }

    await snsClient.send(publishCommand);

    logger.info(`Correctly published event on topic: ${conf.emailSnsTopicArn}`);

    return webUtils.success(
      200,
      "Message sent successfully!",
      context.awsRequestId,
      event.requestContext.requestId
    );
  } catch (error) {
    logger.error("SNS publish error:", error);
    return webUtils.failure(
      500,
      "internal_service_error",
      "Failed to send message",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }
};

const validateRecaptcha = async (token: string): Promise<boolean> => {
  const fn = conf.validatorFunctionName;
  if (!fn) throw new Error("Missing CAPTCHA_VALIDATOR_FUNCTION_NAME");

  const payload = { body: JSON.stringify({ token }) };

  const out = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: fn,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  // Minimal parsing: expect { statusCode, body: '{"success":true|false}' }
  const text = new TextDecoder().decode(out.Payload ?? new Uint8Array());
  const res = JSON.parse(text);
  const body = res?.body ? JSON.parse(res.body) : {};
  return !!body.success;
};

const validateBody = (
  body: any,
  event: APIGatewayProxyEventV2,
  context: Context
) => {
  if (!body) {
    return webUtils.failure(
      400,
      "validation_failed",
      "Missing body.",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }

  if (!body.name) {
    return webUtils.failure(
      400,
      "validation_failed",
      "Missing name.",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }

  if (!body.surname) {
    return webUtils.failure(
      400,
      "validation_failed",
      "Missing surname.",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }

  if (!body.message) {
    return webUtils.failure(
      400,
      "validation_failed",
      "Missing message.",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }

  // At least one contact method should be provided
  if (!body.email && !body.phone) {
    return webUtils.failure(
      400,
      "validation_failed",
      "Please provide either email or phone number.",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }

  return null;
};

const createHtmlMessage = (body: ContactFormData) => {
  const htmlMessage = `
  <div style="font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #555; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #fdf2f5; padding: 20px; border-radius: 8px; border: 1px solid #f5d6e0;">
      <h2 style="color: #d67a8a; margin-bottom: 15px; text-align: center; font-weight: 300;">
        💖 Nuovo Messaggio dal Sito Matrimonio
      </h2>
      
      <div style="background: white; padding: 20px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
        <p style="margin-bottom: 20px;">Hai ricevuto un nuovo messaggio dal modulo di contatto:</p>
        
        <table cellpadding="10" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%;">
          <tr>
            <td style="font-weight: bold; width: 120px; color: #d67a8a;">Nome</td>
            <td style="border-bottom: 1px dashed #f0c8d2;">${body.name}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #d67a8a;">Cognome</td>
            <td style="border-bottom: 1px dashed #f0c8d2;">${body.surname}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #d67a8a;">Email</td>
            <td style="border-bottom: 1px dashed #f0c8d2;">
              ${
                body.email
                  ? `<a href="mailto:${body.email}" style="color: #d67a8a; text-decoration: none;">${body.email}</a>`
                  : "-"
              }
            </td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #d67a8a;">Telefono</td>
            <td style="border-bottom: 1px dashed #f0c8d2;">${
              body.phone || "-"
            }</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #d67a8a; vertical-align: top;">Messaggio</td>
            <td style="border-bottom: 1px dashed #f0c8d2; white-space: pre-line; padding-bottom: 15px;">${
              body.message
            }</td>
          </tr>
        </table>
      </div>
      
      <p style="text-align: center; margin-top: 25px; color: #999; font-size: 13px;">
        Questo messaggio è stato inviato dal modulo di contatto del vostro sito matrimonio.<br>
        Data: ${dateTimeUtils.formatItalianDateTime()}
      </p>
      
    </div>
  </div>
  `;

  return htmlMessage;
};

const createTextMessage = (body: ContactFormData) => {
  const textMessage = `💌 Nuovo Messaggio dal Sito Matrimonio

━━━━━━━━━━━━━━━━━━━━━━
👰‍♀️🤵‍♂️ Informazioni Contatto
━━━━━━━━━━━━━━━━━━━━━━
• Nome: ${body.name}
• Cognome: ${body.surname}
• Email: ${body.email || "Non fornito"}
• Telefono: ${body.phone || "Non fornito"}

✉️ Messaggio:
${body.message}

━━━━━━━━━━━━━━━━━━━━━━
Questo messaggio è stato inviato tramite 
il modulo di contatto del vostro sito matrimonio.

Data: ${new Date().toLocaleString("it-IT")}
❤️ Con affetto, ${body.name}`;

  return textMessage;
};
