import * as dotenv from "dotenv";
dotenv.config();

import { handler } from "./handler";
import { SNSEvent } from "aws-lambda";
import { ILogger, Logger } from "@wedding/common";

const event: SNSEvent = {
  Records: [
    {
      EventSource: "aws:sns",
      EventVersion: "1.0",
      EventSubscriptionArn: "arn:aws:sns:example", // dummy
      Sns: {
        Type: "Notification",
        MessageId: "test-id",
        TopicArn: "arn:aws:sns:example",
        Subject: undefined,
        Message: JSON.stringify({
          type: "contact-us",
          to: ["simone.decristofaro85@gmail.com"],
          subject: "📨 Test Email via SNS",
          text: "This is the text fallback.",
          html: `
            <div style="font-family: sans-serif">
              <h2>🎉 Test from SNS</h2>
              <p>Happy wedding, again!</p>
            </div>
          `,
        }),
        Timestamp: new Date().toISOString(),
        SignatureVersion: "1",
        Signature: "fake",
        SigningCertUrl: "https://example.com",
        UnsubscribeUrl: "https://example.com",
        MessageAttributes: {},
      },
    },
  ],
};

const logger: ILogger = new Logger();

(async () => {
  try {
    logger.debug(`Sending email test with: ${JSON.stringify(event)}`);
    await handler(event, {} as any);
    logger.info("🏁 Done.");
  } catch (err) {
    logger.error("❌ Error running handler:", err);
    process.exit(1);
  }
})();
