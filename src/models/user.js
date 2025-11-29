const mongoose = require("mongoose");
const { createHash, compareHash } = require("../utils/createHash");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
}, { timestamps: true });

userSchema.pre("save", async function (next) {
  const user = this;
  
  // Only hash if password is modified or new
  if (!user.isModified("password")) {
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
  return await compareHash(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);