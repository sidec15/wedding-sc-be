import { APIGatewayProxyHandler } from "aws-lambda";
import nodemailer from "nodemailer";

interface EmailPayload {
  to: string[];
  subject: string;
  html?: string;
  text?: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const payload = JSON.parse(event.body || "{}") as EmailPayload;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Wedding Site" <${process.env.SMTP_USER}>`,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Email sent." }),
    };
  } catch (error) {
    console.error("Email send failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send email" }),
    };
  }
};
