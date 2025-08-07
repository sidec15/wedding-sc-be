import * as dotenv from "dotenv";
dotenv.config();

import { handler } from "./handler";

(async () => {
  const testPayload = {
    to: ["simone.decristofaro@movesion.com"],
    subject: "📨 Test Email from Wedding Site",
    text: "This is the plain text version of your test email.",
    html: `
      <div style="font-family: sans-serif; line-height: 1.5">
        <h2>🎉 New Wedding Message</h2>
        <p><strong>Happy wedding!</strong> I wish you the very best!</p>
        <p>— Sent via <em>email-dispatcher Lambda</em></p>
      </div>
    `,
  };

  const event = {
    body: JSON.stringify(testPayload),
  } as any;

  const context = {} as any;

  try {
    console.log("🚀 Invoking Lambda...");
    const result = await handler(event, context, () => {});
    console.log("✅ Handler result:", result);
  } catch (err) {
    console.error("❌ Error in handler:", err);
    process.exit(1);
  }
})();
