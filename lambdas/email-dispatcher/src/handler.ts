import { SNSEvent, Context } from "aws-lambda";
import nodemailer from "nodemailer";
import { EmailNotificationMessage, ILogger, Logger } from "@wedding/common";

const logger: ILogger = new Logger();

export const handler = async (
  event: SNSEvent,
  context: Context
): Promise<void> => {
  for (const record of event.Records) {
    try {
      const payload = JSON.parse(
        record.Sns.Message
      ) as EmailNotificationMessage;

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      logger.info(`📧 Sending email to: ${payload.to.join(", ")}`);
      await transporter.sendMail({
        from: `"Wedding Site" <${process.env.SMTP_USER}>`,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });

      logger.info("✅ Email sent successfully");
    } catch (error) {
      logger.error("❌ Failed to send email:", error);
    }
  }
};
