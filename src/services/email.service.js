const { Resend } = require('resend');
const crypto = require('crypto');
const { logger } = require('../utils');
const { generateToken } = require('../utils/jwt.utils');

function canExposeVerificationToken() {
  return process.env.DEBUG_MODE === 'true' || process.env.NODE_ENV !== 'production';
}

class EmailService {
  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  }

  /**
   * Send welcome email to newly registered DJ
   * @param {Object} user - User object from database
   * @param {string} displayName - DJ's display name
   * @returns {Promise<{success: boolean, messageId?: string, token?: string, error?: string}>}
   */
  async sendWelcomeEmail(user, displayName) {
    const COOLDOWN_MS = process.env.DEBUG_EMAIL === 'true' ? 0 : 5 * 60 * 1000; // Skip cooldown in DEBUG
    const MAX_ATTEMPTS = 5;
    const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

    if (user.emailVerificationLastSentAt && COOLDOWN_MS > 0) {
      const timeSinceLastAttempt = Date.now() - user.emailVerificationLastSentAt.getTime();
      if (timeSinceLastAttempt < COOLDOWN_MS) {
        throw new Error(
          `Email verification cooldown active. Wait ${Math.ceil((COOLDOWN_MS - timeSinceLastAttempt) / 1000)}s`
        );
      }
    }

    const dayAgo = new Date(Date.now() - ATTEMPT_WINDOW_MS);
    if (user.emailVerificationLastSentAt > dayAgo && user.emailVerificationAttempts >= MAX_ATTEMPTS && COOLDOWN_MS > 0) {
      throw new Error('Too many verification attempts. Try again in 24 hours');
    }
    const email = user.email;
    const idempotencyKey = `welcome-dj/${email}/${Date.now()}`;

    const verificationTokenId = crypto.randomUUID();

    /* Generate one-time email verification token (5m expiry) */
    const verificationToken = generateToken(
      {
        userId: user._id.toString(),
        email: user.email,
        type: 'email-verification',
        verificationTokenId,
      },
      '5m',
    );

    user.emailVerificationAttempts += 1;
    user.emailVerificationLastSentAt = new Date();
    user.emailVerificationTokenId = verificationTokenId;
    await user.save();

    /* Debug mode: bypass email sending, always expose token */
    if (process.env.DEBUG_EMAIL === 'true') {
      logger.info(`[DEBUG] Email verification token for ${email}: ${verificationToken}`);
      return {
        success: true,
        token: verificationToken,
      };
    }

    if (!this.resend) {
      logger.info(`Email service disabled; generated verification token for ${email}`);
      return {
        success: true,
        ...(canExposeVerificationToken() && { token: verificationToken }),
      };
    }

    const { data, error } = await this.resend.emails.send({
      from: this.fromEmail,
      to: [email],
      subject: 'Welcome to SyncRekuest! 🎵',
      html: this.getWelcomeEmailTemplate(displayName, verificationToken),
      idempotencyKey: idempotencyKey.substring(0, 256),
    });

    if (error) {
      logger.error('Failed to send welcome email:', error);
      throw new Error(error.message || 'Failed to send welcome email');
    }

    logger.info(`Welcome email sent to ${email} (messageId: ${data.id})`);
    return {
      success: true,
      messageId: data.id,
    };
  }

   /* Get welcome email HTML template */

  getWelcomeEmailTemplate(displayName, verificationToken) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/?verifyEmailToken=${encodeURIComponent(verificationToken)}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to SyncRekuest</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0e27; font-family: Arial, sans-serif;">
  <center role="main" style="width: 100%; background-color: #0a0e27;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #0a0e27;">
      <tr>
        <td align="center" style="padding: 40px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color: #0a0e27; max-width: 600px; margin: 0 auto;">
            
            <tr>
              <td align="center" style="padding: 32px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <img src="https://raw.githubusercontent.com/hpedADAITS/HernanPedraza-PI-Front/refs/heads/main/src/assets/logo_white.png" alt="SyncRekuest Logo" style="width: 180px; height: auto; display: block; filter: brightness(1000%);" />
              </td>
            </tr>
            
            <tr>
              <td align="center" style="padding: 40px 24px;">
                <h2 style="color: #e2e8f0; font-size: 18px; margin-bottom: 16px;">Welcome to SyncRekuest, ${this.escapeHtml(displayName)}!</h2>
                
                <p style="color: #cbd5e1; font-size: 16px; line-height: 1.7; margin-bottom: 24px;">
                  You've successfully created an account as a DJ on SyncRekuest! We're excited to have you join our community of music lovers and event organizers.
                </p>
                
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(135deg, rgba(30, 58, 138, 0.2) 0%, rgba(12, 30, 74, 0.2) 100%); border: 1px solid rgba(96, 165, 250, 0.2); border-radius: 12px; padding: 24px; margin-bottom: 32px;">
                  <tr>
                    <td align="center" style="padding: 0 8px;">
                      <h3 style="color: #7dd3fc; font-size: 18px; font-weight: 600; margin-bottom: 12px;">What You Can Do</h3>
                    </td>
                  </tr>
                  <tr>
                    <td align="left" style="padding-left: 8px;">
                      <ul role="presentation" style="margin: 0; padding: 0; color: #94a3b8; font-size: 15px; list-style: none;">
                        <li style="padding: 8px 0; padding-left: 24px; position: relative;">Create and manage your event</li>
                        <li style="padding: 8px 0; padding-left: 24px; position: relative;">Set access codes for private parties</li>
                        <li style="padding: 8px 0; padding-left: 24px; position: relative;">Manage your music queue</li>
                        <li style="padding: 8px 0; padding-left: 24px; position: relative;">Track attendees and their requests</li>
                      </ul>
                    </td>
                  </tr>
                </table>
                
                <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; letter-spacing: 0.5px;">Verify Email & Continue</a>
              </td>
            </tr>
            
            <tr>
              <td align="center" style="padding-top: 40px;">
                <h3 style="color: #e2e8f0; font-size: 18px; margin-bottom: 24px;">Why SyncRekuest?</h3>
                
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="left" style="padding: 20px; display: flex; align-items: center; gap: 16px;">
                      <div style="width: 48px; height: 48px; background: linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" style="width: 28px; height: 28px;"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6v6l4 2"/></svg>
                      </div>
                      <div style="flex: 1;">
                        <h4 style="color: #e2e8f0; font-size: 16px; font-weight: 600; margin-bottom: 4px;">Real-time Queue</h4>
                        <p style="color: #94a3b8; font-size: 14px;">See what attendees are requesting and manage your playlist instantly.</p>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td align="left" style="padding: 20px; display: flex; align-items: center; gap: 16px;">
                      <div style="width: 48px; height: 48px; background: linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" style="width: 28px; height: 28px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </div>
                      <div style="flex: 1;">
                        <h4 style="color: #e2e8f0; font-size: 16px; font-weight: 600; margin-bottom: 4px;">Private Events</h4>
                        <p style="color: #94a3b8; font-size: 14px;">Set access codes to keep your parties exclusive and secure.</p>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td align="left" style="padding: 20px; display: flex; align-items: center; gap: 16px;">
                      <div style="width: 48px; height: 48px; background: linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" style="width: 28px; height: 28px;"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6v6l4 2"/></svg>
                      </div>
                      <div style="flex: 1;">
                        <h4 style="color: #e2e8f0; font-size: 16px; font-weight: 600; margin-bottom: 4px;">Live Updates</h4>
                        <p style="color: #94a3b8; font-size: 14px;">Real-time notifications for new song requests and event changes.</p>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            
            <tr>
              <td align="center" style="padding-top: 32px; border-top: 1px solid rgba(255,255,255,0.1); color: #64748b; font-size: 13px;">
                <p style="margin-bottom: 12px;">Made with ❤️</p>
                <br/>
                <p style="margin-top: 20px;">2026 SyncRekuest</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
  
  <style type="text/css" media="screen and (max-width: 480px)">
    td, tr {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    
    img {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
    }
    
    body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    
    .outer {
      max-width: 100% !important;
      width: 100% !important;
      height: auto !important;
      overflow: visible !important;
    }
    
    .inner {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 320px !important;
    }
    
    @media screen and (max-width: 480px) {
      .outer {
        direction: vertical !important;
        width: 100% !important;
        height: auto !important;
        max-height: none !important;
        display: block !important;
        background-color: #0a0e27 !important;
      }
      
      .inner {
        width: auto !important;
        min-width: 0 !important;
      }
    }
  </style>
</body>
</html>`;
  }

  /**
   * Escape HTML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
  }
}

module.exports = new EmailService();
