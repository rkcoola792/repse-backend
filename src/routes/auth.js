const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const checkEmailExists = require("../middlewares/emailExists");
const User = require("../models/user");
const { isStrongPassword } = require("validator");
const crypto = require("crypto");
const { sendLoginOtpEmail } = require("../utils/emailService");
// SMS sign-in is paused until Twilio is configured. Keep the implementation commented for later:
// const { sendLoginOtpSms } = require("../utils/smsService");
const userAuth = require("../middlewares/auth");
const authRouter = express.Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Frontend and backend live on different domains (even in local dev, on
// different ports), so cookies must be SameSite=None to be sent back on
// cross-site requests. Browsers treat "localhost" as a secure context, so
// Secure cookies work there too — no need to branch on NODE_ENV.
const baseCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
};
const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_DELAY_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const normalizedEmail = (email) => String(email || "").trim().toLowerCase();
const hashOtp = (email, otp) => crypto
  .createHmac("sha256", process.env.JWT_SECRET)
  .update(`${email}:${otp}`)
  .digest("hex");
/* SMS phone-number normalization, retained for when Twilio sign-in is enabled:
const normalizePhone = (value) => {
  const input = String(value || "").trim();
  const digits = input.replace(/[\s().-]/g, "");
  const e164 = /^\d{10}$/.test(digits)
    ? `+91${digits}`
    : digits.startsWith("+")
      ? digits
      : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
};
// Only the OTP-verified login identifier may select an account. The editable
// profile `mobile` field is not proof of ownership.
const phoneLookup = (phone) => ({ phoneLogin: phone });
*/

authRouter.post("/request-login-otp", async (req, res) => {
  try {
    const email = normalizedEmail(req.body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    const existingUser = await User.findOne({
      $expr: { $eq: [{ $toLower: "$email" }, email] },
    }).select("+loginOtpSentAt");
    if (existingUser?.loginOtpSentAt && Date.now() - existingUser.loginOtpSentAt.getTime() < OTP_RESEND_DELAY_MS) {
      return res.status(200).json({ message: "If a sign-in code can be sent, it has been sent" });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    // Send first so a rejected recipient does not create a user or cooldown.
    await sendLoginOtpEmail(email, code);

    const user = existingUser || new User({
      name: email.split("@")[0],
      email,
      mobile: "",
      address: "",
      gender: "other",
    });
    if (user.email !== email) {
      user.email = email;
    }
    user.loginOtpHash = hashOtp(email, code);
    user.loginOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    user.loginOtpSentAt = new Date();
    user.loginOtpAttempts = 0;
    await user.save();
    return res.status(200).json({ message: "If a sign-in code can be sent, it has been sent" });
  } catch (error) {
    console.error("Could not send login OTP:", error.message);
    return res.status(503).json({ error: "Could not send a sign-in code right now. Please try again." });
  }
});

authRouter.post("/verify-login-otp", async (req, res) => {
  try {
    const email = normalizedEmail(req.body.email);
    const code = String(req.body.code || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter the 6-digit code sent to your email" });
    }
    const user = await User.findOne({
      $expr: { $eq: [{ $toLower: "$email" }, email] },
    }).select("+loginOtpHash +loginOtpExpiresAt +loginOtpAttempts");
    if (!user?.loginOtpHash || !user.loginOtpExpiresAt || user.loginOtpExpiresAt < new Date()) {
      return res.status(400).json({ error: "That code has expired. Request a new one." });
    }
    if (user.loginOtpAttempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many incorrect attempts. Request a new code." });
    }
    const submittedHash = Buffer.from(hashOtp(email, code), "hex");
    const storedHash = Buffer.from(user.loginOtpHash, "hex");
    if (submittedHash.length !== storedHash.length || !crypto.timingSafeEqual(submittedHash, storedHash)) {
      user.loginOtpAttempts += 1;
      await user.save();
      return res.status(400).json({ error: "That code is incorrect" });
    }

    user.emailVerifiedAt = user.emailVerifiedAt || new Date();
    user.loginOtpHash = undefined;
    user.loginOtpExpiresAt = undefined;
    user.loginOtpSentAt = undefined;
    user.loginOtpAttempts = 0;
    await user.save();
    await setAuthCookies(res, user);
    const { password: _password, refreshTokenHash, loginOtpHash, loginOtpExpiresAt, loginOtpSentAt, loginOtpAttempts, ...safeUser } = user.toObject();
    return res.status(200).json({ message: "Signed in successfully", user: safeUser });
  } catch (error) {
    console.error("Could not verify login OTP:", error.message);
    return res.status(500).json({ error: "Could not verify the sign-in code" });
  }
});

/* SMS OTP endpoints are paused until Twilio is configured.
authRouter.post("/request-phone-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
      return res.status(400).json({ error: "Enter a valid phone number with country code, or a 10-digit Indian number" });
    }
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || (!process.env.TWILIO_MESSAGING_SERVICE_SID && !process.env.TWILIO_PHONE_NUMBER)) {
      return res.status(503).json({ error: "Phone sign-in is not configured yet. Add Twilio credentials to the backend environment." });
    }

    let user = await User.findOne(phoneLookup(phone))
      .select("+phoneOtpSentAt +phoneLogin");
    if (user?.phoneOtpSentAt && Date.now() - user.phoneOtpSentAt.getTime() < OTP_RESEND_DELAY_MS) {
      return res.status(200).json({ message: "If a sign-in code can be sent, it has been sent" });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    if (!user) {
      user = new User({
        name: `Customer ${phone.slice(-4)}`,
        mobile: phone,
        phoneLogin: phone,
        gender: "other",
      });
    } else {
      user.phoneLogin = phone;
      user.mobile = phone;
    }
    user.phoneOtpHash = hashOtp(phone, code);
    user.phoneOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    user.phoneOtpSentAt = new Date();
    user.phoneOtpAttempts = 0;
    await user.save();
    await sendLoginOtpSms(phone, code);
    return res.status(200).json({ message: "If a sign-in code can be sent, it has been sent" });
  } catch (error) {
    console.error("Could not send phone login OTP:", error.code || error.message);
    return res.status(503).json({ error: "Could not send a sign-in code right now. Please try again." });
  }
});

authRouter.post("/verify-phone-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const code = String(req.body.code || "").trim();
    if (!phone || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter the 6-digit code sent to your phone" });
    }
    const user = await User.findOne(phoneLookup(phone))
      .select("+phoneOtpHash +phoneOtpExpiresAt +phoneOtpAttempts +phoneLogin");
    if (!user?.phoneOtpHash || !user.phoneOtpExpiresAt || user.phoneOtpExpiresAt < new Date()) {
      return res.status(400).json({ error: "That code has expired. Request a new one." });
    }
    if (user.phoneOtpAttempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many incorrect attempts. Request a new code." });
    }
    const submittedHash = Buffer.from(hashOtp(phone, code), "hex");
    const storedHash = Buffer.from(user.phoneOtpHash, "hex");
    if (submittedHash.length !== storedHash.length || !crypto.timingSafeEqual(submittedHash, storedHash)) {
      user.phoneOtpAttempts += 1;
      await user.save();
      return res.status(400).json({ error: "That code is incorrect" });
    }

    user.phoneVerifiedAt = user.phoneVerifiedAt || new Date();
    user.phoneLogin = phone;
    user.mobile = phone;
    user.phoneOtpHash = undefined;
    user.phoneOtpExpiresAt = undefined;
    user.phoneOtpSentAt = undefined;
    user.phoneOtpAttempts = 0;
    await user.save();
    await setAuthCookies(res, user);
    const { password: _password, refreshTokenHash, loginOtpHash, loginOtpExpiresAt, loginOtpSentAt, loginOtpAttempts, phoneLogin, phoneOtpHash, phoneOtpExpiresAt, phoneOtpSentAt, phoneOtpAttempts, ...safeUser } = user.toObject();
    return res.status(200).json({ message: "Signed in successfully", user: safeUser });
  } catch (error) {
    console.error("Could not verify phone login OTP:", error.message);
    return res.status(500).json({ error: "Could not verify the sign-in code" });
  }
});
*/

const setAuthCookies = async (res, user) => {
  const accessToken = user.getAccessToken();
  const refreshToken = user.getRefreshToken();
  res.cookie("accessToken", accessToken, {
    ...baseCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  res.cookie("refreshToken", refreshToken, {
    ...baseCookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
  await user.setRefreshToken(refreshToken);
};

const clearAuthCookies = (res) => {
  res.clearCookie("accessToken", baseCookieOptions);
  res.clearCookie("refreshToken", baseCookieOptions);
};

authRouter.post("/signup", checkEmailExists, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const strongPassword = await isStrongPassword(password);
    if (!strongPassword) {
      return res.status(400).json({ error: "Password is not strong enough" });
    }
    const trimmedName = name.trim();
    const newUser = new User({
      name: trimmedName,
      email,
      password,
      mobile: "",
      address: "",
      gender: "male",
      lastName: "",
    });

    await newUser.save();
    const safeUser = newUser.toObject();
    delete safeUser.password;
    res.status(201).json({ message: "User registered successfully", user: safeUser });
  } catch (error) {
    console.error("Signup failed:", error);
    res.status(500).json({ error: "Could not complete signup" });
  }
});

authRouter.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    const isPasswordValid = user ? await user.comparePassword(password) : false;
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    await setAuthCookies(res, user);
    const { password: _password, refreshTokenHash, ...safeUser } =
      user.toObject();
    res
      .status(200)
      .json({ message: "User signed in successfully", user: safeUser });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

authRouter.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: "Google credential is required" });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (error) {
      return res.status(401).json({ error: "Invalid Google credential" });
    }

    if (!payload?.email_verified) {
      return res
        .status(401)
        .json({ error: "Google account email is not verified" });
    }

    let user = await User.findOne({ email: payload.email });
    if (user) {
      if (!user.googleId) {
        user.googleId = payload.sub;
        await user.save();
      }
    } else {
      user = new User({
        name: payload.given_name || payload.name || "Google User",
        lastName: payload.family_name || "",
        email: payload.email,
        googleId: payload.sub,
      });
      await user.save();
    }

    await setAuthCookies(res, user);
    const { password: _password, refreshTokenHash, ...safeUser } =
      user.toObject();
    res.status(200).json({ message: "Signed in with Google", user: safeUser });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

authRouter.post("/refresh-token", async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) {
      return res.status(401).json({ error: "No refresh token provided" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      clearAuthCookies(res);
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    if (decoded.type !== "refresh") {
      clearAuthCookies(res);
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const user = await User.findById(decoded.id).select("+refreshTokenHash");
    if (!user || !(await user.compareRefreshToken(token))) {
      clearAuthCookies(res);
      return res.status(401).json({ error: "Refresh token not recognized" });
    }

    await setAuthCookies(res, user);
    res.status(200).json({ message: "Token refreshed" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

authRouter.post("/signout", async (req, res) => {
  try {
    const token = req.cookies.accessToken || req.cookies.refreshToken;
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded?.id) {
          const user = await User.findById(decoded.id);
          if (user) await user.setRefreshToken(null);
        }
      } catch (error) {
        // best-effort revocation only — always still clear cookies below
      }
    }
    clearAuthCookies(res);
    res.status(200).send("Signout successful");
  } catch (error) {
    res.status(500).send({ error: "Internal server error" });
  }
});

authRouter.get("/me", userAuth, (req, res) => {
  const { password, ...safeUser } = req.user.toObject();
  res.status(200).json(safeUser);
});

authRouter.put("/change-password", userAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Current and new password are required" });
    }

    const isCurrentValid = await req.user.comparePassword(currentPassword);
    if (!isCurrentValid) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    if (!(await isStrongPassword(newPassword))) {
      return res
        .status(400)
        .json({ error: "New password is not strong enough" });
    }

    req.user.password = newPassword;
    req.user.refreshTokenHash = undefined;
    await req.user.save();
    clearAuthCookies(res);

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = authRouter;
