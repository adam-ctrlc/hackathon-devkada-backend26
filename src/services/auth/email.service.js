import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

const createTransport = () =>
  nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 465,
    secure: true,
    auth: {
      user: env.brevoSmtpUser,
      pass: env.brevoSmtp,
    },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

const sendViaBrevoApi = async ({ toEmail, subject, html, text }) => {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.brevoApiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "KainWise", email: env.brevoSenderEmail },
      to: [{ email: toEmail }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API ${response.status}: ${body}`);
  }
};

const sendEmail = async ({ toEmail, subject, html, text }) => {
  if (env.brevoApiKey) {
    await sendViaBrevoApi({ toEmail, subject, html, text });
    return;
  }

  const transport = createTransport();
  await transport.sendMail({
    from: `"KainWise" <${env.brevoSenderEmail}>`,
    to: toEmail,
    subject,
    html,
    text,
  });
};

export const sendEmailVerificationEmail = async ({
  toEmail,
  code,
  firstName,
}) => {
  if (!env.brevoSenderEmail || (!env.brevoApiKey && !env.brevoSmtp)) {
    console.warn("[email] Brevo not configured — skipping verification email");
    return;
  }

  await sendEmail({
    toEmail,
    subject: "Verify your KainWise email",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#1d4ed8;margin-bottom:8px;">Verify your email</h2>
        <p style="color:#374151;margin-bottom:16px;">Hi ${firstName ?? "there"},</p>
        <p style="color:#374151;margin-bottom:16px;">Enter the code below to verify your KainWise account. It expires in 30 minutes.</p>
        <div style="background:#eff6ff;border-radius:12px;padding:20px 24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:32px;font-weight:800;letter-spacing:0.18em;color:#1d4ed8;font-family:monospace;">${code}</span>
        </div>
        <p style="color:#6b7280;font-size:13px;">If you did not create a KainWise account, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="color:#9ca3af;font-size:12px;">© ${new Date().getFullYear()} KainWise. All rights reserved.</p>
      </div>
    `,
    text: `Hi ${firstName ?? "there"},\n\nYour KainWise verification code is:\n\n${code}\n\nIt expires in 30 minutes. If you did not create an account, ignore this email.`,
  });
};

export const sendPasswordResetEmail = async ({
  toEmail,
  resetToken,
  firstName,
}) => {
  if (!env.brevoSenderEmail || (!env.brevoApiKey && !env.brevoSmtp)) {
    console.warn("[email] Brevo not configured — skipping email send");
    return;
  }

  await sendEmail({
    toEmail,
    subject: "Reset your KainWise password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#0a2366;margin-bottom:8px;">Password reset request</h2>
        <p style="color:#374151;margin-bottom:16px;">Hi ${firstName ?? "there"},</p>
        <p style="color:#374151;margin-bottom:16px;">Use the code below to reset your password. It expires in 30 minutes.</p>
        <div style="background:#f4f6fc;border-radius:12px;padding:20px 24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:28px;font-weight:800;letter-spacing:0.12em;color:#0a2366;font-family:monospace;">${resetToken}</span>
        </div>
        <p style="color:#6b7280;font-size:13px;">If you did not request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="color:#9ca3af;font-size:12px;">© ${new Date().getFullYear()} KainWise. All rights reserved.</p>
      </div>
    `,
    text: `Hi ${firstName ?? "there"},\n\nYour KainWise password reset code is:\n\n${resetToken}\n\nIt expires in 30 minutes. If you did not request this, ignore this email.`,
  });
};
