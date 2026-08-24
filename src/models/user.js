const mongoose = require("mongoose");
const { createHash, compareHash } = require("../utils/createHash");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
    },
    address: {
      type: String,
    },
    mobile: {
      type: String,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      // Not required for accounts created via Google Sign-In (no password to store).
      required: function () {
        return !this.googleId;
      },
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    refreshTokenHash: {
      type: String,
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  const user = this;
  // Only hash if password is modified or new
  if (!user.isModified("password") || !user.password) {
    return next();
  }
  try {
    user.password = await createHash(user.password);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return await compareHash(candidatePassword, this.password);
};

userSchema.methods.getAccessToken = function () {
  return jwt.sign({ id: this._id, type: "access" }, process.env.JWT_SECRET, {
    expiresIn: "15m",
  });
};

userSchema.methods.getRefreshToken = function () {
  return jwt.sign({ id: this._id, type: "refresh" }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

userSchema.methods.setRefreshToken = async function (refreshToken) {
  this.refreshTokenHash = refreshToken ? await createHash(refreshToken) : undefined;
  await this.save();
};

userSchema.methods.compareRefreshToken = async function (candidateToken) {
  if (!this.refreshTokenHash) return false;
  return await compareHash(candidateToken, this.refreshTokenHash);
};

module.exports = mongoose.model("User", userSchema);
