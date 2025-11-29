const bcrypt = require("bcrypt");

const createHash = (password) => {
  try {
    const saltRounds = 10;
    const salt = bcrypt.genSaltSync(saltRounds);
    const encryptedPassword = bcrypt.hashSync(password, salt);
    return encryptedPassword;
  } catch (error) {
    console.error("Error creating hash: ", error);
    throw error;
  }
};

const compareHash = (password, hash) => {
  return bcrypt.compareSync(password, hash);
};
module.exports = { createHash, compareHash };
