import { APIGatewayProxyHandler } from "aws-lambda";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { dateTimeUtils, EmailNotificationMessage, ILogger, Logger } from "@wedding/common";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";


const conf = {
  region: process.env.AWS_REGION ?? "eu-west-1",
  use_recaptcha: process.env.USE_RECAPTCHA === "true",
  emailSnsTopicArn: process.env.EMAIL_SNS_TOPIC_ARN,
  toEmail: process.env.TO_EMAIL,
  validatorFunctionName: process.env.CAPTCHA_VALIDATOR_FUNCTION_NAME
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

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    if (logger.isDebugEnabled()) {
      logger.debug(`Raw event arrived: ${JSON.stringify(event)}`);
    }
    const parsed = JSON.parse(event.body || "{}");

    const result = validateBody(parsed);
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
        return createResponse(400, { error: "Missing reCAPTCHA token" });
      }

      const isHuman = await validateRecaptcha(body.recaptchaToken);
      if (!isHuman) {
        return createResponse(403, { error: "Failed reCAPTCHA validation" });
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

    logger.info(
      `Correctly published event on topic: ${conf.emailSnsTopicArn}`
    );

    return createResponse(200, { message: "Message sent successfully!" });
  } catch (error) {
    logger.error("SNS publish error:", error);
    return createResponse(500, { error: "Failed to send message" });
  }
};

// keep your handler the same, only swap the validation call:
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

const validateBody = (body: any) => {
  if (!body) {
    return createResponse(400, { error: "Missing body." });
  }

  if (!body.name) {
    return createResponse(400, { error: "Missing name." });
  }

  if (!body.surname) {
    return createResponse(400, { error: "Missing surname." });
  }

  if (!body.message) {
    return createResponse(400, { error: "Missing message." });
  }

  // At least one contact method should be provided
  if (!body.email && !body.phone) {
    return createResponse(400, {
      error: "Please provide either email or phone number.",
    });
  }

  return null;
};

const createResponse = (statusCode: number, body: any) => {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*", // Adjust this based on your CORS requirements
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(body),
  };
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
